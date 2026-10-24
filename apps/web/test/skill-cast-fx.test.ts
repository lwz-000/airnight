/**
 * ============================================================
 *  ★★ 0.2.1 通用「技能释放」特效 —— 规则层测试
 * ============================================================
 *
 * 这一组守的是**不用开浏览器也能量出来**的那几条：
 *   1. **尺寸**：环的外径只比一个棋盘格大一点（用户口径），而且是按 `CELL` 推的；
 *   2. **被动技能不放**：纯被动的棋子 `hasActiveSkill` 为假 ⇒ 永远不会走到特效；
 *   3. **持续多久**：从技能数据里读，纯伤害技能不挂持续段；
 *   4. **不晃眼**：每层的峰值透明度都有上限，星芒只在"开启瞬间"存在；
 *   5. **阶段顺序**：起手 → 瞬间 → 持续 → 收尾，且收尾一定在往下走（不会回弹）。
 *
 * ★ 为什么这些值得单独测？
 * 因为"特效多大""持续多久"这两件事全靠人眼睛看，而人眼对"是不是比格子大"没有尺子；
 * 一旦有人在别的文件里又写了第二个尺寸/时长常量，画面会慢慢跑偏但没人发现。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { UNIT_DEFS, hasActiveSkill } from '../../../packages/shared/src/index.js';
import { CELL } from '../src/game/grid.js';
import {
  GLOW_PEAK_ALPHA,
  RAYS_PEAK_ALPHA,
  SHOCK_PEAK_ALPHA,
  SIGIL_PEAK_ALPHA,
  SKILL_CAST_CAST_SECONDS,
  SKILL_CAST_END_SECONDS,
  SKILL_CAST_HEARTBEAT_SECONDS,
  SKILL_CAST_IMPACT_SECONDS,
  SKILL_CAST_MAX_LIVE,
  SKILL_CAST_MAX_SUSTAIN_SECONDS,
  SKILL_CAST_RING_DIAMETER_OVER_CELL,
  STAR_PEAK_ALPHA,
  skillCastFrameAt,
  skillCastPhaseAt,
  skillCastRingRadius,
  skillCastSustainSecondsOf,
  skillCastTotalSeconds,
} from '../src/three/skill-cast-fx.js';

/** 20 tick = 1 秒（和内核一致，但这里写死一个数就等于没测到"从数据读"这件事） */
const TICKS_PER_SECOND = 20;

describe('① 尺寸：只比一个格子大一点', () => {
  it('★ 环的外径 = 1.18 格（用户口径），按 CELL 推而不是写死像素', () => {
    const diameter = skillCastRingRadius() * 2;
    expect(diameter / CELL, '外径除以一格 = 1.18').toBeCloseTo(SKILL_CAST_RING_DIAMETER_OVER_CELL, 6);
    expect(diameter / CELL, '不能比一格小').toBeGreaterThanOrEqual(1.0);
    expect(diameter / CELL, '★ 也不能大太多（"只比一个格子大一点"）').toBeLessThanOrEqual(1.35);
  });

  it('半径跟着 CELL 走（改了棋盘格尺寸，特效自动跟着改）', () => {
    // 用"比例"验：半径永远是 CELL 的 0.59 倍
    expect(skillCastRingRadius() / CELL).toBeCloseTo(SKILL_CAST_RING_DIAMETER_OVER_CELL / 2, 6);
  });
});

