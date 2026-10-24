/**
 * ============================================================
 *  ★★ 0.2 MujicaAve：fever 跨档的「宝藏」结算（回合侧落地）
 * ============================================================
 *
 * 这一份测的是"表 → 玩家仓库"这一段：
 *   · 金币真加了吗、藏品真进栏了吗、干员真从牌库来了吗；
 *   · **每档一辈子只发一次**（`FeverState.treasures`）；
 *   · 羁绊没生效时一分钱都不发。
 *
 * ★ 怎么让 MujicaAve 生效？成员表虽然已经有五个人了，但测试里最省事的还是
 *   "3 件 MujicaAve 转职"，和 `fever-round.test.ts` 用同一个脚手架。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  RELIC_ITEM_OF_TRAIT,
  UNIT_DEFS,
  feverDropWeightSum,
  playableDefs,
  type UnitPlacement,
} from '../../../packages/shared/src/index.js';
import {
  applyFeverAfterBattle,
  createGameState,
  grantFeverTreasure,
  poolRemainingOf,
  spendFever,
  type GameState,
} from '../src/game/state.js';

const MUJICA = RELIC_ITEM_OF_TRAIT['mujica']!;
let uidSeq = 900000;
type TestPlacement = UnitPlacement & { uid: number; extraTraits?: string[] };
const relic = (col: number, defId: string): TestPlacement => ({
  uid: uidSeq++,
  defId,
  star: 1,
  cell: { col, row: 1 },
  items: [MUJICA],
  extraTraits: ['mujica'],
});

/** 3 档 MujicaAve 生效（3 个不同干员各带一件转职） */
function mujicaState(): GameState {
  const state = createGameState(2026);
  state.phase = 'prep';
  state.placements = [
    relic(1, 'op01'),
    relic(2, 'op02'),
    relic(3, 'op03'),
  ] as unknown as GameState['placements'];
  return state;
}

/** 没有 MujicaAve 的普通阵容 */
function plainState(): GameState {
  const state = createGameState(2026);
  state.phase = 'prep';
  state.placements = [
    { uid: 999999, defId: 'op01', star: 1, cell: { col: 1, row: 1 } },
  ] as unknown as GameState['placements'];
  return state;
}

/** 固定骰子（只影响"掷到哪一条"，范围仍是 `% 权重总和`） */
function withRoll(state: GameState, roll: number): GameState {
  state.random = () => roll;
  return state;
}

describe('★ fever 宝藏：100 档（最简单的一档，用来钉基本行为）', () => {
  it('★ 掷到金币那条：金币真的加上去了', () => {
    const state = withRoll(mujicaState(), 0); // 第一条 = 6 金币
    const before = state.economy.gold;
    const result = grantFeverTreasure(state, 100);
    expect(result, '这一档该发东西').toBeTruthy();
    expect(result!.gold).toBe(6);
    expect(state.economy.gold).toBe(before + 6);
    expect(result!.summary).toBe('6 金币');
    expect(state.fever.treasures).toContain(100);
  });

  it('★ 掷到普通藏品那条：藏品真的进了藏品栏', () => {
    const state = withRoll(mujicaState(), 5000); // 5000 起是"1 件普通藏品"
    const result = grantFeverTreasure(state, 100);
    expect(result).toBeTruthy();
    expect(result!.items).toHaveLength(1);
    expect(result!.gold).toBe(0);
    // 拿到的那件确实在栏里（A 栏或 B 栏，按藏品的 slot 分）
    const inStorage =
      state.items.aSlots.includes(result!.items[0]!) || state.items.bSlots.includes(result!.items[0]!);
    expect(inStorage, '藏品没真的进栏').toBe(true);
  });

  it('★★ 同一档只能领一次（重复调用返回 null，不发第二份）', () => {
    const state = withRoll(mujicaState(), 0);
    expect(grantFeverTreasure(state, 100)).toBeTruthy();
    const goldAfterFirst = state.economy.gold;
    expect(grantFeverTreasure(state, 100), '第二份宝藏不该存在').toBeNull();
    expect(state.economy.gold).toBe(goldAfterFirst);
  });

  it('★ 没有掉落表的档位 = null（不崩、也不乱发）', () => {
    const state = withRoll(mujicaState(), 0);
    expect(grantFeverTreasure(state, 777)).toBeNull();
  });
});

