/**
 * 导出「干员数值表」成 Excel（.xlsx），方便你直接填数值。
 *
 * 用法：
 *   node node_modules/tsx/dist/cli.mjs scripts/export-stat-sheet.ts
 *
 * 产出：docs/干员数值表.xlsx（两个工作表）
 *   1. 干员数值 —— 50 行，当前值已经预填好，你只改不满意的
 *   2. 填写说明 —— 每个字段的单位、换算公式、参考范围
 *
 * 【为什么预填当前值而不是留空？】
 * 因为"从零填 50 行 × 9 个数"很容易填出量级错误（比如血量多写一个 0）。
 * 有现成值做参照，你只需要判断"这个数字符不符合我想要的定位"。
 *
 * 【写完之后会自查】
 * 用我们自己的 xlsx 读取器把生成的文件读回来，对一遍行数和几个单元格 ——
 * 这样"Excel 能不能打开"就不是靠猜，而是真的验证过 zip 结构和 XML 都能解析。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { TRAIT_DEFS, UNIT_DEFS } from '../packages/shared/src/index.js';
// @ts-expect-error 这个写出器是 .mjs（零依赖的小工具），没有类型声明
import { buildXlsx } from './xlsx-write.mjs';

const HEADERS = [
  '干员id',
  '名字',
  '费用',
  '羁绊',
  '生命值',
  '攻击力',
  '攻速',
  '护甲',
  '魔抗',
  '攻击距离',
  '每次普攻回法力',
  '每星生命倍率',
  '每星攻击倍率',
];

const WIDTHS = [9, 16, 7, 22, 10, 10, 9, 8, 8, 12, 15, 14, 14];

/** 数据行：当前值已经填好，你只改数字 */
const dataRows: Array<Array<string | number>> = [HEADERS];
for (const def of Object.values(UNIT_DEFS).sort((a, b) => a.id.localeCompare(b.id))) {
  dataRows.push([
    def.id,
    def.name,
    def.cost,
    def.traits.map((trait) => TRAIT_DEFS[trait]?.name ?? trait).join('、'),
    def.base.hp,
    def.base.attackDamage,
    def.base.attackSpeed,
    def.base.armor,
    def.base.magicResist,
    def.base.range,
    def.base.manaPerAttack,
    def.starHpBp,
    def.starDamageBp,
  ]);
}

const GUIDE: Array<Array<string | number>> = [
  ['字段', '你要填什么', '单位 / 换算', '参考范围'],

  ['生命值', '血量上限', '直接写数字', '1费 400~900 · 5费 1000~1600'],
  ['攻击力', '每次普攻的伤害', '直接写数字', '1费 40~70 · 5费 110~150'],
  ['攻速', '每秒攻击几次', '1000 = 每秒 1 次', '1000~1300（1300 = 每秒 1.3 次）'],
  ['护甲', '减免物理伤害', '减免率 = 护甲 ÷ (护甲+100)', '近战 20~50 · 远程 10~25'],
  ['魔抗', '减免法术伤害', '同上', '14~45'],
  ['攻击距离', '打几格远', '格数', '✅ 你表格里已经给过，不用改'],
  [
    '每次普攻回法力',
    '打几下能放技能',
    '法力上限是 1000',
    '100~130（100 = 打 10 下放技能）',
  ],
  ['每星生命倍率', '升一星血量乘多少', '1800 = 每星 ×1.8', '1800（三星 = ×3.24）'],
  ['每星攻击倍率', '升一星攻击乘多少', '同上', '1800'],

  ['', '', '', ''],
  ['换算表：护甲 → 减伤', '护甲 20 → 减 17%', '护甲 50 → 减 33%', '护甲 100 → 减 50%'],
  ['', '护甲 30 → 减 23%', '护甲 80 → 减 44%', '护甲 150 → 减 60%'],
  ['', '', '', ''],
  [
    '手感尺度 ①',
    '一场战斗大约 20~40 秒',
    '打死一个棋子 ≈ 生命值 ÷ (攻击力 × (1-对方减伤))',
    '1 费打 1 费大约 5~8 下',
  ],
  [
    '手感尺度 ②',
    '5 费不该是 1 费的 10 倍',
    '现在每档比上一档强 25~30%',
    '5 费约等于 1 费的 2.35 倍',
  ],
  [
    '手感尺度 ③',
    '三星是 ×3.24',
    '三星 1 费（900×3.24=2916）比一星 3 费还肉',
    '这是自走棋常态，但填的时候心里要有数',
  ],
  ['', '', '', ''],
  ['⚠️ 护甲别超过 100 左右', '再多收益急剧变小', '150 才减 60%，但已经很难打死了', '校验器会提醒你'],
  ['', '', '', ''],
  ['还缺两样', '① 50 个干员的技能', '表格里「技能」那列是空的', '人话描述即可'],
  [
    '',
    '②「1-3星技能倍率」指什么',
    '若是星级成长倍率 = 上面那两个 1800',
    '若是"技能伤害随星级变强"是另一套东西',
  ],
  ['', '', '', ''],
  ['填完怎么用', '改好这个 Excel 发给我', '我写进干员表并跑平衡诊断', '可以分批发，先给 5~10 个试试水'],
];

