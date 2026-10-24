import { ITEM_DEFS } from './item-data.js';
import { computeActiveTraitLevels } from './synergies.js';
import { scaleStats } from './mods.js';
import { FIX } from './constants.js';
import type {
  ItemDef,
  ScopedMechanic,
  SkillEffect,
  SkillStats,
  TraitBonus,
  TraitEffectType,
  UnitDef,
  UnitDefTable,
  UnitPlacement,
} from './types.js';

/**
 * ============================================================
 *  藏品效果解析
 * ============================================================
 *
 * 【为什么要有这一层？】
 * 战斗内核只认两样东西：**属性数字**（SkillStats / TraitBonus）和**机制**
 * （ScopedMechanic）。它不该知道"藏品"这个概念，更不该知道"炎国短刃"叫什么。
 * 所以这个文件负责把 `ItemDef` 翻译成内核认的那两样，然后
 * `createBattle` 把它们挂上去 —— 和羁绊（synergies.ts）的思路完全一致。
 *
 * 【为什么这里不 import synergies？】
 * 因为羁绊那边要算"激活了几个羁绊"，而那是调用方（客户端 toTeamSetup）
 * 已经算过的东西。让调用方把结果传进来，就能避免一次重复计算，
 * 也避免 synergies <-> 规则层的循环依赖。
 */

// ============================================================
//  ★ 0.1.1 藏品二版：跨回合"成长层数"
// ============================================================
//
// 【层数从哪来？】
// 客户端在自己的状态里累计（只有它知道"上一场赢没赢、杀了几个、现在是第几回合"），
// 组阵容时把整张表放进 `TeamSetup.itemState`。这里只做一件事：
// 把"层数"乘进那件藏品的属性里。
//
// 【为什么 `source` 只影响 'emptySlot'？】
// 因为其余几种（kill / win / round / battle）的区别只在"客户端什么时候 +1"，
// 折成属性这一步完全一样 —— 战斗内核不需要知道层数是怎么攒出来的。

/** 客户端交上来的"跨回合藏品状态"（对应 `TeamSetup.itemState`） */
export interface ItemStateInput {
  /**
   * 每件藏品的成长层数（key = 藏品 id）。
   *
   * ★ 0.2：**这是兜底路径**。正常对局里层数是**按副本**传进来的
   *   （`UnitPlacement.itemLayers` / `TeamSetup.sharedItemLayers`），
   *   因为同一个玩家可以有**多件相同藏品**，各叠各的 —— 按 id 记会让它们共享层数
   *   （用户报的 bug："有些单独穿戴的叠层藏品，我有多个时层数会共享"）。
   *   这份表只在"没有逐副本数组"时用（老存档、老客户端上报的阵容）。
   */
  growth?: Record<string, number>;
  /** 藏品栏里**还没装载**的藏品数量（悲伤的红） */
  unequipped?: number;
}

/**
 * 算出这件藏品当前吃到多少层。
 *
 * @param explicit ★ 0.2：这一件**副本**自己的层数（有它就以它为准）
 * @returns 夹在 [0, maxStacks] 之间的整数层数
 */
export function growthLayers(
  item: ItemDef,
  state?: ItemStateInput,
  explicit?: number,
): number {
  const growth = item.growth;
  if (!growth) return 0;
  // ★ 老的调用方（测试 / 简易战斗）可能两个都不传 —— 保持原口径：0 层
  if (explicit === undefined && !state) return 0;
  /*
    ★★ 0.2：口径优先级 ——
      ① `emptySlot` 那种实时数（悲伤的红看"藏品栏里还有几件没装"）**永远优先**：
         它根本没有"攒起来的层数"，逐副本层数对它无意义，传了也必须忽略。
      ② 逐副本传进来的 `explicit`（同一件藏品有多个副本时，各算各的）
      ③ 按 id 的那张表（兜底：老存档 / 老客户端）
    以前只有 ③，于是两件「佣兵的饰物」永远显示同一个层数、也只涨一份。
  */
  const raw =
    growth.source === 'emptySlot'
      ? (state?.unequipped ?? 0)
      : explicit !== undefined
        ? explicit
        : (state?.growth?.[item.id] ?? 0);
  const total = (growth.base ?? 0) + Math.max(0, raw);
  return Math.min(growth.maxStacks, total);
}

