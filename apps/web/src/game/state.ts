import {
  ARENA_H,
  ARENA_W,
  BOARD_H,
  BOARD_W,
  BENCH_SLOTS,
  BUY_XP_COST,
  FIX,
  ITEM_A_SLOTS,
  ITEM_B_EQUIP_SLOTS,
  ITEM_B_SLOTS,
  ITEM_DEFS,
  ITEM_PER_UNIT,
  // ★ 0.1.1 藏品二版：「共享藏品效果」栏要显示的效果全文（文案只在 item-text.ts 里）
  itemEffectLines,
  // ★ 0.1.1：彩蛋角色永久屏蔽「升星 / 复制 / 变身」类藏品（判据按效果类别，见其说明）
  isUnitTransformingItem,
  REFRESH_COST,
  SHOP_ODDS_BY_LEVEL,
  START_GOLD,
  // ★ 0.3 房间设置：每回合基础收入的默认值（房主可以改，见 GameRules）
  INCOME_BASE,
  // ★★ 0.3 盟约：折算成羁绊加成（**必须和服务端调同一个函数**，否则校验和炸）
  covenantTraitBonuses,
  covenantInterestCap,
  covenantRoundGold,
  // ★★ 0.3.2 阿米娅升变：家族 key —— 形态和基础阿米娅共用一份牌库、升星互通
  AMIYA_BASE_ID,
  ascendRankOf,
  familyKeyOf,
  // ★★ 0.3.2 升变任务：阈值 / 判定 / 进度文案（唯一实现在 shared/amiya-quest.ts）
  AMIYA_COVENANT_ID,
  // ★ 0.3.2 升变之证专用栏位的固定顺序（0 青色 / 1 慈悲 / 2 终曲）
  AMIYA_CERT_ORDER,
  AMIYA_CERT_SLOTS,
  amiyaDamageFromLog,
  amiyaQuestStage1Done,
  amiyaQuestStage2Done,
  createAmiyaQuestProgress,
  type AmiyaQuestProgress,
  // ★ 0.3.1 新盟约：升级送藏品（凯瑟琳）/ 坎诺特商店优惠
  covenantLevelItem,
  covenantShopPerks,
  MAX_LEVEL,
  TEAM_0_MAX_COL,
  TEAM_1_MIN_COL,
  TEST_MODE_GOLD,
  TRAIT_DEFS,
  UNIT_DEFS,
  // ★ 0.2 fever 宝藏要点名"普通 / 进阶 / 转职"三类藏品
  ADVANCED_ITEMS,
  NORMAL_ITEMS,
  TRAIT_RELICS,
  buildTraitStatus,
  buyShopSlot,
  buyXp,
  computeTraitBonuses,
  computeUnitTraitBonuses,
  computeActiveTraitLevels,
  createFeverState,
  feverSkillOf,
  nextFeverPrompt,
  // ★ 0.2 fever 宝藏掉落表（共享 5 处：数据表 / 掷骰 / 文案）
  rollFeverDrop,
  describeFeverDrop,
  feverDropWeightSum,
  type FeverDropEntry,
  resolveUnitMechanics,
  computeTraitGold,
  survivorsOfTeam,
  copiesOf,
  collectMods,
  createBattle,
  effectiveArmor,
  effectiveAttackDamage,
  effectiveAttackSpeed,
  effectiveMagicResist,
  effectiveRange,
  createEconomy,
  damageForRound,
  levelSummary,
  mergeBench,
  playableDefs,
  // ★ 0.3 盟约：特殊刷新 / 送牌要按费用档找"还有货"的棋子
  unitIdsByCost,
  // ★ 0.1.1：效果栏里召唤物要写中文名（「开局召唤 炎佑×1：生命 1300」）
  SUMMON_DEFS,
  // ★ 0.0.3 野怪回合
  isMonsterRound,
  monsterTeamSetup,
  monsterWaveForRound,
  monsterWaveText,
  // ★ 0.0.3 野怪掉落（shared 的那套 RNG 带 nextInt，和本文件里的局部 createRng 不是一回事）
  createRng as createDropRng,
  killedDefIds,
  rollDrops,
  type BattleEvent,
  type BattleState,
  type DropTier,
  poolSizeOf,
  poolCopiesOf,
  // ★ 0.1.1：藏品「随机招募」的抽取规则（单机本地 / 服务端共用同一份）
  pickRecruit,
  // ★ 0.1.1：藏品效果栏 / 详情页显示「实时数值」（按当前层数/金币/血量换算，不显示内部字段）
  itemLiveLines,
  type ItemLiveContext,
  // ★ copiesOf 已经在上面导入过了（商店角标的按张折算用它）
  freeFlagFor,
  populationCap,
  refreshShop,
  morphCandidatesOf,
  RELIC_ITEM_OF_TRAIT,
  remainingPool,
  rollShop,
  sellBenchUnit,
  settleRound,
  MAX_INTEREST,
  // ★ 0.3.31：玩家血量上限（夹藏品回血用）
  START_HP,
  playerMaxHp,
  toggleShopLock,
  grantXp,
  type BenchUnit,
  // ★ 0.1.1：备战席上报给服务器时的形状（观战展示 + 淘汰回库都要用）
  type BenchUnitView,
  type Cell,
  type EconomyState,
  type FeverState,
  type ItemDef,
  type SubmittedTeam,
  type TeamSetup,
  type TraitMechanic,
  type TraitStatus,
  type UnitDef,
  type UnitDefTable,
  type UnitPlacement,
  type UnitStatOverride,
} from '../../../../packages/shared/src/index.js';
import {
  OPERATOR_SLOT_COPIES,
  OPERATOR_SLOT_STAR,
  SHOP_BUY_PRICE,
  SHOP_ROUND_SECONDS,
  isShopRoundAfter,
  rerollPriceOf,
  rollShopRoundSlots,
  LOST_KEY_ITEM_ID,
  FIRST_SHOP_ROUND,
  sellPriceOfItem,
  type ShopRoundSlot,
  type ShopRoundState,
} from './shop-round.js';
import {
  enemyLineupForRound,
  enemyLineupText,
  enemyPlacementsForRound,
  opponentPlacementsForRound,
} from './enemy-lineup.js';
import {
  bumpGrowth,
  collectItems,
  countUnequipped,
  createItemInventory,
  equippedItemIds,
  freeSlotIndex,
  growthOf,
  isConsumedOnEquip,
  itemPopCapBonus,
  itemRequirementError,
  itemRoundGold,
  // ★ 0.2：逐副本层数的读写（层数改成跟着"这一件藏品"走，见 ItemInventory.growth）
  layerAt,
  normalizeLayers,
  pickTransformTarget,
  pushItemsIntoZone,
  resetGrowth,
  sharedItemIds,
  // ★ 0.2：共享装备位里每件的层数（和 sharedItemIds 同下标）
  sharedItemLayerList,
  // ★ 0.1.1 藏品二版：剑锤那种"购买干员 +2 花费"（见 shopPriceDelta 的说明）
  shopCostDelta,
  splitByZone,
  storageZoneOf,
  zoneLabel,
  zoneList,
  zoneSize,
  type ItemInventory,
  type ItemSlotRef,
  type ItemZone,
} from './items.js';

/**
 * ============================================================
 *  客户端游戏状态（备战阶段）
 * ============================================================
 *
 * 【职责划分】
 *   经济与商店（金币、等级、经验、商店格子、备战席）-> 交给 shared 的 economy.ts
 *   棋盘摆放与阶段流转                          -> 这个文件
 *
 * 这样拆的好处：经济规则是纯逻辑，以后要搬到服务端做权威校验时
 * 可以整块搬走，客户端只需要把「服务器返回的结果」套用上去。
 *
 * 【阶段流转】
 *   prep（备战）  买棋子、升级、摆位
 *   battle（战斗）播放战斗
 *   result（结算）看结果、继续下一回合
 */

export const PLAYBACK_SPEEDS = [0.5, 1, 2, 4] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

/** 场上的一个棋子（已经从备战席放下去了） */
export interface Placement {
  /** 唯一编号，和备战席共用一套编号 */
  uid: number;
  defId: string;
  star: number;
  cell: Cell;
  /**
   * ★ 0.0.3：这枚棋子占牌库几张（不写 = 按星级算）。
   * true = 一张都不占；数字 = 只占这么多张（博士投影升星后是 1）。
   * 换算的唯一入口是 shared 的 `poolCopiesOf()`，别在这里手写判断。
   */
  free?: boolean | number;
  /**
   * ★ 0.0.3：身上装备的 A 类藏品（最多 `ITEM_PER_UNIT` 件）。
   *
   * 装备挂在棋子上而不是单独一张表 —— 理由见 shared/economy.ts 的 BenchUnit.items。
   * 唯一要小心的是：**每一条搬运棋子的路径都要带上它**
   * （备战席<->场上、互换、合成、清空），所以本文件里每个 push 都显式写了这一行。
   */
  items?: string[];
  /**
   * ★ 0.2：身上**每一件**藏品的成长层数，和 `items` 同下标。
   *
   * 层数是**逐副本**记的（见 game/items.ts 的 ItemInventory.growth 说明）：
   * 两个干员各装一件同名叠层藏品时，各叠各的 —— 以前按 id 记会共享同一份。
   * ★ 它和 `items` 是一对，搬运棋子时必须一起搬（见 carryUnitItems）。
   */
  itemLayers?: number[];
}

/**
 * ★★ 0.3 盟约的运行期状态。
 *
 * 只放"会变的东西"。每个盟约用自己那几行，用不到的就一直是初值 ——
 * 这样加新盟约不用改结构，也不会互相干扰。
 */
export interface CovenantRuntime {
  /** 猎头顾问（梓兰）：这一轮「特殊刷新」充能好了吗（每 2 回合充一次，用掉清空） */
  headhunt: boolean;
  /** 博学多通（佩佩）：还剩几次「高费刷新」 */
  highTier: number;
  /** 博学多通：已经发过奖励的等级（9 / 10，防重复发） */
  highTierLevels: number[];
  /** 通关奖励（绮良）：距离下一次送牌还差多少花费（累计到 50 就发一张） */
  spent: number;
  /** 变形同构（变形者集群）：第 4 回合那件装备发过了吗 */
  morphGiven: boolean;
  /** ★ 0.3.1 定向投放（凯瑟琳）：已经发过藏品的等级（防重复发） */
  kathrynLevels: number[];
  /** ★ 0.3.1 特别优惠（坎诺特）：本局第一次商店还剩几次免费刷新 */
  cannotFreeRerolls: number;
  /** ★ 0.3.1 特别优惠（坎诺特）：本商店回合的首件藏品折扣还有没有（1/0） */
  cannotDiscountLeft: number;
  /**
   * ★★ 0.3.1「特殊刷新」这一批里被**盟约占掉重写**的格子下标（正常刷新是空的）。
   *
   * 为什么记在这、而不是给 `ShopSlot` 加字段？
   *   货架格子是 `economy.shop` 里的共享结构（`shared/economy.ts`），
   *   加一个"纯界面用来上色"的字段要过协议/服务端白名单 —— 不值得。
   *   只活在客户端一个回合里，下一次刷新就清空。
   */
  specialSlots: number[];
  /**
   * ★★ 0.3.2 阿米娅 · 不容拒绝：**升变任务**的进度。
   *
   * 为什么放这里而不是单独一个 `state.amiyaQuest`？
   * 因为它就是"某一盟约攒到哪一步了"，和上面那几项是同一类东西；
   * 单独开一个字段会让 `GameState` 越长越碎。
   */
  amiyaQuest: AmiyaQuestProgress;
  /**
   * ★★ 0.3.2 阿米娅 · 不容拒绝：**开局那只 1 星阿米娅已经发过了吗**。
   *
   * 幂等用（重连时 `GameState` 会重建，光靠这个标记不够 ——
   * 所以 `applyCovenantOpening` 还会再看"手上有没有阿米娅"）。
   */
  amiyaGift: boolean;
}

/** 新的（空）盟约运行期状态 */
export function createCovenantRuntime(): CovenantRuntime {
  return {
    headhunt: false,
    highTier: 0,
    highTierLevels: [],
    spent: 0,
    morphGiven: false,
    kathrynLevels: [],
    cannotFreeRerolls: 0,
    cannotDiscountLeft: 0,
    specialSlots: [],
    amiyaQuest: createAmiyaQuestProgress(),
    amiyaGift: false,
  };
}

export interface GameState {
  /**
   * ★ 0.2：多了个 `'shop'` —— **商店回合**（野怪回合打完之后插入的 90 秒商店）。
   * 它不是一个"回合"，只是回合之间的插曲，所以 `round` 不会因为它变。
   */
  phase: 'prep' | 'battle' | 'result' | 'shop';
  /**
   * ★ 0.2 商店回合的状态；`null` = 当前不在商店回合。
   * 形状 / 价格 / 货架生成都在 `game/shop-round.ts`，这里只放"这一刻的实例"。
   */
  shopRound: ShopRoundState | null;
  /**
   * ★ 0.2（用户 2026-10-17）：本局**进过几次**商店回合（0 = 还没进过）。
   *
   * 失落之钥「只能出现在本局的第一次商店」就靠它判 ——
   * 不能用回合号推（`isShopRoundAfter(9)` 在"从第 N 回合起步"的测试局/联机局里不成立）。
   */
  shopRoundCount: number;
  /**
   * ★★ 0.2.1（用户 2026-10-17 报的严重 bug）：**我这一局已经被淘汰了**。
   *
   * ============================================================
   *  【为什么它必须住在 state 里，而不是像以前那样放在 main.ts 的模块变量？】
   * ============================================================
   * 以前 `main.ts` 有一个 `let eliminatedMe`，只在"隐藏商店按钮"那一处用；
   * 而 0.2 新增的**商店回合**（坎诺特那个弹窗）是另一套界面 ——
   * 它不知道 `eliminatedMe`，于是淘汰的人照样能开商店、买 2 星干员、卖藏品。
   * 灾难在于：淘汰时服务器已经把他的手牌**全部还回共享牌库**了，
   * 他再买 = 同一张牌被卖给第二个人 ⇒ 牌库的账当场错乱。
   *
   * 所以现在把它放进 `GameState`，并让**所有**商店入口（常规 5 格 / 刷新 /
   * 锁定 / 买经验 / 商店回合的买·卖·刷新·切页）都走同一个判据
   * `shopBlockedByElimination()`。淘汰 = 商店整块关闭，只剩观战。
   */
  meEliminated: boolean;
  /** 经济与商店（金币 / 等级 / 经验 / 生命 / 商店 5 格 / 备战席） */
  economy: EconomyState;
  /**
   * ★ 0.3：这一局的经济规则（开局金币 / 每回合基础收入）。
   * 联机时来自服务端下发的房间设置，单机是 `DEFAULT_GAME_RULES`。
   */
  rules: GameRules;
  /**
   * ★★ 0.3：**还没告诉服务端的回血量**（消耗型藏品给的）。
   *
   * 联机血量是服务端权威的，本地 `+=` 会被下一次广播抹掉，所以要攒起来发一次
   * `healPlayer`。main.ts 在每次渲染后调 `flushPendingHeal()` 把它清掉。
   * 单机模式没人消费它也无所谓 —— 本地血量本来就是真的。
   */
  pendingHeal: number;
  /**
   * ★★ 0.3：**我这一局选的盟约**（单人/测试模式永远没有）。
   * 战斗加成走 `toTeamSetup` 里那一份，经济加成在开局创建状态时折算。
   */
  covenantId?: string;
  /**
   * ★★ 0.3：盟约的**运行期状态**（充能 / 累计 / 一次性标记）。
   *
   * 【为什么跟 `covenantId` 分开？】
   * `covenantId` 是"选了哪个"，是**只读的身份**；这里的是"它现在攒到哪一步了"，
   * 每回合都会变。混成一个字段的话，重置状态时很容易把身份一起清掉。
   */
  covenant: CovenantRuntime;
  /** 场上棋子 */
  placements: Placement[];
  /** 当前选中的备战席棋子（点场上格子时会把它放下去） */
  selectedBenchUid: number | null;
  /**
   * 是否处于「测试模式」。
   * 打开后金币无限、联机功能关闭 —— 用来快速试阵容、调数值、看界面效果。
   */
  testMode: boolean;
  /**
   * 进入测试模式前，普通模式的进度快照。
   *
   * 【为什么需要它？】
   * 因为「切换模式 = 重新开一局」，如果不存，
   * 你从测试模式切回普通模式时，辛苦摆的实战阵容和等级就没了。
   * 存一份快照，切回来时原样还给你。
   */
  normalSnapshot: GameState | null;
  /**
   * ★ 0.0.3 修改器：无限金币开关。
   *
   * 【为什么把它从 testMode 里拆出来？】
   * 以前"测试模式 = 金币无限"，金币是写死的。现在修改器要能**关掉**它 ——
   * 关了之后就是正常经济，可以用「金币 +50」手动加钱试各种局面。
   */
  infiniteGold: boolean;
  /** ★ 0.0.3 修改器：无视人口上限（开了之后想摆几个摆几个） */
  ignorePopCap: boolean;
  /**
   * ★ 0.1.2 修改器：**逐张卡**的基础数值覆盖（key = `Placement.uid`）。
   *
   * ============================================================
   *  【为什么按 uid 存，而不是直接写在 Placement 上？】
   * ============================================================
   * 写进 Placement 当然也行，但棋盘上每一处"重建棋子"的地方
   * （备战席<->场上、互换、收回、清空、合成…）都得记得把它带过去 ——
   * 这个项目已经在 `items` 上吃过一次同样的亏（漏一条路径，装备就凭空消失）。
   * 按 uid 存的话，那 9 条搬运路径**一条都不用动**：uid 是跟着棋子走的，
   * 棋子从场上回备战席、和别的棋子互换，uid 都不变。
   *
   * 【代价 / 边界（必须说清楚）】
   *   · **合成**会生成新 uid ⇒ 合成出来的卡**丢掉覆盖**（这是故意的：
   *     1 星的血量覆盖套到 2 星身上只会变成一个看不懂的数）；
   *   · **卖牌 / 清空棋盘**留下的是永远不会被复用的孤儿条目
   *     （`uidCounter` 全局只增不减，所以不存在"旧覆盖套到新卡上"的风险）；
   *   · **断线重连**会重建 uid，所以那份覆盖跟着 `UnitPlacement.statOverride`
   *     一起走网络（见 applySubmittedTeam 的还原）。
   *
   * 【普通模式会用到吗？】
   * 不会 —— 只有测试模式打开「数值修改」才会往里写。但字段本身
   * 在任何模式都存在（`toSubmittedTeam` 要读它，不必到处判空）。
   */
  testUnitStats: Record<number, UnitStatOverride>;
  /**
   * ★ 0.0.3 藏品（装备）：这个玩家的藏品栏。
   *
   *   aSlots 10 格（A 类存放）/ bSlots 5 格（B 类存放）/ bEquip 4 格（B 类共享装备位）
   *
   * 注意 A 类藏品**装备之后不在这里**，而是挂在干员身上（`Placement.items`）——
   * 理由见 game/items.ts 的文件头。
   */
  items: ItemInventory;
  /**
   * ★ 0.2：「这枚棋子买的时候因为藏品（剑锤）**多付了**几金」——key = `uid`。
   *
   * 【为什么按 uid 记，而不是写在棋子身上？】
   * 和 `testUnitStats` 完全同一个理由：棋子会在备战席 / 场上 / 合成之间来回搬，
   * 写在棋子身上的话，每一条搬运路径（本文件里十来个 push）都要记得带上它，
   * 漏一条就变成"换了个位置就白亏 2 金"，而且**不会报错**。
   * 按 uid 记则一条路径都不用动 —— uid 是跟着棋子走的（合成会换 uid，
   * 那两处显式求和，见 `mergeAllUnits`）。
   *
   * 【它用来干嘛？】
   * 卖出时返还额 = `sellPriceOf(cost, star) + paidCostDelta[uid]`
   * （用户口径："吃到剑锤效果的干员在售卖时也是购买时的价格"）。
   *
   * 【不写 = 0】没被加过价的棋子不占位，卖掉时按原价返还。
   */
  paidCostDelta: Record<number, number>;
  /**
   * ★ 0.0.3 测试模式「双阵营沙盒」：这套状态属于哪半边场地。
   *
   * 【为什么需要它？】
   * 测试模式现在同时跑**两套完全独立**的玩家状态：蓝方（左半场）和红方（右半场），
   * 各自有商店 / 金币 / 备战席 / 阵容 / 羁绊。落子时要按这一套状态所属的半场判定，
   * 所以把"我是哪一边"记在状态里。
   *
   *   0 = 蓝方，可摆列 0 .. TEAM_0_MAX_COL（左半边）
   *   1 = 红方，可摆列 TEAM_1_MIN_COL .. BOARD_W-1（右半边）
   *
   * ★ 普通单机 / 联机**永远是 0** —— 联机时"我在左边"是视角上的事
   *   （服务器可能把我分到队伍 1，客户端把画面翻过来），数据里只存自己那半场。
   */
  side: 0 | 1;
  /**
   * 这一局的随机种子，以及由它派生出来的随机序列。
   *
   * 【为什么把 random 存在状态里，而不是每次刷新时新建？】
   * 因为「新建一个随机源」需要一个种子。
   * 如果每次都用时间当种子，同一毫秒内的两次刷新会拿到**完全相同**的序列，
   * 商店看起来像「没刷新」。存在状态里、一直往下走，就不会有这个问题。
   */
  seed: number;
  random: () => number;
  /**
   * ★ 0.1.1：藏品「随机招募」的**联机仲裁者**（由 main.ts 在联机时注入）。
   *
   * 【为什么要这么一个钩子？】
   * 招募到的干员**真的占牌库 1 张**，而联机的牌库是 8 个人共享的 ——
   * "扣牌"必须服务器裁决（和买牌同一条理由）。
   * 但状态层是纯逻辑、不碰网络，所以这里只留一个"把申请交出去"的钩子：
   *   · 设了它（联机）-> 只发申请，返回文案说"等服务器确认"，结果回来再走 `applyRecruitResult`
   *   · 没设它（单机）-> 本地直接抽（规则同一份：shared 的 `pickRecruit`）
   * 这样"招募到底招到谁"只有一处实现，单机和联机不会走散。
   */
  recruitRequest?: (req: { minCost: number; maxCost: number; seed: number }) => void;
  /** 战斗结果（由主循环塞进来，避免这个模块依赖内核） */
  result: null | {
    winner: 0 | 1 | null;
    ticks: number;
    checksum: number;
    hpBpTeam0: number;
    hpBpTeam1: number;
  };
  playbackSeconds: number;
  playbackSpeed: PlaybackSpeed;
  /** 当前回合数 */
  round: number;
  /**
   * ★ 0.2 罗德岛：**跨回合叠层**（羁绊 id -> 层数）。
   *
   * 【为什么放在客户端？】
   * 因为"这一局赢没赢"是**客户端这一局**的结论（和 `items.growth` 一个道理），
   * 战斗内核只负责把层数换成属性。跟着阵容一起上报给服务器，
   * 联机时对方/观战看到的是同一份数字。
   *
   * ★ 断档要清零：羁绊没在激活状态时层数需重新叠（见 `syncTraitStacks`）。
   */
  traitStacks: Record<string, number>;
  /**
   * ★★ 0.2 MujicaAve：**fever（热度）** —— 第一个"跨回合的玩家级资源"。
   *
   * 【为什么放在客户端，而不是战斗内核里？】
   * 因为它跨回合：内核只跑一场，跑完就没了；而 fever 要从第 3 回合一路攒到第 20 回合。
   * 和 `traitStacks` / `items.growth` 同性质 —— **客户端算、原样上报**，
   * 联机时跟着阵容一起给服务器（重连也就能装回来）。
   *
   * ★ 用户口径：fever **跨回合保留**，而且**羁绊关掉也不清零** ——
   * 所以它不能塞进 `traitStacks`（那玩意儿"没激活就删"）。
   */
  fever: FeverState;
  message: string;
  /**
   * ★★ 0.3.3：**这一份 state 自己的**联机牌库视图（只在服务端跑人机时才有值）。
   *
   * 【为什么不能直接用模块级的那两个变量？】
   * 浏览器里一个标签页只有一个玩家，模块级变量天然正确。
   * 而人机跑在服务端：一个进程里可能同时有 7 台人机 × 好几个房间，
   * 全模块共用一份的话，最后更新的一份会把别人覆盖掉 ——
   * 各家商店就会按别人的库存抽牌。挂在 state 上，一个玩家一份，天然隔离。
   *
   * 客户端永远是 `undefined`（走模块级变量，行为和以前一模一样）。
   */
  netPool?: { raw: Map<string, number>; view: Map<string, number> } | null;
}

/**
 * ★★ 0.2 MujicaAve：fever（热度）的完整状态 —— 定义在 shared 里（`fever.ts`）。
 * 【为什么放 shared？】协议要用它上报、服务端要夹它、客户端要算它 ——
 * 三方抄三遍的那一天，就是"客户端算了、服务端没算"的 bug 出现的那一天。
 */
export type { FeverState } from '../../../../packages/shared/src/index.js';

/**
 * 确定性随机源。
 *
 * 【为什么不用 Math.random()？】
 * 因为商店抽卡如果每次不同，就没法复现「同样的操作得到同样的结果」，
 * 联机时服务器和客户端会对不上（服务器要能校验你买的棋子是合理的）。
 * 用一个种子化的发生器，以后搬到服务端时把种子一换就行。
 */
function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
    t = (t ^ (t + Math.imul(t ^ (t >>> 7), t | 61))) >>> 0;
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/**
 * 生成一个「每次都不一样」的随机种子。
 *
 * 【这里踩过一个坑，值得记下来】
 * 之前 `createGameState(seed = 20250101)` 用的是固定默认种子 ——
 * 结果**每次重开一局，第一回合的商店都一模一样**。
 *
 * 另一个坑：刷新商店时用的是 `Date.now() & 0xffff`，
 * 只取毫秒的低 16 位（约 65 秒一个循环）——
 * 在同一时刻连续刷新会拿到完全相同的随机序列，商店看起来「没变」。
 *
 * 正确做法：用时间做种子，但**生成之后就让随机序列自己往下走**，
 * 不再每次重新播种。见 GameState.random。
 */
