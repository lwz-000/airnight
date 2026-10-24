/**
 * ============================================================
 *  ★★ 0.2.1：全场扫射的**排布**（哪一行、第几颗、什么时候、落在哪）
 * ============================================================
 *
 * 【为什么排布要单独测？】
 * 这一发不是"一张图贴在某一格"，而是一整套弹道（100+ 颗）。
 * 排布错了不会报错，只会**看着不对**，而且极难靠眼睛定位：
 *   · 方向反了 ⇒ 子弹从对面打过来（"我的齐射怎么从敌方那边出来的？"）；
 *   · 起点没出棋盘 ⇒ 子弹在棋盘边缘凭空冒出来；
 *   · 行数/间距错了 ⇒ 变成"十根等长光棒"而不是弹幕墙。
 * 所以这里把"纯数字"那一半全部钉死 —— 渲染层只是照着这份清单打出去。
 */
import { describe, expect, it } from 'vitest';
import {
  BOARD_VOLLEY,
  MAX_LIVE_VOLLEY_TRACERS,
  planVolleyShots,
  volleyShotCount,
  type BoardVolleyBoard,
  type BoardVolleySpec,
} from '../src/three/board-volley-fx.js';

/** 10×10 棋盘的几何（世界坐标，未翻转视角：队伍 0 在左半边） */
const BOARD: BoardVolleyBoard = { sideX: -4.5, farX: 4.5, zNear: -4.5, zFar: 4.5, rows: 10 };

const spec = BOARD_VOLLEY['laterano_volley']!;

