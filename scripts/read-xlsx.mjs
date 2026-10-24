/**
 * 把 .xlsx 读成纯文本表格（零依赖）。
 *
 * 【为什么要自己写？】
 * .xlsx 其实就是一个 zip，里面是几个 XML 文件：
 *   xl/sharedStrings.xml  所有字符串（单元格里存的是索引，不是文字）
 *   xl/worksheets/sheet1.xml  每个单元格的位置 + 内容
 * 为了不装第三方库（这个项目刻意保持零依赖），这里用 Node 内置的 zlib 解压，
 * 再用正则把 XML 抠出来。够用就好 —— 我们只读自己人填的表格，不做通用兼容。
 *
 * 用法：node scripts/read-xlsx.mjs <xlsx 路径> [工作表序号，默认 1]
 */

import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

/**
 * 极简 zip 解包：只支持"存储"和"deflate"两种方式。
 * zip 的目录在文件末尾（End of Central Directory），从那里往回找每个文件的本地头。
 */
function readZipEntries(buffer) {
  const entries = new Map();

  // 从末尾往前找 EOCD 签名 0x06054b50
  let eocd = buffer.length - 22;
  while (eocd >= 0 && buffer.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('这不是一个 zip/xlsx 文件（找不到目录结尾）');

  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);

  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);

    // 本地头里的长度字段可能和目录里不一致（有 extra 字段），所以从本地头重新读
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);

    entries.set(name, method === 0 ? raw : inflateRawSync(raw));
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function decodeXml(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

/** 解析 sharedStrings.xml -> 字符串数组 */
function readSharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  // 每个 <si> 是一格文字；里面可能被拆成多个 <t>（富文本），要拼起来
  for (const si of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    const texts = [...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]);
    out.push(decodeXml(texts.join('')));
  }
  return out;
}

/** "C12" -> { col: 2, row: 11 }（都是 0 起） */
function parseRef(ref) {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col: col - 1, row: Number(m[2]) - 1 };
}

function readSheet(xml, sharedStrings) {
  const rows = [];
  for (const rowMatch of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2] ?? '';
      const ref = /r="([A-Z]+\d+)"/.exec(attrs);
      const type = /t="([^"]+)"/.exec(attrs);
      if (!ref) continue;
      const pos = parseRef(ref[1]);
      if (!pos) continue;

      let value = '';
      if (type?.[1] === 'inlineStr') {
        value = decodeXml([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(body);
        const raw = v ? decodeXml(v[1]) : '';
        // t="s" 表示这一格存的是 sharedStrings 的下标
        value = type?.[1] === 's' ? (sharedStrings[Number(raw)] ?? '') : raw;
      }

      while (cells.length < pos.col) cells.push('');
      cells[pos.col] = value;
    }
    while (rows.length < rows.length) break;
    rows.push(cells);
  }
  return rows;
}

const path = process.argv[2];
if (!path) {
  console.error('用法：node scripts/read-xlsx.mjs <xlsx 路径>');
  process.exit(1);
}

const entries = readZipEntries(readFileSync(path));
const sharedStrings = readSharedStrings(entries.get('xl/sharedStrings.xml')?.toString('utf8'));

// 工作表清单（用来打印每张表的名字）
const workbook = entries.get('xl/workbook.xml')?.toString('utf8') ?? '';
const sheetNames = [...workbook.matchAll(/<sheet[^>]*name="([^"]*)"/g)].map((m) => decodeXml(m[1]));
console.log(`工作表：${sheetNames.join(' | ')}\n`);

const sheetKey = process.argv[3] ? `xl/worksheets/sheet${process.argv[3]}.xml` : 'xl/worksheets/sheet1.xml';
const sheetXml = entries.get(sheetKey)?.toString('utf8');
if (!sheetXml) throw new Error(`找不到 ${sheetKey}`);

for (const [index, row] of readSheet(sheetXml, sharedStrings).entries()) {
  if (row.every((c) => !c)) continue;
  console.log(`[${String(index + 1).padStart(2)}] ${row.join(' | ')}`);
}
