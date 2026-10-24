/**
 * ============================================================
 *  ★ 0.1.3 特殊野怪（"左手" / 血骑士 / 锏）
 * ============================================================
 *
 * 【它们和别的野怪的根本区别】
 *   1. 档位是 `special` —— **不进野怪波次**（用户明确要求"不加入回合野怪表"）；
 *   2. 数值是用户直接给的**正式数据**，不是按档位模板套的占位；
 *   3. 后续会作为"羁绊的召唤单位"登场，所以暂时只从测试模式的修改器里发。
 *
 * 【为什么这条"不进波次"要单独钉？】
 * 因为它是**隐式**成立的（波次表里没有 special 这一档）——
 * 哪天有人往 `MONSTER_WAVE_TABLE` 里补一行 special，或者改抽签逻辑，
 * 这三只就会突然出现在正常对局里，而且不会有任何报错。
 */
import { describe, expect, it } from 'vitest';
import {
  BP,
  FIX,
  MONSTER_DEFS,
  spawnSummon,
  UNIT_DEFS,
  addBuff,
  createBattle,
  collectMods,
  monsterWaveForRound,
  step,
  type TeamSetup,
} from '../src/index.js';

/** 三只特殊野怪的 id */
const SPECIAL = ['mn_tytus', 'mn_bldkgt', 'mn_blkswb'] as const;

// ============================================================
//  数据契约
// ============================================================

describe('★ 特殊野怪：数据契约', () => {
  it('三只都在表里、档位是 special、而且都是"野怪"', () => {
    for (const id of SPECIAL) {
      const def = MONSTER_DEFS[id];
      expect(def, `${id} 不在 MONSTER_DEFS 里`).toBeDefined();
      expect(def!.monsterTier, `${id} 的档位`).toBe('special');
      expect(def!.monsterOnly, `${id} 必须是野怪（不进牌库/商店）`).toBe(true);
      expect(def!.traits, `${id} 不参与羁绊`).toEqual([]);
    }
  });

  it('数值逐项对得上用户给的表（抄错一位就白做了）', () => {
    expect(MONSTER_DEFS['mn_tytus']!.base).toMatchObject({
      hp: 2000,
      attackDamage: 120,
      armor: 40,
      magicResist: 40,
      range: 1,
      attackSpeed: 1800,
    });
    expect(MONSTER_DEFS['mn_bldkgt']!.base).toMatchObject({
      hp: 4000,
      attackDamage: 180,
      armor: 50,
      magicResist: 50,
      range: 1,
      attackSpeed: 1500,
    });
    expect(MONSTER_DEFS['mn_blkswb']!.base).toMatchObject({
      hp: 7000,
      attackDamage: 250,
      armor: 50,
      magicResist: 50,
      range: 1,
      attackSpeed: 1800,
    });
  });

  it('复活时间 / 复活后的无敌都对得上（2 秒 / 3 秒 / 3 秒）', () => {
    // 20 tick = 1 秒
    expect(MONSTER_DEFS['mn_tytus']!.reborn).toMatchObject({ delayTicks: 40, hpBp: 10000 });
    expect(MONSTER_DEFS['mn_bldkgt']!.reborn).toMatchObject({ delayTicks: 60, hpBp: 10000 });
    expect(MONSTER_DEFS['mn_blkswb']!.reborn).toMatchObject({ delayTicks: 60, hpBp: 10000 });

    const invuln = (id: string): number =>
      MONSTER_DEFS[id]!.reborn!.phase2!.buffs![0]!.durationTicks;
    expect(invuln('mn_tytus'), '"左手"复活后无敌 2 秒').toBe(40);
    expect(invuln('mn_bldkgt'), '血骑士复活后无敌 3 秒').toBe(60);
    expect(invuln('mn_blkswb'), '锏复活后无敌 3 秒').toBe(60);
  });

  it('★ "左手"入场就能放一次技能（开局技能条拉满）', () => {
    expect(MONSTER_DEFS['mn_tytus']!.skill.startManaBp).toBe(10000);
  });

  it('★ 锏的被动：2 连击 ×90%，逐段 10% 概率上 1.5 秒战栗', () => {
    const passive = MONSTER_DEFS['mn_blkswb']!.skill.passive!;
    expect(passive.multiHit).toBe(2);
    expect(passive.multiHitBp).toBe(9000);
    expect(passive.disarmOnHit).toMatchObject({ chanceBp: 1000, durationTicks: 30, perHit: true });
  });

  it('★ 凝血之刃：1000 血 / 双抗 10 / 永久嘲讽 / 只朝血骑士走', () => {
    const blade = MONSTER_DEFS['mn_bloodblade']!;
    expect(blade.base).toMatchObject({ hp: 1000, armor: 10, magicResist: 10 });
    expect(blade.mechanics!.some((m) => m.kind === 'taunt'), '永久嘲讽').toBe(true);

    const escort = blade.mechanics!.find((m) => m.kind === 'escort');
    expect(escort, '护送机制').toBeDefined();
    expect(escort).toMatchObject({
      targetDefId: 'mn_bldkgt',
      range: 1,
      healBp: 800, // 8% 最大生命
      buffTicks: 200, // ★ 用户补充：+50% 只持续 10 秒
    });
  });
});

