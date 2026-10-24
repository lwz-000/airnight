/**
 * ============================================================
 *  0.3.4「图鉴 + 组队器」—— 纯逻辑层
 * ============================================================
 *
 * 【这一层负责什么】
 *   · 图鉴：55 个棋子按**费用**分 5 组、89 件藏品按**用途**分 3 组；
 *   · 组队器：15 个栏位的增删，以及「这 15 个棋子能激活哪些羁绊」。
 *
 * 【★★ 三件不重新发明的事】（本项目最典型的坑就是同一口径写了两遍）
 *   ① 「哪些棋子该列出来」→ `isPlayableDef()`。
 *      排除召唤物 / 野怪 / 阿米娅升变形态的判据**只有这一处**，
 *      这里若自己 filter 一遍，以后加新形态就会漏。
 *   ② 「这个羁绊生效了吗」→ `buildTraitStatus()`。
 *      和左侧羁绊面板**同一个函数** —— 否则会出现"组队器显示生效、开打却没加成"。
 *   ③ 稀有度色 / 标签 → `rarityOfCost()`，和商店卡面同一套。
 *
 * 【★ 组队器是「计划」，不是「阵容」】
 * 它不写进 state、不上报服务端、**不落 localStorage**（用户口径：仅本局有效）。
 * 它只做两件正事：给你看这 15 个棋子能激活哪些羁绊、给商店卡打「计划」角标提醒你买。
 *
 * 【★ 为什么栏位写死 15，而不是跟随人口上限？】
 * 用户明确选了「固定 15 个」。注意实际人口上限是 `popCap = 等级(1~10) + 藏品(最多+4)`，
 * **最大 14** —— 所以第 15 格在满配时也放不上场，它只是多给你一格做规划。
 * 界面上会把这件事写出来（见 main.ts 的组队器脚注），别让玩家以为能真上 15 个。
 */

import {
  UNIT_DEFS,
  ITEM_DEFS,
  TRAIT_RELICS,
  buildTraitStatus,
  isPlayableDef,
  rarityOfCost,
  type ItemDef,
  type TraitStatus,
  type UnitDef,
  type UnitPlacement,
} from '../../../../packages/shared/src/index.js';

// ============================================================
// 一、棋子：按费用分 5 组
// ============================================================

export interface CodexUnitGroup {
  cost: number;
  /** 「3 费」 */
  label: string;
  /** 「蓝」 */
  rarityLabel: string;
  /** 稀有度基色，和商店卡面同源 */
  rarityBase: string;
  units: UnitDef[];
}

/** 图鉴只收录 1~5 费。彩蛋 `egg_mvm` 是 20 费，靠这条自然排除，不用单独写死 id。 */
const CODEX_COSTS = [1, 2, 3, 4, 5] as const;

/** 图鉴里能查到的棋子（可玩 + 1~5 费），按费用再按编号排序 */
export function codexUnits(): UnitDef[] {
  return Object.values(UNIT_DEFS)
    .filter((def) => isPlayableDef(def) && def.cost >= 1 && def.cost <= 5)
    .sort((a, b) => a.cost - b.cost || a.id.localeCompare(b.id));
}

export function codexUnitGroups(): CodexUnitGroup[] {
  const all = codexUnits();
  return CODEX_COSTS.map((cost) => {
    const rarity = rarityOfCost(cost);
    return {
      cost,
      label: `${cost} 费`,
      rarityLabel: rarity.label,
      rarityBase: rarity.base,
      units: all.filter((def) => def.cost === cost),
    };
  });
}

// ============================================================
// 二、藏品：按用途分 3 组
// ============================================================

export type CodexItemKind = 'relic' | 'wear' | 'share';

export interface CodexItemGroup {
  kind: CodexItemKind;
  label: string;
  /** 这一组是干嘛的（写在组标题下面那行小字） */
  note: string;
  items: ItemDef[];
}

/**
 * ★ 「羁绊转职」那 19 件在数据里**不是**靠某个 type 字段区分的，
 * 而是靠 `grantsTrait`（见 item-data.ts 的 TRAIT_RELICS）。
 * 所以这里认 id，别去猜 slot/rarity —— 转职藏品也是 A 类、也是进阶，
 * 按 slot 分的话它们会混进「穿戴藏品」里出现两次。
 */
const RELIC_IDS: ReadonlySet<string> = new Set(TRAIT_RELICS.map((relic) => relic.id));

export function isRelicItem(itemId: string): boolean {
  return RELIC_IDS.has(itemId);
}

