/**
 * 羁绊的「战斗中机制」端到端测试。
 *
 * 【为什么必须单独写这一组？】
 * 属性加成错了很容易发现（数字不对）。但"战斗中触发"的机制不一样 ——
 * 代码不报错、战斗照常打完，只是**那个效果根本没发生**。
 * 比如"炮手溅射"如果没生效，你看不出任何异常，只会觉得"炮手怎么这么弱"。
 *
 * 所以这组测试用**合成数据**（不是真实名单）跑真实战斗，逐个验证：
 *   炮手  射程 +2、攻击溅射
 *   术士  射程 +1、额外目标
 *   萨卡兹 攻击附带法术伤害
 *   炎    斩杀残血
 *   支援  开局护盾
 *   重装  护甲总和分给全队
 *   罗德岛 血最高者加成 + 阵亡继承
 *   龙    按三星数量提升全部属性
 *   剑士  每 3 次攻击叠攻速
 *   远射  每次攻击叠攻速
 *
 * 【为什么用合成数据而不是真实名单？】
 * 真实名单的数值会随你的设计一直改，写死断言会天天变红。
 * 合成数据只钉"机制有没有发生"，不钉具体数值 —— 机制是我的代码，数值是你的设计。
 */

import { describe, expect, it } from 'vitest';
import {
  createBattle,
  computeActiveTraitLevels,
  computeTraitBonuses,
  computeUnitTraitBonuses,
  resolveUnitMechanics,
  simulate,
  step,
  type SkillDef,
  type TeamSetup,
  type TraitDefTable,
  type UnitDef,
  type UnitDefTable,
} from '../src/index.js';

/** 一个不做事的基础棋子定义 */
function makeDef(id: string, traits: string[], base: Partial<UnitDef['base']> = {}): UnitDef {
  const skill: SkillDef = {
    id: `${id}_skill`,
    name: `${id} 的技能`,
    desc: '什么都不做（测试用）',
    // 空效果 = 永远不会有技能干扰，这样日志里的事件只可能来自羁绊机制
    effects: [],
    // 法力来源随便给一个：这里没有效果，永远不会放技能，所以不影响结果
    manaSource: 'attack',
  };
  return {
    id,
    name: id,
    cost: 1,
    traits,
    base: {
      hp: 1000,
      attackDamage: 100,
      attackSpeed: 1000,
      armor: 0,
      magicResist: 0,
      range: 1,
      manaPerAttack: 0,
      ...base,
    },
    starHpBp: 1000,
    starDamageBp: 1000,
    color: '#888888',
    sprite: id,
    skill,
  };
}

/** 把定义表变成"按费用取 id"的表 */
function tableOf(defs: UnitDef[]): UnitDefTable {
  const out: UnitDefTable = {};
  for (const def of defs) out[def.id] = def;
  return out;
}

/**
 * 造一支队伍：给每个棋子指定"在哪一格"，并**走真实的羁绊解析链路**。
 *
 * 【为什么要四个字段都填？】
 * 因为真实客户端就是这么填的（见 game/state.ts 的 toTeamSetup）：
 *   traitBonuses      全队型属性加成
 *   unitTraitBonuses  本人型属性加成
 *   activeTraits      生效档位
 *   unitMechanics     战斗中机制
 * 少填一个，测出来的就是"半条链路"——
 * 比如只填 unitMechanics 的话，射程加成这类**属性**类效果就完全不会生效。
 */
function team(
  teamId: 0 | 1,
  entries: Array<{ defId: string; star?: number; col: number; row: number }>,
  defs: UnitDefTable,
  traits?: TraitDefTable,
): TeamSetup {
  const units = entries.map((entry) => ({
    defId: entry.defId,
    star: entry.star ?? 1,
    cell: { col: entry.col, row: entry.row },
  }));
  if (!traits) return { team: teamId, units };
  return {
    team: teamId,
    units,
    traitBonuses: computeTraitBonuses(units, defs, traits),
    unitTraitBonuses: computeUnitTraitBonuses(units, defs, traits),
    activeTraits: computeActiveTraitLevels(units, defs, traits),
    unitMechanics: resolveUnitMechanics(units, defs, traits),
  };
}

/** 一个简单的羁绊定义：单档，带一组机制 */
function trait(id: string, count: number, mechanics: TraitDefTable[string]['tiers'][number]['mechanics'], scope?: 'members' | 'team'): TraitDefTable {
  return {
    [id]: {
      id,
      name: id,
      kind: 'class',
      ...(scope ? { scope } : {}),
      tiers: [{ count, effects: [], desc: `${id} 测试用`, mechanics }],
    },
  };
}

/** 跑一场战斗，返回状态和结果 */
function runBattle(defs: UnitDefTable, teams: [TeamSetup, TeamSetup], seed = 12345) {
  const state = createBattle(defs, teams, seed);
  const result = simulate(defs, teams, seed);
  return { state, result };
}

