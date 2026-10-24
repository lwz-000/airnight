/**
 * ============================================================
 *  ★★ 0.2.1：贴图特效的**数据管线**（内核侧那一半）
 * ============================================================
 *
 * 【为什么要有这一组？】
 * 这次接进来的四套特效图（能天使 / 陈 / 玛恩纳 / 凯尔希）+ 隐德来希的血镰，
 * 全都遵守同一条规矩：**"这一下播哪套图"由数据说了算**，渲染层只查注册表。
 * 于是数据里那个字符串就是唯一的接头 —— 一旦它拼错、或者字段没被带到事件里，
 * 游戏里就是"什么都不放"，而且**不会报错**（图找不到就跳过）。
 *
 * 所以这里钉死三件事：
 *   1. 数据表里确实写了（`UnitDef.combatFx` / `SkillDef.castFx` / `PulseSpec.fx` / `SplashSpec.fx`）；
 *   2. 真打一场，事件里确实带出来了（`attack.combatFx` / `cast.fx` / `zone.fx`）；
 *   3. ★★ **纯表现层**：把这些字段从数据里抹掉，同一副阵容同一个种子
 *      ⇒ **校验和一个数都不变**（联机靠它对比，加特效绝不能让它变）。
 */
import { describe, expect, it } from 'vitest';
import {
  MANA_MAX,
  SKILLS,
  TRAIT_DEFS,
  UNIT_DEFS,
  computeActiveTraitLevels,
  computeChecksum,
  computeTraitBonuses,
  computeUnitTraitBonuses,
  createBattle,
  resolveUnitMechanics,
  step,
  type BattleState,
  type TeamSetup,
  type UnitDefTable,
  type UnitPlacement,
} from '../src/index.js';

function place(team: 0 | 1, defId: string, star: number, col: number, row: number): UnitPlacement {
  return { defId, star, cell: { col, row } };
}

function team(teamId: 0 | 1, units: UnitPlacement[]): TeamSetup {
  return {
    team: teamId,
    units,
    traitBonuses: computeTraitBonuses(units, UNIT_DEFS, TRAIT_DEFS),
    unitTraitBonuses: computeUnitTraitBonuses(units, UNIT_DEFS, TRAIT_DEFS),
    activeTraits: computeActiveTraitLevels(units, UNIT_DEFS, TRAIT_DEFS),
    unitMechanics: resolveUnitMechanics(units, UNIT_DEFS, TRAIT_DEFS),
  };
}

/** 把敌人的血调厚一点：我们要的是"技能放得出来"，不是"两秒打完" */
function tanky(state: BattleState): BattleState {
  for (const unit of state.units) {
    if (unit.team !== 1) continue;
    unit.maxHp = 9_000_000;
    unit.hp = unit.maxHp;
    unit.armor = 0;
    unit.magicResist = 0;
  }
  return state;
}

// ------------------------------------------------------------------
// 1) 数据表：写了什么
// ------------------------------------------------------------------

describe('★ 0.2.1 特效 id 写在数据里', () => {
  it('新约能天使：普攻贴图 = angel_gun，开技能那一下 = angel_overdrive', () => {
    expect(UNIT_DEFS['op50']!.combatFx, '普攻的枪口/命中特效').toBe('angel_gun');
    expect(SKILLS['op50']!.castFx, '开技能那一下的爆燃枪口').toBe('angel_overdrive');
  });

  it('陈（赤刃明霄）与玛恩纳：技能演出挂在 **3 星变体**上（1/2 星不该播）', () => {
    // op48 = char_1050_chen3 赤刃明霄陈（"赤霄·绝影"五连斩）
    expect(SKILLS['op48']!.star3!.castFx).toBe('chen_s3');
    expect(SKILLS['op48']!.castFx, '1/2 星那套不是红色连斩').toBeUndefined();
    // op47 = 玛恩纳（3 星是"开局立刻开技能"，所以演出挂在 star3）
    expect(SKILLS['op47']!.star3!.castFx).toBe('mlynar_s3');
    expect(SKILLS['op47']!.castFx).toBeUndefined();
  });

  it('隐德来希：1/2 星脉冲 = 血镰环绕；3 星溅射 = 血镰横扫', () => {
    const base = SKILLS['op40']!.effects.find((effect) => effect.kind === 'buff') as
      | { stats?: { pulse?: { fx?: string } } }
      | undefined;
    expect(base?.stats?.pulse?.fx, '1/2 星：每 0.5 秒一圈').toBe('leto_scythe_aura');
    const star3 = SKILLS['op40']!.star3!.effects.find((effect) => effect.kind === 'buff') as
      | { stats?: { splash?: { fx?: string } } }
      | undefined;
    expect(star3?.stats?.splash?.fx, '3 星：每次攻击横扫').toBe('leto_scythe_sweep');
  });

  it('澄闪：远程普攻的弹道 = 粉色闪电（tracerFx）', () => {
    expect(UNIT_DEFS['op37']!.tracerFx, '普攻弹道').toBe('bolt_pink');
    // 近战写它没意义，所以只能挂远程（射程 ≥ 2）
    expect(UNIT_DEFS['op37']!.base.range).toBeGreaterThanOrEqual(2);
  });

  it('新约能天使：普攻弹道 = 飞过去的子弹（tracerFx）', () => {
    expect(UNIT_DEFS['op50']!.tracerFx, '普攻弹道').toBe('bullet_angel');
    expect(UNIT_DEFS['op50']!.combatFx, '枪口/命中还是那套贴图').toBe('angel_gun');
  });

  it('弹道分配表（谁用子弹、谁用黄色闪电）', () => {
    const bullets = ['op50', 'op38', 'op09', 'op25', 'op10', 'op33', 'op15', 'op04'];
    for (const id of bullets) expect(UNIT_DEFS[id]!.tracerFx, `${id} 该用子弹`).toBe('bullet_angel');
    expect(UNIT_DEFS['op37']!.tracerFx, '澄闪：粉闪电').toBe('bolt_pink');
    expect(UNIT_DEFS['op22']!.tracerFx, '惊蛰：黄色闪电').toBe('bolt_yellow');
    // 野怪 Boss（博卓卡斯替）也走子弹
    expect(UNIT_DEFS['mn_skzdd']!.tracerFx).toBe('bullet_angel');
  });

  it('凯尔希 3 星：3×3 真实伤害走 bloom 那套分层贴花', () => {
    const star3 = SKILLS['op46']!.star3!.effects.find((effect) => effect.kind === 'buff') as
      | { stats?: { splash?: { fx?: string } } }
      | undefined;
    expect(star3?.stats?.splash?.fx).toBe('kalts_nova');
  });

  it('菲亚梅塔：施法 = 卡面火柱，5×5 落点 = 凤凰爆炸', () => {
    expect(SKILLS['op28']!.castFx).toBe('fiammetta_barrage');
    const buff = SKILLS['op28']!.effects.find((effect) => effect.kind === 'buff') as
      | { stats?: { splash?: { radius?: number; fx?: string } } }
      | undefined;
    expect(buff?.stats?.splash?.radius, '5×5').toBe(2);
    expect(buff?.stats?.splash?.fx).toBe('fiammetta_phoenix');
  });
});

