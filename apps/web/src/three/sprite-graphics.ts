import {
  Sprite,
  SpriteMaterial,
  CanvasTexture,
  LinearFilter,
  SRGBColorSpace,
  type Texture,
} from 'three';
import type { UnitDef } from '../../../../packages/shared/src/index.js';
import type { SkillBarMode, SkillBarState } from './skill-bar.js';
import { getLoadedImage, unitSpritePath, unitStandPath } from './assets.js';
import { CARD_OPACITY } from './card-layout.js';
import { attachChibi, detachChibi, setChibiMirror, type ChibiHooks } from './chibi.js';

/**
 * ============================================================
 *  棋子身上的"状态特效"（画在卡面上，半透明）
 * ============================================================
 *
 * 【为什么要有这个？】
 * 战斗里棋子吃到护盾、攻速加成、攻击力加成、被眩晕时，
 * 之前**画面上完全看不出来** —— 你只能从战斗日志里读文字。
 * 但自走棋的乐趣一半在"看场面"：一眼看出"这个坦克身上有盾""那个输出被加速了"，
 * 才知道该把技能给谁、该先杀谁。
 *
 * 【图标为什么用代码画，不下载素材？】
 * 一是这些图标就是几个简单几何形状（盾牌 / 闪电 / 箭头 / 星星），
 * 画出来比找素材更快、更可控；
 * 二是**没有授权问题** —— 从网上找的图标多半有署名或商用限制，
 * 而这个项目以后可能会给别人玩。
 * 以后你想换成真图标，只要在 drawEffectGlyph 里换成 drawImage 就行。
 */
export interface UnitEffectFlags {
  /** 有护盾（青色） */
  shield: boolean;
  /** 攻速加成（粉色） */
  attackSpeed: boolean;
  /** 攻击力加成（橙色） */
  attackDamage: boolean;
  /** 被眩晕（黄色） */
  stun: boolean;
  /**
   * 刚刚闪避 / 免疫了一次攻击（灰色，只闪一下）。
   *
   * 【为什么要单独一个提示？】
   * 因为"闪避"和"打了个 0 伤害"在画面上完全不一样：
   * 前者说明这个棋子有闪避机制，后者看起来像数值算错了。
   * 焰尾（75% 闪避）和机械师（免疫 N 次攻击）都靠它表现。
   */
  evade: boolean;
}

/** 没有任何状态（默认值，也是缓存键里最省的一档） */
export const NO_EFFECTS: UnitEffectFlags = {
  shield: false,
  attackSpeed: false,
  attackDamage: false,
  stun: false,
  evade: false,
};

/** 把状态压成一个短字符串，用来做贴图缓存键 */
function effectKeyOf(effects: UnitEffectFlags): string {
  return `${effects.shield ? 1 : 0}${effects.attackSpeed ? 1 : 0}${effects.attackDamage ? 1 : 0}${effects.stun ? 1 : 0}${effects.evade ? 1 : 0}`;
}

/** 两套状态是否一样（用来判断"要不要重画卡面"） */
export function sameEffects(a: UnitEffectFlags, b: UnitEffectFlags): boolean {
  return (
    a.shield === b.shield &&
    a.attackSpeed === b.attackSpeed &&
    a.attackDamage === b.attackDamage &&
    a.stun === b.stun &&
    a.evade === b.evade
  );
}

/**
 * ============================================================
 *  2D 角色贴图生成器
 * ============================================================
 *
 * 我们的美术方案是「3D 场景 + 2D 人物」，所以棋子就是一张纸片（billboard Sprite），
 * 永远面朝相机 —— 这样从任何角度看都是完整的立绘，成本极低。
 *
 * 【为什么用代码画，而不是先找美术图？】
 * 一是现在没有美术素材，二是「占位图」能让你立刻看到效果、验证手感。
 * 三是这些图完全由数据表驱动（颜色、名字、费用、星级都来自 unit-data.ts），
 * 你改了数据表，画面立刻跟着变。
 *
 * 以后换成真立绘只需要改这一个文件：把 drawUnitCard 里的绘制内容
 * 换成 texture = await loadTexture(def.sprite + '.png') 就行，其他代码不用动。
 */

/* 卡片版式常量抽到了 three/card-layout.ts —— chibi.ts 也要用同一套。
   这里 import 进来供本文件使用，同时 re-export 保持原有 import 路径对外不变。 */
import { CARD_H, CARD_W, CARD_WORLD_SCALE, PORTRAIT_AREA } from './card-layout.js';
export { CARD_H, CARD_W, CARD_WORLD_SCALE, PORTRAIT_AREA };

/*
  血条的版式从 card-layout.ts 取（唯一来源）。
  它现在是**独立的一张小精灵**，所以要摆在卡片上的哪个位置也得从这里算。
*/
import {
  CARD_BODY_ALPHA,
  HP_BAR_AREA,
  ITEM_DOT_COUNT,
  ITEM_DOT_GAP,
  ITEM_DOT_SIZE,
  ITEM_DOTS_AREA,
  RENDER_ORDER_CARD,
  RENDER_ORDER_HP,
  RENDER_ORDER_SKILL_BAR,
  RENDER_ORDER_STARS,
  SKILL_BAR_AREA,
  STAR_AREA,
} from './card-layout.js';
export { HP_BAR_AREA, SKILL_BAR_AREA };

/**
 * 血条精灵的渲染层级。
 *
 * 【为什么必须显式指定？】
 * 卡片 / 小人 / 血条 / 星级是四张**平级的精灵**（后三个虽然挂在卡片下面，
 * 但深度排序是按对象算的），three.js 对透明物体是先比 `renderOrder`、
 * 再比投影后的深度。小人被刻意往前推了 DEPTH_EPSILON 好盖住卡片，
 * 血条要反过来**盖住小人**、星级还要再压过血条 ——
 * 只靠深度很容易在斜视角下算错，直接写死 renderOrder 最稳。
 *
 * 层级现在就一份，写在 card-layout.ts（**唯一来源**）：
 *   0 卡片 < 1 小人 < 2 血条 < 3 星级
 * 这里 re-export 是为了不破坏原来 `从 sprite-graphics 取 RENDER_ORDER_HP` 的引用。
 */
export { RENDER_ORDER_CARD, RENDER_ORDER_HP, RENDER_ORDER_STARS };

/**
 * ★ 星级配色（1 星铜、2 星银、3 星金）
 *
 * 【为什么要加这个？】
 * 原来的外框是**队伍色**（我方蓝、敌方红），而星级只在右上角画了几个小星星 ——
 * 打起来一堆棋子挤在一起，那几个小星星根本看不清，
 * "我这个到底是不是三星"要凑近了数。
 * 现在整张卡的边框直接按星级上色，一眼就能扫出来哪个是大哥。
 *
 * 【那队伍色去哪了？】
 * 搬到**血条**上了：我方绿、敌方红（见下面的血条绘制）。
 * 边框说"多强"，血条说"是谁"，两个信息各占一块地方，不再互相挤。
 *
 * 【★ 0.0.2 追加：`body` 是干什么的？】
 * 你要求"卡面颜色跟星级对应：1 星暗铜、2 星银、3 星金"。
 * 所以卡片**底面渐变**不再用棋子的定位色（def.color），改用这一组金属色。
 * 三档靠**明度和色相两个维度**一起拉开：
 *   · 暗铜偏深偏暖（亮度 ≈70）——"暗"字要看得出来
 *   · 银/金亮度接近（≈164 / 170，现实里两种金属本来就都亮），
 *     但一个是低饱和冷色、一个是高饱和暖色，所以不会认错
 * 测试里钉的就是这两条（`unit-card-looks.test.ts`）。
 */
const STAR_FRAME: Record<number, { edge: string; inner: string; body: string; label: string }> = {
  1: { edge: '#8a4f1d', inner: '#c8752f', body: '#6b3f1a', label: '铜' },
  2: { edge: '#8e97a3', inner: '#cfd8e4', body: '#9aa5b4', label: '银' },
  3: { edge: '#b98a12', inner: '#ffd75e', body: '#d9a92e', label: '金' },
};
/** 召唤物没有星级，用中性灰蓝 */
const SUMMON_FRAME = { edge: '#3d4a5c', inner: '#6d8299', label: '' };

/**
 * ★ 彩蛋棋子（维维美·绝对主角）的卡面配色。
 *
 * 【用户的描述】"商店边框为炫彩的感觉，以浅蓝和淡紫色、分数渐变为主，
 * 干员背景卡面同样"。所以这里不是"某一档金属色"，而是**浅蓝 ↔ 淡紫 的多色渐变**。
 *
 * 【为什么是两组停靠点而不是一个颜色？】
 * canvas 的 `createLinearGradient` 想要"炫彩"，靠的就是多色标：
 * 只有两个色标就只是普通的双色过渡，三个以上来回交替才有那种虹彩的感觉。
 */
const EGG_FRAME = { edge: '#7fb8ff', inner: '#c9b0ff', body: '#a9c8ff', label: '彩蛋' };
/** 外框的炫彩停靠点（从左到右） */
const EGG_EDGE_STOPS: ReadonlyArray<readonly [number, string]> = [
  [0, '#8fd4ff'],
  [0.3, '#b6c2ff'],
  [0.55, '#d6b8ff'],
  [0.8, '#a9c8ff'],
  [1, '#7fb8ff'],
];
/** 卡面底色的炫彩停靠点（从上到下，"分数渐变"= 多档来回过渡） */
const EGG_BODY_STOPS: ReadonlyArray<readonly [number, string]> = [
  [0, '#9edcff'],
  [0.26, '#bcc8ff'],
  [0.5, '#d8bcff'],
  [0.74, '#a6c4ff'],
  [1, '#8fb4ff'],
];

/** 取某张卡的外框配色 */
function frameOf(def: UnitDef, star: number): { edge: string; inner: string; label: string } {
  if (def.summonOnly) return SUMMON_FRAME;
  if (def.noStar) return EGG_FRAME;
  return STAR_FRAME[Math.max(1, Math.min(3, Math.round(star)))] ?? STAR_FRAME[1]!;
}

/**
 * 卡面**底色**（渐变中间那一档）。召唤物沿用中性灰蓝。
 *
 * 单独抽出来（而不是在 drawUnitCard 里直接读）是为了让测试能钉住
 * "1 星暗铜 / 2 星银 / 3 星金"这条规则 —— 颜色是在 canvas 上画的，
 * jsdom 里没法验像素，但"选了哪个颜色"是纯逻辑。
 *
 * ★ 彩蛋（noStar）返回浅蓝，真正的"炫彩"由 drawUnitCard 里的多色渐变实现。
 */
export function cardBodyColorFor(def: UnitDef, star: number): string {
  if (def.summonOnly) return SUMMON_FRAME.inner;
  if (def.noStar) return EGG_FRAME.body;
  return (STAR_FRAME[Math.max(1, Math.min(3, Math.round(star)))] ?? STAR_FRAME[1]!).body;
}
/** 彩蛋卡面底色渐变的停靠点（drawUnitCard 要用；测试也能直接钉住"是多色"） */
export function eggBodyStops(): ReadonlyArray<readonly [number, string]> {
  return EGG_BODY_STOPS;
}

/**
 * 星星的颜色：**暗红**（你要求的）。
 *
 * 【为什么从金色改成暗红？】
 * 卡面底色现在跟着星级走（3 星是金黄），
 * 金色的星星压在同一档金色的底上会糊成一片。
 * 暗红在三档金属色上都是强对比，而且和红色的血条、暗色的战场也协调。
 *
 * 描边仍然是近黑 —— 深色棋盘上全靠这道描边把星星"抠"出来，
 * 只有暗红填充的话会糊在背景里。
 */
const STAR_FILL = '#a01818';
const STAR_OUTLINE = 'rgba(0, 0, 0, 0.9)';
const STAR_GLOW = 'rgba(190, 30, 30, 0.8)';
const STAR_FONT = 'bold 23px system-ui, sans-serif';
/** 星星在卡面坐标系里的位置（和搬到独立图层之前完全一致，只是换了图层） */
const STAR_BASELINE_X = 14;
const STAR_BASELINE_Y = 27;
const STAR_STEP = 22;

/** 导出给测试：钉住"星星是暗红"这条 */
export const STAR_COLOR = { fill: STAR_FILL, outline: STAR_OUTLINE, glow: STAR_GLOW };

