/**
 * ============================================================
 *  ★ 0.2 维什戴尔 3 星「爆裂黎明」—— 红黑 5×5 爆炸（渲染层）
 * ============================================================
 *
 * 【这一组钉的是什么？】
 * 图是美术/脚本出的，代码这一侧真正容易错的只有五件事：
 *  1. **尺寸**：平面必须正好铺 5 格（说几格就画几格；画大了玩家会以为范围更大）；
 *  2. **图层**：必须和锏的刀光同一档（`RENDER_ORDER_FX`）——
 *     否则爆炸会被棋子卡面随机盖住（用户原话："贴图图层位置，不是特效的位置"）；
 *  3. **混合方式**：黑烟必须走**普通混合**（加色混合下纯黑 = 完全看不见），
 *     火焰两层走加色。这三行写错了画面直接废掉，而且很难靠肉眼归因；
 *  4. **帧指针不能共享**：同时两次爆炸不能互相拽进度（但底图只该传一次显卡）；
 *  5. **贴图没加载好时不许炸一半**（只有烟没有火比不炸更难看）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdditiveBlending, NormalBlending } from 'three';
import { CELL } from '../src/game/grid.js';
import { RENDER_ORDER_FX, RENDER_ORDER_STARS } from '../src/three/card-layout.js';

/** 一张"假装已经加载好"的图（jsdom 里图是加载不出来的） */
const fakeImage = { width: 1024, height: 1024, src: 'fake://vishdal' };

/** 打桩素材层：让 `getLoadedImage` / `loadImage` 都直接给上面那张假图 */
async function loadModule() {
  vi.doMock('../src/three/assets.js', () => ({
    getLoadedImage: () => fakeImage,
    loadImage: async () => fakeImage,
  }));
  return import('../src/three/vishdal-bloom.js');
}

/** 不打桩素材层（= jsdom 里真实情况：图片一张都没到） */
async function loadModuleNoAssets() {
  vi.doMock('../src/three/assets.js', () => ({
    getLoadedImage: () => null,
    loadImage: async () => null,
  }));
  return import('../src/three/vishdal-bloom.js');
}

beforeEach(() => {
  vi.resetModules();
});

describe('★ 维什戴尔爆炸：拨帧与透明度（纯函数）', () => {
  it('10 帧摊在 0..1 上，最后一帧只在真正播完时出现', async () => {
    const { bloomFrameAt, BLOOM_FRAMES } = await loadModule();
    expect(BLOOM_FRAMES).toBe(10);
    expect(bloomFrameAt(0)).toBe(0);
    expect(bloomFrameAt(0.05)).toBe(0);
    expect(bloomFrameAt(0.1)).toBe(1);
    expect(bloomFrameAt(0.55)).toBe(5);
    expect(bloomFrameAt(0.999)).toBe(9);
    expect(bloomFrameAt(1)).toBe(9);
  });

  it('★ 一次性爆炸：进度越界不许回绕到第 0 帧（那会"炸完又从头炸一遍"）', async () => {
    const { bloomFrameAt } = await loadModule();
    expect(bloomFrameAt(1.5)).toBe(9);
    expect(bloomFrameAt(99)).toBe(9);
    expect(bloomFrameAt(-1)).toBe(0);
    expect(bloomFrameAt(Number.NaN)).toBe(0);
  });

  it('★ 尾巴留 15% 收尾（帧是跳的，直接播完会"啪"地消失）', async () => {
    const { bloomOpacityAt } = await loadModule();
    expect(bloomOpacityAt(0)).toBe(1);
    expect(bloomOpacityAt(0.5)).toBe(1);
    expect(bloomOpacityAt(0.85)).toBe(1);
    expect(bloomOpacityAt(0.925)).toBeCloseTo(0.5, 2);
    expect(bloomOpacityAt(1)).toBe(0);
  });
});

