/**
 * ============================================================
 *  攻击 / 技能动画的节奏（0.0.3 末）—— "动画跟着攻速走"
 * ============================================================
 *
 * 【用户的要求】
 *   1. 倍率 = 当前攻速 / 基准攻速，实时响应（含 buff / 羁绊 / 40 秒狂暴）；
 *   2. 节奏要和攻击频率一致 —— 动画与攻击间隔匹配；
 *   3. **命中帧要和伤害帧同步**（关键验收点）；
 *   4. 上下限夹住，别抽成幻灯片、也别变成慢动作；
 *   5. 攻速突变时不许跳帧 / 卡顿 / 动作突变。
 *
 * 【怎么验】
 *   时机全是纯计算（`three/attack-anim.ts`），所以这里直接断言数字：
 *   · 命中帧落在伤害帧那一刻（用"播放到命中帧所需时间 = 前摇"来验证）；
 *   · 整段挥击时长 ≈ 当前攻击间隔；
 *   · 上下限真的生效、平滑真的收敛且不过冲。
 *   最后一组用真实的小人状态机（同 chibi-anim.test.ts 的假 ctx 脚手架）
 *   跑一遍，确认"到了命中帧，帧号真的走到了那里"。
 */
import { describe, expect, it } from 'vitest';
import { Sprite, type CanvasTexture } from 'three';
import { TICKS_PER_SECOND, attackInterval } from '../../../packages/shared/src/index.js';
import {
  ANIM_SPEED_SMOOTH_SECONDS,
  ATTACK_ANIM_MAX_RATIO,
  ATTACK_ANIM_MIN_RATIO,
  SKILL_ANIM_MAX_RATIO,
  SWING_HIT_RATIO,
  attackAnimSpeed,
  attackIntervalSeconds,
  catchUpSwingSeconds,
  clampRatio,
  createSwingTiming,
  noteHit,
  skillAnimSpeed,
  smoothSpeed,
  stepSwing,
  swingDurationSeconds,
  swingWindupSeconds,
} from '../src/three/attack-anim.js';
import { chibiAnimSeconds, updateChibi, type ChibiMode } from '../src/three/chibi.js';

describe('★ 攻速 → 动画节奏：换算', () => {
  it('攻击间隔必须和内核同一套换算（1200 = 每秒 1 下 => 1.0 秒）', () => {
    expect(attackIntervalSeconds(1200)).toBeCloseTo(1.0, 6);
    expect(attackIntervalSeconds(1000)).toBeCloseTo(attackInterval(1000) / TICKS_PER_SECOND, 6);
    expect(attackIntervalSeconds(2400)).toBeCloseTo(0.5, 6);
    // 攻速越高间隔越短（单调）
    expect(attackIntervalSeconds(2400)).toBeLessThan(attackIntervalSeconds(1200));
  });

  it('★ 整段挥击的时长 = 当前攻击间隔（动画与攻击频率严格匹配）', () => {
    const natural = 1.2; // 素材的自然时长（下面用真实清单再验一遍）
    for (const [base, current] of [
      [1200, 1200],
      [1200, 1800],
      [1200, 2400],
      [1000, 1500],
      [1000, 900],
    ] as const) {
      const speed = attackAnimSpeed({ currentAttackSpeed: current, baseAttackSpeed: base, naturalSeconds: natural });
      expect(swingDurationSeconds(natural, speed), `${current} 攻速下：挥击时长应等于攻击间隔`).toBeCloseTo(
        attackIntervalSeconds(current),
        6,
      );
    }
  });

  it('★ 倍率跟着"当前攻速 / 白板攻速"走（阶跃间隔造成的偏差 <3%），并夹在上下限内', () => {
    const natural = 1.2;
    const baseFactor = natural / attackIntervalSeconds(1200); // 白板下的基准倍率
    const speedAt = (current: number): number =>
      attackAnimSpeed({ currentAttackSpeed: current, baseAttackSpeed: 1200, naturalSeconds: natural });

    expect(speedAt(1200)).toBeCloseTo(baseFactor, 6);
    expect(speedAt(2400) / speedAt(1200), '攻速翻倍 -> 倍率翻倍').toBeCloseTo(2, 6);
    // 内核间隔是 ceil() 出来的阶跃值，所以"减半"会有零点几个百分点的偏差
    expect(Math.abs(speedAt(900) / speedAt(1200) - 0.75), '攻速 0.75 倍').toBeLessThan(0.03);
    expect(speedAt(2400), '攻速越高倍率越大').toBeGreaterThan(speedAt(1200));
    expect(speedAt(1200)).toBeGreaterThan(speedAt(900));

    // 极端攻速被夹住（否则会抽成幻灯片 / 慢动作）
    const maxRatio = speedAt(4800) / baseFactor;
    expect(maxRatio).toBeCloseTo(ATTACK_ANIM_MAX_RATIO, 6);
    expect(speedAt(12000)).toBeCloseTo(speedAt(4800), 6);
    // 下限同理：攻速再低也被夹在 0.6 倍（阶跃间隔会让有效值差一点点）
    expect(Math.abs(speedAt(60) / baseFactor - ATTACK_ANIM_MIN_RATIO), '下限生效').toBeLessThan(0.03);
    expect(speedAt(30), '再慢也不会更慢了').toBeCloseTo(speedAt(60), 6);
    expect(clampRatio(Number.NaN, 0.6, 4)).toBe(0.6);
  });

  it('技能动作也跟攻速走，但夹得更紧', () => {
    expect(skillAnimSpeed(1200, 1200)).toBeCloseTo(1, 6);
    expect(skillAnimSpeed(2400, 1200)).toBeCloseTo(2, 6);
    expect(skillAnimSpeed(12000, 1200)).toBeCloseTo(SKILL_ANIM_MAX_RATIO, 6);
    expect(skillAnimSpeed(120, 1200)).toBeCloseTo(0.8, 6);
  });
});

