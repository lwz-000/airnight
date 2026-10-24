/**
 * ============================================================
 *  藏品（装备）★ 0.0.3 —— 战斗内核端到端
 * ============================================================
 *
 * 【为什么必须单独一组？】
 * 藏品的效果分两半：**属性**（数字不对一眼能看出）和**机制**
 * （失效了代码不报错、战斗照常打完，只是那个效果根本没发生）。
 * 后者才是最危险的 —— 「防爆盾减伤 30%」如果从来没生效，
 * 你只会觉得"这件装备怎么这么弱"，而不是"代码有 bug"。
 *
 * 【为什么用合成棋子 + 真藏品 id？】
 * 棋子的数值是你的设计、会一直改；藏品的 id 和机制是我的代码。
 * 所以：棋子用合成数据（不钉数值），藏品用真 id（钉机制真的跑起来了）。
 * 少数需要"必触发"的场景（20% 概率掉金）会临时塞一件 100% 的测试藏品。
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  FIX,
  ITEM_DEFS,
  TRAIT_DEFS,
  UNIT_DEFS,
  collectMods,
  computeActiveTraitLevels,
  createBattle,
  effectiveAttackDamage,
  gainMana,
  isSkillActive,
  randomAllyBuffPick,
  resolveSharedItems,
  resolveWearerItems,
  spawnedUnitInfo,
  simulate,
  step,
  type ItemDef,
  type SkillDef,
  type TeamSetup,
  type UnitDef,
  type UnitDefTable,
} from '../src/index.js';

// ============================================================
//  测试脚手架
// ============================================================

/** 一个不做事的基础棋子定义（空技能 = 日志里的事件只可能来自藏品） */
function makeDef(id: string, traits: string[] = [], base: Partial<UnitDef['base']> = {}, skill: Partial<SkillDef> = {}): UnitDef {
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
    skill: {
      id: `${id}_skill`,
      name: `${id} 的技能`,
      desc: '测试用',
      effects: [],
      manaSource: 'attack',
      ...skill,
    },
  };
}

function tableOf(defs: UnitDef[]): UnitDefTable {
  const out: UnitDefTable = {};
  for (const def of defs) out[def.id] = def;
  return out;
}

/** 一个上场的棋子（写起来短一点） */
function unit(defId: string, col: number, row = 4, items?: string[]) {
  return { defId, star: 1, cell: { col, row }, items };
}

/**
 * 临时塞一件测试专用的藏品。
 *
 * 【为什么可以这么做？】
 * 因为真实藏品的概率类效果是 20% / 50%，靠"多打几场碰运气"来断言
 * 会变成偶发红点。把概率写成 100% 之后，"机制有没有接上"就是确定的了。
 * afterEach 会把它们删掉，不会污染别的测试。
 */
const TEMP_IDS: string[] = [];
function tempItem(id: string, slot: 'A' | 'B', combat: ItemDef['combat']): string {
  ITEM_DEFS[id] = { id, name: id, rarity: 'normal', slot, icon: id, desc: '测试用', combat };
  TEMP_IDS.push(id);
  return id;
}
afterEach(() => {
  for (const id of TEMP_IDS.splice(0)) delete ITEM_DEFS[id];
});

/** 跑一场战斗，返回"team 0 的第一个棋子一共掉了多少血" */
function damageTakenByDefender(options: {
  wearerItems?: string[];
  sharedItems?: string[];
  attacker?: Partial<UnitDef['base']>;
  attackerCol?: number;
  defenderHp?: number;
  steps?: number;
}): number {
  const defs = tableOf([
    /*
      ★ 沙包必须给一个**够长的射程**：否则它会自己朝敌人走过去（AI 的默认行为），
      距离一缩到 2 格以内，"被远程攻击"这个条件就不成立了 ——
      防爆盾那条用例会莫名其妙地测不出效果（我在这里踩过一次）。
    */
    makeDef('tank', [], { hp: options.defenderHp ?? 100000, armor: 0, range: 5 }),
    makeDef('hitter', [], { attackDamage: 1000, range: 5, ...options.attacker }),
  ]);
  const teams: [TeamSetup, TeamSetup] = [
    {
      team: 0,
      units: [unit('tank', 3, 4, options.wearerItems)],
      sharedItems: options.sharedItems,
    },
    // ★ 队伍 1 必须摆在右半场（col >= TEAM_1_MIN_COL），否则 createBattle 会直接报错
    { team: 1, units: [unit('hitter', options.attackerCol ?? 5)] },
  ];
  const state = createBattle(defs, teams, 4242);
  const tank = state.units[0]!;
  const before = tank.hp;
  const limit = options.steps ?? 400;
  for (let i = 0; i < limit && !state.over; i++) step(state, defs);
  return before - tank.hp;
}

// ============================================================
//  纯函数：A 类的解析
// ============================================================

describe('resolveWearerItems（A 类解析）', () => {
  it('无条件的属性加成会变成一个"属性包"', () => {
    const def = makeDef('x');
    const effects = resolveWearerItems(def, ['itm_solvent']);
    expect(effects.statsList).toHaveLength(1);
    expect(effects.statsList[0]!.attackDamageBp).toBe(1000);
    expect(effects.statsList[0]!.lifestealBp).toBe(1000);
    expect(effects.mechanics).toHaveLength(0);
  });

  it('★ 带羁绊条件的加成要**看装备者有没有那个标签**（炎国短刃）', () => {
    const noTrait = resolveWearerItems(makeDef('a'), ['itm_yan_blade']);
    const withTrait = resolveWearerItems(makeDef('b', ['yan']), ['itm_yan_blade']);
    // 都有基础的 +12%
    expect(noTrait.statsList).toHaveLength(1);
    expect(noTrait.statsList[0]!.attackDamageBp).toBe(1200);
    // 带"炎"的多一个 +8%
    expect(withTrait.statsList).toHaveLength(2);
    expect(withTrait.statsList[1]!.attackDamageBp).toBe(800);
    expect(withTrait.items.map((item) => item.id)).toEqual(['itm_yan_blade']);
  });

  it('★ 带羁绊条件的**机制**同样要过标签这一关（铳骑之威的斩杀）', () => {
    const noTrait = resolveWearerItems(makeDef('a'), ['itm_rider_might']);
    expect(noTrait.mechanics.some((m) => m.kind === 'execute'), '没有拉特兰标签就没有斩杀').toBe(false);

    const withTrait = resolveWearerItems(makeDef('b', ['laterano']), ['itm_rider_might']);
    expect(withTrait.mechanics.some((m) => m.kind === 'execute'), '有拉特兰标签才给斩杀').toBe(true);
  });

  it('机制会带上"来自哪件藏品"的标记', () => {
    const effects = resolveWearerItems(makeDef('x'), ['itm_raid_grenade']);
    expect(effects.mechanics[0]!.traitId).toBe('item_itm_raid_grenade');
  });

  it('技力回复加成累加、复活取第一件、B 类 id 被忽略', () => {
    const two = resolveWearerItems(makeDef('x'), ['itm_ration', 'itm_dormant_spawn']);
    expect(two.manaGainBp).toBe(5000);

    const revive = resolveWearerItems(makeDef('x'), ['itm_m3_cocoon', 'itm_pegasus_helm']);
    expect(revive.revive?.hpBp).toBe(10000);

    const ignored = resolveWearerItems(makeDef('x'), ['itm_treasure_ring', '不存在的藏品']);
    expect(ignored.statsList).toHaveLength(0);
    expect(ignored.items).toHaveLength(0);
  });

  it('什么都没装时返回空效果（不会崩）', () => {
    expect(resolveWearerItems(makeDef('x'), undefined).statsList).toHaveLength(0);
    expect(resolveWearerItems(makeDef('x'), []).mechanics).toHaveLength(0);
  });
});

