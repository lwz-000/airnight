/**
 * ============================================================
 *  人机（Bot）—— 决策大脑
 * ============================================================
 *
 * 【这一份东西到底是什么？】
 * 它就是**一个没有画面的客户端**。
 *
 * 用户的要求是"操作逻辑与真人玩家完全一致，均通过与真人相同的操作接口执行"，
 * 所以这里**没有**给服务端开任何后门：
 *   · 它发出的每一条动作都是 `ClientMessage`（buyCard / submitTeam / shopUpdate /
 *     playerStats / pickCovenant / playbackDone / pauseVote / setReady），
 *     走的是 `handleMessage()` —— 和浏览器发过来那条**同一个函数**；
 *   · 它收到的每条消息都是 `ServerMessage`（room / pool / gameStarted / battleStart…），
 *     和浏览器**同一个广播**；
 *   · 买牌要等服务器批准（`buyResult`），牌库从共享池里扣，抢牌是真抢；
 *   · 经济和商店复用**客户端的同一份代码**（`apps/web/src/game/state.ts`），
 *     所以"人机能做哪些操作"和"真人能做哪些操作"永远一致 ——
 *     以后经济规则改了，人机自动跟着改，不需要在这里同步一遍。
 *
 * 【为什么要把客户端的 state.ts 拿来用，而不是在服务端另写一套简化经济？】
 * 那正是这个项目反复踩过的坑（"同一动作只允许一处实现"）。
 * 另写一套的下场是：某天改了"刷新价格"，人机还在按旧价算，
 * 于是它一直以为自己买得起 —— 而且**不会报错**。
 * `state.ts` 是纯逻辑（不碰 DOM / 不碰网络），在 Node 里跑完全没问题。
 *
 * 【难度是怎么做出区别的？】
 * 三档不是"反应速度不一样"，而是**决策质量**不一样（见 BOT_TUNING）：
 *   · 简单：有钱就买最便宜的、几乎不升级、不刷新、摆位随手放；
 *   · 普通：按等级节奏买经验、认得出"同名三张能升星"、挑羮绊；
 *   · 困难：盯着成套羁绊拿牌、会卖掉多余的、按射程前后排布阵、攒够钱就找核心。
 */

import {
  ARENA_H,
  BENCH_SLOTS,
  BOT_DIFFICULTY_INFO,
  BUY_XP_COST,
  ITEM_DEFS,
  ITEM_PER_UNIT,
  TRAIT_DEFS,
  activeTierIndexOf,
  familyKeyOf,
  COVENANT_IDS,
  MAX_LEVEL,
  TEAM_0_MAX_COL,
  UNIT_DEFS,
  amiyaDamageFromLog,
  covenantEconomy,
  populationCap,
  seedFromString,
  simulate,
  survivorsOfTeam,
  type BattleStartPayload,
  type BotDifficulty,
  type ClientMessage,
  type RoomView,
  type ServerMessage,
  type SubmittedTeam,
  type UnitPlacement,
} from '@airnight/shared';
import {
  advanceRound,
  applyApprovedBuy,
  applyCovenantOpening,
  canEditTeam,
  canShopNow,
  countOwned,
  createGameState,
  doBuyXp,
  doRefreshShop,
  doSellBench,
  enemiesKilledBy,
  enterPrepPhase,
  // ★ 0.3.31：商店回合以**服务端说的 phase** 为准（见 onGameStarted 的说明）
  enterShopRound,
  closeShopRound,
  applyApprovedShopRoundOperator,
  buyShopRoundSlot,
  equipItemToUnit,
  equipSharedItem,
  gameRulesOf,
  monstersKilledBy,
  placeBenchUnitAt,
  poolCopiesOfUnit,
  poolRemainingOf,
  recallFromBoard,
  setNetPoolView,
  shopPriceOf,
  shopRoundActive,
  shopRoundOperatorFits,
  toSubmittedTeam,
  type GameState,
} from '../../../apps/web/src/game/state.js';
import {
  OPERATOR_SLOT_COPIES,
  OPERATOR_SLOT_STAR,
  type ShopRoundSlot,
} from '../../../apps/web/src/game/shop-round.js';

/** 一次"人机"需要的全部外部信息（都由 main.ts 提供） */
export interface BotOptions {
  playerId: string;
  roomCode: string;
  difficulty: BotDifficulty;
  /**
   * 把一条**客户端消息**交给服务器。
   * ★ 由 main.ts 传 `(msg) => handleMessage(botConnection, msg)` ——
   *   也就是说人机和真人走的是同一个入口函数。
   */
  send: (message: ClientMessage) => void;
  /**
   * 节奏倍率（1 = 正常速度）。
   * ★ 测试里传一个很小的值（比如 0.02），一局人机对局就能在几百毫秒里跑完。
   */
  speed?: number;
}

/**
 * 三档难度的"旋钮"。
 *
 * 【为什么是集中一张表，而不是散在各处的 if？】
 * 因为"简单/普通/困难"的差别必须**看得见**：一个策划想知道
 * "困难到底比普通强在哪"，应该能在这里一眼读完，而不是去翻 30 个分支。
 */
interface BotTuning {
  /** 两次动作之间的基础间隔（毫秒，会乘 speed） */
  think: number;
  /** 想升到几级（按回合给）—— 返回 0 表示"这一回合不主动买经验" */
  targetLevel: (round: number) => number;
  /** 主动买经验时至少要留多少金币 */
  xpReserve: number;
  /** 金币达到这个数才考虑刷新商店（Infinity = 从不刷新） */
  rerollFloor: number;
  /**
   * ★★ 手上有"对子"（同名两张 1 星）时，钱到这个数就愿意刷去找第三张。
   * 这是**升星率**的关键 —— 只看 `rerollFloor`（要 50 金）的话，
   * 一局下来几乎不会刷新，也就永远凑不齐三个。
   */
  pairRollGold: number;
  /** 每回合最多刷新几次 */
  maxRerolls: number;
  /** 买牌时是否考虑羁绊 */
  traitAware: boolean;
  /** 备战席满了 / 有更好的了，要不要卖掉多余的 */
  trims: boolean;
  /** 摆位：'any' 随便放、'role' 按射程前后排、'role+spread' 再摊开站位 */
  place: 'any' | 'role' | 'role+spread';
  /** ★★ 会不会用藏品（困难档才会） */
  usesItems: boolean;
  /**
   * ★★ 会不会逛**商店回合**（坎诺特）—— 困难档才会。
   * 这是藏品的主要来源：完全跳过它的话，一整局只拿得到野怪掉落那一两件，
   * 于是"会不会用藏品"在玩家眼里等于没发生过。
   */
  usesShopRound: boolean;
  /** 每回合最多做几个动作（防止某个 bug 让它在一回合里空转几千次） */
  maxActions: number;
}

/**
 * 等级曲线。
 * ★ 这几条数字是照"这个游戏每回合白送 2 点经验"定的：
 *   不主动买经验的话，20 回合大概是 6 级 —— 所以"简单"基本就是这个水平，
 *   "普通"靠买经验快一两级，"困难"再快一级并更早成型。
 */