describe('★ 命中帧 = 伤害帧', () => {
  it('前摇时长 = 动作播到命中帧所需时间（起手提前这么多）', () => {
    const natural = 1.2;
    const speed = 2;
    const windup = swingWindupSeconds(natural, speed);
    // 播了 windup 秒之后，动画时钟正好走到 SWING_HIT_RATIO 那一点
    expect((windup * speed) / natural, '命中那一刻动画进度').toBeCloseTo(SWING_HIT_RATIO, 6);
  });

  it('★ 预测起手：上一段挥完就立刻接上下一段（窗口首尾相接）', () => {
    const natural = 1.2;
    const interval = 1.0;
    let timing = noteHit(createSwingTiming(), 0.4, interval, natural);
    expect(timing.nextHitAt, '下一次命中 = 这次 + 攻击间隔').toBeCloseTo(1.4, 6);

    // 模拟"上一次挥击已经播完、而且还在节奏里"
    timing = { ...timing, swing: 0, speed: 1 };
    const speed = attackAnimSpeed({ currentAttackSpeed: 1200, baseAttackSpeed: 1200, naturalSeconds: natural });
    timing = { ...timing, speed };

    /*
      ★ 0.0.3 修正：起手判据不再是 `now >= nextHitAt - 前摇`。
      原因是"命中事件"和"渲染帧"不是同一套时钟：命中往往落在窗口结束的**同一帧**，
      那时候 `nextHitAt` 已经被推到下下次命中，判据当场变成假 ——
      整拍没有出手动作（用户报的"野怪攻击若干次后动画失效"就是这么来的）。
      现在只要"还在节奏里"，挥完就立刻接上：窗口恒等于攻击间隔，相位不会漂。
    */
    const restarted = stepSwing(timing, {
      now: 0.5,
      deltaSeconds: 1 / 60,
      naturalSeconds: natural,
      targetSpeed: speed,
      intervalSeconds: interval,
      enabled: true,
    });
    expect(restarted.swing, '还在节奏里就该接着挥').toBeGreaterThan(0);
    expect(restarted.swing, '这一段时长 = 动作自然时长 / 倍率').toBeCloseTo(
      swingDurationSeconds(natural, restarted.speed),
      6,
    );
  });

  it('★ 命中帧 = 伤害帧：连着打几拍，每一拍的命中都落在动作的 45% 处', () => {
    /*
      这一条是用户明确要求过的（"动画跟着攻速走、命中帧与伤害帧同步"）。
      单看一帧证明不了 —— 必须连着跑：第一拍补的是"本拍剩下的 55%"，
      把相位锁到"命中 = 45%"上，之后每一拍都必须保持住。
    */
    const natural = 1.2;
    const interval = 1.0;
    const speed = attackAnimSpeed({ currentAttackSpeed: 1200, baseAttackSpeed: 1200, naturalSeconds: natural });
    const dt = 1 / 60;
    let timing = createSwingTiming();
    let now = 0;
    let nextHitAt = interval;
    const phases: number[] = [];

    for (let i = 0; i < Math.round(6 / dt); i++) {
      now += dt;
      let hit = false;
      if (now >= nextHitAt) {
        hit = true;
        const duration = natural / Math.max(0.05, timing.speed);
        timing = noteHit(timing, now, interval, duration);
        nextHitAt += interval;
      }
      // 命中当帧：先算相位（1 - 剩余/总长 = 动作播到的比例），再推进
      if (hit) {
        const duration = natural / Math.max(0.05, timing.speed);
        phases.push(1 - timing.swing / duration);
      }
      const next = stepSwing(timing, {
        now,
        deltaSeconds: dt,
        naturalSeconds: natural,
        targetSpeed: speed,
        intervalSeconds: interval,
        enabled: true,
      });
      timing = { swing: next.swing, nextHitAt: next.nextHitAt, lastHitAt: next.lastHitAt, speed: next.speed };
    }

    expect(phases.length, '6 秒里应该打了好几拍').toBeGreaterThanOrEqual(4);
    // 第一拍是"补拍的剩余段"，相位天然对（就是 45%）；之后每一拍都该在 45% 附近
    for (const [i, phase] of phases.entries()) {
      expect(
        Math.abs(phase - SWING_HIT_RATIO),
        `第 ${i + 1} 拍的命中相位是 ${phase.toFixed(2)}（应该 ≈ ${SWING_HIT_RATIO}）`,
      ).toBeLessThan(0.12);
    }
  });

  it('★ 不攻击的单位 / 节奏断了的单位不会空挥', () => {
    const natural = 1.2;
    let timing = noteHit(createSwingTiming(), 1, 1, natural);
    timing = { ...timing, swing: 0 };
    const args = {
      now: 1.5,
      deltaSeconds: 1 / 60,
      naturalSeconds: natural,
      targetSpeed: 1,
      intervalSeconds: 1,
    };
    expect(stepSwing(timing, { ...args, enabled: false }).swing, '不会出手的单位').toBe(0);
    // 超过 3 个间隔没出过手（被眩晕/走位打断）→ 先别预测
    expect(stepSwing(timing, { ...args, now: 1 + 3 * 1 + 0.5, enabled: true }).swing).toBe(0);
    // 还在节奏里 → 接着挥
    expect(stepSwing(timing, { ...args, enabled: true }).swing).toBeGreaterThan(0);
  });

  it('真实命中兜底：预测没赶上时至少要有一次挥击（补的是本拍剩余段）', () => {
    const timing = createSwingTiming();
    const after = noteHit(timing, 3, 1, 0.8);
    // ★ 不是整段 0.8，而是"本拍剩下的 55%"：这样相位才能锁到"命中 = 45%"
    expect(after.swing, '命中那一刻手上没动作 -> 立刻补一次').toBeCloseTo(
      catchUpSwingSeconds(0.8),
      6,
    );
    // 手上已经有动作时不打断（否则就是"动作突变"）
    const again = noteHit({ ...after, swing: 0.5 }, 4, 1, 0.8);
    expect(again.swing).toBeCloseTo(0.5, 6);
  });
});

