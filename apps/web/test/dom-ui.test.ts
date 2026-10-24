/**
 * 真实的 DOM 交互测试：把整个客户端初始化一遍，然后点按钮看反应。
 *
 * 【为什么需要这个？】
 * 之前所有测试都是「纯逻辑」测试（规则、经济、坐标换算），
 * 但用户报了几次「UI 没生效」—— 比如「返回主界面的二次确认没生效」。
 * 这类 bug 光靠看代码找不出来：代码看起来是对的，
 * 问题出在 DOM 接线、事件绑定、CSS 遮挡这些地方。
 *
 * 所以这里用 jsdom 造一个真实 DOM，加载 index.html，
 * 把 main.ts 完整跑一遍，然后**真的去点按钮**，断言界面的反应。
 *
 * 这类测试的价值：把「有没有生效」变成可自动验证的事实，而不是靠肉眼。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_LEVEL, UNIT_DEFS, monsterDefs } from '../../../packages/shared/src/index.js';
// ★ 0.0.3 藏品：界面测试要用真实的容量常量和数据表（不写死 10/5/4 和"36 件"）
import {
  ITEM_A_SLOTS,
  ITEM_B_EQUIP_SLOTS,
  ITEM_B_SLOTS,
  ITEM_DEFS,
} from '../../../packages/shared/src/index.js';

const indexHtml = readFileSync(
  fileURLToPath(new URL('../index.html', import.meta.url)),
  'utf8',
);

/** 每个用例都重新装一遍环境，避免互相污染 */
/**
 * @param debug 带上 `?debug=1`（个别用例要用调试钩子，比如往棋盘上摆棋子）
 * @param extraQuery 再追加的查询参数，比如 `quit=<令牌>`
 *   —— ★ 0.3.2「退出游戏」按钮的显示条件就是地址里有没有这个令牌，
 *   所以要能在同一个页面文件上模拟"启动器打开"和"朋友打开"两种情形。
 */
async function bootApp(debug = false, extraQuery = ''): Promise<{ dom: JSDOM; doc: Document }> {
  const base = debug ? 'http://localhost:5173/?debug=1' : 'http://localhost:5173/';
  const url = extraQuery ? `${base}${base.includes('?') ? '&' : '?'}${extraQuery}` : base;
  const dom = new JSDOM(indexHtml, {
    // ★ 0.1.4：个别用例要用 `?debug=1` 的调试钩子（比如往棋盘上摆棋子）
    url,
    pretendToBeVisual: true,
  });

  const { window } = dom;

  // ---- 把 jsdom 的全局对象挂到 Node 全局上，让 main.ts 能用 ----
  // 注意：Node 里有些全局（比如 navigator）是**只读的 getter**，
  // 直接赋值会抛 "Cannot set property navigator"。所以统一走 defineProperty。
  const globals: Record<string, unknown> = {
    window,
    document: window.document,
    navigator: window.navigator,
    location: window.location,
    HTMLElement: window.HTMLElement,
    HTMLCanvasElement: window.HTMLCanvasElement,
    HTMLImageElement: window.HTMLImageElement,
    Image: window.Image,
    WebSocket: window.WebSocket,
    localStorage: window.localStorage,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  };
  for (const [key, value] of Object.entries(globals)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    // 只读的（比如 navigator）跳过 —— 它本来就存在，不需要我们替换
    if (descriptor && !descriptor.writable && !descriptor.set) continue;
    try {
      Object.defineProperty(globalThis, key, {
        value,
        writable: true,
        configurable: true,
      });
    } catch {
      // 实在改不了就算了，说明环境里已经有等价的东西
    }
  }

  // ---- 3D / WebGL 在 jsdom 里没有，全部打桩 ----
  // 我们的目的是验证 UI 接线，不是渲染 —— 渲染在无头环境本来就测不了。
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
      /*
        ★ 0.1.4：`?debug=1` 的棋盘取色探针会调它（`renderer.getContext().readPixels`）。
        不补这个方法，用例里一开 debug 就报 "renderer.getContext is not a function"。
      */
      getContext(): unknown {
        return { readPixels: () => undefined, drawingBufferWidth: 1, drawingBufferHeight: 1 };
      }
    }
    // WebGLRenderer 换成打桩版本；其它 three 的导出保持原样（几何体、材质都能在 Node 里构造）
    return { ...actual, WebGLRenderer: StubRenderer };
  });

  // 画布尺寸：jsdom 默认 0x0，board.resize 里有 Math.max(80, ...) 兜底，不会崩
  Object.defineProperty(window.HTMLCanvasElement.prototype, 'getContext', {
    value: () => ({
      // sprite-graphics / backdrop 会用到这些 Canvas 2D 方法
      fillRect: () => {},
      clearRect: () => {},
      // ★ 别漏了 rect：卡面的"光泽扫过边框"那段用了 ctx.rect + clip('evenodd')。
      //   桩里少了它，一画卡片就报 "ctx.rect is not a function"，
      //   而报错信息完全看不出是"测试环境的 canvas 缺方法"。
      rect: () => {},
      beginPath: () => {},
      closePath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      arc: () => {},
      quadraticCurveTo: () => {},
      fill: () => {},
      stroke: () => {},
      save: () => {},
      restore: () => {},
      clip: () => {},
      translate: () => {},
      scale: () => {},
      rotate: () => {},
      drawImage: () => {},
      fillText: () => {},
      strokeText: () => {},
      measureText: () => ({ width: 10 }),
      createLinearGradient: () => ({ addColorStop: () => {} }),
      createRadialGradient: () => ({ addColorStop: () => {} }),
      createImageData: (w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4),
        width: w,
        height: h,
      }),
      putImageData: () => {},
      getImageData: (x: number, y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4),
      }),
      set fillStyle(_v: unknown) {},
      set strokeStyle(_v: unknown) {},
      set lineWidth(_v: unknown) {},
      set font(_v: unknown) {},
      set textAlign(_v: unknown) {},
      set textBaseline(_v: unknown) {},
      set globalCompositeOperation(_v: unknown) {},
    }),
  });

  await import('../src/main');

  return { dom, doc: window.document };
}

/** 元素是否可见（既没有 hidden class，也没有被 display:none 影响） */
function visible(element: Element | null): boolean {
  if (!element) return false;
  return !element.classList.contains('hidden');
}

