/**
 * 联机对局在**界面层**的行为测试。
 *
 * ============================================================
 *  为什么需要这个？
 * ============================================================
 * 这一轮你报的 5 个多人 bug 里，有三个是"联机的**接线**错了"，
 * 而不是战斗算错：
 *   · 输赢文案按队伍 0 判断（我在右边就反了）
 *   · 进入下一回合时**从来没做过回合结算**（不发钱、不给经验、商店不刷新）
 *   · 对局结束后客户端把自己当成单机，自己开了一局人机
 * 这些都是"纯逻辑函数是对的，但没人调用 / 调用时用错了参数"，
 * 只有把整个客户端跑起来、真的喂一条联机消息进去才测得到。
 *
 * 【怎么做？】
 * jsdom 里没有真服务器，所以把 `WebSocket` 换成一个**假插座**：
 * 它什么都不连，但允许测试**手动喂消息**给客户端，
 * 就像服务器真的发过来一样。这样整条"服务器消息 -> 界面"的线都能验证。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// 断言"标题栏写出的是哪个干员"时要查名字，所以直接拿数据表（不写死中文字符串）
import { SERVER_VERSION, TRAIT_DEFS, UNIT_DEFS } from '../../../packages/shared/src/index.js';
// ★ 0.0.3 藏品栏的格子数来自这三个常量 —— 不写死 10/5/4，改容量时测试跟着走
import {
  ITEM_A_SLOTS,
  ITEM_B_EQUIP_SLOTS,
  ITEM_B_SLOTS,
} from '../../../packages/shared/src/index.js';

const indexHtml = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');

/**
 * 假 WebSocket。
 *
 * 只需要支持客户端真正用到的那几样：
 *   `new WebSocket(url)` / `addEventListener(type, handler)` / `send` / `close` / `readyState`
 * 另外给测试加了 `open()` 和 `receive()` 用来"假装服务器说话"。
 */
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  /** 所有创建过的连接，测试靠它拿到实例 */
  static instances: FakeWebSocket[] = [];

  url: string;
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  private listeners = new Map<string, Array<(event: unknown) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, handler: (event: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(handler);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, handler: (event: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(type, list.filter((item) => item !== handler));
  }

  send(data: string): void {
    this.sent.push(String(data));
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit('close', {});
  }

  // ---- 下面是给测试用的 ----
  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.emit('open', {});
  }

  /** 假装服务器发来一条消息 */
  receive(message: unknown): void {
    this.emit('message', { data: JSON.stringify(message) });
  }

  /** 客户端发出去的消息（解析成对象，方便断言"发没发某条"） */
  sentText(): Array<Record<string, unknown>> {
    return this.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
  }

  private emit(type: string, event: unknown): void {
    for (const handler of [...(this.listeners.get(type) ?? [])]) handler(event);
  }
}

/**
 * 上一条测试留下的 jsdom。下一次 bootApp 会先把它关掉。
 *
 * 【为什么必须关？】`vi.resetModules()` 只是让**新**的 `import main.js` 拿到一份新模块，
 * 旧模块实例已经注册出去的 `requestAnimationFrame` 循环**照旧在跑**（它永远不会自己停）。
 * 而 main.ts 里的 `document` / `window` 是"读全局"的 —— 夹具下一轮会把全局指到新文档上，
 * 于是旧实例的循环就可能往**新测试的文档**里画东西（真实事故：旧实例 2.5 秒的小战斗打完，
 * 一条 `.result-banner` 落进了下一条测试的 document，让它随机红）。
 * `window.close()` 会停掉那份 jsdom 的定时器与 rAF，循环自然就断了。
 */
let openDom: JSDOM | null = null;

/**
 * 每次测试都重新装一遍环境（和 dom-ui.test.ts 同一套打桩思路）。
 *
 * @param fetchImpl 自定义 `fetch`。
 *   默认是"一被调用就拒绝" —— 绝大多数用例不需要网络。
 *   要测「本机进程里存着一局」（`/__airnight/session`）时传一个假进程进来，
 *   而且必须在 `import('../src/main.js')` **之前**就装好：
 *   main.ts 启动时那一次 `initMachineSession()` 是在 import 期间发出去的。
 */
async function bootApp(
  fetchImpl?: typeof fetch,
): Promise<{ dom: JSDOM; doc: Document; socket: () => FakeWebSocket }> {
  // 先把上一条测试的环境关干净，免得它的 rAF 循环继续往新文档里画
  openDom?.window.close();
  openDom = null;
  FakeWebSocket.instances = [];
  const dom = new JSDOM(indexHtml, { url: 'http://localhost:5173/', pretendToBeVisual: true });
  openDom = dom;
  const { window } = dom;

  const globals: Record<string, unknown> = {
    window,
    document: window.document,
    navigator: window.navigator,
    location: window.location,
    HTMLElement: window.HTMLElement,
    HTMLCanvasElement: window.HTMLCanvasElement,
    HTMLImageElement: window.Image,
    Image: window.Image,
    WebSocket: FakeWebSocket,
    localStorage: window.localStorage,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    fetch: fetchImpl ?? (() => Promise.reject(new Error('测试环境不发网络请求'))),
  };
  for (const [key, value] of Object.entries(globals)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    if (descriptor && !descriptor.writable && !descriptor.set) continue;
    try {
      Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
    } catch {
      // 挂不上就算了
    }
  }

  window.HTMLCanvasElement.prototype.getContext = (() => contextStub) as never;

  vi.doMock('three', async () => {
    const actual = await vi.importActual<typeof import('three')>('three');
    class StubRenderer {
      domElement = window.document.createElement('canvas');
      shadowMap = { enabled: false };
      setPixelRatio(): void {}
      setClearColor(): void {}
      setSize(): void {}
      setViewport(): void {}
      setScissor(): void {}
      setScissorTest(): void {}
      render(): void {}
      dispose(): void {}
    }
    return { ...actual, WebGLRenderer: StubRenderer };
  });

  await import('../src/main.js');

  return {
    dom,
    doc: window.document,
    socket: () => {
      const found = FakeWebSocket.instances[0];
      if (!found) throw new Error('客户端没有创建 WebSocket 连接');
      return found;
    },
  };
}

/** 2D 画布桩：jsdom 没有 canvas 实现，只需要"不报错" */
const contextStub = new Proxy(
  {},
  {
    get: (_target, prop) => {
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
        return () => ({ addColorStop: () => undefined });
      }
      if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray([0, 0, 0, 0]) });
      if (prop === 'measureText') return () => ({ width: 10 });
      return () => undefined;
    },
    set: () => true,
  },
);

/** 等一小会儿，让 requestAnimationFrame / 事件回调跑完 */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));

/** 浮层是不是显示着的（这套界面统一用 .hidden 控制显隐） */
const visible = (element: Element | null): boolean => Boolean(element && !element.classList.contains('hidden'));

/**
 * 装好环境 + 让客户端真的去连一次（连到我们的假插座上）。
 *
 * 【为什么要"点一下创建房间"？】
 * 因为客户端**不会在启动时就连服务器** —— 那样每个随便打开网页的人都会占用一个连接。
 * 它是"你点了联机功能才连"（`ensureConnected()`）。
 * 所以测试也得先点一下，否则 `FakeWebSocket.instances` 是空的，
 * 报错会是"客户端没有创建 WebSocket 连接"，看起来像环境坏了，其实是没触发连接。
 */
async function bootConnected(): Promise<{ doc: Document; ws: FakeWebSocket }> {
  const { doc, socket } = await bootApp();
  doc.querySelector<HTMLButtonElement>('#menu-create-go')!.click();
  const ws = socket();
  // 假装连上了，并给客户端一个玩家 id（后面的队伍归属判断要用）
  ws.open();
  ws.receive({ t: 'welcome', playerId: 'p1', serverVersion: '0.0.1' });
  await settle();
  return { doc, ws };
}

/**
 * 一个合法的阵容（都摆在自己视角的左半边，行号 1..9）。
 *
 * 【行号为什么要写成 1 + index*2】
 * 棋盘高 10 行（0..9），早期版本这里写的是 `2 + index*2 + offset`，
 * index 到 4 时算出来是第 10 行 —— 越界，服务端直接拒收。
 * 现在固定落在 1/3/5/7/9，怎么改都不会出界。
 */
function team(star = 2) {
  const ids = ['op03', 'op09', 'op13', 'op21', 'op27'];
  return ids.map((defId, index) => ({
    defId,
    star,
    cell: { col: 4 - (index % 3), row: 1 + index * 2 },
  }));
}

/** 服务器视角的 TeamSetup（队伍 1 的坐标要镜像到右半边） */
function setup(side: 0 | 1, units: ReturnType<typeof team>) {
  return {
    team: side,
    units:
      side === 0
        ? units
        : units.map((unit) => ({ ...unit, cell: { col: 9 - unit.cell.col, row: unit.cell.row } })),
  };
}

