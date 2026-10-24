/**
 * ============================================================
 *  单机模式：对手阵容的「成长表」（0.0.2 二次重做）
 * ============================================================
 *
 * 【这次改什么？—— 全是实测反馈】
 * 上一版 1~10 回合的明细是用户逐条给的，跑起来之后暴露出三个问题：
 *   ① 难度增长太快：第 7 回合就有 3 星、第 10 回合力量值已经到 39，
 *      正常运营的玩家 10 回合上下就被暴打；
 *   ② 后半程 `replace` 每 4 回合删一个换一个，换进来的又是**随机挑的新干员**，
 *      玩家看到的是"对面一直在随机换人"；
 *   ③ 站位按星级排序，每次升星全员重排 —— 一回合过去整个队都"搬家"了，
 *      看起来像"全部换人"。
 *
 * 所以这次的三条新原则：
 *   A. **前 10 回合大幅放缓**（力量值 39 → 18），一个回合只做一件事；
 *   B. **不随机换人**：永远不加"replace"操作。人满 8 之后新卡进来
 *      是"换掉全场最弱的那条杂鱼"，而且**新卡必须严格更强**才换 ——
 *      阵容只会变强，不会出现"换了个不认识的"；
 *   C. **站位跟人走**：站位不再按星级重排，谁在哪格就一直在哪格
 *      （阵容数组顺序就是站位顺序，见 enemyPlacementsFor）。
 *
 * ============================================================
 *  ★ 3 星的"解锁回合"和"间隔"（这次的核心需求，测试钉死）
 * ============================================================
 *  1) **费用越高、解锁越晚**：
 *       1 费 13 回合 / 2 费 17 / 3 费 22 / 4 费 25 / 5 费 35
 *     到不了这个回合，**任何途径**（加人 / 升星 / 换人）都造不出这一档的 3 星。
 *     其中 4 费 ≥25、5 费 ≥35 是用户点名的两条硬线。
 *  2) **3 星不能连着出**：
 *       3/4/5 费的 3 星，两次之间至少隔 5 个回合（"不能每 5 回合内连续出现"）；
 *       1/2 费的 3 星是便宜货，放宽到隔 3 个回合（但也要隔，防止连爆）。
 *  3) 解锁回合 + 间隔两道闸一起卡，3/4/5 费 3 星的出现**次数**自然就少了：
 *     40 回合之前最多 4~5 个，而且一个比一个晚 —— "出现次数大幅往后延长"。
 *
 * ============================================================
 *  ★ 0.0.2 追加：对手**不再**与玩家共享牌库
 * ============================================================
 *  上一版人机的牌取自共享牌库（玩家商店里会真的少几张），占用按星级权重算、
 *  升星还要过 `upgradeFitsPool` 那道检查。现在改成：
 *  **单机对手的干员不计入牌库、不影响玩家的牌库**（见 state.ts 的 ownedUnits）。
 *
 *  于是这里也把"牌库放不放得下"的约束整段删掉了 —— 对手只按费用档挑人、
 *  按强度决定升谁，不再受"某种牌全世界只有 N 张"的牵制。
 *  （顺带说明：因为对手的选人本来就"优先挑没重复的干员"，一个人最多占到
 *   9 张 3 星，远小于最低的 10 张档位，所以删掉这道闸对实际阵容没有影响，
 *   只是把"共享牌库"这层概念从对手这一侧彻底摘掉。）
 *
 *  保留的硬约束只剩一条：**人数封顶 8**、星级永远 1~3。
 */

import {
  ARENA_W,
  BOARD_H,
  FIX,
  STAR3_HP_BONUS_BP,
  UNIT_DEFS,
  copiesOf,
  createRng,
  formationCells,
  isMonsterRound,
  monsterWaveForRound,
  playableDefs,
  starMultiplier,
  type Cell,
  type UnitDef,
  type UnitDefTable,
} from '../../../../packages/shared/src/index.js';

/** 对手阵容里的一个棋子 */
export interface EnemyUnit {
  defId: string;
  star: number;
}

/** 对手场上一个棋子的完整信息（含站位） */
export interface EnemyPlacement extends EnemyUnit {
  cell: Cell;
}

