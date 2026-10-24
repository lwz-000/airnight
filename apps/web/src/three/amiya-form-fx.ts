/**
 * ============================================================
 *  ★★ 0.3.2：阿米娅两套升变形态的技能特效（程序化，全部由事件驱动）
 * ============================================================
 *
 * 【三套，三个挂载点，全是"内核说了算"】
 *   · `amiya_verdict` —— 慈悲愿景「慈悲愿景」：**3×4 方格阵 + 局部爆闪 + 三角粒子**，2.00 秒
 *     挂 `zone` 事件的 `fx`（数据 `damage.fx`）⇒ 只在**真正结算出伤害**那一瞬出现。
 *   · `amiya_requiem` —— 炉芯终曲「无言的期盼」：**全场破碎镜面碎片飘动**，10.00 秒
 *     挂 `cast` 事件的 `fx`（数据 `castFx`）⇒ 时长读技能数据，不写死。
 *   · `amiya_execute` —— 即死**成功那一刻**在被抹掉的人身上叠的黑红破碎，0.55 秒
 *     挂 `executeFx` 事件（`tickExecute` 报）⇒ 和普通阵亡分得开。
 *
 * 【为什么不走 `SKILL_FX`（序列帧）？】
 * 那套要美术一张张出图，而这三套的形状都由**参数**决定：
 * 方格阵要按内核给的真实格子摆（换个方向就是 4 列 × 3 行）、
 * 氛围碎片要 44 片各自漂移、即死裂纹要每次都不一样。
 * 出图就得为每种朝向各画一套，改一次数值还要重画 —— 所以这里全部画在 canvas 上。
 *
 * 【两条铁律】
 *   1. **加色混合下纯黑 = 完全看不见**（`MEMORY-细节 §4`）。所以：
 *      · 亮部（粉色方格 / 爆闪 / 熔红裂缝 / 血环）走 `AdditiveBlending`；
 *      · 暗部（黑弹芯之外的黑碎片、吞噬的黑心）走 `NormalBlending`，
 *        而且颜色必须**比棋盘略亮**（烟灰玻璃），否则黑压黑同样读不出来。
 *   2. **纯表现层**：只读事件里的字符串 id 和坐标，不重算命中、不推进任何战斗状态，
 *      也不进 `computeChecksum`。
 *
 * 【渲染层怎么知道"画哪些格子"？】
 * `zone` 事件只给 `from`（施法者格）、`cell`（中心）、`radius`、`shape`。
 * 数格子用的是**共享层的同一个 `withinShape`**（`packages/shared/src/field.ts`），
 * 不是在这里重写一遍 —— 重写就意味着"画出来的范围"和"真正打到的范围"迟早不一致。
 */
import {
  AdditiveBlending,
  CanvasTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  PlaneGeometry,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  type Object3D,
  type Texture,
} from 'three';
import { CELL } from '../game/grid.js';
import { RENDER_ORDER_FX } from './card-layout.js';

// ============================================================
//  配色（和提案稿 `.fx-proposal/amiya-ascend-fx.html` 一一对应）
// ============================================================

/** 慈悲愿景：全程只有一种粉，只淡出不偏色 */
export const VERDICT_PINK = {
  core: '#fff5fb',
  main: '#ff7ec8',
  edge: '#ff9ed8',
  tri: '#ffd6f0',
  flash: '#fff0f8',
} as const;

/**
 * 炉芯终曲：烟灰玻璃 + 暗红断口 + 冷高光。
 * ★ 碎片体**不能是纯黑**：这一层走普通混合，比棋盘更黑的东西在暗棋盘上同样消失。
 */
export const REQUIEM_DARK = {
  /** ★ 体不透明度 0.55 → 0.72：0.55 在真机上几乎读不出来（只剩一圈红边），"镜面"没了 */
  shardBody: 'rgba(58,65,80,0.72)',
  shardEdge: 'rgba(166,44,58,0.95)',
  highlight: 'rgba(206,216,230,0.85)',
  /** 受光面的斜向反光（"玻璃"和"塑料片"的分界） */
  glint: 'rgba(196,222,244,0.42)',
  seam: 'rgba(6,8,12,0.9)',
} as const;

/**
 * 即死叠加：黑红的读法 = 中心被吃掉（暗）+ 缝里透出熔红 + 断口暗红。
 * ★ `spark` 是**唯一**允许出现近白的地方，且只活 0.10 秒 ——
 *   上一版把裂纹画成纯白，整段读成"白色碎玻璃"，和用户要的"黑红破碎"不是一回事。
 */
export const EXECUTE_DARK = {
  ring: '#ff3b33',
  spark: 'rgba(255,232,228,0.95)',
  crackGlow: 'rgba(206,22,26,0.85)',
  crackCore: 'rgba(255,146,124,0.92)',
  shardBody: 'rgba(40,38,52,0.92)',
  shardEdge: 'rgba(182,40,44,0.9)',
  shardHot: 'rgba(255,96,74,0.75)',
} as const;

/** 亮度总闸门（防光污染，和技能光环/血镰同一套规矩） */
export const AMIYA_FX_CAP = {
  /** 单格填充上限：方格是"半透明的玻璃板"，不是实心色块 */
  verdictFill: 0.6,
  verdictEdge: 1.0,
  /** ★ 爆闪峰值可以开到 0.92 —— 因为它**只铺在 3×4 那 12 格上**（不是全屏） */
  verdictFlash: 0.92,
  verdictTri: 0.9,
  /** 氛围碎片单片上限 */
  requiemShard: 0.82,
  /** 即死各层 */
  executeRing: 0.95,
  executeCrack: 0.95,
  executeShard: 0.92,
} as const;

// ============================================================
//  时间轴（唯一实现：更新循环和测试都读这几个函数）
// ============================================================

