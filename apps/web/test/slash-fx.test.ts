// @vitest-environment jsdom
/**
 * ============================================================
 *  ★ 0.1.3 锏的「疯狂斩击」—— 月牙刀光（渲染层）
 * ============================================================
 *
 * 【为什么能测？】
 * 和 `unit-aura.test.ts` 同一个套路：jsdom 没有真 canvas，给一份
 * "什么都能调、什么都不画"的桩。于是能钉的是**逻辑与尺寸**——
 * 而这两样恰恰是最容易写错、又最难靠肉眼发现的部分：
 *   · 刀光有没有比技能范围还大（"比竞技场还大"那个坑的翻版）；
 *   · 十刀连斩是不是真的刀刀不同（否则看起来像风车在转）；
 *   · 贴图有没有共享（连斩 10 刀不该烤 10 张 canvas）；
 *   · 有没有贴地、有没有加色混合（不贴地 = 竖着插在地上；不加色 = 蒙张黄纸）。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { CELL } from '../src/game/grid.js';
import { RENDER_ORDER_FX, RENDER_ORDER_STARS } from '../src/three/card-layout.js';
import {
  MAX_LIVE_SLASH_FX,
  SLASH_CELLS_PER_RADIUS,
  SLASH_DURATION_SECONDS,
  SLASH_PALETTE,
  SLASH_REACH_VARIANTS,
  SLASH_SPREAD_VARIANTS,
  createSlashFx,
  disposeSlashFx,
  slashFlashScaleAt,
  slashFlashTexture,
  slashOpacityAt,
  slashReachWorld,
  slashScaleAt,
  slashShapeOf,
  slashTextureOf,
} from '../src/three/slash-fx.js';

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

describe('★ 斩击：主题色（用户口径"以深黄色为主"）', () => {
  it('★★ 三档深黄 + 刀刃那道近白的线，一个都不许改', () => {
    /*
      【这条钉的是用户定的口径】
      提案稿（.fx-proposal/slash-deepyellow.html）里就是这四个色值，
      改任何一个都会让整套刀光跑偏（换成暖白会变成灰雾 —— unit-aura 踩过同一个坑）。
    */
    expect(SLASH_PALETTE.hi).toBe('255,224,138'); // #ffe08a
    expect(SLASH_PALETTE.main).toBe('224,168,40'); // #e0a828
    expect(SLASH_PALETTE.deep).toBe('138,92,16'); // #8a5c10
    expect(SLASH_PALETTE.edge).toBe('255,240,190'); // #fff0be
  });
});

describe('★ 斩击：每一刀都不一样（否则连斩会看成风车）', () => {
  it('★ 十刀的朝向两两不同，且不会转回原处重合', () => {
    const yaws = Array.from({ length: 10 }, (_, i) => slashShapeOf(i).yaw);
    expect(new Set(yaws.map((y) => y.toFixed(4))).size, '十刀不能重合成一道').toBe(10);
    for (const y of yaws) expect(y).toBeGreaterThanOrEqual(0);
  });

  it('★ 张角 / 长度各走各的周期 —— 九刀之内形状组合不重复', () => {
    /*
      【这条钉的是一个真踩过的坑】
      第一版写的是 `(i*5)%3` + `(i*7)%3`，看着像两个互质的周期，
      其实等于 2i%3 和 i%3 —— 组合只有 3 种，九刀里重复三轮，
      连斩又变回"风车在转"。所以这里要求**九刀九种**。
    */
    const combos = Array.from(
      { length: 9 },
      (_, i) => `${slashShapeOf(i).spreadIndex}-${slashShapeOf(i).reachIndex}`,
    );
    expect(new Set(combos).size, '不该出现"两刀一模一样"').toBe(9);
  });

  it('序号是纯函数：同一个 seq 永远得到同一刀（回放才对得上）', () => {
    for (let i = 0; i < 12; i++) {
      expect(slashShapeOf(i)).toEqual(slashShapeOf(i));
    }
  });
});

