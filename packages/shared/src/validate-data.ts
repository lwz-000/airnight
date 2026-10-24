import { BP, FIX, MANA_MAX } from './constants.js';
import { TRAIT_DEFS, isPlayableDef } from './unit-data.js';
import type {
  ItemDef,
  ItemDefTable,
  ItemRarity,
  ItemSlot,
  SkillEffect,
  SkillStats,
  TargetRule,
  UnitDef,
  UnitDefTable,
} from './types.js';

/**
 * ============================================================
 *  棋子数据表校验器 —— 给「改数据表的人」的安全网
 * ============================================================
 *
 * 【为什么需要这个东西？】
 * 你（非程序员）以后加角色、调数值，主要就是改 unit-data.ts 这张表。
 * 但改表很容易出这几类问题，而且它们的后果差别很大：
 *
 *   · 打错字（种族写成 'knigt'）    -> 不报错，但羁绊永远不生效，极难发现
 *   · 技能 id 撞车                 -> 不报错，但日志里分不清是谁的技能
 *   · 少填字段                     -> 要么编译不过，要么运行时出现 undefined
 *   · 数值抄漏一位（hp: 55 而不是 550）-> 完全不报错，只是这个棋子变成废物
 *
 * 前几类属于「必须拦下来」的硬错误；最后一类属于「要提醒但不该拦」的软警告 ——
 * 因为平衡性判断最终得靠你自己拍板，工具不该替你做决定。
 *
 * 所以这个校验器把问题分成两级：
 *   error   必须修，否则游戏会出问题（测试会失败，CI 会拦）
 *   warning 建议看看，但可以是有意为之（只提示，不拦）
 */

export type ValidationCode =
  // ---- 硬错误 ----
  | 'UNKNOWN_TRAIT_KIND'
  | 'TOO_MANY_TRAITS'
  | 'DUPLICATE_SKILL_ID'
  | 'DUPLICATE_DEF_ID'
  | 'EMPTY_TRAITS'
  | 'BAD_STAR_MULTIPLIER'
  | 'BAD_DAMAGE_TYPE'
  | 'TARGET_RULE_WITHOUT_FALLBACK'
  | 'FALLBACK_SAME_AS_TARGET'
  // ---- 召唤物专用（它们故意"不像干员"，所以只查最基本的三件事）----
  | 'SUMMON_NO_SKILL'
  | 'SUMMON_NO_HP'
  | 'SUMMON_BAD_OWNER'
  // ---- 野怪专用（同样"不像干员"：没有羁绊、不升星、不进商店）----
  | 'MONSTER_NO_SKILL'
  | 'MONSTER_NO_HP'
  | 'MONSTER_NO_TIER'
  // ---- 软警告 ----
  | 'TRAIT_UNDERUSED'
  | 'POWER_OUTLIER'
  | 'SKILL_ID_NOT_PREFIXED'
  | 'NO_ANY_EFFECT'
  | 'SUSPICIOUS_ZERO'
  | 'DESC_MISSING_KEYWORD'
  | 'MELEE_LOW_HP'
  | 'RANGED_HIGH_ARMOR'
  // ---- 藏品专用（★ 0.0.3）----
  | 'ITEM_BAD_ID'
  | 'ITEM_NO_NAME'
  | 'ITEM_BAD_SLOT'
  | 'ITEM_BAD_RARITY'
  | 'ITEM_BAD_ICON'
  | 'ITEM_MIXED_SCOPE'
  | 'ITEM_BAD_TRAIT'
  | 'ITEM_BAD_MECHANIC'
  | 'ITEM_BAD_BATTLE_START'
  | 'ITEM_CONSUME_NO_EFFECT'
  // ---- ★ 0.3.2 升变之证（阿米娅「不容拒绝」）----
  | 'ITEM_BAD_ASCEND'
  | 'ITEM_NO_EFFECT';

export interface ValidationIssue {
  severity: 'error' | 'warning';
  code: ValidationCode;
  /** 出问题的棋子 id（可能为空，表示是表级问题） */
  unitId: string;
  /** 具体是哪个字段，例如 'base.hp' */
  field: string;
  /** 给人看的说明：哪里错了 + 为什么是问题 + 怎么改 */
  message: string;
}

export interface ValidationReport {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  /** 表里有多少个棋子 */
  unitCount: number;
  /** 统计信息，供你判断数据分布是否合理 */
  stats: {
    byCost: Array<{ cost: number; count: number }>;
    traits: Array<{ trait: string; count: number }>;
    /** 每个棋子的「强度分」，用来横向比较谁超模谁废 */
    power: Array<{ unitId: string; name: string; cost: number; power: number }>;
  };
}

/**
 * 种族与职业的合法清单移到 trait-kinds.ts 了。
 * 这里重新导出，保持向后兼容（以前的代码和测试都从这里拿）。
 */
export { TRAIT_KINDS };

import { TRAIT_KINDS } from './trait-kinds.js';

/** 各种技能效果的大致「强度权重」 */
const EFFECT_WEIGHT: Record<string, number> = {
  damage: 1.0,
  heal: 0.8,
  shield: 0.9,
  stun: 1.2,
  buffAttackSpeed: 0.7,
  buffAttackDamage: 0.8,
  gainMana: 0.3,
};

/**
 * 各类效果的「参考强度」，用来把不同的效果拉到同一量级再相加。
 * 例如伤害的参考倍率是 1000（100% 攻击力），一个 2500 的伤害技能算 2.5 个标准单位。
 */
const EFFECT_REFERENCE: Record<string, number> = {
  damage: 1000,
  heal: 1200,
  shield: 1000,
  stun: 30, // tick，30 tick = 1.5 秒
};

/**
 * 把「一个数 或 三个数（1/2/3星）」的星级数值收敛成一个数 —— 取三星那个（最后一个）。
 *
 * 检查工具需要一个具体数字才能估强度，而技能数据里 power 支持按星级写
 * （`50%/100%/130%` 就是 `[500, 1000, 1300]`）。
 * 取三星是刻意的：**平衡检查要按最强的那一档来看**，
 * 拿一星的值去估会得出"这个 5 费好弱"的错误结论。
 */
function starNumeric(value: number | readonly number[] | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') return value;
  if (value.length === 0) return undefined;
  return value[value.length - 1];
}

