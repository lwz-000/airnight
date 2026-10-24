import {
  EGG_UNIT_ID,
  SHOP_ODDS_BY_LEVEL,
  UNIT_DEFS,
  playableDefs,
  unitIdsByCost,
} from './unit-data.js';
import { computeActiveTraitLevels, countTraits, traitsOfPlacement } from './synergies.js';
import { ascendRankOf, familyKeyOf, isSellLockedDefId } from './ascension.js';
import type { BattleEvent, TraitDef, TraitDefTable, UnitDef, UnitDefTable, UnitPlacement } from './types.js';

/**
 * ============================================================
 *  经济与商店系统
 * ============================================================
 *
 * 【为什么单独一个文件、而且是纯函数？】
 * 因为这是「玩法核心」，而且以后要搬到服务器上做权威校验
 * （否则玩家改一下请求就能白嫖棋子）。
 * 写成纯函数之后：
 *   · 客户端现在可以直接用
 *   · 搬到服务端时一份代码两边共用
 *   · 可以脱离界面单独测试
 *
 * 【所有随机都走传入的 rng】
 * 不用 Math.random() —— 这样「同样的操作序列必然得到同样的结果」，
 * 联机时服务器和客户端才能对得上（和战斗内核同一个原则）。
 */

/** 等级上限 */
export const MAX_LEVEL = 10;

/** 商店格子数量 */
export const SHOP_SLOTS = 5;

/**
 * ★ 彩蛋棋子「维维美·绝对主角」的出现概率：**每次刷新 1/1500**。
 *
 * 【口径是"每次刷新判定一次"，不是"每格一次"】
 * 每次点刷新（或每回合自动刷新）掷一次骰子，命中就把 5 个格子里随机一个
 * 换成彩蛋棋子 —— 所以见到的概率就是 1/1500，
 * 而不是"5 格 × 1/1500 ≈ 1/300"（那就不叫彩蛋了）。
 *
 * 【为什么不写进商店概率表（SHOP_ODDS_BY_LEVEL）？】
 * 用户明确要求"不进行标注在概率显示上"，而且它**不受等级影响**
 * （全等级统一 1/1500），塞进那张按等级分档的表里反而不对。
 *
 * 【★ 为什么是"模 1500 == 0"而不是"`random() < 1/1500`"？】
 * 因为本项目的随机源（GameState.random，见 apps/web 的 createRng）
 * 返回的是 **32 位无符号整数**，不是 [0,1) 的小数 ——
 * 写 `random() < 0.000667` 会永远为假，彩蛋一次都不会出现。
 * 取模之后落在 [0,1500) 上、分布均匀，`=== 0` 就正好是 1/1500。
 * （商店里所有的概率判断本来就是这个风格：费用档位也是 `random() % 总权重`。）
 */
export const EGG_SHOP_DENOMINATOR = 1500;

/** 刷新一次商店要花多少金币 */
export const REFRESH_COST = 2;

/** 买一次经验花多少金币 */
export const BUY_XP_COST = 4;

/** 买一次经验给多少经验 */
export const BUY_XP_AMOUNT = 4;

/**
 * 初始金币。
 *
 * 【你要求：第一回合 3 金币】
 * 开局只有 3 金 —— 连一个 3 费棋子都买不起，只能买便宜的或者攒着。
 * 这样第一回合的决策是有取舍的（"买两个 1 费"还是"攒钱吃利息"），
 * 比开局给 10 金"随便买"更有味道。
 */
export const START_GOLD = 3;

/**
 * ★ 0.3.31：开局血量（= 血量上限的**基准**）。
 *
 * 【为什么以前没有这个常量，而现在必须有？】
 * 以前"上限"这个概念只在**服务端**存在（`Room.settings.startHp`），
 * 客户端 `hp: 100` 是写死的字面量。于是客户端的藏品回血一路 `hp += n` 不夹上限，
 * 表现就是：满血时装回血藏品 —— 数字涨到 115，下一次结算又被服务端夹回 100，
 * 玩家看到的就是"说明写着回血，装了完全没反应"。
 * 所以这里把基准值收成一个常量，两边共用同一个口径。
 */
export const START_HP = 100;

/** 初始等级 */
export const START_LEVEL = 1;

/** 每回合的基础收入（你要求：10 金币） */
export const INCOME_BASE = 10;

/** 每 10 金币存款产生的利息（1 金币），上限见下 */
export const INTEREST_PER_10_GOLD = 1;

/** 利息上限 */
export const MAX_INTEREST = 5;

/**
 * 连胜奖励的上限（你要求：最多 +5）。
 * 规则是"每连胜 2 局，下一回合多 1 金"。
 */
export const MAX_WIN_STREAK_BONUS = 5;

/**
 * ★ 连胜奖励：每连胜 2 局 +1 金，上限 +5。
 *
 * 连胜 2/4/6/8/10 局 → +1/+2/+3/+4/+5，之后封顶。
 * 【为什么连胜要限得这么死？】
 * 因为连胜的人本来就更强（阵容成型了），再给他滚经济就是雪球 ——
 * 上限 5 金差不多是"多买一个 2 费"，不至于让第一名的经济直接翻倍。
 */
export function winStreakBonus(streak: number): number {
  if (streak <= 0) return 0;
  return Math.min(MAX_WIN_STREAK_BONUS, Math.floor(streak / 2));
}

/**
 * ★ 连败补偿：连败 2 局 +2 金，连败 4 局及以上 +5 金。
 *
 * 【为什么和连胜的算法不一样？】
 * 因为它要**救急**，不能慢慢涨：
 * 连败的人正处在"打不过、又没钱换阵容"的死循环里，
 * 所以第一档就给 2 金（够买一个 2 费）、第二档直接给 5 金（够买一个 4 费）。
 * 用连胜那套 floor(streak/2) 的话，连败 2 局只给 1 金，救不了场。
 *
 * 你只给了 2 局和 4 局两档，所以 4 局以上都按 5 金算（按字面实现）。
 */
export function lossStreakBonus(streak: number): number {
  const losses = -streak; // streak 用负数表示连败
  if (losses >= 4) return 5;
  if (losses >= 2) return 2;
  return 0;
}

/** 连胜/连败的额外金币（正数是连胜、负数是连败、0 是刚开局或刚断） */
export function streakBonusOf(streak: number): number {
  return streak > 0 ? winStreakBonus(streak) : lossStreakBonus(streak);
}

/** 给界面用的连败连胜文字（显示在金币旁边） */
export function streakLabelOf(streak: number): string {
  if (streak >= 2) return `${streak} 连胜`;
  if (streak <= -2) return `${-streak} 连败`;
  return '';
}

/** 备战席格子数 */
export const BENCH_SLOTS = 9;

/**
 * 「测试模式」下的金币数量。
 *
 * 【为什么需要测试模式？】
 * 调数值、看界面效果时，被「金币不够」卡住非常影响效率 ——
 * 你会一直在买棋子和攒钱之间挣扎，没法快速试出各种阵容和羁绊组合。
 * 所以给一个开关：打开后金币拉满，可以随便买、随便刷。
 *
 * 注意这只是给开发/调试用的，正式对局里不该开放。
 */
/** 测试模式下的金币数量 */
export const TEST_MODE_GOLD = 999999;

