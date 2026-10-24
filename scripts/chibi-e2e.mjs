#!/usr/bin/env node
/**
 * ============================================================
 *  小人（Q 版序列帧）在**真实游戏里**的端到端验证
 * ============================================================
 *
 * 用法：
 *   node scripts/chibi-e2e.mjs                 # 跑一遍，截图写到 .chibi-e2e/
 *   node scripts/chibi-e2e.mjs --keep-open      # 不关浏览器，自己接着点
 *   node scripts/chibi-e2e.mjs --port 5290      # 换端口
 *
 * 它做什么：
 *   1. 起一个静态服务器，指向 apps/web/dist（先跑构建）
 *   2. 用无头 Edge/Chrome 打开游戏，点「测试模式」（无限金币）
 *   3. 买几个干员、选中、点到棋盘格子上
 *   4. 全程记录**网络请求**和**控制台输出**，每一步截图
 *
 * 【为什么值得单独写一个脚本？】
 * 因为小人这条链路特别容易"看起来没坏"：
 *   · index.json 404 时游戏**照常运行**，只是所有人默默退回半身像；
 *   · 序列帧加载失败也会静默降级；
 *   · 取景错了更不会报错，只是画得难看。
 * 光看代码/看构建成功是发现不了这些的。所以这里必须真开一次浏览器，
 * 从网络层确认"manifest 和 png 真的被拉下来了"，从截图确认"真的画出来了"。
 *
 * 【不装 Playwright 的原因】和 render-chibi.mjs 一样：
 * 本机已有 Edge/Chrome，CDP 就是它自带的协议，Node 22 自带 WebSocket。
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
const PORT = Number(argOf('port', '5290'));
const KEEP_OPEN = argv.includes('--keep-open');

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

/* ---------------- 静态服务器 ---------------- */
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

/* ---------------- 浏览器 ---------------- */
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

  const profile = join(tmpdir(), `airnight-e2e-${process.pid}`);
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
  const chibiRequests = [];
  const chibiInitiators = [];
  const failures = [];

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === 'Runtime.consoleAPICalled') {
      consoleLines.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      failures.push(String(msg.params.exceptionDetails?.exception?.description ?? '').split('\n')[0]);
    }
    if (msg.method === 'Network.responseReceived') {
      const { url: u, status } = msg.params.response;
      if (u.includes('/assets/chibi/')) chibiRequests.push([status, u.split('/assets/chibi/')[1]]);
    }
    if (msg.method === 'Network.requestWillBeSent') {
      const u = msg.params.request.url;
      if (u.includes('/assets/chibi/') && !u.endsWith('index.json')) {
        const fr = msg.params.initiator?.stack?.callFrames ?? [];
        const top = fr.slice(0, 3).map((f) => `${f.functionName || '(匿名)'}@${f.lineNumber + 1}:${f.columnNumber}`).join(' ← ');
        chibiInitiators.push(`${u.split('/assets/chibi/')[1]}  ←  ${top || msg.params.initiator?.type}`);
      }
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
  await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
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

  /** 真实鼠标点击（画布必须走这条，程序化 click() 打不出射线） */
  const clickAt = async (x, y) => {
    const base = { x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 };
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...base, button: 'none' });
    await sleep(40);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base });
    await sleep(40);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base });
    await sleep(120);
  };

  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(outDir, `${name}.png`), Buffer.from(r.data, 'base64'));
    log(`   截图 ${name}.png`);
  };

  return { send, evaluate, waitFor, clickSelector, clickAt, shot, consoleLines, chibiRequests, chibiInitiators, failures, close: () => ws.close() };
}

