/**
 * ============================================================
 *  ★ 0.1.4：干员卡面「技能条」的状态推导
 * ============================================================
 *
 * 【这条东西是什么？】
 * 战斗里每张卡的血条**下面**多一条细的（见 card-layout.ts 的 SKILL_BAR_AREA）：
 *   · 平时            -> **蓝色**，宽度 = 技能攒到多少了（法力 / 满蓝）；
 *   · 技能生效中·按时间 -> **红色**，随剩余时间一格格退；
 *   · 技能生效中·按次数 -> **橙色**，每攻击一次退一截（"接下来 6 次攻击"）。
 * 底槽一律灰色。
 *
 * ============================================================
 *  【为什么这里是个纯函数、而且不碰内核？】
 * ============================================================
 * "这个技能怎么消耗"在内核里**早就有一份权威说法**了 —— `duration.ts`：
 *   · 数据写了 `attacks`       -> 按次数（`count`）
 *   · 数据写了 `durationTicks` -> 按时间（`time`）
 *   · 都没有                   -> 整场 / 一次性
 * 而"此刻还剩多少"这件事，内核也已经每 tick 采进属性时间线里了
 * （`BattleStatsSample.effects` + `stats-timeline.ts` 的 `effectsAt`，
 * 它会按"现在 - 采样时刻"把时间型的往下数、次数型的直接读最新一条）。
 *
 * 所以这里只做两件事：**从技能数据取出总量** + **从实时效果里取出剩余量**，
 * 除一下就完事。一行战斗逻辑都不用改，确定性 / 校验和自然也一个字都不动。
 *
 * 【为什么单独一个文件？】
 * 因为它是纯函数（好测），而 replay.ts 是 three.js 那一层，
 * 单测要拖进 WebGL / DOM 才能跑 —— 和 stats-timeline.ts 同一个理由。
 */
import {
  LIVE_BUFF_EFFECT_KINDS,
  effectDurationOf,
  hasActiveSkill,
  skillVariantOf,
  type EffectDuration,
  type UnitDef,
} from '../../../../packages/shared/src/index.js';

/** 技能条的三种样子。`idle` = 蓝（攒蓝中），另外两种 = 技能生效中 */
export type SkillBarMode = 'idle' | 'duration' | 'charges';

export interface SkillBarState {
  mode: SkillBarMode;
  /** 已填充的比例 0..1 */
  ratio: number;
}

/** 「这个技能怎么消耗」 —— 只有这两种才会在卡面上变成红/橙条 */
export type SkillWindowDuration =
  | { kind: 'count'; left: number }
  | { kind: 'time'; ticksLeft: number };

/**
 * 只需要"这条效果是什么种类 + 还剩多少"两样。
 *
 * 【为什么不用现成的 `ActiveEffect`？】
 * 因为喂进来的东西有两种来源：界面上的 `ActiveEffect`（effectsAt 的产物）和
 * 采样里的紧凑快照 `BattleEffectSample`。用一个结构化的小接口，
 * 两边都塞得进来，这个函数也就更好测（测试里手写两条就行）。
 */
export interface SkillBarEffect {
  kind: string;
  duration?: EffectDuration;
}

/**
 * 修正包类效果的种类名 —— **从内核那一份名单导入，不要在这里自己写**。
 *
 * 【为什么？】（0.1.4 的真实 bug）
 * 这里以前写的是 `new Set(['buff','debuff'])`。0.1.4 加了「弹药」之后，
 * 技能挂的按次数消耗包 kind 变成了 `ammo`，这份名单里没有 ⇒
 * 开完技能的棋子**技能条直接消失**（掉回蓝条，而开完技能蓝条正好清零，
 * 看起来就是"条没了"，其实是"条变蓝了但长度是 0"）。
 *
 * ⇒ 名单的唯一真相是 `status-effects.ts` 的 `LIVE_BUFF_EFFECT_KINDS`。
 */
const BUFF_KINDS = new Set<string>(LIVE_BUFF_EFFECT_KINDS);

/**
 * 这个棋子的技能里，那个"会持续一段时间 / 持续若干次"的增益 —— 取它的总量。
 *
 * 【为什么次数型优先于时间型？】
 * 因为次数型更"具体"：一次技能里同时有"接下来 N 次攻击 +1000%（按次数）"
 * 和"顺便给自己挂个 3 秒攻速"时，卡面上那条更该表现的是前者。
 * 而且 `effectDurationOf` 内部也是次数优先（见 duration.ts 的判据顺序）。
 *
 * @returns 没有这种增益（纯伤害/治疗/被动技能）就返回 null —— 卡面只画蓝条
 */
export function skillWindowDurationOf(def: UnitDef, star: number): SkillWindowDuration | null {
  const variant = skillVariantOf(def, star);
  // battleStart 也要看：玛恩纳那种"开局就开技能"的技能，开局那一刻就已经在生效了
  const all = [...variant.effects, ...(variant.battleStart ?? [])];
  let time: SkillWindowDuration | null = null;
  for (const effect of all) {
    if (effect.kind !== 'buff' && effect.kind !== 'debuff') continue;
    // 星级数组要按这张卡的星级定死（`star` 就是调用方传进来的那个）
    const duration = effectDurationOf(effect, star);
    if (duration.kind === 'count') return duration;
    if (duration.kind === 'time' && !time) time = duration;
  }
  return time;
}

/**
 * 算出这张卡此刻技能条该长什么样。
 *
 * @param manaRatio 攒蓝进度（法力 / 满蓝）。技能没生效时它就是要显示的进度。
 * @param effects   这个棋子**此刻**正生效的效果（`stats-timeline.ts` 的 effectsAt）。
 *
 * @returns `null` = 这张卡**根本不画**技能条（纯被动干员，一辈子都是空的）；
 *          否则是 {mode, ratio}。
 */
export function skillBarOf(options: {
  def: UnitDef;
  star: number;
  manaRatio: number;
  effects: readonly SkillBarEffect[];
}): SkillBarState | null {
  const { def, star, manaRatio, effects } = options;

  /*
    纯被动棋子不画这条。
    「有没有要攒法力才能放的技能」这件事**内核里只有一个判据**
    （`hasActiveSkill`，它按当前星级取技能变体）——
    卡面、详情页的法力条都读它，谁也别自己再写一遍"effects.length > 0"。
  */
  if (!hasActiveSkill(def, star)) return null;

  const expected = skillWindowDurationOf(def, star);
  if (expected) {
    /*
      技能有持续型增益 —— 但"技能生效中"要看**实时状态**：
      还没放出来（在攒蓝）、或者已经打完/退完了，这条都不该是红的/橙的。
      所以这里去实时效果里找一条同类（按时间 / 按次数）的修正包：
        · 找到了 -> 红条 / 橙条，长度 = 剩余 / 总量
        · 没找到 -> 掉回蓝条（下面那段）
    */
    let left = 0;
    for (const effect of effects) {
      if (!BUFF_KINDS.has(effect.kind)) continue;
      const duration = effect.duration;
      if (!duration || duration.kind !== expected.kind) continue;
      const value = duration.kind === 'count' ? duration.left : duration.ticksLeft;
      if (value > left) left = value;
    }
    const total = expected.kind === 'count' ? expected.left : expected.ticksLeft;
    if (total > 0 && left > 0) {
      return {
        mode: expected.kind === 'count' ? 'charges' : 'duration',
        ratio: clamp01(left / total),
      };
    }
  }

  // 没有技能窗口 -> 蓝条：攒蓝进度
  return { mode: 'idle', ratio: clamp01(manaRatio) };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