/**
 * ============================================================
 *  牌库（每张牌在整局里的固定张数）
 * ============================================================
 *
 * 【为什么要有牌库？】
 * 没有牌库的话，商店就是"无限供货"：别人拿了三张，你还能再拿三张。
 * 结果就是人人都能轻松凑三星，运气和"抢牌"这两个自走棋的核心乐趣都没了。
 * 有了固定张数之后：
 *   · 你和对手在**抢同一批牌** —— 对手拿走的，你就抽不到了
 *   · 凑三星变成一件需要规划的事（要么抢得快，要么换个流派）
 *   · 联机时 8 个人共享一个牌库，"谁在抢什么"变成可以观察的信息
 *
 * 【张数怎么定的？】（你给的数值）
 *   1 费 27 张 / 2 费 22 张 / 3 费 18 张 / 4 费 14 张 / 5 费 10 张
 * 按现在的名单算下来，各费用的池子总量是：
 *   1 费 15 个 × 27 = 405
 *   2 费 11 个 × 22 = 242
 *   3 费  9 个 × 18 = 162
 *   4 费  9 个 × 14 = 126
 *   5 费  6 个 × 10 =  60
 * 合计 995 张。低费多、高费少，符合自走棋的常规。
 */
export const COPIES_PER_CARD_BY_COST: Record<number, number> = {
  1: 27,
  2: 22,
  3: 18,
  4: 14,
  5: 10,
};

/** 一张牌在整局里有多少张（费用越界时按最近的档处理） */
export function copiesPerCard(cost: number): number {
  const clamped = Math.max(1, Math.min(5, Math.floor(cost)));
  return COPIES_PER_CARD_BY_COST[clamped] ?? 10;
}

/**
 * 一个棋子"占用了牌库里几张牌"。
 *
 * 【关键：二星占 3 张，三星占 9 张】
 * 因为合成本质上是"把三个棋子捆成一个"。
 * 如果二星只算 1 张，玩家合成之后牌库会凭空多出两张 ——
 * 那"抢牌"就白抢了，而且合得越多牌库越松，完全说不通。
 * 卖掉二星时也是同样的道理：一次还回去 3 张。
 */
export function copiesOf(star: number): number {
  return 3 ** (Math.max(1, Math.min(3, Math.floor(star))) - 1);
}

/**
 * ★ 0.0.3：一枚棋子占牌库**几张** —— 全项目唯一的换算处。
 *
 * 【为什么不能只看星级？】
 * 星级的默认换算是 1★=1、2★=3、3★=9，那是"三合一"的账。
 * 但有几路棋子的份数**不是从牌库拿的**：
 *   · 修改器白送的棋子          -> `free: true`（一张都不占）
 *   · 拟态物质复制出来的那一只   -> `free: true`
 *   · 博士投影把 1★ 升到 2★     -> `free: 1`（只有 1 张真的从牌库拿过，
 *                                  多出来的 2 张是道具给的，不该算占牌库）
 * 所以 `free` 允许写成数字 = "这只只占这么多张"。
 *
 * 【为什么非得按张记，不能继续用一个布尔"整只白送"？】
 * 用户报的 bug：布尔标记会**顺着合成传染**（三个里有一个白送，合出来的整只也算白送），
 * 于是拿一件博士投影就能把手上 7 张维什戴尔全洗成"不占牌库"，
 * 牌库数字从 3 弹回 10。按张记之后，道具只免掉它真正多给的那几张，
 * 合成也只会把三只的张数**加起来**（见 freeFlagFor），账就不会漂。
 */
export function poolCopiesOf(unit: { star: number; free?: boolean | number }): number {
  if (unit.free === true) return 0;
  if (typeof unit.free === 'number') {
    return Math.max(0, Math.min(copiesOf(unit.star), Math.floor(unit.free)));
  }
  return copiesOf(unit.star);
}

/**
 * 把"这只棋子总共占几张"折回 `free` 字段该写什么。
 *
 * 占满 = `undefined`（默认，什么都不用写）；占 0 = `true`；中间值就写数字。
 * 合成时用得到：三个拿去合的棋子各占几张，加起来就是合出来的这只该占的张数。
 */
export function freeFlagFor(star: number, copies: number): boolean | number | undefined {
  const full = copiesOf(star);
  const held = Math.max(0, Math.min(full, Math.floor(copies)));
  if (held >= full) return undefined;
  return held === 0 ? true : held;
}

/** 某个棋子在整局里总共有多少张 */
export function poolSizeOf(defId: string, defs: UnitDefTable = UNIT_DEFS): number {
  const def = defs[defId];
  return def ? copiesPerCard(def.cost) : 0;
}

/**
 * 一个玩家占用了牌库里的哪些牌（defId -> 占用的张数）。
 *
 * ★★ 记账用**家族 key**（`familyKeyOf`），不是棋子自己的 id。
 *   阿米娅升变成「青色怒火」之后，那几张牌**继续占阿米娅的份数**（用户口径）：
 *   不还回去、也不额外多占一张。若按形态 id 记账，`remainingPool` 只遍历可购买名单，
 *   形态那几条记录就凭空消失 —— 表现为"升变一次，牌库里白多出 3 张阿米娅"。
 */
export function copiesHeld(
  units: ReadonlyArray<{ defId: string; star: number; free?: boolean | number }>,
): Map<string, number> {
  const held = new Map<string, number>();
  for (const unit of units) {
    const copies = poolCopiesOf(unit);
    if (copies <= 0) continue;
    const key = familyKeyOf(unit.defId);
    held.set(key, (held.get(key) ?? 0) + copies);
  }
  return held;
}

/**
 * 算出**还剩多少张**（考虑所有玩家的占用）。
 *
 * 【为什么是"算出来"而不是"记一个剩余数量"？】
 * 因为记数量就要在买、卖、合成、收回、掉线……每个地方都记得同步，
 * 只要漏一处，牌库就永久性地对不上了（而且很难查）。
 * 直接由"大家手上有哪些棋子"推导，则**不可能对不上** ——
 * 少了一张一定是因为某个棋子确实被谁拿着。
 * 代价是每次刷新商店要遍历一遍所有棋子（几十个），可以忽略不计。
 */
export function remainingPool(
  allUnits: ReadonlyArray<{ defId: string; star: number; free?: boolean | number }>,
  defs: UnitDefTable = UNIT_DEFS,
): Map<string, number> {
  const held = copiesHeld(allUnits);
  const remaining = new Map<string, number>();
  for (const def of playableDefs(defs)) {
    remaining.set(def.id, Math.max(0, poolSizeOf(def.id, defs) - (held.get(def.id) ?? 0)));
  }
  return remaining;
}

/** 牌库里还剩几张这个棋子 */
export function remainingOf(
  allUnits: ReadonlyArray<{ defId: string; star: number; free?: boolean | number }>,
  defId: string,
  defs: UnitDefTable = UNIT_DEFS,
): number {
  const size = poolSizeOf(defId, defs);
  const held = copiesHeld(allUnits).get(defId) ?? 0;
  return Math.max(0, size - held);
}

/**
 * ★ 0.1.1 藏品二版：**随机招募**该招到谁（人事部铜印 1~3 费 / 博士银印 4~5 费）。
 *
 * 【规则（用户口径）】
 *   1. 先筛出"该费用区间里、牌库还剩 ≥1 张"的干员，从中随机一名 ——
 *      招到的这一只是**真的从牌库拿的**（1★ 占 1 张，卖掉会还回去）。
 *   2. 该区间一张都不剩 -> 招不到人，按"本该抽到的那名干员"的**花费**折算成金币。
 *
 * 【为什么要抽成共享函数？】
 * 单机由客户端本地抽；联机时牌库是 8 个人共享的，"扣牌"必须服务器裁决 ——
 * 两条路必须是**同一套规则**，否则联机和单机的期望不一样。
 *
 * @param candidates 该费用区间里的可上场干员（调用方已按费用过滤；用 playableDefs 取）
 * @param stockOf    "这个干员牌库还剩几张"（联机传服务器那份）
 * @param pickIndex  "在 n 个里挑第几个"（客户端传 `state.random() % n`、服务器传 `rng.nextInt(n)`）
 */
