/**
 * ============================================================
 *  ★ 局域网房间发现（"输入房间号就能进"）
 * ============================================================
 *
 * 【这套东西在解决什么？】
 * 便携包玩法里，两台电脑各自跑着一整套游戏。朋友要进我的房间，
 * 他的浏览器就得连到**我**这台机器。原来只能把超长链接发给他；现在
 * 他自己那台机器的服务器会听到我的广播，于是"输入房间号"就够了。
 *
 * 【这里测三层】
 *   ① **纯函数**：脏报文必须被丢掉、过期的邻居必须消失
 *      （局域网 UDP 谁都能发，一条畸形报文不该把服务器搞崩）；
 *   ② **发**：房主建房之后，真的有一包广播发出去，内容对得上（房间号、端口）；
 *   ③ **收 + 回话**：收到别人的广播之后，浏览器问 `lanScan` 能拿到那条记录，
 *      并且带上可以直接连的地址（`<对方IP>:<对方游戏端口>`）。
 *
 * 【为什么"发"和"收"用同一个服务器测？】
 * 因为同一台机器上两个进程抢同一个 UDP 端口，行为是不确定的
 * （Windows 的 SO_REUSEADDR 语义和 Linux 不一样）。
 * 所以测试里的"对端"用**裸 UDP socket**扮演：
 *   · 服务器把广播发到一个测试专用端口（`AIRNIGHT_LAN_TARGET_PORT`）→ 我收得到；
 *   · 我往服务器的监听端口发一包假广播 → 它应该记进邻居表。
 * 两个方向都被覆盖，而且完全确定性。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSocket, type Socket } from 'node:dgram';
import { WebSocket, type WebSocketServer } from 'ws';
// ★ 0.1.3：建房要带上版本（服务端会校验，不带会被拒）
import { LAN_BEACON_PORT, SERVER_VERSION } from '@airnight/shared';

/*
  局域网端口必须在 startServer 之前设好（服务器起来时会读它）。
  用固定高位端口：不和真实游戏的 45217 撞，也不会和别的测试撞。
*/
const LAN_PORT = Number(process.env.AIRNIGHT_TEST_LAN_PORT ?? 45311);
const FAKE_HOST_PORT = 45312;
process.env.AIRNIGHT_LAN_PORT = String(LAN_PORT);
process.env.AIRNIGHT_LAN_TARGET_PORT = String(FAKE_HOST_PORT);
process.env.AIRNIGHT_NO_AUTOSTART = '1';

const { parseBeacon, applyBeacon, listBeacons } = await import('../src/lan.js');
// ★ 0.3.3：广播内容要看"局内房间会不会被藏起来"，得直接问 RoomManager
const { RoomManager } = await import('../src/room.js');
const { startServer } = await import('../src/main.js');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 一个"先记住所有消息"的测试客户端（同 combined-server.test.ts 的写法） */
function connect(url: string): {
  socket: WebSocket;
  open: () => Promise<void>;
  waitFor: (type: string, timeoutMs?: number) => Promise<Record<string, unknown>>;
} {
  const socket = new WebSocket(url);
  const inbox: Array<Record<string, unknown>> = [];
  const waiters: Array<{ type: string; resolve: (value: Record<string, unknown>) => void }> = [];

  socket.on('message', (data: unknown) => {
    const parsed = JSON.parse(String(data)) as Record<string, unknown>;
    const index = waiters.findIndex((w) => w.type === parsed['t']);
    if (index >= 0) {
      waiters.splice(index, 1)[0]!.resolve(parsed);
      return;
    }
    inbox.push(parsed);
  });

  return {
    socket,
    open: () => new Promise((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    }),
    waitFor: (type, timeoutMs = 5000) =>
      new Promise((resolve, reject) => {
        const hit = inbox.find((m) => m['t'] === type);
        if (hit) {
          inbox.splice(inbox.indexOf(hit), 1);
          resolve(hit);
          return;
        }
        const timer = setTimeout(() => {
          const index = waiters.findIndex((w) => w.resolve === wrapped);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error(`等 ${type} 超时`));
        }, timeoutMs);
        const wrapped = (value: Record<string, unknown>) => {
          clearTimeout(timer);
          resolve(value);
        };
        waiters.push({ type, resolve: wrapped });
      }),
  };
}