describe('★ 平滑与实时响应（不跳帧、不突变）', () => {
  it('倍率按时间常数逼近目标，且每帧变化有界（不会啪地跳过去）', () => {
    let speed = 1;
    const target = 3;
    const dt = 1 / 60;
    let maxJump = 0;
    for (let i = 0; i < 30; i++) {
      const next = smoothSpeed(speed, target, dt);
      maxJump = Math.max(maxJump, Math.abs(next - speed));
      speed = next;
      expect(speed, '不该过冲').toBeLessThanOrEqual(target + 1e-9);
    }
    expect(maxJump, '单帧变化不超过目标的 20%').toBeLessThan(target * 0.2);
    expect(speed, '0.5 秒后已经非常接近目标').toBeGreaterThan(target * 0.85);
  });

  it('★ 攻速突变（比如 40 秒狂暴）→ 0.3 秒内跟上，不跳变', () => {
    let speed = 1;
    const target = 2; // 狂暴：攻速翻倍
    const dt = 1 / 60;
    const steps = Math.ceil(0.3 / dt);
    for (let i = 0; i < steps; i++) speed = smoothSpeed(speed, target, dt);
    expect(speed / target, '0.3 秒内应达到九成以上').toBeGreaterThan(0.9);
    // 时间常数本身要够短（否则"实时响应"就成了慢半拍）
    expect(ANIM_SPEED_SMOOTH_SECONDS).toBeLessThanOrEqual(0.3);
  });
});

