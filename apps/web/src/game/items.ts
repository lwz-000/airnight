import {
  AMIYA_CERT_SLOTS,
  ITEM_A_SLOTS,
  ITEM_B_EQUIP_SLOTS,
  ITEM_B_SLOTS,
  ITEM_DEFS,
  ITEM_PER_UNIT,
  playableDefs,
  type ItemDef,
  type ItemSlot,
} from '../../../../packages/shared/src/index.js';

/**
 * ============================================================
 *  藏品（装备）—— 库存数据与**不碰状态**的规则
 * ============================================================
 *
 * 【为什么单独一个文件？】
 * 这个文件里全是纯函数 / 纯数据：给它一个库存（或者几个数字），它给你一个答案，
 * 不修改任何东西。所以它可以脱离游戏状态单独测试
 * （和 `enemy-lineup.ts` 一样的分工）。
 *
 * 真正"会改状态"的操作（装备 / 卸下 / 删除 / 获得）在 `state.ts` 里，
 * 因为那些要用到 uid 发放器、合成、玩家血量这些只住在 state 里的东西。
 *
 * ============================================================
 *  格子长什么样（★ 和用户给的界面规格一一对应）
 * ============================================================
 *   aSlots  10 格  —— A 类藏品**存放区**（还没装备的）
 *   bSlots   5 格  —— B 类藏品**存放区**（还没装备的）
 *   bEquip   4 格  —— B 类**共享装备位**（真正生效的那 4 件）
 *
 * ★★ 代号与话术：A / B 只是**内部分类代号**（也就是 `slot` 字段的值），
 *   **界面上一个字都不许出现** —— 对外一律叫「穿戴藏品」（A，穿到干员身上）
 *   和「共享藏品」（B，放共享装备位、全队受益）。
 *   所以下面注释里写"A 类"是给你看的，凡是拼进字符串给玩家看的，
 *   一律走 `zoneLabel()` 或 shared 的 `ITEM_SLOT_SHORT` / `ITEM_SLOT_LABEL`。
 *
 * A 类藏品装备之后**不住在这三个数组里**，而是挂在干员自己身上
 * （`BenchUnit.items` / `Placement.items`，最多 `ITEM_PER_UNIT` 件）：
 * 这样棋子移动、合成、卖掉的逻辑天然带着它走，不用额外维护一张"谁装了谁"的表
 * —— 那种表最容易在合成 / 卖出时忘记同步，然后出现"装备凭空消失"。
 */

/** 藏品格：`null` = 空格子，字符串 = 藏品的 id */
export type ItemSlotRef = string | null;

/** 一个玩家的全部藏品栏 */
export interface ItemInventory {
  /** A 类藏品存放区（10 格） */
  aSlots: ItemSlotRef[];
  /** B 类藏品存放区（5 格） */
  bSlots: ItemSlotRef[];
  /** B 类共享装备位（4 格）—— 放在这里的才是真正生效的 */
  bEquip: ItemSlotRef[];
  /**
   * 本局永久效果（失落之钥）。
   *
   * `lostKeyPaid` 是"十级奖励已经发过了"的标记 ——
   * 没有它的话，到十级之后每次买经验都会再发 50 金。
   */
  permanent: { lostKey: boolean; lostKeyPaid: boolean };
  /**
   * ★ 0.1.1 藏品二版：**跨回合成长层数**。
   *
   * 【★ 0.2 大改：这张表不再是"真相"，只当老存档的兜底】
   * 原来它是 `{藏品id: 层数}` —— 于是**多件同名藏品共享同一个层数**：
   * 两个干员各装一件「佣兵的饰物」时，两件永远显示同一个数、也只涨一份
   * （用户报的："有些单独穿戴的叠层藏品，我有多个时层数会共享，
   * 改为相同藏品单独也要叠层"）。
   *
   * 现在层数**跟着这一件副本走**：
   *   · A 类 → 挂在棋子身上（`Placement.itemLayers` / `BenchUnit.itemLayers`，
   *            和 `items` 同下标；棋子怎么搬，层数就怎么跟着走）；
   *   · B 类 → `bEquipLayers`（和 `bEquip` 同下标）。
   * 这张 `growth` 表只在"读不到逐副本数组"时兜底（老对局存档 / 老客户端上报）。
   * ★ 别往它里面写新数据 —— 写了也不会被读，等于静默失效。
   *
   * 【层数什么时候 +1？】`ItemGrowth.source` 决定，全部在
   * `state.ts` 的 `applyItemGrowthAfterBattle` 里结算：
   *   kill（击倒数）/ win（胜场）/ round（每回合）/ battle（概率）。
   * 所有有成长的藏品都是"卸下即重置" —— 所以层数天然跟着"当前装着的那一件"走。
   */
  growth: Record<string, number>;
  /**
   * ★ 0.2：共享装备位里**每一件**藏品的成长层数，和 `bEquip` 同下标。
   *
   * 理由见上面 `growth` 的说明：两个「圆石祭坛」并排时各叠各的。
   */
  bEquipLayers: number[];
  /** ★ 0.1.1：这件藏品是**第几回合拿到**的（剑锤"2 回合后未装载自动销毁"要用） */
  gainedRound: Record<string, number>;
  /**
   * ★★ 0.3.2 升变之证**专用栏位**（3 格，固定顺序：青色怒火 / 慈悲愿景 / 炉芯终曲）。
   *
   * 【为什么不塞进 `aSlots` 那 10 格？】
   * 用户口径：这三张证是"任务换来的"，**绝不能因为穿戴藏品栏满了就发不出来**。
   * 塞进 A 类 = 要么发不出去（栏满），要么得挤掉玩家已经攒的藏品 —— 两种都糟。
   * 所以单开 3 格：不进 A 类容量、不占 A 类位置，界面上也只在"确实拿到了证"时才显示。
   *
   * ★ 下标 != "第几个空位"，而是**证的种类**（0 青色 / 1 慈悲 / 2 终曲）：
   *   发证时直接写对应格，天然去重（同一张证不会有第二件），界面上顺序也永远稳定。
   *   所以这一栏**不能互换位置**（见 `itemDropAllowed`）。
   */
  certSlots: ItemSlotRef[];
}

