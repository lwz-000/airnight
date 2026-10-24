import { MAX_BATTLE_TICKS } from './constants.js';
import { buffDurationOf, durationText, type EffectDuration } from './duration.js';
import { renderItemStats } from './item-text.js';
import { starValue, type Mods } from './mods.js';
import type { EffectKind, SkillStats, UnitDef, UnitState } from './types.js';

/**
 * ============================================================
 *  状态效果注册表（★ 0.1.1 新增）
 * ============================================================
 *
 * 【这个文件解决什么问题？】
 * 在这之前，"某个棋子身上正生效着哪些效果"这件事**没有一处统一的说法**：
 *   · 流血住在 `unit.skill.timed` 里（一个 {kind:'dot'} 的数组）；
 *   · 无敌 / 隐匿 / 免死住在 `collectMods()` 算出来的修正包里；
 *   · 飞行 / 嘲讽 / 免疫眩晕住在 `unit.trait.mechanics` 的机制里；
 *   · 眩晕 / 护盾住在 `unit.statuses` 这个 `Record<string, number>` 里。
 * 四处形状完全不同，于是：
 *   · 界面上想"把身上的效果画出来"就得在渲染代码里分别去这四个地方翻 ——
 *     加一个新效果，就要在渲染代码里再补一段（而且很容易忘）；
 *   · 想复用已有玩法（比如"再来一个不会被攻击的效果"）时，得先考古
 *     "隐匿到底是怎么实现的"，很容易又抄一份新的。
 *
 * 所以这里立一张**唯一的登记表**：每一种效果在一处声明它的
 * 中文名 / 图标 / 颜色 / 是增益还是减益 / 一句话说明，
 * 外加一条「怎么从棋子上认出它」的判定。
 * 之后：
 *   · 界面只调 `activeEffectsOf()` —— 不需要知道效果住在哪四个地方；
 *   · 加新效果 = 在 `EFFECT_DEFS` 里加一条 + 在 `detect()` 里加一个 case；
 *     **界面一行都不用改**，会自动显示出来。
 *
 * 【和战斗内核的关系】
 * 这个文件**不参与任何战斗计算** —— 它是"只读的观察者"：
 * 战斗该怎么打还是怎么打，这里只是把打完的结果翻译成"人看得懂的效果清单"。
 * 所以它不会破坏确定性（没有任何随机、排序依赖写入）。
 */

// ============================================================
//  效果清单
// ============================================================

/** 效果的分类 —— 决定界面上用什么颜色、排在哪一栏 */
export type EffectPolarity = 'buff' | 'debuff' | 'neutral';

/** 一种效果的静态元数据（登记表的一行） */
export interface EffectDef {
  kind: EffectKind;
  /** 中文名（玩家看到的字） */
  name: string;
  /** 图标：先用 emoji/符号，避免再引入一套图标资源 */
  icon: string;
  /** 主题色（十六进制） */
  color: string;
  polarity: EffectPolarity;
  /** 一句话说明这个效果是干什么的（界面上 hover / 详情页用） */
  desc: string;
}

/**
 * ★★ 效果总表。
 *
 * 【加新效果的唯一入口】在这里加一行 + 在下面的 `detect()` 里加一个 case。
 *
 * 【为什么 icon 用 emoji 而不是图片？】
 * 效果是**战斗运行时**才出现的（很多还没有美术），用 emoji 可以立刻显示、
 * 不用等资源；以后要换成正式图标，只要把这一行的 icon 换成资源名 +
 * 在界面那边加一层"是 emoji 就直出、是资源名就加载"的判断即可。
 */
