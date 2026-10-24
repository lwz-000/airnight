/**
 * ============================================================
 *  ★★ 0.3.1 盟约（战斗内核部分）：大帝 / 桑葚 / 休谟斯 / 卡莱莎
 * ============================================================
 *
 * 【为什么单独一份？】
 * 这四个盟约的效果发生在**战斗内核**里（回蓝、受击、阵亡）。
 * 内核里的东西一旦写错，联机会直接"校验和不一致"，
 * 而且症状是"打着打着对面卡住"，从日志上根本看不出是盟约。
 *
 * 【守什么】
 *   ① 大帝：技能条获取 +15%（三条回蓝路都走同一个入口）；
 *   ② 桑葚：战斗开始时**只有最右一列**被标记；次数护盾能完整挡下一次任意伤害；
 *   ③ 休谟斯：阵亡时其余我方单位拿到"阵亡者最大生命 20%"的护盾；
 *   ④ 卡莱莎：每次阵亡给剩余我方 +15% 攻击，封顶 +150%。
 */
import { describe, expect, it } from 'vitest';
import {
  SUMMON_DEFS,
  TRAIT_DEFS,
  UNIT_DEFS,
  collectMods,
  computeActiveTraitLevels,
  computeTraitBonuses,
  computeUnitTraitBonuses,
  createBattle,
  dealDamage,
  gainMana,
  resolveUnitMechanics,
  spawnSummon,
  step,
  type BattleState,
  type TeamSetup,
  type UnitPlacement,
} from '../src/index.js';

function place(defId: string, col: number, row: number): UnitPlacement {
  return { defId, star: 1, cell: { col, row } };
}

function team(teamId: 0 | 1, units: UnitPlacement[], covenantId?: string): TeamSetup {
  return {
    team: teamId,
    units,
    traitBonuses: computeTraitBonuses(units, UNIT_DEFS, TRAIT_DEFS),
    unitTraitBonuses: computeUnitTraitBonuses(units, UNIT_DEFS, TRAIT_DEFS),
    activeTraits: computeActiveTraitLevels(units, UNIT_DEFS, TRAIT_DEFS),
    unitMechanics: resolveUnitMechanics(units, UNIT_DEFS, TRAIT_DEFS),
    ...(covenantId ? { covenantId } : {}),
  };
}

/** 我方 3 只（不选自带复活/护盾的棋子），对面一只不动的靶子 */
function makeBattle(myCovenant?: string): BattleState {
  return createBattle(
    UNIT_DEFS,
    [
      team(0, [place('op01', 2, 3), place('op02', 3, 5), place('op03', 4, 7)], myCovenant),
      team(1, [place('op13', 8, 5)]),
    ],
    20261020,
  );
}

/** 一刀打死（真伤，无视护甲/盾） */
function kill(state: BattleState, index: number): void {
  const victim = state.units[index]!;
  const source = state.units.find((unit) => unit.team === 1)!;
  dealDamage(state, source, victim, victim.maxHp * 3, 'true', 'attack');
}

describe('★ 0.3.1 盟约「加急启动」（大帝）：技能条获取 +15%', () => {
  it('同一次回蓝：带盟约多 15%（100 -> 115）', () => {
    const withCovenant = makeBattle('cv_dadi');
    const unitA = withCovenant.units.find((unit) => unit.team === 0)!;
    unitA.mana = 0;
    gainMana(withCovenant, unitA, 100);
    expect(unitA.mana, '100 × 1.15 = 115').toBe(115);

    const without = makeBattle('cv_golia');
    const unitB = without.units.find((unit) => unit.team === 0)!;
    unitB.mana = 0;
    gainMana(without, unitB, 100);
    expect(unitB.mana, '没盟约就是 100').toBe(100);
  });

  it('★ 对手不带盟约时不享受加成（别把效果给错人）', () => {
    const state = makeBattle('cv_dadi');
    const enemy = state.units.find((unit) => unit.team === 1)!;
    enemy.mana = 0;
    gainMana(state, enemy, 100);
    expect(enemy.mana).toBe(100);
  });
});

