/**
 * 召唤物的三条限制（你报的第 10 条）：
 *   1. 维娜·维多利亚的金狮子：场上同时最多 8 只
 *   2. 迷迭香的战术柱：场上同时最多 1 根
 *   3. 望的棋子：不会被敌方选作攻击目标
 * 另外一条"持续时间到了自动死亡"在 skill-system.test.ts 里。
 *
 * 【为什么每一条都要单独钉住？】
 * 这三个数字都只在"反复放技能"的时候才看得出来：
 * 只放一次技能的话，"限 8 只"和"不限"的表现一模一样 ——
 * 那种测试是空的，改坏了也不会红。
 */
import { describe, expect, it } from 'vitest';
import {
  FIX,
  MANA_MAX,
  SKILLS,
  UNIT_DEFS,
  canTargetUnit,
  createBattle,
  isUntargetable,
  selectTarget,
  step,
  type BattleState,
  type TeamSetup,
  type UnitState,
} from '../src/index.js';

/** 一排 3 星大肉当靶子：保证战斗不会在测试跑完之前结束 */
function targets(count = 2): TeamSetup {
  return {
    team: 1,
    units: Array.from({ length: count }, (_, i) => ({
      defId: 'op09',
      star: 3,
      cell: { col: 6 + (i % 2), row: 5 + i },
    })),
  };
}

/** 直接把法力灌满 + 让它这一帧就行动；跑到它真的放出技能为止 */
function forceCast(state: BattleState, unit: UnitState): number {
  unit.mana = MANA_MAX;
  unit.nextActionTick = 0;
  const before = state.log.filter((event) => event.type === 'cast').length;
  for (let i = 0; i < 200; i++) {
    step(state, UNIT_DEFS);
    if (state.log.filter((event) => event.type === 'cast').length > before) return state.tick;
  }
  throw new Error('技能一直没放出来');
}

function aliveSummons(state: BattleState, defId: string): UnitState[] {
  return state.units.filter((unit) => unit.isSummon && unit.defId === defId && !unit.dead);
}