const BOT_TUNING: Record<BotDifficulty, BotTuning> = {
  easy: {
    think: 1000,
    targetLevel: () => 0,
    xpReserve: 0,
    rerollFloor: Number.POSITIVE_INFINITY,
    pairRollGold: Number.POSITIVE_INFINITY,
    maxRerolls: 0,
    traitAware: false,
    trims: false,
    place: 'any',
    usesItems: false,
    /*
      ★ 0.3.31：三档都开商店回合。
      【为什么商店回合不是难度轴？】
      它是**对局的一个阶段**（第 2/4/6 回合自动进商店），不是一种"高级技巧"。
      人机直接跳过 ⇒ 它连那 8 格货架上的 2 星干员都拿不到，
      跟真人对局完全不是一回事（用户报的"AI 不会使用商店回合"就是这条）。
      ★ 难度差保留在"买什么"上：`shopRoundScore` 里只有 traitAware 档会按阵容挑转职。
    */
    usesShopRound: true,
    maxActions: 14,
  },
  normal: {
    think: 700,
    targetLevel: (round) => (round <= 2 ? 3 : round <= 5 ? 4 : round <= 9 ? 5 : round <= 13 ? 6 : 7),
    xpReserve: 12,
    rerollFloor: 30,
    pairRollGold: 30,
    maxRerolls: 2,
    traitAware: true,
    // ★ 0.3.31：普通档也会清备战席垃圾了（以前只有困难会，普通档整局背着一堆没用的牌）
    trims: true,
    place: 'role',
    usesItems: false,
    // ★ 0.3.31：商店回合是对局阶段，不是难度选项 —— 普通档也要用（见 easy 那条说明）
    usesShopRound: true,
    maxActions: 24,
  },
  hard: {
    think: 520,
    /*
      ★★ 等级曲线**不能一味求高**（用户报的"升星率很低"就是它引起的）：
      把每回合的钱全砸进经验，就没有钱刷新找同名卡，
      结果场上一堆 1 星、等级倒是很高 —— 那叫虚胖。
      现在到 8 级就停手，剩下的钱留给"凑三星"。
    */
    targetLevel: (round) =>
      /*
        ★ 0.3.31：后期多给一级（到 9 级）。
        以前封在 8 级，而商店里 5 费的出货率 8 级只有 3%、9 级才 10% ——
        等于"后期永远见不到五费"（用户报的"后期也不会买五费"）。
        ★ 只放到 9，不无脑冲 10：再往上就没钱凑三星了。
      */
      round <= 1 ? 2 : round <= 3 ? 4 : round <= 6 ? 5 : round <= 10 ? 6 : round <= 15 ? 7 : round <= 18 ? 8 : 9,
    xpReserve: 8,
    // ★ 有钱就刷（20 金就够），不再等到 50
    rerollFloor: 20,
    // ★★ 手上有对子时 12 金就愿意刷 —— 这是升星率的主要来源
    pairRollGold: 12,
    maxRerolls: 8,
    traitAware: true,
    trims: true,
    place: 'role+spread',
    // ★★ 困难档会用藏品（简单 / 普通不会 —— 这也是一档难度差）
    usesItems: true,
    usesShopRound: true,
    maxActions: 40,
  },
};

/**
 * 人机选盟约的偏好顺序（只看普通 / 困难）。
 *
 * ★ 顺序按"对一条自己会搭的阵容最有用"排：能打（坚不可摧 / 命结之秘 / 药枚实验）
 *   > 能回血（重生疗法）> 能给钱（私募基金 / 利滚利）。
 * ★ **故意不含 `cv_amiya`（不容拒绝）**：那条盟约要"阿米娅参战 + 打满 15 万伤害"
 *   才能升变，人机不会专门围绕她做阵容，选了等于白选一个盟约。
 */
const BOT_COVENANT_PREFERENCE = [
  'cv_golia',
  'cv_emengarde',
  'cv_sangshen',
  'cv_warfarin',
  'cv_humus',
  'cv_shapeshifter',
  'cv_kathryn',
  'cv_dadi',
  'cv_peipei',
  'cv_justin',
  'cv_laoli',
  'cv_qiliang',
  'cv_zilan',
];

/**
 * 有人掉线、对局暂停时，人机等多久才点「同意」。
 *
 * ★ 25 秒的理由：暂停总时限是 180 秒，而"关掉浏览器再重新双击启动器"
 *   实测轻松超过 30 秒（见 main.ts 里 RESUME_GRACE_LOBBY_MS 的注释）。
 *   25 秒是个折中：足够一次快速重连，又不至于让一屋子人陪着等三分钟。
 * ★ 这个值**不受 AIRNIGHT_BOT_SPEED 影响** —— 它在等人回来，不是在思考。
 */
const BOT_PAUSE_VOTE_DELAY_MS = 25_000;

export class BotBrain {
  private readonly id: string;
  private readonly roomCode: string;
  private readonly send: (message: ClientMessage) => void;
  private readonly speed: number;

  private difficulty: BotDifficulty;
  private tuning: BotTuning;

  /** 这个"玩家"的经济 / 商店 / 棋盘 —— 和浏览器里那份是同一套代码 */
  private state: GameState = createGameState(1);
  /** 服务端最近一次广播的房间视图 */
  private room: RoomView | null = null;

  /** 开局了没有（第一回合的 gameStarted 要"建局"，之后都是"结算 + 进入"） */
  private matchStarted = false;
  /** 我已经被淘汰了（之后不再做任何操作） */
  private eliminated = false;
  /** 上一回合我赢了没有（null = 平局 / 没打） */
  private lastWon: boolean | null = null;
  /** 上一回合我在哪一队（0/1）—— 结算要用 */
  private lastTeam: 0 | 1 = 0;
  /** 上一回合的战斗日志（要用来数击杀 / 存活 / fever） */
  private lastBattle: { payload: BattleStartPayload; result: ReturnType<typeof simulate> } | null = null;

  /** 正在等服务器批准的那一次购买（商店格子下标） */
  private pendingBuySlot: number | null = null;
  /** 正在等服务器批准的**商店回合 2 星干员位**（货架下标；`null` = 没有在等） */
  private pendingShopIndex: number | null = null;
  /**
   * ★★ 这一回合**试过但没买成**的货架格子。
   * 没有它的下场是：服务器一句"牌库不够"，人机下一拍又挑中同一格、
   * 再问一次、再被拒 —— 40 次动作预算就这么原地烧光，
   * 于是"这一个商店回合它什么都没干"（而且不报错，最难查的那种）。
   */
  private shopRoundTried = new Set<number>();
  /** 上一次上报的阵容签名（去重：没变就不发） */
  private lastTeamSignature = '';
  /** 上一次上报的"我商店里摆着哪些牌" */
  private lastShopHeld: string[] | null = null;
  /** 上一次上报的等级 / 连胜 */
  private lastStats = '';
  /** 本回合已经刷新了几次 */
  private rerollsThisRound = 0;
  /** 本回合已经做了几个动作 */
  private actionsThisRound = 0;
  /** 本回合的回合号（跟着 gameStarted 变） */
  private round = 0;
  /** 这一次暂停我投过票没有 */
  private votedPause = false;
  /** 已经替自己选过盟约了吗（防止一秒一条 tick 时重复发） */
  private covenantPickedFor = '';

  private disposed = false;
  /** 规划用的那个"下一步动作"定时器（同一时刻最多一个） */
  private planTimer: ReturnType<typeof setTimeout> | null = null;
  /** 所有由自己挂的定时器（dispose 时统一清） */
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  /** 出站队列（防止 send -> handleMessage -> 又 send 的递归） */
  private outbox: ClientMessage[] = [];
  private flushing = false;

  constructor(options: BotOptions) {
    this.id = options.playerId;
    this.roomCode = options.roomCode;
    this.send = options.send;
    this.speed = Math.max(0.001, options.speed ?? 1);
    this.difficulty = options.difficulty;
    this.tuning = BOT_TUNING[options.difficulty];
  }

  get playerId(): string {
    return this.id;
  }

  /** 我在哪个房间（房间被销毁时按它清理所有属于这个房间的人机） */
  get roomId(): string {
    return this.roomCode;
  }

  get currentDifficulty(): BotDifficulty {
    return this.difficulty;
  }

  /**
   * 换难度。
   * ★ 只在大厅生效（服务端已经拦过）。换完立刻用新的旋钮 ——
   *   开局之后第一条 `gameStarted` 就会按新难度开局。
   */
  setDifficulty(difficulty: BotDifficulty): void {
    this.difficulty = difficulty;
    this.tuning = BOT_TUNING[difficulty];
  }