/**
 * 一次"造出 3 星"的记录（enemyThreeStarEvents 用，测试靠它验证间隔）。
 * 造出 = 加了 3 星新卡、或把 2 星升成 3 星 —— 换掉/删掉不算。
 */
export interface ThreeStarEvent {
  round: number;
  defId: string;
  cost: number;
}

/**
 * 一个回合要执行的操作。
 *
 * 【为什么做成"操作"而不是直接写死每回合的阵容？】
 * 需求是"在上一回合基础上进化"。拆成操作之后，加/减/改一个回合只动那一行，
 * 前后自动是对的；写死阵容表的话改一处、后面每一行都要跟着改。
 *
 * ★ 0.0.2 二次重做：**没有 'replace' 了**（上一版每 4 回合"删血量最低的
 * 换随机新干员"，玩家观感就是"对面一直在随机换人"）。
 * "换人"现在只发生在一种场景：**人满 8 之后还要加新卡** ——
 * 那时候用新卡换掉全场最弱的那条（新卡必须严格更强），见 enemyLineupForRound。
 */
export type EnemyOp =
  /** 加一个棋子。star 是星级，cost 是费用档 */
  | { kind: 'add'; cost: number; star: number }
  /** 把某个棋子升一星（找不到符合条件的就跳过）。star 缺省表示"任意星级" */
  | { kind: 'upgrade'; cost?: number; star?: number; order: 'random' | 'weakest' | 'strongest' };

/**
 * 前期节奏（1~10 回合），索引 0 对应第 1 回合。
 *
 * 【设计目标】这一段是玩家学习/攒本钱的阶段，对面只需"像个人在慢慢运营"：
 *   · 一个回合只做**一件事**（上一版一回合塞两条操作，涨太快）；
 *   · 4 回合之前不升星（先铺人，再谈强度）；
 *   · 全程只有 1/2 费，3 星要等解锁回合（见 THREE_STAR_UNLOCK_ROUND）。
 *
 * 力量值曲线（费用 × 3^(星级-1)，实测）：1→2→3→5→6→8→10→12→14→18，
 * 对比上一版同期的 1→3→5→7→11→14→24→30→31→39，前期压力砍了一半多。
 */
export const ENEMY_SCHEDULE: readonly (readonly EnemyOp[])[] = [
  /*  1 */ [{ kind: 'add', cost: 1, star: 1 }],
  /*  2 */ [{ kind: 'add', cost: 1, star: 1 }],
  /*  3 */ [{ kind: 'add', cost: 1, star: 1 }],
  /*  4 */ [{ kind: 'upgrade', cost: 1, star: 1, order: 'random' }],
  /*  5 */ [{ kind: 'add', cost: 1, star: 1 }],
  /*  6 */ [{ kind: 'upgrade', cost: 1, star: 1, order: 'random' }],
  /*  7 */ [{ kind: 'add', cost: 2, star: 1 }],
  /*  8 */ [{ kind: 'upgrade', order: 'weakest' }],
  /*  9 */ [{ kind: 'add', cost: 2, star: 1 }],
  /* 10 */ [{ kind: 'upgrade', cost: 2, star: 1, order: 'random' }],
];

/** 人数上限（玩家满级人口 10 左右，对面 8 个，剩下靠星级补强度） */
export const ENEMY_MAX_COUNT = 8;

/**
 * ★ 3 星解锁回合（按费用档）。
 *
 * 不到这个回合，加人 / 升星 / 换人**任何一条路**都造不出这一档的 3 星 ——
 * 闸门做在 enemyLineupForRound 的重放循环里，而不是只写在时刻表里，
 * 这样以后有人往时刻表里随手加一条"升 3 星"也不会冲破这条线。
 * 4 费 25 / 5 费 35 是用户点名的两条硬线；3 费从上一版的 17~19 挪到 22。
 */
export const THREE_STAR_UNLOCK_ROUND: Readonly<Record<number, number>> = {
  1: 13,
  2: 17,
  3: 22,
  4: 25,
  5: 35,
};

/**
 * ★ 两次 3 星之间的最少间隔（回合数）。
 * 3/4/5 费的 3 星是"大哥"，连续出现就是碾压（用户原话：
 * "不能每 5 回合内连续出现三星3.4.5费"）；1/2 费的便宜些，但也要隔 3 回合。
 */
export const PREMIUM_3STAR_MIN_GAP = 5;
export const CHEAP_3STAR_MIN_GAP = 3;

