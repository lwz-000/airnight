#!/usr/bin/env node
/**
 * ============================================================
 *  ★★ 0.3 联机回归：盟约选秀的**倒计时**到底走不走（真服务器 + 真浏览器）
 * ============================================================
 *
 * 【为什么非要真服务器 + 真浏览器？】
 * jsdom 里那条用例（netplay-ui.test.ts）已经证明"收到 room 广播就会更新数字"，
 * 但用户看到的是**不动**。差别只可能在真实链路上：
 *   · 服务器到底有没有每秒重播房间？
 *   · 浏览器里 WebSocket 消息有没有被打断（比如渲染卡住、异常）？
 *   · 页面上那个数字是不是被别的东西又写回去了（renderAll 的另一条路径）？
 *
 * 所以这里起一个**真的**游戏服务器，用浏览器当房主、用一个原生 ws 当第二个玩家，
 * 然后每 500ms 采一次 `#covenant-timer` 的文本，看它是不是真的在往下掉。
 *
 * 用法：node scripts/netplay-covenant-timer-e2e.mjs
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { accessSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const distDir = join(repoRoot, 'apps', 'web', 'dist');
const outDir = join(repoRoot, '.ui-e2e');
const WEB_PORT = 5306;
const DEBUG_PORT = 9356;
const GAME_PORT = 8796;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.map': 'application/json',
  '.mp3': 'audio/mpeg', '.woff2': 'font/woff2',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => process.stdout.write(m + '\n');
let failures = 0;
const check = (ok, what, detail = '') => {
  if (ok) log(`  ✅ ${what}`);
  else { failures++; log(`  ❌ ${what}${detail ? ` —— ${detail}` : ''}`); }
};

function startStatic() {
  const server = createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    if (p === '/') p = '/index.html';
    let f = join(distDir, p);
    try { await readFile(f); } catch { f = join(distDir, 'index.html'); }
    try {
      const b = await readFile(f);
      res.writeHead(200, { 'Content-Type': MIME[extname(f)] ?? 'application/octet-stream' });
      res.end(b);
    } catch { res.writeHead(404).end(); }
  });
  return new Promise((r) => server.listen(WEB_PORT, '127.0.0.1', () => r(server)));
}

/** 真游戏服务器（tsx 起 packages/server/src/main.ts，标题栏打印端口那条路会自己 listen） */
function startGameServer() {
  const child = spawn(
    process.execPath,
    ['node_modules/tsx/dist/cli.mjs', 'packages/server/src/main.ts'],
    {
      cwd: repoRoot,
      env: { ...process.env, PORT: String(GAME_PORT), AIRNIGHT_COVENANT_SECONDS: '30' },
      stdio: 'ignore',
    },
  );
  return child;
}

const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];

