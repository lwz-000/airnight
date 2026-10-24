import { BOARD_H, BOARD_W, BP, FIX, MANA_MAX, MAX_BATTLE_TICKS, TICKS_PER_SECOND } from './constants.js';
import { cellDistance, moveStyleOf, withinRadius } from './field.js';
import type {
  AttackProfile,
  BattleState,
  DamageType,
  HealSpec,
  ScopedMechanic,
  SkillBuff,
  SkillStats,
  SplashShape,
  StarValue,
  TargetRule,
  UnitState,
} from './types.js';

/**
 * 「修正包」系统 —— 棋子的被动 + 所有生效中的技能增益，合并成一份纯数字表。
 *
 * ============================================================
 *  为什么单独一个文件？
 * ============================================================
 * 因为**两边的底层都要用它**：
 *   · `combat-math.ts`（挨打时要查闪避/免疫/免死/吸血）
 *   · `skills.ts`（攻击时要查溅射/额外目标/攻速）
 * 如果把它放在 skills.ts 里，combat-math 就要 import skills，
 * 而 skills 又 import combat-math —— 循环依赖，运行时会炸得很奇怪。
 * 所以抽到最底层这一层，两边都往下依赖它。
 */

// ============================================================
// 星级数值
// ============================================================

/**
 * 取某个星级下的数值。
 *
 * `[500, 1000, 1300]` 依次对应 1/2/3 星。
 * 只写两个数时第三个沿用第二个，只写一个数时三星通用
 * （你表里有些技能只填了 1/2 星，就是这种情况）。
 */
export function starValue(value: StarValue | undefined, star: number): number {
  if (value === undefined) return 0;
  if (typeof value === 'number') return value;
  if (value.length === 0) return 0;
  const index = Math.max(0, Math.min(value.length - 1, star - 1));
  return value[index]!;
}

/**
 * ★ 0.2：把一份 `SkillStats` 里的**星级数值全部定死成数字**（按给定星级）。
 *
 * 【为什么需要它？】
 * `addBuff` 只把包原样推进队列，星级要等 `collectMods` 才解析 —— 而那是按
 * **被挂的人**的星级。对"施法者给敌人挂的减益"（`debuffOnHit`）就会解析错人：
 * 1 星伊内丝打 3 星敌人，削的攻速会按敌人的 3 星算，莫名其妙翻几倍。
 * 所以在**收集那一刻**（还知道施法者是谁）先把它定死。
 *
 * 递归一层对象就够：`stats` 里嵌的要么是数字/星级数组，要么是 `splash` 这类子对象。
 */
export function resolveStatsForStar(stats: SkillStats, star: number): SkillStats {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(stats)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'number') out[key] = value;
    /*
      ★★ 0.2：数组有两种，**别一律当成"星级三连"**。
      以前这里是 `starValue(value, star)` —— 于是 `attackProfile.hits`（对象数组）
      会被"取第 star 个元素"压成一个对象，后面 `.map` 直接炸。
      判据：全是数字 ⇒ 星级三连；否则按**对象数组**逐项递归。
    */
    else if (Array.isArray(value)) {
      out[key] = value.every((item) => typeof item === 'number')
        ? starValue(value as number[], star)
        : value.map((item) =>
            item && typeof item === 'object' ? resolveStatsForStar(item as SkillStats, star) : item,
          );
    }
    else if (typeof value === 'object') out[key] = resolveStatsForStar(value as SkillStats, star);
    else out[key] = value;
  }
  return out as SkillStats;
}

/**
 * ★★ 0.2 可露希尔：「我方全体防御力 +15%/+30%，攻击力 +10%/+15%，技能持续 10s；
 * （**此数值每有 10 金币额外增加 1%，最高上限 5%**）」。
 *
 * 把"按金币换来的那一份百分比"加到这份属性包里**所有万分比字段**上。
 *
 * 【为什么遍历所有 `*Bp` 字段，而不是列一遍字段名？】
 * 和 `scaleStats()` 同一个理由：字段有几十个而且还会加，
 * 列一遍的话以后加一个新字段就会**静默漏掉**（"每 10 金币 1%"对那个字段失效，还不报错）。
 *
 * 【为什么只加 `*Bp`（万分比）字段？】
 * `armorFlat` / `hpFlat` / `rangeFlat` 是**点数**，给它们加 bp 会变成
 * "每 10 金币 +1 点护甲"之类完全不同的设计。表里的"此数值"指的也是那两个百分比。
 *
 * `goldBonusBp` 自己会被剔掉 —— 它只是"怎么算"的说明书，不该留在修正包里。
 *
 * @param gold 玩家手里的金币（开局由 `TeamSetup.playerContext` 灌进 `BattleState.playerGold`）
 */
export function withGoldBonus(stats: SkillStats, gold: number): SkillStats {
  const spec = stats.goldBonusBp;
  if (!spec) return stats;
  const perStep = Math.max(1, Math.floor(spec.perGold));
  const steps = Math.floor(Math.max(0, gold) / perStep);
  const bonusBp = Math.min(Math.max(0, spec.maxBp), steps * spec.bpPerStep);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(stats)) {
    if (key === 'goldBonusBp') continue;
    if (key.endsWith('Bp') && (typeof value === 'number' || Array.isArray(value))) {
      if (Array.isArray(value)) out[key] = value.map((item) => (typeof item === 'number' ? item + bonusBp : item));
      else out[key] = (value as number) + bonusBp;
    } else {
      out[key] = value;
    }
  }
  return out as SkillStats;
}

/**
 * ★ 0.1.1：把一份 SkillStats 按 `factorBp`（万分比）等比放大。
 *
 * 【给谁用？】
 *   · 藏品二版的"成长层数"（仇名录每层 +1%、佣兵的饰物每层 +5%…）
 *   · 生还者合约的"每次胜利额外 +20%"（scaleBp = 10000 + 2000×层数）
 *
 * 【为什么写成"遍历所有字段"而不是列一遍字段名？】
 * 因为 SkillStats 有几十个字段，而且还会继续加。列一遍的话，
 * 以后加一个新字段就会**静默漏掉**（成长效果对它无效，还不报错）。
 * 这里只对 number / number[] 做乘法，其余（对象类字段如 splash）原样带过 ——
 * 成长类数值本来就只会用到 bp / flat 那些数字字段。
 */
