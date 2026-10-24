/**
 * ============================================================
 *  野怪技能（★ 0.0.3，按《各项数值/野怪技能.txt》落地）
 * ============================================================
 *
 * 这一版钉住的是"表里的每一条被动/技能都真的生效了"：
 *   · 面板：血量 / 攻击 / 双抗 / 射程 / 基础攻速（统一 1200，猎狗·双持 1500）
 *   · 被动：破甲、攻速增减、生命上限、魔抗、残血爆发、残血增伤、免疫眩晕、击杀回血
 *   · 主动：嘲讽、流血、成对光环、周期落雷、连击、开局瞬移 / 不可选中
 *   · 二阶段：倒地等待 -> 复活 -> 换阶段（技能/被动/射程/机制整套替换）
 */
import { describe, expect, it } from 'vitest';
import {
  UNIT_DEFS,
  collectMods,
  createBattle,
  effectiveArmor,
  effectiveAttackDamage,
  effectiveAttackSpeed,
  killUnit,
  applyStun,
  selectTarget,
  monsterDefs,
  step,
  type BattleEvent,
  type BattleState,
  type UnitPlacement,
  type UnitState,
} from '../src/index.js';

const FIX = 1000;

function place(team: 0 | 1, defId: string, col: number, row: number): UnitPlacement {
  return { defId, star: 1, cell: { col, row } };
}

/** 造一场战斗：team0 放左半场，team1 放右半场 */
function battle(units0: UnitPlacement[], units1: UnitPlacement[], seed = 1): BattleState {
  return createBattle(
    UNIT_DEFS,
    [
      { team: 0, units: units0 },
      { team: 1, units: units1 },
    ],
    seed,
  );
}

function unitOf(state: BattleState, defId: string): UnitState {
  const unit = state.units.find((item) => item.defId === defId);
  if (!unit) throw new Error(`场上没有 ${defId}`);
  return unit;
}

/** 跑到某个事件出现为止（最多 maxTicks 帧） */
function stepUntil(state: BattleState, pred: () => boolean, maxTicks = 400): void {
  for (let i = 0; i < maxTicks; i++) {
    if (pred()) return;
    if (state.over) return;
    step(state, UNIT_DEFS);
  }
}