export function pickRecruit(
  candidates: ReadonlyArray<Pick<UnitDef, 'id' | 'cost'>>,
  stockOf: (defId: string) => number,
  pickIndex: (length: number) => number,
): { defId: string; cost: number } | { defId: null; gold: number } {
  if (candidates.length === 0) return { defId: null, gold: 0 };
  const available = candidates.filter((def) => stockOf(def.id) >= 1);
  if (available.length === 0) {
    // 牌库抽空了 —— 按"本该抽到的那名"的花费折算成金币
    const fallback = candidates[pickIndex(candidates.length)]!;
    return { defId: null, gold: fallback.cost };
  }
  const picked = available[pickIndex(available.length)]!;
  return { defId: picked.id, cost: picked.cost };
}


/**
 * 升到「下一级」需要多少经验。
 *
 * 【曲线怎么定的】
 * 升满 10 级总共需要约 60 点经验 = 15 次买经验 = 60 金币。
 * 一局游戏大概有 20~30 回合，每回合基础收入 5 金币 + 利息，
 * 所以如果完全不买棋子、只升级，大概中期能满级。
 * 这是个合理的节奏（玩家必须在「买棋子」和「升级」之间取舍）。
 */
/**
 * 升到下一级需要多少经验 —— **照抄云顶之弈（TFT）的表**。
 *
 * 【这是你要求的改动】
 * 「升级所需要的经验调高，先用云顶的经验数量」。
 *
 * 【云顶的原始表（S14 那套，升满 10 级总计 220 点）】
 *   2→3:  2      3→4:  6      4→5: 10      5→6: 14
 *   6→7: 20      7→8: 36      8→9: 48      9→10: 84
 *
 * 【为什么我们的 1→2 是 1 点，而不是"免费"？】
 * 云顶的规则是「第一波打完之后**免费**升到 2 级」。
 * 我们这边没有"打一波"这个概念可以直接挂钩，所以改成"要 1 点经验"——
 * 而你又要了「每回合自动 +2 经验」，于是第 1 回合结束正好升到 2 级，
 * 和云顶的节奏**完全一致**。
 * （不用 2 点是因为那会让 1→2 和 2→3 一样贵，"经验需求递增"这条会不成立。）
 *
 * 【和改之前比】
 * 改之前是 `2 + level`（总共只要 54 点），现在 1→10 要 222 点，
 * 大约是原来的 4 倍。想升满就必须真的攒钱买经验，
 * "只买棋子不升级"的阵容会明显吃亏 —— 这就是你要的"调高"。
 */
const XP_PER_LEVEL: Record<number, number> = {
  1: 1, // 云顶是"第一波后免费"；我们改成 1 点，配合每回合 +2 经验，第 1 回合结束刚好到 2 级
  2: 2,
  3: 6,
  4: 10,
  5: 14,
  6: 20,
  7: 36,
  8: 48,
  9: 84,
};

export function xpNeededForLevel(level: number): number {
  // 升满级之后不需要经验了
  if (level >= MAX_LEVEL) return 0;
  return XP_PER_LEVEL[level] ?? XP_PER_LEVEL[9]!;
}

/**
 * 每回合自动获得的经验（云顶的「每回合免费 +2 经验」）。
 *
 * 【它为什么重要？】
 * 因为它把"升级"从"纯粹花钱"变成"保底也会慢慢升"。
 * 没有它的话，前期不买经验的玩家会永远卡在低级；
 * 有了它，20 个回合至少能白拿 40 点经验 —— 相当于 10 次买经验（40 金）。
 */
export const AUTO_XP_PER_ROUND = 2;

/**
 * 发经验，并处理"攒够了就升级"。
 *
 * 【为什么单独抽出来？】
 * 因为经验有两个来源：每回合自动 +2、花钱买 4 点。
 * 两处都要"加经验 → 检查升级 → 可能连升几级"，
 * 写成两份迟早会不一致（而"买经验能升级、白给的经验不能升级"这种 bug
 * 会非常难被发现，因为界面上数字是对的）。
 *
 * @returns 这次升了几级、现在几级
 */
export function grantXp(state: EconomyState, amount: number): { levelsGained: number; level: number } {
  if (amount <= 0 || state.level >= MAX_LEVEL) return { levelsGained: 0, level: state.level };
  state.xp += amount;
  let gained = 0;
  // 用 while 而不是 if：一次买 4 点经验可能连升两级（前期很常见）
  while (state.level < MAX_LEVEL && state.xp >= xpNeededForLevel(state.level)) {
    state.xp -= xpNeededForLevel(state.level);
    state.level++;
    gained++;
  }
  if (state.level >= MAX_LEVEL) state.xp = 0;
  return { levelsGained: gained, level: state.level };
}

/**
 * 某个等级的人口上限（能上几个棋子）。
 * 按你的要求：每级 +1 人口。
 */
export function populationCap(level: number): number {
  const clamped = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
  return clamped;
}

/** 商店里的一格 */
export interface ShopSlot {
  defId: string;
  cost: number;
  /** 是否已经被买走（买走后格子变空，要等下次刷新） */
  sold: boolean;
}

/** 备战席上的一个棋子 */
export interface BenchUnit {
  /** 唯一编号，用来区分两个同名棋子 */
  uid: number;
  defId: string;
  star: number;
  /**
   * ★ 0.0.3：这枚棋子占牌库**几张** —— 不写 = 按星级算（1★1 张 / 2★3 张 / 3★9 张）。
   *
   * 【三种取值】
   *   · `undefined` —— 正常：按星级占（买来的都是这种）；
   *   · `true`      —— **一张都不占**：修改器白送的、拟态物质复制出来的；
   *   · `数字 n`     —— **只占 n 张**：博士投影把 1★ 升到 2★ 时写 1
   *                    （三星级的份数里，只有 1 张真的从牌库拿过）。
   *
   * 【为什么不是纯布尔？】
   * 以前是布尔"整只白送"，结果标记会**顺着合成传染**（三个里有一个白送，
   * 合出来的整只也算白送）：用一件博士投影就能把手上 7 张同名干员
   * 全洗成不占牌库，牌库数字从 3 弹回 10（用户报的 bug）。
   * 改成按张记之后，道具只免掉它真正多给的那几张，合成只把张数**加起来**。
   *
   * 换算的唯一入口是 `poolCopiesOf()` / `freeFlagFor()`，别在别处手写这个判断。
   */
  free?: boolean | number;
  /**
   * ★ 0.0.3：这个棋子身上装备的 A 类藏品 id（最多 2 件）。
   *
   * 【为什么把装备存在棋子身上，而不是单独一张"谁装了谁"的表？】
   * 因为棋子会动：备战席 <-> 场上、合成、交换位置、卖掉。
   * 存在棋子身上，这些操作**天然带着装备走**（只要搬运时记得带上这个字段）；
   * 单独一张表的话，每一条搬运路径都要记得同步一次 ——
   * 漏一条就是"装备凭空消失"，而且极难查。
   *
   * 注意：备战席上的棋子装备**不参与战斗**（它没上场），这是对的。
   */
  items?: string[];
  /**
   * ★ 0.2：这枚棋子身上**每一件**藏品的成长层数，和 `items` 同下标。
   *
   * 【为什么备战席上也要记？】
   * 因为棋子会"上场 -> 收回备战席"来回搬，而层数是**跟着棋子走**的
   * （装备还在它身上，层数当然也还在）。实际参与战斗计算只在场上时发生
   * （见 `UnitPlacement.itemLayers`）。
   */
  itemLayers?: number[];
}

