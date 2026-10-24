import { ARENA_W, BOARD_H, BOARD_W } from '../../../packages/shared/src/constants.js';
import type { Cell } from '../../../packages/shared/src/types.js';

/**
 * 客户端测试用的坐标辅助。
 *
 * 【为什么需要它？】
 * 棋盘尺寸改过好几次，每次客户端测试都有 5 个用例失败 ——
 * 因为坐标都写死成了 `{ col: 3, row: 2 }` 这类字面量。
 * 所以和棋盘尺寸有关的坐标一律从这里取，改尺寸时测试自动跟上。
 *
 * 【当前布局】总棋盘 10 宽 × 20 长；每方 5 宽 × 10 深，左右对峙。
 */

/** 自己（队伍 0）半场最靠中线的一列 */
export const OWN_FRONT_COL = ARENA_W - 1;

/** 对手（队伍 1）半场最靠中线的一列 */
export const ENEMY_FRONT_COL = ARENA_W;

/** 棋盘最后一列 */
export const LAST_COL = BOARD_W - 1;

/** 棋盘最后一行 */
export const LAST_ROW = BOARD_H - 1;

/** 造一个自己半场内的坐标。colFromBack 0 = 最后方，越大越靠前线 */
export function ownCell(colFromBack = 0, row = 1): Cell {
  return { col: Math.min(OWN_FRONT_COL, Math.max(0, colFromBack)), row };
}

/** 造一个对手半场内的坐标。colFromFront 0 = 最靠中线 */
export function enemyCell(colFromFront = 0, row = 1): Cell {
  return { col: Math.min(LAST_COL, ENEMY_FRONT_COL + colFromFront), row };
}

/** 一个明确在对手半场的格子（用于「不能放」的断言） */
export function someEnemyCell(): Cell {
  return enemyCell(0);
}

/** 逻辑坐标镜像后的列 */
export function mirrorColOf(col: number): number {
  return LAST_COL - col;
}

export { ARENA_W, BOARD_H, BOARD_W };
