/**
 * ============================================================
 *  ★★ 0.2 MujicaAve：fever（热度）—— 内核那一半
 * ============================================================
 *
 * 【这一组守的是什么？】
 * fever 的规则横跨"战斗内"和"回合间"两层，这一组只管**战斗内**那三条：
 *   1. 每次**受到攻击** fever +1（三档就有）；
 *   2. 每次**造成伤害** fever +1（只有 5/7 档有 —— 3 档是 0，很容易抄错）；
 *   3. 消耗之后那一场的**特殊技能**：开局立刻放一次技能 + 窗口内受到致命伤害不死
 *      + 窗口结束时技力回满。
 * 回合间那一套（倍数 / 返还 / 翻倍 / 弹窗）在 `apps/web/test/fever-round.test.ts`。
 *
 * 【为什么用"直接喂机制"而不是靠羁绊表凑人？】
 * 因为 MujicaAve 的成员表**还没加人**（用户口径：先写效果，后面再加人）。
 * 所以这里直接把机制数组塞进 `unitMechanics` —— 测的是内核消费方，
 * 顺带也让这组测试不依赖"以后谁带这个标签"。
 */
import { describe, expect, it } from 'vitest';
import {
  MANA_MAX,
  TRAIT_DEFS,
  UNIT_DEFS,
  createBattle,
  step,
  type BattleState,
  type ScopedMechanic,
  type TeamSetup,
  type UnitPlacement,
  type UnitState,
} from '../src/index.js';

const s = (seconds: number): number => Math.round(seconds * 20);

/** 模型：一个打不死的惰性靶子（压平护甲魔抗，别让减免吃掉伤害） */
const dummy = (col: number, row: number, attackSpeed = 0.1): UnitPlacement => ({
  defId: 'mn_duholy',
  star: 3,
  cell: { col, row },
  statOverride: { hp: 100_000_000, armor: 0, magicResist: 0, attackSpeed },
});

/** 三条档位各自的机制（直接照数据表取，避免在测试里抄一份数值） */
function feverMechanic(tierIndex: number): ScopedMechanic[] {
  const tier = TRAIT_DEFS['mujica']!.tiers[tierIndex]!;
  return (tier.mechanics ?? []) as ScopedMechanic[];
}

/** 摆一场：我方一个干员（带 MujicaAve 的三条机制），对面一个靶子 */
function board(opts: {
  tierIndex?: number;
  feverSkill?: { durationTicks: number };
  myDefId?: string;
} = {}): { state: BattleState; me: UnitState; foe: UnitState } {
  const myDefId = opts.myDefId ?? 'op21';
  const mechanics = feverMechanic(opts.tierIndex ?? 0);
  const team0: UnitPlacement[] = [{ defId: myDefId, star: 1, cell: { col: 4, row: 4 } }];
  const teams: [TeamSetup, TeamSetup] = [
    {
      team: 0,
      units: team0,
      playerContext: { gold: 0, hp: 100 },
      unitMechanics: { [myDefId]: mechanics },
      ...(opts.feverSkill ? { feverSkill: opts.feverSkill } : {}),
    },
    {
      team: 1,
      units: [dummy(5, 4, 1)],
      playerContext: { gold: 0, hp: 100 },
      unitMechanics: {},
    },
  ];
  const state = createBattle(UNIT_DEFS, teams, 20261016);
  return {
    state,
    me: state.units.find((unit) => unit.team === 0)!,
    foe: state.units.find((unit) => unit.team === 1)!,
  };
}

