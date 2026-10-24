/**
 * ============================================================
 *  ★★ 0.2.2 近战受击痕：颜色匹配 + 尺寸 + 曲线
 * ============================================================
 *
 * 用户要求：「根据本次攻击斩击特效的颜色**自动匹配**受击特效颜色，确保两者颜色一致；
 * 尺寸保持较小、不遮挡角色；统一封装，覆盖所有近战攻击来源与新出现的敌人，
 * 避免遗漏或颜色不匹配」。
 *
 * 这里钉死四件事：
 *  ① **取色顺序**：这一次真播的斩击 > 数据里的 combatFx > 队伍色兜底；
 *  ② **不遗漏**：所有"用斩击贴图打人"的近战单位都能解析出**贴图那一档**的颜色
 *     （不是悄悄掉到队伍色 —— 那正是"颜色不匹配"）；
 *  ③ **不遮挡**：受击痕直径明显小于卡面宽，加色层只加光不盖色块；
 *  ④ **★ 0.3.2 墨样式**：阿米娅·青色怒火的黑墨刃 → 受击痕也是**黑**的
 *     （普通混合墨底 —— 加色下纯黑不可见，这是整套黑特效成立的前提）。
 */
import { describe, expect, it } from 'vitest';
import { UNIT_DEFS } from '../../../packages/shared/src/index.js';
import { FX_GLOW_COLORS, RANGED_ATTACK_FROM } from '../src/three/attack-fx.js';
import { COMBAT_FX, combatFxIdsOf } from '../src/three/sequence-fx.js';
import {
  MELEE_HIT_LENGTH,
  MELEE_HIT_SECONDS,
  MELEE_HIT_THICKNESS,
  MELEE_SLASH_STYLES,
  isMeleeAttack,
  meleeHitFallbackColorOf,
  meleeHitJitterOf,
  meleeHitOpacityAt,
  meleeHitScaleAt,
  meleeHitStyleOf,
  meleeHitTiltOf,
} from '../src/three/melee-hit-fx.js';

/** 卡面世界宽度（约 0.9 格）—— "不遮挡角色"的参照物 */
const CARD_WIDTH_CELLS = 0.9;

