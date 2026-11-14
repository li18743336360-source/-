// 页面交互：读取 data/prices.json，渲染行情表、收货助手和说明页。

import { MODEL_BY_ID, DEFAULT_WATCH } from './catalog.js';
import {
  evaluateListing,
  parseListingsText,
  maxBuyPrice,
  searchLinks,
  extractDaangnRegion,
  nameKey,
  formatWan,
  formatKRW,
  formatCNY,
} from './core.js';

const STORE_KEY = 'iphone-price-board.v1';
const STALE_AFTER_MS = 36 * 60 * 60 * 1000;
const TABS = ['prices', 'deals', 'guide'];
const DEFAULT_GRADE = { 'space-tradein': 'B', rediva: 'B+' };

const GRADE_NOTES = {
  'space-tradein': {
    A: '功能正常，外观和屏幕都干净',
    B: '功能正常，外观有划痕或磕碰，屏幕干净',
    C: '功能正常，电池低于 80%，外观多处磕碰或划痕',
    D: '功能故障，或前后玻璃破损，或屏幕残影',
    E: '功能故障且外观破损，屏幕严重破损或显示不良',
  },
  rediva: {
    A: '外观状态优秀，功能正常',
    'A-': '有轻微使用痕迹，功能正常',
    'B+': '有明显使用感，功能正常',
    B: '有磕碰或轻微残影，功能正常',
  },
};

// 演示用的虚构商品，价格是随手编的，只为展示判定效果
const SAMPLE_TEXT = [
  '아이폰 18 프로맥스 256 미개봉 새상품',
  '1,480,000원',
  '역삼동 · 3분 전',
  '',
  '아이폰 17 프로맥스 256 내추럴 티타늄 배터리 96%',
  '1,090,000원',
  '서초동 · 1시간 전',
  '',
  '아이폰 18 프로 512 자급제 풀박스',
  '1,750,000원',
  '정자동 · 2시간 전',
  '',
  '아이폰 17 프로맥스 512 액정 파손',
  '690,000원',
  '부평동 · 5시간 전',
  '',
  '아이폰 18 프로맥스 케이스 팝니다',
  '15,000원',
  '논현동 · 1일 전',
].join('\n');

const DEFAULTS = {
  source: 'space-tradein',
  unit: 'wan',
  grade: {},
  targetProfit: 100000,
  extraCost: 0,
  krwPerCny: null,
  watch: DEFAULT_WATCH,
  regions: [],
  region: null,
  paste: null,
};

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      return { ...DEFAULTS, ...saved, grade: { ...(saved.grade || {}) }, watch: [...(saved.watch || DEFAULT_WATCH)], regions: [...(saved.regions || [])] };
    }
  } catch {
    /* 存储不可用时用默认值 */
  }
  return { ...DEFAULTS, grade: {}, watch: [...DEFAULT_WATCH], regions: [] };
}

function saveSettings() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state.settings));
  } catch {
    /* 存不了就算了，页面照常工作 */
  }
}

const state = {
  data: null,
  loadError: null,
  settings: loadSettings(),
  tab: 'prices',
  query: '',
  series: 'all',
};

const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

// ---------------------------------------------------------------- 取数

function currentSource() {
  const sources = state.data?.sources || [];
  return sources.find((s) => s.id === state.settings.source) || sources[0] || null;
}

function currentGrade() {
  const source = currentSource();
  if (!source) return null;
  const chosen = state.settings.grade[source.id] || DEFAULT_GRADE[source.id];
  return source.grades.includes(chosen) ? chosen : source.grades[Math.min(1, source.grades.length - 1)];
}

function modelName(model) {
  return model.name;
}

function findModel(id) {
  return state.data?.models.find((m) => m.id === id) || null;
}

function pricesFor(modelId, storage) {
  const source = currentSource();
  const row = findModel(modelId)?.storages.find((s) => s.storage === storage);
  return (source && row?.prices?.[source.id]) || null;
}

function storagesFor(modelId) {
  const source = currentSource();
  if (!source) return [];
  return (findModel(modelId)?.storages || []).filter((s) => s.prices?.[source.id]).map((s) => s.storage);
}

function unit() {
  const { unit: chosen, krwPerCny } = state.settings;
  return chosen === 'cny' && !krwPerCny ? 'wan' : chosen;
}

function fmt(value) {
  if (value == null) return '—';
  const u = unit();
  if (u === 'krw') return formatKRW(value);
  if (u === 'cny') return formatCNY(value, state.settings.krwPerCny);
  return formatWan(value);
}

