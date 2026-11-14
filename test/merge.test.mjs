import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildDataset, normalizeEntries, kstDate, isMeaningfulChange } from '../scripts/lib/merge.mjs';
import { SOURCE as ST } from '../scripts/lib/sources/space-tradein.mjs';
import { SOURCE as RD } from '../scripts/lib/sources/rediva.mjs';

const stEntries = (overrides = {}) => [
  { sourceName: '아이폰17 Pro Max', storage: '256GB', prices: { A: 1320000, B: 1160000, ...overrides } },
  { sourceName: '아이폰17 Pro Max', storage: '512GB', prices: { A: 1490000, B: 1280000 } },
  { sourceName: '아이폰17 Pro Max 2T', storage: '2TB', prices: { A: 1690000, B: 1510000 } },
  { sourceName: '아이폰18 Pro Max', storage: '256GB', prices: { A: 1616000, B: 1416000 } },
];
const rdEntries = () => [
  { slug: 'iphone-17-pro-max', sourceName: 'iPhone 17 Pro Max', storage: '256GB', prices: { A: 1380000, 'A-': 1340000 } },
];
const at = (iso) => new Date(iso);

test('韩国时间的日期', () => {
  assert.equal(kstDate(at('2026-11-13T15:30:00Z')), '2026-11-14');
  assert.equal(kstDate(at('2026-11-14T14:59:00Z')), '2026-11-14');
});

test('归一：拆开的 2TB 并回原机型，不存在的配置丢弃，新机型自动收录', () => {
  const { rows, warnings } = normalizeEntries(ST, [
    ...stEntries(),
    { sourceName: '아이폰13 1T', storage: '1TB', prices: { A: 362000 } },
    { sourceName: '아이폰19 Pro', storage: '256GB', prices: { A: 2000000 } },
    { sourceName: '아이폰17 Pro Max', storage: '256GB', prices: { A: 1 } },
  ]);
  assert.deepEqual(rows.map((r) => `${r.model.id}|${r.storage}`), [
    'iphone-17-pro-max|256GB',
    'iphone-17-pro-max|512GB',
    'iphone-17-pro-max|2TB',
    'iphone-18-pro-max|256GB',
    'iphone-19pro|256GB',
  ]);
  assert.ok(warnings.some((w) => w.includes('忽略不存在的配置') && w.includes('아이폰13 1T')));
  assert.ok(warnings.some((w) => w.includes('目录外的新机型') && w.includes('아이폰19 Pro')));
  assert.ok(warnings.some((w) => w.includes('重复出现')));
});

test('合并两个来源；目录顺序；首日没有涨跌标记', () => {
  const { prices, history } = buildDataset({
    results: [
      { source: ST, ok: true, priceDate: '2026-11-10', entries: stEntries(), warnings: [] },
      { source: RD, ok: true, priceDate: '2026-11-10', entries: rdEntries(), warnings: [] },
    ],
    previous: null,
    history: null,
    now: at('2026-11-14T03:00:00Z'),
  });
  assert.equal(prices.day, '2026-11-14');
  assert.deepEqual(prices.models.map((m) => m.id), ['iphone-18-pro-max', 'iphone-17-pro-max']);
  const pm17 = prices.models[1];
  assert.deepEqual(pm17.storages.map((s) => s.storage), ['256GB', '512GB', '2TB']);
  assert.deepEqual(pm17.storages[0].prices, {
    'space-tradein': { A: 1320000, B: 1160000 },
    rediva: { A: 1380000, 'A-': 1340000 },
  });
  assert.equal(pm17.storages[0].change, undefined);
  assert.deepEqual(prices.sources.map((s) => [s.id, s.ok, s.entryCount, s.priceDate]), [
    ['space-tradein', true, 4, '2026-11-10'],
    ['rediva', true, 1, '2026-11-10'],
  ]);
  assert.deepEqual(history.points['space-tradein']['iphone-17-pro-max|256GB|A'], [['2026-11-14', 1320000]]);
});