// ============================================================
//  A 类（可穿戴）：作用于**一个干员**
// ============================================================

/** 一件/多件 A 类藏品装备到某个干员身上后，对这个干员产生的全部效果 */
export interface WearerItemEffects {
  /**
   * 要挂上去的属性包，**每件藏品一个**。
   *
   * 【为什么是一个数组，而不是合并成一个大对象？】
   * 因为 `collectMods` 本来就是把"挂在这枚棋子身上的若干个包"逐个累加的
   * （技能被动、每个 buff 都是这么并进去的）。直接把每件藏品当成一个包挂上去，
   * 就完全不用写"合并两个 SkillStats"这种容易出错的代码 ——
   * 而且以后要显示"这件藏品贡献了多少属性"时也天然有据可查。
   */
  statsList: SkillStats[];
  /** 战斗中的机制（已带上"这是哪件藏品给的"标记） */
  mechanics: ScopedMechanic[];
  /** 开局类效果 */
  battleStart: SkillEffect[];
  /** 治疗效果提升（万分比，累加） */
  healingBp: number;
  /** ★ 0.3.2：技力回复量提升（万分比，累加，写进 `statuses['manaGainBonusBp']`） */
  manaGainBp: number;
  /** 阵亡重生（多件都有时取第一件） */
  revive: { hpBp: number; desc: string } | null;
  /** 这枚棋子身上装着的藏品定义（UI 显示、校验用） */
  items: ItemDef[];
}

/**
 * 解析一个 placement 的 A 类藏品。
 *
 * @param def       装备者的棋子定义（用来判断"是否属于炎/拉特兰羁绊"这类条件）
 * @param itemIds   这枚棋子身上的藏品 id 列表
 * @param itemState ★ 0.1.1：跨回合成长层数（不传 = 全部按 0 层算）
 * @param itemLayers ★ 0.2：**逐副本**的层数，和 `itemIds` 一一对应。
 *   【为什么需要它？】同一个干员可以装两件同名藏品吗？更常见的是
 *   两个干员**各装一件同名藏品** —— 那样两件就该各自叠层。
 *   按 id 的 `itemState.growth` 只能表达一份，所以逐副本的层数单独传。
 */
export function resolveWearerItems(
  def: UnitDef,
  itemIds: readonly string[] | undefined,
  itemState?: ItemStateInput,
  itemLayers?: readonly number[],
): WearerItemEffects {
  const out: WearerItemEffects = {
    statsList: [],
    mechanics: [],
    battleStart: [],
    healingBp: 0,
    manaGainBp: 0,
    revive: null,
    items: [],
  };
  if (!itemIds || itemIds.length === 0) return out;

  // 装备者的羁绊标签（条件类藏品要查它）。用 Set 去重，免得数据里重复写标签导致算两次
  const traits = new Set(def.traits);
  /*
    ★ 0.1.3：**转职藏品给的标签也要算进来**。
    否则「先装炎转职、再装炎国短刃」时，短刃那句"需炎羁绊"的条件不成立 ——
    玩家看到的是"转了职，可配套的藏品还是白装"。
    数据就在手边（`itemIds`），自己推一遍比让调用方多传一个参数更不容易漏。
  */
  for (const id of itemIds) {
    const granted = ITEM_DEFS[id]?.grantsTrait;
    if (granted) traits.add(granted);
  }

  // ★ 0.2：改成按下标遍历 —— 只有知道"第几件"，才能取它**这一件副本**的层数
  for (let index = 0; index < itemIds.length; index++) {
    const item = ITEM_DEFS[itemIds[index]!];
    // 只处理 A 类。B 类走 resolveSharedItems；未知 id 静默跳过（校验器会另外报错）
    if (!item || item.slot !== 'A') continue;
    out.items.push(item);
    /*
      ★ 0.1.1：跨回合成长（仇名录每击倒一名敌人 +1% 攻击力 / 佣兵的饰物每次胜利 +5%…）。
      把"每层属性"乘上当前层数，当成**一个普通的属性包**并进 statsList ——
      下游（挂永久 buff、面板显示、伤害计算）完全看不出它和平时的属性有什么区别。
      ★ 0.2：层数**按副本**取（`itemLayers[index]`）—— 两件同名藏品各叠各的。
    */
    const layers = growthLayers(item, itemState, itemLayers?.[index]);
    if (item.growth?.perLayer && layers > 0) {
      out.statsList.push(scaleStats(item.growth.perLayer, layers * 10000));
    }

    const combat = item.combat;
    if (!combat) continue;

    if (combat.stats) out.statsList.push(combat.stats);
    if (combat.selfTraitStats && traits.has(combat.selfTraitStats.trait)) {
      out.statsList.push(combat.selfTraitStats.stats);
    }
    if (combat.selfTraitMechanics && traits.has(combat.selfTraitMechanics.trait)) {
      for (const mechanic of combat.selfTraitMechanics.mechanics) {
        out.mechanics.push(tagMechanic(mechanic, item));
      }
    }
    for (const mechanic of combat.mechanics ?? []) out.mechanics.push(tagMechanic(mechanic, item));
    for (const effect of combat.battleStart ?? []) out.battleStart.push(effect);
    if (combat.healingBp) out.healingBp += combat.healingBp;
    if (combat.manaGainBp) out.manaGainBp += combat.manaGainBp;
    if (combat.revive && !out.revive) out.revive = combat.revive;
  }

  return out;
}