// ============================================================
//  纯函数：B 类的解析
// ============================================================

describe('resolveSharedItems（B 类解析）', () => {
  // 一个便宜近战 + 一个贵远程：费用条件和射程条件各能筛掉一半
  const defs = tableOf([
    makeDef('cheap', [], { range: 1 }), // cost 1
    { ...makeDef('far', [], { range: 5 }), cost: 4 },
  ]);
  const placements = [
    { defId: 'cheap', star: 1, cell: { col: 0, row: 0 } },
    { defId: 'far', star: 1, cell: { col: 1, row: 0 } },
  ];
  const ctx = { gold: 0, hp: 100 };

  it('★ 费用 ≤N 只发给够便宜的干员（皇帝的恩宠）', () => {
    const effects = resolveSharedItems(['itm_emperor_favor'], placements, defs, ctx);
    expect(effects.unitBonuses['cheap']?.[0]?.effect).toBe('attackDamageBp');
    expect(effects.unitBonuses['far'], '贵的那个不该有').toBeUndefined();
  });

  it('★ 射程 >N 只发给够远的干员（银餐叉）', () => {
    const effects = resolveSharedItems(['itm_silver_fork'], placements, defs, ctx);
    expect(effects.unitBonuses['far']?.[0]?.effect).toBe('attackDamageBp');
    expect(effects.unitBonuses['cheap']).toBeUndefined();
  });

  it('★ 每 N 金币算一层，并且封顶（金酒之杯：每 5 金 +3%，上限 200%）', () => {
    const small = resolveSharedItems(['itm_gin_cup'], placements, defs, { gold: 14, hp: 100 });
    expect(small.teamBonuses[0]!.value, '14 金 -> 2 层 -> 6%').toBe(600);

    const huge = resolveSharedItems(['itm_gin_cup'], placements, defs, { gold: 99999, hp: 100 });
    expect(huge.teamBonuses[0]!.value, '必须被 200% 封顶').toBe(20000);

    const poor = resolveSharedItems(['itm_gin_cup'], placements, defs, { gold: 4, hp: 100 });
    expect(poor.teamBonuses, '一层都没有就什么都不加').toHaveLength(0);
  });

  it('★ 血量低于阈值才生效（皇帝的新枪）', () => {
    const high = resolveSharedItems(['itm_emperor_gun'], placements, defs, { gold: 0, hp: 100 });
    expect(high.teamBonuses).toHaveLength(0);
    const low = resolveSharedItems(['itm_emperor_gun'], placements, defs, { gold: 0, hp: 12 });
    expect(low.teamBonuses.length).toBeGreaterThan(0);
  });

  it('★ 老蒲扇按"激活了几个不同羁绊"放大 —— 这个数必须自己算出来', () => {
    /*
      ★ 这里必须用**真实**的羁绊 id：resolveSharedItems 现算"激活了几个羁绊"时
      读的是真正的 TRAIT_DEFS（刻意不靠调用方传，免得漏传导致静默失效）。
      所以合成一个不存在的 't1' 是数不出来的 —— 那正是这条用例要钉的行为。
    */
    const realTraits = Object.values(TRAIT_DEFS).sort(
      (a, b) => (a.tiers[0]?.count ?? 99) - (b.tiers[0]?.count ?? 99),
    );
    const first = realTraits[0]!;
    const second = realTraits[1]!;
    const need = Math.max(first.tiers[0]!.count, second.tiers[0]!.count);

    const tagged = tableOf([makeDef('tagged', [first.id, second.id])]);
    const taggedPlacements = Array.from({ length: need }, (_, index) => ({
      defId: 'tagged',
      star: 1,
      cell: { col: index, row: 0 },
    }));
    const active = computeActiveTraitLevels(taggedPlacements, tagged).filter((l) => l.tierIndex >= 0);
    expect(active.length, `${first.id} + ${second.id} 都该激活`).toBeGreaterThanOrEqual(2);

    // 刻意不传 traitDefs —— 层数必须由 resolveSharedItems 自己算出来
    const effects = resolveSharedItems(['itm_old_fan'], taggedPlacements, tagged, ctx);
    expect(effects.teamBonuses.length, '有激活的羁绊就该给出加成').toBeGreaterThan(0);
    expect(effects.teamBonuses[0]!.value).toBe(1000 * active.length);
  });

  it('每回合经济汇总（至宝指环 / 幸运硬币）', () => {
    const effects = resolveSharedItems(
      ['itm_treasure_ring', 'itm_lucky_coin'],
      placements,
      defs,
      ctx,
    );
    expect(effects.perRound.gold).toBe(1);
    expect(effects.perRound.goldOnLossStreak).toBe(1);
  });

  it('队伍级机制会被标上来源，A 类 id 被忽略', () => {
    const effects = resolveSharedItems(['itm_medkit'], placements, defs, ctx);
    expect(effects.teamMechanics[0]!.kind).toBe('teamRegen');
    expect(effects.teamMechanics[0]!.traitId).toBe('item_itm_medkit');

    expect(resolveSharedItems(['itm_solvent'], placements, defs, ctx).teamMechanics).toHaveLength(0);
  });
});

// ============================================================
//  内核：A 类的属性 / 机制真的生效
// ============================================================

