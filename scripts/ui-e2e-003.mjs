#!/usr/bin/env node
/**
 * ============================================================
 *  0.0.3 界面需求的**真实浏览器**验证
 * ============================================================
 *
 * 覆盖：
 *   ① 日志保留到下一回合的布阵阶段（含野怪回合掉落）
 *   ② 商店卡面右上角「已拥有 N」
 *   ③ 装备栏拖动互换位置
 *   ④ 「已拥有 N」按张数折算（2 星 = 3 张）
 *   ⑤ 野怪攻击动画：连打十几秒，动画不能停（0.0.3 报的 bug）
 *
 * 用法：
 *   node scripts/ui-e2e-003.mjs                # 跑一遍，截图写到 .ui-e2e/
 *   node scripts/ui-e2e-003.mjs --keep-open    # 不关浏览器
 *
 * 【为什么这些必须真开一次浏览器？】
 *   · 「日志保留」是一条**时序**行为：单测能证明"不清日志"，但证明不了
 *     "真打完一局、进下一回合布阵时面板上还留着那几行"。
 *   · 位置/遮挡/CSS 只有渲染出来才算数。
 *   · 拖动走的是 pointer 事件 + `document.elementFromPoint`，而 jsdom 没有布局 ——
 *     这类功能在 jsdom 里根本测不了，只能真拖。
 *   · 攻击动画是不是"连着播"要靠**运行时采样**（动画键 + 帧号序列），
 *     纯逻辑测试只能证明公式，证明不了"跑起来真的在动"。
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
const outDir = join(repoRoot, '.ui-e2e');

const argv = process.argv.slice(2);
const argOf = (n, d) => {
  const i = argv.findIndex((a) => a === `--${n}` || a.startsWith(`--${n}=`));
  if (i < 0) return d;
  const hit = argv[i];
  if (hit.includes('=')) return hit.split('=').slice(1).join('=');
  return argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const PORT = Number(argOf('port', '5295'));
const DEBUG_PORT = Number(argOf('debug-port', '9341'));
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
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const log = (m) => process.stdout.write(m + '\n');
function check(ok, what, detail = '') {
  if (ok) {
    log(`  ✅ ${what}`);
  } else {
    failures++;
    log(`  ❌ ${what}${detail ? ` —— ${detail}` : ''}`);
  }
}

// ------------------------------------------------------------
//  静态服务器（和 walk-e2e.mjs 同一套）
// ------------------------------------------------------------
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

  const profile = join(tmpdir(), `airnight-ui003-${process.pid}`);
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

/** 新开一个标签页，返回一个 CDP 小客户端 */
async function newPage(url) {
  const created = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(url)}`, {
    method: 'PUT',
  })
    .then((r) => (r.ok ? r.json() : fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`).then((x) => x.json())))
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
      pending.set(mid, (m) =>
        m.error ? rej(new Error(`${method}: ${JSON.stringify(m.error)}`)) : res(m.result),
      );
      ws.send(JSON.stringify({ id: mid, method, params }));
    });

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r?.exceptionDetails) {
      throw new Error(r.exceptionDetails.text ?? 'JS 异常');
    }
    return r?.result?.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  /*
    ★ 必须把页面提到前台。
    无头浏览器里"非活动标签页"的 requestAnimationFrame 会被**节流**，
    而战斗播放（以及往日志里追加行）全靠 rAF 驱动的帧循环 ——
    不提到前台就会出现"点了开战、等 1.5 秒日志还是 0 行"这种假象。
  */
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
    /** 真的按下 -> 分步移动 -> 松开（CDP 会派生出 pointer 事件） */
    async drag(from, to, steps = 8) {
      await send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: from.x,
        y: from.y,
        button: 'none',
        buttons: 0,
      });
      await send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: from.x,
        y: from.y,
        button: 'left',
        buttons: 1,
        clickCount: 1,
      });
      for (let i = 1; i <= steps; i++) {
        const x = from.x + ((to.x - from.x) * i) / steps;
        const y = from.y + ((to.y - from.y) * i) / steps;
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
        await sleep(25);
      }
      await send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: to.x,
        y: to.y,
        button: 'left',
        buttons: 0,
        clickCount: 1,
      });
    },
  };
}

/** 把元素的屏幕矩形取回来（中心点给拖动用） */
const RECT_JS = (selector, index = 0) => `(() => {
  const nodes = document.querySelectorAll(${JSON.stringify(selector)});
  const node = nodes[${index}];
  if (!node) return null;
  const r = node.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
})()`;