describe('★ 野怪面板（按表）', () => {
  const expected: Record<string, { hp: number; atk: number; armor: number; mr: number; range: number; speed: number }> = {
    mn_slime: { hp: 300, atk: 20, armor: 10, mr: 10, range: 1, speed: 1200 },
    mn_gopro: { hp: 300, atk: 30, armor: 10, mr: 10, range: 1, speed: 1500 },
    mn_nsabr: { hp: 500, atk: 50, armor: 10, mr: 10, range: 1, speed: 1200 },
    mn_jshoot: { hp: 200, atk: 50, armor: 10, mr: 10, range: 2, speed: 1200 },
    mn_rogue: { hp: 700, atk: 70, armor: 20, mr: 10, range: 1, speed: 1500 },
    mn_reveng: { hp: 800, atk: 90, armor: 10, mr: 10, range: 1, speed: 1200 },
    mn_demon: { hp: 1000, atk: 100, armor: 10, mr: 10, range: 1, speed: 1200 },
    mn_wteeth: { hp: 900, atk: 70, armor: 20, mr: 20, range: 1, speed: 1200 },
    mn_shield: { hp: 1200, atk: 50, armor: 50, mr: 10, range: 1, speed: 1200 },
    mn_sotisd: { hp: 2000, atk: 120, armor: 50, mr: 50, range: 1, speed: 1200 },
    mn_mdgint: { hp: 2500, atk: 500, armor: 10, mr: 10, range: 1, speed: 1200 },
    mn_spklr: { hp: 2200, atk: 170, armor: 10, mr: 10, range: 1, speed: 1200 },
    mn_dushdo: { hp: 1700, atk: 200, armor: 10, mr: 60, range: 1, speed: 1200 },
    mn_duholy: { hp: 2300, atk: 100, armor: 60, mr: 10, range: 1, speed: 1200 },
    mn_cqbw: { hp: 3500, atk: 250, armor: 40, mr: 40, range: 3, speed: 1200 },
    mn_jakill: { hp: 4000, atk: 270, armor: 30, mr: 30, range: 3, speed: 1200 },
    mn_reid: { hp: 3300, atk: 310, armor: 20, mr: 20, range: 1, speed: 1200 },
    mn_skzdd: { hp: 18000, atk: 800, armor: 80, mr: 80, range: 1, speed: 1200 },
    mn_skzjkl: { hp: 15000, atk: 750, armor: 70, mr: 65, range: 1, speed: 1200 },
  };

  it('19 只的数值逐条对得上表', () => {
    for (const [id, want] of Object.entries(expected)) {
      const def = UNIT_DEFS[id]!;
      expect(def, id).toBeDefined();
      expect(def.base.hp, `${id} 生命值`).toBe(want.hp);
      expect(def.base.attackDamage, `${id} 攻击力`).toBe(want.atk);
      expect(def.base.armor, `${id} 物抗`).toBe(want.armor);
      expect(def.base.magicResist, `${id} 魔抗`).toBe(want.mr);
      expect(def.base.range, `${id} 攻击距离`).toBe(want.range);
      expect(def.base.attackSpeed, `${id} 基础攻速`).toBe(want.speed);
    }
    expect(Object.keys(expected)).toHaveLength(19);
  });

  it('★ 基础攻速：只有猎狗和双持剑士是 1500（0.8 秒一下），其余波次野怪统一 1200', () => {
    for (const def of Object.values(UNIT_DEFS)) {
      if (!def.monsterOnly) continue;
      // ★ 0.1.3：三只特殊野怪的攻速是**用户给定的**（1.5 / 1.8 / 1.8），不参与这条约定
      if (def.monsterTier === 'special') continue;
      const want = def.id === 'mn_gopro' || def.id === 'mn_rogue' ? 1500 : 1200;
      expect(def.base.attackSpeed, def.name).toBe(want);
    }
  });
});