describe('内核：A 类藏品的属性', () => {
  const defs = tableOf([makeDef('me', ['yan'])]);

  /** 同一个棋子"带 / 不带藏品"两种开战状态 */
  function withItems(items?: string[]) {
    return createBattle(defs, [{ team: 0, units: [unit('me', 3, 4, items)] }, { team: 1, units: [] }], 7);
  }

  it('★ 生命上限 +200（M3 茧甲）', () => {
    expect(withItems().units[0]!.maxHp).toBe(1000 * FIX);
    const worn = withItems(['itm_m3_cocoon']);
    expect(worn.units[0]!.maxHp).toBe(1200 * FIX);
    expect(worn.units[0]!.hp, '开局要按新上限把血补满').toBe(1200 * FIX);
  });

  it('★ 攻击力 +10%（源石溶剂）', () => {
    const plain = withItems();
    const worn = withItems(['itm_solvent']);
    const plainAtk = effectiveAttackDamage(plain.units[0]!, collectMods(plain, plain.units[0]!));
    const wornAtk = effectiveAttackDamage(worn.units[0]!, collectMods(worn, worn.units[0]!));
    expect(wornAtk).toBeGreaterThan(plainAtk);
  });

  it('★ 羁绊条件加成：带"炎"的棋子才吃到那额外的 8%', () => {
    const both: UnitDefTable = { ...defs, plain: makeDef('plain', []) };
    const yanTeam: TeamSetup = { team: 0, units: [unit('me', 3, 4, ['itm_yan_blade'])] };
    const plainTeam: TeamSetup = { team: 0, units: [unit('plain', 3, 4, ['itm_yan_blade'])] };
    const yanState = createBattle(both, [yanTeam, { team: 1, units: [] }], 7);
    const plainState = createBattle(both, [plainTeam, { team: 1, units: [] }], 7);

    const yanBp = collectMods(yanState, yanState.units[0]!).attackDamageBp;
    const plainBp = collectMods(plainState, plainState.units[0]!).attackDamageBp;
    expect(yanBp).toBe(2000); // 12% + 8%
    expect(plainBp).toBe(1200); // 只有 12%
  });

  /*
    ★★ 0.3.2 修（用户报"描述和效果不一致"）：
    迅捷作战粮的卡面写的是"攻击 / 受击 / 技能**回复量** +50%"，
    以前数据里写成 `healingBp`（治疗量），效果完全跑偏。现在是技力回复。
  */
  it('★★ 迅捷作战粮：写的是「技力回复」不是「治疗」', () => {
    const worn = withItems(['itm_ration']);
    expect(worn.units[0]!.statuses['manaGainBonusBp']).toBe(5000);
    expect(worn.units[0]!.statuses['healingBonusBp'], '别再挂到治疗上').toBeUndefined();
  });

  it('★★ 装了迅捷作战粮：`gainMana` 真的多给 50%（三条回蓝路共用的唯一入口）', () => {
    const plain = withItems();
    const worn = withItems(['itm_ration']);
    const plainUnit = plain.units[0]!;
    const wornUnit = worn.units[0]!;
    // 从 0 开始各给 100 点，比较最终到手多少（受 MANA_MAX 夹取）
    gainMana(plain, plainUnit, 100);
    gainMana(worn, wornUnit, 100);
    expect(plainUnit.mana).toBe(100);
    expect(wornUnit.mana, '100 × 1.5 = 150').toBe(150);
  });

  it('★ 复活挂上 reborn（M3 茧甲），而且不是野怪那套共享状态', () => {
    const worn = withItems(['itm_m3_cocoon']);
    expect(worn.units[0]!.reborn?.hpBp).toBe(10000);
    expect(worn.units[0]!.rebornUsed).toBe(false);
    expect(withItems().units[0]!.reborn, '没装就没有').toBeUndefined();
  });

  it('★ 开局效果真的挂上去了（奥数法阵：20 点常驻 + 开局额外 10 点）', () => {
    const worn = withItems(['itm_arcane_array']);
    // 注意：Mods 里的护甲/魔抗是**内部单位**（面板值 × FIX），不是面板值
    expect(collectMods(worn, worn.units[0]!).magicResistFlat).toBe(30 * FIX);
  });

  it('★ 远程减伤被注册进修正包（防爆盾）', () => {
    const worn = withItems(['itm_blast_shield']);
    expect(collectMods(worn, worn.units[0]!).farAttackReduction).toEqual({ minDistance: 2, ratioBp: 3000 });
  });
});

// ============================================================
//  内核：A 类的机制真的跑起来
// ============================================================

