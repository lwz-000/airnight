/**
 * ============================================================
 *  ★★ 0.2.1：回血光环（夜莺 绿色 / 魔王 粉色）
 * ============================================================
 *
 * 【用户口径（2026-10-18）】
 *   · 夜莺：「回血光环的特效，绿色光环，同时有绿色 +++ 的飘动效果」；
 *   · 魔王：「粉色回血光环和夜莺类似，还可以加上 🗡+ 的特效来表示加攻击力，
 *           3 星技能加的免死效果可以让光环在开启技能时更加闪亮」。
 *
 * 【它挂在哪条事件上？】
 * 挂在**治疗事件**（`heal`）上：谁治了人，就在谁脚下刷新一圈。
 *   · 夜莺 / 魔王 的回血都是**被动脉冲**（每 1 秒一跳），一跳治好几个人
 *     ⇒ 每跳都刷新 ⇒ 看着是"一直亮着"；
 *   · 魔王 3 星「不灭王权」把回血换成 `healOverTime` ⇒ 同样每秒一跳、一样刷新。
 * ★ 为什么不挂在 `zone` 事件（脉冲的范围事件）上？
 *   因为 3 星的持续治疗发的是**半径 0** 的框（它压根不是范围治疗），
 *   照那个半径画出来就是脚下一小圈 —— 用户要的"光环"直接没了。
 *   挂 `heal` 事件就没有这个问题，而且"有治疗才有光环"本身就是最准的语义。
 * ★ 判据只看数据里的 `UnitDef.healHaloFx`（和 `healFx` / `combatFx` 同一族），
 *   渲染层不认干员编号。
 *
 * 【为什么是"刷新"而不是"生成一次性特效"】
 * 脉冲每 1 秒左右报一次，而一次光环要亮 `HEAL_HALO_SECONDS`（比间隔略长）。
 * 两者首尾相接 ⇒ 看起来是"一直有一圈光环在"，脉冲一停（人死了/技能结束）就自然收掉。
 * 这和血镰环绕（`leto-scythe-fx.ts` 的 aura）是同一套生命周期做法。
 *
 * 【三层分别是什么】
 *   ① 底环（`base`）—— 贴着地面的一圈发光圆环，亮度呼吸；
 *   ② 波环（`wave`）—— 每次脉冲从内往外扩一圈，扩到边上就淡掉（"又奶了一口"的节拍）；
 *   ③ 符号（`symbol`）—— 绿色 `+++` / 粉色 `🗡+`，从环里往上飘、边飘边淡。
 * ★ 符号是 **canvas 画的字**（和音符 🎶 同一套做法），不是图片素材：
 *   `+` 和 `🗡` 都是现成字形，画布一画就有透明边，不占仓库体积。
 *
 * 【免死要更闪（魔王的 3 星）】
 * 施法者身上有 `cannotDie` 时，这一圈整体提亮 + 波环多扩一圈 + 符号多撒两个
 * （见 `HEAL_HALO_BOOST_*`）。判据由 `replay.ts` 从实时效果里查出来递进来，
 * 这个模块自己不认识"技能"这回事。
 */

import {
  AdditiveBlending,
  CanvasTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  type Object3D,
  type Texture,
} from 'three';
import { zoneWorldRadius } from '../game/grid.js';
import { RENDER_ORDER_FX } from './card-layout.js';

/** 绿色回血光环（夜莺） */
export const HEAL_HALO_GREEN = 'heal_halo_green';
/** 粉色回血光环（魔王）+ 攻击力符号 */
export const HEAL_HALO_PINK = 'heal_halo_pink';

/**
 * 一圈光环活多久（秒）。
 * ★ 必须**比脉冲间隔长**：内核的被动脉冲是每 1 秒一跳，
 *   取 1.4 秒 ⇒ 下一次刷新总是先到，画面不会一明一暗地闪。
 */
export const HEAL_HALO_SECONDS = 1.4;

/** 同屏最多几圈（正常一局最多两三个人有，8 是硬上限） */
export const HEAL_HALO_MAX = 8;

