import { ARENA_H, ARENA_W, BOARD_H, BOARD_W } from '../src/constants.js';
import type { Cell } from '../src/types.js';

/**
 * ============================================================
 *  测试用的坐标辅助
 * ============================================================
 *
 * 【为什么要有这个文件？】
 * 我把棋盘尺寸改了好几次（每方 4×6 → 10×5 → 5×10），
 * 每次都有 5~8 个测试同时失败 —— 因为它们把坐标写死成了 `{ col: 3, row: 2 }`。
 * 更糟的是报错信息写着「放错半场了」，完全看不出真正原因是「测试用了旧尺寸」。
 *
 * 所以所有和棋盘尺寸相关的坐标都从这里取。
 * 以后再改尺寸，测试会自动跟着新尺寸走，不需要逐个去改。
 *
 * 【当前布局】总棋盘 10 宽 × 20 长；每方 5 宽（列）× 10 深（行），左右对峙。
 */

/** 队伍 0（左半边）最靠中线的一列 */
export const TEAM0_FRONT_COL = ARENA_W - 1;

/** 队伍 1（右半边）最靠中线的一列 */
export const TEAM1_FRONT_COL = ARENA_W;

/** 队伍 0 最后方的一列 */
export const TEAM0_BACK_COL = 0;

/** 队伍 1 最后方的一列 */
export const TEAM1_BACK_COL = BOARD_W - 1;

/** 棋盘正中的一行 */
export const MID_ROW = Math.floor(ARENA_H / 2);

/** 队伍 0 半场内的一个格子。colFromBack 0 = 最后方，越大越靠前线 */
export function team0Cell(colFromBack = 0, row = MID_ROW): Cell {
  return { col: Math.min(TEAM0_FRONT_COL, Math.max(0, colFromBack)), row };
}

/** 队伍 1 半场内的一个格子。colFromFront 0 = 最靠中线，越大越靠对方后方 */
export function team1Cell(colFromFront = 0, row = MID_ROW): Cell {
  return { col: Math.min(TEAM1_BACK_COL, TEAM1_FRONT_COL + colFromFront), row };
}

/** 某个逻辑坐标镜像后的列（队伍 0 的位置镜像到队伍 1 的对应位置） */
export function mirrorCol(col: number): number {
  return BOARD_W - 1 - col;
}

/** 一个明确「属于队伍 0」的格子，用于「能放」的断言 */
export function someTeam0Cell(): Cell {
  return team0Cell(0);
}

/** 一个明确「属于队伍 1」的格子，用于「不能放」的断言 */
export function someTeam1Cell(): Cell {
  return team1Cell(0);
}

export { ARENA_H, ARENA_W, BOARD_H, BOARD_W };
