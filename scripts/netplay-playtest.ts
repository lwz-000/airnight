/**
 * ============================================================
 *  联机自动对局测试台（多客户端）
 * ============================================================
 *
 * 【为什么需要它？】
 * 你只有一个人，没法开 4 个浏览器标签页自己跟自己打，
 * 而"联机的问题"恰恰只有**真跑一局**才会暴露：
 * 单看代码、或者只连一个客户端，永远发现不了"两边看到的东西不一样"。
 *
 * 这个脚本会：
 *   1. 真的启动游戏服务器（随机端口，不占用你的 8787）
 *   2. 真的开 N 个 WebSocket 连接，各自建房 / 加入 / 准备 / 提交阵容
 *   3. 模拟每个客户端**真的把战斗播一遍**（按 ticks 算时长，可以故意放慢）
 *   4. 记录每条消息的到达时刻，然后回答这几个问题：
 *        · 有没有哪个客户端"还没播完战斗"就被拉进下一回合？（= 跳过战斗过程）
 *        · 各客户端看到的回合数、血量、胜负一致吗？（= 双端不同步）
 *        · 这回合谁打谁？（= 配对规则）
 *        · 输了扣多少血？（= 掉血规则）
 *
 * 用法：
 *   node node_modules/tsx/dist/cli.mjs scripts/netplay-playtest.ts
 *   node ... scripts/netplay-playtest.ts --players 4 --rounds 6
 *   node ... scripts/netplay-playtest.ts --players 2 --slow 1.6   # 模拟"有个朋友电脑卡"
 *
 * 参数：
 *   --players N   人数（默认 4）
 *   --rounds N    最多打到第几回合（默认 6）
 *   --slow X      本地回放速度系数（默认 1）。>1 表示这台机器播得比真实时间慢，
 *                 用来模拟"帧率低于 20fps 的弱电脑"：主循环把单帧步长 cap 在
 *                 0.05 秒（`Math.min(0.05, dt)`），所以帧率一低于 20fps，
 *                 回放就追不上服务器的墙钟 —— 这不是假想，是真实会发生的情况。
 *   --quiet       少打点日志
 */
import { WebSocket } from 'ws';
import {
  COVENANTS,
  TICKS_PER_SECOND,
  SERVER_VERSION,
  UNIT_DEFS,
  damageForRound,
  decodeMessage,
  simulate,
  type ClientMessage,
  type RoomView,
  type ServerMessage,
  type UnitPlacement,
} from '../packages/shared/src/index.js';

process.env.AIRNIGHT_NO_AUTOSTART = '1';
/*
  ★ 布阵现在是 60 秒定时制（时间不到就不开打）。
  测试台要跑好几个回合，真等 60 秒的话一次要十几分钟。
  所以把服务端的布阵时长调短 —— 它读的就是这个环境变量，
  生产环境不设它时仍然是 60 秒。
*/
process.env.AIRNIGHT_PREP_SECONDS = '3';
const { startServer } = await import('../packages/server/src/main.js');

// ---------------- 参数 ----------------
const argv = process.argv.slice(2);
function arg(name: string, fallback: number): number {
  const hit = argv.find((item) => item.startsWith(`--${name}=`));
  if (hit) return Number(hit.slice(name.length + 3));
  const index = argv.indexOf(`--${name}`);
  if (index >= 0 && argv[index + 1] && !argv[index + 1]!.startsWith('--')) return Number(argv[index + 1]);
  return fallback;
}
const PLAYER_COUNT = Math.max(2, Math.min(8, arg('players', 4)));
const MAX_ROUNDS = Math.max(1, arg('rounds', 6));
const SLOW = Math.max(0.1, arg('slow', 1));
const QUIET = argv.includes('--quiet');
/**
 * 用**旧客户端**的有毛病的逻辑来跑（每收到一条 battleStart 就 load 一遍）。
 * 用来复现"多人时播的是别人的战斗"这个问题。
 */
const FAITHFUL_OLD_CLIENT = argv.includes('--old-client');
/**
 * `--afk N`：让第 N 个客户端**永远不发"我看完了"**，
 * 模拟"有人切到别的窗口发呆 / 客户端版本太老"。
 * 用来验证兜底超时真的会救场 —— 不然全房间会永远卡在结算画面。
 */