// ------------------------------------------------------------------
// 1b) ★ 0.2.1 炮手：抛物线炮弹 + 1 格爆炸（黄 / 红 / 灰）
// ------------------------------------------------------------------

describe('★ 0.2.1 炮手普攻：配色分配与两条"让位"规则', () => {
  it('五个炮手的配色：号角黄 · 菲亚梅塔/维什戴尔红 · 空爆/灰毫灰', () => {
    const pairs: Array<[string, string]> = [
      ['op29', 'yellow'], // 号角
      ['op28', 'red'], // 菲亚梅塔
      ['op45', 'red'], // 维什戴尔
      ['op01', 'gray'], // 空爆
      ['op05', 'gray'], // 灰毫
    ];
    for (const [id, color] of pairs) {
      expect(UNIT_DEFS[id]!.tracerFx, `${id} 的炮弹弹道`).toBe(`shell_${color}`);
      expect(UNIT_DEFS[id]!.combatFx, `${id} 的命中爆炸`).toBe(`cannon_gun_${color}`);
    }
    /*
      ★ 0.2.1（追加二十八）：迷迭香**不在这批炮弹里**，但不是"什么都没有"了 ——
      她的普攻是"背后的战术装置甩出去砸目标"，走 `rosmon-slam-fx.ts` 的专属通道
      （不进 `TRACER_FX` 注册表，因为那套是"沿弹道拉伸的贴片"）。
      所以这里断言的是"她没有炮弹配色"，顺带钉住"别顺手给她塞炮弹"。
    */
    expect(UNIT_DEFS['op18']!.tracerFx, '迷迭香：装置砸击的专属通道').toBe('rosmon_slam');
    expect(UNIT_DEFS['op18']!.combatFx, '装置砸击不自带炮弹爆炸，别再叠一层').toBeUndefined();
  });

  it('只有菲亚梅塔是"技能期间换表现"；号角/灰毫/空爆 开技能也还是这套炮弹', () => {
    expect(UNIT_DEFS['op28']!.combatFxBasicOnly, '菲亚梅塔技能变 5×5 轰击').toBe(true);
    for (const id of ['op29', 'op01', 'op05', 'op45']) {
      expect(UNIT_DEFS[id]!.combatFxBasicOnly, `${id} 技能期间照旧用炮弹`).toBeFalsy();
    }
  });
});

// ------------------------------------------------------------------
// 2) 真打一场：事件里带出来了
// ------------------------------------------------------------------

