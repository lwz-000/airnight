/**
 * ============================================================
 *  ★ 0.2：丰川祥子的音符弹道（🎶）—— 纯计算部分
 * ============================================================
 *
 * 这些函数**不碰 three**，所以能直接断言"轨迹/透明度/缩放"的数学性质。
 * 真正把它画出来那段（canvas 画 emoji + Sprite）只能靠真机截图看，
 * 但"有没有在动、会不会跑到地下、会不会缩成 0"这几条是可以钉死的。
 */
import { describe, expect, it } from 'vitest';
import {
  NOTE_EMOJI,
  NOTE_FX_GOLD,
  NOTE_FX_IDS,
  NOTE_FX_PURPLE,
  NOTE_FX_SECONDS,
  NOTE_FX_WORLD_SIZE,
  MAX_LIVE_NOTE_FX,
  isNoteFx,
  noteOpacityAt,
  notePathAt,
  noteScaleAt,
  noteStyleOf,
} from '../src/three/note-fx.js';

const FROM = { x: 0, z: 0 };
const TO = { x: 4, z: 2 };

describe('★ 音符弹道：贴图就用 🎶', () => {
  it('★ 用的就是 🎶 这个表情（用户口径原话）', () => {
    expect(NOTE_EMOJI).toBe('🎶');
  });

  it('★ 时长和别的特效同一个量级（0.2~0.5 秒），不会"人都打完了音符还在飞"', () => {
    expect(NOTE_FX_SECONDS).toBeGreaterThan(0.2);
    expect(NOTE_FX_SECONDS).toBeLessThan(0.5);
  });

  it('★ 上限存在且不为 0（否则满编对轰时 sprite 会无限堆）', () => {
    expect(MAX_LIVE_NOTE_FX).toBeGreaterThan(0);
  });
});

describe('★★ 配色变体（祥子金 / 海铃紫）', () => {
  it('金色是默认那一个，紫色是后加的；两个都在合法 id 表里', () => {
    expect(NOTE_FX_IDS).toContain(NOTE_FX_GOLD);
    expect(NOTE_FX_IDS).toContain(NOTE_FX_PURPLE);
    // ★ 老 id 不能让位：祥子的数据里写的是 'note'，改了就等于她的音符消失
    expect(NOTE_FX_GOLD).toBe('note');
  });

  it('`isNoteFx()` 是"要不要走音符通道"的唯一判据（含变体，排除别的 id）', () => {
    expect(isNoteFx('note')).toBe(true);
    expect(isNoteFx('note_purple')).toBe(true);
    for (const other of [undefined, null, '', 'note_green', 'bullet_angel', 'rosmon_slam']) {
      expect(isNoteFx(other), `${String(other)} 不该被当成音符`).toBe(false);
    }
  });

  it('配色真的不一样（只改光晕/描边，不改形状 —— 用户口径「祥子特效改一下颜色」）', () => {
    const gold = noteStyleOf(NOTE_FX_GOLD);
    const purple = noteStyleOf(NOTE_FX_PURPLE);
    expect(purple.core).not.toBe(gold.core);
    expect(purple.shadow).not.toBe(gold.shadow);
  });

  it('不认识的 id 一律退回金色，绝不返回 undefined（否则贴图那步会炸）', () => {
    expect(noteStyleOf('note_green')).toEqual(noteStyleOf(NOTE_FX_GOLD));
    expect(noteStyleOf(undefined)).toEqual(noteStyleOf(NOTE_FX_GOLD));
  });
});

describe('★ 音符弹道：轨迹', () => {
  it('★★ 起点在攻击者、终点在目标（这条错了就是"打到空地上了"）', () => {
    const start = notePathAt(FROM, TO, 0);
    const end = notePathAt(FROM, TO, 1);
    expect(start.x).toBeCloseTo(FROM.x, 6);
    expect(start.z).toBeCloseTo(FROM.z, 6);
    expect(end.x).toBeCloseTo(TO.x, 6);
    expect(end.z).toBeCloseTo(TO.z, 6);
  });

  it('★★ 中间是"拱"：中点最高，两端低（不是贴地滑过去）', () => {
    const start = notePathAt(FROM, TO, 0);
    const mid = notePathAt(FROM, TO, 0.5);
    const end = notePathAt(FROM, TO, 1);
    expect(mid.y).toBeGreaterThan(start.y);
    expect(mid.y).toBeGreaterThan(end.y);
    // 拱高要看得出来，但别飞得像放风筝
    expect(mid.y - start.y).toBeGreaterThan(0.2);
    expect(mid.y - start.y).toBeLessThan(1.2);
  });

  it('★ 全程在地面之上（y 永远是正的）', () => {
    for (let i = 0; i <= 20; i++) {
      expect(notePathAt(FROM, TO, i / 20).y).toBeGreaterThan(0);
    }
  });

  it('★ 超出 0~1 的进度会被夹住（回放追帧时可能传进来）', () => {
    expect(notePathAt(FROM, TO, -3).x).toBeCloseTo(FROM.x, 6);
    expect(notePathAt(FROM, TO, 9).x).toBeCloseTo(TO.x, 6);
  });
});

describe('★ 音符弹道：透明度与缩放', () => {
  it('★ 出手淡入、命中淡出（首尾都接近 0，否则会"凭空出现/凭空消失"）', () => {
    expect(noteOpacityAt(0)).toBeLessThan(0.05);
    expect(noteOpacityAt(1)).toBeLessThan(0.05);
    expect(noteOpacityAt(0.4), '中段要完全不透明').toBeCloseTo(1, 6);
  });

  it('★★ 缩放永远是正的（Sprite 拿到 0/负数会直接消失或翻面）', () => {
    for (let i = 0; i <= 40; i++) {
      const scale = noteScaleAt(i / 40);
      expect(scale).toBeGreaterThan(0);
      // 也别忽大忽小到离谱：0.5~1.5 之间
      expect(scale).toBeLessThan(1.5);
    }
  });

  it('★ 世界尺寸比一格小（棋子约 1 格宽，音符该比它小一圈）', () => {
    expect(NOTE_FX_WORLD_SIZE).toBeGreaterThan(0.2);
    expect(NOTE_FX_WORLD_SIZE).toBeLessThan(1);
  });
});
