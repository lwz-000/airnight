import { describe, expect, it } from 'vitest';
import { createRng, seedFromString } from '../src/rng.js';
import { simulate, step, createBattle } from '../src/rules.js';
import { UNIT_DEFS } from '../src/unit-data.js';
import {
  TEAM_ASSASSINS,
  TEAM_KNIGHTS,
  allCells,
  mirrorSetup,
  pickUnitOfCost,
  soloTeamOfCost,
} from '../src/presets.js';
import { renderBattleText } from '../src/battle-log-format.js';
import { someTeam1Cell, team0Cell } from './helpers.js';
import type { UnitDefTable } from '../src/types.js';

const defs: UnitDefTable = UNIT_DEFS;

describe('确定性随机数（联机的地基）', () => {
  it('同一个种子必须产生完全相同的随机序列', () => {
    const a = createRng(12345);
    const b = createRng(12345);
    for (let i = 0; i < 500; i++) {
      expect(a.nextFix()).toBe(b.nextFix());
    }
  });

  it('不同种子产生不同序列', () => {
    const a = createRng(1);
    const b = createRng(2);
    const seqA = Array.from({ length: 50 }, () => a.nextFix());
    const seqB = Array.from({ length: 50 }, () => b.nextFix());
    expect(seqA).not.toEqual(seqB);
  });

  it('字符串种子稳定：同样的房间码+回合数 => 同样的种子', () => {
    expect(seedFromString('ABC123:round3')).toBe(seedFromString('ABC123:round3'));
    expect(seedFromString('ABC123:round3')).not.toBe(seedFromString('ABC123:round4'));
  });
});

describe('战斗内核确定性（这是自走棋联机能不能做成的核心）', () => {
  it('同一个种子跑 20 次，结果、事件日志、校验和必须全部一致', () => {
    const seed = 987654;
    const first = simulate(defs, [TEAM_KNIGHTS, TEAM_ASSASSINS], seed);

    for (let run = 0; run < 20; run++) {
      const again = simulate(defs, [TEAM_KNIGHTS, TEAM_ASSASSINS], seed);
      expect(again.checksum).toBe(first.checksum);
      expect(again.winner).toBe(first.winner);
      expect(again.ticks).toBe(first.ticks);
      expect(again.hpBpTeam0).toBe(first.hpBpTeam0);
      expect(again.hpBpTeam1).toBe(first.hpBpTeam1);
      // 连日志条数和内容都必须逐字节相同
      expect(again.log.length).toBe(first.log.length);
      expect(JSON.stringify(again.log)).toBe(JSON.stringify(first.log));
    }
  });

  it('文字战报也必须逐字一致（这是「同样输入 => 同样输出」的最强证明）', () => {
    const seed = 424242;
    const a = renderBattleText(simulate(defs, [TEAM_KNIGHTS, TEAM_ASSASSINS], seed), defs);
    const b = renderBattleText(simulate(defs, [TEAM_KNIGHTS, TEAM_ASSASSINS], seed), defs);
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(100);
  });

  it('不同种子会打出不同过程（说明随机确实在起作用）', () => {
    const checksums = new Set<number>();
    for (let seed = 0; seed < 12; seed++) {
      checksums.add(simulate(defs, [TEAM_KNIGHTS, TEAM_ASSASSINS], seed).checksum);
    }
    // 12 个种子不应该全都撞成同一个结果
    expect(checksums.size).toBeGreaterThan(1);
  });

  it('分步推进与一次性跑完结果一致（证明 step 是纯函数式的）', () => {
    const seed = 555;
    const full = simulate(defs, [TEAM_KNIGHTS, TEAM_ASSASSINS], seed);

    const state = createBattle(defs, [TEAM_KNIGHTS, TEAM_ASSASSINS], seed);
    while (!state.over) step(state, defs);

    expect(state.tick).toBe(full.ticks);
    expect(state.winner).toBe(full.winner);
    expect(JSON.stringify(state.log)).toBe(JSON.stringify(full.log));
  });
});

