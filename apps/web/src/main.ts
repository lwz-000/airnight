import {
  ARENA_H,
  ARENA_W,
  BENCH_SLOTS,
  BLIND_HP_LAST_SECONDS,
  BOARD_H,
  BOARD_W,
  BUY_XP_COST,
  MANA_MAX,
  PLAYBACK_SPEEDS,
  // ★ 0.1.3：前 3 回合布阵 30 秒 —— 文案和服务器必须用同一个函数算
  prepSecondsForRound,
  REFRESH_COST,
  TRAIT_DEFS,
  UNIT_DEFS,
  skillVariantOf,
  advanceRound,
  // ★ 0.0.3 野怪掉落：逐只击杀的日志文案 + "上一场打死了哪些野怪"
  killDropLines,
  monstersKilledBy,
  // ★ 0.1.1 藏品二版：这一场打死了几个**非野怪**敌人（仇名录的成长层数）
  enemiesKilledBy,
  waveDescription,
  applyApprovedBuy,
  // ★ 0.1.1：藏品「随机招募」的结果落地（单机本地抽完 / 联机服务器回执，共用这一处）
  applyRecruitResult,
  canStartBattle,
  cellToWorldFlipped,
  countOwned,
  // ★ 0.0.3：商店角标"已拥有 N"按张数折算（2 星 = 3 张、3 星 = 9 张）
  countOwnedCopies,
  createBoardScene,
  createGameState,
  // ★ 0.3：从房间设置里挑出"经济会读"的那两项（开局金币 / 每回合基础收入）
  gameRulesOf,
  // ★ 0.0.3 测试模式「双阵营沙盒」：造一侧的独立状态
  createTestSide,
  createBattle,
  currentTraits,
  // ★ 0.1.1 观战：给"别人的那份阵容"算羁绊（和自己那一栏同一个算法）
  traitsOfPlacements,
  // ★ 0.1.1：商店可用性的唯一判据（布阵 + 战斗都算"能逛商店"），界面别自己写阶段判断
  canShopNow,
  // ★ 0.2：能不能改阵容的唯一判据（布阵 + 商店回合），拖动/点击/置灰全走它
  canEditTeam,
  // ★ 0.2：新回合该设成什么阶段（商店回合是独立阶段，不能被抹回 prep）
  enterPrepPhase,
  didIWin,
  localHpLossForRound,
  shouldClientAdvanceRound,
  // ★ 0.1.2 修：「回放播完了该不该收尾」的口径（单机 vs 联机不一样，见它的说明）
  shouldFinishBattle,
  doBuyShopSlot,
  doBuyXp,
  doRefreshShop,
  doSellBench,
  doToggleShopLock,
  // ★ 0.3.2 阿米娅升变任务：进度（只有选了「不容拒绝」才有）+ 她的最高星级
  amiyaQuestOf,
  amiyaStarOf,
  // ★ 0.3.2 盟约「不容拒绝」：开局送一只 1 星阿米娅（幂等）
  applyCovenantOpening,
  // ★ 0.3.2 把达成的任务推到 awaiting（结算时调；调试钩子也用它）
  advanceAmiyaQuest,
  // ★ 0.3.2 发一张升变之证到专用栏位（不占穿戴藏品那 10 格）
  grantAscendCert,
  formatDamage as dmg,
  formatEventView,
  formatTraitEffects,
  applyEventToStats,
  applyTraitEvent,
  emptyTraitLog,
  isTeamSharedProgress,
  linesUpTo,
  sortedStats,
  statsUpTo,
  topProgress,
  traitLogUpTo,
  traitNameOf,
  // ★ 0.0.3 测试沙盒：按"这套状态属于哪半边场地"判断可摆放区域
  //（原来的 isPlayerCell 只能判左半边，红方摆不上人 —— 现在统一用 isSideCell(state.side, cell)）
  isSideCell,
  planPrepSprites,
  diffPrepSprites,
  shouldShowSoloEnemy,
  levelInfo,
  // ★ 0.3：人口上限的唯一实现（等级 + 藏品）；顶栏显示必须用它
  popCap,
  moveBoardToBenchSlot,
  movePlacement,
  pickOpponent,
  // ★ 0.0.3：详情页的数值走「和开战同一套」的算法（含羁绊 / 藏品 / 共享藏品）
  previewUnitStats,
  // 布阵阶段要先把对手摆出来（和开战用的是同一份阵容；野怪回合就是野怪）
  opponentPlacementsForRound,
  placeSelected,
  // ★ 0.0.3：拖拽落子和点击落子现在共用 state 层这一份实现，
  // 别再在 main.ts 里另抄一份（修改器的特性就是那样漏掉的）
  placeBenchUnitAt,
  canAddUnit,
  // ★ 0.3.4：开战时人口没上满 -> 自动把备战席的干员补上场（落点优先中心·后方）
  autoFillBoardFromBench,
  placementAt,
  poolRemainingOf,
  poolCopiesOfUnit,
  rarityOfCost,
  recallFromBoard,
  reorderBench,
  selectBench,
  seedForBattle,
  seedFromTeam,
  setNetPoolView,
  shopOddsText,
  survivorsOfTeam,
  battleGoldOf,
  simulate,
  streakBonusOf,
  streakLabelOf,
  TICKS_PER_SECOND,
  toTeamSetup,
  toSubmittedTeam,
  // ★ 0.1.2：断线重连时把服务器回来的阵容装回本地棋盘（刷新页面场景要用）
  applySubmittedTeam,
  // ★ 0.2 MujicaAve：fever 的两个选择（布阵阶段那张次级页面的两个按钮）
  spendFever,
  holdFever,
  // ★ 0.2 商店回合：坎诺特的限时商店（界面只调 state 层这几个动作，不自己改货架数组）
  // ★ 0.2.1：界面只读 `shopRoundUsable`（= 商店开着 **且** 我还没被淘汰），
  //   不要再用 `shopRoundActive` —— 那一个不含淘汰判据。
  shopRoundUsable,
  closeShopRound,
  toggleShopRoundOpen,
  setShopRoundMode,
  shopRoundRerollPrice,
  rerollShopRound,
  // ★ 0.3.1：盟约「特殊刷新」按钮角标的唯一判据（和真正触发时共用一份）
  specialRefreshHint,
  buyShopRoundSlot,
  applyApprovedShopRoundOperator,
  sellableShopRoundItems,
  sellShopRoundItem,
  tickShopRound,
  enterShopRound,
  // 商店回合的价格表 / 干员位折算（界面显示和扣钱必须是同一份常量）
  SHOP_SELL_PRICE,
  SHOP_ROUND_SECONDS,
  OPERATOR_SLOT_COPIES,
  OPERATOR_SLOT_STAR,
  sellPriceOfItem,
  type ShopSlotKind,
  // 修改器（★ 0.0.3，只有测试模式能用）
  addGold,
  grantModifierUnit,
  setIgnorePopCap,
  setInfiniteGold,
  setModifierLevel,
  // ★ 0.1.2 修改器「数值修改」：逐张卡的基础属性覆盖（存取都只有这一个入口）
  unitStatOverrideOf,
  setUnitStatOverride,
  // ★ 0.0.3 藏品（装备）：界面上的"获得 / 装备 / 卸下 / 删除"全部走 state 层这几份实现
  //（拖拽和点击共用同一份 —— 别再在 main.ts 里另抄一份，那正是以前踩过的坑）
  addItem,
  deleteItem,
  equipItemToUnit,
  equipSharedItem,
  traitRelicsOf,
  grantModifierItem,
  itemZoneView,
  activeSharedItems,
  // ★ 0.1.1 藏品二版：「共享藏品效果」栏的数据源（该显示什么已经在那里收口了）
  activeItemEffects,
  // ★ 0.1.1：详情页那两件 A 类藏品也要显示实时数值（上下文构造只有这一处）
  itemLiveContextOf,
  // 层数读取只有一处（效果栏那张「N 层」小标签也要用它）
  // ★ 0.2：改成**逐副本**读（layerAt），两件同名藏品各显示自己的层数
  layerAt,
  // ★ 0.1.1 藏品二版：商店里那只干员的**实际**价格（剑锤那种会让花费 +2）
  shopPriceOf,
  // ★ 0.0.3 需求 4：同栏拖动 = 互换位置（实现只在 state 层，界面不自己动数组）
  swapItemsInZone,
  unequipItemFromUnit,
  unequipSharedItem,
  unitItemCount,
  unitItemSlots,
  viewToRawCell,
  rawToViewCell,
  type BattleEvent,
  type BattleResult,
  type BattleState,
  type Cell,
  type GameState,
  type ItemZone,
  type LogLine,
  type MonsterDropResult,
  type FeverTreasureResult,
  type PlaybackSpeed,
  type StatsMap,
  type TraitLogState,
  type UnitPlacement,
  // ★ 0.1.2：测试模式「数值修改」面板要按字段名填覆盖
  type UnitStatOverride,
  // ★ 0.3.2：羁绊详情「哪些棋子带这个标签」—— 召唤物不进名单、阿米娅家族只留一条
  traitOwnersOf,
  // ★ 0.3.5：「我这一场」的胜负账本（见 game/battle-outcome.ts 的说明）
  mergeMyBattle,
  wonOf,
  teamOf,
  type MyBattleRecord,
} from './game/index.js';
// ★ 0.3.2：「退出游戏」按钮 —— 黑框藏起来之后，退出只能从网页发起
import { quitTokenFrom, requestQuit } from './quit-game.js';
// ★ 0.3.5：UI 缩放系数（纯函数，见 ui-scale.ts）—— 小窗口不挤、大窗口不空
import { uiScaleFor } from './ui-scale.js';
// 战斗内核的定点数放大倍数：血量在内部是"面板值 × FIX"，显示前要除回来
import {
  FIX,
  playableDefs,
  /**
   * ★ 0.1.2：一枚棋子的**白板属性**（基础 × 星级，含 3 星质变，不含羁绊/藏品）。
   * 详情页的 ▲▼ 基准和「数值修改」面板的输入框初值都用它 ——
   * 以前界面自己算过一遍，漏了 3 星加血那一项，▲▼ 全是错的。
   */
  unitBaseStats,
  // ★ 0.0.3：修改器「获得干员」下拉要能发野怪（它们不在 playableDefs 里）
  monsterDefs,
  monsterSkillDetail,
  // ★ 0.2：野怪在日志/统计里统一显示成「野怪」（唯一实现）
  displayNameOf,
  // ★ 0.2：野怪回合的判定（fever 弹窗要避开它）
  isMonsterRound,
  // ★ 0.2.2：顶栏「距离下一个野怪回合还剩几回合」—— 节奏的唯一实现也在 shared
  monsterRoundCountdown,
  MONSTER_TIERS,
  MONSTER_TIER_LABEL,
  type UnitDef,
  // ★ 0.0.3 藏品：数据表 + 容量 + "藏品效果 -> 中文"（和导出表格用的是同一份实现）
  ITEM_DEFS,
  NORMAL_ITEMS,
  ADVANCED_ITEMS,
  // ★ 0.1.1：拖藏品时的高亮判定要和 state 层用同一个判据
  isUnitTransformingItem,
  morphCandidatesOf,
  ITEM_A_SLOTS,
  ITEM_B_SLOTS,
  ITEM_B_EQUIP_SLOTS,
  ITEM_PER_UNIT,
  ITEM_RARITY_LABEL,
  ITEM_SLOT_SHORT,
  itemEffectLines,
  itemEffectSummary,
  // ★ 0.1.1：效果栏 / 详情页显示「实时数值」（按当前层数/金币/血量换算）
  itemLiveLines,
  // ★ 0.1.2：生还者合约「开局随机强化」抽到了谁 —— 只能从战斗日志里读
  randomAllyBuffPick,
  spawnedUnitInfo,
  // ★ 0.1.1 藏品二版：详情页「当前效果」栏 —— 效果元数据
  // ★ 0.1.3：剩余时间 / 剩余次数的**唯一渲染入口**（见 shared/duration.ts）
  durationText,
  type ActiveEffect,
  // ★ 0.1.3：联机版本号校验 —— 提示里要说清"你的是哪个版本"
  SERVER_VERSION,
  // ★ 0.0.3 末：房间号长度与字母表（别在界面文案里写死 6；输入框也用它过滤）
  CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  // ★ 彩蛋棋子「维维美·绝对主角」：只有调试探针要用它的 id（商店 1/1500 太难碰上）
  EGG_UNIT_ID,
  // ★ 0.1.1 观战：服务器广播的"某个玩家的阵容"（场上棋子 + 备战席）
  type PrepTeamView,
  type BenchUnitView,
  // ★ 0.1.1 联机结算页：服务器算好的"每位玩家的战绩"
  type PlayerStanding,
  type RoomView,
  type ServerMessage,
  // ★ 0.3 昵称：2~8 字 + 字符白名单 + 重名判定（**和服务端同一份**，见 shared/names.ts）
  NAME_MAX_LENGTH,
  NAME_MIN_LENGTH,
  playerNameError,
  sanitizePlayerName,
  // ★★ 0.3 盟约：卡面数据 + "折算成经济"（经济加成在开局时折算一次）
  COVENANTS,
  covenantAvatarPath,
  covenantOf,
  covenantEconomy,
  // ★★ 0.3.3 人机：三档难度的 id / 文案（和服端同一份，见 shared/bot.ts）
  BOT_DIFFICULTIES,
  BOT_DIFFICULTY_INFO,
  botDifficultyLabel,
  type BotDifficulty,
  // ★ 0.3.2 阿米娅升变任务：从战斗日志里数"她打了多少"（按家族归并）+ 进度条文案
  amiyaDamageFromLog,
  amiyaQuestView,
  // ★ 0.3.2 升变之证：三张证的 id / 专用栏位数 / 发证
  AMIYA_CERT_IDS,
  AMIYA_CERT_SLOTS,
  type AmiyaQuestLine,
  // ★ 0.3.2：升变形态不能出售（唯一判据在 ascension.ts；测试模式放行）
  isSellLockedDefId,
  // ★ 0.3 单机盟约：开局血量 / 每场胜利回血（和联机 `Room.applyCovenant*` 同一套规则）
  covenantStartHpBonus,
  covenantWinHeal,
  // ★ 0.3.31：玩家血量上限的唯一口径（夹藏品回血用）
  playerMaxHp,
  // ★ 0.3 房间设置：范围 / 默认值 / 文案（服务端裁决，客户端照着画）
  ROOM_SETTINGS_LIMITS,
  DEFAULT_ROOM_SETTINGS,
  isDefaultRoomSettings,
  roomSettingsSummary,
  // ★ 0.3.3 大厅右上角的「N / 8」座位计数（上限和服务端同一份，别在界面里写死 8）
  MAX_PLAYERS_PER_ROOM,
  // ★ 0.3.3 局域网房间列表（服务器回给我们的房间长相）
  type LanRoomInfo,
  type RoomSettings,
} from '../../../packages/shared/src/index.js';
// ★ 0.3.4 图鉴 + 组队器：分类与栏位状态全在这一个模块里，界面层只负责画
import {
  TEAM_PLAN_SLOTS,
  clearTeamPlanSlot,
  codexItemGroups,
  codexUnitGroups,
  codexUnits,
  isPlanned,
  planTraitRows,
  remindBuyMarkOf,
  resetTeamPlanForNewGame,
  setTeamPlanRemindBuy,
  teamPlanCount,
  teamPlanRemindBuy,
  teamPlanSlots,
  toggleTeamPlanUnit,
} from './game/codex.js';
// ★ 0.3.4 自定义快捷键（设置面板可改，存 localStorage）
import {
  actionForKey,
  keybindLabel,
  KEY_ACTIONS,
  loadKeybinds,
  resetKeybinds,
  saveKeybinds,
  setKeybind,
  type KeyAction,
} from './game/keybinds.js';
// ★ 0.3.4 新手教程（第一次打开自动弹一次，之后从主界面右上角的「?」再看）
import {
  TUTORIAL_PAGES,
  clampTutorialPage,
  markTutorialSeen,
  shouldAutoOpenTutorial,
  tutorialPageCount,
} from './game/tutorial.js';
import {
  installAttackFxProbe,
  installBoardProbe,
  installMotionProbe,
  installPointerProbe,
  installUnitProbe,
} from './three/debug-probe.js';
import {
  ITEM_DOT_COLORS,
  createUnitSprite,
  restyleUnitSprite,
  setUnitItemDots,
} from './three/sprite-graphics.js';
import {
  clearUnitTextureCache,
  getLoadedImage,
  unitSpritePath,
} from './three/sprite-graphics.js';
import {
  BACKDROP_PATH,
  BOARD_TEXTURE_PATH,
  ARK_TILE_PATH,
  allUnitSpritePaths,
  allUnitStandPaths,
  preloadAssets,
  unitPortraitUrl,
  // ★ 0.0.3 藏品图标：路径 / 按需加载 / 是否已就绪（没图就回退首字色块）
  itemIconPath,
  itemIconUrl,
  itemIconLoaded,
  allItemIconPaths,
  loadImage,
} from './three/assets.js';
import {
  chibiPortraitUrl,
  chibiStats,
  detachChibi,
  initChibi,
  setChibiOpacity,
} from './three/chibi.js';
// ★★ 0.3：按 key 就地更新列表（修"买了张牌卡面就抽搐一下 / 羁绊列表左右抖"）
import { renderKeyed } from './keyed-list.js';
// ★ 0.3.2：官方「个人头像」（玩家头像）清单 —— 由 scripts/fetch-player-avatars.mjs 生成
import { PLAYER_AVATAR_GROUPS, PLAYER_AVATARS, isPlayerAvatarId, playerAvatarOf } from './player-avatars.js';
import { CARD_CENTER_Y, CARD_OPACITY, CARD_OPACITY_DRAGGED } from './three/card-layout.js';
import { BattleReplay } from './three/replay.js';
import { preloadBloomTextures } from './three/vishdal-bloom.js';
// ★ 0.2.1：序列帧特效（枪口火光 / 连斩 / 金色斩击）的预加载
import { preloadSeqFxTextures } from './three/sequence-fx.js';
// ★ 0.2.1：炮手炮弹的弹道贴图（黄/红/灰三张）预加载
import { preloadTracerFxTextures } from './three/bolt-tracer-fx.js';
// ★ 0.2.1：隐德来希「血镰」的贴图预生成
import { preloadLetoScytheTextures } from './three/leto-scythe-fx.js';
// ★ 0.3.2：阿米娅升变（慈悲愿景的方格阵 / 炉芯终曲的氛围碎片与即死叠加）
import { preloadAmiyaFormFxTextures } from './three/amiya-form-fx.js';
import { preloadRosmonGear } from './three/rosmon-slam-fx.js';
import {
  NetplayClient,
  defaultServerUrl,
  normalizeServerInput,
  playerShopSeed,
  rememberServerUrl,
  serverUrlProblem,
} from './net/netplay-client.js';
// ★ 0.3.3：多槽重连索引（局域网房间列表里的「回到对局」靠它认出"这局里有我"）
import { findResumeTarget } from './net/resume-index.js';
import {
  claimMachineSession,
  getMachineSession,
  initMachineSession,
  machineBusy,
  machineSessionAvailable,
  refreshMachineSession,
  startOwnershipHeartbeat,
  stopOwnershipHeartbeat,
} from './net/machine-session.js';
import {
  REPEAT_LABEL,
  createMusicPlayer,
  formatTime,
  type MusicPlayer,
  type MusicSnapshot,
} from './audio/music-player.js';

/**
 * ============================================================
 *  游戏主循环
 * ============================================================
 *
 * 三条输入线：
 *   1. 鼠标点棋盘     -> 放/收棋子
 *   2. 点界面按钮      -> 买棋子 / 刷新 / 升级 / 开战
 *   3. 网络消息        -> 联机对战
 *
 * 一条输出线：3D 场景 + 2D 界面，都从「游戏状态」推导出来。
 */

// ============================================================
// 初始化
// ============================================================

const canvas = document.querySelector<HTMLCanvasElement>('#stage')!;
const board = createBoardScene(canvas);
const replay = new BattleReplay(UNIT_DEFS);
board.scene.add(replay.root);
// ★ 0.2.1：闪电弹道要正对镜头（贴片朝向），把相机递进去
replay.setCamera(board.camera);

/*
  ★ 棋盘取色探针（只有地址栏带 `?debug=1` 才挂上，正常玩什么都不做）。

  地砖的最终颜色 = 贴图 × 染色 × 光照，靠眼睛比色不可靠 ——
  这个探针用 `gl.readPixels` 把每一格**真正渲染出来的**像素读回来，
  按「我方亮格 / 我方暗格 / 对方亮格 / 对方暗格」四类取平均，
  再和离线预览图（`素材\方舟地块\tools\make_preview_sheets.py` 出的那张）逐类比差。
  用法和原理见 `three/debug-probe.ts` 顶部的注释。
*/
/*
  ★★ 0.3：单机开局那张「盟约选秀」要不要自动跳过。
  【为什么只在 debug 下跳？】
  它是 `position: fixed` 的全屏层 —— 会挡住 `page.hoverAt(x, y)` 那种**真实鼠标**
  的坐标命中。一批 e2e 脚本（悬停卡片 / 走路动画 / 商店回合）都是"点单人进棋盘，
  再按坐标去悬停"，多一层全屏浮层就会把它们全打红。
  所以约定：`?debug=1` = 调试/自动化，自动跳过选秀；
  `?debug=1&covenant=1` = 我要看选秀（`scripts/ui-e2e-covenant.mjs` 用这个）。
  正常玩家（没有 debug 参数）永远会看到选秀。
*/
const DEBUG_SKIP_LOCAL_COVENANT = (() => {
  const query = new URLSearchParams(location.search);
  return query.has('debug') && !query.has('covenant');
})();

/**
 * ★ 0.3.4：**要不要在界面上显示调试读数**（战斗种子 / 校验和）。
 *
 * 【为什么默认关掉】
 * 用户口径："把游戏里的校验代码藏起来"。这两样东西（`校验和 0x…`、`种子 123456`）
 * 是排查"两边算得不一样"时最好用的线索，但对玩家来说只是一串没意义的十六进制 ——
 * 摆在结算横幅和状态栏上既掉档次，也容易让人以为游戏报错。
 *
 * 所以：**只有地址栏带 `?debug=1` 才显示**（和那些探针钩子同一个开关）。
 * 控制台里那份 `console.log` 一直保留 —— 玩家看不到，出问题时开发者仍然能拿到。
 */
const SHOW_DEBUG_INFO = new URLSearchParams(location.search).has('debug');

if (new URLSearchParams(location.search).has('debug')) {
  installBoardProbe(board.scene, board.camera, board.renderer);
  installUnitProbe(board.scene);
  // ★ 0.0.3：移动动画探针（走路动作 / 平滑度 / 前倾），给 scripts/walk-e2e.mjs 用
  installMotionProbe(board.scene);
  // ★ 0.1.4：攻击特效探针，给 scripts/attack-fx-e2e.mjs 用（特效只有零点几秒，截图拍不准）
  installAttackFxProbe(board.scene);
  /*
    ★ 鼠标拾取探针：把「屏幕坐标 <-> 格子」跑一遍，回答
    "点中的格子是不是离光标最近的那格"。用来抓"鼠标偏移"这类问题 ——
    光看截图分不清是视口过期、还是棋子挡住了落点。
    （viewFlipped 在下面才声明，但这里只是传闭包，真正调用时它早就初始化好了）
  */
  installPointerProbe({
    canvas,
    camera: board.camera,
    viewport: () => board.viewportRect(),
    pickCell: (x, y, onlyFloor) => board.screenToCell(x, y, { ignoreUnits: onlyFloor }),
    cellToWorld: (cell, y) => cellToWorldFlipped(cell, y ?? CARD_CENTER_Y, viewFlipped),
    boardW: BOARD_W,
    boardH: BOARD_H,
  });
  // 小人素材的全局统计（载入了几份清单 / 几套序列帧 / 几份失败）
  (globalThis as unknown as Record<string, unknown>)['__airnightChibiStats'] = chibiStats;
  /*
    ★ 攻击动画的"内部状态"探针：把播放器本体挂出来，让 e2e 能读到
    「挥击窗口还剩多久 / 当前动画倍率 / 这一帧有没有重排窗口 / 内核此刻的攻速」。

    【为什么非要这个？】
    攻击动画是"表现层按挥击窗口推帧"的结果，光看画面/看 anim 键分不清
    是"窗口没排上"还是"窗口排上了但帧没走"。0.0.3 报的"野怪攻击动画失效"
    就是靠它一眼定位的（见 attack-anim.ts 里 SWING_EPS / 首尾相接那两段注释）。
  */
  (globalThis as unknown as Record<string, unknown>)['__airnightReplay'] = replay;

  /*
    ★ 彩蛋棋子：把商店第 0 格强行换成彩蛋（只有 `?debug=1` 才有这个钩子）。
    为什么需要它？彩蛋的概率是 1/1500 —— 靠人肉刷出一次来"看一眼卡面长什么样"
    不现实，而且 e2e 也没法靠点击刷到它。这个钩子只做一件事：
    **把那一格换掉然后重画商店**，不改任何概率逻辑（正常玩永远走不到这里）。
  */
  (globalThis as unknown as Record<string, unknown>)['__airnightForceEggShop'] = (): string[] => {
    const slot = state.economy.shop[0];
    if (slot) {
      slot.defId = EGG_UNIT_ID;
      slot.cost = UNIT_DEFS[EGG_UNIT_ID]?.cost ?? 20;
      slot.sold = false;
    }
    renderShop();
    return state.economy.shop.map((item) => item.defId);
  };

  /*
    ★★ 0.2 商店回合：**强行开一次坎诺特的商店**（只有 `?debug=1` 才有）。
    【为什么需要？】商店回合只在第 9 / 16 / 23… 回合之后出现 ——
    想看一眼那张 UI 长什么样，正常玩得先打九个回合，人肉和 e2e 都不现实。
    这个钩子只做一件事：**直接调 enterShopRound + renderAll**，
    不伪造回合号、不改任何概率逻辑（正常玩永远走不到这里）。
    ★ `state.round` 不动 —— 顺便把"商店不占回合数"这条也一起验证了。
  */
  (globalThis as unknown as Record<string, unknown>)['__airnightForceShopRound'] = (): {
    slots: { kind: string; name: string; price: number }[];
    secondsLeft: number;
    phase: string;
    round: number;
  } => {
    enterShopRound(state);
    renderAll();
    return {
      phase: state.phase,
      round: state.round,
      secondsLeft: state.shopRound?.secondsLeft ?? 0,
      slots: (state.shopRound?.slots ?? []).map((slot) => ({
        kind: slot.kind,
        name:
          slot.kind === 'operator'
            ? (UNIT_DEFS[slot.defId ?? '']?.name ?? '(无货)')
            : (ITEM_DEFS[slot.itemId ?? '']?.name ?? '(无货)'),
        price: slot.price,
      })),
    };
  };

  /*
    ★ 0.1.1：结算页预览（同样只有 `?debug=1` 才有）。
    【为什么需要？】
    联机结算页要**真的打完一整局**才会出现 —— 血量 100、每回合掉 3~9，
    想看它长什么样得先打二十多个回合，人肉和 e2e 都不现实。
    这个钩子用真实干员拼一份 4 人演示战绩，然后**直接调用 renderResultPage**：
    不碰任何游戏逻辑、不伪造网络消息，正常玩永远走不到这里。
  */
  (globalThis as unknown as Record<string, unknown>)['__airnightPreviewResult'] = (): number => {
    const defs = playableDefs();
    const byCost = (cost: number, count: number): UnitDef[] =>
      defs.filter((def) => def.cost === cost).slice(0, count);
    const lineups: UnitDef[][] = [
      [...byCost(1, 2), ...byCost(3, 2), ...byCost(5, 1)],
      [...byCost(1, 2), ...byCost(2, 2), ...byCost(4, 1)],
      [...byCost(2, 3), ...byCost(3, 1)],
      byCost(1, 2),
    ];
    const names = ['小明', '小红', '阿强', '路人甲'];
    const standings: PlayerStanding[] = lineups.map((line, index) => {
      const lineup: UnitPlacement[] = line.map((def, i) => ({
        defId: def.id,
        star: i % 3 === 0 ? 2 : 1,
        cell: { col: i % 5, row: i % 10 },
      }));
      // 羁绊走**同一个实现**（traitsOfPlacements = buildTraitStatus），只留已生效的
      const traits = traitsOfPlacements(lineup)
        .filter((trait) => trait.activeAt !== null)
        .map((trait) => ({ traitId: trait.traitId, count: trait.count, activeAt: trait.activeAt! }));
      const dealt = 32000 - index * 7000;
      // 让"最高伤害"落在这套阵容里最贵的那个（现实里通常就是主 C）
      const top = lineup[lineup.length - 1]!;
      return {
        playerId: `demo-${index}`,
        name: names[index] ?? `玩家${index + 1}`,
        avatarId: '',
        rank: index + 1,
        eliminatedRound: index === 0 ? null : 3 + index * 2,
        hp: index === 0 ? 46 : 0,
        wins: 6 - index,
        losses: index,
        level: 9 - index,
        lineup,
        traits,
        topUnit: { defId: top.defId, star: top.star, dealt },
        totalDamage: dealt + 9000,
      };
    });
    renderResultPage({
      t: 'gameOver',
      winnerId: 'demo-0',
      winnerName: names[0]!,
      rounds: 9,
      standings,
    });
    return standings.length;
  };

  /*
    ★ 0.3.5：给 e2e / 截图用的「弹一条结算横幅」。
    【为什么需要？】横幅只在"一场战斗播完"那一刻出现两秒多，
    无头截图要卡这个时机得先真打完一场（十几秒 + 站位）；
    而这个组件恰恰是**纯外观**，值得单独拍三张（胜 / 败 / 平）比对。
    它只调真正的 `showResultBanner`，不伪造样式也不复制 DOM。
  */
  (globalThis as unknown as Record<string, unknown>)['__airnightBanner'] = (
    title: string,
    tone: 'win' | 'lose' | 'draw',
    detail = '用时 12.3 秒 · 剩余血量 62% vs 0%',
    en = '',
    holdMs = 4000,
  ): boolean => {
    showResultBanner(title, tone, detail, {
      en: en || (tone === 'win' ? 'VICTORY' : tone === 'lose' ? 'DEFEAT' : 'DRAW'),
      holdMs,
    });
    return true;
  };

  /*
    ★ 0.1.1：给 e2e 用的「按格子坐标往棋盘上放一个干员」（同样只有 `?debug=1` 才有）。
    【为什么需要？】联机对局里测试模式会被强制关掉，而摆棋子只能靠鼠标在 3D 棋盘上拖 ——
    无头浏览器里"从备战席拖到某一格"要自己算屏幕坐标、还要派发一串真实的 pointer 事件，
    写起来又长又脆（`scripts/ui-e2e-003.mjs` 里那套真拖就是这么来的）。
    这个钩子只做一件事：**放一个干员到指定格子**，走的是界面点/拖同一份实现
    （`placeBenchUnitAt`，人口上限那一套照常生效），不碰任何规则和数值。
  */
  (globalThis as unknown as Record<string, unknown>)['__airnightPlaceForTest'] = (
    defId: string,
    star: number,
    col: number,
    row: number,
  ): boolean => {
    // 借用修改器把干员发到备战席（它要求测试模式，这里临时开一下、发完立刻还原）
    const wasTestMode = state.testMode;
    state.testMode = true;
    const granted = grantModifierUnit(state, defId, star);
    state.testMode = wasTestMode;
    if (!granted.ok) return false;
    const unit = state.economy.bench[state.economy.bench.length - 1];
    if (!unit) return false;
    const result = placeBenchUnitAt(state, unit.uid, { col, row });
    renderAll();
    return result.ok;
  };

  /*
    ★ 0.1.2：给 e2e / 界面测试用的「点了某一格」。
    【为什么需要？】jsdom 里点不到 3D 棋盘（没有 WebGL，`screenToCell` 拿不到坐标），
    而"点干员会弹哪一个面板"偏偏**只在那个点击分支里**（见 handleBoardClick）——
    不开这个口子的话，「数值修改开着时点干员不弹详情页」这条需求就只能靠人眼验。
    它走的是 `handleBoardClick` **同一份实现**，不复制任何判断。
  */
  (globalThis as unknown as Record<string, unknown>)['__airnightClickCell'] = (
    col: number,
    row: number,
  ): void => {
    handleBoardClick({ col, row }, 0, 0, 0);
  };

  /*
    ★ 0.3.2：给 e2e / 截图用的「把阿米娅升变任务推到某个状态」。
    【为什么需要？】"一阶段达成 + 布阵阶段"这个画面要真打 5 场才出现，
    无头截图根本等不到；而进度条 / 二选一弹窗又是这个功能唯一的界面出口，
    不验等于没做。这里只覆盖**进度字段**，发证/弹窗仍然走真实逻辑
    （`consumeAmiyaQuestRewards`），不复制任何规则。
  */
  (globalThis as unknown as Record<string, unknown>)['__airnightAmiyaQuest'] = (
    patch: Partial<{ battles: number; wins: number; damage: number; star: number }>,
  ): Record<string, unknown> => {
    state.covenantId = 'cv_amiya';
    applyCovenantOpening(state);
    const quest = state.covenant.amiyaQuest;
    if (typeof patch.battles === 'number') quest.battles = patch.battles;
    if (typeof patch.wins === 'number') quest.wins = patch.wins;
    if (typeof patch.damage === 'number') quest.damage = patch.damage;
    // 星级靠"调整她自己的星级"来造，而不是伪造进度 —— 进度条读的就是真实星级
    if (typeof patch.star === 'number') {
      const unit = state.economy.bench[0] ?? state.placements[0];
      if (unit) unit.star = patch.star;
    }
    advanceAmiyaQuest(state);
    renderAll();
    return { ...quest };
  };
}

let state = createGameState();

/**
 * ★ 0.3.4：当前这套快捷键（设置面板可改，存 localStorage）。
 * 放在模块级，是因为"设置面板改完之后，游戏里那个 keydown 处理器要立刻用新的"
 * —— 它每次按键都现读，不需要额外通知。
 */
let keybinds = loadKeybinds();

/**
 * ★ 0.0.3 测试模式「双阵营沙盒」。
 *
 * 【它是什么？】
 * 测试模式不再用单机闯关，而是一个玩家同时操作**两边**：
 *   testSides[0] = 蓝方（左半场，列 0..4），testSides[1] = 红方（右半场，列 5..9），
 *   两套状态完全独立（商店 / 金币 / 备战席 / 阵容 / 羁绊互不影响）。
 * `state` 始终指向当前在操作的那一侧（见下面的 activeTestTeam）。
 *
 * 【为什么用 null 表示"不在沙盒里"？】
 * 普通单机 / 联机时它是 null，界面完全按老样子走 ——
 * 人机预览、服务器配对、看别人棋盘这些都不会被这套沙盒影响。
 */
let testSides: [GameState, GameState] | null = null;
/** 沙盒里当前在操作哪一侧：0 = 蓝方（左），1 = 红方（右） */
let activeTestTeam: 0 | 1 = 0;

/** 现在是不是「测试模式双阵营沙盒」 */
function isTestSandbox(): boolean {
  return testSides !== null;
}

/** 布阵阶段用到的棋子精灵：布阵 uid -> 精灵 */
const prepSprites = new Map<number, ReturnType<typeof createUnitSprite>>();

/** 战斗日志游标：已经写进右侧日志的事件数 */
let logCursor = 0;
let paused = false;
/** 是否处于「翻转视角」（联机时被分到队伍 1） */
let viewFlipped = false;
/**
 * 我是否在一场**联机对局**里。
 *
 * 【它管两件事，别混淆】
 *   1. 界面走联机那一套（不显示人机波次、血量以服务器为准…）
 *   2. **回合由服务器推进**，客户端不许自己 `nextRound()`
 *
 * ★ 这一局**打完（gameOver）之后它也保持 true**，直到玩家真的返回主界面。
 * 【为什么？—— 这里原来踩过一个很坑的 bug】
 * 原来 `onGameOver` 把它设成 false，等于"对局结束了 = 我现在是单机"。
 * 而战斗演出播完时 `finishBattle()` 会看这个标志决定要不要自动进下一回合 ——
 * 于是游戏一结束，客户端就**自己开了一局单机**，
 * 对手是本地生成的人机阵容。玩家的观感就是"莫名其妙切回单人模式打固定的人机"。
 * 现在用下面那个 `netplayMatchOver` 单独表示"这一局已经打完了"。
 */
let netplayActive = false;
/** 联机对局已经分出胜负（但人还在房间里，没回主界面） */
let netplayMatchOver = false;
/**
 * ★ 0.1.2：正在"断线等待重连中"（还没放弃，也还没回来）。
 *
 * 【它和 `netplayActive` 的分工】
 *   · `netplayActive` —— "我在联机对局里"（业务口径：一切问服务器）；
 *   · `netplayResyncing` —— "连接暂时断了，但座位还在，正在等重连"（界面口径）。
 * 断线时**不能**把 `netplayActive` 关掉：一关客户端就当成单机，
 * 会自己推进回合、自己刷商店（0.1.1 那条"打完一局莫名开单机"的 bug 就是这个形状）。
 * 所以断线只动这个标志，界面据此显示"正在重连"+冻结输入。
 */
let netplayResyncing = false;
let spectating = false;
/**
 * ★ 0.1.3：服务端当前是不是**暂停了对局**（在线玩家不足 2 人）。
 * 只用来判断"刚刚才暂停 / 刚刚才恢复"，好弹一次提示（服务端才是真相来源）。
 */
let matchPaused = false;
/**
 * ★ 0.1.1：我是不是已经被淘汰了（联机，血量归零）。
 *
 * 【淘汰之后能做什么？】
 * **只能观战**：商店关掉、棋盘和备战席都不许操作（手里的牌已经还给共享牌库了）。
 * 这不是"为难玩家"，而是必须 —— 他的牌已经回库，
 * 如果还允许买卖，牌库的账当场就乱（同一张牌会被卖两次 / 买第二次）。
 *
 * ★★ 0.2.1：这个标志**搬到 `state.meEliminated` 了**（原来放在这里当模块变量）。
 * 原因：0.2 新增的「商店回合」是另一套界面（`#shop-round-overlay`），它读不到
 * 这里的变量，于是淘汰的人照样能开商店 —— 就是用户报的那个严重 bug。
 * 现在**唯一状态位在 state 上**，`game/state.ts` 的 `shopBlockedByElimination()`
 * 与 `shopRoundUsable()` 都读它，界面层不许再自己存一份。
 */
let currentResult: BattleResult | null = null;

/**
 * ★★★ 0.3.5：「我这一场」的账本 —— 用户报的"胜负 / 连胜连败"bug 的根治处。
 *
 * 【为什么不能再用 `currentResult` 做回合结算？】
 * `currentResult` 的含义是"**屏幕上演的这一场**"，而不是"我打的那一场"：
 *   · 战斗打完之后点别人的对局观战 → 它变成别人的结果；
 *   · `myTeam` 也跟着变成 `team1PlayerId === me ? 1 : 0` ⇒ 看别人时恒为 0。
 * 而回合结算（`settleNetplayRound`）恰恰是在"下一回合开始时"读它们的 ——
 * 于是只要你结算那一刻还在看别人的战斗：
 *   · 别人那场左边赢 → 你输了也记一胜（血量不动、连胜不断）；
 *   · 别人那场左边输 → 你赢了也记一负（**断连胜 + 按输结算**）。
 * 这正是用户描述的"小概率"：得赶上回合切换的那一刻。
 *
 * 【现在的口径】
 *   自己那一场"开播"时就把它的结果记进这里（`showBattle` / `startBattle`），
 *   之后所有"上一场怎么样"只问这份账本。服务端发来 `battleEnd` 时把胜负补进来，
 *   有服务端的就用服务端的（血量/战绩本来就是他算的）。
 *
 * 深拷贝没有意义（`result` 只读），所以这里直接存引用。
 */
let myBattle: (MyBattleRecord & { result: BattleResult }) | null = null;

/**
 * 记下"我这一场"。合并规则全在 `game/battle-outcome.ts`（纯函数、有单测）。
 * ★ 统一从这里写，别在别处直接给 `myBattle` 赋值 —— 那样很容易把服务端胜负冲掉。
 */
function rememberMyBattle(next: MyBattleRecord & { result: BattleResult }): void {
  const merged = mergeMyBattle(myBattle, next);
  myBattle = merged ? { ...merged, result: next.result } : null;
}

/** 清掉账本（新回合 / 重开一局时）。 */
function clearMyBattle(): void {
  myBattle = null;
}

let currentNames: Record<number, string> = {};
/**
 * ★ 0.0.3：这一场战斗里，每个单位身上带着哪些 A 类藏品。
 *
 * 【为什么要在 main.ts 记一份？】
 * 布阵阶段读 `state.placements` 就有装备了，但**战斗演出**里那些精灵
 * 是从内核的 `BattleState` 长出来的，里面没有"装备"这个概念
 * （那是显示用的东西，往确定性状态里塞字段是要担风险的）。
 * 所以开打那一刻，把双方 `TeamSetup.units[].items` 抄成一张
 * 「单位编号 -> 藏品 id」的对照表：
 *   · 交给播放器画血条左边那两个小圆点（setItemCounts）
 *   · 战斗中点开某个棋子时，详情页也能显示它身上的装备
 * 编号规则是内核固定的：`unitId = team * 1000 + index + 1`。
 */
let battleItemIds = new Map<number, string[]>();

/**
 * 开打前把双方阵容里的装备抄进对照表，并交给战斗播放器。
 * 单机 / 测试沙盒 / 联机三条路都要调（各自都有 team0 / team1 的 TeamSetup）。
 */
function applyBattleItems(...setups: Array<{ team: 0 | 1; units: Array<{ items?: string[] }> }>): void {
  battleItemIds = new Map<number, string[]>();
  for (const setup of setups) {
    setup.units.forEach((unit, index) => {
      battleItemIds.set(setup.team * 1000 + index + 1, unit.items ?? []);
    });
  }
  const counts = new Map<number, number>();
  for (const [unitId, items] of battleItemIds) counts.set(unitId, items.length);
  replay.setItemCounts(counts);
}
/**
 * 当前这场联机战斗的 id（服务器给的）。
 *
 * 【为什么要单独记？】
 * `simulate()` 只负责算战斗，它不知道自己是哪一场 —— battleId 是服务器的概念。
 * 但"我看完了"这条回执必须带上 battleId，服务器才知道我举的是哪一场的手，
 * 所以要在 onBattleStart 时把它存下来。
 */
let currentBattleId: string | null = null;
/**
 * ★ 0.1.2：我这一场是不是**已经收过尾**了（结算横幅弹过、`playbackDone` 举过手）。
 *
 * 【为什么需要它？】观战是可以随时切来切去的，而 `showBattle` 原来会**无条件**把
 * `state.phase` 推回 `'battle'`。于是"我打完了、正在等别人"这段里点开别人的战斗，
 * 阶段就被改回 `battle` ⇒ `shouldReturnToMyBattle()` 以为我还在打，立刻又把我拽回自己那场
 * （表现为"自己一打完就再也看不了别人"）；切回自己那场还会**再弹一次结算横幅、再举一次手**。
 * 有了这个标志，`showBattle` 才知道"推回 battle"这件事什么时候不该做。
 */
let myBattleDone = false;

/**
 * 联机：布阵期间所有人当前摆好的阵容（服务器广播过来的）。
 * "玩家列表 -> 看别人阵容"靠它。
 */
let prepTeams: Record<string, PrepTeamView> = {};

/**
 * 正在看谁的阵容（null = 看自己的）。
 *
 * 【为什么看完要能回来？】
 * 看别人阵容是"临时瞄一眼"，不是切换视角 ——
 * 所以必须有一个显眼的"回到我的棋盘"，而且**一进入战斗就自动回来**，
 * 不然下一回合你会对着别人的空棋盘摆自己的棋子。
 */
let viewingPlayerId: string | null = null;

/**
 * 战斗中正在查看的单位 id（点棋子弹出的详情面板）。null = 面板没开。
 *
 * 面板每帧都会刷新（血量/法力都在变），战斗一结束自动关掉 ——
 * 不然结算画面上会挂着一个已经死掉的棋子的数据。
 */
let battleInfoUnitId: number | null = null;

/**
 * 上一次同步给服务器的阵容签名。
 *
 * 【为什么要记签名？】
 * 现在没有"提交阵容"按钮了，客户端是**自动**把阵容同步给服务器的
 * （见 syncTeamToServer）。而 renderAll() 会被频繁调用，
 * 不做去重的话每秒会发几十条一模一样的消息。
 */
let lastSyncedTeam = '';
/** 阵容同步的防抖定时器（连续操作时只发最后一条） */
let teamSyncTimer = 0;

/**
 * 上一次上报给服务器的"展示数据"签名（等级:连胜）。
 * 和 lastSyncedTeam 同一个思路：数值没变就不发，免得每次 renderAll 都刷一条消息。
 */
let lastSyncedStats = '';

/**
 * ★★ 0.3.2：房间修订号跟踪（用来发现"我漏收了广播"）。
 *
 * 【为什么需要？】
 * 房间状态是一条条增量推下来的。网络抖一下、标签页被浏览器冻住一会儿，
 * 客户端就可能漏掉其中几条 —— 于是"我还停在第 6 回合，别人已经在第 8 回合开打"
 * （用户说的"平行世界"）。`RoomView.rev` 每广播一次 +1，跳号就是漏了。
 */
let lastRoomRev = -1;
/** 上面那个 rev 属于哪个房间（换房间要重新立基准，不能跨房间比） */
let lastRoomCode = '';
/** 已经发过 `requestSync`、在等回复（避免抖动时连发） */
let syncRequestPending = false;
/** 上一次"硬重连"的时间（防止抖动时反复重连，把好好的对局搅碎） */
let lastHardResyncAt = 0;

// ============================================================
// 玩家头像（0.0.2 需求第 16 条）
// ============================================================

/**
 * 我选的头像 = 一个干员的 defId（例如 'op46'）。空串表示"没选，用默认头像"。
 *
 * 【为什么要存 localStorage？】
 * 头像属于"玩家身份"，和名字一样是选一次、长期不变的偏好。
 * 每次开局都重选一遍会很烦。存起来之后建房/进房自动带上。
 */
let myAvatarId = '';
const AVATAR_STORAGE_KEY = 'airnight.avatar';

/** 从本地读回上次选的头像（读不到就当作没选） */
function loadAvatarPreference(): void {
  try {
    const saved = localStorage.getItem(AVATAR_STORAGE_KEY);
    /*
      校验一下再采用（头像列表会变，旧存档里的那个可能已经不存在了）：
        · `opNN` —— 干员头像；
        · `pa:...` —— ★ 0.3.2 官方「个人头像」（玩家头像）。
    */
    if (saved && isPlayerAvatarId(saved)) myAvatarId = saved;
    else if (saved && /^op\d{1,3}$/.test(saved) && UNIT_DEFS[saved]) myAvatarId = saved;
  } catch {
    // 隐私模式下 localStorage 可能不可用，忽略即可
  }
}

/**
 * 头像图片地址。两种来源：
 *   · `opNN`   —— 干员头像（和商店卡片、备战席是同一张图）；
 *   · `pa:xxx` —— ★ 0.3.2 官方「个人头像」（PRTS 个人头像一览那一套，
 *     素材在 `public/assets/player-avatars/`，清单由 `scripts/fetch-player-avatars.mjs` 生成）。
 */
function avatarPathOf(avatarId: string): string | null {
  if (!avatarId) return null;
  const official = playerAvatarOf(avatarId);
  if (official) return `/assets/player-avatars/${official.file}`;
  if (!UNIT_DEFS[avatarId]) return null;
  return unitPortraitUrl(avatarId);
}

/** 选头像（再点一次当前头像 = 取消选择，回到默认） */
function setMyAvatar(defId: string): void {
  myAvatarId = myAvatarId === defId ? '' : defId;
  try {
    localStorage.setItem(AVATAR_STORAGE_KEY, myAvatarId);
  } catch {
    // 忽略
  }
  renderAvatarPicker();
  // 顺带刷新一下已显示的界面（房间等待界面 / 玩家列表里也有头像）
  renderLobby();
}

/**
 * 头像墙当前的**分组**：`'op'` = 干员头像，其余 = 官方「个人头像」的分类键
 * （`def` / `dyn` / `special` / `activity`，见 `player-avatars.ts`）。
 *
 * ★ 只在内存里，不落盘：下次打开主界面还是先看干员那一组（那是玩家自己的阵容池，
 * 比"我上次翻到活动头像第 3 页"更常用）。
 */
let avatarTab = 'op';

/**
 * 造一个头像格子。
 *
 * ★ 干员和官方个人头像共用这一个函数 —— 两边的差别只有"图片地址"和"标题"，
 * 各写一遍必然会走散（比如只给干员加了加载失败的降级）。
 */
function avatarOptionNode(input: {
  id: string;
  label: string;
  path: string | null;
  fallbackColor: string;
}): HTMLButtonElement {
  const option = document.createElement('button');
  option.type = 'button';
  option.className = `avatar-option${myAvatarId === input.id ? ' selected' : ''}`;
  // 把 id 写在 DOM 上：一是方便调试（右键检查元素就知道这是谁），
  // 二是自动测试要靠它断言"点的是哪个头像"
  option.dataset.avatarId = input.id;
  option.title = input.label;
  /*
    直接写 <img src>，不走 getLoadedImage 那套预载缓存 ——
    这里是主界面，图片没加载出来也就是空一下，不影响任何游戏逻辑。

    【为什么不用 loading="lazy"？】
    头像在一个可滚动的网格里，懒加载会让"还没滚到的那几行"一直是空白 ——
    看起来就像"头像没显示"。
  */
  option.innerHTML = input.path
    ? `<img class="avatar-option-img" src="${input.path}" alt="${escapeHtml(input.label)}" />`
    : `<span class="avatar-option-fallback" style="background:${input.fallbackColor}"></span>`;
  /*
    ★ 图片加载失败时退成色块。
    以前失败就留一个破图图标（浏览器的"图裂"），在几十个格子里看着像坏了。
  */
  const img = option.querySelector('img');
  if (img) {
    img.addEventListener('error', () => {
      img.replaceWith(
        Object.assign(document.createElement('span'), {
          className: 'avatar-option-fallback',
          style: `background:${input.fallbackColor}`,
        }),
      );
    });
  }
  option.addEventListener('click', () => setMyAvatar(input.id));
  return option;
}

/**
 * 分组按钮：干员 / 默认 / 动态 / 纪念 / 活动。
 *
 * ★ 为什么要有分段？官方个人头像一共 203 张（PRTS「个人头像一览」那一套），
 *   和 55 个干员混在一面墙里既难找也没有"这是官方头像"的辨识度。
 */
function renderAvatarTabs(opCount: number): void {
  const tabs: Array<{ key: string; label: string; count: number }> = [
    { key: 'op', label: '干员', count: opCount },
    ...PLAYER_AVATAR_GROUPS.map((group) => ({
      key: group.key as string,
      label: group.label,
      count: group.count,
    })),
  ];
  el.avatarTabs.innerHTML = '';
  for (const tab of tabs) {
    if (tab.count <= 0) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `avatar-tab${avatarTab === tab.key ? ' active' : ''}`;
    button.dataset.tab = tab.key;
    // 名字 + 数量：数量让玩家知道"这一组有多大、值不值得点开"
    button.innerHTML = `${escapeHtml(tab.label)}<span class="avatar-tab-count">${tab.count}</span>`;
    button.addEventListener('click', () => {
      if (avatarTab === tab.key) return;
      avatarTab = tab.key;
      renderAvatarPicker();
    });
    el.avatarTabs.appendChild(button);
  }
}

/** 画出主界面上的头像选择器 */
function renderAvatarPicker(): void {
  /*
    干员只列 id 形如 opNN 的（不列召唤物）：召唤物不是干员，拿去当头像很怪，
    而且服务器的头像白名单也只认 opNN。
  */
  const defIds = Object.keys(UNIT_DEFS).filter((id) => /^op\d+$/.test(id) && !UNIT_DEFS[id]?.summonOnly);

  renderAvatarTabs(defIds.length);
  // ★ 标题跟着分组走：看官方头像时说"干员头像"会让人以为点错了
  el.avatarPickerTitle.textContent = avatarTab === 'op' ? '干员头像' : '官方个人头像';
  el.avatarGrid.innerHTML = '';

  if (avatarTab === 'op') {
    // ★ 0.3.2：右上角报一下总数（头像墙是可滚动的，不写数字很容易以为只有眼前这些）
    el.avatarPickerCount.textContent = `${defIds.length} 名`;
    for (const defId of defIds) {
      const def = UNIT_DEFS[defId];
      if (!def) continue;
      el.avatarGrid.appendChild(
        avatarOptionNode({
          id: defId,
          // 只留名字：不标费用（追加需求第 4 条），头像列表不是商店
          label: def.name,
          path: avatarPathOf(defId),
          fallbackColor: def.color,
        }),
      );
    }
  } else {
    const list = PLAYER_AVATARS.filter((avatar) => avatar.group === avatarTab);
    el.avatarPickerCount.textContent = `${list.length} 张`;
    for (const avatar of list) {
      el.avatarGrid.appendChild(
        avatarOptionNode({
          id: avatar.id,
          label: avatar.label,
          path: `/assets/player-avatars/${avatar.file}`,
          /*
            官方头像没有"主色"可降级 —— 用一块中性深灰。
            它们本来就在深色底上有描边，读不出来时不该变成花屏。
          */
          fallbackColor: '#2a3037',
        }),
      );
    }
  }

  renderAvatarPreview();
}

/** 主界面右上那个大预览框：实时显示"我当前用的头像" */
function renderAvatarPreview(): void {
  /** 干员头像取干员名；官方个人头像取清单里的 label（PRTS 上也只有编号） */
  const chosenOp = myAvatarId ? UNIT_DEFS[myAvatarId] : undefined;
  const chosenOfficial = playerAvatarOf(myAvatarId);
  const chosenName = chosenOp?.name ?? (chosenOfficial ? `官方头像 · ${chosenOfficial.label}` : '');
  const path = myAvatarId ? avatarPathOf(myAvatarId) : null;

  el.avatarPickerName.textContent = chosenName ? `${chosenName} · 再点一次取消` : '未选择（默认头像）';
  /*
    ★ 0.3.2：有头像时预览框的"四角括号"会更亮（样式在 theme-ark.css）——
    空框只是一个占位，不该和"已经选好了"看起来一样。
  */
  el.avatarPickerPreview.classList.toggle('has-avatar', Boolean(path && chosenName));

  /*
    ★★ 0.3.3：底部工具条那颗「头像」块也要跟着变 ——
    头像面板默认是关着的，玩家在大厅里只能看到这一小块，
    它必须能独立表达"我选了谁"（小头像 + 名字），否则隐藏式就等于"看不见选了什么"。
  */
  el.avatarChipBox.classList.toggle('has-avatar', Boolean(path && chosenName));
  el.avatarChipBox.innerHTML = path && chosenName ? `<img src="${path}" alt="" />` : '';
  el.avatarChipName.textContent = chosenName || '未选择';

  if (path && chosenName) {
    el.avatarPickerPreview.innerHTML = `<img src="${path}" alt="${escapeHtml(chosenName)}" />`;
    return;
  }
  /*
    没选：放一句提示，而不是留一个空框（空框看起来像加载失败）。
    ★ 0.3.2 文案改成「点头像选择」—— 头像墙现在在下面，说"右边"就不对了；
      这句同时被 `netplay-ui.test.ts` 用来断言"未选择时确实有提示"。
  */
  el.avatarPickerPreview.textContent = '点头像选择';
}

// ============================================================
// 右侧栏的视图切换（0.0.2 需求第 11 条）
// ============================================================

/**
 * 右侧栏当前显示哪一块：日志 / 玩家 / 藏品。
 *
 * 【为什么不做成"全都在一列里"？】
 * 原来玩家列表就挤在战斗日志同一列，一屏四块面板，
 * 布阵时想看玩家、战斗时想看日志，两边互相挤。
 * 改成切换之后每次只显示一块，信息密度立刻降下来了。
 */
type SideTab = 'log' | 'players' | 'collection';
let sideTab: SideTab = 'log';
/** 右侧栏是否被收起（右上角再点一次当前页签 = 收起） */
let sidebarHidden = false;

function renderSidebarTabs(): void {
  // 单机模式没有"玩家列表"可看，那一页签就禁掉
  const hasRoom = !!net.room;
  for (const node of el.sidebarTabs.querySelectorAll<HTMLButtonElement>('.sidebar-tab')) {
    const tab = node.dataset.sideTab as SideTab;
    if (tab === 'players') {
      node.disabled = !hasRoom;
      node.title = hasRoom
        ? '玩家列表：血量 / 等级 / 连胜连败'
        : '单机模式没有其他玩家';
    }
    node.classList.toggle('active', !sidebarHidden && tab === sideTab);
  }

  // 页面切到"玩家"但房间里没人了（比如掉线回主界面）-> 自动退回日志
  if (sideTab === 'players' && !hasRoom) sideTab = 'log';

  const show = !sidebarHidden;
  el.sidebar.classList.toggle('hidden', !show);
  el.sidePaneLog.classList.toggle('hidden', !show || sideTab !== 'log');
  el.sidePanePlayers.classList.toggle('hidden', !show || sideTab !== 'players');
  el.sidePaneCollection.classList.toggle('hidden', !show || sideTab !== 'collection');
}

// ============================================================
//  藏品（装备）★ 0.0.3
// ============================================================
/*
  这一整块对应需求原文：
    「右上角点击藏品就可以在右侧出现藏品栏，每个玩家有 15 格的位置来存放藏品，
      10 格为 A 类藏品的位置，5 格为 B 类藏品的位置，B 类藏品每个玩家有单独
      4 格格子可以进行装备，将 A 类藏品拖到干员身上即可装备，B 类藏品拖到 B 类
      藏品格即可装备，最下方为删除藏品，将藏品拖到删除藏品处即可删除。」

  【分层】
    · 格子数量、容量、栏位名字  -> game/items.ts（纯规则，有单元测试）
    · 装备 / 卸下 / 删除 / 获得 -> game/state.ts（会改状态，有单元测试）
    · 这一块只负责"把这些画出来 + 把拖拽接到那些函数上"
  所以这里**不许**出现任何"修改 state"的业务逻辑 —— 一律调上面那两层。
*/

/** 藏品稀有度配色（普通蓝灰、进阶金色，一眼分档） */
const ITEM_RARITY_STYLE: Record<string, { base: string; wash: string }> = {
  normal: { base: '#5f8bb8', wash: 'rgba(95, 139, 184, 0.20)' },
  advanced: { base: '#d9a92e', wash: 'rgba(217, 169, 46, 0.22)' },
};

function itemRarityStyle(item: { rarity: string }): { base: string; wash: string } {
  return ITEM_RARITY_STYLE[item.rarity] ?? ITEM_RARITY_STYLE.normal!;
}

/** 羁绊 id -> 中文名（藏品说明里"需 XX 羁绊"要用） */
function itemTraitName(traitId: string): string {
  return TRAIT_DEFS[traitId]?.name ?? traitId;
}

/**
 * 一件藏品的完整说明（多行文本，给格子的 title 用）。
 *
 * 【为什么要带"设计稿原文"？】
 * 效果文字是我从数值反推出来的（"攻击力 +20%"这种），
 * 而设计稿原文往往还写了**为什么/什么时候有用**（"前期过渡用"）。
 * 两个都给，玩家既能核对数值、又能看懂意图。
 */
function itemTooltipText(itemId: string): string {
  const item = ITEM_DEFS[itemId];
  if (!item) return itemId;
  const lines = itemEffectLines(item, itemTraitName);
  const head = `${item.name}（${ITEM_RARITY_LABEL[item.rarity] ?? item.rarity} · ${ITEM_SLOT_SHORT[item.slot] ?? item.slot}）`;
  return [head, ...lines, '', item.desc].filter((line, i) => line !== '' || i > 0).join('\n');
}

/**
 * 一件藏品的图标。
 *
 * 【★ 为什么一定要有兜底？】
 * 图标是从 prts.wiki 一张张下下来的，缺一张是完全正常的状态
 * （新加一件藏品、或者某个素材没抓到）。没有兜底的话，
 * 缺图那一格在界面上就是**一块空白** —— 玩家会以为"这格子坏了"，
 * 而不是"缺一张图"。回退成"首字 + 稀有度配色"的方块，
 * 一眼就知道"这里有件藏品，只是没图"，而且靠颜色还能分出稀有度。
 */
function buildItemIcon(itemId: string): HTMLElement {
  const item = ITEM_DEFS[itemId];
  const style = item ? itemRarityStyle(item) : ITEM_RARITY_STYLE.normal!;
  const box = document.createElement('div');
  box.className = 'item-icon';
  if (!item) {
    box.classList.add('item-icon-fallback');
    box.style.background = style.wash;
    box.textContent = '?';
    return box;
  }
  const loaded = getLoadedImage(itemIconPath(item.icon));
  if (loaded && itemIconLoaded(item.icon)) {
    const img = document.createElement('img');
    img.src = loaded.src;
    img.alt = item.name;
    box.appendChild(img);
    return box;
  }
  /*
    没加载到就先画首字色块，同时**异步补图**：加载成功后重画一次藏品栏。
    这样"第一帧没图、第二帧有图"，而不是永远没有 ——
    和备战席立绘 chibiPortraitUrl 那套是同一个思路。
  */
  if (!itemIconRequested.has(item.icon)) {
    itemIconRequested.add(item.icon);
    loadImage(itemIconPath(item.icon)).then((image) => {
      if (image) renderCollection();
    });
  }
  box.classList.add('item-icon-fallback');
  box.style.background = style.wash;
  box.style.color = style.base;
  box.textContent = item.name.slice(0, 1);
  return box;
}

/** 已经发起过加载请求的图标（避免每次重画都重新请求一遍 404） */
const itemIconRequested = new Set<string>();

/**
 * 画一个藏品格（有东西 / 空格子）。
 *
 * 【空格子为什么也要写 data-item-zone / -index？】
 * 和备战席同一个理由：拖动结束时是用 `document.elementFromPoint` 反查
 * "鼠标下面是哪一格"的。空格子没有这两个属性就没法当落点 ——
 * 而"拖到空格子"正是 B 类装进共享装备位最需要的一步。
 */
function buildItemSlot(
  itemId: string | null,
  zone: ItemZone,
  index: number,
  /*
    ★ 0.3.4：观战时看的是**别人的藏品栏** —— 一格都不能动。
    只读模式不加拖动、不加点击，连 `data-item-zone` 都不写
    （不然拖拽落点判定会把别人的格子当成可以放东西的地方）。
  */
  readOnly = false,
): HTMLElement {
  const node = document.createElement('div');
  if (!readOnly) {
    node.dataset.itemZone = zone;
    node.dataset.itemIndex = String(index);
  }

  if (!itemId) {
    node.className = 'item-slot empty';
    // 共享装备位的空格子给个"+装备位"的提示，一眼看出这里是能拖进来的
    if (zone === 'bequip') node.textContent = '+';
    return node;
  }

  const item = ITEM_DEFS[itemId];
  const style = item ? itemRarityStyle(item) : ITEM_RARITY_STYLE.normal!;
  node.className = `item-slot${zone === 'bequip' ? ' equipped' : ''}`;
  node.dataset.itemId = itemId;
  node.style.borderColor = style.base;
  node.style.boxShadow = `inset 0 0 12px ${style.wash}`;
  node.title = itemTooltipText(itemId);

  node.appendChild(buildItemIcon(itemId));

  const name = document.createElement('div');
  name.className = 'item-slot-name';
  name.textContent = item?.name ?? itemId;
  node.appendChild(name);

  const rarity = document.createElement('span');
  rarity.className = 'item-slot-rarity';
  rarity.style.background = style.base;
  node.appendChild(rarity);

  // ★ 0.3.4：观战看别人的藏品栏 -> 只是展示，不绑任何操作
  if (readOnly) {
    node.classList.add('readonly');
    return node;
  }

  /*
    拖动起点。★ 和备战席一样：**不** preventDefault（保留 click），
    轻点仍然是"顺手操作一下"，拖出去才改装备。
  */
  bindItemDragHandlers(node, { zone, index });

  /*
    点击的顺手操作：
      · 共享藏品**存放栏**里的 -> 装进第一个空的共享装备位（省一次拖动）
      · 共享装备位里的        -> 卸下（回到共享藏品存放栏）
      · 穿戴藏品存放栏里的    -> 不做事（需求明确是"拖到干员身上"才装备）
  */
  if (zone === 'b') {
    node.addEventListener('click', () => {
      const free = state.items.bEquip.findIndex((slot) => slot === null);
      if (free < 0) {
        toast(`共享装备位满了（${ITEM_B_EQUIP_SLOTS} 格）—— 先卸下一件`, true);
        return;
      }
      const result = equipSharedItem(state, index, free);
      toast(result.message, !result.ok);
      renderAll();
    });
  } else if (zone === 'bequip') {
    node.addEventListener('click', () => {
      const result = unequipSharedItem(state, index);
      toast(result.message, !result.ok);
      renderAll();
    });
  }

  return node;
}

/** 给一个藏品格绑上拖动（按下 / 移动 / 抬起 / 被打断四条路） */
function bindItemDragHandlers(node: HTMLElement, source: { zone: ItemZone; index: number }): void {
  node.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    beginDrag({ kind: 'item', zone: source.zone, index: source.index }, event, node);
    // 在格子上捕获指针：鼠标移到棋盘上也能继续收到 move 事件
    node.setPointerCapture(event.pointerId);
  });

  node.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.moved) {
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      drag.moved = true;
    }
    moveDragGhost(event.clientX, event.clientY);
    updateDragTarget(event.clientX, event.clientY);
  });

  node.addEventListener('pointerup', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId);
    endDrag(event.clientX, event.clientY);
  });

  node.addEventListener('pointercancel', () => cancelDrag());
}

/**
 * 重画右侧的藏品栏（三个区 + 计数）。
 *
 * ★★ 0.3：改成按格子就地更新（`renderKeyed`）。
 *
 * 【为什么不能再"整块重画"了？】
 * 除了"19 个格子的图标要重新解码"这种开销，还有一个更硬的问题：
 * 藏品格是**可拖动**的 —— `beginDrag` 里会对**那个 DOM 节点**做
 * `setPointerCapture`。一旦 `innerHTML = ''` 把节点换掉，
 * 指针捕获就跟着节点一起没了 ⇒ **拖到一半突然断掉**。
 * 而 `renderAll()` 在拖动过程中也会被触发（房间广播、商店同步…），
 * 所以这个隐患是真的会被点着的。
 * 现在签名没变的格子一个都不重建，拖动就不会被打断。
 */
function renderCollection(): void {
  const inv = state.items;

  /*
    ★★ 0.3.4（用户口径）：观战时**看得到对方的藏品栏**。
    以前切到别人的棋盘，棋盘/备战席/羁绊都换成他的，只有藏品栏还是我自己的
    —— 很容易误判（"他哪来这么多共享藏品"）。
    数据来自服务器转发的 `prepTeams[id].items`（只读快照），
    所以这里一旦拿到它，就**整块换成只读**：不绑拖动、不绑点击。
  */
  const viewedItems = viewingPlayerId !== null ? prepTeams[viewingPlayerId]?.items : undefined;
  const readOnly = Boolean(viewedItems);

  const fill = (container: HTMLElement, zone: ItemZone, size: number): number => {
    /*
      ★ 0.3.4：观战快照里的键名和界面上的 `ItemZone` 差一个字母
      （协议里叫 `bEquip`，界面里叫 `bequip`）—— 在这里翻译一次，
      别让这个差异散到界面各处。
    */
    const viewedZone = zone === 'bequip' ? 'bEquip' : zone;
    const viewedList = viewedItems ? viewedItems[viewedZone] : undefined;
    const view = viewedList
      ? viewedList.map((itemId: string | null, index: number) => ({
          index,
          itemId,
          item: itemId ? ITEM_DEFS[itemId] : undefined,
        }))
      : itemZoneView(state, zone);
    const specs: DomSpec[] = [];
    let used = 0;
    for (let i = 0; i < size; i++) {
      const slot = view[i] ?? { index: i, itemId: null, item: undefined };
      const itemId = slot.itemId ?? null;
      if (itemId) used++;
      const item = itemId ? ITEM_DEFS[itemId] : undefined;
      /*
        ★ 签名里必须带上「图标加载好了没」：
        `buildItemSlot` 会先画"首字色块"再异步补图，补完回调里重画一次 ——
        如果签名不变（还是同一个 itemId），那次重画会被跳过，
        色块就永远换不成真图标了。
        ★ 0.3.4：观战/自己的藏品栏是**两块不同的数据**，命名空间要分开，
          否则从"看别人"切回"看自己"时，两个都叫 `a:0` 的格子会被当成"没变"而不重画。
      */
      const iconReady = item ? (itemIconLoaded(item.icon) ? '1' : '0') : '-';
      specs.push({
        key: `${zone}:${i}`,
        sig: `${itemId ?? 'empty'}|${iconReady}|${readOnly ? 'ro' : 'rw'}`,
        build: () => buildItemSlot(itemId, zone, i, readOnly),
      });
    }
    renderKeyed(container, specs, {
      key: (spec) => spec.key,
      sig: (spec) => spec.sig,
      build: (spec) => spec.build(),
      ns: readOnly ? `items:watch:${viewingPlayerId}` : 'items',
    });
    return used;
  };

  const usedA = fill(el.itemSlotsA, 'a', ITEM_A_SLOTS);
  const usedB = fill(el.itemSlotsB, 'b', ITEM_B_SLOTS);
  const usedEquip = fill(el.itemSlotsBEquip, 'bequip', ITEM_B_EQUIP_SLOTS);

  /*
    ★ 0.3.2 升变之证专用栏：**只有真的拿到证才显示**（用户口径）。
      常态玩家（没选这条盟约 / 还没做完任务）根本看不到这 3 格。
      三格是固定的（青色 / 慈悲 / 终曲），空格子也画出来 ——
      让玩家知道"后面还有两格能填"，而不是缺一角像 bug。
  */
  const certCount = state.items.certSlots.filter((id) => id !== null).length;
  el.itemCertBlock.classList.toggle('hidden', certCount === 0);
  if (certCount > 0) {
    const usedCert = fill(el.itemSlotsCert, 'cert', AMIYA_CERT_SLOTS);
    el.itemCertCount.textContent = `${usedCert}/${AMIYA_CERT_SLOTS}`;
  }

  el.itemACount.textContent = `${usedA}/${ITEM_A_SLOTS}`;
  el.itemBCount.textContent = `${usedB}/${ITEM_B_SLOTS}`;
  el.itemBEquipCount.textContent = `${usedEquip}/${ITEM_B_EQUIP_SLOTS}`;

  /*
    非布阵阶段把整块置灰（拖动会被 beginDrag 拒绝）。

    【为什么不能"拖了没反应"就算了？】
    静默失败是最让人困惑的一类反馈：玩家会反复试、以为鼠标坏了。
    所以这里明确写出来"现在不能改装备，等下一回合布阵"。
  */
  const locked = !canEditTeam(state.phase);
  el.sidePaneCollection.classList.toggle('locked', locked);
  /*
    ★ 0.3.4：观战时这一栏是**别人的**，必须明写出来 ——
    否则玩家会把"他的三件共享藏品"当成自己的，越看越糊涂。
    只读的判据压过 locked（看别人时不是"等下一回合"，而是"你现在不能动"）。
  */
  const watchedName = viewingPlayerId
    ? (net.room?.players.find((p) => p.id === viewingPlayerId)?.name ?? '对方')
    : null;
  el.itemNote.innerHTML =
    watchedName !== null
      ? `👁 正在看 <strong>${escapeHtml(watchedName)}</strong> 的藏品（只读，不能拖也不能卸）`
      : locked
        ? '⏳ 战斗 / 结算阶段不能改装备 —— 等下一回合布阵时再整理'
        : '穿戴藏品拖到<strong>干员</strong>身上（每人 2 件）· 共享藏品拖到<strong>共享装备位</strong>（全队生效）';
  el.itemDeleteZone.classList.toggle('hidden', locked || readOnly);

  /*
    ★ 0.1.1 藏品二版：「共享藏品效果」栏。
    ★ 它**不跟 locked 一起藏** —— 恰恰相反，战斗/结算阶段才是最需要看它的时候
      （效果本来就是在战斗里生效的）。置灰规则只挂在格子和标题上，见 styles.css。
  */
  renderItemEffectList();
}

/**
 * ★ 0.1.1 藏品二版：「共享藏品效果」栏（共享装备位和删除区之间的那一块）。
 *
 * 【它回答的问题】
 * 「所以我现在到底生效着什么？」—— 和上面的装备位（"我摆了什么"）不是一回事：
 * 失落之钥装上就销毁、本体早不在栏里了，但永久效果一直在生效；
 * 黑流树海笔记 / 佣兵的饰物会叠层，同一个名字每回合数值都不一样。
 *
 * 【数据源只有一个】
 * state.ts 的 `activeItemEffects()` —— 它已经把"该显示什么"收口了
 * （哪些算生效、成长层数怎么取、永久效果怎么标）。这里只负责画。
 */
/**
 * ★ 0.1.2：本场战斗里「开局随机强化一名干员」**抽到了谁**。
 *
 * 【为什么要从日志里读？】
 * 抽签是战斗内核开局那一刻做的（用战斗自己的随机源，联机两端必须一致），
 * 界面没法重算一遍 —— 只能读日志里那条带 `itemId` 的增益事件。
 * 观战别人的战斗时返回 null（那是人家的抽签，不该显示在我这一栏里）。
 */
function randomBuffPickResolver(): (itemId: string) => string | null {
  const log = currentResult?.log;
  if (!log) return () => null;
  /*
    "日志里的哪一队算我这边"：
      · 联机 / 单机 —— myTeam（服务器可能把我分到 team 1，画面翻过来给我看）；
      · 测试模式沙盒 —— 两边都是我自己摆的，看 state.side（这一栏属于哪半边）。
  */
  const expectTeam = testSides ? state.side : myTeam;
  return (itemId) => {
    const picked = randomAllyBuffPick(log, itemId);
    if (picked === null) return null;
    const info = spawnedUnitInfo(log, picked);
    if (!info || info.team !== expectTeam) return null;
    return UNIT_DEFS[info.defId]?.name ?? null;
  };
}

function renderItemEffectList(): void {
  const effects = activeItemEffects(state, { randomBuffPick: randomBuffPickResolver() });
  el.itemEffectCount.textContent = effects.length === 0 ? '无' : `${effects.length} 项`;
  el.itemEffectList.innerHTML = '';

  if (effects.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'item-effect-empty';
    empty.textContent = '还没有生效中的效果 —— 把共享藏品拖到上面的「共享装备位」就会出现在这里。';
    el.itemEffectList.appendChild(empty);
    return;
  }

  for (const effect of effects) {
    const row = document.createElement('div');
    row.className = `item-effect${effect.permanent ? ' permanent' : ''}`;
    // 左边那条竖线用稀有度色 —— 和藏品栏里的格子是同一套颜色语言
    row.style.borderLeftColor = effect.item.rarity === 'advanced' ? '#ffd75e' : '#7fb0ff';
    row.appendChild(buildItemIcon(effect.item.id));

    const text = document.createElement('div');
    text.className = 'item-effect-text';

    const name = document.createElement('div');
    name.className = 'item-effect-name';
    name.textContent = effect.item.name;
    if (effect.permanent) {
      const tag = document.createElement('span');
      tag.className = 'item-effect-tag';
      tag.textContent = '永久';
      name.appendChild(tag);
    }
    if (effect.layers !== undefined) {
      const tag = document.createElement('span');
      tag.className = 'item-effect-tag';
      tag.textContent = `${effect.layers} 层`;
      name.appendChild(tag);
    }
    text.appendChild(name);

    const desc = document.createElement('div');
    desc.className = 'item-effect-desc';
    /*
      ★ 0.1.1：优先显示**实时数值**（"我现在吃到多少"）。
      没有实时维度（纯静态属性那种）才退回一句人话说明 ——
      以前这里贴的是 `lines`（机制全文），会出现
      "间隔=200 tick（10.0 秒）、active=false、修正包 …" 这种内部写法。
    */
    desc.textContent = effect.values.length > 0 ? effect.values.join(' · ') : effect.item.desc;
    text.appendChild(desc);

    row.appendChild(text);
    row.title = effect.item.desc;
    el.itemEffectList.appendChild(row);
  }
}

/**
 * 干员详情页里的「藏品」一栏（那两件**穿戴藏品** + 卸下按钮）。
 *
 * ★ 数据层里这一类叫 A 类，那只是代号；玩家看到的字一律是「穿戴藏品」。
 *
 * 【★ 为什么"卸下"要看穿戴藏品栏有没有空位？】
 * 因为卸下来的东西必须**放得回去**：穿戴藏品栏一共 10 格，
 * 满了还允许卸下的话，这件藏品就只能凭空消失。
 * 所以栏满时按钮禁用，并把原因写在旁边
 * （需求原文：「仅在 A 类藏品格有位置时可以卸下」）。
 */
function renderUnitInfoItems(unit: { items?: string[]; itemLayers?: number[] } | null): void {
  el.unitInfoItems.innerHTML = '';
  if (!unit) {
    el.unitInfoItemsBlock.classList.add('hidden');
    return;
  }
  el.unitInfoItemsBlock.classList.remove('hidden');

  const slots = unitItemSlots(unit);
  const uid = (unit as { uid?: number }).uid;
  const free = state.items.aSlots.filter((slot) => slot === null).length;

  el.unitInfoItemsHint.textContent =
    free > 0 ? `穿戴藏品栏还有 ${free} 格` : '穿戴藏品栏已满';

  for (let i = 0; i < slots.length; i++) {
    const item = slots[i] ?? null;
    const row = document.createElement('div');
    row.className = `unit-info-item${item ? '' : ' empty'}`;

    if (!item) {
      row.innerHTML = `<span class="unit-info-item-empty">装备位 ${i + 1}：空</span>`;
      el.unitInfoItems.appendChild(row);
      continue;
    }

    const style = itemRarityStyle(item);
    row.style.borderLeftColor = style.base;
    row.appendChild(buildItemIcon(item.id));

    const text = document.createElement('div');
    text.className = 'unit-info-item-text';
    const name = document.createElement('div');
    name.className = 'unit-info-item-name';
    name.textContent = `${item.name}（${ITEM_SLOT_SHORT[item.slot] ?? item.slot}）`;
    name.style.color = style.base;
    const effect = document.createElement('div');
    effect.className = 'unit-info-item-effect';
    /*
      ★ 0.1.1：和「共享藏品效果」栏同一个口径 —— 优先显示实时数值
      （按当前层数/金币/血量换算），没有实时维度才退回机制摘要。
      ★ 0.2：层数是**这一件**的（`unit.itemLayers[i]`），不是"这个 id 的"，否则
      两件同名藏品会显示同一个层数（用户报的 bug）。
    */
    const copyLayers =
      item.growth && item.growth.source !== 'emptySlot' ? layerAt(unit.itemLayers, i) : 0;
    const liveCtx = itemLiveContextOf(state, { randomBuffPick: randomBuffPickResolver() });
    const live = itemLiveLines(
      item,
      item.growth && item.growth.source !== 'emptySlot'
        ? { ...liveCtx, layerOverride: copyLayers }
        : liveCtx,
    );
    const layers = copyLayers;
    effect.textContent =
      live.length > 0
        ? (layers > 0 ? `${layers} 层 · ` : '') + live.join(' · ')
        : itemEffectSummary(item, itemTraitName);
    effect.title = itemTooltipText(item.id);
    text.append(name, effect);
    row.appendChild(text);

    const off = document.createElement('button');
    off.className = 'ghost-btn unit-info-item-off';
    off.textContent = '卸下';
    /*
      ★ 只有"栏里有空位"且"现在是布阵阶段"才允许卸下。
      两个条件都要写在禁用理由里，否则玩家不知道自己该做什么。
    */
    if (uid === undefined) {
      off.disabled = true;
      off.title = '战斗中的棋子不能改装备';
    } else if (free <= 0) {
      off.disabled = true;
      off.title = `${ITEM_A_SLOTS} 格穿戴藏品栏已经满了 —— 先删掉一件，或者给别的干员腾个位置`;
    } else if (!canEditTeam(state.phase)) {
      off.disabled = true;
      off.title = '战斗 / 结算阶段不能改装备';
    } else {
      off.addEventListener('click', () => {
        const result = unequipItemFromUnit(state, uid, i);
        toast(result.message, !result.ok);
        renderAll();
        // 面板里的内容变了（少了一件装备），重开一次让数据对齐
        const placement = unitInfoCell ? placementAt(state, unitInfoCell) : null;
        if (placement) renderUnitInfoItems(placement);
      });
    }
    row.appendChild(off);

    el.unitInfoItems.appendChild(row);
  }
}

/**
 * 当前看到的界面。
 *
 * 【为什么需要显式记这个？】
 * 因为有好几个地方要判断「玩家现在是不是真的在游戏里」：
 *   · 战斗结算后要不要自动开下一回合（不在游戏里就不能开）
 *   · 联机消息来了要不要弹提示
 * 靠 DOM 的 class 去猜很脆弱，不如记一个明确的状态。
 */
type ViewState = 'menu' | 'lobby' | 'game';
let currentView: ViewState = 'menu';

/**
 * 自动进入下一回合的定时器。
 * 声明在这里（而不是 finishBattle 附近）是因为 setView 也要用到它 ——
 * 切界面时要把待执行的定时器清掉，否则玩家返回主界面后还会被"推进回合"。
 */
let nextRoundTimer = 0;

/** 切换到某个界面 */
function setView(view: ViewState): void {
  currentView = view;
  el.mainMenu.classList.toggle('hidden', view !== 'menu');
  el.lobbyOverlay.classList.toggle('hidden', view !== 'lobby');
  el.gameHud.classList.toggle('hidden', view !== 'game');

  // 音乐按钮要跟着视图"搬家"：对局中进顶栏，其他界面浮在左上角
  placeMusicDock(view);

  // 离开游戏界面时，把正在进行的战斗和定时器都收掉
  if (view !== 'game') {
    window.clearTimeout(nextRoundTimer);
    cancelDrag();
    paused = true;
  }
  // 重新计算 3D 可视区域 —— 底部商店只在游戏界面显示，
  // 在主界面时画面应该占满整个窗口
  handleResize();
}

// ============================================================
// 界面元素引用
// ============================================================

const el = {
  // ---- 主界面 ----
  mainMenu: document.querySelector<HTMLElement>('#main-menu')!,
  menuButtons: document.querySelector<HTMLElement>('#menu-buttons')!,
  menuSolo: document.querySelector<HTMLButtonElement>('#menu-solo')!,
  menuTest: document.querySelector<HTMLButtonElement>('#menu-test')!,
  menuCreate: document.querySelector<HTMLButtonElement>('#menu-create')!,
  menuJoin: document.querySelector<HTMLButtonElement>('#menu-join')!,
  menuSettingsOpen: document.querySelector<HTMLButtonElement>('#menu-settings-open')!,
  /** ★ 0.3.2：「退出游戏」—— 黑框藏起来之后唯一的退出入口（只在启动器打开的页面里出现） */
  menuQuit: document.querySelector<HTMLButtonElement>('#menu-quit')!,
  menuStatus: document.querySelector<HTMLElement>('#menu-status')!,
  // 创建房间面板
  menuPanelCreate: document.querySelector<HTMLElement>('#menu-panel-create')!,
  menuNameCreate: document.querySelector<HTMLInputElement>('#menu-name-create')!,
  menuCreateBack: document.querySelector<HTMLButtonElement>('#menu-create-back')!,
  menuCreateGo: document.querySelector<HTMLButtonElement>('#menu-create-go')!,
  // 加入房间面板
  menuPanelJoin: document.querySelector<HTMLElement>('#menu-panel-join')!,
  menuNameJoin: document.querySelector<HTMLInputElement>('#menu-name-join')!,
  menuCode: document.querySelector<HTMLInputElement>('#menu-code')!,
  // ★ 0.3.3 局域网房间列表（加入房间页）
  lanRoomsList: document.querySelector<HTMLElement>('#lan-rooms-list')!,
  lanRoomsEmpty: document.querySelector<HTMLElement>('#lan-rooms-empty')!,
  lanRoomsState: document.querySelector<HTMLElement>('#lan-rooms-state')!,
  lanRoomsRefresh: document.querySelector<HTMLButtonElement>('#lan-rooms-refresh')!,
  menuJoinBack: document.querySelector<HTMLButtonElement>('#menu-join-back')!,
  menuJoinGo: document.querySelector<HTMLButtonElement>('#menu-join-go')!,
  // ★ 0.1.4：断线重连恢复（加入房间页里的手动兜底入口）
  menuJoinRecover: document.querySelector<HTMLButtonElement>('#menu-join-recover')!,
  // 设置面板
  menuPanelSettings: document.querySelector<HTMLElement>('#menu-panel-settings')!,
  menuServer: document.querySelector<HTMLInputElement>('#menu-server')!,
  // ★ 0.3.4 自定义快捷键
  keybindList: document.querySelector<HTMLElement>('#keybind-list')!,
  keybindReset: document.querySelector<HTMLButtonElement>('#keybind-reset')!,
  // ★ 0.3.4 新手教程（主界面右上角那颗「?」+ 翻页浮层）
  tutorialOpen: document.querySelector<HTMLButtonElement>('#tutorial-open')!,
  // ★ 0.3.4：版本号显示在教程旁边（值来自 shared 的 SERVER_VERSION，唯一来源）
  appVersion: document.querySelector<HTMLElement>('#app-version')!,
  tutorialOverlay: document.querySelector<HTMLElement>('#tutorial-overlay')!,
  tutorialTitle: document.querySelector<HTMLElement>('#tutorial-title')!,
  tutorialSub: document.querySelector<HTMLElement>('#tutorial-sub')!,
  tutorialStep: document.querySelector<HTMLElement>('#tutorial-step')!,
  tutorialBody: document.querySelector<HTMLElement>('#tutorial-body')!,
  tutorialDots: document.querySelector<HTMLElement>('#tutorial-dots')!,
  tutorialPrev: document.querySelector<HTMLButtonElement>('#tutorial-prev')!,
  tutorialNext: document.querySelector<HTMLButtonElement>('#tutorial-next')!,
  tutorialClose: document.querySelector<HTMLButtonElement>('#tutorial-close')!,
  menuSettingsBack: document.querySelector<HTMLButtonElement>('#menu-settings-back')!,
  menuSettingsSave: document.querySelector<HTMLButtonElement>('#menu-settings-save')!,
  // 头像选择（0.0.2 需求第 16 条 + 追加需求第 4 条）
  /*
    ★★ 0.3.3：头像选择改成**隐藏式浮层**（用户口径）。
    · `avatarOpen` = 主界面底部工具条里那个「头像 / 未选择 · 更换」的块；
    · `avatarChipBox` / `avatarChipName` = 那个块里的小头像和名字（关着的时候也要能看出选了什么）；
    · `avatarClose` = 浮层右上角的 ✕（和 Esc、点空白处三条路都能关）。
  */
  avatarOpen: document.querySelector<HTMLButtonElement>('#avatar-open')!,
  avatarChipBox: document.querySelector<HTMLElement>('#avatar-chip-box')!,
  avatarChipName: document.querySelector<HTMLElement>('#avatar-chip-name')!,
  avatarClose: document.querySelector<HTMLButtonElement>('#avatar-close')!,
  avatarPicker: document.querySelector<HTMLElement>('#avatar-picker')!,
  avatarGrid: document.querySelector<HTMLElement>('#avatar-grid')!,
  avatarPickerName: document.querySelector<HTMLElement>('#avatar-picker-name')!,
  /** ★ 0.3.2：右上角「已收录 N 名」—— 让人知道这一墙有多少可选，别以为只有看到的这些 */
  avatarPickerCount: document.querySelector<HTMLElement>('#avatar-picker-count')!,
  /** ★ 0.3.2：分组条容器（干员 / 默认 / 动态 / 纪念 / 活动） */
  avatarTabs: document.querySelector<HTMLElement>('#avatar-tabs')!,
  avatarPickerTitle: document.querySelector<HTMLElement>('#avatar-picker-title')!,
  // 当前头像的大预览框（0.0.2 追加需求第 4 条：主界面要能看出自己选了什么）
  avatarPickerPreview: document.querySelector<HTMLElement>('#avatar-picker-preview')!,

  // ---- 游戏内 UI 容器 ----
  gameHud: document.querySelector<HTMLElement>('#game-hud')!,
  btnBackMenu: document.querySelector<HTMLButtonElement>('#btn-back-menu')!,

  // 顶部
  hp: document.querySelector<HTMLElement>('#stat-hp')!,
  level: document.querySelector<HTMLElement>('#stat-level')!,
  pop: document.querySelector<HTMLElement>('#stat-pop')!,
  round: document.querySelector<HTMLElement>('#stat-round')!,
  // ★ 0.2.2：距离下一个野怪回合还剩几回合（单机 / 联机共用）
  monster: document.querySelector<HTMLElement>('#stat-monster')!,
  monsterWrap: document.querySelector<HTMLElement>('#stat-monster-wrap')!,
  waveHint: document.querySelector<HTMLElement>('#wave-hint')!,
  phase: document.querySelector<HTMLElement>('#stat-phase')!,
  // 右侧栏的视图切换（0.0.2：日志 / 玩家 / 藏品）
  sidebarTabs: document.querySelector<HTMLElement>('#sidebar-tabs')!,
  sidePaneLog: document.querySelector<HTMLElement>('#side-pane-log')!,
  sidePanePlayers: document.querySelector<HTMLElement>('#side-pane-players')!,
  sidePaneCollection: document.querySelector<HTMLElement>('#side-pane-collection')!,
  // 玩家列表（联机：看血量/等级/连胜连败，点头像看别人阵容）
  playerStripList: document.querySelector<HTMLElement>('#player-strip-list')!,
  btnBackMyBoard: document.querySelector<HTMLButtonElement>('#btn-back-my-board')!,
  // 战斗中"在和谁打"
  battleOpponent: document.querySelector<HTMLElement>('#battle-opponent')!,
  // ★ 0.1.1：战斗中"看哪一场"的切换条
  spectateBar: document.querySelector<HTMLElement>('#spectate-bar')!,
  // 左侧羁绊
  traitList: document.querySelector<HTMLElement>('#trait-list')!,
  // ★ 0.3.4 图鉴 + 组队器（入口按钮在羁绊列表正下方）
  codexOpen: document.querySelector<HTMLButtonElement>('#codex-open')!,
  codexOverlay: document.querySelector<HTMLElement>('#codex-overlay')!,
  codexClose: document.querySelector<HTMLButtonElement>('#codex-close')!,
  codexRail: document.querySelector<HTMLElement>('#codex-rail')!,
  codexMain: document.querySelector<HTMLElement>('#codex-main')!,
  codexTitle: document.querySelector<HTMLElement>('#codex-title')!,
  codexSub: document.querySelector<HTMLElement>('#codex-sub')!,
  codexCount: document.querySelector<HTMLElement>('#codex-count')!,
  // 右侧
  log: document.querySelector<HTMLElement>('#battle-log')!,
  damageStats: document.querySelector<HTMLElement>('#damage-stats')!,
  traitLogBlock: document.querySelector<HTMLElement>('#trait-log-block')!,
  traitLive: document.querySelector<HTMLElement>('#trait-live')!,
  traitLog: document.querySelector<HTMLElement>('#trait-log')!,
  zoomHint: document.querySelector<HTMLElement>('#zoom-hint')!,
  sidebar: document.querySelector<HTMLElement>('#sidebar')!,
  toast: document.querySelector<HTMLElement>('#toast')!,
  // 战斗条
  battleBar: document.querySelector<HTMLElement>('#battle-bar')!,
  hp0: document.querySelector<HTMLElement>('#hp0')!,
  hp1: document.querySelector<HTMLElement>('#hp1')!,
  teamName0: document.querySelector<HTMLElement>('#team-name-0')!,
  teamName1: document.querySelector<HTMLElement>('#team-name-1')!,
  seek: document.querySelector<HTMLInputElement>('#seek')!,
  battleTime: document.querySelector<HTMLElement>('#battle-time')!,
  speedGroup: document.querySelector<HTMLElement>('#speed-group')!,
  btnPause: document.querySelector<HTMLButtonElement>('#btn-pause')!,
  // 底部 dock
  dockGold: document.querySelector<HTMLElement>('#dock-gold')!,
  dockStreak: document.querySelector<HTMLElement>('#dock-streak')!,
  dockLevel: document.querySelector<HTMLElement>('#dock-level')!,
  dockXp: document.querySelector<HTMLElement>('#dock-xp')!,
  dockXpText: document.querySelector<HTMLElement>('#dock-xp-text')!,
  btnBuyXp: document.querySelector<HTMLButtonElement>('#btn-buy-xp')!,
  shopSlots: document.querySelector<HTMLElement>('#shop-slots')!,
  shopOdds: document.querySelector<HTMLElement>('#shop-odds')!,
  shopTitle: document.querySelector<HTMLElement>('.shop-title'),
  dock: document.querySelector<HTMLElement>('#dock'),
  btnRefresh: document.querySelector<HTMLButtonElement>('#btn-refresh')!,
  /** ★ 0.3.1：卡牌商店刷新按钮上的「特殊刷新」角标（盟约攒着的那一次） */
  btnRefreshBadge: document.querySelector<HTMLElement>('#btn-refresh-badge')!,
  btnLock: document.querySelector<HTMLButtonElement>('#btn-lock')!,
  btnBattle: document.querySelector<HTMLButtonElement>('#btn-battle')!,
  benchSlots: document.querySelector<HTMLElement>('#bench-slots')!,
  // ★ 0.1.1 观战：看别人时这两行要改文案（说明"这是他的备战席，不能动"）
  benchTitle: document.querySelector<HTMLElement>('#bench-title'),
  benchHint: document.querySelector<HTMLElement>('#bench-hint'),
  // ★ 0.1.1：备战席棋子的悬停卡片（只显示 名字/星级/羁绊/技能/射程）
  benchTip: document.querySelector<HTMLElement>('#bench-tip')!,
  // ★ 0.1.1：联机对局结算页
  resultPage: document.querySelector<HTMLElement>('#result-page')!,
  resultTitle: document.querySelector<HTMLElement>('#result-title')!,
  resultSub: document.querySelector<HTMLElement>('#result-sub')!,
  resultMvp: document.querySelector<HTMLElement>('#result-mvp')!,
  resultList: document.querySelector<HTMLElement>('#result-list')!,
  resultClose: document.querySelector<HTMLButtonElement>('#result-close')!,
  // ★ 0.3.5：「再来一局 · 返回房间」（打完一局之后把房间退回大厅）
  resultAgain: document.querySelector<HTMLButtonElement>('#result-again')!,
  // 房间等待
  lobbyOverlay: document.querySelector<HTMLElement>('#lobby-overlay')!,
  lobbyCode: document.querySelector<HTMLElement>('#lobby-code')!,
  lobbyPlayers: document.querySelector<HTMLElement>('#lobby-players')!,
  lobbyStatus: document.querySelector<HTMLElement>('#lobby-status')!,
  /** ★ 0.3.3：右上角「N / 8」的座位计数（只读，写在 renderLobby 里） */
  lobbyCount: document.querySelector<HTMLElement>('#lobby-count')!,
  // ★★ 0.3.3 人机：房主的「添加人机」那一行（普通人看不到）
  lobbyBotAdd: document.querySelector<HTMLElement>('#lobby-bot-add')!,
  lobbyBotDifficulty: document.querySelector<HTMLSelectElement>('#lobby-bot-difficulty')!,
  btnAddBot: document.querySelector<HTMLButtonElement>('#btn-add-bot')!,
  btnLobbyLeave: document.querySelector<HTMLButtonElement>('#btn-lobby-leave')!,
  btnLobbyReady: document.querySelector<HTMLButtonElement>('#btn-lobby-ready')!,
  btnLobbyStart: document.querySelector<HTMLButtonElement>('#btn-lobby-start')!,
  // ★ 0.3 房间设置（房主专用入口 + 面板）
  btnRoomSettings: document.querySelector<HTMLButtonElement>('#btn-room-settings')!,
  lobbyRules: document.querySelector<HTMLElement>('#lobby-rules')!,
  settingsOverlay: document.querySelector<HTMLElement>('#settings-overlay')!,
  settingsBody: document.querySelector<HTMLElement>('#settings-body')!,
  settingsError: document.querySelector<HTMLElement>('#settings-error')!,
  btnSettingsDefault: document.querySelector<HTMLButtonElement>('#btn-settings-default')!,
  btnSettingsClose: document.querySelector<HTMLButtonElement>('#btn-settings-close')!,
  // ★★ 0.3 盟约选秀页
  covenantOverlay: document.querySelector<HTMLElement>('#covenant-overlay')!,
  covenantPlayers: document.querySelector<HTMLElement>('#covenant-players')!,
  covenantGrid: document.querySelector<HTMLElement>('#covenant-grid')!,
  covenantDetail: document.querySelector<HTMLElement>('#covenant-detail')!,
  covenantTimer: document.querySelector<HTMLElement>('#covenant-timer')!,
  covenantHint: document.querySelector<HTMLElement>('#covenant-hint')!,
  covenantPick: document.querySelector<HTMLButtonElement>('#covenant-pick')!,
  covenantSkip: document.querySelector<HTMLButtonElement>('#covenant-skip')!,
  covenantClock: document.querySelector<HTMLElement>('.covenant-clock')!,
  // ★★ 0.3 盟约效果弹窗（对局内点玩家列表里的盟约）
  covenantInfo: document.querySelector<HTMLElement>('#covenant-info')!,
  covenantInfoName: document.querySelector<HTMLElement>('#covenant-info-name')!,
  covenantInfoBrief: document.querySelector<HTMLElement>('#covenant-info-brief')!,
  covenantInfoBody: document.querySelector<HTMLElement>('#covenant-info-body')!,
  covenantInfoOk: document.querySelector<HTMLButtonElement>('#covenant-info-ok')!,
  // ★ 0.3 名字被拒的提示弹窗
  nameAlert: document.querySelector<HTMLElement>('#name-alert')!,
  nameAlertMsg: document.querySelector<HTMLElement>('#name-alert-msg')!,
  nameAlertHint: document.querySelector<HTMLElement>('#name-alert-hint')!,
  nameAlertOk: document.querySelector<HTMLButtonElement>('#name-alert-ok')!,

  // 羁绊详情（内嵌在左侧面板里，不是弹窗）
  traitsListView: document.querySelector<HTMLElement>('#traits-list-view')!,
  traitsDetailView: document.querySelector<HTMLElement>('#traits-detail-view')!,
  detailBack: document.querySelector<HTMLButtonElement>('#detail-back')!,
  detailName: document.querySelector<HTMLElement>('#detail-name')!,
  detailKind: document.querySelector<HTMLElement>('#detail-kind')!,
  detailCount: document.querySelector<HTMLElement>('#detail-count')!,
  detailTiers: document.querySelector<HTMLElement>('#detail-tiers')!,
  detailUnits: document.querySelector<HTMLElement>('#detail-units')!,

  // 干员信息小窗口
  unitInfo: document.querySelector<HTMLElement>('#unit-info')!,
  unitInfoClose: document.querySelector<HTMLButtonElement>('#unit-info-close')!,
  unitInfoPortrait: document.querySelector<HTMLElement>('#unit-info-portrait')!,
  unitInfoName: document.querySelector<HTMLElement>('#unit-info-name')!,
  unitInfoSub: document.querySelector<HTMLElement>('#unit-info-sub')!,
  unitInfoStats: document.querySelector<HTMLElement>('#unit-info-stats')!,
  unitInfoTraits: document.querySelector<HTMLElement>('#unit-info-traits')!,
  // ★ 0.1.1：这一块的标题是动态的（布阵「羁绊」/ 战斗「当前效果」）
  unitInfoTraitsTitle: document.querySelector<HTMLElement>('#unit-info-traits-title')!,
  unitInfoManabar: document.querySelector<HTMLElement>('#unit-info-manabar')!,
  unitInfoManaFill: document.querySelector<HTMLElement>('#unit-info-manafill')!,
  unitInfoManaText: document.querySelector<HTMLElement>('#unit-info-manatext')!,
  unitInfoManaState: document.querySelector<HTMLElement>('#unit-info-manastate')!,
  unitInfoSkill: document.querySelector<HTMLElement>('#unit-info-skill')!,
  unitInfoRecall: document.querySelector<HTMLButtonElement>('#unit-info-recall')!,
  // ★ 0.0.3 藏品：干员详情页里的那两件装备（带「卸下」）
  unitInfoItemsBlock: document.querySelector<HTMLElement>('#unit-info-items-block')!,
  unitInfoItemsHint: document.querySelector<HTMLElement>('#unit-info-items-hint')!,
  unitInfoItems: document.querySelector<HTMLElement>('#unit-info-items')!,
  // ★ 0.1.2 测试模式：干员基础属性修改面板（只有「修改器 -> 数值修改」开着时才出现）
  unitEdit: document.querySelector<HTMLElement>('#unit-edit')!,
  unitEditClose: document.querySelector<HTMLButtonElement>('#unit-edit-close')!,
  unitEditTitle: document.querySelector<HTMLElement>('#unit-edit-title')!,
  unitEditSub: document.querySelector<HTMLElement>('#unit-edit-sub')!,
  unitEditRows: document.querySelector<HTMLElement>('#unit-edit-rows')!,
  unitEditError: document.querySelector<HTMLElement>('#unit-edit-error')!,
  unitEditReset: document.querySelector<HTMLButtonElement>('#unit-edit-reset')!,
  unitEditCancel: document.querySelector<HTMLButtonElement>('#unit-edit-cancel')!,
  unitEditSave: document.querySelector<HTMLButtonElement>('#unit-edit-save')!,

  // ---- ★ 0.0.3 藏品栏（右侧第三个页签）----
  itemSlotsA: document.querySelector<HTMLElement>('#item-slots-a')!,
  itemSlotsB: document.querySelector<HTMLElement>('#item-slots-b')!,
  itemSlotsBEquip: document.querySelector<HTMLElement>('#item-slots-bequip')!,
  itemACount: document.querySelector<HTMLElement>('#item-a-count')!,
  itemBCount: document.querySelector<HTMLElement>('#item-b-count')!,
  itemBEquipCount: document.querySelector<HTMLElement>('#item-bequip-count')!,
  // ★ 0.3.2 升变之证专用栏（3 格，只有拿到证才显示）
  itemCertBlock: document.querySelector<HTMLElement>('#item-cert-block')!,
  itemSlotsCert: document.querySelector<HTMLElement>('#item-slots-cert')!,
  itemCertCount: document.querySelector<HTMLElement>('#item-cert-count')!,
  // ★ 0.3.2 升变任务进度（日志面板常驻，只有选了「不容拒绝」才显示）
  amiyaQuestBlock: document.querySelector<HTMLElement>('#amiya-quest-block')!,
  amiyaQuest: document.querySelector<HTMLElement>('#amiya-quest')!,
  amiyaQuestHint: document.querySelector<HTMLElement>('#amiya-quest-hint')!,
  // ★ 0.3.2 一阶段达成：二选一发证
  certChoiceOverlay: document.querySelector<HTMLElement>('#cert-choice-overlay')!,
  certChoiceBlue: document.querySelector<HTMLButtonElement>('#cert-choice-blue')!,
  certChoiceMercy: document.querySelector<HTMLButtonElement>('#cert-choice-mercy')!,
  certChoiceBlueImg: document.querySelector<HTMLImageElement>('#cert-choice-blue-img')!,
  certChoiceMercyImg: document.querySelector<HTMLImageElement>('#cert-choice-mercy-img')!,
  // ★ 0.1.1 藏品二版：「共享藏品效果」栏（共享装备位和删除区之间）
  itemEffectCount: document.querySelector<HTMLElement>('#item-effect-count')!,
  itemEffectList: document.querySelector<HTMLElement>('#item-effect-list')!,
  itemDeleteZone: document.querySelector<HTMLElement>('#item-delete-zone')!,
  itemNote: document.querySelector<HTMLElement>('#item-note')!,

  // 二次确认
  confirmOverlay: document.querySelector<HTMLElement>('#confirm-overlay')!,
  confirmTitle: document.querySelector<HTMLElement>('#confirm-title')!,
  confirmMessage: document.querySelector<HTMLElement>('#confirm-message')!,
  confirmCancel: document.querySelector<HTMLButtonElement>('#confirm-cancel')!,
  confirmOk: document.querySelector<HTMLButtonElement>('#confirm-ok')!,
  // ★ 0.1.1：房主改别人昵称的小弹窗
  renameOverlay: document.querySelector<HTMLElement>('#rename-overlay')!,
  renameWhose: document.querySelector<HTMLElement>('#rename-whose')!,
  renameInput: document.querySelector<HTMLInputElement>('#rename-input')!,
  renameError: document.querySelector<HTMLElement>('#rename-error')!,
  renameCancel: document.querySelector<HTMLButtonElement>('#rename-cancel')!,
  renameOk: document.querySelector<HTMLButtonElement>('#rename-ok')!,
  // ★ 0.1.3：请人出房间（房主写留言）+ 被请出时看留言
  kickOverlay: document.querySelector<HTMLElement>('#kick-overlay')!,
  kickWhose: document.querySelector<HTMLElement>('#kick-whose')!,
  kickInput: document.querySelector<HTMLInputElement>('#kick-input')!,
  kickError: document.querySelector<HTMLElement>('#kick-error')!,
  kickCancel: document.querySelector<HTMLButtonElement>('#kick-cancel')!,
  kickOk: document.querySelector<HTMLButtonElement>('#kick-ok')!,
  kickedOverlay: document.querySelector<HTMLElement>('#kicked-overlay')!,
  kickedMessage: document.querySelector<HTMLElement>('#kicked-message')!,
  kickedOk: document.querySelector<HTMLButtonElement>('#kicked-ok')!,
  // ★ 0.1.4：重连失败的明确交代（见 showResumeFailedOverlay）
  resumeFailedOverlay: document.querySelector<HTMLElement>('#resume-failed-overlay')!,
  resumeFailedMessage: document.querySelector<HTMLElement>('#resume-failed-message')!,
  resumeFailedHint: document.querySelector<HTMLElement>('#resume-failed-hint')!,
  resumeFailedOk: document.querySelector<HTMLButtonElement>('#resume-failed-ok')!,

  // ★ 0.1.2：断线重连浮层（连接断了、座位还留着时盖住画面）
  resyncOverlay: document.querySelector<HTMLElement>('#resync-overlay')!,
  machineBusyOverlay: document.querySelector<HTMLElement>('#machine-busy-overlay')!,
  machineBusyMessage: document.querySelector<HTMLElement>('#machine-busy-message')!,
  machineBusyTakeover: document.querySelector<HTMLButtonElement>('#machine-busy-takeover')!,
  machineBusyStay: document.querySelector<HTMLButtonElement>('#machine-busy-stay')!,
  resyncMessage: document.querySelector<HTMLElement>('#resync-message')!,
  resyncRetry: document.querySelector<HTMLButtonElement>('#resync-retry')!,
  resyncLeave: document.querySelector<HTMLButtonElement>('#resync-leave')!,

  // ★ 0.1.4：对局暂停浮层（有人掉线）+ 主界面右下角「回到对局」
  pauseOverlay: document.querySelector<HTMLElement>('#pause-overlay')!,
  pauseMessage: document.querySelector<HTMLElement>('#pause-message')!,
  pauseTimer: document.querySelector<HTMLElement>('#pause-timer')!,
  pauseVotes: document.querySelector<HTMLElement>('#pause-votes')!,
  pauseAgree: document.querySelector<HTMLButtonElement>('#pause-agree')!,
  menuReconnect: document.querySelector<HTMLButtonElement>('#menu-reconnect')!,
  menuReconnectText: document.querySelector<HTMLElement>('#menu-reconnect-text')!,

  // ★ 0.2 MujicaAve：fever 达标的「保留 / 消耗」次级页面
  feverOverlay: document.querySelector<HTMLElement>('#fever-overlay')!,
  feverMessage: document.querySelector<HTMLElement>('#fever-message')!,
  feverTotal: document.querySelector<HTMLElement>('#fever-total')!,
  feverHold: document.querySelector<HTMLButtonElement>('#fever-hold')!,
  feverSpend: document.querySelector<HTMLButtonElement>('#fever-spend')!,

  // ★ 0.2 商店回合：坎诺特的限时商店（弹窗 + 金币上方那个开关）
  shopRoundOverlay: document.querySelector<HTMLElement>('#shop-round-overlay')!,
  shopRoundCard: document.querySelector<HTMLElement>('.shop-round-card')!,
  shopRoundTabBuy: document.querySelector<HTMLButtonElement>('#shop-round-tab-buy')!,
  shopRoundTabSell: document.querySelector<HTMLButtonElement>('#shop-round-tab-sell')!,
  shopRoundTimer: document.querySelector<HTMLElement>('#shop-round-timer')!,
  shopRoundClose: document.querySelector<HTMLButtonElement>('#shop-round-close')!,
  shopRoundSlots: document.querySelector<HTMLElement>('#shop-round-slots')!,
  shopRoundGold: document.querySelector<HTMLElement>('#shop-round-gold')!,
  shopRoundReroll: document.querySelector<HTMLButtonElement>('#shop-round-reroll')!,
  shopRoundEnd: document.querySelector<HTMLButtonElement>('#shop-round-end')!,
  shopRoundRerollCost: document.querySelector<HTMLElement>('#shop-round-reroll-cost')!,
  /** ★ 0.3.1：坎诺特商店刷新按钮上的「免费 ×N」角标 */
  shopRoundRerollBadge: document.querySelector<HTMLElement>('#shop-round-reroll-badge')!,
  shopRoundHint: document.querySelector<HTMLElement>('#shop-round-hint')!,
  shopRoundNpcLine: document.querySelector<HTMLElement>('#shop-round-npc-line')!,
  btnShopRound: document.querySelector<HTMLButtonElement>('#btn-shop-round')!,
  shopRoundToggleTimer: document.querySelector<HTMLElement>('#shop-round-toggle-timer')!,

  // ---- 背景音乐 ----
  topbar: document.querySelector<HTMLElement>('#topbar')!,
  musicAudio: document.querySelector<HTMLAudioElement>('#music-audio')!,
  musicDock: document.querySelector<HTMLElement>('#music-dock')!,
  musicToggle: document.querySelector<HTMLButtonElement>('#music-toggle')!,
  musicIcon: document.querySelector<HTMLElement>('#music-icon')!,
  musicNow: document.querySelector<HTMLElement>('#music-now')!,
  musicPanel: document.querySelector<HTMLElement>('#music-panel')!,
  musicClose: document.querySelector<HTMLButtonElement>('#music-close')!,
  musicCurrent: document.querySelector<HTMLElement>('#music-current')!,
  musicPrev: document.querySelector<HTMLButtonElement>('#music-prev')!,
  musicPlay: document.querySelector<HTMLButtonElement>('#music-play')!,
  musicNext: document.querySelector<HTMLButtonElement>('#music-next')!,
  musicTime: document.querySelector<HTMLElement>('#music-time')!,
  /** ★ 0.3.3：可拖动的进度条（0~1000 的千分位，按 duration 换算成秒） */
  musicSeek: document.querySelector<HTMLInputElement>('#music-seek')!,
  /** ★ 0.3.3：播放 / 暂停 / 未选曲 那一小行状态字 */
  musicState: document.querySelector<HTMLElement>('#music-state')!,
  musicSelect: document.querySelector<HTMLSelectElement>('#music-select')!,
  musicShuffle: document.querySelector<HTMLButtonElement>('#music-shuffle')!,
  musicRepeat: document.querySelector<HTMLButtonElement>('#music-repeat')!,
  musicMute: document.querySelector<HTMLButtonElement>('#music-mute')!,
  musicVolume: document.querySelector<HTMLInputElement>('#music-volume')!,
  musicHint: document.querySelector<HTMLElement>('#music-hint')!,
  musicEmpty: document.querySelector<HTMLElement>('#music-empty')!,

  // ---- 修改器（★ 0.0.3，只有测试模式出现）----
  modifierBtn: document.querySelector<HTMLButtonElement>('#btn-modifier')!,
  modifierPanel: document.querySelector<HTMLElement>('#modifier-panel')!,
  modifierClose: document.querySelector<HTMLButtonElement>('#modifier-close')!,
  modifierInfiniteGold: document.querySelector<HTMLInputElement>('#modifier-infinite-gold')!,
  modifierAddGold: document.querySelector<HTMLButtonElement>('#modifier-add-gold')!,
  modifierIgnorePop: document.querySelector<HTMLInputElement>('#modifier-ignore-pop')!,
  modifierLevel: document.querySelector<HTMLSelectElement>('#modifier-level')!,
  modifierUnit: document.querySelector<HTMLSelectElement>('#modifier-unit')!,
  modifierStar: document.querySelector<HTMLSelectElement>('#modifier-star')!,
  modifierGrant: document.querySelector<HTMLButtonElement>('#modifier-grant')!,
  // ★ 0.0.3：获得藏品（逻辑和「获得干员」一样，只是发的是藏品）
  modifierItem: document.querySelector<HTMLSelectElement>('#modifier-item')!,
  modifierGrantItem: document.querySelector<HTMLButtonElement>('#modifier-grant-item')!,
  // ★ 0.1.2：数值修改开关（打开后布阵阶段点干员弹属性面板，不弹详情页）
  modifierStatEdit: document.querySelector<HTMLInputElement>('#modifier-stat-edit')!,
  // ★ 0.0.3 测试沙盒：在蓝方 / 红方之间切换操作视角（放在「修改器」按钮旁边）
  switchSideBtn: document.querySelector<HTMLButtonElement>('#btn-switch-side')!,
};

// ============================================================
// 背景音乐
// ============================================================
/**
 * 【为什么音频元素和界面都放在 setView 管不到的地方？】
 * `setView` 会隐藏 #game-hud / #main-menu，但音乐必须**跨视图继续放** ——
 * 大厅里放着歌进去打一局，中途不能断。所以 <audio> 挂在 body 上，
 * 播放器实例也是全局单例，跟视图切换完全无关。
 *
 * 【按钮为什么要"搬家"？】
 * 需求是"放到主界面左上角"。但左上角对局中被占了：
 *   顶栏最左边是「← 返回大厅」，它下面紧接着是羁绊面板。
 * 所以对局中把音符按钮插进顶栏（紧挨着返回键，仍然在左上角），
 * 其他界面则让它浮在真正的左上角。详见 styles.css 里的长注释。
 */

const music: MusicPlayer = createMusicPlayer({
  audio: el.musicAudio,
  base: import.meta.env.BASE_URL,
  // 第一次进游戏（还没存过偏好）默认放《生命流》。
  // 之后玩家自己选过哪首就记哪首 —— 这里只是"默认值"，不是每次都重置。
  defaultTrack: '生命流',
});

let musicPanelOpen = false;
/** 下拉框里的选项建过没有 —— 曲目表不变就不重建，免得每次渲染都重置滚动位置 */
let musicOptionsBuilt = 0;

/** 把音符按钮放到当前视图该在的位置 */
function placeMusicDock(view: ViewState): void {
  if (view === 'game') {
    el.musicDock.classList.remove('floating');
    const back = el.topbar.querySelector('#btn-back-menu');
    // 紧跟在「← 返回大厅」后面；已经在那儿就别动（搬 DOM 会打断 CSS 动画）
    if (back && back.nextSibling !== el.musicDock) el.topbar.insertBefore(el.musicDock, back.nextSibling);
  } else {
    if (el.musicDock.parentElement !== document.body) document.body.appendChild(el.musicDock);
    el.musicDock.classList.add('floating');
  }
  if (musicPanelOpen) positionMusicPanel();
}

/**
 * 把面板贴到按钮下面。
 *
 * 面板挂在 body 上（不在按钮里面，原因见 styles.css），位置得自己算。
 * 顺便做一次边界收敛：靠右/靠下超出屏幕时往里推，
 * 否则窄窗口上面板会被切掉一半。
 */
function positionMusicPanel(): void {
  const rect = el.musicDock.getBoundingClientRect();
  const width = el.musicPanel.offsetWidth || 306;
  const height = el.musicPanel.offsetHeight || 300;

  let left = rect.left;
  if (left + width > window.innerWidth - 10) left = Math.max(10, window.innerWidth - width - 10);
  let top = rect.bottom + 8;
  if (top + height > window.innerHeight - 10) top = Math.max(10, window.innerHeight - height - 10);

  el.musicPanel.style.left = `${left}px`;
  el.musicPanel.style.top = `${top}px`;
}

function setMusicPanel(open: boolean): void {
  musicPanelOpen = open;
  el.musicPanel.classList.toggle('hidden', !open);
  el.musicToggle.setAttribute('aria-expanded', String(open));
  if (open) positionMusicPanel();
}

/**
 * 按专辑分组建下拉选项（47 张专辑 / 62 首，不分组会是一条 62 项的长龙）。
 *
 * 先按专辑把下标收进 Map、再渲染 —— 这样**不依赖 tracks.json 已经排好序**。
 * 早先的写法是"album 变了就开一个新组"，遇到专辑交错的输入
 * （例如 专辑一 / OST1 / 专辑一）会开出两个同名组，看着像重复。
 * Map 保证每个专辑只出现一次，同时 option 的 value 仍然是曲目在原数组里的下标。
 */
function buildMusicOptions(snapshot: MusicSnapshot): void {
  if (snapshot.count === musicOptionsBuilt) return;
  musicOptionsBuilt = snapshot.count;
  el.musicSelect.innerHTML = '';

  const albums = new Map<string, number[]>();
  snapshot.tracks.forEach((track, index) => {
    const album = track.album || '单曲';
    const list = albums.get(album);
    if (list) list.push(index);
    else albums.set(album, [index]);
  });

  for (const [album, indices] of albums) {
    const group = document.createElement('optgroup');
    group.label = album;
    for (const index of indices) {
      const track = snapshot.tracks[index]!;
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = track.duration ? `${track.title} · ${formatTime(track.duration)}` : track.title;
      group.appendChild(option);
    }
    el.musicSelect.appendChild(group);
  }
}

function renderMusic(snapshot: MusicSnapshot): void {
  // 没有曲目就整条藏起来 —— 不给玩家一个点了没反应的按钮
  el.musicDock.classList.toggle('hidden', snapshot.count === 0);
  el.musicDock.classList.toggle('playing', snapshot.playing);

  buildMusicOptions(snapshot);

  const track = snapshot.tracks[snapshot.current];
  el.musicNow.textContent = track ? track.title : '音乐';
  el.musicCurrent.textContent = track
    ? track.album && track.album !== track.title
      ? `${track.title} · ${track.album}`
      : track.title
    : snapshot.error
      ? `音乐不可用：${snapshot.error}`
      : '还没有选曲';

  el.musicPlay.textContent = snapshot.playing ? '⏸' : '▶';
  el.musicPrev.disabled = snapshot.count <= 1;
  el.musicNext.disabled = snapshot.count <= 1;

  if (snapshot.current >= 0 && document.activeElement !== el.musicSelect) {
    el.musicSelect.value = String(snapshot.current);
  }

  el.musicShuffle.classList.toggle('active', snapshot.shuffle);
  /*
    ★ 0.3.3：按钮上不再带 emoji（🔁）—— 那套图形和皮肤层的"几何 + 大字距小标签"
    不是一种语言。循环状态由 `.active` 的荧光描边表达，文字只写模式名。
  */
  el.musicRepeat.textContent = REPEAT_LABEL[snapshot.repeat];
  el.musicRepeat.classList.toggle('active', snapshot.repeat !== 'off');

  el.musicMute.textContent = snapshot.muted || snapshot.volume === 0 ? '🔇' : '🔊';
  const volumePercent = Math.round((snapshot.muted ? 0 : snapshot.volume) * 100);
  if (document.activeElement !== el.musicVolume) el.musicVolume.value = String(volumePercent);

  /*
    ★ 0.3.3：状态那一小行（原来只有时间，看不出"到底是停了还是在放"）。
    `blocked` = 浏览器拦了自动播放，这时说"等待点击"比"已暂停"更准确。
  */
  el.musicState.textContent = snapshot.blocked
    ? '等待点击'
    : snapshot.count === 0
      ? '无曲目'
      : snapshot.playing
        ? '播放中'
        : '已暂停';

  el.musicHint.classList.toggle('hidden', !snapshot.blocked);
  el.musicEmpty.classList.toggle('hidden', !(snapshot.count === 0 && !snapshot.loading));
}

/** 播放进度（timeupdate 事件比较密，只改文字，不整块重画） */
function renderMusicTime(): void {
  const snapshot = music.getSnapshot();
  const track = snapshot.tracks[snapshot.current];
  /*
    ★★ 0.3.3：总时长以**音频元素自己的 `duration`** 为准，读不到才退回清单里的元数据。
    【为什么要改？】进度条要能拖 ⇒ "显示的长度"和"拖动的换算基准"必须是同一个数。
    以前显示的是清单里那个 duration、而拖动只能用 `audio.duration` ——
    两者差一点（码率/容器头）就会"拖到 90% 却跳到了 87%"。
  */
  const mediaDuration = el.musicAudio.duration;
  const total =
    Number.isFinite(mediaDuration) && mediaDuration > 0 ? mediaDuration : (track?.duration ?? 0);
  const now = Number.isFinite(el.musicAudio.currentTime) ? el.musicAudio.currentTime : 0;
  el.musicTime.textContent = `${formatTime(now)} / ${formatTime(total)}`;
  /*
    ★ 0.3.3 进度条：0~1000 的千分位。
    ★ 正在拖的时候不回写 —— 否则手指还没松开，timeupdate 就把滑块拽回去了。
  */
  if (document.activeElement !== el.musicSeek && total > 0) {
    el.musicSeek.value = String(Math.round((now / total) * 1000));
  }
}

music.subscribe(renderMusic);
el.musicAudio.addEventListener('timeupdate', renderMusicTime);
el.musicAudio.addEventListener('loadedmetadata', renderMusicTime);
el.musicAudio.addEventListener('ended', renderMusicTime);

el.musicToggle.addEventListener('click', () => setMusicPanel(!musicPanelOpen));
el.musicClose.addEventListener('click', () => setMusicPanel(false));
el.musicPlay.addEventListener('click', () => music.toggle());
el.musicPrev.addEventListener('click', () => music.prev());
el.musicNext.addEventListener('click', () => music.next());
el.musicSelect.addEventListener('change', () => music.select(Number(el.musicSelect.value)));
el.musicShuffle.addEventListener('click', () => music.toggleShuffle());
el.musicRepeat.addEventListener('click', () => music.cycleRepeat());
el.musicMute.addEventListener('click', () => music.toggleMute());
el.musicVolume.addEventListener('input', () => music.setVolume(Number(el.musicVolume.value) / 100));
/*
  ★ 0.3.3：拖动进度条跳转。
  · `input` 期间只改位置（不暂停），松手（`change`）后把焦点还给页面 ——
    `renderMusicTime` 里那条 "activeElement !== musicSeek 才回写" 靠它解除。
  · 总时长还没读到（`duration` 是 NaN / 0，比如纯音频流）就什么都不做：
    除零会写出 Infinity，浏览器会直接把 currentTime 拍回 0，看起来像"拖了没反应"。
*/
el.musicSeek.addEventListener('input', () => {
  const duration = el.musicAudio.duration;
  if (!Number.isFinite(duration) || duration <= 0) return;
  el.musicAudio.currentTime = (Number(el.musicSeek.value) / 1000) * duration;
});
el.musicSeek.addEventListener('change', () => el.musicSeek.blur());

// 点面板外面收起来（点棋盘、点商店时不该留着一个挡视线的浮层）
window.addEventListener(
  'pointerdown',
  (event) => {
    if (!musicPanelOpen) return;
    const node = event.target as Node | null;
    if (node && (el.musicPanel.contains(node) || el.musicDock.contains(node))) return;
    setMusicPanel(false);
  },
  { capture: true },
);

// 窗口尺寸一变，面板的落点就得重算（它按按钮的实际矩形定位）
window.addEventListener('resize', () => {
  if (musicPanelOpen) positionMusicPanel();
});

// 快捷键：M = 播放/暂停。放在这里而不是游戏那套 keydown 里 ——
// 音乐在大厅里也要能控制，而那一套只在对局中响应。
window.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
  if (event.code === 'KeyM' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    music.toggle();
  }
});

placeMusicDock('menu');
void music.load();

// ============================================================
// 提示气泡
// ============================================================

let toastTimer = 0;
function toast(message: string, isError = false): void {
  el.toast.textContent = message;
  el.toast.className = `toast${isError ? ' error' : ''}`;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.toast.classList.add('hidden'), 2200);
}

/** 极简 HTML 转义：玩家名字是用户输入，直接插进 innerHTML 有注入风险 */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

// ============================================================
// 左侧：羁绊面板
// ============================================================

/** 每个羁绊给一个专属颜色，方便扫视 */
const TRAIT_COLORS = [
  '#6fb6ff', '#ffd75e', '#7fc47f', '#b07fd6', '#ff8a8a',
  '#5cc9c9', '#e0885c', '#f0e28c', '#9aa7c7', '#ff9ad5',
];

/**
 * ★★ 0.3.3：羁绊图标的地址（唯一入口）。
 *
 * 【为什么现在用图片，而不是"纯色方块 + 首字"？】
 * 用户口径：和游戏图标（`favicon.ico`）同一套语言 —— 黑底 + 四角取景框 + 一个大字。
 * 字体渲染（尤其汉字）交给出图脚本（`scripts/gen-trait-relic-icons.ts`），
 * 界面只负责按状态选一张图。
 *
 * ★ 两态：`off` = 未生效（冷灰字）；`on` = 已生效 / 满级（荧光字）。
 *   为什么要分两态：0.3 的配色口径是"荧光只做系统高亮"，二十行全是绿的就等于没有高亮。
 * ★ 不写进 `trait-data.ts`：id 本身就是文件名，多一个字段就多一处会走散的地方。
 */
function traitIconUrl(traitId: string, active: boolean): string {
  return `/assets/traits/${traitId}${active ? '-on' : ''}.png`;
}

function traitColor(traitId: string): string {
  let hash = 0;
  for (let i = 0; i < traitId.length; i++) hash = (hash * 31 + traitId.charCodeAt(i)) >>> 0;
  return TRAIT_COLORS[hash % TRAIT_COLORS.length]!;
}

/**
 * 渲染羁绊面板。
 *
 * 【显示规则 —— 这是玩家做决策最重要的信息】
 *  · 只显示「场上有相关干员」的羁绊，没凑的标签不显示，避免一屏垃圾信息
 *  · 已生效的高亮，满级的用金色
 *  · 数量显示成「当前/下一档需要」，例如 2/4，让玩家知道还差几个
 */
/**
 * ★ 0.1.1：羁绊栏此刻该显示**谁**的羁绊。
 *
 * 自己：还是本地 state（口径一个字没改）；
 * 看别人棋盘：服务器广播的 `prepTeams` 里那一份，走同一个 buildTraitStatus。
 *
 * 【为什么不让界面自己拼一份？】
 * 羁绊的算法必须只有一处 —— 否则"他那边显示 4 剑士、我这边看着是 3"
 * 这种对不上的事迟早会发生，而且极难查（两套代码都"看起来对"）。
 */
function traitStatusesForView(): {
  traits: ReturnType<typeof currentTraits>;
  viewedName: string | null;
} {
  if (viewingPlayerId === null) return { traits: currentTraits(state), viewedName: null };
  const units = prepTeams[viewingPlayerId]?.units ?? [];
  const name = net.room?.players.find((p) => p.id === viewingPlayerId)?.name ?? '对方';
  return { traits: traitsOfPlacements(units), viewedName: name };
}

/**
 * ★ 0.2 MujicaAve：这个羁绊的**生效档位**带不带 fever 机制。
 * （判定读数据表 —— 以后给别的羁绊配 fever 玩法，界面自动跟着有。）
 */
function hasFeverMechanic(traitId: string, activeAt: number | null): boolean {
  if (activeAt === null) return false;
  const def = TRAIT_DEFS[traitId];
  const tier = def?.tiers.find((item) => item.count === activeAt);
  return (tier?.mechanics ?? []).some((mechanic) => mechanic.kind === 'fever');
}

/**
 * 一行"待渲染的 DOM 规格"（配合 `renderKeyed` 用）。
 * key = 身份（同一样东西每次一样）；sig = 外观签名（一样就跳过重建）。
 */
interface DomSpec {
  key: string;
  sig: string;
  build: () => HTMLElement;
}

/**
 * ★★ 0.3 修「羁绊列表抽搐」。
 *
 * 【抽搐是怎么来的】
 * 这一栏以前是 `innerHTML = ''` 全量重建。而 `.trait-row` 的 `:hover` 是
 * `transform: translateX(2px)` 且带 `transition: transform .08s` ——
 * 鼠标停在某一行上时，`renderAll()` 一跑（买牌、花钱、房间广播…）
 * 那一行就被换成新节点，新节点从 0 过渡到 2px ⇒ **整列左右抖一下**。
 * 现在改成按 traitId 就地更新：签名没变的行一个属性都不碰。
 */
function renderTraits(): void {
  /*
    ★ 0.1.1 观战：看别人棋盘时，这一栏显示的是**他**的羁绊。
    （以前只换棋盘不换这一栏，结果"看着他的棋子、读着我的羁绊"。）
  */
  const view = traitStatusesForView();
  const traits = view.traits;
  const specs: DomSpec[] = [];

  if (traits.length === 0) {
    const text = view.viewedName
      ? `${escapeHtml(view.viewedName)} 现在场上还没有干员。`
      : '还没有上场的干员。<br />买了干员放上场，这里就会显示触发的羁绊。';
    specs.push({
      key: '#empty',
      sig: text,
      build: () => {
        const empty = document.createElement('div');
        empty.className = 'trait-empty';
        empty.innerHTML = text;
        return empty;
      },
    });
  } else if (view.viewedName) {
    // 观战时先说清"这一栏是谁的"，免得玩家拿别人的羁绊去凑自己的阵容
    const text = `正在看 ${view.viewedName} 的羁绊`;
    specs.push({
      key: '#note',
      sig: text,
      build: () => {
        const note = document.createElement('div');
        note.className = 'trait-watch-note';
        note.textContent = text;
        return note;
      },
    });
  }

  for (const trait of traits) {
    const def = TRAIT_DEFS[trait.traitId];
    if (!def) continue;

    const isActive = trait.activeAt !== null;
    // 满级 = 已生效且没有下一档
    const isMaxed = isActive && trait.nextAt === null;
    /*
      ★ 0.1.4：「恰好 N 名才生效」的羁绊（领导人），数量**上多了**也是失效。
      这时 activeAt 是 null，但"还差 X 种生效"这种话是错的
      （数量早就够了，是多了）—— 必须单独说清楚，否则玩家完全猜不到原因。
    */
    const soloBlocked = trait.solo !== undefined && !trait.solo.ok;

    // 数量文案：生效时显示「当前/下一档」，没生效时显示「当前/最低档」
    const needForNext = trait.nextAt ?? trait.activeAt ?? def.tiers[0]?.count ?? 1;
    const countClass = isMaxed ? 'maxed' : isActive ? 'active' : 'idle';
    // 上多了的情况不显示 "2/1"（那是个没法理解的比例），只显示当前数量
    const countText = soloBlocked
      ? `${trait.count}<span style="opacity:0.5">/${trait.solo!.exactly}</span>`
      : `${trait.count}<span style="opacity:0.5">/${needForNext}</span>`;
    const descText = soloBlocked
      ? `已失效：必须恰好 ${trait.solo!.exactly} 名才生效（现在 ${trait.count} 名，上多了）`
      : isActive
        ? (trait.activeDesc ?? '已生效')
        : `还差 ${Math.max(1, needForNext - trait.count)} 种生效`;

    /*
      ★★ 0.2 MujicaAve：fever 层数**一直在**这里显示（用户口径 1）。
      【为什么放在羁绊面板这一行，而不是战斗内那栏日志？】
      因为羁绊日志只在战斗里有，而用户要的是"**所有阶段**都能看见"——
      这一栏（左侧羁绊面板）是全程可见的，fever 又是"跨回合的资源"，
      摆在这里才真的"一直看得见"。
      ★ 只有**生效档位**自带 fever 机制时才显示（= 羁绊开着）：
        羁绊关掉之后数值仍然保留（数据在 state.fever 里没动），只是不再显示。
    */
    const showFever = isActive && hasFeverMechanic(trait.traitId, trait.activeAt);
    const feverText = showFever
      ? `fever ${state.fever.total}${state.fever.armedTicks > 0 ? ' · 特殊技能已就绪' : ''}`
      : '';

    /*
      ★ 外观签名：把"会让这一行长不一样"的东西全拼进来。
      没变就整行跳过（连 className 都不写）—— 这才是"不抽搐"的关键。
    */
    const sig = [isMaxed, isActive, countClass, countText, descText, feverText].join('|');
    const traitId = trait.traitId;
    specs.push({
      key: traitId,
      sig,
      build: () => {
        const row = document.createElement('div');
        row.className = `trait-row${isMaxed ? ' maxed' : isActive ? ' active' : ''}`;
        row.innerHTML = `
      <img class="trait-icon" src="${traitIconUrl(traitId, isActive || isMaxed)}" alt="" draggable="false" />
      <div class="trait-info">
        <div class="trait-name">${escapeHtml(def.name)}</div>
        <div class="trait-desc">${escapeHtml(descText)}</div>
      </div>
      <div class="trait-count ${countClass}">${countText}</div>
    `;
        if (feverText) {
          const fever = document.createElement('div');
          fever.className = 'trait-fever';
          fever.textContent = feverText;
          row.querySelector('.trait-info')?.appendChild(fever);
        }
        // 点一下打开详情：看所有档位、实际数值、以及哪些干员带这个标签
        row.title = `点击查看「${def.name}」的详细数据`;
        row.addEventListener('click', () => openTraitDetail(traitId));
        return row;
      },
    });
  }

  /*
    ★ 观战别人时用**不同的命名空间**：两套羁绊是两组不同的行，
    混在同一个缓存里会出现"上一秒还在抖的节点被复用给另一个羁绊"的错乱。
  */
  renderKeyed(el.traitList, specs, {
    key: (spec) => spec.key,
    sig: (spec) => spec.sig,
    build: (spec) => spec.build(),
    ns: view.viewedName ?? '(me)',
  });
}

// ============================================================
// ★ 0.3.4 图鉴 + 组队器
// ============================================================
/*
  【这一块干什么】
    · 图鉴：55 个棋子按**费用**分 5 档、89 件藏品按**用途**分 3 档；
      棋子**不显示具体数值**（用户口径），只给 立绘 / 费用 / 羁绊 / 技能描述。
    · 组队器：左边挑人、右边 15 个栏位，实时显示这 15 个能激活哪些羁绊；
      右下角「提醒购买」打开后，计划里的棋子会在商店卡面上打「计划」角标。

  【★ 为什么所有列表都走 renderKeyed】
    棋子墙有 55 张立绘，`innerHTML = ''` 重建会让图片重新解码、整片闪一下
    （项目踩过三次，见 keyed-list.ts 文件头）。这里每一格都是**独立的一条 spec**，
    sig 只含"影响它外观的那点东西" ⇒ 点一下棋子只重建那一格。

  【★ 组队器外壳为什么是"签名恒定"的一条 spec】
    外壳里那四个容器（#tb-unit-list / #tb-slot-box / #tb-trait-box / #tb-foot-box）
    必须是**稳定节点**，内层 renderKeyed 的复用缓存才挂得住。
    所以外壳 sig 写死常量：建一次之后一直复用，只有切走再切回来时才重建。
*/

type CodexTab = 'units' | 'items' | 'team';

let codexTab: CodexTab = 'units';

const CODEX_TABS: Array<{ id: CodexTab; label: string; sub: string }> = [
  { id: 'units', label: '棋子', sub: '按费用分档 · 只列羁绊与技能，不列数值' },
  { id: 'items', label: '藏品', sub: '按用途分档：羁绊转职 / 穿戴 / 共享' },
  { id: 'team', label: '组队器', sub: '左边挑人放进栏位，右边实时算激活的羁绊' },
];

function openCodex(): void {
  el.codexOverlay.classList.remove('hidden');
  renderCodex();
}

function closeCodex(): void {
  el.codexOverlay.classList.add('hidden');
}

function renderCodex(): void {
  const tab = CODEX_TABS.find((item) => item.id === codexTab) ?? CODEX_TABS[0]!;
  el.codexTitle.textContent = tab.id === 'team' ? '组队器' : '图鉴';
  el.codexSub.textContent = tab.sub;
  renderCodexRail();
  if (codexTab === 'units') renderCodexUnits();
  else if (codexTab === 'items') renderCodexItems();
  else renderTeamBuilder();
}

/** 左侧切换条：三个按钮**只建一次**，之后只改 class（重建会闪） */
function renderCodexRail(): void {
  if (el.codexRail.childElementCount === 0) {
    for (const tab of CODEX_TABS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'codex-rail-btn';
      btn.dataset.tab = tab.id;
      btn.textContent = tab.label;
      btn.addEventListener('click', () => {
        codexTab = tab.id;
        renderCodex();
      });
      el.codexRail.appendChild(btn);
    }
  }
  for (const btn of Array.from(el.codexRail.querySelectorAll<HTMLElement>('.codex-rail-btn'))) {
    btn.classList.toggle('active', btn.dataset.tab === codexTab);
  }
}

// ---- 图鉴：棋子 ----

function renderCodexUnits(): void {
  const groups = codexUnitGroups();
  const specs: DomSpec[] = groups.map((group) => ({
    key: `cost:${group.cost}`,
    sig: `${group.cost}|${group.units.length}`,
    build: () => {
      const box = document.createElement('div');
      box.className = 'codex-group';
      box.innerHTML = `
        <div class="codex-group-head">
          <span class="codex-group-title" style="color:${group.rarityBase}">${group.label} · ${group.rarityLabel}</span>
          <span class="codex-group-count">${group.units.length} 名</span>
        </div>
      `;
      const grid = document.createElement('div');
      grid.className = 'codex-grid';
      for (const def of group.units) grid.appendChild(buildCodexUnitCard(def, group.rarityBase, group.label, group.rarityLabel));
      box.appendChild(grid);
      return box;
    },
  }));
  renderKeyed(el.codexMain, specs, {
    key: (spec) => spec.key,
    sig: (spec) => spec.sig,
    build: (spec) => spec.build(),
    ns: 'codex:units',
  });
  el.codexCount.textContent = `${groups.reduce((n, g) => n + g.units.length, 0)} 名干员`;
}

/**
 * 一张棋子卡。★ **不显示任何具体数值**（生命/攻击/双抗/攻速/射程一个都不列）——
 * 用户口径：图鉴是"查谁有什么羁绊、技能是什么"，不是数值表。
 */
function buildCodexUnitCard(
  def: ReturnType<typeof codexUnits>[number],
  rarityBase: string,
  costLabel: string,
  rarityLabel: string,
): HTMLElement {
  const card = document.createElement('div');
  card.className = 'codex-unit';
  const traitNames = def.traits.map((id) => TRAIT_DEFS[id]?.name ?? id);
  // ★ 卡面只露 5 行技能描述（见 styles.css），完整文案挂在 title 上，鼠标停一下能看全
  card.title = `${def.name}（${costLabel} · ${rarityLabel}）\n${def.skill.name} —— ${def.skill.desc}`;
  card.innerHTML = `
    <img class="codex-unit-portrait" src="${unitPortraitUrl(def.id)}" alt="${escapeHtml(def.name)}" loading="lazy" />
    <div class="codex-unit-body">
      <div class="codex-unit-name">${escapeHtml(def.name)}</div>
      <div class="codex-unit-cost" style="color:${rarityBase}">${costLabel} · ${rarityLabel}</div>
      <div class="codex-unit-traits">${traitNames.map((name) => `<span class="codex-unit-trait">${escapeHtml(name)}</span>`).join('')}</div>
      <div class="codex-unit-skill"><b>${escapeHtml(def.skill.name)}</b> —— ${escapeHtml(def.skill.desc)}</div>
    </div>
  `;
  return card;
}

// ---- 图鉴：藏品 ----

function renderCodexItems(): void {
  const groups = codexItemGroups();
  const specs: DomSpec[] = groups.map((group) => ({
    key: `kind:${group.kind}`,
    sig: `${group.kind}|${group.items.length}`,
    build: () => {
      const box = document.createElement('div');
      box.className = 'codex-group';
      box.innerHTML = `
        <div class="codex-group-head">
          <span class="codex-group-title">${escapeHtml(group.label)}</span>
          <span class="codex-group-count">${group.items.length} 件</span>
          <span class="codex-group-note">${escapeHtml(group.note)}</span>
        </div>
      `;
      const grid = document.createElement('div');
      grid.className = 'codex-grid';
      for (const item of group.items) grid.appendChild(buildCodexItemCard(item));
      box.appendChild(grid);
      return box;
    },
  }));
  renderKeyed(el.codexMain, specs, {
    key: (spec) => spec.key,
    sig: (spec) => spec.sig,
    build: (spec) => spec.build(),
    ns: 'codex:items',
  });
  el.codexCount.textContent = `${groups.reduce((n, g) => n + g.items.length, 0)} 件藏品`;
}

function buildCodexItemCard(item: ReturnType<typeof codexItemGroups>[number]['items'][number]): HTMLElement {
  const card = document.createElement('div');
  card.className = 'codex-item';
  card.innerHTML = `
    <img class="codex-item-icon" src="${itemIconUrl(item.icon)}" alt="${escapeHtml(item.name)}" loading="lazy" />
    <div class="codex-item-body">
      <div class="codex-item-name">${escapeHtml(item.name)}</div>
      <div class="codex-item-desc">${escapeHtml(item.desc)}</div>
    </div>
  `;
  return card;
}

// ---- 组队器 ----

/** 栏位变了之后统一走这里：重画图鉴，并且（开关开着时）让商店角标跟着变 */
function afterTeamPlanChange(): void {
  renderCodex();
  if (teamPlanRemindBuy()) renderShop();
}

function renderTeamBuilder(): void {
  const slots = teamPlanSlots();

  // 外壳：签名恒定 ⇒ 建一次就一直复用，内层四个容器保持"同一个节点"
  renderKeyed(
    el.codexMain,
    [
      {
        key: 'tb-wrap',
        sig: 'tb-wrap',
        build: () => {
          const wrap = document.createElement('div');
          wrap.className = 'tb-wrap';
          wrap.innerHTML = `
            <div class="tb-left">
              <div class="tb-left-head">全部棋子 · 点一下放进栏位</div>
              <div id="tb-unit-list" class="tb-left-list tb-unit-grid"></div>
            </div>
            <div class="tb-right">
              <div class="tb-right-head">阵容栏位 <span id="tb-slot-count"></span></div>
              <div id="tb-slot-box" class="tb-slots"></div>
              <div class="tb-traits-head">激活的羁绊</div>
              <div id="tb-trait-box" class="tb-traits"></div>
              <div id="tb-foot-box" class="tb-foot"></div>
            </div>
          `;
          return wrap;
        },
      },
    ],
    { key: (spec) => spec.key, sig: (spec) => spec.sig, build: (spec) => spec.build(), ns: 'codex:team' },
  );

  const list = el.codexMain.querySelector<HTMLElement>('#tb-unit-list');
  const slotBox = el.codexMain.querySelector<HTMLElement>('#tb-slot-box');
  const traitBox = el.codexMain.querySelector<HTMLElement>('#tb-trait-box');
  const footBox = el.codexMain.querySelector<HTMLElement>('#tb-foot-box');
  const countEl = el.codexMain.querySelector<HTMLElement>('#tb-slot-count');
  if (!list || !slotBox || !traitBox || !footBox) return;

  if (countEl) countEl.textContent = `${teamPlanCount()} / ${TEAM_PLAN_SLOTS}`;
  el.codexCount.textContent = `${teamPlanCount()} / ${TEAM_PLAN_SLOTS} 栏位`;

  // 左：全部棋子，按费用分组。★ 每格 sig 只含"有没有被选中" ⇒ 点一下只重建那一格
  const unitSpecs: DomSpec[] = [];
  for (const group of codexUnitGroups()) {
    unitSpecs.push({
      key: `h:${group.cost}`,
      sig: `h:${group.cost}|${group.units.length}`,
      build: () => {
        const head = document.createElement('div');
        head.className = 'tb-unit-group-head';
        head.innerHTML = `<span style="color:${group.rarityBase}">${group.label}</span><span>${group.units.length} 名</span>`;
        return head;
      },
    });
    for (const def of group.units) {
      const picked = slots.includes(def.id);
      unitSpecs.push({
        key: `u:${def.id}`,
        sig: picked ? 'on' : 'off',
        build: () => {
          const btn = document.createElement('div');
          btn.className = `tb-unit${picked ? ' picked' : ''}`;
          btn.innerHTML = `
            <img src="${unitPortraitUrl(def.id)}" alt="${escapeHtml(def.name)}" loading="lazy" />
            <div class="tb-unit-name">${escapeHtml(def.name)}</div>
          `;
          btn.title = picked
            ? `${def.name}（${def.cost} 费）· 已放进栏位，点一下移出`
            : `${def.name}（${def.cost} 费）· 点一下放进栏位`;
          btn.addEventListener('click', () => {
            /*
              ★ 0.3.4：栏位满 15 个时**必须说话**。
              `toggleTeamPlanUnit()` 满员是静默放弃的（它只管"塞进第一个空位"），
              界面这边若不补一句，玩家点第 16 个人会觉得"点不动 / 坏了"。
              判据用"点之前不在计划里、点之后还不在" —— 只有这一种情况是"没放进去"。
            */
            const wasPlanned = isPlanned(def.id);
            toggleTeamPlanUnit(def.id);
            if (!wasPlanned && !isPlanned(def.id)) {
              toast(`${TEAM_PLAN_SLOTS} 个栏位已满 —— 先点掉一个再放`, true);
            }
            afterTeamPlanChange();
          });
          return btn;
        },
      });
    }
  }
  renderKeyed(list, unitSpecs, {
    key: (spec) => spec.key,
    sig: (spec) => spec.sig,
    build: (spec) => spec.build(),
    ns: 'tb:units',
  });

  // 右：15 个栏位（点已填的格子 = 移出）
  renderKeyed(
    slotBox,
    Array.from({ length: TEAM_PLAN_SLOTS }, (_, i) => ({
      key: `slot:${i}`,
      sig: slots[i] ?? '',
      build: () => {
        const defId = slots[i];
        const def = defId ? UNIT_DEFS[defId] : undefined;
        const cell = document.createElement('div');
        cell.className = `tb-slot${def ? ' filled' : ''}`;
        cell.innerHTML = def
          ? `<span class="tb-slot-index">${i + 1}</span><img src="${unitPortraitUrl(def.id)}" alt="${escapeHtml(def.name)}" loading="lazy" /><div class="tb-slot-name">${escapeHtml(def.name)}</div>`
          : `<span class="tb-slot-index">${i + 1}</span>`;
        cell.title = def ? `${def.name} · 点一下移出` : `空栏位 ${i + 1}`;
        cell.addEventListener('click', () => {
          clearTeamPlanSlot(i);
          afterTeamPlanChange();
        });
        return cell;
      },
    })),
    { key: (spec) => spec.key, sig: (spec) => spec.sig, build: (spec) => spec.build(), ns: 'tb:slots' },
  );

  // 右：激活的羁绊 —— 数据来自 buildTraitStatus()，和左侧羁绊面板同一份口径
  const rows = planTraitRows();
  const traitSpecs: DomSpec[] =
    rows.length === 0
      ? [
          {
            key: '#empty',
            sig: 'empty',
            build: () => {
              const empty = document.createElement('div');
              empty.className = 'tb-traits-empty';
              empty.textContent = '左边挑人放进栏位，这里会实时显示能激活的羁绊。';
              return empty;
            },
          },
        ]
      : rows.map((row) => {
          const isActive = row.activeAt !== null;
          const solo = row.solo;
          const soloBlocked = !!solo && !solo.ok;
          const need = row.nextAt ?? row.activeAt ?? 1;
          const desc =
            soloBlocked && solo
              ? `已失效：必须恰好 ${solo.exactly} 名才生效（现在 ${row.count} 名，上多了）`
              : isActive
                ? (row.activeDesc ?? '已生效')
                : `还差 ${Math.max(1, need - row.count)} 种生效`;
          return {
            key: row.traitId,
            sig: [row.traitId, row.count, row.activeAt, row.nextAt, desc].join('|'),
            build: () => {
              const line = document.createElement('div');
              line.className = `tb-trait-row${isActive ? ' active' : ''}`;
              line.innerHTML = `
                <img class="trait-icon" src="${traitIconUrl(row.traitId, isActive)}" alt="" draggable="false" />
                <span class="tb-trait-name">${escapeHtml(row.name)}</span>
                <span class="tb-trait-desc">${escapeHtml(desc)}</span>
                <span class="tb-trait-count">${row.count}<span style="opacity:0.5">/${need}</span></span>
              `;
              return line;
            },
          };
        });
  renderKeyed(traitBox, traitSpecs, {
    key: (spec) => spec.key,
    sig: (spec) => spec.sig,
    build: (spec) => spec.build(),
    ns: 'tb:traits',
  });

  // 右下：说明 + 「提醒购买」开关
  const remindOn = teamPlanRemindBuy();
  renderKeyed(
    footBox,
    [
      {
        key: 'note',
        sig: 'note',
        build: () => {
          const note = document.createElement('div');
          note.className = 'tb-note';
          note.innerHTML =
            '栏位是<strong>规划用</strong>的，不会真的上场。' +
            '实际人口上限 = 等级 + 藏品加成（<strong>最多 14</strong>），第 15 格在满配时放不上去。';
          return note;
        },
      },
      {
        key: 'toggle',
        sig: remindOn ? 'on' : 'off',
        build: () => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = `tb-toggle${remindOn ? ' on' : ''}`;
          btn.title = '打开后，计划里的棋子会在商店卡面上打「计划」角标';
          btn.innerHTML = '<span class="tb-switch"></span><span>提醒购买</span>';
          btn.addEventListener('click', () => {
            setTeamPlanRemindBuy(!remindOn);
            // ★ 关掉时也要重画商店：角标得立刻消失
            renderCodex();
            renderShop();
          });
          return btn;
        },
      },
    ],
    { key: (spec) => spec.key, sig: (spec) => spec.sig, build: (spec) => spec.build(), ns: 'tb:foot' },
  );
}

// ============================================================
// 底部：商店
// ============================================================
/**
 * ★★ 0.3 修「买牌卡顿 + 卡面抽搐」。
 *
 * 【抽搐的机制】（和羁绊列表是同一个根因，见 `renderTraits`）
 * `.shop-slot` 的 `:hover` 是 `translateY(-3px)`、带 `transition: transform .1s`。
 * 以前这里是 `innerHTML = ''` 全量重建：鼠标正悬在卡上点一下买牌 ->
 * 5 张卡全被换成新节点 -> 每张都从 0 过渡到 -3px
 * ⇒ **整排卡片"掉下去又弹回来"**，看起来就是抽搐。
 * 顺带还有两个代价：`<img>` 重建要重新解码（立绘闪白）、
 * `#shop-slots` 的横向滚动位置被清零。
 *
 * 现在改成按格子下标就地更新：外观签名没变的格子**一个属性都不碰**。
 * 买走一格只会重建那一格，其余 4 张连 class 都不写。
 */
function renderShop(): void {
  const econ = state.economy;
  const specs: DomSpec[] = [];

  for (let i = 0; i < econ.shop.length; i++) {
    const slot = econ.shop[i]!;
    const def = UNIT_DEFS[slot.defId];

    // 已经买走的格子：显示成空格子
    if (slot.sold || !def) {
      specs.push({
        key: `shop:${i}`,
        sig: 'empty',
        build: () => {
          const empty = document.createElement('div');
          empty.className = 'shop-slot empty';
          return empty;
        },
      });
      continue;
    }

    /*
      ★ 0.1.1 藏品二版：价格可能被藏品改（«剑锤» 装载后 +2）。
      显示价走 `shopPriceOf`，和 `buyShopSlot` 扣钱用的是同一个来源 ——
      两处各写一遍 `def.cost + delta` 一定会走散（显示 3 金、扣 5 金那种）。
    */
    const price = shopPriceOf(state, def);
    const priceDelta = price - def.cost;
    const affordable = econ.gold >= price;
    // 稀有度：按费用决定边框/发光颜色（1白 2绿 3蓝 4紫 5金）
    const rarity = rarityOfCost(def.cost);
    /*
      ★ 彩蛋棋子（维维美·绝对主角）：卡面和边框走"炫彩"（浅蓝 ↔ 淡紫渐变），
      不用稀有度配色 —— 它是 20 费，稀有度表里根本没有这一档。
      样式在 styles.css 的 `.shop-slot.egg`（用渐变描边实现）。
    */
    const isEgg = def.noStar === true;
    /*
      ★★ 0.3.1：这一格是不是**盟约「特殊刷新」换出来的**（猎头顾问 / 博学多通）。
      用户要求"让人一眼看得出哪几张是特殊刷新给的"，所以卡面加一圈金边 + 角标。
      判据只有一处（`state.covenant.specialSlots`），每次刷新都会重算。
    */
    const isSpecial = state.covenant.specialSlots.includes(i);

    // 有没有真实立绘？有就显示图，没有就显示占位斜纹
    let portraitSrc: string | null = getLoadedImage(unitSpritePath(def.id))?.src ?? null;
    /*
      ★ 彩蛋棋子（以及野怪）没有独立的立绘图 —— 用它的 Q 版小人**序列帧第一帧**当立绘，
      和备战席那套兜底是同一个思路。加载是异步的，所以回调里重画一次商店。
      第二次进这个函数时 chibiPortraitUrl 已经有缓存，会直接返回，不会无限递归。
    */
    if (!portraitSrc && (def.monsterOnly || def.noStar)) {
      portraitSrc = chibiPortraitUrl(def, () => renderShop());
    }

    /*
      升星提示：这张卡买下去会不会马上合成？
      规则：我现在持有这个干员的同星级数量 >= 2，再买一个就凑够 3 个。
      「持有」= 备战席 + 场上（和合成规则一致，不然提示会骗人）。
      这是自走棋里最有用的一条提示 —— 它告诉你"这张卡现在买就是升级"。
    */
    const owned = countOwned(state, def.id, 1);
    // ★ 彩蛋棋子没有星级机制：三张不合一，所以不存在"再买一个就升星"这回事
    const willMerge = !isEgg && owned >= 2;
    // 还差几个才能合（差 2 个表示一个都没有，没必要提示）
    const missing = 3 - owned;

    /*
      ★ 0.0.3 需求 2：卡面右上角提示"目前拥有相同干员几张"。
      ★★ 用户复议后改成**按张数折算**：2 星算 3 张、3 星算 9 张（= 合成这只吃了多少张）。
      和上面那条 `owned`（只数 1 星的**个数**）是两个不同的数，别合并：
        · `owned`（1 星个数）   -> "再买一个是不是立刻合成"，升星提示的依据
        · `heldTotal`（按张折算）-> "我到底攒了几张这个干员"，玩家一眼要看的那个数
      它和卡片右下角的「牌库还剩 M 张」正好互补：N + M = 这只棋子的总张数。
    */
    const heldTotal = countOwnedCopies(state, def.id);

    // 牌库还剩几张（联机时是全房间共享的剩余量）
    const remaining = poolRemainingOf(state, def.id);
    const soldOut = remaining <= 0;

    /*
      ★ 外观签名：**所有会影响这张卡长相的输入**都要拼进来，少一个就会出现
      "数据变了但卡面不更新"（比抽搐严重得多）。
      特别注意 `portraitSrc` —— 野怪的 Q 版立绘、彩蛋的序列帧是**异步**加载的，
      加载完必须靠签名变化触发这一格重建。
    */
    const sig = [
      def.id,
      price,
      priceDelta,
      affordable ? 'a' : 'na',
      willMerge ? 'm' : '',
      owned,
      missing,
      heldTotal,
      remaining,
      soldOut ? 'so' : '',
      isEgg ? 'egg' : '',
      isSpecial ? 'sp' : '',
      portraitSrc ? 'img' : 'noimg',
      // ★ 0.3.4：组队器「提醒购买」打开后这张卡要打角标 —— 不进 sig 的话
      //   plan 变了卡片不会重画（项目踩过：少一个输入就出现"数据变了但卡面不更新"）
      remindBuyMarkOf(def.id) ? 'plan' : '',
    ].join('|');

    specs.push({
      key: `shop:${i}`,
      sig,
      build: () => {
    const card = document.createElement('div');
    card.className = `shop-slot${affordable ? '' : ' unaffordable'}`;
    /*
      稀有度配色通过内联样式上（因为颜色是数据驱动的，见 shared/rarity.ts）。

      ⚠️ 这里踩过一个坑：边框曾经只有 2px，在深色卡片底上几乎看不见，
      用户反馈「稀有度颜色没实现」。现在 CSS 里把边框加粗到 3px。

      另外要注意：**不要在 hover 时改 borderColor** ——
      内联样式会被 CSS 的 :hover 规则盖掉，颜色就丢了。
      所以悬停效果改用 filter: brightness() 来做（见样式表）。
    */
    if (isEgg) {
      /*
        炫彩边框由 CSS 提供（见 styles.css 的 `.shop-slot.egg`：两层 background
        做渐变描边）。内联的稀有度色必须清成 transparent —— 内联样式优先级更高，
        留着它会盖住 CSS 的渐变。
      */
      card.style.borderColor = 'transparent';
      card.style.boxShadow = '0 0 16px rgba(143, 212, 255, 0.55), 0 0 30px rgba(201, 176, 255, 0.35)';
    } else {
      card.style.borderColor = rarity.base;
      card.style.boxShadow = `inset 0 0 20px ${rarity.wash}`;
    }
    card.className = `shop-slot${affordable ? '' : ' unaffordable'}${willMerge ? ' can-upgrade' : ''}${soldOut ? ' sold-out' : ''}${isEgg ? ' egg' : ''}${isSpecial ? ' special' : ''}`;
    card.innerHTML = `
      ${isSpecial ? '<div class="shop-special-badge" title="盟约「特殊刷新」换出来的棋子">特殊</div>' : ''}
      <div class="shop-cost-badge${isEgg ? ' egg' : ''}${priceDelta !== 0 ? ' modified' : ''}"${
        isEgg ? '' : ` style="background:${rarity.base}"`
      } title="${
        priceDelta !== 0
          ? `${escapeHtml(def.name)}：面板价 ${def.cost} 费，藏品让花费 ${priceDelta > 0 ? '+' : ''}${priceDelta}`
          : `${escapeHtml(def.name)}：${def.cost} 费`
      }">${price}${priceDelta !== 0 ? `<span class="shop-cost-delta">${priceDelta > 0 ? '+' : ''}${priceDelta}</span>` : ''}</div>
      <div class="shop-portrait-box${portraitSrc ? ' has-image' : ''}${isEgg ? ' egg' : ''}"${
        // ★ 彩蛋的立绘底由 CSS 的 `.shop-portrait-box.egg` 给渐变 ——
        //   这里绝不能写内联 background，shorthand 会把 CSS 的 background-image 覆盖成 none
        isEgg ? '' : ` style="background:${def.color}22"`
      }>
        ${
          portraitSrc
            ? `<img class="shop-portrait-img" src="${portraitSrc}" alt="${escapeHtml(def.name)}" />`
            : ''
        }
      </div>
      <div class="shop-slot-text">
        <div class="shop-slot-name">${escapeHtml(def.name)}</div>
        <div class="shop-slot-traits">${
          isEgg
            ? '无羁绊 · 彩蛋'
            : def.traits.map((t) => TRAIT_DEFS[t]?.name ?? t).join(' · ')
        }</div>
      </div>
      ${
        heldTotal > 0
          ? `<div class="shop-owned-badge" title="已拥有 ${heldTotal} 张 ${escapeHtml(def.name)}（备战席 + 场上；2 星算 3 张、3 星算 9 张）">已拥有 ${heldTotal}</div>`
          : ''
      }
      ${
        // ★ 彩蛋没有星级机制：不显示"可升星 / 差几个合成"那套提示
        isEgg
          ? ''
          : willMerge
            ? `<div class="upgrade-badge" title="买下就凑够 3 个，直接合成 2 星">可升星</div>`
            : owned > 0
              ? `<div class="upgrade-hint" title="已有 ${owned} 个，再买 ${missing} 个就能合成">${owned}/3</div>`
              : ''
      }
      ${
        // ★ 0.3.4：组队器「提醒购买」—— 计划里的棋子在卡面上打「计划」角标。
        //   位置在左下（右上被「已拥有/可升星」占了，右下是牌库剩余，左边 3px 是稀有度色条）。
        remindBuyMarkOf(def.id)
          ? '<div class="shop-plan-badge" title="组队器计划里的棋子：打开「提醒购买」才会显示">计划</div>'
          : ''
      }
      <div class="pool-left" title="牌库里还剩 ${remaining} 张（所有人共享）">${remaining}</div>
      <div class="shop-slot-rarity" style="background:${isEgg ? 'linear-gradient(90deg, #8fd4ff, #c9b0ff)' : rarity.base}"></div>
    `;
    card.title =
      `${def.name}（${def.cost} 费 · ${isEgg ? '彩蛋' : rarity.label}）\n` +
      `生命 ${def.base.hp} · 攻击 ${def.base.attackDamage} · 攻速 ${def.base.attackSpeed} · 射程 ${def.base.range}\n` +
      `技能：${def.skill.name} —— ${def.skill.desc}` +
      (isEgg
        ? '\n\n★ 彩蛋棋子：没有星级机制（三张不合一），可以正常佩戴装备'
        : willMerge
          ? '\n\n★ 你已有 2 个，买下立刻合成 2 星！'
          : owned > 0
            ? `\n\n你已有 ${owned} 个（再买 ${missing} 个合成 2 星）`
            : '');
    card.addEventListener('click', () => {
      requestBuy(i);
    });
        return card;
      },
    });
  }

  renderKeyed(el.shopSlots, specs, {
    key: (spec) => spec.key,
    sig: (spec) => spec.sig,
    build: (spec) => spec.build(),
  });

  el.shopOdds.textContent = shopOddsText(econ.level);
}

/**
 * 请求买下商店的第 i 格。
 *
 * 【单机和联机走的是两条路，但结果一样】
 *   单机：本地直接买（牌库就是自己手上占的牌）
 *   联机：先问服务器"这张牌还有没有货"，服务器回了 ok 才真正收下。
 *         因为牌库是全房间共享的，不这样的话三个人能同时买到同一张牌的最后一张。
 *
 * 【为什么把"买了哪一格"记在 pendingBuySlot？】
 * 因为服务器的回执里只有 defId，没有"商店第几格"。
 * 等回执回来的时候玩家可能已经刷新过商店了，所以要把格子号记下来，
 * 并在回执到达时确认"那一格还是原来那张牌"。
 */
let pendingBuySlot: number | null = null;

/**
 * ============================================================
 *  ★ 商店"预定"：让服务器知道我的商店里现在摆着哪些牌
 * ============================================================
 *
 * 【为什么要上报？】（你报的第 11 条）
 * 牌库里只剩 1 张的棋子，如果同时挂在两个人的商店里，
 * 就只有先点的那个买得到，另一个人点下去只会报错 —— 看起来就像游戏坏了。
 * 报上去之后服务器把这几张标成"被我占着"，别人刷新时就不会再抽到；
 * 我一刷新（或者买走）会再报一次，牌就放回池子。
 *
 * 【为什么放在 renderAll 里"顺手"同步，而不是每个调用点各写一次？】
 * 改商店的地方有五六个（花钱刷新、回合自动刷新、买走、开发调试、
 * 联机回执……），每个都记得上报一次太容易漏 —— 漏掉的那条路径就是
 * "这几张牌卡在别人那儿刷不出来"的玄学 bug。
 * 这里用一个签名做去重：商店内容没变就什么都不发（不会刷屏，也不会死循环）。
 */
let lastShopHeldSignature: string | null = null;

function syncShopHeld(): void {
  if (!netplayActive) return;
  const defIds = state.economy.shop.filter((slot) => !slot.sold && slot.defId).map((slot) => slot.defId);
  const signature = defIds.join(',');
  if (signature === lastShopHeldSignature) return;
  lastShopHeldSignature = signature;
  net.shopUpdate(defIds);
}

function requestBuy(slotIndex: number): void {
  const slot = state.economy.shop[slotIndex];
  if (!slot) return;

  if (!netplayActive) {
    const result = doBuyShopSlot(state, slotIndex);
    toast(result.message, !result.ok);
    renderAll();
    return;
  }
  pendingBuySlot = slotIndex;
  if (!net.buyCard(slot.defId)) {
    pendingBuySlot = null;
    toast('没连上服务器，买不了', true);
  }
}

// ============================================================
// 底部：备战席
// ============================================================

/**
 * ★ 0.0.3：备战席卡面上的两个藏品小圆点（绿 = 已装备，灰 = 空位）。
 *
 * 【为什么备战席也要画？】
 * 棋子在场上的时候，圆点画在血条左边（见 sprite-graphics 的藏品圆点）。
 * 但备战席是纯 DOM 卡面、没有血条 —— 如果不在这儿也给个提示，
 * "这个棋子身上有没有装备"就得把每个棋子拖上场才看得出来，
 * 而装载/卸下装备正是布阵时做的事。
 *
 * 颜色直接取 `ITEM_DOT_COLORS`（和 3D 那两只是**同一组常量**）——
 * 两处各写一个十六进制色值，改了一处忘了另一处就会"场上绿、席上青"。
 */
function benchItemDotsHtml(unit: { items?: string[] }): string {
  const worn = Math.min(ITEM_PER_UNIT, unit.items?.length ?? 0);
  let html = `<div class="bench-item-dots" title="已装备 ${worn}/${ITEM_PER_UNIT}（绿 = 有，灰 = 空）">`;
  for (let i = 0; i < ITEM_PER_UNIT; i++) {
    const color = i < worn ? ITEM_DOT_COLORS.on : ITEM_DOT_COLORS.off;
    html += `<span class="bench-item-dot" style="background:${color}"></span>`;
  }
  html += '</div>';
  return html;
}

/**
 * ============================================================
 * ★ 0.1.1：备战席棋子的悬停卡片
 * ============================================================
 *
 * 【只显示五样，一个字都不多】：名字 · 星级 · 羁绊 · 技能 · 射程。
 * （这是用户指定的内容清单 —— 别顺手把费用、藏品、操作提示塞回来，
 *   那些在格子本身上已经有了：描边颜色=费用档、圆点=藏品、title≈操作提示。）
 *
 * 【为什么不直接用浏览器自带的 title？】
 *   · 排版完全不可控：换行只能靠 `\n`，字号/颜色/分区都改不了；
 *   · 出现和消失的时机由浏览器决定（悬停多久才弹、什么时候收），
 *     玩家移动鼠标时会忽闪；
 *   · 内容一多就变成一条又长又窄的灰字，很难扫。
 * 所以自己做一个：位置可控、能分区块、样式跟着游戏走。
 *
 * 【位置怎么定？】备战席在屏幕底部，所以卡片默认摆在格子**正上方**；
 * 上面空间不够（比如窗口很矮）就翻到下方，并且左右夹在视口内。
 */
function showBenchTip(defId: string, star: number, anchor: HTMLElement): void {
  const def = UNIT_DEFS[defId];
  if (!def) return;
  const rarity = rarityOfCost(def.cost);

  /*
    羁绊：显示这个干员**自己带的**标签，以及它们**当前在这套阵容里的进度**。
    （进度用 currentTraits —— 和右侧羁绊面板同一个算法，口径不会分叉。）
  */
  const statuses = currentTraits(state);
  const chips = def.traits
    .map((traitId) => {
      const traitDef = TRAIT_DEFS[traitId];
      const status = statuses.find((t) => t.traitId === traitId);
      const active = Boolean(status && status.activeAt !== null);
      const progress =
        status === undefined || status.count === 0
          ? '未上场'
          : status.activeAt !== null
            ? `${status.activeAt} 档生效`
            : // ★ 0.1.4：数量够了但"上多了"（领导人要求恰好 1 名）—— 别写成 "2/1"
              status.solo && !status.solo.ok
              ? `已失效（须恰好 ${status.solo.exactly} 名）`
              : status.nextAt !== null
                ? `${status.count}/${status.nextAt}`
                : `${status.count} 个`;
      return (
        `<span class="bench-tip-chip${active ? ' bench-tip-chip-active' : ''}"` +
        ` style="border-left-color:${traitColor(traitId)}">` +
        `<span>${escapeHtml(traitDef?.name ?? traitId)}</span>` +
        `<span class="bench-tip-chip-progress">${progress}</span>` +
        `</span>`
      );
    })
    .join('');

  // 技能按**当前星级**那一套显示（3 星会换技能，这个细节不能漏）
  const variant = skillVariantOf(def, star);
  const starText = def.monsterOnly ? '野怪（无星级）' : def.noStar ? '无星级' : `${star} 星`;
  const stars = def.monsterOnly || def.noStar ? '' : '★'.repeat(star);

  el.benchTip.innerHTML =
    `<div class="bench-tip-head">` +
    `<span class="bench-tip-avatar" style="background:${rarity.base}">${escapeHtml(def.name.slice(0, 1))}</span>` +
    `<span class="bench-tip-name">${escapeHtml(def.name)}</span>` +
    `<span class="bench-tip-stars">${stars}</span>` +
    `</div>` +
    `<div class="bench-tip-sub">${starText} · 射程 ${def.base.range}</div>` +
    `<div class="bench-tip-sec">羁绊</div>` +
    `<div class="bench-tip-chips">${chips || '<span class="result-empty">没有羁绊</span>'}</div>` +
    `<div class="bench-tip-sec">技能</div>` +
    `<div class="bench-tip-skill-name">${escapeHtml(variant.name)}</div>` +
    `<div class="bench-tip-skill-desc">${escapeHtml(variant.desc)}</div>`;

  el.benchTip.classList.remove('hidden');

  const rect = anchor.getBoundingClientRect();
  const tipRect = el.benchTip.getBoundingClientRect();
  const margin = 8;
  let left = rect.left + rect.width / 2 - tipRect.width / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - tipRect.width - margin));
  /*
    ★★ 0.3 修：卡片"盖住备战席本身"。
    以前上面放不下就翻到**格子下面**（`rect.bottom + margin`）——
    备战席本来贴着屏幕底边，翻下去等于直接盖在格子上，
    鼠标悬停的那一格被自己弹的卡片压住，看起来像"卡片糊了"。
    现在改成**贴顶显示**（永不翻到下面），并且样式表给 `#bench-tip`
    加了 `max-height` + 内部滚动，保证它不会高到放不进上方那块空间。
  */
  let top = rect.top - tipRect.height - margin;
  if (top < margin) top = margin;
  el.benchTip.style.left = `${Math.round(left)}px`;
  el.benchTip.style.top = `${Math.round(top)}px`;
}

/** 收起悬停卡片（鼠标移开、重画备战席、开始拖动时都要调） */
function hideBenchTip(): void {
  el.benchTip.classList.add('hidden');
}

function renderBench(): void {
  /*
    ============================================================
    ★ 0.1.1 观战：看别人棋盘时，这一栏显示的是**他**的备战席
    ============================================================
    【为什么复用同一块面板，而不是另开一个"观战专用"的列表？】
    因为玩家眼睛已经知道"备战席就在右下角"了。换个地方显示，他就得重新找。
    代价是这里必须**彻底只读**：不挂任何拖动/点击处理器，
    也不写 `data-bench-index`（那个属性是拖动落点判定的依据 ——
    写了就能把自己的棋子丢进"别人的备战席格子"里）。
  */
  const watching = viewingPlayerId !== null;
  const watchName = watching
    ? (net.room?.players.find((p) => p.id === viewingPlayerId)?.name ?? '对方')
    : null;
  const bench: Array<{ uid: number; defId: string; star: number; items?: string[] }> = watching
    ? (prepTeams[viewingPlayerId!]?.bench ?? []).map((b) => ({ uid: -1, defId: b.defId, star: b.star }))
    : state.economy.bench;

  if (el.benchTitle) el.benchTitle.textContent = watching ? `${watchName} 的备战席` : '备战席';
  if (el.benchHint) {
    el.benchHint.textContent = watching ? '观战中 · 只能看，不能操作' : '拖到场上 · 可换位 · 右键卖掉';
  }

  /*
    ★★ 0.3：改成按格子下标就地更新（和 `renderShop` 同一个理由）。
    `.bench-slot` 的 `:hover` 也是 `translateY(-2px)` + transition ——
    全量重建会让鼠标下那一格"掉下去再弹回来"。
    顺手也省掉"重建 9 张卡的 `<img>`"和"滚动位置被清零"。
  */
  const specs: DomSpec[] = [];

  for (let i = 0; i < BENCH_SLOTS; i++) {
    const unit = bench[i];

    if (!unit) {
      specs.push({
        key: `bench:${i}`,
        sig: `empty|${watching ? 'w' : ''}`,
        build: () => {
          const cellEl = document.createElement('div');
          /*
            ★ 每一格都写上下标。
            【为什么？】拖动结束时是用 document.elementFromPoint 反查"鼠标下面是哪一格"的
            （见 benchSlotIndexAt）。没有这个属性就没法把 DOM 和状态里的下标对上，
            空格子也没法当落点 —— 而"拖到空格子"正是自由换位最需要的一步。
            ★ 观战时**不写**（见上面的说明）。
          */
          if (!watching) cellEl.dataset.benchIndex = String(i);
          cellEl.className = 'bench-slot empty';
          return cellEl;
        },
      });
      continue;
    }

    const def = UNIT_DEFS[unit.defId];
    const selected = state.selectedBenchUid === unit.uid;

    /*
      备战席卡面：
        · 普通干员 -> 真立绘（units/<id>.png，和商店同一张）
        · ★ 0.0.3 野怪没有独立立绘，用**小人序列帧的第一帧**当立绘
          （你要求的"备战席卡面使用小人模型立绘"）。
          chibiPortraitUrl 第一次调用会异步加载，加载完在回调里重画一次备战席。
    */
    const loadedPortrait = def ? getLoadedImage(unitSpritePath(def.id)) : null;
    let portraitSrc: string | null = loadedPortrait?.src ?? null;
    if (def && !portraitSrc && (def.monsterOnly || def.noStar)) {
      portraitSrc = chibiPortraitUrl(def, () => renderBench());
    }

    /*
      备战席也用稀有度配色（和商店卡片一致）——
      这样你在备战席扫一眼就知道手上这些干员分别值几费。

      用 outline 而不是 border：outline 不占布局空间、也不会被 overflow 裁掉，
      所以加不加都行，格子尺寸永远稳定。
    */
    const rarity = def ? rarityOfCost(def.cost) : null;

    /*
      ★ 外观签名：`uid` 一定要在里面 —— 合成之后这一格会换成一枚新棋子，
      复用旧节点会让挂在上面的点击/拖动/右键处理器**指向已经不存在的那枚棋子**
      （表现是"点它没反应 / 卖错了别的"）。
    */
    const sig = [
      unit.uid,
      unit.defId,
      unit.star,
      selected ? 'sel' : '',
      watching ? 'w' : '',
      unit.items?.length ?? 0,
      portraitSrc ? 'img' : 'noimg',
    ].join('|');

    specs.push({
      key: `bench:${i}`,
      sig,
      build: () => {
    const cellEl = document.createElement('div');
    cellEl.className = `bench-slot${selected ? ' selected' : ''}`;
    // ★ 0.1.1：观战时的只读标记（样式上压暗一档，让"点不动"一眼可见）
    if (watching) cellEl.classList.add('watching');
    // 三星时用 data-star 触发样式表里的金色底衬（见 .bench-slot[data-star='3']）
    cellEl.dataset.star = String(unit.star);
    if (!watching) cellEl.dataset.benchIndex = String(i);

    if (rarity) {
      if (def?.noStar) {
        // ★ 彩蛋：备战席的描边也走浅蓝紫（和商店卡、3D 卡面同一套色）
        cellEl.style.outlineColor = '#8fd4ff';
        cellEl.style.boxShadow = 'inset 0 0 14px rgba(201, 176, 255, 0.45)';
      } else {
        cellEl.style.outlineColor = rarity.base;
        cellEl.style.boxShadow = `inset 0 0 14px ${rarity.wash}`;
      }
    }

    cellEl.innerHTML = `
      <div class="bench-portrait-box${portraitSrc ? ' has-image' : ''}" style="background:${def?.color ?? '#888'}22">
        ${portraitSrc ? `<img class="bench-portrait-img" src="${portraitSrc}" alt="${escapeHtml(def?.name ?? '')}" />` : ''}
      </div>
      ${rarity ? `<div class="bench-rarity-dot" style="background:${rarity.base}"></div>` : ''}
      <!-- 野怪不能穿戴装备 —— 不画那两个圆点（画了会让人以为还能给它装） -->
      ${def?.monsterOnly ? '' : benchItemDotsHtml(unit)}
      <div class="bench-name">${escapeHtml(def?.name ?? unit.defId)}</div>
      <!--
        星级单独占一条纯色底衬。
        【为什么不像以前那样把星星叠在名字上？】
        因为备战席的头像是真立绘（浅色背景也有），金色的星星直接压在
        立绘或名字上完全看不清 —— 用户反馈"星级看不清楚"就是这个原因。
        现在给它一条**深色实心条**，星星画在条上，对比度就永远够了。
        星星数量本身也写进 title，鼠标悬停能看到文字版。
      -->
      ${
        def?.monsterOnly
          ? '<div class="bench-star-strip" title="野怪没有星级"><span class="bench-star-text">野怪</span></div>'
          : def?.noStar
            ? '<div class="bench-star-strip egg" title="彩蛋棋子没有星级机制"><span class="bench-star-text">彩蛋</span></div>'
            : `<div class="bench-star-strip" title="${unit.star} 星"><span class="bench-star-text">${'★'.repeat(unit.star)}</span></div>`
      }
    `;
    /*
      ============================================================
      ★ 0.1.1：鼠标悬停 -> 弹自定义卡片（名字 / 星级 / 羁绊 / 技能 / 射程）
      （原来这里那句 `const worn = unit.items?.length` 只喂给 title，现在没用了）
      ============================================================
      【原来的 `cellEl.title` 为什么删掉了？】
      因为它会和自定义卡片**同时出现**（原生 tooltip 只是慢一拍），
      屏幕上会叠两层一样的信息 —— 用户要的是"悬停只显示那五样"。
      操作提示（拖到场上 / 换位 / 右键卖掉）本来就在备战席标题旁边写着，
      放到悬停卡片里反而挤掉了真正要看的数据。

      【观战时也挂】这张卡是纯只读的信息展示，看一眼别人的干员没坏处。
    */
    cellEl.addEventListener('pointerenter', () => showBenchTip(unit.defId, unit.star, cellEl));
    cellEl.addEventListener('pointerleave', hideBenchTip);

    // ★ 0.1.1：观战时一格处理器都不挂 —— 点了/拖了都不能动到别人的东西
    if (!watching) {
      cellEl.addEventListener('click', () => {
        selectBench(state, unit.uid);
        renderAll();
      });

      // ---- 拖动起点：按住备战席棋子可以直接拖到场上 ----
      cellEl.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        // 不调用 preventDefault，保留 click 事件 —— 轻点仍然是「选中」，
        // 拖动才是「放置」。两种操作共存，玩家不用记。
        beginDrag({ kind: 'bench', uid: unit.uid }, event, cellEl);
        // 在备战席元素上捕获，鼠标移到画布上也能继续收到 move 事件
        cellEl.setPointerCapture(event.pointerId);
      });

      cellEl.addEventListener('pointermove', (event) => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        if (!drag.moved) {
          const dx = event.clientX - drag.startX;
          const dy = event.clientY - drag.startY;
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
          drag.moved = true;
        }
        moveDragGhost(event.clientX, event.clientY);
        updateDragTarget(event.clientX, event.clientY);
      });

      cellEl.addEventListener('pointerup', (event) => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        if (cellEl.hasPointerCapture(event.pointerId)) {
          cellEl.releasePointerCapture(event.pointerId);
        }
        endDrag(event.clientX, event.clientY);
      });

      cellEl.addEventListener('pointercancel', () => cancelDrag());

      /*
        右键卖掉：备战席满了的时候很需要。

        ★ 但只认"干净的右键单击" —— 按住右键拖着画手势（浏览器鼠标手势）时不做任何事。
        手势的松手点经常已经落在别的棋子上，以前会误卖，见 takePlainRightClick()。
      */
      cellEl.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        if (!takePlainRightClick()) return;
        /*
          ★ 0.3.2 用户口径：阿米娅升变后的形态**不能出售**（测试模式例外）。
          ★★ 这一判必须放在 `net.sellCard` **之前**：
             联机那一步是"把牌还回共享牌库"，先发出去再被本地拒绝，
             就成了"棋子还在手上、牌却已经回到池子里" —— 凭空多出几张牌。
        */
        if (!state.testMode && isSellLockedDefId(unit.defId)) {
          toast(`${UNIT_DEFS[unit.defId]?.name ?? unit.defId} 是升变形态，不能出售`, true);
          return;
        }
        // 联机时要把牌还给共享牌库（不还的话牌库会越来越少，最后谁都抽不到牌）
        // ★ 0.0.3：还几张**按这枚棋子真正占了几张**算 —— 道具多给的份数没从牌库拿过，
        //   还多了就是凭空变牌（博士投影升过星的只还 1 张；白送的、复制出来的还 0 张，跳过）
        if (netplayActive) {
          const copies = poolCopiesOfUnit(unit);
          if (copies > 0) net.sellCard(unit.defId, unit.star, copies);
        }
        const result = doSellBench(state, unit.uid);
        toast(result.message, !result.ok);
        renderAll();
      });
    }

        return cellEl;
      },
    });
  }

  const rebuilt = renderKeyed(el.benchSlots, specs, {
    key: (spec) => spec.key,
    sig: (spec) => spec.sig,
    build: (spec) => spec.build(),
    // ★ 观战对象换了 = 另一套备战席，整块重建（缓存不能混用）
    ns: watching ? `watch:${viewingPlayerId}` : '(me)',
  });
  /*
    ★ 0.1.1：只有**真的重建过**格子，原来那张悬停卡片指向的节点才不存在了 ——
    这时候才需要收起来。以前是每次 renderBench 都收（= 每次买牌都把悬停卡片关掉，
    玩家会看到"卡片一闪一闪"）。
  */
  if (rebuilt > 0) hideBenchTip();
}

// ============================================================
// 3D：布阵阶段的棋子
// ============================================================

/**
 * 把 3D 画面上的布阵棋子调整成"当前阵容该有的样子"。
 *
 * 【这个函数曾经只做"增"和"删"，漏了"移动" —— 后果很严重】
 * 拖动换位之后，数据变了、贴图还留在原地；
 * 于是画面上的 A 其实站在 B 的格子上，而拾取是按贴图位置算的 ——
 * 接下来你拖的会是另一个棋子，整个棋盘看起来就是"位置乱飞、怎么拖都不对"。
 *
 * 现在改成「先算计划、再按差异执行」：
 *   增（created）· 移（moved）· 换贴图（restyled）· 删（removed）
 * 四种变化都显式处理，移动不再是"顺手看看"的可选项。
 * 计划的算法在 game/prep-sprites.ts 里，是纯函数、有单元测试。
 */
function syncPrepSprites(): void {
  /*
    【★ 必须带上阶段】—— 这里踩过一个坑
    这些精灵代表"玩家摆的阵容"（静止的）。战斗一开始，演出层会另外生成
    一套会动的棋子；如果这套静止的没被收起来，同一格就叠着两个棋子。
    因为两套一开始位置完全重合，你根本看不出来 ——
    直到棋子开始移动，静止的那个留在原地，才像"移动时留下了一个残影"。

    具体的 bug 经过：把同步放进了 renderAll()（为了修"升星后旧贴图不消失"），
    但 renderAll() 在战斗中也会被调用，于是每次都把布阵棋子重新建了出来。
    所以阶段是 planPrepSprites 的必填参数 —— 不传就编译不过，不可能再忘。
  */
  /*
    ★ 对手的阵容也要画出来（0.0.2 追加需求：布阵阶段就能看到对方）。

    ★★ 0.0.2 修复：这**只属于单机模式**。
    判断本身抽成了纯函数 `shouldShowSoloEnemy`（带单元测试）——
    原来的条件里没有排除联机，于是联机对局中每台客户端都在自己的右半场
    凭空画出一队"人机对手"（那是按本机 state.seed 生成的，
    和房间里真正的对手毫无关系）。真人对手的阵容由服务器通过
    battleStart 下发；布阵阶段想看别人摆了什么，走「点玩家列表 -> 看棋盘」。
  */
  /*
    ★ 0.0.3 测试沙盒：两侧棋子**同时**画出来（蓝方在左半场、红方在右半场）。
    两份数据分别来自两套独立状态，和"当前在操作谁"无关 ——
    所以切换阵营时棋盘画面纹丝不动，只是底部商店 / 备战席 / 顶部数值换成另一侧。
  */
  let after: ReturnType<typeof planPrepSprites>;
  if (testSides) {
    after = planPrepSprites(testSides[0].placements, {
      phase: state.phase,
      // 红方棋子按自己的 uid 排序传进去，保证增删时不会下标错位（见 planPrepSprites）
      enemy: [...testSides[1].placements].sort((a, b) => a.uid - b.uid),
    });
  } else {
    const showEnemy = shouldShowSoloEnemy({
      netplay: netplayActive,
      onGameView: currentView === 'game',
      viewingOther: viewingPlayerId !== null,
    });
    after = planPrepSprites(placementsForBoardView(), {
      phase: state.phase,
      enemy: showEnemy ? opponentPlacementsForRound(state.round, state.seed) : [],
    });
  }
  const diff = diffPrepSprites(lastSpritePlan, after);
  /** 看别人阵容时，那些棋子不是"我方"，血条该是敌方的颜色 */
  const mine = viewingPlayerId === null;

  // 1) 删掉场上已经没有的
  for (const uid of diff.removed) {
    const sprite = prepSprites.get(uid);
    if (sprite) board.unitLayer.remove(sprite);
    prepSprites.delete(uid);
  }

  // 2) 新建 + 移动（位置每帧都可能变，所以这里必须无条件设置）
  for (const plan of [...diff.created, ...diff.moved]) {
    const def = UNIT_DEFS[plan.defId];
    if (!def) continue;
    let sprite = prepSprites.get(plan.uid);
    if (!sprite) {
      /*
        对手的棋子：team = 1、mine = false —— 血条是敌方红色，
        一眼就能分出"这半边是谁的地盘"。
        （对手的血条不会参与血量隐藏那套规则，它本来就一直是满的）
      */
      sprite = plan.enemy
        ? createUnitSprite(def, plan.star, 1, false)
        : createUnitSprite(def, plan.star, 0, mine);
      board.unitLayer.add(sprite);
      prepSprites.set(plan.uid, sprite);
    }
    // ★ 关键：不管新建还是已存在，都把位置设成计划里的格子
    sprite.position.copy(cellToWorldFlipped(plan.cell, CARD_CENTER_Y, viewFlipped));
  }

  // 3) 棋子或星级变了（对手阵容在同一个座位上换人 / 升星）-> 整只精灵换内容
  for (const plan of diff.restyled) {
    const sprite = prepSprites.get(plan.uid);
    const def = UNIT_DEFS[plan.defId];
    if (!sprite || !def) continue;
    /*
      ★ 必须走 restyleUnitSprite，不能再用 updateUnitSprite。
      updateUnitSprite 只管"血量档 / 特效"这两样，restyle 恰好两样都没变 ——
      它会直接 return，于是卡面、星级、小人**全都不更新**：
      这个座位上明明换了个干员，画面上还是上一个干员的模型和星级
      （对手每回合都在换人/升星，所以棋盘上会一直留着"过期的敌人"）。
    */
    restyleUnitSprite(sprite, def, plan.star);
    sprite.position.copy(cellToWorldFlipped(plan.cell, CARD_CENTER_Y, viewFlipped));
  }

  /*
    4) ★ 0.0.3：藏品圆点（血条左边那两个小圆圈）。
    装备件数没变的话 setUnitItemDots 内部会直接 return，所以这里可以放心地对
    "可能变了"的几只无条件调一次 —— 不必再为它单独维护一套"上次几件"的状态。
    （真正会变的只有 diff 里那几只；开局的 created 也从 0 件开始对齐。）
  */
  for (const plan of [...diff.created, ...diff.moved, ...diff.restyled, ...diff.retooled]) {
    const sprite = prepSprites.get(plan.uid);
    if (sprite) setUnitItemDots(sprite, plan.items ?? 0);
  }

  lastSpritePlan = after;
}

/**
 * 现在棋盘上该画谁的棋子。
 *
 * 【为什么要单独一层？】
 * 因为你要求"布阵阶段能看别人的阵容"。看别人的时候，
 * 棋盘上显示的是**他**的棋子，但你自己那份阵容数据（state.placements）
 * 一点都不能动 —— 否则你瞄一眼别人的阵容就把自己的摆法弄丢了。
 *
 * 所以这里只是"换个数据源来画"，游戏逻辑永远只认 state.placements。
 */
function placementsForBoardView(): ReadonlyArray<{
  uid: number;
  defId: string;
  star: number;
  cell: Cell;
  items?: string[];
}> {
  if (viewingPlayerId === null) return state.placements;
  const units = prepTeams[viewingPlayerId]?.units ?? [];
  /*
    别人的棋子没有 uid（uid 是本地发的编号）。这里现造一批
    从 500000 开始的号 —— 刻意避开本地编号区间，免得和他的棋子撞号，
    那样同步逻辑会把两个不相干的棋子当成同一个（画面就会串位）。
  */
  return units.map((unit, index) => ({
    uid: 500000 + index,
    defId: unit.defId,
    star: unit.star,
    cell: { col: unit.cell.col, row: unit.cell.row },
    // ★ 0.0.3：看别人棋盘时，他干员身上的藏品圆点也照实画出来
    items: unit.items,
  }));
}

/** 上一次同步时画面上的样子，用来算出"这次要改什么" */
let lastSpritePlan: ReturnType<typeof planPrepSprites> = [];

/**
 * 切换视角翻转。
 *
 * 【为什么必须走这个函数，不能直接写 viewFlipped = ...？】
 * 因为翻转会改变"格子 -> 世界坐标"的映射，
 * 也就是**所有棋子的落点都变了**。而"排布计划"里只有逻辑格子，
 * 不含翻转状态，所以直接改变量的话，下一次同步算不出任何差异 ——
 * 棋子会一直留在翻转前的位置上（画面和逻辑对不上，又是一次"位置乱飞"）。
 * 这里顺手把计划清空，下次同步就会把所有棋子重新摆一遍。
 */
function setViewFlipped(flip: boolean): void {
  if (viewFlipped === flip) return;
  viewFlipped = flip;
  // 与 setViewingPlayer 同理：只清计划不算数，旧精灵会一直留在原来的位置上
  clearPrepSprites();
}

function clearPrepSprites(): void {
  for (const sprite of prepSprites.values()) {
    /*
      ★ 拆精灵时把它身上挂的小人也拆掉 —— 不然每个被丢弃的棋子
      都漏一张 224×170 的 canvas 贴图，一局下来能漏几百张；
      而且 pendingAttach 里还引用着它，GC 都收不走。
    */
    detachChibi(sprite);
    board.unitLayer.remove(sprite);
  }
  prepSprites.clear();
  lastSpritePlan = [];
}

// ============================================================
// 统一重绘
// ============================================================

/**
 * 联机是否处于「已占用」状态（在房间里 或 正在对局中）。
 *
 * 【为什么需要这个判断？】
 * 测试模式（无限金币）绝对不能进联机对局 —— 那会直接破坏游戏平衡。
 * 所以只要联机是占用的，就要把测试模式按钮**禁用**，
 * 而不是只弹一个警告 —— 禁用是硬约束，警告用户可能忽略。
 */
/**
 * ★ 0.1.1：布阵倒计时还剩几秒（`null` = 此刻不显示倒计时）。
 *
 * 由 `onPrepTick` 每秒更新；**换回合时必须清成 null**，
 * 否则新回合的一瞬间会闪一下上一回合剩下的「布阵 0s」。
 */
let prepSecondsLeft: number | null = null;

/**
 * ★ 0.2：联机里**服务端**推过来的商店剩余秒数（`null` = 现在不在商店阶段）。
 *
 * 【为什么还要单独存一份，而不是只读 `state.shopRound.secondsLeft`？】
 * 因为"重连回来时商店还剩几秒"和"本地那张商店在不在"是两件事：
 * 玩家可能已经点过「结束商店」把本地收掉了，而服务端那一段还在跑 ——
 * 这时候阶段文字必须照服务端说"商店 N 秒"，不能因为本地没收摊就不显示。
 */
let netShopSecondsLeft: number | null = null;

/**
 * ★ 0.1.1：倒计时进入最后这几秒就变红警示。
 * （用户要求 10 秒。放在这里而不是 shared：它是纯界面规则，内核不关心。）
 */
const PREP_WARN_SECONDS = 10;

/**
 * ★ 0.3.4：联机布阵"最后一秒自动补位"，每回合只做一次（记的是回合号）。
 *
 * 【为什么联机必须放在 tick 里、不能挂在"开战"上】
 * 联机没有「开战」按钮 —— 时间一到服务器直接开打。
 * 所以只能在布阵最后一秒把备战席的人补上去，并且**当场同步给服务器**
 * （服务器开打用的是它手上那份 `lastSeenTeam`，不同步等于没补）。
 */
let autoFillDoneRound: number | null = null;

/** 布阵最后一秒的自动补位（单机走 startBattle，联动走这里） */
function tryAutoFillBeforeNetplayBattle(): void {
  if (!netplayActive || state.phase !== 'prep') return;
  if (autoFillDoneRound === state.round) return;
  autoFillDoneRound = state.round;
  // 观战 / 已淘汰的人不能替他改棋盘（和商店那几个入口同一个判据）
  if (spectateOrEliminated()) return;
  const placed = autoFillBoardFromBench(state);
  if (placed <= 0) return;
  syncTeamToServer();
  state.message = `布阵结束前自动补位 ${placed} 名`;
  toast(`人口没上满 —— 已自动补上 ${placed} 名`);
  renderAll();
}

/**
 * 顶部那一行阶段文字：「布阵 42s」/「战斗中」/「旁观」/「等其他人看完战斗…」…
 *
 * ============================================================
 *  ★ 0.1.1：修的是「布阵倒计时闪烁」
 * ============================================================
 * 原来这一行**有两个写入点**，而且格式还不一样：
 *   · `renderAll()` 写「布阵」（没有秒数）
 *   · `onPrepTick()` 每秒写一次「布阵 42s」
 * 而联机里 `renderAll()` 会被各种事件频繁触发（别人买卖 -> 广播 pool、
 * 谁改了阵容 -> 广播 prepTeams、有人进出 -> 广播 room…）。
 * 于是倒计时在「布阵」和「布阵 42s」之间来回跳 —— 玩家看到的就是**闪烁**。
 *
 * 现在收成一个函数、一个数据源（`prepSecondsLeft`），
 * 不管谁调用、什么时候调用，写出来的都是同一句话。
 *
 * 【秒数从哪来？】优先用服务器每秒推的 prepTick；
 * 刚进新回合的那一秒还没有 tick（服务器是 1 秒后才推第一条），
 * 就退回 `room.prepSecondsLeft`（服务器按"开始时刻"现算的，永远是准的）。
 */
function renderPhaseBadge(): void {
  /*
    ★ 0.1.3：**对局暂停**（在线玩家不足 2 人）要有自己的一句话。
    这时候服务端既不推 prepTick 也不开新回合，画面上只有一个不动的倒计时 ——
    不说清楚的话，玩家只会以为游戏卡死了（这正是要修的那个观感）。
  */
  const paused = netplayActive && net.room?.paused === true;
  const waitingForOthers = netplayActive && state.phase === 'result' && !netplayMatchOver;
  const phaseText = netplayActive
    ? paused
      ? '等待其他玩家回来'
      : state.phase === 'prep'
      ? '布阵'
      : // ★ 0.2 商店回合：野怪回合之后插入的 90 秒（不计入回合数）
      state.phase === 'shop'
      ? '商店'
      : state.phase === 'battle'
        ? spectating
          ? '旁观'
          : '战斗中'
        : waitingForOthers
          ? '等其他人看完战斗…'
          : '结算'
    : state.phase === 'prep'
      ? '布阵'
      : state.phase === 'shop'
        ? '商店'
        : state.phase === 'battle'
          ? '战斗中'
          : '结算';

  /*
    ★★ 0.2：商店回合在联机里也要显示秒数 ——
    而且这个数**优先用服务端推的那一份**（`netShopSecondsLeft`），
    因为玩家可能已经点「结束商店」把本地收掉了（本地 `state.shopRound` 是 null），
    但服务端那 90 秒还在跑 —— 这时候阶段文字得照服务端说。
  */
  const shopSeconds =
    netplayActive && !paused
      ? netShopSecondsLeft
      : state.shopRound
        ? Math.max(0, Math.ceil(state.shopRound.secondsLeft))
        : null;
  const inShop = state.phase === 'shop' || (netplayActive && netShopSecondsLeft !== null);

  const countdown =
    netplayActive && state.phase === 'prep' && !paused
      ? (prepSecondsLeft ?? net.room?.prepSecondsLeft ?? null)
      : null;

  if (paused) {
    // 暂停时把"还剩多久"带上 —— 这是那 3 分钟的倒计时（不是布阵倒计时）
    el.phase.textContent = `等待其他玩家回来（${formatClock(pauseInfo.secondsLeft)}）`;
    el.phase.classList.remove('urgent');
  } else if (inShop && shopSeconds !== null) {
    el.phase.textContent = `商店 ${shopSeconds}s`;
    el.phase.classList.toggle('urgent', shopSeconds <= PREP_WARN_SECONDS);
  } else if (countdown !== null) {
    el.phase.textContent = `布阵 ${countdown}s`;
    // 最后 10 秒变红：只看秒数，不看别的状态
    el.phase.classList.toggle('urgent', countdown <= PREP_WARN_SECONDS);
  } else {
    el.phase.textContent = state.testMode ? `${phaseText} · 测试` : phaseText;
    el.phase.classList.remove('urgent');
  }
}

/**
 * ★ 0.3：把"藏品回的血"发给服务端（联机专用，单机什么都不做）。
 *
 * 【为什么挂在 renderAll 里？】
 * 装备是走 state 层的，那里不该碰网络；而每次装备完必然 renderAll 一次。
 * 放在这里就不用去改十几处"装完/卸完"的调用点（漏一处就是"偶尔不回血"）。
 * 幂等：发完立刻清零，重复调用不会重复加血。
 */
function flushPendingHeal(): void {
  if (!netplayActive || !net?.room) return;
  if (state.pendingHeal <= 0) return;
  const amount = state.pendingHeal;
  state.pendingHeal = 0;
  net.healPlayer(amount);
}

function renderAll(): void {
  // ★ 0.3：先把待同步的回血发给服务端（见函数说明），再画界面
  flushPendingHeal();
  /*
    ★ 0.1.2：断线重连浮层也放这里（幂等）。
    断线/重连成功的分支都会走到 renderAll，所以只要在这里读 `netplayResyncing`
    就够了 —— 不用在每个赋值点都记得手动切换一次。
  */
  renderResyncOverlay();
  // ★ 0.1.4：对局暂停浮层同理（内容每秒变，但显隐只跟 `net.room.paused` 走）
  renderPauseOverlay();
  // ★ 0.1.4：主界面右下角那个「回到对局」也是"有没有活干"的派生状态
  renderReconnectButton();
  // ★ 0.2 MujicaAve：fever 达标的次级页面（同样幂等：显隐只跟 state.fever.prompt 走）
  renderFeverOverlay();
  /*
    ★ 0.3.2 阿米娅升变任务（幂等）：
      · `renderAmiyaQuest` 画日志面板里那条常驻进度；
      · `consumeAmiyaQuestRewards` 只在**布阵阶段**把达成的那一段发成证
        （一阶段弹二选一，二阶段直接发）。
    放在 renderAll 里就不用每个调用点都记着调 —— 而且它自己会判"该不该发"。
  */
  renderAmiyaQuest();
  consumeAmiyaQuestRewards();
  // ★ 0.2 商店回合：坎诺特的限时商店（幂等，显隐只跟 state.shopRound / 它的 open 走）
  renderShopRound();
  /*
    ★ 0.3：盟约选秀页也在这里同步（幂等）——
    以前它只在 `onRoom` 里调，所以**单机那份本地选秀**根本没机会渲染。
  */
  syncCovenantPage(net.room);

  /*
    ★ 0.1.1：观战切换条跟着阶段走（进战斗才出现；结算 / 布阵自动收起来）。
    放这里就不用每个调用点都记着调一次 —— 它是幂等的，重复调没问题。
  */
  renderSpectateBar();

  /*
    ★ 统一在这里同步 3D 棋子。
    【为什么必须放这儿？】
    因为**合成会替换棋子编号**：场上有 2 个一样的、再买第 3 个时，
    被吃掉的两个编号连同它们的精灵一起消失、合成物是一个新编号。
    而买牌的路径只调用了 renderAll()，从来没有同步过精灵 ——
    结果就是"升星之后旧贴图留在原地不消失"。
    把同步放进 renderAll 之后，**任何改了阵容的地方都自动更新 3D**，
    不需要每个调用点都记得额外调一次（这正是之前漏掉的原因）。
  */
  syncPrepSprites();

  // ★ 0.1.1：没有拖动在跑，就顺手把可能残留的拖影清掉（见 sweepOrphanDragGhosts）
  sweepOrphanDragGhosts();

  // 商店变了就顺手告诉服务器（内部有去重：内容没变就不发）
  syncShopHeld();

  const econ = state.economy;
  const info = levelInfo(state);

  // 顶部
  el.hp.textContent = String(econ.hp);
  el.level.textContent = String(info.level);
  // ★ 0.0.3：开了「无视人口上限」就把上限显示成 ∞（不然数字对不上实际能摆几个）
  /*
    ★★ 0.3 bug 修复：人口上限要用 `popCap(state)`，不能用 `info.populationCap`。
    后者是 `levelSummary` 给的，**只算等级、不含藏品**（地形图 +1 那类）——
    于是"能摆 6 个"但顶栏写着 5/5，多摆一个就看起来像超编。
    ★ 两件同款地形图会 +2（`itemPopCapBonus` 是逐件累加的），
      所以"装了两件却只显示 +1"也一并修好了。
  */
  el.pop.textContent = state.ignorePopCap
    ? `${state.placements.length} / ∞`
    : `${state.placements.length} / ${popCap(state)}`;
  el.round.textContent = String(state.round);

  /*
    ★ 0.2.2：距离下一个**野怪回合**还剩几回合。

    【为什么要摆在顶栏？】
    野怪回合是"这一波要不要花钱、要不要留钱升人口"的关键节点。
    以前玩家只能靠数回合数自己记（"1、2 是野怪，然后每 7 回合一次"），
    记错的代价是整回合的经济决策做反 —— 摆出来就没人需要记了。

    【为什么单人 / 多人共用这一格？】
    两边的顶栏是同一套 DOM、都读 `state.round`；对手是谁（野怪还是真人）
    由服务器决定，但"第几回合是野怪回合"这条节奏是**内核级的**，两边完全一样。
    ★ 数字一律来自 shared 的 `monsterRoundCountdown` —— 界面不许自己算 `(r-2)%7`，
      否则以后改节奏就会漏掉这一处。
  */
  const monster = monsterRoundCountdown(state.round);
  el.monster.textContent = monster.now ? '本回合' : `${monster.roundsLeft} 回合后`;
  el.monster.classList.toggle('soon', monster.now || monster.roundsLeft <= 2);
  /*
    ★★ 0.3.4 修：这句提示原来写的是「打野怪不扣血，赢了还有掉落」，**两句都不准**：
      · 野怪回合输了**照样按回合扣血**（服务端走 `applyGhostResult` → `damageForRound`，
        见 room.ts 里"输了自己扣血、记一负"那段）；
      · 掉落也不是"赢了才有"：`grantMonsterRoundDrops` 是**按真的被打死的野怪逐只掷**，
        输了但打死了几只，一样会掉。
    现在按实际规则写（用户报过"文案和实际对不上"这类问题，别再凭印象写）。
  */
  el.monsterWrap.title = monster.now
    ? `第 ${monster.round} 回合就是野怪回合 —— 输了照样扣血；掉落按"真的被打死的野怪"逐只算`
    : `第 ${monster.round} 回合是野怪回合（再过 ${monster.roundsLeft} 回合）—— 输了照样扣血；掉落按"真的被打死的野怪"逐只算`;

  // 底部金币（靠近买棋子的地方更好用）
  // 测试模式下显示「∞」，避免让人误以为真有几十万
  // ★ 0.0.3：金币显示成 ∞ 只看「无限金币」开关，不再是"测试模式就无限"
  el.dockGold.textContent = state.infiniteGold ? '∞' : String(econ.gold);
  el.dockGold.classList.toggle('testmode', state.testMode);
  // 修改器按钮只在测试模式出现，控件状态跟着 state 走
  renderModifier();

  /*
    连胜 / 连败徽章（显示在金币旁边）。
    ★ 显示的是"**下一回合**能多拿多少"，不是"已经拿了多少" ——
    因为玩家看它就是为了决定"这回合怎么花"。
    连 1 胜/连 1 败不显示（那还谈不上势头，只会多一个碍眼的标签）。
  */
  const streakLabel = streakLabelOf(econ.streak);
  const streakGold = streakBonusOf(econ.streak);
  if (streakLabel) {
    el.dockStreak.textContent = '';
    el.dockStreak.className = `streak-badge ${econ.streak > 0 ? 'win' : 'loss'}`;
    el.dockStreak.append(streakLabel);
    if (streakGold > 0) {
      const gold = document.createElement('span');
      gold.className = 'streak-gold';
      gold.textContent = `+${streakGold}金`;
      el.dockStreak.append(gold);
    }
    el.dockStreak.title =
      econ.streak > 0
        ? `已连胜 ${econ.streak} 局：下一回合额外 +${streakGold} 金（每 2 连胜 +1，最多 +5）`
        : `已连败 ${-econ.streak} 局：下一回合额外 +${streakGold} 金（连败 2 局 +2，4 局起 +5）`;
    el.dockStreak.classList.remove('hidden');
  } else {
    el.dockStreak.classList.add('hidden');
  }

  /*
    阶段文字。测试模式在标题上标一下，免得玩着玩着忘了自己在无限金币模式

    【★ 联机结算时要说清"在等什么"】
    联机的下一回合**要等所有人把战斗看完**（服务器收齐回执才推进）。
    如果这里只写「结算」，先看完的那个人会盯着一个不动的画面十几秒，
    以为卡住了 —— 这正是"双端不同步"最容易被误报成 bug 的地方。
    所以把"等其他人看完"直接写出来。
  */
  renderPhaseBadge();

  /*
    单机模式下告诉玩家"这一波敌人是什么"。
    【为什么要有这个？】
    因为难度是按回合递增的固定曲线，玩家能提前知道就能规划 ——
    "第 6 回合有 3 个二星，我这套 4 人口可能顶不住，先把钱花掉升个人口"。
    看不到敌情的话，难度曲线再合理也只是"莫名其妙被打死"。
    联机时对手是真人，没有这一栏。
  */
  if (el.waveHint) {
    // ★ 测试沙盒没有"闯关波次"，这一栏也要藏掉（否则会显示本地 seed 推出的人机波次）
    if (netplayActive || isTestSandbox() || state.phase !== 'prep') {
      el.waveHint.textContent = '';
      el.waveHint.classList.add('hidden');
    } else {
      el.waveHint.textContent = `本波：${waveDescription(state.round, state.seed)}`;
      el.waveHint.classList.remove('hidden');
    }
  }

  // 主界面底部的状态文字：告诉玩家当前是什么模式、连没连上服务器
  if (currentView === 'menu') {
    setNetStatus(
      net.connected
        ? `已连接服务器 · ${net.url}`
        : `单机模式 · 服务器 ${net.url}（选联机功能时会自动连接）`,
      net.connected ? 'online' : '',
    );
  }

  // 底部等级条
  el.dockLevel.textContent = String(info.level);
  el.dockXp.style.width = `${Math.round(info.progress * 100)}%`;
  el.dockXpText.textContent = info.atMaxLevel ? '满级' : `${info.xp}/${info.xpNeeded}`;
  /*
    ★ 0.1.1：这几个按钮在**战斗阶段也要能用**（用户要求"商店功能不受战斗状态限制"）。
    闸门统一走 state 层的 `canShopNow`，界面这边不再自己写一遍阶段判断 ——
    两处各写一份的话，迟早会出现"按钮亮着、点了却报错"。
  */
  const shopUsable = canShopNow(state.phase);
  el.btnBuyXp.disabled = !shopUsable || info.atMaxLevel || econ.gold < BUY_XP_COST;
  el.btnRefresh.disabled = !shopUsable || econ.gold < REFRESH_COST;

  /*
    ★★ 0.3.1：盟约攒着的「特殊刷新」（猎头顾问 = 2 张同名 / 博学多通 = 高费）。
    用户要求"特别刷新和普通刷新要能一眼分辨"，所以给按钮挂一个**金色**角标。
    ★ 颜色口径：金 #F5C544 只给"资源与活动入口"，免费/激活状态用荧光黄绿 ——
      这两处刻意不同色，就是为了让"特殊刷新"和"坎诺特免费刷新"不混淆。
  */
  const spHint = specialRefreshHint(state);
  el.btnRefresh.classList.toggle('is-special', Boolean(spHint));
  el.btnRefreshBadge.classList.toggle('hidden', !spHint);
  el.btnRefreshBadge.classList.toggle('special', Boolean(spHint));
  el.btnRefreshBadge.textContent = spHint ? '特殊刷新' : '';
  el.btnRefresh.title = spHint ? `下一次刷新是特殊刷新：${spHint}（快捷键 D）` : '刷新商店（快捷键 D）';

  // 锁定按钮：显示当前状态，锁定时金色高亮
  el.btnLock.textContent = econ.shopLocked ? '🔒 已锁定' : '🔓 未锁定';
  el.btnLock.classList.toggle('locked', econ.shopLocked);
  el.btnLock.disabled = !shopUsable;

  /*
    开战按钮。
    ★ 联机时**整个按钮都不显示**了 —— 布阵改成 60 秒定时制，
    时间一到服务器拿你当前摆好的阵容自动开打，不需要点任何东西。
    留一个"提交阵容"按钮只会让人以为必须点（不点会不会不算？），
    所以直接去掉，改由顶部的倒计时说明一切。
  */
  /*
    ★ 0.0.3 测试沙盒：开战按钮要说清"蓝 n vs 红 m"，
    而且两边都得有人才让开打（空的一边没法"对打"）。
  */
  /*
    ★ 0.3.4：场上一个人都没有、但备战席有人时，**也允许点开战**。
    理由：开战前会自动补位（见 startBattle），所以"空场 + 备战席有人"是能打的；
    以前这里只看 `canStartBattle`（要求场上至少 1 人），按钮直接灰掉，
    玩家必须先手动摆一个 —— 自动补位等于白做了。
  */
  const canFight =
    state.phase === 'prep' &&
    (canStartBattle(state).ok || (state.economy.bench.length > 0 && canEditTeam(state.phase)));
  el.btnBattle.classList.toggle('hidden', netplayActive);
  if (testSides) {
    const blue = testSides[0].placements.length;
    const red = testSides[1].placements.length;
    el.btnBattle.disabled = state.phase !== 'prep' || blue === 0 || red === 0;
    el.btnBattle.textContent =
      state.phase === 'prep' ? `开始战斗（蓝 ${blue} · 红 ${red}）` : '战斗进行中';
  } else {
    el.btnBattle.disabled = !canFight;
    el.btnBattle.textContent =
      state.phase === 'prep'
        ? `开始战斗（场上 ${state.placements.length}/${state.ignorePopCap ? '∞' : info.populationCap}）`
        : '战斗进行中';
  }

  renderSideSwitch();
  renderTraits();
  renderShop();
  renderBench();
  renderPlayerStrip();
  renderSidebarTabs();
  // ★ 0.0.3：右侧「藏品」那一栏（19 个格子，整块重画，见 renderCollection 的说明）
  renderCollection();
  renderNetPanel();
  applySpectateLocks();

  // 阵容变了就静默同步给服务器（联机 + 布阵阶段才有意义）
  syncTeamToServer();
  // 等级/连胜变了也同步一下（玩家列表要显示这两个数）
  syncPlayerStatsToServer();
}

/**
 * 联机：把自己当前的等级 / 连胜连败报给服务器（0.0.2 需求第 11 条）。
 *
 * 【为什么由客户端算？】
 * 等级和连胜属于经济系统，而经济目前跑在客户端（买经验、回合结算都是本地算的），
 * 服务器没有这本账。所以这里只是"通报一下自己长什么样"，
 * 服务器存下来转发给同房间的人 —— 纯展示，不影响任何胜负判定。
 *
 * 【去重】renderAll() 调用得很频繁，数值没变就不要再发。
 */
function syncPlayerStatsToServer(): void {
  if (!netplayActive || !net.room) return;
  const level = state.economy.level;
  const streak = state.economy.streak;
  const signature = `${level}:${streak}`;
  if (signature === lastSyncedStats) return;
  lastSyncedStats = signature;
  net.reportPlayerStats(level, streak);
}

/**
 * ★ 看别人棋盘时，把"会改动自己阵容"的功能藏起来（你要求的）。
 *
 * ============================================================
 *  【为什么必须藏？】
 * ============================================================
 * 看别人棋盘时，棋盘上画的是**他的**棋子；而购买、买经验、升级
 * 动的都是**你自己的**经济。两件事同时发生，玩家会懵：
 * "我点了这个棋子，怎么变的是我的备战席？"
 * 更糟的是人口和金币是有限的 —— 一边"看别人"一边手滑买错，是真的会亏。
 *
 * 所以看别人时直接隐藏：商店、刷新、锁定、买经验。
 * 金币/等级/备战席保留（看着自己的经济规划下一回合仍然有用），
 * 而且立刻就能观察到自己没被扣钱。
 */
/**
 * ★★ 0.2.1：我**现在能不能操作自己的东西** —— 唯一判据。
 *
 * 两种情况一律锁死（商店 / 拖棋子 / 点棋盘 / 快捷键全算）：
 *   · 正在看别人的棋盘（画的是他的棋子，动的却是我的数据）；
 *   · 我已被淘汰（手里的牌已经还给共享牌库，再买卖牌库的账就乱了）。
 *
 * 【为什么必须收成一个函数？】
 * 以前 `applySpectateLocks`、键盘快捷键、画布拖动各写了一遍同样的条件；0.2 新增的
 * **商店回合**（坎诺特弹窗）没跟着写 —— 于是淘汰的人照样能开商店买东西，
 * 就是用户报的那个严重 bug。现在界面层只允许读这一个函数；
 * `game/state.ts` 那边读 `shopBlockedByElimination()` / `shopRoundUsable()`。
 */
function spectateOrEliminated(): boolean {
  return viewingPlayerId !== null || state.meEliminated;
}

function applySpectateLocks(): void {
  const spectating = viewingPlayerId !== null;
  /*
    ★ 0.1.1：被我淘汰之后，商店**永久关掉**（不只是"正在看别人"的时候）。
    出局的人手里的牌已经还给共享牌库了，再让他买东西，
    牌库的账会直接错乱 —— 所以这里必须连"自己的棋盘"状态也一起锁。
  */
  const shopLocked = spectateOrEliminated();
  for (const node of [el.shopSlots, el.btnRefresh, el.btnLock, el.btnBuyXp, el.shopOdds]) {
    node.classList.toggle('hidden', shopLocked);
  }
  // 商店标题也跟着换一句话，免得留一个空框让人以为界面坏了
  if (el.shopTitle) {
    el.shopTitle.textContent = state.meEliminated
      ? '你已被淘汰 · 现在只能观战'
      : spectating
        ? '正在看别人的棋盘（不能购买 / 升级）'
        : '商店';
  }
  if (el.dock) el.dock.classList.toggle('spectating', shopLocked);
  if (el.dock) el.dock.classList.toggle('eliminated', state.meEliminated);
  /*
    ★ 注意：这里**不能**去动 `el.btnBattle` 的 hidden ——
    "开始战斗"按钮在联机里本来就由 renderAll 统一藏起来
    （`toggle('hidden', netplayActive)`）。在这里再 toggle 一次，
    条件不成立时反而会把 hidden 摘掉，把按钮又显示出来。
    出局的人本来就是联机（按钮已经藏着），不需要额外处理。
  */
}

/**
 * 联机：玩家列表（右侧栏「玩家」页签里）。
 *
 * 【0.0.2 改了什么】
 *   · 从"右侧栏顶部的一截"改成**独立的页签**（和战斗日志互斥显示），
 *     一排面板挤在一起的问题没有了。
 *   · 每一行显示：头像 · 名字 · 等级 · 连胜连败 · 血量 · 场上人数。
 *     （需求第 11 条：玩家列表显示血量、等级、当前连胜连败）
 *   · 头像就是每个人在主界面选的那个干员头像（需求第 16 条）。
 *
 * 【两个必须保留的细节】
 *   1. **最后 5 秒不显示血量**（`BLIND_HP_LAST_SECONDS`）。
 *      血量是"谁快出局了"的信号，最后一刻还能看到的话，
 *      就能据此决定"这回合要不要梭哈"，变成纯信息优势。
 *   2. **看别人阵容时能一键回到自己棋盘**，而且一进战斗就自动回来 ——
 *      不然下一回合你会对着别人的空棋盘摆自己的棋子。
 */
function renderPlayerStrip(): void {
  const room = net.room;
  // "能看别人阵容"只在联机 + 布阵阶段成立
  const spectatable = netplayActive && state.phase === 'prep' && !!room;
  if (!spectatable && viewingPlayerId !== null) setViewingPlayer(null);

  if (!room) {
    renderKeyed(
      el.playerStripList,
      [{ key: '#solo', text: '单机模式没有其他玩家。' }],
      {
        key: (spec) => spec.key,
        sig: (spec) => spec.text,
        build: (spec) => {
          const empty = document.createElement('div');
          empty.className = 'damage-empty';
          empty.textContent = spec.text;
          return empty;
        },
        ns: 'solo',
      },
    );
    el.btnBackMyBoard.classList.add('hidden');
    return;
  }

  // 布阵进行中、且只剩最后几秒：血量统一打码
  const secondsLeft = room.prepSecondsLeft;
  const hpHidden = state.phase === 'prep' && secondsLeft > 0 && secondsLeft <= BLIND_HP_LAST_SECONDS;

  /*
    ★★ 0.3：这一栏也改成按 playerId 就地更新。
    联机里它被 `renderAll()` 和**每秒一次的 room 广播**反复调用 ——
    以前每次都把所有人重建一遍（头像 `<img>` 也跟着重建 → 闪一下），
    而这里是玩家列表，闪起来特别显眼。
  */
  const specs: DomSpec[] = [];
  for (const player of room.players) {
    const isMe = player.id === net.playerId;

    const hpClass = hpHidden ? 'hidden-hp' : player.hp <= 30 ? 'low' : '';
    const hpText = player.hp <= 0 ? '淘汰' : hpHidden ? '•••' : `${player.hp}`;
    // ★ 后面那个 `?.units?.length`：万一收到旧格式（数组）也不至于整块崩掉
    const units = prepTeams[player.id]?.units?.length ?? 0;

    /*
      连胜连败文案：正数 N 连胜、负数 N 连败、0 和 ±1 都不显示。
      （只赢一两把不算"连胜"，写出来反而占地方 —— 和 dock 上的徽章同一套规则）
    */
    const streakText =
      player.streak >= 2
        ? `${player.streak} 连胜`
        : player.streak <= -2
          ? `${-player.streak} 连败`
          : '';
    const metaParts = [`Lv${player.level}`];
    if (streakText) metaParts.push(streakText);
    metaParts.push(`${units} 个`);

    const avatar = avatarPathOf(player.avatarId);
    const covenant = covenantOf(player.covenantId);
    const title = isMe
      ? '点一下看自己的阵容'
      : !spectatable
        ? '只有布阵阶段才能看别人的棋盘'
        : hpHidden
          ? '布阵最后几秒不显示血量'
          : `点一下看 ${player.name} 的阵容（${units} 个干员）`;

    const sig = [
      player.name,
      player.avatarId ?? '',
      player.level,
      player.streak,
      player.hp,
      units,
      player.covenantId ?? '',
      hpClass,
      hpText,
      isMe ? 'me' : '',
      viewingPlayerId === player.id ? 'v' : '',
      player.hp <= 0 ? 'dead' : '',
      title,
    ].join('|');

    specs.push({
      key: `player:${player.id}`,
      sig,
      build: () => {
        const chip = document.createElement('button');
        chip.className = 'player-chip';
        if (isMe) chip.classList.add('me');
        if (viewingPlayerId === player.id) chip.classList.add('viewing');
        if (player.hp <= 0) chip.classList.add('dead');

        chip.innerHTML =
          `<span class="player-chip-avatar${avatar ? ' has-image' : ''}">` +
          (avatar ? `<img src="${avatar}" alt="" loading="lazy" />` : '') +
          '</span>' +
          '<span class="player-chip-main">' +
          `<span class="player-chip-name">${escapeHtml(player.name)}${isMe ? '（你）' : ''}</span>` +
          `<span class="player-chip-meta">${metaParts.join(' · ')}</span>` +
          /*
            ★★ 0.3：他这一局选的盟约。点一下看效果（要 stopPropagation，
            否则会连带触发外层"看他的棋盘"）。
          */
          (covenant
            ? // ★ 0.3：徽章**只显示盟约头像**（名字和效果点开弹窗看）
              `<span class="player-covenant" title="${escapeHtml(covenant.patron)} · ${escapeHtml(covenant.name)}" style="background-image:url('${covenantAvatarPath(covenant.id)}')"></span>`
            : '') +
          '</span>' +
          `<span class="player-chip-hp ${hpClass}">${hpText}</span>`;

        chip.title = title;

        const covenantBadge = chip.querySelector<HTMLElement>('.player-covenant');
        if (covenantBadge) {
          covenantBadge.addEventListener('click', (event) => {
            // ★ 别让它冒泡到 chip 上（那是"看他的棋盘"）
            event.stopPropagation();
            showCovenantInfo(player.covenantId);
          });
        }

        chip.addEventListener('click', () => {
          if (!spectatable) {
            if (!isMe) toast('只有布阵阶段才能看别人的棋盘', true);
            return;
          }
          setViewingPlayer(isMe ? null : player.id);
          renderAll();
        });
        return chip;
      },
    });
  }

  if (hpHidden) {
    const text = `最后 ${BLIND_HP_LAST_SECONDS} 秒不显示血量`;
    specs.push({
      key: '#hint',
      sig: text,
      build: () => {
        const note = document.createElement('span');
        note.className = 'player-chip-sub';
        note.textContent = text;
        return note;
      },
    });
  }

  renderKeyed(el.playerStripList, specs, {
    key: (spec) => spec.key,
    sig: (spec) => spec.sig,
    build: (spec) => spec.build(),
    ns: 'players',
  });

  el.btnBackMyBoard.classList.toggle('hidden', viewingPlayerId === null);
}

/** 切换"在看谁的棋盘"。null = 回自己的 */
function setViewingPlayer(playerId: string | null): void {
  if (viewingPlayerId === playerId) return;
  viewingPlayerId = playerId;
  /*
    ★ 这里必须**真的把旧棋子从场上摘掉**，不能只把计划清空。
    【为什么？—— 这是"看完别人棋盘回来，对面卡面还留在我棋盘上"的根因】
    原来的写法是 `lastSpritePlan = []`，指望"计划为空 -> 下次同步时
    旧棋子都算 removed -> 被删掉"。但 syncPrepSprites 是靠
    `diffPrepSprites(上一次的计划, 这一次的计划)` 算出 removed 的，
    而上一次的计划已经被清成空数组 —— **diff 永远算不出任何 removed**，
    于是那些 500000+ 编号的"别人的棋子"就永久留在了棋盘上，
    直到下一次切视角或重开一局才消失。
    所以这里直接调 clearPrepSprites()：它会把 prepSprites 里每一个
    精灵都从 3D 图层 remove 掉并清空表，然后由调用方的 renderAll()
    按新的数据源重新摆一遍。多摆一次不算浪费，残留才是真 bug。
  */
  clearPrepSprites();
  closeUnitInfo();
  state.message =
    playerId === null
      ? '回到自己的棋盘'
      : `正在看 ${net.room?.players.find((p) => p.id === playerId)?.name ?? '别人'} 的阵容（布阵仍然是你自己的）`;
}

/**
 * 联机：把当前阵容静默同步给服务器。
 *
 * ============================================================
 *  ★ 这就是"删掉提交按钮"之后服务器怎么拿到阵容
 * ============================================================
 * 布阵是 60 秒定时制：时间一到，服务器直接拿**最后收到的那一份**开打。
 * 所以客户端要在每次阵容变化后把它推上去。
 *
 * 【两个必要的保护】
 *   1. **去重**：renderAll() 调用得很频繁，签名没变就不发 ——
 *      不然每秒几十条一模一样的消息，服务器和自己都白忙。
 *   2. **防抖**：连续操作（拖一下、连着买两个）只发最后一条。
 *      120ms 足够合并一次拖动了，又不会让"最后一秒才摆好"来不及发。
 *
 * 【为什么只在布阵阶段发？】
 * 战斗阶段服务器的 phase 是 battle，会回 WRONG_PHASE 错误弹提示。
 * 而且战斗中本来也不该改阵容（改的是备战席，不影响这一场）。
 *
 * ★ 0.0.3 藏品：发的是 `toSubmittedTeam(state)`，**不是**手拼的 `{defId, star, cell}`。
 *   以前那份手拼的漏了 `items`（而且没有 `sharedItems` / `playerContext`），
 *   于是联机里藏品全部失效 —— 界面显示"已装备"，打起来一点用没有。
 *   现在这一份和单机的 `toTeamSetup` 同源，装备一动签名就变、就会重发。
 */
function syncTeamToServer(): void {
  if (!netplayActive || !net.room) return;
  /*
    ★ 0.2：商店回合也要同步 —— 那段里玩家**能改阵容**（见 `canEditTeam`），
    如果这里还卡 `prep`，商店里刚摆好的阵容就上报不上去，
    开打时服务器用的还是上一份旧的（联机里就是"我明明换人了却没生效"）。
  */
  if (!canEditTeam(state.phase)) return;

  const submitted = toSubmittedTeam(state);
  const signature = JSON.stringify(submitted);
  if (signature === lastSyncedTeam) return;
  lastSyncedTeam = signature;

  window.clearTimeout(teamSyncTimer);
  teamSyncTimer = window.setTimeout(() => {
    if (!netplayActive || !net.room) return;
    net.submitTeam(submitted);
  }, 120);
}

// ============================================================
// 战斗
// ============================================================

/**
 * ★★ 0.3.2：**硬重连一次**（拿到服务器的全量快照）。
 *
 * 【为什么不"就地修"？】
 * 发现"我落后了整整一个回合"时，漏掉的通常是 `gameStarted` ——
 * 而那条消息在客户端会触发**回合结算**（收入 / 经验 / 商店刷新）。
 * 就地跳回合 = 这一回合的钱和经验永远拿不到，或者干脆重复领一次；
 * 走 `resumeState` 则是"服务器把它手上的那一份整体交给我"，账不会错。
 *
 * 【为什么要有冷却？】网络抖动时可能连着触发几次，
 * 连续重连会把正在看的战斗反复打断 —— 10 秒内只做一次。
 */
function requestHardResync(reason: string): void {
  if (!netplayActive || !net.room || !net.canResume) return;
  const now = Date.now();
  if (now - lastHardResyncAt < 10_000) return;
  lastHardResyncAt = now;
  console.warn(`[联机] 状态不同步（${reason}），拉一次全量快照`);
  toast('检测到与服务器不同步，正在重新同步…');
  net.retryResume();
}

function startBattle(): void {
  /*
    ★ 0.1.4：**开打的那一刻取消进行中的拖拽**。
    布阵时间到（或者按了回车）时，玩家手上很可能正拖着东西 ——
    尤其是**藏品**：拖动过程中它是跟着光标的浮层卡片，
    而战斗一开始右侧栏会重画、布局跟着变，鼠标一松就可能落在
    "删除藏品"那一下上（用户报的"藏品被意外清除"）。
    取消拖拽 = 东西回到原处（藏品本来就没离开过它的格子），
    也让之后的抬手彻底无效。棋子那一路同理（开打后不能再改阵容）。
  */
  cancelDrag();
  // ★ 0.0.3 测试沙盒：蓝方 vs 红方（两边都是玩家自己摆的阵容，没有"人机对手"）
  if (testSides) {
    startTestBattle();
    return;
  }

  /*
    ★ 0.3.4：开战前**自动补位**。
    人口没上满（备战席还有人、场上还有空位）时，把备战席的干员按
    「中心 · 后方」的顺序自动摆上去 —— 免得玩家因为忘了放人白输一场。
    ★ 必须放在 `canStartBattle` **之前**：原来一个都没放时会被"先把干员放上场再开战"
      挡住，那就永远轮不到自动补位。
  */
  const autoPlaced = autoFillBoardFromBench(state);
  if (autoPlaced > 0) {
    state.message = `开战前自动补位 ${autoPlaced} 名`;
    toast(`人口没上满 —— 已自动从备战席补上 ${autoPlaced} 名`);
    renderAll();
  }

  const check = canStartBattle(state);
  if (!check.ok) {
    toast(check.message, true);
    return;
  }

  /*
    ---- 联机模式 ----
    ★ 现在没有"提交阵容"这回事了：布阵是 60 秒定时制，
    阵容由 syncTeamToServer() 在你每次改动后自动同步上去。
    这个按钮在联机里已经隐藏（见 renderAll），所以走到这里基本只有
    键盘快捷键那一条路 —— 那就顺手把阵容再推一次，然后告诉玩家在等什么。
  */
  if (netplayActive) {
    syncTeamToServer();
    toast('布阵中：改动会自动同步，时间到自动开打');
    return;
  }

  // ---- 单机模式：本地模拟 ----
  const playerTeam = toTeamSetup(state);
  const enemyTeam = pickOpponent(state);
  /*
    ★★ 0.1.2 修（用户报的"随机不够随机"）：
      · 种子必须**混进回合号**，否则棋盘不动时每回合的战斗随机序列完全相同
        （生还者合约抽谁、铳骑之威掉金…每回合都一样）；
      · 而且**不能再把战斗种子写回 `state.seed`** —— `state.seed` 是"这一局的种子"
        （人机对手阵容 `enemyPlacementsForRound(round, seed)`、野怪掉落骰子都读它），
        以前被战斗种子覆盖，等于"我改一下自己的棋盘，对手和掉落也跟着变"。
  */
  const seed = seedForBattle(seedFromTeam(playerTeam), state.round);

  const battleState: BattleState = createBattle(UNIT_DEFS, [playerTeam, enemyTeam], seed);
  // statsTimeline：让详情页显示「此刻的真实数值」（任何 buff/debuff 都算）
  const result = simulate(UNIT_DEFS, [playerTeam, enemyTeam], seed, { statsTimeline: true });
  currentResult = result;

  currentNames = {};
  playerTeam.units.forEach((u, i) => {
    currentNames[i + 1] = UNIT_DEFS[u.defId]?.name ?? u.defId;
  });
  enemyTeam.units.forEach((u, i) => {
    /*
      ★ 0.2：野怪统一叫「野怪」（用户口径：打野怪时不显示具体名字）。
      干员仍然带「敌·」前缀 —— 那个前缀是用来区分敌我的，有用。
    */
    const def = UNIT_DEFS[u.defId];
    currentNames[1000 + i + 1] = def?.monsterOnly ? displayNameOf(u.defId) : `敌·${def?.name ?? u.defId}`;
  });

  clearPrepSprites();
  // ★ 0.0.3：把双方的装备交给播放器（画棋子血条左边那两个小圆点）。
  // 必须在 replay.load 之前 —— load 会重建全部精灵，那时就要知道各装了几件
  applyBattleItems(playerTeam, enemyTeam);
  replay.load(battleState, result);
  replay.setSpeed(state.playbackSpeed);
  logCursor = 0;
  resetTraitLog();
  el.log.innerHTML = '';
  // 单机时自己在左半边，永远是队伍 0。
  // 必须显式赋值：上一局可能打过联机、myTeam 还留着 1，那样统计会去数对面的人。
  myTeam = 0;
  // ★ 0.3.5：单机也记账本 —— 回合结算只认账本（统一口径，别再分两条路）
  rememberMyBattle({ battleId: 'solo', myTeam: 0, winner: result.winner, result });
  // 名单从日志里的 spawn 事件长出来（都在 t=0），所以算到 tick 0 就有全部我方干员
  rebuildStatsToTick(0);
  renderDamageStats();
  paused = false;

  state.phase = 'battle';
  state.playbackSeconds = 0;
  // ★ 0.3.4：种子只是调试读数，正常玩不写进状态栏（见 SHOW_DEBUG_INFO）
  state.message = SHOW_DEBUG_INFO ? `战斗开始（种子 ${seed}）` : '战斗开始';
  el.battleBar.classList.remove('hidden');

  console.log(`[失序协议] 战斗 seed=${seed} checksum=0x${result.checksum.toString(16)} ticks=${result.ticks}`);
  renderAll();
}

/**
 * ★ 0.0.3 测试沙盒：让蓝方（左半场）和红方（右半场）互相对打。
 *
 * 【和单机 / 联机的区别】
 *   单机：玩家 vs 人机（pickOpponent 生成）
 *   联机：玩家 vs 玩家（服务器配对 + 下发）
 *   沙盒：**两边都是玩家自己摆的** —— 直接各转一个 TeamSetup，本地模拟。
 *
 * 种子由两边阵容一起推出来（同样的摆法永远打出同一场），方便反复调同一个局面。
 */
function startTestBattle(): void {
  if (!testSides) return;
  if (state.phase !== 'prep') {
    toast('战斗进行中', true);
    return;
  }
  const [blue, red] = testSides;
  if (blue.placements.length === 0 || red.placements.length === 0) {
    toast('蓝方和红方都要至少放一个干员才能开打', true);
    return;
  }

  const team0 = toTeamSetup(blue, 0);
  const team1 = toTeamSetup(red, 1);
  // 两个阵容一起决定种子（用 FNV 常数打散，避免 "A===B 时异或成 0"）
  // ★ 0.1.2：沙盒也一样 —— 混进回合号，不然同一套摆法每回合打出完全相同的随机序列
  const seed = seedForBattle(
    (seedFromTeam(team0) ^ Math.imul(seedFromTeam(team1), 0x9e3779b1)) >>> 0,
    state.round,
  );

  const battleState: BattleState = createBattle(UNIT_DEFS, [team0, team1], seed);
  const result = simulate(UNIT_DEFS, [team0, team1], seed, { statsTimeline: true });
  currentResult = result;

  currentNames = {};
  team0.units.forEach((u, i) => {
    currentNames[i + 1] = UNIT_DEFS[u.defId]?.name ?? u.defId;
  });
  team1.units.forEach((u, i) => {
    // ★ 0.2：沙盒里也可能摆野怪 —— 同样只显示「野怪」
    const def = UNIT_DEFS[u.defId];
    currentNames[1000 + i + 1] = def?.monsterOnly ? displayNameOf(u.defId) : `红·${def?.name ?? u.defId}`;
  });

  clearPrepSprites();
  /*
    防御性：万一之前打过联机、视角还翻着（viewFlipped=true），
    沙盒里必须强制翻回来 —— 否则棋盘左右会和"蓝方在左"的约定对不上。
  */
  setViewFlipped(false);
  board.setHalfTint(false);
  replay.setFlip(false);
  // ★ 0.0.3：两边沙盒阵容的装备都要交给播放器（见 applyBattleItems）
  applyBattleItems(team0, team1);
  replay.load(battleState, result);
  replay.setSpeed(state.playbackSpeed);
  logCursor = 0;
  resetTraitLog();
  el.log.innerHTML = '';
  // 沙盒里"我"是蓝方 = 队伍 0
  myTeam = 0;
  // ★ 0.3.5：沙盒同样走账本（蓝方视角）
  rememberMyBattle({ battleId: 'sandbox', myTeam: 0, winner: result.winner, result });
  rebuildStatsToTick(0);
  renderDamageStats();
  paused = false;

  state.phase = 'battle';
  state.playbackSeconds = 0;
  // ★ 0.3.4：同上 —— 种子只在 ?debug=1 下显示
  state.message = SHOW_DEBUG_INFO
    ? `测试对战：蓝方 ${team0.units.length} vs 红方 ${team1.units.length}（种子 ${seed}）`
    : `测试对战：蓝方 ${team0.units.length} vs 红方 ${team1.units.length}`;
  el.battleBar.classList.remove('hidden');

  console.log(
    `[失序协议] 测试对战 seed=${seed} checksum=0x${result.checksum.toString(16)} ticks=${result.ticks} 蓝=${team0.units.length} 红=${team1.units.length}`,
  );
  renderAll();
}

/** 停留在结算画面多久之后自动进入下一回合（毫秒） */
const RESULT_PAUSE_MS = 2600;

/**
 * 战斗播完。
 *
 * 【这里不再弹窗】
 * 以前会弹一个结算浮层、要玩家点「继续下一回合」。
 * 但自走棋的回合很密集（一局二三十回合），每回合都点一下很烦。
 * 现在改成：在屏幕中间显示一个短暂的结算横幅，2.6 秒后**自动进入下一回合**，
 * 玩家的手可以一直放在键盘上摆阵容。
 *
 * 联机对局不走这里 —— 回合什么时候结束由服务器决定。
 */
function finishBattle(): void {
  if (!currentResult || state.phase === 'result') return;

  // ★ 0.1.2：我这一场收过尾了。showBattle / 观战逻辑靠它判断"还要不要回自己那场"。
  myBattleDone = true;
  state.phase = 'result';
  state.result = {
    winner: currentResult.winner,
    ticks: currentResult.ticks,
    checksum: currentResult.checksum,
    hpBpTeam0: currentResult.hpBpTeam0,
    hpBpTeam1: currentResult.hpBpTeam1,
  };

  const winner = currentResult.winner;
  /** ★ 0.0.3：沙盒里"我"就是蓝方（队伍 0） */
  const sandbox = testSides !== null;

  /*
    ★★★ 0.3.5：**"我赢了没有"只问我自己的账本。**
    以前这里读 `didIWin(winner, myTeam)` —— 那两个都是"屏幕上这一场"的口径，
    而且 `myTeam` 在看别人的对局时会被算成 0，于是"我赢了"可能被判成输：
    横幅写「战败」、连胜被清零（用户报的"赢了却扣血断连胜"）。
    账本里服务端发来的胜负优先，所以横幅上写的和解说与血量/战绩永远同源。
    ★ 万一账本还没来得及建立（理论上不会：自己那场开播时就记了），
      退回本地重放的结果，并且**不改**账本 —— 免得用错口径覆盖掉正确的那一份。
  */
  const recorded =
    netplayActive && currentBattleId && myBattle && myBattle.battleId !== currentBattleId ? null : myBattle;
  const recordWon = recorded ? wonOf(recorded) : null;
  const iWon = recordWon !== null ? recordWon : sandbox ? winner === 0 : didIWin(winner, myTeam) === true;

  /*
    血量结算：规则本身在 localHpLossForRound 里（纯函数、有测试）。
    ★ 联机时它返回 0 —— 联机血量以服务器为准，本地再扣一次就等于一局扣两倍。
    ★ 沙盒：扣到**输的那一侧**头上，而且**最低扣到 1** —— 沙盒是拿来反复试棋子的，
      不该因为"某一方血扣光了"就结束对局。
  */
  let hpLoss = 0;
  if (testSides) {
    if (winner !== null) {
      // 借 localHpLossForRound 拿"这回合该扣多少血"（它内部就是 damageForRound）
      hpLoss = localHpLossForRound({ winner: 1, round: state.round, netplay: false });
      const loser = winner === 0 ? testSides[1] : testSides[0];
      loser.economy.hp = Math.max(1, loser.economy.hp - hpLoss);
    }
  } else {
    hpLoss = localHpLossForRound({ winner, round: state.round, netplay: netplayActive });
    if (hpLoss > 0) {
      state.economy.hp = Math.max(0, state.economy.hp - hpLoss);
    }
    /*
      ★★ 0.3 单机盟约「重生疗法」：每累计赢 `perWins` 场回 `heal` 点血。
      和联机 `Room.applyCovenantWinHeal` **同一套判定**（`wins % perWins === 0`），
      只是账本在本地：这一局的胜场数自己数。
      ★ 联机不进这个分支（上面 `localHpLossForRound` 在联机返回 0，血由服务端算）——
        两边都回就成了双倍。
    */
    /*
      ★★ 0.3.1 修：野怪回合**不计入**「重生疗法」的胜场（描述里写明）。
      以前只要 `iWon` 就 +1，于是打野怪也算"赢 2 场回 3 血"，
      实际恢复速度比卡面写的快一大截。和服务端 `applyGhostResult(...,
      { countsForCovenant: false })` 是同一个口径。
    */
    if (iWon && !isMonsterRound(state.round)) {
      singlePlayerCovenantWins++;
      const healRule = covenantWinHeal(state.covenantId);
      if (healRule && healRule.perWins > 0 && singlePlayerCovenantWins % healRule.perWins === 0) {
        /*
          上限 = 单机开局血量（`economy.startHp`，默认 100）+ 这个盟约自己的加血。
          ★ 和联机 `Room.applyCovenantWinHeal` 同一个口径（那边是 settings.startHp + 加成）——
            上限写死 100 的话，带了加血盟约就永远回不到满血。
          ★★ 0.3.31：走 `playerMaxHp` 这个唯一口径，别再在这儿自己拼 100。
        */
        const maxHp = playerMaxHp(state.economy.startHp, state.covenantId);
        state.economy.hp = Math.min(maxHp, state.economy.hp + healRule.heal);
        toast(
          `盟约「${covenantOf(state.covenantId)?.name ?? ''}」：${singlePlayerCovenantWins} 胜，回 ${healRule.heal} 点血`,
        );
      }
    }
  }

  // 统计输出，让玩家知道是谁在扛
  let playerDamage = 0;
  let enemyDamage = 0;
  for (const event of currentResult.log) {
    if (event.type !== 'damage') continue;
    if (event.sourceId < 1000) playerDamage += event.amount;
    else enemyDamage += event.amount;
  }
  const sideA = sandbox ? '蓝方' : '我方';
  const sideB = sandbox ? '红方' : '敌方';

  const title = sandbox
    ? winner === null
      ? '平局'
      : winner === 0
        ? '蓝方胜利'
        : '红方胜利'
    : winner === null
      ? '平局'
      : iWon
        ? '胜利'
        : '战败';
  const tone = winner === null ? 'draw' : iWon ? 'win' : 'lose';
  const hpText =
    hpLoss <= 0
      ? ''
      : sandbox
        ? ` · <span style="color:var(--danger)">败方生命 -${hpLoss}</span>`
        : ` · <span style="color:var(--danger)">生命 -${hpLoss}</span>`;
  /*
    ★ 0.3.4：横幅上只留玩家看得懂的（用时 / 剩余血量 / 双方输出）。
    `校验和 0x…` 是排查确定性问题用的调试读数，默认不显示 ——
    只有 `?debug=1` 才跟在最后（见 SHOW_DEBUG_INFO 的说明）。
  */
  const debugLine = SHOW_DEBUG_INFO
    ? `<br /><span class="mono" style="font-size:11px;opacity:0.65">校验和 0x${currentResult.checksum.toString(16).toUpperCase()} · 种子 ${state.seed}</span>`
    : '';
  showResultBanner(
    title,
    tone,
    `用时 ${(currentResult.ticks / TICKS_PER_SECOND).toFixed(1)} 秒 · 剩余血量 ${(currentResult.hpBpTeam0 / 100).toFixed(0)}% vs ${(currentResult.hpBpTeam1 / 100).toFixed(0)}%` +
      hpText +
      `<br /><span class="mono" style="font-size:11px;opacity:0.65">${sideA}输出 ${(playerDamage / 1000).toFixed(0)} · ${sideB}输出 ${(enemyDamage / 1000).toFixed(0)}</span>` +
      debugLine,
    { en: tone === 'win' ? 'VICTORY' : tone === 'lose' ? 'DEFEAT' : 'DRAW' },
  );

  renderAll();

  /*
    ★ 战斗结束了：收掉"战斗中才成立"的那几样东西。

    【为什么必须收？】
    它们的数据源是回放层（replay）。战斗一结束，回放就停在最后一帧，
    但**面板还在**：你会看到一个已经死掉的棋子挂着 0 血、
    技能条停在某个数字上不动 —— 那是假信息，比没有更糟。
    "VS 对手名"同理，战斗条都收起来了，它留在那儿没有上下文。
  */
  closeUnitInfo();
  el.battleOpponent.classList.add('hidden');

  /*
    ---- 联机：告诉服务器「我看完了」----

    ★ 这条消息是"双端不同步 / 战斗被跳过"的根治办法。
    以前服务器是按"这场战斗打了多少秒"硬等一个时间就进下一回合，
    但客户端的回放**不一定和墙钟一样快**：
      · 主循环把单帧步长 cap 在 0.05 秒，帧率低于 20fps 时回放就会变慢；
      · 切到别的窗口，浏览器会把 requestAnimationFrame 降频甚至暂停。
    慢的那台还在打，下一回合的通知就到了 —— 回放被清掉，战斗看起来"被跳过"。

    现在改成"谁播完谁举手"，服务器收齐了才推进。
    必须在**本地回放真正结束的这一刻**发，而不是提前估算。
  */
  if (netplayActive && currentResult && currentBattleId) {
    net.playbackDone(currentBattleId);
  }

  /*
    ---- 自动进入下一回合 ----
    规则在 shouldClientAdvanceRound() 里（纯函数、有测试）：
    **联机永远不自己推进**（包括这一局已经打完的情况），
    免得客户端自己开一局单机、冒出一个人机阵容。
  */
  /*
    ★ 0.0.3：沙盒里血量最低只有 1，永远不会"归零结束" ——
    所以直接按"播完了 + 还在游戏界面"推进，不走 shouldClientAdvanceRound 的 hp 判断。
  */
  const shouldAdvance = testSides
    ? state.phase === 'result' && currentView === 'game'
    : shouldClientAdvanceRound({
        netplay: netplayActive,
        hp: state.economy.hp,
        phase: state.phase,
        onGameView: currentView === 'game',
      });
  if (shouldAdvance) {
    window.clearTimeout(nextRoundTimer);
    nextRoundTimer = window.setTimeout(() => {
      // 期间玩家可能已经返回主界面了，这时候不能再推进回合
      if (state.phase !== 'result' || currentView !== 'game') return;
      nextRound();
    }, RESULT_PAUSE_MS);
    return;
  }

  if (netplayActive && state.economy.hp <= 0) {
    // 联机里血被打空：服务器马上会判定游戏结束，这里先把话说清楚
    state.message = '你的生命值归零了，等服务器结算…';
    renderAll();
    return;
  }

  /*
    联机：等服务器通知下一回合。
    这期间明确告诉玩家"在等什么"，不然画面停在战斗结束那一刻，看起来像卡住了。
  */
  state.message = netplayMatchOver ? '这一局结束了' : '战斗结束，等这一轮其他人打完…';
  renderAll();
}

/**
 * 显示中间的结算横幅（会自动消失）。
 *
 * ★ 0.3.5 改版：从"中间一块方卡片"改成**横向通栏**（用户口径：符合游戏风格）。
 *   结构 = 左侧竖色条 + 标题（中文大号 + 英文小标注）+ 右侧系统读数。
 *   颜色仍然守项目的语汇：胜 = 荧光黄绿（系统高亮那条色），败 = 红（警示），
 *   平 = 灰；不给整块背景上色，只给一根 3px 的竖条和一条 1px 的收尾细线。
 *
 * @param opts.en     英文副标题（VICTORY / DEFEAT / DRAW …）
 * @param opts.holdMs 停留时长（默认跟着 `RESULT_PAUSE_MS`，联机结算页可以给长一点）
 */
function showResultBanner(
  title: string,
  tone: 'win' | 'lose' | 'draw',
  detail: string,
  opts: { en?: string; holdMs?: number } = {},
): void {
  // 同一时刻只留一条（连点 / 一个回合里连续两次结算都不会堆叠）
  document.querySelectorAll('.result-banner').forEach((node) => node.remove());

  const banner = document.createElement('div');
  banner.className = `result-banner ${tone}`;
  banner.innerHTML =
    '<div class="result-banner-rail"></div>' +
    '<div class="result-banner-main">' +
    `<div class="result-banner-title">${title}` +
    (opts.en ? `<span class="result-banner-en">${opts.en}</span>` : '') +
    '</div>' +
    '</div>' +
    `<div class="result-banner-detail">${detail}</div>`;
  document.body.appendChild(banner);

  const holdMs = Math.max(600, opts.holdMs ?? RESULT_PAUSE_MS - 400);
  // 淡入（下一帧再加 .show，确保 transition 真的跑起来）
  requestAnimationFrame(() => banner.classList.add('show'));
  // 停留后淡出并移除
  window.setTimeout(() => {
    banner.classList.remove('show');
    window.setTimeout(() => banner.remove(), 400);
  }, holdMs);
}

// ============================================================
// ★ 0.1.1：联机对局结算页
// ============================================================

/**
 * ============================================================
 *  联机对局结算页
 * ============================================================
 *
 * 【布局结构（自上而下三段，中间那段自己滚）】
 *   ┌ 顶部摘要 ─────────────────────────────────────────────┐
 *   │  左：标题（你赢了 / 对局结束）+ 副标题（回合数 · 冠军 · 玩家人数）│
 *   │  右：本局伤害最高的干员（全局最高，金色高亮）              │
 *   ├ 玩家排名列表（滚动）────────────────────────────────────┤
 *   │  第 1 名（冠军，金色边框）                                │
 *   │    ├ 行 1：名次徽章 + 头像 + 名字 + 关键信息（等级/血量/胜负/淘汰回合）│
 *   │    ├ 行 2：死亡时的阵容（按费用从低到高，每张：名字 + 费用 + 星级）   │
 *   │    ├ 行 3：激活的羁绊（羁绊色 + 名字 + 生效档位）           │
 *   │    └ 行 4：本玩家本局伤害最高的干员 + 伤害量 / 总伤害        │
 *   │  第 2 名 …（同样四行）                                    │
 *   ├ 底部 ─────────────────────────────────────────────────┤
 *   │  说明文字（数据来自服务器）+ 「收起」按钮                   │
 *   └───────────────────────────────────────────────────────┘
 *
 * 【数据全部来自服务器（gameOver.standings）】
 * 客户端一个字都不自己算 —— 排名、阵容、羁绊、伤害都是服务器算好的，
 * 所以 8 台机器上的结算页**逐字节一致**，不会出现"我这里他排第三"。
 *
 * 【为什么不复用那个会自动消失的横幅？】
 * 横幅是"看一眼就没了"的提示，而结算页是**要让人慢慢看**的：
 * 8 个人的阵容 + 羁绊 + 伤害，信息量大得多。所以做成一个可滚动的浮层，
 * 关掉之后还能继续看棋盘（右上角的「收起」）。
 */
function renderResultPage(payload: Extract<ServerMessage, { t: 'gameOver' }>): void {
  const standings = payload.standings ?? [];
  const iWon = payload.winnerId === net.playerId;

  // 文案沿用原来那条横幅的说法（'你赢了！' / '游戏结束'），免得玩家觉得界面变了
  el.resultTitle.textContent = iWon ? '你赢了！' : '游戏结束';
  el.resultSub.textContent =
    `共 ${payload.rounds} 回合 · ${standings.length} 位玩家 · 冠军 ${payload.winnerName}`;

  /*
    全局的"本局伤害最高的干员"：把所有玩家的 topUnit 拿过来比一比。
    （每张玩家卡里还有一份**他自己的**最高伤害，那一份回答的是
      "他这一局谁最能打"；这里回答的是"全场之最"。）
  */
  let best: { name: string; defId: string; star: number; dealt: number } | null = null;
  for (const player of standings) {
    const top = player.topUnit;
    if (!top) continue;
    if (!best || top.dealt > best.dealt) {
      best = { name: player.name, defId: top.defId, star: top.star, dealt: top.dealt };
    }
  }
  el.resultMvp.textContent = best
    ? `${best.name} · ${UNIT_DEFS[best.defId]?.name ?? best.defId} — ${dmg(best.dealt)}`
    : '本局没有人打出伤害';

  el.resultList.innerHTML = '';
  for (const player of standings) el.resultList.appendChild(buildResultCard(player));
  el.resultList.scrollTop = 0;

  el.resultPage.classList.remove('hidden');

  /*
    ★ 0.3.5：**这里刻意不再弹横幅。**
    之前试过在结算页上面再盖一条「冠军 / 第 N 名」的横幅，但战绩页本身就是
    "胜利 / 战败"的最终表达，横幅压上去会挡住第 2、3 名的卡片两三秒 ——
    1280 高的窗口上尤其明显。
    每回合结束那条「胜利 / 战败」横幅（`finishBattle`）才是用户要的那个，
    这里把舞台留给战绩页。
  */
}

/** 收起结算页（还能继续看棋盘；真要离开房间点左上角的「← 返回」） */
function hideResultPage(): void {
  el.resultPage.classList.add('hidden');
}

/** 结算页里"一位玩家"的那张卡 */
function buildResultCard(player: PlayerStanding): HTMLElement {
  const card = document.createElement('div');
  card.className = `result-card${player.rank === 1 ? ' champion' : ''}`;

  const avatar = avatarPathOf(player.avatarId);
  const meta = [
    `Lv${player.level}`,
    player.hp > 0 ? `剩 ${player.hp} 血` : '生命归零',
    `${player.wins} 胜 ${player.losses} 负`,
    player.eliminatedRound === null ? '存活到最后' : `第 ${player.eliminatedRound} 回合被淘汰`,
  ].join(' · ');

  /*
    阵容：**服务器已经按费用从低到高排好**，这里只负责画。
    每张棋子显示"名字 + 费用 + 星级" —— 费用是排序依据，写出来玩家才看得懂顺序；
    左侧那根竖线用稀有度色（和商店卡一致），扫一眼就知道高费卡在哪。
  */
  const lineup = player.lineup
    .map((unit) => {
      const def = UNIT_DEFS[unit.defId];
      const rarity = def ? rarityOfCost(def.cost) : null;
      const stars = def?.noStar ? '' : '★'.repeat(unit.star);
      return (
        `<span class="result-unit" style="border-left-color:${rarity?.base ?? '#888'}">` +
        `<span>${escapeHtml(def?.name ?? unit.defId)}</span>` +
        (def ? `<span class="result-unit-cost">${def.cost} 费</span>` : '') +
        (stars ? `<span class="result-unit-star">${stars}</span>` : '') +
        `</span>`
      );
    })
    .join('');

  // 羁绊：只画**已激活**的（服务器已经过滤过），左边一竖条是羁绊自己的颜色
  const traits = player.traits
    .map(
      (trait) =>
        `<span class="result-trait" style="border-left:3px solid ${traitColor(trait.traitId)}">` +
        `<span>${escapeHtml(TRAIT_DEFS[trait.traitId]?.name ?? trait.traitId)}</span>` +
        `<span class="result-trait-tier">${trait.activeAt} 档</span>` +
        `</span>`,
    )
    .join('');

  const top = player.topUnit;
  const topText = top
    ? `<strong>${escapeHtml(UNIT_DEFS[top.defId]?.name ?? top.defId)}</strong>` +
      (UNIT_DEFS[top.defId]?.noStar ? '' : `<span class="result-unit-star"> ${'★'.repeat(top.star)}</span>`) +
      ` — <strong style="color:var(--gold)">${dmg(top.dealt)}</strong>`
    : '<span class="result-empty">本局没有造成伤害</span>';

  card.innerHTML =
    `<div class="result-card-head">` +
    `<span class="result-rank r${player.rank}">${player.rank}</span>` +
    `<span class="result-avatar">${avatar ? `<img src="${avatar}" alt="" loading="lazy" />` : ''}</span>` +
    `<span>` +
    `<div class="result-name">${escapeHtml(player.name)}</div>` +
    `<div class="result-meta">${meta}</div>` +
    `</span>` +
    (player.playerId === net.playerId ? '<span class="result-mine">你</span>' : '') +
    `</div>` +
    `<div class="result-sec">` +
    `<div class="result-sec-title">${
      player.eliminatedRound === null ? '最终阵容（按费用从低到高）' : '死亡时的阵容（按费用从低到高）'
    }</div>` +
    `<div class="result-lineup">${lineup || '<span class="result-empty">没有上场干员</span>'}</div>` +
    `</div>` +
    `<div class="result-sec">` +
    `<div class="result-sec-title">激活羁绊</div>` +
    `<div class="result-traits">${traits || '<span class="result-empty">没有激活的羁绊</span>'}</div>` +
    `</div>` +
    `<div class="result-sec">` +
    `<div class="result-sec-title">本局最高伤害（该玩家）· 总计 ${dmg(player.totalDamage)}</div>` +
    `<div>${topText}</div>` +
    `</div>`;

  return card;
}

/**
 * 继续下一回合：发钱、清空战斗表现、回到布阵。
 *
 * 【注意：棋子留在场上不收回】
 * 自走棋的阵容是跨回合保留的，玩家每回合只需要微调。
 * 所以这里只清战斗演出，不动阵容。
 */
/**
 * 继续下一回合：发钱、自动刷新商店、清空战斗表现、回到布阵。
 *
 * 【注意：棋子留在场上不收回】
 * 自走棋的阵容是跨回合保留的，玩家每回合只需要微调。
 * 所以这里只清战斗演出，不动阵容。
 *
 * 【商店自动刷新和「锁定」都在 advanceRound 里处理】
 * 那是回合规则的一部分，不放在界面代码里 ——
 * 免得以后换界面或者搬到服务端时漏掉。
 */
/**
 * 从上一场战斗里统计出「我方还有哪些干员活着」。
 *
 * 【为什么需要它？】
 * 奸商羁绊要按"活下来的奸商"给钱，所以要能从战斗日志里反推出名单。
 * 日志里的 `death` 事件带的是 unitId（按上阵顺序编的），
 * 用 `survivorsOfTeam()` 映射回 defId。
 *
 * ★ `team` 必须传**我所在的队**。原来单机的 `nextRound()` 写死 0，
 * 那在单机是对的（玩家永远是队伍 0），但联机时我被分到队伍 1 就全错了 ——
 * 会把"敌方活下来的人"当成我活下来的干员。
 */
function survivorsFromLastBattle(): Set<string> | undefined {
  // ★★ 0.3.5：读**我这一场**的账本，不读屏幕上那一场（观战会把它换掉）
  const result = myBattle?.result ?? null;
  if (!result) return undefined;
  const team = teamOf(myBattle, 0);
  const dead = new Set<number>();
  for (const event of result.log) {
    if (event.type === 'death') dead.add(event.unitId);
  }
  return survivorsOfTeam(
    state.placements.map((p) => ({ defId: p.defId, star: p.star, cell: { col: p.cell.col, row: p.cell.row } })),
    dead,
    team,
  );
}

/**
 * 上一场战斗我赢了没有。
 *
 * ★ 同样不能用 `winner === 0`：那等于"只有我在左边才算赢"。
 * 联机时我可能被分到队伍 1，输赢正好会反过来。
 */
function lastBattleWon(): boolean | null {
  /*
    ★★ 0.3.5：只认"我这一场"的账本。
    以前读 `currentResult.winner === myTeam` —— 那两个都是**屏幕上那一场**的口径，
    只要你在回合切换前还在看别人的对局，胜负就会算反（用户报的
    "输了不扣血 / 赢了扣血断连胜"）。账本里服务端的胜负优先，所以和血量/战绩同源。
  */
  return wonOf(myBattle);
}

/**
 * ★★ 0.2 MujicaAve：上一场战斗里**我这一队**攒到了多少 fever。
 *
 * 【为什么不直接数事件？】"受到攻击 +1 / 造成伤害 +1"要看的是**这一队有没有那条羁绊**，
 * 而事件日志里没有这个信息 —— 内核在真正发生的那一刻就数好了，放在
 * `BattleResult.feverGained[队伍号]` 里交出来。
 *
 * ★ 和 `lastBattleWon` 两个同样的坑：必须用 `myTeam`（联机时我可能在右边），
 *   而且必须在 `currentResult` 被清掉**之前**调用（旁观别人的战斗不算）。
 */
function feverGainedThisBattle(): number {
  // ★ 0.3.5：账本口径（观战别人的战斗不算我的 fever）
  const gained = myBattle?.result.feverGained;
  if (!gained) return 0;
  return gained[teamOf(myBattle, 0)] ?? 0;
}

/**
 * ★ 0.0.3 藏品：上一场战斗里**我这一队**掉了多少金币。
 *
 * 【为什么不能恒用队伍 0？】
 * 掉金是**概率触发**的（铳骑之威击杀掉金 / 黄沙罗盘阵亡掉金），
 * 只有战斗里掷完骰子才知道，内核算好之后记成了 `gold` 事件。
 * 那个事件带 `team` 字段，所以必须拿 `myTeam` 去数 ——
 * 写死 0 的话，联机时被分到队伍 1 的玩家永远拿不到自己的战利品。
 *
 * ⚠️ 必须在 `currentResult` 被清掉**之前**调用（同 lastBattleWon）。
 *
 * 【为什么旁观时不算？】
 * 服务器把这一回合的**每一场**都广播给全房间（4 人时会收到 2 条），
 * 旁观别人的战斗时我屏幕上的 `currentResult` 是**别人的**那一场，
 * `myTeam` 也被改成了"我在这场"（见 battleStart 里那句赋值）。
 * 不挡一下的话，旁观者会替别人把战利品领了。
 */
function lastBattleGold(): number {
  /*
    ★ 0.3.5：账本口径。
    以前这里靠 `spectating` 挡"别替别人领战利品"，但 `spectating` 是**画面**状态，
    它和"结算的是哪一场"没有必然关系（比如你打完自己的再去看别人，
    `spectating` 就一直是 true，结果自己的战利品反而领不到）。
    现在账本本身就只会是"我自己那一场"，不需要再靠画面状态猜。
  */
  if (!myBattle) return 0;
  return battleGoldOf(myBattle.result.log, teamOf(myBattle, 0));
}

/**
 * 上一场战斗里**我打死了哪些野怪**（掉落与掉落日志都按它算）。
 *
 * ⚠️ 必须在 `currentResult` 被清掉**之前**调用（同 lastBattleWon）。
 * 旁观别人的战斗时不算 —— 那不是在打野怪，是在看别人打。
 */
function monstersKilledLastBattle(): { defId: string; tick: number }[] {
  if (!myBattle) return [];
  return monstersKilledBy(myBattle.result.log, teamOf(myBattle, 0));
}

/**
 * ★ 0.1.1 藏品二版：上一场战斗我**打死了几个非野怪敌人**（仇名录的成长层数）。
 *
 * 【野怪回合为什么不在这里挡？】
 * 挡在 `applyItemGrowthAfterBattle` 里（那里能看到"正在结算的是哪个回合"）。
 * 这里只负责"从日志里数数"这一件事 —— 和 `monstersKilledLastBattle` 同一个套路：
 * ⚠️ 必须在 `currentResult` 被清掉**之前**调用。
 * 旁观别人的战斗时不算（那不是在替我打）。
 */
function enemiesKilledLastBattle(): number {
  if (!myBattle) return 0;
  return enemiesKilledBy(myBattle.result.log, teamOf(myBattle, 0));
}

/**
 * ★ 0.3.2 阿米娅升变任务：这一场**阿米娅（任意形态）**打了多少伤害。
 *
 * 走战斗日志的 per-unit 统计（`battle-stats.ts`），并且按**家族**归并 ——
 * 她这一场可能是 1 费本体，也可能已经升变成青色怒火 / 慈悲愿景 / 终曲，
 * 只查 `op07` 会漏掉升变之后的输出（表现为"升变完伤害就不涨了"）。
 *
 * 观战时不算：那不是"我"的回合，统计到别人身上就乱了。
 */
function amiyaDamageLastBattle(): number {
  if (!myBattle) return 0;
  return amiyaDamageFromLog(myBattle.result.log, teamOf(myBattle, 0));
}

/**
 * 把这一回合的野怪掉落写进战斗日志（一行一只怪）。
 *
 * 【为什么写进日志，而不是只在顶部闪一句？】
 * 掉落是概率的（小怪 45% 掉金、剩下 55% 才掉藏品）。
 * 只闪一句"掉了 XX"的话，玩家没法核对概率 —— 这一波几只怪、
 * 有几只掷空了，全都看不见。逐只写一行，掉率对不对一眼就能看出来。
 */
function appendDropLog(drop: MonsterDropResult | undefined, round: number): void {
  if (!drop || drop.kills.length === 0) return;
  const title = document.createElement('div');
  title.className = 'log-line drop-title';
  title.textContent = `◆ 第 ${round} 回合 · 野怪掉落（按击杀逐只结算）`;
  el.log.appendChild(title);
  for (const text of killDropLines(drop)) {
    const div = document.createElement('div');
    div.className = 'log-line drop';
    div.textContent = `   ${text}`;
    el.log.appendChild(div);
  }
  el.log.scrollTop = el.log.scrollHeight;
}

/**
 * ★ 0.2 MujicaAve：把 fever 跨档拿到的「宝藏」写成**显眼**的一段。
 *
 * 【为什么单独一块，而不是并进 `appendDropLog`？】
 *   · 野怪掉落是"每回合都可能有"的小东西（几金 / 一件藏品），一行行绿字就够；
 *   · fever 宝藏是**攒好几回合、一档一辈子只有一次**的大件（几十金 / 一堆藏品 / 一只干员），
 *     还经常和商店回合在同一帧 —— 混在掉落里会被后面的战斗日志直接顶出视野。
 * 所以给它一个金色标题块 + 逐条明细（样式见 styles.css 的 `.fever-treasure-*`）。
 *
 * ★ 不弹 toast：`nextRound` 紧接着会 toast "第 N 回合开始"，
 *   这里再 toast 一定被盖掉（而且日志已经够显眼了）。
 */
function appendFeverTreasureLog(treasure: FeverTreasureResult | null | undefined): void {
  if (!treasure) return;
  const title = document.createElement('div');
  title.className = 'log-line fever-treasure-title';
  title.textContent = `★ fever ${treasure.tier} 档宝藏 —— ${treasure.summary}`;
  el.log.appendChild(title);
  for (const line of treasure.lines) {
    const div = document.createElement('div');
    div.className = 'log-line fever-treasure';
    div.textContent = `   ${line}`;
    el.log.appendChild(div);
  }
  el.log.scrollTop = el.log.scrollHeight;
}

/**
 * 联机：进入新回合时结算上一回合的经济。
 *
 * 【联机和单机在这一步的区别】
 *   · 经济（金币 / 经验 / 商店）：**客户端自己算**，和单机完全一样
 *   · 血量：**服务器说了算**，这里一个字都不能碰（碰了就是一局扣两倍血）
 *   · 回合推进：服务器说了算，这里只做"进入这一回合"的准备
 */
function settleNetplayRound(): void {
  // 顺序很重要：先取上一场的存活名单、胜负、击杀名单，再交给 advanceRound
  const survivors = survivorsFromLastBattle();
  const killed = monstersKilledLastBattle();
  const killedEnemies = enemiesKilledLastBattle();
  const settled = advanceRound(
    state,
    lastBattleWon(),
    survivors,
    lastBattleGold(),
    killed,
    killedEnemies,
    // ★ 0.2 MujicaAve：这一场攒到的 fever（野怪回合内核也会数，但回合流程会跳过结算）
    feverGainedThisBattle(),
    // ★ 0.3.2 阿米娅升变任务：她这一场打了多少伤害
    amiyaDamageLastBattle(),
  );
  appendDropLog(settled.drop, settled.round);
  // ★ 0.2：fever 跨档的宝藏（显眼一块，跟在掉落后面）
  appendFeverTreasureLog(settled.feverTreasure);
}

/**
 * 单机：进入下一回合。
 */
function nextRound(): void {
  // 双保险：联机时回合由服务器推进，客户端不许自己开下一回合
  // （万一哪条路径漏了判断，这里也能挡住"莫名其妙开了一局单机"）
  if (netplayActive) return;

  /*
    ★ 上一场战斗的四样东西，**必须在 resetBoardAndPlayback() 之前取** ——
    它会把 `currentResult` 清成 null，之后再问就永远是"平局 / 没有存活 / 没有战利品"。

    【这里踩过一个真 bug】
    沙盒（testSides）那次改动把这个 reset 提到了函数开头，但只给沙盒分支补了
    "先取再清"，单机那条路还留在 reset 之后 —— 于是单机的 `won` **恒为 null**：
    野怪回合一件藏品都不掉（玩家连着几局 1、2 回合空手）、
    连胜/连败收入按"平局"算、奸商羁绊的存活名单也永远是空。
    现在四样都提前取，两条路共用。
  */
  const resultBeforeReset = currentResult;
  const wonBeforeReset = lastBattleWon();
  const survivorsBeforeReset = survivorsFromLastBattle();
  const battleGoldBeforeReset = lastBattleGold();
  const killedBeforeReset = monstersKilledLastBattle();
  // ★ 0.1.1 藏品二版：仇名录要的是"非野怪击杀数"（野怪回合由结算层自动排除）
  const killedEnemiesBeforeReset = enemiesKilledLastBattle();
  // ★ 0.2 MujicaAve：这一场攒到的 fever（同样要在 currentResult 被清掉之前取）
  const feverGainedBeforeReset = feverGainedThisBattle();
  // ★ 0.3.2 阿米娅升变任务：她这一场打了多少伤害（同样要在 reset 之前取）
  const amiyaDamageBeforeReset = amiyaDamageLastBattle();

  /*
    ★ 回合推进时**保留**上一场的战报（日志 + 伤害统计）。
    见 resetBoardAndPlayback 里 `keepLastBattleView` 的说明：
    要求是"日志保留到下一回合的布阵阶段"（野怪回合后还要能看见掉落）。
    真正的清空时机变成"下一场战斗开始"（startBattle 里那句 el.log.innerHTML = ''）。
  */
  resetBoardAndPlayback({ keepLastBattleView: true });

  // ★ 沙盒：蓝方和红方各自结算（发钱 / 刷新商店 / 回合 +1）
  if (testSides) {
    const [blue, red] = testSides;
    const goldOf = (team: 0 | 1): number =>
      resultBeforeReset ? battleGoldOf(resultBeforeReset.log, team) : 0;
    const killsOf = (team: 0 | 1): { defId: string; tick: number }[] =>
      resultBeforeReset ? monstersKilledBy(resultBeforeReset.log, team) : [];
    const enemyKillsOf = (team: 0 | 1): number =>
      resultBeforeReset ? enemiesKilledBy(resultBeforeReset.log, team) : 0;
    // 蓝方赢 -> wonBlue=true；红方赢 -> false；平局 -> null
    const blueRound = advanceRound(
      blue,
      wonBeforeReset,
      undefined,
      goldOf(0),
      killsOf(0),
      enemyKillsOf(0),
      resultBeforeReset?.feverGained?.[0] ?? 0,
    );
    const redRound = advanceRound(
      red,
      wonBeforeReset === null ? null : !wonBeforeReset,
      undefined,
      goldOf(1),
      killsOf(1),
      enemyKillsOf(1),
      resultBeforeReset?.feverGained?.[1] ?? 0,
    );
    appendDropLog(blueRound.drop, blueRound.round);
    appendFeverTreasureLog(blueRound.feverTreasure);
    appendDropLog(redRound.drop, redRound.round);
    appendFeverTreasureLog(redRound.feverTreasure);
    // ★ 0.2：商店回合是独立阶段 —— 野怪回合打完沙盒照样开商店，别在这儿抹掉
    enterPrepPhase(blue);
    enterPrepPhase(red);
    blue.result = null;
    red.result = null;
    renderAll();
    toast(
      `第 ${state.round} 回合开始（蓝 ${blue.placements.length} · 红 ${red.placements.length}）`,
    );
    return;
  }

  // 注意：回合号是 advanceRound 里 +1 的，这里**不能**再加一次
  const settled = advanceRound(
    state,
    wonBeforeReset,
    survivorsBeforeReset,
    battleGoldBeforeReset,
    killedBeforeReset,
    killedEnemiesBeforeReset,
    feverGainedBeforeReset,
    // ★ 0.3.2 阿米娅升变任务：这一场她打了多少伤害（野怪回合由结算层跳过）
    amiyaDamageBeforeReset,
  );

  // ★ 0.2：商店回合是一个**独立的 shop 阶段**，别在这儿把它抹回 prep
  enterPrepPhase(state);
  state.result = null;
  renderAll();
  appendDropLog(settled.drop, settled.round);
  // ★ 0.2：fever 跨档的宝藏
  appendFeverTreasureLog(settled.feverTreasure);
  /*
    ★ 顶部那句话也带上宝藏摘要 —— 日志面板可能在别的页签上，
    "刚拿了 66 金币"这种事应该一眼就看见。
  */
  const treasureToast = settled.feverTreasure
    ? ` · ★ fever ${settled.feverTreasure.tier} 档宝藏：${settled.feverTreasure.summary}`
    : '';
  toast(`第 ${state.round} 回合开始${treasureToast}`);
}

// ============================================================
// 拖动放置
// ============================================================

/**
 * 拖动状态。
 *
 * 【为什么要用 pointer 事件而不是 HTML5 的 drag&drop？】
 * 因为 HTML5 drag&drop 需要 draggable 元素和 dataTransfer，
 * 在 canvas 上很难拿到精确的落点坐标；
 * 而我们的场景是「棋子从 DOM 面板拖到 3D 棋盘上」，需要自定义预览和落点高亮。
 * pointer 事件（pointerdown/move/up）更底层、更容易控制。
 *
 * 【和平精英式的一点小体验】
 * 拖动时鼠标离开浏览器窗口、或者按了 Esc，都要能干净地取消 ——
 * 不然会留下一个"粘"在屏幕上的预览图。
 */
type DragSource =
  | { kind: 'bench'; uid: number }
  | { kind: 'board'; from: Cell }
  /**
   * ★ 0.0.3 藏品：从藏品栏的某一格拖出来（zone + 该栏里的下标）。
   *
   * 【为什么不像棋子那样只记一个"身份"？】
   * 因为藏品栏本来就是**按格子组织**的（第几格 = 状态的一部分），
   * 换栏/换格是要写状态的操作（删除、装卸），不是"同一个东西换个地方"。
   */
  | { kind: 'item'; zone: ItemZone; index: number };

let drag: {
  pointerId: number;
  source: DragSource;
  /** 按下时的屏幕坐标，用来判断「是拖动还是点击」 */
  startX: number;
  startY: number;
  /** 有没有超过阈值、算真正的拖动 */
  moved: boolean;
  /** 跟随光标的 DOM 预览 */
  ghost: HTMLElement;
  /** 3D 里的棋子预览（从备战席拖出来时用） */
  preview: ReturnType<typeof createUnitSprite> | null;
} | null = null;

/** 超过这个像素距离才算「拖动」，否则当成点击 */
const DRAG_THRESHOLD = 6;

/**
 * 是否需要吃掉紧接着的那次 click 事件。
 *
 * 【为什么需要这个？】
 * 浏览器在 pointerup 之后还会再发一个 click。
 * 拖动结束时我们已经把棋子的位置改好了，如果那个 click 又被当成
 * 「点击棋盘」，就会再执行一次操作 —— 比如刚拖过去的棋子立刻被收回。
 * 所以拖动结束后要把那一次 click 吃掉。
 */
let suppressNextClick = false;

/**
 * 开始拖动。
 * @param source 拖的是什么（备战席棋子 / 场上的棋子）
 * @param captureElement 在哪个元素上捕获指针（备战席格子 / 画布）。
 *   捕获之后即使鼠标移到别的元素上也能继续收到事件；取消时要还回去。
 */
function beginDrag(source: DragSource, event: PointerEvent, captureElement: HTMLElement): void {
  // ★ 0.2：商店回合也允许拖（它就是布阵时间，只是多了一个商店界面）
  if (!canEditTeam(state.phase)) return;
  // ★ 0.1.1：已被淘汰就什么都不能拖（牌已经不是我的了）
  if (state.meEliminated) return;
  // ★ 0.1.1：一开始拖就把悬停卡片收掉（不然它会跟着鼠标一起被拖走，看着很怪）
  hideBenchTip();

  /*
    ★ 0.0.3 藏品：走另一条分支 —— 它没有 3D 精灵预览，也不需要 defId。
    放在最前面，免得下面那套"查干员定义"的逻辑把它当棋子处理。
  */
  if (source.kind === 'item') {
    beginItemDrag(source, event, captureElement);
    return;
  }

  const defId = source.kind === 'bench'
    ? state.economy.bench.find((u) => u.uid === source.uid)?.defId
    : state.placements.find((p) => p.cell.col === source.from.col && p.cell.row === source.from.row)?.defId;
  if (!defId) return;

  const def = UNIT_DEFS[defId];
  if (!def) return;

  // --- 跟随光标的 DOM 预览（2D 卡片） ---
  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost';
  ghost.innerHTML = `
    <div class="drag-ghost-swatch" style="background:${def.color}"></div>
    <div class="drag-ghost-name">${escapeHtml(def.name)}</div>
  `;
  document.body.appendChild(ghost);

  // --- 3D 预览：从备战席拖出来时，棋盘上跟着一个半透明的棋子 ---
  // 拖动场上的棋子不需要预览 —— 原来那个就在棋盘上，再叠一个会看不清
  let preview: ReturnType<typeof createUnitSprite> | null = null;
  if (source.kind === 'bench') {
    const star = state.economy.bench.find((u) => u.uid === source.uid)?.star ?? 1;
    preview = createUnitSprite(def, star, 0);
    preview.scale.set(0.6, 0.8, 1);
    board.unitLayer.add(preview);
  }

  drag = {
    pointerId: event.pointerId,
    source,
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
    ghost,
    preview,
  };
  // 记下"指针捕获在哪个元素上"，取消拖动时要释放（否则后续点击/右键会失灵）
  dragCaptureElement = captureElement;
  dragPointerId = event.pointerId;
  // 拖动期间给 body 加个 class：改成"抓取"光标，并禁掉文字选中
  // （不然在画布上拖会拖出一片蓝色选区，很难看）
  document.body.classList.add('dragging');
  moveDragGhost(event.clientX, event.clientY);
}

/** 更新预览的位置 */
function moveDragGhost(clientX: number, clientY: number): void {
  if (!drag) return;
  drag.ghost.style.transform = `translate(${clientX + 14}px, ${clientY + 14}px)`;
}

/**
 * 鼠标当前在**哪个备战席格子**上（不在备战席上就返回 null）。
 *
 * 【为什么用 elementFromPoint，而不是像棋盘那样算坐标？】
 * 备战席是底部的 DOM 面板，和 3D 棋盘完全不在一个坐标系里 ——
 * screenToCell 那套在这里没用。而格子本身就是 DOM 元素，
 * 直接问浏览器"这个坐标下面是哪个元素"最准、也最不容易算错。
 *
 * 【和指针捕获冲突吗？】
 * 不冲突。拖动时我们会在**起点元素**上做 setPointerCapture，
 * 那只影响"事件送到谁"，elementFromPoint 仍然按真实坐标命中真实元素。
 * 拖动的预览卡片（.drag-ghost）设了 pointer-events:none，不会挡住查询。
 */
function benchSlotIndexAt(clientX: number, clientY: number): number | null {
  const node = document.elementFromPoint(clientX, clientY);
  const slot = node?.closest<HTMLElement>('.bench-slot');
  if (!slot) return null;
  const raw = Number(slot.dataset.benchIndex);
  return Number.isInteger(raw) ? raw : null;
}

/** 清掉备战席上"可以放这里"的高亮 */
function clearBenchDropHighlight(): void {
  for (const node of el.benchSlots.querySelectorAll('.bench-slot.drop-target')) {
    node.classList.remove('drop-target');
  }
}

/*
  ============================================================
   ★ 0.0.3 藏品拖拽
  ============================================================
  和棋子相比，藏品有**三种**落点，而且"哪个落点合法"完全由藏品自己决定：
    · A 类  -> 干员（场上棋子 / 备战席棋子）
    · B 类  -> 共享装备位
    · 任意类 -> 最下方的「删除藏品」区
  所以这里把"光标下面是什么"先解析成一个明确的落点，再让调用方按
  "拖的是什么 + 落在哪"决定干不干 —— 不要在两处各写一遍合法性判断。
*/

/** 藏品可以落到哪儿 */
type ItemDropTarget =
  | { kind: 'slot'; zone: ItemZone; index: number }
  | { kind: 'unit'; uid: number }
  | { kind: 'delete' }
  | { kind: 'none' };

/**
 * 解析光标下面的藏品落点。
 *
 * 【顺序：删除区 -> 藏品格 -> 干员】
 * 前两个是 DOM 元素（elementFromPoint 最准），最后一个是 3D 棋盘（要射线）。
 * 而棋子那套是"备战席 -> 棋盘"，两者互斥、不重叠。
 */
function itemDropTargetAt(clientX: number, clientY: number): ItemDropTarget {
  const node = document.elementFromPoint(clientX, clientY);

  if (node?.closest('#item-delete-zone')) return { kind: 'delete' };

  const slot = node?.closest<HTMLElement>('.item-slot');
  if (slot) {
    const zone = slot.dataset.itemZone as ItemZone | undefined;
    const index = Number(slot.dataset.itemIndex);
    if (zone && Number.isInteger(index)) return { kind: 'slot', zone, index };
  }

  // 备战席上的干员（DOM）
  const benchSlot = node?.closest<HTMLElement>('.bench-slot');
  if (benchSlot) {
    const index = Number(benchSlot.dataset.benchIndex);
    const unit = Number.isInteger(index) ? state.economy.bench[index] : undefined;
    if (unit) return { kind: 'unit', uid: unit.uid };
  }

  // 場上的干员（3D）；只认地板，理由同棋子的拖动（立绘会盖住后面几格）
  const viewCell = board.screenToCell(clientX, clientY, { ignoreUnits: true });
  if (viewCell) {
    const cell = viewToRawCell(viewCell, viewFlipped);
    const placement = placementAt(state, cell);
    if (placement) return { kind: 'unit', uid: placement.uid };
  }

  return { kind: 'none' };
}

/** 拖着的这件藏品（顺便把 id 查出来）；拖的不是藏品就返回 null */
function draggedItemId(): string | null {
  if (!drag || drag.source.kind !== 'item') return null;
  const { zone, index } = drag.source;
  return itemZoneView(state, zone)[index]?.itemId ?? null;
}

/**
 * 这个落点对"拖着的这件藏品"合不合法（用来画高亮，以及决定放不放得下去）。
 *
 * ★ 这套判断必须和 state 层的实际执行**语义一致**（不然会出现
 *   "画面上绿着、松手却失败"）。所以这里的规则刻意写得跟文档一样直白：
 *   A 类只能落到干员 / 删除；B 类只能落到共享装备位 / 删除；
 *   **同一栏内的另一格 = 互换位置**（0.0.3 需求 4，三栏都支持）。
 *
 * 【为什么要传"从哪一格拖出来的"？】
 * 因为"同栏互换"这条判断需要知道来源栏 —— 只有它才能区分
 * "共享藏品栏 -> 共享装备位"（装载）和"共享藏品栏 -> 共享藏品栏"（排序）。
 */
function itemDropAllowed(
  itemId: string,
  target: ItemDropTarget,
  from: { zone: ItemZone; index: number },
): boolean {
  const item = ITEM_DEFS[itemId];
  if (!item) return false;
  if (target.kind === 'none') return false;
  /*
    ★★ 0.3.2 升变之证专用栏的规矩（和 state 层同一套语义）：
      · **不能删** —— 任务换来的，误删等于白做一整局；
      · **格位固定** —— 第 1 格就是青色、第 3 格就是终曲，换位置没有意义；
      · **只能拖到干员** —— 它本来就不该进穿戴/共享栏（那是另一套容量）。
  */
  const fromCert = from.zone === 'cert';
  if (fromCert && target.kind === 'delete') return false;
  if (target.kind === 'delete') return true;
  if (target.kind === 'slot') {
    // ★ 同一栏 -> 互换位置（原地拖回自己那一格不算，免得白白弹一条提示）
    if (target.zone === from.zone) {
      if (target.zone === 'cert') return false;
      return target.index !== from.index;
    }
    if (fromCert) return false;
    // 跨栏：B 类只能进共享装备位
    return item.slot === 'B' && target.zone === 'bequip';
  }
  // 干员：只有 A 类能穿
  if (target.kind === 'unit') {
    if (item.slot !== 'A') return false;
    /*
      ★ 野怪不能穿戴装备 —— 高亮阶段就挡掉（松手后 state 层还有第二道闸，
      两层语义一致，不会出现"画面上绿着、松手才报错"之外的第三种状态）。
    */
    const unit =
      state.economy.bench.find((u) => u.uid === target.uid) ??
      state.placements.find((p) => p.uid === target.uid);
    if (!unit) return false;
    const def = UNIT_DEFS[unit.defId];
    if (def?.monsterOnly) return false;
    /*
      ★ 0.1.1：彩蛋角色永久免升星/复制 —— 高亮阶段就挡掉，
      和 state 层那道闸语义一致（不会出现"画面上绿着、松手才报错"）。
    */
    if (def?.noStar && isUnitTransformingItem(item)) return false;
    /*
      ★ 0.1.3 转职藏品：干员本来就有这个羁绊 -> 高亮阶段就挡掉。
      和 state 层那道闸语义一致（不会出现"画面上绿着、松手才报错"）。
    */
    if (item.grantsTrait && (def?.traits ?? []).includes(item.grantsTrait)) return false;
    /*
      ★ 0.1.3 变形同构体：身上已经有转职 / 没有可转的羁绊 / 穿戴藏品栏满了 —— 三条与
      `equipItemToUnit` 里那三条一一对应，两侧必须是同一套判据。
    */
    if (item.onEquip?.prep?.kind === 'morphRelic') {
      if (traitRelicsOf(unit).length > 0) return false;
      if (morphCandidatesOf(def).length === 0) return false;
      if (state.items.aSlots.every((slot) => slot !== null)) return false;
    }
    return true;
  }
  return false;
}

/** 藏品拖动：清掉所有藏品相关高亮 */
function clearItemDropHighlight(): void {
  for (const node of el.sidePaneCollection.querySelectorAll('.item-slot.drop-target')) {
    node.classList.remove('drop-target');
  }
  el.itemDeleteZone.classList.remove('drop-target');
  for (const node of el.benchSlots.querySelectorAll('.bench-slot.item-target')) {
    node.classList.remove('item-target');
  }
}

/** 开始拖一件藏品 */
function beginItemDrag(
  source: { kind: 'item'; zone: ItemZone; index: number },
  event: PointerEvent,
  captureElement: HTMLElement,
): void {
  const itemId = itemZoneView(state, source.zone)[source.index]?.itemId ?? null;
  if (!itemId) return;
  const item = ITEM_DEFS[itemId];
  if (!item) return;

  /*
    拖动预览（跟着光标的 DOM 小卡片）。
    ★ 刻意不做 3D 预览：藏品是"拖到界面格子里"的东西，
      在棋盘上浮一个半透明棋子只会让人以为它要上场。
  */
  const style = itemRarityStyle(item);
  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost item-ghost';
  ghost.style.borderColor = style.base;
  ghost.innerHTML = `
    <span class="item-ghost-badge" style="background:${style.base}">${ITEM_SLOT_SHORT[item.slot] ?? item.slot}</span>
    <span class="drag-ghost-name">${escapeHtml(item.name)}</span>
  `;
  document.body.appendChild(ghost);

  drag = {
    pointerId: event.pointerId,
    source,
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
    ghost,
    preview: null,
  };
  dragCaptureElement = captureElement;
  dragPointerId = event.pointerId;
  document.body.classList.add('dragging');
  moveDragGhost(event.clientX, event.clientY);
}

/** 藏品拖动过程中更新落点高亮 */
function updateItemDragTarget(clientX: number, clientY: number): void {
  // 收窄成"藏品来源"：后面判断合法落点要用到它（同栏 = 互换位置）
  if (!drag || drag.source.kind !== 'item') return;
  const from = drag.source;
  const itemId = draggedItemId();
  clearItemDropHighlight();
  // 拖藏品的时候 3D 棋盘上的格子高亮要收起来（它说的是"能放棋子"，会误导）
  board.setHighlight(null, true);
  if (!itemId) return;

  const target = itemDropTargetAt(clientX, clientY);
  const allowed = itemDropAllowed(itemId, target, from);
  if (!allowed) return;

  if (target.kind === 'delete') {
    el.itemDeleteZone.classList.add('drop-target');
    return;
  }
  if (target.kind === 'slot') {
    el.sidePaneCollection
      .querySelector<HTMLElement>(`.item-slot[data-item-zone="${target.zone}"][data-item-index="${target.index}"]`)
      ?.classList.add('drop-target');
    return;
  }
  if (target.kind === 'unit') {
    // 备战席上的干员：直接给那一格上高亮
    const index = state.economy.bench.findIndex((u) => u.uid === target.uid);
    if (index >= 0) {
      el.benchSlots
        .querySelector<HTMLElement>(`.bench-slot[data-bench-index="${index}"]`)
        ?.classList.add('item-target');
      return;
    }
    // 场上的干员：让棋盘把它那一格点亮
    const placement = state.placements.find((p) => p.uid === target.uid);
    if (placement) board.setHighlight(rawToViewCell(placement.cell, viewFlipped), true);
  }
}

/**
 * 松开鼠标：把藏品放到落点。
 *
 * 【为什么每个分支都先 `cleanup()` 再改状态？】
 * 因为改状态会触发 `renderAll()`，而 renderAll 里会把三个区**整块重画** ——
 * 如果拖动预览（.drag-ghost）还挂在 body 上，它就会盖在刚画好的格子上，
 * 看起来像"拖影没散"。所以先清理、再动手。
 */
function endItemDrag(clientX: number, clientY: number): boolean {
  if (!drag) return false;
  const source = drag.source;
  if (source.kind !== 'item') return false;

  const itemId = draggedItemId();
  cleanupDragVisuals();
  suppressNextClick = true;
  if (!itemId) return true;

  const target = itemDropTargetAt(clientX, clientY);
  if (!itemDropAllowed(itemId, target, source)) return true; // 不合法的落点 = 取消（不弹提示，免得像报错）

  let result: { ok: boolean; message: string };
  if (target.kind === 'delete') {
    result = deleteItem(state, source.zone, source.index);
  } else if (target.kind === 'slot') {
    if (target.zone === source.zone) {
      // ★ 0.0.3 需求 4：同栏内拖动 = 互换位置
      result = swapItemsInZone(state, source.zone, source.index, target.index);
    } else if (source.zone === 'b') {
      result = equipSharedItem(state, source.index, target.index);
    } else {
      return true;
    }
  } else if (target.kind === 'unit') {
    /*
      ★ 0.3.2：穿戴藏品栏（a）和**升变之证专用栏**（cert）都能拖到干员身上。
      证的来源栏位要传给 state 层，它才知道消耗完该清哪一格
      （两边的下标是独立编号，清错了会误删玩家自己攒的藏品）。
    */
    if (source.zone !== 'a' && source.zone !== 'cert') return true;
    result = equipItemToUnit(
      state,
      source.index,
      target.uid,
      source.zone === 'cert' ? 'cert' : 'a',
    );
  } else {
    return true;
  }

  toast(result.message, !result.ok);
  if (result.ok) {
    state.message = result.message;
    closeUnitInfo(); // 干员身上的装备可能变了，详情页的数据得重开
  }
  renderAll();
  return true;
}

/**
 * 清掉拖动留下的所有临时东西（预览卡片、高亮、body 的 dragging class）。
 *
 * 抽出来是因为"拖动结束"和"拖动取消"两条路都要做这几件事，
 * 而藏品这一路还要额外清两种高亮（藏品格 / 备战席）——
 * 漏一个就会在高亮状态下卡住，看起来像"鼠标点哪都是绿的"。
 */
function cleanupDragVisuals(): void {
  if (drag) {
    drag.ghost.remove();
    if (drag.preview) board.unitLayer.remove(drag.preview);
  }
  drag = null;
  document.body.classList.remove('dragging');
  board.setHighlight(null, true);
  clearBenchDropHighlight();
  clearItemDropHighlight();
  resetSpriteOpacity();
}

/** 拖动过程中更新落点高亮和 3D 预览 */
function updateDragTarget(clientX: number, clientY: number): void {
  if (!drag) return;

  /*
    ★ 0.0.3 藏品：完全另一套落点语义（藏品格 / 干员 / 删除区），
    在这里就分流出去 —— 不要和下面"棋盘 + 备战席"那套混在一起写，
    混起来以后每加一种落点都要同时改两条路的判断。
  */
  if (drag.source.kind === 'item') {
    updateItemDragTarget(clientX, clientY);
    return;
  }

  /*
    ★ 落点优先看备战席（0.0.2 需求第 10 条）。
    光标一旦进了备战席那块区域，落点就是那一格，
    棋盘高亮和 3D 预览都要立刻收起来 —— 否则画面会同时说
    "可以放到场上的这格"和"可以放到备战席"，玩家不知道该信哪个。
  */
  const benchIndex = benchSlotIndexAt(clientX, clientY);
  clearBenchDropHighlight();
  if (benchIndex !== null) {
    board.setHighlight(null, true);
    if (drag.preview) drag.preview.visible = false;
    // 从场上拖过来的棋子会把自己那个精灵调暗过，这里恢复（因为落点不是棋盘）
    resetSpriteOpacity();
    el.benchSlots
      .querySelector<HTMLElement>(`.bench-slot[data-bench-index="${benchIndex}"]`)
      ?.classList.add('drop-target');
    return;
  }

  // 【拖动时只认地板】—— 见 board.screenToCell 里 ignoreUnits 的说明：
  // 立绘是竖长的，会盖住后面几格；如果还去打棋子，
  // 落点会一直被判定成"原来那一格"，看起来就是拖不动。
  const viewCell = board.screenToCell(clientX, clientY, { ignoreUnits: true });
  if (!viewCell) {
    board.setHighlight(null, true);
    if (drag.preview) drag.preview.visible = false;
    return;
  }

  const cell = viewToRawCell(viewCell, viewFlipped);
  const occupied = Boolean(placementAt(state, cell));
  const fromBench = drag.source.kind === 'bench';

  // 能不能放？
  //  从备战席拖：目标格必须空着，而且还能再上人（canAddUnit 内含人口上限，
  //  以及修改器的「无视人口上限」开关）
  //  从场上拖：目标格有人也行（会交换）
  let acceptable = false;
  if (fromBench) {
    acceptable = isSideCell(state.side, cell) && !occupied && canAddUnit(state);
  } else {
    acceptable = isSideCell(state.side, cell);
  }

  board.setHighlight(viewCell, acceptable);

  // 拖场上的棋子时，把原来那个精灵半透明化 ——
  // 否则它自己挡着落点，高亮格子根本看不见
  if (!fromBench && drag.source.kind === 'board') {
    const source = drag.source.from;
    for (const [uid, sprite] of prepSprites) {
      const placement = state.placements.find((p) => p.uid === uid);
      if (!placement) continue;
      const isSource = placement.cell.col === source.col && placement.cell.row === source.row;
      const material = (sprite as unknown as { material?: { opacity: number; transparent: boolean } }).material;
      if (material) {
        material.transparent = true;
        material.opacity = isSource ? CARD_OPACITY_DRAGGED : CARD_OPACITY;
      }
      /*
        小人精灵的材质是各自 new 的，**不继承**卡片的 opacity ——
        只压淡卡片的话，"被拖走的那只"小人还是实心一坨，照样挡着落点。
        所以连小人一起压淡（血条故意不动：它要一直看得清）。
      */
      setChibiOpacity(sprite, isSource ? CARD_OPACITY_DRAGGED : CARD_OPACITY);
    }
  }

  // 3D 预览跟着鼠标在棋盘上滑（只有从备战席拖出来时才有预览精灵）
  if (drag.preview) {
    drag.preview.visible = acceptable;
    const point = cellToWorldFlipped(cell, CARD_CENTER_Y, viewFlipped);
    drag.preview.position.set(point.x, point.y, point.z);
  }
}

/** 结束拖动，把棋子放到落点 */
function endDrag(clientX: number, clientY: number): boolean {
  if (!drag) return false;

  // ★ 0.0.3 藏品：走自己那条路（落点是藏品格 / 干员 / 删除区）
  if (drag.source.kind === 'item') return endItemDrag(clientX, clientY);

  const current = drag;
  // 先清理预览（不管成功失败都要清）
  const cleanup = (): void => {
    current.ghost.remove();
    if (current.preview) board.unitLayer.remove(current.preview);
    drag = null;
    document.body.classList.remove('dragging');
    board.setHighlight(null, true);
    clearBenchDropHighlight();
    resetSpriteOpacity();
  };

  // 没超过阈值 -> 当成点击，交给 click 事件处理
  if (!current.moved) {
    cleanup();
    return false;
  }

  /*
    ★ 落点在备战席上 —— 走"换位 / 按指定格子收回"这条路（0.0.2 需求第 10 条）。
    · 从备战席拖到备战席：交换位置（拖到空格子 = 移到末尾）
    · 从场上拖到备战席：落到那一格（那格有人就交换，没人就收回）
    注意落点要**先于**棋盘判定 —— 备战席和 3D 棋盘在屏幕上不重叠，
    所以两者其实互斥，但先判 DOM 更省一次射线计算。
  */
  const benchIndex = benchSlotIndexAt(clientX, clientY);
  if (benchIndex !== null) {
    cleanup();
    suppressNextClick = true;
    // 先取出 source 存成局部量：TS 的类型收窄不会保留到回调函数里，
    // 直接用 current.source 会在 findIndex 的箭头函数里失去收窄（编译不过）。
    const source = current.source;
    if (source.kind === 'bench') {
      // 拖回自己那一格：什么都不做（也不弹提示，免得像是操作失败）
      const fromIndex = state.economy.bench.findIndex((u) => u.uid === source.uid);
      if (fromIndex === benchIndex) return true;
      const result = reorderBench(state, source.uid, benchIndex);
      if (result.ok) {
        state.message = result.message;
        renderAll();
      } else {
        toast(result.message, true);
      }
    } else if (source.kind === 'board') {
      const result = moveBoardToBenchSlot(state, source.from, benchIndex);
      if (result.ok) {
        state.message = result.message;
        closeUnitInfo();
        renderAll();
      } else {
        toast(result.message, true);
      }
    }
    return true;
  }

  // 落点同样只认地板（原因见 updateDragTarget）
  const viewCell = board.screenToCell(clientX, clientY, { ignoreUnits: true });
  if (!viewCell) {
    cleanup();
    suppressNextClick = true; // 拖到画面外，算「取消」，但要吃掉这次点击
    return true;
  }
  const cell = viewToRawCell(viewCell, viewFlipped);

  // 执行放置 / 移动
  let result: { ok: boolean; message: string };
  if (current.source.kind === 'bench') {
    // 拖拽时用「直接放」而不是 placeSelected —— 不需要先选中
    // 拖拽走和点击同一份实现（见 placeBenchUnitAt 的注释：以前这里是个复制品，
    // 修改器的 free / 无视人口 两个特性就是在这儿漏掉的）
    result = placeBenchUnitAt(state, current.source.uid, cell);
  } else if (current.source.kind === 'board') {
    result = movePlacement(state, current.source.from, cell);
  } else {
    // 藏品在 endDrag 开头就分流走了（见 endItemDrag），走不到这里
    cleanup();
    return true;
  }

  cleanup();
  suppressNextClick = true;
  if (result.ok) {
    state.message = result.message;
    renderAll(); // 精灵同步在 renderAll 里统一做
  } else {
    toast(result.message, true);
  }
  return true;
}

/** 取消拖动（Esc、窗口失焦、指针被系统抢走时用） */
function cancelDrag(): void {
  if (!drag) return;
  /*
    【为什么这里要主动释放指针捕获？】
    拖动可能是被浏览器"打断"的（比如系统弹窗、触屏手势）。
    打断时浏览器发 pointercancel，我们走到这里把 drag 清了 ——
    但如果**不释放捕获**，指针就还锁在原来那个元素上，
    之后的操作（点击、右键）都会先送到那个元素，
    表现出来就是"点了没反应""右键有时候不生效"。
  */
  releaseDragPointerCapture();
  drag.ghost.remove();
  if (drag.preview) board.unitLayer.remove(drag.preview);
  drag = null;
  document.body.classList.remove('dragging');
  board.setHighlight(null, true);
  // ★ 0.0.3：藏品格 / 删除区的高亮也要一起清（漏了就会一直绿着）
  clearItemDropHighlight();
  resetSpriteOpacity();
}

/**
 * 记住"拖动是从哪个元素开始的"，取消时要把指针捕获还回去。
 *
 * 【为什么要记这个？】
 * 备战席的拖动是在**备战席格子**上捕获指针的（因为要从那儿拖到画布上），
 * 而画布上的拖动是在 canvas 上捕获的。取消时要释放到对的那个元素上，
 * 否则指针会一直锁着，后续的点击/右键就会失灵。
 */
let dragCaptureElement: HTMLElement | null = null;
let dragPointerId: number | null = null;

function releaseDragPointerCapture(): void {
  if (dragCaptureElement && dragPointerId !== null) {
    try {
      if (dragCaptureElement.hasPointerCapture(dragPointerId)) {
        dragCaptureElement.releasePointerCapture(dragPointerId);
      }
    } catch {
      // 元素已经被移出 DOM（比如重新渲染过备战席）时会抛错，忽略即可
    }
  }
  dragCaptureElement = null;
  dragPointerId = null;
}

/**
 * ★ 0.1.1：拖动的**兜底通道**（全局 pointermove / pointerup / pointercancel）。
 *
 * ============================================================
 *  修的是「藏品拖动的时候，藏品标签卡住、赖在画面上不消失」
 * ============================================================
 * 拖动是靠"在起点元素上 `setPointerCapture`"把后续事件收过来的。
 * 但那个起点元素**随时可能被整块重画掉**：
 *   · 联机里别人买卖 -> 服务器广播 pool -> `renderAll()` -> 藏品栏整块重建；
 *   · 备战席 / 棋盘上的拖动同理（prepTeams、room 广播都会触发 renderAll）；
 *   · 每秒一次的倒计时也曾经会重建（见 onPrepTick 的说明，已经不这么干了）。
 * 元素一旦从文档里消失，指针捕获**自动解除**，之后的 pointerup
 * 就再也不会送到我们手里 —— 于是：
 *   · 拖动预览 `.drag-ghost`（就是你说的"藏品标签"）永远留屏幕上；
 *   · `body.dragging` 也摘不掉，连光标都一直是"抓取"的样子。
 *
 * 【为什么在 window 上兜，而不是"禁止拖动期间 renderAll"？】
 * 因为"别人买卖"是服务器事件，拦不住。所以改成**事件丢了就从全局接住**：
 *   · 起点元素还在  -> 它自己的处理器先跑（`endDrag` 会把 `drag` 清空，这里自然不动）；
 *   · 起点元素已经没了 -> 这里接手，该落下的正常落下、该清的正常清。
 */
function installDragFallback(): void {
  /** 这次事件是不是已经被"起点元素自己"处理掉了 */
  const handledByOrigin = (event: PointerEvent): boolean =>
    Boolean(
      dragCaptureElement &&
        dragCaptureElement.isConnected &&
        event.target instanceof Node &&
        dragCaptureElement.contains(event.target),
    );

  window.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (handledByOrigin(event)) return;
    if (!drag.moved) {
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      drag.moved = true;
    }
    moveDragGhost(event.clientX, event.clientY);
    updateDragTarget(event.clientX, event.clientY);
  });

  window.addEventListener('pointerup', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (handledByOrigin(event)) return;
    releaseDragPointerCapture();
    endDrag(event.clientX, event.clientY);
  });

  window.addEventListener('pointercancel', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    cancelDrag();
  });
}

/**
 * ★ 0.1.1：清掉"没人认领"的拖动预览。
 *
 * 【兜底中的兜底】`.drag-ghost` 是纯临时 DOM（body 的子元素），
 * 一旦状态丢了就永远没人去删它 —— 而它在最上层，会一直挡着画面。
 * 所以每次 `renderAll()` 顺手扫一遍：只要此刻没有拖动在跑，
 * 就把所有拖影全删掉。**删错了也只是少一个跟着鼠标的小标签**，
 * 下一帧拖回来就又有；留着不管才是真把界面糊住。
 */
function sweepOrphanDragGhosts(): void {
  if (drag) return;
  for (const node of document.querySelectorAll('.drag-ghost')) node.remove();
}

/** 把拖动时改过半透明度的精灵恢复原样 */
function resetSpriteOpacity(): void {
  for (const sprite of prepSprites.values()) {
    const material = (sprite as unknown as { material?: { opacity: number; transparent: boolean } }).material;
    if (!material) continue;
    // 恢复成卡面的**默认**不透明度（背景的"淡"是画进贴图里的，所以这里是 1，见 card-layout.ts）
    material.opacity = CARD_OPACITY;
    material.transparent = true;
    // 小人也要一起恢复（拖动时被一起压淡过，见 updateDragTarget）
    setChibiOpacity(sprite, CARD_OPACITY);
  }
}

// ============================================================
// 鼠标交互
// ============================================================

/*
  ★ 0.0.3 修复：这里原来有一个 `dragBenchToCell`，是 `placeSelected` 的**复制品**
  （理由写在注释里："拖动不需要先选中，硬套 placeSelected 要偷偷改选中状态"）。
  但它只复制了逻辑的一半 —— 新的玩法特性补在 state 层那份上，它全漏：
    · 拖上场的棋子丢了 `free` 标记 → 修改器白送的干员开始占牌库；
    · 拖拽不认「无视人口上限」→ 开关打开照样被人口上限拦住。
  现在两件事都收敛到 `placeBenchUnitAt(state, uid, cell)`（不需要选中状态，
  也不动 selectedBenchUid），拖拽和点击共用同一份实现。
*/

function updateHighlightFromPointer(clientX: number, clientY: number): void {
  // 拖动中时高亮由 updateDragTarget 负责，别两边抢
  if (drag) return;
  // 看别人棋盘时不高亮自己的格子（不然像是"可以放这儿"）
  if (!canEditTeam(state.phase) || viewingPlayerId !== null) {
    board.setHighlight(null, true);
    return;
  }
  const viewCell = board.screenToCell(clientX, clientY);
  if (!viewCell) {
    board.setHighlight(null, true);
    return;
  }
  const cell = viewToRawCell(viewCell, viewFlipped);
  const occupied = Boolean(placementAt(state, cell));
  const hasSelection = state.selectedBenchUid !== null;
  /*
    ★ 目标格子有人时现在是**互换**（见 placeSelected），所以它也是合法落点。
    高亮要跟着这个规则走 —— 否则玩家看到红色高亮会以为放不上去，
    结果点下去却换成功了，那种"提示和实际不一致"最让人困惑。
  */
  const canPlace =
    isSideCell(state.side, cell) && !occupied && hasSelection && canAddUnit(state);
  const canSwap = isSideCell(state.side, cell) && occupied && hasSelection;
  board.setHighlight(viewCell, canPlace || canSwap || (occupied && !hasSelection));
}

/**
 * 点击棋盘。
 *
 * 坐标边界：screenToCell 返回「视角坐标」，游戏逻辑用「原始坐标」，
 * 在函数开头转换一次，之后只用原始坐标。
 *
 * 【操作分配】（改过一次，记下来免得以后又乱）
 *   左键点空位   -> 把选中的备战席干员放下来
 *   左键点干员   -> 弹出干员信息小窗口（属性/羁绊/技能）
 *   右键点干员   -> 收回备战席
 *   拖拽干员     -> 换位置（拖到别的格子上，有人就交换）
 * 以前"左键点干员 = 收回备战席"和"右键 = 收回"是重的，
 * 结果想看一眼棋子信息只能靠 title 提示。现在左键专职看信息。
 */
function handleBoardClick(viewCell: Cell, button: number, clientX = 0, clientY = 0): void {
  // ★ 0.2：商店回合和布阵阶段一样能点（选中/放下/收回/看信息）
  if (!canEditTeam(state.phase)) return;
  // ★ 0.1.1：已经被淘汰 —— 只剩观战，棋盘上任何点击都不该生效
  if (state.meEliminated) {
    toast('你已被淘汰，现在只能观战', true);
    return;
  }
  /*
    ★★ 0.3.4（用户口径）：观战时**点他的干员可以看面板和藏品，但什么都不能动**。
    所以「看信息」这一条要放在"看别人棋盘就直接拒绝"**之前** ——
    否则点哪都只弹一句"点回我的棋盘才能操作"，想看也看不了。
    其它操作（右键收回 / 拖拽 / 放人）照旧一律拒掉。
  */
  if (viewingPlayerId !== null) {
    const viewedCell = viewToRawCell(viewCell, viewFlipped);
    if (button === 0 && viewedPlacementAt(viewedCell)) {
      openUnitInfo(viewedCell, clientX, clientY);
      return;
    }
    toast('正在看别人的棋盘，点「回到我的棋盘」才能操作', true);
    return;
  }
  const cell = viewToRawCell(viewCell, viewFlipped);
  const occupant = placementAt(state, cell);

  // 右键：收回备战席
  if (button === 2) {
    if (!occupant) return;
    const result = recallFromBoard(state, cell);
    if (!result.ok) toast(result.message, true);
    closeUnitInfo();
    renderAll();
    return;
  }

  // 左键点在已有干员身上：看信息
  if (occupant) {
    /*
      ★ 0.1.2 测试模式：开着「数值修改」时**不弹详情页**，改弹基础属性面板。
      这就是用户要的那条：打开后布阵阶段点干员直接进编辑，少一次"再点一下工具"的操作。
      两个面板互斥：这里分叉，而不是"都弹出来再叠一层"（叠起来会互相挡）。
    */
    if (statEditMode && state.testMode && state.phase === 'prep') {
      closeUnitInfo();
      openUnitEditor(cell, clientX, clientY);
      return;
    }
    openUnitInfo(cell, clientX, clientY);
    return;
  }

  // 左键点空位：放下选中的干员
  if (state.selectedBenchUid === null) {
    closeUnitInfo(); // 点空地 = 关掉信息卡片，符合直觉
    closeUnitEditor();
    return;
  }
  const result = placeSelected(state, cell);
  if (!result.ok) {
    toast(result.message, true);
    return;
  }
  closeUnitInfo();
  renderAll();
}

// ============================================================
// 播放控制条
// ============================================================

function renderSpeedButtons(): void {
  el.speedGroup.innerHTML = '';
  for (const speed of PLAYBACK_SPEEDS) {
    const button = document.createElement('button');
    button.className = `speed-btn${state.playbackSpeed === speed ? ' active' : ''}`;
    button.textContent = `${speed}×`;
    button.addEventListener('click', () => {
      state.playbackSpeed = speed as PlaybackSpeed;
      replay.setSpeed(speed);
      renderSpeedButtons();
    });
    el.speedGroup.appendChild(button);
  }
}

let seeking = false;
el.seek.addEventListener('pointerdown', () => {
  seeking = true;
});
window.addEventListener('pointerup', () => {
  seeking = false;
});

el.btnPause.addEventListener('click', () => {
  paused = !paused;
  el.btnPause.textContent = paused ? '▶' : '⏸';
});

// ★ 0.1.1：结算页的「收起」（关掉浮层，棋盘还留着看；真要离开房间点左上角的「← 返回」）
el.resultClose.addEventListener('click', () => hideResultPage());

/**
 * ★★ 0.3.5：结算页的「再来一局 · 返回房间」。
 *
 * 【它做的事】
 *   发一条 `backToLobby` —— 服务端把这一局复位（血量、战绩、准备状态、牌库），
 *   然后广播房间状态；所有人的 `onRoom` 看到 `phase === 'lobby'` 就一起回大厅。
 *   房间号、座位、房主、房间设置都不变，房主在大厅里直接再点「开始游戏」就是下一局。
 *
 * 【为什么按钮要"先响应再等"】
 *   服务端拒绝（对局还没结束 / 断线）时不会回到大厅。所以点完立刻把按钮置灰并
 *   写"正在返回房间…"，收到 room 广播或 2 秒后自动恢复 —— 免得玩家以为没点上连点。
 */
el.resultAgain.addEventListener('click', () => {
  if (!netplayActive) {
    toast('只有联机房间才有「返回房间」', true);
    return;
  }
  const sent = net.backToLobby();
  if (!sent) {
    toast('网络未连接，没能把请求发出去', true);
    return;
  }
  el.resultAgain.disabled = true;
  el.resultAgain.textContent = '正在返回房间…';
  state.message = '正在返回房间…';
  renderAll();
  window.setTimeout(() => {
    el.resultAgain.disabled = false;
    el.resultAgain.textContent = '再来一局 · 返回房间';
  }, 2000);
});

el.seek.addEventListener('input', () => {
  if (!currentResult) return;
  const target = (Number(el.seek.value) / 1000) * replay.durationSeconds;
  replay.seek(target);
  // 拖动会跳跃时间，日志和统计都要从零重建（往前补算、往回清掉未来数据）
  rebuildBattleView(Math.floor(replay.currentSeconds * TICKS_PER_SECOND));
});

// ============================================================
// 羁绊详情
// ============================================================

/**
 * 把一个羁绊加成渲染成人类可读的数值。
 *
 * 【为什么要从数据算，而不是直接用策划写的 desc？】
 * 因为 desc 是手写的自然语言，可能和实际数值不一致（改数值忘了改描述）。
 * 这里从 effects 现场算，保证「看到的数字」= 程序实际用的数字。
 * desc 仍然显示，作为更易懂的补充说明。
 */
// 羁绊效果的格式化在共享层（formatTraitEffect）——
// 因为数值有三种单位（万分比 / 绝对值 / 纯个数），各写一份必然会漏掉一种


/** 打开某个羁绊的详情 */
function openTraitDetail(traitId: string): void {
  const def = TRAIT_DEFS[traitId];
  if (!def) return;

  // 当前场上的数量（只算上场的，备战席不算 —— 和羁绊生效规则一致）
  // ★ 0.1.1：观战时按"他的"阵容算，否则点开的是他的羁绊、显示的是我的数量
  const status = traitStatusesForView().traits.find((t) => t.traitId === traitId);
  const count = status?.count ?? 0;
  const activeAt = status?.activeAt ?? null;

  el.detailName.textContent = def.name;
  el.detailKind.textContent = def.kind === 'race' ? '种族' : '职业';
  el.detailName.style.color = traitColor(traitId);

  el.detailCount.innerHTML =
    count > 0
      ? `场上已有 <strong style="color:${traitColor(traitId)};font-size:16px">${count}</strong> 种 · ` +
        (activeAt !== null
          ? `当前生效的是 ${activeAt} 档`
          : status?.solo && !status.solo.ok
            ? // ★ 0.1.4：数量够了但"上多了"—— 必须说清楚，不然玩家只会看到 2/1 这种数
              `已失效：必须恰好 ${status.solo.exactly} 名（现在 ${count} 名）`
            : `还差 ${Math.max(1, (def.tiers[0]?.count ?? 1) - count)} 种才能触发`)
      : `场上还没有带这个标签的干员`;

  // ---- 档位列表 ----
  el.detailTiers.innerHTML = '';
  for (const tier of def.tiers) {
    const isActive = activeAt !== null && tier.count === activeAt;
    // 已经满足但是被更高档位覆盖的
    const isPassed = count >= tier.count && !isActive;
    // ★ 0.1.4：数量够了、但因为这个羁绊要求"恰好 N 名"而整个失效（领导人上多了）
    const soloBlocked = isPassed && status?.solo !== undefined && !status.solo.ok;

    const row = document.createElement('div');
    row.className = `detail-tier${isActive ? ' active' : isPassed && !soloBlocked ? ' passed' : ''}`;

    const numbers = formatTraitEffects(tier.effects);
    const badge = isActive
      ? '<span class="detail-tier-badge">生效中</span>'
      : soloBlocked
        ? `<span class="detail-tier-badge dim">已失效（必须恰好 ${status!.solo!.exactly} 名）</span>`
        : isPassed
          ? '<span class="detail-tier-badge dim">已满足</span>'
          : `<span class="detail-tier-badge dim">还差 ${Math.max(1, tier.count - count)} 种</span>`;

    /*
      "实际："那一行只在**有数值效果**时显示。
      有些档位是纯机制（比如龙：加成全靠"每有一个三星干员提升全部属性"，
      写法在 mechanics 里而不是 effects 里），这种档位的说明已经在 desc 里了，
      再显示一行空的"实际："只会让人以为界面坏了。
    */
    const numbersLine = numbers.length > 0 ? `<div class="detail-tier-numbers">实际：${numbers}</div>` : '';

    // 窄面板（190px）用上下堆叠：数量+徽章一行，描述和数值在下面
    row.innerHTML = `
      <div class="detail-tier-top">
        <span class="detail-tier-count">${tier.count} 种</span>
        ${badge}
      </div>
      <div class="detail-tier-desc">${escapeHtml(tier.desc)}</div>
      ${numbersLine}
    `;
    el.detailTiers.appendChild(row);
  }

  // ---- 拥有这个标签的干员 ----
  /*
    【排序规则：先排"已经在场上的"】
    因为看羁绊详情时最关心的是「我还差几个才能升档」，
    而场上的干员才是真正计入羁绊数量的那些。
    把它们排在最前面，一眼就能对上号。
    其次是费用从低到高（便宜的容易凑）。
  */
  el.detailUnits.innerHTML = '';
  // ★ 0.1.1：观战时"已在场上"要按对方的阵容标（否则会把我场上的干员标成他的）
  const viewUnits: Array<{ defId: string }> =
    viewingPlayerId === null ? state.placements : (prepTeams[viewingPlayerId]?.units ?? []);
  /*
    ★★ 0.3.2 用户口径（两条都落在这张名单上，实现全在 `game/trait-owners.ts`）：

    ① **召唤物 / 野怪不参与羁绊构建，不列进来** ——
       典型是「天师锦囊」召唤的【炎佑】挂着 `yan` 标签，以前会跑到「大炎」的名单里，
       读起来像"炎国还多一个人能凑"，其实它根本不算成员。
    ② **阿米娅 + 三个升变形态是同一只棋子 ⇒ 名单里只留一条「阿米娅」**。

    口径和数人头一致：名单里几条 = 羁绊数几个（`countTraits` 用的也是 `familyKeyOf`）。
    ★ 别在这里另写过滤：这段以前是内联的，两条规则各漏过一次。
  */
  const owners = traitOwnersOf(
    traitId,
    viewUnits.filter((p) => p.defId).map((p) => p.defId),
  );

  if (owners.length === 0) {
    el.detailUnits.innerHTML =
      '<div class="menu-hint" style="text-align:left">还没有任何干员带这个标签 —— 这个羁绊现在凑不出来</div>';
  } else {
    for (const owner of owners) {
      const unit = owner.def;
      const rarity = rarityOfCost(unit.cost);
      const isOnField = owner.onField;
      const portrait = getLoadedImage(unitSpritePath(unit.id));
      const chip = document.createElement('div');
      chip.className = `detail-unit${isOnField ? ' on-field' : ''}`;
      // 窄面板里竖排列表：用左侧色条表示稀有度，比整圈边框更省空间
      chip.style.borderLeftColor = rarity.base;
      chip.innerHTML = `
        <span class="detail-unit-avatar">
          ${
            portrait
              ? `<img src="${portrait.src}" alt="${escapeHtml(unit.name)}" />`
              : `<span class="detail-unit-swatch" style="background:${unit.color}"></span>`
          }
        </span>
        <span class="detail-unit-name">${escapeHtml(unit.name)}</span>
        ${isOnField ? '<span class="detail-unit-onfield" title="已在场上">场</span>' : ''}
        <span class="detail-unit-cost">${unit.cost}费</span>
      `;
      /*
        ★ 列出这个干员**自己拥有的全部羁绊**（你要求的）。
        【为什么要在这里看到？】
        因为看羁绊详情时你在做的是"凑人头"这个决策：
        "再上一个谁就能到 4 档？"
        只看到名字的话，你还得挨个点开干员信息才知道他还有什么标签 ——
        而真正有用的信息恰恰是"**他还能顺便帮我凑哪个羁绊**"。
        当前这个羁绊自己高亮，其余用暗色，一眼分得清主次。
      */
      const traitRow = document.createElement('div');
      traitRow.className = 'detail-unit-traits';
      for (const id of unit.traits) {
        const traitDef = TRAIT_DEFS[id];
        const tag = document.createElement('span');
        tag.className = `detail-unit-trait${id === traitId ? ' current' : ''}`;
        tag.textContent = traitDef?.name ?? id;
        tag.style.borderColor = traitColor(id);
        if (id === traitId) {
          tag.style.background = traitColor(id);
          tag.style.color = '#0d1420';
        }
        tag.addEventListener('click', (event) => {
          // 点标签直接跳到那个羁绊的详情 —— 顺着羁绊链看下去很顺手
          event.stopPropagation();
          if (id !== traitId) openTraitDetail(id);
        });
        traitRow.appendChild(tag);
      }
      chip.appendChild(traitRow);
      chip.title =
        `${unit.name}（${unit.cost} 费 · ${rarity.label}）` +
        `\n羁绊：${unit.traits.map((id) => TRAIT_DEFS[id]?.name ?? id).join(' · ')}` +
        `\n生命 ${unit.base.hp} · 攻击 ${unit.base.attackDamage} · 射程 ${unit.base.range}` +
        `\n${unit.skill.name}：${unit.skill.desc}` +
        (isOnField ? '\n（已在场上）' : '');
      el.detailUnits.appendChild(chip);
    }
  }

  el.traitsListView.classList.add('hidden');
  el.traitsDetailView.classList.remove('hidden');
}

/** 关闭羁绊详情，回到列表 */
function closeTraitDetail(): void {
  el.traitsDetailView.classList.add('hidden');
  el.traitsListView.classList.remove('hidden');
}

el.detailBack.addEventListener('click', () => closeTraitDetail());

// ============================================================
// 干员信息小窗口
// ============================================================

/**
 * 当前正在看哪个棋子（null = 关着）。
 *
 * 存的是 cell 而不是 defId —— 因为同一场战斗里可能有两个同名棋子，
 * 而"收回备战席"这种操作必须精确到那一个。
 */
/**
 * ★ 0.0.3：技能块下面的"详细说明"。
 *
 * 【为什么要它？】
 * 野怪的能力有一大半是**机制**（嘲讽 / 流血 / 周期落雷 / 一二阶段），
 * 而 `skill.desc` 只能塞一句话 —— 玩家点开详情页想知道"它到底会干什么"。
 * 这里把档位、一二阶段、逐条机制都列出来（文案由 shared 的 monsterSkillDetail 产出，
 * 和数值总表用的是同一份，不会两边对不上）。
 * 普通干员返回空串 —— 它们的说明已经写在技能描述里了。
 */
function skillDetailHtml(def: UnitDef): string {
  const lines = monsterSkillDetail(def);
  if (lines.length === 0) return '';
  return (
    `<div class="unit-info-skill-detail">` +
    lines.map((line) => `<div class="unit-info-skill-detail-line">· ${escapeHtml(line)}</div>`).join('') +
    `</div>`
  );
}

/**
 * "这个数比白板高还是低"的小记号（▲/▼）。
 *
 * 【为什么要有它？】
 * 数值一旦被羁绊 / 装备 / 战斗增益改过，光看一个数字玩家不知道是不是"应该这么大"。
 * 标一下就一眼能看出"这个数是堆出来的"，而不是数据表写错了。
 * （布阵面板和战斗面板共用这一个实现 —— 两处各写一份一定会有一天对不上。）
 */
function statLift(value: number, base: number): string {
  if (value > base) return `<em class="unit-info-up">▲</em>`;
  if (value < base) return `<em class="unit-info-down">▼</em>`;
  return '';
}

let unitInfoCell: Cell | null = null;

/**
 * ★★ 0.3.4 观战（用户口径）：「点他人干员查看面板和藏品，但不能动」。
 *
 * 对方棋盘上的棋子来自服务器广播的 `prepTeams`（`units` 里已经带了这枚棋子
 * 身上的 A 类藏品），所以**看信息**这件事完全不用新增协议。
 */
function viewedPlacementAt(cell: Cell): UnitPlacement | undefined {
  if (viewingPlayerId === null) return undefined;
  return (prepTeams[viewingPlayerId]?.units ?? []).find(
    (unit) => unit.cell.col === cell.col && unit.cell.row === cell.row,
  );
}

/**
 * ★ 0.3.4 观战：按**对方那一整套**算面板数值。
 *
 * 做法：把服务器给的那份阵容灌进一个**临时状态**，再走 `previewUnitStats` ——
 * 那是"开战时同一套算法"（羁绊 + 藏品 + 共享藏品 + 星级）。
 * ★ 绝不在这里另抄一份算法：抄一遍必然和开战结果走散（项目铁律）。
 * 临时状态是一次性的，不会写回任何东西，所以"不能动"是天然成立的。
 */
function viewedUnitStats(cell: Cell): ReturnType<typeof previewUnitStats> {
  if (viewingPlayerId === null) return null;
  const team = prepTeams[viewingPlayerId];
  if (!team) return null;
  try {
    const scratch = createGameState(1);
    applySubmittedTeam(scratch, {
      units: team.units,
      bench: team.bench,
      // 共享装备位在协议里是单独一项（不在 bag 快照里）
      sharedItems: (team.items?.bEquip ?? []).filter((id): id is string => typeof id === 'string'),
      itemState: { bag: { a: team.items?.a, b: team.items?.b, cert: team.items?.cert } },
    } as Parameters<typeof applySubmittedTeam>[1]);
    return previewUnitStats(scratch, cell);
  } catch {
    // 数据不全（刚开局 / 老服务器）就退回白板值，不要因为看别人一眼就崩掉
    return null;
  }
}

/**
 * 打开干员信息小窗口。
 *
 * 【为什么要"跟着棋子"显示，而不是居中弹窗？】
 * 因为看棋子信息的时候，你一定还在盯着棋盘考虑下一步。
 * 居中大弹窗会盖住战场，看两眼就得关掉 —— 这个来回很烦。
 * 小卡片贴在棋子旁边，眼睛不用移动太远。
 *
 * ★ 0.3.4：观战时传进来的 cell 是**对方棋盘**上的格子，
 *   placement / 数值都从 `prepTeams` 那一份取，面板是只读的。
 */
function openUnitInfo(cell: Cell, anchorX: number, anchorY: number): void {
  /*
    ★ 0.3.4：观战时这个面板是**只读**的 —— 数据换成对方那一份，
    底部的「收回」按钮也藏掉（它动的是我自己的备战席，点了会很荒唐）。
  */
  const viewing = viewingPlayerId !== null;
  const placement = viewing ? viewedPlacementAt(cell) : placementAt(state, cell);
  if (!placement) return;
  const def = UNIT_DEFS[placement.defId];
  if (!def) return;

  unitInfoCell = { col: cell.col, row: cell.row };
  const rarity = rarityOfCost(def.cost);
  const portrait = getLoadedImage(unitSpritePath(def.id));

  el.unitInfoName.textContent = def.name;
  el.unitInfoName.style.color = rarity.base;
  el.unitInfoSub.textContent = `${placement.star} 星 · ${def.cost} 费 · ${rarity.label} · 射程 ${def.base.range}`;

  el.unitInfoPortrait.style.borderColor = rarity.base;
  el.unitInfoPortrait.innerHTML = portrait
    ? `<img src="${portrait.src}" alt="${escapeHtml(def.name)}" />`
    : `<span class="unit-info-portrait-fallback" style="background:${def.color}"></span>`;

  /*
    ★ 0.0.3：数值走 `previewUnitStats` —— 它是**用开战那一套**（羁绊 + 藏品 +
    共享藏品 + 星级）算出来的，所以"详情页看到的" == "开战时真正用的"。
    ▲/▼ 是相对这枚棋子**自身白板**（基础 × 星级）的变化，
    一眼能看出"这个数是羁绊/装备堆出来的"。

    ★ 0.1.2：这份"白板"统一走内核的 `unitBaseStats`，并且**把测试模式的
    数值覆盖一起算进去**。两个理由：
      1. 以前这里是界面自己算的 `def.base.hp * starMul` —— **漏了 3 星质变那部分加血**，
         于是 3 星棋子详情页里的白板永远比实际低一截，▲▼ 全错；
      2. 「数值修改」改过的卡，▲▼ 必须拿"我改成的那份白板"当基准，
         否则改完生命会莫名其妙一直显示 ▲。
  */
  /*
    ★ 0.3.4：看别人的棋子时没有 `uid`（那是本地状态才有的），
    也就没有「测试模式数值修改」这回事 —— 白板走内核默认值。
  */
  const override = viewing || !('uid' in placement) ? undefined : unitStatOverrideOf(state, placement.uid as number);
  const fixBase = unitBaseStats(def, placement.star, override);
  const baseStats = {
    hp: Math.round(fixBase.hp / FIX),
    attackDamage: Math.round(fixBase.attackDamage / FIX),
    attackSpeed: fixBase.attackSpeed / 1000,
    armor: Math.round(fixBase.armor / FIX),
    magicResist: Math.round(fixBase.magicResist / FIX),
    range: fixBase.range,
  };
  // ★ 0.3.4：看别人的棋子时，数值按**他那套阵容**现算（临时状态，不写回）
  const stats = (viewing ? viewedUnitStats(cell) : previewUnitStats(state, cell)) ?? baseStats;
  const boosted =
    stats.hp !== baseStats.hp ||
    stats.attackDamage !== baseStats.attackDamage ||
    stats.attackSpeed !== baseStats.attackSpeed ||
    stats.armor !== baseStats.armor ||
    stats.magicResist !== baseStats.magicResist ||
    stats.range !== baseStats.range;

  el.unitInfoStats.innerHTML = `
    <span>生命 <strong>${stats.hp}${statLift(stats.hp, baseStats.hp)}</strong></span>
    <span>攻击 <strong>${stats.attackDamage}${statLift(stats.attackDamage, baseStats.attackDamage)}</strong></span>
    <span>攻速 <strong>${stats.attackSpeed.toFixed(2)}${statLift(stats.attackSpeed, baseStats.attackSpeed)}</strong></span>
    <span>护甲 <strong>${stats.armor}${statLift(stats.armor, baseStats.armor)}</strong></span>
    <span>魔抗 <strong>${stats.magicResist}${statLift(stats.magicResist, baseStats.magicResist)}</strong></span>
    <span>射程 <strong>${stats.range}${statLift(stats.range, baseStats.range)}</strong></span>
    ${
      boosted
        ? `<div class="unit-info-stats-note">
             已含羁绊 / 藏品加成（▲▼ 是相对干员自身白板的变化）
           </div>`
        : ''
    }
  `;

  /*
    ★ 0.0.3：**野怪没有羁绊**（traits 恒为空），所以整块藏掉 ——
    否则会留一个空的"羁绊"标题，看起来像界面坏了。
  */
  el.unitInfoTraits.innerHTML = '';
  el.unitInfoTraits.classList.toggle('hidden', def.monsterOnly === true);

  // 羁绊：显示「名字 + 当前几人 / 下一档要几人」，并标出这个干员贡献了哪些
  const statuses = currentTraits(state);
  for (const traitId of def.traits) {
    const traitDef = TRAIT_DEFS[traitId];
    const status = statuses.find((t) => t.traitId === traitId);
    const chip = document.createElement('div');
    const active = Boolean(status && status.activeAt !== null);
    chip.className = `unit-info-trait${active ? ' active' : ''}`;
    chip.style.borderLeftColor = traitColor(traitId);
    const progress =
      status === undefined || status.count === 0
        ? '未上场'
        : status.activeAt !== null
          ? `已生效 ${status.activeAt} 档`
          : status.nextAt !== null
            ? `${status.count}/${status.nextAt}`
            : `${status.count} 个`;
    chip.innerHTML =
      `<span class="unit-info-trait-name">${escapeHtml(traitDef?.name ?? traitId)}</span>` +
      `<span class="unit-info-trait-progress">${progress}</span>`;
    chip.title = traitDef
      ? traitDef.tiers.map((tier) => `${tier.count} 个：${tier.desc}`).join('\n')
      : '';
    // 点羁绊 -> 直接跳到那个羁绊的详情页（顺手，不用再回列表找）
    chip.addEventListener('click', () => {
      closeUnitInfo();
      openTraitDetail(traitId);
    });
    el.unitInfoTraits.appendChild(chip);
  }

  /*
    技能：**按当前星级显示那一套**。
    ★ 这是「3 星专属技能替换掉 1/2 星技能」这条规则在界面上的体现 ——
    如果你手里是 3 星棋子，看到的必须是它 3 星真正会放的那个技能，
    而不是 1/2 星那个（否则你会照着错误的说明去配阵容）。
  */
  const variant = skillVariantOf(def, placement.star);
  const isStar3Variant = placement.star >= 3 && !!def.skill.star3;
  const manaLabel =
    def.skill.manaSource === 'none'
      ? '不回复'
      : def.skill.manaSource === 'attack'
        ? '攻击回复'
        : def.skill.manaSource === 'damage'
          ? '受击回复'
          : `自动回复（每秒 ${def.skill.manaPerSecond ?? 0} 点）`;
  const kindLabel = variant.effects.length === 0 ? '被动' : '主动';
  el.unitInfoSkill.innerHTML =
    `<div class="unit-info-skill-head">` +
    `<span class="unit-info-skill-badge${isStar3Variant ? ' star3' : ''}">${isStar3Variant ? '3 星专属' : kindLabel}</span>` +
    `<span class="unit-info-skill-mana">${manaLabel}</span>` +
    `</div>` +
    `<div class="unit-info-skill-name">${escapeHtml(variant.name)}</div>` +
    `<div class="unit-info-skill-desc">${escapeHtml(variant.desc)}</div>` +
    (isStar3Variant
      ? `<div class="unit-info-skill-note">这个棋子到 3 星时**只生效这一套**，1、2 星的技能不再生效</div>`
      : '') +
    (def.skill.star3 && !isStar3Variant
      ? `<div class="unit-info-skill-note dim">升到 3 星会换成「${escapeHtml(def.skill.star3.name)}」</div>`
      : '') +
    skillDetailHtml(def);

  preparePrepUnitInfoPanel();
  /*
    ★ 0.3.4：观战时藏掉「收回」按钮 —— 它动的是**我自己的**备战席，
    看着别人的棋子点下去会很荒唐（而且真的会从我场上收回一个棋子）。
  */
  el.unitInfoRecall.classList.toggle('hidden', viewing);
  // ★ 0.0.3 藏品：这个干员身上那两件装备（必须在 preparePrepUnitInfoPanel 之后填，
  //   因为那一步会把整块藏起来，顺序反了就会被它盖掉）。
  //   ★ 野怪不能穿戴装备 —— 整块藏起来，不给它两个空装备位。
  renderUnitInfoItems(def.monsterOnly ? null : placement);
  el.unitInfo.classList.remove('hidden');
  positionUnitInfo(anchorX, anchorY);
}

/**
 * 布阵阶段的面板：恢复"可以收回棋子"的按钮，并藏掉只在战斗中用的技能条。
 *
 * 【为什么要分开？】
 * 战斗中的面板和布阵的面板共用同一块 DOM（#unit-info），
 * 但两者能做的事不一样：战斗中不能收回棋子（阵容已经锁了），
 * 而布阵阶段没有"技能攒了多少"这回事。
 * 不做这个切换的话，会出现"战斗中给你一个收回按钮，点了报错"这种怪事。
 */
function preparePrepUnitInfoPanel(): void {
  battleInfoUnitId = null;
  lastBattleInfoKey = '';
  lastBattleEffectsKey = '';
  el.unitInfoRecall.classList.remove('hidden');
  el.unitInfoManabar.classList.add('hidden');
  /*
    ★ 0.1.1：标题回到「羁绊」。
    战斗中它会被改成「当前效果」（那一栏显示的是 runtime 效果）——
    不还原的话，布阵时下面列着一堆羁绊、标题却写着"当前效果"，很怪。
  */
  el.unitInfoTraitsTitle.textContent = '羁绊';
  // ★ 0.0.3：战斗中/别的路径进来的默认没有藏品信息，先藏起来，
  //   真要看装备的是 openUnitInfo（它会填完再显示）
  el.unitInfoItemsBlock.classList.add('hidden');
}

/**
 * 把卡片摆在棋子旁边，并保证不超出屏幕。
 *
 * 【为什么要 clamp？】
 * 点棋盘边缘的棋子时，卡片会有一半跑到屏幕外 —— 那样就白点了一次。
 * 所以先按"棋子的右下方"摆，超出就翻到另一边，再不行就贴边。
 */
function positionUnitInfo(anchorX: number, anchorY: number): void {
  const rect = el.unitInfo.getBoundingClientRect();
  const margin = 12;
  let x = anchorX + margin;
  let y = anchorY + margin;

  if (x + rect.width > window.innerWidth - margin) x = anchorX - rect.width - margin;
  if (y + rect.height > window.innerHeight - margin) y = anchorY - rect.height - margin;

  x = Math.max(margin, Math.min(x, window.innerWidth - rect.width - margin));
  y = Math.max(margin, Math.min(y, window.innerHeight - rect.height - margin));

  el.unitInfo.style.left = `${Math.round(x)}px`;
  el.unitInfo.style.top = `${Math.round(y)}px`;
}

function closeUnitInfo(): void {
  unitInfoCell = null;
  // ★ 战斗中的实时面板也要跟着关，否则 frame() 会继续往上写数据
  battleInfoUnitId = null;
  el.unitInfo.classList.add('hidden');
}

// ============================================================
// ★ 0.1.2 测试模式：干员基础属性修改
// ============================================================

/**
 * 「数值修改」开关（修改器面板里那一个）。
 *
 * 【它和 `state.testMode` 的分工】
 * `testMode` = "能不能用修改器"；这个是"点干员时弹哪个面板"。
 * 所以关掉修改器面板、切阵营、离开测试模式，都要把它一起关掉 —— 否则
 * 你会遇到"修改器都关了，点干员还是弹不出详情页"这种莫名其妙的状态。
 */
let statEditMode = false;
/** 编辑面板当前对应的格子（跟着棋子走；棋子没了就自动收起） */
let unitEditCell: Cell | null = null;
/** 字段行建过没有 —— 可改的数值是静态的，建一次就够 */
let unitEditRowsBuilt = false;

/**
 * 可改的数值清单 —— **加一项只改这里**（界面那 6 行是照它生成的）。
 *
 * 【为什么用一张表而不是写 6 遍？】
 * 因为每一行要做的事完全一样：填初值、读值、判断"改过没"、算面板单位。
 * 写 6 遍的结果一定是"新加的那一项忘了算单位"（例如攻速 1200 直接填进面板）。
 *
 * 单位一律是**面板单位**（血量 4500、攻速 1.2、射程 3）：
 * 和 `UnitStatOverride` 一致，"面板单位 -> 内核定点数"的换算只在内核里做一次。
 */
const UNIT_STAT_FIELDS: Array<{
  key: 'hp' | 'attackDamage' | 'attackSpeed' | 'armor' | 'magicResist' | 'range';
  label: string;
  unit: string;
  step: number;
  min: number;
  /** 从 shared 的 `unitBaseStats` 结果里取白板值（已换算成面板单位） */
  fromBase: (base: UnitBasePanel) => number;
}> = [
  { key: 'hp', label: '生命', unit: '', step: 50, min: 1, fromBase: (b) => b.hp },
  { key: 'attackDamage', label: '攻击', unit: '', step: 10, min: 0, fromBase: (b) => b.attackDamage },
  { key: 'attackSpeed', label: '攻速', unit: '次/秒', step: 0.05, min: 0.1, fromBase: (b) => b.attackSpeed },
  { key: 'armor', label: '护甲', unit: '', step: 5, min: 0, fromBase: (b) => b.armor },
  { key: 'magicResist', label: '魔抗', unit: '', step: 5, min: 0, fromBase: (b) => b.magicResist },
  { key: 'range', label: '射程', unit: '格', step: 1, min: 1, fromBase: (b) => b.range },
];

/** 白板数值的**面板单位**版本（就是面板上会显示的那几个数） */
interface UnitBasePanel {
  hp: number;
  attackDamage: number;
  attackSpeed: number;
  armor: number;
  magicResist: number;
  range: number;
}

/**
 * 某张卡的"白板 + 覆盖"换算成面板单位。
 *
 * 【为什么先把覆盖合进去再换算？】
 * 因为面板上要显示的就是"这张卡现在的基础值" —— 改过的卡再打开面板，
 * 输入框里应该是**上次填的数**，而不是数据表里的原值（否则你会以为没保存成功）。
 * 合一这件事交给内核的 `unitBaseStats` 做（它本来就是唯一实现）。
 *
 * ⚠️ 这个函数返回的是**"当前值"**（含覆盖），**不能**拿来当"数据表原值"用 ——
 * "改没改过"要比的是 `unitTrueBasePanelOf`（见它的说明）。
 */
function unitBasePanelOf(defId: string, star: number, uid: number): UnitBasePanel | null {
  const def = UNIT_DEFS[defId];
  if (!def) return null;
  return toPanelBase(unitBaseStats(def, star, unitStatOverrideOf(state, uid)));
}

/**
 * ★ 0.1.2 修：某张卡在**数据表里的原值**（不含「数值修改」的覆盖）。
 *
 * 【为什么必须单独有它？—— 这里踩过一个"改完数值就复原"的 bug】
 * 面板要判"这一项是不是被改过"，基准必须是**数据表原值**。
 * 以前 open/save 两处都用了 `unitBasePanelOf()`（含覆盖）当基准，于是：
 *   · 改过 8888 的卡再打开面板，输入框 tooltip 写着"数据表原值：8888"（其实是改过的值）；
 *   · 更糟的是**原样按一次「保存」**：填的值 == 含覆盖的"基准" ⇒ 被判成"等于原值"
 *     ⇒ 把这一项从覆盖表里删掉 ⇒ 数值当场退回数据表白板。
 * 用户看到的就是"改完干员数值，过一会儿（再保存/切阵营后重开）数值复原了"。
 */
function unitTrueBasePanelOf(defId: string, star: number): UnitBasePanel | null {
  const def = UNIT_DEFS[defId];
  if (!def) return null;
  return toPanelBase(unitBaseStats(def, star));
}

/** 内核的"基础×星级"结果 -> 面板单位（换算只写在这一处） */
function toPanelBase(fix: {
  hp: number;
  attackDamage: number;
  attackSpeed: number;
  armor: number;
  magicResist: number;
  range: number;
}): UnitBasePanel {
  return {
    hp: Math.round(fix.hp / FIX),
    attackDamage: Math.round(fix.attackDamage / FIX),
    attackSpeed: Math.round((fix.attackSpeed / 1000) * 100) / 100,
    armor: Math.round(fix.armor / FIX),
    magicResist: Math.round(fix.magicResist / FIX),
    range: fix.range,
  };
}

/** 字段行（只建一次）。每行的 data 属性带上字段名，取值时不用再按顺序猜 */
function buildUnitEditRows(): void {
  if (unitEditRowsBuilt) return;
  unitEditRowsBuilt = true;
  el.unitEditRows.innerHTML = '';
  for (const field of UNIT_STAT_FIELDS) {
    const row = document.createElement('label');
    row.className = 'unit-edit-row';
    row.dataset.field = field.key;

    const name = document.createElement('span');
    name.textContent = field.label;

    const input = document.createElement('input');
    input.type = 'number';
    input.step = String(field.step);
    input.min = String(field.min);
    input.dataset.field = field.key;

    const unit = document.createElement('span');
    unit.className = 'unit-edit-unit';
    unit.textContent = field.unit;

    row.append(name, input, unit);
    el.unitEditRows.appendChild(row);
  }
}

/** 本行对应的输入框（唯一取法，避免各处用不同选择器） */
function unitEditInputOf(key: string): HTMLInputElement | null {
  return el.unitEditRows.querySelector<HTMLInputElement>(`input[data-field="${key}"]`);
}

/**
 * 打开"基础属性修改"面板。
 *
 * 【为什么它和详情页是**互斥**的？】
 * 用户的要求：开着数值修改时点干员**不弹详情页**，弹这个。
 * 两个面板都跟着同一个棋子、位置算法也一样，同时弹会重叠在一起看不清；
 * 而且它们的信息量完全不同（一个看、一个改），同时出现只会互相挡。
 * 所以入口处就分叉（见 handleBoardClick），而不是"都弹，再盖一层"。
 */
function openUnitEditor(cell: Cell, anchorX: number, anchorY: number): void {
  const placement = placementAt(state, cell);
  if (!placement) return;
  const def = UNIT_DEFS[placement.defId];
  if (!def) return;

  buildUnitEditRows();
  unitEditCell = { col: cell.col, row: cell.row };

  // current：这张卡**现在**的值（含覆盖）—— 回填输入框用
  const board = unitBasePanelOf(placement.defId, placement.star, placement.uid);
  // truth：数据表**原值**（不含覆盖）—— tooltip 与"改没改过"的基准用
  const truth = unitTrueBasePanelOf(placement.defId, placement.star);
  if (!board || !truth) return;
  const override = unitStatOverrideOf(state, placement.uid) ?? {};

  el.unitEditTitle.textContent = def.name;
  el.unitEditTitle.style.color = rarityOfCost(def.cost).base;
  el.unitEditSub.textContent =
    `${placement.star} 星 · ${def.cost} 费 · ` +
    (Object.keys(override).length > 0 ? '已改过数值' : '未改动');
  el.unitEditError.textContent = '';

  for (const field of UNIT_STAT_FIELDS) {
    const input = unitEditInputOf(field.key);
    if (!input) continue;
    const current = override[field.key];
    input.value = String(current ?? field.fromBase(board));
    input.title = `数据表原值：${field.fromBase(truth)}`;
    // 标出"这一项被改过" —— 不然下次打开分不清哪些是自己填的
    const row = input.closest('.unit-edit-row');
    row?.classList.toggle('changed', current !== undefined && current !== field.fromBase(truth));
  }

  el.unitEdit.classList.remove('hidden');
  positionUnitEditor(anchorX, anchorY);
}

function closeUnitEditor(): void {
  unitEditCell = null;
  el.unitEdit.classList.add('hidden');
}

/**
 * 面板里的输入和"这张卡现在的值"不一样吗？（点面板外面时用来决定要不要顺手落盘）
 *
 * 【判据为什么这么绕？】因为"空 = 不改"、"非法输入 = 要报错"：
 *   · 输入框是空的 → 这一项本来就不参与保存，不算动过；
 *   · 填了字母 / 0（非法）→ **算动过**，这样落盘时会被拦下来并报错，
 *     而不是被静默丢掉；
 *   · 其余就看是不是等于当前值（覆盖值优先，没覆盖就是数据表白板）。
 */
function unitEditorDirty(): boolean {
  if (!unitEditCell) return false;
  const placement = placementAt(state, unitEditCell);
  if (!placement) return false;
  const board = unitBasePanelOf(placement.defId, placement.star, placement.uid);
  if (!board) return false;
  const override = unitStatOverrideOf(state, placement.uid) ?? {};
  return UNIT_STAT_FIELDS.some((field) => {
    const input = unitEditInputOf(field.key);
    if (!input) return false;
    const raw = input.value.trim();
    if (raw === '') return false;
    const value = Number(raw);
    if (!Number.isFinite(value)) return true;
    return Math.abs(value - (override[field.key] ?? field.fromBase(board))) > 1e-6;
  });
}

/** 和 #unit-info 同一套 clamp（贴棋子、越界翻边、再不行贴屏幕边） */
function positionUnitEditor(anchorX: number, anchorY: number): void {
  const rect = el.unitEdit.getBoundingClientRect();
  const margin = 12;
  let x = anchorX + margin;
  let y = anchorY + margin;

  if (x + rect.width > window.innerWidth - margin) x = anchorX - rect.width - margin;
  if (y + rect.height > window.innerHeight - margin) y = anchorY - rect.height - margin;

  x = Math.max(margin, Math.min(x, window.innerWidth - rect.width - margin));
  y = Math.max(margin, Math.min(y, window.innerHeight - rect.height - margin));

  el.unitEdit.style.left = `${Math.round(x)}px`;
  el.unitEdit.style.top = `${Math.round(y)}px`;
}

/**
 * 保存：把面板里的数字写成**这张卡**的基础属性覆盖。
 *
 * 【"没改"要能表达出来】
 * 输入框里填的正好等于数据表原值 -> 把这一项从覆盖里**删掉**（而不是写一个
 * 数值相同的覆盖）。这样"改过没"是一眼可查的，而且不会因为以后调了数据表
 * 而让这张卡继续钉着旧值。
 *
 * 【校验只有两条，但都必须有】
 *   · 必须是数字（输入框可以是空的 / 手输字母）；
 *   · 必须 >= 下限（血量 0 会变成一具永远打不死的尸体、攻速 0 会让攻击间隔无穷大）。
 * 越界的**不静默改写成边界值**，而是报错让人自己看一眼 —— 静默改写会让人以为
 * "我填的 0 生效了"，结果是错的。
 *
 * @returns true = 处理完了（保存成功 / 本来就没开面板 / 面板被关掉）；
 *   false = **有校验错误**，面板留着等玩家改（调用方要据此决定"要不要继续做别的事"，
 *   比如切阵营时先落盘，报错就别切过去）。
 */
function saveUnitEditor(): boolean {
  if (!unitEditCell) return true;
  const placement = placementAt(state, unitEditCell);
  if (!placement) {
    closeUnitEditor();
    return true;
  }
  const def = UNIT_DEFS[placement.defId];
  if (!def) return true;

  // ★ 判"是不是没改"要比**数据表原值**（不含覆盖）—— 用含覆盖的 current 当基准，
  //   原样保存会把玩家改过的值判成"等于原值"从而删掉覆盖（见 unitTrueBasePanelOf）。
  const truth = unitTrueBasePanelOf(placement.defId, placement.star);
  if (!truth) return true;

  const next: UnitStatOverride = {};
  const errors: string[] = [];

  for (const field of UNIT_STAT_FIELDS) {
    const input = unitEditInputOf(field.key);
    if (!input) continue;
    const raw = input.value.trim();
    if (raw === '') continue; // 空 = 不改
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      errors.push(`${field.label} 不是数字`);
      continue;
    }
    if (value < field.min) {
      errors.push(`${field.label} 不能小于 ${field.min}`);
      continue;
    }
    // 和数据表原值一样 = 不算改过（见上面的说明）
    const equal = Math.abs(value - field.fromBase(truth)) < 1e-6;
    if (!equal) next[field.key] = value;
  }

  if (errors.length > 0) {
    el.unitEditError.textContent = errors.join('；');
    return false;
  }

  setUnitStatOverride(state, placement.uid, Object.keys(next).length > 0 ? next : null);
  el.unitEditError.textContent = '';
  const name = def.name;
  closeUnitEditor();
  renderAll();
  toast(
    Object.keys(next).length > 0
      ? `${name} 的基础属性已改动（只影响这一张卡）`
      : `${name} 已恢复成数据表里的原值`,
  );
  return true;
}

// ============================================================
// 战斗中：点干员看实时属性 + 技能条
// ============================================================

/**
 * 战斗中点开某个棋子的详情面板。
 *
 * 【和布阵阶段那个面板的区别】
 *   布阵阶段的数据来自 `state.placements`（"我打算这么摆"）——是静态的。
 *   战斗中的数据来自 `replay`（"它现在实际怎么样"）——每帧都在变：
 *   血量在掉、法力在涨、身上可能刚吃了个盾。
 * 所以这个面板必须**每帧刷新**（见 updateBattleUnitInfo），
 * 而且战斗一结束就要关掉（数据源没了，留着就是假信息）。
 */
function openBattleUnitInfo(unitId: number, anchorX: number, anchorY: number): void {
  const info = replay.unitInfo(unitId);
  if (!info) return;
  const def = UNIT_DEFS[info.defId];
  if (!def) return;

  battleInfoUnitId = unitId;
  unitInfoCell = null;
  el.unitInfoRecall.classList.add('hidden'); // 战斗中不能收回棋子
  /*
    ★ 0.0.3：战斗里也能看到这个棋子身上的装备 ——
    数据来自开打时抄好的对照表（见 applyBattleItems）。
    一件都没有就把整栏藏掉：战斗中满屏都是数字，两行"装备位：空"纯属噪声。
    （"卸下"按钮在这些行里是禁用的：uid 是 undefined，含义就是"战斗中的棋子不能改装备"）
  */
  const battleItems = battleItemIds.get(unitId) ?? [];
  if (battleItems.length > 0) renderUnitInfoItems({ items: battleItems });
  else el.unitInfoItemsBlock.classList.add('hidden');

  const rarity = rarityOfCost(def.cost);
  const portrait = getLoadedImage(unitSpritePath(def.id));
  el.unitInfoName.textContent = def.name;
  el.unitInfoName.style.color = rarity.base;
  el.unitInfoSub.textContent =
    `${info.star} 星 · ${def.cost} 费 · ${rarity.label} · ` +
    (info.mine ? '我方' : '敌方') +
    (info.dead ? ' · 已阵亡' : '');

  el.unitInfoPortrait.style.borderColor = info.mine ? '#3ddc84' : '#ff5a5a';
  el.unitInfoPortrait.innerHTML = portrait
    ? `<img src="${portrait.src}" alt="${escapeHtml(def.name)}" />`
    : `<span class="unit-info-portrait-fallback" style="background:${def.color}"></span>`;

  renderBattleInfoSkill(def, info);
  updateBattleUnitInfo(); // 立刻刷一次，别等下一帧
  el.unitInfo.classList.remove('hidden');
  positionUnitInfo(anchorX, anchorY);
}

/** 面板上的技能说明部分（战斗中：星级固定，和布阵那边口径一致） */
function renderBattleInfoSkill(
  def: (typeof UNIT_DEFS)[string],
  info: NonNullable<ReturnType<typeof replay.unitInfo>>,
): void {
  const variant = skillVariantOf(def, info.star);
  const isStar3Variant = info.star >= 3 && !!def.skill.star3;
  const manaLabel =
    def.skill.manaSource === 'none'
      ? '不回复'
      : def.skill.manaSource === 'attack'
        ? '攻击回复'
        : def.skill.manaSource === 'damage'
          ? '受击回复'
          : `自动回复（每秒 ${def.skill.manaPerSecond ?? 0} 点）`;
  el.unitInfoSkill.innerHTML =
    `<div class="unit-info-skill-head">` +
    `<span class="unit-info-skill-badge${isStar3Variant ? ' star3' : ''}">${isStar3Variant ? '3 星专属' : '技能'}</span>` +
    `<span class="unit-info-skill-mana">${manaLabel}</span>` +
    `</div>` +
    `<div class="unit-info-skill-name">${escapeHtml(variant.name)}</div>` +
    `<div class="unit-info-skill-desc">${escapeHtml(variant.desc)}</div>` +
    skillDetailHtml(def);

  // 被动技能没有法力条 —— 一直生效，没有"攒蓝"这回事
  const isPassive = variant.effects.length === 0;
  el.unitInfoManabar.classList.toggle('hidden', isPassive);
  /*
    ★ 0.1.1：羁绊面板在战斗中意义不大（数据是布阵时的），换成「当前效果」。
    这块以前是**手写的五个 flag**（护盾/攻速↑/攻击↑/眩晕/闪避），
    数据来自 `visual.effects` —— 那套只是"给卡面画特效"用的粗粒度标记。
    结果就是：隐匿、无敌、免死、流血、飞行这些**在面板上根本看不见**，
    而且每加一种效果都要回来改一次这里（一定会忘）。
    现在统一走 `replay.effectsOf()`（底层是 status-effects.ts 的登记表），
    加新效果 = 改 shared 一处，这里一行都不用动。
  */
  el.unitInfoTraitsTitle.textContent = '当前效果';
  // 先清空 key 再刷 —— 换了一个棋子看，上次的 key 是别人的，不能拿它当判据
  lastBattleEffectsKey = '';
  refreshBattleEffects(info.unitId);
}

/**
 * ★ 0.1.1 藏品二版：详情页的「当前效果」一栏。
 *
 * 每一条 = 效果的中文名 + 具体数值 + 剩余时间（有时限的才有），
 * 颜色和边框跟着效果自身的主题色走（`EFFECT_DEFS`），
 * 所以"这是好事还是坏事"不用读完字就能看出来。
 */
function renderUnitInfoEffects(effects: readonly ActiveEffect[]): void {
  el.unitInfoTraits.innerHTML = '';
  if (effects.length === 0) {
    const none = document.createElement('div');
    none.className = 'unit-info-effects-empty';
    none.textContent = '当前没有生效中的效果';
    el.unitInfoTraits.appendChild(none);
    return;
  }
  for (const effect of effects) {
    const chip = document.createElement('div');
    chip.className = `unit-info-effect ${effect.polarity}`;
    chip.style.borderLeftColor = effect.color;
    chip.title = effect.desc;

    const icon = document.createElement('span');
    icon.className = 'unit-info-effect-icon';
    icon.textContent = effect.icon;

    const name = document.createElement('span');
    name.className = 'unit-info-effect-name';
    name.textContent = effect.name;
    name.style.color = effect.color;

    chip.appendChild(icon);
    chip.appendChild(name);

    if (effect.detail) {
      const detail = document.createElement('span');
      detail.className = 'unit-info-effect-detail';
      detail.textContent = effect.detail;
      chip.appendChild(detail);
    }
    /*
      ★ 0.1.3：剩余时间 / 剩余次数统一走 `durationText`。
      "按时间"的显示「剩 2.4 秒」，"按次数"的显示「剩 3 次」，
      "整场"的显示「整场」，一次性的没有"剩余"可显示（返回空串就整段跳过）。
    */
    if (effect.duration) {
      const text = durationText(effect.duration);
      if (text) {
        const time = document.createElement('span');
        time.className = 'unit-info-effect-time';
        time.textContent = text;
        chip.appendChild(time);
      }
    }
    el.unitInfoTraits.appendChild(chip);
  }
}

/**
 * 效果签名的"持续时间"部分（用来判断详情页要不要重画）。
 *
 * 按时间按 **0.2 秒**取整（20 tick/秒 ÷ 5）—— 不取整的话每帧都在变，
 * 面板会被无意义地重画几十次；次数原样（它只在挨攻击时才变）。
 */
function effectDurationKey(effect: ActiveEffect): string {
  const duration = effect.duration;
  if (!duration) return '';
  if (duration.kind === 'time') return String(Math.ceil(duration.ticksLeft / 4));
  if (duration.kind === 'count') return `x${duration.left}`;
  return duration.kind;
}

/**
 * 战斗面板的每帧刷新：血量、法力、技能条。
 *
 * 【为什么每帧刷而不是每 tick 刷？】
 * 血量是按"本地回放时间"推进的，中间有插值；每帧刷才能和画面上的血条同步。
 * 但写 DOM 有成本，所以只在数字真的变了才写（见下面的比较）。
 */
function updateBattleUnitInfo(): void {
  if (battleInfoUnitId === null) return;
  const info = replay.unitInfo(battleInfoUnitId);
  if (!info) {
    // 棋子已经彻底消失（死亡动画放完）—— 面板没东西可显示了
    closeUnitInfo();
    return;
  }
  const def = UNIT_DEFS[info.defId];
  if (!def) return;

  // 血量：战斗中最关心的就是"还剩多少"
  const hpClass = info.mine ? '' : 'enemy';
  /*
    ★ 0.0.3：战斗中的属性要显示**实时值**（"攻速、双抗等会随战斗变化"）。
    基线（被动 / 羁绊 / 藏品 / 开局光环）由播放器在 load 时算好，
    增益（技能、"复仇者"半血的狂暴…）再随事件叠上去 ——
    所以这里拿到的是此刻真正生效的数字，而不是数据表里的白板。

    ★ `liveStatsOf` 返回的全是**面板单位**（攻速是"每秒几次"）。
    以前这里直接把内核的定点数当面板值用，攻击力会显示成 675000 这种数
    （用户报的"干员详细页面的数据显示过大"）。
  */
  const live = replay.liveStatsOf(battleInfoUnitId);
  const speed = live?.attackSpeed ?? def.base.attackSpeed / 1000;
  const attack = live?.attackDamage ?? def.base.attackDamage;
  const armor = live?.armor ?? def.base.armor;
  const magicResist = live?.magicResist ?? def.base.magicResist;
  const range = live?.range ?? def.base.range;

  /*
    ★ 0.1.1：效果那一栏**先刷**（它和属性是两套变化节奏，见 lastBattleEffectsKey）。
    放在下面那个"属性没变就 return"之前 —— 否则站着不动的时候
    "剩几秒"永远停在旧值上。
  */
  refreshBattleEffects(battleInfoUnitId);

  const wanted = `${info.hp}/${info.maxHp}/${info.shield}`;
  const liveKey = `${wanted}|${info.mana}|${info.dead}|${hpClass}|${speed}|${attack}|${armor}|${magicResist}|${range}`;
  if (liveKey === lastBattleInfoKey) return; // 没变就别碰 DOM
  lastBattleInfoKey = liveKey;

  /*
    血量那一行要把**护盾**一起画出来（你要求的）。
    画法：血条后面接一小段青色，代表"还有多少盾" ——
    盾和血加起来才是"还能扛多少"。数值也单独写出来，
    因为百分比看不出"这个盾值不值得再吃一发"。
  */
  const hpPercent = Math.max(0, Math.min(100, Math.round(info.hpPercent * 100)));
  const shieldPercent =
    info.maxHp > 0 ? Math.max(0, Math.min(100, Math.round((info.shield / info.maxHp) * 100))) : 0;
  el.unitInfoStats.innerHTML =
    `<span>生命 <strong>${info.hp} / ${info.maxHp}</strong></span>` +
    `<span>护盾 <strong>${info.shield}</strong></span>` +
    `<span>攻击 <strong>${Math.round(attack)}${statLift(attack, def.base.attackDamage)}</strong></span>` +
    `<span>攻速 <strong>${speed.toFixed(2)}${statLift(speed, def.base.attackSpeed / 1000)}</strong></span>` +
    `<span>护甲 <strong>${Math.round(armor)}${statLift(armor, def.base.armor)}</strong></span>` +
    `<span>魔抗 <strong>${Math.round(magicResist)}${statLift(magicResist, def.base.magicResist)}</strong></span>` +
    `<span>射程 <strong>${range}${statLift(range, def.base.range)}</strong></span>` +
    `<div class="unit-info-livehp" style="grid-column:1 / -1">` +
    `<span>血量</span>` +
    `<div class="unit-info-livehp-track">` +
    `<div class="unit-info-livehp-fill ${hpClass}" style="width:${hpPercent}%"></div>` +
    (shieldPercent > 0
      ? `<div class="unit-info-livehp-shield" style="width:${shieldPercent}%"></div>`
      : '') +
    `</div>` +
    `</div>`;

  // 技能条
  const percent = Math.max(0, Math.min(100, Math.round((info.mana / MANA_MAX) * 100)));
  el.unitInfoManaFill.style.width = `${percent}%`;
  el.unitInfoManaText.textContent = `${info.mana} / ${MANA_MAX}`;
  const ready = info.mana >= MANA_MAX;
  const justCast = info.castCount > 0 && info.mana < MANA_MAX * 0.15;
  el.unitInfoManaFill.classList.toggle('ready', ready);
  el.unitInfoManaFill.classList.toggle('cooling', justCast && !ready);
  el.unitInfoManaState.classList.toggle('ready', ready);
  el.unitInfoManaState.textContent = info.dead
    ? '已阵亡'
    : ready
      ? '技能就绪 —— 下一次出手就会释放'
      : justCast
        ? `刚放完技能，正在冷却（已释放 ${info.castCount} 次）`
        : `技能回复中（已释放 ${info.castCount} 次）`;

  /*
    ★ 0.1.1：效果那一栏在函数开头就刷过了（它和属性是两套变化节奏，
    见 lastBattleEffectsKey 的说明），所以这里**不再重复刷一遍** ——
    同一个函数里刷两次只会白建一次 DOM。
  */
}

/**
 * ★ 0.1.1：把「当前效果」那一栏重画成这个棋子此刻的效果。
 *
 * 【为什么单独一个函数？】
 * 两个原因：① 变化判据（剩余时间按 0.2 秒取整）只有这里一处，
 * 别处想刷也调它，不会出现两套取整口径；
 * ② `updateBattleUnitInfo` 里那句"属性没变就 return"会把它一起挡掉 ——
 * 所以调用点必须在那句**之前**，收成函数之后这个顺序很好核对。
 */
function refreshBattleEffects(unitId: number | null): void {
  if (unitId === null) return;
  const effects = replay.effectsOf(unitId);
  const key = effects
    .map((e) => `${e.kind}:${e.detail ?? ''}:${effectDurationKey(e)}`)
    .join('|');
  if (key === lastBattleEffectsKey) return;
  lastBattleEffectsKey = key;
  renderUnitInfoEffects(effects);
}

/** 上一次写进战斗面板的内容，用来避免每帧都碰 DOM */
let lastBattleInfoKey = '';

/**
 * ★ 0.1.1：上一次画进「当前效果」那一栏的内容。
 *
 * 【为什么要单独一个 key，不并进 lastBattleInfoKey？】
 * 效果是"事件驱动"的（吃了一发眩晕才变），而属性是"每 tick 都可能变"的。
 * 并在一起的话，属性一变就要连效果一起重建 DOM；
 * 反过来也一样。分开之后各自只在自己真的变了时才重画。
 *
 * 【为什么剩余时间要参与这个 key？】
 * 那一栏会写"剩 1.4 秒" —— 完全不进 key 的话，数字会一直停在旧值上不动。
 * 但每一帧都变会变成每帧重建 DOM，所以**按 0.2 秒的粒度**取整参与，
 * 肉眼看还是连续倒计时的。
 */
let lastBattleEffectsKey = '';

el.unitInfoClose.addEventListener('click', () => closeUnitInfo());

/**
 * ★ 0.1.1：在面板**外面**按下鼠标 = 关掉详情卡（不管点在哪儿）。
 *
 * ============================================================
 *  【为什么要加这一层兜底？—— 用户报"拖一下之后名字窗口卡着不消失"】
 * ============================================================
 * 关掉这张卡的入口本来就有一堆：点空地、点棋子以外的格子、点关闭按钮、按 Esc…
 * 但它们全都挂在**画布自己的 click** 上，而拖动结束时我们会
 * `suppressNextClick = true`（吃掉紧跟的那次 click，免得"拖完顺手又被当成点击"）。
 * 于是：
 *   · 卡片开着 -> 去拖一个棋子 -> 松手（那次 click 被吃掉）
 *   · 玩家以为松手那一下已经点了外面，但处理器根本没跑到 -> 卡片留着
 *   · 更糟的是 `suppressNextClick` 只在**画布**的 click 里被清掉，
 *     从备战席拖出来时那次 click 落在备战席上 —— 标记就一直挂着，
 *     把玩家接下来那次"想关掉它"的点击也一起吃掉。看起来就是"关不掉"。
 *
 * 用 `pointerdown`（捕获阶段）在**文档级**兜底：只要按下的地方不在卡片里，
 * 先把卡片收掉。它不依赖任何"上一次操作留下的标记"，所以不会再被绕过。
 * 拖动的起点也走 pointerdown —— 于是"一按下去卡片就没了"，
 * 拖动过程中不会再有一张卡挂在屏幕上。
 */
window.addEventListener(
  'pointerdown',
  (event) => {
    if (el.unitInfo.classList.contains('hidden')) return;
    const target = event.target as Node | null;
    // 点面板自己（关闭按钮 / 收回按钮 / 藏品格 / 羁绊标签）不关
    if (target && el.unitInfo.contains(target)) return;
    closeUnitInfo();
  },
  true,
);

el.unitInfoRecall.addEventListener('click', () => {
  if (!unitInfoCell) return;
  const result = recallFromBoard(state, unitInfoCell);
  if (!result.ok) toast(result.message, true);
  closeUnitInfo();
  renderAll();
});

// ============================================================
// ★ 0.1.2 测试模式：属性修改面板的接线
// ============================================================

/**
 * 设「数值修改」开关。
 *
 * 【为什么要顺手关掉另一块面板？】
 * 两块面板都跟着同一个棋子、位置算法也一样 —— 同时开着必然重叠。
 * 而且它们的信息量完全冲突（一个让你看、一个让你改），
 * 所以"打开编辑就把详情页收掉、关掉编辑也把编辑收掉"，行为只有一种。
 */
function setStatEditMode(on: boolean): void {
  statEditMode = on;
  if (on) closeUnitInfo();
  else closeUnitEditor();
}

/*
  点面板外面就收起来 —— 和详情页同一套文档级 pointerdown 兜底。
  ★ 注意不能做成"一按下去就关"那种一刀切：这个面板**是要输入的**，
  点输入框本身也会触发 pointerdown —— 判据必须是"按下的地方在不在面板里"。

  ★ 0.1.2 修（用户报的"切阵营之后改过的数值复原了"）：
  这个面板是**填表**，玩家点别处多半是想接着操作（换格子、切阵营…），
  不是想撤销。以前这里直接 `closeUnitEditor()`，刚填还没按保存的数字就
  **悄悄丢了** —— 表现成"改完数值，切一下阵营就复原"。
  现在改成：**填过东西就先落盘再收起**；真要撤销请按面板上的 ✕ / 取消。
  没动过的面板直接收（不弹 toast、不白跑一次 renderAll）。
*/
window.addEventListener(
  'pointerdown',
  (event) => {
    if (el.unitEdit.classList.contains('hidden')) return;
    const target = event.target as Node | null;
    if (target && el.unitEdit.contains(target)) return;
    if (!unitEditCell) return;
    /*
      ★ 两个细节，都是踩过才知道的：

      1) **先把"在编辑哪一格"和"脏不脏"记下来**，动作放到下一个宏任务里做。
         因为点别的干员会**当场**把这个面板换成那一格的（handleBoardClick），
         等到回调里再读 `unitEditCell` 就是新格子了 ——
         拿新面板的状态去"落盘/收起"会把人家刚打开的窗口关掉。
      2) **别在 pointerdown 阶段动 DOM**：落盘会走 `renderAll()`（重建商店等），
         这一下点击的 `click` 会打在一个刚被摘掉的节点上 ——
         表现成"第一下点商店没反应，得再点一次"。
    */
    const editingCell = { col: unitEditCell.col, row: unitEditCell.row };
    const dirty = unitEditorDirty();
    window.setTimeout(() => {
      const stillEditingThis =
        unitEditCell !== null && unitEditCell.col === editingCell.col && unitEditCell.row === editingCell.row;
      if (!stillEditingThis) return; // 这一下点击已经换了目标，别管它
      if (dirty) saveUnitEditor();
      else closeUnitEditor();
    }, 0);
  },
  true,
);

el.unitEditClose.addEventListener('click', () => closeUnitEditor());
el.unitEditCancel.addEventListener('click', () => closeUnitEditor());
el.unitEditSave.addEventListener('click', () => saveUnitEditor());

/**
 * 「恢复白板」= 立刻把这张卡的覆盖删掉（不是"把输入框改回去、还要你再点保存"）。
 * 少一步操作、意图也更明确：按钮说的是"恢复"，那就当场恢复。
 */
el.unitEditReset.addEventListener('click', () => {
  if (!unitEditCell) return;
  const placement = placementAt(state, unitEditCell);
  if (!placement) {
    closeUnitEditor();
    return;
  }
  const name = UNIT_DEFS[placement.defId]?.name ?? placement.defId;
  setUnitStatOverride(state, placement.uid, null);
  closeUnitEditor();
  renderAll();
  toast(`${name} 已恢复成数据表里的原值`);
});

// 战斗开始时两块面板都要收起来（它们说的都是布阵阶段的信息）
el.btnBattle.addEventListener('click', () => closeUnitInfo());

// ============================================================
// 二次确认
// ============================================================

/** 当前确认框「确定」时要做的事 */
let confirmAction: (() => void) | null = null;

/**
 * 弹一个二次确认。
 *
 * 【为什么要做这个？】
 * 返回主界面会丢掉当前这一局（联机时还会退出房间），
 * 而这个按钮就在左上角、很容易误点。加一道确认是标准做法。
 *
 * @param onConfirm 用户点「确定」时执行
 */
function askConfirm(title: string, message: string, confirmText: string, onConfirm: () => void): void {
  el.confirmTitle.textContent = title;
  el.confirmMessage.innerHTML = message;
  el.confirmOk.textContent = confirmText;
  confirmAction = onConfirm;
  el.confirmOverlay.classList.remove('hidden');
}

function closeConfirm(): void {
  el.confirmOverlay.classList.add('hidden');
  confirmAction = null;
}

el.confirmCancel.addEventListener('click', () => closeConfirm());
el.confirmOverlay.addEventListener('click', (event) => {
  if (event.target === el.confirmOverlay) closeConfirm();
});
el.confirmOk.addEventListener('click', () => {
  const action = confirmAction;
  closeConfirm();
  action?.();
});

// ============================================================
// ★ 0.1.1：房主改别人昵称的小弹窗
// ============================================================

/** 正在给谁改名（null = 弹窗没开） */
let renameTargetId: string | null = null;

/**
 * ★ 0.3：上一次改名尝试。服务端拒绝（重名 / 名字不合法）时靠它把弹窗原样恢复 ——
 * 名字还在输入框里，玩家改一个字就能再提交，不用从头再填一遍。
 */
let pendingRename: { playerId: string; name: string } | null = null;

function openRenameDialog(playerId: string, currentName: string): void {
  pendingRename = null;
  renameTargetId = playerId;
  el.renameWhose.textContent = `把「${currentName}」改成：`;
  el.renameInput.value = currentName;
  el.renameError.textContent = '';
  el.renameOverlay.classList.remove('hidden');
  el.renameInput.focus();
  el.renameInput.select();
}

function closeRenameDialog(): void {
  renameTargetId = null;
  el.renameOverlay.classList.add('hidden');
}

/**
 * 提交改名。
 *
 * ★ 0.3：本地先按 `shared/names.ts` 校验一遍（长度 2~8 + 字符白名单）。
 *   以前这里只判"非空"，长度和字符全推给服务端 —— 结果玩家填了个 9 个字的名字，
 *   点确定、弹窗关了、然后收到一条错误，还得从头再点一次改名。
 *
 * ★ 重名只能由**服务端**裁决（它才知道房间里现在有谁），所以弹窗仍然先关，
 *   真被拒了会在 `onError` 里把它原样弹回来（见 pendingRename）。
 */
function submitRename(): void {
  const id = renameTargetId;
  if (!id) return;
  const name = sanitizePlayerName(el.renameInput.value);
  const problem = playerNameError(name);
  if (problem) {
    el.renameError.textContent = `${problem}（${NAME_MIN_LENGTH}~${NAME_MAX_LENGTH} 个字）`;
    el.renameInput.focus();
    el.renameInput.select();
    return;
  }
  pendingRename = { playerId: id, name };
  net.renamePlayer(id, name);
  closeRenameDialog();
}

el.renameOk.addEventListener('click', () => submitRename());
el.renameCancel.addEventListener('click', () => closeRenameDialog());
el.renameOverlay.addEventListener('click', (event) => {
  if (event.target === el.renameOverlay) closeRenameDialog();
});
el.renameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    submitRename();
  }
});

// ============================================================
// ★ 0.1.3：房主请人出房间（可以附一句话，原样转达给被踢的人）
// ============================================================

/** 正在请谁出去（null = 弹窗没开） */
let kickTargetId: string | null = null;
/** 那个人的名字（提交后给房主一条 toast 用） */
let kickTargetName = '';

function openKickDialog(playerId: string, name: string): void {
  kickTargetId = playerId;
  kickTargetName = name;
  el.kickWhose.textContent = `要把「${name}」请出房间。给他留句话吧（不写也行）：`;
  el.kickInput.value = '';
  el.kickError.textContent = '';
  el.kickOverlay.classList.remove('hidden');
  el.kickInput.focus();
}

function closeKickDialog(): void {
  kickTargetId = null;
  el.kickOverlay.classList.add('hidden');
}

/**
 * 提交踢人。
 * ★ 留言只做"长度"这一道本地校验 —— 字符清洗由**服务端**统一做
 *   （和昵称同一个思路：客户端再写一套只会两边不一致）。
 *   留空就是不留，服务端会回退到默认文案。
 */
function submitKick(): void {
  const id = kickTargetId;
  if (!id) return;
  const message = el.kickInput.value.trim();
  if (message.length > 60) {
    el.kickError.textContent = '留言最多 60 个字';
    return;
  }
  net.kickPlayer(id, message);
  toast(`已把 ${kickTargetName} 移出房间`);
  closeKickDialog();
}

el.kickOk.addEventListener('click', () => submitKick());
el.kickCancel.addEventListener('click', () => closeKickDialog());
el.kickOverlay.addEventListener('click', (event) => {
  if (event.target === el.kickOverlay) closeKickDialog();
});
el.kickInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    submitKick();
  }
});

/**
 * ★ 0.1.3：被房主请出房间 —— 把留言**显示给本人**。
 *
 * 【为什么用浮层而不是一条 toast？】
 * toast 几秒就消失了，而且"被踢"这种事玩家多半正盯着棋盘，
 * 一眨眼就错过了。浮层要他点一下「知道了」才消失，跑不掉。
 * 用 textContent（不是 innerHTML）：留言是房主写的，不该被当 HTML 解析。
 */
function showKickedOverlay(reason: string): void {
  el.kickedMessage.textContent = reason;
  el.kickedOverlay.classList.remove('hidden');
}

el.kickedOk.addEventListener('click', () => {
  el.kickedOverlay.classList.add('hidden');
});

/**
 * ★ 0.1.4：重连失败的**明确交代**。
 *
 * ============================================================
 *  【它修的 bug："没弹接管 + 点重新连接按钮也没反应"】
 * ============================================================
 * 以前重连失败是这样的（`netplay-ui` / 真机复现都确认过）：
 *   ① `onResumeFailed` → `leaveNetplay()` → `clearResumeToken()` → `clearMachineSession()`
 *      把**内存里的会话置空** ⇒ `renderReconnectButton()` 判定"没得可回"
 *      ⇒ 「回到对局」按钮**当场消失**；
 *   ② 只剩一条 **2 秒**就消失的 toast，夹在页面刚加载的一堆日志里，玩家根本没看见；
 *   ③ 会话被清之后，「加入房间」页的「断线重连恢复」也只会说"没有记录"。
 * 三件事叠起来 = 玩家完全不知道发生了什么，也**再也没有入口自己再试一次**。
 *
 * 所以失败必须"明说"，而且要一次说清三件事：**哪一局 / 为什么 / 下一步怎么办**。
 * 它是个**要点掉才消失**的浮层（不是 toast）—— 这条信息比页面加载日志重要得多。
 *
 * ★ 错误码也一并显示：这个项目没有日志文件（启动器只往控制台打），
 *   玩家截图这一屏就是最有用的排查材料。
 *
 * @param code    服务端给的错误码（`BAD_TOKEN` / `NO_SEAT`）
 * @param message 服务端给的原话
 * @param roomCode 出事的是哪一局（必须在 `leaveNetplay()` **之前**抓下来）
 */
function showResumeFailedOverlay(code: string, message: string, roomCode: string): void {
  el.resumeFailedMessage.textContent = roomCode
    ? `房间 ${roomCode} 那一局回不去了。`
    : '原来那一局回不去了。';
  /*
    原因按错误码分成两句人话 —— 这两条对玩家意味着完全不同的下一步。
    ★ 这两条原因都是"座位真的没了"，重试没有意义，
      所以下一步是"重新建房 / 拿新房号"，而不是"再点一次"。
  */
  const reason =
    code === 'BAD_TOKEN'
      ? '服务器已经不认得这枚重连凭据了 —— 最常见的原因是房主那台机器上的游戏重启过（重启会丢掉所有对局记录）。'
      : code === 'NO_SEAT'
        ? '这一局的座位已经被清掉了 —— 多半是掉线时间超过了保留时限。'
        : message;
  el.resumeFailedHint.textContent =
    `${reason} 下一步：让房主重新开一个房间、把新的房间号发给你；或者你自己建一个。` +
    `（错误码 ${code}）`;
  el.resumeFailedOverlay.classList.remove('hidden');
}

el.resumeFailedOk.addEventListener('click', () => {
  el.resumeFailedOverlay.classList.add('hidden');
});

/*
  ★ 0.1.2：断线重连浮层的两个按钮。

  「立即重试」= 把退避等待砍掉、马上再连一次（`net.retryResume()`）。
   【为什么要有它？】自动重连带退避（1s/2s/4s…），网络已经恢复的时候
   玩家还得干等几秒才看到画面回来 —— 这个按钮就是"我确认网络好了，别等了"。

  「放弃并退出房间」= 走正常的退房流程（清令牌、回主界面）。
   ★ 这条路**必须**留着：如果服务器换了端口 / 房间里的人全散了，
   自动重连会一直失败，没有这个出口玩家就只能刷新页面 —— 刷新会丢掉令牌，
   反而变成"座位永久占着"。
*/
el.resyncRetry.addEventListener('click', () => {
  net.retryResume();
});
el.resyncLeave.addEventListener('click', () => {
  netplayResyncing = false;
  renderResyncOverlay();
  leaveNetplay();
});

// ============================================================
// 战斗日志与伤害统计
// ============================================================

/**
 * 我方干员的实时战斗统计。
 *
 * 【为什么要有这个？】
 * 玩家最关心的是「我的棋子打得怎么样」：
 * 谁在输出、谁在挨打、谁的治疗有用。
 * 原始事件日志里这些数据是散落的（每条伤害都单独一行），
 * 没法一眼看出谁强谁弱。
 * 所以除了事件日志，还汇总成一张表，实时更新。
 *
 * 统计算法本身在 game/battle-log.ts（纯函数、有单元测试），
 * 这里只负责「把结果画到 DOM 上」。
 */
let damageStats: StatsMap = new Map();

/**
 * 当前这一场战斗里，我属于哪一队。
 *
 * 单机模式永远是 0（自己在左半边）。
 * 联机时由服务端的分配决定 —— 可能被分到 1，那时日志视角、
 * 伤害统计范围、棋盘翻转方向都要跟着变。
 * 统一从这一个变量读，避免各处判断不一致。
 */
let myTeam: 0 | 1 = 0;

// 单位 id 规则、伤害数字格式化、日志文案、统计累加都在 game/battle-log.ts 里，
// 这里直接用（dmg 是 formatDamage 的短别名，渲染时写起来清爽点）

/**
 * 把一条事件转成日志行 —— 实现在 game/battle-log.ts（纯函数），
 * 这里包一层只是为了少写一个参数（myTeam 是模块级状态）。
 */
function formatEvent(event: BattleEvent, names: Record<number, string>): LogLine | null {
  return formatEventView(event, names, myTeam);
}

/** 上一帧是否已经渲染过统计（避免每帧都重建 DOM） */
let statsDirty = false;

// ============================================================
// 羁绊详情日志（第 6 条需求）
// ============================================================

/**
 * 羁绊日志的状态 + 游标。
 *
 * 【为什么和战斗日志一样要维护游标？】
 * 战斗是"边播边长"的：每帧只看新来的事件（增量），
 * 但拖动进度条往回拖时要能从零重建。两套路径都支持，
 * 才不会出现"拖回去之后羁绊进度停在未来"这种脏状态。
 */
let traitLogState: TraitLogState = emptyTraitLog();
let traitLogCursor = 0;
let traitLogDirty = false;

/**
 * 把羁绊日志画到 DOM 上。
 *
 * 分两块：
 *   上半 = **实时进度**（拉特兰攒到第几次、罗德岛谁在吃加成）
 *   下半 = 值得记一笔的事件（发动 / 加成换人）
 * 一块羁绊都没有时整块隐藏 —— 绝大多数对局用不到，不该白占侧栏。
 */
function renderTraitLog(): void {
  const live = topProgress(traitLogState.progress);
  const carriers = [...traitLogState.carrier].sort((a, b) => a.traitId.localeCompare(b.traitId));
  const hasAnything = live.length > 0 || carriers.length > 0 || traitLogState.lines.length > 0;
  el.traitLogBlock.classList.toggle('hidden', !hasAnything);
  if (!hasAnything) return;

  el.traitLive.innerHTML = '';

  for (const row of live) {
    /*
      ★ 全队共享计数的羁绊（拉特兰）**不显示干员名字**（0.0.2 追加需求）。
      progress 事件里的 unitId 只是"最后一下恰好是谁打的"，计数是全队的 ——
      显示名字会让人误以为只有那个干员在攒次数，而且名字还会来回跳。
      所以这一行只留：羁绊名 + 进度条 + 累计数。
    */
    const shared = isTeamSharedProgress(row.traitId);
    const percent = Math.max(0, Math.min(100, Math.round((row.value / Math.max(1, row.target)) * 100)));
    const div = document.createElement('div');
    div.className = 'trait-live-row';
    div.innerHTML =
      `<span class="trait-live-name">${traitNameOf(row.traitId)}</span>` +
      (shared ? '' : `<span class="trait-live-unit">${currentNames[row.unitId] ?? `#${row.unitId}`}</span>`) +
      `<span class="trait-bar"><span class="trait-bar-fill" style="width:${percent}%"></span></span>` +
      `<span class="trait-live-value">${row.value}/${row.target}</span>`;
    el.traitLive.appendChild(div);
  }

  for (const row of carriers) {
    const unitName = currentNames[row.unitId] ?? `#${row.unitId}`;
    const div = document.createElement('div');
    div.className = 'trait-live-row';
    div.innerHTML =
      `<span class="trait-live-name">${traitNameOf(row.traitId)}</span>` +
      `<span class="trait-live-unit">${unitName}</span>` +
      `<span class="trait-live-value">攻击力 +${(row.bonusBp / 100).toFixed(0)}%</span>`;
    el.traitLive.appendChild(div);
  }

  // 已经写下来的那几条（发动 / 换人）—— 只保留最后 20 条
  el.traitLog.innerHTML = '';
  for (const line of traitLogState.lines.slice(-20)) {
    const div = document.createElement('div');
    div.className = `log-line ${line.css}`;
    div.innerHTML = `<span class="log-tick">${String(line.tick).padStart(4, ' ')}</span>${line.text}`;
    el.traitLog.appendChild(div);
  }
  el.traitLog.scrollTop = el.traitLog.scrollHeight;
}

/** 战斗日志与羁绊日志一起清空（换局、退出战斗时用） */
function resetTraitLog(): void {
  traitLogState = emptyTraitLog();
  traitLogCursor = 0;
  traitLogDirty = true;
}

/** 统计表为空时显示的提示语 */
const EMPTY_STATS_HINT = '<div class="damage-empty">开始战斗后会显示每个干员的输出与承伤</div>';

/**
 * 从事件日志重建到某个 tick 为止的**统计**。
 *
 * 【为什么从事件日志重建，而不是从"我方阵容"初始化？】
 * 因为阵容清单可能会和实际开打的不一致（联机时尤其：服务器才真正决定谁上谁下）。
 * 战斗日志开头每个单位都有一条 spawn 事件（含 defId / 星级 / 队伍），
 * 从它长出来的名单**必然**和这场战斗一致 —— 不可能对不上。
 *
 * 【为什么要清空重算，而不是"归零"？】
 * 因为阵容没变时两者等价，但阵容变了（换了个单位）时只有重算才正确。
 * 事件最多几千条，重算一次是毫秒级的，不值得为省这点开销维护增量状态。
 */
function rebuildStatsToTick(targetTick: number): void {
  damageStats = currentResult ? statsUpTo(currentResult.log, myTeam, targetTick) : new Map();
  statsDirty = true;
}

/** 把统计画到 DOM 上 */
function renderDamageStats(): void {
  if (damageStats.size === 0) {
    el.damageStats.innerHTML = EMPTY_STATS_HINT;
    return;
  }

  el.damageStats.innerHTML = '';
  for (const row of sortedStats(damageStats)) {
    const def = UNIT_DEFS[row.defId];
    // 名字优先用这一场的实际显示名（联机时对面会带「敌·」前缀，我方一般就是干员名）
    const displayName = currentNames[row.unitId] ?? def?.name ?? row.defId;
    const rarity = def ? rarityOfCost(def.cost) : null;

    const div = document.createElement('div');
    div.className = `damage-row${row.dead ? ' dead' : ''}`;
    if (rarity) div.style.borderLeftColor = rarity.base;
    div.innerHTML = `
      <span class="dmg-name">
        <span class="dmg-stars">${'★'.repeat(Math.max(1, row.star))}</span>
        <span class="dmg-unit-name">${escapeHtml(displayName)}</span>
      </span>
      <span class="dmg-dealt">${dmg(row.dealt)}</span>
      <span class="dmg-taken">${dmg(row.taken)}</span>
      <span class="dmg-healed">${row.healed > 0 ? dmg(row.healed) : '—'}</span>
    `;
    div.title =
      `${displayName}\n造成伤害 ${dmg(row.dealt)}\n承受伤害 ${dmg(row.taken)}\n` +
      `治疗量 ${dmg(row.healed)}${row.dead ? '\n（已阵亡）' : ''}`;
    el.damageStats.appendChild(div);
  }
}

/**
 * 把一行日志画到日志面板里。
 * tick 右对齐补空格，这样数字位数不同也不会左摇右晃（等宽字体下对齐）。
 */
function appendLogLine(line: { text: string; css: string; tick: number }): void {
  const div = document.createElement('div');
  div.className = `log-line ${line.css}`;
  div.innerHTML =
    `<span class="log-tick">${String(line.tick).padStart(4, ' ')}</span>${line.text}`;
  el.log.appendChild(div);
}

/**
 * 把「战斗日志 + 伤害统计」一起重建到某个 tick 为止。
 *
 * 【为什么需要它？】
 * 拖动播放进度条时，时间会跳。
 *  - 往回拖：之前累加过的"未来"数据要清掉，否则统计会虚高、日志里会出现还没发生的事
 *  - 往前拖：中间跳过的事件也要补算，否则统计会偏低、日志缺行
 * 直接把「从战斗开始到目标时间」的事件重放一遍最稳 ——
 * 事件数量最多几千条，重算一次毫秒级，完全不用担心性能。
 *
 * 【为什么日志和统计写在同一个函数里？】
 * 因为两边读的是同一份事件流。分开写很容易只重建了一个（改的时候漏一边），
 * 合成一个函数就不存在"统计对了日志没对"这种状态。
 */
function rebuildBattleView(targetTick: number): void {
  const result = currentResult;
  const { lines, cursor } = result
    ? linesUpTo(result.log, currentNames, myTeam, targetTick)
    : { lines: [], cursor: 0 };

  logCursor = cursor;
  el.log.innerHTML = '';
  for (const line of lines) appendLogLine(line);

  /*
    羁绊日志和战斗日志读的是同一份事件流，所以一起重建。
    分开写很容易只重建一个（往回拖之后羁绊进度还停在"未来"）。
  */
  const traits = result
    ? traitLogUpTo(result.log, currentNames, myTeam, targetTick)
    : { state: emptyTraitLog(), cursor: 0 };
  traitLogState = traits.state;
  traitLogCursor = traits.cursor;
  renderTraitLog();

  rebuildStatsToTick(targetTick);
  renderDamageStats();
  el.log.scrollTop = el.log.scrollHeight;
}

/**
 * 战斗播放时增量追加日志（每帧调一次）。
 *
 * 和 rebuildBattleView 的区别：这个只往后走，不回头。
 * 播放是"只看前面"的，所以增量追加就够，不用每帧重放整场。
 */
function flushBattleLog(): void {
  const result = currentResult;
  if (!result) return;
  const currentTick = replay.currentSeconds * TICKS_PER_SECOND;
  let appended = false;
  while (logCursor < result.log.length) {
    const event = result.log[logCursor]!;
    if (event.t > currentTick) break;
    logCursor++;

    // 统计要算所有事件（不管这行显示不显示），因为没显示的普攻也在掉血
    applyEventToStats(damageStats, event, myTeam);
    statsDirty = true;
    appended = true;

    const formatted = formatEvent(event, currentNames);
    if (formatted) appendLogLine({ ...formatted, tick: event.t });

    // 羁绊日志同一份事件流：进度条要实时动，发动/换人要写一行
    applyTraitEvent(traitLogState, event, currentNames, myTeam);
    if (event.type === 'trait') traitLogDirty = true;
  }

  // 一场战斗几千条日志，DOM 节点太多会卡，只保留最近 300 行
  while (el.log.childElementCount > 300) {
    el.log.removeChild(el.log.firstChild!);
  }
  if (appended) el.log.scrollTop = el.log.scrollHeight;

  // 羁绊面板只在真的有变化时重画（progress 事件一次攻击一条，不能每帧全量重排 DOM）
  if (traitLogDirty) {
    renderTraitLog();
    traitLogDirty = false;
  }

  // 统计表只在有新事件时重建（每帧重建太浪费）
  if (statsDirty) {
    renderDamageStats();
    statsDirty = false;
  }
}

// ============================================================
// 联机
// ============================================================

/**
 * ★ 0.0.3 末：本机（服务器所在机器）的局域网 IP，来自服务器的 welcome。
 * 用途：大厅里告诉房主"朋友自动发现失败时该手填什么地址"。
 */
let myLanAddresses: string[] = [];

/*
  ============================================================
  ★ 0.1.1：战斗中观战别人的对局（+ 进度同步）
  ============================================================
  【背景】服务器会把这一回合的**每一场**战斗都广播给房间里所有人
  （本来是为了让轮空 / 已淘汰的人有得看）。以前客户端只认"我自己那一场"，
  别人那一场直接丢掉 —— 开了打的人从头到尾只能看自己。
  现在把每一场都记下来，战斗中随时可以切过去看。

  【"同步观战进度"是怎么做到的？】
  联机的战斗是**确定性重放**：给定种子和双方阵容，任何时刻该是什么样是算得出来的。
  而联机里所有人都被强制 1 倍速、不能暂停、不能拖进度条（见 onBattleStart 末尾那段），
  所以"这一场现在该播到第几秒"= 从**收到那条广播**到现在的墙钟秒数。
  于是切过去的时候直接 `seek` 到那个位置 —— 我看到的进度就和他看到的一致，
  既不是从头播，也不是冻在某一帧。
  自己那一场例外：切回来时**接着我上次看的地方**（墙钟只用来判断"该收尾了"），
  否则慢一点的机器直接跳到墙钟位置会**跳过没看过的内容**。

  【为什么还要记住"我演到第几秒"？】
  因为同一个时刻只能播一场（播放器只有一台）。切走时把进度存起来，
  切回来接着放 —— 这样"切出去看一眼别人、再切回来"是无损的。
  ============================================================ */
interface LiveBattle {
  payload: Extract<ServerMessage, { t: 'battleStart' }>;
  /** 收到这条广播的墙钟时刻（performance.now），用来算"别人那场现在该到第几秒" */
  startedAtMs: number;
  /** 一行字标题（"我 vs 小红" / "小明 vs 影·阿强" / "我 vs 野怪"）——列表上用 */
  title: string;
  /** 我在这场里站哪一队；**没参战就是 null**（决定切过去从哪一秒开始） */
  myTeam: 0 | 1 | null;
  /** 我在这场里演到第几秒（只有我参战那一场会累积） */
  playedSeconds: number;
  /**
   * 这一场总共多少秒（第一次装进播放器时记下来）。
   * 用途：判断"我那一场到点了没" —— 我正在看别人的对局时，自己那场没有播放器可读。
   */
  durationSeconds: number | null;
}

/** 这一回合的所有战斗（key = battleId）。换回合 / 开新局时清空 */
let liveBattles = new Map<string, LiveBattle>();
/** 此刻**画面里**播的是哪一场（和 `currentBattleId` 不同：那个是"我要回执的那一场"） */
let viewingBattleId: string | null = null;

/** 一场战斗的一行字标题（列表 / "VS 谁"都用它，口径只写一遍） */
function battleTitleOf(payload: Extract<ServerMessage, { t: 'battleStart' }>): string {
  const nameOf = (id: string): string =>
    id === net.playerId ? '我' : (net.room?.players.find((p) => p.id === id)?.name ?? '对手');
  const left = nameOf(payload.team0PlayerId);
  // 影子 / 野怪不是真人，名字要用广播里带的那两个字段（玩家的 room 列表里查不到）
  /*
    ★ 0.2：打野怪时**不写具体是哪几只**（用户口径：「只显示野怪就好」）。
    `payload.monsterWave` 里是"源石虫×2 + 猎狗"这种名单，
    广播里仍然带着它（以后想看再说），但界面这里只用"野怪"两个字。
  */
  const right = payload.ghostOf
    ? `影·${payload.ghostOf}`
    : payload.monsterWave
      ? '野怪'
      : nameOf(payload.team1PlayerId);
  return `${left} vs ${right}`;
}

/**
 * 把某一场战斗装进播放器并显示出来（"我现在在看这一场"）。
 *
 * 【为什么抽成函数？】"刚收到广播时要做的那一套"和"切过去看时要做的那一套"
 * 是**完全同一件事**。写两份必然漏（这个项目已经吃过"同一个动作写两遍"的亏）。
 *
 * @param startSeconds 从第几秒开始放：
 *   · 0 = 刚收到广播，从头播；
 *   · 别人那场 = 跳到墙钟对应的位置（观战进度要和他一致）；
 *   · 自己那场切回来 = 接着上次看的地方。
 */
function showBattle(battleId: string, startSeconds: number): void {
  const live = liveBattles.get(battleId);
  if (!live) return;
  const payload = live.payload;
  const me = net.playerId;
  const mine = live.myTeam !== null;

  /*
    ★ 0.1.4：战斗演出一开始就把拖拽收掉（原因见 startBattle 开头那段）——
    联机里"布阵时间到自动开打"走的正是这条路，玩家手上拖着的藏品
    就是在这一刻被弄丢的。
  */
  cancelDrag();
  closeUnitInfo();
  const flip = payload.team1PlayerId === me;
  setViewFlipped(flip);
  board.setHalfTint(flip);
  replay.setFlip(flip);

  const battleState: BattleState = createBattle(UNIT_DEFS, [payload.team0, payload.team1], payload.seed);
  const result = simulate(UNIT_DEFS, [payload.team0, payload.team1], payload.seed, { statsTimeline: true });

  /*
    「我是哪一队」只在这里判定一次：日志、统计、视角翻转都读它。
    ★ 看别人那一场时它就是 0（左边那队当"我方"）—— 只是显示口径，
      `finishBattle` 判定胜负用的是**切回自己那场时**重新赋的值。
  */
  net.myTeam = payload.team1PlayerId === me ? 1 : 0;
  myTeam = net.myTeam;

  /*
    ★★ 0.3.5：**只有我自己那一场**才进账本。
    看别人的对局时也走 showBattle（画面要跟着别人的播），
    但那时候 `myTeam` 是"当 0 用"的显示口径 —— 记进账本就会把胜负算反。
  */
  if (mine) {
    rememberMyBattle({ battleId, myTeam: net.myTeam, winner: result.winner, result });
  }

  // 只对"我自己那一场"做校验和比对（别人那场本来就不是我该背的账）
  if (mine && result.checksum !== payload.expectedChecksum) {
    console.error(
      `[联机] 校验和不一致！种子 ${payload.seed}，服务器 0x${payload.expectedChecksum.toString(16)}，本地 0x${result.checksum.toString(16)}`,
    );
    net.reportChecksumMismatch(payload.battleId, payload.expectedChecksum, result.checksum);
    toast('⚠ 战斗校验不一致，已上报服务器', true);
  }

  currentResult = result;
  currentNames = payload.names;
  viewingBattleId = battleId;

  // 标题：自己那场按原来的说法（VS 谁 / 野怪 / 影子），别人的一律写"旁观"
  if (!mine) {
    el.battleOpponent.textContent = `旁观：${battleTitleOf(payload)}`;
  } else if (payload.ghostOf) {
    el.battleOpponent.textContent = `VS 影·${payload.ghostOf}（复制阵容 · 不影响他本人）`;
  } else if (payload.monsterWave) {
    // ★ 0.2：只写"VS 野怪"，不列具体是哪几只（用户口径）
    el.battleOpponent.textContent = 'VS 野怪';
  } else {
    const opponentId = payload.team0PlayerId === me ? payload.team1PlayerId : payload.team0PlayerId;
    const opponentName = net.room?.players.find((p) => p.id === opponentId)?.name;
    el.battleOpponent.textContent = `VS ${opponentName ?? '对手'}`;
  }
  el.battleOpponent.classList.remove('hidden');

  clearPrepSprites();
  applyBattleItems(payload.team0, payload.team1);
  replay.load(battleState, result);
  replay.setSpeed(netplayActive ? 1 : state.playbackSpeed);
  logCursor = 0;
  resetTraitLog();
  el.log.innerHTML = '';
  rebuildStatsToTick(0);
  renderDamageStats();
  paused = false;
  state.seed = payload.seed;
  /*
    ★ 0.1.2：只有"**画面回到了我该收尾的那一场、而它还没收尾**"时，才把我的阶段推回 `battle`。

    【为什么不能无条件写？】`showBattle` 同时服务四种场景：
      ① 收到"我该看的那一场"的广播（自己参战 / 轮空打影子 / 已淘汰只剩观战）→ 该进 battle；
      ② 战斗中点别人的对局看 → **不该动**我自己的阶段（我还得回去收尾）；
      ③ 我已打完（result）、在等别人时点别人的对局看 → 更不该动：一改就会被
         `shouldReturnToMyBattle()` 当成"我还在打"，立刻把我拽回自己那场
         （用户报的"自己一结束就再也看不了别人"）；
      ④ 切回"已经收过尾"的自己那场 → 也不该复活阶段，否则会再弹一次结算横幅、再举一次手。
    所以判据是两句：**看的是"我该看的那一场"**（`currentBattleId`）+ **它还没被我收尾**（`myBattleDone`）。
  */
  const isMyOwnBattle = battleId === currentBattleId;
  if (isMyOwnBattle && !myBattleDone) state.phase = 'battle';

  /*
    ★ 进度同步：跳到"该看的位置"。
    夹在 [0, 总时长] 里 —— 墙钟可能已经超过这一场的长度（比如切过去的瞬间它刚好打完），
    这时候应该停在**最后一帧**而不是越界。
    `rebuildBattleView` 会把战斗日志 / 伤害统计 / 羁绊进度一起补到那一刻，
    不补的话画面是新的、右边的日志还是上一场的。
  */
  const target = Math.max(0, Math.min(startSeconds, replay.durationSeconds));
  if (target > 0) {
    replay.seek(target);
    rebuildBattleView(Math.floor(target * TICKS_PER_SECOND));
  }
  live.playedSeconds = replay.currentSeconds;
  live.durationSeconds = replay.durationSeconds;
  state.playbackSeconds = replay.currentSeconds;

  // ★ 0.3.4：「校验通过」属于调试口径，玩家只需要知道自己在打还是在看
  state.message = mine ? '战斗开始' : '正在旁观别人的对局（进度和别人一致）';
  el.battleBar.classList.remove('hidden');

  /*
    ★ 联机时把「暂停 / 进度条 / 变速」藏起来，强制所有人同一进度。
    （三个控件都只改"我自己这边的播放"，一改就和别人对不上了 ——
      而观战要的恰恰是"和别人看到的一样"。见 onBattleStart 原来的说明。）
  */
  el.btnPause.classList.toggle('hidden', netplayActive);
  el.seek.classList.toggle('hidden', netplayActive);
  el.speedGroup.classList.toggle('hidden', netplayActive);
  if (netplayActive) {
    state.playbackSpeed = 1;
    replay.setSpeed(1);
    paused = false;
    el.btnPause.textContent = '⏸';
  } else {
    renderSpeedButtons();
  }

  renderSpectateBar();
  if (currentView !== 'game') setView('game');
  renderAll();
}

/**
 * 切换要看哪一场战斗（★ 0.1.1）。
 * 只有联机 + 战斗阶段才有意义；同一场重复点是空操作。
 */
function watchBattle(battleId: string): void {
  if (!netplayActive || viewingBattleId === battleId) return;
  /*
    ★ 0.1.2：观战窗口 = "这一回合的战斗还没彻底结束"。
    所以 `battle`（我还在打）和 `result`（我打完了、在等别人看完）都算；
    只有进入下一回合布阵（prep）才收起观战。
    以前只认 `battle` —— 于是"我自己先打完"之后就再也点不开别人的战斗了（用户报的）。
  */
  if ((state.phase !== 'battle' && state.phase !== 'result') || !currentResult) return;

  // 先把"我在这场里演到第几秒"存下来（切回来要接着放）
  const current = viewingBattleId ? liveBattles.get(viewingBattleId) : null;
  if (current) current.playedSeconds = replay.currentSeconds;

  const next = liveBattles.get(battleId);
  if (!next) return;

  const startSeconds =
    next.myTeam !== null
      ? next.playedSeconds // 自己那场：接着上次
      : Math.max(0, (performance.now() - next.startedAtMs) / 1000); // 别人那场：跟墙钟对齐

  showBattle(battleId, startSeconds);
}

/**
 * ★ 0.1.2：断线重连中那张浮层的显隐（幂等，直接塞进 renderAll 就行）。
 *
 * 【为什么由 `netplayResyncing` 一个标志说了算？】
 * 因为"断线"这件事在客户端有三个来源（ws close / 服务器发来的临时故障 / 手动退出），
 * 如果每个来源各自去开关浮层，迟早会漏一个 —— 出现"人已经回主界面了浮层还盖着"
 * 或者"明明在重连却什么都没显示"。所以统一由网络层的 `canResume` + 连接状态推出来一个标志，
 * 界面只读它，不做二次判断。
 */
function renderResyncOverlay(): void {
  el.resyncOverlay.classList.toggle('hidden', !netplayResyncing);
  if (!netplayResyncing) return;
  // 文案给一点"现在到底在干嘛"的信息，不然玩家只会看到一句干巴巴的"正在重连"
  const problem = serverUrlProblem(net.url);
  el.resyncMessage.textContent = problem
    ? `链接里的服务器地址看起来不对（${problem}），请回到主界面重新进房间。`
    : '和房间的连接断开了，正在尝试重新连上（你的座位还留着，回来就是原来的局面）。';
}

// ============================================================
// ★ 0.1.4：对局暂停浮层 + 投票「同意」
// ============================================================

/** 暂停浮层上的那几个数（服务端每秒一条 `pauseTick` 推过来） */
let pauseInfo = { secondsLeft: 0, voteCount: 0, voteNeeded: 0 };
/**
 * ★ 0.1.4：本轮暂停里**已经收到过一条 `pauseTick`** 了吗。
 *
 * ============================================================
 *  【它修的 bug：暂停倒计时"卡住不动"】
 * ============================================================
 * 两个地方都在写 `pauseInfo`：
 *   · 房间广播（`room`）—— 里面带着 `pauseSecondsLeft`，但它是**事件驱动**的，
 *     只在"暂停开始 / 有人投票 / 恢复"这些时刻才来一次，中间**一直不动**；
 *   · `pauseTick` —— 服务端**每秒**推一条，这才是倒计时真正的数据源。
 *
 * 而 `renderPauseOverlay` 每次都用房间广播那份去覆盖 `pauseInfo`，
 * 于是 `onPauseTick` 刚把新秒数写进去，紧接着就被刷回"暂停开始那一刻"的 180 ——
 * 浮层上的 `3:00` 永远不动，看着就像卡死了（`#stat-phase` 上的
 * 「等待其他玩家回来（3:00）」同样不动）。
 *
 * 所以：**只要本轮已经收到过 `pauseTick`，就以它为准**，房间广播不再插嘴。
 * 这条判据只在"浮层刚弹出来、第一条 tick 还没到"的那一瞬间为假 ——
 * 那正是下面那个覆盖存在的唯一理由。
 */
let pauseTickSeen = false;
/**
 * 这一轮暂停里我点过「同意」了吗。
 * ★ 每一轮暂停都要复位：暂停结束、或者"暂停途中又有人掉线 -> 服务端把票清了"时，
 * 玩家得能重新表态（不然按钮会一直灰着，看着像坏了）。
 */
let votedThisPause = false;

/** 秒数 -> `m:ss`（暂停倒计时用，三位数的秒数不好读） */
function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * 暂停浮层的显隐 + 文案（幂等，直接塞进 renderAll）。
 *
 * 【为什么它不像别的浮层那样"弹一次"？】
 * 因为它的内容每秒都在变（倒计时、同意人数），而且"暂停中"是服务端说了算的**状态**，
 * 不是一次性事件 —— 幂等渲染天然跟着 `net.room.paused` 走，断线重连回来也不会漏弹。
 * 所以它**没有关闭按钮**：要么等人回来，要么所有人同意（见 index.html 的说明）。
 */
function renderPauseOverlay(): void {
  /*
    ★★ 0.3.2：**选秀阶段绝不显示暂停浮层**。
    用户报过"盟约界面有人断线也弹这个窗、倒计时还停住"。
    服务端已经保证了选秀阶段不会 `pauseMatch`（`shouldPauseMatch` + `pauseMatch` 里的硬闸），
    这里再挡一道：万一手里那份 `paused` 是上一段状态残留的，也不能盖在选秀页上。
  */
  const paused = netplayActive && net.room?.paused === true && net.room?.phase !== 'covenant';
  el.pauseOverlay.classList.toggle('hidden', !paused);
  if (!paused) return;

  // 房间广播里也带着这几个数：浮层刚弹出来那一秒还没有 pauseTick
  // ★ 但**只在还没收到过 tick 的时候**用它 —— 否则会把每秒的新秒数刷回"暂停那一刻"，
  //   倒计时就永远停在 3:00 不动了（见 pauseTickSeen 的说明）。
  if (!pauseTickSeen && typeof net.room?.pauseSecondsLeft === 'number') {
    pauseInfo = {
      secondsLeft: net.room.pauseSecondsLeft,
      voteCount: net.room.pauseVoteCount ?? pauseInfo.voteCount,
      voteNeeded: net.room.pauseVoteNeeded ?? pauseInfo.voteNeeded,
    };
  }
  const absent = (net.room?.players ?? [])
    .filter((player) => !player.connected && player.hp > 0)
    .map((player) => player.name);
  el.pauseMessage.textContent =
    absent.length > 0
      ? `${absent.join('、')} 掉线了，对局先停住。等他回来；或者所有人点「同意」，直接淘汰他继续打。`
      : '有玩家掉线了，对局先停住等他回来。';
  el.pauseTimer.textContent = formatClock(pauseInfo.secondsLeft);
  // 我刚点的那一票要等下一次广播才算进来，先乐观 +1，别让人以为没投上
  const shownVotes = votedThisPause ? Math.max(pauseInfo.voteCount, 1) : pauseInfo.voteCount;
  el.pauseVotes.textContent = `同意取消暂停：${shownVotes} / ${pauseInfo.voteNeeded}`;
  el.pauseAgree.classList.toggle('voted', votedThisPause);
  el.pauseAgree.textContent = votedThisPause ? '已同意（等其他人）' : '同意';
  el.pauseAgree.disabled = votedThisPause;
}

el.pauseAgree.addEventListener('click', () => {
  if (votedThisPause) return;
  if (!net.pauseVote()) {
    toast('还没连上服务器，稍等一下再点', true);
    return;
  }
  votedThisPause = true;
  // 票数不再在这里本地改：renderPauseOverlay 会拿服务端的数当准（上面那个 Math.max 负责乐观 +1），
  // 不然下一秒广播回来又把它刷回去，玩家会看到票数自己跳。
  renderPauseOverlay();
});

/** 战斗中那条"看哪一场"的切换条（房间里有 2 场以上才出现） */function renderSpectateBar(): void {  const battles = [...liveBattles.entries()];
  // ★ 0.1.2：自己打完之后（result）到下一回合布阵之前，都可以继续看别人打
  const inBattlePhase = state.phase === 'battle' || state.phase === 'result';
  const visible = netplayActive && inBattlePhase && battles.length >= 2;
  el.spectateBar.classList.toggle('hidden', !visible);
  el.spectateBar.innerHTML = '';
  if (!visible) return;

  const label = document.createElement('span');
  label.className = 'spectate-label';
  label.textContent = '观战：';
  el.spectateBar.appendChild(label);

  for (const [battleId, live] of battles) {
    const chip = document.createElement('button');
    chip.className = `spectate-chip${battleId === viewingBattleId ? ' active' : ''}`;
    chip.textContent = live.myTeam !== null ? `我的战斗（${live.title}）` : live.title;
    chip.title = battleId === viewingBattleId ? '正在看这一场' : '点这里切过去看（进度和别人一致）';
    chip.addEventListener('click', () => watchBattle(battleId));
    el.spectateBar.appendChild(chip);
  }
}

/**
 * ★ 0.1.1：我那一场是不是"到点"了（而我此刻在看别人的对局，该切回去收尾了）。
 *
 * 【为什么用墙钟，不用播放器？】
 * 因为播放器此刻播的是**别人**那一场，读不到我自己的进度。
 * 联机里所有人的播放都被强制 1 倍速、不能暂停（见 showBattle 末尾那段说明），
 * 所以"从收到广播到现在过了多久"就等于"我那一场该播到第几秒了"。
 *
 * 【有没可能误判？】
 * 机器很卡时回放会落后于墙钟，这时候切回去会跳到末尾、跳过一小段 ——
 * 但这正是 `playbackDone` 兜底超时想解决的那类情况，宁可跳过也别让全房间干等。
 */
function shouldReturnToMyBattle(): boolean {
  if (!netplayActive || !currentBattleId) return false;
  /*
    ★ 0.1.2：「回自己那场收尾」只在**我还在打**的时候成立。
    一旦我已经看完自己那场（`result`：结算横幅已经弹过、`playbackDone` 已经举了手），
    就再没有"要回去收尾"这回事了 —— 这时候拉回去只会把玩家刚点开的别人的战斗顶掉，
    表现为"自己打完之后就再也看不了别人"（用户报的就是这个）。
  */
  if (state.phase !== 'battle') return false;
  if (viewingBattleId === currentBattleId) return false; // 已经在看自己那场了
  const mine = liveBattles.get(currentBattleId);
  if (!mine || mine.myTeam === null || mine.durationSeconds === null) return false;
  return (performance.now() - mine.startedAtMs) / 1000 >= mine.durationSeconds;
}

/**
 * 收到一条战斗广播（或断线重连时重放一条）要做的事。
 *
 * 【为什么抽成函数？】重连补发的战斗和实时广播必须走**同一条**处理路径 ——
 * 抄一份必然会漏（这个项目在"同一个动作写两遍"上已经栽过好几次）。
 * 唯一的差别是"从第几秒开始放"：实时是从头（0），重连是跳到该看的位置。
 */
function handleBattleStart(
  payload: Extract<ServerMessage, { t: 'battleStart' }>,
  startSeconds: number,
): void {
  const me = net.playerId;
  const amIPlaying = payload.team0PlayerId === me || payload.team1PlayerId === me;

  /*
    ============================================================
    ★ 0.1.1：每一场都登记下来，但**画面只跟着"该看的那一场"走**
    ============================================================
    服务器会把这一回合的**每一场**战斗都广播给房间里的所有人
    （不参战的人可以旁观，人数为奇数时轮空的人正好能看别人打）。
    以前这里只处理"我自己那一场"，别人那一场直接丢掉 ——
    于是开了打的人从头到尾只能看自己，"观战其他对手"就做不到。
    现在：
      · 每一场都进 `liveBattles`（顶部那条观战列表要用）；
      · 画面默认跟着**我自己那一场**（自己没参战就跟第一场，比如轮空/已淘汰）；
      · 战斗中随时可以用那条列表切到别人的对局（见 watchBattle + 进度同步）。

    【★★ 那条老 bug 的规则一个字都没改】
    以前的写法是"每条 battleStart 都照单全收"：`replay.load()` + `currentResult = ...`，
    后收到的那条会**直接覆盖**先收到的。于是 4 个人时
    P1 先播自己的、再被 P3vP4 覆盖 —— **最后播的是别人的战斗**，
    而且 `myTeam` / 伤害统计 / 回执的 battleId 全都跟着错，
    表现为"一半的人看到的是别人的战斗"。
    所以规则照旧：**自己的战斗优先，别人的不许覆盖。**
      · 正在播自己的  -> 别人的一律忽略
      · 正在播旁观场  -> 自己的来了就换成自己的（自己的永远优先）
      · 轮空/已淘汰    -> 挑第一场旁观（后面来的不再换，免得画面乱跳）
  */
  liveBattles.set(payload.battleId, {
    payload,
    /*
      ★ 0.1.2：`startedAtMs` 要**倒推**到"这一场真正开播的那一刻"。
      它是"别人那场现在该到第几秒"的基准（见 watchBattle 的墙钟对齐）。
      重连补发时如果记成"此刻"，观战进别人的场就会从 0 秒开始 —— 和别人差一大截。
      倒推公式：现在 - 已经过去的时间 = 本该开始的时刻。
    */
    startedAtMs: performance.now() - Math.max(0, startSeconds) * 1000,
    title: battleTitleOf(payload),
    myTeam: payload.team1PlayerId === me ? 1 : payload.team0PlayerId === me ? 0 : null,
    playedSeconds: 0,
    durationSeconds: null,
  });
  renderSpectateBar();

  if (currentBattleId && !amIPlaying) return;

  spectating = !amIPlaying;

  /*
    ★ 0.1.1 阵容丢失保底：服务器那边发现"我这一场报上去的阵容是空的"
    （说明客户端曾经把牌弄丢过一次），于是用了我本回合最近一次的阵容顶上。
    这里必须提示一句 —— 否则玩家看到自己的棋盘空空如也、战斗里却站着一队人，
    会以为是 bug（其实这正是保底在兜）。
  */
  if (payload.safetyNetFor?.includes(net.playerId)) {
    toast('检测到你这一场的阵容曾经丢失，已用最近一次的阵容参战', true);
    state.message = '阵容曾丢失 · 已用最近一次的阵容参战';
  }

  // 「我看完了」这条回执要带它，服务器才知道我举的是哪一场的手
  currentBattleId = payload.battleId;
  // ★ 0.1.2：我这一场要开打了 -> 清掉"已收尾"标记（否则新的一场会被当成已经打完）
  myBattleDone = false;
  // 装进播放器并显示。整套加载逻辑只有 showBattle 一份实现
  showBattle(payload.battleId, startSeconds);
}

/** 这一局还没结束的标记（sessionStorage）—— 用来判断"刷新页面"还是"网络抖动" */
const MID_MATCH_KEY = 'airnight.midmatch';

function markMidMatch(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(MID_MATCH_KEY, '1');
    else sessionStorage.removeItem(MID_MATCH_KEY);
  } catch {
    // 隐私模式忽略
  }
}

/**
 * ★ 0.1.2：这次恢复是"页面重新加载过"吗？（读一次即失效）
 *
 * 【为什么需要这个判断？】
 * 同一条 `onResumeState` 要服务两种完全不同的场景：
 *   · **网络抖动**（页面没重载）：本地 state 一直活着，金币、商店、棋盘都在，
 *     这时候拿服务器那份**滞后**的快照去覆盖，等于把玩家这几秒的操作全抹掉；
 *   · **刷新页面**（F5）：本地 state 是全新的，必须用快照装回去。
 * 两者在代码里长得一模一样，只能靠一个"跨页面加载还活着"的标记区分：
 * sessionStorage 在刷新后仍在，而内存里的模块变量全都重置 —— 正好。
 *
 * 读一次就把它降下来（之后同一页面内的再次重连都按"抖动"处理）。
 */
let reloadPending = true; // 页面刚加载 = 还没消费过

function consumeFreshReload(): boolean {
  if (!reloadPending) return false;
  reloadPending = false;
  try {
    return sessionStorage.getItem(MID_MATCH_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * ★★ 0.2.2：**本页到底有没有装载过这一局**。
 *
 * 【它修的是什么？】
 * `consumeFreshReload` 靠 sessionStorage 的 `MID_MATCH_KEY` 判断"要不要用服务器快照
 * 把棋盘装回来"。但 sessionStorage 是**按标签页**的：
 *   · F5 刷新 —— 还在，判断成立；
 *   · **关掉浏览器 / 换一个标签页重新进游戏**（用户说的"重进"）—— 空的，判断不成立。
 * 于是重进的人拿不到 `myTeam`，棋盘、备战席、金币全是最初状态，
 * 而服务器那边还认为他有一整套阵容 —— 表现就是"我的棋子全没了"。
 *
 * 【现在的判据】
 * 换成"这一页有没有真的装载过这一局"，它是**内存级**的：
 *   · 全新加载的一页 ⇒ false ⇒ 一定用服务器那份还原（不管 sessionStorage 有没有标记）
 *   · 这一页已经在打 ⇒ true ⇒ 网络抖动时**不覆盖**本地的实时状态（那条老规则不变）
 * 什么时候置 false：离开对局、回到大厅（本地 state 被清掉的那些地方）。
 */
let localMatchLoaded = false;

const net = new NetplayClient(defaultServerUrl(), {
  onConnected: () => {
    setNetStatus(`已连接服务器（${net.url}）`, 'online');
    /*
      ★ 0.2.1：连上了却**没有令牌可换身份**（令牌被清 / 这台机器上本来就没那一局）——
      重同步浮层必须立刻收掉。
      不收的表现：浮层（它是盖住整块棋盘的）永远挂着，而这时网络明明是通的，
      玩家只能"放弃并退出" —— 又是一次"点了没反应"。
    */
    if (netplayResyncing && !net.canResume) {
      netplayResyncing = false;
      renderResyncOverlay();
    }
  },
  onWelcome: ({ lanAddresses }) => {
    myLanAddresses = lanAddresses;
    /*
      ★ 0.1.3：一连上就把"版本不一致"摆在明面上 ——
      顶栏红字 + 之后点建房/进房会被拦（服务端也会拒）。
      早点说，比让人对着"加入失败"瞎猜强得多。
    */
    if (net.versionMismatch) {
      setNetStatus(
        `版本不一致：你的是 ${SERVER_VERSION}，服务器是 ${net.serverVersion} —— 请所有人用同一个安装包`,
        'error',
      );
    }
    if (currentView === 'lobby') renderLobby();
  },
  /**
   * ★ 0.1.1：被房主请出了房间。
   *
   * 【为什么和"自己点返回"走同一条路？】
   * 因为结果是一样的：房间已经不要我了，继续挂在房间里只会看到一个
   * 永远不动的房间状态（服务器不会再给我广播）。所以直接 leaveNetplay 回主界面，
   * 只是多弹一条说明原因 —— 否则玩家会以为是"游戏崩了/断线了"。
   */
  onKicked: (reason) => {
    /*
      ★ 0.1.3：把房主的留言**显示给本人**（不再只是一条转瞬即逝的 toast）。
      顺序：先把联机状态清干净（服务器那边已经把我摘出去了），再弹浮层 ——
      这样浮层是盖在主界面上的，玩家点「知道了」就结束。
    */
    leaveNetplay();
    showKickedOverlay(reason);
  },
  onDisconnected: (reason) => {
    /*
      ============================================================
      ★ 0.1.2 断线重连：分两条路走
      ============================================================
      【有令牌 = 座位还在，只是网络断了】
      这时候**绝对不能**像以前那样把人踢回主界面、把对局状态清掉：
        · 清掉 `netplayActive` 会让客户端以为"现在是单机"，自己推进回合、自己刷商店；
        · `resetBoardAndPlayback()` 会把棋盘、战斗演出、伤害统计全清 ——
          等他重连回来，界面是一片空白，看起来像"重开了一局"。
      正确做法：原地等。显示"正在重连"，冻结输入，座位和本地状态都留着，
      网络层那边已经在按 1/2/4/8 秒退避自动重连了（见 netplay-client）。
      重连成功走 `onResumeState`，失败走 `onResumeFailed`（那才是真的回不去）。

      【没有令牌 = 本来就没进过对局 / 令牌已失效】
      保持以前的行为：回主界面，并说清楚原因。
    */
    const urlProblem = serverUrlProblem(net.url);
    if (urlProblem) {
      // "HTTPS 网页 + ws:// 服务器"会被浏览器直接拦掉，一个字节都发不出去。
      // 这种时候把真正的原因说出来，能省掉查服务器、查防火墙的一整轮。
      netplayResyncing = false;
      netplayActive = false;
      netplayMatchOver = false;
      hideResultPage();
      setNetStatus(urlProblem, 'error');
      leaveNetplay();
      toast(urlProblem, true);
      return;
    }

    if (net.canResume && (netplayActive || net.room)) {
      netplayResyncing = true;
      // 结算页先收起来（它属于"那一场"，重连后服务器会给准确的状态）
      hideResultPage();
      setNetStatus(`${reason}。座位已保留，正在自动重连…`, 'error');
      state.message = '与服务器断开，正在重连…（座位和进度都会保留）';
      renderAll();
      return;
    }

    const wasPlaying = netplayActive;
    netplayActive = false;
    netplayResyncing = false;
    netplayMatchOver = false;
    hideResultPage();
    setNetStatus(`${reason}。${reason.includes('主动') ? '' : '正在自动重连…'}`, 'error');
    // 对局中断线：灰溜溜地回主界面，别把玩家晾在一个推不动的棋盘上
    if (wasPlaying) {
      window.clearTimeout(nextRoundTimer);
      // 断线也要把这一局的残留（战斗演出 + 伤害统计）清掉，
      // 否则下次进游戏会看到上一局的伤害表（同 backToMenu 那条）
      resetBoardAndPlayback();
      setView('menu');
      toast('与服务器断开，已回到主界面', true);
    } else if (currentView === 'lobby') {
      setView('menu');
    }
    renderAll();
  },
  onError: (code, message) => {
    console.warn(`[联机] ${code}: ${message}`);
    toast(message, true);
    setNetStatus(message, 'error');
    /*
      ★ 0.3：昵称被拒的两种情形，光弹一句 toast 不够 —— 玩家得**接着改**。

      · 改名（pendingRename 还在）：把弹窗原样弹回来，输入框里留着他刚填的名字，
        下面写清楚为什么不行。以前是"弹窗已经关了、只闪一条错"，等于逼他重来一遍。
      · 建房 / 进房：把焦点放回刚才那个名字输入框。
        靠 lastFocusedNameInput 记住是哪个框 —— 只给一句话的话，玩家还得自己找。
    */
    if (code === 'NAME_TAKEN' || code === 'BAD_NAME') {
      const attempt = pendingRename;
      if (attempt) {
        const shown = net.room?.players.find((player) => player.id === attempt.playerId);
        openRenameDialog(attempt.playerId, shown?.name ?? '');
        el.renameInput.value = attempt.name;
        el.renameError.textContent = message;
        el.renameInput.focus();
        el.renameInput.select();
      } else {
        // 建房 / 进房：弹一个明确的窗（光靠 toast 玩家会错过，见 showNameAlert 的说明）
        showNameAlert(message);
        if (lastFocusedNameInput) {
          lastFocusedNameInput.focus();
          lastFocusedNameInput.select();
        }
      }
    }
  },
  onRoom: (room) => {
    /*
      ★★ 0.3.2：先看修订号有没有跳号。
      跳号 = 我漏收了至少一份房间广播（网络抖动 / 标签页被冻住 / 刚从断网恢复）。
      不补的话客户端会**一直停在那份旧状态里**，别人已经进下一回合了我还在原地 ——
      这就是用户说的"两个玩家看到的不一样"（平行世界）。
      补的方式是 `requestSync`：服务器回 phaseState + room + pool + prepTeams，
      四条都是幂等的，不会触发回合结算（所以不会白送收入）。
      ★ 换房间时必须重新立基准，否则会拿上一个房间的 rev 去比，永远"跳号"。
    */
    if (room.code !== lastRoomCode) {
      lastRoomCode = room.code;
      lastRoomRev = typeof room.rev === 'number' ? room.rev : -1;
      syncRequestPending = false;
    } else if (typeof room.rev === 'number') {
      if (lastRoomRev >= 0 && room.rev > lastRoomRev + 1 && !syncRequestPending) {
        syncRequestPending = true;
        console.warn(`[联机] 房间修订号跳号 ${lastRoomRev} → ${room.rev}，向服务器补一份快照`);
        net.requestSync();
        /*
          ★ 兜底：万一服务器没回（比如这一瞬间正好掉线），别让这个"等回复"的标记
          永久挂着 —— 挂着就再也不会为下一次跳号发请求了。3 秒后自动放开。
        */
        window.setTimeout(() => {
          syncRequestPending = false;
        }, 3000);
      }
      lastRoomRev = Math.max(lastRoomRev, room.rev);
    }
    // ★ 0.1.2：进房 / 退房要把"本机会话"跟着对齐（内含去重，不会每帧都发请求）
    syncMachineSessionForRoom();
    /*
      ★★ 0.3：盟约选秀页的显隐只跟 `phase` 走。
      放在 onRoom 的最前面：服务端每秒都会重播房间状态（倒计时），
      这里必须能跟上，不能等 renderAll（那时候可能还没切视图）。
    */
    syncCovenantPage(room);
    /*
      ★ 0.1.3：对局暂停（在线玩家不足 2 人）要说清楚在等什么。
      服务端这时候不开新回合、也不推布阵倒计时 —— 不提示的话，
      留下的人只会看到一个不动的画面，以为游戏卡死了。
    */
    const pausedNow = room.paused === true;
    if (pausedNow !== matchPaused) {
      matchPaused = pausedNow;
      /*
        ★ 0.1.4：每一轮暂停都要把"我投过票"复位 ——
        暂停结束要复位；暂停途中又有人掉线时，服务端也会把票清零（倒计时重新开始），
        那时候不复位的话按钮会一直灰着，看起来像坏了。
      */
      votedThisPause = false;
      // ★ 0.1.4：新一轮暂停 —— tick 还没来，先允许房间广播把初始秒数垫上
      pauseTickSeen = false;
      pauseInfo = {
        secondsLeft: room.pauseSecondsLeft ?? 0,
        voteCount: room.pauseVoteCount ?? 0,
        voteNeeded: room.pauseVoteNeeded ?? 0,
      };
      if (pausedNow) {
        state.message = '有玩家掉线了，对局暂停 3 分钟 —— 等他回来，或所有人点「同意」直接淘汰他';
        toast('有玩家掉线了，对局暂停中（所有人点「同意」可以提前结束）');
      } else {
        state.message = '对局继续';
        toast('对局继续');
      }
    }
    // 在房间里、还没开局 -> 显示房间等待界面
    if (room.phase === 'lobby') {
      /*
        ★★ 0.3.5：「再来一局」回来的人要落到大厅，而不是继续盯着战绩页。
        判据用"战绩页还开着" —— 刚进房间（第一次）时它本来就是关的，不会误弹提示。
      */
      const wasResultPageOpen = el.resultPage && !el.resultPage.classList.contains('hidden');
      if (wasResultPageOpen) {
        hideResultPage();
        toast('已回到房间，等房主再开一局');
      }
      /*
        ★ 这一局已经结束了（房间退回大厅）—— 保持 `netplayMatchOver = true`，
        这样下一条 `gameStarted` 会被当成"新的一局"（重建 state、清棋盘、重置经济），
        而不是"下一回合"（那会沿用上一局残局）。
      */
      if (wasResultPageOpen) netplayMatchOver = true;
      setView('lobby');
      renderLobby();
    }
    renderAll();
  },
  /**
   * ★★ 0.3.2：服务器回的"当前回合 / 阶段"权威口径（`requestSync` 的答复）。
   *
   * 【三种情况怎么处理？】
   *   · 回合比我**旧**（快照迟到）→ 直接忽略；
   *   · 回合**一样** → 只把倒计时基准对齐（数字仍由每帧换算，见倒计时铁律）；
   *   · 回合比我**新** → 我漏掉了整段（连 `gameStarted` 都没收到）。
   *     这时**不能**就地跳回合：漏掉的很可能是"一整回合的结算"（发钱 / 发经验 / 刷商店），
   *     硬跳过去经济会少一截，等于制造新的不同步。
   *     正确做法是走一次**硬重连**（`resumeState` 全量快照），把回合、阶段、阵容、
   *     牌库一次性装回服务器那一份 —— 这条路径 0.1.2 起就在用，最稳。
   */
  onPhaseState: (payload) => {
    syncRequestPending = false;
    if (payload.round < state.round) return;
    if (payload.round === state.round) {
      if (payload.phase === 'prep') prepSecondsLeft = payload.prepSecondsLeft;
      if (payload.phase === 'shop' && state.shopRound) {
        state.shopRound.secondsLeft = payload.shopSecondsLeft;
      }
      renderAll();
      return;
    }
    requestHardResync(`服务器在第 ${payload.round} 回合，本地还在第 ${state.round} 回合`);
  },
  onGameStarted: (roomCode, round, phase, shopSecondsLeft) => {
    /*
      【这是开局那一次，还是新的一回合？】
      服务器在「开局」和「每次进入下一回合」都会发 `gameStarted`。
      两种情况算"新的一局"：
        · 之前根本不在联机里（刚进房间）
        · 上一局已经打完了（netplayMatchOver）
      这个判断决定要不要做"回合结算"（发钱 / 发经验 / 刷商店）。

      ★ 不能只看 `netplayActive`：打完一局之后它仍然是 true（见 onGameOver
      里的说明），只看它会漏掉"上一局打完后直接开了新一局"这种情况，
      结果是新一局开局就白送一次回合收入。
    */
    const isMatchStart = !netplayActive || netplayMatchOver;

    netplayActive = true;
    netplayMatchOver = false;
    /*
      ★ 0.2.2：这一页从此**装载着这一局**了 ⇒ 之后的网络抖动不再用服务器快照覆盖本地。
      （服务器第一次发 `gameStarted` 就是"我这一局已经开始"的权威信号。）
    */
    localMatchLoaded = true;
    // ★ 0.1.2：新回合的广播本身就是"连接活着"的最好证明，重连状态可以收了
    netplayResyncing = false;
    /*
      ★ 0.1.2：打上"我这一局还没结束"的标记。
      它是**刷新页面**之后判断"该不该用服务器快照把棋盘装回来"的唯一依据
      （见 consumeFreshReload 的说明）。sessionStorage 刷新后仍在，
      而模块内存全重置 —— 正好用来区分"抖动"和"重载"。
    */
    markMidMatch(true);
    spectating = false;
    /*
      ★ 0.1.1：换回合先把倒计时清掉。
      服务器是"开局 1 秒后"才推第一条 prepTick，不清的话新回合的头一秒
      会挂着上一回合剩下的「布阵 0s」—— 那一下也是"闪"的一种。
    */
    prepSecondsLeft = null;
    // ★ 保险：万一还在测试模式（比如先开了测试模式再进房间），
    // 这里强制退出，绝不能让无限金币 / 双阵营沙盒带到联机对局里
    if (state.testMode) {
      state.testMode = false;
      toast('已自动退出测试模式（联机对局不能用）', true);
    }
    testSides = null;
    activeTestTeam = 0;
    /*
      ★ 0.1.1：联机时把"藏品随机招募"的仲裁者接上 ——
      牌库是全房间共享的，招募到的人必须由服务器扣牌（见 state.recruitRequest 的说明）。
      单机不设这个钩子，本地直接抽（规则同一份：shared 的 pickRecruit）。
    */
    state.recruitRequest = (req) => {
      if (!net.recruitFromPool(req.minCost, req.maxCost, req.seed)) {
        toast('网络未连接，招募申请没能发出去', true);
      }
    };

    /*
      ★ 新的一局 -> 一切从零开始。

      【这里原来也漏了，是个更隐蔽的 bug】
      单机开新局是 `state = createGameState()`（见 startSinglePlayer），
      但联机的 `gameStarted` **没有**重建 state —— 于是：
        · 先打了一局单机、再进房间开局 -> 上一局的棋子还站在场上，金币也是上一局的
        · 打完一局联机、再开一局新的     -> 同样沿用上一局的经济和阵容
      玩家看到的就是"我明明开了新一局，场上怎么还是刚才那套"。

      放在结算**之前**：新的一局不该沿用上一局的经济，
      所以顺序必须是"先重置、再（只对非开局回合）结算"。
    */
    if (isMatchStart) {
      /*
        ★ 0.1.1：「已被淘汰」只在新的一局开始时复位。
        不能每回合都复位 —— 否则出局的人一到下一回合就又"活过来"能操作了。
      */
      state.meEliminated = false;
      // ★ 0.1.1：新的一局 -> 把上一局的结算页收掉
      hideResultPage();
      /*
        ★ 种子必须**每个玩家都不一样**。
        原来这里是 `createGameState()`（不传种子）-> `freshSeed()`，
        而 freshSeed 是 `Date.now() ^ 自增计数`：服务器在同一个循环里
        挨个 socket 广播 gameStarted，几台客户端会在同一毫秒收到，
        各自的计数又都是 1 —— 于是全员同种子，商店刷出一模一样的牌。
        改成用「房间码 + 服务器分配的 playerId」哈希（见 playerShopSeed）。
      */
      /*
        ★ 0.3：开局金币 / 每回合基础收入从**服务端下发的房间设置**里取。
        ★ 不能在这里读常量 —— 那等于"房主设 50 金、别人还是 3 金"，
          而且改本地就能改规则（和反作弊要堵的是同一个洞）。
      */
      /*
        ★★ 0.3 盟约：经济类加成在这里折算一次（开局金币 / 每回合基础收入）。
        ★ 战斗类加成不在这儿 —— 它走 `toTeamSetup` 里的 `covenantTraitBonuses`。
      */
      const myCovenantId = net.room?.players.find((p) => p.id === net.playerId)?.covenantId;
      const roomRules = gameRulesOf(net.room?.settings);
      const covenantMoney = covenantEconomy(myCovenantId);
      state = createGameState(playerShopSeed(net.room?.code ?? roomCode, net.playerId), {
        startGold: roomRules.startGold + covenantMoney.startGold,
        incomeBase: roomRules.incomeBase + covenantMoney.income,
      });
      state.covenantId = myCovenantId;
      // ★ 0.3.4：联机新开一局同样作废组队器计划（和单机同一口径：仅本局有效）
      resetTeamPlanForNewGame();
      // ★ 0.3.4：新的一局 -> 自动补位的"本回合已做过"标记跟着复位
      autoFillDoneRound = null;
      /*
        ★ 0.3.2：盟约「不容拒绝」开局送一只 1 星阿米娅。
        ★ 必须在这儿（而不是"第一次回合结算"）—— 用户口径是**开局就有**，
          第 1 回合布阵时玩家就要能把她摆上场。
      */
      applyCovenantOpening(state);
    } else {
      /*
        ★★ 0.3：**每一回合都要对齐一次盟约 id**，不能只在开局那一次设。
        因为「命结之秘」是内核里判的（`covenantId` 跟着 `TeamSetup` 进战斗），
        客户端这一份一旦丢了（刷新页面重连后 `state` 是全新的），
        本地算出来的战斗和服务器那份就不一样 ⇒ 校验和不一致 ⇒ 打完卡住。
        这里顺带也把"中途选了盟约"这种情况覆盖掉。
      */
      syncMyCovenantFromRoom();
    }

    /*
      ★ 新的一回合 -> 结算上一回合的经济。

      【这里原来漏了一整块，是个很显眼的 bug】
      联机时 `gameStarted` 只改了 `state.round`，**从来没调用过回合结算** ——
      于是整局下来：没发过钱、没给过经验、商店永远是开局那一批。
      玩家的感受就是"经济系统没运行 / 商店不刷新"。

      注意顺序：必须在 `currentResult = null` **之前**结算，
      因为"奸商"羁绊要看上一场的存活名单，而名单要从战斗日志里数。
    */
    if (!isMatchStart) {
      settleNetplayRound();
    }

    clearPrepSprites();
    replay.clear();
    currentResult = null;
    // ★ 0.3.5：新回合 -> 上一场的账本作废（结算已经在上面做完了）
    clearMyBattle();
    currentBattleId = null;
    // ★ 0.1.1：新回合 -> 上一回合那几场战斗的记录全部作废（观战列表也要清空）
    liveBattles = new Map();
    viewingBattleId = null;
    // ★ 0.1.2：新回合，上一场的"已收尾"标记跟着作废
    myBattleDone = false;
    /*
      ★★ 0.2 商店回合（联机）：服务器说了这一回合**先开商店**。
      本地那个商店是 `settleNetplayRound()`（走 `advanceRound`）自己开的 ——
      两边用的是 shared 里同一份 `isShopRoundAfter`，所以正常情况下它已经在那儿了。
      这里只做两件事：
        ① 把**服务端**的剩余秒数对齐过来（联机里一律以服务端为准，
           客户端不能自己往下数 —— 不然重连一次就对不上了）；
        ② 万一本地没有（比如这台机器刚重连、漏了结算），补开一次。
      ★ `enterPrepPhase` 仍然要走：商店还开着时它不会把阶段抹回 prep。
    */
    if (phase === 'shop') {
      if (!state.shopRound) enterShopRound(state);
      if (state.shopRound && typeof shopSecondsLeft === 'number') {
        state.shopRound.secondsLeft = shopSecondsLeft;
        state.shopRound.open = true;
      }
      netShopSecondsLeft = typeof shopSecondsLeft === 'number' ? shopSecondsLeft : null;
    } else {
      netShopSecondsLeft = null;
      // 服务器没说有商店，本地却开着（对不上了）—— 听服务器的，收摊
      if (state.shopRound) closeShopRound(state);
    }
    enterPrepPhase(state);
    state.message =
      phase === 'shop'
        ? `第 ${round} 回合 · 坎诺特来了，商店 ${state.shopRound?.secondsLeft ?? SHOP_ROUND_SECONDS} 秒`
        : // ★ 0.3：布阵秒数跟着房间设置走（第 1~3 回合它自己会固定成 30）
          `第 ${round} 回合 · 布阵 ${prepSecondsForRound(round, roomSettingsOf(net.room).prepSeconds)} 秒，时间到自动开打`;
    state.round = round;
    setViewFlipped(false);
    board.setHalfTint(false);
    replay.setFlip(false);
    // 新回合：回到自己的棋盘（上回合可能在瞄别人的阵容）
    viewingPlayerId = null;
    lastSpritePlan = [];
    // 阵容要重新同步给服务器（服务器那边这一回合的阵容是空的）
    lastSyncedTeam = '';
    // 等级/连胜也是新一局的，要重新上报一次（去重签名清掉）
    lastSyncedStats = '';
    /*
      新回合：服务器已经把"商店预定"清空了（离线的玩家不会重报），
      所以这里强制重报一次 —— 商店锁着没变的情况下，签名去重会把它跳过去，
      结果就是我锁住的那几张牌永远占不到（别人能刷出"我已经摆在店里"的牌）。
    */
    lastShopHeldSignature = null;
    closeUnitInfo();
    el.battleOpponent.classList.add('hidden');
    setView('game');
    renderAll();
    toast(isMatchStart ? `对局开始，房间 ${roomCode}` : `第 ${round} 回合开始`);
  },
  /**
   * ★ 0.1.4：暂停倒计时（每秒一条）。
   * 只更新浮层上那几个数字 —— `renderAll` 会重建商店 / 藏品 / 备战席的 DOM，
   * 一秒来一次太重，也可能把玩家正在拖的东西打断（和 prepTick 同一个理由）。
   */
  onPauseTick: (info) => {
    /*
      票被清零 = 服务端把倒计时重新开了（暂停途中又有人掉线），我这一票作废，得能重新表态。
      ★ 判据只能是"服务端说现在 0 票"：不能拿 pauseInfo.voteCount（那是上一秒的数）比，
        因为点完「同意」以后 renderPauseOverlay 会立刻用房间广播把它刷回服务端的 0，
        于是 `pauseInfo.voteCount > 0` 永远是假 —— 按钮就一直灰着，看着像坏了。
    */
    if (info.voteCount === 0) votedThisPause = false;
    // ★ 0.1.4：收到 tick 了 —— 从这一刻起秒数只认它（否则会被房间广播刷回 3:00）
    pauseTickSeen = true;
    pauseInfo = info;
    renderPauseOverlay();
    renderPhaseBadge();
  },
  /**
   * ★★ 0.2 商店回合：服务端每秒推的商店剩余秒数。
   *
   * 【为什么联机里客户端不能自己往下数？】
   * 网络抖动 / 重连之后本地那份 `secondsLeft` 和服务端的不一样，
   * 而"商店什么时候打烊"是全房间同步的事 —— 各人数各的就会出现
   * "我这儿还在 40 秒、别人已经进布阵了"。
   * 和 `prepTick` 完全同一个思路：秒数只有一个来源（服务端）。
   */
  onShopTick: (secondsLeft) => {
    netShopSecondsLeft = secondsLeft;
    if (!state.shopRound) return;
    state.shopRound.secondsLeft = secondsLeft;
    // 只刷新那两个秒数，别整块重画（和 prepTick 同一个理由）
    syncShopRoundTimers();
    renderPhaseBadge();
  },
  /**
   * ★★ 0.3 盟约选秀：服务端每秒一条**纯倒计时**。
   * 只更新基准（数字由每帧的 `syncCovenantTimer` 写），**不** renderAll ——
   * 那会重建整个选秀页，把玩家正在悬停的卡片打断。
   */
  onCovenantTick: (secondsLeft) => {
    setCovenantBaseline(secondsLeft);
    syncCovenantTimer();
  },
  /** ★ 0.2：服务端说商店打烊了 -> 收摊回布阵（紧接着就会来 prepTick） */
  onShopEnded: () => {
    netShopSecondsLeft = null;
    if (state.shopRound) closeShopRound(state);
    prepSecondsLeft = null;
    renderAll();
    toast('商店打烊了 —— 继续布阵');
  },
  onPrepTick: (secondsLeft) => {
    // ★ 0.2：布阵的 tick 来了 = 商店肯定已经结束了（双保险，防消息乱序漏掉 shopEnded）
    netShopSecondsLeft = null;
    renderLobby();
    /*
      ★ 0.1.1：倒计时只改这一个数据源，然后交给 renderPhaseBadge 去画。
      （以前在这里直接 `el.phase.textContent = ...`，和 renderAll 抢同一个元素，
        两边格式还不一样 -> 倒计时闪烁。见 renderPhaseBadge 的说明。）
      ★ 也**不能**在这里调 renderAll()：它每秒会重建商店 / 藏品栏 / 备战席的 DOM，
        正在拖动的时候元素被换掉，指针捕获当场失效（就是"藏品标签卡住"的成因之一）。
    */
    if (state.phase === 'prep') {
      // ★ 0.3.4：布阵最后一秒自动补位（联机没有"开战"按钮，只能在这里做）
      if (secondsLeft <= 1) tryAutoFillBeforeNetplayBattle();
      prepSecondsLeft = secondsLeft;
    }
    renderPhaseBadge();
    // 血量在最后几秒要藏起来，所以每一秒都得重画一次玩家列表
    renderPlayerStrip();
  },
  /**
   * 布阵期间某个人改了他的阵容 —— 更新"看别人阵容"用的数据。
   *
   * 【为什么只在布阵阶段收？】
   * 进入战斗后大家的阵容就锁定了，再收也没意义（而且战斗里的布阵棋子本来就不显示）。
   */
  onPrepTeams: (teams) => {
    prepTeams = teams;
    renderPlayerStrip();
  },
  onBattleStart: (payload) => {
    handleBattleStart(payload, 0);
  },
  /*
    ============================================================
    ★ 0.1.2：断线重连成功
    ============================================================
    服务器把我们离开期间错过的**所有增量事件**压成一份当前状态发过来了
    （房间 / 牌库 / 观战阵容 / 我本回合的阵容 / 正在播的战斗）。
    这里按它把界面和状态摆回对局现场。

    【顺序很重要】先恢复"我"（棋盘、金币），再恢复"别人看到的我"，
    最后才是战斗 —— 因为战斗回放要用到恢复好的 state（观战/回执都要读它）。
  */
  onResumeState: (payload) => {
    netplayActive = true;
    netplayMatchOver = false;
    netplayResyncing = false;
    // 座位和房间都回来了 —— 令牌继续留着（下一次抖动还要用）
    markMidMatch(true);
    setNetStatus(`已重连回房间 ${payload.room.code}`, 'online');

    // 牌库（`pool` 广播平时是增量，重连这次是全量）
    net.pool = new Map(Object.entries(payload.pool.remaining));
    net.held = payload.pool.held;
    // 观战用的"别人摆了什么"
    prepTeams = payload.prepTeams;
    state.meEliminated = payload.eliminated;

    /*
      ★ "全新装载的一页"和"网络抖动"要分开对待：
        · 网络抖动：本地的 state 一直活着（金币、商店、棋盘都在），
          **绝不能**拿服务器那份滞后的快照去覆盖它 —— 那等于把玩家这几十秒
          的操作全抹掉。只对齐服务端权威的那几样（血量、回合、阶段）。
        · 全新装载 / 刷新页面：本地 state 是全新的一份（金币回到开局值、棋盘全空），
          这才需要用服务器手里那份"我最后上报的阵容"把棋盘和金币装回去。

      ★★ 0.2.2：判据从"sessionStorage 里有没有 mid-match 标记"换成
        **"这一页有没有装载过这一局"（`localMatchLoaded`）** ——
        sessionStorage 是**按标签页**的，关掉浏览器 / 换个标签页"重进"时它是空的，
        于是旧判据会**拒绝还原**，玩家的棋盘和备战席直接归零（用户报的丢数据）。
        `localMatchLoaded` 是内存级的：新的一页一定是 false ⇒ 一定还原。

      ★ `consumeFreshReload()` 仍然每次都调 —— 它内部会把"待消费"标记降下来，
        不消费的话，之后同一页里的抖动重连会误判成"刚刷新过"。
    */
    const reloadFlag = consumeFreshReload();
    const shouldRestore = !localMatchLoaded || reloadFlag;
    if (shouldRestore && payload.myTeam) {
      applySubmittedTeam(state, payload.myTeam);
      toast('已回到对局：棋盘与经济按你最后一次同步的状态恢复');
    } else if (shouldRestore && !payload.myTeam) {
      /*
        服务器手里也没有我的阵容 —— 说得清楚一点，别让玩家对着空棋盘以为是坏档。
        （正常不会走到这儿：只要同步过一次 `submitTeam`，`lastSeenTeam` 就有值。）
      */
      state.message = '已回到对局，但服务器没有你的阵容记录 —— 请重新摆放';
    }
    localMatchLoaded = true;

    // 服务端权威的血量：一律以它为准
    const me = payload.room.players.find((player) => player.id === payload.playerId);
    if (me) state.economy.hp = me.hp;
    /*
      ★ 0.3.31：血量上限的基准也跟着房间设置走（房主可能改过「开局血量」）。
      不然客户端会拿默认的 100 去夹回血，而服务端拿 settings.startHp 夹 ——
      两边口径不一致时，藏品回血的提示数字又是"说谎"。
    */
    if (payload.room.settings?.startHp) state.economy.startHp = payload.room.settings.startHp;
    /*
      ★ 0.3：重连（尤其"刷新页面"那种，本地 state 是全新的）之后一定要把盟约补回来
      —— 否则下一场战斗里「命结之秘」只有服务端会判，两边校验和对不上，直接卡住。
    */
    if (me?.covenantId) state.covenantId = me.covenantId;

    clearPrepSprites();
    replay.clear();
    currentResult = null;
    // ★ 0.3.5：重连后账本重新长（下面的 handleBattleStart 会把我那一场补进来）
    clearMyBattle();
    currentBattleId = null;
    liveBattles = new Map();
    viewingBattleId = null;
    myBattleDone = false;
    // ★ 去重签名全部清掉：重连后必须**强制重发**这三条，否则服务器/别人那边还是旧数据
    //   （这是最隐蔽的一类坑：界面看着正常，但别人看到的你还是断开前那套阵容）
    lastSyncedTeam = '';
    lastSyncedStats = '';
    lastShopHeldSignature = null;

    setViewFlipped(false);
    board.setHalfTint(false);
    replay.setFlip(false);

    if (payload.room.phase === 'lobby') {
      // 只是在大厅里掉线了 —— 回大厅，不算对局
      netplayMatchOver = true;
      setView('lobby');
      renderLobby();
    } else {
      state.round = payload.round;
      if (payload.phase === 'shop') {
        /*
          ★ 0.2：重连时正赶上商店阶段 —— 把商店**补开**出来。
          【为什么是"补开"而不是等服务端下一条？】
          服务端只在**进入**商店那一刻发过一次 gameStarted，之后只有 shopTick。
          重连的人没收到那一条，就只能靠这份快照补 —— 不然他会盯着一个
          "听说在商店、但什么都没有"的画面。
          ★ 秒数以服务端为准（`payload.shopSecondsLeft`），本地不自己数。
        */
        netShopSecondsLeft = payload.shopSecondsLeft ?? SHOP_ROUND_SECONDS;
        enterShopRound(state);
        state.shopRound!.secondsLeft = netShopSecondsLeft!;
        state.message = `第 ${payload.round} 回合 · 坎诺特来了，商店 ${netShopSecondsLeft} 秒`;
      } else if (payload.phase === 'prep') {
        state.phase = 'prep';
        prepSecondsLeft = payload.prepSecondsLeft;
        netShopSecondsLeft = null;
        state.message = `第 ${payload.round} 回合 · 布阵 ${payload.prepSecondsLeft} 秒，时间到自动开打`;
      } else {
        /*
          服务端的 battle / resolve 在客户端都表现为"战斗阶段"：
          resolve = 战斗已经放完、在等别人看完回执 —— 画面上还是战斗。
          真正的"我该看哪一场"由下面重放的 battles 决定（没有就保持空白一帧，
          下一条 `gameStarted` 马上会到）。
        */
        state.phase = 'battle';
        state.message = '已重连 · 正在追赶这一场战斗';
      }
      setView('game');
      // 重放这一回合正在打的每一场（顺序照旧：自己那场优先，别人的只登记进观战列表）
      for (const entry of payload.battles) {
        handleBattleStart(entry.battle, Math.max(0, entry.elapsedMs / 1000));
      }
    }

    // 强制把"我的阵容 / 商店占用 / 等级连胜"重新报一遍（去重签名已清空）
    syncTeamToServer();
    syncShopHeld();
    syncPlayerStatsToServer();
    renderAll();
    renderPlayerStrip();
    renderSpectateBar();
  },
  /** 重连失败：这一局回不去了，收拾干净回主界面 —— 但必须**明说是哪一局、为什么** */
  onResumeFailed: (code, message, roomCode) => {
    /*
      ★ 0.1.4：房间号由网络层**递进来**（见 netplay-client 的 `resumeFailed` 分支）——
      它在清令牌之前就取好了。
      这里**不能**自己去查：`clearResumeToken()` 在回调之前已经跑过，
      本机会话早被清掉了，`getMachineSession()` 那一刻是 null，
      自己查只会拿到空字符串（"哪一局"就说不出来了）。
    */
    netplayResyncing = false;
    markMidMatch(false);
    leaveNetplay();
    /*
      ★ 不再用 2 秒就消失的 toast —— 那正是"点了没反应 / 不知道发生了什么"的成因。
      改成要点掉才消失的浮层，并把错误码一起显示（这个项目没有日志文件，截图最有用）。
    */
    showResumeFailedOverlay(code, message, roomCode);
  },
  /**
   * ★ 被顶号：你在另一处进入了游戏。
   *
   * 【为什么要单独处理？】同一个令牌从两个地方连进来时"后到的顶掉先到的"，
   * 先到的必须**干净退出且不再自动重连**（客户端网络层已经不再重连了）。
   * 用一句人话说清楚，别让玩家以为是断线了。
   */
  onReplaced: (reason) => {
    netplayResyncing = false;
    markMidMatch(false);
    leaveNetplay();
    toast(`${reason}（这个标签页已退出对局）`, true);
  },
  onBattleEnd: (payload) => {
    /*
      ★★★ 0.3.5：服务端的胜负是**权威口径**，收到就补进"我这一场"的账本。
      为什么必须以它为准？
        · 扣血、淘汰、连胜的账都在服务端（`applyBattleResult`）；
        · 客户端只负责"演"。两边一旦有分歧（校验和、旧阵容、重连补发……），
          以服务端为准才不会再出现"画面写胜利、血却在掉"这种撕裂。
      ★ 只补进**我自己那一场**（`battleId` 对得上才补）—— 别人的战斗不许碰我的账。
    */
    if (myBattle && payload.battleId === myBattle.battleId && myBattle.serverWinner !== payload.winner) {
      /*
        先把分歧记下来再采纳：这条日志是排查"胜负不一致"最直接的证据
        （项目没有日志文件，控制台/截图就是全部材料）。
      */
      if (myBattle.winner !== payload.winner) {
        console.error(
          `[联机] 胜负判定不一致！服务器 ${payload.winner}，本地重放 ${myBattle.winner}（battleId=${payload.battleId}）`,
        );
        toast('⚠ 本地重放与服务器的胜负不一致，已按服务器结算', true);
      }
      rememberMyBattle({ ...myBattle, serverWinner: payload.winner });
    }

    const myHp = payload.hpAfter[net.playerId];
    if (typeof myHp === 'number') state.economy.hp = myHp;
    renderAll();
  },
  onPlayerEliminated: (playerId) => {
    const player = net.room?.players.find((p) => p.id === playerId);
    if (playerId !== net.playerId) {
      toast(`${player?.name ?? '某位玩家'} 被淘汰了`);
      return;
    }
    /*
      ============================================================
      ★ 0.1.1：被淘汰的是**我自己**
      ============================================================
      服务端那边已经把我场上 + 备战席的牌全部还回共享牌库了
      （见 Room.returnCardsToPool），本地要跟着做两件事：

        1. 把自己的棋盘和备战席清空 —— 那些牌已经不属于我了，
           留在画面上会让人以为"我还能用"；
        2. 锁死一切操作（`state.meEliminated`）：商店 / 刷新 / 锁定 / 买经验 /
           拖棋子全部失效，只剩「观战」这一件事。

      ★ 为什么必须锁死？因为牌已经回库了。如果还能买，
        同一张牌会被卖掉第二次、或者被我买回第三次 —— 牌库的账当场就乱。
    */
    state.meEliminated = true;
    state.placements = [];
    state.economy.bench = [];
    state.selectedBenchUid = null;
    state.message = '你已被淘汰，现在只能观战';
    cancelDrag();
    closeUnitInfo();
    toast('你已被淘汰：手里的牌已归还牌库，接下来只能观战', true);
    renderAll();
  },
  onGameOver: (payload) => {
    /*
      ★ 注意：这里**不能**把 netplayActive 设成 false。
      那会让客户端以为"现在是单机"，然后自己推进回合、生成人机对手。
      用 netplayMatchOver 表示"这一局打完了"，联机模式本身还开着（人还在房间里）。
    */
    netplayMatchOver = true;
    state.phase = 'result';
    /*
      ★ 0.1.1：联机对局结束 -> 打开**结算页**（排名 / 阵容 / 羁绊 / 最高伤害）。
      数据全在 `payload.standings` 里，是服务器算好的 ——
      客户端一个数都不自己算（否则 8 台机器会各算各的，名次都可能不一样）。
      单机那条路仍然用会自动消失的横幅（它没有"其他玩家的数据"可展示）。
    */
    renderResultPage(payload);
    renderAll();
  },

  /**
   * 牌库变了（任何人买卖都会广播）。
   *
   * 【为什么要跟着重画商店？】
   * 因为"这张牌还有没有货"是显示在卡片上的信息。
   * 别人把最后一张买走之后，我这边如果不重画，
   * 卡片上还写着"有货"，点了却买不到 —— 这种"显示和实际不一致"最让人恼火。
   */
  onPool: (remaining, held) => {
    setNetPoolView(remaining, held, net.playerId);
    // 商店里已经被抽干的格子，直接标成买不了（下次刷新就不会再出现）
    renderShop();
  },

  /**
   * 我的买牌申请有结果了。
   *
   * 【关键：服务器说 ok 才真的收下】
   * 因为牌库全房间共享，得先由服务器扣掉那张牌。
   * 如果本地直接买，三个人能同时买到同一张牌的最后一张。
   */
  onBuyResult: (payload) => {
    /*
      ★★ 0.2 商店回合：服务器这次批准的是"商店回合那个 2 星干员位"。
      它和常规商店那一格是**两套货架**，所以必须分开认领 ——
      用 `pendingShopRoundOperator` 而不是 `pendingBuySlot`。
      忘掉这一条的表现：在商店回合买 2 星干员永远提示"商店已经刷新，
      这次购买取消了"（因为常规商店里根本没有这一格），而且牌白扣 3 张。
    */
    if (pendingShopRoundOperator !== null) {
      const shopIndex = pendingShopRoundOperator;
      pendingShopRoundOperator = null;
      if (!payload.ok) {
        toast(payload.message, true);
        renderAll();
        return;
      }
      const result = applyApprovedShopRoundOperator(state, shopIndex);
      if (!result.ok) {
        // 本地失败（金币不够 / 备战席满）：把那 3 张还回牌库
        net.sellCard(payload.defId, OPERATOR_SLOT_STAR, OPERATOR_SLOT_COPIES);
        toast(result.message, true);
        renderAll();
        return;
      }
      toast(result.message);
      renderAll();
      syncTeamToServer();
      return;
    }

    const slotIndex = pendingBuySlot;
    pendingBuySlot = null;

    if (!payload.ok) {
      toast(payload.message, true);
      renderAll();
      return;
    }
    // 回执回来时玩家可能已经刷新过商店了，所以确认"那一格还是原来那张牌"
    const slot = slotIndex === null ? undefined : state.economy.shop[slotIndex];
    if (!slot || slot.defId !== payload.defId) {
      // 商店变了：这次购买作废，把牌还给服务器，别让牌库白白少一张
      net.sellCard(payload.defId, 1);
      toast('商店已经刷新，这次购买取消了', true);
      renderAll();
      return;
    }

    const result = applyApprovedBuy(state, slotIndex!);
    if (!result.ok) {
      // 本地失败（比如金币不够、备战席满了）：把牌还给服务器
      net.sellCard(payload.defId, 1);
      toast(result.message, true);
      renderAll();
      return;
    }
    toast(result.message);
    renderAll();
  },

  /**
   * ★ 0.1.1：我的"藏品随机招募"有结果了（人事部铜印 / 博士银印）。
   *
   * 【为什么落地要在这一处做？】
   * 招募到的干员是真的占牌库的，联机时由服务器扣牌 —— 但"进备战席 + 合成 +
   * 拼文案"这套动作只有一个实现（`applyRecruitResult`），
   * 单机本地抽完也是调它，两条路不会走散。
   */
  onRecruitResult: (payload) => {
    const message = applyRecruitResult(state, payload.defId, payload.gold);
    toast(message);
    renderAll();
  },
});

/** 更新主界面底部的状态文字 */
function setNetStatus(text: string, kind: 'online' | 'error' | '' = ''): void {
  el.menuStatus.textContent = text;
  el.menuStatus.className = `menu-status${kind ? ` ${kind}` : ''}`;
}

function renderNetPanel(): void {
  const room = net.room;
  if (!room) {
    el.btnLobbyReady.disabled = true;
    el.btnLobbyStart.disabled = true;
    // ★ 0.3：房间没了（被踢 / 自己退出）就别把设置面板留在屏幕上
    el.btnRoomSettings.classList.add('hidden');
    closeSettingsPanel();
    return;
  }

  const me = room.players.find((p) => p.id === net.playerId);
  const isHost = room.hostId === net.playerId;

  /*
    ★ 0.3：房间设置的入口**只给房主**（"只给房主开放权限"）。
    ★ 这里只是"不给别人看到" —— 真正的权限判在服务端，抓包照样能被拒。
    开局之后（phase 不再是 lobby）面板要立刻收掉：规则已经锁了，留着它只会让人以为还能改。
  */
  el.btnRoomSettings.classList.toggle('hidden', !isHost);
  if (room.phase !== 'lobby') closeSettingsPanel();

  // 「开始游戏」只有房主能点，而且至少要两个人
  el.btnLobbyStart.classList.toggle('hidden', !isHost);
  el.btnLobbyStart.disabled = room.players.length < 2;

  /*
    房主自己的准备状态没意义（他点开始就行），所以房主不显示这个按钮。

    ★ 0.0.2：准备按钮改成**可以点第二次取消准备**。
    以前是"点了准备就锁死"（按钮 disabled），于是想改一下阵容、
    或者临时不想开了，就只能退出房间再进来 —— 很不合理。
    现在文案也跟着变（准备好了 / 取消准备），点了就切换状态。
    服务器那边 setReady 本来就是收 true/false 的，不用改协议。
  */
  el.btnLobbyReady.classList.toggle('hidden', isHost);
  el.btnLobbyReady.disabled = false;
  el.btnLobbyReady.textContent = me?.ready ? '取消准备' : '准备好了';
  el.btnLobbyReady.classList.toggle('active-ready', me?.ready ?? false);
}

/**
 * 把一段文字放进剪贴板（★ 0.1.3：点房间号复制用）。
 *
 * 【为什么要手写降级？】
 * `navigator.clipboard` 只在**安全上下文**（https / localhost）里才有；
 * 而联机最常见的场景恰恰是局域网 `http://192.168.x.x:5173` —— 那里它是 undefined。
 * 所以还得留一条老路：建一个临时 textarea、选中、`document.execCommand('copy')`。
 * 两条都失败就返回 false —— 让调用方说句实话（"手动选中复制"），别假装成功。
 */
async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 权限被拒 / 非安全上下文：落到下面的老路
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    // 别让它出现在屏幕上，也别把页面顶得抖一下
    area.style.position = 'fixed';
    area.style.top = '0';
    area.style.opacity = '0';
    area.style.pointerEvents = 'none';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/* ============================================================
   ★★ 0.3 房间设置面板（房主专用）
   ============================================================
   【这一块只负责"画"和"发"。】
   真正的裁决全在服务端（是不是房主、是不是 lobby、数值夹取），
   客户端这里**不做任何校验** —— 输入框上的 min/max 只是提醒，
   不是防线（随便构造一条消息就能跳过）。

   ★ 面板内容按 `ROOM_SETTINGS_LIMITS` 现生成，不在 HTML 里写死范围：
     范围改了只改 shared 一处，界面自动跟上。
   ============================================================ */

/**
 * 数值型设置的字段表。
 * ★ 顺序 = 界面上的顺序；单位/说明只写这一次，别在 HTML 里再抄一遍。
 */
const SETTINGS_NUMBER_FIELDS: Array<{
  key: 'startHp' | 'startGold' | 'incomeBase' | 'prepSeconds';
  label: string;
  suffix: string;
  hint: string;
}> = [
  { key: 'startHp', label: '开局血量', suffix: '点', hint: '每个人开局那一刻的血量' },
  { key: 'startGold', label: '开局金币', suffix: '金', hint: '第一回合手上能花的钱' },
  { key: 'incomeBase', label: '每回合收入', suffix: '金', hint: '每回合结算时白给的基础金币（不含利息）' },
  { key: 'prepSeconds', label: '布阵时间', suffix: '秒', hint: '第 1~3 回合固定 30 秒，这里只管第 4 回合起' },
];

/** 面板开着的时候，房间一有更新就重画（值可能被服务端夹过） */
let settingsPanelOpen = false;

/**
 * ★ 0.3：读房间设置，缺了就用默认值。
 *
 * 【为什么要兜？】`RoomView.settings` 是 0.3 才加的字段。
 * 老服务端 / 测试里的假房间都没有它 —— 直接 `room.settings.startHp` 会当场抛
 * "Cannot read properties of undefined"。版本不一致本来有 `ensureSameVersion` 拦，
 * 但界面不该因为一个可选字段缺了就整个炸掉。
 */
function roomSettingsOf(room: { settings?: RoomSettings } | null | undefined): RoomSettings {
  return room?.settings ?? DEFAULT_ROOM_SETTINGS;
}

function openSettingsPanel(): void {
  if (!net.room) return;
  settingsPanelOpen = true;
  el.settingsError.textContent = '';
  el.settingsError.classList.remove('bad');
  renderSettingsPanel();
  el.settingsOverlay.classList.remove('hidden');
}

function closeSettingsPanel(): void {
  settingsPanelOpen = false;
  el.settingsOverlay.classList.add('hidden');
}

/** 一行数值设置 */
function settingsNumberRow(
  field: (typeof SETTINGS_NUMBER_FIELDS)[number],
  value: number,
): HTMLElement {
  const limit = ROOM_SETTINGS_LIMITS[field.key];
  const row = document.createElement('div');
  row.className = 'settings-row';

  const label = document.createElement('div');
  label.className = 'settings-row-label';
  label.textContent = field.label;

  const hint = document.createElement('div');
  hint.className = 'settings-row-hint';
  hint.textContent = `${field.hint}（${limit.min} ~ ${limit.max}）`;

  const wrap = document.createElement('div');
  wrap.className = 'settings-input-wrap';
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'net-input';
  input.min = String(limit.min);
  input.max = String(limit.max);
  input.step = '1';
  input.value = String(value);
  /*
    ★ 用 change（失焦/回车）而不是 input（每敲一个字符）：
      敲 "500" 的过程中会连着发 5、50、500 三条 —— 前两条会把服务端夹成
      一个中间值，别人屏幕上就会看到数字乱跳。
  */
  input.addEventListener('change', () => {
    const next = Math.round(Number(input.value));
    if (!Number.isFinite(next)) {
      input.value = String(value);
      return;
    }
    net.updateSettings({ [field.key]: next } as Partial<RoomSettings>);
    showSettingsNote(`${field.label}：等服务器确认…，超出范围会被自动夹回来`, false);
  });

  const suffix = document.createElement('span');
  suffix.className = 'settings-row-suffix';
  suffix.textContent = field.suffix;

  wrap.append(input, suffix);
  row.append(label, hint, wrap);
  return row;
}

/** 一行开关设置 */
function settingsToggleRow(
  key: 'shopRound' | 'covenants',
  label: string,
  hint: string,
  value: boolean,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'settings-row';

  const labelEl = document.createElement('div');
  labelEl.className = 'settings-row-label';
  labelEl.textContent = label;

  const hintEl = document.createElement('div');
  hintEl.className = 'settings-row-hint';
  hintEl.textContent = hint;

  const wrap = document.createElement('div');
  wrap.className = 'settings-input-wrap';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = value;
  input.addEventListener('change', () => {
    net.updateSettings({ [key]: input.checked } as Partial<RoomSettings>);
  });

  wrap.append(input);
  row.append(labelEl, hintEl, wrap);
  return row;
}

function showSettingsNote(text: string, bad: boolean): void {
  el.settingsError.textContent = text;
  el.settingsError.classList.toggle('bad', bad);
}

function renderSettingsPanel(): void {
  const room = net.room;
  if (!settingsPanelOpen || !room) return;
  /*
    ★ 正在输入时**不许重建 DOM**：房间广播可能因为"别人进了房间"随时到来，
      重建会把正在填的那个输入框整个换掉（光标丢、输入内容回滚）。
  */
  if (el.settingsBody.contains(document.activeElement)) return;

  const settings = roomSettingsOf(room);
  el.settingsBody.innerHTML = '';
  for (const field of SETTINGS_NUMBER_FIELDS) {
    el.settingsBody.append(settingsNumberRow(field, settings[field.key]));
  }
  el.settingsBody.append(
    settingsToggleRow(
      'shopRound',
      '商店回合',
      '野怪回合之后那 90 秒的限时商店（关掉不影响常驻的 5 格买牌商店）',
      settings.shopRound,
    ),
    settingsToggleRow(
      'covenants',
      '盟约',
      '开局前的盟约选秀（关掉就点开始直接进第一回合）',
      settings.covenants,
    ),
  );

  const summary = roomSettingsSummary(settings);
  showSettingsNote(
    summary.length === 0
      ? '当前全部是默认规则（和原本的玩法一模一样）'
      : `本局自定义：${summary.join(' · ')}`,
    false,
  );
}

/** 大厅里那行"本局自定义规则"（所有人可见；全是默认值时隐藏） */
function renderLobbyRules(settings: RoomSettings): void {
  const summary = roomSettingsSummary(settings);
  /*
    ★★ 0.3.3：重排之后规则有了**自己的那一栏**（右上），再"全是默认就整行隐藏"
    会留下一个空栏 —— 看起来像没加载出来。
    所以默认时也写一行"全部默认"，只是用 `.is-default` 压成灰；
    改过规则时才是金币色（那是玩家真的需要看到的例外信息）。
  */
  const isDefault = summary.length === 0 || isDefaultRoomSettings(settings);
  el.lobbyRules.classList.remove('hidden');
  el.lobbyRules.classList.toggle('is-default', isDefault);
  el.lobbyRules.textContent = isDefault ? '全部默认（没改过任何规则）' : `本局自定义规则：${summary.join(' · ')}`;
}

/**
 * ★ 0.3：昵称被服务端拒绝时弹这个（建房 / 进房 / 改名三条路都走它）。
 *
 * 【为什么要弹窗而不是 toast？】
 * 建房和进房时玩家的注意力在名字输入框上，一条会自动消失的小字很容易错过；
 * 而且在菜单里 toast 会被背景吞掉。弹窗还能顺带把"规则是什么"讲清楚。
 */
function showNameAlert(message: string): void {
  el.nameAlertMsg.textContent = message;
  el.nameAlertHint.textContent =
    `规则：${NAME_MIN_LENGTH}~${NAME_MAX_LENGTH} 个字，可以用汉字、字母、数字和常用符号（_ - · # @ ! ? + = ~）`;
  el.nameAlert.classList.remove('hidden');
  el.nameAlertOk.focus();
}

function closeNameAlert(): void {
  el.nameAlert.classList.add('hidden');
}

el.nameAlertOk.addEventListener('click', () => {
  closeNameAlert();
  // 关掉之后把焦点还给刚才那个名字输入框，玩家接着改
  if (lastFocusedNameInput) {
    lastFocusedNameInput.focus();
    lastFocusedNameInput.select();
  }
});
el.nameAlert.addEventListener('click', (event) => {
  if (event.target === el.nameAlert) closeNameAlert();
});

/* ============================================================
   ★★ 0.3 盟约选秀页
   ============================================================
   用户口径逐条对照：
     · 上：玩家头像 + 名字（谁选了什么都在这条上）
     · 下：盟约卡**只显示头像和名字**；点一下在右边出详细说明
     · 右下角「选择盟约」：**只有轮到自己时才亮**，别人选走的不再可选（卡片变暗）
     · 全员选完才真正开局（这一步在服务端，见 finishCovenantPhase）

   ★ 顺序不显示：服务端只广播 currentPlayerId，前端因此**算不出**完整序列。
   ============================================================ */

/** 我当前点开的那张卡（还没提交） */
/*
  ============================================================
  ★★ 0.3：盟约选秀的倒计时 —— **服务端给基准 + 本地按墙钟推算**
  ============================================================
  【用户报的问题】多人模式选盟约时，倒计时数字不动。

  【根因是什么？】
  以前秒数**只**来自房间广播（`room.covenant.secondsLeft`）。
  房间广播是"整份状态"，客户端各处还会拿它做结构签名 / 显隐判断 ——
  只要有一次被节流、被去重、或者中间抛了个异常，数字就停在原地。
  这类"倒计时不走"在这个项目里已经出现过**三次**（布阵 / 暂停 / 商店回合），
  共同点全是"秒数搭在别的通道上"。

  【现在怎么保证它一定动？】
    ① 服务端每秒额外发一条 **纯倒计时** `covenantTick`（不夹带任何状态）；
    ② 本地记下"服务端说还剩 N 秒 @ 本地时刻"，然后**每帧**用墙钟换算显示值。
  这样即使某一条 tick 丢了，数字也会继续按真实时间往下走（下一次 tick 再校正回来）。
  ★ 不要反过来"本地自己减 1" —— 那会和服务端彻底走散（网络抖动一次就永久差几秒）。
*/
let covenantBaseline: { seconds: number; at: number } | null = null;

/** 记一次服务端基准（tick 和房间广播都走这里 —— 只有一个入口） */
function setCovenantBaseline(seconds: number): void {
  covenantBaseline = { seconds: Math.max(0, seconds), at: performance.now() };
}

/** 现在该显示几秒（没有基准 = null，界面就不该显示数字） */
function covenantSecondsLeftNow(): number | null {
  if (!covenantBaseline) return null;
  const elapsed = (performance.now() - covenantBaseline.at) / 1000;
  return Math.max(0, Math.ceil(covenantBaseline.seconds - elapsed));
}

/** 把数字写到界面上（每帧调；没变化就不碰 DOM） */
let covenantSecondsShown = '';
function syncCovenantTimer(): void {
  const overlayOpen = !el.covenantOverlay.classList.contains('hidden');
  /*
    ★ 只有**联机选秀**才有倒计时。单机那份是没有时限的（它自己把数字写成 "—"），
    所以判据是"服务器说现在在 selected 阶段"，而不是"浮层开着"。
  */
  if (!overlayOpen || net.room?.phase !== 'covenant') {
    covenantSecondsShown = '';
    return;
  }
  const seconds = covenantSecondsLeftNow();
  if (seconds === null) return;
  const text = String(seconds);
  if (text === covenantSecondsShown) return;
  covenantSecondsShown = text;
  el.covenantTimer.textContent = text;
  el.covenantClock.classList.toggle('urgent', seconds <= 5);
}

/**
 * ★★ 0.3：把"我在这个房间里选的盟约"同步到本地状态。
 *
 * 【为什么必须每回合都对一次？】
 * 「命结之秘」的复活是**战斗内核**里判的，而内核要知道这份信息只能靠
 * `TeamSetup.covenantId`（服务端填 `player.covenantId`，客户端填 `state.covenantId`）。
 * 客户端这一份如果丢了（刷新页面重连之后 `state` 是全新的），
 * 两边算出来的战斗就会不同 ⇒ **校验和不一致** ⇒ 打完卡死等回执。
 * 所以它不是"开局设一次就完事"的东西，而是一个**每回合都要对齐**的派生值。
 */
function syncMyCovenantFromRoom(): void {
  if (!net.room) return;
  const mine = net.room.players.find((player) => player.id === net.playerId);
  if (!mine) return;
  if (mine.covenantId) state.covenantId = mine.covenantId;
  /*
    ★ 0.3.2：盟约「不容拒绝」开局送一只 1 星阿米娅。
    ★ 为什么放在这里（每回合都跑的地方）而不是"开局那一下"？
      因为这里**幂等**（`applyCovenantOpening` 自己判重 + 看手上有没有她），
      一次管辖三种情况：正常开局、中途选盟约、刷新页面重连。
      放在开局那一处的话，重连那条路就会漏。
  */
  applyCovenantOpening(state);
}

let covenantPending: string | null = null;
/**
 * 上一次画卡片用的"结构签名"。
 * 服务端每秒重播一次房间状态（为了倒计时），如果每次都重建 DOM，
 * 玩家正在看的那张卡的 hover/点击会被打断 —— 所以只有结构变了才重画。
 */
let covenantSignature = '';

/**
 * ★★ 0.3：**单机模式的盟约选秀**。
 *
 * 【为什么单机也要有？】
 * 用户口径："在单机模式中也添加盟约效果，方便测试"。
 * 联机那套选秀是服务端权威的（`room.phase === 'covenant'`），
 * 一个人想试试"拿了壁垒之后双抗到底加多少"根本没法自己开一局 ——
 * 所以这里给单机做一份**本地版**：同一套界面、同一份 `COVENANTS` 数据、
 * 同一套折算函数，只是不需要服务器。
 *
 * ★ 只影响"这一局"：`startSinglePlayer` 重建 state 时就带着它。
 */
let localCovenant = { open: false, testMode: false };

/**
 * ★ 0.3：单机这一局**赢了几场**（盟约「重生疗法」每赢 N 场回血要用）。
 *
 * 【为什么单机要自己数？】
 * 联机的胜场在服务端（`RoomPlayer.wins`），单机没有那个账本 ——
 * 而经济状态里只存了连胜 streak（会被一次失败清零），不能当"总胜场"用。
 * 每开一局清 0。
 */
let singlePlayerCovenantWins = 0;

/**
 * ★ 0.3：把选中的盟约折进**这一局单机**。
 *
 * 【和联机的口径对齐】
 *   · 开局金币 / 每回合收入 —— 联机在 `createGameState` 时传 `startGold/incomeBase`；
 *     这里改成"造完再加"，因为选秀发生在开局之后。**加成公式是同一份** `covenantEconomy`。
 *   · 开局血量 —— 同 `Room.applyCovenantStartHp`（`hp += bonus`）。
 *   · 利息上限 / 回合发钱 —— 不用在这儿做：`advanceRound` 每次都读 `state.covenantId`。
 *   · 战斗类加成 —— `toTeamSetup` 读 `state.covenantId`，也不用这儿做。
 */
function applyLocalCovenant(id: string): void {
  const money = covenantEconomy(id);
  const hpBonus = covenantStartHpBonus(id);
  /*
    ★ 沙盒两边都挂同一个盟约 —— 沙盒是用来对比棋子的，
    只给一边加会变成"同一个阵容两边打出来不一样"，看不出是想测什么。
  */
  const sides = testSides ?? [state];
  for (const side of sides) {
    side.covenantId = id;
    if (money.startGold) side.economy.gold += money.startGold;
    if (money.income) side.rules.incomeBase += money.income;
    if (hpBonus) side.economy.hp += hpBonus;
    /*
      ★ 0.3.2：盟约「不容拒绝」开局送一只 1 星阿米娅。
      沙盒两边都会拿到（`sides` 遍历），和上面那些经济加成同一个口径。
    */
    applyCovenantOpening(side);
  }
  localCovenant = { open: false, testMode: false };
  covenantPending = null;
  covenantSignature = '';
  el.covenantOverlay.classList.add('hidden');
  renderAll();
  const covenant = covenantOf(id);
  toast(`本局盟约：${covenant?.name ?? id}（${covenant?.brief ?? ''}）`);
}

function syncCovenantPage(room: RoomView | null | undefined): void {
  const drafting = Boolean(room && room.phase === 'covenant');
  const show = drafting || localCovenant.open;
  el.covenantOverlay.classList.toggle('hidden', !show);
  if (!show) {
    covenantPending = null;
    covenantSignature = '';
    return;
  }
  // 单机选秀优先（这时候一般没有房间）
  if (localCovenant.open && !drafting) {
    renderLocalCovenantPage();
    return;
  }
  /*
    ★★ 0.3.2：房间广播也**校正一次倒计时基准**。
    以前只有 `covenantTick` 会写基准 —— 万一那几条 tick 被节流/丢掉（或者标签页刚从后台回来），
    本地那一份就会一路数到 0 然后停在那儿，看起来就是"倒计时卡住了"。
    房间广播每秒都带 `covenant.secondsLeft`，拿它补一次最稳（和 tick 走同一个入口）。
  */
  const seconds = room?.covenant?.secondsLeft;
  if (drafting && typeof seconds === 'number') setCovenantBaseline(seconds);
  renderCovenantPage(room!);
}

/**
 * 单机版选秀页：玩家条只有"你"，没有倒计时（不催），其余和联机一模一样。
 */
function renderLocalCovenantPage(): void {
  const seconds = 0;
  el.covenantTimer.textContent = '—';
  el.covenantClock.classList.toggle('urgent', seconds <= 5);

  const signature = JSON.stringify({ local: true, pending: covenantPending });
  if (signature !== covenantSignature) {
    covenantSignature = signature;

    // ---- 上：只有自己 ----
    const row = document.createElement('div');
    row.className = 'covenant-player turn';
    const avatar = document.createElement('div');
    avatar.className = 'covenant-avatar';
    avatar.textContent = '你';
    const info = document.createElement('div');
    info.className = 'covenant-player-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'covenant-player-name';
    nameEl.textContent = '单机 · 你自己';
    const pickEl = document.createElement('div');
    pickEl.className = 'covenant-player-pick';
    const picked = covenantOf(covenantPending);
    pickEl.textContent = picked ? `已选：${picked.name}` : '选择中…';
    info.append(nameEl, pickEl);
    row.append(avatar, info);
    el.covenantPlayers.replaceChildren(row);

    // ---- 中：全部盟约卡（和联机同一份数据/同一种卡，数量跟着 COVENANTS 走）----
    renderCovenantGrid(new Set(), (id) => {
      covenantPending = id;
      renderLocalCovenantPage();
    });

    // ---- 右：详情 ----
    renderCovenantDetail(new Set(), true, false);
  }

  // ---- 下：提示 + 按钮（这几行每次都要写：pending 变了文案就得变）----
  el.covenantPick.disabled = !covenantPending;
  el.covenantPick.textContent = '选择盟约';
  // ★ 单机才给「跳过」—— 联机是轮流的，不能不选
  el.covenantSkip.classList.remove('hidden');
  el.covenantHint.textContent = covenantPending
    ? '确认无误就按右下角「选择盟约」—— 单机里可以随时重开一局换一个。'
    : '轮到你了：点一张卡看详细效果（也可以跳过，不带盟约开局）。';
}

/**
 * 画盟约卡（联机和单机**共用这一份**）。
 * ★ 卡面只有头像；名字在 `.active`（点开）时才显示 —— 用户口径。
 * ★ 数量完全由 `COVENANTS` 决定，加新盟约不用改这里。
 */
function renderCovenantGrid(taken: Set<string>, onPick: (id: string) => void): void {
  el.covenantGrid.innerHTML = '';
  for (const covenant of COVENANTS) {
    const isTaken = taken.has(covenant.id);
    const card = document.createElement('div');
    card.className =
      `covenant-card${isTaken ? ' taken' : ''}${covenantPending === covenant.id ? ' active' : ''}`;
    card.innerHTML = `
      <div class="covenant-avatar-img" style="background-image:url('${covenantAvatarPath(covenant.id)}')"></div>
      <div class="covenant-card-name">${escapeHtml(covenant.name)}</div>
      ${covenant.pending ? '<div class="covenant-card-pending">开发中</div>' : ''}
    `;
    card.title = isTaken ? `${covenant.name} —— 已被选走` : `${covenant.name} · ${covenant.brief}`;
    /*
      ★ 被选走的卡**仍然可以点开看详情**（新人想知道对手拿了什么），
        只是不能选 —— 按钮那边会拦。
    */
    card.addEventListener('click', () => onPick(covenant.id));
    el.covenantGrid.appendChild(card);
  }
}

function renderCovenantPage(room: RoomView): void {
  const currentId = room.covenant?.currentPlayerId ?? '';
  const me = room.players.find((player) => player.id === net.playerId);
  const myTurn = currentId === net.playerId && !me?.covenantId;
  const taken = new Set(room.players.map((player) => player.covenantId).filter(Boolean) as string[]);

  /*
    ---- 倒计时 ----
    ★★ 0.3：**必须每进一次就记一次基准**（`setCovenantBaseline`），
    真正往界面上写数字的是每帧跑的 `syncCovenantTimer`。
    以前是"在这里直接写 textContent"—— 于是它变成了**唯一**的写入点，
    只要房间广播慢一拍/被吞，数字就停住（用户报的就是这个）。
  */
  setCovenantBaseline(room.covenant?.secondsLeft ?? 0);

  const signature = JSON.stringify({
    currentId,
    players: room.players.map((player) => [player.id, player.name, player.avatarId, player.covenantId ?? '']),
    pending: covenantPending,
    myTurn,
  });
  if (signature === covenantSignature) return;
  covenantSignature = signature;

  // ---- 上：玩家条 ----
  el.covenantPlayers.innerHTML = '';
  for (const player of room.players) {
    const row = document.createElement('div');
    row.className = `covenant-player${player.id === currentId ? ' turn' : ''}`;

    const avatar = document.createElement('div');
    avatar.className = 'covenant-avatar';
    if (player.avatarId) {
      avatar.style.backgroundImage = `url('${unitPortraitUrl(player.avatarId)}')`;
    } else {
      avatar.textContent = player.name.slice(0, 1);
    }

    const info = document.createElement('div');
    info.className = 'covenant-player-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'covenant-player-name';
    nameEl.textContent = player.name + (player.id === net.playerId ? '（你）' : '');
    const pickEl = document.createElement('div');
    pickEl.className = 'covenant-player-pick';
    const picked = covenantOf(player.covenantId);
    if (picked) {
      pickEl.textContent = `已选：${picked.name}`;
    } else if (player.id === currentId) {
      pickEl.textContent = '选择中…';
    } else {
      pickEl.textContent = '等待中';
      pickEl.classList.add('empty');
    }
    info.append(nameEl, pickEl);
    row.append(avatar, info);
    el.covenantPlayers.appendChild(row);
  }

  // ---- 中：盟约卡（卡面只有头像，点开才显示名字）----
  renderCovenantGrid(taken, (id) => {
    covenantPending = id;
    renderCovenantPage({ ...room, covenant: room.covenant });
  });

  // ---- 右：详情 ----
  renderCovenantDetail(taken, myTurn, Boolean(me?.covenantId));

  // ---- 下：提示 + 按钮 ----
  const canPick = myTurn && Boolean(covenantPending) && !taken.has(covenantPending!);
  el.covenantPick.disabled = !canPick;
  // 联机没有「跳过」（轮到你选就必须选，超时会自动随机）
  el.covenantSkip.classList.add('hidden');
  // 文案要复位：提交过一次之后按钮上写的是"已提交…"，下一位轮到时得变回来
  el.covenantPick.textContent = '选择盟约';

  if (me?.covenantId) {
    const mine = covenantOf(me.covenantId);
    el.covenantHint.textContent = `你已选择「${mine?.name ?? me.covenantId}」，等待其他玩家…`;
  } else if (myTurn) {
    el.covenantHint.textContent = covenantPending
      ? '确认无误就按右下角「选择盟约」—— 选了不能改。'
      : '轮到你了：点一张卡看详细效果。';
  } else {
    const who = room.players.find((player) => player.id === currentId)?.name ?? '其他玩家';
    el.covenantHint.textContent = `等待「${who}」选择…（超时会自动随机选一个）`;
  }
}

/** 右侧详情：没点过就显示占位；点了就显示效果全文 */
function renderCovenantDetail(taken: Set<string>, myTurn: boolean, iHavePicked: boolean): void {
  const covenant = covenantOf(covenantPending);
  el.covenantDetail.innerHTML = '';
  if (!covenant) {
    const empty = document.createElement('div');
    empty.className = 'covenant-detail-empty';
    empty.textContent = '点一张盟约卡看详细效果';
    el.covenantDetail.appendChild(empty);
    return;
  }
  const nameEl = document.createElement('div');
  nameEl.className = 'covenant-detail-name';
  /*
    ★★ 0.3.2 修（用户报"详情右边的盟约头像只显示一小块"）：
    以前这里内联写死 26×26，而 `background-size` 的规则只挂在 `.covenant-card` 下 ——
    于是详情里那个 span 按图**原始尺寸**（75×75）铺开、被 26px 的框裁掉了，
    看起来就是"只露出一小块"。现在尺寸和 `center/cover` 都交给 CSS 的
    `.covenant-detail-name .covenant-avatar-img`，内联只留图片地址。
  */
  nameEl.innerHTML = `<span class="covenant-avatar-img"></span>${escapeHtml(covenant.name)}`;
  (nameEl.querySelector('.covenant-avatar-img') as HTMLElement).style.backgroundImage =
    `url('${covenantAvatarPath(covenant.id)}')`;

  const briefEl = document.createElement('div');
  briefEl.className = 'covenant-detail-brief';
  briefEl.textContent = covenant.brief;

  el.covenantDetail.append(nameEl, briefEl);
  /*
    ★ 0.3.1：`pending` 的盟约（目前只有阿米娅「不容拒绝」）必须在详情里
    明写"开发中" —— 否则玩家选了一个没有任何效果的盟约，只会以为是 bug。
  */
  if (covenant.pending) {
    const pending = document.createElement('div');
    pending.className = 'covenant-detail-pending';
    pending.textContent = '开发中：这个盟约的玩法还没做完，选了暂时没有实际效果。';
    el.covenantDetail.appendChild(pending);
  }
  for (const line of covenant.detail) {
    const p = document.createElement('p');
    p.textContent = line;
    el.covenantDetail.appendChild(p);
  }
  if (taken.has(covenant.id)) {
    const note = document.createElement('div');
    note.className = 'covenant-detail-taken';
    note.textContent = '已被其他玩家选走，不能再选。';
    el.covenantDetail.appendChild(note);
  } else if (!myTurn && !iHavePicked) {
    const note = document.createElement('div');
    note.className = 'covenant-detail-taken';
    note.style.color = 'var(--faint)';
    note.textContent = '还没轮到你 —— 可以先想好要拿哪个。';
    el.covenantDetail.appendChild(note);
  }
}

/**
 * ★★ 0.3：对局内点玩家列表里的盟约 -> 看它到底给了什么。
 */
function showCovenantInfo(covenantId: string | undefined): void {
  const covenant = covenantOf(covenantId);
  if (!covenant) return;
  el.covenantInfoName.textContent = covenant.name;
  el.covenantInfoBrief.textContent = covenant.brief;
  el.covenantInfoBody.textContent = covenant.detail.join('\n');
  el.covenantInfo.classList.remove('hidden');
}

el.covenantInfoOk.addEventListener('click', () => el.covenantInfo.classList.add('hidden'));
el.covenantInfo.addEventListener('click', (event) => {
  if (event.target === el.covenantInfo) el.covenantInfo.classList.add('hidden');
});

el.covenantPick.addEventListener('click', () => {
  if (!covenantPending) return;
  /*
    ★★ 0.3：单机选秀走本地这条路（没有服务器可问）。
    选完就直接开局 —— `startSinglePlayer` 会把经济/开局血量按盟约折算。
  */
  if (localCovenant.open) {
    applyLocalCovenant(covenantPending);
    return;
  }
  net.pickCovenant(covenantPending);
  /*
    ★ 点完立刻禁用，等服务端回执 —— 不然手快能连点两下，
      第二条一定被拒（"还没轮到你"），观感像出 bug。
  */
  el.covenantPick.disabled = true;
  el.covenantPick.textContent = '已提交…';
});

/** ★ 0.3 单机：不选盟约直接开局（只在本地选秀里出现） */
el.covenantSkip.addEventListener('click', () => {
  if (!localCovenant.open) return;
  localCovenant = { open: false, testMode: false };
  covenantPending = null;
  covenantSignature = '';
  el.covenantOverlay.classList.add('hidden');
  renderAll();
});

el.btnRoomSettings.addEventListener('click', openSettingsPanel);
el.btnSettingsClose.addEventListener('click', closeSettingsPanel);
el.btnSettingsDefault.addEventListener('click', () => {
  net.updateSettings({ ...DEFAULT_ROOM_SETTINGS });
  showSettingsNote('已请求恢复默认…', false);
});
el.settingsOverlay.addEventListener('click', (event) => {
  if (event.target === el.settingsOverlay) closeSettingsPanel();
});

/**
 * ★★ 0.3.3：大厅玩家列表改成**按 key 就地更新**（`renderKeyed`）。
 *
 * 【为什么这次重排顺手改了它？】
 * 大厅过去是 `innerHTML = ''` 再一条条 append，而它会被 `renderAll()` 反复调用 ——
 * 联机时房间每秒广播一次，于是这个列表**每秒重建一遍**。三个后果都真实存在：
 *   · 房主正在给人机改难度时，下拉框被换掉 -> 展开的选项直接消失；
 *   · 刚进房间的人头像闪一下白（每行 `<img>` 都是新节点）；
 *   · `.net-player:hover` 的底色过渡每秒重放一次，看起来在抽搐。
 * `renderKeyed` 用签名判重：内容没变就把旧节点原样留着，一个属性都不碰。
 *
 * ★ 命名空间用房间号：换一个房间就把缓存整体丢掉（玩家 id 在新房间里没有意义）。
 */
function renderLobbyPlayers(room: RoomView): void {
  const iAmHost = room.hostId === net.playerId;
  renderKeyed(el.lobbyPlayers, room.players, {
    ns: room.code,
    key: (player) => player.id,
    /*
      签名 = **所有会影响这一行长相的输入**：
      名字 / 头像 / 准备状态 / 在线 / 是不是人机 / 人机难度 / 我能不能管这一行。
      ★ 最后一项把"房主换人了"也算进来了 —— 否则新房东看不到改名/踢出按钮。
    */
    sig: (player) =>
      [
        player.name,
        player.avatarId ?? '',
        player.ready ? 1 : 0,
        player.connected ? 1 : 0,
        player.isBot ? 1 : 0,
        player.botDifficulty ?? '',
        iAmHost && player.id !== net.playerId ? 1 : 0,
      ].join('|'),
    build: (player) => buildLobbyPlayerRow(player, room, iAmHost),
  });
}

/** 造大厅里的一行（只在这里拼 HTML，避免"两套渲染逻辑走散"） */
function buildLobbyPlayerRow(player: RoomView['players'][number], room: RoomView, iAmHostRow: boolean): HTMLElement {
  const isMe = player.id === net.playerId;
  const isHost = player.id === room.hostId;
  const row = document.createElement('div');
  row.className = `net-player${isMe ? ' me' : ''}${player.connected ? '' : ' offline'}`;
  // 头像：玩家在主界面选的那个干员头像（没选就只有一个占位方块）
  const avatar = avatarPathOf(player.avatarId);
  /*
    ★ 0.1.1：房主的两个"管人"按钮。
    【位置是用户指定的】「改名」在前、「踢出」在后，两个都排在
    「未准备 / 已准备」状态标识**前面**（一行读下来就是：谁 · 改名 · 踢出 · 状态）。
    【只有房主看得到】普通玩家（以及房主自己那一行）都不渲染这两个按钮 ——
    服务端还会再验一次房主身份，这里只是不给普通人添乱。
  */
  const canManage = iAmHostRow && !isMe;
  const isBot = player.isBot === true;
  const difficulty = player.botDifficulty ?? 'normal';
  row.innerHTML = `
    <span class="net-player-avatar${avatar ? ' has-image' : ''}">${
      avatar ? `<img src="${avatar}" alt="" loading="lazy" />` : ''
    }</span>
    <span class="net-player-name">${escapeHtml(player.name)}${isMe ? '（你）' : ''}</span>
    ${isHost ? '<span class="net-badge host">房主</span>' : ''}
    ${isBot ? `<span class="net-badge bot">人机 · ${botDifficultyLabel(difficulty)}</span>` : ''}
    ${
      canManage && !isBot
        ? '<button class="net-player-btn rename-btn" data-action="rename">改名</button>' +
          '<button class="net-player-btn kick-btn" data-action="kick">踢出</button>'
        : ''
    }
    ${
      /*
        ★★ 0.3.3：人机那两个控件（改难度 / 移除）。
        ★ 难度用 <select> 而不是"点一下切下一档"：三档循环切的人根本不知道
          自己切到哪了，而下拉列表一眼能看到全部选项。
        ★ 只在**大厅**能改（服务端也拦着），所以对局里这一行不会出现。
      */
      canManage && isBot
        ? `<select class="net-player-btn bot-difficulty" data-action="bot-difficulty" title="改这台人机的难度">` +
          BOT_DIFFICULTIES.map(
            (value) =>
              `<option value="${value}"${value === difficulty ? ' selected' : ''}>${BOT_DIFFICULTY_INFO[value].label}</option>`,
          ).join('') +
          `</select>` +
          '<button class="net-player-btn kick-btn" data-action="remove-bot">移除</button>'
        : ''
    }
    ${player.ready ? '<span class="net-badge ready">已准备</span>' : '<span class="net-badge">等待中</span>'}
  `;
  if (canManage && isBot) {
    row
      .querySelector<HTMLSelectElement>('[data-action="bot-difficulty"]')
      ?.addEventListener('change', (event) => {
        const next = (event.target as HTMLSelectElement).value as BotDifficulty;
        if (!net.setBotDifficulty(player.id, next)) toast('没连上服务器，改不了难度', true);
      });
    row.querySelector<HTMLButtonElement>('[data-action="remove-bot"]')?.addEventListener('click', () => {
      /*
        ★ 走和「踢出」同一个确认弹窗（但文案不同）：它俩都是"把这个座位腾出来"，
          误点的代价也一样（人机删了，这一局就少一个人）。
      */
      askConfirm(
        '移除人机',
        `把 <b>${escapeHtml(player.name)}</b> 移出房间？<br><span style="opacity:.7">对局开始前都能再加回来。</span>`,
        '移除',
        () => {
          if (!net.removeBot(player.id)) toast('没连上服务器，删不掉', true);
        },
      );
    });
  }
  if (canManage && !isBot) {
    row.querySelector<HTMLButtonElement>('[data-action="rename"]')?.addEventListener('click', () => {
      openRenameDialog(player.id, player.name);
    });
    row.querySelector<HTMLButtonElement>('[data-action="kick"]')?.addEventListener('click', () => {
      /*
        ★ 0.1.3：不再走通用的二次确认，改成**专用弹窗** ——
        房主可以顺手写一句话，那句话会原样显示给被踢的人。
        弹窗里那个「请出房间」按钮本身就是二次确认，安全性没有下降。
      */
      openKickDialog(player.id, player.name);
    });
  }
  return row;
}

function renderLobby(): void {
  const room = net.room;
  // 大厅界面只在「在房间里、还没开局」时显示
  if (!room || room.phase !== 'lobby') return;

  // ★ 0.3.3：已经在房间里了，加入页的局域网轮询没有意义（面板还开着，但被大厅盖住了）
  stopLanPolling();
  el.lobbyCode.textContent = room.code;
  /*
    ★ 0.3.3：右上角座位计数（8 人上限来自服务端常量；这里只是把它写出来，
    少一个"为什么加不进来"的疑问）。
  */
  el.lobbyCount.textContent = `${room.players.length} / ${MAX_PLAYERS_PER_ROOM}`;
  renderLobbyPlayers(room);

  const isHost = room.hostId === net.playerId;
  const me = room.players.find((p) => p.id === net.playerId);

  /*
    ★★ 0.3.3：「添加人机」那一行只给房主看。
    ★ 满员时**不禁用按钮，只是点下去会收到服务端的一句人话**
      （"房间满了（最多 8 人，人机也占座位）"）。本地提前禁用需要把
      "8 人 / 7 台人机"两条规则在客户端再抄一遍 —— 那正是会走散的地方。
  */
  el.lobbyBotAdd.classList.toggle('hidden', !isHost);

  if (isHost) {
    /*
      ★ 0.0.3 末：房主看到的不只是房间号，还要知道"朋友该怎么操作"。
      自动发现（局域网广播）在少数组网工具下会被拦，所以顺手把手填地址也写出来
      —— 有备选方案，朋友才不会卡在"加入失败"。
    */
    // 本机可能有好几个网卡（虚拟网卡 / VPN），挑前两个都写出来，能连上一个就行
    const manual = myLanAddresses.slice(0, 2).join(' 或 ');
    const port = net.url.split(':').pop() ?? '';
    el.lobbyStatus.textContent = [
      room.players.length < 2
        ? `等朋友进来…让他在同一局域网里点「加入房间」，输入房间号 ${room.code}`
        : `共 ${room.players.length} 人。所有人准备好后就能开始。`,
      manual ? `（自动找不到时，让朋友在「设置」里手填 ${manual}:${port}）` : '',
    ]
      .filter(Boolean)
      .join('\n');
  } else if (me?.ready) {
    el.lobbyStatus.textContent = '已准备，等房主开始游戏…';
  } else {
    el.lobbyStatus.textContent = '点「准备好了」，房主才能开始。';
  }

  /*
    ★ 0.3：这一局改过规则的话，**所有人都要看到**改了什么 ——
    不然开局血量 5000、布阵 500 秒会让人以为游戏出 bug 了。
    全是默认值时整行隐藏（默认局不该多一行字）。
  */
  renderLobbyRules(roomSettingsOf(room));
  // 面板开着时跟着刷新：服务端可能刚把越界的数夹了回来
  renderSettingsPanel();

  renderNetPanel();
}

// ============================================================
// ★ 0.1.2：本机对局会话（"一台机器一个玩家" + 关浏览器能回来）
// ============================================================

/** 已经同步给进程的房间号（变了才真的发请求，不然每次房间广播都要发一次） */
let syncedRoomCode: string | null = null;

/**
 * 把"本机对局会话"和当前房间对齐。
 *
 * 进房 → 存下会话并**认领占用**、开始心跳；
 * 退房 → 清掉（`clearMachineSession` 自带"已被别人接管就不删"的保护）。
 *
 * 【为什么不在"连上服务器"时就存？】
 * 连上服务器只代表拿到了令牌，还没开始玩。那时就存下来，会让另一个标签页
 * 一打开就看到"本机正在对局中"—— 其实我们只是停在菜单上。
 */
function syncMachineSessionForRoom(): void {
  const code = net.room?.code ?? null;
  if (code === syncedRoomCode) return;
  syncedRoomCode = code;
  net.syncMachineSession(code);
  if (!code) {
    stopOwnershipHeartbeat();
    return;
  }
  startOwnershipHeartbeat(() => {
    /*
      被本机**另一个标签页**接管了 —— 退出对局并说清楚。
      不能悄悄继续跑：两个标签页共用一个座位会互相覆盖血量和阵容，
      看起来就像"随机失败"。
    */
    stopOwnershipHeartbeat();
    toast('本机另一个标签页接管了这一局', true);
    leaveNetplay();
  });
}

/** 显示「本机正在对局中」浮层（另一个标签页在玩的时候） */
function showMachineBusyOverlay(): void {
  const session = getMachineSession();
  el.machineBusyMessage.textContent = session?.roomCode
    ? `这台电脑上的另一个标签页已经在对局里了（房间 ${session.roomCode}）。一台机器只能算一个玩家。`
    : '这台电脑上的另一个标签页已经在对局里了。一台机器只能算一个玩家。';
  el.machineBusyOverlay.classList.remove('hidden');
}

function hideMachineBusyOverlay(): void {
  el.machineBusyOverlay.classList.add('hidden');
}

/**
 * 本机已经有对局在跑时的提示（弹浮层 + 一条 toast）。
 *
 * 【关于"点创建/加入房间"的那道闸，为什么写成内联的 if 而不是抽成函数？】
 * 因为它必须**在接口不可用时不执行任何 await**：测试环境、以及走隧道点房主链接
 * 的玩法走的正是那条路，那里"点一下按钮就立刻发出建房请求"是既有行为，
 * 抽成 `await guard()` 会让整个处理函数变成异步，既有测试当场红。
 */
function warnLocalMatchBusy(): void {
  showMachineBusyOverlay();
  toast('本机正在另一个标签页对局中 —— 可以「接管」，或者关掉那个标签页', true);
}

/**
 * ★ 0.1.4：主界面右下角那颗「回到对局」。
 *
 * 【它解决什么？】
 * 断线之后自动重连偶尔会失败（网络刚恢复的那一下、玩家点过「留在菜单」、
 * 或者干脆关过浏览器）。以前只能靠"再点一次加入房间、把 6 位房间号重新输一遍"
 * 才能回去 —— 而那个房间号玩家多半早忘了。
 *
 * 【什么时候出现？】
 * **本机还有一局没打完**（本地进程里存着会话令牌，或者手里还攥着一枚重连令牌）
 * 且现在不在房间里。其它时候它不占地方 —— 主界面那几个大按钮才是主角。
 *
 * 【点一下做什么？】
 * 和启动时的自动回座走同一条路（`resumeMachineMatch`：先对齐服务器地址，再连回去）。
 * 如果本机另一个标签页正在玩同一局，会先弹「接管」那个浮层问一句，不硬抢。
 */
// ============================================================
// ★★ 0.2 MujicaAve：fever 达标的「保留 / 消耗」次级页面
// ============================================================

/**
 * 这张页面什么时候出现、写了什么（幂等 —— 直接塞进 renderAll）。
 *
 * 【为什么是"幂等渲染"而不是"弹一次"？】
 * 和暂停浮层同一个理由：`state.fever.prompt` 是**状态**（不是一次性事件），
 * 断线重连/刷新页面回来它还在，幂等渲染天然就会把它再摆出来。
 * ★ 而且它是**不能被关掉**的（用户口径 2）—— 所以只有一个"显示/隐藏"逻辑，
 *   没有关闭按钮、也不响应 Esc。
 */
/**
 * 上一次画进度条用的**结构签名**。
 * 联机时房间每秒广播 -> renderAll 每秒都跑；不判的话进度条每秒重建一次。
 */
let amiyaQuestSignature = '';

/**
 * ★★ 0.3.2 日志面板里那条**常驻**的阿米娅升变任务进度。
 *
 * 【为什么常驻？】
 * 这条任务是"边打边攒"的（参战 5 场 / 胜场 3 / 伤害 15 万），玩家必须随时
 * 看得到自己还差多少 —— 弹一次就收起来的话，他会以为"打了半天白打"。
 *
 * 【谁能看到？】只有选了「不容拒绝」的玩家（`amiyaQuestOf` 挡）——
 * 别的盟约玩家看到这块只会莫名其妙。
 *
 * ★ 文案和百分比一律由 shared 的 `amiyaQuestView` 算：
 *   那是"还差多少"的规则，不能在界面里再写一遍。
 */
function renderAmiyaQuest(): void {
  const quest = amiyaQuestOf(state);
  el.amiyaQuestBlock.classList.toggle('hidden', !quest);
  if (!quest) return;
  const view = amiyaQuestView(quest, amiyaStarOf(state), state.economy.level);

  /*
    联机时房间每秒广播一次 -> `renderAll` 每秒都跑。
    所以这里判**结构签名**：内容没变就一行 DOM 都不动（否则进度条会每秒重建，
    动画和 hover 都会闪）。
  */
  const signature = view.lines.map((line) => `${line.label}:${line.percent}:${line.done}`).join('|');
  if (signature === amiyaQuestSignature) return;
  amiyaQuestSignature = signature;

  el.amiyaQuestHint.textContent = view.allDone ? '已完成' : view.title.replace('阿米娅 · 升变', '');
  el.amiyaQuest.classList.toggle('done', view.allDone);
  renderKeyed(
    el.amiyaQuest,
    view.lines.map((line, index) => ({
      key: `line${index}`,
      sig: `${line.label}|${line.percent}|${line.done}`,
      build: () => buildQuestLine(line),
    })),
    {
      key: (spec) => spec.key,
      sig: (spec) => spec.sig,
      build: (spec) => spec.build(),
      ns: 'amiya-quest',
    },
  );
}

/** 进度条的一行（名字 + 百分比 + 横条） */
function buildQuestLine(line: AmiyaQuestLine): HTMLElement {
  const row = document.createElement('div');
  row.className = `quest-line${line.done ? ' done' : ''}`;

  const head = document.createElement('div');
  head.className = 'quest-line-head';
  const label = document.createElement('span');
  label.textContent = line.label;
  const percent = document.createElement('span');
  percent.className = 'quest-line-percent';
  percent.textContent = line.done ? '完成' : `${line.percent}%`;
  head.append(label, percent);

  const bar = document.createElement('div');
  bar.className = 'quest-bar';
  const fill = document.createElement('i');
  fill.style.width = `${line.percent}%`;
  bar.appendChild(fill);

  row.append(head, bar);
  return row;
}

/** 往战斗日志里写一行"任务相关"的话（金色那块，和 fever 宝藏同一个语气） */
function appendAmiyaQuestLog(text: string): void {
  const div = document.createElement('div');
  div.className = 'log-line amiya-quest-line';
  div.textContent = `★ ${text}`;
  el.log.appendChild(div);
  el.log.scrollTop = el.log.scrollHeight;
}

/**
 * ★★ 0.3.2：把**已经达成**的任务在布阵阶段兑现成证。
 *
 * 用户口径：
 *   · 一阶段完成 → **布阵阶段弹窗二选一**（青色怒火 / 慈悲愿景）；
 *   · 二阶段完成 → 布阵阶段**直接发**炉芯终曲之证。
 *
 * 【为什么必须等到布阵阶段？】
 * 达成的那一刻玩家还在看战报（phase = result / 下一回合刚开头），
 * 这时候弹窗会把他从战报里拽出来。而且布阵阶段才是"能拖藏品"的时候。
 *
 * ★ 幂等：`stage1/2` 有 `none → awaiting → claimed` 三态，
 *   这个函数在 `renderAll` 里每帧都会跑，靠状态机保证只兑现一次。
 */
function consumeAmiyaQuestRewards(): void {
  const quest = amiyaQuestOf(state);
  if (!quest) return;
  if (state.phase !== 'prep') return;

  // 一阶段优先：它是分叉点，二阶段的证要等这边的路选完再用
  if (quest.stage1 === 'awaiting') {
    showCertChoice();
    return;
  }
  if (quest.stage2 === 'awaiting') {
    const result = grantAscendCert(state, AMIYA_CERT_IDS.core);
    if (!result.ok) return; // 理论上不会失败（专用栏位不受 A 类容量影响）
    quest.stage2 = 'claimed';
    appendAmiyaQuestLog('升变任务第二阶段完成：获得「升变之证·炉芯终曲」');
    toast('阿米娅任务完成：获得「升变之证·炉芯终曲」');
  }
}

/** 一阶段达成的二选一弹窗（不能关：这是"走哪条线"的唯一分叉点） */
function showCertChoice(): void {
  if (!el.certChoiceOverlay.classList.contains('hidden')) return;
  el.certChoiceBlueImg.src = itemIconUrl(ITEM_DEFS[AMIYA_CERT_IDS.blue]?.icon ?? '');
  el.certChoiceMercyImg.src = itemIconUrl(ITEM_DEFS[AMIYA_CERT_IDS.mercy]?.icon ?? '');
  el.certChoiceOverlay.classList.remove('hidden');
}

/** 玩家在二选一里点了某一张 */
function chooseCert(itemId: string): void {
  const quest = amiyaQuestOf(state);
  if (!quest || quest.stage1 !== 'awaiting') return;
  const result = grantAscendCert(state, itemId);
  if (!result.ok) {
    toast(result.message, true);
    return;
  }
  quest.stage1 = 'claimed';
  el.certChoiceOverlay.classList.add('hidden');
  appendAmiyaQuestLog(`升变任务第一阶段完成：获得「${ITEM_DEFS[itemId]?.name ?? itemId}」`);
  toast(`获得「${ITEM_DEFS[itemId]?.name ?? itemId}」，拖到阿米娅身上即可升变`);
  renderAll();
}

/**
 * fever 达标的「保留 / 消耗」次级页面。
 */
function renderFeverOverlay(): void {
  const prompt = state.fever.prompt;
  /*
    ★★ 0.2（用户口径）：**野怪回合的布阵阶段不许弹这张窗**。
    跨档判定可能发生在野怪回合之前那一场（第 8 回合打完 -> 第 9 回合布阵），
    这时 prompt 是挂着的 —— 野怪回合就先藏着，等下一个正常回合的布阵阶段再问。
    ★ 判据只认"当前正在布阵的这个回合是不是野怪回合"，
      别去改 `state.fever.prompt`（改了就等于把这次机会丢了）。
  */
  const monsterPrep = isMonsterRound(state.round);
  const show = prompt !== null && state.phase === 'prep' && !monsterPrep;
  el.feverOverlay.classList.toggle('hidden', !show);
  if (!show) return;
  el.feverMessage.textContent = `fever 已到达 ${prompt} 档：要不要消耗掉全部 fever？`;
  el.feverTotal.textContent = `${state.fever.total}`;
}

el.feverHold.addEventListener('click', () => {
  /*
    保留：只关掉这张页面，fever 一点不动。
    ★ 0.2：**不会**下一回合又问同一个档 —— 只有跨过更高的档才会再弹
    （掉到这一档下面再涨回来也算"跨过"，见 `nextFeverPrompt`）。
  */
  if (!holdFever(state)) return;
  renderAll();
  toast(`保留 fever（当前 ${state.fever.total}）`);
});

/*
  ★ 0.3.2 升变之证二选一：两个按钮对应两张证，选完这只弹窗就不会再出现
  （`chooseCert` 里把 `stage1` 推到 `claimed`，弹窗只认 `awaiting`）。
*/
el.certChoiceBlue.addEventListener('click', () => chooseCert(AMIYA_CERT_IDS.blue));
el.certChoiceMercy.addEventListener('click', () => chooseCert(AMIYA_CERT_IDS.mercy));

el.feverSpend.addEventListener('click', () => {
  const spent = state.fever.total;
  if (!spendFever(state)) return;
  renderAll();
  /*
    ★ 联机：消耗之后必须**把阵容重发一遍**，服务器才会知道"这一场要武装特殊技能"
    （`TeamSetup.feverSkill` 是服务端从我们上报的 fever 里推出来的）。
    `syncTeamToServer` 用整份阵容的签名去重，所以这里改了 fever 就一定会重发。
  */
  syncTeamToServer();
  toast(`消耗 ${spent} 点 fever：下一场全员开局开启特殊技能`);
});

// ============================================================
//  ★★ 0.2 商店回合：坎诺特的限时商店
// ============================================================
//
// 【和 fever 浮层的区别】
// 这个弹窗**可以自由开关**（右上角 ✕、点卡片外面、金币上方那个按钮都能开合）。
// 因为商店回合里玩家还得看着自己的棋盘决定买不买 ——
// 挡住棋盘的弹窗只会让人瞎买。所以这里**不**像 fever 那样吃掉全部点击。
//
// 【所有动作都走 state 层】
// 买 / 卖 / 刷新 / 切页签，每个都只是调 `state.ts` 里那一个函数 + `renderAll()`。
// 界面不自己改 `shopRound.slots`、也不自己算价格 ——
// 价格和库存口径只有一处实现（改价只改 `shop-round.ts` 那张表）。

/** 货架格上那行"这是哪一档货"的小字 */
const SHOP_ROUND_KIND_LABEL: Record<ShopSlotKind, string> = {
  normal: '普通藏品',
  advanced: '进阶藏品',
  operator: '干员棋子',
  traitRelic: '转职藏品',
};

/**
 * ★★ 两个秒数（弹窗右上 + 金币上方那个开关按钮）。
 *
 * 【为什么必须每帧写，不能只写在 renderAll 里？】
 * 这是用户报的那个 bug："商店开关按钮上的倒计时不动"。
 * 根因是 `renderAll()` 只在**事件**发生时跑（买东西、房间广播…），
 * 倒计时却要**每帧**往下掉 —— 放在 renderAll 里，没人触发事件它就永远停在同一个数。
 *
 * 【为什么要缓存上一次的字符串？】
 * 每帧写 DOM 会有开销，而秒数一秒才变一次 —— 没变就不写。
 */
let shopSecondsShown = '';
function syncShopRoundTimers(): void {
  const shop = state.shopRound;
  if (!shop) {
    shopSecondsShown = '';
    return;
  }
  const seconds = Math.max(0, Math.ceil(shop.secondsLeft));
  const key = String(seconds);
  if (key === shopSecondsShown) return;
  shopSecondsShown = key;
  el.shopRoundToggleTimer.textContent = `${key}s`;
  el.shopRoundTimer.textContent = key;
  el.shopRoundTimer.classList.toggle('urgent', seconds <= 10);
  // 顶栏那句「商店 Ns」也是每帧变的 —— 同一个理由，一起刷
  renderPhaseBadge();
}

/** 坎诺特的几句话（每次开张随机挑一句，纯气氛） */
const KHANOT_LINES: readonly string[] = [
  '「看看货吧，朋友 —— 时间不等人。」',
  '「好东西从不缺买家，缺的是付得起的人。」',
  '「我只做一次生意，但这一次很值。」',
  '「别问我从哪儿弄来的，问就是路上捡的。」',
];

/**
 * 画整张商店（幂等：`renderAll` 每次都调，显隐只跟状态走）。
 *
 * ★ 关掉弹窗时**不重画货架**：重画会浪费一次随机（货架是随机生成的），
 *   而且玩家关掉再打开时看到换了一批货会以为"商店自己刷了"。
 */
function renderShopRound(): void {
  const shop = state.shopRound;
  /*
    ★★ 0.2.1：这里必须用 `shopRoundUsable`（含"我已被淘汰"判据），
    不能再用 `shopRoundActive` —— 那个只回答"这一回合的商店开着没有"，
    和"我能不能进"是两件事。用错的表现就是用户报的：
    淘汰之后金币旁边那个按钮还在，点开照样能买 2 星干员 / 卖藏品，
    而那时他的手牌早就被还回共享牌库了（牌库当场错乱）。
  */
  const active = shopRoundUsable(state);

  // 金币上方的开关按钮：只在商店回合出现
  el.btnShopRound.classList.toggle('hidden', !active);
  el.shopRoundOverlay.classList.toggle('hidden', !active || !shop!.open);
  if (!active) return;

  const opened = shop!.open;
  // ★ 秒数交给 syncShopRoundTimers（它每帧跑一次 —— renderAll 不是每帧跑的，
  //   写在这里的话"倒计时不动"就是必然的）
  syncShopRoundTimers();
  el.shopRoundGold.textContent = state.infiniteGold
    ? '金币 ∞'
    : `金币 ${state.economy.gold}`;

  // 「关着」的时候不刷新按钮文字 —— 但开关按钮上的秒数还是得走（上面已经写了）
  if (!opened) return;

  // 页签：当前那一页高亮
  const sellMode = shop!.mode === 'sell';
  el.shopRoundTabBuy.classList.toggle('active', !sellMode);
  el.shopRoundTabSell.classList.toggle('active', sellMode);

  el.shopRoundNpcLine.textContent =
    KHANOT_LINES[state.round % KHANOT_LINES.length] ?? KHANOT_LINES[0]!;

  if (sellMode) renderShopRoundSellPage();
  else renderShopRoundBuyPage();
}

/** 购买页：8 个货架 */
function renderShopRoundBuyPage(): void {
  const shop = state.shopRound!;
  el.shopRoundHint.textContent = '普通 8 金 · 进阶 16 金 · 转职 12 金 · 干员位直接给 2 星';

  /*
    ★ 0.3：按格子下标就地更新（`.shop-round-slot` 的 hover 也是位移，
    全量重建会抽搐；见 `renderShop` 的说明）。
  */
  const specs: DomSpec[] = [];
  shop.slots.forEach((slot, index) => {
    const affordable = slot.sold ? false : state.infiniteGold || state.economy.gold >= slot.price;
    const sig = [
      slot.kind,
      slot.itemId ?? '',
      slot.defId ?? '',
      slot.price,
      slot.sold ? 'sold' : '',
      affordable ? 'a' : 'na',
    ].join('|');

    specs.push({
      key: `sr:${index}`,
      sig,
      build: () => {
        const node = document.createElement('div');
        node.className = 'shop-round-slot';

        // 空货位（牌库连 3 张都凑不出的干员位）
        if (slot.sold && !slot.itemId && !slot.defId) {
          node.classList.add('empty');
          node.append(iconBox('—', ''), kindLabel(SHOP_ROUND_KIND_LABEL[slot.kind]), nameLabel('无货'));
          return node;
        }

        if (slot.sold) node.classList.add('sold');
        else if (!affordable) node.classList.add('unaffordable');

        if (slot.kind === 'operator') {
          const def = UNIT_DEFS[slot.defId ?? ''];
          node.append(
            operatorIconBox(slot.defId ?? ''),
            kindLabel('干员棋子 · 2★'),
            nameLabel(def?.name ?? slot.defId ?? ''),
            priceLabel(slot.price),
          );
          node.title = def ? `${def.name}（${def.cost} 费）· 直接给 2 星，等于一次买 3 张` : '';
        } else {
          const item = ITEM_DEFS[slot.itemId ?? ''];
          node.append(
            itemIconBox(slot.itemId ?? ''),
            kindLabel(SHOP_ROUND_KIND_LABEL[slot.kind]),
            nameLabel(item?.name ?? slot.itemId ?? ''),
            priceLabel(slot.price),
          );
          if (item) node.title = `${item.name}（${item.rarity === 'advanced' ? '进阶' : '普通'}）\n${item.desc}`;
        }

        if (!slot.sold) {
          node.addEventListener('click', () => requestShopRoundBuy(index));
        }
        return node;
      },
    });
  });

  renderKeyed(el.shopRoundSlots, specs, {
    key: (spec) => spec.key,
    sig: (spec) => spec.sig,
    build: (spec) => spec.build(),
    ns: 'shop-round-buy',
  });

  // 刷新按钮：只在购买页有意义（售卖页没有"换一批"这回事）
  const price = shopRoundRerollPrice(state);
  /*
    ★★ 0.3.1：盟约「特别优惠」的免费刷新 —— 用户要求"免费刷新要能和普通刷新一眼分开"。
    免费期间：价格写成「免费」、按钮走**荧光黄绿**（系统高亮 = 当前可白嫖），
    角标写「×N」——免费只有 3 次，玩家得知道还剩几次（用完了会跳回 4 金）。
    ★ 和卡牌商店那个「特殊刷新」金角标**刻意不同色**：一个是免费、一个是特殊，别混淆。
  */
  const freeLeft = state.covenant.cannotFreeRerolls;
  const isFree = freeLeft > 0;
  el.shopRoundRerollCost.textContent = isFree ? '免费' : String(price);
  el.shopRoundRerollBadge.classList.toggle('hidden', !isFree);
  el.shopRoundRerollBadge.classList.toggle('free', isFree);
  el.shopRoundRerollBadge.textContent = isFree ? `×${freeLeft}` : '';
  el.shopRoundReroll.classList.toggle('is-free', isFree);
  el.shopRoundReroll.title = isFree
    ? `盟约「特别优惠」：还能免费刷新 ${freeLeft} 次（免费次数不会抬高后续价格）`
    : `刷新货架（${price} 金）`;
  el.shopRoundReroll.disabled = !state.infiniteGold && state.economy.gold < price;
  el.shopRoundReroll.classList.remove('hidden');
}

/** 售卖页：身上**没装备**的藏品，每格下面一个「卖出 +N」 */
function renderShopRoundSellPage(): void {
  el.shopRoundHint.textContent = '只能卖没装备的藏品（装备中的要先卸下来）· 售价 = 买价的一半';
  el.shopRoundReroll.classList.add('hidden');

  const items = sellableShopRoundItems(state);
  const specs: DomSpec[] = [];

  if (items.length === 0) {
    /*
      ★ 空状态单独一个样式：不要复用 `.shop-round-slot.empty`
      （那格 opacity 0.3，是给"卖掉了的货架格"用的 —— 复用在这里字几乎看不见）。
    */
    specs.push({
      key: '#empty',
      sig: 'empty',
      build: () => {
        const empty = document.createElement('div');
        empty.className = 'shop-round-empty';
        empty.append(kindLabel('没有可卖的藏品'), nameLabel('身上没装备的藏品都卖光了'));
        return empty;
      },
    });
  }

  for (const entry of items) {
    const item = ITEM_DEFS[entry.itemId];
    /*
      ★ key 用「栏位 + 下标」而不是 itemId：同名藏品可能有两件，
      用 itemId 当 key 会让它们的节点被互相顶替（点了第一件卖的是第二件）。
    */
    specs.push({
      key: `sell:${entry.zone}:${entry.index}`,
      sig: [entry.itemId, entry.price].join('|'),
      build: () => {
        const node = document.createElement('div');
        node.className = 'shop-round-slot';
        node.append(
          itemIconBox(entry.itemId),
          kindLabel(SHOP_ROUND_KIND_LABEL[slotKindOfItem(entry.itemId)]),
          nameLabel(item?.name ?? entry.itemId),
        );
        if (item) node.title = `${item.name}\n${item.desc}`;

        const btn = document.createElement('button');
        btn.className = 'shop-round-sell-btn';
        btn.textContent = `卖出 +${entry.price}`;
        btn.addEventListener('click', (event) => {
          // ★ 别让这一下冒泡到"整格点击"（售卖页整格没有点击，但防御一下没坏处）
          event.stopPropagation();
          const result = sellShopRoundItem(state, entry.zone, entry.index);
          toast(result.message, !result.ok);
          renderAll();
        });
        node.appendChild(btn);
        return node;
      },
    });
  }

  renderKeyed(el.shopRoundSlots, specs, {
    key: (spec) => spec.key,
    sig: (spec) => spec.sig,
    build: (spec) => spec.build(),
    ns: 'shop-round-sell',
  });
}

/** 售卖页格子上那行小字（普通 / 进阶 / 转职） */
function slotKindOfItem(itemId: string): ShopSlotKind {
  if (sellPriceOfItem(itemId) === SHOP_SELL_PRICE.traitRelic) {
    // 转职藏品 = 18 件 `itm_relic_<羁绊>`；售价 6 金
    return 'traitRelic';
  }
  const rarity = ITEM_DEFS[itemId]?.rarity;
  return rarity === 'advanced' ? 'advanced' : 'normal';
}

// ---- 小零件 ----
function iconBox(text: string, color: string): HTMLElement {
  const box = document.createElement('div');
  box.className = 'shop-round-slot-icon fallback';
  box.textContent = text;
  if (color) box.style.background = color;
  return box;
}

function kindLabel(text: string): HTMLElement {
  const node = document.createElement('div');
  node.className = 'shop-round-slot-kind';
  node.textContent = text;
  return node;
}

function nameLabel(text: string): HTMLElement {
  const node = document.createElement('div');
  node.className = 'shop-round-slot-name';
  node.textContent = text;
  return node;
}

function priceLabel(price: number): HTMLElement {
  const node = document.createElement('div');
  node.className = 'shop-round-price';
  node.textContent = String(price);
  return node;
}

function itemIconBox(itemId: string): HTMLElement {
  const item = ITEM_DEFS[itemId];
  const box = document.createElement('div');
  box.className = 'shop-round-slot-icon';
  if (!item) {
    box.classList.add('fallback');
    box.textContent = '?';
    return box;
  }
  const loaded = getLoadedImage(itemIconPath(item.icon));
  if (loaded && itemIconLoaded(item.icon)) {
    const img = document.createElement('img');
    img.src = loaded.src;
    img.alt = item.name;
    box.appendChild(img);
    return box;
  }
  // 没图先画首字（和藏品栏同一个兜底思路），图到了再重画一次
  if (!itemIconRequested.has(item.icon)) {
    itemIconRequested.add(item.icon);
    loadImage(itemIconPath(item.icon)).then((image) => {
      if (image) renderShopRound();
    });
  }
  box.classList.add('fallback');
  const style = itemRarityStyle(item);
  box.style.background = style.wash;
  box.style.color = style.base;
  box.textContent = item.name.slice(0, 1);
  return box;
}

function operatorIconBox(defId: string): HTMLElement {
  const def = UNIT_DEFS[defId];
  const box = document.createElement('div');
  box.className = 'shop-round-slot-icon';
  if (!def) {
    box.classList.add('fallback');
    box.textContent = '?';
    return box;
  }
  const portrait = getLoadedImage(unitSpritePath(def.id))?.src ?? null;
  if (portrait) {
    const img = document.createElement('img');
    img.src = portrait;
    img.alt = def.name;
    box.appendChild(img);
    return box;
  }
  box.classList.add('fallback');
  box.style.background = rarityOfCost(def.cost).wash;
  box.textContent = def.name.slice(0, 1);
  return box;
}

/**
 * 买一格。
 *
 * 【干员位为什么联机时要走服务器？】
 * 它卖的是 **2 星 = 3 张 1 星**，得从**共享牌库**里真扣 3 张 ——
 * 不然 8 个人各买各的，同一个干员会被卖出远超牌库的份数。
 * 藏品不走这条路：藏品是每人自己的库存，没有共享可争的。
 */
function requestShopRoundBuy(index: number): void {
  const slot = state.shopRound?.slots[index];
  if (!slot || slot.sold) return;

  if (netplayActive && slot.kind === 'operator' && slot.defId) {
    pendingShopRoundOperator = index;
    if (!net.buyCard(slot.defId, OPERATOR_SLOT_COPIES)) {
      pendingShopRoundOperator = null;
      toast('没连上服务器，买不了', true);
    }
    return;
  }

  const result = buyShopRoundSlot(state, index);
  toast(result.message, !result.ok);
  renderAll();
  // 买了干员要重发阵容（联机的干员位走的是 buyResult 那条路，在那儿同步）
  if (result.ok) syncTeamToServer();
}

/** 联机：正在等服务器批准"买这个 2 星干员"的货架下标 */
let pendingShopRoundOperator: number | null = null;

// ---- 按钮 ----
el.btnShopRound.addEventListener('click', () => {
  toggleShopRoundOpen(state);
  renderAll();
});

el.shopRoundClose.addEventListener('click', () => {
  if (!state.shopRound?.open) return;
  toggleShopRoundOpen(state);
  renderAll();
});

// 点卡片外面 = 关闭（和"可自由开关"的口径一致）
el.shopRoundOverlay.addEventListener('click', (event) => {
  if (event.target !== el.shopRoundOverlay) return;
  if (!state.shopRound?.open) return;
  toggleShopRoundOpen(state);
  renderAll();
});

el.shopRoundTabBuy.addEventListener('click', () => {
  setShopRoundMode(state, 'buy');
  renderAll();
});

el.shopRoundTabSell.addEventListener('click', () => {
  setShopRoundMode(state, 'sell');
  renderAll();
});

el.shopRoundReroll.addEventListener('click', () => {
  const result = rerollShopRound(state);
  toast(result.message, !result.ok);
  renderAll();
});

/**
 * ★ 提前收摊。
 *
 * 【为什么不做二次确认？】
 * 收摊只是"不看了"，没买的货本来也不会留着 —— 没有不可逆的代价。
 * 而"买完还要干等一分钟"才是真的烦，加一道确认等于把烦翻倍。
 */
el.shopRoundEnd.addEventListener('click', () => {
  if (!state.shopRound) return;
  closeShopRound(state);
  renderAll();
  toast('提前收摊 —— 继续布阵');
});

function renderReconnectButton(): void {
  const session = getMachineSession();
  const canReconnect = Boolean(session) || net.canResume;
  const visible = currentView === 'menu' && canReconnect && !netplayActive;
  el.menuReconnect.classList.toggle('hidden', !visible);
  if (!visible) return;
  el.menuReconnectText.textContent = session?.roomCode ? `回到对局（${session.roomCode}）` : '回到对局';
}

el.menuReconnect.addEventListener('click', () => {
  if (!getMachineSession() && !net.canResume) {
    renderReconnectButton();
    return;
  }
  // 本机另一个标签页还在玩 -> 先问一句（用户点「接管」之后走的是同一条重连）
  if (machineBusy()) {
    warnLocalMatchBusy();
    return;
  }
  toast('正在回到对局…');
  resumeMachineMatch();
});

/**
 * ★ 0.1.3：版本不一致的提示。
 *
 * 服务端也会拒绝（见服务端的 `ensureSameVersion`），这里只是**早点说清楚** ——
 * 否则玩家点半天"加入房间"只会收到一句干巴巴的失败，根本猜不到是版本问题。
 */
function warnVersionMismatch(): void {
  toast(
    `版本不一致：你的是 ${SERVER_VERSION}，服务器是 ${net.serverVersion || '未知版本'} —— ` +
      '请所有人用同一个安装包再联机',
    true,
  );
}

/**
 * 离开联机，回到主界面。
 *
 * 【注意顺序】
 * 先切界面、再收网、最后清状态 —— 因为切界面会触发一次 resize，
 * 而 resize 要读 room 信息来决定测试模式按钮的状态。
 * 顺序反了会有一瞬间显示错的状态。
 */
function leaveNetplay(): void {
  net.leaveRoom();
  // ★ 0.1.2：房间没了 -> 本机会话也要跟着放掉（顺带停掉占用心跳）
  syncedRoomCode = null;
  stopOwnershipHeartbeat();
  /*
    ★ 0.1.2：**真的离开这一局**了，重连令牌才作废。
    时机很关键：一次普通的网络抖动绝不能走到这里（那会把"回座位的钥匙"扔掉），
    所以 onDisconnected 在"有令牌"时是原地等重连、根本不调用本函数。
  */
  net.clearResumeToken();
  markMidMatch(false);
  netplayResyncing = false;
  // 真正离开房间才把"我在联机对局里"关掉（游戏结束不算离开，见 netplayMatchOver）
  netplayActive = false;
  netplayMatchOver = false;
  spectating = false;
  // ★ 0.1.3：暂停标记跟着对局一起清掉，别把上一局的"暂停中"带到下一局
  matchPaused = false;
  // ★ 0.1.4：暂停浮层上那几个数 + "我投过票"也一起复位
  votedThisPause = false;
  pauseTickSeen = false;
  pauseInfo = { secondsLeft: 0, voteCount: 0, voteNeeded: 0 };
  // ★ 0.1.1：招募的仲裁者也要摘掉 —— 不然回到单机后招募还会去发网络消息
  delete state.recruitRequest;
  // ★ 0.1.1：离开房间 -> 结算页也要收掉（它的数据属于刚才那一局）
  hideResultPage();
  setViewFlipped(false);
  board.setHalfTint(false);
  replay.setFlip(false);
  // 离开房间 = 这一局结束了，把战斗演出和伤害统计一起清掉
  resetBoardAndPlayback();
  /*
    ★ 0.2.2：真正离开这一局了 —— "本页装载过本局"的标记也要放掉。
    不然下次再回座（令牌可能还在）时，会被当成"本页已经在打"从而**拒绝还原**棋盘。
  */
  localMatchLoaded = false;
  setView('menu');
  setNetStatus('已离开房间', '');
  renderAll();
}

/**
 * 返回主界面。
 *
 * 【联机对局中返回会怎样？】
 * 会退出房间。因为联机对局的回合由服务器推进，
 * 你退回主界面就等于弃权了 —— 留个"半弃权"状态只会让双方都困惑。
 * 所以这里直接走和「离开房间」一样的流程。
 *
 * 【为什么单机返回也要清残留？】
 * 因为再点「开始游戏」是**新开一局**（阵容、金币、回合全部重来），
 * 上一局的战斗日志和伤害统计留着没有任何意义 ——
 * 只会变成"新一局还没开打，右边却显示着上局的伤害表"这种假信息。
 */
function backToMenu(): void {
  window.clearTimeout(nextRoundTimer);
  if (net.room || netplayActive) {
    leaveNetplay();
    return;
  }
  // ★ 0.0.3：离开时把测试沙盒也收掉（下次点「测试模式」会重新造一套）
  testSides = null;
  activeTestTeam = 0;
  resetBoardAndPlayback();
  // ★ 0.2.2：单机也算"离开这一局"，重置"本页装载过本局"的标记
  localMatchLoaded = false;
  setView('menu');
  setNetStatus(`单机模式 · 服务器 ${net.url}`, '');
}

// ============================================================
// 主循环
// ============================================================

let lastFrameTime = performance.now();

function frame(): void {
  requestAnimationFrame(frame);

  const now = performance.now();
  // 限制单帧最大步长：切到别的标签页再切回来时 deltaTime 会非常大，
  // 不限一下会让战斗瞬间播完
  const deltaSeconds = Math.min(0.05, (now - lastFrameTime) / 1000);
  lastFrameTime = now;

  board.update(deltaSeconds);

  /*
    ★★ 0.2 商店回合：90 秒倒计时（**独立阶段**，用户口径）。
    每帧推一次，到点自动收摊回到布阵；
    ★ 它顺带负责"被打断就收摊"（联机里服务器到点直接开下一场，
    本地这个 shop 阶段会被顶掉，见 tickShopRound 的说明）。
    ★ 只有**刚刚结束**的那一帧才重画 —— 不然每帧 renderAll 太浪费。
    ★ 被打断（联机开下一场）时不弹"打烊"，那句话在进战斗的画面上是错的。
  */
  /*
    ★ 联机：商店的秒数**由服务端推**（`onShopTick`），本地**不能**自己往下数 ——
    所以这里把步长传 0：倒计时不动，但"被打断就收摊"那道闸门照样生效。
    ★ 单机：没有服务端，本地自己数。
  */
  const shopEnded = tickShopRound(state, netplayActive ? 0 : deltaSeconds);
  if (shopEnded) {
    renderAll();
    if (shopEnded === 'timed-out') toast('商店打烊了 —— 继续布阵');
  }
  // ★ 用户报的 bug：倒计时不动 —— 秒数必须每帧写（renderAll 不是每帧跑的）
  syncShopRoundTimers();
  // ★ 0.3：盟约选秀同一个道理（服务端 tick 给基准，每帧按墙钟换算）
  syncCovenantTimer();

  /*
    ★ 0.1.2：画面里在播战斗的两种情形都要推进回放。
    ① 我自己的战斗（`battle`）；
    ② **我已经打完（result）、正在旁观别人的对局** —— 这时候阶段是 result，
       但屏幕上确实在放别人的战斗，不推进就等于观战画面定住不动。
    旁观时 `showBattle` 不会把阶段改回 battle（见那里的说明），所以这里必须显式放行。
  */
  const spectatingOthers =
    netplayActive && viewingBattleId !== null && viewingBattleId !== currentBattleId;
  const battleOnScreen = currentResult !== null && (state.phase === 'battle' || spectatingOthers);

  if (battleOnScreen) {
    if (!paused) {
      replay.advance(deltaSeconds);
      state.playbackSeconds = replay.currentSeconds;
      /*
        ★ 0.1.1：记住"我正在看的这一场演到第几秒"。
        观战是可以切来切去的（同一时刻只能播一场），切走时把进度存下来，
        切回来才能接着放 —— 不然切回来会从头开始，等于白看。
      */
      const watching = viewingBattleId ? liveBattles.get(viewingBattleId) : null;
      if (watching) watching.playedSeconds = replay.currentSeconds;
    }

    const progress = replay.durationSeconds > 0 ? replay.currentSeconds / replay.durationSeconds : 0;
    if (!seeking) el.seek.value = String(Math.round(progress * 1000));
    el.battleTime.textContent = `${replay.currentSeconds.toFixed(1)}s`;

    /*
      ★ 顶部两条血条（你报的第 12 条）：左边永远是**我方**，右边永远是敌方。
      显示的是"双方当前干员的**总血量**"（不是平均百分比）——
      条宽 = 本方当前总血量 / 本方满血总量，旁边的文字直接写绝对数值，
      这样"我还剩多少、对面还剩多少"是一眼可比的。
      以前的写法是按队伍人数**取平均**，9 个残血和 1 个满血都是 50%，
      完全看不出谁快撑不住了。
    */
    const myTeam: 0 | 1 = replay.flipped ? 1 : 0;
    const totals = replay.hpTotals();
    const mine = totals[myTeam];
    const foe = totals[myTeam === 0 ? 1 : 0];
    el.hp0.style.width = `${mine.maxHp > 0 ? (mine.hp / mine.maxHp) * 100 : 0}%`;
    el.hp1.style.width = `${foe.maxHp > 0 ? (foe.hp / foe.maxHp) * 100 : 0}%`;
    el.teamName0.textContent = `我方 ${Math.round(mine.hp / FIX)}`;
    el.teamName1.textContent = `敌方 ${Math.round(foe.hp / FIX)}`;

    // 战斗中的实时详情面板：血量/法力每帧都在变
    updateBattleUnitInfo();

    flushBattleLog();

    /*
      ★ 0.1.1：我那一场到点了，但画面还在别人那场 -> 先切回自己那场。
      【为什么必须切回来再收尾？】
      `finishBattle()` 读的是全局的 `currentResult` / `myTeam` / `currentNames`，
      它们此刻装的是**别人那一场**的数据 —— 直接结算会把别人的胜负算到我头上。
      切回来（并跳到这一场的末尾）之后，下一帧 `replay.isFinished` 自然成立，
      走的还是原来那条一模一样的路径（回执也照旧由它发），一行逻辑都不用改。
      【为什么跳到末尾而不是接着播？】
      因为这时候**真实时间已经过去了**：接着播会让整个房间多等我十几秒
      （服务器要等所有人的"我看完了"）。
    */
    if (shouldReturnToMyBattle()) {
      const mine = currentBattleId ? liveBattles.get(currentBattleId) : null;
      if (mine) showBattle(currentBattleId!, mine.durationSeconds ?? replay.currentSeconds);
    }

    /*
      ★★ 0.1.2 修（用户报的"战斗回合结束后不会结束、不会正常切回合"）：
      口径抽到纯函数 `shouldFinishBattle` 里了（带单元测试），见它的说明 ——
      单机 / 测试沙盒里 `viewingBattleId` 恒为 null，以前把它和联机同一套判据写在一起，
      结果**永远收不了尾**：战斗播完停在战斗画面、回合不推进。
    */
    const viewingMine = shouldFinishBattle({
      replayFinished: replay.isFinished,
      netplay: netplayActive,
      viewingBattleId,
      currentBattleId,
    });
    if (viewingMine) {
      if (state.phase === 'battle') finishBattle();
    } else if (replay.isFinished && netplayActive && state.phase === 'battle') {
      // 看完了别人的那一场 -> 切回自己那场接着看（自己那场到点的话上面已经跳到末尾了）
      if (currentBattleId && liveBattles.has(currentBattleId)) watchBattle(currentBattleId);
    }
  }

  // 布阵阶段的棋子不需要每帧重画（用的是静态立绘），这里什么都不用做
  board.renderer.render(board.scene, board.camera);
}

// ---- 视角：滚轮拉近 + 拉近后拖动平移（第 13 条需求） ----

/**
 * 平移状态。
 *
 * 【为什么要和"拖棋子"分开一套变量？】
 * 两者都是 pointerdown -> pointermove -> pointerup，但语义完全不同：
 * 拖棋子会改玩家数据（落子/换格），平移只改相机。
 * 混在一套状态里迟早会出现"平移完顺手把棋子也放下去了"这种事故。
 */
let panPointerId: number | null = null;
let panLastX = 0;
let panLastY = 0;
let panMoved = false;

/**
 * 滚轮拉近/拉远。
 *
 * 【为什么要 preventDefault？】
 * 默认行为是**滚动整个页面** —— 而页面在游戏视图下是不能滚的，
 * 于是滚轮看起来"没反应"，其实是把底下的页面滚走了。
 * passive: false 是必须的，否则浏览器不允许取消默认行为。
 */
canvas.addEventListener(
  'wheel',
  (event) => {
    const before = board.zoomLevel();
    const after = board.zoomBy(event.deltaY);
    event.preventDefault();
    if (after !== before) {
      updateZoomHint();
      // 拉近/拉远之后格子的屏幕位置变了，鼠标下的高亮要立刻跟上
      updateHighlightFromPointer(event.clientX, event.clientY);
      if (after === 1) toast('视角已回到最远（默认）');
    }
  },
  { passive: false },
);

/** 视角徽标：显示当前倍率，拉近时高亮（点它回到最远视角） */
function updateZoomHint(): void {
  const zoom = board.zoomLevel();
  el.zoomHint.textContent = `视角 ×${zoom.toFixed(1)}`;
  el.zoomHint.classList.toggle('zoomed', zoom > 1);
  el.zoomHint.title =
    zoom > 1
      ? `已拉近 ${zoom.toFixed(1)} 倍：按住棋盘空白处拖动可以平移；点这里回到最远视角`
      : '滚轮拉近 / 拉远视角；拉近后按住棋盘空白处拖动可以平移';
}

el.zoomHint.addEventListener('click', () => {
  board.resetView();
  updateZoomHint();
  toast('视角已回到最远（默认）');
});

// ============================================================
// 事件绑定
// ============================================================

canvas.addEventListener('mousemove', (event) => updateHighlightFromPointer(event.clientX, event.clientY));
canvas.addEventListener('mouseleave', () => board.setHighlight(null, true));

// ---- 拖动：按下 -> 移动 -> 松开 ----
canvas.addEventListener('pointerdown', (event) => {
  /*
    ★ 平移优先判断（第 13 条需求）：
      · 中键：任何时候都能平移（鼠标有中键的话最直观）
      · 左键：只有在**已经拉近**、且按在**没有棋子的地方**时才平移
        按在棋子上仍然是"拖那个棋子"，这个优先级不能让出去。
    没拉近（倍率 = 1）时行为完全不变 —— 这是"最远视角就是现在的视角"的保证。
  */
  const zoomed = board.zoomLevel() > 1;
  if (zoomed && (event.button === 1 || event.button === 0)) {
    const viewCell = board.screenToCell(event.clientX, event.clientY);
    const rawCell = viewCell ? viewToRawCell(viewCell, viewFlipped) : null;
    const onOwnUnit = rawCell !== null && viewingPlayerId === null && placementAt(state, rawCell) !== undefined;
    if (event.button === 1 || !onOwnUnit) {
      panPointerId = event.pointerId;
      panLastX = event.clientX;
      panLastY = event.clientY;
      panMoved = false;
      canvas.setPointerCapture(event.pointerId);
      return;
    }
  }

  if (event.button !== 0) return; // 只处理左键
  // 看别人棋盘时不能拖动（拖的是他的棋子，改的却是我的数据）
  // ★ 0.1.1：被淘汰的人同样不能拖（他的牌已经回库了）
  // ★ 0.2.1：判据收进 `spectateOrEliminated()`（唯一实现，别在这里再写一遍）
  if (spectateOrEliminated()) return;

  // 按在场上已有棋子上 -> 拖动它
  const viewCell = board.screenToCell(event.clientX, event.clientY);
  if (viewCell) {
    const cell = viewToRawCell(viewCell, viewFlipped);
    if (placementAt(state, cell)) {
      beginDrag({ kind: 'board', from: cell }, event, canvas);
      // 捕获指针：这样鼠标移出画布也能继续收到事件，
      // 松手时才能正确结束拖动（不然会留一个"粘"住的预览）
      canvas.setPointerCapture(event.pointerId);
      return;
    }
  }
});

canvas.addEventListener('pointermove', (event) => {
  if (panPointerId !== null && event.pointerId === panPointerId) {
    const dx = event.clientX - panLastX;
    const dy = event.clientY - panLastY;
    panLastX = event.clientX;
    panLastY = event.clientY;
    if (!panMoved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    panMoved = true;
    board.panBy(dx, dy);
    board.setHighlight(null, true);
    return;
  }

  if (!drag || event.pointerId !== drag.pointerId) return;

  if (!drag.moved) {
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    // 超过阈值才算拖动，避免「手抖一下」就把点击当成拖动
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    drag.moved = true;
  }

  moveDragGhost(event.clientX, event.clientY);
  updateDragTarget(event.clientX, event.clientY);
});

canvas.addEventListener('pointerup', (event) => {
  if (panPointerId !== null && event.pointerId === panPointerId) {
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    panPointerId = null;
    // 平移过就把随后的 click 吃掉，免得"拖完视角顺手点到了一个格子"
    if (panMoved) suppressNextClick = true;
    panMoved = false;
    return;
  }

  if (!drag || event.pointerId !== drag.pointerId) return;
  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
  endDrag(event.clientX, event.clientY);
});

// 指针被系统抢走（比如触屏手势、弹出系统菜单）时也要收起拖动，否则预览会留在屏幕上
canvas.addEventListener('pointercancel', () => {
  panPointerId = null;
  panMoved = false;
  cancelDrag();
});

canvas.addEventListener('click', (event) => {
  // 刚刚结束的拖动已经处理过了，不要再当成点击
  if (suppressNextClick) {
    suppressNextClick = false;
    return;
  }

  /*
    ★ 战斗中：点棋子看实时属性（含敌方）。
    这时候不能按"格子"去找棋子 —— 棋子会移动，而且同一格可能已经空了。
    所以改成**往演出层那棵树里打射线**，命中哪个精灵就问它是哪一号单位。
  */
  if (state.phase === 'battle' && currentResult) {
    const hit = board.pickIn(event.clientX, event.clientY, replay.root);
    const unitId = replay.unitIdOf(hit);
    if (unitId !== null) openBattleUnitInfo(unitId, event.clientX, event.clientY);
    else closeUnitInfo(); // 点空地关掉面板
    return;
  }

  const cell = board.screenToCell(event.clientX, event.clientY);
  if (cell) handleBoardClick(cell, 0, event.clientX, event.clientY);
  else closeUnitInfo(); // 点棋盘外的空地也关掉卡片
});

canvas.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  /*
    ★ 只认"干净的右键单击"：按住右键拖着画手势（浏览器鼠标手势）时**什么都不做**。
    见文件末尾 `takePlainRightClick()` 的说明 —— 手势的松手点常常已经跑到
    另一个棋子上，那一下以前会被当成"右键收回"，是用户报的误触来源。
  */
  if (!takePlainRightClick()) return;
  const cell = board.screenToCell(event.clientX, event.clientY);
  if (cell) handleBoardClick(cell, 2);
});

el.btnRefresh.addEventListener('click', () => {
  const result = doRefreshShop(state);
  toast(result.message, !result.ok);
  renderAll();
});

el.btnLock.addEventListener('click', () => {
  const result = doToggleShopLock(state);
  toast(result.message, !result.ok);
  renderAll();
});

el.btnBuyXp.addEventListener('click', () => {
  const result = doBuyXp(state);
  toast(result.message, !result.ok);
  renderAll();
});

el.btnBattle.addEventListener('click', () => startBattle());

/*
  「回到我的棋盘」：看完别人的阵容点一下回来。
  这个按钮很重要 —— 没有它玩家会以为"我点了别人的名字，自己的棋盘就没了"。
*/
el.btnBackMyBoard.addEventListener('click', () => {
  setViewingPlayer(null);
  renderAll();
});
/*
  右上角的页签切换（日志 / 玩家 / 藏品）。
  ★ 点当前页签 = 收起右侧栏（保留原来「日志」按钮的收起能力）。
  收起/展开会改变 3D 可视区域，所以要重算一次尺寸。
*/
el.sidebarTabs.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>('.sidebar-tab');
  if (!target || target.disabled) return;
  const tab = target.dataset.sideTab as SideTab | undefined;
  if (!tab) return;

  if (!sidebarHidden && sideTab === tab) {
    sidebarHidden = true;
  } else {
    sideTab = tab;
    sidebarHidden = false;
  }
  renderSidebarTabs();
  handleResize();
});
el.btnBackMenu.addEventListener('click', () => {
  /*
    ★ 返回主界面一律要二次确认。
    
    【这里修过一个真实的 bug，记下来】
    第一版我做了「智能判断」：刚开始（第 1 回合且场上没棋子）就直接返回、不打扰。
    结果那个条件几乎永远不成立 —— 因为**新开一局时 round 就是 1、场上是空的**，
    玩家买了棋子放在备战席上，round 和 placements 也都不变。
    于是确认框永远不弹，用户反馈「二次确认没生效」。

    教训：**别用「猜玩家进度」来决定要不要确认** —— 这种条件很容易漏掉情况。
    统一都问一次更可预测，误触的代价是多点一下，而不问的代价是丢掉一整局。
  */
  if (net.room || netplayActive) {
    askConfirm(
      '退出房间并返回主界面？',
      '你正在联机对局中。<br /><span style="color:var(--danger)">返回主界面会退出房间，这一局就不能继续了。</span>',
      '退出并返回',
      () => leaveNetplay(),
    );
    return;
  }

  // 单机：显示当前进度，让玩家知道要放弃什么
  askConfirm(
    '返回主界面？',
    `当前第 <strong>${state.round}</strong> 回合 · 等级 <strong>${state.economy.level}</strong> · ` +
      `场上 <strong>${state.placements.length}</strong> 个干员<br />` +
      '返回主界面会放弃这一局的进度。',
    '返回并放弃这一局',
    () => backToMenu(),
  );
});

// ============================================================
// 主界面按钮
// ============================================================

/** 隐藏主界面所有面板，回到按钮列表 */
function showMenuButtons(): void {
  el.menuPanelCreate.classList.add('hidden');
  el.menuPanelJoin.classList.add('hidden');
  el.menuPanelSettings.classList.add('hidden');
  el.menuButtons.classList.remove('hidden');
  // ★ 0.3.3：离开加入页就把局域网轮询停掉（看不见的页面不该一直发包）
  stopLanPolling();
}

/**
 * 开始一局单机游戏。
 *
 * @param testMode 是否以测试模式开始（无限金币）
 */
/**
 * 开一局单机。
 *
 * ★ 0.3：开完立刻弹**盟约选秀**（单机版），选完才把效果折进这一局。
 *   为什么不是"先选再开局"？—— 那样"单人游戏"这个按钮就不再是"立刻开局"了，
 *   而这套界面里**大量**东西（测试、脚本、玩家习惯）都默认"点了就进棋盘"。
 *   所以选秀做成"在棋盘上盖一层"：选完关掉，棋盘一直都在。
 */
function startSinglePlayer(testMode: boolean): void {
  /*
    开单机之前把联机状态**彻底**清掉。
    漏掉的话会出现"我明明在单机，但 netplayMatchOver 还是上一局的 true"，
    于是单机的回合推进被挡住、或者反过来联机的判断还生效。
  */
  netplayActive = false;
  netplayMatchOver = false;
  spectating = false;
  myTeam = 0;
  // ★ 0.1.1：开单机之前把上一局联机的结算页收掉，免得盖在单机棋盘上
  hideResultPage();
  // ★ 0.3：单机的盟约"胜利回血"计数（每局清零）
  singlePlayerCovenantWins = 0;

  if (testMode) {
    /*
      ★ 0.0.3：测试模式 = 「双阵营沙盒」。
      造**两套完全独立**的状态：蓝方（左半场）和红方（右半场）。
      一个玩家同时操作两边，让他们对打 —— 不再走单机闯关那套人机波次。
    */
    testSides = [createTestSide(0), createTestSide(1)];
    activeTestTeam = 0;
    state = testSides[0];
  } else {
    // 普通单机：换一局全新的（而不是沿用上一次的状态）
    testSides = null;
    activeTestTeam = 0;
    state = createGameState();
    // ★ 单机没有共享牌库要仲裁 —— 招募必须走本地那条路（清掉可能残留的联机钩子）
    delete state.recruitRequest;
    // ★ 0.3.4：换了一局 => 组队器里的计划作废（用户口径：仅本局有效，不跨局）
    resetTeamPlanForNewGame();
  }
  /*
    ★ 0.3：新的一局 -> 打开单机版盟约选秀（盖在棋盘上，选完就关）。
    开局金币 / 收入 / 血量在**选中那一刻**再折进去（见 `applyLocalCovenant`），
    这样"跳过"就是干干净净的一点加成都不带。
  */
  localCovenant = { open: !DEBUG_SKIP_LOCAL_COVENANT, testMode };
  // 单机的战斗演出控件是给玩家自由拖的，重新显示出来
  el.btnPause.classList.remove('hidden');
  el.seek.classList.remove('hidden');
  el.speedGroup.classList.remove('hidden');
  renderSpeedButtons();

  resetBoardAndPlayback();
  setView('game');
  renderAll();
  toast(
    testMode
      ? '测试模式：左右各一队，点顶栏「切换到红方」操作右半边（两边经济/阵容独立）'
      : '点下方商店买干员，从备战席拖到场上',
  );
  console.log(
    `[失序协议] 新开一局 · ${testMode ? '测试模式' : '普通模式'} · 种子 ${state.seed}`,
  );
}

// ============================================================
// 修改器（★ 0.0.3，**只有测试模式**能用）
// ============================================================
/*
  【按钮放哪？】
  按需求放在「视角」徽标的**左边** —— 那个徽标在顶栏（#topbar）里，
  所以按钮直接写进顶栏 HTML 就够了，不用像音乐按钮那样搬 DOM。

  【可是面板不能待在顶栏里】
  顶栏有 z-index:20，会形成一个层叠上下文：面板作为它的后代会被关进去，
  然后被战斗控制条（z-index 更高）压住 —— 音乐面板就踩过这个坑。
  所以面板挂在 body 上（自己在 index.html 里写好了），位置按按钮矩形算。

  【为什么按钮和每个入口都卡 testMode？】
  它能把金币调满、无视人口上限、凭空发干员 —— 进了联机就是作弊。
  state.ts 里每个函数开头都有 modifierAllowed() 兜一道，
  这里只管按钮的显隐，双保险。
*/
let modifierPanelOpen = false;
/** 干员下拉建过没有 —— 干员名单是静态的，建一次就够 */
let modifierOptionsBuilt = false;

/** 把面板贴到按钮下面（和音乐面板同一套：越界就往屏幕里推） */
function positionModifierPanel(): void {
  const rect = el.modifierBtn.getBoundingClientRect();
  const width = el.modifierPanel.offsetWidth || 262;
  const height = el.modifierPanel.offsetHeight || 300;

  let left = rect.left;
  if (left + width > window.innerWidth - 10) left = Math.max(10, window.innerWidth - width - 10);
  let top = rect.bottom + 8;
  if (top + height > window.innerHeight - 10) top = Math.max(10, window.innerHeight - height - 10);

  el.modifierPanel.style.left = `${left}px`;
  el.modifierPanel.style.top = `${top}px`;
}

function setModifierPanel(open: boolean): void {
  modifierPanelOpen = open;
  el.modifierPanel.classList.toggle('hidden', !open);
  el.modifierBtn.classList.toggle('active', open);
  if (open) {
    buildModifierOptions();
    buildModifierItemOptions();
    syncModifierControls();
    positionModifierPanel();
  }
}

/**
 * 建「获得干员」那个下拉。
 *
 * 【为什么用 optgroup 按费用分组？】
 * 50 个干员平铺成一条会是一条巨长的龙，根本没法找。
 * 按费用（1~5 费）分组 —— 也就是自走棋里说的"按星级排序" ——
 * 而且**每条 option 只写干员名字**（费用感放在组标题上，不挤占名字）。
 * 召唤物会被 playableDefs() 过滤掉：它们是技能产物，不在商店和牌库里。
 *
 * ★ 0.0.3：**全部野怪**也加进来，放在**最下面**（按档位小怪/普通/精英/领袖/Boss 分组）。
 *   野怪没有星级（星级倍率恒 1000），所以选 1/2/3 星发出来都一样
 *   （见 grantModifierUnit）—— 调数值时就能把它们和任意干员摆在一起对打。
 */
function buildModifierOptions(): void {
  if (modifierOptionsBuilt) return;
  modifierOptionsBuilt = true;
  el.modifierUnit.innerHTML = '';

  const defs = playableDefs()
    .slice()
    .sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name, 'zh'));
  /*
    按费用分组。★ 彩蛋棋子是 20 费（不在 1~5 里），归到「彩蛋」组 ——
    所以这里不写死 1..5，而是取表里**实际出现过**的费用（去重后升序）。
  */
  const costs = [...new Set(defs.map((def) => def.cost))].sort((a, b) => a - b);
  for (const cost of costs) {
    const inCost = defs.filter((def) => def.cost === cost);
    if (inCost.length === 0) continue;
    const group = document.createElement('optgroup');
    group.label = cost > 5 ? '彩蛋' : `${cost} 费`;
    for (const def of inCost) {
      const option = document.createElement('option');
      option.value = def.id;
      option.textContent = def.name; // ★ 只写名字
      group.appendChild(option);
    }
    el.modifierUnit.appendChild(group);
  }

  // ---- ★ 0.0.3：野怪档位分组，放在下拉最下面 ----
  const monsters = monsterDefs();
  for (const tier of MONSTER_TIERS) {
    const inTier = monsters
      .filter((def) => def.monsterTier === tier)
      .sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    if (inTier.length === 0) continue;
    const group = document.createElement('optgroup');
    group.label = `野怪 · ${MONSTER_TIER_LABEL[tier]}`;
    for (const def of inTier) {
      const option = document.createElement('option');
      option.value = def.id;
      option.textContent = def.name; // ★ 只写名字
      group.appendChild(option);
    }
    el.modifierUnit.appendChild(group);
  }
}

/**
 * ★ 0.0.3 建「获得藏品」那个下拉。
 *
 * 【分组怎么分？】
 * 按策划的四个象限分：普通/进阶 × 穿戴/共享 ——
 * 也就是 optgroup 标签写成「普通 · 穿戴藏品」这种。
 * 这样打开下拉就知道"我要的是给干员的、还是给全队的"，
 * 不用挨个读名字去猜（藏品名字本身完全看不出类别）。
 *
 * ★ 下拉里**只出现「穿戴藏品 / 共享藏品」**，不出现「A 类 / B 类」：
 *   那是内部分类的代号（`item.slot`），玩家不需要知道。
 *
 * 每条的 tooltip 带上完整效果：发之前能核对一下这件是不是想要的那件。
 */
let modifierItemOptionsBuilt = false;
function buildModifierItemOptions(): void {
  if (modifierItemOptionsBuilt) return;
  modifierItemOptionsBuilt = true;
  el.modifierItem.innerHTML = '';

  /*
    ★ 0.1.3：转职 / 变形同构体**单独列一组**（用户要求"把羁绊藏品单独分出来"）。
    【为什么不跟「进阶 · 穿戴藏品」挤在一起？】
    那一组本来就有 8 + 12 = 20 件，再加 17 件羁绊相关的，找一个东西要拉很久；
    而且这两类的**用途完全不同**（转职是"给某个干员补一个他没有的羁绊"，
    其余是常规装备），混在一起时玩家得逐条读名字才知道哪些是转职。
    ★ 判据按"效果类别"（grantsTrait / morphRelic）而不是写死 17 个 id ——
    以后再加同类的会自动归到这里。
  */
  const isTraitRelated = (item: {
    grantsTrait?: string;
    onEquip?: { prep?: { kind: string } };
  }): boolean => item.grantsTrait !== undefined || item.onEquip?.prep?.kind === 'morphRelic';

  const groups: Array<{ label: string; items: typeof NORMAL_ITEMS }> = [
    {
      label: `普通 · 穿戴藏品（拖到干员身上，${ITEM_PER_UNIT} 件/人）`,
      items: NORMAL_ITEMS.filter((i) => i.slot === 'A'),
    },
    { label: '普通 · 共享藏品（拖到共享装备位，全队生效）', items: NORMAL_ITEMS.filter((i) => i.slot === 'B') },
    {
      label: '进阶 · 穿戴藏品（拖到干员身上）',
      items: ADVANCED_ITEMS.filter((i) => i.slot === 'A' && !isTraitRelated(i)),
    },
    { label: '进阶 · 共享藏品（拖到共享装备位，全队生效）', items: ADVANCED_ITEMS.filter((i) => i.slot === 'B') },
    { label: '羁绊转职（装在干员身上，给他加一个羁绊）', items: ADVANCED_ITEMS.filter(isTraitRelated) },
    /*
      ★ 0.3.2：盟约专属（阿米娅的三张升变之证）**单独一组**。
      【为什么它们不在上面四组里？】`covenantOnly` 的藏品被 `NORMAL_ITEMS` /
      `ADVANCED_ITEMS` 统一过滤掉了（用户口径：不许出现在野怪掉落和商店里），
      但**修改器是调试沙盒，不是商店** —— 不在这里给个入口，升变流程就只能
      等盟约任务发牌才能试，测都没法测。
      ★ 判据按 `covenantOnly` 标记，以后加同类盟约藏品会自动归到这里。
    */
    {
      label: '盟约专属 · 穿戴藏品（升变之证，只能由盟约「不容拒绝」获得）',
      items: Object.values(ITEM_DEFS).filter((i) => i.covenantOnly === true),
    },
  ];

  for (const { label, items } of groups) {
    if (items.length === 0) continue;
    const group = document.createElement('optgroup');
    group.label = label;
    for (const item of items.slice().sort((a, b) => a.name.localeCompare(b.name, 'zh'))) {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.name; // ★ 只写名字（和干员下拉一致，别把描述塞进来）
      option.title = itemTooltipText(item.id);
      group.appendChild(option);
    }
    el.modifierItem.appendChild(group);
  }
}

/** 把面板里的控件同步成 state 的样子 */
function syncModifierControls(): void {
  el.modifierInfiniteGold.checked = state.infiniteGold;
  el.modifierIgnorePop.checked = state.ignorePopCap;
  // ★ 0.1.2：数值修改开关的真实来源是 main.ts 的 `statEditMode`（界面态），不是 state
  el.modifierStatEdit.checked = statEditMode;
  // ★ 等级下拉跟着当前状态走（沙盒里切阵营时它也要跟着变）
  el.modifierLevel.value = String(state.economy.level);
  // 无限金币开着时「+50」没有意义 —— 直接禁用，别让人点了才发现没用
  el.modifierAddGold.disabled = state.infiniteGold;
}

/** 按钮显隐 + 控件状态（renderAll 里调） */
function renderModifier(): void {
  const allowed = state.testMode;
  el.modifierBtn.classList.toggle('hidden', !allowed);
  // 不在测试模式了（比如返回大厅换成单机/联机），面板要一起收掉
  if (!allowed && modifierPanelOpen) setModifierPanel(false);
  if (allowed) syncModifierControls();

  /*
    ★ 0.1.2：属性修改面板的"守卫"放在这里 ——
    它该消失的三种情况（不是测试模式了 / 不在布阵阶段了 / 那张卡已经不在场上）
    全都在本函数里一起判，而不是散给七八个调用点各写一遍。
    `renderAll` 每次改状态都会跑，所以这三条一定判得到。
  */
  if (statEditMode) {
    const stillThere = unitEditCell !== null && placementAt(state, unitEditCell) !== null;
    if (!allowed || state.phase !== 'prep' || !stillThere) closeUnitEditor();
  }
}

/**
 * ★ 0.0.3 测试沙盒：「切换阵营」按钮。
 *
 * 【为什么不翻转画面？】—— 这是你确认过的选择。
 * 两侧棋子**始终同时可见**（蓝方在左、红方在右），按钮只切换
 * "我现在操作谁"：商店 / 金币 / 备战席 / 阵容 / 羁绊整套跟着换。
 * 战斗进行中不允许切换（那一刻阵容是锁定的）。
 */
function renderSideSwitch(): void {
  const on = isTestSandbox();
  el.switchSideBtn.classList.toggle('hidden', !on);
  if (!on) return;
  const toRed = activeTestTeam === 0;
  el.switchSideBtn.textContent = toRed ? '切换到红方 ▶' : '◀ 切换到蓝方';
  el.switchSideBtn.classList.toggle('to-red', toRed);
  el.switchSideBtn.classList.toggle('to-blue', !toRed);
  el.switchSideBtn.disabled = state.phase !== 'prep';
  el.switchSideBtn.title = toRed
    ? '现在操作蓝方（左半场）。点一下切到红方（右半场）—— 那边的商店 / 金币 / 备战席 / 羁绊都是独立的'
    : '现在操作红方（右半场）。点一下切回蓝方（左半场）';
}

el.modifierBtn.addEventListener('click', () => setModifierPanel(!modifierPanelOpen));
el.modifierClose.addEventListener('click', () => setModifierPanel(false));

/*
  ★ 0.1.2：修改器里的「数值修改」开关。
  它是一个**界面态**（`statEditMode`），不进 state ——
  理由：它决定的只是"点干员弹哪一个面板"，跟对局数据无关；
  写进 state 反而要处理"这个标志要不要被上报/被重连恢复"这一串无意义的问题。
  ★ 关掉时**立刻把编辑面板收掉**：留着它就会出现"开关明明关了、点外面才消失"的错觉。
*/
el.modifierStatEdit.addEventListener('change', () => {
  setStatEditMode(el.modifierStatEdit.checked);
  renderAll();
});

// ★ 0.0.3：切换阵营（只在测试沙盒里生效）
el.switchSideBtn.addEventListener('click', () => {
  if (!testSides || state.phase !== 'prep') return;
  /*
    ★ 0.1.2 修：切侧之前先把编辑面板**落盘**。
    【为什么？】面板里那些还没按「保存」的输入属于**当前这一侧**，
    而切侧必然要把它收掉（两套 state 的 uid 编号体系是共用的，
    留着面板会往新那侧写）—— 直接关掉就等于把玩家刚填的数丢了：
    用户报的"在蓝方改完数值、切到红方之后改的数值复原了"就是这么来的。
    有校验错误（比如填了 0）时**不切**，把面板和报错留在原地让人先改完。
  */
  if (!el.unitEdit.classList.contains('hidden') && !saveUnitEditor()) return;
  activeTestTeam = activeTestTeam === 0 ? 1 : 0;
  state = testSides[activeTestTeam];
  closeUnitInfo();
  // 面板已经在上面落盘并收掉了；这里再兜一次（面板没开时它是幂等的）
  closeUnitEditor();
  renderAll();
  toast(
    `已切到${activeTestTeam === 0 ? '蓝方（左半场）' : '红方（右半场）'} · 该侧商店/金币/备战席/羁绊独立`,
  );
});

el.modifierInfiniteGold.addEventListener('change', () => {
  const result = setInfiniteGold(state, el.modifierInfiniteGold.checked);
  toast(result.message, !result.ok);
  renderAll();
});

el.modifierAddGold.addEventListener('click', () => {
  const result = addGold(state, 50);
  toast(result.message, !result.ok);
  renderAll();
});

el.modifierIgnorePop.addEventListener('change', () => {
  const result = setIgnorePopCap(state, el.modifierIgnorePop.checked);
  toast(result.message, !result.ok);
  renderAll();
});

// ★ 0.0.3：修改等级（1~10 下拉）
el.modifierLevel.addEventListener('change', () => {
  const result = setModifierLevel(state, Number(el.modifierLevel.value));
  toast(result.message, !result.ok);
  renderAll();
});

el.modifierGrant.addEventListener('click', () => {
  const defId = el.modifierUnit.value;
  const star = Number(el.modifierStar.value) || 1;
  const result = grantModifierUnit(state, defId, star);
  toast(result.message, !result.ok);
  renderAll();
});

// ★ 0.0.3：获得藏品（和上面那条一模一样，只是发的东西不同）
el.modifierGrantItem.addEventListener('click', () => {
  const result = grantModifierItem(state, el.modifierItem.value);
  toast(result.message, !result.ok);
  // 藏品栏在右侧，发完自动切过去看一眼 —— 不然点了没反应像失败
  if (result.ok) {
    sideTab = 'collection';
    sidebarHidden = false;
  }
  renderAll();
});

/*
  ★★ 0.3：单机开局之前先走一次**盟约选秀**（用户口径：单机也要有盟约效果，方便测试）。
  选完整才真正开局 —— 那样开局金币 / 收入才能像联机一样"造 state 时就带上"。
*/
el.menuSolo.addEventListener('click', () => startSinglePlayer(false));
el.menuTest.addEventListener('click', () => startSinglePlayer(true));

el.menuCreate.addEventListener('click', () => {
  el.menuButtons.classList.add('hidden');
  el.menuPanelCreate.classList.remove('hidden');
  el.menuNameCreate.focus();
});

el.menuJoin.addEventListener('click', () => {
  el.menuButtons.classList.add('hidden');
  el.menuPanelJoin.classList.remove('hidden');
  // ★ 0.3.3：打开就自动开始搜（关掉面板/进了房间就停，见 stopLanPolling）
  startLanPolling();
  el.menuCode.focus();
});

el.menuSettingsOpen.addEventListener('click', () => {
  el.menuButtons.classList.add('hidden');
  el.menuPanelSettings.classList.remove('hidden');
  renderKeybinds();
  el.menuServer.focus();
});

/*
  ★★★ 0.3.4 自定义快捷键（用户口径：设置里能改常用键，且不能和浏览器冲突）
  ============================================================
  【交互】点一下那个键 → 进入"等你按键"（荧光呼吸）→ 按下想用的键 → 立刻生效并存盘。
           按 Esc = 取消（不改）。再点一次同一个按钮也是取消。
  【为什么要在捕获期间挡住游戏快捷键】不然改"刷新商店"时按 D，
  会先把商店刷了、再把 D 绑上去 —— 钱花了、键也改了。
*/
let keybindCapture: KeyAction | null = null;

function renderKeybinds(): void {
  if (!el.keybindList) return;
  el.keybindList.replaceChildren();
  for (const item of KEY_ACTIONS) {
    const row = document.createElement('div');
    row.className = 'keybind-row';

    const label = document.createElement('span');
    label.className = 'keybind-label';
    label.textContent = item.label;

    const hint = document.createElement('span');
    hint.className = 'keybind-hint';
    hint.textContent = item.hint;

    const btn = document.createElement('button');
    btn.type = 'button';
    const capturing = keybindCapture === item.action;
    btn.className = `keybind-btn${capturing ? ' capturing' : ''}`;
    btn.textContent = capturing ? '按下新键…' : keybindLabel(keybinds[item.action]);
    btn.addEventListener('click', () => {
      keybindCapture = capturing ? null : item.action;
      renderKeybinds();
    });

    row.append(label, hint, btn);
    el.keybindList.appendChild(row);
  }
}

el.keybindReset.addEventListener('click', () => {
  keybinds = resetKeybinds();
  saveKeybinds(keybinds);
  keybindCapture = null;
  renderKeybinds();
  toast('快捷键已恢复默认');
});

/*
  捕获阶段抢先处理：玩家按下的那个键**只用来绑定**，不往下传给游戏。
  ★ 用 `stopImmediatePropagation` 是因为游戏那个 keydown 也挂在 window 上，
    只 `stopPropagation` 挡不住同一个元素上的其它监听。
*/
window.addEventListener(
  'keydown',
  (event) => {
    if (!keybindCapture) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    // Esc = 取消（它本身是保留键，不能绑）
    if (event.code === 'Escape') {
      keybindCapture = null;
      renderKeybinds();
      return;
    }

    const action = keybindCapture;
    const result = setKeybind(keybinds, action, event.code);
    if (!result.ok) {
      toast(result.message, true);
      return; // 留在捕获状态，让玩家直接换一个键
    }
    keybinds = result.binds;
    saveKeybinds(keybinds);
    keybindCapture = null;
    renderKeybinds();
    const label = KEY_ACTIONS.find((item) => item.action === action)?.label ?? action;
    toast(`「${label}」现在是 ${keybindLabel(event.code)}${result.message ? ` · ${result.message}` : ''}`);
  },
  { capture: true },
);

/*
  ★★★ 0.3.4 新手教程（用户口径：第一次打开弹一次、能翻页、之后入口是角落一颗小按钮）
  ============================================================
  【为什么要记"看过了"】第一次打开就弹是好事，第二次还弹就是骚扰。
  标记存在 localStorage（`airnight.tutorial.seen.v1`）—— 带版本号，
  以后教程大改可以换个 key 再弹一次。
*/
let tutorialPage = 0;

/*
  ★ 0.3.4（用户口径）：版本号显示在教程旁边。
  ★ 值只认 shared 的 `SERVER_VERSION` —— 联机"版本不一致就拒绝"用的也是它，
    两处必须是同一份；界面再抄一遍就会变成"界面写 0.3.31、服务器其实 0.3.3"。
*/
el.appVersion.textContent = SERVER_VERSION;
el.appVersion.title = `当前版本 ${SERVER_VERSION}（联机要求双方一致）`;

function renderTutorial(): void {
  const total = tutorialPageCount();
  const page = TUTORIAL_PAGES[tutorialPage]!;
  el.tutorialTitle.textContent = page.title;
  el.tutorialSub.textContent = page.sub;
  el.tutorialStep.textContent = `${tutorialPage + 1} / ${total}`;
  el.tutorialBody.innerHTML = page.html;
  // 翻页后回到顶部，别让玩家停在上页滚到一半的位置
  el.tutorialBody.scrollTop = 0;

  el.tutorialDots.replaceChildren();
  for (let i = 0; i < total; i++) {
    const dot = document.createElement('span');
    dot.className = `tutorial-dot${i === tutorialPage ? ' on' : ''}`;
    el.tutorialDots.appendChild(dot);
  }

  el.tutorialPrev.disabled = tutorialPage === 0;
  el.tutorialPrev.style.visibility = tutorialPage === 0 ? 'hidden' : 'visible';
  el.tutorialNext.textContent = tutorialPage === total - 1 ? '开始游戏' : '下一页';
}

function openTutorial(index = 0): void {
  tutorialPage = clampTutorialPage(index);
  renderTutorial();
  el.tutorialOverlay.classList.remove('hidden');
}

function closeTutorial(): void {
  el.tutorialOverlay.classList.add('hidden');
  // 关掉就算看过了（不管是翻到最后还是中途退出 —— 再弹一次只会更烦）
  markTutorialSeen();
}

el.tutorialOpen.addEventListener('click', () => openTutorial(0));
el.tutorialClose.addEventListener('click', closeTutorial);
el.tutorialPrev.addEventListener('click', () => {
  tutorialPage = clampTutorialPage(tutorialPage - 1);
  renderTutorial();
});
el.tutorialNext.addEventListener('click', () => {
  if (tutorialPage >= tutorialPageCount() - 1) {
    closeTutorial();
    return;
  }
  tutorialPage = clampTutorialPage(tutorialPage + 1);
  renderTutorial();
});
el.tutorialOverlay.addEventListener('click', (event) => {
  if (event.target === el.tutorialOverlay) closeTutorial();
});
window.addEventListener('keydown', (event) => {
  if (el.tutorialOverlay.classList.contains('hidden')) return;
  /*
    ★ 这里**不能** `stopImmediatePropagation` —— 和 0.3.4 关图鉴那次不一样：
    教程是"盖在最上层的一屏说明"，而 Esc 在这套界面里的语义是"关掉浮层"。
    把所有监听都吃掉的话，头像选择器等浮层的 Esc 就失灵了（实测踩过）。
    箭头的翻页只在教程开着时才有意义，那两个键照旧拦掉。
  */
  if (event.key === 'Escape') {
    closeTutorial();
    return;
  }
  if (event.key === 'ArrowRight') {
    if (tutorialPage < tutorialPageCount() - 1) {
      tutorialPage += 1;
      renderTutorial();
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  } else if (event.key === 'ArrowLeft') {
    tutorialPage = clampTutorialPage(tutorialPage - 1);
    renderTutorial();
    event.preventDefault();
    event.stopImmediatePropagation();
  }
});

// 第一次打开游戏：自动弹一次
if (shouldAutoOpenTutorial()) openTutorial(0);

/*
  ★ 0.3.2：「退出游戏」
  ============================================================
  【为什么按钮默认是 hidden，要运行时才亮出来？】
  因为只有"用启动器打开的那一页"才拿得到令牌。局域网里的朋友页面也开着，
  但他们的地址里没有 `?quit=` —— 后台是**房主那台机器**的进程，
  他们点了也没用（服务端还会再查一次是不是本机发来的）。
  所以判据就一条：地址里有没有合法的令牌。

  【为什么要二次确认，而且要强调"联机时会断"？】
  这个按钮会**关掉整个后台**，房主一点，房间里所有人的对局立刻断。
  它旁边就是「设置」，很容易点歪。
*/
const quitToken = quitTokenFrom(location.search);
if (quitToken) {
  el.menuQuit.classList.remove('hidden');
}

el.menuQuit.addEventListener('click', () => {
  askConfirm(
    '退出游戏',
    '会关掉游戏后台服务。<br>' +
      '<span style="opacity:.75">如果你正开着一个房间，房间里的人会掉线。</span><br>' +
      '退出后想再玩，重新双击「启动游戏」就行。',
    '退出',
    () => {
      void (async () => {
        const ok = await requestQuit(quitToken);
        if (ok) {
          /*
            ★ 成功之后**不跳转、不刷新** —— 后台一退这个页面就连不上了，
              强行 reload 只会得到一个"无法访问"的错误页，看着像崩溃。
              改成把界面替换成一句明确的话，玩家才知道"是我自己关的"。
          */
          document.body.innerHTML =
            '<div style="position:fixed;inset:0;display:flex;flex-direction:column;' +
            'align-items:center;justify-content:center;gap:14px;background:#0b0c0e;' +
            'color:#e8e8e8;font-family:inherit;text-align:center;padding:24px">' +
            '<div style="font-size:20px">游戏已经关闭</div>' +
            '<div style="font-size:13px;opacity:.6">可以关掉这个标签页了。想再玩就重新双击「启动游戏」。</div>' +
            '</div>';
        } else {
          toast('没能关掉后台（可能已经退出了），可以手动关闭这个标签页', true);
        }
      })();
    },
  );
});

el.menuCreateBack.addEventListener('click', () => showMenuButtons());
el.menuJoinBack.addEventListener('click', () => showMenuButtons());

/*
  ★★ 0.3.3：隐藏式头像面板的三条开合路径（用户口径"头像选择改为隐藏式"）
  ============================================================
  ① 点底部工具条那颗「头像」块 -> 打开；
  ② 右上角 ✕ / Esc / 点面板外面（遮罩）-> 关闭。
  ★ 只切 `.hidden`，不重建内容：`renderAvatarPicker()` 早就把 200 多张头像
    铺好了，每次打开重画一遍会让整面墙闪一下（图片重新解码）。
  ★ 打开时把焦点丢给面板本身（`tabindex="-1"` 在 CSS 里给了），
    这样 Esc 才落在面板上，而不是先被输入框吃掉。
*/
function openAvatarPicker(): void {
  el.avatarPicker.classList.remove('hidden');
  el.avatarOpen.setAttribute('aria-expanded', 'true');
  // 让"已经选中的那个格子"滚到视野里 —— 200 多张里手动找自己那张很痛苦
  const selected = el.avatarGrid.querySelector<HTMLElement>('.avatar-option.selected');
  selected?.scrollIntoView({ block: 'nearest' });
}

function closeAvatarPicker(): void {
  el.avatarPicker.classList.add('hidden');
  el.avatarOpen.setAttribute('aria-expanded', 'false');
}

el.avatarOpen.addEventListener('click', () => {
  if (el.avatarPicker.classList.contains('hidden')) openAvatarPicker();
  else closeAvatarPicker();
});
el.avatarClose.addEventListener('click', closeAvatarPicker);
// 点遮罩自己（内层 .avatar-card 上的点击不算）
el.avatarPicker.addEventListener('click', (event) => {
  if (event.target === el.avatarPicker) closeAvatarPicker();
});
window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (el.avatarPicker.classList.contains('hidden')) return;
  closeAvatarPicker();
});

/*
  ★ 0.3.4 图鉴 + 组队器：三条关闭路径，和头像选择器**完全一致**
  ① 入口按钮再点一次 · ② 右上角 ✕ · ③ 点遮罩自己 + Esc。
  （第 ③ 条判 `event.target === el.codexOverlay` —— 点内层卡片不该关。）
*/
el.codexOpen.addEventListener('click', () => {
  if (el.codexOverlay.classList.contains('hidden')) openCodex();
  else closeCodex();
});
el.codexClose.addEventListener('click', closeCodex);
el.codexOverlay.addEventListener('click', (event) => {
  if (event.target === el.codexOverlay) closeCodex();
});
window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (el.codexOverlay.classList.contains('hidden')) return;
  closeCodex();
  /*
    ★ 0.3.4：把这次 Esc 吃掉 —— 否则游戏内那个 keydown 监听还会接着跑，
    顺手把"取消拖动 / 取消选中"也做掉。玩家的心智是"Esc 关掉图鉴，就这一件事"。
    （`stopImmediatePropagation` 挡的是**同一个 window 上后注册**的监听，
     也就是 main.ts 末尾那个游戏快捷键处理器。）
  */
  event.stopImmediatePropagation();
});

/**
 * ★ 0.1.4：「加入房间」页里的「断线重连恢复」。
 *
 * 【它补的是什么？】
 * 自动回座（以及"本机正在对局中"那个浮层）都建立在"启动时那次会话探测读到了本机进程"
 * 之上，而那一步在真实环境里有可能读不到：
 *   · 刚双击「启动游戏」，进程正忙着把 `web/` 下几百个素材发出去，探测超时；
 *   · 页面不是本机进程发的（走隧道、点房主发的链接）—— 那个接口压根不存在。
 * 一旦读不到，以前玩家就**什么提示都收不到、也没有任何入口能自己试一次**，
 * 只能重新输入房间号 —— 而那个号他多半早忘了。
 *
 * 【它为什么一直显示（不像右下角那颗会自己隐藏）？】
 * 因为"要不要显示"的依据同样来自那次可能失败的探测。让它一直在这儿，
 * 至于有没有可恢复的对局，由**点下去之后这一句实话**来回答 —— 这才是兜底的兜底。
 */
el.menuJoinRecover.addEventListener('click', async () => {
  // 先重新问一次进程：别的标签页可能刚退出，手上那份"本机忙"会过时
  if (machineSessionAvailable()) await refreshMachineSession();
  const session = getMachineSession();
  if (!session && !net.canResume) {
    toast('这台机器上没有「没打完的对局」记录 —— 直接填房间号加入就行', true);
    return;
  }
  // 本机另一个标签页还在玩 -> 先问一句（点「接管」之后走的是同一条重连）
  if (machineBusy()) {
    warnLocalMatchBusy();
    return;
  }
  toast('正在尝试回到原来那一局…');
  resumeMachineMatch();
});
el.menuSettingsBack.addEventListener('click', () => showMenuButtons());

/** 连服务器（如果还没连上的话） */
function ensureConnected(): void {
  // ★ 0.1.2：连之前先把"本机会话"里那枚令牌装上（幂等）—— 没有它发不出 resume
  net.loadMachineToken();
  if (!net.connected) {
    setNetStatus('正在连接服务器…', '');
    net.connect();
  }
}

/**
 * ★ 0.1.3：「回到原来那一局」的统一入口 —— 先把服务器地址对上，再连。
 *
 * ============================================================
 *  【修的这条 bug：重开浏览器后点「接管这一局」什么都没发生】
 * ============================================================
 * 重连令牌由**本机进程**保管（见 net/machine-session.ts），里面记着它属于哪台服务器。
 * 但重开浏览器之后 `net.url` 会回到**默认值**（当前页面主机 :8787），
 * 而 `readMachineToken()` 只在"地址和令牌记的那台对得上"时才交令牌。
 *
 *   · 房主那台：默认值恰好就是自己的地址 —— 所以这条 bug 在他那儿看不出来；
 *   · 客人那台：当初是用**房间号**找到房主的局域网地址连过去的
 *     （`ws://192.168.x.x:8787`，见 menuJoinGo），重开之后默认值变回自己的
 *     localhost:8787 ⇒ 地址对不上 ⇒ **一个令牌都读不到** ⇒ `resume` 根本发不出去。
 *
 * 于是握手一切正常、界面也不报错，只是**没有任何人认领那个座位** ——
 * 玩家看到的就是"弹了浮层、点了接管、然后什么都没有"。
 *
 * 所以恢复流程的第一步必须是"先把地址恢复成当初连的那一台"，再谈重连。
 * （幂等：地址本来就对的话 `setServerUrl` 是个空操作。）
 */
function resumeMachineMatch(): void {
  const session = getMachineSession();
  if (session?.serverUrl && session.serverUrl !== net.url) {
    net.setServerUrl(session.serverUrl);
  }
  ensureConnected();
  /*
    ★★ 0.2.1：**连着、但身份没换回来**也要真的重来一次。
    这种情形很常见：连接比令牌先就绪（令牌是本机进程异步读回来的 / 刚 setServerUrl
    换了地址），于是那条连接上根本没发过 `resume` —— 之后点「回到对局」
    走 `ensureConnected()`，它看 `connected === true` 就什么都不做了。
    玩家看到的就是"点了没反应"（令牌明明还在手上）。
  */
  if (net.connected && !net.room && net.canResume) net.retryResume();
  /*
    ★ 0.1.4：连是连上了，但**手上没有令牌**的话，这条连接谁也认领不了 ——
    握手一切正常、界面也不报错，玩家看到的就是"点了没反应"。
    以前这里彻底静默（用户报的"点接管什么都没发生"就是这个观感），
    现在至少把话说清楚，并指向那个可以手动再试一次的入口。
  */
  if (session && !net.canResume && !netplayActive) {
    toast('这台机器上有一局没打完，但重连令牌取不出来 —— 可以到「加入房间」里点「断线重连恢复」再试一次', true);
  }
}

/**
 * ★ 0.3：读一个昵称输入框 —— 洗 -> 校验 -> 返回能发给服务器的名字。
 *
 * 不合法时自己弹提示、把焦点放回输入框，并返回 null（调用方直接 return）。
 *
 * 【为什么客户端也要校验一遍？】
 * 判据唯一在服务端，但"填完名字、点了创建、等一个来回才被告知名字不行"很难受。
 * 这里的规则来自 `shared/names.ts`，和服务端**是同一份**，不会漂。
 * ★ 客户端这一遍只是"提前告知"，**不是安全边界** —— 服务端那边照样会拒。
 */
let lastFocusedNameInput: HTMLInputElement | null = null;

function readNameInput(input: HTMLInputElement, fallback: string): string | null {
  // 一开始建房/进房流程，就说明上一次改名的"待确认"已经过期了 —— 清掉它，
  // 免得等下来一条 NAME_TAKEN 把那个早就该忘掉的改名弹窗又翻出来。
  pendingRename = null;
  /*
    ★ 先记住这个输入框，**不管校验过不过**。
    "名字不合格"的时候要弹窗，弹窗关掉之后得把焦点还给玩家刚才填的那个框 ——
    只在成功时才记的话，关掉弹窗焦点就丢了，玩家还得自己再点一下。
  */
  lastFocusedNameInput = input;
  const raw = (input.value || '').trim() || fallback;
  const name = sanitizePlayerName(raw);
  const problem = playerNameError(name);
  if (problem) {
    /*
      ★★ 0.3 修：这里以前只弹一条 toast —— 玩家在建房面板里填名字，视线在输入框上，
      那条小字 1.5 秒就没了，表现就是"名字不合格完全没提示"（用户报的第 4 条）。
      现在改成弹窗，并写清规则；焦点由弹窗关闭时还给这个框。
    */
    showNameAlert(problem);
    return null;
  }
  return name;
}

el.menuCreateGo.addEventListener('click', async () => {
  // ★ 0.1.3：版本不一致就别开始了（服务端也会拒，这里先给个明确提示）
  if (net.versionMismatch) {
    warnVersionMismatch();
    return;
  }
  // ★ 0.1.2：本机已经有另一个标签页在玩 -> 拦下来（"一台机器一个玩家"）
  if (machineSessionAvailable()) {
    await refreshMachineSession();
    if (machineBusy()) {
      warnLocalMatchBusy();
      return;
    }
  }
  const name = readNameInput(el.menuNameCreate, '房主');
  if (!name) return;
  el.menuNameCreate.value = name;
  ensureConnected();
  // 头像一起带上：服务器存下来给房间里其他人看（需求第 16 条）
  if (!net.createRoom(name, myAvatarId)) toast('还没连上服务器，稍等一下再试', true);
});

/**
 * ★ 0.0.3 末：**用房间号加入房间**（便携包联机的入口）。
 *
 * ============================================================
 *  【为什么这里要"先找后连"？】
 * ============================================================
 * 便携包那套玩法里，朋友的浏览器默认连的是**他自己**那台机器上的服务器。
 * 要进我的房间，就得连到**我**这台机器 —— 但他手上只有一个房间号。
 *
 * 所以流程是：
 *   1. 先确保连上"自己这台机器"的服务器（用它能问出局域网里有哪些房间）；
 *   2. 问一句 `lanScan`（服务器在局域网里听到了主机的广播，见 server/src/lan.ts），
 *      把房间号换成 `192.168.x.x:8787` 这样一个地址；
 *   3. 换地址重连过去（`setServerUrl` 会断开再连，`joinRoom` 设的 pendingAction
 *      会在连上之后自动补发，所以这里不用自己等事件）；
 *   4. 要是局域网里没找到（比如少数组网工具拦了广播），就退回"在当前服务器上
 *      直接 joinRoom" —— 房主和客人同一台电脑测试时走的正是这条路。
 *
 * 【为什么找不到时不是直接报错就完了？】
 * 因为"没找到"有可能是广播还没到（最多 1.5 秒），也可能是网络真的不通。
 * `findLanRoom` 会在 2.6 秒里扫两三次；真找不到时给出**能照着做**的提示，
 * 而不是一句"加入失败"。
 */
el.menuJoinGo.addEventListener('click', async () => {
  // ★ 0.1.3：版本不一致就别开始了（服务端也会拒，这里先给个明确提示）
  if (net.versionMismatch) {
    warnVersionMismatch();
    return;
  }
  // ★ 0.1.2：本机已经有另一个标签页在玩 -> 拦下来（"一台机器一个玩家"）
  if (machineSessionAvailable()) {
    await refreshMachineSession();
    if (machineBusy()) {
      warnLocalMatchBusy();
      return;
    }
  }
  const name = readNameInput(el.menuNameJoin, '玩家');
  if (!name) return;
  const code = (el.menuCode.value || '').trim().toUpperCase();
  el.menuNameJoin.value = name;
  if (code.length !== ROOM_CODE_LENGTH) {
    toast(`房间号是 ${ROOM_CODE_LENGTH} 位，比如 A7K2M9`, true);
    return;
  }

  setNetStatus('正在查找房间…', '');
  ensureConnected();

  // 等"连上本机服务器"（最多 3 秒）—— 没连上就问不了局域网
  const deadline = Date.now() + 3000;
  while (!net.connected && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  if (!net.connected) {
    toast('还没连上本机服务器，稍等一下再试', true);
    setNetStatus('没连上本机服务器', 'error');
    return;
  }

  const found = await net.findLanRoom(code);
  if (found) {
    const target = `ws://${found.address}`;
    setNetStatus(`正在加入「${found.hostName}」的房间（${found.address}）…`, '');
    if (target !== net.url) net.setServerUrl(target);
    // 换地址会断开重连；joinRoom 记在 pendingAction 里，连上就自动补发
    if (!net.joinRoom(code, name, myAvatarId)) {
      toast('正在连接房主的机器，连上就自动进房间', false);
    }
    // 兜底：万一一直连不上（防火墙/不同网段），把话说明白
    window.setTimeout(() => {
      if (!net.room) {
        setNetStatus(`没能连上房主的机器（${found.address}）。检查防火墙，或者让房主在设置里告诉你 IP。`, 'error');
      }
    }, 8000);
    return;
  }

  // 局域网里没找到：也许就是本机的房间（同一台电脑双开测试）
  if (!net.joinRoom(code, name, myAvatarId)) {
    toast('还没连上服务器，稍等一下再试', true);
    setNetStatus('没连上服务器', 'error');
    return;
  }
  setNetStatus('正在加入房间…', '');
  window.setTimeout(() => {
    if (!net.room) {
      toast('没找到这个房间：确认房主已经创建房间、两台机器在同一个局域网（或用 Radmin/UU 组网）', true);
      setNetStatus('没找到该房间', 'error');
    }
  }, 1200);
});

// ============================================================
//  ★★ 0.3.3 局域网房间列表（用户口径：自动搜索；已开局的看得见、进不去）
// ============================================================

/** 面板开着时每 2 秒搜一次；关掉就停（别让一个看不见的页面一直发包） */
const LAN_POLL_MS = 2000;
let lanPollTimer = 0;
/** 订阅只建一次（`net` 是模块级单例，重进页签不用重复订） */
let lanUnsubscribe: (() => void) | null = null;

/** 列表里的状态文案（唯一实现：卡片和状态条都用它） */
function lanRoomStateOf(entry: LanRoomInfo, token: string): {
  /** 已经开打了（不能当新人进） */
  started: boolean;
  /** 满了 */
  full: boolean;
  /** 对方版本和本机不同（根本进不去） */
  mismatch: boolean;
  /** 这一局里还有我的座位 */
  mine: boolean;
  /** 一行小字 */
  text: string;
  /** 按钮上写什么；空串 = 不给按钮（只显示状态） */
  action: 'join' | 'resume' | '';
} {
  const started = (entry.phase ?? 'lobby') !== 'lobby';
  const full = entry.maxPlayers > 0 && entry.players >= entry.maxPlayers;
  const mismatch = Boolean(entry.version) && entry.version !== SERVER_VERSION;
  const mine = token !== '';
  const where = started ? `进行中 · 第 ${entry.round ?? 0} 回合` : '等待中';
  const text = `${entry.players} / ${entry.maxPlayers} · ${where}`;
  if (mismatch) return { started, full, mismatch, mine, text: `版本不同（${entry.version}）`, action: '' };
  /*
    ★ 「回到对局」优先于一切：
    有座位的人哪怕房间满了、哪怕已经开打，都应该能回去 —— 那本来就他的位子。
  */
  if (mine) return { started, full, mismatch, mine, text, action: 'resume' };
  if (started) return { started, full, mismatch, mine, text, action: '' };
  if (full) return { started, full, mismatch, mine, text: `已满 · ${where}`, action: '' };
  return { started, full, mismatch, mine, text, action: 'join' };
}

/** 造一行（只在这里拼 HTML） */
function buildLanRoomRow(entry: LanRoomInfo): HTMLElement {
  const url = `ws://${entry.address}`;
  const token = findResumeTarget(url, entry.code);
  const state = lanRoomStateOf(entry, token);

  const row = document.createElement('div');
  row.className = `lan-room${state.action === '' ? ' dim' : ''}${state.mine ? ' mine' : ''}`;
  row.dataset.code = entry.code;
  row.innerHTML = `
    <span class="lan-room-code mono">${escapeHtml(entry.code)}</span>
    <span class="lan-room-info">
      <span class="lan-room-host">${escapeHtml(entry.hostName || '房主')}</span>
      <span class="lan-room-meta">${escapeHtml(state.text)}</span>
    </span>
  `;

  if (state.action === '') {
    const chip = document.createElement('span');
    chip.className = 'lan-room-lock';
    chip.textContent = state.mismatch ? '版本不同' : state.started ? '已开局' : '已满';
    row.appendChild(chip);
    return row;
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.className = `lan-room-btn${state.action === 'resume' ? ' resume' : ''}`;
  button.textContent = state.action === 'resume' ? '回到对局' : '加入';
  button.title =
    state.action === 'resume'
      ? `你在这局里还有座位，点一下回到第 ${entry.round ?? 0} 回合`
      : `进入「${entry.hostName || '房主'}」的房间`;
  button.addEventListener('click', () => {
    if (state.action === 'resume') resumeLanRoom(entry, token);
    else enterLanRoom(entry);
  });
  row.appendChild(button);
  return row;
}

/** 渲染列表（`renderKeyed`：每 2 秒刷一次，不能整块重建 —— 否则按钮上的 hover 会一直重放） */
function renderLanRooms(rooms: readonly LanRoomInfo[]): void {
  // 排序：能进的在前 → 人多的在前 → 房间号（顺序稳定，不会每 2 秒跳一次）
  const sorted = [...rooms].sort((a, b) => {
    const rank = (entry: LanRoomInfo): number => {
      const state = lanRoomStateOf(entry, findResumeTarget(`ws://${entry.address}`, entry.code));
      if (state.action === 'resume') return 0;
      if (state.action === 'join') return 1;
      return 2;
    };
    const diff = rank(a) - rank(b);
    if (diff !== 0) return diff;
    if (b.players !== a.players) return b.players - a.players;
    return a.code.localeCompare(b.code);
  });

  renderKeyed(el.lanRoomsList, sorted, {
    key: (entry) => `${entry.address}|${entry.code}`,
    /*
      签名 = 所有影响这一行长相的输入。
      ★ 令牌算"有没有座位"，**也**要进签名：别处重连成功/失败会改它，
        不改签名的话这一行会一直显示上一个状态（回到对局 / 已开局）。
    */
    sig: (entry) => {
      const token = findResumeTarget(`ws://${entry.address}`, entry.code);
      const state = lanRoomStateOf(entry, token);
      return [
        entry.code,
        entry.hostName,
        entry.players,
        entry.maxPlayers,
        entry.phase ?? 'lobby',
        entry.round ?? 0,
        entry.version ?? '',
        state.action,
        state.text,
      ].join('|');
    },
    build: buildLanRoomRow,
  });

  /*
    ★ 0.3.3：状态文案的优先级是"有结果先报结果"。
    断线但手上还有上一轮的结果时，报"4 间"比报一句红色"没连上"有用得多
    （那份列表仍然是可用的 —— 地址是上次听来的，点进去还能连）。
  */
  const offline = !net.connected;
  el.lanRoomsEmpty.classList.toggle('hidden', sorted.length > 0);
  el.lanRoomsState.textContent =
    sorted.length > 0 ? `${sorted.length} 间` : offline ? '没连上本机服务器' : '搜索中…';
  el.lanRoomsState.classList.toggle('error', offline && sorted.length === 0);
}

/**
 * ★★ 0.3.3：为"搜索房间"安静地连一次本机服务器。
 *
 * 【为什么不能直接 `ensureConnected()`？】
 * `connect()` 一旦连上就会带着 `machine-session` 里那枚令牌发 `resume`
 * —— 如果本机**另一个标签页正在对局**，这一下正好把它顶掉（`replaced`，对面被踢回大厅）。
 * 所以先用和"点加入"同一道闸：本机有别的标签页在玩就**不连**（连了也只是白抢）。
 *
 * ★ 返回 false 不代表出错了：此时列表会显示"没连上本机服务器"，
 *   玩家真正点房间/点加入时仍会走完整流程（那里还有一次同样的闸）。
 */
async function connectForLanScan(): Promise<boolean> {
  if (net.connected) return true;
  if (machineSessionAvailable()) {
    await refreshMachineSession();
    if (machineBusy()) return false;
  }
  ensureConnected();
  const deadline = Date.now() + 3000;
  while (!net.connected && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  return net.connected;
}

/** 开始/停止轮询（面板打开时开，关掉就停） */
function startLanPolling(): void {
  if (!lanUnsubscribe) lanUnsubscribe = net.onLanRoomsChange(renderLanRooms);
  stopLanPolling();
  // 先试着连上（有别的标签页在玩就不连，见 connectForLanScan 的说明）
  void connectForLanScan().then((ok) => {
    if (!ok || !lanPollTimer) return;
    net.lanScan();
    renderLanRooms(net.lanRooms);
  });
  // 定时只做"扫"，不重试连接：连接是用户动作（或面板打开时那一次）
  lanPollTimer = window.setInterval(() => {
    if (net.connected) net.lanScan();
  }, LAN_POLL_MS);
  renderLanRooms(net.lanRooms);
}

function stopLanPolling(): void {
  if (lanPollTimer) {
    window.clearInterval(lanPollTimer);
    lanPollTimer = 0;
  }
}

/** 从列表进一间房（地址已知，不用再按房间号去找） */
function enterLanRoom(entry: LanRoomInfo): void {
  if (net.versionMismatch) {
    warnVersionMismatch();
    return;
  }
  const name = readNameInput(el.menuNameJoin, '玩家');
  if (!name) return;
  el.menuNameJoin.value = name;
  const target = `ws://${entry.address}`;
  setNetStatus(`正在加入「${entry.hostName || '房主'}」的房间（${entry.address}）…`, '');
  stopLanPolling();
  if (target !== net.url) net.setServerUrl(target);
  if (!net.joinRoom(entry.code, name, myAvatarId)) {
    toast('正在连接房主的机器，连上就自动进房间', false);
  }
  window.setTimeout(() => {
    if (!net.room) {
      setNetStatus(`没能连上房主的机器（${entry.address}）。检查防火墙，或者让房主在设置里告诉你 IP。`, 'error');
    }
  }, 8000);
}

/**
 * 「回到对局」：带着**多槽索引里那枚令牌**换回座位。
 *
 * ★ 和"断线重连恢复"那颗按钮的区别：那颗只认 `machine-session`（本机最后一次），
 *   这颗认 `resume-index`（我今晚在几个人家里都开过局）。
 */
function resumeLanRoom(entry: LanRoomInfo, token: string): void {
  const target = `ws://${entry.address}`;
  setNetStatus(`正在回到「${entry.hostName || '房主'}」的第 ${entry.round ?? 0} 回合…`, '');
  stopLanPolling();
  if (!net.resumeInto(target, token)) {
    toast('这枚重连凭据不能用了，等下一局吧', true);
    return;
  }
  window.setTimeout(() => {
    if (!net.room) {
      setNetStatus('没能回到那一局 —— 座位可能已经被释放（掉线超过 5 分钟），等下一局吧。', 'error');
    }
  }, 9000);
}

/*
  ★★ 0.3.3：局域网房间列表的**预览钩子**（只有 `?debug=1` 才有）。
  【为什么需要？】这四个状态（可加入 / 已开局 / 已满 / 版本不同）要看到就得
  真的凑出四台机器、其中一台还得开着局 —— 人肉和 e2e 都不现实。
  这个钩子只做一件事：往 `net.lanRooms` 塞一份演示数据再重画，
  **不伪造网络消息、不改任何联机逻辑**（正常玩永远走不到这里）。
*/
if (new URLSearchParams(location.search).has('debug')) {
  (globalThis as unknown as Record<string, unknown>)['__airnightPreviewLanRooms'] = (): number => {
    const demo: LanRoomInfo[] = [
      {
        code: 'A7K2M9',
        hostName: '阿米娅',
        players: 2,
        maxPlayers: MAX_PLAYERS_PER_ROOM,
        address: '192.168.1.5:8787',
        phase: 'lobby',
        round: 0,
        version: SERVER_VERSION,
      },
      {
        code: 'B8L3N0',
        hostName: '陈 · 赤刃明霄',
        players: 5,
        maxPlayers: MAX_PLAYERS_PER_ROOM,
        address: '192.168.1.6:8787',
        phase: 'battle',
        round: 7,
        version: SERVER_VERSION,
      },
      {
        code: 'C9M4P1',
        hostName: '凯尔希',
        players: 8,
        maxPlayers: MAX_PLAYERS_PER_ROOM,
        address: '192.168.1.7:8787',
        phase: 'lobby',
        round: 0,
        version: SERVER_VERSION,
      },
      {
        code: 'D1N5Q2',
        hostName: '隔壁的老版本',
        players: 1,
        maxPlayers: MAX_PLAYERS_PER_ROOM,
        address: '192.168.1.8:8787',
        phase: 'lobby',
        round: 0,
        // ★ 故意写一个**旧版本**串：用来验证列表会把它标成"版本不同"且不给按钮
        version: '0.3.2正式版',
      },
    ];
    net.lanRooms = demo;
    renderLanRooms(demo);
    return demo.length;
  };
}

// 手动刷新一次（自动每 2 秒已经在跑，这颗只是让人"点一下安心"）
el.lanRoomsRefresh.addEventListener('click', () => {
  void connectForLanScan().then((ok) => {
    if (!ok) {
      toast('本机另一个标签页正在对局，没法搜索房间', true);
      return;
    }
    net.lanScan();
    renderLanRooms(net.lanRooms);
  });
});

// 输入框里敲回车直接提交（少点一次鼠标）
el.menuNameCreate.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') el.menuCreateGo.click();
});
/*
  ★ 0.0.3 末：房间号输入框**边输边规范**。
  移动端输入法很容易带出小写、空格、甚至全角字符，而房间号只有
  "去掉易混字符的大写字母+数字" 这一套 —— 与其让玩家对着"房间号不对"猜，
  不如直接把非法字符吃掉（顺便自动大写）。粘贴一整条链接也能被切成合法字符。
*/
el.menuCode.addEventListener('input', () => {
  const cleaned = el.menuCode.value
    .toUpperCase()
    .split('')
    .filter((char) => CODE_ALPHABET.includes(char))
    .join('')
    .slice(0, ROOM_CODE_LENGTH);
  if (cleaned !== el.menuCode.value) el.menuCode.value = cleaned;
});
el.menuCode.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') el.menuJoinGo.click();
});
el.menuNameJoin.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') el.menuJoinGo.click();
});

el.menuSettingsSave.addEventListener('click', () => {
  const normalized = normalizeServerInput(el.menuServer.value);
  if (normalized.length === 0) {
    toast('服务器地址不能为空', true);
    return;
  }
  /*
    存之前先看一眼"这个地址在当前页面上有没有可能连上"。
    HTTPS 网页 + ws:// 是浏览器**直接拦掉**的，连都不会连 ——
    与其等你点了联机、看到"正在重连…"再去查，不如现在就说清楚。
    （仍然允许保存：也许你只是在这里填一下，真正的对局在别的页面。）
  */
  const problem = serverUrlProblem(normalized);
  net.setServerUrl(normalized);
  rememberServerUrl(normalized);
  el.menuServer.value = normalized.replace(/^wss?:\/\//, '');
  setNetStatus(problem ?? `服务器地址已设为 ${normalized}`, problem ? 'error' : '');
  toast(problem ? '地址已保存，但它可能连不上（看下方红字）' : '服务器地址已保存', Boolean(problem));
  showMenuButtons();
});

// ---------------- 房间等待界面 ----------------

el.btnLobbyReady.addEventListener('click', () => {
  const me = net.room?.players.find((p) => p.id === net.playerId);
  net.setReady(!me?.ready);
});
el.btnLobbyStart.addEventListener('click', () => net.startGame());
el.btnLobbyLeave.addEventListener('click', () => leaveNetplay());

/*
  ★★ 0.3.3：房主「添加人机」。
  ★ 按钮只管发一条申请 —— 能不能加（座位 / 人机名额 / 阶段）由服务端裁决，
    失败时会回一条 `error`（客户端统一 toast 出来）。
*/
el.btnAddBot.addEventListener('click', () => {
  const difficulty = el.lobbyBotDifficulty.value as BotDifficulty;
  if (!net.addBot(difficulty)) toast('没连上服务器，加不了人机', true);
});

// ---------------- 重置与模式切换 ----------------

/**
 * 把「棋盘摆放 + 战斗演出」这几样回到干净状态。
 *
 * 【为什么要单独抽一个函数？】
 * 因为「开始新一局」和「切换模式」都需要重置这几样东西。
 * 之前这段代码散在两处，改一处忘一处很容易出问题 ——
 * 比如切换模式时忘了清掉上一局的战斗演出。
 */
/**
 * 把这一局的战斗演出 / 日志 / 统计一起清回"干净状态"。
 *
 * 【为什么要单独抽一个函数？】
 * 因为「开始新一局」和「切换模式」都需要重置这几样东西。
 * 之前这段代码散在两处，改一处忘一处很容易出问题 ——
 * 比如切换模式时忘了清掉上一局的战斗演出。
 *
 * ============================================================
 *  ★ 0.0.3：`keepLastBattleView` —— "日志保留到下一回合的布阵阶段"
 * ============================================================
 * 需求原文：「调整日志，日志保留到下一回合的布阵阶段（野怪回合后还是显示掉落）」。
 *
 * 之前**每进一个新回合**都会走这个函数，于是 `el.log` 被清空 ——
 * 玩家一进入下一回合的布阵阶段，上一场（尤其是野怪回合）的掉落记录就没了，
 * 只能靠记忆确认"这回合掉了什么"。
 *
 * 现在把"清日志"从"重置棋盘"里拆出来（默认仍然清，只有回合推进时传 true 保留）：
 *   · 回合推进（nextRound）      -> 传 true：上一场战报 + 本回合掉落一起留在面板上
 *   · 开新局 / 退出房间 / 断线    -> 不传：清干净（否则新一局还挂着上局的伤害表）
 * 真正的清空时机变成"**下一场战斗开始**"（startBattle / startTestBattle 里那句
 * `el.log.innerHTML = ''`，本来就有），也就是日志从"打完一直留到下次开打"。
 */
function resetBoardAndPlayback(options: { keepLastBattleView?: boolean } = {}): void {
  window.clearTimeout(nextRoundTimer);
  /*
    拖动也要取消掉。
    【为什么？】拖动时棋子层里会多一个"跟着鼠标的预览精灵"（drag.preview）。
    如果这时候开战 / 换局 / 切模式，那个精灵就会**永远留在棋盘上** ——
    又是一次"原地多了个贴图"。这里是"回到干净状态"的地方，顺手一起清掉。
  */
  cancelDrag();
  clearPrepSprites();
  replay.clear();
  currentResult = null;
  // ★ 0.3.5：账本一起清（开新局 / 退房 / 断线都要回到"没有上一场"）
  clearMyBattle();
  // 回执要带的 battleId 也是"这一局的残留"，一起清 —— 否则下次会拿旧 id 去举手
  currentBattleId = null;
  // ★ 0.1.2：同一批残留，不清的话新一场战斗会被当成"已经收过尾"
  myBattleDone = false;
  el.battleBar.classList.add('hidden');

  /*
    ★ 只有"不保留上一场战报"时才清日志 / 羁绊日志 / 伤害统计。
    保留的那条路（回合推进）什么都不做 —— 面板上留着上一场的记录，
    接着 appendDropLog 会把本回合的掉落**追加**在后面。
  */
  if (!options.keepLastBattleView) {
    logCursor = 0;
    resetTraitLog();
    el.log.innerHTML = '';

    /*
      ★ 伤害统计也要一起清掉。

      【这里曾经漏了一个】之前只清了日志（el.log）和 currentResult，
      但 `damageStats` 这张表和 `#damage-stats` 那块 DOM 都没动。
      结果是：**退出本局再重新进，上一局的伤害表还挂在那儿**——
      新的一局还没开打，右侧却显示着上局每个干员的输出与承伤。
      看起来像"数据是新的但名字是旧的"，很容易让人以为数值算错了。

      教训：所谓"回到干净状态"必须把**所有跟这一局绑定的东西**一起清，
      漏一个就会以"残留"的形式冒出来。日志、统计、回放、拖动预览
      现在都收在这一个函数里，就是为了下次加东西时只改一处。
    */
    damageStats = new Map();
    statsDirty = false;
    renderDamageStats();
  }

  myTeam = 0;
  /*
    ★ "在看谁的棋盘"也要归零。
    漏掉它会留下一个隐形状态：3D 棋子被 clearPrepSprites() 清了（画面正常），
    但 viewingPlayerId 还指着上局的某个玩家 —— 于是 applySpectateLocks()
    继续把商店藏起来、棋盘点击继续被拦，看起来像"界面卡住了"。
  */
  viewingPlayerId = null;
}

// 快捷键：空格暂停、回车开战
window.addEventListener('keydown', (event) => {
  // 主界面 / 房间界面里不响应游戏内快捷键（免得按 D 之类误触发）
  if (currentView !== 'game') return;
  /*
    ★ 0.3.4：图鉴 / 组队器盖着整个屏幕时，游戏快捷键必须一起失效。
    【为什么必须在这里挡】这几个键走的是 `el.btnXxx.click()`，不是"按钮被挡住了就点不到"。
    实测：开着图鉴按一下 D，真的扣了 2 金刷新商店（toast 弹出「刷新商店（-2 金）」）；
    按 F 会买经验、按空格会暂停、按回车会直接开战 —— 玩家只是在翻图鉴，钱就没了。
    （和第 0.1.1 条"观战/淘汰时快捷键失效"是同一类问题，见下面的 shopLocked。）
  */
  if (!el.codexOverlay.classList.contains('hidden')) return;
  // ★ 0.3.4：正在设置里改快捷键时，这个键只用来绑定，不能顺手把商店刷了
  if (keybindCapture) return;
  // 正在输入框里打字时也不响应（否则打房间码会把棋盘商店刷爆）
  const target = event.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

  /*
    ★ 0.1.1：观战 / 已淘汰时，商店那几个快捷键必须一起失效。
    【为什么不能只靠"按钮被隐藏了"？】
    因为这几个快捷键走的是 `el.btnXxx.click()` —— 元素被 CSS 藏起来照样能触发。
    不在这里挡一下，玩家按住 D 还能刷商店、按 F 还能买经验，
    等于给"已淘汰不能操作"开了个后门。
  */
  const shopLocked = spectateOrEliminated();
  // ★ 0.1.1：D/F/E 这三个商店快捷键在战斗阶段也要能用（判据和按钮同一个）
  const shopUsable = canShopNow(state.phase) && !shopLocked;

  /*
    ★ 0.3.4：快捷键改成**可自定义**（设置面板里改，存 localStorage）。
    这里只做"这个键绑的是哪个动作"，具体怎么处理还是下面那几条。
    ★ Esc **不参与**自定义：它固定是"关闭浮层"，改掉会让玩家在弹窗里出不来。
  */
  const action = actionForKey(keybinds, event.code);

  if (action === 'pause' && state.phase === 'battle') {
    event.preventDefault();
    el.btnPause.click();
  }
  // 开战：**只认布阵阶段**（战斗中本来就没有"开战"这回事）
  if (action === 'startBattle' && state.phase === 'prep' && !el.btnBattle.disabled && !shopLocked) {
    event.preventDefault();
    startBattle();
  }
  if (action === 'refresh' && shopUsable) {
    event.preventDefault();
    el.btnRefresh.click();
  }
  if (action === 'buyXp' && shopUsable) {
    event.preventDefault();
    el.btnBuyXp.click();
  }
  if (action === 'lockShop' && shopUsable) {
    event.preventDefault();
    el.btnLock.click();
  }
  // Esc = 关掉浮层 / 取消拖动 / 取消选中
  if (event.code === 'Escape') {
    // 优先关"最近打开的那个"，这样 Esc 的行为符合直觉
    if (!el.renameOverlay.classList.contains('hidden')) {
      // ★ 0.1.1：改名弹窗排在最前面（它比确认框更"新"）
      closeRenameDialog();
    } else if (!el.confirmOverlay.classList.contains('hidden')) {
      closeConfirm();
    } else if (!el.unitInfo.classList.contains('hidden')) {
      // 看"面板是不是开着"而不是看 unitInfoCell ——
      // 两个状态一旦不一致（比如面板还开着但 cell 被清了），
      // 按 Esc 就会没反应。以看得见的东西为准，永远不会漏。
      closeUnitInfo();
    } else if (!el.traitsDetailView.classList.contains('hidden')) {
      closeTraitDetail();
    } else if (drag) {
      cancelDrag();
    } else if (state.selectedBenchUid !== null) {
      state.selectedBenchUid = null;
      state.message = '取消选择';
      renderAll();
    }
  }
});

// 窗口失焦时（比如切到别的程序）要把拖动收掉，
// 否则预览图会一直"粘"在屏幕上
window.addEventListener('blur', () => cancelDrag());

// ★ 0.1.1：拖动的全局兜底（起点元素被 renderAll 重建时，事件会丢，见 installDragFallback）
installDragFallback();

/**
 * 兜底：整个文档禁掉 HTML5 原生拖放。
 *
 * 【为什么需要这一层？】
 * `<img>` 天生可拖。我们已经在 CSS 里给所有图片加了 `pointer-events: none`
 * （最彻底的修法），但万一以后有人新加了一张图片、或者浏览器行为有差异，
 * 原生拖放会**发出 pointercancel 打断我们的拖动** ——
 * 表现就是"一拖就断，放不下去"，而且非常难查（代码看起来完全正常）。
 * 这里再挡一层，任何元素都不允许被浏览器自己拖走。
 */
document.addEventListener('dragstart', (event) => {
  event.preventDefault();
});
// 顺带把"拖到页面上会打开文件"的默认行为也挡掉（拖拽操作会误触发）
document.addEventListener('dragover', (event) => event.preventDefault());
document.addEventListener('drop', (event) => event.preventDefault());

// ============================================================
//  ★ 右键防护（用户报："浏览器的手势经常误触"）
// ============================================================
/*
  【问题是什么？】
  浏览器（Edge 内置的"按住右键移动鼠标"、各种鼠标手势扩展）的手势都是
  **按住右键画轨迹**。画完之后是在**别的位置**松手的 —— 而 `contextmenu`
  的 target 取的是**松手点**。于是"右键拖着画一下手势"很可能正好落在
  另一个棋子上，被游戏当成"右键卖掉 / 右键收回"，这就是误触。

  【我做了什么？】
    ① 全页面禁掉浏览器右键菜单（输入框除外 —— 那里右键粘贴是有用的）；
    ② 右键按下时 `preventDefault()`，挡掉"被浏览器当成拖拽起点"这一层，
       一部分手势扩展会因此收手；
    ③ ★ 真正解决问题的是这条：**把"右键单击"和"按住右键拖动"分开**。
       只有"按下～松开几乎没动"才算单击才会执行游戏动作；
       拖动了（在画手势）就什么都不做。

  【挡不住什么？—— 这点要说清楚】
  **浏览器内置**的鼠标手势（Edge 的鼠标手势、触控板的"滑动切页"）是在
  浏览器自己那层处理的，网页代码**无法禁用**。那个必须去浏览器设置里关：
    Edge：  地址栏输入  edge://settings/accessibility  → 关掉「鼠标手势」
            或 设置 → 外观 → 浏览器行为和功能 → 「启用鼠标手势」
  这一层只保证"就算手势没关，也不会因此误操作游戏里的棋子"。
*/
const RIGHT_CLICK_SLOP_PX = 6;

let rightDownX = 0;
let rightDownY = 0;
/** 这次右键按下算不算"干净的单击"（移动超过阈值就作废） */
let rightClickArmed = false;

/** 右键目标是不是输入类元素（那里右键菜单是有用的，要放行） */
function isTextEntry(target: EventTarget | null): boolean {
  const node = target as HTMLElement | null;
  if (!node) return false;
  return node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.isContentEditable === true;
}

// ① 全页面禁右键菜单（棋盘/备战席自己还有监听，但页面其它地方的菜单也会打断操作）
window.addEventListener(
  'contextmenu',
  (event) => {
    if (isTextEntry(event.target)) return;
    event.preventDefault();
  },
  { capture: true },
);

// ② 右键按下：记一个起点，并挡掉浏览器把右键当"拖拽/选择起点"的默认行为
window.addEventListener(
  'mousedown',
  (event) => {
    if (event.button !== 2) return;
    if (isTextEntry(event.target)) return;
    rightDownX = event.clientX;
    rightDownY = event.clientY;
    rightClickArmed = true;
    event.preventDefault();
  },
  { capture: true },
);

// ③ 松开时看移动了多远 —— 动了就是在画手势，把"单击"标记作废
window.addEventListener(
  'mouseup',
  (event) => {
    if (event.button !== 2) return;
    if (!rightClickArmed) return;
    if (Math.hypot(event.clientX - rightDownX, event.clientY - rightDownY) > RIGHT_CLICK_SLOP_PX) {
      rightClickArmed = false;
    }
  },
  { capture: true },
);

/**
 * 这次 `contextmenu` 算不算一次"干净的右键单击"？**取用一次就失效**。
 *
 * 【为什么要"取用即失效"？】
 * 一次右键只会产生一次 `contextmenu`，但棋盘和备战席各有一个监听器都想知道答案。
 * 让标记被消费掉，就绝不会出现"一次右键卖掉两个棋子"这种事。
 */
function takePlainRightClick(): boolean {
  const armed = rightClickArmed;
  rightClickArmed = false;
  return armed;
}

/*
  【关于小人动画】
  曾经做过一版「webm 小人视频」的支持（assets/chibi/<id>.webm + 逐帧画进卡片贴图）。
  但你的决定是**就用卡面版立绘**，所以那套代码已经删掉了 ——
  少一条代码路径就少一处可能出问题的地方。
  现在棋盘上的立绘统一是：半身像（assets/stand/<id>.png）→ 头像 → 程序化占位，三级降级。
*/

/**
 * 重新计算 3D 画面的可视区域。
 *
 * 【为什么要量 UI 的尺寸？】
 * 顶部状态栏、左侧羁绊面板、右侧日志、底部商店都是**浮在画布上面**的。
 * 如果相机按整个窗口去框取棋盘，棋盘就会被框进被 UI 遮住的区域 ——
 * 上下两头看不见，「看不到整个竞技场」就是这么来的。
 *
 * 所以这里量出四边被遮住多少，只让 3D 渲染在中间那块空地里。
 * 用 getBoundingClientRect 量真实布局尺寸，而不是猜一个写死的数字 ——
 * 因为面板宽度会随窗口变、还会因为 CSS 媒体查询而变。
 */
function handleResize(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;

  /*
    ★★ 0.3.5：**先**按窗口算好 UI 缩放，**再**去量各面板的尺寸。
    顺序反了的话，量到的是"上一次缩放"的布局 —— 相机会按错的遮挡区域框棋盘
    （表现为棋盘一边被面板压住、另一边空一块）。
    缩放本身讲在 `ui-scale.ts` 与 styles.css 的 `--ui-scale` 那里。
  */
  document.documentElement.style.setProperty('--ui-scale', String(uiScaleFor(width, height)));

  const rectOf = (element: HTMLElement | null): DOMRect | null => {
    if (!element || element.classList.contains('hidden')) return null;
    const rect = element.getBoundingClientRect();
    // 尺寸为 0 说明它其实没显示
    return rect.width > 0 && rect.height > 0 ? rect : null;
  };

  const topBar = rectOf(document.querySelector<HTMLElement>('#topbar'));
  const dock = rectOf(document.querySelector<HTMLElement>('#dock'));
  const traitsPanel = rectOf(document.querySelector<HTMLElement>('#traits'));
  const sidebar = rectOf(document.querySelector<HTMLElement>('#sidebar'));

  // 只在面板确实贴着上/下/左/右边时才把它算成遮挡。
  // 否则（比如日志面板被折叠后跑到中间了）会把可视区域算歪。
  const top = topBar && topBar.top <= 4 ? topBar.bottom : 0;
  const bottom = dock && dock.bottom >= height - 4 ? height - dock.top : 0;
  const left = traitsPanel && traitsPanel.left <= 4 ? traitsPanel.right : 0;
  const right = sidebar && sidebar.right >= width - 4 ? width - sidebar.left : 0;

  // 再留一点呼吸空间，免得棋盘紧贴着面板边缘
  const gap = 8;
  board.resize(width, height, {
    top: top + gap,
    bottom: bottom + gap,
    left: left + gap,
    right: right + gap,
  });
}
window.addEventListener('resize', handleResize);

// ============================================================
// 启动
// ============================================================

handleResize();
renderSpeedButtons();
syncPrepSprites();
// 视角徽标：显示当前倍率（默认 ×1.0），顺便告诉玩家"可以滚轮拉近"
el.zoomHint.classList.remove('hidden');
updateZoomHint();

el.menuServer.value = defaultServerUrl().replace(/^wss?:\/\//, '');
setView('menu');
setNetStatus(`单机模式 · 服务器 ${net.url}`, '');

// 头像：读回上次选的，并把选择器画出来（需求第 16 条）
loadAvatarPreference();
renderAvatarPicker();

renderAll();
requestAnimationFrame(frame);

/*
  ============================================================
  ★ 0.1.2：本机对局会话 —— 启动时的"回家"流程
  ============================================================
  先把本机进程里那份会话读回来，再决定：
    · 没有会话                -> 什么都不做（普通启动）
    · 会话被别的标签页占着     -> 弹浮层，由玩家决定要不要**接管**
    · 会话是我的（或占用已过期）-> 自动连回去
      这就是"不小心关了浏览器，重开还在原来那一局"
  ============================================================
*/
void initMachineSession().then(() => {
  // ★ 0.1.4：会话读回来之后才能判断"本机还有没有一局没打完" -> 顺手刷一下右下角那颗按钮
  renderReconnectButton();
  /*
    ★ 0.1.4：判据放宽成"有会话**或者**手上有令牌"。
    以前只看 `getMachineSession()` —— 而它在"启动那次探测没问到进程"时是 null，
    于是既不弹浮层、也不回座，玩家什么提示都收不到（用户报的"有时不弹提示"）。
    现在 `initMachineSession` 会降级去读 sessionStorage，那条路也能走到这里。
  */
  if (!getMachineSession() && !net.canResume) return;
  if (machineBusy()) {
    showMachineBusyOverlay();
    return;
  }
  setNetStatus('检测到未结束的对局，正在回到房间…', '');
  // ★ 0.1.3：这里是"关掉浏览器再打开"的回座路径 —— 必须先把服务器地址对上
  //   （见 resumeMachineMatch 的说明），否则令牌读不出来、连上也是白连。
  resumeMachineMatch();
});

el.machineBusyTakeover.addEventListener('click', () => {
  hideMachineBusyOverlay();
  // 先把占用抢过来（原来那个标签页会在下一次心跳发现并退出），再连回去
  claimMachineSession();
  toast('已接管，正在回到对局…', false);
  // ★ 0.1.3：同一条路 —— 地址对不上会连到"另外一台服务器"上去，
  //   那样连上了也没有任何座位可以认领，看起来就是"点了没反应"。
  resumeMachineMatch();
});

el.machineBusyStay.addEventListener('click', () => {
  hideMachineBusyOverlay();
});

/*
  ★ 0.1.3：点房间号 = 复制到剪贴板。
  【为什么要做这个？】联机最麻烦的一步就是"把 6 位房间号完整地告诉朋友" ——
  念一遍容易听错、截屏发过去朋友还得手打。点一下就复制，直接粘给对方。
*/
el.lobbyCode.title = '点一下复制房间号';
el.lobbyCode.addEventListener('click', () => {
  const code = net.room?.code;
  if (!code || code === '------') return;
  void copyTextToClipboard(code).then((ok) => {
    // 复制成功就别用红字吓人（toast 第二个参数 true = 报错样式）
    toast(ok ? `房间号 ${code} 已复制，发给朋友就行` : `复制失败，请手动选中「${code}」复制`, !ok);
  });
});

/**
 * 预加载素材。
 *
 * 【为什么要预加载？】
 * 因为「战斗打到一半突然冒出一张立绘」的观感很差。
 * 启动时先把图拉下来，之后就是内存里取。
 *
 * 【不动声色地降级】
 * 你没放素材的话，这里会全部 404 —— 但那是**预期行为**，
 * 程序会继续用代码画的占位图，不会报错也不会白屏。
 * 加载成功后会把棋子重画一遍，换成真立绘。
 */
void initChibi().then(() => {
  // 小人索引是异步来的，到位前后"这个棋子该画成什么样"会变一次，
  // 所以索引一到就把卡片贴图缓存作废、把待机区的棋子重画一遍。
  clearUnitTextureCache();
  syncPrepSprites();
});

/*
  ★ 0.2：维什戴尔 3 星大招的爆炸特效图（约 4.5 MB）提前开始下载。

  【为什么不跟下面那批一起 await？】
  下面那批是"棋子立绘/头像"，缺了画面会明显不对，所以等它加载完再重画一遍。
  特效图是"打到那一刻才用得上"，晚一点没关系 —— 单独喊一嗓子、不阻塞启动就行。
  等真的开打时它基本已经到了；万一没到，那一炸就是不放（不会报错、不会白屏）。
*/
preloadBloomTextures();
/*
  ★ 0.2.1：四套序列帧特效（能天使 / 陈 / 玛恩纳 / 凯尔希，约 8 MB）同样提前下载。
  不阻塞启动 —— 图没到就"这一下不播"，不会报错、不会白屏。
*/
preloadSeqFxTextures();
// ★ 0.2.1：炮手的炮弹弹道贴图（3 张，合计约 0.2 MB）
preloadTracerFxTextures();
// ★ 0.2.1：隐德来希的血镰贴图（canvas 现画，一次性）
preloadLetoScytheTextures();
// ★ 0.3.2：阿米娅升变技能的七张画布（方格板 / 爆闪 / 三角 / 碎片 / 裂纹 / 血环 / 白热）
preloadAmiyaFormFxTextures();
// ★ 0.2.1：迷迭香的战术装置贴图（一张 512×438，约 0.2 MB）
preloadRosmonGear();

void preloadAssets([
  BACKDROP_PATH,
  BOARD_TEXTURE_PATH,
  ARK_TILE_PATH,
  ...allUnitSpritePaths(Object.keys(UNIT_DEFS)),
  ...allUnitStandPaths(Object.keys(UNIT_DEFS)),
  /*
    ★ 0.0.3：藏品图标（36 张，都很小）。
    预载之后 `buildItemIcon` 第一次画格子就有真图，不会先闪一下"首字色块"。
    缺图的那些会被 assets 层记成 failed 并跳过，界面自动回退 —— 不会报错。
  */
  ...allItemIconPaths(Object.values(ITEM_DEFS).map((item) => item.icon)),
]).then(({ loaded, missing }) => {
  if (loaded > 0) {
    console.info(`[素材] 预加载完成：成功 ${loaded} 张，缺失 ${missing} 张`);
    // 立绘变了要让卡片重画 —— 否则屏幕上还是旧的占位图
    clearUnitTextureCache();
    syncPrepSprites();
    // 藏品图标到位了：把右侧藏品栏重画一遍（之前是首字色块）
    renderCollection();
  }
  if (missing > 0 && loaded === 0) {
    console.info(
      '[素材] 一张素材都没找到，全部使用代码画的占位图。' +
        '想换成真素材：把图放进 apps/web/public/assets/（命名规则见 src/three/assets.ts 顶部说明）',
    );
  }
});

/*
  ★★ 0.3.2：标签页从后台切回前台时，主动补一份快照。
  【为什么需要？】浏览器会把后台标签页的定时器/消息处理压到极低频，
  回来时可能已经错过了好几条广播（倒计时还是旧的、回合也停在旧的）。
  这时候问服务器要一份当前状态最省事（`requestSync` 是幂等的，不发结算）。
*/
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (!netplayActive || !net.room) return;
  /*
    ★ 只在"这个服务器确实支持修订号"时才发 —— 老服务器（没 `room.rev`）会回一条
    "未知消息"的错误弹窗，刷新一次页面就被它刷屏，那比不补同步还糟。
  */
  if (lastRoomRev < 0) return;
  syncRequestPending = true;
  net.requestSync();
});

console.log(
  '%c失序协议%c 客户端已启动\n' +
    `干员 ${Object.keys(UNIT_DEFS).length} 个 · 羁绊 ${Object.keys(TRAIT_DEFS).length} 个\n` +
    `棋盘 ${BOARD_W}×${BOARD_H} · 每方半场 ${ARENA_W}×${ARENA_H}\n` +
    `商店刷新 ${REFRESH_COST} 金 · 买经验 ${BUY_XP_COST} 金\n` +
    '操作：点商店买干员 · 点备战席选中 · 点场上格子放下 · 右键收回/卖出\n' +
    /*
      ★ 0.3.4：快捷键可自定义了，这句**必须现拼** ——
      写死"D 刷新商店"的话，玩家改完键再看控制台会发现两处对不上。
    */
    '快捷键：' +
    KEY_ACTIONS.map((item) => `${keybindLabel(keybinds[item.action])} ${item.label}`).join(' · '),
  'color:#4a9eff;font-weight:bold;font-size:14px',
  'color:inherit',
);