describe('★ 斩击：尺寸（不许比技能范围还大）', () => {
  it('★ 刀身长度落在一格半到两格之间（锏的范围是 2 格）', () => {
    for (let i = 0; i < 3; i++) {
      const reach = slashReachWorld(2, i);
      expect(reach).toBeGreaterThan(CELL * 1.2);
      expect(reach).toBeLessThan(CELL * 1.8);
    }
  });

  it('★★ 整片刀光（含渐变最外圈）不许超出技能范围 —— 铺满就成了"地上亮了一下"', () => {
    /*
      【这条是"特效比竞技场还大"那个坑的翻版】
      锏的范围是 2 格。刀光如果铺满这 2 格，画面上是一个完整的圆在闪，
      读不出"这是一刀"；而且超出范围就是在**骗人**（看着挨打了其实没挨打）。
    */
    for (let seq = 0; seq < 9; seq++) {
      const fx = createSlashFx({ x: 0, z: 0, radius: 2, seq, y: 0.02 });
      const blade = fx.parts.find((part) => part.kind === 'blade')!;
      const half = blade.geometry.parameters.width / 2;
      expect(half, `第 ${seq + 1} 刀超出了范围`).toBeLessThan(2 * CELL);
      expect(half, `第 ${seq + 1} 刀太小了，看不见`).toBeGreaterThan(CELL);
    }
  });

  it('★ 贴地平面的边长按贴图里的弧半径换算，不能直接用直径（否则最外圈渐变被裁掉）', () => {
    const fx = createSlashFx({ x: 0, z: 0, radius: 2, seq: 0, y: 0.02 });
    const blade = fx.parts.find((part) => part.kind === 'blade')!;
    const size = blade.geometry.parameters.width;
    const reach = slashReachWorld(2, slashShapeOf(0).reachIndex);
    expect(size, '平面要装得下整条渐变').toBeGreaterThan(reach * 2);
    expect(size).toBeLessThan(reach * 2.5);
  });
});

describe('★ 斩击：贴图共享（连斩 10 刀不该烤 10 张 canvas）', () => {
  it('同一档张角永远拿到同一张贴图', () => {
    expect(slashTextureOf(0)).toBe(slashTextureOf(0));
    expect(slashTextureOf(1)).toBe(slashTextureOf(1));
    expect(slashTextureOf(2)).toBe(slashTextureOf(2));
    expect(slashTextureOf(3), '越界要回绕，不能新建').toBe(slashTextureOf(0));
  });

  it('★ 三档张角只有三张贴图', () => {
    expect(SLASH_SPREAD_VARIANTS.length).toBe(3);
    expect(new Set([slashTextureOf(0), slashTextureOf(1), slashTextureOf(2)]).size).toBe(3);
  });

  it('命中爆闪全场共用一张', () => {
    expect(slashFlashTexture()).toBe(slashFlashTexture());
  });
});

describe('★ 斩击：场景里的一刀', () => {
  it('一刀 = 月牙刀身 + 命中爆闪，两块都在壳里', () => {
    const fx = createSlashFx({ x: 1, z: 2, radius: 2, seq: 3, y: 0.02 });
    expect(fx.parts.map((p) => p.kind).sort()).toEqual(['blade', 'flash']);
    expect(fx.holder.children.length).toBe(2);
    expect(fx.holder.position.x).toBe(1);
    expect(fx.holder.position.z).toBe(2);
  });

  it('★ 刀身在圆心（施法者脚下），爆闪挂在刀锋那一头', () => {
    const fx = createSlashFx({ x: 0, z: 0, radius: 2, seq: 4, y: 0.02 });
    const blade = fx.parts.find((p) => p.kind === 'blade')!;
    const flash = fx.parts.find((p) => p.kind === 'flash')!;
    expect(blade.mesh.position.x, '月牙的圆心就是施法者').toBe(0);
    expect(flash.mesh.position.x, '爆闪在刀锋扫到的那一点').toBeGreaterThan(0);
    expect(flash.mesh.position.y).toBeGreaterThan(blade.mesh.position.y);
  });

  it('★ 两块都必须贴地 + 加色混合 + 不写深度（不贴地会竖着插在地上）', () => {
    const fx = createSlashFx({ x: 0, z: 0, radius: 2, seq: 0, y: 0.02 });
    for (const part of fx.parts) {
      expect(part.mesh.rotation.x, 'PlaneGeometry 要转 -90° 才贴地').toBeCloseTo(-Math.PI / 2, 6);
      expect(part.material.blending, '不加色就成了蒙一张黄纸').toBe(2); // AdditiveBlending
      expect(part.material.depthWrite, '写深度会挡住棋子').toBe(false);
      expect(part.material.transparent).toBe(true);
    }
  });

  it('回收要把两块从壳上摘干净并释放（Three.js 不会自动回收）', () => {
    const fx = createSlashFx({ x: 0, z: 0, radius: 2, seq: 0, y: 0.02 });
    disposeSlashFx(fx);
    expect(fx.holder.children.length).toBe(0);
  });
});

