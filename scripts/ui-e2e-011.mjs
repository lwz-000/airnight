#!/usr/bin/env node
/**
 * ============================================================
 *  0.1.1 两个新界面的**真实浏览器**验证
 * ============================================================
 *
 * 覆盖：
 *   ① 备战席棋子的悬停卡片 —— 鼠标移上去真的弹出来，内容只有那五样
 *   ② 联机对局结算页 —— 排名 / 死亡阵容 / 羁绊 / 最高伤害 四个模块的排版
 *
 * 用法：
 *   node scripts/ui-e2e-011.mjs                # 跑一遍，截图写到 .ui-e2e/
 *   node scripts/ui-e2e-011.mjs --keep-open    # 不关浏览器
 *
 * 【为什么这两条必须真开一次浏览器？】
 *   · 悬停本身就是"鼠标真的在元素上"这件事 —— jsdom 里没有布局、
 *     也没有 pointerenter 的坐标系，测不出"卡片弹在哪儿 / 会不会把格子挡住"。
 *   · 结算页是一整页排版（标签换行、滚动区、冠军高亮），
 *     只有渲染出来才知道有没有溢出/错位。
 *
 * 【结算页怎么"提前"看到？】
 *   它只有真的打完一整局（血 100、每回合掉 3~9）才会出现。
 *   所以走 `?debug=1` 的预览钩子 `__airnightPreviewResult()`：
 *   用真实干员拼一份 4 人演示战绩，直接调 renderResultPage ——
 *   不伪造网络消息、不碰游戏逻辑（和 `__airnightForceEggShop` 同一个思路）。
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { accessSync } from 'node:fs';
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
const PORT = Number(argOf('port', '5296'));
const DEBUG_PORT = Number(argOf('debug-port', '9342'));
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
  if (ok) log(`  ✅ ${what}`);
  else {
    failures++;
    log(`  ❌ ${what}${detail ? ` —— ${detail}` : ''}`);
  }
}

// ------------------------------------------------------------
//  静态服务器
// ------------------------------------------------------------
function startServer() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    let path = decodeURIComponent(url.pathname);
    if (path === '/') path = '/index.html';
    let file = join(distDir, path);
    try {
      await readFile(file);
    } catch {
      file = join(distDir, 'index.html'); // 未知路径回落首页（和游戏内服务一致）
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((res) => server.listen(PORT, '127.0.0.1', () => res(server)));
}

// ------------------------------------------------------------
//  浏览器（Edge / Chrome + CDP）
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

  const profile = join(tmpdir(), `airnight-ui011-${process.pid}`);
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
  // ★ 非活动标签页的 rAF 会被节流 —— 必须提到前台（和 ui-e2e-003 同一个坑）
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
    /** 把鼠标真的移到某个坐标上（DOM 元素才会触发 pointerenter） */
    async hoverAt(x, y) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
    },
  };
}

const RECT_JS = (selector, index = 0) => `(() => {
  const node = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
  if (!node) return null;
  const r = node.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
})()`;

// ============================================================
//  ① 备战席悬停卡片
// ============================================================
async function checkBenchTip(page) {
  log('\n① 备战席悬停卡片（只显示 名字 / 星级 / 羁绊 / 技能 / 射程）');
  await page.evaluate(`document.querySelector('#menu-test').click(), 'ok'`);
  await sleep(2000);

  // 买一个进备战席（测试模式下购买是立刻生效的）
  const bought = await page.evaluate(`(() => {
    const card = document.querySelector('#shop-slots .shop-slot:not(.empty)');
    if (!card) return null;
    const name = card.querySelector('.shop-slot-name')?.textContent ?? '';
    card.click();
    return name;
  })()`);
  await sleep(800);

  const rect = await page.evaluate(RECT_JS('#bench-slots .bench-slot:not(.empty)'));
  check(Boolean(rect), '备战席上有干员可以悬停', `买到的：${bought}`);
  if (!rect) return;

  const tipBefore = await page.evaluate(
    `document.querySelector('#bench-tip').classList.contains('hidden')`,
  );
  check(tipBefore === true, '没悬停时卡片是收着的');

  await page.hoverAt(rect.cx, rect.cy);
  await sleep(500);

  const state = await page.evaluate(`(() => {
    const tip = document.querySelector('#bench-tip');
    const r = tip.getBoundingClientRect();
    const slot = document.querySelector('#bench-slots .bench-slot:not(.empty)');
    const sr = slot.getBoundingClientRect();
    return {
      hidden: tip.classList.contains('hidden'),
      text: tip.textContent,
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      slot: { top: sr.top, left: sr.left, w: sr.width },
      nativeTitle: slot.getAttribute('title'),
    };
  })()`);

  check(state.hidden === false, '悬停后卡片弹出来了');
  check(state.nativeTitle === null, '原生 title 已经去掉（不会和卡片叠两层）');
  for (const [what, needle] of [
    ['名字', bought ?? ''],
    ['星级', '★'],
    ['射程', '射程'],
    ['羁绊区块', '羁绊'],
    ['技能区块', '技能'],
  ]) {
    check(state.text.includes(needle), `卡片里有${what}`);
  }
  check(!state.text.includes('藏品'), '卡片里不写藏品');
  check(!/\d\s*费/.test(state.text), '卡片里不写费用');
  // 排版：卡片要真的在那格子的上方（备战席在屏幕底部）
  check(state.rect.h > 40, '卡片有实际高度（不是被压成一条）');
  check(
    state.rect.y + state.rect.h <= state.slot.top + 4,
    '卡片落在格子上方，没有盖住备战席本身',
    `卡片底 ${Math.round(state.rect.y + state.rect.h)} vs 格子顶 ${Math.round(state.slot.top)}`,
  );
  check(
    state.rect.x >= 0 && state.rect.x + state.rect.w <= 1440,
    '卡片没有跑出屏幕左右边界',
  );

  await page.shot('11-备战席悬停卡片.png');
}

