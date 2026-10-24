// @vitest-environment jsdom
/**
 * ============================================================
 *  红方小人镜像 + 小领袖 / Boss 放大 50%
 * ============================================================
 *
 * 【为什么这两条要单独钉住？】
 * 它们都是"看截图才知道对不对"的表现层需求，最容易在以后改版式时被悄悄改回去：
 *
 *  1. **镜像**：官方小人素材只有一个朝向。红方如果不镜像，就是一排
 *     "背对着你、朝着场外"的敌人。而镜像本身有个坑 ——
 *     three.js 的 Sprite 顶点着色器里 `scale.x = length(...)`（取模长，永远为正），
 *     所以 `sprite.scale.x = -1` **根本不翻**。真正的翻转只能落在贴图上。
 *     这里就把"确实调了水平镜像变换"钉死。
 *
 *  2. **放大**：只有小领袖 / Boss 放大 1.5 倍，其它档次不动。
 *     倍率（chibiModelScaleFor）和世界尺寸（chibiWorldSize）都是纯函数，
 *     不需要真 canvas 就能验。
 *
 * 【为什么手搓 ChibiState 而不是走 attachChibi？】
 * attachChibi 要 fetch 清单 + 加载图片，jsdom 里两样都没有。
 * 这里关心的只是"状态机怎么画"，所以给个只记账不真画的假 ctx 就够了
 * （和 chibi-anim.test.ts 同一套路）。
 */
import { describe, expect, it } from 'vitest';
import { Sprite, type CanvasTexture } from 'three';
import { UNIT_DEFS, monsterDefs, monsterModelScaleOf } from '../../../packages/shared/src/index.js';
import {
  chibiModelScaleFor,
  chibiWorldSize,
  setChibiMirror,
  updateChibi,
  type ChibiMode,
} from '../src/three/chibi.js';

/** 记录 setTransform / drawImage 的假 ctx（jsdom 没有真 canvas） */
function recordingCtx() {
  const calls = { transforms: [] as number[][], draws: 0, clears: 0 };
  return {
    calls,
    ctx: {
      clearRect: () => void calls.clears++,
      drawImage: () => void calls.draws++,
      setTransform: (...args: number[]) => void calls.transforms.push(args),
    } as unknown as CanvasRenderingContext2D,
  };
}

/** 造一个"素材已就绪"的小人状态（画布 40×20，方便一眼看出镜像参数） */
function makeChibi(options: { mirror?: boolean } = {}) {
  const sprite = new Sprite();
  const { ctx, calls } = recordingCtx();
  const anims = { idle: { file: 'idle.png', frames: 8, fps: 10, loop: true } };
  const state = {
    defId: 'op01',
    canvas: { width: 40, height: 20 } as HTMLCanvasElement,
    ctx,
    texture: { needsUpdate: false } as unknown as CanvasTexture,
    sprite,
    ready: true,
    anims,
    images: { idle: {} as HTMLImageElement },
    current: 'idle' as ChibiMode,
    frame: 0,
    acc: 0,
    drawnFrame: -1,
    drawnAnim: '',
    drawnMirror: options.mirror ?? false,
    mirror: options.mirror ?? false,
  };
  (sprite.userData as { chibi?: unknown }).chibi = state;
  return { sprite, state, calls };
}

describe('★ 红方小人镜像（"背对着你站一排"那个问题）', () => {
  it('镜像是**画布水平翻转**：x 轴取负、并平移一个画布宽度', () => {
    const { sprite, state, calls } = makeChibi({ mirror: true });
    updateChibi(sprite, 1 / 60, 'idle');

    expect(calls.draws, '应该真的画了一帧').toBeGreaterThan(0);
    expect(
      calls.transforms.some((t) => t[0] === -1 && t[1] === 0 && t[2] === 0 && t[3] === 1 && t[4] === 40),
      `镜像时应该下 setTransform(-1, 0, 0, 1, 画布宽, 0)，实际：${JSON.stringify(calls.transforms)}`,
    ).toBe(true);
    // 画完必须复位，否则下一帧（可能已经不镜像）会继续翻
    expect(
      calls.transforms.some((t) => t[0] === 1 && t[1] === 0 && t[2] === 0 && t[3] === 1 && t[4] === 0),
      '画完要复位变换',
    ).toBe(true);
    expect(state.drawnMirror).toBe(true);
  });

  it('不镜像时一次 setTransform 都不调（别给假 ctx 也提要求）', () => {
    const { sprite, calls } = makeChibi({ mirror: false });
    updateChibi(sprite, 1 / 60, 'idle');
    expect(calls.draws).toBeGreaterThan(0);
    expect(calls.transforms).toEqual([]);
  });

  it('setChibiMirror 立刻重画（不能等下一轮动画才翻过来）', () => {
    const { sprite, state, calls } = makeChibi({ mirror: false });
    updateChibi(sprite, 1 / 60, 'idle');
    const before = calls.draws;

    setChibiMirror(sprite, true);

    expect(state.mirror).toBe(true);
    expect(calls.draws, '切阵营时应该马上重画一帧').toBeGreaterThan(before);
    expect(calls.transforms.some((t) => t[0] === -1), '重画的那一帧必须是镜像的').toBe(true);
  });

  it('setChibiMirror 是幂等的：朝向没变就不白重画一次', () => {
    const { sprite, calls } = makeChibi({ mirror: true });
    updateChibi(sprite, 1 / 60, 'idle');
    const before = calls.draws;
    setChibiMirror(sprite, true);
    expect(calls.draws).toBe(before);
  });

  it('没挂小人的精灵调 setChibiMirror 不会炸', () => {
    expect(() => setChibiMirror(new Sprite(), true)).not.toThrow();
  });
});