export function scaleStats(stats: SkillStats, factorBp: number): SkillStats {
  if (factorBp === 10000) return stats;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(stats)) {
    if (typeof value === 'number') {
      out[key] = Math.floor((value * factorBp) / 10000);
    } else if (Array.isArray(value)) {
      out[key] = value.map((item) => (typeof item === 'number' ? Math.floor((item * factorBp) / 10000) : item));
    } else {
      out[key] = value;
    }
  }
  return out as SkillStats;
}

/**
 * ★ 0.1.1：「血量越低越强」这一类效果的通用折算（热辣可可 / 紧急活性剂 / 止痛片）。
 *
 * 规则：满血 0，到 `thresholdBp` 时正好等于 `maxBonusBp`，再低也不会超过它。
 * 数学上是"从满血到阈值之间的线性插值"：
 *
 *     bonus = maxBonusBp × (maxHp - hp) / (maxHp - maxHp × threshold)
 *
 * 【为什么把它写成整数运算？】
 * 因为它住在 `collectMods` 里 —— 那个函数一场战斗会被调用**几千次**，
 * 而且它的结果直接参与伤害计算。用浮点数（hp/maxHp 这种）会因为
 * 不同 CPU 的舍入差异，在几千次累积之后变成"我这边赢了、你那边输了"。
 * 通分之后全程只有整数乘除 + Math.floor，跨平台完全一致。
 */
function lowHpBonusBp(unit: UnitState, thresholdBp: number, maxBonusBp: number): number {
  if (unit.maxHp <= 0 || maxBonusBp === 0) return 0;
  if (thresholdBp >= 10000) return maxBonusBp; // 阈值≥100%：只要掉一点血就拿满
  if (unit.hp >= unit.maxHp) return 0; // 满血无加成
  if (unit.hp * 10000 <= unit.maxHp * thresholdBp) return maxBonusBp; // 到达（或低于）阈值
  const numerator = maxBonusBp * (unit.maxHp - unit.hp) * 10000;
  const denominator = unit.maxHp * (10000 - thresholdBp);
  return Math.floor(numerator / denominator);
}

// ============================================================
// 合并结果
// ============================================================
export interface Mods {
  attackDamageBp: number;
  attackSpeedBp: number;
  armorFlat: number;
  magicResistFlat: number;
  /** ★ 护甲 / 魔抗的百分比修正（万分比，负数 = 破甲） */
  armorBp: number;
  /** ★ 0.3.2 技力获取倍率（万分比，-9900 = 只剩 1%） */
  manaGainBp: number;
  magicResistBp: number;
  /** ★ 攻击时无视目标这么多比例的护甲（万分比） */
  armorPenBp: number;
  hpFlat: number;
  hpBp: number;
  rangeFlat: number;
  rangeUnlimited: boolean;
  moveStepFlat: number;
  lifestealBp: number;
  bonusDamage: { source: 'dealt' | 'maxHp' | 'missingHp' | 'attack'; ratioBp: number; damageType: DamageType } | null;
  splash: {
    radius: number;
    shape: SplashShape;
    ratioBp: number;
    damageType: DamageType;
    /** ★ 0.0.3 彩蛋：范围打几段（默认 1） */
    hits: number;
    /** ★ 0.0.3 彩蛋：伤害基数（'dealt' = 打出的总伤害 / 'attack' = 攻击力） */
    basis: 'dealt' | 'attack';
    /** ★ 0.2：这一发该播哪套特效（表现层标记，见 SkillStats.splash.fx） */
    fx?: string;
  } | null;
  extraTargets: number;
  multiHit: number;
  /** ★ 0.1.3：连击每段的伤害比例（万分比；10000 = 每段满额） */
  multiHitBp: number;
  /**
   * ★★ 0.2：自定义普攻弹道（祥子的音符 / 若麦的五连击）。
   * ★ 收集口径是**后者覆盖前者**（限时 buff 赢过被动）—— 见 `SkillStats.attackProfile`。
   */
  attackProfile: ResolvedAttackProfile | null;
  /** ★ 0.2：低存在感（八幡海铃）—— 索敌时让别人先被打 */
  lowPresence: boolean;
  /** ★ 0.2：一次性锁血（若叶睦）—— 星级已定死 */
  defyDeath: { hp: number; ticks: number; taunt: boolean } | null;
  damageTypeOverride: DamageType | null;
  farBonus: { minDistance: number; ratioBp: number; damageType: DamageType } | null;
  /** ★ 0.3 近卫：对**射程 ≥ minRange** 的目标，伤害提升到 totalBp（万分比） */
  rangeAmp: { minRange: number; totalBp: number } | null;
  stunOnHit: { chanceBp: number; durationTicks: number; perHit: boolean } | null;
  /** ★ 0.1.3：战栗 —— 期间不能进行**普通攻击**（走位和技能不受限） */
  disarmed: boolean;
  /** ★ 0.1.3：攻击命中时给目标挂战栗（形状和 stunOnHit 完全一致） */
  disarmOnHit: { chanceBp: number; durationTicks: number; perHit: boolean } | null;
  /** ★ 0.2：每次攻击给**目标**挂减益（星级已按施法者解析定死） */
  debuffOnHit: { chanceBp: number; durationTicks: number; stats: SkillStats } | null;
  attackHeals: readonly ResolvedHeal[] | null;
  /** ★ 0.2：攻击命中时给目标附的持续伤害（截云的裂痕），星级已定死 */
  onHitDot: { power: number; damageType: DamageType; durationTicks: number; intervalTicks: number } | null;
  /**
   * ★ 0.2：每第 N 次攻击额外结算一次伤害（克洛丝 / 芳汀的"每第三次攻击"）。
   * 星级在收集时就解析掉了，所以这里存的是**数值**而不是 StarValue。
   */
  /**
   * ★ 0.2：每第 N 次攻击额外结算一次伤害 **和 / 或** 额外攻击几个目标。
   * ★ 0.2 起 `bonus` 可以是 null —— 可露希尔的被动只多打一个人、没有多打一段伤害。
   */
  everyNthAttack: {
    every: number;
    bonus: { basis: 'attack' | 'dealt'; ratioBp: number; damageType: DamageType } | null;
    /** 这一击额外攻击几个目标 */
    extraTargets: number;
  } | null;
  vsTraitDamageBp: { trait: string; exclude: boolean; ratioBp: number } | null;
  noAttack: boolean;
  noMove: boolean;
  /** ★★ 0.2 赤刃明霄陈：「技能持续期间不再获得技力」 —— 由生效中的修正包提供，见 `gainMana` */
  noManaGain: boolean;
  /**
   * ★★ 0.2 蕾缪安：**攻速恒定** —— 面板上的攻速不再被任何加成改变。
   *
   * 【为什么需要这条？】表里写的是"攻速恒定0.55，每额外获得1%的攻速转化为0.1%的攻击力"。
   * 也就是说她身上所有"加攻速"的东西（羁绊、藏品、别的干员的技能）
   * 都不再让攻击变快，而是**改道**变成攻击力（见 `attackSpeedToAttackRatioBp`）。
   * 不锁死的的话就会出现"加成既让攻速变快、又让攻击力变高"，双吃。
   */
  attackSpeedLocked: boolean;
  /**
   * ★★ 0.2 蕾缪安：把"额外获得的攻速"按这个比例折成攻击力。
   * 万分比含义：`1000` ⇒ 每 10000bp（100%）攻速 → 1000bp（10%）攻击力，
   * 即表里的「1% 攻速 → 0.1% 攻击力」。
   * 0 = 不折算（默认，别的干员一点都不受影响）。
   */
  attackSpeedToAttackRatioBp: number;
  evasionBp: number;
  reflect: { ratioBp: number; capAttackBp: number } | null;
  untargetable: boolean;
  cannotDie: boolean;
  preferLowestHp: boolean;
  /** ★ 0.2：每击随机换目标（维什戴尔"每次攻击都随机攻击攻击范围内的敌人"） */
  randomAttackTarget: boolean;
  immuneHits: number;
  pulse: ResolvedPulse | null;
  onAttackAllyBuff: ResolvedAllyBuff | null;
  allyLowHpGuard: ResolvedGuard | null;
  nearbyEnemyAttackBp: { radius: number; ratioBp: number } | null;
  onKillRefresh: boolean;
  /**
   * 受到伤害时的额外减免（万分比）。例：奇缘面具 -10% -> 1000。
   * 在 combat-math.ts 的 dealDamage 里、抗性减免之后生效。
   */
  damageReductionBp: number;
  /**
   * 被**距离超过 minDistance 格**的敌人攻击时，受到的伤害降低 ratioBp（防爆盾）。
   * 只在普攻（attackType === 'attack'）时判定 —— 技能打过来不算"远程普攻"。
   */
  farAttackReduction: { minDistance: number; ratioBp: number } | null;
  /**
   * ★ 0.0.3：受到的伤害**提升** damageTakenBp（万分比，博卓卡斯替二阶段）。
   * 与 damageReductionBp 方向相反，二者相加后应用。
   */
  damageTakenBp: number;
  /** ★ 无敌：受到的任何伤害都归零（“复仇者”二阶段复活后 8 秒） */
  invulnerable: boolean;
  /** ★ 按距离减伤（每远 1 格减 perCellBp，封顶 maxBp）。真伤无视 */
  distanceReduction: { perCellBp: number; maxBp: number } | null;
  /**
   * ★ 0.1.1 藏品二版：
   *   · evasionPhysicalBp / evasionMagicBp —— 只对物理 / 只对法术生效的闪避
   *   · initialManaBp                      —— 开局法力条按比例预充
   *   · distanceBonus                      —— 对**不同距离**的敌人伤害不同（Blaze 电锯 / Scout 狙击镜）
   *   · manaRegenMilliPerSecond            —— 低血回蓝（止痛片）折算出的"每秒几点法力"×1000
   */
  evasionPhysicalBp: number;
  evasionMagicBp: number;
  initialManaBp: number;
  distanceBonus: { mode: 'near' | 'far'; perCellBp: number; maxBp: number } | null;
  manaRegenMilliPerSecond: number;
}

