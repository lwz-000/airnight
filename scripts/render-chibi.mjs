#!/usr/bin/env node
/**
 * ============================================================
 *  把官方 Q 版小人的 Spine 素材，离线渲染成横向序列帧 PNG
 * ============================================================
 *
 * 用法：
 *   node scripts/render-chibi.mjs                 # 渲染 .chibi-cache/index.json 里的全部干员
 *   node scripts/render-chibi.mjs --only op07,op08 # 只渲染这两个（先看效果用）
 *   node scripts/render-chibi.mjs --port 5271      # 换内部端口
 *
 * 前置：先跑 `node scripts/fetch-chibi.ts` 把素材抓到 .chibi-cache/
 *
 * 【产出】apps/web/public/assets/chibi/<defId>/
 *   ├─ idle.png / attack.png / skill.png / die.png   横向序列帧（每格 128×170）
 *   └─ manifest.json                                 格尺寸 + 每个动作的帧数/帧率/是否循环
 *   以及 apps/web/public/assets/chibi/index.json      defId -> charId（哪些干员有小人）
 *
 * 【为什么这个脚本自己起一个 HTTP 服务器？】
 * 因为无头浏览器有同源限制：file:// 页面 fetch 本地文件会被拦。
 * 起个只监听 127.0.0.1 的小服务器，把 vendor 库、骨架、渲染页都从它上面发，
 * 浏览器就把它当成一个普通站点。服务器跑完就关，不留常驻进程。
 *
 * 【为什么不装 Playwright / Puppeteer？】
 * 机器上已经有 Edge/Chrome，CDP 就是它自带的调试协议；Node 22 自带 WebSocket。
 * 整个流程零第三方依赖 —— 这跟本项目"依赖装在仓库内、不污染用户目录"的约定一致。
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { accessSync, existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const cacheDir = join(repoRoot, '.chibi-cache');
const spineDir = join(cacheDir, 'spine');
const vendorDir = join(cacheDir, 'vendor');
const cacheIndex = join(cacheDir, 'index.json');
/**
 * 产出根目录。
 * 【为什么可以用环境变量改？】
 * 诊断时要拿别的参数（比如 CHIBI_CELL 放大格子）重跑几个干员对比，
 * 那批图的格子尺寸跟正式版不一样，绝不能写进正式素材目录 ——
 * 一旦覆盖，游戏读到的清单和 PNG 就对不上了（画面会错位/裁切）。
 * 所以诊断一律 `CHIBI_OUT=.chibi-probe` 导到别处去。
 */
const outRoot = process.env.CHIBI_OUT
  ? resolve(repoRoot, process.env.CHIBI_OUT)
  : join(repoRoot, 'apps', 'web', 'public', 'assets', 'chibi');
const pageFile = join(repoRoot, 'scripts', 'render-chibi.page.html');

/* ---------------- 参数 ---------------- */
const argv = process.argv.slice(2);
function argValue(name, fallback) {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  if (hit.includes('=')) return hit.split('=').slice(1).join('=');
  const next = argv[argv.indexOf(hit) + 1];
  return next && !next.startsWith('--') ? next : fallback;
}

