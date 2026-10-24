#!/usr/bin/env node
/**
 * ============================================================
 *  0.1.1 的**多人**界面验证（真服务器 + 真浏览器 + 真 WS 客户端）
 * ============================================================
 *
 * 这一批需求里有四条**只有真的凑出多人房间才看得见**：
 *   ① 布阵倒计时最后 10 秒变红（联机才有倒计时）
 *   ② 房主的「改名 / 踢出」按钮（在大厅里、只有房主看得到）
 *   ③ 战斗中切去观战别人的对局（房间 ≥3 人同回合才有 2 场战斗）
 *   ④ 改名弹窗长什么样
 * 所以这个脚本会：
 *   · 起一个真服务器（`scripts/launch.ts`，布阵压到 16 秒，好看清倒计时）
 *   · 开一个无头浏览器当**房主**
 *   · 再用 3 个裸 WebSocket 客户端（不渲染界面）把房间凑成 4 人
 *   · 在关键节点截图 + 断言
 *
 * 用法：
 *   node scripts/mp-e2e-011.mjs                # 跑一遍，截图写到 .ui-e2e/
 *   node scripts/mp-e2e-011.mjs --keep-open    # 不关浏览器 / 不关服务器
 */

import { spawn } from 'node:child_process';
import { accessSync, readFileSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

/*
  ★ 0.1.3：服务端会校验客户端版本（见 packages/server/src/main.ts 的 ensureSameVersion），
  不带的 joinRoom 会被**直接拒绝** —— 那几个"裸 WS 假玩家"就会进不来。
  这个脚本是纯 .mjs（跑不了 TS），所以直接从 shared 的源码里读那一个常量，
  而不是抄一份字符串到这儿（抄的那份迟早和真版本走散）。
*/
const SERVER_VERSION =
  /export const SERVER_VERSION = '([^']+)'/.exec(
    readFileSync(join(repoRoot, 'packages/shared/src/protocol.ts'), 'utf8'),
  )?.[1] ?? '';
const outDir = join(repoRoot, '.ui-e2e');
const DEBUG_PORT = 9343;
const WEB_PORT = 5173;
/** 布阵时长（秒）：留够时间看倒计时从"不红"走到"红"，又不至于等太久 */
const PREP_SECONDS = 16;
const KEEP_OPEN = process.argv.includes('--keep-open');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const log = (m) => process.stdout.write(m + '\n');
function check(ok, what, detail = '') {
  if (ok) log(`  ✅ ${what}`);
  else {
    failures++;
    log(`  ❌ ${what}${detail ? ` —— ${detail}` : ''}`);
  }
}

// ------------------------------------------------------------
//  真服务器（网页 + 联机都在 5173）
// ------------------------------------------------------------
async function startGame() {
  const child = spawn(
    process.execPath,
    [join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(repoRoot, 'scripts', 'launch.ts'), '--no-open', '--no-build'],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        AIRNIGHT_PREP_SECONDS: String(PREP_SECONDS),
        /*
          ★ 从第 3 回合开局：第 1、2 回合是**野怪回合**（每人各打一波野怪，
          4 个人就是 4 场），而这一条验的是"观战其他**对手**的对局" ——
          普通回合 4 个人正好两两配对 = 2 场，最贴近用户描述的场景。
        */
        AIRNIGHT_START_ROUND: '3',
      },
      stdio: 'ignore',
    },
  );
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const ok = await fetch(`http://127.0.0.1:${WEB_PORT}/`)
      .then((r) => r.ok)
      .catch(() => false);
    if (ok) return child;
    await sleep(300);
  }
  child.kill();
  throw new Error('服务器没起来（5173）');
}

// ------------------------------------------------------------
//  浏览器
// ------------------------------------------------------------
const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
];