describe('★ 0.3.1 盟约「药枚实验」（桑葚）：最右一列 + 次数护盾', () => {
  it('★ 战斗开始时只标记我方最右一列（不是全场最右）', () => {
    const state = makeBattle('cv_sangshen');
    const mine = state.units.filter((unit) => unit.team === 0);
    const rightmost = Math.max(...mine.map((unit) => unit.cell.col));
    for (const unit of mine) {
      if (unit.cell.col === rightmost) {
        expect(unit.statuses['cvChargeShield'], `第 ${unit.cell.col} 列应该被标记`).toBe(1);
      } else {
        expect(unit.statuses['cvChargeShield'], `第 ${unit.cell.col} 列不该被标记`).toBeUndefined();
      }
    }
    // 对面没选这个盟约 —— 一只都不能被标记
    for (const enemy of state.units.filter((unit) => unit.team === 1)) {
      expect(enemy.statuses['cvChargeShield']).toBeUndefined();
    }
  });

  it('★★ 次数护盾：完整挡下一次**任意**伤害（含真实伤害），挡完即消耗', () => {
    const state = makeBattle('cv_sangshen');
    const mine = state.units.filter((unit) => unit.team === 0);
    const target = mine[0]!;
    const enemy = state.units.find((unit) => unit.team === 1)!;
    target.statuses['shieldCharges'] = 1;
    const before = target.hp;

    // 真实伤害：护盾和抗性都挡不住，只有"次数护盾"能挡
    const dealt = dealDamage(state, enemy, target, target.maxHp, 'true', 'attack');
    expect(dealt, '这一下应该被完整挡下').toBe(0);
    expect(target.hp, '血量一点都不能掉').toBe(before);
    expect(target.statuses['shieldCharges'], '层数用掉了').toBe(0);

    // 第二下就打在身上了
    const second = dealDamage(state, enemy, target, 1000, 'true', 'attack');
    expect(second).toBeGreaterThan(0);
  });

  it('★ 真的打起来时，被标记的单位攻击会攒出层数（骰子压到必中）', () => {
    const state = makeBattle('cv_sangshen');
    const mine = state.units.filter((unit) => unit.team === 0);
    const target = mine.find((unit) => unit.statuses['cvChargeShield'] === 1)!;
    /*
      ★ 把 rng 固定成 0：20% 的判定必然通过。
      这只影响"触发"，不影响本测试要验的东西（层数有没有加上去）。
    */
    state.rng.nextInt = () => 0;
    target.statuses['shieldCharges'] = 0;
    // 跑 10 秒：被标记的棋子只要出过一次手，就必定攒到至少 1 层
    for (let tick = 0; tick < 200 && !state.over; tick++) step(state, UNIT_DEFS);
    expect(target.statuses['shieldCharges'] ?? 0, '出过手就应该有层数').toBeGreaterThan(0);
  });
});

describe('★ 0.3.1 盟约「回收利用」（休谟斯）：阵亡给全队护盾', () => {
  it('★ 阵亡者最大生命的 20% 变成其余我方的护盾', () => {
    const state = makeBattle('cv_humus');
    const mine = state.units.filter((unit) => unit.team === 0);
    const victim = mine[0]!;
    const survivors = mine.slice(1);
    const expected = Math.floor((victim.maxHp * 2000) / 10000);

    kill(state, state.units.indexOf(victim));
    expect(victim.dead).toBe(true);
    for (const ally of survivors) {
      expect(ally.statuses['shieldValue'], `${ally.defId} 应该拿到护盾`).toBe(expected);
    }
    expect(victim.statuses['shieldValue'] ?? 0, '死人不会给自己加盾').toBe(0);
  });

  it('★ 不带这个盟约：阵亡不给护盾', () => {
    const state = makeBattle('cv_golia');
    const mine = state.units.filter((unit) => unit.team === 0);
    kill(state, state.units.indexOf(mine[0]!));
    for (const ally of mine.slice(1)) {
      expect(ally.statuses['shieldValue'] ?? 0).toBe(0);
    }
  });
});

