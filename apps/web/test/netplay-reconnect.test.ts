/**
 * ============================================================
 *  ★★ 0.2.1：断线重连的"没有任何反应"是怎么来的
 * ============================================================
 *
 * 【用户报的】
 * 「目前大部分重连尝试没有任何反应。从理论上讲，令牌仍保留在程序中，
 *   应当始终可以完成重连。」
 *
 * 【排查结论：不是令牌的问题，是**连接层会静默卡死**】
 * 令牌一直在，`resume` 协议也是好的（服务端 BAD_TOKEN / NO_SEAT / resumeState
 * 三条路都会回话）。真正的问题是「重连引擎」在下面四种情况下会**停摆**，
 * 而且每一种都**不报错、不提示、不重试**，玩家看到的就是"点了没反应"：
 *
 *  ① **`connect()` 对 CONNECTING 状态静默早退，且没有连接超时**
 *     浏览器建连如果撞上"地址黑洞"（隧道挂了 / 机器睡了 / 换了网），
 *     `new WebSocket()` 会长时间停在 CONNECTING（要等操作系统 TCP 超时，几十秒起）。
 *     这期间**每一次重试都是空转**：`connect()` 一看 readyState 是 CONNECTING 就 return。
 *  ② **心跳判死之后只 `socket.close()`，不安排重连**
 *     半死连接（休眠唤醒 / NAT 表项过期）收不到 FIN，close 事件可能几分钟都不来；
 *     而"重排重连"只写在 close 回调里 ⇒ 心跳再响一百次也不会重连。
 *  ③ **旧 socket 的 close 会污染新连接**
 *     事件处理器不检查"这个 socket 还是不是当前那条"，
 *     于是旧连接迟到的 close 会把 `connected` 打成 false、把 `room` 清空、
 *     把新连接的心跳停掉 —— 明明连着，界面却永远停在"正在重连"。
 *  ④ **socket 开着但身份没换回来时，"立即重试"是空操作**
 *     `resume` 发出去服务器没回应（异常 / 半开连接）时，
 *     界面停在重同步浮层，玩家点「立即重试」→ `retryResume()` → `connect()`
 *     → 因为 readyState 是 OPEN **直接早退**。按钮点一百次也没用。
 *
 * 这一组测试就是把这四条逐条钉住（每条都先用"现在的行为"跑红）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONNECT_TIMEOUT_MS,
  HEARTBEAT_MS,
  MAX_MISSED_HEARTBEATS,
  NetplayClient,
  RESUME_ANSWER_TIMEOUT_MS,
} from '../src/net/netplay-client.js';

/**
 * 假 WebSocket：
 *   · `close()` **只**把状态改成 CLOSING，**不**自动触发 close 事件
 *     —— 这正是"半死连接"的样子（浏览器要等传输层给个说法，可能几分钟）。
 *   · 什么时候 open / 收到消息 / 关闭，全部由测试自己驱动。
 */
