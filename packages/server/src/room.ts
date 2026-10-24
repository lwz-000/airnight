import { randomInt } from 'node:crypto';
import {
  MAX_PLAYERS_PER_ROOM,
  MIN_PLAYERS_TO_START,
  TRAIT_DEFS,
  UNIT_DEFS,
  // ★ 0.3.4 观战只看别人的藏品栏 -> 转发一个定长只读视图（容量必须和客户端同一份常量）
  ITEM_A_SLOTS,
  ITEM_B_SLOTS,
  ITEM_B_EQUIP_SLOTS,
  AMIYA_CERT_SLOTS,
  computeTraitBonuses,
  feverSkillOf,
  computeUnitTraitBonuses,
  computeActiveTraitLevels,
  isDullRoomCode,
  resolveUnitMechanics,
  buildTraitStatus,
  createRng,
  damageByUnit,
  damageForRound,
  generateRoomCode,
  mirrorPlacements,
  monsterTeamSetup,
  nameTakenIn,
  // ★ 0.3 房间设置：默认值 / 夹取（唯一实现在 shared，别在这里再写一份）
  DEFAULT_ROOM_SETTINGS,
  clampRoomSettings,
  type RoomSettings,
  // ★★ 0.3 盟约：数据表 + "折算成羁绊加成"（**两端必须调同一个函数**，否则校验和会炸）
  COVENANT_IDS,
  covenantOf,
  covenantStartHpBonus,
  covenantTraitBonuses,
  covenantWinHeal,
  // ★★ 0.3.3 阿米娅升变：家族 key（形态和基础棋子共用一份牌库 / 一次升星）
  familyKeyOf,
  // ★★ 0.3.3 人机：难度类型 + 上限（判据/文案都在 shared，别在这儿再写一份）
  MAX_BOTS_PER_ROOM,
  type BotDifficulty,
  botDisplayName,
  botPlayerId,
  pickRecruit,
  playableDefs,
  poolCopiesOf,
  poolSizeOf,
  simulate,
  type BattleEvent,
  type BenchUnitView,
  type PlayerStanding,
  type PrepTeamView,
  type SubmittedTeam,
  type TeamSetup,
  type UnitPlacement,
} from '@airnight/shared';
import type { BeaconRoom } from './lan.js';

/**
 * ★ 0.3.4：把一位玩家上报的藏品状态翻成**定长只读视图**（观战用）。
 *
 * 【三处要合并】
 *   · `itemState.bag.a / b / cert` —— 断线重连用的藏品栏快照（存放区）；
 *   · `sharedItems`               —— 共享装备位那 4 格（它不在 bag 里）；
 *   · 任何一处缺字段（老客户端 / 刚开局）都补成 `null`。
 *
 * ★ 长度用 shared 里的常量，和客户端画格子用的是同一份 —— 不会出现"服务端发 9 格、
 *   界面画 10 格"这种错位。
 */
function prepItemViewOf(team: SubmittedTeam | undefined): {
  a: (string | null)[];
  b: (string | null)[];
  bEquip: (string | null)[];
  cert: (string | null)[];
} {
  const bag = team?.itemState?.bag;
  const fixed = (src: readonly (string | null)[] | undefined, size: number): (string | null)[] => {
    const out: (string | null)[] = new Array(size).fill(null);
    if (!src) return out;
    for (let i = 0; i < size; i++) {
      const id = src[i];
      out[i] = typeof id === 'string' && id.length > 0 ? id : null;
    }
    return out;
  };
  return {
    a: fixed(bag?.a, ITEM_A_SLOTS),
    b: fixed(bag?.b, ITEM_B_SLOTS),
    bEquip: fixed(team?.sharedItems, ITEM_B_EQUIP_SLOTS),
    cert: fixed(bag?.cert, AMIYA_CERT_SLOTS),
  };
}

/**
 * ============================================================
 *  房间 —— 一个「同乐房」的完整状态与规则
 * ============================================================
 *
 * 这个类不碰网络，只处理「房间里发生了什么」。
 * 好处：可以完全脱离网络做单元测试（见 test/room.test.ts），
 * 而且以后想换成别的网络库（Socket.IO、WebRTC…）也不用改这里的逻辑。
 */

export interface RoomPlayer {
  id: string;
  name: string;
  /** 主界面选的干员头像（形如 'op12'；空串表示没选，客户端给默认头像） */
  avatarId: string;
  ready: boolean;
  connected: boolean;
  /** 血量，扣到 0 就淘汰 */
  hp: number;
  /** 本回合是否已提交阵容 */
  submitted: boolean;
  /**
   * 本回合提交的阵容 —— 存的是客户端交上来的**原始输入**
   * （站位 + 各自身的 A 类藏品 + 共享藏品 + 玩家金币），
   * 不是算好的 TeamSetup。见 Room.buildTeamSetup。
   */
  team?: SubmittedTeam;
  /**
   * ★ 0.1.1：「阵容丢失保底」用 —— 本回合最近一次**非空**的阵容。
   *
   * 客户端偶尔会把空阵容报上来（网络/同步抖动，牌在手上一时看不见），
   * 那一下如果照单全收，玩家这一回合就只能空着手挨打。
   * 所以每次收到非空阵容都记一份；开打时若发现当前这份是空的，
   * 且这份记录就是**本回合**的，就用它顶上（见 battleSubmission）。
   */
  lastGoodTeam?: SubmittedTeam;
  /** `lastGoodTeam` 是在哪一回合收到的（跨回合就不认了） */
  lastGoodRound?: number;
  /**
   * ★★ 0.2.2：「重进不丢数据」用 —— 本回合**最后收到的那一份**原始阵容，
   * **不管它合不合法**。
   *
   * 【为什么要专门存一份"可能不合法的"？】
   * 用户报过一个真事：联机里某个玩家的阵容数据被判为非法（站位重叠 / 越界 / 认不出的 id），
   * 服务端整份拒收 ⇒ `player.team` 还是上一份（或者干脆没有）。
   * 他这时候刷新 / 重开页面再回座，`resumeState.myTeam` 拿到的是那份旧的 ——
   * 他这一回合摆的棋子、备战席、金币**全部回退**，只能从头再摆一遍。
   * 数据本身是"玩家自己看到的那一份"，对**还原他的棋盘**来说它才是唯一正确的答案
   * （合法性是"能不能用来开打"的问题，不是"他手上有什么"的问题）。
   *
   * ⇒ 分工写死：
   *   · `lastSeenTeam` —— **还原棋盘**用（重连快照读它，越新越好）
   *   · `player.team`   —— **开打**用（只放合法阵容）
   * 两者绝不可互相顶替。
   */
  lastSeenTeam?: SubmittedTeam;
  /** `lastSeenTeam` 是在哪一回合收到的 */
  lastSeenRound?: number;
  /**
   * ★ 0.1.1：对局结算页要用的三样东西。
   *
   * `finalLineup` 是**死亡那一刻场上的阵容**（冠军没有，取最后一回合的）。
   *   【为什么要专门存一份？】阵容每回合重报、淘汰时还会被还牌逻辑清掉，
   *   不在这里快照下来，结算页就永远拿不到"他死的时候是什么阵容"。
   * `eliminatedRound` 用来排名次（淘汰得越晚名次越好）。
   * `damageByDef` 是按**干员 id** 汇总的整局伤害（见 recordBattleDamage）。
   */
  finalLineup?: UnitPlacement[];
  eliminatedRound?: number;
  damageByDef?: Map<string, { defId: string; star: number; dealt: number }>;
  /** 整局打出的总伤害（内部定点数，显示前 ÷FIX） */
  totalDamage?: number;
  /** 上一回合的对手，用来避免连续两回合撞同一个人 */
  lastOpponentId: string | null;
  /** 累计胜场 */
  wins: number;
  /**
   * ★★ 0.3.1 盟约「重生疗法」用的**有效胜场**（野怪回合不算）。
   *
   * 【为什么不能直接用 `wins`？】
   * `wins` 里含野怪回合（野怪回合走 `applyGhostResult`，同样会 +1），
   * 而盟约写的是"野怪回合不计入"。用 `wins` 的话，打野怪也算"赢 2 场回 3 血"，
   * 恢复速度会比描述快一大截。**单机那边也是同一个口径**（见 main.ts 的
   * `singlePlayerCovenantWins`）。这个字段只在服务端内部用，不进房间广播。
   */
  covenantWins: number;
  /** 累计败场 */
  losses: number;
  /**
   * ★★ 0.3：这位玩家在开局选秀里选的盟约（没选 = undefined）。
   * 它只影响"这一局"—— 房间是一次性的，不需要跨局清理。
   */
  covenantId?: string;
  /**
   * 当前等级 / 连胜连败。
   * 【为什么由客户端上报？】
   * 等级和连胜是客户端经济系统算出来的（买经验、每回合结算），
   * 服务器手里没有这部分的账本。让客户端在数值变化时上报一次，
   * 服务器只负责转发给同一房间的其他人 —— 玩家列表要显示的就是这个。
   * 这是"展示数据"，参战结果一律以服务器为准，改它不会影响胜负。
   */
  level: number;
  /** 正数 = 连胜场数，负数 = 连败场数，0 = 都没有 */
  streak: number;
  /**
   * ★★ 0.3.3：这台是不是**人机**（房主在大厅里加的）。
   *
   * 【为什么它必须是一个字段，而不是"看 id 前缀"？】
   * 因为整个服务端到处都在问"这个人该怎么对待"：
   *   · 房主继承（`migrateHost`）不能把房主交给一台人机；
   *   · 掉线宽限期不能给人机开（人机不会回来，也不该等它）；
   *   · 大厅列表要标"人机 · 困难"、要允许房主改它难度 / 删它；
   *   · 结算页 / 观战也要能区分。
   * 每处各写一次 `id.startsWith('bot:')` 就是"同一件事 N 处实现"，
   * 而且以后改前缀必漏。所以落成一个字段，`isBotPlayerId()` 只在
   * **建座位那一次**用（把前缀翻译成字段）。
   */
  isBot?: boolean;
  /** ★★ 0.3.3：人机难度（真人永远没有这个字段） */
  botDifficulty?: BotDifficulty;
}