describe('★ 0.2 MujicaAve：数据口径', () => {
  it('3/5/8 档：回技力 5%/10%/20%、攻速 +15%/30%/50%', () => {
    const tiers = TRAIT_DEFS['mujica']!.tiers;
    // ★ 0.2（2026-10-17 用户口径）：最高档从 7 人抬到 **8 人**，其余两档不变
    expect(tiers.map((tier) => tier.count)).toEqual([3, 5, 8]);
    expect(tiers.map((tier) => tier.effects?.[0]?.value)).toEqual([1500, 3000, 5000]);
    const mana = tiers.map(
      (tier) =>
        (tier.mechanics ?? []).find((m) => m.kind === 'selfManaRegen') as
          | { manaBp: number; intervalTicks: number }
          | undefined,
    );
    // `manaBp` 是**万分比**、`intervalTicks` 20 = 每秒跳一次 ⇒ 5% / 10% / 20% 每秒
    expect(mana.map((m) => m?.manaBp)).toEqual([500, 1000, 2000]);
    expect(mana.every((m) => m?.intervalTicks === 20)).toBe(true);
  });

  it('★ fever 的三条战斗侧参数：受击 1 点、造伤 3 档 0 / 5·7 档 1、窗口 5/10/15 秒', () => {
    const fever = TRAIT_DEFS['mujica']!.tiers.map(
      (tier) => (tier.mechanics ?? []).find((m) => m.kind === 'fever') as never,
    ) as Array<{ onHit: number; onDeal: number; skillDurationTicks: number; lossMultiplierBp: number; winDecayBp: number; refundBp: number; doubleAtRoundEnd?: boolean }>;
    expect(fever.map((f) => f.onHit)).toEqual([1, 1, 1]);
    expect(fever.map((f) => f.onDeal), '3 档只管受击').toEqual([0, 1, 1]);
    expect(fever.map((f) => f.skillDurationTicks)).toEqual([s(5), s(10), s(15)]);
    // 失败倍数 ×1.5 / ×2 / ×5（万分比）
    expect(fever.map((f) => f.lossMultiplierBp)).toEqual([15000, 20000, 50000]);
    // 获胜扣 30% / 30% / 不扣
    expect(fever.map((f) => f.winDecayBp)).toEqual([3000, 3000, 0]);
    // 失败返还消耗量的 50% / 70% / 100%
    expect(fever.map((f) => f.refundBp)).toEqual([5000, 7000, 10000]);
    // 只有 7 档回合结束翻倍
    expect(fever.map((f) => f.doubleAtRoundEnd ?? false)).toEqual([false, false, true]);
    for (const tier of TRAIT_DEFS['mujica']!.tiers) {
      const mech = (tier.mechanics ?? []).find((m) => m.kind === 'fever') as { thresholds: number[] };
      expect(mech.thresholds, '七个档位数字').toEqual([100, 300, 500, 1000, 1500, 2000, 3000]);
    }
  });
});

describe('★ 0.2 MujicaAve：每秒回技力只给成员自己', () => {
  /*
    【为什么盯着 `mana` 事件、而不是看 `unit.mana` 的总数？】
    因为技力还有**别的来源**：普攻回蓝（攻击回复型每刀 +100）。
    只看总数会把"打了一刀"算进"每秒回 5%"里，断言就对不上了（第一版就栽在这）。
    回技力这件事自己会记一条 `mana` 事件，按 **amount** 认它最干净。
  */
  const regenEvents = (state: BattleState, unitId: number, amount: number): number =>
    state.log.filter(
      (event) => event.type === 'mana' && event.unitId === unitId && event.amount === amount,
    ).length;

  it('每秒回 5%（3 档）：20 tick 里正好跳一次，每次 5% 上限', () => {
    const { state, me } = board({ tierIndex: 0 });
    for (let i = 0; i < 20; i++) step(state, UNIT_DEFS);
    expect(regenEvents(state, me.id, Math.floor((MANA_MAX * 500) / 10000)), '每秒 5%').toBe(1);
  });

  it('队伍里**没带这条机制**的人不回（它只给 MujicaAve 成员）', () => {
    // 我方两个人：只有 op21 带机制
    const teams: [TeamSetup, TeamSetup] = [
      {
        team: 0,
        units: [
          { defId: 'op21', star: 1, cell: { col: 4, row: 4 } },
          { defId: 'op01', star: 1, cell: { col: 3, row: 4 } },
        ],
        playerContext: { gold: 0, hp: 100 },
        unitMechanics: { op21: feverMechanic(0) },
      },
      { team: 1, units: [dummy(5, 4)], playerContext: { gold: 0, hp: 100 } },
    ];
    const state = createBattle(UNIT_DEFS, teams, 7);
    const member = state.units.find((unit) => unit.defId === 'op21')!;
    const other = state.units.find((unit) => unit.defId === 'op01')!;
    for (let i = 0; i < 20; i++) step(state, UNIT_DEFS);
    const regen = Math.floor((MANA_MAX * 500) / 10000);
    expect(regenEvents(state, member.id, regen), '成员该回').toBe(1);
    expect(regenEvents(state, other.id, regen), '非成员不该被带着回（那是 teamManaRegen 的行为）').toBe(0);
  });
});