describe('★ 0.2.1 事件把特效 id 带到了渲染层', () => {
  it('能天使：每一枪的 attack 事件都带 combatFx，开技能那一发是爆燃版', () => {
    const state = tanky(
      createBattle(
        UNIT_DEFS,
        [team(0, [place(0, 'op50', 3, 3, 4)]), team(1, [place(1, 'mn_slime', 1, 7, 4)])],
        20261017,
      ),
    );
    for (let i = 0; i < 400 && !state.over; i++) step(state, UNIT_DEFS);

    const attacks = state.log.filter((event) => event.type === 'attack' && event.unitId === state.units[0]!.id);
    expect(attacks.length, '前提：她真的打了几枪').toBeGreaterThan(0);
    for (const event of attacks) {
      expect((event as { combatFx?: string }).combatFx, '每一枪都要带').toBe('angel_gun');
    }
    void MANA_MAX;
  });

  it('玛恩纳 3 星：开局那一发 cast 事件带 fx = mlynar_s3', () => {
    const state = tanky(
      createBattle(
        UNIT_DEFS,
        [team(0, [place(0, 'op47', 3, 3, 4)]), team(1, [place(1, 'mn_slime', 1, 7, 4)])],
        20261018,
      ),
    );
    for (let i = 0; i < 800 && !state.over; i++) step(state, UNIT_DEFS);
    const casts = state.log.filter((event) => event.type === 'cast');
    expect(casts.length, '前提：他真的放了技能').toBeGreaterThan(0);
    expect((casts[0] as { fx?: string }).fx).toBe('mlynar_s3');
  });

  it('澄闪：真打一场，attack 事件里带 fx = bolt_pink（渲染层据此换掉白线）', () => {
    const state = tanky(
      createBattle(
        UNIT_DEFS,
        [team(0, [place(0, 'op37', 3, 3, 5)]), team(1, [place(1, 'mn_slime', 1, 6, 5)])],
        20261021,
      ),
    );
    for (let i = 0; i < 200 && !state.over; i++) step(state, UNIT_DEFS);
    const me = state.units.find((unit) => unit.team === 0)!;
    const attacks = state.log.filter((event) => event.type === 'attack' && event.unitId === me.id);
    expect(attacks.length, '前提：他真的打了几下').toBeGreaterThan(0);
    for (const event of attacks) {
      expect((event as { fx?: string }).fx, '每一下都该带').toBe('bolt_pink');
    }
  });

  it('澄闪 3 星"额外攻击一个目标"：额外目标也会报 attackLink（渲染层才连得上第二条线）', () => {
    const state = tanky(
      createBattle(
        UNIT_DEFS,
        [
          team(0, [place(0, 'op37', 3, 3, 5)]),
          team(1, [place(1, 'mn_slime', 1, 5, 5), place(1, 'mn_slime', 1, 6, 5)]),
        ],
        20261022,
      ),
    );
    for (let i = 0; i < 200 && !state.over; i++) step(state, UNIT_DEFS);
    const me = state.units.find((unit) => unit.team === 0)!;
    const links = state.log.filter((event) => event.type === 'attackLink' && event.sourceId === me.id);
    expect(links.length, '3 星额外攻击 1 个目标 ⇒ 应该有多条"补线"事件').toBeGreaterThan(0);
    for (const event of links as Array<{ fx?: string; targetId: number }>) {
      expect(event.fx, '沿用主人的弹道样式').toBe('bolt_pink');
      expect(event.targetId, '不能指向自己').not.toBe(me.id);
    }
    // ★ 纯表现层：把 attackLink 删掉，校验和一个数都不该变
    const withLinks = computeChecksum(state, state.winner ?? null, state.tick);
    const backup = state.log.filter((event) => event.type !== 'attackLink');
    const original = state.log.splice(0, state.log.length, ...backup);
    const withoutLinks = computeChecksum(state, state.winner ?? null, state.tick);
    state.log.splice(0, state.log.length, ...original);
    expect(withoutLinks, 'attackLink 不能进校验和').toBe(withLinks);
  });

  it('隐德来希 1/2 星：脉冲的 zone 事件带 fx = leto_scythe_aura', () => {
    const state = tanky(
      createBattle(
        UNIT_DEFS,
        [team(0, [place(0, 'op40', 2, 4, 4)]), team(1, [place(1, 'mn_slime', 1, 5, 4)])],
        20261019,
      ),
    );
    // 直接给满法力，省得等"受击回蓝"
    for (const unit of state.units) if (unit.team === 0) unit.mana = MANA_MAX;
    for (let i = 0; i < 120 && !state.over; i++) step(state, UNIT_DEFS);

    const zones = state.log.filter((event) => event.type === 'zone' && event.unitId === state.units[0]!.id);
    expect(zones.length, '前提：脉冲真的跳了').toBeGreaterThan(0);
    for (const event of zones) {
      expect((event as { fx?: string }).fx, '每一跳都要带（渲染层靠它刷新环绕）').toBe('leto_scythe_aura');
    }
  });
});

// ------------------------------------------------------------------
// 2b) ★★ 0.2.1 炮手：连击分段 / 技能让位
// ------------------------------------------------------------------