describe('★ 召唤物的数量上限', () => {
  it('★ 迷迭香的柱子：反复放技能也只会有 1 根', () => {
    const teams: [TeamSetup, TeamSetup] = [
      { team: 0, units: [{ defId: 'op18', star: 1, cell: { col: 4, row: 4 } }] },
      targets(),
    ];
    const state = createBattle(UNIT_DEFS, teams, 21);
    const caster = state.units.find((unit) => unit.defId === 'op18')!;

    expect(
      // ★ 0.2：迷迭香的 `effects[0]` 变成了"加攻速/攻击力"的 buff，召唤挪到了 [1] —— 按 kind 找
      SKILLS['op18']!.effects.find((e) => e.kind === 'summon'),
    ).toMatchObject({ kind: 'summon', summonId: 'summon_pillar', max: 1 });

    for (let i = 0; i < 4; i++) {
      forceCast(state, caster);
      // 每放一次都检查：场上的柱子**永远**不超过 1 根
      expect(aliveSummons(state, 'summon_pillar').length, `第 ${i + 1} 次放技能之后柱子数量不对`).toBeLessThanOrEqual(1);
    }
    expect(aliveSummons(state, 'summon_pillar').length, '反复放技能之后应该还剩 1 根（旧的还没到期）').toBe(1);
  });

  it('★ 维娜的金狮子：场上同时最多 8 只（0.2：召唤挪到了 3 星技能）', () => {
    const teams: [TeamSetup, TeamSetup] = [
      // ★ 0.2：1/2 星技能不再召唤了，只有 3 星才有金狮子 —— 所以这里用 3 星
      { team: 0, units: [{ defId: 'op49', star: 3, cell: { col: 4, row: 4 } }] },
      targets(2),
    ];
    const state = createBattle(UNIT_DEFS, teams, 31);
    const caster = state.units.find((unit) => unit.defId === 'op49')!;

    expect(SKILLS['op49']!.star3?.effects[0]).toMatchObject({ kind: 'summon', summonId: 'summon_lion', max: 8 });

    // 放 12 次（金狮子 0.2 起持续 20 秒 = 400 tick，这段时间里绝对不会自然到期）
    for (let i = 0; i < 12; i++) {
      forceCast(state, caster);
      expect(aliveSummons(state, 'summon_lion').length, `第 ${i + 1} 次放技能之后狮子数量超上限了`).toBeLessThanOrEqual(8);
    }
    expect(aliveSummons(state, 'summon_lion').length, '放满之后就该停在 8 只').toBe(8);
  });

  it('3 星维娜换成了"周围空格"的召唤方式，但上限还是 8 只', () => {
    const teams: [TeamSetup, TeamSetup] = [
      { team: 0, units: [{ defId: 'op49', star: 3, cell: { col: 4, row: 4 } }] },
      targets(2),
    ];
    const state = createBattle(UNIT_DEFS, teams, 33);
    const caster = state.units.find((unit) => unit.defId === 'op49')!;
    for (let i = 0; i < 11; i++) forceCast(state, caster);
    expect(aliveSummons(state, 'summon_lion').length).toBeLessThanOrEqual(8);
  });

  /** 让对面的靶子打不死（我们要测的是"召唤次数"，不是"谁先死"） */
  function makeImmortal(state: BattleState): void {
    for (const unit of state.units) {
      if (unit.team !== 1) continue;
      unit.maxHp = 9_000_000;
      unit.hp = unit.maxHp;
      unit.armor = 0;
      unit.magicResist = 0;
    }
  }

  it('★ 魂灵之影：场上同时最多 3 只，满了就不再生成（0.2 用户口径）', () => {
    const teams: [TeamSetup, TeamSetup] = [
      { team: 0, units: [{ defId: 'op45', star: 3, cell: { col: 3, row: 5 } }] },
      targets(2),
    ];
    const state = createBattle(UNIT_DEFS, teams, 45);
    makeImmortal(state);
    const caster = state.units.find((unit) => unit.defId === 'op45')!;

    expect(
      SKILLS['op45']!.star3!.effects.find((effect) => effect.kind === 'summon'),
      '★ op45 3 星要带召唤，且封顶 3 只',
    ).toMatchObject({ kind: 'summon', summonId: 'summon_shadow', max: 3 });

    // 放 8 次技能，每一次之后都不许超过 3 只
    for (let i = 0; i < 8; i++) {
      forceCast(state, caster);
      expect(
        aliveSummons(state, 'summon_shadow').length,
        `第 ${i + 1} 次放技能之后影子超过上限了`,
      ).toBeLessThanOrEqual(3);
    }
    expect(aliveSummons(state, 'summon_shadow').length, '放满之后就该停在 3 只').toBe(3);
  });

  it('★★ 魂灵之影用的是**官方同名模型**，不是维什戴尔本人', () => {
    /*
      【为什么这条要钉？】
      它以前临时挂着 `char_1035_wisdel`（维什戴尔自己的骨架），
      于是棋盘上会出现两个一模一样的维什戴尔 —— 只有真去看画面才发现。
      `charId` 一改，抓取脚本和预渲染脚本就知道要拿哪套骨架，
      所以这个字符串是"模型对不对"的唯一开关，值得专门钉一条。
    */
    const shadow = UNIT_DEFS['summon_shadow']!;
    expect(shadow.charId, '魂灵之影的官方骨架 id（token_* 命名空间）').toBe(
      'token_10035_wisdel_wward_game_9',
    );
    expect(shadow.charId, '★ 不许再用维什戴尔本人的骨架').not.toBe(UNIT_DEFS['op45']!.charId);
    expect(shadow.charId?.startsWith('token_'), '召唤物的骨架在 token_* 命名空间下').toBe(true);
  });
});

describe('★ 望的棋子不会被敌人选中', () => {
  it('★ 敌方锁目标时永远跳过我方的棋子（陷阱）', () => {
    const teams: [TeamSetup, TeamSetup] = [
      { team: 0, units: [{ defId: 'op42', star: 1, cell: { col: 4, row: 4 } }] },
      { team: 1, units: [{ defId: 'op09', star: 3, cell: { col: 5, row: 4 } }] },
    ];
    const state = createBattle(UNIT_DEFS, teams, 41);
    const caster = state.units.find((unit) => unit.defId === 'op42')!;
    // 望放陷阱需要先有目标，所以先跑一帧让它选目标
    step(state, UNIT_DEFS);
    forceCast(state, caster);

    const trap = state.units.find((unit) => unit.defId === 'summon_trap');
    expect(trap, '望应该已经放下一枚棋子').toBeDefined();
    const enemy = state.units.find((unit) => unit.defId === 'op09')!;

    expect(isUntargetable(state, trap!), '棋子必须是"不可被选中"的').toBe(true);
    expect(canTargetUnit(state, enemy, trap!), '敌人不该能把棋子当目标').toBe(false);
    // 每一帧重新锁目标都不该锁到棋子身上（就算它离得更近）
    for (let i = 0; i < 60 && !state.over; i++) {
      step(state, UNIT_DEFS);
      if (trap!.dead) break;
      expect(selectTarget(state, enemy), '锁目标不能锁到棋子上').not.toBe(trap!.id);
    }
  });
});

