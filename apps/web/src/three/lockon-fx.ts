/**
 * ============================================================
 *  ★★ 0.2.2 蕾缪安 3 星「强制追思」：锁定地块的狙击镜 + 收缩光环 + 粉色爆破
 * ============================================================
 *
 * 【用户口径（2026-10-19）】
 *   「在技能开启期间，被锁定的地块上出现被瞄准的特效（狙击镜的那种），
 *     然后外面有一圈粉色光环向内循环收缩，然后产生粉色为主金色渐变的爆炸特效」
 *
 * 【它挂在哪两条事件上？】
 *   · `lockOnMark`  —— 每锁住一个地块发一条（每秒一个，共 7 个）
 *   · `lockOnBlast` —— 7 秒后引爆那一下，**每个落点各发一条**
 * 两条都是**纯表现层**事件（`computeChecksum` 里 `continue`），由内核在
 * "真的锁定了 / 真的炸了"的那一刻发出 —— 渲染层不自己算"该锁谁"。
 *
 * 【为什么瞄准镜是贴地的、爆炸却是立牌（Sprite）？】
 *   · 瞄准镜**标记的是一个格子**：贴地画才对得上"这块地要被打了"，
 *     45° 俯视压扁一点反而更像地面上的投影；
 *   · 爆炸是**光**：贴地画会被压成扁椭圆（血镰踩过这个坑，见 MEMORY-特效 §2），
 *     立牌（Sprite 正对镜头）才是"炸开一团光"该有的样子。
 *   ★ 两者叠加正好是"地上的靶标 + 空中炸开的花"，层次也分得开。
 *
 * 【为什么全部用 canvas 现画，不用序列帧？】
 *   ① 这套是**几何 + 渐变**（同心圆、十字线、径向渐变），程序化比手绘更准；
 *   ② 序列帧要进 `SEQ_FX` 表、要按 `cells = 帧宽/256` 登记、要真图 —— 
 *      为一个技能铺 3 套贴图不划算，而且改颜色要重出一遍图。
 *   canvas 画一次缓存住，之后每帧只改 scale/opacity，几乎不花性能。
 *
 * 【颜色口径】
 *   用户要"**粉色为主、金色渐变**"：核心是**白粉**（加色混合下最亮的那点），
 *   中段玫粉，外缘转到**金**再淡出。纯深粉在深色棋盘上会糊成一团，
 *   所以粉色取偏亮的那一档（和回血光环的 `0xff6ec7` 同一家族）。
 */

import {
  AdditiveBlending,
  CanvasTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  type Object3D,
  type Texture,
} from 'three';
import { CELL } from '../game/grid.js';
import { RENDER_ORDER_FX } from './card-layout.js';

/** 狙击镜样式 id（数据里 `SkillEffect.lockOn.fx` 写它） */
export const LOCKON_SNIPER = 'lockon_sniper';

/**
 * 瞄准镜的半径（世界单位 = 格）。
 * 一格是 1.0，卡面大约 0.9 宽 ⇒ 0.58 的环正好**圈住卡面还留一圈边**，
 * 隔着棋子也看得见"这块地被瞄上了"。
 * ★ 别往上加：真机试过 0.62，两个**相邻**的地块一起被锁时两圈会明显叠在一起，
 *   看着像"一个歪掉的大圈"（`_fxcheck` 定格图对比过）。
 */
export const MARK_RADIUS = 0.58;

/** 瞄准镜弹出来的时长（秒）—— 短一点才有"啪一下锁定"的感觉 */
export const MARK_POP_SECONDS = 0.22;

/** 收缩光环一圈的周期（秒）。用户要"循环收缩"，这个数决定呼吸快慢 */
export const CONVERGE_PERIOD = 1.15;

/** 收缩环的起止半径（相对 `MARK_RADIUS`）—— 从卡片外面一路收到中心 */
export const CONVERGE_FROM = 1.55;
export const CONVERGE_TO = 0.55;

/** 爆炸总时长（秒）：主爆闪 + 冲击波 + 碎片都在这段时间里走完 */
export const BURST_SECONDS = 0.55;

/**
 * 爆闪的最大直径（相对 `MARK_RADIUS` 的倍数）。
 *
 * ★ 真机定过：3.4 的时候一发爆炸横跨 4 格多，相邻两个落点一叠加就是**一整片白**，
 *   粉色和金色全被加色混合烧没了。现在 2.0 ⇒ 直径 ≈ 2.3 格，
 *   刚好盖住 3×3 落点的大半，两发挨着也还分得清是两团。
 */