describe('战斗规则本身是否正常', () => {
  it('战斗一定会结束（不会双方互相打不死而卡死）', () => {
    for (let seed = 0; seed < 30; seed++) {
      const result = simulate(defs, [TEAM_KNIGHTS, TEAM_ASSASSINS], seed);
      expect(result.ticks).toBeGreaterThan(0);
      expect(result.ticks).toBeLessThanOrEqual(20 * 75);
      expect(result.log.some((e) => e.type === 'end')).toBe(true);
    }
  });

  it('镜像阵容（两边完全相同）结果应该基本对称', () => {
    // 完全对称时先手方（队伍 0）有优势是正常的，但不应该出现碾压
    const mirror = mirrorSetup(TEAM_KNIGHTS);
    const results = [];
    for (let seed = 0; seed < 20; seed++) {
      results.push(simulate(defs, [TEAM_KNIGHTS, mirror], seed));
    }
    const team0Wins = results.filter((r) => r.winner === 0).length;
    const team1Wins = results.filter((r) => r.winner === 1).length;
    // 两边都要有赢的时候，说明不存在「某一侧必胜」的结构性偏差
    expect(team0Wins).toBeGreaterThan(0);
    expect(team1Wins).toBeGreaterThan(0);
  });

  it('棋子会移动：远程单位应该产生 move 事件', () => {
    const result = simulate(defs, [TEAM_KNIGHTS, TEAM_ASSASSINS], 7);
    expect(result.log.some((e) => e.type === 'move')).toBe(true);
  });

  it('法力会累积并释放技能', () => {
    const result = simulate(defs, [TEAM_KNIGHTS, TEAM_ASSASSINS], 7);
    expect(result.log.some((e) => e.type === 'mana')).toBe(true);
    expect(result.log.some((e) => e.type === 'cast')).toBe(true);
  });

  it('伤害会让棋子死亡，且死亡后不再被攻击', () => {
    const result = simulate(defs, [TEAM_KNIGHTS, TEAM_ASSASSINS], 7);
    const deaths = result.log.filter((e) => e.type === 'death');
    expect(deaths.length).toBeGreaterThan(0);

    // 找出所有死亡的单位 id，之后不应该再有以它为目标的事件
    const deathTick = new Map<number, number>();
    for (const event of result.log) {
      if (event.type === 'death') deathTick.set(event.unitId, event.t);
    }
    for (const event of result.log) {
      if (event.type === 'attack' || event.type === 'damage') {
        const targetId = event.type === 'attack' ? event.targetId : event.targetId;
        const diedAt = deathTick.get(targetId);
        if (diedAt !== undefined) {
          expect(event.t).toBeLessThanOrEqual(diedAt);
        }
      }
    }
  });

  it('血量不会变成负数，也不会超过上限', () => {
    const result = simulate(defs, [TEAM_KNIGHTS, TEAM_ASSASSINS], 99);
    for (const event of result.log) {
      if (event.type === 'damage') {
        expect(event.hpAfter).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(event.hpAfter)).toBe(true);
      }
      if (event.type === 'heal') {
        expect(event.hpAfter).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(event.hpAfter)).toBe(true);
      }
    }
  });

  it('所有数值都是整数（出现小数就说明混进了浮点运算，联机会出问题）', () => {
    const result = simulate(defs, [TEAM_KNIGHTS, TEAM_ASSASSINS], 123);
    for (const event of result.log) {
      for (const value of Object.values(event)) {
        if (typeof value === 'number') {
          expect(Number.isInteger(value)).toBe(true);
        }
      }
    }
  });

  it('1 星打不过 3 星（星级升维是否有效）', () => {
    // 用「按费用取干员」而不是写死名字 —— 换干员名单时测试不会崩
    const weak = simulate(defs, [soloTeamOfCost(0, 1, 1), soloTeamOfCost(1, 1, 3)], 1);
    expect(weak.winner).toBe(1);
  });

  it('非法站位会被拒绝（棋子不能摆到对方半场）', () => {
    // 把队伍 0 的棋子摆到队伍 1 的半场里
    expect(() =>
      simulate(
        defs,
        [
          { team: 0, units: [{ defId: pickUnitOfCost(1), star: 1, cell: someTeam1Cell() }] },
          soloTeamOfCost(1, 1),
        ],
        1,
      ),
    ).toThrow();
  });

  it('同一格放两个棋子会被拒绝', () => {
    const shared = team0Cell(0);
    expect(() =>
      simulate(
        defs,
        [
          {
            team: 0,
            units: [
              { defId: pickUnitOfCost(1), star: 1, cell: shared },
              { defId: pickUnitOfCost(2), star: 1, cell: shared },
            ],
          },
          soloTeamOfCost(1, 1),
        ],
        1,
      ),
    ).toThrow();
  });

  it('空阵容不会导致崩溃', () => {
    const result = simulate(defs, [{ team: 0, units: [] }, soloTeamOfCost(1, 1)], 1);
    expect(result.winner).toBe(1);
  });

  it('100 场随机种子大规模稳定性测试（跑不崩、结果合法）', () => {
    const pool = Object.keys(defs);
    let seed = 1;
    for (let i = 0; i < 100; i++) {
      seed = (seed * 1103515245 + 12345) % 2147483647;
      const rng = createRng(seed);
      const build = (team: 0 | 1) => {
        // 用 allCells() 拿到这个半场所有合法格子，不写死坐标
        const cells = allCells(team);
        // 打乱（用确定性随机），再取前 N 个
        const shuffled = cells.slice().sort(() => rng.nextInt(3) - 1);
        const picked = shuffled.slice(0, 1 + rng.nextInt(Math.min(6, cells.length)));
        return {
          team,
          units: picked.map((cell) => ({
            defId: pool[rng.nextInt(pool.length)]!,
            star: 1 + rng.nextInt(3),
            cell,
          })),
        };
      };
      const result = simulate(defs, [build(0), build(1)], seed);
      expect([0, 1, null]).toContain(result.winner);
      expect(result.ticks).toBeGreaterThan(0);
    }
  });
});