/**
 * 三组**互斥且穷尽**：19 转职 + 40 穿戴 + 30 共享 = 89 件。
 * （转职那 19 件本身是 A 类，所以「穿戴」要把它们排掉，否则会重复。）
 */
export function codexItemGroups(): CodexItemGroup[] {
  const all = Object.values(ITEM_DEFS).sort((a, b) => a.id.localeCompare(b.id));
  return [
    {
      kind: 'relic',
      label: '羁绊转职',
      note: '装备后给这名干员额外挂上一个羁绊标签',
      items: all.filter((item) => RELIC_IDS.has(item.id)),
    },
    {
      kind: 'wear',
      label: '穿戴藏品',
      note: '穿在单个干员身上（A 类，每人最多 2 件）',
      items: all.filter((item) => item.slot === 'A' && !RELIC_IDS.has(item.id)),
    },
    {
      kind: 'share',
      label: '共享藏品',
      note: '全队共享（B 类）',
      items: all.filter((item) => item.slot === 'B'),
    },
  ];
}

// ============================================================
// 三、组队器：15 个栏位
// ============================================================

export const TEAM_PLAN_SLOTS = 15;

/** 栏位内容：`null` = 空。用固定长度数组，索引就是栏位号。 */
const slots: (string | null)[] = new Array<string | null>(TEAM_PLAN_SLOTS).fill(null);

/** 「提醒购买」开关。只是本局的一个开关，不持久化。 */
let remindBuy = false;

export function teamPlanSlots(): readonly (string | null)[] {
  return slots;
}

export function teamPlanRemindBuy(): boolean {
  return remindBuy;
}

export function setTeamPlanRemindBuy(on: boolean): void {
  remindBuy = on === true;
}

export function teamPlanCount(): number {
  return slots.reduce((n, id) => (id ? n + 1 : n), 0);
}

export function isPlanned(defId: string): boolean {
  return slots.includes(defId);
}

/**
 * 点一下棋子：**已放入就移除，没放就塞进第一个空位**。
 * ★ 同一个干员只占一格（羁绊按「不同干员」计数，放两份没有意义）。
 */
export function toggleTeamPlanUnit(defId: string): void {
  const at = slots.indexOf(defId);
  if (at >= 0) {
    slots[at] = null;
    return;
  }
  const empty = slots.indexOf(null);
  if (empty >= 0) slots[empty] = defId;
}

export function clearTeamPlanSlot(index: number): void {
  if (index >= 0 && index < TEAM_PLAN_SLOTS) slots[index] = null;
}

/** 原地清空（不换数组），免得外面拿着的引用变成旧数组 */
export function clearTeamPlan(): void {
  for (let i = 0; i < TEAM_PLAN_SLOTS; i++) slots[i] = null;
}

/**
 * 新开一局时调用：只清栏位，**开关留着**。
 * 【为什么不清开关？】开关是玩家自己拨的偏好（"我想被提醒"），
 * 和这一局的计划内容无关；栏位清空后角标自然也不显示了。
 */
export function resetTeamPlanForNewGame(): void {
  clearTeamPlan();
}

/** 商店卡要不要打「计划」角标 = 开关打开 **且** 这个干员在计划里 */
export function remindBuyMarkOf(defId: string): boolean {
  return remindBuy && isPlanned(defId);
}

// ============================================================
// 四、这 15 个棋子能激活哪些羁绊
// ============================================================

/**
 * 把栏位拼成 `buildTraitStatus()` 要的 placements。
 * ★ 格子的具体坐标对计数**没有影响**（默认按「不同干员」计，见 countTraits），
 *   但坐标还是要给**互不重复**的格子：以前行号是 `i % 10`，
 *   于是第 11~15 格会和第 1~5 格落在同一格（(0,0) 出现两次）。
 *   现在按 `col = i % 10, row = floor(i / 10)` 排，15 格两两不同，
 *   也不会越出半场（10 列 × 5 行）。
 */
function planPlacements(): UnitPlacement[] {
  const out: UnitPlacement[] = [];
  for (let i = 0; i < TEAM_PLAN_SLOTS; i++) {
    const defId = slots[i];
    if (!defId) continue;
    out.push({ defId, star: 1, cell: { col: i % 10, row: Math.floor(i / 10) } });
  }
  return out;
}

/**
 * 组队器里显示的羁绊行 —— **和左侧羁绊面板同一份数据**。
 * 所以「已生效 / 还差几个 / 领导人上多了」这些文案不用在这里重写一遍。
 */
export function planTraitRows(): TraitStatus[] {
  return buildTraitStatus(planPlacements(), UNIT_DEFS);
}