describe('★★ 0.2.1 炮手普攻：连击分段与技能让位', () => {
  function cannonBattle(defId: string, star: number, seed: number): BattleState {
    return tanky(
      createBattle(
        UNIT_DEFS,
        [team(0, [place(0, defId, star, 3, 5)]), team(1, [place(1, 'mn_slime', 1, 7, 5)])],
        seed,
      ),
    );
  }

  type AttackEvent = { t: number; combatFx?: string; fx?: string; hitIndex?: number };

  function attacksOf(state: BattleState, unitId: number): AttackEvent[] {
    return state.log.filter(
      (event) => event.type === 'attack' && event.unitId === unitId,
    ) as unknown as AttackEvent[];
  }

  it('维什戴尔 1/2 星：3 连击在同一 tick 报 3 条 attack，hitIndex = 0/1/2', () => {
    const state = cannonBattle('op45', 2, 20261023);
    for (const unit of state.units) if (unit.team === 0) unit.mana = MANA_MAX;
    for (let i = 0; i < 240 && !state.over; i++) step(state, UNIT_DEFS);
    const me = state.units.find((unit) => unit.team === 0)!;
    const combo = attacksOf(state, me.id).filter((event) => event.hitIndex !== undefined);
    expect(combo.length, '前提：技能期间至少打出一组 3 连击').toBeGreaterThanOrEqual(3);
    const firstTick = combo[0]!.t;
    const burst = combo.filter((event) => event.t === firstTick).map((event) => event.hitIndex);
    expect(burst, '同一 tick 的三段必须按 0/1/2 排（渲染层靠它依次延后爆炸）').toEqual([0, 1, 2]);
  });

  it('维什戴尔 3 星：5×5 大招接管命中（不再叠 1 格爆炸），但炮弹照飞', () => {
    const state = cannonBattle('op45', 3, 20261024);
    for (const unit of state.units) if (unit.team === 0) unit.mana = MANA_MAX;
    for (let i = 0; i < 320 && !state.over; i++) step(state, UNIT_DEFS);
    const me = state.units.find((unit) => unit.team === 0)!;
    const casts = state.log.filter((event) => event.type === 'cast' && event.unitId === me.id);
    expect(casts.length, '前提：她放了 3 星技能').toBeGreaterThan(0);
    const castTick = (casts[0] as { t: number }).t;
    const suppressed = attacksOf(state, me.id).filter(
      (event) => event.t >= castTick && event.combatFx === undefined,
    );
    expect(suppressed.length, '5×5 期间至少有一发').toBeGreaterThan(0);
    for (const event of suppressed) {
      expect(event.fx, '炮弹弹道不受影响，仍然飞过去').toBe('shell_red');
    }
  });

  it('菲亚梅塔：施法事件带 castFx；技能期间每一发落点都报 bloom（凤凰 5×5）', () => {
    const state = cannonBattle('op28', 2, 20261027);
    for (const unit of state.units) if (unit.team === 0) unit.mana = 900;
    for (let i = 0; i < 400 && !state.over; i++) step(state, UNIT_DEFS);
    const me = state.units.find((unit) => unit.team === 0)!;
    const cast = state.log.find((event) => event.type === 'cast' && event.unitId === me.id) as
      | { fx?: string }
      | undefined;
    expect(cast?.fx, '施法那一刻：卡面冲天火柱').toBe('fiammetta_barrage');
    const blooms = state.log.filter((event) => event.type === 'bloom') as unknown as Array<{
      fx?: string;
      radius?: number;
    }>;
    expect(blooms.length, '技能期间至少炸了一发').toBeGreaterThan(0);
    for (const bloom of blooms) {
      expect(bloom.fx, '落点：凤凰').toBe('fiammetta_phoenix');
      expect(bloom.radius, '5×5').toBe(2);
    }
  });

  it('灰毫：开技能之后出手还是这套炮弹（号角/空爆 同一条口径）', () => {
    const state = cannonBattle('op05', 2, 20261026);
    for (const unit of state.units) if (unit.team === 0) unit.mana = MANA_MAX;
    for (let i = 0; i < 400 && !state.over; i++) step(state, UNIT_DEFS);
    const me = state.units.find((unit) => unit.team === 0)!;
    const casts = state.log.filter((event) => event.type === 'cast' && event.unitId === me.id);
    expect(casts.length, '前提：她放了技能').toBeGreaterThan(0);
    const castTick = (casts[0] as { t: number }).t;
    const after = attacksOf(state, me.id).filter((event) => event.t >= castTick);
    expect(after.length, '技能期间还在打').toBeGreaterThan(0);
    for (const event of after) {
      expect(event.combatFx, '技能只是加数值 ⇒ 普攻表现不变').toBe('cannon_gun_gray');
      expect(event.fx).toBe('shell_gray');
    }
  });

  it('菲亚梅塔：普攻用炮弹，技能期间让位（技能是 5×5 轰击，等专属技能图）', () => {
    const state = cannonBattle('op28', 2, 20261025);
    // 给到"再打一两下就放技能"的量，这样技能前后两段都测得到
    for (const unit of state.units) if (unit.team === 0) unit.mana = 900;
    for (let i = 0; i < 400 && !state.over; i++) step(state, UNIT_DEFS);
    const me = state.units.find((unit) => unit.team === 0)!;
    const casts = state.log.filter((event) => event.type === 'cast' && event.unitId === me.id);
    expect(casts.length, '前提：她放了技能').toBeGreaterThan(0);
    const castTick = (casts[0] as { t: number }).t;
    const attacks = attacksOf(state, me.id);
    const before = attacks.filter((event) => event.t < castTick);
    expect(before.length, '前提：技能前打过').toBeGreaterThan(0);
    for (const event of before) {
      expect(event.combatFx, '普攻：炮弹命中爆炸').toBe('cannon_gun_red');
      expect(event.fx, '普攻：抛物线炮弹').toBe('shell_red');
    }
    const during = attacks.filter((event) => event.t >= castTick && event.combatFx === undefined);
    expect(during.length, '技能期间至少打了一发').toBeGreaterThan(0);
    for (const event of during) {
      expect(event.fx, '技能期间连弹道也让位（5×5 轰击该有自己的表现）').toBeUndefined();
    }
  });
});

// ------------------------------------------------------------------
// 4) ★ 0.2.1 追加：通用斩击 / 夕 / 天火 / 阿米娅·拉普兰德 / 古米·芙蓉
// ------------------------------------------------------------------