/**
 * 给测试和调试用的：某张卡的外框配色 + 血条颜色。
 *
 * 【为什么要把这两个颜色暴露出来？】
 * 它们是在 canvas 上画出来的，jsdom 里没有真正的 canvas，
 * "画上去的颜色对不对"没法直接从像素上验。
 * 但"选的颜色对不对"是纯逻辑 —— 抽成函数就能钉死：
 *   1 星铜、2 星银、3 星金；我方绿、敌方红、血少了也不变色。
 * 以后想改配色，改这里一处，测试会跟着告诉你有没有改坏。
 */
export function cardColorsFor(
  def: UnitDef,
  star: number,
  mine: boolean,
): { frameEdge: string; frameInner: string; hpBar: string } {
  const frame = frameOf(def, star);
  return { frameEdge: frame.edge, frameInner: frame.inner, hpBar: hpBarColorFor(mine) };
}

/** 我方血条绿、敌方血条红（视角已经翻转好了，所以这里 team 就是"是不是我"） */
const HP_FILL_MINE = '#3ddc84';
const HP_FILL_ENEMY = '#ff5a5a';

/** 我方血条的绿色（导出给测试和界面复用） */
export const MY_HP_COLOR = HP_FILL_MINE;
/** 敌方血条的红色 */
export const ENEMY_HP_COLOR = HP_FILL_ENEMY;

/** 血条颜色：我方绿、敌方红（**不随血量百分比变化**，这是你要求的） */
export function hpBarColorFor(mine: boolean): string {
  return mine ? HP_FILL_MINE : HP_FILL_ENEMY;
}

/** 血条贴图的画布尺寸：比条子本身高一点，留出发光的余量（否则会被裁成直边） */
const HP_BAR_CANVAS_W = CARD_W;
const HP_BAR_CANVAS_H = HP_BAR_AREA.h + HP_BAR_AREA.pad * 2;

/**
 * 画一张血条贴图（透明底，上面只有那一条）。
 *
 * 【为什么血条要单独一张贴图，而不是画在卡面上？】
 * 因为卡片在小人**后面**（小人被往前推了 DEPTH_EPSILON 好盖住卡面的大色块）。
 * 血条画在卡面上的话，放大后的小人腿脚会把它挡掉一半 ——
 * 你反馈的"血条看不见"就是这个原因。
 * 现在血条是独立精灵、renderOrder 最高，一定压在最上面（见 RENDER_ORDER_HP）。
 *
 * 【为什么还要描边 + 高光？】
 * 0.0.2 追加需求第 2 条要求"卡面信息更明显"。
 * 半透明背景 + 各种地砖色底下，纯色条子会糊；一圈亮描边 + 顶部高光
 * 能让它在任何底色上都立得住，而且一眼看出还剩多少。
 */
function drawHpBar(canvas: HTMLCanvasElement | undefined, ratio: number, mine: boolean): HTMLCanvasElement {
  const target = canvas ?? document.createElement('canvas');
  target.width = HP_BAR_CANVAS_W;
  target.height = HP_BAR_CANVAS_H;
  const ctx = target.getContext('2d')!;
  ctx.clearRect(0, 0, target.width, target.height);

  const x = HP_BAR_AREA.x;
  const y = HP_BAR_AREA.pad;
  const w = HP_BAR_AREA.w;
  const h = HP_BAR_AREA.h;
  const slotR = Math.round(h / 3);

  // ---- 底槽：深色 ----------
  ctx.fillStyle = 'rgba(6, 9, 16, 0.94)';
  roundRect(ctx, x - 2, y - 2, w + 4, h + 4, slotR + 2);
  ctx.fill();

  const clamped = Math.max(0, Math.min(1, ratio));
  const innerX = x + 3;
  const innerY = y + 3;
  const innerW = w - 6;
  const innerH = h - 6;
  const innerR = Math.max(2, Math.round(innerH / 3));

  if (clamped > 0) {
    /*
      ★ 颜色只跟"这棋子是谁的"有关，**不随血量变红**（你要求的）。
      以前是"血少了变黄再变红"，但那和"敌方是红的"撞了颜色 ——
      一场混战里根本分不清"这个红条是敌人"还是"我自己的残血"。
      现在：我方恒绿、敌方恒红，血多血少一眼看长度就够了。
    */
    const fill = mine ? HP_FILL_MINE : HP_FILL_ENEMY;
    // 留一点点最小宽度，不然 1% 血会变成"没有条"（看着像已经死了）
    const fillW = Math.max(innerR, innerW * clamped);

    ctx.save();
    ctx.shadowColor = fill;
    ctx.shadowBlur = 8;
    ctx.fillStyle = fill;
    roundRect(ctx, innerX, innerY, fillW, innerH, innerR);
    ctx.fill();
    ctx.restore();

    // 顶部高光：让条子看起来是有厚度的液体，而不是一块塑料
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    roundRect(ctx, innerX, innerY, fillW, Math.max(2, innerH * 0.4), innerR);
    ctx.fill();

    // 残血加一层暗角：仍然看得出"危险"，但不改主色
    if (clamped <= 0.3) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      roundRect(ctx, innerX, innerY, fillW, innerH, innerR);
      ctx.fill();
    }
  }

  // ---- 外层亮描边：这是"看得清"的关键 ----------
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 2;
  roundRect(ctx, x - 2, y - 2, w + 4, h + 4, slotR + 2);
  ctx.stroke();

  return target;
}

/**
 * ============================================================
 *  ★ 0.1.4：技能条（血条下面那条细的）
 * ============================================================
 *
 * 【三种样子，底槽一律灰色】
 *   · `idle`     蓝 —— 技能攒到多少了（法力 / 满蓝）
 *   · `duration` 红 —— 限时技能生效中，随剩余时间退
 *   · `charges`  橙 —— "接下来 N 次攻击"生效中，每攻击一次退一截
 *
 * 【为什么不做敌我区分？】
 * 血条必须区分（我方绿 / 敌方红，"这是谁"一眼要看得出来），
 * 而技能条说的是"这个棋子的技能状态"——蓝/红/橙本身就是三种状态，
 * 再按敌我换色就变成六种，反而认不出来。所以全场同一套配色。
 *
 * 【为什么缓存键里没有 mine？】
 * 同上：颜色只跟状态有关，跟"这棋子是谁的"无关 —— 缓存只有 3×21 张。
 */
/*
  ★ 0.1.4 配色（第二版：整体调深）
  【为什么第一版不清不楚？】
  技能条只有 9px 高（填充区 5px），第一版用的是「亮蓝 / 亮红 / 亮橙」——
  在深色地板上、再叠一层白色顶部高光，整体被冲淡成"一条浅色带子"，
  远看和血条糊在一起，认不出是哪种状态。
  改成**饱和但更深的底色**（深蓝 / 正红 / 深橙）之后，即使只有几像素也能一眼分辨，
  而且深红和敌方血条那个亮红（#ff5a5a）也彻底区分开了。
*/
const SKILL_FILL_IDLE = '#1b5fc4';
const SKILL_FILL_DURATION = '#d32b23';
const SKILL_FILL_CHARGES = '#dd7a0a';
/** 底槽：需求指定"灰色"（血条那条是近黑的深槽，技能条按需求用灰的） */
const SKILL_SLOT = 'rgba(122, 130, 145, 0.95)';

/** 导出给测试和界面复用（详情页如果也想跟着变色，读这三个） */
export const SKILL_BAR_COLORS = {
  idle: SKILL_FILL_IDLE,
  duration: SKILL_FILL_DURATION,
  charges: SKILL_FILL_CHARGES,
  slot: SKILL_SLOT,
};

/** 技能条画布尺寸：宽度做满卡片宽（横向换算就是 1），高度 = 条高 + 上下留白 */
const SKILL_BAR_CANVAS_W = CARD_W;
const SKILL_BAR_CANVAS_H = SKILL_BAR_AREA.h + SKILL_BAR_AREA.pad * 2;

/**
 * 画一张技能条贴图（透明底，上面只有那一条）。
 *
 * 结构照抄血条那张（底槽 + 填充 + 顶部高光 + 白色描边）——
 * 两条叠在一起时观感才是一套的，而且半透明棋盘底色上都能立得住。
 */
function drawSkillBar(
  canvas: HTMLCanvasElement | undefined,
  ratio: number,
  mode: SkillBarMode,
): HTMLCanvasElement {
  const target = canvas ?? document.createElement('canvas');
  target.width = SKILL_BAR_CANVAS_W;
  target.height = SKILL_BAR_CANVAS_H;
  const ctx = target.getContext('2d')!;
  ctx.clearRect(0, 0, target.width, target.height);

  const x = SKILL_BAR_AREA.x;
  const y = SKILL_BAR_AREA.pad;
  const w = SKILL_BAR_AREA.w;
  const h = SKILL_BAR_AREA.h;
  const slotR = Math.round(h / 2.4);

  // ---- 底槽：灰色（需求指定）----
  ctx.fillStyle = SKILL_SLOT;
  roundRect(ctx, x - 1, y - 1, w + 2, h + 2, slotR + 1);
  ctx.fill();

  const clamped = Math.max(0, Math.min(1, ratio));
  const innerX = x + 2;
  const innerY = y + 2;
  const innerW = w - 4;
  const innerH = h - 4;
  const innerR = Math.max(2, Math.round(innerH / 2.4));

  if (clamped > 0) {
    const fill =
      mode === 'duration' ? SKILL_FILL_DURATION : mode === 'charges' ? SKILL_FILL_CHARGES : SKILL_FILL_IDLE;
    // 留一点点最小宽度：技能还剩一丝的时候不该看成"已经完全没了"
    const fillW = Math.max(innerR, innerW * clamped);

    ctx.save();
    ctx.shadowColor = fill;
    ctx.shadowBlur = 6;
    ctx.fillStyle = fill;
    roundRect(ctx, innerX, innerY, fillW, innerH, innerR);
    ctx.fill();
    ctx.restore();

    /*
      顶部高光比血条那层**淡一半**（0.16 vs 0.32）：
      技能条只有几像素高，高光一强整条就白花花的，把深色又冲回去了。
    */
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    roundRect(ctx, innerX, innerY, fillW, Math.max(1, innerH * 0.38), innerR);
    ctx.fill();
  }

  // ---- 描边：它比血条细，靠一圈亮边才在深色地板上看得清 ----
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, x - 1, y - 1, w + 2, h + 2, slotR + 1);
  ctx.stroke();

  return target;
}

/**
 * 技能条贴图的缓存。
 *
 * 键 = 「模式 + 进度档」：进度按 5% 一档（21 档，和血条同一套口径），
 * 三种模式一共 63 张，全场共享。
 */
const skillBarTextureCache = new Map<string, Texture>();

function getSkillBarTexture(mode: SkillBarMode, ratio: number): Texture {
  const bucket = Math.round(Math.max(0, Math.min(1, ratio)) * 20); // 0..20
  const key = `${mode}|${bucket}`;
  const cached = skillBarTextureCache.get(key);
  if (cached) return cached;

  const canvas = drawSkillBar(undefined, bucket / 20, mode);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace; // ★ 见 getUnitTexture 的说明（否则颜色被冲淡）
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  skillBarTextureCache.set(key, texture);
  return texture;
}

/**
 * 技能条精灵在**卡片本地坐标系**里的摆放。
 *
 * 和血条、藏品圆点、星级走的是**同一套换算**（`sprite.center` 而不是 `position`）——
 * 原因见 hpBarLocalTransform 上面那段长注释：
 * 子节点的 position 是世界坐标偏移，会被相机俯角压扁、还会被透视横向推偏。
 */
export function skillBarLocalTransform(): { cx: number; cy: number; sx: number; sy: number } {
  const sy = SKILL_BAR_CANVAS_H / CARD_H;
  const f = (SKILL_BAR_AREA.y + SKILL_BAR_AREA.h / 2) / CARD_H;
  return { cx: 0.5, cy: 0.5 + (f - 0.5) / sy, sx: SKILL_BAR_CANVAS_W / CARD_W, sy };
}

/** 技能条贴图尺寸（导出给测试） */
export const SKILL_BAR_CANVAS_SIZE = { w: SKILL_BAR_CANVAS_W, h: SKILL_BAR_CANVAS_H };

