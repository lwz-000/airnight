#!/usr/bin/env node
/**
 * ============================================================
 *  走路（移动动画 + 平滑位移）在**真实游戏里**的端到端验证
 * ============================================================
 *
 * 用法：
 *   node scripts/walk-e2e.mjs                  # 跑一遍，截图写到 .chibi-e2e/
 *   node scripts/walk-e2e.mjs --keep-open      # 不关浏览器
 *   node scripts/walk-e2e.mjs --port 5291       # 换端口
 *
 * 【为什么要单独写一个脚本？】
 * "走路变平滑了、走路动作播出来了"这两件事，**光看代码和单测都证明不了**：
 *   · 单测能证明位移公式是线性的，但证明不了运行时每帧真的在动；
 *   · 走路动作有没有播，只有运行时 `current` 这个键变成 `move` 才算数；
 *   · 最容易踩的坑是**转错精灵层**（把前倾写在卡片那层 → 整张卡框歪掉，
 *     而小人自己纹丝不动），这种错误代码上看完全正常、构建也全绿。
 * 所以这里真开一次浏览器：摆一个**近战野怪**在对面半场 + 一个我方单位，
 * 开打，然后按时间采样 `__airnightMotionProbe`，核对三件事：
 *
 *   ① 有走路素材的单位（野怪），在**位移期间**必须真的在播 `move`；
 *   ② 位移是**小步连续**的 —— 每采样一次的位移量都在"一步"的量级，
 *      没有"一帧跳好几格"（那是瞬移，而不是走路）；
 *   ③ 没有走路素材的单位（干员）走的是程序化走姿 —— 前倾角度必须真的非 0。
 *
 * 采样脚手架（静态服务器 / 无头 Edge / CDP）和 chibi-e2e.mjs 同一套，
 * 这里独立一份是为了让两个脚本互不影响。
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
const outDir = join(repoRoot, '.chibi-e2e');

const argv = process.argv.slice(2);
const argOf = (n, d) => {
  const i = argv.findIndex((a) => a === `--${n}` || a.startsWith(`--${n}=`));
  if (i < 0) return d;
  const hit = argv[i];
  if (hit.includes('=')) return hit.split('=').slice(1).join('=');
  return argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const PORT = Number(argOf('port', '5291'));
const KEEP_OPEN = argv.includes('--keep-open');
/** 摆哪只野怪（要近战、要走得远才有得看） */
const MONSTER = argOf('monster', 'mn_demon');
/** 我方放哪只（随便一只近战就行） */
const MINE = argOf('mine', 'op11');

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
};

const log = (m) => process.stdout.write(m + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
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
      });
      res.end(body);
    } catch (err) {
      res.writeHead(500).end(String(err));
    }
  });
  return new Promise((r, j) => {
    server.once('error', j);
    server.listen(PORT, '127.0.0.1', () => r(server));
  });
}

const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
];

async function launchBrowser(debugPort) {
  const exe = BROWSERS.find((p) => {
    try {
      accessSync(p);
      return true;
    } catch {
      return false;
    }
  });
  if (!exe) throw new Error('找不到 Edge / Chrome');

  const profile = join(tmpdir(), `airnight-walk-${process.pid}`);
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

async function openPage(debugPort, url) {
  const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  const target = list.find((t) => t.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });

  let id = 0;
  const pending = new Map();
  const consoleLines = [];
  const failures = [];

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === 'Runtime.consoleAPICalled') {
      consoleLines.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
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
  const clickAt = async (x, y) => {
    const base = { x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 };
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...base, button: 'none' });
    await sleep(30);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base });
    await sleep(30);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base });
    await sleep(90);
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(outDir, `${name}.png`), Buffer.from(r.data, 'base64'));
    log(`   截图 ${name}.png`);
  };

  return { send, evaluate, waitFor, clickSelector, clickAt, shot, consoleLines, failures, close: () => ws.close() };
}

