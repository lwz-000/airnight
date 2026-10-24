import { ARENA_H, ARENA_W, BOARD_H, BOARD_W, TEAM_0_MAX_COL, type Cell } from '../../../../packages/shared/src/index.js';

/**
 * ============================================================
 *  棋盘坐标数学（纯函数，零依赖）
 * ============================================================
 *
 * 【为什么单独拆出这个文件？】
 * 这里的每个函数都只是「数字进、数字出」，不需要 Three.js、不需要浏览器。
 * 好处有两点：
 *   1. 可以在 Node 里直接单元测试（联机时「我的棋子在不在左下角」全靠这些函数）
 *   2. 3D 层和逻辑层都能用同一份实现，不会出现两套算法算出不同结果
 *
 * 如果把这些函数写在 board.ts 里，测试就得先把整个 Three.js + WebGL 环境搭起来，
 * 成本高得多，而且容易因为环境问题误报失败。
 */

/** 一格在世界里的边长 */
export const CELL = 1.0;

/** 棋盘世界总尺寸 */
export const BOARD_WORLD_W = BOARD_W * CELL;
export const BOARD_WORLD_H = BOARD_H * CELL;

/**
 * 格子坐标 -> 世界坐标。
 *
 * 约定：
 *   col 0..7 从左到右  ->  x 负到正（棋盘左右居中）
 *   row 0..5 从远到近  ->  z 负到正（棋盘前后居中）
 *   y 是高度
 */
export function cellToWorldPoint(cell: Cell, y = 0): { x: number; y: number; z: number } {
  return {
    x: (cell.col - (BOARD_W - 1) / 2) * CELL,
    y,
    z: (cell.row - (BOARD_H - 1) / 2) * CELL,
  };
}

/** 世界坐标 -> 格子坐标（可能越界，调用方自己检查） */
export function worldPointToCell(x: number, z: number): Cell {
  return {
    col: Math.round(x / CELL + (BOARD_W - 1) / 2),
    row: Math.round(z / CELL + (BOARD_H - 1) / 2),
  };
}

/** 格子是否在棋盘内 */
export function isOnBoard(cell: Cell): boolean {
  return cell.col >= 0 && cell.col < BOARD_W && cell.row >= 0 && cell.row < BOARD_H;
}

/**
 * 「范围半径」→ 世界半径（格）。
 *
 * `radius` 是**方格半径**（radius 1 = 3×3），所以覆盖到的世界宽度是 `2×radius + 1` 格，
 * 世界半径就是 `radius + 0.5`。
 *
 * 【为什么必须抽出来？】
 * 界面上的范围白框（`squareRect`）、血镰光环（`letoRingRadius`）、
 * 回血光环（`heal-halo-fx.ts`）都按这一个数摆 —— 一旦哪边自己算一遍，
 * 就会出现"特效扫出白框外"这种对不上的情况（血镰那边已经踩过一次）。
 */
export function zoneWorldRadius(radius: number): number {
  // ★ NaN / Infinity 一律当 0：`Math.max(0, NaN)` 还是 NaN，
  //   而 NaN 半径喂给 RingGeometry 会直接把几何算烂（画面整块消失）
  const safe = Number.isFinite(radius) ? Math.max(0, radius) : 0;
  return (safe + 0.5) * CELL;
}

/**
 * 左右翻转一个格子坐标。
 *
 * 【为什么需要它？—— 联机时最关键的一个视觉问题】
 *
 * 真实坐标只有一个：队伍 0 永远在左半边，队伍 1 永远在右半边。
 * 服务器就是按这个坐标系算战斗的，不能改（改了就不是确定性推演了）。
 *
 * 但玩家永远希望「我的棋子在画面左边（靠近自己那一侧）」。
 * 如果你被分到了队伍 1，客户端就必须把整个战场左右翻转再显示 ——
 * 不然后面你会对着别人的棋子操作，非常难受。
 *
 * 关键点：**只翻转显示，不翻转数据**。
 * 传给内核算战斗的坐标永远是原始坐标，
 * 所以翻转纯粹是画面层的事，完全不影响确定性。
 *
 * ⚠️ 棋盘朝向改过好几次。当前是「左右对峙」，所以翻转换的是**列**。
 * 如果以后改成上下对峙，这里必须改成换行 —— 那是个很容易漏的地方，
 * 而且错了不会报错，只会让画面上双方的前后排看起来错乱。
 */
export function flipCell(cell: Cell): Cell {
  return { col: BOARD_W - 1 - cell.col, row: cell.row };
}

/** 视角坐标 -> 逻辑坐标（只在翻转显示时才真的转换） */
export function viewToRawCell(cell: Cell, flipped: boolean): Cell {
  return flipped ? flipCell(cell) : cell;
}

/** 逻辑坐标 -> 视角坐标（把内核算出的棋子位置摆到画面上时用） */
export function rawToViewCell(cell: Cell, flipped: boolean): Cell {
  return flipped ? flipCell(cell) : cell;
}

/** 格子坐标 -> 世界坐标，自动处理翻转视角 */
export function cellToWorldFlipped(cell: Cell, y: number, flip: boolean): { x: number; y: number; z: number } {
  return cellToWorldPoint(flip ? flipCell(cell) : cell, y);
}

// ============================================================
// 鼠标拾取用的坐标换算
// ============================================================

/**
 * 3D 渲染所在的视口（像素）。
 * 原点在**画布左下角**（WebGL 的约定），和 CSS 的左上角原点不同。
 */
export interface ViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 把鼠标位置换算成「归一化设备坐标」（-1..1）。
 *
 * 【为什么必须按视口算，不能按整个画布算？—— 这里踩过坑】
 * 为了让 3D 只渲染在 UI 面板之间的空地，我们用 setViewport 把渲染区域缩进了。
 * 但鼠标拾取如果还按「整个画布」换算，就会和画面对不上 ——
 * 表现为「看到的高亮格子」和「实际点中的格子」错位，
 * 而且错位量正好等于视口的位移（底部商店越高，错得越明显）。
 *
 * 所以渲染和拾取必须用**同一套视口参数**。这个函数把它抽出来，
 * 就是为了让「两边用同一个算法」这件事可以被测试守住。
 *
 * @param pointerX 鼠标相对画布左边的位置（CSS 左上角原点）
 * @param pointerY 鼠标相对画布上边的位置（CSS 左上角原点）
 * @param canvasH  画布高度（CSS 像素）。必须传，因为要翻转 y 轴
 * @param viewport 当前 3D 渲染视口（**左下角**原点）
 */
export function pointerToNdc(
  pointerX: number,
  pointerY: number,
  canvasH: number,
  viewport: ViewportRect,
): { x: number; y: number } {
  // CSS 是「左上角原点」，WebGL 视口是「左下角原点」，所以 y 要翻转
  const pyFromBottom = canvasH - pointerY;

  const width = Math.max(1, viewport.width);
  const height = Math.max(1, viewport.height);

  return {
    x: ((pointerX - viewport.x) / width) * 2 - 1,
    y: ((pyFromBottom - viewport.y) / height) * 2 - 1,
  };
}

/** 玩家可以摆棋子的半场（逻辑坐标下永远是左半边） */
export function isPlayerHalf(cell: Cell): boolean {
  return cell.col >= 0 && cell.col <= TEAM_0_MAX_COL && cell.row >= 0 && cell.row < BOARD_H;
}

export { ARENA_H, ARENA_W, BOARD_H, BOARD_W, TEAM_0_MAX_COL };
export type { Cell };
