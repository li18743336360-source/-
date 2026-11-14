// 纯逻辑（不碰 DOM）：机型名归一、标题识别、价格解析、收货判定。
// 网页（浏览器）和抓取脚本 / 测试（Node）共用。

import { MODELS, MODEL_BY_ID, STORAGE_ORDER } from './catalog.js';

// ---------------------------------------------------------------- 容量

const GB_SIZES = [32, 64, 128, 256, 512];

/** "256G" / "256GB" / "1T" / "1TB" / "1테라" → "256GB" / "1TB"；认不出返回 null */
export function normalizeStorage(raw) {
  if (raw == null) return null;
  const s = String(raw).normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  let m = s.match(/^(\d+)(tb|t|테라)$/);
  if (m) {
    const n = Number(m[1]);
    return n >= 1 && n <= 4 ? `${n}TB` : null;
  }
  m = s.match(/^(\d+)(gb|g|기가)?$/);
  if (m) {
    const n = Number(m[1]);
    if (n === 16 || GB_SIZES.includes(n)) return `${n}GB`;
    if (n === 1024) return '1TB';
  }
  return null;
}

export function storageRank(storage) {
  const i = STORAGE_ORDER.indexOf(storage);
  return i < 0 ? 99 : i;
}

// ---------------------------------------------------------------- 机型名归一（行情站 → 目录）

/** 把各种写法压成一个比较用的键："아이폰17 Pro Max" → "iphone17promax" */
export function nameKey(raw) {
  return String(raw)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/아이폰/g, 'iphone')
    .replace(/프로\s*맥스|프맥/g, 'promax')
    .replace(/프로/g, 'pro')
    .replace(/맥스/g, 'max')
    .replace(/플러스/g, 'plus')
    .replace(/미니/g, 'mini')
    .replace(/에어/g, 'air')
    .replace(/[\s\-_]/g, '');
}

const KEY_TO_MODEL = new Map();
for (const model of MODELS) {
  KEY_TO_MODEL.set(nameKey(model.name), model);
  for (const alias of model.aliases || []) KEY_TO_MODEL.set(nameKey(alias), model);
}

/**
 * 行情站的机型名 → { model, storageHint, baseName }。
 * 有的行情站把 1TB / 2TB 单独列成一个"机型"（"아이폰17 Pro Max 2T"），这里拆回去。
 * 目录里没有的新机型：model 为 null，由调用方决定是否自动收录。
 */
export function resolveSourceModel(rawName) {
  let base = String(rawName).normalize('NFKC').trim();
  let storageHint = null;
  const tail = base.match(/\s+(\d+\s*(?:tb|t|gb|g))$/i);
  if (tail) {
    const st = normalizeStorage(tail[1]);
    if (st) {
      storageHint = st;
      base = base.slice(0, tail.index).trim();
    }
  }
  return { model: KEY_TO_MODEL.get(nameKey(base)) || null, storageHint, baseName: base };
}

/** 目录外的新机型：生成一个临时条目，保证新机上市当天行情不丢。 */
export function makeAdHocModel(baseName) {
  const key = nameKey(baseName);
  const pretty = String(baseName)
    .normalize('NFKC')
    .replace(/아이폰\s*/g, 'iPhone ')
    .replace(/\s+/g, ' ')
    .trim();
  const gen = key.match(/^iphone(\d{1,2})/);
  return {
    id: key.replace(/^iphone/, 'iphone-').replace(/[^a-z0-9가-힣\-]/g, ''),
    name: pretty,
    ko: String(baseName).replace(/아이폰\s*/g, '아이폰 ').trim(),
    series: gen ? gen[1] : '旧款',
    storages: null,
    adHoc: true,
  };
}

// ---------------------------------------------------------------- 金额

