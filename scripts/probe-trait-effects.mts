/**
 * 羁绊效果「有没有真的生效」的运行时对拍探针（0.3.31 排查用）。
 *
 * 【为什么不用 grep 找消费者？】
 * 上一轮我用"扫哪个文件读了这个 kind"的办法，报出来 4 个"没人消费"的机制，
 * 结果全是误报（分别在 economy.ts / 客户端备战层里）。
 * 真正能证明"生效"的只有一件事：**跑一场战斗，看结果有没有变化**。
 *
 * 【做法】
 * 对每个羁绊，造两支一模一样的队伍：
 *   · 对照组：全员挂"空羁绊"（同样的人数门槛、没有效果）
 *   · 实验组：全员挂这个真羁绊，档位开到**最后一档**
 * 然后比较开局属性总和 / 单位数量（抓召唤）/ 整场打完后的存活数。
 * 三项**全都没差别** ⇒ 这个羁绊大概率是摆设，要人工确认。
 *
 * 跑法：node node_modules/tsx/dist/cli.mjs scripts/probe-trait-effects.mts
 */

import {
  createBattle,
  step,
  computeActiveTraitLevels,
  computeTraitBonuses,
  computeUnitTraitBonuses,
  resolveUnitMechanics,
  TRAIT_DEFS,
  TICKS_PER_SECOND,
  type SkillDef,
  type TeamSetup,
  type TraitDefTable,
  type UnitDef,
  type UnitDefTable,
} from '../packages/shared/src/index.js';

/** 造一个不做事的基础棋子（空技能，免得技能事件污染对比） */
function makeDef(id: string, traits: string[], base: Partial<UnitDef['base']> = {}): UnitDef {
  const skill: SkillDef = {
    id: `${id}_skill`,
    name: `${id} 的技能`,
    desc: '什么都不做（测试用）',
    effects: [],
    manaSource: 'attack',
  };
  return {
    id,
    name: id,
    cost: 1,
    traits,
    base: {
      hp: 1000,
      attackDamage: 100,
      attackSpeed: 1000,
      armor: 0,
      magicResist: 0,
      range: 1,
      manaPerAttack: 0,
      ...base,
    },
    starHpBp: 1000,
    starDamageBp: 1000,
    color: '#888888',
    sprite: id,
    skill,
  };
}

function tableOf(defs: UnitDef[]): UnitDefTable {
  const out: UnitDefTable = {};
  for (const def of defs) out[def.id] = def;
  return out;
}

function buildTeam(
  teamId: 0 | 1,
  entries: Array<{ defId: string; star?: number; cell: { col: number; row: number } }>,
  defs: UnitDefTable,
  traits: TraitDefTable,
): TeamSetup {
  const units = entries.map((entry) => ({
    defId: entry.defId,
    star: entry.star ?? 1,
    cell: entry.cell,
  }));
  return {
    team: teamId,
    units,
    traitBonuses: computeTraitBonuses(units, defs, traits),
    unitTraitBonuses: computeUnitTraitBonuses(units, defs, traits),
    activeTraits: computeActiveTraitLevels(units, defs, traits),
    unitMechanics: resolveUnitMechanics(units, defs, traits),
  };
}

interface Snapshot {
  count: number;
  hp: number;
  maxHp: number;
  attack: number;
  armor: number;
  magicResist: number;
  attackSpeed: number;
  range: number;
  shield: number;
  events: number;
}

function snapshotOf(defs: UnitDefTable, teams: [TeamSetup, TeamSetup], seed: number): Snapshot {
  const state = createBattle(defs, teams, seed);
  let guard = 0;
  while (!state.over && guard++ < TICKS_PER_SECOND * 90) step(state, defs);
  const units = state.units.filter((unit) => unit.team === 0);
  const sum = (pick: (unit: (typeof units)[number]) => number): number =>
    units.reduce((total, unit) => total + pick(unit), 0);
  return {
    count: units.length,
    hp: sum((unit) => unit.hp),
    maxHp: sum((unit) => unit.maxHp),
    attack: sum((unit) => unit.attackDamage),
    armor: sum((unit) => unit.armor),
    magicResist: sum((unit) => unit.magicResist),
    attackSpeed: sum((unit) => unit.attackSpeed),
    range: sum((unit) => unit.range),
    shield: sum((unit) => unit.statuses['shieldValue'] ?? 0),
    events: state.log.length,
  };
}

const EMPTY_TRAIT = 'zz_empty';

function emptyTraits(count: number): TraitDefTable {
  return {
    [EMPTY_TRAIT]: {
      id: EMPTY_TRAIT,
      name: '空羁绊',
      kind: 'class',
      tiers: [{ count, effects: [], desc: '对照用', mechanics: [] }],
    },
  };
}