/**
 * 藏品格子属于哪一栏（拖动 / 删除都要带上它）。
 *
 * `'cert'` 是 ★ 0.3.2 新增的**升变之证专用栏**（3 格，位置固定、不能互换、不能删）。
 */
export type ItemZone = 'a' | 'b' | 'bequip' | 'cert';

/** 造一个空的藏品栏（每局开始时调用） */
export function createItemInventory(): ItemInventory {
  return {
    aSlots: new Array<ItemSlotRef>(ITEM_A_SLOTS).fill(null),
    bSlots: new Array<ItemSlotRef>(ITEM_B_SLOTS).fill(null),
    bEquip: new Array<ItemSlotRef>(ITEM_B_EQUIP_SLOTS).fill(null),
    permanent: { lostKey: false, lostKeyPaid: false },
    growth: {},
    bEquipLayers: [],
    gainedRound: {},
    // ★ 0.3.2 升变之证专用栏（3 格，空着就是不显示）
    certSlots: new Array<ItemSlotRef>(AMIYA_CERT_SLOTS).fill(null),
  };
}

// ============================================================
// ★ 0.1.1 藏品二版：跨回合成长 / 未装载数量 / 商店花费
// ============================================================

/**
 * ★ 0.2：**逐副本**层数的读写工具。
 *
 * 【为什么下面这几个函数（growthOf / bumpGrowth / resetGrowth）还在？】
 * 它们是 0.1.1 的"按藏品 id 记"那套，现在只用于**老数据的兜底读取**
 * （以及 `ItemStateInput.growth` 那份可选的旧格式）。新代码一律走逐副本的数组：
 *   · `layerAt` / `normalizeLayers` —— 读
 *   · 层的加减直接改数组（都在 `state.ts` 的那几处结算里，见 applyItemGrowthAfterBattle）
 * 别再往 `inv.growth` 里写：写了没有任何地方会读，等于静默失效。
 */

