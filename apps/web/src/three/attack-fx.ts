/**
 * ============================================================
 *  攻击特效（★ 0.1.4）—— 三类单位各一套
 * ============================================================
 *
 * ============================================================
 *  【一、触发时机：和"命中帧"严格对齐】
 * ============================================================
 * 特效在**内核发 `attack` 事件的那一 tick** 生成，也就是"伤害真正结算"的那一刻。
 *
 * 为什么是这个时刻、而不是"小人开始挥"的那一刻？
 * 因为 `three/attack-anim.ts` 已经把挥击动作**提前起手**排好了：
 * 整段动作的 45%（`SWING_HIT_RATIO`）正好落在掉血的那一 tick 上。
 * 所以"在 attack 事件处生成特效" = "特效出现在刀真正打到的那一帧"，
 * 既不用自己算时间，也天然跟着攻速缩放（攻速快 → 命中密 → 特效也密）。
 *
 * ★ 不要用 `setTimeout` / 自己攒计时器去对时机 —— 那会把"确定性"丢掉：
 *   战斗回放是**按 tick 重放事件流**的，特效必须挂在事件流上，
 *   这样"两倍速播放 / 断线重连后从中间接上 / 看录像"全都自动正确。
 *
 * ============================================================
 *  【二、表现效果：三个家族三种"重量"】
 * ============================================================
 * 视觉上要一眼看出"这一下有多重"。三层的组合：
 *   · **贴地弧**（`arcAt`）—— 近战画在**目标**脚下（斩击扫过），
 *     远程画在**攻击者**脚下（枪口闪光）。俯视视角下贴地的弧最容易读。
 *   · **命中爆点**（`burstAt`）—— 小圆点/十字，先冲后收，标出"打中了哪儿"。
 *   · **冲击环**（`ringScale`）—— 只有野怪有：一圈外扩的环，做出"砸在地上"的分量。
 *
 * 于是三类的观感差异是：
 *   · **干员**：轻快 —— 一道弧 + 一个小爆点，0.18 秒收干净；
 *   · **野怪**：沉 —— 更大的弧 + 更大的爆点 + 贴地冲击环，0.26 秒；Boss 再放大一档；
 *   · **召唤物**：虚 —— 整体 0.62 倍大、透明度 0.62、0.13 秒，像"轻轻碰一下"。
 *
 * ============================================================
 *  【三、视觉风格：只用画面里已经有的那几种颜色】
 * ============================================================
 * 整个战斗演出到现在只有这几个颜色，特效**一个都不新增**：
 *   · 我方蓝 `0x8fd0ff` / 敌方红 `0xff9a9a` —— 弹道线用的就是这两个（见 replay 的 spawnTracer）；
 *   · 白色 —— 范围**伤害**（范围框）；
 *   · 绿色 —— 回**血**；
 *   · 金色 —— 技能（`castGlow`）。
 * 所以攻击特效 = **攻方队伍色**（弧与爆点）+ **白色芯**（命中点那一下），
 * 形状一律是"半透明、无光照的几何片"（和弹道线、范围框同一种做法），
 * 不做写实粒子、不贴照片纹理 —— 因为棋子本体是 2D 骨骼动画精灵贴在 3D 棋盘上，
 * 加一层写实粒子会立刻显得"不在一个世界里"。
 *
 * 【时长必须和既有演出同量级】
 * 攻击前倾 `LUNGE_SECONDS = 0.18`、弹道线 `TRACER_SECONDS = 0.16`。
 * 所以攻击特效全部落在 **0.13~0.30 秒** 这一档（见 FX_DURATION_RANGE），
 * 不会出现"人都打完两轮了，上一次的特效还挂在场上"。
 *
 * 【为什么单独一个模块？】
 * 和 `attack-anim.ts` 同样的理由：这些都是**纯计算**（谁重谁轻、多大多快），
 * 抽出来就能直接断言"野怪一定比干员重""召唤物一定最轻""时长都在量级内"，
 * 而不是靠在浏览器里盯着看。
 */

/** 单位家族：三段式动画/特效预设的分界线 */
export type FxFamily = 'operator' | 'monster' | 'summon';

/** 特效挂在哪一方的脚下 */
export type FxAnchor = 'attacker' | 'target' | 'none';

export interface AttackFxPreset {
  family: FxFamily;
  /** 贴地弧（近战=斩击弧 / 远程=枪口闪光）挂在哪 */
  arcAt: FxAnchor;
  /** 命中爆点挂在哪 */
  burstAt: FxAnchor;
  /** 弧的半径倍率（1 = 基准 0.55 世界单位 ≈ 一格边长的一半） */
  arcScale: number;
  /** 爆点的半径倍率（1 = 基准 0.22） */
  burstScale: number;
  /** 冲击环的半径倍率（0 = 不画） */
  ringScale: number;
  /** 整段特效的时长（秒） */
  duration: number;
  /** 透明度倍率（召唤物更"虚"） */
  alpha: number;
}

