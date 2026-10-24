/**
 * ============================================================
 *  单机模式：对手阵容的成长表（0.0.2 二次重做后的断言）
 * ============================================================
 *
 * 【这一版测试要钉住的，就是用户提的四条】
 *   ① 前期别太快 —— 1~10 回合力量值封顶，正常运营的玩家不会被暴打；
 *   ② 不许"随机换人 / 全员换位" —— 每一步都是确定性的，换人只在
 *      "人满 8 之后加新卡"时发生，且只换掉**最差的那个座位**；
 *   ③ 3 星的解锁回合 —— 4 费 ≥25、5 费 ≥35 是用户点名的两条硬线；
 *   ④ 3 星的间隔 —— 3/4/5 费两次之间至少隔 5 回合；
 *      1/2 费的便宜货也要隔 3 回合。
 *
 * 【一个反直觉但必须写下来的事实】
 * 阵容的"结构"（哪几费、几星、几个人）**与种子无关** —— 种子只决定
 * 每个格子坐的是哪个干员。所以下面大量断言直接跨 7 个种子同时验证，
 * 一旦哪天随机性渗进了结构里，这些用例会立刻变红。
 */
import { describe, expect, it } from 'vitest';
import {
  UNIT_DEFS,
  copiesPerCard,
  isMonsterRound,
  monsterWaveForRound,
  playableDefs,
  type UnitDefTable,
} from '../../../packages/shared/src/index.js';
import {
  CHEAP_3STAR_MIN_GAP,
  ENEMY_MAX_COUNT,
  ENEMY_SCHEDULE,
  PREMIUM_3STAR_MIN_GAP,
  THREE_STAR_UNLOCK_ROUND,
  enemyLineupForRound,
  enemyOpsForRound,
  enemyPlacementsForRound,
  enemyPower,
  opponentPlacementsForRound,
  enemyThreeStarEvents,
  enemyUnitHp,
  type EnemyUnit,
} from '../src/game/enemy-lineup.js';
import { createGameState, pickOpponent, poolRemaining, waveDescription } from '../src/game/state.js';

