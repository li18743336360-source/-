import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createGetter } from '../scripts/lib/http.mjs';
import * as st from '../scripts/lib/sources/space-tradein.mjs';

/** 假的网络和时钟：responses 是按顺序返回的应答（数字 = 状态码，字符串 = 200 + 正文，Error = 网络错误） */
function harness(responses) {
  let clock = 0;
  const sleeps = [];
  const calls = [];
  const get = createGetter({
    now: () => clock,
    sleepImpl: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, at: clock, ua: options.headers['user-agent'] });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      if (typeof next === 'string') return { ok: true, status: 200, headers: new Map(), text: async () => next };
      const [status, retryAfter] = Array.isArray(next) ? next : [next];
      return { ok: false, status, headers: new Map(retryAfter ? [['retry-after', String(retryAfter)]] : []), text: async () => '' };
    },
  });
  return { get, sleeps, calls };
}

test('抓取：如实标识，两次请求之间保持间隔', async () => {
  const { get, calls } = harness(['a', 'b', 'c']);
  assert.equal(await get('https://x.test/1', { minIntervalMs: 2500 }), 'a');
  await get('https://x.test/2', { minIntervalMs: 2500 });
  await get('https://x.test/3', { minIntervalMs: 2500 });
  assert.deepEqual(calls.map((c) => c.at), [0, 2500, 5000]);
  assert.match(calls[0].ua, /used-phone-price-monitor/);
  assert.equal(get.requestCount(), 3);
});

test('抓取：503 时慢下来再试，成功即返回', async () => {
  const { get, calls } = harness([503, 503, 'ok']);
  assert.equal(await get('https://x.test/p', { minIntervalMs: 1000 }), 'ok');
  // 第一次重试前至少等 8 秒，第二次至少 16 秒
  assert.deepEqual(calls.map((c) => c.at), [0, 8000, 24000]);
});

test('抓取：听从对方的 Retry-After，但最多等 60 秒', async () => {
  const a = harness([[429, 30], 'ok']);
  await a.get('https://x.test/p');
  assert.deepEqual(a.calls.map((c) => c.at), [0, 30000]);
  const b = harness([[503, 600], 'ok']);
  await b.get('https://x.test/p');
  assert.deepEqual(b.calls.map((c) => c.at), [0, 60000]);
});

test('抓取：一直 503 就放弃，属于临时故障', async () => {
  const { get, calls } = harness([503, 503, 503]);
  await assert.rejects(get('https://x.test/p'), (error) => {
    assert.match(error.message, /抓取失败.*HTTP 503/);
    assert.equal(error.permanent, false);
    return true;
  });
  assert.equal(calls.length, 3);
});

test('抓取：404 不重试，标记为页面不存在', async () => {
  const { get, calls } = harness([404, 'never']);
  await assert.rejects(get('https://x.test/gone'), (error) => error.permanent === true);
  assert.equal(calls.length, 1);
});

test('抓取：网络错误和 500 短暂等待后重试', async () => {
  const { get, calls } = harness([new Error('socket hang up'), 500, 'ok']);
  assert.equal(await get('https://x.test/p', { minIntervalMs: 1000 }), 'ok');
  assert.deepEqual(calls.map((c) => c.at), [0, 2000, 6000]);
});

// ------------------------------------------------------------ space-tradein 整体流程

const names = Array.from({ length: 24 }, (_, i) => `아이폰${i + 1}`);
const listHtml = names
  .map(
    (name) =>
      `<a class="pr-card" data-maker="00002" data-name="${name}"\n href="/price/${encodeURIComponent(name)}">\n<div class="pr-card-maker">애플</div>\n<div class="pr-card-name">${name}</div></a>`,
  )
  .join('\n');
const pageHtml = (a) =>
  `<p>(시세 기준일 2026.11.10)</p><table class="pv-table"><thead><tr><th>등급</th><th>128G</th><th>256G</th><th>512G</th></tr></thead>` +
  `<tbody><tr><td>A급</td><td>${a}원</td><td>${a + 10000}원</td><td>${a + 20000}원</td></tr></tbody></table>`;

test('space-tradein：临时失败的页面最后再试一轮；仍失败的记入 failedNames，404 的不记', async () => {
  const attempts = new Map();
  const transient = () => Object.assign(new Error('抓取失败（HTTP 503）'), { permanent: false });
  const get = async (url, options) => {
    assert.equal(options.minIntervalMs, 2500, '这个站要放慢节奏');
    if (url === st.SOURCE.url) return listHtml;
    const name = decodeURIComponent(url.split('/price/')[1]);
    const n = (attempts.get(name) || 0) + 1;
    attempts.set(name, n);
    if (name === '아이폰3') throw transient(); // 两轮都失败
    if (name === '아이폰5' && n === 1) throw transient(); // 第二轮成功
    if (name === '아이폰7') throw Object.assign(new Error('抓取失败（HTTP 404）'), { permanent: true });
    return pageHtml(500000);
  };
  const result = await st.fetchAll(get);
  assert.deepEqual(result.failedNames, ['아이폰3']);
  assert.equal(result.priceDate, '2026-11-10');
  assert.equal(result.entries.length, 22 * 3);
  assert.ok(result.entries.some((e) => e.sourceName === '아이폰5'));
  assert.equal(attempts.get('아이폰3'), 2);
  assert.equal(attempts.get('아이폰7'), 1, '404 不再重试');
  assert.ok(result.warnings.some((w) => w.includes('아이폰3') && w.includes('本次没抓到')));
  assert.ok(result.warnings.some((w) => w.includes('아이폰7') && w.includes('已不存在')));
});

test('space-tradein：大面积失败时整体判为失败（由上层沿用全部旧数据）', async () => {
  const get = async (url) => {
    if (url === st.SOURCE.url) return listHtml;
    const index = Number(decodeURIComponent(url.split('/price/')[1]).replace('아이폰', ''));
    if (index > 6) throw Object.assign(new Error('抓取失败（HTTP 503）'), { permanent: false });
    return pageHtml(500000);
  };
  await assert.rejects(st.fetchAll(get), /只解析出 18 条行情（18 个机型页抓取失败）/);
});