describe('★ 0.2.1 全场扫射：排布', () => {
  it('注册表里只有一份：laterano_volley，而且用的是拉特兰那颗弹丸', () => {
    expect(spec, '拉特兰齐射必须登记在 BOARD_VOLLEY').toBeTruthy();
    expect(spec.tracer).toBe('bullet_laterano');
    // 行数跟棋盘一样（10 行 = 每行一条弹道）
    expect(spec.rows, '一行一条弹道').toBe(BOARD.rows);
    // 弹丸必须飞得够久：13 格 / 11 格每秒 ≈ 1.2 秒，`seconds` 是飞行上限
    expect(spec.sweepSeconds).toBeGreaterThan(1);
  });

  it('方向由棋盘几何决定：从触发方那半场打向对面，两头都出棋盘', () => {
    const shots = planVolleyShots(spec, BOARD);
    const first = shots[0]!;
    // 队伍 0 在左 ⇒ 起点在左边界之外、终点在右边界之外
    expect(first.fromX, '起点要出棋盘（否则子弹凭空出现）').toBeLessThan(-5);
    expect(first.toX, '终点也要出棋盘（否则子弹在边上消失）').toBeGreaterThan(5);
    expect(first.fromX).toBeCloseTo(BOARD.sideX - spec.overhangCells, 5);
    expect(first.toX).toBeCloseTo(BOARD.farX + spec.overhangCells, 5);
    // 所有子弹同向（不是一团乱飞）
    for (const shot of shots) {
      expect(shot.toX).toBe(first.toX);
      expect(shot.fromX).toBe(first.fromX);
    }
  });

  it('★ 镜像视角（联机被分到队伍 1）：方向自动反过来，不需要特判', () => {
    /*
      ★ 用户口径是"从**玩家**竞技场方向扫过去"。
      联机换视角时 `cellToWorldFlipped` 会把两侧的 x 换掉 —— 这里模拟"换过之后"的几何：
      玩家那半场跑到了 +x 侧，于是子弹必须从 +x 侧打向 -x 侧。
    */
    const mirrored: BoardVolleyBoard = { ...BOARD, sideX: 4.5, farX: -4.5 };
    const shots = planVolleyShots(spec, mirrored);
    const first = shots[0]!;
    expect(first.fromX, '从玩家这一侧出去').toBeGreaterThan(5);
    expect(first.toX).toBeLessThan(-5);
  });

  it('行数 = 棋盘行数，每行弹道都落在自己的 z 上（±散布）', () => {
    const shots = planVolleyShots(spec, BOARD);
    const perRow = Math.floor(spec.sweepSeconds / spec.bulletGap) + 1;
    expect(shots.length, `10 行 × 每行 ${perRow} 颗`).toBe(spec.rows * perRow);

    // 每一颗的 z 都要落在 [zNear - spread, zFar + spread] 里（不许飞出棋盘）
    const lo = BOARD.zNear - spec.spreadCells - 1e-6;
    const hi = BOARD.zFar + spec.spreadCells + 1e-6;
    for (const shot of shots) {
      expect(shot.z).toBeGreaterThanOrEqual(lo);
      expect(shot.z).toBeLessThanOrEqual(hi);
    }
    // 10 行确实铺满了 z 方向（不是全挤在一条线上）
    const zs = shots.map((shot) => shot.z);
    expect(Math.max(...zs) - Math.min(...zs), '整片棋盘都要照顾到').toBeGreaterThan(8);
  });

  it('逐行错峰：后一行的第一颗一定比前一行晚（形成斜着扫过去的弹幕墙）', () => {
    const shots = planVolleyShots(spec, BOARD);
    const perRow = Math.floor(spec.sweepSeconds / spec.bulletGap) + 1;
    const rowStart = (row: number): number => shots[row * perRow]!.at;
    for (let row = 1; row < spec.rows; row++) {
      const gap = rowStart(row) - rowStart(row - 1);
      // 名义错峰 ±0.09 的抖动 ⇒ 至少要有 0.002 秒，绝不会"同时齐射"
      expect(gap, `第 ${row} 行必须比上一行晚`).toBeGreaterThan(0.002);
      expect(gap, `第 ${row} 行的错峰不该超过 0.2 秒`).toBeLessThan(0.2);
    }
  });

  it('清单按时间排好序、且没有负延迟（渲染层靠队头取"到点了"的）', () => {
    const shots = planVolleyShots(spec, BOARD);
    for (let i = 1; i < shots.length; i++) {
      expect(shots[i]!.at).toBeGreaterThanOrEqual(shots[i - 1]!.at);
    }
    for (const shot of shots) expect(shot.at).toBeGreaterThanOrEqual(0);
  });

  it('同一份输入永远算出一模一样的清单（两局回放长得一样）', () => {
    const a = planVolleyShots(spec, BOARD);
    const b = planVolleyShots(spec, BOARD);
    expect(a, '排布里不能有 Math.random').toEqual(b);
  });

  it('峰值同时在场的子弹数必须在上限之内（超了就要丢别人的弹道）', () => {
    /*
      简化模型：一颗子弹飞 `crossSeconds` 秒，这段时间里每 `bulletGap` 秒来一颗，
      行与行再错开 `rowDelay` —— 峰值 ≈ rows × (飞完的时间 / 间隔)。
      这里取上界（飞完时间按整块棋盘 + 两头出界算）。
    */
    const crossSeconds = (Math.abs(BOARD.farX - BOARD.sideX) + spec.overhangCells * 2) / 11;
    const peak = spec.rows * (Math.ceil(crossSeconds / spec.bulletGap) + 1);
    expect(peak, `峰值约 ${peak} 颗`).toBeLessThanOrEqual(MAX_LIVE_VOLLEY_TRACERS);
  });

  it('行数可以按棋盘缩放（以后棋盘改小也不会算出棋盘外的行）', () => {
    const small: BoardVolleySpec = { ...spec, rows: 8 };
    const board: BoardVolleyBoard = { ...BOARD, rows: 8 };
    const shots = planVolleyShots(small, board);
    const perRow = Math.floor(small.sweepSeconds / small.bulletGap) + 1;
    expect(shots.length).toBe(8 * perRow);
    // 即便 spec 写 10 行、棋盘只有 8 行，也只打 8 行（取小的那个）
    const clamped = planVolleyShots(spec, board);
    expect(clamped.length).toBe(8 * perRow);
  });

  it('volleyShotCount 和清单长度一致（排查面板用的就是这个数）', () => {
    expect(volleyShotCount(spec, BOARD)).toBe(planVolleyShots(spec, BOARD).length);
  });
});