describe('★ 联机对局的界面行为', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('three');
    vi.restoreAllMocks();
  });

  it('★ 联机战斗中隐藏暂停 / 进度条 / 变速（强制所有人同一进度）', async () => {
    const { doc, ws } = await bootConnected();
    ws.receive({ t: 'gameStarted', roomCode: 'AAAAAA', round: 1 });
    await settle();

    // 布阵阶段这三个控件先确认是可见的（不然下面的断言没意义）
    const pause = doc.querySelector<HTMLElement>('#btn-pause')!;
    const seek = doc.querySelector<HTMLElement>('#seek')!;
    const speed = doc.querySelector<HTMLElement>('#speed-group')!;
    expect(pause.classList.contains('hidden'), '布阵阶段不该是隐藏的').toBe(false);

    // 开战 -> 联机里必须全部藏起来
    ws.receive({
      t: 'battleStart',
      battleId: 'B1',
      seed: 12345,
      team0: setup(0, team()),
      team1: setup(1, team()),
      team0PlayerId: 'p2',
      team1PlayerId: 'p1',
      names: {},
      expectedChecksum: 0,
    });
    await settle();

    expect(pause.classList.contains('hidden'), '联机战斗里不该能暂停').toBe(true);
    expect(seek.classList.contains('hidden'), '联机战斗里不该能拖进度条').toBe(true);
    expect(speed.classList.contains('hidden'), '联机战斗里不该能变速').toBe(true);
  });

  it('★ 联机进入下一回合会做回合结算：发钱 + 刷商店（这条原来整块没做）', async () => {
    const { doc, ws } = await bootConnected();

    // 第 1 回合：开局那次 gameStarted，**不该**结算（开局已经有一份初始经济）
    ws.receive({ t: 'gameStarted', roomCode: 'AAAAAA', round: 1 });
    await settle();
    const goldAfterStart = Number(doc.querySelector('#dock-gold')!.textContent);
    const shopAfterStart = shopSignature(doc);

    // 第 2 回合：这次必须发钱 + 刷商店
    ws.receive({ t: 'gameStarted', roomCode: 'AAAAAA', round: 2 });
    await settle();

    const goldAfterRound2 = Number(doc.querySelector('#dock-gold')!.textContent);
    expect(goldAfterRound2, '新回合应该发钱了').toBeGreaterThan(goldAfterStart);
    expect(shopSignature(doc), '新回合应该换一批商店').not.toBe(shopAfterStart);
    // 基础收入 10 + 利息 floor(金币/10)（开局 3 金还不够吃利息）
    expect(doc.querySelector('#dock-gold')!.textContent, '金币具体值也要对（基础 10 + 利息）').toBe(
      String(goldAfterStart + 10 + Math.floor(goldAfterStart / 10)),
    );
  });

  it('★ 联机对局结束后不会自己开一局单机（原来会冒出人机阵容）', async () => {
    const { doc, ws } = await bootConnected();
    ws.receive({ t: 'gameStarted', roomCode: 'AAAAAA', round: 1 });
    await settle();

    const goldBefore = Number(doc.querySelector('#dock-gold')!.textContent);
    const roundBefore = doc.querySelector('#stat-round')!.textContent!;

    // 服务器判定游戏结束
    ws.receive({ t: 'gameOver', winnerId: 'p2', winnerName: '朋友', rounds: 8 });
    await settle();

    /*
      ★ 结算横幅要**当场**看。
      它 2.6 秒后会自己淡出并移除（RESULT_PAUSE_MS），
      等 3 秒再断言就变成"测这横幅会不会永远留着"，永远红不了。
    */
    expect(doc.body.textContent, '应该显示游戏结束').toContain('游戏结束');

    /*
      ★ 这条才是"没有偷偷切回单机"的直接证据。
      "开始战斗"按钮的显示/隐藏是跟着 netplayActive 走的：
        联机 -> 隐藏（布阵 60 秒定时制，不需要手动开战）
        单机 -> 显示「开始战斗（场上 x/y）」
      只要 netplayActive 被错误地关掉，这里立刻会变成"显示 + 单机文案"。
    */
    expect(
      doc.querySelector('#btn-battle')!.classList.contains('hidden'),
      '结束后应该还在联机模式里（按钮该是隐藏的）',
    ).toBe(true);
    // 单机才有的「本波：xxx」提示也不该冒出来
    expect(
      doc.querySelector('#wave-hint')!.classList.contains('hidden'),
      '结束后不该显示单机才有的本波提示',
    ).toBe(true);

    // 等一段比"单机自动进下一回合"（2.6 秒）更长的时间
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // 单机那套会每回合发钱、推进回合号 —— 这里必须**一点都没变**
    expect(Number(doc.querySelector('#dock-gold')!.textContent), '结束后不该偷偷发钱').toBe(goldBefore);
    expect(doc.querySelector('#stat-round')!.textContent!, '结束后不该推进回合号').toBe(roundBefore);
    /*
      ★ 判据从"按钮文案"换成了"按钮是否隐藏"。
      因为布阵改成 60 秒定时制之后，**联机模式下这个按钮整个被藏起来了**
      （见 renderAll 里的说明）—— 它的文案不再是"联机/单机"的判据。
      而"按钮藏没藏"仍然只由 netplayActive 决定，所以还是有效的判据。
    */
    expect(
      doc.querySelector('#btn-battle')!.classList.contains('hidden'),
      '等了 3 秒之后也该还是联机模式（按钮该是隐藏的），说明没偷偷开一局单机',
    ).toBe(true);
    expect(
      doc.querySelector('#wave-hint')!.classList.contains('hidden'),
      '等了 3 秒也不该冒出单机的本波提示',
    ).toBe(true);
  });

  it(
    '★ 打完一局再开新一局时，新一局必须从零开始（不沿用上一局的经济和阵容）',
    async () => {
      const { doc, ws } = await bootConnected();

      // 第一局：记下"开局时"的金币当基准
      ws.receive({ t: 'gameStarted', roomCode: 'AAAAAA', round: 1 });
      await settle();
      const openingGold = Number(doc.querySelector('#dock-gold')!.textContent);

      // 这一局打几回合，攒下一堆钱
      for (const round of [2, 3, 4, 5]) {
        ws.receive({ t: 'gameStarted', roomCode: 'AAAAAA', round });
        await settle();
      }
      const goldAfterRounds = Number(doc.querySelector('#dock-gold')!.textContent);
      expect(goldAfterRounds, '前提：打了几回合之后钱应该变多了，否则这条测试没意义').toBeGreaterThan(
        openingGold,
      );

      // 这一局结束
      ws.receive({ t: 'gameOver', winnerId: 'p2', winnerName: '朋友', rounds: 5 });
      await settle();

      /*
        ★ 再开一局新的。
        服务器本身不支持"再来一局"，但玩家可以留在房间/重新建房 ——
        关键是这时候 `netplayActive` **还是 true**（人还在联机里），
        所以"是不是新的一局"不能只看它。
        原来的代码就是这样漏掉的：新一局沿用了上一局的金币、等级和阵容。
      */
      ws.receive({ t: 'gameStarted', roomCode: 'BBBBBB', round: 1 });
      await settle();

      expect(doc.querySelector('#stat-round')!.textContent, '新一局必须从第 1 回合开始').toBe('1');
      expect(doc.querySelector('#stat-phase')!.textContent, '新一局应该回到布阵').toBe('布阵');
      expect(Number(doc.querySelector('#dock-gold')!.textContent), '新一局的金币必须回到开局值').toBe(
        openingGold,
      );
      // 新一局不该白送一次回合收入（那是"误判成第 N 回合"的典型症状）
      // 判据：联机里"开始战斗"按钮是藏起来的（布阵 60 秒定时制，不需要手动开战）
      expect(
        doc.querySelector('#btn-battle')!.classList.contains('hidden'),
        '新一局应该仍然是联机模式（按钮隐藏）',
      ).toBe(true);
    },
    15000,
  );

  it(
    '★ 4 人以上时绝不能播别人的战斗（原来有一半人会播错）',
    async () => {
      const { doc, ws } = await bootConnected();
      ws.receive({ t: 'gameStarted', roomCode: 'AAAAAA', round: 1 });
      await settle();

      /*
        服务器会把这一回合的**每一场**战斗都广播给所有人（方便旁观）。
        所以 4 个人时每个人都会收到 2 条 battleStart。

        这里刻意复现最危险的那种顺序：**我的先到、别人的后到**。
        旧客户端"收到哪场就播哪场"，后到的会覆盖先到的 ——
        于是最后播的是别人的战斗，myTeam / currentResult / 回执的 battleId 全错。
        （配对 0 的两个人正好是这个顺序，所以是"一半的人播错"。）
      */
      const lopsided = (star: number) => [{ defId: 'op01', star, cell: { col: 4, row: 4 } }];

      // ① 我的战斗（先到）
      ws.receive({
        t: 'battleStart',
        battleId: 'MINE',
        seed: 20240607,
        team0: setup(0, lopsided(3)),
        team1: setup(1, lopsided(1)),
        team0PlayerId: 'p2',
        team1PlayerId: 'p1',
        names: {},
        expectedChecksum: 0,
      });
      await settle();

      // ② 别人的战斗（后到，我不在其中）
      ws.receive({
        t: 'battleStart',
        battleId: 'OTHER',
        seed: 20240607,
        team0: setup(0, lopsided(3)),
        team1: setup(1, lopsided(1)),
        team0PlayerId: 'p3',
        team1PlayerId: 'p4',
        names: {},
        expectedChecksum: 0,
      });
      await settle();

      // 我参战了，就不该被切成"旁观"
      expect(
        doc.querySelector('#stat-phase')!.textContent,
        '我明明在打，却被别人的战斗切成了旁观',
      ).toBe('战斗中');

      // 播完之后回执里的 battleId 就是"我到底播了哪一场"的铁证
      const acked = await waitUntil(() => ws.sentText().some((m) => m.t === 'playbackDone'));
      expect(acked, '战斗应该正常播完并回执').toBe(true);

      const ackIds = ws
        .sentText()
        .filter((m) => m.t === 'playbackDone')
        .map((m) => m.battleId);
      expect(ackIds, '我播完的必须是我自己那一场，不是别人的').toEqual(['MINE']);
    },
    20000,
  );

  it(
    '★ 轮空/被淘汰的人可以旁观别人的战斗，但不会重复换场次',
    async () => {
      const { doc, ws } = await bootConnected();
      ws.receive({ t: 'gameStarted', roomCode: 'AAAAAA', round: 1 });
      await settle();

      const lopsided = (star: number) => [{ defId: 'op01', star, cell: { col: 4, row: 4 } }];

      // 两场都跟我无关（我这回合轮空）
      for (const [id, a, b] of [
        ['G1', 'p2', 'p3'],
        ['G2', 'p4', 'p5'],
      ] as const) {
        ws.receive({
          t: 'battleStart',
          battleId: id,
          seed: 20240607,
          team0: setup(0, lopsided(3)),
          team1: setup(1, lopsided(1)),
          team0PlayerId: a,
          team1PlayerId: b,
          names: {},
          expectedChecksum: 0,
        });
        await settle();
      }

      expect(doc.querySelector('#stat-phase')!.textContent, '轮空的人应该显示"旁观"').toBe('旁观');

      // 旁观也只播第一场，不会跟着后面那场乱跳
      const acked = await waitUntil(() => ws.sentText().some((m) => m.t === 'playbackDone'));
      expect(acked).toBe(true);
      const ackIds = ws
        .sentText()
        .filter((m) => m.t === 'playbackDone')
        .map((m) => m.battleId);
      expect(ackIds, '旁观只认第一场，画面不该乱跳').toEqual(['G1']);
    },
    20000,
  );

  it(
    '★ 战斗时能看到对手的名字（#battle-opponent）',
    async () => {
      const { doc, ws } = await bootConnected();
      // 先让客户端知道房间里有哪些人（名字从 room 广播里查）
      ws.receive({
        t: 'room',
        room: {
          code: 'AAAAAA',
          hostId: 'p1',
          phase: 'prep',
          round: 1,
          prepSecondsLeft: 40,
          players: [
            { id: 'p1', name: '我', ready: true, connected: true, hp: 100, submitted: false, round: 1, wins: 0, losses: 0 },
            { id: 'p2', name: '小红', ready: true, connected: true, hp: 88, submitted: false, round: 1, wins: 0, losses: 0 },
          ],
        },
      });
      ws.receive({ t: 'gameStarted', roomCode: 'AAAAAA', round: 1 });
      await settle();

      // 我是 team1（右边）—— 对手就是 team0 那位
      ws.receive({
        t: 'battleStart',
        battleId: 'B1',
        seed: 20240607,
        team0: setup(0, [{ defId: 'op01', star: 3, cell: { col: 4, row: 4 } }]),
        team1: setup(1, [{ defId: 'op01', star: 1, cell: { col: 4, row: 4 } }]),
        team0PlayerId: 'p2',
        team1PlayerId: 'p1',
        names: {},
        expectedChecksum: 0,
      });
      await settle();

      const badge = doc.querySelector('#battle-opponent')!;
      expect(badge.classList.contains('hidden'), '战斗时对手名字该显示出来').toBe(false);
      expect(badge.textContent, '要显示房间广播里那个玩家的名字').toContain('小红');
    },
    15000,
  );

  it(
    '★ 玩家列表：布阵阶段能看血量，最后 5 秒藏起来',
    async () => {
      const { doc, ws } = await bootConnected();
      const roomWith = (secondsLeft: number) => ({
        t: 'room',
        room: {
          code: 'AAAAAA',
          hostId: 'p1',
          phase: 'prep',
          round: 1,
          prepSecondsLeft: secondsLeft,
          players: [
            { id: 'p1', name: '我', ready: true, connected: true, hp: 100, submitted: false, round: 1, wins: 0, losses: 0, avatarId: 'op01', level: 5, streak: 0 },
            { id: 'p2', name: '小红', ready: true, connected: true, hp: 42, submitted: false, round: 1, wins: 0, losses: 0, avatarId: 'op02', level: 3, streak: -2 },
          ],
        },
      });

      ws.receive({ t: 'gameStarted', roomCode: 'AAAAAA', round: 1 });
      await settle();
      ws.receive(roomWith(30));
      await settle();

      /*
        0.0.2 需求第 11 条：玩家列表从右侧栏顶部搬进了右上角的「玩家」页签。
        所以要先点一下那个切换按钮，玩家列表才会显示出来。
      */
      const playersTab = doc.querySelector<HTMLButtonElement>('.sidebar-tab[data-side-tab="players"]')!;
      expect(playersTab, '右上角要有「玩家」切换按钮').toBeTruthy();
      playersTab.click();
      await settle();

      const pane = doc.querySelector('#side-pane-players')!;
      expect(pane.classList.contains('hidden'), '切到玩家页签后玩家列表要显示').toBe(false);
      const chips = () => [...doc.querySelectorAll('#player-strip-list .player-chip')];
      expect(chips(), '两个玩家应该有两个胶囊').toHaveLength(2);
      expect(pane.textContent, '布阵中途要能看到血量').toContain('42');
      // 需求第 11 条：玩家列表要显示血量、等级、当前连胜连败
      expect(pane.textContent, '要显示等级').toContain('Lv3');
      expect(pane.textContent, '要显示连败场数').toContain('2 连败');
      // 需求第 16 条：多人模式时在玩家列表里显示头像
      expect(
        pane.querySelectorAll('#player-strip-list .player-chip-avatar img').length,
        '每人一个头像',
      ).toBe(2);

      // 进入最后 5 秒 -> 血量藏起来，但列表还在
      ws.receive(roomWith(4));
      await settle();
      expect(chips(), '最后几秒列表不该消失，只是血量藏起来').toHaveLength(2);
      expect(pane.textContent, '最后 5 秒不该再显示别人的血量').not.toContain('42');
      expect(pane.textContent, '要说明为什么看不见血量').toContain('最后');
    },
    15000,
  );

  it(
    '★ 玩家列表：点别人能看他的阵容，而且能回自己的棋盘',
    async () => {
      const { doc, ws } = await bootConnected();
      ws.receive({ t: 'gameStarted', roomCode: 'AAAAAA', round: 1 });
      await settle();
      ws.receive({
        t: 'room',
        room: {
          code: 'AAAAAA',
          hostId: 'p1',
          phase: 'prep',
          round: 1,
          prepSecondsLeft: 30,
          players: [
            { id: 'p1', name: '我', ready: true, connected: true, hp: 100, submitted: false, round: 1, wins: 0, losses: 0 },
            { id: 'p2', name: '小红', ready: true, connected: true, hp: 90, submitted: false, round: 1, wins: 0, losses: 0 },
          ],
        },
      });
      // 服务器广播"小红摆了 3 个"
      ws.receive({
        t: 'prepTeams',
        teams: {
          p1: { units: [], bench: [] },
          p2: {
            units: [
              { defId: 'op01', star: 1, cell: { col: 0, row: 0 } },
              { defId: 'op02', star: 2, cell: { col: 1, row: 1 } },
              { defId: 'op03', star: 3, cell: { col: 2, row: 2 } },
            ],
            // ★ 0.1.1：观战时也要看得到对方备战席
            bench: [
              { defId: 'op04', star: 1, copies: 1 },
              { defId: 'op05', star: 2, copies: 3 },
            ],
          },
        },
      });
      await settle();

      const back = doc.querySelector('#btn-back-my-board') as HTMLButtonElement;
      expect(back.classList.contains('hidden'), '没在看别人时不该出现"回到我的棋盘"').toBe(true);

      // 点"小红"那个胶囊（0.0.2 起玩家列表在 #player-strip-list 里）
      const chip = [...doc.querySelectorAll<HTMLElement>('#player-strip-list .player-chip')].find((c) =>
        c.textContent?.includes('小红'),
      );
      expect(chip, '应该能找到小红的胶囊').toBeDefined();

      // 看别人之前，商店和买经验都是能用的
      expect(doc.querySelector('#shop-slots')!.classList.contains('hidden'), '平时商店该在').toBe(false);
      expect(doc.querySelector('#btn-buy-xp')!.classList.contains('hidden'), '平时买经验该在').toBe(false);

      chip!.click();
      await settle();

      expect(back.classList.contains('hidden'), '看别人阵容时应该出现"回到我的棋盘"').toBe(false);
      expect(
        doc.querySelector('#player-strip-list')!.textContent,
        '正在看谁要有个标记',
      ).toContain('小红');

      /*
        ★ 看别人棋盘时，购买和升级必须藏起来。
        棋盘上画的是他的棋子、而这两个按钮动的是我自己的经济 ——
        同时发生的话玩家会以为"点他的棋子怎么会花我的钱"。
      */
      expect(
        doc.querySelector('#shop-slots')!.classList.contains('hidden'),
        '看别人棋盘时不该还能买棋子',
      ).toBe(true);
      expect(
        doc.querySelector('#btn-buy-xp')!.classList.contains('hidden'),
        '看别人棋盘时不该还能买经验（升级）',
      ).toBe(true);
      expect(
        doc.querySelector('#btn-refresh')!.classList.contains('hidden'),
        '看别人棋盘时刷新商店也该藏起来',
      ).toBe(true);

      /*
        ============================================================
        ★ 0.1.1：观战时还要看得到对方的**羁绊**和**备战席**
        ============================================================
        以前只换棋盘：看着他的棋子、读着我自己的羁绊，等于没看。
      */
      expect(
        doc.querySelector('#trait-list')!.textContent,
        '羁绊栏要说明"这一栏现在是谁的"',
      ).toContain('正在看 小红 的羁绊');
      expect(
        doc.querySelector('#bench-title')!.textContent,
        '备战席标题要换成对方的',
      ).toContain('小红');
      const watchedBench = [
        ...doc.querySelectorAll<HTMLElement>('#bench-slots .bench-slot.watching'),
      ];
      expect(watchedBench.length, '应该画出对方备战席里的棋子').toBeGreaterThan(0);
      expect(
        watchedBench.every((el) => el.dataset.benchIndex === undefined),
        '对方的备战席格子不能带落点下标（否则能把我的棋子丢进去）',
      ).toBe(true);

      // 点回来
      back.click();
      await settle();
      expect(back.classList.contains('hidden'), '回来后按钮该收起来').toBe(true);
      expect(
        doc.querySelector('#shop-slots')!.classList.contains('hidden'),
        '回到自己棋盘后商店要恢复',
      ).toBe(false);
      expect(
        doc.querySelector('#btn-buy-xp')!.classList.contains('hidden'),
        '回到自己棋盘后买经验要恢复',
      ).toBe(false);
      // ★ 0.1.1：羁绊栏和备战席也要跟着"回到自己"
      expect(
        doc.querySelector('#trait-list')!.textContent,
        '回到自己后羁绊栏不该再写别人',
      ).not.toContain('正在看');
      expect(doc.querySelector('#bench-title')!.textContent, '备战席标题要换回自己的').toBe('备战席');
      expect(
        doc.querySelectorAll('#bench-slots .bench-slot.watching').length,
        '回到自己后不该再有"只读"标记',
      ).toBe(0);
    },
    15000,
  );

  /*
    ★★ 0.3.4（用户口径）：观战时「可以看到其他人的藏品栏位」「可以点击他人干员查看面板和藏品，
    但不能动」。这一条守住"换成他的"和"只读"两件事 ——
    少了任何一半，玩家要么看不见、要么看错了自己那一栏还以为是他的。
  */
  it(
    '★★ 0.3.4 观战：藏品栏换成对方的，而且是只读的',
    async () => {
      const { doc, ws } = await bootConnected();
      ws.receive({ t: 'gameStarted', roomCode: 'AAAAAA', round: 1 });
      await settle();
      ws.receive({
        t: 'room',
        room: {
          code: 'AAAAAA',
          hostId: 'p1',
          phase: 'prep',
          round: 1,
          prepSecondsLeft: 30,
          players: [
            { id: 'p1', name: '我', ready: true, connected: true, hp: 100, submitted: false, round: 1, wins: 0, losses: 0 },
            { id: 'p2', name: '小红', ready: true, connected: true, hp: 90, submitted: false, round: 1, wins: 0, losses: 0 },
          ],
        },
      });
      ws.receive({
        t: 'prepTeams',
        teams: {
          p1: { units: [], bench: [] },
          p2: {
            units: [
              // ★ 这枚棋子身上带一件 A 类藏品（协议里本来就有 UnitPlacement.items）
              { defId: 'op01', star: 1, cell: { col: 0, row: 0 }, items: ['itm_morph_relic'] },
            ],
            bench: [],
            // ★ 0.3.4 新增：他的藏品栏（只读快照）
            items: {
              a: ['itm_morph_relic', null, null, null, null, null, null, null, null, null],
              b: [null, null, null, null, null],
              bEquip: [null, null, null, null],
              cert: [null, null, null],
            },
          },
        },
      });
      await settle();

      const chip = [...doc.querySelectorAll<HTMLElement>('#player-strip-list .player-chip')].find((c) =>
        c.textContent?.includes('小红'),
      );
      expect(chip, '应该能找到小红的胶囊').toBeDefined();
      chip!.click();
      await settle();

      const slotsA = [...doc.querySelectorAll<HTMLElement>('#item-slots-a .item-slot')];
      expect(slotsA.length, '穿戴藏品栏要画出来').toBeGreaterThan(0);
      expect(slotsA[0]!.dataset.itemId, '★ 显示的应该是他的藏品').toBe('itm_morph_relic');
      expect(
        slotsA[0]!.dataset.itemZone,
        '★ 只读：格子不能带落点下标（否则能把我的藏品拖过去）',
      ).toBeUndefined();
      expect(slotsA[0]!.classList.contains('readonly'), '要有只读样式（不显示抓取手型）').toBe(true);
      expect(
        doc.querySelector('#item-note')!.textContent,
        '要写明这是谁的藏品，否则玩家会当成自己的',
      ).toContain('小红');

      // 回到自己棋盘：藏品栏要换回自己的（我一件都没有）
      doc.querySelector<HTMLButtonElement>('#btn-back-my-board')!.click();
      await settle();
      const mineAgain = [...doc.querySelectorAll<HTMLElement>('#item-slots-a .item-slot')][0];
      expect(mineAgain?.dataset.itemId, '回到自己后不该还显示他的藏品').toBeUndefined();
      expect(doc.querySelector('#item-note')!.textContent).not.toContain('小红');
    },
    15000,
  );

  it(
    '★ 0.1.1 被淘汰：商店关掉、操作全锁，只剩观战',
    async () => {
      const { doc, ws } = await bootConnected();
      ws.receive({ t: 'gameStarted', roomCode: 'AAAAAA', round: 1 });
      ws.receive({
        t: 'room',
        room: {
          code: 'AAAAAA',
          hostId: 'p1',
          phase: 'prep',
          round: 1,
          prepSecondsLeft: 30,
          players: [
            { id: 'p1', name: '我', ready: true, connected: true, hp: 0, submitted: false, round: 1, wins: 0, losses: 0, level: 1, streak: 0 },
            { id: 'p2', name: '小红', ready: true, connected: true, hp: 60, submitted: false, round: 1, wins: 0, losses: 0, level: 1, streak: 0 },
          ],
        },
      });
      ws.receive({
        t: 'prepTeams',
        teams: {
          p1: { units: [], bench: [] },
          p2: {
            units: [{ defId: 'op01', star: 1, cell: { col: 0, row: 0 } }],
            bench: [{ defId: 'op04', star: 1, copies: 1 }],
          },
        },
      });
      await settle();

      // 淘汰之前商店是开着的 —— 不然下面"关掉了"的断言说明不了任何问题
      expect(
        doc.querySelector('#shop-slots')!.classList.contains('hidden'),
        '淘汰之前商店应该是开着的',
      ).toBe(false);

      ws.receive({ t: 'playerEliminated', playerId: 'p1' });
      await settle();

      /*
        ============================================================
        ★ 淘汰之后：商店系统整个关掉，其它操作也全部锁死
        ============================================================
        服务端那边已经把牌还回共享牌库了，所以这里必须锁 ——
        否则他还能买，牌库的账当场就乱（同一张牌被卖两次 / 买第二次）。
      */
      for (const id of ['#shop-slots', '#btn-refresh', '#btn-lock', '#btn-buy-xp']) {
        expect(
          doc.querySelector(id)!.classList.contains('hidden'),
          `被淘汰后 ${id} 必须关掉`,
        ).toBe(true);
      }
      expect(doc.querySelector('#dock')!.classList.contains('eliminated'), 'dock 要压暗').toBe(true);
      expect(
        doc.querySelector('.shop-title')!.textContent,
        '商店那一栏要写清"只能观战"',
      ).toContain('淘汰');
      expect(doc.querySelector('#stat-pop')!.textContent, '场上的棋子要清空（牌已回库）').toContain('0 /');

      // ---- 但观战必须照常能用 ----
      const chip = [...doc.querySelectorAll<HTMLElement>('#player-strip-list .player-chip')].find((c) =>
        c.textContent?.includes('小红'),
      );
      expect(chip, '玩家列表里还应该看得到小红').toBeDefined();
      chip!.click();
      await settle();
      expect(
        doc.querySelector('#bench-title')!.textContent,
        '被淘汰的人仍然可以切去看别人的备战席',
      ).toContain('小红');
      expect(doc.querySelector('#trait-list')!.textContent).toContain('正在看 小红 的羁绊');
    },
    15000,
  );

  it(
    '★★ 0.2.1 被淘汰：0.2 新加的「商店回合」也必须对他关闭',
    async () => {
      /*
        ============================================================
        ★ 用户报的严重 bug（2026-10-17）
        ============================================================
        「淘汰后的人也能使用商店，修改为淘汰的人不能使用商店。」

        【漏在哪】
        上面那条 0.1.1 的测试只覆盖了**常规商店**（`#shop-slots` 那 5 格）。
        0.2 新增的商店回合是**另一套界面**（金币上方的开关按钮 `#btn-shop-round`
        + 全屏弹窗 `#shop-round-overlay`），它原来只判 `shopRoundActive`
        （"这一回合的商店开着没有"），完全不知道我已经被淘汰了 ——
        于是出局的人照样能开弹窗买 2 星干员，而他的牌早就还回共享牌库了。

        【这条测试要证明两件事】
          ① 活着的时候商店回合**确实会显示**（否则"关掉了"这个断言毫无意义）；
          ② 淘汰之后同一个阶段消息进来，按钮和弹窗都必须保持隐藏。
      */
      const { doc, ws } = await bootConnected();

      // ① 对照：活着 + 服务器说这一回合开商店 -> 按钮和弹窗都该出现
      ws.receive({ t: 'gameStarted', roomCode: 'AAAAAA', round: 9, phase: 'shop', shopSecondsLeft: 90 });
      await settle();
      expect(
        visible(doc.querySelector('#btn-shop-round')),
        '对照：没被淘汰时，商店回合的开关按钮应该出现',
      ).toBe(true);
      expect(visible(doc.querySelector('#shop-round-overlay')), '对照：弹窗默认开着').toBe(true);
      expect(doc.querySelectorAll('#shop-round-slots .shop-round-slot').length, '有货架').toBeGreaterThan(0);

      // ② 被淘汰：牌已经回库，商店整块关闭
      ws.receive({ t: 'playerEliminated', playerId: 'p1' });
      await settle();
      expect(
        visible(doc.querySelector('#btn-shop-round')),
        '★★ 淘汰之后金币上方那个商店按钮必须消失',
      ).toBe(false);
      expect(
        visible(doc.querySelector('#shop-round-overlay')),
        '★★ 淘汰之后商店弹窗必须关掉',
      ).toBe(false);

      // ③ 就算再收到一条"这一回合是商店回合"，也不能被重新打开
      ws.receive({ t: 'gameStarted', roomCode: 'AAAAAA', round: 16, phase: 'shop', shopSecondsLeft: 90 });
      await settle();
      expect(visible(doc.querySelector('#btn-shop-round')), '下一轮商店回合同样不给他开').toBe(false);
      expect(visible(doc.querySelector('#shop-round-overlay'))).toBe(false);

      // ④ 强行点那个（藏起来的）按钮也打不开 —— 隐藏 ≠ 不能触发
      doc.querySelector<HTMLButtonElement>('#btn-shop-round')!.click();
      await settle();
      expect(visible(doc.querySelector('#shop-round-overlay')), '点了也不开').toBe(false);
    },
    20000,
  );

  it(
    '★ 0.1.1 联机结算页：排名 / 死亡阵容 / 羁绊 / 最高伤害 四个模块都渲染出来',
    async () => {
      const { doc, ws } = await bootConnected();
      const traitId = Object.keys(TRAIT_DEFS)[0]!;
      ws.receive({ t: 'gameStarted', roomCode: 'AAAAAA', round: 1 });
      await settle();

      /*
        ★ 数据是**服务器算好下发的**（gameOver.standings）——
        客户端只负责画。所以这里直接喂一份假数据，验"四个模块都接上了"。
      */
      ws.receive({
        t: 'gameOver',
        winnerId: 'p2',
        winnerName: '小红',
        rounds: 7,
        standings: [
          {
            playerId: 'p2',
            name: '小红',
            avatarId: '',
            rank: 1,
            eliminatedRound: null,
            hp: 42,
            wins: 5,
            losses: 1,
            level: 9,
            lineup: [
              { defId: 'op01', star: 2, cell: { col: 0, row: 0 } },
              { defId: 'op27', star: 3, cell: { col: 1, row: 1 } },
            ],
            traits: [{ traitId, count: 4, activeAt: 4 }],
            topUnit: { defId: 'op27', star: 3, dealt: 32000 },
            totalDamage: 45000,
          },
          {
            playerId: 'p1',
            name: '我',
            avatarId: '',
            rank: 2,
            eliminatedRound: 6,
            hp: 0,
            wins: 3,
            losses: 4,
            level: 7,
            lineup: [{ defId: 'op09', star: 1, cell: { col: 0, row: 0 } }],
            traits: [],
            topUnit: null,
            totalDamage: 0,
          },
        ],
      });
      await settle();

      const page = doc.querySelector<HTMLElement>('#result-page')!;
      expect(visible(page), '对局结束要弹出结算页').toBe(true);
      expect(doc.querySelector('#result-title')!.textContent, '我没赢 -> 游戏结束').toBe('游戏结束');
      expect(doc.querySelector('#result-sub')!.textContent, '副标题要有回合数和冠军').toContain('小红');

      // 模块一：排名列表（按名次，冠军带 champion 样式）
      const cards = [...doc.querySelectorAll<HTMLElement>('#result-list .result-card')];
      expect(cards, '两位玩家两张卡').toHaveLength(2);
      expect(cards[0]!.classList.contains('champion'), '第 1 名要有冠军样式').toBe(true);
      expect(cards[0]!.querySelector('.result-rank')!.textContent).toBe('1');
      expect(cards[1]!.querySelector('.result-rank')!.textContent).toBe('2');
      // "对应信息"：等级 / 血量 / 胜负 / 淘汰回合
      const firstMeta = cards[0]!.querySelector('.result-meta')!.textContent ?? '';
      expect(firstMeta).toContain('Lv9');
      expect(firstMeta).toContain('5 胜 1 负');
      expect(firstMeta).toContain('存活到最后');
      expect(
        cards[1]!.querySelector('.result-meta')!.textContent,
        '被淘汰的人要写出回合数',
      ).toContain('第 6 回合被淘汰');
      expect(cards[1]!.querySelector('.result-mine'), '自己那张卡要有标记').not.toBeNull();

      // 模块二：死亡时的阵容（每一张都写出名字 + 费用 + 星级，顺序照服务器给的）
      const units = [...cards[0]!.querySelectorAll('.result-unit')];
      expect(units, '阵容要按服务器给的顺序逐张画出来').toHaveLength(2);
      expect(units[0]!.textContent).toContain(UNIT_DEFS.op01!.name);
      expect(units[1]!.textContent).toContain(UNIT_DEFS.op27!.name);
      expect(units[1]!.querySelector('.result-unit-star')!.textContent).toContain('★');

      // 模块三：激活的羁绊
      const traits = [...cards[0]!.querySelectorAll('.result-trait')];
      expect(traits, '激活的羁绊要画出来').toHaveLength(1);
      expect(traits[0]!.textContent).toContain(TRAIT_DEFS[traitId]!.name);
      expect(traits[0]!.textContent).toContain('4 档');
      expect(
        cards[1]!.querySelector('.result-traits')!.textContent,
        '没有羁绊要给一句说明，别留空白',
      ).toContain('没有激活的羁绊');

      // 模块四：最高伤害（玩家卡里一份 + 顶部全局一份）
      expect(cards[0]!.textContent, '该玩家打得最多的干员').toContain(UNIT_DEFS.op27!.name);
      expect(cards[0]!.textContent, '伤害量（32000 定点数 -> 显示 32）').toContain('32');
      expect(
        cards[1]!.textContent,
        '一点伤害都没有要如实写出来',
      ).toContain('没有造成伤害');
      const mvp = doc.querySelector('#result-mvp')!.textContent ?? '';
      expect(mvp, '顶部是全局最高').toContain('小红');
      expect(mvp).toContain(UNIT_DEFS.op27!.name);

      // 收起按钮真的能关（关了还能继续看棋盘）
      doc.querySelector<HTMLButtonElement>('#result-close')!.click();
      expect(visible(page), '点收起应该关掉结算页').toBe(false);
    },
    15000,
  );

  it(
    '★ 0.1.1 布阵倒计时：只有一处写入（不闪），最后 10 秒变红',
    async () => {
      const { doc, ws } = await bootConnected();
      ws.receive({ t: 'gameStarted', roomCode: 'AAAAAA', round: 1 });
      await settle();

      const phase = doc.querySelector<HTMLElement>('#stat-phase')!;
      ws.receive({ t: 'prepTick', secondsLeft: 60 });
      await settle();
      expect(phase.textContent).toBe('布阵 60s');
      expect(phase.classList.contains('urgent'), '还剩 60 秒不该是红的').toBe(false);

      /*
        ★ 闪烁的根因：这一行原来**有两个写入点**（renderAll 写「布阵」、
        onPrepTick 写「布阵 60s」），格式还不一样。
        联机里 renderAll 会被各种广播触发（别人进出 / 改阵容 / 买卖），
        每触发一次倒计时就被改回没有秒数的版本，下一秒又变回来 —— 看起来就是"闪"。
        这里用一条 room 广播（真实世界最常见的触发源）把那次重画引出来。
      */
      ws.receive({
        t: 'room',
        room: {
          code: 'AAAAAA',
          hostId: 'p1',
          phase: 'prep',
          round: 1,
          prepSecondsLeft: 60,
          players: [
            { id: 'p1', name: '我', ready: true, connected: true, hp: 100, submitted: false, round: 1, wins: 0, losses: 0, level: 1, streak: 0 },
            { id: 'p2', name: '小红', ready: true, connected: true, hp: 100, submitted: false, round: 1, wins: 0, losses: 0, level: 1, streak: 0 },
          ],
        },
      });
      await settle();
      expect(phase.textContent, '整块重画之后倒计时必须原样留着（不能再被改回「布阵」）').toBe('布阵 60s');

      // 最后 10 秒 -> 红色警示
      ws.receive({ t: 'prepTick', secondsLeft: 10 });
      await settle();
      expect(phase.textContent).toBe('布阵 10s');
      expect(phase.classList.contains('urgent'), '剩 10 秒要变红').toBe(true);

      ws.receive({ t: 'prepTick', secondsLeft: 11 });
      await settle();
      expect(phase.classList.contains('urgent'), '回到 11 秒就取消红色').toBe(false);
    },
    15000,
  );

  it(
    '★ 0.1.1 战斗中能切去观战别人的对局，进度和别人对齐（不是从头播）',
    async () => {
      const { doc, ws } = await bootConnected();
      ws.receive({ t: 'gameStarted', roomCode: 'AAAAAA', round: 1 });
      ws.receive({
        t: 'room',
        room: {
          code: 'AAAAAA',
          hostId: 'p1',
          phase: 'battle',
          round: 1,
          prepSecondsLeft: 0,
          players: ['p1', 'p2', 'p3', 'p4'].map((id, i) => ({
            id,
            name: ['我', '小红', '阿强', '路人'][i]!,
            ready: true,
            connected: true,
            hp: 100,
            submitted: true,
            round: 1,
            wins: 0,
            losses: 0,
            level: 1,
            streak: 0,
          })),
        },
      });
      await settle();

      // 4 个人 = 2 场：我在 B1，B2 是另外两个人的
      const mkBattle = (battleId: string, seed: number, a: string, b: string) => ({
        t: 'battleStart',
        battleId,
        seed,
        team0: setup(0, team()),
        team1: setup(1, team()),
        team0PlayerId: a,
        team1PlayerId: b,
        names: {},
        expectedChecksum: 0,
      });
      ws.receive(mkBattle('B1', 111, 'p1', 'p2'));
      ws.receive(mkBattle('B2', 222, 'p3', 'p4'));
      await settle();

      const chips = [...doc.querySelectorAll<HTMLElement>('#spectate-bar .spectate-chip')];
      expect(chips, '两场战斗就该有两个可切换的 chip').toHaveLength(2);
      expect(chips[0]!.classList.contains('active'), '默认看的是我自己那一场').toBe(true);
      expect(chips[0]!.textContent, '自己那场要标出来').toContain('我的战斗');
      expect(chips[1]!.textContent).toContain('阿强');
      expect(doc.querySelector('#battle-opponent')!.textContent, '自己那场写 VS 对手').toContain('VS');

      /*
        ★ 让它先"真实过去"一会儿，再切过去 —— 这样才能验出
        "进度是按墙钟对齐的"（不是从第 0 秒重播）。
      */
      await new Promise((r) => setTimeout(r, 500));
      chips[1]!.click();
      await settle();

      expect(doc.querySelector('#battle-opponent')!.textContent, '看别人那场要写"旁观"').toContain('旁观');
      expect(
        doc.querySelector('#spectate-bar .spectate-chip.active')!.textContent,
        '高亮的应该换成刚点的那一场',
      ).toContain('阿强');
      const seconds = Number((doc.querySelector('#battle-time')!.textContent ?? '').replace('s', ''));
      expect(seconds, '观战进度要和那一场对齐，而不是从 0 重播').toBeGreaterThan(0.1);

      // 切回自己那场：接着上次看的地方，不倒带
      chips[0]!.click();
      await settle();
      expect(doc.querySelector('#battle-opponent')!.textContent).toContain('VS');
      expect(doc.querySelector('#spectate-bar .spectate-chip.active')!.textContent).toContain('我的战斗');
    },
    15000,
  );

  it(
    '★ 0.1.2 旁观的那一场先播完：不许拿别人的战果收我的尾，而是切回自己那场',
    async () => {
      const { doc, ws } = await bootConnected();
      ws.receive({ t: 'gameStarted', roomCode: 'AAAAAA', round: 1 });
      ws.receive({
        t: 'room',
        room: {
          code: 'AAAAAA',
          hostId: 'p1',
          phase: 'battle',
          round: 1,
          prepSecondsLeft: 0,
          players: ['p1', 'p2', 'p3', 'p4'].map((id, i) => ({
            id,
            name: ['我', '小红', '阿强', '路人'][i]!,
            ready: true,
            connected: true,
            hp: 100,
            submitted: true,
            round: 1,
            wins: 0,
            losses: 0,
            level: 1,
            streak: 0,
          })),
        },
      });
      await settle();

      const mkBattle = (
        battleId: string,
        seed: number,
        a: string,
        b: string,
        units0: ReturnType<typeof team> = team(),
        units1: ReturnType<typeof team> = team(),
      ) => ({
        t: 'battleStart',
        battleId,
        seed,
        team0: setup(0, units0),
        team1: setup(1, units1),
        team0PlayerId: a,
        team1PlayerId: b,
        names: {},
        expectedChecksum: 0,
      });

      // 我那一场：正常阵容（会打挺久）
      ws.receive(mkBattle('B1', 111, 'p1', 'p2'));
      // 别人那一场：双方空阵容 —— 回放在一帧之内就播完，用来模拟"别人先打完"
      ws.receive(mkBattle('B2', 222, 'p3', 'p4', [], []));
      await settle();

      // 切去旁观 B2
      const chips = [...doc.querySelectorAll<HTMLElement>('#spectate-bar .spectate-chip')];
      expect(chips).toHaveLength(2);
      chips[1]!.click();
      await settle();

      /*
        等那一瞬就结束的回放跑完（再留一点渲染帧）。
        ★ 修好之后应该发生的事：自动切回我自己的那一场继续看；
        ★ 修好之前会发生的事：finishBattle() 拿 B2（空阵容、平局）给我收尾 ——
          弹出"平局"结算横幅、VS 标题被藏掉、还提前替我举了 playbackDone。
      */
      await new Promise((r) => setTimeout(r, 500));
      await settle();

      expect(doc.querySelector('.result-banner'), '不能拿别人的战果弹结算横幅').toBeNull();
      expect(doc.querySelector('#battle-opponent')!.classList.contains('hidden'), 'VS 标题不该被收掉').toBe(false);
      expect(doc.querySelector('#battle-opponent')!.textContent, '该自动切回自己那一场').toContain('VS');
      expect(doc.querySelector('#spectate-bar .spectate-chip.active')!.textContent).toContain('我的战斗');
    },
    15000,
  );

  it(
    '★ 0.1.2 自己先打完（result）：在等别人看完的这段时间里照样能观战',
    async () => {
      const { doc, ws } = await bootConnected();
      ws.receive({ t: 'gameStarted', roomCode: 'AAAAAA', round: 1 });
      ws.receive({
        t: 'room',
        room: {
          code: 'AAAAAA',
          hostId: 'p1',
          phase: 'battle',
          round: 1,
          prepSecondsLeft: 0,
          players: ['p1', 'p2', 'p3', 'p4'].map((id, i) => ({
            id,
            name: ['我', '小红', '阿强', '路人'][i]!,
            ready: true,
            connected: true,
            hp: 100,
            submitted: true,
            round: 1,
            wins: 0,
            losses: 0,
            level: 1,
            streak: 0,
          })),
        },
      });
      await settle();

      const mkBattle = (battleId: string, seed: number, a: string, b: string, mine: boolean) => ({
        t: 'battleStart',
        battleId,
        seed,
        // 我那场用空阵容（一帧就打完 => 马上进 result 等待期）；别人的正常打
        team0: mine ? setup(0, []) : setup(0, team()),
        team1: mine ? setup(1, []) : setup(1, team()),
        team0PlayerId: a,
        team1PlayerId: b,
        names: {},
        expectedChecksum: 0,
      });
      ws.receive(mkBattle('B1', 111, 'p1', 'p2', true));
      ws.receive(mkBattle('B2', 222, 'p3', 'p4', false));
      await settle();

      // 我那场瞬间播完 -> 进 result（等待别人）。观战条必须还在
      await new Promise((r) => setTimeout(r, 400));
      await settle();
      const chips = [...doc.querySelectorAll<HTMLElement>('#spectate-bar .spectate-chip')];
      expect(chips.length, '自己打完了也要能继续看别人打').toBeGreaterThanOrEqual(2);

      // 点别人的那一场：要能切过去（旁观），而不是被"只能在 battle 阶段观战"挡掉
      const other = chips.find((chip) => chip.textContent?.includes('阿强'));
      expect(other, '别人的那场要出现在观战条里').toBeTruthy();
      other!.click();
      await settle();
      expect(doc.querySelector('#battle-opponent')!.textContent, '要切得过去').toContain('旁观');
    },
    15000,
  );

  it(
    '★ 0.1.1 大厅：房主能看到「改名 / 踢出」（排在准备状态前面），普通玩家看不到',
    async () => {
      const { doc, ws } = await bootConnected();
      const lobbyRoom = (hostId: string) => ({
        t: 'room',
        room: {
          code: 'AAAAAA',
          hostId,
          phase: 'lobby',
          round: 0,
          prepSecondsLeft: 0,
          players: [
            { id: 'p1', name: '我', ready: true, connected: true, hp: 100, submitted: false, round: 0, wins: 0, losses: 0, level: 1, streak: 0 },
            { id: 'p2', name: '小红', ready: false, connected: true, hp: 100, submitted: false, round: 0, wins: 0, losses: 0, level: 1, streak: 0 },
          ],
        },
      });

      // ---- 我是房主 ----
      ws.receive(lobbyRoom('p1'));
      await settle();
      let rows = [...doc.querySelectorAll<HTMLElement>('#lobby-players .net-player')];
      expect(rows).toHaveLength(2);
      expect(rows[0]!.querySelector('[data-action="rename"]'), '房主自己那一行不该有按钮').toBeNull();
      expect(rows[0]!.querySelector('[data-action="kick"]')).toBeNull();

      const rowHtml = rows[1]!.innerHTML;
      const renameAt = rowHtml.indexOf('改名');
      const kickAt = rowHtml.indexOf('踢出');
      const readyAt = rowHtml.indexOf('等待中');
      expect(renameAt, '要有改名按钮').toBeGreaterThanOrEqual(0);
      expect(kickAt, '要有踢出按钮').toBeGreaterThanOrEqual(0);
      expect(renameAt, '改名要排在踢出前面').toBeLessThan(kickAt);
      expect(kickAt, '踢出要排在准备状态前面').toBeLessThan(readyAt);

      // 点「改名」-> 弹窗 -> 填名字 -> 确定 -> 发消息
      rows[1]!.querySelector<HTMLButtonElement>('[data-action="rename"]')!.click();
      await settle();
      const overlay = doc.querySelector<HTMLElement>('#rename-overlay')!;
      expect(visible(overlay), '改名弹窗要打开').toBe(true);
      expect(doc.querySelector('#rename-whose')!.textContent).toContain('小红');
      doc.querySelector<HTMLInputElement>('#rename-input')!.value = '新名字';
      doc.querySelector<HTMLButtonElement>('#rename-ok')!.click();
      await settle();
      expect(visible(overlay), '提交之后要关掉').toBe(false);
      const renameSent = ws.sentText().filter((m) => m.t === 'renamePlayer');
      expect(renameSent).toHaveLength(1);
      expect(renameSent[0]).toMatchObject({ playerId: 'p2', name: '新名字' });

      // 空名字不发（本地先挡一道）
      rows = [...doc.querySelectorAll<HTMLElement>('#lobby-players .net-player')];
      rows[1]!.querySelector<HTMLButtonElement>('[data-action="rename"]')!.click();
      await settle();
      doc.querySelector<HTMLInputElement>('#rename-input')!.value = '   ';
      doc.querySelector<HTMLButtonElement>('#rename-ok')!.click();
      await settle();
      expect(visible(overlay), '名字为空时弹窗不关，给玩家改').toBe(true);
      expect(ws.sentText().filter((m) => m.t === 'renamePlayer'), '空名字不该发出去').toHaveLength(1);
      doc.querySelector<HTMLButtonElement>('#rename-cancel')!.click();
      await settle();

      // 点「踢出」-> 0.1.3 起是**专用弹窗**（房主可以附一句话）-> 确定发消息
      rows[1]!.querySelector<HTMLButtonElement>('[data-action="kick"]')!.click();
      await settle();
      expect(visible(doc.querySelector('#kick-overlay')), '踢人要走专用弹窗（不再用通用二次确认）').toBe(true);
      doc.querySelector<HTMLInputElement>('#kick-input')!.value = '位置满了，抱歉';
      doc.querySelector<HTMLButtonElement>('#kick-ok')!.click();
      await settle();
      const kickMessages = ws.sentText().filter((m) => m.t === 'kickPlayer');
      expect(kickMessages).toHaveLength(1);
      expect(kickMessages[0]!.message, '房主写的留言要跟着发出去').toBe('位置满了，抱歉');

      // ---- 我不是房主 -> 一个按钮都不该有 ----
      ws.receive(lobbyRoom('p2'));
      await settle();
      expect(doc.querySelectorAll('#lobby-players [data-action="rename"]'), '普通玩家看不到改名').toHaveLength(0);
      expect(doc.querySelectorAll('#lobby-players [data-action="kick"]'), '普通玩家看不到踢人').toHaveLength(0);
    },
    15000,
  );

  it(
    '★ 0.1.1 被房主踢出：客户端收到 kicked 会退出房间回主界面',
    async () => {
      const { doc, ws } = await bootConnected();
      ws.receive({ t: 'kicked', reason: '房主把你移出了房间' });
      await settle();

      expect(
        ws.sentText().some((m) => m.t === 'leaveRoom'),
        '收到 kicked 要真的退房（不能只是弹个提示、人还挂在房间里）',
      ).toBe(true);
    },
    15000,
  );

  it(
    '★ 0.1.3 被房主踢出：房主留的话会**显示在浮层里**（不再只是一条转瞬即逝的 toast）',
    async () => {
      const { doc, ws } = await bootConnected();
      ws.receive({ t: 'kicked', reason: '位置满了，下次再一起玩' });
      await settle();

      const overlay = doc.querySelector('#kicked-overlay')!;
      expect(visible(overlay), '被踢要弹浮层').toBe(true);
      expect(overlay.querySelector('#kicked-message')!.textContent, '留言要原样显示给本人').toBe(
        '位置满了，下次再一起玩',
      );

      doc.querySelector<HTMLButtonElement>('#kicked-ok')!.click();
      await settle();
      expect(visible(overlay), '点「知道了」浮层收起').toBe(false);
    },
    15000,
  );

  it(
    '★ 联机里战败的一方也能正常进下一回合（"输了就卡住"那条）',
    async () => {
      const { doc, ws } = await bootConnected();
      ws.receive({ t: 'gameStarted', roomCode: 'AAAAAA', round: 1 });
      await settle();
      const goldBefore = Number(doc.querySelector('#dock-gold')!.textContent);
      const shopBefore = shopSignature(doc);

      /*
        摆一场几秒钟就能打完的仗。
        两边是**同一个干员、只差星级**，所以胜负完全由星级决定，
        不依赖任何具体数值 —— 以后调平衡也调不坏这条测试。
        我在 team1（服务器视角的右半边），对面 3 星、我 1 星，所以输的是我。
      */
      ws.receive({
        t: 'battleStart',
        battleId: 'B1',
        seed: 20240607,
        team0: setup(0, [{ defId: 'op01', star: 3, cell: { col: 4, row: 4 } }]),
        team1: setup(1, [{ defId: 'op01', star: 1, cell: { col: 4, row: 4 } }]),
        team0PlayerId: 'p2',
        team1PlayerId: 'p1',
        names: {},
        expectedChecksum: 0,
      });
      await settle();

      /*
        ★ 回执必须在**战斗真正播完**之后才发，不能提前。
        提前发等于"骗服务器我看完了"，慢的机器照样会被掐掉。
      */
      expect(
        ws.sentText().filter((m) => m.t === 'playbackDone').length,
        '战斗还没播完就发了"我看完了" —— 那这一条回执就没有任何意义',
      ).toBe(0);

      /*
        战斗回放要花真实时间，所以等到阶段真的变成「结算」。
        ★ 联机时这里写的是「等其他人看完战斗…」——
        因为下一回合要等**所有人**把战斗看完（服务器收齐回执才推进），
        先把话说清楚，不然先看完的人会以为卡住了 ——
        这正是"双端不同步"最容易被误报成 bug 的地方。
      */
      const reachedResult = await waitUntil(() => {
        const text = doc.querySelector('#stat-phase')!.textContent ?? '';
        return text.includes('结算') || text.includes('等其他人看完');
      });
      expect(reachedResult, '输了也应该正常播完、进入结算').toBe(true);
      expect(
        doc.querySelector('#stat-phase')!.textContent,
        '联机结算时要告诉玩家"在等别人看完"，不然看起来像卡住',
      ).toContain('等其他人看完');

      /*
        ★ 客户端真的发了"我看完了"这条回执。
        不发的话服务器只能傻等到兜底超时 —— 每回合白等十几秒，
        表现就是"打完了半天不进下一回合"。
      */
      const doneMessages = ws.sentText().filter((m) => m.t === 'playbackDone');
      expect(doneMessages.length, '播完战斗后必须告诉服务器"我看完了"').toBeGreaterThan(0);
      expect(
        doneMessages[0]!.battleId,
        '回执必须带上这一场的 battleId（服务器靠它判断举的是哪一场的手）',
      ).toBe('B1');

      // 输了之后**不能自己开下一回合**，得等服务器
      // （联机里"开始战斗"按钮是藏起来的，所以判据是"藏没藏"而不是文案）
      expect(
        doc.querySelector('#btn-battle')!.classList.contains('hidden'),
        '输了也要等服务器，不能自己往下走（按钮该是隐藏的）',
      ).toBe(true);

      // 服务器发来下一回合 —— 这里就是原来会卡住的地方
      ws.receive({ t: 'gameStarted', roomCode: 'AAAAAA', round: 2 });
      await settle();

      expect(doc.querySelector('#stat-phase')!.textContent, '战败方也该回到布阵阶段').toBe('布阵');
      expect(doc.querySelector('#stat-round')!.textContent, '回合号应该前进').toBe('2');
      expect(Number(doc.querySelector('#dock-gold')!.textContent), '战败方也该拿到回合收入').toBeGreaterThan(
        goldBefore,
      );
      expect(shopSignature(doc), '战败方也该刷新商店').not.toBe(shopBefore);
    },
    20000,
  );

  /**
   * ★ 0.1.2 断线重连（界面层）—— 第 1 条：座位还在，就**原地等**。
   *
   * 【这条测试钉的是什么？】
   * 断线时最容易犯的错是"顺手把人踢回主界面 + 把对局状态清掉"。
   * 那个实现看起来"很干净"，实际有两个致命后果：
   *   · 清掉 `netplayActive` ⇒ 客户端以为自己是单机，自己推进回合、自己刷商店；
   *   · `resetBoardAndPlayback()` ⇒ 重连回来后棋盘一片空白，像重开了一局。
   * 所以这条测试同时断言：浮层出现 ✅ / 没回主界面 ✅ / 阶段还是布阵 ✅。
   *
   * 【为什么还要断言"发的是 resume 不是 joinRoom"？】
   * 这是整件事最容易写错的一步：重连时重发 joinRoom 等于"新人进房"——
   * 服务端会先把你自己踢一遍、对局中直接拒绝、就算进了也是 hp100 的白板。
   */
  it(
    '★ 0.1.2 断线：座位还在就原地等重连（不踢回主界面），连上后浮层收起',
    async () => {
      const { doc, ws } = await bootConnected();
      // 服务器发令牌 = "你的座位我替你留着"
      ws.receive({ t: 'welcome', playerId: 'p1', serverVersion: '0.1.2', resumeToken: 'tok-1' });
      ws.receive({ t: 'gameStarted', roomCode: 'AAAAAA', round: 1 });
      await settle();

      // ---- 断线 ----
      ws.close();
      await settle();

      expect(visible(doc.querySelector('#resync-overlay')), '断线要明确告诉玩家"正在重连"').toBe(true);
      expect(visible(doc.querySelector('#main-menu')), '⚠️ 断线绝不能把人踢回主界面').toBe(false);
      expect(
        doc.querySelector('#stat-phase')!.textContent,
        '断线时本地对局状态必须留着（清了就变成"重开一局"）',
      ).toBe('布阵');

      // ---- 自动重连（退避 1 秒后）----
      const reconnected = await waitUntil(() => FakeWebSocket.instances.length > 1);
      expect(reconnected, '断线后应该自动重连').toBe(true);
      const ws2 = FakeWebSocket.instances[1]!;
      ws2.open();
      await settle();

      const resumed = ws2.sentText().find((m) => m.t === 'resume');
      expect(resumed, '有令牌时必须发 resume').toBeTruthy();
      expect(resumed!.token, '要带的就是服务器给的那枚令牌').toBe('tok-1');
      expect(
        ws2.sentText().some((m) => m.t === 'joinRoom'),
        '⚠️ 绝不能重发 joinRoom —— 那等于"新人进房"，会把自己踢一遍并拿到白板状态',
      ).toBe(false);

      // ---- 服务器把当前状态补回来 ----
      ws2.receive({
        t: 'resumeState',
        playerId: 'p1',
        serverVersion: '0.1.2',
        room: {
          code: 'AAAAAA',
          hostId: 'p2',
          phase: 'prep',
          round: 1,
          players: [],
          prepSecondsLeft: 42,
        },
        pool: { remaining: {}, held: {} },
        prepTeams: {},
        myTeam: null,
        phase: 'prep',
        round: 1,
        prepSecondsLeft: 42,
        battles: [],
        eliminated: false,
      });
      await settle();

      expect(visible(doc.querySelector('#resync-overlay')), '重连成功要把浮层收掉').toBe(false);
      expect(
        doc.querySelector('#stat-phase')!.textContent,
        '重连后应该回到布阵阶段（并恢复服务端给的剩余秒数）',
      ).toContain('布阵');
      expect(
        doc.querySelector('#stat-phase')!.textContent,
        '布阵倒计时要用服务器那份（不然重连者会比别人多/少几秒）',
      ).toContain('42');
      expect(visible(doc.querySelector('#main-menu')), '重连成功不该还停着主界面').toBe(false);
    },
    20000,
  );

  /**
   * ★ 0.1.2 断线重连（界面层）—— 第 2 条：真的回不去了，就干脆利落地收场。
   *
   * 反面情况：令牌过期 / 房间散了 / 座位被清掉。这时候必须
   * **收起"正在重连"、明确回主界面** —— 否则玩家对着一个永远连不上的浮层干等。
   */
  it(
    '★ 0.1.2 重连失败（座位没了）：收起浮层、回主界面',
    async () => {
      const { doc, ws } = await bootConnected();
      ws.receive({ t: 'welcome', playerId: 'p1', serverVersion: '0.1.2', resumeToken: 'tok-2' });
      ws.receive({ t: 'gameStarted', roomCode: 'AAAAAA', round: 1 });
      await settle();

      ws.close();
      await settle();
      expect(visible(doc.querySelector('#resync-overlay')), '断线先要进"正在重连"').toBe(true);

      const reconnected = await waitUntil(() => FakeWebSocket.instances.length > 1);
      expect(reconnected, '断线后应该自动重连').toBe(true);
      const ws2 = FakeWebSocket.instances[1]!;
      ws2.open();
      await settle();

      ws2.receive({ t: 'resumeFailed', code: 'RESUME_EXPIRED', message: '座位已过期' });
      await settle();

      expect(
        visible(doc.querySelector('#resync-overlay')),
        '重连失败后不能一直挂着"正在重连"',
      ).toBe(false);
      expect(visible(doc.querySelector('#main-menu')), '回不去就得让人回主界面').toBe(true);
    },
    20000,
  );
});

