/**
 * ============================================================
 *  Q 版小人的"动作不被反复打断"（0.0.2 追加需求第 3 条）
 * ============================================================
 *
 * 【这一条为什么值得单独钉一个测试？】
 * 因为 bug 的成因很隐蔽：`pickMode` 是**每帧**根据两个会衰减的浮点数
 * （castGlow / lunge）算出来的。一段挥击里 mode 会抖成
 * `attack → idle → attack → idle`，每抖一次就走"换动画 = 回第 0 帧"，
 * 于是小人永远在挥第一帧，看起来就是"动画卡住 / 一直被重置"。
 *
 * 修法是给动作定优先级：**只有更重要的动作才能打断正在播的动作**。
 * 这个规则是纯逻辑，不需要真的渲染，所以直接手搓一个 ChibiState 喂进去断言。
 *
 * 【为什么不用 attachChibi 建真实状态？】
 * 它要 canvas 2d context，而 jsdom 没有真 canvas 实现。
 * 这里只关心"状态机怎么切"，所以用一个记录用的假 ctx 就够了。
 */
import { describe, expect, it } from 'vitest';
import { Sprite, type CanvasTexture } from 'three';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  hasChibiAnim,
  pickMode,
  setChibiDizzy,
  updateChibi,
  type ChibiMode,
} from '../src/three/chibi.js';
import { createSwingTiming, noteHit, stepSwing } from '../src/three/attack-anim.js';

/** 记录画了哪一帧的假 ctx（只统计调用次数，不真的画） */
function fakeCtx() {
  const calls = { clear: 0, draw: 0 };
  return {
    calls,
    ctx: {
      clearRect: () => void calls.clear++,
      drawImage: () => void calls.draw++,
    } as unknown as CanvasRenderingContext2D,
  };
}

/** 造一个"素材已就绪"的小人状态：24 帧的攻击/技能，idle 循环 */
function makeChibi(
  spec: { attackFrames?: number; attackFps?: number; skillFrames?: number; withMove?: boolean } = {},
) {
  const sprite = new Sprite();
  const { ctx, calls } = fakeCtx();
  const anims: Record<string, { file: string; frames: number; fps: number; loop: boolean }> = {
    idle: { file: 'idle.png', frames: 8, fps: 10, loop: true },
    /*
      ★ 攻击动作的**帧数/帧率**必须能按需指定：
      真实素材里"攻击动作有多长"差别很大（源石虫 9 帧@11.7 ≈ 0.77 秒、
      博卓卡斯替 24 帧@7.9 ≈ 3.03 秒），而挥击窗口的时长是"自然时长 ÷ 倍率"——
      两者**必须由同一份素材参数推出来**，测试里也一样，
      否则会测出一个现实里不存在的组合（动作 1.2 秒、窗口 1 秒 → 每拍都多冻 0.2 秒）。
    */
    attack: {
      file: 'attack.png',
      frames: spec.attackFrames ?? 24,
      fps: spec.attackFps ?? 20,
      loop: false,
    },
    skill: { file: 'skill.png', frames: spec.skillFrames ?? 24, fps: 20, loop: false },
    die: { file: 'die.png', frames: 12, fps: 10, loop: false },
  };
  // ★ 0.0.3：野怪有走路素材、干员没有 —— 两种都要能测（withMove: false 就是干员）
  if (spec.withMove !== false) {
    anims.move = { file: 'move.png', frames: 12, fps: 12, loop: true };
  }
  const state = {
    defId: 'op01',
    canvas: { width: 4, height: 4 } as HTMLCanvasElement,
    ctx,
    texture: { needsUpdate: false } as unknown as CanvasTexture,
    sprite,
    ready: true,
    anims,
    images: {
      idle: {} as HTMLImageElement,
      attack: {} as HTMLImageElement,
      skill: {} as HTMLImageElement,
      die: {} as HTMLImageElement,
      ...(spec.withMove === false ? {} : { move: {} as HTMLImageElement }),
    },
    current: 'idle' as ChibiMode,
    frame: 0,
    acc: 0,
    drawnFrame: -1,
    drawnAnim: '',
  };
  (sprite.userData as { chibi?: unknown }).chibi = state;
  return { sprite, state, calls };
}

/** 按固定帧长推进若干秒 */
function advance(sprite: Sprite, mode: ChibiMode, seconds: number, stepSeconds = 1 / 60): void {
  let left = seconds;
  while (left > 0) {
    const dt = Math.min(stepSeconds, left);
    updateChibi(sprite, dt, mode);
    left -= dt;
  }
}