describe('★ fever 宝藏：随机干员（来源牌库）', () => {
  it('★★ 300 档掷到"1 张 1 星 4 费干员 + 20 金"：人进备战席、牌库少 1 张', () => {
    // 300 档：3000/3000/3000/1000，最后一条是干员 ⇒ 掷 9000 落在它上面
    const state = withRoll(mujicaState(), 9000);
    const poolBefore = new Map<string, number>();
    for (const def of playableDefs()) {
      if (def.cost === 4) poolBefore.set(def.id, poolRemainingOf(state, def.id));
    }
    const goldBefore = state.economy.gold;

    const result = grantFeverTreasure(state, 300);
    expect(result?.units, '该给一只干员').toHaveLength(1);
    const got = result!.units[0]!;
    expect(got.star).toBe(1);
    expect(UNIT_DEFS[got.defId]!.cost, '必须是 4 费').toBe(4);
    // 人真的在备战席
    expect(state.economy.bench.some((unit) => unit.defId === got.defId && unit.star === 1)).toBe(true);
    // 金币：20（这一条自带）+ 0（没走兜底）
    expect(result!.gold).toBe(20);
    expect(state.economy.gold).toBe(goldBefore + 20);
    // 牌库少 1 张（1 星占 1 张）
    expect(poolRemainingOf(state, got.defId)).toBe(poolBefore.get(got.defId)! - 1);
  });

  it('★ 牌库空了：改成金币（不会凭空造一只出来）', () => {
    const state = withRoll(mujicaState(), 9000);
    /*
      ★ 把 4 费牌库彻底掏空：每人塞两张 3 星（= 18 张，超过任何 4 费干员的库存）。
      只塞一张 3 星不够 —— 4 费库存比 9 张多，会剩几张。
    */
    let fillerUid = 800000;
    for (const def of playableDefs()) {
      if (def.cost !== 4) continue;
      state.economy.bench.push({ uid: fillerUid++, defId: def.id, star: 3 });
      state.economy.bench.push({ uid: fillerUid++, defId: def.id, star: 3 });
    }
    const before = state.economy.bench.length;
    const result = grantFeverTreasure(state, 300);
    expect(result).toBeTruthy();
    // 没有新干员（也可能因为三合一被合掉，总之 units 为空）
    expect(result!.units).toHaveLength(0);
    expect(state.economy.bench.length).toBeLessThanOrEqual(before);
    // 改成金币：20（自带）+ 4 费 × 1 张 = 24
    expect(result!.gold).toBe(20 + 4);
    expect(result!.lines.some((line) => line.includes('改为'))).toBe(true);
  });
});

