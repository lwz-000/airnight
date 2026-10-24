/**
 * ============================================================
 *  ★★ 0.2.1：普攻「弹道」贴图特效（澄闪的闪电 / 新约能天使的子弹）
 * ============================================================
 *
 * 【它替掉了什么】
 * 原来远程普攻只有一根白色细线（`replay.ts` 的 `spawnTracer`），信息量只有"从 A 到 B"。
 * 现在按干员数据换成本模块里的两套：
 *   · `bolt_pink`    —— 会抖的**粉色闪电**（澄闪）：粉为主 + 浅蓝电流芯 + 少量白
 *   · `bullet_angel` —— **飞过去的子弹**（新约能天使）：暖金弹头 + 拖尾，按距离定速度
 *
 * 【两种 kind 的区别】
 *   · `bolt`   —— **整条线**一次性铺满（闪电本来就是"瞬间到达"），0.22s 内每 70ms 重抖一次；
 *   · `bullet` —— **弹头从起点飞到终点**，拖尾跟着拉长；飞行时长按距离算（速度固定），
 *                 所以远一点打得久一点、近一点一闪就到，符合"子弹"的直觉。
 *
 * 【为什么"每发现画一张贴图"（只有 bolt 需要）】
 * 闪电的折角是**随机**的，拉一张固定图会被拉长变形。所以按"当前距离"现画一张小 canvas
 * （64 px/格，4 格也才 256×96）。子弹的拖尾是固定图，不用每发现画。
 *
 * 【朝向：为什么需要相机】
 * 弹道是世界坐标里的一条线，但贴图是平面的 —— 必须让这张平面**正对镜头**、
 * 并且它的 X 轴**沿着弹道**，否则从 45° 俯视看过去会变成一条细缝。
 * 相机由 `main.ts` 通过 `replay.setCamera()` 递进来（渲染层不认识相机）。
 *
 * ★ 纯表现层：只读 `attack` / `attackLink` 事件里的 `fx`，不进校验和。
 * ★ 数据说了算：`UnitDef.tracerFx` 写哪个 id 就播哪个，渲染层不认 op 编号。
 *
 * ★★ 0.2.1 追加：这里的弹道**不只给普攻用**。羁绊级「全场扫射」
 *   （拉特兰齐射，见 `board-volley-fx.ts`）也是拿本模块的 `bullet_laterano`
 *   一颗一颗打出去的 —— 那边只负责"排什么时候打、往哪打"，画法和生命周期全在这里。
 */
import {
  AdditiveBlending,
  CanvasTexture,
  DoubleSide,
  LinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Texture,
  Vector3,
  type Camera,
} from 'three';
import { CELL } from '../game/grid.js';
import { getLoadedImage, loadImage } from './assets.js';
import { RENDER_ORDER_FX } from './card-layout.js';

/** 弹道形态：整条线（闪电） / 飞行的弹头（子弹） / 抛物线飞行的炮弹 / 平滑的法术流光 */
export type TracerKind = 'bolt' | 'bullet' | 'shell' | 'flow';

export interface BoltTracerStyle {
  kind: TracerKind;
  /** 主色（闪电的粉 / 子弹的金） */
  main: string;
  /** 亮色（电芯 / 弹头） */
  bright: string;
  /** 外层辉光（闪电最外面那一圈"闪"的颜色） */
  outer: string;
  /** 点缀色：闪电的电流芯 / 小块高光（粉色是浅蓝，黄色是橙） */
  accent: string;
  /** 白 */
  white: string;
  /** 一个"格"画多少画布像素（越大越清晰、越吃内存） */
  pxPerCell: number;
  /** 弹道高度（格）—— 和棋子卡面中线齐平 */
  heightCells: number;

  // ---- 只有 bolt（闪电）用 ----
  /** 主体线宽（画布像素，按 pxPerCell 缩放） */
  corePx: number;
  /** 外圈辉光宽度（画布像素） */
  glowPx: number;
  /** 抖动幅度（画布像素，**不随长度变化**） */
  amplitudePx: number;
  /** 分叉条数范围 [最少, 最多] */
  forks: [number, number];
  /** 每隔多久重新抖一次（秒） */
  flickerSeconds: number;

  // ---- 只有 bullet（子弹）用 ----
  /** 飞行速度（格/秒）—— 用它算飞行时长，所以远近都"合理" */
  speedCellsPerSecond: number;
  /** 拖尾最长几格 */
  trailCells: number;
  /**
   * ★ 0.2.1：弹头那团白热的**半径系数**（不写 = 1）。
   *
   * 【为什么需要？】`paintBullet` 里弹头半径是"画布高度 × 0.42"，
   * 因为普通子弹的贴图很短（0.8 格拖尾），弹头占大头才读得出"一颗弹"。
   * 但**全场扫射**那种"拖尾 1.1 格、一次 100 颗"的弹丸，同样比例的弹头会变成
   * 一颗颗白胖的"药丸"，连起来就糊成一条。写 0.6~0.7 让它变成"细长的一道"。
   * 这是纯外观系数，默认 1 时所有既有弹道**一个像素都不变**。
   */
  headScale?: number;

  // ---- 只有 shell（炮弹）用 ----
  /**
   * 序列帧贴图（相对 `apps/web/public/assets/`）。
   * ★ 炮弹的弹头/拖尾是美术画的图（`cannon_shell_<色>`），不再用 canvas 现画。
   */
  image?: string;
  /** 这张图一共几帧（横向排） */
  frames?: number;
  /** 每秒播几帧 */
  fps?: number;
  /** 贴图占几格（= 单帧宽 / 256；规格书的换算基准） */
  cells?: number;
  /** 抛物线顶点高度（格） */
  arcCells?: number;

  /** 单发最长时长（秒）：bolt 直接用；bullet / shell 当上限 */
  seconds: number;

  // ---- 只有 flow（法术流光）用 ----
  /**
   * ★★ 中间留多宽的"暗河"（画布像素）。
   *
   * 【为什么需要它？】用户口径：阿米娅的流光是**黑色为主、红色点缀**。
   * 可加色混合下"纯黑 = 什么都没加" ⇒ 把中心**空着不画**，
   * 让棋盘自己的暗色透出来，两侧各描一条暗红/白的边：
   * 眼睛读到的是"一条黑色的带子，边上在发红光"。
   * 写 0 = 实心（白/绿那几种就用实心）。
   */
  coreSplit?: number;
  /** 沿流光跑动的点缀颗数（阿米娅的红点、拉普兰德的灰点） */
  dots?: number;
}

/**
 * ★★ 0.2.1（用户口径）：**梅那套子弹的"颜色版本"**。
 *
 * 形状参数**完全照抄** `bullet_angel`（同速度、同拖尾、同高度），只有颜色不同 ——
 * 用户要的是"一套弹道、十一种配色"，不是十一种不同的弹道。
 * 加 `coreSplit` 的那些是**暗芯弹**（紫黑 / 赤黑 / 纯黑）：中间不画、只描边 + 空心弹头。
 */
