import { SRGBColorSpace, CanvasTexture, type Texture } from 'three';

/**
 * ============================================================
 *  程序化背景：星空 + 星云
 * ============================================================
 *
 * 【为什么不用现成素材图？】
 * 三个原因：
 *   1. **授权风险**：网上的星空图大多来源不明或是商用素材站的，
 *      用来做游戏有法律风险。程序化生成的完全没这个问题。
 *   2. **不用下载、不会丢**：素材图要放进仓库、要管路径、可能被误删。
 *      代码生成的永远在。
 *   3. **可调**：想要星星更多、星云更紫，改几个数字就行，不用重做图。
 *
 * 代价是比不上专业美术画的。但对现在这个阶段（占位美术、
 * 先把玩法跑起来）完全够用 —— 而且以后要换成真素材，
 * 只需要把这里的返回值换成 `textureLoader.load('背景.png')`。
 */

/** 固定种子，保证每次生成的星空一模一样（不然每次刷新背景都在变，很干扰） */
const BACKDROP_SEED = 0x5eed;

/** 简单的确定性随机源（和内核用的同一个思路） */
function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
    t = (t ^ (t + Math.imul(t ^ (t >>> 7), t | 61))) >>> 0;
    return (t ^ (t >>> 14)) >>> 0;
  };
}

export interface BackdropOptions {
  /** 画布宽度。等距柱状投影，2:1 最自然 */
  width?: number;
  /** 星星数量 */
  starCount?: number;
  /** 星云团块数量 */
  nebulaCount?: number;
  /** 星云主色调 */
  nebulaColors?: string[];
}

/**
 * 生成一张「星空 + 星云」的等距柱状贴图。
 *
 * 等距柱状（equirectangular）是 2:1 的长条图，
 * 贴到天空球上正好无缝环绕，所以适合当 3D 场景的背景。
 */
export function createSpaceBackdrop(options: BackdropOptions = {}): Texture {
  const width = options.width ?? 2048;
  const height = Math.floor(width / 2);
  const starCount = options.starCount ?? 2600;
  const nebulaCount = options.nebulaCount ?? 26;
  const nebulaColors = options.nebulaColors ?? ['#2a3f8f', '#5b3a8f', '#1f6b7a', '#3a2a6b'];

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const random = createRng(BACKDROP_SEED);

  // ---- 1. 底色：从深蓝黑到接近纯黑的竖直渐变 ----
  const base = ctx.createLinearGradient(0, 0, 0, height);
  base.addColorStop(0, '#080a14');
  base.addColorStop(0.5, '#0b0f1e');
  base.addColorStop(1, '#06080f');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, width, height);

  // ---- 2. 星云：一堆柔和的彩色光斑 ----
  // 用 lighter（加色）混合，重叠的地方会更亮，像真正的星云
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < nebulaCount; i++) {
    const cx = random() % width;
    const cy = random() % height;
    // 星云团块大小差异很大，小的像亮斑、大的像云
    const radius = height * (0.08 + (random() % 1000) / 1000 * 0.22);
    const color = nebulaColors[random() % nebulaColors.length]!;
    // 透明度压得很低，靠多次叠加出层次
    const alpha = 0.1 + (random() % 1000) / 1000 * 0.16;

    const blob = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    blob.addColorStop(0, hexWithAlpha(color, alpha));
    blob.addColorStop(0.45, hexWithAlpha(color, alpha * 0.45));
    blob.addColorStop(1, hexWithAlpha(color, 0));
    ctx.fillStyle = blob;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  // ---- 3. 星星：大量小点 + 少量亮星 ----
  for (let i = 0; i < starCount; i++) {
    const x = random() % width;
    const y = random() % height;

    // 大多数是暗星，少数是亮星（真实星空就是这样，一堆暗的加几颗亮的）
    const roll = random() % 1000;
    const isBright = roll > 985;
    const radius = isBright ? 1.5 + (random() % 100) / 100 : 0.4 + (random() % 100) / 200;
    const alpha = isBright ? 0.9 : 0.25 + (random() % 1000) / 1000 * 0.55;

    // 星星颜色略有色偏（偏蓝、偏黄的白），比纯白自然
    const tint = random() % 3;
    const color = tint === 0 ? '255,255,255' : tint === 1 ? '200,220,255' : '255,240,210';

    ctx.fillStyle = `rgba(${color},${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    // 亮星加一圈柔光晕，看起来才有「亮」的感觉
    if (isBright) {
      const glowRadius = radius * 7;
      const glow = ctx.createRadialGradient(x, y, 0, x, y, glowRadius);
      glow.addColorStop(0, `rgba(${color},0.35)`);
      glow.addColorStop(1, `rgba(${color},0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const texture = new CanvasTexture(canvas);
  // 颜色空间要设对，否则背景会偏色（偏亮或偏灰）
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** 把 `#rrggbb` 加上透明度，转成 rgba() 字符串 */
function hexWithAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
}
