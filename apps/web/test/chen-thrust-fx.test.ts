/**
 * ============================================================
 *  ★★ 0.2.2 陈「赤霄」：覆盖前方 3 格的剑光
 * ============================================================
 *
 * 用户手绘草图的口径：卡面（黄块）在右边，剑光往**前方**铺 3 格 ——
 * 一条近黑的芯 + 几道赤红剑光，远端收成箭头。
 *
 * 这里钉三件事：
 *  ① **数据和特效对得上**：`op21` 写了 `castFx: 'chen_thrust'`，
 *     而且技能本身打的就是"前方 3 格"（`radius: 3 / shape: 'line'`）——
 *     特效长度写死了 3 格，两边一旦不一致（比如技能改成 4 格），这条立刻红；
 *  ② **伸展曲线**：前 45% 刺出去、之后保持（不缩回），透明度最后淡到 0；
 *  ③ 判据只看 id，不认干员编号。
 */
import { describe, expect, it } from 'vitest';
import { SKILLS } from '../../../packages/shared/src/index.js';
import {
  CHEN_THRUST_CELLS,
  CHEN_THRUST_FX,
  CHEN_THRUST_LENGTH,
  CHEN_THRUST_SECONDS,
  isChenThrustFx,
  thrustOpacityAt,
  thrustReachAt,
} from '../src/three/chen-thrust-fx.js';

describe('★ 0.2.2 陈「赤霄」前方三格剑光：数据 ↔ 特效对齐', () => {
  it('op21 写了 castFx = chen_thrust', () => {
    expect(SKILLS['op21']!.castFx).toBe(CHEN_THRUST_FX);
  });

  it('★ 绊线：特效长度 = 技能真正打的那几格（radius / shape）', () => {
    const effect = (SKILLS['op21']!.effects ?? []).find((item) => item.kind === 'damage') as
      | { radius?: number; shape?: string }
      | undefined;
    expect(effect, '陈的技能得有一条伤害效果').toBeTruthy();
    expect(effect!.shape, '前方一条线').toBe('line');
    expect(
      effect!.radius,
      '技能改成打几格，CHEN_THRUST_CELLS 就必须跟着改（否则剑光会盖不满 / 盖过头）',
    ).toBe(CHEN_THRUST_CELLS);
    expect(CHEN_THRUST_LENGTH).toBeCloseTo(CHEN_THRUST_CELLS, 6);
  });

  it('判据只看 id：别的 castFx 不会被当成这一招', () => {
    expect(isChenThrustFx('chen_thrust')).toBe(true);
    expect(isChenThrustFx('chen_s3')).toBe(false);
    expect(isChenThrustFx(undefined)).toBe(false);
  });
});

describe('★ 0.2.2 陈的剑光：伸展与淡出', () => {
  it('前 45% 从 0.12 刺到 1，之后保持（不缩回）', () => {
    expect(thrustReachAt(0)).toBeCloseTo(0.12, 3);
    expect(thrustReachAt(0.45)).toBeCloseTo(1, 3);
    expect(thrustReachAt(0.7)).toBeCloseTo(1, 3);
    expect(thrustReachAt(1)).toBeCloseTo(1, 3);
    let previous = 0;
    for (let t = 0; t <= 1; t += 0.05) {
      const reach = thrustReachAt(t);
      expect(reach).toBeGreaterThanOrEqual(previous);
      previous = reach;
    }
  });

  it('透明度：前 25% 满亮，结尾为 0', () => {
    expect(thrustOpacityAt(0)).toBe(1);
    expect(thrustOpacityAt(0.2)).toBe(1);
    expect(thrustOpacityAt(1)).toBeCloseTo(0, 3);
  });

  it('边界：NaN / 越界不会算出 NaN', () => {
    for (const t of [Number.NaN, -1, 5]) {
      expect(Number.isFinite(thrustReachAt(t))).toBe(true);
      expect(Number.isFinite(thrustOpacityAt(t))).toBe(true);
    }
    // 时长在攻击特效那一档（0.13~0.4）
    expect(CHEN_THRUST_SECONDS).toBeGreaterThan(0.2);
    expect(CHEN_THRUST_SECONDS).toBeLessThan(0.5);
  });
});