describe('内核：A 类藏品的机制', () => {
  it('★ 防爆盾：被远距离攻击时真的少掉血', () => {
    const far = { attackerCol: 6 }; // 距离 3 格，超过"2 格以上"这条线
    const plain = damageTakenByDefender({ defenderHp: 100000, ...far, steps: 60 });
    const shielded = damageTakenByDefender({ defenderHp: 100000, wearerItems: ['itm_blast_shield'], ...far, steps: 60 });
    expect(plain, '先确认真的挨打了').toBeGreaterThan(0);
    expect(shielded, '减伤之后必须明显更少').toBeLessThan(plain);
  });

  it('护甲加成真的进到战斗中（坚守盾牌 +15 护甲）', () => {
    const plain = damageTakenByDefender({ defenderHp: 100000, steps: 60 });
    const armored = damageTakenByDefender({ defenderHp: 100000, wearerItems: ['itm_bulwark'], steps: 60 });
    expect(armored).toBeLessThan(plain);
  });

  it('★ 突袭手雷：每 3 击给自己挂一个"下一击 +70%"的包', () => {
    const defs = tableOf([
      makeDef('me', [], { attackDamage: 100, range: 1, hp: 100000 }),
      makeDef('target', [], { hp: 100000, armor: 0 }),
    ]);
    const state = createBattle(
      defs,
      [
        { team: 0, units: [unit('me', 3, 4, ['itm_raid_grenade'])] },
        { team: 1, units: [unit('target', 5, 4)] },
      ],
      99,
    );

    let boosted = false;
    for (let i = 0; i < 900 && !state.over; i++) {
      step(state, defs);
      if (state.units[0]!.skill!.buffs.some((buff) => buff.stats.attackDamageBp === 7000)) {
        boosted = true;
        break;
      }
    }
    expect(boosted, '打了 3 下之后必须出现那个强化包').toBe(true);
  });

  it('★ 击杀掉金：概率拉满时必须产生一条 gold 事件（数值和来源都对）', () => {
    const itemId = tempItem('itm_test_gold_kill', 'A', {
      mechanics: [{ kind: 'goldOnKill', chanceBp: 10000, gold: 7 }],
    });
    const defs = tableOf([
      makeDef('killer', [], { attackDamage: 100000, range: 1 }),
      makeDef('victim', [], { hp: 10 }),
    ]);
    const state = createBattle(
      defs,
      [
        { team: 0, units: [unit('killer', 3, 4, [itemId])] },
        { team: 1, units: [unit('victim', 5, 4)] },
      ],
      5,
    );
    for (let i = 0; i < 400 && !state.over; i++) step(state, defs);

    const gold = state.log.filter((event) => event.type === 'gold');
    expect(gold.length, '击杀必须有掉金事件').toBeGreaterThan(0);
    expect(gold[0]!.amount).toBe(7);
    expect(gold[0]!.reason).toBe('kill');
    expect(gold[0]!.team).toBe(0);
  });

  it('★ 阵亡掉金：同样走 gold 事件（黄沙罗盘那条路）', () => {
    const itemId = tempItem('itm_test_gold_death', 'A', {
      mechanics: [{ kind: 'goldOnDeath', chanceBp: 10000, gold: 3 }],
    });
    const defs = tableOf([
      makeDef('weak', [], { hp: 10, attackDamage: 1, range: 1 }),
      makeDef('brute', [], { attackDamage: 100000, range: 1, hp: 100000 }),
    ]);
    const state = createBattle(
      defs,
      [
        { team: 0, units: [unit('weak', 3, 4, [itemId])] },
        { team: 1, units: [unit('brute', 5, 4)] },
      ],
      5,
    );
    for (let i = 0; i < 400 && !state.over; i++) step(state, defs);

    const gold = state.log.filter((event) => event.type === 'gold');
    expect(gold.length, '阵亡必须有掉金事件').toBeGreaterThan(0);
    expect(gold[0]!.reason).toBe('death');
    expect(gold[0]!.team).toBe(0);
  });

  it('★ 开技能时获得增益（骑士戒律）：放完技能就多一个强化包', () => {
    const defs = tableOf([
      // manaPerAttack 1000 = 打一下就满法力，放一次"什么都不做"的技能
      makeDef('caster', [], { manaPerAttack: 1000, range: 1, hp: 100000, attackDamage: 10 }, {
        effects: [{ kind: 'damage', target: 'nearestEnemy', power: 1, damageType: 'physical' }],
      }),
      makeDef('target', [], { hp: 100000 }),
    ]);
    const state = createBattle(
      defs,
      [
        { team: 0, units: [unit('caster', 3, 4, ['itm_knight_oath'])] },
        { team: 1, units: [unit('target', 5, 4)] },
      ],
      21,
    );

    let sawBuff = false;
    for (let i = 0; i < 900 && !state.over; i++) {
      step(state, defs);
      if (state.units[0]!.skill!.buffs.some((buff) => buff.stats.attackDamageBp === 5000)) {
        sawBuff = true;
        break;
      }
    }
    expect(sawBuff, '开技能后必须挂上 +50% 攻击力的包').toBe(true);
  });

  /*
    ★★ 用户拍板的口径（0.0.3 末）：
      骑士戒律按**藏品效果**算（不参与"技能生效中不攒蓝"那道闸），
      但限制成"10 秒内只触发一次"—— 也就是**不叠加、也不刷新时效**。

    下面两条一起看才有意义：一条钉"不挡回蓝"，一条钉"不叠加"。
    只测前者会因为闸门打开而变成超模（10 秒内连开三次就是 +150%）。
  */
  it('★ 骑士戒律：10 秒内只触发一次 —— 不叠加、也不刷新时效', () => {
    const defs = tableOf([
      // manaPerAttack 1000 = 出手一次就满蓝，所以"出手"频率 ≈ 技能触发频率
      makeDef('caster', [], { manaPerAttack: 1000, range: 1, hp: 100000, attackDamage: 10 }, {
        effects: [{ kind: 'damage', target: 'nearestEnemy', power: 1, damageType: 'physical' }],
      }),
      makeDef('target', [], { hp: 100000 }),
    ]);
    const state = createBattle(
      defs,
      [
        { team: 0, units: [unit('caster', 3, 4, ['itm_knight_oath'])] },
        { team: 1, units: [unit('target', 5, 4)] },
      ],
      21,
    );
    const caster = state.units.find((u) => u.team === 0)!;

    // 用**对象引用**判断"是不是同一个包"：addBuff 压进去的就是原对象，
    // 过期会被 tickSkill 摘掉，下次触发必然是新的一个。
    const seen = new Set<object>();
    const triggerTicks: number[] = [];
    let maxAlive = 0;

    for (let i = 0; i < 420 && !state.over; i++) {
      step(state, defs);
      const mine = caster.skill!.buffs.filter((buff) => buff.stats.attackDamageBp === 5000);
      maxAlive = Math.max(maxAlive, mine.length);
      for (const buff of mine) {
        if (!seen.has(buff)) {
          seen.add(buff);
          triggerTicks.push(state.tick);
        }
      }
    }

    expect(triggerTicks.length, '20 秒里至少该触发一次').toBeGreaterThanOrEqual(1);
    expect(maxAlive, '同一时刻最多只能有一个骑士戒律包（不叠加）').toBe(1);
    // 相邻两次触发至少隔 200 tick = 10 秒（"10 秒内只触发一次"）
    for (let i = 1; i < triggerTicks.length; i++) {
      expect(triggerTicks[i]! - triggerTicks[i - 1]!, '两次触发之间必须间隔 ≥ 10 秒').toBeGreaterThanOrEqual(200);
    }
  });

  it('★ 骑士戒律的增益按藏品算：开技能后照样能攒法力', () => {
    const defs = tableOf([
      makeDef('caster', [], { manaPerAttack: 1000, range: 1, hp: 100000, attackDamage: 10 }, {
        effects: [{ kind: 'damage', target: 'nearestEnemy', power: 1, damageType: 'physical' }],
      }),
      makeDef('target', [], { hp: 100000 }),
    ]);
    const state = createBattle(
      defs,
      [
        { team: 0, units: [unit('caster', 3, 4, ['itm_knight_oath'])] },
        { team: 1, units: [unit('target', 5, 4)] },
      ],
      21,
    );
    const caster = state.units.find((u) => u.team === 0)!;

    // 跑到增益包挂上为止
    let mounted = false;
    for (let i = 0; i < 300 && !state.over; i++) {
      step(state, defs);
      if (caster.skill!.buffs.some((buff) => buff.stats.attackDamageBp === 5000)) {
        mounted = true;
        break;
      }
    }
    expect(mounted, '先得真的触发一次').toBe(true);

    const buff = caster.skill!.buffs.find((b) => b.stats.attackDamageBp === 5000)!;
    expect(buff.passive, '骑士戒律的包必须标成常驻被动（不算技能生效）').toBe(true);
    expect(isSkillActive(state, caster), '骑士戒律生效期间不算"技能生效中"').toBe(false);
    caster.mana = 0;
    gainMana(state, caster, 200);
    expect(caster.mana, '增益期间该能正常攒法力').toBe(200);
  });
});

