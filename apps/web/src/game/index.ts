/**
 * 客户端游戏逻辑的统一出口。
 *
 * 这样 main.ts 只需要 import 一处：
 *   import { createGameState, placeUnit, ... } from './game/index.js'
 * 而不用记住每个东西在哪个文件里。
 * 内部文件怎么拆分是「隐私」，外面只看到这个门面。
 */
export * from './state.js';
// ★ 0.2 商店回合：纯数据 / 纯计算层（界面要读时长、价格、档位标签这些常量）
export {
  SHOP_ROUND_SECONDS,
  SHOP_SLOT_LIMITS,
  SHOP_BUY_PRICE,
  SHOP_SELL_PRICE,
  OPERATOR_SLOT_STAR,
  OPERATOR_SLOT_COPIES,
  rerollPriceOf,
  isShopRoundAfter,
  sellPriceOfItem,
  isItemSlot,
  SHOP_POOLS,
} from './shop-round.js';
export type { ShopSlotKind, ShopRoundSlot, ShopRoundState } from './shop-round.js';
// ★ 0.0.3 藏品（装备）：纯规则 + 库存结构（不碰状态，可单独测试）
// 界面要用它们画格子、校验"能不能装"、以及算派生数值
export {
  createItemInventory,
  countItems,
  freeSlotIndex,
  itemDefOf,
  itemPopCapBonus,
  itemRequirementError,
  itemRoundGold,
  // 0.1.1：效果栏 / 详情页的实时数值要按层数显示 —— 层数读取也只有一处
  growthOf,
  // ★ 0.2：逐副本层数的读写（两件同名藏品各叠各的）
  layerAt,
  normalizeLayers,
  sharedItemLayerList,
  pickTransformTarget,
  sharedItemIds,
  zoneLabel,
  zoneList,
  zoneSize,
} from './items.js';
export type { ItemInventory, ItemSlotRef, ItemZone } from './items.js';
// 布阵棋子的"排布计划"（纯函数、可测试）——
// 抽出来的原因见那个文件顶部：原来的同步函数漏了"移动"这一种变化
export { planPrepSprites, diffPrepSprites, shouldShowSoloEnemy, ENEMY_UID_BASE, isEnemyUid } from './prep-sprites.js';
export type { SpritePlan, SpriteDiff } from './prep-sprites.js';
// 单机对手的"成长表"（纯函数、可测试）——
// 第 1 回合随机出来之后一直在那套阵容上升级，不再每回合重随机
export {
  ENEMY_MAX_COUNT,
  ENEMY_SCHEDULE,
  enemyLineupForRound,
  enemyPlacementsFor,
  enemyPlacementsForRound,
  // ★ 0.0.3：唯一入口 —— 野怪回合出野怪，其它回合出人机
  opponentPlacementsForRound,
  enemyPower,
  enemyUnitHp,
} from './enemy-lineup.js';
export type { EnemyOp, EnemyPlacement, EnemyUnit } from './enemy-lineup.js';
// 数据表也从这个门面转出去，界面代码只需要 import 一处
export {
  TRAIT_DEFS,
  UNIT_DEFS,
  SHOP_ODDS_BY_LEVEL,
  BENCH_SLOTS,
  MAX_LEVEL,
  populationCap,
  xpNeededForLevel,
  TRAIT_EFFECT_LABEL,
  formatTraitEffect,
  formatTraitEffects,
  buildTraitStatus,
  RARITY_STYLES,
  rarityOfCost,
  rarityOf,
  // 布阵规则：最后几秒不显示别人的血量
  BLIND_HP_LAST_SECONDS,
  // 布阵时长（界面上要显示"布阵 60 秒"）
  PREP_SECONDS,
  // ★ 0.1.3：前 3 回合 30 秒、其余 60 秒 —— 界面文案和服务器共用一个函数
  prepSecondsForRound,
  // 连胜/连败：显示在金币旁边，也要在结算文案里说明钱从哪来
  streakBonusOf,
  streakLabelOf,
  // 技能：界面要按星级显示"这个棋子现在真正会放的那个技能"
  skillVariantOf,
  // ★ 0.0.3 藏品（装备）：数据表 + 容器容量（界面画格子、修改器下拉都要）
  ITEM_DEFS,
  NORMAL_ITEMS,
  ADVANCED_ITEMS,
  ITEM_A_SLOTS,
  ITEM_B_SLOTS,
  ITEM_B_EQUIP_SLOTS,
  ITEM_PER_UNIT,
  itemsOf,
} from '../../../../packages/shared/src/index.js';
// 纯坐标数学（零依赖、可测试）
export {
  ARENA_H,
  ARENA_W,
  CELL,
  BOARD_WORLD_W,
  BOARD_WORLD_H,
  cellToWorldPoint,
  cellToWorldFlipped,
  worldPointToCell,
  flipCell,
  viewToRawCell,
  rawToViewCell,
  isOnBoard,
  isPlayerHalf,
  pointerToNdc,
} from './grid.js';
export type { ViewportRect } from './grid.js';
// 羁绊的"战斗中机制"解析（谁身上挂什么行为）也从这个门面转出去
export {
  computeActiveTraitLevels,
  resolveUnitMechanics,
  computeTraitGold,
  survivorsOfTeam,
  // ★ 0.0.3 藏品：从战斗日志里数"这一队掉了多少战利品"
  //（铳骑之威击杀掉金 / 黄沙罗盘阵亡掉金，都是概率触发、必须照事件流算）
  battleGoldOf,
} from '../../../../packages/shared/src/index.js';
// 战斗日志 + 我方伤害统计（纯函数、有单元测试）
export {
  teamOfUnitId,
  unitIdOf,
  isMyUnit,
  formatDamage,
  applyEventToStats,
  statsUpTo,
  linesUpTo,
  sortedStats,
  formatEvent as formatEventView,
  // 羁绊详情日志（第 6 条需求：实时进度 + 发动提示 + 谁在吃加成）
  applyTraitEvent,
  emptyTraitLog,
  isTeamSharedProgress,
  topProgress,
  traitLogUpTo,
  traitNameOf,
} from './battle-log.js';
export type {
  UnitBattleStats,
  LogLine,
  TimedLogLine,
  StatsMap,
  TraitLogState,
  TraitProgressRow,
  TraitCarrierRow,
} from './battle-log.js';// 3D 场景（依赖 Three.js，只能在浏览器里跑）
export { cellToWorld, worldToCell, createBoardScene } from '../three/board.js';
export { BattleReplay } from '../three/replay.js';
export { createUnitSprite, restyleUnitSprite, updateUnitSprite, getUnitTexture } from '../three/sprite-graphics.js';
// 内核里客户端会用到的部分，也从这个门面转出去，
// 这样界面代码不需要知道「哪些东西来自内核、哪些是客户端自己的」
export {
  createBattle,
  simulate,
  TICKS_PER_SECOND,
  MANA_MAX,
  MAX_BATTLE_TICKS,
} from '../../../../packages/shared/src/index.js';
export type {
  BattleEvent,
  BattleResult,
  BattleState,
  TeamSetup as CoreTeamSetup,
} from '../../../../packages/shared/src/index.js';
// ★ 0.3.2：羁绊详情「哪些棋子带这个标签」—— 召唤物/野怪不进名单、阿米娅家族只留一条
export { traitOwnersOf } from './trait-owners.js';
export type { TraitOwner } from './trait-owners.js';

/*
  ★ 0.3.5：「我这一场」的胜负账本（纯函数，见 battle-outcome.ts）。
  用户报的"输了不扣血 / 赢了扣血断连胜"就是结算时读了**屏幕上那一场**造成的 ——
  观战会把 `currentResult` / `myTeam` 换成别人的战斗。界面层现在只问这份账本。
*/
export { mergeMyBattle, effectiveWinner, wonOf, teamOf } from './battle-outcome.js';
export type { MyBattleRecord } from './battle-outcome.js';
