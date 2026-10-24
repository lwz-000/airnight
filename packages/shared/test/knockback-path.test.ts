/**
 * ★ 0.2：见行者「指引」—— **击退路线上的敌人**一并眩晕 + 附伤。
 *
 * ============================================================
 *  【为什么要单独钉一组？】
 * ============================================================
 * 「击退」在这个仓库里早就有了（妮芙的斥力），但它只动**目标那一个**棋子。
 * 见行者的新口径是「若击退路线有其他目标，则**连同目标一同眩晕** 1/2/3 秒，
 * 并对路线上的敌人额外造成 10%/15%/20% 攻击力的物理伤害」——
 * 这是"一条直线上的所有单位"的概念，引擎里没有，所以 0.2 新加了 `pathStun`。
 *
 * 这一组守四件事：
 *   1. 数据真的挂着 `pathStun`（★ 没消费方的字段 = 白写，这个仓库栽过好几次）；
 *   2. 路线上的两个敌人**都中了眩晕**、也都额外掉了血；目标也被眩晕，并被推到 3 格外；
 *   3. ★ 路线上**没人**时整条不生效 —— 不白送控制（只测"有人的时候生效"会漏掉这一半）；
 *   4. 那个"额外伤害"只打路线上的敌人 —— 目标自己不该吃第二次（表里没这么写）。
 */
import { describe, expect, it } from 'vitest';
import {
  MANA_MAX,
  UNIT_DEFS,
  createBattle,
  step,
  type BattleEvent,
  type BattleState,
  type Cell,
  type TeamSetup,
  type UnitPlacement,
  type UnitState,
} from '../src/index.js';
import { MID_ROW, TEAM0_FRONT_COL, team0Cell, team1Cell } from './helpers.js';

const JIANXINGZHE = Object.values(UNIT_DEFS).find((d) => d.name === '见行者')!;
/** 玛恩纳：被动里写了"不主动移动、不主动攻击" ⇒ 当靶子最省事（不会自己走开） */
const TARGET = Object.values(UNIT_DEFS).find((d) => d.name.startsWith('玛恩纳'))!;

type StatusEvent = Extract<BattleEvent, { type: 'status' }>;
type DamageEvent = Extract<BattleEvent, { type: 'damage' }>;

function place(defId: string, star: number, cell: Cell): UnitPlacement {
  return { defId, star, cell };
}

function battle(mine: UnitPlacement[], theirs: UnitPlacement[], seed = 20261016): BattleState {
  const setups: [TeamSetup, TeamSetup] = [
    { team: 0, units: mine },
    { team: 1, units: theirs },
  ];
  return createBattle(UNIT_DEFS, setups, seed);
}

/**
 * 让见行者立刻开技能，跑几 tick 收结果。
 *
 * ★ 目标会在技能里被推走，所以它的**棋子对象要在 step 之前**就抓住 ——
 * 之后按坐标找是找不到的（这正是"击退生效了"的证据）。
 */
function castOnce(count: number, seed = 20261016): {
  state: BattleState;
  caster: UnitState;
  target: UnitState;
  targetHpBefore: number;
  path: Cell[];
} {
  const casterCell = team0Cell(TEAM0_FRONT_COL, MID_ROW);
  // 目标距离 1；路线上的两个分别在距离 2 和 3
  const cells: Cell[] = [team1Cell(0, MID_ROW), team1Cell(1, MID_ROW), team1Cell(2, MID_ROW)];
  const state = battle(
    [place(JIANXINGZHE.id, 3, casterCell)],
    cells.slice(0, count).map((cell) => place(TARGET.id, 1, cell)),
    seed,
  );
  const caster = state.units.find((u) => u.cell.col === casterCell.col && u.cell.row === casterCell.row)!;
  const target = state.units.find((u) => u.cell.col === cells[0]!.col && u.cell.row === cells[0]!.row)!;
  const targetHpBefore = target.hp;
  caster.mana = MANA_MAX;
  for (let i = 0; i < 40 && !state.over; i++) {
    step(state, UNIT_DEFS);
    // 技能一放出来（有眩晕事件）就停 —— 不然被推走的那个会继续挨普攻，血量断言就不干净了
    if (state.log.some((e) => e.type === 'status' && e.status === 'stun')) break;
  }
  return { state, caster, target, targetHpBefore, path: cells.slice(1) };
}

