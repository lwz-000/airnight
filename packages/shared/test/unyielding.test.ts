/**
 * ============================================================
 *  ★ 0.2 新羁绊「不屈」：阵亡时有概率站起来
 * ============================================================
 *
 * 【规则（用户 2026-10-17 口径）】
 *   人数 2/3/5 ⇒ 阵亡时 30%/40%/50% 概率复活；
 *   复活后攻速 +20%/+40%/+60%，并**立刻释放一次技能**。
 *   ★★ 有「必定复活」的藏品（M3 茧甲）时**优先判藏品**，不屈当兜底。
 *
 * 【这一组怎么测"概率"？】
 * 概率本身没法断言，但**骰子是可以钉死的** —— `state.rng.nextInt` 是对象上的方法，
 * 测试里直接替换成"永远掷 0"（必定成功）或"永远掷 9999"（必定失败），
 * 于是两条分支都变成确定性的，比跑几百场去数频率稳得多。
 *
 * 【为什么还要单独钉"茧甲优先"？】
 * 因为两条复活来源都写在 `killUnit` 里，谁先判是靠代码顺序保证的 ——
 * 顺序被谁调整一下，症状是"带茧甲的人不屈永远不触发"或者"一次死两条命都交了"，
 * 而且只有真去看画面/日志才发现。
 */
import { describe, expect, it } from 'vitest';
import {
  ITEM_DEFS,
  MANA_MAX,
  RELIC_ITEM_OF_TRAIT,
  TRAIT_DEFS,
  UNIT_DEFS,
  UNYIELDING_CHANCE_DECAY_BP,
  computeActiveTraitLevels,
  computeTraitBonuses,
  computeUnitTraitBonuses,
  createBattle,
  dealDamage,
  resolveUnitMechanics,
  step,
  type BattleState,
  type TeamSetup,
  type UnitDefTable,
  type UnitPlacement,
} from '../src/index.js';

function place(defId: string, col: number, row: number, items?: string[]): UnitPlacement {
  return { defId, star: 1, cell: { col, row }, ...(items ? { items } : {}) };
}

/** 四个字段都要填，羁绊机制才会真的挂到棋子身上 */
function team(teamId: 0 | 1, units: UnitPlacement[], defs: UnitDefTable = UNIT_DEFS): TeamSetup {
  return {
    team: teamId,
    units,
    traitBonuses: computeTraitBonuses(units, defs, TRAIT_DEFS),
    unitTraitBonuses: computeUnitTraitBonuses(units, defs, TRAIT_DEFS),
    activeTraits: computeActiveTraitLevels(units, defs, TRAIT_DEFS),
    unitMechanics: resolveUnitMechanics(units, defs, TRAIT_DEFS),
  };
}

/** 不屈 2 人档：砾（op19）+ 耀骑士临光（op41）；对面放个不会动手的靶子 */
function battle(opts: { defs?: UnitDefTable; items?: string[]; seed?: number } = {}): BattleState {
  const defs = opts.defs ?? UNIT_DEFS;
  return createBattle(
    defs,
    [
      team(0, [place('op19', 3, 4, opts.items), place('op41', 3, 5)], defs),
      team(1, [place('op13', 7, 4)], defs),
    ],
    opts.seed ?? 20261017,
  );
}

/** 把骰子钉死：0 = 必定成功，9999 = 必定失败 */
function fixDice(state: BattleState, value: number): void {
  state.rng.nextInt = () => value;
}

function unitOf(state: BattleState, defId: string) {
  return state.units.find((unit) => unit.defId === defId)!;
}

/** 一发必死的真实伤害 */
function kill(state: BattleState, victim: ReturnType<typeof unitOf>, attackerDefId = 'op41'): void {
  const attacker = state.units.find((unit) => unit.defId === attackerDefId)!;
  dealDamage(state, attacker, victim, victim.maxHp * 2, 'true', 'attack');
}

// ============================================================
//  数据契约
// ============================================================