/**
 * 光环的世界半径（格半径）。
 *
 * 【为什么是个常量，不跟着治疗范围走？】
 * 这一圈是**氛围光**，不是"范围指示器" —— 准确的范围由棋盘上的白框负责
 * （`emitZone` 画的那个）。要是让光环去背这个职责，就会出现"魔王 3 星的
 * 治疗根本不看距离（全体每秒回血），光环却只圈住 5×5"的错位。
 * 2 格 = 5×5 的范围，正好和两人常态的脉冲半径一致。
 */
export const HEAL_HALO_RADIUS = 2;

/** 一次刷新撒几个符号 */
export const HEAL_HALO_SYMBOL_COUNT = 3;
/** 免死状态（更闪）时撒几个 */
export const HEAL_HALO_SYMBOL_BOOST_COUNT = 6;
/** 一个符号飘多久 */
export const HEAL_HALO_SYMBOL_SECONDS = 0.95;
/** 符号往上飘多少格 */
export const HEAL_HALO_SYMBOL_RISE = 1.05;
/** 符号世界里多大（一边） */
export const HEAL_HALO_SYMBOL_SIZE = 0.5;
/** 两次"撒一批符号"之间至少隔多久（秒）—— 一次群疗治好几个人也只撒一批 */
export const HEAL_HALO_SYMBOL_GAP = 0.3;
/** 符号同屏上限（防"两个人一起奶 + 免死"时 sprite 堆太多） */
export const HEAL_HALO_MAX_SYMBOLS = 40;
/** 免死提亮倍率 —— 1.5 就是"明显更亮"，再多在深色棋盘上会糊成一片白 */
export const HEAL_HALO_BOOST_GLOW = 1.5;

/** 底环 / 波环的亮度上限（防光污染，和血镰的 `LETO_CAP` 同一套规矩） */
export const HEAL_HALO_CAP = { base: 0.5, wave: 0.62 } as const;

/** 一套配色 + 要飘的字 */
interface HealHaloStyle {
  /** 底环颜色（加色混合） */
  ring: number;
  /** 波环颜色（比底环浅一档，扩出去才分得清两层） */
  wave: number;
  /** 符号颜色（canvas 文字填充色） */
  glyph: string;
  /** 符号上画什么 */
  text: string;
}

/**
 * 注册表：数据里写的 id → 配色。
 * ★ **键集合就是"合法 id 集合"**：新增一种光环 = 这里加一行 + 数据里写这个 id。
 */
const HALO_STYLES: Record<string, HealHaloStyle> = {
  [HEAL_HALO_GREEN]: {
    ring: 0x3dff9e,
    wave: 0xa6ffd2,
    glyph: '#8dffc2',
    text: '+++',
  },
  [HEAL_HALO_PINK]: {
    // 偏亮的玫粉：深粉在深红半场里会糊掉
    ring: 0xff6ec7,
    wave: 0xffc0e6,
    glyph: '#ffa8dc',
    text: '🗡+',
  },
};

/** 全部合法光环 id（注册表一致性测试用它扫数据） */
export const HEAL_HALO_FX: readonly string[] = Object.keys(HALO_STYLES);

/** 这个 id 是不是回血光环 —— 渲染层唯一的判据 */
export function isHealHaloFx(id: string | undefined | null): boolean {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(HALO_STYLES, id);
}

/** 取配色；不认识的 id 按绿色走（绝不返回 undefined，否则后面取色会炸） */
export function healHaloStyleOf(id?: string | null): HealHaloStyle {
  return (id && HALO_STYLES[id]) || HALO_STYLES[HEAL_HALO_GREEN]!;
}

// ============================================================
//  曲线（纯函数：测试直接断言"会不会缩成 0 / 会不会飘到天外"）
// ============================================================

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/** 底环的世界半径（格）—— 和范围白框同一个公式（唯一实现 `game/grid.ts`） */
export function haloWorldRadius(radius: number): number {
  return zoneWorldRadius(radius);
}

/**
 * 底环：整圈一直在，亮度做一次"呼吸"（开→略暗→稳住）。
 * ★ 不透明度永远 > 0.25：一圈半透明光环比"忽明忽暗"稳，玩家不会以为特效卡了。
 */