/**
 * 解析后的「一条治疗基准」（星级已定死成数值）。
 *
 * ★ 0.2：治疗量可以是**多条基准相加** ⇒ 统一用数组表示，
 *   消费方一律 `for (const h of heals) total += ...`。
 */
export interface ResolvedHeal {
  basis: 'attack' | 'casterMaxHp' | 'targetMaxHp' | 'missingHp';
  ratioBp: number;
}

/** 把 `HealSpec | HealSpec[]` 统一成数组、按星级定死数值（空数组 ⇒ null） */
export function resolveHeals(
  spec: HealSpec | readonly HealSpec[] | undefined,
  star: number,
): ResolvedHeal[] | null {
  if (!spec) return null;
  const list = Array.isArray(spec) ? (spec as readonly HealSpec[]) : [spec as HealSpec];
  const out = list.map((h) => ({ basis: h.basis, ratioBp: starValue(h.ratioBp, star) }));
  return out.length > 0 ? out : null;
}

/**
 * ★★「按某个基准取一个量」—— **全仓库唯一实现**。
 *
 * 脉冲治疗 / 脉冲伤害 / 普攻改治疗（芙蓉）都走它。
 * 以前它叫 `pulseBasisAmount`、藏在 `skills.ts` 里，
 * 芙蓉那条 `attackHeals` 就自己另算了一遍（`basis === 'targetMaxHp' ? ... : ...`）——
 * 于是"多条基准相加"要改两处。现在统一到这里。
 */
export function basisAmount(
  caster: UnitState,
  target: UnitState,
  basis: 'attack' | 'maxHp' | 'missingHp' | 'casterMaxHp' | 'targetMaxHp' | undefined,
  ratioBp: number,
): number {
  switch (basis) {
    case 'maxHp':
    case 'targetMaxHp':
      return Math.floor((target.maxHp * ratioBp) / BP);
    case 'missingHp':
      return Math.floor(((target.maxHp - target.hp) * ratioBp) / BP);
    case 'casterMaxHp':
      return Math.floor((caster.maxHp * ratioBp) / BP);
    default:
      return Math.floor((caster.attackDamage * ratioBp) / BP);
  }
}

/** 治疗量 = 各条基准之和（芙蓉/夜莺都可能是两条相加）。 */
export function healAmountOf(
  caster: UnitState,
  target: UnitState,
  heals: readonly ResolvedHeal[],
): number {
  let total = 0;
  for (const h of heals) total += basisAmount(caster, target, h.basis, h.ratioBp);
  return total;
}

/**
 * ★ 0.2：脉冲的**实际间隔**（tick）。
 *
 * 平时就是 `pulse.intervalTicks`；`intervalFromAttackSpeed` 时跟着自己的攻速走
 * （夜莺"按照攻击频率恢复范围内友军的生命值"）。
 *
 * 【为什么抽成函数而不是写在 `tickSkill` 里？】
 * 因为"每 1.2 秒一次的攻击频率到底折成几个 tick"是个**可以单测的纯计算** ——
 * 写在 tick 循环里就只能靠跑一整场战斗去间接验证了。
 * 攻速是 FIX 口径（1000 = 每秒 1 次）。
 */