// ============================================================
//  ② 联机结算页
// ============================================================
async function checkResultPage(page) {
  log('\n② 联机结算页（排名 / 死亡阵容 / 羁绊 / 最高伤害）');
  const ok = await page.evaluate(`typeof __airnightPreviewResult === 'function'`);
  check(ok === true, '预览钩子存在（只有 ?debug=1 才有）');
  if (!ok) return;

  const count = await page.evaluate(`__airnightPreviewResult()`);
  await sleep(600);
  check(count === 4, '演示数据是 4 位玩家', String(count));

  const view = await page.evaluate(`(() => {
    const page = document.querySelector('#result-page');
    const list = document.querySelector('#result-list');
    const cards = [...list.querySelectorAll('.result-card')];
    const first = cards[0];
    return {
      hidden: page.classList.contains('hidden'),
      title: document.querySelector('#result-title').textContent,
      sub: document.querySelector('#result-sub').textContent,
      mvp: document.querySelector('#result-mvp').textContent,
      ranks: cards.map((c) => c.querySelector('.result-rank')?.textContent),
      champion: first?.classList.contains('champion'),
      firstUnits: first ? first.querySelectorAll('.result-unit').length : 0,
      firstTraits: first ? first.querySelectorAll('.result-trait').length : 0,
      firstText: first?.textContent ?? '',
      emptyTraitsShown: [...list.querySelectorAll('.result-traits')].some((n) =>
        n.textContent.includes('没有激活的羁绊'),
      ),
      shellH: document.querySelector('.result-shell').getBoundingClientRect().height,
      listScroll: list.scrollHeight > list.clientHeight,
    };
  })()`);

  check(view.hidden === false, '结算页打开了');
  check(view.title.length > 0, '有标题', view.title);
  check(view.sub.includes('回合'), '副标题写了回合数', view.sub);
  check(view.mvp.includes('—'), '顶部有全局最高伤害', view.mvp);
  check(view.ranks.join(',') === '1,2,3,4', '名次按 1/2/3/4 排好', view.ranks.join(','));
  check(view.champion === true, '第 1 名有冠军样式');
  check(view.firstUnits > 0, '第 1 名的阵容画出来了', `${view.firstUnits} 张`);
  check(view.firstTraits > 0, '第 1 名的羁绊画出来了', `${view.firstTraits} 个`);
  check(view.firstText.includes('费'), '阵容里写明了费用（排序依据要看得懂）');
  check(/\d/.test(view.firstText), '有伤害数字');
  check(view.shellH <= 900, '整页没有超出窗口高度（内部滚动）', String(Math.round(view.shellH)));
  check(view.listScroll === true, '玩家多的时候列表自己能滚');

  await page.shot('12-联机结算页.png');
}

