/**
 * ============================================================
 *  ★ 0.2：丰川祥子的「音符」弹道（🎶）
 * ============================================================
 *
 * 【它是什么？】
 * 祥子的普攻不是挥砍，而是**朝目标飞出一个音符**：
 *   · 1/2 星：一个音符沿直线穿 3 格，最多命中 3 人（穿透）；
 *   · 3 星「残月的余响」：改成两发（一个物理、一个法术），碰到人就消失。
 *
 * 【为什么直接用 🎶 这个表情？】
 * 用户口径原话："祥子音符特效贴图直接用「🎶」这个表情包可以实现吗？"
 * —— 可以，而且它比"自己画一个音符"更划算：
 *   · 音符这个形状（八分音符 + 一条符杠）用几何拼出来很麻烦，
 *     而系统字体里现成就有，颜色也是现成的（方舟原作的音符也是这个配色）；
 *   · 它是**文字**，所以走 canvas 的 `fillText` 就能得到一张带透明底的贴图，
 *     和 `unit-aura.ts` / `slash-fx.ts` 是同一套做法（CanvasTexture），
 *     不需要额外引入图片素材，也不占仓库体积。
 *
 * ★ 唯一的坑：**加色混合会把表情冲淡**。
 *   别处（光环 / 月牙）都走 `AdditiveBlending`，那是因为它们是"发光的能量"；
 *   emoji 本身就是**彩色实体**，加法混合会把它洗成一片浅粉。
 *   所以这里用**普通透明混合**（`NormalBlending`）+ `depthWrite:false`。
 *
 * 【为什么是"贴图 + Sprite"，不是贴地平面？】
 * 音符是**飞在空中**的，脚下那一层贴地特效（攻击弧 / 范围框）都在地面上，
 * 两者一眼就能分开；Sprite 永远面朝相机，斜视角下始终能看清形状。
 *
 * 【时长】
 * 攻击特效 0.13~0.30 秒、弹道线 0.16 秒。音符要"看得见它飞过去"，
 * 所以取 **0.34 秒**：比弹道线长一点（那是瞬时的光），但仍在同一量级，
 * 不会出现"人都打完两轮了，音符还在天上飘"。
 */

import {
  CanvasTexture,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  type Texture,
} from 'three';
import { RENDER_ORDER_FX } from './card-layout.js';

/** 用的就是这个表情（改这一行就能换风格，测试也断言它） */
export const NOTE_EMOJI = '🎶';

/**
 * ============================================================
 *  ★★ 0.2.1：音符的**配色变体**（数据里写字符串，渲染层查表）
 * ============================================================
 *
 * 【为什么不是只有一种颜色】
 * 用户口径：「八幡海铃使用紫色音符特效（祥子特效改一下颜色）」
 * —— 也就是"同一套音符，换一层色"。所以形状、飞法、时长一个字都不改，
 * 只把**光晕底盘 + 描边辉光**换成另一套颜色。
 *
 * ★ 为什么不改 emoji 本身的颜色？
 *   `🎶` 是彩色字形，`fillText` 画出来就是它自带的配色（深紫 + 深红），
 *   要染只能整张图 tint（`filter: hue-rotate` / 全局调色），那会把它洗成一块。
 *   而"换光晕色"在深色棋盘上恰恰是最有效的识别手段（远看就是一团紫光/一团金光）。
 */
export const NOTE_FX_GOLD = 'note';
export const NOTE_FX_PURPLE = 'note_purple';

/** 一套配色：径向光晕的三段渐变 + 描边辉光 */
interface NoteStyle {
  core: string;
  mid: string;
  edge: string;
  /** `shadowColor`（描边辉光，也是"实心感"的来源） */
  shadow: string;
}

/**
 * 配色表 —— **"这个 id 是不是音符"的唯一判据**（键集合即音符合法 id 集合）。
 * ★ 新增一种配色 = 这里加一行 + 数据里写这个 id，渲染层别处不用动。
 */
const NOTE_STYLES: Record<string, NoteStyle> = {
  [NOTE_FX_GOLD]: {
    core: 'rgba(255, 232, 160, 0.55)',
    mid: 'rgba(255, 205, 96, 0.24)',
    edge: 'rgba(255, 190, 70, 0)',
    shadow: 'rgba(255, 224, 138, 0.95)',
  },
  [NOTE_FX_PURPLE]: {
    // 淡紫偏冷一档：棋盘底色是深蓝/深红，纯紫会糊进去，所以往亮紫上偏
    core: 'rgba(216, 168, 255, 0.58)',
    mid: 'rgba(176, 108, 255, 0.26)',
    edge: 'rgba(148, 78, 255, 0)',
    shadow: 'rgba(210, 152, 255, 0.95)',
  },
};