/** 贴地弧的基准半径（世界单位）。一格边长约 1.0，取半格多一点，压住目标那格 */
export const BASE_ARC_RADIUS = 0.55;
/** 命中爆点的基准半径 */
export const BASE_BURST_RADIUS = 0.22;
/** 冲击环的基准半径（外扩到这个数的 `ringScale` 倍） */
export const BASE_RING_RADIUS = 0.9;

/** 多远算"远程"：和弹道线的阈值是同一个数（`replay.ts` 从这里 import） */
export const RANGED_ATTACK_FROM = 2;

/** 队伍色：**0 = 我方蓝 / 1 = 敌方红**。弹道线用它（细线够亮，直接同色没问题） */
export const FX_TEAM_COLORS = [0x8fd0ff, 0xff9a9a] as const;

/**
 * 攻击特效用的**提亮版**队伍色（近白）。
 *
 * 【为什么要另配一对？—— 真机截图发现的】
 * 棋盘左右半场本身就是蓝 / 红底色（我方半边偏蓝、敌方半边偏红）。
 * 贴地的大型特效如果直接用上面那对原始队伍色，就会出现
 * **"红弧画在红半场上"** —— 对比度极低，远看就是一块糊掉的暖色，
 * 完全读不出那是"一下打击"（第一次跑 e2e 截图就是这个观感）。
 * 所以弧与冲击环改用**提亮到接近白**的同色系：既保住了"谁在打"这个信息，
 * 又能在两种底色上都压得住。命中爆点本来就是纯白（`FX_BURST_COLOR`）。
 */
export const FX_GLOW_COLORS = [0xdcf0ff, 0xffdcdc] as const;

/**
 * 命中爆点的颜色：**白色**。
 * 和「范围伤害画白框」是同一个语义（白 = 伤害，绿 = 回血），
 * 玩家不用读数字就知道"这一下是打我的"。
 */
export const FX_BURST_COLOR = 0xffffff;

/** 贴地弧的张角（弧度）：约 100°，是"扫过去"的那一道，不是一整圈 */
export const ARC_SPAN_RADIANS = Math.PI * 0.56;

/**
 * 弧的内外半径比：留出内圈，看起来像一道刃而不是一块饼。
 *
 * ★ 这个数调过一轮：0.5 的时候整段弧太厚，配上白色爆点整块糊成一团光，
 *   看不出"这一下是挥过去的"。收到 0.62 之后是薄薄一道，形状才读得出来。
 */
export const ARC_INNER_RATIO = 0.62;

/**
 * 贴地弧在存活期间**扫过的角度**（弧度）。
 *
 * 【为什么让它扫？】
 * 静止的一道弧只是"地上亮了一下"；让它从 -0.35 扫到 +0.35 rad（约 40°），
 * 眼睛读到的就是"**有东西挥过去了**"—— 这是"斩击"和"光圈"的区别。
 * 扫动幅度不能大：超过 60° 就会看起来像转盘/雷达。
 */
export const ARC_SWEEP_RADIANS = 0.7;

/**
 * ★ 同屏特效上限。
 *
 * 【为什么必须有？】一张 10×10 的棋盘可以有 20 个棋子互殴，攻速上限是 4 倍
 * （`ATTACK_ANIM_MAX_RATIO`），也就是**每 0.25 秒每人一下** ——
 * 满编对轰时每秒能产出几十个特效。需求清单里提过"20 个棋子 + 技能特效
 * 弱电脑掉到 15fps"，所以这里给一个硬上限，超了就丢掉最老的。
 */
export const MAX_LIVE_ATTACK_FX = 48;

/**
 * 攻击特效的时长区间（秒）。
 * 上限对齐"攻击前倾 0.18 / 弹道线 0.16"这一档；下限保证再快也看得见。
 */
export const FX_DURATION_RANGE = { min: 0.12, max: 0.3 } as const;

/** 判断一个单位属于哪一类（三个家族互斥，见 types.ts 的 summonOnly / monsterOnly） */
export function fxFamilyOf(def: { summonOnly?: boolean; monsterOnly?: boolean }): FxFamily {
  if (def.summonOnly) return 'summon';
  if (def.monsterOnly) return 'monster';
  return 'operator';
}

/** 野怪是不是 Boss —— Boss 的攻击特效再放大一档（它本体就比小怪大一圈） */
function isBoss(def: { monsterTier?: string }): boolean {
  return def.monsterTier === 'boss';
}

/**
 * 取这一只单位这一次攻击该用哪套特效。
 *
 * @param def   单位定义（只需要家族 / 野怪级别这几个字段）
 * @param opts.range 它的攻击距离（≥ `RANGED_ATTACK_FROM` 就走"远处打人"那套）
 */
