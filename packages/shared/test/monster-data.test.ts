/**
 * ============================================================
 *  野怪（★ 0.0.3）：名单 / 级别 / 野怪回合 / 商店隔离 / 二阶段
 * ============================================================
 *
 * 这一版要钉住的四条：
 *   ① 19 只野怪、5 个级别都在，每只都有技能和官方素材 id；
 *   ② **野怪永远不进商店 / 牌库**（这是用户点名的）——
 *      商店抽卡、牌库剩余、单机敌方干员阵营，三条路都刷不出来；
 *   ③ 野怪回合表：第 1、2 回合 + 之后每 7 回合（9/16/23/30/37…）；
 *   ④ 二阶段「重生」只挂在部分精英 / 小领袖 / Boss 上，且数值合理。
 */
import { describe, expect, it } from 'vitest';
import {
  MONSTER_DEFS,
  MONSTER_ROSTER,
  MONSTER_TIERS,
  MONSTER_TIER_LABEL,
  UNIT_DEFS,
  formationCells as fieldFormationCells,
  isMonsterRound,
  isPlayableDef,
  monsterDefs,
  // ★ 0.2.2：顶栏「距野怪回合还剩几回合」
  monsterRoundCountdown,
  monsterTeamSetup,
  monsterWaveForRound,
  monsterWaveText,
  nextMonsterRound,
  playableDefs,
  remainingPool,
  unitIdsByCost,
  type MonsterTier,
} from '../src/index.js';
import { TEAM_1_MIN_COL } from '../src/constants.js';

describe('★ 野怪名单：19 只、5 个级别', () => {
  it('数量对得上（小怪 4 / 普通 5 / 精英 5 / 小领袖 3 / Boss 2；另加 3 只特殊）', () => {
    /*
      ★ 0.1.3：`special` 档（"左手" / 血骑士 / 锏）**不算进"波次野怪"的档位分布** ——
      它们不进波次、也不是按档位设计的（数值是直接给定的）。
    */
    const roster = MONSTER_ROSTER.filter((entry) => entry.tier !== 'special');
    expect(roster, '参与波次的野怪').toHaveLength(19);
    expect(MONSTER_ROSTER.length, '加上 4 只特殊（3 只单位 + 凝血之刃）').toBe(23);
    const byTier = new Map<MonsterTier, number>();
    for (const entry of roster) byTier.set(entry.tier, (byTier.get(entry.tier) ?? 0) + 1);
    expect([...byTier.entries()].sort()).toEqual([
      ['boss', 2],
      ['elite', 5],
      ['leader', 3],
      ['minion', 4],
      ['normal', 5],
    ]);
  });

  it('5 个级别都有中文名（界面上要用）', () => {
    for (const tier of MONSTER_TIERS) {
      expect(MONSTER_TIER_LABEL[tier].length).toBeGreaterThan(0);
    }
  });

  it('每只野怪都有：技能、级别、官方敌人 id（挂小人素材用）', () => {
    for (const def of monsterDefs()) {
      expect(def.monsterOnly, `${def.name} 没被标成 monsterOnly`).toBe(true);
      expect(def.monsterTier, `${def.name} 没有级别`).toBeDefined();
      expect(def.charId, `${def.name} 没有 charId（挂不上小人素材）`).toMatch(/^enemy_/);
      expect(def.skill.name.length).toBeGreaterThan(0);
      expect(def.skill.desc.length).toBeGreaterThan(0);
      expect(def.base.hp).toBeGreaterThan(0);
      /*
        ★ 0.1.3：**不攻击**的野怪（凝血之刃 —— 用户明确写的是"不攻击"）攻击力就是 0，
        那是设计而不是漏填，所以这里只要求非负（它的行为由 `escort` 机制接管）。
      */
      expect(def.base.attackDamage, `${def.name} 攻击力`).toBeGreaterThanOrEqual(0);
    }
  });

  it('id 和官方素材 id 都不重名（重名会两套素材互相覆盖）', () => {
    const ids = MONSTER_ROSTER.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    const enemyIds = MONSTER_ROSTER.map((entry) => entry.enemyId);
    expect(new Set(enemyIds).size).toBe(enemyIds.length);
  });

  it('★ 野怪不升星：星级倍率固定 1000（战斗中恒按 1 星算）', () => {
    for (const def of monsterDefs()) {
      expect(def.starHpBp, `${def.name} 的 starHpBp 该是 1000`).toBe(1000);
      expect(def.starDamageBp, `${def.name} 的 starDamageBp 该是 1000`).toBe(1000);
    }
  });

  it('★ 野怪没有羁绊（不然它们会吃到玩家的羁绊加成）', () => {
    for (const def of monsterDefs()) {
      expect(def.traits, `${def.name} 不该有羁绊`).toEqual([]);
    }
  });

  it('级别越高越强（血量单调递增，抓"数值抄错档位"）', () => {
    const avgHp = new Map<MonsterTier, number>();
    for (const tier of MONSTER_TIERS) {
      const list = monsterDefs().filter((def) => def.monsterTier === tier);
      avgHp.set(tier, list.reduce((sum, def) => sum + def.base.hp, 0) / list.length);
    }
    /*
      ★ 0.1.3：`special` 档（"左手" / 血骑士 / 锏）**不参与档位强弱比较** ——
      它们不是"按档位设计"的野怪（数值是直接给定的），而且这个档位本来就不进波次。
      所以这里只比较"真的有成员的档"，空档跳过（不让 NaN 把测试搞红）。
    */
    const used = MONSTER_TIERS.filter((tier) => tier !== 'special').filter((tier) =>
      monsterDefs().some((def) => def.monsterTier === tier),
    );
    for (let i = 1; i < used.length; i++) {
      const lower = used[i - 1]!;
      const higher = used[i]!;
      expect(
        avgHp.get(higher)!,
        `${MONSTER_TIER_LABEL[higher]} 的平均血量该高于 ${MONSTER_TIER_LABEL[lower]}`,
      ).toBeGreaterThan(avgHp.get(lower)!);
    }
  });
});