// ============================================================
//  ① 日志保留到下一回合的布阵阶段（单机）
// ============================================================
async function checkLogRetention() {
  log('\n① 日志保留到下一回合布阵（单机跑一整回合）');
  const page = await newPage(`http://127.0.0.1:${PORT}/?debug=1`);
  await sleep(4500);

  await page.evaluate(`document.querySelector('#menu-solo').click(), 'ok'`);
  await sleep(2500);

  // 倍速拉满，别让这一场打太久
  await page.evaluate(`(() => {
    const btns = [...document.querySelectorAll('#speed-group button')];
    (btns.at(-1) || btns[0])?.click();
    return btns.map(b => b.textContent);
  })()`);

  // 买一个干员摆上场（开始战斗要求场上至少 1 个人）
  const placed = await page.evaluate(`(() => {
    const slot = [...document.querySelectorAll('#shop-slots .shop-slot')]
      .find((e) => !e.classList.contains('empty') && !e.classList.contains('unaffordable') && !e.classList.contains('sold-out'));
    if (slot) slot.click();
    const chip = [...document.querySelectorAll('#bench-slots .bench-slot')].find((e) => !e.classList.contains('empty'));
    if (chip) chip.click();
    const c = document.querySelector('canvas');
    const r = c.getBoundingClientRect();
    for (const [fx, fy] of [[0.45, 0.6], [0.5, 0.6], [0.4, 0.62], [0.5, 0.65]]) {
      c.dispatchEvent(new MouseEvent('click', { clientX: r.left + r.width * fx, clientY: r.top + r.height * fy, bubbles: true }));
      const b = document.querySelector('#btn-battle');
      if (b && !b.disabled) return 'placed@' + fx;
    }
    return 'failed';
  })()`);
  check(placed !== 'failed', '买到并摆上一个干员', String(placed));

  const roundBefore = await page.evaluate(`document.querySelector('#stat-round').textContent`);
  check(roundBefore === '1', '起始是第 1 回合（野怪回合）', `实际 ${roundBefore}`);

  // 开打
  await page.evaluate(`document.querySelector('#btn-battle').click(), 'ok'`);
  /*
    战斗中"确实在写日志"这条要**多采样几次取最大值**：
    开战那一瞬间日志还是空的（它是在播放过程中一行行追加的），
    只采一次很容易采到"刚清空还没写"的那一帧。
  */
  let linesMidBattle = 0;
  for (let i = 0; i < 12; i++) {
    await sleep(600);
    const n = await page.evaluate(`document.querySelectorAll('#battle-log .log-line').length`);
    linesMidBattle = Math.max(linesMidBattle, Number(n) || 0);
    if (linesMidBattle > 0) break;
  }
  check(linesMidBattle > 0, '战斗日志正在写（战斗中有行）', `行数 ${linesMidBattle}`);

  // 等到自动进入下一回合的布阵阶段：回合号变了、而且「开始战斗」又可用
  let advanced = false;
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    const now = await page.evaluate(`(() => {
      const b = document.querySelector('#btn-battle');
      return { round: document.querySelector('#stat-round').textContent, ready: !!b && !b.disabled };
    })()`);
    if (now.round !== '1' && now.ready) {
      advanced = true;
      break;
    }
  }
  check(advanced, '打完之后自动进入下一回合的布阵阶段');

  const after = await page.evaluate(`(() => {
    const all = document.querySelectorAll('#battle-log .log-line');
    const battle = document.querySelectorAll('#battle-log .log-line:not(.drop)');
    const drops = document.querySelectorAll('#battle-log .log-line.drop');
    return { all: all.length, battle: battle.length, drops: drops.length,
             text: [...battle].slice(0, 2).map(n => n.textContent.trim()) };
  })()`);
  check(
    after.battle > 0,
    '★ 进入下一回合的布阵阶段后，上一场的战斗日志**还在**（这就是需求 1）',
    `战斗行 ${after.battle} / 掉落行 ${after.drops}`,
  );
  if (after.drops > 0) {
    check(true, `野怪回合的掉落也还留着（${after.drops} 行）`);
  } else {
    log('  ℹ️ 这一场没打出掉落（没击杀或没掷中），跳过掉落断言');
  }
  await page.shot('01-日志保留到下一回合.png');
  await page.close();
}