export interface BattlePairing {
  battleId: string;
  seed: number;
  player0: RoomPlayer;
  player1: RoomPlayer;
  expectedChecksum: number;
}

/**
 * ============================================================
 *  「影子对战」—— 奇数个人时，轮空的那个人打某个玩家的**复制阵容**
 * ============================================================
 *
 * 【为什么要造这个？】
 * 人数是奇数时，每回合总得有一个人轮空。原来轮空的人只能**干看着别人打** ——
 * 白白空过一回合，什么都不会发生。现在让轮空者跟「某个存活玩家的阵容复制品」
 * 打一场：他有仗可打、输了照样扣自己的血（所以轮空不再是"免费过一回合"）。
 *
 * 【被复制的那位玩家会怎样？—— 什么都不会发生】
 * 影子不是他本人出战，他既不掉血、也不记胜负，
 * 甚至连"他有没有在打"都不知道（他的客户端根本不会把这场当成自己的）。
 * 这就是用户要的"复制阵容失败不扣被复制玩家的血量"。
 */
/** 野怪回合里「玩家 vs 野怪波次」的一场战斗（见 createMonsterBattle） */
export interface MonsterBattle {
  battleId: string;
  seed: number;
  /** 真正参战的人，站在队伍 0 */
  player: RoomPlayer;
  /** 玩家自己的阵容（队伍 0，原样） */
  team0: TeamSetup;
  /** 这一回合的野怪波次（队伍 1；没有羁绊） */
  team1: TeamSetup;
}

export interface GhostBattle {
  battleId: string;
  seed: number;
  /** 真正参战的人（这一回合轮空的那位），站在队伍 0 */
  player: RoomPlayer;
  /** 被复制的那位玩家 —— 纯陪练，打完毫发无损 */
  source: RoomPlayer;
  /** 轮空者自己的阵容（队伍 0，原样） */
  team0: TeamSetup;
  /** 复制来的阵容（已经镜像成队伍 1） */
  team1: TeamSetup;
}

/**
 * ★ 起始回合的调试开关（环境变量 `AIRNIGHT_START_ROUND`，默认 1）。
 *
 * 【为什么要这个？】
 * 0.0.3 起第 1、2 回合是**野怪回合**（对手是一波野怪，不是真人）。
 * 而联机的"真人配对 / 轮空 / 影子对战"那一整套测试，验的是真人对打的逻辑 ——
 * 从第 1 回合开局的话它们全都会落到野怪分支上去。
 * 所以测试里设 `AIRNIGHT_START_ROUND=3` 把房间直接开到普通回合；
 * 生产环境不设这个变量，就是老老实实从第 1 回合开始。
 *
 * 放在**模块级**是因为 `round` 是字段初始值（服务端开局走的是
 * `beginPrepPhase -> beginRound`，不经过 `startGame()`），
 * 只改 startGame() 是拦不住那条路的 —— 这个坑踩过一次。
 */
function startingRound(): number {
  const start = Number(process.env.AIRNIGHT_START_ROUND ?? 1);
  return Number.isFinite(start) && start >= 1 ? Math.floor(start) : 1;
}

export class Room {
  readonly code: string;
  hostId: string;
  /**
   * ★ 0.2：`shop` = **商店回合**（野怪回合之后插入的 90 秒）。
   * 它是"布阵之前的一段"，结束后自动回到 `prep` 再数正常的布阵时长 ——
   * 这样联机里商店也能跑满 90 秒，不会被 60 秒的布阵倒计时顶掉。
   */
  phase: 'lobby' | 'covenant' | 'shop' | 'prep' | 'battle' | 'resolve' = 'lobby';
  round = startingRound() - 1;
  players: RoomPlayer[] = [];

  /**
   * ★★ 0.3：**这一局的规则**（房主在等待界面 DIY 的那份）。
   *
   * 【为什么用房主每次新建房间就是默认值？】
   * 用户口径："每次重新开房间都是默认的"。房间对象是每个房间新建的，
   * 所以放成实例字段就天然满足 —— 不需要额外的"重置"逻辑（那种一定会漏一条路）。
   *
   * 【谁能改？】只有房主、只有 `lobby` 阶段。判据在 main.ts 的 updateSettings 分支，
   * 改完一律过 `clampRoomSettings`（UI 上的 min/max 不是防线）。
   *
   * 【为什么它必须住在服务端？】
   * 这三项（血量 / 金币 / 布阵时长）任意一项由客户端决定，
   * 就等于"改本地就能改规则"。所以唯一真相在这儿，客户端只照着画。
   */
  settings: RoomSettings = { ...DEFAULT_ROOM_SETTINGS };

  /**
   * ★★ 0.3.2：房间视图的**修订号**（每次 `broadcastRoom` +1）。
   *
   * 客户端靠它发现"我漏收了一份广播"（`rev` 跳号）→ 发 `requestSync` 补全。
   * 它只用于判断"有没有断开"，不是状态本身，所以不进 `RoomView` 之外的任何地方。
   */
  rev = 0;

  /**
   * ★★ 0.3 盟约选秀的状态。
   *
   * `covenantOrder` 是**随机打乱后的玩家 id 序列**，只活在服务端 ——
   * 客户端永远只知道"现在轮到谁"，不知道后面还有谁（用户口径：顺序不显示）。
   *
   * `covenantStartedAt` 记墙钟毫秒：倒计时由服务端每秒广播，
   * 客户端不自己数（和布阵倒计时同一套做法，避免两边时间漂移）。
   */
  covenantOrder: string[] = [];
  covenantIndex = 0;
  covenantStartedAt = 0;

  /**
   * ============================================================
   *  共享牌库
   * ============================================================
   *
   * 【为什么由服务器持有？】
   * 1 费每张牌整局只有 27 张，8 个人在抢同一批。
   * 如果每个客户端各扣各的，就会出现"三个人同时买到同一张牌的最后一张"，
   * 牌库凭空变多 —— "抢牌"这个机制就废了。
   * 所以扣牌这件事只能有一个裁决者，那就是服务器。
   *
   * 【为什么记"占用"而不是"剩余"？】
   * 剩余张数 = 总数 - 占用。占用只在"买"和"卖"两个动作里变化，
   * 分支少、不容易漏。而且能直接看出"谁在抢什么"（以后可以做信息栏）。
   */
  private poolTaken = new Map<string, number>();

  /**
   * ============================================================
   *  「预定」：谁商店里正摆着哪些牌
   * ============================================================
   *
   * 【为什么需要它？】
   * 牌库里只剩 1 张"浊心斯卡蒂"的时候，如果它同时出现在两个人的商店里，
   * 那就是"两个人抢一张牌，先点的人赢"；另一个人看到的是一张
   * **点了就报错**的卡片 —— 只会觉得游戏坏了。
   * 所以摆进我商店的牌先记一笔"被谁占着"，别人刷新时就不再抽到它。
   * 我一刷新（或者买走），这一笔就随 shopUpdate 一起被覆盖掉，牌回到池子里。
   *
   * 【为什么不由服务器来发牌？】
   * 商店刷新目前是客户端本地算的（这样单机和联机走同一套代码）。
   * 服务器只做两件它必须做的事：扣牌（买的时候）和广播占用情况。
   */
  private shopHeld = new Map<string, string[]>();

  /** 每回合的随机种子由房间码 + 回合数推出来，可复现、可写进录像 */
  private seedCounter = 0;

  constructor(code: string, hostId: string, hostName: string, hostAvatarId = '') {
    this.code = code;
    this.hostId = hostId;
    this.addPlayer(hostId, hostName, hostAvatarId);
  }

  /**
   * 从牌库里拿走一张牌。
   *
   * @returns ok=false 表示牌库没货了（这时候客户端必须回滚：不能把棋子给玩家）
   */
  takeFromPool(defId: string, copies = 1): { ok: boolean; remaining: number } {
    const total = poolSizeOf(defId);
    const taken = this.poolTaken.get(defId) ?? 0;
    if (taken + copies > total) {
      return { ok: false, remaining: Math.max(0, total - taken) };
    }
    this.poolTaken.set(defId, taken + copies);
    return { ok: true, remaining: total - taken - copies };
  }

  /**
   * 把牌还回牌库（卖棋子时按星级还：二星还 3 张、三星还 9 张）
   *
   * ★★ 先过 `familyKeyOf`：阿米娅升变之后手上的棋子是「青色怒火」，
   *   但那几张牌**本来就是从阿米娅那份池里扣的**。按形态 id 还回去的话
   *   `poolTaken` 会给一个池子里根本不存在的 id 加回份额，阿米娅那份永远不还 ——
   *   表现为"越到残局越刷不到阿米娅"，而且**不报任何错**。
   *   这是唯一一处"还牌"的入口（卖出 / 淘汰回库都走它），改这一处就够。
   */
  returnToPool(defId: string, copies = 1): void {
    const key = familyKeyOf(defId);
    const taken = this.poolTaken.get(key) ?? 0;
    this.poolTaken.set(key, Math.max(0, taken - copies));
  }

