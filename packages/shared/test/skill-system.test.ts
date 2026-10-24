/**
 * 技能系统的测试。
 *
 * 【为什么单独一个大文件？】
 * 因为这一轮把 50 个干员的技能从"按定位编的占位"换成了**你表格里的真数据**，
 * 而且加了四种全新的东西：
 *   · 星级技能（3 星专属会整个替换掉 1/2 星那套）
 *   · 被动技能（入场就生效、不攒法力）
 *   · 召唤物 / 陷阱（柱子、金狮子、望的棋子）
 *   · 三种法力回复方式（攻击回复 / 受击回复 / 自动回复）
 * 每一样都是"不看代码就猜不出行为"的规则，所以每条都要用真实数据钉住。
 */
import { describe, expect, it } from 'vitest';
import {
  MANA_FROM_DAMAGE_TAKEN,
  MAX_BATTLE_TICKS,
  SKILLS,
  SUMMON_DEFS,
  TICKS_PER_SECOND,
  UNIT_DEFS,
  applyStun,
  cellDistance,
  createBattle,
  dealDamage,
  effectiveRange,
  gainManaFromDamageTaken,
  hasActiveSkill,
  isPlayableDef,
  simulate,
  skillVariantOf,
  spawnSummon,
  starValue,
  step,
  type BattleEvent,
  type SkillDef,
  type TeamSetup,
  type UnitDef,
  type UnitDefTable,
  type UnitPlacement,
} from '../src/index.js';

const s = (seconds: number): number => Math.round(seconds * TICKS_PER_SECOND);

/** 只放队伍 0 的棋子，队伍 1 空着（主循环会立刻判定结束，正好用来只看开局状态） */
function soloSetup(defId: string, star = 1, col = 4, row = 4): [TeamSetup, TeamSetup] {
  const units: UnitPlacement[] = [{ defId, star, cell: { col, row } }];
  return [
    { team: 0, units },
    { team: 1, units: [] },
  ];
}

/** 两边各放一个，用来跑真实战斗 */
function duel(
  a: { defId: string; star: number; col: number; row: number },
  b: { defId: string; star: number; col: number; row: number },
): [TeamSetup, TeamSetup] {
  return [
    { team: 0, units: [{ defId: a.defId, star: a.star, cell: { col: a.col, row: a.row } }] },
    { team: 1, units: [{ defId: b.defId, star: b.star, cell: { col: b.col, row: b.row } }] },
  ];
}

function runFor(defs: UnitDefTable, teams: [TeamSetup, TeamSetup], ticks: number, seed = 12345) {
  const state = createBattle(defs, teams, seed);
  for (let i = 0; i < ticks && !state.over; i++) step(state, defs);
  return state;
}

/** 一直跑到战斗结束（测"范围效果有没有发生"要用它，跑到死为止才不漏） */
function runToEnd(defs: UnitDefTable, teams: [TeamSetup, TeamSetup], seed = 12345) {
  const state = createBattle(defs, teams, seed);
  let guard = 0;
  while (!state.over && guard++ < 5000) step(state, defs);
  return state;
}

/** 造一个不做事的基础棋子（同 trait-mechanics.test.ts 里的那个） */
function makeDef(id: string, traits: string[], base: Partial<UnitDef['base']> = {}): UnitDef {
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
    starHpBp: 1800,
    starDamageBp: 1800,
    color: '#888888',
    sprite: id,
    skill: {
      id: `${id}_skill`,
      name: `${id} 的技能`,
      desc: '什么都不做（测试用）',
      effects: [],
      manaSource: 'attack',
    },
  };
}

/*
  ★★ 用户报的：「给干员装了骑士戒律，开技能后面板没变」。
  查下来**功能是实现了的**（内核确实挂了 +50% 攻 / +50% 攻速的包），
  问题在**没有上报事件** —— 详情页的"战斗中实时数值" =
  开战基线 + 所有还没到期的 `buff` 事件（见 replay.liveStatsOf），
  而不发事件的地方面板就永远不动。
  下面把"哪些增益该发事件、哪些不该发"钉死。
*/
describe('★ 限时增益要记进日志（详情页实时数值跟着事件流走）', () => {
  it('开技能挂的时间型增益会发 buff 事件（面板才跳得动）', () => {
    const caster = makeDef('caster', [], { manaPerAttack: 1000, hp: 100000, attackDamage: 10 });
    caster.skill = {
      ...caster.skill,
      effects: [
        { kind: 'buff', target: 'self', stats: { attackDamageBp: 5000, attackSpeedBp: 2500 }, durationTicks: s(10) },
      ],
    };
    const defs = tableOf([caster, makeDef('target', [], { hp: 100000 })]);
    const state = runFor(
      defs,
      duel({ defId: 'caster', star: 1, col: 4, row: 4 }, { defId: 'target', star: 1, col: 5, row: 4 }),
      s(2),
    );
    const me = state.units.find((unit) => unit.defId === 'caster')!;
    const events = state.log.filter(
      (event): event is Extract<BattleEvent, { type: 'buff' }> => event.type === 'buff' && event.targetId === me.id,
    );

    expect(events, '攻击力 + 攻速各一条').toHaveLength(2);
    const damage = events.find((event) => event.stat === 'attackDamage')!;
    const speed = events.find((event) => event.stat === 'attackSpeed')!;
    expect(damage.bonusBp).toBe(5000);
    expect(speed.bonusBp).toBe(2500);
    expect(damage.durationTicks, '到期时间要和挂上去的包一致').toBe(s(10));
  });

  it('★ 按次数消耗的增益（attacks）**不**发事件 —— 它没有"多少 tick 到期"', () => {
    const caster = makeDef('caster', [], { manaPerAttack: 1000, hp: 100000, attackDamage: 10 });
    caster.skill = {
      ...caster.skill,
      effects: [{ kind: 'buff', target: 'self', stats: { attackDamageBp: 3000 }, durationTicks: s(10), attacks: 3 }],
    };
    const defs = tableOf([caster, makeDef('target', [], { hp: 100000 })]);
    const state = runFor(
      defs,
      duel({ defId: 'caster', star: 1, col: 4, row: 4 }, { defId: 'target', star: 1, col: 5, row: 4 }),
      s(3),
    );
    const me = state.units.find((unit) => unit.defId === 'caster')!;
    expect(state.log.some((event) => event.type === 'buff' && event.targetId === me.id)).toBe(false);
  });

  it('星星越高数值越大：事件里带的是**按星级换算后**的值', () => {
    const caster = makeDef('caster', [], { manaPerAttack: 1000, hp: 100000, attackDamage: 10 });
    caster.skill = {
      ...caster.skill,
      effects: [
        { kind: 'buff', target: 'self', stats: { attackDamageBp: [1000, 2000, 3000] }, durationTicks: s(5) },
      ],
    };
    const defs = tableOf([caster, makeDef('target', [], { hp: 100000 })]);
    const state = runFor(
      defs,
      duel({ defId: 'caster', star: 3, col: 4, row: 4 }, { defId: 'target', star: 1, col: 5, row: 4 }),
      s(2),
    );
    const event = state.log.find((item) => item.type === 'buff')!;
    expect(event.type === 'buff' && event.bonusBp).toBe(3000);
  });
});

function tableOf(defs: UnitDef[]): UnitDefTable {
  const out: UnitDefTable = {};
  for (const def of defs) out[def.id] = def;
  return out;
}

/** 摆一支队伍（col/row 直接写） */
function team(
  side: 0 | 1,
  entries: Array<{ defId: string; col: number; row: number }>,
): TeamSetup {
  return {
    team: side,
    units: entries.map((entry) => ({ defId: entry.defId, star: 1, cell: { col: entry.col, row: entry.row } })),
  };
}

// ============================================================
// 星级数值
// ============================================================

