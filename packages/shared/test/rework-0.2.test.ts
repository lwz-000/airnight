/**
 * ★★ 0.2：干员重做第三/四批的机制测试 —— 新约能天使 / 赤刃明霄陈 / 可露希尔。
 *
 * ============================================================
 *  【这一组守的是什么？】
 * ============================================================
 * 这三位带进来的都是**新机制**（不是改数值），而新机制"生效了没有"
 * 从战斗结果上很难一眼看出来。所以每一条都在测"那一刻的数值/状态"：
 *
 *   · **新约能天使**：30 颗子弹（打完才结束）、技能结束**主动回收**挂在队友
 *     身上的减益与剩余护盾（施法者中途阵亡也要收）、3 星"复活 + 满技力 + 五连击消耗五发"。
 *   · **赤刃明霄陈**：附伤按**目标生命上限**、回血按**已损失生命**且速率 20%/s、
 *     技能期间**不回技力**、3 星"5 段 ×900% + 隐匿 + 击杀刷新"。
 *   · **可露希尔**：被动"每 2 次攻击额外攻击 1 名目标"、主动加成**按金币**上浮（上限 5%）、
 *     3 星 Q.E.D 的"9 跳后换 180%"与"每个目标只吃一次攻速减益"。
 *
 * ============================================================
 *  【两条容易踩的口径，先写在这里】
 * ============================================================
 *  1. 「此数值每有 10 金币额外增加 1%，最高上限 5%」里的"此数值"按**整份加成**理解
 *     （防御力和攻击力一起涨），折算只加在 `*Bp`（万分比）字段上 —— 见 `withGoldBonus`。
 *  2. Q.E.D 的"造成 9 次伤害后"按**全局跳数**算（每跳一次算一次，不管打到几个人）。
 *     这两条都是用户拍板的。
 *
 * ============================================================
 *  【写这一组时踩过的坑，后来人照着躲】
 * ============================================================
 *  · **倍率一律是万分比**：Q.E.D 的 120%/180% 是 `ratioBp: 12000 / 18000`。
 *    第一版写成 1200/1800（千分比的口径）⇒ 实际伤害只有面板的 1/10，
 *    症状是"机制全对、数字全错"。所以下面顺手把 `ratioBp` 本身也钉住。
 *  · **靶子必须是"惰性"的**：见 `dummy()` 的说明 —— 坦克类棋子的护甲/护盾
 *    会把伤害数字改成 0 或者打折，倍率断言根本对不上。别图省事复用 `tank()`。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  MANA_MAX,
  MAX_BATTLE_TICKS,
  UNIT_DEFS,
  castSkill,
  collectMods,
  createBattle,
  effectiveAttackSpeed,
  gainMana,
  skillVariantOf,
  step,
  tickSkillAttachments,
  withGoldBonus,
  type BattleState,
  type SkillEffect,
  type TeamSetup,
  type UnitDef,
  type UnitPlacement,
  type UnitState,
} from '../src/index.js';

const s = (seconds: number): number => Math.round(seconds * 20);

const byName = (name: string): UnitDef => {
  const def = Object.values(UNIT_DEFS).find((d) => d.name.includes(name));
  if (!def) throw new Error(`找不到干员「${name}」——名字改过？`);
  return def;
};

const ANGEL = byName('新约能天使');
const CHEN = byName('赤刃明霄陈');
const CLOSURE = byName('可露希尔');

function effectOf(def: UnitDef, kind: SkillEffect['kind'], star = 1, index = 0): SkillEffect {
  const found = skillVariantOf(def, star).effects.filter((e) => e.kind === kind);
  const picked = found[index];
  if (!picked) throw new Error(`${def.name} 的技能里没有第 ${index + 1} 个 ${kind}`);
  return picked;
}

/** 两边各摆一批棋子；返回 state 与按 defId 查单位的函数 */
function board(
  team0: UnitPlacement[],
  team1: UnitPlacement[],
  gold: [number, number] = [0, 0],
): { state: BattleState; unit: (defId: string) => UnitState } {
  const setups: [TeamSetup, TeamSetup] = [
    { team: 0, units: team0, playerContext: { gold: gold[0], hp: 100 } },
    { team: 1, units: team1, playerContext: { gold: gold[1], hp: 100 } },
  ];
  const state = createBattle(UNIT_DEFS, setups, 20261101);
  return {
    state,
    unit: (defId: string) => {
      const found = state.units.find((u) => u.defId === defId);
      if (!found) throw new Error(`场上没有 ${defId}`);
      return found;
    },
  };
}