function bulletVariant(
  main: string,
  bright: string,
  outer: string,
  accent: string,
  white: string,
  extra: Partial<BoltTracerStyle> = {},
): BoltTracerStyle {
  return {
    kind: 'bullet',
    main,
    bright,
    outer,
    accent,
    white,
    pxPerCell: 64,
    heightCells: 0.46,
    corePx: 0,
    glowPx: 0,
    amplitudePx: 0,
    forks: [0, 0],
    flickerSeconds: 1,
    speedCellsPerSecond: 22,
    trailCells: 0.8,
    seconds: 0.3,
    ...extra,
  };
}

/** ★ 注册表：数据里写的 `tracerFx` → 一套画法 */
export const TRACER_FX: Record<string, BoltTracerStyle> = {
  bolt_pink: {
    kind: 'bolt',
    main: '#ff56b4',
    bright: '#ff9ad4',
    outer: '#c44eff',
    accent: '#96e1ff',
    white: '#fff3fb',
    pxPerCell: 64,
    heightCells: 0.62,
    corePx: 1.8,
    glowPx: 8.4,
    amplitudePx: 5.5,
    forks: [1, 2],
    flickerSeconds: 0.07,
    speedCellsPerSecond: 0,
    trailCells: 0,
    seconds: 0.22,
  },
  /**
   * 惊蛰的闪电（用户口径："用澄闪那套，但颜色变成黄色、橙色点缀"）。
   * 结构和 `bolt_pink` 完全一样，只是换了四个颜色：
   * 主体黄 `#ffe23a`、电芯浅黄 `#fff6b0`、外层橙光 `#ff7a18`、点缀橙 `#ff9a2e`。
   */
  bolt_yellow: {
    kind: 'bolt',
    main: '#ffcc00',
    bright: '#ffd633',
    outer: '#ff5a00',
    accent: '#ff7a00',
    white: '#fff6cf',
    pxPerCell: 64,
    heightCells: 0.62,
    corePx: 1.8,
    glowPx: 11,
    amplitudePx: 5.5,
    forks: [1, 2],
    flickerSeconds: 0.07,
    speedCellsPerSecond: 0,
    trailCells: 0,
    seconds: 0.22,
  },
  /**
   * 新约能天使的子弹（用户口径："子弹飞过的特效"）。
   * 暖金弹头 + 短拖尾；速度 22 格/秒 ⇒ 4 格约 0.18 秒，和原来那根白线（0.16 秒）同量级。
   */
  bullet_angel: {
    kind: 'bullet',
    main: '#ff8b19',
    bright: '#fff3c4',
    outer: '#ff6a10',
    accent: '#ffd35b',
    white: '#fffaf0',
    pxPerCell: 64,
    heightCells: 0.46,
    corePx: 0,
    glowPx: 0,
    amplitudePx: 0,
    forks: [0, 0],
    flickerSeconds: 1,
    speedCellsPerSecond: 22,
    trailCells: 0.8,
    seconds: 0.3,
  },
  /*
    ★★ 0.2.1（用户口径）：**梅的子弹 + 十一种配色**（形状照抄 bullet_angel，只换颜色）。
    暗芯三种（塑心紫黑 / 伊内丝赤黑 / 望纯黑）走 `coreSplit`：
    加色下纯黑看不见，只能"中间空着 + 描边 + 空心弹头"，让棋盘透出来当黑芯。
  */
  bullet_red: bulletVariant('#ff3b2f', '#ffc2b4', '#8f120a', '#ff7a5a', '#fff2ec'), // 熔泉
  bullet_purple: bulletVariant('#a24bff', '#e8d2ff', '#4a118f', '#c98bff', '#f8f2ff'), // 芙蓉
  bullet_yellow: bulletVariant('#ffe13a', '#fffbc8', '#c9a400', '#fff07a', '#fffef0'), // 洛洛
  bullet_brown: bulletVariant('#b07a3c', '#efd2a4', '#4f2f10', '#cf9a55', '#f7ead6'), // 截云
  bullet_void: bulletVariant('#2a1636', '#b06bff', '#120a1c', '#7a3fd0', '#e6d3ff', { coreSplit: 2.6 }), // 塑心（紫黑）
  bullet_pink: bulletVariant('#ff6ec7', '#ffd6ee', '#a3126f', '#ff9ad9', '#fff2f9'), // 妮芙
  bullet_blood: bulletVariant('#3a0708', '#ff5a4a', '#1a0304', '#c02018', '#ffd8d0', { coreSplit: 2.6 }), // 伊内丝（赤黑）
  bullet_shadow: bulletVariant('#1a1d24', '#c2cad6', '#0a0c10', '#6e7888', '#eef2f8', { coreSplit: 2.6 }), // 望（纯黑）
  bullet_orange: bulletVariant('#ff8a1e', '#ffe0ad', '#a33a00', '#ffb455', '#fff4e2'), // 予愿安洁莉娜
  bullet_green: bulletVariant('#35e07f', '#c8ffdd', '#0b5c2c', '#7dffae', '#f0fff6'), // 凯尔希·思衡托
  bullet_gold: bulletVariant('#ffb81f', '#ffedb8', '#a35f00', '#ffcf5c', '#fffaf0'), // 可露希尔
  /*
    ★★ 0.2.1 追加：**拉特兰齐射**的弹丸（羁绊级"全场扫射"，见 `board-volley-fx.ts`）。

    和白金配色的区别不在颜色，在**三个速度参数** —— 它不是"一次打一发"，
    而是要横穿整个棋盘（13 格）：
      · `speedCellsPerSecond` 22 → **11**：22 格/秒横穿 13 格只要 0.6 秒，
        一整面弹幕墙会"唰一下全过去"，看不到扫射的过程；
      · `trailCells` 0.8 → **0.55**：上百颗 0.8 格的长拖尾会连成一条实心光带；
      · `seconds` 0.3 → **1.45**：这是 `bullet` 的**飞行时长上限**，
        13 格 / 11 格每秒 ≈ 1.2 秒，写小了会在半路被判"到期"回收。
    配色是"白金弹体 + 冷蓝外晕"（拉特兰的圣光衬托），不是普通的暖金 ——
    深色棋盘上需要一点冷色边，否则白金那截和木色的地板贴在一起读不出来。
  */
  bullet_laterano: bulletVariant('#ffd168', '#ffdf8e', '#6ea8ff', '#ffb02a', '#fff6dc', {
    speedCellsPerSecond: 11,
    /*
      ★ 拖尾 0.55 → **1.1**（真机截图后调）：0.55 格在游戏相机下只有 20 px，
      弹头那团白光就占了 2/3 ⇒ 看起来像"一颗灰白小飞镖"，而不是提案稿里那种
      "一条拉长的白金流光"。1.1 格后整颗约 1.4 格长，和提案稿的观感一致。
      ★ 高度 0.46 → 0.42：拖尾变长之后要**变细**，否则 100 颗同时在场会连成一片。
      ★ `white` 用暖白 `#fff6dc`（不是纯白）：加色混合下纯白会把弹体洗成灰色，
        暖白才读得出"金"。
    */
    trailCells: 1.1,
    seconds: 1.45,
    heightCells: 0.42,
    headScale: 0.62,
  }),
  /*
    ★★ 0.2.1 炮手（`cannon` 羁绊）的普攻炮弹：**抛物线飞过去**。
    图是 `特效图/cannon_shell_<色>` 那三套（8 帧 @30fps，256px = 1 格）。
    · 速度 9 格/秒 —— 3~4 格约 0.35~0.45 秒，比子弹慢（炮弹要有"飞过去"的过程）；
    · 顶点 2.6 格（和效果图上的标注同一个数）；
    · 弹头在画布正中、拖尾朝 -X ⇒ 整张 Sprite 按**屏幕速度方向**旋转。
    ★ 颜色跟着数据走（空爆/灰毫 = 灰，号角 = 黄，菲亚梅塔/维什戴尔 = 红）。
  */
  shell_yellow: {
    kind: 'shell',
    main: '#ffb02a',
    bright: '#ffe5a0',
    outer: '#ff8a1e',
    accent: '#ffd35b',
    white: '#fff6cf',
    pxPerCell: 64,
    heightCells: 0.55,
    corePx: 0,
    glowPx: 0,
    amplitudePx: 0,
    forks: [0, 0],
    flickerSeconds: 1,
    speedCellsPerSecond: 9,
    trailCells: 0,
    image: 'fx/cannon_shell_yellow.png',
    frames: 8,
    fps: 30,
    cells: 1,
    arcCells: 2.6,
    seconds: 0.7,
  },
  shell_red: {
    kind: 'shell',
    main: '#ef2a18',
    bright: '#ffb08a',
    outer: '#ff4a24',
    accent: '#ff7a4a',
    white: '#fff0e0',
    pxPerCell: 64,
    heightCells: 0.55,
    corePx: 0,
    glowPx: 0,
    amplitudePx: 0,
    forks: [0, 0],
    flickerSeconds: 1,
    speedCellsPerSecond: 9,
    trailCells: 0,
    image: 'fx/cannon_shell_red.png',
    frames: 8,
    fps: 30,
    cells: 1,
    arcCells: 2.6,
    seconds: 0.7,
  },
  shell_gray: {
    kind: 'shell',
    main: '#a9b6c8',
    bright: '#e8eef8',
    outer: '#8898b0',
    accent: '#cfd8e6',
    white: '#f6f9ff',
    pxPerCell: 64,
    heightCells: 0.55,
    corePx: 0,
    glowPx: 0,
    amplitudePx: 0,
    forks: [0, 0],
    flickerSeconds: 1,
    speedCellsPerSecond: 9,
    trailCells: 0,
    image: 'fx/cannon_shell_gray.png',
    frames: 8,
    fps: 30,
    cells: 1,
    arcCells: 2.6,
    seconds: 0.7,
  },

  /*
    ★★ 0.2.1 法术「流光」三种配色（用户口径）
      · flow_arts_dark  —— 阿米娅：**黑色为主 + 红色点缀**
      · flow_arts_light —— 拉普兰德：同一套的**白色为主 + 灰色点缀**（"变色版"）
      · stream_heal     —— 古米 / 芙蓉：**绿色**治疗流光（朝被治疗的那个队友飞）

    【为什么是"整条线"而不是飞行的弹头】
    法术伤害是"术式直接作用在目标身上"，没有实体弹丸；一条铺满 A→B 的流光
    正好表达"能量流过去"。而且它是**瞬间到达**的（`tracerFlightSeconds` 返回 0），
    所以命中特效立刻跟上，不会出现"火花先炸、光束还在路上"。

    【黑色怎么画出来的】
    见 `coreSplit`：中间不画、只描两侧的红边 —— 加色混合下这是唯一能读成"黑"的办法
    （`MEMORY-细节 §4`：加色下纯黑 = 完全看不见，维什戴尔那包的血泪）。
  */
  flow_arts_dark: {
    kind: 'flow',
    main: '#7d1218',      // 暗红：加色下它才是"黑"的轮廓
    bright: '#ff3a2a',    // 红色点缀 / 走马灯
    outer: '#3a0a10',     // 最外那层极暗的红（让黑带子有厚度）
    accent: '#ff8a6a',
    white: '#ffd6c6',
    pxPerCell: 64,
    heightCells: 0.62,
    corePx: 4.2,
    glowPx: 13,
    amplitudePx: 3.2,
    forks: [0, 0],
    flickerSeconds: 0.06,
    speedCellsPerSecond: 0,
    trailCells: 0,
    coreSplit: 2.6,
    dots: 5,
    seconds: 0.30,
  },
  flow_arts_light: {
    kind: 'flow',
    main: '#eef4ff',      // 白：实心芯（白色在加色下天生就亮，不需要留黑）
    bright: '#ffffff',
    outer: '#8f9bab',     // 灰色点缀 / 外圈
    accent: '#b9c2cf',
    white: '#ffffff',
    pxPerCell: 64,
    heightCells: 0.60,
    corePx: 3.6,
    glowPx: 12,
    amplitudePx: 3.0,
    forks: [0, 0],
    flickerSeconds: 0.06,
    speedCellsPerSecond: 0,
    trailCells: 0,
    coreSplit: 0,
    dots: 5,
    seconds: 0.30,
  },
  stream_heal: {
    kind: 'flow',
    main: '#3ce07a',      // 绿：治疗的口径色
    bright: '#6dffa6',    // ★ 亮芯也得是饱和绿（原来 #c8ffd8 太接近白 ⇒ 整条读成白棒）
    outer: '#0f6b36',
    accent: '#8bffb4',
    white: '#f2fff6',
    pxPerCell: 64,
    heightCells: 0.58,
    corePx: 3.4,
    glowPx: 13,
    amplitudePx: 3.6,
    forks: [0, 0],
    flickerSeconds: 0.06,
    speedCellsPerSecond: 0,
    trailCells: 0,
    coreSplit: 0,
    dots: 4,
    seconds: 0.32,
  },
  /*
    ★★ 0.3.2 阿米娅两套升变形态的普攻（用户口径：粉色柔和 / 黑色）。

    【为什么是 `bullet`（飞行的弹头）而不是 `flow`（整条线瞬到）】
    用户对慈悲愿景的原话是「从发射到命中保持统一的柔和粉色调」——
    "从发射到命中"本身要求**看得见它在飞**。基础阿米娅(op07)用的是 `flow_arts_dark`，
    那是"术式直接作用在目标身上"的瞬间流光；升变形态改成法术弹丸，飞行时间真实存在，
    命中时刻由 `tracerFlightSeconds` 算出来交给「统一命中时刻」，掉血会和弹丸落地同帧。

    【两条的形状参数一样，只有颜色和速度不同】
    速度 10 格/s（4 格 ≈ 0.40 秒，慢一点才"柔和"）vs 12 格/s（4 格 ≈ 0.33 秒，终曲更快）。
    `amiya_core` 走 `coreSplit`：加色混合下纯黑看不见 ⇒ 中间不画、只描暗红两条轨 +
    空心弹头，让棋盘透出来当黑芯（同 `bullet_shadow` 的画法）。
  */
  amiya_mercy: bulletVariant('#f7a8d8', '#fff5fb', '#c96aa8', '#ffc6e8', '#fff5fb', {
    speedCellsPerSecond: 10,
    trailCells: 1.15,
    seconds: 0.55,
    heightCells: 0.44,
    headScale: 0.85,
  }),
  amiya_core: bulletVariant('#1a1d24', '#ff6a52', '#0a0c10', '#7a1f2a', '#ffd6c6', {
    speedCellsPerSecond: 12,
    trailCells: 1.0,
    seconds: 0.5,
    heightCells: 0.44,
    headScale: 0.8,
    coreSplit: 2.6,
  }),
};

