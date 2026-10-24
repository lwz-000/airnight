/**
 * 临时工具：把用户填的技能表整张 dump 成文本，方便逐行看。
 * （看完就删，不是项目的一部分）
 */
import { writeFileSync } from 'node:fs';
import { readXlsx } from './xlsx-read.mjs';

const path = process.argv[2] ?? 'docs/技能表-用户.xlsx';
const { sheets, data } = readXlsx(path);

const out = [];
out.push(`工作表：${sheets.join(' | ')}`);
for (const name of sheets) {
  const rows = data[name] ?? [];
  out.push('');
  out.push(`================ ${name} （${rows.length} 行）================`);
  rows.forEach((row, i) => {
    const cells = row.map((c) => String(c ?? '').replace(/\s*\n\s*/g, ' ⏎ '));
    // 去掉尾部空格子
    while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
    out.push(`[${String(i + 1).padStart(3)}] ${cells.join(' | ')}`);
  });
}

writeFileSync('docs/_skills-dump.txt', out.join('\n'), 'utf8');
console.log(`写了 docs/_skills-dump.txt，${out.length} 行`);