  /** 房间阶段（main.ts 在 addBot 之后用它判断要不要立刻准备） */
  requestReady(): void {
    this.write({ t: 'setReady', ready: true });
  }

  dispose(): void {
    this.disposed = true;
    if (this.planTimer) clearTimeout(this.planTimer);
    this.planTimer = null;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  // ============================================================
  //  出站：所有动作都从这里出去（= 真人的 socket.send）
  // ============================================================

  private write(message: ClientMessage): void {
    if (this.disposed) return;
    this.outbox.push(message);
    if (this.flushing) return;
    this.flushing = true;
    try {
      while (this.outbox.length > 0) {
        const next = this.outbox.shift()!;
        this.send(next);
      }
    } finally {
      this.flushing = false;
    }
  }

  private later(fn: () => void, ms: number): void {
    if (this.disposed) return;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (!this.disposed) fn();
    }, Math.max(0, ms));
    this.timers.add(timer);
  }

  // ============================================================
  //  入站：服务器广播
  // ============================================================

  onServerMessage(message: ServerMessage): void {
    if (this.disposed) return;
    switch (message.t) {
      case 'room':
        this.onRoom(message.room);
        break;
      case 'pool':
        /*
          ★ 挂到自己的 state 上（不是模块级变量）—— 见 setNetPoolView 的 target 参数。
          人机拿到的牌库视图必须是**它自己那份**，否则一个进程里几台人机会互相覆盖。
        */
        setNetPoolView(message.remaining, message.held, this.id, this.state);
        break;
      case 'gameStarted':
        this.onGameStarted(message.round, message.phase);
        break;
      case 'battleStart':
        this.onBattleStart(message);
        break;
      case 'battleEnd':
        this.onBattleEnd(message.hpAfter);
        break;
      case 'playerEliminated':
        if (message.playerId === this.id) {
          this.eliminated = true;
          this.state.meEliminated = true;
          if (this.planTimer) clearTimeout(this.planTimer);
          this.planTimer = null;
        }
        break;
      case 'pauseTick':
        // ★ 票被清零 = 服务端重开了这次暂停，我这一票作废，得能重新表态
        if (message.voteCount === 0) this.votedPause = false;
        break;
      case 'buyResult':
        this.onBuyResult(message.ok, message.defId);
        break;
      case 'gameOver':
        /*
          对局结束：停下手里的一切。
          ★ 不 dispose —— 房间对象可能还挂着（玩家还在结算页上看），
            这时候人机的座位/连接应该继续存在，等房间真的被销毁时统一回收
            （见 main.ts 的 disposeRoomBots）。
        */
        if (this.planTimer) {
          clearTimeout(this.planTimer);
          this.planTimer = null;
        }
        break;
      default:
        break;
    }
  }

  private onRoom(room: RoomView): void {
    this.room = room;
    const me = room.players.find((player) => player.id === this.id);

    // 大厅里：点了「添加人机」就自动准备好（否则房主还要替它点一下）
    if (room.phase === 'lobby') {
      if (me && !me.ready) this.requestReady();
      return;
    }

    /*
      暂停：有人掉线、对局冻结。
      ★ 人机必须投票 —— 否则"需要 N 票同意"里永远缺人机那几票，
        全房间只能干等满 3 分钟超时（人机在房间里反而变成了拖累）。
      ★★ 但**不能立刻投**：暂停的本意是"给掉线的人一点时间回来"。
        人机第一时间投票 = 谁网络抖一下就当场被淘汰（实测过，太狠了）。
        所以等 `BOT_PAUSE_VOTE_DELAY_MS` 再表态：够人回来，也不会被无限拖着。
        （这一段用的是**真实时间**，不跟 `speed` 缩放 —— 它是在等人，不是在想棋。）
    */
    if (room.paused && !this.votedPause) {
      this.votedPause = true;
      this.later(() => {
        if (this.room?.paused) this.write({ t: 'pauseVote' });
      }, BOT_PAUSE_VOTE_DELAY_MS);
    }
    if (!room.paused) this.votedPause = false;

    // 盟约选秀：轮到我了吗
    if (room.covenant && room.covenant.currentPlayerId === this.id) {
      this.pickCovenantOnce(room);
    }
  }

  /**
   * 选盟约。
   * ★ 用 `covenantPickedFor` 去重：服务端每秒广播一次房间，
   *   不去重的话我会一秒发一条 pickCovenant（第二条开始就全是"还没轮到你"的报错）。
   */
  private pickCovenantOnce(room: RoomView): void {
    const key = `${room.covenant?.currentPlayerId}:${this.round}`;
    if (this.covenantPickedFor === key) return;
    this.covenantPickedFor = key;

    /*
      ★ 已经被选走的盟约：从玩家视图里的 `covenantId` 现算。
      协议**故意**不给"完整顺序"（用户口径：顺序不显示），
      所以这里只能看到"谁已经选了什么" —— 这也正好是人机需要知道的全部。
    */
    const taken = new Set(
      room.players.map((player) => player.covenantId).filter((id): id is string => typeof id === 'string' && id.length > 0),
    );
    const free = COVENANT_IDS.filter((id) => !taken.has(id));
    if (free.length === 0) return;

    let pick: string;
    if (this.tuning.traitAware) {
      pick = BOT_COVENANT_PREFERENCE.find((id) => free.includes(id)) ?? free[0]!;
    } else {
      // 简单档：真的随便挑一个（可复现：用房间码 + 回合做种子）
      const seed = seedFromString(`bot-covenant|${this.roomCode}|${this.id}|${this.round}`);
      pick = free[seed % free.length]!;
    }
    // 慢一拍再发，看起来像"想了想"
    this.later(() => this.write({ t: 'pickCovenant', covenantId: pick }), this.tuning.think * this.speed);
  }

  // ============================================================
  //  开局 / 每回合
  // ============================================================

  private onGameStarted(round: number, phase?: string): void {
    if (this.eliminated) return;

    const isMatchStart = !this.matchStarted;
    this.matchStarted = true;
    this.round = round;

    const covenantId = this.room?.players.find((p) => p.id === this.id)?.covenantId;
    const rules = gameRulesOf(this.room?.settings);

    if (isMatchStart) {
      /*
        开局：照客户端那一套建局 —— 种子用「房间码 + 我的 id」哈希，
        开局金币 / 每回合收入按房间设置，再加上盟约的经济加成。
        （这些必须和 `main.ts` 的 gameStarted 分支同源，否则人机的经济曲线会和真人对不上。）
      */
      const money = covenantEconomy(covenantId);
      this.state = createGameState(seedFromString(`airnight-shop|${this.roomCode}|${this.id}`), {
        startGold: rules.startGold + money.startGold,
        incomeBase: rules.incomeBase + money.income,
      });
      this.state.covenantId = covenantId;
      // ★ 盟约「不容拒绝」开局送一只 1 星阿米娅（人机一般不会选，但选了就要发）
      applyCovenantOpening(this.state);
    } else {
      /*
        新的一回合 = 结算上一回合。顺序照客户端：先取战报里的四样东西，再交给 advanceRound。
        ★ `won` 必须是"我这一队赢没赢"，不是"队伍 0 赢没赢" —— 联机里我可能被分到右边。
      */
      const battle = this.lastBattle;
      const team = this.lastTeam;
      const placements: UnitPlacement[] = this.state.placements.map((p) => ({
        defId: p.defId,
        star: p.star,
        cell: { col: p.cell.col, row: p.cell.row },
      }));
      const dead = new Set<number>();
      if (battle) {
        for (const event of battle.result.log) {
          if (event.type === 'death') dead.add(event.unitId);
        }
      }
      const survivors = battle ? survivorsOfTeam(placements, dead, team) : undefined;
      /*
        ★ 这一回合是"刚打完的那一回合"（`this.round` 还没有被新回合覆盖）。
        野怪回合要按它判 —— 掉落 / 连胜 / 阿米娅任务都有"野怪不算"的口径。
        击杀明细一直传：`grantMonsterRoundDrops` 自己按回合筛，
        普通回合里根本没野怪，数出来就是空数组。
      */
      const killed = battle ? monstersKilledBy(battle.result.log, team) : [];
      const enemies = battle ? enemiesKilledBy(battle.result.log, team) : 0;
      const fever = battle ? (battle.result.feverGained?.[team] ?? 0) : 0;
      const amiyaDamage = battle ? amiyaDamageFromLog(battle.result.log, team) : 0;

      this.state.meEliminated = this.eliminated;
      /*
        ★★ 0.3.31 修：**进 advanceRound 之前，state.round 必须是"刚打完的那一个"**。
        `advanceRound` 内部先按 `state.round` 判"这一回合之后要不要开商店"（`settledRound`），
        然后才 `state.round++`。而 `this.round` 已经是服务端广播的**新**回合号了 ——
        以前这里直接 `= this.round`，等于把 settledRound 抬高了一回合，于是：
          · 人机判"该开商店"的回合比服务端**早一格**（第 9 回合就开了，服务端第 10 回合才开）；
          · 真到商店那一回合，它手上是**上一回合残留的旧货架**（还可能带着已售出的格子）；
          · 非商店回合里 `state.shopRound` 一直挂着不清。
        用户报的"AI 不会使用商店回合"就是这条链的下游表现。
        ★ 下面循环末尾还有一次 `this.state.round = round`（advanceRound 已经把 round+1 补回来了）。
      */
      this.state.round = this.round - 1;
      advanceRound(this.state, this.lastWon, survivors, 0, killed, enemies, fever, amiyaDamage);
      this.state.covenantId = covenantId;
    }

    this.lastBattle = null;
    this.lastWon = null;
    this.rerollsThisRound = 0;
    this.actionsThisRound = 0;
    this.pendingBuySlot = null;
    this.pendingShopIndex = null;
    this.shopRoundTried.clear();
    this.state.round = round;
    /*
      ★★ 0.3.31：**商店回合以服务端为准**（`gameStarted.phase`）。
      以前这里只写 `this.state.phase = phase === 'shop' ? 'shop' : 'prep'` 再 `enterPrepPhase`，
      等于把"这一回合有没有商店"交给 `advanceRound` 里那份 `isShopRoundAfter` 自行推断 ——
      推断一旦和服务端差一格（房间设置动过 / 上面那个回合号 bug），
      就会出现"服务端开了商店、人机没开"或反过来。
      现在：服务端说开就开（本地没开则补开），说不开就收摊。
    */
    if (phase === 'shop') {
      if (!this.state.shopRound) enterShopRound(this.state);
      this.state.phase = 'shop';
    } else {
      if (this.state.shopRound) closeShopRound(this.state);
      enterPrepPhase(this.state);
    }
    // 新回合：上一次上报的签名都作废，必须重发（服务器那边这一回合是空的）
    this.lastTeamSignature = '';
    this.lastShopHeld = null;
    this.lastStats = '';

    this.reportStats();
    this.schedule(this.tuning.think * this.speed);
  }

  private onBattleStart(payload: BattleStartPayload): void {
    if (this.eliminated) return;
    const team: 0 | 1 | null =
      payload.team0PlayerId === this.id ? 0 : payload.team1PlayerId === this.id ? 1 : null;
    if (team === null) return; // 不是我的战斗（观战），不需要做任何事

    /*
      ★ 本地演算一遍这一场 —— 和真人客户端做的事**完全一样**。
      要拿到的四样东西下一回合结算都要用：赢没赢、谁活着、打死了哪些野怪、攒了多少 fever。
      （服务端也已经算过这一场；这里算第二遍是为了"人机的账和真人走同一条路"，
        代价是每回合多一次 simulate —— 对人机来说可以忽略。）
    */
    const result = simulate(UNIT_DEFS, [payload.team0, payload.team1], payload.seed);
    this.lastBattle = { payload, result };
    this.lastTeam = team;
    this.lastWon = result.winner === null ? null : result.winner === team;
    this.state.phase = 'battle';

    /*
      ★ 「看完了」回执：人机没有动画，等价于"刚开播就看完了"。
      整回合的推进在等服务端收齐所有人的回执（含人机），所以这一条**必须发**，
      否则每一回合都要等满兜底超时（最长 160 多秒）。
      给一点点延迟，模拟"播了一下"。
    */
    const watchMs = Math.max(120, Math.min(2600, (result.ticks / 20) * 260)) * this.speed;
    this.later(() => this.write({ t: 'playbackDone', battleId: payload.battleId }), watchMs);
  }

  private onBattleEnd(hpAfter: Record<string, number>): void {
    /*
      血量是**服务端权威**的：客户端那份只是显示用的副本。
      这里同步一下，免得人机的 state 里血量一直停在开局值
      （它会影响「金酒之杯」这类按血量算加成的藏品，人机虽然不装藏品，
        但以后要装的话这笔账得是对的）。
    */
    const hp = hpAfter[this.id];
    if (typeof hp === 'number') this.state.economy.hp = hp;
  }

  // ============================================================
  //  买牌：先问服务器（和真人两条腿一样）
  // ============================================================

  private onBuyResult(ok: boolean, defId: string): void {
    /*
      ★ 商店回合的 2 星干员位：回执要落到**货架那一格**上
      （和客户端 `applyApprovedShopRoundOperator` 同一个函数）。
      必须在这里先分流 —— 它和普通商店那 5 格是两套容器，
      混在一起会把 2 星干员塞进普通商店的格子里（下标完全不是一回事）。
    */
    if (this.pendingShopIndex !== null) {
      const index = this.pendingShopIndex;
      this.pendingShopIndex = null;
      if (ok) {
        // 兜底：真落地失败（比如刚好被别的操作挤掉）也不能一直惦记这一格
        if (!applyApprovedShopRoundOperator(this.state, index).ok) this.shopRoundTried.add(index);
        this.syncTeam();
        this.schedule(this.tuning.think * 0.5 * this.speed);
      } else {
        // 被拒（多半是这张牌刚被别人抢走）—— 这一格这回合不再惦记
        this.shopRoundTried.add(index);
        this.schedule(this.tuning.think * 0.5 * this.speed);
      }
      return;
    }

    const slot = this.pendingBuySlot;
    if (slot === null) return;
    if (!ok) {
      // 服务器拒了（牌库没货 / 被抢）—— 丢掉这一次，下一拍重新挑
      this.pendingBuySlot = null;
      return;
    }
    // 服务器已经扣过牌了，这里"就地收下"：走的是客户端同一条 applyApprovedBuy 路径
    const landed = this.applyBuy(slot, defId);
    this.pendingBuySlot = null;
    if (landed) {
      // 买到手要立刻重发阵容（观战 / 牌库都要跟着变）
      this.syncTeam();
      this.schedule(this.tuning.think * 0.5 * this.speed);
    }
  }

  /**
   * 落地一次"已被批准的购买"。
   *
   * 【为什么不直接调 `applyApprovedBuy`？】
   * 它按**下标**买，而服务器的回执只带 `defId`（不带下标）。
   * 人机在等回执的这一小段时间里可能已经刷新过商店（下标就错位了），
   * 所以这里按 defId 找**当前**还在架上的那一格 —— 找不到就说明这一格
   * 已经不在商店里了，这一次购买作废（金币不会被扣，因为不调用购买函数）。
   */
  private applyBuy(slotIndex: number, defId: string): boolean {
    const shop = this.state.economy.shop;
    let index = slotIndex;
    if (!shop[index] || shop[index]!.defId !== defId || shop[index]!.sold) {
      index = shop.findIndex((entry) => entry.defId === defId && !entry.sold);
    }
    if (index < 0) return false;
    // 复用与真人完全相同的那条腿（内部会扣钱、合成、记账）
    const result = applyApprovedBuy(this.state, index);
    return result.ok;
  }

  // ============================================================
  //  每一拍的决策
  // ============================================================

  private schedule(delayMs: number): void {
    if (this.disposed || this.eliminated) return;
    if (this.planTimer) return; // 已经排了一拍，别叠
    this.planTimer = setTimeout(() => {
      this.planTimer = null;
      this.tick();
    }, Math.max(0, delayMs));
    this.timers.add(this.planTimer);
  }

  /** 一拍：做**一件事**，然后把自己排到下一拍（和真人"点一下、等一下、再点"一个节奏） */
  private tick(): void {
    if (this.disposed || this.eliminated) return;
    const phase = this.state.phase;

    // 不在"能操作"的阶段（战斗 / 结算）就等着 —— 下一次 gameStarted 会重新叫醒我
    if (!canEditTeam(phase)) return;

    if (this.actionsThisRound >= this.tuning.maxActions) {
      // 这一回合的"操作预算"用完了：仍然把阵容同步一次，然后停下
      this.syncTeam();
      return;
    }
    this.actionsThisRound++;

    /*
      ★★ 顺序：**先装藏品，再买东西**。
      这不是随便排的 —— 一个回合的动作预算是有限的（`maxActions`），
      而"买牌 → 刷新 → 再买"这条链可以轻松把预算吃光。
      装在最后的话，实测一整局都没有一次轮到装备（用户报的"困难不会装备藏品"
      就是这么来的：代码写了，但永远走不到）。
      藏品只会在回合结算时掉进来，装上就没了，所以放最前面最划算。
    */
    const didSomething =
      this.tryEquip() ||
      this.tryShopRound() ||
      this.tryBuy() ||
      this.tryLevel() ||
      this.tryReroll() ||
      this.trySell() ||
      this.tryPlace();
    this.syncTeam();

    // 还能继续做就接着来；什么都做不了 = 这一回合收工
    if (didSomething) this.schedule(this.tuning.think * this.speed);
  }

  // ---- ⓪ 商店回合（坎诺特的限时货架）----

  /**
   * 在商店回合里买东西。
   *
   * 【为什么人机必须会这一件事？】
   * 坎诺特的货架是这个游戏**藏品的主要来源**，野怪掉落只是零头。
   * 完全跳过它的下场就是"一整局只拿到一两件"——
   * 于是"会不会用藏品"这件事在玩家眼里等于根本没发生过
   * （用户报"困难不会装备藏品"，深层原因之一就是它从来没进过这张商店）。
   *
   * 【联机口径必须和真人完全一致】
   *   · 藏品位 → 本地买（`buyShopRoundSlot`）：藏品是每人自己的库存，没有共享可争的；
   *   · 干员位 → 卖的是 2 星 = 3 张，要从**共享牌库**里真扣，
   *     所以发 `buyCard(count: 3)` 问服务器，回执走 `applyApprovedShopRoundOperator`
   *     （和客户端 `requestShopRoundBuy` 那条分支同一条路）。
   */
  private tryShopRound(): boolean {
    if (!this.tuning.usesShopRound) return false;
    if (!shopRoundActive(this.state)) return false;
    if (this.pendingShopIndex !== null) return false; // 还在等上一次的回执
    const shelf = this.state.shopRound;
    if (!shelf) return false;

    let best: { index: number; score: number } | null = null;
    for (let index = 0; index < shelf.slots.length; index++) {
      const slot = shelf.slots[index]!;
      if (slot.sold) continue;
      if (this.shopRoundTried.has(index)) continue;
      if (slot.price > this.state.economy.gold) continue;
      /*
        ★ 干员位卖的是 2 星 = 3 张：先照客户端那条路查一遍牌库，
        牌库不够就直接放弃这一格（问了也是被服务器拒 ——
        而且被拒之后还会一直重试，把这一回合的动作预算全烧在这上面）。
      */
      if (slot.kind === 'operator' && slot.defId) {
        /*
          ★★ 这两条必须**在问服务器之前**判完：
          服务器一批准就立刻从共享牌库扣 3 张，本地才去落地。
          牌库不够 / 备战席放不下 = 扣了却落不了地 ——
          那 3 张牌就凭空从所有人共享的牌库里消失了。
        */
        if (poolRemainingOf(this.state, slot.defId) < OPERATOR_SLOT_COPIES) {
          this.shopRoundTried.add(index);
          continue;
        }
        if (!shopRoundOperatorFits(this.state, slot.defId)) {
          this.shopRoundTried.add(index);
          continue;
        }
      }
      const score = this.shopRoundScore(slot);
      if (score <= 0) continue;
      if (!best || score > best.score) best = { index, score };
    }
    if (!best) return false;

    const slot = shelf.slots[best.index]!;
    if (slot.kind === 'operator' && slot.defId) {
      this.pendingShopIndex = best.index;
      this.write({ t: 'buyCard', defId: slot.defId, count: OPERATOR_SLOT_COPIES });
      return true;
    }
    return buyShopRoundSlot(this.state, best.index).ok;
  }

  /** 货架上这一格值不值得买（> 0 才买） */
  private shopRoundScore(slot: ShopRoundSlot): number {
    if (slot.kind === 'operator') {
      if (!slot.defId) return 0;
      // 2 星干员 = 直接省掉三张同名，按"上场值"估，再扣掉价格
      return this.placeScore({ defId: slot.defId, star: OPERATOR_SLOT_STAR }) - slot.price * 0.5;
    }
    if (!slot.itemId) return 0;
    const item = ITEM_DEFS[slot.itemId];
    if (!item) return 0;
    /*
      ★★ 0.3.31（用户报"AI 只买转职"）：
      转职藏品以前是**固定 30 分**，跟一件毫无用处的普通藏品同价 ——
      于是它每一格都买，哪怕那个羁绊场上一个人都没有（转了也没有意义）。
      改成按"这件转职能不能帮我顶到新档位"打分，具体在 `traitRelicScore`。
    */
    if (slot.kind === 'traitRelic') {
      const trait = item.grantsTrait;
      // 简单档不看阵容，一律按普通藏品的价格买（它本来就该"乱买"）
      if (!this.tuning.traitAware) return 30 - slot.price * 0.8;
      return trait ? this.traitRelicScore(trait) - slot.price * 0.8 : 0;
    }
    // 进阶藏品比普通藏品值钱；价格越高越不划算（这一档钱还要留给刷新找升星）
    return (item.rarity === 'advanced' ? 48 : 30) - slot.price * 0.8;
  }

  /**
   * 一件**转职藏品**对当前阵容值多少。
   *
   * 【它到底起什么作用？】
   * 给某个干员多挂一个羁绊标签 ⇒ 那个羁绊的**人头数 +1**。
   * 所以它的价值完全取决于"我这个羁绊现在差几个人到下一档"。
   */
  private traitRelicScore(traitId: string): number {
    const traitDef = TRAIT_DEFS[traitId];
    if (!traitDef) return 0;
    const count = this.boardTraitCount(traitId);
    // 家里一个都没有 ⇒ 转了也只能凑出 1 个人，通常顶不到任何档位
    if (count === 0) return 0;
    const before = activeTierIndexOf(traitDef, count);
    const after = activeTierIndexOf(traitDef, count + 1);
    if (after > before) return 70; // 差这一张就能升档
    return 24; // 只是锦上添花
  }

  // ---- ① 买牌 ----

  private tryBuy(): boolean {
    if (this.pendingBuySlot !== null) return false; // 还在等上一次的回执
    const best = this.bestShopOffer();
    if (!best) return false;
    /*
      ★ 留钱：普通 / 困难会为了利息和"刷新找同名"留一档现金。
      简单档 `keepGold` 恒为 0，等于"有钱就花"。
    */
    if (this.state.economy.gold - best.price < this.keepGold()) return false;

    const slot = this.state.economy.shop[best.index]!;
    this.pendingBuySlot = best.index;
    this.write({ t: 'buyCard', defId: slot.defId, count: 1 });
    return true;
  }

  /**
   * 商店里**现在最该买**的那一格（`null` = 一张都不值得买）。
   *
   * ★ 抽出来是因为 `tryBuy` 和 `tryReroll` 都要问同一个问题：
   *   "架上有值得买的吗？" 两处各写一遍判据，迟早会出现
   *   "它觉得没值得买的、于是刷新，可刚刚其实有一张它该买的"。
   */
  private bestShopOffer(): { index: number; score: number; price: number } | null {
    if (!canShopNow(this.state.phase)) return null;
    const shop = this.state.economy.shop;
    if (!shop || shop.length === 0) return null;

    let best: { index: number; score: number; price: number } | null = null;
    for (let index = 0; index < shop.length; index++) {
      const slot = shop[index]!;
      if (slot.sold || !slot.defId) continue;
      if (!UNIT_DEFS[slot.defId]) continue;
      const price = shopPriceOf(this.state, { cost: slot.cost });
      if (price > this.state.economy.gold) continue;
      /*
        ★ 备战席满了、买了也上不去 —— 除非能立刻合出升星（那 buyShopSlot 会放行）。
        人机不会为了"腾位置"去卖牌，所以这条必须挡住，否则会一直点一张买不进来的牌。
      */
      if (this.state.economy.bench.length >= BENCH_SLOTS && !this.wouldMerge(slot.defId)) continue;
      /*
        ★ 简单档：只挑最便宜的（完全不懂棋）。
        ★ 普通 / 困难：按"值不值"打分，**分数不为正就不买** ——
          这一条是"别把钱花在垃圾上"的闸门，没有它人机会把 3 费杂鱼买满备战席。
      */
      const score = this.tuning.traitAware ? this.buyScore(slot.defId) - price * 0.5 : -price;
      if (this.tuning.traitAware && score <= 0) continue;
      if (!best || score > best.score) best = { index, score, price };
    }
    return best;
  }

  /**
   * 手上还剩几金才肯继续花（低于它就攒着）。
   *
   * ★ 只在**已经很有钱**的时候才留一手（为了吃利息 / 留给刷新）。
   *   早期就死攒的下场是"整局不买棋"，那比乱花钱还糟 ——
   *   棋盘上一个棋子都没有的 3 星经济毫无意义。
   *   （这条是实测出来的：第一版 reserve 写死 10，结果开局 3 金的人机
   *     一路攒到第 5 回合还没买过一张牌。）
   */
  private keepGold(): number {
    const gold = this.state.economy.gold;
    if (gold < 20) return 0;
    // 简单档永远不留（它没有"运营"这个概念）
    return this.tuning.traitAware ? 8 : 0;
  }

  /** 买下这张牌会不会立刻凑成升星（同名已有 2 张 1 星） */
  private wouldMerge(defId: string): boolean {
    return countOwned(this.state, defId, 1) >= 2;
  }

  /** 手上有没有"差一张就能升星"的对子（升星率的主要来源） */
  private hasUpgradablePair(): boolean {
    const seen = new Set<string>();
    for (const unit of this.state.economy.bench) {
      if (seen.has(unit.defId)) continue;
      seen.add(unit.defId);
      if (countOwned(this.state, unit.defId, 1) >= 2) return true;
    }
    return false;
  }

  /**
   * 一张牌值不值得**买**（越大越想要）。
   *
   * ★ 只看**公开信息**：费用、手上已有的同名张数、对场上羁绊的边际贡献。
   *   不偷看牌库 / 对手 —— 那才是"合理"的人机，也才不会被玩家骂作弊。
   *
   * ★★ 为什么"同名"在这里是**加分**？
   *   买 duplicate 是升星的唯一途径（3 张 1 星 → 2 星）。
   *   真正该惩罚"重复"的地方是**上场**（见 `placeScore`）——
   *   羁绊是按"不同干员"算人头的，场上摆两只同名对羁绊毫无贡献。
   */
  private buyScore(defId: string): number {
    const def = UNIT_DEFS[defId];
    if (!def) return -999;
    let score = def.cost * 6;
    // 手上已经有 2 张 = 再买一张就升星，价值陡增；1 张 = 有戏
    const owned = countOwned(this.state, defId, 1);
    if (owned >= 2) score += 60;
    else if (owned === 1) score += 18;
    if (this.tuning.traitAware) score += this.traitGain(defId);
    /*
      ★★ 0.3.31（用户报"后期也不会买五费"）：
      光靠 `cost * 6` 的话，5 费才 30 分，跟"两张 2 费（24）+ 一张对子加成"差不多 ——
      它宁可用三个杂鱼换一个三星，也不肯买一张真正强的五星。
      所以**中期之后**给 4 / 5 费额外的权重（4 费 +10、5 费 +20）。
      只在中后期生效：前期钱少，硬买高费会把经济锁死。
    */
    if (def.cost >= 4 && this.state.round >= 10) score += 10 * (def.cost - 3);
    /*
      冷门 5 费没有羁绊支撑时别乱买 —— ★ 但这条**只压 4 费**：
      5 费本身就是强度，不需要"羁绊支撑"这个条件（以前把它一起压掉了）。
    */
    if (this.tuning.traitAware && def.cost === 4 && owned === 0 && this.traitGain(defId) === 0) score -= 12;
    return score;
  }

  /**
   * 这只棋子**上场**值多少（越大越该站上去）。
   *
   * ★★ 和 `buyScore` 分开的核心原因（用户报的"放的牌大部分是重复的"）：
   *   买重复 = 好（能升星）；**上场重复 = 差**。
   *   羁绊按"不同干员"数人头，场上摆两只同名只多了一个会挨打的单位，
   *   对羁绊零贡献 —— 所以这里对"场上已有同名"直接扣一大截。
   *
   * ★ 身上穿了藏品的要**加权**：场上满了换人时它不能被当成"最弱的"换下去，
   *   否则藏品跟着它一起回备战席 —— 场上瞬间又变回"没藏品"的样子
   *   （实测过：不加权的话第 7 回合起场上一件藏品都看不到）。
   */
  private placeScore(unit: { defId: string; star: number; items?: readonly (string | null)[] }): number {
    const def = UNIT_DEFS[unit.defId];
    if (!def) return -999;
    let score = def.cost * 10 + (unit.star - 1) * 45;
    if (this.boardHasDef(unit.defId)) score -= 55;
    if (this.tuning.traitAware) score += this.traitGain(unit.defId) * 0.6;
    // 每件藏品 ≈ 半颗星（最多 2 件 = +40，刚好不到一整颗星的 45）
    score += (unit.items ?? []).filter((itemId) => !!itemId).length * 20;
    return score;
  }

  /** 场上有没有这一族的棋子（按 familyKey 判，和羁绊数人头同一套口径） */
  private boardHasDef(defId: string): boolean {
    const key = familyKeyOf(defId);
    return this.state.placements.some((placement) => familyKeyOf(placement.defId) === key);
  }

  /**
   * 这张牌加入之后，场上羁绊**能涨多少**（越大越该拿）。
   *
   * ★★ 这是"困难档会看阵容"的核心：它不是"这张牌有几个我家的标签"，
   *   而是"再上它会不会**刚好顶到下一档**"。差一个人就到 4 人口的羁绊，
   *   比已经 4 个人再加第 5 个人的那张值钱得多。
   * ★ 人数按 `familyKeyOf` 去重 —— 和阿米娅家族 / 羁绊面板的口径一致
   *   （同一只棋子的两个形态只算一个人）。
   */
  private traitGain(defId: string): number {
    const def = UNIT_DEFS[defId];
    if (!def) return 0;
    const alreadyOnBoard = this.boardHasDef(defId);
    let gain = 0;
    for (const trait of def.traits) {
      const traitDef = TRAIT_DEFS[trait];
      if (!traitDef) continue;
      const count = this.boardTraitCount(trait);
      // 已经在场上 = 再买一张也不会多一个人头（羁绊按家族去重）
      const next = alreadyOnBoard ? count : count + 1;
      const before = activeTierIndexOf(traitDef, count);
      const after = activeTierIndexOf(traitDef, next);
      if (after > before) gain += 40; // 顶到新档位：最值钱
      else if (next > 0) gain += 6; // 在凑的路上
    }
    return gain;
  }

  /** 场上某个羁绊现在有几个人（按家族去重，和内核 `countTraits` 同一口径） */
  private boardTraitCount(trait: string): number {
    const seen = new Set<string>();
    for (const placement of this.state.placements) {
      const key = familyKeyOf(placement.defId);
      if (seen.has(key)) continue;
      const unitDef = UNIT_DEFS[placement.defId];
      if (!unitDef) continue;
      if (unitDef.traits.includes(trait)) seen.add(key);
    }
    return seen.size;
  }

  // ---- ② 买经验 ----

  private tryLevel(): boolean {
    const target = this.tuning.targetLevel(this.state.round);
    if (target <= 0) return false;
    if (this.state.economy.level >= Math.min(MAX_LEVEL, target)) return false;
    /*
      ★ 留一点现金再买经验：把钱全砸进等级、结果一张牌都买不起，
        是自走棋里最典型的"看起来在运营、其实什么都没长"。
        （困难档几乎不留 —— 它靠等级换人口，前期就是要压上去。）
    */
    if (this.state.economy.gold - BUY_XP_COST < this.tuning.xpReserve) return false;
    const result = doBuyXp(this.state);
    if (!result.ok) return false;
    this.reportStats();
    return true;
  }

  // ---- ③ 刷新商店 ----

  /**
   * 刷新商店。
   *
   * ★★ 两条"想刷"的理由，缺一不可（用户报的"升星率很低"就是只有第一条）：
   *   ① 钱多（`rerollFloor`）—— 常规运营；
   *   ② **手上有对子且钱够**（`pairRollGold`）—— 主动去找第三张。
   *      只看①的话，一局下来几乎攒不到 50 金，永远不刷新，
   *      于是一辈子都是 1 星。
   * ★ 架上有值得买的牌时**不刷**：那等于把刚要的东西刷掉。
   */
  private tryReroll(): boolean {
    if (this.rerollsThisRound >= this.tuning.maxRerolls) return false;
    const gold = this.state.economy.gold;
    const pairBonus = this.hasUpgradablePair() && gold >= this.tuning.pairRollGold;
    if (!pairBonus && gold < this.tuning.rerollFloor) return false;
    if (this.bestShopOffer()) return false; // 有值得买的，先买
    const result = doRefreshShop(this.state);
    if (!result.ok) return false;
    this.rerollsThisRound++;
    this.reportShopHeld();
    return true;
  }

  // ---- ④ 卖牌 ----

  private trySell(): boolean {
    if (!this.tuning.trims) return false;
    const bench = this.state.economy.bench;
    if (bench.length === 0) return false;
    /*
      ★★ 0.3.31 修（用户报"备战席一堆没有用的牌，也不卖掉"）：
      以前只在 `BENCH_SLOTS - 1`（8 张）时才考虑清，而且 40 分以下才卖 ——
      结果整局背着七八张垃圾牌，既占格子又让 `tryBuy` 一直被"备战席满"挡住。
      现在改成两档：
        · 5 张起就顺手清（`crowded`）——阈值 40，只清明显没用的；
        · 真的满了（9 张）——阈值放到 60，连"有点用但轮不到上场"的也清掉。
    */
    const crowded = bench.length >= 5;
    if (!crowded) return false;
    const isFull = bench.length >= BENCH_SLOTS;

    let worst: { uid: number; defId: string; star: number; score: number } | null = null;
    for (const unit of bench) {
      /*
        ★ 能升星的（手上同名 1 星已有 ≥2 张）**绝对不卖** —— 那是"再买一张就 2 星"的牌，
        卖了等于把已经投进去的两张废掉。
      */
      if (countOwned(this.state, unit.defId, 1) >= 2) continue;
      // ★ 用"买"的估值：卖的时候看的是"留着还有没有用"，不是"能不能上场"
      let score = this.buyScore(unit.defId) + (unit.star - 1) * 40;
      /*
        ★ 场上已经站着一只**同名**的 —— 这一张再加进来：
        羁绊按不同干员数人头（它不加），也不是对子（不参与升星），
        所以它基本只剩"备用"这一个用途，减一截让它优先被卖掉。
      */
      if (this.boardHasDef(unit.defId)) score -= 30;
      if (!worst || score < worst.score) worst = { uid: unit.uid, defId: unit.defId, star: unit.star, score };
    }
    if (!worst) return false;
    // 还有价值就先不卖（对子、能凑羁绊的都留着）
    if (worst.score >= (isFull ? 60 : 40)) return false;

    /*
      ★ 顺序和真人鼠标右键那条路**完全一致**：先告诉服务器"把这几张还回共享牌库"，
        再在本地把棋子摘掉。反过来的话（先本地卖）服务器那份还留着，
        淘汰回库时会多还一遍 —— 牌库凭空变多。
    */
    const copies = poolCopiesOfUnit(this.state.economy.bench.find((u) => u.uid === worst!.uid)!);
    if (copies > 0) this.write({ t: 'sellCard', defId: worst.defId, star: worst.star, copies });
    const result = doSellBench(this.state, worst.uid);
    return result.ok;
  }

  // ---- ⑤ 摆位 ----

  private tryPlace(): boolean {
    const bench = this.state.economy.bench;
    if (bench.length === 0) return false;

    /*
      ★★ 按 `placeScore` 排（不是按"买"的分数）：
        买的时候同名是加分（能升星），上场的时候同名是**减分**
        （羁绊按人头算，同名的第二只对羁绊零贡献）。
        用户报的"放的牌大部分是重复的"，就是以前这里用了买牌的分数。
    */
    const ordered = [...bench].sort((a, b) => this.placeScore(b) - this.placeScore(a));
    const candidate = ordered[0]!;
    /*
      ★ 备战席上最该上场的是一只"不值得上场"的牌（同名已经在场、或者纯杂鱼）——
        那就别硬塞，留给合成 / 卖掉。判据是绝对分：低于 15 基本等于"上去也是白给"。
    */
    if (this.tuning.traitAware && this.placeScore(candidate) < 15) return false;

    const cap = populationCap(this.state.economy.level);
    if (this.state.placements.length < cap) {
      const cell = this.pickCell(candidate.defId, null);
      if (!cell) return false;
      const result = placeBenchUnitAt(this.state, candidate.uid, cell);
      return result.ok;
    }

    /*
      场上满了 —— 普通 / 困难会拿"备战席上最强的"去顶掉"场上最弱的"。
      （简单档不干这事：它就是把先买到的按顺序摆上去。）
    */
    if (!this.tuning.traitAware) return false;
    let weakest: { uid: number; defId: string; star: number; cell: { col: number; row: number }; score: number } | null = null;
    for (const placement of this.state.placements) {
      const score = this.placeScore(placement);
      if (!weakest || score < weakest.score) {
        weakest = {
          uid: placement.uid,
          defId: placement.defId,
          star: placement.star,
          cell: { col: placement.cell.col, row: placement.cell.row },
          score,
        };
      }
    }
    if (!weakest) return false;
    if (this.placeScore(candidate) <= weakest.score + 10) return false; // 差不多就不折腾了

    const cell = this.pickCell(candidate.defId, weakest.cell);
    if (!cell) return false;
    recallFromBoard(this.state, weakest.cell);
    const result = placeBenchUnitAt(this.state, candidate.uid, cell);
    return result.ok;
  }

  // ---- ⑥ 用藏品（只有困难档会） ----

  /**
   * 把库里的藏品装上。
   *
   * 【为什么这件事重要？】
   * 藏品是**白拿的属性**，而且有两件事逼着你必须装：
   *   ① 「剑锤」这类**没装载就会在几回合后自己销毁**（`expireUnsocketedItems`）——
   *      不装等于每次掉落都白扔；
   *   ② 野怪回合的掉落占这个游戏相当一部分强度。
   * 用户报的"困难不会装备藏品"，就是这里根本没实现。
   *
   * 【怎么选目标？】
   *   · 穿戴藏品（A 类）→ 装到**场上评分最高**的干员身上，每只最多 2 件；
   *   · 共享藏品（B 类）→ 塞进共享装备位（空位优先；空位没有就用第 0 格换）。
   * 有效性一律交给 `equipItemToUnit` / `equipSharedItem` 判（星级要求、野怪不能穿、
   * 免升星彩蛋……全在那两个函数里），人机自己**不另写一份校验**。
   */
  private tryEquip(): boolean {
    if (!this.tuning.usesItems) return false;

    // ① 共享装备位（B 类）
    const freeEquip = this.state.items.bEquip.findIndex((itemId) => !itemId);
    if (freeEquip >= 0) {
      for (let slot = 0; slot < this.state.items.bSlots.length; slot++) {
        if (!this.state.items.bSlots[slot]) continue;
        if (equipSharedItem(this.state, slot, freeEquip).ok) return true;
      }
    }

    /*
      ② 干员身上的穿戴藏品（A 类）：场上优先，场上都装满了再装备战席。
      ★ 备战席也是合法目标（`findItemTarget` 认它，真人也能这么点）——
        开局第一回合场上通常一个人都没有，只认场上的话藏品要白等到第二回合，
        而「剑锤」那种"没装载会自己销毁"的藏品就在这段时间里过期了。
    */
    const boardTargets = [...this.state.placements].sort((a, b) => this.placeScore(b) - this.placeScore(a));
    const benchTargets = [...this.state.economy.bench].sort((a, b) => this.placeScore(b) - this.placeScore(a));
    const targets = [...boardTargets, ...benchTargets];
    if (targets.length === 0) return false;
    for (let slot = 0; slot < this.state.items.aSlots.length; slot++) {
      if (!this.state.items.aSlots[slot]) continue;
      for (const unit of targets) {
        if ((unit.items?.length ?? 0) >= ITEM_PER_UNIT) continue;
        if (equipItemToUnit(this.state, slot, unit.uid).ok) return true;
      }
    }
    return false;
  }

  /**
   * 给一个棋子挑格子。
   *
   * @param replace 要顶掉的那个格子（换人时优先占它）
   *
   * 【三档的区别就在这里】
   *   · `any`         —— 从后往前、从上往下一格一格塞（等于随便摆）；
   *   · `role`        —— 近战往前排（col 4/3）、远程往后排（col 0/1）；
   *   · `role+spread` —— 在 role 之上按"同一排别挤在一起"摊开，减少被范围技能一锅端。
   */
  private pickCell(defId: string, replace: { col: number; row: number } | null): { col: number; row: number } | null {
    const occupied = new Set(this.state.placements.map((p) => `${p.cell.col},${p.cell.row}`));
    if (replace) occupied.delete(`${replace.col},${replace.row}`);
    const free = (cell: { col: number; row: number }): boolean => !occupied.has(`${cell.col},${cell.row}`);

    if (replace && free(replace) && this.tuning.place !== 'any') return replace;

    const def = UNIT_DEFS[defId];
    const range = def?.base.range ?? 1;
    // 近战（射程 1）站前排，远程站后排，中间档站中间
    const frontCols = range <= 1 ? [TEAM_0_MAX_COL, TEAM_0_MAX_COL - 1, TEAM_0_MAX_COL - 2] : range >= 3 ? [0, 1, 2] : [2, 1, 3];
    const cols = this.tuning.place === 'any' ? [0, 1, 2, 3, TEAM_0_MAX_COL] : frontCols;

    // 行序：从中间往两边摊（中间的格子接敌最多也最安全，两侧容易被绕）
    const rows = this.tuning.place === 'role+spread'
      ? spreadRows(ARENA_H)
      : Array.from({ length: ARENA_H }, (_, index) => index);

    for (const col of cols) {
      for (const row of rows) {
        const cell = { col: Math.max(0, Math.min(TEAM_0_MAX_COL, col)), row };
        if (free(cell)) return cell;
      }
    }
    return null;
  }

  // ============================================================
  //  上报（= 客户端那些"静默同步"的消息）
  // ============================================================

  /** 把当前阵容同步给服务器（= 客户端的 syncTeamToServer） */
  private syncTeam(): void {
    if (!canEditTeam(this.state.phase)) return;
    const submitted: SubmittedTeam = toSubmittedTeam(this.state);
    const signature = JSON.stringify(submitted);
    if (signature !== this.lastTeamSignature) {
      this.lastTeamSignature = signature;
      this.write({ t: 'submitTeam', ...submitted });
    }
    this.reportShopHeld();
  }

  /** 上报"我商店里摆着哪些牌"（服务器靠它避免把同一张牌发给两个人） */
  private reportShopHeld(): void {
    const ids = this.state.economy.shop.filter((slot) => !slot.sold && slot.defId).map((slot) => slot.defId);
    const signature = ids.join('|');
    if (signature === (this.lastShopHeld ?? []).join('|')) return;
    this.lastShopHeld = ids;
    this.write({ t: 'shopUpdate', defIds: ids });
  }

  /** 上报等级 / 连胜（纯展示，玩家列表要显示） */
  private reportStats(): void {
    const level = this.state.economy.level;
    const streak = this.state.economy.streak;
    const signature = `${level}:${streak}`;
    if (signature === this.lastStats) return;
    this.lastStats = signature;
    this.write({ t: 'playerStats', level, streak });
  }

  /** 给测试 / 调试用：现在自己的人机状态 */
  debugSnapshot(): {
    level: number;
    gold: number;
    board: number;
    bench: number;
    difficulty: BotDifficulty;
    round: number;
    phase: string;
  } {
    return {
      level: this.state.economy.level,
      gold: this.state.economy.gold,
      board: this.state.placements.length,
      bench: this.state.economy.bench.length,
      difficulty: this.difficulty,
      round: this.round,
      phase: this.state.phase,
    };
  }
}

/**
 * 行序：从棋盘中间往两边排。
 *
 * 【为什么要这么排？】中间几行是"主战场"（对手也往中间站），
 * 把棋子摊在最外两行的结果是对面直接从中间穿过去打后排。
 * 从中间往外铺，同时天然错开行 —— 范围技能一次打死一片的概率就小了。
 */
function spreadRows(height: number): number[] {
  const mid = Math.floor(height / 2);
  const rows: number[] = [];
  for (let offset = 0; offset < height; offset++) {
    const up = mid + offset;
    const down = mid - offset;
    if (offset === 0) rows.push(mid);
    else {
      if (down >= 0) rows.push(down);
      if (up < height) rows.push(up);
    }
  }
  return rows;
}

/**
 * 难度提示文案（大厅里鼠标悬停用，和服务端同一份）。
 * ★ 放在这里而不是客户端，是为了"改一句提示不用动界面代码"。
 */
export function botHint(difficulty: BotDifficulty): string {
  return BOT_DIFFICULTY_INFO[difficulty]?.hint ?? '';
}