export function isTracerFx(id: string | undefined): boolean {
  return id !== undefined && TRACER_FX[id] !== undefined;
}

/** 同时在场的上限（超了丢最老的） */
export const MAX_LIVE_BOLT_TRACERS = 16;

export interface BoltTracer {
  kind: TracerKind;
  mesh: Mesh;
  material: MeshBasicMaterial;
  geometry: PlaneGeometry;
  texture: Texture;
  /** 只有 bolt（闪电）用 canvas 现画；子弹/炮弹是贴图，这里是 null */
  canvas: HTMLCanvasElement | null;
  style: BoltTracerStyle;
  elapsed: number;
  /** 这一发总共播多久（bolt 固定、bullet / shell 按距离算） */
  duration: number;
  /** 上一次画的是第几次抖动（只有 bolt 用） */
  lastFlicker: number;
  seed: number;
  /** 弹道起点（世界坐标，已在卡面边缘） */
  start: Vector3;
  /** 弹道落点（炮弹用：起点在空中、终点贴地） */
  end: Vector3;
  /** 单位方向 */
  dir: Vector3;
  /** 世界长度 */
  lengthWorld: number;
  /** 传给 `basisFor` 的相机（炮弹每一帧都要重算贴片朝向） */
  camera: Camera | null;
}