describe('★ 被动：属性 / 爆发 / 增伤', () => {
  it('萨卡兹大剑手：魔抗 +20（10 -> 30）', () => {
    const state = battle([place(0, 'mn_demon', 4, 4)], [place(1, 'mn_slime', 5, 4)]);
    const unit = unitOf(state, 'mn_demon');
    expect(collectMods(state, unit).magicResistFlat).toBe(20 * FIX);
  });

  it('重装防御者：物抗 +20（50 -> 70）', () => {
    const state = battle([place(0, 'mn_shield', 4, 4)], [place(1, 'mn_slime', 5, 4)]);
    const unit = unitOf(state, 'mn_shield');
    expect(effectiveArmor(unit, collectMods(state, unit))).toBe(70 * FIX);
  });

  it('泥岩巨像：生命值 +200%（2500 -> 7500）、攻速 -50%（1200 -> 600）', () => {
    const state = battle([place(0, 'mn_mdgint', 4, 4)], [place(1, 'mn_slime', 5, 4)]);
    const unit = unitOf(state, 'mn_mdgint');
    expect(unit.maxHp).toBe(7500 * FIX);
    expect(effectiveAttackSpeed(unit, collectMods(state, unit))).toBe(600);
  });

  it('双持剑士：攻击速度 +50%（1500 -> 2250）', () => {
    const state = battle([place(0, 'mn_rogue', 4, 4)], [place(1, 'mn_slime', 5, 4)]);
    const unit = unitOf(state, 'mn_rogue');
    expect(effectiveAttackSpeed(unit, collectMods(state, unit))).toBe(2250);
  });

  it('★ 双持剑士：攻击无视对方 10% 物抗（目标护甲 100 -> 按 90 算）', () => {
    const state = battle([place(0, 'mn_rogue', 4, 4)], [place(1, 'mn_shield', 5, 4)]);
    const attacker = unitOf(state, 'mn_rogue');
    expect(collectMods(state, attacker).armorPenBp).toBe(1000);
  });

  it('★ 寻仇者：血量跌破 50% 后，攻击力 +100%、攻速 +70%', () => {
    const state = battle([place(0, 'mn_reveng', 0, 0)], [place(1, 'mn_slime', 9, 9)]);
    const unit = unitOf(state, 'mn_reveng');
    const before = effectiveAttackDamage(unit, collectMods(state, unit));
    expect(unit.trait!.surgeAttackBp).toBe(0);

    unit.hp = Math.floor(unit.maxHp * 0.4);
    step(state, UNIT_DEFS);

    expect(unit.trait!.surgeAttackBp).toBe(10000);
    expect(unit.trait!.surgeSpeedBp).toBe(7000);
    expect(effectiveAttackDamage(unit, collectMods(state, unit))).toBe(before * 2);
  });

  it('★ “盛怒”：目标残血时伤害 +50%（对照满血目标）', () => {
    function firstHit(targetHpRatio: number): number {
      const state = battle([place(0, 'mn_mdgint', 4, 4)], [place(1, 'mn_spklr', 5, 4)], 7);
      const dummy = unitOf(state, 'mn_mdgint');
      const attacker = unitOf(state, 'mn_spklr');
      if (targetHpRatio < 1) dummy.hp = Math.floor(dummy.maxHp * targetHpRatio);
      for (let i = 0; i < 300 && !state.over; i++) {
        step(state, UNIT_DEFS);
        const hit = state.log.find((e) => e.type === 'damage' && e.sourceId === attacker.id);
        if (hit && hit.type === 'damage') return hit.amount;
      }
      return -1;
    }

    const full = firstHit(1);
    const low = firstHit(0.3);
    expect(full).toBeGreaterThan(0);
    expect(low).toBeGreaterThan(0);
    // +50% 之后至少要大出 40%（护甲取整会吃掉一点点）
    expect(low).toBeGreaterThan(Math.floor(full * 1.4));
  });
});

