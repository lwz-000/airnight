/**
 * ============================================================
 *  「退出游戏」接口（POST /__airnight/quit）
 * ============================================================
 *
 * 【这个接口为什么值得单独测？】
 * 0.3.2 把启动器的黑框藏起来之后，网页上那个按钮成了**唯一的退出入口**。
 * 它同时又是一个"能让后台进程自己死掉"的接口 —— 开错了就是:
 *   · 局域网里的朋友点一下，房主那台机器上的游戏停了；
 *   · 你随便逛的某个网页偷偷 POST 一下，游戏就没了。
 * 所以它的两道锁（只认本机 / 令牌）必须被钉住，不能靠"我写的时候想清楚了"。
 *
 * ★ 只测真实的 HTTP 往返，不测内部函数 —— 这两道锁真正生效的地方就是网络边界。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { createCombinedServer } from '../../../scripts/serve-static.mjs';

const TOKEN = 'a1b2c3d4e5f60718';

/** 造一个能起的合并服务器（dist 自己造，和"有没有打包"解耦） */
function start(options: { quitToken?: string; onQuit?: (() => void) | null; sessionFile: string }): Promise<{
  server: Server;
  port: number;
}> {
  const distDir = mkdtempSync(join(tmpdir(), 'airnight-quit-'));
  writeFileSync(join(distDir, 'index.html'), '<!doctype html><title>quit test</title>');
  const server = createCombinedServer({
    distDir,
    gamePort: 1, // 这个测试不碰 WebSocket，给个不会有人听的端口就行
    quiet: true,
    sessionFile: options.sessionFile,
    quitToken: options.quitToken ?? '',
    onQuit: options.onQuit ?? null,
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '0.0.0.0', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      if (!port) return reject(new Error('没拿到端口'));
      resolve({ server, port });
    });
  });
}

function post(port: number, body: unknown, host = '127.0.0.1'): Promise<Response> {
  return fetch(`http://${host}:${port}/__airnight/quit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /__airnight/quit —— 网页上的「退出游戏」', () => {
  let sessionFile = '';
  const opened: Server[] = [];

  beforeAll(() => {
    sessionFile = join(mkdtempSync(join(tmpdir(), 'airnight-quit-session-')), 'session.json');
  });

  afterAll(() => {
    for (const server of opened) server.close();
    rmSync(sessionFile, { recursive: true, force: true });
  });

  async function open(token: string) {
    let calls = 0;
    const { server, port } = await start({
      quitToken: token,
      onQuit: () => {
        calls += 1;
      },
      sessionFile,
    });
    opened.push(server);
    return { port, calls: () => calls };
  }

  it('没配令牌的服务器直接 404（单独跑 pnpm static 就是这种）', async () => {
    const { port, calls } = await open('');
    const res = await post(port, { token: '' });
    expect(res.status).toBe(404);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(calls(), '404 之后绝不能再退').toBe(0);
  });

  it('令牌不对 → 403，而且**不会**退出', async () => {
    const { port, calls } = await open(TOKEN);
    const res = await post(port, { token: 'deadbeefdeadbeef' });
    expect(res.status).toBe(403);
    // 等过 80ms 的那个延迟：如果实现里"先退再校验"，这里就会抓到
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(calls(), '错令牌绝不能退').toBe(0);
  });

  it('GET 不许用（避免被"随便点个链接"触发）', async () => {
    const { port, calls } = await open(TOKEN);
    const res = await fetch(`http://127.0.0.1:${port}/__airnight/quit?token=${TOKEN}`);
    expect(res.status).toBe(405);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(calls()).toBe(0);
  });

  it('令牌对了 → 200 { ok: true }，并且真的回调一次', async () => {
    const { port, calls } = await open(TOKEN);
    const res = await post(port, { token: TOKEN });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    /*
      ★ 先回包、80ms 之后才退 —— 顺序反了的话浏览器拿到的是"连接被重置"，
        前端只能显示"操作失败"，玩家会以为按钮坏了。
        所以这里断言：响应先到，回调后到。
    */
    expect(calls(), '响应回来的时候还不该退').toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(calls(), '80ms 之后应该退了一次').toBe(1);
  });

  it('body 不是 JSON → 400（不是"崩掉"）', async () => {
    const { port } = await open(TOKEN);
    const res = await fetch(`http://127.0.0.1:${port}/__airnight/quit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });

  /*
    ★ 最后一道锁：只认本机。
    本机没有局域网网卡时这条跳过（CI 里常见）——
    但只要有，就必须验一遍：从局域网 IP 进来的请求要被 403。
    这正是"房主的游戏被朋友点掉"那条路。
  */
  const lanAddress = Object.values(networkInterfaces())
    .flatMap((list) => list ?? [])
    .find((info) => info.family === 'IPv4' && !info.internal && !info.address.startsWith('169.254.'))
    ?.address;

  it.skipIf(!lanAddress)('从局域网 IP 进来一律 403（令牌对也不行）', async () => {
    const { port, calls } = await open(TOKEN);
    const res = await post(port, { token: TOKEN }, lanAddress);
    expect(res.status).toBe(403);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(calls(), '非本机的请求绝不能退').toBe(0);
  });
});