describe('★ 小人动作优先级：次要动作不能打断正在播的重要动作', () => {
  it('攻击开始后，立刻来的 idle 不能把它打回第 0 帧', () => {
    const { sprite, state } = makeChibi();
    updateChibi(sprite, 0.05, 'attack');
    expect(state.current, '第一帧就该切进 attack').toBe('attack');

    advance(sprite, 'attack', 0.2); // 播到一半
    const midway = state.frame;
    expect(midway, '应该真的在往前走帧').toBeGreaterThan(0);

    // 现在 mode 抖回 idle —— 这正是"被打断"的现场
    advance(sprite, 'idle', 0.05);
    expect(state.current, 'idle 比 attack 次要，不该抢走动作').toBe('attack');
    expect(state.frame, '更不该被重置回第 0 帧').toBeGreaterThanOrEqual(midway);
  });

  it('攻击这种"来回抖"的 mode 不会让帧号原地踏步', () => {
    const { sprite, state } = makeChibi();
    // 模拟 castGlow/lunge 抖动：attack / idle 每几帧来回切一次
    const modes: ChibiMode[] = ['attack', 'idle', 'attack', 'idle', 'attack', 'idle'];
    for (const mode of modes) advance(sprite, mode, 0.08);
    expect(state.frame, '抖了一轮之后必须真的推进了不少帧').toBeGreaterThan(3);
  });

  it('攻击播完之后，idle 才能接手', () => {
    const { sprite, state } = makeChibi({ attackFrames: 6 });
    advance(sprite, 'attack', 6 / 20 + 0.05); // 攻击正好播完
    expect(state.current).toBe('attack');
    advance(sprite, 'idle', 0.1);
    expect(state.current, '播完了就该回到待机').toBe('idle');
  });

  it('skill 比 attack 重要：技能可以打断攻击', () => {
    const { sprite, state } = makeChibi();
    updateChibi(sprite, 0.05, 'attack');
    advance(sprite, 'attack', 0.2);
    updateChibi(sprite, 0.05, 'skill');
    expect(state.current).toBe('skill');
  });

  it('die 永远最高优先级：死亡不能被任何动作挡住', () => {
    const { sprite, state } = makeChibi();
    updateChibi(sprite, 0.05, 'skill');
    advance(sprite, 'skill', 0.1);
    updateChibi(sprite, 0.05, 'die');
    expect(state.current, '死了就必须切 die').toBe('die');
  });

  it('idle 是循环动作，任何动作都能立刻打断它', () => {
    const { sprite, state } = makeChibi();
    updateChibi(sprite, 0.05, 'attack');
    advance(sprite, 'attack', 0.1);
    advance(sprite, 'idle', 2.0); // 攻击总共 1.2 秒，推够时间让它播完并回到 idle
    expect(state.current).toBe('idle');
    updateChibi(sprite, 0.05, 'attack');
    expect(state.current, 'idle 挡不住 attack').toBe('attack');
  });

  it('没有素材的动作会退回 idle，而且不会把 idle 当成"被锁住"', () => {
    const { sprite, state } = makeChibi();
    // 把 skill 素材摘掉，模拟"这个干员没有技能动画"
    delete (state.anims as Record<string, unknown>)['skill'];
    updateChibi(sprite, 0.05, 'skill');
    expect(state.current).toBe('idle');
  });
});

