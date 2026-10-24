import { randomBytes } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  BOARD_H,
  ITEM_A_SLOTS,
  // ★ 0.3.2 升变之证专用栏（3 格；快照清洗时按它夹长度）
  AMIYA_CERT_SLOTS,
  ITEM_B_SLOTS,
  // ★ 0.3.2：共享装备位格数（地形图是 B 类，最多占满这几格 ⇒ 人口上限最多 +4）
  ITEM_B_EQUIP_SLOTS,
  ITEM_DEFS,
  MAX_LEVEL,
  MIN_PLAYERS_TO_START,
  // ★ 0.0.3 野怪回合
  MONSTER_PLAYER_ID,
  PREP_SECONDS,
  SERVER_VERSION,
  // ★ 0.2 商店回合：出现时机 + 时长（**和客户端同一份**判据，见 shared/shop-round.ts）
  SHOP_ROUND_SECONDS,
  isShopRoundAfter,
  TEAM_0_MAX_COL,
  TICKS_PER_SECOND,
  UNIT_DEFS,
  // ★ 0.2：野怪统一显示成「野怪」（和客户端同一个实现）
  displayNameOf,
  copiesOf,
  decodeMessage,
  encodeMessage,
  isMonsterRound,
  isValidRoomCode,
  // ★★ 0.3 盟约：文案/名字要显示"哪一位选了哪个"
  covenantOf,
  monsterWaveForRound,
  monsterWaveText,
  // ★ 0.3 昵称：清洗 / 2~8 字 / 重名判定（规则只在 shared/names.ts 一处）
  nameTakenIn,
  playerNameError,
  sanitizePlayerName,
  // ★ 0.1.3：前 3 回合布阵用 30 秒（规则在 shared，界面文案和服务器共用一个数）
  prepSecondsForRound,
  // ★ 0.3.2 升变形态不能出售（多人模式这边也拦一道，防改客户端）
  isSellLockedDefId,
  sanitizeFever,
  simulate,
  // ★ 0.1.1：备战席上报的形状（观战展示 + 淘汰回库都要用）
  type BenchUnitView,
  // ★ 0.1.2：战斗广播的具名形状（缓存 + 重连补发都用它，别再抄一遍字段）
  type BattleStartPayload,
  type ClientMessage,
  // ★ 0.1.4：藏品栏快照的形状（重连时原样发回客户端，见 sanitizeItemBag）
  type ItemBagSnapshot,
  type PlayerView,
  type RoomView,
  type ServerMessage,
  type SubmittedTeam,
  type TeamSetup,
  // ★★ 0.3.3 人机：难度夹取 + 显示名（文案/规则都在 shared，别在这儿再写一份）
  clampBotDifficulty,
  botDisplayName,
  type BotDifficulty,
  // ★ 0.3.31：玩家血量上限的唯一口径（藏品回血夹上限，和 Room.applyCovenantWinHeal 同一套）
  playerMaxHp,
} from '@airnight/shared';
import { RoomManager, type Room, type RoomPlayer } from './room.js';
import { lanAddresses, startLanDiscovery } from './lan.js';
import { BotBrain } from './bot.js';

/**
 * ============================================================
 *  联机服务器
 * ============================================================
 *
 * 【整体架构 —— 这是自走棋联机最省力的做法】
 *
 *  准备阶段：服务器是权威。谁买了什么、商店出了什么、金币多少，全在服务器算。
 *  战斗阶段：服务器只广播「种子 + 双方阵容」这么一小段数据（几百字节），
 *           每台客户端本地跑 simulate() 演出完全一样的战斗。
 *           所以战斗期间没有任何实时同步压力，也不需要 rollback netcode。
 *  校验：   服务器自己也跑一遍 simulate()，把校验和发给客户端。
 *           客户端算完比对，不一致就上报（说明确定性被破坏了）。
 *
 * 这意味着：6 个朋友的房间，一台最便宜的小服务器就能扛。
 */

interface Connection {
  /**
   * ★★ 0.3.3：这里原本写的是 `WebSocket`，现在收窄成"只用得到的那三个成员"。
   *
   * 【为什么要收窄？—— 因为人机没有 socket】
   * 人机跑在服务端进程里，它的"连接"应该是一条**内存通道**：
   * `send()` 直接把广播交给 `BotBrain.onServerMessage`。如果这里坚持要真 WebSocket，
   * 就得给 `send()` 到处开分支（`if (connection.bot) ... else socket.send(...)`）——
   * 那样"人机走的是同一个接口"这句话就不再成立了。
   * 收窄成结构类型之后，真 WebSocket 天然满足它，人机也天然满足它，`send()` 一行都不用改。
   */
  socket: {
    readyState: number;
    send(data: string): void;
    close(code?: number, reason?: string): void;
  };
  playerId: string;
  roomCode: string | null;
  alive: boolean;
}

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '0.0.0.0';

const rooms = new RoomManager();
/**
 * ★★ 0.3.3：**人机的连接**（playerId -> 内存会话）。
 *
 * 【为什么它和 `connections` 分开？】
 * `connections` 是"谁有 socket"（真人），它被用于断线重连、宽限期、踢人……
 * 那些流程对人机一律不适用（人机不会掉线、不能踢、不需要令牌）。
 * 但**广播**必须能发到人机 —— 所以人机的 connection 也要进 `connections`。
 * 于是分工是：
 *   · `connections` 里可能有真人，也可能有人机（`broadcast` 靠它）；
 *   · `bots` 只放人机的大脑，用来"这个人机是谁、怎么处置它"。
 */