describe('★ 局域网发现：纯函数（脏报文与过期）', () => {
  it('报文形状不对就整条丢掉（局域网上谁都能发包）', () => {
    expect(parseBeacon(null)).toBeNull();
    expect(parseBeacon('hello')).toBeNull();
    expect(parseBeacon({})).toBeNull();
    expect(parseBeacon({ t: 'something-else' })).toBeNull();
    expect(parseBeacon({ t: 'airnight-lan' }), '少了 id').toBeNull();
    expect(parseBeacon({ t: 'airnight-lan', id: 'x', port: 0 }), '端口不合法').toBeNull();
    expect(parseBeacon({ t: 'airnight-lan', id: 'x', port: 99999 })).toBeNull();
    expect(parseBeacon({ t: 'airnight-lan', id: 'x', port: 8787, rooms: 'nope' })).toBeNull();
  });

  it('单个房间字段坏了就跳过那一条，不影响别的', () => {
    const ok = parseBeacon({
      t: 'airnight-lan',
      id: 'x',
      port: 8787,
      rooms: [{ code: 'a7k2m9', hostName: '阿米娅', players: 2, maxPlayers: 8 }, { code: 123 }, null, { hostName: '缺码' }],
    });
    expect(ok).not.toBeNull();
    expect(ok!.rooms).toHaveLength(1);
    expect(ok!.rooms[0]!.code, '房间号统一成大写').toBe('A7K2M9');
  });

  it('★ 邻居记录会过期：主机关了游戏，房间就不该再挂在列表上', () => {
    const table = new Map<string, Parameters<typeof listBeacons>[0] extends Map<string, infer T> ? T : never>();
    const payload = { t: 'airnight-lan' as const, id: 'host-1', ver: '0.0.3', port: 8787, rooms: [] };
    const rooms = [{ code: 'A7K2M9', hostName: '房主', players: 1, maxPlayers: 8 }];

    const now = 1_000_000;
    applyBeacon(table, payload, rooms, '192.168.1.5', now);

    expect(listBeacons(table, now + 1000), '刚听到的还在').toHaveLength(1);
    expect(listBeacons(table, now + 1000)[0]!.address, '地址要能直接连').toBe('192.168.1.5:8787');
    expect(listBeacons(table, now + 9000), '超过 5 秒没再听到就该消失').toHaveLength(0);
    expect(table.size, '过期的那条应该被顺手清掉').toBe(0);
  });

  it('★ 同一台机器从另一个网卡又发来一条：只刷新时间，不换地址（别让地址来回跳）', () => {
    const table = new Map<string, Parameters<typeof listBeacons>[0] extends Map<string, infer T> ? T : never>();
    const payload = { t: 'airnight-lan' as const, id: 'host-1', ver: '0.0.3', port: 8787, rooms: [] };
    const rooms = [{ code: 'A7K2M9', hostName: '房主', players: 1, maxPlayers: 8 }];

    // 先听到 WiFi 网卡那条
    applyBeacon(table, payload, rooms, '192.168.1.5', 1000);
    // 紧接着又从 Radmin 虚拟网卡听到同一条（实例 id 相同）
    applyBeacon(table, payload, rooms, '26.0.0.7', 1100);

    const list = listBeacons(table, 1200);
    expect(list, '还是只有一条（房间码没重复）').toHaveLength(1);
    expect(list[0]!.address, '地址必须稳定在第一条，否则朋友正好在跳的那刻点加入就连错').toBe('192.168.1.5:8787');
    expect(list[0]!.seenAt, '时间要刷新，不然会被当成过期').toBe(1100);
  });

  it('★★ 0.3.3：局内房间也能广播/解析（带 phase + round），老报文当"等待中"', () => {
    /*
      用户口径："已开局的房间也要在列表里看见，只是进不去。"
      所以广播里必须带状态；而**0.3.2 及更早的机器不会带** ——
      读不到就当 'lobby'，别让一条老报文把整行弄成"未知状态"。
    */
    // ① 新报文：带 phase / round
    const fresh = parseBeacon({
      t: 'airnight-lan',
      id: 'host-1',
      port: 8787,
      rooms: [
        { code: 'a7k2m9', hostName: '房主', players: 4, maxPlayers: 8, phase: 'battle', round: 7 },
        { code: 'b8l3n0', hostName: '另一个房主', players: 1, maxPlayers: 8, phase: 'lobby', round: 0 },
      ],
    });
    expect(fresh!.rooms[0]!.phase, '局内房间照样广播').toBe('battle');
    expect(fresh!.rooms[0]!.round).toBe(7);
    expect(fresh!.rooms[1]!.phase).toBe('lobby');

    // ② 老报文：没有 phase/round
    const legacy = parseBeacon({
      t: 'airnight-lan',
      id: 'host-2',
      port: 8787,
      rooms: [{ code: 'c9m4p1', hostName: '老版本', players: 1, maxPlayers: 8 }],
    });
    expect(legacy!.rooms[0]!.phase, '读不到就当等待中').toBe('lobby');
    expect(legacy!.rooms[0]!.round).toBe(0);

    // ③ 脏值：不认识的状态一律当 lobby（局域网报文没有鉴权，什么都可能被塞进来）
    const dirty = parseBeacon({
      t: 'airnight-lan',
      id: 'host-3',
      port: 8787,
      rooms: [{ code: 'd1n5q2', players: 1, maxPlayers: 8, phase: '__proto__', round: -3 }],
    });
    expect(dirty!.rooms[0]!.phase).toBe('lobby');
    expect(dirty!.rooms[0]!.round, '负数回合夹回 0').toBe(0);
  });

  it('★★ 0.3.3：邻居表会把状态和版本一起记住（列表要据此显示"进行中"和"版本不同"）', () => {
    const table = new Map<string, Parameters<typeof listBeacons>[0] extends Map<string, infer T> ? T : never>();
    const payload = { t: 'airnight-lan' as const, id: 'host-1', ver: '0.3.2', port: 8787, rooms: [] };
    applyBeacon(
      table,
      payload,
      [{ code: 'A7K2M9', hostName: '房主', players: 3, maxPlayers: 8, phase: 'prep', round: 5 }],
      '192.168.1.5',
      1000,
    );
    const list = listBeacons(table, 1200);
    expect(list[0]!.phase).toBe('prep');
    expect(list[0]!.round).toBe(5);
    expect(list[0]!.version, '版本要留下来，好让列表提前标"版本不同"').toBe('0.3.2');

    // 房主那边"开局了"：下一条广播要把状态推进去（否则列表永远显示等待中）
    applyBeacon(
      table,
      payload,
      [{ code: 'A7K2M9', hostName: '房主', players: 3, maxPlayers: 8, phase: 'battle', round: 6 }],
      '192.168.1.5',
      2000,
    );
    const after = listBeacons(table, 2100);
    expect(after[0]!.phase).toBe('battle');
    expect(after[0]!.round).toBe(6);
  });

  it('同一个房间码再来一条就刷新时间（不会被误判过期）', () => {
    const table = new Map<string, Parameters<typeof listBeacons>[0] extends Map<string, infer T> ? T : never>();
    const payload = { t: 'airnight-lan' as const, id: 'host-1', ver: '0.0.3', port: 8787, rooms: [] };
    const rooms = [{ code: 'A7K2M9', hostName: '房主', players: 1, maxPlayers: 8 }];
    applyBeacon(table, payload, rooms, '192.168.1.5', 1000);
    applyBeacon(table, payload, rooms, '192.168.1.5', 4000);
    expect(listBeacons(table, 4500), '4 秒前又听到过，所以还活着').toHaveLength(1);
  });
});