/** 掐着数字放技能：把当前星级该有的那一套效果直接喂给内核 */
function cast(state: BattleState, unit: UnitState): void {
  const def = UNIT_DEFS[unit.defId]!;
  const variant = skillVariantOf(def, unit.star);
  castSkill(state, unit, `${unit.defId}_skill`, [...variant.effects], UNIT_DEFS);
}

/** 一个打不死的靶子：机械师 3 星（生命上限高，够撑住很多跳） */
const tank = (col: number, row: number): UnitPlacement => ({ defId: 'op27', star: 3, cell: { col, row } });

/**
 * ★「惰性靶子」：深池伙友卫队精英（**没有技能、没有羁绊**）+ 测试模式的数值覆盖。
 *
 * 【为什么不能随便拿个棋子当靶子？】踩过两次：
 *   · 坦克类棋子身上有护甲/护盾，伤害数字会被吃成 0 或者被护盾磨掉一部分 ——
 *     于是"第 10 跳伤害变成 1.5 倍"这种**倍率**断言根本无从对起；
 *   · 有被动的棋子会随时间改自己的护甲，同一场战斗里前后两跳的数字不可比。
 * 把护甲/魔抗压成 0、生命上限抬到打不死、攻速压到 0.1（它自己几乎不出手）之后，
 * 日志里的 `amount` 就是**纯倍率**，可以直接和面板上的 120%/180% 对上。
 */
const dummy = (col: number, row: number): UnitPlacement => ({
  defId: 'mn_duholy',
  star: 3,
  cell: { col, row },
  statOverride: { hp: 100_000_000, armor: 0, magicResist: 0, attackSpeed: 0.1 },
});

// ============================================================
//  新约能天使
// ============================================================

