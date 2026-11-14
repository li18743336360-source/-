#!/usr/bin/env node
// 把网页打成"单文件版"：样式和脚本内联进一个 HTML，数据文件照原路径放在旁边。
// 用于发布到 Claude Artifact 预览（它要求页面不带 <html>/<head>/<body> 外壳、
// 除白名单 CDN 外不引用外部脚本）。GitHub Pages 用不到这个脚本，直接发布 site/ 即可。
//
// 用法：node scripts/build-artifact.mjs [输出目录]   （默认 dist/artifact）

import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, 'site');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'dist', 'artifact'));

const read = (file) => readFile(path.join(SITE, file), 'utf8');

/** 去掉 import 语句和 export 关键字，让几个模块可以首尾相接放进同一个 <script type="module"> */
function inlineModule(source) {
  return source
    .replace(/^import\s[\s\S]*?from\s+['"][^'"]+['"];?[ \t]*$/gm, '')
    .replace(/^export\s+(?=(?:const|let|var|function|class|async)\b)/gm, '');
}

const html = await read('index.html');
const css = await read('assets/styles.css');
const modules = ['assets/catalog.js', 'assets/core.js', 'assets/app.js'];
const script = (await Promise.all(modules.map(read))).map(inlineModule).join('\n');

const pick = (re, what) => {
  const m = html.match(re);
  if (!m) throw new Error(`index.html 里没找到 ${what}`);
  return m[0];
};
const title = pick(/<title>[\s\S]*?<\/title>/, '<title>');
const sidesMeta = pick(/<meta name="claude:viewport-fit-sides"[^>]*>/, 'viewport-fit-sides 标记');
const fontLink = pick(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/, '字体链接');
const body = pick(/<body>[\s\S]*<\/body>/, '<body>')
  .replace(/^<body>|<\/body>$/g, '')
  .replace(/<script type="module" src="assets\/app\.js"><\/script>/, () => `<script type="module">\n${script}\n</script>`);

if (body.includes('src="assets/')) throw new Error('还有没内联的脚本引用');
if (/^\s*(import|export)\s/m.test(script)) throw new Error('脚本里还残留 import / export');

const page = [title, sidesMeta, fontLink, `<style>\n${css}</style>`, body.trim(), ''].join('\n');

await mkdir(path.join(OUT, 'data'), { recursive: true });
await writeFile(path.join(OUT, 'index.html'), page);
for (const file of ['prices.json', 'history.json']) {
  await copyFile(path.join(SITE, 'data', file), path.join(OUT, 'data', file));
}
console.log(`已生成 ${path.relative(ROOT, OUT)}/index.html（${(page.length / 1024).toFixed(0)} KB）和 data/*.json`);