/** 方格起亮（第一列） */
export const VERDICT_RISE_SECONDS = 0.18;
/** 保持到这个时刻，之后开始逐列熄灭 */
export const VERDICT_HOLD_UNTIL = 1.35;
/** 整段归零（用户口径："整套方块特效持续 2 秒后完全消失"） */
export const VERDICT_END_SECONDS = 2.0;
/** 逐列起亮错开 */
export const VERDICT_COL_STAGGER = 0.045;
/** 逐列熄灭错开（远端列先灭） */
export const VERDICT_FADE_STAGGER = 0.06;
/** 单格缩放：0.72 → 1.06（过冲）→ 1.0 */
export const VERDICT_SCALE_FROM = 0.72;
export const VERDICT_SCALE_OVER = 1.06;
export const VERDICT_SCALE_SECONDS = 0.22;
/** 爆闪：0 → 峰值 @60ms → 0 @220ms */
export const VERDICT_FLASH_PEAK_AT = 0.06;
export const VERDICT_FLASH_END = 0.22;
/** 每格几枚三角、边长（格）、沿周长滑动的圈数/秒 */
export const VERDICT_TRI_PER_CELL = 3;
export const VERDICT_TRI_CELLS = 0.16;
export const VERDICT_TRI_REVS_PER_SECOND = 0.55;
/** 同时在场上限（正常情况下一次技能只有一片） */
export const VERDICT_MAX_LIVE = 3;

/** 氛围：淡入 / 开始淡出 / 碎片总数 */
export const REQUIEM_FADE_IN = 0.6;
export const REQUIEM_FADE_OUT_SECONDS = 1.2;
export const REQUIEM_SHARD_COUNT = 56;
/** 碎片尺寸范围（格）—— 用户口径"再多一点点和明显一点点"后放大了一档 */
export const REQUIEM_SHARD_MIN = 0.24;
export const REQUIEM_SHARD_MAX = 0.58;
/** 上升速度范围（格/秒） */
export const REQUIEM_RISE_MIN = 0.25;
export const REQUIEM_RISE_MAX = 0.6;
/** 单片透明度范围 */
export const REQUIEM_ALPHA_MIN = 0.2;
export const REQUIEM_ALPHA_MAX = 0.44;
/** 氛围最长挂多久（技能 10 秒；再长也只挂这么久，防"一直脏着"） */
export const REQUIEM_MAX_SECONDS = 14;
export const REQUIEM_MAX_LIVE = 2;

/** 即死：总时长 / 吞噬段 / 裂纹段 */
export const EXECUTE_TOTAL_SECONDS = 0.55;
export const EXECUTE_BURST_UNTIL = 0.1;
export const EXECUTE_CRACK_LIFE = 0.45;
/** 碎片数 / 裂纹条数 */
export const EXECUTE_SHARD_COUNT = 16;
export const EXECUTE_CRACK_COUNT = 5;
export const EXECUTE_MAX_LIVE = 12;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function easeOutCubic(k: number): number {
  const t = clamp01(k);
  return 1 - Math.pow(1 - t, 3);
}

/** 按"出生尺寸 × 系数"缩放一层 Sprite（Sprite 的 scale 没有基准概念，必须自己乘回去） */
function scaleLayer(layer: ExecuteLayer, factor: number): void {
  layer.sprite.scale.set(layer.size * factor, layer.size * factor, 1);
}

/** 缩放曲线：0.72 → 1.06（过冲）→ 1.0，0.22 秒 `easeOutBack` */
export function verdictCellScale(ts: number): number {
  const k = clamp01(ts / VERDICT_SCALE_SECONDS);
  if (k >= 1) return 1;
  // easeOutBack：过冲到 1.06 再落回 1.0
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const back = 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
  return VERDICT_SCALE_FROM + (VERDICT_SCALE_OVER - VERDICT_SCALE_FROM) * back;
}

/**
 * 单格透明度包络。
 *
 * @param ts    这片方格阵从出现到现在多久（秒）
 * @param order 这一格"离施法者有多远"（单位：格）——
 *              越远起亮越晚、熄灭越早，读起来是"从脚下往外铺开、又从远处先收"
 */
export function verdictCellAlpha(ts: number, order: number): number {
  if (ts < 0 || ts > VERDICT_END_SECONDS) return 0;
  const start = order * VERDICT_COL_STAGGER;
  const local = ts - start;
  if (local <= 0) return 0;
  const rise = easeOutCubic(local / VERDICT_RISE_SECONDS);
  const fadeStart = Math.max(VERDICT_RISE_SECONDS, VERDICT_HOLD_UNTIL - order * VERDICT_FADE_STAGGER);
  const fade = clamp01((VERDICT_END_SECONDS - ts) / Math.max(0.01, VERDICT_END_SECONDS - fadeStart));
  return clamp01(Math.min(rise, fade));
}

/** 局部爆闪的透明度：0 → 0.92 @60ms → 0 @220ms */
export function verdictFlashAlpha(ts: number): number {
  if (ts < 0 || ts > VERDICT_FLASH_END) return 0;
  if (ts <= VERDICT_FLASH_PEAK_AT) {
    return AMIYA_FX_CAP.verdictFlash * easeOutCubic(ts / VERDICT_FLASH_PEAK_AT);
  }
  return AMIYA_FX_CAP.verdictFlash * (1 - easeOutCubic((ts - VERDICT_FLASH_PEAK_AT) / (VERDICT_FLASH_END - VERDICT_FLASH_PEAK_AT)));
}

/** 爆闪期"边框转白加粗"的强度（1 = 最热，0 = 已经回落） */
export function verdictHot(ts: number): number {
  return clamp01(1 - ts / VERDICT_FLASH_END);
}

/** 氛围的整体包络：0.6s 淡入，末尾 1.2s 淡出 */
export function requiemEnvelope(ts: number, seconds: number): number {
  if (ts < 0) return 0;
  const total = Math.max(0.2, seconds);
  const fadeOutFrom = Math.max(REQUIEM_FADE_IN, total - REQUIEM_FADE_OUT_SECONDS);
  if (ts > total) return 0;
  const rise = easeOutCubic(ts / REQUIEM_FADE_IN);
  const fall = clamp01((total - ts) / Math.max(0.01, total - fadeOutFrom));
  return clamp01(Math.min(rise, fall));
}