describe('★ 野怪永远刷不到：商店 / 牌库 / 敌方干员三条路都要挡住', () => {
  it('isPlayableDef 对野怪一律返回 false', () => {
    for (const def of monsterDefs()) {
      expect(isPlayableDef(def), `${def.name} 不该是"能抽到"的棋子`).toBe(false);
    }
  });

  it('playableDefs 里一只野怪都没有', () => {
    expect(playableDefs().some((def) => def.monsterOnly === true)).toBe(false);
  });

  it('★ 商店抽卡表（unitIdsByCost）里没有野怪', () => {
    for (let cost = 1; cost <= 5; cost++) {
      const ids = unitIdsByCost(cost);
      for (const def of monsterDefs()) {
        expect(ids, `${def.name} 出现在 ${cost} 费的抽卡表里`).not.toContain(def.id);
      }
    }
  });

  it('★ 牌库剩余里没有野怪的条目（它们根本不进牌库）', () => {
    const remaining = remainingPool([]);
    for (const def of monsterDefs()) {
      expect(remaining.has(def.id), `${def.name} 不该有牌库剩余`).toBe(false);
    }
  });

  it('野怪也确实并进了 UNIT_DEFS（战斗内核只认一张表）', () => {
    for (const def of monsterDefs()) {
      expect(UNIT_DEFS[def.id], `${def.name} 不在 UNIT_DEFS 里`).toBeDefined();
    }
    expect(Object.keys(MONSTER_DEFS).length, '19 只波次野怪 + 4 只特殊').toBe(23);
  });
});