/** 一直等到条件成立（或超时）。用来等"战斗回放播完"这种必须花真实时间的事 */async function waitUntil(check: () => boolean, timeoutMs = 8000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return check();
}

/** 商店当前这批卡的签名（用来判断"有没有换一批"） */
function shopSignature(doc: Document): string {
  return [...doc.querySelectorAll('#shop-slots .shop-slot')]
    .map((slot) => slot.querySelector('.shop-slot-name')?.textContent ?? slot.textContent ?? '')
    .join('|');
}

describe('0.0.2 新增：主界面头像选择 + 右侧栏页签切换', () => {
  // 和上一组一样：每个用例都要让 main.ts 重新跑一遍（它只认"当前那份 DOM"）
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('three');
    vi.restoreAllMocks();
  });

  it(
    '★ 主界面能选干员头像，并把选中的头像随建房请求发给服务器',
    async () => {
      const { doc } = await bootApp();
      await settle();

      const grid = doc.querySelector('#avatar-grid')!;
      const options = () => [...grid.querySelectorAll<HTMLButtonElement>('.avatar-option')];
      expect(options().length, '头像选择器里应该有一堆干员可选').toBeGreaterThan(10);
      // 召唤物不该出现在头像列表里（它们不是干员，服务器也不会认）
      expect(grid.innerHTML, '不该出现召唤物').not.toContain('summon');

      /*
        ★ 0.0.2 追加需求第 4 条：头像列表里**不要标费用**。
        以前每个格子的 tooltip 写的是"名字（N 费）"，那是商店的写法；
        头像列表只需要告诉玩家"这是谁"。
      */
      for (const option of options()) {
        expect(option.title, `«${option.title}» 不该带费用`).not.toContain('费');
        expect(option.textContent, '格子本身上不该写费用数字').not.toMatch(/\d\s*费/);
      }

      /*
        ★ 每次点完都要**重新查一遍**元素。
        因为选中态是通过"整块重画选择器"来体现的，点一下之后
        先前抓到的那批 <button> 已经脱离 DOM 了 —— 对它们断言只会永远是 false。
      */
      const pickAt = async (index: number): Promise<void> => {
        options()[index]!.click();
        await settle();
      };

      // 没选之前，预览框给一句提示（而不是留一个空框，空框看着像加载失败）
      const preview = () => doc.querySelector('#avatar-picker-preview')!;
      expect(preview().querySelector('img'), '还没选就不该有图').toBeNull();
      expect(preview().textContent, '未选择时要有提示').toContain('点');

      await pickAt(2);
      expect(options()[2]!.classList.contains('selected'), '点过的头像要标记成选中').toBe(true);
      const chosen = options()[2]!.dataset.avatarId!;
      expect(chosen, '每个头像要能对上一个干员 id').toMatch(/^op\d+$/);

      // 选完之后，大预览框要真的把这张头像显示出来
      expect(preview().querySelector('img'), '选完预览框要出图').not.toBeNull();
      expect(
        doc.querySelector('#avatar-picker-name')!.textContent,
        '标题栏也要写出选中的是谁',
      ).toContain(UNIT_DEFS[chosen]!.name);

      // 再点一次 -> 取消
      await pickAt(2);
      expect(options()[2]!.classList.contains('selected'), '再点一次该取消选择').toBe(false);
      expect(preview().querySelector('img'), '取消之后预览框不该还留着图').toBeNull();

      // 重新选一个，然后建房：请求里必须带上 avatarId
      await pickAt(2);
      doc.querySelector<HTMLButtonElement>('#menu-create-go')!.click();
      const ws = FakeWebSocket.instances[0]!;
      ws.open();
      ws.receive({ t: 'welcome', playerId: 'p1', serverVersion: '0.0.2' });
      await settle();

      const create = ws.sentText().find((message) => message.t === 'createRoom');
      expect(create, '应该发出了建房请求').toBeDefined();
      expect(create!.avatarId, '建房请求要带上选中的头像').toBe(chosen);
    },
    15000,
  );

  it(
    '★ 右上角是「日志 / 玩家 / 藏品」三档切换，藏品页签能点开',
    async () => {
      const { doc, ws } = await bootConnected();
      ws.receive({ t: 'gameStarted', roomCode: 'AAAAAA', round: 1 });
      /*
        ★ 必须先让客户端拿到一份 room 广播。
        「玩家」页签在"不在房间里"时是 disabled 的（单机没有玩家列表可看），
        而 **disabled 的按钮在浏览器/jsdom 里 click() 是完全没有反应的** ——
        不先补这条消息，测试看到的是"点了没反应"，其实按钮本来就点不动。
      */
      ws.receive({
        t: 'room',
        room: {
          code: 'AAAAAA',
          hostId: 'p1',
          phase: 'prep',
          round: 1,
          prepSecondsLeft: 30,
          players: [
            { id: 'p1', name: '我', ready: true, connected: true, hp: 100, submitted: false, round: 1, wins: 0, losses: 0, avatarId: '', level: 1, streak: 0 },
          ],
        },
      });
      await settle();

      const tabs = [...doc.querySelectorAll<HTMLButtonElement>('.sidebar-tab')];
      expect(tabs.map((tab) => tab.dataset.sideTab)).toEqual(['log', 'players', 'collection']);
      const collection = tabs.find((tab) => tab.dataset.sideTab === 'collection')!;
      // ★ 0.0.3：藏品系统已经做完了，这个页签不该再是禁用的
      expect(collection.disabled, '藏品页签不该再禁用').toBe(false);

      const paneLog = doc.querySelector('#side-pane-log')!;
      const panePlayers = doc.querySelector('#side-pane-players')!;
      const paneCollection = doc.querySelector('#side-pane-collection')!;

      // 默认看日志
      expect(paneLog.classList.contains('hidden'), '默认显示日志').toBe(false);
      expect(panePlayers.classList.contains('hidden'), '默认不显示玩家').toBe(true);
      expect(paneCollection.classList.contains('hidden'), '默认不显示藏品').toBe(true);

      // 切到玩家
      tabs.find((tab) => tab.dataset.sideTab === 'players')!.click();
      await settle();
      expect(paneLog.classList.contains('hidden'), '切到玩家后日志要收起来').toBe(true);
      expect(panePlayers.classList.contains('hidden'), '玩家页要显示').toBe(false);

      // ★ 0.0.3：切到藏品 —— 三栏格子（10 存放 / 5 存放 / 4 装备）+ 最下面的删除区
      collection.click();
      await settle();
      expect(paneCollection.classList.contains('hidden'), '藏品页要显示').toBe(false);
      expect(panePlayers.classList.contains('hidden'), '切到藏品后玩家页要收起来').toBe(true);
      expect(
        paneCollection.querySelectorAll('#item-slots-a .item-slot').length,
        'A 类藏品栏的格子数',
      ).toBe(ITEM_A_SLOTS);
      expect(paneCollection.querySelectorAll('#item-slots-b .item-slot').length).toBe(ITEM_B_SLOTS);
      expect(paneCollection.querySelectorAll('#item-slots-bequip .item-slot').length).toBe(
        ITEM_B_EQUIP_SLOTS,
      );
      expect(paneCollection.querySelector('#item-delete-zone'), '最下方要有删除藏品的落点').not.toBeNull();

      // 再点一次当前页签 = 收起整个右侧栏（换成"玩家"页签来验 —— 两边是同一套逻辑）
      tabs.find((tab) => tab.dataset.sideTab === 'players')!.click();
      await settle();
      tabs.find((tab) => tab.dataset.sideTab === 'players')!.click();
      await settle();
      expect(doc.querySelector('#sidebar')!.classList.contains('hidden'), '再点一次该收起右侧栏').toBe(
        true,
      );
      expect(paneCollection.classList.contains('hidden'), '收起右侧栏时藏品页也藏着').toBe(true);
    },
    15000,
  );
});