const only = (argValue('only', '') || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const port = Number(argValue('port', '5271'));
const keepOpen = argv.includes('--keep-open');
/** --list：只把每个干员的动作名和匹配结果列出来，不渲染 */
const listMode = argv.includes('--list');
/** --debug：把取景的中间量（骨架盒/量到的像素盒/最终缩放）打出来，排查"小人太小"用 */
const debugMode = argv.includes('--debug');

/**
 * 诊断用：`CHIBI_CELL=448x340` 覆盖格子尺寸。
 *
 * 【为什么需要？】
 * 格子一放大，取景迭代就把小人放大到填满新格子的高度 ——
 * 于是原来落在格子外面、被画布裁掉的内容（横劈的刀、倒地的铺开）
 * 就露出来了，能量到"真正的并集有多少"。
 * 拿这个数字才能判断"给并集留多少余量"值不值，不然只能靠猜。
 */
function cellFromEnv() {
  const m = /^(\d+)x(\d+)$/.exec(process.env.CHIBI_CELL || '');
  if (!m) return null;
  return { w: Number(m[1]), h: Number(m[2]) };
}

/** 渲染参数。改这里就等于改所有小人的画质/体积。 */
const TUNE = {
  /*
    格子尺寸。**宽度不是"随便定"的**，理由：
      高度决定小人显示出来多大 —— 格子的高度映射到卡片立绘区高度的 96%
      （见 apps/web/src/three/chibi.ts 的 layoutChibi），所以格子高度不变、
      小人在卡片上的大小就不变。170 是这么来的。
      宽度只决定"横向留多少地方" —— 干员里有把枪/长枪横着拿的（实测联合盒
      宽高比最大 1.44），格子太窄就会把他们挤小。实测 224 宽（宽高比 1.32）
      能让绝大多数干员都按"待机填满高度"来取景，也就是卡片上一排小人一样高。
      再宽一点收益很小，但每张序列帧都会变大，不值。 */
  cell: cellFromEnv() ?? { w: 224, h: 170 },
  fps: 12, // 名义采样帧率；帧数会按动画实际时长换算，所以播出来永远是原速
  maxFrames: 32, // 循环动作（待机）帧数上限
  maxFramesOnce: 24, // 一次性动作（出手/技能/阵亡）帧数上限
  minFrames: 4,
  marginX: 0.05, // 目标框左右各留 5%
  marginY: 0.035, // 目标框上下各留 3.5%（待机填满这个高度）
  // 诊断用：把最终缩放整体乘一个系数（CHIBI_BIAS=0.45 就能看出"框外面还有什么"）
  scaleBias: Number(process.env.CHIBI_BIAS || 1),
  // 诊断用：量的时候画布四周留几个设计框的余量（默认 1；0 = 画布就是设计框）
  probePad: process.env.CHIBI_PROBEPAD ? Number(process.env.CHIBI_PROBEPAD) : undefined,
};

/**
 * ★ 0.0.3：**阶段专属动作表**（Boss 的第二形态）。
 *
 * 【为什么需要它？】
 * 有些 Boss 的骨架里同时装着两个形态的动作（"阶段_动作"命名法）：
 *   杰斯顿·威廉姆斯   C1_* = 一阶段（远程）、C2_* = 二阶段（近战）
 *   博卓卡斯替        C1_* = 圣卫铳骑一阶段、C2_* = 二阶段（多段技能 C2_Skill_1/2/3）
 *   奎隆              A_* / B_* / C_* 三套
 * 自动匹配只会命中**先出现的那一套**（也就是一阶段），二阶段得点名渲。
 * 渲出来的键是 idle2 / attack2 / skill2 / die2，游戏在二阶段读它们。
 *
 * 【为什么和本体动作用同一套变换？】
 * 见 render-chibi.page.html 的 emitStrip 注释 —— 两个形态必须同一比例、
 * 同一脚点，否则换形态的那一帧会"跳"一下。
 */
const PHASE_ANIMS = {
  mn_jakill: [
    { key: 'idle2', pick: ['C2_Idle'], loop: true },
    { key: 'move2', pick: ['C2_Move'], loop: true },
    { key: 'attack2', pick: ['C2_Attack'], loop: false },
    { key: 'skill2', pick: ['C2_Skill'], loop: false },
    { key: 'die2', pick: ['C2_Die'], loop: false },
  ],
  mn_skzdd: [
    { key: 'idle2', pick: ['C2_Idle'], loop: true },
    { key: 'move2', pick: ['C2_Move'], loop: true },
    { key: 'attack2', pick: ['C2_Attack'], loop: false },
    // 二阶段的技能动作有多段（_1/_2/_3），主打第一个
    { key: 'skill2', pick: ['C2_Skill_1'], loop: false },
    { key: 'die2', pick: ['C2_Die'], loop: false },
  ],
  mn_skzjkl: [
    { key: 'idle2', pick: ['B_Idle'], loop: true },
    { key: 'move2', pick: ['B_Move'], loop: true },
    { key: 'attack2', pick: ['B_Attack'], loop: false },
    { key: 'skill2', pick: ['B_Skill_Loop', 'B_Skill_Begin'], loop: false },
    { key: 'die2', pick: ['B_Die'], loop: false },
  ],
};

/** 点名的基础动作（自动匹配会挑到不合适的那一个时用它覆盖） */
const BASE_PICKS = {
  // 奎隆的待机自动匹配会命中时长 0 的 Default（小人像定住），一阶段其实是 A_*
  mn_skzjkl: { idle: 'A_Idle', skill: 'A_Skill' },
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.atlas': 'text/plain; charset=utf-8',
  '.skel': 'application/octet-stream',
};

const log = (m) => process.stdout.write(m + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ============================================================
   静态服务器（同时接收页面回传的 PNG 和清单）
   ============================================================ */
let savedStrips = 0;
let savedManifests = 0;

function readBody(req, limitBytes = 32 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function startServer() {
  const pageHtml = (await readFile(pageFile, 'utf8')).replace(
    '/*__CFG__*/ null',
    JSON.stringify(TUNE),
  );

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      const path = decodeURIComponent(url.pathname);

      if (req.method === 'POST' && path === '/save') {
        const defId = url.searchParams.get('defId');
        const anim = url.searchParams.get('anim');
        // 动作名允许一个数字后缀（0.0.3 的二阶段动作：idle2 / attack2 / skill2 / die2）
        if (!/^(op\d{2,3}|[A-Za-z0-9_]+)$/.test(defId ?? '') || !/^[a-z][a-z0-9]*$/.test(anim ?? '')) {
          res.writeHead(400).end('bad params');
          return;
        }
        const dir = join(outRoot, defId);
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, `${anim}.png`), await readBody(req));
        savedStrips++;
        res.writeHead(200).end('ok');
        return;
      }

      if (req.method === 'POST' && path === '/manifest') {
        const body = JSON.parse((await readBody(req, 4 * 1024 * 1024)).toString('utf8'));
        // 校验一下：清单必须带 animations 和 cell，不然就是页面那边出了问题，
        // 宁可让这次渲染失败，也不要往 assets 里写一份垃圾清单（游戏读到会静默降级）
        if (!body?.defId || !body?.manifest?.animations || !body?.manifest?.cell?.w) {
          res.writeHead(400).end('bad manifest');
          return;
        }
        const dir = join(outRoot, body.defId);
        await mkdir(dir, { recursive: true });
        await writeFile(
          join(dir, 'manifest.json'),
          JSON.stringify(body.manifest, null, 2) + '\n',
          'utf8',
        );
        savedManifests++;
        res.writeHead(200).end('ok');
        return;
      }

      if (req.method !== 'GET') {
        res.writeHead(405).end();
        return;
      }

      let file = null;
      if (path === '/' || path === '/render.html') {
        res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
        res.end(pageHtml);
        return;
      } else if (path.startsWith('/vendor/')) {
        file = join(vendorDir, path.slice('/vendor/'.length));
      } else if (path.startsWith('/spine/')) {
        file = join(spineDir, path.slice('/spine/'.length));
      }

      if (!file || !existsSync(file)) {
        res.writeHead(404).end('not found: ' + path);
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, {
        'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'content-length': body.length,
        'cache-control': 'no-store',
      });
      res.end(body);
    } catch (err) {
      res.writeHead(500).end(String(err));
    }
  });

  await new Promise((r, j) => {
    server.once('error', j);
    server.listen(port, '127.0.0.1', r);
  });
  return server;
}