/**
 * 给机制打上"来自哪件藏品"的标记。
 *
 * 【为什么要标记？】
 * 和羁绊机制要标 traitId 是一个道理：战斗循环里所有机制是**拍平**的，
 * 出问题时（比如"这个人的减伤怎么是 30% 不是 10%"）需要能一眼看出
 * 是哪件藏品、哪个羁绊给的。标记本身不参与任何计算。
 */
function tagMechanic(mechanic: ScopedMechanic, item: ItemDef): ScopedMechanic {
  return { ...mechanic, traitId: `item_${item.id}` };
}

// ============================================================
//  B 类（共享）：作用于**全队**
// ============================================================

/** 共享装备位里的 B 类藏品对整支队伍产生的效果 */
export interface SharedItemEffects {
  /** 全队无条件加成（会并进 TeamSetup.traitBonuses） */
  teamBonuses: TraitBonus[];
  /** 只给某个 defId 的加成（会并进 TeamSetup.unitTraitBonuses） */
  unitBonuses: Record<string, TraitBonus[]>;
  /** 队伍级战斗机制（会挂到 BattleState.teamMechanics） */
  teamMechanics: ScopedMechanic[];
  /** 每回合经济汇总（客户端在回合结算时用） */
  perRound: { gold: number; goldOnLossStreak: number };
  /** 装着哪些共享藏品（UI 显示用） */
  items: ItemDef[];
}

/**
 * 解析共享装备位里的 B 类藏品。
 *
 * @param itemIds          共享装备位里的藏品 id
 * @param placements       本队上场的棋子（用来算"费用 ≤3""射程 >3"这类条件）
 * @param defs             棋子定义表
 * @param ctx              玩家场外状态（金币 / 血量）
 *
 * 【"激活了几个羁绊"是在这里现算的，不靠调用方传】
 * 因为老蒲扇要按它放大。如果让调用方传，任何一处忘了传就会变成
 * "老蒲扇安安静静地一点用都没有" —— 这种静默失效最难查。
 * 现算一次的开销可以忽略（只在开战时算一次）。
 */
