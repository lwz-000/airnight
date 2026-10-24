/**
 * ============================================================
 *  ★★ 0.2.1：回血光环（夜莺 绿 / 魔王 粉）—— 纯计算部分
 * ============================================================
 *
 * 【测什么】
 *   这个模块的"画"那一半（RingGeometry + canvas 画的 `+++` / `🗡+`）
 *   只能靠真机截图验收；但下面这些**数学性质**是可钉死的：
 *   · 注册表兜底（id 不认识时会不会炸）；
 *   · 半径和范围白框同源（两套半径就是"光环圈住 5×5、白框圈住 3×3"的事故）；
 *   · 底环永远留一点亮度（忽明忽暗会被当成特效卡了）；
 *   · 波环只往大里扩、扩到边上必然淡完（不淡完就是一圈卡在边上的死环）；
 *   · 符号首尾透明、不会飘出 `HEAL_HALO_SYMBOL_RISE`（飘天外就是"符号满屏乱飞"）；
 *   · `haloSparkAt` 平时必须**恒为 0**（免死专属层，否则白花 GPU）。
 */
import { describe, expect, it } from 'vitest';
import {
  HEAL_HALO_BOOST_GLOW,
  HEAL_HALO_CAP,
  HEAL_HALO_FX,
  HEAL_HALO_GREEN,
  HEAL_HALO_PINK,
  HEAL_HALO_RADIUS,
  HEAL_HALO_SECONDS,
  HEAL_HALO_SYMBOL_COUNT,
  HEAL_HALO_SYMBOL_RISE,
  healHaloStyleOf,
  haloBaseOpacityAt,
  haloSymbolAt,
  haloSparkAt,
  haloWaveAt,
  haloWorldRadius,
  isHealHaloFx,
} from '../src/three/heal-halo-fx.js';
import { letoRingRadius } from '../src/three/leto-scythe-fx.js';
import { zoneWorldRadius } from '../src/game/grid.js';

describe('★ 回血光环：注册表', () => {
  it('★ 两种配色都在合法 id 表里（夜莺绿 / 魔王粉）', () => {
    expect(HEAL_HALO_FX).toContain(HEAL_HALO_GREEN);
    expect(HEAL_HALO_FX).toContain(HEAL_HALO_PINK);
  });

  it('★★ `isHealHaloFx()` 是唯一判据：认得两种，别的一律不认', () => {
    expect(isHealHaloFx('heal_halo_green')).toBe(true);
    expect(isHealHaloFx('heal_halo_pink')).toBe(true);
    for (const other of [undefined, null, '', 'heal_halo_blue', 'heal', 'stream_heal', 'note']) {
      expect(isHealHaloFx(other), `${String(other)} 不该被当成回血光环`).toBe(false);
    }
  });

  it('★ 不认识的 id 退回绿色，绝不返回 undefined（否则取色那步会炸）', () => {
    expect(healHaloStyleOf('heal_halo_blue')).toEqual(healHaloStyleOf(HEAL_HALO_GREEN));
    expect(healHaloStyleOf(undefined)).toEqual(healHaloStyleOf(HEAL_HALO_GREEN));
    expect(healHaloStyleOf(null)).toEqual(healHaloStyleOf(HEAL_HALO_GREEN));
  });

  it('★★ 两种配色的颜色和符号都不同（用户口径：一个 `+++`、一个 `🗡+`）', () => {
    const green = healHaloStyleOf(HEAL_HALO_GREEN);
    const pink = healHaloStyleOf(HEAL_HALO_PINK);
    expect(green.ring).not.toBe(pink.ring);
    expect(green.wave).not.toBe(pink.wave);
    expect(green.glyph).not.toBe(pink.glyph);
    expect(green.text).not.toBe(pink.text);
    // 用户原话：绿色 `+++`；魔王加 `🗡+` 表示加攻击力
    expect(green.text).toContain('+');
    expect(pink.text).toContain('+');
    expect(pink.text).toContain('🗡');
  });
});