describe('★ 不屈：数据表', () => {
  it('★ 档位 2/3/5，概率 30/40/50%，攻速 +20/40/60%', () => {
    const def = TRAIT_DEFS['unyielding']!;
    expect(def.name).toBe('不屈');
    expect(def.tiers.map((tier) => tier.count)).toEqual([2, 3, 5]);

    const numbers = def.tiers.map((tier) => tier.mechanics?.[0]);
    expect(numbers).toEqual([
      { kind: 'unyielding', chanceBp: 3000, attackSpeedBp: 2000 },
      { kind: 'unyielding', chanceBp: 4000, attackSpeedBp: 4000 },
      { kind: 'unyielding', chanceBp: 5000, attackSpeedBp: 6000 },
    ]);
    // 一点属性都不加（全是战斗中的机制）
    for (const tier of def.tiers) expect(tier.effects).toEqual([]);
  });

  it('★ 概率递减量是 10 个百分点（全局常量，改档位不用改这里）', () => {
    expect(UNYIELDING_CHANCE_DECAY_BP, '每复活一次 -10%').toBe(1000);
  });

  it('★ 成员就是砾 / 耀骑士临光 / 伊内丝，一个不多一个不少', () => {
    const members = Object.values(UNIT_DEFS)
      .filter((def) => (def.traits ?? []).includes('unyielding'))
      .map((def) => def.id)
      .sort();
    /*
      ★ 0.2 追加：若叶睦（op51）也带「不屈」—— 不过她的锁血是**必定触发的一次性被动**
      （`defyDeath`），不是这条概率不屈。所以这里只钉"她也算这个羁绊的成员"。
    */
    expect(members).toEqual(['op19', 'op36', 'op41', 'op51']);
  });

  it('★ 有转职藏品（5 人档只有 3 个成员，没有转职就永远凑不齐）', () => {
    // 转职藏品是跟着羁绊表**自动生成**的，这里钉的是"它真的被生成了"
    const relicId = RELIC_ITEM_OF_TRAIT['unyielding'];
    expect(relicId, '★ 不屈必须有转职藏品').toBeTruthy();
    const relic = ITEM_DEFS[relicId!];
    expect(relic, '★ 而且要真的进了藏品表').toBeTruthy();
    expect(relic!.name).toBe('不屈转职');
    expect(relic!.grantsTrait).toBe('unyielding');
  });
});

// ============================================================
//  复活本身
// ============================================================

