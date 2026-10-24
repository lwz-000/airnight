/**
 * ============================================================
 *  ★★ 0.3.2 阿米娅升变技能特效：时间轴与接线
 * ============================================================
 *
 * 【为什么先测时间轴？】
 * 这三套特效的形状是"贴图 + 参数"，真正容易错的是**什么时候多亮**：
 * 爆闪峰值早了 40ms 就读成"方块先出来再闪"、晚了就叠在方格上糊成一片；
 * 即死那段总共 0.55 秒，三个阶段的边界错一点就变成火球或白碎玻璃。
 * 而这些全是**纯函数**（`xxxAlpha(ts)`），不起 three.js、不开 canvas 就能钉死。
 *
 * 【第二半测接线】
 * `replay.ts` 里那几行是"数据 → 画面"的唯一通路，少一行就是
 * "数据写了、注册表里有、测试全绿，但游戏里什么都不放"（0.2 踩过 4 次）。
 * 所以这里直接扫源码，数调用的**处数**。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  AMIYA_EXECUTE_FX,
  AMIYA_FORM_FX_IDS,
  AMIYA_REQUIEM_FX,
  AMIYA_VERDICT_FX,
  AMIYA_FX_CAP,
  EXECUTE_BURST_UNTIL,
  EXECUTE_CRACK_LIFE,
  EXECUTE_TOTAL_SECONDS,
  REQUIEM_FADE_IN,
  VERDICT_END_SECONDS,
  VERDICT_FLASH_END,
  VERDICT_FLASH_PEAK_AT,
  VERDICT_HOLD_UNTIL,
  executeBurstAlpha,
  executeCrackAlpha,
  executeShardAlpha,
  executeShardTravel,
  isExecuteFx,
  isRequiemFx,
  isVerdictFx,
  requiemEnvelope,
  verdictCellAlpha,
  verdictCellScale,
  verdictFlashAlpha,
  verdictHot,
} from '../src/three/amiya-form-fx.js';

const EPS = 1e-6;

describe('★ 0.3.2 慈悲愿景：3×4 方格阵的时间轴', () => {
  it('单格包络：0.18s 起满、1.35s 开始收、2.00s 归零（用户口径"2 秒后完全消失"）', () => {
    // 最近那一格（order 0）：一出现就开始涨
    expect(verdictCellAlpha(0, 0)).toBe(0);
    expect(verdictCellAlpha(0.09, 0)).toBeGreaterThan(0.4);
    expect(verdictCellAlpha(0.18, 0)).toBeCloseTo(1, 5);
    // 保持段：一直满
    for (const ts of [0.3, 0.8, 1.0, VERDICT_HOLD_UNTIL]) {
      expect(verdictCellAlpha(ts, 0), `ts=${ts}`).toBeCloseTo(1, 5);
    }
    // 收尾：越接近 2 秒越暗，到点归零
    expect(verdictCellAlpha(1.7, 0)).toBeLessThan(1);
    expect(verdictCellAlpha(1.7, 0)).toBeGreaterThan(0);
    expect(verdictCellAlpha(VERDICT_END_SECONDS, 0)).toBe(0);
    // 出了时间窗一律 0（不然会留下一个永远亮着的方格）
    expect(verdictCellAlpha(-0.1, 0)).toBe(0);
    expect(verdictCellAlpha(2.5, 0)).toBe(0);
  });

  it('逐列错开：远端格起亮更晚、熄灭更早', () => {
    const ts = 0.1;
    const near = verdictCellAlpha(ts, 0);
    const far = verdictCellAlpha(ts, 3);
    expect(far, '远端应该还没亮起来').toBeLessThan(near);
    // 保持段结束（1.35）之后一起开始收，但近端收得慢、远端收得快
    expect(verdictCellAlpha(VERDICT_HOLD_UNTIL, 0)).toBeCloseTo(1, 5);
    expect(verdictCellAlpha(1.45, 0)).toBeGreaterThan(verdictCellAlpha(1.45, 3));
    expect(verdictCellAlpha(1.45, 3)).toBeLessThan(0.8);
  });

  it('缩放：0.72 起、有过冲（>1）、0.22s 落回 1.0', () => {
    expect(verdictCellScale(0)).toBeCloseTo(0.72, 5);
    let peak = 0;
    for (let ts = 0; ts <= 0.22; ts += 0.005) peak = Math.max(peak, verdictCellScale(ts));
    expect(peak, '要有过冲（easeOutBack），线性放大看起来像"死板地撑开"').toBeGreaterThan(1.02);
    expect(verdictCellScale(0.22)).toBeCloseTo(1, 5);
    expect(verdictCellScale(0.5)).toBeCloseTo(1, 5);
  });

  it('★ 局部爆闪：峰值 0.92 落在 60ms，220ms 归零，且绝不铺满屏', () => {
    expect(verdictFlashAlpha(0)).toBe(0);
    expect(verdictFlashAlpha(VERDICT_FLASH_PEAK_AT)).toBeCloseTo(AMIYA_FX_CAP.verdictFlash, 5);
    expect(AMIYA_FX_CAP.verdictFlash, '只铺 12 格时可以开到 0.92；铺全屏 0.42 就糊住了').toBeCloseTo(0.92, 5);
    expect(verdictFlashAlpha(VERDICT_FLASH_END)).toBe(0);
    expect(verdictFlashAlpha(0.5)).toBe(0);
    // 任何时刻都不许超过峰值
    for (let ts = 0; ts <= 0.3; ts += 0.005) {
      expect(verdictFlashAlpha(ts)).toBeLessThanOrEqual(AMIYA_FX_CAP.verdictFlash + EPS);
    }
    // 峰值之后单调下降（不能出现"闪两下"）
    let last = Infinity;
    for (let ts = VERDICT_FLASH_PEAK_AT; ts <= VERDICT_FLASH_END; ts += 0.005) {
      const v = verdictFlashAlpha(ts);
      expect(v).toBeLessThanOrEqual(last + EPS);
      last = v;
    }
  });

  it('爆闪期"边框转白加粗"的强度从 1 线性衰减到 0', () => {
    expect(verdictHot(0)).toBeCloseTo(1, 5);
    expect(verdictHot(VERDICT_FLASH_END / 2)).toBeCloseTo(0.5, 5);
    expect(verdictHot(VERDICT_FLASH_END)).toBe(0);
    expect(verdictHot(1)).toBe(0);
  });
});

describe('★ 0.3.2 炉芯终曲：全场碎裂氛围的包络', () => {
  it('0.6s 淡入、末尾 1.2s 淡出、到点归零', () => {
    expect(requiemEnvelope(0, 10)).toBe(0);
    expect(requiemEnvelope(REQUIEM_FADE_IN, 10)).toBeCloseTo(1, 5);
    for (const ts of [1, 4, 8]) expect(requiemEnvelope(ts, 10), `ts=${ts}`).toBeCloseTo(1, 5);
    // 8.8s 开始淡
    expect(requiemEnvelope(8.8, 10)).toBeCloseTo(1, 5);
    expect(requiemEnvelope(9.4, 10)).toBeLessThan(1);
    expect(requiemEnvelope(9.4, 10)).toBeGreaterThan(0);
    expect(requiemEnvelope(10, 10)).toBe(0);
    expect(requiemEnvelope(11, 10)).toBe(0);
  });

  it('时长跟着技能数据走：8 秒的技能就从 6.8s 开始收、8s 收干净', () => {
    expect(requiemEnvelope(6.8, 8)).toBeCloseTo(1, 5);
    expect(requiemEnvelope(7.4, 8)).toBeCloseTo(0.5, 5);
    expect(requiemEnvelope(8, 8)).toBe(0);
    expect(requiemEnvelope(8.5, 8)).toBe(0);
  });
});

describe('★ 0.3.2 炉芯终曲：即死叠加（总 0.55s，三段）', () => {
  it('① 吞噬段只活 0.10 秒', () => {
    expect(executeBurstAlpha(0)).toBeCloseTo(1, 5);
    expect(executeBurstAlpha(EXECUTE_BURST_UNTIL)).toBe(0);
    expect(executeBurstAlpha(0.2)).toBe(0);
  });

  it('② 熔红裂纹活 0.45 秒', () => {
    expect(executeCrackAlpha(0)).toBeCloseTo(1, 5);
    expect(executeCrackAlpha(EXECUTE_CRACK_LIFE / 2)).toBeCloseTo(0.5, 5);
    expect(executeCrackAlpha(EXECUTE_CRACK_LIFE)).toBe(0);
    expect(executeCrackAlpha(0.5)).toBe(0);
  });

  it('③ 碎片 0.02s 才起步（避开爆闪最亮的几帧）、0.55s 归零', () => {
    expect(executeShardAlpha(0)).toBe(0);
    expect(executeShardAlpha(0.02)).toBeCloseTo(1, 5);
    expect(executeShardAlpha(EXECUTE_TOTAL_SECONDS)).toBe(0);
    expect(executeShardAlpha(0.6)).toBe(0);
  });

  it('碎片位移先快后慢（前半段就走掉大半，读起来像"被劈开"）', () => {
    expect(executeShardTravel(0.02)).toBe(0);
    expect(executeShardTravel(EXECUTE_TOTAL_SECONDS)).toBeCloseTo(1, 5);
    const half = executeShardTravel(0.02 + (EXECUTE_TOTAL_SECONDS - 0.02) / 2);
    expect(half, '匀速飞出去像箭头，先快后慢才像碎片').toBeGreaterThan(0.6);
  });

  it('三段无缝衔接：任何时刻至少有一层在亮', () => {
    for (let ts = 0; ts <= EXECUTE_TOTAL_SECONDS; ts += 0.01) {
      const total = Math.max(executeBurstAlpha(ts), executeCrackAlpha(ts), executeShardAlpha(ts));
      expect(total, `ts=${ts.toFixed(2)} 应该还有东西在亮`).toBeGreaterThan(0);
    }
  });
});

describe('★ 0.3.2 注册表判据', () => {
  it('三个 id 各自认得自己，且不认识别人的', () => {
    expect(isVerdictFx(AMIYA_VERDICT_FX)).toBe(true);
    expect(isVerdictFx(AMIYA_REQUIEM_FX)).toBe(false);
    expect(isRequiemFx(AMIYA_REQUIEM_FX)).toBe(true);
    expect(isRequiemFx(AMIYA_VERDICT_FX)).toBe(false);
    expect(isExecuteFx(AMIYA_EXECUTE_FX)).toBe(true);
    expect(isExecuteFx(undefined)).toBe(false);
    // 清单要覆盖这三套（`fx-registry.test.ts` 就是拿它当"合法 id"白名单的）
    expect([...AMIYA_FORM_FX_IDS].sort()).toEqual(
      [AMIYA_VERDICT_FX, AMIYA_REQUIEM_FX, AMIYA_EXECUTE_FX].sort(),
    );
  });
});

describe('★ 0.3.2 接线：replay 里那几条通路一条都不能少', () => {
  const replaySource = readFileSync(fileURLToPath(new URL('../src/three/replay.ts', import.meta.url)), 'utf8');

  it('三套特效都挂了（挂根节点 + 清空 + 每帧推进）', () => {
    expect(replaySource).toContain('attachAmiyaFormFxRoot(this.fxLayer)');
    expect(replaySource).toContain('clearAmiyaFormFx()');
    // ★ 推进必须在**两处**：正常播放 + "战斗结束了也要淡完"那条分支。
    //   少一处就会出现"最后一下是技能 ⇒ 方格阵/碎片定格在棋盘上"。
    expect(replaySource.match(/updateAmiyaFormFx\(deltaSeconds\)/g)?.length).toBe(2);
  });

  it('zone 事件里按 fx 分流到方格阵，格子由 withinShape 数（不自己推 rect）', () => {
    expect(replaySource).toContain('isVerdictFx(event.fx)');
    expect(replaySource).toContain('spawnVerdictGrid(specs');
    expect(replaySource).toContain('withinShape(from, event.cell, { col, row }, event.radius, event.shape');
  });

  it('cast 事件里按 fx 分流到全场氛围，时长读技能数据', () => {
    expect(replaySource).toContain('isRequiemFx(event.fx)');
    expect(replaySource).toContain('spawnRequiemAmbient(');
    expect(replaySource).toContain('skillCastSustainSecondsOf([...variant.effects');
  });

  it('executeFx 事件里按 fx 分流到即死叠加', () => {
    expect(replaySource).toContain("case 'executeFx'");
    expect(replaySource).toContain('isExecuteFx(event.fx)');
    expect(replaySource).toContain('spawnExecuteShard(');
  });

  it('★ 普攻弹道两条都在注册表里', () => {
    const tracerSource = readFileSync(
      fileURLToPath(new URL('../src/three/bolt-tracer-fx.ts', import.meta.url)),
      'utf8',
    );
    expect(tracerSource).toContain('amiya_mercy:');
    expect(tracerSource).toContain('amiya_core:');
    // 终曲是"黑色法术" ⇒ 必须走暗芯（加色混合下纯黑看不见）
    expect(tracerSource).toMatch(/amiya_core: bulletVariant\([^)]*coreSplit/);
  });
});
