import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeStorage,
  resolveSourceModel,
  makeAdHocModel,
  parsePriceKRW,
  formatWan,
  formatKRW,
  matchListing,
  parseListingsText,
  pickGrade,
  evaluateListing,
  maxBuyPrice,
  searchLinks,
  extractDaangnRegion,
} from '../site/assets/core.js';
import { MODELS, MODEL_BY_ID } from '../site/assets/catalog.js';

test('容量归一', () => {
  assert.equal(normalizeStorage('256G'), '256GB');
  assert.equal(normalizeStorage('256GB'), '256GB');
  assert.equal(normalizeStorage('1T'), '1TB');
  assert.equal(normalizeStorage('1TB'), '1TB');
  assert.equal(normalizeStorage('2T'), '2TB');
  assert.equal(normalizeStorage('1테라'), '1TB');
  assert.equal(normalizeStorage('128 기가'), '128GB');
  assert.equal(normalizeStorage('전 용량'), null);
  assert.equal(normalizeStorage('300'), null);
});

test('行情站机型名 → 目录机型', () => {
  const cases = {
    '아이폰18 Pro Max': ['iphone-18-pro-max', null],
    '아이폰17 Pro Max 2T': ['iphone-17-pro-max', '2TB'],
    '아이폰14 Pro Max 1TB': ['iphone-14-pro-max', '1TB'],
    '아이폰13 PRO MAX': ['iphone-13-pro-max', null],
    '아이폰13 MINI': ['iphone-13-mini', null],
    '아이폰17 Air': ['iphone-air', null],
    '아이폰17 Air 1T': ['iphone-air', '1TB'],
    '아이폰16e': ['iphone-16e', null],
    '아이폰SE3': ['iphone-se-3', null],
    '아이폰XS MAX': ['iphone-xs-max', null],
    '아이폰8Plus': ['iphone-8-plus', null],
    'iPhone SE (3세대)': ['iphone-se-3', null],
    'iPhone Air': ['iphone-air', null],
    'iPhone 13 mini': ['iphone-13-mini', null],
  };
  for (const [raw, [id, hint]] of Object.entries(cases)) {
    const r = resolveSourceModel(raw);
    assert.equal(r.model?.id, id, raw);
    assert.equal(r.storageHint, hint, raw);
  }
  assert.equal(resolveSourceModel('아이폰19 Pro').model, null);
});

test('目录外的新机型自动生成条目', () => {
  const m = makeAdHocModel('아이폰19 Pro');
  assert.equal(m.id, 'iphone-19pro');
  assert.equal(m.name, 'iPhone 19 Pro');
  assert.equal(m.series, '19');
  assert.equal(m.adHoc, true);
});

test('目录自检：id 唯一、搜索词齐全', () => {
  assert.equal(new Set(MODELS.map((m) => m.id)).size, MODELS.length);
  for (const m of MODELS) {
    assert.ok(m.ko.startsWith('아이폰'), m.id);
    assert.equal(resolveSourceModel(m.name).model?.id, m.id, m.name);
  }
});

test('价格解析', () => {
  assert.equal(parsePriceKRW('1,350,000원'), 1350000);
  assert.equal(parsePriceKRW('1350000원'), 1350000);
  assert.equal(parsePriceKRW('135만원'), 1350000);
  assert.equal(parsePriceKRW('135만'), 1350000);
  assert.equal(parsePriceKRW('135.5만원'), 1355000);
  assert.equal(parsePriceKRW('135만 5천원'), 1355000);
  assert.equal(parsePriceKRW('아이폰 17 프로맥스 256 135만'), 1350000);
  assert.equal(parsePriceKRW('1,350,000'), 1350000);
  assert.equal(parsePriceKRW('나눔'), 0);
  assert.equal(parsePriceKRW('아이폰 15 프로 256'), null);
  assert.equal(parsePriceKRW('배터리 87%'), null);
});

test('金额格式', () => {
  assert.equal(formatWan(1616000), '161.6');
  assert.equal(formatWan(1320000), '132');
  assert.equal(formatWan(20000), '2');
  assert.equal(formatWan(null), '—');
  assert.equal(formatKRW(1616000), '1,616,000');
});

