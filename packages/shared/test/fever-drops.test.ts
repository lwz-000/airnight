/**
 * ============================================================
 *  ★★ 0.2 MujicaAve：fever 档位「宝藏掉落表」—— 数据表本体
 * ============================================================
 *
 * 用户手写 `各项数值/羁绊掉落表.txt` 的代码化。这一份只测**表本身**：
 * 档位和 fever 门槛对不对得上、权重加起来是不是 100%、掷骰能不能覆盖到每一条。
 *
 * ★ 一条重要的事实：用户原表**不是每档都等于 100%**
 *   （500 档 110%、1000 档 110%、1500 档 80%、3000 档 99%）。
 *   代码的处理是"保留原权重、掷骰时按总和归一"，
 *   所以这里断言的是**原样照抄的权重**，不是被改过的数字。
 */
import { describe, expect, it } from 'vitest';
import {
  FEVER_DROP_TABLE,
  TRAIT_DEFS,
  describeFeverDrop,
  feverDropTableOf,
  feverDropWeightSum,
  rollFeverDrop,
  type FeverDropEntry,
} from '../src/index.js';

/** mujica 的 fever 门槛（数据的唯一出处） */
function thresholds(): number[] {
  const tier = TRAIT_DEFS['mujica']!.tiers[0]!;
  const mechanic = tier.mechanics!.find((item) => item.kind === 'fever');
  if (!mechanic || mechanic.kind !== 'fever') throw new Error('mujica 缺 fever 机制');
  return [...mechanic.thresholds];
}

describe('★ 掉落表：档位和 fever 门槛一一对应', () => {
  it('★★ 表里正好是那七个档位（多一个少一个都会对不上）', () => {
    expect(Object.keys(FEVER_DROP_TABLE).map(Number).sort((a, b) => a - b)).toEqual(
      thresholds().sort((a, b) => a - b),
    );
  });

  it('★ 每一档至少有一条，且权重都是正数', () => {
    for (const tier of thresholds()) {
      const table = feverDropTableOf(tier);
      expect(table, `${tier} 档没有表`).toBeTruthy();
      expect(table!.length).toBeGreaterThan(0);
      for (const entry of table!) expect(entry.weightBp).toBeGreaterThan(0);
    }
  });

  it('★ 不认识的档位返回 null（别让它静默发出一份空气）', () => {
    expect(feverDropTableOf(12345)).toBeNull();
    expect(rollFeverDrop(12345, 0)).toBeNull();
    expect(feverDropWeightSum(12345)).toBe(0);
  });
});

describe('★ 掉落表：百分比（用户原表照抄，含对不上的那几档）', () => {
  /*
    这几个数是**故意**断言成这样的 —— 用户原表的百分比不是都等于 100，
    代码选择"按总和归一"而不是偷偷改权重。将来用户把表改准了，
    这里就会红，正好提醒"归一那套说明也要一起删"。
  */
  it('★★ 各档权重总和（原样照抄：500/1000 是 110%，1500 是 80%）', () => {
    expect(feverDropWeightSum(100)).toBe(10000);
    expect(feverDropWeightSum(300)).toBe(10000);
    expect(feverDropWeightSum(500)).toBe(11000);
    expect(feverDropWeightSum(1000)).toBe(11000);
    expect(feverDropWeightSum(1500)).toBe(8000);
    expect(feverDropWeightSum(2000)).toBe(10000);
    // 3000 档原表写 33/33/33.0，这里把零头补给它 ⇒ 正好 100%
    expect(feverDropWeightSum(3000)).toBe(10000);
  });

  it('★ 每一档的第一条都是"纯金币"（保底有个能用的奖励）', () => {
    for (const tier of thresholds()) {
      const first = feverDropTableOf(tier)![0]!;
      expect(first.gold, `${tier} 档第一条不是金币`).toBeGreaterThan(0);
    }
  });
});

describe('★ 掉落表：掷骰覆盖', () => {
  it('★★ 掷遍 [0, 总和) 的每一个点：结果一定属于这一档，且每条都被命中过', () => {
    for (const tier of thresholds()) {
      const table = feverDropTableOf(tier)!;
      const total = feverDropWeightSum(tier);
      const hits = new Set<FeverDropEntry>();
      for (let roll = 0; roll < total; roll++) {
        const entry = rollFeverDrop(tier, roll);
        expect(entry, `${tier} 档 roll=${roll} 掷空了`).toBeTruthy();
        expect(table.includes(entry!)).toBe(true);
        hits.add(entry!);
      }
      expect(hits.size, `${tier} 档有分支永远掷不到`).toBe(table.length);
    }
  });

  it('★ 越界的 roll 会被夹回来（追帧/除零时别抛异常）', () => {
    expect(rollFeverDrop(100, -1)).toBeTruthy();
    expect(rollFeverDrop(100, 999999)).toBeTruthy();
  });

  it('★ 比例大致对得上：100 档掷一万次，金币和普通藏品各占一半', () => {
    let gold = 0;
    for (let roll = 0; roll < 10000; roll++) {
      if (rollFeverDrop(100, roll)!.gold) gold++;
    }
    expect(gold).toBe(5000);
  });
});

describe('★ 掉落表：文案', () => {
  it('★ 金币 / 藏品 / 干员都能写成人话', () => {
    expect(describeFeverDrop({ weightBp: 1, gold: 66 })).toBe('66 金币');
    expect(describeFeverDrop({ weightBp: 1, gold: 25, advancedItems: 2 })).toBe(
      '25 金币 + 2 件进阶藏品',
    );
    expect(
      describeFeverDrop({
        weightBp: 1,
        gold: 20,
        operator: { star: 2, cost: 4, count: 2 },
      }),
    ).toBe('20 金币 + 2 张 2 星 4 费干员');
    expect(describeFeverDrop({ weightBp: 1, mimicMatter: 3 })).toBe('3 个拟态物质');
  });

  it('★ 空条目也不会写出 "undefined"', () => {
    expect(describeFeverDrop({ weightBp: 1 })).toBe('什么都没有');
  });
});
