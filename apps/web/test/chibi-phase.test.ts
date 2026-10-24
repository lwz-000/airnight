/**
 * ============================================================
 *  ★ 0.0.3：小人「二阶段」—— 换动作集（Boss 的第二形态）
 * ============================================================
 *
 * 【为什么值得单独钉一个测试？】
 * Boss 被打倒后会站起来换形态（杰斯顿 / 博卓卡斯替 / 奎隆），
 * 而"换形态"在小人这一层只表现为一件事：**换一套动作键**
 * （idle2 / attack2 / skill2 / die2 —— 就是骨架里的 C2_* / B_*）。
 * 这里钉住三件事：
 *   ① 二阶段优先用 `_2` 的动作，一阶段不受影响；
 *   ② 没有 `_2` 素材的棋子（绝大多数）行为一点不变；
 *   ③ 优先级判定用的是**基础动作**（attack2 的基础是 attack），
 *      否则二阶段的普攻会被判成"低于 idle"，永远播不出来。
 *
 * 和 chibi-anim.test.ts 一样，这里手搓一个"素材已就绪"的状态喂进去，
 * 不真的渲染（jsdom 没有 canvas 实现）。
 */
import { describe, expect, it } from 'vitest';
import { Sprite, type CanvasTexture } from 'three';
import { chibiPhaseOf, setChibiDowned, setChibiPhase, updateChibi, type ChibiMode } from '../src/three/chibi.js';

function fakeCtx() {
  const calls = { clear: 0, draw: 0 };
  return {
    calls,
    ctx: {
      clearRect: () => void calls.clear++,
      drawImage: () => void calls.draw++,
      setTransform: () => {},
    } as unknown as CanvasRenderingContext2D,
  };
}

/** 造一个双形态的小人状态 */
function makeChibi(opts: { withPhase2: boolean; dieFrames?: number }) {
  const sprite = new Sprite();
  const { ctx } = fakeCtx();
  const anims: Record<string, { file: string; frames: number; fps: number; loop: boolean }> = {
    idle: { file: 'idle.png', frames: 8, fps: 10, loop: true },
    attack: { file: 'attack.png', frames: 24, fps: 20, loop: false },
    skill: { file: 'skill.png', frames: 24, fps: 20, loop: false },
    die: { file: 'die.png', frames: opts.dieFrames ?? 12, fps: 10, loop: false },
  };
  const images: Record<string, unknown> = { idle: {}, attack: {}, skill: {}, die: {} };
  if (opts.withPhase2) {
    anims.idle2 = { file: 'idle2.png', frames: 8, fps: 10, loop: true };
    anims.attack2 = { file: 'attack2.png', frames: 24, fps: 20, loop: false };
    anims.skill2 = { file: 'skill2.png', frames: 24, fps: 20, loop: false };
    anims.die2 = { file: 'die2.png', frames: 12, fps: 10, loop: false };
    images.idle2 = {};
    images.attack2 = {};
    images.skill2 = {};
    images.die2 = {};
  }
  const state = {
    defId: 'mn_jakill',
    canvas: { width: 4, height: 4 } as HTMLCanvasElement,
    ctx,
    texture: { needsUpdate: false } as unknown as CanvasTexture,
    sprite,
    ready: true,
    anims,
    images,
    current: 'idle' as string,
    frame: 0,
    acc: 0,
    drawnFrame: -1,
    drawnAnim: '',
    drawnMirror: false,
    mirror: false,
    phase: 1,
    downedHold: false,
    downedSpeed: 1,
    hooks: {},
  };
  (sprite.userData as { chibi?: unknown }).chibi = state;
  return { sprite, state };
}

function advance(sprite: Sprite, mode: ChibiMode, seconds: number, stepSeconds = 1 / 60): void {
  let left = seconds;
  while (left > 0) {
    const dt = Math.min(stepSeconds, left);
    updateChibi(sprite, dt, mode);
    left -= dt;
  }
}