describe('② 被动技能不放这个特效', () => {
  /*
    【用户口径】「被动技能不要有这个特效」。
    判据是 shared 的 `hasActiveSkill`（技能条读的也是它）：`effects` 为空 = 纯被动。
    `replay.ts` 的 spawnSkillCast 第一行就是这个闸门 —— 这里钉住判据本身，
    免得以后有人在数据表里给被动棋子"补"了 effects，或者把闸门换成别的判断。
  */
  it('★ 纯被动的棋子 hasActiveSkill = false（夜莺：只有被动光环）', () => {
    const nightingale = UNIT_DEFS['op16']!;
    expect(nightingale.skill.effects, '夜莺的技能没有主动效果').toHaveLength(0);
    expect(hasActiveSkill(nightingale, 1), '所以不该有开技能的特效').toBe(false);
    expect(hasActiveSkill(nightingale, 3)).toBe(false);
  });

  it('有主动技能的棋子才是 true（对照组，别把闸门做成"谁都放"或"谁都不放"）', () => {
    // 随便挑一个肯定有主动效果的：玛恩纳 1 星（二连击 buff）
    const mlynar = UNIT_DEFS['op47']!;
    expect(hasActiveSkill(mlynar, 1)).toBe(true);
    // 若叶睦是"主动 + 被动"混合，也算有主动技能
    expect(hasActiveSkill(UNIT_DEFS['op51']!, 1)).toBe(true);
  });

  it('数据表里纯被动的棋子（effects 为空）不止一个 —— 闸门是必需的，不是保险', () => {
    const purePassive = Object.values(UNIT_DEFS).filter(
      (def) => def.skill.effects.length === 0 && def.skill.passive,
    );
    expect(purePassive.length, '至少夜莺这一档的纯被动棋子存在').toBeGreaterThan(0);
    for (const def of purePassive) expect(hasActiveSkill(def, 1)).toBe(false);
  });
});

describe('③ 持续多久：从技能数据读', () => {
  it('没有任何时长（纯伤害 / 召唤）⇒ 持续 0 秒', () => {
    expect(skillCastSustainSecondsOf([], 1)).toBe(0);
    expect(skillCastSustainSecondsOf([{ kind: 'damage' }], 1)).toBe(0);
  });

  it('buff 的 durationTicks ⇒ 秒（20 tick = 1 秒）', () => {
    expect(skillCastSustainSecondsOf([{ kind: 'buff', durationTicks: 10 * TICKS_PER_SECOND }], 1)).toBe(10);
  });

  it('★ 按星级取值（同一份数据 1/2/3 星不一样长）', () => {
    const effect = { kind: 'buff', durationTicks: [200, 300, 400] as [number, number, number] };
    expect(skillCastSustainSecondsOf([effect], 1)).toBe(10);
    expect(skillCastSustainSecondsOf([effect], 3)).toBe(20);
  });

  it('取最长的那一条（多段效果取 max，不是求和）', () => {
    const effects = [
      { kind: 'buff', durationTicks: 5 * TICKS_PER_SECOND },
      { kind: 'buff', durationTicks: 12 * TICKS_PER_SECOND },
    ];
    expect(skillCastSustainSecondsOf(effects, 1)).toBe(12);
  });

  it('★ 太长就夹到上限（防止 100 秒的技能挂一分钟光环）', () => {
    const huge = { kind: 'buff', durationTicks: 100 * TICKS_PER_SECOND };
    expect(skillCastSustainSecondsOf([huge], 1)).toBe(SKILL_CAST_MAX_SUSTAIN_SECONDS);
  });

  it('总时长 = 起手 + 瞬间 + 持续 + 收尾', () => {
    expect(skillCastTotalSeconds(0)).toBeCloseTo(
      SKILL_CAST_CAST_SECONDS + SKILL_CAST_IMPACT_SECONDS + SKILL_CAST_END_SECONDS,
      6,
    );
    expect(skillCastTotalSeconds(3)).toBeCloseTo(skillCastTotalSeconds(0) + 3, 6);
  });
});