describe('★ 0.1.3：重开浏览器后「接管这一局」', () => {
  /*
    ★ 必须自己 resetModules：`bootApp` 靠重新 import 一份 main.js 来跑启动流程，
    而 vi 的模块注册表是**跨 describe 共享**的 —— 不重置就会拿到上一条用例
    缓存下来的那份 main.js，启动流程根本不会重跑
    （症状是"浮层没弹出来"，看起来像界面写错了，其实只是模块没重跑）。
  */
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('three');
    vi.restoreAllMocks();
  });

  /**
   * ============================================================
   *  【修的这条 bug：点「接管这一局」什么都没发生】
   * ============================================================
   * 重连令牌由**本机进程**保管（`/__airnight/session`），里面记着它属于哪台服务器；
   * 而 `readMachineToken()` 只在"地址和令牌记的那台对得上"时才把令牌交出来。
   *
   * 重开浏览器之后 `net.url` 会回到**默认值**（当前页面主机 :8787）——
   *   · 房主那台：默认值恰好就是自己，所以这条 bug 在他那儿看不出来；
   *   · 客人那台：当初是用房间号连到**房主的局域网地址**的（ws://192.168.x.x:8787），
   *     重开后默认值变回自己的 localhost:8787 ⇒ 地址对不上 ⇒ 一个令牌都读不到
   *     ⇒ `resume` 根本发不出去 ⇒ 握手正常、但没有任何人认领那个座位。
   *
   * 这条用例把"必须先连回当初那台服务器"钉住：
   * 假进程里存的是局域网地址，点接管之后新建的连接**必须**用它，并且立刻发 resume。
   */
  it('★ 接管时先连回会话里记的那台服务器（不是默认的 localhost），并立刻发 resume', async () => {
    const lanUrl = 'ws://192.168.1.5:8787';
    /**
     * 假的"本机进程"：存着一局，而且**占用者是另一个标签页、还活着** ——
     * 所以启动时会弹「本机正在对局中」，要玩家自己点「接管这一局」。
     */
    const fakeFetch = (async (input: unknown, init?: { method?: string }) => {
      const payload = {
        session: { serverUrl: lanUrl, token: 'tok-1', roomCode: 'A7K2M9' },
        owner: 'another-tab',
        ownerAlive: true,
        ok: true,
      };
      void init;
      return { ok: true, status: 200, json: async () => payload } as unknown as Response;
    }) as unknown as typeof fetch;

    const { doc, socket } = await bootApp(fakeFetch);
    await settle();

    expect(
      visible(doc.querySelector('#machine-busy-overlay')),
      '本机另一个标签页在玩 -> 要弹「本机正在对局中」',
    ).toBe(true);

    doc.querySelector<HTMLButtonElement>('#machine-busy-takeover')!.click();
    await settle();

    const ws = socket();
    expect(
      ws.url,
      '必须连回会话里记的那台服务器 —— 连默认的 localhost 上去是"没有座位可认领"的空连接',
    ).toBe(lanUrl);

    ws.open();
    await settle();
    expect(
      ws.sentText()[0],
      '连上之后第一件事就是拿令牌换回原来的座位',
    ).toMatchObject({ t: 'resume', token: 'tok-1' });
  });
});