  /** 当前牌库剩余张数（defId -> 还剩几张），用来广播给客户端 */
  poolRemaining(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const def of Object.values(UNIT_DEFS)) {
      out[def.id] = Math.max(0, poolSizeOf(def.id) - (this.poolTaken.get(def.id) ?? 0));
    }
    return out;
  }

  /** 某个干员现在牌库还剩几张（招募判定用；和 poolRemaining 同一套账） */
  remainingOf(defId: string): number {
    return Math.max(0, poolSizeOf(defId) - (this.poolTaken.get(defId) ?? 0));
  }

  /**
   * ★ 0.1.1：裁决一次藏品「随机招募」（人事部铜印 / 博士银印）。
   *
   * 【规则和单机完全一样】—— 直接调 shared 的 `pickRecruit`，
   * 只是"牌库还剩几张"用的是**房间共享**的那份账（`poolTaken`）。
   * 招到就把那张牌真的扣掉（`takeFromPool`）—— 这样 8 个人抢牌是真抢。
   *
   * @param seed 客户端给的种子，服务器照它复现同一次抽取（可复盘、可测试）
   */
  recruit(
    minCost: number,
    maxCost: number,
    seed: number,
  ): { defId: string | null; gold: number } {
    const candidates = playableDefs().filter(
      (def) => def.cost >= minCost && def.cost <= maxCost,
    );
    const rng = createRng(seed);
    const picked = pickRecruit(
      candidates,
      (defId) => this.remainingOf(defId),
      (length) => rng.nextInt(length),
    );
    if (picked.defId === null) return { defId: null, gold: picked.gold };
    /*
      抽中的这一张也可能在"选举结果"和"扣牌"之间被人抢走（同一 tick 的另一条消息）。
      takeFromPool 会拒绝，这时退回同一份金币补偿 —— 不能给一只根本没扣到牌的干员。
    */
    const taken = this.takeFromPool(picked.defId, 1);
    if (!taken.ok) return { defId: null, gold: picked.cost };
    return { defId: picked.defId, gold: 0 };
  }

  /** 开始新一局时清空牌库占用（上一局的牌不能留着） */
  resetPool(): void {
    this.poolTaken.clear();
    this.shopHeld.clear();
    // ★ 0.1.1：保底用的"最近一次有效阵容"也要清 —— 那是上一局的牌，不能带过来
    for (const player of this.players) {
      player.lastGoodTeam = undefined;
      player.lastGoodRound = undefined;
      // ★ 0.2.2：重连还原用的那份同理 —— 上一局的棋盘绝不能装进新一局
      player.lastSeenTeam = undefined;
      player.lastSeenRound = undefined;
    }
  }

  /**
   * 更新"我商店里摆着哪些牌"（客户端每次刷新/买走之后发一次）。
   * 直接整份替换：客户端每次发的都是**当前**那一批，不做增量计算，
   * 少一种"漏减一张就永远少一张"的坑。
   */
  setShopHeld(playerId: string, defIds: string[]): void {
    if (defIds.length === 0) {
      this.shopHeld.delete(playerId);
      return;
    }
    this.shopHeld.set(playerId, [...defIds]);
  }

  /** 某个玩家离开 / 被淘汰时，把它占着的牌放回去 */
  dropShopHeld(playerId: string): void {
    this.shopHeld.delete(playerId);
  }

  /**
   * 买走一张之后，把它从"我占着的"名单里去掉一张。
   *
   * 【为什么买到手就要立刻去掉？】
   * 这张牌已经真的从牌库里扣掉了（takeFromPool）。
   * 如果还挂在"预定"里，别人看到的就是**扣两次**：
   * 牌库少 1 张 + 预定又减 1 张，数字会比真实值小 ——
   * 而客户端要等它下次上报商店才会更新，中间这几秒就是错的。
   */
  releaseShopHeld(playerId: string, defId: string): void {
    const held = this.shopHeld.get(playerId);
    if (!held) return;
    const index = held.indexOf(defId);
    if (index < 0) return;
    held.splice(index, 1);
    if (held.length === 0) this.shopHeld.delete(playerId);
  }

  /** 新回合开始：所有人的商店都会重发，先把旧的占用全清掉（离线玩家的不会重发） */
  clearShopHeld(): void {
    this.shopHeld.clear();
  }

  /**
   * 当前被预定出去的牌：defId -> 占着它的玩家 id 列表。
   * 一张牌一个条目，所以"某人占了两张"就是两个相同的 id。
   */
  poolHeld(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    // 按玩家加入顺序遍历，保证同一条消息内容稳定（方便对比日志）
    for (const player of this.players) {
      const held = this.shopHeld.get(player.id);
      if (!held) continue;
      for (const defId of held) {
        (out[defId] ??= []).push(player.id);
      }
    }
    return out;
  }

  addPlayer(
    id: string,
    name: string,
    avatarId = '',
    /**
     * ★★ 0.3.3：建座位时附带的人机信息。
     * 不传 = 真人（和以前完全一样，所以老调用点一个都不用改）。
     */
    bot?: { difficulty: BotDifficulty },
  ): RoomPlayer {
    const existing = this.players.find((p) => p.id === id);
    if (existing) {
      // 断线重连：把老的身份接回来（头像也一起更新，玩家可能重连前换过）
      existing.connected = true;
      existing.name = name;
      if (avatarId) existing.avatarId = avatarId;
      return existing;
    }
    const player: RoomPlayer = {
      id,
      name,
      avatarId,
      /*
        ★★ 0.3.3：人机**天生就是"准备好了"**。
        理由：它没有"我准备好了"这个主观状态，而开局条件里有一条
        "除房主外所有人都要点过准备"（见 main.ts 的 startGame）。
        让房主为每台人机去点一次准备是多余的；更糟的是如果漏点，
        界面会说"还有 1 位玩家没准备好：人机·困难1"，房主完全不知道该点哪儿。
      */
      ready: bot ? true : false,
      connected: true,
      // ★ 0.3：开局血量取房间设置（默认 100，和以前一样）
      hp: this.settings.startHp,
      submitted: false,
      lastOpponentId: null,
      wins: 0,
      covenantWins: 0,
      losses: 0,
      level: 1,
      streak: 0,
      ...(bot ? { isBot: true, botDifficulty: bot.difficulty } : {}),
    };
    this.players.push(player);
    return player;
  }

  /** ★★ 0.3.3：现在房间里有哪些真人（房主继承 / 空房回收都靠它） */
  humans(): RoomPlayer[] {
    return this.players.filter((player) => !player.isBot);
  }

  /** ★★ 0.3.3：现在房间里有哪些人机 */
  bots(): RoomPlayer[] {
    return this.players.filter((player) => player.isBot === true);
  }

  /**
   * ★★ 0.3.3：还能不能再加一台人机。
   *
   * 两道闸，缺一不可：
   *   1. **座位**：房间总人数不能超过 8（人机也占座，和真人是同一张座位表）；
   *   2. **上限**：人机最多 7 台 —— 至少留一个真人座位，
   *      否则会出现"全人机的房间"：没人看、没人能操作、还永远占着局域网列表。
   */
  botSlotError(): string | null {
    /*
      ★ 顺序：先判"人机名额"，再判"座位"。
      反过来的话，"1 个真人 + 7 台人机"再点一次会得到"房间满了（最多 8 人）"——
      房主看到这句会去数人数（明明只有 8 个座位里坐满了），
      而真正的原因其实是"人机名额到顶了"。先说更具体的那一条。
    */
    if (this.bots().length >= MAX_BOTS_PER_ROOM) {
      return `人机最多 ${MAX_BOTS_PER_ROOM} 台（房间里至少留一个真人）`;
    }
    if (this.players.length >= MAX_PLAYERS_PER_ROOM) {
      return `房间满了（最多 ${MAX_PLAYERS_PER_ROOM} 人，人机也占座位）`;
    }
    return null;
  }


  /**
   * ★ 0.3：应用一次房主的设置改动（patch 语义：只改传进来的那几项）。
   *
   * 【为什么在这里夹、而不是在 main.ts 夹？】
   * 因为"设置能是什么样"属于房间的规则，不属于网络层。
   * 放这里以后多一条入口（比如调试命令、存档恢复）也自动过同一道夹取。
   */
  applySettings(patch: unknown): RoomSettings {
    const merged = { ...this.settings, ...(patch && typeof patch === 'object' ? patch : {}) };
    this.settings = clampRoomSettings(merged);
    return this.settings;
  }

  /**
   * ★★ 0.3：开始盟约选秀。
   *
   * 【谁参与】在线且没被淘汰的玩家 —— 掉线的人排进去只会让所有人干等 30 秒，
   * 而且他本来也点不了。等他重连回来这一局已经开始了（那是 resume 的事）。
   *
   * 【顺序】Fisher-Yates 洗牌，随机源用 `crypto.randomInt`（和房间码同一个源）。
   * 顺序**只存在服务端**，广播里只会出现"现在轮到谁"。
   */
  beginCovenantDraft(): void {
    const ids = this.players.filter((player) => player.connected && player.hp > 0).map((p) => p.id);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = randomInt(0, i + 1);
      const tmp = ids[i]!;
      ids[i] = ids[j]!;
      ids[j] = tmp;
    }
    this.covenantOrder = ids;
    this.covenantIndex = 0;
    this.covenantStartedAt = Date.now();
    // 保险：重开一局时把上一局的盟约清掉
    for (const player of this.players) delete player.covenantId;
    this.phase = 'covenant';
  }

  /** 现在轮到谁（没人了 = 选秀结束） */
  currentCovenantPicker(): RoomPlayer | undefined {
    const id = this.covenantOrder[this.covenantIndex];
    return id ? this.getPlayer(id) : undefined;
  }

  /** 已经被选走的盟约 id（界面据此把卡片压暗） */
  takenCovenants(): string[] {
    const out: string[] = [];
    for (const player of this.players) {
      if (player.covenantId) out.push(player.covenantId);
    }
    return out;
  }

  /** 还剩几个人没选 */
  covenantRemaining(): number {
    return Math.max(0, this.covenantOrder.length - this.covenantIndex);
  }

  /**
   * 轮到的这个人选一个盟约。
   *
   * 【三道校验】阶段对 / 轮到你 / 没被选走。
   * "先点的人赢"就是在这里保证的 —— 别人选过的直接拒，不做任何覆盖。
   */
  pickCovenant(playerId: string, covenantId: string): { ok: boolean; error?: string } {
    if (this.phase !== 'covenant') return { ok: false, error: '现在不在盟约选择阶段' };
    const current = this.currentCovenantPicker();
    if (!current) return { ok: false, error: '选秀已经结束了' };
    if (current.id !== playerId) return { ok: false, error: '还没轮到你选' };
    if (!covenantOf(covenantId)) return { ok: false, error: '没有这个盟约' };
    if (this.takenCovenants().includes(covenantId)) {
      return { ok: false, error: '这个盟约已经被别人选走了' };
    }
    current.covenantId = covenantId;
    return { ok: true };
  }

  /**
   * 推到下一位。
   * @returns true = 所有人都选完了（调用方该开下一阶段了）
   */
  advanceCovenant(): boolean {
    this.covenantIndex++;
    this.covenantStartedAt = Date.now();
    return this.covenantIndex >= this.covenantOrder.length;
  }

  /** 从"还没人选过的"里随便挑一个（超时兜底用） */
  randomFreeCovenant(): string | undefined {
    const taken = new Set(this.takenCovenants());
    const free = COVENANT_IDS.filter((id) => !taken.has(id));
    if (free.length === 0) return undefined;
    return free[randomInt(0, free.length)];
  }

  /**
   * ★ 0.3 盟约：把"开局生命 +N"补给这个人。
   *
   * 【为什么要在选秀**结束之后**调？】
   * `startGame` 时先把所有人血量重置成 `settings.startHp`，
   * 那时候还没选盟约，所以"选到了加血盟约"这件事只能等选完再补。
   */
  applyCovenantStartHp(): void {
    for (const player of this.players) {
      const bonus = covenantStartHpBonus(player.covenantId);
      if (bonus > 0) player.hp += bonus;
    }
  }

  /**
   * ★ 0.3 盟约「重生疗法」：每累计赢 `perWins` 场，回 `heal` 点血。
   *
   * ★ 判定用 `covenantWins % perWins === 0` —— 所以只会在他第 2、4、6… 场胜利那一刻触发。
   * ★ **用的是 `covenantWins` 而不是 `wins`**：野怪回合不算（描述里写明的），
   *   而 `wins` 里含野怪回合。
   * ★ 上限取"这个人自己的生命上限"（`settings.startHp` + 他的加血盟约）：
   *   房主把开局血量改成 5000 时，写死 100 会让这条盟约永远回不了血。
   */
  applyCovenantWinHeal(player: RoomPlayer): void {
    const rule = covenantWinHeal(player.covenantId);
    if (!rule || rule.perWins <= 0) return;
    const wins = player.covenantWins ?? 0;
    if (wins <= 0 || wins % rule.perWins !== 0) return;
    const cap = this.settings.startHp + covenantStartHpBonus(player.covenantId);
    player.hp = Math.min(cap, player.hp + rule.heal);
  }

  removePlayer(id: string): void {
    this.players = this.players.filter((p) => p.id !== id);
    // 人走了，它商店里预定着的牌立刻放回池子（不然别人永远刷不到那几张）
    this.shopHeld.delete(id);
    this.migrateHost();
  }

  /**
   * ★ 0.1.2：把房主交给"最合适的那个还在线的人"。
   *
   * ============================================================
   *  【为什么不能再用 `players[0]`？】
   * ============================================================
   * 断线重连把"断线的人"留在了 `players` 里（只把 `connected` 置 false，
   * 见 markDisconnected）。于是 `players[0]` 很可能**正是那个掉线的人** ——
   * 房间会挂着一个离线房主：谁也开不了下一局、谁也踢不动人。
   *
   * 优先顺序（和参考项目的 migrateHost 同一套思路）：
   *   1. 在线且没被淘汰的第一个人
   *   2. 在线的第一个人
   *   3. 没被淘汰的第一个人
   *   4. 都没有（全掉线 / 全淘汰）-> 保持原样，等宽限期到了自然消亡
   *
   * ★★ 0.3.3：**人机永远不能当房主**。
   *   它不会改设置、不会开局、不会加人 —— 一旦房主交给它，
   *   房间里剩下的真人就**再也开不了下一局**了（而且界面上还找不到"谁是房主"）。
   *   所以这三个候选链里都要把 `isBot` 筛掉。
   *
   * 【为什么重连回来不把房主交还给他？】
   * 交还就会出现"谁一断线就换房主、一回来又换回去"的来回跳，
   * 大厅里所有人都会看到房主标记闪。稳定比"名分"重要。
   */
  migrateHost(): void {
    const current = this.getPlayer(this.hostId);
    if (current && current.connected) return; // 房主还在线，不动
    const humans = this.players.filter((player) => !player.isBot);
    const pick =
      humans.find((p) => p.connected && p.hp > 0) ??
      humans.find((p) => p.connected) ??
      humans.find((p) => p.hp > 0);
    if (pick) this.hostId = pick.id;
  }

  /** ★ 0.1.2：还连着的玩家（断线的人不算；重连成功后 `connected` 会被 addPlayer 置回 true） */
  onlinePlayers(): RoomPlayer[] {
    return this.players.filter((p) => p.connected);
  }

  /** 掉线但保留座位，方便重连 */
  markDisconnected(id: string): void {
    const player = this.players.find((p) => p.id === id);
    if (player) player.connected = false;
  }

  /**
   * 记录客户端上报的展示数据（等级 / 连胜连败）。
   *
   * 【为什么做清洗？】这两个值会被原样广播给房间里所有人，
   * 客户端算错（或有人手动构造消息）会污染别人的玩家列表。
   * 这里只做"合理范围"的钳制：等级 1..10，连胜连败 -20..20。
   */
  setPlayerStats(id: string, level: number, streak: number): void {
    const player = this.players.find((p) => p.id === id);
    if (!player) return;
    if (Number.isFinite(level)) {
      player.level = Math.max(1, Math.min(10, Math.round(level)));
    }
    if (Number.isFinite(streak)) {
      player.streak = Math.max(-20, Math.min(20, Math.round(streak)));
    }
  }

  getPlayer(id: string): RoomPlayer | undefined {
    return this.players.find((p) => p.id === id);
  }

  /** 还活着的玩家（血量 > 0） */
  alivePlayers(): RoomPlayer[] {
    return this.players.filter((p) => p.hp > 0);
  }

  /**
   * ★★ 0.2.1：这个座位是不是**已经被淘汰**了 —— 唯一判据。
   *
   * 两个字段都要看：`hp <= 0` 是"当场归零"，`eliminatedRound` 是
   * `markEliminated()` 记下的正式淘汰（两者在一场对局里必然同时成立，
   * 但线上出现过"血量还没结算完"的瞬间，所以取或）。
   *
   * 【为什么需要它】
   * 淘汰时 `markEliminated()` 已经把他的牌**全部还回共享牌库**。
   * 只要他还能买（`buyCard`），同一张牌就会被卖给第二个人 —— 牌库当场超发。
   * 客户端那边已经把商店整块关掉了，但客户端拦不住改过的客户端，
   * 所以服务端必须自己再判一次。
   */
  isEliminated(id: string): boolean {
    const player = this.getPlayer(id);
    if (!player) return false;
    return player.hp <= 0 || player.eliminatedRound !== undefined;
  }

  get isEmpty(): boolean {
    return this.players.length === 0;
  }

  setReady(id: string, ready: boolean): void {
    const player = this.getPlayer(id);
    if (player) player.ready = ready;
  }

  /**
   * 是否满足开始条件。
   * 自走棋一个房间人不够也能玩（剩下的当幽灵/轮空），但至少要有 2 个人才有对战意义。
   *
   * ★ 0.1.2：只数**在线**的人。断线重连把掉线者的座位留在了房间里
   * （见 markDisconnected），如果还按 `players` 数，
   * 一个人在自己房间掉线、另一个刚进来看起来是"两个人"，房主点开局就开不了、也没提示。
   */
  canStart(): boolean {
    const online = this.onlinePlayers();
    return online.length >= MIN_PLAYERS_TO_START && online.filter((p) => p.hp > 0).length >= 2;
  }

  /** 开始游戏，进入第一回合的准备阶段 */
  startGame(): void {
    this.phase = 'prep';
    this.round = startingRound() - 1;
    this.beginRound();
  }

  /**
   * ★★ 0.3.5：打完一局之后**回到大厅**（「再来一局」按钮的服务端那一半）。
   *
   * 【为什么必须由服务器做？】
   * 阶段是房间级的：客户端自己切到大厅视图，服务器还停在 `resolve` ——
   * 房主点「开始游戏」会被 `canStart()` 拦掉（它要求至少 2 个 hp>0 的人），
   * 于是"再来一局"永远点不动。
   *
   * 【复位哪些东西？】
   *   · 血量回到这一局的「开局血量」（不然上一局的 0 血还在，直接不能开局）；
   *   · 战绩 / 连胜连败 / 淘汰标记 / 阵容 / 盟约 / 准备状态全部清空；
   *   · 牌库与商店预定（`resetPool`）；
   *   · 回合号回到起点。
   * **房间号、座位、房主、房间设置都不动** —— "返回当前房间"就是这个意思。
   *
   * ★ 不碰 `players` 数组本身：人还是那几个人（掉线的座位也留着等重连）。
   */
  backToLobby(): void {
    this.phase = 'lobby';
    this.round = startingRound() - 1;
    this.resetPool();
    for (const player of this.players) {
      player.hp = this.settings.startHp;
      player.wins = 0;
      player.losses = 0;
      player.covenantWins = 0;
      player.ready = false;
      player.covenantId = undefined;
      player.lastOpponentId = null;
      player.eliminatedRound = undefined;
      player.finalLineup = undefined;
      player.damageByDef = undefined;
      player.totalDamage = 0;
      // 等级 / 连胜连败是客户端上报的展示数据 —— 上一局的数字不该带进大厅
      player.level = 1;
      player.streak = 0;
    }
  }

  /** 进入新一回合的准备阶段 */
  beginRound(): void {
    this.round++;
    this.phase = 'prep';
    for (const player of this.players) {
      player.submitted = false;
      player.team = undefined;
    }
  }

  /**
   * ★ 布阵时长改成了 60 秒的**定时制**，所以不再有"提交"这个动作。
   *
   * 客户端每改一次阵容就静默把当前阵容同步过来，这里只负责记下来。
   * 时间到了服务器直接用最后收到的那一份开打。
   *
   * 【为什么不再"全员提交就提前开打"？】
   * 因为你要求布阵固定 60 秒、并且删掉提交按钮。
   * 提前开打的前提是"玩家主动表示我好了"，而现在没有这个信号了 ——
   * 如果还按"所有人都放了棋子就开打"，第 1 秒摆完第 2 秒就开打，
   * 60 秒形同虚设。
   */
  submitTeam(
    id: string,
    submitted: SubmittedTeam,
    opts: {
      /** 整份都不可用（一个合法棋子都没有）⇒ 只记下来，不参与开打 */
      rejected?: boolean;
      /**
       * 客户端发来的**原文**站位。
       *
       * ★★ 0.2.2：`submitted.units` 是**修好之后**的那一份（坏格子已经被挑掉），
       * 而"还原他的棋盘"要的是原文 —— 他手上有什么，就装回去什么。
       * 不传就等于"合法的一份"，和以前一样。
       */
      rawUnits?: SubmittedTeam['units'];
    } = {},
  ): void {
    const player = this.getPlayer(id);
    if (!player || player.hp <= 0) return;
    /*
      ★★ 0.2.2：**先记"看到的"，再决定要不要拿来开打。**

      这一步必须在下面那个 `rejected` 早退之前 —— 否则被判非法的那一份
      根本不会落到服务端上，玩家重进时只能拿到更旧的快照（用户报的丢数据）。

      ★ 记的是**原文**（`rawUnits`），不是修好之后的那份：
        重进是为了"把他看到的棋盘装回去"，不是"把能开打的那份给他看"。
    */
    player.lastSeenTeam =
      opts.rawUnits && opts.rawUnits !== submitted.units ? { ...submitted, units: opts.rawUnits } : submitted;
    player.lastSeenRound = this.round;

    // 非法阵容：记下来（还原棋盘用），但**不参与开打**
    if (opts.rejected) return;

    player.team = submitted;
    player.submitted = true;
    /*
      ★ 0.1.1 阵容丢失保底：只记"非空"的那一份，并且记住是哪一回合收到的。
      下一回合 beginRound 会把 player.team 清成 undefined，
      但这一份**故意留着** —— 万一新回合又空着，只要 round 对得上就能顶上。
    */
    if (submitted.units.length > 0) {
      player.lastGoodTeam = submitted;
      player.lastGoodRound = this.round;
    }
  }

  /**
   * ★ 0.1.1：这一回合**真正拿来参战**的原始阵容。
   *
   * 正常情况下就是玩家最后同步上来的那一份；
   * 只有当它是空的、而且本回合曾经有过非空阵容时，才回退到那一份
   * （见 RoomPlayer.lastGoodTeam 的说明）。
   *
   * @returns `fallback = true` 表示用了兜底，客户端要提示玩家。
   */
  battleSubmission(player: RoomPlayer): { submitted: SubmittedTeam; fallback: boolean } {
    const current = player.team;
    if (current && current.units.length > 0) return { submitted: current, fallback: false };
    const last = player.lastGoodTeam;
    if (last && last.units.length > 0 && player.lastGoodRound === this.round) {
      return { submitted: last, fallback: true };
    }
    return { submitted: current ?? { units: [] }, fallback: false };
  }

  /** 这一回合这个人会不会用上"阵容丢失保底"（纯查询，不改状态） */
  usedSafetyNet(player: RoomPlayer): boolean {
    return this.battleSubmission(player).fallback;
  }

  /**
   * ★ 0.1.1：玩家被淘汰时，把他**场上 + 备战席**的牌全部还回共享牌库。
   *
   * 【为什么必须还？】
   * 牌库是全房间共享的有限资源。出局的人手里那些牌如果扣着不放，
   * 剩下的玩家就永远等不到那几张 —— 越到残局越明显（最后两个人互刷都刷不到牌）。
   *
   * 【按几张还？】
   * 一律走 `poolCopiesOf()`（唯一换算）：1★ 1 张、2★ 3 张、3★ 9 张，
   * 白送的（free）还 0 张。备战席那份由客户端上报 `copies`（见 BenchUnitView）。
   */
  /**
   * ★ 0.1.1：这个人被淘汰时的**唯一**状态变更入口。
   *
   * 【顺序不能反】
   * 先**快照阵容**（结算页要展示"死亡时的阵容"），再还牌 ——
   * 而还牌会把 `player.team` 清掉，先还牌的话什么都留不下。
   * 两件事收在一个函数里，就是为了不可能写反。
   */
  markEliminated(player: RoomPlayer): void {
    const submission = this.battleSubmission(player).submitted;
    // 深拷一份：还牌那边会清掉 player.team，浅拷会跟着一起没
    player.finalLineup = submission.units.map((unit) => ({ ...unit, cell: { ...unit.cell } }));
    player.eliminatedRound = this.round;
    this.returnCardsToPool(player);
  }

  /**
   * ★ 0.1.1：把一场战斗里**某个玩家**打出的伤害并进他的整局战绩。
   *
   * 【为什么在服务器算？】
   * 客户端只有自己参战那几场的日志，别人打的它看不到 ——
   * 而结算页要"本局伤害最高的干员"，那必须跨全部回合、全部对手累计。
   * 服务器每场都跑了 simulate（手里就有权威日志），顺手累计是最省事也最准的。
   *
   * @param playerId 玩家 id。影子对战 / 野怪回合填的是假 id（'ghost' / 'monster'），
   *                 `getPlayer` 查不到就直接忽略 —— 那两种"对手"本来就不是人。
   * @param log      这一场的权威日志
   * @param team     这个玩家在这一场站在哪一边（配对是 0/1，影子与野怪恒为 0）
   */
  recordBattleDamage(playerId: string, log: readonly BattleEvent[], team: 0 | 1): void {
    const player = this.getPlayer(playerId);
    if (!player) return;
    const map = (player.damageByDef ??= new Map());
    let total = player.totalDamage ?? 0;
    for (const [defId, entry] of damageByUnit(log, team)) {
      const prev = map.get(defId);
      if (prev) {
        prev.dealt += entry.dealt;
        prev.star = Math.max(prev.star, entry.star);
      } else {
        map.set(defId, { ...entry });
      }
      total += entry.dealt;
    }
    player.totalDamage = total;
  }

  /**
   * ★ 0.1.1：对局结算数据（**按名次排好序**，第 0 个是冠军）。
   *
   * 【名次怎么定？】
   *   1. 还活着的排最前（那是冠军）；
   *   2. 其余按**淘汰回合从晚到早** —— 撑得越久名次越好；
   *   3. 同一回合一起出局的：败场少的优先，再比胜场；
   *   4. 最后用 playerId 兜底，保证每次算出来的顺序完全一致。
   *
   * 【阵容为什么在这里排序？】
   * "按费用从低到高"是展示规则，但放在服务器排能保证
   * 8 个客户端看到的顺序**逐字节一致**（客户端再排一次也不会变）。
   */
  standings(): PlayerStanding[] {
    const ranked = [...this.players].sort((a, b) => {
      const aAlive = a.hp > 0 ? 1 : 0;
      const bAlive = b.hp > 0 ? 1 : 0;
      if (aAlive !== bAlive) return bAlive - aAlive;
      const aRound = a.eliminatedRound ?? 0;
      const bRound = b.eliminatedRound ?? 0;
      if (aRound !== bRound) return bRound - aRound;
      if (a.losses !== b.losses) return a.losses - b.losses;
      if (a.wins !== b.wins) return b.wins - a.wins;
      return a.id.localeCompare(b.id);
    });

    return ranked.map((player, index) => {
      // 冠军没有 finalLineup（他没死过），用最后一回合的阵容
      const units = player.finalLineup ?? this.battleSubmission(player).submitted.units;
      const lineup = [...units].sort((a, b) => {
        const aCost = UNIT_DEFS[a.defId]?.cost ?? 0;
        const bCost = UNIT_DEFS[b.defId]?.cost ?? 0;
        if (aCost !== bCost) return aCost - bCost;
        // 同费用：星级高的排前面（一眼能看出这张卡的分量）
        if (a.star !== b.star) return b.star - a.star;
        return a.defId.localeCompare(b.defId);
      });

      const traits = buildTraitStatus(lineup, UNIT_DEFS, TRAIT_DEFS)
        .filter((trait) => trait.activeAt !== null)
        .map((trait) => ({ traitId: trait.traitId, count: trait.count, activeAt: trait.activeAt! }));

      let topUnit: PlayerStanding['topUnit'] = null;
      for (const entry of (player.damageByDef ?? new Map()).values()) {
        if (!topUnit || entry.dealt > topUnit.dealt) topUnit = { ...entry };
      }

      return {
        playerId: player.id,
        name: player.name,
        avatarId: player.avatarId,
        rank: index + 1,
        eliminatedRound: player.eliminatedRound ?? null,
        hp: player.hp,
        wins: player.wins,
        losses: player.losses,
        level: player.level,
        lineup,
        traits,
        topUnit,
        totalDamage: player.totalDamage ?? 0,
      };
    });
  }

  returnCardsToPool(player: RoomPlayer): void {
    /*
      ★★ 0.2.2：还牌必须按**最新那一份快照**算，所以 `lastSeenTeam` 排在最前。

      【为什么不能只认 `team` / `lastGoodTeam`？】
      0.2.2 之前：`player.team` 只在"合法"时写，非法阵容连记都不记。
      于是"这一回合被判非法 + 人又刚好被淘汰"时，还的是**更旧那一份**的牌 ——
      他这一回合买的、升星用掉的那些**永远回不了共享牌库**（牌库静默少几张，
      越到残局越明显：最后两个人互相刷都刷不到牌）。
      `lastSeenTeam` 每次提交都写，所以它一定是最新的。
    */
    const submission = player.lastSeenTeam ?? player.team ?? player.lastGoodTeam;
    if (submission) {
      for (const unit of submission.units) {
        this.returnToPool(unit.defId, poolCopiesOf(unit));
      }
      for (const bench of submission.bench ?? []) {
        if (bench.copies > 0) this.returnToPool(bench.defId, bench.copies);
      }
    }
    // 商店里"预定着但还没买"的也一起放掉（人已经出局，占着没意义）
    this.dropShopHeld(player.id);
    /*
      ★ 牌已经还完了，把这份记录也清掉：
        · 别人"看他棋盘"时不会继续看到一堆早就不存在的棋子（显示要诚实）；
        · 也断了任何"下一回合又用这份阵容上场"的可能（他已经出局了）。
      必须在 returnToPool 之后清 —— 顺序反了就一张都还不回去。
    */
    player.team = undefined;
    player.lastGoodTeam = undefined;
    player.lastGoodRound = undefined;
    // ★ 0.2.2：这份也要清 —— 牌已经还回共享牌库了，
    //   留着它会让重连快照把"已经不存在的牌"装回他的棋盘（凭空多出一套阵容）。
    player.lastSeenTeam = undefined;
    player.lastSeenRound = undefined;
  }

  /**
   * 所有人的当前阵容（布阵期间广播给房间，用于"看别人怎么摆"）。
   *
   * ★ 0.1.1：除了场上的棋子，还带上备战席 —— 观战时也看得到对方手里攒了什么。
   */
  currentTeams(): Record<string, PrepTeamView> {
    const out: Record<string, PrepTeamView> = {};
    for (const player of this.players) {
      out[player.id] = {
        units: player.team?.units ?? [],
        // 备战席是客户端上报的 `BenchUnitView[]`（已经带好 copies），原样转发
        bench: player.team?.bench ?? [],
        /*
          ★★ 0.3.4：观战时要看得到**别人的藏品栏**（用户口径）。
          数据本来就在手上（断线重连用的 `itemState.bag` + `sharedItems`），
          这里只是换个只读视图转发，不需要客户端多报任何东西。
          `bag` 可能缺字段（老客户端 / 刚开局）—— 一律补成定长空数组，
          界面就不用到处判 undefined。
        */
        items: prepItemViewOf(player.team),
      };
    }
    return out;
  }

  /** 布阵时间到：把还活着的人标记成"已摆好"（界面要显示这个） */
  markAllSubmitted(): void {
    for (const player of this.alivePlayers()) player.submitted = true;
  }

  /**
   * 生成本回合的对战配对。
   *
   * ============================================================
   *  ★ 改成「轮流对战」（轮转赛制），不再是每回合重新随机洗牌
   * ============================================================
   * 【为什么改？】
   * 原来是"每回合把活着的人随机洗牌再两两配对"。人多的时候会出现很难受的情况：
   *   · 4 个人打 6 回合，可能有人一次都没碰上（运气决定名次）
   *   · 也可能同一对连打三回合（"怎么又是你"）
   * 现在改成**固定的轮转顺序**：所有人轮流交手，一轮下来每个人恰好跟其他每个人打一次。
   *
   * 【具体顺序 —— 和你说的一致】
   * 4 个人：第 1 回合 1v2、3v4 → 第 2 回合 1v3、2v4 → 第 3 回合 1v4、2v3 → 循环。
   * 6 个人：第 1 回合 1v2、3v4、5v6，之后同样每回合把顺序转一格。
   * 奇数个人：每回合恰好一个人轮空（不扣血），一整轮下来每个人轮空一次。
   *
   * 【怎么保证"不重复"？】
   * 用的是经典的「圆桌轮转法」：把 1 号固定在最前面，其余的人每回合整体左移一格，
   * 然后按「第 i 个 对 倒数第 i 个」配对。
   * 数学上可以证明这样转 n-1 次刚好把所有两两组合各走一遍（每对恰好一次）。
   * 奇数个人时补一个虚拟的"轮空位"凑成偶数，谁碰上轮空位谁这回合就轮空。
   *
   * 【为什么不是随机？】
   * 配对的种子必须可复现 —— 服务器重启或者玩家重连后，同一回合必须是同一批配对，
   * 否则录像、校验和、客户端的重放全对不上。
   */
  createPairings(): { pairings: BattlePairing[]; byePlayerId: string | null } {
    const alive = this.alivePlayers();
    const { pairs, bye } = roundRobinPairings(alive, this.round);

    const pairings: BattlePairing[] = [];
    pairs.forEach(([player0, player1], index) => {
      const seed = this.seedFor(`battle:${this.round}:${index}`);
      // 先把队伍给两个玩家自己（服务端也要存一份，用于权威推演）
      const team0 = this.buildTeamSetup(player0, 0);
      const team1 = this.buildTeamSetup(player1, 1);

      const result = simulate(UNIT_DEFS, [team0, team1], seed);

      pairings.push({
        battleId: `${this.code}-R${this.round}-${index}`,
        seed,
        player0,
        player1,
        expectedChecksum: result.checksum,
      });
    });

    return { pairings, byePlayerId: bye?.id ?? null };
  }

  /**
   * 造一场「影子对战」（见 GhostBattle 的说明）。
   *
   * 【复制谁？】
   * 从"除自己以外的存活玩家"里随机挑一个。随机源由「房间码 + 回合数」推出，
   * 可复现 —— 服务器重启、客户端重连，同一回合复制的都是同一个人。
   *
   * 【为什么复制的阵容要镜像？】
   * 和真人配对同一套道理：被复制者的阵容是他**自己视角**的坐标
   * （都摆在左半边 0..3 列）。当队伍 1 用就必须翻转成右半边，
   * 否则一开局就报「棋子放错半场了」。
   *
   * @returns 只有自己一个人活着时返回 null（那时候游戏本来也该结束了）
   */
  createGhostBattle(player: RoomPlayer): GhostBattle | null {
    const others = this.alivePlayers().filter((p) => p.id !== player.id);
    if (others.length === 0) return null;

    const pickRng = createRng(this.seedFor(`ghost:${this.round}:pick`));
    const source = others[pickRng.nextInt(others.length)]!;
    const seed = this.seedFor(`battle:${this.round}:ghost`);

    return {
      battleId: `${this.code}-R${this.round}-ghost`,
      seed,
      player,
      source,
      team0: this.buildTeamSetup(player, 0),
      team1: this.buildTeamSetup(source, 1),
    };
  }

  /**
   * ★ 0.0.3：造一场「玩家 vs 野怪波次」的战斗（野怪回合专用）。
   *
   * 【和影子对战的关系】
   * 结构完全一样 —— 都是"一个真人在队伍 0，队伍 1 是系统生成的对手"，
   * 所以结算也走 `applyGhostResult`（只动这一个玩家的血）。
   * 区别只有两点：队伍 1 换成野怪波次；battleId 后缀从 `ghost` 变成 `wave`。
   *
   * 【为什么野怪不吃羁绊？】
   * 它们的 traits 是空的（见 monster-data.ts），monsterTeamSetup 也就不填羁绊字段。
   *
   * ★★ 0.1.3：battleId **必须带上玩家 id**（以前是全房间共用一个 `-R5-wave`）。
   *   野怪回合是"每个人各打一场自己 vs 同一波" —— 共用一个 id 的后果是
   *   客户端的 `liveBattles`（按 battleId 存的 Map）里每一场都**覆盖上一场**，
   *   最后只剩一场，于是观战列表永远只有 1 个条目、`>= 2` 的显示条件不成立 ——
   *   **野怪回合根本没法看别人的战斗**（用户报的）。
   *   顺带：共用一个 id 时"我看完了"的回执也分不清是谁举的手。
   */
  createMonsterBattle(player: RoomPlayer): MonsterBattle {
    return {
      battleId: `${this.code}-R${this.round}-wave-${player.id}`,
      seed: this.seedFor(`battle:${this.round}:wave:${player.id}`),
      player,
      team0: this.buildTeamSetup(player, 0),
      team1: monsterTeamSetup(this.round, 1),
    };
  }

  /**
   * 把玩家提交的**原始输入**转成战斗用的 TeamSetup。
   *
   * 【关键：队伍 1 的阵容必须镜像翻转】
   * 客户端提交的阵容永远是「玩家自己视角」的坐标（都摆在左半边 0..3 列）。
   * 服务端配对后，一个人要演队伍 0（左半边，直接用），
   * 另一个要演队伍 1（右半边，必须把列翻转成 7-c）。
   * 否则会直接报「棋子放错半场了」。
   *
   * 【羁绊：服务端自己算】
   * 客户端只管提交阵容，谁吃到什么加成由服务器说了算 —— 客户端改不了。
   *
   * 【★ 0.0.3 藏品：这一层必须把藏品的三个字段原样带过去，否则联机里藏品等于没装】
   *   · `units[].items`   —— A 类。`mirrorPlacements` 用的是 `{...unit}` 展开，
   *                          所以镜像之后 items 还在，不用额外处理。
   *   · `sharedItems`     —— B 类。**曾经漏在这里**：项目只带 units，B 类全丢。
   *   · `playerContext`   —— 金酒之杯 / 皇帝的新枪要按玩家金币、血量算全队加成。
   *
   * ★ 血量**不采信客户端上报的值**，一律用服务端自己的 `player.hp`：
   *   血量是服务端权威数据，客户端那份只是它显示用的副本，可能落后一两拍。
   *   金币没有服务端账本（经济是客户端管的），只能听客户端的。
   */
  buildTeamSetup(player: RoomPlayer, team: 0 | 1): TeamSetup {
    /*
      ★ 0.1.1：走 battleSubmission —— 客户端万一报了个空阵容（牌一时看不见），
      这里会自动回退到"本回合最近一次有效阵容"，玩家照常能打。
    */
    const { submitted } = this.battleSubmission(player);
    const submittedUnits = submitted.units;
    const units = team === 0 ? submittedUnits : mirrorPlacements(submittedUnits);
    return {
      team,
      units,
      /*
        ★★ 0.3 盟约：全队加成和羁绊加成走**同一条路**（`traitBonuses`），
        战斗内核完全不知道有盟约这回事。
        ★ 客户端 `toTeamSetup` 必须调**同一个** `covenantTraitBonuses`，
          少一条这里就会判"校验和不一致"。
      */
      traitBonuses: [
        ...computeTraitBonuses(units, UNIT_DEFS, TRAIT_DEFS),
        ...covenantTraitBonuses(player.covenantId),
      ],
      // ★ 0.3：盟约 id 进战斗（「命结之秘」由内核在 killUnit 里判），和客户端同源
      covenantId: player.covenantId,
      unitTraitBonuses: computeUnitTraitBonuses(units, UNIT_DEFS, TRAIT_DEFS),
      activeTraits: computeActiveTraitLevels(units, UNIT_DEFS, TRAIT_DEFS),
      unitMechanics: resolveUnitMechanics(units, UNIT_DEFS, TRAIT_DEFS),
      sharedItems:
        submitted.sharedItems && submitted.sharedItems.length > 0
          ? [...submitted.sharedItems]
          : undefined,
      // ★ 0.2：逐副本层数也要交给 createBattle，否则服务端按 0 层算 ⇒ 校验和必炸
      sharedItemLayers:
        submitted.sharedItemLayers && submitted.sharedItemLayers.length > 0
          ? [...submitted.sharedItemLayers]
          : undefined,
      playerContext: { gold: submitted.playerContext?.gold ?? 0, hp: player.hp },
      /*
        ★ 0.1.1 藏品二版：跨回合成长层数 + 当前回合号。
        假人 / 炎佑的数值按回合成长，而战斗内核不知道第几回合 ——
        所以在这里把 `this.round`（服务端权威）一起交给 createBattle。
        层数只能听客户端的（服务端没有击杀账本），但 main.ts 已经夹过范围。
      */
      round: this.round,
      itemState: submitted.itemState,
      // ★ 0.2 罗德岛跨回合叠层：由客户端上报，原样交给 createBattle 换成属性
      traitStacks: submitted.traitStacks,
      /*
        ★★ 0.2 MujicaAve：消耗 fever 之后的那一场要"开局强行放技能 + 免死窗口"。
        ★ 这里必须和客户端（`toTeamSetup`）调**同一个函数** —— 服务端要拿这一份
          算校验和，只要有一个字段不一样，整场战斗就会判"校验和不一致"。
      */
      feverSkill: feverSkillOf(submitted.fever),
    };
  }

  /**
   * 结算一场战斗的结果。
   * 输的一方扣血，血扣光就淘汰。
   */
  applyBattleResult(winner: 0 | 1 | null, player0Id: string, player1Id: string): Record<string, number> {
    const hpAfter: Record<string, number> = {};
    const damage = damageForRound(this.round);

    if (winner === null) {
      // 平局：双方都不扣血（也可以改成都扣，看你的设计）
      for (const id of [player0Id, player1Id]) {
        const player = this.getPlayer(id);
        if (player) hpAfter[id] = player.hp;
      }
      return hpAfter;
    }

    const loserId = winner === 0 ? player1Id : player0Id;
    const winnerId = winner === 0 ? player0Id : player1Id;

    const loser = this.getPlayer(loserId);
    if (loser) {
      loser.hp = Math.max(0, loser.hp - damage);
      loser.losses++;
      hpAfter[loserId] = loser.hp;
    }
    const winnerPlayer = this.getPlayer(winnerId);
    if (winnerPlayer) {
      winnerPlayer.wins++;
      // ★ 0.3.1：盟约算的是"有效胜场"（野怪回合不算，这条是真人配对，算）
      winnerPlayer.covenantWins++;
      // ★ 0.3 盟约「重生疗法」：每赢 N 场回血
      this.applyCovenantWinHeal(winnerPlayer);
      hpAfter[winnerId] = winnerPlayer.hp;
    }

    // 记录对手，供下一回合避免重复配对
    const p0 = this.getPlayer(player0Id);
    const p1 = this.getPlayer(player1Id);
    if (p0) p0.lastOpponentId = player1Id;
    if (p1) p1.lastOpponentId = player0Id;

    return hpAfter;
  }

  /**
   * 结算「影子对战」：**只有轮空者**会掉血 / 记战绩，被复制的那位一个字都不动。
   *
   * 【为什么必须单独一个方法？】
   * applyBattleResult 是照"两个真实玩家"写的（要记 lastOpponentId、
   * 给双方各记一笔胜负）。而影子那边根本没有 RoomPlayer ——
   * 硬套过去就会把掉血记到**被复制者**头上，
   * 那正是用户报的"复制阵容失败不该扣被复制玩家的血量"。
   *
   * @param winner simulate 的结果：0 = 轮空者赢，1 = 影子（复制阵容）赢，null = 平局
   */
  applyGhostResult(
    winner: 0 | 1 | null,
    playerId: string,
    /**
     * ★★ 0.3.1：这一场算不算"有效胜场"（进盟约「重生疗法」的账）。
     *
     * 野怪回合走的也是这条路 —— 但盟约描述写的是"**野怪回合不计入**"，
     * 所以 `main.ts` 在野怪分支传 `false`：战绩照记（`wins`/`losses` 不变），
     * 只是不往 `covenantWins` 上加、也不触发回血。
     */
    opts: { countsForCovenant?: boolean } = {},
  ): Record<string, number> {
    const hpAfter: Record<string, number> = {};
    const player = this.getPlayer(playerId);
    if (!player) return hpAfter;

    if (winner === 1) {
      player.hp = Math.max(0, player.hp - damageForRound(this.round));
      player.losses++;
    } else if (winner === 0) {
      player.wins++;
      if (opts.countsForCovenant !== false) {
        player.covenantWins++;
        // ★ 0.3 盟约「重生疗法」：每赢 N 场回血（和上面那条是两条结算路径，都要过）
        this.applyCovenantWinHeal(player);
      }
    }
    hpAfter[playerId] = player.hp;
    return hpAfter;
  }

  /** 游戏是否结束（只剩一个活人） */
  isGameOver(): { over: boolean; winnerId: string | null } {
    const alive = this.alivePlayers();
    if (alive.length <= 1) {
      return { over: alive.length === 1, winnerId: alive[0]?.id ?? null };
    }
    return { over: false, winnerId: null };
  }

  /**
   * 由「房间码 + 用途标签」推出一个稳定的随机种子。
   *
   * 这样同一回合的配对和战斗永远是同样的结果 ——
   * 服务器重启、录像回放、朋友重连，看到的都是同一场战斗。
   */
  private seedFor(label: string): number {
    this.seedCounter++;
    let h = 2166136261 >>> 0;
    const text = `${this.code}|${label}|${this.seedCounter}`;
    for (let i = 0; i < text.length; i++) {
      h = (h ^ text.charCodeAt(i)) >>> 0;
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }
}