/** 玩家的经济与商店状态 */
export interface EconomyState {
  gold: number;
  level: number;
  /** 当前等级已积累的经验 */
  xp: number;
  /** 血量：输一局扣血，扣到 0 淘汰 */
  hp: number;
  /**
   * ★ 0.3.31：血量上限的**基准**（不含盟约加血）。
   *
   * 【为什么存基准，而不是存上限？】
   * 因为盟约是**开局之后**才选的（盟约选秀），存上限的话选完盟约
   * 必须记得回头改一次 —— 那就是"两个真相"。
   * 存基准、上限每次现推（见 `covenant-data.ts` 的 `playerMaxHp`），
   * 盟约一改上限自动跟着变。
   */
  startHp: number;
  /** 连胜数（正数）或连败数（负数） */
  streak: number;
  /** 商店 5 格 */
  shop: ShopSlot[];
  /**
   * 商店是否被锁定。
   * 锁定后回合结束不会自动刷新 —— 用来保住一批好棋子等下一回合买。
   */
  shopLocked: boolean;
  /** 备战席（还没上场的棋子） */
  bench: BenchUnit[];
}

/** 创建初始经济状态 */
export function createEconomy(
  random: () => number,
  defs: UnitDefTable = UNIT_DEFS,
  /**
   * ★ 0.3：开局金币（房间设置里那一项）。
   *
   * 【为什么走参数，而不是让调用方自己 `state.gold = x`？】
   * 因为那样"开局金币"会变成两处写：一处造状态、一处改状态。
   * 以后谁加一句"开局先给一次免费刷新"之类的逻辑，就会把它冲掉。
   * 参数化之后，开局金币在**构造的那一刻**就是对的。
   *
   * 不传 = `START_GOLD`（3），所以单机和老测试的行为一个字节不变。
   */
  startGold = START_GOLD,
  /**
   * ★ 0.3.31：开局血量（房间设置里那一项）。不传 = `START_HP`(100)。
   * 和 `startGold` 同一个理由：走参数而不是让调用方 `state.hp = x`，
   * 免得"开局血量"变成两处写。
   */
  startHp = START_HP,
): EconomyState {
  const initialGold = Number.isFinite(startGold) ? Math.max(0, Math.round(startGold)) : START_GOLD;
  const initialHp = Number.isFinite(startHp) ? Math.max(1, Math.round(startHp)) : START_HP;
  const state: EconomyState = {
    gold: initialGold,
    level: START_LEVEL,
    xp: 0,
    hp: initialHp,
    startHp: initialHp,
    streak: 0,
    shop: [],
    shopLocked: false,
    bench: [],
  };
  state.shop = rollShop(state.level, random, defs);
  return state;
}

/**
 * 刷新商店：按当前等级的费用概率抽出 5 个棋子。
 *
 * 【抽卡逻辑】
 * 先按概率决定这一格是几费（1~5），再从那个费用的**还有货的**棋子里随机挑一个。
 * 这样「等级越高、高费越常见」就自然成立了。
 *
 * @param ctx.remaining 牌库剩余张数（defId -> 还剩几张）。
 *   不传就是"无限牌库"（老行为，方便测试和调试）。
 *   传了的话，抽干的棋子不会再出现；如果整个费用档都抽干了，
 *   会把概率重新分配到还有货的档位上 —— 而不是硬塞一个别的费用的棋子，
 *   那样会让"商店概率"这个核心数值表失去意义。
 */
export function rollShop(
  level: number,
  random: () => number,
  defs: UnitDefTable = UNIT_DEFS,
  ctx: { remaining?: ReadonlyMap<string, number> } = {},
): ShopSlot[] {
  const odds = SHOP_ODDS_BY_LEVEL[Math.max(1, Math.min(MAX_LEVEL, level))] ?? SHOP_ODDS_BY_LEVEL[1]!;

  // 按费用分好"还有货的棋子"。每个费用只算一次，5 个格子共用
  const poolByCost: string[][] = [];
  for (let cost = 1; cost <= 5; cost++) {
    const all = unitIdsByCost(cost, defs);
    poolByCost.push(
      ctx.remaining
        ? all.filter((defId) => (ctx.remaining!.get(defId) ?? 0) > 0)
        : all,
    );
  }

  /*
    ★ 一次刷新里，同一个棋子最多出现"牌库剩余张数"次（你报的第 11 条）。
    【为什么按"张数"而不是"能不能抽"？】
    牌库里只剩 1 张的时候，如果这一批 5 个格子里出现了 2 张同样的牌，
    玩家只能买走其中一张 —— 另一张点了就会失败。
    那种"看得见买不到"的格子最让人以为游戏坏了，所以干脆不让它出现。
    （牌库还剩 3 张时，一次刷新里出现 2 张是允许的：两张都真的买得到。）
  */
  const usedThisRoll = new Map<string, number>();
  const canTake = (defId: string): boolean => {
    if (!ctx.remaining) return true;
    return (ctx.remaining.get(defId) ?? 0) - (usedThisRoll.get(defId) ?? 0) > 0;
  };
  const candidatesIn = (cost: number): string[] => (poolByCost[cost - 1] ?? []).filter(canTake);

  // 还有货的费用档（用来在某个档抽干时重新分配概率）
  const liveIndexes = [0, 1, 2, 3, 4].filter((index) => candidatesIn(index + 1).length > 0);
  const liveOddsTotal = liveIndexes.reduce((sum, index) => sum + odds[index]!, 0);

  const slots: ShopSlot[] = [];

  for (let i = 0; i < SHOP_SLOTS; i++) {
    if (liveIndexes.length === 0) {
      // 整个牌库都被抽干了：给一个空格子（界面上显示成"已售出"）
      slots.push({ defId: '', cost: 0, sold: true });
      continue;
    }

    // 1) 按概率决定费用档位（概率只在"还有货"的档位之间归一化）
    const roll = random() % Math.max(1, liveOddsTotal);
    let cumulative = 0;
    let cost = 0;
    for (const index of liveIndexes) {
      cumulative += odds[index]!;
      if (roll < cumulative) {
        cost = index + 1;
        break;
      }
    }
    if (cost === 0) cost = liveIndexes[liveIndexes.length - 1]! + 1;

    // 2) 从这一档里随机挑一个棋子（还要看"这一轮里它是不是已经抽过了"）
    let pool = candidatesIn(cost);
    let fallback = cost;
    // 万一这一档刚好被抽干（或还没设计这一档的棋子），往下退到有货的档位
    while (pool.length === 0 && fallback > 1) {
      fallback--;
      pool = candidatesIn(fallback);
    }
    if (pool.length === 0) {
      // 往上找
      const upper = liveIndexes.find((index) => index >= cost - 1);
      pool = candidatesIn((upper ?? liveIndexes[0]!) + 1);
    }
    if (pool.length === 0) {
      if (!ctx.remaining) {
        // 整张表是空的 —— 这种情况属于数据配错，直接给出明确报错
        throw new Error('棋子表里一个棋子都没有，商店无法刷新');
      }
      // 牌库（对这个人来说）真的被抽干了：给一个空格子，界面上显示成"已售出"
      slots.push({ defId: '', cost: 0, sold: true });
      continue;
    }

    const defId = pool[random() % pool.length]!;
    usedThisRoll.set(defId, (usedThisRoll.get(defId) ?? 0) + 1);
    const def = defs[defId]!;
    slots.push({ defId, cost: def.cost, sold: false });
  }

  /*
    ★ 彩蛋棋子：**每次刷新**独立判定 1/1500，命中就把随机一个格子换掉。
    
    【为什么放在最后？】
    上面 5 个格子的抽卡顺序、消耗的随机数一个都不能变 —— 联机时种子相同、
    两边必须抽出同一批牌。把彩蛋判定放在循环之后，就只**追加**随机消耗，
    不影响任何已有格子的结果（而且它本来也不需要和其他格子"抢"随机数）。
    
    【注意】它不参与 `liveOddsTotal` 的归一化，也不看 `ctx.remaining`
    —— 彩蛋是"凭空出现"的，和牌库/等级那套概率体系完全无关。
  */
  const eggDef = defs[EGG_UNIT_ID];
  if (eggDef && random() % EGG_SHOP_DENOMINATOR === 0) {
    const index = random() % slots.length;
    const target = slots[index];
    if (target && !target.sold) {
      slots[index] = { defId: EGG_UNIT_ID, cost: eggDef.cost, sold: false };
    }
  }

  return slots;
}