/** 人机加新卡时用的费用档：跟着回合走，一档一档放开（和真人的运营节奏一致） */
function addCostTier(round: number): number {
  if (round >= 35) return 5;
  if (round >= 25) return 4;
  if (round >= 18) return 3;
  if (round >= 14) return 2;
  return 1;
}

/**
 * 第 11 回合起的延续节奏：**每 4 回合一个小循环**。
 *
 *   循环位置 0：升星（升最弱的 —— 把 1 星杂鱼往上抬）
 *   循环位置 1：加人（当前费用档的 1 星新卡；人满了就是"换掉最弱的"）
 *   循环位置 2：升星（还是升最弱的）
 *   循环位置 3：升星（升最强的 —— 大哥的 2 星 → 3 星走的就是这里，
 *                     被"解锁回合/间隔"两道闸卡着，不会连爆）
 *
 * 一回合只有**一条**操作（上一版 tailOps 一回合也可能塞两条）。
 * 力量增长是平滑的：每循环 ≈ 加 1 人 + 升 2 星，
 * 真正的"跳变"只发生在 3 星解锁的那几个回合，而那被间隔闸拉开了。
 */
function tailOps(round: number): readonly EnemyOp[] {
  switch ((round - 11) % 4) {
    case 0:
      return [{ kind: 'upgrade', order: 'weakest' }];
    case 1:
      return [{ kind: 'add', cost: addCostTier(round), star: 1 }];
    case 2:
      return [{ kind: 'upgrade', order: 'weakest' }];
    default:
      return [{ kind: 'upgrade', order: 'strongest' }];
  }
}

/** 第 round 回合要执行的操作 */
export function enemyOpsForRound(round: number): readonly EnemyOp[] {
  const r = Math.max(1, Math.floor(round));
  if (r <= ENEMY_SCHEDULE.length) return ENEMY_SCHEDULE[r - 1] ?? [];
  return tailOps(r);
}

/**
 * 把「这一局的种子」和「回合数」混成波次种子。
 * 不混的话 (seed=5,round=10) 和 (seed=10,round=5) 会撞成同一个种子。
 */