export function pulseIntervalTicks(unit: UnitState, pulse: ResolvedPulse): number {
  if (!pulse.intervalFromAttackSpeed) return pulse.intervalTicks;
  return Math.max(1, Math.round((TICKS_PER_SECOND * FIX) / Math.max(1, unit.attackSpeed)));
}

export interface ResolvedPulse {
  intervalTicks: number;
  /** ★ 0.2：间隔跟着攻速走（夜莺"按照攻击频率治疗"）—— 实际间隔在用时按当时攻速算 */
  intervalFromAttackSpeed: boolean;
  radius: number;
  affect: 'enemies' | 'allies' | 'both';
  /** ★ 0.2：每跳只挑一个目标（初华：随机一名敌人 / 血量最低的一名友方） */
  single: boolean;
  /** ★ 0.2：治疗优先谁（初华：我方有丰川祥子就优先她） */
  healPreferDefId: string | null;
  /** ★ 0.2：这一拍优先打这个 defId 的敌人（对面没有就随机） */
  attackPreferDefId: string | null;
  damage: { basis: 'attack' | 'maxHp' | 'missingHp'; ratioBp: number; damageType: DamageType } | null;
  heal: readonly ResolvedHeal[] | null;
  buff: SkillStats | null;
  buffDurationTicks: number;
  /**
   * ★★ 0.2 可露希尔 Q.E.D：跳到第 `hits` 跳之后换成这个倍率（数值在收集时按星级定死）。
   * null = 不换（默认，别的脉冲完全不受影响）。
   */
  rampAfterHits: { hits: number; ratioBp: number } | null;
  /** ★★ 0.2：这份脉冲对**每个目标只挂一次**的减益（星级已定死） */
  pulseDebuffOnce: { stats: SkillStats; durationTicks: number } | null;
  /** ★ 0.2.1 表现层：这一拍配哪套专属特效（原样塞进 zone 事件，不进校验和） */
  fx: string | null;
}

export interface ResolvedAllyBuff {
  every: number;
  target: TargetRule;
  stats: SkillStats | null;
  heal: readonly ResolvedHeal[] | null;
  durationTicks: number;
}

export interface ResolvedGuard {
  thresholdBp: number;
  shieldBasisCasterMaxHp: number;
  selfAttackBp: number;
  selfBuffTicks: number;
  maxUses: number;
}

function emptyMods(): Mods {
  return {
    attackDamageBp: 0,
    attackSpeedBp: 0,
    armorFlat: 0,
    magicResistFlat: 0,
    armorBp: 0,
    manaGainBp: 0,
    magicResistBp: 0,
    armorPenBp: 0,
    hpFlat: 0,
    hpBp: 0,
    rangeFlat: 0,
    rangeUnlimited: false,
    moveStepFlat: 0,
    lifestealBp: 0,
    bonusDamage: null,
    splash: null,
    extraTargets: 0,
    multiHit: 1,
    multiHitBp: 10000,
    attackProfile: null,
    lowPresence: false,
    defyDeath: null,
    damageTypeOverride: null,
    farBonus: null,
    rangeAmp: null,
    stunOnHit: null,
    disarmed: false,
    disarmOnHit: null,
    debuffOnHit: null,
    attackHeals: null,
    onHitDot: null,
    everyNthAttack: null,
    vsTraitDamageBp: null,
    noAttack: false,
    noMove: false,
    noManaGain: false,
    attackSpeedLocked: false,
    attackSpeedToAttackRatioBp: 0,
    evasionBp: 0,
    reflect: null,
    untargetable: false,
    cannotDie: false,
    preferLowestHp: false,
    randomAttackTarget: false,
    immuneHits: 0,
    pulse: null,
    onAttackAllyBuff: null,
    allyLowHpGuard: null,
    nearbyEnemyAttackBp: null,
    onKillRefresh: false,
    damageReductionBp: 0,
    farAttackReduction: null,
    damageTakenBp: 0,
    invulnerable: false,
    distanceReduction: null,
    evasionPhysicalBp: 0,
    evasionMagicBp: 0,
    initialManaBp: 0,
    distanceBonus: null,
    manaRegenMilliPerSecond: 0,
  };
}

/**
 * 把一个 SkillStats 合并进 Mods。
 *
 * 两类字段的处理方式不一样，这是刻意的：
 *   · **数值类累加** —— 两个 +30% 攻击力的增益应该变成 +60%
 *   · **布尔/覆盖类"后写的说了算"** —— 玛恩纳的被动写着"不攻击"，
 *     而他的技能增益写着"可以攻击"，那就该以技能为准
 */