/**
 * 花金币刷新商店。
 *
 * @param free 免费刷新（每回合自动换一批时用）。
 *             不用「先扣钱再补回来」那种绕法 —— 那会让界面闪一下金币变化，
 *             也容易在别处忘记补而导致钱莫名少了。
 */
export function refreshShop(
  state: EconomyState,
  random: () => number,
  free = false,
  defs: UnitDefTable = UNIT_DEFS,
  ctx: { remaining?: ReadonlyMap<string, number> } = {},
): { ok: boolean; message: string } {
  if (!free && state.gold < REFRESH_COST) {
    return { ok: false, message: `金币不够，刷新需要 ${REFRESH_COST} 金` };
  }
  if (!free) state.gold -= REFRESH_COST;
  state.shop = rollShop(state.level, random, defs, ctx);
  // 刷新会把所有格子重置成「未售出」，锁定状态也一并清掉 ——
  // 锁定的意义是「保住这一批」，既然换了一批，锁就没用了
  state.shopLocked = false;
  return { ok: true, message: free ? '商店已自动刷新' : `刷新商店（-${REFRESH_COST} 金）` };
}

/**
 * 切换「锁定商店」。
 *
 * 【锁定是干什么的？】
 * 回合结束会自动刷新商店。但有时候你看到了一批好棋子却暂时没钱买，
 * 想留到下一回合买 —— 这时候锁定就能保住这一批不被刷掉。
 * 这是自走棋的标配功能，也是「运营」的一部分。
 */
export function toggleShopLock(state: EconomyState): { ok: boolean; message: string } {
  state.shopLocked = !state.shopLocked;
  return {
    ok: true,
    message: state.shopLocked ? '商店已锁定，回合结束不会刷新' : '商店已解锁',
  };
}

/**
 * 花金币买经验。
 *
 * 【为什么这是自走棋最关键的操作之一？】
 * 因为「买棋子」和「升级」抢同一份金币。
 * 升级能提高人口上限、还能让商店出更贵的棋子 ——
 * 玩家每次点这个按钮都在做取舍，这就是策略深度的来源。
 */
export function buyXp(state: EconomyState): { ok: boolean; message: string } {
  if (state.level >= MAX_LEVEL) {
    return { ok: false, message: `已经是最高等级 ${MAX_LEVEL} 级了` };
  }
  if (state.gold < BUY_XP_COST) {
    return { ok: false, message: `金币不够，买经验需要 ${BUY_XP_COST} 金` };
  }

  state.gold -= BUY_XP_COST;
  // 升级的判定统一走 grantXp（它内部是 while，能连升好几级）
  const { levelsGained: leveled } = grantXp(state, BUY_XP_AMOUNT);

  if (leveled > 0) {
    return {
      ok: true,
      message: `升到 ${state.level} 级！人口上限 ${populationCap(state.level)}`,
    };
  }
  return { ok: true, message: `买了 ${BUY_XP_AMOUNT} 点经验（-${BUY_XP_COST} 金）` };
}

/**
 * 买下商店里的某一格。
 *
 * 买来的棋子先放进备战席（云顶的做法），再由玩家拖到场上。
 * 这比「直接放场上」更符合自走棋习惯 —— 你可以先攒着。
 *
 * 【这里为什么不检查合成？】
 * 因为合成要看**整支队伍**（备战席 + 场上），而这一层只能看到备战席。
 * 以前在这里调 mergeBench，会出现这种情况：
 *   场上已有 1 个、备战席已有 2 个，再买第 4 个
 *   -> 这里只看见备战席的 3 个，于是合成物落在**备战席**上，
 *      场上那个还是 1 星，玩家得手动换 —— 明显不对。
 * 现在合成统一交给上层的 mergeAllUnits()（它同时看得见两边），
 * 买完、放上场、收回、清空之后都会调用一次。
 */
export function buyShopSlot(
  state: EconomyState,
  slotIndex: number,
  nextUid: () => number,
  defs: UnitDefTable = UNIT_DEFS,
  ctx: {
    remaining?: ReadonlyMap<string, number>;
    /**
     * ★ 备战席满了也允许买（你报的第 3 条）。
     *
     * 【为什么需要这个开关？—— 它修的是"满席时永远合不出三星"】
     * 原来的判断是 `bench.length >= BENCH_SLOTS` 就直接拒绝，
     * 而这个判断发生在**合成之前**。于是：
     *   备战席 9 格满、场上已经有 2 个同名同星，
     *   买第 3 个正好能凑三星 —— 但这一买被拦下了，
     *   mergeAllUnits 根本没机会跑，玩家永远合不出那个三星。
     *
     * 调用方（game/state.ts）知道场上和备战席的完整信息，
     * 它会先算一遍"买了之后会不会立刻合成"再把这个开关打开。
     * 合成必然腾出格子（吃 3 个吐 1 个），所以放行是安全的。
     */
    allowFullBench?: boolean;
    /**
     * ★ 0.1.1 藏品二版：这一买要**额外多付/少付**多少金币（剑锤 +2）。
     *
     * 【为什么收在这里，而不是让调用方自己扣？】
     * 因为"够不够钱"的判断和"扣多少"必须同时看这一个数 ——
     * 调用方自己先扣一遍的话，`state.gold < def.cost` 那句就漏掉了这份差价，
     * 会放行一次"买完金币变成负数"的购买。
     * 差价的口径（哪些藏品算、只算装载中的）在客户端的 `shopPriceDelta` 里，
     * 这里只认数字，不认藏品 —— 内核不该知道装备系统。
     */
    costDelta?: number;
  } = {},
): { ok: boolean; message: string } {
  const slot = state.shop[slotIndex];
  if (!slot) return { ok: false, message: '这个格子不存在' };
  if (slot.sold) return { ok: false, message: '这个棋子已经被买走了' };

  const def = defs[slot.defId];
  if (!def) return { ok: false, message: '棋子数据缺失' };

  // 实际价格 = 面板价 + 藏品带来的变化；下面的判断和扣款都用它
  const price = Math.max(0, def.cost + (ctx.costDelta ?? 0));

  if (state.gold < price) {
    return { ok: false, message: `金币不够，还差 ${price - state.gold} 金` };
  }
  if (state.bench.length >= BENCH_SLOTS && !ctx.allowFullBench) {
    return { ok: false, message: `备战席满了（${BENCH_SLOTS} 格），先上场或卖掉一些` };
  }
  // 牌库空了就买不了 —— 这是"抢牌"机制真正生效的地方
  if (ctx.remaining && (ctx.remaining.get(def.id) ?? 0) <= 0) {
    return { ok: false, message: `${def.name} 已经被拿完了（牌库没货了）` };
  }

  state.gold -= price;
  slot.sold = true;
  state.bench.push({ uid: nextUid(), defId: def.id, star: 1 });

  // ★ 0.2：提示里的钱数必须用**实付价**（带剑锤时是 5 而不是 3），否则玩家会觉得账对不上
  return { ok: true, message: `买下 ${def.name}（-${price} 金）` };
}