describe('★ 0.3.1 盟约「食腐之蝶」（卡莱莎）：阵亡叠攻击', () => {
  it('★ 每死一个，剩余我方 +15% 攻击；死两个就是 +30%', () => {
    const state = makeBattle('cv_kaltsa');
    const mine = state.units.filter((unit) => unit.team === 0);
    const survivor = mine[2]!;

    kill(state, state.units.indexOf(mine[0]!));
    expect(collectMods(state, survivor).attackDamageBp).toBe(1500);
    kill(state, state.units.indexOf(mine[1]!));
    expect(collectMods(state, survivor).attackDamageBp).toBe(3000);
  });

  it('★★ 封顶 +150%（第 11 个阵亡不再叠）', () => {
    /*
      ★ 需要 11 个真实阵亡才能验封顶 —— 所以这一局摆 12 只我方（1 只留作幸存者）。
      用 op01/op02/op03 三种棋子交替：它们都不带复活/免死，阵亡就是真死。
    */
    const ids = ['op01', 'op02', 'op03'];
    const units: UnitPlacement[] = [];
    for (let i = 0; i < 12; i++) {
      units.push(place(ids[i % 3]!, i % 5, Math.floor(i / 5)));
    }
    const state = createBattle(
      UNIT_DEFS,
      [team(0, units, 'cv_kaltsa'), team(1, [place('op13', 8, 5)])],
      20261020,
    );
    const mine = state.units.filter((unit) => unit.team === 0);
    const survivor = mine[mine.length - 1]!;

    for (let i = 0; i < 10; i++) {
      kill(state, state.units.indexOf(mine[i]!));
    }
    expect(collectMods(state, survivor).attackDamageBp, '10 层就是 +150%').toBe(15000);

    // 第 11 个阵亡：16500 > 15000，不再叠
    kill(state, state.units.indexOf(mine[10]!));
    expect(collectMods(state, survivor).attackDamageBp, '封顶之后不再涨').toBe(15000);
  });
});

/*
  ★★ 0.3.0 修：**召唤物不算「干员」**。
  盟约写的是"我方**干员**阵亡时"，但召唤物也在 `state.units` 里、也会走 `killUnit`。
  不挡住的话：
    · 送一只召唤物就能白吃一次「命结之秘」的复活；
    · 卡莱莎的攻击力可以靠送召唤物刷满（8 只维娜的兵 = +120%）。
  这几条不报错、只在特定阵容里出现 —— 正是最容易漏的一类。
*/
describe('★ 召唤物不算「干员」：阵亡不触发盟约', () => {
  function summonOf(state: BattleState) {
    const owner = state.units.find((unit) => unit.team === 0)!;
    const def = SUMMON_DEFS['summon_pillar']!;
    return spawnSummon(state, def, owner, { col: 0, row: 0 }, {});
  }

  it('★★ 卡莱莎：召唤物死亡不叠攻击', () => {
    const state = makeBattle('cv_kaltsa');
    const survivor = state.units.find((unit) => unit.team === 0)!;
    const summon = summonOf(state);
    expect(summon).toBeTruthy();
    kill(state, state.units.indexOf(summon!));
    expect(collectMods(state, survivor).attackDamageBp, '召唤物不算干员').toBe(0);
  });

  it('★★ 休谟斯：召唤物死亡不给护盾', () => {
    const state = makeBattle('cv_humus');
    const survivor = state.units.find((unit) => unit.team === 0)!;
    const summon = summonOf(state);
    kill(state, state.units.indexOf(summon!));
    expect(survivor.statuses['shieldValue'] ?? 0).toBe(0);
  });

  it('★★ 命结之秘：召唤物死亡不消耗复活名额', () => {
    const state = makeBattle('cv_emengarde');
    const summon = summonOf(state);
    kill(state, state.units.indexOf(summon!));
    expect(summon!.dead, '召唤物该真死').toBe(true);
    expect(state.covenantRevives[0], '不能白吃一次复活').toBe(0);
  });
});