export function resolveSharedItems(
  itemIds: readonly string[] | undefined,
  placements: readonly UnitPlacement[],
  defs: UnitDefTable,
  ctx: {
    gold: number;
    hp: number;
    round?: number;
    itemState?: ItemStateInput;
    /** ★ 0.2：**逐副本**的层数，和 `itemIds` 一一对应（见 growthLayers 的说明） */
    itemLayers?: readonly number[];
  },
): SharedItemEffects {
  const out: SharedItemEffects = {
    teamBonuses: [],
    unitBonuses: {},
    teamMechanics: [],
    perRound: { gold: 0, goldOnLossStreak: 0 },
    items: [],
  };
  if (!itemIds || itemIds.length === 0) return out;

  // 场上出现过的 defId，**排序后遍历** —— 保证同样的阵容永远得到同样的加成顺序
  const defIds = [...new Set(placements.map((placement) => placement.defId))].sort();

  // 本队已经激活的羁绊（老蒲扇按个数放大；天师锦囊要看"大炎开没开"）
  const activeTraits = computeActiveTraitLevels([...placements], defs).filter(
    (level) => level.tierIndex >= 0,
  );
  const activeTraitCount = activeTraits.length;
  const activeTraitIds = new Set(activeTraits.map((level) => level.traitId));

  // ★ 0.2：按下标遍历，才能取到"这一件副本"自己的层数
  for (let index = 0; index < itemIds.length; index++) {
    const item = ITEM_DEFS[itemIds[index]!];
    if (!item || item.slot !== 'B') continue;
    out.items.push(item);

    if (item.perRound) {
      out.perRound.gold += item.perRound.gold ?? 0;
      out.perRound.goldOnLossStreak += item.perRound.goldOnLossStreak ?? 0;
    }
    /*
      ★ 0.1.1：跨回合成长（圆石祭坛每层 +5% 攻击/防御 / 生还者合约的叠层…）。
      有 `perLayer` 的直接并成全队属性；**没有** `perLayer` 的（生还者合约）
      留给下面那段——它放大的是机制自己的倍率，不是全队属性。
    */
    const layers = growthLayers(item, ctx.itemState, ctx.itemLayers?.[index]);
    const traitId = `item_${item.id}`;
    if (item.growth?.perLayer && layers > 0) {
      out.teamBonuses.push(...statsToBonuses(item.growth.perLayer, traitId, layers));
    }
    for (const mechanic of item.teamMechanics ?? []) {
      /*
        生还者合约：「战斗开始时，使随机一名干员攻击力 +20%，防御 +20%，
        每次胜利后额外 +20%（最高叠加 100%）」。
        机制里写的是**每层**的数值，层数在组阵容时折成 `scaleBp` 塞进去 ——
        内核那边只管"照这个倍率发一份包"，不需要知道有几层。
      */
      if (mechanic.kind === 'startRandomAllyBuff' && layers > 0) {
        out.teamMechanics.push(tagMechanic({ ...mechanic, scaleBp: layers * 10000 }, item));
        continue;
      }
      /*
        ★ 0.1.1：按**回合数**成长的召唤物（支援防暴桩的假人 / 天师锦囊的炎佑）。
        数值在数据里是"基础 + 里程碑加成"，这里把当前回合算进去 ——
        因为战斗内核根本不知道现在是第几回合。
      */
      if (mechanic.kind === 'startSummon' && item.summonGrowth) {
        const round = ctx.round ?? 1;
        const scaled = scaleSummonByRound(
          mechanic,
          item.summonGrowth,
          round,
          summonStatBpActive(item, activeTraitIds),
        );
        out.teamMechanics.push(tagMechanic(scaled, item));
        continue;
      }
      /*
        ★ 0.1.1：苍桐的"金币门槛"在组阵容时判成结论（`active`）——
        金币在备战期不会变，所以战斗里每 tick 读一个布尔值就够了。
      */
      if (mechanic.kind === 'goldThresholdNuke') {
        out.teamMechanics.push(
          tagMechanic({ ...mechanic, active: ctx.gold >= mechanic.goldAtLeast }, item),
        );
        continue;
      }
      out.teamMechanics.push(tagMechanic(mechanic, item));
    }

    for (const conditional of item.teamConditional ?? []) {
      const traitId = `item_${item.id}`;
      switch (conditional.kind) {
        case 'costAtMost':
          for (const defId of defIds) {
            const def = defs[defId];
            if (!def || def.cost > conditional.cost) continue;
            (out.unitBonuses[defId] ??= []).push(...statsToBonuses(conditional.stats, traitId));
          }
          break;
        case 'rangeGreaterThan':
          for (const defId of defIds) {
            const def = defs[defId];
            // ★ 用的是棋子数据表里的**基础射程**（不划算上羁绊/藏品之后的加成），
            //   否则"被银餐叉自己加过的射程"会反复把更多干员卷进来，结果不可预期。
            if (!def || def.base.range <= conditional.range) continue;
            (out.unitBonuses[defId] ??= []).push(...statsToBonuses(conditional.stats, traitId));
          }
          break;
        case 'perActiveTrait':
          // 每激活一个不同的羁绊算一层
          if (activeTraitCount > 0) {
            out.teamBonuses.push(...statsToBonuses(conditional.stats, traitId, activeTraitCount));
          }
          break;
        case 'perGold': {
          const per = Math.max(1, conditional.perGold);
          const layers = Math.floor(Math.max(0, ctx.gold) / per);
          if (layers > 0) {
            out.teamBonuses.push(...statsToBonuses(conditional.stats, traitId, layers, conditional.capBp));
          }
          break;
        }
        case 'lowHp':
          if (ctx.hp < conditional.hpBelow) {
            out.teamBonuses.push(...statsToBonuses(conditional.stats, traitId));
          }
          break;
        case 'hpAbove':
          // ★ 0.1.1：魔王的旗帜「生命值大于 70 时所有干员的攻击速度 +50%」（严格大于）
          if (ctx.hp > conditional.hpAbove) {
            out.teamBonuses.push(...statsToBonuses(conditional.stats, traitId));
          }
          break;
        case 'always':
          // ★ 0.1.1：无条件全队加成（剑锤）
          out.teamBonuses.push(...statsToBonuses(conditional.stats, traitId));
          break;
      }
    }
  }

  return out;
}

