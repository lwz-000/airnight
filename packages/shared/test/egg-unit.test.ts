/**
 * ============================================================
 *  ★ 彩蛋棋子「维维美·绝对主角」—— 数据 / 商店概率 / 无星级 / 战斗行为
 * ============================================================
 *
 * 【为什么单独一份？】
 * 它和现有三类棋子（干员 / 召唤物 / 野怪）**都不一样**：
 *   · 20 费（不在 1~5 费里）、没有任何羁绊、没有星级机制
 *   · 只靠商店那条 1/1500 的特殊概率出现
 * 所以它的规则散在好几处（unit-data / economy / state / rules），
 * 集中在一份测试里，以后改哪条都能一眼看到"哪些约定不能破"。
 *
 * 每一项都对着用户的原话：
 *   「没有星级机制，购买费用 20 金币，商店刷新出的概率为 1/1500
 *     （不进行标注在概率显示上）（不会受商店等级概率限制，即全部等级概率统一）
 *     没有任何羁绊，可以佩戴装备
 *     生命值 12000，攻击力 700，双抗 50，射程 5，攻击速度 1.2
 *     技能：攻击回复，攻击一次回复 125 点技能点（开技能为 1000）
 *           同时攻击 4 个敌人，持续 15 秒
 *     被动：攻击造成攻击力 100% 的 3 连击，有 30%（连击单独计算）概率眩晕目标 1 秒，
 *           并对周围 8 格造成 2 次攻击力 50% 的连击」
 */

import { describe, expect, it } from 'vitest';
import {
  EGG_SHOP_DENOMINATOR,
  EGG_UNIT,
  EGG_UNIT_ID,
  UNIT_DEFS,
  collectMods,
  createBattle,
  createEconomy,
  mergeBench,
  playableDefs,
  resolveUnitMechanics,
  rollShop,
  step,
  unitIdsByCost,
  type BattleEvent,
  type Cell,
  type TeamSetup,
  type UnitDef,
  type UnitDefTable,
} from '../src/index.js';
import { MID_ROW, TEAM0_FRONT_COL, TEAM1_FRONT_COL } from './helpers.js';

// ============================================================
//  1. 数据
// ============================================================

describe('★ 彩蛋棋子：数值与身份', () => {
  it('id / 名字 / 费用 / 没有羁绊 / 有 noStar 标记', () => {
    expect(EGG_UNIT_ID).toBe('egg_mvm');
    expect(EGG_UNIT.id).toBe(EGG_UNIT_ID);
    expect(EGG_UNIT.name).toBe('维维美·绝对主角');
    expect(EGG_UNIT.cost).toBe(20);
    expect(EGG_UNIT.traits, '用户要求"没有任何羁绊"').toEqual([]);
    expect(EGG_UNIT.noStar, '没有星级机制').toBe(true);
    // 它必须能被正常买到 —— 所以不能是召唤物/野怪
    expect(EGG_UNIT.summonOnly).toBeUndefined();
    expect(EGG_UNIT.monsterOnly).toBeUndefined();
  });

  it('五项基础数值逐条对：生命 12000 / 攻击 700 / 双抗 50 / 射程 5 / 攻速 1.2', () => {
    expect(EGG_UNIT.base.hp).toBe(12000);
    expect(EGG_UNIT.base.attackDamage).toBe(700);
    expect(EGG_UNIT.base.armor).toBe(50);
    expect(EGG_UNIT.base.magicResist).toBe(50);
    expect(EGG_UNIT.base.range).toBe(5);
    // 内核里攻速是"千分之一"：1.2 次/秒 => 1200
    expect(EGG_UNIT.base.attackSpeed).toBe(1200);
  });

  it('星级倍率恒 1000（= ×1.0）：它没有星级机制，升星不该变强', () => {
    expect(EGG_UNIT.starHpBp).toBe(10000);
    expect(EGG_UNIT.starDamageBp).toBe(10000);
  });

  it('模型挂的是维什戴尔皮肤「绝对主角」的素材', () => {
    expect(EGG_UNIT.charId).toBe('char_1035_wisdel_game_9');
  });

  it('它确实能"被抽到"：在 playableDefs 里（否则商店永远刷不出来）', () => {
    expect(playableDefs().some((def) => def.id === EGG_UNIT_ID)).toBe(true);
    expect(UNIT_DEFS[EGG_UNIT_ID]).toBeDefined();
  });

  it('它不在 1~5 费的抽卡池里（只能靠那条 1/1500 出现）', () => {
    for (let cost = 1; cost <= 5; cost++) {
      expect(unitIdsByCost(cost).includes(EGG_UNIT_ID), `${cost} 费池里混进了彩蛋`).toBe(false);
    }
    // 反证：按它自己的费用（20）取，只有它一个
    expect(unitIdsByCost(20)).toEqual([EGG_UNIT_ID]);
  });
});

