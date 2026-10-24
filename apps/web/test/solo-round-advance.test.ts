/**
 * ============================================================
 *  ★★ 单机：打完一回合，回合要能自己推进（端到端）
 * ============================================================
 *
 * 【为什么要一条这么"慢"的测试？】
 * 用户报的是"战斗回合结束后不会结束，不会正常进行回合切换" ——
 * 根因在**回放循环里的收尾判断**（`shouldFinishBattle` 的口径）：
 * 单机 / 测试沙盒里 `viewingBattleId` 恒为 null，而 0.1.2 为了修"旁观别人的战斗"
 * 把收尾条件写成了"必须是在看自己那场"，于是单机**永远收不了尾** ——
 * 战斗播完停在战斗画面、回合号永远停在 1。
 *
 * 这条判断的纯函数部分在 prep-rules.test.ts 里单测了；但"真的会推进回合"
 * 还牵着一整条链（回放播完 -> finishBattle -> phase=result -> 2.6 秒后 nextRound
 * -> round+1 -> 回到布阵）。只有真开一局、真等它打完才能盖住，
 * 所以这里允许慢一点：把倍速开到最大，最多等 30 秒。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { playableDefs } from '../../../packages/shared/src/index.js';

const indexHtml = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
type Hooks = { __airnightPlaceForTest: (d: string, s: number, c: number, r: number) => boolean };
const contextStub = new Proxy({}, { get: (_t, p) => {
  if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => ({ addColorStop: () => undefined });
  if (p === 'getImageData' || p === 'createImageData') return () => ({ data: new Uint8ClampedArray([0, 0, 0, 0]) });
  if (p === 'measureText') return () => ({ width: 10 });
  return () => undefined;
}, set: () => true });
let openDom: JSDOM | null = null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function boot() {
  openDom?.window.close(); openDom = null;
  const dom = new JSDOM(indexHtml, { url: 'http://localhost:5173/?debug=1', pretendToBeVisual: true });
  openDom = dom;
  const { window } = dom;
  const globals: Record<string, unknown> = {
    window, document: window.document, navigator: window.navigator, location: window.location,
    HTMLElement: window.HTMLElement, HTMLCanvasElement: window.HTMLCanvasElement, HTMLImageElement: window.Image,
    Image: window.Image, WebSocket: window.WebSocket, localStorage: window.localStorage, sessionStorage: window.sessionStorage,
    requestAnimationFrame: window.requestAnimationFrame.bind(window), cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  };
  for (const [k, v] of Object.entries(globals)) {
    const d = Object.getOwnPropertyDescriptor(globalThis, k);
    if (d && !d.writable && !d.set) continue;
    try { Object.defineProperty(globalThis, k, { value: v, writable: true, configurable: true }); } catch { /* ignore */ }
  }
  window.HTMLCanvasElement.prototype.getContext = (() => contextStub) as never;
  vi.doMock('three', async () => {
    const actual = await vi.importActual<typeof import('three')>('three');
    class Stub { domElement = window.document.createElement('canvas'); shadowMap = { enabled: false };
      setPixelRatio(): void {} setClearColor(): void {} setSize(): void {} setViewport(): void {}
      setScissor(): void {} setScissorTest(): void {} render(): void {} dispose(): void {}
      getContext(): unknown { return contextStub; } }
    return { ...actual, WebGLRenderer: Stub };
  });
  await import('../src/main.js');
  const doc = window.document;
  doc.querySelector<HTMLButtonElement>('#menu-solo')!.click();
  await sleep(30);
  const hooks = globalThis as unknown as Hooks;
  const def = playableDefs().slice().sort((a, b) => b.cost - a.cost)[0]!;
  expect(hooks.__airnightPlaceForTest(def.id, 2, 2, 4), '摆子失败').toBe(true);
  await sleep(30);
  return { doc };
}

describe('单机回合推进（端到端）', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => { vi.doUnmock('three'); vi.restoreAllMocks(); });

  it('打完第一回合后，round 应该自己变成 2（战斗播完 -> 收尾 -> 进下一回合）', async () => {
    const { doc } = await boot();
    // 开到最快倍速，别让测试等一分钟
    const speeds = doc.querySelectorAll<HTMLButtonElement>('#speed-group button');
    speeds[speeds.length - 1]!.click();
    await sleep(30);

    doc.querySelector<HTMLButtonElement>('#btn-battle')!.click();
    const phaseLog: string[] = [];
    let advanced = false;
    for (let i = 0; i < 120; i++) {
      await sleep(250);
      const phase = doc.querySelector('#stat-phase')?.textContent ?? '';
      const round = doc.querySelector('#stat-round')?.textContent ?? '';
      if (phaseLog[phaseLog.length - 1] !== `${round}/${phase}`) phaseLog.push(`${round}/${phase}`);
      if (round === '2') { advanced = true; break; }
    }
    console.log('[单机推进] 过程 =', phaseLog.join(' -> '));
    console.log('[单机推进] 最终 round =', doc.querySelector('#stat-round')?.textContent, ' 阶段 =', doc.querySelector('#stat-phase')?.textContent);
    expect(advanced, '回合应该自己推进到第 2 回合').toBe(true);
  }, 40000);
});