function fmtSigned(value) {
  if (value == null) return '—';
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return sign + fmt(Math.abs(value));
}

function unitLabel() {
  return { wan: '万韩元', krw: '韩元', cny: '人民币（约）' }[unit()];
}

const kstTime = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Seoul',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function shortDate(iso) {
  return iso ? iso.slice(5).replace('-', '/') : '未知';
}

// ---------------------------------------------------------------- 顶部与提示

function renderStamp() {
  const source = currentSource();
  $('stampDate').textContent = source?.priceDate || (state.loadError ? '—' : '载入中');
  $('stampFetched').textContent = source?.fetchedAt ? kstTime.format(new Date(source.fetchedAt)) : state.loadError ? '—' : '载入中';
}

function renderBanners() {
  const banners = [];
  if (state.loadError) {
    banners.push(`<strong>行情没有载入成功。</strong>${esc(state.loadError)} 请刷新重试；如果一直这样，说明数据文件还没生成。`);
  }
  if (state.data) {
    for (const source of state.data.sources.filter((s) => !s.ok)) {
      banners.push(
        `<strong>${esc(source.name)} 本次没有抓取成功，</strong>下面显示的是它上一次（${esc(
          source.fetchedAt ? kstTime.format(new Date(source.fetchedAt)) : '更早',
        )}）的报价。`,
      );
    }
    const age = Date.now() - Date.parse(state.data.generatedAt);
    if (age > STALE_AFTER_MS) {
      banners.push(`<strong>数据已经 ${Math.floor(age / 86400000) || 1} 天没有更新。</strong>自动更新可能没有在运行，报价仅供参考。`);
    }
  }
  $('banners').innerHTML = banners.map((html) => `<div class="banner" role="status">${html}</div>`).join('');
}

// ---------------------------------------------------------------- 行情页

function segButtons(options, selected, action) {
  return options
    .map(
      (o) =>
        `<button type="button" data-action="${action}" data-value="${esc(o.value)}" aria-pressed="${o.value === selected}">${esc(o.label)}${
          o.small ? ` <small>${esc(o.small)}</small>` : ''
        }</button>`,
    )
    .join('');
}

function renderPriceControls() {
  const sources = state.data?.sources || [];
  const source = currentSource();
  $('sourceSeg').innerHTML = segButtons(
    sources.map((s) => ({ value: s.id, label: s.name, small: `${s.grades.length} 个等级` })),
    source?.id,
    'source',
  );
  const units = [
    { value: 'wan', label: '万韩元' },
    { value: 'krw', label: '韩元' },
  ];
  if (state.settings.krwPerCny) units.push({ value: 'cny', label: '人民币' });
  $('unitSeg').innerHTML = segButtons(units, unit(), 'unit');

  const seen = [];
  for (const model of state.data?.models || []) if (!seen.includes(model.series)) seen.push(model.series);
  const chips = [{ value: 'all', label: '全部' }, ...seen.map((s) => ({ value: s, label: /^\d+$/.test(s) ? `${s} 系列` : s }))];
  $('seriesChips').innerHTML = chips
    .map((c) => `<button type="button" class="chip" data-action="series" data-value="${esc(c.value)}" aria-pressed="${c.value === state.series}">${esc(c.label)}</button>`)
    .join('');
}

function matchesQuery(model, query) {
  if (!query) return true;
  const hay = `${model.name} ${model.ko} ${model.id}`.toLowerCase();
  const compact = hay.replace(/[\s-]+/g, '') + nameKey(model.ko);
  return query
    .toLowerCase()
    .replace(/(\d{1,2})\s*pm\b/g, '$1 pro max')
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => hay.includes(token) || compact.includes(token) || compact.includes(nameKey(token)));
}

function changeMark(change) {
  if (!change || !change[0]) return '';
  const [delta, date] = change;
  const up = delta > 0;
  return `<span class="chg ${up ? 'up' : 'down'}" title="${esc(shortDate(date))} 调价">${up ? '▲' : '▼'}${fmt(Math.abs(delta))}</span>`;
}