const bots = new Map<string, BotBrain>();
/** 人机的思考节奏（测试压到很小，一局能秒跑完；生产用 1） */
function botSpeed(): number {
  const raw = Number(process.env.AIRNIGHT_BOT_SPEED ?? 1);
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

/**
 * ★ 0.0.3 末：局域网发现（广播 + 监听）。
 * 只有 `startServer` 起来之后才有值；测试里可能没起（就是 null）。
 */
let lan: ReturnType<typeof startLanDiscovery> | null = null;
const connections = new Map<string, Connection>();
/**
 * ★ 0.1.2 断线重连：身份从"这条 socket"里拆出来，做成一张**有时效的令牌**。
 *
 * 【为什么非做不可？】
 * 以前 `playerId` 是随每条新连接现生成的（见 newPlayerId），
 * 连接一断就作废 —— 于是玩家掉线 = 被踢回主界面、血量战绩座位全没。
 * 现在每条连接都会领到一枚令牌（只发给本人），断线只把座位标成"离线"，
 * 重连时凭令牌换回**同一个 playerId**：
 *   · 座位（血量 / 战绩 / 等级）原样还在（Room.addPlayer 的 existing 分支）；
 *   · ★ 商店随机序列也不会重置 —— 客户端的商店种子是
 *     `hash('airnight-shop|房间码|playerId')`，playerId 一变商店就整批重来。
 */
const sessionsByToken = new Map<string, Session>();
/** playerId -> 它的令牌（同一玩家重新领令牌时用来清掉旧条目） */
const tokenByPlayer = new Map<string, string>();
/** playerId -> 宽限期计时器（重连成功就撤销） */
const graceTimers = new Map<string, NodeJS.Timeout>();

interface Session {
  playerId: string;
  /** 这条会话最后一次所在的房间（断线期间保留，重连要靠它找座位） */
  roomCode: string | null;
}

/**
 * ★ 0.1.2：这一回合每一场战斗的广播载荷（房间码 -> 本回合的全部战斗）。
 *
 * 【为什么必须缓存？】`battleStart` 原来是"发完即弃"的（服务端零缓存）。
 * 战斗中掉线再回来的人收不到任何战斗内容 —— 界面停在空白，
 * 而且他根本不知道这一回合已经打到哪了。缓存一份，重连时一次性补发。
 * 清理点只有一个：`beginPrepPhase` 开头（新回合开始，上一回合的战斗作废）。
 */
const battleCache = new Map<string, { round: number; payloads: CachedBattle[] }>();

/** 缓存里的一条：广播载荷 + 它是**什么时候**广播的（给重连者算"该从第几秒接上"） */
interface CachedBattle {
  payload: BattleStartPayload;
  /** 服务端的广播时刻（Date.now()）。由服务端算差值，所以不受两端时钟差影响 */
  at: number;
}

/**
 * ★ 0.1.2：断线后"座位保留多久"。
 *
 * 【为什么大厅短、对局长？】
 *   · 大厅掉线代价小（还没开局），早点腾出位置给别人；
 *   · 对局掉线代价很大（血量、经济、阵容都在座位上），必须给足重连时间。
 *     一个完整回合最长 = 60 秒布阵 + 最多 164 秒战斗兜底，
 *     所以对局的宽限期一定要**大于一个回合**，否则"宽限期比回合还短"，
 *     人还没回来座位就没了。
 * 【为什么不学参考项目做"整局保留"或"24 小时"？】
 * 它的单人对局完全不限时，所以能那么宽容。我们这个是对抗局，
 * 座位一直留着会让"掉线不再回来"的人永远占着牌库和血量（别人还得陪他打），
 * 所以取一个"够回来、又不至于无限期占位"的值。
 *
 * ★★ 0.1.4：**大厅从 30 秒加长到 3 分钟**（用户要求"和房间内那个 3 分钟显示一致"）。
 *   30 秒实在是太短了 —— 实测（见 memory 的 2026-10-15）：
 *   "关掉浏览器、再双击启动游戏.cmd、等页面加载完"这一串动作**轻松超过 30 秒**，
 *   于是刚回到页面座位就已经被清掉，重连只能拿到 BAD_TOKEN，
 *   玩家看到的就是"重连有概率失败"。
 *   现在 3 分钟和玩家在房间里看到的那个暂停倒计时（3:00）是同一个数量级，
 *   认知上也一致：**大厅等 3 分钟，对局等 5 分钟**。
 *
 * ★ 测试可以用 `AIRNIGHT_RESUME_GRACE_MS` 把两个值一起压到很小，
 *   这样"宽限期到点 -> 座位真的被清掉"那条路才测得到（否则跑一条用例要等 3 分钟）。
 */
function graceFromEnv(fallback: number): number {
  const raw = Number(process.env.AIRNIGHT_RESUME_GRACE_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/** 大厅：3 分钟（★ 0.1.4 从 30 秒加长，见上面 graceFromEnv 的说明） */
export const RESUME_GRACE_LOBBY_MS = graceFromEnv(180_000);
/** 对局：5 分钟（要大于一个完整回合，见上面说明） */
export const RESUME_GRACE_MATCH_MS = graceFromEnv(300_000);

/** 令牌：16 字节随机 hex（128 位）。用 crypto 而不是 Math.random —— 后者可预测 */
function newResumeToken(): string {
  return randomBytes(16).toString('hex');
}

/** 登记一条会话（并清掉这个玩家上一次的令牌条目，避免一张脸两个令牌） */
function registerSession(playerId: string, token: string): void {
  const previous = tokenByPlayer.get(playerId);
  if (previous) sessionsByToken.delete(previous);
  tokenByPlayer.set(playerId, token);
  sessionsByToken.set(token, { playerId, roomCode: null });
}

/** 撤销一条会话（玩家真的离开/被清掉座位时用） */
function forgetSession(playerId: string): void {
  const token = tokenByPlayer.get(playerId);
  if (token) sessionsByToken.delete(token);
  tokenByPlayer.delete(playerId);
  clearGrace(playerId);
}

/** 记住"这个玩家的座位在哪个房间"—— 断线重连全靠它找回去 */
function linkSessionToRoom(playerId: string, roomCode: string): void {
  const token = tokenByPlayer.get(playerId);
  const session = token ? sessionsByToken.get(token) : undefined;
  if (session) session.roomCode = roomCode;
}
/** ★ 0.2 商店回合：房间码 -> 商店阶段的倒计时器（和 prepTimers 分开，别互相顶掉） */
const shopTimers = new Map<string, NodeJS.Timeout>();
/** ★ 0.2：房间码 -> 商店阶段开始的时刻（"还剩几秒"是算出来的，不另存一份） */
const shopStartedAt = new Map<string, number>();
/** ★ 0.2：房间码 -> 这一轮商店一共几秒 */
const shopDurations = new Map<string, number>();
const prepTimers = new Map<string, NodeJS.Timeout>();
/** ★★ 0.3：盟约选秀的秒表（每个房间一个，一次只给一个人计时） */
const covenantTimers = new Map<string, NodeJS.Timeout>();
/** 房间码 -> 本回合准备阶段的开始时间戳（用来算倒计时剩余秒数） */
const prepStartedAt = new Map<string, number>();
/**
 * 房间码 -> 这一次倒计时**一共数多少毫秒**。
 * 正常就是"这个回合的布阵时长"，暂停恢复后可能只剩一小截 ——
 * 拿回合默认值去算剩几秒会当场跳一下，所以要把实际时长记下来。
 */
const prepDurations = new Map<string, number>();

/*
  暂停 / 投票 / 超时淘汰那一套在下面（"★ 0.1.4：暂停 / 投票 / 超时淘汰"那一段）——
  ★ `PauseResume` / `pausedRooms` 只有那一份，别在这儿再加一份
    （重复声明 TS 会直接报错，但两处各写一半逻辑照样会跑歪）。
*/

/**
 * 房间码 -> 这一回合「正在等谁看完战斗」。
 *
 * 见 `queueRoundAdvance` 的注释：有了它，慢的机器不会被快的机器甩下。
 */
const playbackWaiters = new Map<string, RoundPlayback>();

interface RoundPlayback {
  round: number;
  /** 还在等谁的回执 */
  pending: Set<string>;
  /** 这一回合合法的 battleId（防止客户端拿上一场的回执来冒充） */
  battleIds: Set<string>;
  /** 收齐回执（或者兜底超时）之后要做的事 */
  onReady: () => void;
  timer: NodeJS.Timeout;
  /**
   * 「有人看完了」之后才开始的硬超时（0.0.2 新增）。
   *
   * 【为什么要多一个计时器？】
   * 上面那个 `timer` 是从"战斗开始"就计的兜底，最长能到 3 分钟 ——
   * 对"点开别的窗口发呆"的人是够宽容的，但也意味着
   * **先看完的人要陪着等 3 分钟**，体验很差。
   * 而"战斗其实早就该结束了、他就是没在"这种情况，等到 70 秒也足够了。
   * 所以：一旦有第一个人举手，就再挂一个 70 秒的硬超时兜底。
   * undefined 表示这一回合还没有人看完。
   */
  hardTimer?: NodeJS.Timeout;
  fired: boolean;
}

/**
 * 阵容人口上限（**只做兜底，不是游戏规则**）。
 *
 * 【真正的规则在客户端】`popCap(state)` = 等级 + 藏品加成：
 * 每级 +1 人口（`populationCap`），再加「地形图」那类 `onEquip.popCap`。
 *
 * 【★★ 0.3.2 修】以前这里写的是 `MAX_LEVEL`（=10）—— 于是**满级 + 一件地形图**
 * 就变成 11 人口，客户端允许摆、服务端却按 10 个裁掉第 11 个：
 *   · 玩家看到"我的棋子被服务器吃了"（`TEAM_REPAIRED`：超过人口上限）；
 *   · 更糟的是客户端按 11 个本机模拟战斗、服务端按 10 个算 ⇒ **两边结果不同**
 *     （这就是"平行世界"的一大来源）。
 * 现在放宽到 `MAX_LEVEL + 共享装备位格数`：地形图是 **B 类（共享）**藏品，
 * 最多只能放满共享装备位（4 格）⇒ 理论最大 10+4=14，取这个数既不会裁掉合法阵容，
 * 又能拦住"想摆二十个 5 费"这种畸形/作弊的请求。
 */
export const MAX_POPULATION = MAX_LEVEL + ITEM_B_EQUIP_SLOTS;

/**
 * ★ 影子对战里"影子那一方"占用的假玩家 id（见 runBattlePhase 的轮空处理）。
 *
 * 【为什么必须是假 id？】
 * 影子是某个玩家阵容的复制品，不是他本人出战。
 * 如果 team1PlayerId 填了他的真实 id，那位玩家的客户端会算出
 * `amIPlaying === true` —— 以为这一场有自己在打，视角会翻转、结算会串。
 * 所以用一个永远不会和真实 id 撞车的常量（真实 id 形如 `p3-mv16svlm`）。
 */
export const GHOST_PLAYER_ID = 'ghost';

let playerCounter = 0;
function newPlayerId(): string {
  playerCounter++;
  return `p${playerCounter}-${Date.now().toString(36)}`;
}

// ============================================================
// 消息发送辅助
// ============================================================

function send(connection: Connection, message: ServerMessage): void {
  if (connection.socket.readyState !== 1) return;
  connection.socket.send(encodeMessage(message));
}

function sendError(connection: Connection, code: string, message: string): void {
  send(connection, { t: 'error', code, message });
}

/**
 * ★ 0.1.3：**版本不一致就不让联机**。
 *
 * 返回 false 表示"已经回过错误了，别再往下走"。
 *
 * 【为什么必须在服务端拦？】
 * 客户端自己比对 `welcome.serverVersion` 只是给自己提个醒；
 * 老客户端（或者手动构造消息的人）照样能发请求。而两边版本不同的后果
 * 不是"少个功能"，是**同一个局面算出不同结果**（协议字段、战斗内核算法
 * 都可能变了）—— 联机里表现为"莫名其妙打输/打赢"，极难排查。
 * 所以宁可直接拒绝，并且把两边各是什么版本说清楚。
 *
 * 【老客户端不发 version 怎么办？】
 * 一律当成不兼容 —— 它本来就可能对不上，让它先进来再出怪问题更糟。
 */
function ensureSameVersion(connection: Connection, version: unknown): boolean {
  const client = typeof version === 'string' ? version.trim() : '';
  if (client === SERVER_VERSION) return true;
  sendError(
    connection,
    'VERSION_MISMATCH',
    `版本不一致：你的是 ${client || '未知版本'}，房主这边是 ${SERVER_VERSION}。` +
      '请所有人用同一个安装包再联机。',
  );
  return false;
}

/** 广播给房间里所有在线的人 */
function broadcast(room: Room, message: ServerMessage): void {
  for (const player of room.players) {
    const connection = connections.get(player.id);
    if (connection && connection.alive) send(connection, message);
  }
}

/**
 * 广播牌库：还剩几张 + 哪几张正被别人"预定"在商店里。
 * 【为什么合成一个函数？】三处都要发，漏掉一处就会出现
 * "某些情况下预订失效"这种极难复现的 bug。
 */
function broadcastPool(room: Room): void {
  broadcast(room, { t: 'pool', remaining: room.poolRemaining(), held: room.poolHeld() });
}

/**
 * ★ 0.1.1：某个玩家被淘汰时**唯一**的处置入口。
 *
 * 一次做完三件事：
 *   1. 广播 `playerEliminated` —— 客户端据此切到「只能观战」的状态（关商店、锁操作）；
 *   2. 把他**场上 + 备战席**的牌全部还回共享牌库 —— 不还的话剩下的人永远抽不到那几张，
 *      残局会越打越"没牌"；
 *   3. 广播新的牌库数量 —— 别人的商店角标要跟着变。
 *
 * 【为什么必须收成一个函数？】
 * 淘汰有三个触发点（野怪回合 / 真人配对 / 影子对战）。
 * 以前每个点各自 broadcast 一条就完事，现在多了"还牌 + 广播牌库"，
 * 分三处写必然漏掉一两处 —— 这个项目在"同一个动作写两遍"上踩过不止一次。
 */
function eliminatePlayer(room: Room, playerId: string): void {
  const player = room.getPlayer(playerId);
  if (!player || player.hp > 0) return;
  broadcast(room, { t: 'playerEliminated', playerId });
  // ★ markEliminated = 先快照"死亡时的阵容"（结算页要），再还牌
  room.markEliminated(player);
  broadcastPool(room);
  broadcastRoom(room);
  console.log(`[房间 ${room.code}] ${player.name} 被淘汰，手上与场上的牌已归还牌库`);
}

/**
 * ★ 0.1.1：这一场有哪些玩家用上了「阵容丢失保底」。
 * 传给 battleStart.safetyNetFor，客户端据此提示玩家。
 */
function safetyNetIds(room: Room, ids: string[]): string[] | undefined {
  const out: string[] = [];
  for (const id of ids) {
    const player = room.getPlayer(id);
    if (player && room.usedSafetyNet(player)) out.push(id);
  }
  // 没人用到兜底就不发这个字段（JSON 会把 undefined 整个丢掉）
  return out.length > 0 ? out : undefined;
}

/** 把房间内部状态转成可以发给客户端的视图（不泄露敏感/无用数据） */
function toRoomView(room: Room): RoomView {
  const players: PlayerView[] = room.players.map((player) => ({
    id: player.id,
    name: player.name,
    avatarId: player.avatarId,
    ready: player.ready,
    connected: player.connected,
    hp: player.hp,
    submitted: player.submitted,
    round: room.round,
    wins: player.wins,
    losses: player.losses,
    level: player.level,
    streak: player.streak,
    // ★★ 0.3：对局里的玩家列表要显示"他选了哪个盟约"
    ...(player.covenantId ? { covenantId: player.covenantId } : {}),
    /*
      ★★ 0.3.3：把"是不是人机 / 什么难度"直接放进广播。
      客户端据此在大厅里画「改难度 / 移除」按钮，在对局里标「人机 · 困难」。
      ★ 不让人机出现在断线重连、宽限期这些流程里（`connected` 恒为 true 就行，
        它本来就不会掉线）。
    */
    ...(player.isBot ? { isBot: true, botDifficulty: player.botDifficulty } : {}),
  }));
  return {
    code: room.code,
    hostId: room.hostId,
    // ★★ 0.3.2：修订号（客户端据此判断"我有没有漏收广播"，见 RoomView.rev）
    rev: room.rev,
    phase: room.phase,
    round: room.round,
    players,
    prepSecondsLeft: prepSecondsLeftOf(room),
    /*
      ★ 0.1.4：暂停（有活人掉线）要让界面能说出来，不然看起来像卡死。
      除了 `paused` 还带上倒计时和投票进度 —— 客户端那颗「同意」按钮
      和"还差几个人"都要显示，缺一个玩家就只能瞎猜。
    */
    /*
      ★ 0.3：房间设置必须**每一份房间视图**都带上。
      它是这一局规则的唯一真相 —— 开局血量、布阵时长、每回合收入都从这儿读，
      少了它客户端就只能退回默认值，于是"房主看到 5000 血、别人看到 100 血"。
    */
    settings: room.settings,
    /*
      ★★ 0.3 盟约选秀进度。
      ★ 只给"现在轮到谁"，**不给完整顺序** —— 用户口径：顺序随机且不显示。
    */
    ...(room.phase === 'covenant'
      ? {
          covenant: {
            currentPlayerId: room.currentCovenantPicker()?.id ?? '',
            secondsLeft: covenantSecondsLeftOf(room),
            remaining: room.covenantRemaining(),
            total: room.covenantOrder.length,
          },
        }
      : {}),
    paused: isMatchPaused(room.code),
    ...(isMatchPaused(room.code)
      ? {
          pauseSecondsLeft: pauseSecondsLeftOf(room.code),
          pauseVoteCount: pauseVoteInfo(room).voteCount,
          pauseVoteNeeded: pauseVoteInfo(room).voteNeeded,
        }
      : {}),
  };
}

/**
 * 实际使用的布阵时长（秒）。
 *
 * 【为什么要能覆盖？】
 * 布阵是 60 秒的定时制 —— 时间不到就不开打。
 * 而端到端测试要"提交阵容 -> 等 battleStart"，
 * 真等 60 秒的话每个用例都要一分钟，一轮测试下来十几分钟，没人会去跑。
 * 所以留一个环境变量口子，测试里设成 1 秒。
 *
 * 生产行为不受影响（不设这个变量就是 60 秒），而且只有服务端读它 ——
 * 客户端的倒计时是服务器通过 prepTick 推过来的，本来就不需要自己算。
 */
const PREP_SECONDS_ACTUAL = Math.max(1, Number(process.env.AIRNIGHT_PREP_SECONDS ?? PREP_SECONDS) || PREP_SECONDS);

/**
 * 环境变量 `AIRNIGHT_PREP_SECONDS` 有没有被显式设过。
 * 设了就**所有回合**都用它（端到端测试要等 60 秒的话没人愿意跑）；
 * 没设就走正常的"前 3 回合 30 秒、其余 60 秒"。
 */
const HAS_PREP_OVERRIDE = Number(process.env.AIRNIGHT_PREP_SECONDS ?? '') > 0;

/** 这一回合该等多少秒布阵（★ 0.1.3：前 3 回合 30 秒，其余 60 秒） */
function prepSecondsFor(room: Room): number {
  /*
    ★ 0.3：三层优先级 **环境变量 > 房间设置 > 默认曲线**。
    环境变量排最前是因为它只服务端到端测试（要在几秒内跑完一回合），
    不能让房主的设置把测试卡住。
    第 1~3 回合仍然是固定的 30 秒 —— 这条规则在 `prepSecondsForRound` 里，
    单机和这里共用同一份。
  */
  return HAS_PREP_OVERRIDE ? PREP_SECONDS_ACTUAL : prepSecondsForRound(room.round, room.settings.prepSeconds);
}

/**
 * ★ 0.2：商店回合几秒（默认 90）。
 *
 * 【为什么要能覆盖？】和布阵同一个理由 —— 联机对局测试台要跑到第 9 回合之后
 * 才会遇到商店，真等 90 秒没人愿意跑。设 `AIRNIGHT_SHOP_SECONDS=3` 就能秒过。
 * 生产不设这个变量就是 90 秒。
 */
/**
 * ★★ 0.3：盟约选秀每人多少秒。
 * 和布阵/商店一样留了环境变量口子 —— 端到端测试要真等 30 秒就没法跑。
 */
const COVENANT_SECONDS = Math.max(3, Number(process.env.AIRNIGHT_COVENANT_SECONDS ?? 30) || 30);

const SHOP_SECONDS_ACTUAL = Math.max(
  1,
  Number(process.env.AIRNIGHT_SHOP_SECONDS ?? SHOP_ROUND_SECONDS) || SHOP_ROUND_SECONDS,
);

/**
 * 准备阶段还剩几秒。
 *
 * 【为什么不用一个变量存着？】
 * 因为「还剩几秒」是可以算出来的：总时长减去已经过去的时间。
 * 用一个变量去记它，就多了一份需要同步维护的状态 —— 一旦忘了更新就会显示错。
 * 能算出来的东西就不要存。
 *
 * ★ 暂停中（人不够）时用记下来的"剩余毫秒"—— 那一份是 `pauseMatch` 特意存下来的，
 *   因为暂停期间"已经过去的时间"在走，但倒计时**不该**跟着走。
 */
function prepSecondsLeftOf(room: Room): number {
  if (room.phase !== 'prep') return 0;
  const paused = pausedRooms.get(room.code);
  if (paused && paused.resume.kind === 'resume-prep') return Math.ceil(paused.resume.remainingMs / 1000);
  const startedAt = prepStartedAt.get(room.code);
  if (!startedAt) return 0;
  // ★ 用"这一次真的数了多少秒"而不是"这个回合本该多少秒" —— 暂停恢复后接着数的
  //   剩余秒数可能不是整数倍，拿回合默认值去算会当场跳一下。
  const totalMs = prepDurations.get(room.code) ?? prepSecondsFor(room) * 1000;
  return Math.max(0, Math.ceil((startedAt + totalMs - Date.now()) / 1000));
}

/** 布阵还剩多少毫秒（暂停时要把这个数记下来，恢复时接着数） */
function prepRemainingMsOf(room: Room): number {
  if (room.phase !== 'prep') return 0;
  const startedAt = prepStartedAt.get(room.code);
  if (!startedAt) return 0;
  const totalMs = prepDurations.get(room.code) ?? prepSecondsFor(room) * 1000;
  return Math.max(0, startedAt + totalMs - Date.now());
}

function broadcastRoom(room: Room): void {
  /*
    ★★ 0.3.2：修订号在**唯一出口**上自增 —— 所有房间广播都从这里出去，
    所以客户端拿到的 `rev` 一定是连续递增的；漏收一条就会跳号。
  */
  room.rev += 1;
  broadcast(room, { t: 'room', room: toRoomView(room) });
}

// ============================================================
// ★ 0.1.4：暂停 / 投票 / 超时淘汰（用户要求的那套规则）
// ============================================================
//
// 【规则一条一条写清楚，免得以后又被改回去】
//   1. 只要有**还活着**的玩家掉线，对局就暂停（0.1.3 要求"在线不足 2 人"才暂停，
//      现在放宽了：4 个人里掉 1 个也停下来等）；
//   2. 暂停有明确时限：**3 分钟**。暂停期间**又有人掉线 -> 倒计时重新开始**（用户要求）；
//   3. 暂停时**所有人**（在线的人）屏幕上弹一个窗，只有一颗「同意」按钮：
//      在线的人**全部点了同意** -> 暂停立刻结束，掉线那位**当场淘汰**；
//   4. 3 分钟到点还没回来 -> 同样是**淘汰**；
//   5. 掉线的人自己回来了（重连成功）-> 暂停立刻解除，接着打（不需要投票）。
//
// 【为什么"恢复时该干什么"要记下来，而不是加一个 phase？】
// 暂停可能发生在两个完全不同的时刻（布阵打到一半 / 一轮刚结算完），
// 恢复时要做的事也不一样（把剩下的秒数接着数完 / 开下一回合）。
// 记一个意图比记一堆"当时是什么阶段、还剩几秒"的分支清楚得多。

export const PAUSE_MS = (() => {
  const raw = Number(process.env.AIRNIGHT_PAUSE_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 180_000;
})();

type PauseResume =
  /** 布阵阶段被打断：恢复时把剩下的毫秒接着数完 */
  | { kind: 'resume-prep'; remainingMs: number }
  /** 一轮刚结算完、正要开下一回合：恢复时直接开下一回合 */
  | { kind: 'next-round' };

interface PauseState {
  /** 恢复时该干什么 */
  resume: PauseResume;
  /** 倒计时到点的时刻（暂停中又有人掉线 -> 重新计一次） */
  endsAt: number;
  /** 已经点过「同意」的人 */
  votes: Set<string>;
  /** 每秒推一条 `pauseTick` 的定时器 */
  timer: NodeJS.Timeout;
}

const pausedRooms = new Map<string, PauseState>();

/** 暂停还剩几秒（对外显示用） */
function pauseSecondsLeftOf(roomCode: string): number {
  const state = pausedRooms.get(roomCode);
  if (!state) return 0;
  return Math.max(0, Math.ceil((state.endsAt - Date.now()) / 1000));
}

/** 现在**在线且活着**的人（投票的"分母"：只有他们能点同意） */
function onlineVoterIds(room: Room): string[] {
  return room.players.filter((p) => p.connected && p.hp > 0).map((p) => p.id);
}

/** 投票进度：`voteCount` 只数"现在还在线的人"投过的票 */
function pauseVoteInfo(room: Room): { voteCount: number; voteNeeded: number } {
  const state = pausedRooms.get(room.code);
  const voters = onlineVoterIds(room);
  if (!state) return { voteCount: 0, voteNeeded: voters.length };
  return {
    voteCount: voters.filter((id) => state.votes.has(id)).length,
    voteNeeded: voters.length,
  };
}

/**
 * 该暂停吗？—— **只要有一个活人掉线就暂停**（★ 0.1.4 放宽的判据）。
 *
 * 【为什么不再看"在线人数 < 2"？】
 * 用户的要求是"只要有一个人掉线就都暂停"：4 个人里走了一个，
 * 剩下的 3 个也不该在一轮一轮里被那个空座位拖着打（他是"人不在、血还在"，
 * 会照常参与配对 —— 之前房主被无限拖下去的根因就是这个）。
 * 已经淘汰（血量 0）的人不算：座位还在宽限期里，但他早就不在局里了。
 */
function shouldPauseMatch(room: Room): boolean {
  /*
    ★ 0.3：大厅和**盟约选秀**都不暂停 —— 选秀自带 30 秒超时兜底，
    这时候再叠一层"等待掉线者"的浮层只会让人以为游戏坏了。
  */
  if (room.phase === 'lobby' || room.phase === 'covenant') return false;
  return room.players.some((p) => p.hp > 0 && !p.connected);
}

/** 这个房间现在是不是暂停中 */
function isMatchPaused(roomCode: string): boolean {
  return pausedRooms.has(roomCode);
}

/** 广播一条暂停节拍（只有浮层上那几个数字会变） */
function broadcastPauseTick(room: Room): void {
  const { voteCount, voteNeeded } = pauseVoteInfo(room);
  broadcast(room, {
    t: 'pauseTick',
    secondsLeft: pauseSecondsLeftOf(room.code),
    voteCount,
    voteNeeded,
  });
}

/**
 * 暂停对局：停掉布阵倒计时、起一个 3 分钟倒计时、广播出去。
 *
 * ★ 只停**布阵**计时；战斗阶段（battle/resolve）不在这里打断 ——
 *   剩下的人还在看自己的战斗，让他看完、回执交完，
 *   轮到"要不要开下一回合"那一步时自然会被拦下来（见 runBattlePhase 的 onReady）。
 * ★ 暂停途中又被调用一次（又有人掉线）-> **重新计时**，并且已经投过的票作废
 *   （人变了，得重新表态）。
 */
function pauseMatch(room: Room, resume: PauseResume): void {
  /*
    ★★ 0.3.2：**选秀阶段永不暂停**（这里是硬闸，不只是靠 `shouldPauseMatch`）。
    用户报过"盟约界面有人断线也弹暂停浮层、倒计时还停住"：
    选秀本来就有 30 秒超时兜底，再叠一层"等掉线的人"只会让人以为游戏坏了。
    调用方将来漏判也没关系 —— 这道闸兜住。
  */
  if (room.phase === 'covenant') return;
  const prep = prepTimers.get(room.code);
  if (prep) {
    clearInterval(prep);
    prepTimers.delete(room.code);
  }

  const already = pausedRooms.get(room.code);
  if (already) {
    /*
      ★ 已经暂停着（暂停途中又有人掉线）：**保留最早那份布阵剩余时间**，
      不要被后来的重复调用越减越少 —— 暂停之后 `prepStartedAt` 没动，
      而"现在"一直在走，再算一次剩余会把这几分钟白白算进去，恢复时倒计时直接跳没。
    */
    if (!(already.resume.kind === 'resume-prep' && resume.kind === 'resume-prep')) {
      already.resume = resume;
    }
    already.endsAt = Date.now() + PAUSE_MS;
    already.votes.clear();
    console.log(
      `[房间 ${room.code}] 暂停中又有人掉线，倒计时重新开始（${Math.round(PAUSE_MS / 1000)} 秒）`,
    );
    broadcastRoom(room);
    broadcastPauseTick(room);
    return;
  }

  const state: PauseState = {
    resume,
    endsAt: Date.now() + PAUSE_MS,
    votes: new Set(),
    timer: setInterval(() => {
      const current = pausedRooms.get(room.code);
      if (!current) return;
      if (Date.now() >= current.endsAt) {
        resolvePause(room, 'timeout');
        return;
      }
      broadcastPauseTick(room);
    }, 1000),
  };
  pausedRooms.set(room.code, state);
  const absent = room.players.filter((p) => p.hp > 0 && !p.connected).map((p) => p.name);
  console.log(
    `[房间 ${room.code}] 第 ${room.round} 回合暂停（${Math.round(PAUSE_MS / 1000)} 秒）：` +
      `${absent.join('、') || '（有人不在）'} 掉线了，等他回来或所有人点同意`,
  );
  broadcastRoom(room);
  broadcastPauseTick(room);
}

/**
 * 结束暂停：先把**掉线还没回来的人淘汰掉**，再让对局继续。
 *
 * @param reason `'timeout'` = 3 分钟到点；`'vote'` = 在线的人全部点了同意
 *
 * 【为什么两种原因走同一条路？】
 * 用户的要求里它们的结果是同一个：**淘汰掉线的那位**、剩下的人接着打。
 * 写两份必然漏掉"淘汰之后只剩一个人 -> 该收尾了"这类分支。
 */
function resolvePause(room: Room, reason: 'timeout' | 'vote'): void {
  const state = pausedRooms.get(room.code);
  if (!state) return;
  const resume = state.resume;
  clearPause(room.code);

  for (const player of room.players) {
    if (player.hp <= 0 || player.connected) continue;
    console.log(
      `[房间 ${room.code}] ${player.name} ${reason === 'vote' ? '被投票淘汰' : '暂停超时没回来，淘汰'}`,
    );
    player.hp = 0;
    eliminatePlayer(room, player.id);
  }
  broadcastRoom(room);

  // 淘汰之后可能只剩一个人 —— 那就直接收尾，不用再开一回合让他干等
  if (endMatchIfLoneSurvivor(room)) return;

  console.log(`[房间 ${room.code}] 暂停结束（${reason}），第 ${room.round} 回合继续`);
  if (resume.kind === 'next-round') {
    beginPrepPhase(room);
  } else {
    // ★ 单位是**秒**（`startPrepCountdown` 收的就是秒），别把毫秒直接甩进去
    startPrepCountdown(room, Math.max(1, Math.ceil(resume.remainingMs / 1000)));
    broadcastRoom(room);
  }
}

/**
 * 有人点了「同意」。在线的人**全部**点过 -> 暂停立刻取消（掉线那位当场淘汰）。
 * 掉线的人投不了票，所以"全部"只算在线的人。
 */
function votePause(room: Room, playerId: string): void {
  const state = pausedRooms.get(room.code);
  if (!state) return;
  const voters = onlineVoterIds(room);
  if (!voters.includes(playerId)) return; // 掉线的人不给投（他也没有浮层可点）
  if (state.votes.has(playerId)) return;
  state.votes.add(playerId);
  console.log(
    `[房间 ${room.code}] ${room.getPlayer(playerId)?.name ?? playerId} 同意取消暂停` +
      `（${pauseVoteInfo(room).voteCount}/${voters.length}）`,
  );
  if (voters.every((id) => state.votes.has(id))) {
    resolvePause(room, 'vote');
    return;
  }
  broadcastPauseTick(room);
}

/**
 * 人回来了 -> 接着打（不需要投票）。
 * 什么时候调：重连成功（resume）之后。
 */
function tryResumeMatch(room: Room): void {
  const state = pausedRooms.get(room.code);
  if (!state) return;
  if (shouldPauseMatch(room)) return; // 还有人没回来，接着等
  const resume = state.resume;
  clearPause(room.code);
  console.log(`[房间 ${room.code}] 掉线的人回来了，第 ${room.round} 回合继续`);
  if (resume.kind === 'next-round') {
    beginPrepPhase(room);
  } else {
    /*
      布阵打到一半被打断：把剩下的秒数接着数完。
      ★ 单位是**秒**（`startPrepCountdown` 收的就是秒）——
      这里直接甩毫秒过去会让倒计时变成"几千秒"，对局看着就像卡死了。
      不足 1 秒的零头向上取整，别让人白等那一轮。
    */
    startPrepCountdown(room, Math.max(1, Math.ceil(resume.remainingMs / 1000)));
    broadcastRoom(room);
  }
}

/**
 * ★ 0.1.4：场上只剩一个还活着的人 -> 判他赢、结束对局。
 *
 * 【什么时候调？】
 *   · 座位真的被清掉之后（宽限期到点 / 主动退出 / 被踢）；
 *   · 暂停结束、掉线的人被淘汰之后（这时候可能就只剩一个人了）。
 *
 * 【判据为什么从"房间里只剩 1 个人"改成"只剩 1 个**活着**的人"？】
 * 因为淘汰**不移除座位**（还留着宽限期给他重连观战），
 * 按"房间里几个人"数的话会永远收不了尾（0.1.3 那个"房主被无限拖着打"的坑的邻居）。
 *
 * @returns 是不是真的把对局结束了（调用方据此决定还要不要继续开回合）
 */
function endMatchIfLoneSurvivor(room: Room): boolean {
  if (room.phase === 'lobby') return false;
  const alive = room.players.filter((p) => p.hp > 0);
  if (alive.length > 1) return false;

  killRoomTimers(room.code);
  const winner = alive[0];
  if (!winner) {
    console.log(`[房间 ${room.code}] 一个人都不剩了，对局结束`);
    return true;
  }
  if (!winner.connected) {
    // 唯一活着的人自己也不在线：先别判（他回来就是他的；不回来会被暂停/宽限期收掉）
    return false;
  }
  console.log(`[房间 ${room.code}] 其他人都走了，${winner.name} 获胜`);
  broadcast(room, {
    t: 'gameOver',
    winnerId: winner.id,
    winnerName: winner.name,
    rounds: room.round,
    standings: room.standings(),
  });
  return true;
}

/** 清掉这个房间的暂停（座位没了 / 新开一局 / 暂停结束时） */
function clearPause(roomCode: string): void {
  const state = pausedRooms.get(roomCode);
  if (state) clearInterval(state.timer);
  pausedRooms.delete(roomCode);
}

/**
 * ★ 0.1.4：一个座位**真的没了**之后的统一收尾（宽限期到点 / 主动退出 / 被踢都走它）。
 *
 *   ① 只剩一个活着的人 -> 直接判他赢、结束对局；
 *   ② 否则如果暂停的**原因已经消失**（那个掉线的人被清掉了、或者人都回来了）->
 *      接着打。★ 这一条不加的话会出现"人已经走了、房间还挂着暂停倒计时"的空转。
 */
function afterSeatRemoved(room: Room): void {
  if (endMatchIfLoneSurvivor(room)) return;
  tryResumeMatch(room);
}

// ============================================================
// ★ 0.1.2 断线重连
// ============================================================

/**
 * 统一的 `welcome`。
 *
 * 【为什么抽成函数？】以前有两处各发一次、**字段还不一致**
 * （连接建立那处带 `lanAddresses`，`createRoom` 那处不带）——
 * 这次要加 `resumeToken`，再抄一遍必然漏掉其中一处。
 */
function sendWelcome(connection: Connection): void {
  send(connection, {
    t: 'welcome',
    playerId: connection.playerId,
    serverVersion: SERVER_VERSION,
    // ★ 本机的局域网 IP：界面上要告诉房主"朋友连不上时手填这个地址"
    lanAddresses: lanAddresses(),
    resumeToken: tokenByPlayer.get(connection.playerId),
  });
}

/** 撤销某个座位的宽限计时器（重连成功、或被永久移除时都要撤） */
function clearGrace(playerId: string): void {
  const timer = graceTimers.get(playerId);
  if (timer) {
    clearTimeout(timer);
    graceTimers.delete(playerId);
  }
}

/**
 * 开一张宽限计时器：到点还没回来就把座位真正移除。
 * 重新开时会覆盖旧的（断线->重连->再断线，计时器要重新起算）。
 */
function scheduleGrace(room: Room, playerId: string): void {
  clearGrace(playerId);
  const ms = room.phase === 'lobby' ? RESUME_GRACE_LOBBY_MS : RESUME_GRACE_MATCH_MS;
  const timer = setTimeout(() => {
    graceTimers.delete(playerId);
    expireSeat(room.code, playerId);
  }, ms);
  graceTimers.set(playerId, timer);
  console.log(
    `[房间 ${room.code}] ${playerId} 掉线，座位保留 ${(ms / 1000).toFixed(0)} 秒`,
  );
}

/** 宽限期到点：这个座位真的不要了（等价于他点了「离开房间」） */
function expireSeat(roomCode: string, playerId: string): void {
  const room = rooms.getRoom(roomCode);
  if (!room) return;
  const player = room.getPlayer(playerId);
  // 期间已经回来了，或者座位早被别的路径清掉了
  if (!player || player.connected) return;
  console.log(`[房间 ${roomCode}] ${playerId} 宽限期已过，移除座位`);
  rooms.leaveRoom(playerId);
  forgetSession(playerId);
  dropFromPlaybackWait(roomCode, playerId);
  if (room.isEmpty) {
    killRoomTimers(roomCode);
  } else {
    room.migrateHost();
    broadcastRoom(room);
    /*
      ★ 0.1.4：宽限期到点 = 这个座位真的不要了。
      如果因此只剩一个人（其他人都走了），就判他赢、结束对局；
      否则如果刚才那个"暂停"的原因已经消失（掉线的人被清掉了），就把对局接回去 ——
      不然房间会挂着一条没人需要的暂停倒计时。
    */
    afterSeatRemoved(room);
  }
}

/**
 * 一条连接断了：**不再无条件退房**，改成"标记离线 + 开宽限期"。
 *
 * 【三种情况必须区分清楚】
 *   1. 主动离开（`leaveRoom` / 被踢 / 回主界面）—— 那是 `leaveCurrentRoom` 的活，
 *      座位该立刻消失。所以那条路径会把 `connection.roomCode` 清成 null，
 *      这里看到 null 就什么都不做。
 *   2. 被顶号（同一令牌在别处连进来了）—— 新连接已经接管了 `connections[playerId]`，
 *      这里必须**跳过**：既不能删连接表（那会把新连接抹掉），
 *      也不能把座位标成离线（人明明在线，只是换了条 socket）。
 *      判据就是"连接表里那个人是不是我"，一句话就够。
 *   3. 真的断线 —— 标记离线、广播（别人能看到"掉线中"）、开宽限期。
 */
function handleSocketClosed(connection: Connection): void {
  connection.alive = false;
  if (connections.get(connection.playerId) !== connection) return; // 被顶号，交给新连接
  connections.delete(connection.playerId);
  const room = currentRoom(connection);
  if (!room) return;
  room.markDisconnected(connection.playerId);
  /*
    ★ 但必须**马上**把他从"等回执"的名单里摘掉。
    不摘的话，全房间要陪他等满 164 秒兜底（见 dropFromPlaybackWait 的说明）。
    代价是他这次掉线期间"不需要举手了"—— 这是对的：
    他重连回来只补看战斗、不再补发回执（补发会引入"回执迟到"的新竞态）。
  */
  dropFromPlaybackWait(room.code, connection.playerId);
  /*
    ★ 0.1.3：布阵阶段掉到只剩 1 个在线玩家 -> 把布阵倒计时**停住**等他回来。
    （战斗/结算阶段不在这里打断：剩下的人还得看完自己那一场、交回执，
      轮到"要不要开下一回合"时会被 onReady 里的闸门拦下来。）
  */
  if (room.phase === 'prep' && shouldPauseMatch(room)) {
    pauseMatch(room, { kind: 'resume-prep', remainingMs: prepRemainingMsOf(room) });
  }
  /*
    ★★ 0.3.2：**选秀阶段掉线 = 立刻替他选掉**（如果正好轮到他）。
    以前要干等满 30 秒才走"超时自动选"那条路 —— 全房间陪一个人等半分钟，
    而且那 30 秒里他会一直亮着"正在选"，看起来像卡死。
    现在：掉线那一刻就随机替他挑一个，接着轮到下一位。
  */
  if (room.phase === 'covenant') {
    const current = room.currentCovenantPicker();
    if (current && current.id === connection.playerId) autoPickCovenant(room, '掉线');
  }
  // 房主掉线要换人，否则房间会挂着一个离线房主（见 Room.migrateHost）
  room.migrateHost();
  broadcastRoom(room);
  scheduleGrace(room, connection.playerId);
}

/**
 * ★ 0.1.2：重连快照（`resumeState` 的载荷）。
 *
 * 目标：让客户端**不依赖记忆**也能回到对局现场。
 * 所以这里把所有"现在是什么样"一次性交出去 —— 房间视图、牌库、
 * 大家摆好的阵容、我本回合最后同步的阵容、以及正在播的战斗。
 */
function buildResumeState(room: Room, playerId: string): Extract<ServerMessage, { t: 'resumeState' }> {
  const player = room.getPlayer(playerId);
  const cached = battleCache.get(room.code);
  const inBattle = room.phase === 'battle' || room.phase === 'resolve';
  return {
    t: 'resumeState',
    playerId,
    serverVersion: SERVER_VERSION,
    room: toRoomView(room),
    pool: { remaining: room.poolRemaining(), held: room.poolHeld() },
    prepTeams: room.currentTeams(),
    /*
      ★★ 0.2.2：服务端手上最完整的"我" —— 优先用 `lastSeenTeam`。

      【为什么把它挪到第一位？】
      用户报过一个真事：联机里某位玩家的阵容被判为非法（站位重叠 / 越界 / 认不出的 id），
      以前服务端是"整份拒收"，于是 `player.team` 还是更旧的一份（甚至没有）。
      他重进（刷新 / 重开启动器）时拿到的是旧快照 ⇒ 这一回合摆的棋子、备战席、金币
      全部回退，得从头再摆一遍 —— 这就是"数据非法玩家重进数据丢失"。

      `lastSeenTeam` 的语义是"**本局最后一次收到的原始阵容，不管合不合法**"
      （见 RoomPlayer.lastSeenTeam），所以它才是"他手上到底有什么"的正确答案。
      `player.team` 是"能不能拿来开打"的那一份（合法才写），排在它后面只是兜底。

      ★ 顺序：本局最近提交 > 本回合合法阵容 > 最近一份非空阵容。
    */
    myTeam: player?.lastSeenTeam ?? player?.team ?? player?.lastGoodTeam ?? null,
    phase: room.phase,
    round: room.round,
    prepSecondsLeft: prepSecondsLeftOf(room),
    /*
      ★ 0.2：重连时如果正赶上商店阶段，把"商店还剩几秒"也带过去 ——
      ★ 这个数**能算出来**（商店没有暂停，起点就是阶段开始那一刻），所以不另存一份。
    */
    shopSecondsLeft: room.phase === 'shop' ? shopSecondsLeftOf(room) : 0,
    // 战斗中重连：把这一回合每一场都补给他，客户端逐条重放
    // （`elapsedMs` 让客户端能跳到"该接上的那一秒"，而不是从 0 重播）
    battles: inBattle
      ? (cached?.payloads ?? []).map((entry) => ({
          battle: entry.payload,
          elapsedMs: Math.max(0, Date.now() - entry.at),
        }))
      : [],
    eliminated: (player?.hp ?? 1) <= 0,
  };
}

/**
 * 把一场战斗的广播载荷记进本回合缓存。
 * 换回合时由 `beginPrepPhase` 整体清掉（`round` 不匹配的也顺手丢掉）。
 */
function cacheBattlePayload(roomCode: string, round: number, payload: BattleStartPayload): void {
  const entry: CachedBattle = { payload, at: Date.now() };
  const cached = battleCache.get(roomCode);
  if (!cached || cached.round !== round) {
    battleCache.set(roomCode, { round, payloads: [entry] });
    return;
  }
  cached.payloads.push(entry);
}

// ============================================================
// 回合流程
// ============================================================

/**
 * 开局：进入准备阶段，启动 60 秒倒计时。
 *
 * ★ 现在是**定时制**：时间一到，服务器拿每个人最后同步过来的阵容自动开打。
 * 不再有"全员提交就提前开打"——因为提交按钮已经删掉了，
 * 没有"我准备好了"这个信号了（详见 Room.submitTeam 的注释）。
 */
/**
 * ★ 0.2：商店阶段还剩几秒（重连快照要用）。
 * 和 `prepSecondsLeftOf` 同一个思路 —— 能算出来就不存：商店阶段没有暂停，
 * 起点就是它开始的那一刻。
 */
function shopSecondsLeftOf(room: Room): number {
  if (room.phase !== 'shop') return 0;
  const startedAt = shopStartedAt.get(room.code);
  if (!startedAt) return 0;
  const totalMs = shopDurations.get(room.code) ?? SHOP_SECONDS_ACTUAL * 1000;
  return Math.max(0, Math.ceil((startedAt + totalMs - Date.now()) / 1000));
}

function beginPrepPhase(room: Room): void {
  /*
    ★★ 0.2 商店回合：**刚刚结算完的那个回合号**要在 `beginRound()` 自增**之前**读。
    判据走 shared 的 `isShopRoundAfter`（客户端用的是同一份 ——
    两边各写一份就会出现"服务端开了商店、客户端没弹窗"那种对不上）。
  */
  const settledRound = room.round;
  room.beginRound();
  /*
    新回合了 -> 之前那个"暂停等其他人回来"的意图作废：
    要么人已经回来了（外面的 tryResumeMatch 会接着开这一回合），
    要么我们正走在"开下一回合"这条路上。
  */
  clearPause(room.code);
  /*
    新回合：每个人的商店都会重发（没锁的会被免费刷新），
    所以先把上一回合的"预定"全部清掉 ——
    离线的玩家不会重发，不清的话那几张牌会永远卡在别人那里。
  */
  room.clearShopHeld();
  /*
    ★ 0.1.2：新回合 -> 上一回合的战斗缓存作废（它只服务"战斗中重连"）。
  */
  battleCache.delete(room.code);
  prepStartedAt.set(room.code, Date.now());

  /*
    ★★ 0.2 商店回合：野怪回合（第 1、2 个不算）之后**先开 90 秒商店**，
    商店结束再数正常的布阵时长。

    【为什么必须是"先商店、后布阵"两段，而不是把布阵加长 90 秒？】
    用户口径是"独立阶段、90 秒"。加长布阵的话，玩家会在商店弹窗背后
    看着一个 150 秒的布阵倒计时往下掉，根本分不清"还剩多少是商店的"；
    而且商店结束之后还得再给一段布阵时间（买完东西要摆上去）。
  */
  /*
    ★ 0.3：房主可以在房间设置里关掉「商店回合」（那个 90 秒的限时商店）。
    ★ 注意关的是**这一个**，不是常驻的 5 格买牌商店 —— 后者关掉等于换了个游戏。
  */
  const shopSeconds = isShopRoundAfter(settledRound) && room.settings.shopRound ? SHOP_SECONDS_ACTUAL : 0;
  broadcast(room, {
    t: 'gameStarted',
    roomCode: room.code,
    round: room.round,
    phase: shopSeconds > 0 ? 'shop' : 'prep',
    ...(shopSeconds > 0 ? { shopSecondsLeft: shopSeconds } : {}),
  });
  // 把当前牌库发给所有人：客户端要靠它决定"哪些棋子已经没货了"
  broadcastPool(room);
  // 新回合开始，大家阵容都清空了 —— 让"玩家列表"跟着归零
  broadcast(room, { t: 'prepTeams', teams: room.currentTeams() });
  broadcastRoom(room);

  if (shopSeconds > 0) {
    startShopCountdown(room, shopSeconds);
    console.log(
      `[房间 ${room.code}] 第 ${room.round} 回合：坎诺特来了（商店 ${shopSeconds} 秒），之后才是布阵`,
    );
    return;
  }

  // ★ 0.1.3：前 3 回合 30 秒，其余 60 秒（规则在 shared 的 prepSecondsForRound）
  const seconds = prepSecondsFor(room);
  startPrepCountdown(room, seconds);
  console.log(
    `[房间 ${room.code}] 第 ${room.round} 回合准备阶段开始（${seconds} 秒，到点自动开打）`,
  );
}

/* ============================================================
   ★★ 0.3 盟约选秀（开局前）
   ============================================================
   流程：房主点开始 → 随机排序（不公开）→ 依次选 → 全员选完 → 真正进第一回合。
   时间到没选 = 从"还没人选过的"里随机塞一个，保证人人都有盟约。
   ============================================================ */

/** 这一位还剩几秒（从墙钟算，客户端不自己数） */
function covenantSecondsLeftOf(room: Room): number {
  const elapsed = (Date.now() - room.covenantStartedAt) / 1000;
  return Math.max(0, Math.ceil(COVENANT_SECONDS - elapsed));
}

/** 开始选秀 + 起秒表 */
function beginCovenantPhase(room: Room): void {
  room.beginCovenantDraft();
  startCovenantCountdown(room);
  console.log(
    `[房间 ${room.code}] 盟约选秀开始：${room.covenantOrder.length} 人参与，每人 ${COVENANT_SECONDS} 秒`,
  );
}

function startCovenantCountdown(room: Room): void {
  const previous = covenantTimers.get(room.code);
  if (previous) clearInterval(previous);
  broadcastRoom(room);

  const timer = setInterval(() => {
    if (room.phase !== 'covenant') {
      clearInterval(timer);
      covenantTimers.delete(room.code);
      return;
    }
    if (covenantSecondsLeftOf(room) > 0) {
      /*
        ★ 每秒重播一次房间状态：倒计时的**唯一数据源是服务端**（和布阵同一套做法）。
        房间最多 8 个人，这点数据量无所谓。
      */
      broadcastRoom(room);
      /*
        ★★ 0.3（用户报"倒计时不会动"）：**再单独发一条纯倒计时**。
        房间广播是"整份状态"，它会被拿去做结构签名 / 显隐判断，
        任何一次节流或异常都会让秒数停在原地 —— 不能让它当倒计时的唯一来源。
        客户端拿到这条只改一个数字（和 prepTick / pauseTick 完全一致）。
      */
      broadcast(room, { t: 'covenantTick', secondsLeft: covenantSecondsLeftOf(room) });
      return;
    }
    autoPickCovenant(room, '超时');
  }, 1000);
  covenantTimers.set(room.code, timer);
}

/** 超时 / 掉线时替他选一个（随机，且不会撞别人已选的） */
function autoPickCovenant(room: Room, reason: string): void {
  const current = room.currentCovenantPicker();
  if (!current) {
    finishCovenantPhase(room);
    return;
  }
  const pick = room.randomFreeCovenant();
  if (pick) room.pickCovenant(current.id, pick);
  console.log(
    `[房间 ${room.code}] ${current.name} ${reason}，自动选了「${pick ? covenantOf(pick)?.name ?? pick : '无' }」`,
  );
  afterCovenantPick(room);
}

/**
 * 有人（或系统）选完之后推进一步。
 *
 * ★ 下一位如果**不在线**，直接替他跳过去（也走随机），
 *   否则所有人会陪着一个掉线的人干等满 30 秒。
 */
function afterCovenantPick(room: Room): void {
  const done = room.advanceCovenant();
  if (done) {
    finishCovenantPhase(room);
    return;
  }
  const next = room.currentCovenantPicker();
  if (!next || !next.connected) {
    autoPickCovenant(room, '不在线');
    return;
  }
  broadcastRoom(room);
}

/** 全员选完 -> 收秒表，正式进第一回合 */
function finishCovenantPhase(room: Room): void {
  const timer = covenantTimers.get(room.code);
  if (timer) {
    clearInterval(timer);
    covenantTimers.delete(room.code);
  }
  const picks = room.players
    .filter((player) => player.covenantId)
    .map((player) => `${player.name}=${covenantOf(player.covenantId)?.name ?? player.covenantId}`);
  console.log(`[房间 ${room.code}] 盟约选秀结束：${picks.join(' · ') || '（没人选）'}`);
  /*
    ★ 0.3：「开局生命 +30」这类盟约，只能等选完再补 ——
    开局那一刻还没人知道自己会拿到哪个盟约。
  */
  room.applyCovenantStartHp();
  beginPrepPhase(room);
  /*
    ★★ 0.3.2：选秀结束那一刻如果还有人没回来，就在**布阵阶段**先把对局停住。
    以前这里不看在线情况：选秀一结束就开 30 秒布阵，掉线那位没法摆棋子，
    第一回合等于白送 —— 而且要到"打完第一回合"才会被暂停闸门拦住。
    （`shouldPauseMatch` 已经把 `covenant` 排除在外，所以必须在这儿补一次。）
  */
  if (shouldPauseMatch(room)) {
    pauseMatch(room, { kind: 'resume-prep', remainingMs: prepRemainingMsOf(room) });
  }
}

/**
 * ★ 0.2 商店回合：起一个 90 秒的商店阶段倒计时（**唯一**实现）。
 *
 * 【和 `startPrepCountdown` 为什么是两个计时器？】
 * 它们是**两个阶段**：商店结束才轮到布阵，中间要切 phase、重设 prepStartedAt。
 * 共用一个计时器的话，"商店这一段还剩几秒"和"布阵这一段还剩几秒"
 * 会挤在同一份状态里 —— 那正是"能算出来就别存"想避免的东西。
 */
function startShopCountdown(room: Room, seconds: number): void {
  const previous = shopTimers.get(room.code);
  if (previous) clearInterval(previous);
  // 商店期间**不许**数布阵：`prepSecondsLeftOf` 只认 phase==='prep'
  const prep = prepTimers.get(room.code);
  if (prep) {
    clearInterval(prep);
    prepTimers.delete(room.code);
  }

  room.phase = 'shop';
  const total = Math.max(1, Math.round(seconds));
  shopStartedAt.set(room.code, Date.now());
  shopDurations.set(room.code, total * 1000);
  let secondsLeft = total;
  broadcastRoom(room);

  const timer = setInterval(() => {
    secondsLeft--;
    if (secondsLeft > 0) {
      broadcast(room, { t: 'shopTick', secondsLeft });
      return;
    }
    // 到点：收摊 -> 立刻接上正常的布阵（不要让玩家多等一秒）
    endShopPhase(room);
  }, 1000);
  shopTimers.set(room.code, timer);
}

/**
 * ★ 0.2：商店阶段结束 -> 回布阵。
 *
 * 【为什么单独抽一个函数？】
 * 定时器到点要走它，**玩家点「结束商店」提前收摊**（客户端本地）之后
 * 服务端那边走的也是同一条路 —— 不抽出来就会变成两处各清一半计时器。
 */
function endShopPhase(room: Room): void {
  const timer = shopTimers.get(room.code);
  if (timer) {
    clearInterval(timer);
    shopTimers.delete(room.code);
  }
  if (room.phase !== 'shop') return;
  room.phase = 'prep';
  broadcast(room, { t: 'shopEnded' });
  const seconds = prepSecondsFor(room);
  startPrepCountdown(room, seconds);
  // ★ 立刻广播一次房间：客户端要拿 `prepSecondsLeft` 显示"布阵 N 秒"
  //   （不然第一条 prepTick 要等满一秒才到，中间会闪一下"布阵 0 秒"）
  broadcastRoom(room);
  console.log(`[房间 ${room.code}] 商店打烊，第 ${room.round} 回合布阵开始（${seconds} 秒）`);
}

/**
 * 起一个布阵倒计时（**唯一**实现）。
 *
 * 【为什么单独抽出来？】
 * 正常开一回合要走它，暂停恢复"把剩下的秒数接着数完"也要走它 ——
 * 写两份的下场一定是"恢复之后倒计时跑得不一样"。
 *
 * @param seconds 这一次要数多少秒（正常 = 这个回合的布阵时长；恢复 = 剩下的秒数）
 */
function startPrepCountdown(room: Room, seconds: number): void {
  const previous = prepTimers.get(room.code);
  if (previous) clearInterval(previous);

  const total = Math.max(1, Math.round(seconds));
  prepStartedAt.set(room.code, Date.now());
  prepDurations.set(room.code, total * 1000);

  let secondsLeft = total;
  const timer = setInterval(() => {
    secondsLeft--;
    broadcast(room, { t: 'prepTick', secondsLeft });

    if (secondsLeft <= 0) {
      startBattlePhase(room);
    }
  }, 1000);
  prepTimers.set(room.code, timer);
}

/**
 * 准备阶段结束，开始战斗。
 *
 * 【这个函数存在的理由 —— 一个真实的 bug 教训】
 * 之前「全员提交」时只清掉了计时器、没有真正开始战斗，
 * 结果房间卡在 prep 状态，谁都在等对方，永远打不起来。
 * 把「清计时器 + 进战斗」这两件事收进同一个函数，就不会再出现
 * 「清了一半状态」这种半吊子情况。
 */
function startBattlePhase(room: Room): void {
  const timer = prepTimers.get(room.code);
  if (timer) {
    clearInterval(timer);
    prepTimers.delete(room.code);
  }
  // ★ 0.2：商店阶段绝不能直接开打（那 90 秒是给玩家买东西的），顺手把它清掉
  const shopTimer = shopTimers.get(room.code);
  if (shopTimer) {
    clearInterval(shopTimer);
    shopTimers.delete(room.code);
  }
  shopStartedAt.delete(room.code);
  shopDurations.delete(room.code);
  prepStartedAt.delete(room.code);
  prepDurations.delete(room.code);
  // 已经是战斗/结算阶段就别重复触发
  if (room.phase !== 'prep') return;
  // ★ 时间到 = 所有人自动提交（用他们最后同步过来的那份阵容）
  room.markAllSubmitted();
  runBattlePhase(room);
}

/**
 * 战斗播完之后，等多久再进入下一回合。
 *
 * ============================================================
 *  ★ 这个函数修的是一个"很严重但很隐蔽"的 bug
 * ============================================================
 * 原来下一回合的定时器**写死 3 秒**，注释还写着"给客户端时间播完战斗演出"。
 * 但一场战斗实际要打 **10~75 秒**（10v10 平均 50 秒左右）。
 * 于是 3 秒一到，服务器就广播 `gameStarted`，客户端把正在播的战斗清掉、拉回布阵 ——
 * **玩家永远看不到自己的战斗结果**，只看到画面闪一下就回到布阵。
 * 连接是好的、房间是好的、校验和也对，但"对局没法正常进行"。
 *
 * 现在按这场战斗的真实时长来等，外加 2 秒缓冲（让玩家看清结算画面）。
 *
 * 【为什么要单独抽成函数？】
 * 因为"等待时间必须 ≥ 战斗时长"是一条**不变量**：
 * 只要它被破坏，症状就是上面那种"战斗被截断"，
 * 而这种 bug 用端到端测试去抓要跑十几秒、还依赖定时器，很脆。
 * 抽成纯函数之后，一条毫秒级的断言就能把它钉死。
 *
 * @param maxTicks 这一回合**最长**的那场战斗打了多少 tick
 *                  （同一回合可能有好几场同时打，所有人都要等，所以取最长的那场）
 */
export function battlePlaybackWaitMs(maxTicks: number): number {
  const battleMs = Math.round((Math.max(0, maxTicks) / TICKS_PER_SECOND) * 1000);
  // 上限 80 秒：万一某场战斗打满 75 秒上限，也不会让所有人一直干等
  return Math.min(80000, battleMs + 2000);
}

/**
 * 兜底：最多等这么久还没收齐「我看完了」的回执，就强行进下一回合。
 *
 * ============================================================
 *  ★ 为什么必须有兜底？（以及它和"等回执"是什么关系）
 * ============================================================
 * 正常情况下服务器会**一直等到参战的人都播完**（见 queueRoundAdvance）。
 * 但有两种客户端永远不会回执：
 *   · 切到别的标签页/最小化了 —— 浏览器的 requestAnimationFrame 会被降频甚至暂停，
 *     战斗回放等于停住了，永远播不完；
 *   · 客户端版本太老，根本不认识 `playbackDone` 这条消息。
 * 没有兜底的话，一个人在窗口外发呆，全房间就永远卡在结算画面。
 *
 * 所以：**先等回执，等不到才走兜底**。兜底时间给得宽一点，
 * 让"只是机器慢"的人（10fps ≈ 慢 2 倍）也能赶上。
 */
export function playbackFallbackMs(maxTicks: number): number {
  const base = battlePlaybackWaitMs(maxTicks);
  // 允许客户端比真实时长久 2 倍，再多给 10 秒；总上限 3 分钟
  return Math.min(180000, base * 2 + 10000);
}

/**
 * 「已经有人看完」之后的硬超时（0.0.2 新增）：
 * 70 秒还没收齐回执，就把没看完的那几个人跳过，直接开下一回合。
 *
 * 【为什么是 70 秒？】战斗本身的硬上限就是 70 秒（见 FORCE_END_TICKS），
 * 也就是说 70 秒之后**战斗一定已经打完了**。第一个人看完之后
 * 再给别人 70 秒，等于"给他留了整整一场战斗的时间" ——
 * 这么久了还没看完，基本就是在别的窗口/标签页里。
 */
export const PLAYBACK_SKIP_AFTER_MS = 70000;

/**
 * 等这一回合的参战者都播完战斗，然后执行 `onReady`（进下一回合 / 宣布游戏结束）。
 *
 * ============================================================
 *  ★ 这个函数修的是"双端不同步 / 直接跳过战斗过程"
 * ============================================================
 * 原来的做法：拿这场战斗打了多少 tick，换算成秒数，`setTimeout` 等这么久。
 * 它的隐含前提是「客户端的回放速度和墙钟完全一致」，而这个前提是错的：
 * 客户端主循环把单帧步长 cap 在 0.05 秒（防止切标签页回来时画面瞬间播完），
 * 所以**帧率一旦低于 20fps，回放就比墙钟慢**（10fps 慢一倍，5fps 慢三倍）。
 * 棋多的时候（20 个棋子 + 技能特效）弱电脑掉到 15fps 太常见了。
 *
 * 结果：服务器以为"大家都看完了"的时候，慢的那台还在打 ——
 * 下一回合的 `gameStarted` 一到，客户端把回放清掉、拉回布阵，
 * 玩家看到的就是**战斗演到一半被掐掉**，两台机器看到的进度也不一样。
 *
 * 现在改成"以客户端的回执为准"：谁看完谁举手，全都举手了才进下一回合。
 * 这才是真正的"让玩家保持同一进度"。
 *
 * 【为什么不在客户端上报"我还需要多久"？】
 * 因为客户端根本算不准 —— 帧率随时会变（切窗口、别人抢 CPU、弹个通知）。
 * 让客户端在**真正播完**的那一刻举手，是最简单也最不会错的协议。
 */
function queueRoundAdvance(
  room: Room,
  round: number,
  participants: Iterable<string>,
  battleIds: Iterable<string>,
  maxTicks: number,
  onReady: () => void,
): void {
  // 上一回合的等待器如果还挂着（理论上不会），先清掉，避免定时器泄漏
  const previous = playbackWaiters.get(room.code);
  if (previous) {
    clearTimeout(previous.timer);
    playbackWaiters.delete(room.code);
  }

  const waiter: RoundPlayback = {
    round,
    /*
      ★ 0.1.2：**掉线的人不进"等回执"名单**。
      断线重连把掉线者的座位留在房间里（他还"活着"、还会被配对、还会打一场），
      但他根本没在看 —— 把他算进 pending，全房间就要陪他等满兜底超时
      （最坏 164 秒）。掉线那一刻已经用 dropFromPlaybackWait 摘过一次，
      但那时候摘的是**上一回合**的名单；这里是新名单，必须再筛一遍。
      他重连回来只补看战斗、不补发回执（见 handleSocketClosed 的说明）。
    */
    pending: new Set([...participants].filter((id) => room.getPlayer(id)?.connected !== false)),
    battleIds: new Set(battleIds),
    onReady,
    fired: false,
    // 先占位再赋值：真实内容取决于 fallbackMs，而 fallbackMs 要用 maxTicks 算
    timer: undefined as unknown as NodeJS.Timeout,
  };

  const fallbackMs = playbackFallbackMs(maxTicks);
  waiter.timer = setTimeout(() => {
    const stuck = [...waiter.pending].map((id) => room.getPlayer(id)?.name ?? id);
    console.warn(
      `[房间 ${room.code}] 第 ${round} 回合等回执超时（${(fallbackMs / 1000).toFixed(1)} 秒），` +
        `还没看完的人：${stuck.join('、') || '（无）'} —— 兜底推进，不等了`,
    );
    fireRoundAdvance(room.code);
  }, fallbackMs);
  playbackWaiters.set(room.code, waiter);

  console.log(
    `[房间 ${room.code}] 第 ${round} 回合：等 ${waiter.pending.size} 人看完战斗` +
      `（兜底 ${(fallbackMs / 1000).toFixed(1)} 秒）`,
  );

  // 这一回合没人参战（理论上不会：至少 2 个活人才会开打）就没必要等
  if (waiter.pending.size === 0) fireRoundAdvance(room.code);
}

/** 触发（只触发一次）某个房间的"进入下一回合/结算" */
function fireRoundAdvance(roomCode: string): void {
  const waiter = playbackWaiters.get(roomCode);
  if (!waiter || waiter.fired) return;
  waiter.fired = true;
  clearTimeout(waiter.timer);
  if (waiter.hardTimer) clearTimeout(waiter.hardTimer);
  playbackWaiters.delete(roomCode);
  waiter.onReady();
}

/**
 * 有人提前离开/掉线时，把他从"等着看战斗"的名单里摘掉。
 * 不摘的话，一个掉线的人会把整个房间拖到兜底超时。
 */
function dropFromPlaybackWait(roomCode: string, playerId: string): void {
  const waiter = playbackWaiters.get(roomCode);
  if (!waiter) return;
  waiter.pending.delete(playerId);
  if (waiter.pending.size === 0) fireRoundAdvance(roomCode);
}

/** 房间没了就把等待器一起清掉，别让定时器在后台空转 */
function clearPlaybackWait(roomCode: string): void {
  const waiter = playbackWaiters.get(roomCode);
  if (!waiter) return;
  clearTimeout(waiter.timer);
  playbackWaiters.delete(roomCode);
}

/**
 * 战斗阶段：配对 -> 服务器权威推演 -> 广播种子和阵容 -> 结算
 */
function runBattlePhase(room: Room): void {
  room.phase = 'battle';
  broadcastRoom(room);

  const { pairings, byePlayerId } = room.createPairings();

  console.log(`[房间 ${room.code}] 第 ${room.round} 回合配对：${pairings.length} 场${byePlayerId ? '，1 人轮空' : ''}`);

  /**
   * 这一回合每一场战斗的「结算动作」——**先存起来，不马上执行**。
   *
   * 【为什么要存？—— 用户报的问题】
   * 原来这里一算完 simulate 就 `applyBattleResult` 扣血、紧接着广播 battleEnd，
   * 于是**开战的瞬间**血量就已经变了：玩家列表里对手的血条掉了、
   * 谁被淘汰当场就出局 —— 战斗动画还没开始播，结果就已经泄底了。
   *
   * 现在只广播 battleStart；扣血、battleEnd、淘汰广播全部推迟到
   * "所有人都看完这一场"之后（见下面 queueRoundAdvance 的 onReady）。
   */
  const settlers: Array<() => void> = [];

  /**
   * 这一回合**开始时还活着的人**。
   *
   * 【为什么要在开打前记一份？】
   * "游戏结束"要在**扣血之后**判定（不然这一场刚被打死的人不会触发结束），
   * 但判定依据必须是**这一回合的参与者**，而不是"结算那一刻房间里还剩谁"——
   * 中途有人掉线离开时，不该让对局直接就结束（见 playback-ack 的掉线用例）。
   * 两件事合起来：拿这份名单 + 结算后的血量来判。
   */
  const aliveIdsAtBattle = room.alivePlayers().map((player) => player.id);

  /*
    ★ 记录这一回合**最长**的那场战斗打了多久。

    【为什么必须记？—— 这里原来是个很严重的 bug】
    原来下一回合的定时器写死是 3 秒，注释还写着"给客户端时间播完战斗演出"。
    但一场战斗实际要打 **10~75 秒**（10v10 平均 50 秒左右）。
    于是 3 秒一到，客户端就收到 `gameStarted`，把正在播的战斗直接清掉、拉回布阵 ——
    玩家**永远看不到自己的战斗结果**，只看到画面闪一下就回到布阵了。
    这就是"连接正常但无法正常对局"的来源。

    现在改成按这场战斗的真实时长来等：战斗越久等越久。
  */
  let maxTicks = 0;
  /** 这一回合需要"举手说我看完了"的人 */
  const participants = new Set<string>();
  /** 这一回合所有合法的 battleId */
  const battleIds = new Set<string>();

  /**
   * 这一回合结算后的血量快照（playerId -> hp）。
   *
   * 每场战斗结算时往这里塞一份，回合推进时一起广播出去 ——
   * 玩家列表上的血条就是靠它刷新的。
   */
  const allHpAfter: Record<string, number> = {};

  /**
   * 播一场战斗：服务器权威推演 -> 广播 battleStart -> 把"结算动作"存进 settlers。
   *
   * 【为什么抽成一个函数？】
   * 常规配对（两个真人对打）和野怪回合（玩家 vs 野怪波次）的结构**完全一样**，
   * 差别只有"队伍 1 是谁"和"怎么结算"。写两份的下场一定是"改了一边忘了另一边"
   * —— 这项目已经在别处（拖拽落子）吃过一次同样的亏了。
   */
  const stageBattle = (
    battleId: string,
    seed: number,
    team0: TeamSetup,
    team1: TeamSetup,
    player0Id: string,
    player1Id: string,
    extra: { ghostOf?: string; monsterWave?: string; safetyNetFor?: string[] },
    settle: (result: { winner: 0 | 1 | null }) => void,
  ): void => {
    const result = simulate(UNIT_DEFS, [team0, team1], seed);
    maxTicks = Math.max(maxTicks, result.ticks);

    /*
      ★ 0.1.1：顺手累计"这位玩家这一局打了多少伤害"。
      结算页要展示"本局伤害最高的干员"，而那必须跨全部回合累计；
      客户端只看得到自己参战那几场，所以这件事只能在服务器做。
      影子 / 野怪那种假 id 传进来会被 getPlayer 挡掉（它们不是人）。
    */
    room.recordBattleDamage(player0Id, result.log, 0);
    room.recordBattleDamage(player1Id, result.log, 1);

    const battleStart: BattleStartPayload = {
      t: 'battleStart',
      battleId,
      seed,
      team0,
      team1,
      team0PlayerId: player0Id,
      team1PlayerId: player1Id,
      ...extra,
      names: buildDisplayNames(team0, team1),
      expectedChecksum: result.checksum,
    };
    /*
      ★ 0.1.2：把这份载荷存进本回合的战斗缓存。
      战斗广播是"发完即弃"的，战斗中掉线的人回来后什么都收不到 ——
      有了缓存，重连时能把这一回合每一场都补给他（见 buildResumeState.battles）。
    */
    cacheBattlePayload(room.code, room.round, battleStart);
    broadcast(room, battleStart);

    battleIds.add(battleId);
    // 参战的人必须都"看完"，才轮到下一回合。假的对手（影子 / 野怪）不算人
    participants.add(player0Id);
    if (player1Id !== GHOST_PLAYER_ID && player1Id !== MONSTER_PLAYER_ID) participants.add(player1Id);

    settlers.push(() => settle(result));
  };

  /*
    ============================================================
    ★ 0.0.3 野怪回合：对手换成野怪波次
    ============================================================
    【你要的做法】"还是两两配对，对手换成野怪" —— 配对逻辑一行没动
    （上面照常 createPairings()，奇数人照样算出轮空者），
    只是**每一场战斗的队伍 1 换成一波野怪**。

    【为什么是"每人各打一场"，而不是"两人各演一半"？】
    一场战斗只有一个结果，而队伍 0 的阵容是按人算的 ——
    p0 打得过不代表 p1 打得过。所以配对里的两个人各领一场
    「自己的阵容 vs 同一波野怪」，各自结算各自的胜负。
    轮空的人这一回合也**照打同一波野怪**（他本来就没配到人，
    再让他干看着就是白送一回合）。

    【结算走 applyGhostResult】
    和影子对战同一条路：只动这一个玩家（输了自己扣血、记一负），
    野怪那边当然没有任何"被扣血"的对象。
  */
  const monsterRound = isMonsterRound(room.round);
  const waveText = monsterRound ? monsterWaveText(monsterWaveForRound(room.round)) : '';

  if (monsterRound) {
    for (const player of room.alivePlayers()) {
      const battle = room.createMonsterBattle(player);
      const hpBefore = player.hp;

      stageBattle(
        battle.battleId,
        battle.seed,
        battle.team0,
        battle.team1,
        player.id,
        MONSTER_PLAYER_ID,
        {
          monsterWave: waveText,
          safetyNetFor: safetyNetIds(room, [player.id]),
        },
        (result) => {
          // ★ 0.3.1：野怪回合**不计入盟约「重生疗法」的有效胜场**（描述里写明"野怪回合不计入"）
          const hpAfter = room.applyGhostResult(result.winner, player.id, {
            countsForCovenant: false,
          });
          Object.assign(allHpAfter, hpAfter);

          const damageToLoser = result.winner === 1 ? hpBefore - (hpAfter[player.id] ?? hpBefore) : 0;
          broadcast(room, {
            t: 'battleEnd',
            battleId: battle.battleId,
            winner: result.winner,
            damageToLoser,
            hpAfter,
          });

          eliminatePlayer(room, player.id);
        },
      );
    }
  }

  for (const pairing of pairings) {
    // 野怪回合的每一场已经在上面播完了，这里只跑常规的真人配对
    if (monsterRound) break;

    const team0 = room.buildTeamSetup(pairing.player0, 0);
    const team1 = room.buildTeamSetup(pairing.player1, 1);
    const hpBefore = {
      [pairing.player0.id]: pairing.player0.hp,
      [pairing.player1.id]: pairing.player1.hp,
    };

    stageBattle(
      pairing.battleId,
      pairing.seed,
      team0,
      team1,
      pairing.player0.id,
      pairing.player1.id,
      { safetyNetFor: safetyNetIds(room, [pairing.player0.id, pairing.player1.id]) },
      (result) => {
        const hpAfter = room.applyBattleResult(result.winner, pairing.player0.id, pairing.player1.id);

        // 算实际扣血量（平局时为 0）—— 客户端要用它做飘字和血条动画
        let damageToLoser = 0;
        if (result.winner !== null) {
          const loserId = result.winner === 0 ? pairing.player1.id : pairing.player0.id;
          damageToLoser = (hpBefore[loserId] ?? 0) - (hpAfter[loserId] ?? 0);
        }

        broadcast(room, {
          t: 'battleEnd',
          battleId: pairing.battleId,
          winner: result.winner,
          damageToLoser,
          hpAfter,
        });

        // 有人被淘汰就单独走那条统一处置（播淘汰 + 牌还库 + 广播牌库）
        for (const id of [pairing.player0.id, pairing.player1.id]) {
          eliminatePlayer(room, id);
        }
      },
    );
  }

  /*
    ============================================================
    ★ 奇数个人：轮空的那位去打一场「影子对战」
    ============================================================
    【以前是什么样】轮空 = 干看着别人打，白白空过一回合，什么都不发生。
    【现在】轮空者跟「某个存活玩家的阵容复制品」打一场 ——
      输了他照样扣自己的血（所以"轮空"不再是免费的一回合），
      但**被复制的那位毫发无损**（不掉血、不计胜负，甚至不知道有这回事）。

    【为什么放在所有真人配对之后广播？】
    已经开打的人此时 `currentBattleId` 已经设好了，收到这条影子会直接
    `if (currentBattleId && !amIPlaying) return` 忽略掉 ——
    不会打断他们自己的战斗演出。而轮空者这边，"自己的战斗"优先级更高，
    会把先前旁观的画面换成自己这一场。
  */
  if (byePlayerId && !monsterRound) {
    const bye = room.getPlayer(byePlayerId);
    const ghost = bye ? room.createGhostBattle(bye) : null;

    if (!bye || !ghost) {
      // 只剩自己一个活人（这时候本来也该判定结束了）：不扣血
    } else {
      const result = simulate(UNIT_DEFS, [ghost.team0, ghost.team1], ghost.seed);
      maxTicks = Math.max(maxTicks, result.ticks);
      // ★ 0.1.1：轮空的人打出的伤害也是他自己的（队伍 1 是复制品，不算任何人的）
      room.recordBattleDamage(ghost.player.id, result.log, 0);

      broadcast(room, {
        t: 'battleStart',
        battleId: ghost.battleId,
        seed: ghost.seed,
        team0: ghost.team0,
        team1: ghost.team1,
        team0PlayerId: ghost.player.id,
        // 影子不是真人：填一个假 id，否则被复制的那位会以为"这场有我在打"
        team1PlayerId: GHOST_PLAYER_ID,
        ghostOf: ghost.source.name,
        safetyNetFor: safetyNetIds(room, [ghost.player.id, ghost.source.id]),
        names: buildDisplayNames(ghost.team0, ghost.team1),
        expectedChecksum: result.checksum,
      });

      // 轮空者也要"看完"这场，才轮到下一回合
      participants.add(ghost.player.id);
      battleIds.add(ghost.battleId);

      // 同样：结算也要等轮空者看完（不然他的血量会在开战瞬间先掉）
      const hpBefore = ghost.player.hp;
      settlers.push(() => {
        const hpAfter = room.applyGhostResult(result.winner, ghost.player.id);
        const damageToLoser =
          result.winner === 1 ? hpBefore - (hpAfter[ghost.player.id] ?? hpBefore) : 0;

        broadcast(room, {
          t: 'battleEnd',
          battleId: ghost.battleId,
          winner: result.winner,
          damageToLoser,
          hpAfter,
        });

        eliminatePlayer(room, ghost.player.id);
      });

      console.log(
        `[房间 ${room.code}] 第 ${room.round} 回合：${bye.name} 轮空，影子对战 ${ghost.source.name} 的阵容（结算等看完）`,
      );
    }
  }

  room.phase = 'resolve';
  // ★ 注意：这一次广播的血量还是**战前**的 —— 结果要在大家看完之后才揭晓
  broadcastRoom(room);

  const round = room.round;

  /*
    ★ 关键：不管是"进下一回合"还是"宣布游戏结束"，都要**等大家看完战斗**。
    最后一局尤其不能掐掉 —— 那是玩家最想看的一场。
  */
  queueRoundAdvance(room, round, participants, battleIds, maxTicks, () => {
    if (room.isEmpty) return;

    /*
      ★★ 这里才是"扣血"真正发生的地方。
      所有参战的人（含轮空打影子的那位）都看完战斗了，才依次结算：
      扣血 -> 广播 battleEnd / 淘汰 -> 广播房间新血量。
      于是战斗演出期间谁也看不到结果 —— 这就是用户要的
      "不能一开始就知道结果"。
    */
    for (const settle of settlers) settle();
    // 让所有人的玩家列表刷新到最新血量（战斗期间一直是战前的数字）
    broadcastRoom(room);

    /*
      ★ 淘汰判定必须在扣血**之后** —— 顺序反了就会漏掉"这一场刚被打死的人"。
      依据是"这一回合的参与者"（中途掉线离开的人不算被打死，见 aliveIdsAtBattle）。
    */
    const survivors = aliveIdsAtBattle.filter((id) => {
      const player = room.getPlayer(id);
      return player ? player.hp > 0 : true;
    });
    const gameOver = {
      over: survivors.length === 1,
      winnerId: survivors.length === 1 ? survivors[0]! : null,
    };
    if (survivors.length === 0) gameOver.over = false;

    if (gameOver.over && gameOver.winnerId) {
      const winner = room.getPlayer(gameOver.winnerId);
      console.log(`[房间 ${room.code}] 游戏结束，胜者 ${winner?.name ?? gameOver.winnerId}`);
      broadcast(room, {
        t: 'gameOver',
        winnerId: gameOver.winnerId,
        winnerName: winner?.name ?? '???',
        rounds: room.round,
        // ★ 0.1.1：结算页要的完整战绩（服务器算好、按名次排好，全员一致）
        standings: room.standings(),
      });
      return;
    }

    /*
      ★ 0.1.3：人不够就**不要开下一回合**。
      别人掉线之后座位还在（宽限期 5 分钟），但继续一轮一轮地打下去
      只会让剩下的人被无限拖着玩（用户报的"掉线到只剩房主，房主卡住"）。
      这里冻结对局，等重连回来的人（见 tryResumeMatch）。
    */
    if (shouldPauseMatch(room)) {
      pauseMatch(room, { kind: 'next-round' });
      return;
    }

    beginPrepPhase(room);
  });
}

/**
 * ★ 0.1.1：把客户端上报的备战席**收一下口**再存。
 *
 * 它只是"原始输入"（展示 + 淘汰回库用），服务器不做权威校验，
 * 但至少要把明显的垃圾挡掉：不存在的干员、越界的星级 / 张数。
 * 特别是 `copies` —— 它最终会喂给 `returnToPool`，
 * 不夹范围的话一个乱填的大数字就能把牌库刷爆。
 */
function sanitizeBench(raw: unknown): BenchUnitView[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: BenchUnitView[] = [];
  for (const entry of raw.slice(0, 32)) {
    if (!entry || typeof entry !== 'object') continue;
    const { defId, star, copies } = entry as { defId?: unknown; star?: unknown; copies?: unknown };
    if (typeof defId !== 'string' || !UNIT_DEFS[defId]) continue;
    const s = Math.max(1, Math.min(3, Math.floor(Number(star) || 1)));
    const c = Math.max(0, Math.min(9, Math.floor(Number(copies) || 0)));
    out.push({ defId, star: s, copies: c });
  }
  return out;
}

/**
 * ★ 0.1.1 藏品二版：夹取客户端上报的"跨回合藏品成长层数"。
 *
 * 【为什么"不采信也要夹"？】
 * 成长层数的**数值**确实只能听客户端的（服务端没有"他杀了几个"的账本），
 * 但它最终直接进 `createBattle` 变成属性 —— 一份 `{ itm_grudge_list: 999999 }`
 * 能让一件藏品凭空变成 +9999% 攻击力。
 * 夹一个合理范围（层数 0~999、未装载数 0~99、key 必须是真实藏品 id）
 * 既不改变正常玩法，也把"手滑 / 恶意"的后果限制在可控范围内。
 */
/**
 * ★ 0.2 罗德岛跨回合叠层：只做**原始输入**的清洗（层数是客户端算的）。
 * 认不出的羁绊 id 留着也无害（战斗侧只会读它自己那条机制对应的 key），
 * 所以这里不为了校验去多引一张羁绊表 —— 只夹范围。
 */
function sanitizeTraitStacks(raw: unknown): Record<string, number> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key.length === 0 || key.length > 32) continue;
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n <= 0) continue;
    out[key] = Math.min(999, n);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeItemState(
  raw: unknown,
): { growth?: Record<string, number>; unequipped?: number; bag?: ItemBagSnapshot } | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const input = raw as { growth?: unknown; unequipped?: unknown; bag?: unknown };
  const growth: Record<string, number> = {};
  if (input.growth && typeof input.growth === 'object') {
    for (const [key, value] of Object.entries(input.growth as Record<string, unknown>)) {
      if (!ITEM_DEFS[key]) continue; // 不认识的藏品 id 直接丢
      const n = Math.floor(Number(value));
      if (!Number.isFinite(n) || n <= 0) continue;
      growth[key] = Math.min(999, n);
    }
  }
  const unequipped =
    input.unequipped === undefined ? undefined : Math.max(0, Math.min(99, Math.floor(Number(input.unequipped) || 0)));
  const bag = sanitizeItemBag(input.bag);
  if (Object.keys(growth).length === 0 && unequipped === undefined && bag === undefined) return undefined;
  return {
    ...(Object.keys(growth).length > 0 ? { growth } : {}),
    ...(unequipped !== undefined ? { unequipped } : {}),
    ...(bag !== undefined ? { bag } : {}),
  };
}

/**
 * ★ 0.1.4：夹取客户端上报的「藏品栏快照」（`itemState.bag`）。
 *
 * 【为什么和 `itemState` 里别的字段一样"不采信也要夹"？】
 * 它最终会**原样发回**给重连的客户端去重建本地藏品栏
 * （见 `applySubmittedTeam`）。一份手改过的 payload 可以是：
 *   · 格子里塞一个不存在的藏品 id  → 界面拿不到 `ITEM_DEFS[id]`，当场炸在渲染里；
 *   · 塞几百格 / 超长字符串         → 白白撑大内存和广播体积。
 * 夹成一个**固定规格**（A 类 10 格、B 类 5 格、id 必须在表里）之后，
 * 正常玩法一个字节都不变，而"手滑 / 恶意"的后果被限制在可控范围内。
 *
 * 【为什么格数要跟着 shared 的常量走？】
 * 因为格子数是设计规格（`ITEM_A_SLOTS` / `ITEM_B_SLOTS`），
 * 版本一变两边都得跟着变 —— 抄一个字面量 10 就会在改规格那天悄悄错位。
 */
function sanitizeItemBag(raw: unknown): ItemBagSnapshot | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const input = raw as {
    a?: unknown;
    b?: unknown;
    cert?: unknown;
    permanent?: unknown;
    gainedRound?: unknown;
  };

  const slots = (value: unknown, size: number): (string | null)[] | undefined => {
    if (!Array.isArray(value)) return undefined;
    // 正好取 size 格：多出来的截掉，不够的补 null（版本差异夹平）
    return Array.from({ length: size }, (_, index) => {
      const id = value[index];
      return typeof id === 'string' && ITEM_DEFS[id] ? id : null;
    });
  };

  const a = slots(input.a, ITEM_A_SLOTS);
  const b = slots(input.b, ITEM_B_SLOTS);
  // ★ 0.3.2 升变之证专用栏（3 格，固定顺序）
  const cert = slots(input.cert, AMIYA_CERT_SLOTS);

  const permanentRaw = input.permanent as Record<string, unknown> | undefined;
  const permanent =
    permanentRaw && typeof permanentRaw === 'object'
      ? { lostKey: permanentRaw['lostKey'] === true, lostKeyPaid: permanentRaw['lostKeyPaid'] === true }
      : undefined;

  const gainedRound: Record<string, number> = {};
  if (input.gainedRound && typeof input.gainedRound === 'object') {
    for (const [key, value] of Object.entries(input.gainedRound as Record<string, unknown>)) {
      if (!ITEM_DEFS[key]) continue;
      const n = Math.floor(Number(value));
      if (!Number.isFinite(n) || n <= 0) continue;
      gainedRound[key] = Math.min(9999, n);
    }
  }

  if (!a && !b && !cert && !permanent && Object.keys(gainedRound).length === 0) return undefined;
  return {
    ...(a ? { a } : {}),
    ...(b ? { b } : {}),
    ...(cert ? { cert } : {}),
    ...(permanent ? { permanent } : {}),
    ...(Object.keys(gainedRound).length > 0 ? { gainedRound } : {}),
  };
}