function mergeStats(mods: Mods, stats: SkillStats, star: number): void {
  /*
    ★ 0.2：`minStar` —— 这一份属性**只在星级 ≥ N 时生效**。
    用途：予愿安洁莉娜"三星时，技能持续期间获得隐匿" ——
    既不该单独写一套 3 星技能（技能名/介绍在表里都是"（无）"），
    也不该让 1/2 星白拿。所以给那一份包加个门槛。
    ★ 判据放在**合并的最前面**：不满足就直接整份跳过，后面的分支一个都不跑。
  */
  if (stats.minStar !== undefined && star < stats.minStar) return;
  if (stats.attackDamageBp !== undefined) mods.attackDamageBp += starValue(stats.attackDamageBp, star);
  if (stats.attackSpeedBp !== undefined) mods.attackSpeedBp += starValue(stats.attackSpeedBp, star);
  if (stats.armorFlat !== undefined) mods.armorFlat += starValue(stats.armorFlat, star) * FIX;
  if (stats.magicResistFlat !== undefined) mods.magicResistFlat += starValue(stats.magicResistFlat, star) * FIX;
  if (stats.armorBp !== undefined) mods.armorBp += starValue(stats.armorBp, star);
  if (stats.manaGainBp !== undefined) mods.manaGainBp += starValue(stats.manaGainBp, star);
  if (stats.magicResistBp !== undefined) mods.magicResistBp += starValue(stats.magicResistBp, star);
  if (stats.armorPenBp !== undefined) mods.armorPenBp += starValue(stats.armorPenBp, star);
  if (stats.damageTakenBp !== undefined) mods.damageTakenBp += starValue(stats.damageTakenBp, star);
  if (stats.hpFlat !== undefined) mods.hpFlat += starValue(stats.hpFlat, star) * FIX;
  if (stats.hpBp !== undefined) mods.hpBp += starValue(stats.hpBp, star);
  if (stats.rangeFlat !== undefined) mods.rangeFlat += starValue(stats.rangeFlat, star);
  if (stats.moveStepFlat !== undefined) mods.moveStepFlat += starValue(stats.moveStepFlat, star);
  if (stats.lifestealBp !== undefined) mods.lifestealBp += starValue(stats.lifestealBp, star);
  // ★ 0.3 近卫：对射程≥N 的目标增伤（后写的覆盖先写的，和 farBonus 一致）
  if (stats.rangeAmp) {
    mods.rangeAmp = {
      minRange: starValue(stats.rangeAmp.minRange, star),
      totalBp: starValue(stats.rangeAmp.totalBp, star),
    };
  }
  if (stats.extraTargets !== undefined) mods.extraTargets += starValue(stats.extraTargets, star);
  if (stats.evasionBp !== undefined) mods.evasionBp += starValue(stats.evasionBp, star);
  if (stats.evasionPhysicalBp !== undefined) mods.evasionPhysicalBp += starValue(stats.evasionPhysicalBp, star);
  if (stats.evasionMagicBp !== undefined) mods.evasionMagicBp += starValue(stats.evasionMagicBp, star);
  if (stats.initialManaBp !== undefined) mods.initialManaBp += starValue(stats.initialManaBp, star);
  // ★ 0.2：每第 N 次攻击（取第一条，不叠加 —— 没有棋子同时有两套）
  if (stats.everyNthAttack && !mods.everyNthAttack) {
    const spec = stats.everyNthAttack;
    mods.everyNthAttack = {
      every: Math.max(1, spec.every),
      // 只有写了 `bonusDamage` 才有"多打一段伤害"（可露希尔的被动只多打一个人）
      bonus: spec.bonusDamage
        ? {
            basis: spec.bonusDamage.source,
            ratioBp: starValue(spec.bonusDamage.ratioBp, star),
            damageType: spec.bonusDamage.damageType,
          }
        : null,
      extraTargets: Math.max(0, spec.extraTargets ?? 0),
    };
  }
  if (stats.immuneHits !== undefined) mods.immuneHits += starValue(stats.immuneHits, star);
  // 连续攻击次数取**最大值**而不是相加：
  // "3 次连续攻击"和"攻击造成 3 次伤害"是同一件事的两种说法，
  // 叠在一起应该是 3 次，不是 6 次。
  if (stats.multiHit !== undefined) mods.multiHit = Math.max(mods.multiHit, starValue(stats.multiHit, star));
  // ★ 0.1.3：连击每段的伤害比例（锏的"2 次攻击力 90% 的连击"）
  if (stats.multiHitBp !== undefined) mods.multiHitBp = starValue(stats.multiHitBp, star);
  /*
    ★★ 0.2：自定义弹道**后来者覆盖**。
    "被动先挂、技能限时包后挂"是既有顺序，所以祥子的 3 星技能能直接盖掉她的被动；
    写成相加/取最大值都不行 —— 那是两种完全不同的攻击方式，不是可叠加的数值。
  */
  if (stats.attackProfile) mods.attackProfile = resolveAttackProfile(stats.attackProfile, star);
  if (stats.lowPresence === true) mods.lowPresence = true;
  if (stats.defyDeath) {
    mods.defyDeath = {
      hp: Math.max(1, stats.defyDeath.hp ?? 1),
      ticks: Math.max(1, starValue(stats.defyDeath.durationTicks, star)),
      taunt: stats.defyDeath.taunt !== false,
    };
  }

  if (stats.rangeUnlimited !== undefined) mods.rangeUnlimited = stats.rangeUnlimited;
  if (stats.damageTypeOverride !== undefined) mods.damageTypeOverride = stats.damageTypeOverride;
  if (stats.noAttack !== undefined) mods.noAttack = stats.noAttack;
  if (stats.noMove !== undefined) mods.noMove = stats.noMove;
  if (stats.noManaGain !== undefined) mods.noManaGain = stats.noManaGain;
  // ★ 0.2 蕾缪安：攻速恒定 / 攻速折算攻击力
  if (stats.attackSpeedLocked !== undefined) mods.attackSpeedLocked = stats.attackSpeedLocked;
  if (stats.attackSpeedToAttackRatioBp !== undefined) mods.attackSpeedToAttackRatioBp = starValue(stats.attackSpeedToAttackRatioBp, star);
  if (stats.untargetable !== undefined) mods.untargetable = stats.untargetable;
  if (stats.cannotDie !== undefined) mods.cannotDie = stats.cannotDie;
  if (stats.onKillRefresh !== undefined) mods.onKillRefresh = stats.onKillRefresh;
  // 无敌用"或"而不是"后写的说了算"：它是绝不可能被别的增益"顺手取消"的
  if (stats.invulnerable === true) mods.invulnerable = true;
  if (stats.preferLowestHp !== undefined) mods.preferLowestHp = mods.preferLowestHp || stats.preferLowestHp;
  if (stats.randomAttackTarget === true) mods.randomAttackTarget = true;

  if (stats.bonusDamage) {
    mods.bonusDamage = {
      source: stats.bonusDamage.source,
      ratioBp: starValue(stats.bonusDamage.ratioBp, star),
      damageType: stats.bonusDamage.damageType,
    };
  }
  if (stats.splash) {
    mods.splash = {
      radius: stats.splash.radius,
      shape: stats.splash.shape ?? 'square',
      ratioBp: starValue(stats.splash.ratioBp, star),
      damageType: stats.splash.damageType,
      hits: stats.splash.hits !== undefined ? starValue(stats.splash.hits, star) : 1,
      basis: stats.splash.basis ?? 'dealt',
      // ★ 0.2：特效标记原样带过（它不随星级变，也没有数值含义）
      ...(stats.splash.fx ? { fx: stats.splash.fx } : {}),
    };
  }
  if (stats.farBonus) {
    mods.farBonus = {
      minDistance: stats.farBonus.minDistance,
      ratioBp: starValue(stats.farBonus.ratioBp, star),
      damageType: stats.farBonus.damageType,
    };
  }
  if (stats.stunOnHit) {
    mods.stunOnHit = {
      chanceBp: starValue(stats.stunOnHit.chanceBp, star),
      durationTicks: starValue(stats.stunOnHit.durationTicks, star),
      perHit: stats.stunOnHit.perHit === true,
    };
  }
  /*
    ★ 0.1.3 战栗：和眩晕是**两种东西**。
    眩晕 = 不能动不能打（走 + 打全停）；战栗 = 只有普攻被按住，走位和技能照旧。
    所以它不能复用 stun —— 表现在界面上也是两条不同的效果（见 status-effects）。
  */
  if (stats.disarmed !== undefined) mods.disarmed = stats.disarmed;
  if (stats.disarmOnHit) {
    mods.disarmOnHit = {
      chanceBp: starValue(stats.disarmOnHit.chanceBp, star),
      durationTicks: starValue(stats.disarmOnHit.durationTicks, star),
      perHit: stats.disarmOnHit.perHit === true,
    };
  }
  /*
    ★ 0.2：命中给**目标**挂减益（伊内丝）。
    ★★ 嵌套的 `stats` 必须**在这里**就把星级定死 —— 它会被挂到敌人身上，
    如果留着 StarValue，之后 `collectMods(敌人)` 会按**敌人**的星级解析
    （1 星伊内丝打 3 星敌人 ⇒ 削的攻速按 3 星算，莫名其妙翻几倍）。
  */
  if (stats.debuffOnHit) {
    mods.debuffOnHit = {
      chanceBp: stats.debuffOnHit.chanceBp !== undefined ? starValue(stats.debuffOnHit.chanceBp, star) : 10000,
      durationTicks: starValue(stats.debuffOnHit.durationTicks, star),
      stats: resolveStatsForStar(stats.debuffOnHit.stats, star),
    };
  }
  if (stats.attackHeals) {
    mods.attackHeals = resolveHeals(stats.attackHeals, star);
  }
  /*
    ★ 0.2 截云的「裂痕」：攻击命中时给目标附一份持续伤害。
    `power` 是**千分比**（和技能 dot/damage 同一口径：200 = 攻击力的 20%）。
  */
  if (stats.onHitDot) {
    mods.onHitDot = {
      power: starValue(stats.onHitDot.power, star),
      damageType: stats.onHitDot.damageType,
      durationTicks: starValue(stats.onHitDot.durationTicks, star),
      intervalTicks: Math.max(1, stats.onHitDot.intervalTicks ?? TICKS_PER_SECOND),
    };
  }
  if (stats.vsTraitDamageBp) {
    mods.vsTraitDamageBp = {
      trait: stats.vsTraitDamageBp.trait,
      exclude: stats.vsTraitDamageBp.exclude ?? false,
      ratioBp: starValue(stats.vsTraitDamageBp.ratioBp, star),
    };
  }
  if (stats.reflect) {
    mods.reflect = {
      ratioBp: starValue(stats.reflect.ratioBp, star),
      capAttackBp: stats.reflect.capAttackBp ?? 0,
    };
  }
  if (stats.pulse) {
    const p = stats.pulse;
    mods.pulse = {
      intervalTicks: Math.max(1, p.intervalTicks),
      intervalFromAttackSpeed: p.intervalFromAttackSpeed === true,
      radius: p.radius ?? 2,
      affect: p.affect,
      single: p.single === true,
      healPreferDefId: p.healPreferDefId ?? null,
      attackPreferDefId: p.attackPreferDefId ?? null,
      damage: p.damage
        ? { basis: p.damage.basis ?? 'attack', ratioBp: starValue(p.damage.ratioBp, star), damageType: p.damage.damageType }
        : null,
      heal: resolveHeals(p.heal, star),
      buff: p.buff ?? null,
      buffDurationTicks: p.buffDurationTicks ?? 0,
      /*
        ★ 0.2 可露希尔 Q.E.D：两条脉冲扩展都在**收集时**把星级定死
        （和 `debuffOnHit` 同一个理由：倍率/减益是施法者给的，不该按被打的人的星级算）。
      */
      rampAfterHits: p.rampAfterHits
        ? { hits: Math.max(0, p.rampAfterHits.hits), ratioBp: starValue(p.rampAfterHits.ratioBp, star) }
        : null,
      pulseDebuffOnce: p.pulseDebuffOnce
        ? {
            stats: resolveStatsForStar(p.pulseDebuffOnce.stats, star),
            durationTicks: p.pulseDebuffOnce.durationTicks,
          }
        : null,
      // ★ 0.2.1：表现层 key，原样带到 zone 事件（渲染层查注册表）
      fx: p.fx ?? null,
    };
  }
  if (stats.onAttackAllyBuff) {
    const a = stats.onAttackAllyBuff;
    mods.onAttackAllyBuff = {
      every: Math.max(1, a.every),
      target: a.target,
      stats: a.stats ?? null,
      heal: resolveHeals(a.heal, star),
      durationTicks: a.durationTicks,
    };
  }
  if (stats.allyLowHpGuard) {
    const g = stats.allyLowHpGuard;
    mods.allyLowHpGuard = {
      thresholdBp: g.thresholdBp,
      shieldBasisCasterMaxHp: starValue(g.shieldBasisCasterMaxHp, star),
      selfAttackBp: starValue(g.selfAttackBp, star),
      selfBuffTicks: g.selfBuffTicks,
      maxUses: Math.max(1, starValue(g.maxUses, star)),
    };
  }
  if (stats.nearbyEnemyAttackBp) {
    mods.nearbyEnemyAttackBp = {
      radius: stats.nearbyEnemyAttackBp.radius,
      ratioBp: starValue(stats.nearbyEnemyAttackBp.ratioBp, star),
    };
  }
}

