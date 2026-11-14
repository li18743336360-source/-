#!/usr/bin/env node
// 抓取当日苹果二手行情 → site/data/prices.json + site/data/history.json
//
// 用法：
//   node scripts/fetch-prices.mjs            抓取全部来源
//   node scripts/fetch-prices.mjs --only rediva
//   node scripts/fetch-prices.mjs --dry-run  只抓取并打印结果，不写文件
//
// 任何一个来源抓取失败时沿用它上一次的数据；全部失败则不改动数据文件并以非 0 退出。

import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { politeGet, getRequestCount } from './lib/http.mjs';
import { buildDataset, isMeaningfulChange } from './lib/merge.mjs';
import * as spaceTradein from './lib/sources/space-tradein.mjs';
import * as rediva from './lib/sources/rediva.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'site', 'data');
const ALL_SOURCES = [spaceTradein, rediva];

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const verbose = args.includes('--verbose');
const onlyIndex = args.indexOf('--only');
const only = onlyIndex >= 0 ? args[onlyIndex + 1] : null;

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function main() {
  const previous = await readJson(path.join(DATA_DIR, 'prices.json'));
  const history = await readJson(path.join(DATA_DIR, 'history.json'));

  const results = [];
  for (const mod of ALL_SOURCES) {
    const source = mod.SOURCE;
    if (only && only !== source.id) {
      // 没轮到的来源：沿用旧数据，不算失败
      results.push({ source, ok: false, skipped: true, entries: [] });
      continue;
    }
    console.log(`→ ${source.name}（${source.url}）`);
    try {
      const fetched = await mod.fetchAll(politeGet, verbose ? console.log : undefined);
      console.log(`  成功：${fetched.entries.length} 条，行情基准日 ${fetched.priceDate || '未知'}`);
      results.push({ source, ok: true, ...fetched });
    } catch (error) {
      console.error(`  失败：${error.message}`);
      results.push({ source, ok: false, error: error.message, entries: [] });
    }
  }

  if (!results.some((r) => r.ok)) {
    console.error('所有来源都抓取失败，数据文件保持不变。');
    process.exit(1);
  }

  const { prices, history: nextHistory, changedNow } = buildDataset({ results, previous, history });

  const storageCount = prices.models.reduce((n, m) => n + m.storages.length, 0);
  console.log(`\n共 ${prices.models.length} 个机型、${storageCount} 个容量配置；请求 ${getRequestCount()} 次。`);
  for (const source of prices.sources) {
    console.log(`  ${source.name}: ${source.ok ? '正常' : '沿用旧数据'}，${source.entryCount} 条，基准日 ${source.priceDate || '未知'}，本次发现调价 ${changedNow[source.id] ?? 0} 项`);
  }
  if (prices.warnings.length) {
    console.log('\n提示：');
    for (const warning of prices.warnings) console.log(`  - ${warning}`);
  }

  if (dryRun) {
    console.log('\n（--dry-run：未写文件）');
    return;
  }
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(path.join(DATA_DIR, 'prices.json'), JSON.stringify(prices, null, 1) + '\n');
  await writeFile(path.join(DATA_DIR, 'history.json'), JSON.stringify(nextHistory) + '\n');
  console.log(`\n已写入 ${path.relative(ROOT, DATA_DIR)}/prices.json 和 history.json`);

  // 告诉 GitHub Actions 这次要不要提交（只有抓取时间变了就不提交）
  const changed = isMeaningfulChange(previous, prices);
  console.log(changed ? '数据有变化（或今天第一次抓取）。' : '除抓取时间外没有变化。');
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