/** 给客户端准备「单位 id -> 显示名」的映射，用于字幕和血条 */function buildDisplayNames(team0: { units: Array<{ defId: string }> }, team1: { units: Array<{ defId: string }> }): Record<number, string> {
  const names: Record<number, string> = {};
  /*
    ★ 0.2：野怪统一叫「野怪」（用户口径：多人/单人打野怪都不显示具体名字，
    观战也一样）。判据走 shared 的 `displayNameOf` ——
    客户端单机/沙盒也调它，三处口径必须是同一个。
  */
  for (const [index, placement] of team0.units.entries()) {
    names[index + 1] = displayNameOf(placement.defId);
  }
  for (const [index, placement] of team1.units.entries()) {
    names[1000 + index + 1] = displayNameOf(placement.defId);
  }
  return names;
}

// ============================================================
//  人机（Bot）
// ============================================================

/**
 * ★★ 0.3.3：给人机做一条**内存通道**，让它在服务端进程里"看起来就是一个客户端"。
 *
 * 【它到底做了什么？】
 * 服务端广播时走 `send(connection, msg)` → `connection.socket.send(json)`。
 * 这里把 `send` 接到 `BotBrain.onServerMessage` 上 —— 于是人机收到的
 * 和浏览器收到的是**同一条消息、同一个编码**。
 */