/** 建一张技能条小精灵（**默认隐藏**：布阵 / 测试沙盒里不该出现技能条，等战斗自己去点亮） */
function createSkillBarSprite(): Sprite {
  const t = skillBarLocalTransform();
  const material = new SpriteMaterial({
    map: getSkillBarTexture('idle', 0),
    transparent: true,
    depthWrite: false,
    opacity: 1, // ★ 恒为 1：技能状态是信息，不许被任何"整体压淡"影响
  });
  const sprite = new Sprite(material);
  sprite.scale.set(t.sx, t.sy, 1);
  sprite.center.set(t.cx, t.cy);
  // z 和血条同层（上下并排、不互相遮挡）；压在小人之上
  sprite.position.set(0, 0, 0.008);
  sprite.renderOrder = RENDER_ORDER_SKILL_BAR;
  sprite.visible = false;
  return sprite;
}

/**
 * 设置某个精灵上的技能条。
 *
 * @param state `null` = 这条卡**不画技能条**（纯被动干员，或者已经阵亡）。
 *
 * 【去重】模式 + 进度档都没变就直接 return ——
 * 贴图是按档位共享的，换个引用没有任何意义，而战斗里这个函数每帧都会被调。
 */
export function setUnitSkillBar(sprite: Sprite, state: SkillBarState | null): void {
  const data = sprite.userData as UnitSpriteData;
  if (!data.skillSprite) return;

  if (!state) {
    if (data.skillBarKey !== null) {
      data.skillBarKey = null;
      data.skillSprite.visible = false;
    }
    return;
  }

  const bucket = Math.round(Math.max(0, Math.min(1, state.ratio)) * 20);
  const key = `${state.mode}|${bucket}`;
  data.skillSprite.visible = true;
  if (data.skillBarKey === key) return;
  data.skillBarKey = key;
  const material = data.skillSprite.material as SpriteMaterial;
  material.map = getSkillBarTexture(state.mode, bucket / 20);
  material.needsUpdate = true;
}

/**
 * 取（或建）一张血条贴图。血量按 5% 一档缓存，和卡面同一套口径。
 */
function getHpTexture(ratio: number, mine: boolean): Texture {
  const bucket = Math.round(Math.max(0, Math.min(1, ratio)) * 20); // 0..20
  const key = `${mine ? 'm' : 'e'}|${bucket}`;
  const cached = hpTextureCache.get(key);
  if (cached) return cached;

  const canvas = drawHpBar(undefined, bucket / 20, mine);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace; // ★ 见 getUnitTexture 的说明（否则颜色被冲淡）
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  hpTextureCache.set(key, texture);
  return texture;
}

/**
 * 血条精灵在**卡片本地坐标系**里的摆放。
 *
 * 【★★ 为什么是 `center` 而不是 `position`？—— 这里踩过一个很隐蔽的坑 ★★】
 *
 * 血条是小人的兄弟、都是**卡片精灵的子节点**。子节点的 `position` 是
 * **世界坐标系**里的偏移，而卡片精灵本身是一个 1×1 的 billboard：
 *
 *   · 卡片的**大小**（屏幕上多高）来自它自己的 scale，是**视图空间**里的尺寸；
 *   · 子节点的**位置偏移**却是世界空间的 —— 相机俯角会把它在屏幕上压扁。
 *
 * 实测（相机俯角约 65°）：世界竖直偏移只有约 **42%** 变成屏幕竖直位移，
 * 而且透视还会把它整体往一边推（偏右 20px 上下）。
 * 于是"血条放在卡片高度 86% 处"这种算法，屏幕上落到的却是 65% ——
 * 也就是你反馈的"血条压在小人腰上、和小人打架"。
 *
 * 正确做法：把位置交给 `sprite.center`。
 * three.js 的 sprite 顶点着色器里，`center` 的偏移是
 * `alignedPosition = (position.xy - (center - 0.5)) * scale`，
 * 这一项是**加在视图空间**上的（`mvPosition.xy += alignedPosition`），
 * 所以它**不受俯角压扁、也不产生横向漂移**，正好是"卡片高度的百分之几"。
 * 代价：sprite 的原点仍然留在卡片中心（世界位置不变），
 * 射线拾取拿到的格子依然是这张卡片的格子，逻辑不受影响。
 *
 * 【这些数字怎么来的？】
 *   · 宽：血条画布和卡片一样宽（CARD_W）→ 比例 1，横向居中 → cx = 0.5
 *   · 高：血条画布 / 卡片高 = sy
 *   · 纵向：希望血条画布的**竖直中点**落在卡片像素 y = HP_BAR_AREA.y + h/2 处，
 *     即"卡片高度"的 f = (y + h/2) / CARD_H。
 *     center 偏移的单位是"卡片高度的 1/sy 分之一"…… 直接解方程：
 *       视图空间偏移（以卡片高度为单位） = (0.5 - cy) * sy
 *       希望它等于 (0.5 - f)（向上为正）
 *       ⇒ cy = 0.5 + (f - 0.5) / sy
 *
 * 单独抽出来是因为这段换算是"像素 → 比例 → center"的经典易错点，
 * 写错了不会报错、只会错位。
 *
 * 导出是为了让单元测试能钉住这个换算（jsdom 没有真 canvas，画不出来但算得出来）。
 */
export function hpBarLocalTransform(): { cx: number; cy: number; sx: number; sy: number } {
  const sy = HP_BAR_CANVAS_H / CARD_H;
  const f = (HP_BAR_AREA.y + HP_BAR_AREA.h / 2) / CARD_H;
  return { cx: 0.5, cy: 0.5 + (f - 0.5) / sy, sx: HP_BAR_CANVAS_W / CARD_W, sy };
}

/** 血条画布的高度（导出给测试用，和精灵缩放是同一个数） */
export const HP_BAR_CANVAS_SIZE = { w: HP_BAR_CANVAS_W, h: HP_BAR_CANVAS_H };

/**
 * ============================================================
 *  ★ 藏品小圆点（0.0.3）
 * ============================================================
 *
 * 需求原文：「在血条左侧加两个显示小圆圈，有装备显示为绿色，未装备显示为灰色」。
 *
 * 【为什么是独立精灵，不画进卡面或血条？】
 *   1. 画进卡面 —— 小人被往前推了 DEPTH_EPSILON 专门盖住卡面，
 *      而这一排圆点正好在卡面最下沿，会被小人的腿脚挡掉（和血条当年一个下场）；
 *   2. 画进血条那张贴图 —— 血条的缓存键是「血量档位 + 敌我」，一共 42 张；
 *      再乘 3 种圆点状态（0/1/2 件）就是 126 张，而且"血量变了"会顺手重画圆点，
 *      两件毫不相干的事被绑在一起了。
 * 所以独立成第三张小精灵：贴图只有 3 张（0 / 1 / 2 件），全场共享。
 *
 * 【层级】和血条同一层（RENDER_ORDER_HP）—— 两者并排、互不遮挡，
 * 都比小人高就行；再往上一层留给星级。
 */
const ITEM_DOT_ON = '#3ddc84';
const ITEM_DOT_OFF = '#59616e';
/** 圆点的描边（深色）：棋盘底色深浅不一，没有描边的话灰点会糊进地板里 */
const ITEM_DOT_OUTLINE = 'rgba(8, 11, 18, 0.9)';

/** 导出给测试和界面用（界面上的藏品格也用这两个颜色，保持"绿=有 / 灰=无"一致） */
export const ITEM_DOT_COLORS = { on: ITEM_DOT_ON, off: ITEM_DOT_OFF };

/**
 * 圆点贴图的画布尺寸。
 *
 * 【为什么宽度做满 CARD_W，而不是"只框住两个圆点"？】
 * 和星级贴图同一个理由（见 STAR_AREA 的说明）：
 * 画布做满卡片宽 → 横向缩放就是 1、横向居中就是 0.5，
 * 少一层"像素 → 比例"的换算，少一个写错的机会。
 * 代价只有 192×36 的小图 3 张。
 *
 * 【高度为什么和血条画布一样？】
 * 这样"竖直中点落在卡片高度百分之几"（f）和血条**完全相同**，
 * 两边的摆放公式一模一样 —— 只要有一边写错，测试就能发现两个中心对不上。
 */
const ITEM_DOT_CANVAS_W = CARD_W;
const ITEM_DOT_CANVAS_H = HP_BAR_CANVAS_H;

/**
 * 圆点精灵在**卡片本地坐标系**里的摆放。
 *
 * 和血条/星级同一套换算（走 `sprite.center`）——
 * 原因见 hpBarLocalTransform 上面那段长注释：
 * 子节点的 `position` 是世界坐标偏移，会被相机俯角压扁、还会被透视横向推偏。
 *
 * 因为画布宽度做满卡片宽（sx = 1、cx = 0.5），这里的横向摆放就是"和卡片同宽同对齐"，
 * 圆点**画在画布的哪个 x** 就直接等于卡片上的 x —— 不再需要额外的横向换算。
 *
 * 导出是为了让测试能钉住这个换算（jsdom 没有真 canvas，画不出来但算得出来）。
 */
export function itemDotsLocalTransform(): { cx: number; cy: number; sx: number; sy: number } {
  const sy = ITEM_DOT_CANVAS_H / CARD_H;
  const f = (ITEM_DOTS_AREA.y + ITEM_DOTS_AREA.h / 2) / CARD_H;
  return { cx: 0.5, cy: 0.5 + (f - 0.5) / sy, sx: ITEM_DOT_CANVAS_W / CARD_W, sy };
}

/** 圆点贴图尺寸（导出给测试） */
export const ITEM_DOT_CANVAS_SIZE = { w: ITEM_DOT_CANVAS_W, h: ITEM_DOT_CANVAS_H };

/**
 * 画一张"只有收藏品圆点"的透明贴图。
 *
 * @param worn 已经装了几件 A 类藏品（0..ITEM_DOT_COUNT）。
 *   前 `worn` 个画成绿色（已装备），剩下的画成灰色（空槽）。
 *
 * 【为什么恒画满 ITEM_DOT_COUNT 个？】
 * 因为"还剩几个槽"本身就是信息 —— 只画绿点的话，
 * "装了 1 件"和"装了 2 件"看起来一样多，还得去数。
 */
function drawItemDots(canvas: HTMLCanvasElement | undefined, worn: number): HTMLCanvasElement {
  const target = canvas ?? document.createElement('canvas');
  target.width = ITEM_DOT_CANVAS_W;
  target.height = ITEM_DOT_CANVAS_H;
  const ctx = target.getContext('2d')!;
  ctx.clearRect(0, 0, target.width, target.height);

  const lit = Math.max(0, Math.min(ITEM_DOT_COUNT, Math.round(worn)));
  const radius = ITEM_DOT_SIZE / 2;
  // 竖直居中（画布 y=0 对应卡片 y = ITEM_DOTS_AREA.y - pad，见摆放换算）
  const cy = ITEM_DOTS_AREA.h / 2;

  for (let i = 0; i < ITEM_DOT_COUNT; i++) {
    const cx = ITEM_DOTS_AREA.x + i * (ITEM_DOT_SIZE + ITEM_DOT_GAP) + radius;
    const on = i < lit;

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    if (on) {
      // 绿点带一点发光：小圆点在深色棋盘上本来就小，发光能帮它"跳"出来
      ctx.save();
      ctx.shadowColor = ITEM_DOT_ON;
      ctx.shadowBlur = 7;
      ctx.fillStyle = ITEM_DOT_ON;
      ctx.fill();
      ctx.restore();
    } else {
      ctx.fillStyle = ITEM_DOT_OFF;
      ctx.fill();
    }
    ctx.lineWidth = 2;
    ctx.strokeStyle = ITEM_DOT_OUTLINE;
    ctx.stroke();
  }

  return target;
}

/**
 * 缓存：藏品圆点贴图。
 *
 * 只有 3 档（0 / 1 / 2 件），和棋子是谁、敌我、血量都无关 ——
 * 全场共享这 3 张图（和星级贴图同一套思路）。
 * 注意**不做敌我区分**：绿=有、灰=无，和"这棋子是谁的"没关系。
 */
const itemDotTextureCache = new Map<number, Texture>();

function getItemDotTexture(worn: number): Texture {
  const key = Math.max(0, Math.min(ITEM_DOT_COUNT, Math.round(worn)));
  const cached = itemDotTextureCache.get(key);
  if (cached) return cached;

  const canvas = drawItemDots(undefined, key);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace; // ★ 见 getUnitTexture 的说明（否则颜色被冲淡）
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  itemDotTextureCache.set(key, texture);
  return texture;
}