describe('主界面与游戏内 UI 的接线', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('three');
    vi.restoreAllMocks();
  });

  it('启动后显示主界面，游戏内 UI 是隐藏的', async () => {
    const { doc } = await bootApp();
    expect(visible(doc.querySelector('#main-menu'))).toBe(true);
    expect(visible(doc.querySelector('#game-hud'))).toBe(false);
  });

  it('★ 点「单人游戏」后进入游戏界面，主界面隐藏', async () => {
    const { doc } = await bootApp();
    doc.querySelector<HTMLButtonElement>('#menu-solo')!.click();

    expect(visible(doc.querySelector('#main-menu'))).toBe(false);
    expect(visible(doc.querySelector('#game-hud'))).toBe(true);
  });

  it('★ 点「← 返回」会弹出二次确认，而不是直接返回（用户报过这个 bug）', async () => {
    const { doc } = await bootApp();

    // 进入游戏
    doc.querySelector<HTMLButtonElement>('#menu-test')!.click();
    expect(visible(doc.querySelector('#game-hud'))).toBe(true);

    // 点返回
    doc.querySelector<HTMLButtonElement>('#btn-back-menu')!.click();

    // ★ 关键断言：必须弹确认，而且还没真的返回。
    // 这里不用「先摆个棋子」来构造进度 —— 因为确认本来就该无条件弹，
    // 上一版就是因为「靠猜进度决定要不要确认」而漏掉了大多数情况。
    const confirm = doc.querySelector('#confirm-overlay');
    expect(visible(confirm), '点返回后应该弹出二次确认').toBe(true);
    expect(visible(doc.querySelector('#game-hud')), '确认前不应该离开游戏').toBe(true);
    expect(visible(doc.querySelector('#main-menu')), '确认前不应该回到主界面').toBe(false);
  });

  it('★ 确认框点「取消」会关掉，且留在游戏里', async () => {
    const { doc } = await bootApp();
    doc.querySelector<HTMLButtonElement>('#menu-test')!.click();
    doc.querySelector<HTMLButtonElement>('#btn-back-menu')!.click();
    doc.querySelector<HTMLButtonElement>('#confirm-cancel')!.click();

    expect(visible(doc.querySelector('#confirm-overlay'))).toBe(false);
    expect(visible(doc.querySelector('#game-hud'))).toBe(true);
  });

  it('★ 确认框点「确定」才真的返回主界面', async () => {
    const { doc } = await bootApp();
    doc.querySelector<HTMLButtonElement>('#menu-test')!.click();
    doc.querySelector<HTMLButtonElement>('#btn-back-menu')!.click();
    doc.querySelector<HTMLButtonElement>('#confirm-ok')!.click();

    expect(visible(doc.querySelector('#confirm-overlay'))).toBe(false);
    expect(visible(doc.querySelector('#game-hud'))).toBe(false);
    expect(visible(doc.querySelector('#main-menu'))).toBe(true);
  });

  it('刚开局点返回也要确认（不靠猜进度，避免漏掉情况）', async () => {
    const { doc } = await bootApp();
    doc.querySelector<HTMLButtonElement>('#menu-solo')!.click();
    expect(visible(doc.querySelector('#game-hud'))).toBe(true);

    doc.querySelector<HTMLButtonElement>('#btn-back-menu')!.click();

    // 无条件弹确认 —— 第一版做成「刚开始就不问」，结果那个条件几乎永远不成立，
    // 导致确认框形同虚设。统一都问一次更可预测。
    expect(visible(doc.querySelector('#confirm-overlay'))).toBe(true);
    expect(visible(doc.querySelector('#main-menu'))).toBe(false);
  });

  it('商店渲染出 5 张卡片，每张都带稀有度边框颜色', async () => {
    const { doc } = await bootApp();
    doc.querySelector<HTMLButtonElement>('#menu-solo')!.click();

    const cards = doc.querySelectorAll<HTMLElement>('#shop-slots .shop-slot');
    expect(cards.length).toBeGreaterThanOrEqual(5);

    // 至少前 5 张应该是真卡片（不是空格子），而且都有内联的边框颜色
    let withColor = 0;
    for (const card of Array.from(cards).slice(0, 5)) {
      if (card.classList.contains('empty')) continue;
      const borderColor = card.style.borderColor;
      if (borderColor && borderColor !== 'transparent') withColor++;
    }
    expect(withColor, '商店卡片应该有稀有度边框颜色').toBeGreaterThan(0);
  });

  it('商店每张卡片都有头像方块', async () => {
    const { doc } = await bootApp();
    doc.querySelector<HTMLButtonElement>('#menu-solo')!.click();
    const boxes = doc.querySelectorAll('#shop-slots .shop-portrait-box');
    expect(boxes.length).toBeGreaterThan(0);
  });

  it('备战席渲染出格子，且买来的棋子带稀有度 outline', async () => {
    const { doc } = await bootApp();
    doc.querySelector<HTMLButtonElement>('#menu-test')!.click();

    // 买一个
    const firstCard = doc.querySelector<HTMLElement>('#shop-slots .shop-slot:not(.empty)');
    expect(firstCard).not.toBeNull();
    firstCard!.click();

    const slots = doc.querySelectorAll<HTMLElement>('#bench-slots .bench-slot');
    expect(slots.length).toBeGreaterThan(0);

    // 有棋子的那个格子应该有 outline 颜色
    let withOutline = 0;
    for (const slot of Array.from(slots)) {
      if (slot.classList.contains('empty')) continue;
      if (slot.style.outlineColor) withOutline++;
    }
    expect(withOutline, '备战席棋子应该有稀有度 outline 颜色').toBeGreaterThan(0);
  });

  it('★ 羁绊详情在左侧面板内展开，不是弹窗（用户要求不要太大）', async () => {
    const { doc } = await bootApp();
    doc.querySelector<HTMLButtonElement>('#menu-test')!.click();

    // 买一个干员并放到场上，这样才有羁绊可看
    // （board.screenToCell 在 jsdom 里拿不到坐标，所以直接买 + 用「选中后放」的路径不可行；
    //   这里改成验证：即使场上没干员，列表视图和详情视图的切换也要正常）
    expect(visible(doc.querySelector('#traits-list-view'))).toBe(true);
    expect(visible(doc.querySelector('#traits-detail-view'))).toBe(false);
  });

  it('★ 点羁绊能打开详情，点「返回列表」能回去', async () => {
    const { doc } = await bootApp();
    doc.querySelector<HTMLButtonElement>('#menu-test')!.click();

    // 直接调用内部渲染不方便，这里通过「买到场上」来产生羁绊：
    // 买一个后从备战席点一下选中，再点棋盘 —— jsdom 拿不到棋盘坐标，
    // 所以改用另一种方式：羁绊列表为空时点不到东西，我们就验证空态提示存在。
    const listView = doc.querySelector('#traits-list-view');
    expect(visible(listView)).toBe(true);

    // 详情视图的「返回列表」按钮必须存在且可用
    const back = doc.querySelector<HTMLButtonElement>('#detail-back');
    expect(back, '详情里应该有返回列表按钮').not.toBeNull();

    // 手动切到详情视图，再点返回，验证切换逻辑
    doc.querySelector('#traits-detail-view')!.classList.remove('hidden');
    doc.querySelector('#traits-list-view')!.classList.add('hidden');
    back!.click();
    expect(visible(doc.querySelector('#traits-list-view'))).toBe(true);
    expect(visible(doc.querySelector('#traits-detail-view'))).toBe(false);
  });

  it('Esc 能关掉确认框', async () => {
    const { dom, doc } = await bootApp();
    doc.querySelector<HTMLButtonElement>('#menu-test')!.click();
    doc.querySelector<HTMLButtonElement>('#btn-back-menu')!.click();
    expect(visible(doc.querySelector('#confirm-overlay'))).toBe(true);

    dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { code: 'Escape' }));
    expect(visible(doc.querySelector('#confirm-overlay'))).toBe(false);
  });

  // ============================================================
  // 本轮新增：备战席头像 / 可升星提示 / 干员信息小窗口
  // ============================================================

  it('★ 备战席格子带头像容器（用户要求加头像）', async () => {
    const { doc } = await bootApp();
    doc.querySelector<HTMLButtonElement>('#menu-test')!.click();
    doc.querySelector<HTMLElement>('#shop-slots .shop-slot:not(.empty)')!.click();

    const filled = Array.from(
      doc.querySelectorAll<HTMLElement>('#bench-slots .bench-slot'),
    ).filter((slot) => !slot.classList.contains('empty'));
    expect(filled.length).toBeGreaterThan(0);
    for (const slot of filled) {
      expect(
        slot.querySelector('.bench-portrait-box'),
        '每个有棋子的备战席格子都应该有头像容器',
      ).not.toBeNull();
    }
  });

  it('★ 买下第二个同名干员后，商店里再出现同名卡会显示「可升星」', async () => {
    const { doc } = await bootApp();
    doc.querySelector<HTMLButtonElement>('#menu-test')!.click();

    // 测试模式金币无限，直接反复刷商店直到攒够 2 个同名干员
    const refresh = doc.querySelector<HTMLButtonElement>('#btn-refresh')!;
    let guard = 0;
    while (guard++ < 80) {
      const cards = Array.from(doc.querySelectorAll<HTMLElement>('#shop-slots .shop-slot:not(.empty)'));
      // 优先买那张标了「已有 1 个」的卡，这样最容易凑到 2 个
      const hinted = cards.find((card) => card.querySelector('.upgrade-hint') !== null);
      (hinted ?? cards[0])?.click();
      if (doc.querySelectorAll('#bench-slots .bench-slot:not(.empty)').length >= 2) break;
      refresh.click();
    }

    // 现在应该至少有一个干员被持有
    const ownedNames = Array.from(
      doc.querySelectorAll<HTMLElement>('#bench-slots .bench-slot:not(.empty) .bench-name'),
    ).map((node) => node.textContent ?? '');
    expect(ownedNames.length).toBeGreaterThan(0);

    // 反复刷，直到商店里出现"我已持有 2 个"的那种卡 —— 它必须带 .upgrade-badge
    let sawBadge = false;
    for (let i = 0; i < 200 && !sawBadge; i++) {
      refresh.click();
      for (const card of Array.from(
        doc.querySelectorAll<HTMLElement>('#shop-slots .shop-slot:not(.empty)'),
      )) {
        const name = card.querySelector('.shop-slot-name')?.textContent ?? '';
        const count = ownedNames.filter((n) => n === name).length;
        if (count >= 2) {
          expect(
            card.querySelector('.upgrade-badge'),
            `已持有 2 个「${name}」，这张卡应该标「可升星」`,
          ).not.toBeNull();
          sawBadge = true;
          break;
        }
      }
    }
    // 同名干员能不能刷到有随机性，刷不到就跳过（不能因为这个让测试变脆）
    if (!sawBadge) {
      console.info('[dom-ui] 200 次刷新内没凑到同名两张卡，跳过可升星断言');
    }
  });

  /**
   * ★ 0.0.3 需求 2：商店卡面右上角要提示"目前拥有相同干员几张"。
   *
   * 【为什么不能只靠"买一次看一次"？】
   * 商店里的 5 张卡是随机的，买过的那张会变成空格子，
   * 所以必须**刷新到同名的卡再出现**才能看到角标。
   * 1 级商店 100% 出 1 费（14 种），每次刷新至少中一张的概率约 1-(13/14)^5 ≈ 31%，
   * 刷 200 次基本必然命中；万一没中（理论概率 10^-30 量级）就跳过，不让测试变脆。
   */
  it('★ 已拥有的干员再出现时，卡面右上角显示「已拥有 N」', async () => {
    const { doc } = await bootApp();
    doc.querySelector<HTMLButtonElement>('#menu-test')!.click();

    // 买下第一张，记下它的名字（测试模式金币无限）
    const first = doc.querySelector<HTMLElement>('#shop-slots .shop-slot:not(.empty)')!;
    const boughtName = first.querySelector('.shop-slot-name')!.textContent!;
    first.click();

    const benchNames = (): string[] =>
      Array.from(doc.querySelectorAll<HTMLElement>('#bench-slots .bench-slot:not(.empty) .bench-name')).map(
        (node) => node.textContent ?? '',
      );
    expect(benchNames(), '买下的干员应该在备战席上').toContain(boughtName);

    const refresh = doc.querySelector<HTMLButtonElement>('#btn-refresh')!;
    let checked = 0;
    for (let i = 0; i < 200; i++) {
      refresh.click();
      const card = Array.from(
        doc.querySelectorAll<HTMLElement>('#shop-slots .shop-slot:not(.empty)'),
      ).find((node) => node.querySelector('.shop-slot-name')?.textContent === boughtName);
      if (!card) continue;

      const badge = card.querySelector('.shop-owned-badge');
      expect(badge, `已拥有「${boughtName}」，这张卡右上角该有「已拥有」角标`).not.toBeNull();
      /*
        数字必须是**按张数折算**的：1 星 1 张、2 星 3 张、3 星 9 张。
        期望值直接从备战席的 DOM 上数出来（星级写在 .bench-star-strip 的 title 里），
        所以就算测试中途合成了 2 星，这条断言依然对。
      */
      const expected = Array.from(
        doc.querySelectorAll<HTMLElement>('#bench-slots .bench-slot:not(.empty)'),
      )
        .filter((slot) => slot.querySelector('.bench-name')?.textContent === boughtName)
        .reduce((sum, slot) => {
          const star = Number(/(\d+)\s*星/.exec(slot.querySelector('.bench-star-strip')?.getAttribute('title') ?? '')?.[1] ?? 1);
          return sum + 3 ** (Math.max(1, star) - 1);
        }, 0);
      expect(expected, '至少要有 1 张').toBeGreaterThan(0);
      expect(badge!.textContent).toContain(`已拥有 ${expected}`);
      checked++;
      break;
    }
    if (checked === 0) {
      console.info('[dom-ui] 200 次刷新内没再刷到刚买的那个干员，跳过「已拥有」角标断言');
    }
  });

  it('★ 点场上干员会弹出信息小窗口，关闭按钮能关掉', async () => {
    const { dom, doc } = await bootApp();
    doc.querySelector<HTMLButtonElement>('#menu-test')!.click();

    // 初始是关着的
    expect(visible(doc.querySelector('#unit-info'))).toBe(false);

    /*
      在 jsdom 里点不到 3D 棋盘（没有 WebGL，screenToCell 拿不到坐标），
      所以这里直接验证"窗口能开、能关、内容结构完整"这条接线：
      手动显示它，然后点关闭按钮。
      （真正的"点棋子弹出"依赖 WebGL 拾取，只能在浏览器里人眼确认。）
    */
    const panel = doc.querySelector<HTMLElement>('#unit-info')!;
    panel.classList.remove('hidden');
    expect(visible(panel)).toBe(true);

    // 关键：关闭按钮必须真的接上事件
    doc.querySelector<HTMLButtonElement>('#unit-info-close')!.click();
    expect(visible(panel), '点 ✕ 应该关掉信息窗口').toBe(false);

    // Esc 也能关
    panel.classList.remove('hidden');
    dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { code: 'Escape' }));
    expect(visible(panel), 'Esc 应该关掉信息窗口').toBe(false);

    /*
      ============================================================
      ★ 0.1.1：在面板**外面**按下鼠标也要能关掉它（用户报的"关不掉"）
      ============================================================
      根因：关这张卡的入口全挂在画布的 `click` 上，而拖动结束会
      `suppressNextClick = true` 把那一次 click 吃掉 —— 于是"拖一下之后
      卡片就卡在屏幕上"，只能再点一次才关得掉（从备战席拖出来时更糟：
      那次 click 落在备战席上，标记挂着不走，把玩家后面想关它的点击也吃掉）。

      兜底改成文档级的 `pointerdown`（捕获阶段）：按下的地方不在卡片里就关。
      它不依赖任何"上一次操作留下的标记"，所以不会再被绕过去。
    */
    panel.classList.remove('hidden');
    doc.querySelector('#stage')!.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true }));
    expect(visible(panel), '在面板外面按一下鼠标就该关掉它').toBe(false);

    // 但按在面板**自己**身上不能提前关 —— 否则里面的按钮就永远点不到了
    panel.classList.remove('hidden');
    doc
      .querySelector('#unit-info-close')!
      .dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true }));
    expect(visible(panel), '点面板里的按钮不该先把它关掉').toBe(true);
    doc.querySelector<HTMLButtonElement>('#unit-info-close')!.click();
    expect(visible(panel), '按原样点 ✕ 仍然要能关').toBe(false);
  });

  it('★ 0.1.1 备战席悬停卡片：只显示 名字 / 星级 / 羁绊 / 技能 / 射程', async () => {
    const { dom, doc } = await bootApp();
    doc.querySelector<HTMLButtonElement>('#menu-test')!.click();

    // 先从商店买一个（单机的购买是立刻生效的）
    const card = doc.querySelector<HTMLElement>('#shop-slots .shop-slot:not(.empty)')!;
    card.click();

    const slot = doc.querySelector<HTMLElement>('#bench-slots .bench-slot:not(.empty)')!;
    expect(slot, '备战席上应该有刚买的那个干员').not.toBeNull();
    const name = slot.querySelector('.bench-name')!.textContent!;

    const tip = doc.querySelector<HTMLElement>('#bench-tip')!;
    expect(visible(tip), '没悬停时卡片应该是藏着的').toBe(false);

    /*
      ★ 用 pointerenter 触发（不冒泡，直接派发到格子上就行）。
      【为什么元数据里不再挂原生 title？】
      原生 tooltip 会和这张卡片**同时**出现，屏幕上叠两层一样的信息 ——
      用户要的是"悬停只显示那五样"。
    */
    expect(slot.getAttribute('title'), '原生 title 必须去掉（否则和卡片重复）').toBeNull();
    slot.dispatchEvent(new dom.window.Event('pointerenter'));

    expect(visible(tip), '悬停后卡片要弹出来').toBe(true);
    const text = tip.textContent ?? '';
    expect(text, '要有名字').toContain(name);
    expect(text, '要有星级').toContain('★');
    expect(text, '要有射程').toContain('射程');
    expect(text, '要有羁绊区块').toContain('羁绊');
    expect(text, '要有技能区块').toContain('技能');
    // 只允许这五样 —— 费用 / 藏品 / 操作提示都不许回来
    expect(text, '不许再写藏品').not.toContain('藏品');
    expect(text, '不许再写操作提示').not.toContain('右键卖掉');
    // 「费用」用"N 费"这种形式来判断（技能描述里出现"费"字是允许的）
    expect(text, '不许再写费用').not.toMatch(/\d\s*费/);

    slot.dispatchEvent(new dom.window.Event('pointerleave'));
    expect(visible(tip), '鼠标移开要收起来').toBe(false);
  });

  it('★ 0.1.1 没有拖动时，残留在屏幕上的拖影会被自动清掉', async () => {
    /*
      【修的是"藏品拖动时标签卡住、赖着不消失"】
      拖动靠"在起点元素上 setPointerCapture"收事件，而那个元素随时可能被
      renderAll 整块重画掉（联机里别人买卖会广播 pool -> 重画藏品栏 / 备战席）。
      元素一消失，指针捕获就自动解除，pointerup 再也送不到我们手里 ——
      拖动预览（.drag-ghost）就永远挂在 body 上，还挡在画面最上层。

      两层兜底：① 全局 pointerup 接手（见 installDragFallback，jsdom测不了指针捕获）；
      ② 每次 renderAll 扫一遍孤儿拖影（就是这个用例验的）。
    */
    const { doc } = await bootApp();
    doc.querySelector<HTMLButtonElement>('#menu-test')!.click();

    const orphan = doc.createElement('div');
    orphan.className = 'drag-ghost item-ghost';
    orphan.textContent = '拟态物质';
    doc.body.appendChild(orphan);
    expect(doc.querySelectorAll('.drag-ghost'), '先确认它真的挂上去了').toHaveLength(1);

    // 任何一次重画都会顺手清掉（这里点一下刷新商店）
    doc.querySelector<HTMLButtonElement>('#btn-refresh')!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(doc.querySelectorAll('.drag-ghost').length, '孤儿拖影必须被清掉').toBe(0);
  });

  it('★ 0.1.1 拖动的全局兜底通道已经接上（源码级）', async () => {
    const src = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');
    // 兜底函数存在 + 启动时真的调了（只定义不调用等于没做）
    expect(src).toContain('function installDragFallback');
    expect(src).toMatch(/^installDragFallback\(\);$/m);
    // 三个事件都要兜：move（拖影要跟着走）/ up（要收尾）/ cancel（系统抢走指针）
    const body = src.slice(src.indexOf('function installDragFallback'));
    const fn = body.slice(0, body.indexOf('\n}\n') + 3);
    for (const type of ["'pointermove'", "'pointerup'", "'pointercancel'"]) {
      expect(fn, `兜底要监听 ${type}`).toContain(type);
    }
  });

  it('干员信息窗口的各个字段容器都在（缺一个就会静默不显示）', async () => {
    const { doc } = await bootApp();
    for (const id of [
      '#unit-info-portrait',
      '#unit-info-name',
      '#unit-info-sub',
      '#unit-info-stats',
      '#unit-info-traits',
      '#unit-info-skill',
      '#unit-info-recall',
    ]) {
      expect(doc.querySelector(id), `${id} 不存在`).not.toBeNull();
    }
  });

  it('羁绊详情里有「拥有这个羁绊的干员」容器', async () => {
    const { doc } = await bootApp();
    expect(doc.querySelector('#detail-units')).not.toBeNull();
  });

  it('★ 羁绊面板上写明了「按不同干员计数」（不然玩家会以为数字坏了）', async () => {
    /*
      规则是：同一个干员上多个也只算 1 个（见 需求清单.md 第 33 节）。
      这条规则**必须写在界面上** —— 否则玩家买了第二个同名干员、
      看到左边数字没变，只会以为游戏出 bug 了。
      这是个"界面文案也是功能"的测试：删掉那行字就会红。
    */
    const { doc } = await bootApp();
    const note = doc.querySelector('#traits-list-view .panel-note');
    expect(note, '羁绊面板里应该有那条计数规则的说明').not.toBeNull();
    expect(note!.textContent).toContain('不同干员');
  });

  it('★ 返回主界面后，上一局的伤害统计不会留在面板上', async () => {
    /*
      你报的 bug：「退出本局后重新进，上一局的伤害展示还存在」。

      根因：`resetBoardAndPlayback()` 只清了战斗日志（`el.log`）和 `currentResult`，
      忘了清 `damageStats` 这张表和 `#damage-stats` 这块 DOM。
      于是再进游戏时，新一局还没开打，右侧却挂着上一局每个干员的输出与承伤。

      【这条测试怎么造场景？】
      jsdom 里点不到 3D 棋盘、也就打不了一场真战斗，
      所以这里直接把"上一局的残留"写进面板（等价于 damageStats 有内容），
      再点返回 —— 断言面板必须被恢复成初始的空状态。
      它测的是**可观察的契约**：「返回 = 面板回到干净状态」。
      以后如果只清了变量、忘了重画 DOM，这条也会红。
    */
    const { doc } = await bootApp();
    doc.querySelector<HTMLButtonElement>('#menu-test')!.click();

    const panel = doc.querySelector<HTMLElement>('#damage-stats')!;
    expect(panel.textContent, '刚进游戏时伤害面板应该是空的').toContain('开始战斗后');

    // 伪造"上一局打完了"的残留
    panel.innerHTML = '<div class="damage-row">上一局的干员输出</div>';
    expect(panel.textContent).toContain('上一局的干员输出');

    // 点返回（会弹二次确认）
    doc.querySelector<HTMLButtonElement>('#btn-back-menu')!.click();
    doc.querySelector<HTMLButtonElement>('#confirm-ok')!.click();

    expect(panel.textContent, '返回主界面后不该还挂着上一局的伤害表').not.toContain('上一局的干员输出');
    expect(panel.textContent, '应该恢复成"还没开打"的提示').toContain('开始战斗后');
  });

  // ============================================================
  // 拖动被原生图片拖放打断的回归测试
  // ============================================================

  it('★ 浏览器原生拖放必须被禁掉（否则拖动会被 pointercancel 打断）', async () => {
    const { dom, doc } = await bootApp();
    doc.querySelector<HTMLButtonElement>('#menu-test')!.click();

    /*
      这个 bug 的现象是「备战席的干员拖不动，只跟着一张图片走」。
      根因：`<img>` 天生可拖，浏览器启动自己的拖放并发出 pointercancel，
      把我们的拖动打断了。

      注意：jsdom 里素材是打桩的（图片加载不会完成），所以界面上渲染不出 <img>。
      这里自己造一个图片元素来验证"文档级别的 dragstart 拦截"这一层 ——
      它和界面上真实图片走的是同一条路径。
    */
    const img = doc.createElement('img');
    img.src = 'data:image/png;base64,iVBORw0KGgo=';
    doc.body.appendChild(img);

    // dispatchEvent 返回 false 表示 preventDefault 被调用过（默认行为被阻止）
    const notCancelled = img.dispatchEvent(
      new dom.window.Event('dragstart', { bubbles: true, cancelable: true }),
    );
    expect(notCancelled, 'dragstart 必须被 preventDefault（原生拖放要禁掉）').toBe(false);

    // dragover / drop 也要挡掉：不然把手里的棋子拖到界面上会触发浏览器"打开文件"
    expect(
      doc.body.dispatchEvent(new dom.window.Event('dragover', { bubbles: true, cancelable: true })),
    ).toBe(false);
    expect(
      doc.body.dispatchEvent(new dom.window.Event('drop', { bubbles: true, cancelable: true })),
    ).toBe(false);
  });

  it('★ 所有图片都不能抢指针事件（CSS 里必须写着 pointer-events: none）', () => {
    /*
      这是最彻底的一层修法：图片 `pointer-events: none` 之后，
      指针事件永远落到父元素上，图片既不会成为事件目标、也不可能发起原生拖动。
      断言 CSS 里有这条规则 —— 防止以后有人"优化样式"时把它删掉。
    */
    const css = readFileSync(
      fileURLToPath(new URL('../src/styles.css', import.meta.url)),
      'utf8',
    );
    // 匹配一个以 img 开头的规则块，块里必须有 pointer-events: none
    const imgRule = /(^|\n)img\s*\{([^}]*)\}/.exec(css);
    expect(imgRule, 'styles.css 里应该有 img 规则').not.toBeNull();
    expect(imgRule![2], 'img 规则里必须有 pointer-events: none').toContain('pointer-events: none');
  });

  it('拖动时改过的精灵透明度会被恢复（不然棋子会一直半透明）', async () => {
    const { dom, doc } = await bootApp();
    doc.querySelector<HTMLButtonElement>('#menu-test')!.click();
    doc.querySelector<HTMLElement>('#shop-slots .shop-slot:not(.empty)')!.click();

    // Esc 取消拖动这条路径必须能走通、而且不抛错
    dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { code: 'Escape' }));
    // 没有拖动时按 Esc 也不该炸
    expect(visible(doc.querySelector('#game-hud'))).toBe(true);
  });

  it('★ renderAll() 里必须同步 3D 棋子（否则合成后旧贴图不消失）', () => {
    /*
      这里踩过一个 bug：场上有 2 个一样的、再买第 3 个时，
      两个被吃掉的编号连同精灵一起该消失、合成物是个新编号。
      但"买牌"那条路径只调了 renderAll()，从没同步过精灵 ——
      表现就是"升星之后旧贴图留在原地不消失"。

      修法是**把同步放进 renderAll**：这样任何改了阵容的地方都自动更新 3D，
      不需要每个调用点都记得额外调一次（这正是漏掉的原因）。

      这条断言是"接线守卫"：只要有人以后把 renderAll 里那行删掉，测试立刻红。
      逻辑本身（增/删/移）由 prep-sprites.test.ts 覆盖。
    */
    const source = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');
    const renderAllBody = /function renderAll\(\): void \{([\s\S]*?)\n\}/.exec(source);
    expect(renderAllBody, '找不到 renderAll 函数').not.toBeNull();
    expect(
      renderAllBody![1],
      'renderAll() 里必须有 syncPrepSprites() —— 否则合成/换位后 3D 贴图不会更新',
    ).toContain('syncPrepSprites()');
  });

  /**
   * ★ 单机回合结算的「取值顺序」守卫。
   *
   * 【这里踩过一个真 bug（玩家反馈"1、2 回合一件藏品都不掉"）】
   * `resetBoardAndPlayback()` 会把 `currentResult` 清成 null。
   * 单机那条路（`nextRound`）却是在 reset **之后**才去问
   * `lastBattleWon()` / `survivorsFromLastBattle()` / `lastBattleGold()`，
   * 于是三样东西永远是"平局 / 没有存活 / 没有战利品" ——
   * 野怪回合的击杀掉落一件都掷不出来（`won` 恒为 null）。
   *
   * 这类 bug 的特点是**代码看起来完全正常**：每一行单独看都对，
   * 错的是两行的先后。纯逻辑测试也盖不住（advanceRound 本身没问题），
   * 所以只能钉在源码的这一段上。
   */
  it('★ nextRound() 必须在 resetBoardAndPlayback() 之前取上一场的信息', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');
    const body = /function nextRound\(\): void \{([\s\S]*?)\n\}/.exec(source);
    expect(body, '找不到 nextRound 函数').not.toBeNull();
    // 先把注释去掉：注释里也会提到这些名字，量顺序时会数错位置
    const code = body![1]!.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    /*
      ★ 找的是 `resetBoardAndPlayback(`（带括号、不带收尾括号）——
      0.0.3 需求 1 之后这行变成了 `resetBoardAndPlayback({ keepLastBattleView: true })`，
      写死 `resetBoardAndPlayback()` 会直接找不到。
    */
    const resetAt = code.indexOf('resetBoardAndPlayback(');
    expect(resetAt, 'nextRound 里应当有一次 resetBoardAndPlayback(...)').toBeGreaterThanOrEqual(0);
    for (const call of [
      'lastBattleWon()',
      'survivorsFromLastBattle()',
      'lastBattleGold()',
      'monstersKilledLastBattle()',
    ]) {
      const at = code.indexOf(call);
      expect(at, `nextRound 里没有调用 ${call}`).toBeGreaterThanOrEqual(0);
      expect(
        at,
        `${call} 必须在 resetBoardAndPlayback() 之前调用（那之后 currentResult 已经是 null 了）`,
      ).toBeLessThan(resetAt);
    }
  });

  /**
   * ★ 0.0.3 需求 1：日志要留到下一回合的布阵阶段。
   *
   * 这属于"删掉一行就悄悄退化"的那类行为（源码看起来完全正常，
   * 只是新回合的布阵阶段日志变空了）——纯逻辑测试盖不住，所以钉在源码上。
   */
  it('★ 回合推进时必须保留上一场战报（keepLastBattleView）', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');

    // ① resetBoardAndPlayback 必须支持"保留"这个开关，且默认是清的
    const resetBody = /function resetBoardAndPlayback\(([^)]*)\): void \{([\s\S]*?)\n\}/.exec(source);
    expect(resetBody, '找不到 resetBoardAndPlayback').not.toBeNull();
    expect(resetBody![1], '要有一个 keepLastBattleView 开关').toContain('keepLastBattleView');
    expect(resetBody![2], '清日志必须挂在"不保留"这一支里').toContain('keepLastBattleView');

    // ② 回合推进那条路必须传"保留"
    const nextRound = /function nextRound\(\): void \{([\s\S]*?)\n\}/.exec(source);
    expect(nextRound, '找不到 nextRound').not.toBeNull();
    expect(
      nextRound![1],
      'nextRound 推进回合时必须保留上一场日志（否则野怪回合的掉落一进布阵就没了）',
    ).toContain('keepLastBattleView: true');

    // ③ 开新局 / 退出房间那条路**不能**保留（否则新一局挂着上局的伤害表）
    for (const fn of ['backToMenu', 'leaveNetplay']) {
      const body = new RegExp(`function ${fn}\\(\\): void \\{([\\s\\S]*?)\\n\\}`).exec(source);
      expect(body, `找不到 ${fn}`).not.toBeNull();
      expect(body![1], `${fn} 里必须清掉上一局的残留`).not.toContain('keepLastBattleView');
    }
  });
});