/**
 * ============================================================
 *  轮流对战（轮转赛制）—— 纯函数，和网络/房间无关
 * ============================================================
 *
 * 【它到底在干什么？】
 * 传入这一回合"还活着的人"（按加入房间的顺序）和回合号，
 * 返回「谁打谁」和「谁轮空」。
 *
 * 【4 个人的效果（和你举的例子完全一致）】
 *   第 1 回合  1v2  3v4
 *   第 2 回合  1v3  2v4
 *   第 3 回合  1v4  2v3
 *   第 4 回合  回到第 1 回合那样
 *
 * 【原理：圆桌轮转法】
 * 把 1 号钉在最前面不动，其余的人每回合整体左移一格，然后
 * 「第 i 个」对「倒数第 i 个」。转 n-1 次就刚好把 C(n,2) 种组合各走一遍。
 *
 * 初始顺序特意排成 `1,3,5... , ...6,4,2`，这样**第 1 回合恰好是
 * 1v2、3v4、5v6** —— 也就是"相邻的人先打"，最直观。
 *
 * 【奇数个人怎么办？】
 * 补一个虚拟的「轮空位」凑成偶数。谁跟这个虚拟位配对，谁这回合轮空。
 * 一整轮（n 回合）下来每个人恰好轮空一次 —— 公平。
 *
 * 【为什么返回的是"人"而不是"下标"？】
 * 调用方（房间）只关心"谁打谁"，不关心中间那套下标怎么算。
 * 抽成纯函数之后，配对规则可以用一条毫秒级的断言测完，不需要起服务器、
 * 不需要等 30 秒准备阶段、不需要真的打一场。
 */
