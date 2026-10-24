import {
  MAX_PLAYERS_PER_ROOM,
  SERVER_VERSION,
  decodeMessage,
  encodeMessage,
  seedFromString,
  type BotDifficulty,
  type ClientMessage,
  type LanRoomInfo,
  type PrepTeamView,
  type RoomSettings,
  type RoomView,
  type ServerMessage,
  type SubmittedTeam,
} from '../../../../packages/shared/src/index.js';
import { clearMachineSession, getMachineSession, readMachineToken, saveMachineSession } from './machine-session.js';
// ★ 0.3.3：多槽重连索引（"我在这几局里还有座位"）—— 只服务于局域网房间列表的"回到对局"
import { forgetResumeTarget, rememberResumeTarget } from './resume-index.js';

/**
 * ============================================================
 *  联机客户端：维护与服务器的 WebSocket 连接
 * ============================================================
 *
 * 【这个模块只干一件事：把网络消息变成回调】
 * 它不碰 3D、不碰 DOM、也不管游戏规则。
 * 好处：网络出问题的时候，你不用怀疑是不是「界面代码把网络状态搞乱了」——
 * 两件事被彻底分开了。
 *
 * 【连接的可靠性设计】
 *   1. 心跳：每 15 秒发一次 ping，服务器回 pong。
 *      如果连续 3 次没收到回应，就认为连接已死（WebSocket 有个经典问题：
 *      网线被拔掉时它不会立刻触发 close 事件，可能几分钟都不知道）。
 *   2. 自动重连：断了以后按 1s / 2s / 4s / 8s 递增等待重连，最多 8 秒一次。
 *   3. 消息回调：外部只需要关心「收到什么消息」，不用管连接细节。
 */

export interface NetplayEvents {
  /** 连接建立（注意：这只是连上服务器，还没进房间） */
  onConnected?: () => void;
  /** 连接断开 */
  onDisconnected?: (reason: string) => void;
  /** 收到房间状态更新 */
  onRoom?: (room: RoomView) => void;
  /** 服务器报错 */
  onError?: (code: string, message: string) => void;
  /**
   * 游戏开始（进入准备阶段）。
   * ★ 0.2：`phase === 'shop'` 表示服务器先开 90 秒商店、再开布阵。
   */
  onGameStarted?: (
    roomCode: string,
    round: number,
    phase?: 'prep' | 'shop',
    shopSecondsLeft?: number,
  ) => void;
  /** 准备阶段倒计时 */
  onPrepTick?: (secondsLeft: number) => void;
  /** ★ 0.2 商店回合：商店阶段倒计时（**以服务端为准**，客户端不自减） */
  onShopTick?: (secondsLeft: number) => void;
  /** ★ 0.2：商店阶段结束（服务器已经切回布阵） */
  onShopEnded?: () => void;
  /**
   * ★ 0.3 盟约选秀：每秒一拍的倒计时。
   * 只更新那一个数字（**别顺手 renderAll** —— 那会重建整个选秀页，
   * 打断正在看的卡片的 hover）。
   */
  onCovenantTick?: (secondsLeft: number) => void;
  /**
   * ★ 0.1.4：暂停倒计时（有人掉线、对局冻结时每秒一拍）。
   * 只更新暂停浮层上的数字，**不要**顺手 renderAll（那是每次重画整块界面的代价）。
   */
  onPauseTick?: (info: { secondsLeft: number; voteCount: number; voteNeeded: number }) => void;
  /** 一场战斗开始（含种子和双方阵容） */
  onBattleStart?: (payload: Extract<ServerMessage, { t: 'battleStart' }>) => void;
  /** 一场战斗结束 */
  onBattleEnd?: (payload: Extract<ServerMessage, { t: 'battleEnd' }>) => void;
  /** 有人被淘汰 */
  onPlayerEliminated?: (playerId: string) => void;
  /** ★ 0.1.1：我被房主请出了房间（要直接退房回主界面，不是弹个提示就算了） */
  onKicked?: (reason: string) => void;
  /** 整局结束 */
  onGameOver?: (payload: Extract<ServerMessage, { t: 'gameOver' }>) => void;
  /** 牌库剩余张数变了（任何人买卖之后服务器都会广播） */
  onPool?: (remaining: Record<string, number>, held: Record<string, string[]> | null) => void;
  /** 我的买牌申请有结果了 */
  onBuyResult?: (payload: Extract<ServerMessage, { t: 'buyResult' }>) => void;
  /** ★ 0.1.1：我的"藏品随机招募"申请有结果了（defId 为空 = 牌库空了，改用 gold 补偿） */
  onRecruitResult?: (payload: Extract<ServerMessage, { t: 'recruitResult' }>) => void;
  /** 布阵期间，所有人当前摆好的阵容（用于"看别人怎么摆"，含备战席） */
  onPrepTeams?: (teams: Record<string, PrepTeamView>) => void;
  /**
   * ★★ 0.3.2：服务器回了"当前阶段/回合"的权威口径（`requestSync` 的答复）。
   *
   * 客户端用它把 `round` / `phase` / 倒计时对齐 —— **不做任何结算**。
   * 见 `RoomView.rev` 的说明（为什么需要这条补同步通道）。
   */
  onPhaseState?: (payload: Extract<ServerMessage, { t: 'phaseState' }>) => void;
  /**
   * ★ 0.0.3 末：服务器报回的"局域网里现在有哪些房间"（回 lanScan）。
   *
   * ★★ 0.3.3：**这里有多个订阅者了**（房间列表常驻 + 按房间号查找），
   * 单一回调会被后注册的盖掉（`findLanRoom` 就是靠临时改写它来等结果的）——
   * 两个同时跑就互相踩。所以以它为准的"真正通道"是 `onLanRoomsChange()`，
   * 这个字段只保留给"确实只有一个订阅者"的旧代码路径。
   */
  onLanRooms?: (rooms: LanRoomInfo[]) => void;
  /**
   * ★ 服务器握手时告诉我们的信息。
   *
   * 0.1.2 起多了 `resumeToken` —— 断线重连的凭据（只发给本人）。
   * 还顺手把一直没被用起来的 `serverVersion` 交出去：客户端可以拿它做能力探测
   * （不认识的服务器就干脆别显示"正在重连"，免得玩家对着一个永远连不上的界面等）。
   */
  onWelcome?: (payload: {
    lanAddresses: string[];
    playerId: string;
    serverVersion: string;
    resumeToken?: string;
  }) => void;
  /**
   * ★ 0.1.2：断线重连成功，服务器把**当前状态整体**补过来了。
   * 客户端拿它重建房间 / 牌库 / 观战阵容 / 战斗重放（见 protocol 的 ResumeStatePayload）。
   */
  onResumeState?: (payload: Extract<ServerMessage, { t: 'resumeState' }>) => void;
  /**
   * ★ 0.1.2：重连失败（令牌失效 / 座位没了）—— 要退出重连状态、回主界面。
   *
   * ★ 0.1.4 多了第三个参数 `roomCode`：**出事的是哪一局**。
   *   界面要拿它把话说明白（"房间 HV2PLX 那一局回不去了"）——
   *   而它在 `clearResumeToken()` 之后就已经查不到了，所以必须由这里先取出来递过去。
   *   取不到时是空串（比如本来就没进过房间）。
   */
  onResumeFailed?: (code: string, message: string, roomCode: string) => void;
  /**
   * ★ 0.1.2：你在另一处进入了游戏（同一令牌被后到的连接顶掉）。
   * 收到就要退出对局，且**不要再自动重连**（否则两个标签页互踢成死循环）。
   */
  onReplaced?: (reason: string) => void;
}