async function launchBrowser() {
  const exe = BROWSERS.find((p) => {
    try {
      accessSync(p);
      return true;
    } catch {
      return false;
    }
  });
  if (!exe) throw new Error('找不到 Edge / Chrome');
  const profile = join(tmpdir(), `airnight-mp011-${process.pid}`);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  const proc = spawn(
    exe,
    [
      '--headless=new',
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--autoplay-policy=no-user-gesture-required',
      '--window-size=1440,900',
      '--hide-scrollbars',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  const deadline = Date.now() + 25000;
  let ok = false;
  while (Date.now() < deadline) {
    ok = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)
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

async function newPage(url) {
  const created = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(url)}`, {
    method: 'PUT',
  })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
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
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r?.exceptionDetails) throw new Error(r.exceptionDetails.text ?? 'JS 异常');
    return r?.result?.value;
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.bringToFront').catch(() => {});
  return {
    send,
    evaluate,
    exceptions,
    close: async () => {
      await send('Page.close').catch(() => {});
      ws.close();
    },
    async shot(name) {
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      await mkdir(outDir, { recursive: true });
      await writeFile(join(outDir, name), Buffer.from(shot.data, 'base64'));
      log(`  📷 .ui-e2e/${name}`);
    },
    async click(selector) {
      await evaluate(`(() => { const n = document.querySelector(${JSON.stringify(selector)}); if (!n) return false; n.click(); return true; })()`);
    },
    async text(selector) {
      return evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
    },
  };
}

// ------------------------------------------------------------
//  裸 WS 客户端（只为了把房间凑够人数）
// ------------------------------------------------------------
class FakePlayer {
  constructor(name) {
    this.name = name;
    this.inbox = [];
  }
  async connect() {
    this.ws = new WebSocket(`ws://127.0.0.1:${WEB_PORT}`);
    await new Promise((res, rej) => {
      this.ws.addEventListener('open', res, { once: true });
      this.ws.addEventListener('error', () => rej(new Error(`${this.name} 连不上`)));
    });
    this.ws.addEventListener('message', (e) => this.inbox.push(JSON.parse(e.data)));
    return this;
  }
  send(m) {
    this.ws.send(JSON.stringify(m));
  }
  close() {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

// ------------------------------------------------------------
//  main
// ------------------------------------------------------------
let game;
let browser;
try {
  log('启动真服务器（布阵压到 ' + PREP_SECONDS + ' 秒）…');
  game = await startGame();
  log('启动无头浏览器…');
  browser = await launchBrowser();
  const page = await newPage(`http://127.0.0.1:${WEB_PORT}/?server=127.0.0.1:${WEB_PORT}&debug=1`);
  await sleep(6000);

  // ---------------- ① 建房 + 大厅里的房主按钮 ----------------
  log('\n① 大厅：房主的「改名 / 踢出」按钮（只有房主看得到）');
  await page.evaluate(`(() => { const i = document.querySelector('#menu-name-create'); if (i) i.value = '房主'; return true; })()`);
  await page.click('#menu-create-go');
  await sleep(1200);
  const code = ((await page.text('#lobby-code')) ?? '').trim();
  check(/^[A-Z0-9]{6}$/.test(code), `房主建好了房间（${code}）`);

  const guests = [];
  for (const name of ['小红', '阿强', '路人']) {
    const p = await new FakePlayer(name).connect();
    p.send({ t: 'joinRoom', roomCode: code, playerName: name, version: SERVER_VERSION });
    await sleep(250);
    guests.push(p);
  }
  await sleep(900);
  check(
    (await page.evaluate(`document.querySelectorAll('#lobby-players .net-player').length`)) === 4,
    '大厅里是 4 个人',
  );

  const lobby = await page.evaluate(`(() => {
    const rows = [...document.querySelectorAll('#lobby-players .net-player')];
    return {
      renameBtns: document.querySelectorAll('#lobby-players [data-action="rename"]').length,
      kickBtns: document.querySelectorAll('#lobby-players [data-action="kick"]').length,
      firstRowHasButton: Boolean(rows[0]?.querySelector('[data-action="rename"]')),
      orderOk: rows.slice(1).every((r) => {
        const h = r.innerHTML;
        return h.indexOf('改名') < h.indexOf('踢出') && h.indexOf('踢出') < h.indexOf('等待中');
      }),
    };
  })()`);
  check(lobby.renameBtns === 3, '房主看得到 3 个「改名」（自己那一行没有）', String(lobby.renameBtns));
  check(lobby.kickBtns === 3, '房主看得到 3 个「踢出」', String(lobby.kickBtns));
  check(lobby.firstRowHasButton === false, '房主自己那一行没有按钮');
  check(lobby.orderOk === true, '顺序是「改名 -> 踢出 -> 状态」');

  // 打开改名弹窗截一张（这是"界面长什么样"最直观的一张）
  await page.evaluate(`document.querySelectorAll('#lobby-players [data-action="rename"]')[0].click()`);
  await sleep(500);
  check(
    (await page.evaluate(`!document.querySelector('#rename-overlay').classList.contains('hidden')`)) === true,
    '改名弹窗打开了',
  );
  await page.shot('21-房主改名弹窗.png');
  await page.click('#rename-cancel');
  await sleep(300);

  // 真的改一次：把「小红」改成「小红帽」，然后确认大厅里的名字变了
  await page.evaluate(`document.querySelectorAll('#lobby-players [data-action="rename"]')[0].click()`);
  await sleep(300);
  await page.evaluate(`(() => { document.querySelector('#rename-input').value = '小红帽'; return true; })()`);
  await page.click('#rename-ok');
  await sleep(900);
  check(
    (await page.evaluate(`document.querySelector('#lobby-players').textContent.includes('小红帽')`)) === true,
    '改名生效（大厅里显示新名字）',
  );
  await page.shot('22-大厅房主按钮.png');

  // ---------------- ② 开局：倒计时（+ 最后 10 秒变红） ----------------
  log('\n② 布阵倒计时：不闪、最后 10 秒变红');
  await page.click('#btn-lobby-ready');
  for (const p of guests) p.send({ t: 'setReady', ready: true });
  await sleep(600);
  await page.click('#btn-lobby-start');
  await sleep(1800);
  /*
    房主（浏览器这一方）也得有阵容，否则他那一场是"空阵 vs 有人"，
    眨眼就打完了 —— 那样根本来不及切去看别人的对局。
    无头浏览器里拖棋子太脆，所以走 `?debug=1` 的钩子按格子坐标放一个。
  */
  const placed = await page.evaluate(
    `typeof __airnightPlaceForTest === 'function' ? __airnightPlaceForTest('op01', 1, 0, 1) : false`,
  );
  check(placed === true, '房主放好了一个干员（这样他那一场也真的会打起来）');
  await sleep(600);

  const early = await page.evaluate(`(() => {
    const n = document.querySelector('#stat-phase');
    return { text: n.textContent, urgent: n.classList.contains('urgent') };
  })()`);
  check(/^布阵 \d+s$/.test(early.text), `倒计时文字是「${early.text}」`, early.text);
  check(early.urgent === false, '还早的时候不是红的');
  await page.shot('23-布阵倒计时.png');

  /*
    ★ 「闪烁」是这次要修的 bug：倒计时曾被 renderAll 改回没有秒数的「布阵」。
    连续采样 3 秒，任何一次出现不带秒数的版本都算没修好。
  */
  const samples = [];
  for (let i = 0; i < 10; i++) {
    samples.push(await page.text('#stat-phase'));
    await sleep(300);
  }
  check(
    samples.every((t) => /^布阵 \d+s$/.test(t ?? '')),
    '连续采样 10 次全都带秒数（不会再闪成「布阵」）',
    samples.filter((t) => !/^布阵 \d+s$/.test(t ?? '')).join(','),
  );

  // 等进最后 10 秒
  let redSeen = false;
  for (let i = 0; i < 80 && !redSeen; i++) {
    const snap = await page.evaluate(`(() => {
      const n = document.querySelector('#stat-phase');
      return { text: n.textContent, urgent: n.classList.contains('urgent') };
    })()`);
    if (snap.urgent) {
      redSeen = true;
      check(/^布阵 (?:10|[1-9])s$/.test(snap.text), `最后 10 秒变红（此刻「${snap.text}」）`, snap.text);
      await page.shot('24-倒计时红色警示.png');
      break;
    }
    await sleep(300);
  }
  check(redSeen === true, '等到了倒计时变红的那一刻');

  // ---------------- ③ 战斗中观战别人的对局 ----------------
  log('\n③ 战斗中切去观战别人的对局（4 人 = 2 场）');
  // 给 3 个"客人"报一套能打的阵容，确保每人都有仗打（否则观战列表里没有第二场）
  const cells = [
    { col: 0, row: 1 },
    { col: 1, row: 3 },
    { col: 2, row: 5 },
  ];
  const teamOf = (defIds) => defIds.map((defId, i) => ({ defId, star: 1, cell: cells[i % cells.length] }));
  for (const [i, p] of guests.entries()) {
    p.send({
      t: 'submitTeam',
      units: teamOf(i === 0 ? ['op01', 'op03'] : ['op09', 'op13']),
      playerContext: { gold: 10, hp: 100 },
    });
  }
  // 房主自己也要有阵容：直接往棋盘上放不了（无头里点不到 3D），
  // 所以让浏览器里的房主也报一份 —— 用 debug 钩子最省事，没有钩子就等服务器兜底（空阵也能打）
  await page.evaluate(`(() => { if (typeof __airnightPreviewResult === 'function') return true; return false; })()`);

  /*
    等战斗开始 + 观战列表里出现**两场**。
    ★ 别只看 battle-bar：战斗是逐场广播的，第一场到的时候列表里只有 1 条
      （那时切换条按设计是藏起来的），要等第二场也到了才算"能切"。
  */
  let battleStarted = false;
  let chipCount = 0;
  for (let i = 0; i < 80; i++) {
    const state = await page.evaluate(`(() => ({
      bar: !document.querySelector('#battle-bar').classList.contains('hidden'),
      chips: document.querySelectorAll('#spectate-bar .spectate-chip').length,
    }))()`);
    if (state.bar) battleStarted = true;
    if (state.chips >= 2) {
      chipCount = state.chips;
      break;
    }
    await sleep(250);
  }
  check(battleStarted === true, '战斗真的开打了');
  check(chipCount >= 2, `观战列表里有 ${chipCount} 场可切（4 人 = 2 场）`, String(chipCount));

  /*
    ★ 光在 DOM 里"有"不算数 —— 这条必须**真的显示在屏幕上**。
    第一版就踩过：切换条是 `position: fixed` 战斗条后面的静态元素，
    于是它被排到文档流最上面（DOM 查得到、画面上找不到）。
    所以这里量一下它的矩形。
  */
  const barRect = await page.evaluate(`(() => {
    const n = document.querySelector('#spectate-bar');
    const r = n.getBoundingClientRect();
    const cs = getComputedStyle(n);
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), display: cs.display };
  })()`);
  log(`  [几何] #spectate-bar = ${JSON.stringify(barRect)}`);
  check(
    barRect.display !== 'none' && barRect.w > 60 && barRect.h > 8 && barRect.y > 0 && barRect.y < 860,
    '切换条真的显示在屏幕上（不是被挤出可视区）',
    JSON.stringify(barRect),
  );

  if (chipCount >= 2) {
    const before = await page.text('#battle-opponent');
    await page.evaluate(`(() => {
      const chips = [...document.querySelectorAll('#spectate-bar .spectate-chip')];
      const other = chips.find((c) => !c.classList.contains('active'));
      if (other) other.click();
      return Boolean(other);
    })()`);
    await sleep(800);
    const after = await page.evaluate(`(() => ({
      label: document.querySelector('#battle-opponent').textContent,
      active: document.querySelector('#spectate-bar .spectate-chip.active')?.textContent ?? '',
      time: document.querySelector('#battle-time').textContent,
    }))()`);
    check(after.label.includes('旁观'), `切过去之后写着「${after.label}」`, after.label);
    check(after.active.includes('我的战斗') === false, '高亮的换成了别人那一场', after.active);
    const seconds = Number(String(after.time).replace('s', ''));
    check(seconds > 0.2, `观战进度和那一场对齐（已经播到 ${after.time}，不是从 0 重播）`, after.time);
    check(
      String(before) !== String(after.label),
      '切换前后的标题确实不一样',
      `${before} -> ${after.label}`,
    );
    await page.shot('25-战斗中观战别人.png');
  }

  const errs = page.exceptions.filter(Boolean);
  check(errs.length === 0, '页面没有 JS 异常', errs.slice(0, 3).join(' | '));

  for (const p of guests) p.close();
  if (KEEP_OPEN) log('\n(--keep-open) 浏览器和服务器都留着，Ctrl+C 结束');
  else await page.close();
} catch (err) {
  failures++;
  log(`\n💥 ${err.stack ?? err}`);
} finally {
  if (!KEEP_OPEN) {
    browser?.cleanup();
    if (game) {
      try {
        game.kill();
      } catch {
        /* ignore */
      }
    }
  }
}

log(`\n${failures === 0 ? '✅ 全部通过' : `❌ ${failures} 项失败`}`);
process.exit(failures === 0 ? 0 : 1);