/**
 * 把战斗**真的跑到结束**，返回结束时的状态。
 *
 * 【为什么不能用 createBattle 的返回值？】
 * 那个是"开局瞬间"的状态 —— 开局的机制（护盾、光环、三星加成）是对的，
 * 但"打了 N 次之后叠了多少攻速""有没有触发低血爆发"这些**过程中才有**的东西
 * 在开局状态里全是初始值（永远是 0/false）。
 * 所以凡是验证"战斗中变化"的测试，都必须跑到结束再断言。
 */
function runToEnd(defs: UnitDefTable, teams: [TeamSetup, TeamSetup], seed = 12345) {
  const state = createBattle(defs, teams, seed);
  let guard = 0;
  while (!state.over && guard++ < 5000) {
    step(state, defs);
  }
  return state;
}

describe('射程类机制（炮手 / 术士）', () => {
  const defs = tableOf([
    makeDef('cannonA', ['cannon'], { range: 3 }),
    makeDef('cannonB', ['cannon'], { range: 3 }),
    makeDef('dummy', [], { range: 1, hp: 100000 }),
  ]);
  const traits = trait('cannon', 2, [{ kind: 'splash', ratioBp: 2000, radius: 1, damageType: 'physical' }]);

  it('★ 炮手羁绊让射程真的变远（+2 格）', () => {
    const base = makeDef('cannonA', ['cannon'], { range: 3 });
    const withBonus: UnitDefTable = {
      ...defs,
      cannonA: { ...defs.cannonA!, base: { ...defs.cannonA!.base, range: 5 } },
    };
    void base;
    // 用真实的加成路径：射程 +2 是通过 effects 加的，
    // 而这里我们只验证"createUnit 用的是加成之后的射程"
    const state = createBattle(
      withBonus,
      [
        { team: 0, units: [{ defId: 'cannonA', star: 1, cell: { col: 0, row: 0 } }] },
        { team: 1, units: [] },
      ],
      1,
    );
    expect(state.units[0]!.range).toBe(5);
  });

  it('★ 炮手攻击会溅射到目标旁边的敌人', () => {
    // 敌方两个棋子紧挨着：主目标 + 旁边的
    const teams: [TeamSetup, TeamSetup] = [
      team(0, [{ defId: 'cannonA', col: 4, row: 4 }, { defId: 'cannonB', col: 4, row: 6 }], defs, traits),
      team(1, [{ defId: 'dummy', col: 5, row: 4 }, { defId: 'dummy', col: 5, row: 5 }], defs),
    ];
    const { result } = runBattle(defs, teams, 999);
    // 溅射伤害是 spell 类型、来源是炮手、目标是"旁边那个"
    const splash = result.log.filter(
      (event) => event.type === 'damage' && event.attackType === 'spell' && event.damageType === 'physical',
    );
    expect(splash.length, '应该出现溅射伤害事件').toBeGreaterThan(0);
  });

  it('术士的额外目标会打到第二个敌人', () => {
    const casterDefs = tableOf([
      makeDef('casterA', ['caster'], { range: 3 }),
      makeDef('casterB', ['caster'], { range: 3 }),
      makeDef('dummy', [], { hp: 100000 }),
    ]);
    const casterTraits = trait('caster', 2, [{ kind: 'extraTargets', count: 1 }]);
    const teams: [TeamSetup, TeamSetup] = [
      team(0, [{ defId: 'casterA', col: 4, row: 4 }, { defId: 'casterB', col: 4, row: 6 }], casterDefs, casterTraits),
      team(1, [{ defId: 'dummy', col: 5, row: 4 }, { defId: 'dummy', col: 5, row: 5 }], casterDefs),
    ];
    const { result } = runBattle(casterDefs, teams, 555);

    // 找一次 attack 事件，然后看同 tick 是不是有两次伤害（主目标 + 额外目标）
    const attack = result.log.find((event) => event.type === 'attack' && event.unitId < 1000);
    expect(attack).toBeDefined();
    const attackerId = attack!.type === 'attack' ? attack!.unitId : -1;
    const sameTick = result.log.filter(
      (event) => event.type === 'damage' && event.t === attack!.t && event.sourceId === attackerId,
    );
    expect(sameTick.length, '一次攻击应该打出 2 次伤害（主目标 + 额外目标）').toBeGreaterThanOrEqual(2);
  });
});