function mixSeed(gameSeed: number, round: number): number {
  const base = round * 7919 + 13;
  if (!gameSeed) return base >>> 0;
  let h = (base ^ Math.imul(gameSeed >>> 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * 阵容里每个干员"相当于几张牌"（2 星 = 3 张、3 星 = 9 张）。
 *
 * 现在不再和玩家牌库挂钩（对手的干员不计入牌库），这里的换算只用来
 * **判断阵容里有没有重复干员** —— 真人不可能同时握着 3 个同名棋子，
 * 所以挑新卡时优先避开已经在阵容里的干员（见 pickDefId）。
 */
export function copiesHeldBy(units: ReadonlyArray<EnemyUnit>): Map<string, number> {
  const held = new Map<string, number>();
  for (const unit of units) {
    held.set(unit.defId, (held.get(unit.defId) ?? 0) + copiesOf(unit.star));
  }
  return held;
}

/**
 * 算一个棋子的血量（只用来判断"谁最弱"，不需要特工/羁绊那些加成）。
 * 和 rules.ts 的 createUnit 同一套公式，那边改了星级算法这里自动跟着对。
 */
export function enemyUnitHp(def: UnitDef, star: number): number {
  const hpBp = starMultiplier(star, def.starHpBp);
  const star3HpBp = star >= 3 ? (STAR3_HP_BONUS_BP[def.cost] ?? 10000) : 10000;
  return Math.floor((def.base.hp * FIX * Math.floor((hpBp * star3HpBp) / 10000)) / 1000);
}

/** 强度值：和牌库同一套换算（费用 × 3^(星级-1)），用来做单调性测试 */
export function enemyPower(units: ReadonlyArray<EnemyUnit>, defs: UnitDefTable = UNIT_DEFS): number {
  return units.reduce((sum, unit) => sum + (defs[unit.defId]?.cost ?? 1) * copiesOf(unit.star), 0);
}

/** 一个棋子的力量值：费用 × 3^(星级-1) */
function powerOfUnit(unit: EnemyUnit, defs: UnitDefTable): number {
  return (defs[unit.defId]?.cost ?? 1) * copiesOf(unit.star);
}

/**
 * 挑一个能用的干员 id。
 *
 * ★ 0.0.2 追加：**不再看牌库**（对手的干员不计入牌库，见文件头）。
 * 过滤只剩两条：① 费用必须是指定档；② 尽量和现有阵容同羁绊、成体系。
 * 挑不到返回 null（这一步跳过，不硬塞）。
 */
function pickDefId(
  lineup: ReadonlyArray<EnemyUnit>,
  cost: number,
  rng: { nextInt(max: number): number },
  defs: UnitDefTable,
): string | null {
  const held = copiesHeldBy(lineup);

  /** 这一档的全部干员（按 id 排序保证确定性） */
  const defsOfTier = (tier: number): string[] =>
    playableDefs(defs)
      .filter((def) => def.cost === tier)
      .map((def) => def.id)
      .sort();

  // 费用档：先试目标档，不够再往下降（宁可弱一点，也不要空着）
  let pool: string[] = [];
  for (let tier = cost; tier >= 1 && pool.length === 0; tier--) pool = defsOfTier(tier);
  if (pool.length === 0) {
    for (let tier = cost + 1; tier <= 5 && pool.length === 0; tier++) pool = defsOfTier(tier);
  }
  if (pool.length === 0) return null;

  /*
    ★ 先挑"阵容里还没有的干员"。
    真人不可能同时握着 3 个同名棋子（第 3 个一进来就合成了），
    不排除的话后期会出现玩家永远摆不出的"同名三连"阵容。
  */
  const unused = pool.filter((defId) => !held.has(defId));
  if (unused.length > 0) pool = unused;

  // 羁绊偏好：优先挑和现有阵容同羁绊的（锦上添花，挑不出就退回整个池子）
  if (lineup.length > 0) {
    const seen = new Map<string, number>();
    for (const unit of lineup) {
      for (const trait of defs[unit.defId]?.traits ?? []) {
        seen.set(trait, (seen.get(trait) ?? 0) + 1);
      }
    }
    const topTraits = [...seen.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    for (const [trait] of topTraits) {
      const themed = pool.filter((defId) => defs[defId]!.traits.includes(trait));
      if (themed.length > 0) {
        pool = themed;
        break;
      }
    }
  }

  return pool[rng.nextInt(pool.length)] ?? null;
}

/**
 * 找出"最差的那个座位"的下标（供人满时的换人用）。
 *
 * 【怎么算"最差"？】星级最低优先，同星比费用低，再按下标 ——
 * 也就是"最弱、最便宜的那条杂鱼"。**不按血量**：换人换的是"座位"，
 * 不是"谁的血少"，按血量挑会随机命中不同定位的干员，观感就是随机换人。
 *
 * 【什么座位可以被换掉？】两种之一：
 *   · **变强**：新卡力量值更高（powerOfUnit）—— 纯粹的升级，力量值不降；
 *   · **投资**：新卡费用档更高 —— 像真人"卖掉老杂鱼、买张五费大哥"，
 *     力量值可能小跌（1 星 5 费 < 3 星 1 费），但后面几个回合连升两级就涨回来。
 *     没有这条，后期（全员 2 星+）高费新卡永远进不了场，难度曲线会躺平 ——
 *     实测上一版 35 回合后力量值永远停在 126，3 星 5 费一次都不出现。
 *
 * 挑选永远从"最差座位"开始，所以 3 星老队员只有在更便宜的座位都被
 * 换完之后才会轮到 —— 单回合的力量值回落被天然限制在很小一档。
 */
function seatToReplace(
  lineup: ReadonlyArray<EnemyUnit>,
  incoming: EnemyUnit,
  defs: UnitDefTable,
): number {
  const incomingPower = powerOfUnit(incoming, defs);
  const incomingCost = defs[incoming.defId]?.cost ?? 1;

  let best = -1;
  let bestKey: [number, number, number] | null = null;
  lineup.forEach((unit, index) => {
    const def = defs[unit.defId];
    if (!def) return;
    const isUpgrade = incomingPower > powerOfUnit(unit, defs);
    const isInvestment = def.cost < incomingCost;
    if (!isUpgrade && !isInvestment) return;
    const key: [number, number, number] = [unit.star, def.cost, index];
    if (bestKey === null || key[0] < bestKey[0] ||
        (key[0] === bestKey[0] && key[1] < bestKey[1]) ||
        (key[0] === bestKey[0] && key[1] === bestKey[1] && key[2] < bestKey[2])) {
      best = index;
      bestKey = key;
    }
  });
  return best;
}

/**
 * 3 星的两道闸：解锁回合 + 间隔。
 *
 * 【为什么闸门做成"谓词"传进 findUpgradeTarget？】
 * 因为 3 星可能从好几条路冒出来：加人（star:3）、升星（2→3）、
 * 人满换人（新卡是 3 星）。闸门必须拦在**每一条路**上，
 * 拦在时刻表里只管得住时刻表自己。
 */
interface ThreeStarPacing {
  /** 上一个 3/4/5 费 3 星出现在第几回合（-999 = 还没有） */
  lastPremiumRound: number;
  /** 上一个 1/2 费 3 星出现在第几回合 */
  lastCheapRound: number;
}

function threeStarAllowed(cost: number, round: number, pacing: ThreeStarPacing): boolean {
  const unlock = THREE_STAR_UNLOCK_ROUND[cost] ?? Number.POSITIVE_INFINITY;
  if (round < unlock) return false;
  if (cost >= 3) return round - pacing.lastPremiumRound >= PREMIUM_3STAR_MIN_GAP;
  return round - pacing.lastCheapRound >= CHEAP_3STAR_MIN_GAP;
}

/** 一个 3 星真的造出来了：登记回合，把间隔闸往后推 */
function recordThreeStar(cost: number, round: number, pacing: ThreeStarPacing): void {
  if (cost >= 3) {
    // 大哥落地也算一次"事件"：把便宜档的闸一并推走，整队节奏同步放缓
    pacing.lastPremiumRound = round;
    pacing.lastCheapRound = round;
  } else {
    pacing.lastCheapRound = round;
  }
}

/**
 * 在阵容里找一个符合条件的棋子下标（供 upgrade 用）。
 *
 * @param gate 3 星闸门：2 星升 3 星之前先问一句"这个费用档现在允许出 3 星吗"。
 *   不允许的候选直接剔除 —— 这一回合的"升最强"就轮不到它，
 *   而是落到次强的那只身上（不会白过一回合）。
 */
function findUpgradeTarget(
  lineup: ReadonlyArray<EnemyUnit>,
  op: Extract<EnemyOp, { kind: 'upgrade' }>,
  defs: UnitDefTable,
  rng: { nextInt(max: number): number },
  gate: (cost: number) => boolean = () => true,
): number {
  const candidates: number[] = [];
  lineup.forEach((unit, index) => {
    if (unit.star >= 3) return; // 已经满星
    const def = defs[unit.defId];
    if (!def) return;
    if (op.cost !== undefined && def.cost !== op.cost) return;
    if (op.star !== undefined && unit.star !== op.star) return;
    // ★ 2 星升 3 星必须过两道闸（解锁回合 + 间隔）
    if (unit.star === 2 && !gate(def.cost)) return;
    candidates.push(index);
  });
  if (candidates.length === 0) return -1;

  if (op.order === 'random') return candidates[rng.nextInt(candidates.length)]!;

  // weakest / strongest：先比星级，再比费用
  const sorted = [...candidates].sort((a, b) => {
    const ua = lineup[a]!;
    const ub = lineup[b]!;
    const ca = defs[ua.defId]?.cost ?? 1;
    const cb = defs[ub.defId]?.cost ?? 1;
    const starDiff = op.order === 'weakest' ? ua.star - ub.star : ub.star - ua.star;
    if (starDiff !== 0) return starDiff;
    const costDiff = op.order === 'weakest' ? ca - cb : cb - ca;
    if (costDiff !== 0) return costDiff;
    return a - b; // 稳定的兜底，保证确定性
  });
  return sorted[0]!;
}

/**
 * 把一个棋子升一星（所有"升星"路径都必须走这里 —— 升星会造出 3 星，
 * 造出 3 星就必须过闸 + 记账，走散了间隔闸就会失效）。
 *
 * ★ 这里曾经踩过坑：人满时"加人"退化成"升最弱"的那条支路自己写了一遍
 * 升星逻辑，忘了登记 3 星 —— 结果 3 星连着两回合出（第 24、25 回合），
 * 间隔闸形同虚设。抽成一个函数之后，想漏都漏不了。
 */
function applyUpgradeAt(
  lineup: EnemyUnit[],
  index: number,
  round: number,
  defs: UnitDefTable,
  pacing: ThreeStarPacing,
  collect?: (event: ThreeStarEvent) => void,
): void {
  const unit = lineup[index];
  if (!unit) return;
  lineup[index] = { ...unit, star: unit.star + 1 };
  if (unit.star === 2) {
    const cost = defs[unit.defId]?.cost ?? 1;
    recordThreeStar(cost, round, pacing);
    collect?.({ round, defId: unit.defId, cost });
  }
}

/**
 * 生成第 round 回合的对手阵容。
 *
 * 【实现方式：从第 1 回合开始一路重放】每回合的操作最多两条，
 * 直接重放最简单，而且**天然保证"第 N 回合的阵容是第 N-1 回合长出来的"**。
 *
 * 【阵容数组的顺序 = 棋子的"身份"】add 永远 push 到末尾、升星原地下标不变、
 * 人满换人 splice 原位替换 —— 所以同一个下标永远是同一个"座位"，
 * 站位按数组顺序排（enemyPlacementsFor），上一回合的人这一回合还在原地。
 *
 * @param gameSeed 这一局的种子。同一局内可复现，换一局不一样。
 * @param collect 可选：把每次"造出 3 星"记进去（测试用它验证解锁/间隔）。
 */
export function enemyLineupForRound(
  round: number,
  gameSeed = 0,
  defs: UnitDefTable = UNIT_DEFS,
  collect?: (event: ThreeStarEvent) => void,
): EnemyUnit[] {
  const target = Math.max(1, Math.floor(round));
  const lineup: EnemyUnit[] = [];
  const pacing: ThreeStarPacing = { lastPremiumRound: -999, lastCheapRound: -999 };

  for (let r = 1; r <= target; r++) {
    const rng = createRng(mixSeed(gameSeed, r));
    /** 本回合的 3 星闸（闭包：升级走 findUpgradeTarget 的过滤） */
    const gate = (cost: number): boolean => threeStarAllowed(cost, r, pacing);

    for (const op of enemyOpsForRound(r)) {
      switch (op.kind) {
        case 'add': {
          const defId = pickDefId(lineup, op.cost, rng, defs);
          if (!defId) break;
          const cost = defs[defId]?.cost ?? 1;
          // ★ 加 3 星新卡也要过两道闸；不过就降成 2 星进场（不白这一回合）
          const star = op.star === 3 && !gate(cost) ? 2 : op.star;
          const incoming: EnemyUnit = { defId, star };

          if (lineup.length < ENEMY_MAX_COUNT) {
            lineup.push(incoming);
          } else {
            /*
              人满了：换掉"最差的座位"（原位替换，座位不动，见 seatToReplace）。
              ★ 只有两种情况才换：新卡纯更强，或新卡费用档更高（投资）——
              所以不存在"随机换人"，换人永远等于"这一格变强了或换成更大的卡"。
              两种都不满足（新卡既不比谁强、费用也不升）时退化成"升最弱"，
              这一步不白过。
            */
            const index = seatToReplace(lineup, incoming, defs);
            if (index >= 0) {
              lineup.splice(index, 1, incoming);
            } else {
              const upgradeIndex = findUpgradeTarget(lineup, { kind: 'upgrade', order: 'weakest' }, defs, rng, gate);
              if (upgradeIndex >= 0) {
                applyUpgradeAt(lineup, upgradeIndex, r, defs, pacing, collect);
              }
            }
          }

          if (star === 3) {
            recordThreeStar(cost, r, pacing);
            collect?.({ round: r, defId, cost });
          }
          break;
        }

        case 'upgrade': {
          const index = findUpgradeTarget(lineup, op, defs, rng, gate);
          if (index >= 0) applyUpgradeAt(lineup, index, r, defs, pacing, collect);
          break;
        }
      }
    }
  }

  if (lineup.length === 0) {
    // 兜底：只有干员表为空才会走到这里（正常不可能）
    const fallback = playableDefs(defs)[0];
    if (fallback) lineup.push({ defId: fallback.id, star: 1 });
  }
  return lineup;
}

/**
 * 一路重放到第 round 回合，把**每次造出 3 星**的回合和费用报出来。
 * 测试靠它验证"4 费 3 星 ≥25 回合、5 费 ≥35、大哥间隔 ≥5 回合"。
 */
export function enemyThreeStarEvents(
  round: number,
  gameSeed = 0,
  defs: UnitDefTable = UNIT_DEFS,
): ThreeStarEvent[] {
  const events: ThreeStarEvent[] = [];
  enemyLineupForRound(round, gameSeed, defs, (event) => events.push(event));
  return events;
}

/**
 * 给阵容排站位。
 *
 * ★ 0.0.2 二次重做：**按阵容数组顺序排，不再按星级重排**。
 * 上一版每次升星都全员"搬家"，玩家看到的是"一回合过去整个队都换位了"，
 * 像是换了一批人。现在数组顺序 = 座位顺序：
 *   · 新来的人永远排到最后面的空位；
 *   · 升星的人原地不动；
 *   · 人满换人是原位替换，座位也不动。
 * 于是"上一回合的敌人这一回合还在原来的格子上"，
 * 配合 prep 阶段按 index 发的负数 uid，精灵也只会被识别成 restyled，
 * 不会删掉重建（模型不闪、不丢）。
 *
 * （早期加进来的人坐前面 —— 他们也确实是被升星最久的"老队员"，
 *  和真人"老队员打头阵"的直觉一致，不需要额外的排序规则。）
 */
export function enemyPlacementsFor(
  lineup: ReadonlyArray<EnemyUnit>,
  defs: UnitDefTable = UNIT_DEFS,
): EnemyPlacement[] {
  /*
    ★ 0.0.3：站位换成"按射程排"（你提的："射程近的放前面、远的放后面，
    而且不要一直贴竞技场上方，往中间一些"）。
    规则本体住在 shared 的 field.ts 里（formationCells），
    野怪波次用的是**同一个函数** —— 免得两边手感不一致。
    输出顺序仍然跟着 lineup 走，所以布阵阶段按 index 发的负数 uid 不受影响。
  */
  const ranges = lineup.map((unit) => defs[unit.defId]?.base.range ?? 1);
  const cells = formationCells(1, ranges);
  return lineup.map((unit, i) => ({ defId: unit.defId, star: unit.star, cell: cells[i]! }));
}

/** 一步到位：第 round 回合的对手站位（布阵展示和开战用的是同一份） */
export function enemyPlacementsForRound(
  round: number,
  gameSeed = 0,
  defs: UnitDefTable = UNIT_DEFS,
): EnemyPlacement[] {
  return enemyPlacementsFor(enemyLineupForRound(round, gameSeed, defs), defs);
}

/**
 * ★ 0.0.3：**对手站位**的唯一入口 —— 野怪回合出野怪，其他回合出人机。
 *
 * 【为什么要有这一层？】
 * 布阵阶段的"对手预览"和开战时真正打的对手，必须是**同一个函数**算出来的。
 * 野怪回合接进来之后，如果只在开战那条路上加 isMonsterRound，
 * 就会出现"布阵时看到的是人机阵容、开打变成野怪"这种最坑的显示错误。
 * 所以把它收在这里，两边都调它。
 */
export function opponentPlacementsForRound(
  round: number,
  gameSeed = 0,
  defs: UnitDefTable = UNIT_DEFS,
): EnemyPlacement[] {
  if (isMonsterRound(round)) return monsterWaveForRound(round);
  return enemyPlacementsForRound(round, gameSeed, defs);
}

/** 一行人话描述，显示在顶部状态栏里 */
export function enemyLineupText(
  lineup: ReadonlyArray<EnemyUnit>,
  defs: UnitDefTable = UNIT_DEFS,
): string {
  const byStar = new Map<number, number>();
  for (const unit of lineup) byStar.set(unit.star, (byStar.get(unit.star) ?? 0) + 1);
  const parts: string[] = [];
  for (const star of [1, 2, 3]) {
    const count = byStar.get(star) ?? 0;
    if (count > 0) parts.push(`${count} 个 ${star} 星`);
  }
  const maxCost = lineup.reduce((max, unit) => Math.max(max, defs[unit.defId]?.cost ?? 1), 1);
  return `${parts.join(' + ')}（最高 ${maxCost} 费）`;
}
