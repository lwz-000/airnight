/**
 * ============================================================
 *  ★ 0.0.3 末：局域网房间发现（便携包"输入房间号就能进"的地基）
 * ============================================================
 *
 * 【它解决什么问题？】
 * 便携包那套玩法里，两台电脑各自跑着一整套游戏（自己的网页服务器 + 自己的
 * 游戏服务器）。朋友要进我的房间，他的**浏览器**就必须连到**我**这台机器的
 * WebSocket —— 但浏览器不知道我在局域网里的 IP。
 *
 * 原来的办法是把启动器打印的那条超长链接（`?server=192.168.1.5:5173`）发过去，
 * 少复制一个字符就连不上。现在改成：**你只念房间号，机器自己去找**。
 *
 * 【怎么做 —— 两条 UDP 广播 + 一条已有的 WebSocket】
 *
 *     主机                                      朋友
 *     ┌──────────────┐                       ┌──────────────┐
 *     │ 游戏服务器    │  ①广播（1.5 秒一次）  │ 游戏服务器    │
 *     │ 房间 A7K2M9 ──┼──────────────────────▶│ 邻居房间表    │
 *     └──────┬───────┘   {code,端口,房主,人数} └──────┬───────┘
 *            │ ②ws: room(view)                        │ ③ws: lanScan
 *        ┌───┴────┐                              ┌────┴─────┐
 *        │ 主机页面│                              │ 朋友页面  │
 *        └────────┘                              └──────────┘
 *                                         ④拿到 192.168.1.5:8787 → 连过去
 *
 * 关键点：**浏览器发不了 UDP**，所以广播的收发都放在"每台机器自己的服务器进程"里；
 * 浏览器只通过**它自己已经连着的那个服务器**问一句 `lanScan`。
 * 这样客户端一行网络新代码都不用写（不用 WebRTC、不用 UDP-over-HTTP）。
 *
 * 【为什么端口要写死？】
 * 两台机器没有别的约定渠道，只能约定一个固定端口（见 shared 的 LAN_BEACON_PORT）。
 *
 * 【为什么不干脆联网搞个"房间列表服务"？】
 * 因为这游戏就是要能**离线局域网玩**（同一 WiFi / Radmin / UU 组网），
 * 不依赖任何外部服务器。
 *
 * 【只在测试里用的两个环境变量】
 *   AIRNIGHT_LAN_PORT        监听端口（默认 LAN_BEACON_PORT）
 *   AIRNIGHT_LAN_TARGET_PORT 广播的目标端口（默认跟监听同一个）
 * 它们的存在只有一个目的：让"两个服务器在同一台机器上互相发现"这件事
 * 可以在测试里稳定跑（同一台机器上两个进程抢同一个 UDP 端口，行为是不确定的）。
 * 正常玩的时候两个都不设。
 */

import { createSocket, type Socket } from 'node:dgram';
import { networkInterfaces } from 'node:os';
import { LAN_BEACON_PORT, SERVER_VERSION, type LanRoomInfo, type RoomPhase } from '@airnight/shared';

/** 广播周期（毫秒）。太快没必要（房间号不会每秒变），太慢朋友要多等 */
const BEACON_INTERVAL_MS = 1500;

/** 一条邻居房记录多久没再收到就算过期（毫秒）—— 比广播周期宽裕一点，容忍丢包 */
const BEACON_TTL_MS = 5000;

/** 邻居房间表最多记多少条（防止谁乱发包把内存塞满） */
const MAX_NEIGHBOURS = 64;

/** 广播里的一间房（由调用方决定"现在有什么值得广播的"） */
export interface BeaconRoom {
  code: string;
  hostName: string;
  players: number;
  maxPlayers: number;
  /**
   * ★★ 0.3.3：这一局走到哪一步。
   * 用户口径："已开局的房间也要能在列表里看见，只是进不去"。所以局内房间照样广播，
   * 只是把状态带出去，由**看的人**决定"能不能点"（服务端 `joinRoom` 仍然会拒）。
   */
  phase?: RoomPhase;
  /** 第几回合（等待中是 0） */
  round?: number;
}

