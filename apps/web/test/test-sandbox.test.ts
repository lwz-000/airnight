/**
 * ============================================================
 *  ★ 0.0.3 测试模式「双阵营沙盒」+ 修改器新功能 —— 纯逻辑回归
 * ============================================================
 *
 *  ① 两套完全独立的状态（蓝方 side 0 / 红方 side 1），落子各占自己那半边
 *  ② 修改器「改等级」（1~10 下拉）
 *  ③ 修改器「获得干员」新增野怪：可选、进备战席、星级无影响、不参与合成
 *
 * 界面的接线（按钮显隐、点一下换边）在 dom-ui.test.ts 里验。
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_LEVEL,
  TEST_MODE_GOLD,
  UNIT_DEFS,
  monsterDefs,
  playableDefs,
  populationCap,
  simulate,
} from '../../../packages/shared/src/index.js';
import type { GameState } from '../src/game/state.js';
import type { TeamSetup } from '../../../packages/shared/src/index.js';
import { seedForBattle, seedFromTeam } from '../src/game/index.js';
import {
  createGameState,
  createTestSide,
  grantModifierUnit,
  isPlayerCell,
  isSideCell,
  placeBenchUnitAt,
  setModifierLevel,
  toTeamSetup,
} from '../src/game/state.js';

describe('★ 测试沙盒：两侧独立状态', () => {
  it('createTestSide 造出来的是测试模式、带 side、默认无限金币', () => {
    const blue = createTestSide(0);
    const red = createTestSide(1);
    expect(blue.testMode).toBe(true);
    expect(red.testMode).toBe(true);
    expect(blue.side).toBe(0);
    expect(red.side).toBe(1);
    expect(blue.infiniteGold).toBe(true);
    expect(blue.economy.gold).toBe(TEST_MODE_GOLD);
    // 两侧种子不同 -> 商店刷出来的牌不一样（各自独立的经济）
    expect(blue.seed).not.toBe(red.seed);
  });

  it('普通单机状态的 side 默认是 0（不回归）', () => {
    expect(createGameState(1).side).toBe(0);
  });

  it('isSideCell：蓝方只认左半场，红方只认右半场；isPlayerCell 等价于蓝方', () => {
    expect(isSideCell(0, { col: 0, row: 0 })).toBe(true);
    expect(isSideCell(0, { col: 4, row: 9 })).toBe(true);
    expect(isSideCell(0, { col: 5, row: 0 })).toBe(false);

    expect(isSideCell(1, { col: 5, row: 0 })).toBe(true);
    expect(isSideCell(1, { col: 9, row: 9 })).toBe(true);
    expect(isSideCell(1, { col: 4, row: 0 })).toBe(false);

    // 行越界
    expect(isSideCell(0, { col: 0, row: 10 })).toBe(false);

    expect(isPlayerCell({ col: 3, row: 3 })).toBe(true);
    expect(isPlayerCell({ col: 6, row: 3 })).toBe(false);
  });

  it('★ 红方摆子落在右半场；摆到左半场会被拦', () => {
    const red = createTestSide(1);
    red.economy.level = 10;
    expect(grantModifierUnit(red, 'mn_slime', 1).ok).toBe(true);
    const uid = red.economy.bench[0]!.uid;

    const bad = placeBenchUnitAt(red, uid, { col: 0, row: 0 });
    expect(bad.ok, '红方摆到左半场该被拦').toBe(false);
    expect(bad.message).toContain('右半边');

    expect(placeBenchUnitAt(red, uid, { col: 5, row: 2 }).ok).toBe(true);
    expect(red.placements[0]!.cell.col).toBe(5);
  });

  it('toTeamSetup 能把红方转成 team 1（棋子仍在右半场）', () => {
    const red = createTestSide(1);
    red.economy.level = 10;
    grantModifierUnit(red, 'mn_slime', 1);
    placeBenchUnitAt(red, red.economy.bench[0]!.uid, { col: 6, row: 1 });
    const team = toTeamSetup(red, 1);
    expect(team.team).toBe(1);
    expect(team.units[0]!.cell.col).toBeGreaterThanOrEqual(5);
  });

  it('蓝方的 toTeamSetup 默认仍然是 team 0', () => {
    const blue = createTestSide(0);
    blue.economy.level = 10;
    grantModifierUnit(blue, 'mn_slime', 1);
    placeBenchUnitAt(blue, blue.economy.bench[0]!.uid, { col: 1, row: 1 });
    const team = toTeamSetup(blue);
    expect(team.team).toBe(0);
  });
});

describe('★ 修改器：改等级（1~10）', () => {
  it('设到 10 级，人口上限跟着涨；经验清零', () => {
    const state = createTestSide(0);
    state.economy.xp = 7;
    const r = setModifierLevel(state, 10);
    expect(r.ok).toBe(true);
    expect(state.economy.level).toBe(10);
    expect(state.economy.xp, '到这一级的起点 -> 经验清零').toBe(0);
    expect(r.message).toContain(String(populationCap(10)));
  });

  it('越界会被钳住（99 -> 10，-5 -> 1）', () => {
    const state = createTestSide(0);
    setModifierLevel(state, 99);
    expect(state.economy.level).toBe(MAX_LEVEL);
    setModifierLevel(state, -5);
    expect(state.economy.level).toBe(1);
  });

  it('普通模式用不了', () => {
    const state = createGameState(3);
    expect(setModifierLevel(state, 5).ok).toBe(false);
    expect(state.economy.level).toBe(1);
  });
});

describe('★ 修改器：获得干员新增野怪', () => {
  const MONSTER_ID = monsterDefs()[0]!.id; // 一般是 mn_slime（源石虫）

  it('野怪能直接发进备战席（白送、不占牌库）', () => {
    const state = createTestSide(0);
    expect(grantModifierUnit(state, MONSTER_ID, 1).ok).toBe(true);
    const unit = state.economy.bench.find((u) => u.defId === MONSTER_ID);
    expect(unit, '野怪该进备战席').toBeDefined();
    expect(unit!.free, '修改器发的都是白送').toBe(true);
  });

  it('★ 星级对野怪没有影响：选 1/2/3 星发出来都是 1 星', () => {
    for (const star of [1, 2, 3]) {
      const state = createTestSide(0);
      grantModifierUnit(state, MONSTER_ID, star);
      const unit = state.economy.bench.find((u) => u.defId === MONSTER_ID)!;
      expect(unit.star, `选 ${star} 星，发出来也该是 1 星`).toBe(1);
    }
  });

  it('★ 三个相同的野怪不会合成（它们没有星级）', () => {
    const state = createTestSide(0);
    for (let i = 0; i < 3; i++) grantModifierUnit(state, MONSTER_ID, 1);
    const same = state.economy.bench.filter((u) => u.defId === MONSTER_ID);
    expect(same.length, '3 个相同的野怪应该还是 3 个').toBe(3);
    expect(same.every((u) => u.star === 1)).toBe(true);
  });

  it('对照组：三个相同的**干员**照常合成（合成没被上面那条改坏）', () => {
    const state = createTestSide(0);
    // 不写死 id：取一张最便宜的可玩干员（同 modifier.test.ts 的做法）
    const opId = playableDefs().slice().sort((a, b) => a.cost - b.cost)[0]!.id;
    for (let i = 0; i < 3; i++) grantModifierUnit(state, opId, 1);
    expect(state.economy.bench.some((u) => u.defId === opId && u.star === 2)).toBe(true);
  });

  it('召唤物依旧不能发', () => {
    const state = createTestSide(0);
    expect(grantModifierUnit(state, 'summon_pillar', 1).ok).toBe(false);
  });
});

/**
 * ★ 核心链路：一个人摆两边 -> 两边真的能对打。
 *
 * 这条测试照着 main.ts 的 startTestBattle() 复刻了一遍：
 *   蓝方/红方各自 toTeamSetup -> 拼种子 -> simulate() 出胜负。
 * 它保证「修改测试模式玩法」这个需求在**内核层**是成立的 ——
 * 不是只多了两个按钮，而是两队确实能互殴、而且可复现。
 */