describe('★ 被动：特殊状态', () => {
  it('★ W：免疫眩晕', () => {
    const state = battle([place(0, 'mn_slime', 4, 4)], [place(1, 'mn_cqbw', 5, 4)]);
    const w = unitOf(state, 'mn_cqbw');
    applyStun(state, null, w, 40);
    expect(w.statuses['stun']).toBeUndefined();
  });

  /*
    ★ 用户要求：**所有小领袖和 Boss 都免疫眩晕**。
    这条不是"W 恰好在名单里" —— 它是一条**按档位的规则**
    （见 monster-data.ts 的 STUN_IMMUNE_TIERS），所以这里把整张表过一遍，
    再反过来确认"精英及以下照常能被晕住"（否则这条规则会悄悄扩到全表）。
  */
  it('★ 全体小领袖 / Boss 免疫眩晕；精英及以下照常能晕住', () => {
    const leaders = monsterDefs().filter(
      (def) => def.monsterTier === 'leader' || def.monsterTier === 'boss',
    );
    const others = monsterDefs().filter(
      (def) => def.monsterTier !== 'leader' && def.monsterTier !== 'boss',
    );
    expect(leaders.length, '名单里该有小领袖和 Boss').toBeGreaterThan(0);
    expect(others.length).toBeGreaterThan(0);

    // 一字排开（右半场 5 列 × 2 行 = 10 个位置，够放）
    const state = battle(
      [place(0, 'mn_slime', 4, 4)],
      leaders.map((def, i) => place(1, def.id, 5 + (i % 5), 3 + Math.floor(i / 5))),
      3,
    );
    for (const def of leaders) {
      const unit = unitOf(state, def.id);
      applyStun(state, null, unit, 40);
      expect(unit.statuses['stun'] ?? 0, `${def.name}（${def.monsterTier}）不该被晕住`).toBe(0);
    }

    // 反证：随便挑三只非领袖，同一个 applyStun 必须真的晕住
    const samples = others.slice(0, 3);
    const state2 = battle(
      [place(0, 'mn_slime', 4, 4)],
      samples.map((def, i) => place(1, def.id, 5, 3 + i)),
      3,
    );
    for (const def of samples) {
      const unit = unitOf(state2, def.id);
      applyStun(state, null, unit, 40);
      expect(unit.statuses['stun'] ?? 0, `${def.name}（${def.monsterTier}）应该能被晕住`).toBe(40);
    }
  });

  it('★ 拾荒者：攻击附带流血（目标身上出现持续伤害）', () => {
    const state = battle([place(0, 'mn_wteeth', 4, 4)], [place(1, 'mn_shield', 5, 4)], 5);
    const victim = unitOf(state, 'mn_shield');
    stepUntil(state, () => (victim.skill?.timed.length ?? 0) > 0, 60);
    const dot = victim.skill!.timed.find((e) => e.kind === 'dot');
    expect(dot).toBeDefined();
    // 每秒扣最大生命 1%
    expect(dot!.amount).toBe(Math.floor((victim.maxHp * 100) / 10000));
    expect(dot!.intervalTicks).toBe(20);
  });

  it('★ 深池双人组：有同伴时影刃改打法术、卫队每 3 秒回 10% 血', () => {
    const withPair = battle(
      [place(0, 'mn_slime', 0, 0)],
      [place(1, 'mn_dushdo', 6, 4), place(1, 'mn_duholy', 6, 5)],
      // 让双方站远一点，先别开打
    );
    const dushdo = unitOf(withPair, 'mn_dushdo');
    expect(collectMods(withPair, dushdo).damageTypeOverride).toBe('magic');

    const alone = battle([place(0, 'mn_slime', 0, 0)], [place(1, 'mn_dushdo', 6, 4)]);
    expect(collectMods(alone, unitOf(alone, 'mn_dushdo')).damageTypeOverride).toBeNull();

    // 卫队：跑到 3 秒后血量该回升（先把血打掉一截）
    const duholy = unitOf(withPair, 'mn_duholy');
    duholy.hp = Math.floor(duholy.maxHp * 0.5);
    const before = duholy.hp;
    for (let i = 0; i < 61; i++) step(withPair, UNIT_DEFS);
    expect(duholy.hp).toBeGreaterThan(before);
    expect(duholy.hp).toBeLessThanOrEqual(Math.floor(before + Math.floor(duholy.maxHp * 0.1)) + 1);
  });

  it('★ 游击队盾卫：半径 3 内的敌人被嘲讽，半径外的不受影响', () => {
    const state = battle(
      [place(0, 'mn_slime', 4, 0), place(0, 'mn_gopro', 4, 9)],
      [place(1, 'mn_sotisd', 5, 0), place(1, 'mn_nsabr', 5, 9)],
    );
    const near = unitOf(state, 'mn_slime');
    const far = unitOf(state, 'mn_gopro');
    const shield = unitOf(state, 'mn_sotisd');
    const other = unitOf(state, 'mn_nsabr');

    // 近处（距离 1，在嘲讽半径 3 内）-> 打盾卫
    expect(selectTarget(state, near)).toBe(shield.id);
    // 远处（离盾卫 1+9=10 格，超出半径）-> 不打盾卫，打离自己最近的士兵
    expect(selectTarget(state, far)).toBe(other.id);
  });
});