describe('星级数值（50%/100%/130% 这种写法）', () => {
  it('三个数依次对应 1/2/3 星', () => {
    expect(starValue([500, 1000, 1300], 1)).toBe(500);
    expect(starValue([500, 1000, 1300], 2)).toBe(1000);
    expect(starValue([500, 1000, 1300], 3)).toBe(1300);
  });

  it('只写两个数时，3 星沿用第二个（你表里有好几个技能只填了 1/2 星）', () => {
    expect(starValue([30, 50], 1)).toBe(30);
    expect(starValue([30, 50], 2)).toBe(50);
    expect(starValue([30, 50], 3)).toBe(50);
  });

  it('只写一个数时三星通用', () => {
    expect(starValue(990, 1)).toBe(990);
    expect(starValue(990, 3)).toBe(990);
  });

  it('没写（undefined）当成 0，不会变成 NaN', () => {
    expect(starValue(undefined, 2)).toBe(0);
  });

  it('★ 真实数据里用到了"一个数"和"三个数"两种写法', () => {
    /*
      注意：数据里没有"只写两个数"的例子 —— 只填了 1/2 星的技能
      （比如古米 30%/50%）我写成了 [300, 500, 500]（把三星补齐）。
      补齐比省略好：读数据的人不用去猜"第三个到底是多少"。
      所以"两个数"这条规则由上面的合成数据测试覆盖，这里只核对真实数据用到的两种。
    */
    const skills = Object.values(SKILLS);
    const values = skills.flatMap((skill) =>
      skill.effects.flatMap((effect) => ('power' in effect ? [effect.power] : [])),
    );
    expect(values.some((v) => typeof v === 'number'), '应该有用"一个数"的技能').toBe(true);
    expect(
      values.some((v) => Array.isArray(v) && v.length === 3),
      '应该有用"三个数（1/2/3星）"的技能',
    ).toBe(true);
  });
});

// ============================================================
// ★ 星级百分比：描述和数据必须一致
// ============================================================

/**
 * 递归找出一个技能里所有"数组形式"的 `ratioBp`（= 按星级写的百分比）。
 * 有的挂在 `effects[].stats` 里，有的挂在 `passive` 里
 * （夜莺的脉冲治疗、凯尔希的攻击治疗就是后者）。
 */
function arrayRatioBps(node: unknown, out: number[][] = []): number[][] {
  if (node === null || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const item of node) arrayRatioBps(item, out);
    return out;
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    /*
      ★ 0.2：`power` 也收进来，并**换算成同一量纲**再比。

      【为什么必须收？】`power`（伤害/治疗/护盾/陷阱的强度）走**千分比 FIX=1000**，
      `ratioBp` 走**万分比 BP=10000** —— 两者"100% 的写法"差了 10 倍。
      原来只收 ratioBp，于是把技能改成"一次性伤害"（用 power 写星级三元组）之后，
      这条测试就直接报"找不到数组"而抓瞎，等于**悄悄放过了对账**。
      这里把 power × 10，统一成"×100 的百分比"，两种写法都能对上描述。
    */
    if (key === 'ratioBp' && Array.isArray(value)) out.push(value as number[]);
    else if (key === 'power' && Array.isArray(value)) out.push((value as number[]).map((n) => n * 10));
    /*
      ★ 0.2：任何以 `Bp` 结尾的数组也要收（`attackDamageBp` / `attackSpeedBp` / `hpBp`…）。
      空爆改版后一个技能里同时有"被动溅射 ratioBp"和"主动加伤 attackDamageBp"**两组三元组**，
      只收 ratioBp 会漏掉后一组、然后把描述里的 6 个百分比全判成"多出来的"。
    */
    else if (key.endsWith('Bp') && Array.isArray(value)) out.push(value as number[]);
    else arrayRatioBps(value, out);
  }
  return out;
}

describe('★ 星级百分比：描述里的 a%/b%/c% 必须等于数据里的 ratioBp ÷ 100', () => {
  /*
    起因（2026-10-13 的数值审计）：op01 空爆 / op02 夕 的溅射写成了
    `ratioBp: [500, 1000, 1300]` —— 那是**千分比**的写法，而 `ratioBp` 走
    **万分比 BP=10000**，于是实际只有 5%/10%/13%，比技能描述小了整整 10 倍。
    这条测试把"描述 ↔ 数据"钉在一起：以后改一边忘另一边就会红。

    ⚠ 只对"描述里直接写了星级百分比"的技能对账。`reflect` / `vsTraitDamageBp`
      这类条目描述里的百分比是"上限"等别的含义，不能机械对账。
  */
  const DIRECT_DESC_SKILLS = ['op01', 'op02', 'op16', 'op21', 'op28', 'op46'];

  it.each(DIRECT_DESC_SKILLS)('%s：描述与数据一致', (id) => {
    const skill = SKILLS[id]!;
    const bps = arrayRatioBps(skill);
    // ★ 0.2：不再要求"恰好一组"（空爆这类技能被动+主动各有一组），只要有数据可对账即可
    expect(bps.length, `${id} 至少该有一组数组形式的星级百分比`).toBeGreaterThan(0);

    const pcts = [...skill.desc.matchAll(/(\d+)%/g)].map((match) => Number(match[1]));
    expect(pcts.length, `${id} 的描述里应该写了百分比`).toBeGreaterThan(0);
    /*
      ★ 0.2：一个技能里可能有**多组**星级三元组（空爆 = 被动溅射 + 主动加伤），
      所以把找到的所有三元组按顺序连起来，再和描述里的百分比逐个对。
      多出来的三元组排在后面是无害的（只比描述用到的那几个）。
    */
    const flat = bps.flat().map((value) => value / 100);
    expect(flat.length, `${id} 数据里的百分比个数不该少于描述`).toBeGreaterThanOrEqual(pcts.length);
    expect(flat.slice(0, pcts.length), `${id} 描述与数据不符`).toEqual(pcts);
  });

  it('★ op01 空爆 / op02 夕 的范围伤害就是 50%/100%/130%（曾经少了 10 倍）', () => {
    for (const id of ['op01', 'op02']) {
      // ★ 0.2：空爆现在有两组三元组（被动溅射 + 主动加伤），所以断言"包含"而不是"恰好等于"
      expect(arrayRatioBps(SKILLS[id]!), id).toContainEqual([5000, 10000, 13000]);
    }
  });
});

// ============================================================
// 3 星专属技能
// ============================================================

