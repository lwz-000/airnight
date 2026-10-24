/**
 * 羁绊详情日志的内核事件（你报的第 6 条）。
 *
 * 【这一条为什么需要内核配合？】
 * 界面当然可以自己数"拉特兰打了几下"，但那样它就得知道
 * "谁是拉特兰成员""这一档的阈值是 30 还是 20 还是 10"——
 * 等于把羁绊规则在界面里重写一遍，改数值时必然漏掉一边。
 * 所以内核把「进度推进 / 发动 / 谁在吃加成」三件事如实记进事件流，
 * 界面只负责显示。这里钉的就是这三种事件。
 */
import { describe, expect, it } from 'vitest';
import {
  TRAIT_DEFS,
  UNIT_DEFS,
  computeActiveTraitLevels,
  createBattle,
  dealDamage,
  familyKeyOf,
  resolveUnitMechanics,
  simulate,
  step,
  type BattleEvent,
  type TeamSetup,
  type UnitDef,
  type UnitPlacement,
} from '../src/index.js';

type TraitEvent = Extract<BattleEvent, { type: 'trait' }>;

/** 从干员表里按羁绊取几个棋子（**不写死名字**：名单换过好几轮了） */
function unitsWithTrait(traitId: string, count: number): UnitDef[] {
  const seenFamily = new Set<string>();
  const list = Object.values(UNIT_DEFS)
    .filter((def) => !def.summonOnly && def.traits.includes(traitId))
    .sort((a, b) => a.id.localeCompare(b.id))
    /*
      ★★ 0.3.2：阿米娅家族（本体 + 三个升变形态）**只算一个羁绊成员**。
      取"凑人数"的样本时也必须按家族去重 —— 否则排序之后前三个罗德岛正好是
      `op07` / `op_amiya_blue` / `op_amiya_mercy`，看起来是 3 个人、实际只算 1 个，
      测试会以"羁绊没生效"的形式莫名其妙地红。
    */
    .filter((def) => {
      const family = familyKeyOf(def.id);
      if (seenFamily.has(family)) return false;
      seenFamily.add(family);
      return true;
    });
  if (list.length < count) throw new Error(`带 ${traitId} 的干员不够 ${count} 个`);
  return list.slice(0, count);
}

/**
 * 组队。**必须把羁绊解析结果一起传进去** ——
 * 战斗内核自己不认识任何羁绊名字，机制是开战时从 setup 里读的
 * （真实客户端走的是 game/state.ts 的 toTeamSetup，这里做同一件事）。
 */
function buildTeam(team: 0 | 1, units: UnitPlacement[]): TeamSetup {
  return {
    team,
    units,
    activeTraits: computeActiveTraitLevels(units, UNIT_DEFS, TRAIT_DEFS),
    unitMechanics: resolveUnitMechanics(units, UNIT_DEFS, TRAIT_DEFS),
  };
}

/** 一个"打不死"的靶子：星熊（3 星重装，而且**不是**拉特兰/罗德岛，不会干扰被测羁绊） */
function wall(count = 3): UnitPlacement[] {
  return Array.from({ length: count }, (_, i) => ({
    defId: 'op27',
    star: 3,
    cell: { col: 7, row: 3 + i },
  }));
}

/** 只看我方（队伍 0）的羁绊事件：敌方羁绊同样会被记下来，别混进来 */
function traitEvents(events: readonly BattleEvent[], kind: TraitEvent['kind'], traitId?: string): TraitEvent[] {
  return events.filter(
    (event): event is TraitEvent =>
      event.type === 'trait' &&
      event.kind === kind &&
      event.unitId < 1000 &&
      (traitId === undefined || event.traitId === traitId),
  );
}

