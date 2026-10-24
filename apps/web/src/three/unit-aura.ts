/**
 * ============================================================
 *  ★ 0.1.3：角色身上的**金色光华**
 * ============================================================
 *
 * 【它是什么？】
 * 贴在棋子小人表面的一层金色流光，两种用途：
 *   · `invincible` —— **无敌**期间（技能 / 藏品给的无敌）
 *   · `rebirth`    —— **重生过渡**（倒地等复活的那两三秒，由暗到亮地"蓄力"）
 *
 * 【怎么看得出"在流转"？】
 * 棋子是 2D 精灵（不是 3D 模型），所以"表面流转"只能用**序列帧**做 ——
 * 这也正是这个项目里小人的做法（`chibi/` 下每个动作一套横向序列帧）。
 * 这里生成 16 帧：每帧的光带角度差 1/16 圈，循环播放起来就是"光华绕着一圈圈转"。
 *
 * 【为什么贴图是共享的？】
 * 所有棋子的这套光效**长得一模一样**，按 (kind, frame) 缓存一份就够 ——
 * 一个单位只占一个 Sprite + 一个"现在第几帧"的计数，
 * 战场上几十个单位同时无敌也不会多出几十张 canvas。
 *
 * 【为什么用加色混合（AdditiveBlending）？】
 * 因为目标是"**在模型表面**发光"：加色叠加会把小人本来的颜色提亮、
 * 而不是盖上一块半透明的金纸（后者看起来像贴了张纸片）。
 */
import {
  AdditiveBlending,
  CanvasTexture,
  LinearFilter,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
} from 'three';
// ★ 层级从 card-layout 取（唯一来源）—— 见 createAuraSprite 的说明
import { RENDER_ORDER_CHIBI } from './card-layout.js';
// ★ "一格多大"从 grid 取（唯一来源）
import { CELL } from '../game/grid.js';

/** 序列帧张数（16 帧一圈，配合下面的帧时长 = 0.8 秒转一圈） */
export const AURA_FRAME_COUNT = 16;
/** 每帧停留多久（秒）—— 0.05 × 16 = 0.8 秒一圈，看起来是"缓缓流转"而不是闪 */
export const AURA_FRAME_SECONDS = 0.05;
/** 无敌时的最高不透明度（再高小人本身就看不清了） */
export const AURA_INVINCIBLE_OPACITY = 0.62;
/** 重生过渡最亮那一瞬的不透明度（比无敌更"炸"，因为它要报"我活过来了"） */
export const AURA_REBIRTH_OPACITY = 0.95;
/** 重生过渡的起始强度（倒地刚开始时只有这么亮，然后一路爬到满） */
export const AURA_REBIRTH_MIN_RATIO = 0.3;
/**
 * ★ 光效相对**一格**的尺寸比例（用户口径："比竞技场一个格子大一点点"）。
 *
 * 【为什么按格子算，而不是按小人算？】
 * 小人多大取决于干员的模型缩放，各不相同；而"一格"是棋盘上恒定的尺子
 * （`CELL = 1.0` 世界单位）。按格子算，光效在每枚棋子上都是同一个大小、
 * 也就是"永远不会比格子大太多"—— 这正是要的手感。
 * 按小人算的话，模型偏大的干员（Boss、巨像）会得到一个更大的光斑。
 */
export const AURA_SCALE_OVER_CELL = 1.05;

export type AuraKind = 'invincible' | 'rebirth';

/** 贴图画布尺寸（和小人同一竖长比，方便直接叠上去） */
const AURA_W = 128;
const AURA_H = 160;

/**
 * ★ 光效在世界里的尺寸（**比一格大一点点**，宽高比跟着贴图走）。
 *
 * 这个函数是"光效该多大"的**唯一出处** —— 免得有人又在别处写死一个数
 * （第一版把贴图像素 128×160 当世界单位，光效比整个竞技场还大）。
 */