describe('★ 斩击：时长与曲线', () => {
  it('★ 一刀的寿命要长过两刀的间隔（0.2 秒），否则画面上永远只有一道', () => {
    expect(SLASH_DURATION_SECONDS, '0.2 秒一刀，寿命必须 > 0.2').toBeGreaterThan(0.2);
    expect(SLASH_DURATION_SECONDS, '太长会糊成一片光幕').toBeLessThan(0.6);
  });

  it('刀身：先张开再余势，全程不缩回 0（刀是扫过去的，不是长出来的）', () => {
    expect(slashScaleAt(0)).toBeLessThan(1);
    expect(slashScaleAt(0.3)).toBeGreaterThan(slashScaleAt(0));
    expect(slashScaleAt(1)).toBeGreaterThan(1);
    for (let t = 0; t <= 1.0001; t += 0.1) expect(slashScaleAt(t)).toBeGreaterThan(0.5);
  });

  it('爆闪：先冲再收（"炸"一下）', () => {
    expect(slashFlashScaleAt(0)).toBeLessThan(slashFlashScaleAt(0.3));
    expect(slashFlashScaleAt(1)).toBeLessThan(slashFlashScaleAt(0.3));
  });

  it('不透明度：开头一小段满亮度，最后淡到 0（不留残影）', () => {
    expect(slashOpacityAt(0)).toBe(1);
    expect(slashOpacityAt(0.1)).toBe(1);
    expect(slashOpacityAt(1)).toBe(0);
    expect(slashOpacityAt(1.5), '越界要夹住').toBe(0);
  });
});

describe('★ 斩击：上限保护', () => {
  it('同屏刀光有硬上限（满编对轰时不能无限堆）', () => {
    expect(MAX_LIVE_SLASH_FX).toBeGreaterThan(0);
    expect(MAX_LIVE_SLASH_FX).toBeLessThanOrEqual(32);
    expect(SLASH_REACH_VARIANTS.length).toBe(3);
  });
});

// ============================================================
//  ★ 0.2：刀光必须画在棋子模型**之上**（用户报"特效会被敌怪挡住"）
// ============================================================
//
// 【为什么会挡住？】刀光和外圈的棋子卡面在投影后几乎同一个深度，
// 而两边都是透明物体（卡面在 createUnitSprite 里就写了 `depthWrite: false`）
// ⇒ three.js 只能按"离相机的距离"排先后 —— 一半概率被卡面盖住。
// 所以这里要钉两件事：
//   ① 两块贴片都显式设了 renderOrder；
//   ② 这个值**高于所有棋子精灵的层**（卡片 0 / 小人 1 / 血条·技能条 2 / 星级 3）。
// ★ 高度（y）一个数都没动：用户明确说这是图层问题，不是高度问题。
describe('★ 0.2 斩击：图层压在所有棋子精灵之上', () => {
  it('★ 刀身和爆闪的 renderOrder 都高于棋子那几层', () => {
    const fx = createSlashFx({ x: 0, z: 0, radius: 2, seq: 0, y: 0.02 });
    for (const part of fx.parts) {
      expect(
        part.mesh.renderOrder,
        `${part.kind} 没设 renderOrder 就会和卡面拼距离，随机被挡住`,
      ).toBe(RENDER_ORDER_FX);
    }
    // 棋子精灵最高是星级（3）—— 特效必须比它更高
    expect(RENDER_ORDER_FX).toBeGreaterThan(RENDER_ORDER_STARS);
  });

  it('★ 位置（高度）保持原样：只改图层，别偷偷抬高', () => {
    const fx = createSlashFx({ x: 0, z: 0, radius: 2, seq: 1, y: 0.02 });
    const blade = fx.parts.find((part) => part.kind === 'blade')!;
    expect(blade.mesh.position.y, '刀身还是贴地（lift = 0）').toBe(0);
    const flash = fx.parts.find((part) => part.kind === 'flash')!;
    expect(flash.mesh.position.y, '爆闪还是压在刀身之上一点点').toBeCloseTo(0.01, 5);
    expect(fx.holder.position.y, 'holder 用调用方给的高度').toBe(0.02);
  });
});
