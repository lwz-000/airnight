/**
 * ============================================================
 *  ★ 0.2 追加：MujicaAve 联动五人（若叶睦 / 祐天寺若麦 / 三角初华 / 八幡海铃 / 丰川祥子）
 * ============================================================
 *
 * 这一份只钉**新加的东西** —— 名册、四个新机制（锁血 / 自定义弹道 / 低存在感 / 单目标双向脉冲）。
 * 老机制的回归在别的测试里，这里不重复。
 */
import { describe, expect, it } from 'vitest';
import {
  MONSTER_ATTACK_SCALE_BP,
  UNIT_DEFS,
  collectMods,
  createBattle,
  killUnit,
  selectTarget,
  step,
  type TeamSetup,
} from '../src/index.js';

/** 把两边阵容摆好开一局（team0 在左半场、team1 在右半场） */
function battle(blue: TeamSetup['units'], red: TeamSetup['units'], seed = 7) {
  const teams: [TeamSetup, TeamSetup] = [
    { team: 0, units: blue },
    { team: 1, units: red },
  ];
  return createBattle(UNIT_DEFS, teams, seed);
}

/** 惰性靶子：血量巨大、不还手（测倍率的标准做法） */
function dummy(cell: { col: number; row: number }) {
  return {
    defId: 'mn_duholy',
    star: 1,
    cell,
    statOverride: { hp: 1e8, attackDamage: 1, attackSpeed: 0.1, armor: 0, magicResist: 0 },
  };
}

describe('★ 名册：五位都进了正式名单', () => {
  it('★ 名字 / 费用 / 羁绊 / 官方 charId 都对得上', () => {
    const expected: Array<[string, number, string[], string]> = [
      ['若叶睦', 1, ['mujica', 'unyielding'], 'char_4183_mortis'],
      ['祐天寺若麦', 2, ['mujica', 'guard'], 'char_4185_amoris'],
      ['三角初华', 3, ['mujica', 'healing'], 'char_4184_dolris'],
      ['八幡海铃', 4, ['mujica'], 'char_4186_tmoris'],
      ['丰川祥子', 5, ['mujica', 'guard'], 'char_4182_oblvns'],
    ];
    for (const [name, cost, traits, charId] of expected) {
      const def = Object.values(UNIT_DEFS).find((entry) => entry.name === name);
      expect(def, `${name} 不在名单里`).toBeTruthy();
      expect(def!.cost).toBe(cost);
      expect([...def!.traits].sort()).toEqual([...traits].sort());
      expect(def!.charId, `${name} 缺官方小人 id（会退回半身像）`).toBe(charId);
      expect(def!.monsterOnly ?? false, '是干员不是野怪').toBe(false);
    }
  });

  it('★ 野怪攻击力系数是 ×0.42（在 −30% 的基础上再 −40%）', () => {
    expect(MONSTER_ATTACK_SCALE_BP).toBe(4200);
  });
});

describe('★ 若叶睦：一次性锁血（defyDeath）', () => {
  it('★★ 致命伤害只锁 1 点血、带禁攻禁移、且只触发一次', () => {
    const state = battle([{ defId: 'op51', star: 1, cell: { col: 3, row: 5 } }], [dummy({ col: 6, row: 5 })]);
    const mutsumi = state.units.find((unit) => unit.team === 0)!;

    killUnit(state, mutsumi);
    expect(mutsumi.dead, '不该倒下').toBe(false);
    expect(mutsumi.hp, '锁 1 点血').toBe(1);
    expect(mutsumi.statuses['defyDeathUsed']).toBe(1);
    expect(mutsumi.statuses['defyDeathUntil']! > state.tick).toBe(true);

    const mods = collectMods(state, mutsumi);
    expect(mods.noAttack, '无法攻击').toBe(true);
    expect(mods.noMove, '无法移动').toBe(true);

    // 第二次濒死：被动已经用掉了 ⇒ 正常死亡
    killUnit(state, mutsumi);
    expect(mutsumi.dead).toBe(true);
  });

  it('★ 锁血期间会被敌人优先索敌（嘲讽）', () => {
    const state = battle(
      [{ defId: 'op51', star: 1, cell: { col: 4, row: 5 } }, { defId: 'op01', star: 1, cell: { col: 3, row: 4 } }],
      [{ defId: 'mn_duholy', star: 1, cell: { col: 6, row: 5 } }],
    );
    const mutsumi = state.units.find((unit) => unit.defId === 'op51' && unit.team === 0)!;
    const enemy = state.units.find((unit) => unit.team === 1)!;
    killUnit(state, mutsumi);
    expect(selectTarget(state, enemy), '锁血期间要拉仇恨').toBe(mutsumi.id);
  });
});