function renderCard(model, source) {
  const watched = state.settings.watch.includes(model.id);
  const rows = model.storages
    .filter((s) => s.prices?.[source.id])
    .map((s) => {
      const prices = s.prices[source.id];
      const marks = s.change?.[source.id] || {};
      const cells = source.grades
        .map((grade) =>
          prices[grade] == null
            ? '<td class="empty">—</td>'
            : `<td title="${formatKRW(prices[grade])} 韩元">${fmt(prices[grade])}${changeMark(marks[grade])}</td>`,
        )
        .join('');
      return `<tr><th scope="row">${esc(s.storage)}</th>${cells}</tr>`;
    })
    .join('');
  return `<article class="card" data-model="${esc(model.id)}">
    <div class="card-head">
      <div>
        <div class="card-name">${esc(modelName(model))}</div>
        <div class="card-ko" lang="ko">${esc(model.ko)}</div>
      </div>
      <button type="button" class="star" data-action="watch" data-value="${esc(model.id)}" aria-pressed="${watched}">${watched ? '★ 已关注' : '☆ 关注'}</button>
    </div>
    <div class="table-scroll">
      <table class="ptable">
        <thead><tr><th scope="col">容量</th>${source.grades.map((g) => `<th scope="col">${esc(g)}</th>`).join('')}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </article>`;
}

function renderGrid() {
  const grid = $('modelGrid');
  const source = currentSource();
  if (!state.data || !source) {
    grid.innerHTML = state.loadError ? '<div class="empty-state">没有可显示的行情。</div>' : '';
    return;
  }
  const withPrices = state.data.models.filter((m) => m.storages.some((s) => s.prices?.[source.id]));
  const visible = withPrices
    .filter((m) => state.series === 'all' || m.series === state.series)
    .filter((m) => matchesQuery(m, state.query.trim()));
  // 关注的机型排在前面
  const watch = state.settings.watch;
  visible.sort((a, b) => Number(watch.includes(b.id)) - Number(watch.includes(a.id)));

  grid.innerHTML = visible.length
    ? visible.map((m) => renderCard(m, source)).join('')
    : '<div class="empty-state">没有符合条件的机型。换个关键词，或切换行情来源试试。</div>';

  let ups = 0;
  let downs = 0;
  for (const model of withPrices) {
    for (const s of model.storages) {
      for (const change of Object.values(s.change?.[source.id] || {})) {
        if (change[0] > 0) ups++;
        else if (change[0] < 0) downs++;
      }
    }
  }
  const window = state.data.changeWindowDays || 7;
  const moves = ups || downs ? `近 ${window} 天调价：<b>涨 ${ups} 项，跌 ${downs} 项</b>` : `近 ${window} 天没有调价记录`;
  $('priceStatus').innerHTML = `单位：<b>${esc(unitLabel())}</b> · ${esc(source.name)} 回收报价 · 显示 ${visible.length} / ${withPrices.length} 个机型 · ${moves}`;
}

// ---------------------------------------------------------------- 收货助手

function renderDealControls() {
  const source = currentSource();
  if (!source) return;
  const grade = currentGrade();
  $('gradeSeg').innerHTML = segButtons(
    source.grades.map((g) => ({ value: g, label: g })),
    grade,
    'grade',
  );
  const note = GRADE_NOTES[source.id]?.[grade];
  $('gradeHint').textContent = `当前按 ${source.name} 的 ${grade} 级估价${note ? `：${note}。` : '。'}标题里出现破损、残影、电池低于 80% 等字样时会自动改按更低的等级。`;

  const { targetProfit, extraCost, krwPerCny } = state.settings;
  if (document.activeElement !== $('targetProfit')) $('targetProfit').value = targetProfit / 10000;
  if (document.activeElement !== $('extraCost')) $('extraCost').value = extraCost / 10000;
  if (document.activeElement !== $('krwPerCny')) $('krwPerCny').value = krwPerCny || '';
}