test('调价后出现涨跌标记，超过 7 天后消失；没变不加点', () => {
  const run = (previous, history, now, overrides) =>
    buildDataset({
      results: [{ source: ST, ok: true, priceDate: '2026-11-10', entries: stEntries(overrides), warnings: [] }],
      previous,
      history,
      now: at(now),
    });
  const day1 = run(null, null, '2026-11-14T03:00:00Z');
  const day2 = run(day1.prices, day1.history, '2026-11-15T03:00:00Z');
  assert.equal(day2.history.points['space-tradein']['iphone-17-pro-max|256GB|A'].length, 1);
  assert.equal(day2.changedNow['space-tradein'], 0);
  // 自动更新据此决定要不要提交：同一天没调价 → 不提交；跨天或调价 → 提交
  const sameDay = run(day1.prices, day1.history, '2026-11-14T09:00:00Z');
  assert.notEqual(sameDay.prices.generatedAt, day1.prices.generatedAt);
  assert.equal(isMeaningfulChange(day1.prices, sameDay.prices), false);
  assert.deepEqual(sameDay.history, day1.history);
  // 经过"写文件再读回来"也一样（键顺序不受影响）
  assert.equal(isMeaningfulChange(JSON.parse(JSON.stringify(day1.prices)), sameDay.prices), false);
  assert.equal(isMeaningfulChange(day1.prices, day2.prices), true);
  assert.equal(isMeaningfulChange(null, day1.prices), true);
  const sameDayRepriced = run(day1.prices, day1.history, '2026-11-14T09:00:00Z', { A: 1310000 });
  assert.equal(isMeaningfulChange(day1.prices, sameDayRepriced.prices), true);

  const day3 = run(day2.prices, day2.history, '2026-11-16T03:00:00Z', { A: 1300000, B: 1170000 });
  const row = day3.prices.models.find((m) => m.id === 'iphone-17-pro-max').storages[0];
  assert.deepEqual(row.change, { 'space-tradein': { A: [-20000, '2026-11-16'], B: [10000, '2026-11-16'] } });
  assert.equal(day3.changedNow['space-tradein'], 2);
  assert.deepEqual(day3.history.points['space-tradein']['iphone-17-pro-max|256GB|A'], [
    ['2026-11-14', 1320000],
    ['2026-11-16', 1300000],
  ]);

  // 同一天再次抓取：价格没再变，标记仍在
  const day3b = run(day3.prices, day3.history, '2026-11-16T09:00:00Z', { A: 1300000, B: 1170000 });
  assert.deepEqual(day3b.prices.models.find((m) => m.id === 'iphone-17-pro-max').storages[0].change, row.change);

  // 同一天内又调回原价：等于没变
  const day3c = run(day3.prices, day3.history, '2026-11-16T12:00:00Z');
  assert.equal(day3c.prices.models.find((m) => m.id === 'iphone-17-pro-max').storages[0].change, undefined);
  assert.equal(day3c.history.points['space-tradein']['iphone-17-pro-max|256GB|A'].length, 1);

  // 8 天后：不再标记
  const later = run(day3.prices, day3.history, '2026-11-24T03:00:00Z', { A: 1300000, B: 1170000 });
  assert.equal(later.prices.models.find((m) => m.id === 'iphone-17-pro-max').storages[0].change, undefined);
});

test('某个来源抓取失败：沿用旧数据并标明', () => {
  const first = buildDataset({
    results: [
      { source: ST, ok: true, priceDate: '2026-11-10', entries: stEntries(), warnings: [] },
      { source: RD, ok: true, priceDate: '2026-11-10', entries: rdEntries(), warnings: [] },
    ],
    previous: null,
    history: null,
    now: at('2026-11-14T03:00:00Z'),
  });
  const second = buildDataset({
    results: [
      { source: ST, ok: false, error: 'HTTP 503', entries: [] },
      { source: RD, ok: true, priceDate: '2026-11-12', entries: rdEntries(), warnings: [] },
    ],
    previous: first.prices,
    history: first.history,
    now: at('2026-11-15T03:00:00Z'),
  });
  const st = second.prices.sources.find((s) => s.id === 'space-tradein');
  assert.equal(st.ok, false);
  assert.equal(st.error, 'HTTP 503');
  assert.equal(st.priceDate, '2026-11-10');
  assert.equal(st.fetchedAt, first.prices.sources[0].fetchedAt);
  assert.equal(st.entryCount, 4);
  const pm17 = second.prices.models.find((m) => m.id === 'iphone-17-pro-max');
  assert.deepEqual(pm17.storages[0].prices['space-tradein'], { A: 1320000, B: 1160000 });
  assert.ok(second.prices.warnings.some((w) => w.includes('沿用上一次的数据')));
  assert.equal(second.prices.sources.find((s) => s.id === 'rediva').priceDate, '2026-11-12');
});

test('--only 跳过的来源：沿用旧数据，不算失败', () => {
  const first = buildDataset({
    results: [
      { source: ST, ok: true, priceDate: '2026-11-10', entries: stEntries(), warnings: [] },
      { source: RD, ok: true, priceDate: '2026-11-10', entries: rdEntries(), warnings: [] },
    ],
    previous: null,
    history: null,
    now: at('2026-11-14T03:00:00Z'),
  });
  const second = buildDataset({
    results: [
      { source: ST, ok: false, skipped: true, entries: [] },
      { source: RD, ok: true, priceDate: '2026-11-10', entries: rdEntries(), warnings: [] },
    ],
    previous: first.prices,
    history: first.history,
    now: at('2026-11-14T05:00:00Z'),
  });
  const st = second.prices.sources.find((s) => s.id === 'space-tradein');
  assert.equal(st.ok, true);
  assert.equal(st.error, null);
  assert.equal(second.prices.warnings.length, 0);
  // 从没抓到过的来源被跳过：不出现在来源列表里
  const fresh = buildDataset({
    results: [
      { source: ST, ok: false, skipped: true, entries: [] },
      { source: RD, ok: true, priceDate: '2026-11-10', entries: rdEntries(), warnings: [] },
    ],
    previous: null,
    history: null,
    now: at('2026-11-14T05:00:00Z'),
  });
  assert.deepEqual(fresh.prices.sources.map((s) => s.id), ['rediva']);
});