describe('★ 主动技能', () => {
  it('★ W：每 10 秒一轮 —— 自动回蓝 100/秒（10 秒充满）', () => {
    const def = UNIT_DEFS['mn_cqbw']!;
    expect(def.skill.manaSource).toBe('auto');
    expect(def.skill.manaPerSecond).toBe(100);
    expect(def.skill.effects[0]).toMatchObject({ kind: 'damage', target: 'lowestHpEnemy' });
  });

  it('★ 深池伙友影刃精英：回合开始 10 秒内不可被选中', () => {
    const state = battle([place(0, 'mn_slime', 4, 4)], [place(1, 'mn_dushdo', 5, 4)]);
    const dushdo = unitOf(state, 'mn_dushdo');
    expect(collectMods(state, dushdo).untargetable).toBe(true);
    // 这条增益的时长正好是 200 tick（10 秒）
    expect(dushdo.skill!.buffs[0]!.ticksLeft).toBe(200);
    // 到点自动解除：把时间调到 1 帧再走一帧
    dushdo.skill!.buffs[0]!.ticksLeft = 1;
    step(state, UNIT_DEFS);
    expect(collectMods(state, dushdo).untargetable).toBe(false);
  });
});

describe('★ Boss：倒地等待 -> 复活 -> 换阶段', () => {
  it('★ 杰斯顿：倒地 3 秒不能攻击不能移动，复活后进近战二阶段', () => {
    const state = battle([place(0, 'mn_slime', 0, 9)], [place(1, 'mn_jakill', 5, 4)], 3);
    const boss = unitOf(state, 'mn_jakill');
    expect(boss.range).toBe(3);
    // 一阶段攻速 -30%（走被动修正包，不改基础值）
    expect(boss.attackSpeed).toBe(1200);
    expect(effectiveAttackSpeed(boss, collectMods(state, boss))).toBe(Math.floor(1200 * 0.7));
    expect(collectMods(state, boss).magicResistFlat).toBe(20 * FIX);

    killUnit(state, boss);
    const downed = state.log.find((e) => e.type === 'downed');
    expect(downed).toBeDefined();
    expect(boss.dead).toBe(false);
    expect(boss.downedUntilTick).toBe(60);

    // 倒地期间不行动
    for (let i = 0; i < 40; i++) step(state, UNIT_DEFS);
    const acted = state.log.some(
      (e) => (e.type === 'attack' || e.type === 'move') && 'unitId' in e && e.unitId === boss.id,
    );
    expect(acted, '倒地期间不该出手').toBe(false);

    stepUntil(state, () => state.log.some((e) => e.type === 'rebirth'), 80);
    const rebirth = state.log.find((e) => e.type === 'rebirth');
    expect(rebirth && rebirth.type === 'rebirth' ? rebirth.phase : 0).toBe(2);
    expect(boss.phase).toBe(2);
    // 二阶段：从**基础值**重算（1200 * 1.5），不是在 -30% 的结果上再乘
    expect(boss.attackSpeed).toBe(1200);
    expect(effectiveAttackSpeed(boss, collectMods(state, boss))).toBe(1800);
    expect(boss.range).toBe(1);
    // 一阶段的魔抗 +20 被换掉，只剩二阶段的物抗 +30
    expect(collectMods(state, boss).armorFlat).toBe(30 * FIX);
    expect(collectMods(state, boss).magicResistFlat).toBe(0);
  });

  it('★ “复仇者”：倒地 5 秒后血量回到 49% 并无敌 8 秒', () => {
    const state = battle([place(0, 'mn_slime', 0, 9)], [place(1, 'mn_reid', 5, 4)], 4);
    const boss = unitOf(state, 'mn_reid');
    killUnit(state, boss);
    const downed = state.log.find((e) => e.type === 'downed');
    expect(downed && downed.type === 'downed' ? downed.delayTicks : 0).toBe(100);

    stepUntil(state, () => state.log.some((e) => e.type === 'rebirth'), 140);
    const rebirth = state.log.find((e) => e.type === 'rebirth');
    expect(rebirth && rebirth.type === 'rebirth' ? rebirth.hpAfter : 0).toBe(Math.floor((boss.maxHp * 4900) / 10000));
    expect(collectMods(state, boss).invulnerable).toBe(true);
  });

  it('★ 博卓卡斯替：一阶段近战+按距离减伤；二阶段远程+受伤提升', () => {
    const state = battle([place(0, 'mn_slime', 0, 9)], [place(1, 'mn_skzdd', 5, 4)], 5);
    const boss = unitOf(state, 'mn_skzdd');
    expect(boss.range).toBe(1);
    // ★ 0.0.3 A 版：每远 1 格 -20%，5 格封顶 -80%
    expect(collectMods(state, boss).distanceReduction).toEqual({ perCellBp: 2000, maxBp: 8000 });

    killUnit(state, boss);
    stepUntil(state, () => state.log.some((e) => e.type === 'rebirth'), 100);
    expect(boss.phase).toBe(2);
    expect(boss.range).toBe(3);
    // 一阶段的按距离减伤被**换掉**了（不是叠加）
    expect(collectMods(state, boss).distanceReduction).toBeNull();
    expect(collectMods(state, boss).damageTakenBp).toBe(5000);
    expect(effectiveAttackSpeed(boss, collectMods(state, boss))).toBe(Math.floor(1200 * 1.3));
  });

  it('★ 博卓卡斯替一阶段：每 10 秒对全体造成 100% 攻击力的物伤', () => {
    /*
      拿另一个 Boss 当沙包：只放小怪的话，10 秒还没到就被它 800 攻的普攻清场了。
      两个 Boss 互殴能稳稳撑过 10 秒这一轮技能。
    */
    const state = battle([place(0, 'mn_skzjkl', 4, 4)], [place(1, 'mn_skzdd', 5, 4)], 55);
    const boss = unitOf(state, 'mn_skzdd');
    // 一阶段的技能是"每 10 秒"= 自动回蓝 100/秒（10 秒充满 1000 法力）
    expect(boss.manaPerSecond).toBe(100);

    stepUntil(state, () => state.log.some((e) => e.type === 'cast' && e.unitId === boss.id), 260);
    const cast = state.log.find((e) => e.type === 'cast' && e.unitId === boss.id);
    expect(cast, '10 秒内应该放一次全体技能').toBeDefined();
    const hits = state.log.filter(
      (e): e is Extract<BattleEvent, { type: 'damage' }> =>
        e.type === 'damage' &&
        e.t === cast!.t &&
        e.sourceId === boss.id &&
        e.damageType === 'physical',
    );
    expect(hits.length, '一阶段技能该打到全体敌人').toBeGreaterThan(0);
  });

  it('★ 奎隆：开局给敌方全体 +20% 承伤、-50% 物抗；二阶段最大生命 +30%', () => {
    const state = battle([place(0, 'mn_shield', 4, 4)], [place(1, 'mn_skzjkl', 5, 4)], 6);
    const victim = unitOf(state, 'mn_shield');
    const mods = collectMods(state, victim);
    expect(mods.damageTakenBp).toBe(2000);
    // 物抗 70 被砍一半 -> 35
    expect(effectiveArmor(victim, mods)).toBe(Math.floor((70 * FIX * 5000) / 10000));

    const boss = unitOf(state, 'mn_skzjkl');
    const fullMaxHp = boss.maxHp;
    killUnit(state, boss);
    stepUntil(state, () => state.log.some((e) => e.type === 'rebirth'), 100);
    expect(boss.phase).toBe(2);
    // ★ A 版：二阶段独享被动是"最大生命 +30%"（以前写反成 -30% 了）
    expect(boss.maxHp).toBe(Math.floor((fullMaxHp * 13000) / 10000));
    expect(effectiveAttackSpeed(boss, collectMods(state, boss))).toBe(Math.floor(1200 * 1.3));
  });

  it('★ 奎隆：每 4 秒落雷（4 秒内至少掉一次雷且真的记了范围框）', () => {
    // 拿另一个 Boss 当沙包，免得第 1 秒就把对手清掉、战斗结束
    const state = battle([place(0, 'mn_skzdd', 4, 4)], [place(1, 'mn_skzjkl', 5, 4)], 8);
    const boss = unitOf(state, 'mn_skzjkl');
    stepUntil(state, () => state.log.some((e) => e.type === 'zone' && e.unitId === boss.id), 90);
    const zone = state.log.find((e) => e.type === 'zone' && e.unitId === boss.id);
    expect(zone, '落雷该画一个范围框').toBeDefined();
  });

  it('★ 奎隆连击："波及附近 4 格"是**整段 5 连击都打过去**（用户确认）', () => {
    /*
      布局：奎隆 (5,4)；主目标伯卓 (4,4)（距 1，不用走位）；
      旁边站 W (4,3)（它是远程，距 2 就能打到，所以**不会挪窝**——
      不能用近战当旁边那个：它会为了够得着而走开，那就不在十字里了）。
      (4,3) 到 (4,4) 的曼哈顿距离 = 1，正好落在连击的"附近 4 格"里。
    */
    const state = battle(
      [place(0, 'mn_skzdd', 4, 4), place(0, 'mn_cqbw', 4, 3)],
      [place(1, 'mn_skzjkl', 5, 4)],
      13,
    );
    const boss = unitOf(state, 'mn_skzjkl');
    const main = state.units.find((u) => u.team === 0 && u.cell.col === 4 && u.cell.row === 4)!;
    const neighbor = state.units.find((u) => u.team === 0 && u.cell.row === 3)!;

    let toMain = 0;
    let toNeighbor = 0;
    for (let i = 0; i < 2000 && !state.over; i++) {
      step(state, UNIT_DEFS);
      const hits = state.log.filter(
        (e): e is Extract<BattleEvent, { type: 'damage' }> =>
          e.type === 'damage' &&
          e.t === state.tick - 1 &&
          e.sourceId === boss.id &&
          e.targetId === main.id &&
          e.damageType === 'physical',
      );
      if (hits.length < 5) continue;
      /*
        只数**物理**伤害：奎隆的落雷是真实伤害（且随机落格），
        不过滤的话会把它算进来。
      */
      toMain = hits.reduce((sum, hit) => sum + hit.amount, 0);
      toNeighbor = state.log
        .filter(
          (e): e is Extract<BattleEvent, { type: 'damage' }> =>
            e.type === 'damage' &&
            e.t === state.tick - 1 &&
            e.sourceId === boss.id &&
            e.targetId === neighbor.id &&
            e.damageType === 'physical',
        )
        .reduce((sum, hit) => sum + hit.amount, 0);
      break;
    }

    expect(toMain, '没等到 5 连击（每 5 次普攻一次）').toBeGreaterThan(0);
    expect(
      toNeighbor,
      `相邻格只吃到 ${toNeighbor}，主目标吃到 ${toMain} —— 这说明只溅了"其中一段"`,
    ).toBeGreaterThan(toMain * 0.8);
  });

  it('★ “盛怒”没有复活（用户确认：表里没写它的二阶段）—— 死了就是死了', () => {
    const state = battle([place(0, 'mn_slime', 0, 9)], [place(1, 'mn_spklr', 5, 4)], 9);
    const boss = unitOf(state, 'mn_spklr');
    const atkBefore = boss.attackDamage;
    const spdBefore = boss.attackSpeed;
    killUnit(state, boss);
    // 既不倒地等待、也不复活，直接算死
    expect(state.log.some((e) => e.type === 'downed')).toBe(false);
    expect(state.log.some((e) => e.type === 'rebirth')).toBe(false);
    expect(boss.dead).toBe(true);
    expect(boss.phase ?? 1).toBe(1);
    // 数值一分不动（以前那套 +20% 不再生效）
    expect(boss.attackDamage).toBe(atkBefore);
    expect(boss.attackSpeed).toBe(spdBefore);
  });
});