describe('★ 维什戴尔爆炸：注册表（数据表里的 fx 字符串 -> 用哪几层图）', () => {
  it('★ 三层：黑烟 + 火焰主层 + 中心炸点', async () => {
    const { BLOOM_FX } = await loadModule();
    const layers = BLOOM_FX['vishdal_bloom']!;
    expect(layers.length).toBe(3);
    expect(layers.map((layer) => layer.path)).toEqual([
      'fx/vishdal_bloom_smoke.png',
      'fx/vishdal_bloom_ring.png',
      'fx/vishdal_bloom_core.png',
    ]);
  });

  it('★★ 黑烟走**普通混合**、火焰两层走**加色**（这是整套的关键）', async () => {
    const { BLOOM_FX } = await loadModule();
    const [smoke, ring, core] = BLOOM_FX['vishdal_bloom']!;
    expect(
      smoke!.blending,
      '★ 加色混合下纯黑 = 什么都不加 = 完全看不见；黑烟必须是普通混合',
    ).toBe(NormalBlending);
    expect(ring!.blending).toBe(AdditiveBlending);
    expect(core!.blending).toBe(AdditiveBlending);
  });

  it('★ 铺满的两层跨度 1.0、中心炸点只占一小块；叠放顺序 烟 < 火 < 核', async () => {
    const { BLOOM_FX } = await loadModule();
    const [smoke, ring, core] = BLOOM_FX['vishdal_bloom']!;
    expect(smoke!.spanRatio).toBe(1);
    expect(ring!.spanRatio).toBe(1);
    expect(core!.spanRatio).toBeLessThan(0.5);
    expect(smoke!.lift).toBeLessThan(ring!.lift);
    expect(ring!.lift).toBeLessThan(core!.lift);
  });

  it('没注册的名字直接不炸（不会画出个空白的东西来）', async () => {
    const { BLOOM_FX } = await loadModule();
    expect(BLOOM_FX['不存在的特效']).toBeUndefined();
  });
});

describe('★ 维什戴尔爆炸：造一次爆炸', () => {
  it('★ 平面正好铺 5 格（radius 2 = 周围两格）；核只占 42%', async () => {
    const { createBloomFx, BLOOM_FX } = await loadModule();
    const fx = createBloomFx({ x: 1, z: 2, radius: 2, fx: 'vishdal_bloom', y: 0 })!;
    expect(fx).toBeTruthy();
    expect(fx.holder.position.x).toBe(1);
    expect(fx.holder.position.z).toBe(2);

    const spanCells = 2 * 2 + 1; // radius 2 -> 5 格
    const full = spanCells * CELL;
    const [smoke, ring, core] = fx.parts;
    for (const part of [smoke!, ring!]) {
      const size = (part.geometry.parameters as { width: number }).width;
      expect(size, '★ 说几格就画几格：正好 5 格').toBeCloseTo(full, 4);
    }
    const coreSize = (core!.geometry.parameters as { width: number }).width;
    expect(coreSize).toBeCloseTo(full * BLOOM_FX['vishdal_bloom']![2]!.spanRatio, 4);
  });

  it('★ 半径变了尺寸跟着变（radius 1 = 3×3，不是死写 5 格）', async () => {
    const { createBloomFx } = await loadModule();
    const fx = createBloomFx({ x: 0, z: 0, radius: 1, fx: 'vishdal_bloom', y: 0 })!;
    const size = (fx.parts[0]!.geometry.parameters as { width: number }).width;
    expect(size).toBeCloseTo(3 * CELL, 4);
  });

  it('★★ 图层等级和锏的刀光完全一样（RENDER_ORDER_FX），且都贴地', async () => {
    const { createBloomFx } = await loadModule();
    const fx = createBloomFx({ x: 0, z: 0, radius: 2, fx: 'vishdal_bloom', y: 0 })!;
    for (const part of fx.parts) {
      expect(part.mesh.renderOrder, '★ 必须压过所有棋子精灵').toBe(RENDER_ORDER_FX);
      expect(part.mesh.renderOrder, '★ 比星级那一层还高').toBeGreaterThan(RENDER_ORDER_STARS);
      expect(part.mesh.rotation.x, '★ -90° 才贴地（否则是竖着插在地上）').toBeCloseTo(
        -Math.PI / 2,
        6,
      );
      expect(part.material.blending, '烟用普通、火用加色：不可能出现别的').toSatisfy(
        (blending: number) => blending === NormalBlending || blending === AdditiveBlending,
      );
    }
  });

  it('★ 每一层的帧指针是独立的，但底图只共享一份（不会把 3 MB 的图传两遍）', async () => {
    const { createBloomFx } = await loadModule();
    const a = createBloomFx({ x: 0, z: 0, radius: 2, fx: 'vishdal_bloom', y: 0 })!;
    const b = createBloomFx({ x: 3, z: 0, radius: 2, fx: 'vishdal_bloom', y: 0 })!;

    const aRing = a.parts[1]!.texture;
    const bRing = b.parts[1]!.texture;
    expect(aRing, '两次爆炸不能共用同一个帧指针').not.toBe(bRing);
    expect(aRing.source, '★ 但底图（GPU 上传的那份）是共享的').toBe(bRing.source);

    // 拨 a 的进度，b 的不能被拽走
    const { applyBloomFrame } = await loadModule();
    applyBloomFrame(a, 1);
    expect(aRing.offset.x).toBeCloseTo(9 / 10, 6);
    expect(bRing.offset.x, '★ b 的进度不该被 a 改掉').toBe(0);
    expect(aRing.repeat.x).toBeCloseTo(1 / 10, 6);
  });

  it('★ 拨帧只改 offset.x（横向序列帧的排法），repeat 一直是 1/帧数', async () => {
    const { createBloomFx, applyBloomFrame } = await loadModule();
    const fx = createBloomFx({ x: 0, z: 0, radius: 2, fx: 'vishdal_bloom', y: 0 })!;
    applyBloomFrame(fx, 0);
    applyBloomFrame(fx, 0.55);
    for (const part of fx.parts) {
      expect(part.texture.offset.y).toBe(0);
      expect(part.texture.repeat.x).toBeCloseTo(1 / 10, 6);
      expect(part.texture.repeat.y).toBe(1);
    }
    expect(fx.parts[0]!.texture.offset.x).toBeCloseTo(5 / 10, 6);
  });

  it('★ 释放显存之后再摘掉不会炸（重开一局会连着调）', async () => {
    const { createBloomFx, disposeBloomFx } = await loadModule();
    const fx = createBloomFx({ x: 0, z: 0, radius: 2, fx: 'vishdal_bloom', y: 0 })!;
    expect(() => disposeBloomFx(fx)).not.toThrow();
    expect(fx.parts.length).toBe(0);
  });

  it('★★ 帧指针会**回收复用**（否则每炸一次都要把一千多万像素重传一遍显存）', async () => {
    /*
      【为什么要钉？】
      火焰主层那张图是 10240×1024 —— 重传一次是"爆炸刚出现那一帧"的掉帧。
      做法是释放时不真 dispose，而是放回池子让下一次爆炸直接拿现成的。
      ★ 如果有人把 `disposeBloomFx` 改回"直接 dispose"，这条会红。
    */
    const { createBloomFx, disposeBloomFx, applyBloomFrame } = await loadModule();

    const first = createBloomFx({ x: 0, z: 0, radius: 2, fx: 'vishdal_bloom', y: 0 })!;
    const firstRing = first.parts[1]!.texture;
    applyBloomFrame(first, 0.5); // 播到第 6 帧
    disposeBloomFx(first);

    const second = createBloomFx({ x: 0, z: 0, radius: 2, fx: 'vishdal_bloom', y: 0 })!;
    const secondRing = second.parts[1]!.texture;
    expect(secondRing, '★ 应该复用上一次那份帧指针（不重新 clone）').toBe(firstRing);
    expect(secondRing.offset.x, '★ 复用前必须复位到第 0 帧').toBe(0);
    expect(secondRing.source, '底图始终共享').toBe(firstRing.source);
  });
});