class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeSocket[] = [];

  url: string;
  readyState = FakeSocket.CONNECTING;
  sent: string[] = [];
  private listeners = new Map<string, Array<(event: unknown) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }

  addEventListener(type: string, handler: (event: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(handler);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, handler: (event: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(type, list.filter((item) => item !== handler));
  }

  send(data: string): void {
    if (this.readyState !== FakeSocket.OPEN) throw new Error('socket 还没开');
    this.sent.push(String(data));
  }

  close(): void {
    // 真实浏览器：这里只是"开始关闭"，close 事件要等传输层确认之后才来
    if (this.readyState === FakeSocket.CLOSED) return;
    this.readyState = FakeSocket.CLOSING;
  }

  // ---- 给测试驱动用 ----
  fireOpen(): void {
    this.readyState = FakeSocket.OPEN;
    this.emit('open', {});
  }

  fireMessage(message: unknown): void {
    this.emit('message', { data: JSON.stringify(message) });
  }

  fireClose(): void {
    this.readyState = FakeSocket.CLOSED;
    this.emit('close', {});
  }

  /** 客户端发出去的消息（解析成对象） */
  messages(): Array<Record<string, unknown>> {
    return this.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
  }

  private emit(type: string, event: unknown): void {
    for (const handler of [...(this.listeners.get(type) ?? [])]) handler(event);
  }
}

/** 记录事件，方便断言"有没有给出的反应" */
function makeEvents() {
  const log = {
    disconnected: [] as string[],
    connected: 0,
    errors: [] as Array<{ code: string; message: string }>,
    resumeState: 0,
    resumeFailed: [] as string[],
  };
  const events = {
    onConnected: () => {
      log.connected++;
    },
    onDisconnected: (reason: string) => {
      log.disconnected.push(reason);
    },
    onError: (code: string, message: string) => {
      log.errors.push({ code, message });
    },
    onResumeState: () => {
      log.resumeState++;
    },
    onResumeFailed: (code: string) => {
      log.resumeFailed.push(code);
    },
  };
  return { log, events };
}

function newClient() {
  const { log, events } = makeEvents();
  const net = new NetplayClient('ws://test:8787', events);
  return { net, log };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.instances = [];
  // 客户端全程用 window.setTimeout / setInterval（浏览器语义），node 里补一个
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('WebSocket', FakeSocket);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ============================================================
//  ① 连接超时
// ============================================================

describe('① 建连卡在 CONNECTING 时，必须超时放弃并重来', () => {
  it('★★ 一次"地址黑洞"的建连不能把重连引擎堵死', () => {
    const { net, log } = newClient();
    net.connect();
    expect(FakeSocket.instances, '起了第一条连接').toHaveLength(1);
    const first = FakeSocket.instances[0]!;
    expect(first.readyState, '还没连上').toBe(FakeSocket.CONNECTING);

    // 这期间任何"重试"都会被 connect() 的 CONNECTING 判断吞掉 —— 但至少要有超时兜底
    vi.advanceTimersByTime(CONNECT_TIMEOUT_MS + 100);
    expect(first.readyState, '★ 超时之后必须把这条连接关掉，别一直占着').toBe(FakeSocket.CLOSING);
    expect(log.disconnected.length, '★ 要告诉界面"这次没连上"（不能静默）').toBeGreaterThanOrEqual(1);

    // 退避 1 秒之后必须真的再试一次
    vi.advanceTimersByTime(1500);
    expect(FakeSocket.instances.length, '★ 必须安排了下一次重连').toBeGreaterThanOrEqual(2);
  });

  it('正常连上不会触发连接超时', () => {
    const { net, log } = newClient();
    net.connect();
    const first = FakeSocket.instances[0]!;
    first.fireOpen();
    vi.advanceTimersByTime(CONNECT_TIMEOUT_MS * 3);
    expect(first.readyState, '连上了就不该被关').toBe(FakeSocket.OPEN);
    expect(log.disconnected, '不该报断开').toHaveLength(0);
  });
});

// ============================================================
//  ② 心跳判死之后必须主动重连
// ============================================================

describe('② 心跳判死（半死连接）不能只 close 就完事', () => {
  it('★★ close 事件迟迟不来时，也必须开始重连', () => {
    const { net } = newClient();
    net.connect();
    const first = FakeSocket.instances[0]!;
    first.fireOpen();
    // 心跳是"每一拍先计数、再发 ping"，所以第一拍要等一个间隔
    vi.advanceTimersByTime(HEARTBEAT_MS + 100);
    expect(first.messages().some((m) => m['t'] === 'ping'), '连上之后会开始 ping').toBe(true);

    // 服务器一直不回 pong（网络半死），而且 close 事件永远不来
    vi.advanceTimersByTime(HEARTBEAT_MS * (MAX_MISSED_HEARTBEATS + 1) + 200);
    expect(first.readyState, '★ 心跳超时要主动把这条连接作废').toBe(FakeSocket.CLOSING);

    vi.advanceTimersByTime(1500);
    expect(FakeSocket.instances.length, '★ 不能干等 close 事件 —— 必须自己重连').toBeGreaterThanOrEqual(2);
  });
});

// ============================================================
//  ③ 旧 socket 的 close 不许污染新连接
// ============================================================

describe('③ 旧连接的 close 事件不许动新连接', () => {
  it('★★ 新连接已经连上之后，旧连接的 close 不能把 connected / room 清掉', () => {
    const { net, log } = newClient();
    net.connect();
    const first = FakeSocket.instances[0]!;
    first.fireOpen();
    first.fireMessage({ t: 'room', room: { code: 'AAAAAA', hostId: 'p1', phase: 'lobby', round: 0, players: [] } });
    expect(net.room?.code).toBe('AAAAAA');

    // 心跳判死 -> 作废旧连接 -> 重连
    vi.advanceTimersByTime(HEARTBEAT_MS * (MAX_MISSED_HEARTBEATS + 1) + 200);
    vi.advanceTimersByTime(1500);
    const second = FakeSocket.instances[1]!;
    second.fireOpen();
    second.fireMessage({ t: 'room', room: { code: 'BBBBBB', hostId: 'p1', phase: 'prep', round: 3, players: [] } });
    expect(net.connected, '新连接是连着的').toBe(true);
    expect(net.room?.code, '新连接已经在 BBBBBB').toBe('BBBBBB');
    const disconnectsBefore = log.disconnected.length;

    // 旧连接迟到的 close 现在才来
    first.fireClose();

    expect(net.connected, '★★ 旧连接的 close 不能把"已连接"打成 false').toBe(true);
    expect(net.room?.code, '★★ 更不能清掉新连接的房间').toBe('BBBBBB');
    expect(log.disconnected.length, '★★ 也不该再报一次"断开"').toBe(disconnectsBefore);
  });
});

// ============================================================
//  ④ resume 没有回应 / "立即重试"是空操作
// ============================================================

describe('④ resume 发出去没人回答时，界面不能永久卡住', () => {
  it('★★ resume 无应答 -> 超时重来（而不是一直等）', () => {
    const { net } = newClient();
    net.connect();
    const first = FakeSocket.instances[0]!;
    first.fireOpen();
    // 先拿到一枚令牌（welcome 里带的临时身份也行，这里只关心"手上有令牌"）
    first.fireMessage({ t: 'welcome', playerId: 'p1', serverVersion: '0.2.1正式版', resumeToken: 'TOKEN-1' });
    expect(net.canResume).toBe(true);

    // 掉线 -> 自动重连 -> 新连接 open 之后会自动发 resume
    first.fireClose();
    vi.advanceTimersByTime(1500);
    const second = FakeSocket.instances[1]!;
    second.fireOpen();
    expect(
      second.messages().some((m) => m['t'] === 'resume'),
      '有令牌就连上立刻 resume',
    ).toBe(true);

    // 服务器收下了却一直不回（异常 / 半开连接）
    vi.advanceTimersByTime(RESUME_ANSWER_TIMEOUT_MS + 200);
    expect(second.readyState, '★ 没人回答就把这条作废').toBe(FakeSocket.CLOSING);
    vi.advanceTimersByTime(1500);
    expect(FakeSocket.instances.length, '★ 然后必须自己再试一次').toBeGreaterThanOrEqual(3);
  });

  it('★★ socket 开着但身份还没换回来时，「立即重试」必须真的重来一次', () => {
    const { net } = newClient();
    net.connect();
    const first = FakeSocket.instances[0]!;
    first.fireOpen();
    // welcome 在这一刻才把令牌交过来 —— 所以这条连接**没有**发过 resume
    first.fireMessage({ t: 'welcome', playerId: 'p1', serverVersion: '0.2.1正式版', resumeToken: 'TOKEN-1' });
    expect(net.canResume).toBe(true);
    expect(first.messages().some((m) => m['t'] === 'resume'), '这条连接确实没发过 resume').toBe(false);

    // 玩家点「立即重试」
    net.retryResume();
    vi.advanceTimersByTime(200);

    expect(FakeSocket.instances.length, '★★ 不能因为 readyState 是 OPEN 就早退（那等于按钮没接线）').toBe(2);
    const second = FakeSocket.instances[1]!;
    second.fireOpen();
    expect(second.messages().some((m) => m['t'] === 'resume'), '新连接要把 resume 发出去').toBe(true);
  });

  it('手上没有令牌时，「立即重试」必须给一句话（不能静默）', () => {
    const { net, log } = newClient();
    net.retryResume();
    expect(log.errors.length, '没令牌就不能装作在重试').toBeGreaterThanOrEqual(1);
  });
});

// ============================================================
//  回归：正常重连链路（别把好路也改坏）
// ============================================================

describe('回归：正常的断线重连链路', () => {
  it('断线 -> 退避 -> 重连 -> resume -> resumeState -> 状态恢复', () => {
    const { net, log } = newClient();
    net.connect();
    const first = FakeSocket.instances[0]!;
    first.fireOpen();
    first.fireMessage({ t: 'welcome', playerId: 'p1', serverVersion: '0.2.1正式版', resumeToken: 'TOKEN-1' });

    first.fireClose();
    expect(log.disconnected.length, '掉线要告诉界面').toBe(1);
    vi.advanceTimersByTime(1200);

    const second = FakeSocket.instances[1]!;
    second.fireOpen();
    expect(second.messages().some((m) => m['t'] === 'resume')).toBe(true);
    second.fireMessage({ t: 'resumeState', room: { code: 'AAAAAA' }, playerId: 'p1' });
    expect(log.resumeState, '收到快照就算回座了').toBe(1);
    expect(net.connected).toBe(true);
  });

  it('被顶号：绝不自动重连（两个标签页会互踢）', () => {
    const { net } = newClient();
    net.connect();
    const first = FakeSocket.instances[0]!;
    first.fireOpen();
    first.fireMessage({ t: 'replaced', reason: '你在另一处进入了游戏' });
    first.fireClose();
    vi.advanceTimersByTime(30_000);
    expect(FakeSocket.instances.length, '被顶号之后不许再连').toBe(1);
  });
});