describe('★ 0.1.4：对局暂停时界面要说清在等什么（浮层 + 投票）', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('three');
    vi.restoreAllMocks();
  });

  /** 一条"有人掉线、已暂停"的房间广播 */
  const pausedRoom = {
    t: 'room',
    room: {
      code: 'AAAAAA',
      hostId: 'p1',
      phase: 'prep',
      round: 4,
      prepSecondsLeft: 23,
      // ★ 只要有一个还活着的人掉线，服务端就会把 paused 置 true（0.1.4 放宽了判据）
      paused: true,
      pauseSecondsLeft: 143,
      pauseVoteCount: 0,
      pauseVoteNeeded: 2,
      players: [
        { id: 'p1', name: '我', ready: true, connected: true, hp: 100, submitted: false, round: 4, wins: 0, losses: 0, level: 1, streak: 0 },
        { id: 'p2', name: '小红', ready: true, connected: false, hp: 100, submitted: false, round: 4, wins: 0, losses: 0, level: 1, streak: 0 },
        { id: 'p3', name: '阿强', ready: true, connected: true, hp: 100, submitted: false, round: 4, wins: 0, losses: 0, level: 1, streak: 0 },
      ],
    },
  };

  it('顶部写「等待其他玩家回来（倒计时）」，不显示布阵倒计时', async () => {
    const { doc, ws } = await bootConnected();
    ws.receive({ t: 'gameStarted', roomCode: 'AAAAAA', round: 4 });
    await settle();

    ws.receive(pausedRoom);
    await settle();

    const phase = doc.querySelector('#stat-phase')!;
    expect(phase.textContent, '暂停时不能只显示一个不动的倒计时（那看起来像卡死）').toContain(
      '等待其他玩家回来',
    );
    expect(phase.textContent, '把 3 分钟倒计时带上，玩家才知道还要等多久').toContain('2:23');
  });

  it('★ 弹出投票浮层：只有「同意」，点了会发投票、并变成"等其他人"', async () => {
    const { doc, ws } = await bootConnected();
    ws.receive({ t: 'gameStarted', roomCode: 'AAAAAA', round: 4 });
    await settle();
    ws.receive(pausedRoom);
    await settle();

    const overlay = doc.querySelector<HTMLElement>('#pause-overlay')!;
    expect(visible(overlay), '★ 所有人（在线的）都该看到这个浮层').toBe(true);
    expect(doc.querySelector('#pause-timer')!.textContent, '浮层上要有倒计时').toBe('2:23');
    expect(doc.querySelector('#pause-votes')!.textContent, '要显示同意进度').toContain('0 / 2');
    expect(doc.querySelector('#pause-message')!.textContent, '说清是谁掉线了').toContain('小红');

    const agree = doc.querySelector<HTMLButtonElement>('#pause-agree')!;
    expect(agree.textContent).toBe('同意');
    agree.click();
    await settle();

    expect(
      ws.sentText().some((m) => m['t'] === 'pauseVote'),
      '★ 点同意要真的发暂停投票',
    ).toBe(true);
    expect(agree.textContent, '投过之后要变成"等其他人"，别让人重复点').toContain('已同意');

    // 服务端把票清零（暂停途中又有人掉线、倒计时重开）-> 我又能重新表态了
    ws.receive({ t: 'pauseTick', secondsLeft: 180, voteCount: 0, voteNeeded: 3 });
    await settle();
    expect(agree.textContent, '票被清了就得让人重新投').toBe('同意');

    // 暂停结束 -> 浮层收起来
    ws.receive({ t: 'room', room: { ...pausedRoom.room, paused: false } });
    await settle();
    expect(visible(overlay), '暂停结束浮层要收掉').toBe(false);
  });

  it('★★ 倒计时必须真的在走：每秒的 pauseTick 不能被房间广播里那份冻结的数刷回去', async () => {
    /*
      【这条钉的是"队友掉线后弹出的倒计时卡住不动"】

      两个地方都在写同一份 `pauseInfo`：
        · **房间广播**（`room`）—— 里面带着 `pauseSecondsLeft`，但它是**事件驱动**的：
          只在"暂停开始 / 有人投票 / 恢复"这些时刻才来一次，中间**一直不动**；
        · **`pauseTick`** —— 服务端**每秒**推一条，这才是倒计时真正的数据源。

      而 `renderPauseOverlay` 每次都拿房间广播那份去覆盖，于是 `onPauseTick`
      刚把新秒数写进去，紧接着就被刷回"暂停开始那一刻"的 143 ——
      浮层上的 `2:23` 永远不动，`#stat-phase` 上那行同样不动，看着就像卡死了。
    */
    const { doc, ws } = await bootConnected();
    ws.receive({ t: 'gameStarted', roomCode: 'AAAAAA', round: 4 });
    await settle();
    ws.receive(pausedRoom);
    await settle();

    const timer = doc.querySelector('#pause-timer')!;
    const phase = doc.querySelector('#stat-phase')!;
    expect(timer.textContent, '浮层刚弹出来先用房间广播那份垫上').toBe('2:23');

    // 服务端每秒推的节拍 —— 倒计时必须跟着走
    ws.receive({ t: 'pauseTick', secondsLeft: 142, voteCount: 0, voteNeeded: 2 });
    await settle();
    expect(timer.textContent, '★ 收到每秒节拍后倒计时必须往前走').toBe('2:22');
    expect(phase.textContent, '顶栏那行读的是同一份数，也要跟着走').toContain('2:22');

    ws.receive({ t: 'pauseTick', secondsLeft: 141, voteCount: 0, voteNeeded: 2 });
    await settle();
    expect(timer.textContent).toBe('2:21');

    /*
      关键时刻：期间又来一条房间广播（它自带的那份还是"暂停那一刻"的 143）。
      以前这一条会把倒计时刷回 2:23 —— 所以只要玩家一动（每次投票/重连都会触发
      房间广播），倒计时就"卡住"甚至"倒着跳"。
    */
    ws.receive(pausedRoom);
    await settle();
    expect(timer.textContent, '★ 房间广播里那份是冻结的，不许覆盖每秒节拍').toBe('2:21');
  });
});

