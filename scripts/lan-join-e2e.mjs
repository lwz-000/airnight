#!/usr/bin/env node
/**
 * ============================================================
 *  「便携包联机：输入房间号就能进」的端到端验证
 * ============================================================
 *
 * 用法：
 *   node scripts/lan-join-e2e.mjs                # 跑一遍，截图写到 .chibi-e2e/
 *   node scripts/lan-join-e2e.mjs --keep-open    # 不关浏览器
 *
 * 【它在模拟什么？】
 * 你在自己电脑上双击「启动游戏.cmd」，朋友在他电脑上双击同一份便携包 ——
 * 于是两台机器各自跑着一整套（网页服务器 + 游戏服务器）。
 * 这里用"同一台机器上的两套服务器 + 两个浏览器"把这件事**完整**演一遍：
 *
 *   服务器 A（8811，扮演"我"）      服务器 B（8812，扮演"朋友的本机"）
 *     ↑ 广播到端口 45217               ↑ 广播到端口 45218
 *     └── 监听 45218 ←──────────────────┘ 监听 45217
 *   （两个环境变量把广播方向交叉起来，因为同一台机器没法让两个进程
 *     共用同一个 UDP 端口 —— 真机上是同一个 45217，互相都收得到）
 *
 * 然后：A 的页面建房拿到房间号 → B 的页面**只填房间号**点加入 →
 * 断言 B 的页面最终进了 A 的房间（房间号一致、两边都显示 2 人）。
 *
 * 【为什么非要真开浏览器？】
 * 因为这条链路里最容易坏的是"浏览器侧"：
 *   · 广播能不能让**浏览器**看到（不能，所以走了 lanScan 这一跳）；
 *   · 换服务器地址之后 `pendingAction` 有没有把 joinRoom 补发出去；
 *   · 页面在菜单上换地址时的界面状态。
 * 这些在服务器单测里全看不到（单测只到"服务器会不会回话"为止）。
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { accessSync, existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const distDir = join(repoRoot, 'apps', 'web', 'dist');
const tsxCli = join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const outDir = join(repoRoot, '.chibi-e2e');

const argv = process.argv.slice(2);
const KEEP_OPEN = argv.includes('--keep-open');
const WEB_PORT = 5301;
const HOST_GAME_PORT = 8811;
const PEER_GAME_PORT = 8812;
/** 两个 UDP 端口交叉用：A 听 45218 发到 45217，B 反之（见文件头说明） */
const LAN_PORT_A = 45218;
const LAN_PORT_B = 45217;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
};

const log = (m) => process.stdout.write(m + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startStaticServer() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://127.0.0.1:${WEB_PORT}`);
      let path = decodeURIComponent(url.pathname);
      if (path === '/') path = '/index.html';
      const file = join(distDir, path);
      if (!file.startsWith(distDir) || !existsSync(file)) {
        res.writeHead(404).end('not found');
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, {
        'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'content-length': body.length,
        // 音乐播放要 Range；这里只验证联机，给个最简实现就够（返回 200 全量）
      });
      res.end(body);
    } catch (err) {
      res.writeHead(500).end(String(err));
    }
  });
  return new Promise((r, j) => {
    server.once('error', j);
    server.listen(WEB_PORT, '127.0.0.1', () => r(server));
  });
}

