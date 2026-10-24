/**
 * ============================================================
 *  ★ 0.1.4：攻击特效 —— 三个家族三套预设
 * ============================================================
 *
 * 【为什么这些值得测？】
 * 特效的"手感"靠肉眼，但**规则**全是数字：谁重谁轻、多大、多久、落在谁脚下。
 * 这些数字一旦被改坏，表现是"某类单位打起来没有打击感"——
 * 而那种问题在浏览器里盯一天也未必发现得了，因为它是**所有**该类单位一起变弱。
 * 所以这里把规则钉住：
 *   · 三个家族互斥、各自认得出；
 *   · 野怪一定比干员重、Boss 一定比普通野怪重、召唤物一定最轻；
 *   · 时长全部落在"和攻击前倾 0.18 / 弹道线 0.16 同量级"的区间里；
 *   · 动画曲线该单调的单调、端点和设计值一致。
 *
 * 最后一条是源码级防回归：阈值 `RANGED_ATTACK_FROM` 只允许有一处定义
 * （`attack-fx.ts`），`replay.ts` 必须 import 它 —— 两处各写一个 2，
 * 改了一处就会变成"弹道线画了但特效没画"这种对不上的事。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { UNIT_DEFS } from '../../../packages/shared/src/index.js';
import {
  FX_DURATION_RANGE,
  MAX_LIVE_ATTACK_FX,
  RANGED_ATTACK_FROM,
  ARC_SWEEP_RADIANS,
  arcScaleAt,
  arcSweepAt,
  attackFxPresetFor,
  burstScaleAt,
  fxFamilyOf,
  fxOpacityAt,
  ringScaleAt,
} from '../src/three/attack-fx.js';

const all = Object.values(UNIT_DEFS);
const anOperator = all.find((def) => !def.summonOnly && !def.monsterOnly)!;
const aMonster = all.find((def) => def.monsterOnly && def.monsterTier !== 'boss')!;
const aBoss = all.find((def) => def.monsterTier === 'boss')!;
const aSummon = all.find((def) => def.summonOnly)!;

describe('★ 0.1.4 攻击特效：家族判定', () => {
  it('干员 / 野怪 / 召唤物 三类各自认得出来，而且互斥', () => {
    expect(anOperator && aMonster && aBoss && aSummon, '三类都找得到（名单换了也要能测）').toBeTruthy();
    expect(fxFamilyOf(anOperator), 'op* 是干员').toBe('operator');
    expect(fxFamilyOf(aMonster), 'mn_* 是野怪').toBe('monster');
    expect(fxFamilyOf(aSummon), 'summon_* 是召唤物').toBe('summon');
  });
});

describe('★ 0.1.4 攻击特效：三个家族的分量', () => {
  it('干员近战：斩击弧落在**目标**身上，不画冲击环', () => {
    const preset = attackFxPresetFor(anOperator, { range: 1 });
    expect(preset.family).toBe('operator');
    expect(preset.arcAt, '贴脸打，弧要画在挨打的人身上').toBe('target');
    expect(preset.burstAt).toBe('target');
    expect(preset.ringScale, '干员没有"砸地"的分量，不该有冲击环').toBe(0);
    expect(preset.alpha).toBe(1);
  });

  it('干员远程：弧挪到**攻击者**脚下当枪口闪光（目标那头交给弹道线 + 爆点）', () => {
    const melee = attackFxPresetFor(anOperator, { range: 1 });
    const ranged = attackFxPresetFor(anOperator, { range: RANGED_ATTACK_FROM });
    expect(ranged.arcAt, '远处打人时弧要留在开枪的人脚下').toBe('attacker');
    expect(ranged.arcScale, '枪口闪光比斩击弧小一圈').toBeLessThan(melee.arcScale);
    expect(ranged.burstAt, '命中点还是要标出来').toBe('target');
  });

  it('野怪：一定有冲击环，而且整段比干员更"重"（更大、更久）', () => {
    const operator = attackFxPresetFor(anOperator, { range: 1 });
    const monster = attackFxPresetFor(aMonster, { range: 1 });
    expect(monster.ringScale, '野怪独有的一层：贴地冲击环').toBeGreaterThan(0);
    expect(monster.arcScale).toBeGreaterThan(operator.arcScale);
    expect(monster.burstScale).toBeGreaterThan(operator.burstScale);
    expect(monster.duration, '分量重 = 收得慢一点').toBeGreaterThan(operator.duration);
  });

  it('Boss 比普通野怪再大再久一档（它本体就比小怪大）', () => {
    const normal = attackFxPresetFor(aMonster, { range: 1 });
    const boss = attackFxPresetFor(aBoss, { range: 1 });
    expect(boss.family).toBe('monster');
    expect(boss.burstScale).toBeGreaterThan(normal.burstScale);
    expect(boss.ringScale).toBeGreaterThan(normal.ringScale);
    expect(boss.duration).toBeGreaterThanOrEqual(normal.duration);
  });

  it('召唤物最轻：三个家族里最小、最淡、收得最快', () => {
    const summon = attackFxPresetFor(aSummon, { range: 1 });
    const operator = attackFxPresetFor(anOperator, { range: 1 });
    const monster = attackFxPresetFor(aMonster, { range: 1 });

    expect(summon.arcScale).toBeLessThan(operator.arcScale);
    expect(summon.burstScale).toBeLessThan(operator.burstScale);
    expect(summon.duration).toBeLessThan(operator.duration);
    expect(summon.alpha, '召唤物要"虚"一点').toBeLessThan(1);
    expect(monster.arcScale, '顺便确认最重的还是野怪').toBeGreaterThan(operator.arcScale);
  });

  it('全部单位都能拿到一套合法预设，时长都落在同量级区间里', () => {
    for (const def of all) {
      const preset = attackFxPresetFor(def, { range: def.base.range });
      expect(preset.duration, `${def.name} 的特效时长`).toBeGreaterThanOrEqual(FX_DURATION_RANGE.min);
      expect(preset.duration, `${def.name}（${def.id}）的时长不该超过既有演出的量级`).toBeLessThanOrEqual(
        FX_DURATION_RANGE.max,
      );
      expect(preset.arcScale).toBeGreaterThan(0);
      expect(preset.burstScale).toBeGreaterThan(0);
      expect(preset.alpha).toBeGreaterThan(0);
      expect(preset.alpha).toBeLessThanOrEqual(1);
      expect(preset.ringScale).toBeGreaterThanOrEqual(0);
    }
  });

  it('同屏特效上限存在且够用但不过量（弱电脑要活）', () => {
    expect(MAX_LIVE_ATTACK_FX).toBeGreaterThanOrEqual(16);
    expect(MAX_LIVE_ATTACK_FX, '满编对轰每秒几十个特效，上限再高就白给了').toBeLessThanOrEqual(96);
  });
});

describe('★ 0.1.4 攻击特效：动画曲线', () => {
  it('贴地弧：先张开后余势，全程单调不缩回', () => {
    const points = [0, 0.1, 0.2, 0.35, 0.6, 0.9, 1].map(arcScaleAt);
    for (let i = 1; i < points.length; i++) {
      expect(points[i]!, '弧不该中途缩回去').toBeGreaterThanOrEqual(points[i - 1]!);
    }
    expect(arcScaleAt(0)).toBeCloseTo(0.72, 5);
    expect(arcScaleAt(1)).toBeCloseTo(1.12, 5);
  });

  it('命中爆点：先冲到最大再收一点（冲的那一下才像"打中"）', () => {
    expect(burstScaleAt(0)).toBeCloseTo(0.45, 5);
    expect(burstScaleAt(0.25), '峰值出现在四分之一处').toBeCloseTo(1.15, 5);
    expect(burstScaleAt(1)).toBeCloseTo(1.0, 5);
    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 1]) {
      expect(burstScaleAt(t)).toBeLessThanOrEqual(1.1501);
    }
  });

  it('冲击环：匀速外扩（像水波，速度恒定才像"冲出去"）', () => {
    expect(ringScaleAt(0)).toBeCloseTo(0.35, 5);
    expect(ringScaleAt(1)).toBeCloseTo(1.0, 5);
    expect(ringScaleAt(0.5) - ringScaleAt(0)).toBeCloseTo(ringScaleAt(1) - ringScaleAt(0.5), 5);
  });

  it('贴地弧会"扫过去"（这才是斩击感），左右对称、幅度受控', () => {
    expect(arcSweepAt(0)).toBeCloseTo(-ARC_SWEEP_RADIANS / 2, 5);
    expect(arcSweepAt(0.5), '中点回到瞄准方向').toBeCloseTo(0, 5);
    expect(arcSweepAt(1)).toBeCloseTo(ARC_SWEEP_RADIANS / 2, 5);
    // 幅度太大就会看起来像转盘/雷达，而不是"挥了一下"
    expect(ARC_SWEEP_RADIANS).toBeLessThan(Math.PI / 3);
  });

  it('透明度：开头一小段保持峰值（免得薄片"闪一下"像掉帧），之后线性淡出到 0', () => {
    expect(fxOpacityAt(0, 1)).toBe(1);
    expect(fxOpacityAt(0.2, 1)).toBe(1);
    expect(fxOpacityAt(1, 1)).toBe(0);
    expect(fxOpacityAt(0.5, 0.6)).toBeLessThan(0.6);
    // alpha 是个"整体透明度"，乘在曲线上
    expect(fxOpacityAt(0, 0.6)).toBeCloseTo(0.6, 5);
    // 越界的进度不许算出负透明度（浮点误差会让 progress 略大于 1）
    expect(fxOpacityAt(1.4, 1)).toBe(0);
    expect(fxOpacityAt(-0.2, 1)).toBe(1);
  });
});

describe('★ 0.1.4 攻击特效：接线不能走散（源码级）', () => {
  const replaySrc = readFileSync(fileURLToPath(new URL('../src/three/replay.ts', import.meta.url)), 'utf8');

  it('"多远算远程"的阈值只有一处定义 —— replay 必须 import，不许自己再写一个', () => {
    expect(replaySrc, 'replay 要从 attack-fx 引入阈值').toContain('RANGED_ATTACK_FROM');
    expect(replaySrc, '不许在 replay 里再定义一份（改一处漏一处 = 弹道线画了特效没画）').not.toMatch(
      /const RANGED_ATTACK_FROM\s*=/,
    );
  });

  it('attack 事件处真的会生成特效，而且特效要在"播完之后继续淡出"那条路上被推进', () => {
    expect(replaySrc, 'attack 事件要调 spawnAttackFx').toContain('spawnAttackFx');
    expect(replaySrc, '每帧推进特效').toContain('updateAttackFx');
  });

  it('重开一局要清空特效（否则薄片会残留在棋盘上）', () => {
    expect(replaySrc, 'reset 时要 clearAttackFx').toContain('this.clearAttackFx()');
  });

  it('★ 战斗播完之后仍要继续推进特效 —— 否则最后一下的火花会永远贴在地板上', () => {
    /*
      这是范围框踩过的坑（见 docs/进度与现状.md 的"打完最后一下的特效不淡出"）：
      `advance()` 在"播完"之后直接 return，于是靠"每帧推进"来淡出的特效就停住了 ——
      那个框会一直留在地板上，直到进入下一局才消失，看起来像卡了个贴图。
      攻击特效同样靠每帧推进淡出，所以必须也在那个分支里被推进。
    */
    const finishedAt = replaySrc.indexOf('if (this.finished) {');
    expect(finishedAt, 'replay 里应该有"战斗已播完"的分支').toBeGreaterThan(0);
    const finishedBlock = replaySrc.slice(finishedAt, finishedAt + 700);
    expect(finishedBlock, '"播完"分支里必须继续推进攻击特效').toContain('updateAttackFx');
  });
});
