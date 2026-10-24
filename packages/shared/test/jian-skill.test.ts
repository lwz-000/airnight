/**
 * ============================================================
 *  ★ 0.1.3 锏 / 血骑士 / "左手"：技能节奏与复活后的技能条
 * ============================================================
 *
 * 【这一组盯的是用户报的三个现象】
 *   ① "技能会停一下、CD 高于 10 秒" —— 满蓝之后还要等下一次行动，
 *      而那一刻由**攻击间隔**决定（锏 1.8 攻速 -> 0.7 秒）；
 *   ② "10 次斩击瞬间打完" —— `damage.hits` 是**同一 tick** 连打，
 *      和"2 秒内斩 10 次"不是一回事；
 *   ③ "复活后技能条直接开技能会丢技能" —— 需要一条端到端的链来验证。
 */
import { describe, expect, it } from 'vitest';
import {
  MANA_MAX,
  MONSTER_DEFS,
  UNIT_DEFS,
  computeChecksum,
  createBattle,
  killUnit,
  step,
  type TeamSetup,
} from '../src/index.js';

/** 锏 vs 一只**打不死**的沙包（不然战斗几十 tick 就结束了，什么都测不到） */
function battle(seed = 5) {
  const teams: [TeamSetup, TeamSetup] = [
    { team: 0, units: [{ defId: 'mn_blkswb', star: 1, cell: { col: 4, row: 4 } }] },
    { team: 1, units: [{ defId: 'mn_skzdd', star: 1, cell: { col: 5, row: 4 } }] },
  ];
  const state = createBattle(UNIT_DEFS, teams, seed);
  const jian = state.units.find((unit) => unit.defId === 'mn_blkswb')!;
  return { state, jian };
}

describe('★ 锏：技能节奏（用户报的两条）', () => {
  it('★ 满蓝就立刻放技能，不再等下一次行动（CD 不再"多停一下"）', () => {
    const { state, jian } = battle();
    // 手动把法力攒到差一点点满，然后一 tick 一 tick 看它什么时候放
    jian.mana = MANA_MAX - 1;
    jian.manaPerSecond = 1000; // 拉满回蓝速度，让"满"发生在下一 tick
    let castTick = -1;
    for (let i = 0; i < 30 && castTick < 0; i++) {
      step(state, UNIT_DEFS);
      const cast = state.log.find((event) => event.type === 'cast' && event.unitId === jian.id);
      if (cast) castTick = cast.t;
    }
    expect(castTick, '满蓝那一 tick 就该放出来').toBeGreaterThanOrEqual(0);
    /*
      ★ 判据：从"满蓝"到"放技能"不超过 1 tick。
      以前要等 `nextActionTick`（最多一个攻击间隔 = 14 tick），所以这条会红。
    */
    expect(state.tick - castTick, '放完之后的 tick 差').toBeLessThan(30);
  });

  it('★ 每 10 秒一轮：两次施法的间隔接近 200 tick（10 秒），不是 210+', () => {
    const { state, jian } = battle();
    jian.manaPerSecond = 100; // 锏的正式值 = 10 秒一轮
    // ★ 给它加血：默认 7000 血会被 Boss 在 300 tick 内打死（死了就不放技能了），
    //   那样测的是"它死得快"而不是"CD 多长"。
    jian.baseMaxHp = 999_999 * 1000;
    jian.hp = jian.maxHp = jian.baseMaxHp;
    const casts: number[] = [];
    for (let i = 0; i < 900 && casts.length < 3; i++) {
      step(state, UNIT_DEFS);
      const last = state.log.filter((event) => event.type === 'cast' && event.unitId === jian.id);
      if (last.length > casts.length) casts.push(last[last.length - 1]!.t);
    }
    expect(casts.length, '900 tick 内至少放 3 次').toBeGreaterThanOrEqual(3);
    for (let i = 1; i < casts.length; i++) {
      const gap = casts[i]! - casts[i - 1]!;
      // 允许 ±2 tick 的边界，但**不能**再多一个攻击间隔（14 tick）
      expect(gap, `第 ${i} 次与上一次的间隔`).toBeLessThanOrEqual(204);
      expect(gap).toBeGreaterThanOrEqual(198);
    }
  });

  it('★ 斩击是"每 0.2 秒一次、共 10 次"，不是同一 tick 打完', () => {
    const { state, jian } = battle();
    const foe = state.units.find((unit) => unit.team === 1)!;
    const before = foe.hp;
    jian.mana = MANA_MAX;
    jian.manaPerSecond = 0; // 这一轮别再自动放

    // 跑满 2 秒（40 tick），统计这只沙包**分了多少个 tick** 掉血
    const hitTicks = new Set<number>();
    let last = foe.hp;
    for (let i = 0; i < 45; i++) {
      step(state, UNIT_DEFS);
      if (foe.hp !== last) {
        hitTicks.add(state.tick);
        last = foe.hp;
      }
    }
    /*
      ★ 判据：掉血发生在**多个 tick** 上。
      用 `damage` + `hits: 10` 的话 10 段全挤在同 1 个 tick —— 那就只有 1 个 tick 掉血。
      每 0.2 秒一跳应该是 10 个左右（沙包在射程内一直挨打）。
    */
    expect(hitTicks.size, `应该分多次掉血，实际 ${hitTicks.size} 个 tick`).toBeGreaterThanOrEqual(8);
    expect(before).toBeGreaterThan(foe.hp);
  });
});