export const EFFECT_DEFS: Record<EffectKind, EffectDef> = {
  // ---------------- 控制 / 减益 ----------------
  bleed: {
    kind: 'bleed',
    name: '流血',
    icon: '🩸',
    color: '#e2554b',
    polarity: 'debuff',
    desc: '每隔一段时间扣除自身最大生命值的一定比例',
  },
  dot: {
    kind: 'dot',
    name: '持续伤害',
    icon: '☠',
    color: '#c0563f',
    polarity: 'debuff',
    desc: '每隔一段时间受到一次伤害',
  },
  /*
    ★ 0.2：燃烧（炎国羁绊）。和 dot 分开登记的**唯一理由**是要能显示**层数** ——
    见 types.ts 的 EffectKind 说明和下面 detect 里那段聚合。
  */
  burn: {
    kind: 'burn',
    name: '燃烧',
    icon: '🔥',
    color: '#e07a2c',
    polarity: 'debuff',
    desc: '每秒受到一次最大生命值一定比例的法术伤害；可叠加（最多 5 层），每次被附着都会刷新持续时间',
  },
  stun: {
    kind: 'stun',
    name: '眩晕',
    icon: '💫',
    color: '#e8c34a',
    polarity: 'debuff',
    desc: '眩晕期间不能攻击也不能移动',
  },
  disarm: {
    kind: 'disarm',
    name: '战栗',
    icon: '⚔',
    color: '#d98a4a',
    polarity: 'debuff',
    desc: '战栗期间不能进行普通攻击（移动和技能不受限制）',
  },
  downed: {
    kind: 'downed',
    name: '倒地',
    icon: '⬇',
    color: '#8a8f9c',
    polarity: 'debuff',
    desc: '倒地等待复活，期间不能行动也不会被选中',
  },
  debuff: {
    kind: 'debuff',
    name: '减益',
    icon: '▼',
    color: '#c0563f',
    polarity: 'debuff',
    desc: '身上挂着负面修正（攻击力 / 攻速 / 抗性被降低）',
  },

  // ---------------- 保护 / 增益 ----------------
  stealth: {
    kind: 'stealth',
    name: '隐匿',
    icon: '👻',
    color: '#7d8bd6',
    polarity: 'buff',
    /*
      ★ 0.1.4：改名（原「隐匿」）+ 把效果说准。
      以前只写"不会被敌人选为攻击目标"，但那句话**漏了走路**，
      而且没说明"范围技能照样打得到"—— 玩家会以为是无敌。
    */
    desc: '不会成为棋子的锁敌目标（也不会被走向），但仍会被范围技能打到',
  },
  invincible: {
    kind: 'invincible',
    name: '无敌',
    icon: '🛡',
    color: '#ffd75e',
    polarity: 'buff',
    desc: '受到的任何伤害都归零',
  },
  shield: {
    kind: 'shield',
    name: '护盾',
    icon: '🔰',
    color: '#4ad6c8',
    polarity: 'buff',
    desc: '先扣护盾再扣生命，护盾破了才开始掉血',
  },
  immune: {
    kind: 'immune',
    name: '免疫',
    icon: '✳',
    color: '#8fd67c',
    polarity: 'buff',
    desc: '接下来若干次受到的攻击完全无效',
  },
  cannotDie: {
    kind: 'cannotDie',
    name: '免死',
    icon: '❤',
    color: '#ff8fb1',
    polarity: 'buff',
    desc: '生命值不会降到 0（至少留 1 点）',
  },
  evade: {
    kind: 'evade',
    name: '闪避',
    icon: '🌀',
    color: '#6fc2f0',
    polarity: 'buff',
    desc: '有概率完全躲开受到的攻击',
  },
  reflect: {
    kind: 'reflect',
    name: '反弹',
    icon: '↩',
    color: '#d9a441',
    polarity: 'buff',
    desc: '把受到伤害的一部分反弹给攻击者',
  },
  lifesteal: {
    kind: 'lifesteal',
    name: '吸血',
    icon: '🩹',
    color: '#e07a8a',
    polarity: 'buff',
    desc: '把造成伤害的一部分转化为自身治疗',
  },
  regen: {
    kind: 'regen',
    name: '回复',
    icon: '➕',
    color: '#8fd67c',
    polarity: 'buff',
    desc: '每隔一段时间回复一部分生命值',
  },
  buff: {
    kind: 'buff',
    name: '增益',
    icon: '▲',
    color: '#6fd68a',
    polarity: 'buff',
    desc: '身上挂着正面修正（攻击力 / 攻速 / 抗性被提高）',
  },

  /*
    ★ 0.1.4：「弹药」—— 「接下来 N 次攻击 +X%」这类技能效果的统一说法。

    【为什么单给它一个名字？】
    这类效果以前显示成「增益 · 攻击力 +300% · 剩 5 次」：
    名字太泛（和"持续 10 秒的增益"长得一样），玩家读不出"这是攒着的几发强化弹"。
    改叫**弹药**之后，一眼就知道：攒着几发、打一次少一发、倍率是多少。

    【它和 `buff` 的关系】
    只是**显示层**的区分，修正包本身一模一样（`attackCharges` 那种按次数消耗）。
    数值 / 触发条件 / 持续回合 / 适用范围**一个字节都没改**，
    有测试钉住（`packages/shared/test/ammo.test.ts`）。
    ★ 只有**技能**落下来的才算弹药（`SkillBuff.fromSkill`）——
    藏品的"每 3 击强化下一击"和野怪的周期性蓄力形状相同但不叫弹药。
  */
  ammo: {
    kind: 'ammo',
    name: '弹药',
    icon: '◈',
    color: '#ffb35c',
    polarity: 'buff',
    desc: '攒着的强化攻击：打一次消耗一发，打光之前攻击倍率一直是提高的',
  },

  /*
    ★★ 0.2 机械师：「破盾子弹」。
    和「弹药」看着像（都是"攒着几发、用一次少一发"），但它用一发是**换一层护盾**、
    还会顺手炸一下周围 —— 和"攻击倍率提高"完全是两回事，所以单开一格。
  */
  bullets: {
    kind: 'bullets',
    name: '破盾子弹',
    icon: '🔩',
    color: '#9ad0ff',
    polarity: 'buff',
    desc: '护盾被打空时消耗一颗：立刻补一层新护盾，并对周围四格造成一次法术伤害',
  },

  // ---------------- 中性 / 标记 ----------------
  airborne: {
    kind: 'airborne',
    name: '飞行',
    icon: '🕊',
    color: '#c9d4ea',
    polarity: 'neutral',
    desc: '飞行单位：攻击距离不够的敌人打不到它',
  },
  taunt: {
    kind: 'taunt',
    name: '嘲讽',
    icon: '📣',
    color: '#e8c34a',
    polarity: 'neutral',
    desc: '敌人优先攻击它（保护身后的队友）',
  },
  revive: {
    kind: 'revive',
    name: '重生',
    icon: '✨',
    color: '#b58fe8',
    polarity: 'buff',
    desc: '阵亡时原地站起来一次（本场只能触发一次）',
  },
  stunImmune: {
    kind: 'stunImmune',
    name: '免疫眩晕',
    icon: '🚫',
    color: '#9aa4b8',
    polarity: 'neutral',
    desc: '不会被眩晕',
  },
  damageReduction: {
    kind: 'damageReduction',
    name: '减伤',
    icon: '🔻',
    color: '#7fb2e8',
    polarity: 'buff',
    desc: '受到的伤害按比例降低',
  },
  aura: {
    kind: 'aura',
    name: '光环',
    icon: '◎',
    color: '#c8a2ff',
    polarity: 'neutral',
    desc: '周期性对周围 / 全场产生效果',
  },
};

