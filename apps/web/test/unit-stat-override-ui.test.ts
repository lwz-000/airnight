/**
 * ============================================================
 *  ★ 0.1.2 测试模式：「数值修改」的界面接线
 * ============================================================
 *
 * 【用户原话】
 *   "在测试模式中的修改器中添加数值修改按键，打开后布阵阶段点击干员不再弹出详情页，
 *    而是弹出干员基础属性面板，并可以修改，修改完点击保存可以修改这个干员
 *    （单个干员卡片，不是单种干员）在本次测试模式中的数值。"
 *
 * 【为什么这条必须做界面级测试？】
 * 因为它整条链路都是"接线"：开关 -> 点击分支 -> 面板 -> 保存 -> 内核。
 * 任何一环漏了都会表现成"功能没生效"，而纯逻辑测试一个都发现不了
 * （数值覆盖本身在 packages/shared/test/unit-stat-override.test.ts 里单独验了）。
 *
 * 【jsdom 点不到 3D 棋盘怎么办？】
 * 客户端有个 `?debug=1` 才装的 `__airnightClickCell(col, row)`，
 * 它调的就是真实点击那条分支（handleBoardClick）—— 不是另写一份判断。
 * 所以"点干员弹哪个面板"这件事在无头环境里也能钉住。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { playableDefs } from '../../../packages/shared/src/index.js';

const indexHtml = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');

type DebugHooks = {
  __airnightPlaceForTest: (defId: string, star: number, col: number, row: number) => boolean;
  __airnightClickCell: (col: number, row: number) => void;
};

/** 2D 画布桩：jsdom 没有 canvas 实现，只需要"不报错" */
const contextStub = new Proxy(
  {},
  {
    get: (_target, prop) => {
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
        return () => ({ addColorStop: () => undefined });
      }
      if (prop === 'getImageData' || prop === 'createImageData') {
        return () => ({ data: new Uint8ClampedArray([0, 0, 0, 0]) });
      }
      if (prop === 'measureText') return () => ({ width: 10 });
      return () => undefined;
    },
    set: () => true,
  },
);

/** 上一条测试留下的 jsdom：下一轮先关掉（旧实例的 rAF 循环会污染新文档） */
let openDom: JSDOM | null = null;

/**
 * 装环境 + 进测试模式 + 在 (0,0) 放一只干员。
 * ★ 用 `?debug=1` 起 —— 只有它才会装 `__airnight*` 那几个测试钩子。
 */
async function bootWithUnit(defId: string): Promise<{
  doc: Document;
  hooks: DebugHooks;
}> {
  openDom?.window.close();
  openDom = null;

  const dom = new JSDOM(indexHtml, { url: 'http://localhost:5173/?debug=1', pretendToBeVisual: true });
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
    WebSocket: window.WebSocket,
    localStorage: window.localStorage,
    sessionStorage: window.sessionStorage,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
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
      /*
        ★ `?debug=1` 会装棋盘探针（installBoardProbe），它要读 renderer 的 context
        （为了算清屏颜色 / 像素探针）。桩里少了这个方法，一进游戏就报
        "renderer.getContext is not a function" —— 而报错完全看不出是桩缺方法。
      */
      getContext(): unknown {
        return contextStub;
      }
    }
    return { ...actual, WebGLRenderer: StubRenderer };
  });

  await import('../src/main.js');

  const doc = window.document;
  // 进测试模式（双阵营沙盒）
  doc.querySelector<HTMLButtonElement>('#menu-test')!.click();
  await settle();

  const hooks = globalThis as unknown as DebugHooks;
  expect(typeof hooks.__airnightPlaceForTest, '需要 ?debug=1 的测试钩子').toBe('function');
  // 把干员发到备战席再摆到棋盘上（走的是界面同一份 placeBenchUnitAt）
  expect(hooks.__airnightPlaceForTest(defId, 1, 0, 0), '摆子失败').toBe(true);
  await settle();
  return { doc, hooks };
}

/** 等一小会儿，让 rAF / 事件回调跑完 */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

const visible = (element: Element | null): boolean =>
  Boolean(element && !element.classList.contains('hidden'));

/** 面板里某个数值输入框 */
function fieldInput(doc: Document, key: string): HTMLInputElement {
  return doc.querySelector<HTMLInputElement>(`#unit-edit-rows input[data-field="${key}"]`)!;
}