/* ============================================================
   极简 CDP 驱动
   ============================================================ */
const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

function findBrowser() {
  for (const p of BROWSERS) {
    try {
      accessSync(p);
      return p;
    } catch {
      /* 换下一个 */
    }
  }
  throw new Error(
    '找不到 Edge / Chrome。小人离线渲染需要一个 Chromium 系浏览器，\n' +
      '装一个 Edge 或 Chrome 再跑即可（它是构建期工具，不进游戏包）。',
  );
}

async function launchBrowser(debugPort) {
  const exe = findBrowser();
  const profile = join(tmpdir(), `airnight-chibi-${process.pid}`);
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
      '--disable-background-networking',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--window-size=900,700',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      if (r.ok) break;
    } catch {
      /* 还没起来 */
    }
    await sleep(200);
  }
  const alive = await fetch(`http://127.0.0.1:${debugPort}/json/version`)
    .then((r) => r.ok)
    .catch(() => false);
  if (!alive) {
    proc.kill();
    throw new Error('DevTools 端口没起来，浏览器可能被安全软件拦了。');
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
  if (!target) throw new Error('没有可用的标签页');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });

  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === 'Runtime.consoleAPICalled') {
      logs.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
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
  await send('Page.navigate', { url });

  const evaluate = async (expression, timeout = 300000) => {
    const r = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      timeout,
    });
    if (r.exceptionDetails) {
      throw new Error(
        '页面里报错: ' +
          (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? '未知'),
      );
    }
    return r.result.value;
  };

  const waitFor = async (expression, timeoutMs = 30000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await evaluate(expression, 20000)) return true;
      await sleep(150);
    }
    return false;
  };

  return { send, evaluate, waitFor, logs, close: () => ws.close() };
}