/** 建一张藏品圆点小精灵 */
function createItemDotSprite(worn: number): Sprite {
  const t = itemDotsLocalTransform();
  const material = new SpriteMaterial({
    map: getItemDotTexture(worn),
    transparent: true,
    depthWrite: false,
    opacity: 1, // ★ 恒为 1：圆点是"有没有装备"的信息，不许被整体压淡
  });
  const dotSprite = new Sprite(material);
  dotSprite.scale.set(t.sx, t.sy, 1);
  // ★ 用 center 摆位置（视图空间偏移）—— 见 itemDotsLocalTransform 的说明
  dotSprite.center.set(t.cx, t.cy);
  // z 和血条同层（并排、不互相遮挡）；压在小人之上
  dotSprite.position.set(0, 0, 0.008);
  dotSprite.renderOrder = RENDER_ORDER_HP;
  return dotSprite;
}

/**
 * 更新某个精灵身上的藏品圆点（装了 / 卸了 / 换人之后调）。
 *
 * 【为什么要单独一个函数，不塞进 updateUnitSprite？】
 * 因为 `updateUnitSprite` 的入参是"血量 + 战斗状态"，
 * 而这两样在**布阵阶段根本不叫这个名**（布阵时没有血量、也没有战斗状态）。
 * 装备数量是**另一个维度**的信息：布阵、战斗、看别人棋盘三条路都要能设置它，
 * 硬塞进 updateUnitSprite 的话，布阵那两条路就得伪造一个 hpPercent 才能调它。
 *
 * 【去重】数量没变就直接 return（贴图是按数量共享的，换引用没意义）。
 */
export function setUnitItemDots(sprite: Sprite, worn: number): void {
  const data = sprite.userData as UnitSpriteData;
  const count = Math.max(0, Math.min(ITEM_DOT_COUNT, Math.round(worn)));
  if (data.itemDots === count) return;
  data.itemDots = count;
  if (!data.itemDotSprite) return;
  const material = data.itemDotSprite.material as SpriteMaterial;
  material.map = getItemDotTexture(count);
  material.needsUpdate = true;
}

/**
 * ★ 野怪 / 召唤物的卡片上**没有**装备圆点。
 *
 *   · 召唤物不可能被装备；
 *   · 野怪**不能**穿戴装备（0.0.3 需求）—— 不挂的话血条左边就是干净的，
 *     不会一直摆着两个"灰色空位"误导人以为还能给它装点什么。
 *
 * 和星级精灵（syncStarSprite）是同一套思路："按 def 决定这张卡片挂不挂某张精灵"。
 */
function canShowItemDots(def: UnitDef): boolean {
  return !def.summonOnly && !def.monsterOnly;
}

/**
 * ★ 0.2：这只棋子的卡面要不要画血条。
 *
 * 【唯一判据，两处共用】`createUnitSprite`（新建精灵）和
 * `restyleUnitSprite`（精灵被复用给另一个棋子）都必须问这一个函数 ——
 * 分头写两个条件的话，"干员 → 望的棋子"换人之后血条会留在卡面上。
 *
 * 【为什么不画？】望的「棋子」只有 1 点血、还不可被选中（是"踩上去就炸的地雷"），
 * 挂一条永远是满格的血条只会让玩家以为它能扛几下。数据里用 `hideHpBar` 标记。
 */
export function canShowHpBar(def: UnitDef): boolean {
  return def.hideHpBar !== true;
}

/**
 * 换人（restyle）时把装备圆点精灵挂上 / 摘掉。
 *
 * 【为什么要挂在 restyle 里？】
 * 和星级精灵同一个理由：卡片精灵是**复用**的。星级那边有 `syncStarSprite`
 * 负责挂/摘，装备圆点如果没有这一步，"干员 → 野怪"之后卡面上会一直留着两个灰圈。
 * create 那边走的是同一个判据（canShowItemDots），两处不会走散。
 */
function syncItemDotSprite(sprite: Sprite, def: UnitDef): void {
  const data = sprite.userData as UnitSpriteData;
  if (canShowItemDots(def)) {
    if (!data.itemDotSprite) {
      const dotSprite = createItemDotSprite(0);
      sprite.add(dotSprite);
      data.itemDotSprite = dotSprite;
      data.itemDots = 0;
    }
    return;
  }
  if (data.itemDotSprite) {
    sprite.remove(data.itemDotSprite);
    // 只 dispose 材质；贴图是按件数全局共享的缓存（见 itemDotTextureCache），不能跟着销毁
    data.itemDotSprite.material.dispose();
    data.itemDotSprite = undefined;
    data.itemDots = 0;
  }
}

/**
 * 造一根"裸"的血条精灵（还没挂到卡面上）。
 *
 * 位置/尺寸一律走 `hpBarLocalTransform()` —— 那是"卡片像素 → sprite.center"
 * 换算的唯一出处（原因写在它上面：position 是世界空间偏移，会被相机俯角压扁）。
 */
function createHpBarSprite(mine: boolean): Sprite {
  const t = hpBarLocalTransform();
  const material = new SpriteMaterial({
    map: getHpTexture(1, mine),
    transparent: true,
    depthWrite: false,
    opacity: 1, // ★ 恒为 1：血条不许被任何"整体压淡"影响
  });
  const sprite = new Sprite(material);
  sprite.scale.set(t.sx, t.sy, 1);
  // ★ 用 center 摆位置（视图空间偏移），原点留在卡片中心 —— 见上面的长注释
  sprite.center.set(t.cx, t.cy);
  // z 比小人更大 = 更靠近相机；renderOrder 也更高，双保险（斜视角下也不会错）
  sprite.position.set(0, 0, 0.008);
  sprite.renderOrder = RENDER_ORDER_HP;
  return sprite;
}

/**
 * 按 def 挂上 / 摘掉血条精灵。
 *
 * ★ 和 `syncItemDotSprite` 同一套做法、同一个理由：卡片精灵是**复用**的，
 * "干员 → 望的棋子"换人之后没人摘血条，卡面上就会留着一根满格的条。
 * 判据只有 `canShowHpBar()` 一处（create 与 restyle 都走这个函数）。
 */
function syncHpBarSprite(sprite: Sprite, def: UnitDef): void {
  const data = sprite.userData as UnitSpriteData;
  if (canShowHpBar(def)) {
    if (!data.hpSprite) {
      const hpSprite = createHpBarSprite(data.mine ?? true);
      sprite.add(hpSprite);
      data.hpSprite = hpSprite;
      // 强制让下一次 updateUnitSprite 重画一次贴图（新建时是"满格"那张）
      data.hpBucket = -1;
    }
    return;
  }
  if (data.hpSprite) {
    sprite.remove(data.hpSprite);
    // 只 dispose 材质；贴图按 (血量档, 我/敌) 全局缓存共享，不能跟着销毁
    (data.hpSprite.material as SpriteMaterial).dispose();
    data.hpSprite = undefined;
    data.hpBucket = -1;
  }
}

/** 星级贴图的画布尺寸（就是 STAR_AREA 的宽高） */
const STAR_CANVAS_W = STAR_AREA.w;
const STAR_CANVAS_H = STAR_AREA.h;

/**
 * 星级精灵在**卡片本地坐标系**里的摆放。
 *
 * 和血条同一套换算（`sprite.center`，不是 `position`）——原因见
 * hpBarLocalTransform 上面那段长注释：子节点的 position 是世界坐标偏移，
 * 会被相机俯角在屏幕上压扁、还会被透视横向推偏。
 *
 * 【这些数字怎么来的？】
 *   · 宽：画布宽度 = CARD_W → 比例 1，横向居中 → cx = 0.5（和血条一样）
 *   · 高：画布高 / 卡片高 = sy
 *   · 纵向：想让画布**竖直中点**（也就是星星那一行的中心）落在卡片像素
 *     y = STAR_AREA.y + h/2 处，即卡片高度的 f。
 *     解 (0.5 - cy) * sy = 0.5 - f  ⇒  cy = 0.5 + (f - 0.5) / sy
 *
 * 导出是为了让测试能钉住这个换算（jsdom 没有真 canvas，画不出来但算得出来）。
 */
export function starLocalTransform(): { cx: number; cy: number; sx: number; sy: number } {
  const sy = STAR_CANVAS_H / CARD_H;
  const f = (STAR_AREA.y + STAR_AREA.h / 2) / CARD_H;
  return { cx: 0.5, cy: 0.5 + (f - 0.5) / sy, sx: STAR_CANVAS_W / CARD_W, sy };
}

/** 星级贴图尺寸（导出给测试） */
export const STAR_CANVAS_SIZE = { w: STAR_CANVAS_W, h: STAR_CANVAS_H };

/**
 * 画一张"只有星星"的透明贴图。
 *
 * 【为什么从卡面贴图里搬出来？】（0.0.2 追加需求第 1 条：星级置顶）
 * 星级原来画在卡面贴图的右上角，但小人被往前推了 DEPTH_EPSILON 专门盖住卡面 ——
 * 于是小人的头肩正好把星星挡掉，三星看着和两星一样。
 * 抽成独立精灵 + 最高 renderOrder（RENDER_ORDER_STARS）之后，
 * 星星稳定压在小人、血条之上。
 *
 * 【坐标系】贴图就是卡片上边那条（STAR_AREA），
 * 所以画的坐标和原来在卡面上的坐标完全一致 —— 屏幕位置不变，只换图层。
 */
function drawStars(canvas: HTMLCanvasElement | undefined, star: number): HTMLCanvasElement {
  const target = canvas ?? document.createElement('canvas');
  target.width = STAR_CANVAS_W;
  target.height = STAR_CANVAS_H;
  const ctx = target.getContext('2d')!;
  ctx.clearRect(0, 0, STAR_CANVAS_W, STAR_CANVAS_H);

  ctx.save();
  ctx.font = STAR_FONT;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 4;
  ctx.strokeStyle = STAR_OUTLINE;
  ctx.shadowColor = STAR_GLOW;
  ctx.shadowBlur = 9;
  ctx.fillStyle = STAR_FILL;
  for (let i = 0; i < star; i++) {
    const x = CARD_W - STAR_BASELINE_X - i * STAR_STEP - STAR_AREA.x;
    const y = STAR_BASELINE_Y - STAR_AREA.y;
    // 先描黑边再填色：深色棋盘上全靠这道描边把星星抠出来
    ctx.strokeText('★', x, y);
    ctx.fillText('★', x, y);
  }
  ctx.restore();
  return target;
}

/**
 * 缓存：星级贴图。
 *
 * 只有 3 档（1/2/3 星），且和棋子是谁完全无关 —— 全场所有棋子共享这 3 张图。
 * 所以它不该混进按 `棋子|星级|状态` 建的卡面缓存里。
 */
const starTextureCache = new Map<number, Texture>();

function getStarTexture(star: number): Texture {
  const clamped = Math.max(1, Math.min(3, Math.round(star)));
  const cached = starTextureCache.get(clamped);
  if (cached) return cached;

  const canvas = drawStars(undefined, clamped);
  const texture = new CanvasTexture(canvas);
  /*
    ★ 必须标 sRGB（见 getUnitTexture 里的长注释）：
    不标的话颜色会被多编码一遍，暗红会变成"发灰的砖红"。
  */
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  starTextureCache.set(clamped, texture);
  return texture;
}

/** 缓存：卡面贴图（背景 + 边框 + 星级 + 名字 + 特质）。同一只棋子同一状态只画一次 */
const textureCache = new Map<string, Texture>();

/**
 * 缓存：血条贴图。
 *
 * 【为什么要单独一份？】
 * 血条现在是独立精灵（见 HP_BAR_AREA 的说明），而它**只跟血量档位 + 我方/敌方有关**，
 * 和棋子是谁、几星、身上有什么状态都无关 ——
 * 所以它是全局共享的：全场 50 个棋子最多也就 21 档 × 2 队 = 42 张小图。
 * 放进卡面那个缓存里的话，每个棋子每种状态都要各存一份血条，纯属浪费。
 */
const hpTextureCache = new Map<string, Texture>();