const stunEvents = (state: BattleState): StatusEvent[] =>
  state.log.filter((e): e is StatusEvent => e.type === 'status' && e.status === 'stun');
const damageEvents = (state: BattleState): DamageEvent[] =>
  state.log.filter((e): e is DamageEvent => e.type === 'damage');

/** 按"技能释放那一刻"的坐标找棋子（目标会被推走，所以要先记下来再找） */
function unitAt(state: BattleState, cell: Cell): UnitState | undefined {
  return state.units.find((u) => u.cell.col === cell.col && u.cell.row === cell.row && !u.dead);
}

describe('★ 0.2 见行者「指引」：击退路线上的单位一并眩晕 + 附伤', () => {
  it('数据确实挂着 pathStun，而且是主动技能 + 开局 90% 技力', () => {
    expect(JIANXINGZHE.skill.effects, '表里从"被动"改成了"主动"').toHaveLength(1);
    expect(JIANXINGZHE.skill.startManaBp).toBe(9000);
    const effect = JIANXINGZHE.skill.effects[0]!;
    expect(effect.kind).toBe('damage');
    if (effect.kind !== 'damage') throw new Error('unreachable');
    expect(effect.knockback).toBe(3);
    expect(effect.pathStun, '击退路线上的单位要一并眩晕 —— 这条没有消费方就是白写').toBeDefined();
  });

  it('★ 路线上站着人：目标 + 路线上的两个敌人都被眩晕，后面的两个还额外掉了血', () => {
    const { state, target, path } = castOnce(3);
    // 路线上的两个：技能放完它们还在原地（只有**目标**被推走）
    const onPath = path.map((cell) => unitAt(state, cell)!);
    expect(onPath.every(Boolean), '前置条件：路线上那两个没动过').toBe(true);

    const stunned = stunEvents(state).map((e) => e.targetId);
    expect(stunned, '目标是"连同目标一同眩晕"的那一个').toContain(target.id);
    for (const [i, unit] of onPath.entries()) {
      expect(stunned, `路线第 ${i + 1} 格的敌人也该被眩晕`).toContain(unit.id);
      expect(unit.statuses['stun'] ?? 0, '眩晕要真的写进状态，不是只记一条日志').toBeGreaterThan(0);
      expect(unit.hp, '路线上的敌人还该额外挨一次附伤').toBeLessThan(unit.maxHp);
    }

    // 目标被推到该方向上最远的那一格（3 格）
    expect(target.cell.col, '击退 3 格').toBe(team1Cell(0, MID_ROW).col + 3);
    expect(state.cellToUnit).toContain(target.id);
  });

  it('★ 路线上没人：只击退 + 主伤害，不送眩晕', () => {
    const { state, target } = castOnce(1);
    expect(target.statuses['stun'] ?? 0, '路线空着就不该有眩晕').toBe(0);
    expect(stunEvents(state)).toHaveLength(0);
    // 但击退照旧生效
    expect(target.cell.col).toBe(team1Cell(0, MID_ROW).col + 3);
  });

  it('★ 附伤只打"路线上多出来的敌人"：目标自己只吃一次主伤害', () => {
    const { state, target } = castOnce(3);
    const hitsOnTarget = damageEvents(state).filter((e) => e.targetId === target.id).length;
    expect(hitsOnTarget, '目标只吃那条主伤害（10%/25%/35%），不该再被附伤打第二下').toBe(1);
  });
});
