#!/usr/bin/env node
/**
 * 一体化服务器：**一个端口同时干两件事** ——
 *   1. 把打包好的网页发出去（HTTP）
 *   2. 把 WebSocket 连接转给游戏服务器（默认 127.0.0.1:8787）
 *
 * 用法：
 *   node scripts/pnpm.mjs build           先打包
 *   node scripts/pnpm.mjs static          启动（默认 5173，可用 --port= 改）
 *   node scripts/pnpm.mjs server          另开一个终端，跑游戏服务器
 *
 * ============================================================
 *  ★ 为什么要合成一个端口？（这是内网穿透的硬需求）
 * ============================================================
 * 因为穿透服务（SakuraFRP 之类）**一条隧道只能对一个本地端口**。
 * 网页在 5173、游戏服务器在 8787，就得开两条隧道、两个公网地址，
 * 然后把 `http://网页地址/?server=服务器地址` 这样拼起来发给朋友 —— 又多又容易写错。
 *
 * 合成之后只需要**一条隧道**：
 *
 *     朋友  --HTTPS-->  隧道  --HTTP-->  本机 5173
 *                                        ├─ 普通请求  -> 发网页文件
 *                                        └─ WebSocket -> 转给 8787（游戏服务器）
 *
 * 发给朋友的链接就变成（网页和服务器是同一个地址）：
 *
 *     https://你的隧道地址/?server=你的隧道地址
 *
 * ============================================================
 *  为什么是"原样转发"而不是解析 WebSocket？
 * ============================================================
 * 我们不需要看懂 WebSocket 的帧结构 —— 只要把"浏览器发来的字节"转发给 8787、
 * 再把"8787 回的字节"转发给浏览器就够了。这样：
 *   · 不用引入任何 WebSocket 库（零依赖）
 *   · 协议以后怎么改都不用动这里（转发是透明的）
 *   · 不会有"库的版本和服务器对不上"这种问题
 * 唯一的额外工作是把浏览器的握手请求**原样重写**一遍再发出去（见 rawRequest）。
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const defaultDistDir = join(repoRoot, 'apps', 'web', 'dist');

/**
 * ★ 0.1.2：本机对局会话（断线重连用）的落盘位置与路由。
 *
 * 【为什么要落盘？】
 * 会话平时活在内存里；落盘是为了"进程重启也不丢"（比如你手滑关了启动窗口再开）。
 * 它是一个纯运行期文件，不要提交到仓库。
 */
const SESSION_FILE = join(repoRoot, '.airnight-session.json');
const SESSION_ROUTE = '/__airnight/session';
/**
 * ★ 0.3.2：「退出游戏」按钮走这个路由。
 *
 * 【为什么要专门做一条路由，而不是让客户端直接 close 连接？】
 * 因为黑框藏起来之后，玩家唯一的"关掉游戏"入口就是网页上的按钮 ——
 * 而真正需要停掉的是**背后那个 Node 进程**（它管着两个端口 + 局域网广播）。
 * 浏览器没法杀进程，只能"请服务器自己退出"。
 *
 * 【凭什么敢开这个口子？两道锁，缺一不可】
 *   1. **只认本机**：`req.socket.remoteAddress` 必须是 127.0.0.1 / ::1。
 *      局域网里的朋友页面也开着，但他们的请求是 192.168.x.x 发来的，一律 403。
 *   2. **令牌**：启动时随机生成 8 字节，只出现在**本机那条地址**的 `?quit=` 里。
 *      你随便逛的某个网页偷偷 POST 过来（CSRF）猜不到它，也读不到它（同源策略）。
 */
const QUIT_ROUTE = '/__airnight/quit';

/** 占用者多久没来心跳就当成"人已经走了"（毫秒）。客户端每 5 秒跳一次，留 4 倍余量。 */
const OWNER_TTL_MS = 20000;
/** 会话请求体上限（正常只有几百字节，防超大请求） */
const SESSION_BODY_LIMIT = 16384;