test('标题识别：机型与容量', () => {
  const cases = [
    ['아이폰 18 프로맥스 256 미개봉', 'iphone-18-pro-max', '256GB'],
    ['아이폰18프로맥스 512기가 팝니다', 'iphone-18-pro-max', '512GB'],
    ['아이폰 18 프로 맥스 1TB 코스믹오렌지', 'iphone-18-pro-max', '1TB'],
    ['아이폰 18 프로 256GB 자급제', 'iphone-18-pro', '256GB'],
    ['iPhone 17 Pro Max 256GB 내추럴 티타늄', 'iphone-17-pro-max', '256GB'],
    ['아이폰17pro max 1테라 풀박스', 'iphone-17-pro-max', '1TB'],
    ['17프맥 512 급처', 'iphone-17-pro-max', '512GB'],
    ['아이폰 17 256 라벤더', 'iphone-17', '256GB'],
    ['아이폰 에어 256 스카이블루', 'iphone-air', '256GB'],
    ['아이폰 17 에어 512', 'iphone-air', '512GB'],
    ['아이폰 16e 128', 'iphone-16e', '128GB'],
    ['아이폰 16 플러스 128기가 핑크', 'iphone-16-plus', '128GB'],
    ['아이폰 15+ 256', 'iphone-15-plus', '256GB'],
    ['아이폰 13 미니 128 미드나이트', 'iphone-13-mini', '128GB'],
    ['아이폰 se3 64기가', 'iphone-se-3', '64GB'],
    ['아이폰 SE 2세대 128', 'iphone-se-2', '128GB'],
    ['아이폰 xs 맥스 256', 'iphone-xs-max', '256GB'],
    ['아이폰 XR 64 화이트', 'iphone-xr', '64GB'],
    ['[급처] 아이폰 15 프로 256 80만원', 'iphone-15-pro', '256GB'],
    ['아이폰 14 프로 팝니다 128기가 배터리 90프로', 'iphone-14-pro', '128GB'],
    ['아이폰 16 프로 1,256,000원 256', 'iphone-16-pro', '256GB'],
    ['아이폰 12 64', 'iphone-12', '64GB'],
    ['아이폰 16 프로맥스', 'iphone-16-pro-max', null],
  ];
  for (const [title, id, storage] of cases) {
    const r = matchListing(title);
    assert.equal(r.modelId, id, title);
    assert.equal(r.storage, storage, title);
  }
});

test('标题识别：不是 iPhone 的不乱认', () => {
  for (const title of [
    '에어팟 프로 2세대',
    '아이패드 프로 11 256',
    '아이패드 11 프로 256',
    '갤럭시 S25 울트라 256',
    '갤럭시 S8 플러스 64',
    '갤럭시탭 S8 플러스',
    '샤오미 13 프로 256',
    '맥북 프로 14 512',
    '8 플러스 64',
    '자전거 팝니다',
    '아이폰 17 플러스 256',
  ]) {
    assert.equal(matchListing(title).modelId, null, title);
  }
  // 标题里同时出现别的产品但写明了 아이폰：仍然是 iPhone
  assert.equal(matchListing('아이폰 17 프로 256 갤럭시와 교환').modelId, 'iphone-17-pro');
  // 单位后面紧跟字母时不能把字母当单位
  assert.equal(matchListing('아이폰 15 프로 256 titanium').storage, '256GB');
  assert.equal(matchListing('iPhone 16 Pro Max 1TB Titanium').storage, '1TB');
  assert.equal(matchListing('에어팟 프로 2세대').flags.otherProduct, true);
  // 不存在的容量不采信
  assert.equal(matchListing('아이폰 17 프로 128').storage, null);
});

test('标题识别：成色线索', () => {
  assert.equal(matchListing('아이폰 18 프로 256 미개봉 새상품').flags.sealed, true);
  assert.equal(matchListing('아이폰 17 프로 256 삽니다').flags.wanted, true);
  assert.equal(matchListing('아이폰 17 프로맥스 케이스').flags.accessory, true);
  assert.equal(matchListing('아이폰 16 프로 256 액정 파손').flags.defectScreen, true);
  assert.equal(matchListing('아이폰 16 프로 256 잔상 있음').flags.defectFunc, true);
  assert.equal(matchListing('아이폰 15 256 뒷판 깨짐').flags.damage, true);
  assert.equal(matchListing('아이폰 15 256 배터리 효율 78%').flags.battery, 78);
  assert.equal(matchListing('아이폰 15 256 배터리 100프로').flags.battery, 100);
  assert.equal(matchListing('아이폰 15 256 B급').flags.gradeClaim, 'B');
  assert.equal(matchListing('아이폰 15 256 S급').flags.gradeClaim, 'S');
});