export function roundRobinPairings<T>(
  players: T[],
  round: number,
): { pairs: Array<[T, T]>; bye: T | null } {
  const n = players.length;
  if (n < 2) return { pairs: [], bye: n === 1 ? players[0]! : null };

  /*
    奇数个人时补一个「轮空位」（用 null 表示）。
    注意它要参与轮转，所以不能简单地放在末尾不管。
  */
  const hasBye = n % 2 === 1;
  const seats: Array<T | null> = hasBye ? [...players, null] : [...players];
  const m = seats.length; // 一定是偶数

  /*
    初始顺序：前一半放"奇数位的人"，后一半倒着放"偶数位的人"。
    1-based 想： [1,3,5] + reverse([2,4,6]) = [1,3,5,6,4,2]
    这样第 1 回合按「第 i 个对倒数第 i 个」配出来正好是 (1,2) (3,4) (5,6)。
  */
  const half = m / 2;
  const ordered: Array<T | null> = [];
  for (let i = 0; i < half; i++) ordered.push(seats[2 * i] ?? null);
  for (let i = half - 1; i >= 0; i--) ordered.push(seats[2 * i + 1] ?? null);

  /*
    第 r 回合 = 把「除第一个座位以外」的座位整体左移 (r-1) 格。
    走完 m-1 回合会回到原点，所以取模循环 —— 人打多了就从头再来一轮。
  */
  const shift = ((Math.max(1, Math.floor(round)) - 1) % (m - 1) + (m - 1)) % (m - 1);
  const tail = ordered.slice(1);
  const rotated = [...tail.slice(shift), ...tail.slice(0, shift)];
  const line = [ordered[0]!, ...rotated];

  const pairs: Array<[T, T]> = [];
  let bye: T | null = null;
  for (let i = 0; i < half; i++) {
    const a = line[i]!;
    const b = line[m - 1 - i]!;
    if (a === null) bye = b;
    else if (b === null) bye = a;
    else pairs.push([a, b]);
  }
  return { pairs, bye };
}