describe('★ 0.1.4：重连令牌不许被"新连接的 welcome"顶掉', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('three');
    vi.restoreAllMocks();
  });

  /**
   * 【这条钉的是用户报的"掉线重连有时候能回、有时候回不去（大概率回不去）"】
   *
   * 每条新连接建立时，服务端都先发一条 `welcome`，里面是**这条连接的临时身份**令牌；
   * 而客户端紧接着用**手上那枚真令牌**去 resume —— 服务端 resume 成功会把临时身份作废，
   * 那条 welcome 给的令牌**当场就死了**。
   *
   * 0.1.3 的客户端老老实实按 welcome 覆盖：于是第一次重连成功之后，
   * 手上存的是一枚已经作废的令牌，第二次重连必定 BAD_TOKEN。
   * 表现就是"能回一次，之后就再也回不去"。
   */
  it('连断两次，两次都带最初那枚令牌（第二次不能是临时令牌）', async () => {
    const { doc, ws } = await bootConnected();

    // 服务端把"本人令牌"发过来（真实流程里它跟着 welcome 一起来）
    ws.receive({
      t: 'welcome',
      playerId: 'p1',
      serverVersion: SERVER_VERSION,
      resumeToken: 'TOKEN-A',
    });
    await settle();

    // 在大厅里（进房那一刻才会把令牌写进本机会话，这里只是让流程更像真的）
    ws.receive({
      t: 'room',
      room: {
        code: 'AAAAAA',
        hostId: 'p1',
        phase: 'lobby',
        round: 0,
        prepSecondsLeft: 0,
        players: [
          { id: 'p1', name: '我', ready: false, connected: true, hp: 100, submitted: false, round: 0, wins: 0, losses: 0, level: 1, streak: 0 },
        ],
      },
    });
    await settle();
    expect(doc, '界面还在（这条用例不关心界面，只是别让它炸）').toBeTruthy();

    // ---- 第一次断线：客户端自动重连（第一次退避 1 秒）----
    ws.close();
    await new Promise((resolve) => setTimeout(resolve, 1300));
    const first = FakeWebSocket.instances[1];
    expect(first, '断线之后必须自动新建一条连接').toBeTruthy();
    first!.open();
    await settle();
    expect(first!.sentText()[0], '第一次重连：带上原来那枚令牌').toMatchObject({
      t: 'resume',
      token: 'TOKEN-A',
    });

    // ★ 新连接的 welcome 带的是"临时令牌" —— 服务端马上会让它作废
    first!.receive({
      t: 'welcome',
      playerId: 'pTemp',
      serverVersion: SERVER_VERSION,
      resumeToken: 'TOKEN-B',
    });
    await settle();

    // ---- 第二次断线：必须还是那枚真令牌 ----
    first!.close();
    await new Promise((resolve) => setTimeout(resolve, 1300));
    const second = FakeWebSocket.instances[2];
    expect(second, '第二次也要自动重连').toBeTruthy();
    second!.open();
    await settle();
    expect(
      second!.sentText()[0],
      '第二次重连还得用最初那枚 —— 用临时令牌就是 BAD_TOKEN，从此回不去',
    ).toMatchObject({ t: 'resume', token: 'TOKEN-A' });
  }, 20000);
});