// ============================================================
//  ★ 0.2：望的棋子是「周围 8 格」触发引爆（含斜角）
// ============================================================
//
// 【为什么要专门钉这一条？】
// 原来判定用的是 `cellDistance(单位, 敌人, moveStyle)`，而棋子的移动方式是**四方向**
// ⇒ 那算的是**曼哈顿距离**，`radius: 1` 只覆盖上下左右 4 格：
// **斜着站进来的敌人踩不到雷**。这个坏法一点声音都没有（不报错、测试全绿），
// 只有"把敌人摆在斜角上"才看得出来。
describe('★ 0.2 望的棋子：周围 8 格触发引爆', () => {
  /** 摆一个望 + 一个靶子，放一枚棋子出来，然后把棋子挪到指定格子 */
  function trapAt(cell: { col: number; row: number }): {
    state: BattleState;
    trap: UnitState;
    enemy: UnitState;
  } {
    const teams: [TeamSetup, TeamSetup] = [
      { team: 0, units: [{ defId: 'op42', star: 1, cell: { col: 4, row: 4 } }] },
      { team: 1, units: [{ defId: 'op09', star: 3, cell: { col: 5, row: 4 } }] },
    ];
    const state = createBattle(UNIT_DEFS, teams, 77);
    const caster = state.units.find((unit) => unit.defId === 'op42')!;
    step(state, UNIT_DEFS);
    forceCast(state, caster);
    const trap = state.units.find((unit) => unit.defId === 'summon_trap')!;
    expect(trap, '望应该已经放下一枚棋子').toBeDefined();
    const enemy = state.units.find((unit) => unit.defId === 'op09')!;
    // 把棋子和敌人摆到测试指定的格子上；敌人停手（别让它自己走位打乱站位）
    trap.cell = { col: cell.col, row: cell.row };
    enemy.nextActionTick = 100_000;
    /*
      ★ 望本人也要停手：他射程 3，会隔着好几格打到靶子 ——
      不停的话"靶子掉血"分不清是"踩了雷"还是"被望打了一下"（第一版就栽在这）。
    */
    caster.nextActionTick = 100_000;
    return { state, trap, enemy };
  }

  it('★ 斜角的敌人（切比雪夫距离 1）也会踩响 —— 原来这里踩不到', () => {
    const { state, trap, enemy } = trapAt({ col: 5, row: 5 });
    enemy.cell = { col: 4, row: 4 }; // 斜角相邻：|Δ列| = 1、|Δ行| = 1
    const hpBefore = enemy.hp;
    step(state, UNIT_DEFS);
    expect(enemy.hp, '斜角也该被炸到').toBeLessThan(hpBefore);
    expect(trap.dead, '爆炸之后棋子就没了').toBe(true);
  });

  it('★ 隔一格（切比雪夫距离 2）踩不到', () => {
    const { state, trap, enemy } = trapAt({ col: 5, row: 5 });
    enemy.cell = { col: 3, row: 3 }; // 斜向隔一格
    const hpBefore = enemy.hp;
    for (let i = 0; i < 5; i++) step(state, UNIT_DEFS);
    expect(enemy.hp, '隔一格不该被炸').toBe(hpBefore);
    expect(trap.dead, '棋子还好好待着').toBe(false);
  });

  it('★ 上下左右（曼哈顿距离 1）当然也能踩响', () => {
    const { state, trap, enemy } = trapAt({ col: 5, row: 5 });
    enemy.cell = { col: 5, row: 6 };
    const hpBefore = enemy.hp;
    step(state, UNIT_DEFS);
    expect(enemy.hp).toBeLessThan(hpBefore);
    expect(trap.dead).toBe(true);
  });

  it('棋子的数据里标着「卡面不画血条」（0.2 用户口径）', () => {
    expect(UNIT_DEFS['summon_trap']!.hideHpBar, '望的棋子不该有血条').toBe(true);
    expect(UNIT_DEFS['summon_trap']!.summonOnly, '它只能被技能召唤').toBe(true);
  });
});