// ============================================================
//  2. 技能与被动
// ============================================================

describe('★ 彩蛋棋子：技能与被动', () => {
  it('技能是"攻击回复"，每打一下 125 点（上限 1000 => 8 下开一次）', () => {
    expect(EGG_UNIT.skill.manaSource).toBe('attack');
    expect(EGG_UNIT.base.manaPerAttack).toBe(125);
  });

  it('主动：给自己挂限时增益，同时攻击 4 个敌人（= 额外 3 个），持续 15 秒', () => {
    expect(EGG_UNIT.skill.effects).toHaveLength(1);
    const effect = EGG_UNIT.skill.effects[0]!;
    expect(effect.kind).toBe('buff');
    if (effect.kind !== 'buff') throw new Error('类型收窄');
    expect(effect.target).toBe('self');
    // 主目标之外再打 3 个 => 一共 4 个
    expect(effect.stats.extraTargets).toBe(3);
    // 20 tick = 1 秒
    expect(effect.durationTicks).toBe(15 * 20);
  });

  it('被动①：3 连击（每段都是 100% 攻击力 -> 内核里就是 multiHit: 3）', () => {
    expect(EGG_UNIT.skill.passive?.multiHit).toBe(3);
  });

  it('被动②：每段连击各有 30% 概率眩晕 1 秒（"连击单独计算" -> perHit）', () => {
    const stun = EGG_UNIT.skill.passive?.stunOnHit;
    expect(stun).toBeDefined();
    expect(stun!.chanceBp).toBe(3000);
    expect(stun!.durationTicks).toBe(20);
    expect(stun!.perHit, '逐段判定，不是整次攻击只判一次').toBe(true);
  });

  it('被动③：对周围 8 格造成 2 次攻击力 50%（半径 1 方形 - 主目标自身 = 周围 8 格）', () => {
    const splash = EGG_UNIT.skill.passive?.splash;
    expect(splash).toBeDefined();
    expect(splash!.radius).toBe(1);
    expect(splash!.shape).toBe('square');
    expect(splash!.hits, '2 次').toBe(2);
    expect(splash!.ratioBp, '50%').toBe(5000);
    // ★ 基数必须是"攻击力"而不是"这次攻击打出的总伤害"：
    //   3 连击下用总伤害会让 50% 变成 150%
    expect(splash!.basis).toBe('attack');
  });
});

// ============================================================
//  3. 商店概率
// ============================================================

/**
 * 游戏里真正的随机源是 mulberry32 —— 返回的是 **32 位无符号整数**，
 * 不是 [0,1) 的小数。所以这里的测试随机源也必须保持同样的契约，
 * 否则会测出"概率判定永远不成立"这种假阴性（这个坑真的踩过一次）。
 */
function intRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
    t = (t ^ (t + Math.imul(t ^ (t >>> 7), t | 61))) >>> 0;
    return (t ^ (t >>> 14)) >>> 0;
  };
}