class BotSocket {
  readyState = 1;
  constructor(private readonly deliver: (raw: string) => void) {}
  send(raw: string): void {
    if (this.readyState !== 1) return;
    this.deliver(raw);
  }
  close(): void {
    this.readyState = 3;
  }
}

/**
 * 把一台人机接进房间：建连接、建大脑。
 *
 * ★ 两个方向必须分清（这里第一版写反过，症状是"人机一动不动"）：
 *   · **服务器 -> 人机**：`send(connection, msg)` 会把**服务端消息**塞进 socket，
 *     所以 BotSocket 的投递口必须喂给 `onServerMessage`；
 *   · **人机 -> 服务器**：`brain.send()` 才调 `handleMessage`（= 真人那条入口）。
 *   写反的话，浏览器发来的那种"客户端消息"才会进 `handleMessage`，
 *   而服务端广播（room / pool / gameStarted / buyResult…）全部被当成未知消息丢掉 ——
 *   人机看不到房间、看不到商店，连买牌的回执都收不到。
 */
function createBot(room: Room, player: RoomPlayer, difficulty: BotDifficulty): void {
  /** 先把引用留住：socket 的回调可能在 brain 建好之前就被调用 */
  let brain: BotBrain | null = null;
  const connection: Connection = {
    socket: new BotSocket((raw) => {
      const message = decodeMessage<ServerMessage>(raw);
      if (message) brain?.onServerMessage(message);
    }),
    playerId: player.id,
    roomCode: room.code,
    alive: true,
  };
  connections.set(player.id, connection);

  brain = new BotBrain({
    playerId: player.id,
    roomCode: room.code,
    difficulty,
    // ★ 人机的"发出"和浏览器同源：handleMessage 就是 socket.on('message') 里那一步
    send: (message) => handleMessage(connection, message),
    speed: botSpeed(),
  });
  bots.set(player.id, brain);
  // 大厅里人机一律"已准备"（否则房主会看到"还有 1 位玩家没准备好"却不知道点哪儿）
  brain.requestReady();
  console.log(`[房间 ${room.code}] 加入人机 ${player.name}（${difficulty}，id ${player.id}）`);
}