describe('④ 不晃眼：峰值有上限、星芒不常驻', () => {
  /** 扫一遍整段，取每层的峰值 */
  function scan(sustain: number) {
    const total = skillCastTotalSeconds(sustain);
    const peak = { ring: 0, hex: 0, glow: 0, rays: 0, star: 0, shock: 0 };
    for (let t = 0; t <= total; t += 0.01) {
      const f = skillCastFrameAt(t, sustain);
      peak.ring = Math.max(peak.ring, f.ringAlpha);
      peak.hex = Math.max(peak.hex, f.hexAlpha);
      peak.glow = Math.max(peak.glow, f.glowAlpha);
      peak.rays = Math.max(peak.rays, f.raysAlpha);
      peak.star = Math.max(peak.star, f.starAlpha);
      peak.shock = Math.max(peak.shock, f.phase === 'impact' ? 1 : 0);
    }
    return peak;
  }

  it('★ 每一层的峰值都不超过自己那条常量（改大之前先想 8 人同时开技能）', () => {
    const peak = scan(6);
    expect(peak.ring).toBeLessThanOrEqual(SIGIL_PEAK_ALPHA + 1e-6);
    expect(peak.glow).toBeLessThanOrEqual(GLOW_PEAK_ALPHA + 1e-6);
    expect(peak.rays).toBeLessThanOrEqual(RAYS_PEAK_ALPHA + 1e-6);
    expect(peak.star).toBeLessThanOrEqual(STAR_PEAK_ALPHA + 1e-6);
  });

  it('★ 星芒只在"开启瞬间"存在，持续段一帧都没有', () => {
    const cast = SKILL_CAST_CAST_SECONDS;
    expect(skillCastFrameAt(cast * 0.5, 6).starAlpha, '起手时还没亮').toBeLessThan(0.2);
    expect(skillCastFrameAt(cast + SKILL_CAST_IMPACT_SECONDS * 0.3, 6).starAlpha, '瞬间是峰值').toBeGreaterThan(0.5);
    // 持续段：任何时刻都为 0
    for (let t = cast + SKILL_CAST_IMPACT_SECONDS; t < 6; t += 0.1) {
      expect(skillCastFrameAt(t, 6).starAlpha, `t=${t.toFixed(2)} 时星芒该是 0`).toBe(0);
    }
  });

  it('持续段的环比瞬间暗一档（不是一直用峰值亮着）', () => {
    const cast = SKILL_CAST_CAST_SECONDS;
    const impact = skillCastFrameAt(cast + 0.02, 6).ringAlpha;
    const sustain = skillCastFrameAt(cast + SKILL_CAST_IMPACT_SECONDS + 2, 6).ringAlpha;
    expect(sustain).toBeLessThan(impact * 0.75);
  });

  it('同时在播有上限（不叠成一锅粥）', () => {
    expect(SKILL_CAST_MAX_LIVE).toBeGreaterThan(0);
    expect(SKILL_CAST_MAX_LIVE).toBeLessThanOrEqual(12);
  });
});

describe('⑤ 阶段顺序与收尾', () => {
  it('四个阶段按顺序出现', () => {
    const sustain = 3;
    const cast = SKILL_CAST_CAST_SECONDS;
    const impactEnd = cast + SKILL_CAST_IMPACT_SECONDS;
    expect(skillCastPhaseAt(cast * 0.5, sustain)).toBe('charge');
    expect(skillCastPhaseAt(cast + 0.01, sustain)).toBe('impact');
    expect(skillCastPhaseAt(impactEnd + 0.5, sustain)).toBe('sustain');
    expect(skillCastPhaseAt(impactEnd + sustain + 0.01, sustain)).toBe('release');
  });

  it('★ 收尾一定是往下走（alpha 单调不增），不会回弹', () => {
    const sustain = 2;
    const releaseAt = SKILL_CAST_CAST_SECONDS + SKILL_CAST_IMPACT_SECONDS + sustain;
    let prev = Infinity;
    for (let t = releaseAt; t <= skillCastTotalSeconds(sustain); t += 0.02) {
      const f = skillCastFrameAt(t, sustain);
      expect(f.ringAlpha, `t=${t.toFixed(2)} 环不该变亮`).toBeLessThanOrEqual(prev + 1e-6);
      prev = f.ringAlpha;
    }
  });

  it('纯伤害技能：没有持续段，瞬间之后直接是收尾', () => {
    const sustain = 0;
    const impactEnd = SKILL_CAST_CAST_SECONDS + SKILL_CAST_IMPACT_SECONDS;
    expect(skillCastPhaseAt(impactEnd + 0.01, sustain)).toBe('release');
    expect(skillCastFrameAt(impactEnd + 0.05, sustain).ringAlpha).toBeGreaterThan(0);
  });

  it('整段结束后所有层都是 0（不会留一格残光）', () => {
    const total = skillCastTotalSeconds(2);
    const f = skillCastFrameAt(total + 0.01, 2);
    expect(f.ringAlpha).toBe(0);
    expect(f.hexAlpha).toBe(0);
    expect(f.glowAlpha).toBe(0);
    expect(f.raysAlpha).toBe(0);
    expect(f.starAlpha).toBe(0);
    expect(f.shockAge).toBeLessThan(0);
    expect(f.heartbeatAge).toBeLessThan(0);
  });

  it('持续段有"心跳环"（没它的话持续段看着像静止图）', () => {
    const cast = SKILL_CAST_CAST_SECONDS;
    const t = cast + SKILL_CAST_IMPACT_SECONDS + 0.3;
    const f = skillCastFrameAt(t, 6);
    expect(f.heartbeatAge).toBeGreaterThanOrEqual(0);
    expect(f.heartbeatAge).toBeLessThan(SKILL_CAST_HEARTBEAT_SECONDS);
  });
});