describe('★ 0.2 MujicaAve：fever 怎么攒（战斗内）', () => {
  it('★ 每次**受到攻击** +1（3 档就有）', () => {
    const { state, me, foe } = board({ tierIndex: 0 });
    expect(state.feverGained[0]).toBe(0);
    for (let i = 0; i < 60 && !state.over; i++) step(state, UNIT_DEFS);
    // 对面攻速 1/秒 ⇒ 这段时间里我方挨了几下
    expect(state.feverGained[0], '我方是 0 队').toBeGreaterThan(0);
    expect(state.feverGained[1], '对面没有这条羁绊').toBe(0);
    void me;
    void foe;
  });

  it('★★ 3 档**不**因造伤攒 fever（onDeal = 0）—— 抄成 1 就会变成两倍速', () => {
    const { state } = board({ tierIndex: 0 });
    for (let i = 0; i < 60 && !state.over; i++) step(state, UNIT_DEFS);
    const hitOnly = state.feverGained[0];
    // 同一场用 5 档（onDeal = 1）应该严格更多
    const five = board({ tierIndex: 1 });
    for (let i = 0; i < 60 && !five.state.over; i++) step(five.state, UNIT_DEFS);
    expect(five.state.feverGained[0], '5 档受了攻击还造成伤害，应该比 3 档多').toBeGreaterThan(
      hitOnly,
    );
  });

  it('★ 5/7 档：造成伤害也 +1（连击/溅射按"每一次伤害结算"算）', () => {
    const { state, me } = board({ tierIndex: 1 });
    // 我方先动手：等到至少打中一次
    for (let i = 0; i < 40 && !state.over; i++) step(state, UNIT_DEFS);
    const dealt = me.damageDealt;
    expect(dealt, '至少打中了一次').toBeGreaterThan(0);
    expect(state.feverGained[0], '造伤也算 fever').toBeGreaterThan(0);
  });

  it('野怪回合：内核照样数，但**回合流程会整场跳过**（见 fever-round.test.ts）', () => {
    // 这里只钉"内核不做回合判断"这件事 —— 内核对回合号一无所知
    const { state } = board({ tierIndex: 2 });
    for (let i = 0; i < 40 && !state.over; i++) step(state, UNIT_DEFS);
    expect(state.feverGained[0]).toBeGreaterThan(0);
  });
});

