// @vitest-environment jsdom
/**
 * ★ 0.1.2：本机对局会话 —— 客户端那一半。
 *
 * ============================================================
 *  为什么要有它？
 * ============================================================
 * 令牌原来在 `sessionStorage` 里（标签页级）：关掉浏览器就没了，
 * 而"不小心关了浏览器"恰恰是最常见的掉线。
 * 现在改由**本机进程**保管（`/__airnight/session`），并且当"谁在玩"的仲裁者。
 *
 * 进程那一半在 `packages/server/test/combined-server.test.ts`；
 * 这里测**浏览器这一半**：读回令牌、认领占用、心跳被抢、以及
 * "接口够不着时退回 sessionStorage"（走隧道点房主链接的玩法就是这种情况）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetMachineSessionForTest,
  claimMachineSession,
  clearMachineSession,
  getMachineSession,
  initMachineSession,
  machineBusy,
  machineSessionAvailable,
  readMachineToken,
  refreshMachineSession,
  saveMachineSession,
  startOwnershipHeartbeat,
  stopOwnershipHeartbeat,
} from '../src/net/machine-session.js';

/** 假的"本机进程"状态 */
let server: {
  session: { serverUrl: string; token: string; roomCode: string } | null;
  owner: string;
  ownerAlive: boolean;
};
/** 记录客户端发过哪些请求（断言"该发的发了、不该发的没发"） */
let calls: Array<{ method: string; body: Record<string, unknown> | undefined }>;
/** 让下一次请求失败（模拟"页面不是本机进程发的"） */
let unreachable: boolean;
/**
 * ★ 0.1.4：让接下来 N 次请求"没问到"（**不是 404**）——
 * 模拟"刚启动时进程正忙着发素材，探测超时"那种可重试的失败。
 * 它和 `unreachable` 的区别正是这次修复的关键：404 = 接口不存在（别重试），
 * 503/超时 = 这次没问到（该重试）。
 */
let transientFailures: number;

/** 一个够用的假 Response（模块只用到 ok / status / json） */
const reply = (status: number, payload: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => payload,
});

function installFetch(): void {
  calls = [];
  const fake = async (_input: unknown, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    calls.push({ method, body });

    if (unreachable) return reply(404, { error: 'not found' });
    // ★ 0.1.4：可重试的失败（不是 404）—— 启动探测应该再试，而不是直接放弃
    if (transientFailures > 0) {
      transientFailures -= 1;
      return reply(503, { error: 'busy' });
    }

    if (method === 'GET') {
      return reply(200, { session: server.session, owner: server.owner, ownerAlive: server.ownerAlive });
    }
    if (method === 'DELETE') {
      server.session = null;
      server.owner = '';
      server.ownerAlive = false;
      return reply(200, { ok: true });
    }
    if (body?.['clear']) {
      server.session = null;
      server.owner = '';
      server.ownerAlive = false;
      return reply(200, { ok: true });
    }
    if (body?.['session']) server.session = { ...(body['session'] as typeof server.session)! };
    if (typeof body?.['tab'] === 'string') {
      const tab = body['tab'] as string;
      // 与真进程同一套规则：带 session / claim 才算认领，只带 tab 是心跳
      if (body['claim'] === true || body['session']) {
        server.owner = tab;
        server.ownerAlive = true;
      } else if (server.owner === tab) {
        server.ownerAlive = true;
      }
    }
    return reply(200, { ok: true, owner: server.owner, ownerAlive: server.ownerAlive });
  };
  vi.stubGlobal('fetch', fake as unknown as typeof fetch);
}

/** 本标签页的 id（模块自己生成并写进 sessionStorage） */
const myTab = () => sessionStorage.getItem('airnight.tab') ?? '';

beforeEach(() => {
  __resetMachineSessionForTest();
  sessionStorage.clear();
  server = { session: null, owner: '', ownerAlive: false };
  unreachable = false;
  transientFailures = 0;
  installFetch();
});