/** "1,350,000원" / "135만원" / "135만 5천원" / "나눔" → 韩元整数；认不出返回 null */
export function parsePriceKRW(text) {
  if (text == null) return null;
  const s = String(text).normalize('NFKC').replace(/\s+/g, ' ');
  let m = s.match(/(\d{1,3}(?:,\d{3})+|\d{4,8})\s*원/);
  if (m) return parseInt(m[1].replace(/,/g, ''), 10);
  m = s.match(/(\d+(?:\.\d+)?)\s*만\s*(?:(\d)\s*천|(\d{1,4})\s*원)?/);
  if (m) {
    let value = Math.round(parseFloat(m[1]) * 10000);
    if (m[2]) value += Number(m[2]) * 1000;
    else if (m[3]) value += Number(m[3]);
    return value;
  }
  m = s.match(/(?<![\d,])(\d{1,3}(?:,\d{3}){1,2})(?![\d,])/);
  if (m) return parseInt(m[1].replace(/,/g, ''), 10);
  if (/나눔/.test(s)) return 0;
  return null;
}

const PRICE_PATTERNS = [
  /\d{1,3}(?:,\d{3})+\s*원?/g,
  /\d{4,8}\s*원/g,
  /\d+(?:\.\d+)?\s*만\s*(?:\d\s*천|\d{1,4}\s*원)?\s*원?/g,
];

function stripPrices(text) {
  let out = text;
  for (const re of PRICE_PATTERNS) out = out.replace(re, ' ');
  return out;
}

export function formatKRW(value) {
  if (value == null || Number.isNaN(value)) return '—';
  return Math.round(value).toLocaleString('en-US');
}

/** 万韩元，最多 1 位小数："161.6" */
export function formatWan(value) {
  if (value == null || Number.isNaN(value)) return '—';
  const wan = value / 10000;
  const fixed = Math.abs(wan) >= 1000 ? wan.toFixed(0) : wan.toFixed(1);
  return fixed.replace(/\.0$/, '');
}

export function formatCNY(value, krwPerCny) {
  if (value == null || !krwPerCny) return '—';
  return Math.round(value / krwPerCny).toLocaleString('en-US');
}

// ---------------------------------------------------------------- 标题识别

const VARIANT_SLUG = { promax: 'pro-max', pro: 'pro', plus: 'plus', mini: 'mini' };

function canonTitle(raw) {
  let s = ' ' + stripPrices(String(raw).normalize('NFKC').toLowerCase()) + ' ';
  s = s.replace(/(\d)\s*\+/g, '$1 plus ');
  s = s.replace(/[^0-9a-z가-힣.%]+/g, ' ');
  s = s.replace(/아이폰|아이퐁|i\s?phone|애플\s?폰/g, ' iphone ');
  s = s.replace(/프로\s*맥스|프맥|pro\s*max/g, ' promax ');
  s = s.replace(/프로/g, ' pro ').replace(/맥스/g, ' max ');
  s = s.replace(/플러스/g, ' plus ').replace(/미니/g, ' mini ').replace(/에어(?!팟)/g, ' air ');
  s = s.replace(/(\d)([a-z가-힣])/g, '$1 $2').replace(/([a-z가-힣])(\d)/g, '$1 $2');
  return s.replace(/\s+/g, ' ').trim();
}

function detectModelId(c, knownIds) {
  const has = (id) => knownIds.has(id);
  let m;

  // SE
  m = c.match(/\biphone se\s*(\d{1,4})?/) || c.match(/(?:^| )se ([23])\b/);
  if (m) {
    const n = m[1];
    if (n === '3' || n === '2022') return 'iphone-se-3';
    if (n === '2' || n === '2020') return 'iphone-se-2';
    return null;
  }

  // X 系列（必须带 iphone 前缀，单独的 x / xs 太容易误判）
  m = c.match(/\biphone (xs max|xs|xr|x)\b/);
  if (m) return `iphone-${m[1].replace(' ', '-')}`;

  // Air
  if (/\biphone (?:17 )?air\b/.test(c) || /(?:^| )17 air\b/.test(c)) return 'iphone-air';

  // 数字代：优先 "iphone 17 ..."，其次没写 iphone 但数字后面紧跟型号词（"17 promax 256"）
  m =
    c.match(/\biphone (\d{1,2})(?: (promax|pro|plus|mini|e))?\b/) ||
    c.match(/(?:^| )(1[1-9])(?: (promax|pro|plus|mini|e))\b/);
  if (!m) return null;
  const gen = m[1];
  const variant = m[2];
  let id = `iphone-${gen}`;
  if (variant === 'e') id += 'e';
  else if (variant) id += `-${VARIANT_SLUG[variant]}`;
  return has(id) ? id : null;
}