async function launchBrowser() {
  const exe = BROWSERS.find((p) => { try { accessSync(p); return true; } catch { return false; } });
  if (!exe) throw new Error('找不到 Edge / Chrome');
  const profile = join(tmpdir(), `airnight-cvt-${process.pid}`);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  const proc = spawn(exe, [
    '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--autoplay-policy=no-user-gesture-required', '--window-size=1440,900', '--hide-scrollbars',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', 'about:blank',
  ], { stdio: 'ignore' });
  for (let i = 0; i < 120; i++) {
    const ok = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`).then((r) => r.ok).catch(() => false);
    if (ok) break;
    await sleep(200);
  }
  return { proc, cleanup: () => { try { proc.kill(); } catch {} rm(profile, { recursive: true, force: true }).catch(() => {}); } };
}

async function newPage(url) {
  const created = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })
    .then((r) => (r.ok ? r.json() : null)).catch(() => null);
  let target = created?.webSocketDebuggerUrl ? created : null;
  if (!target) {
    const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
    target = list.find((t) => t.type === 'page');
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  let id = 0;
  const pending = new Map();
  const exceptions = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') exceptions.push(String(m.params.exceptionDetails?.exception?.description ?? '').split('\n')[0]);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, (m) => (m.error ? rej(new Error(`${method}: ${JSON.stringify(m.error)}`)) : res(m.result)));
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r?.exceptionDetails) return 'EXC: ' + JSON.stringify(r.exceptionDetails).slice(0, 300);
    return r?.result?.value;
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.bringToFront').catch(() => {});
  return {
    send, evaluate, exceptions,
    async shot(name) {
      const s = await send('Page.captureScreenshot', { format: 'png' });
      await mkdir(outDir, { recursive: true });
      await writeFile(join(outDir, name), Buffer.from(s.data, 'base64'));
      log(`  📷 .ui-e2e/${name}`);
    },
    close: async () => { await send('Page.close').catch(() => {}); ws.close(); },
  };
}

const staticServer = await startStatic();
const gameServer = startGameServer();
const browser = await launchBrowser();
let peer = null;
try {
  // 等游戏服务器 listen
  for (let i = 0; i < 60; i++) {
    const alive = await new Promise((res) => {
      const probe = new WebSocket(`ws://127.0.0.1:${GAME_PORT}`);
      probe.once('open', () => { probe.close(); res(true); });
      probe.once('error', () => res(false));
    });
    if (alive) break;
    await sleep(300);
  }

  const page = await newPage(`http://127.0.0.1:${WEB_PORT}/?server=${encodeURIComponent(`ws://127.0.0.1:${GAME_PORT}`)}`);
  for (let i = 0; i < 40; i++) {
    if ((await page.evaluate(`typeof document.querySelector('#menu-create')?.click === 'function'`)) === true) break;
    await sleep(300);
  }
  await sleep(1500);

  log('\n① 浏览器当房主建个房');
  await page.evaluate(`document.querySelector('#menu-create').click(), 'ok'`);
  await sleep(500);
  await page.evaluate(`(() => {
    const input = document.querySelector('#menu-name-create');
    input.value = '房主甲';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#menu-create-go').click();
    return 'ok';
  })()`);
  await sleep(1500);
  const code = await page.evaluate(`document.querySelector('#lobby-code').textContent.trim()`);
  check(/^[A-Z0-9]{6}$/.test(code), '拿到房间号', code);

  log('\n② 第二个玩家用原生 ws 进来');
  peer = new WebSocket(`ws://127.0.0.1:${GAME_PORT}`);
  let peerId = '';
  await new Promise((res) => peer.once('open', res));
  peer.on('message', (data) => {
    const m = JSON.parse(String(data));
    if (m.t === 'welcome') peerId = m.playerId;
  });
  await sleep(300);
  peer.send(JSON.stringify({ t: 'joinRoom', roomCode: code, playerName: '朋友乙', version: '0.3.0' }));
  await sleep(600);
  peer.send(JSON.stringify({ t: 'setReady', ready: true }));
  await sleep(600);
  const joined = await page.evaluate(`document.querySelectorAll('#lobby-players .net-player').length`);
  check(joined === 2, '大厅里有两个人', String(joined));
  void peerId;

  log('\n③ 房主点「开始游戏」-> 进盟约选秀，采样倒计时 5 秒');
  await page.evaluate(`document.querySelector('#btn-lobby-start').click(), 'ok'`);
  await sleep(1200);
  const opened = await page.evaluate(`!document.querySelector('#covenant-overlay').classList.contains('hidden')`);
  check(opened, '选秀页弹出来了');

  const samples = [];
  for (let i = 0; i < 10; i++) {
    samples.push(await page.evaluate(`document.querySelector('#covenant-timer').textContent.trim()`));
    await sleep(500);
  }
  log(`  采样（每 0.5 秒一次）：${samples.join(' → ')}`);
  const nums = samples.map(Number);
  const distinct = new Set(nums).size;
  check(distinct >= 3, '★★ 倒计时在往下掉（不是一直同一个数字）', `不同值 ${distinct} 个`);
  check(nums[nums.length - 1] < nums[0], '★★ 最后一个采样比第一个小', `${nums[0]} -> ${nums[nums.length - 1]}`);
  // 大约 5 秒真实时间 ⇒ 掉 5 秒左右（允许 ±3 秒误差）
  const dropped = nums[0] - nums[nums.length - 1];
  check(dropped >= 2 && dropped <= 8, '掉的秒数和真实时间大致对得上', `掉了 ${dropped} 秒`);

  await page.shot('97-盟约选秀-倒计时.png');
  if (page.exceptions.length) log(`\n⚠️ 页面 JS 异常：${page.exceptions.slice(0, 3).join(' | ')}`);
  await page.close();
} finally {
  try { peer?.close(); } catch {}
  browser.cleanup();
  staticServer.close();
  try { gameServer.kill(); } catch {}
}
log(failures === 0 ? '\n全部通过' : `\n${failures} 条没过`);
process.exit(failures === 0 ? 0 : 1);