/**
 * 房间管理器：负责创建房间、按房间码查找、回收空房间。
 */
export class RoomManager {
  private rooms = new Map<string, Room>();
  private playerToRoom = new Map<string, string>();

  /**
   * 房间码的随机源。
   *
   * 【0.0.3 末换掉的：原来是"固定种子 1 的 LCG，取低位"】
   * 那是**每次开服前几个房间号完全一样**的元凶（实测每次都是 GAAAAA / A2AAAA / …）。
   * 现在直接用操作系统的密码学随机数源换算成 [0,1)：不重复、不偏移、
   * 也不受"什么时候开的服"影响。房间码不需要抗攻击，但需要**真的乱**。
   */
  private nextCodeRandom = (): number => randomInt(0, 1 << 30) / (1 << 30);

  createRoom(hostId: string, hostName: string, hostAvatarId = ''): Room {
    /*
      抽一个"又没撞车、又不像手抖"的房间码。
      两道校验：
        · 撞车（这个房间码房间已经存在）—— 概率极低，但必须有；
        · 太假（AAAAAA / ABABAB 这类，见 isDullRoomCode）—— 概率同样极低，
          可是撞上了会让玩家以为"房间号是写死的"，重抽一次的代价可以忽略。
    */
    let code = '';
    let guard = 0;
    do {
      code = generateRoomCode(this.nextCodeRandom);
    } while ((this.rooms.has(code) || isDullRoomCode(code)) && guard++ < 200);

    const room = new Room(code, hostId, hostName, hostAvatarId);
    this.rooms.set(code, room);
    this.playerToRoom.set(hostId, code);
    return room;
  }