/** 广播报文（局域网里能收到的东西就是这个） */
export interface BeaconPayload {
  t: 'airnight-lan';
  /** 发送方实例 id：用来忽略"自己发的广播" */
  id: string;
  ver: string;
  /** 发送方**游戏服务器**的端口（朋友直接连这个端口） */
  port: number;
  rooms: BeaconRoom[];
}

/** 收下来的一条邻居房（导出是为了让测试能直接喂假数据，不必真的开两个服务器） */
export interface Neighbour {
  code: string;
  hostName: string;
  players: number;
  maxPlayers: number;
  /** ★ 0.3.3：局内房间也要能被看见（状态由看的人决定怎么显示） */
  phase: RoomPhase;
  round: number;
  /** 形如 192.168.1.5:8787 */
  address: string;
  /** 对方的版本串（列表要标"版本不同"，别让人白点） */
  version: string;
  seenAt: number;
  /** 发送方实例 id：用来判断"地址变了但其实是同一台机器" */
  instanceId: string;
}

/** 本机所有可用的局域网 IPv4（用来打印"朋友该连哪个地址"） */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const info of list ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      if (info.address.startsWith('169.254.')) continue; // 没连上网络时的自分配地址
      out.push(info.address);
    }
  }
  return out;
}

/** 房间状态白名单（局域网报文是裸的，任何值都可能是伪造的） */
const ROOM_PHASES: readonly RoomPhase[] = ['lobby', 'covenant', 'shop', 'prep', 'battle', 'resolve'];

function isRoomPhase(value: unknown): value is RoomPhase {
  return typeof value === 'string' && (ROOM_PHASES as readonly string[]).includes(value);
}

/**
 * 校验 + 归一化一条广播报文。
 *
 * 【为什么要单独抽成纯函数？】
 * 因为**局域网里的 UDP 报文是任何人都能伪造的**（不需要任何鉴权）。
 * 一条脏报文如果直接进表，轻则界面上出现一个连不上的房间，
 * 重则 `rooms` 不是数组、`.map` 直接抛异常把服务器搞崩。
 * 所以这里逐字段校验，形状不对就整条丢掉，而且这段逻辑可以被单测覆盖。
 *
 * @returns 合法的房间条目；整条报文不合法时返回 null
 */
export function parseBeacon(raw: unknown): { payload: BeaconPayload; rooms: BeaconRoom[] } | null {
  if (!raw || typeof raw !== 'object') return null;
  const msg = raw as Partial<BeaconPayload>;
  if (msg.t !== 'airnight-lan') return null;
  if (typeof msg.id !== 'string' || msg.id.length === 0) return null;
  if (typeof msg.port !== 'number' || !Number.isInteger(msg.port) || msg.port <= 0 || msg.port > 65535) {
    return null;
  }
  if (!Array.isArray(msg.rooms)) return null;

  const rooms: BeaconRoom[] = [];
  for (const item of msg.rooms.slice(0, MAX_NEIGHBOURS)) {
    if (!item || typeof item !== 'object') continue;
    const room = item as Partial<BeaconRoom>;
    if (typeof room.code !== 'string' || room.code.length === 0) continue;
    rooms.push({
      code: room.code.toUpperCase(),
      hostName: typeof room.hostName === 'string' ? room.hostName : '',
      players: Number.isFinite(room.players) ? Number(room.players) : 0,
      maxPlayers: Number.isFinite(room.maxPlayers) ? Number(room.maxPlayers) : 0,
      /*
        ★ 0.3.3：状态是**新加的**。0.3.2 及更早的机器广播里没有这个字段 ——
        读不到就当成 'lobby'（它们本来也只会广播等待中的房），列表照样能用。
        只认白名单里的值：脏报文里塞个 `phase: "__proto__"` 之类的东西进不去。
      */
      phase: isRoomPhase(room.phase) ? room.phase : 'lobby',
      round: Number.isFinite(room.round) ? Math.max(0, Math.floor(Number(room.round))) : 0,
    });
  }
  return {
    payload: {
      t: 'airnight-lan',
      id: msg.id,
      ver: typeof msg.ver === 'string' ? msg.ver : '',
      port: msg.port,
      rooms,
    },
    rooms,
  };
}