const AFK_INDEX = arg('afk', 0);

const C = {
  reset: '\u001b[0m',
  dim: '\u001b[2m',
  green: '\u001b[32m',
  cyan: '\u001b[36m',
  yellow: '\u001b[33m',
  red: '\u001b[31m',
  bold: '\u001b[1m',
};

/**
 * 阵容：所有人提交**同一个一星一费干员**。
 *
 * 【为什么故意这么"无聊"？】
 * 这个测试台要连打好几个回合，所以战斗必须短。而镜像阵容（两边完全一样）
 * 的战斗时长只跟棋子本身的数值有关，跟星级无关 —— 双方一起变强，比值不变，
 * 所以只能靠"一个一星一费干员"把时长压到 7 秒左右
 * （两个两星一费要打 29 秒，跑 6 回合就得好几分钟）。
 *
 * 镜像 + 每场种子不同 = 胜负由 tick 抖动决定、每回合都不一样，
 * 正好能覆盖"掉血 / 淘汰 / 轮转配对"这些要验的东西。
 *
 * 棋子 id 从 UNIT_DEFS 里按费用挑，不写死具体名字。
 */
const cheapIds = Object.values(UNIT_DEFS)
  .filter((def) => def.cost === 1 && !def.summonOnly)
  .map((def) => def.id)
  .sort();

function teamFor(_seedOffset: number): UnitPlacement[] {
  return [{ defId: cheapIds[0]!, star: 1, cell: { col: 3, row: 4 } }];
}

interface Fight {
  round: number;
  battleId: string;
  opponentId: string;
  myTeam: 0 | 1;
  winner: 0 | 1 | null;
  ticks: number;
  startedAt: number;
  replayEndsAt: number;
  dodge: string;
}

/** 一个"会真的把战斗播一遍"的假客户端 */
class Player {
  socket: WebSocket;
  playerId = '';
  /** 本地回放播完的时刻（墙钟毫秒）；0 表示当前没在播 */
  busyUntil = 0;
  /** 正在播的那一场 */
  playing: Fight | null = null;
  fights: Fight[] = [];
  roomCode = '';
  room: RoomView | null = null;
  round = 0;
  /** 从 battleEnd 收到的血量 */
  hp = 100;
  eliminated = false;
  /** 这一回合收到了几场别人的战斗（旁观） */
  spectated = 0;
  /** 这个客户端是不是故意的挂机者（不回执） */
  afk = false;
  errors: string[] = [];
  private submittedRound = 0;

  constructor(port: number, public readonly label: string, public readonly index: number) {
    this.socket = new WebSocket(`ws://127.0.0.1:${port}`);
    this.socket.on('message', (raw) => {
      const message = decodeMessage<ServerMessage>(raw.toString());
      if (!message) return;
      try {
        this.onMessage(message);
      } catch (error) {
        this.errors.push(`处理 ${message.t} 出错: ${String(error)}`);
      }
    });
  }