/*
  ★★ 0.0.3：走路动作（玩家要求"干员和野怪都要有移动动画"）
  ------------------------------------------------------------------
  野怪的官方骨架里有走路动作（Move / Move_Loop / C1_Move…），干员的战斗小人**没有**
  （实测两个素材仓库都只有 Idle/Attack/Skill/Die/Start）。
  所以：
    · 有素材的（野怪）—— 清单里会多一条 `move`，按循环播；
    · 没素材的（干员）—— 这边会**原样退回待机**（不许报错、不许闪），
      走路的"步子感"由 replay.ts 的程序化走姿补（见 walk-anim.ts）。
  另外走路是**最低一档**的动作：出手、技能、阵亡都能随时打断它。
*/
describe('★ 走路动作（move）', () => {
  it('有走路素材时，move 是循环播的（走多久都在迈步，不会走一半停住）', () => {
    const { sprite, state } = makeChibi();
    updateChibi(sprite, 0.05, 'move');
    expect(state.current).toBe('move');

    advance(sprite, 'move', 12 / 12 + 0.1, 1 / 60); // 播完一整轮再多一点
    expect(state.current, '循环动作不该自己切走').toBe('move');
    expect(state.frame, '循环回来了').toBeLessThan(12);
  });

  it('★ 走路是最低一档：出手 / 技能 / 死亡都能打断它', () => {
    for (const mode of ['attack', 'skill', 'die'] as ChibiMode[]) {
      const { sprite, state } = makeChibi();
      updateChibi(sprite, 0.05, 'move');
      expect(state.current).toBe('move');
      updateChibi(sprite, 0.05, mode);
      expect(state.current, `${mode} 应该能打断走路`).toBe(mode);
    }
  });

  it('★ 反过来不行：正在出手时不会被走路顶掉（否则打人的动作会消失）', () => {
    const { sprite, state } = makeChibi();
    advance(sprite, 'attack', 0.2);
    const midway = state.frame;
    expect(midway).toBeGreaterThan(0);

    advance(sprite, 'move', 0.1);
    expect(state.current, 'move 比 attack 次要，不能抢走动作').toBe('attack');
    expect(state.frame, '也不该被重置').toBeGreaterThanOrEqual(midway);
  });

  it('没有走路素材的单位（干员）退回待机，不报错也不闪', () => {
    const { sprite, state } = makeChibi({ withMove: false });
    expect(hasChibiAnim(sprite, 'move'), '干员没有走路素材').toBe(false);
    updateChibi(sprite, 0.05, 'move');
    expect(state.current, '没有 move 就播 idle，而不是把 current 置成不存在的键').toBe('idle');

    // 素材没就绪时也不能崩（会走 attachChibi 的异步加载路径）
    const { sprite: fresh, state: freshState } = makeChibi();
    freshState.ready = false;
    expect(hasChibiAnim(fresh, 'move'), '还没 ready 时按"没有"处理').toBe(false);
  });

  it('二阶段用 move2（Boss 换形态后走路不能还是一阶段的素材）', () => {
    const { sprite, state } = makeChibi();
    // 二阶段的素材是运行时按清单拼出来的，测试里手搓一份（类型要放宽）
    const anims = state.anims as Record<string, { file: string; frames: number; fps: number; loop: boolean }>;
    anims.move2 = { file: 'move2.png', frames: 8, fps: 10, loop: true };
    (state.images as Record<string, HTMLImageElement>).move2 = {} as HTMLImageElement;
    (state as unknown as { phase: number }).phase = 2;
    updateChibi(sprite, 0.05, 'move');
    expect(state.current).toBe('move2');
    expect(hasChibiAnim(sprite, 'move')).toBe(true);
  });
});

/**
 * ============================================================
 *  ★ 用户报的 bug：野怪"攻击若干次后攻击动画失效"
 * ============================================================
 * 这里把 replay.ts 的驱动方式**原样**搬过来（同一批函数、同一个调用顺序）：
 *
 *   attack 事件   ->  noteHit（对齐节奏、预测下一次命中）
 *   advanceSwing  ->  stepSwing（攻速换算 + 预测起手）+ "窗口是否重排"的判断
 *   pickMode      ->  lunge / swing 谁大听谁的
 *   updateChibi   ->  真正推帧（第 5 个参数 = "新的一轮开始了"）
 *
 * 【根因（写在这里，免得以后再踩）】
 * 挥击窗口的时长**恰好等于攻击间隔**（这是设计要求的"一次攻击一个动作循环"），
 * 于是站桩输出时窗口**首尾相接**：`stepSwing` 在窗口结束的同一帧就把下一次挥击排上，
 * `pickMode` 于是帧帧都返回 'attack'。而攻击动作是 `loop: false`（播完停在最后一帧）——
 * 只要 mode 一直是 attack，帧号就永远停在那一帧：**整个人僵在收招姿势**。
 *
 * 实测（未修复时）：8 秒里 400 多帧"一边在挥、画面一动不动"，
 * 只有窗口被打断过（走位 / 被控 / 目标阵亡）之后才又能重播一次 ——
 * 这正是用户说的"**若干次之后**才失效"。
 */