export function attackFxPresetFor(
  def: { summonOnly?: boolean; monsterOnly?: boolean; monsterTier?: string },
  opts: { range: number },
): AttackFxPreset {
  const family = fxFamilyOf(def);
  const ranged = opts.range >= RANGED_ATTACK_FROM;

  if (family === 'summon') {
    /*
      召唤物：轻。它们在设定上就是"临时凑数的"（战术柱/金狮子/假人/炎佑），
      打出来的分量也该比干员轻一档 —— 更小、更淡、更快收。
    */
    return {
      family,
      arcAt: 'target',
      burstAt: 'target',
      arcScale: 0.62,
      burstScale: 0.7,
      ringScale: 0,
      duration: 0.13,
      alpha: 0.62,
    };
  }

  if (family === 'monster') {
    /*
      野怪：沉。它们是"体格明显大一圈"的敌人，所以三层全给：
      更大的斩击弧 + 更大的爆点 + **贴地冲击环**（这是野怪独有的那一层，
      远看就是"砸在地上"）。
      Boss 再放大一档（本体大约是小领袖的 1.35 倍，见 chibiWorldSize）。
    */
    const boss = isBoss(def);
    const size = boss ? 1.25 : 1;
    return {
      family,
      arcAt: ranged ? 'attacker' : 'target',
      burstAt: 'target',
      arcScale: (ranged ? 1.1 : 1.45) * size,
      burstScale: 1.6 * size,
      ringScale: 1.0 * size,
      duration: Math.min(FX_DURATION_RANGE.max, (ranged ? 0.24 : 0.26) * (boss ? 1.15 : 1)),
      alpha: 1,
    };
  }

  /*
    干员：轻快。
      · 近战 —— 斩击弧**落在目标身上**（"刀扫过去"），配一个小爆点；
      · 远程 —— 弧挪到**攻击者脚下**当枪口闪光，目标那一头交给爆点
        （弹道线本来就已经把"谁打谁"讲清楚了，再往目标身上加弧会糊成一团）。
  */
  return {
    family,
    arcAt: ranged ? 'attacker' : 'target',
    burstAt: 'target',
    // ★ 近战弧调大了一档（1 → 1.15）：收窄之后要更大才读得出那道刃的形状
    arcScale: ranged ? 0.7 : 1.15,
    burstScale: ranged ? 1 : 0.85,
    ringScale: 0,
    duration: ranged ? 0.16 : 0.18,
    alpha: 1,
  };
}

// ============================================================
// 动画曲线（纯函数，渲染层每帧按 progress 取值）
// ============================================================

/** 把 0..1 夹紧（进度可能因浮点误差略微越界） */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * 贴地弧的缩放：**先冲后收**。
 * 前 35% 快速张开到 1.0（"挥出去"），之后缓慢收到 1.12（"余势"）。
 * 不做"缩到 0"这种收尾 —— 弧是**扫过去**的，不是长出来的。
 */
export function arcScaleAt(progress: number): number {
  const t = clamp01(progress);
  const grow = Math.min(1, t / 0.35);
  // 缓出：张开得比线性快一点，看起来更"利落"
  const eased = 1 - (1 - grow) * (1 - grow);
  return 0.72 + eased * 0.28 + t * 0.12;
}

/** 命中爆点：从 0.45 冲到 1.15，剩下的时间慢慢落到 1.0 */
export function burstScaleAt(progress: number): number {
  const t = clamp01(progress);
  if (t < 0.25) return 0.45 + (t / 0.25) * 0.7;
  return 1.15 - ((t - 0.25) / 0.75) * 0.15;
}

/** 冲击环：**匀速外扩**（就像水波，速度恒定才像"冲出去"） */
export function ringScaleAt(progress: number): number {
  return 0.35 + clamp01(progress) * 0.65;
}

/**
 * 贴地弧相对"瞄准方向"的扫动角度（弧度）。
 * 从 -35° 扫到 +35°，让那一下看起来是**挥过去**的，而不是地上亮了一下。
 */
export function arcSweepAt(progress: number): number {
  return (clamp01(progress) - 0.5) * ARC_SWEEP_RADIANS;
}

/**
 * 透明度：前 20% 保持峰值，之后线性淡出到 0。
 *
 * 【为什么要留一开始那 20%？】
 * 因为瞬间出现又瞬间消失的薄片会"闪一下"，像掉帧；
 * 留一个短暂的满亮度段，人眼才读得出"这是一下打击"。
 */
export function fxOpacityAt(progress: number, alpha: number): number {
  const t = clamp01(progress);
  const fade = t < 0.2 ? 1 : 1 - (t - 0.2) / 0.8;
  return Math.max(0, fade) * Math.max(0, Math.min(1, alpha));
}