function renderWatch() {
  const source = currentSource();
  const list = $('watchList');
  if (!state.data || !source) {
    list.innerHTML = '';
    return;
  }
  const grade = currentGrade();
  const { settings } = state;
  const watched = settings.watch.map(findModel).filter(Boolean);

  $('addWatch').innerHTML =
    '<option value="">选择机型…</option>' +
    state.data.models
      .filter((m) => !settings.watch.includes(m.id))
      .map((m) => `<option value="${esc(m.id)}">${esc(modelName(m))}</option>`)
      .join('');

  if (!watched.length) {
    list.innerHTML = '<div class="empty-state">还没有关注的机型。用右上角的「添加机型」选几个常收的。</div>';
    return;
  }

  list.innerHTML = watched
    .map((model) => {
      const catalog = MODEL_BY_ID.get(model.id) || model;
      const storages = storagesFor(model.id);
      const rows = storages.length
        ? storages
            .map((storage) => {
              const ref = pricesFor(model.id, storage)?.[grade] ?? null;
              const max = maxBuyPrice(ref, settings);
              const links = searchLinks(catalog, storage, max, settings.region);
              const cny = settings.krwPerCny && unit() !== 'cny' && max > 0 ? ` <small>≈ ¥${formatCNY(max, settings.krwPerCny)}</small>` : '';
              return `<div class="watch-row">
                <div class="watch-storage">${esc(storage)}</div>
                <div class="kv"><span class="kv-label">${esc(grade)} 级回收价</span><span class="kv-value">${fmt(ref)}</span></div>
                <div class="kv kv-strong"><span class="kv-label">收货上限</span><span class="kv-value">${max != null && max > 0 ? fmt(max) : '—'}${cny}</span></div>
                <div class="links">
                  <a class="linkbtn linkbtn-main" href="${esc(links.daangn)}" target="_blank" rel="noopener noreferrer" title="搜索：${esc(links.keyword)}">当根</a>
                  <a class="linkbtn" href="${esc(links.bunjang)}" target="_blank" rel="noopener noreferrer" lang="ko">번개장터</a>
                  <a class="linkbtn" href="${esc(links.joongna)}" target="_blank" rel="noopener noreferrer" lang="ko">중고나라</a>
                </div>
              </div>`;
            })
            .join('')
        : `<div class="watch-row"><div class="hint watch-empty">${esc(source.name)} 目前没有这个机型的报价，可以在「行情」页切换来源。</div></div>`;
      return `<div class="watch-model">
        <div class="watch-head">
          <div><span class="watch-name">${esc(modelName(model))}</span> <span class="card-ko" lang="ko">${esc(model.ko)}</span></div>
          <button type="button" class="star" data-action="unwatch" data-value="${esc(model.id)}" aria-label="取消关注 ${esc(modelName(model))}">移除</button>
        </div>
        ${rows}
      </div>`;
    })
    .join('');
}

function renderRegions() {
  const { regions, region } = state.settings;
  const chips = [`<button type="button" class="chip" data-action="region" data-value="" aria-pressed="${!region}">当根默认位置</button>`];
  for (const r of regions) {
    chips.push(
      `<span class="chip-pair"><button type="button" class="chip" data-action="region" data-value="${esc(r)}" aria-pressed="${r === region}" lang="ko">${esc(
        r.replace(/-\d+$/, ''),
      )}</button><button type="button" class="chip" data-action="region-remove" data-value="${esc(r)}" aria-label="删除地区 ${esc(r)}">×</button></span>`,
    );
  }
  $('regionChips').innerHTML = chips.join('');
}

const VERDICT = {
  good: { label: '值得收', order: 0 },
  near: { label: '有赚但不够', order: 1 },
  over: { label: '偏贵', order: 2 },
  skip: { label: '跳过', order: 3 },
  unknown: { label: '未识别', order: 4 },
};

function renderResult(r) {
  const verdict = VERDICT[r.verdict];
  const judged = r.verdict === 'good' || r.verdict === 'near' || r.verdict === 'over';
  const model = r.modelId ? findModel(r.modelId) : null;
  const flags = [];
  if (r.status === '예약중') flags.push('<span class="flag flag-warn">预约中</span>');
  if (judged && r.storageAssumed) flags.push('<span class="flag">没写容量，按最小容量算</span>');
  if (judged && r.match?.flags.exchange) flags.push('<span class="flag">可能是换机帖</span>');
  if (r.note) flags.push(`<span class="flag flag-warn">${esc(r.note)}</span>`);

  const meta = [];
  if (model && judged) meta.push(`<b>${esc(modelName(model))} · ${esc(r.storage)}</b>`);
  if (judged && r.grade && r.ref != null) {
    const why = r.gradeReasons?.length ? `（${esc(r.gradeReasons.join('、'))}）` : '';
    meta.push(`按 ${esc(r.grade)} 级${why}回收价 ${fmt(r.ref)}`);
  }
  if (r.where) meta.push(`<span lang="ko">${esc(r.where)}</span>`);

  const ladder =
    r.byGrade && r.price != null && judged
      ? `<div class="result-grades" aria-label="各等级预计利润">${r.byGrade
          .filter((g) => g.profit != null)
          .map((g) => `<span class="${g.grade === r.grade ? 'cur' : ''}">${esc(g.grade)} ${fmtSigned(g.profit)}</span>`)
          .join('')}</div>`
      : '';

  const nums =
    r.price != null
      ? `<div class="result-nums">
          <div class="kv-label">标价</div>
          <div class="result-price">${fmt(r.price)}</div>
          ${judged && r.profit != null ? `<div class="result-profit ${r.profit >= 0 ? 'pos' : 'neg'}">${fmtSigned(r.profit)}</div>` : ''}
        </div>`
      : '<div></div>';

  return `<article class="result">
    <span class="pill pill-${r.verdict}">${verdict.label}</span>
    <div class="result-body">
      <div class="result-title" lang="ko">${esc(r.title)}</div>
      ${meta.length ? `<div class="result-meta">${meta.join(' · ')}</div>` : ''}
      ${flags.length ? `<div>${flags.join('')}</div>` : ''}
      ${ladder}
    </div>
    ${nums}
  </article>`;
}