/** 全部合法音符 id（注册表一致性测试用它扫数据；渲染层判"是不是音符"用 `isNoteFx`） */
export const NOTE_FX_IDS: readonly string[] = Object.keys(NOTE_STYLES);

/** 这个 id 是不是音符（含配色变体）—— 渲染层判"要不要走音符通道"只认它 */
export function isNoteFx(id: string | undefined | null): boolean {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(NOTE_STYLES, id);
}

/** 取配色；不认识的 id 按金色（老行为）走，绝不返回 undefined */
export function noteStyleOf(id?: string | null): NoteStyle {
  return (id && NOTE_STYLES[id]) || NOTE_STYLES[NOTE_FX_GOLD]!;
}

/** 一个音符从出手飞到命中要多久（秒） */
export const NOTE_FX_SECONDS = 0.34;

/**
 * 贴图边长（px）。
 * ★ 192 而不是 128：屏幕上音符有 40~70 px，而且斜视角会压扁它，
 *   128 在真机截图里能看出锯齿（`.fx-proposal/note-three.png`）。
 *   一张图全局共享，多这点显存无所谓。
 */
const NOTE_TEXTURE_SIZE = 192;

/**
 * 世界里音符的边长（一格 = 1 世界单位）。
 *
 * 【调参史，别再走回头路】
 *   · 0.52 —— 第一版，斜视角下只有几个像素，远看像棋盘上的一粒灰；
 *   · 0.78 —— 加了金色光晕之后能看清了，但**用户觉得太大**（2026-10-17）；
 *   · 0.234（= 0.78 × 0.3）—— 用户口径「祥子的特效变小至 30%」，现行值。
 * ★ 光晕已经解决了"看不见"的问题，所以缩小不会退回"一粒灰"。
 */
export const NOTE_FX_WORLD_SIZE = 0.234;

/**
 * 场上最多同时存在几个音符。
 *
 * 3 星祥子一次攻击就是两发、攻速还能翻倍，满编对轰时一秒能冒出十几个；
 * 超了就丢**最老的**（丢老的不会被看出来，丢新的会表现为"最后一下没打出去"）。
 * 24 足够覆盖"两个祥子同时在打"，也不会把 sprite 数量堆到影响帧率。
 */
export const MAX_LIVE_NOTE_FX = 24;

/**
 * 起飞高度与弧顶高度（世界单位）。
 *
 * 0.55 ≈ 棋子腰部；弧顶再抬 0.45，让它明显"飞过去"而不是"贴着地面滑"。
 * （弹道线在 `TRACER_Y = 0.5`，两者在同一档高度，视觉上不会打架。）
 */
const NOTE_START_HEIGHT = 0.55;
const NOTE_ARC_LIFT = 0.45;

/**
 * emoji 的字体栈。
 *
 * ★ 真机只有 Edge（Windows），`Segoe UI Emoji` 一定有；
 *   后面两个是给 macOS / Linux 兜底的 —— 一个都找不到时，
 *   canvas 会画出"豆腐块"，所以 `noteTextureOf()` 里还留了一次降级检测。
 */
const EMOJI_FONT_STACK =
  '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif';

/** 所有音符共用贴图 —— **按配色各一张**（几十个音符也只有两三张图） */
const textureCache = new Map<string, Texture>();

/**
 * 把 🎶 画进一张透明底 canvas。
 *
 * 【为什么不用 `new Image()` 加载 emoji？】emoji 不是图片文件，没有 URL 可加载。
 *
 * @param style 光晕/描边配色（见 `NOTE_STYLES`）
 */
