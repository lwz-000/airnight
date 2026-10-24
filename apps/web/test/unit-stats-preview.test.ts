/**
 * ============================================================
 *  ★ 0.0.3：干员详情页的数值口径
 * ============================================================
 *
 * 【这组测试钉的是两件事】
 *   ① **单位**：交给界面的必须是"面板值"——攻击力 750 就是 750，
 *      攻速 1.2 就是 1.2 次/秒。战斗内核里的数都是 ×1000 的定点数，
 *      哪一层忘了除，玩家就会在详情页看到 `675000` 这种数字
 *      （用户报的"干员详细页面的数据显示过大"）。
 *   ② **内容**：详情页看到的必须是"开战时真正会用"的数字 ——
 *      星级、羁绊、穿戴藏品、共享藏品全都算进去，
 *      凑一个羁绊上去、数字要真的跟着变（"羁绊加减实时显示"）。
 *
 * 实现走 game/state.ts 的 previewUnitStats（内部就是 toTeamSetup + createBattle，
 * 和开战同一个入口），战斗中那一路（replay.liveStatsOf）用的是同一套换算。
 */
import { describe, expect, it } from 'vitest';
import {
  createGameState,
  previewUnitStats,
  toTeamSetup,
  type GameState,
} from '../src/game/index.js';
import {
  TRAIT_DEFS,
  UNIT_DEFS,
  collectMods,
  createBattle,
  effectiveArmor,
  effectiveAttackDamage,
  effectiveAttackSpeed,
  effectiveMagicResist,
  effectiveRange,
  playableDefs,
  type UnitDef,
} from '../../../packages/shared/src/index.js';
import { ownCell } from './helpers.js';

type Cell = { col: number; row: number };

/** 直接往场上塞一个棋子（绕开经济，专注数值口径） */
function feedBoard(state: GameState, defId: string, cell: Cell, star = 1): void {
  state.placements.push({ uid: 100 + state.placements.length, defId, star, cell: { ...cell } });
}

/** 挑一个"1 个人在场时什么羁绊都不激活"的干员（不然没法测白板） */
function lonerDef(): UnitDef {
  const candidates = playableDefs().filter((def) =>
    def.traits.every((traitId) => {
      const trait = TRAIT_DEFS[traitId];
      // 第一档要 2 个人起步 -> 单人在场不会激活
      return !trait || (trait.tiers[0]?.count ?? 2) >= 2;
    }),
  );
  const picked = candidates[0] ?? playableDefs()[0]!;
  return picked;
}

/**
 * 找一对"共享同一个羁绊、而且那个羁绊的第一档是数值加成"的干员。
 * 数据以后怎么改都能重新找到（找不到就让测试红 —— 说明挑选逻辑过时了）。
 */
function statPair(): [UnitDef, UnitDef, string] {
  const STAT_EFFECTS = new Set(['hpBp', 'attackDamageBp', 'attackSpeedBp', 'armorFlat', 'magicResistFlat']);
  const ops = playableDefs();
  for (const a of ops) {
    for (const b of ops) {
      if (a.id >= b.id) continue;
      const shared = a.traits.find((traitId) => b.traits.includes(traitId));
      if (!shared) continue;
      const trait = TRAIT_DEFS[shared];
      const tier = trait?.tiers[0];
      if (!tier || tier.count !== 2) continue;
      if (!tier.effects.some((effect) => STAT_EFFECTS.has(effect.type))) continue;
      return [a, b, shared];
    }
  }
  throw new Error('找不到一对凑数值羁绊的干员 —— 挑选逻辑需要更新');
}

describe('★ 详情页数值：单位（面板值，不是内核定点数）', () => {
  it('一个人的白板：攻击=面板攻击力、攻速=每秒几次、护甲魔抗=面板值', () => {
    const state = createGameState(11);
    const def = lonerDef();
    const cell = ownCell(0, 1);
    feedBoard(state, def.id, cell);

    const stats = previewUnitStats(state, cell)!;
    expect(stats, '场上有人却拿不到预览数值').not.toBeNull();
    expect(stats.attackDamage, '攻击力必须是面板值（÷FIX 之后）').toBe(def.base.attackDamage);
    expect(stats.hp).toBe(def.base.hp);
    expect(stats.armor).toBe(def.base.armor);
    expect(stats.magicResist).toBe(def.base.magicResist);
    expect(stats.range).toBe(def.base.range);
    expect(stats.attackSpeed, '攻速必须换算成"每秒几次"').toBeCloseTo(def.base.attackSpeed / 1000, 5);
  });

  it('场上一个人都没有 -> 返回 null（界面退回白板，不会炸）', () => {
    const state = createGameState(3);
    expect(previewUnitStats(state, ownCell(0, 1))).toBeNull();
  });

  it('二星：数值按星级倍率走（不是白板的一星值）', () => {
    const state = createGameState(11);
    const def = playableDefs().find((item) => item.starHpBp !== 1000) ?? playableDefs()[0]!;
    const cell = ownCell(0, 1);
    feedBoard(state, def.id, cell, 2);
    const stats = previewUnitStats(state, cell)!;
    const mul = (1000 + (def.starHpBp - 1000)) / 1000;
    expect(stats.hp).toBe(Math.round(def.base.hp * mul));
  });
});

describe('★ 详情页数值：羁绊加减要真的体现出来', () => {
  it('凑上第二个同羁绊干员后，吃加成的那位数值变大', () => {
    const [a, b, traitId] = statPair();
    const state = createGameState(11);
    const cellA = ownCell(0, 1);
    const cellB = ownCell(1, 1);
    feedBoard(state, a.id, cellA);

    const alone = previewUnitStats(state, cellA)!;
    // 对照：另一个格子上的白板（同一个人，只是位置不同）
    feedBoard(state, b.id, cellB);
    const paired = previewUnitStats(state, cellA)!;

    const total = (s: typeof alone) => s.hp + s.attackDamage + s.armor + s.magicResist + s.attackSpeed * 100;
    expect(total(paired), `凑了 ${TRAIT_DEFS[traitId]?.name} 之后至少要有一项数值变大`).toBeGreaterThan(
      total(alone),
    );
  });
});

describe('★ 详情页数值：和真开战用的数字一致', () => {
  it('previewUnitStats == createBattle 里那枚棋子的最终属性（同一套换算）', () => {
    const state = createGameState(23);
    const def = lonerDef();
    const cell = ownCell(0, 1);
    feedBoard(state, def.id, cell, 3); // 三星：连 3 星质变的血量都要对上

    const preview = previewUnitStats(state, cell)!;
    const setup = toTeamSetup(state);
    const battle = createBattle(UNIT_DEFS, [setup, { team: 1, units: [] }], 5);
    const unit = battle.units.find((item) => item.cell.col === cell.col && item.cell.row === cell.row)!;
    const mods = collectMods(battle, unit);

    expect(preview.hp).toBe(Math.round(unit.maxHp / 1000));
    expect(preview.attackDamage).toBe(Math.round(effectiveAttackDamage(unit, mods) / 1000));
    expect(preview.armor).toBe(Math.round(effectiveArmor(unit, mods) / 1000));
    expect(preview.magicResist).toBe(Math.round(effectiveMagicResist(unit, mods) / 1000));
    expect(preview.attackSpeed).toBeCloseTo(effectiveAttackSpeed(unit, mods) / 1000, 5);
    expect(preview.range).toBe(effectiveRange(battle, unit));
  });
});