/* ---------------- 主流程 ---------------- */
async function main() {
  log('============================================================');
  log('  小人在真实游戏里的端到端验证');
  log('============================================================');

  if (!existsSync(join(distDir, 'index.html'))) {
    log('✗ 找不到 apps/web/dist/index.html —— 先跑一次构建：');
    log('    node node_modules/vite/bin/vite.js build --config apps/web/vite.config.ts');
    process.exit(1);
  }
  await mkdir(outDir, { recursive: true });

  const debugPort = PORT + 1;
  const server = await startServer();
  const browser = await launchBrowser(debugPort);
  let page = null;

  try {
    page = await openPage(debugPort, `http://127.0.0.1:${PORT}/?server=127.0.0.1:${PORT}`);

    log(`[1] 等主菜单…`);
    if (!(await page.waitFor(`!!document.querySelector('#main-menu') && !document.querySelector('#main-menu').classList.contains('hidden')`))) {
      throw new Error('主菜单没出来');
    }
    await sleep(600);
    await page.shot('01-菜单');

    log(`[2] 点「测试模式（无限金币）」…`);
    await page.clickSelector('#menu-test');
    if (!(await page.waitFor(`!document.querySelector('#game-hud').classList.contains('hidden')`))) {
      throw new Error('没进对局');
    }
    await sleep(1200);
    await page.shot('02-开局');

    log(`[3] 升级人口 + 买干员（测试模式金币无限）…`);
    // 1 级只允许上阵 1 个，先买经验把等级顶上去，不然棋盘上只能站一个
    for (let i = 0; i < 6; i++) {
      await page.evaluate(`document.querySelector('#btn-buy-xp')?.click()`);
      await sleep(140);
    }
    const shopCount = await page.evaluate(`document.querySelectorAll('#shop-slots > *').length`);
    log(`    商店有 ${shopCount} 个槽位`);
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < shopCount; i++) {
        await page.evaluate(`document.querySelectorAll('#shop-slots > *')[${i}]?.click()`);
        await sleep(130);
      }
      await page.evaluate(`document.querySelector('#btn-refresh')?.click()`);
      await sleep(400);
    }
    await sleep(600);
    await page.shot('03-买完');

    log(`[4] 选中备战席棋子，点棋盘格子放上去…`);
    const size = await page.evaluate(
      `({w: window.innerWidth, h: window.innerHeight, cw: document.querySelector('#stage').clientWidth, ch: document.querySelector('#stage').clientHeight})`,
    );
    log(`    视口 ${size.w}×${size.h}，画布 ${size.cw}×${size.ch}`);

    /*
      ★ 判定"放上去了没有"要用**非空格子数**，不能数子元素个数。
      renderBench 是固定渲染 BENCH_SLOTS(9) 格的 —— 空格子也会生成一个
      .bench-slot.empty 占位，所以 `#bench-slots > *` 恒等于 9，永远不变。
      之前就是踩了这个坑：明明 5 个干员都站上棋盘了，脚本却一直报"没放上去"。
      真正会变的是"非空"的格子数。
    */
    const countBench = () =>
      page.evaluate(`document.querySelectorAll('#bench-slots > .bench-slot:not(.empty)').length`);
    const CX = size.cw / 2;
    const CY = size.ch / 2;
    const benchBefore = await countBench();
    log(`    备战席有 ${benchBefore} 个棋子`);

    /*
      ★ 扫描点不是拍脑袋定的。
      棋盘在世界里的位置固定、相机默认视角也固定（视角 ×1），
      所以棋盘在屏幕上的矩形是稳定的 —— 实测约 x 413..1067 / y 80..627（1440×900）。
      其中**我方半场在左半边**（格子偏蓝），另一半是对手的（偏红），
      而近处几行会被下方商店面板挡住 —— 所以只扫"左上那一块"。
      放到非法格子只是没反应，不会有副作用，所以敢这么扫。
    */
    const BOARD = { x0: 413, x1: 1067, y0: 80, y1: 627 };
    const MINE = { x0: BOARD.x0 + 10, x1: (BOARD.x0 + BOARD.x1) / 2 - 12 };
    /*
      ★ 纵向窗口要取棋盘**中段**，不能贪大。
      注意相机拉近是**推 dolly / 改 FOV**，不是平面等比放大 ——
      越靠画面下沿（离相机近）的东西位移越大，所以棋盘最上面那一行
      拉近后会跑出顶栏，截图里只剩两条血条。
      把落点收进中间这一条带（约第 2~4 行），拉近之后阵型才会完整留在画面里。
    */
    const VIS = { y0: BOARD.y0 + 120, y1: BOARD.y0 + 265 };
    const ROWS = 4;
    const COLS = 10;
    const rowY = (r) => VIS.y0 + ((VIS.y1 - VIS.y0) * r) / (ROWS - 1);
    const colX = (c) => MINE.x0 + ((MINE.x1 - MINE.x0) * c) / (COLS - 1);
    log(`    扫描窗口 x ${MINE.x0}..${MINE.x1}  y ${VIS.y0}..${VIS.y1}`);

    /*
      ★ 每个棋子换一个扫描起点（行、列都错开）。
      否则"从左上角开始扫、一成功就停"会让**所有人挤在最上面一行** ——
      画面上一排小人叠在棋盘顶边，既不好看也看不出取景是否一致。
      错开起点之后，前几个会自然落到不同格子上；撞到已占用的格子时
      游戏会拒绝落子，脚本继续往后扫，等于免费帮我们做了避让。
    */
    /*
      ★ 点到**已经站着人的格子**会弹出干员详情面板，它会盖住棋盘中央，
      后面滚轮缩放就落在面板上、缩放不了（canvas 上才挂了 wheel 监听）。
      所以每轮扫描收尾都把面板关掉，别让它累积着挡视线。
    */
    const closeUnitInfo = () =>
      page.evaluate(`document.querySelector('#unit-info-close')?.click(), true`);

    let placed = 0;
    let misses = 0;
    const placedPts = [];
    // 上阵数由「人口」卡着（HUD 上那个 5/5），所以扫到放不进去为止 ——
    // 连续两轮一个都放不上就收手，别在那儿空转。
    for (let b = 0; b < 9 && misses < 2; b++) {
      const total = await countBench();
      if (total <= 0) break;
      await page.evaluate(`document.querySelectorAll('#bench-slots > .bench-slot:not(.empty)')[${b}]?.click()`);
      await sleep(130);
      let done = false;
      const rOrder = Array.from({ length: ROWS }, (_, i) => (i + 2 * b) % ROWS);
      const cOrder = Array.from({ length: COLS }, (_, i) => (i + 3 * b) % COLS);
      for (const r of rOrder) {
        if (done) break;
        for (const c of cOrder) {
          const x = colX(c);
          const y = rowY(r);
          await page.clickAt(x, y);
          if ((await countBench()) < total) {
            log(`    上阵成功（备战席 ${total} → ${total - 1}）@ (${Math.round(x)},${Math.round(y)})`);
            placed++;
            placedPts.push({ x, y });
            done = true;
            break;
          }
        }
      }
      if (done) {
        misses = 0;
      } else {
        misses++;
        log(`    第 ${b + 1} 个没放上去（人口满了，或者这个扫描窗口里没有合法落点）`);
      }
      await closeUnitInfo();
      await sleep(150);
    }
    log(`    合计上阵 ${placed} 个，备战席还剩 ${await countBench()} 个`);
    await sleep(1200);
    await page.shot('04-上阵');

    log(`[5] 滚轮拉近视角，看清卡片上的小人…`);
    await closeUnitInfo();
    /*
      ★ 滚轮的位置不是随便挑的：缩放是以**鼠标位置**为中心做的
      （board.zoomBy 用的是指针屏幕坐标），所以要在**已上阵小人的重心**
      处滚 —— 否则以画布正中为锚点拉近，上面几行会被推出画面，
      截图里就正好把小人切掉了。没有落点时退回画布中心。
    */
    const anchor = placedPts.length
      ? {
          x: placedPts.reduce((s, p) => s + p.x, 0) / placedPts.length,
          y: placedPts.reduce((s, p) => s + p.y, 0) / placedPts.length,
        }
      : { x: CX, y: CY };
    log(`    以阵型重心 (${Math.round(anchor.x)},${Math.round(anchor.y)}) 为锚点拉近`);

    /*
      ★ 倍率不要硬编"滚几档"。
      camera-view.ts 里 ZOOM_STEP = 1.18、MAX_ZOOM_IN = 2，
      而**一次 dispatchMouseEvent 到底触发几个 wheel DOM 事件**是浏览器行为
      （实测不是 1:1），硬编档数会在别人机器上对不上。
      所以直接读 #zoom-hint 上的倍率，滚到目标值就停 —— 自校正，换环境也不会错。
    */
    const readZoom = async () => {
      const txt = await page.evaluate(`document.querySelector('#zoom-hint')?.textContent ?? ''`);
      const m = /×\s*([\d.]+)/.exec(txt);
      return m ? Number(m[1]) : 1;
    };
    const zoomTo = async (target) => {
      for (let i = 0; i < 30; i++) {
        const z = await readZoom();
        if (z >= target - 1e-6) return z;
        await page.send('Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          x: Math.round(anchor.x),
          y: Math.round(anchor.y),
          deltaX: 0,
          deltaY: -240,
        });
        await sleep(280);
        if ((await readZoom()) <= z) return z; // 已经到上限（×2.0）了，别空转
      }
      return readZoom();
    };

    /*
      ★ 拉多少是要挑的。
      棋盘约 654 px 宽，拉到上限 ×2.0 之后可视范围只剩一半，
      5 个散开的棋子会有一半被推出画面 —— 之前就是这么丢的。
      ×1.4 时可视范围 ≈1030 px，整条阵型刚好装得下，
      这才是"证明每个小人都一样大"该看的比例；
      特写另拍一张 ×2.0，不牺牲全景。
    */
    log(`    全景 视角 ×${await zoomTo(1.4)}`);
    await page.shot('05-上阵全景');

    log(`    特写 视角 ×${await zoomTo(2)}`);
    await page.shot('05b-小人特写');

    // 战斗回到 ×1.4：能同时看到好几个小人出手/放技能，比特写信息量大
    await page.evaluate(`document.querySelector('#zoom-hint')?.click()`);
    await sleep(450);
    log(`    战斗用视角 ×${await zoomTo(1.4)}`);

    log(`[6] 开打，观察出手/技能/阵亡动作…`);
    await page.clickSelector('#btn-battle');
    await sleep(2000);
    await page.shot('06-战斗中A');
    await sleep(2500);
    await page.shot('06-战斗中B');
    await sleep(3500);
    await page.shot('06-战斗中C');

    log(`[7] 汇总`);
    log(`    控制台里的小人相关输出：`);
    for (const line of page.consoleLines.filter((l) => l.includes('小人'))) log(`      ${line}`);
    const chibiOk = page.chibiRequests.filter(([s]) => s === 200);
    const chibiBad = page.chibiRequests.filter(([s]) => s !== 200);
    log(`    小人素材请求：成功 ${chibiOk.length} 个，失败 ${chibiBad.length} 个`);
    const groups = new Map();
    for (const [, p] of chibiOk) {
      const g = p.split('/')[0];
      groups.set(g, (groups.get(g) ?? 0) + 1);
    }
    // 拉了 idle 才算"小人真的会动"：只有 manifest 到、帧没到的话，画面上还是半身像
    const idleOps = [...new Set(chibiOk.filter(([, p]) => /\/idle[^/]*\.png$/.test(p)).map(([, p]) => p.split('/')[0]))];
    log(`    干员目录 ${groups.size} 个；其中真的拉到 idle 序列帧的 ${idleOps.length} 个：`);
    log(`      ${idleOps.join(', ')}`);
    if (chibiBad.length) for (const [s, p] of chibiBad) log(`      ✗ ${s} ${p}`);
    if (page.failures.length) {
      log(`    页面异常 ${page.failures.length} 条：`);
      for (const f of page.failures.slice(0, 8)) log(`      ${f}`);
    } else {
      log(`    页面异常：无`);
    }
    if (page.chibiInitiators.length) {
      log(`    小人请求是谁发起的（前 6 条，用于确认"为什么会拉这些干员"）：`);
      for (const l of page.chibiInitiators.slice(0, 6)) log(`      ${l}`);
    }

    /*
      判定要卡在"**站在棋盘上的那个干员**真的把 idle 序列帧拉下来了"，
      而不是"有请求发生过" ——
      只发过 index.json 也可能是清单到了、帧没到，画面上仍然是半身像占位。
    */
    const verdict = placed >= 1 && idleOps.length >= 1 && page.failures.length === 0;
    log('');
    if (verdict) {
      log(`✓ 上阵 ${placed} 个干员，其中 ${idleOps.length} 个真的加载并渲染了 Q 版小人（见 .chibi-e2e/ 截图）`);
    } else {
      log(`✗ 验证不通过：上阵 ${placed} 个 / 加载小人 ${idleOps.length} 个 / 异常 ${page.failures.length} 条`);
    }
  } finally {
    try {
      page?.close();
    } catch {
      /* ignore */
    }
    if (!KEEP_OPEN) {
      browser.cleanup();
      await new Promise((r) => server.close(r));
    } else {
      log('');
      log(`--keep-open：服务器还在 ${PORT}，Ctrl+C 结束。`);
    }
  }
}

main().catch((err) => {
  console.error('\n' + (err?.stack ?? String(err)));
  process.exit(1);
});