describe('★ 0.2 新约能天使：30 颗子弹（打完技能才结束）', () => {
  it('基础技能的数据：30 发、攻速 +150%/250%、普攻倍率 +5%/+10%', () => {
    const bullet = effectOf(ANGEL, 'buff');
    expect(bullet.kind === 'buff' && bullet.attacks, '30 颗子弹').toBe(30);
    expect(bullet.kind === 'buff' && bullet.target).toBe('self');
    expect(bullet.kind === 'buff' && bullet.stats.attackSpeedBp).toEqual([15000, 25000, 25000]);
    // 「每颗子弹造成相当于自身攻击力 105%/110%」⇒ 有子弹时普攻倍率 +5%/+10%
    expect(bullet.kind === 'buff' && bullet.stats.attackDamageBp).toEqual([500, 1000, 1000]);
    expect(bullet.kind === 'buff' && bullet.durationTicks, '时长写成整场，靠发数消耗').toBe(MAX_BATTLE_TICKS);
  });

  it('★ 子弹打光的那一刻，攻速和倍率一起还原（同一包携带 ⇒ 不会只回一半）', () => {
    const { state, unit } = board([{ defId: 'op50', star: 1, cell: { col: 4, row: 4 } }], [tank(5, 4)]);
    const angel = unit('op50');
    const before = effectiveAttackSpeed(angel, collectMods(state, angel));
    cast(state, angel);
    const during = effectiveAttackSpeed(angel, collectMods(state, angel));
    expect(during, '开技能后攻速应该 +150%').toBe(Math.round((before * 25000) / 10000));

    // 手动把 30 发打光（模拟"打满 30 下"）
    const buff = angel.skill!.buffs.find((b) => b.attackCharges !== undefined)!;
    expect(buff.attackCharges).toBe(30);
    buff.attackCharges = 0;
    angel.skill!.buffs.splice(angel.skill!.buffs.indexOf(buff), 1);
    expect(effectiveAttackSpeed(angel, collectMods(state, angel)), '子弹没了 ⇒ 攻速回到原样').toBe(before);
  });

  it('★ 技能结束（子弹打光）时，给队友的减益和剩余护盾都要被收回来', () => {
    const { state, unit } = board(
      [
        { defId: 'op50', star: 1, cell: { col: 4, row: 4 } },
        { defId: 'op09', star: 1, cell: { col: 3, row: 4 } },
      ],
      [tank(6, 4)],
    );
    const angel = unit('op50');
    const ally = unit('op09');
    cast(state, angel);

    expect(ally.statuses['shieldValue'] ?? 0, '最近友方应该拿到 1000 点盾').toBeGreaterThan(0);
    expect(ally.statuses['shieldBoundTo'], '这层盾要记着"是技能给的"').toBe(angel.id + 1);
    const debuffOnAlly = ally.skill!.buffs.find((b) => b.fromSkill === true && b.sourceId === angel.id);
    expect(debuffOnAlly, '最近友方应该拿到攻速 -30% 的减益').toBeTruthy();

    /*
      ★ `armed` 这道闸：必须先确认"自己身上确实挂过技能包"再开始判结束。
      所以第一次回收**什么都不该收走**（此时技能刚开、弹药还在）。
      不设这一位的话，一个只有"给队友上盾"的技能会在放完的下一 tick 就把刚给的盾收走。
    */
    tickSkillAttachments(state, angel);
    expect(ally.statuses['shieldValue'] ?? 0, '技能还在生效中，盾不该消失').toBeGreaterThan(0);

    // 「技能结束」= 那包弹药没了
    angel.skill!.buffs = angel.skill!.buffs.filter((b) => b.attackCharges === undefined);
    tickSkillAttachments(state, angel);

    expect(ally.statuses['shieldValue'] ?? 0, '剩余护盾应该一起消失').toBe(0);
    expect(
      ally.skill!.buffs.some((b) => b.fromSkill === true && b.sourceId === angel.id),
      '友方减益应该恢复',
    ).toBe(false);
  });

  it('★ 施法者中途阵亡，挂在队友身上的减益同样要还回去', () => {
    const { state, unit } = board(
      [
        { defId: 'op50', star: 1, cell: { col: 4, row: 4 } },
        { defId: 'op09', star: 1, cell: { col: 3, row: 4 } },
      ],
      [tank(6, 4)],
    );
    const angel = unit('op50');
    const ally = unit('op09');
    cast(state, angel);
    expect(ally.skill!.buffs.some((b) => b.fromSkill === true), '前提：减益挂上了').toBe(true);

    // 施法者阵亡：它自己身上的技能包永远不会被 tickSkill 清掉，所以"已死"必须当成"技能结束"
    angel.dead = true;
    tickSkillAttachments(state, angel);
    expect(
      ally.skill!.buffs.some((b) => b.fromSkill === true && b.sourceId === angel.id),
      '施法者死了也要收回来',
    ).toBe(false);
  });

  it('★ 3 星：复活 + 回满技力 + 50 发（每次攻击消耗 5 发）+ 五连击', () => {
    const revive = effectOf(ANGEL, 'revive', 3) as Extract<SkillEffect, { kind: 'revive' }>;
    expect(revive.count).toBe(1);
    expect(revive.star).toBe(3);
    expect(revive.manaBp, '表里："并使其回复 100% 的技力"').toBe(10000);

    const bullet = effectOf(ANGEL, 'buff', 3) as Extract<SkillEffect, { kind: 'buff' }>;
    expect(bullet.attacks).toBe(50);
    expect(bullet.chargesPerAttack, '五连击 ⇒ 一次消耗 5 发').toBe(5);
    expect(bullet.stats.attackSpeedBp).toBe(50000);
    expect(bullet.stats.attackDamageBp).toBe(3000);
    expect(bullet.stats.multiHit).toBe(5);
  });

  it('★ 源码级：`tickSkillAttachments` 必须在 rules 的 tick 里对**所有**单位调用', () => {
    const src = readFileSync(new URL('../src/rules.ts', import.meta.url), 'utf8');
    const index = src.indexOf('tickSkillAttachments(state, unit)');
    expect(index, 'rules.ts 里要有这一趟回收').toBeGreaterThan(0);
    /*
      必须是一趟独立的 `for (const unit of state.units)`，
      而不能并进上面那个 `if (unit.dead) continue` 的循环 —— 否则施法者一死就收不回来了。
    */
    const around = src.slice(Math.max(0, index - 260), index);
    expect(around, '这一趟不能挂在"跳过阵亡单位"的循环里').toContain('for (const unit of state.units)');
  });
});

