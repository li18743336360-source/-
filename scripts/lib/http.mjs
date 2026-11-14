// 礼貌抓取：如实标识自己、串行、限速、有限重试。
// 只用来读行情站公开的价格页（两个站的 robots.txt 都允许）。

const USER_AGENT = 'Mozilla/5.0 (compatible; used-phone-price-monitor/1.0)';

let lastRequestAt = 0;
let requestCount = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function getRequestCount() {
  return requestCount;
}

/**
 * GET 一个网页，返回文本。
 * 两次请求之间至少间隔 minIntervalMs；失败按 2s、4s… 退避重试 retries 次。
 */
export async function politeGet(url, { minIntervalMs = 1000, timeoutMs = 30000, retries = 2 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const wait = lastRequestAt + minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    if (attempt > 0) await sleep(2000 * attempt);
    lastRequestAt = Date.now();
    requestCount++;
    try {
      const response = await fetch(url, {
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'ko-KR,ko;q=0.9',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status === 404) throw Object.assign(new Error(`HTTP 404 ${url}`), { permanent: true });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (error.permanent) break;
    }
  }
  const reason = lastError?.cause?.code || lastError?.message || String(lastError);
  throw new Error(`抓取失败：${url}（${reason}）`);
}