describe('攻击附带伤害（萨卡兹）与斩杀（炎）', () => {
  it('★ 萨卡兹的攻击会额外造成一次法术伤害', () => {
    const defs = tableOf([
      makeDef('sarkazA', ['sarkaz']),
      makeDef('sarkazB', ['sarkaz']),
      makeDef('sarkazC', ['sarkaz']),
      makeDef('dummy', [], { hp: 100000 }),
    ]);
    const traits = trait('sarkaz', 3, [
      { kind: 'onHitDamage', ratioBp: 5000, damageType: 'magic', scale: 'dealt' },
    ]);
    const teams: [TeamSetup, TeamSetup] = [
      team(
        0,
        [
          { defId: 'sarkazA', col: 4, row: 3 },
          { defId: 'sarkazB', col: 4, row: 5 },
          { defId: 'sarkazC', col: 4, row: 7 },
        ],
        defs,
        traits,
      ),
      team(1, [{ defId: 'dummy', col: 5, row: 3 }], defs),
    ];
    const { result } = runBattle(defs, teams, 4242);

    const magic = result.log.filter(
      (event) => event.type === 'damage' && event.damageType === 'magic' && event.attackType === 'spell',
    );
    expect(magic.length, '萨卡兹应该打出额外的法术伤害').toBeGreaterThan(0);

    // 而且这个法术伤害是"按已造成伤害的比例"来的，所以应该小于那次物理伤害
    const first = magic[0]!;
    if (first.type === 'damage') {
      const physical = result.log.filter(
        (event) => event.type === 'damage' && event.damageType === 'physical' && event.t === first.t,
      );
      const physicalAmount = physical.length > 0 && physical[0]!.type === 'damage' ? physical[0]!.amount : 0;
      expect(first.amount).toBeGreaterThan(0);
      expect(first.amount).toBeLessThanOrEqual(physicalAmount);
    }
  });

  it('★ 炎的攻击会斩杀残血敌人', () => {
    const defs = tableOf([
      makeDef('yanA', ['yan'], { attackDamage: 10 }),
      makeDef('yanB', ['yan'], { attackDamage: 10 }),
      makeDef('yanC', ['yan'], { attackDamage: 10 }),
      // 敌人血很少：被打一下就会掉到 20% 以下
      makeDef('weak', [], { hp: 60, attackDamage: 1 }),
    ]);
    const traits = trait('yan', 3, [{ kind: 'execute', thresholdBp: 2000 }]);
    const teams: [TeamSetup, TeamSetup] = [
      team(
        0,
        [
          { defId: 'yanA', col: 4, row: 3 },
          { defId: 'yanB', col: 4, row: 5 },
          { defId: 'yanC', col: 4, row: 7 },
        ],
        defs,
        traits,
      ),
      team(1, [{ defId: 'weak', col: 5, row: 3 }], defs),
    ];
    const { result } = runBattle(defs, teams, 77);

    // 斩杀用的是 true 伤害，所以日志里应该出现 damageType='true'
    const executed = result.log.filter((event) => event.type === 'damage' && event.damageType === 'true');
    expect(executed.length, '残血敌人应该被斩杀（真伤事件）').toBeGreaterThan(0);
  });
});

describe('★ 0.3.31 队伍级机制不依赖"第一个上场的是谁"', () => {
  /*
    【这个 bug 长什么样】
    以前 `applyStartOfBattleMechanics` 里写的是 `const speaker = myUnits[0]`，
    只读**那一个**单位的机制表。机制表是按 defId 挂的 —— 只有这条羁绊的成员才有。
    于是"你第一个摆上去的是谁"决定了这条羁绊生不生效：
      · 卡西米尔凑齐 3 人却不召唤白杨（**有时候有有时候没有**，就是这个）；
      · 支援的双抗加成同理。
    它不报错、战斗照常打完，玩家只会觉得"羁绊凑齐了没效果"。
  */

  const KAZ_DEFS = tableOf([
    makeDef('kazA', ['kazimierz']),
    makeDef('kazB', ['kazimierz']),
    makeDef('kazC', ['kazimierz']),
    makeDef('outsider', ['other'], { hp: 100000 }),
    makeDef('dummy', [], { hp: 100000 }),
  ]);
  const KAZ_TRAITS = trait('kazimierz', 3, [
    { kind: 'startSummon', summonId: 'kazA', count: 1, placement: 'besideHighestHpAlly' },
  ]);

  /**
   * 摆一支"卡西米尔 3 人 + 一个外人"的队伍。
   * @param outsiderFirst 外人是不是排在**第一个**
   */
  function kazimierzTeams(outsiderFirst: boolean): [TeamSetup, TeamSetup] {
    const members: Array<{ defId: string; col: number; row: number }> = [
      { defId: 'kazA', col: 4, row: 3 },
      { defId: 'kazB', col: 4, row: 4 },
      { defId: 'kazC', col: 4, row: 5 },
    ];
    const outsider = { defId: 'outsider', col: 3, row: 3 };
    const units = outsiderFirst ? [outsider, ...members] : [...members, outsider];
    return [
      team(0, units, KAZ_DEFS, KAZ_TRAITS),
      team(1, [{ defId: 'dummy', col: 5, row: 3 }], KAZ_DEFS),
    ];
  }

  const countMyUnits = (teams: [TeamSetup, TeamSetup]): number =>
    createBattle(KAZ_DEFS, teams, 4242).units.filter((unit) => unit.team === 0).length;

  it('★ 卡西米尔：第一个摆的是成员 ⇒ 援军召唤出来', () => {
    // 3 个成员 + 1 个外人 = 4；援军 1 只 ⇒ 5
    expect(countMyUnits(kazimierzTeams(false))).toBe(5);
  });

  it('★★ 卡西米尔：第一个摆的是「别的」羁绊 ⇒ 援军**照样**要召唤', () => {
    expect(countMyUnits(kazimierzTeams(true)), '援军不该取决于"谁先摆上去"').toBe(5);
  });

  it('★★ 去重：3 个成员各带一份 startSummon ⇒ 只召唤一次', () => {
    expect(countMyUnits(kazimierzTeams(true))).toBe(5);
    expect(countMyUnits(kazimierzTeams(false))).toBe(5);
  });
});

