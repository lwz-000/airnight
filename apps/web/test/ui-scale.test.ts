/**
 * UI 缩放系数。
 *
 * 【用户口径】2560×1600 全屏时**老版本的效果是"完美"的**，其他分辨率要照它适配 ——
 * 所以基准是 2560×1600（= 1.0），小窗口往下收，大屏不再放大。
 * （第一版基准取 1440×900，导致 2560×1600 被放大 1.3 倍、战场被挤，已被这条口径纠正。）
 */
import { describe, expect, it } from 'vitest';
import {
  UI_SCALE_BASE_HEIGHT,
  UI_SCALE_BASE_WIDTH,
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  uiScaleFor,
} from '../src/ui-scale.js';

describe('★ UI 缩放系数（以 2560×1600 为基准）', () => {
  it('★★ 2560×1600 = 1.0：用户屏幕上"完美"的那一版必须一个像素都不变', () => {
    expect(uiScaleFor(2560, 1600)).toBe(1);
    expect(uiScaleFor(UI_SCALE_BASE_WIDTH, UI_SCALE_BASE_HEIGHT)).toBe(1);
  });

  it('更大的屏也不放大（1.0 封顶，保持 2560×1600 那套比例）', () => {
    expect(uiScaleFor(3840, 2160)).toBe(1);
    expect(uiScaleFor(5120, 2880)).toBe(1);
    expect(UI_SCALE_MAX).toBe(1);
  });

  it('小窗口按比例往下收：1920×1080 约 0.88、1440×900 约 0.84', () => {
    // 1920/2560 = 0.75，1080/1600 = 0.675 -> 取 0.675
    expect(uiScaleFor(1920, 1080)).toBe(0.88);
    // 1440/2560 = 0.5625，900/1600 = 0.5625
    expect(uiScaleFor(1440, 900)).toBe(0.84);
  });

  it('1280×720 及更小封底到 0.8（再小字就看不清了）', () => {
    expect(uiScaleFor(1280, 720)).toBe(UI_SCALE_MIN);
    expect(uiScaleFor(1024, 640)).toBe(UI_SCALE_MIN);
    expect(uiScaleFor(800, 600)).toBe(UI_SCALE_MIN);
  });

  it('取宽高里**较小**的那个：矮而宽的屏不能只按宽度算', () => {
    // 3440×1200：宽 1.34、高 0.75 -> 跟高度走（0.91，而不是按宽度算的 1.0）
    expect(uiScaleFor(3440, 1200)).toBe(0.91);
    // 2560×900：宽够、高只有 0.5625 -> 0.84
    expect(uiScaleFor(2560, 900)).toBe(0.84);
  });

  it('单调不减：窗口越大，缩放不会反而变小', () => {
    const sizes = [
      [1280, 720],
      [1366, 768],
      [1440, 900],
      [1600, 1000],
      [1920, 1080],
      [1920, 1200],
      [2560, 1440],
      [2560, 1600],
      [3840, 2160],
    ];
    const scales = sizes.map(([w, h]) => uiScaleFor(w!, h!));
    for (let i = 1; i < scales.length; i++) {
      expect(scales[i]!, `第 ${i} 档不该比上一档小（${scales[i - 1]} -> ${scales[i]}）`).toBeGreaterThanOrEqual(
        scales[i - 1]!,
      );
    }
    expect(scales[scales.length - 1]).toBe(1);
  });

  it('异常输入退回基准（窗口刚初始化时可能拿到 0）', () => {
    expect(uiScaleFor(0, 0)).toBe(1);
    expect(uiScaleFor(Number.NaN, 1600)).toBe(1);
  });
});