describe('★★ fever 宝藏：奖励时机 = 消耗 fever 后打赢那一场（用户 2026-10-17）', () => {
  it('★★ 跨档本身**不发**宝藏（只弹窗）', () => {
    const state = withRoll(mujicaState(), 0);
    state.fever.total = 100;
    // won=null：不判胜负、不结算倍数，总额保持 100
    const outcome = applyFeverAfterBattle(state, { won: null, gained: 0, round: 4 });
    expect(outcome.treasure, '跨档只弹窗，不该白给宝藏').toBeNull();
    expect(state.fever.prompt, '弹窗要挂上').toBe(100);
    expect(state.fever.treasures, '没消耗过就不该记任何档位').toEqual([]);
  });

  it('★★ 消耗 fever 后打赢 -> 才发那一档的宝藏', () => {
    const state = withRoll(mujicaState(), 0);
    state.fever.total = 100;
    // 布阵阶段跨档 -> 弹窗
    applyFeverAfterBattle(state, { won: null, gained: 0, round: 4 });
    expect(state.fever.prompt).toBe(100);
    expect(spendFever(state), '点「消耗」').toBe(true);
    expect(state.fever.pendingTier, '消耗时记下要发的档位').toBe(100);
    expect(state.fever.armedTicks, '下一场要武装特殊技能').toBeGreaterThan(0);

    const outcome = applyFeverAfterBattle(state, { won: true, gained: 0, round: 5 });
    expect(outcome.treasure, '打赢了才发').toBeTruthy();
    expect(outcome.treasure!.tier).toBe(100);
    expect(state.fever.treasures).toContain(100);
    expect(state.fever.pendingTier, '发完就清掉').toBeNull();
  });

  it('★ 消耗后**输了** -> 不发（该退的 fever 照退）', () => {
    const state = withRoll(mujicaState(), 0);
    state.fever.total = 300;
    applyFeverAfterBattle(state, { won: null, gained: 0, round: 4 });
    spendFever(state);
    const outcome = applyFeverAfterBattle(state, { won: false, gained: 0, round: 5 });
    expect(outcome.treasure, '输了不该有宝藏').toBeNull();
    expect(state.fever.treasures).toEqual([]);
    expect(state.fever.total, '3 档返还 50%').toBe(150);
    expect(state.fever.pendingTier).toBeNull();
  });

  it('★ 消耗后**平局** -> 不发、也不返还', () => {
    const state = withRoll(mujicaState(), 0);
    state.fever.total = 300;
    applyFeverAfterBattle(state, { won: null, gained: 0, round: 4 });
    spendFever(state);
    const outcome = applyFeverAfterBattle(state, { won: null, gained: 0, round: 5 });
    expect(outcome.treasure).toBeNull();
    expect(state.fever.total).toBe(0);
  });

  it('★ 消耗后碰上野怪回合 -> 作废（不发、也不返还）', () => {
    const state = withRoll(mujicaState(), 0);
    state.fever.total = 100;
    applyFeverAfterBattle(state, { won: null, gained: 0, round: 4 });
    spendFever(state);
    const outcome = applyFeverAfterBattle(state, { won: true, gained: 999, round: 9 });
    expect(outcome.treasure, '野怪回合不发宝藏').toBeNull();
    expect(state.fever.pendingTier).toBeNull();
    expect(state.fever.spent, '消耗额度结清').toBe(0);
  });

  it('★ 同一档消耗两次：第二次不再发（每档一辈子一份）', () => {
    const state = withRoll(mujicaState(), 0);
    // 第一次：100 档消耗 + 赢
    state.fever.total = 100;
    applyFeverAfterBattle(state, { won: null, gained: 0, round: 4 });
    spendFever(state);
    expect(applyFeverAfterBattle(state, { won: true, gained: 0, round: 5 }).treasure).toBeTruthy();
    // 第二次：重新攒到 100 档，再消耗 + 赢
    state.fever.total = 100;
    state.fever.prompt = 100;
    state.fever.promptedTier = null;
    spendFever(state);
    const second = applyFeverAfterBattle(state, { won: true, gained: 0, round: 7 });
    expect(second.treasure, '同一档不会发第二份').toBeNull();
    expect(state.fever.pendingTier).toBeNull();
  });

  it('★ 羁绊没生效：一分钱都不发（fever 也不会被清）', () => {
    const state = withRoll(plainState(), 0);
    state.fever.total = 500;
    const outcome = applyFeverAfterBattle(state, { won: null, gained: 0, round: 4 });
    expect(outcome.treasure).toBeNull();
    expect(state.fever.total, 'fever 保留（用户口径 1）').toBe(500);
    expect(state.economy.gold).toBe(createGameState(2026).economy.gold);
  });

  it('★ 领过的档位会记在 treasures 里（跟着 fever 一起上报给服务器）', () => {
    const state = withRoll(mujicaState(), 0);
    grantFeverTreasure(state, 100);
    expect(state.fever.treasures).toEqual([100]);
  });
});

describe('★ fever 宝藏：重量总和（防止表被改坏）', () => {
  it('★ 七个档位的权重总和和代码里写的一致', () => {
    const expected: Record<number, number> = {
      100: 10000,
      300: 10000,
      500: 11000,
      1000: 11000,
      1500: 8000,
      2000: 10000,
      3000: 10000,
    };
    for (const [tier, sum] of Object.entries(expected)) {
      expect(feverDropWeightSum(Number(tier))).toBe(sum);
    }
  });
});

describe('★ 界面护栏：野怪回合的布阵阶段不许弹 fever 窗', () => {
  /*
    【为什么是源码级？】
    `renderFeverOverlay` 是 main.ts 里的界面函数，整份 main.ts 依赖 DOM/three，
    没法在单测里直接跑。但这条规则**必须**钉住 ——
    漏了的表现是"野怪回合布阵时弹窗冒出来"，而玩家会以为自己能靠打野怪拿奖励
    （用户 2026-10-17 明确禁止）。
    ★ 判据必须落在"当前回合是不是野怪回合"，不能靠 `fever.prompt` 是否为空
      （那条 prompt 是要留到下一个正常回合用的）。
  */
  it('★★ renderFeverOverlay 的显示条件里必须有 isMonsterRound', () => {
    const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    const start = source.indexOf('function renderFeverOverlay(');
    expect(start, '找不到 renderFeverOverlay').toBeGreaterThan(-1);
    const body = source.slice(start, start + 1600);
    expect(body.includes('isMonsterRound'), '野怪回合必须挡住这张窗').toBe(true);
    expect(body.includes("state.phase === 'prep'")).toBe(true);
  });
});
