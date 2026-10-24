/**
 * ============================================================
 *  ★★ 0.2 新机制：**商店回合**（野怪回合之后出现的限时商店）
 * ============================================================
 *
 * 【它是什么？】
 * 每打完一个**野怪回合**（第 1、2 回合不算），会插入一个 **90 秒**的商店阶段：
 * 屏幕正中弹出一张绿色的大商店，左边站着官方商人「坎诺特」，右边 8 个货架。
 * 这个阶段**不占回合数** —— 它不是一个"回合"，只是回合之间的一个插曲。
 *
 * 【卖什么？】
 *   4 个普通藏品位（8 金）
 *   2 个进阶藏品位（16 金，不含 18 件转职藏品）
 *   1 个干员棋子位（**直接卖 2 星**，价格 = 3 × 费用）
 *   1 个转职藏品位（12 金）
 * 刷新：4 / 8 / 12 / 16 金（第 4 次起都是 16）。
 * 卖掉身上没装备的藏品：普通 4 / 进阶 8 / 转职 6（= 售价的一半）。
 *
 * 【为什么"每个人看到的不一样"？】
 * 用户口径：每人一份**个人随机**。所以货架用的是 `state.random`
 * （每个玩家自己的种子序列），不是共享的牌库随机。
 * 唯一和"共享"有关的是**干员位** —— 它要从共享牌库取牌，
 * 所以生成时会按"**我这边**还能刷到几张"过滤（见 `rollOperatorSlot`）。
 *
 * 【这个文件只放"数据 + 纯计算"】
 * 改状态的动作（扣钱、进货架、进备战席）在 `game/state.ts` 里 ——
 * 因为那些要碰 `nextUid` / 备战席 / 牌库视图，而那些只有 state.ts 知道。
 * 这样两边不互相 import，不会成环。
 */
import {
  ADVANCED_ITEMS,
  ITEM_DEFS,
  MAX_LEVEL,
  NORMAL_ITEMS,
  RELIC_ITEM_OF_TRAIT,
  SHOP_ODDS_BY_LEVEL,
  unitIdsByCost,
  type ItemDef,
} from '../../../../packages/shared/src/index.js';
/*
  ★★ 「什么时候有商店回合、它有多长」住在 **shared**（`packages/shared/src/shop-round.ts`），
  这里只是**转出去** —— 因为联机的服务端也要用同一份判据来开那 90 秒。
  ★ 别在这里再写一遍 `isShopRoundAfter` / `SHOP_ROUND_SECONDS`：
  两边各写一份，迟早出现"服务端开了商店、客户端没进"（或反过来）。
*/
export { SHOP_ROUND_SECONDS, FIRST_SHOP_ROUND, isShopRoundAfter } from '../../../../packages/shared/src/shop-round.js';

// ============================================================
//  常量
// ============================================================

/** 货架上限：4 普通 + 2 进阶 + 1 干员 + 1 转职 = 8 */
export const SHOP_SLOT_LIMITS = {
  normal: 4,
  advanced: 2,
  operator: 1,
  traitRelic: 1,
} as const;

/** 买价（金） */
export const SHOP_BUY_PRICE = {
  normal: 8,
  advanced: 16,
  traitRelic: 12,
} as const;

/** 卖价（金）= 买价的一半（用户口径） */
export const SHOP_SELL_PRICE = {
  normal: 4,
  advanced: 8,
  traitRelic: 6,
} as const;

/** 干员位是 2 星 ⇒ 值 3 张 1 星（`sellPriceOf(cost, 2)` = cost × 3） */
export const OPERATOR_SLOT_STAR = 2;
export const OPERATOR_SLOT_COPIES = 3;

/** 刷新价：第 1 次 4、第 2 次 8、第 3 次 12、第 4 次起都是 16 */
export function rerollPriceOf(rerolls: number): number {
  const times = Math.max(0, Math.floor(rerolls));
  return Math.min(4, times + 1) * 4;
}

// ============================================================
//  货物
// ============================================================

export type ShopSlotKind = 'normal' | 'advanced' | 'operator' | 'traitRelic';

export interface ShopRoundSlot {
  kind: ShopSlotKind;
  /** 藏品 id（normal / advanced / traitRelic） */
  itemId?: string;
  /** 干员 id（operator） */
  defId?: string;
  /** 干员星级（固定 2） */
  star?: number;
  /** 这一格的价格（金） */
  price: number;
  /** 已经买走了吗（买走后留着空位，不重排 —— 免得手指点错格） */
  sold: boolean;
}

export interface ShopRoundState {
  /** 弹窗开着吗（默认开；关掉后可用金币上方的按钮再打开） */
  open: boolean;
  /** 当前是"购买"还是"售卖"页 */
  mode: 'buy' | 'sell';
  /** 剩余秒数（到 0 自动进入下一回合的备战） */
  secondsLeft: number;
  /** 8 个货架 */
  slots: ShopRoundSlot[];
  /** 这个商店回合已经刷新过几次（决定下一次刷新价） */
  rerolls: number;
  /**
   * ★ 0.2：这是**本局第一次**商店吗（失落之钥只在这时候能刷出来）。
   * 记在实例上而不是每次现算 —— 现算要问"本局进过几次"，而重连/快照恢复之后
   * 那个计数可能对不上；这一次商店的属性是跟着这一次商店走的。
   */
  firstOfGame: boolean;
}

