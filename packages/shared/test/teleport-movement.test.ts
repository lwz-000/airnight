/**
 * 瞬移类技能 + 走位的"死路"测试。
 *
 * 【这一组是为什么建的？】
 * 你报的第 8 条：「赤刃明霄陈的 3 星技能不能正常触发伤害」。
 *
 * 复现出来是两个各自都"看起来没错"的规则凑在一起：
 *   1. 瞬移的落点原来是**优先自己半场**的（那是给"飞到队友身边"类技能写的），
 *      于是"瞬移到最近的敌人身旁"实际是把棋子往**后**拉。
 *   2. 走位是"只看一步"的贪心：四个相邻格子里有没有严格更近的。
 *      落地之后被贴脸敌人三面包夹 -> 一个更近的格子都没有 -> 一步都迈不出去，
 *      而它锁定的还是瞬移前那个远处的目标，射程 1 够不着 -> 原地罚站到死，
 *      带着 +1000% 攻击力一次伤害都打不出来。
 *
 * 所以这里同时钉四件事：
 *   · 瞬移落点必须在敌人身旁（攻击距离内）
 *   · 瞬移之后这一击要真的打出来
 *   · 够不着时改打贴脸的敌人
 *   · 贪心走不动时会绕路，而不是永远罚站
 */
import { describe, expect, it } from 'vitest';
import {
  CELL_EMPTY,
  MANA_MAX,
  UNIT_DEFS,
  cellDistance,
  createBattle,
  findStepToward,
  step,
  type BattleState,
  type TeamSetup,
  type UnitPlacement,
} from '../src/index.js';

/** 一排 3 星星熊当"墙"：打不死，用来让战斗能持续到技能放完 */
function wall(count = 6): UnitPlacement[] {
  const units: UnitPlacement[] = [];
  for (let i = 0; i < count; i++) {
    units.push({ defId: 'op27', star: 3, cell: { col: 6 + (i % 2), row: i % 8 } });
  }
  return units;
}

/** 让一个棋子法力直接灌满，并在下一帧就行动 */
function charge(state: BattleState, unitId: string): void {
  const unit = state.units.find((candidate) => candidate.defId === unitId)!;
  unit.mana = MANA_MAX;
  unit.nextActionTick = 0;
}

describe('★ 赤刃明霄陈 3 星（瞬移 + 1000% 攻击力）', () => {
  it('★ 瞬移落点是"敌人身旁"，不是被拉回自己半场', () => {
    const teams: [TeamSetup, TeamSetup] = [
      { team: 0, units: [{ defId: 'op48', star: 3, cell: { col: 4, row: 4 } }] },
      { team: 1, units: wall() },
    ];
    const state = createBattle(UNIT_DEFS, teams, 31337);
    charge(state, 'op48');

    // 跑到技能放出来为止
    let castTick = -1;
    for (let i = 0; i < 120 && castTick < 0; i++) {
      step(state, UNIT_DEFS);
      const cast = state.log.find((event) => event.type === 'cast');
      if (cast) castTick = cast.t;
    }
    expect(castTick, '3 星技能应该放得出来').toBeGreaterThan(0);

    const chen = state.units.find((unit) => unit.defId === 'op48')!;
    expect(chen.dead, '刚放完技能，不该已经死了').toBe(false);
    const nearestEnemy = Math.min(
      ...state.units
        .filter((unit) => unit.team === 1 && !unit.dead)
        .map((unit) => cellDistance(chen.cell, unit.cell, 'orthogonal')),
    );
    // 原文是"瞬移到最近的敌人身旁" —— 落在两格外等于没瞬移
    expect(nearestEnemy, '落地之后必须就贴在敌人旁边').toBeLessThanOrEqual(1);
  });

  it('★ 瞬移之后这一击必须真的打出来（+1000% 攻击力）', () => {
    const teams: [TeamSetup, TeamSetup] = [
      { team: 0, units: [{ defId: 'op48', star: 3, cell: { col: 4, row: 4 } }] },
      { team: 1, units: wall() },
    ];
    const state = createBattle(UNIT_DEFS, teams, 31337);
    const chen = state.units.find((unit) => unit.defId === 'op48')!;
    charge(state, 'op48');

    let castTick = -1;
    for (let i = 0; i < 120 && castTick < 0; i++) {
      step(state, UNIT_DEFS);
      const cast = state.log.find((event) => event.type === 'cast');
      if (cast) castTick = cast.t;
    }
    expect(castTick).toBeGreaterThan(0);

    // 再往后跑一段：瞬移落地之后必须真的出手
    for (let i = 0; i < 120 && !state.over; i++) step(state, UNIT_DEFS);

    const hits = state.log.filter(
      (event) => event.type === 'damage' && event.sourceId === chen.id && event.t >= castTick,
    ) as Array<{ amount: number }>;
    expect(hits.length, '瞬移之后不能原地罚站 —— 一次伤害都不能没有').toBeGreaterThan(0);

    const biggest = Math.max(...hits.map((hit) => hit.amount));
    // 平时一击就是 attackDamage；技能这一击 +1000%（11 倍），扣掉护甲也远不止 3 倍
    expect(biggest, '技能那一击应该明显高于普攻').toBeGreaterThan(chen.attackDamage * 3);
  });

  it('★ 被贴脸围住、锁着的目标却在远处时会改打贴脸的敌人', () => {
    const teams: [TeamSetup, TeamSetup] = [
      { team: 0, units: [{ defId: 'op48', star: 3, cell: { col: 4, row: 4 } }] },
      { team: 1, units: wall() },
    ];
    const state = createBattle(UNIT_DEFS, teams, 31337);
    const chen = state.units.find((unit) => unit.defId === 'op48')!;
    charge(state, 'op48');

    // 跑满整场：只要"改打贴脸敌人"这条断了，它放完技能就会一直沉默到死
    for (let i = 0; i < 900 && !state.over; i++) step(state, UNIT_DEFS);

    const casts = state.log.filter((event) => event.type === 'cast' && event.unitId === chen.id);
    expect(casts.length, '技能至少放得出来一次').toBeGreaterThan(0);

    /*
      【为什么这里不再要求"放好几次技能"？】
      ★ 0.2：策划表给 3 星补上了「技能持续期间获得隐匿」，而「若击杀敌人则再斩击一次」
      靠 `onKillRefresh` 把这包**刷新**（不消耗次数）—— 于是他在连杀期间一直隐匿，
      敌人根本锁不到他 ⇒ 受击回复攒不起来 ⇒ 一场只会开一次技能。
      这不是坏了，正是表里那两句话组合出来的结果，所以门槛降成"至少开一次"。
      真正要守的还是原来那条：**落地之后不能原地罚站**（见下面的伤害断言）。
    */
    const afterFirstCast = state.log.filter(
      (event) => event.type === 'damage' && event.sourceId === chen.id && event.t > casts[0]!.t,
    );
    expect(afterFirstCast.length, '放完技能之后不能就此沉默，得继续打人').toBeGreaterThan(1);
  });
});