/** 摘掉一台人机（先断它的脑子，再从连接表和房间里摘掉） */
function disposeBot(playerId: string): void {
  const brain = bots.get(playerId);
  if (brain) {
    brain.dispose();
    bots.delete(playerId);
  }
  const connection = connections.get(playerId);
  if (connection) {
    connection.alive = false;
    connection.roomCode = null;
    connection.socket.close();
    connections.delete(playerId);
  }
}

/** 房间被销毁时，把它名下的人机全部回收（不回收会一直占着定时器和内存） */
function disposeRoomBots(roomCode: string): void {
  for (const [playerId, brain] of [...bots]) {
    if (brain.roomId === roomCode) disposeBot(playerId);
  }
}

// ============================================================
// 消息处理
// ============================================================

function handleMessage(connection: Connection, message: ClientMessage): void {
  switch (message.t) {
    /*
      ★ 0.0.3 末：把"局域网里有哪些房间"回给浏览器。
      客户端拿它把玩家输入的房间号换成"该连哪台机器"（见 lan.ts 顶部示意图）。
      只读、不改状态，所以放在最前面，任何阶段都能问。
    */
    case 'lanScan': {
      send(connection, { t: 'lanRooms', rooms: lan?.scan() ?? [] });
      break;
    }

    case 'createRoom': {
      // ★ 0.1.3：版本不一致直接拒绝（见 ensureSameVersion 的说明）
      if (!ensureSameVersion(connection, message.version)) break;
      /*
        ★ 0.3：昵称必须先过**长度 + 字符白名单**（规则在 shared/names.ts）。
        以前是"洗成什么算什么、洗空了兜底成无名玩家"，玩家会莫名其妙被改名；
        现在直接拒绝并说清楚原因。
      */
      const hostName = readPlayerName(message.playerName);
      if (hostName.error) {
        sendError(connection, 'BAD_NAME', hostName.error);
        break;
      }
      leaveCurrentRoom(connection);
      const room = rooms.createRoom(
        connection.playerId,
        hostName.name,
        sanitizeAvatarId(message.avatarId),
      );
      connection.roomCode = room.code;
      linkSessionToRoom(connection.playerId, room.code);
      sendWelcome(connection);
      broadcastRoom(room);
      console.log(`[房间 ${room.code}] 新建，房主 ${connection.playerId}`);
      /*
        ★ 立刻广播一次：朋友那边默认 1.5 秒才来一次广播，
        不催一下的话"刚建好房、朋友马上输入房间号"会扑空。
      */
      lan?.poke();
      break;
    }

    case 'joinRoom': {
      // ★ 0.1.3：版本不一致直接拒绝
      if (!ensureSameVersion(connection, message.version)) break;
      const code = String(message.roomCode ?? '').trim().toUpperCase();
      if (!isValidRoomCode(code)) {
        sendError(connection, 'BAD_CODE', '房间码应该是 6 位字母数字');
        break;
      }
      const joinName = readPlayerName(message.playerName);
      if (joinName.error) {
        sendError(connection, 'BAD_NAME', joinName.error);
        break;
      }
      leaveCurrentRoom(connection);
      /*
        ★ 0.3：重名拦截在 `RoomManager.joinRoom` 里面（那是"能不能进这个房间"的
        唯一裁决处）。这边只负责把 errorCode 原样转给客户端 ——
        客户端要凭 NAME_TAKEN 把玩家的输入框重新聚焦，光给一句话是不够的。
      */
      const { room, error, errorCode } = rooms.joinRoom(
        code,
        connection.playerId,
        joinName.name,
        sanitizeAvatarId(message.avatarId),
      );
      if (error || !room) {
        sendError(connection, errorCode ?? 'JOIN_FAILED', error ?? '加入失败');
        break;
      }
      connection.roomCode = room.code;
      linkSessionToRoom(connection.playerId, room.code);
      broadcastRoom(room);
      console.log(`[房间 ${room.code}] ${connection.playerId} 加入（当前 ${room.players.length} 人）`);
      break;
    }

    /*
      ============================================================
      ★ 0.1.2：断线重连 —— 凭令牌换回原来的座位
      ============================================================
      【它和 joinRoom 的区别（这是整件事的关键）】
      joinRoom 是"新人进房"：新建一个 hp:100 / 战绩全零的白板，
      而且对局中会被直接拒绝（phase !== 'lobby'）。
      resume 是"老人回座"：复用**原来那个 playerId**，
      血量 / 战绩 / 等级 / 场面全都在座位上等着（Room.addPlayer 的 existing 分支）。
      顺带一提，playerId 不变还有一个副作用是必需的：
      客户端的商店种子是 `hash('airnight-shop|房间码|playerId')`，
      playerId 一变，商店随机序列就整批重来（"重连后商店全变了"）。
    */
    case 'resume': {
      const session = sessionsByToken.get(String(message.token ?? ''));
      if (!session) {
        send(connection, {
          t: 'resumeFailed',
          code: 'BAD_TOKEN',
          message: '重连凭据已失效（服务器可能重启过）',
        });
        break;
      }
      const room = session.roomCode ? rooms.getRoom(session.roomCode) : undefined;
      const seat = room?.getPlayer(session.playerId);
      if (!room || !seat) {
        send(connection, {
          t: 'resumeFailed',
          code: 'NO_SEAT',
          message: '这一局的座位已经不在了',
        });
        break;
      }

      /*
        ★ 顶号：同一个令牌已经有活跃连接（同一浏览器开了两个标签页、
        或者手机和电脑同时开着）—— 必须决出**唯一持有者**，
        否则两个人共用一个座位（血量、阵容互相覆盖，看起来像"随机失败"）。
        规则：后到的顶掉先到的。先到的收到 `replaced` 再被以 4001 关闭。
        ★ 顺序很重要：**先把连接表换成新的，再去关旧 socket** ——
        不然旧 socket 的 close 处理器会看到"连接表里还是我"，
        于是把座位标成离线（人明明在线），还会给新连接添一次宽限期。
      */
      const previous = connections.get(session.playerId);
      connections.set(session.playerId, connection);
      if (previous && previous !== connection) {
        previous.alive = false;
        send(previous, { t: 'replaced', reason: '你在另一处进入了游戏' });
        previous.socket.close(4001, 'replaced');
      }

      // 临时身份作废（这条连接一开始领到的那个 playerId 和令牌）
      forgetSession(connection.playerId);
      connection.playerId = session.playerId;
      connection.roomCode = room.code;
      // 座位上的昵称/头像以房间里那份为准（房主可能改过名）
      room.addPlayer(session.playerId, seat.name, seat.avatarId);
      clearGrace(session.playerId);
      /*
        ★ 0.1.3：如果这一局正因为"人不够"暂停着，人回来了就接着打
        （见 tryResumeMatch：布阵被打断的把剩下的秒数数完，否则直接开下一回合）。
        必须先 resume 再发快照？不用 —— 快照里的 phase / 秒数都是**恢复后**的，
        而恢复本身是同步的（pauseMatch 早就在等了），所以这里先恢复再看状态最准。
      */
      tryResumeMatch(room);

      send(connection, buildResumeState(room, session.playerId));
      /*
        ★ 0.1.4：换回原身份之后再发一条 `welcome`（带**原身份那枚令牌**）。

        【为什么必须补这一条？—— 一个"重连只能用一次"的 bug】
        每条新连接在建立时都先收到一条 welcome，里面是**这条连接的临时身份**令牌；
        而客户端紧接着就用真令牌 resume —— 上面那句 `forgetSession(临时 id)`
        会把那枚临时令牌作废。于是客户端手上那枚令牌如果是"临时那枚"，
        下一次重连就会 BAD_TOKEN（用户报的"有时候能回、有时候回不去"）。
        这里补发一条带正确令牌的 welcome，客户端无论怎么换都能拿到对的那枚。
        ★ 顺序：必须**在 broadcastRoom 之前**发 —— 客户端收到房间广播时会
          把令牌写进本机会话（`syncMachineSession`），写早了就写错了。
      */
      sendWelcome(connection);
      broadcastRoom(room);
      console.log(
        `[房间 ${room.code}] ${session.playerId} 断线重连成功` +
          `（第 ${room.round} 回合 / ${room.phase}）`,
      );
      break;
    }

    case 'leaveRoom':
      leaveCurrentRoom(connection);
      break;

    case 'setReady': {
      const room = currentRoom(connection);
      if (!room) break;
      room.setReady(connection.playerId, Boolean(message.ready));
      broadcastRoom(room);
      break;
    }

    case 'playerStats': {
      // 客户端上报的展示数据（等级 / 连胜连败），存下后广播给全房间。
      // 这是"玩家列表"要显示的内容，纯展示，不参与任何胜负判定。
      const room = currentRoom(connection);
      if (!room) break;
      room.setPlayerStats(connection.playerId, message.level, message.streak);
      broadcastRoom(room);
      break;
    }

    /*
      ★★ 0.3.2：客户端说"我这边对不上了"，就补一份权威快照。
      补的是**当前状态**（阶段 / 回合 / 牌库 / 阵容），
      唯独**不重发 `gameStarted`** —— 那条在客户端会触发回合结算（发钱/发经验），
      拿来补同步等于每抖一次就白送一次收入。
      下面四条都是幂等的：客户端重复收到只会把同样的值再写一遍。
    */
    case 'requestSync': {
      const room = currentRoom(connection);
      if (!room) break;
      send(connection, {
        t: 'phaseState',
        round: room.round,
        phase: room.phase,
        prepSecondsLeft: prepSecondsLeftOf(room),
        shopSecondsLeft: shopSecondsLeftOf(room),
      });
      send(connection, { t: 'room', room: toRoomView(room) });
      send(connection, { t: 'pool', remaining: room.poolRemaining(), held: room.poolHeld() });
      send(connection, { t: 'prepTeams', teams: room.currentTeams() });
      break;
    }

    /*
      ============================================================
      ★ 0.1.1：房主的两个"管人"操作（踢人 / 改名）
      ============================================================
      【为什么权限要在服务端查？】
      客户端把按钮藏起来只是"不给普通人看到"，不是权限 ——
      任何人手写一条消息就能发过来。所以这里必须自己验一次房主身份。
      【为什么只允许大厅阶段？】
      这两个按钮就长在大厅的玩家列表上（"未准备/已准备"旁边）。
      对局一旦开始，把人踢走会把正在进行的配对/血量结算搞乱，
      所以直接挡掉并给一句人话。
    */
    case 'kickPlayer': {
      const room = currentRoom(connection);
      if (!room) break;
      if (room.hostId !== connection.playerId) {
        sendError(connection, 'NOT_HOST', '只有房主能踢人');
        break;
      }
      if (room.phase !== 'lobby') {
        sendError(connection, 'WRONG_PHASE', '对局已经开始，不能踢人');
        break;
      }
      const target = room.players.find((p) => p.id === message.playerId);
      if (!target) {
        sendError(connection, 'NO_SUCH_PLAYER', '找不到这个玩家');
        break;
      }
      if (target.id === room.hostId) {
        sendError(connection, 'NOT_HOST', '不能把房主自己踢出去');
        break;
      }
      /*
        ★★ 0.3.3：人机被"踢"= 被移除。
        走 kickPlayer 这条路（而不是只认 removeBot）是为了容错：
        客户端的按钮藏起来不算权限，而"踢一台人机"在语义上就是移除它。
        真正要做的是**回收它的脑子**，否则会留下一条永远在线的僵尸连接。
      */
      if (target.isBot) {
        disposeBot(target.id);
        const removed = rooms.removeBot(room.code, target.id);
        if (removed.room) broadcastRoom(removed.room);
        break;
      }

      // ★ 0.1.3：房主可以附一句话，原样转达给被踢的人（空着用默认文案）
      const note = sanitizeKickMessage(message.message);
      console.log(
        `[房间 ${room.code}] 房主把 ${target.name}（${target.id}）踢出了房间` +
          (note ? `（留言：${note}）` : ''),
      );
      const victim = connections.get(target.id);
      if (victim) {
        // 先告诉本人为什么被赶出来，再走"正常离开"那条路（房间清理只有一份实现）
        send(victim, { t: 'kicked', reason: note || '房主把你移出了房间' });
        leaveCurrentRoom(victim);
      } else {
        // 人已经掉线了，连接不在 —— 只把他从房间里摘掉，剩下的照常广播
        const left = rooms.leaveRoom(target.id);
        if (left) broadcastRoom(left);
      }
      break;
    }

    case 'renamePlayer': {
      const room = currentRoom(connection);
      if (!room) break;
      if (room.hostId !== connection.playerId) {
        sendError(connection, 'NOT_HOST', '只有房主能改别人的昵称');
        break;
      }
      if (room.phase !== 'lobby') {
        sendError(connection, 'WRONG_PHASE', '对局已经开始，不能改昵称');
        break;
      }
      const target = room.players.find((p) => p.id === message.playerId);
      if (!target) {
        sendError(connection, 'NO_SUCH_PLAYER', '找不到这个玩家');
        break;
      }
      /*
        ★★ 0.3：改名必须和建房走**同一套**校验，否则"进房后改一下就绕过去了"。
        三道：洗+长度 -> 重名 -> 写入。
        ★ 重名比对要排除**自己**（房主把 A 改成 A 不该被挡）。
      */
      const nextName = readPlayerName(message.name);
      if (nextName.error) {
        sendError(connection, 'BAD_NAME', nextName.error);
        break;
      }
      if (nameTakenIn(room.players, nextName.name, target.id)) {
        sendError(connection, 'NAME_TAKEN', '这个名字房间里已经有人用了，换一个吧');
        break;
      }
      target.name = nextName.name;
      console.log(`[房间 ${room.code}] 房主把 ${target.id} 的昵称改成了「${target.name}」`);
      broadcastRoom(room);
      break;
    }

    /*
      ★★ 0.3：房主改**房间设置**（开局血量 / 开局金币 / 商店回合开关 / 布阵时长 / 每回合收入）。

      【为什么权限判在这里，而不是靠客户端藏按钮？】
      隐藏按钮只是"不给普通人看到"。任何人抓包发一条 `updateSettings` 就能改规则 ——
      所以判据必须在这儿：**只有房主、只有 `lobby`**。
      开局之后再改更是灾难：别人已经按旧规则摆好棋、算好了经济，规则却说变了。

      【数值夹取不在这一层】
      交给 `room.applySettings`（唯一实现在 shared 的 `clampRoomSettings`）。
      这里只负责"谁、什么时候能改"。
    */
    /*
      ★ 0.3：藏品回血。客户端把"加了多少"报上来，服务端夹一下再改。
      ★ 为什么夹 1..200：单件消耗品最多 +15，200 是个宽松但确定的上限 ——
        防止有人构造一条 `amount: 999999` 的消息把自己回满。
    */
    case 'healPlayer': {
      const room = currentRoom(connection);
      if (!room) break;
      const player = room.getPlayer(connection.playerId);
      if (!player) break;
      const raw = Number(message.amount);
      const amount = Number.isFinite(raw) ? Math.max(1, Math.min(200, Math.round(raw))) : 0;
      if (amount <= 0) break;
      /*
        ★★ 0.3.31 修（用户报"回血藏品有时候还是不生效"）：
        上限以前只写 `settings.startHp`，**漏了加血盟约那一份** ——
        带「歌利亚」（+30 上限，实际 130）时，吃回血藏品被夹回 100，
        表现就是"说明写着回血，装了没反应"，而且只在带加血盟约的那局才犯。
        ★ 和 `Room.applyCovenantWinHeal` 必须是同一个口径 ⇒ 统一走 `playerMaxHp`。
      */
      const cap = playerMaxHp(room.settings.startHp, player.covenantId);
      const before = player.hp;
      player.hp = Math.min(cap, player.hp + amount);
      if (player.hp !== before) {
        console.log(`[房间 ${room.code}] ${player.name} 藏品回血 +${player.hp - before}（${before} -> ${player.hp}）`);
        broadcastRoom(room);
      } else {
        /*
          ★ 满了就明说 —— 否则客户端那句"血量 +15"是在骗人，
          玩家只会以为是 bug（0.3.3 实测：满血吃回血藏品，看不到任何反馈）。
        */
        sendError(connection, 'HEAL_NO_EFFECT', `血量已满（${player.hp}/${cap}），藏品已保留`);
      }
      break;
    }

    /*
      ★★ 0.3：盟约选秀里"我选这个"。
      三道校验都在 `Room.pickCovenant` 里（阶段 / 轮到你 / 没被选走），
      这里只负责把结果转给调用方：成了就推进，没成就回一条明确的错。
    */
    case 'pickCovenant': {
      const room = currentRoom(connection);
      if (!room) break;
      const result = room.pickCovenant(connection.playerId, String(message.covenantId ?? ''));
      if (!result.ok) {
        sendError(connection, 'COVENANT_REJECTED', result.error ?? '这个盟约选不了');
        break;
      }
      afterCovenantPick(room);
      break;
    }

    case 'updateSettings': {
      const room = currentRoom(connection);
      if (!room) break;
      if (room.hostId !== connection.playerId) {
        sendError(connection, 'NOT_HOST', '只有房主能改房间设置');
        break;
      }
      if (room.phase !== 'lobby') {
        sendError(connection, 'WRONG_PHASE', '对局已经开始了，这一局的规则不能再改');
        break;
      }
      const applied = room.applySettings(message.settings);
      broadcastRoom(room);
      console.log(
        `[房间 ${room.code}] 房主改了设置：血量 ${applied.startHp} · 金币 ${applied.startGold} · ` +
          `收入 ${applied.incomeBase} · 布阵 ${applied.prepSeconds}s · 商店回合 ${applied.shopRound ? '开' : '关'}`,
      );
      break;
    }

    /*
      ============================================================
      ★★ 0.3.3：房主的三个「人机」操作
      ============================================================
      【为什么权限 / 阶段 / 上限都在服务端判？】
      和踢人、改设置同一条理由：客户端把按钮藏起来只是"不给普通人看到"，
      不是权限 —— 任何人手写一条消息就能发过来。所以这里必须自己验一遍。

      【为什么只允许大厅阶段？】
      对局中加人机会把配对、牌库份额、"等所有人看完战斗"的名单全部搞乱；
      对局中删人机则等于把一个正在打的玩家凭空蒸发（他的血量还在结算里）。
      开局之后要换人，请打完这一局。
    */
    case 'addBot': {
      const room = currentRoom(connection);
      if (!room) break;
      if (room.hostId !== connection.playerId) {
        sendError(connection, 'NOT_HOST', '只有房主能添加人机');
        break;
      }
      if (room.phase !== 'lobby') {
        sendError(connection, 'WRONG_PHASE', '对局已经开始了，不能再加人机');
        break;
      }
      const difficulty = clampBotDifficulty(message.difficulty);
      const added = rooms.addBot(room.code, difficulty, botDisplayName);
      if (added.error || !added.room || !added.bot) {
        sendError(connection, 'BOT_REJECTED', added.error ?? '加不了人机');
        break;
      }
      createBot(added.room, added.bot, difficulty);
      broadcastRoom(added.room);
      // 局域网列表里的人数变了，催一下
      lan?.poke();
      break;
    }

    case 'removeBot': {
      const room = currentRoom(connection);
      if (!room) break;
      if (room.hostId !== connection.playerId) {
        sendError(connection, 'NOT_HOST', '只有房主能删除人机');
        break;
      }
      const target = room.getPlayer(String(message.playerId ?? ''));
      if (!target || !target.isBot) {
        sendError(connection, 'NO_SUCH_PLAYER', '找不到这台人机');
        break;
      }
      if (room.phase !== 'lobby') {
        sendError(connection, 'WRONG_PHASE', '对局已经开始了，不能删人机');
        break;
      }
      const name = target.name;
      // 先摘脑子再摘座位（反过来的话，座位没了还可能有定时器往里写消息）
      disposeBot(target.id);
      const removed = rooms.removeBot(room.code, target.id);
      if (removed.error || !removed.room) {
        sendError(connection, 'NO_SUCH_PLAYER', removed.error ?? '找不到这台人机');
        break;
      }
      console.log(`[房间 ${room.code}] 房主移除了人机 ${name}`);
      broadcastRoom(removed.room);
      lan?.poke();
      break;
    }

    case 'setBotDifficulty': {
      const room = currentRoom(connection);
      if (!room) break;
      if (room.hostId !== connection.playerId) {
        sendError(connection, 'NOT_HOST', '只有房主能改人机难度');
        break;
      }
      const target = room.getPlayer(String(message.playerId ?? ''));
      if (!target || !target.isBot) {
        sendError(connection, 'NO_SUCH_PLAYER', '找不到这台人机');
        break;
      }
      const difficulty = clampBotDifficulty(message.difficulty);
      const updated = rooms.setBotDifficulty(room.code, target.id, difficulty);
      if (updated.error || !updated.room) {
        sendError(connection, 'WRONG_PHASE', updated.error ?? '改不了难度');
        break;
      }
      // 名字里带着难度，所以改名和换难度是同一件事（"人机·困难2" -> "人机·简单2"）
      const index = target.name.match(/(\d+)$/)?.[1] ?? '1';
      target.name = botDisplayName(difficulty, Number(index));
      bots.get(target.id)?.setDifficulty(difficulty);
      console.log(`[房间 ${room.code}] 房主把 ${target.id} 的难度改成 ${difficulty}`);
      broadcastRoom(updated.room);
      break;
    }

    case 'backToLobby': {
      const room = currentRoom(connection);
      if (!room) break;
      /*
        ★★ 0.3.5「再来一局」：打完一局之后把房间退回大厅（座位、房间号都不变）。

        【为什么只允许"对局已经结束"的时候？】
        `isGameOver()` 为真 = 只剩一个活人。那正是 `gameOver` 已经发出去的状态。
        对局进行中收到这条 = 有人想中途解散 —— 不该由单个玩家说了算，
        所以直接拒（`MATCH_RUNNING`）。大厅里重复点则是幂等的空操作。
      */
      if (room.phase === 'lobby') {
        broadcastRoom(room);
        break;
      }
      if (!room.isGameOver().over) {
        sendError(connection, 'MATCH_RUNNING', '对局还没结束，不能回到大厅');
        break;
      }
      // 上一局可能还挂着的定时器全部收掉，否则会推到"空气里"
      clearPlaybackWait(room.code);
      clearPause(room.code);
      room.backToLobby();
      const who = room.getPlayer(connection.playerId);
      console.log(`[房间 ${room.code}] ${who?.name ?? connection.playerId} 点了「再来一局」，房间回到大厅`);
      broadcastRoom(room);
      break;
    }

    case 'startGame': {
      const room = currentRoom(connection);
      if (!room) break;
      if (room.hostId !== connection.playerId) {
        sendError(connection, 'NOT_HOST', '只有房主能开始游戏');
        break;
      }
      if (!room.canStart()) {
        sendError(connection, 'NOT_ENOUGH_PLAYERS', `至少需要 ${MIN_PLAYERS_TO_START} 名玩家`);
        break;
      }
      // 其他人要点过「准备好了」才能开局 —— 避免房主在别人还没连好时就开打
      const notReady = room.players.filter((p) => p.id !== room.hostId && !p.ready && p.connected);
      if (notReady.length > 0) {
        sendError(connection, 'PLAYERS_NOT_READY', `还有 ${notReady.length} 位玩家没准备好：${notReady.map((p) => p.name).join('、')}`);
        break;
      }
      /*
        ★ 0.3：**开局那一刻**按房间设置刷一遍所有人的血量。

        【为什么不在 addPlayer 里设完就算？】
        因为设置是"开局前随时可改"的 —— 玩家可能在第 3 分钟改了血量，
        而座位是第 1 分钟就坐下的。只靠 addPlayer 的话，先进来的人用的是旧值。
        在这儿统一刷一遍，"开局血量"才真的是"开局那一刻"的血量。
      */
      for (const player of room.players) player.hp = room.settings.startHp;
      // 新的一局：牌库清空重来（上一局被拿走的牌不能留到这一局）
      room.resetPool();
      // 上一局可能还挂着一个"等回执"的定时器，开新局前清掉
      clearPlaybackWait(room.code);
      /*
        ★★ 0.3：**不再直接进布阵** —— 先进盟约选秀，全员选完才开始第一回合。
        ★ 房主可以在房间设置里关掉盟约（`covenants: false`），那就退回老流程。
      */
      if (room.settings.covenants) beginCovenantPhase(room);
      else beginPrepPhase(room);
      break;
    }

    case 'submitTeam': {
      const room = currentRoom(connection);
      if (!room) break;
      /*
        ★ 0.2 商店回合：`shop` 阶段**也要收阵容** ——
        商店这 90 秒里玩家照样在摆棋子（刚买的 2 星要放上去），
        而"最后收到的那一份"才是开打时用的。挡住它的话，
        玩家在商店里摆的东西开打时会全部丢掉（服务器手里还是上一回合的旧阵容）。
      */
      if (room.phase !== 'prep' && room.phase !== 'shop') {
        sendError(connection, 'WRONG_PHASE', '现在不是准备阶段');
        break;
      }
      const units = Array.isArray(message.units) ? message.units : [];
      /*
        ★ 空阵容不再当成错误。
        因为现在客户端是"每改一次阵容就静默同步一次"，
        玩家把场上棋子全收回备战席时会短暂出现空阵容 ——
        那是完全正常的操作，不该报错打扰他。
        （时间到了如果还是空的，那一场就当空阵打，输了也是自己的选择。）
      */
      /*
        ★★ 0.2.2：**挽救式校验**（原来是 `validatePlacements` 一票否决）。

        【以前的问题】只要有**一个**棋子不合规，整份阵容就被拒收 ——
        服务端手上留下的还是更旧的一份，玩家重进时拿去还原的就是那份旧数据
        （"数据非法玩家重进数据丢失"，用户报的）。
        【现在】坏的那几个单独扔掉，剩下的照常参战；一个不剩才整份拒收
        （但**依然记进 `lastSeenTeam`**，重连照旧能把他看到的棋盘装回去）。
      */
      const submittedBy = room.getPlayer(connection.playerId);
      const repaired = repairPlacements(units, {
        allowAscend: submittedBy?.covenantId === 'cv_amiya',
      });
      if (repaired.dropped.length > 0) {
        // 服务端日志：这类事必须留痕，否则"我的棋子怎么没了"永远查不出来
        console.warn(
          `[submitTeam] 玩家 ${connection.playerId} 的阵容有 ${repaired.dropped.length} 处不合法：` +
            repaired.dropped.map((item) => `${item.defId || '?'}(${item.reason})`).join(' / '),
        );
        if (repaired.units.length > 0) {
          /*
            还有能用的棋子 ⇒ 这一份**照常参战**（少一个，而不是整份不算）。
            但必须**明确告诉玩家**：不提示的话，他只会在开打时发现"我明明摆了 8 个"，
            却少了一个 —— 那看起来就是"服务器把我棋子吃了"。
          */
          sendError(
            connection,
            'TEAM_REPAIRED',
            `有 ${repaired.dropped.length} 个棋子的站位数据不合法（${[...new Set(repaired.dropped.map((item) => item.reason))].join(' / ')}），` +
              '这次同步已忽略它们，请重新摆放',
          );
        } else {
          sendError(connection, 'BAD_TEAM', '阵容数据不合法，整份都没有生效（请重新摆放）');
        }
      }
      /*
        ★ 全部被丢掉 ⇒ 这份数据没资格开打，交给 `submitTeam` 的 `rejected` 分支：
        只记下来（重连还原用），不写进 `player.team`。
      */
      const rejectedAll = units.length > 0 && repaired.units.length === 0;
      /*
        ★ 0.0.3 藏品：单位和"装备在单位身上的 A 类藏品"是同一条消息带过来的
        （items 挂在 UnitPlacement 上）。共享藏品和玩家金币 / 血量在另外两个字段上，
        原样存下来、开打时交给 buildTeamSetup ——
        这一层**不做校验**，因为它只是"原始输入"，
        真正的加成永远由服务端拿它重算一遍（见 Room.buildTeamSetup）。
      */
      room.submitTeam(
        connection.playerId,
        {
        // ★ 0.2.2：交的是**修好之后**的那一份（坏掉的那几个已经挑出去了）
        units: repaired.units,
        /*
          ★ 0.1.1：备战席**必须原样带过去**。
          这里原来只挑了 units / sharedItems / playerContext 三个字段 ——
          新加的 bench 被无声地丢在这一层，于是"观战看不到对方备战席"、
          "淘汰时手上的牌还不回牌库"两个功能**都不会生效，而且不报任何错**。
          （和当初 items 漏在这一层的 bug 一模一样：同一份数据只允许构造一次，
            所以下面直接透传客户端那份，不在这里重拼。）
        */
        bench: sanitizeBench(message.bench),
        sharedItems: Array.isArray(message.sharedItems) ? message.sharedItems : undefined,
        // ★ 0.2：共享藏品**逐副本**层数（新字段，同样必须在这一层放行）
        sharedItemLayers: Array.isArray(message.sharedItemLayers)
          ? message.sharedItemLayers.map((n) => Math.max(0, Math.floor(Number(n) || 0)))
          : undefined,
        playerContext:
          message.playerContext && typeof message.playerContext.gold === 'number'
            ? { gold: message.playerContext.gold, hp: message.playerContext.hp ?? 0 }
            : undefined,
        /*
          ★ 0.1.1 藏品二版：跨回合成长层数。和 bench 一样是"新加的字段"，
          必须在这一层放行，否则会被静默丢掉（备战席踩过这个坑）。
          它是**原始输入**，所以先夹范围再存（见 sanitizeItemState）。
        */
        itemState: sanitizeItemState(message.itemState),
        // ★ 0.2：罗德岛跨回合叠层 —— 和 bench / itemState 一样是"新加的字段"，
        //   必须在这一层放行，否则会被静默丢掉。
        traitStacks: sanitizeTraitStacks(message.traitStacks),
        // ★ 0.2 MujicaAve：fever 原样收下（服务端没有"谁挨了多少下"的账本，只能听客户端的）
        fever: sanitizeFever(message.fever),
        },
        /*
          ★★ 0.2.2：
          · `rejected` 只影响"能不能拿来开打"，**不影响** `lastSeenTeam`
            （那份永远记下来，重连还原要用）。
          · `rawUnits` 是**原文**：上面 `units` 已经被修过（坏格子挑掉了），
            而重连要"把他看到的棋盘原样装回去"，所以这里再交一份原文。
          见 Room.submitTeam。
        */
        { rejected: rejectedAll, rawUnits: units },
      );
      // 让所有人看到"他摆了些什么"（玩家列表 -> 看别人阵容）
      broadcast(room, { t: 'prepTeams', teams: room.currentTeams() });
      broadcastRoom(room);
      // 注意：**不**在这里提前开打。布阵固定 60 秒，时间到了统一开打。
      break;
    }

    case 'buyCard': {
      const room = currentRoom(connection);
      if (!room) break;
      /*
        ★★ 0.2.1（用户 2026-10-17 报的严重 bug）：**淘汰的人不许买牌**。

        【为什么客户端关了商店还不够？】
        淘汰那一刻服务端已经把手牌全部还回共享牌库（`markEliminated` ->
        `returnCardsToPool`）。他再买 = 同一张牌被卖给第二个人 ⇒ 牌库超发；
        而且他买的牌永远上不了场（阵容已清空、也不再有自己的回合）。
        客户端那边现在把商店整块关了，但那种闸门拦不住改过的客户端 ——
        所以服务端必须**自己**再判一次（判据唯一：`Room.isEliminated`）。
      */
      if (room.isEliminated(connection.playerId)) {
        send(connection, {
          t: 'buyResult',
          ok: false,
          defId: message.defId,
          message: '你已被淘汰，商店已对你关闭',
        });
        break;
      }
      /*
        ★ 对战中也能买（你要求的）。
        买了立刻进备战席，下一回合就能上场 —— 相当于"边看边运营"。
        注意买牌**不影响正在播的那场战斗**：战斗结果早就定好了（种子重放），
        所以中途买牌不会让两边看到不一样的战斗。

        ★★ 0.1.2 修：**`resolve` 也要放行**（用户报的"战斗中还是不能买"）。
        服务端在**发完 battleStart 之后立刻**就把 phase 切成了 `resolve`
        （见 runBattlePhase 末尾），而那之后全房间还在看战斗回放（最长一分多钟）——
        以前这段时间只放行 prep/battle，于是"看着战斗却买不了牌"。
        客户端那边的同一个窗口叫 `result`，两边都要开（见 state.ts 的 canShopNow）。
        ★ 0.2：`shop`（商店回合）也要放行 —— 那 90 秒正是用来买东西的，
        挡住它等于商店里只能买藏品、不能买干员位。
        唯一仍然挡住的是 **lobby**（还没开局）。
      */
      if (
        room.phase !== 'prep' &&
        room.phase !== 'shop' &&
        room.phase !== 'battle' &&
        room.phase !== 'resolve'
      ) {
        send(connection, { t: 'buyResult', ok: false, defId: message.defId, message: '现在不能买棋子' });
        break;
      }
      const def = UNIT_DEFS[message.defId];
      if (!def) {
        send(connection, { t: 'buyResult', ok: false, defId: message.defId, message: '没有这个干员' });
        break;
      }

      /*
        服务器只裁决一件事：**这张牌还有没有货**。
        金币目前还是客户端自己管的（见 docs「服务端权威经济」），
        所以这里不校验钱够不够 —— 那需要把整个经济搬到服务端，是下一步的事。
        但"牌不能超发"这一条必须现在守住，否则 8 个人共享牌库就是假的。
      */
      /*
        ★ 0.2 商店回合：干员位卖的是 **2 星 = 3 张**，一次要扣 3 张。
        ★★ 必须**一次扣完**（`takeFromPool(id, copies)` 是原子的）：
        分 3 条消息、扣 3 次的话，中间那两张可能被别人抢走 ——
        于是出现"只扣到 2 张却给了个 2 星"这种牌库超发。
        不传 = 1 张（常规商店那一格就是一张）。
      */
      const copies = Math.max(1, Math.min(9, Math.floor(message.count ?? 1)));
      const taken = room.takeFromPool(def.id, copies);
      if (!taken.ok) {
        send(connection, {
          t: 'buyResult',
          ok: false,
          defId: def.id,
          message: `${def.name} 牌库不够 ${copies} 张了（只剩 ${taken.remaining} 张）`,
        });
        break;
      }

      send(connection, {
        t: 'buyResult',
        ok: true,
        defId: def.id,
        message: copies > 1 ? `买下 2 星 ${def.name}` : `买下 ${def.name}`,
      });
      // 买到手 = 牌真的从池子里扣掉了，所以"预定"那一份也要同时撤掉（否则别人会看成少两张）
      room.releaseShopHeld(connection.playerId, def.id);
      // 任何人买牌都会改变牌库，所以广播给全房间 —— 别人应该看到"这张牌变少了"
      broadcastPool(room);
      break;
    }

    case 'shopUpdate': {
      /*
        ★ 客户端报告"我商店里现在摆着哪些牌"（你报的第 11 条）。
        这一步只做"记账"，不改牌库本身 —— 牌还没被买走，
        只是**别人**在刷新的时候不该再抽到它。
        客户端每次刷新/买走之后整份重发，所以这里直接覆盖。
      */
      const room = currentRoom(connection);
      if (!room) break;
      const defIds = Array.isArray(message.defIds)
        ? message.defIds.filter((defId) => typeof defId === 'string' && defId.length > 0 && UNIT_DEFS[defId])
        : [];
      room.setShopHeld(connection.playerId, defIds);
      broadcastPool(room);
      break;
    }

    case 'recruitFromPool': {
      /*
        ★ 0.1.1：藏品「随机招募」（人事部铜印 / 博士银印）的裁决。
        和买牌同一条理由 —— 招募到的人**真的占牌库 1 张**，牌库是共享的，
        所以必须由服务器扣。规则复用 shared 的 `pickRecruit`（单机同一套）。
        不校验阶段：客户端那边"能不能装藏品"已经有闸门（和金币一样，服务器只管牌库）。
      */
      const room = currentRoom(connection);
      if (!room) break;
      const minCost = Math.max(1, Math.min(5, Math.floor(message.minCost) || 1));
      const maxCost = Math.max(minCost, Math.min(5, Math.floor(message.maxCost) || minCost));
      const seed = Number.isFinite(message.seed) ? Math.floor(message.seed) : 0;
      const result = room.recruit(minCost, maxCost, seed);
      send(connection, { t: 'recruitResult', defId: result.defId, gold: result.gold });
      if (result.defId) {
        // 这张牌真的从池子里扣掉了 —— 我商店里"预定"的那一份也要撤掉，否则别人会看成少两张
        room.releaseShopHeld(connection.playerId, result.defId);
        broadcastPool(room);
      }
      break;
    }

    case 'sellCard': {
      const room = currentRoom(connection);
      if (!room) break;
      /*
        ★★ 0.2.1：淘汰的人也不许"还牌"。
        他的牌在 `markEliminated` 那一刻就已经全部还回牌库了（还按 `poolCopiesOf`
        换算过），此时再还一次就是**凭空变牌**（同一张牌在牌库里出现两份）。
        注意这和上一条不同：买是"少给"，卖是"多给"，两个方向都会把牌库搞乱。
      */
      if (room.isEliminated(connection.playerId)) break;
      const def = UNIT_DEFS[message.defId];
      if (!def) break;
      /*
        ★ 0.3.2：阿米娅的升变形态**不能出售**（用户口径）。
        客户端已经在右键那一步拦住了，这里再拦一道是防"改过的客户端"：
        卖形态会让那几张阿米娅的牌回到共享牌库，等于把升变的成本也退了。
        （多人模式没有测试模式，所以不需要例外。）
      */
      if (isSellLockedDefId(def.id)) break;
      /*
        按**实际占用**还牌：二星还 3 张、三星还 9 张是默认换算，
        但道具多给的份数（博士投影升星、拟态物质复制）没从牌库拿过 ——
        客户端算好张数发过来，还多了就是凭空变牌。
        夹一下范围，防止客户端乱发把牌库撑爆。
      */
      const star = Math.max(1, Math.min(3, Math.floor(message.star)));
      const fallback = copiesOf(star);
      const copies =
        typeof message.copies === 'number' && Number.isFinite(message.copies)
          ? Math.max(0, Math.min(fallback, Math.floor(message.copies)))
          : fallback;
      if (copies > 0) room.returnToPool(def.id, copies);
      broadcastPool(room);
      break;
    }

    /*
      ★ 0.1.4：投票「取消暂停」（暂停浮层上唯一那颗按钮）。
      在线的人**全部**点过 -> 暂停立刻结束 + 掉线那位当场淘汰（见 votePause）。
    */
    case 'pauseVote': {
      const room = currentRoom(connection);
      if (!room) break;
      votePause(room, connection.playerId);
      break;
    }

    case 'playbackDone': {      const room = currentRoom(connection);
      if (!room) break;
      const waiter = playbackWaiters.get(room.code);
      if (!waiter || waiter.fired) break;
      // 只认这一回合的战斗：防止客户端把上一场的回执重复发过来
      if (!waiter.battleIds.has(message.battleId)) break;
      if (!waiter.pending.has(connection.playerId)) {
        // 旁观者/轮空的人不需要举手，举手了也不算数（免得他替别人"看完"了）
        break;
      }
      waiter.pending.delete(connection.playerId);
      // 第一个看完的人一到，就挂上 70 秒硬超时：
      // 后面的人要是看太久（切窗口/挂机），不让他拖住已经看完的人。
      if (!waiter.hardTimer) {
        const skipped = () => {
          const stuck = [...waiter.pending].map((id) => room.getPlayer(id)?.name ?? id);
          console.warn(
            `[房间 ${room.code}] 第 ${waiter.round} 回合：有人已看完 70 秒，` +
              `跳过还没看完的：${stuck.join('、') || '（无）'}`,
          );
          fireRoundAdvance(room.code);
        };
        waiter.hardTimer = setTimeout(skipped, PLAYBACK_SKIP_AFTER_MS);
      }
      if (waiter.pending.size === 0) {
        fireRoundAdvance(room.code);
      } else {
        const waiting = [...waiter.pending].map((id) => room.getPlayer(id)?.name ?? id);
        console.log(
          `[房间 ${room.code}] ${room.getPlayer(connection.playerId)?.name ?? connection.playerId} 看完了，` +
            `还在等：${waiting.join('、')}`,
        );
      }
      break;
    }

    case 'ping':
      send(connection, { t: 'pong', serverTime: Date.now() });
      break;

    case 'checksumMismatch':
      // 客户端本地重放算出的校验和与服务器不一致。
      // 这说明「确定性被破坏了」—— 是联机里最严重的问题，
      // 必须留下详细日志，方便事后定位（哪个种子、哪场战斗、差多少）。
      console.error('');
      console.error('!!! 确定性校验失败 !!!');
      console.error(`  玩家     ${connection.playerId}`);
      console.error(`  战斗     ${message.battleId}`);
      console.error(`  服务器   0x${message.expected.toString(16).toUpperCase()}`);
      console.error(`  客户端   0x${message.actual.toString(16).toUpperCase()}`);
      console.error('  这意味着同一颗种子在两台机器上算出了不同结果，需要立刻排查。');
      console.error('');
      break;
  }
}

