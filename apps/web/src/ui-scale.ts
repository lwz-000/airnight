/**
 * ============================================================
 *  UI 缩放系数（以 2560×1600 为"完美"基准，只缩不放）
 * ============================================================
 *
 * 【用户口径（第一版做错了）】
 *   "我的是 2560×1600，全屏后遮挡严重；**之前的效果在 2560×1600 上是非常完美的**，
 *    按照之前在 2560×1600 上的效果对其他分辨率进行适配。"
 *
 *   第一版把基准定成 1440×900（启动器默认窗口），于是 2560×1600 算出 1.78 →
 *   被夹到 1.3 ⇒ 面板、底栏一起放大 30%，战场被挤窄 —— 正好把"完美"的那一版毁了。
 *
 * 【现在的口径】
 *   · **2560×1600 = 1.0**：和老版本一个像素都不差（面板 190/250、底栏 280、字号原样）；
 *   · **更大的屏也不再放大**（1.0 封顶）：保持"2560×1600 那套比例"就是用户要的效果；
 *   · 更小的窗口按比例往下收，但**不低于 0.8**（10.5px 的小字再缩就看不清了）。
 *
 *   向下收的曲线是"两点一线"：
 *     ratio ≥ 1      -> 1.0
 *     ratio ≤ 0.45   -> 0.8   （1280×720 及以下）
 *     中间            -> 0.8 ~ 1.0 线性插值
 *   为什么不直接乘 ratio？那样 1280×720 只有 0.45 倍，字全糊；
 *   而 0.8 已经足够让顶栏那一排（逻辑宽 1600）摆得下 —— 这是实测出来的下限。
 *
 * 纯函数，方便单测；`main.ts` 只负责把结果写进 `--ui-scale`。
 */

/** 设计基准 = 用户屏幕上"完美"的那一档（2560×1600 全屏） */
export const UI_SCALE_BASE_WIDTH = 2560;
export const UI_SCALE_BASE_HEIGHT = 1600;

/** 最小缩放（再小字就看不清了） */
export const UI_SCALE_MIN = 0.8;
/** 最大缩放 —— **1.0**：大屏不再放大，保持 2560×1600 那套比例 */
export const UI_SCALE_MAX = 1.0;

/** 低于这个比例（≈1280×720 及更小）就按最小缩放处理 */
const MIN_RATIO = 0.45;

/**
 * 按窗口尺寸算 UI 缩放。
 *
 * @param width  视口宽（`window.innerWidth`，CSS px）
 * @param height 视口高（`window.innerHeight`，CSS px）
 * @returns 0.8 ~ 1.0 之间的缩放系数（两位小数）
 */
export function uiScaleFor(width: number, height: number): number {
  const w = Number.isFinite(width) && width > 0 ? width : UI_SCALE_BASE_WIDTH;
  const h = Number.isFinite(height) && height > 0 ? height : UI_SCALE_BASE_HEIGHT;
  // 取宽高里较小的那个：矮而宽的屏不能只按宽度算（否则底栏会占掉半屏）
  const ratio = Math.min(w / UI_SCALE_BASE_WIDTH, h / UI_SCALE_BASE_HEIGHT);

  // 基准及以上：不放大（2560×1600 = 1.0，4K 也还是 1.0）
  if (ratio >= 1) return UI_SCALE_MAX;

  // 往下线性收到 UI_SCALE_MIN，再小就封底
  const t = Math.max(0, Math.min(1, (ratio - MIN_RATIO) / (1 - MIN_RATIO)));
  const scale = UI_SCALE_MIN + (UI_SCALE_MAX - UI_SCALE_MIN) * t;
  return Math.round(scale * 100) / 100;
}
