/**
 * ============================================================
 *  「技能释放期间无法回复技能值」（你要求的规则）
 * ============================================================
 *
 * 【为什么这条规则值得测？】
 * 因为它把"大招流"从无限循环拉回到了有限循环：
 *   没有这条规则时 —— 技能持续 10 秒、期间照常攒蓝，
 *   技能一结束法力又满了，于是**大招永远开着**，别的棋子没法打。
 *   有这条规则时 —— 一个技能真正占掉的就是它自己的持续时间，
 *   强度上限 = 技能时长 / 攒蓝速度，可预期也好调。
 *
 * 而且它只有一处实现（`gainMana` 是**所有**回蓝路径的唯一入口：
 * 攻击回复、受击回复、自动回复、技能自回蓝），所以这里测的就是那条闸门本身。
 */
import { describe, expect, it } from 'vitest';
import {
  FIX,
  ITEM_DEFS,
  MAX_BATTLE_TICKS,
  UNIT_DEFS,
  addBuff,
  createBattle,
  gainMana,
  isSkillActive,
  type BattleState,
  type UnitState,
} from '../src/index.js';

function makeBattle(): { state: BattleState; unit: UnitState; ally: UnitState; enemy: UnitState } {
  const ids = Object.keys(UNIT_DEFS).sort();
  const state = createBattle(
    UNIT_DEFS,
    [
      {
        team: 0,
        units: [
          { defId: ids[0]!, star: 1, cell: { col: 4, row: 4 } },
          { defId: ids[1]!, star: 1, cell: { col: 3, row: 4 } },
        ],
      },
      { team: 1, units: [{ defId: ids[0]!, star: 1, cell: { col: 5, row: 4 } }] },
    ],
    99,
  );
  const mine = state.units.filter((unit) => unit.team === 0);
  return {
    state,
    unit: mine[0]!,
    ally: mine[1]!,
    enemy: state.units.find((unit) => unit.team === 1)!,
  };
}

