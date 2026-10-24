/**
 * 从「干员数值表.xlsx」导入数值，生成 packages/shared/src/unit-stats.ts。
 *
 * 用法：
 *   node node_modules/tsx/dist/cli.mjs scripts/import-stat-sheet.ts            # 预演（只报告，不写文件）
 *   node node_modules/tsx/dist/cli.mjs scripts/import-stat-sheet.ts --write    # 真的写入
 *
 * 【为什么生成一个单独的文件，而不是直接改 unit-data.ts？】
 * 因为 unit-data.ts 里还有名字/羁绊/费用/定位这些**手写**的内容。
 * 用脚本去改一个手写文件，下次再导入就会把手工编辑冲掉（或者要把两边合并，很脆）。
 * 拆成"生成的数值表 + 手写的名单"之后：
 *   · 你改 Excel -> 重新导入，只会覆盖数值表，手写部分不动
 *   · 数值表可以整份重写，永远不会和 Excel 不一致
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { UNIT_DEFS } from '../packages/shared/src/index.js';
// @ts-expect-error 读取器是 .mjs（零依赖的小工具），没有类型声明
import { readXlsx, rowsByHeader } from './xlsx-read.mjs';

const SHEET_PATH = 'docs/干员数值表.xlsx';
const OUT_PATH = 'packages/shared/src/unit-stats.ts';
const shouldWrite = process.argv.includes('--write');

/** Excel 表头 -> 内部字段。改表头时也要改这里 */
const COLUMNS: Record<string, string> = {
  干员id: 'id',
  名字: 'name',
  费用: 'cost',
  生命值: 'hp',
  攻击力: 'attackDamage',
  攻速: 'attackSpeed',
  护甲: 'armor',
  魔抗: 'magicResist',
  攻击距离: 'range',
  每次普攻回法力: 'manaPerAttack',
  每星生命倍率: 'starHpBp',
  每星攻击倍率: 'starDamageBp',
};

const NUMERIC_FIELDS = [
  'cost',
  'hp',
  'attackDamage',
  'attackSpeed',
  'armor',
  'magicResist',
  'range',
  'manaPerAttack',
  'starHpBp',
  'starDamageBp',
] as const;

interface Row {
  id: string;
  name: string;
  [key: string]: string | number;
}

if (!existsSync(SHEET_PATH)) {
  console.error(`找不到 ${SHEET_PATH} —— 先跑一次导出脚本生成它`);
  process.exit(1);
}

const { sheets, data } = readXlsx(SHEET_PATH);
const sheetName = sheets.find((name) => name.includes('数值')) ?? sheets[0]!;
const raw = data[sheetName];
if (!raw) {
  console.error(`读不到工作表「${sheetName}」，实际有：${sheets.join('、')}`);
  process.exit(1);
}

const { header, records } = rowsByHeader(raw);

// ---- 1) 检查列齐不齐（按表头名取列，缺列直接报错，不静默导错）----
const missingColumns = Object.keys(COLUMNS).filter((key) => !header.includes(key));
if (missingColumns.length > 0) {
  console.error(`❌ 表格缺少这些列：${missingColumns.join('、')}`);
  console.error(`   实际表头：${header.filter(Boolean).join('、')}`);
  process.exit(1);
}

// ---- 2) 把每行转成数字，顺手校验 ----
const problems: string[] = [];
const parsed: Row[] = [];

for (const record of records) {
  const row: Record<string, string | number> = {};
  for (const [excelKey, field] of Object.entries(COLUMNS)) {
    const value = String(record[excelKey] ?? '').trim();
    if (NUMERIC_FIELDS.includes(field as (typeof NUMERIC_FIELDS)[number])) {
      const num = Number(value);
      if (!Number.isFinite(num)) {
        problems.push(`${record['干员id'] ?? '?'} 的「${excelKey}」不是数字："${value}"`);
        continue;
      }
      row[field] = num;
    } else {
      row[field] = value;
    }
  }
  parsed.push(row as Row);
}