describe('★ 野怪回合：按《野怪分布.txt》列的回合', () => {
  it('第 1~70 回合里，是野怪回合的正好是 1,2,9,16,23,30,37,44,51,58,65', () => {
    const got = Array.from({ length: 70 }, (_, i) => i + 1).filter(isMonsterRound);
    expect(got).toEqual([1, 2, 9, 16, 23, 30, 37, 44, 51, 58, 65]);
  });

  it('★ 37 之后一律 +7（用户表里的 43 / 63 是笔误，已改成 44 / 65）', () => {
    for (const round of [37, 44, 51, 58, 65, 72, 79]) {
      expect(isMonsterRound(round), `第 ${round} 回合该是野怪回合`).toBe(true);
    }
    for (const round of [43, 50, 57, 63, 70]) {
      expect(isMonsterRound(round), `第 ${round} 回合不该是野怪回合（那是旧的笔误回合号）`).toBe(false);
    }
  });

  it('70 之后按 7 回合一轮继续（79 / 86 / 93）', () => {
    expect([79, 86, 93].every(isMonsterRound)).toBe(true);
    expect([73, 78, 85].some(isMonsterRound)).toBe(false);
  });

  it('第 1、2 回合必须是野怪回合（你点名的）', () => {
    expect(isMonsterRound(1)).toBe(true);
    expect(isMonsterRound(2)).toBe(true);
  });

  it('第 3~8 回合不是野怪回合', () => {
    for (const round of [3, 4, 5, 6, 7, 8]) expect(isMonsterRound(round)).toBe(false);
  });

  it('边界：0 / 负数 / NaN 都不算野怪回合（防越界）', () => {
    expect(isMonsterRound(0)).toBe(false);
    expect(isMonsterRound(-7)).toBe(false);
    expect(isMonsterRound(Number.NaN)).toBe(false);
  });

  it('nextMonsterRound 能报出"下一个野怪回合"', () => {
    expect(nextMonsterRound(3)).toBe(9);
    expect(nextMonsterRound(9)).toBe(16);
    expect(nextMonsterRound(16)).toBe(23);
  });
});

/*
  ★ 0.2.2 新功能：顶栏「距离下一个野怪回合还剩几回合」。
  界面只管念这个函数的结论 —— 节奏的唯一实现仍是 `isMonsterRound`，
  所以这里测的是"倒计时和节奏对不对得上"，不是另造一套规则。
*/
describe('★ 0.2.2：monsterRoundCountdown（顶栏倒计时）', () => {
  it('本回合就是野怪回合时：now=true、roundsLeft=0、round=自己', () => {
    for (const round of [1, 2, 9, 16, 23]) {
      expect(monsterRoundCountdown(round), `第 ${round} 回合`).toEqual({
        now: true,
        roundsLeft: 0,
        round,
      });
    }
  });

  it('第 3~8 回合：都指向第 9 回合，剩余回合数依次递减', () => {
    const got = [3, 4, 5, 6, 7, 8].map((round) => monsterRoundCountdown(round));
    expect(got.map((item) => item.round)).toEqual([9, 9, 9, 9, 9, 9]);
    expect(got.map((item) => item.roundsLeft)).toEqual([6, 5, 4, 3, 2, 1]);
    expect(got.every((item) => item.now === false)).toBe(true);
  });

  it('每一回合的倒计时都和 isMonsterRound 自洽（1~100 全扫）', () => {
    for (let round = 1; round <= 100; round++) {
      const cd = monsterRoundCountdown(round);
      // now 就是"我是不是野怪回合"的另一说法
      expect(cd.now, `第 ${round} 回合 now 判错`).toBe(isMonsterRound(round));
      // 报出来的那个回合一定是野怪回合
      expect(isMonsterRound(cd.round), `第 ${round} 回合报的 ${cd.round} 不是野怪回合`).toBe(true);
      // "还要等几回合"再往后走那么多步，正好就是它
      expect(monsterRoundCountdown(round + cd.roundsLeft).round, `第 ${round} 回合走 ${cd.roundsLeft} 步`).toBe(
        cd.round,
      );
    }
  });

  it('边界：0 / 负数 / NaN 一律当第 1 回合（顶栏不会显示负数）', () => {
    expect(monsterRoundCountdown(0)).toEqual({ now: true, roundsLeft: 0, round: 1 });
    expect(monsterRoundCountdown(-5)).toEqual({ now: true, roundsLeft: 0, round: 1 });
    expect(monsterRoundCountdown(Number.NaN)).toEqual({ now: true, roundsLeft: 0, round: 1 });
  });
});