function freshSeed(): number {
  // 时间 + 一个自增计数，保证同一毫秒内多次调用也不同
  seedCounter = (seedCounter + 1) >>> 0;
  const time = Date.now() >>> 0;
  let h = (time ^ Math.imul(seedCounter, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

let seedCounter = 0;

let uidCounter = 0;
/** 发一个新的棋子编号。编号唯一即可，不要求连续 */
function nextUid(): number {
  uidCounter++;
  return uidCounter;
}

/**
 * ★★ 0.3：**这一局的规则**（房间设置里那两项会进经济的）。
 *
 * 【为什么单独抽一个类型，而不是直接把 `RoomSettings` 塞进 GameState？】
 * 因为 `GameState` 是单机也在用的，而房间设置只有联机才有。
 * 这里只放"经济真的会读"的那两项，单机传默认值即可 ——
 * 界面层不需要知道"房间设置"这个概念就能跑。
 *
 * 血量不在这里：联机血量是**服务端权威**的（`RoomPlayer.hp`），
 * 客户端本地那份 `economy.hp` 只服务单机。真要让它俩一致，
 * 得把单机也接到服务端，那是 0.4 的事（见反作弊 B 路线）。
 */
export interface GameRules {
  /** 开局金币 */
  startGold: number;
  /** 每回合基础收入 */
  incomeBase: number;
  /**
   * ★ 0.3 盟约「利滚利」：利息上限（默认 5）。
   * 不填 = `MAX_INTEREST`。
   */
  maxInterest?: number;
}

/** 默认规则 = 0.2 的行为（3 金起手、每回合基础 10） */
export const DEFAULT_GAME_RULES: GameRules = {
  startGold: START_GOLD,
  incomeBase: INCOME_BASE,
  maxInterest: MAX_INTEREST,
};

/** 从房间设置里挑出"经济会读"的那几项（联机开局用） */
export function gameRulesOf(settings: { startGold?: number; incomeBase?: number } | undefined): GameRules {
  const pick = (value: number | undefined, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
  return {
    startGold: pick(settings?.startGold, DEFAULT_GAME_RULES.startGold),
    incomeBase: pick(settings?.incomeBase, DEFAULT_GAME_RULES.incomeBase),
    maxInterest: DEFAULT_GAME_RULES.maxInterest,
  };
}

/**
 * 创建一局新游戏。
 *
 * @param seed 随机种子。**不传就按当前时间生成** —— 所以每次重开一局
 *             商店、对手、什么都不同；
 *             传一个固定值就能完全复现同一局（测试和调试用）。
 * @param rules ★ 0.3：开局金币 / 每回合基础收入（联机时来自房间设置）。
 *              不传 = 默认值，单机和老测试行为不变。
 */
export function createGameState(seed?: number, rules: GameRules = DEFAULT_GAME_RULES): GameState {
  const actualSeed = seed ?? freshSeed();
  // ★ 关键：随机序列生成一次，之后一直用它往下走。
  // 不要每次刷新都重新播种 —— 那样同一时刻的刷新会得到相同结果。
  const random = createRng(actualSeed);

  const state: GameState = {
    phase: 'prep',
    // ★ 0.2：不在商店回合
    shopRound: null,
    shopRoundCount: 0,
    meEliminated: false,
    // ★ 0.3：开局金币由规则给（默认 3，和以前一样）
    economy: createEconomy(random, UNIT_DEFS, rules.startGold),
    rules,
    pendingHeal: 0,
    // ★ 0.3：盟约运行期状态（选了哪个由 `state.covenantId` 说，这里只记进度）
    covenant: createCovenantRuntime(),
    placements: [],
    selectedBenchUid: null,
    testMode: false,
    infiniteGold: false,
    ignorePopCap: false,
    testUnitStats: {},
    // ★ 0.2：剑锤那种"买的时候多付了几金"（key = uid），卖出时原样退还
    paidCostDelta: {},
    // ★ 0.2 罗德岛跨回合叠层（羁绊 id -> 层数），每场胜利 +1
    traitStacks: {},
    // ★ 0.2 MujicaAve：fever（跨回合的玩家级资源）
    fever: createFeverState(),
    items: createItemInventory(),
    side: 0,
    normalSnapshot: null,
    seed: actualSeed,
    random,
    result: null,
    playbackSeconds: 0,
    playbackSpeed: 1,
    round: 1,
    message: '点下方商店买干员，再从备战席点到场上',
  };
  return state;
}

/**
 * 切换「普通模式 / 测试模式」。
 *
 * 【核心行为：切换 = 重新开一局】
 * 因为两种模式的经济规则完全不同（一个有金币压力、一个无限金币），
 * 如果只切换金币而不重置，会出现「测试模式把等级刷到 10 级，
 * 回普通模式却还留着 10 级和一堆棋子」这种状态 —— 那普通模式就没法好好玩了。
 * 所以切换时**整个游戏状态重建**，等级、金币、经验、商店、备战席、场上阵容全部回到开局。
 *
 * 【为什么普通模式的进度要先存起来？】
 * 因为「去测试模式看一眼再回来」是很常见的操作。
 * 如果不存，你的实战阵容就白摆了。
 * 所以：进测试模式前把普通模式的状态存下来，退出时原样还给你；
 * 而测试模式每次都是全新的（反正它是用来随便试的）。
 *
 * 【联机时的强约束】
 * 测试模式在对局中**完全不可用**：
 *   · 在房间里或对局中：不允许切换（返回失败并说明原因）
 *   · 界面上按钮也会被禁用（见 main.ts 的 renderAll）
 * 这是硬性防线 —— 无限金币绝不能进联机对局。
 *
 * ============================================================
 *  ⚠️ ★ 0.0.3 起：**界面已经不再走这个函数了**
 * ============================================================
 *  现在点大厅的「测试模式」进的是**双阵营沙盒**（`createTestSide` 造两套状态，
 *  见 main.ts 的 startSinglePlayer）。这个 switchMode 只按"一个 GameState"来切，
 *  出来的还是旧的"单人打人机闯关"形态 —— 所以**别再把 UI 接回它**：
 *  接回去的话，测试模式就又不是左右各一队了。
 *
 *  留着它是因为 prep-rules / modifier 那些测试拿它当"造一个测试模式状态"的
 *  小工具用（`switchMode(createGameState()).next`）。
 */
export function switchMode(state: GameState): { ok: boolean; message: string; next: GameState } {
  const next = createGameState();

  if (state.testMode) {
    // ---- 从测试模式回到普通模式 ----
    // 如果之前存过普通模式的进度，就还给它；否则开新局
    const restored = state.normalSnapshot ?? next;
    restored.testMode = false;
    // 修改器的两个开关也要一并关掉，别把"无视人口上限"带回普通模式
    restored.infiniteGold = false;
    restored.ignorePopCap = false;
    return {
      ok: true,
      message: '已回到普通模式（重新开始一局）',
      next: restored,
    };
  }

  // ---- 从普通模式进入测试模式 ----
  const entering = createGameState();
  entering.testMode = true;
  // 默认就开着无限金币（和改动前一致），但玩家可以在修改器里关掉它
  entering.infiniteGold = true;
  entering.economy.gold = TEST_MODE_GOLD;
  entering.message = '测试模式：金币无限、联机已关闭。右上角可以打开修改器';
  // 把普通模式的进度存在「新状态」上，这样切回来还在
  entering.normalSnapshot = state;
  return {
    ok: true,
    message: '测试模式已开启：联机已关闭（已重新开局，右上角可开修改器）',
    next: entering,
  };
}

/**
 * ★ 0.0.3 测试模式「双阵营沙盒」：造一侧的玩家状态。
 *
 * ============================================================
 *  【测试模式现在长什么样？】
 * ============================================================
 * 不再是"单机闯关"了 —— 一个玩家同时操作**两边**，让他们互相对打：
 *   · 蓝方（side 0，左半场）和红方（side 1，右半场）各有一套**完全独立**的状态：
 *     商店 / 金币 / 备战席 / 阵容 / 羁绊，互不影响；
 *   · 顶栏「切换阵营」在两边之间切换"我现在操作谁"；
 *   · 两边都可以用修改器（发干员、发野怪、改等级、无限金币…）。
 *
 * 这样调数值时就能摆出任意"我方 A 队 vs B 队"的局面，一次看清所有棋子表现。
 *
 * 默认开无限金币（和以前一致），但玩家可以在修改器里关掉。
 */
export function createTestSide(side: 0 | 1, seed?: number): GameState {
  const state = createGameState(seed);
  state.testMode = true;
  state.side = side;
  state.infiniteGold = true;
  state.economy.gold = TEST_MODE_GOLD;
  state.message =
    side === 0
      ? '测试模式 · 蓝方（左半场）：点顶栏「切换到红方」去操作另一半'
      : '测试模式 · 红方（右半场）：点顶栏「切换到蓝方」回到蓝方';
  return state;
}

// ============================================================
// 修改器（★ 0.0.3 新增，**只有测试模式**能用）
// ============================================================
/*
  【为什么绑死在测试模式？】
  它能把金币调满、无视人口上限、凭空发干员 —— 这些一旦进联机就是作弊。
  所以每个入口都先问一句 state.testMode；界面上那个按钮也只在测试模式里出现。
*/

/** 修改器能不能用（统一入口，别在别处直接读 testMode） */
export function modifierAllowed(state: GameState): boolean {
  return state.testMode;
}

/**
 * 开关「无限金币」。
 *
 * 【关掉的时候为什么把金币重置成 START_GOLD？】
 * 否则关了开关手里还攥着 999999 金币，"无限"只是一个标签而已，
 * 而且下面那个「金币 +50」会变得毫无意义。重置成正常起始值，
 * 玩家就能用 +50 一点一点试"钱不够时会发生什么"。
 */
export function setInfiniteGold(state: GameState, on: boolean): { ok: boolean; message: string } {
  if (!modifierAllowed(state)) return { ok: false, message: '修改器只在测试模式里能用' };
  state.infiniteGold = on;
  if (on) {
    state.economy.gold = TEST_MODE_GOLD;
    return { ok: true, message: '无限金币：开' };
  }
  state.economy.gold = START_GOLD;
  return { ok: true, message: `无限金币：关（金币重置为 ${START_GOLD}）` };
}

/** 修改器：直接加金币（无限金币开着时没意义，界面上会禁用） */
export function addGold(state: GameState, amount = 50): { ok: boolean; message: string } {
  if (!modifierAllowed(state)) return { ok: false, message: '修改器只在测试模式里能用' };
  if (state.infiniteGold) return { ok: false, message: '无限金币开着，加钱没有意义' };
  state.economy.gold += amount;
  return { ok: true, message: `金币 +${amount}（现在 ${state.economy.gold}）` };
}

/** 修改器：开关「无视人口上限」 */
export function setIgnorePopCap(state: GameState, on: boolean): { ok: boolean; message: string } {
  if (!modifierAllowed(state)) return { ok: false, message: '修改器只在测试模式里能用' };
  state.ignorePopCap = on;
  return { ok: true, message: on ? '无视人口上限：开' : '无视人口上限：关' };
}

/**
 * ★ 0.0.3 修改器：直接把等级设成 1 ~ 10。
 *
 * 【为什么要它？】
 * 商店出现概率、人口上限都跟等级挂钩。测一只 5 费棋子的表现时，
 * 想立刻到 10 级看满概率的商店，靠点「买经验」要按几十下 —— 太慢。
 * 这里一步到位。
 *
 * 【为什么顺带把经验清零？】
 * 不然会出现"等级 3、经验条却差一点就升 4"的怪状态（xp 是跨级累计的）。
 * 清零 = 这一级的起点，和"刚升到这一级"完全一致。
 */
export function setModifierLevel(state: GameState, level: number): { ok: boolean; message: string } {
  if (!modifierAllowed(state)) return { ok: false, message: '修改器只在测试模式里能用' };
  const lv = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level) || 1));
  state.economy.level = lv;
  state.economy.xp = 0;
  return { ok: true, message: `等级设为 ${lv}（人口上限 ${populationCap(lv)}）` };
}

/**
 * 修改器：把某个干员 / 野怪**直接发到备战席**。
 *
 * ★ 白送的棋子带 `free: true`：**不占牌库、卖回也不还牌库**（见 BenchUnit.free）。
 * 所以它既不会把牌库抽干，也不会在卖掉时凭空多出几张。
 * 召唤物不能发（它们不在商店/牌库里，是技能产物）。
 *
 * ★ 0.0.3：**野怪也能直接发**（它们原本不在商店/牌库里，但测试时正是要发它们）。
 *   野怪没有星级（星级倍率恒 1000），所以不管你选 1/2/3 星，发出来都是 1 星 ——
 *   反正选几星在实战里都一模一样，统一成 1 星也免得出现"2 星源石虫"这种怪东西。
 */
export function grantModifierUnit(
  state: GameState,
  defId: string,
  star = 1,
): { ok: boolean; message: string } {
  if (!modifierAllowed(state)) return { ok: false, message: '修改器只在测试模式里能用' };
  const def = UNIT_DEFS[defId];
  if (!def || def.summonOnly) return { ok: false, message: '这个干员不存在（召唤物不能直接发）' };
  if (state.economy.bench.length >= BENCH_SLOTS) {
    return { ok: false, message: `备战席满了（${BENCH_SLOTS} 格），先上场或卖掉一些` };
  }
  // ★ 野怪：星级形同虚设，统一按 1 星发（见函数头注释）
  const isMonster = def.monsterOnly === true;
  const useStar = isMonster ? 1 : clampStar(star);
  // ★ 不走 buyShopSlot：那条路要扣钱、要占牌库，而修改器是"白送"
  state.economy.bench.push({ uid: nextUid(), defId, star: useStar, free: true });
  state.economy.bench.sort((a, b) => a.uid - b.uid);
  // 干员凑够三个会直接合上去；野怪不参与合成（见 mergeAllUnits）。合成结果同样是"白送"。
  const merged = mergeAllUnits(state);
  const starText = isMonster ? '' : `（${useStar} 星）`;
  state.message =
    merged.length > 0
      ? `获得 ${def.name}${starText}，并合成 ${describeMerges(merged)}！`
      : `获得 ${def.name}${starText}，已放进备战席`;
  return { ok: true, message: state.message };
}

/** 星级钳到 1~3 */
function clampStar(star: number): number {
  return Math.max(1, Math.min(3, Math.floor(star) || 1));
}

// ============================================================
// 便捷读取（界面天天要用）
// ============================================================

export const gold = (state: GameState): number => state.economy.gold;
export const levelInfo = (state: GameState) => levelSummary(state.economy);
export const benchUnits = (state: GameState): BenchUnit[] => state.economy.bench;
export const shopSlots = (state: GameState) => state.economy.shop;
/**
 * 人口上限 = 等级带来的上限 + 藏品带来的上限（地形图 +1）。
 *
 * ★ 加藏品那一份必须在这里加，不能在别处再抄一遍 ——
 *   凡是要"再算一次人口"的地方都会走这个函数（落子、拖拽高亮、界面显示）。
 */
export const popCap = (state: GameState): number =>
  populationCap(state.economy.level) + itemPopCapBonusOf(state);
export const boardCount = (state: GameState): number => state.placements.length;

/**
 * 某一方可以放棋子的格子。
 *
 * 【★ 0.0.3：为什么从"左半边"升级成了"按 side 判定"？】
 * 测试模式的「双阵营沙盒」里，红方那套状态的可摆放区域在**右半边**。
 * 如果这里还写死"只能放左半边"，红方就一个子都摆不上去。
 * 所以把"哪半边"抽成一个参数 —— 全体落子路径（点击 / 拖拽 / 移动）共用它。
 *
 * @param side 0 = 蓝方（左半场，列 0..TEAM_0_MAX_COL）；1 = 红方（右半场，列 TEAM_1_MIN_COL..BOARD_W-1）
 */
export function isSideCell(side: 0 | 1, cell: Cell): boolean {
  if (cell.row < 0 || cell.row >= BOARD_H) return false;
  return side === 0
    ? cell.col >= 0 && cell.col <= TEAM_0_MAX_COL
    : cell.col >= TEAM_1_MIN_COL && cell.col < BOARD_W;
}

/** 玩家（默认蓝方 / 左半边）可以放棋子的格子。等价于 isSideCell(0, cell)。 */
export function isPlayerCell(cell: Cell): boolean {
  return isSideCell(0, cell);
}

/** 人话描述某一方该往哪半边摆 —— 出错提示和界面文案都用它 */
export function sidePlacementHint(side: 0 | 1): string {
  return side === 0 ? '蓝方只能摆在左半边场地' : '红方只能摆在右半边场地';
}

/** 某个位置上的棋子 */
export function placementAt(state: GameState, cell: Cell): Placement | undefined {
  return state.placements.find((p) => p.cell.col === cell.col && p.cell.row === cell.row);
}

// ============================================================
// 商店操作
// ============================================================

/**
 * 测试模式下的金币「补满」逻辑。
 *
 * 【为什么不是简单地「永远不扣钱」？】
 * 因为扣钱的地方散落在好几处（买干员、刷新、买经验），
 * 与其每处都加一个 if，不如在每次操作后统一补满。
 *
 * 【为什么是「只要少于上限就补」而不是「低于一半才补」？】
 * 一开始我写的是「掉到一半以下才补」，结果数字会一直在往下掉 ——
 * 虽然实际上花不完，但看上去像在花钱，很困惑。
 * 改成每次操作后都补满，金币就永远是满的，观感上才真的是「无限」。
 */
function topUpGoldIfTestMode(state: GameState): void {
  // ★ 0.0.3：要"测试模式 + 无限金币开关打开"才补满 —— 关掉之后就是正常经济
  if (state.testMode && state.infiniteGold && state.economy.gold !== TEST_MODE_GOLD) {
    state.economy.gold = TEST_MODE_GOLD;
  }
}

/** 刷新商店（花金币） */
export function doRefreshShop(state: GameState): { ok: boolean; message: string } {
  // ★ 0.2.1：淘汰的人一律不能碰商店（唯一判据，见 shopBlockedByElimination）
  const blocked = shopBlockedByElimination(state);
  if (blocked) return blocked;
  // ★ 0.1.1：战斗阶段也放行（统一走 canShopNow，别在这里再写一遍阶段判断）
  if (!canShopNow(state.phase)) return { ok: false, message: '战斗进行中不能刷新' };
  // 用状态里那条持续往下走的随机序列，不要每次新建 ——
  // 否则同一毫秒内连点刷新会拿到同样的结果
  // remaining 传进去：抽干的棋子不会再出现（牌库机制真正生效的地方）
  const goldBefore = state.economy.gold;
  const result = refreshShop(state.economy, state.random, false, UNIT_DEFS, {
    remaining: poolRemaining(state),
  });
  if (result.ok) {
    /*
      ★★ 0.3 盟约「猎头顾问 / 博学多通」：**这一次刷新可能是特殊刷新**。
      放在 `refreshShop` 之后改那 5 个格子 —— 这样"正常刷新"仍然只有一份实现，
      特殊刷新只是"把其中几格覆盖掉"，不会和牌库/概率那套逻辑打架。
    */
    const special = applyCovenantRefreshSpecial(state);
    // ★ 0.3 盟约「通关奖励」：花在刷新上的钱也算进累计
    const spendText = noteCovenantSpending(state, goldBefore - state.economy.gold);
    state.message = [result.message, special, spendText].filter(Boolean).join(' · ');
  }
  topUpGoldIfTestMode(state);
  return { ok: result.ok, message: state.message };
}

// ============================================================
//  ★★ 0.3 盟约：客户端这一侧的实现（经济 / 商店 / 藏品）
// ============================================================
//
// 【哪些盟约在这里？】凡是"看得到、摸得着但不在战斗里"的：
//   变形同构（第 4 回合送装备）· 猎头顾问（特殊刷新）· 通关奖励（花钱送牌）·
//   博学多通（高费刷新）。
// 【哪些不在这里？】命结之秘是**战斗内核**的事（`killUnit` 里判），
//   因为"谁先死"只有内核知道；这里只把盟约 id 塞进 `TeamSetup`。
// 【数值类】（开局金币 / 收入 / 血量 / 利息上限 / 按回合发钱 / 胜利回血）
//   走的是 `covenantEconomy` 那一套，也不在这个文件里重复。

/** 通关奖励：每累计花掉多少金送一张牌 */
const COVENANT_CARD_SPEND = 50;
/** 命结之秘：每场战斗每队最多拉起几个（和 `combat-math.ts` 里那个 2 保持一致） */
export const COVENANT_REVIVE_LIMIT = 2;

/**
 * 记一笔"花掉的钱"（盟约「通关奖励」）。
 *
 * ★ 为什么由调用方传金额，而不是在这里读 `state.economy.gold` 的差值？
 *   因为差值只在"这一笔刚好扣成功"时才有意义，而调用方最清楚自己扣了多少。
 */
function noteCovenantSpending(state: GameState, amount: number): string | null {
  if (amount <= 0) return null;
  if (state.covenantId !== 'cv_qiliang') return null;
  state.covenant.spent += amount;
  const lines: string[] = [];
  // 用 while：一次花掉 120 金（买 3 次经验）应该当场给 2 张牌，而不是只给 1 张
  while (state.covenant.spent >= COVENANT_CARD_SPEND) {
    state.covenant.spent -= COVENANT_CARD_SPEND;
    const text = grantCovenantCard(state);
    if (text) lines.push(text);
  }
  return lines.length > 0 ? `盟约「通关奖励」：${lines.join('；')}` : null;
}

/**
 * 从牌库随机拿一张牌进备战席（**契约「通关奖励」的落地**）。
 *
 * ★ 复用招募那条已经审过的链路：
 *   · 单机 —— 本地 `pickRecruit` 抽完，走 `applyRecruitResult`；
 *   · 联机 —— 走 `state.recruitRequest`（服务器扣牌 + 回执 -> `applyRecruitResult`）。
 *   自己另写一套"加一张牌"的话，牌库会超发（这是联机里最贵的一类 bug）。
 * ★ 费用档按**玩家等级**的商店概率抽 —— 和用户口径"概率与你的等级挂钩"一致；
 *   然后在这一档里均匀抽一个"牌库还有货"的。
 */
function grantCovenantCard(state: GameState): string {
  const odds = SHOP_ODDS_BY_LEVEL[Math.max(1, Math.min(MAX_LEVEL, state.economy.level))] ?? SHOP_ODDS_BY_LEVEL[1]!;
  // 只在该档**还有货**的档位之间归一化（和 rollShop 同一个口径）
  const live: Array<{ cost: number; ids: string[] }> = [];
  for (let cost = 1; cost <= 5; cost++) {
    const ids = unitIdsByCost(cost).filter((defId) => poolRemainingOf(state, defId) > 0);
    if (ids.length > 0) live.push({ cost, ids });
  }
  if (live.length === 0) return '牌库已经空了，这次不发了';

  const total = live.reduce((sum, entry) => sum + odds[entry.cost - 1]!, 0);
  let roll = state.random() % Math.max(1, total);
  let picked = live[live.length - 1]!;
  for (const entry of live) {
    roll -= odds[entry.cost - 1]!;
    if (roll < 0) {
      picked = entry;
      break;
    }
  }
  const cost = picked.cost;

  if (state.recruitRequest) {
    state.recruitRequest({ minCost: cost, maxCost: cost, seed: state.random() });
    return `累计花费 ${COVENANT_CARD_SPEND} 金：正在向服务器领取 1 张 ${cost} 费干员牌…`;
  }
  const candidates = playableDefs().filter((def) => def.cost === cost);
  const result = pickRecruit(
    candidates,
    (defId) => poolRemainingOf(state, defId),
    (length) => state.random() % length,
  );
  return `累计花费 ${COVENANT_CARD_SPEND} 金：` + applyRecruitResult(state, result.defId, 'gold' in result ? result.gold : 0);
}

/** 把一格换成"指定费用档、还有货"的棋子（特殊刷新用）。成功返回 true */
function forceShopSlotCost(
  state: GameState,
  index: number,
  cost: number,
  used: Map<string, number>,
): boolean {
  const ids = unitIdsByCost(cost).filter(
    (defId) => poolRemainingOf(state, defId) - (used.get(defId) ?? 0) > 0,
  );
  if (ids.length === 0) return false;
  const defId = ids[state.random() % ids.length]!;
  const def = UNIT_DEFS[defId];
  if (!def) return false;
  state.economy.shop[index] = { defId, cost: def.cost, sold: false };
  used.set(defId, (used.get(defId) ?? 0) + 1);
  return true;
}

/**
 * 清掉「这几格是特殊刷新换出来的」标记（界面靠它描金边 + 角标）。
 *
 * ★★ 0.3.4：抽成函数是**为了不漏** —— 只要商店被整批换掉（手动刷新 / 回合开始
 * 的自动刷新），这个标记就必须跟着清；以前只有手动那条路清了，
 * 于是标记会残留到下一回合的自动刷新那批牌上（梓兰 / 佩佩都中招）。
 */
function clearSpecialRefreshMarks(state: GameState): void {
  state.covenant.specialSlots = [];
}

/**
 * 盟约的「特殊刷新」：把刚刷出来的 5 格**覆盖**掉几格。
 *
 * · 猎头顾问：必定出现 2 张同名（要求牌库还剩 ≥2 张，否则买不到第二张）
 * · 博学多通：必定 ≥3 张 5 费（5 费不够依次用 4 费补）
 *
 * @returns 一句话说明（没触发就返回 null）
 */
function applyCovenantRefreshSpecial(state: GameState): string | null {
  const shop = state.economy.shop;
  // ★ 每刷新一次都先清掉上一次的标记（没触发就是空的，界面据此不上色）
  clearSpecialRefreshMarks(state);
  if (shop.length === 0) return null;
  if (state.covenantId === 'cv_zilan' && state.covenant.headhunt) {
    /*
      ★ 优先沿用这一批里**已经出现**的那张（观感上更自然：不是凭空换掉一整批）；
      没有符合条件的，再按费用档从高到低找一个"牌库还剩 ≥2 张"的。
    */
    let target = shop
      .map((slot) => slot.defId)
      .find((defId) => defId && poolRemainingOf(state, defId) >= 2);
    if (!target) {
      for (let cost = 5; cost >= 1 && !target; cost--) {
        const ids = unitIdsByCost(cost).filter((defId) => poolRemainingOf(state, defId) >= 2);
        if (ids.length > 0) target = ids[state.random() % ids.length];
      }
    }
    if (target) {
      const def = UNIT_DEFS[target];
      if (def) {
        state.covenant.headhunt = false;
        shop[0] = { defId: target, cost: def.cost, sold: false };
        shop[1] = { defId: target, cost: def.cost, sold: false };
        // ★ 界面给这两格上"特殊刷新"的色（不然玩家不知道哪两张是盟约给的）
        state.covenant.specialSlots = [0, 1];
        return `「猎头顾问」特殊刷新：必定出现 2 张 ${def.name}`;
      }
    }
    // 牌库实在凑不出 2 张同名 -> 这次不消耗充能，留到下一回合
    return '「猎头顾问」特殊刷新：牌库里凑不出 2 张同名，等你下次刷新';
  }

  if (state.covenantId === 'cv_peipei' && state.covenant.highTier > 0) {
    const used = new Map<string, number>();
    /** ★ 被改写的格子（界面要标"特殊"），只记真的换成功了的 */
    const touched: number[] = [];
    for (let i = 0; i < shop.length && touched.length < 3; i++) {
      // 5 费优先；这一档空了就用 4 费补（用户口径）
      if (forceShopSlotCost(state, i, 5, used) || forceShopSlotCost(state, i, 4, used)) touched.push(i);
    }
    if (touched.length > 0) {
      state.covenant.highTier -= 1;
      state.covenant.specialSlots = touched;
      return `「博学多通」特殊刷新：${touched.length} 张高费（5 费优先，不够用 4 费补）`;
    }
    return '「博学多通」特殊刷新：牌库里没有 5/4 费了，这次留着名额';
  }

  return null;
}

/**
 * ★★ 0.3.1：下一次刷新**会不会是特殊刷新**（盟约攒着的那一次）。没有就返回 null。
 *
 * 【为什么单独一个函数？】
 * 界面要用它给刷新按钮挂角标（`#btn-refresh-badge`）。判据必须和
 * `applyCovenantRefreshSpecial` 里那两个 `if` 一致 —— 写两遍迟早会出现
 * "按钮上说有特殊刷新、点下去却没有"。所以由本函数统一回答，界面只负责显示。
 */
export function specialRefreshHint(state: GameState): string | null {
  if (!state.covenantId) return null;
  if (state.covenantId === 'cv_zilan' && state.covenant.headhunt) return '必定 2 张同名';
  if (state.covenantId === 'cv_peipei' && state.covenant.highTier > 0) {
    return `${state.covenant.highTier} 次高费刷新`;
  }
  return null;
}

/**
 * 等级奖励（博学多通：升到 9 / 10 级各给一次高费刷新）。
 *
 * ★ 为什么不在"升级那一刻"写死调用，而是**查一遍当前等级**？
 *   因为升级有两条路（买经验 / 回合结算送经验），漏一条就永远拿不到。
 *   用"当前等级 >= N 且还没发过"当判据，两条路都走一遍也不会重复发。
 */
function syncCovenantLevelRewards(state: GameState): string | null {
  const notes: string[] = [];

  if (state.covenantId === 'cv_peipei') {
    const gained: number[] = [];
    for (const level of [9, 10]) {
      if (state.economy.level < level) continue;
      if (state.covenant.highTierLevels.includes(level)) continue;
      state.covenant.highTierLevels.push(level);
      state.covenant.highTier += 1;
      gained.push(level);
    }
    if (gained.length > 0) {
      notes.push(`盟约「博学多通」：升到 ${gained.join(' / ')} 级，获得 ${gained.length} 次高费刷新`);
    }
  }

  /*
    ★★ 0.3.1 定向投放（凯瑟琳）：达到 3 级之后**每升一级**随机获得一件藏品。
    和博学多通一样用"当前等级 >= N 且还没发过"当判据 ——
    升级有两条路（买经验 / 回合结算送经验），用判据比在升级点写死调用更稳。
  */
  const kathryn = covenantLevelItem(state.covenantId);
  if (kathryn) {
    for (let level = kathryn.fromLevel; level <= state.economy.level; level++) {
      if (state.covenant.kathrynLevels.includes(level)) continue;
      state.covenant.kathrynLevels.push(level);
      const itemId = pickCovenantLevelItem(state, kathryn);
      if (!itemId) {
        notes.push(`盟约「定向投放」：升到 ${level} 级，但藏品池是空的`);
        continue;
      }
      const added = addItem(state, itemId);
      notes.push(
        added.ok
          ? `盟约「定向投放」：升到 ${level} 级，获得藏品 ${ITEM_DEFS[itemId]?.name ?? itemId}`
          : `盟约「定向投放」：升到 ${level} 级，${added.message}`,
      );
    }
  }

  return notes.length > 0 ? notes.join(' · ') : null;
}

/**
 * ★ 0.3.1 定向投放：从藏品池随机抽一件。
 *
 * · 普通 70% / 进阶 30%（权重来自数据表 `levelItem`）；
 * · 进阶池**排除转职藏品**（和坎诺特商店的进阶位同一个口径）——
 *   转职是"指定羁绊"的特殊商品，随机白送会让阵容平衡失控。
 * · 只用 `state.random`：单机/联机各自一份种子，重连重算结果一致。
 */
function pickCovenantLevelItem(
  state: GameState,
  cfg: { commonBp: number; advancedBp: number },
): string | null {
  const normal = NORMAL_ITEMS;
  const advanced = ADVANCED_ITEMS.filter((item) => !item.grantsTrait);
  const total = cfg.commonBp + cfg.advancedBp;
  const roll = total > 0 ? state.random() % total : 0;
  const wantAdvanced = roll >= cfg.commonBp;
  const pool = wantAdvanced ? (advanced.length > 0 ? advanced : normal) : normal.length > 0 ? normal : advanced;
  if (pool.length === 0) return null;
  return pool[state.random() % pool.length]!.id;
}

/**
 * ★★ 0.3.2（用户口径）：盟约「阿米娅 · 不容拒绝」——**开局送一只 1 星阿米娅**。
 *
 * 【为什么必须有？】
 * 这条盟约的整套玩法（升变任务 / 三张升变之证）都围绕阿米娅，
 * 而她在 1 费池里只是 27 张之一 —— 纯靠商店刷，
 * 很可能前几回合根本摸不到她，"任务"就成了空话。
 *
 * 【为什么写 `free: true`（不占共享牌库）？】
 * 盟约白送的棋子不该吃别人的份数，也不该卖了还回池子 ——
 * 否则 8 个人都能拿这条盟约"刷牌"，牌库会被凭空放大。
 *
 * 【幂等】三重保险，重连不会重复发：
 *   ① `covenant.amiyaGift` 标记（本局发过就不再发）；
 *   ② 手上**已经有**阿米娅（任意形态，场上或备战席）就直接标记、不再发
 *      —— 重连时 `GameState` 是重建的，标记会归零，这条才真正兜得住；
 *   ③ 备战席满了就先不发（**不标记**，下一回合再试），
 *      否则玩家第一回合刚好塞满 9 格就永久失去这只阿米娅。
 *
 * @returns 给日志用的那句话说；没发就返回 null
 */
export function applyCovenantOpening(state: GameState): string | null {
  if (state.covenantId !== AMIYA_COVENANT_ID) return null;
  if (state.covenant.amiyaGift) return null;
  if (amiyaStarOf(state) > 0) {
    // 已经有她了（重连 / 玩家自己买到了）—— 标记上，别再送第二只
    state.covenant.amiyaGift = true;
    return null;
  }
  if (state.economy.bench.length >= BENCH_SLOTS) return null;
  state.covenant.amiyaGift = true;
  /*
    ★ `free: true` = 不占牌库（见 `poolCopiesOf`）：卖掉也还 0 张。
      这正好也是"盟约白送"的正确口径。
  */
  state.economy.bench.push({ uid: nextUid(), defId: AMIYA_BASE_ID, star: 1, free: true });
  state.economy.bench.sort((a, b) => a.uid - b.uid);
  return '盟约「不容拒绝」：获得 1 星阿米娅（备战席）';
}

/**
 * 回合开始时的盟约结算（由 `advanceRound` 在回合号 +1 之后调用一次）。
 *
 * 现在的两项：
 *   · 变形同构 —— 第 4 回合给一件「变形同构体」
 *   · 猎头顾问 —— 每 2 回合充能一次"特殊刷新"
 */
function applyCovenantRoundStart(state: GameState): void {
  if (!state.covenantId) return;

  /*
    ★ 0.3.2 兜底：开局那只阿米娅如果因为"备战席满了"没发下来，
    每回合开头都会再试一次（`applyCovenantOpening` 自己是幂等的）。
  */
  const gift = applyCovenantOpening(state);
  if (gift) state.message += ` · ${gift}`;

  if (state.covenantId === 'cv_shapeshifter' && !state.covenant.morphGiven && state.round >= 4) {
    state.covenant.morphGiven = true;
    const added = addItem(state, 'itm_morph_relic');
    state.message += added.ok
      ? ' · 盟约「变形同构」：获得一件变形同构体'
      : ' · 盟约「变形同构」：藏品栏满了，变形同构体没发下来';
  }

  if (state.covenantId === 'cv_zilan' && state.round >= 2 && state.round % 2 === 0) {
    state.covenant.headhunt = true;
    state.message += ' · 盟约「猎头顾问」：下一次刷新必定 2 张同名';
  }

  // 回合结算也会送经验 —— 升级奖励在这里也要查一遍（不能只在买经验时查）
  const levelText = syncCovenantLevelRewards(state);
  if (levelText) state.message += ` · ${levelText}`;
}

/**
 * 免费刷新商店（回合开始时自动换一批时用）。
 * 不会扣钱，也不会被「金币不够」拦住。
 *
 * ★★ 0.3.4 修「梓兰 / 佩佩的标记跑到下一回合去了」：
 *   `state.covenant.specialSlots` 记录的是"哪几格是特殊刷新换出来的"，
 *   界面据此给那几格描金边 + 角标。以前**只有手动刷新**会清它，
 *   而回合结束的这次自动刷新是整批换牌 —— 标记却留着，
 *   于是下一回合开局那批**完全普通的牌**，前两格（佩佩是三格）依旧挂着金边。
 *   玩家看到的就是"特殊刷新跑到别的回合去了 / 自动刷新也变成特殊刷新了"。
 *
 *   ⇒ 只要"整批换牌"，标记就必须跟着清。这里是唯一的自动换牌入口。
 *   ★ 注意：自动刷新**不消耗**充能（`headhunt` / `highTier` 一个都不动）——
 *     用户口径是"第一次**主动**刷新"，回合开始那次不算主动。
 */
export function doFreeRefreshShop(state: GameState): { ok: boolean; message: string } {
  const result = refreshShop(state.economy, state.random, true, UNIT_DEFS, {
    remaining: poolRemaining(state),
  });
  if (result.ok) {
    clearSpecialRefreshMarks(state);
    state.message = result.message;
  }
  return result;
}

/**
 * 切换「锁定商店」。
 * 锁定后回合结束不会自动刷新，用来保住一批好棋子等下一回合买。
 */
export function doToggleShopLock(state: GameState): { ok: boolean; message: string } {
  // ★ 0.2.1：淘汰的人一律不能碰商店
  const blocked = shopBlockedByElimination(state);
  if (blocked) return blocked;
  // ★ 0.1.1：战斗阶段也放行（统一走 canShopNow）
  if (!canShopNow(state.phase)) return { ok: false, message: '战斗进行中不能锁定商店' };
  const result = toggleShopLock(state.economy);
  state.message = result.message;
  return result;
}

/**
 * 买经验（升级）。
 *
 * ★ 0.0.3：这里挂上藏品「失落之钥」的两个效果 ——
 *   · 花金币升级时**额外 +1 经验**（注意只有"花金币"这条路径才给，
 *     每回合白送的 2 点经验不算，设计稿写的是"金币升级时"）；
 *   · 升到满级那一刻一次性给 50 金（用 `lostKeyPaid` 标记只发一次，
 *     没有它的话满级之后每点一次买经验都会再发 50）。
 */
export function doBuyXp(state: GameState): { ok: boolean; message: string } {
  // ★ 0.2.1：淘汰的人一律不能碰商店
  const blocked = shopBlockedByElimination(state);
  if (blocked) return blocked;
  // ★ 0.1.1：战斗阶段也放行（统一走 canShopNow）
  if (!canShopNow(state.phase)) return { ok: false, message: '战斗进行中不能升级' };
  const goldBefore = state.economy.gold;
  const result = buyXp(state.economy);
  /*
    ★★ 0.3 盟约：这两步要**无条件**跑，不能塞在 `if (!result.ok) return` 后面。
    理由：等级也可能在**别处**被抬高（回合结算送经验），
    而"满级了买不了经验"并不等于"没有新等级要发奖" ——
    一旦早退，玩家在 9 级差一点经验时点一次买经验，博学多通那一次就永远拿不到。
  */
  const spendNote = noteCovenantSpending(state, goldBefore - state.economy.gold);
  const levelNote = syncCovenantLevelRewards(state);
  if (!result.ok) {
    const extra = [spendNote, levelNote].filter(Boolean).join(' · ');
    return { ok: false, message: extra ? `${result.message} · ${extra}` : result.message };
  }
  const notes: string[] = [];
  if (spendNote) notes.push(spendNote);
  if (levelNote) notes.push(levelNote);
  if (state.items.permanent.lostKey) {
    grantXp(state.economy, LOST_KEY_BONUS_XP);
    notes.push(`失落之钥：经验 +${LOST_KEY_BONUS_XP}`);
  }
  const maxLevelBonus = settleLostKeyMaxLevel(state);
  if (maxLevelBonus > 0) notes.push(`失落之钥：满级奖励金币 +${maxLevelBonus}`);

  state.message = notes.length > 0 ? `${result.message}（${notes.join('，')}）` : result.message;
  topUpGoldIfTestMode(state);
  return { ok: true, message: state.message };
}

// ============================================================
// 合成（备战席 + 场上一起算）
// ============================================================

/** 一次合成事件，用于给界面写提示 */
export interface MergeReport {
  defId: string;
  star: number;
  /** 合成结果落在场上还是备战席 */
  onBoard: boolean;
}

/**
 * 检查并执行合成 —— **备战席和场上一起算**。
 *
 * 【为什么不能只合并备战席？（你报的 bug）】
 * 原来的实现（`mergeBench`）只扫备战席。于是：
 *   · 场上有 2 个一样的一星，买第 3 个 → 合成物落在**备战席**上，
 *     场上那两个还是各占一个格子。玩家看到的是"凑齐了却没合成"。
 *   · 场上有 3 个一样的 → 永远不合成。
 *   · 想凑三星，必须先全部收回备战席，合完再一个个放回去。
 * 这和自走棋的手感是相反的：**场上的棋子当然应该算数**。
 *
 * 【合成结果落在哪？】
 * 规则：**只要被吃掉的三个里有任何一个在场上，结果就落在场上**，
 * 位置取其中 uid 最小的那个格子的位置（uid 是发放顺序，所以是稳定的）。
 * 理由：场上的棋子是玩家已经摆好的战力，不能因为买个棋子就凭空消失。
 * 三个都在备战席时才落在备战席。
 *
 * 【为什么要循环？】
 * 因为连锁合成：9 个一星 → 3 个二星 → 1 个三星。
 * 一次扫描只能把 9 变 3，所以要反复扫到没有变化为止。
 *
 * @returns 这次一共合成了什么（按发生顺序）
 */
export function mergeAllUnits(state: GameState): MergeReport[] {
  const reports: MergeReport[] = [];

  let changed = true;
  let guard = 0;
  while (changed && guard++ < 50) {
    changed = false;

    for (const star of [1, 2]) {
      // 把「备战席 + 场上」同一个棋子同一个星级的都收集起来
      /*
        ★★ 0.3.2：分组用**家族 key**（`familyKeyOf`）。
        阿米娅的三个升变形态和基础阿米娅是**同一只棋子**（用户口径）：
        手里 1 星「青色怒火」+ 再买 2 张 1 费阿米娅 = 2 星「青色怒火」。
        结果保留组里**最靠后的那个形态**（`ascendRankOf`），
        否则"升变过又买了两张"会退回基础形态，等于把升变吃掉了。
      */
      const groups = new Map<string, Array<{ uid: number; cell: Cell | null }>>();
      const add = (defId: string, uid: number, cell: Cell | null): void => {
        const key = familyKeyOf(defId);
        const list = groups.get(key) ?? [];
        list.push({ uid, cell });
        groups.set(key, list);
      };
      for (const unit of state.economy.bench) {
        if (unit.star === star) add(unit.defId, unit.uid, null);
      }
      for (const placement of state.placements) {
        if (placement.star === star) add(placement.defId, placement.uid, placement.cell);
      }

      // 按家族 key 排序遍历，保证合成顺序稳定 => 确定性
      for (const familyKey of [...groups.keys()].sort()) {
        const owned = groups.get(familyKey)!;
        if (owned.length < 3) continue;
        /*
          ★ 野怪不参与合成：它们没有星级（星级倍率恒 1000），
          3 个相同的野怪应该**还是 3 个**，而不是莫名其妙变成"2 星源石虫"。
          所以直接跳过。
          ★ 彩蛋棋子（noStar）同理：它连星级机制都没有，三张不合一。
          （查的是家族代表 = 基础棋子，家族成员的星级机制跟它一致。）
        */
        if (UNIT_DEFS[familyKey]?.monsterOnly || UNIT_DEFS[familyKey]?.noStar) continue;

        // 取 uid 最小的三个（uid 是发放顺序，等价于"最早拿到的三个"）
        const consumed = owned.slice().sort((a, b) => a.uid - b.uid).slice(0, 3);
        const consumedUids = consumed.map((item) => item.uid);
        const boardCells = consumed.map((item) => item.cell).filter((cell): cell is Cell => cell !== null);
        /*
          ★ 合成出来的是哪个形态：被吃掉的三个里**最靠后的那个形态**。
          全是基础棋子时就是 `familyKey` 本身 —— 行为和以前完全一样。
        */
        let defId = familyKey;
        for (const unit of [...state.economy.bench, ...state.placements]) {
          if (!consumedUids.includes(unit.uid)) continue;
          if (ascendRankOf(unit.defId) > ascendRankOf(defId)) defId = unit.defId;
        }

        /*
          ★ 0.0.3：合出来的这只占牌库几张 = 被吃掉的三个**各占几张之和**（封顶到该星级）。
          以前是"三个里有一个是白送的，合出来的整只也算白送" ——
          那会把道具免掉的那几张放大成一整只：拿一件博士投影就把手上 7 张同名干员
          全洗成"不占牌库"，牌库数字从 3 弹回 10（用户报的 bug）。
          按张相加之后，道具只免掉它真正多给的那几张，账不会漂。
        */
        const consumedCopies = [...state.economy.bench, ...state.placements]
          .filter((unit) => consumedUids.includes(unit.uid))
          .reduce((sum, unit) => sum + poolCopiesOf(unit), 0);

        /*
          ★ 0.2：被吃掉的三个"各自多付了几金"要**求和**带到合出来的那只身上。
          剑锤的加价是**按张**收的（买 3 个 1 星就多付 3 份），
          所以 2 星卖出时就该多退 3 份 —— 求和正好。
          ★ 必须在下面 `filter` 摘掉它们**之前**读，否则这笔账就丢了。
        */
        const carriedPaidDelta = [...state.economy.bench, ...state.placements]
          .filter((unit) => consumedUids.includes(unit.uid))
          .reduce((sum, unit) => sum + (state.paidCostDelta[unit.uid] ?? 0), 0);

        /*
          ★ 0.0.3 藏品：被吃掉的三个身上的装备要**传给合出来的那个**。
          规则：先拼起来、前 2 件装上，多出来的**退回藏品栏**。
          【退回失败怎么办？】只有在"藏品栏 10 格全满 + 三个棋子身上共 6 件装备"
          这种极端情况下才会退不回去；那时候把数量写进 `state.message`
          并在控制台留一条警告。绝不静默丢弃是最低要求，
          但也做不到"无论如何都放得下"—— 所以这里如实记录了它的边界。
        */
        const carriedItems = [...state.economy.bench, ...state.placements]
          .filter((unit) => consumedUids.includes(unit.uid))
          .flatMap((unit) => unit.items ?? []);
        const keptItems = carriedItems.slice(0, ITEM_PER_UNIT);
        const overflowItems = carriedItems.slice(ITEM_PER_UNIT);
        const lostItems = overflowItems.length > 0 ? returnItemsToStorage(state, overflowItems) : [];
        /*
          ★ 0.2：层数要和留下的那几件**一对一**跟着走。
          合成时装备是"先拼起来、前 2 件装上"，所以层数也按同一个顺序取前 2 份 ——
          不能按 itemId 查（两件同名藏品各有各的层数，查 id 就分不清谁是谁）。
        */
        const keptLayers = [...state.economy.bench, ...state.placements]
          .filter((unit) => consumedUids.includes(unit.uid))
          .flatMap((unit) => (unit.items ?? []).map((_, index) => layerAt(unit.itemLayers, index)))
          .slice(0, ITEM_PER_UNIT);

        // 先从两边都摘掉被吃掉的
        state.economy.bench = state.economy.bench.filter((unit) => !consumedUids.includes(unit.uid));
        state.placements = state.placements.filter((p) => !consumedUids.includes(p.uid));

        // ★ 0.2：加价记账跟着 uid 走 —— 旧的三个销号（新的那只在下面 push 完再记）
        for (const oldUid of consumedUids) delete state.paidCostDelta[oldUid];

        const onBoard = boardCells.length > 0;
        const uid = nextUid();
        if (carriedPaidDelta > 0) state.paidCostDelta[uid] = carriedPaidDelta;
        if (onBoard) {
          const target = boardCells[0]!;
          state.placements.push({
            uid,
            defId,
            star: star + 1,
            cell: { col: target.col, row: target.row },
            free: freeFlagFor(star + 1, consumedCopies),
            // ★ 0.2：装备 + 它们各自的层数一起交给合出来的这只
            ...carryUnitItems({ items: keptItems, itemLayers: keptLayers }),
          });
        } else {
          state.economy.bench.push({
            uid,
            defId,
            star: star + 1,
            free: freeFlagFor(star + 1, consumedCopies),
            // ★ 0.2：装备 + 它们各自的层数一起交给合出来的这只
            ...carryUnitItems({ items: keptItems, itemLayers: keptLayers }),
          });
          // 排序让备战席顺序稳定（不影响玩法，但界面不会跳来跳去）
          state.economy.bench.sort((a, b) => a.uid - b.uid);
        }

        reports.push({ defId, star: star + 1, onBoard });
        if (lostItems.length > 0) {
          // 极端情况（见上面 carriedItems 的注释）：藏品栏实在放不下
          console.warn(`[AIRNIGHT] 合成时 ${lostItems.length} 件藏品没地方放：${lostItems.join('、')}`);
        }
        changed = true;
        break; // 重新扫描一遍（可能又凑够了下一档）
      }
      if (changed) break;
    }
  }

  return reports;
}

/**
 * ★ 加上 / 移走这么多份之后，会不会**立刻**触发一次合成？
 *
 * 【为什么需要它？—— 你报的第 3 条："备战席满时合不出三星"】
 * 合成是"吃 3 个吐 1 个"，净腾出 2 格。所以当备战席已经满的时候，
 * 一个"能凑成三个"的操作**不该被容量拦住** —— 拦了它，合成永远没机会发生。
 *
 * @param delta 这次操作会让"同名同星的总数"增加几份
 *              （买棋子是 +1；把场上的收回备战席是 0，因为总数没变，只是换了地方）
 */
function wouldMergeAfter(state: GameState, defId: string, star: number, delta: number): boolean {
  if (star >= 3) return false; // 三星是上限，不会再往上合
  // ★ 0.3.2：按家族 key 数 —— 阿米娅的形态和基础棋子算同一只（升星互通）
  const key = familyKeyOf(defId);
  let count = delta;
  for (const unit of state.economy.bench) {
    if (familyKeyOf(unit.defId) === key && unit.star === star) count++;
  }
  for (const placement of state.placements) {
    if (familyKeyOf(placement.defId) === key && placement.star === star) count++;
  }
  return count >= 3;
}

/** 把合成结果写成一句给玩家看的话 */
export function describeMerges(reports: MergeReport[]): string {
  if (reports.length === 0) return '';
  return reports
    .map((report) => {
      const name = UNIT_DEFS[report.defId]?.name ?? report.defId;
      return `${name} ${report.star} 星${report.onBoard ? '（在场上）' : ''}`;
    })
    .join('、');
}

/**
 * 我手上有几个这个干员（备战席 + 场上）。
 *
 * 【为什么两个地方都要算？】
 * 因为合成规则就是两边一起算的。如果这里只看备战席，
 * 商店卡片的"可升星"提示就会骗人：场上明明站着 2 个，却提示"你一个都没有"。
 * 提示和规则必须用同一个口径 —— 这类"显示和实际不一致"的 bug 最难发现。
 *
 * @param star 限定星级；不传就是所有星级都算
 */
export function countOwned(state: GameState, defId: string, star?: number): number {
  // ★ 0.3.2：按家族 key 数 —— 升变过的阿米娅也要算进"我手上已经有几个"
  const key = familyKeyOf(defId);
  let count = 0;
  for (const unit of state.economy.bench) {
    if (familyKeyOf(unit.defId) === key && (star === undefined || unit.star === star)) count++;
  }
  for (const placement of state.placements) {
    if (familyKeyOf(placement.defId) === key && (star === undefined || placement.star === star)) count++;
  }
  return count;
}

/**
 * ★ 商店卡面右上角那个「已拥有 N」用的数：**按张数折算**。
 *
 * 【折算规则（用户 0.0.3 明确要求）】
 *   1 星算 1 张、2 星算 3 张、3 星算 9 张 —— 就是 `copiesOf(star)`（3^(星级-1)），
 *   也就是"合成这只棋子一共吃掉了多少张同名卡"。
 *   备战席 + 场上都算（和合成、和牌库账目同一个口径）。
 *
 * 【和 countOwned 的区别（别合并）】
 *   · `countOwned`   —— 数**棋子个数**（每个棋子算 1），用来判断"再买一个能不能合成"；
 *   · 这里（按张）    —— 数**牌张数**，玩家看"我已经攒了多少张"，
 *                       和卡片右下角的「牌库还剩 M 张」正好互补（N + M = 这只棋子的总张数）。
 *
 * 【为什么不直接用 poolCopiesOf？】
 *   那个还要看 `free` 标记（修改器白送 / 道具复制出来的份数不算占牌库）。
 *   这里问的是"我拥有几张"，白送的也算我拥有的 —— 所以用纯粹的星级折算。
 */
export function countOwnedCopies(state: GameState, defId: string): number {
  // ★ 0.3.2：家族口径 —— 形态那几张也是"我攒的张数"，否则升变后卡面会写成 0 张
  const key = familyKeyOf(defId);
  let copies = 0;
  for (const unit of state.economy.bench) {
    if (familyKeyOf(unit.defId) === key) copies += copiesOf(unit.star);
  }
  for (const placement of state.placements) {
    if (familyKeyOf(placement.defId) === key) copies += copiesOf(placement.star);
  }
  return copies;
}

/**
 * 牌库视图。
 *
 * 【两种模式，两个来源 —— 这是"牌库互通"的关键】
 *   单机：牌库就是"我自己手上占了多少张"，能直接算出来。
 *   联机：牌库是全房间共享的，只有服务器知道还剩几张，
 *         所以由服务器广播过来，客户端只读不写（见 netplay-client 的 pool 字段）。
 *
 * 不管是哪种，商店刷新和购买判断都只读这一个函数 ——
 * 这样"显示能买"和"实际能买"永远不会不一致。
 */
let netPoolView: Map<string, number> | null = null;

/**
 * ★ 服务器广播的**真实**剩余张数（defId -> 还剩几张），原样不动。
 *
 * 【为什么要有两份视图？—— 这是用户报的一个 bug】
 * 显示在卡片上的"牌库还剩几张"必须读**这一份**。
 * 之前显示读的是 netPoolView（扣掉了"别人商店里预定着的"），于是出现：
 *   别人商店里摆着 1 张 → 我看到 27-1=26；
 *   别人把它买走 → 真实剩余 26，他的预定撤销 → 我看到的还是 26-0=26。
 * 一减一加正好抵消，数字**永远不动** —— 玩家以为"别人买牌牌库没少"。
 * 而"某张牌还剩几张"本来就该是牌库的真实库存，预定只是"我暂时抽不到"，
 * 不该算进库存里。
 */
let netPoolRaw: Map<string, number> | null = null;

/**
 * 联机时由网络层设置（服务器广播的牌库剩余张数）；传 null 回到本地计算。
 *
 * @param held 被"预定"的牌：defId -> 占着它的玩家 id 列表（见协议里的 pool.held）。
 * @param myPlayerId 我自己是谁 —— 我自己商店里摆着的牌不算被占（那是我要买的）。
 *
 * 【为什么要在这里扣掉"别人占着的"？】
 * 牌库里只剩 1 张的棋子，如果同时摆在我和别人的商店里，那就是两个人抢一张：
 * 我先点就我赢，但对方会看到一张"点了就报错"的卡 —— 只会觉得游戏坏了。
 * 所以服务器会把"谁占着哪几张"广播出来，我这里算成
 * "**对我来说**还能刷到几张"，**刷新商店时**读这一份
 * （抽不到别人摆着的那张，就不会出现"看着有货、点了买不到"）。
 *
 * ★ 注意：这一份**只给"刷新商店"用**，显示的数字走 netPoolRaw。
 * 两者分工写死在上面 netPoolRaw 的注释里，别再混用。
 */
export function setNetPoolView(
  remaining: Record<string, number> | null,
  held?: Record<string, string[]> | null,
  myPlayerId = '',
  /**
   * ★★ 0.3.3：把这份视图挂到**某一个具体的 state** 上（而不是全模块共用一份）。
   *
   * 【为什么需要这个参数？—— 人机】
   * 浏览器里一个标签页只有一个玩家，所以上面那两个模块级变量天然是对的。
   * 但人机跑在**服务端进程**里，一个房间里可能有 7 台人机、几个房间同时开 ——
   * 它们共用同一份 `netPoolView` 的话，后更新的会把前面的覆盖掉，
   * 于是各家商店按别人的库存来抽牌（抽到"其实已经没货"的卡，买了被服务器拒），
   * 表现是"人机的钱一直攒着不花"。
   *
   * 不传 = 走模块级变量（客户端所有调用点都不传，行为一个字节不变）。
   */
  target?: GameState,
): void {
  if (!remaining) {
    if (target) target.netPool = null;
    else {
      netPoolRaw = null;
      netPoolView = null;
    }
    return;
  }
  const raw = new Map(Object.entries(remaining));
  const view = new Map(raw);
  if (held) {
    for (const [defId, holders] of Object.entries(held)) {
      const others = holders.filter((id) => id !== myPlayerId).length;
      if (others <= 0) continue;
      view.set(defId, Math.max(0, (view.get(defId) ?? 0) - others));
    }
  }
  if (target) {
    target.netPool = { raw, view };
    return;
  }
  netPoolRaw = raw;
  netPoolView = view;
}

/**
 * 我手上所有的棋子（备战席 + 场上），用来算单机牌库占用。
 *
 * 【★ 为什么**不**把人机的阵容算进来？】
 * 0.0.2 追加的改动：**单机对手的干员不计入牌库、也不影响玩家的牌库**。
 * 之前是"人机手里的牌取自共享牌库"（玩家商店里会真的少几张），
 * 但那样量起来很别扭：玩家看到自己想要的干员"没货了"，
 * 却既看不见对手拿了什么、也没法把牌抢回来 —— 只是单纯被恶心到。
 * 现在牌库只由**玩家自己**的备战席 + 场上决定：
 * 对手拿多少、拿什么，都不再动玩家这一份账。
 *
 * （对手的阵容照样会随回合成长，只是那套成长与玩家的牌库彻底无关了，
 *   见 game/enemy-lineup.ts。）
 */
function ownedUnits(state: GameState): Array<{ defId: string; star: number; free?: boolean | number }> {
  /*
    ★ 0.0.3：**修改器白送的棋子（free）不算牌库占用**。
    它们本来就不是从牌库里抽出来的，记进去会让牌库凭空少几张
    （按"获得干员"几下就把某个干员抽干）。同理卖掉时也不用还（见 doSellBench）。

    ★ 这里**不再整只跳过**，而是把 `free` 原样交给 `copiesHeld`：
    它按 `poolCopiesOf` 算张数（true=0 张 / 数字=只占这么多张）。
    以前的写法是"整只不计入" —— 结果道具免掉的份数被放大成一整只，
    7 张同名干员会一夜之间变成"不占牌库"（用户报的 bug）。
  */
  return [
    ...state.economy.bench.map((u) => ({ defId: u.defId, star: u.star, free: u.free })),
    ...state.placements.map((p) => ({ defId: p.defId, star: p.star, free: p.free })),
  ];
}

/**
 * 当前牌库里"我还能刷到几张"（defId -> 张数）。
 *
 * ★ 只给**刷新商店**用：联机时这里扣掉了"别人商店里预定着的那几张"，
 * 这样刷出来的牌别人一定买得到，不会出现"看得见、点了报错"。
 * **界面显示不要用这个**（用 poolRemainingOf）—— 它比真实库存少，
 * 而且"别人买走"会让它一减一加抵消掉。
 */
export function poolRemaining(state: GameState): Map<string, number> {
  // ★ 0.3.3：人机各自挂在自己 state 上（见 setNetPoolView 的 target 参数）
  const view = state.netPool?.view ?? netPoolView;
  if (view) return view;
  return remainingPool(ownedUnits(state), UNIT_DEFS);
}

/**
 * 某个干员牌库里还剩几张 —— **这是给界面显示用的真实库存**。
 *
 * 【为什么它和 poolRemaining 不是同一个数？】
 * 联机时 `poolRemaining` 扣掉了"别人商店里预定着的牌"（刷新商店的过滤条件），
 * 但卡片上写"还剩几张"必须写牌库的**真实**库存：
 *   · 别人商店里摆着 1 张 -> 库存还是那么多（他只是"占着"，没买）；
 *   · 别人真买走了      -> 库存 -1，我看到的数字也该 -1。
 * 混用的话就会出现用户报的那个现象：别人买走一张，我这边数字纹丝不动。
 */
export function poolRemainingOf(state: GameState, defId: string): number {
  const view = state.netPool?.raw ?? netPoolRaw ?? poolRemaining(state);
  return view.get(defId) ?? poolSizeOf(defId, UNIT_DEFS);
}

/**
 * 卖掉这枚棋子时，该往共享牌库**还几张**（联机用）—— 界面别再自己按星级算。
 *
 * 买来的普通棋子还满份（2★还 3 张、3★还 9 张），
 * 但道具多给的那几张本来就没从牌库拿过，不能还（博士投影升过星的只还 1 张）。
 * 0 = 一张都不用还（修改器白送 / 拟态物质复制出来的）。
 */
export function poolCopiesOfUnit(unit: { star: number; free?: boolean | number }): number {
  return poolCopiesOf(unit);
}

/**
 * 现在能不能操作商店。
 *
 * ============================================================
 *  ★ 为什么战斗中也允许买（你要求的）
 * ============================================================
 * 自走棋的战斗演出有十几秒到一分多钟，这段时间玩家的手是闲着的。
 * 以前商店是灰的，只能干看着 —— 现在可以边看边运营：
 * 买下棋子进备战席，下一回合直接上场。
 *
 * 【★ 0.1.2：`result` 也要放行 —— 那正是最需要商店的一段时间】
 * 联机里 `result` = "我这一场打完了、在等别人看完"（最长能等一分多钟）。
 * 以前这段时间商店整块是灰的：买不了、卖不了、刷新不了、也锁不了，
 * 玩家只能干看着 —— 你报的就是这个。
 * 这段时间动手是安全的：
 *   · 买卖只碰自己的备战席和**共享牌库**（服务器那边见 buyCard/sellCard 的说明）；
 *   · 上阵阵容在开打那一刻就锁死了，动它不影响这一场；
 *   · 下一回合开始前商店本来就会自动刷新一次（锁定按钮就是为这个准备的）。
 *
 * 【那"战斗中也能刷/锁/买经验"呢？】
 * 也放行 —— 它们和买棋子一样只影响"我下一回合的运营"，不改变已经打完/正在播的战斗。
 * 唯一仍然是布阵专属的是**改上阵阵容**（那一动就会改这一场的参战名单）。
 */
export function canShopNow(phase: GameState['phase']): boolean {
  // ★ 0.2：商店回合里当然能买（那就是它存在的意义）
  return phase === 'prep' || phase === 'battle' || phase === 'result' || phase === 'shop';
}

/**
 * ★★ 0.2.1：**已被淘汰 ⇒ 商店整块对他关闭**（用户报的严重 bug）。
 *
 * ============================================================
 *  【唯一判据，所有商店入口都必须过这一关】
 * ============================================================
 * 淘汰时服务器已经把他的手牌全部还回共享牌库（`Room.returnCardsToPool`）。
 * 只要他还买得动，同一张牌就会被卖给第二个人 —— 牌库的账当场错乱，
 * 而且他买的牌永远上不了场（阵容已经清空、也不再有回合）。
 *
 * 所以这里返回 `{ ok:false, message }`，调用方统一写成：
 * ```
 * const blocked = shopBlockedByElimination(state);
 * if (blocked) return blocked;
 * ```
 * ★ 别再在界面层另写一遍"是不是被淘汰了"—— 0.2 的商店回合就是那样漏的
 *   （`main.ts` 的 `eliminatedMe` 只管了常规商店那一排按钮）。
 */
export function shopBlockedByElimination(
  state: GameState,
): { ok: false; message: string } | null {
  if (!state.meEliminated) return null;
  return { ok: false, message: '你已被淘汰，商店已对你关闭' };
}

/**
 * ★★ 0.2.1：**商店回合**对我是不是可用（关闭弹窗 / 开关按钮都读它）。
 *
 * 和 `shopRoundActive` 的区别：那个是"这一回合的商店开着没有"（全局事实），
 * 这个是"**我**能不能进"（淘汰了就不能）。倒计时、`advanceRound` 这些
 * 与"玩家是谁"无关的地方必须继续用 `shopRoundActive`。
 */
export function shopRoundUsable(state: GameState): boolean {
  return shopRoundActive(state) && !state.meEliminated;
}

/**
 * ★ 0.2：能不能**改阵容**（上牌 / 下棋 / 换位 / 收棋 / 上卸藏品）。
 *
 * 【为什么不是 `phase === 'prep'`？—— 用户报的那条】
 * 商店回合（`phase === 'shop'`）本质上只是"在回合之间插了一段买东西的时间"，
 * **没有任何战斗在跑**。所以它和布阵阶段该完全一样：把干员摆上去、收回来、
 * 换位置、给谁装一件藏品、把藏品卸下来 —— 全都该能做。
 *
 * 早先这里写的是 `phase !== 'prep'`，于是商店回合关掉商店界面之后，
 * 棋盘整块变成"点了没反应"（拖动直接被 `beginDrag` 拒绝，棋子放不下去），
 * 玩家只能干等着这 90 秒过去 —— 那就是 bug。
 *
 * 【那 battle / result 呢？】
 * 仍然不许改 —— 那时候有一场仗正在播，改阵容会让"这一场的参战名单"和
 * 画面对不上（这个限制是对的，别顺手也放开）。
 *
 * ★ 这是"能不能改阵容"的**唯一判据**：`state.ts` 里所有阵容操作
 *   和 `main.ts` 里的拖动 / 点击 / 置灰全部调它，别再各写一遍 `!== 'prep'`。
 */
export function canEditTeam(phase: GameState['phase']): boolean {
  return phase === 'prep' || phase === 'shop';
}

/**
 * ★ 0.1.1 藏品二版：「剑锤」这类藏品会让**往后购买干员的花费**变化（+2）。
 *
 * 【为什么要有这一对函数？】
 * 商店里显示的价格和真正扣掉的金币**必须是同一个数**。
 * 早先显示走 `def.cost`、扣钱走 `buyShopSlot` 里的 `def.cost`，
 * 看着是同一个来源；但一旦有了"价格会被藏品改"这回事，
 * 两处各写一遍 `def.cost + delta` 就一定会走散
 * （典型症状：显示 3 金、扣 5 金，或者反过来 —— 玩家只会觉得"这游戏在骗我"）。
 * 所以收成：取值只有 `shopPriceDelta` / `shopPriceOf`，扣钱把它交给 `buyShopSlot`。
 *
 * 【算的是哪些藏品？】
 * 共享装备位里的 + 场上/备战席干员身上挂着的（见 `shopCostDelta`）。
 * 只算**装载中**的 —— 躺在存放栏里的不算（设计稿写的是"装载后"）。
 */
export function shopPriceDelta(state: GameState): number {
  const equipped: string[][] = [
    ...state.placements.map((placement) => [...equippedItemIds(placement)]),
    ...state.economy.bench.map((unit) => [...equippedItemIds(unit)]),
  ];
  return shopCostDelta(state.items, equipped);
}

/** 某只干员此刻在商店里的**实际**价格（面板价 + 藏品带来的变化） */
export function shopPriceOf(state: GameState, def: { cost: number }): number {
  return Math.max(0, def.cost + shopPriceDelta(state));
}

/** 买下商店里的某一格 */
export function doBuyShopSlot(state: GameState, slotIndex: number): { ok: boolean; message: string } {
  // ★ 0.2.1：淘汰的人一律不能碰商店
  const blocked = shopBlockedByElimination(state);
  if (blocked) return blocked;
  if (!canShopNow(state.phase)) return { ok: false, message: '现在不能购买' };
  const goldBefore = state.economy.gold;
  const slot = state.economy.shop[slotIndex];
  const def = slot ? UNIT_DEFS[slot.defId] : undefined;
  const costDelta = Math.max(0, shopPriceDelta(state));
  const result = buyShopSlot(state.economy, slotIndex, nextUid, UNIT_DEFS, {
    remaining: poolRemaining(state),
    // 备战席满但这一买能立刻凑成三个 -> 放行（见 buyShopSlot 的 allowFullBench 说明）
    allowFullBench: def ? wouldMergeAfter(state, def.id, 1, 1) : false,
    // ★ 0.1.1：剑锤那种"装载后购买干员 +2 花费"（显示价和扣钱走同一个来源）
    costDelta,
  });

  // 失败时必须把**失败原因**原样返回。
  // 曾经这里统一 return state.message，结果"金币不够"被换成了上一句提示 ——
  // 玩家看到"点下方商店买干员"，完全不知道发生了什么。
  if (!result.ok) return result;

  /*
    ★ 0.2：记下"这一枚买的时候多付了几金"。
    卖出时按"购买价"返还（用户口径），所以这笔账必须留住 ——
    `buyShopSlot` 刚把新棋子 push 到备战席末尾，这里取它。
  */
  recordPaidDelta(state, costDelta);

  // 买完立刻检查合成（备战席 + 场上一起看）—— 合成会把加价求和到新的 uid
  const merged = mergeAllUnits(state);
  /*
    ★★ 0.3.1 修：盟约「通关奖励」（绮良）要数**所有花出去的钱**，
    而买干员是最常见的一笔 —— 以前只有"刷新 / 买经验 / 商店回合买藏品"记了账，
    这条路径漏了 ⇒ 玩家一直在买棋子，50 金的进度却几乎不动，
    看上去就是"这个盟约没生效"。记账必须在 topUp 之前（测试模式会补满金币）。
  */
  const spendNote = noteCovenantSpending(state, goldBefore - state.economy.gold);
  const baseText =
    merged.length > 0 ? `${result.message}，并合成 ${describeMerges(merged)}！` : result.message;
  state.message = spendNote ? `${baseText} · ${spendNote}` : baseText;
  topUpGoldIfTestMode(state);
  return { ok: true, message: state.message };
}

/**
 * ★ 0.2：给"刚买进来的那枚棋子"记下多付的金币。
 *
 * ★ 必须**紧接在购买之后**调用（那时新棋子是备战席最后一个）——
 *   合成、上阵、收回之后位置就变了，那时候再找就找不到是谁了。
 */
function recordPaidDelta(state: GameState, delta: number): void {
  if (delta <= 0) return;
  const bought = state.economy.bench[state.economy.bench.length - 1];
  if (!bought) return;
  state.paidCostDelta[bought.uid] = delta;
}

/**
 * 「服务器已经批准了这次购买」之后，本地真正把棋子收下。
 *
 * 【为什么单独一个函数？】
 * 联机时买牌要先问服务器（牌库共享，不能三个人同时买到最后一张）。
 * 服务器回了 ok 之后，本地要做的事和 doBuyShopSlot 一模一样，
 * 只差"不再检查牌库"——因为服务器已经替我们扣掉了那一张。
 * 如果这里还按本地（可能已经过时的）牌库视图再检查一次，
 * 就会出现"服务器说能买、客户端说没货"的诡异状态。
 */
export function applyApprovedBuy(
  state: GameState,
  slotIndex: number,
): { ok: boolean; message: string } {
  /*
    ★★ 0.1.3：这里原来写的是 `state.phase !== 'prep'`，于是**联机里战斗中买不了牌**。
    联机的购买走的是两条腿：先问服务器（`buyCard`），服务器同意后回到这里落地。
    而"战斗/结算也能买"那条规则（用户要求）只加在了本地那条腿（`doBuyShopSlot`
    走 `canShopNow`）—— 这条腿还卡在"只有布阵能买"上。

    症状特别隐蔽，而且很难自己看出原因：服务器**已经把牌扣掉、金币也按规则算好了**，
    客户端却在这里拒绝落地，然后把牌还回去、弹一句"战斗进行中不能购买"。
    玩家看到的就是"刷新、锁定、买经验都能用，唯独买干员不行"。

    所以闸门必须和本地那条腿**读同一个函数**，别再写第二遍阶段判断。
  */
  // ★ 0.2.1：淘汰的人一律不能碰商店（服务器已经批准也不行 ——
  //   他买进来的牌永远上不了场，还会占着牌库的份数）
  const blocked = shopBlockedByElimination(state);
  if (blocked) return blocked;
  if (!canShopNow(state.phase)) return { ok: false, message: '现在不能购买' };
  const goldBefore = state.economy.gold;
  const slot = state.economy.shop[slotIndex];
  const def = slot ? UNIT_DEFS[slot.defId] : undefined;
  const costDelta = Math.max(0, shopPriceDelta(state));
  // remaining 传 undefined = 跳过牌库检查（服务器已经批准）
  const result = buyShopSlot(state.economy, slotIndex, nextUid, UNIT_DEFS, {
    allowFullBench: def ? wouldMergeAfter(state, def.id, 1, 1) : false,
    // ★ 0.1.1：同上 —— 已批准的那次购买也要按同一个价格扣钱
    costDelta,
  });
  if (!result.ok) return result;
  // ★ 0.2：这条腿也要记账（否则联机里卖了只退面板价）
  recordPaidDelta(state, costDelta);
  const merged = mergeAllUnits(state);
  // ★ 0.3.1：联机这条腿同样要记「通关奖励」的花费（见 doBuyShopSlot 里的说明）
  const spendNote = noteCovenantSpending(state, goldBefore - state.economy.gold);
  const baseText =
    merged.length > 0 ? `${result.message}，并合成 ${describeMerges(merged)}！` : result.message;
  state.message = spendNote ? `${baseText} · ${spendNote}` : baseText;
  topUpGoldIfTestMode(state);
  return { ok: true, message: state.message };
}

/**
 * 卖掉备战席上的棋子。
 *
 * ★ 0.0.3 藏品：棋子身上的装备必须先摘下来还回藏品栏（不能跟着棋子一起消失）。
 *   所以要在调用 `sellBenchUnit` **之前**读装备 —— 那个函数会把棋子从备战席摘掉。
 */
export function doSellBench(state: GameState, uid: number): { ok: boolean; message: string } {
  /*
    ★ 0.1.1：战斗阶段也能卖棋子（用户要求"商店功能不受战斗状态限制"）。
    【为什么卖棋子是安全的？】
    卖的是**备战席**里的东西，而场上的阵容在开打那一刻就锁死了
    （`state.placements` 不会被卖牌改到），所以这一场战斗的结果不受影响 ——
    和"战斗中也能买"是同一条道理（买进来的也只是进备战席）。
    真正不能动的是**上场阵容**，那几条闸门（movePlacement 等）保持原样。
  */
  // ★ 0.2.1：淘汰的人一律不能碰商店
  const blocked = shopBlockedByElimination(state);
  if (blocked) return blocked;
  if (!canShopNow(state.phase)) return { ok: false, message: '战斗进行中不能卖棋子' };
  const equipped = [...equippedItemIds(state.economy.bench.find((unit) => unit.uid === uid) ?? {})];
  /*
    ★ 0.2：带上"这枚棋子当时多付了几金"（剑锤），卖出时一起退 —— 用户口径
    "吃到剑锤效果的干员在售卖时也是购买时的价格"。
  */
  const paidDelta = state.paidCostDelta[uid] ?? 0;
  /*
    ★ 0.3.2：升变形态不能出售 —— **但测试模式除外**（用户口径：
      这条限制只做在单机正常对局和多人模式里，修改器那个沙盒要能卖掉换阵容）。
  */
  const result = sellBenchUnit(state.economy, uid, UNIT_DEFS, paidDelta, {
    allowAscendForm: state.testMode,
  });
  if (result.ok) {
    delete state.paidCostDelta[uid];
    if (state.selectedBenchUid === uid) state.selectedBenchUid = null;
    const leftover = returnItemsToStorage(state, equipped);
    state.message =
      leftover.length > 0
        ? `${result.message}；藏品栏满了，${leftover.length} 件装备没地方放`
        : result.message;
  }
  topUpGoldIfTestMode(state);
  return result;
}

// ============================================================
// 棋盘操作
// ============================================================

/** 选中备战席上的某个棋子 */
export function selectBench(state: GameState, uid: number): void {
  state.selectedBenchUid = state.selectedBenchUid === uid ? null : uid;
  const unit = state.economy.bench.find((u) => u.uid === uid);
  if (state.selectedBenchUid !== null && unit) {
    const def = UNIT_DEFS[unit.defId];
    state.message = `选中 ${def?.name ?? unit.defId}，点场上的格子（左半边）放下去`;
  } else {
    state.message = '取消选择';
  }
}

/**
 * 还能不能再往场上放一个棋子 —— 人口上限的**唯一**判定入口。
 *
 * ★ 0.0.3 修改器：「无视人口上限」开着时永远为 true。
 * 拖拽高亮、点击落子、拖拽落点都要读这一份 ——
 * 各自再抄一遍 `length < popCap(...)` 就会出现"改了一处漏了另一处"。
 */
export const canAddUnit = (state: GameState): boolean =>
  state.ignorePopCap || state.placements.length < popCap(state);

/**
 * 把**指定的**备战席棋子放到场上（拖拽 / 点选两条路共用的**唯一**实现）。
 *
 * ============================================================
 *  ★ 0.0.3 修复：这个函数是从 placeSelected 里抽出来的
 * ============================================================
 * 原来 `main.ts` 的拖拽落子自己另写了一份长得差不多的逻辑，于是修改器的
 * 两个特性只补在了 state 层这份上，拖拽那条路全漏：
 *   · 拖上场的棋子**丢了 `free` 标记** → 白送的干员开始占牌库，
 *     送得越多牌库被抽得越干（就是你报的"修改出大量后刷不出这张牌"）；
 *   · 拖拽**不认「无视人口上限」** → 开关打开了照样被人口拦住。
 * 两条路必须共用同一份实现，这类"补了一处、漏了另一处"才不会再来。
 *
 * 成功时会把"选中着的正是它"这个状态清掉（它已经不在备战席了）。
 * 除此之外不碰任何别的状态。
 *
 * ============================================================
 *  ★ 目标格子有人时**互换**，而不是"放不上去"（你要求的）
 * ============================================================
 * 【为什么这么改？】
 * 以前的反应是"这个格子已经有人了"，你得先右键把人收回备战席、
 * 再点一次放上去 —— 三下操作做一件本来就是一步的事。
 * 自走棋里换位是最频繁的动作，多两下就是"手感很差"。
 *
 * 【为什么不算"人口超了"？】
 * 互换是**场上数量不变**的操作（一个下去、一个上来），
 * 所以不该受人口上限影响。不然第 5 个棋子想跟第 1 个换位都会被拦住。
 * 人口上限只在"净增加"的时候检查。
 */
export function placeBenchUnitAt(
  state: GameState,
  uid: number,
  cell: Cell,
): { ok: boolean; message: string } {
  if (!canEditTeam(state.phase)) return { ok: false, message: '战斗进行中不能改阵容' };
  if (!isSideCell(state.side, cell)) return { ok: false, message: sidePlacementHint(state.side) };

  const index = state.economy.bench.findIndex((u) => u.uid === uid);
  if (index < 0) return { ok: false, message: '这个棋子已经不在备战席了' };
  const unit = state.economy.bench[index]!;
  const def = UNIT_DEFS[unit.defId];

  // ---- 目标格子有人：互换 ----
  const occupiedIndex = state.placements.findIndex(
    (p) => p.cell.col === cell.col && p.cell.row === cell.row,
  );
  if (occupiedIndex >= 0) {
    const swapped = state.placements[occupiedIndex]!;
    // 场上的那个回备战席（占掉本来要被移走的那个位置）
    state.economy.bench.splice(index, 1, {
      uid: swapped.uid,
      defId: swapped.defId,
      star: swapped.star,
      free: swapped.free || undefined,
      ...carryUnitItems(swapped),
    });
    state.placements[occupiedIndex] = {
      uid: unit.uid,
      defId: unit.defId,
      star: unit.star,
      cell: { ...cell },
      free: unit.free || undefined,
      ...carryUnitItems(unit),
    };
    // 这个棋子已经不在备战席了，选中状态不能留着（换位也一样）
    if (state.selectedBenchUid === uid) state.selectedBenchUid = null;

    // 换位也可能凑成三个（把场上的换下来之后备战席上刚好凑齐）
    const merged = mergeAllUnits(state);
    const swappedDef = UNIT_DEFS[swapped.defId];
    state.message =
      merged.length > 0
        ? `${def?.name ?? unit.defId} 与 ${swappedDef?.name ?? swapped.defId} 互换，并合成 ${describeMerges(merged)}！`
        : `${def?.name ?? unit.defId} 与 ${swappedDef?.name ?? swapped.defId} 互换了位置`;
    return { ok: true, message: state.message };
  }

  const cap = popCap(state);
  // ★ 0.0.3：修改器开了「无视人口上限」就直接跳过这道检查（见 canAddUnit）
  if (!canAddUnit(state)) {
    return { ok: false, message: `人口已满（当前等级 ${state.economy.level} 级，上限 ${cap}）—— 先升级` };
  }

  state.economy.bench.splice(index, 1);
  state.placements.push({
    uid: unit.uid,
    defId: unit.defId,
    star: unit.star,
    cell: { ...cell },
    free: unit.free || undefined,
    ...carryUnitItems(unit),
  });
  // 这个棋子已经不在备战席了，选中状态不能留着
  if (state.selectedBenchUid === uid) state.selectedBenchUid = null;

  // 放上去之后场上可能终于凑够三个了 —— 也要检查合成
  const merged = mergeAllUnits(state);
  state.message =
    merged.length > 0
      ? `${def?.name ?? unit.defId} 上场，并合成 ${describeMerges(merged)}！`
      : `${def?.name ?? unit.defId} 上场了`;
  return { ok: true, message: state.message };
}

/**
 * ============================================================
 *  ★ 0.3.4「开战自动补位」
 * ============================================================
 *
 * 【为什么要有】人口没上满就开战，等于白扔几个人 —— 尤其是新手，
 * 备战席里攒了一堆、场上只放了两个。开打那一刻自动把剩下的补上去。
 *
 * 【落点优先级：**中心 · 后方**】（用户口径原话）
 *   · 「后方」= 远离敌人的那一列。蓝方（side 0）在左半边，敌方在右半边，
 *     所以后方 = col 0；红方反过来，后方 = col 9。
 *   · 「中心」= 行方向的中间（10 行 ⇒ 第 4、5 行最靠中），再往两边对称展开。
 *   ⇒ 于是填充顺序是「先竖着把最后面一列从中间往外填满，再往前推一列」。
 *
 * 【为什么用 `placeBenchUnitAt` 而不是自己 push】
 *   免费标记（`free`）、棋子身上的藏品、三合一，全都只在那一个函数里处理。
 *   这里再写一份，就又会出现"补位上去的棋子丢了藏品"这种漏。
 *
 * 【谁来放】按「星级 → 费用 → uid」挑，先把最能打的顶上去。
 *   同一档里用 uid 兜底排序，保证同样局面每次结果一样（可复现）。
 */
export function autoFillCellOrder(side: 0 | 1): Cell[] {
  const back = side === 0 ? 0 : BOARD_W - 1;
  const step = side === 0 ? 1 : -1;
  const centerRow = (BOARD_H - 1) / 2;
  const rows: number[] = [];
  for (let r = 0; r < BOARD_H; r++) rows.push(r);
  // 越靠中间越先：|r - 4.5| 小在前，同距时上边的先（看着像从中间往外铺开）
  rows.sort((a, b) => Math.abs(a - centerRow) - Math.abs(b - centerRow) || a - b);

  const out: Cell[] = [];
  for (let k = 0; k < ARENA_W; k++) {
    const col = back + step * k;
    for (const row of rows) out.push({ col, row });
  }
  return out;
}

/** 自动补位时挑谁上场：星级高 → 费用高 → uid 小（全是确定性排序） */
function pickBenchUnitForAutoFill(state: GameState) {
  const bench = state.economy.bench;
  if (bench.length === 0) return undefined;
  return [...bench].sort((a, b) => {
    if (b.star !== a.star) return b.star - a.star;
    const costA = UNIT_DEFS[a.defId]?.cost ?? 0;
    const costB = UNIT_DEFS[b.defId]?.cost ?? 0;
    if (costB !== costA) return costB - costA;
    return a.uid - b.uid;
  })[0];
}

/**
 * 把备战席的干员按人口上限自动补到场上，返回补了几个。
 * 战斗阶段 / 已淘汰 / 人口已满 / 备战席为空 —— 全都是（安静地）什么都不做。
 */
export function autoFillBoardFromBench(state: GameState): number {
  if (!canEditTeam(state.phase)) return 0;
  let placed = 0;

  // 每放一个就重算一次空位：合成 / 三合一都可能改变场上的占用情况
  while (canAddUnit(state)) {
    const occupied = new Set(state.placements.map((p) => `${p.cell.col},${p.cell.row}`));
    const target = autoFillCellOrder(state.side).find((c) => !occupied.has(`${c.col},${c.row}`));
    if (!target) break;

    const unit = pickBenchUnitForAutoFill(state);
    if (!unit) break;

    const before = state.placements.length;
    const result = placeBenchUnitAt(state, unit.uid, target);
    if (!result.ok) break;
    // 没真的加上去（理论上不会发生，但别留死循环的口子）
    if (state.placements.length <= before) break;
    placed++;
  }

  return placed;
}

/**
 * 把选中的备战席棋子放到场上（**点击**那条路）。
 * 真正的活儿都在 `placeBenchUnitAt` 里，这里只负责"选中的是谁"。
 */
export function placeSelected(state: GameState, cell: Cell): { ok: boolean; message: string } {
  if (!canEditTeam(state.phase)) return { ok: false, message: '战斗进行中不能改阵容' };
  if (state.selectedBenchUid === null) return { ok: false, message: '先点一个备战席上的干员' };

  const uid = state.selectedBenchUid;
  if (!state.economy.bench.some((u) => u.uid === uid)) {
    state.selectedBenchUid = null;
    return { ok: false, message: '这个棋子已经不在备战席了' };
  }

  // 放下成功后"取消选中"由 placeBenchUnitAt 负责（它是真正把它搬走的那一步）
  return placeBenchUnitAt(state, uid, cell);
}

/** 把场上的棋子收回备战席 */
export function recallFromBoard(state: GameState, cell: Cell): { ok: boolean; message: string } {
  if (!canEditTeam(state.phase)) return { ok: false, message: '战斗进行中不能改阵容' };
  const index = state.placements.findIndex((p) => p.cell.col === cell.col && p.cell.row === cell.row);
  if (index < 0) return { ok: false, message: '这个格子是空的' };

  // 备战席满了也允许收回 —— 只要这一收能立刻凑成三个（合成会腾出格子）。
  // 不这样做的话，"场上第 3 个 + 备战席 2 个"这种正好能升星的局面会被容量拦死。
  const occupied = state.placements[index]!;
  if (state.economy.bench.length >= BENCH_SLOTS) {
    const willMerge = occupied.star < 3 && (() => {
      let count = 0;
      for (const unit of state.economy.bench) {
        if (unit.defId === occupied.defId && unit.star === occupied.star) count++;
      }
      for (const placement of state.placements) {
        if (placement.defId === occupied.defId && placement.star === occupied.star) count++;
      }
      return count >= 3;
    })();
    if (!willMerge) {
      return { ok: false, message: `备战席满了（${BENCH_SLOTS} 格）` };
    }
  }

  const placement = state.placements[index]!;
  state.placements.splice(index, 1);
  state.economy.bench.push({
    uid: placement.uid,
    defId: placement.defId,
    star: placement.star,
    free: placement.free || undefined,
    ...carryUnitItems(placement),
  });

  // 收回之后可能凑够了三个，触发合成（备战席 + 场上一起看）
  const merged = mergeAllUnits(state);
  const def = UNIT_DEFS[placement.defId];
  state.message =
    merged.length > 0
      ? `${def?.name ?? placement.defId} 收回备战席，并合成 ${describeMerges(merged)}！`
      : `${def?.name ?? placement.defId} 收回备战席`;
  return { ok: true, message: state.message };
}

/**
 * 把场上的一个棋子拖到另一个格子。
 *
 * 【两种情况】
 *   目标格是空的   -> 直接移过去
 *   目标格有棋子   -> **交换位置**（这是玩家拖拽时最自然的期待）
 *
 * 【为什么不直接禁止拖到有棋子的格子上？】
 * 因为那会让「调整前后排站位」变得很别扭 ——
 * 你想把前排的坦克和后排的输出对调，就必须先收回一个、再放一个、再放回来。
 * 交换位置是自走棋的标配操作。
 */
export function movePlacement(state: GameState, from: Cell, to: Cell): { ok: boolean; message: string } {
  if (!canEditTeam(state.phase)) return { ok: false, message: '战斗进行中不能改阵容' };

  const fromIndex = state.placements.findIndex((p) => p.cell.col === from.col && p.cell.row === from.row);
  if (fromIndex < 0) return { ok: false, message: '这个格子是空的' };

  if (!isSideCell(state.side, to)) return { ok: false, message: sidePlacementHint(state.side) };
  if (from.col === to.col && from.row === to.row) {
    return { ok: false, message: '没有移动' };
  }

  const moving = state.placements[fromIndex]!;
  const targetIndex = state.placements.findIndex((p) => p.cell.col === to.col && p.cell.row === to.row);

  if (targetIndex < 0) {
    // 目标格是空的：直接移过去
    moving.cell = { ...to };
    const def = UNIT_DEFS[moving.defId];
    return { ok: true, message: `${def?.name ?? moving.defId} 移到了新位置` };
  }

  // 目标格有人：交换
  const other = state.placements[targetIndex]!;
  const temp = { ...other.cell };
  other.cell = { ...moving.cell };
  moving.cell = temp;

  const defA = UNIT_DEFS[moving.defId];
  const defB = UNIT_DEFS[other.defId];
  return {
    ok: true,
    message: `${defA?.name ?? moving.defId} 和 ${defB?.name ?? other.defId} 交换了位置`,
  };
}

/**
 * 备战席内部自由换位（0.0.2 新增，需求第 10 条）。
 *
 * ============================================================
 *  【为什么要做这个？】
 * ============================================================
 * 以前备战席的顺序是**购买顺序**，玩家改不了。看起来只是个排序问题，
 * 但实战里很烦：想留的那两个（准备合成）中间夹着别的棋子时，
 * 你得靠"卖 / 买"来挪位置，甚至根本挪不动。
 * 而且它和"把场上的棋子收回备战席"是同一件事的两面 —— 那一半也改了
 * （见 moveBoardToBenchSlot），拖回去时能指定放到第几格。
 *
 * 【为什么是"交换"而不是"插入后整体后移"？】
 * 因为场上拖拽（movePlacement / placeSelected）一律是**交换**语义，
 * 备战席要是用另一套，玩家就得记两种规则。统一成交换最省心。
 *
 * 【备战席是"紧凑"的 —— 末尾之外没有空洞】
 * bench 的长度就是棋子数，中间不会出现空槽。
 * 所以拖到"空格子"（下标 >= 长度）统一理解成"放到最后"。
 * 这样不用处理稀疏数组，合成扫描、满席判断都不用改。
 */
export function reorderBench(
  state: GameState,
  uid: number,
  targetIndex: number,
): { ok: boolean; message: string } {
  if (!canEditTeam(state.phase)) return { ok: false, message: '战斗进行中不能改阵容' };

  const bench = state.economy.bench;
  const from = bench.findIndex((u) => u.uid === uid);
  if (from < 0) return { ok: false, message: '这个棋子已经不在备战席了' };

  const to = Math.max(0, Math.min(Math.floor(targetIndex), BENCH_SLOTS - 1));
  if (to === from) return { ok: false, message: '没有移动' };

  const unit = bench[from]!;
  const def = UNIT_DEFS[unit.defId];
  const name = def?.name ?? unit.defId;

  // 目标格有人：交换（和场上拖拽同一套规则）
  if (to < bench.length) {
    const other = bench[to]!;
    bench[from] = other;
    bench[to] = unit;
    const otherDef = UNIT_DEFS[other.defId];
    state.message = `${name} 和 ${otherDef?.name ?? other.defId} 换了位置`;
    return { ok: true, message: state.message };
  }

  // 目标格是空的（在下标范围之外）：移到最后一个位置
  bench.splice(from, 1);
  bench.push(unit);
  state.message = `${name} 移到了备战席末尾`;
  return { ok: true, message: state.message };
}

/**
 * 把场上的棋子拖到**指定的备战席格子**（0.0.2 新增，需求第 10 条的后半句）。
 *
 * 【和 recallFromBoard 的区别】
 * recallFromBoard 只会"追加到备战席末尾"，玩家拖到第 2 格结果落在第 7 格，
 * 看起来就像"拖不准"。这里按落点走：
 *   · 落点是已有棋子 -> 交换（人数不变，所以不受备战席容量限制）
 *   · 落点是空格子   -> 收回并放到末尾（备战席是紧凑数组，见 reorderBench）
 *
 * 【为什么交换不受"备战席满了"限制？】
 * 满席时根本不存在空格子，所以唯一的可能是交换 —— 交换不增加任何一边的数量，
 * 和 placeSelected 里"场上互换不算人口超了"是同一条道理。
 */
export function moveBoardToBenchSlot(
  state: GameState,
  from: Cell,
  targetIndex: number,
): { ok: boolean; message: string } {
  if (!canEditTeam(state.phase)) return { ok: false, message: '战斗进行中不能改阵容' };

  const index = state.placements.findIndex((p) => p.cell.col === from.col && p.cell.row === from.row);
  if (index < 0) return { ok: false, message: '这个格子是空的' };

  const bench = state.economy.bench;
  const to = Math.max(0, Math.min(Math.floor(targetIndex), BENCH_SLOTS - 1));
  const placement = state.placements[index]!;
  const def = UNIT_DEFS[placement.defId];
  const name = def?.name ?? placement.defId;

  // 落点是已有棋子：交换（场上这个下去、备战席那个上来，位置对调）
  if (to < bench.length) {
    const other = bench[to]!;
    if (other.uid === placement.uid) return { ok: false, message: '没有移动' };
    bench[to] = {
      uid: placement.uid,
      defId: placement.defId,
      star: placement.star,
      free: placement.free || undefined,
      ...carryUnitItems(placement),
    };
    state.placements[index] = {
      uid: other.uid,
      defId: other.defId,
      star: other.star,
      cell: { ...placement.cell },
      free: other.free || undefined,
      ...carryUnitItems(other),
    };
    const merged = mergeAllUnits(state);
    const otherDef = UNIT_DEFS[other.defId];
    state.message =
      `${name} 与 ${otherDef?.name ?? other.defId} 对调了位置` +
      (merged.length > 0 ? `，并合成 ${describeMerges(merged)}！` : '');
    return { ok: true, message: state.message };
  }

  // 落点是空格子：收回备战席（满了就拦住）
  if (bench.length >= BENCH_SLOTS) {
    return { ok: false, message: `备战席满了（${BENCH_SLOTS} 格）` };
  }
  state.placements.splice(index, 1);
  bench.push({
    uid: placement.uid,
    defId: placement.defId,
    star: placement.star,
    free: placement.free || undefined,
    ...carryUnitItems(placement),
  });
  const merged = mergeAllUnits(state);
  state.message =
    `${name} 收回备战席` + (merged.length > 0 ? `，并合成 ${describeMerges(merged)}！` : '');
  return { ok: true, message: state.message };
}

/** 清空场上所有棋子（收回备战席） */
export function clearBoard(state: GameState): { ok: boolean; message: string } {
  if (!canEditTeam(state.phase)) return { ok: false, message: '战斗进行中不能改阵容' };
  const count = state.placements.length;

  /*
    ★ 这里原来有个"悄悄弄丢棋子"的坑。
    老写法是"备战席满了就 break"，然后把 `state.placements = []` 一赋 ——
    于是备战席没塞下的那些棋子**直接从游戏里消失了**，玩家也不会收到任何提示。
    现在改成：
      1. 一个一个搬，备战席满就**先合一次成**（合成腾格子）；
      2. 合成也腾不出格子的，**留在场上**，绝不删除。
    这条规则和第 3 条（满席也能合三星）是同一件事的两面：
    容量只该挡"净增加"，不该挡"能腾出格子的操作"。
  */
  const queue = state.placements.slice();
  state.placements = [];
  const leftover: typeof queue = [];
  for (const unit of queue) {
    if (state.economy.bench.length >= BENCH_SLOTS) {
      mergeAllUnits(state); // 场上此刻是空的，合成只会把结果落到备战席
      if (state.economy.bench.length >= BENCH_SLOTS) {
        leftover.push(unit);
        continue;
      }
    }
    state.economy.bench.push({
      uid: unit.uid,
      defId: unit.defId,
      star: unit.star,
      free: unit.free || undefined,
      ...carryUnitItems(unit),
    });
  }
  // 实在放不下的留回场上（原位），不要让玩家平白损失棋子
  for (const unit of leftover) state.placements.push(unit);

  const merged = mergeAllUnits(state);
  const movedCount = count - leftover.length;
  if (leftover.length > 0) {
    state.message =
      `备战席放不下，收回 ${movedCount} 个，场上还留着 ${leftover.length} 个` +
      (merged.length > 0 ? `，并合成 ${describeMerges(merged)}` : '');
  } else {
    state.message =
      merged.length > 0 ? `收回 ${count} 个干员，并合成 ${describeMerges(merged)}` : `收回 ${count} 个干员`;
  }
  return { ok: true, message: state.message };
}

// ============================================================
// 藏品（装备）★ 0.0.3
// ============================================================
/*
  【和羁绊的分工】
  羁绊是"场上摆了谁"推出来的；藏品是"玩家手上有什么、装在谁身上"推出来的。
  两者最后都汇进 `toTeamSetup` 的 TeamSetup 里 —— 战斗内核看到的永远只是
  "属性 + 机制"，它完全不知道"藏品"这个概念（和它不知道"羁绊"一样）。

  【为什么 A 类藏在干员身上、B 类住在藏品栏？】
  A 类的作用对象就是"那一个干员"，所以它必须跟着棋子走
  （备战席 <-> 场上、互换、合成、卖掉都带着它）；
  B 类的作用对象是全队，它跟着**玩家**走，和棋子无关。

  【能不能在战斗里装？】
  可以。战斗一旦开打就是一份**快照**（种子重放），
  中途改阵容 / 装藏品不会改变正在播的这场战斗，
  所以允许它只有好处（打的时候手是闲着的）——和"战斗中也能买棋子"同一条理由。
*/

/** 能被装藏品的棋子（备战席和场上都算） */
interface ItemTarget {
  uid: number;
  defId: string;
  star: number;
  /** 占牌库几张（见 Placement.free） */
  free?: boolean | number;
  items?: string[];
  /** ★ 0.2：和 `items` 同下标的逐副本层数（见 Placement.itemLayers） */
  itemLayers?: number[];
}

/**
 * 藏品「失落之钥」的两个数值。
 *
 * 【为什么放在这里，而不是 item-data.ts？】
 * 因为它不是一个"藏品属性"，而是**经济规则**的一部分 ——
 * 它要改的是 `buyXp` 那条路（发多少经验、什么时候给满级奖励），
 * 而那条路只住在状态层。放在数据表里反而会变成"数据定义了但没人读"。
 */
/** 花金币买经验时额外多给几点经验 */
export const LOST_KEY_BONUS_XP = 1;
/** 到满级那一刻一次性给多少金币 */
export const LOST_KEY_MAX_LEVEL_GOLD = 50;

/**
 * 搬运棋子时复制一份它身上的装备。
 *
 * ★ 这个函数存在的唯一理由就是"**别漏**"：
 *   棋子在场上的每一处重建（备战席<->场上、互换、收回、清空）都必须带上 items，
 *   漏掉任何一条路径，那个棋子身上的装备就会**凭空消失**。
 *   所以统一走这一个函数，而不是在十个地方各写一遍 `items: unit.items`。
 */
function carryItems(items?: string[]): string[] | undefined {
  return items && items.length > 0 ? [...items] : undefined;
}

/**
 * ★ 0.2：让 `bEquipLayers` 和 `bEquip` **等长**（缺的补 0、多的截掉）。
 *
 * 【为什么要它？】共享装备位的层数是**按格子下标**记的（第 2 格 5 层 = `bEquipLayers[1]`），
 * 所以两个数组一旦错位，层数就会跑到隔壁那件藏品头上 —— 而这种错误不会报错。
 * 每次动 `bEquip` 之前调一下，代价是 4 个数字的数组拷贝，可以忽略。
 */
function ensureEquipLayers(state: GameState): void {
  const source = state.items.bEquipLayers;
  state.items.bEquipLayers = Array.from({ length: state.items.bEquip.length }, (_, index) =>
    layerAt(source, index),
  );
}

/**
 * ★ 0.2：搬运棋子时把**装备和它的层数一起**搬。
 *
 * 【为什么不能只搬 items？】
 * 层数现在是**逐副本**记的（`items[i]` ↔ `itemLayers[i]`）。
 * 只搬装备不搬层数，棋子从场上收回来、或者跟别人换位，层数就静默归零了 ——
 * 玩家看到的是"我明明攒了 5 层，挪一下就没了"。
 *
 * 和 `carryItems` 一样，这个函数存在的理由就是"别漏"：
 * 每一处重建棋子都写 `...carryUnitItems(unit)`，只写一处就不会漏。
 */
function carryUnitItems(unit: { items?: string[]; itemLayers?: number[] }): {
  items?: string[];
  itemLayers?: number[];
} {
  const items = carryItems(unit.items);
  if (!items) return {};
  const layers = normalizeLayers(items, unit.itemLayers);
  // 全是 0 层就不写这个字段（老数据、没成长过的棋子都走这条，省得上报体积变大）
  return { items, itemLayers: layers.some((n) => n > 0) ? layers : undefined };
}

/**
 * ★ 0.1.4：把服务器回来的"藏品栏快照"还原成一个定长格子数组。
 *
 * 【为什么不能直接把数组赋回去？】
 * 那份数据是**原始输入**（客户端上报 → 服务器存 → 原样发回），
 * 中间隔着一次网络和可能的版本差异，所以逐格校验：
 *   · 不是数组 / 长度不对 → 一律按本版本的规格重建成空栏（多了截断、少了补 null）；
 *   · 格子里必须是**真实存在**的藏品 id，别的一律当空格
 *     （挡掉手改数据、以及"某个藏品被删掉之后的老存档"）。
 */
function restoreSlotArray(raw: (string | null)[] | undefined, size: number): ItemSlotRef[] {
  const out = new Array<ItemSlotRef>(size).fill(null);
  if (!Array.isArray(raw)) return out;
  for (let index = 0; index < size; index++) {
    const id = raw[index];
    if (typeof id === 'string' && ITEM_DEFS[id]) out[index] = id;
  }
  return out;
}

/**
 * 藏品「失落之钥」：到满级那一刻给一次 50 金。
 *
 * 【为什么单独抽出来、而且两条路都要调？】
 * 因为到十级有两条路：花钱买经验（doBuyXp）、每回合白送的 2 点经验（advanceRound）。
 * 只在买经验那条路上判定的话，"靠白送经验到十级"的玩家永远拿不到这 50 金 ——
 * 这种"只接了一条路"的漏法最难发现（而且只在特定情况下才暴露）。
 *
 * @returns 这次实际发出去多少金币（0 = 没发）
 */
function settleLostKeyMaxLevel(state: GameState): number {
  if (!state.items.permanent.lostKey || state.items.permanent.lostKeyPaid) return 0;
  if (state.economy.level < MAX_LEVEL) return 0;
  state.items.permanent.lostKeyPaid = true;
  state.economy.gold += LOST_KEY_MAX_LEVEL_GOLD;
  return LOST_KEY_MAX_LEVEL_GOLD;
}

/** 按 uid 找棋子 —— 备战席和场上都要找（A 类藏品两边都能装） */
function findItemTarget(state: GameState, uid: number): ItemTarget | undefined {
  return (
    state.economy.bench.find((unit) => unit.uid === uid) ??
    state.placements.find((placement) => placement.uid === uid)
  );
}

/**
 * 现在有几个"装备带来的人口上限"（地形图 +1）。
 *
 * 每次现算、不存计数器 —— 理由见 game/items.ts 的 itemPopCapBonus。
 */
export function itemPopCapBonusOf(state: GameState): number {
  return itemPopCapBonus({
    bEquip: state.items.bEquip,
    equipped: [
      ...state.economy.bench.map((unit) => equippedItemIds(unit)),
      ...state.placements.map((placement) => equippedItemIds(placement)),
    ],
  });
}

/** 给界面用：某一栏里的格子（含空格子，界面按格子画） */
export function itemZoneView(
  state: GameState,
  zone: ItemZone,
): Array<{ index: number; itemId: string | null; item: ItemDef | undefined }> {
  return zoneList(state.items, zone).map((itemId, index) => ({
    index,
    itemId,
    item: itemId ? ITEM_DEFS[itemId] : undefined,
  }));
}

/** 给界面用：现在生效的共享藏品（最多 4 件） */
export function activeSharedItems(state: GameState): ItemDef[] {
  return collectItems(state.items.bEquip)
    .map((id) => ITEM_DEFS[id])
    .filter((item): item is ItemDef => Boolean(item));
}

/** 「共享藏品效果」栏的一行：一件正在生效的藏品 + 它的效果全文 */
export interface ActiveItemEffect {
  item: ItemDef;
  /** 效果全文（`itemEffectLines`，界面逐行显示） */
  lines: string[];
  /**
   * ★ 0.1.1：**实时数值**（"我现在到底吃到多少"）。
   *
   * 【它和 `lines` 的分工】
   * `lines` 是"这件藏品干什么"（机制全文，里面全是 tick、active、修正包这类内部写法，
   * 也是 tooltip 用的那一份）；`values` 是按当前状态换算出来的数字。
   * 界面**优先显示 values**，空数组才回退到一句人话说明 ——
   * 玩家要回答的是"我现在吃到多少"，不是"这条规则的字段名叫什么"。
   */
  values: string[];
  /** 跨回合成长层数（有成长、且已经叠起来的才有） */
  layers?: number;
  /** 永久效果（失落之钥那种"本局一直生效"）—— 界面上单独标一下 */
  permanent?: boolean;
}

/**
 * ★ 0.1.1 藏品二版：「共享藏品效果」栏的数据源。
 *
 * 【这一栏和「共享装备位」的区别】
 * 装备位显示的是"我把哪几件放进去了"（摆件）；
 * 这里显示的是"所以现在到底生效着什么"（结果）。两者不是一回事：
 *   · 失落之钥装上就销毁了 —— 本体早不在任何栏里，但永久效果一直在生效；
 *   · 黑流树海笔记 / 佣兵的饰物这种会叠层 —— 同一个名字，数值每回合都在变。
 * 只显示"摆了什么"的话，这两类玩家都看不见。
 *
 * 【为什么只收共享（B 类）藏品？】
 * 这一栏挂在「共享装备位」下面、标题就叫共享藏品效果 ——
 * 穿戴藏品（A 类）的效果是挂在**某一个干员**身上的，
 * 分给谁、还剩几层，看那个干员的详情页才对（那里已经写了）。
 *
 * @returns 按"先当前装备的、后永久效果"排序
 */
export function activeItemEffects(
  state: GameState,
  opts: { randomBuffPick?: (itemId: string) => string | null } = {},
): ActiveItemEffect[] {
  const out: ActiveItemEffect[] = [];
  const seen = new Set<string>();
  // 实时数值的上下文只算一次（金币/血量/羁绊数这一栏里每件都一样）
  const liveCtx = itemLiveContextOf(state, opts);
  /**
   * @param layersOfCopy ★ 0.2：**这一件副本**自己的层数（不再是"这个 id 的层数"）
   */
  const push = (
    item: ItemDef | undefined,
    layersOfCopy = 0,
    flags: { permanent?: boolean } = {},
  ): void => {
    if (!item) return;
    if (flags.permanent) {
      // 永久效果（失落之钥）本来就只有一份，按 id 去个重
      if (seen.has(item.id)) return;
      seen.add(item.id);
    }
    /*
      成长层数：只在"真的叠起来"的时候才显示。
      0 层的藏品写一行"当前 0 层"纯属噪声；而且 `emptySlot` 那种实时取值
      的成长（悲伤的红）本来就没有层数，跳掉。
      ★ 0.2：`emptySlot` 也不吃逐副本层数（它算的是"栏里还剩几件"）。
    */
    const growthLayersCount =
      item.growth && item.growth.source !== 'emptySlot' ? Math.max(0, layersOfCopy) : 0;
    const override =
      item.growth && item.growth.source !== 'emptySlot' ? growthLayersCount : undefined;
    out.push({
      item,
      lines: itemEffectLines(item, (id) => TRAIT_DEFS[id]?.name ?? id),
      // ★ 实时数值：按**这一件**的层数 / 金币 / 血量 / 羁绊数算出来（界面优先显示这一份）
      values: itemLiveLines(
        item,
        override === undefined ? liveCtx : { ...liveCtx, layerOverride: override },
      ),
      ...(growthLayersCount > 0 ? { layers: growthLayersCount } : {}),
      ...(flags.permanent ? { permanent: true } : {}),
    });
  };

  /*
    ① 共享装备位里的那几件 —— **一件一行**。
    ★ 0.2：踩过"两件同款只显示一行"，而那一行的层数还是共用的。
      现在按格子遍历，两件同名藏品各占一行、各显示自己的层数。
  */
  state.items.bEquip.forEach((itemId, index) => {
    if (!itemId) return;
    push(ITEM_DEFS[itemId], layerAt(state.items.bEquipLayers, index));
  });

  // ② 永久效果：失落之钥（本体已销毁，效果在本局内一直生效）
  if (state.items.permanent.lostKey) push(ITEM_DEFS['itm_lost_key'], 0, { permanent: true });

  return out;
}

/**
 * ★ 0.1.1：算一次"实时数值"需要的全部场外信息。
 *
 * 【为什么集中在一个函数里？】
 * 效果栏（B 类）和干员详情页（A 类）都要显示实时数值 ——
 * 两处各写一遍"层数从哪取、羁绊数怎么数"的话，
 * 迟早出现"效果栏说 3 层、详情页说 2 层"。所以上下文只有一个构造点。
 */
export function itemLiveContextOf(
  state: GameState,
  opts: { randomBuffPick?: (itemId: string) => string | null } = {},
): ItemLiveContext {
  return {
    growth: state.items.growth,
    // 悲伤的红按"藏品栏里没装载的数量"算 —— 和 toTeamSetup 里那一份同一个来源
    unequipped: countUnequipped(state.items),
    gold: state.economy.gold,
    hp: state.economy.hp,
    activeTraits: activeTraitCountOf(state),
    activeTraitIds: activeTraitIdsOf(state),
    round: state.round,
    summonName: (id) => SUMMON_DEFS[id]?.name ?? id,
    traitName: (id) => TRAIT_DEFS[id]?.name ?? id,
    // 生还者合约那种"开局随机挑人"的：抽到谁要问战斗日志（见 opts 的说明）
    ...(opts.randomBuffPick ? { randomBuffPick: opts.randomBuffPick } : {}),
  };
}

/**
 * ★ 0.1.1：当前场上**已经激活**的羁绊数量（老蒲扇「每激活一个不同的羁绊 +10% 攻击力」）。
 *
 * 用的是 `toTeamSetup` 里同一份计算（`computeActiveTraitLevels` + 同一套阵容输入）——
 * 界面上写着"4 个羁绊 +40%"，打起来也必须正好是 4 个。
 */
export function activeTraitIdsOf(state: GameState): string[] {
  /*
    ★★ 0.2 修（用户 2026-10-17）：「老蒲扇是看**激活的**羁绊，没有激活的羁绊不算入其中」。
    这里原来有两个错：
      ① **没过滤 `tierIndex`** —— `computeActiveTraitLevels` 对"有人带了标签但人数不够"
         的羁绊也会返回一条（`tierIndex = -1`），原样映射就成了"只要场上有这个标签就算一个"。
         于是 4 个干员能凑出 5~6 个"羁绊"，老蒲扇的提示写着"当前 6 个羁绊：+60%"，
         而实战里 `resolveSharedItems` 只按真正激活的算 —— 两边对不上。
      ② 重建对象时**把 `extraTraits` 丢了** —— 转职藏品凑出来的羁绊不算数
         （天师锦囊要看"大炎开没开"，靠转职开的也会漏判）。
    现在两头都补上：先 `withExtraTraits` 折标签，再只留 `tierIndex >= 0` 的。
  */
  const units = state.placements.map((placement) => withExtraTraits(placement));
  if (units.length === 0) return [];
  return computeActiveTraitLevels(units, UNIT_DEFS, TRAIT_DEFS)
    .filter((level) => level.tierIndex >= 0)
    .map((level) => level.traitId);
}

/** 已激活羁绊的**数量**（老蒲扇按它放大攻击力） */
export function activeTraitCountOf(state: GameState): number {
  return activeTraitIdsOf(state).length;
}

/**
 * ★ 0.1.1 藏品二版：**正装着**的藏品 id（A 类挂在干员身上、B 类在共享装备位里）。
 *
 * 【为什么需要它？】
 * 跨回合成长只会发生"装着的"藏品身上 —— 设计稿里凡是有成长的藏品都写了
 * 「装备卸下时加成失效并重置」。所以"该给谁涨层数"要按这个名单来查。
 */
export function equippedItemIdList(state: GameState): string[] {
  const out: string[] = [];
  for (const placement of state.placements) for (const id of placedItemIds(placement)) out.push(id);
  for (const unit of state.economy.bench) for (const id of placedItemIds(unit)) out.push(id);
  for (const id of collectItems(state.items.bEquip)) out.push(id);
  return out;
}

function placedItemIds(unit: { items?: string[] }): string[] {
  return unit.items ?? [];
}

/**
 * ★ 0.1.1 藏品二版：一场战斗结束后推进各件藏品的**跨回合成长层数**。
 *
 * 【为什么放在 `advanceRound` 里、和别的回合结算同处？】
 * 因为"这一场赢没赢、杀了几个、是不是野怪回合"这几个信息只有那里才知道，
 * 而且单机和联机两边都走 `advanceRound` —— 放这儿天然两条路都覆盖。
 *
 * 各来源的口径（对应 `ItemGrowth.source`）：
 *   · kill   —— 每击倒一名敌人（**野怪回合不算**，设计稿明确写了"野怪不算"）
 *   · win    —— 每次胜利 +1；标了 `resetOnLoss` 的（生还者合约）失败清零
 *   · round  —— 每回合 +1（黑流树海笔记，无论输赢都叠）
 *   · battle —— 每场**非野怪**战斗后按 3.25% 概率 +1（圆石祭坛）
 *   · emptySlot —— 不累计，实时取"未装载数"（悲伤的红）
 *
 * @param opts.kills 这一场击倒的**非野怪**敌人数
 */
/**
 * ★ 0.2 罗德岛：**回合胜利时**给"跨回合叠层"类羁绊 +1 层。
 *
 * 【为什么和藏品成长放在一起？】
 * 理由是同一个：只有这一处才知道"这一场赢没赢"，而且单机/联机都走这条路。
 *
 * 【断档清零】
 * 数据表写明"当羁绊没在激活状态时，层数需重新叠" ——
 * 所以每场都把**当前没激活的**羁绊从表里抹掉，而不是留着等它再被凑出来。
 * （"羁绊数提升时不会导致叠加的层数消失" 则天然成立：层数按羁绊 id 存，与档位无关。）
 */
export function applyTraitStacksAfterBattle(state: GameState, opts: { won: boolean | null }): void {
  /*
    ★ 0.2 顺手修：这里原来传的是 `state.placements`，而它**没有 `extraTraits`**
    （转职给的标签住在 `items` 里，要 `withExtraTraits` 折一刀）。
    症状和当初"转职装上了、羁绊却没生效"一模一样，只是藏在**跨回合叠层**上：
    靠转职凑出来的罗德岛永远叠不到层。判据和组阵容走同一个函数，不再各写一遍。
  */
  const levels = computeActiveTraitLevels(
    state.placements.map((placement) => withExtraTraits(placement)),
    UNIT_DEFS,
    TRAIT_DEFS,
  );
  const stacked = new Set<string>();

  for (const level of levels) {
    if (level.tierIndex < 0) continue;
    const tier = TRAIT_DEFS[level.traitId]?.tiers[level.tierIndex];
    const mechanic = tier?.mechanics?.find((item) => item.kind === 'roundTraitStack');
    if (!mechanic || mechanic.kind !== 'roundTraitStack') continue;
    stacked.add(level.traitId);
    if (opts.won !== true) continue;
    const current = state.traitStacks[level.traitId] ?? 0;
    state.traitStacks[level.traitId] = Math.min(mechanic.maxStacks, current + 1);
  }

  for (const key of Object.keys(state.traitStacks)) {
    if (!stacked.has(key)) delete state.traitStacks[key];
  }
}

// ============================================================
//  ★★ 0.2 MujicaAve：fever（热度）
// ============================================================
//
// 【它和别的羁绊不一样在哪？】
// 别的羁绊都是"开战那一刻算属性/机制"；fever 是一条**跨回合的玩家资源**：
//   攒 → 布阵时选「保留 / 消耗」→ 消耗了下一场全员开局强行放一次技能
//   → 那一场打输按档位退一部分回来。
// 所以它的逻辑**不在这里的 apply* 里**，而是在"回合结算"和"布阵阶段"两处：
//   · `applyFeverAfterBattle`  —— 这一场打完之后（由 advanceRound 调）
//   · `spendFever` / `holdFever` —— 玩家在弹窗上点的两个按钮
//
// ★ 两半参数都来自数据表（`kind: 'fever'`，见 trait-data 的 mujica）——
// 代码里**一个数字都不许写死**，否则调平衡就得改代码。

/** 当前生效档位给的那条 fever 机制（没凑够 3 档 / 没这个羁绊 -> null） */
function feverMechanicOf(state: GameState): Extract<TraitMechanic, { kind: 'fever' }> | null {
  /*
    ★★ 必须走 `withExtraTraits`：MujicaAve 现在**没有成员**，
    玩家能凑出它的唯一办法就是装「MujicaAve转职」——
    而转职给的标签住在 `items` 里，要 `withExtraTraits` 折成 `extraTraits` 内核才认。
    少了这一刀的症状是"转了职、羁绊面板也显示生效了，但 fever 一动不动"。
  */
  const placements = state.placements.map((placement) => withExtraTraits(placement));
  const levels = computeActiveTraitLevels(placements, UNIT_DEFS, TRAIT_DEFS);
  for (const level of levels) {
    if (level.traitId !== 'mujica' || level.tierIndex < 0) continue;
    const tier = TRAIT_DEFS['mujica']?.tiers[level.tierIndex];
    const mechanic = tier?.mechanics?.find((item) => item.kind === 'fever');
    if (mechanic && mechanic.kind === 'fever') return mechanic;
  }
  return null;
}

/** ★ 0.2 MujicaAve：fever 的几条小规则（`nextFeverPrompt` / `reachedFeverThreshold` / `feverSkillOf` / `createFeverState`）的唯一实现都在 shared/fever.ts */

/**
 * ★★ 0.2 MujicaAve：fever **跨过一个新档位**时的「宝藏」结算。
 *
 * 【玩法口径（用户 2026-10-17 的 `羁绊掉落表.txt`）】
 * 七个档位各有一张掉落表（见 `shared/fever-drops.ts`），掷到哪条就发哪条：
 * 金币 / 普通藏品 / 进阶藏品 / 转职藏品 / 拟态物质 / **随机干员**。
 * 「随机干员」和突变细胞一个来源（牌库），2 星占 3 张、3 星占 9 张。
 *
 * 【什么时候发、能发几次？】
 *   · 由 `applyFeverAfterBattle` 在**跨过更高的档**那一刻调用（和弹窗同一时刻）；
 *   · `FeverState.treasures` 记下已经领过的档位 —— **每档一辈子一次**，
 *     掉到档位下面再涨回来不会重复发；
 *   · 羁绊没激活时根本走不到这里（`applyFeverAfterBattle` 已经提前返回）。
 *
 * 【为什么返回一份结构而不是只写一句话？】
 * 因为界面要把它写成**显眼的一段日志**（标题 + 逐条明细），
 * 而不是塞进回合那句提示里 —— 那行字已经很长了，宝藏值得单独一块。
 *
 * @returns null = 这一档早就领过 / 档位不存在（没有掉落表）
 */
export interface FeverTreasureResult {
  /** 档位（100 / 300 / …） */
  tier: number;
  /** 掷中的那一行（界面不直接用，测试/调试要看） */
  entry: FeverDropEntry;
  /** 一句话摘要（写进回合结算那句提示） */
  summary: string;
  /** 逐条明细（写进显眼的日志块） */
  lines: string[];
  /** 实际到手的金币（含"牌库空了改成金币"的补偿） */
  gold: number;
  /** 实际进藏品栏的藏品 id（含拟态物质） */
  items: string[];
  /** 实际到手的干员 */
  units: Array<{ defId: string; star: number }>;
  /** 藏品栏/备战席满了，被丢掉的件数 */
  lost: number;
}

export function grantFeverTreasure(state: GameState, tier: number): FeverTreasureResult | null {
  if (state.fever.treasures.includes(tier)) return null;
  const weightSum = feverDropWeightSum(tier);
  if (weightSum <= 0) return null;
  // ★ 骰子走 state.random（每个玩家自己的种子，联机各掉各的但可复现）
  const entry = rollFeverDrop(tier, state.random() % weightSum);
  if (!entry) return null;

  state.fever.treasures.push(tier);
  const lines: string[] = [];
  const items: string[] = [];
  const units: Array<{ defId: string; star: number }> = [];
  let gold = 0;
  let lost = 0;

  /* 三类藏品池（"进阶"要排除转职 —— 转职在表里是单独一个类别） */
  const normalPool = NORMAL_ITEMS.map((item) => item.id);
  // ★ 0.2：买过失落之钥的玩家，fever 宝藏也不会再发它（"不能再次获得"要覆盖所有途径）
  const advancedPool = ADVANCED_ITEMS.filter(
    (item) => item.grantsTrait === undefined && !(state.items.permanent.lostKey && item.id === LOST_KEY_ITEM_ID),
  ).map((item) => item.id);
  const relicPool = TRAIT_RELICS.map((relic) => relic.id);
  const pick = (pool: readonly string[]): string | null =>
    pool.length === 0 ? null : (pool[state.random() % pool.length] ?? null);

  if (entry.gold) {
    gold += entry.gold;
    lines.push(`+${entry.gold} 金币`);
  }

  /** 发 N 件同类藏品；栏位满了记 lost（不中断，后面的还能试） */
  const giveItems = (pool: readonly string[], count: number, label: string): void => {
    const got: string[] = [];
    for (let i = 0; i < count; i++) {
      const id = pick(pool);
      if (!id) break;
      if (addItem(state, id).ok) {
        got.push(id);
        items.push(id);
      } else {
        lost++;
      }
    }
    if (got.length > 0) {
      const names = got.map((id) => ITEM_DEFS[id]?.name ?? id).join('、');
      lines.push(`${label} ×${got.length}：${names}`);
    }
  };

  if (entry.normalItems) giveItems(normalPool, entry.normalItems, '普通藏品');
  if (entry.advancedItems) giveItems(advancedPool, entry.advancedItems, '进阶藏品');
  if (entry.traitRelics) giveItems(relicPool, entry.traitRelics, '转职藏品');
  if (entry.mimicMatter) giveItems(['itm_mimic_mass'], entry.mimicMatter, '拟态物质');

  if (entry.operator) {
    const reward = entry.operator;
    const need = copiesOf(reward.star);
    for (let i = 0; i < reward.count; i++) {
      /*
        ★ 「来源牌库」：只在**该费用牌库还剩够这几张**的干员里挑
          （2 星要 3 张、3 星要 9 张）。挑完立刻 push，下一次循环重新算剩余 ——
          否则同一档要两只 2 星时，可能挑出"只有 3 张却要拿 6 张"的情况。
      */
      const candidates = playableDefs().filter(
        (def) => def.cost === reward.cost && poolRemainingOf(state, def.id) >= need,
      );
      if (candidates.length === 0) {
        // 牌库空了：按"本该抽到的那只"的实付价折成金币（和随机招募同一套兜底）
        const compensation = reward.cost * need;
        gold += compensation;
        lines.push(`牌库里没有 ${reward.cost} 费干员了 —— 改为 ${compensation} 金币`);
        continue;
      }
      const def = candidates[state.random() % candidates.length]!;
      state.economy.bench.push({ uid: nextUid(), defId: def.id, star: reward.star });
      units.push({ defId: def.id, star: reward.star });
      lines.push(`随机干员：${def.name}（${reward.star} 星 ${def.cost} 费）`);
    }
    // 2 星/3 星一进来就可能凑成三合一（和买牌、招募一样立刻结算）
    const merged = mergeAllUnits(state);
    if (merged.length > 0) lines.push(`并合成 ${describeMerges(merged)}`);
  }

  if (gold > 0) state.economy.gold += gold;
  if (lost > 0) lines.push(`藏品栏放不下，丢了 ${lost} 件`);

  return {
    tier,
    entry,
    summary: describeFeverDrop(entry),
    lines,
    gold,
    items,
    units,
    lost,
  };
}

/**
 * ★★ 这一场打完之后结算 fever（由 `advanceRound` 调用，单机/联机同一条路）。
 *
 * 规则（用户 2026-10-16 拍板，逐条对着表格来的）：
 *   1. **野怪回合整场跳过** —— 不获得 fever，也不判胜负（倍数/扣减/翻倍一个都不算）；
 *   2. **消耗过的那一场不获得 fever**：只处理"输了退多少"，然后把消耗清掉；
 *   3. 普通的一场：`这一场攒到的 fever` 加进总额，输了先乘档位倍数（×1.5/2/5）；
 *   4. 赢了扣掉当前总额的 30%（7 档 `winDecayBp: 0` = 不扣）；
 *   5. 7 档：回合结束时总额**翻倍**；
 *   6. 最后判定"要不要在布阵阶段弹窗"（按已跨过的最高档）。
 *
 * @param gained 这一场内核数出来的 fever（`BattleResult.feverGained[我的队伍]`）
 * @returns 一句要写进对局日志的话（没有就返回 null）
 */
export function applyFeverAfterBattle(
  state: GameState,
  opts: { won: boolean | null; gained: number; round: number },
): { text: string | null; treasure: FeverTreasureResult | null } {
  const fever = state.fever;
  // 消耗只作用于"下一场"：不管这一场结果如何，进场那一刻它就用掉了
  const armedThisBattle = fever.armedTicks > 0;
  fever.armedTicks = 0;

  const mechanic = feverMechanicOf(state);
  if (!mechanic) {
    // 羁绊没激活：fever 一分不动也不清零（用户口径 1），但也不弹窗、也不发宝藏
    fever.prompt = null;
    return { text: null, treasure: null };
  }
  /*
    ★ 野怪回合：**不获得 fever、也不判胜负**（用户追加的口径）。
    ★ 但"已经攒下的 fever 还在"，所以弹窗判定照样走 ——
      不然玩家在野怪回合攒够的档位要等到下一场真打才问。
  */
  const monsterRound = isMonsterRound(opts.round);
  let text: string | null = null;
  /** ★ 0.2：这一场要发的宝藏（消耗后打赢才发；见下面的说明） */
  let treasure: FeverTreasureResult | null = null;

  if (!monsterRound) {
    if (fever.spent > 0) {
      if (opts.won === false) {
        const back = Math.floor((fever.spent * mechanic.refundBp) / 10000);
        fever.total += back;
        text = `fever 消耗 ${fever.spent} 后战败，返还 ${back}`;
      } else if (opts.won === true) {
        text = `fever 消耗 ${fever.spent} 后获胜`;
        /*
          ★★ 0.2（用户 2026-10-17）：「获得奖励应该是在选择消耗 fever 后、战斗获胜后才能获得」。
          ⇒ 宝藏从"跨档那一刻"挪到**这里**：`pendingTier` 在 spendFever 记下消耗的档位，
          打赢了这一场才兑现一次；输了 / 平局直接作废（不补发）。
          ★ 每档一辈子一次仍由 `treasures` 把关（掉档再涨回来不会重复发）。
        */
        if (fever.pendingTier !== null) {
          treasure = grantFeverTreasure(state, fever.pendingTier);
        }
      } else {
        text = `fever 消耗 ${fever.spent} 后平局（不返还、不发奖励）`;
      }
      fever.pendingTier = null;
      fever.spent = 0;
    } else {
      let add = Math.max(0, Math.floor(opts.gained));
      if (opts.won === false) add = Math.floor((add * mechanic.lossMultiplierBp) / 10000);
      /*
        ★★ 0.2 修（用户 2026-10-17「后期 fever 叠加数值有问题」）：
        `doubleAtRoundEnd` 原来写的是 `fever.total *= 2` —— 把**跨回合攒下来的总额**
        每回合翻一倍，于是 8 人档 3 个回合就从 0 顶到 3000 以上（掉落表一共才 7 档），
        后面所有档位/宝藏一次全跳过。
        现在改成**只翻本场获得的这一份**（`add`）：8 人档约 7 个回合走到 3000，
        正好和掉落表的 7 个档位对得上。
      */
      if (mechanic.doubleAtRoundEnd) add *= 2;
      fever.total += add;
      if (opts.won === true && mechanic.winDecayBp > 0) {
        fever.total -= Math.floor((fever.total * mechanic.winDecayBp) / 10000);
      }
      if (add > 0 || fever.total > 0) text = `fever 共 ${fever.total}`;
    }
  } else if (armedThisBattle) {
    // 野怪回合碰上"消耗后的那一场"：不判胜负，消耗额度与待发奖励一起作废
    fever.spent = 0;
    fever.pendingTier = null;
    text = 'fever 未结算（野怪回合）';
  }

  fever.total = Math.max(0, fever.total);

  /*
    ★★ 0.2（用户口径）：「选择弹窗不会出现在野怪回合的布阵阶段，
    若在野怪布阵阶段到达了判定点，则弹窗移动至下一回合布阵阶段
    —— 简单来说就是不能靠打野怪回合获得羁绊奖励」。

    【怎么落地的？】
    野怪回合**整段跳过判定**（既不新建弹窗、也不发宝藏），但**保留**已经挂着的
    `prompt` —— 于是：
      · 第 8 回合（真打）结束时跨了档 -> prompt 挂上；
      · 第 9 回合是野怪回合 -> 布阵界面靠 `renderFeverOverlay` 的
        `isMonsterRound` 判断把它**藏起来**（下面这行 return 也保证不再新建）；
      · 第 10 回合布阵 -> 那条 prompt 还在，正常显示。
    ⇒ 野怪回合既弹不出窗、也领不到宝藏（宝藏只在"这次要弹窗"时发）。
  */
  if (monsterRound) {
    return { text, treasure: null };
  }

  /*
    ★★ 0.2：弹窗只弹**更高的档**（用户口径）。

    以前这里直接取"当前能到的最高档"，于是同一个档每回合都弹一次 ——
    玩家在 100 档点了几次「保留」，每回合布阵都要被问一遍。
    现在把"上次弹过的最高档"（`promptedTier`）一起喂进去：
      · 跨过更高的档 -> 弹；
      · 还在同一个档里涨（150 -> 170）-> 不弹；
      · 掉到某档下面又涨回来 -> 重新弹（`promptedTier` 会跟着往下走）。
    ★ 唯一实现是 `shared/fever.ts` 的 `nextFeverPrompt` —— 别在这儿再写一遍判断。
  */
  /*
    ★ 0.2（用户 2026-10-17）：`repeatAtMax: true` = 站在**最高档**时每回合都弹
    （野怪回合的排除在上面那一段，走不到这里）。
  */
  const next = nextFeverPrompt(fever.total, mechanic.thresholds, fever.promptedTier, {
    repeatAtMax: true,
  });
  fever.prompt = next.prompt;
  fever.promptedTier = next.promptedTier;
  /*
    ★★ 0.2 修（用户 2026-10-17）：**跨档不再发宝藏**。
    以前这里 `grantFeverTreasure(state, next.prompt)` —— 只要跨档就白给一份，
    玩家可以一直"保留"把 fever 攒着，一分不消耗也能把七档宝藏全领完。
    现在宝藏只在"**消耗 fever 之后打赢那一场**"发（见上面 `fever.spent > 0` 那一段）。
  */
  return { text, treasure };
}

/**
 * ★ 玩家在弹窗上点了「消耗 fever」（`threshold` = 当时弹的那个档位）。
 *
 * 消耗的是**当前全部** fever（表里写的是"消耗所有fever"），并且：
 *   · `armedTicks` 记下下一场的特殊技能窗口时长（5/10/15 秒，来自档位数据）；
 *   · `spent` 记下这次花掉的额度 —— 下一场如果输了要按 50%/70%/100% 退回来；
 *   · `treasures` 记下这个档位（**掉落表还没给**，先记账，日志里会写出来）。
 */
export function spendFever(state: GameState): boolean {
  const mechanic = feverMechanicOf(state);
  const prompt = state.fever.prompt;
  if (!mechanic || prompt === null) return false;
  const spent = state.fever.total;
  state.fever.spent = spent;
  state.fever.total = 0;
  state.fever.armedTicks = mechanic.skillDurationTicks;
  /*
    ★ 0.2：这里**不再**往 `treasures` 里记档位。
    `treasures` 现在的含义是"已经领过宝藏的档位"，而宝藏是**跨档那一刻**发的
    （`grantFeverTreasure`）。以前在这里记，等于"消耗过的档"和"领过宝藏的档"
    混在一个数组里 —— 以后想统计"领过哪些档"就分不清了。
  */
  state.fever.prompt = null;
  /*
    ★★ 0.2（用户 2026-10-17）：把**消耗的这一档**记下来 —— 宝藏不再是"跨档就发"，
    而是"选择消耗 + 下一场打赢"才发。这一条就是那个待发放的凭据，
    由 `applyFeverAfterBattle` 在打赢时兑现、输了/野怪回合作废。
  */
  state.fever.pendingTier = prompt;
  /*
    ★★ 0.2：总额清零 = **掉到所有档以下** ⇒ "上次弹过的最高档"也要一起归零。

    【不归零会怎样？】玩家在 100 档点了「消耗」，fever 归 0；
    之后重新攒到 100 时，`promptedTier` 还停在 100 ⇒ `top > promptedTier` 不成立
    ⇒ **永远不再弹窗**，这个羁绊的玩法就废了。
    归零之后"重新攒到 100"算跨过了一个新档，照常弹。
  */
  state.fever.promptedTier = null;
  return true;
}

/** ★ 玩家在弹窗上点了「保留 fever」—— 只是把弹窗关掉，fever 一点不动 */
export function holdFever(state: GameState): boolean {
  if (state.fever.prompt === null) return false;
  state.fever.prompt = null;
  return true;
}

export function applyItemGrowthAfterBattle(
  state: GameState,
  opts: { won: boolean | null; kills: number; round: number },
): void {
  const monsterRound = isMonsterRound(opts.round);

  /*
    ★★ 0.2：**一件一件算**，不再按"藏品 id 去重"。

    【原来的 bug】旧代码是 `for (const itemId of new Set(equippedItemIdList(state)))` ——
    两件同名藏品在集合里只剩一个，于是：
      · 层数只涨一份（两件共用一个数）；
      · 界面上两件显示同一个层数；
      · 卖掉一件，另一件的层数也跟着跳。
    用户报的就是这个："有些单独穿戴的叠层藏品，我有多个时层数会共享，
    改为相同藏品单独也要叠层"。

    现在层数住在**副本**上（`unit.itemLayers[i]` / `bEquipLayers[i]`），
    所以这里就是"遍历每一件副本、各算各的"。
  */
  const nextLayer = (itemId: string, current: number): number => {
    const growth = ITEM_DEFS[itemId]?.growth;
    // `emptySlot` 是实时取值的（悲伤的红看"栏里还剩几件没装"），没有层数可攒
    if (!growth || growth.source === 'emptySlot') return current;

    let value = current;
    switch (growth.source) {
      case 'kill':
        if (!monsterRound && opts.kills > 0) value = current + opts.kills;
        break;
      case 'win':
        if (opts.won === true) value = current + 1;
        else if (opts.won === false && growth.resetOnLoss) value = 0;
        break;
      case 'round':
        value = current + 1;
        break;
      case 'battle':
        // 概率来自藏品数据（圆石祭坛 3.25%）—— 别在这里写死
        if (!monsterRound && state.random() % 10000 < (growth.chanceBp ?? 0)) value = current + 1;
        break;
    }
    return Math.min(growth.maxStacks, Math.max(0, value));
  };

  // ① 干员身上的 A 类（场上 + 备战席都算"装着"，装备还在他们身上）
  for (const unit of [...state.placements, ...state.economy.bench]) {
    const items = unit.items ?? [];
    if (items.length === 0) continue;
    const layers = normalizeLayers(items, unit.itemLayers);
    for (let i = 0; i < items.length; i++) layers[i] = nextLayer(items[i]!, layers[i]!);
    unit.itemLayers = layers;
  }

  // ② 共享装备位上的 B 类
  state.items.bEquipLayers = state.items.bEquip.map((itemId, index) =>
    itemId ? nextLayer(itemId, layerAt(state.items.bEquipLayers, index)) : 0,
  );
}

/**
 * ★ 0.1.1 藏品二版：按"成长层数"给的**概率额外金币**（黑流树海笔记）。
 *
 * 「每回合叠加 1 层，每 5 层使战斗胜利后有 1% 概率额外获得 1 金币」
 * —— 判定只在**战斗胜利**之后发生（输了没有）。
 *
 * @returns 额外获得的金币数（0 = 没触发）
 */
export function itemGrowthGold(state: GameState, won: boolean | null): number {
  if (won !== true) return 0;
  let gold = 0;
  /*
    ★ 0.2：逐**副本**骰（两件同款就各掷各的 —— 这是"相同藏品单独叠层"的必然结果：
    两件各有各的层数，也就各有各的概率）。
  */
  for (const copy of equippedItemCopies(state)) {
    const per = ITEM_DEFS[copy.itemId]?.perRound?.growthGoldChance;
    if (!per) continue;
    const steps = Math.floor(copy.layers / Math.max(1, per.layersPerStep));
    if (steps <= 0) continue;
    // 骰子走 state.random（每个玩家自己的种子）—— 和掉落一样，"各掉各的"但可复现
    if (state.random() % 100 < steps * per.percentPerStep) gold += per.gold ?? 1;
  }
  return gold;
}

/**
 * ★ 0.2：遍历**现在装着的每一件藏品副本**（A 类在棋子身上、B 类在共享装备位）。
 *
 * 【为什么要有它？】
 * "层数按副本记"之后，凡是**跟层数有关**的批量判断（额外金币、界面显示、
 * 战报汇总）都得遍历"件"而不是"款"—— 按 id 去重就会把两件同名藏品算成一件。
 * 收成一个函数，免得各处自己写一遍、还各自漏掉 B 类或备战席。
 */
export function equippedItemCopies(state: GameState): Array<{ itemId: string; layers: number }> {
  const out: Array<{ itemId: string; layers: number }> = [];
  for (const unit of [...state.placements, ...state.economy.bench]) {
    const items = unit.items ?? [];
    for (let i = 0; i < items.length; i++) {
      out.push({ itemId: items[i]!, layers: layerAt(unit.itemLayers, i) });
    }
  }
  state.items.bEquip.forEach((itemId, index) => {
    if (itemId) out.push({ itemId, layers: layerAt(state.items.bEquipLayers, index) });
  });
  return out;
}

/**
 * ★ 0.1.1 藏品二版：把"获得后 N 回合还没装载就自动销毁"的藏品清掉（剑锤）。
 *
 * 【为什么要自动销毁？】
 * 设计稿：「若藏品获得 2 回合后没有装载，则自动销毁」——
 * 它是个"限时决定要不要吃这个 +2 花费"的抉择，一直躺着就没意义了。
 *
 * @returns 被销毁的藏品名字（界面提示用）
 */
export function expireUnsocketedItems(state: GameState, round: number): string[] {
  const socketed = new Set(equippedItemIdList(state));
  const destroyed: string[] = [];
  for (const zone of ['a', 'b'] as const) {
    const list = zoneList(state.items, zone);
    for (let i = 0; i < list.length; i++) {
      const itemId = list[i];
      if (!itemId) continue;
      const item = ITEM_DEFS[itemId];
      if (!item?.selfDestructAfterRounds) continue;
      if (socketed.has(itemId)) continue;
      const gained = state.items.gainedRound[itemId] ?? round;
      if (round - gained < item.selfDestructAfterRounds) continue;
      list[i] = null;
      delete state.items.gainedRound[itemId];
      destroyed.push(item.name);
    }
  }
  return destroyed;
}

/**
 * ★ 0.1.1 藏品二版：一件藏品**被卸下**时的收尾。
 *
 * 原来这里干两件事，★ 0.2 之后只剩一件：
 *   · ~~成长层数清零~~ —— **层数改成逐副本记了**（挂在 holder 的
 *     `itemLayers` / `bEquipLayers` 上），所以"卸下即重置"是**自动**的：
 *     那一份层数跟着这一件离开，调用方在摘装备时顺手把那一格置 0 就行
 *     （见 `unequipItemFromUnit` / `unequipSharedItem`）。
 *     这张函数拿到的只有 `itemId`，**没能力**分清是哪一件副本 —— 硬在这里
 *     按 id 清一遍，反而会把"另一件同名藏品"的层数一起抹掉（就是用户报的 bug）。
 *   · 剑锤这类「再次卸下时装备销毁」的，卸下就直接没了（不回存放栏）
 *
 * @returns true = 这件藏品被销毁（调用方不要再把它塞回栏里）
 */
export function applyUnequipEffects(state: GameState, itemId: string): boolean {
  const item = ITEM_DEFS[itemId];
  if (!item) return false;
  // ★ 0.2：不再 resetGrowth —— 见上面那段说明（层数由"谁把装备摘下来"负责清）
  if (item.selfDestructAfterRounds) {
    delete state.items.gainedRound[itemId];
    return true;
  }
  return false;
}

/** 给界面用：干员身上装了几件 A 类藏品（血条左边那两个小圆点用） */export function unitItemCount(unit: { items?: string[] }): number {
  return equippedItemIds(unit).length;
}

/** 给界面用：干员身上的 2 个装备位（不足 2 件时后面的补 null） */
export function unitItemSlots(unit: { items?: string[] }): Array<ItemDef | null> {
  const items = equippedItemIds(unit);
  return Array.from({ length: ITEM_PER_UNIT }, (_, index) => {
    const itemId = items[index];
    return itemId ? (ITEM_DEFS[itemId] ?? null) : null;
  });
}

/**
 * 把一件藏品放进对应的藏品栏。
 *
 * ★ 以后的「野怪掉落」也会走这里，所以这里**没有**修改器检查 ——
 *   检查放在 `grantModifierItem` 里。
 */
export function addItem(state: GameState, itemId: string): { ok: boolean; message: string } {
  const item = ITEM_DEFS[itemId];
  if (!item) return { ok: false, message: '这件藏品不存在' };
  const zone = storageZoneOf(item.slot);
  const list = zoneList(state.items, zone);
  const free = freeSlotIndex(list);
  if (free < 0) {
    return {
      ok: false,
      message: `${zoneLabel(zone)}满了（${zoneSize(zone)} 格）—— 先装备或删除一件`,
    };
  }
  list[free] = itemId;
  /*
    ★ 0.1.1 藏品二版：记下"这件藏品是第几回合拿到的"。
    剑锤那种「获得 2 回合后仍未装载则自动销毁」要靠它 ——
    没记的话就没法判断"已经过了几回合"。
    同一件藏品多次获得时以最后一次为准（覆盖即可）。
  */
  if (item.selfDestructAfterRounds) state.items.gainedRound[itemId] = state.round;
  state.message = `获得藏品 ${item.name}（${zoneLabel(zone)}第 ${free + 1} 格）`;
  return { ok: true, message: state.message };
}

/**
 * ★★ 0.3.2 把一张升变之证发到**专用栏位**（不占穿戴藏品那 10 格）。
 *
 * 【为什么不复用 `addItem`？】
 * `addItem` 会去找 A 类的空格子、找不到就报"栏满了"。
 * 而这三张证是**任务换来的**，用户明确要求"不能被栏满挤掉"——
 * 所以它们走自己的 3 格固定栏位（`ItemInventory.certSlots`），
 * 下标就是证的种类，天然去重、顺序永远稳定。
 */
export function grantAscendCert(state: GameState, itemId: string): { ok: boolean; message: string } {
  const index = AMIYA_CERT_ORDER.indexOf(itemId);
  if (index < 0) return { ok: false, message: '这不是升变之证' };
  state.items.certSlots[index] = itemId;
  state.message = `获得 ${ITEM_DEFS[itemId]?.name ?? itemId}（升变之证栏位）`;
  return { ok: true, message: state.message };
}

/**
 * 修改器：直接获得一件藏品。
 *
 * ★ 和「获得干员」完全一致：只在测试模式里能用、白送、不碰任何牌库。
 *   （藏品本来就没有牌库，所以"白送"在这里就是"凭空出现在藏品栏"。）
 */
export function grantModifierItem(state: GameState, itemId: string): { ok: boolean; message: string } {
  if (!modifierAllowed(state)) return { ok: false, message: '修改器只在测试模式里能用' };
  /*
    ★ 0.3.2：升变之证也走专用栏位 —— 调试时想试升变，一样不该去占穿戴藏品栏。
  */
  if (AMIYA_CERT_ORDER.includes(itemId)) return grantAscendCert(state, itemId);
  return addItem(state, itemId);
}

/**
 * 这件藏品的「备战效果」会不会**往备战席里塞一只新棋子**？
 *
 * 【为什么要单列一个判据？】
 * 塞棋子的效果必须先确认备战席有空位（否则那只棋子会凭空消失），
 * 而"确认空位"的检查点只有一处：`equipItemToUnit` 的前置条件区。
 * 写成 `prep.kind === 'cloneOneStar' || …` 那样散着写的话，
 * 下次再加一种"往备战席塞棋子"的效果一定会漏掉空位检查。
 */
function prepPushesBenchUnit(item: ItemDef): boolean {
  const kind = item.onEquip?.prep?.kind;
  return kind === 'cloneOneStar' || kind === 'recruitRandom';
}

/**
 * ★ 0.1.3：这件藏品**转的是哪个羁绊**（不是转职藏品就返回 null）。
 *
 * 客户端的校验、变形同构体、提示文案都走它 —— 谁都不许自己拼 `itm_relic_xx` 字符串。
 */
export function grantedTraitOf(itemId: string): string | null {
  return ITEM_DEFS[itemId]?.grantsTrait ?? null;
}

/** ★ 0.1.3：这枚棋子身上装着的**转职藏品** id（可能为空） */
export function traitRelicsOf(unit: { items?: string[] }): string[] {
  return (unit.items ?? []).filter((id) => Boolean(ITEM_DEFS[id]?.grantsTrait));
}

/**
 * ★ 0.1.3：这枚棋子**额外**获得的羁绊标签（= 身上转职藏品对应的羁绊）。
 *
 * 【为什么每次现推，而不是存成一份状态？】
 * 因为"身上装着哪几件藏品"（`items`）已经是唯一真相了。再存一份 extraTraits，
 * 就等于要在 装备 / 卸下 / 互换 / 合成 / 卖出 / 淘汰回库 **每一处**都跟着改 ——
 * 漏掉任何一处，玩家看到的就是"转了职但不算人数"。现推的代价只是一次 map。
 */
export function extraTraitsOf(unit: { items?: string[] }): string[] {
  const out: string[] = [];
  for (const id of traitRelicsOf(unit)) {
    const trait = ITEM_DEFS[id]?.grantsTrait;
    if (trait) out.push(trait);
  }
  return out;
}

/**
 * ★ 0.1.3：把转职标签**补进**这枚棋子的 placement（不动原对象）。
 *
 * 【为什么要有这个包装？】
 * 内核只认 `placement.extraTraits`，而 `state.placements` 里的对象**没有这个字段**
 * （客户端只存 `items`）。所以任何"要算羁绊"的地方都得先补一刀。
 *
 * ★ 这里踩过一次：`currentTraits()` 原来手挑 `defId / star / cell` 三个字段重建
 * placement，把这个新字段**静默丢掉**了 —— 后果就是玩家报的
 * 「转职装上了、羁绊却没生效」（界面上人数不变）。所以现在统一走这个函数，
 * 而不是各自 `map` 一遍挑字段（挑字段的写法每加一个字段就会漏一次）。
 */
export function withExtraTraits<T extends { items?: string[] }>(placement: T): T {
  const extra = extraTraitsOf(placement);
  return extra.length > 0 ? ({ ...placement, extraTraits: extra } as T) : placement;
}

/**
 * 结算藏品的「备战类效果」（复制一星 / 升星 / 变高一费）。
 *
 * 这三件事都要动**棋子本身**，所以只能住在状态层 ——
 * 战斗内核里没有"备战席"这个概念。
 *
 * @returns 一句给玩家看的说明（空字符串 = 什么都没做）
 */
function applyItemPrep(state: GameState, target: ItemTarget | null, item: ItemDef): string {
  const prep = item.onEquip?.prep;
  if (!prep) return '';

  /*
    ============================================================
     ★ 0.1.1 藏品二版：为什么 target 可能是 null？
    ============================================================
    共享藏品里也有备战效果 —— 人事部铜印 / 博士银印的随机招募。
    而"共享藏品"是给全队用的，压根没有落点干员。
    所以**不需要落点**的那种先单独处理掉，需要落点的在后面统一挡住。
  */
  if (prep.kind === 'recruitRandom') {
    /*
      「装备后立刻销毁，随机招募 1 名 N~M 费干员（直接进备战席）」

      【从哪儿抽？】
      从 `playableDefs()`（**全表取样必须用它**）里按费用区间过滤。
      它已经把召唤物（迷迭香的柱子）和野怪（`mn_*`）都排除了 ——
      直接遍历 UNIT_DEFS 会抽到"根本不能上场的棋子"，那种 bug 很难看出来。

      【★ 0.1.1 用户口径：占牌库 + 空牌库改给金币】
      · 只在"该区间**牌库还剩 ≥1 张**"的干员里挑 —— 招到的那只是真的从牌库拿的
        （不再标 `free`，1★ 占 1 张，卖掉会还回去）；
      · 该区间一张都不剩 -> 招不到人，按"本该抽到的那名干员"的**花费**发金币。
      规则本体在 shared 的 `pickRecruit`（单机 / 服务端共用同一份）。

      【联机为什么要交给服务器？】
      牌库是 8 个人共享的，本地扣就会出现"多人各招一只、牌库超发"。
      所以联机时只把申请发出去（`state.recruitRequest`），
      等 `recruitResult` 回来再走 `applyRecruitResult` —— 落地逻辑只有那一处。
    */
    const candidates = playableDefs().filter(
      (def) => def.cost >= prep.minCost && def.cost <= prep.maxCost,
    );
    if (candidates.length === 0) return `没有 ${prep.minCost}~${prep.maxCost} 费的干员（数据缺失）`;

    if (state.recruitRequest) {
      state.recruitRequest({ minCost: prep.minCost, maxCost: prep.maxCost, seed: state.random() });
      return `正在向服务器确认招募（${prep.minCost}~${prep.maxCost} 费）…`;
    }

    const picked = pickRecruit(
      candidates,
      (defId) => poolRemainingOf(state, defId),
      (length) => state.random() % length,
    );
    // 两个分支的字段名不同（招到人有 cost、抽空了有 gold），用 in 收口
    return applyRecruitResult(state, picked.defId, 'gold' in picked ? picked.gold : 0);
  }

  // 下面的这几种都要动**落点那只棋子**：没有落点就什么都做不了
  if (!target) return '';
  const targetDef = UNIT_DEFS[target.defId];
  const before = targetDef?.name ?? target.defId;

  switch (prep.kind) {
    /*
      ★ 0.1.3 变形同构体：「装备到干员身上后立刻销毁，并根据干员身上的羁绊
      随机获得相应的一个转职藏品」（各羁绊等概率，产出的进穿戴藏品存放栏）。
      【前置条件在 equipItemToUnit 里已经挡过】—— 能走到这里就是"确定可以做"。
      【为什么用 state.random 而不是 Math.random？】备战期的骰子也走同一条
      状态随机序列（和发牌、掉落同源），联机两边才算得出一样的结果。
    */
    case 'morphRelic': {
      const candidates = morphCandidatesOf(targetDef);
      const pick = candidates[state.random() % candidates.length]!;
      const added = addItem(state, pick);
      const relicName = ITEM_DEFS[pick]?.name ?? pick;
      return added.ok ? `${before} 变形成了 ${relicName}` : `${relicName} 没地方放（穿戴藏品栏满了）`;
    }
    case 'cloneOneStar': {
      // ★ 不占牌库：free = true（和修改器白送的棋子同一条规则）
      state.economy.bench.push({ uid: nextUid(), defId: target.defId, star: 1, free: true });
      state.economy.bench.sort((a, b) => a.uid - b.uid);
      const merged = mergeAllUnits(state);
      return (
        `获得一只一星 ${before}（不占牌库）` +
        (merged.length > 0 ? `，并合成 ${describeMerges(merged)}` : '')
      );
    }
    case 'upgradeStar': {
      /*
        ★ 0.0.3：升星**不改变这只占牌库的张数**。
        等级变了、张数没变：1★（占 1 张）升到 2★ 之后还是占 1 张 ——
        因为多出来的那 2 张是道具给的，本来就没从牌库拿过。
        以前写的是 `target.free = true`（整只不占牌库），配上"合成传染"
        直接把 7 张同名干员全洗白（用户报的"牌库弹回 10 张"）。
      */
      const heldBefore = poolCopiesOf(target);
      target.star = Math.min(3, target.star + 1);
      target.free = freeFlagFor(target.star, heldBefore);
      const merged = mergeAllUnits(state);
      return (
        `${before} 升到 ${target.star} 星` +
        (merged.length > 0 ? `，并合成 ${describeMerges(merged)}` : '')
      );
    }
    case 'transformCostUp': {
      const nextId = pickTransformTarget(target.defId, state.random);
      if (!nextId) return `${before} 没有可变的干员（数据缺失）`;
      target.defId = nextId;
      const after = UNIT_DEFS[nextId]?.name ?? nextId;
      const merged = mergeAllUnits(state);
      return `${before} 变成了 ${after}` + (merged.length > 0 ? `，并合成 ${describeMerges(merged)}` : '');
    }
    default:
      return '';
  }
}

/**
 * ★ 0.1.1：把「随机招募」的结果落地（招到人 / 改发金币）。
 *
 * 【为什么单独一个函数？】
 * 因为结果有**两个来源**，但"落地"必须只有一处：
 *   · 单机 —— `applyItemPrep` 本地抽完直接调它；
 *   · 联机 —— 服务器裁决完回 `recruitResult`，main.ts 拿着结果调它。
 * 写两份的话，"招募到一星 X（N 费）"这句文案、合成提示、`free` 标记
 * 迟早会在两条路上走散（这个项目已经栽过一次同类问题）。
 *
 * @param defId 招到的干员 id；**null = 该费用区间牌库已空，改用金币补偿**
 * @param gold  牌库为空时按"本该抽到的那名"的花费折算出来的金币
 */
export function applyRecruitResult(
  state: GameState,
  defId: string | null,
  gold: number,
): string {
  if (!defId) {
    if (gold > 0) {
      state.economy.gold += gold;
      return `该费用区间的干员已经招募完了 —— 改为获得 ${gold} 金币`;
    }
    return '没有可招募的干员（数据缺失）';
  }
  const def = UNIT_DEFS[defId];
  if (!def) return '招募失败（数据缺失）';

  /*
    ★ 不写 `free`：这一只是**真的从牌库拿的**（1★ 占 1 张，卖掉会还回去）。
    联机时服务器那边已经扣过牌了，客户端这份只影响单机的本地账。
  */
  state.economy.bench.push({ uid: nextUid(), defId, star: 1 });
  state.economy.bench.sort((a, b) => a.uid - b.uid);
  const merged = mergeAllUnits(state);
  return (
    `招募到一星 ${def.name}（${def.cost} 费 · 已从牌库取走 1 张）` +
    (merged.length > 0 ? `，并合成 ${describeMerges(merged)}` : '')
  );
}

/**
 * ★ 0.3.31：这件**纯回血**藏品现在能不能装（满血就别白扔）。
 *
 * ============================================================
 *  ★ 为什么要拦？
 * ============================================================
 * 「热水壶 +5 / 血魔的寝床 +15」这类都是 `consume: true` 的一次性道具 ——
 * 满血时点下去：藏品消失、什么都没得到，界面上还写着"血量 +15"。
 * 玩家看到的就是"回血藏品有时候不生效"（0.3.3 实测复现）。
 *
 * ★ 例外：这件藏品**还给别的东西**（金币 / 人口 / 备战 / 升变 / 永久）时不拦 ——
 *   那它就不是"纯回血道具"，玩家是在用另外那一半，拦了反而卡手。
 *
 * @returns 不能装的原因（`null` = 可以装）
 */
export function healBlockedReason(state: GameState, item: ItemDef): string | null {
  const onEquip = item.onEquip;
  if (!onEquip?.hp) return null;
  if (onEquip.gold || onEquip.popCap || onEquip.prep || onEquip.ascend || onEquip.permanent) return null;
  const cap = playerMaxHp(state.economy.startHp ?? START_HP, state.covenantId);
  if (state.economy.hp >= cap) return `血量已满（${state.economy.hp}/${cap}），${item.name} 先留着`;
  return null;
}

/**
 * ★ 0.3.31：**玩家回血的唯一入口**。
 *
 * ============================================================
 *  ★ 为什么必须有这一层？
 * ============================================================
 * 以前"藏品回血"是两处各写一遍 `state.economy.hp += onEquip.hp`，
 * 两边都**没有夹上限**。于是满血时吃回血藏品：
 *   · 单机 —— 数字涨到 115，下一次结算才被夹回 100；
 *   · 联机 —— 本地涨了，服务端一夹，下一次广播直接覆盖回来。
 * 玩家看到的就是「回血藏品有时候不生效」（本机 0.3.3 实测复现）。
 *
 * 收成一处之后：夹上限、记 `pendingHeal`、返回**实际回了多少**，
 * 三件事只写一遍，也不存在"另一条路忘了夹"的可能。
 *
 * ★ 上限为什么每次现推而不是存死？
 *   因为盟约是**开局之后**才选的（盟约选秀会给 `startHp` 加成），
 *   存死上限的话选完盟约必须记得回头改一次 —— 那就是"两个真相"。
 *
 * @returns 实际回复的血量（0 = 已经满血，一点都没回）
 */
export function applyPlayerHeal(state: GameState, amount: number): number {
  const raw = Number.isFinite(amount) ? Math.floor(amount) : 0;
  if (raw <= 0) return 0;
  const cap = playerMaxHp(state.economy.startHp ?? START_HP, state.covenantId);
  const healed = Math.max(0, Math.min(raw, cap - state.economy.hp));
  if (healed <= 0) return 0;
  state.economy.hp += healed;
  /*
    ★★ 0.3 bug 修复：联机里血量是**服务端权威**的。
    只改 `economy.hp` 的话，下一次房间广播会用服务端那份覆盖回来。
    这里把"该补多少"记在 `pendingHeal` 上，由 main.ts 在渲染后发给服务端
    （state 层不碰网络，分层别破）。
  */
  state.pendingHeal += healed;
  return healed;
}

/**
 * 把 A 类藏品从藏品栏装到某个干员身上（拖拽落点 = 干员）。
 *
 * ============================================================
 *  ★ 为什么所有前置条件都在"动手之前"一次查完？
 * ============================================================
 * 因为有些藏品是「装上去当场结算并销毁」的（古旧残币 +10 金、无瑕宝玉 +30 金…）。
 * 如果先加了金币、再发现"备战席满了，拟态物质放不下"，那就成了白送钱。
 * 所以顺序永远是：**先查全部条件 -> 再动任何状态**。
 *
 * @param slotIndex A 类藏品栏的格子下标
 * @param uid       装给哪个干员（备战席 / 场上的 uid 都行）
 */
export function equipItemToUnit(
  state: GameState,
  slotIndex: number,
  uid: number,
  /**
   * ★ 0.3.2：从哪个栏位取这件藏品。
   *   · `'a'`（默认）= 穿戴藏品栏那 10 格；
   *   · `'cert'` = **升变之证专用栏**那 3 格（任务发的证只能从这里拖）。
   * 除了"从哪拿、消耗完清哪一格"不同，其余校验/效果**完全共用**，
   * 所以不要再为证另抄一份装备逻辑 —— 那样两边迟早会漂。
   */
  from: 'a' | 'cert' = 'a',
): { ok: boolean; message: string } {
  const sourceList = from === 'cert' ? state.items.certSlots : state.items.aSlots;
  const itemId = sourceList[slotIndex];
  if (!itemId) return { ok: false, message: '这一格是空的' };
  const item = ITEM_DEFS[itemId];
  if (!item) return { ok: false, message: '藏品数据缺失' };
  if (item.slot !== 'A') {
    return { ok: false, message: `${item.name} 是共享藏品，要拖到右边的共享装备位` };
  }

  const target = findItemTarget(state, uid);
  if (!target) return { ok: false, message: '找不到这个干员' };
  const def = UNIT_DEFS[target.defId];
  const name = def?.name ?? target.defId;

  // ★ 野怪不能穿戴装备：装备系统只属于干员。
  //   放在所有消耗/合成判断之前 —— 后面有"装上当场销毁"的道具，
  //   不先挡住野怪就可能白送效果。
  if (def?.monsterOnly) {
    return { ok: false, message: `${name} 是野怪，不能穿戴装备` };
  }

  /*
    ★ 0.1.1：「维维美·绝对主角」（`noStar` 的彩蛋）**永久免升星 / 免复制**。
    【为什么放在这里？】这里是 A 类藏品装到干员身上的**唯一**入口 ——
    点击和拖动两条路都经过它，挡在这里就没有第二个口子。
    【为什么按"效果类别"而不是按 id？】见 shared 里 isUnitTransformingItem 的说明：
    用户要求"之后新增任何具备升星、棋子复制效果的藏品都不能对他生效"，
    写死 id 的话下次加同类藏品一定会漏。
  */
  if (def?.noStar && isUnitTransformingItem(item)) {
    return { ok: false, message: `${name} 是永久免升星的彩蛋角色，${item.name} 对他无效` };
  }

  const consume = isConsumedOnEquip(item);
  const equipped = equippedItemIds(target);
  if (!consume && equipped.length >= ITEM_PER_UNIT) {
    return { ok: false, message: `${name} 已经装了 ${ITEM_PER_UNIT} 件藏品，先卸下一件` };
  }

  const requirementError = itemRequirementError(item, target.star);
  if (requirementError) return { ok: false, message: requirementError };

  /*
    ★ 0.3.31：纯回血藏品在满血时**直接拦下**，别让它白销毁一件。
    判据在 `healBlockedReason`（唯一一处）—— 还带金币 / 人口 / 备战效果的会放行。
  */
  const healBlock = healBlockedReason(state, item);
  if (healBlock) return { ok: false, message: healBlock };

  /*
    「往备战席里塞一只新棋子」的备战效果，要先确认备战席还有位置：
      · cloneOneStar  —— 复制一只一星（拟态物质那种）
      · recruitRandom —— 随机招募一只（人事部铜印 / 博士银印）
    ★ 必须在**消耗藏品之前**挡住 —— 这两件都是"装备后立刻销毁"的一次性道具，
      先销毁再发现放不下，就成了白扔一件藏品。
  */
  if (prepPushesBenchUnit(item) && state.economy.bench.length >= BENCH_SLOTS) {
    return { ok: false, message: `备战席满了（${BENCH_SLOTS} 格），先腾一个位置再装 ${item.name}` };
  }

  /*
    ★ 0.1.3 转职藏品：**本来就属于这个羁绊的干员装不上**。
    用户口径：「星熊无法装备大炎转职和重装转职」——
    转职的全部意义就是"让他多一个原本没有的羁绊"，本来就有的再来一件只是白占位置。
    ★ 拒绝时**不能动任何状态**（藏品还在栏里），所以必须在消耗/落位之前挡。
  */
  if (item.grantsTrait && (def?.traits ?? []).includes(item.grantsTrait)) {
    const traitName = TRAIT_DEFS[item.grantsTrait]?.name ?? item.grantsTrait;
    return { ok: false, message: `${name} 本来就是【${traitName}】的干员，装不了这件转职` };
  }

  /*
    ★ 0.1.3 变形同构体：三条**用之前必须先确认**的条件，任何一条放到消耗之后，
    结果都是"白扔一件进阶藏品"（玩家只会觉得游戏坏了）：
      ① 干员身上已经有转职 —— 用户明确要求这时不能用；
      ② 干员一个"能转的羁绊"都没有（没有任何羁绊，或只有龙 / 领导人这种不产转职的）；
      ③ 穿戴藏品存放栏满了 —— 产出的那件转职没地方放。
  */
  if (item.onEquip?.prep?.kind === 'morphRelic') {
    const owned = traitRelicsOf(target);
    if (owned.length > 0) {
      const ownedName = ITEM_DEFS[owned[0]!]?.name ?? owned[0]!;
      return { ok: false, message: `${name} 身上已经有 ${ownedName} 了，用不了变形同构体` };
    }
    if (morphCandidatesOf(def).length === 0) {
      return { ok: false, message: `${name} 没有可以转的羁绊，变形同构体对他无效` };
    }
    if (freeSlotIndex(state.items.aSlots) < 0) {
      return { ok: false, message: `${ITEM_A_SLOTS} 格穿戴藏品栏满了，先腾一个位置再用变形同构体` };
    }
  }

  /*
    ★★ 0.3.2 升变之证（盟约「阿米娅 · 不容拒绝」）：
    装到**指定形态的阿米娅**身上才会生效，而且效果是"把这个棋子换成另一个棋子"。
    下面三条**必须**在消耗藏品之前判完 —— 证被吞了、棋子却没变，
    玩家的感受就是"这件藏品白扔了、游戏坏了"。
      · `from` 白名单：不是对应的阿米娅形态就拒绝（终态之证不能从 1 费直接跳）；
      · `minStar`：炉芯终曲要求 3 星；
      · `to` 必须真的存在（数据写错时宁可报错，也别把人变成空气）。
  */
  const ascend = item.onEquip?.ascend;
  if (ascend) {
    if (!ascend.from.includes(def?.id ?? '')) {
      const fromNames = ascend.from.map((id) => UNIT_DEFS[id]?.name ?? id).join(' / ');
      return { ok: false, message: `${item.name} 只能用在：${fromNames}` };
    }
    const needStar = Math.max(1, ascend.minStar ?? 1);
    if (target.star < needStar) {
      return {
        ok: false,
        message: `${item.name} 需要 ${needStar} 星（${name} 现在 ${target.star} 星）`,
      };
    }
    if (!UNIT_DEFS[ascend.to]) {
      return { ok: false, message: `${item.name} 的目标形态不存在（数据缺失：${ascend.to}）` };
    }
  }

  // ---- 前置条件全部通过，开始改状态 ----
  const notes: string[] = [];
  /*
    ★ 不管是哪一类，来源格子**都要清掉**：
      普通装备挂到干员身上（棋子在哪、装备就在哪），
      「立刻销毁」类当场用掉（它是道具，不是装备，所以不占装备位）。
    这里踩过一次：只在"销毁"那一支清了格子，普通装备那支忘了清 ——
    结果藏品**同时在栏里和身上**，等于白送一件。
  */
  /*
    ★★★ 清的是**来源那一格**。特别注意：升变之证走专用栏（`certSlots`）时，
      绝不能去清 `aSlots[slotIndex]` —— 两边的下标是**独立**的，
      那样会把穿戴藏品栏第 1~3 格里玩家自己攒的藏品凭空删掉。
  */
  if (from === 'cert') state.items.certSlots[slotIndex] = null;
  else state.items.aSlots[slotIndex] = null;
  if (consume) {
    // ★ 升变之证也是"消耗品"，但它会换形态，那句"已销毁"换成最后的"升变：A → B"
    if (!ascend) notes.push('已销毁');
  } else {
    target.items = [...equipped, itemId];
    /*
      ★ 0.2：新装上的这一件**从 0 层开始**（层数是逐副本记的）。
      设计稿里所有带成长的藏品都写着"卸下后层数重新叠加"，
      所以"新装上 = 0 层"和"卸下 = 丢掉那一份层数"是同一条规则的两面。
    */
    target.itemLayers = [...normalizeLayers(equipped, target.itemLayers), 0];
  }

  const onEquip = item.onEquip;
  if (onEquip?.gold) {
    state.economy.gold += onEquip.gold;
    notes.push(`金币 +${onEquip.gold}`);
  }
  if (onEquip?.hp) {
    const healed = applyPlayerHeal(state, onEquip.hp);
    notes.push(healed > 0 ? `血量 +${healed}` : '血量已满');
  }
  if (onEquip?.permanent === 'lostKey') {
    state.items.permanent.lostKey = true;
    notes.push('本局永久效果：失落之钥');
    /*
      ★★ 0.2 修（用户 2026-10-17）：「失落之钥在 10 级装备时不能获得金币」。
      50 金原本只在"升到满级那一刻"结算（买经验 / 每回合白送经验两条路）——
      可是**十级之后才装**的话，之后再也不会升级，那 50 金永远拿不到。
      所以装备这一刻补一次结算：已经发过的话 `lostKeyPaid` 会挡住，不会重复发。
    */
    const maxLevelGold = settleLostKeyMaxLevel(state);
    if (maxLevelGold > 0) notes.push(`满级奖励金币 +${maxLevelGold}`);
  }
  if (onEquip?.popCap) notes.push(`人口上限 +${onEquip.popCap}`);
  if (onEquip?.prep) notes.push(applyItemPrep(state, target, item));
  /*
    ★★ 0.3.2 升变：只换 `defId` —— 星级、装备（items）、逐副本层数、
    `extraTraits`（转职标签）全部原地保留，所以升变不会把玩家攒的东西洗掉。
    ★ uid 也不换：场上位置、拖动中的选中、卖出价计算都按 uid 走。
  */
  if (ascend) {
    const before = UNIT_DEFS[target.defId]?.name ?? target.defId;
    target.defId = ascend.to;
    const after = UNIT_DEFS[ascend.to]?.name ?? ascend.to;
    notes.push(`升变：${before} → ${after}`);
  }

  topUpGoldIfTestMode(state);
  state.message =
    `${name} 装备了 ${item.name}` + (notes.filter(Boolean).length > 0 ? `（${notes.filter(Boolean).join('，')}）` : '');
  return { ok: true, message: state.message };
}

/**
 * 把干员身上的某一件 A 类藏品卸下来，放回 A 类藏品栏。
 *
 * ★ 用户明确要求：「**仅在 A 类藏品格有位置时**可以卸下」。
 * 所以栏满就是不允许 —— 藏品总得有个地方去，总不能悄悄删掉。
 */
export function unequipItemFromUnit(
  state: GameState,
  uid: number,
  itemIndex: number,
): { ok: boolean; message: string } {
  const target = findItemTarget(state, uid);
  if (!target) return { ok: false, message: '找不到这个干员' };
  const items = equippedItemIds(target);
  const itemId = items[itemIndex];
  if (!itemId) return { ok: false, message: '这个装备位是空的' };

  const free = freeSlotIndex(state.items.aSlots);
  if (free < 0) {
    return {
      ok: false,
      message: `${zoneLabel('a')}满了（${ITEM_A_SLOTS} 格）—— 先删掉或装上一件，才能卸下`,
    };
  }

  const next = items.slice();
  next.splice(itemIndex, 1);
  target.items = next.length > 0 ? next : undefined;
  /*
    ★ 0.2：层数数组跟着一起摘掉那一位。
    层数是**逐副本**记的（见 ItemInventory.growth 的说明），卸下 = 这一份层数
    随之消失（设计稿："装备卸下后层数重新叠加"）。
  */
  {
    const layers = normalizeLayers(items, target.itemLayers);
    layers.splice(itemIndex, 1);
    target.itemLayers = layers.length > 0 && layers.some((n) => n > 0) ? layers : undefined;
  }
  state.items.aSlots[free] = itemId;
  /*
    ★ 0.1.1 藏品二版：卸下 = 成长层数清零（设计稿里凡是有成长的都写了这句）。
    A 类不会"卸下即销毁"，所以这里不用管返回值。
  */
  applyUnequipEffects(state, itemId);

  const def = UNIT_DEFS[target.defId];
  state.message = `卸下 ${ITEM_DEFS[itemId]?.name ?? itemId}（${def?.name ?? target.defId}）→ ${zoneLabel('a')}第 ${free + 1} 格`;
  return { ok: true, message: state.message };
}

/**
 * 把 B 类藏品装进共享装备位（拖拽落点 = 共享装备位的某一格）。
 *
 *   · 目标格是空的   -> 直接放进去
 *   · 目标格有东西   -> **交换**（和棋盘 / 备战席同一套语义，别让玩家记两套规则）
 *   · 「立刻销毁」类 -> 当场结算，**不占格子**，目标格保持原样
 *     （古旧残币、热水壶、无瑕宝玉、血魔的寝床、失落之钥都是这一类 ——
 *      它们是一次性道具，不是装备）
 */
export function equipSharedItem(
  state: GameState,
  slotIndex: number,
  equipIndex: number,
): { ok: boolean; message: string } {
  const itemId = state.items.bSlots[slotIndex];
  if (!itemId) return { ok: false, message: '这一格是空的' };
  const item = ITEM_DEFS[itemId];
  if (!item) return { ok: false, message: '藏品数据缺失' };
  if (item.slot !== 'B') {
    return { ok: false, message: `${item.name} 是穿戴藏品，要拖到干员身上` };
  }
  if (equipIndex < 0 || equipIndex >= ITEM_B_EQUIP_SLOTS) {
    return { ok: false, message: '共享装备位不存在' };
  }

  /*
    ★ 0.1.1 藏品二版：共享藏品里也有「装备后立刻销毁 + 往备战席塞一只棋子」的
    （人事部铜印 / 博士银印的随机招募）。
    空位检查必须在下面那段**消耗之前** —— 先销毁再发现备战席满了，玩家就白扔一件藏品。
  */
  if (prepPushesBenchUnit(item) && state.economy.bench.length >= BENCH_SLOTS) {
    return { ok: false, message: `备战席满了（${BENCH_SLOTS} 格），先腾一个位置再使用 ${item.name}` };
  }

  /*
    ★ 0.3.31：和 A 类那条同一个判据 —— 满血时别让纯回血藏品白销毁一件
    （热水壶带金币所以会放行，只有「血魔的寝床」这种纯回血会被拦）。
  */
  const healBlock = healBlockedReason(state, item);
  if (healBlock) return { ok: false, message: healBlock };

  const notes: string[] = [];
  const onEquip = item.onEquip;
  if (isConsumedOnEquip(item)) {
    state.items.bSlots[slotIndex] = null;
    notes.push('已销毁');
    state.message = `使用 ${item.name}`;
  } else {
    const swapped = state.items.bEquip[equipIndex] ?? null;
    state.items.bEquip[equipIndex] = itemId;
    // ★ 0.2：新放进去的这一件从 0 层开始（层数逐副本记，和格子下标对应）
    ensureEquipLayers(state);
    state.items.bEquipLayers[equipIndex] = 0;
    /*
      ★ 0.1.1：被换下去的那件也算"卸下"—— 成长层数清零；
      剑锤那种「再次卸下时装备销毁」的，就直接不回存放栏了。
    */
    const swappedDestroyed = swapped ? applyUnequipEffects(state, swapped) : false;
    state.items.bSlots[slotIndex] = swappedDestroyed ? null : swapped;
    state.message = swapped
      ? swappedDestroyed
        ? `${item.name} 顶掉了 ${ITEM_DEFS[swapped]?.name ?? swapped}（后者被销毁）`
        : `${item.name} 与 ${ITEM_DEFS[swapped]?.name ?? swapped} 交换了共享装备位`
      : `装备 ${item.name}（共享装备位 ${equipIndex + 1}）`;
  }

  if (onEquip?.gold) {
    state.economy.gold += onEquip.gold;
    notes.push(`金币 +${onEquip.gold}`);
  }
  if (onEquip?.hp) {
    const healed = applyPlayerHeal(state, onEquip.hp);
    notes.push(healed > 0 ? `血量 +${healed}` : '血量已满');
  }
  if (onEquip?.permanent === 'lostKey') {
    state.items.permanent.lostKey = true;
    notes.push('本局永久效果：失落之钥');
    /*
      ★★ 0.2 修（用户 2026-10-17）：「失落之钥在 10 级装备时不能获得金币」。
      50 金原本只在"升到满级那一刻"结算（买经验 / 每回合白送经验两条路）——
      可是**十级之后才装**的话，之后再也不会升级，那 50 金永远拿不到。
      所以装备这一刻补一次结算：已经发过的话 `lostKeyPaid` 会挡住，不会重复发。
    */
    const maxLevelGold = settleLostKeyMaxLevel(state);
    if (maxLevelGold > 0) notes.push(`满级奖励金币 +${maxLevelGold}`);
  }
  if (onEquip?.popCap) notes.push(`人口上限 +${onEquip.popCap}`);
  // ★ 0.1.1 藏品二版：共享藏品的备战效果（随机招募）—— 落点干员传 null
  if (onEquip?.prep) notes.push(applyItemPrep(state, null, item));

  topUpGoldIfTestMode(state);
  state.message += notes.length > 0 ? `（${notes.join('，')}）` : '';
  return { ok: true, message: state.message };
}

/** 把共享装备位里的藏品卸回共享藏品的存放栏（栏满则不允许） */
export function unequipSharedItem(state: GameState, equipIndex: number): { ok: boolean; message: string } {
  const itemId = state.items.bEquip[equipIndex];
  if (!itemId) return { ok: false, message: '这个共享装备位是空的' };
  const item = ITEM_DEFS[itemId];
  /*
    ★ 0.1.1：「卸下即销毁」的藏品（剑锤）不检查存放栏 ——
    它本来就不会回到栏里，卡在"栏满了不能卸"反而是 bug。
  */
  const destroyed = applyUnequipEffects(state, itemId);
  if (destroyed) {
    state.items.bEquip[equipIndex] = null;
    // ★ 0.2：这一格副本的层数也跟着作废（层数逐副本记）
    ensureEquipLayers(state);
    state.items.bEquipLayers[equipIndex] = 0;
    state.message = `卸下 ${item?.name ?? itemId} —— 该藏品被销毁（增长属性随之消失）`;
    return { ok: true, message: state.message };
  }
  const free = freeSlotIndex(state.items.bSlots);
  if (free < 0) {
    return { ok: false, message: `${zoneLabel('b')}满了（${ITEM_B_SLOTS} 格）—— 先删掉一件，才能卸下` };
  }
  state.items.bEquip[equipIndex] = null;
  // ★ 0.2：卸下这一件 = 它这一份层数一起消失（同 A 类的口径）
  ensureEquipLayers(state);
  state.items.bEquipLayers[equipIndex] = 0;
  state.items.bSlots[free] = itemId;
  state.message = `卸下 ${ITEM_DEFS[itemId]?.name ?? itemId} → ${zoneLabel('b')}第 ${free + 1} 格`;
  return { ok: true, message: state.message };
}

/**
 * ★ 0.0.3 需求 4：**同一栏内**两件藏品互换位置（把藏品拖到同栏的另一格）。
 *
 * 【为什么单独一个函数，而不是复用 equipSharedItem？】
 * 因为语义完全不同：`equipSharedItem` 是"从存放栏装进共享装备位"（跨栏、可能触发
 * 立即销毁类的 onEquip 效果），而这里只是**两个格子的位置对调** ——
 * 不碰任何 onEquip、不改动任何数值，纯排序。
 * 合成/装载那套逻辑一旦掺进来，就会出现"拖一下顺手又吃了一件消耗品"的怪事。
 *
 * 【三栏都支持】
 * 穿戴藏品栏（10）/ 共享藏品栏（5）/ 共享装备位（4）都能拖着重排。
 * 共享装备位的顺序是有意义的（界面按格子画"当前生效的共享藏品"），
 * 存放栏的顺序决定"下次获得的藏品进哪一格"，所以三栏都值得能排。
 *
 * @param fromIndex 被拖起来的那一格
 * @param toIndex   松手落下的那一格（可以是空格 = 相当于移动）
 */
export function swapItemsInZone(
  state: GameState,
  zone: ItemZone,
  fromIndex: number,
  toIndex: number,
): { ok: boolean; message: string } {
  const list = zoneList(state.items, zone);
  if (fromIndex === toIndex) return { ok: false, message: '位置没变' };
  const size = list.length;
  if (fromIndex < 0 || fromIndex >= size || toIndex < 0 || toIndex >= size) {
    return { ok: false, message: '格子不存在' };
  }
  const moving = list[fromIndex];
  if (!moving) return { ok: false, message: '这一格是空的' };

  // 直接对调（目标是空格也没关系：那就是"往后挪一格"）
  const target = list[toIndex] ?? null;
  list[toIndex] = moving;
  list[fromIndex] = target;
  /*
    ★ 0.2：共享装备位里的**层数是跟着格子下标走的**（`bEquipLayers[i]`），
    所以挪动藏品时层数必须一起挪 —— 否则「5 层的那件」和「0 层的那件」
    换个位置，层数就跳到别人头上了（界面上看就是"挪一下就少了几层"）。
  */
  if (zone === 'bequip') {
    ensureEquipLayers(state);
    const layers = state.items.bEquipLayers;
    const movingLayers = layers[fromIndex] ?? 0;
    layers[fromIndex] = layers[toIndex] ?? 0;
    layers[toIndex] = movingLayers;
  }

  const movingName = ITEM_DEFS[moving]?.name ?? moving;
  state.message = target
    ? `${movingName} 与 ${ITEM_DEFS[target]?.name ?? target} 交换了位置（${zoneLabel(zone)}）`
    : `${movingName} 移到 ${zoneLabel(zone)}第 ${toIndex + 1} 格`;
  return { ok: true, message: state.message };
}

/**
 * 删除一件藏品（拖到面板最下方那个「删除藏品」区）。
 *
 * 【为什么三种格子都能删？】
 * 因为删除区的语义就是"这件我不要了"：存放区的、以及已经装到共享装备位里的，
 * 都应该能直接丢（丢掉共享位上的那件就顺手腾出一个共享格）。
 *
 * ★ 挂在**干员身上**的 A 类藏品不能在这里删 —— 那得先回干员详情页卸下来。
 *   这样"删装备"永远不会顺手把某个干员的战力也削了。
 */
export function deleteItem(
  state: GameState,
  zone: ItemZone,
  index: number,
): { ok: boolean; message: string } {
  const list = zoneList(state.items, zone);
  const itemId = list[index];
  if (!itemId) return { ok: false, message: '这一格是空的' };
  list[index] = null;
  // ★ 0.2：共享装备位删掉一件 = 那一格副本的层数也作废
  if (zone === 'bequip') {
    ensureEquipLayers(state);
    state.items.bEquipLayers[index] = 0;
  }
  state.message = `删除了 ${ITEM_DEFS[itemId]?.name ?? itemId}（${zoneLabel(zone)}）`;
  return { ok: true, message: state.message };
}

/**
 * 把若干件藏品塞回它该去的那一栏，返回塞不下的。
 *
 * 【给谁用？】棋子带着装备被卖掉 / 被合成吃掉的时候 ——
 * 装备必须**回到库里**，绝不能跟着棋子一起消失。
 * 库满了就把剩下的返回给调用方去告诉玩家，绝不静默丢弃
 * （静默丢装备是最让人上火的一类 bug）。
 */
export function returnItemsToStorage(state: GameState, itemIds: readonly string[]): string[] {
  if (itemIds.length === 0) return [];
  const { a, b } = splitByZone(itemIds);
  return [...pushItemsIntoZone(state.items, 'a', a), ...pushItemsIntoZone(state.items, 'b', b)];
}

// ============================================================
// 羁绊
// ============================================================

/**
 * 计算当前场上的羁绊状态。
 *
 * 【注意：只统计「场上」的干员，备战席上的不算】
 * 这是自走棋的通用规则 —— 羁绊看的是实际参战阵容。
 * 所以你把一个干员从场上收回备战席，羁绊可能就断了。
 */
export function currentTraits(state: GameState): TraitStatus[] {
  /*
    ★ 0.1.3：**必须走 withExtraTraits** —— 转职藏品给的羁绊标签就在这里补进来。
    以前这里是手挑 `defId / star / cell` 三个字段重建 placement，新加的
    `extraTraits` 被静默丢掉，于是"转了职、界面上羁绊人数却没变"
    （这正是玩家报的「装备上干员没有触发相应的羁绊」）。
    ★ 以后要在这里挑字段的话，先想想会不会又把某个字段漏掉。
  */
  const placements: UnitPlacement[] = state.placements.map((p) => withExtraTraits(p));
  return traitsOfPlacements(placements);
}

/**
 * ★ 0.1.1：给**任意一份**阵容算羁绊状态。
 *
 * 存在的理由只有一个：观战时要把别人的羁绊照原样显示出来，
 * 而那个人的阵容只存在于服务器广播里（`prepTeams`）。
 * 算法必须和自己那一栏是同一个 —— 不然"看着他有 4 剑士、他自己那边显示 3"
 * 这种事迟早会发生。所以这里只是把 buildTraitStatus 包一层，
 * 不新写任何规则。
 */
export function traitsOfPlacements(placements: UnitPlacement[]): TraitStatus[] {
  return buildTraitStatus(placements, UNIT_DEFS, TRAIT_DEFS);
}

/** 只返回已经生效的羁绊（界面上高亮显示那些） */
export function activeTraits(state: GameState): TraitStatus[] {
  return currentTraits(state).filter((t) => t.activeAt !== null);
}

// ============================================================
// 战斗
// ============================================================

/**
 * ★ 0.1.2 测试模式：读某张卡的**基础数值覆盖**。
 *
 * @param uid 棋子的唯一编号（场上和备战席共用一套编号，跟着棋子走）
 * @returns 覆盖（面板单位，见 shared 的 UnitStatOverride）；没改过就是 undefined
 *
 * 【为什么要有这个访问器？】
 * "同一件事只允许一处实现" —— 界面要读它（详情页的 ▲▼、编辑面板回填）、
 * 上报要给内核（`toSubmittedTeam`）。两边各写一遍取法，
 * 以后存储方式一变就会漏掉一处（而且漏的那处往往是安静的）。
 */
export function unitStatOverrideOf(state: GameState, uid: number): UnitStatOverride | undefined {
  const found = state.testUnitStats[uid];
  if (!found || Object.keys(found).length === 0) return undefined;
  return found;
}

/**
 * ★ 0.1.2 测试模式：设置 / 清除某张卡的基础数值覆盖。
 *
 * 【传 null / 全空对象 = 清除】
 * 清除而不是留一条空记录：牌库账目、上报体积、以及"这张卡到底改没改过"
 * 的判断都会更干净。
 *
 * ★ 只在测试模式用。它**不做任何权限/模式检查** —— 检查放在界面那一层
 * （入口只有一个「数值修改」开关），内核只负责"给我什么就用什么"。
 */
export function setUnitStatOverride(
  state: GameState,
  uid: number,
  override: UnitStatOverride | null,
): void {
  if (!override || Object.keys(override).length === 0) {
    delete state.testUnitStats[uid];
    return;
  }
  state.testUnitStats[uid] = { ...override };
}

/**
 * ★ 0.0.3：把当前阵容转成**要发给服务器的那份原始输入**。
 *
 * 【为什么不直接在联机代码里手写一遍 `{defId, star, cell}`？】
 * 因为那一份**漏过 items** —— 加藏品时只在 `toTeamSetup` 里补了字段，
 * 联机那条手抄的路没跟着补，结果联机时 A 类藏品效果全丢，
 * 而且完全静默（界面照样显示"已装备"）。
 * 现在 `toTeamSetup` 和联机提交**共用这一个函数**，以后再加字段只可能漏一处。
 *
 * 【它和 toTeamSetup 的关系】
 * `toTeamSetup` = `toSubmittedTeam` 的产物 + 服务端/内核才需要的那堆解析结果。
 * 客户端发给服务器的只需要原始输入 —— 羁绊、机制那些由服务器自己算。
 */
export function toSubmittedTeam(state: GameState): SubmittedTeam {
  const units: UnitPlacement[] = state.placements.map((placement) => {
    /*
      ★ 0.1.3：转职藏品给的**额外羁绊标签**。从 `items` 现推（见 extraTraitsOf）——
      不存独立状态，就不会在"卸下 / 互换 / 合成 / 卖出"某一条路径上忘了同步。
      内核读它来数羁绊人数、发成员加成；同时一起上报给服务器（观战与重连要用）。
    */
    const extraTraits = extraTraitsOf(placement);
    return {
      defId: placement.defId,
      star: placement.star,
      cell: { col: placement.cell.col, row: placement.cell.row },
      // ★ 0.2：装备 + **每件副本各自的层数**（carryUnitItems 会把两个数组对齐后一起带走）
      ...carryUnitItems(placement),
      /*
        ★ 0.1.2：`free` 也要报上去（"这枚棋子占牌库几张"，白送的写 true）。
        内核不读它，是给断线重连用的 —— 重连时要把服务器手里这份装回本地棋盘，
        而"白送的棋子"这件事只存在于客户端，不报就恢复不出来（卖出时会多还几张牌）。
      */
      free: placement.free,
      /*
        ★ 0.1.2 测试模式：「数值修改」改过的基础属性也要报上去。
        走同一个访问器（别在这里直接翻 `state.testUnitStats`）——
        以后如果存储方式变了，只有那个函数要改。
      */
      statOverride: unitStatOverrideOf(state, placement.uid),
      extraTraits: extraTraits.length > 0 ? extraTraits : undefined,
    };
  });
  /*
    ★ 0.1.1：备战席也要报上去（服务器以前对它一无所知）。
    两件事靠它：
      · 观战 —— 点别人看他棋盘时，能看到他手里还攒着什么；
      · 淘汰回库 —— 出局的人手上那些牌要还给共享牌库，不还就永远回不来了。
    `copies` 走 `poolCopiesOfUnit`（= shared 的 poolCopiesOf）——
    白送的棋子占 0 张，别在服务器那头另写一套判断。
    ★ 哪怕备战席是空的也要带上（空数组），否则卖掉最后一张时服务器还留着旧的，
      淘汰回库会凭空多还几张牌。
  */
  const bench: BenchUnitView[] = state.economy.bench.map((unit) => ({
    defId: unit.defId,
    star: unit.star,
    copies: poolCopiesOfUnit(unit),
  }));
  const shared = sharedItemIds(state.items);
  /*
    ★ 0.1.1 藏品二版：跨回合成长层数 + 未装载藏品数。
    和 = 一个字段（`itemState`），因为两者都是"只存在于客户端这一局"的结论：
      · growth     —— 仇名录按击杀、佣兵的饰物按胜场…（见 ItemGrowth）
      · unequipped —— 悲伤的红按"藏品栏里没装载的数量"加属性
    ★ 新字段必须一起进 `toTeamSetup`（本机预览）和联机提交这两条路 ——
      这里返回的对象两边都在用，所以只写一处。
  */
  const itemState = {
    ...(Object.keys(state.items.growth).length > 0 ? { growth: { ...state.items.growth } } : {}),
    unequipped: countUnequipped(state.items),
    /*
      ★ 0.1.4：**藏品栏本体**也要一起报（`bag`）。
      【它修的 bug】重连之后"没装载的藏品"全没了 —— 因为上面两个字段
      只够还原"成长层数和未装载**数量**"，还原不了**有哪几件**。
      见 shared/types.ts 的 ItemBagSnapshot。
      ★ 每一次都带上（哪怕全空）：空栏也要让服务器把旧的覆盖掉，
        否则"把藏品全部装上/卖掉之后重连"会凭空变回上一批（和 bench 空数组同一个道理）。
    */
    bag: {
      a: [...state.items.aSlots],
      b: [...state.items.bSlots],
      // ★ 0.3.2 升变之证专用栏（重连后证得还在 —— 它没有别的来源可以还原）
      cert: [...state.items.certSlots],
      permanent: { ...state.items.permanent },
      ...(Object.keys(state.items.gainedRound).length > 0
        ? { gainedRound: { ...state.items.gainedRound } }
        : {}),
    },
  };
  return {
    units,
    bench,
    sharedItems: shared.length > 0 ? shared : undefined,
    // ★ 0.2：共享藏品**逐副本**的层数（和 sharedItems 同下标、同顺序）
    ...(shared.length > 0 ? { sharedItemLayers: sharedItemLayerList(state.items) } : {}),
    playerContext: { gold: state.economy.gold, hp: state.economy.hp },
    itemState,
    // ★ 0.2 罗德岛跨回合叠层（和 itemState.growth 同性质：客户端算、原样上报）
    traitStacks: { ...state.traitStacks },
    // ★ 0.2 MujicaAve：fever 也一起上报（服务器只管存，重连时装回来）
    fever: { ...state.fever, treasures: [...state.fever.treasures] },
  };
}

/**
 * ★ 0.1.2 断线重连：把服务器回来的那份 `SubmittedTeam` **装回本地棋盘**。
 *
 * ============================================================
 *  【它解决什么？】"刷新页面之后还能回到对局"
 * ============================================================
 * 客户端的对局状态（金币、棋盘、备战席、藏品）**只在内存里**，
 * 刷新页面（F5）就全没了 —— 而 sessionStorage 里的重连令牌还在，
 * 所以人能回到**座位**上（血量、战绩是服务端的），但棋盘是空的。
 * 服务器手里其实有一份"你最近一次上报的阵容"（`submitTeam` 的原始输入，
 * 含 `playerContext.gold` 与 `itemState`），重连时随 `resumeState.myTeam` 发回来，
 * 这里把它装回本地 —— 于是刷新之后金币、棋子、站位、藏品成长层数都还在。
 *
 * 【代价：现在只剩一样东西恢复不了（如实写在注释里，别假装完备）】
 *   · **商店当前那 5 张牌** —— 商店是客户端本地掷的，服务端从来不知道；
 *     重连后会按同一颗种子重掷一次（种子 = 房间码 + playerId，见 playerShopSeed，
 *     身份保住了所以序列不会"整批重来"，但重新开局的那几张会和断开前不同）。
 *
 *   ★ 0.1.4：**藏品栏原来也恢复不了，现在可以了** —— `SubmittedTeam.itemState.bag`
 *     把存放区（aSlots / bSlots）、失落之钥状态、拿牌回合一起带回来了，
 *     见下面恢复 `bag` 那一段。以前"重连之后没装载的藏品全没了"就是这个缺口。
 *
 * 【为什么不干脆不做这件事，等玩家重开？】
 * 因为"网络抖一下就回到座位、但棋盘和金币全空"比断线更难受 ——
 * 那不是重连，那是重开一局。这份装回去的活儿值得写。
 *
 * @param submitted 服务端交回来的那份原始输入（`resumeState.myTeam`）
 */
export function applySubmittedTeam(state: GameState, submitted: SubmittedTeam): void {
  state.placements = submitted.units.map((unit) => ({
    uid: nextUid(),
    defId: unit.defId,
    star: unit.star,
    cell: { col: unit.cell.col, row: unit.cell.row },
    free: unit.free,
    ...carryUnitItems(unit),
  }));
  /*
    ★ 0.1.2 测试模式：把「数值修改」的覆盖一起装回来。
    【为什么必须重建这张表？】上面那一步用 `nextUid()` 造了全新的 uid，
    而覆盖是按 uid 存的 —— 不重挂的话，刷新页面之后改过的数值会**静默失效**
    （界面看起来一切正常，但打的还是白板）。
    重建（而不是合并）也顺手清掉了上一条快照留下的孤儿条目。
  */
  state.testUnitStats = {};
  submitted.units.forEach((unit, index) => {
    const placement = state.placements[index];
    if (!placement || !unit.statOverride) return;
    setUnitStatOverride(state, placement.uid, unit.statOverride);
  });
  /*
    备战席：`BenchUnitView` 报的是"占牌库几张"（copies），
    而本地要的是 `free` —— 用 `freeFlagFor` 反算，**不要在别处手写这个换算**
    （白送 / 投影升星 / 复制这三种情况的张数语义都在这一个函数里）。
  */
  state.economy.bench = (submitted.bench ?? []).map((unit) => ({
    uid: nextUid(),
    defId: unit.defId,
    star: unit.star,
    free: freeFlagFor(unit.star, unit.copies),
  }));
  if (typeof submitted.playerContext?.gold === 'number') {
    state.economy.gold = Math.max(0, Math.floor(submitted.playerContext.gold));
  }
  // 共享装备位（B 类藏品）：直接按 id 放回那 4 个格子，其余留空
  const shared = (submitted.sharedItems ?? []).filter((id) => Boolean(ITEM_DEFS[id]));
  state.items.bEquip = Array.from({ length: ITEM_B_EQUIP_SLOTS }, (_, index) => shared[index] ?? null);
  /*
    ★ 0.2：共享藏品**逐副本**的层数也要装回来。
    和 bEquip 同下标、同顺序（`shared` 已经滤掉了非法 id，所以两边一起滤）。
    丢掉它的话，刷新一次页面两个「圆石祭坛」的层数就全归零了。
  */
  state.items.bEquipLayers = state.items.bEquip.map((id, index) => (id ? layerAt(submitted.sharedItemLayers, index) : 0));
  /*
    ★ 0.1.4：**藏品栏本体**（存放区）—— 这一条修的是"重连之后没装载的藏品全没了"。

    【为什么以前会没？】
    上面那几行只恢复得了"装着的"：`units[].items`（穿在干员身上）和
    `sharedItems`（共享装备位）。而**攒着还没装**的那些（aSlots 10 格 / bSlots 5 格）
    以前压根没上报过 —— 于是重连时 `state.items` 还是刚 `createGameState` 出来的空栏，
    玩家看到的就是"东西没了，成长层数还在"。

    【为什么用 `restoreSlotArray` 而不是直接赋值？】
    服务器那份是**原始输入**（可能被改过、可能是旧版本），所以逐格校验：
    id 必须在 `ITEM_DEFS` 里、格子数按本版本的规格来 —— 和 `growth` 那段一个态度。
    顺手也把"格子变多/变少"这种版本差异夹平（多了截断、少了补 null）。
  */
  // ★ 0.2 罗德岛跨回合叠层：重连时一并装回来（否则刷新页面后层数归零）
  state.traitStacks = { ...(submitted.traitStacks ?? {}) };
  /*
    ★ 0.2 MujicaAve：fever 也要装回来。它比叠层更怕丢 ——
    那是玩家攒了好几轮才攒到的一笔资源，刷新一下页面就没了会非常难受。
    ★ 用 createFeverState 兜底，老数据（没有 fever 字段）拿到的是一份干净的空状态。
  */
  state.fever = submitted.fever
    ? { ...submitted.fever, treasures: [...submitted.fever.treasures] }
    : createFeverState();

  const bag = submitted.itemState?.bag;
  if (bag) {
    state.items.aSlots = restoreSlotArray(bag.a, ITEM_A_SLOTS);
    state.items.bSlots = restoreSlotArray(bag.b, ITEM_B_SLOTS);
    // ★ 0.3.2 升变之证专用栏：重连后证必须还在（它没有别的来源可以还原）
    state.items.certSlots = restoreSlotArray(bag.cert, AMIYA_CERT_SLOTS);
    // 永久效果（失落之钥）：丢了它，重连之后这件藏品的效果会直接消失
    state.items.permanent = {
      lostKey: bag.permanent?.lostKey === true,
      lostKeyPaid: bag.permanent?.lostKeyPaid === true,
    };
    // "第几回合拿到"（剑锤的销毁计时）—— 丢了会重新从 0 开始算
    state.items.gainedRound = {};
    for (const [id, round] of Object.entries(bag.gainedRound ?? {})) {
      if (!ITEM_DEFS[id]) continue;
      const value = Math.max(0, Math.floor(Number(round) || 0));
      if (value > 0) state.items.gainedRound[id] = value;
    }
  }
  // 跨回合成长层数（仇名录击杀数、佣兵的饰物胜场数…）—— 内核只读结果，这里恢复输入
  const growth = submitted.itemState?.growth;
  if (growth) {
    state.items.growth = {};
    for (const [id, layers] of Object.entries(growth)) {
      if (!ITEM_DEFS[id]) continue;
      const value = Math.max(0, Math.floor(Number(layers) || 0));
      if (value > 0) state.items.growth[id] = value;
    }
  }
}

/**
 * 把场上阵容转成内核需要的 TeamSetup。
 *
 * 【关键：羁绊加成就这里算，算完塞进去】
 * 战斗内核完全不知道「羁绊」是什么，它只看到属性。
 * 这样两件事就永远一致：界面上显示吃到的加成 = 实际战斗里生效的加成。
 * （以前这里忘了算，结果羁绊面板显示"已生效"但战斗里其实没有任何效果。）
 *
 * 加成分两类，必须分开传：
 *   traitBonuses     全队型（领导人那种光环）
 *   unitTraitBonuses 本人型（剑士羁绊只给剑士）
 *
 * ★ @param team 这套阵容属于哪一队：0 = 蓝方/左半场，1 = 红方/右半场。
 *   普通单机 / 联机都留默认 0；测试模式的红色沙盒显式传 1（它的棋子摆在右半场）。
 *
 * ★ 0.0.3 藏品也在这里汇进去，三样东西：
 *   · `units[].items`   —— 每个干员**自己**的 A 类藏品（只作用于他一个人）
 *   · `sharedItems`     —— 共享装备位里的 B 类藏品（作用于全队）
 *   · `playerContext`   —— 玩家的金币 / 血量（金酒之杯、皇帝的新枪要看这两个数）
 *   注意 B 类的加成是**开战时**按这些信息折成固定值的，
 *   所以"界面上显示的加成 = 战斗里真正生效的加成"永远一致。
 */
export function toTeamSetup(state: GameState, team: 0 | 1 = 0): TeamSetup {
  const { units, sharedItems, sharedItemLayers, playerContext, itemState, fever } = toSubmittedTeam(state);
  if (units.length === 0) {
    return { team, units, sharedItems };
  }

  return {
    team,
    units,
    /*
      ★★ 0.3 盟约：全队加成和羁绊加成走同一条路。
      ★ 服务端 `Room.buildTeamSetup` 调的是**同一个** `covenantTraitBonuses` ——
        两边必须一致，否则联机会判"校验和不一致"。
    */
    traitBonuses: [
      ...computeTraitBonuses(units, UNIT_DEFS, TRAIT_DEFS),
      ...covenantTraitBonuses(state.covenantId),
    ],
    /*
      ★★ 0.3：盟约 id 也要进战斗 —— 「命结之秘」是内核里判的（见 `killUnit`）。
      ★ 服务端 `buildTeamSetup` 填同一份（= 玩家的 covenantId），否则两边的
        复活结果不同 ⇒ 校验和对不上。
    */
    covenantId: state.covenantId,
    unitTraitBonuses: computeUnitTraitBonuses(units, UNIT_DEFS, TRAIT_DEFS),
    activeTraits: computeActiveTraitLevels(units, UNIT_DEFS, TRAIT_DEFS),
    unitMechanics: resolveUnitMechanics(units, UNIT_DEFS, TRAIT_DEFS),
    sharedItems,
    // ★ 0.2：共享藏品逐副本层数（不传 ⇒ 内核按 0 层算，两件同款会显示不出层数）
    sharedItemLayers,
    playerContext,
    // ★ 0.1.1：假人 / 炎佑按回合成长，藏品按层数成长 —— 两个都要带上
    round: state.round,
    itemState,
    // ★ 0.2 罗德岛跨回合叠层
    traitStacks: { ...state.traitStacks },
    /*
      ★★ 0.2 MujicaAve：这一场要不要"开局强行放技能 + 免死窗口"。
      ★ 走 shared 的 `feverSkillOf` —— 服务端组阵容时调的是**同一个函数**，
        两边算出来必须一模一样，否则校验和对不上（症状是"打完卡住不结算"）。
    */
    feverSkill: feverSkillOf(fever),
  };
}

/** 开战前的自检 */
export function canStartBattle(state: GameState): { ok: boolean; message: string } {
  if (state.phase !== 'prep') return { ok: false, message: '现在不能开战' };
  if (state.placements.length === 0) return { ok: false, message: '先把干员放上场再开战' };
  return { ok: true, message: '' };
}

/**
 * 由玩家阵容推出一个种子。
 * 这样「同样的阵容永远打出同样的战斗」，方便反复调数值。
 */
export function seedFromTeam(team: TeamSetup): number {
  let h = 2166136261 >>> 0;
  const text = team.units.map((u) => `${u.defId}:${u.star}:${u.cell.col}:${u.cell.row}`).join('|');
  for (let i = 0; i < text.length; i++) {
    h = (h ^ text.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * ★★ 0.1.2 修：**把回合号混进战斗种子**。
 *
 * 【不混会怎样？—— 玩家报的"随机效果永远固定"】
 * 单机的战斗种子原来**只由我方阵容**推出来（`seedFromTeam(playerTeam)`）：
 * 棋盘不动 -> 每回合种子一模一样 -> 战斗里所有掷骰（生还者合约抽谁、
 * 铳骑之威掉不掉金币、突袭手雷第几下强化、闪避…）每回合落在**同一个结果**上。
 * 玩家看到的就是"随机是假的"。
 *
 * 混进回合号之后：
 *   · 每回合重新掷骰（"开战时随机判定"）；
 *   · 同一回合仍然可复现（同样的阵容 + 同样的回合 = 同样的战斗）—— 调数值照旧方便。
 *
 * 【联机为什么没这个问题？】
 * 服务端的种子是 `seedFor('battle:<回合>:<场次>')`（`room.ts`），本来就每回合不一样。
 */
export function seedForBattle(teamSeed: number, round: number): number {
  // 乘一个奇数常量再异或，最后走一遍 avalanche，避免"回合 1/2/3"只动低位
  let h = (teamSeed ^ Math.imul((Math.max(1, Math.floor(round)) * 2 + 1) | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/**
/**
 * ============================================================
 *  单机模式的敌人：一套"会成长"的阵容（0.0.2 重做）
 * ============================================================
 *
 * 【以前是什么样】
 * 每一回合都从牌库里**重新随机**一批敌人（旧版 enemyUnitsForRound）。
 * 规则本身不复杂，但玩家的感受很差：
 *   · 第 5 回合是 A 队、第 6 回合变成完全无关的 B 队 ——
 *     不像"在跟一个人打"，像在打一关又一关的随机遭遇战；
 *   · 上一回合好不容易摸清的阵容，下一回合一点用都没有。
 *
 * 【现在是什么样】
 * 第 1 回合随机出来之后，**就一直在那套阵容上升级**：
 * 第 N 回合的阵容 = 前 N-1 回合的操作累积出来的结果。
 * 所以"上一回合的敌人"必然还在场上（只会变强、或者最弱的那个被换掉），
 * 玩家的感受才是"在跟一个会运营的对手打"。
 *
 * 逐回合的明细、以及"人数封顶 8"这条硬约束，都写在
 * `game/enemy-lineup.ts` 里（纯函数，有单元测试）。
 * 这里只负责"把它接到游戏状态上"。
 *
 * ★ 对手的干员**不计入牌库、也不影响玩家的牌库**（ownedUnits 里不再包含它）。
 *
 * 【为什么难度还是只看回合数？】
 * 因为要让玩家能规划（"我第 6 回合必须成型"）。
 * 如果敌人跟着玩家的等级走，那"攒钱不升级"就会让对面也变弱，
 * "运营"这件事就没有意义了。
 */

/** 波次的一行人话描述，显示在顶部状态栏里 */
export function waveDescription(round: number, gameSeed = 0): string {
  // ★ 0.0.3：野怪回合显示野怪波次，其它回合显示人机阵容
  if (isMonsterRound(round)) return `野怪 · ${monsterWaveText(monsterWaveForRound(round))}`;
  return enemyLineupText(enemyLineupForRound(round, gameSeed));
}

/**
 * 生成对手阵容（单机模式）。
 *
 * ★ 布阵阶段显示的和开打时用的是**同一个函数**，所以"看到的"必然是"要打的"。
 * 这一点很重要：如果两边各算一次（比如一个用 UI 的临时状态、一个用战斗入口），
 * 迟早会因为参数不同而显示 A 队、打 B 队。
 *
 * ★ 0.0.3：野怪回合的对手是一波野怪（不是人机干员阵容）。
 * 野怪没有羁绊，所以直接给它一个只有 units 的 TeamSetup（字段都是可选的）。
 */
export function pickOpponent(state: GameState): TeamSetup {
  if (isMonsterRound(state.round)) return monsterTeamSetup(state.round, 1);

  const units = enemyPlacementsForRound(state.round, state.seed);
  // 对手也吃羁绊加成 —— 不然它会白吃亏，玩家凑羁绊就稳赢，没有挑战性
  return {
    team: 1,
    units,
    traitBonuses: computeTraitBonuses(units, UNIT_DEFS, TRAIT_DEFS),
    unitTraitBonuses: computeUnitTraitBonuses(units, UNIT_DEFS, TRAIT_DEFS),
    activeTraits: computeActiveTraitLevels(units, UNIT_DEFS, TRAIT_DEFS),
    unitMechanics: resolveUnitMechanics(units, UNIT_DEFS, TRAIT_DEFS),
  };
}

/**
 * 上一场战斗，**我**赢了没有？
 *
 * ============================================================
 *  ★ 必须按"我在哪一队"判断，不能写死队伍 0
 * ============================================================
 * 联机配对时服务器会把我随机分到队伍 0 或队伍 1。
 * 一开始的写法是 `winner === 0`，也就是"只有我在左边才算我赢" ——
 * 于是**被分到右边的玩家，赢了显示"战败"、输了显示"胜利"**。
 * 这个 bug 很坏：它不影响战斗本身（战斗是对的），
 * 只影响结算文案，所以你会先怀疑"是不是战斗算反了"。
 *
 * @param winner 战斗胜者（0 / 1 / null 平局）
 * @param myTeam 我在哪一队
 * @returns 我赢了 = true，我输了 = false，平局 = null
 */
export function didIWin(winner: 0 | 1 | null, myTeam: 0 | 1): boolean | null {
  if (winner === null) return null;
  return winner === myTeam;
}

/**
 * 客户端**该不该自己**推进到下一回合？
 *
 * ============================================================
 *  ★ 联机永远不该 —— 哪怕这一局已经打完了
 * ============================================================
 * 联机的回合由服务器推进（它算完战斗、等大家看完演出，再广播下一回合）。
 * 客户端自己推进就会和服务器错开。
 *
 * 【这里踩过一个很坑的 bug】
 * 原来"这一局打完了"是把 `netplayActive` 设成 false 来表示的。
 * 而"要不要自己推进回合"也看这个标志 —— 于是游戏一结束，
 * 客户端立刻认为"我现在是单机"，自己开了一局，
 * 对手是本地生成的人机阵容。玩家的观感就是
 * **"莫名其妙切回单人模式打固定的人机"**。
 * 现在"对局结束"用另一个标志（matchOver）表示，这条规则就干净了。
 */
export function shouldClientAdvanceRound(options: {
  /** 是否在联机对局里（**包括这一局已经结束**） */
  netplay: boolean;
  /** 当前回合号对应的生命值 */
  hp: number;
  phase: 'prep' | 'battle' | 'result';
  /** 玩家是不是还停在游戏界面上（回主界面了就不能再推进） */
  onGameView: boolean;
}): boolean {
  // 联机：回合由服务器说了算
  if (options.netplay) return false;
  // 只有"战斗播完了"这个阶段才谈得上进下一回合
  if (options.phase !== 'result') return false;
  // 已经回主界面了，别在背后偷偷推进
  if (!options.onGameView) return false;
  // 生命归零 = 这局结束
  if (options.hp <= 0) return false;
  return true;
}

/**
 * 「回放播完了，该不该收尾（`finishBattle`）？」
 *
 * ============================================================
 *  ★★ 这条判断踩过两次坑，两次都是"把联机的口径套到单机上"
 * ============================================================
 *   · 第一次（0.1.1）：不管正在看谁的那场，只要回放播完就收尾 ——
 *     旁观别人打、别人先播完时，直接拿**别人的战果**收了我自己的尾
 *     （日志/伤害统计/胜负横幅全串台，还提前替自己举了手）。
 *   · 第二次（0.1.2 末，用户报的「战斗回合结束后不会结束、不切回合」）：
 *     为了修第一次，加了"必须是在看自己那场"；而 `viewingBattleId` 只有**联机**的
 *     battleStart 才会赋值 —— 单机 / 测试沙盒里它恒为 null ⇒ 永远不收尾 ⇒
 *     战斗播完卡在战斗画面、`phase` 一直是 battle、回合永远不推进。
 *
 * 【正确口径】联机要看"正在看的是不是自己那场"（会有旁观）；
 * 单机 / 测试沙盒里看到的永远是自己那场，直接算 true。
 * 抽成纯函数是为了让这条口径能被测试钉住（别再修一次错一次）。
 */
export function shouldFinishBattle(options: {
  /** 回放是不是播到头了（`replay.isFinished`） */
  replayFinished: boolean;
  /** 是否在联机对局里 */
  netplay: boolean;
  /** 正在看的那一场（只有联机会赋值，单机恒为 null） */
  viewingBattleId: string | null;
  /** 我这一场的 id（同上） */
  currentBattleId: string | null;
}): boolean {
  if (!options.replayFinished) return false;
  // 单机 / 沙盒：没有旁观这回事，播完的就是自己那场
  if (!options.netplay) return true;
  // 联机：只有"正在看自己那一场"才允许收尾（旁观别人的不能替他收）
  return options.viewingBattleId !== null && options.viewingBattleId === options.currentBattleId;
}

/**
 * 这一局打输了，**本地**要扣多少血。
 *
 * ============================================================
 *  ★ 联机时必须返回 0 —— 这里原来多加了一次
 * ============================================================
 * 联机时血量是**服务器说了算**：服务器算完战斗就把新血量通过 `battleEnd` 发过来了。
 * 而客户端的战斗演出（本地重放）会**比服务器晚十几秒**结束 ——
 * 那时候如果按同样的规则再扣一次，就等于**一局扣两倍的血**。
 *
 * 症状很隐蔽：连接正常、校验和也对、战斗也播了，
 * 但两个人打几回合就"莫名其妙被打空血"结束 —— 看起来像对局进行不下去。
 *
 * 抽成纯函数是为了能用一条断言把它钉死（见 prep-rules.test.ts）。
 */
export function localHpLossForRound(options: {
  /** 本地重放算出来的胜者（0 = 我方赢，1 = 我方输，null = 平局） */
  winner: 0 | 1 | null;
  round: number;
  /** 是否联机对局 */
  netplay: boolean;
}): number {
  // 联机：血量以服务器为准，本地一点都不扣
  if (options.netplay) return 0;
  // 平局不扣血
  if (options.winner !== 1) return 0;
  /*
    越到后期扣得越多 —— 公式和服务器**共用同一个函数**。
    以前这里又抄了一遍 `2 + Math.floor(round/5)`，两处很容易改一处漏一处。
  */
  return damageForRound(options.round);
}

/**
 * 回合结算：发钱、自动刷新商店、进入下一回合。
 *
 * 【自动刷新商店放在这里，而不是放在界面代码里】
 * 因为这是「回合结束」这条规则的一部分，不是界面行为。
 * 放在 rules 里，以后搬到服务端时行为不会变；
 * 放在界面里的话，换个界面（或者服务端跑）就会漏掉。
 *
 * 【锁定的商店不刷新】
 * 玩家锁商店就是为了「保住这一批」，自动刷新时必须尊重这个意图。
 *
 * @param survivorDefIds 上一场战斗结束时**我方没死**的干员 id。
 *   奸商羁绊要看"谁活下来了"才给钱，所以要把这个传进来。
 *   不传就当作全员存活（比如中途没有战斗的回合）。
 *
 * @param battleGold ★ 0.0.3 藏品的**战利品**：上一场战斗里靠藏品掉的
 *   （铳骑之威击杀掉金 / 黄沙罗盘阵亡掉金）。由调用方用
 *   `battleGoldOf(currentResult.log, myTeam)` 数出来 —— 之所以不在这里自己读日志，
 *   是因为"日志在哪、我站哪一队"只有调用方知道（单机恒 0，联机可能被分到 1）。
 */
// ============================================================
//  ★★ 0.2 新机制：商店回合
// ============================================================
//
// 【它和"每回合都有的那个商店"（底部 5 格买干员）是什么关系？】
// 完全是两件事：
//   · 底部那 5 格是一直在的常规商店（刷新 2 金）；
//   · 商店回合是**野怪回合打完之后插入的 90 秒限时商店**，
//     额外卖**藏品**（普通/进阶/转职）和**一张 2 星干员**，还支持卖藏品换钱。
// 所以刻意没有复用 `state.economy.shop` —— 那个是"常规商店的货架"，
// 塞进同一个数组会让刷新逻辑、锁店逻辑、拖拽逻辑全部互相干扰。
//
// 【个人随机】货架用 `state.random`（每人自己的序列）生成 ⇒ 每个人看到的不一样。

/** 现在是不是商店回合 */
export function shopRoundActive(state: GameState): boolean {
  return state.phase === 'shop' && state.shopRound !== null;
}

/**
 * 进入商店回合（由 `advanceRound` 在野怪回合结算完自动调用）。
 *
 * ★ `round` **不动** —— 用户口径"不计入回合数"。
 */
/**
 * ★★ 这一次商店是不是**本局第一次**（唯一实现）。
 *
 * 【为什么不能直接写 `state.round <= FIRST_SHOP_ROUND`？】
 * `advanceRound` 里 **先** `state.round++`、**后**才调 `enterShopRound`，
 * 所以进第一次商店时 `state.round` 已经是 **10**（它结算的是第 9 回合）。
 * 早先直接拿 `state.round` 和 `FIRST_SHOP_ROUND`(=9) 比 ⇒ `10 <= 9` 恒为假
 * ⇒ `firstOfGame` **永远是 false**：
 *   · 盟约「特别优惠」的 3 次免费刷新一次都发不出来（用户报的就是这个）；
 *   · 藏品「失落之钥」也永远不会出现在商店回合里（同一个判据）。
 * 而三条门禁照样全绿 —— 因为测试里是直接 `enterShopRound(freshState)`（round=1），
 * 从没走过"回合号已经 +1"的真实路径。
 *
 * 判据改成看**刚刚结算完的那一回合**（`state.round - 1`），
 * 和 `isShopRoundAfter(settledRound)` 用同一个口径。
 */
export function isFirstShopOfGame(
  state: GameState,
  settledRound: number = state.round - 1,
): boolean {
  // 本地计数最准：已经开过商店了就不是第一次
  if (state.shopRoundCount > 0) return false;
  // 重连兜底：本地计数被重置成 0（state 是新建的），看"刚打完的回合"过没过第一次商店
  return settledRound <= FIRST_SHOP_ROUND;
}

export function enterShopRound(state: GameState): void {
  /*
    ★★ 0.2 修（用户 2026-10-17）：失落之钥**只在本局第一次商店出现**，
    而且买过之后永远不再出现（`permanent.lostKey` 一旦为真就再也刷不出来）。
  */
  const firstOfGame = isFirstShopOfGame(state);
  const allowLostKey = firstOfGame && !state.items.permanent.lostKey;
  state.shopRoundCount++;
  const shopRound: ShopRoundState = {
    open: true,
    mode: 'buy',
    secondsLeft: SHOP_ROUND_SECONDS,
    slots: rollShopRoundSlots(
      state.economy.level,
      state.random,
      (defId) => poolRemainingOf(state, defId),
      { allowLostKey },
    ),
    rerolls: 0,
    firstOfGame,
  };
  state.shopRound = shopRound;
  state.phase = 'shop';

  /*
    ★★ 0.3.1 特别优惠（坎诺特）：
      · 本局**第一次**商店 -> 前 3 次刷新免费（只在这一次商店有效）；
      · **每个**商店回合 -> 首件藏品 -2 金（每次进商店都重新给一次）。
    和 `firstOfGame` 用同一个判据：重连重建 state 时也不会把"第一次"判错。
  */
  const shopPerks = covenantShopPerks(state.covenantId);
  state.covenant.cannotFreeRerolls = shopPerks && firstOfGame ? shopPerks.freeRerolls : 0;
  state.covenant.cannotDiscountLeft = shopPerks ? 1 : 0;

  const perkText =
    shopPerks && firstOfGame
      ? ` · 盟约「特别优惠」：${shopPerks.freeRerolls} 次免费刷新、首件藏品 -${shopPerks.firstBuyDiscount} 金`
      : shopPerks
        ? ` · 盟约「特别优惠」：首件藏品 -${shopPerks.firstBuyDiscount} 金`
        : '';
  state.message = `商店回合：坎诺特来了（90 秒）${perkText}`;
}

/**
 * 新回合开始：把阶段设成布阵。
 *
 * ★★ 为什么不能直接写 `state.phase = 'prep'`？
 * `advanceRound` 里可能刚刚进了商店回合（野怪回合之后），那时候阶段是 `shop`。
 * 而调用方（单机 `nextRound` / 联机 `gameStarted`）在 `advanceRound` 之后
 * 都会习惯性地把阶段设回 `prep` —— 一设，商店回合就**当场被抹掉**，
 * 表现是"打完野怪什么都没发生"。
 * 所以"进入新回合该设成什么阶段"这一条**只在这一处实现**：
 * 商店回合还在就保持 `shop`，否则才回 `prep`。
 */
export function enterPrepPhase(state: GameState): void {
  if (shopRoundActive(state)) return;
  state.phase = 'prep';
}

/**
 * 商店回合倒计时（由主循环每帧调用）。
 *
 * ★★ 它顺手干的第二件事是「**被打断就收摊**」：
 * 商店回合是一个独立的 `shop` 阶段，但**别的东西也会改 `state.phase`** ——
 * 最典型的是联机：服务器到了点就直接开下一场战斗（客户端 phase 变 `battle`），
 * 它并不知道本地还开着一张商店。
 * 这时候如果不收摊，`state.shopRound` 会**永远留在那儿**：
 * 弹窗是不显示了（判据带 phase），但下一次只要再进一次商店就叠上新的一份，
 * 而且 90 秒的倒计时还在后台偷偷跑。
 * 所以"不是商店阶段了就把它清掉"这一条**只在这一处实现** ——
 * 不去每个 `state.phase = ...` 的赋值点补一句（那正是最容易漏的写法）。
 *
 * @returns `'timed-out'` = 90 秒到了、正常收摊；`'interrupted'` = 被别的事顶掉了
 * （联机里服务器到点开下一场）；`null` = 什么都没发生。
 * ★ 界面要靠它区分这两种 —— 被打断的时候**不能**弹"商店打烊了"，
 *   那时候画面已经在进战斗了，那句话是错的。
 */
export function tickShopRound(
  state: GameState,
  deltaSeconds: number,
): 'timed-out' | 'interrupted' | null {
  if (!state.shopRound) return null;
  if (!shopRoundActive(state)) {
    state.shopRound = null;
    return 'interrupted';
  }
  const shopRound = state.shopRound!;
  shopRound.secondsLeft -= deltaSeconds;
  if (shopRound.secondsLeft > 0) return null;
  state.shopRound = null;
  state.phase = 'prep';
  state.message = '商店打烊了 —— 继续布阵';
  return 'timed-out';
}

/**
 * **提前收摊**（玩家点「结束商店」）。
 *
 * 【为什么需要它？】
 * 用户口径：买完就该能直接走 —— 站着干等剩下的 60 秒纯属浪费。
 *
 * 【★ 联机里它只关"我自己的"商店】
 * 服务端那 90 秒是全房间同步的阶段，一个人点结束不能替别人关门。
 * 所以这里只是把**本地**的商店收掉、阶段回 prep（我接着布阵），
 * 服务端那一段照常走完 —— 别人的弹窗不受影响。
 */
export function closeShopRound(state: GameState): void {
  if (!state.shopRound) return;
  state.shopRound = null;
  if (state.phase === 'shop') {
    state.phase = 'prep';
    state.message = '提前收摊 —— 继续布阵';
  }
}

/** 开关商店弹窗（金币上方那个按钮） */
export function toggleShopRoundOpen(state: GameState): void {
  // ★ 0.2.1：淘汰的玩家连弹窗都打不开（`shopRoundUsable` 已含淘汰判据）
  if (!shopRoundUsable(state)) return;
  state.shopRound!.open = !state.shopRound!.open;
}

/** 购买页 / 售卖页 */
export function setShopRoundMode(state: GameState, mode: 'buy' | 'sell'): void {
  // ★ 0.2.1：淘汰的玩家不能切页签
  if (!shopRoundUsable(state)) return;
  state.shopRound!.mode = mode;
}

/** 下一次刷新要多少钱（界面显示和扣钱走同一个来源） */
export function shopRoundRerollPrice(state: GameState): number {
  /*
    ★ 0.3.1 特别优惠（坎诺特）：本局第一次商店的前 N 次刷新免费。
    界面读的就是这个函数，所以免费期间按钮上必须显示 0 ——
    否则玩家会以为"要 4 金"而不敢点。
  */
  if (state.shopRound && state.covenant.cannotFreeRerolls > 0) return 0;
  return rerollPriceOf(state.shopRound?.rerolls ?? 0);
}

/**
 * 花钱刷新货架。
 *
 * ★ 刷新次数**不清零**（`rerolls` 只增不减）—— 用户口径是"第 1 次 4、第 2 次 8…"，
 *   如果买走两格再刷新就降价，玩家可以靠"买空再刷"绕过涨价。
 */
export function rerollShopRound(state: GameState): { ok: boolean; message: string } {
  // ★ 0.2.1：淘汰的人一律不能碰商店（下同，四个入口共用一个判据）
  const blocked = shopBlockedByElimination(state);
  if (blocked) return blocked;
  if (!shopRoundActive(state)) return { ok: false, message: '现在不是商店回合' };
  const shopRound = state.shopRound!;
  /*
    ★ 0.3.1 特别优惠（坎诺特）：免费刷新**不推进涨价阶梯** ——
    "3 次免费刷新"用完之后，第 1 次付费刷新仍然只要 4 金（不是 16 金）。
    这也是 TFT 一类游戏的通行做法：免费次数是白给的，不该把后续价格顶上去。
  */
  const free = state.covenant.cannotFreeRerolls > 0;
  const price = free ? 0 : rerollPriceOf(shopRound.rerolls);
  if (!free && state.economy.gold < price) {
    return { ok: false, message: `刷新要 ${price} 金，还差 ${price - state.economy.gold} 金` };
  }
  if (free) {
    state.covenant.cannotFreeRerolls -= 1;
  } else {
    state.economy.gold -= price;
    noteCovenantSpending(state, price);
    shopRound.rerolls++;
  }
  shopRound.slots = rollShopRoundSlots(
    state.economy.level,
    state.random,
    (defId) => poolRemainingOf(state, defId),
    // ★ 刷新和第一次进货同一个口径（第一次商店内可以刷到，第二次商店起就没有了）
    { allowLostKey: shopRound.firstOfGame === true && !state.items.permanent.lostKey },
  );
  state.message = free
    ? `刷新商店（免费，盟约「特别优惠」剩余 ${state.covenant.cannotFreeRerolls} 次）`
    : `刷新商店（-${price} 金）`;
  return { ok: true, message: state.message };
}

/**
 * 把一个"2 星干员"放进备战席。
 *
 * ★ 为什么直接 `star: 2` 而不是塞 3 个一星让合成系统去合？
 *   因为牌库里那 3 张是**一起**被买走的，中间不存在"两张一星躺在备战席"的状态。
 *   直接给一个 2 星，`mergeAllUnits` 之后照样能和场上/席上的同名棋子合三星 ——
 *   合成是按"星级 + 同名"算的，不关心它是怎么来的。
 */
/**
 * ★ 0.3.3：货架上的 2 星干员**现在买下来放得下吗**。
 *
 * 【为什么要把它从 `placeTwoStarUnit` 里单独抽出来？】
 * 联机时买 2 星干员是**先问服务器**的（`buyCard(count: 3)`），
 * 而服务器一批准就**立刻从共享牌库扣掉 3 张**，本地才去落地。
 * 于是"备战席满了"这种情况会变成：牌扣了、棋子没到手 ——
 * 3 张牌凭空从共享牌库里消失（8 个人抢的就是这几张）。
 * 所以问之前必须先判一次，而这个判据**只能有一份**。
 */
export function shopRoundOperatorFits(state: GameState, defId: string): boolean {
  if (state.economy.bench.length < BENCH_SLOTS) return true;
  // 允许"买了正好合成"的情况（和常规商店同一个口径：见 buyShopSlot 的 allowFullBench）
  return (
    [...state.economy.bench, ...state.placements].filter(
      (unit) => unit.defId === defId && unit.star === OPERATOR_SLOT_STAR,
    ).length >= 2
  );
}

function placeTwoStarUnit(state: GameState, defId: string): { ok: boolean; message: string } {
  const def = UNIT_DEFS[defId];
  if (!def) return { ok: false, message: '干员数据缺失' };
  if (!shopRoundOperatorFits(state, defId)) {
    return { ok: false, message: `备战席满了（${BENCH_SLOTS} 格），先上场或卖掉一些` };
  }
  state.economy.bench.push({ uid: nextUid(), defId, star: 2 });
  mergeAllUnits(state);
  return { ok: true, message: `买下 2 星 ${def.name}` };
}

/**
 * 买一个货架。
 *
 * 【干员位为什么要单独一条路？】
 * 因为它要动**共享牌库**：单机时牌库是从"自己拥有的棋子"派生的（买了自然就少了），
 * 联机时必须先问服务器（`net.buyCard(defId, 3)`），批准了再走
 * `applyApprovedShopRoundOperator`。所以这里在联机时会被上层拦住。
 */
export function buyShopRoundSlot(state: GameState, index: number): { ok: boolean; message: string } {
  // ★ 0.2.1：淘汰的人一律不能碰商店
  const blocked = shopBlockedByElimination(state);
  if (blocked) return blocked;
  if (!shopRoundActive(state)) return { ok: false, message: '现在不是商店回合' };
  const slot = state.shopRound!.slots[index];
  if (!slot) return { ok: false, message: '这个格子不存在' };
  if (slot.sold) return { ok: false, message: '这一格已经卖掉了' };

  if (slot.kind === 'operator') {
    const defId = slot.defId;
    if (!defId) return { ok: false, message: '这一格没有货' };
    // 牌库得够 3 张才卖 2 星（用户口径"不会出现牌库已经不够的牌"）
    if (poolRemainingOf(state, defId) < OPERATOR_SLOT_COPIES) {
      return { ok: false, message: `${UNIT_DEFS[defId]?.name ?? defId} 牌库不够 3 张了` };
    }
    if (state.economy.gold < slot.price) {
      return { ok: false, message: `金币不够，还差 ${slot.price - state.economy.gold} 金` };
    }
    const placed = placeTwoStarUnit(state, defId);
    if (!placed.ok) return placed;
    state.economy.gold -= slot.price;
    noteCovenantSpending(state, slot.price);
    slot.sold = true;
    state.message = `${placed.message}（-${slot.price} 金）`;
    return { ok: true, message: state.message };
  }

  const itemId = slot.itemId;
  if (!itemId) return { ok: false, message: '这一格没有货' };
  /*
    ★ 0.3.1 特别优惠（坎诺特）：**每个**商店回合第一个购买的藏品 -2 金。
    "第一个"按"这一回合第一次成功买走藏品"算：买失败（钱不够 / 栏满了）不消耗折扣。
  */
  const perks = covenantShopPerks(state.covenantId);
  const discount =
    perks && state.covenant.cannotDiscountLeft > 0 ? Math.max(0, perks.firstBuyDiscount) : 0;
  const price = Math.max(0, slot.price - discount);
  if (state.economy.gold < price) {
    return { ok: false, message: `金币不够，还差 ${price - state.economy.gold} 金` };
  }
  // 先试着放进藏品栏 —— 放不下（栏满了）就不扣钱
  const added = addItem(state, itemId);
  if (!added.ok) return added;
  state.economy.gold -= price;
  noteCovenantSpending(state, price);
  slot.sold = true;
  if (discount > 0) state.covenant.cannotDiscountLeft = 0;
  state.message = `${added.message}（-${price} 金${discount > 0 ? `，盟约「特别优惠」-${discount}` : ''}）`;
  return { ok: true, message: state.message };
}

/**
 * 联机：服务器批准了这次"买 2 星干员"之后，本地收下。
 * 语义同 `applyApprovedBuy`：**不再查牌库**（服务器已经替我们扣了 3 张）。
 */
export function applyApprovedShopRoundOperator(
  state: GameState,
  index: number,
): { ok: boolean; message: string } {
  // ★ 0.2.1：淘汰的人一律不能碰商店
  const blocked = shopBlockedByElimination(state);
  if (blocked) return blocked;
  if (!shopRoundActive(state)) return { ok: false, message: '现在不是商店回合' };
  const slot = state.shopRound!.slots[index];
  if (!slot || slot.sold || slot.kind !== 'operator' || !slot.defId) {
    return { ok: false, message: '这一格已经卖掉了' };
  }
  if (state.economy.gold < slot.price) {
    return { ok: false, message: `金币不够，还差 ${slot.price - state.economy.gold} 金` };
  }
  const placed = placeTwoStarUnit(state, slot.defId);
  if (!placed.ok) return placed;
  state.economy.gold -= slot.price;
  noteCovenantSpending(state, slot.price);
  slot.sold = true;
  state.message = `${placed.message}（-${slot.price} 金）`;
  return { ok: true, message: state.message };
}

/** 可以卖的一件（界面上"售卖"页的一行） */
export interface SellableItem {
  /** 在哪一栏（a = 穿戴存放、b = 共享存放） */
  zone: ItemZone;
  /** 这一栏里的第几格 */
  index: number;
  itemId: string;
  price: number;
}

/**
 * 列出**没装备**的藏品（售卖页）。
 *
 * ★ 为什么正好是"a 栏 + b 栏"？
 *   · `a` / `b` 两栏是**存放区**（没装到任何干员身上）；
 *   · `bequip` 是**共享装备位**（装着 = 正在生效，不能卖）；
 *   · 挂在干员身上的 A 类藏品存在 `placement.items` 里，压根不在这些栏中。
 *   所以"存放区里的"天然就是"没装备的"，不需要再逐个比对 —— 用户口径正好对上。
 */
export function sellableShopRoundItems(state: GameState): SellableItem[] {
  const out: SellableItem[] = [];
  for (const zone of ['a', 'b'] as const) {
    const list = zoneList(state.items, zone);
    list.forEach((itemId, index) => {
      if (!itemId) return;
      out.push({ zone, index, itemId, price: sellPriceOfItem(itemId) });
    });
  }
  return out;
}

/** 卖掉一件没装备的藏品 */
export function sellShopRoundItem(
  state: GameState,
  zone: ItemZone,
  index: number,
): { ok: boolean; message: string } {
  // ★ 0.2.1：淘汰的人一律不能碰商店
  const blocked = shopBlockedByElimination(state);
  if (blocked) return blocked;
  if (!shopRoundActive(state)) return { ok: false, message: '现在不是商店回合' };
  if (zone === 'bequip') return { ok: false, message: '装备中的藏品不能卖，先卸下来' };
  const itemId = zoneList(state.items, zone)[index];
  if (!itemId) return { ok: false, message: '这一格是空的' };
  const price = sellPriceOfItem(itemId);
  // 走 deleteItem 而不是自己抹 —— 删藏品的副作用（提示语/格子回收）只有一处实现
  const removed = deleteItem(state, zone, index);
  if (!removed.ok) return removed;
  state.economy.gold += price;
  state.message = `卖出 ${ITEM_DEFS[itemId]?.name ?? itemId}（+${price} 金）`;
  return { ok: true, message: state.message };
}

/**
 * ★★ 0.3.2 阿米娅（任意形态）现在的**最高星级**；没有她 = 0。
 *
 * 升变任务第二阶段要求"三星形态"。形态可能在场上、也可能还坐在备战席，
 * 两处都算 —— 和合成、和商店"已拥有"用同一个家族口径（`familyKeyOf`）。
 */
export function amiyaStarOf(state: GameState): number {
  let star = 0;
  for (const unit of [...state.placements, ...state.economy.bench]) {
    if (familyKeyOf(unit.defId) !== AMIYA_BASE_ID) continue;
    star = Math.max(star, unit.star);
  }
  return star;
}

/** 这条盟约的升变任务进度（没选它 = null，界面据此决定要不要显示进度条） */
export function amiyaQuestOf(state: GameState): AmiyaQuestProgress | null {
  /*
    ★★ 0.3.2：**测试模式也放行**（用户报"测试模式里阿米娅伤害不累计"）。
    原因是测试模式进对局时根本没有盟约（`covenantId` 为空），
    这条判据直接返回 null —— 于是任务不统计、进度条也不显示，
    等于没法在沙盒里验证这套玩法。
    测试模式本来就是"随便试"，让它按"已经选了这条盟约"处理最省事；
    真对局仍然只对选了「不容拒绝」的玩家生效。
  */
  if (state.covenantId !== AMIYA_COVENANT_ID && !state.testMode) return null;
  return state.covenant.amiyaQuest;
}

/**
 * ★★ 0.3.2：把"条件已经满足"的任务推到 `awaiting`。
 *
 * 【为什么不在这里直接发证？】
 * 用户口径：**布阵阶段**才发（一阶段弹窗二选一，二阶段直接发）。
 * 结算发生在"上一场打完、下一回合还没布阵"的瞬间，那时候玩家还在看战报，
 * 弹窗会打断他。所以这里只**记下"该发了"**，由界面在布阵阶段消费掉。
 *
 * ★ 只推 `none → awaiting`，发完证由界面改成 `claimed` —— 幂等，
 *   多调几次也不会重复发。
 */
export function advanceAmiyaQuest(state: GameState): void {
  const quest = amiyaQuestOf(state);
  if (!quest) return;
  if (quest.stage1 === 'none' && amiyaQuestStage1Done(quest)) quest.stage1 = 'awaiting';
  if (
    quest.stage2 === 'none' &&
    amiyaQuestStage2Done(quest, amiyaStarOf(state), state.economy.level)
  ) {
    quest.stage2 = 'awaiting';
  }
}

export function advanceRound(
  state: GameState,
  won: boolean | null,
  survivorDefIds?: ReadonlySet<string>,
  battleGold = 0,
  killedMonsters: readonly { defId: string; tick: number }[] = [],
  /**
   * ★ 0.1.1 藏品二版：这一场**击倒的非野怪敌人数量**（仇名录的成长层数）。
   * 由调用方从战斗日志里数出来（只有它知道"我站哪一队"）。
   * 野怪回合的调用方直接传 0 —— 设计稿写明"野怪不算"。
   */
  killedEnemies = 0,
  /**
   * ★ 0.2 MujicaAve：这一场内核数出来的 fever（`BattleResult.feverGained[我的队伍]`）。
   * 传 0 = 这一场没攒到（或者调用方是野怪回合 / 老调用点）。
   */
  feverGained = 0,
  /**
   * ★★ 0.3.2 盟约「阿米娅 · 不容拒绝」：这一场**阿米娅（任意形态）造成的伤害**。
   * 由调用方从战斗日志里数（只有它知道这一场站哪一队），野怪回合传 0。
   */
  amiyaDamage = 0,
): {
  gold: number;
  breakdown: string;
  shopRefreshed: boolean;
  round: number;
  drop: MonsterDropResult;
  /**
   * ★ 0.2：这一回合跨过 fever 新档位时发的宝藏（没有 = null）。
   * 界面拿它写一段**显眼**的日志（不只是塞进回合那句话）。
   */
  feverTreasure: FeverTreasureResult | null;
} {
  // 羁绊给的经济收益（奸商那种）也要在回合结算时算进去
  const traitGold = computeTraitGold(
    state.placements.map((p) => ({ defId: p.defId, star: p.star, cell: { col: p.cell.col, row: p.cell.row } })),
    UNIT_DEFS,
    TRAIT_DEFS,
    survivorDefIds,
  );
  /*
    ★ 藏品给的每回合收入（至宝指环 / 幸运硬币）。
    幸运硬币只在"这一回合输了"时给钱 —— 用 `won === false` 判定，
    因为设计稿写的是「回合结束后触发连败时获得 1 金币」。
  */
  const itemGold = itemRoundGold(state.items, won === false);
  /*
    ★ 0.1.1：黑流树海笔记的"每 5 层有 1% 概率额外 1 金"。
    它在**胜利后**判定，所以和上面那条每回合固定收入分开算。
  */
  const growthGold = itemGrowthGold(state, won);
  /*
    ★ 0.0.3：`battleGold` 是上一场战斗里掉的战利品（藏品概率触发，见参数说明），
    它不是在"回合开始"算出来的，而是调用方从战斗日志里数出来的一个数。
  */
  /*
    ★ 0.1.1：野怪回合的胜负**不计入连胜/连败** —— 层数保持原值（不加也不清零）。
    判据用"正在结算的这个回合"（`state.round` 还没 ++），和野怪波次的判定同源，
    不会出现"界面算它是野怪回合、经济算它不是"这种两套账。
  */
  const streakCounts = !isMonsterRound(state.round);
  /*
    ★★ 0.3.2 阿米娅升变任务：每场**真人**战斗结束记一笔。
      · 只对选了「不容拒绝」的玩家生效（`amiyaQuestOf` 会挡）；
      · **野怪回合不算**（用户口径）—— 野怪是白给的战力，
        拿它刷任务等于"任务进度和玩法无关"；
      · 「参战」= 阿米娅（任意形态）这一场**在场上**（`placements`）；
        坐在备战席不算参战，否则"买了就躺"也能刷；
      · 伤害由调用方从战斗日志里数出来传进来。
  */
  if (!isMonsterRound(state.round)) {
    const quest = amiyaQuestOf(state);
    /*
      ★★ 判据里必须有「这一场真的打了」：`won !== null || amiyaDamage > 0`。
      为什么？—— 重连之后 `GameState` 是重建的，而联机流程仍会走一次
      `settleNetplayRound()`，那时候 `currentResult` 是 null（没有战报），
      `won` 也是 null。只判"她在场上"的话，**每重连一次就白送一场参战**
      （玩家刷新两下就凑够了任务）。有战报才有 `won`，这就够了。
    */
    if (quest && (won !== null || amiyaDamage > 0)) {
      if (state.placements.some((placement) => familyKeyOf(placement.defId) === AMIYA_BASE_ID)) {
        quest.battles += 1;
        if (won === true) quest.wins += 1;
        if (amiyaDamage > 0) quest.damage += Math.round(amiyaDamage);
      }
    }
    // 条件可能就在这一场之后满足了 -> 推到 awaiting，等布阵阶段发证
    advanceAmiyaQuest(state);
  }
  /*
    ★ 0.3 盟约：
      · 「利滚利」改的是**利息上限**（存到 70 金吃满 7 利息）；
      · 「私募基金」是**按回合号发的一笔钱**（第 6、13、20…回合各一次）。
    两条都从这里进结算（`settleRound` 那条路只认房间设置，不认盟约），
    所以放在调用点折算 —— 单机/联机共用这一处，不会出现"单机有、联机没有"。
  */
  const covenantCap = covenantInterestCap(state.covenantId);
  const maxInterest = covenantCap ?? state.rules.maxInterest ?? MAX_INTEREST;
  const covenantGold = covenantRoundGold(state.covenantId, state.round);
  const result = settleRound(
    state.economy,
    won,
    traitGold.gold,
    itemGold.gold + growthGold,
    battleGold,
    streakCounts,
    // ★ 0.3：每回合基础收入（房间设置里那一项；单机走默认 10）
    state.rules.incomeBase,
    maxInterest,
    // ★ 0.3 盟约：按回合号发的那笔钱（没选这类盟约 = 0）
    covenantGold,
  );
  // ★ 失落之钥：也可能是靠"每回合白送的 2 点经验"到满级的，这条路上也要发奖励
  const maxLevelBonus = settleLostKeyMaxLevel(state);
  // ★ 0.0.3：只有"无限金币"开着才补满；关掉之后正常结算（测试模式也能试真实经济）
  if (state.testMode && state.infiniteGold) state.economy.gold = TEST_MODE_GOLD;

  /*
    ★ 0.0.3：野怪回合的**击杀掉落**（掉落表见 shared/drop-data.ts）。
    【为什么放在这里？】
    因为单机和联机都走这一个 advanceRound —— 放这儿两边自动都有了，
    不用在"单机一条链、联机另一条链"里各写一遍（那种一定会漏一处）。

    【按什么掷？】
    按**这一场真的被打倒的野怪**逐只掷（由调用方从战斗日志里数出来，
    见 shared/drop-data.ts 的 killedDefIds）——
    打赢了就是整波都倒，输了只算真的打死的那些。
    早先这里写的是「赢了才掷、而且按整波掷」：
    结果**单机永远掷不到**（调用方那时已经把 currentResult 清掉了，
    `won` 恒为 null），玩家连着几局 1、2 回合一件藏品都拿不到。

    骰子用 `state.seed`（每个玩家自己的种子），所以联机时各掉各的，
    但每台机器自己算出来的结果是稳定的、可复现的。
  */
  const drop = grantMonsterRoundDrops(state, state.round, state.seed, killedMonsters);

  /*
    ★ 0.1.1 藏品二版：跨回合成长层数推进 + 剑锤那种"没装载就自动销毁"。
    顺序放在"掉落"之后、"回合 +1"之前 —— 用**刚刚结算完的那个回合号**，
    和掉落/连胜/波次判定同源，不会出现"界面算它第几回合、成长算另一回合"。
  */
  applyItemGrowthAfterBattle(state, { won, kills: killedEnemies, round: state.round });
  // ★ 0.2 罗德岛跨回合叠层：和藏品成长同处结算（同一个"这一场赢没赢"的判断）
  applyTraitStacksAfterBattle(state, { won });
  /*
    ★★ 0.2 MujicaAve：fever 也在这里结算 —— 理由和上面两条一模一样：
    只有这一处同时知道"这一场赢没赢""这一场攒了多少 fever""结算的是哪个回合"。
    ★ 野怪回合由 applyFeverAfterBattle 自己跳过（用户口径）。
  */
  /*
    ★★ 0.2 MujicaAve：fever 也要**写进这一回合的那句话里**（用户报"可能没有显示"）。
    羁绊面板那一行只在"羁绊生效"时才出现、而且数字小，
    而回合结算这句话每个回合都会顶在界面上 —— 攒到了多少、这一场涨了多少，
    玩家一眼就能看见。没攒到就不写（不拿"fever 共 0"去刷屏）。
  */
  const feverOutcome = applyFeverAfterBattle(state, { won, gained: feverGained, round: state.round });
  const feverText = feverOutcome.text;
  const feverTreasure = feverOutcome.treasure;
  const feverPart = feverText ? `· ${feverText} ` : '';
  const expiredItems = expireUnsocketedItems(state, state.round);

  // 回合结束自动换一批商店（免费，且尊重锁定）
  const shopRefreshed = !state.economy.shopLocked;
  if (shopRefreshed) doFreeRefreshShop(state);

  const settledRound = state.round;
  state.round++;
  /*
    ★★ 0.3 盟约：回合开始时的几项（变形同构第 4 回合发装备 / 猎头顾问每 2 回合充能 /
    博学多通升级奖励）。放在 round++ 之后 —— 判据里用的就是“现在是第几回合”。
    必须在这里调（而不是界面渲染时）：联机里回合推进是服务端驱动、客户端每个玩家各跑一次，两边都得算。
  */
  applyCovenantRoundStart(state);
  const lostKeyText = maxLevelBonus > 0 ? `· 失落之钥满级奖励 +${maxLevelBonus} 金 ` : '';
  const dropText = drop.items.length > 0 || drop.gold > 0 ? `· 野怪掉落 ${describeDrop(drop)} ` : '';
  // ★ 0.2：fever 宝藏那一句（明细由界面单独写进显眼的日志块）
  const treasurePart = feverTreasure ? `· fever ${feverTreasure.tier} 档宝藏：${feverTreasure.summary} ` : '';
  const expiredText = expiredItems.length > 0 ? `· ${expiredItems.join('、')} 逾期未装载，已自动销毁 ` : '';
  state.message = shopRefreshed
    ? `第 ${state.round} 回合开始 · 收入 ${result.gold} 金（${result.breakdown}）${lostKeyText}${dropText}${expiredText}${feverPart}${treasurePart}· 商店已刷新`
    : `第 ${state.round} 回合开始 · 收入 ${result.gold} 金（${result.breakdown}）${lostKeyText}${dropText}${expiredText}${feverPart}${treasurePart}· 商店已锁定，未刷新`;
  /*
    ★★ 0.2 商店回合：野怪回合（第 1、2 回合除外）打完之后，插一个 90 秒的商店。
    ★ 放在"这一回合那句话"之后 —— 让 `enterShopRound` 能把提示补在句尾，
      而不是被下面的 message 覆盖掉。
    ★ `state.round` 已经在上面 +1 了，所以判定用的是 `settledRound`（刚刚打完的那个）。
  */
  if (isShopRoundAfter(settledRound)) {
    enterShopRound(state);
    state.message += ' · 坎诺特来了，商店开张 90 秒';
  }

  // settledRound 是**刚刚结算完的那个回合**（界面往战斗中日志里写掉落时要标它）
  return { ...result, shopRefreshed, round: settledRound, drop, feverTreasure };
}

/** 把一次掉落写成一句人话（界面 toast 用） */
export function describeDrop(drop: { items: readonly string[]; gold: number; lost: number }): string {
  const parts: string[] = [];
  if (drop.gold > 0) parts.push(`${drop.gold} 金`);
  for (const id of drop.items) parts.push(ITEM_DEFS[id]?.name ?? id);
  if (drop.lost > 0) parts.push(`（${drop.lost} 件放不下，丢了）`);
  return parts.join('、') || '无';
}

/** 一次掉落里，**每一只被打倒的野怪**各掉了什么（界面日志用） */
export interface KillDropEntry {
  /** 被击杀的野怪 */
  defId: string;
  /** 掉了哪件藏品（没掉就是 undefined） */
  item?: string;
  /** 掉了几金（0 = 走的藏品那条路） */
  gold: number;
}

/** 一次野怪回合掉落的总结果 */
export interface MonsterDropResult {
  /** 掉了哪些藏品（按掉落顺序） */
  items: string[];
  /** 掉了多少金币 */
  gold: number;
  /** 有几件因为储物格满了被丢掉 */
  lost: number;
  /** 逐只击杀的明细（没击杀就是空数组） */
  kills: KillDropEntry[];
}

/**
 * ★ 0.0.3：布阵阶段"这只干员**现在**是多少数值"。
 *
 * 【为什么真的造一份战斗来算？】
 * 因为参与运算的东西太多了：星级、3 星质变、羁绊（全队型 + 本人型）、
 * 穿戴藏品、共享藏品的属性加成、队伍人数/金币这类条件……
 * 照着数据表自己再算一遍，必然和真开战时对不上 ——
 * 而"同一件事只允许一处实现"是这个项目的铁律（今天刚又踩过一次）。
 * 所以这里直接用**开战时的同一个入口**（`toTeamSetup` + `createBattle`）
 * 造一份阵容，把那枚棋子的最终属性读出来给界面。
 *
 * @returns 面板单位（攻速 = 每秒几次；其余都是面板上那个整数）。
 *   造不出阵容（比如场上一个人都没有）时返回 null，界面退回白板值。
 */
export function previewUnitStats(state: GameState, cell: Cell): UnitStatsPreview | null {
  const setup = toTeamSetup(state, 0);
  if (setup.units.length === 0) return null;

  let battle: BattleState;
  try {
    // 对手给一份空阵容：只是借 createBattle 把羁绊/藏品算出来，不模拟
    battle = createBattle(UNIT_DEFS, [setup, { team: 1, units: [] }], 1);
  } catch {
    return null;
  }
  const unit = battle.units.find((item) => item.cell.col === cell.col && item.cell.row === cell.row);
  if (!unit) return null;

  const mods = collectMods(battle, unit);
  return {
    hp: Math.round(unit.maxHp / FIX),
    attackDamage: Math.round(effectiveAttackDamage(unit, mods) / FIX),
    attackSpeed: effectiveAttackSpeed(unit, mods) / 1000,
    armor: Math.round(effectiveArmor(unit, mods) / FIX),
    magicResist: Math.round(effectiveMagicResist(unit, mods) / FIX),
    range: effectiveRange(battle, unit),
  };
}

/** 面板要显示的数值（全是面板单位，不是内核的定点数） */
export interface UnitStatsPreview {
  hp: number;
  attackDamage: number;
  /** 每秒攻击次数（1.2 = 每秒 1.2 下） */
  attackSpeed: number;
  armor: number;
  magicResist: number;
  range: number;
}

/**
 * 从一场战斗的日志里数出「某一队打死了哪些野怪」。
 *
 * 【为什么要单独包一层？】
 * `killedDefIds` 数的是"对面的单位死了哪些"（干员也算），
 * 而掉落只认野怪 —— 所以在这一层把 `monsterOnly` 过滤掉，
 * 调用方（界面）就不用自己再去查 UNIT_DEFS 了。
 *
 * ⚠️ 必须在 `currentResult` 被清掉**之前**调用（同 lastBattleWon）。
 */
export function monstersKilledBy(
  log: readonly BattleEvent[],
  team: 0 | 1,
): { defId: string; tick: number }[] {
  const foe: 0 | 1 = team === 0 ? 1 : 0;
  return killedDefIds(log, foe).filter((kill) => UNIT_DEFS[kill.defId]?.monsterOnly === true);
}

/**
 * ★ 0.1.1 藏品二版：从一场战斗的日志里数出「某一队打死了几个**非野怪**敌人」。
 *
 * 【为什么需要它？】
 * 仇名录的成长是「每击倒一名敌人 +1 层」，而设计稿同时写明"野怪不算" ——
 * 所以这里把 `monsterOnly` 的击杀过滤掉，剩下的就是真人对局里的阵亡数。
 *
 * 【为什么数和"哪几个"都要有？】
 * `monstersKilledBy` 返回的是**明细**（掉落要逐只掷骰 + 写日志），
 * 而成长只要一个**数量**。两边都是"从同一个 killedDefIds 出发"，
 * 过滤条件相反 —— 放在一起看才知道它们是一对，不会各写一份。
 *
 * ⚠️ 必须在 `currentResult` 被清掉**之前**调用（同 monstersKilledBy）。
 */
export function enemiesKilledBy(log: readonly BattleEvent[], team: 0 | 1): number {
  const foe: 0 | 1 = team === 0 ? 1 : 0;
  return killedDefIds(log, foe).filter((kill) => UNIT_DEFS[kill.defId]?.monsterOnly !== true).length;
}

/**
 * ★ 0.0.3：野怪回合的掉落。
 *
 * 【按什么掷？】
 * **按每一只被打倒的野怪各掷一次**（表头写的是"小怪掉落表 / 精英掉落表…"，
 * 也就是"打死一只这类怪掉什么"）。一波 5 只普通怪就是掷 5 次。
 * 储物格放不下的话，多出来的直接算丢了（并且如实写进文案，不静默吞掉）。
 *
 * @param killedMonsters 这一场被打倒的野怪（顺序就是击杀顺序，见 killedDefIds）
 * @param seed 战斗/房间种子 —— 同一个种子掷出同一套结果（可复现）
 */
/**
 * ★ 0.1.1：野怪回合"掉落金币"的加成（万分比）—— 骑士长枪专业版 +50%。
 *
 * 【为什么只乘"掉落的那部分"？】
 * 设计稿写的是"掉落金币 +50%"：只有野怪**真的掉了金币**（小怪 45% 掉 2 金、
 * 普通 30% 掉 4 金）才吃这个加成 —— 回合固定收入、铳骑之威那种战利品都不受影响。
 * 每只怪各算各的，向下取整（2 金 -> 3 金、4 金 -> 6 金）。
 */
export function monsterDropGoldBp(state: GameState): number {
  let bp = 0;
  for (const itemId of new Set(equippedItemIdList(state))) {
    bp += ITEM_DEFS[itemId]?.perRound?.monsterGoldBp ?? 0;
  }
  return bp;
}

export function grantMonsterRoundDrops(
  state: GameState,
  round: number,
  seed: number,
  killedMonsters: readonly { defId: string; tick: number }[] = [],
): MonsterDropResult {
  const empty: MonsterDropResult = { items: [], gold: 0, lost: 0, kills: [] };
  if (!isMonsterRound(round)) return empty;
  if (killedMonsters.length === 0) return empty;

  const rng = createDropRng((Math.imul((seed ^ Math.imul(round, 0x9e3779b1)) >>> 0, 0x85ebca6b) ^ 0x27d4eb2f) >>> 0);

  const items: string[] = [];
  const kills: KillDropEntry[] = [];
  let gold = 0;
  let lost = 0;
  // 骑士长枪专业版：野怪掉落的金币 +50%（只乘掉落那一部分）
  const goldBp = monsterDropGoldBp(state);
  for (const kill of killedMonsters) {
    const tier = UNIT_DEFS[kill.defId]?.monsterTier;
    // ★ 0.1.3：`special` 档（"左手"/血骑士/锏）**没有掉落表** —— 它们本来就不进野怪回合，
    //   真被发出来打死了也不掉东西（掉落表只登记了那 5 个档位）。
    if (!tier || tier === 'special') continue;
    /*
      ★ 0.2（用户 2026-10-17）：失落之钥买过之后**任何途径都不能再获得** ——
      野怪掉落也算一条途径，这里把它从那一组的抽取里跳过（组内重抽）。
    */
    const roll = rollDrops(tier, rng, (itemId) =>
      state.items.permanent.lostKey && itemId === LOST_KEY_ITEM_ID,
    );
    const droppedGold =
      roll.gold > 0 ? Math.floor((roll.gold * (10000 + goldBp)) / 10000) : 0;
    gold += droppedGold;
    const entry: KillDropEntry = { defId: kill.defId, gold: droppedGold };
    for (const itemId of roll.items) {
      if (addItem(state, itemId).ok) {
        items.push(itemId);
        entry.item = itemId;
      } else {
        lost++;
      }
    }
    kills.push(entry);
  }
  if (gold > 0) state.economy.gold += gold;
  return { items, gold, lost, kills };
}

/**
 * 把一次掉落写成**逐只击杀**的日志行（战斗日志面板用）。
 *
 * 【为什么连"没掉落"也写一行？】
 * 因为掉落是概率的（小怪 45% 掉金、剩下 55% 才掉藏品），
 * 只写掉出来的那些，玩家看不出"这只掷过但没中"，
 * 会以为是漏算了。写全了，概率对不对一眼就能看出来。
 */
export function killDropLines(drop: MonsterDropResult): string[] {
  return drop.kills.map((kill) => {
    const name = UNIT_DEFS[kill.defId]?.name ?? kill.defId;
    if (kill.item) return `击杀 ${name} · 掉落 ${ITEM_DEFS[kill.item]?.name ?? kill.item}`;
    if (kill.gold > 0) return `击杀 ${name} · 掉落 ${kill.gold} 金币`;
    return `击杀 ${name} · 没有掉落`;
  });
}

/** 给界面用：商店各费用的出现概率文案，例如「1费45% · 2费33% · …」 */
export function shopOddsText(level: number): string {
  const odds = SHOP_ODDS_BY_LEVEL[Math.max(1, Math.min(10, level))] ?? SHOP_ODDS_BY_LEVEL[1]!;
  return odds
    .map((bp, index) => (bp > 0 ? `${index + 1}费${Math.round(bp / 100)}%` : null))
    .filter((text): text is string => text !== null)
    .join(' · ');
}

export {
  ARENA_W,
  BENCH_SLOTS,
  BOARD_H,
  BOARD_W,
  BUY_XP_COST,
  REFRESH_COST,
  TEAM_0_MAX_COL,
  TEST_MODE_GOLD,
  UNIT_DEFS,
  rollShop,
};
// ★ 0.1.2：UnitStatOverride 一并转出去 —— 界面（属性修改面板）要用它的字段名
export type {
  BenchUnit,
  Cell,
  EconomyState,
  TeamSetup,
  TraitStatus,
  UnitDef,
  UnitPlacement,
  UnitStatOverride,
};
