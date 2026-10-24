/**
 * ============================================================
 *  ★★ 0.2.2 蕾缪安 3 星锁定演出：曲线 + 注册表
 * ============================================================
 *
 * 真机上"瞄准镜会不会缩没、爆炸会不会炸到天外"很难靠眼睛发现 ——
 * 一局里可能就放一次技能，等你看清已经过去了。所以把三条曲线拆成纯函数在这里钉住：
 *   · 瞄准镜弹出的缩放（弹一下再落回 1，不能是负数）
 *   · 向内收缩的粉色光环（收到中心必须淡到 0，否则每圈结束会"啪"地消失一下）
 *   · 爆炸的主闪 / 冲击波 / 碎屑（起点小、终点大、结束透明）
 *
 * ★ 这里**不测贴图**（canvas 现画的，node 环境没有 document）——
 *   贴图对不对只能靠真机定格页看（见 MEMORY-特效 §8）。
 */
import { describe, expect, it } from 'vitest';
import {
  BURST_SECONDS,
  BURST_SPREAD,
  CONVERGE_FROM,
  CONVERGE_TO,
  LOCKON_FX,
  LOCKON_SNIPER,
  MARK_POP_SECONDS,
  MARK_RADIUS,
  burstFlashAt,
  burstShardAt,
  burstShockAt,
  convergeRingAt,
  isLockOnFx,
  lockOnMarkDiameterCells,
  lockOnStyleOf,
  markOpacityAt,
  markScaleAt,
} from '../src/three/lockon-fx.js';

describe('★ 0.2.2 锁定演出：注册表', () => {
  it('lockon_sniper 是合法 id，乱写的 id 被拒（但取色不返回 undefined）', () => {
    expect(LOCKON_FX).toContain(LOCKON_SNIPER);
    expect(isLockOnFx('lockon_sniper')).toBe(true);
    expect(isLockOnFx('lockon_不存在')).toBe(false);
    expect(isLockOnFx(undefined)).toBe(false);
    // ★ 兜底：不认识也得给一套配色，否则取色那一步会炸
    expect(lockOnStyleOf('lockon_不存在')).toBeTruthy();
    expect(lockOnStyleOf(null).burstPink).toBeTypeOf('number');
  });

  it('瞄准镜不能大过一格半（不然相邻两格会糊在一起）', () => {
    expect(lockOnMarkDiameterCells()).toBeGreaterThan(0.8);
    expect(lockOnMarkDiameterCells()).toBeLessThan(1.5);
  });

  it('★ 爆炸直径 1.5~3 格（3×3 落点的大半就够，再大就把隔壁也糊了）', () => {
    const diameterCells = (MARK_RADIUS * 2 * BURST_SPREAD) / 1 /* CELL = 1 */;
    expect(diameterCells).toBeGreaterThan(1.5);
    expect(diameterCells).toBeLessThan(3);
  });
});

describe('★ 0.2.2 锁定演出：瞄准镜', () => {
  it('弹出：0.62 起、弹过 1 再落回 1，全程不是负数', () => {
    expect(markScaleAt(0)).toBeCloseTo(0.62, 3);
    expect(markScaleAt(MARK_POP_SECONDS)).toBeCloseTo(1, 3);
    let peak = 0;
    for (let t = 0; t <= MARK_POP_SECONDS; t += 0.01) {
      const scale = markScaleAt(t);
      expect(scale, `t=${t.toFixed(2)} 出现负缩放`).toBeGreaterThan(0);
      peak = Math.max(peak, scale);
    }
    // 有"冲过一点"的手感（easeOutBack），但别冲太夸张
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThan(1.2);
    // 过了弹出期就稳住
    expect(markScaleAt(MARK_POP_SECONDS * 3)).toBeCloseTo(1, 3);
  });

  it('不透明度：淡入 → 常亮 → 寿命结束前淡完', () => {
    expect(markOpacityAt(0, 7)).toBeCloseTo(0, 3);
    expect(markOpacityAt(1, 7)).toBeGreaterThan(0.5);
    expect(markOpacityAt(7, 7)).toBeCloseTo(0, 3);
    /*
      常亮那一段（0.5s ~ 寿命 65%）一直在 0.6 以上 ——
      "不能忽明忽暗"。★ 最后 18% 是刻意淡出的，别把那段算进来。
    */
    for (let t = 0.5; t < 4.5; t += 0.25) {
      const opacity = markOpacityAt(t, 7);
      expect(opacity, `t=${t} 太暗（看起来像在闪）`).toBeGreaterThan(0.6);
      expect(opacity).toBeLessThanOrEqual(1);
    }
  });
});