describe('★ 连续攻击时，攻击动作必须一次次重播（野怪动画失效的根因）', () => {
  /**
   * 模拟一段"站桩输出"，返回统计。
   *
   * @param seconds   模拟多长
   * @param interval  当前攻击间隔（秒）
   * @param natural   攻击动作的自然时长（秒）
   */
  function fight(
    seconds: number,
    interval: number,
    spec: { attackFrames?: number; attackFps?: number } = {},
  ) {
    const { sprite, state } = makeChibi(spec);
    // ★ 和 chibiAnimSeconds() 一样：自然时长必须从**这份素材**推出来
    const attackDef = state.anims.attack!;
    const natural = attackDef.frames / Math.max(1, attackDef.fps);
    const dt = 1 / 60;
    const speed = natural / interval; // replay 里 attackAnimSpeed 的稳态值
    let timing = createSwingTiming();
    let now = 0;
    let nextHitAt = interval; // 第一次命中
    let lunge = 0;
    let hits = 0;
    /** 挥击窗口被重新排上的次数（= 新的一轮攻击动作） */
    let swings = 0;
    /** 动画帧号"往回跳"的次数（= 真的从头播了一遍） */
    let restarts = 0;
    /** 连续多少帧"一边是 attack、帧号却不动"（未修复时会有几百帧） */
    let frozenRun = 0;
    let longestFrozen = 0;
    let prevFrame = -1;

    for (let i = 0; i < Math.round(seconds / dt); i++) {
      now += dt;
      lunge = Math.max(0, lunge - dt);
      if (now >= nextHitAt) {
        hits++;
        lunge = 0.18; // LUNGE_SECONDS
        timing = noteHit(timing, now, interval, natural / Math.max(0.05, timing.speed));
        nextHitAt += interval;
      }

      const before = timing.swing;
      const next = stepSwing(timing, {
        now,
        deltaSeconds: dt,
        naturalSeconds: natural,
        targetSpeed: speed,
        intervalSeconds: interval,
        enabled: true,
      });
      timing = { swing: next.swing, nextHitAt: next.nextHitAt, lastHitAt: next.lastHitAt, speed: next.speed };
      // replay.ts 就是这么判断的：swing 只减不加，一旦变大就是新的一轮
      const swingRestart = next.swing > before + 1e-6;

      const mode = pickMode({
        dead: false,
        castGlow: 0,
        lunge: Math.max(lunge, next.swing),
        moving: false,
      });
      updateChibi(
        sprite,
        dt,
        mode,
        mode === 'attack' ? timing.speed : 1,
        mode === 'attack' && swingRestart,
      );

      if (swingRestart) swings++;
      if (prevFrame >= 0 && state.frame < prevFrame) restarts++;
      if (mode === 'attack' && state.frame === prevFrame) {
        frozenRun++;
        longestFrozen = Math.max(longestFrozen, frozenRun);
      } else {
        frozenRun = 0;
      }
      prevFrame = state.frame;
    }
    return { hits, swings, restarts, longestFrozen, frame: state.frame };
  }

  it('★ 出手 8 次就要重播 8 次（不能只播第一次然后卡在最后一帧）', () => {
    // mn_slime：攻击动作 9 帧 @11.739fps ≈ 0.767 秒；攻速 1200 -> 间隔 1.0 秒
    const r = fight(8.5, 1.0, { attackFrames: 9, attackFps: 11.739 });
    expect(r.hits, '这 8.5 秒里应该出手 8 次').toBeGreaterThanOrEqual(8);
    expect(r.swings, '每一次出手都该排上一次挥击窗口').toBeGreaterThanOrEqual(r.hits - 1);
    expect(
      r.restarts,
      `攻击动作只重播了 ${r.restarts} 次（应该 ≈ 出手次数）—— 动画卡在最后一帧了`,
    ).toBeGreaterThanOrEqual(r.hits - 2);
  });

  it('★ 真正要钉的：不能出现"一边在挥、画面却一直不动"的僵住状态', () => {
    const r = fight(8.5, 1.0, { attackFrames: 9, attackFps: 11.739 });
    /*
      允许的"不动"只有"动画本来就走得慢"：
      9 帧的动作要播 1 秒 -> 一帧约 111 毫秒 = 6.7 个渲染帧，
      再加上收招那一小段，所以上限给 12 帧（0.2 秒）。
      未修复时这里是 400 多帧（7 秒多）。
    */
    expect(r.longestFrozen, `最长僵住 ${r.longestFrozen} 帧`).toBeLessThanOrEqual(12);
  });

  it('不同攻速（被减速 / 被加速）下也一样要重播', () => {
    // mn_skzdd（博卓卡斯替）：24 帧 @7.912fps ≈ 3.03 秒
    const spec = { attackFrames: 24, attackFps: 7.912 };
    for (const interval of [1.0, 1.7, 0.55]) {
      const r = fight(6, interval, spec);
      /*
        第一次出手是"从 idle 切进 attack"（本来就会从头播），不会走"窗口重排"这条计数；
        所以按出手次数往下减 2 来断言（留一点余量给收尾那一拍）。
      */
      expect(r.swings, `间隔 ${interval}s：挥击窗口没重排几次`).toBeGreaterThanOrEqual(
        Math.max(1, r.hits - 2),
      );
      expect(r.restarts, `间隔 ${interval}s：动作没真的重播几次`).toBeGreaterThanOrEqual(2);
      expect(r.longestFrozen, `间隔 ${interval}s 时最长僵住 ${r.longestFrozen} 帧`).toBeLessThanOrEqual(12);
    }
  });

  it('帧号永远停在合法范围内（不会溢出到不存在的帧）', () => {
    const r = fight(9, 1.0, { attackFrames: 9, attackFps: 11.739 });
    expect(r.frame).toBeGreaterThanOrEqual(0);
    expect(r.frame).toBeLessThan(9);
  });
});