// ---- 3) 和现有名单对一遍（id 缺失/多余/名字对不上都要报）----
/*
  ★ 召唤物（迷迭香的柱子、维娜的金狮子、望的棋子）**不进这张表**。
  它们不是"能买的干员"，数值直接写在 skill-data.ts 的 SUMMON_DEFS 里，
  而且血量/攻击力是技能按施法者星级现场给的（柱子 300/500/700）。
  不排掉的话，每次导入都会报"表格里缺了 summon_pillar"这种假问题 ——
  假报错多了，真报错就会被淹掉。
*/
const knownIds = new Set(
  Object.values(UNIT_DEFS)
    .filter((def) => !def.summonOnly)
    .map((def) => def.id),
);
const sheetIds = new Set(parsed.map((row) => row.id));

for (const id of knownIds) {
  if (!sheetIds.has(id)) problems.push(`表格里缺了干员 ${id}（${UNIT_DEFS[id]!.name}）`);
}
for (const id of sheetIds) {
  if (!knownIds.has(id)) problems.push(`表格里的 ${id} 不在干员名单里（是不是加了新角色？）`);
}
for (const row of parsed) {
  const def = UNIT_DEFS[row.id];
  if (def && def.name !== row.name) {
    problems.push(`${row.id} 名字对不上：名单里是「${def.name}」，表格里是「${row.name}」`);
  }
}

// ---- 4) 数值本身的合理性（这些不会报错，但会毁掉手感，所以要提示）----
const warnings: string[] = [];
for (const row of parsed) {
  const id = row.id;
  if ((row.hp as number) <= 0) problems.push(`${id} 生命值为 0 或负数`);
  if ((row.attackSpeed as number) <= 0) problems.push(`${id} 攻速为 0 或负数`);
  if ((row.range as number) < 1) problems.push(`${id} 攻击距离小于 1 格`);
  if ((row.armor as number) > 100) {
    warnings.push(`${id}（${row.name}）护甲 ${row.armor}：超过 100 之后减伤收益急剧变小（100=50%，150 才 60%）`);
  }
  if ((row.magicResist as number) > 100) {
    warnings.push(`${id}（${row.name}）魔抗 ${row.magicResist} 同上`);
  }
  if ((row.hp as number) < 200) warnings.push(`${id}（${row.name}）生命值只有 ${row.hp}，可能一下就被秒`);
  if ((row.attackSpeed as number) > 2500) {
    warnings.push(`${id}（${row.name}）攻速 ${row.attackSpeed} = 每秒 ${(Number(row.attackSpeed) / 1000).toFixed(1)} 次，偏快`);
  }
  // 星级倍率
  for (const field of ['starHpBp', 'starDamageBp'] as const) {
    const value = row[field] as number;
    if (value < 1000) warnings.push(`${id}（${row.name}）${field} = ${value}，小于 1000 表示"升星反而变弱"`);
    if (value === 1000) warnings.push(`${id}（${row.name}）${field} = 1000，升星没有任何提升`);
  }
}

// ---- 5) 攻击距离和"羁绊表"里的射程对一下 ----
const rangeMismatch: string[] = [];
for (const row of parsed) {
  const def = UNIT_DEFS[row.id];
  if (def && def.base.range !== row.range) {
    rangeMismatch.push(`${row.id}（${row.name}）：羁绊表里是 ${def.base.range}，数值表里是 ${row.range}`);
  }
}

// ---- 6) 报告 ----
console.log(`读入 ${SHEET_PATH} · 工作表「${sheetName}」· ${parsed.length} 个干员\n`);

if (rangeMismatch.length > 0) {
  console.log(`ℹ️ 攻击距离和现有名单不一致（会以**数值表**为准）：`);
  for (const item of rangeMismatch) console.log(`   ${item}`);
  console.log('');
}

if (warnings.length > 0) {
  console.log(`⚠️ ${warnings.length} 条提醒（不拦，但建议看看）：`);
  for (const item of warnings) console.log(`   ${item}`);
  console.log('');
}

if (problems.length > 0) {
  console.log(`❌ ${problems.length} 个必须修的问题：`);
  for (const item of problems) console.log(`   ${item}`);
  console.log('');
  if (shouldWrite) {
    console.error('有必须修的问题，没有写入。修好表格再跑一次。');
    process.exit(1);
  }
}

// ---- 7) 生成 unit-stats.ts ----
const stars = new Set(parsed.map((row) => `${row.starHpBp}/${row.starDamageBp}`));
const uniformStar = stars.size === 1;