describe('★ 局域网发现：真的收发一遍', () => {
  let server: { wss: WebSocketServer; close: () => void } | null = null;
  let gamePort = 0;
  let hostSocket: Socket;
  /** 扮演"另一台机器"：往服务器的监听端口发假广播 */
  let fakePeer: Socket;
  let client: ReturnType<typeof connect> | null = null;

  beforeAll(async () => {
    // 我这边监听"服务器广播发到哪"（扮演对端）
    hostSocket = createSocket({ type: 'udp4', reuseAddr: true });
    await new Promise<void>((resolve) => hostSocket.bind(FAKE_HOST_PORT, '127.0.0.1', () => resolve()));
    hostSocket.setBroadcast(true);

    server = startServer(0, '127.0.0.1');
    await new Promise<void>((resolve) => server!.wss.once('listening', () => resolve()));
    gamePort = Number((server.wss.address() as { port: number }).port);

    fakePeer = createSocket({ type: 'udp4' });
    await new Promise<void>((resolve) => fakePeer.bind(0, '127.0.0.1', () => resolve()));

    client = connect(`ws://127.0.0.1:${gamePort}`);
    await client.open();
  });

  afterAll(() => {
    client?.socket.close();
    server?.close();
    try {
      hostSocket.close();
    } catch {
      /* ignore */
    }
    try {
      fakePeer.close();
    } catch {
      /* ignore */
    }
  });

  it('连上就先告诉我们本机的局域网地址（房主要念给朋友）', async () => {
    const welcome = await client!.waitFor('welcome');
    expect(welcome['serverVersion']).toBeTypeOf('string');
    expect(Array.isArray(welcome['lanAddresses']), 'lanAddresses 必须是个数组').toBe(true);
  });

  it('★ 建房之后真的会广播出去，内容里有房间号和朋友该连的端口', async () => {
    const packets: Array<Record<string, unknown>> = [];
    hostSocket.on('message', (data) => {
      try {
        packets.push(JSON.parse(data.toString()) as Record<string, unknown>);
      } catch {
        /* 不是 JSON 就忽略 */
      }
    });

    client!.socket.send(
      JSON.stringify({ t: 'createRoom', playerName: '房主', version: SERVER_VERSION }),
    );
    const room = (await client!.waitFor('room'))['room'] as { code: string };
    expect(room.code, '6 位房间号').toHaveLength(6);

    // 等广播（建房会立刻催一次，1.5 秒的定时器也够）
    for (let i = 0; i < 40 && packets.length === 0; i++) await sleep(100);
    expect(packets.length, '没收到广播').toBeGreaterThan(0);

    const payload = packets[0]!;
    expect(payload['t']).toBe('airnight-lan');
    expect(payload['port'], '广播里写的必须是真实的游戏端口').toBe(gamePort);
    const rooms = payload['rooms'] as Array<{ code: string; hostName: string }>;
    expect(rooms.some((item) => item.code === room.code), '广播里得有刚建的那个房间').toBe(true);
    expect(rooms.find((item) => item.code === room.code)!.hostName).toBe('房主');
  });

  it('★ 收到别人的广播后，lanScan 能把"房间号 -> 该连谁"换出来', async () => {
    const remote = {
      t: 'airnight-lan',
      id: 'another-machine',
      ver: '0.0.3',
      port: 9999,
      rooms: [{ code: 'ZZZZZZ', hostName: '朋友', players: 2, maxPlayers: 8 }],
    };
    fakePeer.send(Buffer.from(JSON.stringify(remote)), LAN_PORT, '127.0.0.1');
    await sleep(250);

    client!.socket.send(JSON.stringify({ t: 'lanScan' }));
    const reply = await client!.waitFor('lanRooms');
    const rooms = reply['rooms'] as Array<Record<string, unknown>>;
    const hit = rooms.find((item) => item['code'] === 'ZZZZZZ');
    expect(hit, '平台上报的房间应该出现在列表里').toBeDefined();
    expect(hit!['address'], '地址要能直接拼成 ws://').toBe('127.0.0.1:9999');
    expect(hit!['players']).toBe(2);
    expect(hit!['maxPlayers']).toBe(8);
    expect(hit!['hostName']).toBe('朋友');
  });

  it('自己发的广播不会把自己列成"邻居房间"', async () => {
    client!.socket.send(JSON.stringify({ t: 'lanScan' }));
    const reply = await client!.waitFor('lanRooms');
    const rooms = reply['rooms'] as Array<Record<string, unknown>>;
    // 本机那个房间也在广播，但它属于"自己"，不该出现在邻居表里
    expect(rooms.some((item) => item['address'] === `127.0.0.1:${gamePort}`)).toBe(false);
  });

  it('广播里不含任何房间时不发包（不打搅局域网）', () => {
    // 直接问实现：advertisedRooms 在没房间时必须是空的
    const manager = new RoomManager();
    expect(manager.advertisedRooms()).toHaveLength(0);
  });
});