// ============================================================
//  ② 商店卡面右上角「已拥有 N」 + ④ 装备栏拖拽互换
// ============================================================
async function checkShopBadgeAndItemSwap() {
  log('\n② 商店「已拥有 N」角标（测试模式：金币无限，方便反复刷）');
  const page = await newPage(`http://127.0.0.1:${PORT}/?debug=1`);
  await sleep(4500);
  await page.evaluate(`document.querySelector('#menu-test').click(), 'ok'`);
  await sleep(2500);

  // 买一张，记住名字
  const bought = await page.evaluate(`(() => {
    const first = document.querySelector('#shop-slots .shop-slot:not(.empty)');
    const name = first.querySelector('.shop-slot-name').textContent;
    first.click();
    return name;
  })()`);
  await sleep(800);

  // 反复刷新，直到同名卡再次出现
  const badge = await page.evaluate(`(async () => {
    const name = ${JSON.stringify(bought)};
    const refresh = document.querySelector('#btn-refresh');
    for (let i = 0; i < 120; i++) {
      refresh.click();
      await new Promise(r => setTimeout(r, 60));
      const card = [...document.querySelectorAll('#shop-slots .shop-slot:not(.empty)')]
        .find(n => n.querySelector('.shop-slot-name')?.textContent === name);
      if (!card) continue;
      const node = card.querySelector('.shop-owned-badge');
      if (!node) return { found: true, hasBadge: false, text: '', name };
      const c = card.getBoundingClientRect();
      const b = node.getBoundingClientRect();
      return {
        found: true, hasBadge: true, text: node.textContent.trim(), name,
        // 右上角：角标中心必须在卡片的右上四分之一里
        inTopRight: b.x + b.width / 2 > c.x + c.width / 2 && b.y + b.height / 2 < c.y + c.height / 2,
        css: { card: { w: Math.round(c.width), h: Math.round(c.height) }, badge: { w: Math.round(b.width), h: Math.round(b.height) } },
      };
    }
    return { found: false, name };
  })()`);

  check(badge.found, `刷到了刚买的「${bought}」`, JSON.stringify(badge));
  if (badge.found) {
    check(badge.hasBadge, '卡面右上角有 .shop-owned-badge 角标');
    check(/已拥有 \d+/.test(badge.text), `角标文案是「已拥有 N」`, badge.text);
    check(badge.inTopRight, '角标位置确实在卡面的右上角', JSON.stringify(badge.css));
  }
  await page.shot('02-商店已拥有角标.png');

  // ---------------- ④ 装备栏拖动互换 ----------------
  log('\n④ 装备栏拖动互换位置（真的按鼠标拖一次）');
  await page.evaluate(`document.querySelector('[data-side-tab="collection"]').click(), 'ok'`);
  await sleep(600);

  // 用修改器发两件「穿戴藏品」（它们会进 10 格的穿戴藏品栏）
  // 先打开修改器面板 —— 藏品下拉是"面板打开时才建"的（见 buildModifierItemOptions）
  await page.evaluate(`document.querySelector('#btn-modifier').click(), 'ok'`);
  await sleep(400);
  const granted = await page.evaluate(`(() => {
    const out = [];
    const select = document.querySelector('#modifier-item');
    const btn = document.querySelector('#modifier-grant-item');
    if (!select || !btn) return { error: '找不到修改器的获得藏品控件' };
    const options = [...select.querySelectorAll('option')];
    const wearables = options
      .filter((o) => /穿戴/.test(o.parentElement?.label || ''))
      .map((o) => o.value);
    for (const id of wearables.slice(0, 2)) {
      select.value = id;
      btn.click();
      out.push(id);
    }
    return { granted: out };
  })()`);
  check(
    Array.isArray(granted.granted) && granted.granted.length === 2,
    '发出两件穿戴藏品',
    JSON.stringify(granted),
  );
  // 收起修改器面板，免得它盖住右侧的藏品格子
  await page.evaluate(`document.querySelector('#modifier-close').click(), 'ok'`);
  await sleep(300);

  const before = await page.evaluate(`(() => {
    const slots = [...document.querySelectorAll('#item-slots-a .item-slot')];
    return slots.slice(0, 3).map(n => n.dataset.itemId || null);
  })()`);
  check(Boolean(before[0]) && Boolean(before[1]), '前两格里各有一件藏品', JSON.stringify(before));

  const fromRect = await page.evaluate(RECT_JS('#item-slots-a .item-slot', 0));
  const toRect = await page.evaluate(RECT_JS('#item-slots-a .item-slot', 1));
  if (fromRect && toRect) {
    await page.drag({ x: fromRect.cx, y: fromRect.cy }, { x: toRect.cx, y: toRect.cy });
    await sleep(500);
    const after = await page.evaluate(`(() => {
      const slots = [...document.querySelectorAll('#item-slots-a .item-slot')];
      return { order: slots.slice(0, 3).map(n => n.dataset.itemId || null),
               toast: document.querySelector('#toast')?.textContent || '' };
    })()`);
    check(
      after.order[0] === before[1] && after.order[1] === before[0],
      '★ 第 1 格与第 2 格**真的换了位置**（需求 4）',
      `前 ${JSON.stringify(before)} -> 后 ${JSON.stringify(after.order)}`,
    );
    log(`  ℹ️ 提示文案：${after.toast}`);
  } else {
    check(false, '取不到藏品格子的坐标');
  }
  await page.shot('03-装备互换.png');

  await checkOwnedCopiesBadge(page);
  await checkMonsterAttackAnim(page);

  if (page.exceptions.length) {
    check(false, '页面没有抛异常', page.exceptions.slice(0, 3).join(' | '));
  } else {
    check(true, '页面没有抛异常');
  }
  await page.close();
}