describe('★★ 半径：光环不能自己另算一套', () => {
  it('★★ 与范围白框（`zoneWorldRadius`）同一个数（两套半径 = 圈错范围的事故源）', () => {
    for (const radius of [0, 1, 2, 3, 5]) {
      expect(haloWorldRadius(radius)).toBe(zoneWorldRadius(radius));
    }
  });

  it('★★ 与血镰光环同一个数（同屏两种"脚下的圈"直径必须一致）', () => {
    for (const radius of [0, 1, 2, 3]) {
      expect(haloWorldRadius(radius)).toBe(letoRingRadius(radius));
    }
  });

  it('★ 半径含半格补偿（2 格射程 = 5×5 的框），且随半径单调变宽', () => {
    // zoneWorldRadius(r) = (r + 0.5) * CELL
    expect(haloWorldRadius(2)).toBeGreaterThan(haloWorldRadius(1));
    expect(haloWorldRadius(2) / haloWorldRadius(1)).toBeGreaterThan(1.5);
  });

  it('★ 默认半径是 2（5×5，和两人常态脉冲一致）', () => {
    expect(HEAL_HALO_RADIUS).toBe(2);
  });

  it('★ 负半径 / NaN 不产生负几何（RingGeometry 会炸）', () => {
    expect(haloWorldRadius(-3)).toBeGreaterThan(0);
    expect(Number.isFinite(haloWorldRadius(Number.NaN))).toBe(true);
  });
});

describe('★ 生命期：必须比脉冲间隔长', () => {
  it('★ 一圈活 1.4 秒 ⇒ 大于 1 秒的脉冲节拍（否则一明一暗地闪）', () => {
    expect(HEAL_HALO_SECONDS).toBeGreaterThan(1);
    // 也别太长，否则人死了光环还挂着
    expect(HEAL_HALO_SECONDS).toBeLessThan(2.5);
  });
});

describe('★ 底环亮度：一直在，但别过曝', () => {
  it('★★ 全程都 > 0.25（忽明忽暗会被当成"特效卡了"）', () => {
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      expect(haloBaseOpacityAt(t), `t=${t}`).toBeGreaterThan(0.25);
    }
  });

  it('★ 不超上限（`HEAL_HALO_CAP.base`），非免死时也不会封到 1', () => {
    for (let i = 0; i <= 40; i++) {
      expect(haloBaseOpacityAt(i / 40)).toBeLessThanOrEqual(HEAL_HALO_CAP.base + 1e-9);
    }
  });

  it('★ 免死时更亮（用户口径「光环更闪亮」的亮度那一半）', () => {
    let boostedHigher = 0;
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      if (haloBaseOpacityAt(t, true) > haloBaseOpacityAt(t, false) + 1e-9) boostedHigher++;
    }
    expect(boostedHigher, 'boost 至少要在一半以上的采样点更亮').toBeGreaterThan(10);
  });

  it('★ 提亮倍率真的生效（没被 1 全夹住才有意义）', () => {
    const plain = haloBaseOpacityAt(0.5, false);
    const boosted = haloBaseOpacityAt(0.5, true);
    expect(boosted).toBeGreaterThan(plain);
    // 上限仍然是 1（再加就得靠 spark 层，见下面）
    expect(boosted).toBeLessThanOrEqual(1);
    expect(HEAL_HALO_BOOST_GLOW).toBeGreaterThan(1);
  });
});

describe('★ 波环：只往大里扩，扩到边上必然淡完', () => {
  it('★★ 缩放单调不减，且不超过 1（超过就是扩到范围外了）', () => {
    let last = 0;
    for (let i = 0; i <= 40; i++) {
      const { scale } = haloWaveAt(i / 40);
      expect(scale).toBeGreaterThanOrEqual(last - 1e-9);
      expect(scale).toBeLessThanOrEqual(1 + 1e-9);
      last = scale;
    }
  });

  it('★★ 寿命末尾透明度必须归零（不归零就是一圈卡在边上不消失的死环）', () => {
    expect(haloWaveAt(1).opacity).toBeCloseTo(0, 6);
  });

  it('★ 开头是从内往外（0.45R 起步，不是从 0 长出来）', () => {
    expect(haloWaveAt(0).scale).toBeCloseTo(0.45, 6);
  });

  it('★ 不超上限（`HEAL_HALO_CAP.wave`）', () => {
    for (let i = 0; i <= 40; i++) {
      expect(haloWaveAt(i / 40).opacity).toBeLessThanOrEqual(HEAL_HALO_CAP.wave + 1e-9);
    }
  });

  it('★ 免死时波环也更亮', () => {
    const plain = haloWaveAt(0.1, false).opacity;
    const boosted = haloWaveAt(0.1, true).opacity;
    expect(boosted).toBeGreaterThan(plain);
  });

  it('★ 越界进度（回放追帧传进来）会被夹住，不产生 NaN', () => {
    for (const t of [-5, 5, Number.NaN]) {
      const { scale, opacity } = haloWaveAt(t);
      expect(Number.isFinite(scale)).toBe(true);
      expect(Number.isFinite(opacity)).toBe(true);
    }
  });
});