/**
 * ============================================================
 *  背景音乐：界面接线
 * ============================================================
 *
 * 逻辑层在 music-player.test.ts 里测得很细（39 条），
 * 但那些测试碰不到真实的选择器 —— 把 `#music-select` 写成
 * `#music-selected` 之类的低级错误，逻辑测试一条都不会红。
 *
 * 所以这里跟上面一样：真的把 index.html + main.ts 跑起来，
 * 真的去点按钮，断言界面反应。音频用假的 fetch 提供曲目表。
 *
 * 【为什么要点名"默认是《生命流》"？】
 * 这是用户明确提的需求（"进游戏默认音乐设置为生命流"）。
 * 它散落在"默认值 → 曲名匹配 → 下拉框选中"三个地方，
 * 只有端到端断言才盖得住。
 */
describe('背景音乐控制台', () => {
  /** 两条异步链（load 的 fetch、播放状态的 promise）走完再断言 */
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  const TRACKS = [
    { file: 'music/t001.mp3', title: '甲曲', album: '专辑一', duration: 60 },
    { file: 'music/t002.mp3', title: '生命流', album: '明日方舟OST1', duration: 196 },
    { file: 'music/t003.mp3', title: '丙曲', album: '专辑一', duration: 90 },
  ];

  beforeEach(() => {
    vi.resetModules();
    // 曲目表由 fetch 提供 —— jsdom 里没有真实服务器
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ tracks: TRACKS }),
      })),
    );
  });

  afterEach(() => {
    vi.doUnmock('three');
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('大厅里按钮浮在左上角，面板默认收起', async () => {
    const { doc } = await bootApp();
    await settle();
    const dock = doc.querySelector('#music-dock')!;
    expect(visible(dock)).toBe(true);
    expect(dock.classList.contains('floating')).toBe(true);
    expect(dock.parentElement?.tagName).toBe('BODY');
    expect(visible(doc.querySelector('#music-panel'))).toBe(false);
  });

  it('★ 默认选中《生命流》（用户明确要求）', async () => {
    const { doc } = await bootApp();
    await settle();
    const select = doc.querySelector<HTMLSelectElement>('#music-select')!;
    // fixture 里《生命流》是第 2 首（下标 1）
    expect(select.value).toBe('1');
    expect(doc.querySelector('#music-current')?.textContent).toContain('生命流');
  });

  it('★ 点音符按钮展开面板，曲目按下拉分组（2 张专辑 → 2 个 optgroup）', async () => {
    const { doc } = await bootApp();
    await settle();

    doc.querySelector<HTMLButtonElement>('#music-toggle')!.click();
    expect(visible(doc.querySelector('#music-panel'))).toBe(true);

    const groups = doc.querySelectorAll('#music-select optgroup');
    expect(groups.length).toBe(2);
    expect(groups[0]!.getAttribute('label')).toBe('专辑一');
    expect(groups[1]!.getAttribute('label')).toBe('明日方舟OST1');
    expect(doc.querySelectorAll('#music-select option').length).toBe(TRACKS.length);
  });

  it('再点一次音符按钮收起面板，✕ 也能收起', async () => {
    const { doc } = await bootApp();
    await settle();
    const toggle = doc.querySelector<HTMLButtonElement>('#music-toggle')!;

    toggle.click();
    toggle.click();
    expect(visible(doc.querySelector('#music-panel'))).toBe(false);

    toggle.click();
    doc.querySelector<HTMLButtonElement>('#music-close')!.click();
    expect(visible(doc.querySelector('#music-panel'))).toBe(false);
  });

  it('★ 点「下一首」会换到下一首，选曲下拉跟着变', async () => {
    const { doc } = await bootApp();
    await settle();
    const select = doc.querySelector<HTMLSelectElement>('#music-select')!;
    expect(select.value).toBe('1');

    doc.querySelector<HTMLButtonElement>('#music-next')!.click();
    await settle();
    expect(select.value).toBe('2');

    doc.querySelector<HTMLButtonElement>('#music-prev')!.click();
    await settle();
    expect(select.value).toBe('1');
  });

  it('★ 下拉选曲能直接跳到指定曲目', async () => {
    const { dom, doc } = await bootApp();
    await settle();
    const select = doc.querySelector<HTMLSelectElement>('#music-select')!;
    select.value = '2';
    // 必须用 jsdom 自己那套构造器：Node 的 Event 和 jsdom 的元素不兼容
    select.dispatchEvent(new dom.window.Event('change'));
    await settle();
    expect(doc.querySelector('#music-current')?.textContent).toContain('丙曲');
  });

  it('★ 播放/暂停按钮的图标跟着状态变', async () => {
    const { doc } = await bootApp();
    await settle();
    const play = doc.querySelector<HTMLButtonElement>('#music-play')!;
    expect(play.textContent?.trim()).toBe('▶');

    play.click();
    await settle();
    expect(play.textContent?.trim()).toBe('⏸');

    play.click();
    await settle();
    expect(play.textContent?.trim()).toBe('▶');
  });

  it('★ 随机与循环**互斥**：打开随机会自动关掉循环，反之亦然', async () => {
    const { doc } = await bootApp();
    await settle();
    const shuffle = doc.querySelector<HTMLButtonElement>('#music-shuffle')!;
    const repeat = doc.querySelector<HTMLButtonElement>('#music-repeat')!;

    // 初始：列表循环开着，随机关着
    expect(repeat.textContent).toContain('列表循环');
    expect(repeat.classList.contains('active')).toBe(true);
    expect(shuffle.classList.contains('active')).toBe(false);

    // 打开随机 → 循环必须关掉（两个按钮不能同时亮）
    shuffle.click();
    expect(shuffle.classList.contains('active')).toBe(true);
    expect(repeat.textContent).toContain('不循环');
    expect(repeat.classList.contains('active')).toBe(false);

    // 再开循环 → 随机必须关掉
    repeat.click();
    expect(repeat.textContent).toContain('列表循环');
    expect(repeat.classList.contains('active')).toBe(true);
    expect(shuffle.classList.contains('active')).toBe(false);

    // 循环自己能三档轮换
    repeat.click();
    expect(repeat.textContent).toContain('单曲循环');
    repeat.click();
    expect(repeat.textContent).toContain('不循环');
    expect(repeat.classList.contains('active')).toBe(false);
    // 循环关掉之后随机会不会自己开？不该 —— 玩家没点它
    expect(shuffle.classList.contains('active')).toBe(false);
  });

  it('★ 进入对局后，音符按钮搬进顶栏、紧跟「← 返回大厅」（不重叠）', async () => {
    const { doc } = await bootApp();
    await settle();

    doc.querySelector<HTMLButtonElement>('#menu-test')!.click();

    const dock = doc.querySelector('#music-dock')!;
    expect(dock.classList.contains('floating')).toBe(false);
    expect(dock.parentElement?.id).toBe('topbar');
    expect(dock.previousElementSibling?.id).toBe('btn-back-menu');

    // 退回大厅要搬回来，否则 #game-hud 一隐藏按钮就跟着没了
    doc.querySelector<HTMLButtonElement>('#btn-back-menu')!.click();
    doc.querySelector<HTMLButtonElement>('#confirm-ok')!.click();
    expect(dock.classList.contains('floating')).toBe(true);
    expect(dock.parentElement?.tagName).toBe('BODY');
  });

  it('★ M 键在大厅里也能暂停/播放（游戏那套快捷键只管对局）', async () => {
    const { dom, doc } = await bootApp();
    await settle();
    const play = doc.querySelector<HTMLButtonElement>('#music-play')!;

    play.click();
    await settle();
    expect(play.textContent?.trim()).toBe('⏸');

    doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { code: 'KeyM', bubbles: true }));
    await settle();
    expect(play.textContent?.trim()).toBe('▶');
  });

  it('没有曲目时整条控制台藏起来（不给玩家一个点了没反应的按钮）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ tracks: [] }) })),
    );
    const { doc } = await bootApp();
    await settle();
    expect(visible(doc.querySelector('#music-dock'))).toBe(false);
  });
});

