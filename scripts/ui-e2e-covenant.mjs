#!/usr/bin/env node
/**
 * ============================================================
 *  0.3 界面回归：盟约选秀 + 「买牌抽搐」+ 房间号复制提示
 * ============================================================
 *
 * 这个脚本守四件**只有真开浏览器才测得出来**的事：
 *
 * ① **买牌抽搐**（用户报的）：`.shop-slot` 的 `:hover` 是 `translateY(-3px)` + transition。
 *    以前买一张牌会把 5 张卡全部重建 → 每张都从 0 过渡一次 ⇒ "整排卡片掉下去又弹回来"。
 *    现在按格子就地更新，所以这里断言：
 *      · 买一张牌只该变动 0~4 个节点（另一张顶多因为"钱不够了"变个样式）
 *      · 悬停中的那张卡**还是同一个 DOM 节点**（节点身份 = hover 状态不丢）
 * ② **羁绊列表抽搐**（同一个根因，`:hover` 是 `translateX(2px)`）：买牌时应当 0 重建。
 * ③ **盟约选秀**：卡面只放头像、不显示名字；点开才出名字 + 效果；选完效果真的落地。
 * ④ **房间号**：不能一点就"变成蓝色选中块"（`user-select` 必须关掉）；
 *    提示气泡（toast）必须压在大厅那层浮层**上面**，否则"点了没反应"。
 *
 * 用法：
 *   node scripts/ui-e2e-covenant.mjs
 * 截图写到 .ui-e2e/
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
const PORT = 5303;
const DEBUG_PORT = 9353;

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

function startServer() {
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
  return new Promise((r) => server.listen(PORT, '127.0.0.1', () => r(server)));
}

const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
];

async function launchBrowser() {
  const exe = BROWSERS.find((p) => { try { accessSync(p); return true; } catch { return false; } });
  if (!exe) throw new Error('找不到 Edge / Chrome');
  const profile = join(tmpdir(), `airnight-cv-${process.pid}`);
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
    if (r?.exceptionDetails) return 'EXC: ' + JSON.stringify(r.exceptionDetails).slice(0, 400);
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

const server = await startServer();
const browser = await launchBrowser();
try {
  // ★ `covenant=1` 才会显示单机选秀（`?debug=1` 单独用时会自动跳过，见 main.ts 里的说明）
  const page = await newPage(`http://127.0.0.1:${PORT}/?debug=1&covenant=1`);
  for (let i = 0; i < 40; i++) {
    if ((await page.evaluate(`typeof __airnightForceEggShop === 'function'`)) === true) break;
    await sleep(500);
  }

  log('\n① 单机开局 -> 盟约选秀（卡面只有头像）');
  await page.evaluate(`document.querySelector('#menu-test')?.click(), 'ok'`);
  await sleep(2000);
  const draft = await page.evaluate(`(() => ({
    shown: !document.querySelector('#covenant-overlay').classList.contains('hidden'),
    cards: document.querySelectorAll('#covenant-grid .covenant-card').length,
    avatars: [...document.querySelectorAll('#covenant-grid .covenant-avatar-img')]
      .filter((n) => n.getBoundingClientRect().width > 40).length,
    namesVisible: [...document.querySelectorAll('#covenant-grid .covenant-card-name')]
      .filter((n) => getComputedStyle(n).display !== 'none').length,
    skipShown: !document.querySelector('#covenant-skip').classList.contains('hidden'),
  }))()`);
  check(draft.shown === true, '弹出盟约选秀');
  // ★ 0.3.1：盟约从 10 个扩到 16 个 —— 数量跟着数据表走，别再写死 10
  check(draft.cards === 16, '16 张卡', String(draft.cards));
  check(draft.avatars === 16, '★★ 每张卡都有可见头像（改动前这里 0 高，只剩名字）', `${draft.avatars}/16`);
  check(draft.namesVisible === 0, '★★ 卡面不显示名字', `${draft.namesVisible} 个显示中`);
  check(draft.skipShown === true, '单机有「跳过」');
  await page.shot('94-盟约选秀-头像.png');

  log('\n② 点开一张 -> 名字 + 效果出现');
  await page.evaluate(`document.querySelectorAll('#covenant-grid .covenant-card')[3].click(), 'ok'`);
  await sleep(400);
  const detail = await page.evaluate(`(() => ({
    names: [...document.querySelectorAll('#covenant-grid .covenant-card-name')]
      .filter((n) => getComputedStyle(n).display !== 'none').map((n) => n.textContent),
    detail: document.querySelector('#covenant-detail').textContent.trim(),
    canPick: !document.querySelector('#covenant-pick').disabled,
  }))()`);
  check(detail.names.length === 1, '只有点开的那张显示名字', JSON.stringify(detail.names));
  check(detail.detail.includes(detail.names[0] ?? '\u0000'), '右侧详情里有名字', detail.detail.slice(0, 40));
  check(detail.detail.length > 20, '右侧详情有效果说明');
  check(detail.canPick === true, '「选择盟约」可点');
  await page.shot('95-盟约选秀-点开.png');

  log('\n③ 选中之后效果真的落地（拿「开局生命 +30」那张验证）');
  /*
    ★ 用「歌利亚」那张（`startHp +30`）来验：它在单机的落地路径最短、
      而且是**数值型**的，一眼能从顶栏读出来。
      金币那类在测试模式是 ∞（无限金币），验不了 —— 所以不拿它当判据。
  */
  const hpBefore = await page.evaluate(`document.querySelector('#stat-hp').textContent`);
  // 卡片的 title = `盟约名 · 一句话效果`；按"开局生命 +30"找那张（cv_golia「坚不可摧」）
  const goliaIndex = await page.evaluate(`(() => {
    const cards = [...document.querySelectorAll('#covenant-grid .covenant-card')];
    return cards.findIndex((c) => (c.title || '').includes('开局生命 +30'));
  })()`);
  if (goliaIndex >= 0) {
    await page.evaluate(
      `document.querySelectorAll('#covenant-grid .covenant-card')[${goliaIndex}].click(), 'ok'`,
    );
    await sleep(300);
  }
  await page.evaluate(`document.querySelector('#covenant-pick').click(), 'ok'`);
  await sleep(600);
  const applied = await page.evaluate(`(() => ({
    hidden: document.querySelector('#covenant-overlay').classList.contains('hidden'),
    hp: document.querySelector('#stat-hp').textContent,
  }))()`);
  check(applied.hidden === true, '选完自动收起');
  if (goliaIndex >= 0) {
    check(
      Number(applied.hp) === Number(hpBefore) + 30,
      '★★ 开局生命真的 +30（盟约在单机里落地了）',
      `${hpBefore} -> ${applied.hp}`,
    );
  } else {
    log('  （没找到「歌利亚」那张，跳过血量断言）');
  }

  log('\n④ 买一张牌：不该把整排卡重建（抽搐的根因）');
  await page.evaluate(`(() => {
    globalThis.__diag = { shop: 0, traits: 0, bench: 0 };
    const watch = (sel, key) => {
      const node = document.querySelector(sel);
      if (!node) return;
      new MutationObserver((recs) => {
        for (const r of recs) globalThis.__diag[key] += r.addedNodes.length + r.removedNodes.length;
      }).observe(node, { childList: true });
    };
    watch('#shop-slots', 'shop');
    watch('#trait-list', 'traits');
    watch('#bench-slots', 'bench');
    return 'ok';
  })()`);
  const bought = await page.evaluate(`(() => {
    const card = document.querySelector('#shop-slots .shop-slot:not(.empty)');
    const name = card.querySelector('.shop-slot-name')?.textContent ?? '';
    card.click();
    return name;
  })()`);
  await sleep(800);
  const diag = JSON.parse(await page.evaluate(`JSON.stringify(globalThis.__diag)`));
  log(`  买了「${bought}」：#shop ${diag.shop} 个节点 / #trait ${diag.traits} / #bench ${diag.bench}`);
  /*
    允许的变化只有两处：买走的那一格（replaceWith = +1/-1）+ 顶多另一张因为
    "钱不够了"换样式（再 +1/-1）。改动前是 5 张卡 + 9 格备战席 + 一列羁绊全重建。
  */
  check(diag.shop <= 4, '★★ 商店只重建必要的那 1~2 张（改动前 10 个节点）', String(diag.shop));
  check(diag.traits === 0, '★★ 羁绊列表 0 重建（改动前整块重建 → 抽搐）', String(diag.traits));
  check(diag.bench <= 2, '★ 备战席只动"新棋子进去的那一格"', String(diag.bench));

  log('\n⑤ 重画之后卡片还是同一个节点（hover 的位移动画不会重来）');
  const reuse = await page.evaluate(`(() => {
    const card = document.querySelector('#shop-slots .shop-slot:not(.empty)');
    if (!card) return 'no-card';
    card.__mark = 'before';
    document.querySelector('#btn-buy-xp')?.click();
    return { same: document.querySelector('#shop-slots .shop-slot:not(.empty)')?.__mark === 'before' };
  })()`);
  check(reuse.same === true, '★★ 节点身份不变', JSON.stringify(reuse));

  log('\n⑥ 空转 3 秒零重建');
  await page.evaluate(`globalThis.__diag = { shop: 0, traits: 0, bench: 0 }, 'reset'`);
  await sleep(3000);
  const idle = JSON.parse(await page.evaluate(`JSON.stringify(globalThis.__diag)`));
  check(idle.shop === 0 && idle.traits === 0 && idle.bench === 0, '空转不重画', JSON.stringify(idle));

  log('\n⑦ 房间号：不能一点就变蓝；提示气泡要压在大厅浮层上面');
  const css = await page.evaluate(`(() => {
    const code = document.querySelector('#lobby-code');
    const toast = document.querySelector('#toast');
    const overlay = document.querySelector('#lobby-overlay');
    return {
      codeSelect: getComputedStyle(code).userSelect,
      toastZ: Number(getComputedStyle(toast).zIndex),
      overlayZ: Number(getComputedStyle(overlay).zIndex),
    };
  })()`);
  check(css.codeSelect === 'none', '★ 房间号不可被选中（选中态就是那块"蓝底"）', css.codeSelect);
  check(
    css.toastZ > css.overlayZ,
    '★★ 提示气泡的层级高于大厅浮层（否则提示被盖住 = "点了没反应"）',
    `toast ${css.toastZ} vs overlay ${css.overlayZ}`,
  );

  await page.shot('96-诊断-买牌后.png');
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
