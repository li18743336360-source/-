// 礼貌抓取：如实标识自己、串行、限速、有限重试；对方说"慢一点"（429 / 503）时就慢下来。
// 只用来读行情站公开的价格页（两个站的 robots.txt 都允许）。

const USER_AGENT = 'Mozilla/5.0 (compatible; used-phone-price-monitor/1.0)';

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 造一个抓取函数。fetchImpl / sleepImpl / now 可替换，方便测试。
 *
 * get(url, { minIntervalMs, timeoutMs, retries }) → 网页文本
 *   - 两次请求之间至少间隔 minIntervalMs；
 *   - 429 / 503：按对方的 Retry-After 等待（至少 8 秒、16 秒…，最多 60 秒）后重试；
 *   - 其他失败：等 2 秒、4 秒…后重试；
 *   - 404：页面不存在，不重试，抛出的错误带 permanent = true。
 */
export function createGetter({ fetchImpl = fetch, sleepImpl = realSleep, now = Date.now } = {}) {
  let lastRequestAt = -Infinity;
  let requestCount = 0;

  async function get(url, { minIntervalMs = 1000, timeoutMs = 30000, retries = 2 } = {}) {
    let lastError;
    let backoff = 0;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const wait = Math.max(lastRequestAt + minIntervalMs - now(), backoff, 0);
      if (wait > 0) await sleepImpl(wait);
      lastRequestAt = now();
      requestCount++;
      try {
        const response = await fetchImpl(url, {
          headers: {
            'user-agent': USER_AGENT,
            accept: 'text/html,application/xhtml+xml',
            'accept-language': 'ko-KR,ko;q=0.9',
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (response.status === 404) {
          lastError = Object.assign(new Error('HTTP 404'), { permanent: true });
          break;
        }
        if (response.status === 429 || response.status === 503) {
          const retryAfter = Number(response.headers?.get?.('retry-after'));
          const asked = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 0;
          backoff = Math.min(Math.max(asked, 8000 * (attempt + 1)), 60000);
          lastError = new Error(`HTTP ${response.status}`);
          continue;
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.text();
      } catch (error) {
        lastError = error;
        backoff = 2000 * (attempt + 1);
      }
    }
    const reason = lastError?.cause?.code || lastError?.message || String(lastError);
    throw Object.assign(new Error(`抓取失败：${url}（${reason}）`), { permanent: Boolean(lastError?.permanent) });
  }

  get.requestCount = () => requestCount;
  return get;
}

export const politeGet = createGetter();

export function getRequestCount() {
  return politeGet.requestCount();
}