/**
 * 算出这个棋子**当前**生效的全部修正。
 *
 * 顺序：被动 -> 各个增益包（按挂上去的先后）。
 * 动态条件（号角"有敌人进入周围8格时 +20% 攻击力"）也在这里判断 ——
 * 它每次都要按**当前**站位重算，不能提前烘死。
 *
 * 【性能】一场战斗里这个函数会被调用几千次。它只遍历"挂在这个棋子身上的
 * 几个包"，不遍历全场，所以开销可以忽略（比求一次距离还便宜）。
 */
export function collectMods(state: BattleState, unit: UnitState): Mods {
  const mods = emptyMods();

  if (unit.skillPassive) mergeStats(mods, unit.skillPassive, unit.star);

  const runtime = unit.skill;
  if (runtime) {
    // 数组本身就是追加序，不需要排序 —— "后写的说了算"这条规则靠的就是它
    for (const buff of runtime.buffs) {
      if (buff.ticksLeft <= 0) continue;
      if (buff.attackCharges !== undefined && buff.attackCharges <= 0) continue;
      mergeStats(mods, buff.stats, unit.star);
    }
  }

  // 动态：周围有敌人就加攻击力（号角「有敌人进入周围 8 格时 +20% 攻击力」）
  if (mods.nearbyEnemyAttackBp) {
    const radius = mods.nearbyEnemyAttackBp.radius;
    for (const other of state.units) {
      if (other.dead || other.team === unit.team) continue;
      // 「周围 8 格」= 紧贴的一圈，含斜角 —— 用方块半径，不是曼哈顿
      if (withinRadius(unit.cell, other.cell, radius)) {
        mods.attackDamageBp += mods.nearbyEnemyAttackBp.ratioBp;
        break;
      }
    }
  }

  /*
    ★ 0.0.3：藏品给的"减伤类"修正。
    它们不是 SkillStats（没法通过 mergeStats 合并成数字），而是写在机制里的，
    所以在最后单独扫一遍：
      · farAttackReduction 挂在**棋子自己**身上（A 类藏品：防爆盾）
      · damageReduction    挂在**队伍**身上（B 类藏品：奇缘面具），每队只有一份，
        所以从 state.teamMechanics 里读，而不是给每个棋子抄一遍
  */
  for (const mechanic of unit.trait?.mechanics ?? []) {
    if (mechanic.kind === 'farAttackReduction') {
      mods.farAttackReduction = { minDistance: mechanic.minDistance, ratioBp: mechanic.ratioBp };
    } else if (mechanic.kind === 'armorPen') {
      // 攻击方：无视目标护甲的比例
      mods.armorPenBp += mechanic.ratioBp;
    } else if (mechanic.kind === 'distanceReduction') {
      // 挨打方：按距离减伤（博卓卡斯替一阶段）
      mods.distanceReduction = { perCellBp: mechanic.perCellBp, maxBp: mechanic.maxBp };
    } else if (mechanic.kind === 'distanceBonus') {
      /*
        ★ 0.1.1：打人方 —— 按距离增伤（Blaze 电锯 / Scout 狙击镜）。
        和距离减伤方向相反、位置也不同：这条挂在**攻击者**身上，
        真正生效在 combat-math.ts 的 dealDamage 里（要拿到攻守两边的坐标）。
      */
      mods.distanceBonus = { mode: mechanic.mode, perCellBp: mechanic.perCellBp, maxBp: mechanic.maxBp };
    } else if (mechanic.kind === 'lowHpAttack') {
      // ★ 0.1.1：血量越低攻击力越高（热辣可可）
      mods.attackDamageBp += lowHpBonusBp(unit, mechanic.hpThresholdBp, mechanic.maxBonusBp);
    } else if (mechanic.kind === 'lowHpSpeed') {
      // ★ 0.1.1：血量越低攻速越快（紧急活性剂）
      mods.attackSpeedBp += lowHpBonusBp(unit, mechanic.hpThresholdBp, mechanic.maxBonusBp);
    } else if (mechanic.kind === 'lowHpManaRegen') {
      // ★ 0.1.1：血量越低回蓝越快（止痛片）。折算成"每秒多少毫点法力"（整数，保确定性）
      const scaleBp = lowHpBonusBp(unit, mechanic.hpThresholdBp, 10000);
      mods.manaRegenMilliPerSecond += Math.floor((scaleBp * mechanic.maxPerSecond * 1000) / BP);
    } else if (mechanic.kind === 'pairRequires' && mechanic.damageType) {
      /*
        ★ 0.0.3：成对光环（深池伙友影刃精英「场上有卫队精英时普攻打法术」）。
        每次合并修正时按**当前**场上情况判定 —— 同伴死了就该变回物理，
        所以不能开战烘死。代价是每次 collectMods 多扫一遍同队棋子，
        只对带这条机制的棋子生效。
      */
      if (allyDefAlive(state, unit, mechanic.requiresDefId)) mods.damageTypeOverride = mechanic.damageType;
    }
  }
  for (const runtime of state.teamMechanics?.[unit.team] ?? []) {
    if (runtime.mechanic.kind === 'damageReduction') mods.damageReductionBp += runtime.mechanic.ratioBp;
  }

  return mods;
}