describe('★ 沙盒互打：蓝红两队真的能对打（核心链路）', () => {
  /**
   * 按 main.ts 的算法拼种子：两个阵容一起决定（打散避免异或成 0），
   * ★ 0.1.2 起还要混进**回合号** —— 否则同一套摆法每回合打出完全相同的随机序列
   * （生还者合约抽谁、掉金骰子…全都固定，玩家会说"随机是假的"）。
   */
  const sandboxSeed = (t0: TeamSetup, t1: TeamSetup, round = 3): number =>
    seedForBattle((seedFromTeam(t0) ^ Math.imul(seedFromTeam(t1), 0x9e3779b1)) >>> 0, round);

  it('蓝方 4 个干员 vs 红方 1 只野怪 -> 能分胜负，且同摆法可复现', () => {
    const blue = createTestSide(0);
    const red = createTestSide(1);
    blue.economy.level = 10;
    red.economy.level = 10;

    /*
      取 4 只**不同**的便宜干员 —— 同一种发 4 张会被合成掉（3 张就升 2 星），
      那样备战席里只剩 2 件东西，摆不满 4 个位置。
    */
    const cheapOps = playableDefs()
      .slice()
      .sort((a, b) => a.cost - b.cost)
      .slice(0, 4);
    expect(cheapOps.length, '至少要有 4 只可玩干员').toBe(4);
    for (const def of cheapOps) grantModifierUnit(blue, def.id, 1);
    // 场上 4 个人（都放左半场）
    for (let i = 0; i < 4; i++) {
      expect(placeBenchUnitAt(blue, blue.economy.bench[0]!.uid, { col: i, row: 1 }).ok).toBe(true);
    }
    // 红方放一只最小的小怪（都放右半场）
    grantModifierUnit(red, monsterDefs()[0]!.id, 1);
    expect(placeBenchUnitAt(red, red.economy.bench[0]!.uid, { col: 6, row: 1 }).ok).toBe(true);

    const team0 = toTeamSetup(blue, 0);
    const team1 = toTeamSetup(red, 1);
    expect(team0.units.length, '蓝方 4 个').toBe(4);
    expect(team1.units.length, '红方 1 个').toBe(1);
    // 两队的人确实分处左右半场
    expect(team0.units.every((u) => u.cell.col <= 4)).toBe(true);
    expect(team1.units.every((u) => u.cell.col >= 5)).toBe(true);

    const seed = sandboxSeed(team0, team1);
    const a = simulate(UNIT_DEFS, [team0, team1], seed);
    const b = simulate(UNIT_DEFS, [team0, team1], seed);

    expect(a.ticks, '要真的打起来（>0 tick）').toBeGreaterThan(0);
    expect(a.winner, '4 打 1 该是蓝方赢').toBe(0);
    // 同一个种子重放必须完全一致 —— 这是联机 / 回放的基石
    expect(b.checksum).toBe(a.checksum);
    expect(b.ticks).toBe(a.ticks);
    expect(b.winner).toBe(a.winner);
  });

  it('两边摆同一套阵容 -> 场面由种子决定，但一定跑得完', () => {
    const build = (side: 0 | 1): GameState => {
      const s = createTestSide(side);
      s.economy.level = 10;
      const opId = playableDefs().slice().sort((a, b) => a.cost - b.cost)[1]!.id;
      for (let i = 0; i < 2; i++) grantModifierUnit(s, opId, 1);
      const cols = side === 0 ? [1, 2] : [6, 7];
      for (const col of cols) {
        placeBenchUnitAt(s, s.economy.bench[0]!.uid, { col, row: 3 });
      }
      return s;
    };
    const team0 = toTeamSetup(build(0), 0);
    const team1 = toTeamSetup(build(1), 1);
    const seed = sandboxSeed(team0, team1);
    const result = simulate(UNIT_DEFS, [team0, team1], seed);
    expect(result.ticks).toBeGreaterThan(0);
    expect([0, 1, null]).toContain(result.winner);
    // 镜像对局种子不同（蓝在前、红在后，拼出来的数不一样）—— 只要不炸就行
    expect(seed).toBeGreaterThan(0);
  });
});