describe('★ 野怪波次（按《野怪分布.txt》）', () => {
  const tierOf = (defId: string) => MONSTER_DEFS[defId]!.monsterTier!;
  const countByTier = (round: number) => {
    const map = new Map<string, number>();
    for (const unit of monsterWaveForRound(round)) map.set(tierOf(unit.defId), (map.get(tierOf(unit.defId)) ?? 0) + 1);
    return map;
  };

  it('每一回合的档位与数量都对得上表', () => {
    expect(monsterWaveForRound(1)).toHaveLength(2);
    expect(monsterWaveForRound(2)).toHaveLength(3);
    expect(countByTier(1).get('minion')).toBe(2);
    expect(countByTier(9).get('normal')).toBe(5);
    expect(countByTier(16)).toEqual(new Map([['elite', 3], ['normal', 3]]));
    expect(countByTier(23)).toEqual(new Map([['elite', 5], ['normal', 5]]));
    expect(countByTier(30)).toEqual(new Map([['leader', 1], ['elite', 3]]));
    expect(countByTier(37)).toEqual(new Map([['leader', 2], ['elite', 5]]));
    expect(countByTier(44)).toEqual(new Map([['leader', 3], ['elite', 5]]));
    expect(countByTier(51)).toEqual(new Map([['boss', 1]]));
    expect(countByTier(58)).toEqual(new Map([['boss', 1], ['leader', 1]]));
    expect(countByTier(65)).toEqual(new Map([['boss', 1], ['leader', 3]]));
    expect(countByTier(72)).toEqual(new Map([['boss', 2], ['leader', 3], ['elite', 5]]));
  });

  it('★ 骰子只由回合号决定：同一回合算多少次都是同一波（联机要一致）', () => {
    for (const round of [1, 9, 23, 72]) {
      expect(monsterWaveForRound(round)).toEqual(monsterWaveForRound(round));
    }
  });

  it('★ 深池影刃 / 卫队精英必定同时出现（表里点名的）', () => {
    // 精英够多（5 只）时，抽到其中一只的回合里另一只也一定在
    for (const round of [23, 37, 44, 72]) {
      const ids = monsterWaveForRound(round).map((unit) => unit.defId);
      const hasBlade = ids.includes('mn_dushdo');
      const hasGuard = ids.includes('mn_duholy');
      expect(hasBlade, `第 ${round} 回合：影刃在则卫队也要在`).toBe(hasGuard);
    }
  });

  it('所有野怪都是 1 星（野怪不升星）', () => {
    for (const unit of monsterWaveForRound(72)) expect(unit.star).toBe(1);
  });

  it('波次站在**对手半场**，而且行号往中间靠（不再全挤在最上面）', () => {
    for (const round of [1, 2, 9, 23, 72]) {
      for (const unit of monsterWaveForRound(round)) {
        expect(unit.cell.col).toBeGreaterThanOrEqual(TEAM_1_MIN_COL);
      }
    }
    // 第 1 回合只有 2 只：应当贴着中间站（离中线不超过 1 行），而不是挤在最上面
    const rows = monsterWaveForRound(1).map((unit) => unit.cell.row);
    for (const row of rows) {
      expect(Math.abs(row - 4.5), `row=${row} 太靠边了`).toBeLessThanOrEqual(1.5);
    }
  });

  it('近战站前排、远程站后排（射程 >1 的列更靠后）', () => {
    // 直接量站位函数（野怪波次和单机对手用的是同一个）
    const cells = fieldFormationCells(1, [1, 3, 1, 2]);
    const meleeCols = [cells[0]!.col, cells[2]!.col];
    const rangedCols = [cells[1]!.col, cells[3]!.col];
    expect(Math.min(...rangedCols)).toBeGreaterThan(Math.max(...meleeCols));
    // 都在对手半场
    for (const cell of cells) expect(cell.col).toBeGreaterThanOrEqual(TEAM_1_MIN_COL);
  });

  it('波次描述能念出名字', () => {
    const text = monsterWaveText(monsterWaveForRound(1));
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain('（空波次）');
  });

  it('monsterTeamSetup 只带 units（野怪没有羁绊，字段可省）', () => {
    const setup = monsterTeamSetup(9, 1);
    expect(setup.team).toBe(1);
    expect(setup.units.length).toBeGreaterThan(0);
    expect(setup.traitBonuses).toBeUndefined();
  });
});