/**
 * 三种场景，各自能"照出"不同类别的羁绊效果：
 *   静止 —— 只看出**属性类**（加成 / 光环 / 射程 / 开局护盾 / 开局召唤）
 *   挨打 —— 才看得出**阵亡触发类**（不屈复活、数值继承、亡语）
 *   治疗 —— 才看得出**治疗量加成类**
 * 只用一种场景扫，必然会把后两类误判成"不生效" —— 这正是第一版探针犯的错。
 */
type Scenario = '静止' | '挨打' | '治疗';

const SCENARIOS: Scenario[] = ['静止', '挨打', '治疗'];

function buildTeamsFor(
  traitId: string,
  count: number,
  real: boolean,
  scenario: Scenario,
): { defs: UnitDefTable; teams: [TeamSetup, TeamSetup] } {
  const prefix = real ? 'r' : 'n';
  const tag = real ? traitId : EMPTY_TRAIT;
  const ids = Array.from({ length: count }, (_, index) => `${prefix}_${traitId}_${index}`);

  const memberBase: Partial<UnitDef['base']> =
    scenario === '治疗' ? { hp: 500, attackDamage: 100 } : { hp: 1000, attackDamage: 100 };

  const defs = tableOf([
    ...ids.map((id, index) =>
      makeDef(id, [tag], {
        ...memberBase,
        // ★ 让"最高生命值"这类选择有唯一解，避免平局掩盖继承类效果
        ...(index === 0 ? { hp: (memberBase.hp ?? 1000) + 500 } : {}),
        ...(scenario === '治疗' && index === 0 ? { range: 3 } : {}),
        // ★ 第一个成员带"攻击时治疗"，用来照出 healingBp
        ...(scenario === '治疗' && index === 0 ? ({ healOnAttack: { basis: 'attack', ratioBp: 5000 } } as never) : {}),
      }),
    ),
    makeDef('dummy', [], {
      hp: 1000000,
      attackDamage: scenario === '挨打' ? 100000 : 0,
      attackSpeed: scenario === '挨打' ? 5000 : 0,
    }),
  ]);

  // 半场 5 列 × 10 行（col 0..4 / row 0..9），够摆下最高档 11 人
  const cells = Array.from({ length: 60 }, (_, index) => ({
    col: 4 - Math.floor(index / 10),
    row: index % 10,
  })).filter((cell) => cell.col >= 0);

  const traits = real ? TRAIT_DEFS : emptyTraits(count);
  return {
    defs,
    teams: [
      buildTeam(
        0,
        ids.map((defId, index) => ({ defId, cell: cells[index]! })),
        defs,
        traits,
      ),
      buildTeam(1, [{ defId: 'dummy', cell: { col: 5, row: 4 } }], defs, traits),
    ],
  };
}

function main(): void {
  const rows: Array<{ id: string; name: string; tier: number; results: Map<Scenario, string[]> }> = [];

  for (const [traitId, def] of Object.entries(TRAIT_DEFS)) {
    const lastTier = def.tiers[def.tiers.length - 1];
    if (!lastTier) continue;
    const count = lastTier.count;
    const results = new Map<Scenario, string[]>();

    for (const scenario of SCENARIOS) {
      const realBuilt = buildTeamsFor(traitId, count, true, scenario);
      const nullBuilt = buildTeamsFor(traitId, count, false, scenario);
      const a = snapshotOf(realBuilt.defs, realBuilt.teams, 20250101);
      const b = snapshotOf(nullBuilt.defs, nullBuilt.teams, 20250101);
      const diff: string[] = [];
      for (const key of Object.keys(a) as Array<keyof Snapshot>) {
        if (a[key] !== b[key]) diff.push(`${key}: ${b[key]} -> ${a[key]}`);
      }
      results.set(scenario, diff);
    }
    rows.push({ id: traitId, name: def.name, tier: count, results });
  }

  console.log('\n===== 羁绊效果对拍（真羁绊 vs 空羁绊，档位开满）=====\n');
  for (const row of rows) {
    const allEmpty = SCENARIOS.every((scenario) => (row.results.get(scenario) ?? []).length === 0);
    console.log(
      `${row.id.padEnd(12)} ${row.name.padEnd(8)} 档位${String(row.tier).padStart(2)}人  ` +
        (allEmpty ? '★★★ 三种场景全无差异（疑似不生效）' : '生效'),
    );
    for (const scenario of SCENARIOS) {
      const diff = row.results.get(scenario) ?? [];
      if (diff.length === 0) continue;
      console.log(`      [${scenario}] ${diff.join(' | ')}`);
    }
  }
  console.log('');
}

main();
