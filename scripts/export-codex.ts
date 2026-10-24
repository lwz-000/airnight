/**
 * 干员 / 技能 / 羁绊 数据导出（给 Word 手册生成器用）
 *
 * 用法：
 *   node node_modules/tsx/dist/cli.mjs scripts/export-codex.ts [输出路径]
 *
 * 【为什么要有这个脚本？】
 * 《干员羁绊手册.docx》里所有数字都必须和游戏里**完全一致**。
 * 如果手抄一遍，改了数值表之后文档就过期了，而且没人会发现。
 * 所以这里直接从游戏的数据表（unit-data / unit-stats / skill-data / trait-data）
 * 读出来，导出成 JSON，再由 scripts/build-codex-docx.mjs 渲染成 Word。
 *
 * 结论：**改了数值表之后重新跑这两个脚本，文档就自动更新。**
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  STAR3_HP_BONUS_BP,
  UNIT_DEFS,
  START_MANA_BY_STAR,
  TRAIT_DEFS,
  TRAIT_MEMBERS,
  MANA_MAX,
  roleOf,
  starMultiplier,
} from '../packages/shared/src/index.js';
// unit-stats 没有从 index.ts 再导出（它是"自动生成的数据文件"），所以直接引
import { UNIT_STATS } from '../packages/shared/src/unit-stats.js';

/** 定位（role）-> 中文名。和 unit-data.ts 里 ARCHETYPES 的 clsName 一一对应 */
const ROLE_NAME: Record<string, string> = {
  guard: '近战输出',
  defender: '重装',
  sniper: '远程物理',
  caster: '法术输出',
  medic: '治疗支援',
  vanguard: '功能 / 指挥',
};

const MANA_SOURCE_NAME: Record<string, string> = {
  attack: '攻击回复',
  damage: '受击回复',
  auto: '自动回复',
};

/** 星级面板：直接复刻 rules.ts 的 createUnit 公式（不含羁绊加成） */
function starPanel(def: (typeof UNIT_DEFS)[string], star: number) {
  const hpBp = starMultiplier(star, def.starHpBp);
  const dmgBp = starMultiplier(star, def.starDamageBp);
  const star3HpBp = star >= 3 ? (STAR3_HP_BONUS_BP[def.cost] ?? 10000) : 10000;
  const hpTotalBp = Math.floor((hpBp * star3HpBp) / 10000);
  return {
    star,
    hp: Math.floor((def.base.hp * hpTotalBp) / 1000),
    attackDamage: Math.floor((def.base.attackDamage * dmgBp) / 1000),
    armor: def.base.armor,
    magicResist: def.base.magicResist,
    startMana: START_MANA_BY_STAR[star] ?? 0,
  };
}

const units = Object.values(UNIT_DEFS).map((def) => {
  const skills = def.skill;
  return {
    id: def.id,
    name: def.name,
    cost: def.cost,
    isSummon: def.summonOnly === true,
    role: ROLE_NAME[roleOf({ name: def.name, cost: def.cost, range: def.base.range, traits: def.traits } as never)],
    traits: def.traits.map((id) => ({
      id,
      name: TRAIT_DEFS[id]?.name ?? id,
      kind: TRAIT_DEFS[id]?.kind ?? 'class',
    })),
    base: {
      hp: def.base.hp,
      attackDamage: def.base.attackDamage,
      attackSpeed: def.base.attackSpeed,
      armor: def.base.armor,
      magicResist: def.base.magicResist,
      range: def.base.range,
      manaPerAttack: def.base.manaPerAttack,
    },
    starHpBp: def.starHpBp,
    starDamageBp: def.starDamageBp,
    star3HpBonusBp: STAR3_HP_BONUS_BP[def.cost] ?? 10000,
    panels: [1, 2, 3].map((s) => starPanel(def, s)),
    skill: {
      name: skills.name,
      desc: skills.desc,
      manaSource: skills.manaSource,
      manaSourceName: MANA_SOURCE_NAME[skills.manaSource] ?? skills.manaSource,
      manaPerSecond: skills.manaPerSecond ?? 0,
      hasPassive: skills.passive !== undefined,
      hasBattleStart: (skills.battleStart?.length ?? 0) > 0,
      activeEffectKinds: skills.effects.map((e) => e.kind),
      star3: skills.star3
        ? { name: skills.star3.name, desc: skills.star3.desc, passiveOnly: skills.star3.effects.length === 0 }
        : null,
    },
  };
});

const traits = Object.values(TRAIT_DEFS).map((def) => ({
  id: def.id,
  name: def.name,
  kind: def.kind,
  scope: def.scope ?? 'members',
  tiers: def.tiers.map((tier) => ({
    count: tier.count,
    desc: tier.desc,
    effects: tier.effects.map((e) => `${e.type}=${e.value}`),
    mechanics: (tier.mechanics ?? []).map((m) => m.kind),
  })),
  members: TRAIT_MEMBERS[def.id] ?? [],
}));

/** 反查：每个干员身上挂了哪些羁绊（按费用排序，方便查表） */
const payload = {
  generatedAt: new Date().toISOString(),
  gameVersion: 'AIRNIGHT 0.0.1',
  sourceFiles: [
    'packages/shared/src/unit-data.ts',
    'packages/shared/src/unit-stats.ts',
    'packages/shared/src/skill-data.ts',
    'packages/shared/src/trait-data.ts',
  ],
  constants: {
    ticksPerSecond: 20,
    manaMax: MANA_MAX,
    manaPerAttack: 100,
    attackIntervalBase: 24000,
    armorK: 100,
    maxReductionBp: 9000,
    starHpBp: 1800,
    starDamageBp: 1800,
    star3HpBonusBp: STAR3_HP_BONUS_BP,
  },
  units,
  traits,
};

const outPath = resolve(process.argv[2] ?? '.tools/codex-data.json');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');

const playable = units.filter((u) => !u.isSummon);
console.log(`导出完成：${outPath}`);
console.log(`  干员 ${playable.length} 名（另有召唤物 ${units.length - playable.length} 个）`);
console.log(`  羁绊 ${traits.length} 个`);
console.log(`  技能 ${units.filter((u) => !u.isSummon).length} 条`);
console.log(`  三星专属技能 ${playable.filter((u) => u.skill.star3).length} 条`);
console.log(`  缺失基础数值的干员：${playable.filter((u) => !UNIT_STATS[u.id]).map((u) => u.name).join('、') || '无'}`);
