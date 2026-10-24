/**
 * 「网页 + 联机合并在同一个端口」的端到端测试。
 *
 * ============================================================
 *  为什么需要这个？
 * ============================================================
 * 因为内网穿透**一条隧道只能对一个本地端口**。
 * 网页在 5173、游戏服务器在 8787 的话，就得开两条隧道、两个公网地址，
 * 然后把 `https://网页地址/?server=服务器地址` 拼起来发给朋友 —— 又多又容易写错。
 *
 * 所以 `scripts/serve-static.mjs` 现在一个端口干两件事：
 *   · 普通 HTTP 请求  -> 发打包好的网页
 *   · WebSocket 升级  -> 原样转发给 127.0.0.1:8787
 *
 * 这个测试**真的启动游戏服务器**，然后**通过合并端口**连上去 ping 一下 ——
 * 也就是完整走一遍"朋友的浏览器 → 隧道 → 我们的端口 → 游戏服务器"这条路。
 * 只测"HTTP 能拿到网页"是不够的：那样转发那一半坏了也发现不了，
 * 而它的表现恰好是"网页能打开、但点联机一直重连"，最难查。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket, type WebSocketServer } from 'ws';
import { createCombinedServer } from '../../../scripts/serve-static.mjs';

/*
  阻止 main.ts 在被 import 时**自动启动**服务器。
  【为什么必须写在 import 之前？】
  因为 main.ts 的最后一行是"直接运行就启动监听"。测试需要自己控制端口
  （传 0 让系统分配），如果不挡住，import 的那一刻它就会去抢 8787 ——
  而你开发时很可能正开着服务器，于是报 EADDRINUSE，
  而且这个错是**在 import 阶段抛的**，看起来跟测试内容毫无关系。
*/
process.env.AIRNIGHT_NO_AUTOSTART = '1';
const { startServer } = await import('../src/main.js');
/**
 * 一个会**先记住所有收到的消息**的测试客户端。
 *
 * 【为什么不直接写"连上之后再等 welcome"？——这里踩过一次】
 * 因为服务器在**握手成功的那一刻**就把 welcome 发出来了。
 * 如果你的消息监听是"等 open 之后再挂上去"，那条 welcome 早就到了、被丢掉了，
 * 然后你会一直等一条永远不来的消息、超时失败 ——
 * 看起来像"转发坏了"，其实是测试自己的时序问题。
 *
 * 所以：**创建连接的同时就把监听挂上**，消息进了收件箱再慢慢取。
 * 这也顺便让"同一条消息等两次"变得安全（收件箱里已经有了）。
 */
function connect(url: string, timeoutMs = 5000): {
  socket: WebSocket;
  open: () => Promise<void>;
  waitFor: (type: string) => Promise<Record<string, unknown>>;
} {
  const socket = new WebSocket(url);
  const inbox: Array<Record<string, unknown>> = [];
  const waiters: Array<{ type: string; resolve: (value: Record<string, unknown>) => void }> = [];

  socket.on('message', (data: unknown) => {
    const parsed = JSON.parse(String(data)) as Record<string, unknown>;
    inbox.push(parsed);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i]!.type !== parsed['t']) continue;
      waiters[i]!.resolve(parsed);
      waiters.splice(i, 1);
    }
  });

  return {
    socket,
    open: () =>
      new Promise<void>((resolve, reject) => {
        if (socket.readyState === WebSocket.OPEN) return resolve();
        const timer = setTimeout(() => reject(new Error(`连接超时：${url}`)), timeoutMs);
        socket.once('open', () => {
          clearTimeout(timer);
          resolve();
        });
        socket.once('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
      }),
    waitFor: (type: string) => {
      const found = inbox.find((message) => message['t'] === type);
      if (found) return Promise.resolve(found);
      return new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`没等到 ${type} 消息`)), timeoutMs);
        waiters.push({
          type,
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
        });
      });
    },
  };
}