/*
  ★ 0.1.2：令牌的存放点从"标签页级（sessionStorage）"改成了
  **机器级（本地进程，见 net/machine-session.ts）**。

  【为什么要改？】
  原来存 sessionStorage 的后果是：**关掉标签页 / 关掉浏览器，令牌就没了** ——
  而"不小心关了浏览器"恰恰是最常见的掉线，那条路一走就再也回不到对局。
  现在交给本机进程保管：关浏览器不丢，重开还是同一个玩家；
  而且一台机器只有一份，天然就是"一台机器一个玩家"。

  存/清由 `syncMachineSession` / `clearResumeToken` 负责（时机是"进房 / 退房"，
  不是"连上服务器"——连上服务器只代表拿到了令牌，还没开始玩）。
*/

/** 读回本机令牌（只有"服务器地址对得上"才认） */
function readStoredResume(url: string): string {
  return readMachineToken(url);
}

/** 心跳间隔（毫秒） */
export const HEARTBEAT_MS = 15000;
/** 连续多少次心跳没回应就判定断线 */
export const MAX_MISSED_HEARTBEATS = 3;
/**
 * ★★ 0.2.1：**一次建连最多等多久**（毫秒）。
 *
 * 【它修的是什么？】
 * `new WebSocket(url)` 撞上"地址黑洞"（隧道挂了 / 机器休眠 / 换了网络）时，
 * 浏览器会长时间停在 CONNECTING —— 那是**操作系统 TCP 超时**说了算，
 * 几十秒到一两分钟。这期间 `connect()` 会因为"已经有一条在连了"直接早退，
 * 于是**每一次重试都是空转**，玩家看到的就是"点重连没有任何反应"。
 * 所以必须自己在 8 秒之后放弃这次尝试、另起一条。
 */
export const CONNECT_TIMEOUT_MS = 8000;
/**
 * ★★ 0.2.1：`resume` 发出去之后**最多等多久**回话（毫秒）。
 *
 * 正常情况下服务端三条路（BAD_TOKEN / NO_SEAT / resumeState）都会立刻回，
 * 但万一它抛异常（回了条 `error`）或者连接半开，客户端就会一直挂在
 * "正在重新同步"，而这时 socket 是 OPEN 的 —— 点「立即重试」也会被
 * `connect()` 的 OPEN 判断吞掉。所以必须有超时自己重来。
 */
export const RESUME_ANSWER_TIMEOUT_MS = 8000;
/** 重连等待的递增序列（毫秒），用完后一直用最后一个 */
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000];

export class NetplayClient {
  private socket: WebSocket | null = null;
  private events: NetplayEvents;
  /** 服务器地址。可以在连接前改（用于内网穿透等场景） */
  url: string;
  /** 服务器分配的玩家 id */
  playerId = '';
  /** 当前所在房间（本地缓存，供界面读取） */
  room: RoomView | null = null;
  /**
   * ★ 0.0.3 末：最近一次 `lanScan` 的结果（局域网里能看到的房间）。
   * 界面只用它显示"房间里几个人"，真正的加入判断走 `findLanRoom()`。
   */
  lanRooms: LanRoomInfo[] = [];
  /**
   * ★★ 0.3.3：局域网房间列表的**多播订阅**。
   *
   * 【为什么不能再靠 `events.onLanRooms`？】
   * 那是一个单槽回调：`findLanRoom` 为了"等这一轮结果"会临时把它换掉再换回来。
   * 一旦加入房间页常驻订阅（每 2 秒刷一次），两边就会互相覆盖 ——
   * 表现是"列表偶尔不刷新"或"按房间号加入偶尔找不到"，而且不报错。
   */
  private lanRoomsListeners = new Set<(rooms: LanRoomInfo[]) => void>();
  /**
   * 最近一场战斗里，我属于哪一队（0 或 1）。
   *
   * 【为什么记在客户端里？】
   * 因为「我方」在不同地方都要判断：战斗日志的视角、伤害统计的统计范围、
   * 棋盘的左右翻转方向。如果每处各自去比对 playerId，
   * 迟早会出现「日志按 team0 算、统计按 team1 算」这种不一致。
   * 统一记一份，所有地方都读它。
   */
  myTeam: 0 | 1 = 0;
  /** 是否已连接 */
  connected = false;
  /**
   * ★ 0.1.3：握手时服务器报的版本（`welcome.serverVersion`）。
   * 空串 = 还没握手。和本机 `SERVER_VERSION` 不一致就不该联机
   * （界面用 `versionMismatch` 拦人，服务端那边也会拒绝 —— 双保险）。
   */
  serverVersion = '';
  /**
   * 服务器广播的牌库剩余张数（defId -> 还剩几张）。
   *
   * 【为什么放在这里？】
   * 联机时牌库是全房间共享的，只有服务器知道"还剩几张"。
   * 客户端拿它来：刷新商店时排除抽干的棋子、在卡片上标"没货了"。
   * 单机模式不用它（本地自己算就行，见 game/state.ts 的 poolRemaining）。
   */
  pool: Map<string, number> | null = null;
  /**
   * ★ 被别人"预定"在商店里的牌：defId -> 占着它的玩家 id 列表。
   *
   * 【它解决什么？】
   * 牌库里只剩 1 张的棋子如果同时挂在两个人的商店里，
   * 两个人里只有先点的那个买得到，另一个人点下去只会报错。
   * 服务器把"谁占着哪几张"广播过来，客户端算"对我还剩几张"时扣掉（见 setNetPoolView）。
   */
  held: Record<string, string[]> | null = null;
  /** 用户是否主动断开（主动断开后不再自动重连） */
  private stopped = false;
  /**
   * ★ 0.1.2：这条连接是被"顶号"关掉的（同一令牌在别处进入了游戏）。
   * 用来区分"该自动重连"和"绝对不要自动重连" —— 后者会两个标签页互踢成死循环。
   */
  private replacedByOther = false;
  /**
   * ★ 0.1.2：本标签页持有的断线重连令牌。
   * 有它就在连上之后先发 `resume`（比"重新 joinRoom"强得多：joinRoom 会新建一个
   * 白板座位，而且对局中直接被拒）。
   */
  private resumeToken = '';
  /**
   * ★ 0.1.4：**这一条连接**上已经发过 `resume` 了。
   *
   * 【为什么需要它？—— 一个把重连"用一次就废掉"的 bug】
   * 每条新连接建立时，服务端都会先发一条 `welcome`，里面带着**这条连接的临时身份**
   * 那枚令牌；而我们紧接着就用**手上那枚真令牌**去 resume。
   * 服务端 resume 成功之后会把临时身份作废（`forgetSession`）——
   * 也就是说那条 welcome 给的令牌**当场就死了**。
   *
   * 如果客户端老老实实按 welcome 的令牌覆盖手上的令牌，就会：
   *   第一次重连成功（用的是旧令牌）→ 手上被换成那枚已作废的临时令牌
   *   → 第二次重连带着它去换座位 → BAD_TOKEN → 再也回不去。
   * 症状正是用户报的"**有时候能回、有时候回不去（大概率回不去）**"。
   *
   * 所以：只要这条连接已经发过 resume，welcome 里的令牌就**不许**覆盖手上的那枚。
   * （服务端那边也补了一道：resume 成功后会再发一条带**正确令牌**的 welcome。）
   */
  private sentResumeThisConnection = false;
  private heartbeatTimer = 0;
  private reconnectTimer = 0;
  /** ★ 0.2.1：建连超时（CONNECTING 太久就作废这次尝试） */
  private connectTimer = 0;
  /** ★ 0.2.1：`resume` 回话超时 */
  private resumeTimer = 0;
  /** ★ 0.2.1：这条连接已经把 `resume` 发出去了、但还没收到回话 */
  private awaitingResume = false;
  private missedHeartbeats = 0;
  private reconnectAttempt = 0;
  /** 记住「上次想做什么」，重连后自动恢复 */
  private pendingAction:
    | { kind: 'create'; name: string; avatarId: string }
    | { kind: 'join'; code: string; name: string; avatarId: string }
    | null = null;