/** 效果的显示顺序：先增益、再中性、最后减益（界面上从上往下读） */
const POLARITY_ORDER: Record<EffectPolarity, number> = { buff: 0, neutral: 1, debuff: 2 };

// ============================================================
//  运行时：认出棋子身上正生效的效果
// ============================================================

/** 一条"正生效的效果"（登记表的元数据 + 这一条的具体情况） */
export interface ActiveEffect {
  kind: EffectKind;
  name: string;
  icon: string;
  color: string;
  polarity: EffectPolarity;
  desc: string;
  /** 这一条的具体数值说明（"每秒 1% 最大生命""攻击力 +30%"），没有就不显示 */
  detail?: string;
  /**
   * ★ 0.1.3：**这一条怎么消耗**（按时间 / 按次数 / 整场 / 一次性）。
   *
   * 【为什么不再是一个裸的 `ticksLeft`？】
   * 因为"还剩多久"和"还剩几次"是两种东西。以前只有一个 `ticksLeft`，
   * 次数型的包（"接下来 6 次攻击"）因为时长记的是"整场"，
   * 会被显示成"剩 75.0 秒" —— 玩家完全读不懂。
   * 现在统一走 `duration.ts`，界面只负责把它渲染成文字。
   */
  duration?: EffectDuration;
}

/**
 * 算出这枚棋子上**当前正生效**的全部效果。
 *
 * @param mods 已经算好的修正包（`collectMods(state, unit)`）。
 *   之所以要传进来而不是在这里现算，是因为调用方（界面 / 战斗循环）
 *   通常已经算过一次了 —— 这里再算一次纯属浪费（而且这个函数每帧都会调）。
 * @param def  棋子定义（用来查"飞行"这类写在数据里的机制）。可省略。
 *
 * 【为什么很多判定要看 `unit.skill.buffs` 里有没有那一项？】
 * 因为"身上有 +30% 攻击力的包"这种只能从修正包里认出来。
 * 但**常驻**的东西（藏品挂的永久包、技能的被动）也会混在里面 ——
 * 那种属于"这个棋子本来就这样"，不是"正在生效的状态"，
 * 所以凡是 `passive: true` 的包一律不算"效果"（否则每个穿藏品的棋子
 * 都会顶着一个"增益"图标，信息量等于零）。
 */