describe('★ 0.2.2 锁定演出：向内收缩的粉色光环', () => {
  it('一圈：从外（1.55）收到中心（0.55），途中是可见的', () => {
    const start = convergeRingAt(0);
    const mid = convergeRingAt(0.5);
    const end = convergeRingAt(1);
    expect(start.scale).toBeCloseTo(CONVERGE_FROM, 3);
    expect(end.scale).toBeCloseTo(CONVERGE_TO, 3);
    expect(mid.scale).toBeLessThan(start.scale);
    expect(mid.scale).toBeGreaterThan(end.scale);
    // 起点和终点都必须透明 —— 否则循环接缝处会"啪"地闪一下
    expect(start.opacity).toBeCloseTo(0, 3);
    expect(end.opacity).toBeCloseTo(0, 3);
    expect(mid.opacity).toBeGreaterThan(0.3);
  });

  it('相位是循环的：越界值被夹住，不会算出负半径', () => {
    for (const phase of [-3, 2.5, Number.NaN]) {
      const at = convergeRingAt(phase);
      expect(Number.isFinite(at.scale)).toBe(true);
      expect(at.scale).toBeGreaterThan(0);
      expect(at.opacity).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('★ 0.2.2 锁定演出：粉色为主的爆炸', () => {
  it('主闪：从很小的一团炸到最大，结束时完全透明', () => {
    const start = burstFlashAt(0);
    const end = burstFlashAt(1);
    // ★ 峰值封在 0.88：加色混合下满不透明度会烧成纯白，粉色/金色全没了（真机踩过）
    expect(start.opacity).toBeLessThanOrEqual(0.9);
    expect(start.opacity).toBeGreaterThan(0.7);
    expect(start.scale).toBeLessThan(1);
    expect(end.opacity).toBeCloseTo(0, 3);
    expect(end.scale).toBeCloseTo(BURST_SPREAD, 3);
    // 单调放大（爆炸不能缩回去）
    let previous = 0;
    for (let t = 0; t <= 1; t += 0.05) {
      const scale = burstFlashAt(t).scale;
      expect(scale).toBeGreaterThanOrEqual(previous);
      previous = scale;
    }
  });

  it('冲击波：扩得比主闪更远（但不能扩到隔壁格），并且也会淡完', () => {
    expect(burstShockAt(1).scale).toBeGreaterThan(burstFlashAt(1).scale);
    // ★ 大过主闪的 1.3 倍就扩到隔壁格子上去了，看着像"打歪了"
    expect(burstShockAt(1).scale).toBeLessThan(burstFlashAt(1).scale * 1.3);
    expect(burstShockAt(1).opacity).toBeCloseTo(0, 3);
    expect(burstShockAt(0.2).opacity).toBeGreaterThan(0.3);
  });

  it('碎屑：同一片每次都走同一条轨迹（不用 Math.random），而且飞散了会淡', () => {
    const a = burstShardAt(0.4, 3);
    const b = burstShardAt(0.4, 3);
    expect(a).toEqual(b);
    expect(burstShardAt(0, 3).opacity).toBeCloseTo(1, 3);
    expect(burstShardAt(1, 3).opacity).toBeCloseTo(0, 3);
    // 飞出去的距离别太夸张（半径 0.62 的格子，撑死两三格）
    for (let seq = 0; seq < 8; seq++) {
      const far = burstShardAt(1, seq);
      expect(Math.hypot(far.dx, far.dz)).toBeLessThan(3);
    }
  });

  it('边界：NaN / 负数时间不会算出 NaN', () => {
    for (const t of [Number.NaN, -1, 5]) {
      expect(Number.isFinite(burstFlashAt(t).scale)).toBe(true);
      expect(Number.isFinite(burstShockAt(t).opacity)).toBe(true);
      const shard = burstShardAt(t, 1);
      expect(Number.isFinite(shard.dx)).toBe(true);
      expect(Number.isFinite(shard.dz)).toBe(true);
    }
    // 爆炸总时长是个正数（常量被改成 0 的话这里会红）
    expect(BURST_SECONDS).toBeGreaterThan(0.2);
  });
});