describe('★ 0.2.2 近战受击痕：颜色自动匹配', () => {
  it('① 这一次真播的斩击优先：赤红/深黄/银白各自对上', () => {
    expect(meleeHitStyleOf(['slash_red'], undefined, 0)).toEqual(MELEE_SLASH_STYLES['slash_red']);
    expect(meleeHitStyleOf(['slash_gold'], undefined, 1)).toEqual(MELEE_SLASH_STYLES['slash_gold']);
    expect(meleeHitStyleOf(['slash_single'], undefined, 0)).toEqual(MELEE_SLASH_STYLES['slash_single']);
  });

  it('② 没有显式 id 时，按数据里的 combatFx 反查（melee_slash_* → slash_*）', () => {
    expect(meleeHitStyleOf([], 'melee_slash_red', 0)).toEqual(MELEE_SLASH_STYLES['slash_red']);
    expect(meleeHitStyleOf([], 'melee_slash_gold', 0)).toEqual(MELEE_SLASH_STYLES['slash_gold']);
    expect(meleeHitStyleOf([], 'melee_slash', 0)).toEqual(MELEE_SLASH_STYLES['slash_single']);
  });

  it('③ 两者都认不出（野怪 / 召唤物 / 没写 combatFx）才用队伍色兜底', () => {
    expect(meleeHitStyleOf([], undefined, 0)).toEqual({ color: FX_GLOW_COLORS[0] });
    expect(meleeHitStyleOf([], undefined, 1)).toEqual({ color: FX_GLOW_COLORS[1] });
    // 兜底也必须是"攻击弧用的那个颜色"，否则又变成两套色
    expect(meleeHitFallbackColorOf(0)).toBe(FX_GLOW_COLORS[0]);
    // 不相干的命中图（夕的黑墨、天火的橙爆）不该被当成斩击色
    expect(meleeHitStyleOf(['ink_burst_light'], undefined, 1)).toEqual({ color: FX_GLOW_COLORS[1] });
  });

  it('★ 技能期换了斩击就跟着换色（先看真播了什么，再看数据）', () => {
    // 一个数据里是银白斩击的单位，开技能后播的是赤红那套
    expect(meleeHitStyleOf(['slash_red'], 'melee_slash', 0)).toEqual(MELEE_SLASH_STYLES['slash_red']);
  });

  it('★★ 0.3.2 阿米娅·青色怒火：黑墨刃的受击痕也是黑的（普通混合 + 墨底）', () => {
    const ink = MELEE_SLASH_STYLES['amiya_cyan_ink'];
    expect(ink, '黑墨样式必须登记（否则她的受击痕掉到队伍色，和黑刃对不上）').toBeTruthy();
    // 普攻和技能那几刀都带这一层 ⇒ 两条路都要解析出墨样式
    expect(meleeHitStyleOf(['amiya_cyan_ink'], undefined, 0)).toEqual(ink);
    expect(meleeHitStyleOf([], 'amiya_cyan_slash', 0)).toEqual(ink);
    // ★★★ 混合方式：黑必须是普通混合。写成加色 = 全黑不可见，等于没有受击特效。
    expect(ink!.blend, '黑痕必须是 normal 混合（加色下纯黑不可见）').toBe('normal');
    expect(ink!.ink).toBeDefined();
  });

  it('★ 覆盖检查：所有"用斩击贴图"的近战单位都能解析到**贴图那一档**的颜色', () => {
    const meleeSlashUsers = Object.entries(UNIT_DEFS).filter(([, def]) => {
      if (def.base.range >= RANGED_ATTACK_FROM) return false;
      const binding = def.combatFx ? COMBAT_FX[def.combatFx] : undefined;
      return combatFxIdsOf(binding?.hit).some((id) => id in MELEE_SLASH_STYLES);
    });
    expect(meleeSlashUsers.length, '前提：确实有一批近战在用斩击贴图').toBeGreaterThan(3);
    for (const [id, def] of meleeSlashUsers) {
      const style = meleeHitStyleOf([], def.combatFx, 0);
      const resolved = Object.values(MELEE_SLASH_STYLES).some((s) => s.color === style.color && s.blend === style.blend);
      expect(
        resolved,
        `${id} 的受击色掉到了队伍色兜底（说明 combatFx=${def.combatFx} 没对上斩击表）`,
      ).toBe(true);
    }
  });

  it('★ "算不算近战"只看射程（和弹道线同一个阈值），所以新单位自动对上', () => {
    // 射程 1 = 近战；射程 ≥ 2 = 远程（和 RANGED_ATTACK_FROM 同源）
    expect(isMeleeAttack(1)).toBe(true);
    expect(isMeleeAttack(RANGED_ATTACK_FROM)).toBe(false);
    expect(isMeleeAttack(3)).toBe(false);
    // 越界值别算成近战（0 / 负数 / NaN 都不该冒受击痕）
    expect(isMeleeAttack(Number.NaN)).toBe(false);
    // 数据里每个近战单位都判成近战、每个远程都判成远程 —— 不用维护名单
    for (const [id, def] of Object.entries(UNIT_DEFS)) {
      expect(isMeleeAttack(def.base.range), `${id} 的射程 ${def.base.range} 判错了`).toBe(
        def.base.range < RANGED_ATTACK_FROM,
      );
    }
  });

  it('★ 覆盖检查：近战单位写了 combatFx 的，绑定必须存在（写错会静默掉成队伍色）', () => {
    for (const [id, def] of Object.entries(UNIT_DEFS)) {
      if (def.base.range >= RANGED_ATTACK_FROM) continue;
      if (!def.combatFx) continue;
      const binding = COMBAT_FX[def.combatFx];
      expect(binding, `${id} 的 combatFx=${def.combatFx} 不在 COMBAT_FX 表里`).toBeTruthy();
      expect(combatFxIdsOf(binding?.hit).length, `${id} 的 combatFx 没有命中层`).toBeGreaterThan(0);
    }
  });
});