describe('★★ 不屈：阵亡时掷骰', () => {
  it('★★ 掷成功 -> 满血站起来 + 攻速 +20% + 法力灌满 + 这一帧就行动', () => {
    const state = battle();
    const victim = unitOf(state, 'op19');
    // 前提：这个羁绊真的挂到它身上了
    expect(
      victim.trait?.mechanics?.some((m) => m.kind === 'unyielding'),
      '前提：不屈的机制要在它身上',
    ).toBe(true);

    const speedBefore = victim.attackSpeed;
    const tickBefore = state.tick;
    fixDice(state, 0); // 必定成功

    kill(state, victim);

    expect(victim.dead, '★ 站起来了').toBe(false);
    expect(victim.hp, '★ 满血').toBe(victim.maxHp);
    expect(victim.attackSpeed, '★ 攻速 +20%（2 人档）').toBe(
      Math.floor((speedBefore * 12000) / 10000),
    );
    expect(victim.mana, '★ 法力灌满 = 下一帧就会放技能').toBe(MANA_MAX);
    expect(victim.nextActionTick, '★ 这一帧就该行动').toBeLessThanOrEqual(tickBefore);
    expect(
      state.log.some((event) => event.type === 'rebirth' && event.unitId === victim.id),
      '★ 要发一条 rebirth 事件，界面才知道"它站起来了"',
    ).toBe(true);
  });

  it('★ 掷失败 -> 正常死亡（不会赖着不死）', () => {
    const state = battle();
    const victim = unitOf(state, 'op19');
    fixDice(state, 9999); // 必定失败

    kill(state, victim);

    expect(victim.dead).toBe(true);
    expect(victim.hp).toBe(0);
    expect(
      state.log.some((event) => event.type === 'death' && event.unitId === victim.id),
      '★ 正常死亡要发 death 事件',
    ).toBe(true);
  });

  it('★★ 每次死都掷，但每成功一次概率 -10%（2 人档最多站起来 3 次）', () => {
    /*
      用户口径：「改成每次死都掷，但是加一个限制，每复活一次复活概率 -10%」。
      2 人档是 30% ⇒ 30 / 20 / 10 / 0，所以第 4 次死必须真死。
      ★ 骰子钉成 0（永远"掷成功"），这样能站几次就完全由**概率递减**决定 ——
        如果递减逻辑被删掉，它就会一直站着（无限复活），这条会立刻红。
    */
    const state = battle();
    const victim = unitOf(state, 'op19');
    fixDice(state, 0);

    const expected = [3000, 2000, 1000]; // 每次掷骰用的概率（递减 10 个百分点）
    const speedBefore = victim.attackSpeed;
    for (let i = 0; i < expected.length; i++) {
      kill(state, victim);
      expect(victim.dead, `第 ${i + 1} 次死：概率 ${expected[i]! / 100}%，应该站起来`).toBe(false);
      expect(victim.statuses['unyieldingRevives'], '记一次成功').toBe(i + 1);
    }

    // 第 4 次：概率已经降到 0，不再掷骰 ⇒ 真死
    kill(state, victim);
    expect(victim.dead, '★ 概率归零之后必须真死').toBe(true);
    expect(victim.statuses['unyieldingRevives'], '第 4 次不该再加').toBe(3);

    // 攻速是"每复活一次叠一次"：base × 1.2³
    let speed = speedBefore;
    for (let i = 0; i < 3; i++) speed = Math.floor((speed * 12000) / 10000);
    expect(victim.attackSpeed, '★ 站起来三次就叠三次').toBe(speed);
  });

  it('★ 概率确实在递减：骰子固定在 25% 时，只有第一次（30%）能成功', () => {
    /*
      这条不靠"永远掷成功"，而是把骰子钉在一个**中间值**上：
        · 第 1 次：概率 30% > 25% ⇒ 站起来
        · 第 2 次：概率 20% < 25% ⇒ 站不起来
      递减一旦失效（第 2 次还是 30%），第二条断言就会红。
    */
    const state = battle();
    const victim = unitOf(state, 'op19');
    fixDice(state, 2500);

    kill(state, victim);
    expect(victim.dead, '第一次 30% > 25% ⇒ 站起来').toBe(false);

    kill(state, victim);
    expect(victim.dead, '★ 第二次只剩 20% < 25% ⇒ 站不起来').toBe(true);
  });

  it('★ 3 人档（40%）能站 4 次 —— 档位越高上限越高', () => {
    const state = createBattle(
      UNIT_DEFS,
      [
        team(0, [place('op19', 3, 4), place('op41', 3, 5), place('op36', 3, 6)]),
        team(1, [place('op13', 7, 4)]),
      ],
      20261017,
    );
    const victim = unitOf(state, 'op19');
    fixDice(state, 0);

    for (let i = 0; i < 4; i++) {
      kill(state, victim);
      expect(victim.dead, `第 ${i + 1} 次死应该站起来`).toBe(false);
    }
    kill(state, victim);
    expect(victim.dead, '★ 40% 档：40/30/20/10 用完之后就真死').toBe(true);
    expect(victim.statuses['unyieldingRevives']).toBe(4);
  });
});

// ============================================================
//  和「必定复活藏品」的优先级
// ============================================================

describe('★★ 不屈 × M3 茧甲（必定复活藏品）', () => {
  it('★★ 第一次死先走茧甲（不屈不被消耗），第二次死才判不屈', () => {
    /*
      用户口径："有必定复活藏品时优先判定藏品复活效果"。
      茧甲是**必定**复活（`unit.reborn`），不屈是**概率**复活 ——
      所以第一次死一定吃茧甲，而且不屈那次判定要**留着**，别一起交掉。
    */
    const state = battle({ items: ['itm_m3_cocoon'] });
    const victim = unitOf(state, 'op19');
    expect(victim.reborn, '前提：茧甲把 reborn 挂上了').toBeTruthy();
    fixDice(state, 9999); // 把不屈的骰子钉成"必定失败"，这样第一次站起来只可能是茧甲

    kill(state, victim);

    expect(victim.dead, '★ 茧甲让它站起来了').toBe(false);
    expect(victim.rebornUsed, '茧甲用掉了').toBe(true);
    expect(
      victim.statuses['unyieldingRevives'],
      '★★ 不屈一次都没用 —— 次数留着给下一次死',
    ).toBeUndefined();

    // 第二次死：茧甲已经用过，轮到不屈（这次把骰子放成必定成功）
    fixDice(state, 0);
    kill(state, victim);
    expect(victim.dead, '★ 不屈接手，又站起来一次').toBe(false);
    expect(victim.statuses['unyieldingRevives']).toBe(1);
  });

  it('★ 没有茧甲时，不屈照常触发（对照组）', () => {
    const state = battle();
    const victim = unitOf(state, 'op19');
    expect(victim.reborn, '前提：没装茧甲就没有 reborn').toBeFalsy();
    fixDice(state, 0);
    kill(state, victim);
    expect(victim.dead).toBe(false);
    expect(victim.statuses['unyieldingRevives']).toBe(1);
  });
});