function detectStorages(c, model) {
  const found = [];
  // 单位后面不能紧跟字母，否则 "256 titanium" 的 t 会被当成 TB
  const re = /(?<![\d.])(\d{1,4})(?: ?(tb|t|테라|gb|g|기가)(?![a-z가-힣]))?(?![\d%])/g;
  let m;
  while ((m = re.exec(c))) {
    const n = Number(m[1]);
    const unit = m[2] || '';
    let st = null;
    if (/^(tb|t|테라)$/.test(unit)) st = n === 1 || n === 2 ? `${n}TB` : null;
    else if (GB_SIZES.includes(n)) st = `${n}GB`;
    if (st && !found.includes(st)) found.push(st);
  }
  if (model && model.storages) return found.filter((st) => model.storages.includes(st));
  return found;
}

/** 关键词出现且没有被"없음 / 무"否定 */
function hasUnnegated(text, re) {
  const g = new RegExp(re.source, 'g');
  let m;
  while ((m = g.exec(text))) {
    const before = text.slice(Math.max(0, m.index - 1), m.index);
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 10);
    const negated =
      before === '무' || /^\s*(?:은|는|이|가|도|및|등|전혀|하나도|일절|이력|흔적|현상|증상|문제|\s)*\s*(?:없|x(?![a-z])|無|no\b)/.test(after);
    if (!negated) return true;
    if (m[0].length === 0) g.lastIndex++;
  }
  return false;
}

const RE = {
  sealed: /미\s?개봉|새\s?상품|새\s?제품|미사용|unopened|sealed/,
  likeNew: /단순\s?개봉|개봉만/,
  wanted: /삽니다|삽니당|구합니다|구해요|구해봅니다|구매합니다|구매\s?원|매입|사봅니다/,
  exchange: /교환/,
  accessory: /케이스|필름|강화유리|충전기|케이블|어댑터|아답터|거치대|박스만|빈\s?박스|공박스|스트랩|그립톡|카드지갑|렌즈\s?보호|맥세이프/,
  otherProduct: /에어팟|airpods|아이패드|ipad|맥북|macbook|아이맥|imac|워치|watch|펜슬|갤럭시|galaxy|갤탭|플립|폴드|샤오미|xiaomi|홍미|redmi|픽셀|pixel/,
  defectScreen: /액정\s?(?:파손|깨|나감|불량|금|줄)|화면\s?(?:파손|깨|줄|멍)|깨진\s?액정|줄\s?감|백화|흑점|불량\s?화소/,
  defectFunc: /잔상|번인|고장|침수|부품용|불량(?!\s?화소)|작동\s?안|안\s?됨|안\s?돼|먹통|아이클라우드\s?잠|계정\s?잠/,
  damage: /파손|깨짐|깨진|금\s?감|금이|크랙|휨|휘었/,
  gradeClaim: /(?:^|[^a-z])([sabc])\s?급/,
  battery: /(?:배터리|밧데리|효율|성능)[^\d\n]{0,10}(\d{2,3})\s*(?:%|프로|퍼)?/,
};

/**
 * 识别一条标题（或标题+正文）。
 * 返回 { modelId, storage, storages, flags }；modelId 为 null 表示不是能识别的 iPhone。
 */