describe('★ 拉特兰：累计攻击次数会如实记进事件流，攒满就发动', () => {
  /*
    用**最高那一档**（人数最多、阈值最小 —— 0.2.2 起是每 20 次）。
    3 人档要打满 30 下，而拉特兰都是远程输出，对面那点靶子撑不到那时候 ——
    战斗一结束就没有"发动"可看了。
    ★ 阈值一律从数据里读（`every`），别在这里写死 20/30，
      否则改一次档位数值这条用例就会莫名其妙地红。
  */
  const tier = TRAIT_DEFS['laterano']!.tiers[TRAIT_DEFS['laterano']!.tiers.length - 1]!;
  const every = (tier.mechanics![0] as { every: number }).every;

  function lateranoBattle(seed = 909) {
    const members = unitsWithTrait('laterano', tier.count);
    const placements: UnitPlacement[] = members.map((def, i) => ({
      defId: def.id,
      star: 1,
      cell: { col: 3, row: i },
    }));
    return simulate(UNIT_DEFS, [buildTeam(0, placements), buildTeam(1, wall(4))], seed);
  }

  it('★ 每次攻击推进一次进度，攒到阈值那一下触发发动', () => {
    const result = lateranoBattle();
    const progress = traitEvents(result.log, 'progress', 'laterano');
    expect(progress.length, '拉特兰成员每打一下都该记一条进度').toBeGreaterThan(0);

    for (const event of progress) {
      expect(event.traitId).toBe('laterano');
      expect(event.target, '阈值必须来自羁绊数据，不能是界面猜的').toBe(every);
      expect(event.value, '进度是"发动之后重新数"的次数').toBeGreaterThanOrEqual(1);
      expect(event.value, '没攒满之前不该超过阈值').toBeLessThanOrEqual(every);
    }

    /*
      ★ 0.0.2 需求第 8 条：拉特兰的计数从"每个干员各自累计"改成了
      **全队共同累计** —— 谁打一下都往同一个数上加一格。

      所以这里不能再按"每个 unitId 各自 1,2,3…"去断言（那是旧的每干员计数），
      正确的口径是：把所有进度事件按时间顺序排好，值必须一路 +1，
      攒到阈值那一下回到 1（也就是"全队共用一条进度条"）。
    */
    let expected = 1;
    for (const event of progress) {
      expect(event.value, '全队共用的进度只能一次加 1').toBe(expected);
      expected = expected >= every ? 1 : expected + 1;
    }

    const triggers = traitEvents(result.log, 'trigger', 'laterano');
    expect(triggers.length, '这一场里攒满过至少一次').toBeGreaterThan(0);
    /*
      ★ 比的是**事件流里的先后**，不是 tick。

      【为什么不能按 tick 过滤？】
      同一个 tick 里可以有好几下攻击落地（内核的事件 `t` 就是 tick）。
      写成 `progress.filter(e => e.t <= trigger.t).at(-1)` 的话，
      会把"触发之后、同一 tick 里别人又打的那一下（进度已经归 1）"也算进来，
      取到 1 而不是 30 —— 这条用例就是这么红的（0.2 把受击回蓝改成固定 100 之后，
      同一 tick 出手的棋子明显变多，这个隐藏的脆弱点就暴露了）。
      真实口径应该是"按日志顺序，紧挨着触发之前的那一条进度"。
    */
    for (const trigger of triggers) {
      const index = result.log.indexOf(trigger);
      const before = progress.filter((event) => result.log.indexOf(event) < index).at(-1)!;
      expect(before.value, '发动那一下的进度必须正好等于阈值').toBe(every);
    }
  });

  it('发动的同时会记一条"技能"事件（界面靠它播齐射特效）', () => {
    const result = lateranoBattle();
    const volleys = result.log.filter((event) => event.type === 'cast' && event.skillId === 'trait_laterano_volley');
    expect(volleys.length).toBe(traitEvents(result.log, 'trigger', 'laterano').length);
  });

  it('★ 发动事件带的是"本次造成的伤害总和"（0.0.2 追加需求第 5 条）', () => {
    /*
      【为什么要钉这一条？】
      界面要显示"拉特兰 发动！本次共造成 N 伤害"，而 N 必须是**实际打掉的血**。
      早期实现记的是"每名敌人吃到的伤害"（一个理论值），
      既不是总和、也没扣护盾/护甲 —— 直接显示出来会明显虚高。
      正确做法是累加 dealDamage 的返回值，这个测试就是防止有人又改回去。
    */
    const result = lateranoBattle();
    const triggers = traitEvents(result.log, 'trigger', 'laterano');
    expect(triggers.length).toBeGreaterThan(0);

    /*
      ★ 0.2：这里原来假设"触发那一 tick 上的技能伤害全是齐射打的"，现在已经不成立：
        · 触发的那一次**普攻**自己也可能打出 spell 伤害（蕾缪安的被动"额外造成已损失生命 X%
          的物理伤害"就是按 spell 记账的），它发生在齐射**之前**；
        · 靶子（机械师）被打掉盾时会炸一下（`breakBlast`，也是 spell），
          正好夹在齐射的几次结算**中间**。
      所以改成按**日志位置**取齐射自己的那一段：
      内核是"先 push cast，再逐个体结算伤害，最后 push trigger"（见 rules.ts 的说明），
      这段窗口里再按"我方（队伍 0）"过滤，剩下的就正好是齐射。
    */
    const teamOf = new Map<number, 0 | 1>();
    for (const event of result.log) {
      if (event.type === 'spawn') teamOf.set(event.unitId, event.team);
    }
    /** 齐射这个 cast 事件在日志里的下标（同一个 tick 里最后一条） */
    const volleyCastIndex = (t: number): number => {
      let found = -1;
      result.log.forEach((event, index) => {
        if (event.type === 'cast' && event.skillId === 'trait_laterano_volley' && event.t === t) found = index;
      });
      return found;
    };

    for (const trigger of triggers) {
      expect(trigger.value, '伤害总和必须是正数（否则说明没累加实际伤害）').toBeGreaterThan(0);
      const start = volleyCastIndex(trigger.t);
      const end = result.log.indexOf(trigger);
      expect(start, '齐射的 cast 事件应该和触发同 tick、且在它前面').toBeGreaterThanOrEqual(0);
      expect(end, '触发事件本身要在日志里').toBeGreaterThan(start);
      const window = result.log.slice(start, end);
      const hits = window.filter(
        (event) => event.type === 'damage' && event.attackType === 'spell' && teamOf.get(event.sourceId) === 0,
      );
      expect(hits.length, '齐射必须真的打出去了').toBeGreaterThan(0);
      const total = hits.reduce((sum, event) => (event.type === 'damage' ? sum + event.amount : sum), 0);
      expect(trigger.value, '值必须正好等于这一发齐射实际造成的伤害总和').toBe(total);
    }
  });

  it('没凑够人数的队伍不会产生任何进度事件', () => {
    const members = unitsWithTrait('laterano', 2);
    const placements: UnitPlacement[] = members.map((def, i) => ({
      defId: def.id,
      star: 1,
      cell: { col: 3, row: 3 + i },
    }));
    const result = simulate(UNIT_DEFS, [buildTeam(0, placements), buildTeam(1, wall())], 909);
    expect(traitEvents(result.log, 'progress', 'laterano'), '2 个拉特兰还没激活，不该有进度').toHaveLength(0);
  });
});