/** 即死：① 吞噬段（暗心 + 白闪 + 血环）还剩多少 */
export function executeBurstAlpha(ts: number): number {
  if (ts < 0 || ts > EXECUTE_BURST_UNTIL) return 0;
  return clamp01(1 - ts / EXECUTE_BURST_UNTIL);
}

/** 即死：② 熔红裂纹的剩余强度 */
export function executeCrackAlpha(ts: number): number {
  if (ts < 0 || ts > EXECUTE_CRACK_LIFE) return 0;
  return clamp01(1 - ts / EXECUTE_CRACK_LIFE);
}

/** 即死：③ 碎片外飞的剩余强度（0.02s 才起步，避开爆闪最亮的那几帧） */
export function executeShardAlpha(ts: number): number {
  const t0 = 0.02;
  if (ts < t0 || ts > EXECUTE_TOTAL_SECONDS) return 0;
  const k = clamp01((ts - t0) / (EXECUTE_TOTAL_SECONDS - t0));
  return 1 - k;
}

/** 碎片已经飞出去多远（格）：先快后慢，`d0` 保证 0.1 秒时已经出了亮核 */
export function executeShardTravel(ts: number): number {
  const t0 = 0.02;
  const k = clamp01((ts - t0) / (EXECUTE_TOTAL_SECONDS - t0));
  return 1 - Math.pow(1 - k, 2.4);
}

// ============================================================
//  注册表：数据里写的字符串 → 这个 id 是哪一套
// ============================================================

export const AMIYA_VERDICT_FX = 'amiya_verdict';
export const AMIYA_REQUIEM_FX = 'amiya_requiem';
export const AMIYA_EXECUTE_FX = 'amiya_execute';

/**
 * 三套 id 的清单（给 `fx-registry.test.ts` 用）。
 * ★ 数据里写的字符串必须在这个数组里，否则那条"数据 ↔ 渲染层"的对齐测试会红。
 */
export const AMIYA_FORM_FX_IDS = [AMIYA_VERDICT_FX, AMIYA_REQUIEM_FX, AMIYA_EXECUTE_FX] as const;

export function isVerdictFx(id: string | undefined): boolean {
  return id === AMIYA_VERDICT_FX;
}

export function isRequiemFx(id: string | undefined): boolean {
  return id === AMIYA_REQUIEM_FX;
}

export function isExecuteFx(id: string | undefined): boolean {
  return id === AMIYA_EXECUTE_FX;
}

// ============================================================
//  贴图（每种画一次，全局共享；★ 共享贴图不许 dispose）
// ============================================================

const TEX_SIZE = 256;
let plateTex: CanvasTexture | null = null;
let flashTex: CanvasTexture | null = null;
let triTex: CanvasTexture | null = null;
let shardTex: CanvasTexture | null = null;
let crackTex: CanvasTexture | null = null;
let ringTex: CanvasTexture | null = null;
let sparkTex: CanvasTexture | null = null;

function makeCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas 不可用');
  return { canvas, ctx };
}

function toTexture(canvas: HTMLCanvasElement): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  // ★ 不写色彩空间颜色会被冲淡（同 unit-aura / skill-cast-fx / leto-scythe 的说明）
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/**
 * 单格"粉色玻璃板"：粉主导的渐变 + 亮边 + 内发光。
 *
 * ★ 为什么不能是"近白 + 低 alpha"？近白混到深色棋盘上会读成**灰紫**，
 *   "粉色方块"这件事当场就丢了（提案稿踩过：第一版整片读成灰的）。
 */