describe('★ 房间号不再"每次开服都一样"', () => {
  it('不同的房间管理器（= 不同次开服）拿到的码不同，而且都不假', () => {
    const runs = Array.from({ length: 3 }, () => {
      const manager = new RoomManager();
      return Array.from({ length: 6 }, (_, i) => manager.createRoom(`h${i}`, `房主${i}`).code);
    });
    for (const codes of runs) {
      for (const code of codes) {
        expect(code).toHaveLength(6);
        // 老 bug 的典型长相：六个字符里五个 A
        expect(new Set(code).size, `${code} 看起来像写死的`).toBeGreaterThanOrEqual(3);
      }
    }
    // 三次"开服"的第一个房间号不该一模一样（这正是老代码最丢人的地方）
    const firsts = runs.map((codes) => codes[0]);
    expect(new Set(firsts).size, `三次开服的首个房间号：${firsts.join(' / ')}`).toBeGreaterThan(1);
  });

  it('同一批房间码互不重复', () => {
    const manager = new RoomManager();
    const codes = Array.from({ length: 50 }, (_, i) => manager.createRoom(`p${i}`, `玩家${i}`).code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('广播端口是个固定常量（两端靠它约定）', () => {
    expect(LAN_BEACON_PORT).toBeGreaterThan(1024);
    expect(LAN_BEACON_PORT).toBeLessThan(65536);
  });
});

/**
 * ============================================================
 *  ★★ 0.3.3：广播里到底该有哪些房间（用户口径）
 * ============================================================
 * "已开局的也可以看见，只是进不去" —— 这句话落到代码上就是这里的断言：
 *   ① 等待中的房间：照旧广播（phase=lobby, round=0）；
 *   ② **进行中的房间：也要广播**，并且带上 phase + round；
 *   ③ 一个人都不在线的房间：仍然不广播（房主关了标签页的那种空壳）。
 * 第 ② 条正是这一版要改的东西 —— 以前这里有一句 `phase !== 'lobby' continue`。
 */
describe('★★ 0.3.3 广播内容：局内房间要能被看见', () => {
  it('等待中 / 进行中 都广播，状态和回合号跟着走', () => {
    const manager = new RoomManager();
    const room = manager.createRoom('p1', '房主', '');
    manager.joinRoom(room.code, 'p2', '朋友', '');

    const lobby = manager.advertisedRooms();
    expect(lobby, '等待中的房间照旧').toHaveLength(1);
    expect(lobby[0]!.phase).toBe('lobby');
    expect(lobby[0]!.round, '等待中不写"第 0 回合"').toBe(0);
    expect(lobby[0]!.players).toBe(2);

    // 假装已经开打（不看玩法流程，只看"广播会不会把它藏起来"）
    room.phase = 'battle';
    room.round = 7;
    const inMatch = manager.advertisedRooms();
    expect(inMatch, '★ 局内房间也要在列表里看得见（只是进不去）').toHaveLength(1);
    expect(inMatch[0]!.phase).toBe('battle');
    expect(inMatch[0]!.round).toBe(7);
  });

  it('一个人都不在线的房间仍然不广播（房主关了标签页的空壳）', () => {
    const manager = new RoomManager();
    const room = manager.createRoom('p1', '房主', '');
    room.phase = 'battle';
    room.round = 3;
    // 把唯一的真人标成离线（宽限期内的状态）
    for (const player of room.players) player.connected = false;
    expect(manager.advertisedRooms(), '没人在线的局广播出去只会让人白点').toHaveLength(0);
  });
});