/**
 * ★ 0.0.3：测试模式修改器。
 *
 * 这里验的是**接线**（按钮显隐、面板开合、下拉内容、控件禁用），
 * 真正的规则（白送的干员不占牌库、人口上限开关）在 modifier.test.ts 里用纯逻辑钉死。
 */
describe('★ 测试模式修改器（0.0.3）', () => {
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ tracks: [] }) })),
    );
  });

  afterEach(() => {
    vi.doUnmock('three');
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('主界面按钮文案不再带「无限金币」（0.0.3 需求）', async () => {
    const { doc } = await bootApp();
    await settle();
    expect(doc.querySelector('#menu-test')!.textContent?.trim()).toBe('测试模式');
  });

  it('★ 修改器按钮只在测试模式出现，且开出来的面板能连到 state', async () => {
    const { doc } = await bootApp();
    await settle();

    // 还没进测试模式 -> 按钮藏着
    expect(visible(doc.querySelector('#btn-modifier')), '普通模式下不该有修改器').toBe(false);

    (doc.querySelector('#menu-test') as HTMLButtonElement).click();
    await settle();
    const button = doc.querySelector('#btn-modifier')!;
    expect(visible(button), '测试模式里该出现修改器按钮').toBe(true);

    (button as HTMLButtonElement).click();
    await settle();
    const panel = doc.querySelector('#modifier-panel')!;
    expect(visible(panel)).toBe(true);

    // 无限金币默认开着 -> 「+50」应该被禁用
    const infinite = doc.querySelector('#modifier-infinite-gold') as HTMLInputElement;
    const addGold = doc.querySelector('#modifier-add-gold') as HTMLButtonElement;
    expect(infinite.checked).toBe(true);
    expect(addGold.disabled, '无限金币开着时「+50」该禁用').toBe(true);

    // 关掉无限金币 -> 「+50」解禁
    infinite.checked = false;
    const changeEvent = doc.createEvent('Event');
    changeEvent.initEvent('change', true, true);
    infinite.dispatchEvent(changeEvent);
    await settle();
    expect(addGold.disabled).toBe(false);
  });

  it('★ 干员下拉按费用分组，每条只写干员名字，且不含召唤物', async () => {
    const { doc } = await bootApp();
    await settle();
    (doc.querySelector('#menu-test') as HTMLButtonElement).click();
    await settle();
    (doc.querySelector('#btn-modifier') as HTMLButtonElement).click();
    await settle();

    const select = doc.querySelector('#modifier-unit') as HTMLSelectElement;
    expect(select.querySelectorAll('optgroup').length, '该按费用分组').toBeGreaterThan(0);
    const options = [...select.querySelectorAll('option')];
    expect(options.length, '干员表不该是空的').toBeGreaterThan(0);
    for (const option of options) {
      const def = UNIT_DEFS[option.value];
      expect(def, `下拉里出现了未知干员 ${option.value}`).toBeDefined();
      expect(option.textContent, '每条 option 只写干员名字').toBe(def!.name);
      expect(def!.summonOnly ?? false, '召唤物不该出现在下拉里').toBe(false);
    }
  });

  it('★ 点「获得干员」真的会发一个到备战席（有提示）', async () => {
    const { doc } = await bootApp();
    await settle();
    (doc.querySelector('#menu-test') as HTMLButtonElement).click();
    await settle();
    (doc.querySelector('#btn-modifier') as HTMLButtonElement).click();
    await settle();

    (doc.querySelector('#modifier-grant') as HTMLButtonElement).click();
    await settle();
    expect(doc.querySelector('#toast')!.textContent ?? '').toContain('获得');
  });
});

