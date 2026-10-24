/**
 * ============================================================
 *  ★★ 0.2.1 玛恩纳：1/2 星"开了技能也不能移动"
 * ============================================================
 *
 * 【用户报的】「修复玛恩纳 1.2 星开了技能也不能移动的问题」。
 *
 * 【根因】
 * 玛恩纳的 1/2 星技能里带一条**常驻被动**：`passive: { noMove: true, noAttack: true }`
 * （"没有技能时不主动移动和攻击"）。开局时它被烘成一个 `passive: true` 的常驻包。
 * 而技能包只写了 `noAttack: false` —— **漏了 `noMove: false`**。
 * `mods.ts` 里这两个布尔字段都是"**后写的说了算**"（数值才累加），
 * 所以技能包不显式写 false，被动包那句 `noMove: true` 就一直是最终值：
 * 他能打人了，但一步都不走 —— 远程敌人躲在他射程外就永远打不到。
 *
 * 【为什么这条必须用"真的有没有走过"来验？】
 * 只看 `mods.noMove` 也能过，但那是"读回自己写的数据"。
 * 所以这里加一条实战：同样的棋盘、同样的步数，
 * **开技前一步不动、开技后必须真的迈步**（负对照）。
 */
import { describe, expect, it } from 'vitest';
import {
  UNIT_DEFS,
  castSkill,
  collectMods,
  createBattle,
  skillVariantOf,
  step,
  type BattleEvent,
  type BattleState,
  type UnitState,
} from '../src/index.js';

const MLYNAR = 'op47';
type MoveEvent = Extract<BattleEvent, { type: 'move' }>;

/** 他的射程是 3，这里把对手放到最远的对角 —— 不开技就够不着，开技必须走过去 */
function standoff(star: 1 | 2 | 3): { state: BattleState; me: UnitState; foe: UnitState } {
  const state = createBattle(
    UNIT_DEFS,
    [
      { team: 0, units: [{ defId: MLYNAR, star, cell: { col: 0, row: 4 } }] },
      {
        team: 1,
        units: [
          {
            defId: 'mn_duholy',
            star: 3,
            cell: { col: 9, row: 4 },
            // 血厚、几乎不还手：这样"他走了没有"只由他自己决定
            statOverride: { hp: 100_000_000, armor: 0, magicResist: 0, attackSpeed: 0.01 },
          },
        ],
      },
    ],
    20261017,
  );
  return {
    state,
    me: state.units.find((unit) => unit.team === 0)!,
    foe: state.units.find((unit) => unit.team === 1)!,
  };
}

function advance(state: BattleState, steps: number): void {
  for (let i = 0; i < steps && !state.over; i++) step(state, UNIT_DEFS);
}

function movesOf(state: BattleState, unitId: number): MoveEvent[] {
  return state.log.filter((event): event is MoveEvent => event.type === 'move' && event.unitId === unitId);
}

describe('玛恩纳：没技能不动，开了技能就该能动', () => {
  it('数据层：技能包里必须显式写 noMove: false（和 noAttack 成对）', () => {
    for (const star of [1, 2] as const) {
      const variant = skillVariantOf(UNIT_DEFS[MLYNAR]!, star);
      const buffStats = variant.effects
        .filter((item) => item.kind === 'buff')
        .map((item) => (item as unknown as { stats: Record<string, unknown> }).stats);
      const withNoMove = buffStats.find((stats) => 'noMove' in stats);
      expect(withNoMove, `${star} 星技能必须带上 noMove 字段`).toBeDefined();
      expect(withNoMove!.noMove, `${star} 星技能要解开"不能移动"`).toBe(false);
      expect(withNoMove!.noAttack, `${star} 星技能要解开"不能攻击"`).toBe(false);
      // 被动本身还在（没技能时仍然不动）
      expect(UNIT_DEFS[MLYNAR]!.skill.passive?.noMove, '被动仍然不许他乱走').toBe(true);
    }
  });

  it('1 星：开技前 noMove=true，开技后 noMove=false（修的就是这一条）', () => {
    const { state, me } = standoff(1);
    expect(collectMods(state, me).noMove, '没技能时不动').toBe(true);

    castSkill(state, me, UNIT_DEFS[MLYNAR]!.skill.id, skillVariantOf(UNIT_DEFS[MLYNAR]!, 1).effects, UNIT_DEFS);
    expect(collectMods(state, me).noMove, '开技之后必须解开').toBe(false);
    expect(collectMods(state, me).noAttack, '开技之后能打人').toBe(false);
  });

  it('2 星：同样开技后可移动', () => {
    const { state, me } = standoff(2);
    castSkill(state, me, UNIT_DEFS[MLYNAR]!.skill.id, skillVariantOf(UNIT_DEFS[MLYNAR]!, 2).effects, UNIT_DEFS);
    expect(collectMods(state, me).noMove).toBe(false);
  });

  it('3 星：本来就没有 noMove 被动（不能被这次改动带回来）', () => {
    const { state, me } = standoff(3);
    expect(collectMods(state, me).noMove, '3 星只生效 3 星技能，被动不该留下').toBe(false);
  });

  it('★ 实战负对照：同样的棋盘，开技前一步不走、开技后必须真的走', () => {
    /*
      ★ 窗口只能用 200 tick（10 秒）—— 不能用 30 秒。
      他的被动是"**没有技能时**不移动"，而技力是自动回的（75/秒 ⇒ 约 13.4 秒满），
      满蓝那一刻他会**自己**开技能、然后就能走了。窗口拉太长的话，
      "没技能时一步不走"这条断言测的其实是"20 秒以后"，必然失败。
    */
    // ① 不开技能：10 秒里一步都不该走（noMove 生效）
    const idle = standoff(1);
    advance(idle.state, 200);
    expect(movesOf(idle.state, idle.me.id).length, '没技能时不能移动').toBe(0);

    // ② 同样摆位、同样 10 秒，但一开局就放技能：必须走过去
    const casted = standoff(1);
    castSkill(
      casted.state,
      casted.me,
      UNIT_DEFS[MLYNAR]!.skill.id,
      skillVariantOf(UNIT_DEFS[MLYNAR]!, 1).effects,
      UNIT_DEFS,
    );
    advance(casted.state, 200);
    const moves = movesOf(casted.state, casted.me.id);
    expect(moves.length, '开技之后必须真的迈步（不然远程敌人永远够不着）').toBeGreaterThan(0);
    // 而且是朝对手方向走的（列号变大）
    expect(moves[moves.length - 1]!.to.col).toBeGreaterThan(0);
  });
});