// ============================================================
//  和小人状态机对一遍：到命中时刻，帧号真的走到了"命中帧"
// ============================================================
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

/** 造一个"素材已就绪"的小人（同 chibi-anim.test.ts 的脚手架） */
function makeChibi(frames = 24, fps = 20) {
  const sprite = new Sprite();
  const { ctx, calls } = fakeCtx();
  const anims = {
    idle: { file: 'idle.png', frames: 8, fps: 10, loop: true },
    attack: { file: 'attack.png', frames, fps, loop: false },
    skill: { file: 'skill.png', frames: 12, fps: 20, loop: false },
    die: { file: 'die.png', frames: 12, fps: 10, loop: false },
  };
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

describe('★ 命中帧与伤害帧同步（真跑一遍小人状态机）', () => {
  it('按算出来的倍率播放，前摇结束时正好停在命中帧', () => {
    const frames = 24;
    const fps = 20;
    const { sprite, state } = makeChibi(frames, fps);
    const natural = chibiAnimSeconds(sprite, 'attack')!;
    expect(natural).toBeCloseTo(frames / fps, 6);

    const interval = attackIntervalSeconds(1200);
    const speed = attackAnimSpeed({ currentAttackSpeed: 1200, baseAttackSpeed: 1200, naturalSeconds: natural });
    const windup = swingWindupSeconds(natural, speed);

    // 从"起手"开始，按 60fps 播 windup 秒（和回放里每帧推进完全一致）
    let left = windup;
    while (left > 0) {
      const dt = Math.min(1 / 60, left);
      updateChibi(sprite, dt, 'attack', speed);
      left -= dt;
    }

    const hitFrame = Math.round((state.anims.attack.frames - 1) * SWING_HIT_RATIO);
    expect(state.current).toBe('attack');
    expect(
      Math.abs(state.frame - hitFrame),
      `命中时刻应该停在第 ${hitFrame} 帧附近，实际 ${state.frame}`,
    ).toBeLessThanOrEqual(1);
    expect(state.acc, '还没播完整套动作').toBeLessThan(state.anims.attack.frames / state.anims.attack.fps);
    expect(callsDrawing(), '每帧都真的重画了').toBe(true);

    function callsDrawing(): boolean {
      return state.drawnFrame >= 0;
    }
  });

  it('攻速快的干员：同一套动作走完得更早（节奏真的跟着变）', () => {
    const { sprite, state } = makeChibi(24, 20);
    const natural = chibiAnimSeconds(sprite, 'attack')!;
    const play = (speed: number): number => {
      let elapsed = 0;
      while (state.frame < state.anims.attack.frames - 1 && elapsed < 10) {
        updateChibi(sprite, 1 / 60, 'attack', speed);
        elapsed += 1 / 60;
      }
      return elapsed;
    };
    const slow = play(1);
    const fast = play(4);
    expect(fast, '4 倍速应该明显更快播完').toBeLessThan(slow / 2);
    expect(natural).toBeGreaterThan(0);
  });
});