/** 倍率合法性检查：返回 null 表示有问题 */
function checkPower(value: unknown): number | null {
  const numeric = starNumeric(value as number | readonly number[] | undefined);
  if (numeric === undefined) return null;
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

/**
 * 单个效果最多折算成几个"标准单位"。
 *
 * 【为什么必须封顶？】
 * 因为"回满血"这种效果的 power 是 100000（100% 生命上限），
 * 而伤害的 power 1000 才是 100% 攻击力。两者量纲差 100 倍，
 * 不封顶的话维娜·维多利亚 3 星的"回满生命值"会被算成 80 多个标准单位，
 * 直接把她顶到全表第一名 —— 然后你会收到一条"这个 5 费严重超模"的假警报。
 * 假警报比不报警更糟：它会让你去改本来没问题的数值。
 */
const NORMALIZED_CAP = 8;

/**
 * 同一个 power 数字，在不同 basis 下的量纲不一样，参考值要跟着变。
 *   · attack      -> 1000 = 100% 攻击力
 *   · maxHp 类    -> 10000 = 100% 生命上限（所以参考值要 ×10）
 */
function referenceFor(kind: string, basis: unknown): number {
  const base = EFFECT_REFERENCE[kind] ?? 1000;
  if (basis === 'targetMaxHp' || basis === 'casterMaxHp' || basis === 'maxHp') return base * 10;
  return base;
}

/**
 * 被动技能折算成"等价强度分"。
 *
 * 【为什么需要这一坨？】
 * 因为强度分原本只看 `effects`。你现在有一批**纯被动**棋子（夜莺、星熊、
 * 玛恩纳…），它们的技能全写在 passive 里 —— 不看被动的话它们会被算成
 * "没有技能"，于是全部被标成"偏废，玩家不会想买"。
 * 那是**工具的错**，不是数据的错，会把你引到错误的方向去。
 *
 * 权重是"多少个标准单位"的粗略感觉，不求精确：
 * 它的用途是抓异常（差 2 倍以上），不是给你一个可以互相比大小的绝对分数。
 */
const PASSIVE_WEIGHT: Record<string, number> = {
  attackDamageBp: 1 / 2000, // +100% 攻击力 ≈ 5 个标准单位
  attackSpeedBp: 1 / 2000,
  armorFlat: 1 / 40,
  magicResistFlat: 1 / 40,
  hpFlat: 1 / 1000,
  hpBp: 1 / 2000,
  rangeFlat: 0.5,
  lifestealBp: 1 / 4000,
  extraTargets: 1,
  multiHit: 1.5,
  evasionBp: 1 / 4000,
  immuneHits: 0.4,
  stunOnHit: 1,
  bonusDamage: 1,
  splash: 1.5,
  farBonus: 0.8,
  attackHeals: 1,
  reflect: 0.8,
  pulse: 1.5,
  onAttackAllyBuff: 1,
  allyLowHpGuard: 1.2,
  // ★ 0.2：空弦"每上场 2 名 [远射] 干员，攻击距离 +2 格"
  allyTraitRangeFlat: 0.5,
  // ★ 0.2：截云"普攻附带的持续伤害" / 洛洛"技能结束时的伤害"
  onHitDot: 1.2,
  onExpireDamage: 0.8,
  nearbyEnemyAttackBp: 0.6,
  vsTraitDamageBp: 0.8,
  preferLowestHp: 0.4,
  untargetable: 1.5,
  cannotDie: 2.5,
  rangeUnlimited: 1.5,
  moveStepFlat: 0.3,
  damageTypeOverride: 0.4,
  onKillRefresh: 0.8,
  // 负面（代价）
  noAttack: -1.5,
  noMove: -1.5,
};

function passiveScore(stats: SkillStats | undefined): number {
  if (!stats) return 0;
  let score = 0;
  for (const [key, weight] of Object.entries(PASSIVE_WEIGHT)) {
    const value = (stats as Record<string, unknown>)[key];
    if (value === undefined || value === false || value === null) continue;
    if (typeof value === 'number') {
      // 数值类：权重就是"每 1 点值多少分"
      score += weight * (weight > 0 ? value : 1);
    } else if (Array.isArray(value)) {
      const numeric = starNumeric(value as readonly number[]) ?? 0;
      score += weight * (weight > 0 ? numeric : 1);
    } else {
      // 对象类（bonusDamage / splash / pulse…）：算一个固定值
      score += weight;
    }
  }
  return Math.max(0, score);
}

/**
 * 给一个棋子打「强度分」。
 *
 * 这是个粗略的启发式指标，目的不是精确评估，而是**发现明显异常**：
 * 比如同费用的两个棋子差了两三倍，或者某个数值多写了一位数。
 *
 * 分数 ≈ 生存能力 + 每秒输出 + 技能价值
 *
 * 【量纲说明 —— 这里我连着写错过两次，记下来】
 *   第一次：血量和 DPS 直接相加。一个是存量、一个是流量，加起来没意义。
 *   第二次：把每个技能效果的 power 直接累加。技能倍率是千分比，
 *           结果「造成 2200% 伤害」被算成 660 分，把射手抬到坦克的 20 倍。
 *   第三次：只看 effects，于是**纯被动棋子全被算成 0 分**（见 passiveScore）。
 *   正确做法：每个效果先除以它的「参考强度」归一化，再乘权重相加；
 *             被动按字段折算；取"1/2 星技能"和"3 星专属技能"里更强的那个。
 */
export function estimatePower(def: UnitDef): number {
  const base = def.base;

  // 生存：血量按护甲放大（护甲越高，同样的血越耐打），再缩放到单位量级
  const armorFactor = 1 + base.armor / (base.armor + 100);
  const survival = (base.hp * armorFactor) / 100;

  // 输出：每秒伤害，同样缩放到单位量级
  const dps = (base.attackDamage * base.attackSpeed) / 1000 / 100;

  // 技能：每个效果先归一化到「几个标准单位」，再加权
  const scoreEffects = (effects: readonly SkillEffect[]): number =>
    effects.reduce((sum, effect) => {
      const weight = EFFECT_WEIGHT[effect.kind] ?? 0.5;
      let units = 1; // 不带数值的效果（召唤、复活、传送…）算 1 个标准单位
      if ('power' in effect) {
        // power 可以是「一个数」或「三个数（1/2/3星）」，统一取三星那个值来估强度
        const power = starNumeric(effect.power);
        const basis = 'basis' in effect ? effect.basis : undefined;
        const reference = referenceFor(effect.kind, basis);
        if (power !== undefined && power > 0 && reference > 0) {
          units = Math.min(power / reference, NORMALIZED_CAP);
        }
      } else if (effect.kind === 'stun') {
        // ★ 0.2：时长可能是"三个数（1/2/3星）"，和其他字段一样按三星那个值估强度
        units = (starNumeric(effect.durationTicks) ?? 0) / (EFFECT_REFERENCE['stun'] ?? 30);
      }
      return sum + weight * units;
    }, 0);

  // 「1/2 星那套」和「3 星专属那套」取更强的那个 ——
  // 因为"这个棋子强不强"要按它**练满之后**的样子看
  const skillScore = Math.max(
    scoreEffects(def.skill.effects),
    def.skill.star3 ? scoreEffects(def.skill.star3.effects) : 0,
  );
  // 被动折算（纯被动棋子的技能价值全在这里）
  const passive = Math.max(
    passiveScore(def.skill.passive),
    def.skill.star3?.passive ? passiveScore(def.skill.star3.passive) : 0,
  );

  // 升星收益也计入强度（升星快 = 后期强）
  const starGain = (def.starHpBp + def.starDamageBp) / 2000;

  return Math.round((survival + dps + (skillScore + passive) * 12) * starGain);
}

/**
 * 各费用棋子的绝对强度上限。
 *
 * 【这个数字只用来抓「明显抄错量级」】
 * 它故意放得很宽（比正常数值高一个量级），因为：
 *   · 太紧会和「同费用中位数离群」那条重叠，同一个问题报两次、
 *     而且先撞到哪条不确定，用户会困惑
 *   · 平衡性判断最终得靠你自己拍板，工具只该拦住「hp 写了 5500 而不是 550」
 *     这种一眼就是多按了个 0 的错误
 * 参考：当前数据里 2 费棋子的强度分约 70，所以上限 400 相当于「多了约 5 倍」。
 */
const POWER_HARD_CAP: Record<number, number> = {
  1: 350,
  2: 400,
  3: 450,
  4: 550,
  5: 650,
};

/**
 * 同费用内，偏离中位数多少倍算异常。
 *
 * 【为什么要按样本量调整阈值？】
 * 因为中位数在样本量小时"不敏感"：
 *   n=3 时，中位数就是三个数里中间那个。
 *   如果有两个正常棋子（100、100）和一个超模的，中位数还是 100，
 *   超模那个要 ≥ 2.2 倍（220）才报 —— 看起来合理。
 *   但如果只有一个正常棋子（100）和两个超模的（300、300），
 *   中位数变成 300 —— 这时候该报的是那个 100 的"偏废"，判断会反。
 * 样本越大，中位数越可靠，阈值就可以越严。
 * 样本太小（< 3）时干脆不判断，交给「绝对量级上限」那条兜底。
 *
 * 【★ 阈值为什么比第一版放宽了？】
 * 第一版只数 `effects` 里的技能效果。现在 50 个干员的技能全录进来了，
 * 而且**被动技能也计入强度分**（不然纯被动棋子全被算成 0 分），
 * 于是"同费用内的正常差距"本来就变大了 —— 沿用旧阈值会一口气报 10 条，
 * 而其中大部分是"这个 5 费的技能确实比那个 5 费强一截"，属于正常设计差异。
 * 假警报多了比不报警更糟：你会开始无视这个报告。
 * 所以阈值放宽，只抓"差了一个量级"的那种，**真正的平衡判断交给
 * `node scripts/pnpm.mjs balance` 的实际对战胜率**。
 */
function outlierThresholds(sampleSize: number): { high: number; low: number } {
  if (sampleSize <= 3) return { high: 3.5, low: 0.3 };
  if (sampleSize <= 5) return { high: 2.8, low: 0.36 };
  return { high: 2.5, low: 0.4 };
}

/**
 * 校验整张棋子表。
 *
 * @param defs 棋子表
 * @param options.knownUnitIds 如果传了，会检查每个棋子的 id 是否和它作为 key 一致
 */
export function validateUnitTable(defs: UnitDefTable): ValidationReport {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const skillIdOwners = new Map<string, string[]>();
  const traitCount = new Map<string, number>();

  const add = (issue: ValidationIssue): void => {
    if (issue.severity === 'error') errors.push(issue);
    else warnings.push(issue);
  };

  for (const [key, def] of Object.entries(defs)) {
    const unitId = def.id || key;

    // ---------- 1. key 和 def.id 必须一致 ----------
    if (def.id !== key) {
      add({
        severity: 'error',
        code: 'DUPLICATE_DEF_ID',
        unitId,
        field: 'id',
        message:
          `这张表的 key 是 "${key}"，但棋子自己的 id 写成了 "${def.id}"，两者必须一模一样。` +
          `因为引擎里到处都用 id 查表，不一致会导致查不到或查错。改成 id: '${key}'。`,
      });
    }

    /*
      ---------- 0. 召唤物只做最轻的检查 ----------
      【为什么单独一条路？】
      因为召唤物**故意**是一条"不像干员"的数据：没有羁绊（不入牌库）、
      攻击力可能是 0（柱子不攻击）、护甲魔抗是 0、星级倍率是 1000（不升星）。
      拿干员的标准去要求它，会报一堆"看起来对但没意义"的错，
      把真正的问题淹掉 —— 这比不检查更糟。
      所以这里只确认它最基本的东西是齐的，然后跳过剩下的所有检查。
    */
    if (def.summonOnly) {
      if (!def.skill) {
        add({
          severity: 'error',
          code: 'SUMMON_NO_SKILL',
          unitId,
          field: 'skill',
          message: `召唤物 "${def.name}" 没有写 skill。哪怕是"什么都不做"也要写一条（引擎会读它的被动）。`,
        });
      }
      if (!(def.base.hp > 0)) {
        add({
          severity: 'error',
          code: 'SUMMON_NO_HP',
          unitId,
          field: 'base.hp',
          message: `召唤物 "${def.name}" 的血量必须大于 0（陷阱那种"一碰就炸"的写 1 也行）。`,
        });
      }
      if (def.summonOf && !(def.summonOf in defs)) {
        add({
          severity: 'error',
          code: 'SUMMON_BAD_OWNER',
          unitId,
          field: 'summonOf',
          message: `召唤物 "${def.name}" 写着 summonOf: "${def.summonOf}"，但表里没有这个干员。`,
        });
      }
      continue;
    }

    /*
      ★ 0.0.3 野怪：和召唤物同理，**故意**是一条"不像干员"的数据 ——
      没有羁绊（不进牌库、不吃羁绊）、固定 1 星不升星（星级倍率就是 1000）、
      不进商店、不参与"同费用强度比较"。拿干员那套标准去量它，
      只会报一堆"看起来对但没意义"的错，把真问题淹掉。

      所以这里只确认"最基本的东西是齐的"，然后跳过剩下的检查。
      具体的数值平衡我们靠 monster-data.ts 里的级别模板管，不靠这个校验器。
    */
    if (def.monsterOnly) {
      if (!def.skill) {
        add({
          severity: 'error',
          code: 'MONSTER_NO_SKILL',
          unitId,
          field: 'skill',
          message: `野怪 "${def.name}" 没有写 skill。哪怕是"只会普攻"也要写一条（引擎会读它的被动）。`,
        });
      }
      if (!(def.base.hp > 0)) {
        add({
          severity: 'error',
          code: 'MONSTER_NO_HP',
          unitId,
          field: 'base.hp',
          message: `野怪 "${def.name}" 的血量必须大于 0。`,
        });
      }
      if (!def.monsterTier) {
        add({
          severity: 'error',
          code: 'MONSTER_NO_TIER',
          unitId,
          field: 'monsterTier',
          message: `野怪 "${def.name}" 没有写 monsterTier（小怪 / 普通 / 精英 / 小领袖 / Boss）。`,
        });
      }
      continue;
    }

    // ---------- 2. 种族 / 职业必须合法 ----------
    if (!Array.isArray(def.traits) || def.traits.length === 0) {
      /*
        ★ 彩蛋棋子（`noStar`）**故意**没有任何羁绊 ——
        用户的设计就是"它是一个独立的彩蛋，不参与任何羁绊的凑人数"。
        所以跳过这条检查（和野怪同样的处理思路：它们都不是"常规干员"）。
      */
      if (def.noStar !== true) {
        add({
          severity: 'error',
          code: 'EMPTY_TRAITS',
          unitId,
          field: 'traits',
          message: `没有填任何种族/职业。每个棋子至少要有一个标签，否则它不参与任何羁绊，会明显偏弱。`,
        });
      }
    } else {
      for (const trait of def.traits) {
        if (!(trait in TRAIT_KINDS)) {
          const suggestion = suggestTrait(trait);
          add({
            severity: 'error',
            code: 'UNKNOWN_TRAIT_KIND',
            unitId,
            field: 'traits',
            message:
              `不认识标签 "${trait}"。` +
              (suggestion ? `你是不是想写 "${suggestion}"？` : '') +
              ` 合法清单在 unit-data.ts 的 TRAIT_KINDS 里，要加新标签就往那里加一行。` +
              ` 注意：写错的标签不会报运行时错误，只会让羁绊静默失效。`,
          });
        } else {
          traitCount.set(trait, (traitCount.get(trait) ?? 0) + 1);
        }
      }
    }

    // ---------- 3. 标签是不是太多了 ----------
    // 【这条检查为什么从"种族/职业混填"改成"标签总数"？】
    // 最早的规则是「≥2 个种族 或 ≥3 个职业就提醒」。
    // 但正式名单里出现了两个**故意**的情况：
    //   阿米娅 = 罗德岛 + 领导人 + 法术 + 支援（1 种族 + 3 职业）
    //   芙蓉   = 萨卡兹 + 罗德岛（2 个种族，混血设定）
    // 两者都是设计意图，规则却一直报警 —— 这就是"狼来了"，
    // 提醒多了人就不看了，等于没有检查。
    // 现在改成看**总标签数**：超过 4 个才提醒。这才是真正会导致
    // 「羁绊太容易凑齐、不好平衡」的情况。
    if (Array.isArray(def.traits) && def.traits.length >= 5) {
      const kinds = def.traits.map((t) => TRAIT_KINDS[t]).filter(Boolean);
      const races = kinds.filter((k) => k === 'race').length;
      const classes = kinds.filter((k) => k === 'class').length;
      add({
        severity: 'warning',
        code: 'TOO_MANY_TRAITS',
        unitId,
        field: 'traits',
        message:
          `这个棋子有 ${def.traits.length} 个标签（${races} 个出身、${classes} 个定位）。` +
          `标签太多会让羁绊特别容易凑齐、不好平衡。` +
          `如果是有意设计的多标签棋子，忽略这条。`,
      });
    }

    // ---------- 4. 星级倍率必须 > 1000 ----------
    for (const [field, value] of [
      ['starHpBp', def.starHpBp],
      ['starDamageBp', def.starDamageBp],
    ] as const) {
      if (!Number.isFinite(value) || value <= 1000) {
        add({
          severity: 'error',
          code: 'BAD_STAR_MULTIPLIER',
          unitId,
          field,
          message:
            `${field} = ${value}，必须大于 1000。` +
            `1000 表示「一星不变」，1800 表示「每升一星乘 1.8」（三颗星就是 1.8×1.8 = 3.24 倍）。` +
            `如果填了 1000 或更小，升星就没有收益，玩家不会想合成。`,
        });
      }
      if (value > 3000) {
        add({
          severity: 'warning',
          code: 'BAD_STAR_MULTIPLIER',
          unitId,
          field,
          message:
            `${field} = ${value} 偏大（每升一星乘 ${(value / 1000).toFixed(1)} 倍）。` +
            `三颗星会变成 ${((value / 1000) ** 2).toFixed(1)} 倍强度，通常会导致高星棋子无法无天。`,
        });
      }
    }

    // ---------- 5. 基础数值不能是 0 或负数 ----------
    const numericFields: Array<[string, number]> = [
      ['base.hp', def.base.hp],
      ['base.attackDamage', def.base.attackDamage],
      ['base.attackSpeed', def.base.attackSpeed],
      ['base.range', def.base.range],
      ['base.manaPerAttack', def.base.manaPerAttack],
      ['base.armor', def.base.armor],
      ['base.magicResist', def.base.magicResist],
    ];
    for (const [field, value] of numericFields) {
      /*
        ★ 0.2：**不会攻击**的棋子回蓝本来就是 0。
        夜莺改版后是"被动：不会攻击敌人，按攻击频率恢复范围内友军"，
        数据表里明确写了「每次普攻回法力 = 0」—— 那不是填漏了。
        判据走技能的被动标记（`noAttack`），而不是按干员 id 写死。
      */
      if (field === 'base.manaPerAttack' && def.skill?.passive?.noAttack === true) continue;
      if (!Number.isFinite(value) || value <= 0) {
        add({
          severity: 'error',
          code: 'SUSPICIOUS_ZERO',
          unitId,
          field,
          message: `${field} = ${value}，必须是大于 0 的数字。血量、攻击、攻速、射程都不能是 0 或负数。`,
        });
      }
    }

    // 射程至少要 1，否则永远够不到人
    if (def.base.range < 1) {
      add({
        severity: 'error',
        code: 'SUSPICIOUS_ZERO',
        unitId,
        field: 'base.range',
        message: `射程 ${def.base.range} 小于 1，这个棋子永远打不到任何人。近战填 1，远程一般填 2～4。`,
      });
    }

    // 法力回复速度：回得太快会一直放技能，太慢则技能形同虚设
    if (def.base.manaPerAttack > 0) {
      const attacksToCast = Math.ceil(MANA_MAX / def.base.manaPerAttack);
      if (attacksToCast <= 2) {
        add({
          severity: 'warning',
          code: 'POWER_OUTLIER',
          unitId,
          field: 'base.manaPerAttack',
          message:
            `每次普攻回 ${def.base.manaPerAttack} 点法力，只要 ${attacksToCast} 下就能放技能（上限 ${MANA_MAX}）。` +
            `这会让技能几乎没冷却，通常过强。常见值是 100（10 下放一次）。`,
        });
      }
    }

    // ---------- 6. 技能检查 ----------
    /*
      【"effects 是空的"为什么不能一律报错？】
      因为你的设计里**有一批纯被动棋子**（梅、空弦、星熊、夜莺、熔泉、
      见行者、号角、老鲤、澄闪…）—— 它们"入场就生效、一直存在"，
      本来就没有"攒满法力放一次"的效果。
      所以判据改成：effects 空**且**没有被动、没有开局效果、也没有 3 星技能，
      才算真的漏了技能。
    */
    const skill = def.skill;
    const hasAnySkillContent =
      !!skill &&
      (skill.effects.length > 0 ||
        !!skill.passive ||
        (skill.battleStart?.length ?? 0) > 0 ||
        !!skill.star3);
    if (!skill || !Array.isArray(skill.effects) || !hasAnySkillContent) {
      add({
        severity: 'error',
        code: 'NO_ANY_EFFECT',
        unitId,
        field: 'skill.effects',
        message:
          `这个棋子没有任何技能内容（effects 空的，也没有 passive / battleStart / star3）。` +
          `每个棋子至少要有一个：要么是"攒满法力放一次"的效果，要么是"入场就生效"的被动。`,
      });
    } else {
      // 技能 id 撞车
      const owners = skillIdOwners.get(def.skill.id) ?? [];
      owners.push(unitId);
      skillIdOwners.set(def.skill.id, owners);

      // 技能 id 建议带上棋子名前缀，方便看日志
      if (!def.skill.id.startsWith(key)) {
        add({
          severity: 'warning',
          code: 'SKILL_ID_NOT_PREFIXED',
          unitId,
          field: 'skill.id',
          message:
            `技能 id 是 "${def.skill.id}"，建议用 "${key}_xxx" 的形式。` +
            `这样看一眼战斗日志就知道是哪个棋子的技能，排查问题时省很多事。`,
        });
      }

      // 描述非空
      if (!def.skill.desc || def.skill.desc.trim().length === 0) {
        add({
          severity: 'warning',
          code: 'DESC_MISSING_KEYWORD',
          unitId,
          field: 'skill.desc',
          message: `技能描述是空的。描述会显示在界面上，玩家主要靠它理解这个棋子在干什么。`,
        });
      }

      for (const [index, effect] of def.skill.effects.entries()) {
        validateEffect(effect, def, index, add);
      }
    }

    // ---------- 7. 数值合理性启发式 ----------
    if (def.base.range === 1 && def.base.hp < 300) {
      add({
        severity: 'warning',
        code: 'MELEE_LOW_HP',
        unitId,
        field: 'base.hp',
        message:
          `近战棋子只有 ${def.base.hp} 点血，站上去很快就死了。` +
          `近战需要扛住伤害才能输出，通常至少 400～500。`,
      });
    }
    if (def.base.range >= 3 && def.base.armor > 45) {
      add({
        severity: 'warning',
        code: 'RANGED_HIGH_ARMOR',
        unitId,
        field: 'base.armor',
        message:
          `远程棋子有 ${def.base.armor} 点护甲，偏高。` +
          `远程本来就不容易被近战碰到，再给高护甲会很难处理。常见值是 10～25。`,
      });
    }

    // 绝对上限只用来抓「量级写错」（例如 hp 多写了一位）
    const hardCap = POWER_HARD_CAP[def.cost] ?? 9999;
    const power = estimatePower(def);
    if (power > hardCap) {
      add({
        severity: 'warning',
        code: 'POWER_OUTLIER',
        unitId,
        field: '整体强度',
        message:
          `强度分 ${power}，超过了 ${def.cost} 费的量级上限 ${hardCap}。` +
          `这通常说明某个数值多写了一位（比如 hp 写了 5500 而不是 550）。` +
          `检查一下血量、攻击力、技能倍率是不是有零写多了。`,
      });
    }
  }
  // ---------- 表级检查：同费用内是否有明显离群的棋子 ----------
  //
  // 【为什么用「中位数」而不是我拍一个绝对区间？】
  // 因为绝对区间是拍脑袋的，不同游戏、不同数值尺度下都得重调，而且容易误报。
  // 「同费用的棋子强度应该差不多」这条规律才是真正稳定的。
  // 用中位数（而不是平均数）是因为它不怕极端值 —— 你加了一个抄错数值的棋子，
  // 中位数不会被它带偏，反而能准确指出它是离群点。
  const byCostPower = new Map<number, Array<{ id: string; name: string; power: number }>>();
  for (const def of Object.values(defs)) {
    /*
      召唤物 / 野怪 / 升变形态都不是"能买的棋子"，不参与强度比较
      （会让同费用中位数失真：炉芯终曲 2200 血会把 5 费的中位数整个带偏）。
      ★ 0.3.2：判据统一走 `isPlayableDef()` —— 别在这儿手写一份过滤。
    */
    if (!isPlayableDef(def)) continue;
    const list = byCostPower.get(def.cost) ?? [];
    list.push({ id: def.id, name: def.name, power: estimatePower(def) });
    byCostPower.set(def.cost, list);
  }

  for (const [cost, list] of byCostPower) {
    // 【为什么要求至少 3 个棋子？】
    // 因为只有 2 个时，中位数就是这两个数的平均值 ——
    // 「最大值 / 中位数 ≥ 2.2」等价于「两者相差 ≥ 4.4 倍」，判断完全没有意义，
    // 而且会把「谁离群」判反：两个 1 费棋子 19 和 175，中位数是 97，
    // 结果 175 的只算 1.8 倍不算超模，19 的反而被说成「偏废」。
    // 样本量太小时中位数不是稳健统计量，干脆不判断 —— 反正绝对上限那条还在兜底。
    if (list.length < 3) continue;

    const powers = list.map((item) => item.power).sort((a, b) => a - b);
    const median =
      powers.length % 2 === 1
        ? powers[(powers.length - 1) / 2]!
        : Math.round((powers[powers.length / 2 - 1]! + powers[powers.length / 2]!) / 2);
    if (median <= 0) continue;

    const { high: OUTLIER_HIGH, low: OUTLIER_LOW } = outlierThresholds(list.length);

    for (const item of list) {
      const ratio = item.power / median;
      if (ratio >= OUTLIER_HIGH) {
        add({
          severity: 'warning',
          code: 'POWER_OUTLIER',
          unitId: item.id,
          field: '整体强度',
          message:
            `强度分 ${item.power}，是同样 ${cost} 费棋子中位数（${median}）的 ${ratio.toFixed(1)} 倍。` +
            `同费用的棋子强度应该接近，差这么多通常意味着它明显超模（或者别人明显偏弱）。` +
            `用 \`node scripts/pnpm.mjs balance\` 看它和其他棋子的实际对战胜率最准。`,
        });
      } else if (ratio <= OUTLIER_LOW) {
        add({
          severity: 'warning',
          code: 'POWER_OUTLIER',
          unitId: item.id,
          field: '整体强度',
          message:
            `强度分 ${item.power}，只有同样 ${cost} 费棋子中位数（${median}）的 ${(ratio * 100).toFixed(0)}%。` +
            `这个棋子可能偏废，玩家不会想买它。检查是不是某个数值少写了一位数。`,
        });
      }
    }
  }

  // ---------- 表级检查：技能 id 撞车 ----------
  for (const [skillId, owners] of skillIdOwners) {
    if (owners.length > 1) {
      add({
        severity: 'error',
        code: 'DUPLICATE_SKILL_ID',
        unitId: owners.join(' / '),
        field: 'skill.id',
        message:
          `技能 id "${skillId}" 被 ${owners.length} 个棋子同时使用了（${owners.join('、')}）。` +
          `每个棋子的技能 id 必须唯一，否则战斗日志和校验和里分辨不出是谁的技能。` +
          `改成 "${owners[0]}_xxx" 这样带前缀的名字。`,
      });
    }
  }

  // ---------- 表级检查：标签使用次数 ----------
  for (const [trait, count] of traitCount) {
    if (count === 1) {
      add({
        severity: 'warning',
        code: 'TRAIT_UNDERUSED',
        unitId: '（全表）',
        field: `traits.${trait}`,
        message:
          `标签 "${trait}" 只有 1 个棋子用。羁绊通常至少需要 2 个同标签的棋子才能触发，` +
          `所以这个棋子现在凑不出任何羁绊。要么再设计 1～2 个同标签的棋子，要么换掉它的标签。`,
      });
    }
  }

  // ---------- 统计 ----------
  // 只统计"能买到的棋子"：召唤物和野怪都不进商店，
  // 算进费用分布会让人以为 1 费有 20 个。★ 0.3.2：升变形态同理（ascendOnly）。
  const byCostMap = new Map<number, number>();
  const powerList: ValidationReport['stats']['power'] = [];
  for (const def of Object.values(defs)) {
    if (!isPlayableDef(def)) continue;
    byCostMap.set(def.cost, (byCostMap.get(def.cost) ?? 0) + 1);
    powerList.push({ unitId: def.id, name: def.name, cost: def.cost, power: estimatePower(def) });
  }

  return {
    errors,
    warnings,
    unitCount: Object.keys(defs).length,
    stats: {
      byCost: [...byCostMap.entries()].sort((a, b) => a[0] - b[0]).map(([cost, count]) => ({ cost, count })),
      traits: [...traitCount.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([trait, count]) => ({ trait, count })),
      power: powerList.sort((a, b) => a.cost - b.cost || a.unitId.localeCompare(b.unitId)),
    },
  };
}

/** 单个技能效果检查 */
function validateEffect(
  effect: SkillEffect,
  def: UnitDef,
  index: number,
  add: (issue: ValidationIssue) => void,
): void {
  const where = `skill.effects[${index}]`;

  // 伤害类型必须合法
  if (effect.kind === 'damage') {
    const valid = ['physical', 'magic', 'true'];
    if (!valid.includes(effect.damageType)) {
      add({
        severity: 'error',
        code: 'BAD_DAMAGE_TYPE',
        unitId: def.id,
        field: `${where}.damageType`,
        message:
          `伤害类型 "${effect.damageType}" 不合法。只能是 'physical'（走护甲减免）、` +
          `'magic'（走魔抗减免）或 'true'（无视防御）。`,
      });
    }
  }

  // 倍率必须 > 0
  if ('power' in effect && checkPower(effect.power) === null) {
    add({
      severity: 'error',
      code: 'SUSPICIOUS_ZERO',
      unitId: def.id,
      field: `${where}.power`,
      message:
        `power = ${JSON.stringify(effect.power)}，必须是大于 0 的数字。` +
        `power 是千分比：1000 = 100%，2200 = 220%；也可以写成 [一星, 二星, 三星]。`,
    });
  }

  // 指向「当前目标」的效果建议加兜底。
  //
  // 注意判断方式：要检查「fallback 为空」，而不是「'fallback' in effect」。
  // 因为 fallback 是可选字段，没写的时候对象里根本没有这个 key，
  // 用 `in` 判断会得到 false，于是这条检查永远不触发 —— 这是个典型的静默失效。
  if ('target' in effect && effect.target === 'currentTarget' && !('fallback' in effect ? effect.fallback : undefined)) {
    add({
      severity: 'warning',
      code: 'TARGET_RULE_WITHOUT_FALLBACK',
      unitId: def.id,
      field: `${where}.fallback`,
      message:
        `这个效果打的是「当前目标」但没写 fallback。` +
        `放技能那一瞬间如果目标刚好死了，技能就白放了 —— 玩家会觉得棋子很蠢。` +
        `加一个 fallback: 'nearestEnemy' 就能自动改打最近的敌人。`,
    });
  }

  // fallback 不该和 target 一样（写了等于没写）
  if ('fallback' in effect && effect.fallback && effect.fallback === effect.target) {
    add({
      severity: 'warning',
      code: 'FALLBACK_SAME_AS_TARGET',
      unitId: def.id,
      field: `${where}.fallback`,
      message: `fallback 和 target 都是 "${effect.target}"，等于没写兜底。改成别的目标规则才有意义。`,
    });
  }
}

/** 拼写建议：找出和写错的标签最接近的合法标签 */
function suggestTrait(typo: string): string | null {
  const lower = typo.toLowerCase();
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const candidate of Object.keys(TRAIT_KINDS)) {
    const distance = levenshtein(lower, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  // 距离太远就不猜了，免得给出误导性建议
  return bestDistance <= 2 ? best : null;
}

/** 计算两个字符串的编辑距离（用来猜「你是不是想写…」） */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[] = new Array(cols);
  for (let j = 0; j < cols; j++) dp[j] = j;

  for (let i = 1; i < rows; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j < cols; j++) {
      const temp = dp[j]!;
      dp[j] = Math.min(
        dp[j]! + 1,
        dp[j - 1]! + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = temp;
    }
  }
  return dp[cols - 1]!;
}

/**
 * 把校验报告渲染成终端里能读的中文说明。
 * 这是你（非程序员）实际会看到的东西，所以要写得像人话。
 */
export function renderValidationReport(report: ValidationReport, tableName = 'unit-data.ts'): string {
  const lines: string[] = [];
  const rule = '─'.repeat(70);

  lines.push('');
  lines.push(rule);
  lines.push(`   棋子数据表检查报告  （${tableName}）`);
  lines.push(rule);

  // ---- 表级统计 ----
  lines.push('');
  lines.push(`  共 ${report.unitCount} 个棋子`);
  lines.push('');
  lines.push('  各费用数量：');
  for (const { cost, count } of report.stats.byCost) {
    const bar = '█'.repeat(count);
    lines.push(`    ${cost} 费  ${String(count).padStart(2)} 个  ${bar}`);
  }

  lines.push('');
  lines.push('  标签使用情况（羁绊是否凑得出来，看这里）：');
  for (const { trait, count } of report.stats.traits) {
    const kind = TRAIT_KINDS[trait] === 'race' ? '种族' : TRAIT_KINDS[trait] === 'class' ? '职业' : '未知';
    const flag = count < 2 ? '  ← 凑不出羁绊' : '';
    lines.push(`    ${trait.padEnd(10, ' ')} ${kind}  ${String(count).padStart(2)} 个${flag}`);
  }

  lines.push('');
  lines.push('  强度分（同费用之间横向比较，明显高的可能超模）：');
  {
    // 先把每个费用段的中位数算出来，这样你一眼能看出谁偏离了同伴
    const medians = new Map<number, number>();
    for (const { cost, count: _count } of report.stats.byCost) {
      const powers = report.stats.power
        .filter((item) => item.cost === cost)
        .map((item) => item.power)
        .sort((a, b) => a - b);
      if (powers.length === 0) continue;
      const median =
        powers.length % 2 === 1
          ? powers[(powers.length - 1) / 2]!
          : Math.round((powers[powers.length / 2 - 1]! + powers[powers.length / 2]!) / 2);
      medians.set(cost, median);
    }

    let lastCost = -1;
    for (const item of report.stats.power) {
      if (item.cost !== lastCost) {
        const median = medians.get(item.cost);
        const sampleSize = report.stats.power.filter((entry) => entry.cost === item.cost).length;
        lines.push(
          `    ── ${item.cost} 费 ──` +
            (median !== undefined && sampleSize >= 3
              ? `  （${sampleSize} 个，中位数 ${median}）`
              : `  （${sampleSize} 个，样本太少不做离群比较）`),
        );
        lastCost = item.cost;
      }
      const sampleSize = report.stats.power.filter((entry) => entry.cost === item.cost).length;
      const median = medians.get(item.cost) ?? item.power;
      const ratio = median > 0 ? item.power / median : 1;
      const { high, low } = outlierThresholds(sampleSize);
      const verdict =
        sampleSize >= 3 && ratio >= high
          ? '  ⚠ 明显偏高'
          : sampleSize >= 3 && ratio <= low
            ? '  · 明显偏低'
            : '';
      lines.push(`      ${item.name.padEnd(12, ' ')} ${String(item.power).padStart(4)}${verdict}`);
    }
  }

  // ---- 错误 ----
  lines.push('');
  if (report.errors.length > 0) {
    lines.push(`  ❌ 必须修的 ${report.errors.length} 个问题：`);
    lines.push('');
    for (const issue of report.errors) {
      lines.push(`    [${issue.unitId}]  ${issue.field}`);
      lines.push(`      ${issue.message}`);
      lines.push('');
    }
  } else {
    lines.push('  ✅ 没有必须修的问题');
    lines.push('');
  }

  // ---- 警告 ----
  if (report.warnings.length > 0) {
    lines.push(`  ⚠ 建议看看的 ${report.warnings.length} 个提示：`);
    lines.push('');
    for (const issue of report.warnings) {
      lines.push(`    [${issue.unitId}]  ${issue.field}`);
      lines.push(`      ${issue.message}`);
      lines.push('');
    }
  } else {
    lines.push('  ✅ 没有需要提醒的地方');
    lines.push('');
  }

  lines.push(rule);
  if (report.errors.length > 0) {
    lines.push('  结论：数据表有必须修的错误。改完再跑一次这个命令。');
  } else if (report.warnings.length > 0) {
    lines.push('  结论：可以直接运行。上面的提示只是提醒，不拦你。');
  } else {
    lines.push('  结论：数据表完全没问题。');
  }
  lines.push(rule);
  lines.push('');

  return lines.join('\n');
}

// ============================================================
//  藏品表校验（★ 0.0.3）
// ============================================================

/** 藏品表校验报告 */
export interface ItemValidationReport {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  itemCount: number;
  stats: {
    byRarity: Array<{ rarity: ItemRarity; count: number }>;
    bySlot: Array<{ slot: ItemSlot; count: number }>;
  };
}

/**
 * 战斗机制的所有合法 kind。
 *
 * 【为什么要把这份清单抄一遍？】
 * 因为 TypeScript 的类型在运行时不存在 —— 数据文件里写错了 kind
 * （比如 `kind: 'rampSpeeds'`）编译器拦不住（对象字面量在 Record 里的
 * 类型是联合类型，但 `item-data.ts` 用的是 `ItemDefTable` 标注，
 * 写错 kind 会报错；可是**运行时从 JSON 读进来的**数据不会）。
 * 抄一份清单能挡住手滑。新增机制时记得往这里补一条。
 */
const KNOWN_MECHANIC_KINDS = new Set<string>([
  // 羁绊原有
  'onHitDamage',
  'splash',
  'execute',
  'extraTargets',
  'attackCounterSpeed',
  'rampSpeed',
  'attackCountNuke',
  'lowHpSurge',
  'startShield',
  'highestHpCarrier',
  'auraFromSum',
  'soloRequires',
  'allStatsByTriple',
  'goldPerSurvivor',
  'airborne',
  // 藏品新增
  'everyNthAttack',
  'farAttackReduction',
  'damageReduction',
  'teamRegen',
  'goldOnKill',
  'goldOnDeath',
  'onCastBuff',
  'startEnemyShred',
  'startTeamImmunity',
  // ★ 0.1.1 藏品二版新增
  'lowHpShield',
  'lowHpAttack',
  'lowHpSpeed',
  'lowHpManaRegen',
  'distanceBonus',
  'startSurroundAttack',
  'startRandomAllyBuff',
  'onCastRamp',
  'goldThresholdNuke',
  'teamHealingBp',
  'startSummon',
  // ★ 0.2.2 剑士：开技能时瞬移到血量最少的敌人面前并眩晕
  'onCastBlinkStrike',
  // ★ 0.2.2 剑士（6/9 人档）：瞬移后羁绊给的攻/攻速加成翻倍
  'blinkDoublesTraitBonus',
  // ★ 0.3 龙：按场上龙干员的星级总和提升全队攻击力（重复只算最高星）
  'attackByTraitStars',
  'attackByTripleTrait',
]);

/**
 * 开局效果里**真正会被执行**的 kind。
 *
 * 见 rules.ts 的 applyBattleStartEffect：它只实现了 shield / buff / heal 三种，
 * 其余种类写在数据里会被**静默跳过**（那条 default 分支就是为它写的）。
 * 这种"写了但没效果"是改数据时最难受的一种错，所以这里当警告报出来。
 */
const BATTLE_START_KINDS = new Set<string>(['shield', 'buff', 'heal']);

/**
 * 校验整张藏品表。
 *
 * 和棋子表一样分两级：error 必须修，warning 建议看看。
 */
export function validateItemTable(items: ItemDefTable): ItemValidationReport {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const rarityCount = new Map<ItemRarity, number>();
  const slotCount = new Map<ItemSlot, number>();

  const add = (issue: ValidationIssue): void => {
    if (issue.severity === 'error') errors.push(issue);
    else warnings.push(issue);
  };

  for (const [key, item] of Object.entries(items)) {
    const itemId = item.id || key;
    const at = (field: string): string => `藏品 "${item.name || itemId}" 的 ${field}`;

    // ---- 1. key 和 id 必须一致 ----
    if (item.id !== key) {
      add({
        severity: 'error',
        code: 'ITEM_BAD_ID',
        unitId: itemId,
        field: 'id',
        message:
          `这张表的 key 是 "${key}"，但藏品自己的 id 写成了 "${item.id}"，两者必须一模一样。` +
          `引擎到处都用 id 查表（装备栏、联机同步都用它）。改成 id: '${key}'。`,
      });
    }

    // ---- 2. 名字不能空 ----
    if (!item.name || item.name.trim() === '') {
      add({
        severity: 'error',
        code: 'ITEM_NO_NAME',
        unitId: itemId,
        field: 'name',
        message: '藏品没有名字，界面上会显示成空白。补一个 name。',
      });
    }

    // ---- 3. slot / rarity 合法 ----
    if (item.slot !== 'A' && item.slot !== 'B') {
      add({
        severity: 'error',
        code: 'ITEM_BAD_SLOT',
        unitId: itemId,
        field: 'slot',
        message: `slot 只能写 'A'（可穿戴，装到干员身上）或 'B'（共享，装到共享装备位），现在写的是 "${item.slot}"。`,
      });
    }
    if (item.rarity !== 'normal' && item.rarity !== 'advanced') {
      add({
        severity: 'error',
        code: 'ITEM_BAD_RARITY',
        unitId: itemId,
        field: 'rarity',
        message: `rarity 只能写 'normal'（普通）或 'advanced'（进阶），现在写的是 "${item.rarity}"。`,
      });
    }

    // ---- 4. 图标名 ----
    if (!item.icon || item.icon.trim() === '') {
      add({
        severity: 'warning',
        code: 'ITEM_BAD_ICON',
        unitId: itemId,
        field: 'icon',
        message:
          '没有写 icon，界面上会回退成"首字 + 配色方块"的占位样式。' +
          '想用图片的话，把图标放到 assets/items/<icon>.png，然后把文件名填进 icon。',
      });
    }

    // ---- 5. A / B 的字段不能混用 ----
    if (item.slot === 'B') {
      if (item.combat) {
        add({
          severity: 'error',
          code: 'ITEM_MIXED_SCOPE',
          unitId: itemId,
          field: 'combat',
          message:
            '这是 B 类（共享）藏品，但写了 combat —— B 类的作用对象是"全队"，' +
            '解析时**只会读** teamConditional / teamMechanics / perRound，combat 会被静默忽略。' +
            '想给全队加属性请用 teamConditional（无条件就写 costAtMost: 99 那种不合适的条件时，' +
            '应该给 teamConditional 补一个无条件类型），想加机制请用 teamMechanics。',
        });
      }
    } else {
      for (const field of ['teamConditional', 'teamMechanics', 'perRound'] as const) {
        if (item[field] !== undefined) {
          add({
            severity: 'error',
            code: 'ITEM_MIXED_SCOPE',
            unitId: itemId,
            field,
            message:
              `这是 A 类（可穿戴）藏品，但写了 ${field} —— 那是 B 类（共享）专用的字段，` +
              'A 类的解析只会读 combat / onEquip，这个字段会被静默忽略。' +
              (field === 'perRound' ? '想给钱请放到 onEquip 里。' : '想作用于单个干员请用 combat。'),
          });
        }
      }
    }

    // ---- 6. 条件羁绊必须真实存在 ----
    for (const [field, trait] of [
      ['combat.selfTraitStats.trait', item.combat?.selfTraitStats?.trait],
      ['combat.selfTraitMechanics.trait', item.combat?.selfTraitMechanics?.trait],
    ] as const) {
      if (trait === undefined) continue;
      if (!(trait in TRAIT_DEFS)) {
        add({
          severity: 'error',
          code: 'ITEM_BAD_TRAIT',
          unitId: itemId,
          field,
          message:
            `${at(field)} 写的是 "${trait}"，但羁绊表里没有这个标签 —— ` +
            '这件藏品的条件加成永远不会生效（而且不报错）。' +
            `现有的标签有：${Object.keys(TRAIT_DEFS).sort().join('、')}。`,
        });
      }
    }

    // ---- 7. 机制 kind 合法 ----
    const mechanicLists: Array<{ field: string; list: readonly { kind: string }[] }> = [];
    if (item.combat?.mechanics) mechanicLists.push({ field: 'combat.mechanics', list: item.combat.mechanics });
    if (item.combat?.selfTraitMechanics?.mechanics) {
      mechanicLists.push({
        field: 'combat.selfTraitMechanics.mechanics',
        list: item.combat.selfTraitMechanics.mechanics,
      });
    }
    if (item.teamMechanics) mechanicLists.push({ field: 'teamMechanics', list: item.teamMechanics });

    for (const { field, list } of mechanicLists) {
      for (const mechanic of list) {
        if (KNOWN_MECHANIC_KINDS.has(mechanic.kind)) continue;
        add({
          severity: 'error',
          code: 'ITEM_BAD_MECHANIC',
          unitId: itemId,
          field,
          message:
            `${at(field)} 里有不认识的机制 "${mechanic.kind}" —— 战斗循环不会执行它。` +
            '要么把 kind 改成现有的一种，要么在 types.ts 里加一种并在 rules.ts 里实现它。',
        });
      }
    }

    // ---- 8. 开局效果的 kind 必须是"真的会被执行"的 ----
    for (const effect of item.combat?.battleStart ?? []) {
      if (BATTLE_START_KINDS.has(effect.kind)) continue;
      add({
        severity: 'warning',
        code: 'ITEM_BAD_BATTLE_START',
        unitId: itemId,
        field: 'combat.battleStart',
        message:
          `${at('combat.battleStart')} 用了 "${effect.kind}"，但"开局类效果"目前只实现了 ` +
          `${[...BATTLE_START_KINDS].join(' / ')} 三种 —— 写在数据里会被**静默跳过**（没效果也不报错）。` +
          '要么改用这三种，要么去 rules.ts 的 applyBattleStartEffect 里补上这种。',
      });
    }

    // ---- 9. 「立刻销毁」必须真的做点什么 ----
    if (item.onEquip?.consume) {
      const onEquip = item.onEquip;
      const hasEffect =
        onEquip.gold !== undefined ||
        onEquip.hp !== undefined ||
        onEquip.popCap !== undefined ||
        onEquip.permanent !== undefined ||
        onEquip.prep !== undefined ||
        // ★ 0.3.2：升变（阿米娅的三张升变之证）—— 它的"效果"是换掉棋子本身，
        //   不在上面那几个字段里，漏了就会把三张证全判成"装上什么都不发生"。
        onEquip.ascend !== undefined;
      if (!hasEffect) {
        add({
          severity: 'error',
          code: 'ITEM_CONSUME_NO_EFFECT',
          unitId: itemId,
          field: 'onEquip.consume',
          message:
            '这件藏品写着「立刻销毁」，但没有任何立即结算的效果（gold / hp / popCap / permanent / prep / ascend 都没有）' +
            '—— 装上就直接消失，什么都不会发生。要么补上效果，要么去掉 consume。',
        });
      }
    }

    // ---- 9b. 升变之证必须说清"从谁变成谁"，而且两头都得是真的棋子 ----
    if (item.onEquip?.ascend) {
      const ascend = item.onEquip.ascend;
      if (ascend.from.length === 0) {
        add({
          severity: 'error',
          code: 'ITEM_BAD_ASCEND',
          unitId: itemId,
          field: 'onEquip.ascend.from',
          message: '升变之证没写 `from` —— 那样它对任何棋子都能用（包括别的干员），必须列出允许的原形态。',
        });
      }
      if (typeof ascend.to !== 'string' || ascend.to.length === 0) {
        add({
          severity: 'error',
          code: 'ITEM_BAD_ASCEND',
          unitId: itemId,
          field: 'onEquip.ascend.to',
          message: '升变之证没写 `to` —— 不知道要变成谁。',
        });
      }
      if (ascend.minStar !== undefined && (ascend.minStar < 1 || ascend.minStar > 3)) {
        add({
          severity: 'error',
          code: 'ITEM_BAD_ASCEND',
          unitId: itemId,
          field: 'onEquip.ascend.minStar',
          message: `\`minStar\` 是 ${ascend.minStar}，只可能是 1 / 2 / 3（星级就三档）。`,
        });
      }
    }

    // ---- 10. 完全没有任何效果 ----
    const hasAnyEffect =
      item.combat !== undefined ||
      item.onEquip !== undefined ||
      item.teamConditional !== undefined ||
      item.teamMechanics !== undefined ||
      item.perRound !== undefined ||
      // ★ 0.1.1：跨回合成长也是一种效果（悲伤的红 / 黑流树海笔记 / 圆石祭坛
      //   就只靠它 —— 它们的加成来自"未装载的藏品数 / 回合数 / 战斗场次"）
      item.growth !== undefined ||
      item.shopCostDelta !== undefined ||
      // ★ 0.1.3：转职藏品（给装备者加一个羁绊标签）也**只靠这一个字段** ——
      //   它在战斗里没有任何 combat，效果走的是客户端的羁绊标签通道。
      item.grantsTrait !== undefined;
    if (!hasAnyEffect) {
      add({
        severity: 'warning',
        code: 'ITEM_NO_EFFECT',
        unitId: itemId,
        field: '(整条)',
        message: '这件藏品没有任何效果字段，装上之后什么都不会发生。',
      });
    }

    if (item.rarity === 'normal' || item.rarity === 'advanced') {
      rarityCount.set(item.rarity, (rarityCount.get(item.rarity) ?? 0) + 1);
    }
    if (item.slot === 'A' || item.slot === 'B') {
      slotCount.set(item.slot, (slotCount.get(item.slot) ?? 0) + 1);
    }
  }

  return {
    errors,
    warnings,
    itemCount: Object.keys(items).length,
    stats: {
      byRarity: [...rarityCount.entries()].map(([rarity, count]) => ({ rarity, count })).sort((a, b) => a.rarity.localeCompare(b.rarity)),
      bySlot: [...slotCount.entries()].map(([slot, count]) => ({ slot, count })).sort((a, b) => a.slot.localeCompare(b.slot)),
    },
  };
}

/** 把藏品校验报告渲染成终端里能读的中文文本 */
export function renderItemValidationReport(report: ItemValidationReport, source: string): string {
  const rule = '─'.repeat(64);
  const lines: string[] = ['', rule];
  lines.push('  藏品表校验 · ' + source);
  lines.push(rule);
  lines.push(`  共 ${report.itemCount} 件藏品`);
  for (const entry of report.stats.byRarity) {
    lines.push(
      `    ${entry.rarity === 'normal' ? '普通' : '进阶'} ${String(entry.count).padStart(2)} 件`,
    );
  }
  for (const entry of report.stats.bySlot) {
    lines.push(
      `    ${entry.slot === 'A' ? 'A 类（可穿戴）' : 'B 类（共享）'} ${String(entry.count).padStart(2)} 件`,
    );
  }

  lines.push('');
  if (report.errors.length > 0) {
    lines.push(`  ❌ 必须修的 ${report.errors.length} 个问题：`);
    lines.push('');
    for (const issue of report.errors) {
      lines.push(`    [${issue.unitId}]  ${issue.field}`);
      lines.push(`      ${issue.message}`);
      lines.push('');
    }
  } else {
    lines.push('  ✅ 没有必须修的问题');
    lines.push('');
  }

  if (report.warnings.length > 0) {
    lines.push(`  ⚠ 建议看看的 ${report.warnings.length} 个提示：`);
    lines.push('');
    for (const issue of report.warnings) {
      lines.push(`    [${issue.unitId}]  ${issue.field}`);
      lines.push(`      ${issue.message}`);
      lines.push('');
    }
  } else {
    lines.push('  ✅ 没有需要提醒的地方');
    lines.push('');
  }

  lines.push(rule);
  lines.push(
    report.errors.length > 0
      ? '  结论：藏品表有必须修的错误。改完再跑一次这个命令。'
      : '  结论：藏品表没问题。',
  );
  lines.push(rule);
  lines.push('');
  return lines.join('\n');
}