// ============================================================
//  内核：B 类（共享）藏品
// ============================================================

describe('内核：B 类共享藏品', () => {
  it('★ 奇缘面具：全队受伤害 -10%', () => {
    const plain = damageTakenByDefender({ defenderHp: 100000, steps: 60 });
    const masked = damageTakenByDefender({ defenderHp: 100000, sharedItems: ['itm_fate_mask'], steps: 60 });
    expect(masked, '减伤之后必须明显更少').toBeLessThan(plain);
  });

  it('★ 药枚：开局全队各一次免疫 —— 第一下完全不掉血', () => {
    // 只跑两帧：正好够第一次出手（免疫的那一下），再看掉血量
    const withPill = damageTakenByDefender({ defenderHp: 100000, sharedItems: ['itm_pill'], steps: 2 });
    const plainSameWindow = damageTakenByDefender({ defenderHp: 100000, steps: 2 });
    expect(plainSameWindow, '对照组：不带药枚时会掉一次血').toBeGreaterThan(0);
    expect(withPill, '带了药枚，这一下应该被完全免疫').toBe(0);
  });

  it('★ 迷迭香之拥：开局把敌方双抗按 25% 砍掉', () => {
    const defs = tableOf([
      makeDef('me', [], { hp: 1000 }),
      makeDef('enemy', [], { armor: 100, magicResist: 200 }),
    ]);
    const teams: [TeamSetup, TeamSetup] = [
      { team: 0, units: [unit('me', 3, 4)], sharedItems: ['itm_rosemary_embrace'] },
      { team: 1, units: [unit('enemy', 5, 4)] },
    ];
    const state = createBattle(defs, teams, 3);
    const enemy = state.units.find((u) => u.team === 1)!;
    expect(enemy.armor).toBe(Math.floor((100 * FIX * 7500) / 10000));
    expect(enemy.magicResist).toBe(Math.floor((200 * FIX * 7500) / 10000));
  });

  it('★ 急救药箱：每 3 秒给全体回血（而且是"一份"而不是"每人一份"）', () => {
    const defs = tableOf([makeDef('wounded', [], { hp: 1000 })]);
    // 敌方必须"存在"，否则战斗会在第 0 帧就判定结束，step 什么都不做
    // （所以给它一个 0 攻击力的沙包，放在最远处，61 帧内走不过来）
    const teams: [TeamSetup, TeamSetup] = [
      { team: 0, units: [unit('wounded', 0, 0)], sharedItems: ['itm_medkit'] },
      { team: 1, units: [unit('wounded', 9, 9)] },
    ];
    const state = createBattle(defs, teams, 3);
    const ally = state.units[0]!;
    ally.hp = 100 * FIX; // 先扣点血，不然"满血回血"看不出来
    expect(ally.hp).toBe(100 * FIX);

    // 每 3 秒 = 60 tick；跑 61 tick 至少触发一次
    for (let i = 0; i < 61; i++) step(state, defs);
    expect(ally.hp).toBe(200 * FIX); // 回 100 点
  });

  it('★ 金酒之杯：金币够多时全队攻速真的提升（按金币折进去的）', () => {
    const defs = tableOf([makeDef('me')]);
    const build = (gold: number) => {
      const teams: [TeamSetup, TeamSetup] = [
        { team: 0, units: [unit('me', 3, 4)], sharedItems: ['itm_gin_cup'], playerContext: { gold, hp: 100 } },
        { team: 1, units: [] },
      ];
      return createBattle(defs, teams, 8);
    };
    const poor = build(0);
    const rich = build(50); // 50 金 -> 10 层 -> +30% 攻速
    // 攻速类加成的落地方式是直接改棋子的 attackSpeed（见 applyTraitBonuses）
    expect(poor.units[0]!.attackSpeed).toBe(1000);
    expect(rich.units[0]!.attackSpeed, '1000 × (1 + 30%)').toBe(1300);
  });
});

// ============================================================
//  确定性
// ============================================================

describe('★ 带藏品的战斗仍然是确定性的', () => {
  it('同一个种子 -> 同样的校验和（联机的地基）', () => {
    const defs = tableOf([
      makeDef('a', ['yan'], { hp: 5000 }),
      makeDef('b', ['laterano'], { hp: 5000 }),
    ]);
    const teams: [TeamSetup, TeamSetup] = [
      {
        team: 0,
        units: [unit('a', 3, 4, ['itm_solvent', 'itm_raid_grenade']), unit('b', 3, 5, ['itm_rider_might'])],
        sharedItems: ['itm_gin_cup', 'itm_medkit'],
        playerContext: { gold: 30, hp: 80 },
      },
      { team: 1, units: [unit('a', 5, 4)], sharedItems: ['itm_fate_mask'] },
    ];
    const first = simulate(defs, teams, 31415);
    const second = simulate(defs, teams, 31415);
    expect(first.checksum).toBe(second.checksum);
    expect(first.ticks).toBe(second.ticks);
    expect(first.winner).toBe(second.winner);
  });

  it('不带任何藏品时结果不变（回归：加藏品不能改变原有战斗）', () => {
    const defs = tableOf([makeDef('a', ['yan'], { hp: 5000 }), makeDef('b', [], { hp: 5000 })]);
    const teams: [TeamSetup, TeamSetup] = [
      { team: 0, units: [unit('a', 3, 4), unit('b', 3, 6)] },
      { team: 1, units: [unit('a', 5, 4), unit('b', 5, 6)] },
    ];
    const withEmpty = simulate(defs, teams, 2718);
    const bare = simulate(
      defs,
      [
        { team: 0, units: [{ defId: 'a', star: 1, cell: { col: 3, row: 4 } }, { defId: 'b', star: 1, cell: { col: 3, row: 6 } }] },
        { team: 1, units: [{ defId: 'a', star: 1, cell: { col: 5, row: 4 } }, { defId: 'b', star: 1, cell: { col: 5, row: 6 } }] },
      ],
      2718,
    );
    expect(withEmpty.checksum).toBe(bare.checksum);
  });
});