export const BURST_SPREAD = 2.0;

/** 碎片个数 */
export const BURST_SHARD_COUNT = 8;

/** 同屏上限（7 个落点也就 7 个；留点余量防"连续两波技能"） */
export const LOCKON_MAX_MARKS = 16;
export const LOCKON_MAX_BURSTS = 24;

/** 一圈瞄准镜最多活多久（秒）—— 兜底：万一引爆事件没来，别永远挂在场上 */
export const MARK_MAX_SECONDS = 12;

interface LockOnStyle {
  /** 瞄准镜的主色（canvas 描边） */
  scope: string;
  /** 瞄准镜里的高光（十字线中心、刻度） */
  scopeHi: string;
  /** 收缩光环的外圈色（加色） */
  ring: number;
  /** 收缩光环的内圈色（更浅，两层才有"往里收"的层次） */
  ringInner: number;
  /** 爆闪核心（白粉） */
  burstCore: number;
  /** 爆闪主体（玫粉） */
  burstPink: number;
  /** 爆闪外缘（金） */
  burstGold: number;
  /** 冲击波 */
  shock: number;
  /** 碎片 */
  shard: number;
}

/**
 * 注册表：数据里写的 id → 配色。
 * ★ **键集合就是"合法 id 集合"**（`fx-registry.test.ts` 拿它扫数据）。
 * 以后要给别的干员换一套颜色，这里加一行 + 数据里写这个 id 就行。
 */
const LOCKON_STYLES: Record<string, LockOnStyle> = {
  [LOCKON_SNIPER]: {
    scope: 'rgba(255, 138, 205, 0.95)',
    scopeHi: 'rgba(255, 244, 252, 0.95)',
    ring: 0xff5fb0,
    ringInner: 0xffc4e6,
    /*
      ★ 核心**不能写接近白**（`0xffe8f6` 试过）：加色混合下它一叠加就是纯白，
      "粉色为主"直接没了。取浅粉 `0xffb3dd`，中心才看得见颜色。
    */
    burstCore: 0xffb3dd,
    burstPink: 0xff4fa8,
    burstGold: 0xffc247,
    /*
      ★ 冲击波用**饱和的金橙**而不是浅金：加色混合下 `0xffd98a` 那种浅金
      叠在粉色上会直接白掉，那一圈看起来像"白描边"而不是金环（真机对比过）。
    */
    shock: 0xffa22e,
    shard: 0xff9fd0,
  },
};

/** 全部合法 id */
export const LOCKON_FX: readonly string[] = Object.keys(LOCKON_STYLES);

/** 这个 id 是不是锁定特效（渲染层唯一判据；不认识的一律按默认样式画） */
export function isLockOnFx(id: string | undefined | null): boolean {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(LOCKON_STYLES, id);
}

/** 取配色（绝不返回 undefined，否则后面取色会炸） */
export function lockOnStyleOf(id?: string | null): LockOnStyle {
  return (id && LOCKON_STYLES[id]) || LOCKON_STYLES[LOCKON_SNIPER]!;
}

// ============================================================
//  曲线（纯函数：测试直接断言"会不会缩没 / 会不会炸到天外"）
// ============================================================

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

/** 标准 easeOutCubic */
function easeOutCubic(k: number): number {
  const t = clamp01(k);
  return 1 - Math.pow(1 - t, 3);
}

/**
 * easeOutBack：冲过终点再弹回来。
 * ★ 瞄准镜要的就是这口"啪"——线性放大看起来像慢慢充气。
 */