test('标题识别：否定句不算瑕疵', () => {
  for (const title of [
    '아이폰 16 프로 256 파손 없음 잔상 없음',
    '아이폰 16 프로 256 액정 파손 없습니다',
    '아이폰 16 프로 256 무잔상 무파손',
    '아이폰 16 프로 256 고장 전혀 없어요',
    '아이폰 16 프로 256 잔상 x 파손 x',
    '아이폰 16 프로 256 침수 이력 없음',
    '아이폰 16 프로 256 불량화소 없음',
  ]) {
    const { flags } = matchListing(title);
    assert.equal(flags.defectScreen || flags.defectFunc || flags.damage, false, title);
  }
  // 一处否定、另一处是真的瑕疵
  assert.equal(matchListing('아이폰 16 프로 256 잔상 없음 뒷판 파손').flags.damage, true);
  assert.equal(matchListing('아이폰 16 프로 256 잔상 있고 기스 없음').flags.defectFunc, true);
  assert.equal(matchListing('아이폰 16 프로 256 불량화소 있음').flags.defectScreen, true);
});

test('粘贴文本：标题一行 + 价格一行', () => {
  const items = parseListingsText(`
    아이폰 18 프로맥스 256 미개봉
    1,550,000원
    역삼동 · 3분 전

    아이폰 17 프로 256 내추럴
    예약중
    980,000원
    서초동 · 끌올 1시간 전
    관심 3 · 채팅 2

    갤럭시 S25 울트라
    900,000원
    논현동 · 1일 전
  `);
  assert.equal(items.length, 3);
  assert.deepEqual(items[0], { title: '아이폰 18 프로맥스 256 미개봉', price: 1550000, where: '역삼동 · 3분 전', status: null });
  assert.equal(items[1].title, '아이폰 17 프로 256 내추럴');
  assert.equal(items[1].price, 980000);
  assert.equal(items[1].status, '예약중');
  assert.equal(items[1].where, '서초동 · 끌올 1시간 전');
  assert.equal(items[2].price, 900000);
});

test('粘贴文本：价格不会被配到别的商品上', () => {
  // 标题在上、没有地区行、iPhone 夹在别的商品中间
  const plain = parseListingsText('갤럭시 S25 울트라\n900,000원\n아이폰 17 프로 256\n980,000원\n갤럭시 A35\n200,000원');
  assert.deepEqual(plain.map((i) => [i.title, i.price]), [
    ['갤럭시 S25 울트라', 900000],
    ['아이폰 17 프로 256', 980000],
    ['갤럭시 A35', 200000],
  ]);
  // 价格在标题上面的排版
  const flipped = parseListingsText('900,000원\n갤럭시 S25 울트라\n논현동 · 1일 전\n980,000원\n아이폰 17 프로 256\n서초동 · 2분 전\n1,550,000원\n아이폰 18 프로맥스 256');
  assert.deepEqual(flipped.map((i) => [i.title, i.price, i.where]), [
    ['갤럭시 S25 울트라', 900000, '논현동 · 1일 전'],
    ['아이폰 17 프로 256', 980000, '서초동 · 2분 전'],
    ['아이폰 18 프로맥스 256', 1550000, null],
  ]);
  // 一条商品两行价格（原价 / 现价）：不把第二个价格配给别人
  const twoPrices = parseListingsText('아이폰 17 프로 256\n1,000,000원\n980,000원\n아이폰 18 프로 256\n1,300,000원');
  assert.deepEqual(twoPrices.map((i) => [i.title, i.price]), [
    ['아이폰 17 프로 256', 1000000],
    ['아이폰 18 프로 256', 1300000],
  ]);
});

test('粘贴文本：标题和价格同一行，去重', () => {
  const items = parseListingsText('아이폰 17 프로맥스 256 135만\n아이폰 16 프로 128 70만원 급처\n아이폰 17 프로맥스 256 135만\n그냥 메모');
  assert.equal(items.length, 2);
  assert.equal(items[0].price, 1350000);
  assert.equal(items[0].title, '아이폰 17 프로맥스 256');
  assert.equal(items[1].title, '아이폰 16 프로 128 급처');
  assert.equal(items[1].price, 700000);
});