// ============================================================
//  「立刻释放一次技能」
// ============================================================

describe('★ 不屈：复活后立刻放一次技能', () => {  it('★★ 法力灌满之后，下一帧真的走正常施法流程放了一次', () => {
    /*
      【为什么这里要换一套"测试替身"技能？】
      砾 / 临光 / 伊内丝三个人的技能都是**纯被动**（`effects: []`），
      对它们来说"放一次技能"没有可放的东西 —— 那样测不出这条机制。
      所以这里临时给砾换一个有主动效果的技能，专门验"灌满法力 → 正常施法"这条链。
    */
    const defs: UnitDefTable = {
      ...UNIT_DEFS,
      op19: {
        ...UNIT_DEFS['op19']!,
        skill: {
          ...UNIT_DEFS['op19']!.skill,
          effects: [
            { kind: 'buff', target: 'self', stats: { attackDamageBp: 1000 }, durationTicks: 60 },
          ],
          manaSource: 'attack',
        },
      },
    };
    const state = battle({ defs });
    const victim = unitOf(state, 'op19');
    fixDice(state, 0);

    kill(state, victim);
    expect(victim.mana, '前提：复活后法力是满的').toBe(MANA_MAX);

    const castsBefore = state.log.filter(
      (event) => event.type === 'cast' && event.unitId === victim.id,
    ).length;
    expect(castsBefore, '前提：复活之前它一次都没放过（不然这条测不出因果）').toBe(0);

    // 跑几帧，让它真的行动一次
    for (let i = 0; i < 3; i++) step(state, defs);

    const castsAfter = state.log.filter(
      (event) => event.type === 'cast' && event.unitId === victim.id,
    ).length;
    expect(castsAfter, '★ 复活之后应该真的放了一次技能').toBe(1);
  });

  it('★★ 纯被动棋子：复活后把「开局效果」重新应用一次（砾的护盾刷新）', () => {
    /*
      用户口径：「比如砾复活后护盾可以刷新一次」。

      砾的技能是纯被动（`effects: []` + `battleStart: [护盾, 护甲/魔抗]`）——
      灌满法力没东西可放，所以走"把开局效果再跑一遍"这条路。
      ★ 这里先把旧盾清零，模拟"实战里盾已经被打破了"（不打破就打不死他）；
        然后用真实伤害把他打死（真实伤害不过护盾，正好验证"重新挂上"）。
    */
    const state = battle();
    const victim = unitOf(state, 'op19');
    fixDice(state, 0);
    victim.statuses['shieldValue'] = 0;

    kill(state, victim);
    expect(victim.dead, '前提：站起来了').toBe(false);
    expect(victim.statuses['reviveSkillPending'], '★ 留了"重跑一次开局效果"的标记').toBe(1);

    step(state, UNIT_DEFS); // 下一帧 rules 会把开局效果补上

    expect(
      victim.statuses['reviveSkillPending'],
      '标记要被清掉（不然每帧都会再刷一次盾）',
    ).toBeUndefined();
    // 1 星砾 = 生命上限的 75%（千分比 750）
    const expected = Math.floor((victim.maxHp * 750) / 1000);
    expect(victim.statuses['shieldValue'], '★ 护盾应该重新挂上了').toBe(expected);
  });

  it('★ 没有"开局效果"的纯被动棋子（耀骑士临光）：不报错、标记也清掉', () => {
    // 临光的被动是"队友残血时瞬移给盾"（事件型钩子），没有 battleStart 可补 ——
    // 这种情况必须**安静地什么都不做**，而不是崩掉或让标记卡在那儿每帧重跑。
    const state = battle();
    const victim = unitOf(state, 'op41');
    fixDice(state, 0);

    kill(state, victim);
    expect(victim.dead).toBe(false);
    expect(() => step(state, UNIT_DEFS)).not.toThrow();
    expect(victim.statuses['reviveSkillPending']).toBeUndefined();
  });
});
