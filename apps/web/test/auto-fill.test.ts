/**
 * ============================================================
 *  ★ 0.3.4「开战自动补位」
 * ============================================================
 *
 * 用户口径：「竞技场人口没有上满时开战，自动将备战席的干员放到竞技场中，
 *             优先选择中心后方的地块」。
 *
 * 这一组守三件事：
 *   ① 落点顺序真的是「中心 · 后方」—— 先竖着填满最后面一列（从行中间往外），
 *      再往前推一列。顺序写错了玩家看不出来，但会摆出很别扭的阵型；
 *   ② 只补到人口上限为止，多的人留在备战席（不能偷偷把人塞爆）；
 *   ③ 战斗阶段 / 已满 / 备战席空 —— 都是安静地什么都不做，绝不报错。
 */
import { describe, expect, it } from 'vitest';
import { UNIT_DEFS } from '../../../packages/shared/src/index.js';
import {
  autoFillBoardFromBench,
  autoFillCellOrder,
  createGameState,
  popCap,
  type GameState,
} from '../src/game/state.js';

/** 一个能放人的初始状态（1 级人口只有 1，测不出"补满"，所以拉高等级） */
function fresh(): GameState {
  const state = createGameState(20261020);
  state.economy.gold = 100;
  state.economy.level = 8;
  return state;
}

/** 往备战席塞 N 个 1 费干员（费用低、不会自己合成） */
function fillBench(state: GameState, n: number): void {
  const ids = Object.values(UNIT_DEFS)
    .filter((def) => def.cost === 1 && !def.summonOnly && !def.monsterOnly && !def.ascendOnly)
    .map((def) => def.id);
  expect(ids.length).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    state.economy.bench.push({ uid: 900000 + i, defId: ids[i % ids.length]!, star: 1 });
  }
}

describe('★ 0.3.4 落点顺序：中心 · 后方', () => {
  it('蓝方（左半边）从 col 0 的行中间开始，先竖着填满再往前推一列', () => {
    const order = autoFillCellOrder(0);
    // 10 行 × 5 列 = 50 格，覆盖整个半场且不重复
    expect(order).toHaveLength(50);
    expect(new Set(order.map((c) => `${c.col},${c.row}`)).size).toBe(50);

    // 最开始四格：最后面一列（col 0）从中间往外
    expect(order.slice(0, 4)).toEqual([
      { col: 0, row: 4 },
      { col: 0, row: 5 },
      { col: 0, row: 3 },
      { col: 0, row: 6 },
    ]);
    // 前 10 格全是 col 0（先把最后一列填满）
    expect(order.slice(0, 10).every((c) => c.col === 0)).toBe(true);
    // 第 11 格开始才轮到 col 1
    expect(order[10]).toEqual({ col: 1, row: 4 });
  });

  it('红方（右半边）是镜像的：从 col 9 往左推', () => {
    const order = autoFillCellOrder(1);
    expect(order).toHaveLength(50);
    expect(order[0]).toEqual({ col: 9, row: 4 });
    expect(order.slice(0, 10).every((c) => c.col === 9)).toBe(true);
    expect(order[10]).toEqual({ col: 8, row: 4 });
  });
});

describe('★ 0.3.4 自动补位', () => {
  it('人口没满时把备战席的人补上去，补到上限就停', () => {
    const state = fresh();
    const cap = popCap(state);
    expect(cap).toBeGreaterThan(0);
    fillBench(state, cap + 3);

    const placed = autoFillBoardFromBench(state);
    expect(placed).toBe(cap);
    expect(state.placements).toHaveLength(cap);
    // 多出来的人还在备战席
    expect(state.economy.bench).toHaveLength(3);
  });

  it('★ 补上去的位置确实是"中心后方"那一批', () => {
    const state = fresh();
    fillBench(state, 3);
    autoFillBoardFromBench(state);
    const cells = state.placements.map((p) => `${p.cell.col},${p.cell.row}`).sort();
    expect(cells).toEqual(['0,3', '0,4', '0,5']);
  });

  it('已经上满 / 备战席空了 -> 一个都不放（安静返回 0）', () => {
    const state = fresh();
    fillBench(state, 1);
    autoFillBoardFromBench(state);
    expect(state.placements).toHaveLength(1);
    // 备战席已经空了
    expect(autoFillBoardFromBench(state), '没人是正常情况，不该报错也不该乱放').toBe(0);

    const full = fresh();
    fillBench(full, popCap(full) + 2);
    autoFillBoardFromBench(full);
    const before = full.placements.length;
    expect(autoFillBoardFromBench(full), '已经满人口了，再点也不该塞人').toBe(0);
    expect(full.placements).toHaveLength(before);
  });

  it('战斗阶段不补（不能中途改阵容）', () => {
    const state = fresh();
    fillBench(state, 3);
    state.phase = 'battle';
    expect(autoFillBoardFromBench(state)).toBe(0);
    expect(state.placements).toHaveLength(0);
  });

  it('场上已经有人时，优先补空位、不挤掉原来的人', () => {
    const state = fresh();
    // 先在正中间放一个（正常玩家会这么摆）
    fillBench(state, 1);
    autoFillBoardFromBench(state);
    const first = state.placements[0]!;
    expect(first.cell).toEqual({ col: 0, row: 4 });

    fillBench(state, 2); // 再补两个人进备战席
    autoFillBoardFromBench(state);
    expect(state.placements[0], '原来那个还该在原位').toMatchObject({
      uid: first.uid,
      cell: { col: 0, row: 4 },
    });
    expect(state.placements).toHaveLength(3);
  });
});