describe('★ 0.2.2 近战受击痕：细、不遮挡', () => {
  /*
    ★ 用户二改口径（带参考图）：要的是**一条又细又直的斩痕**，不是半月弧。
    所以"不遮挡"不再靠"整个圆都小"，而是靠**细**：长度可以接近卡面宽，
    但厚度只有五分之一 ⇒ 斜着一划盖住的面积不到一成。
  */
  it('长度齐卡面宽（0.9 格），厚度只有它的五分之一', () => {
    const maxLength = MELEE_HIT_LENGTH * meleeHitScaleAt(1); // 峰值那一刻最长
    expect(maxLength).toBeLessThan(CARD_WIDTH_CELLS);
    expect(maxLength).toBeGreaterThan(CARD_WIDTH_CELLS * 0.6);
    expect(MELEE_HIT_THICKNESS).toBeLessThan(0.25);
    // 细长比：参考图那种"细尾 + 亮头"大约 4:1
    expect(MELEE_HIT_LENGTH / MELEE_HIT_THICKNESS).toBeGreaterThan(3);
  });

  it('遮挡面积远小于卡面（一成左右），因此不会糊住角色', () => {
    const covered = MELEE_HIT_LENGTH * MELEE_HIT_THICKNESS;
    const card = CARD_WIDTH_CELLS * CARD_WIDTH_CELLS;
    expect(covered / card).toBeLessThan(0.2);
  });

  it('持续时间在"攻击特效"那一档（0.12~0.3 秒），不会挂太久', () => {
    expect(MELEE_HIT_SECONDS).toBeGreaterThanOrEqual(0.12);
    expect(MELEE_HIT_SECONDS).toBeLessThanOrEqual(0.3);
  });

  it('缩放：55% 起、冲到 1.06、结尾稳在 1.06 左右（不缩回 0）', () => {
    expect(meleeHitScaleAt(0)).toBeCloseTo(0.55, 3);
    expect(meleeHitScaleAt(1)).toBeCloseTo(1.06, 3);
    let previous = 0;
    for (let t = 0; t <= 1; t += 0.05) {
      const scale = meleeHitScaleAt(t);
      expect(scale).toBeGreaterThanOrEqual(previous);
      previous = scale;
    }
  });

  it('透明度：前 25% 满亮、结尾为 0，且峰值不超过 0.9（加色别烧白、墨别糊死人）', () => {
    expect(meleeHitOpacityAt(0)).toBeCloseTo(0.9, 3);
    expect(meleeHitOpacityAt(0.2)).toBeCloseTo(0.9, 3);
    expect(meleeHitOpacityAt(1)).toBeCloseTo(0, 3);
    for (let t = 0; t <= 1; t += 0.05) {
      expect(meleeHitOpacityAt(t)).toBeLessThanOrEqual(0.9);
      expect(meleeHitOpacityAt(t)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('★ 0.2.2 近战受击痕：朝向与确定性', () => {
  it('倾斜角 = 屏幕角 + 90°（刀横着切过身体），抖动不会把角度搞崩', () => {
    expect(meleeHitTiltOf(0, 0)).toBeCloseTo(Math.PI / 2, 6);
    expect(meleeHitTiltOf(Math.PI / 2, 0)).toBeCloseTo(Math.PI, 6);
    for (const jitter of [-1, -0.3, 0, 0.5, 1]) {
      expect(Number.isFinite(meleeHitTiltOf(1.2, jitter))).toBe(true);
    }
    // NaN 兜底（相机投影退化时可能传进来）
    expect(Number.isFinite(meleeHitTiltOf(Number.NaN, Number.NaN))).toBe(true);
  });

  it('抖动是"确定性伪随机"：同一组 id 永远同一结果，且在 -1..1', () => {
    for (const seed of [0, 7, 12345, 99991]) {
      const first = meleeHitJitterOf(seed);
      expect(first).toBe(meleeHitJitterOf(seed));
      expect(first).toBeGreaterThanOrEqual(-1);
      expect(first).toBeLessThanOrEqual(1);
    }
    // 不同 seed 有差异（不是常数）
    expect(meleeHitJitterOf(1)).not.toBe(meleeHitJitterOf(2));
  });
});