/** 用修改器发一只单位（`?debug=1` 无关，测试模式里就有） */
async function grant(page, defId) {
  return page.evaluate(`(() => {
    const sel = document.querySelector('#modifier-unit');
    if (!sel) return 'no-select';
    const opt = [...sel.options].find((o) => o.value === ${JSON.stringify(defId)});
    if (!opt) return 'no-option:' + ${JSON.stringify(defId)};
    sel.value = ${JSON.stringify(defId)};
    sel.dispatchEvent(new Event('change'));
    document.querySelector('#modifier-grant')?.click();
    return 'ok';
  })()`);
}

const countBench = (page) =>
  page.evaluate(`document.querySelectorAll('#bench-slots > .bench-slot:not(.empty)').length`);

/** 把备战席上第 i 个棋子放到 (col,row)（坐标走拾取探针换算，不用手写像素） */
async function placeAt(page, benchIndex, col, row) {
  const before = await countBench(page);
  if (before <= 0) return false;
  await page.evaluate(`document.querySelectorAll('#bench-slots > .bench-slot:not(.empty)')[${benchIndex}]?.click()`);
  await sleep(140);
  const pt = await page.evaluate(
    `(() => { const p = globalThis.__airnightPointerProbe?.project?.({col: ${col}, row: ${row}}); return p && Number.isFinite(p.x) ? {x: p.x, y: p.y} : null; })()`,
  );
  if (!pt) return false;
  await page.clickAt(pt.x, pt.y);
  await page.evaluate(`document.querySelector('#unit-info-close')?.click(), true`);
  await sleep(160);
  return (await countBench(page)) < before;
}

/** 战斗进行中的采样：每 70ms 采一帧，把探针数据加上时间戳 */
async function sampleTimeline(page, ms, everyMs = 70) {
  const frames = [];
  const start = Date.now();
  while (Date.now() - start < ms) {
    const rows = await page
      .evaluate(`(() => globalThis.__airnightMotionProbe?.sample?.() ?? null)()`)
      .catch(() => null);
    /*
      ★ 0.1.4：同一帧里顺便采一次**攻击特效探针**。
      攻击特效只有 0.13~0.3 秒，截图很可能正好落在两次攻击之间（拍到的是一片干净的棋盘），
      所以"到底有没有冒火花"必须靠运行时自己数，不能靠截图碰运气。
      采样脚手架复用这里（场景正好是"重野怪 vs 轻干员"，就是要对比的两类），
      不另抄一份 250 行的 e2e —— 见文件尾部的特效断言。
    */
    const fx = await page
      .evaluate(`(() => globalThis.__airnightAttackFxProbe?.sample?.() ?? null)()`)
      .catch(() => null);
    frames.push({ t: Date.now() - start, rows: rows ?? [], fx: fx ?? null });
    await sleep(everyMs);
  }
  return frames;
}

/** 把采样时间轴按单位拆开，算位移 */
function analyze(frames) {
  const per = new Map();
  for (const frame of frames) {
    for (const row of frame.rows) {
      const key = `${row.team}:${row.defId}`;
      if (!per.has(key)) per.set(key, { defId: row.defId, team: row.team, hasMove: row.hasMove, samples: [] });
      per.get(key).samples.push({ t: frame.t, x: row.x, y: row.y, anim: row.anim, frame: row.frame, lean: row.lean });
    }
  }

  const out = [];
  for (const [key, unit] of per) {
    const s = unit.samples;
    let moving = 0;
    let moveAnimWhileMoving = 0;
    let maxDelta = 0;
    let maxLean = 0;
    let consecutiveRun = 0;
    let bestRun = 0;
    const anims = new Set();
    for (let i = 0; i < s.length; i++) {
      anims.add(s[i].anim);
      maxLean = Math.max(maxLean, Math.abs(s[i].lean));
      if (i === 0) continue;
      const d = Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y);
      maxDelta = Math.max(maxDelta, d);
      // 0.02 个格子以上算"在动"（静止时的待机浮动远小于它）
      if (d > 0.02) {
        moving++;
        if (s[i].anim === 'move') {
          moveAnimWhileMoving++;
          consecutiveRun++;
          bestRun = Math.max(bestRun, consecutiveRun);
        } else {
          consecutiveRun = 0;
        }
      } else {
        consecutiveRun = 0;
      }
    }
    out.push({ key, ...unit, moving, moveAnimWhileMoving, maxDelta, maxLean, bestRun, anims: [...anims] });
  }
  return out;
}

