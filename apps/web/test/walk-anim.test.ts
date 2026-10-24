/**
 * ============================================================
 *  走路的节奏（★ 0.0.3，玩家报的"移动不够平滑"）
 * ============================================================
 *
 * 【玩家看到的毛病】
 * 棋子走位的时候一顿一顿的：滑一下、停一下、再滑一下。
 *
 * 【根因】
 * 内核走一格要等 `MOVE_COOLDOWN_TICKS = 8` 个 tick（0.4 秒），
 * 而画面上的滑行只有 0.18 秒 —— 每格都多出 0.22 秒的"干站"。
 *
 * 【修法的两条硬约束（这个文件把它们钉住）】
 *   1. 走一格滑行 = 一个内核移动周期，且**线性**：
 *      上一格滑到尽头那一瞬间下一格开始，连续走位拼成一条匀速直线；
 *   2. **瞬移（强制位移）一个字都不能变**：还是 0.18 秒的 easeOutQuad，
 *      而且不播走路动作 —— 用户明确要求过"瞬移不用改"。
 */
import { describe, expect, it } from 'vitest';
import { MOVE_COOLDOWN_TICKS, TICKS_PER_SECOND } from '../../../packages/shared/src/index.js';
import {
  MOVE_LERP_SECONDS,
  WALK_HOP_HEIGHT,
  WALK_LEAN_RAD,
  WALK_STEP_PUSH,
  WALK_STEP_SECONDS,
  advanceStepProgress,
  stepSecondsFor,
  walkEase,
  walkPose,
} from '../src/three/walk-anim.js';

describe('★ 走一格要滑多久', () => {
  it('走路的滑行时长 = 内核的移动周期（不是写死的数字）', () => {
    expect(stepSecondsFor(false), '走路').toBeCloseTo(MOVE_COOLDOWN_TICKS / TICKS_PER_SECOND, 9);
    expect(WALK_STEP_SECONDS, '8 tick @ 20 tick/秒 = 0.4 秒').toBeCloseTo(0.4, 9);
  });

  it('★ 瞬移（强制位移）的归位时长**没变**：还是 0.18 秒', () => {
    expect(stepSecondsFor(true)).toBe(MOVE_LERP_SECONDS);
    expect(MOVE_LERP_SECONDS, '这是 0.0.3 之前就有的值，改了就违背"瞬移不改"').toBe(0.18);
  });
});

describe('★ 一次走位的时间轴', () => {
  it('0.4 秒刚好走完一格（1 倍速：每帧 1/60 秒）', () => {
    let progress = 0;
    let frames = 0;
    while (progress < 1 && frames < 1000) {
      progress = advanceStepProgress(progress, 1 / 60, WALK_STEP_SECONDS);
      frames++;
    }
    expect(progress).toBe(1);
    // 1/60 在二进制里除不尽，所以累计到 0.4 秒可能差最后半帧 —— 24~25 帧都算对
    expect(frames, '0.4 秒 / (1/60 秒) = 24 帧').toBeGreaterThanOrEqual(24);
    expect(frames).toBeLessThanOrEqual(25);
  });

  it('倍速回放自动跟着缩放（2 倍速时用一半的帧数走完）', () => {
    // replay 里传给 advanceStepProgress 的 deltaSeconds 已经乘过倍速，
    // 所以这里直接模拟"每帧 2/60 秒"就行
    let progress = 0;
    let frames = 0;
    while (progress < 1 && frames < 1000) {
      progress = advanceStepProgress(progress, 2 / 60, WALK_STEP_SECONDS);
      frames++;
    }
    expect(frames).toBe(12);
  });

  it('★ 走路线性（匀速），瞬移还是原来的 easeOutQuad', () => {
    expect(walkEase(false, 0.5), '走一半就是走一半 —— 不平滑就没法首尾相接').toBeCloseTo(0.5, 9);
    expect(walkEase(false, 0.25)).toBeCloseTo(0.25, 9);
    expect(walkEase(true, 0.5), 'easeOutQuad：起步快、收尾慢（原样）').toBeCloseTo(0.75, 9);
    expect(walkEase(true, 0)).toBe(0);
    expect(walkEase(true, 1)).toBe(1);
    expect(walkEase(false, 1.7), '越界要夹住').toBe(1);
    expect(walkEase(false, -3)).toBe(0);
  });

  it('★ 连续走三格：位移是匀速的，没有"滑一段再停一下"', () => {
    // 把三格首尾相接的时间轴拉出来，看每一小段的位移量是否恒定
    const dt = 1 / 60;
    const speeds: number[] = [];
    for (let step = 0; step < 3; step++) {
      let progress = 0;
      let last = 0;
      while (progress < 1) {
        const next = advanceStepProgress(progress, dt, WALK_STEP_SECONDS);
        speeds.push(walkEase(false, next) - walkEase(false, last));
        progress = next;
        last = progress;
      }
    }
    const unique = new Set(speeds.map((v) => v.toFixed(6)));
    // 所有小段的位移量都一样（最后一段可能被夹到 1，所以只比"正常那几段"）
    const normal = speeds.filter((v) => Math.abs(v - dt / WALK_STEP_SECONDS) < 1e-9);
    expect(normal.length, '绝大多数帧都应该是同一速度').toBeGreaterThan(speeds.length - 4);
    expect(unique.size, '速度种类越少越平滑').toBeLessThanOrEqual(3);
  });
});

describe('★ 没有走路素材的单位：程序化走姿', () => {
  it('起步和到站都不偏移（走到站那一刻正好回到基准位置）', () => {
    for (const dir of [1, -1, 0]) {
      const at0 = walkPose(0, dir);
      const at1 = walkPose(1, dir);
      expect(at0.hop).toBeCloseTo(0, 9);
      expect(at0.push).toBeCloseTo(0, 9);
      expect(at0.lean).toBeCloseTo(0, 9);
      expect(at1.hop).toBeCloseTo(0, 9);
      expect(at1.push).toBeCloseTo(0, 9);
      expect(at1.lean).toBeCloseTo(0, 9);
    }
  });

  it('中段才最夸张：颠到最高、前倾最深', () => {
    const mid = walkPose(0.5, 1);
    expect(mid.hop).toBeCloseTo(WALK_HOP_HEIGHT, 9);
    expect(Math.abs(mid.lean)).toBeCloseTo(WALK_LEAN_RAD, 9);
    // 推挤是"一个格子两拍"，所以中点是 0（正要迈第二步）
    expect(mid.push).toBeCloseTo(0, 9);
    expect(walkPose(0.25, 1).push).toBeCloseTo(WALK_STEP_PUSH, 9);
  });

  it('方向跟着画面走：向右走就向右推、向右倾', () => {
    const right = walkPose(0.25, 1);
    const left = walkPose(0.25, -1);
    expect(Math.sign(right.push)).toBe(1);
    expect(Math.sign(left.push)).toBe(-1);
    // 前倾是"朝前进方向倒"：向右走时是负角度（顺时针），向左走反过来
    expect(Math.sign(walkPose(0.5, 1).lean)).toBe(-1);
    expect(Math.sign(walkPose(0.5, -1).lean)).toBe(1);
  });

  it('竖直方向移动（dirX = 0）时只颠不推、也不歪', () => {
    const pose = walkPose(0.25, 0);
    // 用 toBeCloseTo：乘 0 会得到 -0，而 Object.is(-0, 0) 是 false
    expect(pose.push).toBeCloseTo(0, 12);
    expect(pose.lean).toBeCloseTo(0, 12);
    expect(pose.hop).toBeGreaterThan(0);
  });
});