// ============================================================
//  ★ 0.1.1 藏品二版（30 件）—— 新机制
// ============================================================
//
// 【这一段盯什么？】
// 二版藏品的**数值**写在 item-data.ts 里，但"数值有没有真的折进战斗"是另一回事：
// 一条机制要是没接上，代码不报错、战斗照常打完 —— 只是那件藏品**完全是个摆设**
// （正是本文件开头说的"最危险的那一类失效"）。
// 所以两条腿都测：解析层产出了什么（纯函数），内核里真的生效了没有（真打一场）。

describe('★ 藏品二版：解析层（纯函数）', () => {
  const defs = tableOf([
    makeDef('cheap', [], { range: 1 }), // cost 1
    { ...makeDef('far', [], { range: 5 }), cost: 4 },
  ]);
  const placements = [
    { defId: 'cheap', star: 1, cell: { col: 0, row: 0 } },
    { defId: 'far', star: 1, cell: { col: 1, row: 0 } },
  ];
  const ctx = { gold: 0, hp: 100 };

  it('★ 跨回合成长会折成"属性包"（仇名录：基础 +2%，每层再 +1%）', () => {
    /** 求和（不依赖包的排列顺序 —— 那是实现细节） */
    const attackBp = (list: ReturnType<typeof resolveWearerItems>['statsList']): number =>
      list.reduce((sum, pack) => sum + (typeof pack.attackDamageBp === 'number' ? pack.attackDamageBp : 0), 0);

    const base = resolveWearerItems(makeDef('x'), ['itm_grudge_list']);
    expect(base.statsList).toHaveLength(1);
    expect(attackBp(base.statsList), '白板 +2%').toBe(200);

    const grown = resolveWearerItems(makeDef('x'), ['itm_grudge_list'], {
      growth: { itm_grudge_list: 50 },
    });
    expect(grown.statsList, '成长包 + 白板包').toHaveLength(2);
    expect(attackBp(grown.statsList), '2% + 50 层 × 1%').toBe(5200);
  });

  it('★ 层数封顶（仇名录最多 150 层 = +150%）', () => {
    const capped = resolveWearerItems(makeDef('x'), ['itm_grudge_list'], {
      growth: { itm_grudge_list: 9999 },
    });
    const sum = capped.statsList.reduce(
      (acc, pack) => acc + (typeof pack.attackDamageBp === 'number' ? pack.attackDamageBp : 0),
      0,
    );
    expect(sum, '2% + 150%').toBe(15200);
  });

  it('★ 悲伤的红：层数不是"累计"的，而是"未装载的藏品数"（实时取）', () => {
    const three = resolveWearerItems(makeDef('x'), ['itm_sad_red'], { unequipped: 3 });
    expect(three.statsList[0]!.hpBp).toBe(2400);
    expect(three.statsList[0]!.attackDamageBp).toBe(2400);

    const zero = resolveWearerItems(makeDef('x'), ['itm_sad_red'], { unequipped: 0 });
    expect(zero.statsList, '0 个未装载 = 不加，而不是"加 0%"').toHaveLength(0);
  });

  it('★ 生还者合约：层数放大的是**机制倍率**（scaleBp），不是属性包', () => {
    const at = (stacks: number) =>
      resolveSharedItems(['itm_survivor_contract'], placements, defs, {
        gold: 0,
        hp: 100,
        itemState: { growth: { itm_survivor_contract: stacks } },
      }).teamMechanics[0];
    // base:1 = 开局就有的那 +20%
    expect(at(0)).toMatchObject({ kind: 'startRandomAllyBuff', scaleBp: 10000 });
    expect(at(3), '再叠 3 层 = +80%').toMatchObject({ scaleBp: 40000 });
  });

  it('★ 剑锤：无条件全队 +50%（teamConditional.always）', () => {
    const eff = resolveSharedItems(['itm_sword_hammer'], placements, defs, ctx);
    const byEffect = Object.fromEntries(eff.teamBonuses.map((bonus) => [bonus.effect, bonus.value]));
    expect(byEffect).toEqual({
      attackDamageBp: 5000,
      armorBp: 5000,
      magicResistBp: 5000,
      hpBp: 5000,
    });
    expect(ITEM_DEFS['itm_sword_hammer']!.shopCostDelta, '同时把商店价 +2').toBe(2);
  });

  it('★ 魔王的旗帜：血量**严格大于** 70 才发攻速', () => {
    const high = resolveSharedItems(['itm_demon_king_banner'], placements, defs, { gold: 0, hp: 80 });
    expect(high.teamBonuses[0]).toMatchObject({ effect: 'attackSpeedBp', value: 5000 });

    const edge = resolveSharedItems(['itm_demon_king_banner'], placements, defs, { gold: 0, hp: 70 });
    expect(edge.teamBonuses, '正好 70 不算"大于 70"').toHaveLength(0);
  });

  it('★ 苍桐：金币门槛在组阵容时判成结论（active）', () => {
    const rich = resolveSharedItems(['itm_cangtong'], placements, defs, { gold: 70, hp: 100 });
    expect(rich.teamMechanics[0]).toMatchObject({
      kind: 'goldThresholdNuke',
      active: true,
      intervalTicks: 200,
    });

    const poor = resolveSharedItems(['itm_cangtong'], placements, defs, { gold: 69, hp: 100 });
    expect(poor.teamMechanics[0]).toMatchObject({ active: false });
  });

  it('★ 活玫瑰 / 涌动之餐：全队治疗加成 +8% / +30%', () => {
    const rose = resolveSharedItems(['itm_live_rose'], placements, defs, ctx);
    expect(rose.teamMechanics[0]).toMatchObject({ kind: 'teamHealingBp', ratioBp: 800 });

    const meal = resolveSharedItems(['itm_surge_meal'], placements, defs, ctx);
    expect(meal.teamMechanics[0]).toMatchObject({ kind: 'teamHealingBp', ratioBp: 3000 });
  });

  it('★ 支援防暴桩：假人血量按回合里程碑累加、封顶 1900', () => {
    const at = (round: number) =>
      resolveSharedItems(['itm_riot_bunker'], placements, defs, { gold: 0, hp: 100, round })
        .teamMechanics[0];
    expect(at(1)).toMatchObject({ kind: 'startSummon', summonId: 'summon_dummy', count: 2, hp: 1000 * FIX });
    expect(at(4), '第 5 回合之前不加').toMatchObject({ hp: 1000 * FIX });
    expect(at(5), '第 5 回合起 +300').toMatchObject({ hp: 1300 * FIX });
    expect(at(15), '第 15 回合起再 +600').toMatchObject({ hp: 1900 * FIX });
    expect(at(40), '封顶 1900').toMatchObject({ hp: 1900 * FIX });
  });

  it('★ 天师锦囊：炎佑随回合成长，并整体 +30%（前提：大炎羁绊开着）', () => {
    // 3 个炎成员 -> 大炎第一档激活（炎佑自己不参与羁绊构建，开关看阵容）
    const yanLineup = [
      { defId: 'op02', star: 1, cell: { col: 0, row: 0 } },
      { defId: 'op11', star: 1, cell: { col: 1, row: 0 } },
      { defId: 'op21', star: 1, cell: { col: 2, row: 0 } },
    ];
    const at = (round: number) =>
      resolveSharedItems(['itm_celestial_pouch'], yanLineup, UNIT_DEFS, { gold: 0, hp: 100, round })
        .teamMechanics[0];
    expect(at(1)).toMatchObject({ summonId: 'summon_yanyou', count: 1, hp: 650 * FIX, attackDamage: 130 * FIX });
    expect(at(5), '第 5 回合：血 1000 / 攻 130，再 ×1.3').toMatchObject({ hp: 1300 * FIX, attackDamage: 169 * FIX });
    expect(at(15), '第 15 回合：血 1500 / 攻 160，再 ×1.3').toMatchObject({ hp: 1950 * FIX, attackDamage: 208 * FIX });
  });
});

