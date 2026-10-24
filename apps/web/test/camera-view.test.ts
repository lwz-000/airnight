/**
 * 竞技场视角的缩放/平移规则（你报的第 13 条）。
 *
 * 【为什么这些数字必须钉死？】
 * 因为"视角能拉多近、能拖多远"是**玩家手感**，而且在浏览器里
 * 很难复现"是不是真的到了 50%""最远视角有没有和以前不一样"。
 * 抽成纯函数之后，这几条规则全部可以用数字断言：
 *   · 最远 = 默认（倍率绝不会小于 1，也不会平移到别处）
 *   · 最近 = 相机距离变成默认的一半
 *   · 没拉近时拖动完全无效（保证"最远视角 = 改动前的视角"）
 *   · 拉近之后能平移，但推到棋盘边缘就停（不会推到虚空里）
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_ZOOM_IN,
  cameraDistanceFor,
  createCameraView,
  panBy,
  panLimitFor,
  resetView,
  worldPerPixelAt,
  zoomBy,
} from '../src/three/camera-view.js';

const W = 10;
const D = 20;

/** 往上滚（拉近）：浏览器的 deltaY 是负数 */
const WHEEL_IN = -100;
const WHEEL_OUT = 100;

describe('★ 滚轮拉近', () => {
  it('★ 一直往上滚，最多只能到 2 倍（= 相机距离缩到默认的 50%）', () => {
    const view = createCameraView();
    for (let i = 0; i < 50; i++) zoomBy(view, WHEEL_IN, W, D);
    expect(view.zoom).toBe(MAX_ZOOM_IN);
    // "放近最大为现在的 50%" —— 说的就是相机距离
    expect(cameraDistanceFor(100, view.zoom)).toBe(50);
  });

  it('★ 一直往下滚也不会比默认视角更远（最远就是现在的视角）', () => {
    const view = createCameraView();
    for (let i = 0; i < 20; i++) zoomBy(view, WHEEL_OUT, W, D);
    expect(view.zoom).toBe(1);
    expect(cameraDistanceFor(100, view.zoom)).toBe(100);
  });

  it('拉近一格再拉远一格，回到原位（乘除对称，手感均匀）', () => {
    const view = createCameraView();
    zoomBy(view, WHEEL_IN, W, D);
    expect(view.zoom).toBeGreaterThan(1);
    zoomBy(view, WHEEL_OUT, W, D);
    expect(view.zoom).toBeCloseTo(1, 10);
  });

  it('一次甩出很大的 deltaY 也不会一步跳到头（按格走）', () => {
    const view = createCameraView();
    zoomBy(view, -1000, W, D);
    expect(view.zoom).toBeLessThan(MAX_ZOOM_IN);
    expect(view.zoom).toBeGreaterThan(1);
  });

  it('deltaY 为 0 时什么都不做（有些设备会发空事件）', () => {
    const view = createCameraView();
    expect(zoomBy(view, 0, W, D)).toBe(false);
    expect(view.zoom).toBe(1);
  });

  it('倍率没变时返回 false（界面据此决定要不要重画）', () => {
    const view = createCameraView();
    expect(zoomBy(view, WHEEL_IN, W, D)).toBe(true);
    expect(zoomBy(view, WHEEL_OUT, W, D)).toBe(true);
    expect(zoomBy(view, WHEEL_OUT, W, D), '已经在最远，再往下滚没有变化').toBe(false);
  });
});

describe('★ 拉近之后拖动平移', () => {
  it('★ 没拉近时拖动完全无效（"最远视角就是现在的视角"）', () => {
    const view = createCameraView();
    panBy(view, 200, 200, 0.05, W, D);
    expect(view).toEqual({ zoom: 1, panX: 0, panZ: 0 });
  });

  it('★ 拉近之后能拖动，而且推到棋盘边缘就停住', () => {
    const view = createCameraView();
    for (let i = 0; i < 50; i++) zoomBy(view, WHEEL_IN, W, D);
    // 使劲往一个方向拖
    for (let i = 0; i < 100; i++) panBy(view, 80, 80, 0.05, W, D);
    const limit = panLimitFor(view.zoom, W, D);
    expect(view.panX).toBeCloseTo(-limit.x, 10);
    expect(view.panZ).toBeCloseTo(-limit.z, 10);
    // 拉到 2 倍时，最多能平移"棋盘一半的一半"
    expect(limit.x).toBeCloseTo((W / 2) * 0.5, 10);
    expect(limit.z).toBeCloseTo((D / 2) * 0.5, 10);
  });

  it('缩回默认倍率时平移被清零（不会留下一个歪掉的"最远视角"）', () => {
    const view = createCameraView();
    zoomBy(view, WHEEL_IN, W, D);
    panBy(view, 120, 120, 0.05, W, D);
    expect(Math.abs(view.panX) + Math.abs(view.panZ)).toBeGreaterThan(0);
    for (let i = 0; i < 10; i++) zoomBy(view, WHEEL_OUT, W, D);
    expect(view.zoom).toBe(1);
    expect(view.panX).toBe(0);
    expect(view.panZ).toBe(0);
  });

  it('倍率越小，能平移的范围越小（1 倍时是 0）', () => {
    expect(panLimitFor(1, W, D)).toEqual({ x: 0, z: 0 });
    expect(panLimitFor(1.5, W, D).x).toBeLessThan(panLimitFor(2, W, D).x);
  });

  it('resetView 回到默认视角', () => {
    const view = createCameraView();
    zoomBy(view, WHEEL_IN, W, D);
    panBy(view, 100, 100, 0.05, W, D);
    resetView(view);
    expect(view).toEqual({ zoom: 1, panX: 0, panZ: 0 });
  });
});

describe('★ 像素 -> 世界的换算（拖动手感）', () => {
  it('★ 拉得越近，同样的像素位移对应的世界距离越小（不会一碰就飞）', () => {
    const far = worldPerPixelAt(100, 38, 800);
    const near = worldPerPixelAt(50, 38, 800);
    expect(near).toBeCloseTo(far / 2, 10);
  });

  it('窗口越高，每像素对应的世界距离越小（画面被摊开）', () => {
    expect(worldPerPixelAt(100, 38, 1200)).toBeLessThan(worldPerPixelAt(100, 38, 600));
  });

  it('高度为 0 时不会算出 Infinity / NaN（防御性）', () => {
    const value = worldPerPixelAt(100, 38, 0);
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThan(0);
  });
});
