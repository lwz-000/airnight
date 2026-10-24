/**
 * 竞技场视角的「缩放 + 平移」数学（第 13 条需求）。
 *
 * 【为什么单独一个文件、而且完全不碰 three.js？】
 * 因为规则里有几个**必须有确定答案**的数字：
 *   · 最远视角 = 现在的视角（倍率 1，一点都不能更远）
 *   · 最近视角 = 相机距离变成默认的 50%（倍率 2）
 *   · 没拉近时不允许平移（否则"最远视角和以前不一样"）
 *   · 拉近之后能平移多远（推到棋盘边缘就停，不能推到虚空里）
 * 这些如果写在 WebGL 的场景创建函数里，就没法写单元测试
 * （测试环境里没有 WebGL），只能靠肉眼在浏览器里试 —— 那是不可靠的。
 * 抽成纯函数之后，这几条规则都能用数字钉住。
 */

/** 最多能拉近多少倍：2 = 相机距离缩到默认的 1/2（也就是"放近最大为现在的 50%"） */
export const MAX_ZOOM_IN = 2;

/** 滚轮每一格改变多少倍率（用乘除，手感才是均匀的） */
export const ZOOM_STEP = 1.18;

export interface CameraViewState {
  /** 1 = 默认（最远）视角；MAX_ZOOM_IN = 最近 */
  zoom: number;
  /** 平移量（世界单位），没拉近时恒为 0 */
  panX: number;
  panZ: number;
}

export function createCameraView(): CameraViewState {
  return { zoom: 1, panX: 0, panZ: 0 };
}

/** 拉近之后最多能平移多远：倍率 2 时可以一直推到棋盘边缘 */
export function panLimitFor(
  zoom: number,
  worldWidth: number,
  worldDepth: number,
): { x: number; z: number } {
  const slack = 1 - 1 / Math.max(1, zoom);
  return { x: (worldWidth / 2) * slack, z: (worldDepth / 2) * slack };
}

function clampPan(view: CameraViewState, worldWidth: number, worldDepth: number): void {
  if (view.zoom <= 1) {
    // 最远视角就是"现在的视角"：一点平移都不允许，观感和改动前一模一样
    view.panX = 0;
    view.panZ = 0;
    return;
  }
  const limit = panLimitFor(view.zoom, worldWidth, worldDepth);
  view.panX = Math.max(-limit.x, Math.min(limit.x, view.panX));
  view.panZ = Math.max(-limit.z, Math.min(limit.z, view.panZ));
}

/**
 * 滚轮缩放。
 *
 * @param deltaY 浏览器的滚轮方向：**往上滚是负数**（所以负数 = 拉近）
 * @returns 倍率有没有变（没变就不用重画了）
 */
export function zoomBy(
  view: CameraViewState,
  deltaY: number,
  worldWidth: number,
  worldDepth: number,
): boolean {
  if (deltaY === 0) return false;
  const before = view.zoom;
  // 一格一圈地走，避免某些鼠标/触控板一次甩出很大的 deltaY 直接跳到头
  const steps = Math.min(4, Math.max(1, Math.round(Math.abs(deltaY) / 100)));
  for (let i = 0; i < steps; i++) {
    const next = deltaY < 0 ? view.zoom * ZOOM_STEP : view.zoom / ZOOM_STEP;
    view.zoom = Math.max(1, Math.min(MAX_ZOOM_IN, next));
  }
  clampPan(view, worldWidth, worldDepth);
  return view.zoom !== before;
}

/**
 * 拖动平移。
 *
 * @param worldPerPixel 相机每移动 1 像素对应多少世界距离（见 worldPerPixelAt）
 */
export function panBy(
  view: CameraViewState,
  dxPixels: number,
  dyPixels: number,
  worldPerPixel: number,
  worldWidth: number,
  worldDepth: number,
): void {
  if (view.zoom <= 1) return;
  // 「抓住棋盘拖」的手感：鼠标往右拖，棋盘跟着往右走 => 相机往左挪
  view.panX -= dxPixels * worldPerPixel;
  view.panZ -= dyPixels * worldPerPixel;
  clampPan(view, worldWidth, worldDepth);
}

export function resetView(view: CameraViewState): void {
  view.zoom = 1;
  view.panX = 0;
  view.panZ = 0;
}

/**
 * 相机在「能看到多少世界」上的换算：每像素对应多少世界单位。
 *
 * 用真的透视公式算（2·d·tan(fov/2) 是画面竖直方向在世界里的高度），
 * 而不是拿棋盘尺寸凑一个数 —— 拉得越近，同一段像素对应的世界距离越小，
 * 拖动才不会"一碰就飞出去"。
 */
export function worldPerPixelAt(cameraDistance: number, fovDegrees: number, viewportHeightPixels: number): number {
  const halfFov = ((fovDegrees * Math.PI) / 180) / 2;
  const worldHeight = 2 * cameraDistance * Math.tan(halfFov);
  return worldHeight / Math.max(1, viewportHeightPixels);
}

/**
 * 倍率 -> 相机距离。
 * 【必须只改距离、不改方向】—— 方向一变，拉近拉远的时候视角就会晃。
 */
export function cameraDistanceFor(baseDistance: number, zoom: number): number {
  return baseDistance / Math.max(1, zoom);
}