function drawNoteCanvas(style: NoteStyle): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = NOTE_TEXTURE_SIZE;
  canvas.height = NOTE_TEXTURE_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const center = NOTE_TEXTURE_SIZE / 2;

  /*
    ★★ 先铺一层**辉光底盘**。
    为什么需要：🎶 在 Segoe UI Emoji 里是**深紫 + 深红**，直接画在深色棋盘上
    基本看不见（真机截图 `.fx-proposal/note-three.png` 就是这样，远看像一粒灰）。
    这一层只是"托亮"，不改 emoji 本身的形状和颜色 —— 观感上是"音符在发光"。
  */
  const glow = ctx.createRadialGradient(center, center, 0, center, center, center);
  glow.addColorStop(0, style.core);
  glow.addColorStop(0.45, style.mid);
  glow.addColorStop(1, style.edge);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, NOTE_TEXTURE_SIZE, NOTE_TEXTURE_SIZE);

  // 居中对齐 —— 不同字体的 emoji 字面高度差别很大，靠 metrics 现算
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // 字号取边长的 74%：emoji 通常自带内边距，再大就会顶到边缘被裁
  const fontSize = Math.round(NOTE_TEXTURE_SIZE * 0.78);
  ctx.font = `${fontSize}px ${EMOJI_FONT_STACK}`;

  /*
    ★ 提亮：emoji 是"深色实体"，光加 shadow 还是暗。
    `filter` 只在支持它的浏览器上生效（Edge / Chrome 都支持），
    不支持的会原样画 —— 那样也不报错，只是暗一点。
  */
  if (typeof ctx.filter === 'string') ctx.filter = 'brightness(1.55) saturate(1.3)';

  // 描边发亮：让音符的轮廓在光晕底盘上有"实体感"，不是一团雾
  ctx.shadowColor = style.shadow;
  ctx.shadowBlur = NOTE_TEXTURE_SIZE * 0.13;
  ctx.fillText(NOTE_EMOJI, center, center + fontSize * 0.04);
  // 第二遍（shadow 会叠加一次辉光，边缘更"亮"一点）
  ctx.shadowBlur = NOTE_TEXTURE_SIZE * 0.07;
  ctx.fillText(NOTE_EMOJI, center, center + fontSize * 0.04);

  if (typeof ctx.filter === 'string') ctx.filter = 'none';
  return canvas;
}

/**
 * 取（或第一次生成）某个配色的音符贴图。
 * @param id 数据里写的 id（`'note'` / `'note_purple'`…）；不认识就走金色
 */
export function noteTextureOf(id?: string | null): Texture {
  const key = isNoteFx(id) ? id! : NOTE_FX_GOLD;
  const cached = textureCache.get(key);
  if (cached) return cached;
  const texture = new CanvasTexture(drawNoteCanvas(noteStyleOf(key)));
  // ★ 不写 colorSpace，emoji 的颜色会被冲淡（unit-aura.ts 踩过同一个坑）
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  textureCache.set(key, texture);
  return texture;
}

/**
 * 造一个音符 Sprite。
 *
 * ★ 尺寸走 `scale.setScalar`，**不能是负数**（Sprite 负缩放会直接翻面消失）。
 * @param id 配色 id（数据里写的那一个），不传 = 金色
 */
export function createNoteSprite(id?: string | null): Sprite {
  const material = new SpriteMaterial({
    map: noteTextureOf(id),
    transparent: true,
    // ★ 普通混合，不是 AdditiveBlending —— 理由见文件头
    depthWrite: false,
  });
  const sprite = new Sprite(material);
  sprite.scale.setScalar(NOTE_FX_WORLD_SIZE);
  sprite.renderOrder = RENDER_ORDER_FX;
  return sprite;
}

/**
 * 飞行轨迹：起点 → 终点，中间抬一个拱。
 *
 * @param t 0 = 刚出手，1 = 命中
 * @returns 世界坐标（y 已经算上拱高）
 *
 * ★ 抽成纯函数（不碰 three），所以可以直接在测试里断言
 *   "中点一定比两端高""终点一定落在目标身上"。
 */
export function notePathAt(
  from: { x: number; z: number },
  to: { x: number; z: number },
  t: number,
): { x: number; y: number; z: number } {
  const k = Math.min(1, Math.max(0, t));
  return {
    x: from.x + (to.x - from.x) * k,
    // sin(0..π) 的正拱：起终点都是 0，中点抬到最高
    y: NOTE_START_HEIGHT + Math.sin(Math.PI * k) * NOTE_ARC_LIFT,
    z: from.z + (to.z - from.z) * k,
  };
}

/**
 * 透明度曲线。
 *
 * 出手就满不透明会显得"凭空出现"，所以前 12% 淡入；
 * 最后 30% 淡出（命中那一帧正好消失，和"音符碰到敌人则消失"对得上）。
 */
export function noteOpacityAt(t: number): number {
  const k = Math.min(1, Math.max(0, t));
  if (k < 0.12) return k / 0.12;
  if (k > 0.7) return Math.max(0, (1 - k) / 0.3);
  return 1;
}

/**
 * 缩放曲线：先"弹"一下（出手有力），再微微放大飞到终点。
 * ★ 永远 > 0（Sprite 不能拿到 0/负数缩放，会闪没）。
 */
export function noteScaleAt(t: number): number {
  const k = Math.min(1, Math.max(0, t));
  const pop = k < 0.18 ? 0.55 + (k / 0.18) * 0.45 : 1;
  return pop * (1 + k * 0.18);
}