/**
 * 后缀 -> Content-Type。
 *
 * 【为什么必须给对？】
 * 因为浏览器对 JS 极其严格：Content-Type 不对（比如给了 text/plain）
 * 它就直接拒绝执行模块，页面上什么都不显示、控制台只有一行 MIME 报错。
 * 这是"服务器能返回 200 但游戏打不开"最常见的原因。
 */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * 把浏览器发来的握手请求**原样**重写成一段字节。
 *
 * 【为什么不能直接用 req.url 拼一个"差不多"的请求？】
 * WebSocket 握手依赖几个头部（Upgrade / Connection / Sec-WebSocket-Key /
 * Sec-WebSocket-Version）。手写很容易漏一个，漏了就握手失败，
 * 而且报错是"连接意外关闭"，完全看不出是头部少了一个。
 * 所以这里用 `rawHeaders`（Node 保留的**原始**头部列表，含大小写和顺序）
 * 整段照抄，只换掉请求行。
 */
function rawRequest(req) {
  let text = `${req.method} ${req.url} HTTP/1.1\r\n`;
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    text += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
  }
  return `${text}\r\n`;
}

/**
 * 造一个"网页 + WebSocket 转发"的服务器。
 * 单独导出是为了能在测试里起一个真的来验证转发确实通。
 */
