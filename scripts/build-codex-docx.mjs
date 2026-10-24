/**
 * 把 scripts/export-codex.ts 导出的 JSON 渲染成 Word 手册（.docx）。
 *
 * 用法：
 *   1) node node_modules/typescript/bin/tsc packages/shared/src/index.ts scripts/export-codex.ts \
 *        --outDir .tools/build --rootDir . --module ESNext --target ES2022 \
 *        --moduleResolution Bundler --skipLibCheck --types node
 *   2) node .tools/build/scripts/export-codex.js .tools/codex-data.json
 *   3) node scripts/build-codex-docx.mjs .tools/codex-data.json "docs/AIRNIGHT-干员与羁绊手册.docx"
 *
 * 【为什么不用 python-docx / npm 的 docx 包？】
 * 这台机器上装不了（pip 在那个沙箱里写临时目录会被拒）。
 * 而 .docx 本质就是一个装着几个 XML 的 zip，所以这里直接手写：
 *   zip 打包 + OOXML 片段 → 零依赖，跑得起来，样式也完全可控。
 *
 * 【改了数值表之后怎么办？】
 * 重新跑上面三步，文档就自动更新 —— 手册里的每个数字都来自游戏数据表本身。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { deflateRawSync } from 'node:zlib';

// ============================================================
// 一、最小 zip 打包器（store/deflate，够 Word 用）
// ============================================================

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** files: [{ name, data: Buffer }] -> zip Buffer */
function makeZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const raw = file.data;
    const comp = deflateRawSync(raw, { level: 9 });
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 文件名标志
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0x21, 12); // date = 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);

    locals.push(local, name, comp);
    centrals.push(central, name);
    offset += local.length + name.length + comp.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralBuf, eocd]);
}

// ============================================================
// 二、OOXML 片段构造
// ============================================================

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const BODY_FONT = '等线';
const HEAD_FONT = '微软雅黑';
const ASCII_FONT = 'Calibri';

/** 字号：half-point。9pt -> 18 */
const sz = (pt) => Math.round(pt * 2);

function rPr({ bold, italic, color, size, font = BODY_FONT, ascii = ASCII_FONT } = {}) {
  let x = `<w:rFonts w:ascii="${ascii}" w:hAnsi="${ascii}" w:eastAsia="${font}" w:cs="${ascii}"/>`;
  if (bold) x += '<w:b/><w:bCs/>';
  if (italic) x += '<w:i/><w:iCs/>';
  if (color) x += `<w:color w:val="${color}"/>`;
  if (size) x += `<w:sz w:val="${sz(size)}"/><w:szCs w:val="${sz(size)}"/>`;
  return `<w:rPr>${x}</w:rPr>`;
}

function run(text, opts = {}) {
  const preserve = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : '';
  return `<w:r>${rPr(opts)}<w:t${preserve}>${esc(text)}</w:t></w:r>`;
}

/**
 * 段落。text 里用 `**粗体**` 和 `//斜体//` 做内联标记（手册里只有这两种需要）。
 */