  constructor(url: string, events: NetplayEvents = {}) {
    this.url = url;
    this.events = events;
    // 刷新页面（F5）之后 sessionStorage 里的令牌还在，先读回来再连
    this.resumeToken = readStoredResume(url);
  }

  /** 换一个服务器地址。
   * 如果当前已经连着，会先断开（用户点了「改地址」之后要重新连接）。
   */
  setServerUrl(url: string): void {
    const cleaned = url.trim();
    if (cleaned.length === 0 || cleaned === this.url) return;
    const wasConnected = this.connected;
    if (wasConnected) this.disconnect();
    this.url = cleaned;
    // 换服务器了，旧令牌不属于这台服务器
    this.resumeToken = readStoredResume(cleaned);
    if (wasConnected) this.connect();
  }

  /**
   * ★★ 0.3.3：带着**指定令牌**连到某台服务器并换回座位（局域网房间列表里的「回到对局」）。
   *
   * 【和 `setServerUrl` + 自动 resume 有什么不同？】
   * `setServerUrl` 去 `machine-session` 里找令牌 —— 那是**单槽**的
   * （只记"本机现在在玩哪一局"）。而房间列表要支持"我今晚在三个人家里都开过局"，
   * 令牌来自多槽的 `resume-index`（见 `net/resume-index.ts`）。
   * 所以这里不给它走单槽，直接把令牌塞进去再连。
   *
   * ★ `pendingAction` 必须清空：那里面可能还留着"上次想加入的房间"，
   *   不清的话连上之后会先补发一次 `joinRoom`（新人进房），把 resume 顶掉。
   */
  resumeInto(url: string, token: string): boolean {
    const cleaned = url.trim();
    if (!cleaned || !token) return false;
    if (this.connected) this.disconnect();
    this.url = cleaned;
    this.resumeToken = token;
    this.pendingAction = null;
    this.connect();
    return true;
  }

  get myName(): string {
    return this.pendingAction?.name ?? '玩家';
  }