export function matchListing(title, knownIds) {
  const ids = knownIds || new Set(MODELS.map((m) => m.id));
  const raw = String(title || '').normalize('NFKC').toLowerCase();
  const c = canonTitle(title || '');
  // 标题里是别的产品、又没写 아이폰 / iPhone：不认（"갤럭시 S8 플러스" 不是 iPhone 8 Plus）
  const otherProduct = RE.otherProduct.test(raw) && !/아이폰|아이퐁|i\s?phone/.test(raw);
  const modelId = otherProduct ? null : detectModelId(c, ids);
  const model = modelId ? MODEL_BY_ID.get(modelId) || null : null;
  const storages = modelId ? detectStorages(c, model) : [];

  const batteryMatch = raw.match(RE.battery);
  const batteryNum = batteryMatch ? Number(batteryMatch[1]) : null;
  const claim = raw.match(RE.gradeClaim);

  const flags = {
    sealed: RE.sealed.test(raw),
    likeNew: RE.likeNew.test(raw),
    wanted: RE.wanted.test(raw),
    exchange: RE.exchange.test(raw),
    accessory: RE.accessory.test(raw),
    otherProduct,
    defectScreen: hasUnnegated(raw, RE.defectScreen),
    defectFunc: hasUnnegated(raw, RE.defectFunc),
    damage: hasUnnegated(raw, RE.damage),
    gradeClaim: claim ? claim[1].toUpperCase() : null,
    battery: batteryNum != null && batteryNum >= 50 && batteryNum <= 100 ? batteryNum : null,
  };

  return { modelId, storage: storages[0] || null, storages, flags };
}

// ---------------------------------------------------------------- 粘贴文本 → 商品列表

const PRICE_ONLY = /^(?:[\d,]+\s*원|\d+(?:\.\d+)?\s*만\s*(?:\d\s*천)?\s*원?|나눔)$/;
const META_LINE = /^(?:예약중|거래완료|판매완료|판매중|끌올.*|관심\s*\d+.*|채팅\s*\d+.*|조회\s*\d+.*|.{1,20}\s[·∙•]\s.{1,20}|\d+\s*(?:초|분|시간|일|주|개월|달)\s*전)$/;
const STATUS_RE = /예약중|거래완료|판매완료/;

/**
 * 把从二手平台复制出来的一大段文字拆成商品。
 * 支持两种形态：
 *   1) 标题一行、价格单独一行（从网页整页复制通常是这样）
 *   2) 标题和价格写在同一行（自己手打："아이폰 17 프로맥스 256 135만"）
 */