function currentRoom(connection: Connection): Room | undefined {
  return connection.roomCode ? rooms.getRoom(connection.roomCode) : undefined;
}

/** 房间真的没了：把它挂在全局的那几个计时器 / 缓存一并清掉，别让它们在后台空转 */
function killRoomTimers(code: string): void {
  const covenantTimer = covenantTimers.get(code);
  if (covenantTimer) {
    clearInterval(covenantTimer);
    covenantTimers.delete(code);
  }  const timer = prepTimers.get(code);
  if (timer) {
    clearInterval(timer);
    prepTimers.delete(code);
  }
  prepStartedAt.delete(code);
  prepDurations.delete(code);
  clearPause(code);
  clearPlaybackWait(code);
  battleCache.delete(code);
}

function leaveCurrentRoom(connection: Connection): void {
  if (!connection.roomCode) return;
  const room = rooms.leaveRoom(connection.playerId);
  const code = connection.roomCode;
  connection.roomCode = null;
  const session = tokenByPlayer.get(connection.playerId);
  if (session) sessionsByToken.get(session)!.roomCode = null;
  // 走的人不用再"举手说我看完了" —— 不摘掉的话全房间要干等到兜底超时
  dropFromPlaybackWait(code, connection.playerId);
  if (room) {
    // 房主走了（或掉着线走了）-> 把房主交给还在线的人
    room.migrateHost();
    broadcastRoom(room);
    console.log(`[房间 ${code}] ${connection.playerId} 离开（剩 ${room.players.length} 人）`);
    if (room.isEmpty) killRoomTimers(code);
    // ★ 0.1.3/0.1.4：走光了就收尾；否则看看"暂停的原因还在不在"
    else afterSeatRemoved(room);
  } else {
    killRoomTimers(code);
    /*
      ★★ 0.3.3：房间没了 -> 房间里的人机也一起回收。
      不回收的话，它们的定时器会一直在后台空转，而且 `connections` 里
      会慢慢攒下一堆"永远在线"的僵尸玩家。
    */
    disposeRoomBots(code);
    console.log(`[房间 ${code}] 已空，销毁`);
  }
}

