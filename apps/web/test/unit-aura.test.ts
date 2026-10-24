// @vitest-environment jsdom
/**
 * ============================================================
 *  ★ 0.1.3 角色身上的金色光华（无敌 / 重生过渡）
 * ============================================================
 *
 * 【为什么能测？—— 用"贴图缓存的身份 + 不透明度"当观察点】
 * jsdom 没有真 canvas（`getContext` 返回 null），所以这里给一份"什么都能调、
 * 什么都不画"的桩（和 `unit-sprite-restyle.test.ts` 同一个套路）。
 * 于是能钉的就是**逻辑**，而逻辑恰恰是最容易写错的部分：
 *   · 帧号会不会越界 / 会不会随时间推进（"流转"就是它）
 *   · 强度有没有如实映射到不透明度（重生"由暗到亮"是这条）
 *   · 收起时有没有真的收起来（不然单位死了金光留在原地）
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { CELL } from '../src/game/grid.js';
import { RENDER_ORDER_CHIBI, RENDER_ORDER_HP } from '../src/three/card-layout.js';
import {
  auraWorldSize,
  AURA_FRAME_COUNT,
  AURA_FRAME_SECONDS,
  AURA_INVINCIBLE_OPACITY,
  AURA_REBIRTH_MIN_RATIO,
  AURA_REBIRTH_OPACITY,
  auraStateOf,
  auraTextureOf,
  createAuraSprite,
  updateAuraSprite,
} from '../src/three/unit-aura.js';

/** jsdom 没有 canvas 实现，给个"什么都能调、什么都不画"的桩 */
const contextStub = new Proxy(
  {},
  {
    get: (_target, prop) => {
      if (prop === 'createRadialGradient' || prop === 'createLinearGradient') {
        return () => ({ addColorStop: () => {} });
      }
      return () => {};
    },
    set: () => true,
  },
);

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (HTMLCanvasElement.prototype as any).getContext = () => contextStub;
});

describe('★ 金色光华：贴图（共享 + 不会越界）', () => {
  it('同一 (种类, 帧) 拿到的永远是同一张 —— 几十个单位共用一套，不会各烤一份 canvas', () => {
    expect(auraTextureOf('invincible', 3)).toBe(auraTextureOf('invincible', 3));
    expect(auraTextureOf('rebirth', 3)).not.toBe(auraTextureOf('invincible', 3));
  });

  it('帧号会回绕：传超过一圈的数不会越界（负数也安全）', () => {
    expect(auraTextureOf('invincible', AURA_FRAME_COUNT)).toBe(auraTextureOf('invincible', 0));
    expect(auraTextureOf('invincible', -1)).toBe(auraTextureOf('invincible', AURA_FRAME_COUNT - 1));
    expect(auraTextureOf('rebirth', AURA_FRAME_COUNT * 3 + 2)).toBe(auraTextureOf('rebirth', 2));
  });

  it('两种效果各有一套帧（重生那套更暖，不能和无敌共用）', () => {
    for (let i = 0; i < AURA_FRAME_COUNT; i++) {
      expect(auraTextureOf('rebirth', i)).not.toBe(auraTextureOf('invincible', i));
    }
  });
});