async function main() {
  log('============================================================');
  log('  走路（移动动画 + 平滑位移）的端到端验证');
  log('============================================================');

  if (!existsSync(join(distDir, 'index.html'))) {
    log('✗ 找不到 apps/web/dist/index.html —— 先跑一次构建');
    process.exit(1);
  }
  await mkdir(outDir, { recursive: true });

  const debugPort = PORT + 1;
  const server = await startServer();
  const browser = await launchBrowser(debugPort);
  let page = null;
  /** 判定结果，最后统一打出来（任何一步失败都要能看到已采集到的证据） */
  const verdicts = [];
  const check = (ok, text) => {
    verdicts.push({ ok, text });
    log(`   ${ok ? '✓' : '✗'} ${text}`);
    return ok;
  };

  try {
    page = await openPage(debugPort, `http://127.0.0.1:${PORT}/?debug=1&server=127.0.0.1:${PORT}`);
    log('[1] 等主菜单 → 进测试模式（双阵营沙盒）');
    if (!(await page.waitFor(`!!document.querySelector('#main-menu') && !document.querySelector('#main-menu').classList.contains('hidden')`))) {
      throw new Error('主菜单没出来');
    }
    const beforeClick = await page.evaluate(`(() => {
      const btn = document.querySelector('#menu-test');
      return {
        exists: !!btn,
        disabled: btn ? btn.disabled : null,
        text: btn ? btn.textContent.trim() : null,
        hudHidden: document.querySelector('#game-hud')?.classList.contains('hidden'),
        menuHidden: document.querySelector('#main-menu')?.classList.contains('hidden'),
      };
    })()`);
    log(`   点之前：${JSON.stringify(beforeClick)}`);
    await page.clickSelector('#menu-test');
    if (!(await page.waitFor(`!document.querySelector('#game-hud').classList.contains('hidden')`, 8000))) {
      // 把现场打出来，别只说一句"没进对局"
      const after = await page.evaluate(`(() => ({
        hudHidden: document.querySelector('#game-hud')?.classList.contains('hidden'),
        menuHidden: document.querySelector('#main-menu')?.classList.contains('hidden'),
        hint: document.querySelector('#menu-hint')?.textContent?.trim() ?? null,
      }))()`);
      log(`   点之后：${JSON.stringify(after)}`);
      for (const line of page.consoleLines.slice(-12)) log(`   · 控制台：${line}`);
      for (const f of page.failures.slice(0, 5)) log(`   · 异常：${f}`);
      // 再试一次：用**真实鼠标**点按钮中心（程序化 click 万一被某层拦了就白测了）
      const box = await page.evaluate(`(() => {
        const b = document.querySelector('#menu-test');
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      })()`);
      log(`   按钮中心：${JSON.stringify(box)}`);
      if (box) {
        await page.clickAt(box.x, box.y);
        await sleep(1500);
        log(
          `   真实点击后：${JSON.stringify(
            await page.evaluate(`(() => ({
              hudHidden: document.querySelector('#game-hud')?.classList.contains('hidden'),
              menuHidden: document.querySelector('#main-menu')?.classList.contains('hidden'),
              toast: document.querySelector('#toast')?.textContent?.trim() ?? null,
              stageVisible: !!document.querySelector('#stage')?.clientWidth,
            }))()`),
          )}`,
        );
        /*
          ★ 修一个真实的竞态（这次踩到过两次，占一半概率）：
          `#main-menu` 先显示、事件处理器还没绑上的那一小段窗口里，
          程序化 click 会被**吞掉**（按钮在、也能点、就是没反应），
          于是这里的 8 秒等待白等，脚本直接判"没进对局" —— 而上面那行日志明明写着
          `hudHidden:false, menuHidden:true`（已经进去了）。
          所以真实点击之后**再等一次**，而不是立刻抛错。
        */
        if (
          await page.waitFor(`!document.querySelector('#game-hud').classList.contains('hidden')`, 8000)
        ) {
          log('   （第一次程序化点击被吞了，真实点击补上了）');
        } else {
          await page.shot('w0-进不去');
          throw new Error('没进对局');
        }
      } else {
        await page.shot('w0-进不去');
        throw new Error('没进对局');
      }
    }
    await sleep(1200);
    check(
      await page.evaluate(`!!globalThis.__airnightMotionProbe`),
      '移动动画探针已就绪（?debug=1）',
    );

    log(`[2] 发一只我方单位（${MINE}）放到左半场 (0,5)`);
    await page.clickSelector('#btn-modifier');
    await sleep(400);
    log(`    修改器返回：${await grant(page, MINE)}`);
    await sleep(500);
    const placedMine = await placeAt(page, 0, 0, 5);
    log(`    上阵：${placedMine ? '成功' : '失败'}`);

    log(`[3] 切到红方，发一只野怪（${MONSTER}）放到右半场 (9,5) —— 它要走 8 格过来`);
    await page.clickSelector('#btn-switch-side');
    await sleep(700);
    log(`    修改器返回：${await grant(page, MONSTER)}`);
    await sleep(500);
    const placedFoe = await placeAt(page, 0, 9, 5);
    log(`    上阵：${placedFoe ? '成功' : '失败'}`);
    await sleep(600);
    await page.shot('w1-摆好（左=我方 右=野怪）');

    const startLabel = await page.evaluate(`document.querySelector('#btn-battle')?.textContent ?? ''`);
    log(`    开战按钮：${JSON.stringify(startLabel)}`);

    log('[4] 开打，连续采样 ~8 秒（每 70ms 一帧）');
    await page.clickSelector('#btn-battle');
    await sleep(250);
    /*
      ★ 0.1.4：战斗中的截图（不 await，让采样照常跑）。
      ★★ 关键：**等探针报出"场上有特效"的那一刻才拍**。
      特效只有 0.13~0.3 秒，而攻击间隔接近 1 秒 —— 按固定时刻连拍三张，
      极大概率三张全落在两次攻击之间（拍到的是一片干净棋盘，看起来像"根本没做特效"）。
      这是我第一次跑这个脚本时踩到的坑，所以这里改成"探针触发式拍照"。
      探针负责回答"有没有出现"，截图负责回答"好不好看"，两者缺一不可。
    */
    void (async () => {
      let shots = 0;
      const deadline = Date.now() + 7000;
      while (shots < 3 && Date.now() < deadline) {
        const fx = await page
          .evaluate(`(() => globalThis.__airnightAttackFxProbe?.sample?.() ?? null)()`)
          .catch(() => null);
        if (fx && fx.total > 0) {
          shots++;
          await page.shot(`w3-攻击特效-${shots}`);
        }
        await sleep(60);
      }
    })().catch(() => {});
    const frames = await sampleTimeline(page, 8000, 70);
    await page.shot('w2-战斗采样中');

    const units = analyze(frames);
    log('');
    log(`   采样 ${frames.length} 帧，场上单位 ${units.length} 个：`);
    log('     单位               走没走素材  在动的采样  其中播move  最长连续  单帧最大位移  动作键');
    for (const u of units.sort((a, b) => b.moving - a.moving)) {
      log(
        `     ${(u.team === 1 ? '红 ' : '蓝 ') + u.defId}`.padEnd(22) +
          `${(u.hasMove ? '有' : '无').padEnd(10)}` +
          `${String(u.moving).padStart(9)}` +
          `${String(u.moveAnimWhileMoving).padStart(11)}` +
          `${String(u.bestRun).padStart(9)}` +
          `${u.maxDelta.toFixed(3).padStart(13)}` +
          `  ${u.anims.join('/')}`,
      );
    }
    log('');

    const withMove = units.filter((u) => u.hasMove);
    const walkers = units.filter((u) => u.moving >= 3);

    check(walkers.length > 0, `至少有单位在移动（${walkers.map((u) => u.defId).join(', ') || '无'}）`);
    check(
      withMove.some((u) => u.anims.includes('move')),
      `有走路素材的单位真的播了 move 动作（${withMove.filter((u) => u.anims.includes('move')).map((u) => u.defId).join(', ') || '无'}）`,
    );
    check(
      withMove.some((u) => u.bestRun >= 3),
      '走路动作**连续**播了很多帧（不是闪一下就被别的动作顶掉）',
    );
    /*
      平滑度：走路的一步是 1.0 个世界单位 / 0.4 秒，采样 70ms ⇒ 单帧位移 ≈ 0.175。
      放宽到 0.6 判断"是不是在走路"：真正的一步远小于它，
      而瞬移（跨好几格）必然远超它。所以"最大位移 < 0.6"= 没有瞬移式跳格。
    */
    const maxWalkerDelta = walkers.length ? Math.max(...walkers.map((u) => u.maxDelta)) : 0;
    check(
      maxWalkerDelta < 0.6,
      `走路的位移是小步连续的（单帧最大 ${maxWalkerDelta.toFixed(3)} < 0.6 格，没有一帧跳好几格）`,
    );
    const procedural = units.filter((u) => !u.hasMove && u.maxLean > 0);
    check(
      procedural.length > 0,
      `没走路素材的单位走了程序化走姿（观察到前倾：${procedural.map((u) => `${u.defId} ${u.maxLean.toFixed(3)}rad`).join(', ') || '无'}）`,
    );
    check(page.failures.length === 0, `页面无异常（${page.failures.length} 条）`);
    if (page.failures.length) for (const f of page.failures.slice(0, 5)) log(`     · ${f}`);

    /*
      ============================================================
      ★ 0.1.4：攻击特效（干员 / 野怪 / 召唤物三套预设）
      ============================================================
      【为什么借这个脚本验？】
      它的场景正好是"**重野怪 vs 轻干员**"—— 就是要对比的那两类；
      再抄一份 250 行的静态服务器 + 无头浏览器脚手架，只为了多按一次开战，不划算。
      断言只关心"有没有、是不是该有的形状"；"好不好看"交给同一次战斗里那三张截图。
    */
    const fxFrames = frames.filter((f) => f.fx);
    const peakFx = Math.max(0, ...fxFrames.map((f) => f.fx.total));
    const quietFrames = fxFrames.filter((f) => f.fx.total === 0).length;
    const sawKind = { arc: false, burst: false, ring: false };
    const sawFamily = { operator: false, monster: false, summon: false };
    for (const f of fxFrames) {
      if (f.fx.arc > 0) sawKind.arc = true;
      if (f.fx.burst > 0) sawKind.burst = true;
      if (f.fx.ring > 0) sawKind.ring = true;
      if (f.fx.operator > 0) sawFamily.operator = true;
      if (f.fx.monster > 0) sawFamily.monster = true;
      if (f.fx.summon > 0) sawFamily.summon = true;
    }
    log('');
    log(
      `   攻击特效：${fxFrames.length - quietFrames}/${fxFrames.length} 帧上有效果，同屏峰值 ${peakFx} 块` +
        ` · 出现过 ${Object.entries(sawKind).filter(([, v]) => v).map(([k]) => k).join('/') || '无'}` +
        ` · 家族 ${Object.entries(sawFamily).filter(([, v]) => v).map(([k]) => k).join('/') || '无'}`,
    );
    check(fxFrames.length > 0, '攻击特效探针可用（?debug=1）');
    check(fxFrames.length - quietFrames > 0, '开打之后真的出现了攻击特效（不是一片干净棋盘）');
    check(sawKind.arc, '贴地弧出现了');
    check(sawKind.burst, '命中爆点出现了');
    check(
      sawFamily.operator || sawFamily.monster,
      `看到了对应家族的预设（${Object.entries(sawFamily).filter(([, v]) => v).map(([k]) => k).join('/') || '无'}）`,
    );
    check(
      fxFrames.every((f) => f.fx.total <= 64),
      `同屏特效块数受控（峰值 ${peakFx}，上限 48 组 × 最多 3 块）`,
    );

    log('');
    const failed = verdicts.filter((v) => !v.ok);
    log('============================================================');
    log(failed.length === 0 ? `  全部通过（${verdicts.length} 项）` : `  有 ${failed.length} 项没过`);
    log('============================================================');
    if (failed.length) process.exitCode = 1;

    if (KEEP_OPEN) {
      log('--keep-open：浏览器还开着，Ctrl+C 结束。');
      return;
    }
  } finally {
    if (!KEEP_OPEN) {
      page?.close();
      browser.cleanup();
      server.close();
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