describe('★ 彩蛋棋子：商店 1/1500', () => {
  it('概率常量就是 1/1500（用取模判定，和商店其它概率同一个风格）', () => {
    expect(EGG_SHOP_DENOMINATOR).toBe(1500);
  });

  it('长跑统计：刷新 15000 次，大约见到 10 次（1/1500）', () => {
    const random = intRng(20261011);
    let hits = 0;
    let slotsWithEgg = 0;
    const rounds = 15000;
    for (let i = 0; i < rounds; i++) {
      const slots = rollShop(1, random, UNIT_DEFS);
      const n = slots.filter((slot) => slot.defId === EGG_UNIT_ID).length;
      if (n > 0) hits++;
      slotsWithEgg += n;
    }
    // 期望 15000/1500 = 10 次；给一个宽松区间，只验证"量级对"
    expect(hits, `15000 次里出现了 ${hits} 次`).toBeGreaterThan(0);
    expect(hits, `15000 次里出现了 ${hits} 次（期望约 10）`).toBeLessThan(45);
    // 一次刷新最多出现一个（不是 5 格各判一次）
    expect(slotsWithEgg).toBe(hits);
  });

  it('★ 不受商店等级影响：1~10 级都用同一个概率', () => {
    /*
      用固定的整数随机序列：前 10 次给"每格 2 次"的正常抽卡
      （1 让费用档和索引都稳定、且 1 % 1500 !== 0 不会误触发），
      第 11 次（彩蛋判定）给 0 -> 必然命中。
    */
    for (let level = 1; level <= 10; level++) {
      const vals = [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0, 0];
      let i = 0;
      const trigger = (): number => vals[i++] ?? 1;
      const slots = rollShop(level, trigger, UNIT_DEFS);
      expect(
        slots.some((slot) => slot.defId === EGG_UNIT_ID),
        `${level} 级没刷出彩蛋`,
      ).toBe(true);
    }
  });

  it('不命中时一个都不出现（判定阈值之上就完全不掺进来）', () => {
    const vals = [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0];
    let i = 0;
    const noTrigger = (): number => vals[i++] ?? 1;
    const slots = rollShop(10, noTrigger, UNIT_DEFS);
    expect(slots.some((slot) => slot.defId === EGG_UNIT_ID)).toBe(false);
    // 而且 5 个格子都是正常棋子（没有被"空出来"）
    expect(slots.every((slot) => slot.defId !== '')).toBe(true);
  });
});

// ============================================================
//  4. 没有星级机制
// ============================================================

describe('★ 彩蛋棋子：没有星级机制', () => {
  it('三个它凑在一起**不会**合成（三张不合一）', () => {
    const state = createEconomy(() => 0);
    state.bench = [];
    for (let i = 0; i < 3; i++) {
      state.bench.push({ uid: 900000 + i, defId: EGG_UNIT_ID, star: 1 });
    }
    let uid = 910000;
    mergeBench(state, () => uid++);
    expect(state.bench.filter((unit) => unit.defId === EGG_UNIT_ID)).toHaveLength(3);
    expect(state.bench.every((unit) => unit.star === 1)).toBe(true);
  });

  it('对照：换成一个正常干员，同样三个就会合成 2 星', () => {
    const state = createEconomy(() => 0);
    state.bench = [];
    const defId = 'op01';
    for (let i = 0; i < 3; i++) {
      state.bench.push({ uid: 900100 + i, defId, star: 1 });
    }
    let uid = 910100;
    mergeBench(state, () => uid++);
    expect(state.bench).toHaveLength(1);
    expect(state.bench[0]!.star).toBe(2);
  });
});

// ============================================================
//  5. 战斗行为（真的打一场）
// ============================================================

/**
 * 一个不还手的沙包：护甲 0、血厚到打不死，而且 **noMove**。
 *
 * 【为什么必须 noMove？】
 * 它的攻击力是 0、射程 1，但内核的索敌是"找最近的敌人"——
 * 站在后面的沙包会自己绕路去接近，位置一变，
 * "谁落在主目标的 3×3 里"这种断言就全错（第一版就是这么红了一片）。
 */
function dummyDef(id: string): UnitDef {
  return {
    id,
    name: id,
    cost: 1,
    traits: [],
    base: {
      hp: 1000000,
      attackDamage: 0,
      attackSpeed: 1000,
      armor: 0,
      magicResist: 0,
      range: 1,
      manaPerAttack: 0,
    },
    starHpBp: 1000,
    starDamageBp: 1000,
    color: '#888888',
    sprite: id,
    skill: {
      id: `${id}_skill`,
      name: id,
      desc: id,
      effects: [],
      passive: { noMove: true },
      manaSource: 'attack',
    },
  };
}