afterEach(() => {
  stopOwnershipHeartbeat();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('★ 本机对局会话：进程接口可用时', () => {
  it('启动时读回会话，令牌按"服务器地址对得上"才给', async () => {
    server.session = { serverUrl: 'ws://192.168.1.5:8787', token: 'tok-1', roomCode: 'A7K2M9' };
    server.owner = 'another-tab';
    server.ownerAlive = true;

    await initMachineSession();

    expect(machineSessionAvailable()).toBe(true);
    expect(getMachineSession()).toMatchObject({ token: 'tok-1', roomCode: 'A7K2M9' });
    expect(readMachineToken('ws://192.168.1.5:8787'), '地址对得上就该给令牌').toBe('tok-1');
    expect(readMachineToken('ws://别的地方:8787'), '换了服务器旧令牌没有意义').toBe('');
    expect(machineBusy(), '另一个标签页在玩 -> 本机忙').toBe(true);
  });

  it('★ 进房存会话 = 认领占用（之后本机就不算"被别人占着"了）', async () => {
    await initMachineSession();
    expect(machineBusy()).toBe(false);

    saveMachineSession({ serverUrl: 'ws://192.168.1.5:8787', token: 'tok-1', roomCode: 'A7K2M9' });

    expect(server.owner, '存会话要顺手认领占用').toBe(myTab());
    expect(server.session?.token).toBe('tok-1');
    expect(machineBusy(), '占用是我自己，就不算"本机忙"').toBe(false);
  });

  it('★ 接管：占用换成我，会话本身不动', async () => {
    server.session = { serverUrl: 'ws://192.168.1.5:8787', token: 'tok-1', roomCode: 'A7K2M9' };
    server.owner = 'another-tab';
    server.ownerAlive = true;
    await initMachineSession();
    expect(machineBusy()).toBe(true);

    claimMachineSession();
    await refreshMachineSession();

    expect(server.owner).toBe(myTab());
    expect(server.session?.token, '接管不该动会话本身').toBe('tok-1');
    expect(machineBusy()).toBe(false);
  });

  it('★★ 心跳发现占用被换成别人 -> 触发"被接管"回调（界面据此退出对局）', async () => {
    vi.useFakeTimers();
    await initMachineSession();
    saveMachineSession({ serverUrl: 'ws://s:8787', token: 'tok-1', roomCode: 'A7K2M9' });

    let takenOver = 0;
    startOwnershipHeartbeat(() => {
      takenOver += 1;
    });

    // 另一个标签页把占用抢走了
    server.owner = 'another-tab';
    await vi.advanceTimersByTimeAsync(5000);

    expect(takenOver, '心跳应该发现并通知界面').toBe(1);
  });

  it('★★ 被接管之后 clearMachineSession 不能把别人的会话删掉', async () => {
    server.session = { serverUrl: 'ws://s:8787', token: 'tok-1', roomCode: 'A7K2M9' };
    server.owner = 'another-tab';
    server.ownerAlive = true;
    await initMachineSession();

    clearMachineSession();

    const cleared = calls.some((call) => call.body?.['clear'] === true || call.method === 'DELETE');
    expect(cleared, '占用是别人的 -> 一个字节都不许删').toBe(false);
    expect(server.session?.token, '别人的会话要原样留着').toBe('tok-1');
    /*
      ★ 0.1.4：**内存里那份也要留着**。
      以前这里是先 `session = null` 再判断早退，于是"本机另一个标签页在玩"时
      也会把内存会话抹掉 ⇒ `getMachineSession()` 变 null ⇒ 主界面那颗「回到对局」
      和加入房间页的「断线重连恢复」双双失效（明明本机还有一局在跑，却看不到入口）。
    */
    expect(
      getMachineSession(),
      '占用是别人的也不该把内存里那份抹掉 —— 否则界面上的重连入口会凭空消失',
    ).not.toBeNull();
  });

  it('★ 自己还占着的时候 clearMachineSession 才真的清空', async () => {
    await initMachineSession();
    saveMachineSession({ serverUrl: 'ws://s:8787', token: 'tok-1', roomCode: 'A7K2M9' });
    expect(server.owner).toBe(myTab());

    clearMachineSession();

    expect(server.session).toBeNull();
    expect(server.owner).toBe('');
  });
});

describe('★ 本机对局会话：进程接口够不着时（走隧道点房主链接的玩法）', () => {
  it('退回 sessionStorage —— 行为跟 0.1.1 一样，不会把游戏弄坏', async () => {
    unreachable = true;
    await initMachineSession();
    expect(machineSessionAvailable(), '接口 404 就该判定为不可用').toBe(false);

    // 存下来之后能在同一个标签页里读回来（老路径）
    saveMachineSession({ serverUrl: 'ws://s:8787', token: 'tok-legacy', roomCode: 'A7K2M9' });
    expect(readMachineToken('ws://s:8787')).toBe('tok-legacy');
    expect(readMachineToken('ws://别的地方:8787')).toBe('');
    expect(machineBusy(), '没有仲裁能力时不报"本机忙"').toBe(false);

    clearMachineSession();
    expect(readMachineToken('ws://s:8787')).toBe('');
  });
});

/**
 * ============================================================
 *  ★ 0.1.4：启动时那次会话探测不能"一次拿不到就放弃"
 * ============================================================
 *
 * 【它修的 bug】"重开浏览器有时既不弹「接管」提示、也不回座"
 *
 * 启动流程整个挂在这一**次** GET 上：拿不到就 `available = false` + `session = null`
 * ⇒ 主界面既不弹浮层、也不自动回座，而且**一句话都不说**。
 * 而这一次 GET 恰好最容易被自己挤掉：页面刚加载时浏览器会并发去抓
 * `web/` 下几百个素材，同一个进程还要同时伺候它们，1.5 秒的超时经常不够。
 * 于是表现成"有时候能回座、有时候完全没反应"。
 *
 * 这一组钉住三件事：
 *   1. "这次没问到"要**重试**（而不是当场放弃）；
 *   2. 重试都失败时**降级**去读 sessionStorage 那份，而不是什么都不留
 *      （留了它，主界面那颗「回到对局」和「加入房间」里的「断线重连恢复」才有东西可试）；
 *   3. 接口**不存在**（404，走隧道那类玩法）时**不要重试**，别让人白等十几秒。
 */
describe('★ 0.1.4：启动探测的健壮性', () => {
  it('前两次"没问到"会重试，第三次拿到就正常回座', async () => {
    vi.useFakeTimers();
    transientFailures = 2;
    server.session = { serverUrl: 'ws://s:8787', token: 'tok-1', roomCode: 'A7K2M9' };

    const boot = initMachineSession();
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await boot;

    expect(machineSessionAvailable(), '重试之后应该拿到进程的回应').toBe(true);
    expect(getMachineSession(), '会话读回来了').toMatchObject({ token: 'tok-1', roomCode: 'A7K2M9' });
    expect(calls.length, '探测被真的重试了').toBeGreaterThanOrEqual(3);
  });

  it('★★ 三次都没问到 -> 降级读 sessionStorage 那份（而不是什么都不留）', async () => {
    vi.useFakeTimers();
    transientFailures = 99;
    // 同一个浏览器会话里，之前进过房留下的退路
    sessionStorage.setItem('airnight.resume', JSON.stringify({ url: 'ws://s:8787', token: 'tok-legacy' }));

    const boot = initMachineSession();
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await boot;

    expect(machineSessionAvailable(), '进程接口确实没问到').toBe(false);
    expect(
      getMachineSession(),
      '至少要把 sessionStorage 那份当成"本机有一局没打完"，否则界面连入口都不给',
    ).toMatchObject({ serverUrl: 'ws://s:8787', token: 'tok-legacy' });
    expect(readMachineToken('ws://s:8787'), '降级之后令牌仍然取得出来').toBe('tok-legacy');
  });

  it('接口不存在（404，走隧道的玩法）时不重试 —— 别让人白等', async () => {
    vi.useFakeTimers();
    unreachable = true;

    const boot = initMachineSession();
    await vi.advanceTimersByTimeAsync(5000);
    await boot;

    expect(machineSessionAvailable()).toBe(false);
    expect(calls.length, '404 = 接口不存在，重试没有意义').toBe(1);
  });
});