function renderPaste() {
  const source = currentSource();
  const box = $('pasteBox');
  const usingSample = state.settings.paste == null;
  if (document.activeElement !== box) box.value = usingSample ? SAMPLE_TEXT : state.settings.paste;
  $('sampleTag').hidden = !usingSample;
  if (!state.data || !source) {
    $('pasteResults').innerHTML = '';
    $('pasteSummary').textContent = '';
    return;
  }
  const grade = currentGrade();
  const ctx = {
    grades: source.grades,
    getPrices: pricesFor,
    listStorages: storagesFor,
    knownIds: new Set(state.data.models.map((m) => m.id)),
    settings: { grade, targetProfit: state.settings.targetProfit, extraCost: state.settings.extraCost },
  };
  const results = parseListingsText(box.value).map((item) => {
    const r = evaluateListing(item, ctx);
    if (r.status && r.status !== '예약중' && r.verdict !== 'unknown') {
      r.verdict = 'skip';
      r.note = r.note || '已成交';
    }
    return r;
  });
  results.sort((a, b) => VERDICT[a.verdict].order - VERDICT[b.verdict].order || (b.profit ?? -Infinity) - (a.profit ?? -Infinity));

  const count = (v) => results.filter((r) => r.verdict === v).length;
  if (!box.value.trim()) {
    $('pasteSummary').textContent = '';
    $('pasteResults').innerHTML = '<div class="empty-state">把标题和价格粘贴到上面的框里，再点「判定」。</div>';
    return;
  }
  if (!results.length) {
    $('pasteSummary').textContent = '';
    $('pasteResults').innerHTML = '<div class="empty-state">没有从这段文字里找到「标题 + 价格」。价格要带「원」或「만」，例如 1,350,000원 或 135만。</div>';
    return;
  }
  $('pasteSummary').textContent = `共 ${results.length} 条：值得收 ${count('good')}，有赚但不够 ${count('near')}，偏贵 ${count('over')}，跳过或未识别 ${count('skip') + count('unknown')}。单位 ${unitLabel()}，利润已扣其他成本。`;
  $('pasteResults').innerHTML = results.map(renderResult).join('');
}

// ---------------------------------------------------------------- 说明页

function renderGuide() {
  if (!state.data) return;
  $('sourceTable').querySelector('tbody').innerHTML = state.data.sources
    .map(
      (s) => `<tr>
        <td><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.name)}</a> <span lang="ko">${esc(s.nameKo || '')}</span></td>
        <td class="num">${esc(s.grades.join(' / '))}</td>
        <td class="num">${esc(s.priceDate || '未知')}</td>
        <td class="num">${s.fetchedAt ? esc(kstTime.format(new Date(s.fetchedAt))) : '—'}${s.ok ? '' : '（本次失败，沿用旧数据）'}</td>
        <td class="num">${esc(s.entryCount)}</td>
      </tr>`,
    )
    .join('');
}

// ---------------------------------------------------------------- 总渲染与事件

function renderAll() {
  renderStamp();
  renderBanners();
  renderPriceControls();
  renderGrid();
  renderDealControls();
  renderWatch();
  renderRegions();
  renderPaste();
  renderGuide();
}

function showTab(tab) {
  state.tab = TABS.includes(tab) ? tab : 'prices';
  for (const name of TABS) {
    $(`tab-${name}`).setAttribute('aria-selected', String(name === state.tab));
    $(`panel-${name}`).hidden = name !== state.tab;
  }
}

function setRegionMessage(text, isError) {
  const el = $('regionMsg');
  el.textContent = text;
  el.style.color = isError ? 'var(--bad)' : '';
}

