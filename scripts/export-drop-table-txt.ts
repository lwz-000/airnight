/**
 * ============================================================
 *  导出《各项数值/掉落表 三版.txt》—— 给人看的设计稿
 * ============================================================
 *
 * 【为什么要有这个脚本？】
 * 掉落表的**唯一真相是代码**（`packages/shared/src/drop-data.ts`），
 * 但策划要看的是一张能直接读的表。二版那份 txt 已经过期：
 *   · 二版 30 件藏品一件都不在里面；
 *   · 稀有组的百分比是"8 件时代"的数字（并进 10 件之后每个老件都被稀释了）。
 * 所以按代码现算一份三版出来 —— **改掉落仍然改代码**，
 * 这份 txt 是"代码当前长什么样"的快照（每段都标了真实百分比）。
 *
 * 跑法：
 *   node node_modules/tsx/dist/cli.mjs scripts/export-drop-table-txt.ts
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  DROP_TIER_LABEL,
  ITEM_DEFS,
  MONSTER_DROP_TABLE,
  type DropGroup,
  type DropTier,
} from '../packages/shared/src/index.js';

const OUT = resolve('各项数值/掉落表 三版.txt');

const TIERS: DropTier[] = ['minion', 'normal', 'elite', 'leader', 'boss'];

/** 组内某件藏品的真实概率（万分比，相对"进入掉物判定之后"） */
function groupItemBp(group: DropGroup, index: number): number {
  if (!group.weightsBp) return group.weightBp / group.items.length;
  const total = group.weightsBp.reduce((sum, w) => sum + w, 0) || 1;
  return (group.weightBp * (group.weightsBp[index] ?? 0)) / total;
}

/** 一件藏品的显示名（共享藏品带 (B) 标记，和用户二版 txt 的写法一致） */
function label(id: string): string {
  const item = ITEM_DEFS[id];
  if (!item) return id;
  return item.slot === 'B' ? `${item.name}（B）` : item.name;
}

/** 每个档位的表头（金币 / 必掉件数）—— 照抄用户二版里的说法 */
function header(tier: DropTier): string {
  const rule = MONSTER_DROP_TABLE[tier];
  if (rule.gold) {
    const drop = 10000 - rule.gold.chanceBp;
    return `${DROP_TIER_LABEL[tier]}掉落表（${DROP_TIER_LABEL[tier]}只会掉落一个藏品，有 ${
      rule.gold.chanceBp / 100
    }% 掉 ${rule.gold.amount} 个金币，剩下 ${drop / 100}% 概率掉落物为以下）：`;
  }
  const must = rule.guaranteed ?? 1;
  const extra = rule.extraChanceBp ? `，有 ${rule.extraChanceBp / 100}% 额外掉一个` : '';
  return `${DROP_TIER_LABEL[tier]}掉落表（必会掉落 ${must} 个藏品${extra}）`;
}

const lines: string[] = [];
lines.push('★ 本文件由 scripts/export-drop-table-txt.ts 从代码生成（改掉落请改代码）。');
lines.push(
  '  百分比口径：进入"掉物判定"之后的中奖率（和小怪/普通那一档"掉金币就不掉物"分开算）。',
);
lines.push('');

for (const tier of TIERS) {
  const rule = MONSTER_DROP_TABLE[tier];
  lines.push(header(tier));
  let n = 1;
  for (const group of rule.groups) {
    group.items.forEach((id, index) => {
      const bp = groupItemBp(group, index);
      // 等概率组不写逐件百分比（照用户的写法，组末统一写一行）
      const perItem = group.weightsBp ? `  ${(bp / 100).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}%` : '';
      lines.push(`${n}${n < 10 ? '' : ''}.${label(id)}${perItem}`);
      n++;
    });
    lines.push(`以上 ${group.weightBp / 100}% 掉落其中之一`);
    lines.push('');
  }
  lines.push('');
  lines.push('');
}

const text = lines.join('\n');
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, text, 'utf8');

/** 顺手报一下各组规模，方便一眼确认 */
for (const tier of TIERS) {
  const groups = MONSTER_DROP_TABLE[tier].groups;
  console.log(
    DROP_TIER_LABEL[tier],
    groups.map((g) => `${g.weightBp / 100}%×${g.items.length}`).join(' | '),
  );
}
console.log(`已导出 -> ${OUT}`);