function easeOutBack(k: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const t = clamp01(k);
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/** 瞄准镜弹出时的缩放（0.62 → 弹到 ~1.04 → 落回 1） */
export function markScaleAt(age: number): number {
  const k = clamp01(age / MARK_POP_SECONDS);
  return 0.62 + 0.38 * easeOutBack(k);
}

/**
 * 瞄准镜的不透明度。
 *
 * 结构：淡入 0.18s → 常亮（轻微呼吸）→ 寿命最后 0.45s 淡出。
 * ★ 最后那段淡出是给"引爆事件没来"的情况兜底的 —— 它不会永远挂在那儿。
 */
export function markOpacityAt(age: number, life: number): number {
  const k = clamp01(age / Math.max(0.001, life));
  const fadeIn = Math.min(1, age / 0.18);
  const fadeOut = Math.min(1, (1 - k) / 0.18);
  // 0.78~0.92 之间轻呼吸：完全不动会像贴纸，动太快又像闪烁
  const breathe = 0.85 + 0.07 * Math.sin(age * 4.2);
  return Math.max(0, Math.min(1, fadeIn * fadeOut * breathe));
}

/**
 * 向内收缩的粉色光环。
 *
 * `phase` 是 0..1 的**循环相位**（`(age / 周期) % 1`），所以它自己就是一个闭环：
 * 收到的只是"现在走到一圈的第几成"，不用记生命周期。
 *
 * ★ 不透明度必须**收到 1 时为 0**：否则每一圈结束时会在外圈"啪"地消失一下，
 *   看起来像掉帧。淡入 12% / 淡出用 2.4 次幂，读起来是"从外面滑进来、贴到中心才化掉"。
 */
export function convergeRingAt(phase: number): { scale: number; opacity: number } {
  const k = clamp01(phase);
  const scale = CONVERGE_FROM + (CONVERGE_TO - CONVERGE_FROM) * k;
  const fadeIn = Math.min(1, k / 0.12);
  const fadeOut = 1 - Math.pow(k, 2.4);
  // 0.85 —— 真机上 0.78 那版在"瞄准镜自身外圈"旁边显得太弱，看不出是另一条环
  return { scale, opacity: 0.85 * fadeIn * fadeOut };
}

/**
 * 爆炸主闪：从 0.35 倍炸到 `BURST_SPREAD` 倍，前段快、后段慢。
 *
 * ★ 峰值不透明度封在 **0.88** 而不是 1：加色混合下满不透明度会直接把三通道**烧成白色**，
 *   "粉色为主、金色渐变"全没了（真机第一版就是这么糊成一团白的）。
 */
export function burstFlashAt(t: number): { scale: number; opacity: number } {
  const k = clamp01(t);
  return {
    scale: 0.35 + (BURST_SPREAD - 0.35) * easeOutCubic(k),
    // 前 30% 最亮（"炸开"那一瞬），之后一路淡
    opacity: k < 0.3 ? 0.88 : Math.max(0, 0.88 * (1 - Math.pow((k - 0.3) / 0.7, 1.35))),
  };
}

/** 地面冲击波：比主闪扩得更远、更薄、更慢一点 */
export function burstShockAt(t: number): { scale: number; opacity: number } {
  const k = clamp01(t);
  /*
    ★ 终值必须**大于**主闪的 `BURST_SPREAD`：冲击波要跑到光团外面去，
      两个一样大就分不出"这是一圈环"了。
    ★ 也不能大太多 —— 大过 1.3 倍就扩到隔壁格子上去，看着像"打歪了"。
  */
  const maxScale = BURST_SPREAD * 1.18;
  return {
    scale: 0.5 + (maxScale - 0.5) * easeOutCubic(k),
    // ★ 0.55 是试出来的：再高这圈金色在加色下会白掉，看着像"白色描边"
    opacity: 0.55 * (1 - Math.pow(k, 1.5)),
  };
}

/**
 * 一片碎片的轨迹（相对落点中心的偏移 + 透明度 + 缩放）。
 *
 * ★ 角度/距离走 `hash01(seq)`，不用 `Math.random()` ——
 *   渲染层虽然不影响校验和，但"同一场战斗在两家机器上长得不一样"
 *   会让截图对拍变成日常困扰（齐射排布那边同一个结论）。
 */
export function burstShardAt(
  t: number,
  seq: number,
): { dx: number; dz: number; y: number; opacity: number; scale: number } {
  const k = clamp01(t);
  const angle = hash01(seq * 2 + 1) * Math.PI * 2;
  const reach = (1.0 + hash01(seq * 5 + 7) * 1.3) * easeOutCubic(k);
  return {
    dx: Math.cos(angle) * reach,
    dz: Math.sin(angle) * reach,
    // 抛物线：出去先抬起来再落回去（正弦半波），看起来才像被炸飞的碎屑
    y: 0.32 + 0.85 * Math.sin(Math.PI * Math.min(1, k * 1.1)),
    opacity: Math.max(0, 1 - Math.pow(k, 1.2)),
    scale: 0.55 + 0.45 * (1 - k),
  };
}

/** 稳定的 0..1 伪随机（同一组输入永远同一结果） */
function hash01(n: number): number {
  let x = Math.imul(n | 0, 2654435761) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 2246822519) >>> 0;
  x ^= x >>> 13;
  x = Math.imul(x, 3266489917) >>> 0;
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

// ============================================================
//  贴图（canvas 现画，按样式缓存）
// ============================================================

const SCOPE_TEXTURE_SIZE = 512;
const BURST_TEXTURE_SIZE = 256;
const SHARD_TEXTURE_SIZE = 64;

const scopeTextures = new Map<string, Texture>();
const burstTextures = new Map<string, Texture>();
const shardTextures = new Map<string, Texture>();

/**
 * 狙击镜贴图。
 *
 * 构成（从外到内）：四个角括号 → 外圈细环 → 12 个刻度 → 四条带缺口的十字线 → 中心点。
 * 【为什么要留中心缺口？】
 * 因为格子中间站着棋子 —— 实心十字会被卡面挡住，看起来"瞄准没瞄上"。
 * 缺口留出来，四根线从卡面四周指向中心，"瞄着它"这个意思反而更清楚。
 */
function drawScopeCanvas(style: LockOnStyle): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = SCOPE_TEXTURE_SIZE;
  canvas.height = SCOPE_TEXTURE_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const c = SCOPE_TEXTURE_SIZE / 2;
  // 归一化半径：0.42 = 外圈；括号放到 0.475（画布边缘还留一点，避免硬切口）
  const R = SCOPE_TEXTURE_SIZE * 0.42;

  ctx.lineCap = 'round';

  // ① 内圈淡填充：让"这块地被罩住了"离老远也看得出来
  const fill = ctx.createRadialGradient(c, c, R * 0.1, c, c, R);
  fill.addColorStop(0, 'rgba(255, 130, 200, 0.04)');
  fill.addColorStop(0.72, 'rgba(255, 110, 190, 0.16)');
  fill.addColorStop(1, 'rgba(255, 90, 175, 0)');
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(c, c, R, 0, Math.PI * 2);
  ctx.fill();

  // ② 外圈细环 + 一圈柔光（加色下这层柔光就是"瞄准镜在发光"）
  ctx.shadowColor = 'rgba(255, 110, 190, 0.85)';
  ctx.shadowBlur = SCOPE_TEXTURE_SIZE * 0.05;
  ctx.strokeStyle = style.scope;
  ctx.lineWidth = SCOPE_TEXTURE_SIZE * 0.011;
  ctx.beginPath();
  ctx.arc(c, c, R, 0, Math.PI * 2);
  ctx.stroke();

  // ③ 12 个刻度：每 30°，长短交替（像瞄准镜的分划板）
  ctx.lineWidth = SCOPE_TEXTURE_SIZE * 0.008;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const long = i % 3 === 0;
    const r0 = R * (long ? 0.86 : 0.905);
    ctx.strokeStyle = long ? style.scopeHi : style.scope;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
    ctx.lineTo(c + Math.cos(a) * R * 0.985, c + Math.sin(a) * R * 0.985);
    ctx.stroke();
  }

  // ④ 四条十字线（中间留 18% 的缺口给棋子）
  ctx.strokeStyle = style.scope;
  ctx.lineWidth = SCOPE_TEXTURE_SIZE * 0.009;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4 * 0; // 0/90/180/270
    const r0 = R * 0.18;
    const r1 = R * 0.98;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
    ctx.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1);
    ctx.stroke();
  }

  // ⑤ 中心小点（缺口正中间那一下"准星"）
  ctx.shadowBlur = SCOPE_TEXTURE_SIZE * 0.03;
  ctx.fillStyle = style.scopeHi;
  ctx.beginPath();
  ctx.arc(c, c, SCOPE_TEXTURE_SIZE * 0.012, 0, Math.PI * 2);
  ctx.fill();

  // ⑥ 四角括号（狙击镜最标志性的那四段折线），放在外圈之外
  const outer = R * 1.12;
  const arm = R * 0.16;
  ctx.strokeStyle = style.scopeHi;
  ctx.lineWidth = SCOPE_TEXTURE_SIZE * 0.014;
  ctx.shadowColor = 'rgba(255, 150, 210, 0.9)';
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    const x = c + sx * outer;
    const y = c + sy * outer;
    ctx.beginPath();
    ctx.moveTo(x - sx * arm, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y - sy * arm);
    ctx.stroke();
  }
  return canvas;
}