function addRegion() {
  const input = $('regionInput');
  const region = extractDaangnRegion(input.value);
  if (!region) {
    setRegionMessage('没有在里面找到地区参数。它长这样：in=역삼동-6035（洞名 + 短横线 + 数字）。', true);
    return;
  }
  const { settings } = state;
  if (!settings.regions.includes(region)) settings.regions.push(region);
  settings.region = region;
  input.value = '';
  setRegionMessage(`已添加并选中 ${region}，「当根」按钮现在会在这个地区搜索。`, false);
  saveSettings();
  renderRegions();
  renderWatch();
}

const actions = {
  source(value) {
    state.settings.source = value;
  },
  unit(value) {
    state.settings.unit = value;
  },
  series(value) {
    state.series = value;
  },
  grade(value) {
    const source = currentSource();
    if (source) state.settings.grade[source.id] = value;
  },
  watch(value) {
    const { watch } = state.settings;
    const i = watch.indexOf(value);
    if (i >= 0) watch.splice(i, 1);
    else watch.push(value);
  },
  unwatch(value) {
    state.settings.watch = state.settings.watch.filter((id) => id !== value);
  },
  region(value) {
    state.settings.region = value || null;
  },
  'region-remove'(value) {
    const { settings } = state;
    settings.regions = settings.regions.filter((r) => r !== value);
    if (settings.region === value) settings.region = null;
  },
};

function bindEvents() {
  document.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-tab]');
    if (tab) {
      showTab(tab.dataset.tab);
      window.scrollTo(0, 0);
      try {
        history.replaceState(null, '', `#${state.tab}`);
      } catch {
        location.hash = state.tab;
      }
      return;
    }
    const target = event.target.closest('[data-action]');
    if (!target || !actions[target.dataset.action]) return;
    actions[target.dataset.action](target.dataset.value);
    saveSettings();
    renderAll();
  });

  window.addEventListener('hashchange', () => showTab(location.hash.slice(1)));

  $('modelSearch').addEventListener('input', (event) => {
    state.query = event.target.value;
    renderGrid();
  });

  const numberField = (id, apply) =>
    $(id).addEventListener('input', (event) => {
      const value = parseFloat(event.target.value);
      apply(Number.isFinite(value) && value > 0 ? value : 0);
      saveSettings();
      renderPriceControls();
      renderGrid();
      renderWatch();
      renderPaste();
    });
  numberField('targetProfit', (v) => (state.settings.targetProfit = Math.round(v * 10000)));
  numberField('extraCost', (v) => (state.settings.extraCost = Math.round(v * 10000)));
  numberField('krwPerCny', (v) => (state.settings.krwPerCny = v || null));

  $('addWatch').addEventListener('change', (event) => {
    const id = event.target.value;
    if (id && !state.settings.watch.includes(id)) state.settings.watch.push(id);
    saveSettings();
    renderGrid();
    renderWatch();
  });

  $('regionAdd').addEventListener('click', addRegion);
  $('regionInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addRegion();
    }
  });

  const box = $('pasteBox');
  const keepPaste = () => {
    state.settings.paste = box.value.slice(0, 20000);
    saveSettings();
  };
  let pasteTimer = 0;
  box.addEventListener('input', () => {
    keepPaste();
    $('sampleTag').hidden = true;
    clearTimeout(pasteTimer);
    pasteTimer = setTimeout(renderPaste, 400); // 停手后自动判定
  });
  $('pasteRun').addEventListener('click', () => {
    clearTimeout(pasteTimer);
    if (state.settings.paste != null) keepPaste();
    renderPaste();
  });
  $('pasteClear').addEventListener('click', () => {
    box.value = '';
    keepPaste();
    renderPaste();
    box.focus();
  });
  $('pasteSample').addEventListener('click', () => {
    state.settings.paste = null;
    saveSettings();
    box.value = SAMPLE_TEXT;
    renderPaste();
  });
}

async function loadData() {
  try {
    const response = await fetch('data/prices.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error(`服务器返回 ${response.status}。`);
    const data = await response.json();
    if (!data || !Array.isArray(data.models) || !Array.isArray(data.sources)) throw new Error('数据文件格式不对。');
    state.data = data;
    state.loadError = null;
  } catch (error) {
    state.loadError = error?.message || '网络错误。';
    $('priceStatus').textContent = '行情没有载入成功。';
  }
  renderAll();
}

bindEvents();
showTab(location.hash.slice(1));
renderAll();
loadData();