  /**
   * ★ 0.0.3 末：**现在有哪些房间值得广播到局域网**（招待中的房间）。
   *
   * 【为什么只广播 lobby 阶段的？】
   * 已经在打（prep/battle/resolve）的房间不接受新人 —— 广播出去只会让朋友
   * 敲了房间号却被告知"这局已经开始了"。宁可让他看不见。
   *
   * 【为什么要带人数/上限？】
   * 界面上可以直接显示"3/8"，满了就不再让人白点一次。
   */
  advertisedRooms(): BeaconRoom[] {
    const out: BeaconRoom[] = [];
    for (const room of this.rooms.values()) {
      /*
        ★★ 0.3.3（用户口径）：**已开局的房间也要广播**，让局域网列表能看见
        「进行中 · 第 7 回合」，只是不给进（`joinRoom` 的 `WRONG_PHASE` 那道闸不动）。

        【为什么不干脆把它们藏起来？】
        玩家看到的画面是"朋友的房间凭空消失了"——他不知道那是"开了局"还是"房间没了"。
        看得见 + 标清楚状态，比"看不见"少一次困惑。

        ★ 大厅/对局都广播，但"一个真人在线都没有"的房间仍然不广播：
        房主关了标签页的房间会挂到宽限期结束（见下面 0.1.2 的注释），
        那种房间连进去也只能看到一屋子离线的人。
      */
      if (room.onlinePlayers().length === 0) continue;
      const host = room.players.find((player) => player.id === room.hostId) ?? room.players[0];
      out.push({
        code: room.code,
        hostName: host?.name ?? '房主',
        players: room.players.length,
        maxPlayers: MAX_PLAYERS_PER_ROOM,
        phase: room.phase,
        // 等待中报 0：列表上写"等待中"，不写"第 0 回合"
        round: room.phase === 'lobby' ? 0 : room.round,
      });
    }
    return out;
  }