/** 两件转职藏品：18 件 `itm_relic_<羁绊>`（变形同构体不算转职，它只是"换转职"的道具） */
const TRAIT_RELIC_IDS: readonly string[] = Object.values(RELIC_ITEM_OF_TRAIT);

/** 进阶位**排除**转职藏品（用户口径），其余进阶藏品都行（含变形同构体） */
const ADVANCED_POOL: readonly ItemDef[] = ADVANCED_ITEMS.filter(
  (item) => !TRAIT_RELIC_IDS.includes(item.id),
);

const NORMAL_POOL: readonly ItemDef[] = NORMAL_ITEMS;

/**
 * ★★ 0.2（用户 2026-10-17）：**失落之钥**的出场规则。
 *
 * 【用户口径】「失落之钥改为只能出现在本局的第一次商店；购买后该玩家不能再次刷出和获得」。
 * 落地成两件事：
 *   1. 货架生成时把 `itm_lost_key` 从进阶池里**摘掉**，除非调用方显式允许
 *      （`allowLostKey`）—— 而这个"允许"只有**本局第一次商店**才给；
 *   2. 买过之后 `permanent.lostKey` 为真 ⇒ 永远不再允许（商店 / 刷新 / 野怪掉落 /
 *      fever 宝藏全都走同一个判据，见 state.ts 的 `canOfferLostKey`）。
 *
 * ★ 为什么要"显式允许"而不是"显式禁止"？因为漏写参数时**宁可不出**：
 *   这件藏品是本局唯一的一次性 gamble，刷得到处都是会把玩家的经济预期打乱。
 */
const LOST_KEY_ID = 'itm_lost_key';

/** 这次货架能不能出失落之钥 */
export interface ShopRollOptions {
  allowLostKey?: boolean;
}

function advancedPoolFor(options: ShopRollOptions): readonly ItemDef[] {
  if (options.allowLostKey === true) return ADVANCED_POOL;
  return ADVANCED_POOL.filter((item) => item.id !== LOST_KEY_ID);
}

const RELIC_POOL: readonly ItemDef[] = TRAIT_RELIC_IDS.map((id) => ITEM_DEFS[id]).filter(
  (item): item is ItemDef => Boolean(item),
);

/**
 * ★★ 0.2（用户 2026-10-17）：「降低变形同构体在商店刷出来的概率，大概降 40%」。
 *
 * 【怎么落地的？】它不是"删掉"，而是**权重**：池子里每件藏品默认 100 分，
 * 变形同构体只给 60 分 ⇒ 抽到它的相对概率降到原来的 60%（≈ 降 40%）。
 * 16 件进阶藏品、2 个进阶位时：原来每格 1/16 = 6.25%，现在 60/(60+15×100) ≈ 3.8%。
 *
 * ★ 为什么用权重而不是"抽到就重抽一次"？
 *   重抽会白白多消耗随机数、而且"降多少"没法精确表达；权重是一行数就写完的口径，
 *   调平衡只要改这一个数（40% -> 50% 就写 50）。
 */
export const SHOP_ITEM_WEIGHT: Record<string, number> = {
  itm_morph_relic: 60,
};

/** 某件藏品在商店货架里的权重（没登记 = 100） */
export function shopItemWeightOf(itemId: string): number {
  return SHOP_ITEM_WEIGHT[itemId] ?? 100;
}

/** 池子大小自检口径（测试/导表用） */
export const SHOP_POOLS = {
  normal: NORMAL_POOL,
  advanced: ADVANCED_POOL,
  traitRelic: RELIC_POOL,
} as const;

/** 这件藏品按什么价卖（普通 / 进阶 / 转职） */
export function sellPriceOfItem(itemId: string): number {
  if (TRAIT_RELIC_IDS.includes(itemId)) return SHOP_SELL_PRICE.traitRelic;
  const rarity = ITEM_DEFS[itemId]?.rarity;
  return rarity === 'advanced' ? SHOP_SELL_PRICE.advanced : SHOP_SELL_PRICE.normal;
}

// ============================================================
//  生成货架
// ============================================================

/**
 * 从池子里**不重复**地抽 n 件（池子不够就少抽，不报错）。
 * ★ 走 `random()`（每个玩家自己的序列）—— 这就是"每人一份随机"的来源。
 */