export function activeEffectsOf(mods: Mods, unit: UnitState, def?: UnitDef): ActiveEffect[] {
  const out: ActiveEffect[] = [];
  const push = (kind: EffectKind, opts?: { detail?: string; duration?: EffectDuration }): void => {
    const meta = EFFECT_DEFS[kind];
    if (!meta) return;
    out.push({ ...meta, ...opts });
  };

  // ---- 1) 修正包类（无敌 / 隐匿 / 免死 / 闪避 / 反弹 / 吸血 / 减伤）----
  if (mods.invulnerable) push('invincible');
  if (mods.untargetable) push('stealth');
  if (mods.cannotDie) push('cannotDie');
  if (mods.evasionBp > 0) push('evade', { detail: `${mods.evasionBp / 100}% 闪避` });
  if (mods.reflect) push('reflect');
  if (mods.lifestealBp > 0) push('lifesteal', { detail: `${mods.lifestealBp / 100}% 吸血` });
  if (mods.damageReductionBp > 0) push('damageReduction', { detail: `-${mods.damageReductionBp / 100}%` });
  else if (mods.farAttackReduction) push('damageReduction', { detail: `被远程攻击时 -${mods.farAttackReduction.ratioBp / 100}%` });
  else if (mods.distanceReduction) push('damageReduction', { detail: `按距离最多 -${mods.distanceReduction.maxBp / 100}%` });

  // ---- 2) statuses 类（眩晕 / 护盾 / 免疫次数）----
  const stun = unit.statuses['stun'] ?? 0;
  if (stun > 0) push('stun', { duration: { kind: 'time', ticksLeft: stun } });
  /*
    ★ 0.1.3 战栗：单独显示一条 —— 它和眩晕**不是**同一种东西
    （战栗只是普攻被按住，人照样走位、照样放技能），和眩晕合并会让玩家误判强度。
  */
  if (mods.disarmed) push('disarm');
  const shieldTicks = unit.statuses['shield'] ?? 0;
  if (shieldTicks > 0) {
    const value = unit.statuses['shieldValue'] ?? 0;
    push('shield', {
      detail: `${Math.round(value / 1000)} 点`,
      /*
        ★ 0.2：左乐的护盾是"存在期间不许回技力"、**没有固定时长**的，
        内核用 `FOREVER_TICKS` 表示它。这里必须认出来，否则卡面会显示
        "剩 1 亿秒"这种数字。
      */
      duration: shieldTicks >= MAX_BATTLE_TICKS ? { kind: 'permanent' } : { kind: 'time', ticksLeft: shieldTicks },
    });
  }
  /*
    免疫是**按次数**的（机械师"免疫接下来 3/5/7 次攻击"）——
    次数交给 `duration` 显示（"剩 5 次"），detail 不再重复写一遍。
  */
  const immuneHits = (unit.skill?.immuneHits ?? 0) + Math.max(0, mods.immuneHits);
  if (immuneHits > 0) push('immune', { duration: { kind: 'count', left: immuneHits } });
  /*
    ★★ 0.2 机械师：破盾子弹剩几颗 —— 和护盾分开两条显示。
    【为什么不并进「护盾」那条？】护盾是**当前这层**还剩多少点，
    子弹是**之后还能补几层**，是两个独立的量，合在一起玩家算不清。
  */
  const bulletsLeft = unit.skill?.shieldBullets?.left ?? 0;
  if (bulletsLeft > 0) push('bullets', { duration: { kind: 'count', left: bulletsLeft } });
  /*
    ★ 0.2 蕾缪安 3 星：这 7 秒里她**停止攻击**、只在地图上"标记落点"。
    不显示的话玩家会以为棋子卡住了。表里就管这叫"获得 7 颗弹药"，
    所以复用「弹药」这一格、把说明换成"锁定中"。
  */
  const lockOn = unit.skill?.lockOn;
  if (lockOn) push('ammo', { detail: '锁定中·7 秒后引爆', duration: { kind: 'count', left: lockOn.locksLeft } });

  // ---- 3) 限时效果（持续伤害 / 持续治疗）----
  /*
    ★★ 0.2（用户报"炎羁绊的燃烧没有叠加、也没有重复刷新时长"）：
    **燃烧先按层聚合**，再走下面的通用通路。

    【为什么原来会"看不出来"？】
    燃烧的每一层在核心里都是一条独立的 dot（`tag: 'burn'`），
    而这里原来的写法是逐条 `push('dot')`，随后**按种类去重**只留第一条 ——
    留下的恰好是**最早附着的那一层**：
      · 层数：5 层和 1 层在界面上长得一模一样（都只有一条"持续伤害"）；
      · 剩余时间：读的是"最早那层"，而它永远是最接近到期的那个
        （常见的攻击间隔下它长期停在 0.2 秒）⇒ 看起来就像"时长从来没刷新过"。
    聚合成一条之后：层数 = 条数、剩余时间 = **最长的那个**（刚刷新过的那层）。
  */
  const burnLayers = (unit.skill?.timed ?? []).filter((entry) => entry.tag === 'burn');
  if (burnLayers.length > 0) {
    const first = burnLayers[0]!;
    const interval = Math.max(1, first.intervalTicks);
    const ticksLeft = Math.max(...burnLayers.map((entry) => entry.ticksLeft)) * interval;
    push('burn', {
      detail: `${burnLayers.length} 层 · 每跳 ${Math.round(first.amount / 1000)} 点`,
      duration: { kind: 'time', ticksLeft },
    });
  }
  for (const timed of unit.skill?.timed ?? []) {
    if (timed.tag === 'burn') continue; // ★ 上面已经按层聚合成一条了
    const ticksLeft = timed.ticksLeft * Math.max(1, timed.intervalTicks);
    push(timed.kind === 'dot' ? 'dot' : 'regen', {
      detail: `每跳 ${Math.round(timed.amount / 1000)} 点`,
      duration: { kind: 'time', ticksLeft },
    });
  }

  // ---- 4) 机制类（飞行 / 嘲讽 / 眩晕免疫 / 光环）----
  for (const mechanic of unit.trait?.mechanics ?? []) {
    if (mechanic.kind === 'airborne') push('airborne', { detail: `攻击距离 ≤${mechanic.immuneToRangeAtMost} 的打不到` });
    else if (mechanic.kind === 'stunImmune') push('stunImmune');
    else if (mechanic.kind === 'bleed') push('bleed', { detail: `每秒 -${mechanic.ratioBp / 100}% 最大生命` });
    else if (mechanic.kind === 'periodic') push('aura', { detail: `每 ${(mechanic.intervalTicks / 20).toFixed(1)} 秒触发一次` });
  }
  /*
    ★ 0.2（用户口径 2）：嘲讽一律只有周围 2 格 —— 不再有"全场嘲讽"，
    所以文案写死 2（和 `movement.ts` 的 `TAUNT_RADIUS` 是同一个数，要改一起改）。
  */
  if (unit.taunt) push('taunt', { detail: '2 格内' });
  // 倒地：剩余时间要拿"当前 tick"减 —— 这里没有 state，所以只标状态、不给秒数
  if (unit.downedUntilTick !== undefined) push('downed');

  // ---- 5) 重生（有次数且没用掉）----
  if (unit.reborn && !unit.rebornUsed) push('revive');

  /*
    去掉重复的种类（同一种效果只显示一条，取"信息更全"的那条）。
    比如棋子身上同时有护盾和持续伤害——它们是不同种类，都会留下；
    但如果有两条 dot，就只留第一条（README：界面上一格放不下那么多）。

    ★ 只对上面这些"按种类认"的效果去重。技能挂的临时修正包在下一步
      **单独追加** —— 它们必须一条一条列出来。
  */
  const seen = new Set<EffectKind>();
  const unique = out.filter((effect) => {
    if (seen.has(effect.kind)) return false;
    seen.add(effect.kind);
    return true;
  });

  // ---- 6) 技能挂上来的临时修正包（一条一条列，含"剩几次"）----
  unique.push(...liveBuffEffects(unit));

  // 固定顺序：先增益、再中性、最后减益；同类按登记表里的声明顺序
  const order = Object.keys(EFFECT_DEFS) as EffectKind[];
  unique.sort((a, b) => {
    const p = POLARITY_ORDER[a.polarity] - POLARITY_ORDER[b.polarity];
    if (p !== 0) return p;
    return order.indexOf(a.kind) - order.indexOf(b.kind);
  });
  return unique;
}