export function parseListingsText(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const used = new Array(lines.length).fill(false);
  const items = [];

  // 价格后面紧跟的地区 / 时间 / 状态行归这条商品；一遇到别的内容（下一条的标题）就停
  const attachMeta = (item, from) => {
    for (let j = from; j < Math.min(lines.length, from + 3); j++) {
      const status = lines[j].length <= 12 ? lines[j].match(STATUS_RE) : null;
      if (status) item.status = status[0];
      else if (!META_LINE.test(lines[j])) break;
      else if (!item.where) item.where = lines[j];
      used[j] = true;
    }
  };

  // 从价格行往上（step = -1）或往下（step = 1）找最近的标题行：最多看 3 行，跳过地区 / 状态行
  const findTitle = (i, step, respectUsed) => {
    for (let j = i + step, seen = 0; j >= 0 && j < lines.length && seen < 3; j += step, seen++) {
      if (PRICE_ONLY.test(lines[j]) || (respectUsed && used[j])) return -1;
      if (!META_LINE.test(lines[j])) return j;
    }
    return -1;
  };
  const recognizable = (j) => j >= 0 && Boolean(matchListing(lines[j]).modelId);

  // 整段文字只会是一种排版：标题在价格上面（常见），或价格在标题上面。
  // 数一数哪种排版下能认出机型的标题更多，就按哪种来；一样多按"标题在上"。
  const priceLines = lines.map((line, i) => (PRICE_ONLY.test(line) ? i : -1)).filter((i) => i >= 0);
  let above = 0;
  let below = 0;
  for (const i of priceLines) {
    if (recognizable(findTitle(i, -1, false))) above++;
    if (recognizable(findTitle(i, 1, false))) below++;
  }
  const step = below > above ? 1 : -1;

  for (const i of priceLines) {
    const titleIndex = findTitle(i, step, true);
    if (titleIndex < 0) continue;
    const item = { title: lines[titleIndex], price: parsePriceKRW(lines[i]), where: null, status: null };
    // 标题和价格之间夹着的行（"예약중" 等）
    for (let j = Math.min(i, titleIndex) + 1; j < Math.max(i, titleIndex); j++) {
      const status = lines[j].length <= 12 ? lines[j].match(STATUS_RE) : null;
      if (status) item.status = status[0];
      used[j] = true;
    }
    used[i] = true;
    used[titleIndex] = true;
    attachMeta(item, Math.max(i, titleIndex) + 1);
    items.push(item);
  }

  lines.forEach((line, i) => {
    if (used[i]) return;
    const price = parsePriceKRW(line);
    if (price == null) return;
    const title = stripPrices(line).replace(/\s+/g, ' ').trim();
    if (!title) return;
    used[i] = true;
    const status = line.match(STATUS_RE);
    items.push({ title, price, where: null, status: status ? status[0] : null });
  });

  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.title}|${item.price}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------- 收货判定

/** 收货上限价 = 回收价 − 目标利润 − 其他成本 */
export function maxBuyPrice(refPrice, settings) {
  if (refPrice == null) return null;
  return refPrice - (settings.targetProfit || 0) - (settings.extraCost || 0);
}

/**
 * 根据标题里的线索决定按哪个等级估价。
 * grades 是当前行情来源的等级列表，从好到差（["A","B","C","D","E"]）。
 * 只在有明确线索时偏离用户设定的默认等级；卖家自称的"S급/A급"不采信。
 */
export function pickGrade(flags, grades, defaultGrade) {
  const last = grades.length - 1;
  const base = Math.max(0, grades.indexOf(defaultGrade));
  const fiveStep = grades.length >= 5;
  const worst = (level) => Math.min(last, level);
  const reasons = [];
  let index = base;

  if (flags.defectScreen) {
    index = Math.max(index, fiveStep ? worst(4) : last);
    reasons.push('屏幕问题');
  } else if (flags.defectFunc || flags.damage) {
    index = Math.max(index, fiveStep ? worst(3) : last);
    reasons.push(flags.defectFunc ? '功能问题' : '外观破损');
  } else if (flags.battery != null && flags.battery < 80) {
    index = Math.max(index, fiveStep ? worst(2) : last);
    reasons.push(`电池 ${flags.battery}%`);
  } else if (flags.gradeClaim === 'C') {
    index = Math.max(index, fiveStep ? worst(2) : last);
    reasons.push('卖家自述 C급');
  } else if (flags.gradeClaim === 'B') {
    index = Math.max(index, worst(1));
    reasons.push('卖家自述 B급');
  } else if (flags.sealed) {
    index = 0;
    reasons.push('未拆封');
  }

  return { grade: grades[index], changed: index !== base, reasons };
}

/**
 * 判定一条商品值不值得收。
 * getPrices(modelId, storage) → { A: 1616000, B: ... } 或 null（当前行情来源）
 * listStorages(modelId) → 有行情的容量列表（从小到大）
 */