/**
 * 摆一场「彩蛋 vs 一排沙包」。
 *
 * ★ 每个沙包一个**独立的 defId**（dummy0 / dummy1 / …）——
 * 断言时按 defId 找人就永远可靠，不用赌它站在哪一格。
 */
function battleWith(enemyCells: Cell[], seed = 12345) {
  const enemyIds = enemyCells.map((_, i) => `dummy${i}`);
  const defs: UnitDefTable = { [EGG_UNIT_ID]: EGG_UNIT };
  for (const id of enemyIds) defs[id] = dummyDef(id);

  const mk = (team: 0 | 1, cells: Cell[], defIds: string[]): TeamSetup => {
    const units = cells.map((cell, i) => ({ defId: defIds[i]!, star: 1, cell }));
    return { team, units, unitMechanics: resolveUnitMechanics(units, defs, {}) };
  };
  const eggCell: Cell = { col: TEAM0_FRONT_COL, row: MID_ROW };
  const state = createBattle(defs, [mk(0, [eggCell], [EGG_UNIT_ID]), mk(1, enemyCells, enemyIds)], seed);
  const egg = state.units.find((unit) => unit.defId === EGG_UNIT_ID)!;
  return { state, egg, defs, enemyIds };
}

/** 把某一 tick 的伤害事件按"打的是谁"分组（值是 FIX 单位的伤害量） */
function damageAt(state: ReturnType<typeof battleWith>['state'], sourceId: number, t: number) {
  const events = state.log.filter(
    (e): e is Extract<BattleEvent, { type: 'damage' }> =>
      e.type === 'damage' && e.sourceId === sourceId && e.t === t,
  );
  const byTarget = new Map<number, number[]>();
  for (const e of events) {
    byTarget.set(e.targetId, [...(byTarget.get(e.targetId) ?? []), e.amount]);
  }
  return byTarget;
}

/** 彩蛋第一次出手的那条伤害事件 */
function firstHit(state: ReturnType<typeof battleWith>['state'], eggId: number) {
  const first = state.log.find(
    (e): e is Extract<BattleEvent, { type: 'damage' }> => e.type === 'damage' && e.sourceId === eggId,
  );
  expect(first, '彩蛋应该出手了').toBeDefined();
  return first!;
}