export function createCombinedServer({
  distDir = defaultDistDir,
  gamePort = 8787,
  quiet = false,
  /** 会话落盘位置（测试可以指向临时文件，免得污染仓库） */
  sessionFile = SESSION_FILE,
  /** 占用者心跳超时（测试可以压到几十毫秒） */
  ownerTtlMs = OWNER_TTL_MS,
  /**
   * 「退出游戏」令牌。空 = 不开放这个接口（单独跑 `pnpm static` 时就是这样）。
   * 由启动器生成并写进本机那条地址的 `?quit=`。
   */
  quitToken = '',
  /** 校验通过时怎么退：由启动器传进来（它才知道要关哪些东西）。 */
  onQuit = null,
} = {}) {
  /** 读回落盘的会话（坏了就当没有） */
  const readSessionFile = () => {
    try {
      if (!existsSync(sessionFile)) return null;
      const parsed = JSON.parse(readFileSync(sessionFile, 'utf8'));
      if (!parsed || typeof parsed.token !== 'string' || !parsed.token) return null;
      return {
        serverUrl: String(parsed.serverUrl ?? ''),
        token: parsed.token,
        roomCode: String(parsed.roomCode ?? ''),
        at: Number(parsed.at ?? 0),
      };
    } catch {
      return null;
    }
  };

  /*
    ============================================================
    ★ 0.1.2：本机对局会话 + 占用仲裁（"一台机器一个玩家"）
    ============================================================
    断线重连的令牌原来存在浏览器的 sessionStorage 里，是**标签页级**的 ——
    关掉标签页（甚至关掉整个浏览器）令牌就没了。而"不小心关了浏览器"
    恰恰是最常见的掉线，所以令牌挪到这里，变成**进程级**（一台机器一份）。

    进程同时充当"谁在玩"的仲裁者：
      · 进房的那个标签页会**认领**占用，并且每 5 秒跳一次心跳；
      · 心跳停了（标签页/浏览器关了）超过 OWNER_TTL_MS，占用自动失效；
      · 别的标签页打开时会看到"本机正在对局中"，可以选择**接管**而不是抢。

    【为什么放在静态服务器，而不是游戏服务器？】
    因为页面就是这个进程发出去的 —— **同源**，浏览器用相对路径 `/__airnight/session`
    就能问到，完全不用关心端口号是多少（便携版端口会顺延）。
    ============================================================
  */
  let machineSession = readSessionFile();
  /** 当前占用者：标签页 id + 最后一次心跳时间（只在内存里，进程重启即清） */
  let sessionOwner = { tab: '', seenAt: 0 };

  const writeSessionFile = () => {
    try {
      if (machineSession) writeFileSync(sessionFile, JSON.stringify(machineSession), 'utf8');
      else if (existsSync(sessionFile)) rmSync(sessionFile, { force: true });
    } catch {
      // 落盘失败不影响运行（内存里那份仍然有效）
    }
  };

  const sendJson = (res, code, body) => {
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(body));
  };

  /**
   * `/__airnight/session` 的三种动作：
   *   GET    -> 读（带 ownerAlive，客户端据此决定"自动接管"还是"提示占用"）
   *   POST   -> `{ tab }` 心跳 / 认领；`{ tab, session }` 存会话并认领；`{ clear: true }` 清空
   *   DELETE -> 清空
   */
  const handleSession = (req, res) => {
    if (req.method === 'GET') {
      sendJson(res, 200, {
        session: machineSession,
        owner: sessionOwner.tab,
        ownerAlive: !!sessionOwner.tab && Date.now() - sessionOwner.seenAt < ownerTtlMs,
      });
      return;
    }

    if (req.method === 'DELETE') {
      machineSession = null;
      sessionOwner = { tab: '', seenAt: 0 };
      writeSessionFile();
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'method not allowed' });
      return;
    }

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > SESSION_BODY_LIMIT) req.destroy();
    });
    req.on('end', () => {
      let message;
      try {
        message = JSON.parse(body || '{}');
      } catch {
        sendJson(res, 400, { ok: false, error: 'bad json' });
        return;
      }

      if (message.clear) {
        machineSession = null;
        sessionOwner = { tab: '', seenAt: 0 };
        writeSessionFile();
        sendJson(res, 200, { ok: true });
        return;
      }

      if (message.session && typeof message.session === 'object') {
        machineSession = {
          serverUrl: String(message.session.serverUrl ?? ''),
          token: String(message.session.token ?? ''),
          roomCode: String(message.session.roomCode ?? ''),
          at: Date.now(),
        };
        writeSessionFile();
      }

      /*
        ★ 必须把"认领"和"心跳"分开 —— 否则会出大问题：
        如果任何带 tab 的请求都算认领，那**被接管**的那个标签页下一次心跳
        就会把自己又认领回来（两边永远互相抢，谁也别想玩）。
        规则：
          · 带 session（进房）或 claim:true（玩家点「接管」）→ 认领
          · 只带 tab → **心跳**：只续自己的占用，绝不抢别人的
      */
      if (typeof message.tab === 'string' && message.tab) {
        const isClaim = message.claim === true || !!message.session;
        if (isClaim) {
          sessionOwner = { tab: message.tab, seenAt: Date.now() };
        } else if (sessionOwner.tab === message.tab) {
          sessionOwner.seenAt = Date.now();
        }
      }

      sendJson(res, 200, {
        ok: true,
        owner: sessionOwner.tab,
        ownerAlive: !!sessionOwner.tab && Date.now() - sessionOwner.seenAt < ownerTtlMs,
      });
    });
  };

  /** 是不是"从这台机器发来的"（去掉 IPv6 映射前缀后比对） */
  const isLoopback = (address) => {
    const bare = String(address ?? '').replace(/^::ffff:/i, '');
    return bare === '127.0.0.1' || bare === '::1';
  };

  /**
   * `/__airnight/quit`：网页上那个「退出游戏」按钮。
   *
   * 【为什么先回 200 再退？】
   * 顺序反了的话，进程先没了 ⇒ 浏览器拿到的是"连接被重置"，
   * 前端只能显示"操作失败"，玩家会以为按钮坏了又连点几次。
   * 先回包、`setTimeout` 一拍再退，前端能拿到确定的 ok。
   */
  const handleQuit = (req, res) => {
    if (!quitToken || typeof onQuit !== 'function') {
      sendJson(res, 404, { ok: false, error: 'quit disabled' });
      return;
    }
    if (!isLoopback(req.socket.remoteAddress)) {
      sendJson(res, 403, { ok: false, error: 'local only' });
      return;
    }
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'method not allowed' });
      return;
    }
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 4096) req.destroy();
    });
    req.on('end', () => {
      let token = '';
      try {
        token = String(JSON.parse(body || '{}').token ?? '');
      } catch {
        sendJson(res, 400, { ok: false, error: 'bad json' });
        return;
      }
      if (token !== quitToken) {
        sendJson(res, 403, { ok: false, error: 'bad token' });
        return;
      }
      sendJson(res, 200, { ok: true });
      // 让这个响应真的发出去再退（同一次事件循环里关服务会把连接掐掉）
      setTimeout(() => {
        try {
          onQuit();
        } catch {
          /* 退失败也不能更糟了 */
        }
      }, 80);
    });
  };

  /** 处理普通 HTTP 请求：发静态文件（`/__airnight/*` 先被接口截走） */
  const serveStatic = (req, res) => {
    const rawPath = decodeURIComponent((req.url ?? '/').split('?')[0]);

    if (rawPath === SESSION_ROUTE) {
      handleSession(req, res);
      return;
    }

    if (rawPath === QUIT_ROUTE) {
      handleQuit(req, res);
      return;
    }

    /*
      防目录穿越：把 `..` 归一化掉，再确认最终路径**确实在 dist 里面**。
      没有这一步的话，`GET /../../../../etc/passwd` 这种请求能读到仓库外的文件。
      虽然这是给朋友玩的服务，但"能读到什么"不该取决于朋友有没有恶意。
    */
    const candidate = normalize(join(distDir, rawPath));
    const insideDist = candidate === distDir || candidate.startsWith(distDir + sep);

    let filePath = insideDist ? candidate : distDir;
    // 目录（或根路径）一律给 index.html
    if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
      filePath = join(distDir, 'index.html');
    }

    const type = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream';

    try {
      const stat = statSync(filePath);

      /*
        ★ Range 支持（0.0.2 加音乐时补的）。
        ============================================================
        没有它的时候 `curl -H "Range: bytes=0-1023"` 会拿回**整个文件**
        （200 + 全量），因为这里只是 readFileSync 然后 res.end。

        浏览器播放 <audio> 时一定会发 Range：先要头部几百字节读时长，
        再按需取片段。拿不到 206 的后果是：
          · 时长要等整个文件下完才知道（我们界面上显示的是索引里的时长，
            所以看不出问题，但浏览器自己的控件是空白的）
          · 拖进度条会从头重新下载，长曲子尤其难受
          · 62 首 mp3 每首 4~6 MB，一次请求就把整个文件塞进内存

        所以这里改成 createReadStream：按 Range 只发需要的区间，
        并且**一定要带 Content-Length**（原来的写法是 chunked，
        浏览器算不出进度）。
        ============================================================
      */
      const range = typeof req.headers.range === 'string' ? req.headers.range.trim() : '';
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);

      if (match && (match[1] || match[2])) {
        const size = stat.size;
        let start = match[1] ? Number(match[1]) : 0;
        let end = match[2] ? Number(match[2]) : size - 1;
        // `bytes=-500` 表示"最后 500 字节"
        if (!match[1] && match[2]) {
          start = Math.max(0, size - Number(match[2]));
          end = size - 1;
        }

        if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
          res.writeHead(416, { 'Content-Range': `bytes */${size}` });
          res.end();
          return;
        }
        end = Math.min(end, size - 1);

        res.writeHead(206, {
          'Content-Type': type,
          'Content-Length': end - start + 1,
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-cache',
        });
        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        createReadStream(filePath, { start, end }).pipe(res);
        return;
      }

      res.writeHead(200, {
        'Content-Type': type,
        'Content-Length': stat.size,
        'Accept-Ranges': 'bytes',
        // 不缓存：你重新 build 之后朋友刷新就能拿到新版，不用教他们清缓存
        'Cache-Control': 'no-cache',
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      createReadStream(filePath).pipe(res);
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`读不到文件：${filePath}\n${String(error)}`);
    }
  };

  const server = createServer(serveStatic);

  /*
    只拦 "升级为 WebSocket" 的请求，转给游戏服务器。
    其余流量照常走上面的 serveStatic —— 所以一个端口两种服务。
  */
  server.on('upgrade', (req, clientSocket, head) => {
    const upstream = connect({ port: gamePort, host: '127.0.0.1' });

    // 游戏这种小包频繁的场景，关掉 Nagle 能明显降延迟（免得两个小包被合起来发）
    upstream.setNoDelay(true);
    clientSocket.setNoDelay(true);

    const closeBoth = () => {
      upstream.destroy();
      clientSocket.destroy();
    };

    upstream.on('error', () => {
      /*
        游戏服务器没开的时候，**要回一个明确的错误**而不是让连接挂着。
        否则浏览器那边只会看到"连接被关闭"，你会以为是隧道或防火墙的问题。
        （这也是个很常见的坑：忘了开 `node scripts/pnpm.mjs server`。）
      */
      if (!clientSocket.destroyed) {
        clientSocket.end(
          'HTTP/1.1 502 Bad Gateway\r\n' +
            'Content-Type: text/plain; charset=utf-8\r\n' +
            'Connection: close\r\n\r\n' +
            '游戏服务器没有在运行。请在另一个终端执行： node scripts/pnpm.mjs server\n',
        );
      }
      closeBoth();
    });

    upstream.on('connect', () => {
      upstream.write(rawRequest(req));
      if (head && head.length > 0) upstream.write(head);
      // 双向透传：之后浏览器和游戏服务器之间说什么，我们都不管
      clientSocket.pipe(upstream);
      upstream.pipe(clientSocket);
    });

    clientSocket.on('error', closeBoth);
    clientSocket.on('close', () => upstream.destroy());
    upstream.on('close', () => clientSocket.destroy());
  });

  server.combined = { distDir, gamePort, quiet };
  return server;
}

