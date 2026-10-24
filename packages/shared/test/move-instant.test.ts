/**
 * ============================================================
 *  「走路」和「强制位移」在战斗日志里必须分得开（★ 0.0.3）
 * ============================================================
 *
 * 【为什么要分？】
 * 玩家要求：**走路要更平滑、要有走路动作；瞬移的表现不要改**。
 * 这两件事在日志里原本长得一模一样（都是 `type: 'move'`），
 * 客户端没法区分，只能一律按"快速滑过去"演 —— 于是瞬移看起来像走路、
 * 走路又滑得不够连贯。
 *
 * 【怎么分？】
 *   · `tryMoveToward`（**走路**，一次一格）→ 日志里不写标记；
 *   · `moveUnitTo`（**强制位移**：技能瞬移 / 击退 / 开局站位）→ 写 `instant: true`。
 * 这个标记纯粹是给表现层看的，**不参与校验和** ——
 * 下面最后一条测试就是钉死这一点（否则会给联机同步凭空添一处风险）。
 */
import { describe, expect, it } from 'vitest';
import {
  UNIT_DEFS,
  computeChecksum,
  createBattle,
  moveUnitTo,
  step,
  type BattleEvent,
  type BattleState,
  type TeamSetup,
} from '../src/index.js';

/** 日志里的 move 事件（收窄类型，免得 tsc 说 union 上没有 from/to） */
type MoveEvent = Extract<BattleEvent, { type: 'move' }>;

/** 走到"某一方开始动"为止，返回状态（步数上限防止测试挂死） */
function advance(state: BattleState, steps: number): void {
  for (let i = 0; i < steps && !state.over; i++) step(state, UNIT_DEFS);
}

describe('★ 走路 vs 强制位移', () => {
  it('走路事件不带 instant，而且每次只挪一格', () => {
    const state = createBattle(
      UNIT_DEFS,
      [
        { team: 0, units: [{ defId: 'op11', star: 1, cell: { col: 0, row: 4 } }] },
        { team: 1, units: [{ defId: 'op11', star: 1, cell: { col: 9, row: 4 } }] },
      ],
      11,
    );
    advance(state, 200);

    const walks = state.log.filter((event): event is MoveEvent => event.type === 'move');
    expect(walks.length, '两只近战隔着半场，必须真的走过').toBeGreaterThan(0);
    for (const event of walks) {
      expect(event.instant, '走路不该带 instant').toBeUndefined();
      const dc = Math.abs(event.to.col - event.from.col);
      const dr = Math.abs(event.to.row - event.from.row);
      expect(dc + dr, '走路一次只挪一格（相邻格）').toBe(1);
    }
  });

  it('★ 开局瞬移（“复仇者”追猎）带 instant —— 它就是"不许改"的那种位移', () => {
    const state = createBattle(
      UNIT_DEFS,
      [
        { team: 0, units: [{ defId: 'op01', star: 1, cell: { col: 4, row: 4 } }] },
        { team: 1, units: [{ defId: 'mn_reid', star: 1, cell: { col: 9, row: 9 } }] },
      ],
      7,
    );

    const teleports = state.log.filter(
      (event): event is MoveEvent => event.type === 'move' && event.instant === true,
    );
    expect(teleports, '开局就应该瞬移过去').toHaveLength(1);
    const first = teleports[0]!;
    expect(first.t, '开局效果发生在 t=0').toBe(0);
    // 并且它是"跳过去"的：跨了不止一格（这正是客户端不该把它演成走路的原因）
    const span = Math.abs(first.to.col - first.from.col) + Math.abs(first.to.row - first.from.row);
    expect(span, '瞬移跨了多格').toBeGreaterThan(1);
  });

  it('技能/击退走的 moveUnitTo 也带 instant', () => {
    const state = createBattle(
      UNIT_DEFS,
      [
        { team: 0, units: [{ defId: 'op01', star: 1, cell: { col: 4, row: 4 } }] },
        { team: 1, units: [{ defId: 'op11', star: 1, cell: { col: 9, row: 4 } }] },
      ],
      3,
    );
    const unit = state.units.find((item) => item.team === 0)!;
    moveUnitTo(state, unit, { col: 8, row: 4 });

    const event = state.log[state.log.length - 1]!;
    expect(event.type).toBe('move');
    expect(event.type === 'move' ? event.instant : undefined, '强制位移必须带标记').toBe(true);
    expect(unit.cell, '逻辑位置立刻就到了（它不走路）').toEqual({ col: 8, row: 4 });
  });

  it('★ instant 不进校验和：加不加它，checksum 完全一样', () => {
    const teams: [TeamSetup, TeamSetup] = [
      { team: 0, units: [{ defId: 'op01', star: 1, cell: { col: 4, row: 4 } }] },
      { team: 1, units: [{ defId: 'mn_reid', star: 1, cell: { col: 9, row: 9 } }] },
    ];
    const state = createBattle(UNIT_DEFS, teams, 7);
    advance(state, 400);

    // 这一场既有开局瞬移、又有走路，两种事件都在日志里
    expect(state.log.some((event) => event.type === 'move' && event.instant === true)).toBe(true);
    const before = computeChecksum(state, state.winner, state.tick);

    // 把表现层的标记抹掉（模拟"另一台机器没这个字段"）
    for (const event of state.log) {
      if (event.type === 'move') delete (event as { instant?: true }).instant;
    }
    expect(computeChecksum(state, state.winner, state.tick), '表现层字段不能影响校验和').toBe(before);
  });

  it('校验和确实对"移到哪一格"敏感（否则上一条就是空跑）', () => {
    const teams: [TeamSetup, TeamSetup] = [
      { team: 0, units: [{ defId: 'op01', star: 1, cell: { col: 4, row: 4 } }] },
      { team: 1, units: [{ defId: 'op11', star: 1, cell: { col: 9, row: 4 } }] },
    ];
    const state = createBattle(UNIT_DEFS, teams, 5);
    advance(state, 60);
    expect(state.log.some((event) => event.type === 'move')).toBe(true);

    const before = computeChecksum(state, state.winner, state.tick);
    const firstMove = state.log.find((event): event is MoveEvent => event.type === 'move')!;
    firstMove.to = { col: 0, row: 0 };
    expect(computeChecksum(state, state.winner, state.tick), '挪到哪一格是战斗事实，必须进校验和').not.toBe(before);
  });
});