export function auraWorldSize(): { w: number; h: number } {
  const h = CELL * AURA_SCALE_OVER_CELL;
  return { w: h * (AURA_W / AURA_H), h };
}

const textureCache = new Map<string, CanvasTexture>();

/**
 * 画第 `frame` 帧的金色光华。
 *
 * 三层叠出来：
 *   ① 一层柔和的整体金光（负责"表面泛着金色"）
 *   ② 三条绕着中心转的亮带（每帧角度差 1/16 圈 —— 这就是"流转"）
 *   ③ 一个椭圆遮罩（把光收在"人形"范围内，否则看起来是一块方块在发光）
 */
function drawAuraFrame(kind: AuraKind, frame: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = AURA_W;
  canvas.height = AURA_H;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, AURA_W, AURA_H);

  const cx = AURA_W / 2;
  const cy = AURA_H * 0.52;
  const rx = AURA_W * 0.47;
  const ry = AURA_H * 0.47;

  // ① 整体金光（重生那套更暖一点，像"血重新烧起来了"）
  /*
    ★ 颜色要**饱和的金**，不能偏白。
    加色混合（AdditiveBlending）天然往白走：光源越亮越白，
    所以这里刻意压低亮度成分、把色相钉在暖金上（第一版用了接近白的 255,250,232，
    叠上去整片发灰，看起来像"蒙了层雾"而不是"金色光华"）。
  */
  const warm = kind === 'rebirth';
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry));
  glow.addColorStop(0, warm ? 'rgba(255, 200, 70, 0.62)' : 'rgba(255, 208, 88, 0.46)');
  glow.addColorStop(0.55, 'rgba(255, 170, 36, 0.30)');
  glow.addColorStop(1, 'rgba(255, 150, 20, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, AURA_W, AURA_H);

  // ② 三条流转的亮带
  const baseAngle = (frame / AURA_FRAME_COUNT) * Math.PI * 2;
  ctx.save();
  ctx.translate(cx, cy);
  for (let i = 0; i < 3; i++) {
    ctx.save();
    ctx.rotate(baseAngle + (i * Math.PI * 2) / 3);
    const band = ctx.createLinearGradient(0, -ry * 0.95, 0, ry * 0.95);
    band.addColorStop(0, 'rgba(255, 214, 96, 0)');
    band.addColorStop(0.5, 'rgba(255, 236, 150, 0.66)');
    band.addColorStop(1, 'rgba(255, 214, 96, 0)');
    ctx.fillStyle = band;
    const bw = AURA_W * 0.09;
    ctx.fillRect(-bw / 2, -ry * 0.95, bw, ry * 1.9);
    ctx.restore();
  }
  ctx.restore();

  // ③ 椭圆遮罩（收成人形，边角不留方块感）
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.translate(cx, cy);
  ctx.scale(rx, ry);
  const mask = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  mask.addColorStop(0, 'rgba(0,0,0,1)');
  mask.addColorStop(0.78, 'rgba(0,0,0,0.92)');
  mask.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = mask;
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();

  return canvas;
}

/** 取一帧贴图（按 kind + frame 缓存，全局共享） */
export function auraTextureOf(kind: AuraKind, frame: number): CanvasTexture {
  const f = ((frame % AURA_FRAME_COUNT) + AURA_FRAME_COUNT) % AURA_FRAME_COUNT;
  const key = `${kind}:${f}`;
  const cached = textureCache.get(key);
  if (cached) return cached;

  const texture = new CanvasTexture(drawAuraFrame(kind, f));
  texture.colorSpace = SRGBColorSpace; // ★ 见 getUnitTexture 的说明（否则颜色被冲淡）
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  textureCache.set(key, texture);
  return texture;
}