/**
 * 读客户端报上来的昵称：**洗 + 校验一步到位**。
 *
 * 【为什么不再"洗不成样子就兜底成「无名玩家」"？】
 * 兜底看着友好，实际是静默改玩家的名字 —— 他填的名字里有一个字不在白名单里，
 * 结果整个名字被换掉、他还不知道为什么。现在改成**明确报错**：
 * 规则在 `shared/names.ts`（2~8 个字 + 字符白名单），文案直接回给玩家。
 *
 * ★ 客户端也调同一份 `playerNameError` 做即时提示，两边规则不会漂。
 */
function readPlayerName(raw: unknown): { name: string; error?: string } {
  const name = sanitizePlayerName(raw);
  const error = playerNameError(name);
  return error ? { name: '', error } : { name };
}

/**
 * 头像 id 清洗：只接受 `op` + 1~3 位数字（对应 `assets/units/opNN.png`）。
 *
 * 【为什么必须白名单？】这个字符串会被拼进客户端的图片地址。
 * 真放个 `../../` 之类的东西进去就是路径穿越；放个超长字符串就是内存/带宽浪费。
 * 客户端只可能发合法的 opNN 过来，所以比"过滤坏字符"更稳妥的写法是**只认合法形状**，
 * 不合法一律当没选（空串），前端自然会退回默认头像。
 */