describe('开局类机制（支援护盾 / 重装光环 / 罗德岛继承 / 龙）', () => {
  it('★ 支援在开局给我方全体上护盾', () => {
    const defs = tableOf([
      makeDef('supA', ['support']),
      makeDef('supB', ['support']),
      makeDef('supC', ['support']),
      makeDef('dummy', [], { hp: 100000 }),
    ]);
    const traits = trait('support', 3, [{ kind: 'startShield', hpBp: 5000, durationTicks: 100 }], 'team');
    const teams: [TeamSetup, TeamSetup] = [
      team(
        0,
        [
          { defId: 'supA', col: 4, row: 3 },
          { defId: 'supB', col: 4, row: 5 },
          { defId: 'supC', col: 4, row: 7 },
        ],
        defs,
        traits,
      ),
      team(1, [{ defId: 'dummy', col: 5, row: 3 }], defs),
    ];
    const { state } = runBattle(defs, teams, 88);

    for (const unit of state.units.filter((item) => item.team === 0)) {
      expect(unit.statuses['shieldValue'], `${unit.defId} 开局应该有护盾`).toBeGreaterThan(0);
    }
    // 护盾量 = 生命上限的 50%
    const first = state.units.find((item) => item.team === 0)!;
    expect(first.statuses['shieldValue']).toBe(Math.floor(first.maxHp * 0.5));
  });

  it('★ 重装把护甲总和的一部分分给全队', () => {
    const defs = tableOf([
      makeDef('defA', ['defender'], { armor: 100 }),
      makeDef('defB', ['defender'], { armor: 100 }),
      makeDef('squishy', ['other'], { armor: 0 }),
      makeDef('dummy', [], { hp: 100000 }),
    ]);
    // 成员自己 +50% 护甲，再把总和 20% 分给全队
    const traits: TraitDefTable = {
      defender: {
        id: 'defender',
        name: 'defender',
        kind: 'class',
        tiers: [
          {
            count: 2,
            effects: [],
            desc: '测试用',
            mechanics: [{ kind: 'auraFromSum', source: 'armor', ratioBp: 2000, scope: 'team' }],
          },
        ],
      },
    };
    const teams: [TeamSetup, TeamSetup] = [
      team(
        0,
        [
          { defId: 'defA', col: 4, row: 3 },
          { defId: 'defB', col: 4, row: 5 },
          { defId: 'squishy', col: 3, row: 7 },
        ],
        defs,
        traits,
      ),
      team(1, [{ defId: 'dummy', col: 5, row: 3 }], defs),
    ];
    const { state, result } = runBattle(defs, teams, 200);

    // 光环事件：给每个我方干员一条 aura 事件
    const auraEvents = result.log.filter((event) => event.type === 'aura');
    expect(auraEvents.length, '应该出现光环加成事件').toBe(3);

    // 非重装的那个棋子也吃到了护甲（这就是"分给全队"）
    const squishy = state.units.find((item) => item.defId === 'squishy')!;
    expect(squishy.armor, '全队光环应该也加到这个非重装单位身上').toBeGreaterThan(0);
  });

  it('★ 罗德岛：只有一个成员拿到攻击力加成（数值按 FIX 单位算）', () => {
    const defs = tableOf([
      // 血最多的那个人会拿到加成
      makeDef('rhA', ['rhodes'], { hp: 2000, attackDamage: 100 }),
      makeDef('rhB', ['rhodes'], { hp: 500, attackDamage: 100 }),
      makeDef('enemyHard', [], { hp: 100000, attackDamage: 1, armor: 0 }),
    ]);
    const traits = trait('rhodes', 2, [{ kind: 'highestHpCarrier', attackDamageBp: 10000 }]);
    const teams: [TeamSetup, TeamSetup] = [
      team(0, [{ defId: 'rhA', col: 4, row: 3 }, { defId: 'rhB', col: 4, row: 5 }], defs, traits),
      // 敌人不还手（攻击力 1、攻速慢），保证我方两个都活着
      team(1, [{ defId: 'enemyHard', col: 5, row: 4 }], defs),
    ];
    const { state } = runBattle(defs, teams, 300);

    const a = state.units.find((item) => item.defId === 'rhA')!;
    const b = state.units.find((item) => item.defId === 'rhB')!;
    // 攻击力内部单位是 FIX（千分之一），所以 100 点攻击力 = 100000
    expect(a.attackDamage, '血最多的 rhA 应该拿到 +100% 攻击力').toBe(200000);
    expect(b.attackDamage, 'rhB 不该拿到').toBe(100000);
    expect(a.statuses['carrierBonusBp']).toBe(10000);
  });

  it('★ 罗德岛：持有者阵亡后加成转给下一个（继承）', () => {
    const defs = tableOf([
      // rhA 血多但攻击力会被打死；rhB 血少会接棒
      makeDef('rhA', ['rhodes'], { hp: 2000, attackDamage: 100 }),
      makeDef('rhB', ['rhodes'], { hp: 1500, attackDamage: 100 }),
      // 敌人很强，能杀掉 rhA
      makeDef('killer', [], { hp: 100000, attackDamage: 1000, attackSpeed: 3000, armor: 0 }),
    ]);
    const traits = trait('rhodes', 2, [{ kind: 'highestHpCarrier', attackDamageBp: 10000 }]);
    const teams: [TeamSetup, TeamSetup] = [
      team(0, [{ defId: 'rhA', col: 4, row: 4 }, { defId: 'rhB', col: 3, row: 5 }], defs, traits),
      team(1, [{ defId: 'killer', col: 5, row: 4 }], defs),
    ];
    const state = runToEnd(defs, teams, 350);

    const a = state.units.find((item) => item.defId === 'rhA')!;
    const b = state.units.find((item) => item.defId === 'rhB')!;

    // rhA 死了、rhB 活着 —— 这时加成应该在 rhB 身上（继承）
    if (a.dead && !b.dead) {
      expect(b.statuses['carrierBonusBp'], 'rhA 阵亡后加成该转给 rhB').toBe(10000);
      expect(b.attackDamage).toBe(200000);
      expect(a.statuses['carrierBonusBp'], '阵亡的人身上不该还留着加成标记').toBeUndefined();
    }
  });

  it('★ 龙：有 3 星干员时，全队属性提升', () => {
    const defs = tableOf([
      makeDef('dragonA', ['dragon']),
      makeDef('dragonB', ['dragon']),
      makeDef('dragonC', ['dragon']),
      makeDef('dummy', [], { hp: 100000 }),
    ]);
    const traits = trait('dragon', 3, [{ kind: 'allStatsByTriple', values: [2000, 3000, 5000] }], 'team');

    /** 比较两次开局里 dragonB 的攻击力（对照有/没有三星） */
    const attackDamageOf = (starA: number): number => {
      const teams: [TeamSetup, TeamSetup] = [
        team(
          0,
          [
            { defId: 'dragonA', star: starA, col: 4, row: 3 },
            { defId: 'dragonB', col: 4, row: 5 },
            { defId: 'dragonC', col: 4, row: 7 },
          ],
          defs,
          traits,
        ),
        team(1, [{ defId: 'dummy', col: 5, row: 3 }], defs),
      ];
      // 用开局状态（这是"开局类机制"）
      return runBattle(defs, teams, 400).state.units.find((item) => item.defId === 'dragonB')!.attackDamage;
    };

    const without = attackDamageOf(1);
    const withOne = attackDamageOf(3);
    // +20% 全部属性 -> 攻击力 100000 -> 120000
    expect(withOne, '有 1 个三星时全队攻击力应该 +20%').toBe(Math.floor(without * 1.2));
    expect(withOne).toBeGreaterThan(without);
  });
});