/** 起一个游戏服务器子进程，并把它的 stdout 收起来（后面要断言日志） */
function startGameServer(port, lanPort, lanTarget) {
  const child = spawn(process.execPath, [tsxCli, join('packages', 'server', 'src', 'main.ts')], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '0.0.0.0',
      AIRNIGHT_LAN_PORT: String(lanPort),
      AIRNIGHT_LAN_TARGET_PORT: String(lanTarget),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const lines = [];
  const onData = (chunk) => {
    for (const line of String(chunk).split('\n')) {
      if (line.trim().length > 0) lines.push(line.trim());
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  return { child, lines };
}

const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
];

async function launchBrowser(debugPort, tag) {
  const exe = BROWSERS.find((p) => {
    try {
      accessSync(p);
      return true;
    } catch {
      return false;
    }
  });
  if (!exe) throw new Error('找不到 Edge / Chrome');
  const profile = join(tmpdir(), `airnight-lan-${tag}-${process.pid}`);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  const proc = spawn(
    exe,
    [
      '--headless=new',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--window-size=1440,900',
      '--hide-scrollbars',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  const deadline = Date.now() + 25000;
  let ok = false;
  while (Date.now() < deadline) {
    ok = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
      .then((r) => r.ok)
      .catch(() => false);
    if (ok) break;
    await sleep(200);
  }
  if (!ok) {
    proc.kill();
    throw new Error('DevTools 端口没起来');
  }
  return {
    proc,
    port: debugPort,
    cleanup: () => {
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
      rm(profile, { recursive: true, force: true }).catch(() => {});
    },
  };
}

async function openPage(debugPort, url, tag) {
  const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  const target = list.find((t) => t.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });

  let id = 0;
  const pending = new Map();
  const failures = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === 'Runtime.exceptionThrown') {
      failures.push(String(msg.params.exceptionDetails?.exception?.description ?? '').split('\n')[0]);
    }
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const mid = ++id;
      pending.set(mid, (m) => (m.error ? rej(new Error(`${method}: ${JSON.stringify(m.error)}`)) : res(m.result)));
      ws.send(JSON.stringify({ id: mid, method, params }));
    });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('页面异常: ' + (r.exceptionDetails.exception?.description ?? ''));
    return r.result.value;
  };
  const waitFor = async (expr, timeoutMs = 20000) => {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (await evaluate(expr).catch(() => false)) return true;
      await sleep(150);
    }
    return false;
  };
  const clickSelector = async (sel) => {
    await evaluate(`document.querySelector(${JSON.stringify(sel)})?.click()`);
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(outDir, `${name}.png`), Buffer.from(r.data, 'base64'));
    log(`   截图 ${name}.png`);
  };

  return { send, evaluate, waitFor, clickSelector, shot, failures, tag, close: () => ws.close() };
}