/**
 * 卖掉一个棋子能返还多少金币。
 *
 * 【规则：原价返还（花多少退多少）】
 * 合成一个 N 星需要 3^(N-1) 个一星：
 *   1 星 = 1 个  → 原价 = 费用 × 1
 *   2 星 = 3 个  → 原价 = 费用 × 3
 *   3 星 = 9 个  → 原价 = 费用 × 9
 * 所以返还额 = 费用 × 3^(星级-1)。
 *
 * 【为什么必须按原价返？】
 * 因为合成是"把三个棋子捆成一个"，本身不产生也不销毁金币。
 * 如果 2 星只返 2 个的钱（费用 × 星级），玩家每合一次就平白亏一个棋子的钱 ——
 * 结果就是"谁合成谁吃亏"，等于在惩罚玩家使用核心机制。
 *
 * 【曾经的 bug】
 * 原代码写的是 `cost * star`，看起来"星级越高返越多"，实际上：
 *   2 星花了 3 倍的钱，只返 2 倍 → 亏 1 个
 *   3 星花了 9 倍的钱，只返 3 倍 → 亏 6 个
 * 这个错误只靠读代码很难发现（公式"看起来挺合理"），
 * 所以现在把公式抽成这个函数，并由测试钉死 1/2/3 星的返还额。
 */
export function sellPriceOf(cost: number, star: number, paidDelta = 0): number {
  const stars = Math.max(1, Math.min(3, Math.floor(star)));
  // 3^(stars-1)：1 星 -> 1，2 星 -> 3，3 星 -> 9
  return cost * 3 ** (stars - 1) + Math.max(0, paidDelta);
}

/** 卖掉备战席上的棋子，返还金币 */
export function sellBenchUnit(
  state: EconomyState,
  uid: number,
  defs: UnitDefTable = UNIT_DEFS,
  /**
   * ★ 0.2：这枚棋子买的时候**额外多付**了几金（剑锤那种"购买干员 +2"）。
   *
   * 【为什么要有它？】
   * 用户报的 bug：带着剑锤买一个 3 费干员，花的是 5 金；卖的时候只退 3 金 ——
   * 那 2 金凭空没了。设计稿写的是"售卖时也是购买时的价格"，
   * 所以返还额必须把当时多付的那份一起退回来。
   * 差价的口径（哪些藏品算、只算装载中的）在客户端 `shopPriceDelta` 里，
   * 内核这边只认数字 —— 和 `buyShopSlot` 的 `costDelta` 完全对称。
   */
  paidDelta = 0,
  /**
   * ★ 0.3.2：**测试模式放行**升变形态的出售。
   *
   * 用户口径：这条限制只做在单机正常对局和多人模式里；测试模式（修改器那个沙盒）
   * 要能把形态卖掉换阵容，否则调阿米娅这套东西时手上会卡着几个卖不掉的棋子。
   *
   * ★ 为什么放在参数上而不是让调用方自己先判断？
   * 因为"能不能卖"是一条**规则**，规则必须只在内核里判一次。
   * 放在参数上，客户端唯一入口 `doSellBench` 传 `state.testMode` 就行，
   * 以后万一还有别的调用点，默认值 `false` 也是安全的（拦）。
   */
  opts: { allowAscendForm?: boolean } = {},
): { ok: boolean; message: string } {
  const index = state.bench.findIndex((unit) => unit.uid === uid);
  if (index < 0) return { ok: false, message: '备战席上没有这个棋子' };

  const unit = state.bench[index]!;
  const def = defs[unit.defId];
  /*
    ★ 0.3.2 用户口径：阿米娅升变后的三个形态**不能出售**
    （测试模式例外，见 `allowAscendForm`）。判据唯一实现在 `ascension.ts`。
  */
  if (opts.allowAscendForm !== true && isSellLockedDefId(unit.defId)) {
    return { ok: false, message: `${def?.name ?? unit.defId} 是升变形态，不能出售` };
  }
  // 原价返还：2 星退 3 个的钱，3 星退 9 个的钱（见 sellPriceOf 的说明）
  const refund = def ? sellPriceOf(def.cost, unit.star, paidDelta) : 1 + Math.max(0, paidDelta);
  state.bench.splice(index, 1);
  state.gold += refund;
  return { ok: true, message: `卖掉 ${def?.name ?? unit.defId}（+${refund} 金）` };
}

/**
 * 检查备战席能不能合成，能就合成。
 *
 * 【自走棋的核心机制：三个一样的棋子合成一个升一星的】
 * 规则：同一个棋子、同一个星级，凑够 3 个就合成 1 个高一星的。
 * 三星是上限，不会再往上升。
 *
 * @param nextUid **必须由外部传入的 uid 发放器**
 *
 * 【为什么 uid 不能让这个函数自己编？—— 这里踩过一个很隐蔽的 bug】
 * 第一版我写的是 `newUid = Math.max(剩下的uid, 被吃掉的uid) + 1`，
 * 想「取最大值再 +1」来保证唯一。看起来很合理，实际上会撞号：
 * 因为**发放 uid 的计数器在外面**（客户端的 uidCounter），
 * 合成自己造出来的 uid 计数器并不知道 —— 一旦计数器落后，
 * 后面新买的棋子就会拿到一个已经被合成物占用的 uid。
 *
 * 撞号的后果非常隐蔽：备战席里有两条 uid 相同的记录，
 * 而「吃掉三个」是按 uid 过滤的，于是**同号的另一个棋子被一起删掉** ——
 * 表现就是「合成第二个二星时会消失一个二星」。
 *
 * 所以改成：uid 一律由外部计数器发（见下面 nextUid 参数），
 * 这个函数只负责「谁被吃掉、生成几星」，不碰编号。
 *
 * 返回值描述了发生了哪些合成（用于界面提示）。
 */