// ============================================================
//  ④ 商店角标按张数折算（2 星 = 3 张）
// ============================================================
async function checkOwnedCopiesBadge(page) {
  log('\n④ 商店「已拥有 N」按张数折算（买满 3 张合成 2 星）');
  const bought = await page.evaluate(`(() => {
    const card = document.querySelector('#shop-slots .shop-slot:not(.empty)');
    const name = card.querySelector('.shop-slot-name').textContent;
    card.click();
    return name;
  })()`);
  await sleep(600);

  /** 反复刷新商店，把同名卡买到 3 张（测试模式金币无限） */
  const bought3 = await page.evaluate(`(async () => {
    const name = ${JSON.stringify(bought)};
    const refresh = document.querySelector('#btn-refresh');
    let bought = 1;
    for (let i = 0; i < 400 && bought < 3; i++) {
      refresh.click();
      await new Promise((r) => setTimeout(r, 45));
      const card = [...document.querySelectorAll('#shop-slots .shop-slot:not(.empty)')]
        .find((n) => n.querySelector('.shop-slot-name')?.textContent === name);
      if (!card) continue;
      card.click();
      await new Promise((r) => setTimeout(r, 45));
      bought++;
    }
    return bought;
  })()`);
  check(bought3 === 3, `把「${bought}」买满 3 张`, `实际买到 ${bought3} 张`);

  const state = await page.evaluate(`(() => {
    const name = ${JSON.stringify(bought)};
    const slots = [...document.querySelectorAll('#bench-slots .bench-slot:not(.empty)')]
      .filter((n) => n.querySelector('.bench-name')?.textContent === name);
    return {
      benchCount: slots.length,
      starTitles: slots.map((n) => n.querySelector('.bench-star-strip')?.getAttribute('title') ?? ''),
    };
  })()`);
  check(
    state.starTitles.some((t) => t.includes('2 星')),
    '三张同名已经合成 2 星（后面才能验证折算）',
    JSON.stringify(state),
  );

  // 再刷到同名卡，看角标数字
  const badge = await page.evaluate(`(async () => {
    const name = ${JSON.stringify(bought)};
    const refresh = document.querySelector('#btn-refresh');
    for (let i = 0; i < 400; i++) {
      refresh.click();
      await new Promise((r) => setTimeout(r, 45));
      const card = [...document.querySelectorAll('#shop-slots .shop-slot:not(.empty)')]
        .find((n) => n.querySelector('.shop-slot-name')?.textContent === name);
      if (!card) continue;
      const node = card.querySelector('.shop-owned-badge');
      return { text: node?.textContent?.trim() ?? '', value: node?.textContent?.match(/(\\d+)/)?.[1] ?? '' };
    }
    return null;
  })()`);
  check(badge !== null, '又刷到了这张卡', JSON.stringify(badge));
  if (badge) {
    check(
      Number(badge.value) === 3,
      '★ 角标显示 3 张（2 星折算 3 张，不是"1 个"）',
      `实际「${badge.text}」`,
    );
  }
  await page.shot('04-已拥有按张数折算.png');
}