describe('★ 小人二阶段：换动作集', () => {
  it('一阶段默认用 idle / attack', () => {
    const { sprite, state } = makeChibi({ withPhase2: true });
    expect(chibiPhaseOf(sprite)).toBe(1);
    updateChibi(sprite, 0.05, 'idle');
    expect(state.current).toBe('idle');
    updateChibi(sprite, 0.05, 'attack');
    expect(state.current).toBe('attack');
  });

  it('★ 切到二阶段后立刻用 idle2，普攻/技能/阵亡也都走 _2', () => {
    const { sprite, state } = makeChibi({ withPhase2: true });
    setChibiPhase(sprite, 2);
    expect(chibiPhaseOf(sprite)).toBe(2);
    expect(state.current, '切形态要立刻换成二阶段的待机').toBe('idle2');

    updateChibi(sprite, 0.05, 'attack');
    expect(state.current).toBe('attack2');
    updateChibi(sprite, 0.05, 'skill');
    expect(state.current).toBe('skill2');
    updateChibi(sprite, 0.05, 'die');
    expect(state.current).toBe('die2');
  });

  it('★ 二阶段的普攻优先级按"基础动作"算：idle2 抢不走 attack2', () => {
    const { sprite, state } = makeChibi({ withPhase2: true });
    setChibiPhase(sprite, 2);
    updateChibi(sprite, 0.05, 'attack');
    expect(state.current).toBe('attack2');
    advance(sprite, 'attack', 0.2);
    const midway = state.frame;
    expect(midway).toBeGreaterThan(0);
    // mode 抖回 idle —— 该保持 attack2、并且不回到第 0 帧
    advance(sprite, 'idle', 0.05);
    expect(state.current).toBe('attack2');
    expect(state.frame).toBeGreaterThanOrEqual(midway);
  });

  it('★ 没有 _2 素材的棋子（普通干员 / 没做二阶段素材的野怪）行为完全不变', () => {
    const { sprite, state } = makeChibi({ withPhase2: false });
    setChibiPhase(sprite, 2);
    expect(state.current, '没有 idle2 就退回 idle').toBe('idle');
    updateChibi(sprite, 0.05, 'attack');
    expect(state.current).toBe('attack');
  });

  /*
    ★ 0.0.3：「倒地等复活」时阵亡动作要**停在倒地姿势**上。
    【为什么这条必须钉住？】
    敌人的阵亡序列帧是"演到消失"的 —— 实测“复仇者”的 die 最后两帧
    不透明像素 = 0（整只人已经没了）。照播到底，倒地那 5 秒里
    场上就是空的，玩家看到的就是"模型消失了"。
  */
  it('★ 倒地时阵亡动作停在倒地姿势，不会"化掉"（最后几帧是空的那只）', () => {
    // 12 帧的阵亡动作，模拟"最后 2 帧全透明"
    const { sprite, state } = makeChibi({ withPhase2: false, dieFrames: 12 });
    setChibiDowned(sprite, true);
    advance(sprite, 'die', 5); // 推足够长：正常会播到底
    expect(state.current).toBe('die');
    // 0.75 × 12 = 9 -> 最多停在帧 8（也就是"人还看得见"的那一帧）
    expect(state.frame).toBeLessThanOrEqual(8);
  });

  it('★ 站起来（rebirth）立刻切回待机，不再停在倒地姿势', () => {
    const { sprite, state } = makeChibi({ withPhase2: false, dieFrames: 12 });
    setChibiDowned(sprite, true);
    advance(sprite, 'die', 5);
    setChibiDowned(sprite, false);
    expect(state.current).toBe('idle');
    expect(state.frame).toBe(0);
  });

  /*
    ★ 0.0.3：倒地演出的**播放速度**可以按单位调（`reborn.downedAnimSpeed`）。
    【为什么杰斯顿要 2 倍速？】
    它的阵亡动作 C1_Die 有 4 秒，而它只倒地 3 秒 ——
    原速播"还没倒稳就到点了"。倍速只作用在**倒地期间的阵亡动作**上，
    站着打的时候一点影响都没有。
  */
  it('★ 倒地演出 2 倍速：同样的时间走到更靠后的帧；站起来后恢复原速', () => {
    const slow = makeChibi({ withPhase2: false, dieFrames: 24 });
    setChibiDowned(slow.sprite, true, 1);
    advance(slow.sprite, 'die', 0.5);

    const fast = makeChibi({ withPhase2: false, dieFrames: 24 });
    setChibiDowned(fast.sprite, true, 2);
    advance(fast.sprite, 'die', 0.5);

    expect(fast.state.frame).toBeGreaterThan(slow.state.frame);

    // 站起来之后倍率复位：下一次动作按原速播（不能"顺手把所有动作都快一倍"）
    setChibiDowned(fast.sprite, false);
    expect(fast.state.downedSpeed).toBe(1);
  });

  it('★ 不是倒地状态时，倍率一个字都不影响（站着打还是原速）', () => {
    const normal = makeChibi({ withPhase2: false });
    advance(normal.sprite, 'idle', 0.5);

    const withSpeed = makeChibi({ withPhase2: false });
    setChibiDowned(withSpeed.sprite, true, 2);
    setChibiDowned(withSpeed.sprite, false);
    advance(withSpeed.sprite, 'idle', 0.5);

    expect(withSpeed.state.frame).toBe(normal.state.frame);
  });

  it('重复设置同一个阶段是幂等的（不会把动画重置回第 0 帧）', () => {
    const { sprite, state } = makeChibi({ withPhase2: true });
    setChibiPhase(sprite, 2);
    updateChibi(sprite, 0.05, 'attack');
    advance(sprite, 'attack', 0.2);
    const midway = state.frame;
    setChibiPhase(sprite, 2);
    expect(state.frame).toBe(midway);
  });
});