describe('★ 走位的"死路"（贪心一步走不动时）', () => {
  it('★ 唯一的近路被占住时会绕路，而不是永远罚站', () => {
    /*
      构造一个贪心必死的局面：
        起点 (4,4)，目标 (9,4)，(5,4) 被敌人占着。
        四个相邻格里 (5,4) 被占，(3,4)/(4,3)/(4,5) 都**不比现在更近**，
        所以"只看一步"的贪心会返回 null —— 棋子就永远迈不出去。
      正确的行为是绕开：先往上或往下走一格。
    */
    const teams: [TeamSetup, TeamSetup] = [
      { team: 0, units: [{ defId: 'op48', star: 1, cell: { col: 4, row: 4 } }] },
      { team: 1, units: [{ defId: 'op27', star: 1, cell: { col: 5, row: 4 } }] },
    ];
    const state = createBattle(UNIT_DEFS, teams, 3);

    const from = { col: 4, row: 4 };
    const toward = { col: 9, row: 4 };
    const detour = findStepToward(state, from, toward, 'orthogonal');
    expect(detour, '贪心走不动时必须绕路 —— 否则棋子会原地罚站到死').not.toBeNull();
    // 绕出来的那一步仍然是"合法的空格"
    expect(state.cellToUnit[detour!.row * 10 + detour!.col]).toBe(CELL_EMPTY);
    /*
      【绕路 = 允许暂时"离得更远"】
      曼哈顿距离下 (4,3) 离 (9,4) 是 6，比起点 (4,4) 的 5 还远 —— 这不是 bug：
      近路上堵着人，绕开一格本来就是先横着挪一下。
      所以这里不检查"这一步更近"，而检查"绕开之后贪心又能走通了"（真的在往前走）。
    */
    expect(
      findStepToward(state, detour!, toward, 'orthogonal'),
      '绕开障碍之后应该能继续朝目标走',
    ).not.toBeNull();
  });

  it('★ 贪心还能走通时，走法一点都不变（老行为不能被绕路逻辑改掉）', () => {
    // 空场：从 (0,0) 去 (9,9)，贪心本来就能走，应该直接往右（邻居顺序里"右"在"下"前面）
    const teams: [TeamSetup, TeamSetup] = [
      { team: 0, units: [{ defId: 'op48', star: 1, cell: { col: 0, row: 0 } }] },
      { team: 1, units: [{ defId: 'op27', star: 1, cell: { col: 9, row: 9 } }] },
    ];
    const state = createBattle(UNIT_DEFS, teams, 3);
    expect(findStepToward(state, { col: 0, row: 0 }, { col: 9, row: 9 }, 'orthogonal')).toEqual({
      col: 1,
      row: 0,
    });
  });
});