  /** 连上服务器 */
  connect(): void {
    this.stopped = false;
    this.replacedByOther = false;
    this.sentResumeThisConnection = false;
    // ★ 0.2.1：新连接还没发 resume，别让上一轮的"等回话"哨兵误伤
    this.awaitingResume = false;
    window.clearTimeout(this.resumeTimer);
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url);
    } catch (error) {
      this.events.onError?.('CONNECT_FAILED', `无法连接服务器：${(error as Error).message}`);
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    /*
      ★★ 0.2.1：**建连超时**
      见 CONNECT_TIMEOUT_MS 的说明：地址黑洞时 readyState 会长时间停在 CONNECTING，
      而 `connect()` 对 CONNECTING 是早退的 ⇒ 所有重试都空转。
      这里给它一个上限，到点就作废这条、另起一条。
    */
    window.clearTimeout(this.connectTimer);
    this.connectTimer = window.setTimeout(() => {
      if (this.socket !== socket || socket.readyState !== WebSocket.CONNECTING) return;
      this.abandonSocket(socket, '连接服务器超时');
    }, CONNECT_TIMEOUT_MS);

    socket.addEventListener('open', () => {
      /*
        ★★ 0.2.1：**这条连接还是当前那条吗？**
        `abandonSocket()` / `retryResume()` 都会换掉 `this.socket`。
        老连接如果之后才 open，它的回调绝不能再去改新连接的状态。
      */
      if (this.socket !== socket) return;
      window.clearTimeout(this.connectTimer);
      this.connected = true;
      this.reconnectAttempt = 0;
      this.missedHeartbeats = 0;
      this.events.onConnected?.();
      this.startHeartbeat();
      /*
        ★ 0.1.2：重连之后**优先用令牌换回座位**，而不是重发 joinRoom。

        【为什么不能继续用"重发上次的请求"？】
        `pendingAction` 里记的是 `{joinRoom, 房间码}` —— 那等于"新人进房"：
          · 服务端会先 `leaveCurrentRoom`（自己把自己先踢一遍）；
          · 对局中 `phase !== 'lobby'` 直接被拒；
          · 就算进去了也是 hp:100 / 战绩零的白板。
        `resume` 走的是完全另一条路：复用原 playerId 与座位（见服务端的 resume 分支）。
        所以有令牌时只发 resume；令牌被拒绝（resumeFailed）时上层会自己决定怎么办。
      */
      if (this.resumeToken) {
        this.sentResumeThisConnection = true;
        this.awaitingResume = true;
        this.send({ t: 'resume', token: this.resumeToken });
        // ★★ 0.2.1：resume 发出去之后必须有人盯着（见 RESUME_ANSWER_TIMEOUT_MS）
        this.watchResumeAnswer(socket);
        return;
      }
      // 没有令牌 = 这是"新建/新加入"这条路，照旧重发上次想做的事（建房/进房）
      if (this.pendingAction) {
        if (this.pendingAction.kind === 'create') {
          this.send({
            t: 'createRoom',
            playerName: this.pendingAction.name,
            avatarId: this.pendingAction.avatarId,
            version: SERVER_VERSION,
          });
        } else {
          this.send({
            t: 'joinRoom',
            roomCode: this.pendingAction.code,
            playerName: this.pendingAction.name,
            avatarId: this.pendingAction.avatarId,
            version: SERVER_VERSION,
          });
        }
      }
    });

    socket.addEventListener('message', (event) => {
      // ★★ 0.2.1：老连接迟到的消息一律丢弃（别让旧身份的数据写进新会话）
      if (this.socket !== socket) return;
      const message = decodeMessage<ServerMessage>(String(event.data));
      if (!message) return;
      this.handleMessage(message);
    });

    socket.addEventListener('close', () => {
      /*
        ★★ 0.2.1：**旧连接的 close 不许动新连接**（这是"重连卡死"的三大来源之一）。
        `abandonSocket()` 先把 `this.socket` 换成 null、随后 connect() 建了新连接；
        旧连接要等传输层给说法才 close，可能几秒到几分钟之后才来 ——
        它要是照旧往下跑，就会把新连接的 connected 打成 false、room 清空、
        心跳停掉，界面从此永远停在"正在重连"，而且再也不会重试。
      */
      if (this.socket !== socket) return;
      window.clearTimeout(this.connectTimer);
      this.connected = false;
      this.stopHeartbeat();
      this.room = null;
      if (this.replacedByOther) {
        /*
          ★ 顶号：**绝不自动重连**。
          这一条连接的身份已经被别处接管了，再连回来会立刻把对方顶掉 ——
          两个标签页就会无限互踢（谁也别想玩）。
          所以走"主动断开"那条路（stopped = true），只是把原因说清楚。
        */
        this.stopped = true;
        return;
      }
      this.events.onDisconnected?.(this.stopped ? '已主动断开' : '连接断开');
      if (!this.stopped) this.scheduleReconnect();
    });

    socket.addEventListener('error', () => {
      if (this.socket !== socket) return;
      // WebSocket 的 error 事件不提供细节，真正的信息在随后的 close 里
      this.events.onError?.('SOCKET_ERROR', '网络出错');
    });
  }

  /**
   * ★★ 0.2.1：**作废一条连接**（不等它的 close 事件）。
   *
   * ============================================================
   *  【为什么需要它？什么时候它的 close 不会来？】
   * ============================================================
   * 浏览器只在"传输层给了说法"之后才 fire close。遇到
   *   · 休眠唤醒 / 换网 / NAT 表项过期（对端再也收不到我们的包），
   *   · 或者建连阶段就撞上地址黑洞，
   * close 可能要等**几十秒到几分钟**。这期间如果只是干等 close 去触发重连，
   * 玩家看到的就是"提示了正在重连，但什么都没发生"。
   *
   * 所以：先**摘掉自己的引用**（老连接的任何事件从此进不来），
   * 再 close（能干净关掉最好，关不掉也无所谓），然后立刻排下一次重连。
   */
  private abandonSocket(socket: WebSocket, reason: string): void {
    if (this.socket !== socket) return;
    this.socket = null;
    window.clearTimeout(this.connectTimer);
    window.clearTimeout(this.resumeTimer);
    this.awaitingResume = false;
    try {
      socket.close();
    } catch {
      // 关不掉就算了：引用已经摘了，它不再是"当前连接"
    }
    this.connected = false;
    this.stopHeartbeat();
    this.room = null;
    this.events.onDisconnected?.(reason);
    this.scheduleReconnect();
  }

  /**
   * ★★ 0.2.1：盯着 `resume` 的回话。
   *
   * 服务端三条路都会立刻回（BAD_TOKEN / NO_SEAT / resumeState），
   * 但**万一**它抛异常（只回一条 `error`）或者连接半开，客户端就会一直挂在
   * "正在重新同步"。而这个状态下 socket 是 OPEN 的 —— 连"立即重试"都会被
   * `connect()` 的 OPEN 判断吞掉。所以超时自己作废、自己重来。
   */
  private watchResumeAnswer(socket: WebSocket): void {
    window.clearTimeout(this.resumeTimer);
    this.resumeTimer = window.setTimeout(() => {
      if (this.socket !== socket || !this.awaitingResume) return;
      this.events.onError?.('RESUME_TIMEOUT', '重连请求没有回应，正在重试…');
      this.abandonSocket(socket, '重连没有得到服务器回应');
    }, RESUME_ANSWER_TIMEOUT_MS);
  }

  /** 主动断开（用户点「退出联机」时用） */
  disconnect(): void {
    this.stopped = true;
    this.pendingAction = null;
    this.stopHeartbeat();
    window.clearTimeout(this.reconnectTimer);
    // ★ 0.2.1：这两个新加的计时器也要停（否则它们会对一条已经不存在的连接动手）
    window.clearTimeout(this.connectTimer);
    window.clearTimeout(this.resumeTimer);
    this.awaitingResume = false;
    const socket = this.socket;
    // ★ 0.2.1：先摘引用再 close —— 这条连接迟到的 close 不能再来改状态
    this.socket = null;
    if (socket) {
      try {
        socket.close();
      } catch {
        // 忽略
      }
    }
    this.connected = false;
    this.room = null;
    /*
      ★ 保持老行为：主动断开也**报一次**（界面据此把状态改成"已主动断开"）。
      注意这时候 `stopped` 已经是 true，所以文案是对的。
    */
    this.events.onDisconnected?.('已主动断开');
  }

  /**
   * ★ 0.1.2：彻底忘掉这枚重连令牌（**连本机那份一起清**）。
   *
   * 【什么时候能清？】**只有玩家真的离开这一局**（点返回/被踢/令牌失效）才能清。
   * 一次普通的网络抖动**绝对不能**清 —— 那正是要靠它回到座位的东西。
   * 被顶号（`replaced`）时也**不能**走这里 —— 那份会话已经被别的标签页接手了。
   */
  clearResumeToken(): void {
    this.resumeToken = '';
    clearMachineSession();
  }

  /**
   * ★ 0.1.2：把"本机对局会话"和当前房间对齐（界面层在房间变化时调）。
   *
   * 进房 → 存下 `{服务器地址, 令牌, 房间号}` 并**认领占用**；
   * 退房 → 清掉（`clearMachineSession` 自带"已被别人接管就不删"的保护）。
   */
  syncMachineSession(roomCode: string | null): void {
    if (!this.resumeToken) return;
    if (roomCode) {
      saveMachineSession({ serverUrl: this.url, token: this.resumeToken, roomCode });
      /*
        ★ 0.3.3：同时记进"我在这局有座位"的小表（按 地址+房间号，最多 5 条）。
        `saveMachineSession` 是**单槽**的（表达"本机现在在玩哪一局"），
        换台服务器玩就会覆盖 —— 而房间列表要认出"这间局里有我"，需要多条。
        两件事分开存，谁也不影响谁。
      */
      rememberResumeTarget({ url: this.url, code: roomCode, token: this.resumeToken });
    } else {
      clearMachineSession();
    }
  }

  /**
   * ★ 0.1.2：把"本机会话"里那枚令牌装进来。
   *
   * 【为什么需要单独一步？】
   * 构造函数跑的时候 `initMachineSession()` 还没回来（它是异步的 HTTP 请求），
   * 那时读不到机器级的令牌。所以启动流程是：先 await 会话加载，再调本方法，最后才连。
   * 幂等 —— 已经有令牌就不动。
   */
  loadMachineToken(): void {
    if (this.resumeToken) return;
    const token = readStoredResume(this.url);
    if (token) this.resumeToken = token;
  }

  /**
   * ★ 0.1.2：现在就试一次重连（网络恢复了 / 玩家手动点「立即重试」）。
   *
   * ★★ 0.2.1：**必须是"真的重来一次"**，不能简单调 `connect()`。
   *
   * 【为什么？】
   * 出问题的那种情形恰好是"socket 开着、但身份没换回来"：
   * `resume` 发出去服务器没回应（异常 / 半开连接），界面上正是重同步浮层，
   * 玩家点「立即重试」→ 以前 `connect()` 一看 readyState 是 OPEN **直接早退**
   * ⇒ 按钮点一百次也没有任何反应。所以这里先把当前连接作废（摘引用 + close），
   * 再建新连接 —— 新连接 open 时会重新发 resume。
   */
  retryResume(): void {
    if (!this.resumeToken) {
      // 手上没令牌就没有"重连"这回事 —— 别装作在重试，说一句实话
      this.events.onError?.('NO_RESUME_TOKEN', '手上没有重连令牌，只能重新加入房间');
      return;
    }
    window.clearTimeout(this.reconnectTimer);
    window.clearTimeout(this.connectTimer);
    window.clearTimeout(this.resumeTimer);
    this.awaitingResume = false;
    this.reconnectAttempt = 0;
    const socket = this.socket;
    this.socket = null; // 先摘引用：老连接迟到的 close/error 一律进不来
    if (socket) {
      try {
        socket.close();
      } catch {
        // 忽略
      }
    }
    this.connected = false;
    this.stopHeartbeat();
    this.connect();
  }

  /** 本标签页是不是持有重连令牌（界面据此决定"断线"时是回主界面还是等重连） */
  get canResume(): boolean {
    return this.resumeToken.length > 0;
  }

  /**
   * ★ 0.1.3：本机和服务器版本不一致吗。
   *
   * 【为什么两边都要拦？】
   * 这里拦是为了**早点说清楚**（连上就提示，不用等点了"加入"才被拒）；
   * 服务端那道是为了**防老客户端绕过**。版本不同的后果不是"少个功能"，
   * 而是同一个局面算出不同结果 —— 联机里表现为"莫名其妙打输/打赢"。
   */
  get versionMismatch(): boolean {
    return this.serverVersion !== '' && this.serverVersion !== SERVER_VERSION;
  }

  /**
   * ★ 0.0.3 末：问一句"局域网里有哪些房间"。
   *
   * 【为什么是问服务器，而不是浏览器自己去扫？】
   * 因为**浏览器发不了 UDP 广播**。扫描的活由每台机器自己的游戏服务器干
   * （见 packages/server/src/lan.ts），浏览器只是通过已有的 WebSocket 问一声。
   */
  lanScan(): boolean {
    return this.send({ t: 'lanScan' });
  }

  /**
   * ★★ 0.3.3：订阅"局域网房间列表变了"（返回退订函数）。
   *
   * 【为什么要有它？】
   * 加入房间页要**常驻**跟着列表刷新，而 `findLanRoom` 也要等同一份数据。
   * 用多播订阅，两边互不干扰；用单槽回调，后注册的会把先注册的挤掉（不报错，只是不刷新）。
   */
  onLanRoomsChange(listener: (rooms: LanRoomInfo[]) => void): () => void {
    this.lanRoomsListeners.add(listener);
    return () => this.lanRoomsListeners.delete(listener);
  }

  /**
   * ★ 0.0.3 末：**用房间号找到"该连哪台机器"**（便携包联机的核心一步）。
   *
   * 【为什么要重试几次？】
   * 主机是每 1.5 秒广播一次；虽然"刚建好房"会立刻广播一次，
   * 但广播到朋友这台机器、再进到邻居表，可能刚好错开一点点。
   * 所以这里在超时窗口内**扫两三次**，比"问一次没有就报错"稳得多。
   *
   * @returns 找到的房间（含 `address`）；没找到返回 null
   */
  async findLanRoom(code: string, timeoutMs = 2600): Promise<LanRoomInfo | null> {
    const wanted = code.trim().toUpperCase();
    if (!this.connected) return null;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      /*
        ★ 0.3.3：先看**手上已有的**结果。
        加入房间页在打开时会每 2 秒扫一次，所以大部分时候列表里已经躺着答案 ——
        没必要再等一轮 450 毫秒（玩家点"加入"到进房间能快掉小半秒）。
      */
      const known = this.lanRooms.find((room) => room.code === wanted);
      if (known) return known;
      this.lanScan();
      // 等这一轮的结果回来（服务器是同步回的，等一小会儿就够）
      const found = await new Promise<LanRoomInfo | null>((resolve) => {
        let timer = 0;
        const unsubscribe = this.onLanRoomsChange((rooms) => {
          const hit = rooms.find((room) => room.code === wanted);
          if (!hit) return;
          unsubscribe();
          window.clearTimeout(timer);
          resolve(hit);
        });
        timer = window.setTimeout(() => {
          unsubscribe();
          resolve(this.lanRooms.find((room) => room.code === wanted) ?? null);
        }, 450);
      });
      if (found) return found;
      if (Date.now() >= deadline) return null;
    }
  }

  private handleMessage(message: ServerMessage): void {
    switch (message.t) {
      case 'welcome':
        this.playerId = message.playerId;
        // ★ 0.1.3：记下服务器版本，界面据此拦"版本不一致"（见 versionMismatch）
        this.serverVersion = message.serverVersion ?? '';
        /*
          ★ 0.1.2：把令牌收下来（只放在内存里）。
          真正的"存起来"要等**进房**那一刻（`syncMachineSession`）——
          连上服务器只代表拿到了令牌，还没开始玩，不该占着"本机对局中"这个位置。
          注意这条 welcome 之后还可能来一条 `resumeState` —— 那才是"换回原身份"，
          届时 playerId 会被改成**原来那个**（见下面对 resumeState 的处理）。

          ★★ 0.1.4：但**正在 resume 的时候不许覆盖**（见 sentResumeThisConnection 的说明）——
          这条 welcome 带的是"新连接的临时身份"那枚令牌，我们一旦换回原座位，
          它就会被服务端作废；用它顶掉手上那枚真令牌 = 下一次重连必定失败。
        */
        if (message.resumeToken && !this.sentResumeThisConnection) {
          this.resumeToken = message.resumeToken;
        }
        this.events.onWelcome?.({
          lanAddresses: message.lanAddresses ?? [],
          playerId: message.playerId,
          serverVersion: message.serverVersion,
          resumeToken: message.resumeToken,
        });
        break;
      case 'resumeState':
        /*
          ★ 0.1.2：重连成功 —— 身份换回**原来那个 playerId**。
          这一步是整件事的关键：客户端的商店种子是
          `hash('airnight-shop|房间码|playerId')`，playerId 一样，
          商店随机序列才不会整批重来。
        */
        // ★ 0.2.1：回话到了，撤掉"等回话"的哨兵
        window.clearTimeout(this.resumeTimer);
        this.awaitingResume = false;
        this.playerId = message.playerId;
        this.room = message.room;
        /*
          ★ 令牌是"本人"的，重连时服务器不会再发 welcome，也就不会再发一次令牌。
          刷新页面场景下 sessionStorage 里本来就还有，这里不用再写。
        */
        this.pendingAction = null;
        this.events.onResumeState?.(message);
        break;
      case 'resumeFailed': {
        /*
          令牌失效 / 座位已经被清掉了 —— 这局回不去了，把令牌丢掉免得一直重试。

          ★★ 0.1.4：**先把"我原来在哪一局"取出来，再清令牌。**
          这一步的顺序很关键：`clearResumeToken()` 会把**本机会话一起清掉**
          （`clearMachineSession`），清完之后房间号就再也查不到了 ——
          而界面正需要它把失败交代清楚。以前正是"先清后报"，于是 UI 只能
          说一句干巴巴的"重连失败"，玩家根本不知道是哪一局没了。
          两个来源都试一下：内存里的房间视图（网络抖动场景），
          或者本机会话文件（关掉浏览器重开、本地状态全新的场景）。
        */
        const roomCode = this.room?.code ?? getMachineSession()?.roomCode ?? '';
        // ★ 0.2.1：这条路已经有结论了，撤掉"等回话"的哨兵
        window.clearTimeout(this.resumeTimer);
        this.awaitingResume = false;
        /*
          ★ 0.3.3：多槽索引里那条也要删。
          不删的话，局域网列表会**永远**给那间房显示「回到对局」（看起来很诱人），
          点下去又是一次 `BAD_TOKEN` —— 玩家会以为功能坏了。
        */
        if (roomCode) forgetResumeTarget(this.url, roomCode);
        this.clearResumeToken();
        this.events.onResumeFailed?.(message.code, message.message, roomCode);
        break;
      }
      case 'replaced':
        /*
          ★ 0.1.2：被顶号 —— 只丢掉**内存里**那枚令牌。
          ★ 绝不能连本机会话一起清：那份已经被顶我的那个标签页接手了，
            删掉等于把对方也踢下线（然后两边互相踢，谁也玩不了）。
        */
        this.replacedByOther = true;
        this.resumeToken = '';
        this.events.onReplaced?.(message.reason);
        break;
      case 'lanRooms':
        this.lanRooms = message.rooms;
        this.events.onLanRooms?.(message.rooms);
        // ★ 0.3.3：多播（房间列表 + 按房间号查找，互不覆盖）
        for (const listener of [...this.lanRoomsListeners]) {
          try {
            listener(message.rooms);
          } catch {
            /* 单个订阅者出错不该影响别人 */
          }
        }
        break;
      case 'room':
        this.room = message.room;
        this.events.onRoom?.(message.room);
        break;
      case 'error':
        this.events.onError?.(message.code, message.message);
        break;
      case 'gameStarted':
        this.events.onGameStarted?.(
          message.roomCode,
          message.round,
          message.phase,
          message.shopSecondsLeft,
        );
        break;
      case 'prepTick':
        this.events.onPrepTick?.(message.secondsLeft);
        break;
      case 'shopTick':
        this.events.onShopTick?.(message.secondsLeft);
        break;
      case 'shopEnded':
        this.events.onShopEnded?.();
        break;
      case 'covenantTick':
        this.events.onCovenantTick?.(message.secondsLeft);
        break;
      case 'pauseTick':
        this.events.onPauseTick?.({
          secondsLeft: message.secondsLeft,
          voteCount: message.voteCount,
          voteNeeded: message.voteNeeded,
        });
        break;
      case 'battleStart':
        this.events.onBattleStart?.(message);
        break;
      case 'battleEnd':
        this.events.onBattleEnd?.(message);
        break;
      case 'playerEliminated':
        this.events.onPlayerEliminated?.(message.playerId);
        break;
      case 'kicked':
        this.events.onKicked?.(message.reason);
        break;
      case 'gameOver':
        this.events.onGameOver?.(message);
        break;
      case 'pool':
        this.pool = new Map(Object.entries(message.remaining));
        this.held = message.held ?? null;
        this.events.onPool?.(message.remaining, this.held);
        break;
      case 'buyResult':
        this.events.onBuyResult?.(message);
        break;
      case 'recruitResult':
        this.events.onRecruitResult?.(message);
        break;
      case 'prepTeams':
        this.events.onPrepTeams?.(message.teams);
        break;
      case 'phaseState':
        /*
          ★★ 0.3.2：`requestSync` 的答复 —— 当前阶段与回合的权威口径。
          ★ 它**不是** `gameStarted`：客户端收到后只对齐 round/phase/倒计时，
            绝不做回合结算（否则补一次同步就白送一次收入）。
        */
        this.events.onPhaseState?.(message);
        break;
      case 'pong':
        this.missedHeartbeats = 0;
        break;
    }
  }

  /** 发消息。没连上就返回 false，让调用方知道要提示用户 */
  send(message: ClientMessage): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    this.socket.send(encodeMessage(message));
    return true;
  }

  // ---------------- 语义化的操作接口 ----------------

  createRoom(playerName: string, avatarId = ''): boolean {
    this.pendingAction = { kind: 'create', name: playerName, avatarId };
    // ★ 0.1.3：自报版本 —— 服务端版本不一致会直接拒绝（见服务端 ensureSameVersion）
    return this.send({ t: 'createRoom', playerName, avatarId, version: SERVER_VERSION });
  }

  joinRoom(roomCode: string, playerName: string, avatarId = ''): boolean {
    const code = roomCode.trim().toUpperCase();
    this.pendingAction = { kind: 'join', code, name: playerName, avatarId };
    return this.send({ t: 'joinRoom', roomCode: code, playerName, avatarId, version: SERVER_VERSION });
  }

  leaveRoom(): void {
    this.pendingAction = null;
    this.send({ t: 'leaveRoom' });
  }

  setReady(ready: boolean): boolean {
    return this.send({ t: 'setReady', ready });
  }

  startGame(): boolean {
    return this.send({ t: 'startGame' });
  }

  /**
   * ★★ 0.3.5：打完一局之后「再来一局 · 返回房间」。
   *
   * 只是把请求发出去 —— 真正的复位（血量 / 战绩 / 准备状态 / 牌库）在服务端，
   * 复位完它会广播房间状态，所有人一起回大厅（见 `Room.backToLobby`）。
   */
  backToLobby(): boolean {
    return this.send({ t: 'backToLobby' });
  }

  /** ★ 0.1.1：房主把某个玩家请出房间（服务端会再验一次房主身份） */
  /**
   * ★ 0.1.3：房主请人出房间，可以附一句话（**原样显示给被踢的人**）。
   * 不写留言就由服务端回退到默认文案「房主把你移出了房间」。
   */
  kickPlayer(playerId: string, message = ''): boolean {
    return this.send({ t: 'kickPlayer', playerId, message });
  }

  /** ★ 0.1.1：房主改某个玩家的昵称（服务端会再验一次身份并清洗名字） */
  renamePlayer(playerId: string, name: string): boolean {
    return this.send({ t: 'renamePlayer', playerId, name });
  }

  /**
   * ★ 0.3：房主改房间设置（只发"改了哪几项"）。
   *
   * ★ 服务端会自己判"是不是房主、是不是 lobby 阶段"，并夹一遍范围 ——
   * 这里不做任何本地拦截（本地拦只是"别发无效包"，不是权限）。
   */
  updateSettings(settings: Partial<RoomSettings>): boolean {
    return this.send({ t: 'updateSettings', settings });
  }

  /**
   * ★ 0.3：藏品回复生命（消耗型藏品用）。
   * 联机血量由服务端裁决，客户端只能"报个被加的量"，不能再自己改本地数值了事。
   */
  healPlayer(amount: number): boolean {
    return this.send({ t: 'healPlayer', amount });
  }

  /**
   * ★★ 0.3：盟约选秀里选一个。
   * 服务端会自己判"是不是轮到你 / 有没有被选走"，这里不做本地拦截。
   */
  pickCovenant(covenantId: string): boolean {
    return this.send({ t: 'pickCovenant', covenantId });
  }

  /**
   * 把本回合阵容同步给服务器。
   *
   * ★ 0.0.3：参数改成 `SubmittedTeam`（= `toTeamSetup(state)` 的产物）。
   *
   * 【为什么不再自己手写 `{defId, star, cell}`？】
   * 以前这里是一份**手抄的字段列表**，加藏品时忘了跟着加 `items`，
   * 于是联机里 A 类藏品的效果全丢（而且静默 —— 界面照样显示"已装备"）。
   * 现在调用方直接传 `toTeamSetup(state)`，以后再加字段也漏不了。
   */
  submitTeam(team: SubmittedTeam): boolean {
    return this.send({ t: 'submitTeam', ...team });
  }

  /**
   * 申请买一张牌。
   *
   * 【为什么联机时不直接买？】
   * 因为牌库全房间共享，得先问服务器"还有没有货"。
   * 服务器回 buyResult 之后，客户端才真正把棋子放进备战席。
   * 见 protocol.ts 里 buyCard 的说明。
   */
  buyCard(defId: string, count = 1): boolean {
    return this.send({ t: 'buyCard', defId, count });
  }

  /**
   * 卖掉棋子时把牌还给牌库。
   *
   * `copies` = 该还几张（由 `poolCopiesOfUnit` 算出来，界面别自己按星级算）：
   * 普通棋子是 3/9 张，被博士投影升过星的那只只还 1 张，复制出来的还 0 张（那就别发这条消息）。
   * 不传时服务端按星级算（兼容旧客户端）。
   */
  sellCard(defId: string, star: number, copies?: number): boolean {
    return this.send({ t: 'sellCard', defId, star, ...(copies === undefined ? {} : { copies }) });
  }

  /**
   * ★★ 0.3.3：房主往房间里加一台人机。
   *
   * 【为什么客户端只是"发个申请"？】
   * "加不加得下"（座位满 / 人机名额 / 是不是大厅阶段）全部由服务端裁决 ——
   * 客户端藏按钮不是权限。人机建好之后会跟着 `room` 广播回到所有人界面上。
   */
  addBot(difficulty: BotDifficulty): boolean {
    return this.send({ t: 'addBot', difficulty });
  }

  /** ★★ 0.3.3：房主移走一台人机（只认 bot 开头的 id，真人有 `kickPlayer`） */
  removeBot(playerId: string): boolean {
    return this.send({ t: 'removeBot', playerId });
  }

  /** ★★ 0.3.3：房主改一台人机的难度（只在大厅阶段有效） */
  setBotDifficulty(playerId: string, difficulty: BotDifficulty): boolean {
    return this.send({ t: 'setBotDifficulty', playerId, difficulty });
  }

  /**
   * ★ 0.1.1：申请一次"藏品随机招募"（人事部铜印 / 博士银印）。
   *
   * 招募到的人会**真的从共享牌库里扣掉**，所以这一步必须服务器裁决
   * （和买牌同一套理由）。结果走 `onRecruitResult` 回来再进备战席。
   */
  recruitFromPool(minCost: number, maxCost: number, seed: number): boolean {
    return this.send({ t: 'recruitFromPool', minCost, maxCost, seed });
  }

  /**
   * ★ 报告"我商店里现在摆着哪些牌"（每次刷新 / 买走之后发一次）。
   *
   * 【为什么要发？】
   * 牌库里只剩 1 张的棋子如果同时挂在两个人的商店里，
   * 就只有先点的那个买得到，另一个人点下去只会报错。
   * 报上去之后服务器会把这几张标成"被我占着"，别人刷新时就不会再抽到。
   * 我刷新（或买走）之后会再发一次，牌就放回池子了。
   */
  shopUpdate(defIds: string[]): boolean {
    return this.send({ t: 'shopUpdate', defIds });
  }

  /** 上报校验和不一致（这是抓确定性 bug 的关键手段） */
  reportChecksumMismatch(battleId: string, expected: number, actual: number): void {
    this.send({ t: 'checksumMismatch', battleId, expected, actual });
  }

  /**
   * 上报自己的**展示数据**：等级 / 当前连胜连败（0.0.2 需求第 11 条）。
   *
   * 【为什么由客户端上报，而不是服务器自己算？】
   * 因为等级和连胜属于"经济系统"，而经济目前跑在客户端
   * （买经验、每回合结算都在本地）。服务器手里没有这本账，
   * 所以这条消息只是"告诉别人我长什么样"，纯展示，
   * 不参与任何胜负判定 —— 就算有人改了它，也只影响自己的玩家列表。
   * 服务器会做范围钳制（见 Room.setPlayerStats）。
   */
  reportPlayerStats(level: number, streak: number): boolean {
    return this.send({ t: 'playerStats', level, streak });
  }

  /**
   * ★★ 0.3.2：**主动要一份权威快照**（`requestSync`）。
   *
   * 触发时机（在 main.ts 里）：
   *   · `room.rev` 跳号 = 我漏收了广播（网络抖动 / 标签页被冻住）；
   *   · 从后台切回前台、或者刚从短暂断网里恢复。
   *
   * 服务器回 `phaseState` + `room` + `pool` + `prepTeams` 四条幂等消息，
   * 客户端据此对齐 stage/round，**不会**重跑回合结算。
   */
  requestSync(): boolean {
    return this.send({ t: 'requestSync' });
  }

  /**
   * ★ 告诉服务器「这场战斗的演出我播完了」。
   *
   * 【为什么要发这个？】
   * 服务器不能靠"战斗打了多少秒"来猜客户端播完了没有 ——
   * 客户端的回放受帧率影响（帧率低于 20fps 时回放比墙钟慢），
   * 切到别的窗口时浏览器还会把动画降频甚至暂停。
   * 猜早了就会出现"我这边还在打，画面被拉回布阵"（战斗看起来被跳过）。
   *
   * 让客户端在**真的播完那一刻**举手，服务器收齐大家的举手才进下一回合。
   * 详见 protocol.ts 里 `playbackDone` 的说明。
   */
  playbackDone(battleId: string): boolean {
    return this.send({ t: 'playbackDone', battleId });
  }

  /**
   * ★ 0.1.4：投票「取消暂停」（暂停浮层上唯一那颗按钮）。
   *
   * 【规则】在线的人**全部**点过 -> 暂停立刻结束，掉线那位当场淘汰。
   * 掉线的人投不了票，所以"全部"只算在线的人 —— 服务端也是这么算的
   * （见 pauseVoteInfo / votePause）。
   */
  pauseVote(): boolean {
    return this.send({ t: 'pauseVote' });
  }

  // ---------------- 连接维护 ----------------

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      this.missedHeartbeats++;
      if (this.missedHeartbeats > MAX_MISSED_HEARTBEATS) {
        /*
          ★★ 0.2.1：连续多次没回应 —— 连接实际上已经死了，**主动作废并重连**。
          以前这里只 `socket.close()` 就完了，把"重排重连"留给 close 事件；
          而半死连接（休眠唤醒 / NAT 表项过期）根本收不到 FIN，
          close 事件可能几分钟都不来 ⇒ 提示里写着"正在重连"，实际一次都没重连过。
        */
        this.events.onError?.('HEARTBEAT_TIMEOUT', '与服务器失去联系，正在重连…');
        const socket = this.socket;
        if (socket) this.abandonSocket(socket, '与服务器失去联系');
        else this.scheduleReconnect();
        return;
      }
      this.send({ t: 'ping' });
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = 0;
    }
    this.missedHeartbeats = 0;
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const delay = RECONNECT_DELAYS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS.length - 1)]!;
    this.reconnectAttempt++;
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
  }
}