/**
 * ★★ 0.2（用户 2026-10-17）：「给所有干员加眩晕动画」。
 *
 * 两件事要钉住：
 *   1. `pickMode` 的优先级：眩晕 > 出手/施法，**阵亡 > 眩晕**（死人优先演倒地）；
 *   2. 素材那半：官方只有 6 个干员带 `Stun` 动作，其余靠"程序化摇晃"兜底 ——
 *      所以那几个有素材的清单里**必须有 stun**（重新渲素材时漏掉这一步会红）。
 */
describe('★★ 0.2 眩晕：动作优先级', () => {
  it('眩晕压过出手与施法', () => {
    expect(pickMode({ dead: false, castGlow: 1, lunge: 1, moving: true, stunned: true })).toBe('stun');
    expect(pickMode({ dead: false, castGlow: 0, lunge: 1, stunned: true })).toBe('stun');
    expect(pickMode({ dead: false, castGlow: 0, lunge: 0, moving: true, stunned: true })).toBe('stun');
  });

  it('阵亡压过眩晕（被晕着打死要演倒地）', () => {
    expect(pickMode({ dead: true, castGlow: 0, lunge: 0, stunned: true })).toBe('die');
  });

  it('不晕的时候行为一个字没变', () => {
    expect(pickMode({ dead: false, castGlow: 1, lunge: 0 })).toBe('skill');
    expect(pickMode({ dead: false, castGlow: 0, lunge: 1 })).toBe('attack');
    expect(pickMode({ dead: false, castGlow: 0, lunge: 0, moving: true })).toBe('move');
    expect(pickMode({ dead: false, castGlow: 0, lunge: 0 })).toBe('idle');
  });
});

describe('★★ 0.2 眩晕：素材覆盖（有官方 Stun 的那 6 个）', () => {
  /** 这份名单来自 `render-chibi.mjs --list` 的实测结果（骨架里确实有 Stun） */
  const WITH_STUN = ['op07', 'op18', 'op39', 'op45', 'op46', 'op51'];

  it('带 Stun 动作的干员：清单里必须有 stun（循环、至少 6 帧）', () => {
    for (const defId of WITH_STUN) {
      const file = fileURLToPath(new URL(`../public/assets/chibi/${defId}/manifest.json`, import.meta.url));
      const manifest = JSON.parse(readFileSync(file, 'utf8')) as {
        animations: Record<string, { frames: number; loop: boolean; file: string }>;
      };
      const stun = manifest.animations.stun;
      expect(stun, `${defId} 少了 stun（重渲素材时漏了这一步？）`).toBeTruthy();
      expect(stun.loop, `${defId} 的眩晕应该循环播`).toBe(true);
      expect(stun.frames, `${defId} 的眩晕帧数太少`).toBeGreaterThanOrEqual(6);
    }
  });

  it('没有 Stun 动作的干员：清单里就是没有 stun（靠程序化摇晃兜底，不报错）', () => {
    const file = fileURLToPath(new URL('../public/assets/chibi/op01/manifest.json', import.meta.url));
    const manifest = JSON.parse(readFileSync(file, 'utf8')) as {
      animations: Record<string, unknown>;
    };
    expect(manifest.animations.stun).toBeUndefined();
  });
});