describe('★ 0.2.1 通用近战斩击（一条中性斩击，给大部分近战）', () => {
  it('近战按色系分配斩击：白 / 红 / 黄三套，有专属表现的几个不被覆盖', () => {
    // ★ 0.2.1（用户口径）：形状一样、只换配色，所以名单按**色系**分三组钉死。
    const white = [
      'op03', // 古米
      'op11', // 星熊
      'op14', // 芳汀（射程 2，按用户口径归白色系）
      'op17', // 风笛
      'op19', // 砾
      'op21', // 陈
      'op31', // 焰尾
      'op35', // 左乐
      'op48', // 赤刃明霄陈（技能期间换五连斩那套）
      'op51', // 若叶睦
    ];
    const red = [
      'op13', // 炎客
      'op20', // 聆音
      'op32', // 老鲤
      'op40', // 隐德来希
      'op52', // 祐天寺若麦
    ];
    const gold = [
      'op27', // 机械师
      'op41', // 耀骑士临光
      'op47', // 玛恩纳（射程 3，按用户口径归黄色系）
      'op49', // 维娜·维多利亚
    ];
    for (const id of white) expect(UNIT_DEFS[id]!.combatFx, `${id} 该用白色斩击`).toBe('melee_slash');
    for (const id of red) expect(UNIT_DEFS[id]!.combatFx, `${id} 该用红色斩击`).toBe('melee_slash_red');
    for (const id of gold) expect(UNIT_DEFS[id]!.combatFx, `${id} 该用黄色斩击`).toBe('melee_slash_gold');
    // 射程 1 的那批必须是近战（芳汀 2 / 维娜 2 / 玛恩纳 3 是数据里就这么写的，不在此列）
    const ranged = new Set(['op14', 'op49', 'op47']);
    for (const id of [...white, ...red, ...gold].filter((id) => !ranged.has(id))) {
      expect(UNIT_DEFS[id]!.base.range, `${id} 必须是近战`).toBe(1);
    }
    // ★ 三个例外：拉普兰德用白色流光、信仰搅拌机/梅 用子弹（既有表现，不动）
    expect(UNIT_DEFS['op08']!.combatFx, '拉普兰德：白色法术流光，不再叠斩击').toBeUndefined();
    expect(UNIT_DEFS['op09']!.combatFx).toBeUndefined();
    expect(UNIT_DEFS['op04']!.combatFx).toBeUndefined();
  });

  it('真打一场：近战每一刀都带 combatFx = melee_slash', () => {
    const state = tanky(
      createBattle(
        UNIT_DEFS,
        [team(0, [place(0, 'op11', 2, 3, 4)]), team(1, [place(1, 'mn_slime', 1, 5, 4)])],
        20261031,
      ),
    );
    for (let i = 0; i < 120 && !state.over; i++) step(state, UNIT_DEFS);
    const me = state.units.find((unit) => unit.team === 0)!;
    const attacks = state.log.filter((event) => event.type === 'attack' && event.unitId === me.id);
    expect(attacks.length, '前提：她真的砍了').toBeGreaterThan(0);
    for (const event of attacks) {
      expect((event as { combatFx?: string }).combatFx).toBe('melee_slash');
    }
  });
});

describe('★ 0.2.1 夕（op02）：普攻黑白墨爆 / 技能十字白墨', () => {
  it('普攻 = ink_gun（黑层普通混合 + 白层加色）；技能溅射 = 十字 · 半径 1 · ink_cross_white', () => {
    expect(UNIT_DEFS['op02']!.combatFx).toBe('ink_gun');
    const buff = SKILLS['op02']!.effects.find((effect) => effect.kind === 'buff') as
      | { stats?: { splash?: { radius?: number; shape?: string; fx?: string } } }
      | undefined;
    expect(buff?.stats?.splash?.shape, '十字（不是方块）').toBe('cross');
    expect(buff?.stats?.splash?.radius, '周围 4 格 ⇒ radius 1').toBe(1);
    expect(buff?.stats?.splash?.fx).toBe('ink_cross_white');
  });

  it('真打一场：技能期间每一发都报 bloom（fx + radius + shape 都对得上）', () => {
    const state = tanky(
      createBattle(
        UNIT_DEFS,
        [
          team(0, [place(0, 'op02', 2, 3, 5)]),
          team(1, [place(1, 'mn_slime', 1, 6, 5), place(1, 'mn_slime', 1, 6, 4)]),
        ],
        20261032,
      ),
    );
    for (const unit of state.units) if (unit.team === 0) unit.mana = MANA_MAX;
    for (let i = 0; i < 300 && !state.over; i++) step(state, UNIT_DEFS);
    const me = state.units.find((unit) => unit.team === 0)!;
    const casts = state.log.filter((event) => event.type === 'cast' && event.unitId === me.id);
    expect(casts.length, '前提：她开了技能').toBeGreaterThan(0);
    const blooms = state.log.filter((event) => event.type === 'bloom') as unknown as Array<{
      fx?: string;
      radius?: number;
      shape?: string;
      t: number;
    }>;
    const castTick = (casts[0] as { t: number }).t;
    const during = blooms.filter((bloom) => bloom.t >= castTick);
    expect(during.length, '技能期间至少炸了一发').toBeGreaterThan(0);
    for (const bloom of during) {
      expect(bloom.fx).toBe('ink_cross_white');
      expect(bloom.radius).toBe(1);
      expect(bloom.shape).toBe('cross');
    }
  });
});