/**
 * 把一条合法报文并进邻居表（就地修改 `table`）。
 *
 * 【为什么也抽出来？】
 * 因为"过期"这件事只有在这里才说得清：同一个房间码再来一条就**刷新时间**，
 * 房间没了（主机关了或者开打了）就会在下一次扫描时因为超时而消失。
 * 抽成纯函数之后，测试可以喂一个假的 `now` 直接把"过期"跑出来，不用真的等 5 秒。
 */
export function applyBeacon(
  table: Map<string, Neighbour>,
  payload: BeaconPayload,
  rooms: BeaconRoom[],
  fromAddress: string,
  now: number,
): void {
  const address = `${fromAddress}:${payload.port}`;
  for (const room of rooms) {
    const existing = table.get(room.code);
    /*
      ★ 同一台机器、同一个房间，从**另一个网卡**又发来一条（很常见：
      主机既有 WiFi 网卡又有 Radmin/UU 的虚拟网卡，两边都在广播）——
      这时候**只刷新时间，不换地址**。
      换来换去的后果是：邻居表里的地址每 1.5 秒跳一次，
      朋友正好在跳的那一刻点加入，就会连到一个刚被换掉的地址上。
      先到的那条能连上就继续用它；真连不上时手填地址那条路还在。
    */
    if (existing && existing.instanceId === payload.id) {
      existing.seenAt = now;
      existing.hostName = room.hostName;
      existing.players = room.players;
      existing.maxPlayers = room.maxPlayers;
      // ★ 0.3.3：状态跟着刷 —— 房主那边"开局了"也要能传到朋友的列表上
      existing.phase = room.phase ?? 'lobby';
      existing.round = room.round ?? 0;
      existing.version = payload.ver;
      continue;
    }
    // 房间码撞车（比如房主换了台机器）：谁新听谁的
    if (existing && existing.seenAt > now) continue;
    table.set(room.code, {
      code: room.code,
      hostName: room.hostName,
      players: room.players,
      maxPlayers: room.maxPlayers,
      phase: room.phase ?? 'lobby',
      round: room.round ?? 0,
      address,
      version: payload.ver,
      seenAt: now,
      instanceId: payload.id,
    });
  }
  // 表太长了就把最旧的挤出去
  if (table.size > MAX_NEIGHBOURS) {
    const sorted = [...table.entries()].sort((a, b) => a[1].seenAt - b[1].seenAt);
    for (const [code] of sorted.slice(0, table.size - MAX_NEIGHBOURS)) table.delete(code);
  }
}

/**
 * 把邻居表整理成"**现在还有效的**房间列表"（顺便把过期的删掉）。
 *
 * 【为什么单独抽出来？】
 * "过期"这件事只有拿时间戳比一比才说得清（主机拔网线、关游戏、开打了，
 * 都不会有人通知我们 —— UDP 广播本来就是"喊一嗓子"，没有"我走了"）。
 * 抽成纯函数之后，测试可以喂一个"6 秒前听到的"记录，直接把过期跑出来，
 * 不用真的等 5 秒。
 */
export function listBeacons(table: Map<string, Neighbour>, now: number): Neighbour[] {
  const out: Neighbour[] = [];
  for (const [code, item] of table) {
    if (now - item.seenAt > BEACON_TTL_MS) {
      table.delete(code);
      continue;
    }
    out.push(item);
  }
  // 房间码排序：界面上的顺序才会稳定（不然每 1.5 秒跳一次）
  return out.sort((a, b) => a.code.localeCompare(b.code));
}

/** 快递一个小工具：把本机的广播地址都算出来 */
function broadcastAddresses(): string[] {
  const out = new Set<string>(['127.0.0.1']); // 同一台机器上跑两个游戏也能互相发现（调试用）
  for (const list of Object.values(networkInterfaces())) {
    for (const info of list ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      if (info.address.startsWith('169.254.')) continue;
      // 节点不直接给广播地址，按 /24 习惯取 x.y.z.255；顺带加一个全局广播兜底
      const parts = info.address.split('.');
      if (parts.length === 4) out.add(`${parts[0]}.${parts[1]}.${parts[2]}.255`);
    }
  }
  out.add('255.255.255.255');
  return [...out];
}