  getRoom(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  /** 玩家当前在哪个房间 */
  roomOfPlayer(playerId: string): Room | undefined {
    const code = this.playerToRoom.get(playerId);
    return code ? this.rooms.get(code) : undefined;
  }

  joinRoom(
    code: string,
    playerId: string,
    playerName: string,
    playerAvatarId = '',
  ): { room?: Room; error?: string; errorCode?: string } {
    const room = this.getRoom(code);
    if (!room) return { error: '房间不存在，检查一下房间码？' };
    if (room.players.length >= 8) return { error: '房间满了（最多 8 人）', errorCode: 'ROOM_FULL' };
    if (room.phase !== 'lobby') return { error: '这局已经开始了，等下一局吧', errorCode: 'WRONG_PHASE' };
    /*
      ★★ 0.3：**房间里不允许重名**（用户口径）。

      【为什么判据放在这里，而不是 main.ts 的 case 里？】
      因为"能不能进这个房间"的裁决本来就全在这个方法里（房间不存在 / 满了 / 已开局），
      重名是同一类判断。放一起才不会出现"某条入口漏检"——
      文档里那句"要拦三个入口，少一个就能绕过去"说的就是这个。

      【为什么要排除自己？】
      除了正常进房，还有一条路会走到这儿：人已经在房间里，又对同一个房间发了一次 joinRoom。
      不排除自己的话，他会因为"这个名字已经有人用了"被自己的座位挡在门外。

      ★ 归一化（大小写 / 全角 / 空白）在 `nameTakenIn` 里，别在这里再写一份。
    */
    if (nameTakenIn(room.players, playerName, playerId)) {
      return { error: '这个名字房间里已经有人用了，换一个吧', errorCode: 'NAME_TAKEN' };
    }

    // 如果之前在别的房间，先离开
    const previous = this.roomOfPlayer(playerId);
    if (previous && previous !== room) this.leaveRoom(playerId);

    room.addPlayer(playerId, playerName, playerAvatarId);
    this.playerToRoom.set(playerId, room.code);
    return { room };
  }

  leaveRoom(playerId: string): Room | undefined {
    const room = this.roomOfPlayer(playerId);
    if (!room) return undefined;
    room.removePlayer(playerId);
    this.playerToRoom.delete(playerId);
    /*
      ★★ 0.3.3：**房间里一个真人都没有了**（只剩人机）也要销毁。

      【不销毁会怎样？】人机会永远"在线"、永远活着，于是：
        · `advertisedRooms` 会一直把这张空房广播到局域网，
          朋友点进去发现是一屋子人机、房主也点不了开局；
        · `isEmpty` 永远是 false ⇒ 房间对象 + 定时器永远不回收。
      真人走得只剩人机 = 这一局已经没意义了，直接收掉。
    */
    if (room.isEmpty || room.humans().length === 0) {
      this.rooms.delete(room.code);
      return undefined;
    }
    // 清理掉线玩家的记录，避免房间永远留着鬼魂
    return room;
  }

  /**
   * ★★ 0.3.3：往房间里加一台人机。
   *
   * 【这个方法是"加人机"的唯一裁决处】和 `joinRoom` 一样，
   * 房间不存在 / 不是大厅 / 没座位 都在这里判完，main.ts 只负责转错误。
   */
  addBot(
    code: string,
    difficulty: BotDifficulty,
    nameOf: (difficulty: BotDifficulty, index: number) => string,
  ): { room?: Room; bot?: RoomPlayer; error?: string } {
    const room = this.getRoom(code);
    if (!room) return { error: '房间不存在' };
    if (room.phase !== 'lobby') return { error: '对局已经开始了，不能再加人机' };
    const slotError = room.botSlotError();
    if (slotError) return { error: slotError };

    /*
      ★ 编号取"第一个没被占的"：删掉中间某一台之后，下次还能补上那个空号。
        名字和 id 一起用这个编号 —— 否则会出现两个「人机·普通2」，
        房主根本分不清要改哪一个。
    */
    let index = 1;
    while (room.getPlayer(botPlayerId(room.code, index))) index++;

    const id = botPlayerId(room.code, index);
    const bot = room.addPlayer(id, nameOf(difficulty, index), '', { difficulty });
    this.playerToRoom.set(id, room.code);
    return { room, bot };
  }

  /** ★★ 0.3.3：把一台人机摘出房间（真人走 `leaveRoom` / `kickPlayer`） */
  removeBot(code: string, botId: string): { room?: Room; error?: string } {
    const room = this.getRoom(code);
    if (!room) return { error: '房间不存在' };
    const bot = room.getPlayer(botId);
    if (!bot || !bot.isBot) return { error: '找不到这台人机' };
    if (room.phase !== 'lobby') return { error: '对局已经开始了，不能删人机' };
    room.removePlayer(botId);
    this.playerToRoom.delete(botId);
    return { room };
  }

  /** ★★ 0.3.3：改一台人机的难度（只在大厅，理由见协议里的说明） */
  setBotDifficulty(code: string, botId: string, difficulty: BotDifficulty): { room?: Room; error?: string } {
    const room = this.getRoom(code);
    if (!room) return { error: '房间不存在' };
    const bot = room.getPlayer(botId);
    if (!bot || !bot.isBot) return { error: '找不到这台人机' };
    if (room.phase !== 'lobby') return { error: '对局已经开始了，难度不能再改' };
    bot.botDifficulty = difficulty;
    return { room };
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  get playerCount(): number {
    return this.playerToRoom.size;
  }
}