// ============================================================
//  ③ ★ 0.1.1「共享藏品效果」栏
// ============================================================
//
// 【为什么这一栏必须真开一次浏览器？】
// 它的规格有一半是**位置**：必须夹在「共享装备位」和「删除藏品」之间。
// DOM 顺序对了不代表屏幕上对了（那一块整体可能被挤出可视区 / 高度塌成 0），
// 所以这里既查 DOM 顺序，也量真实 rect。
async function checkItemEffectList(page) {
  log('\n③ ★ 共享藏品效果栏（夹在「共享装备位」与「删除藏品」之间）');

  const before = await page.evaluate(`document.querySelectorAll('#item-effect-list .item-effect').length`);
  check(before === 0, '开局效果栏是空的', String(before));
  const emptyText = await page.evaluate(`document.querySelector('#item-effect-list')?.textContent ?? ''`);
  check(emptyText.includes('还没有生效中的效果'), '空态有说明文案');

  await page.evaluate(`document.querySelector('#btn-modifier').click(), 'ok'`);
  await sleep(300);

  /*
    装一件**会叠层**的共享藏品（黑流树海笔记）——一件就能验三件事：
    装上去要出现、写明了是哪件、效果全文要跟着出来。
  */
  const granted = await page.evaluate(`(() => {
    const select = document.querySelector('#modifier-item');
    if (!select) return false;
    select.value = 'itm_blackflow_notes';
    document.querySelector('#modifier-grant-item').click();
    return true;
  })()`);
  check(granted === true, '修改器给出了藏品');
  await sleep(400);

  const equipped = await page.evaluate(`(() => {
    const slot = document.querySelector('#item-slots-b .item-slot:not(.empty)');
    if (!slot) return false;
    slot.click();
    return true;
  })()`);
  check(equipped === true, '共享藏品装进了共享装备位');
  await sleep(400);

  const view = await page.evaluate(`(() => {
    const rows = [...document.querySelectorAll('#item-effect-list .item-effect')];
    const rect = (sel) => document.querySelector(sel)?.getBoundingClientRect() ?? null;
    const eqRect = rect('#item-slots-bequip .item-slot:not(.empty)');
    const listRect = rect('#item-effect-list');
    const delRect = rect('#item-delete-zone');
    return {
      rows: rows.length,
      text: rows.map((row) => row.textContent).join(' | '),
      count: document.querySelector('#item-effect-count')?.textContent ?? '',
      orderOk: Boolean(eqRect && listRect && delRect && eqRect.top < listRect.top && listRect.top < delRect.top),
      height: listRect ? Math.round(listRect.height) : 0,
    };
  })()`);

  check(view.rows === 1, '效果栏里正好一行', String(view.rows));
  check(view.text.includes('黑流树海笔记'), '写明了是哪件藏品', view.text.slice(0, 60));
  /*
    ★ 0.3：这一行现在的文案是"**结算出来的结果**"而不是数据的原始描述
    （例：`黑流树海笔记 胜利后额外金币概率 0%（当前 0 层）`）。
    对玩家更有用 —— 所以断言改成"说清是什么效果 + 带当前层数"，
    不再去比对某个固定词（那样一改文案就假红）。
  */
  check(/额外金币/.test(view.text), '效果全文跟出来了（说清了给什么）', JSON.stringify(view.text));
  check(/层/.test(view.text), '带上了当前层数', JSON.stringify(view.text));
  check(view.count === '1 项', '计数跟着变', view.count);
  check(view.orderOk, '位置在「共享装备位」与「删除藏品」之间');
  check(view.height > 10, '真的占到了版面（不是 0 高度）', `${view.height}px`);

  /*
    ★ 截图要看得见，所以临时把视口放宽：右侧藏品栏在 1024 宽下会被裁到屏幕外，
    截出来只有半截（第一版就是这样）。只影响这一张图，截完立刻还原。
  */
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: 1680,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await sleep(500);
  await page.shot('13-共享藏品效果栏.png');
  await page.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
  await sleep(200);
}

// ============================================================
//  main
// ============================================================
let server;
let browser;
try {
  log('启动静态服务器 + 无头浏览器…');
  server = await startServer();
  browser = await launchBrowser();
  const page = await newPage(`http://127.0.0.1:${PORT}/?debug=1`);
  // 小人素材很多，给足加载时间
  await sleep(6000);

  await checkBenchTip(page);
  await checkItemEffectList(page);
  await checkResultPage(page);

  const errs = page.exceptions.filter(Boolean);
  check(errs.length === 0, '页面没有 JS 异常', errs.slice(0, 3).join(' | '));

  if (KEEP_OPEN) {
    log('\n(--keep-open) 浏览器留着不关，Ctrl+C 结束');
  } else {
    await page.close();
  }
} catch (err) {
  failures++;
  log(`\n💥 ${err.stack ?? err}`);
} finally {
  if (!KEEP_OPEN) {
    browser?.cleanup();
    server?.close();
  }
}

log(`\n${failures === 0 ? '✅ 全部通过' : `❌ ${failures} 项失败`}`);
process.exit(failures === 0 ? 0 : 1);