export function mergeBench(
  state: EconomyState,
  nextUid: () => number,
): Array<{ defId: string; star: number }> {
  const results: Array<{ defId: string; star: number }> = [];

  // 反复扫描，因为一次合成可能又凑够了下一档（三个二星合成三星）
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 50) {
    changed = false;

    for (const star of [1, 2]) {
      // 统计「每个棋子、每个星级」各有几个，并记下它们的 uid。
      // uid 唯一（由外部计数器保证），所以这里可以安全地按 uid 定位。
      /*
        ★★ 分组用**家族 key**：阿米娅的三个升变形态和基础阿米娅算同一只棋子
        （用户口径：1 星「青色怒火」+ 再买 2 张 1 费阿米娅 = 2 星「青色怒火」）。
        合成结果保留组里**最靠后的那个形态**（`ascendRankOf`），
        否则"升变过又买了两张"会退回基础形态，等于把升变吃掉了。
      */
      const groups = new Map<string, number[]>();
      for (const unit of state.bench) {
        if (unit.star !== star) continue;
        const key = familyKeyOf(unit.defId);
        const list = groups.get(key) ?? [];
        list.push(unit.uid);
        groups.set(key, list);
      }

      // 按家族 key 排序遍历，保证合成顺序稳定 => 确定性
      for (const familyKey of [...groups.keys()].sort()) {
        /*
          ★ 没有星级机制的棋子不参与合成（彩蛋「维维美·绝对主角」）。
          三个它凑在一起应该**还是三个**，而不是莫名变成"2 星维维美"
          —— 它连星级都没有，升了也没意义。和野怪同一条规则。
          （查的是家族代表 = 基础棋子，家族成员的星级机制跟它一致。）
        */
        if (UNIT_DEFS[familyKey]?.noStar === true) continue;
        const uids = groups.get(familyKey)!;
        if (uids.length < 3) continue;

        // 拿走前三个
        const consumed = uids.slice(0, 3);
        const consumedUnits = state.bench.filter((unit) => consumed.includes(unit.uid));
        /*
          ★ 0.0.3：合出来的这只占几张 = 被吃掉的三个**各占几张之和**（封顶到该星级）。
          用"张数相加"而不是以前的"有一个白送就整只白送" ——
          后者会把道具免掉的那几张放大成一整只（用户报的"牌库弹回满"）。
        */
        const consumedCopies = consumedUnits.reduce((sum, unit) => sum + poolCopiesOf(unit), 0);
        // ★ 保留组内最靠后的形态（全是基础棋子时就是它自己，行为和以前完全一样）
        let defId = familyKey;
        for (const unit of consumedUnits) {
          if (ascendRankOf(unit.defId) > ascendRankOf(defId)) defId = unit.defId;
        }
        state.bench = state.bench.filter((unit) => !consumed.includes(unit.uid));

        // 生成高一星的，uid 由外部计数器发（保证全场唯一）
        state.bench.push({ uid: nextUid(), defId, star: star + 1, free: freeFlagFor(star + 1, consumedCopies) });
        // 排序让备战席顺序稳定（合成结果的先后不影响玩法，但影响界面观感）
        state.bench.sort((a, b) => a.uid - b.uid);

        results.push({ defId, star: star + 1 });
        changed = true;
        break; // 重新扫描一遍
      }
      if (changed) break;
    }
  }

  return results;
}

/**
 * 算出羁绊给的**回合收入**。
 *
 * 【为什么经济效果不放进 applyTraitBonuses？】
 * 因为它们影响的是**回合结算**，不是棋子属性。
 * 硬塞进战斗属性里就得凭空编一个数值，那才是真的不对。
 *
 * 支持两种写法（你给的羁绊里两种都出现了）：
 *   1. `goldPerRound` 效果：直接每回合给固定金币
 *   2. `goldPerSurvivor` 机制（奸商）：**每有一个未阵亡的奸商干员**给金币，
 *      而且同一个干员只算一次（上两个可露希尔不会翻倍）
 *
 * @param survivorDefIds 这一回合结束时**没死**的干员 id。
 *   不传就当作"全员存活"（用于备战阶段预览收入）。
 */
export function computeTraitGold(
  placements: UnitPlacement[],
  defs: UnitDefTable,
  traitDefs: TraitDefTable,
  survivorDefIds?: ReadonlySet<string>,
): { gold: number; sources: string[] } {
  const levels = computeActiveTraitLevels(placements, defs, traitDefs);
  let gold = 0;
  const sources: string[] = [];

  for (const level of levels) {
    if (level.tierIndex < 0) continue;
    const def = traitDefs[level.traitId];
    if (!def) continue;
    const tier = def.tiers[level.tierIndex]!;

    // ---- 1) 固定每回合金币 ----
    for (const effect of tier.effects) {
      if (effect.type !== 'goldPerRound') continue;
      gold += effect.value;
      sources.push(`${def.name}+${effect.value}`);
    }

    // ---- 2) 按"活着的奸商干员"给钱 ----
    for (const mechanic of tier.mechanics ?? []) {
      if (mechanic.kind !== 'goldPerSurvivor') continue;
      // 同一个干员只算一次 —— 所以用 Set 收集 defId 而不是数棋子个数
      const merchants = new Set<string>();
      for (const placement of placements) {
        const unitDef = defs[placement.defId];
        if (!unitDef) continue;
        if (!traitsOfPlacement(placement, unitDef).includes(level.traitId)) continue;
        // 没传存活名单就当作全员存活（备战阶段预览用）
        if (survivorDefIds && !survivorDefIds.has(placement.defId)) continue;
        merchants.add(placement.defId);
      }
      if (merchants.size === 0) continue;
      const gain = merchants.size * mechanic.goldEach;
      gold += gain;
      sources.push(`${def.name}×${merchants.size}+${gain}`);
    }
  }

  return { gold, sources };
}

/**
 * 算出一场战斗结束后**我方还有哪些干员活着**。
 *
 * 【为什么要这个？】
 * 奸商羁绊写的是「每一名奸商干员**未死亡**才给钱」，
 * 所以必须知道谁活下来了。
 * 战斗日志里的 death 事件带的是 unitId，而 unitId 是按"上阵顺序"编的
 * （见 rules.ts 的 unitIdFor：team*1000 + 下标 + 1），
 * 所以可以把 unitId 映射回我方第几个上阵的棋子 -> 它的 defId。
 */
export function survivorsOfTeam(
  placements: UnitPlacement[],
  deathUnitIds: ReadonlySet<number>,
  team: 0 | 1,
): Set<string> {
  const alive = new Set<string>();
  placements.forEach((placement, index) => {
    const unitId = team * 1000 + index + 1;
    if (!deathUnitIds.has(unitId)) alive.add(placement.defId);
  });
  return alive;
}

/**
 * ★ 0.0.3 藏品：从战斗日志里数出**某一队**在战斗中掉到了多少金币。
 *
 * 【为什么要从日志里数？】
 * 因为它和"每回合固定收入"不是一回事：
 *   · 铳骑之威「击杀敌人时有 20% 获得一金币」
 *   · 黄沙罗盘「死亡时有 50% 概率获得一金币」
 * 都是**概率触发**，而概率必须走战斗自己的随机数（否则联机两边算出来的不一样）。
 * 也就是说"掉没掉金"是战斗过程的一部分，战斗内核把它记成了 `gold` 事件，
 * 客户端播完战斗照着事件把钱加上去 —— 数一次就够，不用再掷骰子。
 *
 * @param team 我所在的队（**不是**恒 0！联机时我可能被分到队伍 1）
 */
export function battleGoldOf(log: BattleEvent[], team: 0 | 1): number {
  let total = 0;
  for (const event of log) {
    if (event.type === 'gold' && event.team === team) total += event.amount;
  }
  return total;
}

