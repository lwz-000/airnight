/**
 * 联机全流程冒烟测试（独立脚本，不依赖测试框架）
 *
 * 这个脚本做的事：真的起一个服务器，真的开两个 WebSocket 连接，
 * 完整走一遍玩家会经历的全部流程，并把每一步打印出来 ——
 * 你能亲眼看到「服务端广播种子 → 两边的客户端各自重放 → 校验和一致」这条链路。
 *
 * 用法：
 *   node node_modules/tsx/dist/cli.mjs scripts/netplay-smoke.ts
 */
import { WebSocket } from 'ws';
import {
  SERVER_VERSION,
  UNIT_DEFS,
  decodeMessage,
  simulate,
  type ClientMessage,
  type ServerMessage,
  type UnitPlacement,
} from '../packages/shared/src/index.js';

// 让服务器在本脚本里以随机端口启动
process.env.AIRNIGHT_NO_AUTOSTART = '1';
/*
  ★ 布阵时长压到 2 秒。
  【为什么必须设？】布阵已经改成**定时制**了 —— 时间不到就不开打，
  没有"全员提交就提前开始"这回事。不设这个变量，脚本会真等满 60 秒，
  而它等 battleStart 只等 10 秒 —— 表现为"等待 battleStart 超时"，
  看起来像服务器坏了，其实只是这个脚本还停留在旧规则上。
  （必须在 import 服务器模块**之前**设：那个模块在加载时就把值读走了。）
*/
process.env.AIRNIGHT_PREP_SECONDS ??= '2';
const { startServer } = await import('../packages/server/src/main.js');

const COLORS = {
  reset: '\u001b[0m',
  dim: '\u001b[2m',
  green: '\u001b[32m',
  cyan: '\u001b[36m',
  yellow: '\u001b[33m',
  red: '\u001b[31m',
  magenta: '\u001b[35m',
};

let step = 0;
function log(text: string, color = COLORS.reset): void {
  step++;
  console.log(`${color}${String(step).padStart(2, ' ')}. ${text}${COLORS.reset}`);
}

/** 极简测试客户端：记住所有收到的消息，支持按类型等待 */
class Probe {
  socket: WebSocket;
  playerId = '';
  labels: string[] = [];
  private messages: ServerMessage[] = [];

  constructor(port: number, public readonly label: string) {
    this.socket = new WebSocket(`ws://127.0.0.1:${port}`);
    this.socket.on('message', (raw) => {
      const message = decodeMessage<ServerMessage>(raw.toString());
      if (!message) return;
      this.messages.push(message);
      if (message.t === 'welcome') this.playerId = message.playerId;
    });
  }