/**
 * 把一份属性包转成"羁绊加成"那种扁平条目。
 *
 * 【为什么要转？】
 * 因为队伍级的属性加成走的是 `TeamSetup.traitBonuses` 那条已经铺好的路
 * （`applyTraitBonuses` 会把它加到棋子的属性上）。转成同一种形状之后，
 * 战斗内核完全看不出"这条加成是羁绊给的还是藏品给的" —— 一行都不用改。
 *
 * @param factor 乘法系数（老蒲扇按羁绊数、金酒之杯按金币档位）
 * @param capBp  总加成上限（万分比口径，只对 bp 类字段生效）。不写 = 不限
 */
function statsToBonuses(
  stats: SkillStats,
  traitId: string,
  factor = 1,
  capBp?: number,
): TraitBonus[] {
  const out: TraitBonus[] = [];
  const push = (effect: TraitEffectType, raw: number | undefined): void => {
    if (raw === undefined) return;
    let value = raw * factor;
    // bp 类字段才封顶（绝对值字段没有"百分比上限"这回事）
    if (effect.endsWith('Bp') && capBp !== undefined) value = Math.min(value, capBp);
    value = Math.floor(value);
    if (value === 0) return;
    out.push({ traitId, effect, value });
  };

  push('attackDamageBp', numeric(stats.attackDamageBp));
  push('attackSpeedBp', numeric(stats.attackSpeedBp));
  push('hpBp', numeric(stats.hpBp));
  push('armorFlat', numeric(stats.armorFlat));
  push('magicResistFlat', numeric(stats.magicResistFlat));
  push('rangeFlat', numeric(stats.rangeFlat));
  /*
    ★ 0.1.1 追加两种"百分比防御"。
    【为什么现在才加？】因为二版的成长类藏品写的是"防御力 +5%"（百分比），
    而 `TraitEffectType` 本来就有 armorBp / magicResistBp 两种
    （重装羁绊在用「提升 50% 防御力」就是这个）。以前没有藏品用到，
    所以没映射；现在加上，行为对老藏品完全无影响（它们不写这两个字段）。
  */
  push('armorBp', numeric(stats.armorBp));
  push('magicResistBp', numeric(stats.magicResistBp));
  /*
    【这里刻意只映射这 6 种】

    因为 `TraitBonus.effect` 只认羁绊那套 `TraitEffectType` ——
    它里面没有 hpFlat / lifestealBp 这类"绝对值血量""吸血"字段。
    而 B 类藏品的条件加成用到的恰好只有攻击力/攻速（老蒲扇、金酒之杯、
    皇帝的恩宠、银餐叉、皇帝的新枪），所以这 6 种够用。

    以后真要加"全队 +N 点护甲上限之外的东西"时，正确做法是给
    TraitEffectType 补一种，而不是在这里悄悄塞一个不认识的字符串 ——
    那样 applyTraitBonuses 的 switch 会在编译期报错，逼着你把它实现掉。
  */
  return out;
}