/**
 * 爆炸贴图：白粉核心 → 玫粉主体 → 金色外缘（用户要的"粉色为主、金色渐变"）。
 *
 * ★★ 加色混合下**每一档的 alpha 都压得很保守**（核心也只有 0.9）：
 *   第一版核心写成不透明，两层爆炸一叠加直接把画面烧成一片纯白，
 *   粉色和金色全没了（`.fx-proposal` 的定格图里一眼就能看出来）。
 * ★ 另外补了一道**淡金色内环**（0.60 半径）：纯渐变看起来像"一团雾"，
 *   有一道环才有"炸开、有个壳"的结构。
 */
function drawBurstCanvas(style: LockOnStyle): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = BURST_TEXTURE_SIZE;
  canvas.height = BURST_TEXTURE_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const c = BURST_TEXTURE_SIZE / 2;
  const hex = (value: number): string => `#${value.toString(16).padStart(6, '0')}`;
  const grad = ctx.createRadialGradient(c, c, 0, c, c, c);
  grad.addColorStop(0, `${hex(style.burstCore)}cc`);
  grad.addColorStop(0.16, `${hex(style.burstPink)}cc`);
  grad.addColorStop(0.36, `${hex(style.burstPink)}88`);
  grad.addColorStop(0.55, `${hex(style.burstPink)}44`);
  // ★ 金色从 0.6 才开始出现：再往里就会把"粉色为主"冲淡成橙色
  grad.addColorStop(0.66, `${hex(style.burstGold)}99`);
  grad.addColorStop(0.84, `${hex(style.burstGold)}40`);
  grad.addColorStop(1, `${hex(style.burstGold)}00`);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(c, c, c, 0, Math.PI * 2);
  ctx.fill();

  // 淡金色内环：给光团一个"壳"，不然就是一团雾
  ctx.strokeStyle = `${hex(style.burstGold)}66`;
  ctx.lineWidth = BURST_TEXTURE_SIZE * 0.012;
  ctx.beginPath();
  ctx.arc(c, c, c * 0.6, 0, Math.PI * 2);
  ctx.stroke();
  return canvas;
}

