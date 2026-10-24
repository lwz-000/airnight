#!/usr/bin/env node
/**
 * ★★ 0.2 商店回合：真开一次浏览器，看坎诺特商店的 UI 长什么样。
 *
 * 用法：node scripts/ui-e2e-shop-round.mjs
 * 截图写到 .ui-e2e/20-商店回合-购买页.png / 21-商店回合-售卖页.png
 *
 * 【怎么提前看到商店？】走 `?debug=1` 的 `__airnightForceShopRound()` 钩子，
 * 不伪造回合号、不碰游戏逻辑（见 main.ts 里那个钩子的说明）。
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { accessSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ★ 这个脚本住在 .workbuddy/tmp/（不在仓库里），所以根目录直接写死，
//   别拿 import.meta.url 往上推 —— 推出来的是 E:\AIRNIGHT，dist 就找不到了
const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const distDir = join(repoRoot, 'apps', 'web', 'dist');
const outDir = join(repoRoot, '.ui-e2e');
const PORT = 5299;
const DEBUG_PORT = 9345;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const log = (m) => process.stdout.write(m + '\n');
const check = (ok, what, detail = '') => {
  if (ok) log(`  ✅ ${what}`);
  else { failures++; log(`  ❌ ${what}${detail ? ` —— ${detail}` : ''}`); }
};

function startServer() {
  const server = createServer(async (req, res) => {
    let path = decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname);
    if (path === '/') path = '/index.html';
    let file = join(distDir, path);
    try { await readFile(file); } catch { file = join(distDir, 'index.html'); }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404).end(); }
  });
  return new Promise((res) => server.listen(PORT, '127.0.0.1', () => res(server)));
}

const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
];

async function launchBrowser() {
  const exe = BROWSERS.find((p) => { try { accessSync(p); return true; } catch { return false; } });
  if (!exe) throw new Error('找不到 Edge / Chrome');
  const profile = join(tmpdir(), `airnight-shop-${process.pid}`);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  const proc = spawn(exe, [
    '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--autoplay-policy=no-user-gesture-required', '--window-size=1440,900',
    '--hide-scrollbars',
    /*
      ★ 无头浏览器默认会把"看不见的标签页"的 rAF 掐到几帧一秒。
      商店回合的倒计时靠 rAF 推进 —— 不关掉节流的话，倒计时在本机看着正常、
      在脚本里却一动不动，就会误判成"倒计时不动"那个 bug 又回来了。
    */
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    'about:blank',
  ], { stdio: 'ignore' });
  const deadline = Date.now() + 25000;
  let ok = false;
  while (Date.now() < deadline) {
    ok = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`).then((r) => r.ok).catch(() => false);
    if (ok) break;
    await sleep(200);
  }
  if (!ok) { proc.kill(); throw new Error('DevTools 端口没起来'); }
  return {
    proc,
    cleanup: () => { try { proc.kill(); } catch {} rm(profile, { recursive: true, force: true }).catch(() => {}); },
  };
}

async function newPage(url) {
  const created = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })
    .then((r) => (r.ok ? r.json() : null)).catch(() => null);
  let target = created && created.webSocketDebuggerUrl ? created : null;
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
    const msg = JSON.parse(ev.data);
    if (msg.method === 'Runtime.exceptionThrown') {
      exceptions.push(String(msg.params.exceptionDetails?.exception?.description ?? '').split('\n')[0]);
    }
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, (m) => (m.error ? rej(new Error(`${method}: ${JSON.stringify(m.error)}`)) : res(m.result)));
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r?.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r?.result?.value;
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.bringToFront').catch(() => {});
  return {
    send, evaluate, exceptions,
    close: async () => { await send('Page.close').catch(() => {}); ws.close(); },
    async shot(name) {
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      await mkdir(outDir, { recursive: true });
      await writeFile(join(outDir, name), Buffer.from(shot.data, 'base64'));
      log(`  📷 .ui-e2e/${name}`);
    },
  };
}

const server = await startServer();
log(`static server: ${JSON.stringify(server.address())}`);
log(`self-fetch: ${await fetch(`http://127.0.0.1:${PORT}/index.html`).then((r) => r.status).catch((e) => 'FAIL ' + e)}`);
const browser = await launchBrowser();
try {
  const page = await newPage(`http://127.0.0.1:${PORT}/?debug=1`);
  // ★ 头less + swiftshader 下模块初始化（音乐 / 小人索引 / 字体）要好几秒，
  //   太早调钩子会得到 "is not defined"（那不是 bug，是还没挂上）
  await sleep(6000);

  log('\n① 强行开一次商店回合');
  // ★ 钩子要等模块挂好才有 —— 轮询，别写死一个秒数（写死会在慢机器上假红）
  let hookReady = false;
  for (let i = 0; i < 40; i++) {
    hookReady = (await page.evaluate(`typeof __airnightForceShopRound === 'function'`)) === true;
    if (hookReady) break;
    if (i === 5) {
      log(`  …还在等：href=${await page.evaluate(`location.href`)} egg=${await page.evaluate(`typeof __airnightForceEggShop`)}`);
    }
    await sleep(500);
  }
  check(hookReady, '调试钩子挂上了（?debug=1）');
  // 先进测试模式（有个能看的棋盘），再开商店
  await page.evaluate(`document.querySelector('#menu-test')?.click(), 'ok'`);
  await sleep(2000);
  const info = await page.evaluate(`__airnightForceShopRound()`);
  await sleep(900);
  check(info.phase === 'shop', '阶段切成了 shop', info.phase);
  check(info.slots.length === 8, '货架是 8 格', String(info.slots.length));
  const kinds = info.slots.map((s) => s.kind);
  check(
    JSON.stringify(kinds) === JSON.stringify(['normal','normal','normal','normal','advanced','advanced','operator','traitRelic']),
    '顺序 = 4普通 + 2进阶 + 干员 + 转职',
    kinds.join(','),
  );
  check(info.slots.every((s) => s.name && s.name !== '(无货)'), '每一格都有货', JSON.stringify(info.slots));
  const hasOverlay = await page.evaluate(`!document.querySelector('#shop-round-overlay').classList.contains('hidden')`);
  check(hasOverlay === true, '弹窗真的显示出来了');
  const npcOk = await page.evaluate(`(() => {
    const img = document.querySelector('#shop-round-npc');
    return img.complete && img.naturalWidth > 0;
  })()`);
  check(npcOk === true, '坎诺特立绘加载成功');
  await page.shot('20-商店回合-购买页.png');

  log('\n② 关掉再从金币上方按钮打开');
  await page.evaluate(`document.querySelector('#shop-round-close').click(), 'ok'`);
  await sleep(400);
  const closed = await page.evaluate(`document.querySelector('#shop-round-overlay').classList.contains('hidden')`);
  check(closed === true, '右上角 ✕ 能关掉弹窗');
  const toggleVisible = await page.evaluate(`!document.querySelector('#btn-shop-round').classList.contains('hidden')`);
  check(toggleVisible === true, '金币上方的开关按钮出现了');
  await page.evaluate(`document.querySelector('#btn-shop-round').click(), 'ok'`);
  await sleep(400);
  const reopened = await page.evaluate(`!document.querySelector('#shop-round-overlay').classList.contains('hidden')`);
  check(reopened === true, '开关按钮能再打开弹窗');

  log('\n③ 售卖页');
  // 先买两件藏品，售卖页才有东西可看（顺便把"买"这条链路也走一遍）
  const bought = await page.evaluate(`(() => {
    const slots = [...document.querySelectorAll('#shop-round-slots .shop-round-slot')]
      .filter((n) => !n.classList.contains('sold') && !n.classList.contains('empty'));
    const done = [];
    for (const node of slots.slice(0, 2)) { node.click(); done.push(node.querySelector('.shop-round-slot-name')?.textContent ?? ''); }
    return done;
  })()`);
  await sleep(600);
  await page.evaluate(`document.querySelector('#shop-round-tab-sell').click(), 'ok'`);
  await sleep(400);
  const sellInfo = await page.evaluate(`(() => ({
    mode: document.querySelector('#shop-round-tab-sell').classList.contains('active'),
    slots: document.querySelectorAll('#shop-round-slots .shop-round-slot').length,
    sellBtns: document.querySelectorAll('#shop-round-slots .shop-round-sell-btn').length,
    rerollHidden: document.querySelector('#shop-round-reroll').classList.contains('hidden'),
  }))()`);
  check(sellInfo.mode === true, '售卖页签高亮');
  check(sellInfo.rerollHidden === true, '售卖页不显示刷新按钮');
  check(
    sellInfo.slots > 0 && sellInfo.sellBtns === sellInfo.slots,
    '每一件可卖的藏品下面都有一个「卖出」按钮',
    `买了 ${bought.join('/')}，可卖 ${sellInfo.slots} 件、按钮 ${sellInfo.sellBtns} 个`,
  );
  // 真卖掉一件，钱要真的加回来
  const goldBefore = await page.evaluate(`document.querySelector('#shop-round-gold').textContent`);
  await page.evaluate(`document.querySelector('#shop-round-slots .shop-round-sell-btn')?.click(), 'ok'`);
  await sleep(500);
  const goldAfter = await page.evaluate(`document.querySelector('#shop-round-gold').textContent`);
  log(`  （卖出一件：${goldBefore} -> ${goldAfter}）`);
  await page.shot('21-商店回合-售卖页.png');

  log('\n④ ★★ 倒计时真的在走（用户报的那个 bug：开关按钮上的秒数不动）');
  await page.evaluate(`(() => { globalThis.__rafCount = 0; const loop = () => { globalThis.__rafCount++; requestAnimationFrame(loop); }; requestAnimationFrame(loop); return 'ok'; })()`);
  const read = async () => ({
    panel: Number(await page.evaluate(`document.querySelector('#shop-round-timer').textContent`)),
    toggle: Number(await page.evaluate(`document.querySelector('#shop-round-toggle-timer').textContent.replace('s','')`)),
  });
  const t0 = await read();
  await sleep(5000);
  const t1 = await read();
  const raf = await page.evaluate(`globalThis.__rafCount`);
  /*
    这一条守的是那个真 bug 的**根因**：
    秒数原来只写在 `renderShopRound()`（由 renderAll 调用，而 renderAll 只在
    **事件**发生时跑）⇒ 没人触发事件它就永远停在同一个数。
    现在 `syncShopRoundTimers()` 每帧跑一次，所以哪怕什么都不点，秒数也会掉。
    ★ 弹窗里那个和金币上方那个**两个都要动**（用户报的是后者）。
  */
  check(t1.panel < t0.panel, '弹窗右上角的倒计时在倒数', `${t0.panel} -> ${t1.panel}`);
  check(
    t1.toggle < t0.toggle,
    '★★ 金币上方开关按钮上的倒计时也在倒数（用户报的就是这个不动）',
    `${t0.toggle}s -> ${t1.toggle}s`,
  );
  log(`  （5 秒里 rAF 跑了 ${raf} 帧）`);

  log('\n⑤ 「结束商店」提前收摊');
  const ended = await page.evaluate(`(() => {
    const btn = document.querySelector('#shop-round-end');
    if (!btn) return 'no-button';
    btn.click();
    return 'clicked';
  })()`);
  await sleep(500);
  const after = await page.evaluate(`(() => ({
    overlayHidden: document.querySelector('#shop-round-overlay').classList.contains('hidden'),
    toggleHidden: document.querySelector('#btn-shop-round').classList.contains('hidden'),
    phase: document.querySelector('#stat-phase').textContent,
  }))()`);
  check(ended === 'clicked', '有「结束商店」按钮');
  check(after.overlayHidden === true, '点了之后弹窗收起来了');
  check(after.toggleHidden === true, '金币上方的开关按钮也跟着消失了（商店真的结束了）');
  log(`  （顶栏阶段文字现在是「${after.phase}」）`);

  if (page.exceptions.length) {
    failures++;
    log(`  ❌ 页面有 JS 异常：${page.exceptions.slice(0, 3).join(' | ')}`);
  } else {
    log('  ✅ 页面没有 JS 异常');
  }
  await page.close();
} finally {
  browser.cleanup();
  server.close();
}
log(failures === 0 ? '\n全部通过' : `\n${failures} 条没过`);
process.exit(failures === 0 ? 0 : 1);