export interface LanDiscovery {
  /** 现在能看到的邻居房间（已经过滤掉过期的） */
  scan(): LanRoomInfo[];
  /** 立刻广播一次（刚建好房，不想让朋友干等 1.5 秒） */
  poke(): void;
  /** 关掉（服务器退出时调） */
  close(): void;
}

/**
 * 起一套"广播 + 监听"。
 *
 * 【为什么房间列表传的是一个**函数**，而不是每次变了告诉我一声？】
 * 因为"什么时候变了"这种事很容易漏（建房、散伙、开打、改人数…）。
 * 传一个 getter，广播前现问一次，**永远是最新的**，也不用在别处维护同步。
 *
 * @param gamePort 本机游戏服务器的端口（写进广播，朋友直接连它）
 * @param listRooms 现在有哪些房间值得广播（每次发包前调用）
 */
export function startLanDiscovery(gamePort: number, listRooms: () => BeaconRoom[]): LanDiscovery {
  const listenPort = Number(process.env.AIRNIGHT_LAN_PORT ?? LAN_BEACON_PORT);
  const targetPort = Number(process.env.AIRNIGHT_LAN_TARGET_PORT ?? listenPort);

  /** 本实例的唯一 id：只用来忽略"自己发的广播"，没有任何安全含义 */
  const instanceId = `a${process.pid}-${Math.floor(Math.random() * 1e9).toString(36)}`;

  const neighbours = new Map<string, Neighbour>();

  const socket: Socket = createSocket({ type: 'udp4', reuseAddr: true });

  socket.on('error', (error) => {
    // UDP 起不来不能拖垮游戏本身（单机照样要能玩），所以只提示、不抛
    console.warn(`[局域网] 广播端口 ${listenPort} 不可用：${error.message}`);
    console.warn('[局域网] 朋友将无法"输入房间号"自动找到你，改成手填地址仍然可用。');
  });

  socket.on('message', (data, remote) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      return; // 不是 JSON 就丢掉（局域网里什么包都可能有）
    }
    const ok = parseBeacon(parsed);
    if (!ok) return;
    if (ok.payload.id === instanceId) return; // 自己发的，忽略
    applyBeacon(neighbours, ok.payload, ok.rooms, remote.address, Date.now());
  });

  socket.bind(listenPort, () => {
    try {
      socket.setBroadcast(true);
    } catch {
      /* 某些环境不允许（比如受限容器），那就只能收不能发 */
    }
  });

  const targets = broadcastAddresses();

  const sendOnce = (): void => {
    // 现问一次：房间列表永远是最新的（见函数说明）
    let rooms: BeaconRoom[] = [];
    try {
      rooms = listRooms();
    } catch {
      rooms = [];
    }
    if (rooms.length === 0) return; // 没房间就别废话（省得局域网上到处是包）
    const payload: BeaconPayload = {
      t: 'airnight-lan',
      id: instanceId,
      ver: SERVER_VERSION,
      port: gamePort,
      rooms,
    };
    const buf = Buffer.from(JSON.stringify(payload));
    for (const target of targets) {
      socket.send(buf, targetPort, target, () => {
        /* 发不出去就算了：对方收不到只是"自动发现"失效，手填地址仍可用 */
      });
    }
  };

  const timer = setInterval(sendOnce, BEACON_INTERVAL_MS);
  // 定时器不该拖着进程不让退出
  timer.unref?.();

  return {
    scan() {
      return listBeacons(neighbours, Date.now()).map((item) => ({
        code: item.code,
        hostName: item.hostName,
        players: item.players,
        maxPlayers: item.maxPlayers,
        address: item.address,
        // ★ 0.3.3：局内房间也要带状态出去（列表据此显示"进行中 · 第 N 回合"）
        phase: item.phase,
        round: item.round,
        version: item.version,
      }));
    },
    poke: sendOnce,
    close() {
      clearInterval(timer);
      try {
        socket.close();
      } catch {
        /* 已经关了 */
      }
    },
  };
}
