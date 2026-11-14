// 把各行情来源的原始条目合并成网页读取的 prices.json，并维护涨跌历史 history.json。

import { MODELS, MODEL_BY_ID } from '../../site/assets/catalog.js';
import { resolveSourceModel, makeAdHocModel, storageRank } from '../../site/assets/core.js';

export const HISTORY_LIMIT = 400; // 每条价格序列最多保留的变动点数
export const CHANGE_WINDOW_DAYS = 7; // 多少天内的调价在网页上标出涨跌

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 韩国时间的日期 "2026-11-14" */
export function kstDate(date) {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

/**
 * 把一个来源的原始条目对到目录机型上。
 * 返回 { rows: [{ model, storage, prices }], warnings }
 */
export function normalizeEntries(source, entries) {
  const rows = [];
  const warnings = [];
  const seen = new Map();
  const adHoc = new Map();

  for (const entry of entries) {
    const resolved = resolveSourceModel(entry.sourceName);
    let model = (entry.slug && MODEL_BY_ID.get(entry.slug)) || resolved.model;
    if (!model) {
      const created = makeAdHocModel(resolved.baseName);
      model = adHoc.get(created.id) || created;
      if (!adHoc.has(created.id)) {
        adHoc.set(created.id, created);
        warnings.push(`${source.name}：发现目录外的新机型「${entry.sourceName}」，已自动收录为 ${created.id}`);
      }
    }
    if (resolved.storageHint && resolved.storageHint !== entry.storage) {
      warnings.push(`${source.name}：「${entry.sourceName}」名称里的容量与表头 ${entry.storage} 不一致，按表头处理`);
    }
    if (model.storages && !model.storages.includes(entry.storage)) {
      warnings.push(`${source.name}：忽略不存在的配置「${entry.sourceName} ${entry.storage}」`);
      continue;
    }
    const key = `${model.id}|${entry.storage}`;
    if (seen.has(key)) {
      warnings.push(`${source.name}：${model.name} ${entry.storage} 重复出现，保留第一条`);
      continue;
    }
    seen.set(key, true);
    rows.push({ model, storage: entry.storage, prices: entry.prices });
  }
  return { rows, warnings };
}

function emptyHistory() {
  return { schema: 1, points: {} };
}

const TIME_KEYS = new Set(['generatedAt', 'fetchedAt']);

/**
 * 新数据和上一次相比，除了抓取时间之外有没有变化。
 * 自动更新据此决定要不要往仓库提交：同一天内反复抓取、价格没变，就不产生提交；
 * 跨天后 day 字段会变，所以每天至少提交一次。
 */
export function isMeaningfulChange(previous, next) {
  if (!previous) return true;
  const content = (prices) => JSON.stringify(prices, (key, value) => (TIME_KEYS.has(key) ? undefined : value));
  return content(previous) !== content(next);
}

/** 记录一次观测；只有价格变了才追加新点。返回是否有变动。 */
function recordPoint(points, key, day, value) {
  const series = points[key] || (points[key] = []);
  const last = series[series.length - 1];
  if (!last) {
    series.push([day, value]);
    return false;
  }
  if (last[1] === value) return false;
  if (last[0] === day) {
    // 同一天内再次调价：改写当天的点；如果又调回前一个点的价格，等于没变
    if (series.length >= 2 && series[series.length - 2][1] === value) series.pop();
    else last[1] = value;
  } else {
    series.push([day, value]);
  }
  if (series.length > HISTORY_LIMIT) series.splice(0, series.length - HISTORY_LIMIT);
  return true;
}

/** 最近 CHANGE_WINDOW_DAYS 天内的调价：[涨跌额, 调价日]；否则 null */
function recentChange(series, today) {
  if (!series || series.length < 2) return null;
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  if (daysBetween(last[0], today) > CHANGE_WINDOW_DAYS) return null;
  return [last[1] - prev[1], last[0]];
}

/**
 * results: [{ source, ok, priceDate, entries, warnings, error }]
 * previous: 上一次的 prices.json（来源抓取失败时沿用它的旧数据）
 * history:  上一次的 history.json
 */
export function buildDataset({ results, previous, history, now = new Date() }) {
  const today = kstDate(now);
  const nextHistory = history && history.points ? structuredClone(history) : emptyHistory();
  const warnings = [];
  const sources = [];
  const changedNow = {}; // 来源 id → 本次抓取发现的调价项数（只用于日志，不写进数据文件）
  const modelMap = new Map(); // id → { meta, storages: Map(storage → { prices, change }) }

  const ensure = (model, storage) => {
    if (!modelMap.has(model.id)) modelMap.set(model.id, { meta: model, storages: new Map() });
    const bucket = modelMap.get(model.id).storages;
    if (!bucket.has(storage)) bucket.set(storage, { prices: {}, change: {} });
    return bucket.get(storage);
  };

  for (const result of results) {
    const { source } = result;
    const prevMeta = previous?.sources?.find((s) => s.id === source.id) || null;
    const points = nextHistory.points[source.id] || (nextHistory.points[source.id] = {});

    if (result.ok) {
      const normalized = normalizeEntries(source, result.entries);
      warnings.push(...(result.warnings || []), ...normalized.warnings);
      let changed = 0;
      for (const row of normalized.rows) {
        const slot = ensure(row.model, row.storage);
        slot.prices[source.id] = row.prices;
        for (const [grade, value] of Object.entries(row.prices)) {
          if (recordPoint(points, `${row.model.id}|${row.storage}|${grade}`, today, value)) changed++;
        }
      }
      sources.push({
        id: source.id,
        name: source.name,
        nameKo: source.nameKo,
        url: source.url,
        grades: source.grades,
        priceDate: result.priceDate || null,
        fetchedAt: now.toISOString(),
        ok: true,
        error: null,
        entryCount: normalized.rows.length,
      });
      changedNow[source.id] = changed;
    } else {
      // 抓取失败（或本次按 --only 跳过）：沿用上一次的数据；失败的会在网页上标明
      if (!result.skipped) warnings.push(`${source.name}：本次抓取失败，沿用上一次的数据（${result.error}）`);
      let carried = 0;
      for (const model of previous?.models || []) {
        for (const st of model.storages || []) {
          const old = st.prices?.[source.id];
          if (!old) continue;
          const meta = MODEL_BY_ID.get(model.id) || { id: model.id, name: model.name, ko: model.ko, series: model.series, storages: null, adHoc: true };
          ensure(meta, st.storage).prices[source.id] = old;
          carried++;
        }
      }
      if (!carried && result.skipped) continue; // 跳过且本来就没有数据：不列出这个来源
      sources.push({
        id: source.id,
        name: source.name,
        nameKo: source.nameKo,
        url: source.url,
        grades: source.grades,
        priceDate: prevMeta?.priceDate || null,
        fetchedAt: prevMeta?.fetchedAt || null,
        ok: result.skipped ? prevMeta?.ok ?? true : false,
        error: result.skipped ? prevMeta?.error ?? null : String(result.error || '未知错误'),
        entryCount: carried,
      });
    }
  }

  // 涨跌标记（来自历史）
  for (const [modelId, entry] of modelMap) {
    for (const [storage, slot] of entry.storages) {
      for (const [sourceId, prices] of Object.entries(slot.prices)) {
        const marks = {};
        for (const grade of Object.keys(prices)) {
          const change = recentChange(nextHistory.points[sourceId]?.[`${modelId}|${storage}|${grade}`], today);
          if (change && change[0] !== 0) marks[grade] = change;
        }
        if (Object.keys(marks).length) slot.change[sourceId] = marks;
      }
    }
  }

  // 排序：目录外的新机型排最前（多半是刚上市的），其余按目录顺序
  const catalogOrder = new Map(MODELS.map((m, i) => [m.id, i]));
  const models = [...modelMap.values()]
    .sort((a, b) => (catalogOrder.get(a.meta.id) ?? -1) - (catalogOrder.get(b.meta.id) ?? -1))
    .map(({ meta, storages }) => {
      const out = { id: meta.id, name: meta.name, ko: meta.ko, series: meta.series };
      if (meta.adHoc) out.adHoc = true;
      out.storages = [...storages.entries()]
        .sort((a, b) => storageRank(a[0]) - storageRank(b[0]))
        .map(([storage, slot]) => {
          const row = { storage, prices: slot.prices };
          if (Object.keys(slot.change).length) row.change = slot.change;
          return row;
        });
      return out;
    });

  const prices = {
    schema: 1,
    generatedAt: now.toISOString(),
    day: today,
    currency: 'KRW',
    changeWindowDays: CHANGE_WINDOW_DAYS,
    sources,
    models,
    warnings,
  };
  return { prices, history: nextHistory, changedNow };
}