const buffer = buildXlsx([
  { name: '干员数值', rows: dataRows, widths: WIDTHS, freezeHeader: true },
  { name: '填写说明', rows: GUIDE, widths: [20, 30, 46, 34], freezeHeader: true },
]);

const path = 'docs/干员数值表.xlsx';
writeFileSync(path, buffer);

console.log(`已导出 -> ${path}（${(buffer.length / 1024).toFixed(1)} KB，两个工作表）`);

// ---------- 自查：把刚写出来的文件读回来对一遍 ----------
const readBack = readFileSync(path);
if (readBack.readUInt32LE(0) !== 0x04034b50) {
  throw new Error('自查失败：文件开头不是 zip 头');
}
// 注意用 latin1 只是为了在二进制里找**纯 ASCII 的路径名**。
// 中文内容不能这么找（latin1 解不出 UTF-8 的中文），所以下面用真正的读取器验证。
const rawText = readBack.toString('latin1');
if (!rawText.includes('xl/worksheets/sheet1.xml')) throw new Error('自查失败：找不到 sheet1');
if (!rawText.includes('xl/worksheets/sheet2.xml')) throw new Error('自查失败：找不到 sheet2');
if (!rawText.includes('xl/styles.xml')) throw new Error('自查失败：找不到 styles');

// 用同一个读取器（它是为真实 Excel 文件写的）再解析一次。
// 读取器一次读一张表，所以两张表各读一遍 —— 顺便验证 sheet2 也能被解析。
const { execFileSync } = await import('node:child_process');
const readSheet = (index: number): string =>
  execFileSync(process.execPath, ['scripts/read-xlsx.mjs', path, String(index)], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });

const dump1 = readSheet(1);
const sheetLine = dump1.split('\n').find((line) => line.startsWith('工作表：')) ?? '';
if (!sheetLine.includes('干员数值') || !sheetLine.includes('填写说明')) {
  throw new Error(`自查失败：工作表名不对 -> ${sheetLine}`);
}

const rows1 = dump1.split('\n').filter((line) => line.startsWith('['));
if (rows1.length !== dataRows.length) {
  throw new Error(`自查失败：干员表读回来 ${rows1.length} 行，应该是 ${dataRows.length} 行`);
}

// 说明表里有几行是**空行**（用来分组、更好看），而读取器会跳过全空的行，
// 所以这里按"非空行数"来对，而不是按总行数。
const guideNonEmpty = GUIDE.filter((row) => row.some((cell) => cell !== '')).length;
const rows2 = readSheet(2).split('\n').filter((line) => line.startsWith('['));
if (rows2.length !== guideNonEmpty) {
  throw new Error(`自查失败：说明表读回来 ${rows2.length} 行，应该是 ${guideNonEmpty} 行（非空行）`);
}

console.log(`自查通过：两个工作表都能被解析`);
console.log(`  干员数值 ${rows1.length} 行（表头 + ${rows1.length - 1} 个干员）`);
console.log(`  填写说明 ${rows2.length} 行`);
console.log(`  第一行数据：${rows1[1]?.slice(0, 78)}…`);