async function main() {
  log('============================================================');
  log('  便携包联机：输入房间号就能进（端到端）');
  log('============================================================');
  if (!existsSync(join(distDir, 'index.html'))) {
    log('✗ 找不到 apps/web/dist/index.html —— 先跑一次构建');
    process.exit(1);
  }
  await mkdir(outDir, { recursive: true });

  const verdicts = [];
  const check = (ok, text) => {
    verdicts.push({ ok, text });
    log(`   ${ok ? '✓' : '✗'} ${text}`);
    return ok;
  };

  const staticServer = await startStaticServer();
  const host = startGameServer(HOST_GAME_PORT, LAN_PORT_A, LAN_PORT_B);
  const peer = startGameServer(PEER_GAME_PORT, LAN_PORT_B, LAN_PORT_A);
  let hostBrowser = null;
  let peerBrowser = null;
  let hostPage = null;
  let peerPage = null;

  try {
    log(`[1] 等两台"机器"上的服务器起来…（A=${HOST_GAME_PORT} / B=${PEER_GAME_PORT}）`);
    const up = async (srv, name) => {
      for (let i = 0; i < 100; i++) {
        if (srv.lines.some((l) => l.includes('联机服务器已启动'))) return true;
        await sleep(120);
      }
      log(`   ✗ ${name} 没起来，最后的输出：`);
      for (const line of srv.lines.slice(-8)) log(`      ${line}`);
      return false;
    };
    if (!(await up(host, 'A'))) throw new Error('A 没起来');
    if (!(await up(peer, 'B'))) throw new Error('B 没起来');
    check(true, '两个游戏服务器都起来了');

    hostBrowser = await launchBrowser(5311, 'host');
    peerBrowser = await launchBrowser(5312, 'peer');

    log('[2] 房主（A）打开游戏 → 创建房间');
    hostPage = await openPage(hostBrowser.port, `http://127.0.0.1:${WEB_PORT}/?server=127.0.0.1:${HOST_GAME_PORT}`, 'host');
    if (!(await hostPage.waitFor(`!!document.querySelector('#main-menu') && !document.querySelector('#main-menu').classList.contains('hidden')`))) {
      throw new Error('A 的主菜单没出来');
    }
    await hostPage.clickSelector('#menu-create');
    await sleep(400);
    await hostPage.clickSelector('#menu-create-go');
    if (!(await hostPage.waitFor(`!document.querySelector('#lobby-overlay').classList.contains('hidden')`, 10000))) {
      throw new Error('A 没进大厅');
    }
    const code = String(await hostPage.evaluate(`document.querySelector('#lobby-code')?.textContent ?? ''`)).trim();
    log(`    房主拿到的房间号：${code}`);
    check(/^[A-Z0-9]{6}$/.test(code), `房间号是 6 位、看着随机（${code}）`);
    await hostPage.shot('lan1-房主建房');

    log('[3] 朋友（B）打开游戏 → 只填房间号加入');
    peerPage = await openPage(peerBrowser.port, `http://127.0.0.1:${WEB_PORT}/?server=127.0.0.1:${PEER_GAME_PORT}`, 'peer');
    if (!(await peerPage.waitFor(`!!document.querySelector('#main-menu') && !document.querySelector('#main-menu').classList.contains('hidden')`))) {
      throw new Error('B 的主菜单没出来');
    }
    await peerPage.clickSelector('#menu-join');
    await sleep(300);
    await peerPage.evaluate(`(() => {
      document.querySelector('#menu-name-join').value = '朋友';
      const input = document.querySelector('#menu-code');
      input.value = ${JSON.stringify(code)};
      input.dispatchEvent(new Event('input'));
      return input.value;
    })()`);
    await peerPage.clickSelector('#menu-join-go');

    const joined = await peerPage.waitFor(`!document.querySelector('#lobby-overlay').classList.contains('hidden')`, 15000);
    await peerPage.shot('lan2-朋友加入');
    check(joined, '朋友只填房间号就进了房间');
    if (joined) {
      const peerCode = String(await peerPage.evaluate(`document.querySelector('#lobby-code')?.textContent ?? ''`)).trim();
      check(peerCode === code, `朋友大厅里的房间号与房主一致（${peerCode}）`);
      const peerCount = await peerPage.evaluate(`document.querySelectorAll('#lobby-players > *').length`);
      check(peerCount === 2, `朋友那边显示 2 个人（实际 ${peerCount}）`);
      const peerServer = await peerPage.evaluate(`document.querySelector('#menu-status')?.textContent ?? ''`);
      log(`    朋友页面状态栏：${JSON.stringify(peerServer)}`);
    }

    log('[4] 房主那边也应该看到 2 个人');
    const hostSaw = await hostPage.waitFor(`document.querySelectorAll('#lobby-players > *').length === 2`, 8000);
    check(hostSaw, '房主的大厅里也变成了 2 个人');
    await hostPage.shot('lan3-房主看到两人');

    log('[5] 服务器日志（确认房间确实建在 A 上、人是进到 A 里的）');
    const hostJoined = host.lines.some((l) => l.includes('加入（当前 2 人）'));
    const hostCreated = host.lines.some((l) => l.includes('新建，房主'));
    check(hostCreated, 'A 的日志里有"新建房间"');
    check(hostJoined, 'A 的日志里有"加入（当前 2 人）"');
    log('    A 的日志（最后 6 行）：');
    for (const line of host.lines.slice(-6)) log(`      ${line}`);

    check(hostPage.failures.length === 0 && peerPage.failures.length === 0, '两个页面都没有异常');
    for (const f of [...hostPage.failures, ...peerPage.failures].slice(0, 5)) log(`      · ${f}`);

    log('');
    const failed = verdicts.filter((v) => !v.ok);
    log('============================================================');
    log(failed.length === 0 ? `  全部通过（${verdicts.length} 项）` : `  有 ${failed.length} 项没过`);
    log('============================================================');
    if (failed.length) process.exitCode = 1;

    if (KEEP_OPEN) {
      log('--keep-open：浏览器和服务器都还开着，Ctrl+C 结束。');
      return;
    }
  } finally {
    if (!KEEP_OPEN) {
      hostPage?.close();
      peerPage?.close();
      hostBrowser?.cleanup();
      peerBrowser?.cleanup();
      try {
        host.child.kill();
        peer.child.kill();
      } catch {
        /* ignore */
      }
      staticServer.close();
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