test('估价等级：只在有线索时偏离默认等级', () => {
  const five = ['A', 'B', 'C', 'D', 'E'];
  const none = matchListing('아이폰 17 프로 256').flags;
  assert.deepEqual(pickGrade(none, five, 'B'), { grade: 'B', changed: false, reasons: [] });
  assert.equal(pickGrade(matchListing('아이폰 17 프로 256 미개봉').flags, five, 'B').grade, 'A');
  assert.equal(pickGrade(matchListing('아이폰 17 프로 256 액정 깨짐').flags, five, 'B').grade, 'E');
  assert.equal(pickGrade(matchListing('아이폰 17 프로 256 잔상 있어요').flags, five, 'B').grade, 'D');
  assert.equal(pickGrade(matchListing('아이폰 17 프로 256 배터리 75%').flags, five, 'A').grade, 'C');
  assert.equal(pickGrade(matchListing('아이폰 17 프로 256 B급').flags, five, 'A').grade, 'B');
  // 卖家自称 S급 不采信；默认等级本来就更差时不往好里改
  assert.equal(pickGrade(matchListing('아이폰 17 프로 256 S급').flags, five, 'B').grade, 'B');
  assert.equal(pickGrade(matchListing('아이폰 17 프로 256 B급').flags, five, 'D').grade, 'D');
  // 四级制来源：瑕疵落到最差一级
  const four = ['A', 'A-', 'B+', 'B'];
  assert.equal(pickGrade(matchListing('아이폰 17 프로 256 액정 파손').flags, four, 'A-').grade, 'B');
  assert.equal(pickGrade(none, four, 'B+').grade, 'B+');
});

const PRICES = {
  'iphone-17-pro-max': {
    '256GB': { A: 1320000, B: 1160000, C: 1095000, D: 1045000, E: 700000 },
    '512GB': { A: 1490000, B: 1280000, C: 1165000, D: 1115000, E: 766000 },
  },
};
const ctx = (settings) => ({
  grades: ['A', 'B', 'C', 'D', 'E'],
  getPrices: (id, storage) => PRICES[id]?.[storage] || null,
  listStorages: (id) => Object.keys(PRICES[id] || {}),
  settings: { grade: 'B', targetProfit: 100000, extraCost: 0, ...settings },
});

test('收货判定：值得收 / 接近 / 偏贵', () => {
  const good = evaluateListing({ title: '아이폰 17 프로맥스 256', price: 1000000 }, ctx());
  assert.equal(good.verdict, 'good');
  assert.equal(good.grade, 'B');
  assert.equal(good.ref, 1160000);
  assert.equal(good.profit, 160000);
  assert.equal(good.maxBuy, 1060000);

  const near = evaluateListing({ title: '아이폰 17 프로맥스 256', price: 1100000 }, ctx());
  assert.equal(near.verdict, 'near');
  assert.equal(near.profit, 60000);

  const over = evaluateListing({ title: '아이폰 17 프로맥스 256', price: 1400000 }, ctx());
  assert.equal(over.verdict, 'over');
  assert.equal(over.profit, -240000);
  assert.deepEqual(over.byGrade.map((g) => g.profit), [-80000, -240000, -305000, -355000, -700000]);
});

test('收货判定：其他成本计入、容量缺失按最小容量、瑕疵自动降级', () => {
  const withCost = evaluateListing({ title: '아이폰 17 프로맥스 512', price: 1100000 }, ctx({ extraCost: 30000 }));
  assert.equal(withCost.profit, 1280000 - 1100000 - 30000);
  assert.equal(withCost.verdict, 'good');

  const noStorage = evaluateListing({ title: '아이폰 17 프로맥스 급처', price: 1000000 }, ctx());
  assert.equal(noStorage.storage, '256GB');
  assert.equal(noStorage.storageAssumed, true);

  const broken = evaluateListing({ title: '아이폰 17 프로맥스 256 액정 파손', price: 650000 }, ctx());
  assert.equal(broken.grade, 'E');
  assert.equal(broken.ref, 700000);
  assert.equal(broken.verdict, 'near');
  assert.deepEqual(broken.gradeReasons, ['屏幕问题']);

  const sealed = evaluateListing({ title: '아이폰 17 프로맥스 256 미개봉', price: 1200000 }, ctx());
  assert.equal(sealed.grade, 'A');
  assert.equal(sealed.verdict, 'good');
});