export function haloBaseOpacityAt(t: number, boost = false): number {
  const k = clamp01(t);
  const breathe = 0.72 + 0.28 * Math.sin(Math.PI * Math.min(1, k * 1.6));
  const cap = HEAL_HALO_CAP.base * (boost ? HEAL_HALO_BOOST_GLOW : 1);
  return Math.min(1, cap * breathe);
}

/**
 * 波环：每次脉冲从 0.45R 扩到 1R，扩出去 62% 的行程里淡完。
 * @returns scale（相对 R）与 opacity
 */
export function haloWaveAt(t: number, boost = false): { scale: number; opacity: number } {
  const k = clamp01(t);
  const travel = Math.min(1, k / 0.62);
  const scale = 0.45 + 0.55 * travel;
  const fade = Math.max(0, 1 - travel);
  const cap = HEAL_HALO_CAP.wave * (boost ? HEAL_HALO_BOOST_GLOW : 1);
  return { scale, opacity: Math.min(1, cap * fade) };
}

/**
 * 「更闪」时那圈**外缘火花**的不透明度（免死窗口里才亮）。
 *
 * 为什么单靠"把亮度乘 1.5"不够？
 * 因为底环本来就封顶在 0.5，乘 1.5 之后上限被 1 夹住，肉眼几乎看不出差别
 * （对比过两张定格图：几乎一样）。所以额外加一圈**贴着外缘、快速闪动**的细环：
 * 亮度不变、**节奏**变了 —— 眼睛最先注意到的就是"它在闪"。
 *
 * @param t    0..1（相对光环寿命）
 * @param boost 施法者身上有没有免死
 */
export function haloSparkAt(t: number, boost: boolean): number {
  if (!boost) return 0;
  const k = clamp01(t);
  /*
    ★ 一秒闪两下（寿命 1.4 秒 ⇒ 两整轮），和脉冲的 1 秒节拍错开，
      才不会看起来像"同一个东西在闪"。
    ★ 取 `|sin|` 而不是 `sin`：负半周会把整圈按到 0，看起来像"光环灭了又亮"；
      取绝对值就是"亮 → 更亮 → 亮"，一直在，只是一直在跳。
  */
  return 0.45 + 0.45 * Math.abs(Math.sin(k * Math.PI * 4));
}

/**
 * 符号：从环内往上飘 `HEAL_HALO_SYMBOL_RISE` 格，边飘边淡。
 * @returns y（离地高度）与 opacity、scale
 */
export function haloSymbolAt(t: number): { y: number; opacity: number; scale: number } {
  const k = clamp01(t);
  // 先快后慢地升（线性升看起来像"电梯"）
  const rise = 1 - Math.pow(1 - k, 1.7);
  const fadeIn = Math.min(1, k / 0.18);
  const opacity = fadeIn * Math.max(0, 1 - Math.pow(k, 1.7));
  return {
    y: 0.28 + HEAL_HALO_SYMBOL_RISE * rise,
    opacity,
    // 边飘边略放大，读起来像"浮起来的气泡"
    scale: 0.85 + 0.3 * rise,
  };
}

// ============================================================
//  符号贴图（canvas 画字，全局按配色各一张）
// ============================================================

const SYMBOL_TEXTURE_SIZE = 160;

/**
 * emoji 的字体栈。
 * ★ 真机只有 Edge（Windows），`Segoe UI Emoji` 一定有 —— 🗡 就是它画的。
 *   后面几个是给 macOS / Linux 兜底（找不到时只会画成"豆腐块"，不会崩）。
 */
const GLYPH_FONT_STACK =
  '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif';

const symbolTextures = new Map<string, Texture>();