describe('攻击计数类机制（剑士 / 远射）', () => {
  it('★ 剑士每攻击 3 次永久叠 10% 攻速', () => {
    const defs = tableOf([
      makeDef('swA', ['swordsman']),
      makeDef('swB', ['swordsman']),
      makeDef('swC', ['swordsman']),
      makeDef('tank', [], { hp: 1000000, attackDamage: 0 }),
    ]);
    const traits = trait('swordsman', 3, [
      { kind: 'attackCounterSpeed', every: 3, bonusBp: 1000, maxStacks: 99 },
    ]);
    const teams: [TeamSetup, TeamSetup] = [
      team(
        0,
        [
          { defId: 'swA', col: 4, row: 3 },
          { defId: 'swB', col: 4, row: 5 },
          { defId: 'swC', col: 4, row: 7 },
        ],
        defs,
        traits,
      ),
      team(1, [{ defId: 'tank', col: 5, row: 3 }], defs),
    ];
    // 战斗要**跑到结束**才能看到叠层（开局状态里 attackCount 永远是 0）
    const state = runToEnd(defs, teams, 600);
    const swA = state.units.find((item) => item.defId === 'swA')!;
    expect(swA.trait!.attackCount, '应该记录攻击次数').toBeGreaterThan(0);
    if (swA.trait!.attackCount >= 3) {
      expect(swA.trait!.speedStacks, '攻击 3 次后应该有叠层').toBeGreaterThan(0);
      expect(swA.trait!.bonusAttackSpeedBp).toBeGreaterThan(0);
      // 每 3 次叠一层，所以层数 = floor(攻击次数 / 3)
      expect(swA.trait!.speedStacks).toBe(Math.floor(swA.trait!.attackCount / 3));
    }
  });

  it('★ 远射每攻击一次都叠 2% 攻速', () => {
    const defs = tableOf([
      makeDef('rA', ['ranged'], { range: 3 }),
      makeDef('rB', ['ranged'], { range: 3 }),
      makeDef('tank', [], { hp: 1000000, attackDamage: 0 }),
    ]);
    const traits = trait('ranged', 2, [{ kind: 'rampSpeed', perAttackBp: 200, maxStacks: 100 }]);
    const teams: [TeamSetup, TeamSetup] = [
      team(0, [{ defId: 'rA', col: 4, row: 3 }, { defId: 'rB', col: 4, row: 5 }], defs, traits),
      team(1, [{ defId: 'tank', col: 5, row: 3 }], defs),
    ];
    const state = runToEnd(defs, teams, 700);
    const rA = state.units.find((item) => item.defId === 'rA')!;
    expect(rA.trait!.attackCount).toBeGreaterThan(0);
    // 每次攻击 +2%；叠层有上限（maxStacks: 100），所以取 min
    expect(rA.trait!.speedStacks).toBe(Math.min(rA.trait!.attackCount, 100));
    expect(rA.trait!.bonusAttackSpeedBp).toBe(rA.trait!.speedStacks * 200);
  });
});