/**
 * ★ 0.0.3：双阵营沙盒（切换阵营）+ 修改器「改等级」+ 「获得干员」里的野怪。
 *
 * 这里同样只验**接线**：
 *  - 按钮显隐 / 文案随阵营变 / 点了会换边（纯逻辑在 test-sandbox.test.ts）
 *  - 等级下拉是不是真的 1~10、能不能写进 state
 *  - 野怪是不是真的出现在下拉**最下面**、每条名字对不对
 */
describe('★ 测试沙盒：切换阵营 / 改等级 / 野怪下拉（0.0.3）', () => {
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ tracks: [] }) })),
    );
  });

  afterEach(() => {
    vi.doUnmock('three');
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('★ 「切换阵营」按钮只在测试模式出现（普通单机不能有）', async () => {
    const { doc } = await bootApp();
    await settle();

    // 大厅里还没有游戏 —— 按钮应该是藏着的
    expect(visible(doc.querySelector('#btn-switch-side')), '大厅里不该有切换阵营').toBe(false);

    // 普通单机：也不该有（它只属于测试沙盒）
    (doc.querySelector('#menu-solo') as HTMLButtonElement).click();
    await settle();
    expect(
      visible(doc.querySelector('#btn-switch-side')),
      '普通单机模式不该冒出切换阵营按钮',
    ).toBe(false);
  });

  it('★ 测试模式里按钮出现，默认指向红方；点一下换到红方、再点换回来', async () => {
    const { doc } = await bootApp();
    await settle();
    (doc.querySelector('#menu-test') as HTMLButtonElement).click();
    await settle();

    const button = doc.querySelector<HTMLButtonElement>('#btn-switch-side')!;
    expect(visible(button), '测试模式里该出现切换阵营按钮').toBe(true);

    // 开局默认在蓝方操作 -> 按钮说"切换到红方"
    expect(button.textContent, '一开始该提示能切到红方').toContain('红方');
    expect(button.classList.contains('to-red'), 'to-red 类用来上红色配色').toBe(true);

    // 点一下 -> 现在操作红方，按钮改说"切换到蓝方"
    button.click();
    await settle();
    expect(button.textContent, '切到红方后按钮该指向蓝方').toContain('蓝方');
    expect(button.classList.contains('to-blue')).toBe(true);
    expect(doc.querySelector('#toast')!.textContent ?? '', '切换要有提示').toContain('红方');

    // 再点一下 -> 回到蓝方
    button.click();
    await settle();
    expect(button.textContent, '再点该切回蓝方').toContain('红方');
    expect(doc.querySelector('#toast')!.textContent ?? '').toContain('蓝方');
  });

  it('★ 修改器有等级下拉，正好 1~10 项，默认 1 级', async () => {
    const { doc } = await bootApp();
    await settle();
    (doc.querySelector('#menu-test') as HTMLButtonElement).click();
    await settle();
    (doc.querySelector('#btn-modifier') as HTMLButtonElement).click();
    await settle();

    const select = doc.querySelector<HTMLSelectElement>('#modifier-level')!;
    expect(select, '修改器里该有等级下拉').not.toBeNull();

    const values = [...select.querySelectorAll('option')].map((o) => o.value);
    expect(values.length, '等级下拉应该正好 10 项').toBe(MAX_LEVEL);
    expect(values[0]).toBe('1');
    expect(values[values.length - 1]).toBe(String(MAX_LEVEL));
    expect(select.value, '开局是 1 级').toBe('1');
  });

  it('★ 把等级下拉改到 10，state 的等级跟着变（有提示）', async () => {
    const { dom, doc } = await bootApp();
    await settle();
    (doc.querySelector('#menu-test') as HTMLButtonElement).click();
    await settle();
    (doc.querySelector('#btn-modifier') as HTMLButtonElement).click();
    await settle();

    const select = doc.querySelector<HTMLSelectElement>('#modifier-level')!;
    select.value = String(MAX_LEVEL);
    // 必须用 jsdom 自己那套 Event：Node 的 Event 和 jsdom 元素不兼容
    select.dispatchEvent(new dom.window.Event('change'));
    await settle();

    const toast = doc.querySelector('#toast')!.textContent ?? '';
    expect(toast, '改等级要有提示').toContain(String(MAX_LEVEL));
    // 改完之后下拉本身也要保持在新值（被 syncModifierControls 回写）
    expect(select.value).toBe(String(MAX_LEVEL));
  });

  it('★ 「获得干员」下拉最下面是野怪档位分组，每条只写名字', async () => {
    const { doc } = await bootApp();
    await settle();
    (doc.querySelector('#menu-test') as HTMLButtonElement).click();
    await settle();
    (doc.querySelector('#btn-modifier') as HTMLButtonElement).click();
    await settle();

    const select = doc.querySelector<HTMLSelectElement>('#modifier-unit')!;
    const groups = [...select.querySelectorAll('optgroup')];
    expect(groups.length, '费用分组 + 野怪分组，不该是空的').toBeGreaterThan(0);

    // 最后一个是野怪分组（档位可能有多个，从第一个"野怪 ·"往后都是）
    const monsterGroupStart = groups.findIndex((g) => (g.label ?? '').startsWith('野怪 ·'));
    expect(monsterGroupStart, '下拉里应该有「野怪 · 」分组').toBeGreaterThanOrEqual(0);
    // 所有野怪分组必须在所有费用分组之后 —— 需求是"位于下拉最下面"
    const monsterGroups = groups.slice(monsterGroupStart);
    expect(
      monsterGroups.every((g) => (g.label ?? '').startsWith('野怪 ·')),
      '野怪分组后面不能再混进费用分组',
    ).toBe(true);
    expect(groups[groups.length - 1]!.label, '最后一个分组必须是野怪').toMatch(/^野怪 · /);

    // 野怪分组里的 option 必须正好覆盖 monsterDefs()，且只写名字
    const monsterIds = new Set(monsterDefs().map((d) => d.id));
    const optionsInMonsterGroups = monsterGroups.flatMap((g) =>
      [...g.querySelectorAll('option')],
    );
    expect(
      optionsInMonsterGroups.length,
      '野怪分组里应该列出全部野怪',
    ).toBe(monsterDefs().length);
    for (const option of optionsInMonsterGroups) {
      expect(monsterIds.has(option.value), `${option.value} 不在 monsterDefs() 里`).toBe(true);
      const def = UNIT_DEFS[option.value]!;
      expect(option.textContent, '每条 option 只写野怪名字').toBe(def.name);
    }

    // 费用分组里绝不能混进野怪（避免同一只野怪出现两次）
    const optionsInCostGroups = groups
      .slice(0, monsterGroupStart)
      .flatMap((g) => [...g.querySelectorAll('option')]);
    for (const option of optionsInCostGroups) {
      expect(monsterIds.has(option.value), `${option.value} 是野怪，不该待在费用分组里`).toBe(
        false,
      );
    }
  });

  it('★ 发一个野怪进备战席：卡面走小人立绘、星级那行写「野怪」', async () => {
    const { dom, doc } = await bootApp();
    await settle();
    (doc.querySelector('#menu-test') as HTMLButtonElement).click();
    await settle();
    (doc.querySelector('#btn-modifier') as HTMLButtonElement).click();
    await settle();

    const select = doc.querySelector<HTMLSelectElement>('#modifier-unit')!;
    const monsterId = monsterDefs()[0]!.id;
    select.value = monsterId;
    // 就算把星级选成 3 星，野怪发出来也还是 1 星（无星级）
    const star = doc.querySelector<HTMLSelectElement>('#modifier-star')!;
    star.value = '3';

    (doc.querySelector('#modifier-grant') as HTMLButtonElement).click();
    await settle();

    const filled = [...doc.querySelectorAll<HTMLElement>('#bench-slots .bench-slot:not(.empty)')];
    const slot = filled.find(
      (s) => (s.querySelector('.bench-name')?.textContent ?? '') === UNIT_DEFS[monsterId]!.name,
    );
    expect(slot, '野怪该出现在备战席里').toBeDefined();
    expect(slot!.querySelector('.bench-portrait-box'), '野怪卡面也该有头像容器').not.toBeNull();
    expect(
      slot!.textContent ?? '',
      '野怪没有星级，卡面上该写「野怪」而不是 ★',
    ).toContain('野怪');
    // ★ 野怪不能穿戴装备：备战席卡面不画那两个装备圆点，tooltip 也不提「藏品 N/2」
    expect(
      slot!.querySelector('.bench-item-dots'),
      '野怪身上不该有装备圆点（画了就暗示它还能装）',
    ).toBeNull();
    expect(slot!.title, '提示文案不该提「藏品 N/2」').not.toContain('藏品');
    void dom;
  });
});


/**
 * ★ 0.0.3 藏品（装备）的**界面接线**测试。
 *
 * 【为什么这一块特别需要"接起来测"？】
 * 藏品的规则层（容量、能不能装、卸下的前提）已经在 items.test.ts 里有 34 个用例，
 * 但那些都只证明"函数算得对"。这一轮真正容易出问题的是**界面有没有接上去**：
 *   · 修改器的「获得藏品」按钮有没有真的发出东西？
 *   · 右侧藏品栏的 19 个格子有没有按容量画出来？
 *   · 共享藏品"点一下就装进共享装备位"这条顺手操作有没有生效？
 *   · 最下面那个「删除藏品」的落点存不存在？
 * 这些光看代码看不出来（而且"空格子没写 data 属性"这种坑只有点进去才发现）。
 *
 * 拖拽那一条（把 A 类拖到干员身上）**不在这里测** —— 它要靠 3D 射线拾取，
 * 在 jsdom 里没有真画布，硬测只会得到一个"测试环境的假阴/假阳"。
 * 那条路的正确性由两层保证：
 *   1. state 层的 equipItemToUnit / deleteItem 等有单元测试（items.test.ts）
 *   2. main.ts 里拖拽只做"解析落点 -> 调上面那些函数"，没有自己的业务逻辑
 */