test('收货判定：求购帖、配件、认不出的不参与', () => {
  assert.equal(evaluateListing({ title: '아이폰 17 프로맥스 256 삽니다', price: 1000000 }, ctx()).verdict, 'skip');
  const acc = evaluateListing({ title: '아이폰 17 프로맥스 케이스', price: 15000 }, ctx());
  assert.equal(acc.verdict, 'skip');
  assert.equal(acc.note, '疑似配件');
  // 送壳的整机不能被当成配件
  assert.equal(evaluateListing({ title: '아이폰 17 프로맥스 256 케이스 포함', price: 1000000 }, ctx()).verdict, 'good');
  const unknown = evaluateListing({ title: '자전거 팝니다', price: 100000 }, ctx());
  assert.equal(unknown.verdict, 'unknown');
  assert.equal(unknown.note, '没认出机型');
  assert.equal(evaluateListing({ title: '아이폰 15 256', price: 500000 }, ctx()).note, '该机型暂无行情');
  // 低得反常要提醒
  assert.equal(evaluateListing({ title: '아이폰 17 프로맥스 256', price: 300000 }, ctx()).note, '价格低得反常，先核实');
});

test('收货判定：只报正常机的来源遇到瑕疵机不硬套价格', () => {
  const four = {
    grades: ['A', 'A-', 'B+', 'B'],
    getPrices: () => ({ A: 1380000, 'A-': 1340000, 'B+': 1300000, B: 1190000 }),
    listStorages: () => ['256GB'],
    settings: { grade: 'B+', targetProfit: 100000, extraCost: 0 },
  };
  const broken = evaluateListing({ title: '아이폰 17 프로맥스 256 액정 파손', price: 600000 }, four);
  assert.equal(broken.verdict, 'skip');
  assert.equal(broken.note, '瑕疵机，这个来源不报价');
  const fine = evaluateListing({ title: '아이폰 17 프로맥스 256 파손 없음', price: 1150000 }, four);
  assert.equal(fine.verdict, 'good');
  assert.equal(fine.grade, 'B+');
  assert.equal(fine.profit, 150000);
});

test('收货上限价', () => {
  assert.equal(maxBuyPrice(1160000, { targetProfit: 100000, extraCost: 20000 }), 1040000);
  assert.equal(maxBuyPrice(null, { targetProfit: 100000 }), null);
});

test('搜索链接', () => {
  const model = MODEL_BY_ID.get('iphone-18-pro-max');
  const links = searchLinks(model, '256GB', 1316000, null);
  assert.equal(links.keyword, '아이폰 18 프로맥스 256');
  assert.equal(
    links.daangn,
    `https://www.daangn.com/kr/buy-sell/s/?search=${encodeURIComponent('아이폰 18 프로맥스 256')}&only_on_sale=true&price=0__1316000`,
  );
  assert.ok(links.bunjang.startsWith('https://m.bunjang.co.kr/search/products?q='));
  assert.ok(links.joongna.startsWith('https://web.joongna.com/search/'));
  const withRegion = searchLinks(model, '1TB', null, '역삼동-6035');
  assert.ok(withRegion.daangn.endsWith(`&in=${encodeURIComponent('역삼동-6035')}`));
  assert.ok(!withRegion.daangn.includes('price='));
  assert.equal(withRegion.keyword, '아이폰 18 프로맥스 1TB');
});

test('从当根网址里取地区', () => {
  assert.equal(extractDaangnRegion('https://www.daangn.com/kr/buy-sell/s/?in=%EC%97%AD%EC%82%BC%EB%8F%99-6035&search=x'), '역삼동-6035');
  assert.equal(extractDaangnRegion('https://www.daangn.com/kr/buy-sell/?in=역삼동-6035'), '역삼동-6035');
  assert.equal(extractDaangnRegion('역삼동-6035'), '역삼동-6035');
  assert.equal(extractDaangnRegion('https://www.daangn.com/kr/buy-sell/s/?search=x'), null);
  assert.equal(extractDaangnRegion('随便写的'), null);
  assert.equal(extractDaangnRegion(''), null);
});