describe('★ 0.1.4：主界面右下角「回到对局」', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('three');
    vi.restoreAllMocks();
  });

  /** 假的"本机进程"：存着一局没用完的对局 */
  const busyMachine = (async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      session: { serverUrl: 'ws://192.168.1.5:8787', token: 'tok-1', roomCode: 'A7K2M9' },
      owner: 'another-tab',
      ownerAlive: true,
      ok: true,
    }),
  })) as unknown as typeof fetch;

  /**
   * 假的"本机进程"：存着一局，但**占用者已经过期**（没有别的标签页在玩）。
   * ⇒ 启动时不会弹「接管」，而是走"静默自动回座"那条路。
   * 用它来测"自动回座失败"时的交代 —— 也就是用户报的那个场景：
   * 「重新进游戏没弹接管，点重新连接按钮也没反应」。
   */
  const deadSession = (async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      session: { serverUrl: 'ws://192.168.1.5:8787', token: 'tok-1', roomCode: 'A7K2M9' },
      owner: '',
      ownerAlive: false,
      ok: true,
    }),
  })) as unknown as typeof fetch;

  it('本机还存着一局时按钮才出现，而且带上房间号', async () => {
    const { doc } = await bootApp(busyMachine);
    await settle();

    const button = doc.querySelector<HTMLButtonElement>('#menu-reconnect')!;
    expect(visible(button), '★ 有没打完的对局 -> 右下角要有入口').toBe(true);
    expect(button.textContent, '把房间号带上，好认').toContain('A7K2M9');
  }, 20000);

  it('本机什么都没有时按钮不出现（不占地方）', async () => {
    const { doc } = await bootApp();
    await settle();
    expect(visible(doc.querySelector('#menu-reconnect')), '没得回就别摆一个按钮在那儿').toBe(false);
  }, 20000);

  it('★ 本机另一个标签页还在玩时，点它不会硬抢 —— 走「接管」那条路问一句', async () => {
    const { doc } = await bootApp(busyMachine);
    await settle();

    // 启动时已经有「本机正在对局中」浮层；先点「留在菜单」把它收掉
    doc.querySelector<HTMLButtonElement>('#machine-busy-stay')!.click();
    await settle();
    expect(visible(doc.querySelector('#machine-busy-overlay'))).toBe(false);

    doc.querySelector<HTMLButtonElement>('#menu-reconnect')!.click();
    await settle();

    expect(
      visible(doc.querySelector('#machine-busy-overlay')),
      '★ 别人正在玩 -> 引导玩家用「接管」，绝不悄悄把座位抢过来',
    ).toBe(true);
    expect(FakeWebSocket.instances.length, '这一步不该自己去连服务器').toBe(0);
  }, 20000);

  /**
   * ★ 0.1.4：「加入房间」页里的「断线重连恢复」。
   *
   * 【它补的是什么？】
   * 自动回座（以及"本机正在对局中"那个浮层）都建立在"启动时那次会话探测读到了本机进程"
   * 之上。而那次探测在真实环境里有可能读不到（刚启动时进程正忙着发素材、或者走隧道时
   * 接口压根不存在）—— 一旦读不到，主界面那颗「回到对局」不会出现，
   * 玩家就**彻底没有任何入口**能自己试一次，只能重新输房间号（而那个号多半早忘了）。
   *
   * 所以这一颗按钮的设计要点是：**它不依赖那次探测**。
   * 有没有可恢复的对局，由点下去之后那一句实话来回答。
   */
  it('★ 「加入房间」页里那颗「断线重连恢复」不依赖探测结果，一直在', async () => {
    // 假进程什么都不返回 = 模拟"启动探测没读到本机会话"
    const { doc } = await bootApp();
    await settle();

    doc.querySelector<HTMLButtonElement>('#menu-join')!.click();
    await settle();

    expect(visible(doc.querySelector('#menu-panel-join')), '加入房间面板要打开').toBe(true);
    const recover = doc.querySelector<HTMLButtonElement>('#menu-join-recover');
    expect(recover, '★ 探测失败时也得有手动入口（这是兜底的兜底）').toBeTruthy();
    expect(recover!.textContent).toContain('断线重连恢复');
    expect(recover!.classList.contains('hidden'), '它不该像右下角那颗那样自己藏起来').toBe(false);
  }, 20000);

  it('★ 本机另一个标签页在玩时，点它也走「接管」那条路，不硬抢', async () => {
    const { doc } = await bootApp(busyMachine);
    await settle();
    // 启动时已经有「本机正在对局中」浮层；先收掉它
    doc.querySelector<HTMLButtonElement>('#machine-busy-stay')!.click();
    await settle();

    doc.querySelector<HTMLButtonElement>('#menu-join')!.click();
    await settle();
    doc.querySelector<HTMLButtonElement>('#menu-join-recover')!.click();
    await settle();

    expect(
      visible(doc.querySelector('#machine-busy-overlay')),
      '★ 别人正在玩 -> 引导玩家用「接管」',
    ).toBe(true);
    expect(FakeWebSocket.instances.length, '这一步不该自己去连服务器').toBe(0);
  }, 20000);

  it('确实没有没打完的对局时，点它要明说一句（而不是毫无反应）', async () => {
    const { doc } = await bootApp();
    await settle();

    doc.querySelector<HTMLButtonElement>('#menu-join')!.click();
    await settle();
    doc.querySelector<HTMLButtonElement>('#menu-join-recover')!.click();
    await settle();

    const toast = doc.querySelector<HTMLElement>('#toast')!;
    expect(visible(toast), '要给一句反馈，别让人以为按钮坏了').toBe(true);
    expect(toast.textContent, '说清"没有可恢复的对局"').toContain('没有');
  }, 20000);

  /**
   * ★★ 0.1.4：重连失败必须**说清楚**。
   *
   * ============================================================
   *  【这条钉的是用户报的："没弹接管 + 点重新连接按钮也没反应"】
   * ============================================================
   * 真机复现（关掉浏览器再打开）看到的失败现场是这样的：
   *   · `onResumeFailed` → `leaveNetplay()` → `clearResumeToken()` → `clearMachineSession()`
   *     把**内存里的会话置空** ⇒ `renderReconnectButton()` 判定"没得可回"
   *     ⇒ 「回到对局」按钮**当场消失**；
   *   · 「加入房间」页的「断线重连恢复」也只会说"没有记录"；
   *   · 唯一的信息是一条 **2 秒**就消失的 toast，夹在页面刚加载的一堆日志里。
   * 玩家得到的结论就是"点了没反应、也不知道为什么"。
   *
   * 现在改成**要点掉才消失的浮层**，一次说清：哪一局 / 为什么回不去 / 下一步怎么办，
   * 并把错误码带上（这个项目没有日志文件，截图这一屏就是最有用的排查材料）。
   */
  it('★★ 自动回座失败时：弹出"回不到原来那一局了"的浮层，写明哪一局 + 为什么 + 下一步', async () => {
    const { doc, socket } = await bootApp(deadSession);
    await settle();

    // 占用已过期 -> 不弹接管浮层，直接自动回座（这才是"没弹接管"时真正发生的事）
    expect(visible(doc.querySelector('#machine-busy-overlay')), '占用过期就不该弹接管').toBe(false);

    const ws = socket();
    ws.open();
    await settle();
    expect(
      ws.sentText().some((m) => m['t'] === 'resume'),
      '自动回座这条路要先拿令牌换座位',
    ).toBe(true);

    // 服务器说：这枚令牌不认了（房主那台机器上的游戏重启过）
    ws.receive({ t: 'resumeFailed', code: 'BAD_TOKEN', message: '重连凭据已失效（服务器可能重启过）' });
    await settle();

    const overlay = doc.querySelector<HTMLElement>('#resume-failed-overlay')!;
    expect(visible(overlay), '★ 失败必须明说 —— 不能只留一条 2 秒就消失的 toast').toBe(true);
    expect(doc.querySelector('#resume-failed-message')!.textContent, '要说清是哪一局').toContain('A7K2M9');
    expect(
      doc.querySelector('#resume-failed-hint')!.textContent,
      '要给出能照着做的下一步，而不是一句"失败了"',
    ).toContain('让房主重新');
    expect(
      doc.querySelector('#resume-failed-hint')!.textContent,
      '错误码要带上（没有日志文件，玩家截图这一屏就是排查材料）',
    ).toContain('BAD_TOKEN');

    // 必须点掉才收起（它是"要读的信息"，不是一闪而过的提示）
    doc.querySelector<HTMLButtonElement>('#resume-failed-ok')!.click();
    await settle();
    expect(visible(overlay), '点「知道了」之后才收起').toBe(false);
  }, 20000);

  /*
    ★★ 0.3（用户报的）：**盟约选秀的倒计时不会动**。

    【为什么这条一定要有】
    服务端每秒钟都会重播一次房间状态（`broadcastRoom`），秒数也真的在减
    （`covenantSecondsLeftOf` 用墙钟算）。所以问题只可能出在**客户端没把新数字写上去**。
    这类"倒计时不走"的 bug 在这个项目里出现过三次（布阵 / 暂停 / 商店回合），
    共同点都是：**秒数被写在了某个"只在结构变化时才跑"的分支里**，
    或者是"等某个每秒 tick 消息，但那条消息没发"。
    ⇒ 这条用例把它钉死：**每来一条 room 广播，界面上的秒数就必须跟着变**，
      哪怕结构签名完全没变（`covenantSignature` 一样）。
  */
  it('★★ 盟约选秀：倒计时不会卡住（room 广播 / 纯 tick / 什么都不发，三条路都要动）', async () => {
    const { doc, ws } = await bootConnected();

    const roomView = (secondsLeft: number) => ({
      t: 'room',
      room: {
        code: 'AAAAAA',
        hostId: 'p1',
        phase: 'covenant',
        round: 0,
        players: [
          { id: 'p1', name: '我', avatarId: '', hp: 100, wins: 0, losses: 0, level: 1, streak: 0, connected: true, submitted: false, ready: true },
          { id: 'p2', name: '朋友', avatarId: '', hp: 100, wins: 0, losses: 0, level: 1, streak: 0, connected: true, submitted: false, ready: true },
        ],
        prepSecondsLeft: 0,
        paused: false,
        covenant: { currentPlayerId: 'p1', secondsLeft, remaining: 2, total: 2 },
      },
    });

    const overlay = doc.querySelector<HTMLElement>('#covenant-overlay')!;
    const timer = doc.querySelector<HTMLElement>('#covenant-timer')!;
    /** 读当前显示值（还没写上就是 NaN） */
    const shown = (): number => Number(timer.textContent);
    /** 等 rAF 走几帧（数字是每帧写的） */
    const frames = async () => {
      for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 40));
    };

    ws.receive(roomView(30));
    await settle();
    await frames();
    expect(visible(overlay), '选秀页必须弹出来').toBe(true);
    expect(shown(), '第一帧就是服务端给的秒数（±1 秒）').toBeGreaterThanOrEqual(28);
    expect(shown()).toBeLessThanOrEqual(30);

    /*
      ★★ 三条路都必须让数字动起来 —— 这正是用户报的那个 bug：
      以前只有"room 广播"这一条路，而且写在一个会被结构签名挡住的函数里。
      ① 房间广播（常规路径）
      ② **纯 tick**（`covenantTick`，不带任何房间状态）
      ③ **什么消息都不发**（本地按墙钟推算，不能僵住）
    */
    ws.receive(roomView(20));
    await settle();
    await frames();
    expect(shown(), '① 房间广播带的秒数要生效').toBeGreaterThanOrEqual(18);
    expect(shown()).toBeLessThanOrEqual(20);

    ws.receive({ t: 'covenantTick', secondsLeft: 12 });
    await settle();
    await frames();
    expect(shown(), '② 只有 covenantTick、没有 room，也要生效').toBeGreaterThanOrEqual(10);
    expect(shown()).toBeLessThanOrEqual(12);

    const before = shown();
    await new Promise((r) => setTimeout(r, 1200));
    await frames();
    const after = shown();
    expect(after, '③ 服务端一条都不发，本地也要按真实时间往下走（不能僵住）').toBeLessThan(before);

    // 最后 5 秒要变红（同一个判据，别只在第一次渲染时算）
    ws.receive({ t: 'covenantTick', secondsLeft: 4 });
    await settle();
    await frames();
    expect(doc.querySelector('.covenant-clock')!.classList.contains('urgent'), '≤5 秒要标红').toBe(true);
  }, 20000);
});