/** 碎片贴图：一小条两头尖的光丝 */
function drawShardCanvas(style: LockOnStyle): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = SHARD_TEXTURE_SIZE;
  canvas.height = SHARD_TEXTURE_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const hex = (value: number): string => `#${value.toString(16).padStart(6, '0')}`;
  const grad = ctx.createLinearGradient(0, 0, canvas.width, 0);
  grad.addColorStop(0, `${hex(style.shard)}00`);
  grad.addColorStop(0.45, hex(style.shard));
  grad.addColorStop(0.72, hex(style.burstGold));
  grad.addColorStop(1, `${hex(style.burstGold)}00`);
  ctx.fillStyle = grad;
  // 一个两头尖的菱形，横着放（飞行方向就是它的长轴）
  const midY = canvas.height / 2;
  ctx.beginPath();
  ctx.moveTo(0, midY);
  ctx.quadraticCurveTo(canvas.width * 0.5, midY - canvas.height * 0.16, canvas.width, midY);
  ctx.quadraticCurveTo(canvas.width * 0.5, midY + canvas.height * 0.16, 0, midY);
  ctx.closePath();
  ctx.fill();
  return canvas;
}

function textureOf(
  cache: Map<string, Texture>,
  id: string,
  draw: (style: LockOnStyle) => HTMLCanvasElement,
): Texture {
  const cached = cache.get(id);
  if (cached) return cached;
  const texture = new CanvasTexture(draw(lockOnStyleOf(id)));
  // ★ 不写 colorSpace 会发灰（note-fx / unit-aura / heal-halo 都踩过）
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  cache.set(id, texture);
  return texture;
}

export function lockOnScopeTextureOf(id?: string | null): Texture {
  const key = isLockOnFx(id) ? (id as string) : LOCKON_SNIPER;
  return textureOf(scopeTextures, key, drawScopeCanvas);
}

export function lockOnBurstTextureOf(id?: string | null): Texture {
  const key = isLockOnFx(id) ? (id as string) : LOCKON_SNIPER;
  return textureOf(burstTextures, key, drawBurstCanvas);
}

export function lockOnShardTextureOf(id?: string | null): Texture {
  const key = isLockOnFx(id) ? (id as string) : LOCKON_SNIPER;
  return textureOf(shardTextures, key, drawShardCanvas);
}

// ============================================================
//  实例管理
// ============================================================