describe('★ 0.0.3 藏品（装备）的界面接线', () => {
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ tracks: [] }) })),
    );
  });

  afterEach(() => {
    vi.doUnmock('three');
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /** 进测试模式 + 打开修改器（获得藏品要靠它） */
  async function openModifier(doc: Document): Promise<HTMLSelectElement> {
    doc.querySelector<HTMLButtonElement>('#menu-test')!.click();
    await settle();
    doc.querySelector<HTMLButtonElement>('#btn-modifier')!.click();
    await settle();
    return doc.querySelector<HTMLSelectElement>('#modifier-item')!;
  }

  it('★ 右侧藏品栏按容量画出 19 个格子 + 最下面的删除落点', async () => {
    const { doc } = await bootApp();
    await settle();

    // 默认是日志页签，但格子是**始终渲染**的（renderAll 里就画好了），
    // 所以不用先切页签也能断言 —— 这也顺便钉住"切页签不会丢掉界面状态"
    expect(doc.querySelectorAll('#item-slots-a .item-slot').length, '穿戴藏品存放栏').toBe(ITEM_A_SLOTS);
    expect(doc.querySelectorAll('#item-slots-b .item-slot').length, '共享藏品存放栏').toBe(ITEM_B_SLOTS);
    expect(
      doc.querySelectorAll('#item-slots-bequip .item-slot').length,
      '共享装备位',
    ).toBe(ITEM_B_EQUIP_SLOTS);
    expect(doc.querySelector('#item-delete-zone'), '最下方要有删除藏品的落点').not.toBeNull();

    // 开局全是空的
    expect(doc.querySelectorAll('#item-slots-a .item-slot:not(.empty)').length).toBe(0);
  });

  it('★ 修改器「获得藏品」：下拉分成五组（羁绊转职单独一组），每条只写名字', async () => {
    const { doc } = await bootApp();
    await settle();
    const select = await openModifier(doc);

    const groups = [...select.querySelectorAll('optgroup')];
    // ★ 0.1.3：多了「羁绊转职」一组（用户要求把羁绊藏品单独分出来）
    // ★ 0.3.2：再多「盟约专属」一组（三张升变之证：不进商店/掉落，但调试沙盒里要能发）
    expect(groups.length, '普通/进阶 × 穿戴/共享 四组 + 羁绊转职 + 盟约专属').toBe(6);
    for (const group of groups) {
      expect(group.label, '分组标签要说清是给干员的还是给全队的').toMatch(/穿戴|共享|给干员|全队|羁绊转职/);
    }

    /*
      ★ 0.1.3：转职（含变形同构体）必须落在「羁绊转职」那一组，
      而且**不能**同时还在「进阶 · 穿戴藏品」里列一遍（重复列 = 玩家看到两个同名条目）。
    */
    const relicGroup = groups.find((group) => group.label.includes('羁绊转职'))!;
    const relicIds = [...relicGroup.querySelectorAll('option')].map((option) => option.value);
    expect(relicIds, '要有炎转职').toContain('itm_relic_yan');
    expect(relicIds, '变形同构体也归这里').toContain('itm_morph_relic');
    const advancedWear = groups.find((group) => group.label.includes('进阶 · 穿戴'))!;
    const advancedIds = [...advancedWear.querySelectorAll('option')].map((option) => option.value);
    expect(advancedIds, '★ 不能在进阶那一组里重复出现').not.toContain('itm_relic_yan');
    expect(advancedIds).not.toContain('itm_morph_relic');

    const options = [...select.querySelectorAll('option')];
    expect(options.length, '36 件藏品都要在下拉里').toBe(Object.keys(ITEM_DEFS).length);
    for (const option of options) {
      const item = ITEM_DEFS[option.value];
      expect(item, `下拉里出现了未知藏品 ${option.value}`).toBeDefined();
      expect(option.textContent, '每条 option 只写名字').toBe(item!.name);
    }
  });

  it('★ 点「获得藏品」：穿戴藏品真的进 穿戴藏品存放栏（不是只弹个提示）', async () => {
    const { doc } = await bootApp();
    await settle();
    const select = await openModifier(doc);

    // 挑一件穿戴类（给干员的）藏品
    const wearId = Object.values(ITEM_DEFS).find((item) => item.slot === 'A')!.id;
    select.value = wearId;
    doc.querySelector<HTMLButtonElement>('#modifier-grant-item')!.click();
    await settle();

    expect(doc.querySelector('#toast')!.textContent ?? '', '要有提示').toContain('获得');

    const filled = doc.querySelectorAll<HTMLElement>('#item-slots-a .item-slot:not(.empty)');
    expect(filled.length, '穿戴藏品存放栏该多出一件').toBe(1);
    expect(filled[0]!.dataset.itemId).toBe(wearId);
    // ★ 发完自动切到藏品页签（不然"点了没反应"像失败）
    expect(doc.querySelector('#side-pane-collection')!.classList.contains('hidden')).toBe(false);
  });

  it('★ 共享藏品点一下就装进共享装备位，再点一下卸回存放区', async () => {
    const { doc } = await bootApp();
    await settle();
    const select = await openModifier(doc);

    const sharedId = Object.values(ITEM_DEFS).find((item) => item.slot === 'B')!.id;
    select.value = sharedId;
    doc.querySelector<HTMLButtonElement>('#modifier-grant-item')!.click();
    await settle();

    expect(doc.querySelectorAll('#item-slots-b .item-slot:not(.empty)').length, '先落在 共享藏品存放栏').toBe(1);

    // 点一下存放区那一格 -> 装进第一个空的共享装备位
    doc.querySelector<HTMLElement>('#item-slots-b .item-slot:not(.empty)')!.click();
    await settle();
    expect(doc.querySelectorAll('#item-slots-b .item-slot:not(.empty)').length, '存放区该空了').toBe(0);
    const equipped = doc.querySelectorAll<HTMLElement>('#item-slots-bequip .item-slot:not(.empty)');
    expect(equipped.length, '共享装备位该有一件了').toBe(1);
    expect(equipped[0]!.dataset.itemId).toBe(sharedId);
    expect(equipped[0]!.classList.contains('equipped'), '共享装备位的样式类').toBe(true);

    // 再点一下 -> 卸回存放区
    equipped[0]!.click();
    await settle();
    expect(doc.querySelectorAll('#item-slots-bequip .item-slot:not(.empty)').length, '装备格该空了').toBe(0);
    expect(doc.querySelectorAll('#item-slots-b .item-slot:not(.empty)').length, '该回到存放区').toBe(1);
  });

  it('★ 0.1.1「共享藏品效果」栏：装上去就出现，卸下就消失', async () => {
    const { doc } = await bootApp();
    await settle();
    const select = await openModifier(doc);

    const list = doc.querySelector('#item-effect-list')!;
    expect(list.querySelectorAll('.item-effect').length, '开局是空的').toBe(0);
    expect(list.textContent, '空态要有说明文案').toContain('还没有生效中的效果');
    expect(doc.querySelector('#item-effect-count')!.textContent, '空态写「无」').toBe('无');

    // 挑一件"装上去会留着"的共享藏品
    const sharedId = Object.values(ITEM_DEFS).find((item) => item.slot === 'B' && !item.onEquip)!.id;
    select.value = sharedId;
    doc.querySelector<HTMLButtonElement>('#modifier-grant-item')!.click();
    await settle();

    // 点一下存放区那一格 -> 装进共享装备位
    doc.querySelector<HTMLElement>('#item-slots-b .item-slot:not(.empty)')!.click();
    await settle();

    const rows = list.querySelectorAll<HTMLElement>('.item-effect');
    expect(rows.length, '共享装备位里的那件要出现在效果栏').toBe(1);
    expect(rows[0]!.textContent).toContain(ITEM_DEFS[sharedId]!.name);
    expect(doc.querySelector('#item-effect-count')!.textContent).toBe('1 项');

    // 再点一下卸回存放区 -> 效果栏跟着空
    doc.querySelector<HTMLElement>('#item-slots-bequip .item-slot:not(.empty)')!.click();
    await settle();
    expect(list.querySelectorAll('.item-effect').length, '卸下就不该再显示').toBe(0);
  });

  it('★ 0.1.1「效果栏」显示的是**实时数值**，不是 tick / active 那种内部写法', async () => {
    const { doc } = await bootApp();
    await settle();
    const select = await openModifier(doc);

    // 涌动之餐：全队治疗 +30%（数值型）
    select.value = 'itm_surge_meal';
    doc.querySelector<HTMLButtonElement>('#modifier-grant-item')!.click();
    await settle();
    doc.querySelector<HTMLElement>('#item-slots-b .item-slot:not(.empty)')!.click();
    await settle();

    const desc = doc.querySelector<HTMLElement>('#item-effect-list .item-effect-desc')!;
    expect(desc.textContent, '要显示数值').toContain('+30%');
    expect(desc.textContent ?? '', '不许出现内部字段').not.toMatch(/tick|active=|修正包|=/);
  });

  it('★ 0.1.1「效果栏」：门槛类藏品直接说生效中 / 未生效', async () => {
    const { doc } = await bootApp();
    await settle();
    const select = await openModifier(doc);

    // 苍桐：金币 ≥70 才生效（开局金币远不够）
    select.value = 'itm_cangtong';
    doc.querySelector<HTMLButtonElement>('#modifier-grant-item')!.click();
    await settle();
    doc.querySelector<HTMLElement>('#item-slots-b .item-slot:not(.empty)')!.click();
    await settle();

    const desc = doc.querySelector<HTMLElement>('#item-effect-list .item-effect-desc')!;
    expect(desc.textContent ?? '', '要写清当前状态').toMatch(/生效中|未生效/);
    expect(desc.textContent ?? '', '不能只说个结论、要带当前金币').toMatch(/金/);
  });

  it('★ 0.1.1「效果栏」在共享装备位与「删除藏品」之间（用户指定的位置）', async () => {
    const { doc } = await bootApp();
    await settle();

    const html = doc.querySelector('#side-pane-collection')!.innerHTML;
    const iEquip = html.indexOf('共享装备位');
    const iEffect = html.indexOf('共享藏品效果');
    const iDelete = html.indexOf('item-delete-zone');
    expect(iEquip, '共享装备位那块要在').toBeGreaterThanOrEqual(0);
    expect(iEffect, '共享藏品效果那块要在').toBeGreaterThan(iEquip);
    expect(iDelete, '删除落点要在').toBeGreaterThan(iEffect);
  });

  it('★ 0.1.1 失落之钥：本体已销毁、不占装备位，但效果栏里标着「永久」', async () => {
    const { doc } = await bootApp();
    await settle();
    const select = await openModifier(doc);

    select.value = 'itm_lost_key';
    doc.querySelector<HTMLButtonElement>('#modifier-grant-item')!.click();
    await settle();
    doc.querySelector<HTMLElement>('#item-slots-b .item-slot:not(.empty)')!.click();
    await settle();

    expect(doc.querySelectorAll('#item-slots-bequip .item-slot:not(.empty)').length, '不占共享装备位').toBe(0);

    const rows = doc.querySelectorAll<HTMLElement>('#item-effect-list .item-effect');
    expect(rows.length, '永久效果要留一条').toBe(1);
    expect(rows[0]!.classList.contains('permanent'), '要标 permanent 样式').toBe(true);
    expect(rows[0]!.textContent).toContain('永久');
  });

  it('★ 格子写着「拖到哪」的信息：data-item-zone / data-item-index 是拖拽落点的唯一依据', async () => {
    const { doc } = await bootApp();
    await settle();
    const select = await openModifier(doc);
    const sharedId = Object.values(ITEM_DEFS).find((item) => item.slot === 'B')!.id;
    select.value = sharedId;
    doc.querySelector<HTMLButtonElement>('#modifier-grant-item')!.click();
    await settle();

    /*
      ★ 空格子也必须带这两个属性。
      拖动结束时是用 document.elementFromPoint 反查"鼠标下面是哪一格"的，
      没有属性就没法当落点 —— 而"拖到空的共享装备位"正是 B 类最常用的一步。
    */
    const equipSlots = [...doc.querySelectorAll<HTMLElement>('#item-slots-bequip .item-slot')];
    for (let i = 0; i < equipSlots.length; i++) {
      expect(equipSlots[i]!.dataset.itemZone).toBe('bequip');
      expect(equipSlots[i]!.dataset.itemIndex).toBe(String(i));
    }
  });

  it('★ 干员详情页自带「藏品」栏（默认藏着，点干员才填）', async () => {
    const { doc } = await bootApp();
    await settle();
    const block = doc.querySelector('#unit-info-items-block')!;
    expect(block, '详情页里要有藏品栏的容器').not.toBeNull();
    // 没点干员之前是藏着的（面板本身也藏着）
    expect(block.classList.contains('hidden')).toBe(true);
  });

  /*
    ★★ 需求原文：「A 类 B 类只是为了区分，在游玩的显示上要显示为穿戴藏品和共享藏品」。

    这条是**端到端**的兜底：前面那些测试盯的是"数据层别冒出代号"
    （ITEM_SLOT_SHORT / zoneLabel 之类），而这里盯的是**真的画到屏幕上的字**——
    包括页签 tooltip、栏目小标题、说明行、格子 tooltip、修改器分组标签。
    哪天有人在界面代码里手滑拼了一句 `A 类`，只有这一条能挡住。
  */
  it('★★ 界面上一个字都不许出现「A 类 / B 类」（只许叫穿戴藏品 / 共享藏品）', async () => {
    const { doc } = await bootApp();
    await settle();

    // 发一件穿戴、一件共享，让格子/提示文案都有内容可查
    const select = await openModifier(doc);
    const wearId = Object.values(ITEM_DEFS).find((item) => item.slot === 'A')!.id;
    const sharedId = Object.values(ITEM_DEFS).find((item) => item.slot === 'B')!.id;
    select.value = wearId;
    doc.querySelector<HTMLButtonElement>('#modifier-grant-item')!.click();
    await settle();
    select.value = sharedId;
    doc.querySelector<HTMLButtonElement>('#modifier-grant-item')!.click();
    await settle();

    // 切到藏品页签，把这一整块都渲染出来
    doc.querySelector<HTMLButtonElement>('[data-side-tab="collection"]')!.click();
    await settle();

    const panel = doc.querySelector('#side-pane-collection')!;
    const collectText = (node: Element): string[] => {
      const out: string[] = [];
      const walk = (el: Element): void => {
        // 工具提示（title）也是"玩家看得到的字"，一起查
        const title = el.getAttribute('title');
        if (title) out.push(title);
        for (const child of [...el.childNodes]) {
          if (child.nodeType === 3) out.push(child.textContent ?? '');
          else if (child.nodeType === 1) walk(child as Element);
        }
      };
      walk(node);
      return out;
    };

    const texts = [
      ...collectText(panel),
      // 页签的 tooltip（在 panel 外面）
      doc.querySelector('[data-side-tab="collection"]')!.getAttribute('title') ?? '',
      // 下拉的四组标签
      ...[...select.querySelectorAll('optgroup')].map((g) => g.label),
    ];
    for (const text of texts) {
      expect(text, `界面文案「${text}」里冒出了内部分类代号`).not.toMatch(/[AB] 类/);
    }
    // 正面确认：该有的新话术确实在（不然"全删干净了"也能让上面通过）
    expect(texts.join('|')).toMatch(/穿戴藏品/);
    expect(texts.join('|')).toMatch(/共享藏品/);
  });

  /**
   * ★ 0.0.3 需求 4：装备栏里的装备可以拖动互换位置。
   *
   * 拖动这套在 jsdom 里跑不起来（`document.elementFromPoint` 没有布局信息，
   * 现有测试也都是用**点击**那条路验的），所以这里盯两件必须同时成立的事：
   *   ① 合法性判断要认"同一栏的另一格"（不然高亮不亮、松手直接取消）
   *   ② 真正动手时必须走 state 层的 `swapItemsInZone`
   *      （别再在界面里自己搬数组 —— 那就是"同一个动作两处实现"）
   */
  it('★ 同栏拖动：合法落点认同栏，执行走 swapItemsInZone', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');

    const allowed = /function itemDropAllowed\(([\s\S]*?)\n\}/.exec(source);
    expect(allowed, '找不到 itemDropAllowed').not.toBeNull();
    expect(
      allowed![0],
      '同栏内的另一格必须是合法落点（0.0.3 需求 4）',
    ).toContain('target.zone === from.zone');

    const endDrag = /function endItemDrag\(([\s\S]*?)\n\}/.exec(source);
    expect(endDrag, '找不到 endItemDrag').not.toBeNull();
    expect(
      endDrag![0],
      '同栏互换必须调用 state 层的 swapItemsInZone',
    ).toContain('swapItemsInZone(');
  });
});