/** 棋子的有效攻击距离（含技能的 +N 格 / 全场） */
export function effectiveRange(state: BattleState, unit: UnitState): number {
  const mods = collectMods(state, unit);
  if (mods.rangeUnlimited) return Math.max(BOARD_W, BOARD_H) * 2;
  return Math.max(1, unit.range + mods.rangeFlat);
}

/**
 * ★ 0.2：这只棋子"额外获得"的攻速（万分比，可能为负）。
 *
 * 单独抽出来是因为**两处**要用同一份口径：
 *   · `effectiveAttackSpeed` 拿它算攻速；
 *   · `effectiveAttackDamage` 在"攻速恒定 + 攻速折算攻击力"（蕾缪安）时拿它算折算。
 * 各写一遍的话，哪天加减一项（比如再加一种攻速来源）就会两边不一致。
 */
function speedBonusBp(unit: UnitState, mods: Mods): number {
  const statusBp = unit.statuses['attackSpeedBonusBp'] ?? 0;
  const traitBp = (unit.trait?.bonusAttackSpeedBp ?? 0) + (unit.trait?.surgeSpeedBp ?? 0);
  return statusBp + traitBp + mods.attackSpeedBp;
}

/** 计算棋子的实际攻速（含技能 buff、羁绊叠层） */
export function effectiveAttackSpeed(unit: UnitState, mods: Mods): number {
  /*
    ★ 0.2 蕾缪安：`attackSpeedLocked`（"攻速恒定"）——
    任何加成都不再改攻速，原样返回面板值。那些加成不会白丢：
    `effectiveAttackDamage` 会把它们折成攻击力。
  */
  if (mods.attackSpeedLocked) return unit.attackSpeed;
  const total = BP + speedBonusBp(unit, mods);
  // 攻速可能被减（远牙 -30%），但不会减到 0 或负数
  return Math.max(50, Math.floor((unit.attackSpeed * Math.max(100, total)) / BP));
}

/** 计算棋子的实际攻击力（含技能 buff、低血爆发给的攻击力） */
export function effectiveAttackDamage(unit: UnitState, mods: Mods): number {
  const statusBp = unit.statuses['attackDamageBonusBp'] ?? 0;
  const traitBp = unit.trait?.surgeAttackBp ?? 0;
  /*
    ★ 0.2 蕾缪安：「攻速恒定 0.55，每额外获得 1% 的攻速转化为 0.1% 的攻击力」。
    折算的**只算"额外获得"那一部分**（负数不加成也不倒扣）——
    基础攻速本身不是"额外获得的"，把它算进去等于白送一份攻击力。
  */
  let conversionBp = 0;
  if (mods.attackSpeedToAttackRatioBp > 0) {
    const extra = speedBonusBp(unit, mods);
    if (extra > 0) conversionBp = Math.floor((extra * mods.attackSpeedToAttackRatioBp) / BP);
  }
  const total = BP + statusBp + traitBp + mods.attackDamageBp + conversionBp;
  return Math.max(0, Math.floor((unit.attackDamage * Math.max(0, total)) / BP));
}