interface MarkInstance {
  group: Group;
  /** 会自转的那一层（瞄准镜慢慢转，读起来像"正在锁定"） */
  spinner: Group;
  reticle: { mesh: Mesh; geometry: PlaneGeometry; material: MeshBasicMaterial };
  rings: Array<{ mesh: Mesh; geometry: RingGeometry; material: MeshBasicMaterial }>;
  age: number;
  life: number;
  styleId: string;
}

interface BurstInstance {
  group: Group;
  /**
   * 主体：**普通混合**（不吃加色）。
   * ★ 为什么不用加色？加色下粉色会被叠成白色 —— 用户要的"粉色为主、金色渐变"
   *   只有在普通混合里才是它本来的颜色（和夕的黑墨拆双层同一个思路，见 MEMORY-特效 §7）。
   */
  flash: { sprite: Sprite; material: SpriteMaterial };
  /** 同一张图叠一层**加色**当辉光（让它在深色棋盘上发光，但不抢主体的颜色） */
  glow: { sprite: Sprite; material: SpriteMaterial };
  /** 贴地的金色冲击波 */
  shock: { mesh: Mesh; geometry: RingGeometry; material: MeshBasicMaterial };
  shards: Array<{ sprite: Sprite; material: SpriteMaterial; seq: number }>;
  age: number;
  styleId: string;
}

let root: Object3D | null = null;
const marks = new Map<string, MarkInstance>();
const bursts: BurstInstance[] = [];

/** 把特效挂到哪个根节点上（`replay.ts` 构造时调一次，和血镰/回血光环同一处） */
export function attachLockOnRoot(scene: Object3D): void {
  root = scene;
}

function disposeMark(key: string): void {
  const mark = marks.get(key);
  if (!mark) return;
  root?.remove(mark.group);
  mark.reticle.geometry.dispose();
  mark.reticle.material.dispose();
  for (const ring of mark.rings) {
    ring.geometry.dispose();
    ring.material.dispose();
  }
  marks.delete(key);
}

function disposeBurst(burst: BurstInstance): void {
  root?.remove(burst.group);
  burst.flash.material.dispose();
  burst.glow.material.dispose();
  burst.shock.geometry.dispose();
  burst.shock.material.dispose();
  for (const shard of burst.shards) shard.material.dispose();
}

/**
 * 在某个地块上放一圈狙击镜（并开始循环收缩光环）。幂等：同一格重复锁只刷新寿命。
 *
 * @param x,z     地块中心的世界坐标
 * @param fxId    样式 id（数据里 `lockOn.fx`）
 * @param seconds 这一圈要留多久（= 距离引爆还剩几秒，由内核算好递进来）
 */