export function evaluateListing(listing, ctx) {
  const { getPrices, listStorages, grades, settings, knownIds } = ctx;
  const match = matchListing(listing.title, knownIds);
  const result = { ...listing, match, verdict: 'unknown', note: null };

  if (!match.modelId) {
    result.note = match.flags.otherProduct ? '不是 iPhone' : '没认出机型';
    return result;
  }
  if (match.flags.wanted) {
    result.verdict = 'skip';
    result.note = '求购帖';
    return result;
  }

  const available = listStorages(match.modelId);
  if (!available.length) {
    result.note = '该机型暂无行情';
    return result;
  }
  let storage = match.storage;
  let storageAssumed = false;
  if (!storage || !available.includes(storage)) {
    storage = available[0];
    storageAssumed = true;
  }
  const prices = getPrices(match.modelId, storage) || {};
  // 只报功能正常机器的来源（四级制）没有瑕疵机价格，不硬套
  const defective = match.flags.defectScreen || match.flags.defectFunc || match.flags.damage;
  if (defective && grades.length < 5) {
    result.verdict = 'skip';
    result.note = '瑕疵机，这个来源不报价';
    return result;
  }
  const picked = pickGrade(match.flags, grades, settings.grade);
  const ref = prices[picked.grade] ?? null;
  const lowest = Math.min(...Object.values(prices).filter((v) => typeof v === 'number'));

  Object.assign(result, {
    modelId: match.modelId,
    storage,
    storageAssumed,
    grade: picked.grade,
    gradeReasons: picked.reasons,
    ref,
    byGrade: grades.map((grade) => ({
      grade,
      ref: prices[grade] ?? null,
      profit: prices[grade] != null && listing.price != null ? prices[grade] - listing.price - (settings.extraCost || 0) : null,
    })),
  });

  if (listing.price == null || ref == null) {
    result.note = listing.price == null ? '没有价格' : '该等级暂无行情';
    return result;
  }
  // 带配件关键词且价格远低于最差等级的回收价：多半是壳 / 膜 / 充电器，不是整机
  if (match.flags.accessory && Number.isFinite(lowest) && listing.price < lowest * 0.5) {
    result.verdict = 'skip';
    result.note = '疑似配件';
    return result;
  }

  result.profit = ref - listing.price - (settings.extraCost || 0);
  result.maxBuy = maxBuyPrice(ref, settings);
  if (result.profit >= (settings.targetProfit || 0)) result.verdict = 'good';
  else if (result.profit >= 0) result.verdict = 'near';
  else result.verdict = 'over';
  // 低得反常：比最差等级的回收价还低一大截，提醒核实（诈骗 / 锁机 / 配件）
  if (Number.isFinite(lowest) && listing.price < lowest * 0.6) result.note = '价格低得反常，先核实';
  return result;
}

// ---------------------------------------------------------------- 去平台搜索的链接

/**
 * 生成去各平台搜索的链接。当根的 price / in 参数是按其网页版地址栏的写法拼的；
 * 平台改版后可能失效，届时只影响筛选条件，搜索词本身仍然有效。
 */
export function searchLinks(model, storage, maxPrice, region) {
  const size = storage ? storage.replace(/GB$/, '') : '';
  const keyword = `${model.ko} ${size}`.trim();
  const q = encodeURIComponent(keyword);
  let daangn = `https://www.daangn.com/kr/buy-sell/s/?search=${q}&only_on_sale=true`;
  if (maxPrice != null && maxPrice > 0) daangn += `&price=0__${Math.floor(maxPrice)}`;
  if (region) daangn += `&in=${encodeURIComponent(region)}`;
  return {
    keyword,
    daangn,
    bunjang: `https://m.bunjang.co.kr/search/products?q=${q}`,
    joongna: `https://web.joongna.com/search/${q}`,
  };
}

/** 从用户粘贴的当根网址（或直接的 "역삼동-6035"）里取出地区参数 */
export function extractDaangnRegion(input) {
  const text = String(input || '').trim();
  if (!text) return null;
  const m = text.match(/[?&]in=([^&#\s]+)/);
  let value = m ? m[1] : text;
  try {
    value = decodeURIComponent(value);
  } catch {
    /* 保留原样 */
  }
  value = value.trim();
  return /^[^\s?&#=/]{1,40}-\d{1,8}$/.test(value) ? value : null;
}
