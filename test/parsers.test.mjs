import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as st from '../scripts/lib/sources/space-tradein.mjs';
import * as rediva from '../scripts/lib/sources/rediva.mjs';
import { decodeEntities, textOf, parseWon } from '../scripts/lib/html.mjs';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('html 工具：实体、零宽字符、金额', () => {
  assert.equal(decodeEntities('a&amp;b&#39;c&#x41;&nbsp;d'), "a&b'cA d");
  assert.equal(textOf('<b style="x">​1,490,000원</b>  <i>ok</i>'), '1,490,000원 ok');
  assert.equal(parseWon('1,490,000원'), 1490000);
  assert.equal(parseWon('—'), null);
  assert.equal(parseWon(''), null);
});

test('space-tradein：机型列表', () => {
  const cards = st.parseModelList(fixture('space-tradein-list.html'));
  assert.equal(cards.length, 10);
  const apple = cards.filter((c) => c.maker === '애플');
  assert.equal(apple.length, 8);
  assert.deepEqual(apple[0], {
    href: '/price/%EC%95%84%EC%9D%B4%ED%8F%B018-Pro-Max',
    maker: '애플',
    name: '아이폰18 Pro Max',
  });
  assert.ok(cards.some((c) => c.maker === '삼성'));
  assert.ok(cards.some((c) => c.maker === 'LG'));
  assert.equal(st.parsePriceDate(fixture('space-tradein-list.html')), '2026-11-10');
});

test('space-tradein：机型价格页（两个容量）', () => {
  const page = st.parseModelPage(fixture('space-tradein-17-pro-max.html'));
  assert.equal(page.priceDate, '2026-11-10');
  assert.deepEqual(page.rows, [
    { storage: '256GB', prices: { A: 1320000, B: 1160000, C: 1095000, D: 1045000, E: 700000 } },
    { storage: '512GB', prices: { A: 1490000, B: 1280000, C: 1165000, D: 1115000, E: 766000 } },
  ]);
});

test('space-tradein：单独成页的 2TB', () => {
  const page = st.parseModelPage(fixture('space-tradein-17-pro-max-2t.html'));
  assert.deepEqual(page.rows, [
    { storage: '2TB', prices: { A: 1690000, B: 1510000, C: 1215000, D: 1175000, E: 776000 } },
  ]);
});

test('space-tradein：四个容量的 iPhone 18 Pro Max', () => {
  const page = st.parseModelPage(fixture('space-tradein-18-pro-max.html'));
  assert.deepEqual(page.rows.map((r) => r.storage), ['256GB', '512GB', '1TB', '2TB']);
  assert.equal(page.rows[0].prices.A, 1616000);
  assert.equal(page.rows[3].prices.E, 1016000);
});

test('space-tradein：页面没有价格表时返回空', () => {
  assert.deepEqual(st.parseModelPage('<main><h1>점검중</h1></main>').rows, []);
});

test('rediva：单价表只取 iPhone，且带基准日', () => {
  const page = rediva.parsePricePage(fixture('rediva-price.html'));
  assert.equal(page.priceDate, '2026-11-10');
  assert.ok(page.entries.length > 10);
  assert.ok(page.entries.every((e) => e.slug.startsWith('iphone')));
  assert.deepEqual(page.entries[0], {
    slug: 'iphone-17-pro-max',
    sourceName: 'iPhone 17 Pro Max',
    storage: '256GB',
    prices: { A: 1380000, 'A-': 1340000, 'B+': 1300000, B: 1190000 },
  });
  const se3 = page.entries.find((e) => e.slug === 'iphone-se-3');
  assert.ok(se3, '应包含 iPhone SE (3세대)');
});