/**
 * ============================================================
 *  ★★ 0.3.3 人机：大厅里的「添加 / 改难度 / 移除」
 * ============================================================
 * 【用户口径】"房主可以在房间内添加人机、删除人机，并随时切换已有人机的难度"。
 *
 * 【为什么这些要在界面层测？】
 * 服务端那一套（上限、房主继承、占位）在 `packages/server/test/bot-room.test.ts`
 * 已经钉死了；这里要钉的是**按钮有没有真的接上**：
 *   · 房主看得到「添加人机」，普通人看不到；
 *   · 每台人机那一行有没有"难度下拉 + 移除"；
 *   · 点下去发出去的消息**字段对不对**（发错字段服务端会静默当没收到，最难查）。
 */
describe('★★ 0.3.3 人机：大厅里的添加 / 改难度 / 移除', () => {
  /*
    ★ 必须自己 resetModules + 重新 import：这份测试文件里前面的 describe
      已经把 main.ts 加载过了，直接再调 bootConnected 会拿到已经初始化过的旧模块，
      WebSocket 根本没建出来（症状就是一句「客户端没有创建 WebSocket 连接」）。
  */
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('three');
    vi.restoreAllMocks();
  });

  const botPlayer = (id: string, difficulty: 'easy' | 'normal' | 'hard', name: string) => ({
    id,
    name,
    ready: true,
    connected: true,
    hp: 100,
    submitted: false,
    round: 0,
    wins: 0,
    losses: 0,
    level: 1,
    streak: 0,
    isBot: true,
    botDifficulty: difficulty,
  });
  const human = (id: string, name: string) => ({
    id,
    name,
    ready: false,
    connected: true,
    hp: 100,
    submitted: false,
    round: 0,
    wins: 0,
    losses: 0,
    level: 1,
    streak: 0,
  });

  const lobbyRoom = (hostId: string) => ({
    t: 'room' as const,
    room: {
      code: 'BOTAAA',
      hostId,
      phase: 'lobby' as const,
      round: 0,
      prepSecondsLeft: 0,
      players: [human('p1', '我'), botPlayer('bot:BOTAAA:1', 'hard', '人机·困难1')],
    },
  });

  it(
    '★ 房主：能看到「添加人机」，加下去发的是 addBot（带难度）',
    async () => {
      const { doc, ws } = await bootConnected();
      ws.receive(lobbyRoom('p1'));
      await settle();

      const addRow = doc.querySelector<HTMLElement>('#lobby-bot-add')!;
      expect(visible(addRow), '★ 房主要看得到「添加人机」那一行').toBe(true);

      // 选「简单」再点添加
      const select = doc.querySelector<HTMLSelectElement>('#lobby-bot-difficulty')!;
      select.value = 'easy';
      doc.querySelector<HTMLButtonElement>('#btn-add-bot')!.click();
      await settle();

      const sent = ws.sentText().filter((m) => m.t === 'addBot');
      expect(sent, '★ 点一下就该发 addBot').toHaveLength(1);
      expect(sent[0], '★ 难度要跟着发（否则服务端只知道"加一台"，不知道什么难度）').toMatchObject({
        difficulty: 'easy',
      });
    },
    15000,
  );

  it(
    '★ 房主：人机那一行有难度下拉和「移除」，改了下拉就发 setBotDifficulty',
    async () => {
      const { doc, ws } = await bootConnected();
      ws.receive(lobbyRoom('p1'));
      await settle();

      const rows = [...doc.querySelectorAll<HTMLElement>('#lobby-players .net-player')];
      expect(rows, '房主 + 一台人机 = 两行').toHaveLength(2);
      const botRow = rows[1]!;
      expect(botRow.textContent, '★ 要标出它是人机').toContain('人机');

      const select = botRow.querySelector<HTMLSelectElement>('[data-action="bot-difficulty"]')!;
      expect(select, '★ 人机那一行要有难度下拉').toBeTruthy();
      expect(select.value, '下拉要预先选中当前难度').toBe('hard');
      // 三档都要在（少一档就选不到）
      expect([...select.options].map((option) => option.value)).toEqual(['easy', 'normal', 'hard']);

      select.value = 'normal';
      select.dispatchEvent(new doc.defaultView!.Event('change', { bubbles: true }));
      await settle();
      const changed = ws.sentText().filter((m) => m.t === 'setBotDifficulty');
      expect(changed).toHaveLength(1);
      expect(changed[0]).toMatchObject({ playerId: 'bot:BOTAAA:1', difficulty: 'normal' });

      // 移除：走二次确认，确认后才发 removeBot
      botRow.querySelector<HTMLButtonElement>('[data-action="remove-bot"]')!.click();
      await settle();
      expect(visible(doc.querySelector('#confirm-overlay')), '★ 移除要走二次确认').toBe(true);
      expect(ws.sentText().filter((m) => m.t === 'removeBot'), '确认之前不许发').toHaveLength(0);
      doc.querySelector<HTMLButtonElement>('#confirm-ok')!.click();
      await settle();
      const removed = ws.sentText().filter((m) => m.t === 'removeBot');
      expect(removed).toHaveLength(1);
      expect(removed[0]).toMatchObject({ playerId: 'bot:BOTAAA:1' });
    },
    15000,
  );

  it(
    '★ 普通人：看不到「添加人机」，也看不到人机的改难度 / 移除',
    async () => {
      const { doc, ws } = await bootConnected();
      // 房主是 p1，我是 p2（不在玩家列表里也不影响：判据只看 hostId）
      ws.receive(lobbyRoom('p1'));
      await settle();
      expect(visible(doc.querySelector('#lobby-bot-add')), '这是房主视角').toBe(true);

      ws.receive(lobbyRoom('p2'));
      await settle();
      expect(visible(doc.querySelector('#lobby-bot-add')), '★ 普通人看不到添加人机').toBe(false);
      expect(doc.querySelectorAll('#lobby-players [data-action="bot-difficulty"]')).toHaveLength(0);
      expect(doc.querySelectorAll('#lobby-players [data-action="remove-bot"]')).toHaveLength(0);
      // 人机标签本身还是要在（知道对面不是人）
      expect(doc.querySelector('#lobby-players')!.textContent).toContain('人机');
    },
    15000,
  );
});

/**
 * ============================================================
 *  ★★ 0.3.3 局域网房间列表（加入房间页）
 * ============================================================
 * 用户口径：
 *   · 进「加入房间」就**自动搜**，不用输房间号；
 *   · **已开局的房间也看得见**，只是点不进去；
 *   · 掉了线还能回到已开局的房间（列表里那颗「回到对局」）。
 *
 * 这一组钉住的是"看得见 / 点得动 / 点不动的原因"三件事 ——
 * 它们错了都不会报错，全是"界面看起来没反应"。
 */
describe('★★ 0.3.3 局域网房间列表', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('three');
    vi.restoreAllMocks();
  });

  /** 等到条件成立（最多 timeout 毫秒）—— 自动搜房间是异步的，不能拿 settle() 硬等 */
  async function waitFor(condition: () => boolean, timeout = 1500): Promise<void> {
    const deadline = Date.now() + timeout;
    while (!condition() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  }

  /**
   * 换目标之后会新建一条连接（`setServerUrl` / `resumeInto` 都会先 disconnect 再 connect）。
   * 这个辅助把**最后那条** socket 打开并假装握手，返回它。
   */
  async function openNewestSocket(previous: FakeWebSocket): Promise<FakeWebSocket> {
    const next = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
    if (next !== previous) {
      next.open();
      next.receive({ t: 'welcome', playerId: 'p1', serverVersion: SERVER_VERSION });
      await settle();
    }
    return next;
  }

  /**
   * 打开「加入房间」并假装服务器已经连上。
   *
   * @param setup 在"点开面板之前"跑（比如往 localStorage 里塞重连令牌）。
   *   ★ 必须在这里塞而不是测试开头：`bootApp()` 每次都会换一个新的 jsdom，
   *     `localStorage` 也是新的 —— 提前塞会写进上一个文档里，等于没塞。
   */
  async function bootJoinPanel(setup?: () => void): Promise<{ doc: Document; ws: FakeWebSocket }> {
    const { doc, socket } = await bootApp();
    setup?.();
    doc.querySelector<HTMLButtonElement>('#menu-join')!.click();
    const ws = socket();
    ws.open();
    ws.receive({ t: 'welcome', playerId: 'p1', serverVersion: SERVER_VERSION });
    // 名字是必填项：先填上，后面点「加入」才走得通（和手动填房间号同一条规矩）
    doc.querySelector<HTMLInputElement>('#menu-name-join')!.value = '玩家甲';
    await settle();
    return { doc, ws };
  }

  const ROOMS = [
    // 能进的：等待中、还有空位
    { code: 'AAA111', hostName: '阿米娅', players: 2, maxPlayers: 8, address: '192.168.1.5:8787', phase: 'lobby', round: 0, version: SERVER_VERSION },
    // 已开局：看得见、点不进去
    { code: 'BBB222', hostName: '陈', players: 5, maxPlayers: 8, address: '192.168.1.6:8787', phase: 'battle', round: 7, version: SERVER_VERSION },
    // 人满
    { code: 'CCC333', hostName: '凯尔希', players: 8, maxPlayers: 8, address: '192.168.1.7:8787', phase: 'lobby', round: 0, version: SERVER_VERSION },
    // 版本不同
    { code: 'DDD444', hostName: '老版本', players: 1, maxPlayers: 8, address: '192.168.1.8:8787', phase: 'lobby', round: 0, version: '0.3.2正式版' },
  ];

  it('★ 打开加入页就自动搜索（连本机服务器），并把局域网房间列出来', async () => {
    const { doc, ws } = await bootJoinPanel();
    // 自动搜索 = 打开面板就已经连上并问过一句（连接是异步的，等它一下）
    await waitFor(() => ws.sentText().some((message) => message.t === 'lanScan'));
    expect(ws.sentText().some((message) => message.t === 'lanScan'), '打开面板要自动扫一次').toBe(true);

    ws.receive({ t: 'lanRooms', rooms: ROOMS });
    await settle();

    const rows = [...doc.querySelectorAll<HTMLElement>('#lan-rooms-list .lan-room')];
    expect(rows, '四个房间都要列出来').toHaveLength(4);
    // 能进的排最前（排序稳定，不会每 2 秒跳）
    expect(rows[0]!.dataset.code).toBe('AAA111');
    expect(rows[0]!.querySelector('.lan-room-btn')!.textContent).toBe('加入');
    expect(doc.querySelector('#lan-rooms-empty')!.classList.contains('hidden'), '有房间就别显示空态').toBe(true);
  });

  it('★★ 已开局的房间看得见、但点不进去（按钮换成一颗灰章）', async () => {
    const { doc, ws } = await bootJoinPanel();
    ws.receive({ t: 'lanRooms', rooms: [ROOMS[1]!] });
    await settle();

    const row = doc.querySelector<HTMLElement>('#lan-rooms-list .lan-room')!;
    expect(row.textContent, '要写出"进行中 · 第 7 回合"').toContain('第 7 回合');
    expect(row.querySelector('.lan-room-btn'), '已开局不该给"加入"按钮').toBeNull();
    expect(row.querySelector('.lan-room-lock')!.textContent).toBe('已开局');
    expect(row.classList.contains('dim'), '不可点的行压暗一档').toBe(true);
  });

  it('★ 人满 / 版本不同 也各有说法（不让玩家白点）', async () => {
    const { doc, ws } = await bootJoinPanel();
    ws.receive({ t: 'lanRooms', rooms: [ROOMS[2]!, ROOMS[3]!] });
    await settle();

    const rows = [...doc.querySelectorAll<HTMLElement>('#lan-rooms-list .lan-room')];
    const full = rows.find((row) => row.dataset.code === 'CCC333')!;
    const old = rows.find((row) => row.dataset.code === 'DDD444')!;
    expect(full.textContent).toContain('已满');
    expect(full.querySelector('.lan-room-btn')).toBeNull();
    expect(old.textContent, '版本不同的房间要点明版本').toContain('版本不同');
    expect(old.querySelector('.lan-room-btn')).toBeNull();
  });

  it('★ 点「加入」直接连房主那台机器（不用再按房间号找一遍）', async () => {
    const { doc, ws } = await bootJoinPanel();
    ws.receive({ t: 'lanRooms', rooms: [ROOMS[0]!] });
    await settle();

    doc.querySelector<HTMLButtonElement>('#lan-rooms-list .lan-room-btn')!.click();
    /*
      ★ 换目标是**换一条连接**：`setServerUrl` 会断掉本机那条、连到房主那台，
      `joinRoom` 就记在 pendingAction 里，新连接一打开才补发。
      所以断言要落在"最后那一条 socket"上，而不是打开面板时那条。
    */
    const next = await openNewestSocket(ws);
    await waitFor(() => next.sentText().some((message) => message.t === 'joinRoom'));

    const join = next.sentText().find((message) => message.t === 'joinRoom') as
      | { t: string; roomCode: string; playerName?: string }
      | undefined;
    expect(join, '点了「加入」要真的发 joinRoom').toBeDefined();
    expect(join!.roomCode).toBe('AAA111');
  });

  it('★★ 那间房里有我的座位 → 按钮变「回到对局」，点了发 resume 而不是 joinRoom', async () => {
    // ★ 令牌先塞进多槽索引（真实场景里是上次进房时记下的）
    const token = 'a'.repeat(32);
    const { doc, ws } = await bootJoinPanel(() => {
      globalThis.localStorage.setItem(
        'airnight.resume.index.v1',
        JSON.stringify([{ url: 'ws://192.168.1.6:8787', code: 'BBB222', token, at: Date.now() }]),
      );
    });
    ws.receive({ t: 'lanRooms', rooms: [ROOMS[1]!] });
    await settle();

    const row = doc.querySelector<HTMLElement>('#lan-rooms-list .lan-room')!;
    const button = row.querySelector<HTMLButtonElement>('.lan-room-btn')!;
    expect(button, '有座位就不该是"已开局"灰章').toBeTruthy();
    expect(button.textContent).toBe('回到对局');

    button.click();
    // 同样是"换一条连接连过去"，resume 落在新 socket 上
    const next = await openNewestSocket(ws);
    await waitFor(() => next.sentText().some((message) => message.t === 'resume'));

    const sent = next.sentText();
    expect(sent.some((message) => message.t === 'resume'), '要发 resume 换回座位').toBe(true);
    expect(sent.some((message) => message.t === 'joinRoom'), '绝不能当成新人进房（那会被"已开局"拒掉）').toBe(false);
  });
});