// ============================================================
// 直接运行这个文件时：起服务器并打印地址
// ============================================================
const isDirectRun = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  const args = process.argv.slice(2);
  const port = Number(
    args.find((item) => item.startsWith('--port='))?.slice('--port='.length) ?? process.env.PORT ?? 5173,
  );
  const gamePort = Number(
    args.find((item) => item.startsWith('--game='))?.slice('--game='.length) ??
      process.env.GAME_PORT ??
      8787,
  );

  if (!existsSync(join(defaultDistDir, 'index.html'))) {
    console.error('');
    console.error('❌ 还没打包（找不到 apps/web/dist/index.html）。先运行：');
    console.error('');
    console.error('     node scripts/pnpm.mjs build');
    console.error('');
    process.exit(1);
  }

  const server = createCombinedServer({ gamePort });
  server.listen(port, '0.0.0.0', () => {
    const addresses = [];
    for (const list of Object.values(networkInterfaces())) {
      for (const info of list ?? []) {
        if (info.family !== 'IPv4' || info.internal) continue;
        if (info.address.startsWith('169.254.')) continue;
        addresses.push(info.address);
      }
    }

    console.log('');
    console.log('════════════════════════════════════════════════════════');
    console.log('  网页 + 联机 合并在同一个端口（穿透只需要一条隧道）');
    console.log('════════════════════════════════════════════════════════');
    console.log('');
    console.log(`  本机网页：      http://localhost:${port}`);
    for (const address of addresses) {
      console.log(`  同一个 WiFi：   http://${address}:${port}`);
    }
    console.log('');
    console.log(`  WebSocket 会转发到 127.0.0.1:${gamePort} —— 所以要另开一个终端：`);
    console.log('      node scripts/pnpm.mjs server');
    console.log('');
    console.log('  【内网穿透只建一条隧道】指向本机端口 ' + port + '（不是 8787）。');
    console.log('  发给朋友的链接 = 网页地址 + ?server=同一个地址，例如：');
    console.log('      https://你的隧道地址/?server=你的隧道地址');
    console.log('');
    console.log('  想确认朋友能不能连上： node scripts/pnpm.mjs share');
    console.log('  停止：在这个窗口按 Ctrl+C');
    console.log('');
  });
}