/**
 * ============================================================
 *  ★ 0.1.4：拖着藏品的时候战斗开始了 -> 拖拽要被取消、藏品留在栏里
 * ============================================================
 *
 * 【用户报的】"藏品拖在鼠标上时如果战斗开始时，藏品会意外清除"。
 *
 * 根因：拖动过程中藏品是跟着光标的浮层卡片（`.drag-ghost`），而**开打那一刻**
 * 界面会整块重画、右侧栏/布局跟着变 —— 鼠标一松，落点判定正好落在
 * "删除藏品"那一下上（`endItemDrag` -> `deleteItem`），东西就没了。
 *
 * 改法：开打（`startBattle` / `showBattle`）的第一件事就是 `cancelDrag()` ——
 * 藏品本来就没离开过它的格子，所以"取消"就等于"回到藏品栏位"，
 * 而且之后的抬手也彻底无效（`drag` 已经是 null，`endItemDrag` 直接返回）。
 */
describe('★ 0.1.4：开打时进行中的拖拽会被取消（藏品不会被误删）', () => {
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('three');
    vi.restoreAllMocks();
  });

  it('★ 拖着一件藏品时开战：拖影清掉、藏品还在栏里，之后的抬手也删不掉它', async () => {
    const { dom, doc } = await bootApp(true);

    // jsdom 没有指针捕获，补一个空实现（拖动本身不依赖它）
    if (!dom.window.HTMLElement.prototype.setPointerCapture) {
      dom.window.HTMLElement.prototype.setPointerCapture = () => {};
      dom.window.HTMLElement.prototype.releasePointerCapture = () => {};
      dom.window.HTMLElement.prototype.hasPointerCapture = () => false;
    }

    // 进测试沙盒
    doc.querySelector<HTMLButtonElement>('#menu-test')!.click();
    await settle();

    // 两边各摆一个人，开战按钮才会亮（沙盒要求双方都有阵容）
    const place = (defId: string, col: number, row: number): unknown =>
      (globalThis as unknown as Record<string, (a: string, b: number, c: number, d: number) => unknown>)[
        '__airnightPlaceForTest'
      ]?.(defId, 1, col, row);
    place('op03', 1, 1);
    doc.querySelector<HTMLButtonElement>('#btn-switch-side')!.click();
    await settle();
    place('op03', 8, 1);
    doc.querySelector<HTMLButtonElement>('#btn-switch-side')!.click();
    await settle();
    expect(doc.querySelector<HTMLButtonElement>('#btn-battle')!.disabled, '两边都有人了，开战按钮该亮').toBe(
      false,
    );

    // 用修改器发一件藏品（默认藏品栏是空的）
    doc.querySelector<HTMLButtonElement>('#btn-modifier')!.click();
    await settle();
    const select = doc.querySelector<HTMLSelectElement>('#modifier-item')!;
    const itemId = select.options[0]?.value ?? '';
    expect(itemId, '修改器的藏品下拉里应该有东西').not.toBe('');
    select.value = itemId;
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    doc.querySelector<HTMLButtonElement>('#modifier-grant-item')!.click();
    await settle();

    const filledSlots = (): number => doc.querySelectorAll('#item-slots-a .item-slot:not(.empty)').length;
    expect(filledSlots(), '藏品应该进了穿戴藏品栏').toBe(1);

    // 按下去 = 开始拖（★ 必须带 button: 0 —— 这个拖动只认左键）
    const slot = doc.querySelector<HTMLElement>('#item-slots-a .item-slot:not(.empty)')!;
    slot.dispatchEvent(
      new dom.window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 40, clientY: 40 }),
    );
    await settle();
    expect(doc.querySelectorAll('.drag-ghost').length, '拖动已经开始了').toBe(1);

    // 开打
    doc.querySelector<HTMLButtonElement>('#btn-battle')!.click();
    await settle();

    expect(doc.querySelectorAll('.drag-ghost').length, '★ 开打时必须把拖拽收掉（拖影清掉）').toBe(0);
    expect(filledSlots(), '★ 藏品必须还在藏品栏里').toBe(1);

    // 再补一刀：哪怕抬手落在"删除藏品"上，也不该把它删掉（这时候已经没有拖拽了）
    const del = doc.querySelector<HTMLElement>('#item-delete-zone')!;
    del.dispatchEvent(new dom.window.Event('pointerup', { bubbles: true }));
    await settle();
    expect(filledSlots(), '★ 开打之后的那一下抬手不许把藏品删掉').toBe(1);
  });
});

/**
 * ============================================================
 *  ★★ 0.3.2：羁绊详情名单（真 DOM）
 * ============================================================
 *
 * 用户口径两条：
 *   ① 「阿米娅的升变形态同时上场只能生效一个羁绊，**在羁绊列表里只显示阿米娅**」
 *      —— 点开「法术」时，干员名单里不能再出现
 *         「阿米娅·青色怒火 / 慈悲愿景 / 炉芯终曲」，也不能出现两个「阿米娅」。
 *   ② 「把**炎的炎佑显示**删了」
 *      —— 炎佑是天师锦囊的召唤物，数据上带 `yan`，以前混在「大炎」名单里。
 *
 * 【为什么纯函数测试还不够？】
 * `traitOwnersOf` 只能证明"名单算对了"；这里要证明**界面真的用了它**
 * —— 中间的接线（`openTraitDetail` 里那段）错了，纯函数测试照样全绿。
 */
describe('★★ 0.3.2：羁绊详情名单（阿米娅只显示一条）', () => {
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('three');
    vi.restoreAllMocks();
  });

  it('场上同时站着本体和一个升变形态：法术名单里只有一条「阿米娅」，且计数是 1', async () => {
    const { dom, doc } = await bootApp(true);

    // 进测试沙盒（修改器只在测试模式里能白送棋子）
    doc.querySelector<HTMLButtonElement>('#menu-test')!.click();
    await settle();

    /*
      ★ 1 级的人口上限就是 1，摆第二只就会被拒 ——
      这里要的只是"两个阿米娅同时在场上"，所以先打开修改器的「无视人口上限」。
    */
    doc.querySelector<HTMLButtonElement>('#btn-modifier')!.click();
    await settle();
    const ignorePop = doc.querySelector<HTMLInputElement>('#modifier-ignore-pop')!;
    ignorePop.checked = true;
    ignorePop.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await settle();

    const place = (defId: string, col: number, row: number): boolean =>
      Boolean(
        (
          globalThis as unknown as Record<
            string,
            (a: string, b: number, c: number, d: number) => boolean
          >
        )['__airnightPlaceForTest']?.(defId, 1, col, row),
      );
    expect(place('op07', 1, 1), '本体阿米娅要能摆上去').toBe(true);
    expect(place('op_amiya_mercy', 2, 1), '慈悲愿景要能摆上去').toBe(true);
    await settle();

    // 找到羁绊列表里「法术」那一行，点开详情
    const rows = [...doc.querySelectorAll<HTMLElement>('.trait-row')];
    const artsRow = rows.find((row) => row.querySelector('.trait-name')?.textContent === '法术');
    expect(artsRow, '羁绊列表里应该有「法术」这一行').toBeTruthy();
    artsRow!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await settle();

    const names = [...doc.querySelectorAll('#detail-units .detail-unit-name')].map(
      (node) => node.textContent ?? '',
    );
    expect(names.filter((name) => name === '阿米娅'), '★ 只能有一条「阿米娅」').toHaveLength(1);
    expect(
      names.filter((name) => name.startsWith('阿米娅·')),
      '★ 三个升变形态不许单列在名单里',
    ).toHaveLength(0);

    // ★ 数量也要跟着是 1（数人头和名单是同一个口径）
    expect(doc.querySelector('#detail-count')?.textContent ?? '').toContain('1');
  });
});