/** 取第 `index` 件副本的层数（缺省 / 脏数据 = 0） */
export function layerAt(list: readonly number[] | undefined, index: number): number {
  const value = list?.[index];
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/** 把层数数组对齐到 `items` 的长度（缺的补 0，多的截掉） */
export function normalizeLayers(
  items: readonly string[] | undefined,
  layers: readonly number[] | undefined,
): number[] {
  return Array.from({ length: items?.length ?? 0 }, (_, index) => layerAt(layers, index));
}

/** 这件藏品现在攒了多少层（**旧口径**，只用于兜底） */
export function growthOf(inv: ItemInventory, itemId: string): number {
  return inv.growth[itemId] ?? 0;
}

/**
 * 给一件藏品的成长层数 +1（到 `item.growth.maxStacks` 封顶）。
 *
 * @returns 实际有没有涨（已封顶 = false，调用方可以不刷界面）
 */
export function bumpGrowth(inv: ItemInventory, itemId: string, amount = 1): boolean {
  const growth = ITEM_DEFS[itemId]?.growth;
  if (!growth) return false;
  const next = Math.min(growth.maxStacks, (inv.growth[itemId] ?? 0) + amount);
  if (next === (inv.growth[itemId] ?? 0)) return false;
  inv.growth[itemId] = next;
  return true;
}

/** 清零一件藏品的成长层数（卸下 / 失败时用） */
export function resetGrowth(inv: ItemInventory, itemId: string): void {
  delete inv.growth[itemId];
}

/**
 * 藏品栏里**还没装载**的藏品数量（悲伤的红按它加属性）。
 *
 * 【只数两个"存放栏"，不数共享装备位】—— 设计稿写的是
 * 「每有 1 个未装载的藏品（藏品栏上的装备数量）」，
 * 也就是"躺在栏里没用的那些"。共享装备位里的已经生效了，不算"未装载"。
 */
export function countUnequipped(inv: ItemInventory): number {
  return countItems(inv.aSlots) + countItems(inv.bSlots);
}

/**
 * 现在**装着的**藏品让"购买干员的花费"变化多少（剑锤 +2）。
 *
 * 【为什么要扫两个地方？】
 * «剑锤» 是 B 类（在共享装备位里，`inv.bEquip`）；
 * 但同类效果以后也可能出现在 A 类身上 —— 而 A 类藏品挂在**棋子**上，
 * 不在 `inv` 里，所以由调用方从场上/备战席收集好，用 `equipped` 传进来。
 *
 * ★ 只算**装载中**的，不算躺在存放栏里的。
 *   设计稿写的是"装载后往后购买干员所需费用 +2"，躺在栏里没装的不该收这个钱。
 *   （这里踩过一次：早先顺手把 `aSlots`/`bSlots` 两个存放栏也扫了，
 *    结果"拿到剑锤还没装"就先涨价了 —— 那是错的。）
 */
export function shopCostDelta(inv: ItemInventory, equipped: readonly (readonly string[])[]): number {
  let delta = 0;
  for (const itemId of collectItems(inv.bEquip)) delta += ITEM_DEFS[itemId]?.shopCostDelta ?? 0;
  for (const list of equipped) {
    for (const itemId of list) delta += ITEM_DEFS[itemId]?.shopCostDelta ?? 0;
  }
  return delta;
}

/** 某一栏有几格（界面上要画这么多格子） */
export function zoneSize(zone: ItemZone): number {
  if (zone === 'a') return ITEM_A_SLOTS;
  if (zone === 'b') return ITEM_B_SLOTS;
  // ★ 0.3.2 升变之证专用栏
  if (zone === 'cert') return AMIYA_CERT_SLOTS;
  return ITEM_B_EQUIP_SLOTS;
}

/**
 * 某一栏的中文名（**玩家看得见**，会出现在 toast 里）。
 *
 * ★★ 对外一律叫「穿戴藏品 / 共享藏品」，不出现「A 类 / B 类」。
 *   A / B 只是内部分类的代号（也正好是 `slot` 字段的值），玩家不需要知道。
 *   这里三个名字分别对应：穿戴藏品的存放栏 / 共享藏品的存放栏 / 共享装备位。
 */
export function zoneLabel(zone: ItemZone): string {
  if (zone === 'a') return '穿戴藏品栏';
  if (zone === 'b') return '共享藏品栏';
  // ★ 0.3.2：这三格是任务专属的，玩家不该看到"A 类第 4 格"这种话
  if (zone === 'cert') return '升变之证';
  return '共享装备位';
}

/**
 * 某一栏里躺着哪些藏品。
 *
 * 【★ 为什么要抽成一个函数，而不是 `inv.aSlots[i]`？】
 * 界面上到处要按"栏 + 下标"取值，而"栏"是三种不同的数组。
 * 如果每个地方都自己写一遍 `zone === 'a' ? aSlots : zone === 'b' ? bSlots : bEquip`，
 * 迟早有一处写漏一个分支（然后"共享装备位里显示的其实是存放栏的内容"）。
 * 只有这一处知道映射关系。
 */
export function zoneList(inv: ItemInventory, zone: ItemZone): ItemSlotRef[] {
  if (zone === 'a') return inv.aSlots;
  if (zone === 'b') return inv.bSlots;
  // ★ 0.3.2 升变之证专用栏
  if (zone === 'cert') return inv.certSlots;
  return inv.bEquip;
}

/** 按 id 取藏品定义（拿不到就返回 undefined，调用方自己兜底） */
export function itemDefOf(itemId: ItemSlotRef | undefined): ItemDef | undefined {
  return itemId ? ITEM_DEFS[itemId] : undefined;
}

/** 把一栏里的空格子下标找出来（-1 = 满了） */
export function freeSlotIndex(list: readonly ItemSlotRef[]): number {
  return list.findIndex((value) => value === null);
}

/** 一栏里实际躺着几件 */
export function countItems(list: readonly ItemSlotRef[]): number {
  return list.filter((value) => value !== null).length;
}

/** 把一栏里的藏品 id 摘出来（忽略空格子），顺序保持格子顺序 */
export function collectItems(list: readonly ItemSlotRef[]): string[] {
  return list.filter((value): value is string => typeof value === 'string');
}

/** 存放某一类藏品的那一栏（A 类进 A 栏、B 类进 B 栏） */
export function storageZoneOf(slot: ItemSlot): ItemZone {
  return slot === 'A' ? 'a' : 'b';
}

// ============================================================
// 装载与卸下的前置判断
// ============================================================

/**
 * 这件藏品能不能装在这个星级的干员身上？
 *
 * 目前只有「博士投影」有条件（只能装备给 1 星干员）。
 * @returns 不满足时返回给玩家看的那句话，满足返回 null
 */
export function itemRequirementError(item: ItemDef, star: number): string | null {
  const require = item.onEquip?.require;
  if (!require) return null;
  const min = require.minStar ?? 1;
  const max = require.maxStar ?? 3;
  if (star < min || star > max) {
    return `${item.name} 只能装备给 ${min}~${max} 星干员（这个干员是 ${star} 星）`;
  }
  return null;
}

/**
 * 干员还能不能再装一件 A 类藏品。
 *
 * ★ 「立刻销毁」类（拟态物质 / 博士投影 / 突变细胞）**不算**占用装备位 ——
 * 它们的效果就是"装上去当场消耗掉"，干员身上不会多出一件装备。
 * 如果把它们也算进去，玩家会看到"消耗品把两个装备位占满了"这种怪事。
 */
export function unitItemSlotsLeft(itemIds: readonly string[], consume: boolean): number {
  if (consume) return ITEM_PER_UNIT;
  return Math.max(0, ITEM_PER_UNIT - itemIds.length);
}

/** 干员身上装了哪些藏品（A 类，最多 2 件） */
export function equippedItemIds(unit: { items?: string[] }): string[] {
  return unit.items ?? [];
}

// ============================================================
// 从库存里算出来的派生数值
// ============================================================

/**
 * 装备带来的额外人口上限（地形图 +1）。
 *
 * 【为什么是"算出来"而不是存一个计数器？】
 * 因为它必须和"装备栏里现在有什么"完全一致。存一个累加器的话，
 * 装备 +1、卸下 -1、删除 -1，只要有一处忘了减，
 * 人口上限就永久性地多了 —— 而且玩家只会觉得"人口莫名其妙变多了"。
 * 每次现算（最多扫 4+9+10 件藏品）不可能对不上。
 */
export function itemPopCapBonus(options: {
  /** 共享装备位（4 格） */
  bEquip: readonly ItemSlotRef[];
  /** 场上 + 备战席所有干员身上装的 A 类藏品 */
  equipped: readonly (readonly string[])[];
}): number {
  let bonus = 0;
  const add = (itemId: string): void => {
    bonus += ITEM_DEFS[itemId]?.onEquip?.popCap ?? 0;
  };
  for (const itemId of collectItems(options.bEquip)) add(itemId);
  for (const list of options.equipped) for (const itemId of list) add(itemId);
  return bonus;
}

/**
 * 回合结束时藏品给的金币（至宝指环 / 幸运硬币）。
 *
 * @param lost 这一回合**输了**没有 —— 幸运硬币只在连败时给钱。
 */
export function itemRoundGold(
  inv: ItemInventory,
  lost: boolean,
): { gold: number; sources: string[] } {
  let gold = 0;
  const sources: string[] = [];
  for (const itemId of collectItems(inv.bEquip)) {
    const item = ITEM_DEFS[itemId];
    const per = item?.perRound;
    if (!item || !per) continue;
    if (per.gold) {
      gold += per.gold;
      sources.push(`${item.name} +${per.gold}`);
    }
    if (per.goldOnLossStreak && lost) {
      gold += per.goldOnLossStreak;
      sources.push(`${item.name}（连败）+${per.goldOnLossStreak}`);
    }
  }
  return { gold, sources };
}

/** 共享装备位里现在生效的藏品 id（要传给战斗内核做 B 类加成） */
export function sharedItemIds(inv: ItemInventory): string[] {
  return collectItems(inv.bEquip);
}

/**
 * ★ 0.2：共享装备位里**每一件**藏品的成长层数。
 *
 * 【为什么不是直接 `[...inv.bEquipLayers]`？】
 * 因为 `bEquip` 里有空格子（null），而 `sharedItemIds` 是**过滤掉空格**之后的列表。
 * 层数必须和那份 id 列表**同下标、同顺序**，否则「第 2 格 5 层」会被算到第 1 件头上。
 * 所以遍历时必须和 `collectItems` 走同样的过滤口径 —— 这里刻意并排写在一起，
 * 一眼能看出两者是配套的。
 */
export function sharedItemLayerList(inv: ItemInventory): number[] {
  const out: number[] = [];
  inv.bEquip.forEach((id, index) => {
    if (!id) return;
    out.push(layerAt(inv.bEquipLayers, index));
  });
  return out;
}

/** 一件藏品是不是"装上去就没了"（立刻销毁类） */
export function isConsumedOnEquip(item: ItemDef): boolean {
  return item.onEquip?.consume === true;
}

/**
 * 这件藏品有没有"装上去当场结算"的效果。
 *
 * 【为什么要问这个？】
 * 因为这类藏品（古旧残币、热水壶、无瑕宝玉、血魔的寝床、失落之钥、
 * 拟态物质、博士投影、突变细胞）**共享一个坑**：
 * 拖上去先执行了效果、再发现条件不满足（备战席满 / 星级不对），
 * 就变成了"白拿了 30 金币、藏品还在"。
 * 所以 state.ts 在动手之前必须先拿这个函数问一次，把能查的条件全查完。
 */
export function hasInstantEffect(item: ItemDef): boolean {
  const onEquip = item.onEquip;
  if (!onEquip) return false;
  return Boolean(onEquip.consume || onEquip.gold || onEquip.hp || onEquip.popCap || onEquip.permanent || onEquip.prep);
}

// ============================================================
// 备战类效果的"抽目标"
// ============================================================

/**
 * 突变细胞：把装备者换成"同星级、高一费"的随机干员。
 *
 * 【几个刻意的选择】
 *  · **只从可玩干员里抽**（`playableDefs()`）：野怪的 id 排序在干员前面，
 *    直接对 `UNIT_DEFS` 取样会抽出源石虫 / Boss（这个坑在 presets.ts 踩过一次）。
 *  · 排除"它自己"：不然会出现"突变了但什么都没变"。
 *  · 5 费时还在 5 费里抽（设计稿原话："5 费干员变为随机 5 费干员"）。
 *  · 随机数走传进来的 `random`（种子化的），不用 Math.random ——
 *    这样联机 / 回放的抽卡结果可复现。
 *
 * @returns 目标干员 id；抽不出候选（数据缺失）时返回 null
 */
export function pickTransformTarget(currentDefId: string, random: () => number): string | null {
  const playable = playableDefs();
  const byId = new Map(playable.map((def) => [def.id, def]));
  const currentCost = byId.get(currentDefId)?.cost ?? 1;
  const targetCost = Math.min(5, currentCost + 1);
  const candidates = playable.filter((def) => def.cost === targetCost && def.id !== currentDefId);
  if (candidates.length === 0) return null;
  return candidates[random() % candidates.length]!.id;
}

/**
 * 把一组藏品 id 尽量塞进某一栏，返回塞不下的那些。
 *
 * 【这是给谁用的？】
 * "棋子身上带着藏品，但棋子被卖掉 / 被合成吃掉"的时候，
 * 那些藏品必须**回到库里**而不是凭空消失。
 * 库满了就返回剩下的（调用方负责告诉玩家"有几件没放下"），
 * 绝不静默丢弃 —— 静默丢装备是最让人上火的一类 bug。
 *
 * @returns 没塞进去的藏品 id（顺序不变）
 */
export function pushItemsIntoZone(inv: ItemInventory, zone: ItemZone, itemIds: readonly string[]): string[] {
  const list = zoneList(inv, zone);
  const left: string[] = [];
  for (const itemId of itemIds) {
    const free = freeSlotIndex(list);
    if (free < 0) {
      left.push(itemId);
      continue;
    }
    list[free] = itemId;
  }
  return left;
}

/**
 * 一组藏品分别该回到哪一栏。
 *
 * 返回 `{ a: [...], b: [...] }`，方便调用方一次塞完。
 * 认不出来的 id 会被丢掉（数据对不上时不该让游戏崩，但也不该假装它有地方去）。
 */
export function splitByZone(itemIds: readonly string[]): { a: string[]; b: string[] } {
  const a: string[] = [];
  const b: string[] = [];
  for (const itemId of itemIds) {
    const item = ITEM_DEFS[itemId];
    if (!item) continue;
    (item.slot === 'A' ? a : b).push(itemId);
  }
  return { a, b };
}