describe('★ 3 星专属技能：到三星只生效它，不生效 1/2 星的', () => {
  /** 找出所有"有 3 星专属技能"的干员 */
  const withStar3 = Object.values(UNIT_DEFS).filter((def) => !!def.skill.star3);

  it('真实数据里确实有一批 3 星专属技能（你说的 4/5 费那批）', () => {
    expect(withStar3.length).toBeGreaterThanOrEqual(10);
    // 你原话是"4.5费有些带着3星技能"，所以至少要覆盖 4 费
    expect(withStar3.some((def) => def.cost === 4)).toBe(true);
    expect(withStar3.some((def) => def.cost === 5)).toBe(true);
  });

  it('1 星和 2 星用的是同一套（不是 3 星那套）', () => {
    for (const def of withStar3) {
      for (const star of [1, 2]) {
        const variant = skillVariantOf(def, star);
        expect(variant.name, `${def.name} 在 ${star} 星不该用 3 星技能`).toBe(def.skill.name);
        expect(variant.effects).toBe(def.skill.effects);
      }
    }
  });

  it('★ 3 星用的是专属那套，而且和 1/2 星**完全不是同一批效果**', () => {
    for (const def of withStar3) {
      const variant = skillVariantOf(def, 3);
      expect(variant.name).toBe(def.skill.star3!.name);
      expect(variant.desc).toBe(def.skill.star3!.desc);
      // 关键：是"替换"而不是"叠加"
      expect(variant.effects).toBe(def.skill.star3!.effects);
      expect(variant.effects).not.toBe(def.skill.effects);
    }
  });

  it('1/2 星和 3 星的技能名不一样（不然界面上分不出来）', () => {
    for (const def of withStar3) {
      expect(def.skill.star3!.name, `${def.name} 的 3 星技能名和 1/2 星重名了`).not.toBe(def.skill.name);
    }
  });

  it('技能 id 全局唯一（战斗日志靠它分辨是谁的技能）', () => {
    const ids = Object.values(UNIT_DEFS).map((def) => def.skill.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('每个干员的技能 id 都带自己的 opXX 前缀', () => {
    for (const def of Object.values(UNIT_DEFS)) {
      expect(def.skill.id.startsWith(def.id), `${def.name} 的技能 id 是 ${def.skill.id}`).toBe(true);
    }
  });
});

// ============================================================
// 被动技能
// ============================================================

describe('被动技能：入场就生效、不攒法力', () => {
  /** 纯被动：有 passive，但没有要攒法力放的效果 */
  const passiveOnly = Object.values(UNIT_DEFS).filter(
    (def) => def.skill.passive && def.skill.effects.length === 0,
  );

  it('真实数据里确实有一批纯被动棋子（你写的「被动：xxx」）', () => {
    expect(passiveOnly.length).toBeGreaterThanOrEqual(5);
  });

  it('★ 纯被动棋子不算"能放技能"（否则日志里会刷满空的 cast 事件）', () => {
    for (const def of passiveOnly) {
      expect(hasActiveSkill(def, 1), `${def.name} 不该被当成主动技能`).toBe(false);
    }
  });

  it('有 3 星专属技能的棋子，1 星时算主动、3 星时看那套有没有效果', () => {
    for (const def of Object.values(UNIT_DEFS)) {
      if (!def.skill.star3) continue;
      const active1 = hasActiveSkill(def, 1);
      const active3 = hasActiveSkill(def, 3);
      expect(active1).toBe(def.skill.effects.length > 0);
      expect(active3).toBe(def.skill.star3.effects.length > 0);
    }
  });

  it('★ 被动真的进了战斗：空弦按场上 [远射] 人数加射程（含自己）', () => {
    /*
      ★ 0.2：空弦的被动从「攻击距离 +1/+2/+2」改成了
      「**每上场 2 名阵营为 [远射] 的干员，攻击距离 +2 格**」。
      这条被动是**队伍级**信息（要数场上有几个远射）⇒ 在 createBattle 里
      开局折算成固定 `rangeFlat` 挂成常驻包。
      这一条守的就是"折算真的进了战斗"，而不只是数据表里写了一行
      （老鲤那条被动就曾经"配好了没人读"，见 gold-scaling-passive.test.ts）。
    */
    const def = UNIT_DEFS['op10']!;
    const scaling = def.skill.passive?.allyTraitRangeFlat;
    expect(scaling, '空弦的被动是"按场上 [远射] 人数加射程"').toBeDefined();
    expect(scaling!.trait).toBe('ranged');

    // 全库里带这个标签的干员（空弦自己也在里面 —— 口径是"含自己"）
    const ranged = Object.values(UNIT_DEFS).filter(
      (d) => d.traits.includes(scaling!.trait) && !d.summonOnly && !d.monsterOnly,
    );
    expect(ranged.length, '至少要有 3 个 [远射] 才能验证"每 2 名一步"').toBeGreaterThanOrEqual(3);

    /** 场上放 n 名 [远射]（第 0 个固定是空弦），返回空弦的射程 */
    const rangeWith = (n: number, star: number): number => {
      const pick = [def, ...ranged.filter((d) => d.id !== def.id)].slice(0, n);
      const units: UnitPlacement[] = pick.map((d, i) => ({
        defId: d.id,
        star: i === 0 ? star : 1,
        cell: { col: 4, row: 4 + i },
      }));
      const state = createBattle(UNIT_DEFS, [{ team: 0, units }, { team: 1, units: [] }], 1);
      const kx = state.units.find((u) => u.defId === def.id)!;
      return effectiveRange(state, kx);
    };

    // 只有自己 1 名 ⇒ 不够一步（1 < 2）⇒ 射程就是面板值
    expect(rangeWith(1, 1)).toBe(def.base.range);
    // 2 名 ⇒ 1 步 × 2 格
    expect(rangeWith(2, 1)).toBe(def.base.range + 2);
    // 4 名 ⇒ 2 步 × 2 格
    expect(rangeWith(4, 1)).toBe(def.base.range + 4);
  });

  it('★ 玛恩纳的被动「生命值提升1000」真的加了血量上限', () => {
    // 玛恩纳（op47）被动里有 hpFlat: 1000（单位是"点"，会换算成内部的定点数）
    expect(UNIT_DEFS['op47']!.skill.passive?.hpFlat).toBe(1000);
    const one = createBattle(UNIT_DEFS, soloSetup('op47', 1), 1).units[0]!;
    // 血量上限 = 基础 × 星级 + 1000
    const expected = Math.round(UNIT_DEFS['op47']!.base.hp * 1000) + 1000 * 1000;
    // 允许星级倍率带来的取整误差
    expect(Math.abs(one.maxHp - expected)).toBeLessThan(2000);
    // 满血开局（被动加上限之后要把当前血量也拉满，否则开局就"少了 1000 血"）
    expect(one.hp).toBe(one.maxHp);
  });
});

// ============================================================
// 法力回复方式
// ============================================================

describe('★ 法力回复方式（你给的三种）', () => {
  it('真实数据里三种都存在', () => {
    const sources = new Set(Object.values(UNIT_DEFS).map((def) => def.skill.manaSource));
    expect(sources.has('attack')).toBe(true);
    expect(sources.has('damage')).toBe(true);
    expect(sources.has('auto')).toBe(true);
  });

  it('近战大多是受击回复、远程大多是攻击回复（我按定位推的那条规则）', () => {
    // 只比干员：野怪的回蓝方式是按级别模板给的，混进来会让这条统计失真
    const isOperator = (def: UnitDef): boolean => !def.summonOnly && !def.monsterOnly;
    const melee = Object.values(UNIT_DEFS).filter((def) => def.base.range === 1 && isOperator(def));
    const ranged = Object.values(UNIT_DEFS).filter((def) => def.base.range >= 3 && isOperator(def));
    const count = (list: UnitDef[], source: string): number =>
      list.filter((def) => def.skill.manaSource === source).length;
    const share = (list: UnitDef[], source: string): number => count(list, source) / list.length;
    /*
      ★ 0.2：这里原来写的是「近战里受击回复**超过一半**」。
      0.2 按策划表把一批法力回复重排过（老鲤 / 星熊 / 砾 这种纯被动改成 `none`、
      古米改成 `auto`），近战里受击回复正好 **8/16 = 0.5** ⇒ `toBeGreaterThan(0.5)` 卡死。
      这说明"过半"本来就是个脆的写法（改两三个干员就翻）。改成贴近规则本身的三条：
        · 近战里**受击回复是最多的那一种**（比攻击回复、比 none 都多）
        · **没有一个远程是受击回复**（挨打回蓝就是近战的定位特征）
        · 远程里攻击回复仍然过半
      这几条同样能抓住"整批回蓝方式被改错"，但不会被个别干员的重排误伤。
    */
    expect(count(melee, 'damage'), '近战里受击回复要比攻击回复多').toBeGreaterThan(count(melee, 'attack'));
    expect(count(melee, 'damage'), '近战里受击回复要是最多的那一种').toBeGreaterThan(count(melee, 'none'));
    expect(count(ranged, 'damage'), '远程不该有受击回复').toBe(0);
    expect(share(ranged, 'attack')).toBeGreaterThan(0.5);
  });

  it('★ 攻击回复的棋子挨打不回蓝', () => {
    /*
      【为什么不"跑一场战斗然后看它有没有蓝"？】
      因为那样测不准：攻击回复的棋子会**自己走过去打人**，
      打人也会攒蓝 —— 最后不管是"挨打攒的"还是"打人攒的"都分不清。
      所以这里直接调 dealDamage，把"只挨打"这一个动作单独拎出来。
    */
    const state = createBattle(
      UNIT_DEFS,
      duel({ defId: 'op05', star: 1, col: 4, row: 4 }, { defId: 'op28', star: 1, col: 5, row: 4 }),
      3,
    );
    const victim = state.units.find((unit) => unit.defId === 'op05')!;
    const attacker = state.units.find((unit) => unit.defId === 'op28')!;
    expect(victim.manaSource).toBe('attack');
    victim.mana = 0;

    dealDamage(state, attacker, victim, 5000, 'physical', 'attack');

    expect(victim.hp, '应该确实掉血了（不然这条测试没意义）').toBeLessThan(victim.maxHp);
    expect(victim.mana, '攻击回复的棋子不该因为挨打而攒法力').toBe(0);
  });

  it('★ 受击回复的棋子挨打会攒法力', () => {
    const state = createBattle(
      UNIT_DEFS,
      // ★ 0.2：古米（op03）改成了**自动回复**、左乐（op35）改成了**攻击回复**，
      //   这里换一个仍然是「受击回复」的干员（焰尾 op31）当样本
      duel({ defId: 'op31', star: 1, col: 4, row: 4 }, { defId: 'op28', star: 1, col: 5, row: 4 }),
      3,
    );
    const victim = state.units.find((unit) => unit.defId === 'op31')!;
    const attacker = state.units.find((unit) => unit.defId === 'op28')!;
    expect(victim.manaSource).toBe('damage');
    victim.mana = 0;

    dealDamage(state, attacker, victim, 5000, 'physical', 'attack');

    expect(victim.hp).toBeLessThan(victim.maxHp);
    expect(victim.mana, '受击回复的棋子挨打就该攒法力').toBeGreaterThan(0);
  });

  it('★★ 0.2 受击回复：**固定回 100**，与伤害量 / 伤害类型都无关', () => {
    /*
      【用户口径】「将受击回复从根据伤害计算回复数值改为固定值100」。
      老做法是 `伤害 × 万分比`（物理 20 / 法术 8）⇒ 充能速度取决于敌人打得多疼。
      现在 `MANA_MAX = 1000`，固定 100 ⇒ **挨 10 次打必定开一次技能**，
      和「每次普攻回 100」完全对称。
    */
    const state = createBattle(
      UNIT_DEFS,
      duel({ defId: 'op31', star: 1, col: 4, row: 4 }, { defId: 'op28', star: 1, col: 5, row: 4 }),
      3,
    );
    const victim = state.units.find((unit) => unit.defId === 'op31')!;
    const attacker = state.units.find((unit) => unit.defId === 'op28')!;
    expect(victim.manaSource).toBe('damage');

    // 轻 / 重 / 极重 / 法术，回的都是 100（不按伤害量算、也不分类型）
    // ★ 数值要选"打完确实掉了血"的档：太小的伤害会被护甲减免成 0，
    //   那属于"没真的挨到"，本来就不该给法力（见下面那条独立用例）。
    const cases: Array<[number, 'physical' | 'magic', 'attack' | 'spell']> = [
      [5000, 'physical', 'attack'],
      [50000, 'physical', 'attack'],
      [500000, 'physical', 'attack'],
      [50000, 'magic', 'spell'],
    ];
    for (const [amount, damageType, attackType] of cases) {
      victim.hp = victim.maxHp;
      victim.mana = 0;
      const hpBefore = victim.hp;
      dealDamage(state, attacker, victim, amount, damageType, attackType);
      expect(victim.hp, `前提：${amount} 点伤害要真的打掉血`).toBeLessThan(hpBefore);
      expect(
        victim.mana,
        `${amount} 点 ${damageType} 伤害也应该是固定 100`,
      ).toBe(MANA_FROM_DAMAGE_TAKEN);
    }
    expect(MANA_FROM_DAMAGE_TAKEN, '1000 ÷ 100 = 挨 10 次开一次技能').toBe(100);
  });

  it('★ 0.2 受击回复：一点伤害都没挨到（被护盾全挡）就不给法力', () => {
    /*
      "受击"的前提是**真的掉血**。免疫 / 闪避 / 护盾全挡下来不算挨打 ——
      否则带盾的受击回蓝棋子会变成"开着盾无限放技能"。
      内核传给这个函数的是 `actual = 打完之后实际掉了多少血`，
      所以"全挡下来"进来就是 0 —— 这里直接喂 0 验那条闸门。
    */
    const state = createBattle(
      UNIT_DEFS,
      duel({ defId: 'op31', star: 1, col: 4, row: 4 }, { defId: 'op28', star: 1, col: 5, row: 4 }),
      3,
    );
    const victim = state.units.find((unit) => unit.defId === 'op31')!;
    victim.mana = 0;
    const hpBefore = victim.hp;

    gainManaFromDamageTaken(state, victim, 0);

    expect(victim.hp, '前提：这一下没造成任何伤害').toBe(hpBefore);
    expect(victim.mana, '没真的挨打到就不该白给法力').toBe(0);

    // 换成"真的掉血了"就应该回 100
    gainManaFromDamageTaken(state, victim, 1);
    expect(victim.mana).toBe(MANA_FROM_DAMAGE_TAKEN);
  });

  it('★ 自动回复的棋子：法力随时间涨，不用打人也不用挨打', () => {
    const autoUnit = Object.values(UNIT_DEFS).find(
      (def) => def.skill.manaSource === 'auto' && (def.skill.manaPerSecond ?? 0) > 0,
    )!;
    const state = runFor(UNIT_DEFS, soloSetup(autoUnit.id, 1), s(3));
    const unit = state.units[0]!;
    // 3 秒 × 每秒 manaPerSecond 点（被 MANA_MAX 截断）
    expect(unit.mana).toBeGreaterThan(0);
  });

  it('玛恩纳写的是「技力随时间回复，每秒 7.5%」，对应每秒 75 点', () => {
    expect(UNIT_DEFS['op47']!.skill.manaSource).toBe('auto');
    /*
      ★ 0.2：面板从「大概 10 秒充满」改成明确的「每秒回复 7.5%」
      ⇒ 1000（法力上限）× 7.5% = 75/秒（旧值 100）。
    */
    expect(UNIT_DEFS['op47']!.skill.manaPerSecond).toBe(75);
    // 1000 点法力上限 ÷ 75/秒 ≈ 13.33 秒
    expect(1000 / UNIT_DEFS['op47']!.skill.manaPerSecond!).toBeCloseTo(13.33, 2);
  });
});

// ============================================================
// 召唤物 / 陷阱
// ============================================================

describe('★ 召唤物（先用空白卡面代替，但功能要真的能用）', () => {
  it('三个召唤物都在表里，而且都标了 summonOnly', () => {
    const ids = Object.keys(SUMMON_DEFS);
    expect(ids.length).toBeGreaterThanOrEqual(3);
    for (const id of ids) {
      expect(UNIT_DEFS[id], `${id} 应该在主表里（战斗内核只认一张表）`).toBeDefined();
      expect(UNIT_DEFS[id]!.summonOnly).toBe(true);
    }
  });

  it('★ 召唤物不会被抽到：它不在任何费用的牌库里', () => {
    /*
      ★ 0.1.1 藏品二版：这条断言原来写的是"召唤物的 traits 必须是空的"。
      加了【炎佑】（天师锦囊召唤）之后不成立了 —— 设计稿明确要求
      「激活大炎羁绊【炎佑】属性 +30%」，也就是它**要**算进大炎的人数里。
      所以"不会被抽到"这件事只能由 `summonOnly` + `isPlayableDef` 保证
      （商店 / 牌库 / 单机敌方三路统一看它），traits 是不是空的与这件事无关。
    */
    for (const id of Object.keys(SUMMON_DEFS)) {
      const def = UNIT_DEFS[id]!;
      expect(def.summonOnly, `${id} 必须标 summonOnly，否则会被商店抽到`).toBe(true);
      expect(isPlayableDef(def), `${id} 不该被当成"可抽到的棋子"`).toBe(false);
    }
  });

  it('★ 迷迭香的柱子真的会被召唤出来', () => {
    const skill = SKILLS['op18']!;
    /*
      ★ 0.2：迷迭香的技能变成"加攻速/攻击力 **+** 召唤柱子"，
      所以召唤不再是 `effects[0]` —— 按 `kind` 找，别再按下标取
      （那种写法一改数据就红，而且报错信息还指向错误的原因）。
    */
    const summonEffect = skill.effects.find((effect) => effect.kind === 'summon');
    if (!summonEffect || summonEffect.kind !== 'summon') throw new Error('数据变了：找不到召唤效果');
    expect(summonEffect.summonId).toBe('summon_pillar');
    // ★ 0.2：持续 20 秒 -> 5/6/7 秒（按星级）
    expect(summonEffect.durationTicks).toEqual([s(5), s(6), s(7)]);
    expect(summonEffect.place).toBe('besideEnemy');

    const teams = duel(
      { defId: 'op18', star: 1, col: 4, row: 4 },
      { defId: 'op09', star: 3, col: 5, row: 4 },
    );
    const state = createBattle(UNIT_DEFS, teams, 7);
    const caster = state.units.find((unit) => unit.defId === 'op18')!;
    // 直接把法力灌满 + 让它这一帧就行动，省得等好几秒
    caster.mana = 1000;
    caster.nextActionTick = 0;
    step(state, UNIT_DEFS);

    const pillar = state.units.find((unit) => unit.defId === 'summon_pillar');
    expect(pillar, '放技能应该召唤出一根柱子').toBeDefined();
    expect(pillar!.isSummon).toBe(true);
    expect(pillar!.taunt, '柱子要能嘲讽（你写的"嘲讽最近的敌人"）').toBe(true);
    expect(pillar!.expiresAtTick, '柱子应该带上"5 秒后自动消失"的时刻（1 星）').toBe(state.tick + s(5));
    // 柱子一落地就会被贴脸的敌人打（嘲讽生效了），所以只能看"血上限"：
    // 那才是技能里按星级写死的那个"柱子血量"
    expect(pillar!.maxHp, '柱子血量应该按施法者星级取（1 星 = 250）').toBe(250 * 1000);

    /*
      【落点必须挨着敌人】
      柱子是拿来"卡住敌人"的，落在敌人背后就白放了。
      这一条也钉住了"瞬移/召唤落点优先攻击距离内"的规则：
      早期那个版本会优先落在自己半场（等于放到了两格外，一点用都没有）。
    */
    const enemy = state.units.find((unit) => unit.defId === 'op09')!;
    expect(
      cellDistance(pillar!.cell, enemy.cell, 'orthogonal'),
      '柱子应该落在敌人的攻击距离内（正贴着它）',
    ).toBeLessThanOrEqual(1);
  });

  it('★ 召唤物持续时间到了就自己死掉（不需要被打死）', () => {
    /*
      【为什么单独一条？】
      "持续 N 秒后自动死亡"是召唤物的核心规则之一，但它很容易被写成
      "反正它会被打死" —— 那样测试就是空的：不管有没有到期逻辑都能过。
      所以这里把召唤物放在**没人会路过的角落**，给它一个很短的持续时间，
      这样它只可能"到期死"，不可能是被打死的。
    */
    const teams: [TeamSetup, TeamSetup] = [
      { team: 0, units: [{ defId: 'op27', star: 3, cell: { col: 4, row: 4 } }] },
      { team: 1, units: [{ defId: 'op09', star: 3, cell: { col: 5, row: 4 } }] },
    ];
    const state = createBattle(UNIT_DEFS, teams, 5);
    const owner = state.units.find((unit) => unit.team === 0)!;

    const lifeTicks = 20;
    // 金狮子（不会嘲讽，所以敌人不会专门跑过来打它）放在左上角
    const lion = spawnSummon(state, UNIT_DEFS['summon_lion']!, owner, { col: 0, row: 0 }, {
      hp: 800 * 1000,
      durationTicks: lifeTicks,
    })!;
    expect(lion).toBeDefined();
    expect(lion.isSummon).toBe(true);
    expect(lion.expiresAtTick).toBe(state.tick + lifeTicks);

    for (let i = 0; i < lifeTicks - 1; i++) step(state, UNIT_DEFS);
    expect(state.over, '为了保证测试有效，这一场必须还没打完').toBe(false);
    expect(lion.dead, '还没到期，召唤物应该活着').toBe(false);
    expect(lion.hp, '这期间没人碰得到它 —— 它必须一点血都没掉').toBe(lion.maxHp);

    for (let i = 0; i < 3; i++) step(state, UNIT_DEFS);
    expect(lion.dead, '到期后召唤物应该自己消失，而不是继续站在场上').toBe(true);
    expect(lion.hp, '到期消失要把血量清 0').toBe(0);
  });

  it('★ 望的棋子是陷阱：敌人靠近就爆炸，然后自己消失', () => {
    const teams = duel(
      { defId: 'op42', star: 1, col: 4, row: 4 },
      { defId: 'op09', star: 3, col: 5, row: 4 },
    );
    const state = createBattle(UNIT_DEFS, teams, 11);
    const caster = state.units.find((unit) => unit.defId === 'op42')!;
    caster.mana = 1000;
    caster.nextActionTick = 0;
    // 放技能需要先锁定目标，所以先跑一帧让它选目标
    step(state, UNIT_DEFS);
    caster.mana = 1000;
    caster.nextActionTick = 0;
    step(state, UNIT_DEFS);

    const trap = state.units.find((unit) => unit.defId === 'summon_trap');
    expect(trap, '放技能应该放下一枚棋子').toBeDefined();
    expect(trap!.trap, '它身上要带着爆炸参数').toBeDefined();
    expect(trap!.trap!.radius).toBe(1);

    const enemy = state.units.find((unit) => unit.defId === 'op09')!;
    const hpBefore = enemy.hp;
    // 等敌人走进爆炸范围（陷阱放在攻击范围最末端，敌人本来就在附近）
    for (let i = 0; i < s(30) && !state.over; i++) {
      step(state, UNIT_DEFS);
      if (state.units.find((unit) => unit.id === trap!.id)!.dead) break;
    }
    expect(enemy.hp, '敌人进范围后应该吃到爆炸伤害').toBeLessThan(hpBefore);
  });

  it('望的棋子是陷阱，带爆炸半径和倍率（0.2：一次下两枚、落点改成敌人身旁）', () => {
    const skill = SKILLS['op42']!;
    const traps = skill.effects.filter((effect) => effect.kind === 'trap');
    /*
      ★ 0.2：从"攻击范围最末端放 1 枚"改成**两个效果各下 1 枚** ——
      分别落在"攻击范围内百分比血量最高的敌人身旁"和"全场血量最低的敌人身旁"
      （身旁没空格时由内核退回"攻击范围末端"，见 skills.ts 的 trapBesideEnemyCell）。
    */
    expect(traps, '望的 1/2 星技能应该是两处陷阱').toHaveLength(2);
    const places = traps.map((trap) => (trap.kind === 'trap' ? trap.place : ''));
    expect(places.sort()).toEqual(['besideHighestHpRatioEnemy', 'besideLowestHpEnemy']);
    for (const trap of traps) {
      if (trap.kind !== 'trap') continue;
      expect(trap.trapId).toBe('summon_trap');
      /*
        ★★ 0.2 修 bug：这里原来钉的是 `[20000, 30000, 30000]` —— 也就是把
        **数据里那个错值原封不动抄进了断言**。`trap.power` 是**千分比**
        （换算在 skills.ts：`power = attackDamage * 效果.power / FIX`），
        所以 20000 表示 2000% 攻击力，是策划表写的 200% 的 10 倍。
        断言抄数据 ≠ 验证数据：这条当时"通过"了，却把一个 10 倍的伤害放进了游戏。
        现在钉的是**策划表的百分比**（200%/300% ⇒ 千分比 2000/3000），
        并在 rework-0.2.test.ts 里放了一条"量纲绊线"防止再犯。
      */
      expect(trap.power).toEqual([2000, 3000, 3000]);
    }
    // 3 星是"全场随机 7 个"
    const star3Trap = skill.star3?.effects.find((effect) => effect.kind === 'trap');
    if (!star3Trap || star3Trap.kind !== 'trap') throw new Error('望的 3 星应该是随机撒 7 个');
    expect(star3Trap.place).toBe('randomSpread');
    expect(star3Trap.count).toBe(7);
  });

  it('召唤物的血量按施法者星级走（柱子 250/350/600）', () => {
    const skill = SKILLS['op18']!;
    const effect = skill.effects.find((item) => item.kind === 'summon');
    if (!effect || effect.kind !== 'summon') throw new Error('数据变了：找不到召唤效果');
    // ★ 0.2：300/500/700 -> 250/350/600
    expect(effect.hp).toEqual([250, 350, 600]);
  });

  it('维娜的金狮子有血量和攻击力（0.2：召唤挪到了 3 星技能）', () => {
    const skill = SKILLS['op49']!;
    /*
      ★ 0.2：维娜的**主动**技能换成了"给自己 +1 射程、额外目标、攻速/攻击力、
      攻击变真实伤害"，**召唤金狮子挪进了 3 星技能**，
      而且数值统一成 2000 生命 / 150 攻击（以前 800/1000 与 100/150 分星级）。
    */
    const effect = skill.star3?.effects[0];
    if (!effect || effect.kind !== 'summon') throw new Error('数据变了');
    expect(effect.summonId).toBe('summon_lion');
    expect(effect.hp).toEqual([2000, 2000, 2000]);
    expect(effect.attackDamage).toEqual([150, 150, 150]);
    // 主动技能现在是给自己上 buff，**不该再召唤**
    expect(skill.effects.some((item) => item.kind === 'summon')).toBe(false);
    // 狮子"会正常移动和攻击"，所以不能有 noAttack
    expect(SUMMON_DEFS['summon_lion']!.skill.passive?.noAttack).toBeUndefined();
  });

  it('柱子不会攻击也不会移动（你写的"不会攻击不会移动"）', () => {
    expect(SUMMON_DEFS['summon_pillar']!.skill.passive?.noAttack).toBe(true);
    expect(SUMMON_DEFS['summon_pillar']!.skill.passive?.noMove).toBe(true);
  });
});

// ============================================================
// 开局的起手法力
// ============================================================

describe('★ 开局的起手法力（按星级给）', () => {
  it('1 星不给起手法力，高星才有 —— 1 星对局的手感因此完全没变', () => {
    const one = createBattle(UNIT_DEFS, soloSetup('op08', 1), 1).units[0]!;
    const two = createBattle(UNIT_DEFS, soloSetup('op08', 2), 1).units[0]!;
    const three = createBattle(UNIT_DEFS, soloSetup('op08', 3), 1).units[0]!;
    expect(one.mana).toBe(0);
    expect(two.mana).toBeGreaterThan(0);
    expect(three.mana).toBeGreaterThan(two.mana);
  });

  it('★ 3 星能比 1 星快很多放出技能（这就是"3 星质变"的来源）', () => {
    /*
      加这个机制的原因：探针发现 3 星 5 费单挑一整队时，
      5~6 秒就被打死，而死的时候法力只有 600/1000 —— **一次技能都没放出来**。
      也就是说"3 星专属技能"这个卖点在实战里根本看不到。
      根因是"攒满要打 10 下"太慢，但又不能全局调低法力上限
      （那会让 1 星的技能也几秒一次，"持续 10 秒"的增益变成永久）。
      所以改成"升星同时给起手法力"。
    */
    const def = UNIT_DEFS['op08']!; // 拉普兰德，攻击回复
    const perAttack = def.base.manaPerAttack;
    const one = createBattle(UNIT_DEFS, soloSetup('op08', 1), 1).units[0]!;
    const three = createBattle(UNIT_DEFS, soloSetup('op08', 3), 1).units[0]!;
    const attacksNeeded = (unit: { mana: number }): number => Math.ceil((1000 - unit.mana) / perAttack);
    expect(attacksNeeded(three), '3 星应该比 1 星少打很多下').toBeLessThan(attacksNeeded(one));
    // 1 星还是 10 下（和以前完全一样），3 星只要 4 下
    expect(attacksNeeded(one)).toBe(10);
    expect(attacksNeeded(three)).toBe(4);
  });

  it('起手法力不会超过法力上限', () => {
    for (const star of [1, 2, 3]) {
      const unit = createBattle(UNIT_DEFS, soloSetup('op45', star), 1).units[0]!;
      expect(unit.mana).toBeLessThanOrEqual(1000);
    }
  });
});

// ============================================================
// 眩晕（这里修过一个"永远醒不过来"的 bug）
// ============================================================

describe('★ 眩晕：被连续晕不会永远醒不过来', () => {
  /*
    这个 bug 的现象是：被连续眩晕的棋子**再也不会行动，而且不报任何错**。
    根因是 applyStun 里多写了一行 `nextActionTick += durationTicks`，
    等于同一段眩晕算了两遍；更要命的是它**累加** ——
    只要对方的眩晕来得比"推后的时间"更频繁，行动时间就一路涨到天上去。
    我是靠"3 星蕾缪安单挑一队胜率 0%"这条线索、逐 tick 打印才挖出来的。
  */
  it('施加眩晕**不该**直接改行动时间（延迟由主循环统一处理）', () => {
    const state = createBattle(
      UNIT_DEFS,
      duel({ defId: 'op17', star: 1, col: 4, row: 4 }, { defId: 'op03', star: 1, col: 5, row: 4 }),
      5,
    );
    const victim = state.units.find((unit) => unit.defId === 'op17')!;
    const attacker = state.units.find((unit) => unit.defId === 'op03')!;
    victim.nextActionTick = 100;
    applyStun(state, attacker, victim, 20);
    expect(victim.statuses['stun']).toBe(20);
    expect(victim.nextActionTick, '眩晕只该记状态，不该顺手推行动时间').toBe(100);
  });

  it('★ 连续晕 3 次，行动时间不会被越推越远', () => {
    const state = createBattle(
      UNIT_DEFS,
      duel({ defId: 'op17', star: 1, col: 4, row: 4 }, { defId: 'op03', star: 1, col: 5, row: 4 }),
      5,
    );
    const victim = state.units.find((unit) => unit.defId === 'op17')!;
    const attacker = state.units.find((unit) => unit.defId === 'op03')!;
    victim.nextActionTick = 100;
    for (let i = 0; i < 3; i++) applyStun(state, attacker, victim, 20);
    // 累加的话会变成 160，那才是 bug
    expect(victim.nextActionTick).toBe(100);
    // 眩晕时长取最大值，不是相加（否则三下就晕 3 秒，等于控到死）
    expect(victim.statuses['stun']).toBe(20);
  });

  it('★ 被晕 1 秒之后能恢复行动', () => {
    const state = createBattle(
      UNIT_DEFS,
      duel({ defId: 'op17', star: 1, col: 4, row: 4 }, { defId: 'op03', star: 1, col: 5, row: 4 }),
      9,
    );
    const victim = state.units.find((unit) => unit.defId === 'op17')!;
    const attacker = state.units.find((unit) => unit.defId === 'op03')!;
    const countAttacks = (id: number): number =>
      state.log.filter((event) => event.type === 'attack' && event.unitId === id).length;

    victim.nextActionTick = 0;
    applyStun(state, attacker, victim, s(1));
    // 晕的这 1 秒里不该出手
    for (let i = 0; i < s(1) - 1; i++) step(state, UNIT_DEFS);
    expect(countAttacks(victim.id), '晕着的时候不该出手').toBe(0);

    // 晕完之后必须能恢复（以前这里会永远卡住）
    for (let i = 0; i < s(3); i++) step(state, UNIT_DEFS);
    expect(countAttacks(victim.id), '眩晕结束后必须能恢复行动').toBeGreaterThan(0);
  });
});

// ============================================================
// 范围指示（白框 / 绿框）
// ============================================================

describe('★ 范围效果的指示事件（界面靠它画白框/绿框）', () => {
  /*
    【为什么要单独记一条事件？】
    因为回放只读事件日志，它不知道"这次溅射半径是多少""这次是打还是奶"。
    由内核在真正生效的那一刻记下范围，界面照着画 ——
    这样画出来的框**一定和实际生效的范围一致**，
    不会出现"框画得很大、其实只打到一个人"这种骗人的表现。
  */
  const base = tableOf([
    makeDef('splasher', [], { range: 3, attackDamage: 100 }),
    makeDef('ally', [], { hp: 100000 }),
    makeDef('dummy', [], { hp: 100000 }),
  ]);

  /** 给一个棋子换上"带被动"的技能（这样不用攒法力就能测范围效果） */
  function withPassive(table: UnitDefTable, id: string, passive: NonNullable<SkillDef['passive']>): UnitDefTable {
    return { ...table, [id]: { ...table[id]!, skill: { ...table[id]!.skill, passive } } };
  }

  it('★ 范围伤害会记一条「白框」：范围/形状/类型都对得上', () => {
    const table = withPassive(base, 'splasher', {
      splash: { radius: 1, shape: 'square', ratioBp: 5000, damageType: 'physical' },
    });
    const teams: [TeamSetup, TeamSetup] = [
      team(0, [{ defId: 'splasher', col: 4, row: 4 }] ),
      // 目标贴着它，旁边再站一个，保证溅射真的扫到了人
      team(1, [{ defId: 'dummy', col: 5, row: 4 }, { defId: 'dummy', col: 5, row: 5 }] ),
    ];
    const state = runToEnd(table, teams, 31);
    const zones = state.log.filter((event) => event.type === 'zone');
    expect(zones.length, '溅射扫到人了就该记范围事件').toBeGreaterThan(0);

    const zone = zones[0]!;
    if (zone.type !== 'zone') throw new Error('类型收窄失败');
    expect(zone.kind, '范围伤害画白框').toBe('damage');
    expect(zone.radius, '3×3 的半径是 1').toBe(1);
    expect(zone.shape).toBe('square');
    expect(zone.unitId, '要能查出是谁放的').toBe(state.units[0]!.id);
    expect(zone.durationTicks).toBeGreaterThan(0);
  });

  it('★ 十字形溅射会如实记成 cross（不能画成 3×3 方块）', () => {
    const table = withPassive(base, 'splasher', {
      splash: { radius: 1, shape: 'cross', ratioBp: 5000, damageType: 'physical' },
    });
    const teams: [TeamSetup, TeamSetup] = [
      team(0, [{ defId: 'splasher', col: 4, row: 4 }] ),
      team(1, [{ defId: 'dummy', col: 5, row: 4 }, { defId: 'dummy', col: 5, row: 5 }] ),
    ];
    const state = runToEnd(table, teams, 33);
    const zone = state.log.find((event) => event.type === 'zone');
    expect(zone).toBeDefined();
    if (!zone || zone.type !== 'zone') throw new Error('类型收窄失败');
    // 空爆/夕 写的"周围4格"就是十字，画成 3×3 会把"打 4 格"表现成"打 9 格"
    expect(zone.shape).toBe('cross');
  });

  it('★ 回血光环会记一条「绿框」，中心是施法者自己', () => {
    const table = withPassive(base, 'splasher', {
      pulse: {
        intervalTicks: 20,
        radius: 2,
        affect: 'allies',
        heal: { basis: 'targetMaxHp', ratioBp: 500 },
      },
    });
    const teams: [TeamSetup, TeamSetup] = [
      team(0, [{ defId: 'splasher', col: 4, row: 4 }, { defId: 'ally', col: 4, row: 5 }] ),
      team(1, [{ defId: 'dummy', col: 5, row: 4 }] ),
    ];
    const state = createBattle(table, teams, 35);
    const healer = state.units.find((unit) => unit.defId === 'splasher')!;
    // 先打掉一点血，不然满血时治疗量是 0、也就不会记框
    const ally = state.units.find((unit) => unit.defId === 'ally')!;
    ally.hp = Math.floor(ally.maxHp / 2);
    for (let i = 0; i < 60 && !state.over; i++) step(state, table);

    const zones = state.log.filter((event) => event.type === 'zone');
    expect(zones.length, '光环回血时该记范围事件').toBeGreaterThan(0);
    const zone = zones[0]!;
    if (zone.type !== 'zone') throw new Error('类型收窄失败');
    expect(zone.kind, '回血画绿框').toBe('heal');
    expect(zone.radius).toBe(2);
    expect(zone.cell, '光环的中心是施法者自己').toEqual({ col: healer.cell.col, row: healer.cell.row });
  });

  it('★ 3×3 范围必须打到**斜角**那一格', () => {
    /*
      【一个差点混过去的 bug】
      "方形范围"原来同时用了两个距离条件：
        |Δ列| ≤ r 且 |Δ行| ≤ r 且 **曼哈顿距离** ≤ r
      对四方向移动的棋子，最后那条会把斜角格排除掉 ——
      于是"炮手溅射 3×3"实际只打到一个十字（5 格），斜角 4 格永远打不到。
      伤害数字照常跳，只是偏低一点，**从结果上几乎看不出来**。

      我是在加"范围白框"的时候发现的：白框框住了 9 格，
      但日志里只有 5 格掉血 —— 两边对不上才暴露出来。

      这条测试就是钉住那个斜角：目标在 (5,4)，斜角那个敌人在 (4,5)。
    */
    const table = withPassive(base, 'splasher', {
      splash: { radius: 1, shape: 'square', ratioBp: 5000, damageType: 'physical' },
    });
    const teams: [TeamSetup, TeamSetup] = [
      team(0, [{ defId: 'splasher', col: 4, row: 4 }]),
      /*
        主目标 (5,5)（距离 2，在射程 3 内）；
        "斜角那个"放在 (6,4) —— 相对主目标是斜上一格（|Δ列|=1、|Δ行|=1），
        但曼哈顿距离是 2。旧写法会把它排除掉，新写法必须打到它。
        （不能放 (4,6)：那是队伍 0 的半场。）
      */
      team(1, [{ defId: 'dummy', col: 5, row: 5 }, { defId: 'dummy', col: 6, row: 4 }]),
    ];
    const state = runToEnd(table, teams, 41);

    // 只看"敌方挨打"的事件（我方也会挨打，不能混进来）
    const enemyIds = new Set(state.units.filter((unit) => unit.team === 1).map((unit) => unit.id));
    const hitEnemies = new Set<number>();
    for (const event of state.log) {
      if (event.type === 'damage' && enemyIds.has(event.targetId)) hitEnemies.add(event.targetId);
    }
    expect(hitEnemies.size, '两个敌人都该吃到溅射（含斜角那个）').toBe(2);
  });

  it('★ 空放不画框（没打到人就不该闪一个框）', () => {
    const table = withPassive(base, 'splasher', {
      splash: { radius: 1, shape: 'square', ratioBp: 5000, damageType: 'physical' },
    });
    // 敌人站在对角，开局这段时间双方都还没碰到
    const teams: [TeamSetup, TeamSetup] = [
      team(0, [{ defId: 'splasher', col: 0, row: 0 }] ),
      team(1, [{ defId: 'dummy', col: 9, row: 9 }] ),
    ];
    const state = runToEnd(table, teams, 37);
    expect(state.log.filter((event) => event.type === 'zone').length).toBe(0);
  });
});

// ============================================================
// 3 星高费的额外血量（"一人杀穿一队"的底子）
// ============================================================

describe('★ 3 星高费的额外生命（3 星质变）', () => {
  /*
    你要求的："将 3 星 5 费的生命值都提高很多"。

    为什么是"纯加血量"而不是加攻击力：
    加攻击力只会让**本来就能赢的对局更碾压**，输的对局照样输；
    而 3 星 5 费一个人打一整队时，真正的瓶颈是"撑不到技能打完就被磨死"。
    加血量才真正改变结局。探针实测：维什戴尔单挑 38% → 100%、凯尔希 68% → 100%。
  */
  const hpOf = (defId: string, star: number): number =>
    createBattle(UNIT_DEFS, soloSetup(defId, star), 1).units[0]!.maxHp;

  it('★ 5 费 3 星的血量 = "正常 3 星" × 2，再加 5000', () => {
    const normal = hpOf('op45', 1) * 3.24; // 1 星血 × 1.8²
    /*
      ★ 用户后来追加了一条：「给全部 3 星 5 费干员加 5000 血量上限」，
      所以这里不再只是"两倍"，而是**两倍 + 5000**（两层叠加，语义不同：
      一层是乘算的"3 星质变"，一层是加算的固定值）。
      精确值由 star3-hp.test.ts 钉死；这里留 ±5% 是给"3 星会换成另一套技能、
      那套技能可能自带 hpFlat"留的余量。
    */
    const expected = normal * 2 + 5000 * 1000;
    expect(hpOf('op45', 3)).toBeGreaterThan(expected * 0.95);
    expect(hpOf('op45', 3)).toBeLessThan(expected * 1.05);
  });

  it('★ 4 费 3 星的血量 = "正常 3 星" × 1.2，再加 3000', () => {
    const normal = hpOf('op40', 1) * 3.24;
    /*
      ★ 用户后来追加了一条：「给全部 3 星 4 费干员加 3000 血量上限」，
      所以比例从 1.2 变成 **1.2 + 固定 3000**（乘算那层和加算那层叠加）。
      精确值由 star3-hp.test.ts 钉死；这里留 ±5% 是给"3 星会换成另一套技能、
      那套技能可能自带 hpFlat"留的余量。
    */
    const expected = normal * 1.2 + 3000 * 1000;
    expect(hpOf('op40', 3)).toBeGreaterThan(expected * 0.95);
    expect(hpOf('op40', 3)).toBeLessThan(expected * 1.05);
  });

  it('★ 1~3 费一点没变（低费 3 星不该反超高费）', () => {
    const normal = hpOf('op08', 1) * 3.24;
    expect(Math.abs(hpOf('op08', 3) - normal)).toBeLessThan(normal * 0.01);
  });

  it('★ 额外血量只给 3 星，2 星完全没变', () => {
    const two = createBattle(UNIT_DEFS, soloSetup('op45', 2), 1).units[0]!;
    const normal = UNIT_DEFS['op45']!.base.hp * 1000 * 1.8;
    expect(Math.abs(two.maxHp - normal)).toBeLessThan(normal * 0.01);
  });

  it('★ 只加血、不加攻击力（加攻击力只会让碾压局更碾压）', () => {
    const three = createBattle(UNIT_DEFS, soloSetup('op45', 3), 1).units[0]!;
    const normal = UNIT_DEFS['op45']!.base.attackDamage * 1000 * 3.24;
    expect(Math.abs(three.attackDamage - normal)).toBeLessThan(normal * 0.01);
  });
});


describe('★ 50 个干员的技能都录进去了', () => {
  // 0.0.3：野怪也有技能，但它们不是 opNN 干员（没有 3 星技能这套东西）
  // ★ 彩蛋棋子（维维美·绝对主角）也不在名单里：它是 20 费、没有星级机制的特殊存在，
  //   技能单独导出（EGG_SKILL），不走 SKILLS 表，所以这里一并排除。
  // ★ 0.3.2：升变形态（ascendOnly）也不在这条"商店名单"里 —— 判据统一走
  //   `isPlayableDef()`，以后再加一类"非卖品"不用到处补。
  const operators = Object.values(UNIT_DEFS).filter(
    (def) => isPlayableDef(def) && !def.noStar,
  );

  it('正式名单里的干员每个都有一条技能（0.2 追加 MujicaAve 五人后是 55）', () => {
    expect(operators).toHaveLength(55);
    for (const def of operators) {
      expect(SKILLS[def.id], `${def.name} 没有技能数据`).toBeDefined();
      expect(def.skill.effects.length + (def.skill.passive ? 1 : 0) + (def.skill.battleStart?.length ?? 0)).toBeGreaterThan(0);
    }
  });

  it('每个技能都有名字和描述（界面要显示）', () => {
    for (const [id, skill] of Object.entries(SKILLS)) {
      expect(skill.name.length, `${id} 的技能没有名字`).toBeGreaterThan(0);
      expect(skill.desc.length, `${id} 的技能没有描述`).toBeGreaterThan(0);
      if (skill.star3) {
        expect(skill.star3.name.length).toBeGreaterThan(0);
        expect(skill.star3.desc.length).toBeGreaterThan(0);
      }
    }
  });

  it('★ 4 费和 5 费：只有这几位没写 3 星专属技能', () => {
    const highCost = operators.filter((def) => def.cost >= 4);
    const missing = highCost.filter((def) => !def.skill.star3).map((def) => def.name);
    /*
      ★ 0.2：伊内丝的 3 星技能被整条去掉（1/2/3 星共用同一条"每次攻击削目标攻速"的被动）。
      ★ 予愿安洁莉娜的 3 星差异改由"星级数值数组 + `minStar: 3`"表达（表里那一列写的是"（无）"），
        所以也不再单独写一条 star3。
      ★ 0.2：可露希尔**退出**这个名单 —— 新表（R123）给她补上了 3 星专属「可露希尔·Q.E.D」。
      ★ 若以后又出现新的例外，这条测试会红，那就把它加进这个清单，
        **顺手确认一下数据表里确实写的是"（无）"**。
    */
    /*
      ★ 0.2 追加：八幡海铃（4 费）也没写 3 星专属 —— 她的技能"无存之所"三条星级
      只是眩晕时长和每秒伤害不同，用星级数值数组表达就够，不需要另写一套。
    */
    expect([...missing].sort()).toEqual(['八幡海铃', '伊内丝', '予愿安洁莉娜'].sort());
  });

  it('★ 持续时间用的是 tick（20 tick = 1 秒），不是秒', () => {
    // 挑几条你写了明确秒数的，逐一核对
    const cases: Array<[string, number]> = [
      ['op09', s(10)], // 信仰搅拌机：护盾持续 10 秒
      ['op13', s(20)], // 炎客：持续 20 秒
      ['op31', s(8)], // 焰尾：持续 8 秒
    ];
    for (const [id, expected] of cases) {
      const skill: SkillDef = SKILLS[id]!;
      const durations = skill.effects
        .map((effect) => ('durationTicks' in effect ? effect.durationTicks : undefined))
        .filter((value): value is number => typeof value === 'number');
      expect(durations, `${id} 的持续时间对不上`).toContain(expected);
    }
  });

  it('★ 真实战斗能跑完（50 个干员两两对上不会崩）', () => {
    const ids = operators.map((def) => def.id);
    for (let i = 0; i < ids.length; i++) {
      const a = ids[i]!;
      const b = ids[(i * 7 + 3) % ids.length]!;
      const teams = duel({ defId: a, star: 2, col: 4, row: 4 }, { defId: b, star: 2, col: 5, row: 4 });
      // simulate 会跑满整场；只要不抛异常就算过
      const result = simulate(UNIT_DEFS, teams, 1000 + i);
      expect(result.ticks).toBeGreaterThan(0);
      expect(result.ticks).toBeLessThanOrEqual(MAX_BATTLE_TICKS);
    }
  });
});