export function verdictPlateTexture(): CanvasTexture {
  if (plateTex) return plateTex;
  const { canvas, ctx } = makeCanvas(TEX_SIZE);
  const pad = TEX_SIZE * 0.07;
  const inner = TEX_SIZE - pad * 2;

  // ① 填充：左上暖、右下深（加色下才有"一块玻璃"的体积感）
  const grad = ctx.createLinearGradient(pad, pad, pad + inner, pad + inner);
  grad.addColorStop(0, 'rgba(255,196,232,0.78)');
  grad.addColorStop(0.5, 'rgba(255,126,200,0.62)');
  grad.addColorStop(1, 'rgba(226,92,170,0.5)');
  roundRectPath(ctx, pad, pad, inner, inner, TEX_SIZE * 0.06);
  ctx.fillStyle = grad;
  ctx.fill();

  // ② 内发光：往内缩一圈的低透明度描边（不是模糊，是本项目一贯的"叠层"画法）
  for (const [inset, alpha, width] of [
    [TEX_SIZE * 0.055, 0.3, TEX_SIZE * 0.05],
    [TEX_SIZE * 0.1, 0.18, TEX_SIZE * 0.04],
  ] as const) {
    roundRectPath(ctx, pad + inset, pad + inset, inner - inset * 2, inner - inset * 2, TEX_SIZE * 0.04);
    ctx.strokeStyle = `rgba(255,158,216,${alpha})`;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  // ③ 亮边
  roundRectPath(ctx, pad, pad, inner, inner, TEX_SIZE * 0.06);
  ctx.strokeStyle = 'rgba(255,214,240,0.95)';
  ctx.lineWidth = TEX_SIZE * 0.022;
  ctx.stroke();

  // ④ 四角小三角刻痕（图形语汇：三角阵列 / 点阵）
  ctx.fillStyle = 'rgba(255,246,252,0.7)';
  const corner = TEX_SIZE * 0.05;
  for (const [cx, cy, sx, sy] of [
    [pad + corner, pad + corner, 1, 1],
    [pad + inner - corner, pad + corner, -1, 1],
    [pad + corner, pad + inner - corner, 1, -1],
    [pad + inner - corner, pad + inner - corner, -1, -1],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(cx + sx * corner * 0.9, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + sy * corner * 0.9);
    ctx.closePath();
    ctx.fill();
  }

  plateTex = toTexture(canvas);
  return plateTex;
}

/**
 * 局部爆闪：径向白粉光 + **贴图边缘一圈硬边**。
 *
 * ★ 这个平面的大小 = 12 格的外接矩形（内核给的格子算出来的），
 *   所以"贴图边"就是"方格阵的边" —— 用户口径"爆闪只在方块上，不是全屏"是这个意思。
 */
export function verdictFlashTexture(): CanvasTexture {
  if (flashTex) return flashTex;
  const { canvas, ctx } = makeCanvas(TEX_SIZE);
  const c = TEX_SIZE / 2;
  // 光核留一点点粉（纯白加色会往灰紫偏）
  const g = ctx.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0, 'rgba(255,242,250,1)');
  g.addColorStop(0.36, 'rgba(255,216,240,0.9)');
  g.addColorStop(0.7, 'rgba(255,170,220,0.6)');
  g.addColorStop(1, 'rgba(255,146,208,0.34)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  /*
    外框：把这块区域从棋盘上"顶"出来。
    ★ 用 `rect` + `stroke` 而不是 `strokeRect`：测试环境的 canvas 桩没实现后者，
      少一个方法就会让"启动即崩"（报错还完全看不出是桩的问题）。
  */
  ctx.strokeStyle = 'rgba(255,240,248,1)';
  ctx.lineWidth = TEX_SIZE * 0.05;
  const inset = ctx.lineWidth / 2;
  ctx.beginPath();
  ctx.rect(inset, inset, TEX_SIZE - ctx.lineWidth, TEX_SIZE - ctx.lineWidth);
  ctx.stroke();

  flashTex = toTexture(canvas);
  return flashTex;
}

/** 三角粒子：指向 +X 的小三角，中心偏白、边缘粉 */
export function verdictTriTexture(): CanvasTexture {
  if (triTex) return triTex;
  const size = 64;
  const { canvas, ctx } = makeCanvas(size);
  ctx.beginPath();
  ctx.moveTo(size * 0.92, size * 0.5);
  ctx.lineTo(size * 0.12, size * 0.14);
  ctx.lineTo(size * 0.12, size * 0.86);
  ctx.closePath();
  const g = ctx.createLinearGradient(size * 0.12, size * 0.5, size * 0.92, size * 0.5);
  g.addColorStop(0, 'rgba(255,214,240,0.85)');
  g.addColorStop(1, 'rgba(255,255,255,1)');
  ctx.fillStyle = g;
  ctx.fill();
  triTex = toTexture(canvas);
  return triTex;
}

/**
 * 碎片：不规则四边形 + 中缝暗线 + 一条冷高光。
 * 一个贴图同时给"氛围碎片"和"即死碎片"用（尺寸/透明度由实例决定）。
 */
export function requiemShardTexture(): CanvasTexture {
  if (shardTex) return shardTex;
  const size = 128;
  const { canvas, ctx } = makeCanvas(size);
  const w = size * 0.86;
  const h = size * 0.78;
  const x0 = (size - w) / 2;
  const y0 = (size - h) / 2;

  // ① 体：烟灰玻璃（普通混合下"比棋盘略亮"才读得出来）
  ctx.beginPath();
  ctx.moveTo(x0, y0 + h * 0.08);
  ctx.lineTo(x0 + w, y0);
  ctx.lineTo(x0 + w * 0.94, y0 + h * 0.92);
  ctx.lineTo(x0 + w * 0.06, y0 + h);
  ctx.closePath();
  ctx.fillStyle = REQUIEM_DARK.shardBody;
  ctx.fill();

  // ② 断口：暗红描边（"黑"能被看见的唯一理由）
  ctx.strokeStyle = REQUIEM_DARK.shardEdge;
  ctx.lineWidth = size * 0.028;
  ctx.stroke();

  /*
    ②½ 受光面：左上一道斜切的冷反光（夹在碎片形状里）。
    ★ 少了这一笔，真机上只剩一圈红边 —— 读成"描边空框"，完全不是"破碎镜面"。
  */
  ctx.save();
  ctx.clip();
  const glint = ctx.createLinearGradient(x0, y0 + h, x0 + w * 0.66, y0 + h * 0.16);
  glint.addColorStop(0, 'rgba(196,222,244,0)');
  glint.addColorStop(0.55, REQUIEM_DARK.glint);
  glint.addColorStop(1, 'rgba(196,222,244,0)');
  ctx.beginPath();
  ctx.moveTo(x0 - w * 0.2, y0 + h * 0.12);
  ctx.lineTo(x0 + w * 0.54, y0 + h * 0.02);
  ctx.lineTo(x0 + w * 0.22, y0 + h * 1.02);
  ctx.lineTo(x0 - w * 0.36, y0 + h * 0.7);
  ctx.closePath();
  ctx.fillStyle = glint;
  ctx.fill();
  ctx.restore();

  // ③ 中缝：一道折线暗线，读成"碎开的镜子"而不是一小块塑料片
  ctx.strokeStyle = REQUIEM_DARK.seam;
  ctx.lineWidth = size * 0.022;
  ctx.beginPath();
  ctx.moveTo(x0 + w * 0.14, y0 + h * 0.12);
  ctx.lineTo(x0 + w * 0.56, y0 + h * 0.52);
  ctx.lineTo(x0 + w * 0.44, y0 + h * 0.92);
  ctx.stroke();

  // ④ 冷高光：只有受光的那一条边
  ctx.strokeStyle = REQUIEM_DARK.highlight;
  ctx.lineWidth = size * 0.018;
  ctx.beginPath();
  ctx.moveTo(x0, y0 + h * 0.08);
  ctx.lineTo(x0 + w, y0);
  ctx.stroke();

  shardTex = toTexture(canvas);
  return shardTex;
}

/** 即死裂纹：暗心 + 5 条熔红折线（红晕 + 熔芯两遍画）+ 断口碎片一起烘在一张图上 */
export function executeCrackTexture(): CanvasTexture {
  if (crackTex) return crackTex;
  const size = 256;
  const { canvas, ctx } = makeCanvas(size);
  const c = size / 2;

  // ① 暗心：中心被吃掉（"人凭空消失"的那一下）
  const dg = ctx.createRadialGradient(c, c, 0, c, c, size * 0.3);
  dg.addColorStop(0, 'rgba(2,3,6,0.92)');
  dg.addColorStop(0.7, 'rgba(8,6,12,0.6)');
  dg.addColorStop(1, 'rgba(20,8,12,0)');
  ctx.fillStyle = dg;
  ctx.beginPath();
  ctx.arc(c, c, size * 0.3, 0, Math.PI * 2);
  ctx.fill();

  // ② 裂纹：固定随机数（同一张图每次都一样，不影响"每次都不一样"—— 位置由实例决定）
  const rnd = makeHash(0x51ed270b);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 0; i < EXECUTE_CRACK_COUNT; i++) {
    const a0 = (i / EXECUTE_CRACK_COUNT) * Math.PI * 2 + rnd() * 0.6;
    const pts: Array<[number, number]> = [[c, c]];
    let px = c;
    let py = c;
    for (let seg = 0; seg < 3; seg++) {
      const a = a0 + (rnd() - 0.5) * 0.9;
      const step = size * (0.07 + rnd() * 0.05);
      px += Math.cos(a) * step;
      py += Math.sin(a) * step;
      pts.push([px, py]);
    }
    const trace = (): void => {
      ctx.beginPath();
      ctx.moveTo(pts[0]![0], pts[0]![1]);
      for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k]![0], pts[k]![1]);
      ctx.stroke();
    };
    // 外圈红晕（加色才"透光"而不是糊一条脏线）
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = EXECUTE_DARK.crackGlow;
    ctx.lineWidth = size * 0.022;
    trace();
    // 熔芯：细、暖、亮
    ctx.strokeStyle = EXECUTE_DARK.crackCore;
    ctx.lineWidth = size * 0.007;
    trace();
    ctx.globalCompositeOperation = 'source-over';
  }

  crackTex = toTexture(canvas);
  return crackTex;
}