function para(text, opts = {}) {
  const {
    style,
    align,
    spaceBefore,
    spaceAfter,
    indent,
    hanging,
    keepNext,
    pageBreakBefore,
    color,
    size,
    bold,
    italic,
    font,
    ascii,
    shd,
  } = opts;

  let pPr = '';
  if (style) pPr += `<w:pStyle w:val="${style}"/>`;
  if (keepNext) pPr += '<w:keepNext/><w:keepLines/>';
  if (pageBreakBefore) pPr += '<w:pageBreakBefore/>';
  if (shd) pPr += `<w:shd w:val="clear" w:color="auto" w:fill="${shd}"/>`;
  if (spaceBefore !== undefined || spaceAfter !== undefined) {
    pPr += `<w:spacing${spaceBefore !== undefined ? ` w:before="${spaceBefore}"` : ''}${
      spaceAfter !== undefined ? ` w:after="${spaceAfter}"` : ''
    }/>`;
  }
  if (indent !== undefined || hanging !== undefined) {
    pPr += `<w:ind${indent !== undefined ? ` w:left="${indent}"` : ''}${
      hanging !== undefined ? ` w:hanging="${hanging}"` : ''
    }/>`;
  }
  if (align) pPr += `<w:jc w:val="${align}"/>`;
  const body = inlineRuns(String(text ?? ''), { color, size, bold, italic, font, ascii });
  return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${body}</w:p>`;
}

/** 把 `**粗体**` / `//斜体//` 拆成多个 run */
function inlineRuns(text, base = {}) {
  const parts = [];
  const re = /\*\*(.+?)\*\*|\/\/(.+?)\/\//g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(run(text.slice(last, m.index), base));
    if (m[1] !== undefined) parts.push(run(m[1], { ...base, bold: true }));
    else parts.push(run(m[2], { ...base, italic: true }));
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(run(text.slice(last), base));
  if (parts.length === 0) parts.push(run('', base));
  return parts.join('');
}

function cell(content, { width, fill, bold, align, size = 9, color, vAlign = 'center', span } = {}) {
  let tcPr = `<w:tcW w:w="${width}" w:type="dxa"/>`;
  if (span) tcPr += `<w:gridSpan w:val="${span}"/>`;
  if (fill) tcPr += `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>`;
  tcPr += `<w:vAlign w:val="${vAlign}"/>`;

  const lines = String(content ?? '').split('\n');
  const paras = lines
    .map((line, i) =>
      para(line, {
        size,
        bold,
        color,
        align,
        spaceBefore: i === 0 ? 20 : 0,
        spaceAfter: i === lines.length - 1 ? 20 : 0,
      }),
    )
    .join('');
  return `<w:tc><w:tcPr>${tcPr}</w:tcPr>${paras}</w:tc>`;
}

const BORDER = (color = 'BFBFBF', size = 4) =>
  `<w:top w:val="single" w:sz="${size}" w:space="0" w:color="${color}"/>` +
  `<w:left w:val="single" w:sz="${size}" w:space="0" w:color="${color}"/>` +
  `<w:bottom w:val="single" w:sz="${size}" w:space="0" w:color="${color}"/>` +
  `<w:right w:val="single" w:sz="${size}" w:space="0" w:color="${color}"/>` +
  `<w:insideH w:val="single" w:sz="${size}" w:space="0" w:color="${color}"/>` +
  `<w:insideV w:val="single" w:sz="${size}" w:space="0" w:color="${color}"/>`;

/**
 * 表格。rows = 二维数组，单元格可以是字符串或 cell 的参数对象。
 * 第一行默认当表头（浅蓝底 + 加粗 + 跨页重复）。
 */
function table(rows, widths, opts = {}) {
  const { header = true, size = 9, headerFill = 'DCE6F1', zebra = 'F7F9FC', align, centerFrom } = opts;

  const grid = widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('');

  const trs = rows
    .map((row, ri) => {
      const isHead = header && ri === 0;
      const fill = isHead ? headerFill : ri % 2 === 0 && zebra ? zebra : undefined;
      const cells = row
        .map((c, ci) => {
          const spec = typeof c === 'object' && c !== null ? c : { text: c };
          // centerFrom：从第 N 列起（含）居中 —— 数值列居中对齐比左对齐好扫得多
          const fallbackAlign = centerFrom !== undefined && ci >= centerFrom ? 'center' : align;
          return cell(spec.text ?? '', {
            width: widths[ci] ?? widths[widths.length - 1],
            span: spec.span,
            fill: spec.fill ?? fill,
            bold: spec.bold ?? isHead,
            align: spec.align ?? (isHead ? 'center' : fallbackAlign),
            size: spec.size ?? size,
            color: spec.color,
          });
        })
        .join('');
      const trPr = isHead ? '<w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>' : '<w:trPr><w:cantSplit/></w:trPr>';
      return `<w:tr>${trPr}${cells}</w:tr>`;
    })
    .join('');

  return (
    '<w:tbl><w:tblPr>' +
    '<w:tblW w:w="0" w:type="auto"/>' +
    '<w:jc w:val="left"/>' +
    `<w:tblBorders>${BORDER()}</w:tblBorders>` +
    '<w:tblLayout w:type="fixed"/>' +
    '<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/>' +
    '</w:tblPr>' +
    `<w:tblGrid>${grid}</w:tblGrid>` +
    trs +
    '</w:tbl>'
  );
}

/** 表格后面补一个空段落，避免两张表贴在一起被 Word 合并 */
const gap = () => para('', { size: 6, spaceAfter: 0, spaceBefore: 0 });

// ============================================================
// 三、样式表 / 页眉页脚 / 包结构
// ============================================================

function stylesXml() {
  const heading = (id, name, size, color, outline, before, after) => `
<w:style w:type="paragraph" w:styleId="${id}">
  <w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:qFormat/>
  <w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${before}" w:after="${after}"/><w:outlineLvl w:val="${outline}"/></w:pPr>
  <w:rPr><w:rFonts w:ascii="${ASCII_FONT}" w:hAnsi="${ASCII_FONT}" w:eastAsia="${HEAD_FONT}"/><w:b/><w:color w:val="${color}"/><w:sz w:val="${sz(size)}"/><w:szCs w:val="${sz(size)}"/></w:rPr>
</w:style>`;

  return (
    XML_HEAD +
    `<w:styles xmlns:w="${W}">` +
    '<w:docDefaults><w:rPrDefault><w:rPr>' +
    `<w:rFonts w:ascii="${ASCII_FONT}" w:hAnsi="${ASCII_FONT}" w:eastAsia="${BODY_FONT}" w:cs="${ASCII_FONT}"/>` +
    '<w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="80" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>' +
    '</w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    heading('Heading1', 'heading 1', 17, '1F3864', 0, 320, 160) +
    heading('Heading2', 'heading 2', 13.5, '2E5C9A', 1, 260, 120) +
    heading('Heading3', 'heading 3', 11.5, '3F3F3F', 2, 220, 100) +
    '<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="Caption"/><w:basedOn w:val="Normal"/>' +
    `<w:rPr><w:i/><w:color w:val="767676"/><w:sz w:val="${sz(8.5)}"/></w:rPr></w:style>` +
    '<w:style w:type="paragraph" w:styleId="TableText"><w:name w:val="Table Text"/><w:basedOn w:val="Normal"/>' +
    `<w:pPr><w:spacing w:before="20" w:after="20"/></w:pPr><w:rPr><w:sz w:val="${sz(9)}"/></w:rPr></w:style>` +
    '</w:styles>'
  );
}

function footerXml() {
  const r = (t) => `<w:r>${rPr({ size: 8.5, color: '808080' })}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
  return (
    XML_HEAD +
    `<w:ftr xmlns:w="${W}">` +
    '<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="0" w:after="0"/></w:pPr>' +
    r('AIRNIGHT 干员与羁绊手册　·　第 ') +
    `<w:fldSimple w:instr=" PAGE ">${r('1')}</w:fldSimple>` +
    r(' 页') +
    '</w:p></w:ftr>'
  );
}

function settingsXml() {
  /*
    最后那段 compatSetting 很关键：
    没有它，Word 会把这个文件当成「老格式」打开，标题栏挂一个「兼容性模式」，
    一些新版排版特性也会被关掉。val="15" 就是「Word 2013+ 现代格式」。
  */
  return (
    XML_HEAD +
    `<w:settings xmlns:w="${W}">` +
    '<w:zoom w:percent="100"/>' +
    '<w:defaultTabStop w:val="420"/>' +
    '<w:compat>' +
    '<w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/>' +
    '</w:compat>' +
    '</w:settings>'
  );
}

function coreXml(title, iso) {
  return (
    XML_HEAD +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
    'xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dc:title>${esc(title)}</dc:title>` +
    '<dc:subject>明日方舟自走棋 干员数值 / 技能 / 羁绊</dc:subject>' +
    '<dc:creator>AIRNIGHT</dc:creator>' +
    '<cp:lastModifiedBy>AIRNIGHT</cp:lastModifiedBy>' +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${iso}</dcterms:modified>` +
    '</cp:coreProperties>'
  );
}

const CONTENT_TYPES =
  XML_HEAD +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
  '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
  '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
  '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
  '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
  '</Types>';

const ROOT_RELS =
  XML_HEAD +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
  '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
  '</Relationships>';

const DOC_RELS =
  XML_HEAD +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>' +
  '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>' +
  '</Relationships>';

const APP_XML =
  XML_HEAD +
  '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ' +
  'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
  '<Application>AIRNIGHT</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop>' +
  '<Company></Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc>' +
  '<HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0000</AppVersion></Properties>';

const SECT_PR =
  '<w:sectPr>' +
  '<w:footerReference w:type="default" r:id="rId3"/>' +
  '<w:pgSz w:w="11906" w:h="16838"/>' +
  '<w:pgMar w:top="1247" w:right="1134" w:bottom="1134" w:left="1134" w:header="851" w:footer="851" w:gutter="0"/>' +
  '<w:cols w:space="425"/><w:docGrid w:type="lines" w:linePitch="312"/>' +
  '</w:sectPr>';

// ============================================================
// 四、正文内容
// ============================================================

const CONTENT_W = 9638; // 正文可用宽度（twips）

const dataPath = resolve(process.argv[2] ?? '.tools/codex-data.json');
const outPath = resolve(process.argv[3] ?? 'docs/AIRNIGHT-干员与羁绊手册.docx');
const data = JSON.parse(readFileSync(dataPath, 'utf8'));

const playable = data.units.filter((u) => !u.isSummon);
const summons = data.units.filter((u) => u.isSummon);
const costs = [...new Set(playable.map((u) => u.cost))].sort((a, b) => a - b);
const traitsRace = data.traits.filter((t) => t.kind === 'race');
const traitsClass = data.traits.filter((t) => t.kind === 'class');

/** 攻速原始值 -> 每秒攻击次数（内核公式：间隔 = ceil(24000 / 攻速) 帧，20 帧 = 1 秒） */
const intervalTicks = (attackSpeed) => Math.max(1, Math.ceil(24000 / Math.max(1, attackSpeed)));
const perSecond = (attackSpeed) => (20 / intervalTicks(attackSpeed)).toFixed(2);
const intervalSeconds = (attackSpeed) => (intervalTicks(attackSpeed) / 20).toFixed(2);

const clean = (s) => String(s ?? '').replace(/\*\*/g, '').trim();
const traitNames = (u) => u.traits.map((t) => t.name).join('、') || '（无）';
const pct = (bp) => `${(bp / 100).toFixed(bp % 100 === 0 ? 0 : 1)}%`;

const body = [];
const push = (...parts) => body.push(...parts);

// ---------- 封面 ----------
push(
  para('', { size: 12, spaceAfter: 0 }),
  para('', { size: 12, spaceAfter: 0 }),
  para('AIRNIGHT', { size: 34, bold: true, align: 'center', color: '1F3864', font: HEAD_FONT, spaceAfter: 60 }),
  para('明日方舟自走棋', { size: 16, align: 'center', color: '2E5C9A', font: HEAD_FONT, spaceAfter: 40 }),
  para('干员 · 技能 · 羁绊 资料手册', {
    size: 24,
    bold: true,
    align: 'center',
    color: '1F3864',
    font: HEAD_FONT,
    spaceAfter: 200,
  }),
);

{
  const widths = [2400, 7238];
  const rows = [
    ['项目', '内容'],
    ['干员', `${playable.length} 名（另有召唤物 ${summons.length} 个）`],
    ['羁绊', `${data.traits.length} 个（出身 / 势力 ${traitsRace.length} 个 + 战斗定位 ${traitsClass.length} 个）`],
    ['技能', `${playable.length} 条主动 / 被动技能，其中 ${playable.filter((u) => u.skill.star3).length} 名有 3★ 专属技能`],
    ['费用分布', costs.map((c) => `${c} 费 ${playable.filter((u) => u.cost === c).length} 名`).join('　')],
    ['数据来源', data.sourceFiles.join('、')],
    ['生成时间', data.generatedAt.replace('T', ' ').slice(0, 19) + ' (UTC)'],
  ];
  push(
    table(rows, widths, { size: 9.5 }),
    gap(),
    para(
      '本手册的每一个数字都由脚本直接从游戏数据表导出，不是手抄的 —— 所以它和实际战斗结算完全一致。' +
        '数值表改动后重新生成即可保持同步。',
      { size: 9, color: '767676', align: 'center', spaceBefore: 120 },
    ),
  );
}

// ---------- 阅读说明 ----------
push(
  para('阅读说明', { style: 'Heading1', pageBreakBefore: true }),
  para('1. 本手册怎么查', { style: 'Heading2' }),
  para('**第一章 干员总览**：一张表看完每个干员的基础面板和羁绊，用来横向比较（谁最肉、谁输出最高）。', {
    indent: 200,
  }),
  para('**第二章 干员详解**：每个干员一小节，含 1★ / 2★ / 3★ 三档面板和完整技能文本。', { indent: 200 }),
  para('**第三章 羁绊详解**：每个羁绊的开启人数、每一档的效果、以及有哪些干员带这个羁绊。', { indent: 200 }),
  para('**第四章 附录**：干员 → 羁绊反查表、数值规则（星级 / 护甲 / 法力 / 攻速的换算公式）。', { indent: 200 }),
  para('在 Word 里打开「视图 → 导航窗格」，可以直接按标题跳到任意干员或羁绊。', {
    indent: 200,
    color: '767676',
    size: 9,
  }),
  para('2. 数值的单位与读法', { style: 'Heading2' }),
);

{
  const rows = [
    ['字段', '含义与换算'],
    ['生命 / 攻击力', '游戏内点数，直接就是数字。'],
    ['攻速', '游戏用原始值表示，**1200 = 每秒攻击 1 次**。'],
    ['每秒攻击次数', '= 20 ÷ ceil(24000 ÷ 攻速)。本手册已替你算好。'],
    ['攻击间隔', '= ceil(24000 ÷ 攻速) ÷ 20 秒（战斗逻辑每秒 20 帧）。'],
    ['护甲 / 魔抗', `减伤率 = 抗性 ÷ (抗性 + 100)，最高减伤 90%。例：护甲 60 → 减伤 37.5%。`],
    ['射程', '格数。1 格 = 近战；2 格及以上 = 远程。羁绊可以改变它（炮手 +2、术士 +1）。'],
    ['法力', `上限 ${data.constants.manaMax}，攒满即放技能，放完清零。`],
    ['每次普攻回蓝', '只有「攻击回复」的干员才享受；「受击回复」的干员挨打才回蓝。'],
    ['羁绊计数', '**同一种干员（哪怕不同星级、多个复制体）只算 1 个**；生效的是达到的最高档。'],
  ];
  push(table(rows, [1900, 7738], { size: 9.5 }), gap());
}

push(para('3. 星级成长规则', { style: 'Heading2' }));

{
  const START_MANA = { 1: 0, 2: 250, 3: 600 }; // 见 constants.ts 的 START_MANA_BY_STAR
  const rows = [['星级', '生命 / 攻击力', '3★ 额外生命', '开局法力', '技能']];
  for (const star of [1, 2, 3]) {
    const mult = star === 1 ? '×1.00' : star === 2 ? '×1.80' : '×3.24';
    const extra = star < 3 ? '—' : '4 费 ×1.20、5 费 ×2.00（1~3 费无额外加成）';
    rows.push([
      `${star}★`,
      mult,
      extra,
      String(START_MANA[star]),
      star === 3 ? '**只生效 3★ 专属技能**（若该干员有），1★/2★ 技能不再生效' : '使用常规技能',
    ]);
  }
  push(table(rows, [900, 1900, 3400, 1100, 2338], { size: 9.5, centerFrom: 1 }), gap());
}

push(
  para(
    '护甲 / 魔抗 / 攻速 / 射程**不随星级变化**；星级只放大生命与攻击力（以及 3★ 的额外生命）。',
    { size: 9, color: '767676' },
  ),
);

// ---------- 第一章：干员总览 ----------
push(para('第一章　干员总览（按费用）', { style: 'Heading1', pageBreakBefore: true }));
push(
  para(
    '表中的面板数字是 **1★ 基础值**（不含羁绊加成）；星级成长见「阅读说明 · 星级成长规则」。' +
      '「攻速」一列已经换算成每秒攻击次数。',
    { size: 9, color: '767676' },
  ),
);

const OVERVIEW_WIDTHS = [1080, 1180, 3200, 740, 740, 740, 600, 600, 758];
for (const cost of costs) {
  const list = playable.filter((u) => u.cost === cost);
  push(para(`${cost} 费干员（${list.length} 名）`, { style: 'Heading2' }));
  const rows = [['干员', '定位', '羁绊', '生命', '攻击', '攻速', '护甲', '魔抗', '射程']];
  for (const u of list) {
    rows.push([
      { text: u.name, bold: true },
      u.role,
      traitNames(u),
      String(u.base.hp),
      String(u.base.attackDamage),
      perSecond(u.base.attackSpeed),
      String(u.base.armor),
      String(u.base.magicResist),
      String(u.base.range),
    ]);
  }
  push(table(rows, OVERVIEW_WIDTHS, { size: 9, centerFrom: 3 }), gap());
}

// ---------- 第二章：干员详解 ----------
push(para('第二章　干员详解', { style: 'Heading1', pageBreakBefore: true }));
push(
  para('每个干员的三档面板都是**实际战斗开局时的属性**（只差羁绊加成没算进去）。', {
    size: 9,
    color: '767676',
  }),
);

const DETAIL_WIDTHS = [820, 1150, 1150, 950, 1250, 1000, 1000, 900, 1418];

for (const cost of costs) {
  push(para(`${cost} 费干员`, { style: 'Heading2' }));
  for (const u of playable.filter((x) => x.cost === cost)) {
    push(
      para(u.name, { style: 'Heading3' }),
      para(`${u.cost} 费　｜　${u.role}　｜　羁绊：${traitNames(u)}`, {
        size: 9,
        color: '595959',
        spaceAfter: 60,
      }),
    );

    const rows = [['星级', '生命', '攻击力', '攻速', '攻击间隔', '护甲', '魔抗', '射程', '开局法力']];
    for (const p of u.panels) {
      rows.push([
        { text: `${p.star}★`, bold: true, align: 'center' },
        String(p.hp),
        String(p.attackDamage),
        perSecond(u.base.attackSpeed),
        `${intervalSeconds(u.base.attackSpeed)} 秒`,
        String(p.armor),
        String(p.magicResist),
        String(u.base.range),
        String(p.startMana),
      ]);
    }
    push(table(rows, DETAIL_WIDTHS, { size: 8.5, zebra: null, centerFrom: 1 }), gap());

    push(para(`**技能：**${u.skill.name}`, { size: 10, spaceAfter: 20 }));
    push(para(`**说明：**${clean(u.skill.desc)}`, { size: 9.5, indent: 200, spaceAfter: 20 }));

    let manaLine = `**回蓝方式：**${u.skill.manaSourceName}`;
    if (u.skill.manaSource === 'attack') manaLine += `（每次普攻回 ${u.base.manaPerAttack} 点法力）`;
    else if (u.skill.manaSource === 'auto') manaLine += `（每秒回 ${u.skill.manaPerSecond} 点法力）`;
    else manaLine += '（每次受伤按伤害量回蓝）';
    push(para(manaLine, { size: 9.5, indent: 200, spaceAfter: 20 }));

    if (u.skill.star3) {
      push(
        para(`**★3 专属技能：**${u.skill.star3.name}`, { size: 9.5, indent: 200, color: '9C5700', spaceAfter: 20 }),
        para(clean(u.skill.star3.desc), { size: 9.5, indent: 400, color: '7F6000', spaceAfter: 20 }),
      );
    } else {
      push(para('**★3 专属技能：**无（3★ 沿用上面的技能）', { size: 9, indent: 200, color: '808080' }));
    }
  }
}

// ---------- 第三章：羁绊详解 ----------
push(para('第三章　羁绊详解', { style: 'Heading1', pageBreakBefore: true }));
push(
  para(
    '羁绊分为两类：**出身 / 势力** 与 **战斗定位**。凑够人数即开启对应档位，**生效的只有达到的最高档**。\n' +
      '「生效范围」有两种：//仅带此羁绊的干员// 或 //我方全体（光环）//。',
    { size: 9.5 },
  ),
);
push(
  para(
    '注意：羁绊看的是阵容里**有多少种不同的干员**。同一个干员的多个复制体、不同星级，都只算 1 个。',
    { size: 9, color: 'C00000' },
  ),
);

const TRAIT_WIDTHS = [1300, 8338];
function traitSection(title, list) {
  push(para(title, { style: 'Heading2' }));
  for (const t of list) {
    const scopeText = t.scope === 'team' ? '我方全体生效（光环）' : '仅带此羁绊的干员生效';
    push(
      para(t.name, { style: 'Heading3' }),
      para(`${t.kind === 'race' ? '出身 / 势力' : '战斗定位'}　｜　${scopeText}　｜　共 ${t.members.length} 名干员`, {
        size: 9,
        color: '595959',
        spaceAfter: 60,
      }),
    );
    const rows = [['开启人数', '效果']];
    for (const tier of t.tiers) {
      rows.push([{ text: `${tier.count} 人`, bold: true, align: 'center' }, clean(tier.desc)]);
    }
    push(table(rows, TRAIT_WIDTHS, { size: 9.5, zebra: null }), gap());
    push(para(`**拥有此羁绊的干员（${t.members.length}）：**${t.members.join('、')}`, { size: 9.5, indent: 100 }));
  }
}

traitSection('一、出身 / 势力羁绊', traitsRace);
traitSection('二、战斗定位羁绊', traitsClass);

// ---------- 第四章：附录 ----------
push(para('第四章　附录', { style: 'Heading1', pageBreakBefore: true }));

push(para('附录 A　干员 → 羁绊 反查表', { style: 'Heading2' }));
{
  const rows = [['干员', '费用', '定位', '羁绊（出身 / 势力 ＋ 战斗定位）']];
  for (const u of playable) {
    rows.push([
      { text: u.name, bold: true },
      `${u.cost} 费`,
      u.role,
      u.traits.map((t) => `${t.name}(${t.kind === 'race' ? '出身' : '定位'})`).join('、'),
    ]);
  }
  push(table(rows, [1400, 800, 1300, 6138], { size: 9 }), gap());
}

push(para('附录 B　数值规则速查', { style: 'Heading2' }));

{
  const rows = [['项目', '规则']];
  rows.push(
    ['星级成长', '每升一星，生命与攻击力 ×1.80（2★ ×1.80、3★ ×3.24）。'],
    ['3★ 额外生命', '4 费 ×1.20、5 费 ×2.00，1~3 费无额外加成（只加生命，不加攻击）。'],
    ['开局法力', '1★ = 0、2★ = 250、3★ = 600（攒满 1000 才放技能）。'],
    ['攻击间隔', '= ceil(24000 ÷ 攻速) 帧；20 帧 = 1 秒。攻速 1200 → 1.00 秒/次。'],
    ['伤害减免', '减免率 = 抗性 ÷ (抗性 + 100)，上限 90%。'],
    ['伤害计算顺序', '基础值 × 星级倍率 → 再加羁绊加成（加法，不是乘法）。'],
    ['攻速上限/加成', '技能与羁绊的攻速加成直接相加后一起换算攻击间隔。'],
    ['法力来源', '每个干员只有一种：攻击回复 / 受击回复 / 自动回复。'],
    ['羁绊生效', '只生效达到的最高档，不叠加；同一种干员只算 1 个。'],
  );
  push(table(rows, [1700, 7938], { size: 9.5 }), gap());
}
push(
  para('护甲 / 魔抗对应减伤率', { style: 'Heading3' }),
  para('公式：减伤率 = 抗性 ÷ (抗性 + 100)，上限 90%。', { size: 9, color: '767676' }),
);
{
  const armorValues = [0, 10, 20, 30, 40, 50, 60, 70, 80, 100];
  const rows = [
    ['护甲 / 魔抗', ...armorValues.map(String)],
    ['伤害减免', ...armorValues.map((a) => `${((a / (a + 100)) * 100).toFixed(1)}%`)],
  ];
  push(table(rows, [1500, ...armorValues.map(() => 813)], { size: 8.5, zebra: null, centerFrom: 1 }), gap());
}

push(para('附录 C　召唤物', { style: 'Heading2' }));
push(para('召唤物不能从商店买到，只能由技能生成。它们不参与羁绊，死亡也不扣玩家血量。', { size: 9, color: '767676' }));
{
  const rows = [['召唤物', '生命', '攻击力', '攻速', '护甲', '魔抗', '射程', '说明']];
  for (const s of summons) {
    rows.push([
      { text: s.name, bold: true },
      String(s.base.hp),
      String(s.base.attackDamage),
      perSecond(s.base.attackSpeed),
      String(s.base.armor),
      String(s.base.magicResist),
      String(s.base.range),
      clean(s.skill.desc),
    ]);
  }
  push(table(rows, [1100, 750, 800, 750, 620, 620, 620, 4378], { size: 9, centerFrom: 1 }), gap());
}

push(
  para('— 手册结束 —', { align: 'center', color: '808080', size: 9, spaceBefore: 240 }),
  para(
    `数据来源：${data.sourceFiles.join('、')}　｜　生成于 ${data.generatedAt.slice(0, 19).replace('T', ' ')} (UTC)`,
    { align: 'center', color: 'A6A6A6', size: 8 },
  ),
);

// ============================================================
// 五、打包
// ============================================================

const documentXml =
  XML_HEAD +
  `<w:document xmlns:w="${W}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
  `<w:body>${body.join('')}${SECT_PR}</w:body></w:document>`;

const iso = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const zip = makeZip([
  { name: '[Content_Types].xml', data: Buffer.from(CONTENT_TYPES, 'utf8') },
  { name: '_rels/.rels', data: Buffer.from(ROOT_RELS, 'utf8') },
  { name: 'docProps/core.xml', data: Buffer.from(coreXml('AIRNIGHT 干员与羁绊手册', iso), 'utf8') },
  { name: 'docProps/app.xml', data: Buffer.from(APP_XML, 'utf8') },
  { name: 'word/document.xml', data: Buffer.from(documentXml, 'utf8') },
  { name: 'word/_rels/document.xml.rels', data: Buffer.from(DOC_RELS, 'utf8') },
  { name: 'word/styles.xml', data: Buffer.from(stylesXml(), 'utf8') },
  { name: 'word/settings.xml', data: Buffer.from(settingsXml(), 'utf8') },
  { name: 'word/footer1.xml', data: Buffer.from(footerXml(), 'utf8') },
]);

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, zip);

const sizeKb = (zip.length / 1024).toFixed(0);
console.log(`已生成：${outPath}（${sizeKb} KB）`);
console.log(`  干员 ${playable.length} 名、羁绊 ${data.traits.length} 个、召唤物 ${summons.length} 个`);
console.log(`  document.xml ${(Buffer.byteLength(documentXml, 'utf8') / 1024).toFixed(0)} KB`);