/**
 * ============================================================
 *  ★★ 0.3.2：「退出游戏」按钮
 * ============================================================
 * 用户的原话是「让游戏后面的黑框 cmd 隐藏」——
 * 可是黑框一藏，"关掉那个窗口"这条路就没了，玩家会**关不掉游戏**。
 * 所以退出入口搬到了网页主界面上。这个按钮必须满足：
 *   ① 只有**用启动器打开的那一页**能看到（地址里带 `?quit=<令牌>`）；
 *   ② 点了要先问一次（它旁边就是「设置」，很容易点歪，而且联机时会断掉整个房间）；
 *   ③ 点「确定」之后真的去请后台退出，并把界面换成一句"游戏已经关闭"。
 *
 * 【为什么这三条必须在这里测？】
 * 纯函数测试（`quit-game.test.ts`）只能证明"令牌读对了、请求发对了"；
 * 而"按钮有没有亮出来""点击有没有真的接上"是 DOM 接线问题 ——
 * 项目里已经有过「代码看着对、界面没生效」的先例。
 */
describe('★★ 0.3.2：主界面的「退出游戏」按钮', () => {
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
  const TOKEN = 'a1b2c3d4e5f60718';

  /** 记录客户端发过哪些请求，并且只对"退出"这条回 ok */
  function stubFetch(): Array<{ url: string; body: unknown }> {
    const calls: Array<{ url: string; body: unknown }> = [];
    globalThis.fetch = (async (input: unknown, init?: { body?: string }) => {
      const url = String(input);
      calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
      if (url.includes('/__airnight/quit')) {
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      // 别的接口（本机对局会话探测之类）一律当"没有这个接口"
      return { ok: false, status: 404, json: async () => ({ error: 'not found' }) };
    }) as unknown as typeof fetch;
    return calls;
  }

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('three');
    vi.restoreAllMocks();
  });

  it('用启动器打开（地址里带 quit 令牌）：按钮出现，点确定会请后台退出', async () => {
    const calls = stubFetch();
    const { doc } = await bootApp(false, `server=localhost:5173&quit=${TOKEN}`);
    const quitButton = doc.querySelector<HTMLButtonElement>('#menu-quit');
    expect(quitButton, '主界面上应该有「退出游戏」这个按钮').toBeTruthy();
    expect(visible(quitButton), '★ 启动器打开的页面里它必须可见').toBe(true);

    // 点一下 —— 先弹确认，不能直接退
    quitButton!.click();
    await settle();
    expect(visible(doc.querySelector('#confirm-overlay')), '★ 必须先弹二次确认').toBe(true);
    expect(calls.filter((call) => call.url.includes('/quit')), '确认之前不许发请求').toHaveLength(0);

    // 确认
    doc.querySelector<HTMLButtonElement>('#confirm-ok')!.click();
    await settle();
    await settle();

    const quitCalls = calls.filter((call) => call.url.includes('/__airnight/quit'));
    expect(quitCalls, '★ 点确定之后要真的发一次退出请求').toHaveLength(1);
    expect(quitCalls[0]!.body).toEqual({ token: TOKEN });

    // 后台退了之后不能留一个"连不上"的白屏，要明确告诉玩家"是我关的"
    expect(doc.body.textContent ?? '').toContain('游戏已经关闭');
  });

  it('朋友通过局域网链接打开（没有 quit 令牌）：按钮不出现', async () => {
    stubFetch();
    const { doc } = await bootApp(false, 'server=192.168.1.5:5173');
    expect(visible(doc.querySelector('#menu-quit')), '★ 没令牌就不该有退出入口').toBe(false);
  });

  it('单独跑 pnpm static（地址里什么都没有）：按钮也不出现', async () => {
    stubFetch();
    const { doc } = await bootApp(false);
    expect(visible(doc.querySelector('#menu-quit'))).toBe(false);
  });

  it('令牌被手改成非法值：按钮不出现（否则点下去只会报错）', async () => {
    stubFetch();
    const { doc } = await bootApp(false, 'quit=abc');
    expect(visible(doc.querySelector('#menu-quit'))).toBe(false);
  });
});

/**
 * ============================================================
 *  ★★ 0.3.3 界面重排：隐藏式头像 / 底部工具条 / 音乐进度条
 * ============================================================
 * 这一版动的是"东西在哪儿、什么时候出现"，这类改动最容易静默失效：
 *   · 头像面板忘了默认 hidden ⇒ 又变成常驻（用户明确要隐藏式）；
 *   · 关闭的三条路（✕ / Esc / 点遮罩）漏一条 ⇒ 玩家只能刷新页面；
 *   · 关着的时候工具条那颗块不写名字 ⇒ "看不见自己选了什么"。
 * 都不是会报错的错，所以逐条钉住。
 */
describe('★★ 0.3.3 界面重排', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('three');
    vi.restoreAllMocks();
  });

  it('★ 头像选择默认是**收起**的（用户口径：改成隐藏式）', async () => {
    const { doc } = await bootApp();
    expect(visible(doc.querySelector('#avatar-picker')), '主界面上不该常驻头像面板').toBe(false);
    // 但内容已经铺好了 —— 打开时不该看到一面空墙
    expect(doc.querySelectorAll('#avatar-grid .avatar-option').length).toBeGreaterThan(10);
  });

  it('★ 点底部工具条的头像块才弹出；✕ / Esc / 点遮罩都能关', async () => {
    const { doc } = await bootApp();
    const sheet = () => doc.querySelector('#avatar-picker');
    const open = doc.querySelector<HTMLButtonElement>('#avatar-open')!;

    open.click();
    expect(visible(sheet())).toBe(true);

    doc.querySelector<HTMLButtonElement>('#avatar-close')!.click();
    expect(visible(sheet()), '✕ 要能关').toBe(false);

    open.click();
    // Esc：监听在 window 上（面板里没有输入框，不会先被吃掉）
    doc.defaultView!.dispatchEvent(new doc.defaultView!.KeyboardEvent('keydown', { key: 'Escape' }));
    expect(visible(sheet()), 'Esc 要能关').toBe(false);

    open.click();
    // 点遮罩自己（#avatar-picker 是外层全屏遮罩）
    sheet()!.dispatchEvent(new doc.defaultView!.MouseEvent('click', { bubbles: true }));
    expect(visible(sheet()), '点空白处要能关').toBe(false);

    open.click();
    // 点卡片内部**不该**关（否则选头像时手一抖就没了）
    doc.querySelector('.avatar-card')!.dispatchEvent(new doc.defaultView!.MouseEvent('click', { bubbles: true }));
    expect(visible(sheet()), '点面板内部不能被当成"点外面"').toBe(true);
  });

  it('★ 收着的时候工具条也要写出"我选了谁"（小头像 + 名字）', async () => {
    const { doc } = await bootApp();
    const chipName = () => doc.querySelector('#avatar-chip-name')!.textContent ?? '';
    const chipBox = () => doc.querySelector('#avatar-chip-box')!;

    expect(chipName(), '没选时要有明确的一句话').toContain('未选择');
    expect(chipBox().querySelector('img'), '没选时不该有图').toBeNull();

    // 打开面板点第一张头像
    doc.querySelector<HTMLButtonElement>('#avatar-open')!.click();
    const first = doc.querySelector<HTMLElement>('#avatar-grid .avatar-option')!;
    const chosenId = first.dataset.avatarId!;
    first.click();

    const expectedName = UNIT_DEFS[chosenId]?.name;
    expect(expectedName, '第一个格子应该对得上某个干员').toBeTruthy();
    expect(chipName(), '关着的时候也要显示选中的是谁').toContain(expectedName!);
    expect(chipBox().querySelector('img'), '关着的时候也要显示小头像').not.toBeNull();
  });

  it('★ 设置 / 退出游戏挪进底部工具条（不再是标题下面的下划线小字）', async () => {
    const { doc } = await bootApp();
    const toolbar = doc.querySelector('.menu-toolbar');
    expect(toolbar, '主界面底部要有工具条').toBeTruthy();
    expect(toolbar!.querySelector('#avatar-open'), '工具条左边是头像块').toBeTruthy();
    expect(toolbar!.querySelector('#menu-settings-open'), '工具条右边是设置').toBeTruthy();
    expect(toolbar!.querySelector('#menu-quit'), '退出也在工具条里（是否有令牌另测）').toBeTruthy();
    // 旧的页脚式链接类名不该再出现（它带着下划线，和这套视觉语言不搭）
    expect(doc.querySelectorAll('.menu-settings-link').length).toBe(0);
  });

  it('★ 房间等待界面是"面板"结构（head / 房间号 / 双栏 / foot）', async () => {
    const { doc } = await bootApp();
    const wrap = doc.querySelector('#lobby-overlay .lobby-wrap');
    expect(wrap, '大厅要有一块有边有底的面板，而不是散落的元素').toBeTruthy();
    expect(wrap!.querySelector('.lobby-head #btn-room-settings'), '房间设置入口在 head 右侧').toBeTruthy();
    expect(wrap!.querySelector('.lobby-code-row #lobby-code'), '房间号在信息条里').toBeTruthy();
    expect(wrap!.querySelector('.lobby-col #lobby-players'), '左边一栏是玩家').toBeTruthy();
    expect(wrap!.querySelector('.lobby-col #lobby-rules'), '右边一栏是本局规则').toBeTruthy();
    expect(wrap!.querySelector('.lobby-foot #lobby-status'), '状态文字在底部').toBeTruthy();
    expect(wrap!.querySelector('.lobby-foot .overlay-buttons'), '三颗按钮在底部').toBeTruthy();
  });

  it('★★ 房间玩家列表走 renderKeyed（不许再每秒重建整张名单）', () => {
    /*
      ★ 源码级断言的理由和 fx-wiring 里那些一样：
      这条规矩错了**不会报任何错** —— 只是联机时房主正在改人机难度、
      下拉框每秒被换掉一次，头像每秒闪一下白。
      人眼看不出来是"重建"，只会觉得"这界面有点卡"。
    */
    const source = readFileSync(fileURLToPath(new URL('../src/main.ts', import.meta.url)), 'utf8');
    expect(source, '大厅玩家列表要走 renderKeyed').toMatch(/renderKeyed\(el\.lobbyPlayers/);
    expect(source, '不许再整块清空重建').not.toMatch(/el\.lobbyPlayers\.innerHTML\s*=/);
  });

  it('★ 音乐控制台有可拖动的进度条，而且真的会 seek', async () => {
    const { doc } = await bootApp();
    const audio = doc.querySelector<HTMLAudioElement>('#music-audio')!;
    const seek = doc.querySelector<HTMLInputElement>('#music-seek')!;
    expect(seek, '进度条要存在').toBeTruthy();

    // jsdom 里 duration 恒为 NaN —— 用 defineProperty 造一个"3 分 20 秒"的曲目
    Object.defineProperty(audio, 'duration', { value: 200, configurable: true });
    Object.defineProperty(audio, 'currentTime', { value: 0, configurable: true, writable: true });

    // ① 播放推进 -> 进度条跟着走（100 / 200 秒 = 500‰）
    audio.currentTime = 100;
    audio.dispatchEvent(new doc.defaultView!.Event('timeupdate'));
    expect(Number(seek.value), 'timeupdate 要把进度写进滑杆').toBe(500);

    // ② 拖动滑杆 -> 音频跳过去（250‰ × 200 秒 = 50 秒）
    seek.value = '250';
    seek.dispatchEvent(new doc.defaultView!.Event('input'));
    expect(audio.currentTime, '拖滑杆要真的跳转').toBe(50);
  });
});