/** 血环：细环 + 内外柔和衰减 */
export function executeRingTexture(): CanvasTexture {
  if (ringTex) return ringTex;
  const size = 256;
  const { canvas, ctx } = makeCanvas(size);
  const c = size / 2;
  const r = size * 0.42;
  const g = ctx.createRadialGradient(c, c, r * 0.62, c, c, r * 1.06);
  g.addColorStop(0, 'rgba(255,59,51,0)');
  g.addColorStop(0.55, 'rgba(255,59,51,0.9)');
  g.addColorStop(0.78, 'rgba(255,140,120,0.55)');
  g.addColorStop(1, 'rgba(255,59,51,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(c, c, r * 1.06, 0, Math.PI * 2);
  ctx.fill();
  ringTex = toTexture(canvas);
  return ringTex;
}

/** 一点白热（即死那 0.1 秒的 spark） */
export function executeSparkTexture(): CanvasTexture {
  if (sparkTex) return sparkTex;
  const size = 128;
  const { canvas, ctx } = makeCanvas(size);
  const c = size / 2;
  const g = ctx.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0, EXECUTE_DARK.spark);
  g.addColorStop(0.45, 'rgba(255,150,130,0.5)');
  g.addColorStop(1, 'rgba(255,90,70,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  sparkTex = toTexture(canvas);
  return sparkTex;
}

/** 开局把七张图画出来（画布生成很快，但别等到第一次开技能那一帧才做） */
export function preloadAmiyaFormFxTextures(): void {
  verdictPlateTexture();
  verdictFlashTexture();
  verdictTriTexture();
  requiemShardTexture();
  executeCrackTexture();
  executeRingTexture();
  executeSparkTexture();
}

// ============================================================
//  确定性伪随机（定格与实时必须长得一样 ⇒ 不许用 Math.random）
// ============================================================

type Hash = () => number;

function makeHash(seed: number): Hash {
  let state = seed >>> 0;
  return () => {
    // mulberry32
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================================================
//  场景实例
// ============================================================

/** 方格阵里的一格：世界坐标 + 离施法者多远（决定起亮/熄灭的顺序） */
export interface VerdictCellSpec {
  x: number;
  z: number;
  order: number;
}

interface VerdictCellView {
  mesh: Mesh;
  geometry: PlaneGeometry;
  material: MeshBasicMaterial;
  order: number;
  tris: Array<{ sprite: Sprite; material: SpriteMaterial; u0: number }>;
}

interface VerdictInstance {
  group: Group;
  cells: VerdictCellView[];
  flash: { mesh: Mesh; geometry: PlaneGeometry; material: MeshBasicMaterial };
  age: number;
}

interface RequiemShard {
  sprite: Sprite;
  material: SpriteMaterial;
  /** 出生时的高度（世界 y，格） */
  y0: number;
  /** 落地时的水平位置 */
  x0: number;
  z0: number;
  /** 上升速度（格/秒） */
  rise: number;
  /** 横向摆动幅度 / 相位 */
  sway: number;
  phase: number;
  /** 自转速度（rad/s） */
  spin: number;
  baseRotation: number;
  alpha: number;
}

interface RequiemInstance {
  group: Group;
  shards: RequiemShard[];
  age: number;
  seconds: number;
}

/**
 * 即死叠加的一层。
 * ★ 全部用 `Sprite`（永远正对镜头）：这一套是"贴着人身上"的一层光，
 *   用平面 Mesh 的话 45° 俯视会把它压成一条缝。
 */
interface ExecuteLayer {
  sprite: Sprite;
  material: SpriteMaterial;
  /** 出生时的边长（世界单位）—— 每帧按它乘缩放系数 */
  size: number;
}

interface ExecuteInstance {
  group: Group;
  crack: ExecuteLayer;
  ring: ExecuteLayer;
  spark: ExecuteLayer;
  shards: Array<
    ExecuteLayer & {
      dirX: number;
      dirZ: number;
      speed: number;
      d0: number;
      spin: number;
      baseRot: number;
    }
  >;
  age: number;
}

let root: Object3D | null = null;
const verdicts: VerdictInstance[] = [];
const requiems: RequiemInstance[] = [];
const executes: ExecuteInstance[] = [];

/** 把特效挂到哪个根节点上（`replay.ts` 初始化时调一次，和血镰/回血光环同一处） */
export function attachAmiyaFormFxRoot(scene: Object3D): void {
  root = scene;
}

/** 贴地平面统一抬一点，避免和地板 z-fighting */
const GROUND_Y = 0.012;

/**
 * 播一片「慈悲愿景」的方格阵。
 *
 * @param cells  内核给的真实格子（世界坐标 + 离施法者的距离）——
 *               ★ 由 `replay.ts` 用共享的 `withinShape` 数出来，这里不自己推 rect
 * @param minX/maxX/minZ/maxZ  这片格子的外接矩形（爆闪就铺在它上面）
 */
export function spawnVerdictGrid(
  cells: VerdictCellSpec[],
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
): void {
  if (!root || cells.length === 0) return;
  if (verdicts.length >= VERDICT_MAX_LIVE) {
    const oldest = verdicts.shift();
    if (oldest) disposeVerdict(oldest);
  }

  const group = new Group();
  const plate = verdictPlateTexture();
  const triTexture = verdictTriTexture();
  const views: VerdictCellView[] = [];

  for (const cell of cells) {
    const geometry = new PlaneGeometry(CELL * 0.94, CELL * 0.94);
    const material = new MeshBasicMaterial({
      map: plate,
      transparent: true,
      opacity: 0,
      // ★ 加色：粉色的"亮"全靠它；改普通混合会变成一块死粉布
      blending: AdditiveBlending,
      side: DoubleSide,
      depthWrite: false,
    });
    const mesh = new Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(cell.x, GROUND_Y, cell.z);
    mesh.renderOrder = RENDER_ORDER_FX;
    group.add(mesh);

    // 三角粒子：每格 3 枚，沿周长滑动
    const tris: VerdictCellView['tris'] = [];
    for (let i = 0; i < VERDICT_TRI_PER_CELL; i++) {
      const triMaterial = new SpriteMaterial({
        map: triTexture,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      });
      const sprite = new Sprite(triMaterial);
      const size = CELL * VERDICT_TRI_CELLS;
      sprite.scale.set(size, size, 1);
      sprite.position.set(cell.x, GROUND_Y + 0.02, cell.z);
      sprite.renderOrder = RENDER_ORDER_FX + 1;
      group.add(sprite);
      tris.push({ sprite, material: triMaterial, u0: i / VERDICT_TRI_PER_CELL + (cell.order * 0.043) % 1 });
    }

    views.push({ mesh, geometry, material, order: cell.order, tris });
  }

  // 爆闪：正好铺在外接矩形上（= 3×4 那 12 格，不多不少）
  const spanX = Math.max(CELL * 0.5, (bounds.maxX - bounds.minX) + CELL);
  const spanZ = Math.max(CELL * 0.5, (bounds.maxZ - bounds.minZ) + CELL);
  const flashGeometry = new PlaneGeometry(spanX, spanZ);
  const flashMaterial = new MeshBasicMaterial({
    map: verdictFlashTexture(),
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    side: DoubleSide,
    depthWrite: false,
  });
  const flashMesh = new Mesh(flashGeometry, flashMaterial);
  flashMesh.rotation.x = -Math.PI / 2;
  flashMesh.position.set((bounds.minX + bounds.maxX) / 2, GROUND_Y + 0.004, (bounds.minZ + bounds.maxZ) / 2);
  flashMesh.renderOrder = RENDER_ORDER_FX + 2;
  group.add(flashMesh);

  root.add(group);
  verdicts.push({ group, cells: views, flash: { mesh: flashMesh, geometry: flashGeometry, material: flashMaterial }, age: 0 });
}

/**
 * 播「炉芯终曲」的全场碎裂氛围。
 *
 * @param seconds 技能持续多久（读技能数据）；超过 `REQUIEM_MAX_SECONDS` 按上限算
 */
export function spawnRequiemAmbient(seconds: number): void {
  if (!root) return;
  if (requiems.length >= REQUIEM_MAX_LIVE) {
    const oldest = requiems.shift();
    if (oldest) disposeRequiem(oldest);
  }
  const total = Math.min(REQUIEM_MAX_SECONDS, Math.max(0.5, seconds));
  const group = new Group();
  const texture = requiemShardTexture();
  const rnd = makeHash(0x9e3779b9);
  const shards: RequiemShard[] = [];

  /*
    ★ 铺满整块棋盘（10×10），不是"围着施法者一圈"——
    用户口径是"在全场持续飘动"。
  */
  const halfX = (10 * CELL) / 2;
  const halfZ = (10 * CELL) / 2;

  for (let i = 0; i < REQUIEM_SHARD_COUNT; i++) {
    const size = CELL * (REQUIEM_SHARD_MIN + rnd() * (REQUIEM_SHARD_MAX - REQUIEM_SHARD_MIN));
    const material = new SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 0,
      /*
        ★★ 必须普通混合：加色混合下"黑碎片"等于什么都没画。
        这一层的作用是让棋盘"变脏"，而普通混合是唯一能压住画面的方式。
      */
      blending: NormalBlending,
      depthWrite: false,
      depthTest: false,
    });
    const sprite = new Sprite(material);
    sprite.scale.set(size, size * (0.8 + rnd() * 0.3), 1);
    const x0 = (rnd() - 0.5) * 2 * halfX;
    const z0 = (rnd() - 0.5) * 2 * halfZ;
    const y0 = CELL * (0.1 + rnd() * 1.6);
    sprite.position.set(x0, y0, z0);
    sprite.renderOrder = RENDER_ORDER_FX + 3;
    group.add(sprite);
    shards.push({
      sprite,
      material,
      y0,
      x0,
      z0,
      rise: CELL * (REQUIEM_RISE_MIN + rnd() * (REQUIEM_RISE_MAX - REQUIEM_RISE_MIN)),
      sway: CELL * (0.1 + rnd() * 0.3),
      phase: rnd() * Math.PI * 2,
      spin: (rnd() - 0.5) * 1.1,
      baseRotation: rnd() * Math.PI * 2,
      alpha: REQUIEM_ALPHA_MIN + rnd() * (REQUIEM_ALPHA_MAX - REQUIEM_ALPHA_MIN),
    });
  }

  root.add(group);
  requiems.push({ group, shards, age: 0, seconds: total });
}

/** 在某个人身上叠一段"被即死"的黑红破碎 */
export function spawnExecuteShard(x: number, z: number, y = CELL * 0.5): void {
  if (!root) return;
  if (executes.length >= EXECUTE_MAX_LIVE) {
    const oldest = executes.shift();
    if (oldest) disposeExecute(oldest);
  }
  const group = new Group();
  group.position.set(x, 0, z);

  /*
    ★ 用 Sprite 而不是平面 Mesh：Sprite 永远正对镜头，缩放/自转都是屏幕空间的。
    平面 Mesh 在 45° 俯视下会被压成一条缝，而且 `MeshBasicMaterial` 没有 `rotation`
    （自转得转 mesh 本身，转的是世界轴，看起来像在翻跟头）。
  */
  const makeLayer = (
    texture: Texture,
    sizeWorld: number,
    blending: typeof AdditiveBlending | typeof NormalBlending,
    yWorld: number,
  ): ExecuteLayer => {
    const material = new SpriteMaterial({
      map: texture,
      transparent: true,
      opacity: 0,
      blending,
      depthWrite: false,
      // ★ 关深度测试：这是贴在棋子胸口的一层光，被前面的卡面挡住就没意义了
      depthTest: false,
    });
    const sprite = new Sprite(material);
    sprite.scale.set(sizeWorld, sizeWorld, 1);
    sprite.position.y = yWorld;
    sprite.renderOrder = RENDER_ORDER_FX + 4;
    group.add(sprite);
    return { sprite, material, size: sizeWorld };
  };

  // 裂纹（暗心烘在贴图里，普通混合 —— 靠"吃掉这块"读出来）
  const crack = makeLayer(executeCrackTexture(), CELL * 1.9, NormalBlending, y);
  // 血环（加色）
  const ring = makeLayer(executeRingTexture(), CELL * 2.2, AdditiveBlending, y);
  ring.sprite.renderOrder = RENDER_ORDER_FX + 5;
  // 白闪（加色，只活 0.1 秒）
  const spark = makeLayer(executeSparkTexture(), CELL * 0.7, AdditiveBlending, y);
  spark.sprite.renderOrder = RENDER_ORDER_FX + 6;

  // 碎片外飞
  const rnd = makeHash(0x51ed270b ^ Math.floor(x * 131 + z * 17));
  const shardTexture = requiemShardTexture();
  const shards: ExecuteInstance['shards'] = [];
  for (let i = 0; i < EXECUTE_SHARD_COUNT; i++) {
    const size = CELL * (0.1 + rnd() * 0.12);
    const material = new SpriteMaterial({
      map: shardTexture,
      transparent: true,
      opacity: 0,
      blending: NormalBlending,
      depthWrite: false,
      depthTest: false,
    });
    const sprite = new Sprite(material);
    sprite.scale.set(size, size * (0.8 + rnd() * 0.3), 1);
    sprite.position.set(0, y, 0);
    sprite.renderOrder = RENDER_ORDER_FX + 4;
    group.add(sprite);
    const angle = rnd() * Math.PI * 2;
    shards.push({
      sprite,
      material,
      size,
      dirX: Math.cos(angle),
      dirZ: Math.sin(angle),
      // 120~260 px/s 在提案稿是 2D 像素；换成格：1 格 ≈ 56px ⇒ 2.1~4.6 格/秒
      speed: CELL * (2.1 + rnd() * 2.5),
      // ★ 起点就给 6~14px（≈0.1~0.25 格）的偏移：爆闪那 0.1 秒里碎片已经在圈外了
      d0: CELL * (0.1 + rnd() * 0.15),
      spin: (rnd() - 0.5) * 7,
      baseRot: rnd() * Math.PI,
    });
  }

  root.add(group);
  executes.push({ group, crack, ring, spark, shards, age: 0 });
}

/**
 * 每帧推进。`deltaSeconds` 是**回放时钟**的增量 ⇒ 两倍速 / 看录像 / 断线重连都自动正确。
 */
export function updateAmiyaFormFx(deltaSeconds: number): void {
  if (!root) return;

  // ---- ① 慈悲愿景：方格阵 ----
  for (let i = verdicts.length - 1; i >= 0; i--) {
    const inst = verdicts[i]!;
    inst.age += deltaSeconds;
    if (inst.age > VERDICT_END_SECONDS) {
      disposeVerdict(inst);
      verdicts.splice(i, 1);
      continue;
    }
    const ts = inst.age;
    const scale = verdictCellScale(ts);
    const hot = verdictHot(ts);
    for (const cell of inst.cells) {
      const alpha = verdictCellAlpha(ts, cell.order);
      cell.material.opacity = alpha * (AMIYA_FX_CAP.verdictFill + hot * 0.32);
      // 爆闪期边框转白加粗：用整体缩放代替（顶点色改不了，缩放是最省的一招）
      cell.mesh.scale.setScalar(scale * (1 + hot * 0.06));
      // 三角：沿周长滑动，爆闪期一起变亮（这时它才显眼）
      for (const tri of cell.tris) {
        const u = ((ts * VERDICT_TRI_REVS_PER_SECOND + tri.u0) % 1 + 1) % 1;
        const edge = Math.floor(u * 4);
        const f = u * 4 - edge;
        const half = CELL * 0.47;
        let ox = 0;
        let oz = 0;
        let rot = 0;
        if (edge === 0) {
          ox = -half + f * CELL * 0.94;
          oz = -half;
          rot = 0;
        } else if (edge === 1) {
          ox = half;
          oz = -half + f * CELL * 0.94;
          rot = Math.PI / 2;
        } else if (edge === 2) {
          ox = half - f * CELL * 0.94;
          oz = half;
          rot = Math.PI;
        } else {
          ox = -half;
          oz = half - f * CELL * 0.94;
          rot = -Math.PI / 2;
        }
        // ★ 沿外法线再推 4px：贴着格子边画会被边和辉光吃掉，看不见
        const push = CELL * 0.07;
        const nx = edge === 1 ? 1 : edge === 3 ? -1 : 0;
        const nz = edge === 0 ? -1 : edge === 2 ? 1 : 0;
        tri.sprite.position.set(
          cell.mesh.position.x + ox + nx * push,
          GROUND_Y + 0.02,
          cell.mesh.position.z + oz + nz * push,
        );
        tri.material.rotation = rot;
        tri.material.opacity = alpha * AMIYA_FX_CAP.verdictTri * (0.55 + hot * 0.45);
      }
    }
    const flashAlpha = verdictFlashAlpha(ts);
    inst.flash.material.opacity = flashAlpha;
    if (flashAlpha > 0) {
      // 外框爆亮同步"撑开"：整体放一点点，读成"这一块被顶起来了"
      const k = clamp01(ts / VERDICT_FLASH_END);
      inst.flash.mesh.scale.setScalar(1 + easeOutCubic(k) * 0.06);
    }
  }

  // ---- ② 炉芯终曲：全场碎裂氛围 ----
  for (let i = requiems.length - 1; i >= 0; i--) {
    const inst = requiems[i]!;
    inst.age += deltaSeconds;
    const env = requiemEnvelope(inst.age, inst.seconds);
    if (inst.age > inst.seconds) {
      disposeRequiem(inst);
      requiems.splice(i, 1);
      continue;
    }
    for (const shard of inst.shards) {
      const y = shard.y0 + shard.rise * inst.age;
      // 升到天上就绕回去（否则 10 秒后碎片全在天花板上）
      const t = inst.age;
      const cycle = CELL * 5;
      const yy = ((y % cycle) + cycle) % cycle;
      shard.sprite.position.set(
        shard.x0 + Math.sin(t * 0.8 + shard.phase) * shard.sway,
        CELL * 0.1 + yy,
        shard.z0 + Math.cos(t * 0.62 + shard.phase) * shard.sway * 0.7,
      );
      shard.material.rotation = shard.baseRotation + shard.spin * t;
      // 闪烁：让"飘"有呼吸感，不是一层静止的脏东西
      const flick = 0.75 + 0.25 * Math.sin(t * 2.2 + shard.phase);
      shard.material.opacity = clamp01(env * shard.alpha * flick * AMIYA_FX_CAP.requiemShard * 2);
    }
  }

  // ---- ③ 即死：黑红破碎 ----
  for (let i = executes.length - 1; i >= 0; i--) {
    const inst = executes[i]!;
    inst.age += deltaSeconds;
    if (inst.age > EXECUTE_TOTAL_SECONDS) {
      disposeExecute(inst);
      executes.splice(i, 1);
      continue;
    }
    const ts = inst.age;

    // ① 吞噬段：暗心 + 白闪 + 血环
    const burst = executeBurstAlpha(ts);
    inst.crack.material.opacity = clamp01(Math.max(burst, executeCrackAlpha(ts)));
    if (burst > 0) {
      const k = 1 - burst; // 0 → 1
      // ★ Sprite 的 scale 是绝对尺寸（没有"基准"概念）⇒ 每帧按出生尺寸乘系数
      scaleLayer(inst.crack, 0.5 + easeOutCubic(k) * 0.7);
      inst.spark.material.opacity = burst * 0.9;
      scaleLayer(inst.spark, 0.45 + k * 0.55);
      inst.ring.material.opacity = burst * AMIYA_FX_CAP.executeRing;
      scaleLayer(inst.ring, 0.3 + easeOutCubic(k) * 1.0);
    } else {
      inst.spark.material.opacity = 0;
      inst.ring.material.opacity = 0;
      // 裂纹段：继续稍稍扩张（碎片在往外飞）
      const k = clamp01(ts / EXECUTE_CRACK_LIFE);
      scaleLayer(inst.crack, 1.2 + k * 0.25);
    }

    // ③ 碎片外飞
    const shardAlpha = executeShardAlpha(ts);
    const travel = executeShardTravel(ts);
    for (const shard of inst.shards) {
      const d = shard.d0 + shard.speed * travel;
      shard.sprite.position.x = shard.dirX * d;
      shard.sprite.position.z = shard.dirZ * d;
      // 一点下坠（碎片是有重量的，纯直线飞看起来像箭头）
      shard.sprite.position.y = CELL * 0.5 - travel * travel * CELL * 0.18;
      shard.material.rotation = shard.baseRot + shard.spin * ts;
      shard.material.opacity = clamp01(shardAlpha * AMIYA_FX_CAP.executeShard);
    }
  }
}

function disposeVerdict(inst: VerdictInstance): void {
  inst.group.parent?.remove(inst.group);
  for (const cell of inst.cells) {
    cell.geometry.dispose();
    cell.material.dispose();
    for (const tri of cell.tris) tri.material.dispose();
  }
  inst.flash.geometry.dispose();
  inst.flash.material.dispose();
  // ★ 贴图是模块级共享的（画一次）—— 别 dispose，否则下一片就没图了
  inst.group.clear();
}

function disposeRequiem(inst: RequiemInstance): void {
  inst.group.parent?.remove(inst.group);
  for (const shard of inst.shards) shard.material.dispose();
  inst.group.clear();
}

function disposeExecute(inst: ExecuteInstance): void {
  inst.group.parent?.remove(inst.group);
  // ★ Sprite 没有独立 geometry 要释放（共用内部那一个），只放材质
  inst.crack.material.dispose();
  inst.ring.material.dispose();
  inst.spark.material.dispose();
  for (const shard of inst.shards) shard.material.dispose();
  inst.group.clear();
}

/** 清空（重开一局/切回合必须调，否则方格阵和碎片会留在棋盘上） */
export function clearAmiyaFormFx(): void {
  for (const inst of verdicts) disposeVerdict(inst);
  verdicts.length = 0;
  for (const inst of requiems) disposeRequiem(inst);
  requiems.length = 0;
  for (const inst of executes) disposeExecute(inst);
  executes.length = 0;
}

/** 测试 / 排查用：现在场上有几片 */
export function amiyaFormFxLiveCount(): { verdicts: number; requiems: number; executes: number } {
  return { verdicts: verdicts.length, requiems: requiems.length, executes: executes.length };
}
