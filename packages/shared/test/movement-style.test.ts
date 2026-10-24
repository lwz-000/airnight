/**
 * 移动方式（四方向）的测试。
 *
 * 【为什么这组测试重要？】
 * "只能上下左右走"这件事，如果实现错了**不会报错**：
 * 棋子照样动、战斗照样打完，只是斜着滑了一步。
 * 所以必须从三个层面钉住：
 *   1. 距离算法（曼哈顿 vs 切比雪夫）
 *   2. 候选格子（4 个还是 8 个）
 *   3. **真实战斗的事件日志里，出现的每一步都必须满足 |Δ列| + |Δ行| === 1**
 * 第 3 条最关键 —— 它验证的是"实际跑出来的行为"，不是"我以为的规则"。
 */

import { describe, expect, it } from 'vitest';
import {
  BOARD_H,
  BOARD_W,
  UNIT_DEFS,
  cellDistance,
  createBattle,
  findStepToward,
  moveStyleOf,
  neighborsOf,
  pickUnitOfCost,
  simulate,
  type BattleEvent,
  type BattleState,
  type Cell,
  type TeamSetup,
} from '../src/index.js';

const CENTER: Cell = { col: 3, row: 4 };

describe('距离算法', () => {
  it('四方向（默认）用曼哈顿距离：斜前方算 2 格', () => {
    expect(cellDistance({ col: 0, row: 0 }, { col: 1, row: 0 })).toBe(1);
    expect(cellDistance({ col: 0, row: 0 }, { col: 0, row: 1 })).toBe(1);
    expect(cellDistance({ col: 0, row: 0 }, { col: 1, row: 1 })).toBe(2); // 斜的不是 1
    expect(cellDistance({ col: 0, row: 0 }, { col: 3, row: 2 })).toBe(5);
  });

  it('八方向（any）用切比雪夫距离：斜前方算 1 格', () => {
    expect(cellDistance({ col: 0, row: 0 }, { col: 1, row: 1 }, 'any')).toBe(1);
    expect(cellDistance({ col: 0, row: 0 }, { col: 3, row: 2 }, 'any')).toBe(3);
  });

  it('moveStyleOf：没写就是四方向', () => {
    expect(moveStyleOf({})).toBe('orthogonal');
    expect(moveStyleOf({ moveStyle: undefined })).toBe('orthogonal');
    expect(moveStyleOf({ moveStyle: 'any' })).toBe('any');
  });
});

describe('候选格子', () => {
  it('四方向：棋盘中间有 4 个，且都不斜', () => {
    const cells = neighborsOf(CENTER, 'orthogonal');
    expect(cells).toHaveLength(4);
    for (const cell of cells) {
      const step = Math.abs(cell.col - CENTER.col) + Math.abs(cell.row - CENTER.row);
      expect(step, `(${cell.col},${cell.row}) 不是四方向的一步`).toBe(1);
    }
  });

  it('八方向：棋盘中间有 8 个', () => {
    expect(neighborsOf(CENTER, 'any')).toHaveLength(8);
  });

  it('在角落里四方向只有 2 个（不会跑出棋盘）', () => {
    const corner = neighborsOf({ col: 0, row: 0 }, 'orthogonal');
    expect(corner).toHaveLength(2);
    for (const cell of corner) {
      expect(cell.col).toBeGreaterThanOrEqual(0);
      expect(cell.row).toBeGreaterThanOrEqual(0);
      expect(cell.col).toBeLessThan(BOARD_W);
      expect(cell.row).toBeLessThan(BOARD_H);
    }
  });

  it('顺序固定（换个实现就可能改走位，联机两边会分叉）', () => {
    expect(neighborsOf(CENTER, 'orthogonal')).toEqual([
      { col: 3, row: 3 },
      { col: 2, row: 4 },
      { col: 4, row: 4 },
      { col: 3, row: 5 },
    ]);
  });
});

describe('找路', () => {
  /** 造一个只有一枚我方棋子的战场，用来单测"下一步走哪" */
  function soloState(cell: Cell): BattleState {
    const setup: TeamSetup = { team: 0, units: [{ defId: pickUnitOfCost(1), star: 1, cell }] };
    return createBattle(UNIT_DEFS, [setup, { team: 1, units: [] }], 1);
  }

  it('斜前方一步走不到，只能先横着或竖着走一格', () => {
    const state = soloState({ col: 2, row: 2 });
    const step = findStepToward(state, { col: 2, row: 2 }, { col: 4, row: 4 }, 'orthogonal');
    expect(step).not.toBeNull();
    expect(Math.abs(step!.col - 2) + Math.abs(step!.row - 2)).toBe(1);
  });

  it('同一局面用八方向就会斜着走（说明这个开关真的有用）', () => {
    const state = soloState({ col: 2, row: 2 });
    const step = findStepToward(state, { col: 2, row: 2 }, { col: 4, row: 4 }, 'any');
    // 斜着走一步就把切比雪夫距离从 2 降到 1，所以它会直接走对角
    expect(step).toEqual({ col: 3, row: 3 });
    expect(Math.abs(step!.col - 2) + Math.abs(step!.row - 2)).toBe(2); // 确实是斜的
  });
});

describe('★ 真实战斗里不能出现斜向移动', () => {
  /** 摆一场必然会互相靠近的战斗，返回它的移动事件 */
  function moveEventsOf(seed: number): BattleEvent[] {
    const team0: TeamSetup = {
      team: 0,
      units: [
        { defId: pickUnitOfCost(1), star: 1, cell: { col: 4, row: 0 } },
        { defId: pickUnitOfCost(1), star: 1, cell: { col: 4, row: 3 } },
        { defId: pickUnitOfCost(1), star: 1, cell: { col: 3, row: 6 } },
      ],
    };
    const team1: TeamSetup = {
      team: 1,
      units: [
        { defId: pickUnitOfCost(2), star: 1, cell: { col: 5, row: 1 } },
        { defId: pickUnitOfCost(2), star: 1, cell: { col: 5, row: 8 } },
        { defId: pickUnitOfCost(3), star: 1, cell: { col: 7, row: 4 } },
      ],
    };
    return simulate(UNIT_DEFS, [team0, team1], seed).log.filter((event) => event.type === 'move');
  }

  it('每一步都满足 |Δ列| + |Δ行| === 1', () => {
    const moves = moveEventsOf(20250101);
    expect(moves.length, '这场战斗应该发生了移动，否则测试没意义').toBeGreaterThan(0);
    for (const event of moves) {
      if (event.type !== 'move') continue;
      const step = Math.abs(event.to.col - event.from.col) + Math.abs(event.to.row - event.from.row);
      expect(
        step,
        `发现斜向/跳跃移动：(${event.from.col},${event.from.row}) -> (${event.to.col},${event.to.row})`,
      ).toBe(1);
    }
  });

  it('跑 10 个不同种子都不出现斜向移动', () => {
    let totalMoves = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const moves = moveEventsOf(seed * 7919);
      totalMoves += moves.length;
      for (const event of moves) {
        if (event.type !== 'move') continue;
        const step = Math.abs(event.to.col - event.from.col) + Math.abs(event.to.row - event.from.row);
        expect(step, `出现斜向移动（种子 ${seed * 7919}）`).toBe(1);
      }
    }
    expect(totalMoves).toBeGreaterThan(0);
  });
});