/**
 * 造一个光环精灵。
 *
 * ★★ 它是**小人的兄弟节点**（挂在同一张卡片下），不是独立放进场景的：
 *   · 位置 / 尺寸 / 跟随全部由"小人多大"决定 —— 见 replay 的 updateUnitAura；
 *   · 所以这里**不设 scale**（默认 1，调用方会按小人的局部缩放覆盖）。
 *
 * 【别在这里按像素设 scale】第一版写的是 `AURA_W * 1.15` = 147×184，
 * 而卡片的世界尺寸只有 0.72×0.96 —— 于是光效比整个竞技场还大（用户报的就是这条）。
 * 精灵的 scale 是**世界单位**，不是贴图像素。
 */
export function createAuraSprite(): Sprite {
  const material = new SpriteMaterial({
    map: auraTextureOf('invincible', 0),
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    opacity: 0,
  });
  const sprite = new Sprite(material);
  sprite.visible = false;
  sprite.center.set(0.5, 0.5);
  /*
    层级：压在小人之上、血条之下。
    用 **小数** 而不是挤进整数档 —— `RENDER_ORDER_CHIBI + 0.5` 天然落在
    "小人(1) 和 血条(2)"中间，以后谁调那两档都不用动这里。
  */
  sprite.renderOrder = RENDER_ORDER_CHIBI + 0.5;
  return sprite;
}

/** 这个精灵现在是什么状态（给探针 / 测试看，别让它变成一个看不见的黑盒） */
export function auraStateOf(sprite: Sprite): {
  kind: AuraKind | null;
  frame: number;
  opacity: number;
} {
  const data = sprite.userData as { aura?: { kind: AuraKind | null; frame: number; elapsed: number } };
  return {
    kind: data.aura?.kind ?? null,
    // ★ 返回的是**帧号**（不是 elapsed 秒数）—— 测试和探针都用它判断"转没转"
    frame: data.aura?.frame ?? 0,
    opacity: sprite.material.opacity,
  };
}

/**
 * 每帧更新一次光环。
 *
 * @param kind      要显示哪一种（null = 收起来）
 * @param intensity 0~1 的整体强度（无敌恒为 1；重生过渡由倒地进度决定，从暗到亮）
 * @param deltaSeconds 距上一帧的秒数
 */
export function updateAuraSprite(
  sprite: Sprite,
  kind: AuraKind | null,
  intensity: number,
  deltaSeconds: number,
): void {
  const data = sprite.userData as { aura?: { kind: AuraKind | null; frame: number; elapsed: number } };
  if (!kind || intensity <= 0) {
    if (sprite.visible) sprite.visible = false;
    if (data.aura && data.aura.kind !== null) data.aura.kind = null;
    return;
  }

  const max = kind === 'rebirth' ? AURA_REBIRTH_OPACITY : AURA_INVINCIBLE_OPACITY;

  if (!data.aura) data.aura = { kind, frame: -1, elapsed: 0 };
  // 换了种类就从第 0 帧重新转（不然"无敌变重生"会从半圈接上，看着像卡了一下）
  if (data.aura.kind !== kind) {
    data.aura.kind = kind;
    data.aura.elapsed = 0;
  }
  data.aura.elapsed += deltaSeconds;

  const frame = Math.floor(data.aura.elapsed / AURA_FRAME_SECONDS) % AURA_FRAME_COUNT;
  if (frame !== data.aura.frame) {
    data.aura.frame = frame;
    sprite.material.map = auraTextureOf(kind, frame);
    sprite.material.needsUpdate = true;
  }
  /*
    重生过渡额外加一层**呼吸**：0.8 秒一圈的轻微起伏 ——
    不加的话"由暗到亮"是一条直线，看起来像渐变而不是"在转"。
  */
  const pulse = kind === 'rebirth' ? 0.85 + 0.15 * Math.sin(data.aura.elapsed * Math.PI * 1.6) : 1;
  sprite.material.opacity = Math.max(0, Math.min(1, max * intensity * pulse));
  sprite.visible = true;
}