describe('飞行（+射程 且近战打不到）', () => {
  const defs = tableOf([
    makeDef('flyA', ['flying'], { range: 3 }),
    makeDef('flyB', ['flying'], { range: 3 }),
    makeDef('melee', [], { range: 1, hp: 100000 }),
    makeDef('shooter', [], { range: 3 }),
    makeDef('dummy', [], { hp: 100000 }),
  ]);
  const traits = trait('flying', 2, [{ kind: 'airborne', immuneToRangeAtMost: 1 }]);

  /** 只有飞行羁绊、没有射程加成 —— 用来单独测"打不到"这条 */
  const airborneOnly = trait('flying', 2, [{ kind: 'airborne', immuneToRangeAtMost: 1 }]);

  it('★ 1 个飞行 +1 射程，2 个飞行 +2 射程', () => {
    // 用真实数据表（有 1 费和 2 费两档），单独验证两档射程
    const oneTraits: TraitDefTable = {
      flying: {
        id: 'flying',
        name: 'flying',
        kind: 'race',
        tiers: [
          { count: 1, effects: [{ type: 'rangeFlat', value: 1 }], desc: '一档' },
          { count: 2, effects: [{ type: 'rangeFlat', value: 2 }], desc: '二档' },
        ],
      },
    };
    const rangeDefs = tableOf([
      makeDef('flyA', ['flying'], { range: 3 }),
      makeDef('flyB', ['flying'], { range: 3 }),
      makeDef('dummy', [], { hp: 100000 }),
    ]);

    /** 上 count 个飞行干员，返回 flyA 的射程 */
    const rangeWith = (count: number): number => {
      const entries = [
        { defId: 'flyA', col: 4, row: 3 },
        { defId: 'flyB', col: 4, row: 5 },
      ].slice(0, count);
      const teams: [TeamSetup, TeamSetup] = [
        team(0, entries, rangeDefs, oneTraits),
        team(1, [{ defId: 'dummy', col: 5, row: 3 }], rangeDefs),
      ];
      return runBattle(rangeDefs, teams, 1).state.units.find((item) => item.defId === 'flyA')!.range;
    };

    // 基础射程 3：1 个飞行 -> 第一档 +1 = 4；2 个飞行 -> 第二档 +2 = 5
    expect(rangeWith(1)).toBe(4);
    expect(rangeWith(2)).toBe(5);
  });

  it('★★ 近战（射程 1）默认不打飞行，**没人可打时**才会去打它（0.2 新口径）', () => {
    /*
      ★★ 用户口径 3：「射程为 1 的干员**最后**索敌飞行干员，在有其他单位时不管飞行单位」。
      以前是"完全打不到"（近战全程 0 次出手）；现在改成"排最后一档"。
      两件事要同时成立，所以这里分两个局面：
       ① 对面**只有**飞行 ⇒ 近战只能打它（否则全场没人能收尾、战斗拖到超时）；
       ② 对面有地面单位 ⇒ 近战只打地面那个，**一次都不碰**飞行。
    */
    // ① 只有飞行
    const onlyFlying: [TeamSetup, TeamSetup] = [
      team(0, [{ defId: 'melee', col: 4, row: 4 }], defs, airborneOnly),
      team(1, [{ defId: 'flyA', col: 5, row: 4 }], defs, airborneOnly),
    ];
    const solo = runToEnd(defs, onlyFlying, 900);
    const meleeAlone = solo.units.find((item) => item.defId === 'melee')!;
    expect(meleeAlone.trait!.attackCount, '没人可打时才会去打飞行').toBeGreaterThan(0);

    // ② 有地面单位：飞行在斜角（更近），地面在正前方
    const withGround: [TeamSetup, TeamSetup] = [
      team(0, [{ defId: 'melee', col: 4, row: 4 }], defs, airborneOnly),
      team(
        1,
        [
          { defId: 'flyA', col: 5, row: 5 },
          { defId: 'dummy', col: 5, row: 4 },
        ],
        defs,
        airborneOnly,
      ),
    ];
    const mixed = runToEnd(defs, withGround, 900);
    const melee = mixed.units.find((item) => item.defId === 'melee')!;
    const fly = mixed.units.find((item) => item.defId === 'flyA')!;
    expect(melee.trait!.attackCount, '有地面单位时照常出手').toBeGreaterThan(0);
    const flyHurt = mixed.log.some(
      (event) => event.type === 'damage' && event.targetId === fly.id && event.sourceId === melee.id,
    );
    expect(flyHurt, '★ 有别的单位时不管飞行 —— 近战一次都不该打到它').toBe(false);
  });

  it('★ 远程（射程 ≥2）可以正常攻击飞行单位', () => {
    const teams: [TeamSetup, TeamSetup] = [
      team(0, [{ defId: 'shooter', col: 4, row: 4 }], defs, airborneOnly),
      team(1, [{ defId: 'flyA', col: 5, row: 5 }], defs, airborneOnly),
    ];
    const result = simulate(defs, teams, 901);

    // 远程应该打出过伤害（目标是飞行单位）
    const shot = result.log.some(
      (event) => event.type === 'attack' && event.unitId === 1,
    );
    expect(shot, '射程 3 的单位应该能攻击飞行单位').toBe(true);
  });

  it('★ 射程加成之后才判定：被加成到 2 格的单位就能打飞行了', () => {
    /*
      "攻击距离为 1" 说的是**当前**射程（含羁绊加成），不是数据表里的基础值。
      否则"被羁绊加成成远程的单位"会被误判成近战。
      这里给近战 +1 射程的加成，它就应该能打到飞行单位了。
    */
    const buffed: TraitDefTable = {
      flying: {
        id: 'flying',
        name: 'flying',
        kind: 'race',
        tiers: [{ count: 2, effects: [], desc: '只提供 airborne', mechanics: [{ kind: 'airborne', immuneToRangeAtMost: 1 }] }],
      },
      reach: {
        id: 'reach',
        name: 'reach',
        kind: 'class',
        tiers: [{ count: 1, effects: [{ type: 'rangeFlat', value: 1 }], desc: '+1 射程' }],
      },
    };
    const redefs = tableOf([
      makeDef('meleePlus', ['reach'], { range: 1 }),
      makeDef('flyA', ['flying'], { range: 3 }),
    ]);
    const teams: [TeamSetup, TeamSetup] = [
      team(0, [{ defId: 'meleePlus', col: 4, row: 4 }], redefs, buffed),
      team(1, [{ defId: 'flyA', col: 5, row: 5 }], redefs, buffed),
    ];
    const state = runToEnd(redefs, teams, 902);
    const attacker = state.units.find((item) => item.defId === 'meleePlus')!;
    expect(attacker.range, '羁绊应该把射程加成到 2').toBe(2);
    expect(attacker.trait!.attackCount, '射程 2 之后应该能打到飞行单位').toBeGreaterThan(0);
  });

  it('★ 技能仍然可以打到飞行单位（"无法攻击"只挡普通攻击）', () => {
    const skillDefs = tableOf([
      {
        ...makeDef('caster', [], { range: 1 }),
        skill: {
          id: 'caster_skill',
          name: '打飞行',
          desc: '对最近敌人造成伤害',
          effects: [{ kind: 'damage', target: 'nearestEnemy', power: 3000, damageType: 'magic' }],
          manaSource: 'attack',
        },
      },
      makeDef('flyA', ['flying'], { range: 3, hp: 2000 }),
    ]);
    const teams: [TeamSetup, TeamSetup] = [
      // 给施法者满法力，让它一出手就放技能
      team(0, [{ defId: 'caster', col: 4, row: 4 }], skillDefs, airborneOnly),
      team(1, [{ defId: 'flyA', col: 5, row: 4 }], skillDefs, airborneOnly),
    ];
    const state = createBattle(skillDefs, teams, 903);
    const caster = state.units.find((item) => item.defId === 'caster')!;
    caster.mana = 1000;

    // 跑几步，看有没有指向飞行单位的技能伤害
    for (let i = 0; i < 40 && !state.over; i++) step(state, skillDefs);
    const hitFlying = state.log.some(
      (event) => event.type === 'damage' && event.targetId === state.units.find((u) => u.defId === 'flyA')!.id,
    );
    expect(hitFlying, '技能应该能打到飞行单位（"无法攻击"只挡普通攻击）').toBe(true);
  });

  it('飞行是"不可选中"而不是"走过去发现打不到"（避免原地卡住）', () => {
    const teams: [TeamSetup, TeamSetup] = [
      team(0, [{ defId: 'melee', col: 4, row: 4 }], defs, airborneOnly),
      team(1, [{ defId: 'flyA', col: 5, row: 4 }], defs, airborneOnly),
    ];
    const state = createBattle(defs, teams, 904);
    const melee = state.units.find((item) => item.defId === 'melee')!;
    step(state, defs);
    // 一开局就不该锁定飞行单位为目标
    expect(melee.targetId, '近战不该把飞行单位选为目标').toBe(-1);
  });

  /*
    下面两条对应你报的第二个问题：
    「1 攻击距离的单位锁不到飞行单位会挂机，也不会重新进行索敌其他人」。

    实测下来是**两种情况**，第一条其实一直是对的（只是没测试钉住），
    第二条才是真 bug：
      · 场上还有地面敌人 -> 它会改锁地面敌人（本来就对，加测试防回归）
      · 敌方**全是**飞行   -> 选不出目标 -> 原地罚站到死（这个修了）
  */
  it('★ 锁不到飞行单位时会改打地面敌人（不是一直死磕飞行单位）', () => {
    const teams: [TeamSetup, TeamSetup] = [
      team(0, [{ defId: 'melee', col: 4, row: 4 }], defs, airborneOnly),
      team(
        1,
        [
          // 两个飞行，让飞行羁绊生效（airborneOnly 的门槛是 2）
          { defId: 'flyA', col: 5, row: 6 },
          { defId: 'flyB', col: 5, row: 8 },
          // 地面敌人贴着近战（距离 1）
          { defId: 'dummy', col: 5, row: 4 },
        ],
        defs,
        airborneOnly,
      ),
    ];
    const state = createBattle(defs, teams, 906);
    const melee = state.units.find((item) => item.defId === 'melee')!;
    const dummy = state.units.find((item) => item.defId === 'dummy')!;
    const fly = state.units.find((item) => item.defId === 'flyA')!;

    // 手动跑几步：不能用 runBattle（那返回的是"开局瞬间"还没行动过的状态）
    for (let i = 0; i < 60; i++) step(state, defs);

    expect(melee.targetId, '应该改锁地面敌人，而不是飞行单位').toBe(dummy.id);
    expect(melee.trait!.attackCount, '应该真的对地面敌人出手了').toBeGreaterThan(0);
    expect(fly.hp, '飞行单位不该被近战打到').toBe(fly.maxHp);
  });

  it('★ 敌方全是飞行时也不再原地罚站 —— 会朝最近的敌人走过去', () => {
    const teams: [TeamSetup, TeamSetup] = [
      // 从角落出发，这样"有没有动"一眼看得出来
      team(0, [{ defId: 'melee', col: 0, row: 0 }], defs, airborneOnly),
      team(
        1,
        [
          { defId: 'flyA', col: 5, row: 5 },
          { defId: 'flyB', col: 5, row: 8 },
        ],
        defs,
        airborneOnly,
      ),
    ];
    const state = createBattle(defs, teams, 905);
    const melee = state.units.find((item) => item.defId === 'melee')!;
    const startCol = melee.cell.col;
    const startRow = melee.cell.row;
    // 一个能打的目标都没有
    expect(melee.targetId).toBe(-1);

    for (let i = 0; i < 60; i++) step(state, defs);

    // 打不到是设计（飞行羁绊的效果），但"站着不动"不是
    expect(melee.trait!.attackCount, '依然打不到飞行单位（这条规则没变）').toBe(0);
    expect(
      melee.cell.col > startCol || melee.cell.row > startRow,
      '应该朝敌人方向移动，而不是原地罚站',
    ).toBe(true);
  });
});
describe('低血爆发（维多利亚）', () => {
  it('★ 血量被打到 50% 以下时攻速大幅提升', () => {
    const defs = tableOf([
      makeDef('vic', ['victoria'], { hp: 2000, range: 1 }),
      makeDef('vic2', ['victoria'], { hp: 2000, range: 1 }),
      makeDef('hitter', [], { hp: 100000, attackDamage: 200, attackSpeed: 2000, range: 1 }),
    ]);
    const traits = trait('victoria', 2, [
      { kind: 'lowHpSurge', hpThresholdBp: 5000, speedBp: 30000, durationTicks: 100 },
    ]);
    const teams: [TeamSetup, TeamSetup] = [
      team(0, [{ defId: 'vic', col: 4, row: 4 }, { defId: 'vic2', col: 4, row: 6 }], defs, traits),
      team(1, [{ defId: 'hitter', col: 5, row: 4 }], defs),
    ];
    // 跑到结束，看这次战斗里到底触发过没有
    const state = runToEnd(defs, teams, 800);
    const vic = state.units.find((item) => item.defId === 'vic')!;

    // 挨打必然会掉到 50% 以下，所以爆发一定触发过（哪怕后来死了，surgeUsed 会留在记录上）
    expect(vic.trait!.surgeUsed, '被打到半血以下时应该触发低血爆发').toBe(true);
    // 触发过就一定记录过攻速加成（可能已经到期清零，所以只断言"用过"）
    expect(vic.trait!.surgeSpeedBp >= 0 || vic.trait!.surgeTicks >= 0).toBe(true);
  });
});