export function sanitizeAvatarId(raw: unknown): string {
  const text = String(raw ?? '').trim();
  /*
    ★★ 0.3.2：现在有两种头像 id
      · `opNN`        —— 干员头像
      · `pa:avatar_*` —— 官方「个人头像」（玩家头像，203 张，见 public/assets/player-avatars）
    白名单只做"形状"校验：具体存不存在由客户端查清单决定（不认识的就退回默认头像）。
    长度上限 40 是防有人塞一长串东西进来当名字用（它会进房间广播、显示给所有人）。
  */
  if (/^pa:[a-z0-9_]{1,40}$/i.test(text)) return text;
  return /^op\d{1,3}$/.test(text) ? text : '';
}

/**
 * ★ 0.1.3：房主踢人时附的留言。
 *
 * 它会被**原样显示给被踢的人**，所以必须清洗：
 *   · 限长 60 字（再长浮层很难看，也容易被拿来刷屏）；
 *   · 和昵称同一套字符白名单（中日韩 + 字母数字 + 常用标点），
 *     免得有人塞控制字符或一长串空白。
 *   · 洗成空了就返回空串，调用方回退到默认文案。
 *
 * 【为什么不做成必填？】
 * 房主经常只是想清个人、不想每次都写理由；空着就走默认的
 * 「房主把你移出了房间」，被踢的人照样知道发生了什么。
 */
function sanitizeKickMessage(raw: unknown): string {
  const text = String(raw ?? '').trim().slice(0, 60);
  return text
    .replace(/[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}a-zA-Z0-9_\- ，。！？、：；（）…,.!?:;()]/gu, '')
    .trim();
}

/**
 * 校验客户端提交的阵容。
 * 服务端绝不能盲信客户端数据 —— 否则有人改一下请求就能摆 20 个 3 星 5 费干员。
 *
 * 【注意：范围必须从常量推导，不能写死】
 * 这里以前写的是 `col > 3 || row > 5`（旧棋盘 8×6、每方 4×6 的写法）。
 * 后来棋盘改成每方 5×10，这段没跟着改，
 * 结果**合法阵容被判成越界**，整个联机流程静默卡住（报错信息只有「等待超时」）。
 * 教训：凡是和棋盘尺寸有关的判断，一律用 constants 里的常量。
 */
/**
 * ★★ 0.2.2：阵容校验收敛成「**挽救式**」—— 一条一条挑，坏的扔掉、好的留下。
 *
 * 【为什么要改？以前的写法是"错一个就整份拒收"】
 * 用户报过一个真事：某位玩家的阵容被判非法，于是这一整份都不算数 ——
 * 他重进游戏时拿到的还是更早的快照，**棋盘 / 备战席 / 金币全部回退**。
 * 而"非法"往往只是**一个**棋子的一个格子出问题（拖拽事故、越界、认不出的 id），
 * 因为他摆错了一格就让另外 7 个棋子这一回合全部不算数，代价完全不对等。
 *
 * 【现在的口径】
 *   · 结构坏掉的（认不出的 defId / 星级越界 / 格子不是整数）→ 丢掉那一个
 *   · 落点越界的（不在本方半场里）→ 丢掉那一个
 *   · 两枚棋子压同一格 → 保留先出现的那个，后面的丢掉（服务端不替玩家"挪"棋子：
 *     挪了他自己那边看到的和真正参战的又不是同一套，比丢掉更难解释）
 *   · 超过人口上限 → 只留前面的若干个
 * 只要还剩至少一枚，这份阵容就**照常参战**（是"少一个"而不是"整份不算"）；
 * 一个都不剩时才整份拒收，但**仍然记进 `lastSeenTeam`**，重连照旧能还原他的棋盘。
 *
 * @returns `units` 能拿去开打的那些；`dropped` 丢掉的（带原因，用于日志和提示）
 */
export function repairPlacements(
  units: unknown[],
  /**
   * ★★ 0.3.2：允不允许出现**升变形态**（阿米娅的三个形态只能由升变产生）。
   *
   * 【为什么服务端要管这个？】
   * 这三个形态也在 `UNIT_DEFS` 里（内核只认一张表），所以一个改过的客户端
   * 完全可以直接上报 `defId: 'op_amiya_core'` —— 一件证都不用。
   * 服务端手里没有"他做没做完任务"的账本，但至少能守住最低一条：
   * **没选「阿米娅 · 不容拒绝」的人，队伍里不可能有升变形态**。
   * 选了的人最多只能"少做任务"，不会凭空多出一个别人的终态。
   */
  opts: { allowAscend?: boolean } = {},
): {
  /**
   * ★ 保留的是**客户端发来的原始对象**（不是重新构造的 `{defId, star, cell}`）。
   *   站位上还挂着 `items`（每格的 A 类藏品）、`free`、`statOverride`、`extraTraits` ——
   *   重构造一份就会把它们全部丢掉，而丢藏品**不报错**（0.1.1 被这个坑过两次）。
   */
  units: Array<{ defId: string; star: number; cell: { col: number; row: number } }>;
  dropped: Array<{ defId: string; reason: string; cell?: unknown }>;
} {
  const kept: Array<{ defId: string; star: number; cell: { col: number; row: number } }> = [];
  const dropped: Array<{ defId: string; reason: string; cell?: unknown }> = [];
  const used = new Set<string>();
  for (const raw of units) {
    const unit = raw as { defId?: unknown; star?: unknown; cell?: { col?: unknown; row?: unknown } } | null;
    const defId = typeof unit?.defId === 'string' ? unit.defId : '';
    if (!unit || typeof unit.defId !== 'string' || !UNIT_DEFS[unit.defId]) {
      dropped.push({ defId, reason: '认不出的干员 id', cell: unit?.cell });
      continue;
    }
    const star = Number(unit.star);
    if (!Number.isInteger(star) || star < 1 || star > 3) {
      dropped.push({ defId, reason: `星级越界（${String(unit.star)}）`, cell: unit.cell });
      continue;
    }
    const col = Number(unit.cell?.col);
    const row = Number(unit.cell?.row);
    if (!Number.isInteger(col) || !Number.isInteger(row)) {
      dropped.push({ defId, reason: '格子坐标不是整数', cell: unit.cell });
      continue;
    }
    // 客户端提交的阵容统一按「队伍 0（左半边）」校验
    if (col < 0 || col > TEAM_0_MAX_COL || row < 0 || row >= BOARD_H) {
      dropped.push({ defId, reason: `站位越界（${col},${row}）`, cell: unit.cell });
      continue;
    }
    if (UNIT_DEFS[defId]?.ascendOnly === true && opts.allowAscend !== true) {
      dropped.push({ defId, reason: '升变形态只能由盟约「不容拒绝」获得', cell: unit.cell });
      continue;
    }
    const key = `${col},${row}`;
    if (used.has(key)) {
      dropped.push({ defId, reason: `两枚棋子压在同一格（${col},${row}）`, cell: unit.cell });
      continue;
    }
    if (kept.length >= MAX_POPULATION) {
      dropped.push({ defId, reason: `超过人口上限（${MAX_POPULATION}）`, cell: unit.cell });
      continue;
    }
    used.add(key);
    // 原样保留客户端那一份（含 items / free / statOverride / extraTraits）
    kept.push(raw as { defId: string; star: number; cell: { col: number; row: number } });
  }
  return { units: kept, dropped };
}

// ============================================================
// 启动
// ============================================================

export function startServer(port = PORT, host = HOST): { wss: WebSocketServer; close: () => void } {
  const wss = new WebSocketServer({ port, host });

  /*
    ★ 局域网发现：广播"我这儿有哪些房间"，同时收别人的广播。
    【为什么要等 wss 真正 listening 之后再起？】
    因为广播里要写"朋友该连哪个端口"，而端口可能因为占用顺延（8787 → 8788）。
    拿到真实端口再起，广播出去的地址才是对的。
  */
  wss.once('listening', () => {
    const address = wss.address();
    const realPort = typeof address === 'object' && address ? address.port : port;
    lan?.close();
    lan = startLanDiscovery(realPort, () => rooms.advertisedRooms());
  });

  wss.on('connection', (socket) => {
    const playerId = newPlayerId();
    const connection: Connection = { socket, playerId, roomCode: null, alive: true };
    connections.set(playerId, connection);
    /*
      ★ 0.1.2：先发一枚断线重连令牌。
      这条连接如果之后凭令牌 `resume` 成功，这枚令牌连同这个临时 playerId 都会被作废
      （见 resume 的处理）—— 所以"临时身份"不会有残留。
    */
    registerSession(playerId, newResumeToken());

    sendWelcome(connection);

    socket.on('message', (data) => {
      const message = decodeMessage<ClientMessage>(data.toString());
      if (!message) {
        sendError(connection, 'BAD_MESSAGE', '消息格式不对');
        return;
      }
      try {
        handleMessage(connection, message);
      } catch (error) {
        console.error('处理消息出错:', error);
        sendError(connection, 'INTERNAL', '服务器内部错误');
      }
    });

    socket.on('close', () => {
      handleSocketClosed(connection);
    });

    socket.on('error', (error) => {
      console.error(`连接 ${playerId} 出错:`, error.message);
    });
  });

  wss.on('listening', () => {
    /*
      ★ 端口要用**真实绑定到的那个**：调用方可能传 0（让系统随便挑，
      测试就是这么用的），也可能因为占用被启动器顺延。
      日志里写请求值会出现"ws://127.0.0.1:0"这种让人看不懂的地址。
    */
    const bound = wss.address();
    const boundPort = typeof bound === 'object' && bound ? bound.port : port;
    console.log('');
    console.log('  失序协议 联机服务器已启动');
    console.log(`  监听地址   ws://${host === '0.0.0.0' ? 'localhost' : host}:${boundPort}`);
    console.log(`  版本       ${SERVER_VERSION}`);
    console.log(`  棋子库     ${Object.keys(UNIT_DEFS).length} 个棋子`);
    console.log('');
    console.log('  ★ 联机怎么玩：你（房主）在游戏里点「创建房间」，');
    console.log('    朋友在同一局域网里点「加入房间」，输入你的**房间号**即可。');
    const lanIps = lanAddresses();
    if (lanIps.length > 0) {
      console.log(`    自动发现连不上时（少数组网工具会拦广播），让朋友在设置里手填：`);
      for (const ip of lanIps) console.log(`      ${ip}:${boundPort}`);
    }
    console.log('  同一台电脑测试：开两个浏览器标签页即可');
    console.log('');
  });

  return {
    wss,
    close: () => {
      lan?.close();
      lan = null;
      for (const timer of prepTimers.values()) clearInterval(timer);
      prepTimers.clear();
      for (const waiter of playbackWaiters.values()) clearTimeout(waiter.timer);
      playbackWaiters.clear();
      // ★ 0.1.2：宽限计时器与会话表也要停 —— 不然测试里"关掉服务器"之后
      // 后台还挂着定时器，会把下一个用例的房间误伤掉
      for (const timer of graceTimers.values()) clearTimeout(timer);
      graceTimers.clear();
      sessionsByToken.clear();
      tokenByPlayer.clear();
      battleCache.clear();
      wss.close();
    },
  };
}

// 直接运行本文件时自动启动监听。
// 被测试 import 时不会启动（测试会用 startServer(0) 在随机端口上起一个）。
if (process.env.AIRNIGHT_NO_AUTOSTART !== '1') {
  startServer();
}