/**
 * ============================================================
 *  ★ 联机对局里，给"本机自己的那串随机数"用的种子
 * ============================================================
 *
 * 【为什么不能直接用 createGameState() 的默认种子？—— 这是个真 bug】
 * `createGameState()` 不传种子时用 `freshSeed()`，而它是
 * `Date.now() ^ 一个从 0 开始的自增计数`。
 * 服务器广播 `gameStarted` 时是在**同一个循环里**挨个 socket 发的，
 * 所以几台客户端（尤其是同一台电脑开的多个标签页）会在
 * **同一毫秒**收到这条消息，而每个标签页的自增计数都刚好是 1 ——
 * 于是大家推出了**完全一样的种子**，商店连着好几回合刷出
 * **一模一样**的牌（用户报的"2 号和 3 号刷新池完全一样"）。
 *
 * 所以种子必须**因人而异**、而且**不依赖时间**：
 * 用「房间码 + 服务器分配的玩家 id」拼一个字符串再哈希。
 * playerId 里本来就带着连接时刻（`p3-mv16svlm` 那种），天然不会重复。
 *
 * 它只影响**本机自己的**商店/经济随机序列 ——
 * 服务器不校验商店内容（只管买的时候扣牌），所以各人不同不会不同步。
 */
export function playerShopSeed(roomCode: string, playerId: string): number {
  return seedFromString(`airnight-shop|${roomCode}|${playerId}`);
}