// ============================================================
//  ⑤ 野怪攻击动画：连打 15 秒，动画不能停
// ============================================================
async function checkMonsterAttackAnim(page) {
  log('\n⑤ 野怪攻击动画（沙盒里两只野怪对打 12 秒，采样动画探针）');

  const grant = async (defId) => {
    await page.evaluate(`(() => {
      const select = document.querySelector('#modifier-unit');
      select.value = ${JSON.stringify(defId)};
      document.querySelector('#modifier-grant').click();
      return select.value;
    })()`);
    await sleep(250);
  };
  const place = async () => {
    const r = await page.evaluate(`(() => {
      /*
        ★ 必须挑**最后**一个有人的备战席格子：修改器发出来的干员是 push 进去再按 uid 排序的，
        最新发的那只在最右边。取第一个的话会把上一项测试买来的干员摆上去（踩过）。
      */
      const filled = [...document.querySelectorAll('#bench-slots .bench-slot')].filter((c) => !c.classList.contains('empty'));
      const chip = filled[filled.length - 1];
      if (!chip) return 'no-chip';
      chip.click();
      const c = document.querySelector('canvas');
      const box = c.getBoundingClientRect();
      for (const [fx, fy] of [[0.45, 0.6], [0.5, 0.6], [0.4, 0.62], [0.5, 0.66], [0.55, 0.6], [0.45, 0.7]]) {
        c.dispatchEvent(new MouseEvent('click', {
          clientX: box.left + box.width * fx,
          clientY: box.top + box.height * fy,
          bubbles: true,
        }));
      }
      return document.querySelector('#btn-battle')?.textContent ?? '?';
    })()`);
    await sleep(250);
    return r;
  };

  // 打开修改器面板（干员/野怪下拉是打开时才建的）
  await page.evaluate(`document.querySelector('#btn-modifier').click(), 'ok'`);
  await sleep(300);

  await grant('mn_skzjkl');
  const blue = await place();
  await page.evaluate(`document.querySelector('#btn-switch-side').click(), 'ok'`);
  await sleep(250);
  await grant('mn_skzdd');
  const red = await place();
  check(/蓝\s*1/.test(blue) && /红\s*1/.test(red), '两边各摆上一只野怪', `${blue} / ${red}`);

  await page.evaluate(`document.querySelector('#modifier-close').click(), 'ok'`);
  await sleep(200);

  const canStart = await page.evaluate(`!document.querySelector('#btn-battle').disabled`);
  check(canStart, '满足开打条件（两边都有人）');
  await page.evaluate(`document.querySelector('#btn-battle').click(), 'ok'`);

  // 边打边采样：60ms 一次，共 12 秒；中途抓一份播放器内部状态（挥击窗口 / 倍率 / 是否重排）
  const sampled = await page.evaluate(`(async () => {
    const out = [];
    let dbg = null;
    let first = null;
    for (let i = 0; i < 200; i++) {
      const probe = globalThis.__airnightMotionProbe;
      if (probe) out.push(probe.sample().map((r) => ({ id: r.defId, anim: r.anim, frame: r.frame })));
      const rp = globalThis.__airnightReplay;
      if (rp && rp.visuals) {
        const dump = () => [...rp.visuals.values()].map((v) => ({
          defId: v.defId,
          swap: v.swing ? v.swing.swing : -1,
          speed: v.swing ? v.swing.speed : -1,
          restart: v.swingRestart,
          nextHit: v.swing ? v.swing.nextHitAt : -1,
          lastHit: v.swing ? v.swing.lastHitAt : -1,
          moving: v.moving,
          dead: v.dead,
          anim: (v.sprite && v.sprite.userData && v.sprite.userData.chibi) ? v.sprite.userData.chibi.current : '',
          frame: (v.sprite && v.sprite.userData && v.sprite.userData.chibi) ? v.sprite.userData.chibi.frame : -1,
        }));
        if (first === null) first = dump();
        if (i === 100) dbg = dump();
      }
      await new Promise((r) => setTimeout(r, 60));
    }
    return { rows: out, first, dbg };
  })()`);
  const rows = sampled.rows;
  log('  [内部状态] 开打瞬间 → 6 秒时（挥击窗口 / 倍率 / 是否重排 / 当前动作 + 帧号）：');
  const fmt = (list) =>
    (list ?? [])
      .map((v) => `${v.defId} anim=${v.anim}#${v.frame} swing=${Number(v.swap).toFixed(2)} x${Number(v.speed).toFixed(2)}${v.restart ? ' [重排]' : ''}`)
      .join(' | ');
  log(`    开打: ${fmt(sampled.first)}`);
  log(`    6秒:  ${fmt(sampled.dbg)}`);

  /** 按 defId 汇总：攻击动作里换了几次帧、重播了几次、到过第几帧 */
  const stats = new Map();
  for (let i = 0; i < rows.length; i++) {
    for (const sample of rows[i]) {
      if (!sample.id.startsWith('mn_')) continue;
      const prev = i > 0 ? rows[i - 1].find((r) => r.id === sample.id) : undefined;
      const s = stats.get(sample.id) ?? {
        attackSamples: 0,
        frameChanges: 0,
        restarts: 0,
        maxFrame: 0,
        anims: new Set(),
      };
      if (sample.anim === 'attack') {
        s.attackSamples++;
        s.maxFrame = Math.max(s.maxFrame, sample.frame);
        if (prev && prev.anim === 'attack') {
          if (prev.frame !== sample.frame) s.frameChanges++;
          // 帧号往回跳 = 动作播完从头再来了一遍
          if (sample.frame < prev.frame) s.restarts++;
        }
      }
      s.anims.add(sample.anim);
      stats.set(sample.id, s);
    }
  }

  log('  每只野怪：动画键 / 攻击采样 / 攻击动作换帧次数 / 动作从头播的次数 / 到过的最大帧');
  for (const [id, s] of stats) {
    log(
      `    ${id.padEnd(10)} ${[...s.anims].join(',').padEnd(18)} attack=${String(s.attackSamples).padStart(3)} 换帧=${String(s.frameChanges).padStart(3)} 重播=${String(s.restarts).padStart(2)} 最大帧=${String(s.maxFrame).padStart(2)}`,
    );
    check(s.anims.has('attack'), `${id} 真的进入过攻击动作`);
    /*
      ★ 这里的判据刻意"放宽"：无头浏览器（swiftshader 软渲染）的帧率很低、
      还会被 CDP 采样本身挤掉一些帧，所以"多少毫秒没换帧"这种时间口径在这里不可靠。
      因此只钉两件**和帧率无关**的事：
        · 攻击动作里帧号真的在变（用户报的 bug 是**一帧都不变**：换帧 = 0）
        · 动作播完会从头再来（重播 ≥ 2 = 至少完整播完过两轮）
      精确的时序（命中帧 = 伤害帧、最长僵住 ≤ 0.2 秒）在
      apps/web/test/chibi-anim.test.ts + attack-anim.test.ts 里用固定 60fps 钉死。
    */
    check(s.frameChanges >= 5, `★ ${id} 的攻击动画一直在换帧（${s.frameChanges} 次）`);
    check(s.restarts >= 2, `★ ${id} 的攻击动作播完能重播（${s.restarts} 次）`);
    check(s.maxFrame >= 3, `★ ${id} 的动作真的往后走了（到过第 ${s.maxFrame} 帧）`);
  }
  check(stats.size >= 2, '两只野怪都被采样到', `实际 ${stats.size} 只`);
  await page.shot('05-野怪攻击动画.png');
}