let seedCounter = 1;
/** 排查用：上一次 createBoltTracer 为什么返回 null（'ok' = 成功） */
let lastTracerError = 'ok';
export function getLastTracerError(): string {
  return lastTracerError;
}

function hash(i: number): number {
  let x = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** 世界方向 → "正对镜头 + X 沿弹道"的四元数基（相机为空时用默认俯角） */
function basisFor(dir: Vector3, camera: Camera | null, out: Matrix4): void {
  const normal = new Vector3(0, Math.SQRT1_2, Math.SQRT1_2); // 默认：45° 俯视的镜头方向
  if (camera) {
    camera.getWorldDirection(normal);
    normal.multiplyScalar(-1); // 反向 = 朝向镜头
  }
  const xAxis = dir.clone().normalize();
  // 把 X 投影到"垂直于镜头方向"的平面里，保证贴片正对镜头
  xAxis.sub(normal.clone().multiplyScalar(xAxis.dot(normal)));
  if (xAxis.lengthSq() < 1e-6) xAxis.set(1, 0, 0);
  xAxis.normalize();
  const yAxis = normal.clone().cross(xAxis).normalize();
  out.makeBasis(xAxis, yAxis, normal);
}

/** 画一帧闪电（纯 2D，和提案稿 `.fx-proposal/pink-bolt.html` 同一套画法） */
function paintBolt(ctx: CanvasRenderingContext2D, style: BoltTracerStyle, w: number, h: number, step: number, seed: number): void {
  const cy = h / 2;
  const len = w;
  ctx.clearRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const amp = style.amplitudePx;
  const segments = Math.max(5, Math.round(len / 22));
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const env = Math.pow(Math.sin(Math.PI * t), 0.7);
    pts.push({ x: t * len, y: cy + (hash(seed + i * 7919 + step * 131) - 0.5) * 2 * amp * env });
  }

  const stroke = (color: string, width: number, alpha: number): void => {
    ctx.beginPath();
    ctx.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.globalAlpha = alpha;
    ctx.stroke();
    ctx.globalAlpha = 1;
  };

  // ① 外圈：一层"闪" + 两层主色辉光
  stroke(style.outer, style.glowPx * 1.4, 0.14);
  stroke(style.main, style.glowPx, 0.22);
  stroke(style.bright, style.glowPx * 0.55, 0.3);

  // ② 整条线底下垫一层点缀色（粉色透冷蓝、黄色透暖橙）
  stroke(style.accent, style.glowPx * 0.5, 0.1);
  stroke(style.accent, style.corePx * 1.35, 0.16);

  // ③ 主体粉 + 亮粉电芯
  stroke(style.main, style.corePx, 0.98);
  stroke(style.bright, style.corePx * 0.56, 0.9);

  // ④ 浅蓝电流芯（随机挑 6 段）
  for (let k = 0; k < 6; k++) {
    const idx = Math.floor(hash(seed + k * 977 + step) * Math.max(1, pts.length - 2));
    const a = pts[Math.min(idx, pts.length - 2)]!;
    const b = pts[Math.min(idx + 1, pts.length - 1)]!;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = style.accent;
    ctx.lineWidth = style.corePx * 0.9;
    ctx.globalAlpha = 0.88;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ⑤ 白电火花点（3 颗）
  for (let k = 0; k < 3; k++) {
    const idx = Math.floor(hash(seed + k * 3571 + step * 17) * Math.max(1, pts.length - 1));
    const p = pts[idx]!;
    const r = (1.0 + hash(seed + k * 41 + step) * 1.3) * (style.corePx / 1.8);
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3);
    g.addColorStop(0, 'rgba(255,243,251,.95)');
    g.addColorStop(1, 'rgba(255,243,251,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // ⑥ 分叉：1~2 条短的，透明度只有主线一半（别抢主线）
  const forkCount = style.forks[0] + (hash(seed + 13) > 0.62 ? 1 : 0);
  for (let k = 0; k < forkCount; k++) {
    const baseIdx = Math.floor((0.28 + hash(seed + k * 613 + step * 7) * 0.44) * Math.max(1, pts.length - 1));
    const base = pts[baseIdx]!;
    const dirSign = hash(seed + k * 89 + step) > 0.5 ? 1 : -1;
    const forkLen = len * (0.04 + hash(seed + k * 191 + step) * 0.035);
    const fork: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= 4; i++) {
      const u = i / 4;
      fork.push({
        x: base.x + Math.cos(dirSign * 0.55) * forkLen * u,
        y: base.y + Math.sin(dirSign * 0.55) * forkLen * u + (hash(seed + k * 33 + i * 7 + step) - 0.5) * 4,
      });
    }
    ctx.beginPath();
    ctx.moveTo(fork[0]!.x, fork[0]!.y);
    for (let i = 1; i < fork.length; i++) ctx.lineTo(fork[i]!.x, fork[i]!.y);
    ctx.strokeStyle = style.main;
    ctx.lineWidth = style.corePx * 0.5;
    ctx.globalAlpha = 0.38;
    ctx.stroke();
    ctx.strokeStyle = style.accent;
    ctx.lineWidth = style.corePx * 0.34;
    ctx.globalAlpha = 0.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ⑦ 起点：粉色爆闪（中间掺一档蓝）
  const flashR = (9 + 4) * (style.heightCells / 0.62);
  const mg = ctx.createRadialGradient(0, cy, 0, 0, cy, flashR);
  mg.addColorStop(0, style.white);
  mg.addColorStop(0.3, style.bright);
  mg.addColorStop(0.62, style.accent);
  mg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = mg;
  ctx.beginPath();
  ctx.arc(0, cy, flashR, 0, Math.PI * 2);
  ctx.fill();

  // ⑧ 落点：白 + 浅蓝火花
  const hg = ctx.createRadialGradient(len, cy, 0, len, cy, flashR * 0.85);
  hg.addColorStop(0, style.white);
  hg.addColorStop(0.4, style.accent);
  hg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = hg;
  ctx.beginPath();
  ctx.arc(len, cy, flashR * 0.85, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalCompositeOperation = 'source-over';
}

/** `'#rrggbb'` → `[r,g,b]`（子弹贴图要按 style 的颜色现拼渐变，不能写死） */
function hexRgb(hex: string): [number, number, number] {
  const v = hex.replace('#', '');
  return [
    Number.parseInt(v.slice(0, 2), 16),
    Number.parseInt(v.slice(2, 4), 16),
    Number.parseInt(v.slice(4, 6), 16),
  ];
}

function rgbaOf(hex: string, alpha: number): string {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * 子弹的拖尾贴图（一张固定图，不用每发现画）：
 * 右端是白热的弹头，往左拖一条越来越淡的尾巴。
 *
 * ★★ 0.2.1：**颜色全部来自 `style`**。原来这里有 12 处写死的橙色 `rgba(255,139,25,…)`，
 * 所以不管注册表里填什么颜色，出来的子弹都是橙的 —— "给梅的弹道做几种颜色版本"
 * 这件事在旧代码上根本不可能实现（改了颜色也不会有任何变化）。
 *
 * ★ `coreSplit > 0` = **暗芯弹**（塑心的紫黑 / 伊内丝的赤黑 / 望的纯黑）：
 * 加色混合下"纯黑 = 什么都不加"，所以中间不画，只描两条边 + 一圈**空心弹头**，
 * 让棋盘透出来 —— 眼睛读到的是"一颗黑弹，边缘在发光"。
 */
function paintBullet(ctx: CanvasRenderingContext2D, style: BoltTracerStyle, w: number, h: number): void {
  const cy = h / 2;
  ctx.clearRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'lighter';

  const split = style.coreSplit ?? 0;

  if (split > 0) {
    // ---- 暗芯弹：两条细轨 + 空心弹头环 ----
    const rail = (off: number, thickness: number, alpha: number, color: string): void => {
      const grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, rgbaOf(color, 0));
      grad.addColorStop(0.45, rgbaOf(color, 0.30 * alpha));
      grad.addColorStop(0.82, rgbaOf(color, 0.80 * alpha));
      grad.addColorStop(1, rgbaOf(style.bright, alpha));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, cy + off * thickness * 0.25);
      ctx.lineTo(w * 0.8, cy + off * thickness);
      ctx.lineTo(w, cy + off * thickness * 0.7);
      ctx.lineTo(w, cy + off * thickness * 0.28);
      ctx.lineTo(0, cy + off * thickness * 0.08);
      ctx.closePath();
      ctx.fill();
    };
    const gap = h * 0.1 * (split / 2.6); // 中间留多宽
    rail(1, gap + h * 0.06, 0.55, style.accent);
    rail(-1, gap + h * 0.06, 0.55, style.accent);
    rail(1, gap * 0.4, 0.85, style.accent);
    rail(-1, gap * 0.4, 0.85, style.accent);

    // 弹头：一圈发光的外环（中间空着 = 黑芯）
    const outerR = h * 0.36;
    const ring = ctx.createRadialGradient(w * 0.93, cy, outerR * 0.35, w * 0.93, cy, outerR);
    ring.addColorStop(0, rgbaOf(style.main, 0));
    ring.addColorStop(0.35, rgbaOf(style.accent, 0.9));
    ring.addColorStop(0.72, rgbaOf(style.bright, 0.85));
    ring.addColorStop(1, rgbaOf(style.accent, 0));
    ctx.fillStyle = ring;
    ctx.beginPath();
    ctx.arc(w * 0.93, cy, outerR, 0, Math.PI * 2);
    ctx.fill();
    // 环外那一点白热（落在环前面，不落进洞里）
    const spark = ctx.createRadialGradient(w, cy, 0, w, cy, h * 0.16);
    spark.addColorStop(0, rgbaOf(style.white, 0.95));
    spark.addColorStop(1, rgbaOf(style.bright, 0));
    ctx.fillStyle = spark;
    ctx.beginPath();
    ctx.arc(w, cy, h * 0.16, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalCompositeOperation = 'source-over';
    return;
  }

  // ---- 实心弹：拖尾 → 弹头 → 火星 ----
  const drawTail = (thickness: number, alpha: number): void => {
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, rgbaOf(style.outer, 0));
    grad.addColorStop(0.45, rgbaOf(style.main, 0.35 * alpha));
    grad.addColorStop(0.82, rgbaOf(style.accent, 0.85 * alpha));
    grad.addColorStop(1, rgbaOf(style.bright, alpha));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, cy - thickness * 0.25);
    ctx.lineTo(w * 0.82, cy - thickness);
    ctx.lineTo(w, cy - thickness * 0.6);
    ctx.lineTo(w, cy + thickness * 0.6);
    ctx.lineTo(w * 0.82, cy + thickness);
    ctx.lineTo(0, cy + thickness * 0.25);
    ctx.closePath();
    ctx.fill();
  };
  drawTail(h * 0.34, 0.28); // 外层光晕
  drawTail(h * 0.16, 0.8); // 主体

  // 弹头：白热核心 + 同色光晕（半径可被 `headScale` 缩小，见那个字段的说明）
  const headR = h * 0.42 * (style.headScale ?? 1);
  const core = ctx.createRadialGradient(w * 0.93, cy, 0, w * 0.93, cy, headR);
  core.addColorStop(0, rgbaOf(style.white, 1));
  core.addColorStop(0.35, rgbaOf(style.bright, 0.95));
  core.addColorStop(0.7, rgbaOf(style.accent, 0.45));
  core.addColorStop(1, rgbaOf(style.main, 0));
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(w * 0.93, cy, headR, 0, Math.PI * 2);
  ctx.fill();

  // 沿拖尾撒几颗小火星
  for (let i = 0; i < 5; i++) {
    const x = w * (0.2 + hash(i * 131) * 0.62);
    const y = cy + (hash(i * 977) - 0.5) * h * 0.5;
    const r = h * (0.02 + hash(i * 41) * 0.03);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.5);
    g.addColorStop(0, rgbaOf(style.bright, 0.9));
    g.addColorStop(1, rgbaOf(style.main, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r * 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalCompositeOperation = 'source-over';
}

// ============================================================
//  法术「流光」贴图（`flow`）
//  ★ 和闪电的区别：**没有随机折角**，是一条平滑摆动的光带；
//    亮度靠"跑动的亮点"（phase 推进）表达流动感，不靠抖。
// ============================================================

/** 在画布上沿流光中心线画一条带（`off` = 上下偏移，用于"中间留黑"的两条边） */
function traceFlow(
  ctx: CanvasRenderingContext2D,
  pts: Array<{ x: number; y: number; env: number }>,
  off: number,
): void {
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y + off * pts[0]!.env);
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i]!;
    const n = pts[i + 1]!;
    const mx = (p.x + n.x) / 2;
    const my = ((p.y + off * p.env) + (n.y + off * n.env)) / 2;
    ctx.quadraticCurveTo(p.x, p.y + off * p.env, mx, my);
  }
  const last = pts[pts.length - 1]!;
  ctx.lineTo(last.x, last.y + off * last.env);
}