function drawSymbolCanvas(style: HealHaloStyle): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = SYMBOL_TEXTURE_SIZE;
  canvas.height = SYMBOL_TEXTURE_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const center = SYMBOL_TEXTURE_SIZE / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.round(SYMBOL_TEXTURE_SIZE * 0.62)}px ${GLYPH_FONT_STACK}`;
  /*
    ★ 描边辉光：棋盘是深色，纯色字在远处只剩一个点。
      和音符（`note-fx.ts`）同一个做法 —— 光靠 fillStyle 提亮，不靠加色混合
      （加色会把 `🗡` 这种彩色字形洗成一片白）。
  */
  ctx.shadowColor = style.glyph;
  ctx.shadowBlur = SYMBOL_TEXTURE_SIZE * 0.12;
  ctx.fillStyle = style.glyph;
  ctx.fillText(style.text, center, center);
  ctx.fillText(style.text, center, center);
  return canvas;
}

/** 取（或第一次生成）某个配色的符号贴图 */
export function haloSymbolTextureOf(id?: string | null): Texture {
  const key = isHealHaloFx(id) ? id! : HEAL_HALO_GREEN;
  const cached = symbolTextures.get(key);
  if (cached) return cached;
  const texture = new CanvasTexture(drawSymbolCanvas(healHaloStyleOf(key)));
  // ★ 不写 colorSpace 会发灰（note-fx / unit-aura 都踩过）
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  symbolTextures.set(key, texture);
  return texture;
}

// ============================================================
//  实例管理
// ============================================================

interface HaloInstance {
  group: Group;
  base: { mesh: Mesh; geometry: RingGeometry; material: MeshBasicMaterial; radius: number };
  wave: { mesh: Mesh; geometry: RingGeometry; material: MeshBasicMaterial };
  /** 免死时贴着外缘快速闪动的那一圈（平时完全透明） */
  spark: { mesh: Mesh; geometry: RingGeometry; material: MeshBasicMaterial };
  age: number;
  life: number;
  boost: boolean;
  styleId: string;
  /** 半径变了（升星/换射程）才重建几何 */
  radius: number;
  /** 这次刷新还欠几个符号没撒 */
  pendingSymbols: number;
  symbolTimer: number;
  /** 距离上次"撒一批符号"还有多久（同一轮群疗只撒一批） */
  symbolCooldown: number;
}

interface SymbolInstance {
  sprite: Sprite;
  material: SpriteMaterial;
  age: number;
  life: number;
  baseX: number;
  baseZ: number;
}

let root: Object3D | null = null;
const halos = new Map<string, HaloInstance>();
const symbols: SymbolInstance[] = [];

/** 把特效挂到哪个根节点上（`replay.ts` 初始化时调一次，和血镰同一个位置） */
export function attachHealHaloRoot(scene: Object3D): void {
  root = scene;
}

/** 环几何：内 88% 外 100%，这样是一圈"有厚度"的环而不是圆盘 */
function ringGeometry(radius: number, innerRatio: number): RingGeometry {
  return new RingGeometry(radius * innerRatio, radius, 64);
}

function disposeHalo(key: string): void {
  const halo = halos.get(key);
  if (!halo) return;
  root?.remove(halo.group);
  halo.base.geometry.dispose();
  halo.base.material.dispose();
  halo.wave.geometry.dispose();
  halo.wave.material.dispose();
  halo.spark.geometry.dispose();
  halo.spark.material.dispose();
  halos.delete(key);
}

/**
 * 刷新（或新建）一圈回血光环。
 *
 * @param key    施法者的稳定标识（用 unitId 的字符串）—— 同一个人只留一圈
 * @param x,z    施法者位置
 * @param fxId   配色 id（数据里写的那个：`UnitDef.healHaloFx`）
 * @param boost  是否"更闪"（施法者身上有免死）
 * @param radius 世界半径（格）；不传就用 `HEAL_HALO_RADIUS`
 *
 * ★ 为什么"刷新"要在同一次脉冲里被调好几次也不炸（一次脉冲治好几个人）？
 *   刷新本身是幂等的（延长寿命 / 跟位置 / 跟 boost），
 *   只有**撒符号**带 0.3 秒冷却 —— 否则一次群疗会喷出九、十个 `+`，像放烟花。
 */
export function spawnHealHalo(
  key: string,
  x: number,
  z: number,
  fxId?: string | null,
  boost = false,
  radius: number = HEAL_HALO_RADIUS,
): void {
  if (!root) return;
  // 不认识的 id 按绿色走（和 `healHaloStyleOf` 同一个兜底口径）
  const styleId = isHealHaloFx(fxId) ? (fxId as string) : HEAL_HALO_GREEN;

  const existing = halos.get(key);
  if (existing) {
    existing.life = HEAL_HALO_SECONDS;
    existing.age = 0;
    existing.group.position.set(x, 0, z);
    existing.boost = boost;
    if (existing.symbolCooldown <= 0) {
      existing.symbolCooldown = HEAL_HALO_SYMBOL_GAP;
      // 这次刷新再撒一批符号（节拍感就来自这里）
      existing.pendingSymbols += boost ? HEAL_HALO_SYMBOL_BOOST_COUNT : HEAL_HALO_SYMBOL_COUNT;
      existing.symbolTimer = 0;
    }
    return;
  }

  if (halos.size >= HEAL_HALO_MAX) {
    const oldest = halos.keys().next().value;
    if (oldest !== undefined) disposeHalo(oldest);
  }

  const style = healHaloStyleOf(styleId);
  const R = haloWorldRadius(radius);
  const group = new Group();
  group.position.set(x, 0, z);

  // ① 底环：贴地一圈，加色混合（这是"光"，不是实体）
  const baseGeometry = ringGeometry(R, 0.9);
  const baseMaterial = new MeshBasicMaterial({
    color: style.ring,
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    side: DoubleSide,
    depthWrite: false,
  });
  const baseMesh = new Mesh(baseGeometry, baseMaterial);
  baseMesh.rotation.x = -Math.PI / 2;
  // ★ 抬一点点，别和范围白框（ZONE_Y = 0.02）打架闪面
  baseMesh.position.y = 0.03;
  baseMesh.renderOrder = RENDER_ORDER_FX;
  group.add(baseMesh);

  // ② 波环：比底环细（内 94%），从内往外扩
  const waveGeometry = ringGeometry(R, 0.95);
  const waveMaterial = new MeshBasicMaterial({
    color: style.wave,
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    side: DoubleSide,
    depthWrite: false,
  });
  const waveMesh = new Mesh(waveGeometry, waveMaterial);
  waveMesh.rotation.x = -Math.PI / 2;
  waveMesh.position.y = 0.035;
  waveMesh.renderOrder = RENDER_ORDER_FX;
  group.add(waveMesh);

  // ③ 外缘火花：免死窗口里才亮（平时 opacity 恒为 0，不花一分钱）
  const sparkGeometry = ringGeometry(R, 0.975);
  const sparkMaterial = new MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    side: DoubleSide,
    depthWrite: false,
  });
  const sparkMesh = new Mesh(sparkGeometry, sparkMaterial);
  sparkMesh.rotation.x = -Math.PI / 2;
  sparkMesh.position.y = 0.04;
  sparkMesh.renderOrder = RENDER_ORDER_FX;
  group.add(sparkMesh);

  const instance: HaloInstance = {
    group,
    base: { mesh: baseMesh, geometry: baseGeometry, material: baseMaterial, radius: R },
    wave: { mesh: waveMesh, geometry: waveGeometry, material: waveMaterial },
    spark: { mesh: sparkMesh, geometry: sparkGeometry, material: sparkMaterial },
    age: 0,
    life: HEAL_HALO_SECONDS,
    boost,
    styleId,
    radius: R,
    pendingSymbols: boost ? HEAL_HALO_SYMBOL_BOOST_COUNT : HEAL_HALO_SYMBOL_COUNT,
    symbolTimer: 0,
    symbolCooldown: HEAL_HALO_SYMBOL_GAP,
  };
  root.add(group);
  halos.set(key, instance);
}

/** 撒一个符号（落在环内偏外的一圈上，角度/半径走确定性的黄金角序列） */
function spawnSymbol(halo: HaloInstance, x: number, z: number): void {
  // 超上限先把最老的挤掉（"两个人一起奶 + 免死"时才可能撞到）
  while (symbols.length >= HEAL_HALO_MAX_SYMBOLS) {
    const oldest = symbols.shift();
    if (oldest) {
      root?.remove(oldest.sprite);
      oldest.material.dispose();
    }
  }
  const material = new SpriteMaterial({
    map: haloSymbolTextureOf(halo.styleId),
    transparent: true,
    opacity: 0,
    // ★ 普通混合：`🗡` 是彩色字形，加色会洗白（音符那边同一个结论）
    depthWrite: false,
  });
  const sprite = new Sprite(material);
  sprite.scale.setScalar(HEAL_HALO_SYMBOL_SIZE);
  sprite.renderOrder = RENDER_ORDER_FX;
  sprite.position.set(x, 0.28, z);
  root?.add(sprite);
  symbols.push({ sprite, material, age: 0, life: HEAL_HALO_SYMBOL_SECONDS, baseX: x, baseZ: z });
}

/**
 * 符号落点的"伪随机"。
 *
 * ★ 为什么不用 `Math.random()`？
 *   渲染层虽然是纯表现（不影响校验和），但**同一场战斗在两家机器上长得不一样**
 *   会让"截图对不上"变成日常困扰。黄金角序列既散得开、又完全可复现。
 */
function symbolSpot(seq: number, radius: number): { angle: number; distance: number } {
  return {
    angle: seq * 2.399963229728653,
    distance: radius * (0.28 + 0.42 * ((seq * 0.37) % 1)),
  };
}
let symbolSeq = 0;

/** 每帧推进（所有光环 + 所有符号） */
export function updateHealHaloFx(deltaSeconds: number): void {
  for (const [key, halo] of [...halos]) {
    halo.age += deltaSeconds;
    halo.life -= deltaSeconds;
    halo.symbolCooldown = Math.max(0, halo.symbolCooldown - deltaSeconds);
    if (halo.life <= 0) {
      disposeHalo(key);
      continue;
    }
    const t = halo.age / HEAL_HALO_SECONDS;
    const boost = halo.boost;
    halo.base.material.opacity = haloBaseOpacityAt(t, boost);
    const wave = haloWaveAt(t, boost);
    halo.wave.material.opacity = wave.opacity;
    // 波环的几何半径就是 R，缩放 0.45 → 1.0 就是"从里扩到边上"
    halo.wave.mesh.scale.setScalar(wave.scale);
    // 外缘火花只在免死窗口里闪
    halo.spark.material.opacity = haloSparkAt(t, boost);

    /*
      符号按"这一批撒几个、每隔一小会儿撒一个"排队放出来 ——
      一次性全冒出来像"喷泉"，错开才像"一口一口奶"。
    */
    if (halo.pendingSymbols > 0) {
      halo.symbolTimer -= deltaSeconds;
      if (halo.symbolTimer <= 0) {
        halo.symbolTimer = 0.11;
        halo.pendingSymbols -= 1;
        const spot = symbolSpot(symbolSeq++, halo.radius);
        spawnSymbol(
          halo,
          halo.group.position.x + Math.cos(spot.angle) * spot.distance,
          halo.group.position.z + Math.sin(spot.angle) * spot.distance,
        );
      }
    }
  }

  for (let i = symbols.length - 1; i >= 0; i--) {
    const symbol = symbols[i]!;
    symbol.age += deltaSeconds;
    if (symbol.age >= symbol.life) {
      root?.remove(symbol.sprite);
      symbol.material.dispose();
      symbols.splice(i, 1);
      continue;
    }
    const t = symbol.age / symbol.life;
    const at = haloSymbolAt(t);
    symbol.sprite.position.set(symbol.baseX, at.y, symbol.baseZ);
    symbol.sprite.scale.setScalar(HEAL_HALO_SYMBOL_SIZE * at.scale);
    symbol.material.opacity = at.opacity;
  }
}

/** 清掉所有光环与符号（重开一局 / 战斗结束收尾） */
export function clearHealHaloFx(): void {
  for (const key of [...halos.keys()]) disposeHalo(key);
  for (const symbol of symbols) {
    root?.remove(symbol.sprite);
    symbol.material.dispose();
  }
  symbols.length = 0;
}

/** 测试/调试用：现在有几圈光环、几个符号 */
export function healHaloLiveCount(): { halos: number; symbols: number } {
  return { halos: halos.size, symbols: symbols.length };
}