describe('★ 自定义弹道（attackProfile）', () => {
  it('★ 祐天寺若麦：一次攻击打出 5 段（前 4 段小、第 5 段满）', () => {
    const state = battle([{ defId: 'op52', star: 1, cell: { col: 3, row: 5 } }], [dummy({ col: 5, row: 5 })]);
    const nyamu = state.units.find((unit) => unit.team === 0)!;
    nyamu.mana = 1000; // 直接放技能（5 连击在技能里）
    for (let i = 0; i < 40; i++) step(state, UNIT_DEFS);
    const attacks = state.log.filter((event) => event.type === 'attack' && event.unitId === nyamu.id);
    expect(attacks.length, '至少有一次 5 段的攻击').toBeGreaterThanOrEqual(5);
  });

  it('★★ 丰川祥子：音符穿透直线，一次攻击打到 3 个敌人', () => {
    const state = battle(
      [{ defId: 'op55', star: 1, cell: { col: 3, row: 5 } }],
      [dummy({ col: 5, row: 5 }), dummy({ col: 6, row: 5 }), dummy({ col: 7, row: 5 })],
    );
    const sakiko = state.units.find((unit) => unit.team === 0)!;
    const mods = collectMods(state, sakiko);
    expect(mods.attackProfile?.maxTargets).toBe(3);
    expect(mods.attackProfile?.pierceLength).toBe(3);

    for (let i = 0; i < 30; i++) step(state, UNIT_DEFS);
    const attacks = state.log.filter((event) => event.type === 'attack' && event.unitId === sakiko.id);
    const firstAt = attacks[0]?.t ?? 0;
    const sameTick = attacks.filter((event) => event.t === firstAt);
    /*
      「直线 3 格」是**从她自己**往前数 3 格（不是"以目标为中心半径 3"）——
      她站在 (3,5)，所以覆盖 (4,5)~(6,5)；站 (5,5) 和 (6,5) 的两个人都在里面，
      (7,5) 那个超出 3 格，吃不到。上限 `maxTargets: 3` 只是封顶，不是保证打满。
    */
    expect(sameTick.length, '同一个音符穿过了线上的 2 个人').toBe(2);
    /*
      ★ 表现层契约：这几条 attack 事件必须带 `fx: 'note'` ——
      渲染层就是靠它决定"画 🎶 还是画普通火花"的（见 three/note-fx.ts）。
      漏了不会报错，只会"数据写的是音符、画面上还是火花"，所以在这里钉住。
    */
    expect(
      sameTick.every((event) => event.type === 'attack' && event.fx === 'note'),
      '音符弹道要带 fx 标记',
    ).toBe(true);
  });
});

describe('★ 丰川祥子：面板文案按星级分开', () => {
  it('★★ 1/2 星的本体描述里**不许**出现 3 星技能名（否则看着像已经能放）', () => {
    const def = Object.values(UNIT_DEFS).find((entry) => entry.name === '丰川祥子')!;
    expect(def.skill.star3, '前提：她有 3 星专属技能').toBeTruthy();
    expect(def.skill.desc.includes(def.skill.star3!.name), '本体描述里混进了 3 星技能名').toBe(
      false,
    );
    // 3 星那套自己当然要有完整说明（面板直接显示它）
    expect(def.skill.star3!.desc.length).toBeGreaterThan(20);
  });
});