/** 把阵容整理成 "费用费星级星 -> 个数"，方便按明细对账 */
function composition(lineup: ReadonlyArray<EnemyUnit>, defs: UnitDefTable = UNIT_DEFS): Record<string, number> {
  const out: Record<string, number> = {};
  for (const unit of lineup) {
    const key = `${defs[unit.defId]?.cost ?? 1}费${unit.star}星`;
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

/** 阵容里用到的干员 id 集合 */
const defIdsOf = (lineup: ReadonlyArray<EnemyUnit>): Set<string> => new Set(lineup.map((u) => u.defId));

/** 逐回合力量值数组（下标 0 = 第 1 回合） */
function powerCurve(seed: number, upTo = 60): number[] {
  const out: number[] = [];
  for (let r = 1; r <= upTo; r++) out.push(enemyPower(enemyLineupForRound(r, seed)));
  return out;
}

const SEEDS = [0, 1, 7, 12345, 987654321, 42, 20261009];

describe('★ 1~10 回合：一段"慢慢运营"的开局', () => {
  /*
    新明细（一个回合只做**一件事**）：
      1   加 1 个 1 星 1 费
      2   再加 1 个 1 星 1 费
      3   再加 1 个 1 星 1 费
      4   随机把 1 个 1 星 1 费 升 2 星
      5   加 1 个 1 星 1 费
      6   再把 1 个 1 星 1 费 升 2 星
      7   加 1 个 1 星 2 费
      8   升最弱的（1 星 1 费 → 2 星）
      9   再加 1 个 1 星 2 费
     10   把 1 个 1 星 2 费 升 2 星
  */
  const expected: Record<number, Record<string, number>> = {
    1: { '1费1星': 1 },
    2: { '1费1星': 2 },
    3: { '1费1星': 3 },
    4: { '1费1星': 2, '1费2星': 1 },
    5: { '1费1星': 3, '1费2星': 1 },
    6: { '1费1星': 2, '1费2星': 2 },
    7: { '1费1星': 2, '1费2星': 2, '2费1星': 1 },
    8: { '1费1星': 1, '1费2星': 3, '2费1星': 1 },
    9: { '1费1星': 1, '1费2星': 3, '2费1星': 2 },
    10: { '1费1星': 1, '1费2星': 3, '2费1星': 1, '2费2星': 1 },
  };

  for (const [roundText, want] of Object.entries(expected)) {
    const round = Number(roundText);
    it(`第 ${round} 回合的阵容是 ${JSON.stringify(want)}`, () => {
      for (const seed of SEEDS) {
        const got = composition(enemyLineupForRound(round, seed));
        expect(got, `seed=${seed} 第 ${round} 回合`).toEqual(want);
      }
    });
  }

  it('明细表本身是 10 行，每行恰好一条操作（不再一回合塞两件事）', () => {
    expect(ENEMY_SCHEDULE.length).toBe(10);
    for (const ops of ENEMY_SCHEDULE) expect(ops.length).toBe(1);
  });

  it('★ 前 10 回合力量值封顶 20（旧版是 39，砍掉一半多）', () => {
    for (const seed of SEEDS) {
      for (let round = 1; round <= 10; round++) {
        expect(enemyPower(enemyLineupForRound(round, seed)), `seed=${seed} 第 ${round} 回合`).toBeLessThanOrEqual(20);
      }
    }
    // 顺手记下真实曲线，肉眼可查（每回合涨 1~4 点，没有跳变）
    expect(powerCurve(12345, 10)).toEqual([1, 2, 3, 5, 6, 8, 10, 12, 14, 18]);
  });

  it('前 3 回合只有 1 星 1 费（先铺人，再谈强度）', () => {
    for (const seed of SEEDS) {
      for (let round = 1; round <= 3; round++) {
        for (const unit of enemyLineupForRound(round, seed)) {
          expect(unit.star).toBe(1);
          expect(UNIT_DEFS[unit.defId]!.cost).toBe(1);
        }
      }
    }
  });
});

describe('★ 3 星的两道闸：解锁回合 + 间隔', () => {
  it('每一档的首次 3 星都不早于解锁回合（4 费 ≥25、5 费 ≥35）', () => {
    for (const seed of SEEDS) {
      const first = new Map<number, number>();
      for (const event of enemyThreeStarEvents(60, seed)) {
        if (!first.has(event.cost)) first.set(event.cost, event.round);
      }
      for (const [costText, unlock] of Object.entries(THREE_STAR_UNLOCK_ROUND)) {
        const cost = Number(costText);
        const at = first.get(cost);
        expect(at, `seed=${seed} ${cost} 费 3 星直到 60 回合都没出现过`).toBeDefined();
        expect(at!, `seed=${seed} ${cost} 费 3 星在第 ${at} 回合就出了（解锁线 ${unlock}）`).toBeGreaterThanOrEqual(unlock);
      }
    }
  });

  it('解锁线本身：4 费 25 / 5 费 35（用户点名的两条硬线）', () => {
    expect(THREE_STAR_UNLOCK_ROUND[4]).toBeGreaterThanOrEqual(25);
    expect(THREE_STAR_UNLOCK_ROUND[5]).toBeGreaterThanOrEqual(35);
    // 费用越高解锁越晚
    const costs = [1, 2, 3, 4, 5];
    for (let i = 1; i < costs.length; i++) {
      expect(THREE_STAR_UNLOCK_ROUND[costs[i]!]).toBeGreaterThan(THREE_STAR_UNLOCK_ROUND[costs[i - 1]!]!);
    }
  });

  it('★ 3/4/5 费的 3 星两次之间至少隔 5 回合（不能连着出）', () => {
    for (const seed of SEEDS) {
      const premium = enemyThreeStarEvents(60, seed).filter((e) => e.cost >= 3);
      expect(premium.length, `seed=${seed} 60 回合内一个 3/4/5 费 3 星都没有`).toBeGreaterThan(0);
      for (let i = 1; i < premium.length; i++) {
        const gap = premium[i]!.round - premium[i - 1]!.round;
        expect(gap, `seed=${seed} ${premium[i - 1]!.cost}费@${premium[i - 1]!.round} → ${premium[i]!.cost}费@${premium[i]!.round} 只隔了 ${gap} 回合`)
          .toBeGreaterThanOrEqual(PREMIUM_3STAR_MIN_GAP);
      }
    }
  });

  it('1/2 费的 3 星也要隔（便宜货放宽到 3 回合）', () => {
    for (const seed of SEEDS) {
      const cheap = enemyThreeStarEvents(60, seed).filter((e) => e.cost < 3);
      for (let i = 1; i < cheap.length; i++) {
        const gap = cheap[i]!.round - cheap[i - 1]!.round;
        expect(gap, `seed=${seed} 便宜 3 星只隔了 ${gap} 回合`).toBeGreaterThanOrEqual(CHEAP_3STAR_MIN_GAP);
      }
    }
  });

  it('★ 3/4/5 费 3 星的出现时机大幅后移：40 回合前最多 5 次', () => {
    for (const seed of SEEDS) {
      const early = enemyThreeStarEvents(60, seed).filter((e) => e.cost >= 3 && e.round < 40);
      expect(early.length, `seed=${seed} 40 回合前出了 ${early.length} 次高级 3 星：${JSON.stringify(early)}`)
        .toBeLessThanOrEqual(5);
    }
  });

  it('第 12 回合前一个 3 星都没有（1 费也要 13 回合）', () => {
    for (const seed of SEEDS) {
      for (let round = 1; round <= 12; round++) {
        expect(
          enemyLineupForRound(round, seed).filter((u) => u.star === 3),
          `seed=${seed} 第 ${round} 回合不该有 3 星`,
        ).toEqual([]);
      }
    }
  });
});

describe('★ 阵容是"长出来的"，不是随机换一批', () => {
  it('★ 只有"人满之后加新卡"才会让一个干员消失，且最多一个', () => {
    for (const seed of SEEDS) {
      for (let round = 2; round <= 60; round++) {
        const before = enemyLineupForRound(round - 1, seed);
        const after = enemyLineupForRound(round, seed);
        const gone = [...defIdsOf(before)].filter((id) => !defIdsOf(after).has(id));
        expect(gone.length, `seed=${seed} 第 ${round} 回合换掉了 ${gone.length} 个（换人只在人满时发生，且只换一个）`)
          .toBeLessThanOrEqual(1);
        if (gone.length === 1) {
          expect(before.length, `seed=${seed} 第 ${round} 回合没满员却换掉了人`).toBe(ENEMY_MAX_COUNT);
        }
      }
    }
  });

  it('升星是"原地"的：同一个人升星后还坐在原来的下标', () => {
    for (const seed of SEEDS) {
      for (const round of [6, 8, 11, 15, 25]) {
        const before = enemyLineupForRound(round - 1, seed);
        const after = enemyLineupForRound(round, seed);
        const shared = Math.min(before.length, after.length);
        for (let i = 0; i < shared; i++) {
          const a = before[i]!;
          const b = after[i]!;
          // 同一个座位要么是同一个干员（可能升了星），要么本来是这条最弱的被换掉
          if (a.defId === b.defId) {
            expect(b.star, `seed=${seed} r${round} 座位 ${i} 星级回退了`).toBeGreaterThanOrEqual(a.star);
          }
        }
      }
    }
  });

  it('第 1 回合是"随机干员"（不同种子给出不同的人）', () => {
    const seen = new Set(SEEDS.map((seed) => enemyLineupForRound(1, seed)[0]?.defId));
    expect(seen.size, '第 1 回合应该随种子变化，不能每次都同一个人').toBeGreaterThan(2);
  });

  it('第 1 回合就一个棋子，1 星 1 费', () => {
    for (const seed of SEEDS) {
      const lineup = enemyLineupForRound(1, seed);
      expect(lineup).toHaveLength(1);
      expect(lineup[0]!.star).toBe(1);
      expect(UNIT_DEFS[lineup[0]!.defId]!.cost).toBe(1);
    }
  });

  it('操作表里不再有 replace（随机换人已经彻底删掉）', () => {
    const kinds = new Set<string>();
    for (let round = 1; round <= 40; round++) {
      for (const op of enemyOpsForRound(round)) kinds.add(op.kind);
    }
    expect([...kinds].sort()).toEqual(['add', 'upgrade']);
  });
});

describe('★ 硬约束：人数上限（牌库不再介入）', () => {
  /*
    ★ 0.0.2 追加：牌库相关的断言已经删除。
    对手的干员不再计入牌库（见 state.ts 的 ownedUnits），
    所以"阵容不能超过牌库张数"这条约束本身已经不存在 ——
    留着断言只会变成一条与旧设计耦合、随时可能变红的假保险。
    真正还成立的硬约束只剩"人数 ≤ 8"和"星级 1~3"。
  */

  it('人数不超过上限', () => {
    for (const seed of SEEDS) {
      for (let round = 1; round <= 60; round++) {
        expect(enemyLineupForRound(round, seed).length).toBeLessThanOrEqual(ENEMY_MAX_COUNT);
      }
    }
  });

  it('星级永远在 1~3（游戏就是这三档）', () => {
    for (const seed of SEEDS) {
      for (let round = 1; round <= 60; round++) {
        for (const unit of enemyLineupForRound(round, seed)) {
          expect(unit.star).toBeGreaterThanOrEqual(1);
          expect(unit.star).toBeLessThanOrEqual(3);
        }
      }
    }
  });

  it('★ 人机的干员不计入牌库：对手越强，玩家这一份账越是不动', () => {
    const state = createGameState(20261009);

    // 玩家自己什么都不买：第 1 回合（对手只有 1 个人）先记一份快照
    state.round = 1;
    const before = [...poolRemaining(state).entries()].sort();

    // 直接推到对手阵容大幅成长的后期
    state.round = 40;
    const lineup = enemyLineupForRound(state.round, state.seed);
    expect(lineup.length, '第 40 回合对手应该已经有一批干员了').toBeGreaterThan(3);

    // 玩家没动过任何东西 → 牌库分毫不变（对手一点都没占）
    expect([...poolRemaining(state).entries()].sort()).toEqual(before);
  });

  it('★ 对手正在用的干员，在玩家商店里依然是"满货"', () => {
    const state = createGameState(20261009);
    state.round = 40;
    const lineup = enemyLineupForRound(state.round, state.seed);
    const remaining = poolRemaining(state);
    for (const unit of lineup) {
      const size = copiesPerCard(UNIT_DEFS[unit.defId]?.cost ?? 1);
      expect(remaining.get(unit.defId), `${unit.defId} 被对手占用了`).toBe(size);
    }
  });
});

describe('★ 力量曲线：平滑上涨，不允许跳变或躺平', () => {
  it('相邻回合的回落不超过 25（只可能是"卖旧买大"那一下）', () => {
    for (const seed of SEEDS) {
      const curve = powerCurve(seed);
      for (let i = 1; i < curve.length; i++) {
        const dip = curve[i - 1]! - curve[i]!;
        expect(dip, `seed=${seed} 第 ${i + 1} 回合力量从 ${curve[i - 1]} 掉到 ${curve[i]}`).toBeLessThanOrEqual(25);
      }
    }
  });

  it('★ 每 8 回合至少净增长（不允许长时间躺平）', () => {
    for (const seed of SEEDS) {
      const curve = powerCurve(seed);
      for (let i = 8; i < curve.length; i++) {
        expect(curve[i]!, `seed=${seed} 第 ${i + 1} 回合没有比 8 回合前更强`).toBeGreaterThan(curve[i - 8]!);
      }
    }
  });

  it('60 回合的力量值远高于开局（曲线一直在往上走）', () => {
    for (const seed of SEEDS) {
      const curve = powerCurve(seed);
      expect(curve[59]!).toBeGreaterThan(200);
    }
  });

  it('前期涨幅明显小于后期（"前面慢、后面快"才符合运营节奏）', () => {
    const curve = powerCurve(12345);
    const early = curve[9]! - curve[0]!; // 1~10 回合
    const mid = curve[29]! - curve[20]!; // 21~30 回合
    expect(mid).toBeGreaterThan(early);
  });
});

describe('★ 可复现 & 接入游戏状态', () => {
  it('同种子同回合 → 完全一样的阵容（联机/复现的地基）', () => {
    for (const seed of [0, 12345, 999]) {
      for (const round of [1, 3, 7, 12, 25, 40]) {
        expect(enemyLineupForRound(round, seed)).toEqual(enemyLineupForRound(round, seed));
      }
    }
  });

  it('换种子 → 阵容不一样', () => {
    const a = JSON.stringify(enemyLineupForRound(12, 111));
    const b = JSON.stringify(enemyLineupForRound(12, 222));
    expect(a).not.toBe(b);
  });

  it('站位不重叠，且都在对手半场', () => {
    for (const round of [1, 5, 10, 18, 30, 45]) {
      const placements = enemyPlacementsForRound(round, 12345);
      const keys = placements.map((p) => `${p.cell.col},${p.cell.row}`);
      expect(new Set(keys).size, `第 ${round} 回合有棋子叠在同一格`).toBe(keys.length);
      for (const p of placements) {
        expect(p.cell.col, '对手棋子必须站在对手半场').toBeGreaterThanOrEqual(5);
        expect(p.cell.row).toBeGreaterThanOrEqual(0);
        expect(p.cell.row).toBeLessThan(10);
      }
    }
  });

  it('`enemyUnitHp` 和星级/费用同向（用来判断"谁最弱"）', () => {
    const cheap = playableDefs().find((d) => d.cost === 1)!;
    const dear = playableDefs().find((d) => d.cost === 5)!;
    expect(enemyUnitHp(cheap, 2)).toBeGreaterThan(enemyUnitHp(cheap, 1));
    expect(enemyUnitHp(cheap, 3)).toBeGreaterThan(enemyUnitHp(cheap, 2));
    expect(enemyUnitHp(dear, 1)).toBeGreaterThan(enemyUnitHp(cheap, 1));
  });

  it('★ 布阵阶段显示的阵容 = 开打时用的阵容（普通回合）', () => {
    const state = createGameState(777);
    state.round = 3;
    const shown = opponentPlacementsForRound(state.round, state.seed);
    const fought = pickOpponent(state).units;
    expect(fought).toEqual(shown);
  });

  it('★ 布阵阶段显示的阵容 = 开打时用的阵容（野怪回合也是同一份）', () => {
    const state = createGameState(777);
    state.round = 16; // 野怪回合
    const shown = opponentPlacementsForRound(state.round, state.seed);
    const fought = pickOpponent(state).units;
    expect(fought).toEqual(shown);
    expect(fought).toEqual(monsterWaveForRound(state.round));
    // 野怪只站对手半场（列 >= ARENA_W = 5）
    expect(fought.every((unit) => unit.cell.col >= 5)).toBe(true);
  });

  it('waveDescription 能念出人数和最高费用（普通回合）', () => {
    // 野怪回合是 1/2/9/16/23/30/37…，这里挑几个**不是**野怪回合的
    for (const round of [3, 8, 15, 24, 31]) {
      expect(isMonsterRound(round), `第 ${round} 回合不该是野怪回合`).toBe(false);
      const text = waveDescription(round, 12345);
      expect(text.length).toBeGreaterThan(0);
      expect(text).toContain('费');
    }
  });

  it('★ waveDescription 在野怪回合念的是野怪，不是人机', () => {
    for (const round of [1, 2, 9, 16]) {
      const text = waveDescription(round, 12345);
      expect(text, `第 ${round} 回合应该是野怪回合`).toContain('野怪');
      expect(text).not.toContain('费');
    }
  });
});