describe('★ 彩蛋棋子：战斗行为', () => {
  it('被动：一次攻击对主目标打出 3 段（3 连击，每段都是满额攻击力）', () => {
    const { state, egg, defs } = battleWith([{ col: TEAM1_FRONT_COL, row: MID_ROW }]);
    for (let i = 0; i < 40; i++) step(state, defs);

    const hit = firstHit(state, egg.id);
    const mainTarget = state.units.find((u) => u.defId === 'dummy0')!;
    const amounts = damageAt(state, egg.id, hit.t).get(mainTarget.id) ?? [];
    expect(amounts, '主目标该挨 3 段').toHaveLength(3);
    // 三段等额（都是满额攻击力 = 700 × FIX）
    expect(amounts[0]).toBe(700 * 1000);
    expect(amounts[1]).toBe(amounts[0]);
    expect(amounts[2]).toBe(amounts[0]);
  });

  it('被动：主目标周围 8 格的敌人再挨 2 段、每段正好是主目标单段的一半（50%）', () => {
    // 紧贴主目标的那一格 —— 落在"以主目标为中心的 3×3"里
    const { state, egg, defs } = battleWith([
      { col: TEAM1_FRONT_COL, row: MID_ROW },
      { col: TEAM1_FRONT_COL + 1, row: MID_ROW },
    ]);
    for (let i = 0; i < 40; i++) step(state, defs);

    const hit = firstHit(state, egg.id);
    const byTarget = damageAt(state, egg.id, hit.t);
    const main = state.units.find((u) => u.defId === 'dummy0')!;
    const near = state.units.find((u) => u.defId === 'dummy1')!;

    const mainHits = byTarget.get(main.id) ?? [];
    const nearHits = byTarget.get(near.id) ?? [];
    expect(mainHits, '主目标 3 段').toHaveLength(3);
    expect(nearHits, '周围那格 2 段').toHaveLength(2);
    // 周围那格每段 = 主目标单段 × 50%
    for (const h of nearHits) expect(h).toBe(Math.floor(mainHits[0]! / 2));
  });

  it('被动：范围半径确实只有 1 格（隔着 2 格的敌人不被波及）', () => {
    const { state, egg, defs } = battleWith([
      { col: TEAM1_FRONT_COL, row: MID_ROW },
      { col: TEAM1_FRONT_COL + 2, row: MID_ROW },
    ]);
    for (let i = 0; i < 40; i++) step(state, defs);

    const hit = firstHit(state, egg.id);
    const far = state.units.find((u) => u.defId === 'dummy1')!;
    expect(damageAt(state, egg.id, hit.t).get(far.id), '隔着 2 格不该吃到范围伤害').toBeUndefined();
  });

  it('技能：攒满法力后同时攻击 4 个敌人（额外 3 个目标生效）', () => {
    // 一字排开 4 个敌人，全在射程 5 内
    const cells: Cell[] = [0, 1, 2, 3].map((i) => ({ col: TEAM1_FRONT_COL + i, row: MID_ROW }));
    const { state, egg, defs } = battleWith(cells);

    // 攻速 1.2 => 打 8 下约 6.7 秒；跑 20 秒足够开技能
    let castTick = -1;
    for (let i = 0; i < 400; i++) {
      step(state, defs);
      if (castTick < 0) {
        const cast = state.log.find((e) => e.type === 'cast' && e.unitId === egg.id);
        if (cast) castTick = cast.t;
      }
    }
    expect(castTick, '彩蛋该在 20 秒内放出技能').toBeGreaterThan(0);

    // 技能之前：只有主目标 + 周围那一格（2 个）
    const before = state.log.find(
      (e): e is Extract<BattleEvent, { type: 'damage' }> =>
        e.type === 'damage' && e.sourceId === egg.id && e.t < castTick,
    )!;
    expect(damageAt(state, egg.id, before.t).size, '技能前只打 2 个').toBe(2);

    // 技能之后：主目标 + 额外 3 个 = 4 个（看某一 tick 内覆盖了几个目标）
    let maxTargets = 0;
    const ticks = new Set(
      state.log
        .filter(
          (e): e is Extract<BattleEvent, { type: 'damage' }> =>
            e.type === 'damage' && e.sourceId === egg.id && e.t > castTick,
        )
        .map((e) => e.t),
    );
    for (const t of ticks) maxTargets = Math.max(maxTargets, damageAt(state, egg.id, t).size);
    expect(maxTargets, '技能生效后该同时打到 4 个敌人').toBeGreaterThanOrEqual(4);
  });

  it('被动：30% 眩晕真的会触发（逐段判定，长跑必出现），时长 1 秒', () => {
    const cells: Cell[] = [0, 1].map((i) => ({ col: TEAM1_FRONT_COL + i, row: MID_ROW }));
    const { state, egg, defs } = battleWith(cells, 999);
    for (let i = 0; i < 600; i++) step(state, defs);

    const stuns = state.log.filter(
      (e) => e.type === 'status' && e.status === 'stun' && e.sourceId === egg.id,
    ) as Array<Extract<BattleEvent, { type: 'status' }>>;
    expect(stuns.length, '30 秒里一次都没晕到（概率太低或没生效）').toBeGreaterThan(0);
    expect(stuns[0]!.durationTicks, '眩晕 1 秒 = 20 tick').toBe(20);
  });

  it('数值确实进了内核：读出来的修正包就是表里那几条', () => {
    const { state, egg } = battleWith([{ col: TEAM1_FRONT_COL, row: MID_ROW }]);
    const mods = collectMods(state, egg);
    expect(mods.multiHit).toBe(3);
    expect(mods.stunOnHit?.perHit).toBe(true);
    expect(mods.stunOnHit?.chanceBp).toBe(3000);
    expect(mods.splash?.hits).toBe(2);
    expect(mods.splash?.basis).toBe('attack');
    expect(mods.splash?.radius).toBe(1);
    expect(mods.splash?.damageType).toBe('physical');
  });
});