// ============================================================
//  ★ 不进野怪波次（用户明确要求）
// ============================================================

describe('★ 特殊野怪永远不出现在野怪回合', () => {
  it('第 1 ~ 80 回合的波次里一只都不许有', () => {
    for (let round = 1; round <= 80; round++) {
      for (const unit of monsterWaveForRound(round)) {
        expect(
          (SPECIAL as readonly string[]).includes(unit.defId),
          `第 ${round} 回合抽到了特殊野怪 ${unit.defId}`,
        ).toBe(false);
      }
    }
  });
});

// ============================================================
//  ★ 新机制：战栗（不能普攻，但能走 / 能放技能）
// ============================================================

describe('★ 战栗（disarm）', () => {
  function battleWith(debuff: boolean) {
    const defs = {
      ...MONSTER_DEFS,
      // 一个"只会走路不会放技能"的靶子：这样能观察到它到底走没走
      dummy: {
        ...MONSTER_DEFS['mn_slime']!,
        id: 'dummy',
        name: 'dummy',
        skill: { ...MONSTER_DEFS['mn_slime']!.skill, effects: [] },
      },
    } as typeof MONSTER_DEFS;
    const teams: [TeamSetup, TeamSetup] = [
      { team: 0, units: [{ defId: 'dummy', star: 1, cell: { col: 4, row: 4 } }] },
      { team: 1, units: [{ defId: 'mn_tytus', star: 1, cell: { col: 7, row: 4 } }] },
    ];
    const state = createBattle(defs, teams, 7);
    const target = state.units.find((unit) => unit.defId === 'dummy')!;
    if (debuff) addBuff(target, { stats: { disarmed: true }, ticksLeft: 400, sourceId: -1 });
    return { state, defs, target };
  }

  it('被战栗的棋子**一步都不许打**（但人还在走）', () => {
    const silenced = battleWith(true);
    const start = { ...silenced.target.cell };
    silenced.target.targetId = -1;
    for (let i = 0; i < 120 && !silenced.state.over; i++) step(silenced.state, silenced.defs);

    const attackEvents = silenced.state.log.filter(
      (event) => event.type === 'attack' && event.unitId === silenced.target.id,
    );
    expect(attackEvents, '战栗期间一次普攻都不该有').toHaveLength(0);
    expect(
      silenced.target.cell,
      '★ 但它必须**还在走**（这是战栗和 noAttack 的区别）',
    ).not.toEqual(start);
  });

  it('没被战栗的同款棋子会正常普攻（对照组）', () => {
    const normal = battleWith(false);
    for (let i = 0; i < 200 && !normal.state.over; i++) step(normal.state, normal.defs);
    const attackEvents = normal.state.log.filter(
      (event) => event.type === 'attack' && event.unitId === normal.target.id,
    );
    expect(attackEvents.length, '对照组该打不少下').toBeGreaterThan(0);
  });

  it('战栗会被登记成一条独立效果（和眩晕分开显示）', () => {
    const { state, target } = battleWith(true);
    const names = collectMods(state, target).disarmed;
    expect(names, '修正包里要能看到战栗').toBe(true);
  });
});

// ============================================================
//  ★ 护送型召唤物（凝血之刃）
// ============================================================