/* ============================================================
   主流程
   ============================================================ */
async function main() {
  log('============================================================');
  log('  官方 Q 版小人 → 横向序列帧（离线预渲染）');
  log('============================================================');
  log('');

  if (!existsSync(cacheIndex)) {
    log('✗ 找不到 ' + cacheIndex);
    log('  请先跑：  node scripts/fetch-chibi.ts');
    process.exit(1);
  }
  if (!existsSync(join(vendorDir, 'pixi.min.js')) || !existsSync(join(vendorDir, 'pixi-spine.js'))) {
    log('✗ .chibi-cache/vendor 里缺少 pixi 运行库');
    log('  请先跑：  node scripts/fetch-chibi.ts（它会顺手把前端库抓下来）');
    process.exit(1);
  }

  const index = JSON.parse(await readFile(cacheIndex, 'utf8'));
  let defIds = Object.keys(index);
  if (only.length) {
    const missing = only.filter((d) => !index[d]);
    if (missing.length) log(`! 这些干员没有素材，跳过：${missing.join(', ')}`);
    defIds = only.filter((d) => index[d]);
  }
  if (!defIds.length) {
    log('没有可渲染的干员。');
    process.exit(1);
  }

  log(`准备渲染 ${defIds.length} 个干员：${defIds.join(', ')}`);
  log(`输出目录：${outRoot}`);
  log(`格子尺寸 ${TUNE.cell.w}×${TUNE.cell.h}，名义帧率 ${TUNE.fps}fps，` +
      `帧数上限 ${TUNE.maxFramesOnce}(一次性)/${TUNE.maxFrames}(循环)`);
  log('');

  await mkdir(outRoot, { recursive: true });

  const debugPort = port + 1;
  const server = await startServer();
  const browser = await launchBrowser(debugPort);
  let page = null;

  const done = [];
  const failed = [];

  try {
    page = await openPage(debugPort, `http://127.0.0.1:${port}/render.html`);
    const ready = await page.waitFor('window.__READY === true', 25000);
    if (!ready) {
      const fatal = await page.evaluate('window.__FATAL || "unknown"').catch(() => 'unknown');
      if (page.logs.length) {
        log('页面控制台输出：');
        for (const line of page.logs.slice(-20)) log('  ' + line);
      }
      throw new Error(`渲染页没起来（__FATAL=${fatal}）。检查 pixi 运行库是否完整。`);
    }
    log(`[环境] 渲染页就绪（内部端口 ${port}，CDP 端口 ${debugPort}）`);
    log('');

    if (listMode) {
      // ---- 只列动作名，不渲染 ----
      for (const defId of defIds) {
        const charId = index[defId];
        let info;
        try {
          info = JSON.parse(
            await page.evaluate(`window.listOne(${JSON.stringify(defId)}, ${JSON.stringify(charId)})`),
          );
        } catch (err) {
          log(`  ✗ ${defId} ${charId}  ${err.message}`);
          continue;
        }
        if (!info.ok) {
          log(`  ✗ ${defId} ${charId}  ${String(info.error).split('\n')[0]}`);
          continue;
        }
        const picked = Object.entries(info.picked)
          .map(([k, v]) => `${k}=${v ?? '（没匹配到）'}`)
          .join('  ');
        log(`${defId} ${charId}`);
        log(`  全部动作： ${info.names.join(', ')}`);
        log(`  匹配结果： ${picked}`);
      }
      return;
    }

    let n = 0;
    for (const defId of defIds) {
      const charId = index[defId];
      const t0 = Date.now();
      let res;
      try {
        // ★ 0.0.3：把"点名的基础动作"和"阶段专属动作"一起交给渲染页
        const opts = {
          picks: BASE_PICKS[defId] ?? null,
          extraAnims: PHASE_ANIMS[defId] ?? null,
        };
        const raw = await page.evaluate(
          `window.renderOne(${JSON.stringify(defId)}, ${JSON.stringify(charId)}, ${JSON.stringify(opts)})`,
        );
        res = JSON.parse(raw);
      } catch (err) {
        failed.push([defId, charId, String(err.message ?? err)]);
        log(`  ✗ ${defId} ${charId}  页面异常：${err.message}`);
        continue;
      }
      n++;
      if (!res?.ok) {
        failed.push([defId, charId, String(res?.error ?? '未知')]);
        log(`  ✗ ${defId} ${charId}  ${String(res?.error ?? '').split('\n')[0]}`);
        continue;
      }
      done.push([defId, charId]);
      const anims = Object.entries(res.animations ?? {})
        .map(([k, v]) => `${k}(${v.frames}帧${v.loop ? '·环' : ''})`)
        .join(' ');
      log(`  ✓ ${defId} ${charId}  ${anims}  [${((Date.now() - t0) / 1000).toFixed(1)}s]  (${n}/${defIds.length})`);
      if (debugMode && res.debug) {
        const d = res.debug;
        const f = (o) => (o ? `x${o.x} y${o.y} ${o.w}×${o.h}` : 'null');
        const BW = d.box?.w ?? TUNE.cell.w;
        const BH = d.box?.h ?? TUNE.cell.h;
        log(`      骨架盒 ${f(d.roughBox)}  起始缩放 ${d.startScale.toFixed(4)}`
          + `  收敛后用 ${d.rounds} 轮  参与尺寸拟合：${(d.frameAnims ?? []).join('+')}`);
        for (const [k, v] of Object.entries(d.boxes ?? {})) log(`      ${k.padEnd(7)} ${f(v)}`);
        const u = d.unionBox;
        if (u) {
          log(`      并集盒 ${f(u)}（设计框坐标 ${BW}×${BH}）  最终缩放 ${d.finalScale.toFixed(4)}`);
        }
        if (d.idleBox) {
          log(`      待机高占比 ${((d.idleBox.h / BH) * 100).toFixed(1)}%`
            + `（这一列很齐 = 卡片上一排小人一样大）`);
        }
        /*
          ★ 这一行是这一版新增的关键自检：**并集有没有被画布裁掉**。
          全是 >=0 才算过关（>=0 表示并集四周都留了地方）。
          负数就是裁掉了多少像素 —— 那就是"挥刀被切成平头"，是硬伤不是观感问题。
        */
        if (d.clip) {
          const c = d.clip;
          const bad = [c.left, c.top, c.right, c.bottom].filter((v) => v < 0);
          log(`      画布 ${d.cell.w}×${d.cell.h}（比设计框每边多 ${d.pad.x}/${d.pad.y}px）`
            + `  四边余量 左${c.left} 上${c.top} 右${c.right} 下${c.bottom}`
            + (bad.length ? `  ✗ 有内容被裁` : '  ✓ 无裁切'));
          if (bad.length) log(`        溢出原始值 横${d.overflow?.x} 纵${d.overflow?.y}（超过上限就还是会被裁）`);
        }
      }
    }
  } finally {
    try {
      page?.close();
    } catch {
      /* ignore */
    }
    browser.cleanup();
    await new Promise((r) => server.close(r));
  }

  /* ---------- 合并写 index.json ---------- */
  const renderedIndexFile = join(outRoot, 'index.json');
  let merged = {};
  if (existsSync(renderedIndexFile)) {
    try {
      merged = JSON.parse(await readFile(renderedIndexFile, 'utf8'));
    } catch {
      merged = {};
    }
  }
  for (const [defId, charId] of done) merged[defId] = charId;
  await writeFile(renderedIndexFile, JSON.stringify(merged, null, 2) + '\n', 'utf8');

  log('');
  log('------------------------------------------------------------');
  log(`渲染成功 ${done.length} 个，失败 ${failed.length} 个`);
  log(`写出序列帧 ${savedStrips} 张、清单 ${savedManifests} 份`);
  log(`索引（累计 ${Object.keys(merged).length} 个干员）：${renderedIndexFile}`);
  if (failed.length) {
    log('');
    log('失败的干员（游戏里自动回退到半身像，不影响可玩性）：');
    for (const [defId, charId, msg] of failed) log(`  ${defId} ${charId}  ${msg}`);
  }
  log('');
  log('下一步：  npm run build   （或 node node_modules/vite/bin/vite.js build --config apps/web/vite.config.ts）');

  if (keepOpen) {
    log('');
    log('--keep-open：浏览器还开着，Ctrl+C 结束。');
    return;
  }
  process.exit(failed.length && !done.length ? 1 : 0);
}

main().catch((err) => {
  console.error('\n' + (err?.stack ?? String(err)));
  process.exit(1);
});