function pickDistinct<T>(
  pool: readonly T[],
  count: number,
  random: () => number,
  weightOf?: (item: T) => number,
): T[] {
  const remaining = [...pool];
  const out: T[] = [];
  for (let i = 0; i < count && remaining.length > 0; i++) {
    /*
      ★ 0.2：带权抽取（不重复）。`weightOf` 不传就是**等概率**（老行为一字不差）——
      老行为很重要：干员位/转职位那些池子的随机序列不能因为这次改动整体挪位。
    */
    let index: number;
    if (!weightOf) {
      index = random() % remaining.length;
    } else {
      const weights = remaining.map((item) => Math.max(1, Math.round(weightOf(item))));
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      let roll = random() % Math.max(1, total);
      index = 0;
      while (index < weights.length - 1 && roll >= weights[index]!) {
        roll -= weights[index]!;
        index++;
      }
    }
    out.push(remaining.splice(index, 1)[0]!);
  }
  return out;
}

/**
 * 干员位：按**玩家等级的概率**抽一个费用档，再从"我这边还剩 ≥3 张"的干员里挑一个。
 *
 * 【为什么要求剩 3 张？】
 * 这一格卖的是**2 星**棋子 = 3 张 1 星。牌库只剩 1~2 张时卖 2 星，
 * 等于凭空多印一张 —— 用户口径"不会出现牌库已经不够的牌"。
 *
 * @param remaining 传一个"我这边某张牌还剩几张"的查询（联机时会扣掉别人摆着的）
 */
export function rollOperatorSlot(
  level: number,
  random: () => number,
  remaining: (defId: string) => number,
): ShopRoundSlot | null {
  const odds = SHOP_ODDS_BY_LEVEL[Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)))] ??
    SHOP_ODDS_BY_LEVEL[1]!;

  // 每个费用档里"还剩 ≥3 张"的干员
  const poolByCost: string[][] = [];
  for (let cost = 1; cost <= 5; cost++) {
    poolByCost.push(unitIdsByCost(cost).filter((defId) => remaining(defId) >= OPERATOR_SLOT_COPIES));
  }
  const liveCosts = [1, 2, 3, 4, 5].filter((cost) => (poolByCost[cost - 1]?.length ?? 0) > 0);
  if (liveCosts.length === 0) return null;

  /*
    按概率挑费用档。★ 只在"有货"的档之间归一化 ——
    和 `rollShop` 同一个口径：某个档抽干了就把它的概率分给别的档，
    而不是"掷到空档就跳过"（那样会让高费的出货率凭空空掉）。
  */
  const total = liveCosts.reduce((sum, cost) => sum + odds[cost - 1]!, 0);
  let roll = random() % Math.max(1, total);
  let pickedCost = liveCosts[liveCosts.length - 1]!;
  for (const cost of liveCosts) {
    roll -= odds[cost - 1]!;
    if (roll < 0) {
      pickedCost = cost;
      break;
    }
  }

  const ids = poolByCost[pickedCost - 1]!;
  const defId = ids[random() % ids.length]!;
  return {
    kind: 'operator',
    defId,
    star: OPERATOR_SLOT_STAR,
    // 2 星 = 3 张 1 星 ⇒ 价格 = 3 × 费用（用户口径）
    price: pickedCost * OPERATOR_SLOT_COPIES,
    sold: false,
  };
}

/**
 * 生成一整排货架：4 普通 + 2 进阶 + 1 干员 + 1 转职。
 *
 * ★ 顺序固定（先普通、再进阶、再干员、再转职），界面按这个顺序铺格子 ——
 *   顺序一变，玩家上一次记住的"干员在右下角"就不成立了。
 */
export function rollShopRoundSlots(
  level: number,
  random: () => number,
  remaining: (defId: string) => number,
  options: ShopRollOptions = {},
): ShopRoundSlot[] {
  const slots: ShopRoundSlot[] = [];

  // ★ 0.2：普通位 / 进阶位都按权重抽（变形同构体在进阶位，权重 60）
  for (const item of pickDistinct(NORMAL_POOL, SHOP_SLOT_LIMITS.normal, random, (it) => shopItemWeightOf(it.id))) {
    slots.push({ kind: 'normal', itemId: item.id, price: SHOP_BUY_PRICE.normal, sold: false });
  }
  for (const item of pickDistinct(advancedPoolFor(options), SHOP_SLOT_LIMITS.advanced, random, (it) => shopItemWeightOf(it.id))) {
    slots.push({ kind: 'advanced', itemId: item.id, price: SHOP_BUY_PRICE.advanced, sold: false });
  }

  const operator = rollOperatorSlot(level, random, remaining);
  // 牌库连 3 张都凑不出时这一格空着（宁可不卖，也不卖一张印出来的卡）
  if (operator) slots.push(operator);
  else slots.push({ kind: 'operator', price: 0, sold: true });

  for (const item of pickDistinct(RELIC_POOL, SHOP_SLOT_LIMITS.traitRelic, random)) {
    slots.push({ kind: 'traitRelic', itemId: item.id, price: SHOP_BUY_PRICE.traitRelic, sold: false });
  }

  return slots;
}

/** 失落之钥的 id（"买过就再也不出"那条规则要用，别在别处抄字符串） */
export const LOST_KEY_ITEM_ID = LOST_KEY_ID;

/** 这一格是"藏品"（买来进藏品栏）还是"干员"（买来进备战席） */
export function isItemSlot(slot: ShopRoundSlot): boolean {
  return slot.kind !== 'operator';
}