  private onMessage(message: ServerMessage): void {
    switch (message.t) {
      case 'welcome':
        this.playerId = message.playerId;
        break;

      case 'room':
        this.room = message.room;
        this.roomCode = message.room.code;
        /*
          ★ 0.3：盟约选秀。默认房间是开着盟约的，测试台不选的话会一直卡在
          `phase === 'covenant'`（服务器等每个人选完才开局）。
          轮到自己的时候从**还没被选走**的里面挑第一个 —— 顺序固定、可复现。
        */
        if (message.room.phase === 'covenant' && message.room.covenant?.currentPlayerId === this.playerId) {
          const taken = new Set(message.room.players.map((player) => player.covenantId).filter(Boolean));
          const pick = COVENANTS.find((covenant) => !taken.has(covenant.id));
          if (pick) this.send({ t: 'pickCovenant', covenantId: pick.id });
        }
        // 准备阶段就提交阵容（全员提交 -> 不用干等 30 秒）
        if (message.room.phase === 'prep' && this.roomCode) {
          const me = message.room.players.find((p) => p.id === this.playerId);
          if (me && me.hp > 0 && this.submittedRound !== message.room.round) {
            this.submittedRound = message.room.round;
            setTimeout(() => this.send({ t: 'submitTeam', units: teamFor(this.index) }), 20 + this.index * 15);
          }
        }
        break;

      case 'gameStarted': {
        /*
          ★ 核心检查 1：收到「下一回合开始」时，我这边上一场战斗播完了没有？
          没播完就说明服务器没等我 —— 玩家看到的就是"战斗被跳过 / 演到一半被拉走"。
        */
        const now = Date.now();
        if (this.playing && now < this.playing.replayEndsAt) {
          const cutMs = this.playing.replayEndsAt - now;
          this.playing.dodge = `被提前 ${(cutMs / 1000).toFixed(1)} 秒拉走`;
          this.errors.push(
            `第 ${message.round} 回合开始时，我的第 ${this.playing.round} 回合战斗还差 ${(cutMs / 1000).toFixed(1)} 秒才播完（战斗被截断）`,
          );
        }
        this.playing = null;
        this.busyUntil = 0;
        this.round = message.round;
        break;
      }

      case 'battleStart': {
        /*
          这里**刻意照抄真实客户端的处理逻辑**（包括它的毛病），
          这样测试台才能发现"客户端接线错了"这类问题。
          真实客户端原来的写法是：每收到一条 battleStart 就 load 一遍，
          后收到的**覆盖**先收到的。
          4 个人以上时一回合有多场战斗、而且会全部广播给所有人 ——
          于是玩家最后播的是**别人的**战斗。

          `--faithful` 打开时按旧逻辑走（用来复现问题），
          默认按修好之后的逻辑走（只播自己那一场）。
        */
        const amIPlaying = message.team0PlayerId === this.playerId || message.team1PlayerId === this.playerId;
        if (FAITHFUL_OLD_CLIENT) {
          // 旧逻辑：不管是不是自己的，照单全收
        } else {
          // 新逻辑：已经在播自己的战斗时，别人的战斗一律忽略
          if (this.playing && !amIPlaying) break;
        }
        if (!amIPlaying) {
          // 旁观别人的战斗：记一笔，但不算"我的战斗"
          this.spectated += 1;
          if (FAITHFUL_OLD_CLIENT) {
            this.errors.push(
              `收到了别人的战斗 ${message.battleId}（${message.team0PlayerId} vs ${message.team1PlayerId}），` +
                '而旧客户端会把它当成自己的播 —— 这样我看到的就不是我的战斗了',
            );
          }
          break;
        }
        const myTeam: 0 | 1 = message.team1PlayerId === this.playerId ? 1 : 0;
        // 和真客户端一样：本地重放一遍，拿真实时长和校验和
        const local = simulate(UNIT_DEFS, [message.team0, message.team1], message.seed);
        if (local.checksum !== message.expectedChecksum) {
          this.errors.push(`校验和不一致（战斗 ${message.battleId}）`);
        }
        const replayMs = (local.ticks / TICKS_PER_SECOND) * 1000 * SLOW;
        const fight: Fight = {
          round: this.round,
          battleId: message.battleId,
          opponentId: myTeam === 0 ? message.team1PlayerId : message.team0PlayerId,
          myTeam,
          winner: local.winner,
          ticks: local.ticks,
          startedAt: Date.now(),
          replayEndsAt: Date.now() + replayMs,
          dodge: '',
        };
        this.fights.push(fight);
        this.playing = fight;
        this.busyUntil = fight.replayEndsAt;
        /*
          ★ 核心检查 2：播完之后告诉服务器「我看完了」。
          服务器靠这个回执决定什么时候进下一回合（而不是自己猜一个时间）。
          `--afk` 指定的那个客户端故意不发，用来验证兜底超时。
        */
        if (this.index + 1 === AFK_INDEX) {
          this.errors.push(`（我故意不回执，模拟挂机；这不算 bug）`);
          this.afk = true;
        } else {
          setTimeout(() => {
            this.send({ t: 'playbackDone', battleId: fight.battleId });
          }, replayMs);
        }
        break;
      }

      case 'battleEnd': {
        const mine = message.hpAfter[this.playerId];
        if (typeof mine === 'number') this.hp = mine;
        break;
      }

      case 'playerEliminated':
        if (message.playerId === this.playerId) this.eliminated = true;
        break;

      case 'error':
        this.errors.push(`服务器报错 ${message.code}: ${message.message}`);
        break;

      default:
        break;
    }
  }