// ============================================================
//  ★★ 0.1.2 修：战斗种子要"每回合重新掷骰"（用户报的"随机永远固定在一个人身上"）
// ============================================================

describe('★ 战斗种子：混了回合号（随机才是每回合重掷）', () => {
  it('同一套阵容：同回合可复现，换回合就不一样', () => {
    const teamSeed = 0x12345678;
    expect(seedForBattle(teamSeed, 3)).toBe(seedForBattle(teamSeed, 3));
    const seeds = [3, 4, 5, 6, 7, 8, 9].map((round) => seedForBattle(teamSeed, round));
    expect(new Set(seeds).size, '每个回合都该是不同的种子').toBe(seeds.length);
  });

  it('不同阵容 + 同回合 -> 也不同（阵容仍然决定"这一场打成什么样"）', () => {
    expect(seedForBattle(1, 5)).not.toBe(seedForBattle(2, 5));
  });

  it('回合号只动低位也能被打散（不是"1 和 2 差 1"那种）', () => {
    const a = seedForBattle(999, 10);
    const b = seedForBattle(999, 11);
    expect(Math.abs(a - b)).toBeGreaterThan(1000);
  });

  it('返回值是 32 位无符号整数（能直接喂给内核当种子）', () => {
    for (const round of [1, 2, 9, 100, 166]) {
      const seed = seedForBattle(0xdeadbeef, round);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThanOrEqual(0xffffffff);
      expect(Number.isInteger(seed)).toBe(true);
    }
  });
});