/**
 * ★ 0.1.4：`liveBuffEffects`（技能挂上来的临时修正包）**可能吐出来的效果种类**。
 *
 * 【为什么要有这份名单？—— 卡面技能条当年就是漏了它才不显示的】
 * 客户端的 `three/skill-bar.ts` 要判断"这条实时效果是不是技能挂的修正包"，
 * 它以前自己写了一份 `new Set(['buff','debuff'])`。0.1.4 加了「弹药」之后，
 * 弹药的 kind 是 `ammo`，那份名单里没有 ⇒ **开完技能的棋子技能条直接消失**
 * （掉回蓝条，而开完技能蓝条正好清零，看起来就是"条没了"）。
 *
 * ⇒ 名单只在这里定义一次，客户端 import 它。**以后再加一种修正包类效果，
 * 只改这一行**，卡面技能条自动跟上（有测试钉住，`apps/web/test/skill-bar.test.ts`）。
 */
export const LIVE_BUFF_EFFECT_KINDS: readonly EffectKind[] = ['buff', 'debuff', 'ammo'];

/**
 * ★ 0.1.3：把**技能挂在棋子身上的临时修正包**一条一条翻成"效果"。
 *
 * 【为什么单独抽出来，而不是塞在 activeEffectsOf 中间？】
 * 因为它和上面那批"按种类认"的效果性质不同：上面每种只显示一条，
 * 而这里**每一条包都要单独显示** —— 同一个人身上可以同时挂着
 * "攻击力 +30%（剩 3 次）"和"护甲 +20（剩 2.4 秒）"。
 * 分开之后，以后卡面上想显示"我身上还剩几个包"也能直接复用它。
 *
 * 【哪些不显示？】
 *   · `passive: true` 的：那是"这个棋子本来就这样"（被动、藏品挂的永久包），
 *     每个穿藏品的棋子都顶一个图标，信息量等于零；
 *   · 已经耗尽的（次数用完 / 时间到）—— 内核下一拍就会摘掉，这里先不显示。
 */