describe('★ 技能生效期间不回法力', () => {
  it('没有技能效果时，正常回蓝', () => {
    const { state, unit } = makeBattle();
    unit.mana = 0;
    expect(isSkillActive(state, unit), '开局没有任何技能效果').toBe(false);
    gainMana(state, unit, 200);
    expect(unit.mana).toBe(200);
  });

  it('★ 自己身上的技能效果还在 -> 一点法力都回不了', () => {
    const { state, unit } = makeBattle();
    unit.mana = 0;
    // 模拟"放了一个持续 100 tick 的自身增益"
    addBuff(unit, { stats: { attackDamageBp: 5000 }, ticksLeft: 100, sourceId: unit.id });

    expect(isSkillActive(state, unit)).toBe(true);
    gainMana(state, unit, 500);
    expect(unit.mana, '技能生效期间不该攒蓝').toBe(0);

    // 自动回复走的是同一个入口，所以也一样被挡住
    unit.manaSource = 'auto';
    unit.manaPerSecond = 1000;
    gainMana(state, unit, 1000);
    expect(unit.mana, '自动回复也该被挡住').toBe(0);
  });

  it('技能效果过期（ticksLeft 归零）之后立刻能回蓝', () => {
    const { state, unit } = makeBattle();
    unit.mana = 0;
    const buff = { stats: { attackDamageBp: 5000 }, ticksLeft: 2, sourceId: unit.id };
    addBuff(unit, buff);
    gainMana(state, unit, 300);
    expect(unit.mana, '生效中，回不了').toBe(0);

    // 手动把它跑到过期（真实战斗里由 tickSkill 每 tick 递减）
    buff.ticksLeft = 0;
    expect(isSkillActive(state, unit), '过期之后就不算生效了').toBe(false);
    gainMana(state, unit, 300);
    expect(unit.mana, '过期之后应该能正常回蓝').toBe(300);
  });

  it('给队友上的增益也算"自己的技能还在生效"（支援类技能同理）', () => {
    const { state, unit, ally } = makeBattle();
    unit.mana = 0;
    // 施法者是 unit，但 buff 挂在队友身上
    addBuff(ally, { stats: { attackSpeedBp: 2500 }, ticksLeft: 200, sourceId: unit.id });

    expect(isSkillActive(state, unit), '自己给出去的 buff 还在，就算技能还在生效').toBe(true);
    gainMana(state, unit, 400);
    expect(unit.mana).toBe(0);
  });

  it('别人技能的效果不该挡住我回蓝', () => {
    const { state, unit, ally } = makeBattle();
    unit.mana = 0;
    // 队友给我上了一个 buff：施法者是 ally，不是我
    addBuff(unit, { stats: { attackDamageBp: 3000 }, ticksLeft: 200, sourceId: ally.id });

    expect(isSkillActive(state, unit), '这不是我放的技能，不该算我技能生效').toBe(false);
    gainMana(state, unit, 250);
    expect(unit.mana, '被队友 buff 的期间我应该照常攒蓝').toBe(250);
  });

  it('法力不会超过上限（闸门没有把上限逻辑搞坏）', () => {
    const { state, unit } = makeBattle();
    unit.mana = 0;
    gainMana(state, unit, 999999);
    expect(unit.mana).toBeLessThanOrEqual(1000);
  });

  it('技能生效期间的"技能自回蓝"也挡得住（同一个入口）', () => {
    const { state, unit } = makeBattle();
    unit.mana = 0;
    addBuff(unit, { stats: { hpFlat: 100 * FIX }, ticksLeft: 50, sourceId: unit.id });
    // gainMana 特效（某些技能会给自己回蓝）
    gainMana(state, unit, 400);
    expect(unit.mana).toBe(0);
  });

  /*
    ★★ 0.0.3 末：用户报的"角色装备藏品后无法回复技能"。

    【根因】createBattle 给每件穿戴藏品挂一个**永久属性包**
    （addBuff(..., ticksLeft: FOREVER_TICKS, sourceId: 自己)），
    而 isSkillActive 的判据是"场上有没有我给的、还没到期的修正包" ——
    于是穿过藏品的棋子**永远**处于"技能生效中"，gainMana 一点蓝都不给，
    技能自然再也放不出来。"开局全队免疫 N 次"那条常驻被动也是同一类。
    修法：这类包打上 `passive: true`，闸门跳过它们。
  */
  it('★ 穿戴藏品的常驻属性包不算"技能生效"，不挡回蓝', () => {
    const { state, unit } = makeBattle();
    unit.mana = 0;
    // 和 createBattle 挂藏品属性包完全同一形状：永久 + 来源是自己 + passive
    addBuff(unit, {
      stats: { armorFlat: 15, magicResistFlat: 15 },
      ticksLeft: MAX_BATTLE_TICKS,
      sourceId: unit.id,
      passive: true,
    });

    expect(isSkillActive(state, unit), '常驻被动不该算"技能生效中"').toBe(false);
    gainMana(state, unit, 200);
    expect(unit.mana, '穿着藏品也要能回蓝').toBe(200);
  });

  it('★ 真实链路：createBattle 里穿藏品的棋子能回蓝、能再放技能', () => {
    // 坚守盾牌：A 类、纯属性（armorFlat/magicResistFlat）—— 走的就是那包永久修正包
    const state = createBattle(
      UNIT_DEFS,
      [
        {
          team: 0,
          units: [{ defId: Object.keys(UNIT_DEFS).sort()[0]!, star: 1, cell: { col: 4, row: 4 }, items: ['itm_bulwark'] }],
        },
        { team: 1, units: [{ defId: Object.keys(UNIT_DEFS).sort()[0]!, star: 1, cell: { col: 5, row: 4 } }] },
      ],
      7,
    );
    const unit = state.units.find((item) => item.team === 0)!;
    const itemBuff = unit.skill?.buffs.find((buff) => buff.passive === true);
    expect(itemBuff, '藏品属性包应该挂在身上（passive 标记）').toBeDefined();

    expect(isSkillActive(state, unit), '穿上藏品 ≠ 技能生效中').toBe(false);
    unit.mana = 0;
    gainMana(state, unit, 500);
    expect(unit.mana, '装备藏品后回蓝必须正常').toBe(500);
  });

  /*
    ★★ 用户第二次报的"干员装备藏品时有时技能不再回复"。

    【这次漏的是哪一条？】
    藏品的**开局类**效果（`combat.battleStart`）。奥数法阵是
    "回合开始额外 +10 魔抗，持续 15 秒" —— 它在 createBattle 里走的是
    `applyBattleStartEffect` 的 `case 'buff'`，和技能 buff 同一个形状、
    也没打 passive 标记，于是穿它的干员**开局 15 秒**一点蓝都回不上。
    玩家看到的就是"装了这件藏品，技能不回了"。
    修法：藏品那条路也用 `passive: true` 挂包（技能的**开局效果**不打 ——
    那确实是在"技能生效中"，见下面那条边界用例）。
  */
  it('★ 奥数法阵的开局魔抗包不算"技能生效"：开局就能回蓝，加成照旧', () => {
    const state = createBattle(
      UNIT_DEFS,
      [
        { team: 0, units: [{ defId: 'op38', star: 1, cell: { col: 4, row: 4 }, items: ['itm_arcane_array'] }] },
        { team: 1, units: [{ defId: 'op38', star: 1, cell: { col: 5, row: 4 } }] },
      ],
      7,
    );
    const unit = state.units.find((item) => item.team === 0)!;

    // 加成不能丢：开局 +10 魔抗那个包还在（300 tick = 15 秒）
    const startBuff = unit.skill?.buffs.find((buff) => buff.stats.magicResistFlat === 10);
    expect(startBuff, '奥数法阵的开局 +10 魔抗包应该挂在身上').toBeDefined();
    expect(startBuff!.ticksLeft).toBeGreaterThan(0);

    expect(isSkillActive(state, unit), '藏品的开局包不是"技能生效"').toBe(false);
    unit.mana = 0;
    gainMana(state, unit, 300);
    expect(unit.mana, '穿了奥数法阵，开局也要能回蓝').toBe(300);
  });

  it('★ 全藏品体检：给任何一件藏品，都不该让干员回不了蓝', () => {
    // 三种回蓝方式各挑一个代表（攻击回复 / 受击回复 / 自动回复）
    const wearers = ['op01', 'op03', 'op38'];
    const broken: string[] = [];
    for (const wearerId of wearers) {
      for (const itemId of Object.keys(ITEM_DEFS)) {
        const item = ITEM_DEFS[itemId]!;
        const isWearable = item.slot === 'A';
        const state = createBattle(
          UNIT_DEFS,
          [
            {
              team: 0,
              units: [{ defId: wearerId, star: 1, cell: { col: 4, row: 4 }, ...(isWearable ? { items: [itemId] } : {}) }],
              ...(isWearable ? {} : { sharedItems: [itemId] }),
            },
            { team: 1, units: [{ defId: 'op01', star: 3, cell: { col: 5, row: 4 } }] },
          ],
          12345,
        );
        const unit = state.units.find((u) => u.team === 0 && u.defId === wearerId)!;
        unit.mana = 0;
        const blocked = isSkillActive(state, unit);
        gainMana(state, unit, 200);
        if (blocked || unit.mana === 0) broken.push(`${wearerId} + ${itemId}`);
      }
    }
    expect(broken, '这些"棋手 + 藏品"的组合回不了蓝').toEqual([]);
  });

  it('★ 边界：干员自己技能的"开局效果"依旧算技能生效中（别一刀切）', () => {
    // 玛恩纳 3 星：开局立刻开启技能并持续 100 秒 —— 这确实是在"技能生效中"
    const state = createBattle(
      UNIT_DEFS,
      [
        { team: 0, units: [{ defId: 'op47', star: 3, cell: { col: 4, row: 4 } }] },
        { team: 1, units: [{ defId: 'op02', star: 1, cell: { col: 5, row: 4 } }] },
      ],
      7,
    );
    const unit = state.units.find((item) => item.team === 0)!;
    unit.mana = 0;
    expect(isSkillActive(state, unit), '技能自己的开局效果仍算生效中').toBe(true);
    gainMana(state, unit, 300);
    expect(unit.mana).toBe(0);
  });
});