  send(message: ClientMessage): void {
    // ★ 0.1.3：服务端会校验版本，不带 version 的建房/进房会被直接拒绝
    const outgoing =
      message.t === 'createRoom' || message.t === 'joinRoom'
        ? { ...message, version: SERVER_VERSION }
        : message;
    if (this.socket.readyState === 1) this.socket.send(JSON.stringify(outgoing));
  }

  async ready(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.socket.once('open', () => resolve());
      this.socket.once('error', reject);
    });
  }

  close(): void {
    this.socket.close();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const handle = startServer(0, '127.0.0.1');
  if (!handle.wss.address()) {
    await new Promise<void>((resolve) => handle.wss.once('listening', () => resolve()));
  }
  const address = handle.wss.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  console.log(`\n${C.bold}=== 联机自动对局测试台 ===${C.reset}`);
  console.log(
    `${C.dim}端口 ${port} · ${PLAYER_COUNT} 人 · 最多 ${MAX_ROUNDS} 回合 · 回放速度系数 ${SLOW}${C.reset}\n`,
  );

  const players: Player[] = [];
  for (let i = 0; i < PLAYER_COUNT; i++) players.push(new Player(port, `P${i + 1}`, i));
  await Promise.all(players.map((p) => p.ready()));
  console.log(`${C.green}✓${C.reset} ${PLAYER_COUNT} 个客户端已连接`);

  // ---- 建房 + 加入 ----
  players[0]!.send({ t: 'createRoom', playerName: 'P1' });
  for (let i = 0; i < 100 && !players[0]!.roomCode; i++) await sleep(20);
  if (!players[0]!.roomCode) throw new Error('房主没拿到房间码');
  const code = players[0]!.roomCode;
  for (let i = 1; i < players.length; i++) {
    players[i]!.send({ t: 'joinRoom', roomCode: code, playerName: `P${i + 1}` });
    await sleep(50);
  }
  await sleep(200);
  console.log(`${C.green}✓${C.reset} 房间 ${C.yellow}${code}${C.reset} 共 ${players[0]!.room?.players.length ?? '?'} 人`);

  // ---- 准备 + 开局 ----
  for (let i = 1; i < players.length; i++) players[i]!.send({ t: 'setReady', ready: true });
  await sleep(150);
  for (const p of players) {
    p.fights = [];
    p.errors = [];
  }
  players[0]!.send({ t: 'startGame' });

  // ---- 跑到 MAX_ROUNDS 或者有人出错 ----
  const startedAt = Date.now();
  let lastRound = 0;
  const roundLog: { round: number; pairs: string[]; hp: Record<string, number> }[] = [];

  while (Date.now() - startedAt < 10 * 60 * 1000) {
    await sleep(100);
    const anyError = players.some((p) => p.errors.some((e) => !e.includes('故意不回执')));
    if (anyError) break;
    if (players[0]!.round > lastRound) {
      lastRound = players[0]!.round;
      const hp: Record<string, number> = {};
      for (const p of players) hp[p.label] = p.hp;
      roundLog.push({ round: lastRound, pairs: [], hp });
      if (!QUIET) {
        console.log(
          `${C.cyan}第 ${lastRound} 回合${C.reset}  ` +
            players.map((p) => `${p.label}:${p.hp}血`).join('  '),
        );
      }
    }
    // 这一回合所有参战的人都播完了、并且已经有人被淘汰或打满回合数 -> 收工
    if (lastRound >= MAX_ROUNDS) break;
    if (players.filter((p) => !p.eliminated).length <= 1) break;
  }

  // ---------------- 汇总 ----------------
  console.log(`\n${C.bold}=== 汇总 ===${C.reset}`);

  console.log(`\n${C.bold}① 配对（每回合谁打谁）${C.reset}`);
  for (const round of [...new Set(players.flatMap((p) => p.fights.map((f) => f.round)))].sort((a, b) => a - b)) {
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const p of players) {
      const fight = p.fights.find((f) => f.round === round);
      if (!fight) {
        lines.push(`${p.label}：轮空`);
        continue;
      }
      // 用排序过的 key 去重，避免同一场打印两遍
      const other = players.find((q) => q.playerId === fight.opponentId);
      const key = [p.label, other?.label ?? fight.opponentId].sort().join(' vs ');
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(
        `${key}  ${C.dim}(${fight.winner === null ? '平局' : fight.winner === fight.myTeam ? `${p.label} 胜` : `${other?.label ?? '?'} 胜`}, ${(fight.ticks / TICKS_PER_SECOND).toFixed(1)}s)${C.reset}`,
      );
    }
    console.log(`  第 ${round} 回合：${lines.join(' · ')}`);
  }

  console.log(`\n${C.bold}② 战斗有没有被截断${C.reset}`);
  const dodgeErrors = players.flatMap((p) =>
    p.errors.filter((e) => e.includes('截断')).map((e) => `[${p.label}] ${e}`),
  );
  if (dodgeErrors.length === 0) {
    console.log(`  ${C.green}✓ 没有任何客户端在战斗中被打断${C.reset}`);
  } else {
    for (const e of dodgeErrors) console.log(`  ${C.red}✗ ${e}${C.reset}`);
  }

  if (AFK_INDEX > 0) {
    const afkPlayer = players[AFK_INDEX - 1];
    console.log(`\n${C.bold}②b 挂机兜底${C.reset}`);
    console.log(
      `  ${C.dim}${afkPlayer?.label} 故意不回执。服务器应该等兜底超时后自己推进，` +
        `而不是让全房间永远卡住。${C.reset}`,
    );
    const advanced = (players[0]?.round ?? 0) >= MAX_ROUNDS;
    console.log(
      advanced
        ? `  ${C.green}✓ 兜底生效：房间还是推进到了第 ${players[0]?.round} 回合${C.reset}`
        : `  ${C.red}✗ 房间卡住了（停在第 ${players[0]?.round} 回合）${C.reset}`,
    );
  }

  console.log(`\n${C.bold}③ 各客户端看到的状态一致吗${C.reset}`);
  const rounds = players.map((p) => p.round);
  const sameRound = rounds.every((r) => r === rounds[0]);
  console.log(`  各自停在第几回合：${players.map((p) => `${p.label}=${p.round}`).join('  ')}`);
  console.log(
    sameRound
      ? `  ${C.green}✓ 一致${C.reset}`
      : `  ${C.red}✗ 不一致 —— 有人被落下了${C.reset}`,
  );
  // 同一场战斗，两边算出的胜者必须一致
  let winnerMismatch = 0;
  for (const a of players) {
    for (const b of players) {
      if (a.index >= b.index) continue;
      for (const fa of a.fights) {
        const fb = b.fights.find((f) => f.battleId === fa.battleId);
        if (fb && fb.winner !== fa.winner) winnerMismatch++;
      }
    }
  }
  console.log(
    winnerMismatch === 0
      ? `  ${C.green}✓ 同一场战斗，两边的胜负判定完全一致${C.reset}`
      : `  ${C.red}✗ 有 ${winnerMismatch} 场战斗两边判定不一致${C.reset}`,
  );

  console.log(`\n${C.bold}④ 血量与掉血规则${C.reset}`);
  for (const p of players) {
    const lost = p.fights.filter((f) => f.winner !== null && f.winner !== f.myTeam).length;
    console.log(`  ${p.label}  hp=${String(p.hp).padStart(3)}  参战 ${p.fights.length} 场  败 ${lost} 场`);
  }
  console.log(`  ${C.dim}规则核对：${[1, 5, 6, 10, 11, 15].map((r) => `第${r}回合→${damageForRound(r)}血`).join('  ')}${C.reset}`);

  const otherErrors = players.flatMap((p) =>
    p.errors
      .filter((e) => !e.includes('截断') && !e.includes('故意不回执'))
      .map((e) => `[${p.label}] ${e}`),
  );
  if (otherErrors.length > 0) {
    console.log(`\n${C.bold}⑤ 其它问题${C.reset}`);
    for (const e of otherErrors) console.log(`  ${C.red}✗ ${e}${C.reset}`);
  }

  for (const p of players) p.close();
  handle.close();

  const failed = dodgeErrors.length > 0 || !sameRound || winnerMismatch > 0 || otherErrors.length > 0;
  console.log(
    failed
      ? `\n${C.red}${C.bold}=== 发现问题 ===${C.reset}\n`
      : `\n${C.green}${C.bold}=== 全部通过 ===${C.reset}\n`,
  );
  if (failed) process.exitCode = 1;
}

await main();