describe('★ 0.2 棋子自己的模型倍率（modelScale）优先于野怪那张表', () => {
  it('★ 魂灵之影：缩小到 65%（用户口径"大概缩小 35%"）', () => {
    /*
      【为什么这条要单钉？】
      小人的世界高度对所有棋子是**同一个基准**（`CHIBI_WORLD_H`），
      而官方那套 token 骨架比干员模型占地大 —— 不压的话魂灵之影比维什戴尔本人还壮，
      完全不像"影子"。这个 0.65 是观感上唯一的调节旋钮，值得钉住。
    */
    const shadow = UNIT_DEFS['summon_shadow']!;
    expect(shadow.modelScale).toBe(0.65);
    expect(chibiModelScaleFor(shadow), '召唤物不是野怪，但也要认这个字段').toBe(0.65);
  });

  it('★ 写了 modelScale 就压过野怪表（野怪也能被逐只覆盖）', () => {
    // 拿一只明明在野怪表里、倍率不是 1 的怪，临时给它写一个 modelScale
    const monster = monsterDefs().find((def) => def.id === 'mn_slime')!;
    expect(chibiModelScaleFor(monster), '前提：表里是 0.85').toBe(0.85);
    expect(
      chibiModelScaleFor({ ...monster, modelScale: 0.6 }),
      '★ 棋子自己写的优先',
    ).toBe(0.6);
  });

  it('没写 modelScale 的召唤物/干员一律是 1（不吃野怪那张表）', () => {
    for (const id of ['op45', 'summon_lion', 'summon_yanyou', 'summon_dummy']) {
      const def = UNIT_DEFS[id]!;
      expect(def.modelScale, `${id} 没写 modelScale`).toBeUndefined();
      expect(chibiModelScaleFor(def), `${id} 应为原尺寸`).toBe(1);
    }
  });

  it('★ 世界尺寸是按倍率线性缩的（脚底锚点不动 ⇒ 从地面往上缩）', () => {
    const cell = { w: 232, h: 178 };
    const box = { x: 4, y: 4, w: 224, h: 170 };
    const full = chibiWorldSize(cell, box, 1);
    const small = chibiWorldSize(cell, box, 0.65);
    expect(small.h).toBeCloseTo(full.h * 0.65, 6);
    expect(small.w).toBeCloseTo(full.w * 0.65, 6);
  });
});