/**
 * ★★ 0.2：眩晕星星（画在小人画布里）
 *
 * 为什么要测：
 *   · 星星是**画进画布**的，不注意就会破坏"帧号没变就不重画"的优化（每帧上传贴图）；
 *   · 关掉眩晕时必须**强制重画一次**，否则星星会残留在贴图上（人已经站起来了，头顶还有三颗星）。
 */
describe('★★ 0.2 眩晕星星（画进画布）', () => {
  /** 带"路径绘制"计数的 ctx；设计框随便给一个，能算出头顶就行 */
  function makeStarChibi() {
    const calls = { clear: 0, draw: 0, path: 0, fill: 0, stroke: 0 };
    const noop = (): void => undefined;
    const ctx = new Proxy(
      {},
      {
        get: (_target, prop) => {
          if (prop === 'clearRect') return () => void calls.clear++;
          if (prop === 'drawImage') return () => void calls.draw++;
          if (prop === 'beginPath') return () => void calls.path++;
          if (prop === 'fill') return () => void calls.fill++;
          if (prop === 'stroke') return () => void calls.stroke++;
          if (prop === 'moveTo' || prop === 'lineTo' || prop === 'closePath') return noop;
          return noop;
        },
        set: () => true,
      },
    ) as unknown as CanvasRenderingContext2D;

    const sprite = new Sprite();
    const anims = {
      idle: { file: 'idle.png', frames: 2, fps: 10, loop: true },
      die: { file: 'die.png', frames: 2, fps: 10, loop: false },
    };
    const state = {
      defId: 'op01',
      canvas: { width: 224, height: 170 } as HTMLCanvasElement,
      ctx,
      texture: { needsUpdate: false } as unknown as CanvasTexture,
      sprite,
      ready: true,
      anims,
      images: { idle: {} as HTMLImageElement, die: {} as HTMLImageElement },
      current: 'idle',
      frame: 0,
      acc: 0,
      drawnFrame: -1,
      drawnAnim: '',
      drawnMirror: false,
      mirror: false,
      box: { x: 4, y: 4, w: 216, h: 160 },
      dizzy: false,
      dizzySpin: 0,
    };
    (sprite.userData as { chibi?: unknown }).chibi = state;
    return { sprite, state, calls };
  }

  it('★ 打开眩晕：画三颗星（beginPath / fill / stroke 各 3 次）', () => {
    const { sprite, calls } = makeStarChibi();
    updateChibi(sprite, 0.05, 'idle');
    const before = calls.path;

    setChibiDizzy(sprite, true, 0);
    expect(calls.path - before, '三颗星 => 三次 beginPath').toBe(3);
    expect(calls.fill, '要填色').toBeGreaterThanOrEqual(3);
    expect(calls.stroke, '要描边').toBeGreaterThanOrEqual(3);
  });

  it('★ 星星在转：同一帧、时间往前走 => 会重画（不会被"帧号没变"挡掉）', () => {
    const { sprite, calls } = makeStarChibi();
    updateChibi(sprite, 0.05, 'idle');
    setChibiDizzy(sprite, true, 0);
    const drawsAfterOn = calls.draw;

    setChibiDizzy(sprite, true, 0.3); // 时间往前 = 角度变了
    expect(calls.draw, '转动的星星必须重画').toBeGreaterThan(drawsAfterOn);
  });

  it('★ 关掉眩晕：强制重画一次（否则星星会残留在贴图上）', () => {
    const { sprite, state, calls } = makeStarChibi();
    updateChibi(sprite, 0.05, 'idle');
    setChibiDizzy(sprite, true, 0);
    const pathsWhileOn = calls.path;
    const drawsWhileOn = calls.draw;

    setChibiDizzy(sprite, false, 0);
    expect(calls.draw, '要重画（把人画干净）').toBeGreaterThan(drawsWhileOn);
    expect(calls.path, '关掉之后不再画星星').toBe(pathsWhileOn);
    expect(state.dizzy).toBe(false);
  });

  it('★ 不眩晕时仍然是"没变就不重画"（星星没有破坏这个优化）', () => {
    const { sprite, calls } = makeStarChibi();
    updateChibi(sprite, 0.05, 'idle');
    const draws = calls.draw;
    // 同一帧、同样的参数再来几次：帧号没变、没在晕 -> 一次都不该重画
    updateChibi(sprite, 0.01, 'idle');
    updateChibi(sprite, 0.01, 'idle');
    expect(calls.draw).toBe(draws);
  });
});