describe('★ 藏品二版：距离增伤真的进到战斗里', () => {
  /**
   * 打一场：攻击方（可以带藏品）打一个厚血沙包，返回沙包一共掉了多少血。
   * 双方都给射程 5 —— 这样谁都不用移动，"距离"这一项在整段里是恒定的。
   */
  function damageDealtBy(options: {
    attackerItems?: string[];
    attackerCol?: number;
    defenderCol?: number;
    steps?: number;
  }): number {
    const defs = tableOf([
      makeDef('tank', [], { hp: 1_000_000, range: 5 }),
      makeDef('hitter', [], { attackDamage: 1000, range: 5 }),
    ]);
    const teams: [TeamSetup, TeamSetup] = [
      { team: 0, units: [unit('tank', options.defenderCol ?? 4, 4)] },
      { team: 1, units: [unit('hitter', options.attackerCol ?? 5, 4, options.attackerItems)] },
    ];
    const state = createBattle(defs, teams, 777);
    const tank = state.units.find((u) => u.defId === 'tank')!;
    const before = tank.hp;
    for (let i = 0; i < (options.steps ?? 50) && !state.over; i++) step(state, defs);
    return before - tank.hp;
  }

  it('★ 电锯（近）：1 格时 +80%', () => {
    const plain = damageDealtBy({ steps: 50 });
    const saw = damageDealtBy({ attackerItems: ['itm_blaze_saw'], steps: 50 });
    expect(plain, '先确认真的打到了').toBeGreaterThan(0);
    expect(saw).toBe(Math.floor(plain * 1.8));
  });

  it('★ 狙击镜（远）：4 格时 +80%', () => {
    const far = { defenderCol: 1, attackerCol: 5, steps: 50 };
    const plain = damageDealtBy(far);
    const scope = damageDealtBy({ ...far, attackerItems: ['itm_scout_scope'] });
    expect(plain).toBeGreaterThan(0);
    expect(scope).toBe(Math.floor(plain * 1.8));
  });

  it('★ 反过来不成立：电锯在 4 格远处只 +20%（这条是"按距离"而不是"无条件增伤"的证据）', () => {
    const far = { defenderCol: 1, attackerCol: 5, steps: 50 };
    const plain = damageDealtBy(far);
    const saw = damageDealtBy({ ...far, attackerItems: ['itm_blaze_saw'] });
    expect(saw).toBe(Math.floor(plain * 1.2));
  });
});

describe('★ 藏品二版：血量越低越强（热辣可可 / 紧急活性剂 / 止痛片）', () => {
  function battleWith(itemId: string) {
    const defs = tableOf([makeDef('me', [], { hp: 1000 })]);
    const teams: [TeamSetup, TeamSetup] = [
      { team: 0, units: [unit('me', 3, 4, [itemId])] },
      { team: 1, units: [unit('me', 5, 4)] },
    ];
    const state = createBattle(defs, teams, 11);
    return { state, me: state.units[0]! };
  }

  it('★ 热辣可可：30% 血线正好 +100% 攻击力，且封顶', () => {
    const { state, me } = battleWith('itm_spicy_cocoa');
    const full = effectiveAttackDamage(me, collectMods(state, me));
    me.hp = Math.floor(me.maxHp * 0.3);
    expect(effectiveAttackDamage(me, collectMods(state, me))).toBe(full * 2);
    me.hp = 1;
    expect(effectiveAttackDamage(me, collectMods(state, me)), '再残也不会超过上限').toBe(full * 2);
  });

  it('★ 紧急活性剂：同一口径，但加的是攻速（+80%）', () => {
    const { state, me } = battleWith('itm_stimulant');
    expect(collectMods(state, me).attackSpeedBp, '满血不加').toBe(0);
    me.hp = Math.floor(me.maxHp * 0.3);
    expect(collectMods(state, me).attackSpeedBp).toBe(8000);
  });

  it('★ 止痛片：残血时回蓝变快（30% 血线 = 2/秒）', () => {
    const { state, me } = battleWith('itm_painkiller');
    expect(collectMods(state, me).manaRegenMilliPerSecond).toBe(0);
    me.hp = Math.floor(me.maxHp * 0.3);
    expect(collectMods(state, me).manaRegenMilliPerSecond, '2/秒 = 2000 毫点').toBe(2000);
  });
});


// ============================================================
//  ★ 0.1.1：天师锦囊的炎佑（召唤物不参与羁绊构建）
// ============================================================