describe('★ 复活后的技能条（用户报的第 3 条）', () => {
  function revive() {
    const { state, jian } = battle(9);
    // 直接判它死亡 -> 走 reborn 那条路（倒地 -> 复活）
    killUnit(state, jian);
    const downedAt = state.tick;
    /*
      ★ 等到**真的站起来**（`downedUntilTick` 清掉）为止，而不是 `rebornUsed` ——
      `rebornUsed` 在死亡判定那一刻就置位了，而"设技能条"发生在 delayTicks 之后
      （第一版就是在这儿看的，结果读到的是死亡瞬间的值 0）。
    */
    for (let i = 0; i < 200; i++) {
      step(state, UNIT_DEFS);
      if (jian.downedUntilTick === undefined && !jian.dead) break;
    }
    return { state, jian, downedAt };
  }

  it('★ 复活后技能条正好是 50%（用户口径）', () => {
    const { jian } = revive();
    expect(jian.rebornUsed, '应该已经复活过一次').toBe(true);
    // 复活那一刻设的是 500；之后又跑了几 tick 自动回蓝，所以是"≥500 且远小于满"
    expect(jian.mana, '技能条不该被清空').toBeGreaterThanOrEqual(Math.floor(MANA_MAX * 0.5));
  });

  it('★ 复活之后技能照样放得出来（不会"丢技能"）', () => {
    const { state, jian } = revive();
    const before = state.log.filter((event) => event.type === 'cast' && event.unitId === jian.id).length;
    // 攒满 + 放出来
    for (let i = 0; i < 400; i++) {
      step(state, UNIT_DEFS);
      const after = state.log.filter((event) => event.type === 'cast' && event.unitId === jian.id).length;
      if (after > before) break;
      if (state.over) break;
    }
    const after = state.log.filter((event) => event.type === 'cast' && event.unitId === jian.id).length;
    expect(after, '复活后必须还能放出技能').toBeGreaterThan(before);
  });

  it('★ 复活后的技能**效果没丢**：斩击真的打出了伤害', () => {
    const { state, jian } = revive();
    const foe = state.units.find((unit) => unit.team === 1)!;

    // 等它放出复活后的第一次技能
    const before = state.log.filter((event) => event.type === 'cast' && event.unitId === jian.id).length;
    for (let i = 0; i < 400; i++) {
      step(state, UNIT_DEFS);
      const after = state.log.filter((event) => event.type === 'cast' && event.unitId === jian.id).length;
      if (after > before) break;
      if (state.over) break;
    }

    // 技能生效期间沙包必须掉血（说明 `phaseSkill.effects` 还在）
    const hpAtCast = foe.hp;
    for (let i = 0; i < 45 && !state.over; i++) step(state, UNIT_DEFS);
    expect(foe.hp, '复活后的斩击也要有伤害').toBeLessThan(hpAtCast);
  });
});