describe('★ 八幡海铃：低存在感', () => {
  it('★ 射程内还有别的目标时，敌人不会优先打她', () => {
    const state = battle(
      [
        { defId: 'op54', star: 1, cell: { col: 4, row: 5 } },
        { defId: 'op01', star: 1, cell: { col: 4, row: 4 } },
      ],
      [{ defId: 'mn_duholy', star: 1, cell: { col: 6, row: 5 } }],
    );
    const umiri = state.units.find((unit) => unit.defId === 'op54')!;
    const other = state.units.find((unit) => unit.defId === 'op01')!;
    const enemy = state.units.find((unit) => unit.team === 1)!;

    expect(collectMods(state, umiri).lowPresence, '被动要生效').toBe(true);
    expect(selectTarget(state, enemy), '优先打没有低存在感的那个人').toBe(other.id);

    // 只剩她一个可选目标时，照样会被打
    other.hp = 0;
    other.dead = true;
    expect(selectTarget(state, enemy)).toBe(umiri.id);
  });
});

describe('★ 三角初华：攻击改治疗 + 单目标双向脉冲', () => {
  it('★ 未开技能时，普攻变成治疗友方（不产生伤害事件）', () => {
    const state = battle(
      [
        { defId: 'op53', star: 1, cell: { col: 3, row: 5 } },
        { defId: 'op01', star: 1, cell: { col: 2, row: 5 } },
      ],
      [dummy({ col: 6, row: 5 })],
    );
    const uika = state.units.find((unit) => unit.team === 0 && unit.defId === 'op53')!;
    expect(collectMods(state, uika).attackHeals, '被动：普攻改治疗').toBeTruthy();
    for (let i = 0; i < 30; i++) step(state, UNIT_DEFS);
    const hurts = state.log.filter((event) => event.type === 'damage' && event.sourceId === uika.id);
    expect(hurts.length, '普攻不该造成伤害').toBe(0);
  });

  it('★ 对面有丰川祥子时，技能期间优先打她（不管别人离得多近）', () => {
    const state = battle(
      [{ defId: 'op53', star: 1, cell: { col: 3, row: 5 } }],
      [
        // 近处放个靶子，远处放对面的祥子 —— 不设优先级的话大概率会打近的那个
        dummy({ col: 5, row: 5 }),
        { defId: 'op55', star: 1, cell: { col: 6, row: 5 } },
      ],
    );
    const uika = state.units.find((unit) => unit.team === 0)!;
    const sakiko = state.units.find((unit) => unit.defId === 'op55')!;
    uika.mana = 1000;
    for (let i = 0; i < 60; i++) step(state, UNIT_DEFS);
    const hits = state.log.filter((event) => event.type === 'damage' && event.sourceId === uika.id);
    expect(hits.length, '技能要真的打出去').toBeGreaterThan(0);
    expect(
      hits.every((event) => event.type === 'damage' && event.targetId === sakiko.id),
      '每一拍都该锁对面祥子',
    ).toBe(true);
  });

  it('★ 技能期间每拍既打一个敌人、又奶一个队友', () => {
    const state = battle(
      [
        { defId: 'op53', star: 1, cell: { col: 3, row: 5 } },
        { defId: 'op01', star: 1, cell: { col: 2, row: 4 } },
      ],
      [dummy({ col: 6, row: 5 })],
    );
    const uika = state.units.find((unit) => unit.defId === 'op53')!;
    /*
      ★ 队友得**先掉点血**才有得治（血量满时治疗不产生事件）。
      这里直接改 hp，比等敌人慢慢打快得多。
    */
    const ally = state.units.find((unit) => unit.team === 0 && unit.defId === 'op01')!;
    ally.hp = Math.floor(ally.maxHp * 0.5);
    uika.mana = 1000;
    for (let i = 0; i < 60; i++) step(state, UNIT_DEFS);
    const damaged = state.log.some((event) => event.type === 'damage' && event.sourceId === uika.id);
    const healed = state.log.some((event) => event.type === 'heal' && event.sourceId === uika.id);
    expect(damaged, '脉冲要能打到敌人').toBe(true);
    expect(healed, '脉冲要能奶到队友').toBe(true);
  });
});