describe('★ 0.2.1 天火（op12）：单格橙黄爆 / 3×3 橙红爆', () => {
  it('普攻 = skyfire_gun；技能溅射 = 3×3 · skyfire_nova', () => {
    expect(UNIT_DEFS['op12']!.combatFx).toBe('skyfire_gun');
    const buff = SKILLS['op12']!.effects.find((effect) => effect.kind === 'buff') as
      | { stats?: { splash?: { radius?: number; shape?: string; fx?: string } } }
      | undefined;
    expect(buff?.stats?.splash?.radius, '3×3').toBe(1);
    expect(buff?.stats?.splash?.shape, '3×3 是方块').toBe('square');
    expect(buff?.stats?.splash?.fx).toBe('skyfire_nova');
  });

  it('技能期间普攻表现让位给大爆炸（不然 1 格爆和 3×3 爆会叠在一起）', () => {
    const state = tanky(
      createBattle(
        UNIT_DEFS,
        [
          team(0, [place(0, 'op12', 2, 3, 5)]),
          team(1, [place(1, 'mn_slime', 1, 5, 5), place(1, 'mn_slime', 1, 5, 4)]),
        ],
        20261033,
      ),
    );
    /*
      ★ 别一上来就给满法力 —— 那样她第 0 tick 就开技能，"技能前"一发都打不出来。
      给 300（她的初始技力是 4000 万分比 = 400，打两下才满）才能同时测到前后两段。
    */
    for (const unit of state.units) if (unit.team === 0) unit.mana = 300;
    for (let i = 0; i < 400 && !state.over; i++) step(state, UNIT_DEFS);
    const me = state.units.find((unit) => unit.team === 0)!;
    const casts = state.log.filter((event) => event.type === 'cast' && event.unitId === me.id);
    expect(casts.length, '前提：她开了技能').toBeGreaterThan(0);
    const castTick = (casts[0] as { t: number }).t;
    const attacks = state.log.filter(
      (event) => event.type === 'attack' && event.unitId === me.id,
    ) as unknown as Array<{ t: number; combatFx?: string }>;
    const before = attacks.filter((event) => event.t < castTick);
    expect(before.length, '前提：技能前打过').toBeGreaterThan(0);
    for (const event of before) expect(event.combatFx, '技能前：单格橙黄爆').toBe('skyfire_gun');
    /*
      ★ 只取技能生效的那 10 秒（200 tick）—— 到点了 buff 一掉，
      `splashOwnsFx` 自然不成立，那之后的普攻又该用回 1 格爆炸了。
    */
    const during = attacks.filter((event) => event.t >= castTick && event.t < castTick + 200);
    expect(during.length, '技能期间至少打了一发').toBeGreaterThan(0);
    for (const event of during) expect(event.combatFx, '技能期间让位').toBeUndefined();
  });
});

describe('★ 0.2.1 法术流光：阿米娅（黑红）/ 拉普兰德（白灰）', () => {
  it('两个人的 tracerFx 分别是黑红版和白灰版（同一套实现，只换配色）', () => {
    expect(UNIT_DEFS['op07']!.tracerFx).toBe('flow_arts_dark');
    expect(UNIT_DEFS['op08']!.tracerFx).toBe('flow_arts_light');
  });

  it('真打一场：每一发 attack 都带自己的流光 id', () => {
    for (const [defId, fx] of [['op07', 'flow_arts_dark'], ['op08', 'flow_arts_light']] as const) {
      const state = tanky(
        createBattle(
          UNIT_DEFS,
          [team(0, [place(0, defId, 2, 3, 4)]), team(1, [place(1, 'mn_slime', 1, 5, 4)])],
          20261034,
        ),
      );
      for (let i = 0; i < 200 && !state.over; i++) step(state, UNIT_DEFS);
      const me = state.units.find((unit) => unit.team === 0)!;
      const attacks = state.log.filter((event) => event.type === 'attack' && event.unitId === me.id);
      expect(attacks.length, `${defId} 前提：真的打了`).toBeGreaterThan(0);
      for (const event of attacks) expect((event as { fx?: string }).fx).toBe(fx);
    }
  });
});

describe('★ 0.2.1 治疗流光：古米 / 芙蓉', () => {
  it('两个人写了 healFx = stream_heal；别的医疗不写（不写 = 老行为）', () => {
    expect(UNIT_DEFS['op03']!.healFx, '古米').toBe('stream_heal');
    expect(UNIT_DEFS['op06']!.healFx, '芙蓉').toBe('stream_heal');
    for (const id of ['op16', 'op39', 'op46']) {
      expect(UNIT_DEFS[id]!.healFx, `${id} 没要求，保持原样`).toBeUndefined();
    }
  });

  it('古米：真打一场会 heal 队友，事件的 sourceId 就是她自己（渲染层据此从她身上射出去）', () => {
    const state = tanky(
      createBattle(
        UNIT_DEFS,
        [
          team(0, [place(0, 'op03', 2, 4, 4), place(0, 'op11', 2, 4, 5)]),
          team(1, [place(1, 'mn_slime', 1, 6, 4)]),
        ],
        20261035,
      ),
    );
    const me = state.units.find((unit) => unit.team === 0)!;
    // 把队友打成半血，否则"血量最低的队友"没有可治的人
    for (const unit of state.units) {
      if (unit.team === 0 && unit.id !== me.id) unit.hp = Math.floor(unit.maxHp * 0.4);
    }
    for (const unit of state.units) if (unit.team === 0) unit.mana = MANA_MAX;
    for (let i = 0; i < 200 && !state.over; i++) step(state, UNIT_DEFS);
    const heals = state.log.filter(
      (event) => event.type === 'heal' && (event as { sourceId?: number }).sourceId === me.id,
    );
    expect(heals.length, '前提：她真的奶了队友').toBeGreaterThan(0);
    for (const event of heals) {
      expect((event as { targetId?: number }).targetId, '奶的是别人（自己奶自己不用射流光）').not.toBe(me.id);
    }
  });
});

// ------------------------------------------------------------------
// 2c) ★★ 0.2.1 MujicaAve：三角初华（绿色）/ 八幡海铃（紫色音符）
// ------------------------------------------------------------------