/**
 * ★ 0.1.1：把"按回合成长"的召唤物数值算成一份具体的 `startSummon`。
 *
 * 【为什么是"里程碑累加"而不是一条公式？】
 * 因为设计稿写的就是里程碑：「初始 1000，第 5 回合后 +300，第 15 回合后再 +600，最高 1900」。
 * 用累加能把"再 +600"这种措辞原样表达出来，也不用去猜两段之间是线性还是阶梯。
 */
/**
 * ★ 0.1.1：按**当前回合**算出一只召唤物的生命 / 攻击（**面板单位**）。
 *
 * 数据里记的是"基础 + 里程碑加成"，最后再套一个整体倍率（天师锦囊的「炎佑属性 +30%」）。
 *
 * 【为什么单独抽出来？】
 * 战斗内核不知道"现在是第几回合"，所以这份换算必须在**进战斗之前**做完；
 * 而界面要显示"这只假人现在多少血"也得用同一份 ——
 * 两边各写一遍的话，迟早出现"界面上写 1300、打起来只有 1000"。
 */
export function summonStatsAtRound(
  growth: NonNullable<ItemDef['summonGrowth']>,
  round: number,
  /** 整体倍率（`statBp`）这次算不算数 —— 有 `requireTrait` 时要看那个羁绊开没开 */
  statBpActive = true,
): { hp: number; attackDamage: number } {
  let hp = growth.hp;
  let attackDamage = growth.attackDamage;
  for (const milestone of growth.milestones) {
    if (round < milestone.atRound) continue;
    hp += milestone.hp ?? 0;
    attackDamage += milestone.attackDamage ?? 0;
  }
  if (growth.maxHp !== undefined) hp = Math.min(hp, growth.maxHp);
  // ★ 最后套一个整体倍率（天师锦囊的「炎佑属性 +30%」，前提是大炎羁绊开着）
  const statBp = statBpActive ? (growth.statBp ?? 10000) : 10000;
  if (statBp !== 10000) {
    hp = Math.floor((hp * statBp) / 10000);
    attackDamage = Math.floor((attackDamage * statBp) / 10000);
  }
  return { hp, attackDamage };
}

/**
 * 这件藏品的召唤物，这一场该不该套 `statBp`（`requireTrait` 那个羁绊开没开）。
 *
 * 单列一个函数是因为**解析层和界面都要判**（不然会出现"界面上写着 +30%、
 * 打起来其实没有"）—— 判据只能有一处。
 */
export function summonStatBpActive(
  item: ItemDef,
  activeTraitIds: ReadonlySet<string>,
): boolean {
  const require = item.summonGrowth?.requireTrait;
  return !require || activeTraitIds.has(require);
}

function scaleSummonByRound(
  mechanic: Extract<ScopedMechanic, { kind: 'startSummon' }>,
  growth: NonNullable<ItemDef['summonGrowth']>,
  round: number,
  statBpActive: boolean,
): ScopedMechanic {
  const { hp, attackDamage } = summonStatsAtRound(growth, round, statBpActive);
  return { ...mechanic, hp: hp * FIX, attackDamage: attackDamage * FIX };
}

/**
 * 从 StarValue 里取一个"纯数字"。
 *
 * 【为什么不直接 starValue(stats.x, star)？】
 * 因为藏品的数值都是**固定值**（不随星级变），数据里写的都是单个数字。
 * 这里只接受数字；万一是数组（写错了），直接忽略并让校验器去报错，
 * 而不是悄悄按 1 星取值。
 */
function numeric(value: SkillStats[keyof SkillStats]): number | undefined {
  return typeof value === 'number' ? value : undefined;
}