export function liveBuffEffects(unit: UnitState): ActiveEffect[] {
  const out: ActiveEffect[] = [];
  for (const buff of unit.skill?.buffs ?? []) {
    if (buff.passive) continue;
    const duration = buffDurationOf(buff);
    if (duration.kind === 'time' && duration.ticksLeft <= 0) continue;
    if (duration.kind === 'count' && duration.left <= 0) continue;
    // 修正包里的数值可能是"按星级写的"（数组），先按这枚棋子的星级拍平再翻成人话
    const stats = resolveStats(buff.stats, unit.star);
    /*
      ★ 0.1.4：「接下来 N 次攻击 +X%」这类**技能**效果统一显示成**弹药**。
      判据两条一起看，缺一不可：
        · `duration.kind === 'count'` —— 它是"按次数消耗"的（不是持续 N 秒）；
        · `buff.fromSkill` —— 它来自技能（藏品的"每 3 击强化下一击"、
          野怪的周期性蓄力形状一样，但那些不该叫弹药）。
    */
    const isAmmo = duration.kind === 'count' && buff.fromSkill === true;
    const kind: EffectKind = isAmmo ? 'ammo' : isNegativeStats(stats) ? 'debuff' : 'buff';
    const meta = EFFECT_DEFS[kind];
    if (!meta) continue;
    const detail = renderItemStats(stats);
    out.push({ ...meta, ...(detail ? { detail } : {}), duration });
  }
  return out;
}

/** 把修正包里的星级数值（可能是数组）按这枚棋子的星级拍平成一个数 */
function resolveStats(stats: SkillStats, star: number): SkillStats {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(stats)) {
    out[key] = Array.isArray(value) ? starValue(value as readonly number[], star) : value;
  }
  return out as SkillStats;
}

/** 这个修正包整体算负面吗（只看最显眼的四项，够界面用） */
function isNegativeStats(stats: SkillStats): boolean {
  return (
    (num(stats.attackDamageBp) ?? 0) < 0 ||
    (num(stats.attackSpeedBp) ?? 0) < 0 ||
    (num(stats.armorFlat) ?? 0) < 0 ||
    (num(stats.magicResistFlat) ?? 0) < 0
  );
}

/** 取 StarValue 里的纯数字（藏品/机制的数值不随星级变，都是单个数字） */
function num(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}