describe('★ 0.2.1 三角初华：绿色攻击特效 = 治疗流光', () => {
  it('她写了 healFx = stream_heal（普攻本来就是治疗，所以这是"绿色攻击特效"的落点）', () => {
    expect(UNIT_DEFS['op53']!.healFx).toBe('stream_heal');
    /*
      ★ 为什么不给她写 `combatFx`（绿斩击）？
      她的被动是 `attackHeals`（攻击改为治疗友方），内核给她报的 `attack`
      是"打自己"、真正的表现是那条飞向队友的绿光。
      再加一套斩击/爆点，等于给一个治疗动作配"命中火花"，读起来像在自残。
    */
    expect(UNIT_DEFS['op53']!.combatFx, '别给她配斩击/爆点').toBeUndefined();
    expect(UNIT_DEFS['op53']!.tracerFx, '她也不该走远程白线那套').toBeUndefined();
  });

  it('真打一场：她每次出手都报一条 heal，sourceId 是她、目标是队友', () => {
    const state = tanky(
      createBattle(
        UNIT_DEFS,
        [
          team(0, [place(0, 'op53', 2, 3, 5), place(0, 'op11', 2, 2, 5)]),
          team(1, [place(1, 'mn_slime', 1, 7, 5)]),
        ],
        20261041,
      ),
    );
    const me = state.units.find((unit) => unit.team === 0)!;
    // 队友打成半血 —— 否则"血最低的友方"没有可治的人，也就没有 heal 事件
    for (const unit of state.units) {
      if (unit.team === 0 && unit.id !== me.id) unit.hp = Math.floor(unit.maxHp * 0.4);
    }
    for (let i = 0; i < 200 && !state.over; i++) step(state, UNIT_DEFS);
    /*
      ★ 只看**开技能之前**那些 —— 她的普攻治疗阶段。
      技能期的脉冲也会 heal，而脉冲治的是"血量最低的友方"，那个可能是她自己
      （她把自己的血让出来之后，最低的就变成她了）。那是正经玩法，不是这里要钉的东西。
    */
    const firstCast = state.log.find((event) => event.type === 'cast' && event.unitId === me.id) as
      | { t: number }
      | undefined;
    const healEvents = state.log.filter(
      (event) => event.type === 'heal' && (event as { sourceId?: number }).sourceId === me.id,
    ) as unknown as Array<{ t: number; targetId?: number }>;
    const basicHeals = healEvents.filter((event) => firstCast === undefined || event.t < firstCast.t);
    expect(basicHeals.length, '前提：她的普攻真的变成了治疗').toBeGreaterThan(0);
    for (const event of basicHeals) {
      expect(event.targetId, '普攻治疗奶的是队友，不是自己').not.toBe(me.id);
    }
  });
});

describe('★ 0.2.1 八幡海铃：紫色音符（祥子那套只换配色）', () => {
  it('tracerFx = note_purple；而且**没有**给她加穿透/多段的玩法', () => {
    expect(UNIT_DEFS['op54']!.tracerFx, '紫色音符').toBe('note_purple');
    /*
      ★★ 祥子的音符是靠 `attackProfile` 实现的（那还带着"穿 3 格、最多打 3 人"的机制）。
      海铃只要**表现**：走 `tracerFx`（纯表现层）。要是给她也写一份 `attackProfile`，
      就等于顺手改了玩法（而且 `hits` 忘写会让她**一点伤害都打不出来**）。
    */
    expect(SKILLS['op54']!.passive?.attackProfile, '海铃不该有自定义普攻弹道').toBeUndefined();
  });

  it('祥子的金色音符不受影响：还是 attackProfile.fx = note + 穿透 3 格', () => {
    const profile = SKILLS['op55']!.passive?.attackProfile;
    expect(profile?.fx, '金色（默认配色）').toBe('note');
    expect(profile?.pierceLength, '穿透 3 格').toBe(3);
    expect(profile?.maxTargets, '最多打 3 人').toBe(3);
  });

  it('真打一场：海铃每一发 attack 都带 fx = note_purple（渲染层据此换紫色音符）', () => {
    const state = tanky(
      createBattle(
        UNIT_DEFS,
        [team(0, [place(0, 'op54', 2, 3, 5)]), team(1, [place(1, 'mn_slime', 1, 5, 5)])],
        20261042,
      ),
    );
    for (let i = 0; i < 240 && !state.over; i++) step(state, UNIT_DEFS);
    const me = state.units.find((unit) => unit.team === 0)!;
    const attacks = state.log.filter((event) => event.type === 'attack' && event.unitId === me.id);
    expect(attacks.length, '前提：她真的打了几下').toBeGreaterThan(0);
    for (const event of attacks) {
      expect((event as { fx?: string }).fx, '每一发都要带').toBe('note_purple');
      // 纯表现 ⇒ 不该顺带带上一套贴图化的命中特效
      expect((event as { combatFx?: string }).combatFx).toBeUndefined();
    }
  });
});

// ------------------------------------------------------------------
// 2d) ★★ 0.2.1 回血光环：夜莺（绿 `+++`）/ 魔王（粉 `🗡+`）
// ------------------------------------------------------------------