// ============================================================
//  赤刃明霄陈
// ============================================================

describe('★ 0.2 赤刃明霄陈：按目标生命上限附伤 + 按已损失生命缓慢回血 + 技能期间不回技力', () => {
  it('基础技能数据：8 秒攻速 +25%/+40%、附伤按目标生命上限 2%/3%、技能期间不回技力', () => {
    const buff = effectOf(CHEN, 'buff') as Extract<SkillEffect, { kind: 'buff' }>;
    expect(buff.stats.attackSpeedBp).toEqual([2500, 4000, 4000]);
    expect(buff.stats.bonusDamage).toEqual({
      source: 'maxHp',
      ratioBp: [200, 300, 300],
      damageType: 'magic',
    });
    expect(buff.stats.noManaGain, '「技能持续期间不再获得技力」').toBe(true);
    expect(buff.durationTicks).toBe(s(8));
  });

  it('★ 回血：总量 = 已损失生命 ×15%/30%，速率 20%/s ⇒ 每 0.25 秒跳 5%，跳 3/6 次', () => {
    const hot = effectOf(CHEN, 'healOverTime') as Extract<SkillEffect, { kind: 'healOverTime' }>;
    expect(hot.basis, '按**已损失**生命').toBe('missingHp');
    expect(hot.power, '每跳 5%').toBe(50);
    expect(hot.intervalTicks).toBe(5);
    expect(hot.durationTicks, '1 星 0.75 秒 / 2 星 1.5 秒（= 总量 ÷ 20%/s）').toEqual([15, 30, 30]);
  });

  it('★ 真实跑一场：1 星总共回的血 ≈ 释放那一刻"已损失生命"的 15%', () => {
    const { state, unit } = board([{ defId: 'op48', star: 1, cell: { col: 4, row: 4 } }], [tank(5, 4)]);
    const chen = unit('op48');
    chen.hp = Math.floor(chen.maxHp / 2);
    const missing = chen.maxHp - chen.hp;
    const logStart = state.log.length;

    cast(state, chen);
    for (let i = 0; i < s(3); i++) step(state, UNIT_DEFS);

    const healed = state.log
      .slice(logStart)
      .filter((e) => e.type === 'heal' && e.targetId === chen.id)
      .reduce((sum, e) => (e.type === 'heal' ? sum + e.amount : sum), 0);
    expect(healed, '总量 = 已损失生命 ×5% ×3 跳').toBe(Math.floor((missing * 50) / 1000) * 3);
  });

  it('★ 技能期间 `gainMana` 一点法力都进不来；包过期后恢复', () => {
    const { state, unit } = board([{ defId: 'op48', star: 1, cell: { col: 4, row: 4 } }], [tank(5, 4)]);
    const chen = unit('op48');
    chen.mana = 0;
    cast(state, chen);
    gainMana(state, chen, 40);
    expect(chen.mana, '技能生效中不回技力').toBe(0);

    // 让那包过期
    for (const buff of chen.skill!.buffs) buff.ticksLeft = 0;
    for (let i = 0; i < 3; i++) step(state, UNIT_DEFS);
    expect(chen.skill!.buffs.length, '前提：包已经到期被摘掉了').toBe(0);
    /*
      ★ 这里不能断言"法力正好 = 40"：战斗还在跑，靶子会打她、她自己也在出手，
      中间可能有别的回蓝。只要"这次 gainMana 确实到账了"就说明闸门开了。
    */
    const beforeGain = chen.mana;
    gainMana(state, chen, 40);
    expect(chen.mana, '包没了 ⇒ 技力照常回').toBe(Math.min(MANA_MAX, beforeGain + 40));
  });

  it('★ 3 星：5 段 ×900% + 隐匿 + 击杀刷新', () => {
    const buff = effectOf(CHEN, 'buff', 3) as Extract<SkillEffect, { kind: 'buff' }>;
    expect(buff.stats.multiHit).toBe(5);
    expect(buff.stats.multiHitBp, '每段 900%（万分比 90000）').toBe(90000);
    expect(buff.stats.untargetable, '「技能持续期间获得隐匿」').toBe(true);
    expect(buff.stats.onKillRefresh, '「若击杀敌人则再斩击一次」').toBe(true);
    expect(buff.attacks).toBe(1);
    for (const effect of skillVariantOf(CHEN, 3).effects) {
      expect(effect.kind, '3 星只有"瞬移 + 五连斩"两件事，不再有附伤 buff').not.toBe('healOverTime');
    }
  });
});

