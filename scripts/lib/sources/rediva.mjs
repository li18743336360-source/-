// 行情来源 2：리디바 Rediva（rediva.ai），韩国回收商。
// 公开的"매입 단가표"一页列出全部机型，等级为 A / A- / B+ / B。
//
// 抓取方式：只读 1 个页面。

import { parseTables, parseWon } from '../html.mjs';
import { normalizeStorage } from '../../../site/assets/core.js';

export const SOURCE = {
  id: 'rediva',
  name: 'Rediva',
  nameKo: '리디바',
  url: 'https://rediva.ai/price',
  grades: ['A', 'A-', 'B+', 'B'],
};

/** 单价表页 → { priceDate, entries: [{ slug, sourceName, storage, prices }] }（只保留 iPhone） */
export function parsePricePage(html) {
  const section = html.indexOf('price-table-heading');
  const scope = section >= 0 ? html.slice(section) : html;
  const dateMatch = scope.match(/<time[^>]*dateTime="(\d{4}-\d{2}-\d{2})"/i) || html.match(/<time[^>]*dateTime="(\d{4}-\d{2}-\d{2})"/i);
  const priceDate = dateMatch ? dateMatch[1] : null;

  const entries = [];
  for (const table of parseTables(html)) {
    const header = table.rows[0]?.cells || [];
    if (header[0] !== '모델' || header[1] !== '용량') continue;
    const grades = header.slice(2).map((cell) => cell.replace(/급$/, '').trim().toUpperCase());
    for (const row of table.rows.slice(1)) {
      const slugMatch = row.html.match(/href="\/price\/([a-z0-9-]+)"/);
      if (!slugMatch || !slugMatch[1].startsWith('iphone')) continue;
      const storage = normalizeStorage(row.cells[1]);
      if (!storage) continue;
      const prices = {};
      row.cells.slice(2).forEach((cell, i) => {
        const value = parseWon(cell);
        if (grades[i] && value != null) prices[grades[i]] = value;
      });
      if (Object.keys(prices).length) {
        entries.push({ slug: slugMatch[1], sourceName: row.cells[0], storage, prices });
      }
    }
  }
  return { priceDate, entries };
}

export async function fetchAll(get) {
  const page = parsePricePage(await get(SOURCE.url));
  if (page.entries.length < 40) {
    throw new Error(`只解析出 ${page.entries.length} 条 iPhone 行情，页面结构可能变了`);
  }
  return { priceDate: page.priceDate, entries: page.entries, warnings: [] };
}