describe('★ 二阶段「重生」', () => {
  const reborns = monsterDefs().filter((def) => def.reborn);

  it('挂在 4 只上（杰斯顿 / 复仇者 / 两个 Boss）——“盛怒”没有复活（用户确认）', () => {
    /*
      ★ 0.1.3：这里只数**波次野怪**里带二阶段的 4 只 ——
      三只特殊野怪（左手 / 血骑士 / 锏）也都有复活，但它们不进波次，
      单独在 `special-monster.test.ts` 里钉。
    */
    expect(reborns.filter((def) => def.monsterTier !== 'special').map((def) => def.name).sort()).toEqual(
      ['“复仇者”', '博卓卡斯替，圣卫铳骑', '奎隆，摩诃萨埵权化', '杰斯顿·威廉姆斯'].sort(),
    );
    expect(monsterDefs().find((def) => def.id === 'mn_spklr')?.reborn).toBeUndefined();
  });

  it('只有精英以上才有（小怪不该站起来）', () => {
    for (const def of reborns) {
      // ★ 0.1.3：special 也算"高级别"（三只特殊野怪都有复活）
      expect(['elite', 'leader', 'boss', 'special'], `${def.name} 的级别不该有重生`).toContain(def.monsterTier!);
    }
  });

  it('重生的血量和强化都是正数（写 0 等于没有二阶段）', () => {
    for (const def of reborns) {
      const reborn = def.reborn!;
      expect(reborn.hpBp, `${def.name} 重生血量`).toBeGreaterThan(0);
      expect(reborn.desc.length, `${def.name} 重生描述`).toBeGreaterThan(0);
      if (reborn.damageBp !== undefined) expect(reborn.damageBp).toBeGreaterThan(10000);
      if (reborn.attackSpeedBp !== undefined) expect(reborn.attackSpeedBp).toBeGreaterThan(10000);
    }
  });

  it('★ 没有哪只野怪需要"换一整套素材"（杰斯顿的二阶段还是本体那套骨架的 C2_* 动作）', () => {
    for (const def of reborns) {
      if (!def.reborn?.enemyId) continue;
      expect(def.reborn.enemyId, `${def.name} 的二阶段不该和本体用同一个 id`).not.toBe(def.charId);
    }
  });

  it('★ 杰斯顿的倒地演出是 2 倍速（它的阵亡动作 4 秒、倒地只等 3 秒）', () => {
    const jakill = monsterDefs().find((def) => def.id === 'mn_jakill')!;
    expect(jakill.reborn?.downedAnimSpeed).toBe(2);
    // 别的单位不写这个字段 = 原速，观感一个字都不变
    for (const def of reborns) {
      if (def.id === 'mn_jakill') continue;
      expect(def.reborn?.downedAnimSpeed, `${def.name} 不该被顺手改快`).toBeUndefined();
    }
  });

  it('两个 Boss 的二阶段复用同一个模型（素材库里 2097/2099 目录装的就是本体模型）', () => {
    for (const name of ['博卓卡斯替，圣卫铳骑', '奎隆，摩诃萨埵权化']) {
      const def = monsterDefs().find((item) => item.name === name)!;
      expect(def.reborn?.enemyId, `${name} 不该硬塞一个不存在的二阶段素材`).toBeUndefined();
    }
  });
});