// ============================================================
//  ⑥ 彩蛋棋子「维维美·绝对主角」
// ============================================================
/*
  【为什么要用调试钩子把它摆出来？】
  它的商店概率是 **1/1500** —— 靠点击刷出来平均要 1500 次刷新，e2e 里不现实。
  所以 main.ts 在 `?debug=1` 时挂了一个 `__airnightForceEggShop()`：
  只把商店第 0 格换成彩蛋再重画商店，**概率逻辑一个字都没改**
  （正常玩永远走不到这条路径）。
*/
async function checkEggUnit() {
  log('\n⑥ 彩蛋棋子「维维美·绝对主角」（商店卡炫彩 / 无星级 / 3D 卡面 + 小人）');
  const page = await newPage(`http://127.0.0.1:${PORT}/?debug=1`);
  await sleep(4500);
  await page.evaluate(`document.querySelector('#menu-test').click(), 'ok'`);
  await sleep(2500);

  const forced = await page.evaluate(`(() => {
    const fn = globalThis.__airnightForceEggShop;
    if (typeof fn !== 'function') return { error: '没有 __airnightForceEggShop 钩子' };
    return { defIds: fn() };
  })()`);
  check(forced.defIds?.[0] === 'egg_mvm', '商店第 0 格被换成彩蛋', JSON.stringify(forced));
  await sleep(400);

  // ---------- 商店卡 ----------
  const card = await page.evaluate(`(() => {
    const node = document.querySelector('#shop-slots .shop-slot.egg');
    if (!node) return { found: false };
    const box = node.querySelector('.shop-portrait-box');
    return {
      found: true,
      name: node.querySelector('.shop-slot-name')?.textContent ?? '',
      traits: node.querySelector('.shop-slot-traits')?.textContent ?? '',
      cost: node.querySelector('.shop-cost-badge')?.textContent ?? '',
      backgroundImage: getComputedStyle(node).backgroundImage.slice(0, 200),
      portraitBg: box ? getComputedStyle(box).backgroundImage.slice(0, 200) : '',
      hasUpgradeHint: !!node.querySelector('.upgrade-badge, .upgrade-hint'),
    };
  })()`);
  check(card.found, '商店里出现了 .shop-slot.egg 卡片', card.found ? '' : JSON.stringify(card));
  if (card.found) {
    check(card.name.includes('维维美'), '名字是「维维美·绝对主角」', card.name);
    check(card.cost === '20', '费用角标是 20', card.cost);
    check(card.traits.includes('无羁绊'), '标签是「无羁绊 · 彩蛋」', card.traits);
    check(/gradient/.test(card.backgroundImage), '商店卡背景是渐变炫彩', card.backgroundImage);
    check(/gradient/.test(card.portraitBg), '干员背景卡面也是渐变', card.portraitBg);
    check(!card.hasUpgradeHint, '没有"可升星 / x/3"提示（它没有星级机制）');
  }
  await page.shot('06-彩蛋商店卡.png');

  // ---------- 买下来 → 备战席 ----------
  const bench = await page.evaluate(`(async () => {
    const egg = document.querySelector('#shop-slots .shop-slot.egg');
    if (!egg) return { found: false };
    egg.click();
    await new Promise((r) => setTimeout(r, 500));
    const slot = [...document.querySelectorAll('#bench-slots .bench-slot')]
      .find((n) => (n.querySelector('.bench-name')?.textContent ?? '').includes('维维美'));
    if (!slot) return { found: false };
    const strip = slot.querySelector('.bench-star-strip');
    return { found: true, stripClass: strip?.className ?? '', stripText: strip?.textContent ?? '' };
  })()`);
  check(bench.found, '买下后出现在备战席', JSON.stringify(bench));
  if (bench.found) {
    check(bench.stripClass.includes('egg'), '备战席那一格带 .egg 样式', bench.stripClass);
    check(bench.stripText.includes('彩蛋'), '星级条显示「彩蛋」而不是星星', bench.stripText);
  }

  // ---------- 摆到场上（看 3D 卡面和小人） ----------
  const onBoard = await page.evaluate(`(() => {
    const slot = [...document.querySelectorAll('#bench-slots .bench-slot')]
      .find((n) => (n.querySelector('.bench-name')?.textContent ?? '').includes('维维美'));
    if (!slot) return 'no-chip';
    slot.click();
    const c = document.querySelector('canvas');
    const box = c.getBoundingClientRect();
    for (const [fx, fy] of [[0.45, 0.6], [0.5, 0.6], [0.4, 0.62], [0.5, 0.66], [0.55, 0.6]]) {
      c.dispatchEvent(new MouseEvent('click', {
        clientX: box.left + box.width * fx, clientY: box.top + box.height * fy, bubbles: true,
      }));
    }
    return document.querySelector('#btn-battle')?.textContent ?? '?';
  })()`);
  check(/蓝\s*[1-9]/.test(onBoard), '彩蛋被摆上了场', onBoard);
  await sleep(2800); // 等"绝对主角"的小人素材加载完

  const probe = await page.evaluate(`(() => {
    const p = globalThis.__airnightUnitProbe;
    const rows = p ? p.report().filter((r) => r.defId === 'egg_mvm') : [];
    const cs = globalThis.__airnightChibiStats;
    return { rows, chibi: typeof cs === 'function' ? cs() : null };
  })()`);
  log(`  [小人] ${JSON.stringify(probe.rows)}`);
  check(probe.rows.length > 0, '场上找到了彩蛋棋子', JSON.stringify(probe.rows));
  if (probe.rows.length > 0) {
    const row = probe.rows[0];
    check(row.hasChibi === true, '卡面挂上了小人', JSON.stringify(row));
    check(row.chibiReady === true, '「绝对主角」皮肤的小人素材已就绪', JSON.stringify(row));
  }
  await page.shot('07-彩蛋棋子.png');
  await page.close();
}