describe('★ 天师锦囊：大炎羁绊开着，炎佑才 +30%', () => {
  const place = (defId: string, col: number) => ({ defId, star: 1, cell: { col, row: 0 } });
  /** 3 个炎成员 = 大炎第一档（user 口径：开关由玩家阵容决定） */
  const yanLineup = [place('op02', 0), place('op11', 1), place('op21', 2)];
  const plainLineup = [place('op02', 0), place('op11', 1)]; // 只有 2 个 -> 没开

  const summonOf = (placements: ReturnType<typeof place>[]) => {
    const eff = resolveSharedItems(['itm_celestial_pouch'], placements, UNIT_DEFS, {
      gold: 0,
      hp: 100,
      round: 6,
    });
    return eff.teamMechanics.find((m) => m.kind === 'startSummon');
  };

  it('大炎激活 -> 基础 1000/130 再 ×1.3', () => {
    const summon = summonOf(yanLineup);
    expect(summon?.hp).toBe(1300 * 1000);
    expect(summon?.attackDamage).toBe(169 * 1000);
  });

  it('★ 大炎没开 -> 只有基础值（棋子不参与羁绊构建，也不凭空吃加成）', () => {
    const summon = summonOf(plainLineup);
    expect(summon?.hp).toBe(1000 * 1000);
    expect(summon?.attackDamage).toBe(130 * 1000);
  });

  it('假人不吃这个条件（它没写 requireTrait）', () => {
    const eff = resolveSharedItems(['itm_riot_bunker'], plainLineup, UNIT_DEFS, {
      gold: 0,
      hp: 100,
      round: 6,
    });
    const summon = eff.teamMechanics.find((m) => m.kind === 'startSummon');
    expect(summon?.hp).toBe(1300 * 1000);
  });
});


// ============================================================
//  ★★ 0.1.2 修：生还者合约（B 类）的「开局随机强化」以前根本没生效
// ============================================================

describe('★ 生还者合约：开局随机强化一名我方干员（B 类走队伍级那条路）', () => {
  /** 三名我方 + 一名敌方沙包；我方不带任何技能被动，免得干扰断言 */
  const setup = (sharedItems: string[]) => {
    const defs = tableOf([
      makeDef('allyA'),
      makeDef('allyB'),
      makeDef('allyC'),
      makeDef('enemy', [], { hp: 100000 }),
    ]);
    const teams: [TeamSetup, TeamSetup] = [
      {
        team: 0,
        units: [unit('allyA', 1, 1), unit('allyB', 1, 3), unit('allyC', 1, 5)],
        sharedItems,
      },
      { team: 1, units: [unit('enemy', 8, 3)] },
    ];
    return { defs, state: createBattle(defs, teams, 4242) };
  };

  it('★ 真的给某一名我方干员挂上了永久攻击加成（以前一条都没有）', () => {
    const { defs, state } = setup(['itm_survivor_contract']);
    const picked = randomAllyBuffPick(state.log, 'itm_survivor_contract');
    expect(picked, '日志里该有一条"这件藏品给的增益"').not.toBeNull();

    const info = spawnedUnitInfo(state.log, picked!);
    expect(info?.team, '只强化我方').toBe(0);

    const target = state.units.find((u) => u.id === picked)!;
    const mods = collectMods(state, target);
    expect(mods.attackDamageBp, '攻击力 +20%（1 层）').toBe(2000);
    expect(mods.armorBp, '防御 +20%').toBe(2000);

    // 队友一个都不该被强化（"随机一名"）
    for (const other of state.units) {
      if (other.team !== 0 || other.id === picked) continue;
      expect(collectMods(state, other).attackDamageBp, '只该抽一个人').toBe(0);
    }
    void defs;
  });

  it('★ 层数放大：赢了 N 场之后基础值也一起变大（scaleBp）', () => {
    const defs = tableOf([makeDef('allyA'), makeDef('allyB'), makeDef('enemy', [], { hp: 100000 })]);
    const teams: [TeamSetup, TeamSetup] = [
      {
        team: 0,
        units: [unit('allyA', 1, 1), unit('allyB', 1, 5)],
        sharedItems: ['itm_survivor_contract'],
        // base 1 + 2 场胜利 = 3 层 -> ×3 倍（+60%）
        itemState: { growth: { itm_survivor_contract: 2 } },
      },
      { team: 1, units: [unit('enemy', 8, 3)] },
    ];
    const state = createBattle(defs, teams, 99);
    const picked = randomAllyBuffPick(state.log, 'itm_survivor_contract')!;
    const target = state.units.find((u) => u.id === picked)!;
    expect(collectMods(state, target).attackDamageBp).toBe(6000);
  });

  it('没装这件藏品 -> 日志里没有它的增益（对照组）', () => {
    const { state } = setup([]);
    expect(randomAllyBuffPick(state.log, 'itm_survivor_contract')).toBeNull();
  });

  it('★ 换种子就会重新抽人（每回合重掷的前提；不是一个种子永远抽同一个人）', () => {
    const defs = tableOf([makeDef('allyA'), makeDef('allyB'), makeDef('allyC'), makeDef('enemy', [], { hp: 100000 })]);
    const teams: [TeamSetup, TeamSetup] = [
      { team: 0, units: [unit('allyA', 1, 1), unit('allyB', 1, 3), unit('allyC', 1, 5)], sharedItems: ['itm_survivor_contract'] },
      { team: 1, units: [unit('enemy', 8, 3)] },
    ];
    const picks = new Set<number>();
    for (let seed = 1; seed <= 24; seed++) {
      const state = createBattle(defs, teams, seed);
      const picked = randomAllyBuffPick(state.log, 'itm_survivor_contract');
      if (picked !== null) picks.add(picked);
    }
    expect(picks.size, '24 个种子该抽到不止一个人').toBeGreaterThan(1);

    // 抽到的必须都是**我方**那三个（id 从队伍 0 的 spawn 事件里拿）
    const allyIds = new Set(
      createBattle(defs, teams, 1)
        .units.filter((u) => u.team === 0)
        .map((u) => u.id),
    );
    for (const id of picks) expect(allyIds.has(id), '不能抽到对面').toBe(true);
  });

  it('★ 联机两端一致：同一颗种子抽到同一个人（可复盘）', () => {
    const a = setup(['itm_survivor_contract']);
    const b = setup(['itm_survivor_contract']);
    expect(randomAllyBuffPick(b.state.log, 'itm_survivor_contract')).toBe(
      randomAllyBuffPick(a.state.log, 'itm_survivor_contract'),
    );
    // 抽签本身也没让两边分叉：跑一段之后的日志长度一致
    step(a.state, a.defs);
    step(b.state, b.defs);
    expect(b.state.log.length).toBe(a.state.log.length);
  });
});