/**
 * 棋子的有效护甲 / 魔抗（含技能 +N 与百分比修正）。
 *
 * ★ 0.0.3：多加了一层**百分比**修正（`armorBp`），用来表达"降 50% 物抗"这种
 * 按比例的效果 —— 绝对值加减（armorFlat）表达不了它。
 * 顺序固定：先绝对加减、再乘百分比、最后夹到 0 以上。
 */
export function effectiveArmor(unit: UnitState, mods: Mods): number {
  const flat = Math.max(0, unit.armor + mods.armorFlat);
  if (mods.armorBp === 0) return flat;
  return Math.max(0, Math.floor((flat * Math.max(0, BP + mods.armorBp)) / BP));
}

export function effectiveMagicResist(unit: UnitState, mods: Mods): number {
  const flat = Math.max(0, unit.magicResist + mods.magicResistFlat);
  if (mods.magicResistBp === 0) return flat;
  return Math.max(0, Math.floor((flat * Math.max(0, BP + mods.magicResistBp)) / BP));
}

/** 场上（同队、存活）有没有某个 defId 的同伴 —— 成对光环用 */
function allyDefAlive(state: BattleState, unit: UnitState, defId: string): boolean {
  for (const other of state.units) {
    if (other.dead || other.team !== unit.team) continue;
    if (other.defId === defId) return true;
  }
  return false;
}

/** 这个棋子身上有没有某种机制（战斗循环里查"有没有"的统一入口） */
export function hasMechanic(unit: UnitState, kind: ScopedMechanic['kind']): boolean {
  for (const mechanic of unit.trait?.mechanics ?? []) {
    if (mechanic.kind === kind) return true;
  }
  return false;
}

/** 取这个棋子上所有某种机制（顺序 = mechanics 数组顺序，确定性） */
export function mechanicsOf<T extends ScopedMechanic['kind']>(
  unit: UnitState,
  kind: T,
): Extract<ScopedMechanic, { kind: T }>[] {
  const out: Extract<ScopedMechanic, { kind: T }>[] = [];
  for (const mechanic of unit.trait?.mechanics ?? []) {
    if (mechanic.kind === kind) out.push(mechanic as Extract<ScopedMechanic, { kind: T }>);
  }
  return out;
}

/** 还能不能放技能（法力满 + 技能有可释放的效果） */
export function canCast(unit: UnitState): boolean {
  return unit.mana >= MANA_MAX;
}

// ============================================================
// 修正包的生命周期
// ============================================================

/** 挂一个修正包上去，并把血量上限重算一遍 */
export function addBuff(unit: UnitState, buff: SkillBuff): void {
  const runtime = unit.skill;
  if (!runtime) return;
  runtime.buffs.push(buff);
  runtime.version++;
  runtime.pulseTimer = 0;
  /*
    ★★ 0.2 可露希尔 Q.E.D：新挂上的这一包**自带脉冲**时，"已经跳过几次"和
    "已经被这份减益打过的目标名单"一起归零 —— 否则第二次开技能会接着上次的跳数算，
    一上来就是 180%（用户报的"技能越放越强"就是这类计数没归零）。
    ★ 只在带脉冲的包上清：攻速光环之类的包每几秒就往身上挂一次，
      跟着它们清会把计数打断在技能中途。
  */
  if (buff.stats.pulse) {
    runtime.pulseHits = 0;
    runtime.pulseDebuffed = [];
  }
  refreshMaxHp(unit);
}

/**
 * 重算血量上限。
 *
 * 【为什么要单独一个函数？】
 * 因为维娜·维多利亚 3 星会临时给我方全体 +1000% 生命上限，10 秒后收回。
 * 如果直接改 maxHp，收回时就不知道原本是多少了。
 * 所以原始值存在 baseMaxHp 里，maxHp 永远 = (baseMaxHp + 固定加成) × 百分比加成。
 */
export function refreshMaxHp(unit: UnitState): void {
  if (!unit.skill) return;
  let hpFlat = 0;
  let hpBp = 0;
  for (const buff of unit.skill.buffs) {
    if (buff.ticksLeft <= 0) continue;
    if (buff.stats.hpFlat !== undefined) hpFlat += starValue(buff.stats.hpFlat, unit.star) * FIX;
    if (buff.stats.hpBp !== undefined) hpBp += starValue(buff.stats.hpBp, unit.star);
  }
  if (unit.skillPassive?.hpFlat !== undefined) hpFlat += starValue(unit.skillPassive.hpFlat, unit.star) * FIX;
  if (unit.skillPassive?.hpBp !== undefined) hpBp += starValue(unit.skillPassive.hpBp, unit.star);

  const next = Math.floor(((unit.baseMaxHp + hpFlat) * (BP + hpBp)) / BP);
  unit.maxHp = Math.max(1, next);
  // 上限降回去时，当前血量要跟着夹住（否则血条会显示成 120%）
  if (unit.hp > unit.maxHp) unit.hp = unit.maxHp;
}

/** 把"永久"写成一个好认的名字，免得数据里到处是 MAX_BATTLE_TICKS */
export const FOREVER_TICKS = MAX_BATTLE_TICKS;

/**
 * ★★ 0.2：**解析后的自定义普攻弹道**（`SkillStats.attackProfile` 的星级展开版）。
 *
 * 收集时就按**施法者星级**把每段的倍率定死 —— 和别的数值字段同一个口径，
 * 免得战斗里再翻一次星级（那会让"1 星若麦打 3 星敌人"这种组合算错）。
 */
export interface ResolvedAttackProfile {
  hits: Array<{ bp: number; damageType?: DamageType }>;
  maxTargets: number;
  pierceLength: number;
  randomTarget: boolean;
  fx?: string;
}

export function resolveAttackProfile(profile: AttackProfile, star: number): ResolvedAttackProfile {
  return {
    hits: profile.hits.map((hit) => ({
      bp: starValue(hit.bp, star),
      ...(hit.damageType ? { damageType: hit.damageType } : {}),
    })),
    maxTargets: Math.max(1, profile.maxTargets ?? 1),
    pierceLength: Math.max(0, profile.pierceLength ?? 0),
    randomTarget: profile.randomTarget === true,
    ...(profile.fx ? { fx: profile.fx } : {}),
  };
}