// ============================================================
//  ⑦ 右键防护：按住右键拖动（浏览器鼠标手势）不该误卖棋子
// ============================================================
/*
  【为什么这条必须真右键一次？】
  它测的是一条**时序**规则："按下～松开之间移动了多远"。
  单测只能证明源码里写了那个阈值，证明不了"浏览器派发出来的真实右键序列
  不会把棋子卖掉"。而浏览器鼠标手势恰好就是"按住右键拖着走"——
  用真实的 pointer 事件跑一遍，才算真的验收。
*/
async function checkRightClickGuard() {
  log('\n⑦ 右键防护（按住右键拖动 = 浏览器手势，不该误卖棋子）');
  const page = await newPage(`http://127.0.0.1:${PORT}/?debug=1`);
  await sleep(4500);
  await page.evaluate(`document.querySelector('#menu-test').click(), 'ok'`);
  await sleep(2500);

  // 买一张棋子进备战席
  await page.evaluate(`document.querySelector('#shop-slots .shop-slot:not(.empty)').click(), 'ok'`);
  await sleep(700);
  const before = await page.evaluate(
    `document.querySelectorAll('#bench-slots .bench-slot:not(.empty)').length`,
  );
  check(before >= 1, '备战席上有棋子了（准备被误触）', `数量 ${before}`);

  const box = await page.evaluate(RECT_JS('#bench-slots .bench-slot:not(.empty)'));
  if (!box) {
    check(false, '取到了备战席那个棋子的位置');
    await page.close();
    return;
  }
  const x = Math.round(box.cx);
  const y = Math.round(box.cy);

  // ---- ① 按住右键拖着走（模拟浏览器手势）----
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
  await page.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1,
  });
  for (let i = 1; i <= 8; i++) {
    await page.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: x + i * 6, y: y - i * 3, button: 'right', buttons: 2,
    });
    await sleep(20);
  }
  await page.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: x + 48, y: y - 24, button: 'right', buttons: 0, clickCount: 1,
  });
  await sleep(600);
  const afterDrag = await page.evaluate(
    `document.querySelectorAll('#bench-slots .bench-slot:not(.empty)').length`,
  );
  check(
    afterDrag === before,
    '★ 按住右键拖着走（手势）之后棋子还在 —— 没有被误卖',
    `拖之前 ${before} 个 / 拖之后 ${afterDrag} 个`,
  );

  // ---- ② 右键单击（按下～松开几乎没动）----
  await page.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1,
  });
  await sleep(80);
  await page.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1,
  });
  await sleep(600);
  const afterClick = await page.evaluate(
    `document.querySelectorAll('#bench-slots .bench-slot:not(.empty)').length`,
  );
  check(
    afterClick === before - 1,
    '★ 右键**单击**仍然能卖（功能没丢，只是不再被手势误触）',
    `点之前 ${before} 个 / 点之后 ${afterClick} 个`,
  );

  await page.shot('08-右键防误触.png');
  await page.close();
}

// ============================================================
//  主流程
// ============================================================
let server;
let browser;
try {
  await mkdir(outDir, { recursive: true });
  if (!existsSync(join(distDir, 'index.html'))) {
    throw new Error('没有 dist/index.html —— 先跑一次 vite build');
  }
  server = await startServer();
  log(`静态服务器 http://127.0.0.1:${PORT}`);
  browser = await launchBrowser();

  await checkLogRetention();
  await checkShopBadgeAndItemSwap();
  await checkEggUnit();
  await checkRightClickGuard();

  log(
    failures === 0
      ? '\n全部通过 ✅（截图在 .ui-e2e/）'
      : `\n有 ${failures} 项没过 ❌`,
  );
} catch (err) {
  failures++;
  log(`\n脚本自己出错了：${err?.stack ?? err}`);
} finally {
  if (!KEEP_OPEN) {
    browser?.cleanup();
    server?.close();
  } else {
    log('（--keep-open：浏览器和服务器保持运行，Ctrl+C 结束）');
  }
}
process.exitCode = failures === 0 ? 0 : 1;