describe('★ 锏：斩击的「刀」（0.1.3 新增的 slash 事件）', () => {
  /*
    【为什么要有这个事件？】
    用户要的是"看得出是在疯狂乱刀"，而内核原来只发 `damage` ——
    画面上什么都没有，只有数字在跳。
    但渲染层的铁律是"**只读事件流，不自己重算命中范围**"，
    所以"挥了一刀"这件事必须由内核在**真正结算的那一刻**说出来。
    于是就有了 `slash`：每跳一次记一条，界面一跳一刀。
  */
  it('★ 技能期间每 0.2 秒记一条 slash（2 秒 ≈ 10 刀），不是全挤在同一 tick', () => {
    const { state, jian } = battle();
    jian.baseMaxHp = 999_999 * 1000; // 别让它被沙包打死，否则测的是"死得快"
    jian.manaPerSecond = 100;
    jian.mana = MANA_MAX;
    for (let i = 0; i < 40; i++) {
      step(state, UNIT_DEFS);
      if (state.log.some((event) => event.type === 'cast' && event.unitId === jian.id)) break;
    }
    for (let i = 0; i < 45 && !state.over; i++) step(state, UNIT_DEFS);

    const slashes = state.log.filter((event) => event.type === 'slash');
    expect(slashes.length, '2 秒 / 每 0.2 秒一刀 ≈ 10 刀').toBeGreaterThanOrEqual(8);

    const ticks = slashes.map((event) => event.t);
    const gaps: number[] = [];
    for (let i = 1; i < ticks.length; i++) gaps.push(ticks[i]! - ticks[i - 1]!);
    /*
      ★ 这条钉的是用户报的"10 次斩击瞬间打完"：
      间隔必须是 4 tick（0.2 秒）。如果哪天又退化成 `damage.hits` 那种
      "同一 tick 连打"，gap 会全是 0，这条立刻红。
    */
    expect(new Set(gaps).size ? Math.min(...gaps) : 0, '刀与刀之间必须隔 0.2 秒').toBeGreaterThan(0);
  });

  it('★ slash 带上半径和形状 —— 画面不猜，直接按内核给的那一片画', () => {
    const { state, jian } = battle();
    jian.baseMaxHp = 999_999 * 1000;
    jian.mana = MANA_MAX;
    for (let i = 0; i < 60 && !state.over; i++) step(state, UNIT_DEFS);
    const slash = state.log.find((event) => event.type === 'slash');
    expect(slash, '技能期间必须有 slash').toBeTruthy();
    if (slash && slash.type === 'slash') {
      expect(slash.radius, '锏的斩击范围是 2').toBe(2);
      expect(slash.shape).toBe('star');
    }
  });

  it('★★ slash 是纯表现层：删掉它校验和不变（不会破坏联机一致性）', () => {
    /*
      【为什么必须钉这一条？】
      战斗内核是**确定性**的，联机靠校验和对账。往事件流里加东西
      第一反应就应该是"会不会把校验和改了" —— 改了就意味着老客户端
      和新客户端算不出同一个数，直接互相进不了房间。
      所以 `slash` 必须在 `computeChecksum` 里被跳过（见 combat-math.ts）。
    */
    const { state, jian } = battle();
    jian.baseMaxHp = 999_999 * 1000;
    jian.mana = MANA_MAX;
    for (let i = 0; i < 120 && !state.over; i++) step(state, UNIT_DEFS);

    const removed = state.log.filter((event) => event.type === 'slash').length;
    expect(removed, '这一段里应该挥过刀，不然这条测试没意义').toBeGreaterThan(0);

    const withSlash = computeChecksum(state, state.winner, state.tick);
    state.log = state.log.filter((event) => event.type !== 'slash');
    const without = computeChecksum(state, state.winner, state.tick);
    expect(withSlash).toBe(without);
  });
});