/**
 * 推断默认的服务器地址。
 *
 * 【优先级：网址参数 > 上次手动填的 > 当前页面主机】
 *
 * 为什么需要「手动指定」这一层？
 * 因为用内网穿透（比如 SakuraFRP）时，游戏服务器跑在你家里，
 * 但穿透服务给你的是另一个域名和端口，跟网页地址不是同一个主机。
 * 这时候就必须能手动告诉客户端「服务器在哪」。
 * 用 `?server=` 参数的好处是：你只要把带参数的链接发给朋友，
 * 他们点开就自动连对了，不用自己填。
 */
export function defaultServerUrl(): string {
  // 1) 网址参数优先，例如 http://xxx/?server=frp.example.com:23456
  const fromQuery = new URLSearchParams(location.search).get('server');
  if (fromQuery && fromQuery.trim().length > 0) {
    return normalizeServerInput(fromQuery);
  }

  // 2) 上次手动填过就记住（换房间不用重填）
  try {
    const saved = localStorage.getItem('airnight.server');
    if (saved && saved.trim().length > 0) return saved.trim();
  } catch {
    // 隐私模式下 localStorage 可能不可用，忽略即可
  }

  // 3) 兜底：和网页同一个主机，默认端口 8787
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.hostname}:8787`;
}

/** 记住用户手动填的服务器地址 */
export function rememberServerUrl(url: string): void {
  try {
    localStorage.setItem('airnight.server', url.trim());
  } catch {
    // 忽略
  }
}

/** 把「主机名:端口」这样的输入补全成完整的 ws:// 地址 */
export function normalizeServerInput(input: string): string {
  const cleaned = input.trim();
  if (cleaned.length === 0) return '';
  if (cleaned.startsWith('ws://') || cleaned.startsWith('wss://')) return cleaned;
  /*
    ★ 没写协议时要看**网页自己是不是 HTTPS**。
    浏览器有一条硬规定：**HTTPS 页面不许连 ws://**（混合内容，直接拦掉，
    控制台报 Mixed Content）。所以如果朋友是通过免费托管（Cloudflare Pages
    之类，都是 HTTPS）打开网页的，我们补 `ws://` 就等于**注定连不上**。

    补 `wss://` 至少有机会能通（前提是穿透隧道支持 TLS，比如 SakuraFRP 的
    HTTPS 隧道）。而且退一步说：`ws://` 在这里是 100% 被拦，
    `wss://` 是"可能通"，没有任何理由选前者。

    页面是 HTTP（局域网 / 本地）时仍然补 `ws://` —— 那是绝大多数情况，
    而且不需要证书。
  */
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${cleaned}`;
}

/**
 * 这个地址在当前页面上**有没有可能连上**？
 *
 * 【为什么需要这个检查？】
 * 因为"HTTPS 页面 + ws://"是浏览器**直接拦掉**的，连 TCP 都不会发出去，
 * 失败原因跟"服务器没开"长得一模一样（都是"连不上，正在重连…"）。
 * 与其让你去查服务器、查防火墙，不如当场把真正的原因说出来。
 *
 * @returns 有问题时返回一句给人看的中文说明，没问题返回 null
 */
export function serverUrlProblem(url: string): string | null {
  if (location.protocol !== 'https:') return null;
  if (url.startsWith('wss://')) return null;
  if (!url.startsWith('ws://')) return null;
  return (
    '当前网页是 HTTPS（免费托管基本都是），而游戏服务器地址是 ws:// —— ' +
    '浏览器会直接拦掉这种"混合内容"，连都连不上。' +
    '解决办法：给游戏服务器换成支持 TLS 的隧道（SakuraFRP 的 HTTPS 隧道），' +
    '地址写成 wss://你的域名（或者只填域名，我们会自动补 wss://）。'
  );
}

export { SERVER_VERSION, MAX_PLAYERS_PER_ROOM };