export function spawnLockOnMark(x: number, z: number, fxId?: string | null, seconds = 7): void {
  if (!root) return;
  const key = `${x.toFixed(2)},${z.toFixed(2)}`;
  const styleId = isLockOnFx(fxId) ? (fxId as string) : LOCKON_SNIPER;
  const life = Math.max(0.3, Math.min(MARK_MAX_SECONDS, Number.isFinite(seconds) ? seconds : 7));

  const existing = marks.get(key);
  if (existing) {
    // 同一格被再锁一次（"目标不够时剩余弹药锁血最高的那个"会出现）：
    // 不新建，只把寿命顶上去 —— 否则两圈瞄准镜叠在一起会亮一倍。
    existing.life = life;
    existing.age = 0;
    return;
  }
  if (marks.size >= LOCKON_MAX_MARKS) {
    const oldest = marks.keys().next().value;
    if (oldest !== undefined) disposeMark(oldest);
  }

  const style = lockOnStyleOf(styleId);
  const group = new Group();
  group.position.set(x, 0.025, z);

  // ① 瞄准镜本体（贴地）
  const size = (MARK_RADIUS * 2) / (0.42 * 2); // 画布里外圈半径 = 0.42 半宽
  const geometry = new PlaneGeometry(size, size);
  const material = new MeshBasicMaterial({
    map: lockOnScopeTextureOf(styleId),
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    side: DoubleSide,
    depthWrite: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = RENDER_ORDER_FX;
  const spinner = new Group();
  spinner.add(mesh);
  group.add(spinner);

  // ② 两圈向内收缩的粉色光环（错开半个周期，看起来是"一波接一波往里收"）
  const ringList: Array<{ mesh: Mesh; geometry: RingGeometry; material: MeshBasicMaterial }> = [];
  for (let i = 0; i < 2; i++) {
    // ★ 环做**粗一点**（内 93%）：真机上 96.5% 那条细环和瞄准镜自身的外圈糊成一条，
    //   看不出"还有一圈在外面往里收"。
    const ringGeometry = new RingGeometry(MARK_RADIUS * 0.93, MARK_RADIUS, 64);
    const ringMaterial = new MeshBasicMaterial({
      color: i === 0 ? style.ring : style.ringInner,
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      side: DoubleSide,
      depthWrite: false,
    });
    const ringMesh = new Mesh(ringGeometry, ringMaterial);
    ringMesh.rotation.x = -Math.PI / 2;
    // 别和瞄准镜共面（会闪面）
    ringMesh.position.y = 0.004 + i * 0.003;
    ringMesh.renderOrder = RENDER_ORDER_FX;
    group.add(ringMesh);
    ringList.push({ mesh: ringMesh, geometry: ringGeometry, material: ringMaterial });
  }

  root.add(group);
  marks.set(key, {
    group,
    spinner,
    reticle: { mesh, geometry, material },
    rings: ringList,
    age: 0,
    life,
    styleId,
  });
}

/**
 * 引爆一个落点：粉色为主的爆闪 + 金色冲击波 + 一圈碎屑。
 *
 * @param radius 这个落点影响几格（数据里的 `lockOn.radius`，这里只用来定尺寸）
 */
export function spawnLockOnBurst(x: number, z: number, fxId?: string | null, radius = 1): void {
  if (!root) return;
  const styleId = isLockOnFx(fxId) ? (fxId as string) : LOCKON_SNIPER;
  const style = lockOnStyleOf(styleId);
  const scaleByRadius = 0.75 + 0.25 * Math.max(1, Math.min(3, Math.round(radius)));

  while (bursts.length >= LOCKON_MAX_BURSTS) {
    const oldest = bursts.shift();
    if (oldest) disposeBurst(oldest);
  }

  const group = new Group();
  group.position.set(x, 0, z);

  /*
    ① 主爆闪：立牌（Sprite 正对镜头）—— 贴地画会碾成扁椭圆。
    ★★ 两层同一张图：
      · `flash` 走**普通混合** ⇒ 粉色就是粉色、金边就是金边（加色会烧成白的）；
      · `glow` 走**加色**、压到 0.4 不透明度、再放大一圈 ⇒ 只负责"在深色棋盘上发光"。
    这才同时拿到"颜色对"和"亮得起来"。
  */
  const flashMaterial = new SpriteMaterial({
    map: lockOnBurstTextureOf(styleId),
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const flash = new Sprite(flashMaterial);
  flash.renderOrder = RENDER_ORDER_FX;
  // 抬到胸口高度：爆心在地面的话，"炸开"会有一半埋在地板下面
  flash.position.y = 0.5;
  group.add(flash);

  const glowMaterial = new SpriteMaterial({
    map: lockOnBurstTextureOf(styleId),
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const glow = new Sprite(glowMaterial);
  glow.renderOrder = RENDER_ORDER_FX - 1;
  glow.position.y = 0.5;
  group.add(glow);

  // ② 金色冲击波：贴地一圈，扩得比爆闪更远，把"落点范围"读出来
  const shockGeometry = new RingGeometry(MARK_RADIUS * 0.92, MARK_RADIUS, 64);
  const shockMaterial = new MeshBasicMaterial({
    color: style.shock,
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    side: DoubleSide,
    depthWrite: false,
  });
  const shockMesh = new Mesh(shockGeometry, shockMaterial);
  shockMesh.rotation.x = -Math.PI / 2;
  shockMesh.position.y = 0.03;
  shockMesh.renderOrder = RENDER_ORDER_FX;
  group.add(shockMesh);

  // ③ 碎屑
  const shards: BurstInstance['shards'] = [];
  for (let i = 0; i < BURST_SHARD_COUNT; i++) {
    const shardMaterial = new SpriteMaterial({
      map: lockOnShardTextureOf(styleId),
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const sprite = new Sprite(shardMaterial);
    sprite.renderOrder = RENDER_ORDER_FX;
    group.add(sprite);
    shards.push({ sprite, material: shardMaterial, seq: i });
  }

  root.add(group);
  bursts.push({
    group,
    flash: { sprite: flash, material: flashMaterial },
    glow: { sprite: glow, material: glowMaterial },
    shock: { mesh: shockMesh, geometry: shockGeometry, material: shockMaterial },
    shards,
    age: 0,
    styleId,
  });
  // ★ 半径只影响爆闪/冲击波的终值尺寸：记在 group 的 userData 上，避免再多一个实例字段
  group.userData.burstSpread = scaleByRadius;
}

/** 每帧推进（瞄准镜自转 + 收缩光环；爆闪/冲击波/碎屑各自走曲线） */
export function updateLockOnFx(deltaSeconds: number): void {
  for (const [key, mark] of [...marks]) {
    mark.age += deltaSeconds;
    mark.life -= deltaSeconds;
    if (mark.life <= 0) {
      disposeMark(key);
      continue;
    }
    const scale = markScaleAt(mark.age);
    mark.reticle.mesh.scale.setScalar(scale);
    mark.reticle.material.opacity = markOpacityAt(mark.age, mark.life);
    /*
      ★★ 瞄准镜**不转**。
      试过慢慢自转（0.55 弧度/秒）：十字线跟着转，看起来像雷达在扫，
      而不像"狙击镜瞄住了这块地"。而"正在锁定"这个意思已经由
      **向内收缩的粉色光环**表达了（用户要的就是那一圈）——
      再加自转反而把主体搅乱。`spinner` 这层留着，以后要加抖动/微摆有地方挂。
    */
    mark.spinner.rotation.y = 0;

    for (const [index, ring] of mark.rings.entries()) {
      // 两圈错开半个周期
      const phase = ((mark.age / CONVERGE_PERIOD + index * 0.5) % 1 + 1) % 1;
      const at = convergeRingAt(phase);
      ring.mesh.scale.setScalar(at.scale);
      ring.material.opacity = at.opacity * mark.reticle.material.opacity;
    }
  }

  for (let i = bursts.length - 1; i >= 0; i--) {
    const burst = bursts[i]!;
    burst.age += deltaSeconds;
    if (burst.age >= BURST_SECONDS) {
      disposeBurst(burst);
      bursts.splice(i, 1);
      continue;
    }
    const t = burst.age / BURST_SECONDS;
    const spread = Number(burst.group.userData.burstSpread ?? 1);
    const flash = burstFlashAt(t);
    const baseSize = MARK_RADIUS * 2 * flash.scale * spread;
    // 主体：普通混合，颜色是真的粉/金
    burst.flash.sprite.scale.setScalar(baseSize);
    burst.flash.material.opacity = flash.opacity;
    /*
      辉光：同一张图加色、**和主体一样大**、亮度压到四成左右。
      ★ 别放大（试过 1.22）：它的外缘会正好压在冲击波那一圈上，
        两笔加色叠起来就是一条**白边**，金色反而看不见了。
    */
    burst.glow.sprite.scale.setScalar(baseSize);
    burst.glow.material.opacity = flash.opacity * 0.38;
    // 爆闪出现的瞬间往下压一点点（"炸在前方"），收尾时抬回去
    burst.flash.sprite.position.y = 0.42 + 0.1 * (1 - t);
    burst.glow.sprite.position.y = burst.flash.sprite.position.y;

    const shock = burstShockAt(t);
    burst.shock.mesh.scale.setScalar(shock.scale * spread);
    burst.shock.material.opacity = shock.opacity;

    for (const shard of burst.shards) {
      const at = burstShardAt(t, shard.seq);
      shard.sprite.position.set(at.dx * spread, at.y, at.dz * spread);
      shard.sprite.scale.set(0.34 * at.scale, 0.16 * at.scale, 1);
      // 碎片的长轴朝向飞行方向（Sprite 只能绕视线轴转，所以用 rotation 近似）
      shard.material.rotation = Math.atan2(-at.dz, at.dx);
      shard.material.opacity = at.opacity;
    }
  }
}

/** 清掉所有瞄准镜与爆炸（重开一局 / 收尾） */
export function clearLockOnFx(): void {
  for (const key of [...marks.keys()]) disposeMark(key);
  for (const burst of bursts) disposeBurst(burst);
  bursts.length = 0;
}

/** 测试/调试用：现在场上有几圈瞄准镜、几团爆炸 */
export function lockOnLiveCount(): { marks: number; bursts: number } {
  return { marks: marks.size, bursts: bursts.length };
}

/** 瞄准镜的世界直径（格）—— 测试拿它对"别大过一格半" */
export function lockOnMarkDiameterCells(): number {
  return MARK_RADIUS * 2 / CELL;
}