describe('★★ 外缘火花：免死专属层', () => {
  it('★★ 没有免死时**恒为 0**（平时不该为一个看不见的环花 GPU）', () => {
    for (let i = 0; i <= 40; i++) {
      expect(haloSparkAt(i / 40, false)).toBe(0);
    }
  });

  it('★★ 有免死时全程在 0.45~0.9 之间闪（这是"更闪"唯一的可见证据）', () => {
    for (let i = 0; i <= 40; i++) {
      const value = haloSparkAt(i / 40, true);
      expect(value, `t=${i / 40}`).toBeGreaterThanOrEqual(0.45 - 1e-9);
      expect(value, `t=${i / 40}`).toBeLessThanOrEqual(0.9 + 1e-9);
    }
  });

  it('★★ 它真的在"闪"（相邻采样点的差要看得出来，不是一条直线）', () => {
    let maxDelta = 0;
    let prev = haloSparkAt(0, true);
    for (let i = 1; i <= 80; i++) {
      const value = haloSparkAt(i / 80, true);
      maxDelta = Math.max(maxDelta, Math.abs(value - prev));
      prev = value;
    }
    // 0.45~0.9 之间一秒两个来回 ⇒ 每帧 t 步长 1/84 时，单帧最大跳变约 0.07
    expect(maxDelta, '差值太小的眼睛看不出闪').toBeGreaterThan(0.05);
  });

  it('★ 免死时的 spark 明显亮过非免死（对比断言，防止两边都写死成常数）', () => {
    const boosted = haloSparkAt(0.3, true);
    const plain = haloSparkAt(0.3, false);
    expect(boosted).toBeGreaterThan(plain + 0.3);
  });
});

describe('★ 符号（`+++` / `🗡+`）：首尾透明、不飘天外', () => {
  it('★★ 首尾都接近 0（否则会"凭空出现/凭空消失"）', () => {
    expect(haloSymbolAt(0).opacity).toBeLessThan(0.05);
    expect(haloSymbolAt(1).opacity).toBeLessThan(0.05);
  });

  it('★ 中前段要真的看得见（淡入够快）', () => {
    expect(haloSymbolAt(0.35).opacity).toBeGreaterThan(0.4);
  });

  it('★★ 起点在环内、终点不超过 `HEAL_HALO_SYMBOL_RISE` + 起始高度（飘天外就是满屏乱飞）', () => {
    const start = haloSymbolAt(0).y;
    const end = haloSymbolAt(1).y;
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(end).toBeLessThan(0.28 + HEAL_HALO_SYMBOL_RISE + 1e-6);
  });

  it('★ 全程单调上升（"边飘边淡"，不是上下抖）', () => {
    let last = -Infinity;
    for (let i = 0; i <= 40; i++) {
      const { y } = haloSymbolAt(i / 40);
      expect(y).toBeGreaterThanOrEqual(last - 1e-9);
      last = y;
    }
  });

  it('★★ 缩放永远是正的（Sprite 拿到 0/负数会直接消失或翻面）', () => {
    for (let i = 0; i <= 40; i++) {
      const { scale } = haloSymbolAt(i / 40);
      expect(scale).toBeGreaterThan(0);
      expect(scale).toBeLessThan(1.5);
    }
  });

  it('★ 越界进度不产生 NaN', () => {
    for (const t of [-3, 7, Number.NaN]) {
      const at = haloSymbolAt(t);
      expect(Number.isFinite(at.y)).toBe(true);
      expect(Number.isFinite(at.opacity)).toBe(true);
      expect(Number.isFinite(at.scale)).toBe(true);
    }
  });

  it('★ 一次刷新默认撒 3 个（用户口径就是"几个 + 在飘"，不是一条字幕）', () => {
    expect(HEAL_HALO_SYMBOL_COUNT).toBeGreaterThanOrEqual(3);
  });
});
