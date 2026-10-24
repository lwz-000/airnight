// @vitest-environment jsdom
/**
 * ============================================================
 *  「退出游戏」—— 浏览器这一半
 * ============================================================
 *
 * 服务端那一半（两道锁）在 `packages/server/test/quit-route.test.ts`；
 * 这里测的是"什么时候才该把这个按钮亮出来"，以及"点下去发了什么"。
 *
 * 【为什么要单独测令牌解析？】
 * 按钮的显示条件就是"地址里有没有合法令牌"这一条。判宽了 ——
 * 局域网里的朋友也会看到一个点了没用的按钮（还会在点击后关掉房主的游戏吗？不会，
 * 服务端拦住了，但体验很糟）；判窄了 —— 房主自己看不到按钮，等于没有退出入口。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { quitTokenFrom, requestQuit } from '../src/quit-game.js';

describe('quitTokenFrom —— 从地址里读退出令牌', () => {
  it('启动器生成的那种 16 位十六进制能读出来', () => {
    expect(quitTokenFrom('?server=localhost:5173&quit=a1b2c3d4e5f60718')).toBe('a1b2c3d4e5f60718');
  });

  it('没有 quit 参数就是空（局域网朋友 / 单独跑 pnpm static）', () => {
    expect(quitTokenFrom('?server=192.168.1.5:5173')).toBe('');
    expect(quitTokenFrom('')).toBe('');
  });

  it('被手改过的不认（太短 / 太长的都不算令牌）', () => {
    expect(quitTokenFrom('?quit=abc')).toBe('');
    expect(quitTokenFrom('?quit=')).toBe('');
    expect(quitTokenFrom(`?quit=${'a'.repeat(65)}`)).toBe('');
  });

  it('不是十六进制的也不认（防止有人在地址里塞奇怪的东西）', () => {
    expect(quitTokenFrom('?quit=hello-world-1234')).toBe('');
    expect(quitTokenFrom('?quit=<script>alert(1)</script>')).toBe('');
  });

  it('大写十六进制照样认（大小写不该影响能不能退出）', () => {
    expect(quitTokenFrom('?quit=A1B2C3D4E5F60718')).toBe('A1B2C3D4E5F60718');
  });
});

describe('requestQuit —— 请后台退出', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function stubFetch(impl: (url: string, init: RequestInit) => Promise<Response>): Array<{ url: string; init: RequestInit }> {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = ((url: string, init: RequestInit) => {
      seen.push({ url, init });
      return impl(url, init);
    }) as unknown as typeof fetch;
    return seen;
  }

  /*
    ★ 为什么自己捏一个"够用的假 Response"，而不是 `new Response(...)`？
      这个测试跑在 jsdom 环境里，jsdom 不带 fetch/Response 那一套；
      模块只用到 `ok` 和 `json()`，捏个对象最稳。
  */
  const jsonRes = (code: number, body: unknown): Promise<Response> =>
    Promise.resolve({
      ok: code >= 200 && code < 300,
      status: code,
      json: async () => body,
    } as unknown as Response);

  it('打的是同源相对路径（端口会顺延，不能写死 localhost:5173）', async () => {
    const seen = stubFetch(() => jsonRes(200, { ok: true }));
    await requestQuit('a1b2c3d4e5f60718');
    expect(seen[0]!.url).toBe('/__airnight/quit');
    expect(seen[0]!.init.method).toBe('POST');
  });

  it('令牌放在 body 里，不是查询串（查询串会被写进日志 / 被 Referer 带出去）', async () => {
    const seen = stubFetch(() => jsonRes(200, { ok: true }));
    await requestQuit('a1b2c3d4e5f60718');
    expect(JSON.parse(String(seen[0]!.init.body))).toEqual({ token: 'a1b2c3d4e5f60718' });
  });

  it('服务器答应才算成功', async () => {
    stubFetch(() => jsonRes(200, { ok: true }));
    expect(await requestQuit('a1b2c3d4e5f60718')).toBe(true);
  });

  it('403（令牌不对 / 不是本机）算失败', async () => {
    stubFetch(() => jsonRes(403, { ok: false, error: 'local only' }));
    expect(await requestQuit('a1b2c3d4e5f60718')).toBe(false);
  });

  it('后台已经先退了（连接被拒）也算失败，但不能抛异常', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(requestQuit('a1b2c3d4e5f60718')).resolves.toBe(false);
  });

  it('没有令牌就一个请求都不发', async () => {
    const seen = stubFetch(() => jsonRes(200, { ok: true }));
    expect(await requestQuit('')).toBe(false);
    expect(seen).toHaveLength(0);
  });
});