describe('★ 罗德岛：谁在吃攻击力加成会被实时记下来', () => {
  /** 敌人用一个**不是**罗德岛的棋子，免得敌方羁绊也发 carrier 事件 */
  const enemy: UnitPlacement[] = [{ defId: 'op09', star: 3, cell: { col: 7, row: 4 } }];

  function rhodesTeam(count = 2): TeamSetup {
    const members = unitsWithTrait('rhodes', count);
    return buildTeam(
      0,
      members.map((def, i) => ({ defId: def.id, star: 1, cell: { col: 3, row: 4 + i } })),
    );
  }

  it('★ 0.2：罗德岛换成了"跨回合叠层 + 阵亡数值传递"（旧的 carrier 整条删掉了）', () => {
    const def = TRAIT_DEFS['rhodes']!;
    expect(def.tiers.map((tier) => tier.count)).toEqual([3, 5, 7, 10]);
    for (const tier of def.tiers) {
      const kinds = (tier.mechanics ?? []).map((mech) => mech.kind);
      expect(kinds, 'highestHpCarrier 必须已经不在数据里').not.toContain('highestHpCarrier');
      expect(kinds).toContain('roundTraitStack');
      expect(kinds).toContain('deathStatTransfer');
    }
    // 第一档：每层 +2.25% 生命与攻击、最多 10 层；阵亡传 50%、每场 1 次
    expect(def.tiers[0]!.mechanics![0]).toMatchObject({ hpBp: 225, attackDamageBp: 225, maxStacks: 10 });
    expect(def.tiers[0]!.mechanics![1]).toMatchObject({ ratioBp: 5000, maxTransfers: 1 });
  });

  it('★ 战斗里：第一个阵亡的罗德岛会把自己 50% 的数值传给最近的友方', () => {
    // 3 个罗德岛才够开到 3 人档（那一档才有 deathStatTransfer）
    const state = createBattle(UNIT_DEFS, [rhodesTeam(3), buildTeam(1, enemy)], 5);
    step(state, UNIT_DEFS);

    const dying = state.units.find((unit) => unit.team === 0)!;
    const others = state.units.filter((unit) => unit.team === 0 && unit.id !== dying.id);
    const before = new Map(others.map((unit) => [unit.id, unit.maxHp]));
    // 直接打死它（真伤要指定来源，否则事件流里会出现"无主的伤害"）
    const killer = state.units.find((unit) => unit.team === 1)!;
    dealDamage(state, killer, dying, dying.maxHp * 2, 'true', 'spell');
    expect(dying.dead).toBe(true);

    // 传的是来源 50% 的生命值（固定值）-> 至少有一个友方的生命上限被顶上去了
    expect(others.some((unit) => unit.maxHp > (before.get(unit.id) ?? 0))).toBe(true);
  });
});