describe('★ 维什戴尔爆炸：贴图没到时的降级', () => {
  it('★★ 图一张都没加载好 -> 不炸（而不是只炸一半：只有烟没有火更难看）', async () => {
    const { createBloomFx } = await loadModuleNoAssets();
    expect(createBloomFx({ x: 0, z: 0, radius: 2, fx: 'vishdal_bloom', y: 0 })).toBeNull();
  });

  it('预加载函数不抛异常（缺图是预期情况，不该拖垮启动）', async () => {
    const { preloadBloomTextures } = await loadModuleNoAssets();
    expect(() => preloadBloomTextures()).not.toThrow();
  });
});

describe('★ 维什戴尔爆炸：接进回放（源码级）', () => {
  it('★★ replay.ts 三条生命周期都接了（少一条就会定格在棋盘上）', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/three/replay.ts', import.meta.url), 'utf8');

    // ① 每帧推进、② 战斗结束后的收尾分支也要推进、③ reset/clear 要清空
    expect(src, '事件分支').toContain("case 'bloom':");
    expect(src, '每帧推进').toContain('this.updateBloomFxList(deltaSeconds);');
    expect(src, '清空（重开一局）').toContain('this.clearBloomFx();');
    expect(src, '调试计数').toContain('liveBloomFxCount()');

    // 收尾分支也要推进 —— 用出现次数粗钉（正常帧 + finished 分支共两处）
    const updates = src.split('this.updateBloomFxList(deltaSeconds);').length - 1;
    expect(updates, '★ 正常帧 + `if (this.finished)` 收尾分支都要推进').toBeGreaterThanOrEqual(2);
  });

  it('★ 内核那边是"数据驱动"的：只有写了 fx 才发 bloom 事件', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('../../../packages/shared/src/rules.ts', import.meta.url),
      'utf8',
    );
    expect(src, '★ 判据必须是数据（splash.fx），不是按 id/干员写死').toContain("if (splash.fx) {");
    expect(src, '不允许按干员 id 判断特效').not.toContain("splash.fx === 'vishdal_bloom'");
  });
});