// ============================================================
//  可露希尔
// ============================================================

describe('★ 0.2 可露希尔：被动"每 2 次攻击额外攻击 1 名目标"', () => {
  it('被动写在 skill.passive.everyNthAttack 上（不是"每次都多打"的 extraTargets）', () => {
    const passive = skillVariantOf(CLOSURE, 1).passive!;
    expect(passive.everyNthAttack).toEqual({ every: 2, extraTargets: 1 });
    expect(passive.extraTargets, '★ 别写成常驻 extraTargets —— 那是"每一次都多打一个"').toBeUndefined();
  });

  it('★ 真实结算：第 1 次攻击只打 1 个，第 2 次打 2 个，第 3 次又只打 1 个', () => {
    const { state, unit } = board(
      [{ defId: 'op44', star: 1, cell: { col: 4, row: 4 } }],
      [dummy(5, 4), dummy(6, 4), dummy(5, 3)],
    );
    const closure = unit('op44');
    const enemies = state.units.filter((u) => u.team === 1).map((u) => u.id);
    const hitsPerAttack: number[] = [];
    let lastAttackTick = -1;
    for (let i = 0; i < s(12) && !state.over; i++) {
      const before = state.log.length;
      step(state, UNIT_DEFS);
      const fresh = state.log
        .slice(before)
        .filter((e) => e.type === 'damage' && e.sourceId === closure.id && enemies.includes(e.targetId));
      if (fresh.length > 0 && state.tick !== lastAttackTick) {
        lastAttackTick = state.tick;
        hitsPerAttack.push(fresh.length);
      }
    }
    expect(hitsPerAttack.length, '应该出手好几次').toBeGreaterThan(3);
    // 第 1 次 1 个，第 2 次 2 个（额外攻击 1 名目标），第 3 次 1 个……
    expect(hitsPerAttack[0]).toBe(1);
    expect(hitsPerAttack[1], '★ 第 2 次攻击要多打一个人').toBe(2);
    expect(hitsPerAttack[2]).toBe(1);
    expect(hitsPerAttack[3]).toBe(2);
  });
});

describe('★ 0.2 可露希尔：主动加成按金币上浮（每 10 金 +1%，上限 +5%）', () => {
  it('★ `withGoldBonus` 只给 `*Bp` 字段加，flat 字段一点不动', () => {
    const stats = withGoldBonus(
      {
        armorBp: [1500, 3000, 3000],
        attackDamageBp: [1000, 1500, 1500],
        armorFlat: 30,
        goldBonusBp: { perGold: 10, bpPerStep: 100, maxBp: 500 },
      },
      30,
    );
    // 30 金 = 3 步 × 1% = +3%（bp 口径：1% = 100）
    expect(stats.armorBp).toEqual([1800, 3300, 3300]);
    expect(stats.attackDamageBp).toEqual([1300, 1800, 1800]);
    expect(stats.armorFlat, '★ 点数类字段不该被"每 10 金 +1%"影响').toBe(30);
    expect(stats.goldBonusBp, '说明书字段不该留在修正包里').toBeUndefined();
  });

  it('★ 上限 +5%：50 金就到底，200 金也不再多', () => {
    const base = { attackDamageBp: 1000, goldBonusBp: { perGold: 10, bpPerStep: 100, maxBp: 500 } };
    expect(withGoldBonus(base, 0).attackDamageBp).toBe(1000);
    expect(withGoldBonus(base, 49).attackDamageBp, '4 步 = +4%').toBe(1400);
    expect(withGoldBonus(base, 50).attackDamageBp, '5 步 = +5%').toBe(1500);
    expect(withGoldBonus(base, 200).attackDamageBp, '封顶 +5%').toBe(1500);
  });

  it('★ 真实跑一场：金币多的那一队，队友吃到的加成更高', () => {
    const run = (gold: number): number => {
      const { state, unit } = board(
        [
          { defId: 'op44', star: 2, cell: { col: 4, row: 4 } },
          { defId: 'op09', star: 1, cell: { col: 3, row: 4 } },
        ],
        [tank(6, 4)],
        [gold, 0],
      );
      const closure = unit('op44');
      cast(state, closure);
      return collectMods(state, unit('op09')).attackDamageBp;
    };
    const poor = run(0);
    const rich = run(100);
    expect(poor, '2 星基础 = +15%').toBe(1500);
    expect(rich, '★ 100 金 = 封顶 +5% ⇒ +20%').toBe(2000);
  });
});

