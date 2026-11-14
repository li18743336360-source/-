// 够用的小型 HTML 工具：两个行情站的价格表都是规整的服务端渲染表格，
// 用不着引入完整的 HTML 解析库。

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(text) {
  return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED[body.toLowerCase()] ?? whole;
  });
}

/** 去标签、解实体、去零宽字符、压空白 */
export function textOf(html) {
  return decodeEntities(String(html).replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, ' '))
    .replace(/[​-‍﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 取出页面里所有 <table>，每张表给出按行按格的文本，以及每行的原始 HTML
 * （有的表要从行里的链接取机型代号）。
 */
export function parseTables(html) {
  const tables = [];
  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let t;
  while ((t = tableRe.exec(html))) {
    const rows = [];
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let r;
    while ((r = rowRe.exec(t[1]))) {
      const cells = [];
      const cellRe = /<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi;
      let c;
      while ((c = cellRe.exec(r[1]))) cells.push(textOf(c[1]));
      rows.push({ cells, html: r[1] });
    }
    tables.push({ index: t.index, rows });
  }
  return tables;
}

/** "1,490,000원" → 1490000；"—" / 空 → null */
export function parseWon(text) {
  const digits = String(text).replace(/[^\d]/g, '');
  if (!digits) return null;
  const value = parseInt(digits, 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}