describe('★ 金色光华：显示 / 收起', () => {
  it('★★ 精灵自己**不带尺寸** —— 尺寸只能由"小人多大"决定', () => {
    /*
      【这条钉的是用户报的"特效比竞技场还大"】
      第一版把**贴图像素**当世界单位写死（`scale = 128 × 1.15 = 147`），
      而卡片的世界尺寸只有 0.72 × 0.96 —— 大了两百倍。
      精灵的 scale 是**世界单位**：谁想给个头，都得用"相对小人"的比例，
      不能抄贴图像素。所以这里要求它出厂就是 1，等 replay 按小人覆盖。
    */
    const sprite = createAuraSprite();
    expect(sprite.scale.x, '不能按贴图像素设 scale').toBe(1);
    expect(sprite.scale.y, '不能按贴图像素设 scale').toBe(1);
  });

  it('★★ 光效尺寸**跟格子**（用户口径："比一个格子大一点点"）', () => {
    /*
      【这条钉的是用户第二次反馈："再小一点，大概比竞技场一个格子大一点点就好"】
      按"小人 × 1.15"算是不行的：小人多大各干员不同（Boss、巨像的模型缩放更大），
      它们会得到一个大得多的光斑。改成按格子（`CELL = 1.0` 世界单位）算之后，
      每枚棋子上的光效都一样大，而且**永远只是"比一格大一点点"**。
    */
    const size = auraWorldSize();
    expect(size.h, '要比一格大一点点').toBeGreaterThan(CELL);
    expect(size.h, '但不能大太多').toBeLessThan(CELL * 1.2);
    expect(size.w, '是竖长形（贴图 128×160）').toBeLessThan(size.h);
  });

  it('★ 层级压在小人之上、血条之下（否则会被卡片/小人盖住）', () => {
    const sprite = createAuraSprite();
    expect(sprite.renderOrder, '要在小人上面').toBeGreaterThan(RENDER_ORDER_CHIBI);
    expect(sprite.renderOrder, '不能盖住血条').toBeLessThan(RENDER_ORDER_HP);
  });

  it('刚造出来是藏着的（不能一上场每个棋子都发光）', () => {
    const sprite = createAuraSprite();
    expect(sprite.visible).toBe(false);
    expect(auraStateOf(sprite).kind).toBeNull();
  });

  it('★ 给了种类就亮起来，不给就收回去', () => {
    const sprite = createAuraSprite();

    updateAuraSprite(sprite, 'invincible', 1, 0.016);
    expect(sprite.visible, '无敌期间要亮着').toBe(true);
    expect(auraStateOf(sprite).kind).toBe('invincible');
    expect(sprite.material.opacity).toBeGreaterThan(0);

    updateAuraSprite(sprite, null, 0, 0.016);
    expect(sprite.visible, '效果没了就该收起来').toBe(false);
    expect(auraStateOf(sprite).kind).toBeNull();
  });

  it('强度为 0 等同于不显示（重生刚开始那一下）', () => {
    const sprite = createAuraSprite();
    updateAuraSprite(sprite, 'rebirth', 0, 0.016);
    expect(sprite.visible).toBe(false);
  });

  it('无敌的不透明度有上限（再高小人本身就看不清了）', () => {
    const sprite = createAuraSprite();
    updateAuraSprite(sprite, 'invincible', 1, 0.016);
    expect(sprite.material.opacity).toBeLessThanOrEqual(AURA_INVINCIBLE_OPACITY + 1e-6);
  });
});

describe('★ 金色光华：流转（帧号随时间推进）', () => {
  it('★ 时间往前走，帧号就往前翻', () => {
    const sprite = createAuraSprite();
    updateAuraSprite(sprite, 'invincible', 1, 0);
    expect(auraStateOf(sprite).frame).toBe(0);

    updateAuraSprite(sprite, 'invincible', 1, AURA_FRAME_SECONDS);
    expect(auraStateOf(sprite).frame).toBe(1);

    updateAuraSprite(sprite, 'invincible', 1, AURA_FRAME_SECONDS * 4);
    expect(auraStateOf(sprite).frame).toBe(5);
  });

  it('★ 转完一圈回到第 0 帧（循环，不是一路加下去）', () => {
    const sprite = createAuraSprite();
    updateAuraSprite(sprite, 'invincible', 1, 0);
    // 整整一圈
    updateAuraSprite(sprite, 'invincible', 1, AURA_FRAME_SECONDS * AURA_FRAME_COUNT);
    expect(auraStateOf(sprite).frame).toBe(0);
    // 一圈再多两帧
    updateAuraSprite(sprite, 'invincible', 1, AURA_FRAME_SECONDS * 2);
    expect(auraStateOf(sprite).frame).toBe(2);
  });

  it('★ 换了种类要从头转（不然"无敌接重生"会从半圈接上，看着像卡了一下）', () => {
    const sprite = createAuraSprite();
    updateAuraSprite(sprite, 'invincible', 1, AURA_FRAME_SECONDS * 7);
    expect(auraStateOf(sprite).frame).toBe(7);

    updateAuraSprite(sprite, 'rebirth', AURA_REBIRTH_MIN_RATIO, 0);
    expect(auraStateOf(sprite).frame, '换种类后从第 0 帧重新开始').toBe(0);
  });
});

describe('★ 金色光华：重生过渡"由暗到亮"', () => {
  it('★ 强度越大越亮（倒地越接近复活越亮）', () => {
    const dim = createAuraSprite();
    updateAuraSprite(dim, 'rebirth', AURA_REBIRTH_MIN_RATIO, 0.016);
    const bright = createAuraSprite();
    updateAuraSprite(bright, 'rebirth', 1, 0.016);

    expect(bright.material.opacity).toBeGreaterThan(dim.material.opacity);
    expect(bright.material.opacity).toBeLessThanOrEqual(AURA_REBIRTH_OPACITY + 1e-6);
  });

  it('重生那一层比无敌更"炸"（它要报"我活过来了"）', () => {
    expect(AURA_REBIRTH_OPACITY).toBeGreaterThan(AURA_INVINCIBLE_OPACITY);
  });
});