describe('★★ 0.2 MujicaAve：消耗之后那一场的「特殊技能」', () => {
  it('开局立刻放一次技能（不等技力攒满）', () => {
    const { state, me } = board({ tierIndex: 0, feverSkill: { durationTicks: s(5) } });
    const casts = state.log.filter((event) => event.type === 'cast' && event.unitId === me.id);
    expect(casts.length, 't=0 就应该记一条 cast').toBe(1);
    expect(me.mana, '放技能不花技力（是"立刻开启"不是"攒够了"）').toBe(0);
  });

  it('★ 没武装（没消耗 fever）就不放', () => {
    const { state, me } = board({ tierIndex: 0 });
    expect(state.log.some((event) => event.type === 'cast' && event.unitId === me.id)).toBe(false);
  });

  it('★★ 窗口内受到**致命伤害不会死**（血锁 1），窗口过后照常会死', () => {
    const { state, me, foe } = board({ tierIndex: 0, feverSkill: { durationTicks: s(5) } });
    // 把我方血量压到极低，让对面下一击必死
    me.hp = 1;
    for (let i = 0; i < s(4); i++) step(state, UNIT_DEFS);
    expect(me.dead, '窗口里（5 秒内）不该被打死').toBe(false);
    void foe;
    // 过了窗口：把血再压到 1，下一次挨打就该死了
    for (let i = 0; i < s(2); i++) step(state, UNIT_DEFS);
    me.hp = 1;
    for (let i = 0; i < s(3) && !me.dead; i++) step(state, UNIT_DEFS);
    expect(me.dead, '窗口结束后恢复正常（会死）').toBe(true);
  });

  it('★★ 窗口结束时技力条**回满一次**（"结束后会立刻回满技能条一次"）', () => {
    const { state, me } = board({ tierIndex: 0, feverSkill: { durationTicks: s(5) } });
    // 窗口结束那一刻之前一直是 0（开局放技能时不花技力、也没回）
    for (let i = 0; i < s(5) - 1; i++) step(state, UNIT_DEFS);
    expect(me.feverSkillUntilTick, '窗口还没到点').toBeDefined();
    step(state, UNIT_DEFS);
    expect(me.feverSkillUntilTick, '到点后标记要清掉').toBeUndefined();
    expect(me.mana, '技力条回满').toBe(MANA_MAX);
  });

  it('技力回满这件事要**记事件**（否则客户端界面上的技力条不会动）', () => {
    const { state, me } = board({ tierIndex: 0, feverSkill: { durationTicks: s(2) } });
    for (let i = 0; i < s(2) + 1; i++) step(state, UNIT_DEFS);
    const manaEvents = state.log.filter(
      (event) => event.type === 'mana' && event.unitId === me.id && event.manaAfter === MANA_MAX,
    );
    expect(manaEvents.length, '客户端回放就是靠这条事件更新技力条的').toBeGreaterThan(0);
  });

  it('★ 只有带 fever 机制的棋子吃得到（同队的普通干员不放也不免死）', () => {
    const teams: [TeamSetup, TeamSetup] = [
      {
        team: 0,
        units: [
          { defId: 'op21', star: 1, cell: { col: 4, row: 4 } },
          { defId: 'op01', star: 1, cell: { col: 3, row: 4 } },
        ],
        playerContext: { gold: 0, hp: 100 },
        unitMechanics: { op21: feverMechanic(1) },
        feverSkill: { durationTicks: s(5) },
      },
      { team: 1, units: [dummy(5, 4)], playerContext: { gold: 0, hp: 100 } },
    ];
    const state = createBattle(UNIT_DEFS, teams, 11);
    const member = state.units.find((unit) => unit.defId === 'op21')!;
    const other = state.units.find((unit) => unit.defId === 'op01')!;
    expect(
      state.log.some((event) => event.type === 'cast' && event.unitId === member.id),
      '成员放技能',
    ).toBe(true);
    expect(
      state.log.some((event) => event.type === 'cast' && event.unitId === other.id),
      '非成员不放',
    ).toBe(false);
    expect(other.feverSkillUntilTick, '非成员没有免死窗口').toBeUndefined();
  });

  it('7 档的窗口是 15 秒（不是 5 秒）', () => {
    const { state, me } = board({ tierIndex: 2, feverSkill: { durationTicks: s(15) } });
    for (let i = 0; i < s(14); i++) step(state, UNIT_DEFS);
    expect(me.dead, '窗口里还活着').toBe(false);
    expect(me.feverSkillUntilTick, '还没到 15 秒').toBeDefined();
  });
});