/**
 * ============================================================
 *  ★★ 0.2.1 用户报的「技能开启时的特效左下角有奇怪的方块光晕」
 * ============================================================
 *
 * 定位方法：`.fx-proposal/_castcheck.html` 用**真模块**跑真 three.js，
 * 逐层关掉（`?only=`）定格截图 —— 一眼看到那块硬边灰矩形就是**竖光柱**。
 *
 * 两个根因，各钉一条源码级断言（这类"画布边缘被裁"的问题是纯绘图层，
 * 在 Node 里没有 canvas 可测，只能钉住"那条画法不许回来"）：
 *   ① 竖光柱整层删掉了（贴图左右擦除渐变方向写反 ⇒ 硬边矩形）；
 *   ② 放射光条的长度必须留在画布内（超出会被裁成笔直的硬切口）。
 */
describe('⑤ 防回归：不许再出现"硬边方块"', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/three/skill-cast-fx.ts', import.meta.url)), 'utf8');

  it('竖光柱那一层已经删掉（它有硬边，加色下就是一块灰玻璃）', () => {
    expect(source, 'columnTexture 不许回来').not.toContain('columnTexture');
    expect(source, 'visual.column 不许回来').not.toContain('visual.column');
  });

  it('放射光条的长度必须夹在画布内（否则贴图边缘是一道硬切口）', () => {
    // 只认这一行：`const len = Math.min(TEX * 0.5 - 2, ...)`
    expect(source).toMatch(/const len = Math\.min\(TEX \* 0\.5 - 2,/);
  });
});

/**
 * ============================================================
 *  ★★ 0.2.1（用户报"陈的 5 连斩看不见"）—— 按次数算的持续时长不能估太短
 * ============================================================
 *
 * 赤刃明霄陈 3 星的技能是 `attacks: 1`（"下一次攻击打 5 连斩"），
 * 而她的攻击间隔约 1 秒。旧的估法是 `left * 0.5` = 0.5 秒 ⇒
 * 等真正砍出去时"技能生效窗口"已经过期，**斩击特效一次都不会播**。
 * 所以这条钉住：按次数算的至少要留出 1.5 秒/次。
 */
describe('⑥ 按次数算的持续时长（别把窗口估短）', () => {
  it('attacks: 1 的窗口至少 1.5 秒（够等到下一次攻击）', () => {
    expect(skillCastSustainSecondsOf([{ attacks: 1 }], 3)).toBeGreaterThanOrEqual(1.5);
  });

  it('attacks: 10 的窗口按 1.5 秒/次推（并仍然夹在上限里）', () => {
    expect(skillCastSustainSecondsOf([{ attacks: 10 }], 3)).toBeCloseTo(15, 6);
    expect(skillCastSustainSecondsOf([{ attacks: 40 }], 3)).toBe(SKILL_CAST_MAX_SUSTAIN_SECONDS);
  });
});
