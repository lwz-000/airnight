/**
 * ============================================================
 *  ★★ 0.3 盟约「命结之秘」：每场战斗，我方最先阵亡的前 2 个干员立刻原地复活
 * ============================================================
 *
 * 【这条为什么要单独测？】
 * 它是唯一一个**进了战斗内核**的盟约 —— 其余都在客户端（经济 / 商店）里。
 * 内核里的东西一旦写错，联机会直接"校验和不一致"（两边算出的战斗不一样），
 * 而且症状是"打着打着对面卡住"，从日志上根本看不出是盟约。
 *
 * 【守四条】
 *   ① 带这个盟约的那一队：前 2 个死的会满血站起来，第 3 个就真死了；
 *   ② **不带**盟约的那一队一次都不能复活（别把效果给错人）；
 *   ③ 复活不掷骰、不消耗随机数（必定触发 ⇒ 不会让别的概率判定错位）；
 *   ④ 额度是**队伍级**的（不是每只棋子各一次）—— 这条最容易写错。
 */
import { describe, expect, it } from 'vitest';
import {
  TRAIT_DEFS,
  UNIT_DEFS,
  computeActiveTraitLevels,
  computeTraitBonuses,
  computeUnitTraitBonuses,
  createBattle,
  dealDamage,
  resolveUnitMechanics,
  type BattleState,
  type TeamSetup,
  type UnitPlacement,
} from '../src/index.js';

function place(defId: string, col: number, row: number): UnitPlacement {
  return { defId, star: 1, cell: { col, row } };
}

function team(teamId: 0 | 1, units: UnitPlacement[], covenantId?: string): TeamSetup {
  return {
    team: teamId,
    units,
    traitBonuses: computeTraitBonuses(units, UNIT_DEFS, TRAIT_DEFS),
    unitTraitBonuses: computeUnitTraitBonuses(units, UNIT_DEFS, TRAIT_DEFS),
    activeTraits: computeActiveTraitLevels(units, UNIT_DEFS, TRAIT_DEFS),
    unitMechanics: resolveUnitMechanics(units, UNIT_DEFS, TRAIT_DEFS),
    ...(covenantId ? { covenantId } : {}),
  };
}

/** 我方 3 只（不选那些自带复活的棋子），对面一只不动的靶子 */
function makeBattle(myCovenant?: string): BattleState {
  return createBattle(
    UNIT_DEFS,
    [
      team(0, [place('op01', 3, 3), place('op02', 3, 5), place('op03', 3, 7)], myCovenant),
      team(1, [place('op13', 8, 5)]),
    ],
    20261020,
  );
}

/** 一刀打死（真伤，无视护甲/盾） */
function kill(state: BattleState, index: number): void {
  const victim = state.units[index]!;
  // ★ 伤害必须能追溯到来源（内核会直接报错）—— 这里拿对面那只当施法者
  const source = state.units.find((unit) => unit.team === 1)!;
  dealDamage(state, source, victim, victim.maxHp * 3, 'true', 'attack');
}

describe('★ 0.3 盟约「命结之秘」：我方前 2 个阵亡的干员复活一次', () => {
  it('★★ 前 2 个死掉的会满血站起来，第 3 个就真死了', () => {
    const state = makeBattle('cv_emengarde');
    // 只取我方（team 0）的三只
    const mine = state.units.filter((unit) => unit.team === 0);
    expect(mine).toHaveLength(3);

    kill(state, state.units.indexOf(mine[0]!));
    expect(mine[0]!.dead, '第 1 个应该被盟约拉起来').toBe(false);
    expect(mine[0]!.hp, '复活后血量回满').toBe(mine[0]!.maxHp);

    kill(state, state.units.indexOf(mine[1]!));
    expect(mine[1]!.dead, '第 2 个也能被拉起来').toBe(false);
    expect(state.covenantRevives[0], '额度用满了 2 次').toBe(2);

    kill(state, state.units.indexOf(mine[2]!));
    expect(mine[2]!.dead, '★ 第 3 个就真的死了（额度只有 2 次，不是每只一次）').toBe(true);
    expect(state.covenantRevives[0], '额度不会超过 2').toBe(2);
  });

  it('★ 不带这个盟约的队伍一次都不会复活', () => {
    const state = makeBattle('cv_golia');
    const mine = state.units.filter((unit) => unit.team === 0);
    kill(state, state.units.indexOf(mine[0]!));
    expect(mine[0]!.dead, '别的盟约不该顺手给复活').toBe(true);
    expect(state.covenantRevives[0]).toBe(0);
  });

  it('★ 完全没选盟约（老客户端）也不炸、也不复活', () => {
    const state = makeBattle(undefined);
    const mine = state.units.filter((unit) => unit.team === 0);
    kill(state, state.units.indexOf(mine[0]!));
    expect(mine[0]!.dead).toBe(true);
    expect(state.covenantIds[0]).toBeUndefined();
  });

  it('★ 记录一条 rebirth 事件（日志/特效要知道这是"复活"而不是"掉线")', () => {
    const state = makeBattle('cv_emengarde');
    const mine = state.units.filter((unit) => unit.team === 0);
    const before = state.log.length;
    kill(state, state.units.indexOf(mine[0]!));
    const rebirth = state.log
      .slice(before)
      .find((event) => event.type === 'rebirth' && event.unitId === mine[0]!.id);
    expect(rebirth, '要有一条 rebirth 事件').toBeDefined();
    expect(rebirth!.type === 'rebirth' && rebirth!.phase, 'phase 0 = 盟约复活（1 = 不屈）').toBe(0);
  });

  /**
   * ★★ 不掷骰 = 不消费随机数。
   * 一旦多掷一次，整场战斗的随机序列会整体错位 —— 那正是"两边算出来不一样"的经典来源。
   * 这里把 rng 换成一个"记次数"的探针，断言复活过程中一次都没掷。
   */
  it('★★ 必定复活，不掷骰（不能推动随机数序列）', () => {
    const state = makeBattle('cv_emengarde');
    let rolls = 0;
    const original = state.rng.nextInt.bind(state.rng);
    state.rng.nextInt = (max: number) => {
      rolls += 1;
      return original(max);
    };
    const mine = state.units.filter((unit) => unit.team === 0);
    kill(state, state.units.indexOf(mine[0]!));
    expect(rolls, '复活这条路不该掷骰').toBe(0);
  });
});