/**
 * 回合结算：发钱 + 发经验。
 *
 * 收入 = 基础 + 利息 + 连胜连败奖励 + 羁绊
 * 这是自走棋「运营」的核心：存钱吃利息 vs 花钱买强度，是个真实的取舍。
 *
 * 【利息规则（你定的，和云顶一致）】
 * 「每有 10 金币，下回合额外获得 1 金币，手里可触发利息上限 50 金币」
 *   -> 利息 = min(5, floor(存款 / 10))
 *   -> 存 50 金吃满 5 利息；存 100 金还是 5 利息（多的钱不生息）
 * 所以"攒到 50 就够本，再多攒不划算"—— 这条让存钱有个明确的甜蜜点。
 *
 * 【为什么结算里还要发经验？】
 * 因为你要的「每回合自动获得两点玩家经验」就发生在这里。
 * 注意顺序：**先算利息再发钱**。反过来的话，本回合刚发的钱会立刻开始生息，
 * 存钱党的收益会凭空多一截（而且很难查，因为数字只差一点点）。
 *
 * ★ 0.0.3：`itemGold` 是**藏品**给的钱（至宝指环每回合 +1、幸运硬币连败 +1）。
 *   它和 `traitGold` 一样是"额外的固定收入"，所以也加在同一个 total 里；
 *   传 0（默认）时的行为和以前**完全一样**（联机服务端就没传）。
 *
 * ★ 0.0.3：`battleGold` 是**战斗过程中**掉的战利品（铳骑之威击杀掉金 / 黄沙罗盘阵亡掉金），
 *   由 `battleGoldOf(log, myTeam)` 从战斗事件流里数出来。
 *   为什么不能并进 `itemGold`？因为那一个是"回合开始前就能算出来的固定值"，
 *   而这个是"开打之后掷完骰子才知道的"，来源和时机都不一样 —— 分开传，
 *   出问题时一眼能看出来是多发了一笔战利品还是哪件藏品重复算了一次。
 */
export function settleRound(
  state: EconomyState,
  won: boolean | null,
  traitGold = 0,
  itemGold = 0,
  battleGold = 0,
  /**
   * ★ 0.1.1：这一回合要不要计入连胜/连败。
   *
   * 【为什么需要它？—— 野怪回合不算数（用户要求）】
   * 野怪回合的对手是一波野怪，不是人。如果照旧计数：
   *   · 打赢野怪 -> 连胜 +1（白赚一层）；
   *   · 打输野怪 -> 连胜清零并转成连败（更糟：明明只是被野怪教训了一顿，
   *     却把之前攒的连胜进度全搭进去）。
   * 所以野怪回合**整层不动**：赢了不加、输了也不清零，进度原样留到下一场真人对战。
   *
   * 【为什么用参数而不是在这里自己判断回合号？】
   * `EconomyState` 里没有"回合号"，也不该有（经济是经济、回合是回合）。
   * 判断交给调用方（`advanceRound` 有 `state.round`），这里只负责"算不算"。
   */
  streakCounts = true,
  /**
   * ★ 0.3：每回合的**基础收入**（房间设置里那一项，默认 10）。
   *
   * 【为什么也要参数化？】
   * 因为"每回合发多少钱"是这一局经济曲线的总闸门，房主能改它才算真的 DIY。
   * 不传 = `INCOME_BASE`，所以单机和老测试照旧。
   */
  incomeBase = INCOME_BASE,
  /**
   * ★ 0.3 盟约「利滚利」：利息上限（默认 5，它给 7）。
   * 不传 = `MAX_INTEREST`，老行为一个字节不变。
   */
  maxInterest = MAX_INTEREST,
  /**
   * ★ 0.3 盟约「私募基金」：按回合号发的一笔钱（第 6、13、20… 回合各一次）。
   * 单独一个参数是为了**明细里写自己的名字** —— 混进 `itemGold` 会被算成"藏品"，
   * 玩家对不上账就会以为是 bug。不传 = 0，老行为一个字节不变。
   */
  covenantGold = 0,
): { gold: number; breakdown: string; xp: number; levelUps: number } {
  // 更新连胜/连败
  if (streakCounts) {
    if (won === true) {
      state.streak = state.streak >= 0 ? state.streak + 1 : 1;
    } else if (won === false) {
      state.streak = state.streak <= 0 ? state.streak - 1 : -1;
    }
  }

  // 利息按**结算前**的存款算 —— 顺序不能反（见上面的注释）
  const interestCap = Number.isFinite(maxInterest) ? Math.max(0, Math.round(maxInterest)) : MAX_INTEREST;
  const interest = Math.min(interestCap, Math.floor(state.gold / 10) * INTEREST_PER_10_GOLD);
  const streakBonus = streakBonusOf(state.streak);
  const baseIncome = Number.isFinite(incomeBase) ? Math.max(0, Math.round(incomeBase)) : INCOME_BASE;
  const covenantPart = Number.isFinite(covenantGold) ? Math.max(0, Math.round(covenantGold)) : 0;
  const total = baseIncome + interest + streakBonus + traitGold + itemGold + battleGold + covenantPart;

  state.gold += total;

  // 每回合白送的 2 点经验
  const { levelsGained } = grantXp(state, AUTO_XP_PER_ROUND);

  return {
    gold: total,
    xp: AUTO_XP_PER_ROUND,
    levelUps: levelsGained,
    breakdown:
      `基础 ${baseIncome} + 利息 ${interest}` +
      (streakBonus > 0
        ? ` + ${state.streak > 0 ? `${state.streak} 连胜` : `${-state.streak} 连败`} ${streakBonus}`
        : '') +
      (traitGold > 0 ? ` + 羁绊 ${traitGold}` : '') +
      (itemGold > 0 ? ` + 藏品 ${itemGold}` : '') +
      (battleGold > 0 ? ` + 战利品 ${battleGold}` : '') +
      (covenantPart > 0 ? ` + 盟约 ${covenantPart}` : '') +
      ` · 经验 +${AUTO_XP_PER_ROUND}`,
  };
}

/**
 * 输掉一局扣多少血。
 *
 * 【规则（你定的）】
 *   第 1~5 回合  扣 3 滴
 *   第 6~10 回合 扣 6 滴
 *   第 11~15 回合 扣 9 滴
 *   以此类推，每 5 个回合多扣 3 滴
 *
 * 也就是 `3 × ceil(回合 / 5)`：每满 5 回合进一档。
 * 满血 100 滴，一直输的话大约第 15~16 回合出局 ——
 * 既不会"前几回合就被打空"（那样阵容还没成型就结束了），
 * 也不会"打到 30 回合还分不出胜负"（那样一局要一小时）。
 *
 * 【为什么抽成函数？】
 * 因为服务端（真实扣血）和客户端（单机扣血）都要用同一个公式。
 * 以前客户端那边**又写了一遍** `2 + Math.floor(round/5)`，
 * 两处一旦不同步就是"联机扣 3 滴、单机扣 2 滴"这种谁都想不到的 bug。
 * 现在只有这一个来源。
 */
export function damageForRound(round: number): number {
  const safeRound = Math.max(1, Math.floor(round));
  return 3 * Math.ceil(safeRound / 5);
}

/** 给界面用：当前等级、经验进度、人口上限的摘要 */
export function levelSummary(state: EconomyState): {
  level: number;
  xp: number;
  xpNeeded: number;
  progress: number;
  populationCap: number;
  atMaxLevel: boolean;
} {
  const xpNeeded = xpNeededForLevel(state.level);
  return {
    level: state.level,
    xp: state.xp,
    xpNeeded,
    progress: xpNeeded > 0 ? state.xp / xpNeeded : 1,
    populationCap: populationCap(state.level),
    atMaxLevel: state.level >= MAX_LEVEL,
  };
}