describe('★ 野怪模型大小（级别默认 + 逐只覆盖）', () => {
  const monsters = monsterDefs();
  const byId = (id: string) => monsters.find((def) => def.id === id)!;

  it('逐只表：点名的野怪按各自倍率来', () => {
    // 源石虫 / 猎狗 缩小 15%
    expect(chibiModelScaleFor(byId('mn_slime')), '源石虫 ×0.85').toBe(0.85);
    expect(chibiModelScaleFor(byId('mn_gopro')), '猎狗 ×0.85').toBe(0.85);
    // 萨卡兹大剑手 / 重装防御者 / 游击队盾卫 变大 15%
    expect(chibiModelScaleFor(byId('mn_demon')), '萨卡兹大剑手 ×1.15').toBe(1.15);
    expect(chibiModelScaleFor(byId('mn_shield')), '重装防御者 ×1.15').toBe(1.15);
    expect(chibiModelScaleFor(byId('mn_sotisd')), '游击队盾卫 ×1.15').toBe(1.15);
    // "盛怒" / 两只深池怪 变大 20%
    expect(chibiModelScaleFor(byId('mn_spklr')), '"盛怒" ×1.2').toBe(1.2);
    expect(chibiModelScaleFor(byId('mn_dushdo')), '深池伙友影刃精英 ×1.2').toBe(1.2);
    expect(chibiModelScaleFor(byId('mn_duholy')), '深池伙友卫队精英 ×1.2').toBe(1.2);
    // 泥岩巨像 变大 30%
    expect(chibiModelScaleFor(byId('mn_mdgint')), '泥岩巨像 ×1.3').toBe(1.3);
  });

  it('所有小领袖统一缩小 10%（1.5 → 1.35），Boss 维持 1.5', () => {
    const leaders = monsters.filter((def) => def.monsterTier === 'leader');
    expect(leaders.length, '名单里得有小领袖').toBeGreaterThanOrEqual(1);
    for (const def of leaders) {
      expect(chibiModelScaleFor(def), `${def.name} 应为 ×1.35`).toBe(1.35);
    }
    const bosses = monsters.filter((def) => def.monsterTier === 'boss');
    expect(bosses.length, '名单里得有 Boss').toBeGreaterThanOrEqual(1);
    for (const def of bosses) {
      expect(chibiModelScaleFor(def), `${def.name} 应为 ×1.5`).toBe(1.5);
    }
  });

  it('没被点名的野怪保持原大小', () => {
    // 小怪里只有源石虫/猎狗被点名，士兵 / 隐形弩手不动
    expect(chibiModelScaleFor(byId('mn_nsabr')), '士兵').toBe(1);
    expect(chibiModelScaleFor(byId('mn_jshoot')), '隐形弩手').toBe(1);
    // 普通里只有萨卡兹大剑手 / 重装防御者被点名
    expect(chibiModelScaleFor(byId('mn_rogue')), '双持剑士').toBe(1);
    expect(chibiModelScaleFor(byId('mn_reveng')), '寻仇者').toBe(1);
    expect(chibiModelScaleFor(byId('mn_wteeth')), '拾荒者').toBe(1);
    expect(chibiModelScaleFor(UNIT_DEFS['op01']!), '干员一律不动').toBe(1);
  });

  it('渲染侧的 chibiModelScaleFor 就是 shared 那份（单一来源，没有第二份数字）', () => {
    for (const def of monsters) {
      expect(chibiModelScaleFor(def), `${def.name} 两边必须一致`).toBe(monsterModelScaleOf(def));
    }
    expect(chibiModelScaleFor(UNIT_DEFS['op01']!)).toBe(monsterModelScaleOf(UNIT_DEFS['op01']!));
  });

  it('世界尺寸真的跟着倍率走（不是只改了个开关）', () => {
    // 拿一份最"高"的清单（画布比设计框大很多）来算，验证倍率乘在世界尺寸上
    const cell = { w: 448, h: 278 };
    const box = { x: 112, y: 54, w: 224, h: 170 };

    const normal = chibiWorldSize(cell, box, 1);
    const leader = chibiWorldSize(cell, box, 1.35);
    const giant = chibiWorldSize(cell, box, 1.3);

    expect(leader.h / normal.h).toBeCloseTo(1.35, 5);
    // 宽高比不能变（变了就是"拉变形"，不是"放大/缩小"）
    expect(leader.w / leader.h).toBeCloseTo(normal.w / normal.h, 5);

    /*
      ★ 真正要看的是"**模型**多大"，不是"整张画布多大"。
      精灵贴的是整张画布（渲染器为了让挥武器/阵亡不被裁掉而撑大的），
      所以要乘回 (设计框 / 画布) 才是玩家看到的小人高度：
        干员 = 0.98 世界单位（≈ 一格），小领袖 = 1.323，泥岩巨像 = 1.274
    */
    const modelH = (size: { h: number }): number => size.h * (box.h / cell.h);
    expect(modelH(normal), '干员的模型仍然是一格高').toBeCloseTo(0.98, 5);
    expect(modelH(leader), '小领袖的模型（缩小 10% 后）').toBeCloseTo(0.98 * 1.35, 5);
    expect(modelH(giant), '泥岩巨像的模型').toBeCloseTo(0.98 * 1.3, 5);
  });

  it('老清单没有 box 字段时按"画布=设计框"处理（兼容老素材）', () => {
    const cell = { w: 200, h: 100 };
    const size = chibiWorldSize(cell, undefined, 1);
    expect(size.h).toBeCloseTo(0.98, 5);
    expect(size.w).toBeCloseTo(0.98 * 2, 5);
    // 倍率同样生效（缩小也一样乘）
    expect(chibiWorldSize(cell, undefined, 0.85).h).toBeCloseTo(0.98 * 0.85, 5);
  });
});