describe('★★ 0.2.1 回血光环：只有"奶人"这一件事需要它', () => {
  it('夜莺：healHaloFx = heal_halo_green（绿色光环 + 绿色 +++）', () => {
    expect(UNIT_DEFS['op16']!.healHaloFx).toBe('heal_halo_green');
  });

  it('魔王：healHaloFx = heal_halo_pink（粉色光环 + 🗡+ 表示加攻）', () => {
    expect(UNIT_DEFS['op39']!.healHaloFx).toBe('heal_halo_pink');
  });

  it('★ 光环**不依赖** healFx（夜莺没有 `healFx`，光环照常亮）', () => {
    /*
      ★ 这两件事是分开的：
        · `healFx` 管"治疗那道流光怎么飞"（远程治疗才需要）；
        · `healHaloFx` 管"治疗者脚下那圈光环"。
      夜莺是被动脉冲群疗，压根没有"飞过去"这道动作 ⇒ 她只写光环就够了。
      谁要是把光环的生命周期挂到 `healFx` 上，夜莺的光环就会永远不亮。
    */
    expect(UNIT_DEFS['op16']!.healFx, '夜莺没有治疗流光（这是对的）').toBeUndefined();
    expect(UNIT_DEFS['op16']!.healHaloFx, '但有光环').toBe('heal_halo_green');
  });

  it('★ 有光环的人必须真的产出 heal 事件：真打一场数一遍', () => {
    /*
      ★ 这条是"光环挂错事件"的防回归：0.2.1 一度把光环挂在 `zone`（脉冲范围）上，
      结果魔王 3 星的治疗是 `healOverTime`、发的是**半径 0** 的框 ⇒ 光环缩成脚下一小圈。
      改挂 `heal` 之后就必须保证：他确实在产 `heal`。
    */
    for (const id of ['op16', 'op39']) {
      const state = tanky(
        createBattle(
          UNIT_DEFS,
          [team(0, [place(0, id, 3, 3, 5), place(0, 'op11', 2, 2, 5)]), team(1, [place(1, 'mn_slime', 1, 7, 5)])],
          20261051,
        ),
      );
      const me = state.units.find((unit) => unit.team === 0)!;
      for (const unit of state.units) {
        if (unit.team === 0) unit.hp = Math.floor(unit.maxHp * 0.5);
      }
      state.units.forEach((unit) => {
        if (unit.team === 0) unit.mana = MANA_MAX;
      });
      for (let i = 0; i < 300 && !state.over; i++) step(state, UNIT_DEFS);
      const heals = state.log.filter(
        (event) => event.type === 'heal' && (event as { sourceId?: number }).sourceId === me.id,
      );
      expect(heals.length, `${id} 一个 heal 都没有 ⇒ 光环永远不亮`).toBeGreaterThan(0);
    }
  });

  it('★ 除了这两人，不该有人随手挂上光环（写错 id 就会全场泛绿）', () => {
    const haloOwners = Object.entries(UNIT_DEFS)
      .filter(([, def]) => def.healHaloFx !== undefined)
      .map(([id]) => id)
      .sort();
    expect(haloOwners).toEqual(['op16', 'op39']);
  });
});

// ------------------------------------------------------------------
// 3) 纯表现层：把 fx 抹掉，校验和一个数都不变
// ------------------------------------------------------------------

describe('★★ 0.2.1 特效字段不进校验和（联机安全）', () => {
  /** 去掉普攻特效字段的 defs（只留战斗语义） */
  function strippedDefs(): UnitDefTable {
    const copy: UnitDefTable = {};
    for (const [id, def] of Object.entries(UNIT_DEFS)) {
      // ★ 0.2.1：healFx / tracerFx / healHaloFx 也是纯表现层，一起抹掉再对一遍
      copy[id] = {
        ...def,
        combatFx: undefined,
        tracerFx: undefined,
        healFx: undefined,
        healHaloFx: undefined,
      };
    }
    return copy;
  }

  it('抹掉 combatFx 之后，同一副阵容同一个种子的 checksum 完全一致', () => {
    const setup = (): [TeamSetup, TeamSetup] => [
      team(0, [place(0, 'op50', 3, 3, 4), place(0, 'op46', 3, 3, 5)]),
      team(1, [place(1, 'mn_slime', 1, 7, 4), place(1, 'mn_slime', 1, 7, 5)]),
    ];
    const run = (table: UnitDefTable): number => {
      const [a, b] = setup();
      const state = createBattle(table, [a, b], 20261020);
      for (let i = 0; i < 400 && !state.over; i++) step(state, table);
      return computeChecksum(state, state.over ? (state.winner ?? null) : null, state.tick);
    };
    expect(run(UNIT_DEFS)).toBe(run(strippedDefs()));
  });

  it('★ 抹掉 healHaloFx 之后，带光环的两人（夜莺 + 魔王）打一场校验和一样', () => {
    /*
      ★ 光环触发在 `heal` 事件里，本身不产生任何战斗事件 ——
        但这个断言是"以后有人把光环改成会改状态"的绊线（那是绝对不能的）。
    */
    const setup = (): [TeamSetup, TeamSetup] => [
      team(0, [place(0, 'op16', 3, 3, 5), place(0, 'op39', 3, 2, 5)]),
      team(1, [place(1, 'mn_slime', 1, 7, 4), place(1, 'mn_slime', 1, 7, 5)]),
    ];
    const run = (table: UnitDefTable): number => {
      const [a, b] = setup();
      const state = createBattle(table, [a, b], 20261052);
      for (let i = 0; i < 400 && !state.over; i++) step(state, table);
      return computeChecksum(state, state.over ? (state.winner ?? null) : null, state.tick);
    };
    expect(run(UNIT_DEFS)).toBe(run(strippedDefs()));
  });
});