/** 把十六进制颜色调亮或调暗，用于生成渐变 */
function shade(hex: string, amount: number): string {
  const value = hex.replace('#', '');
  const r = Math.max(0, Math.min(255, parseInt(value.slice(0, 2), 16) + amount));
  const g = Math.max(0, Math.min(255, parseInt(value.slice(2, 4), 16) + amount));
  const b = Math.max(0, Math.min(255, parseInt(value.slice(4, 6), 16) + amount));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * 把图片按「等比缩放 + 居中裁剪」画进指定矩形。
 *
 * 【为什么不用 ctx.drawImage(img, x, y, w, h) 直接拉伸？】
 * 因为那样会把立绘拉变形 —— 素材比例和卡片区域比例几乎不会刚好一致。
 * 正确做法是：按比例放大到「刚好覆盖」整个区域，超出的部分裁掉。
 * 这叫 cover，和 CSS 的 background-size: cover 一个意思。
 */
function drawImageCover(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const imageRatio = image.width / image.height;
  const targetRatio = w / h;

  let drawW: number;
  let drawH: number;
  if (imageRatio > targetRatio) {
    // 素材更宽 -> 按高度铺满，左右裁掉
    drawH = h;
    drawW = h * imageRatio;
  } else {
    // 素材更高 -> 按宽度铺满，上下裁掉
    drawW = w;
    drawH = w / imageRatio;
  }

  ctx.drawImage(image, x + (w - drawW) / 2, y + (h - drawH) / 2, drawW, drawH);
}

/** 圆角矩形路径（Canvas 没有内置的） */
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
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
 * 把状态特效半透明地画在卡面上。
 *
 * 【设计上的两个取舍】
 * 1. **不盖住整张卡，只盖立绘区域**。整张盖住会把名字、费用、血条都染上一层颜色，
 *    反而看不清关键信息（血条是最重要的）。
 * 2. **颜色 + 图标两重编码**。只靠颜色的话，色弱玩家分不清；
 *    所以每种状态还有一个小图标，形状本身就能区分。
 *
 * @param area 立绘区域（效果只画在这块里）
 */
function drawEffectOverlay(
  ctx: CanvasRenderingContext2D,
  effects: UnitEffectFlags,
  area: { x: number; y: number; w: number; h: number },
): void {
  const anyEffect = effects.shield || effects.attackSpeed || effects.attackDamage || effects.stun;
  if (!anyEffect) return;

  // ---- 1) 半透明色罩 ----
  // 多种状态同时存在时按顺序叠加，颜色会自然混出来（比如"有盾 + 被加速"偏青紫）
  const tints: Array<{ on: boolean; color: string; alpha: number }> = [
    { on: effects.shield, color: '#4ad9ff', alpha: 0.22 },
    { on: effects.attackSpeed, color: '#ff7ad9', alpha: 0.16 },
    { on: effects.attackDamage, color: '#ffb347', alpha: 0.16 },
    { on: effects.stun, color: '#ffe34a', alpha: 0.3 },
  ];
  ctx.save();
  roundRect(ctx, area.x, area.y, area.w, area.h, 8);
  ctx.clip();
  for (const tint of tints) {
    if (!tint.on) continue;
    ctx.globalAlpha = tint.alpha;
    ctx.fillStyle = tint.color;
  ctx.fillRect(area.x, area.y, area.w, area.h);
  }
  ctx.globalAlpha = 1;

  // 护盾额外加一圈内描边：护盾的语义是"外面有一层东西"，描边比纯色更能表达
  if (effects.shield) {
    ctx.strokeStyle = 'rgba(120, 230, 255, 0.85)';
    ctx.lineWidth = 3;
    roundRect(ctx, area.x + 2, area.y + 2, area.w - 4, area.h - 4, 7);
    ctx.stroke();
  }
  if (effects.stun) {
    // 眩晕：一圈虚线，像"打转"的感觉
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = 'rgba(255, 227, 74, 0.9)';
    ctx.lineWidth = 3;
    roundRect(ctx, area.x + 2, area.y + 2, area.w - 4, area.h - 4, 7);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();

  // ---- 2) 图标：排在立绘上方一行，形状本身就能区分状态 ----
  const glyphs: Array<{ on: boolean; kind: 'shield' | 'haste' | 'power' | 'stun' | 'evade'; color: string }> = [
    { on: effects.shield, kind: 'shield', color: '#7fe6ff' },
    { on: effects.attackSpeed, kind: 'haste', color: '#ff9fe4' },
    { on: effects.attackDamage, kind: 'power', color: '#ffc86b' },
    { on: effects.stun, kind: 'stun', color: '#ffe34a' },
    { on: effects.evade, kind: 'evade', color: '#c9d4e4' },
  ];
  const shown = glyphs.filter((glyph) => glyph.on);
  const size = 26;
  const gap = 4;
  const totalW = shown.length * size + (shown.length - 1) * gap;
  let x = area.x + (area.w - totalW) / 2;
  const y = area.y + 4;

  for (const glyph of shown) {
    // 图标底衬（深色圆角块），保证图标在亮色立绘上也看得清
    ctx.fillStyle = 'rgba(8, 12, 20, 0.72)';
    roundRect(ctx, x, y, size, size, 6);
    ctx.fill();
    ctx.strokeStyle = glyph.color;
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, size, size, 6);
    ctx.stroke();
    drawEffectGlyph(ctx, glyph.kind, x + size / 2, y + size / 2, size * 0.62, glyph.color);
    x += size + gap;
  }
}

/** 状态图标：全部用基本图形画出来（不依赖任何外部素材） */
function drawEffectGlyph(
  ctx: CanvasRenderingContext2D,
  kind: 'shield' | 'haste' | 'power' | 'stun' | 'evade',
  cx: number,
  cy: number,
  size: number,
  color: string,
): void {
  const half = size / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = color;

  switch (kind) {
    case 'shield': {
      // 盾牌：上方矩形 + 下方收尖
      ctx.beginPath();
      ctx.moveTo(-half, -half);
      ctx.lineTo(half, -half);
      ctx.lineTo(half, half * 0.1);
      ctx.quadraticCurveTo(half, half, 0, half);
      ctx.quadraticCurveTo(-half, half, -half, half * 0.1);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'haste': {
      // 闪电：两个折角
      ctx.beginPath();
      ctx.moveTo(half * 0.25, -half);
      ctx.lineTo(-half * 0.55, half * 0.1);
      ctx.lineTo(-half * 0.05, half * 0.1);
      ctx.lineTo(-half * 0.25, half);
      ctx.lineTo(half * 0.55, -half * 0.1);
      ctx.lineTo(half * 0.05, -half * 0.1);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'power': {
      // 向上的箭头
      ctx.beginPath();
      ctx.moveTo(0, -half);
      ctx.lineTo(half * 0.8, 0);
      ctx.lineTo(half * 0.32, 0);
      ctx.lineTo(half * 0.32, half);
      ctx.lineTo(-half * 0.32, half);
      ctx.lineTo(-half * 0.32, 0);
      ctx.lineTo(-half * 0.8, 0);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'stun': {
      // 眩晕：三颗小星星（其实就是三个四角星）
      for (const angle of [-Math.PI / 2, Math.PI / 6, (Math.PI * 5) / 6]) {
        const px = Math.cos(angle) * half * 0.6;
        const py = Math.sin(angle) * half * 0.6;
        const r = half * 0.42;
        ctx.beginPath();
        ctx.moveTo(px, py - r);
        ctx.lineTo(px + r * 0.3, py - r * 0.3);
        ctx.lineTo(px + r, py);
        ctx.lineTo(px + r * 0.3, py + r * 0.3);
        ctx.lineTo(px, py + r);
        ctx.lineTo(px - r * 0.3, py + r * 0.3);
        ctx.lineTo(px - r, py);
        ctx.lineTo(px - r * 0.3, py - r * 0.3);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'evade': {
      // 闪避：两道弧线（像"嗖"地闪开），和别的图标形状完全不同
      ctx.lineWidth = Math.max(2, size * 0.14);
      ctx.strokeStyle = color;
      for (const offset of [-half * 0.35, half * 0.35]) {
        ctx.beginPath();
        ctx.arc(offset, 0, half * 0.55, Math.PI * 0.75, Math.PI * 1.25);
        ctx.stroke();
      }
      break;
    }
  }
  ctx.restore();
}

/**
 * 画一张棋子卡片。
 *
 * @param def         棋子定义（提供颜色、名字、费用）
 * @param star        星级 1/2/3，会在卡片上画星星
 * @param team        0 = 自己（蓝框），1 = 对手（红框）
 * @param effects     当前身上的状态（护盾/加速/加攻/眩晕），画成半透明特效
 * @param canvas      复用的画布。**状态特效变化时会重画同一张画布**，
 *                    所以不能每次都 new 一个新的（那样纹理换不过来、还会漏内存）
 * @param blankPortrait 立绘区要不要**留空**。只有"这只棋子的小人真的播起来了"
 *                    才留空（小人是另一张精灵，画了立绘会透出两个人）。
 *
 *                    【★ 这个参数就是"干员模型丢失"的防线】
 *                    以前这里传的是 `hasChibi(def)` —— 只看"有没有素材"就敢留空，
 *                    小人加载一旦失败（素材包不全 / 网络抖一下），小人永远出不来，
 *                    立绘区又是空的 → **画面上就是一格空白**。
 *                    现在调用方一律先画立绘（false），等 chibi 的 onReady 回调
 *                    真的到了才换 true —— 最坏情况是"小人变半身像"，绝不是空白。
 */
function drawUnitCard(
  def: UnitDef,
  star: number,
  team: 0 | 1,
  effects: UnitEffectFlags = NO_EFFECTS,
  canvas?: HTMLCanvasElement,
  blankPortrait = false,
): HTMLCanvasElement {
  const target = canvas ?? document.createElement('canvas');
  target.width = CARD_W;
  target.height = CARD_H;
  const ctx = target.getContext('2d')!;

  // 每帧重画时必须先清干净，否则上一帧的小人会"叠影"
  ctx.clearRect(0, 0, CARD_W, CARD_H);

  /*
    ★★ 0.0.3 野怪：**没有卡面** ★★

    【你要的】"野怪棋子不需要后面的卡面背景和星级，只有模型和血条"。

    所以这里直接交一张**全透明**的画布 —— 尺寸仍然是 CARD_W×CARD_H，
    因为小人和血条的位置都是按这张卡的像素坐标算的（见 hpBarLocalTransform），
    画布尺寸变小会让它们全部错位。

    好处是不用改任何别的代码：卡面精灵照常创建、照常挂子节点，
    只是它渲染出来是空的；小人和血条该在哪还在哪。
  */
  /*
    ★ 0.1.1：`noCard` 的棋子（炎佑）走同一条路 ——
    它在设计稿里点名"不要背景卡片"，但**不是**野怪：有羁绊、能吃光环、
    卡框这一条只是碰巧和野怪一样。两个标记分开，改一边不会带到另一边。
  */
  if (def.monsterOnly === true || def.noCard === true) return target;

  const frame = frameOf(def, star);
  /**
   * 包边宽度。
   * 【为什么从 5px 加到 7px、又加到 9px？】
   * 你反馈"星级描边不够明显"。棋子在世界里只有 0.72 世界单位宽，
   * 卡面 192px 映射到屏幕上大概 40~80 个像素 —— 5px 的边只剩 1~2 个屏幕像素，
   * 确实看不出颜色差别。加到 7px 之后至少有 3 个屏幕像素，颜色才立得住；
   * 0.0.2 追加需求又要"星级显示更明显"，再加到 9px。
   */
  const FRAME_W = 9;

  /*
    最外圈：一圈近黑的硬描边。
    【为什么先垫这一层？】
    卡片背景现在是半透明的，后面透出来的是棋盘地砖，深浅不定 ——
    直接画彩色包边的话，"银边压在浅色地砖上"几乎看不出边界。
    垫一层近黑的轮廓，卡片在任何底色上都有明确的形状。
  */
  ctx.fillStyle = 'rgba(6, 9, 16, 0.92)';
  roundRect(ctx, 0, 0, CARD_W, CARD_H, 15);
  ctx.fill();

  // --- 外框：★ 按星级上色（1 铜 / 2 银 / 3 金）；彩蛋棋子用浅蓝淡紫炫彩 ---
  if (def.noStar) {
    const eggEdge = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
    for (const [pos, color] of EGG_EDGE_STOPS) eggEdge.addColorStop(pos, color);
    ctx.fillStyle = eggEdge;
  } else {
    ctx.fillStyle = frame.edge;
  }
  roundRect(ctx, 1.5, 1.5, CARD_W - 3, CARD_H - 3, 14);
  ctx.fill();
  /*
    金属感：外框用"斜向渐变"而不是纯色。
    纯色看起来像贴了一条胶带，有明暗过渡才像金属边。
  */
  const metal = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
  if (def.noStar) {
    // 彩蛋：同一条炫彩，整体提亮一点 —— 内圈比外圈亮才有"镶边"的层次
    for (const [pos, color] of EGG_EDGE_STOPS) metal.addColorStop(pos, shade(color, 20));
  } else {
    metal.addColorStop(0, shade(frame.inner, 46));
    metal.addColorStop(0.35, frame.inner);
    metal.addColorStop(0.6, shade(frame.inner, -38));
    metal.addColorStop(1, shade(frame.inner, 30));
  }
  ctx.fillStyle = metal;
  roundRect(ctx, 1.5, 1.5, CARD_W - 3, CARD_H - 3, 13);
  ctx.fill();

  /*
    ★ 一点点光泽（你要求的）：左上角一道斜向高光扫过边框。
    做法是一段半透明白色渐变盖在边框上、只保留边框那一圈（用 clip 挖掉内芯）。
    加得很淡（最亮 0.28）—— 太亮会盖掉星级颜色，反而更看不清是哪一档。
  */
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, CARD_W, CARD_H);
  roundRect(ctx, FRAME_W + 1, FRAME_W + 1, CARD_W - (FRAME_W + 1) * 2, CARD_H - (FRAME_W + 1) * 2, 11);
  ctx.clip('evenodd');
  const gloss = ctx.createLinearGradient(0, 0, CARD_W * 0.75, CARD_H * 0.75);
  gloss.addColorStop(0, 'rgba(255,255,255,0.30)');
  gloss.addColorStop(0.45, 'rgba(255,255,255,0.05)');
  gloss.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gloss;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.restore();

  /*
    --- 卡片底：从"星级金属色"渐变到深色，做出体积感 ---

    ★ 0.0.2 追加需求第 3 条：卡面颜色跟星级走（1 暗铜 / 2 银 / 3 金）。
    以前这里用的是 `def.color`（按定位区分的颜色），
    结果"这张卡是什么定位"和"这张卡几星"两套配色打架，
    而棋盘上真正需要一眼看出的信息是**星级**。
    定位色没有丢 —— 商店/备战席/详情面板那些 2D 界面仍然用它。

    ★ 这一层就是"背景"，也是**唯一**被调淡的东西。
    用 globalAlpha 而不是给颜色加透明通道：渐变本来就有好几个 stop，
    逐个换算 rgba 更容易出错，而且以后改配色还要记得同步。
  */
  const bodyColor = cardBodyColorFor(def, star);
  const gradient = ctx.createLinearGradient(0, 0, 0, CARD_H);
  if (def.noStar) {
    // ★ 彩蛋：多色标来回过渡 = "炫彩"。见 EGG_BODY_STOPS 的说明
    for (const [pos, color] of EGG_BODY_STOPS) gradient.addColorStop(pos, color);
  } else {
    gradient.addColorStop(0, shade(bodyColor, 40));
    gradient.addColorStop(0.55, bodyColor);
    gradient.addColorStop(1, shade(bodyColor, -70));
  }
  ctx.save();
  ctx.globalAlpha = CARD_BODY_ALPHA;
  ctx.fillStyle = gradient;
  roundRect(ctx, FRAME_W + 1, FRAME_W + 1, CARD_W - (FRAME_W + 1) * 2, CARD_H - (FRAME_W + 1) * 2, 11);
  ctx.fill();
  ctx.restore();

  // --- 内层高光，让卡片看起来是凸的（跟着背景一起淡，不算"信息层"）---
  ctx.save();
  ctx.globalAlpha = CARD_BODY_ALPHA + 0.1;
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 2;
  roundRect(ctx, FRAME_W + 3, FRAME_W + 3, CARD_W - (FRAME_W + 3) * 2, CARD_H - (FRAME_W + 3) * 2, 9);
  ctx.stroke();
  ctx.restore();

  // 队伍的区分靠血条（下方），所以边框不再画队伍色 —— 见 STAR_FRAME 的说明
  void team;

  /*
    --- 角色立绘：有真素材就画素材，没有就画占位 ---

    这块是「美术」和「程序」的接缝，说明一下：
      头像（正方形）    apps/web/public/assets/units/<棋子id>.png
      立绘（竖长半身像）apps/web/public/assets/stand/<棋子id>.png
    程序启动时会把它们预加载好，这里同步取（见 assets.ts）

    【为什么优先用半身像？】
    棋子在棋盘上是"站着"的：半身像是 180×360 的竖构图，贴上去像立绘；
    方形头像会被裁成一个方贴片，没有立绘感。
    没下半身像时自动退回头像，再没有就画程序化占位图 —— 三级降级，永远不会空。

    【★ 0.0.2 追加需求第 6 条：召唤物也要用真素材】
    以前召唤物一律走"空白卡面"（见下面那个分支），因为当时一张图都没有。
    现在给召唤物也放了立绘（迷迭香的战术装备 / 望的棋子），
    所以把判断顺序改成：**先看有没有 Q 版小人，再看有没有立绘，最后才轮到"空白占位"**。
    这样召唤物一旦有图就自动显示，而没图的召唤物仍然保持"空白卡面"这个明确信号。
  */
  const portrait = getLoadedImage(unitStandPath(def.id)) ?? getLoadedImage(unitSpritePath(def.id));

  // 卡片上预留的立绘区域（上方 ~56%，下面留给名字和血条）。
  // 用模块常量而不是就地写死 —— chibi.ts 要靠同一个数算小人站位。
  const portraitArea = PORTRAIT_AREA;

  if (blankPortrait) {
    /*
      --- 有 Q 版小人的棋子：立绘区留空，只铺一层柔和的底 ---

      【为什么留空？】
      小人是**另一张精灵**，挂在卡片精灵的上层（见 three/chibi.ts），
      所以这张卡片贴图上不能画半身像 —— 否则小人旁边会透出半身像，等于两个人在同一个框里。

      留空不等于什么都不画：铺一层暗色圆角底 + 一圈微光，
      小人的透明边缘才有"站在光里"的感觉，而不是浮在白框上。
    */
    const back = ctx.createRadialGradient(
      PORTRAIT_AREA.x + PORTRAIT_AREA.w / 2,
      PORTRAIT_AREA.y + PORTRAIT_AREA.h * 0.62,
      8,
      PORTRAIT_AREA.x + PORTRAIT_AREA.w / 2,
      PORTRAIT_AREA.y + PORTRAIT_AREA.h * 0.62,
      PORTRAIT_AREA.w * 0.72,
    );
    back.addColorStop(0, 'rgba(255,255,255,0.16)');
    back.addColorStop(0.55, 'rgba(255,255,255,0.05)');
    back.addColorStop(1, 'rgba(0,0,0,0.22)');
    ctx.save();
    roundRect(ctx, PORTRAIT_AREA.x, PORTRAIT_AREA.y, PORTRAIT_AREA.w, PORTRAIT_AREA.h, 8);
    ctx.fillStyle = back;
    ctx.fill();
    ctx.restore();
  } else if (portrait) {
    // 按「等比缩放 + 居中裁剪」把立绘填满预留区域，
    // 这样不管素材是什么尺寸、什么比例，都不会被拉变形
    ctx.save();
    roundRect(ctx, portraitArea.x, portraitArea.y, portraitArea.w, portraitArea.h, 8);
    ctx.clip();
    drawImageCover(ctx, portrait, portraitArea.x, portraitArea.y, portraitArea.w, portraitArea.h);
    ctx.restore();
  } else if (def.summonOnly) {
    // --- 召唤物且没有任何图：一张**空白卡面** ---
    // 「召唤类技能，先用空白卡面进行代替，但功能写好」。
    // 所以这里不画任何立绘，只画一个空框 + 虚线边 + 中间一个淡淡的名字，
    // 一眼就能看出"这是占位，不是漏了图"。
    ctx.fillStyle = 'rgba(12,14,22,0.72)';
    roundRect(ctx, portraitArea.x, portraitArea.y, portraitArea.w, portraitArea.h, 8);
    ctx.fill();
    ctx.save();
    ctx.setLineDash([7, 5]);
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 2;
    roundRect(ctx, portraitArea.x + 5, portraitArea.y + 5, portraitArea.w - 10, portraitArea.h - 10, 6);
    ctx.stroke();
    ctx.restore();
    ctx.font = '16px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('召唤物', CARD_W / 2, portraitArea.y + portraitArea.h / 2);
  } else {
    // --- 占位：一个简单的圆形「脸」+ 两眼 ---
    const faceY = 84;
    ctx.fillStyle = shade(def.color, 70);
    ctx.beginPath();
    ctx.arc(CARD_W / 2, faceY, 42, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(20,20,30,0.85)';
    ctx.beginPath();
    ctx.arc(CARD_W / 2 - 15, faceY - 6, 6, 0, Math.PI * 2);
    ctx.arc(CARD_W / 2 + 15, faceY - 6, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  {
    // 立绘底部加一层渐变，让它和下面的名字区域自然过渡（不然会有硬边）
    const fade = ctx.createLinearGradient(
      0,
      portraitArea.y + portraitArea.h * 0.62,
      0,
      portraitArea.y + portraitArea.h,
    );
    fade.addColorStop(0, 'rgba(0,0,0,0)');
    fade.addColorStop(1, 'rgba(10,12,20,0.85)');
    ctx.fillStyle = fade;
    roundRect(ctx, portraitArea.x, portraitArea.y, portraitArea.w, portraitArea.h, 8);
    ctx.fill();
  }

  // --- 状态特效：半透明地盖在卡面上（见文件顶部 UnitEffectFlags 的说明） ---
  drawEffectOverlay(ctx, effects, portraitArea);

  // --- 费用（左上角圆形徽章）。召唤物没有费用，改画一个"召"字 ---
  ctx.fillStyle = '#12131c';
  ctx.beginPath();
  ctx.arc(26, 26, 19, 0, Math.PI * 2);
  ctx.fill();
  // 徽章描边：和星级包边同色系，混在一起也不会糊成一团
  ctx.strokeStyle = def.summonOnly ? 'rgba(159, 208, 255, 0.85)' : 'rgba(255, 215, 94, 0.85)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(26, 26, 19, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = def.summonOnly ? '#9fd0ff' : '#ffd75e';
  ctx.font = def.summonOnly ? 'bold 18px system-ui, sans-serif' : 'bold 25px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(def.summonOnly ? '召' : String(def.cost), 26, 27);

  // --- 召唤物不升星，画一个"召"的来源提示（这条留在卡面上，不是星级）---
  if (def.summonOnly) {
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText('技能生成', CARD_W - 12, 27);
  }
  /*
    ★ 正式干员的星级**不再画在这里**（0.0.2 追加需求第 1 条：星级置顶）。
    原因：小人被往前推了 DEPTH_EPSILON 专门盖住卡面的大色块，
    画在卡面上的星星正好被它的头肩挡掉 —— "三星看起来和两星一样"。
    现在星星是独立精灵、renderOrder 最高，见 drawStars / RENDER_ORDER_STARS。
  */

  /*
    --- 名字和特质**不画了**（0.0.2 追加需求）---

    【为什么删掉？】
    它们被小人模型整个盖住了 —— 名字原来画在 y=172、特质在 y=197，
    而小人被放大到几乎填满一格（CHIBI_WORLD_H = 0.98），脚底又落在卡面
    87.5% 高度的地方，那两行字正好在小人的身体后面。
    也就是说：**画了也看不见，只是白费一次 canvas 文字渲染**
    （每只棋子每种状态都要重画一遍，50 个棋子的文本渲染不是零成本）。

    想认干员是谁，看小人本身或者点开详情面板就行；棋盘上不需要这两行。

    --- 血条也不在这里画（0.0.2 追加需求第 1 条）---
    血条现在是**独立的一张小精灵**，浮在小人模型之上（见 createUnitSprite 里的 hpSprite）。
    这里画一份的话会和小人抢图层：小人往前推了 DEPTH_EPSILON，会把卡片上的血条盖住。

    所以卡片贴图现在只剩：**背景 + 边框 + 费用徽章**。
    星级是独立精灵（drawStars），血条是独立精灵（drawHpBar）。
  */

  return target;
}

/** 缓存别无限涨：棋子种类 × 3 星 × 状态组合 ≈ 最多一千多张，够用了 */
const MAX_CACHE_ENTRIES = 2000;

/**
 * 清空贴图缓存。
 *
 * 【什么时候需要？】
 * 立绘是异步加载的：游戏启动时先用占位图把棋子画出来，
 * 等真立绘下载完，需要把已缓存的卡片作废、重画一遍 ——
 * 不然屏幕上还是会显示旧的占位图。
 * 所以素材加载完成后要调一次这个，再重新生成棋子。
 */
export function clearUnitTextureCache(): void {
  textureCache.clear();
  hpTextureCache.clear();
  starTextureCache.clear();
  itemDotTextureCache.clear();
}

/**
 * 取卡面贴图的缓存键。
 *
 * 【★ 血量为什么**不再**进 key？】（0.0.2 追加需求第 1 条）
 * 血条已经搬到独立精灵上了，卡面贴图和血量一点关系都没有。
 * 以前每个棋子要按 21 档血量各存一份内容完全相同的卡面 —— 纯浪费显存，
 * 现在同一只棋子同一状态只存一份。
 *
 * 【★ 立绘区留空与否必须进 key】
 * 同一只棋子有"带立绘"和"立绘区留空（给小人让位）"两张不同的贴图。
 * 以前这个区别用 `hasChibi(def)` 算 —— 那是**素材有没有**，不是**小人播起来没有**，
 * 两者之间隔着一次异步加载，加载失败时两者必须不同（留空 = 空白一格）。
 * 现在由调用方显式传入（来自 chibi 的 onReady / onFailed 回调）。
 */
function textureKey(def: UnitDef, star: number, effects: UnitEffectFlags, blankPortrait: boolean): string {
  // 缓存 key 要区分"用了半身像还是头像"，否则只下了头像时
  // 先画了占位图、后面素材到了也不会重画
  const hasStand = getLoadedImage(unitStandPath(def.id)) ? 'stand' : '';
  const hasPortrait = `${hasStand}${getLoadedImage(unitSpritePath(def.id)) ? 'img' : 'gen'}`;
  return `${def.id}|${star}|${blankPortrait ? 'chibi' : 'portrait'}|${hasPortrait}|${effectKeyOf(effects)}`;
}

/**
 * 取得（或创建）一张**卡面**贴图（不含血条，血条是独立的一张小图）。
 *
 * @param blankPortrait 立绘区留空（小人已经播起来了）。缺省 false = 画立绘。
 *
 * 【为什么还留着 team / mine 两个参数？】
 * 它们对卡面已经不起作用了（队伍由血条颜色表达、边框由星级表达），
 * 但调用点都是按"这是哪一队的棋子"来组织的，留着让调用处读起来更直白。
 */
export function getUnitTexture(
  def: UnitDef,
  star: number,
  team: 0 | 1,
  effects: UnitEffectFlags = NO_EFFECTS,
  blankPortrait = false,
): Texture {
  const key = textureKey(def, star, effects, blankPortrait);

  const cached = textureCache.get(key);
  if (cached) return cached;

  const canvas = drawUnitCard(def, star, team, effects, undefined, blankPortrait);
  const texture = new CanvasTexture(canvas);
  /*
    ★★ 必须标成 sRGB，否则整张卡面的颜色会被"冲淡"（你反馈的"偏灰"就是它）★★

    【为什么？】
    three.js r152 之后开启了颜色管理：
      · 渲染器的 outputColorSpace 默认是 SRGBColorSpace —— 最后会把**线性**颜色编码成 sRGB；
      · 纹理的 colorSpace 默认是 NoColorSpace —— 采样时**不做** sRGB→线性 解码。
    我们的卡面/血条/小人都是用 canvas 画的 **sRGB 数据**（`#3ddc84` 这类颜色就是 sRGB）。
    把它当线性数据用，最后又被编码一次，等于**多编码了一遍**：
    每个通道 c 变成 sRGB(c) = c^(1/2.4) 那一侧 —— 整体变亮、变灰、掉饱和度。
    实测：血条 #3ddc84 在屏幕上渲成了 (134,239,190)（应该还是 #3ddc84），
    卡面 1 星铜边 #c8752f 渲成了 (237,191,136) —— 都是这个原因。

    棋盘 / 背景 / 地块的贴图（board.ts、ark-tiles.ts、backdrop.ts）**一直是带 SRGBColorSpace 的**，
    所以只有棋子这一层发灰，和背景放在一起更明显。
  */
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;

  if (textureCache.size > MAX_CACHE_ENTRIES) textureCache.clear();
  textureCache.set(key, texture);
  return texture;
}

/** 棋子精灵自己身上挂的东西（卡面 + 血条 + 状态缓存） */
interface UnitSpriteData {
  defId: string;
  /** 当前挂的干员定义。restyle（换人/升星）时要拿它重画卡面，存一份省得反查表 */
  def: UnitDef;
  star: number;
  team: 0 | 1;
  mine?: boolean;
  /**
   * 小人要不要左右镜像（红方 / 对手 / 野怪 = true）。
   *
   * ★ 判定只有一处：`mirrorFor(mine)`（本文件上面）。**别在调用点另算一遍** ——
   *   布阵棋子、战斗演出、看别人棋盘三条路都得是同一个答案，
   *   分头算迟早出现"布阵时翻着、开打就转回来"这种对不上的画面。
   */
  mirror: boolean;
  hpBucket: number;
  effects?: UnitEffectFlags;
  /**
   * 卡面立绘区现在是不是"留空"的那一版。
   *
   * ★ 永远从 false 出发（先画立绘），等小人真的播起来了才翻成 true ——
   *   翻转的动作在 chibi 的 onReady 回调里。反过来（先留空、失败了再补立绘）
   *   会有一段"空白一格"的窗口期，那就是用户看到的"模型丢失"。
   */
  chibiReady: boolean;
  /** 独立的那条血条精灵（见 RENDER_ORDER_HP） */
  hpSprite?: Sprite;
  /**
   * 独立的那两个藏品圆点精灵（★ 0.0.3，见 itemDotsLocalTransform）。
   * 召唤物和野怪没有（前者不可能被装备，后者**不能**穿戴装备），所以这里是可选的。
   */
  itemDotSprite?: Sprite;
  /**
   * 当前显示的"已装备件数"（0..ITEM_DOT_COUNT）。
   *
   * ★ 有了它，`setUnitItemDots` 才能"没变就跳过"。
   *   undefined = 还没设置过（等价于 0 件）。
   */
  itemDots?: number;
  /** 独立的那张星级精灵（见 RENDER_ORDER_STARS） */
  starSprite?: Sprite;
  /**
   * ★ 0.1.4：血条**下面**那条技能条（见 RENDER_ORDER_SKILL_BAR）。
   *
   * 它**默认不可见**（布阵 / 测试沙盒里没有"技能生效中"这回事，
   * 显示一条空槽纯属干扰），战斗里由 `setUnitSkillBar` 每帧点亮。
   */
  skillSprite?: Sprite;
  /**
   * 技能条当前显示的是什么（`"模式|进度档"`，`null` = 没显示）。
   *
   * ★ 有它才能"没变就跳过"：这个函数战斗里**每帧**都会被调，
   *   而贴图是按 (模式, 5% 档) 全局共享的，没变时换引用毫无意义。
   */
  skillBarKey?: string | null;
}

/** 重画这张精灵的卡面贴图（星级 / 干员 / 留空状态 / 特效变化时的统一出口） */
function applyCardTexture(sprite: Sprite): void {
  const data = sprite.userData as UnitSpriteData;
  const material = sprite.material as SpriteMaterial;
  material.map = getUnitTexture(data.def, data.star, data.team, data.effects ?? NO_EFFECTS, data.chibiReady);
  material.needsUpdate = true;
}

/** 小人素材到位 / 失败时怎么改卡面（create 和 restyle 共用同一套） */
function chibiHooksFor(sprite: Sprite): ChibiHooks {
  return {
    onReady: () => {
      const data = sprite.userData as UnitSpriteData;
      data.chibiReady = true;
      applyCardTexture(sprite);
    },
    onFailed: () => {
      const data = sprite.userData as UnitSpriteData;
      // 失败不翻状态：卡面继续显示立绘。这里兜一手是防"之前 ready 过、后来重挂失败"
      if (data.chibiReady) {
        data.chibiReady = false;
        applyCardTexture(sprite);
      }
    },
  };
}

/**
 * ★ 0.0.3 野怪：**不画星级**。
 *
 * 野怪固定 1 星、不会合成，摆一颗星星只会让人以为"它也能升星"。
 * 召唤物同理（那种"星级"是技能给的，写出来反而误导）。
 * 两个条件收在一个函数里 —— 创建和换人（restyle）两条路都要读它，
 * 分开写迟早漏一条（"换人刚好跨过野怪这条线"就会留下一颗不该有的星星）。
 */
function hasStarBadge(def: UnitDef): boolean {
  // ★ 彩蛋棋子没有星级机制 —— 卡面上也不画星级标记
  return def.summonOnly !== true && def.monsterOnly !== true && def.noStar !== true;
}

/**
 * ★ 0.0.3：棋子的小人要不要**左右镜像**。
 *
 * 【规则只有一条：不是"我方"就镜像】
 * 官方小人素材只有一个朝向（基本都朝右），所以右半场的棋子如果照原样摆，
 * 就是"背对着你、朝着场外"站一排 —— 观感很怪。镜像之后红方面朝左（面朝蓝方），
 * 两军对峙才对。野怪、对手、看别人棋盘时那些棋子，正好都是"不是我方"，
 * 全部落在右半边，一条规则就全覆盖了。
 *
 * 【为什么不按 team 判？】
 * 联机时服务器可能把我分到队伍 1（画面左右翻转，我的棋子显示在左半边）。
 * 那时候"红方"其实是我自己 —— 按 team 判就会把自己的小人翻过去。
 * `mine` 这个量在建立精灵的时候就已经按视角算好了（replay 的 isMine、
 * 布阵的 mine 参数），拿它判永远和"画面上是不是对手那一侧"一致。
 *
 * 导出是为了让单元测试能钉住这条规则（纯逻辑，不需要真 canvas）。
 */
export function mirrorFor(mine: boolean): boolean {
  return !mine;
}

/** 建一张星级小精灵（create 和 restyle 共用；召唤物和野怪没有星级） */
function createStarSprite(star: number): Sprite {
  const st = starLocalTransform();
  const starMaterial = new SpriteMaterial({
    map: getStarTexture(star),
    transparent: true,
    depthWrite: false,
    opacity: 1, // ★ 恒为 1：星级是要一直看清的信息
  });
  const starSprite = new Sprite(starMaterial);
  starSprite.scale.set(st.sx, st.sy, 1);
  // 位置同样走 center（视图空间偏移）—— 见 starLocalTransform 的说明
  starSprite.center.set(st.cx, st.cy);
  // z 比血条还大一点，renderOrder 也最高，双保险（斜视角下也不会错）
  starSprite.position.set(0, 0, 0.009);
  starSprite.renderOrder = RENDER_ORDER_STARS;
  return starSprite;
}

/**
 * 让星级精灵和「当前干员 + 星级」对上（restyle 专用）。
 *
 * 【为什么这么麻烦？】
 * 星级是独立精灵，换人 / 升星时它的贴图要跟着换；而且**召唤物没有星级**——
 * 换人恰好跨过"干员 ↔ 召唤物"这条线时，这张精灵得整个挂上/摘掉，
 * 只换贴图的话会留下一颗不属于它的星星。
 */
function syncStarSprite(sprite: Sprite, def: UnitDef, star: number, changed: boolean): void {
  const data = sprite.userData as UnitSpriteData;
  if (!hasStarBadge(def)) {
    if (data.starSprite) {
      sprite.remove(data.starSprite);
      // 贴图是按星级全局共享的缓存，不能 dispose，只丢引用
      data.starSprite = undefined;
    }
    return;
  }
  if (!data.starSprite) {
    const starSprite = createStarSprite(star);
    sprite.add(starSprite);
    data.starSprite = starSprite;
    return;
  }
  if (!changed) return;
  const material = data.starSprite.material as SpriteMaterial;
  material.map = getStarTexture(star);
  material.needsUpdate = true;
}

/**
 * 换掉一只棋子的"内容"：换干员、升星、换队伍都走这里。
 *
 * 【为什么必须有它？—— 这是"restyled 只改了个寂寞"的修复】
 * 以前布阵同步的 restyled 分支调的是 `updateUnitSprite(sprite, def, 1)`：
 * 那个函数看到"血量档没变、特效没变"就直接 return ——
 * 而 restyle 恰恰这两种都没变，于是**什么都没发生**：
 * 卡面还是上一个干员的、星级精灵还是旧的星、小人还是别人的模型。
 * 对手的阵容每回合都在同一个座位上换人/升星，所以棋盘上的敌方棋子
 * 会一直停留在"它上一次的样子"，看起来就是"模型错乱 / 模型丢失"。
 *
 * 这里把四件事一次做齐：
 *   1. userData 里的 defId / def / star / team 全部更新（后面所有重画都以它为准）；
 *   2. 卡面重画；
 *   3. 星级精灵换贴图（跨召唤物时挂上/摘掉）；
 *   4. 换了干员就拆旧小人、重挂新小人（并先把卡面翻回"带立绘"那版）。
 */
export function restyleUnitSprite(sprite: Sprite, def: UnitDef, star: number, team?: 0 | 1): void {
  const data = sprite.userData as UnitSpriteData;
  const defChanged = data.defId !== def.id;
  const starChanged = data.star !== star;

  data.def = def;
  data.defId = def.id;
  if (team !== undefined) data.team = team;
  data.star = star;

  /*
    ★ 朝向也要跟着重算（0.0.3）。
    同一只棋子换了阵营（看别人棋盘 / 测试沙盒切边）或换了干员时，
    "是不是我方"可能变过 —— 漏了这一步就会出现"换了人但朝向还是旧的"。
  */
  const mirror = mirrorFor(data.mine ?? true);
  const mirrorChanged = data.mirror !== mirror;
  data.mirror = mirror;

  // 换干员：旧小人是别人的模型，必须拆掉；卡面先翻回"带立绘"，等新小人 ready 再留空
  if (defChanged) {
    detachChibi(sprite);
    data.chibiReady = false;
  }

  applyCardTexture(sprite);
  syncStarSprite(sprite, def, star, defChanged || starChanged);
  // 装备圆点也按 def 挂/摘（野怪 / 召唤物没有）—— 和星级精灵同一套做法
  if (defChanged) syncItemDotSprite(sprite, def);
  // ★ 0.2：血条也按 def 挂/摘（望的棋子没有，见 canShowHpBar）
  if (defChanged) syncHpBarSprite(sprite, def);

  if (defChanged) attachChibi(sprite, def, chibiHooksFor(sprite), mirror);
  // 没换干员但朝向变了：小人还是同一个模型，只要把它翻过来（别整个拆了重建）
  else if (mirrorChanged) setChibiMirror(sprite, mirror);
}

/**
 * 更新某个精灵的血条与状态特效（血量或状态变化时调用）。
 *
 * 【为什么"状态没变就直接 return"？】
 * 重画一张 192×256 的卡片要画渐变、圆角、文字、图标 ——
 * 战斗中每帧对 50 个棋子都重画会明显掉帧。
 * 血量和状态都是**离散变化**的（血量按 5% 分档、状态只有"有/没有"），
 * 所以只要这两样都没变就直接跳过，开销接近零。
 *
 * 【★ 0.0.2 追加需求第 1 条之后，这里管两张贴图】
 *   卡面：只在乎"状态特效变没变"（血量已经和它无关）
 *   血条：只在乎"血量档位 / 我方敌方变没变"
 * 分开判、分开换，任何一半没变都不会白重画。
 */
export function updateUnitSprite(
  sprite: Sprite,
  def: UnitDef,
  hpPercent: number,
  effects: UnitEffectFlags = NO_EFFECTS,
): void {
  const data = sprite.userData as UnitSpriteData;
  const bucket = Math.round(hpPercent * 20);
  const effectChanged = !data.effects || !sameEffects(data.effects, effects);
  const hpChanged = bucket !== data.hpBucket;
  if (!hpChanged && !effectChanged) return; // 什么都没变，省性能

  // ---- 血条：独立精灵，永远实色、永远压在小人上面 ----
  if (hpChanged && data.hpSprite) {
    const material = data.hpSprite.material as SpriteMaterial;
    material.map = getHpTexture(bucket / 20, data.mine ?? true);
    material.needsUpdate = true;
  }

  // ---- 卡面：只有状态特效变了才重画（留空状态在 data.chibiReady 里，跟着走） ----
  if (effectChanged) {
    const texture = getUnitTexture(def, data.star, data.team, effects, data.chibiReady);
    const material = sprite.material as SpriteMaterial;
    material.map = texture;
    material.needsUpdate = true;
  }

  data.hpBucket = bucket;
  data.effects = { ...effects };
}

/**
 * 创建一个棋子精灵。
 *
 * Sprite 是 Three.js 里专门用于「永远面朝相机」的平面，
 * 正好符合我们要的「2D 人物站在 3D 场景里」的效果。
 *
 * @param mine 是不是"我方"。只影响血条颜色（我方绿、敌方红）。
 *   注意它和 `team` 是两件事：`team` 是服务器眼里的队伍编号（0/1），
 *   而联机时我被分到哪一队是服务器决定的 —— 所以"我是不是左边那队"
 *   要看视角有没有翻转。别在这里替调用方猜，直接让他传。
 */
export function createUnitSprite(def: UnitDef, star: number, team: 0 | 1, mine = true): Sprite {
  /*
    ★ 卡面一律先画立绘（chibiReady=false）。小人素材是异步的，
    等它真的播起来了 chibi 的 onReady 回调会把卡面换成"立绘区留空"的那一版。
    先留空再等回调的话，加载失败的瞬间画面上就是一格空白（模型"丢失"）。
  */
  const texture = getUnitTexture(def, star, team, NO_EFFECTS, false);
  /*
    ★ 卡片精灵**整体**不再压透明（opacity = 1）。

    【为什么？】（0.0.2 追加需求第 1、2 条）
    第一版是整张卡乘 0.42，结果星级包边、血条、名字全跟着变淡，看不清。
    现在"背景变淡"这件事**画进了贴图里**（见 CARD_BODY_ALPHA），
    所以这里保持 1，一个像素都不再整体压淡。
    CARD_OPACITY 现在只是"拖动结束后恢复成多少"的那个目标值。
  */
  const material = new SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    opacity: CARD_OPACITY,
  });
  const sprite = new Sprite(material);
  // 卡片在最底层（默认就是 0，显式写出来，让"谁压谁"在代码里看得见）
  sprite.renderOrder = RENDER_ORDER_CARD;

  // 卡片世界尺寸：宽 0.72，高 0.96（和 3:4 的比例一致，略微抬高一点显得有厚度）
  sprite.scale.set(CARD_WORLD_SCALE.x, CARD_WORLD_SCALE.y, 1);
  const data: UnitSpriteData = {
    defId: def.id,
    def,
    star,
    team,
    mine,
    mirror: mirrorFor(mine),
    hpBucket: 20,
    effects: { ...NO_EFFECTS },
    chibiReady: false,
  };
  sprite.userData = data;

  /*
    ★ 血条：**独立的一张小精灵**，挂成卡片的子节点。

    【为什么要独立？】（0.0.2 追加需求第 1 条）
    小人精灵被刻意往前推了一点（DEPTH_EPSILON），专门用来盖住卡面的大色块。
    血条如果画在卡面上，就会**被小人的腿脚挡住**。
    独立成精灵 + 更高的 renderOrder，血条就稳定压在小人之上，
    而且它自己不带任何透明（要求：血条的透明度不要降低）。

    【为什么还是挂在卡片下面？】
    和挂小人是同一个理由：受击放大、攻击前倾、死亡缩小这些变换都写在卡片上，
    挂成子节点就自动继承，replay.ts 一行都不用为血条特殊处理。

    【位置怎么算？】
    见 hpBarLocalTransform 的说明 —— 那是"卡片像素 → sprite.center"的换算。
    **注意位置走的是 `center` 不是 `position`**（原因写在那个函数上面，
    一句话：position 是世界空间偏移，会被相机俯角压扁并横向漂移）。
  */
  syncHpBarSprite(sprite, def);

  /*
    ★ 藏品圆点（0.0.3）：血条**左边**那两个小圆圈。

    【为什么挂成子节点？】
    和血条同一套理由：卡片上的受击放大 / 技能脉冲 / 死亡缩小这些变换
    都写在卡片精灵上，挂成子节点就自动继承。
    要是挂在场景根节点上，就得在 replay 里为它单独抄一遍全部变换。

    【召唤物 / 野怪不挂】见 canShowItemDots —— 它们都不可能被装备。
    【初始一律 0 件】真实件数由调用方随后调 `setUnitItemDots` 设置 ——
    布阵棋子读 placement/bench 的 items，战斗演出读 main.ts 传进来的对照表。
    */
  syncItemDotSprite(sprite, def);

  /*
    ★ 0.1.4：技能条 —— 挂在血条**正下方**的第四张小精灵。
    （位置换算见 skillBarLocalTransform；默认隐藏，战斗里由 replay 点亮。）
  */
  const skillSprite = createSkillBarSprite();
  sprite.add(skillSprite);
  data.skillSprite = skillSprite;
  data.skillBarKey = null;

  /*
    ★ 星级：独立精灵，层级**最高**（0.0.2 追加需求第 1 条：星级置顶）。

    【为什么 opacity 恒为 1？】
    和血条同一个道理：星级是**信息**，不该被任何"整体压淡"影响。
    拖动卡片时 main.ts 会把卡片和小人一起淡掉（好让玩家看清落点），
    但血条和星级故意不参与 —— 否则"这是几星"在拖动过程中就丢了。
    这也是"卡面变透明、小人透明度不变"之外的另一条边界。

    【召唤物没有星级】不挂这张图（它卡面上已经有"技能生成"提示）。
  */
  if (hasStarBadge(def)) {
    const starSprite = createStarSprite(star);
    sprite.add(starSprite);
    data.starSprite = starSprite;
  }

  /*
    有官方小人素材的话，把小人作为**子节点**挂上来。
    子节点自动继承卡片的受击放大 / 技能脉冲 / 死亡缩小 / 浮动 / 前倾，
    所以这一句之后 replay.ts 一行都不用为小人特殊处理。
    素材是异步加载的：加载好之前卡面先显示立绘，小人 ready 那一刻
    卡面才换成"立绘区留空"的版本（见 chibiHooksFor）—— 加载失败就一直显示立绘。
  */
  attachChibi(sprite, def, chibiHooksFor(sprite), data.mirror);

  return sprite;
}

/** 从精灵上取回它的元数据（棋子 id、星级、队伍） */
export function getSpriteMeta(sprite: Sprite): { defId: string; star: number; team: 0 | 1 } {
  const data = sprite.userData as { defId: string; star: number; team: 0 | 1 };
  return { defId: data.defId, star: data.star, team: data.team };
}

/**
 * ★ 0.1.4：仅供测试 / 调试 —— 这张卡上的技能条现在是什么状态。
 *
 * 【为什么要有它？】
 * 技能条是画在 canvas 贴图上的（"颜色对不对"没法从像素上验），
 * 但"现在该不该显示、显示的是哪种模式、进度在第几档"是纯逻辑 ——
 * 这几样抽出来就能被断言（和 cardColorsFor / hpBarLocalTransform 同一套思路）。
 *
 * @returns `null` = 这张卡没有技能条精灵；否则 `{visible, key}`，
 *   `key` 形如 `"duration|15"`（模式 + 5% 进度档），`null` = 没显示。
 */
export function getSkillBarDebug(sprite: Sprite): { visible: boolean; key: string | null } | null {
  const data = sprite.userData as UnitSpriteData;
  if (!data.skillSprite) return null;
  return { visible: data.skillSprite.visible, key: data.skillBarKey ?? null };
}

/**
 * 给界面用的「这个棋子有没有真实立绘」查询。
 * 商店卡片靠它决定是显示真图还是占位斜纹。
 */
export { getLoadedImage, unitSpritePath, unitStandPath };