const lines: string[] = [];
lines.push('/**');
lines.push(' * ============================================================');
lines.push(' *  干员一星基础数值');
lines.push(' * ============================================================');
lines.push(' *');
lines.push(' * ⚠️ **这个文件是自动生成的，不要手改** —— 改完下次导入就被覆盖了。');
lines.push(' *');
lines.push(' * 数据来源：`docs/干员数值表.xlsx`（你填的那份）');
lines.push(' * 重新生成：');
lines.push(' *   node node_modules/tsx/dist/cli.mjs scripts/import-stat-sheet.ts --write');
lines.push(' *');
lines.push(' * 【关于单位】');
lines.push(' *   hp / attackDamage / armor / magicResist  直接是数字（1 点就是 1 点）');
lines.push(' *   attackSpeed                              1000 = 每秒攻击 1 次');
lines.push(' *   range                                    格数');
lines.push(' *   manaPerAttack                            每次普攻回多少法力（上限 1000）');
lines.push(' *   armor 的减伤公式                          减伤 = 护甲 ÷ (护甲 + 100)');
lines.push(' */');
lines.push('');
lines.push('import type { UnitDef } from \'./types.js\';');
lines.push('');
lines.push('/** 一星基础数值（不含羁绊加成） */');
lines.push('export const UNIT_STATS: Record<string, UnitDef[\'base\']> = {');
for (const row of parsed) {
  lines.push(
    `  ${row.id}: { hp: ${row.hp}, attackDamage: ${row.attackDamage}, attackSpeed: ${row.attackSpeed}, ` +
      `armor: ${row.armor}, magicResist: ${row.magicResist}, range: ${row.range}, manaPerAttack: ${row.manaPerAttack} },`,
  );
}
lines.push('};');
lines.push('');
lines.push('/**');
lines.push(' * 星级成长倍率：1800 = 每升一星 ×1.8（三星 = ×3.24）');
lines.push(' *');
lines.push(' * 【为什么要给"每个干员一份"，而不只留两个全局常量？】');
lines.push(' * 因为你可能想让某个干员"升星收益更高"或者"更低"。');
lines.push(' * 现在 50 个都是 1800，所以 UNIT_STAR_BP 里其实全是同一个值 ——');
lines.push(' * 但结构留着，以后要单独调某个干员时不用改代码。');
lines.push(' */');
lines.push(`export const STAR_HP_BP = ${uniformStar ? [...stars][0]!.split('/')[0] : 1800};`);
lines.push(`export const STAR_DAMAGE_BP = ${uniformStar ? [...stars][0]!.split('/')[1] : 1800};`);
lines.push('');
lines.push('/** 每个干员的星级倍率（没写就用上面的默认值） */');
lines.push('export const UNIT_STAR_BP: Record<string, { hpBp: number; damageBp: number }> = {');
for (const row of parsed) {
  lines.push(`  ${row.id}: { hpBp: ${row.starHpBp}, damageBp: ${row.starDamageBp} },`);
}
lines.push('};');
lines.push('');

const output = lines.join('\n');

if (!shouldWrite) {
  console.log('（这是预演。加 --write 才会真的生成文件。）');
  console.log(`\n预览前几行：\n${output.split('\n').slice(22, 28).join('\n')}`);
  process.exit(problems.length > 0 ? 1 : 0);
}

writeFileSync(OUT_PATH, output, 'utf8');
console.log(`✅ 已生成 ${OUT_PATH}（${parsed.length} 个干员的数值）`);

// 自查：确认写出来的文件能被解析回同样多的条目。
// 注意要按"两种条目各自的形状"分别数 —— 只数 "opNN: {" 的话，
// 数值表和星级表会被数成两倍（都长这样）。
const written = readFileSync(OUT_PATH, 'utf8');
const statCount = (written.match(/^  op\d+: \{ hp: /gm) ?? []).length;
const starCount = (written.match(/^  op\d+: \{ hpBp: /gm) ?? []).length;
if (statCount !== parsed.length) {
  throw new Error(`自查失败：数值表里有 ${statCount} 条，应该是 ${parsed.length} 条`);
}
if (starCount !== parsed.length) {
  throw new Error(`自查失败：星级表里有 ${starCount} 条，应该是 ${parsed.length} 条`);
}
console.log(`自查通过：数值表 ${statCount} 条、星级表 ${starCount} 条`);