// ============================================================
//  ★ 0.1.1 藏品二版：开局召唤（支援防暴桩的假人 / 天师锦囊的炎佑）
// ============================================================
//
// 【为什么要单独一组？】
// 这两个召唤物**不是技能召出来的**，而是共享藏品在开战那一刻召的 ——
// 走的是 `teamMechanics.startSummon` 那条路（rules.ts 里读，spawnSummon 里生）。
// 技能召唤那条路已经测熟了，但这条路只要有一环没接上，
// 表现就是"装了藏品、场上什么都没有"，而且**完全不报错**。
describe('★ 开局召唤的召唤物（0.1.1）', () => {
  it('★ 支援防暴桩：开局两只假人，不攻击不移动、还带嘲讽', () => {
    const teams: [TeamSetup, TeamSetup] = [
      {
        team: 0,
        units: [{ defId: 'op09', star: 1, cell: { col: 4, row: 4 } }],
        sharedItems: ['itm_riot_bunker'],
      },
      targets(),
    ];
    const state = createBattle(UNIT_DEFS, teams, 51);
    const dummies = state.units.filter((unit) => unit.defId === 'summon_dummy' && !unit.dead);
    expect(dummies, '正好两只').toHaveLength(2);

    for (const dummy of dummies) {
      expect(dummy.isSummon).toBe(true);
      expect(dummy.taunt, '嘲讽（数据里写的 mechanics）').toBe(true);
      expect(dummy.skillPassive?.noAttack, '不攻击').toBe(true);
      expect(dummy.skillPassive?.noMove, '不移动').toBe(true);
    }
    expect(dummies[0]!.maxHp, '没传数值时用数据里的兜底值').toBe(1000 * FIX);
  });

  it('★ 假人真的"不动不打"：跑一段之后还在原地、也没造成过任何伤害', () => {
    const teams: [TeamSetup, TeamSetup] = [
      {
        team: 0,
        units: [{ defId: 'op09', star: 1, cell: { col: 4, row: 4 } }],
        sharedItems: ['itm_riot_bunker'],
      },
      targets(),
    ];
    const state = createBattle(UNIT_DEFS, teams, 52);
    const dummy = state.units.find((unit) => unit.defId === 'summon_dummy')!;
    const home = { ...dummy.cell };
    for (let i = 0; i < 120 && !state.over; i++) step(state, UNIT_DEFS);

    expect(dummy.cell, '一步都没挪过').toEqual(home);
    expect(dummy.damageDealt, '一下都没打过').toBe(0);
  });

  it('★ 天师锦囊：开局一只炎佑（大炎开着 -> 属性 +30%；不要背景卡片）', () => {
    /*
      ★ 0.1.1：+30% 的前提是「大炎羁绊激活」（用户口径：炎佑自己**不参与**羁绊构建）。
      所以这一场要摆够炎成员把大炎开出来 —— 否则它只有基础 500。
    */
    const teams: [TeamSetup, TeamSetup] = [
      {
        team: 0,
        units: [
          { defId: 'op09', star: 1, cell: { col: 4, row: 4 } },
          { defId: 'op02', star: 1, cell: { col: 3, row: 4 } },
          { defId: 'op11', star: 1, cell: { col: 3, row: 3 } },
          { defId: 'op21', star: 1, cell: { col: 3, row: 5 } },
        ],
        sharedItems: ['itm_celestial_pouch'],
      },
      targets(),
    ];
    const state = createBattle(UNIT_DEFS, teams, 53);
    const yanyou = state.units.filter((unit) => unit.defId === 'summon_yanyou' && !unit.dead);
    expect(yanyou).toHaveLength(1);
    expect(yanyou[0]!.maxHp, '基础 500，大炎开着再 ×1.3').toBe(650 * FIX);
    expect(UNIT_DEFS['summon_yanyou']!.traits, '数据上属于大炎').toContain('yan');
    expect(UNIT_DEFS['summon_yanyou']!.noCard, '不要背景卡片').toBe(true);
  });

  it('★ 天师锦囊：大炎没开 -> 炎佑只有基础 500（不会凭空 +30%）', () => {
    const teams: [TeamSetup, TeamSetup] = [
      {
        team: 0,
        units: [{ defId: 'op09', star: 1, cell: { col: 4, row: 4 } }],
        sharedItems: ['itm_celestial_pouch'],
      },
      targets(),
    ];
    const state = createBattle(UNIT_DEFS, teams, 53);
    const yanyou = state.units.find((unit) => unit.defId === 'summon_yanyou' && !unit.dead)!;
    expect(yanyou.maxHp).toBe(500 * FIX);
  });

  it('★ 没装那件藏品就一只都不该有（对照组）', () => {
    const teams: [TeamSetup, TeamSetup] = [
      { team: 0, units: [{ defId: 'op09', star: 1, cell: { col: 4, row: 4 } }] },
      targets(),
    ];
    const state = createBattle(UNIT_DEFS, teams, 54);
    expect(state.units.filter((unit) => unit.isSummon)).toHaveLength(0);
  });
});