const DEF_ID = playableDefs().slice().sort((a, b) => a.cost - b.cost)[0]!.id;

/**
 * 派发一次 change 事件。
 * ★ 为什么不能直接 `new Event('change')`？因为要派发的元素属于 **jsdom 那个 realm**，
 * 而 `Event` 是全局（Node 的）。跨 realm 构造出来的事件在 jsdom 里不可靠 ——
 * 统一从 `doc.defaultView` 上取构造函数，跟浏览器里"事件由同一个 window 造"一致。
 */
function fireChange(doc: Document, element: Element): void {
  const ctor = (doc.defaultView as unknown as { Event: new (type: string) => Event }).Event;
  element.dispatchEvent(new ctor('change'));
}

describe('★ 0.1.2 测试模式「数值修改」', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('three');
    vi.restoreAllMocks();
  });

  it('★ 默认（没开数值修改）：点干员弹的是详情页，不是属性面板', async () => {
    const { doc, hooks } = await bootWithUnit(DEF_ID);
    hooks.__airnightClickCell(0, 0);
    await settle();

    expect(visible(doc.querySelector('#unit-info')), '默认点干员要看详情').toBe(true);
    expect(visible(doc.querySelector('#unit-edit')), '没开数值修改时不该弹属性面板').toBe(false);
  });

  it('★ 开关打开后：点干员不弹详情页，改弹基础属性面板（两块面板互斥）', async () => {
    const { doc, hooks } = await bootWithUnit(DEF_ID);

    // 修改器 -> 数值修改
    doc.querySelector<HTMLButtonElement>('#btn-modifier')!.click();
    await settle();
    const toggle = doc.querySelector<HTMLInputElement>('#modifier-stat-edit')!;
    expect(toggle, '修改器里必须有「数值修改」这一项').toBeTruthy();
    toggle.checked = true;
    fireChange(doc, toggle);
    await settle();

    hooks.__airnightClickCell(0, 0);
    await settle();

    expect(visible(doc.querySelector('#unit-edit')), '开着数值修改时点干员要弹属性面板').toBe(true);
    expect(
      visible(doc.querySelector('#unit-info')),
      '★ 用户明确要求：这时候**不要**弹详情页（两块面板会互相挡）',
    ).toBe(false);

    // 6 个可改字段都在，而且初值是白板值（正整数 / 正攻速）
    for (const key of ['hp', 'attackDamage', 'attackSpeed', 'armor', 'magicResist', 'range']) {
      const input = fieldInput(doc, key);
      expect(input, `缺少字段 ${key}`).toBeTruthy();
      expect(Number(input.value), `${key} 的初值应该是数字`).toBeGreaterThan(0);
    }
  });

  it('★ 保存后真的改到这张卡上（关掉开关、再打开详情页能读到新数值）', async () => {
    const { doc, hooks } = await bootWithUnit(DEF_ID);
    const toggle = doc.querySelector<HTMLInputElement>('#modifier-stat-edit')!;
    doc.querySelector<HTMLButtonElement>('#btn-modifier')!.click();
    toggle.checked = true;
    fireChange(doc, toggle);
    await settle();

    hooks.__airnightClickCell(0, 0);
    await settle();
    fieldInput(doc, 'hp').value = '8888';
    fieldInput(doc, 'attackDamage').value = '321';
    doc.querySelector<HTMLButtonElement>('#unit-edit-save')!.click();
    await settle();

    expect(visible(doc.querySelector('#unit-edit')), '保存之后面板要收起来').toBe(false);

    // 关掉开关 -> 点同一格 -> 应该是详情页，而且数值是刚改的那份
    toggle.checked = false;
    fireChange(doc, toggle);
    await settle();
    hooks.__airnightClickCell(0, 0);
    await settle();

    expect(visible(doc.querySelector('#unit-info'))).toBe(true);
    const stats = doc.querySelector('#unit-info-stats')!.textContent ?? '';
    expect(stats, '★ 详情页必须显示改过之后的血量（说明覆盖进了内核，不是只改了界面）').toContain('8888');
    expect(stats, '攻击力也要跟着改').toContain('321');
  });

  it('★ 再打开面板时输入框是上次填的数（否则会以为没保存成功）', async () => {
    const { doc, hooks } = await bootWithUnit(DEF_ID);
    const toggle = doc.querySelector<HTMLInputElement>('#modifier-stat-edit')!;
    doc.querySelector<HTMLButtonElement>('#btn-modifier')!.click();
    toggle.checked = true;
    fireChange(doc, toggle);
    await settle();

    hooks.__airnightClickCell(0, 0);
    await settle();
    fieldInput(doc, 'hp').value = '7777';
    doc.querySelector<HTMLButtonElement>('#unit-edit-save')!.click();
    await settle();

    hooks.__airnightClickCell(0, 0);
    await settle();
    expect(fieldInput(doc, 'hp').value, '重新打开要回填上次保存的值').toBe('7777');
    expect(
      doc.querySelector('#unit-edit-sub')!.textContent,
      '面板上要标出这张卡已经被改过',
    ).toContain('已改过');
  });

  it('★ 「恢复白板」把这张卡还原（不是还要再点一次保存）', async () => {
    const { doc, hooks } = await bootWithUnit(DEF_ID);
    const toggle = doc.querySelector<HTMLInputElement>('#modifier-stat-edit')!;
    doc.querySelector<HTMLButtonElement>('#btn-modifier')!.click();
    toggle.checked = true;
    fireChange(doc, toggle);
    await settle();

    hooks.__airnightClickCell(0, 0);
    await settle();
    fieldInput(doc, 'hp').value = '6666';
    doc.querySelector<HTMLButtonElement>('#unit-edit-save')!.click();
    await settle();

    hooks.__airnightClickCell(0, 0);
    await settle();
    doc.querySelector<HTMLButtonElement>('#unit-edit-reset')!.click();
    await settle();
    expect(visible(doc.querySelector('#unit-edit')), '恢复白板之后面板也要收起来').toBe(false);

    // 走详情页确认真的还原了
    toggle.checked = false;
    fireChange(doc, toggle);
    await settle();
    hooks.__airnightClickCell(0, 0);
    await settle();
    const stats = doc.querySelector('#unit-info-stats')!.textContent ?? '';
    expect(stats, '不该再有 6666 了').not.toContain('6666');
  });

  it('★ 越界输入会报错且**不保存**（不是静默改写成边界值）', async () => {
    const { doc, hooks } = await bootWithUnit(DEF_ID);
    const toggle = doc.querySelector<HTMLInputElement>('#modifier-stat-edit')!;
    doc.querySelector<HTMLButtonElement>('#btn-modifier')!.click();
    toggle.checked = true;
    fireChange(doc, toggle);
    await settle();

    hooks.__airnightClickCell(0, 0);
    await settle();
    fieldInput(doc, 'hp').value = '0';
    doc.querySelector<HTMLButtonElement>('#unit-edit-save')!.click();
    await settle();

    expect(visible(doc.querySelector('#unit-edit')), '报错时面板要留着让你改').toBe(true);
    expect(doc.querySelector('#unit-edit-error')!.textContent ?? '').toContain('生命');
  });

  /*
    ============================================================
    ★★ 0.1.2 末修：用户报的"在蓝方改完数值、切到红方之后数值复原了"
    ============================================================
    两个真根因（都在"改过之后"再回到这张卡时冒出来）：

    ① **"数据表原值"的基准取错了**：open/save 都拿 `unitBasePanelOf()`
       （**含覆盖**）当基准。于是改过 8888 的卡再打开、什么都别动、按一次保存 ——
       填的值等于这个假基准 ⇒ 被判成"等于原值" ⇒ 从覆盖表里删掉 ⇒ 数值当场退回白板。
       顺带：输入框 tooltip 写"数据表原值：8888"（其实是改过的值）、行上的"已改过"也标不出来。
    ② **点面板外面直接丢弃未保存的输入**：切阵营的按钮也在这条路径上，
       刚填还没按保存的数字被悄悄丢掉 —— 玩家看到的就是"改完，一切阵营就复原"。

    下面三条把这两条的**后果**钉死（改回去就红）。
  */
  it('★ 改完数值 -> 重开面板原样保存 -> 数值不该退回白板（基准要用数据表原值）', async () => {
    const { doc, hooks } = await bootWithUnit(DEF_ID);
    const toggle = doc.querySelector<HTMLInputElement>('#modifier-stat-edit')!;
    doc.querySelector<HTMLButtonElement>('#btn-modifier')!.click();
    toggle.checked = true;
    fireChange(doc, toggle);
    await settle();

    hooks.__airnightClickCell(0, 0);
    await settle();
    const trueHp = fieldInput(doc, 'hp').value; // 第一次打开面板 = 数据表原值
    fieldInput(doc, 'hp').value = '8888';
    doc.querySelector<HTMLButtonElement>('#unit-edit-save')!.click();
    await settle();

    // 重开面板：tooltip 仍要写**数据表原值**，行上要标出"改过"
    hooks.__airnightClickCell(0, 0);
    await settle();
    expect(fieldInput(doc, 'hp').value, '输入框要回填改过的值').toBe('8888');
    expect(fieldInput(doc, 'hp').title, 'tooltip 说的是数据表原值，不是改过的值').toBe(
      `数据表原值：${trueHp}`,
    );
    expect(
      fieldInput(doc, 'hp').closest('.unit-edit-row')?.classList.contains('changed'),
      '改过的项要有 changed 标记',
    ).toBe(true);

    // 一个键都不动，直接保存 —— 这正是"数值复原"的触发点
    doc.querySelector<HTMLButtonElement>('#unit-edit-save')!.click();
    await settle();

    toggle.checked = false;
    fireChange(doc, toggle);
    await settle();
    hooks.__airnightClickCell(0, 0);
    await settle();
    expect(doc.querySelector('#unit-info-stats')!.textContent, '原样保存不该把数值改回白板').toContain('8888');
  });

  it('★ 面板里填了数字但没按保存，点外面（切阵营）要落盘而不是丢掉', async () => {
    const { doc, hooks } = await bootWithUnit(DEF_ID);
    const toggle = doc.querySelector<HTMLInputElement>('#modifier-stat-edit')!;
    doc.querySelector<HTMLButtonElement>('#btn-modifier')!.click();
    toggle.checked = true;
    fireChange(doc, toggle);
    await settle();

    hooks.__airnightClickCell(0, 0);
    await settle();
    fieldInput(doc, 'hp').value = '9999'; // 只填，不保存

    // 真实点「切换到红方」：pointerdown 会先跑到"点面板外面"的兜底逻辑
    const btn = doc.querySelector<HTMLButtonElement>('#btn-switch-side')!;
    const EventCtor = (doc.defaultView as unknown as { Event: new (type: string) => Event }).Event;
    btn.dispatchEvent(new EventCtor('pointerdown'));
    btn.click();
    await settle();
    await settle();
    // 切回蓝方，再看那张卡
    btn.click();
    await settle();
    await settle();
    hooks.__airnightClickCell(0, 0);
    await settle();
    expect(fieldInput(doc, 'hp').value, '没按保存也该落盘（否则就是"切阵营后数值复原"）').toBe('9999');
  });

  it('★ 把值填回数据表原值 -> 覆盖才真的删掉（原来的语义要保留）', async () => {
    const { doc, hooks } = await bootWithUnit(DEF_ID);
    const toggle = doc.querySelector<HTMLInputElement>('#modifier-stat-edit')!;
    doc.querySelector<HTMLButtonElement>('#btn-modifier')!.click();
    toggle.checked = true;
    fireChange(doc, toggle);
    await settle();

    hooks.__airnightClickCell(0, 0);
    await settle();
    const trueHp = fieldInput(doc, 'hp').value;
    fieldInput(doc, 'hp').value = '8888';
    doc.querySelector<HTMLButtonElement>('#unit-edit-save')!.click();
    await settle();

    hooks.__airnightClickCell(0, 0);
    await settle();
    fieldInput(doc, 'hp').value = trueHp; // 手填回原值 = 不算改过
    doc.querySelector<HTMLButtonElement>('#unit-edit-save')!.click();
    await settle();

    toggle.checked = false;
    fireChange(doc, toggle);
    await settle();
    hooks.__airnightClickCell(0, 0);
    await settle();
    const stats = doc.querySelector('#unit-info-stats')!.textContent ?? '';
    expect(stats, '填回原值就该真的恢复白板').toContain(trueHp);
    expect(stats, '不该再留着 8888').not.toContain('8888');
  });
});