  async ready(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.socket.once('open', () => resolve());
      this.socket.once('error', reject);
    });
  }

  send(message: ClientMessage): void {
    // ★ 0.1.3：服务端会校验版本，不带 version 的建房/进房会被直接拒绝
    const outgoing =
      message.t === 'createRoom' || message.t === 'joinRoom'
        ? { ...message, version: SERVER_VERSION }
        : message;
    this.socket.send(JSON.stringify(outgoing));
  }

  async waitFor<T extends ServerMessage['t']>(
    type: T,
    timeoutMs = 8000,
    predicate?: (message: Extract<ServerMessage, { t: T }>) => boolean,
  ): Promise<Extract<ServerMessage, { t: T }>> {
    const started = Date.now();
    for (;;) {
      // 必须同时满足「类型对」和「内容符合预期」。
      // 只按类型匹配会读到旧的房间状态广播，导致打印出来的信息和实际不符 ——
      // 诊断工具说谎比崩溃更糟糕。
      const found = this.messages.find(
        (m) => m.t === type && (!predicate || predicate(m as Extract<ServerMessage, { t: T }>)),
      );
      if (found) return found as Extract<ServerMessage, { t: T }>;
      if (Date.now() - started > timeoutMs) {
        throw new Error(`[${this.label}] 等待 ${type} 超时`);
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  /** 清空收件箱，方便等待「新的」某类消息 */
  clear(): void {
    this.messages = [];
  }

  close(): void {
    this.socket.close();
  }
}

const handle = startServer(0, '127.0.0.1');
if (!handle.wss.address()) {
  await new Promise<void>((resolve) => handle.wss.once('listening', () => resolve()));
}
const address = handle.wss.address();
const port = typeof address === 'object' && address ? address.port : 0;

console.log(`\n${COLORS.cyan}=== AIRNIGHT 联机全流程冒烟测试 ===${COLORS.reset}`);
console.log(`${COLORS.dim}服务器已在随机端口 ${port} 启动${COLORS.reset}\n`);

const team: UnitPlacement[] = [
  { defId: 'op01', star: 2, cell: { col: 3, row: 2 } },
  { defId: 'op03', star: 1, cell: { col: 1, row: 1 } },
  { defId: 'op09', star: 1, cell: { col: 1, row: 3 } },
  { defId: 'op13', star: 1, cell: { col: 0, row: 5 } },
];

try {
  const host = new Probe(port, '房主');
  const guest = new Probe(port, '朋友');
  await host.ready();
  await guest.ready();
  log(`两个客户端已连上服务器`, COLORS.green);
  console.log(`   ${COLORS.dim}房主 id = ${host.playerId}${COLORS.reset}`);
  console.log(`   ${COLORS.dim}朋友 id = ${guest.playerId}${COLORS.reset}`);

  // ---- 建房 ----
  host.send({ t: 'createRoom', playerName: '小明' });
  const room1 = await host.waitFor('room');
  log(`房主建了房间，房间码 ${COLORS.yellow}${room1.room.code}${COLORS.reset}`);
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(room1.room.code)) {
    throw new Error(`房间码格式不对: ${room1.room.code}`);
  }

  // ---- 加入 ----
  guest.send({ t: 'joinRoom', roomCode: room1.room.code, playerName: '小红' });
  const room2 = await host.waitFor('room', 8000, (m) => m.room.players.length === 2);
  const names = room2.room.players.map((p) => p.name).join('、');
  log(`朋友用房间码进来了，房间现在有 ${room2.room.players.length} 人：${names}`);

  // ---- 准备 ----
  guest.send({ t: 'setReady', ready: true });
  await host.waitFor('room', 8000, (m) => m.room.players.some((p) => p.ready));
  log(`朋友点了「准备好了」`);

  // ---- 开局 ----
  host.clear();
  guest.clear();
  host.send({ t: 'startGame' });
  await host.waitFor('gameStarted');
  log(`房主开局，进入第 1 回合准备阶段`, COLORS.green);

  const prep = await host.waitFor('room', 8000, (m) => m.room.phase === 'prep');
  log(
    `房间状态：阶段=${prep.room.phase} 回合=${prep.room.round} 倒计时=${prep.room.prepSecondsLeft} 秒`,
  );

  // ---- 提交阵容 ----
  host.send({ t: 'submitTeam', units: team });
  guest.send({ t: 'submitTeam', units: team });
  log(`双方各提交了 ${team.length} 个棋子（布阵是定时制，等服务器到点自动开打）`);

  // ---- 收到战斗广播 ----
  host.clear();
  guest.clear();
  const battle = await host.waitFor('battleStart', 10000);
  log(`★ 服务器广播了战斗：`, COLORS.magenta);
  console.log(`   seed              = ${battle.seed}`);
  console.log(`   battleId          = ${battle.battleId}`);
  console.log(`   队伍0 玩家         = ${battle.team0PlayerId}`);
  console.log(`   队伍1 玩家         = ${battle.team1PlayerId}`);
  console.log(`   期望校验和         = 0x${battle.expectedChecksum.toString(16).toUpperCase()}`);
  console.log(
    `   ${COLORS.dim}这段广播只有 ${JSON.stringify(battle).length} 字节 —— 整场战斗就靠它重放${COLORS.reset}`,
  );

  // ---- 镜像验证 ----
  const cols0 = battle.team0.units.map((u) => u.cell.col);
  const cols1 = battle.team1.units.map((u) => u.cell.col);
  log(`站位镜像检查：`);
  console.log(`   队伍0 的列 = [${cols0.join(', ')}]  ${cols0.every((c) => c <= 3) ? COLORS.green + '✓ 全在左半边' : COLORS.red + '✗ 越界'}${COLORS.reset}`);
  console.log(`   队伍1 的列 = [${cols1.join(', ')}]  ${cols1.every((c) => c >= 4) ? COLORS.green + '✓ 全在右半边（已镜像）' : COLORS.red + '✗ 越界'}${COLORS.reset}`);

  // ---- 视角判定 ----
  const hostIsTeam0 = battle.team0PlayerId === host.playerId;
  log(`客户端视角判定（决定要不要把画面左右翻转）：`);
  console.log(`   房主 = ${hostIsTeam0 ? '队伍0（不用翻转）' : '队伍1（需要翻转，让自己的棋子在左下角）'}`);
  console.log(`   朋友 = ${hostIsTeam0 ? '队伍1（需要翻转）' : '队伍0（不用翻转）'}`);

  // ---- ★ 两边各自重放，比对校验和 ----
  log(`★ 两个客户端各自用同一个种子重放整场战斗：`, COLORS.cyan);
  const replayHost = simulate(UNIT_DEFS, [battle.team0, battle.team1], battle.seed);
  const replayGuest = simulate(UNIT_DEFS, [battle.team0, battle.team1], battle.seed);

  const checks = [
    ['服务器', battle.expectedChecksum],
    ['房主本地', replayHost.checksum],
    ['朋友本地', replayGuest.checksum],
  ] as const;

  for (const [who, checksum] of checks) {
    const ok = checksum === battle.expectedChecksum;
    console.log(
      `   ${who.padEnd(10, ' ')} 0x${checksum.toString(16).toUpperCase().padStart(8, '0')}  ` +
        `${ok ? COLORS.green + '✓ 一致' : COLORS.red + '✗ 不一致'}${COLORS.reset}`,
    );
  }

  if (replayHost.checksum !== battle.expectedChecksum || replayGuest.checksum !== battle.expectedChecksum) {
    throw new Error('校验和不一致 —— 确定性被破坏了！');
  }
  log(`校验和完全一致 —— 三台机器算出的是同一场战斗`, COLORS.green);

  // ---- 战斗结果 ----
  const end = await host.waitFor('battleEnd', 10000);
  log(`战斗结束：胜者 = ${end.winner === null ? '平局' : `队伍${end.winner}`}，用时 ${replayHost.ticks} tick = ${(replayHost.ticks / 20).toFixed(1)} 秒`);
  console.log(`   ${COLORS.dim}败者扣血 ${end.damageToLoser}，剩余血量 ${JSON.stringify(end.hpAfter)}${COLORS.reset}`);

  // ---- 广播大小对比（这是这套联机方案最大的优势）----
  log(`网络流量对比：`, COLORS.yellow);
  const broadcastBytes = JSON.stringify(battle).length;
  const engineLogBytes = JSON.stringify(replayHost.log).length;
  console.log(`   如果同步整条战斗过程（${replayHost.log.length} 条事件）  = ${(engineLogBytes / 1024).toFixed(1)} KB`);
  console.log(`   实际只广播「种子 + 阵容」            = ${(broadcastBytes / 1024).toFixed(2)} KB`);
  console.log(
    `   ${COLORS.green}省了 ${(engineLogBytes / broadcastBytes).toFixed(0)} 倍 —— 而且战斗越复杂（棋子越多、技能越花）省得越多${COLORS.reset}`,
  );

  host.close();
  guest.close();
  console.log(`\n${COLORS.green}=== 全流程通过 ===${COLORS.reset}\n`);
} catch (error) {
  console.error(`\n${COLORS.red}=== 失败 ===${COLORS.reset}`);
  console.error(error);
  process.exitCode = 1;
} finally {
  handle.close();
}