describe('合并端口：一个端口同时发网页和转发联机', () => {
  let game: { wss: WebSocketServer; close: () => void };
  let gamePort = 0;
  let combined: ReturnType<typeof createCombinedServer>;
  let webPort = 0;
  let distDir = '';

  beforeAll(async () => {
    /*
      ============================================================
      ★ 为什么测试要自己造一个 dist，而不是用 apps/web/dist？
      ============================================================
      默认的 distDir 是打包产物目录。这带来两个坑：

        1. 没跑过 `build` 的时候目录根本不存在 -> 测试红，
           但红的原因和"端口合并"这件事毫无关系；
        2. **打包过程中这个目录会被清空**（vite build 先清 outDir 再写入），
           所以只要有人的启动器正在打包，这一瞬间请求 `/` 就会拿到 500。

      第 2 条我实际踩到了：一边双击启动器（它在打包）一边跑测试，
      得到 `expected 500 to be 200`。**这不是产品 bug，却让测试随机红** ——
      而随机红的测试最坏的地方是：你会开始怀疑自己刚改的代码。

      自己造一个最小 dist，测试就和"打没打包""有没有人在打包"彻底解耦了。
      这一条测的是**转发管线**（MIME、目录穿越防护、WebSocket 升级），
      不是"vite 打包出来的东西对不对"。
    */
    distDir = mkdtempSync(join(tmpdir(), 'airnight-dist-'));
    writeFileSync(
      join(distDir, 'index.html'),
      '<!doctype html>\n<html lang="zh-CN">\n  <head><meta charset="utf-8" /><title>AIRNIGHT 合并端口测试页</title></head>\n' +
        '  <body><div id="app">这个文件是测试自己造的，不是打包产物</div></body>\n</html>\n',
    );

    /*
      再放一个"二进制大文件"，用来测 Range（音乐就是这个场景）。
      内容是可预测的：第 i 个字节 = i % 256，这样断言区间时能直接核对。
    */
    mkdirSync(join(distDir, 'music'), { recursive: true });
    writeFileSync(join(distDir, 'music', 't001.mp3'), Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256)));

    // 游戏服务器：端口传 0 让系统随便分配，避免和正在跑的开发服务器撞端口
    game = startServer(0, '127.0.0.1');
    if (!game.wss.address()) {
      await new Promise<void>((resolve) => game.wss.once('listening', () => resolve()));
    }
    const gameAddress = game.wss.address();
    gamePort = typeof gameAddress === 'object' && gameAddress ? gameAddress.port : 0;
    expect(gamePort, '游戏服务器应该拿到一个端口').toBeGreaterThan(0);

    combined = createCombinedServer({ distDir, gamePort, quiet: true });
    await new Promise<void>((resolve) => combined.listen(0, '127.0.0.1', () => resolve()));
    const webAddress = combined.address();
    webPort = typeof webAddress === 'object' && webAddress ? webAddress.port : 0;
    expect(webPort, '合并端口应该拿到一个端口').toBeGreaterThan(0);
  });

  afterAll(() => {
    combined?.close();
    game?.close();
    if (distDir) rmSync(distDir, { recursive: true, force: true });
  });

  it('同一个端口上：普通请求拿到网页，WebSocket 升级转发给游戏服务器', async () => {
    // --- 一半：普通 HTTP 请求拿到打包好的网页 ---
    const page = await fetch(`http://127.0.0.1:${webPort}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type'), 'HTML 的 Content-Type 必须对').toContain('text/html');
    const html = await page.text();
    expect(html.length).toBeGreaterThan(100);

    // --- 另一半：WebSocket 升级要真的被转到 8787 ---
    const client = connect(`ws://127.0.0.1:${webPort}`);
    await client.open();
    // 游戏服务器在握手成功那一刻就会发 welcome（说明握手确实到了它那里）
    const welcome = await client.waitFor('welcome');
    expect(welcome['playerId'], 'welcome 里应该带 playerId').toBeTruthy();

    // 再走一次完整的往返，确认不只是"连上了"，而是**双向**都通
    client.socket.send(JSON.stringify({ t: 'ping' }));
    const pong = await client.waitFor('pong');
    expect(pong['serverTime'], 'pong 里应该带服务器时间').toBeTruthy();

    client.socket.close();
  });

  /*
    ============================================================
    ★ Range 支持（加背景音乐时补的）
    ============================================================
    浏览器播放 <audio> 一定会先发一个 Range 请求探头部（读时长），
    再按需取片段。原来的静态服务是 readFileSync + res.end，
    对 Range 视而不见 —— 一律回 200 + 整个文件。

    后果不是"听不了"，而是更难发现的那些：
      · 响应是 chunked、没有 Content-Length，浏览器算不出进度
      · 拖进度条要重下整首（一首 4~6 MB）
      · 62 首曲子每请求一次就把整个文件读进内存

    这里用自己造的 1000 字节文件断言区间内容，
    这样"发多了/发错了位置"也能查出来，不只是看状态码。
  */
  it('★ Range 请求返回 206 与正确的 Content-Range', async () => {
    const res = await fetch(`http://127.0.0.1:${webPort}/music/t001.mp3`, {
      headers: { Range: 'bytes=100-199' },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 100-199/1000');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-length')).toBe('100');

    const body = Buffer.from(await res.arrayBuffer());
    expect(body.length).toBe(100);
    // 内容必须是原文件第 100..199 字节（第 i 字节 = i % 256）
    expect(body[0]).toBe(100);
    expect(body[99]).toBe(199);
  });

  it('★ 支持后缀区间 bytes=-N（浏览器 seek 到末尾时用）', async () => {
    const res = await fetch(`http://127.0.0.1:${webPort}/music/t001.mp3`, {
      headers: { Range: 'bytes=-50' },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 950-999/1000');
    expect(Buffer.from(await res.arrayBuffer()).length).toBe(50);
  });

  it('★ 不带 Range 时回 200 且带 Content-Length（不再是 chunked）', async () => {
    const res = await fetch(`http://127.0.0.1:${webPort}/music/t001.mp3`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe('1000');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-type')).toContain('audio/mpeg');
  });

  it('★ 越界的 Range 回 416，而不是把整个文件发回去', async () => {
    const res = await fetch(`http://127.0.0.1:${webPort}/music/t001.mp3`, {
      headers: { Range: 'bytes=99999-' },
    });
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe('bytes */1000');
  });

  it('★ 游戏服务器没开时回 502，而不是让浏览器的连接挂着', async () => {    /*
      这是一个很常见的坑：忘了开 `node scripts/pnpm.mjs server`。
      如果不主动回错误，浏览器只会看到"连接被关闭"，
      你会先去怀疑隧道、怀疑防火墙，白折腾一轮。
    */
    const orphan = createCombinedServer({ distDir, gamePort: 59999, quiet: true });
    await new Promise<void>((resolve) => orphan.listen(0, '127.0.0.1', () => resolve()));
    const address = orphan.address();
    const orphanPort = typeof address === 'object' && address ? address.port : 0;

    const status = await new Promise<number | string>((resolve) => {
      const socket = new WebSocket(`ws://127.0.0.1:${orphanPort}`);
      const timer = setTimeout(() => resolve('超时（说明连接被挂住了）'), 4000);
      socket.on('unexpected-response', (_req, res) => {
        clearTimeout(timer);
        resolve(res.statusCode ?? 0);
        socket.terminate();
      });
      socket.on('error', (error) => {
        clearTimeout(timer);
        resolve(`error: ${error.message}`);
      });
    });

    expect(status, '应该回一个明确的 502').toBe(502);
    orphan.close();
  });
});

/*
  ============================================================
  ★ 0.1.2：本机对局会话接口（"一台机器一个玩家" + 关浏览器能回来）
  ============================================================
  断线重连的令牌原来存在浏览器的 sessionStorage 里，是**标签页级**的 ——
  关掉标签页、关掉浏览器就没了。而"不小心关了浏览器"恰恰是最常见的掉线，
  那条路一走就再也回不到对局。

  现在令牌由**本机进程**保管（就是上面这个合并端口的服务器），并且顺手当
  "谁在玩"的仲裁者：进房的那个标签页认领占用、每 5 秒心跳一次；
  心跳停了就当成"人走了"，别的标签页可以自动接管。

  这里测**进程那一半**（存 / 读 / 心跳 / 接管 / 清空 / 超时）；
  客户端那一半在 apps/web/test/machine-session.test.ts。
*/
describe('★ 本机对局会话接口（/__airnight/session）', () => {
  let server: ReturnType<typeof createCombinedServer>;
  let port = 0;
  let sessionFile = '';
  let dir = '';

  const url = (path: string) => `http://127.0.0.1:${port}${path}`;

  const get = async () =>
    (await (await fetch(url('/__airnight/session'))).json()) as {
      session: { serverUrl: string; token: string; roomCode: string } | null;
      owner: string;
      ownerAlive: boolean;
    };

  const post = async (body: unknown) =>
    (await (
      await fetch(url('/__airnight/session'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    ).json()) as Record<string, unknown>;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'airnight-session-'));
    sessionFile = join(dir, 'session.json');
    // ★ 占用超时压到 80ms，这样"占用者没心跳了"这条能在测试里真的等到
    server = createCombinedServer({
      distDir: join(dir, 'web'),
      gamePort: 59999,
      quiet: true,
      sessionFile,
      ownerTtlMs: 80,
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    port = typeof address === 'object' && address ? address.port : 0;
    expect(port, '会话接口服务器应该拿到一个端口').toBeGreaterThan(0);
  });

  afterAll(() => {
    server?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('一开始什么都没有', async () => {
    const state = await get();
    expect(state.session).toBeNull();
    expect(state.owner).toBe('');
    expect(state.ownerAlive).toBe(false);
  });

  it('★ 存会话时会**认领占用**，并且落盘（进程重启也不丢）', async () => {
    const reply = await post({
      tab: 'tab-A',
      session: { serverUrl: 'ws://192.168.1.5:8787', token: 'tok-1', roomCode: 'A7K2M9' },
    });
    expect(reply['ok']).toBe(true);

    const state = await get();
    expect(state.session, '读回来应该还是那三样').toMatchObject({
      serverUrl: 'ws://192.168.1.5:8787',
      token: 'tok-1',
      roomCode: 'A7K2M9',
    });
    expect(state.owner).toBe('tab-A');
    expect(state.ownerAlive).toBe(true);

    // 落盘：另起一个服务器实例（= 进程重启）读同一个文件，令牌应该还在
    const reopened = createCombinedServer({
      distDir: join(dir, 'web'),
      gamePort: 59999,
      quiet: true,
      sessionFile,
    });
    await new Promise<void>((resolve) => reopened.listen(0, '127.0.0.1', () => resolve()));
    const address = reopened.address();
    const reopenedPort = typeof address === 'object' && address ? address.port : 0;
    const after = (await (await fetch(`http://127.0.0.1:${reopenedPort}/__airnight/session`)).json()) as {
      session: { token: string } | null;
    };
    expect(after.session?.token, '进程重启后令牌应该还在').toBe('tok-1');
    reopened.close();
  });

  it('★ 另一个标签页可以**接管**：占用换成它，会话本身不动', async () => {
    const reply = await post({ tab: 'tab-B', claim: true });
    expect(reply['owner']).toBe('tab-B');
    const state = await get();
    expect(state.owner).toBe('tab-B');
    expect(state.session?.token, '接管不该动会话本身').toBe('tok-1');
  });

  it('★★ 心跳只续自己的占用，绝不抢别人的（否则被接管的一方会把自己认领回来）', async () => {
    await post({ tab: 'tab-owner', claim: true });
    // 只带 tab = 心跳；它不是占用者，所以什么都不该发生
    await post({ tab: 'tab-intruder' });
    expect((await get()).owner, '心跳不该改占用者').toBe('tab-owner');
  });

  it('★★ 占用者没心跳超过超时 -> ownerAlive 变 false（"关浏览器重开能自动接管"的依据）', async () => {
    await post({ tab: 'tab-C', claim: true });
    expect((await get()).ownerAlive).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 140));
    const state = await get();
    expect(state.owner, '占用者是谁还记着（只是不算活着了）').toBe('tab-C');
    expect(state.ownerAlive, '心跳断了就该判成"人走了"').toBe(false);
  });

  it('★ 清空之后会话和占用都没了（主动退出房间时走这条）', async () => {
    const res = await fetch(url('/__airnight/session'), { method: 'DELETE' });
    expect(res.status).toBe(200);
    const state = await get();
    expect(state.session).toBeNull();
    expect(state.owner).toBe('');
    expect(existsSync(sessionFile), '落盘文件也该一起删掉').toBe(false);
  });

  it('坏 JSON 不会把服务器弄崩', async () => {
    const res = await fetch(url('/__airnight/session'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ 这不是 json',
    });
    expect(res.status).toBe(400);
    expect((await get()).session).toBeNull();
  });
});