function paintFlow(
  ctx: CanvasRenderingContext2D,
  style: BoltTracerStyle,
  w: number,
  h: number,
  phase: number,
  seed: number,
): void {
  const cy = h / 2;
  const len = w;
  ctx.clearRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const amp = style.amplitudePx;
  const segments = Math.max(12, Math.round(len / 16));
  const pts: Array<{ x: number; y: number; env: number }> = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    // 两端收窄（能量从手上"长出来"）
    const env = Math.pow(Math.sin(Math.PI * t), 0.5);
    const wave = Math.sin(t * 6.2 + phase * Math.PI * 2) * 0.72
      + Math.sin(t * 13.4 - phase * Math.PI * 2 * 1.6) * 0.28;
    pts.push({ x: t * len, y: cy + amp * env * wave, env });
  }

  const stroke = (color: string, width: number, alpha: number, off = 0): void => {
    traceFlow(ctx, pts, off);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(0.6, width);
    ctx.globalAlpha = alpha;
    ctx.stroke();
    ctx.globalAlpha = 1;
  };

  const split = style.coreSplit ?? 0;

  /*
    ① 外辉光
    ★★ 暗芯（`coreSplit > 0`）**一律不许加宽光晕**：31px 宽的光带会把两条红边之间
      那块"本该是黑"的地方一起点亮 ⇒ 整条读成粉白色（阿米娅第一版就是这么毁的：
      贴图真值页里是一条粉红发光带，完全看不出"黑"）。
      只有实心芯（拉普兰德白 / 治疗绿）才铺一层很窄的外光。
  */
  if (split > 0) {
    stroke(style.outer, style.corePx * 1.2, 0.10, split);
    stroke(style.outer, style.corePx * 1.2, 0.10, -split);
  } else {
    stroke(style.outer, style.glowPx * 1.4, 0.09);
    stroke(style.main, style.glowPx * 0.75, 0.14);
  }

  /*
    ② 光带本体
    · `coreSplit > 0`（阿米娅的红/黑）：**只描两侧细边**，中间不画 ⇒ 棋盘透出来 = 黑色内芯；
    · 否则（拉普兰德的白 / 治疗的绿）：**中间调（`accent`：白套的灰 / 治疗套的浅绿）** → 软体 → 亮芯 → **极细**高光。
      ★ `accent` 这一层别省：它才是"灰色点缀"和"绿"真正读出来的地方，
        少了它白套就只剩纯白、绿套只剩白芯。
  */
  if (split > 0) {
    stroke(style.main, style.corePx * 0.62, 0.72, split);
    stroke(style.main, style.corePx * 0.62, 0.72, -split);
    stroke(style.bright, style.corePx * 0.24, 0.55, split);
    stroke(style.bright, style.corePx * 0.24, 0.55, -split);
  } else {
    /*
      实心芯（拉普兰德白 / 治疗绿）：从外到内五层，**宽的那几层一律很淡**。
      ★ 第一版把 `bright`（近白）按 corePx 宽、0.96 铺 ⇒ 加色下整条饱和成
        一块"平板白条"，没有任何渐变和点缀（真值图里就是一条白胶带）。
        现在只有 0.55 宽的那层是亮的，外圈靠 `accent`（白套=灰 / 绿套=浅绿）过渡。
    */
    stroke(style.accent, style.corePx * 2.6, 0.14);
    stroke(style.main, style.corePx * 1.5, 0.34);
    stroke(style.bright, style.corePx * 0.55, 0.80);
    stroke(style.white, style.corePx * 0.16, 0.35);
  }

  // ③ 跑动的亮点（"流光"全在这里：phase 推进 ⇒ 亮点沿线路往前走）
  const dots = Math.max(0, style.dots ?? 4);
  for (let k = 0; k < dots; k++) {
    const s = (((phase * 0.6 + k / Math.max(1, dots)) % 1) + 1) % 1;
    const idx = Math.min(pts.length - 1, Math.max(0, Math.round(s * (pts.length - 1))));
    const p = pts[idx]!;
    // 走到两端时小一点（别让亮点杵在施法者脸上）
    const edgeFade = 0.35 + 0.65 * Math.sin(Math.PI * s);
    const pulse = 0.55 + 0.45 * Math.sin(phase * Math.PI * 2 + k * 1.9);
    /*
      ★★ 半径必须小：第一版按 `corePx * 2.6` 画（直径≈50px），比 40px 高的画布还大，
      整条流光变成"一串白团"、还盖掉了中间的暗芯。现在最大半径 ≈ corePx*1.1。
    */
    const r = Math.max(1.5, style.corePx * (0.55 + 0.45 * pulse) * edgeFade);
    /*
      ★★ 暗芯那套的亮点必须压在**红边上**（左右交替）：
      画在中心线上会把中间的黑带点亮，整条变成"红色梯子"（第二版真值图里就是这样）。
    */
    const dy = split > 0 ? (k % 2 === 0 ? split : -split) : 0;
    const px = p.x;
    const py = p.y + dy;
    const reach = r * (split > 0 ? 1.25 : 1.9);
    const g = ctx.createRadialGradient(px, py, 0, px, py, reach);
    g.addColorStop(0, style.bright);
    g.addColorStop(0.35, style.bright);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.globalAlpha = 0.55 + 0.35 * pulse;
    ctx.beginPath();
    ctx.arc(px, py, reach, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  /*
    ④ 零星点缀（术式的碎屑，位置随 phase 漂）
    ★ 暗芯那套必须把碎屑放到**红边外侧**：落在黑带里就是"漏光"，黑芯立刻读不出来了。
  */
  const speckSide = split > 0 ? split + style.corePx * 0.7 : style.corePx * 2.2;
  for (let k = 0; k < 6; k++) {
    const s = ((hash(seed + k * 977 + Math.floor(phase * 6)) * 0.9 + 0.05) % 1);
    const idx = Math.min(pts.length - 1, Math.round(s * (pts.length - 1)));
    const p = pts[idx]!;
    const side = (hash(seed + k * 131 + Math.floor(phase * 6)) - 0.5) * 2;
    const y = p.y + side * speckSide;
    const r = 0.7 + 1.5 * hash(seed + k * 37);
    const g = ctx.createRadialGradient(p.x, y, 0, p.x, y, r * 3);
    g.addColorStop(0, split > 0 ? style.bright : style.white);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.globalAlpha = split > 0 ? 0.32 : 0.5;
    ctx.beginPath();
    ctx.arc(p.x, y, r * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  /*
    ⑤ 两端：起点（手上）一点光、落点（目标）一团光
    ★ 中心用 `bright` 而不是 `white`：治疗那套 `white` 是近白色，画成 13px 的大亮球
      会把两端的颜色洗掉（截图里读成"两头白球、中间绿线"）。
  */
  const ends: Array<[number, number, number]> = [
    [pts[0]!.x, pts[0]!.y, style.corePx * 1.6],
    [pts[pts.length - 1]!.x, pts[pts.length - 1]!.y, style.corePx * 2.0],
  ];
  for (const [x, y, r] of ends) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, style.bright);
    g.addColorStop(0.34, style.bright);
    g.addColorStop(0.7, style.accent);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  ctx.globalCompositeOperation = 'source-over';
}

// ============================================================
//  炮弹贴图（`shell`）：共享原图 + 每实例帧指针 + 小池子
//  规则和 `sequence-fx.ts` 完全一样 —— clone 只 clone 帧指针，底图只上传一次。
// ============================================================

const shellBase = new Map<string, Texture>();
const shellRequested = new Set<string>();
const shellIdle = new Map<string, Texture[]>();

function baseTextureOf(style: BoltTracerStyle): Texture | null {
  const path = style.image;
  if (!path) return null;
  const cached = shellBase.get(path);
  if (cached) return cached;
  const image = getLoadedImage(path);
  if (!image) {
    if (!shellRequested.has(path)) {
      shellRequested.add(path);
      void loadImage(path).then((loaded) => {
        if (loaded) shellBase.set(path, textureFromImage(loaded));
      });
    }
    return null;
  }
  const texture = textureFromImage(image);
  shellBase.set(path, texture);
  return texture;
}

function textureFromImage(image: HTMLImageElement): Texture {
  const texture = new Texture(image);
  // ★ 不写色彩空间颜色会被冲淡（同 sequence-fx / slash-fx 的说明）
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function acquireShellTexture(style: BoltTracerStyle, base: Texture): Texture {
  const path = style.image!;
  const reused = shellIdle.get(path)?.pop();
  const frames = Math.max(1, style.frames ?? 1);
  if (reused) {
    reused.offset.set(0, 0);
    reused.repeat.set(1 / frames, 1);
    return reused;
  }
  const texture = base.clone();
  texture.repeat.set(1 / frames, 1);
  texture.offset.set(0, 0);
  return texture;
}

function releaseShellTexture(path: string, texture: Texture): void {
  const pool = shellIdle.get(path) ?? [];
  if (pool.length >= 2) {
    texture.dispose();
    return;
  }
  pool.push(texture);
  shellIdle.set(path, pool);
}

/** 开局调一次：先把三张炮弹图拉下来（等第一炮打响才下就来不及了） */
export function preloadTracerFxTextures(): void {
  for (const style of Object.values(TRACER_FX)) {
    if (style.kind === 'shell' && style.image) void loadImage(style.image);
  }
}

/**
 * 造一发弹道（闪电 / 子弹 / 炮弹）。
 *
 * @returns 不认识的 id / 长度太短 / 图还没加载好 时返回 null
 */
export function createBoltTracer(id: string, from: Vector3, to: Vector3, camera: Camera | null): BoltTracer | null {
  const style = TRACER_FX[id];
  if (!style) {
    lastTracerError = `no-style:${id}`;
    return null;
  }
  const dir = new Vector3().subVectors(to, from);
  const lengthWorld = dir.length();
  if (lengthWorld < 0.2) {
    lastTracerError = `too-short:${lengthWorld.toFixed(3)} from=(${from.x.toFixed(2)},${from.z.toFixed(2)}) to=(${to.x.toFixed(2)},${to.z.toFixed(2)})`;
    return null;
  }
  const dirNorm = dir.clone().normalize();

  // ---- 炮弹：整张 Sprite 就是美术画的序列帧图，不用 canvas ----
  if (style.kind === 'shell') {
    const base = baseTextureOf(style);
    if (!base) {
      lastTracerError = `image-pending:${style.image ?? ''}`;
      return null;
    }
    const texture = acquireShellTexture(style, base);
    const material = new MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 1,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    });
    const sizeWorld = (style.cells ?? 1) * CELL;
    const geometry = new PlaneGeometry(sizeWorld, sizeWorld);
    const mesh = new Mesh(geometry, material);
    mesh.position.copy(from);
    const basis = new Matrix4();
    basisFor(dirNorm, camera, basis);
    mesh.quaternion.setFromRotationMatrix(basis);
    mesh.renderOrder = RENDER_ORDER_FX;
    mesh.name = `boltfx:${id}`;
    const duration = Math.min(
      style.seconds,
      Math.max(0.12, (lengthWorld / CELL) / Math.max(1, style.speedCellsPerSecond)),
    );
    lastTracerError = 'ok';
    return {
      kind: 'shell',
      mesh,
      material,
      geometry,
      texture,
      canvas: null,
      style,
      elapsed: 0,
      duration,
      lastFlicker: 0,
      seed: seedCounter++ * 7919,
      start: from.clone(),
      end: to.clone(),
      dir: dirNorm,
      lengthWorld,
      camera,
    };
  }

  const heightWorld = style.heightCells * CELL;
  const isBolt = style.kind === 'bolt';
  // ★ 闪电和流光都是"整条线一次铺满"；子弹只有一个 1×1 的壳靠 scale 拉长
  const isLine = isBolt || style.kind === 'flow';

  // 画布：闪电/流光按实际长度画；子弹画一张固定的小拖尾
  const w = isLine ? Math.max(8, Math.round((lengthWorld / CELL) * style.pxPerCell)) : style.pxPerCell * 4;
  const h = Math.max(8, Math.round(style.heightCells * style.pxPerCell));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    lastTracerError = 'no-ctx';
    return null;
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;

  const material = new MeshBasicMaterial({
    map: texture as Texture,
    transparent: true,
    opacity: 1,
    blending: AdditiveBlending,
    // ★ 加色层不写深度、只认 renderOrder（同攻击特效/刀光那套规矩）
    depthWrite: false,
    side: DoubleSide,
  });

  // 闪电/流光：几何就是整条线；子弹：几何是 1×1，靠每帧 scale 拉出"已飞过的一段"
  const geometry = isLine ? new PlaneGeometry(lengthWorld, heightWorld) : new PlaneGeometry(1, 1);
  const mesh = new Mesh(geometry, material);
  const basis = new Matrix4();
  basisFor(dirNorm, camera, basis);
  mesh.quaternion.setFromRotationMatrix(basis);
  if (isLine) {
    mesh.position.set((from.x + to.x) / 2, from.y, (from.z + to.z) / 2);
  } else {
    mesh.position.copy(from);
    mesh.scale.set(0.001, heightWorld, 1);
  }
  mesh.renderOrder = RENDER_ORDER_FX;
  // 排查用：控制台/定格页能一眼看出场上在飞什么
  mesh.name = `boltfx:${id}`;

  const seed = seedCounter++ * 7919;
  if (isBolt) paintBolt(ctx, style, w, h, 0, seed);
  else if (style.kind === 'flow') paintFlow(ctx, style, w, h, 0, seed);
  else paintBullet(ctx, style, w, h);

  // 子弹的飞行时长按距离算：远了久一点，近了"一闪就到"
  const duration = isLine
    ? style.seconds
    : Math.min(style.seconds, Math.max(0.06, (lengthWorld / CELL) / Math.max(1, style.speedCellsPerSecond)));

  lastTracerError = 'ok';
  return {
    kind: style.kind,
    mesh,
    material,
    geometry,
    texture,
    canvas,
    style,
    elapsed: 0,
    duration,
    lastFlicker: 0,
    seed,
    start: from.clone(),
    end: to.clone(),
    dir: dirNorm,
    lengthWorld,
    camera,
  };
}

/** 每帧推进：闪电换抖动帧 / 子弹往前飞 / 炮弹走抛物线；返回 false = 该回收了 */
export function updateBoltTracer(bolt: BoltTracer, deltaSeconds: number): boolean {
  bolt.elapsed += deltaSeconds;
  if (bolt.elapsed >= bolt.duration) return false;
  const t = bolt.elapsed / bolt.duration;

  if (bolt.kind === 'bolt' || bolt.kind === 'flow') {
    // 抖动/流光刷新（闪电 0.07 秒重抖一次；流光 0.06 秒把亮点往前推一格）
    const step = Math.floor(bolt.elapsed / bolt.style.flickerSeconds);
    if (step !== bolt.lastFlicker) {
      bolt.lastFlicker = step;
      const canvas = bolt.canvas;
      const ctx = canvas?.getContext('2d') ?? null;
      if (canvas && ctx) {
        if (bolt.kind === 'bolt') paintBolt(ctx, bolt.style, canvas.width, canvas.height, step, bolt.seed);
        // ★ 流光的 phase 就是"时间"，亮点沿线路往前跑 ⇒ 看起来在流
        else paintFlow(ctx, bolt.style, canvas.width, canvas.height, step * 0.34, bolt.seed);
        bolt.texture.needsUpdate = true;
      }
    }
    // 透明度：前 12% 淡入、55% 之后开始收（闪电"炸开 → 抽走"）
    const fadeIn = Math.min(1, t / 0.12);
    const fadeOut = t < 0.55 ? 1 : Math.max(0, 1 - (t - 0.55) / 0.45);
    bolt.material.opacity = fadeIn * fadeOut;
    return true;
  }

  /*
    ★★ 炮弹：位置 = 起终点连线 + 抛物线抬升，贴片按**屏幕速度方向**转。

    【为什么每一帧都要重算 quaternion？】
    弹道是弯的 —— 起手（向上）和落点（向下）的切线方向差很多，
    固定一个朝向的话，尾焰会一路斜着指错方向。
    `basisFor(速度, 相机)` 给出的正是"贴片正对镜头、X 轴落在屏幕上的速度方向"。

    【高度怎么来的？】
    起点是胸口高度（`BOLT_TRACER_Y`），终点贴地；中间再叠一条抛物线
    `4·apex·t(1-t)`（顶点在 t=0.5，高度 = apex 格）。
  */
  if (bolt.kind === 'shell') {
    const arc = (bolt.style.arcCells ?? 0) * CELL;
    const head = bolt.lengthWorld * Math.min(1, t);
    const lift = 4 * arc * t * (1 - t);
    const baseY = bolt.start.y + (bolt.end.y - bolt.start.y) * t;
    bolt.mesh.position.set(
      bolt.start.x + bolt.dir.x * head,
      baseY + lift,
      bolt.start.z + bolt.dir.z * head,
    );
    // 世界速度 = 水平分量 + 竖直分量（竖直分量的符号决定"还在上升"还是"开始下落"）
    const horizontal = bolt.lengthWorld / bolt.duration;
    const vertical = (bolt.end.y - bolt.start.y) / bolt.duration + (4 * arc * (1 - 2 * t)) / bolt.duration;
    const velocity = new Vector3(bolt.dir.x * horizontal, vertical, bolt.dir.z * horizontal);
    if (velocity.lengthSq() > 1e-8) {
      const basis = new Matrix4();
      basisFor(velocity.normalize(), bolt.camera, basis);
      bolt.mesh.quaternion.setFromRotationMatrix(basis);
    }
    // 帧：8 帧循环抖尾焰
    const frames = Math.max(1, bolt.style.frames ?? 1);
    const fps = Math.max(1, bolt.style.fps ?? 30);
    const frame = Math.floor(bolt.elapsed * fps) % frames;
    const offset = frame / frames;
    if (Math.abs(bolt.texture.offset.x - offset) > 1e-6) bolt.texture.offset.x = offset;
    // 最后 10% 收一下（命中爆炸接上）
    bolt.material.opacity = t > 0.9 ? Math.max(0, 1 - (t - 0.9) / 0.1) : 1;
    return true;
  }

  /*
    子弹：弹头位置 = 走过的距离；拖尾最长 `trailCells` 格。
    几何是 1×1，靠 `scale.x` 拉长、`position` 挪到"拖尾中点"。
  */
  const head = bolt.lengthWorld * Math.min(1, t);
  const trail = Math.min(bolt.style.trailCells * CELL, head);
  const span = Math.max(0.001, trail);
  const heightWorld = bolt.style.heightCells * CELL;
  bolt.mesh.scale.set(span, heightWorld, 1);
  const center = head - span / 2;
  bolt.mesh.position.set(
    bolt.start.x + bolt.dir.x * center,
    bolt.start.y,
    bolt.start.z + bolt.dir.z * center,
  );
  // 最后 12% 收一下（命中火花由 `angel_hit` 接上）
  bolt.material.opacity = t > 0.88 ? Math.max(0, 1 - (t - 0.88) / 0.12) : 1;
  return true;
}

/**
 * 这条弹道从 A 飞到 B 要多久（秒）。
 * ★ 给渲染层用：子弹/炮弹是"飞过去"的，命中特效应该**等它飞到**再炸，
 *   否则会出现"火花先炸、子弹还在路上"的错位。闪电是瞬到的，返回 0。
 */
export function tracerFlightSeconds(id: string | undefined, distanceWorld: number): number {
  if (!id) return 0;
  const style = TRACER_FX[id];
  if (!style || (style.kind !== 'bullet' && style.kind !== 'shell')) return 0;
  const floor = style.kind === 'shell' ? 0.12 : 0.06;
  return Math.min(style.seconds, Math.max(floor, (distanceWorld / CELL) / Math.max(1, style.speedCellsPerSecond)));
}

/** 摘掉并释放 */
export function disposeBoltTracer(bolt: BoltTracer): void {
  bolt.mesh.parent?.remove(bolt.mesh);
  bolt.geometry.dispose();
  bolt.material.dispose();
  if (bolt.kind === 'shell' && bolt.style.image) releaseShellTexture(bolt.style.image, bolt.texture);
  else bolt.texture.dispose();
}