describe('★ 0.2 可露希尔 3 星 Q.E.D', () => {
  const pulseOf = (): Record<string, unknown> => {
    const buff = effectOf(CLOSURE, 'buff', 3) as Extract<SkillEffect, { kind: 'buff' }>;
    return buff.stats.pulse as unknown as Record<string, unknown>;
  };

  it('数据：攻速 +50%、每 0.5 秒一跳、半径 = 她的射程、第 9 跳后换 180%', () => {
    const buff = effectOf(CLOSURE, 'buff', 3) as Extract<SkillEffect, { kind: 'buff' }>;
    expect(buff.stats.attackSpeedBp).toBe(5000);
    const pulse = pulseOf();
    expect(pulse.intervalTicks).toBe(10);
    expect(pulse.radius, '她的基础射程是 3').toBe(3);
    expect(pulse.affect).toBe('enemies');
    // ★ 万分比口径：120% = 12000、180% = 18000（写成 1200/1800 就只有 1/10 伤害）
    expect((pulse.damage as { ratioBp: number }).ratioBp, '120%').toBe(12000);
    expect(pulse.rampAfterHits).toEqual({ hits: 9, ratioBp: 18000 });
    expect(pulse.pulseDebuffOnce).toEqual({ stats: { attackSpeedBp: -5000 }, durationTicks: s(5) });
  });

  it('★ 真实结算：第 10 跳开始伤害变成 1.5 倍，而且计数是"全局跳数"', () => {
    const { state, unit } = board([{ defId: 'op44', star: 3, cell: { col: 4, row: 4 } }], [dummy(5, 4)]);
    const closure = unit('op44');
    cast(state, closure);
    const target = unit('mn_duholy');
    const atk = closure.attackDamage;

    // 6 秒 = 120 tick = 12 跳；只收 `attackType: 'spell'` 的（普攻是 'attack'）
    const perPulse: number[] = [];
    for (let i = 0; i < s(6); i++) {
      const before = state.log.length;
      step(state, UNIT_DEFS);
      const amount = state.log
        .slice(before)
        .reduce(
          (sum, e) =>
            e.type === 'damage' &&
            e.sourceId === closure.id &&
            e.targetId === target.id &&
            e.attackType === 'spell'
              ? sum + e.amount
              : sum,
          0,
        );
      if (amount > 0) perPulse.push(amount);
    }
    expect(perPulse.length, '6 秒应该跳 12 次').toBe(12);
    // 前 9 跳是 120%，第 10 跳起是 180%（数字直接和面板对上：惰性靶子不打折）
    for (let i = 0; i < 9; i++) {
      expect(perPulse[i], `第 ${i + 1} 跳 = 攻击力的 120%`).toBe(Math.floor((atk * 12000) / 10000));
    }
    expect(perPulse[9], '第 10 跳换成 180%').toBe(Math.floor((atk * 18000) / 10000));
    expect(perPulse[11], '之后一直保持 180%').toBe(perPulse[9]);
    // 顺带钉住"1.5 倍"这个关系本身（换攻击力数值也不会失效）
    expect(perPulse[9]! / perPulse[0]!).toBeCloseTo(1.5, 2);
  });

  it('★ 计数是"全局跳数"：场上 3 个敌人也只按跳数算，不会一次跳涨 3 点', () => {
    const { state, unit } = board(
      [{ defId: 'op44', star: 3, cell: { col: 4, row: 4 } }],
      [dummy(5, 4), dummy(6, 4), dummy(5, 3)],
    );
    const closure = unit('op44');
    cast(state, closure);
    for (let i = 0; i < s(2); i++) step(state, UNIT_DEFS);
    expect(closure.skill!.pulseHits, '2 秒 = 4 跳（不是 4 跳 × 3 个敌人）').toBe(4);
  });

  it('★ 攻速减益"每个目标仅生效一次"（名单记在施法者身上，不会每跳刷一遍）', () => {
    const { state, unit } = board([{ defId: 'op44', star: 3, cell: { col: 4, row: 4 } }], [dummy(5, 4)]);
    const closure = unit('op44');
    const target = unit('mn_duholy');
    cast(state, closure);
    for (let i = 0; i < s(3); i++) step(state, UNIT_DEFS);

    expect(closure.skill!.pulseDebuffed, '★ 只记一次').toEqual([target.id]);
  });
});

