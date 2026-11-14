// 行情来源 1：스페이스 트레이드인（space-tradein.co.kr），韩国回收商。
// 公开的"기종별 시세표"按 A / B / C / D / E 五个等级、分容量给出回收价。
//
// 抓取方式：先读机型列表页，再逐个读苹果机型的价格页（每秒 1 次，约 55 次请求）。

import { parseTables, parseWon, textOf } from '../html.mjs';
import { normalizeStorage } from '../../../site/assets/core.js';

export const SOURCE = {
  id: 'space-tradein',
  name: 'Space Trade-in',
  nameKo: '스페이스 트레이드인',
  url: 'https://space-tradein.co.kr/sub/price_list.php',
  grades: ['A', 'B', 'C', 'D', 'E'],
};

const ORIGIN = 'https://space-tradein.co.kr';
const APPLE_MAKER = '애플';

/** 机型列表页 → [{ maker, name, href }] */
export function parseModelList(html) {
  const cards = [];
  const re =
    /<a class="pr-card"[^>]*?href="([^"]+)"[^>]*>\s*<div class="pr-card-maker">([^<]*)<\/div>\s*<div class="pr-card-name">([^<]*)<\/div>/g;
  let m;
  while ((m = re.exec(html))) {
    cards.push({ href: m[1].trim(), maker: textOf(m[2]), name: textOf(m[3]) });
  }
  return cards;
}

/** "시세 기준일 2026.11.10" → "2026-11-10" */
export function parsePriceDate(html) {
  const m = html.match(/시세\s*기준일\s*(\d{4})\.(\d{1,2})\.(\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

/**
 * 单个机型价格页 → { priceDate, rows: [{ storage, prices: { A: 1320000, ... } }] }
 * 表头是容量（256G / 512G / 1T），每行一个等级（A급 … E급）。
 */
export function parseModelPage(html) {
  const priceDate = parsePriceDate(html);
  const table = parseTables(html).find((t) => t.rows.length > 1 && /등급/.test(t.rows[0].cells[0] || ''));
  if (!table) return { priceDate, rows: [] };

  const storages = table.rows[0].cells.slice(1).map((cell) => normalizeStorage(cell));
  const byStorage = storages.map((storage) => ({ storage, prices: {} }));
  for (const row of table.rows.slice(1)) {
    const grade = (row.cells[0] || '').replace(/급$/, '').trim().toUpperCase();
    if (!grade) continue;
    row.cells.slice(1).forEach((cell, i) => {
      const value = parseWon(cell);
      if (byStorage[i] && value != null) byStorage[i].prices[grade] = value;
    });
  }
  return { priceDate, rows: byStorage.filter((r) => r.storage && Object.keys(r.prices).length) };
}

/**
 * 抓取全部苹果机型。
 * 返回 { priceDate, entries: [{ sourceName, storage, prices }], warnings }
 */
export async function fetchAll(get, log = () => {}) {
  const listHtml = await get(SOURCE.url);
  const cards = parseModelList(listHtml).filter((card) => card.maker === APPLE_MAKER);
  if (cards.length < 20) {
    throw new Error(`机型列表只解析出 ${cards.length} 个苹果机型，页面结构可能变了`);
  }

  const entries = [];
  const warnings = [];
  const dates = new Map();
  for (const card of cards) {
    try {
      const page = parseModelPage(await get(ORIGIN + card.href));
      if (!page.rows.length) {
        warnings.push(`${SOURCE.name}：${card.name} 页面没有解析出价格表`);
        continue;
      }
      if (page.priceDate) dates.set(page.priceDate, (dates.get(page.priceDate) || 0) + 1);
      for (const row of page.rows) {
        entries.push({ sourceName: card.name, storage: row.storage, prices: row.prices });
      }
      log(`  ${card.name}: ${page.rows.map((r) => r.storage).join(' / ')}`);
    } catch (error) {
      warnings.push(`${SOURCE.name}：${card.name} 抓取失败（${error.message}）`);
    }
  }

  if (entries.length < 60) {
    throw new Error(`只解析出 ${entries.length} 条行情，页面结构可能变了`);
  }
  // 各页的基准日通常一致；不一致时取出现最多的那个
  const priceDate = [...dates.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || parsePriceDate(listHtml);
  return { priceDate, entries, warnings };
}