describe('★ 凝血之刃（escort）', () => {
  function battle() {
    const teams: [TeamSetup, TeamSetup] = [
      { team: 0, units: [{ defId: 'mn_bldkgt', star: 1, cell: { col: 4, row: 4 } }] },
      /*
        ★ 对手必须是**打不死的**（Boss 18000 血）：
        用源石虫的话战斗 20 tick 就结束了，而"每 4 秒召一只刀刃"根本来不及发生 ——
        测试会红，但红的是测试自己（这个坑在别处也踩过）。
      */
      { team: 1, units: [{ defId: 'mn_skzdd', star: 1, cell: { col: 9, row: 9 } }] },
    ];
    /*
      ★ 这里必须传**全表** `UNIT_DEFS`（而不是 `MONSTER_DEFS`）——
      召唤物住在 `SUMMON_DEFS` 里，只传野怪表的话 `doSummon` 找不到
      `summon_bloodblade` 这个 def，会**静默不召唤**（第一版就栽在这儿：
      测试红得莫名其妙，其实是"刀刃根本没被生出来"）。
    */
    const state = createBattle(UNIT_DEFS, teams, 11);
    return { state, owner: state.units.find((unit) => unit.defId === 'mn_bldkgt')! };
  }

  it('★ 血骑士会自己招出凝血之刃（每 4 秒一只）', () => {
    const { state } = battle();
    // 每 4 秒一轮 -> 第 1 只大约在 80 tick；留到 150 tick 是为了避开
    // "法力刚好攒满那一 tick 还没轮到行动"的边界（不是设计问题，是测试窗口太窄）
    for (let i = 0; i < 150 && !state.over; i++) step(state, UNIT_DEFS);
    /*
      ★ 判据是"**招过**"（日志里的 spawn 事件），不是"场上现在还在"——
      刀刃走到血骑士身边就会"送达"消散，用"场上还剩几只"去断言会随距离随机红。
    */
    const spawned = state.log.filter(
      (event) => event.type === 'spawn' && event.defId === 'mn_bloodblade',
    );
    expect(spawned.length, '4 秒（80 tick）之后至少该招过一只').toBeGreaterThan(0);
  });

  it('★ 刀刃会朝血骑士走并"送达"：给他挂上 +50% 的限时包', () => {
    const { state, owner } = battle();
    // 直接把一只刀刃摆在主人旁边，省掉"走过来"那几秒
    const blade = state.units.find((unit) => unit.defId === 'mn_bloodblade' && !unit.dead);
    if (!blade) {
      // 还没招出来就先跑到招出来为止
      for (let i = 0; i < 120 && !state.over; i++) step(state, UNIT_DEFS);
    }
    const live = state.units.find((unit) => unit.defId === 'mn_bloodblade' && !unit.dead)!;
    live.cell = { col: owner.cell.col, row: owner.cell.row + 1 };
    state.cellToUnit[owner.cell.row * 10 + owner.cell.col] = owner.id;

    const hpBefore = owner.hp;
    /*
      ★ 让对手**原地发呆**：它一动手就会打掉血骑士的血，
      于是"回没回血"这件事被掩盖（第一版就是这么红的：治疗确实发生了，
      但净血量反而更低）。测试要观测的是"送达的回血"，就该把干扰项按住。
    */
    const foe = state.units.find((unit) => unit.team === 1)!;
    foe.nextActionTick = Number.MAX_SAFE_INTEGER;
    owner.hp = Math.floor(owner.maxHp * 0.5);
    /*
      ★ 要跑**足够多的 tick** 让刀刃轮到自己的行动 —— escort 的判定住在 `actUnit` 里，
      按 `nextActionTick` 调度（刀刃攻速 1200 = 每 24 tick 才动一次）。
      只跑 5 tick 的话它还没轮到行动，测试会误判成"送达失败"。
    */
    for (let i = 0; i < 30; i++) step(state, UNIT_DEFS);

    const buff = owner.skill!.buffs.find((b) => b.sourceId === -1);
    expect(buff, '送达后主人身上该有那份包').toBeDefined();
    expect(buff!.stats.attackDamageBp, '+50% 攻击力').toBe(5000);
    // 送达之后我们还多跑了几 tick 让它结算 -> 剩余时间略小于 200（10 秒）
    expect(buff!.ticksLeft, '10 秒').toBeGreaterThan(150);
    expect(buff!.ticksLeft).toBeLessThanOrEqual(200);
    expect(owner.hp, '还回了 8% 最大生命').toBeGreaterThan(Math.floor(owner.maxHp * 0.5));
    expect(hpBefore).toBeGreaterThan(0);
  });

  it('★ 不叠加：第二只刀刃送达只是**刷新时长**，不会叠成 +100%', () => {
    const { state, owner } = battle();
    /*
      ★ 直接**手动生两只**刀刃，而不是等血骑士慢慢召 ——
      刀刃会自己走向主人并很快"送达"消散，靠等的话场上永远只有最新那一只
      （第一版就栽在这儿：等到 220 tick 还是只有 1 只）。
    */
    const bladeDef = MONSTER_DEFS['mn_bloodblade']!;
    const spot = (row: number) => ({ col: owner.cell.col, row: Math.min(9, owner.cell.row + row) });
    const first = spawnSummon(state, bladeDef, owner, spot(1), {})!;
    const second = spawnSummon(state, bladeDef, owner, spot(2), {})!;
    expect(first && second, '两只刀刃都要生成成功').toBeTruthy();

    // 先让第一只送达（跑到它自己消散为止）
    let guard = 0;
    while (!first.dead && guard++ < 60) step(state, UNIT_DEFS);
    const afterFirst = owner.skill!.buffs.filter((b) => b.sourceId === -1);
    expect(afterFirst.length, '第一只送达后有且只有一份包').toBe(1);

    // 第二只再贴上去：只该**刷新**那一份，不该变成两份
    second.cell = spot(1);
    guard = 0;
    while (!second.dead && guard++ < 60) step(state, UNIT_DEFS);

    const packs = owner.skill!.buffs.filter((b) => b.sourceId === -1);
    expect(packs.length, '只该留一份').toBe(1);
    expect(packs[0]!.stats.attackDamageBp, '不会叠成 +100%').toBe(5000);
  });
});