// ============================================================
// 量纲守卫：`power` 是千分比（百分数 = power / 10）
// ============================================================

describe('★ 0.2 量纲：`power` 千分比（望的陷阱 / 魔王的持续治疗）', () => {
  /*
    【为什么单独一组？】0.2 在这两个干员身上**同一种错各犯了一次**：
    把**万分比**的数字写进了 `power`（千分比）字段 ⇒ 伤害 / 治疗直接 ×10。
    这种错不报错、不崩、单测也测不出来（那些测试只断言"机制有没有生效"），
    只有拿着策划表的百分比逐格对账才会露出来 —— 所以这里既钉数值、也放一条绊线。

    ★ 换算：`power` 是千分比 ⇒ **百分数 = power / 10**（200% ⇒ 2000）。
      容易算错，参照这批已核对过的兄弟条目：
        陈·赤霄 `[1500,1800,2300]` = 150%/180%/230%；
        妮芙·斥力 `[900,950,1050]` = 90%/95%/105%；
        古米·应急口粮 `[250,300,500]` = 25%/30%/50%。
  */
  const trapsOf = (name: string, star: number): Extract<SkillEffect, { kind: 'trap' }>[] => {
    const def = byName(name);
    return skillVariantOf(def, star).effects.filter((e) => e.kind === 'trap') as Extract<
      SkillEffect,
      { kind: 'trap' }
    >[];
  };

  it('望：两枚棋子各 200%/300%/300%，3 星 7 枚 400%', () => {
    expect(trapsOf('望', 1).map((t) => t.power)).toEqual([
      [2000, 3000, 3000],
      [2000, 3000, 3000],
    ]);
    // 3 星是单枚、`power` 写的是标量（不是星级数组）
    expect(trapsOf('望', 3).map((t) => t.power)).toEqual([4000]);
  });

  it('魔王 3 星的持续治疗：每秒 500% 攻击力', () => {
    const hot = skillVariantOf(byName('魔王'), 3).effects.find((e) => e.kind === 'healOverTime') as
      | Extract<SkillEffect, { kind: 'healOverTime' }>
      | undefined;
    expect(hot, '魔王 3 星是"全体持续回血"').toBeDefined();
    expect(hot!.power, '500% = 千分比 5000').toBe(5000);
  });

  it('绊线：陷阱 / 持续治疗的 power 不超过 10000（= 1000%）', () => {
    /*
      这条拦的是**量纲事故**，不是平衡规则。
      真有一条设计上超过 1000% 的，把阈值抬高并在注释里写清是谁、为什么。
    */
    const LIMIT = 10_000; // 千分比 = 1000%
    const offenders: string[] = [];
    for (const def of Object.values(UNIT_DEFS)) {
      for (const star of [1, 2, 3]) {
        for (const effect of skillVariantOf(def, star).effects) {
          if (effect.kind !== 'trap' && effect.kind !== 'healOverTime') continue;
          const values = Array.isArray(effect.power) ? effect.power : [effect.power];
          for (const value of values) {
            if (value > LIMIT) offenders.push(`${def.name} ${star} 星 ${effect.kind} = ${value}（${value / 10}%）`);
          }
        }
      }
    }
    expect(offenders, '这些 power 大得不像千分比，八成又按万分比写了').toEqual([]);
  });
});
