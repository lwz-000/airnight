/**
 * ============================================================
 *  ★★ 0.2 MujicaAve：fever —— 回合侧那一半（攒完怎么花）
 * ============================================================
 *
 * 【怎么让羁绊生效？】MujicaAve 的**成员表还没加人**（用户口径：先写效果、后面再加人），
 * 所以这里走"现实里唯一能凑出来"的那条路：**MujicaAve 转职** ——
 * 往 3 个干员身上各装一件 `itm_relic_mujica`，羁绊就激活了。
 * 顺带这也把"转职藏品真的算人数"这件事一起钉住了。
 *
 * 【这一组守的规则】（用户 2026-10-16 拍板）
 *   · 野怪回合**不获得 fever、也不判胜负**；
 *   · 打输时**这一场攒的** fever 乘 ×1.5 / ×2 / ×5；
 *   · 打赢扣掉当前总额的 30%（**最高档**不扣）；最高档回合结束翻倍；
 *   ★ 最高档 2026-10-17 从 7 人抬到 **8 人**（用户口径），所以下面的阵容都是 8 件转职。
 *   · 消耗之后那一场**不再获得 fever**；那一场若输，返还**消耗掉的那一笔**的 50%/70%/100%；
 *   · 弹窗**只弹"新跨过的最高档"**（同一个档里涨不再打扰玩家，掉到档位下面再涨回来才重弹）；
 *   · 羁绊关掉之后 fever **不清零**（只是不再显示）。
 */
import { describe, expect, it } from 'vitest';
import {
  RELIC_ITEM_OF_TRAIT,
  UNIT_DEFS,
  computeActiveTraitLevels,
  simulate,
  type TeamSetup,
  type UnitPlacement,
} from '../../../packages/shared/src/index.js';
import {
  advanceRound,
  applyFeverAfterBattle,
  createGameState,
  holdFever,
  spendFever,
  toTeamSetup,
  type GameState,
} from '../src/game/state.js';

const MUJICA = RELIC_ITEM_OF_TRAIT['mujica']!;
/**
 * ★ 一件 MujicaAve 转职的棋子。
 * 【为什么直接把 `extraTraits` 写上，而不是只写 `items`？】
 * `state.placements` 里的对象**不带这个字段** —— 真实链路是"临到要算羁绊时
 * 用 `withExtraTraits()` 从 items 现折一刀"。测试要在这里显式给出来，
 * 才是模拟了那一刀之后的样子（否则算出来是"羁绊没生效"，测的就不是 fever 了）。
 */
let uidSeq = 900000;
/** 摆上场用的形状：内核的 UnitPlacement + 界面层才有的 uid / extraTraits */
type TestPlacement = UnitPlacement & { uid: number; extraTraits?: string[] };
/*
  ★ `defId` 必须**各不相同**：羁绊人数按"**不同干员**"计（同一个干员上多个只算 1 个）。
    三个 op01 只会算 1 个人，MujicaAve 永远凑不到 3 档 —— 这一版就是这么红的。
*/
const relic = (col: number, row: number, defId = 'op01'): TestPlacement => ({
  uid: uidSeq++,
  defId,
  star: 1,
  cell: { col, row },
  items: [MUJICA],
  extraTraits: ['mujica'],
});

/**
 * 把棋子摆上场。
 * ★ 这里要一次类型断言：`state.placements` 的元素类型里**没有 `extraTraits`**
 *   （客户端平时只存 items，真正算羁绊时才用 `withExtraTraits()` 折出来）——
 *   而我们这一组测的恰恰是"折完之后"的样子（否则 MujicaAve 根本激活不了）。
 */
function put(state: GameState, units: TestPlacement[]): void {
  state.placements = units as unknown as GameState['placements'];
}

/** 三个带 MujicaAve 转职的干员（= 3 档生效） */
function mujicaState(): GameState {
  const state = createGameState(2026);
  state.phase = 'prep';
  put(state, [relic(1, 1, 'op01'), relic(1, 3, 'op02'), relic(1, 5, 'op03')]);
  return state;
}

/** 一个不带转职的普通阵容（用来验证"羁绊关掉之后 fever 保留"） */
function plainState(): GameState {
  const state = createGameState(2026);
  state.phase = 'prep';
  put(state, [{ uid: 999999, defId: 'op01', star: 1, cell: { col: 1, row: 1 } }]);
  return state;
}

describe('★ 0.2 MujicaAve 转职：凑人数这件事真的成立', () => {
  it('装 3 件 MujicaAve 转职 = 3 档生效（成员表里还没人，转职是唯一入口）', () => {
    const state = mujicaState();
    const levels = computeActiveTraitLevels(state.placements, UNIT_DEFS);
    const mujica = levels.find((level) => level.traitId === 'mujica');
    expect(mujica, '转职藏品必须把标签算进羁绊人数').toBeTruthy();
    expect(mujica!.tierIndex, '3 件 = 第 0 档（3 人）').toBe(0);
  });

  it('只有 2 件 = 不生效（凑不够 3）', () => {
    const state = createGameState(2026);
    put(state, [relic(1, 1, 'op01'), relic(1, 3, 'op02')]);
    const levels = computeActiveTraitLevels(state.placements, UNIT_DEFS);
    expect(levels.find((level) => level.traitId === 'mujica')?.tierIndex ?? -1).toBe(-1);
  });
});

describe('★ 0.2 fever：战斗结束后的结算（3 档）', () => {
  it('普通回合：这一场攒到的 fever 直接加进总额', () => {
    const state = mujicaState();
    applyFeverAfterBattle(state, { won: true, gained: 40, round: 4 });
    // 赢了要扣 30%：40 -> 40 - 12 = 28
    expect(state.fever.total).toBe(28);
  });

  it('★ 打输：**这一场攒的** fever 先 ×1.5 再加进去（3 档）', () => {
    const state = mujicaState();
    applyFeverAfterBattle(state, { won: false, gained: 40, round: 4 });
    expect(state.fever.total).toBe(60);
  });

  it('★★ 野怪回合：不获得 fever、也不判胜负（倍数/扣减一个都不算）', () => {
    // 野怪回合是 1 / 9 / 16 / 23…（`isMonsterRound`：(r-2) % 7 === 0 或 r === 1）
    const state = mujicaState();
    applyFeverAfterBattle(state, { won: false, gained: 999, round: 1 });
    expect(state.fever.total, '野怪回合不给 fever').toBe(0);
    applyFeverAfterBattle(state, { won: true, gained: 999, round: 9 });
    expect(state.fever.total, '野怪回合也不判胜负（不扣 30%）').toBe(0);
    // 对照：非野怪回合照样算
    applyFeverAfterBattle(state, { won: true, gained: 100, round: 10 });
    expect(state.fever.total).toBe(70);
  });

  it('★★ 野怪回合：即使总额已经够档，也**不弹窗、不发宝藏**（用户 2026-10-17）', () => {
    const state = mujicaState();
    state.fever.total = 500;
    state.fever.promptedTier = null;
    // 第 9 回合是野怪回合
    const during = applyFeverAfterBattle(state, { won: null, gained: 0, round: 9 });
    expect(state.fever.prompt, '野怪回合不许弹').toBeNull();
    expect(during.treasure, '野怪回合也不能领宝藏').toBeNull();
    expect(state.fever.total, '总量照旧保留').toBe(500);

    // 下一个正常回合：该问就问 —— 但**跨档本身不发宝藏**（要消耗后打赢才发）
    const next = applyFeverAfterBattle(state, { won: null, gained: 0, round: 10 });
    expect(state.fever.prompt).toBe(500);
    expect(next.treasure, '跨档只弹窗，奖励要等消耗后打赢').toBeNull();
  });

  it('★ 野怪回合前就挂着的弹窗：野怪回合里**不清掉**（界面只是藏起来）', () => {
    const state = mujicaState();
    state.fever.total = 300;
    applyFeverAfterBattle(state, { won: null, gained: 0, round: 8 });
    expect(state.fever.prompt, '第 8 回合打完该弹 300 档').toBe(300);

    const during = applyFeverAfterBattle(state, { won: null, gained: 0, round: 9 });
    expect(state.fever.prompt, '野怪回合里这条不能被清掉，否则这次机会就丢了').toBe(300);
    expect(during.treasure).toBeNull();
  });

  it('★ 打赢扣 30%：总额越多扣得越多，但不会扣成负数', () => {
    const state = mujicaState();
    state.fever.total = 200;
    applyFeverAfterBattle(state, { won: true, gained: 0, round: 4 });
    expect(state.fever.total).toBe(140);
  });

  it('羁绊关掉之后：fever 不清零（用户口径 1）', () => {
    const state = plainState();
    state.fever.total = 777;
    applyFeverAfterBattle(state, { won: false, gained: 500, round: 4 });
    expect(state.fever.total, '没激活就不结算、也不清空').toBe(777);
    expect(state.fever.prompt, '没激活就不弹窗').toBeNull();
  });
});

describe('★ 0.2 fever：最高档（翻倍 / 不扣 / ×5 / 全额返还）', () => {
  it('八件转职 = 最高档 ⇒ 本场获得的 fever 翻倍、获胜不扣', () => {
    const state = createGameState(2026);
    put(state, [
      relic(1, 1, 'op01'),
      relic(1, 3, 'op02'),
      relic(1, 5, 'op03'),
      relic(2, 1, 'op04'),
      relic(2, 3, 'op05'),
      relic(2, 5, 'op06'),
      relic(3, 1, 'op07'),
      relic(3, 3, 'op08'),
    ]);
    const levels = computeActiveTraitLevels(state.placements, UNIT_DEFS);
    expect(levels.find((level) => level.traitId === 'mujica')!.tierIndex).toBe(2);

    state.fever.total = 100;
    applyFeverAfterBattle(state, { won: true, gained: 10, round: 4 });
    /*
      ★★ 0.2 修（用户 2026-10-17「后期 fever 叠加数值有问题」）：
      最高档的"翻倍"只翻**本场获得的这一份**（10 -> 20），不再把攒下来的总额翻倍。
      原来 `total *= 2` 会让 8 人档 3 个回合就顶到 3000（掉落表一共才 7 档）。
    */
    expect(state.fever.total, '100 + 10×2 = 120').toBe(120);
  });
});

describe('★★ 0.2 fever：达标弹窗与「消耗 / 保留」', () => {
  it('达标按**最高档**弹（400 越过 100 和 300 ⇒ 弹 300，低档不问）', () => {
    const state = mujicaState();
    state.fever.total = 400;
    applyFeverAfterBattle(state, { won: null, gained: 0, round: 4 });
    expect(state.fever.prompt, '弹的是已跨过的最高档').toBe(300);
  });

  it('没到最低档（100）就不弹', () => {
    const state = mujicaState();
    state.fever.total = 99;
    applyFeverAfterBattle(state, { won: null, gained: 0, round: 4 });
    expect(state.fever.prompt).toBeNull();
  });

  it('★★ 用户原话那条：只弹「新跨过的最高档」，同一个档里涨不再弹', () => {
    /*
      【用户口径（原话）】
        「弹窗是只弹最高档，比如第三回合到了 50 点不弹，第四回合 150 点弹 100 档的；
          第五回合 170 点不弹；第六回合 400 点弹 300 档的；第七回合 460 点也不弹，依此类推。」
      阈值表 = [100, 300, 500, 1000, 1500, 2000, 3000]（见 trait-data 的 mujica）。
    */
    const state = mujicaState();
    /** 模拟"这一回合结束时总额是多少"，返回布阵时该弹的档 */
    const settle = (total: number, round: number): number | null => {
      state.fever.total = total;
      applyFeverAfterBattle(state, { won: null, gained: 0, round });
      return state.fever.prompt;
    };

    expect(settle(50, 3), '第 3 回合 50 点：一个档都没到').toBeNull();

    expect(settle(150, 4), '第 4 回合 150 点：新跨过 100 档 -> 弹').toBe(100);
    holdFever(state); // 玩家点了「保留」

    expect(settle(170, 5), '第 5 回合 170 点：还在 100 档 -> 不弹').toBeNull();

    expect(settle(400, 6), '第 6 回合 400 点：新跨过 300 档 -> 弹').toBe(300);
    holdFever(state);

    expect(settle(460, 7), '第 7 回合 460 点：还在 300 档 -> 不弹').toBeNull();
  });

  it('★★ 掉到某档下面再涨回来 -> 重新弹（用户："除非是 fever 点数下降到每档的下面"）', () => {
    const state = mujicaState();

    state.fever.total = 400;
    applyFeverAfterBattle(state, { won: null, gained: 0, round: 4 });
    expect(state.fever.prompt, '先弹 300 档').toBe(300);
    holdFever(state);

    // 掉到 100 档（比如打赢扣 30%）
    state.fever.total = 150;
    applyFeverAfterBattle(state, { won: null, gained: 0, round: 5 });
    expect(state.fever.prompt, '降到 100 档：没跨过更高的档，不弹').toBeNull();
    expect(state.fever.promptedTier, '★ "上次弹过的档"必须跟着往下走').toBe(100);

    // 再涨回 400 —— 又跨过 300 档
    state.fever.total = 400;
    applyFeverAfterBattle(state, { won: null, gained: 0, round: 6 });
    expect(state.fever.prompt, '重新跨过 300 档 -> 要再弹一次').toBe(300);
  });

  it('★★ 掉到**所有档以下**（消耗掉全部）之后再攒到 100，也要重新弹', () => {
    /*
      ★ 这条是"最容易漏掉"的一种：
      玩家在 300 档点了「消耗」，fever 清零；如果 `promptedTier` 不跟着清零，
      重新攒到 100 时 `top(100) > promptedTier(300)` 不成立 —— **永远不再弹窗**，
      这个羁绊的玩法直接废掉。所以 `spendFever` 里必须显式把它归零。
    */
    const state = mujicaState();
    state.fever.total = 320;
    applyFeverAfterBattle(state, { won: null, gained: 0, round: 4 });
    expect(state.fever.prompt).toBe(300);

    expect(spendFever(state), '点「消耗」').toBe(true);
    expect(state.fever.total, '消耗所有 fever').toBe(0);
    expect(state.fever.promptedTier, '★ 总额清零 ⇒ "上次弹过的档"也清零').toBeNull();

    // 重新攒到 100 档
    state.fever.total = 130;
    applyFeverAfterBattle(state, { won: null, gained: 0, round: 6 });
    expect(state.fever.prompt, '清零之后重新到 100 档，要再弹').toBe(100);
  });

  it('选「消耗」：清零 + 武装下一场的窗口 + 记下"待发的宝藏档位"', () => {
    const state = mujicaState();
    state.fever.total = 520;
    applyFeverAfterBattle(state, { won: null, gained: 0, round: 4 });
    expect(state.fever.prompt).toBe(500);
    expect(spendFever(state)).toBe(true);
    expect(state.fever.total, '消耗所有 fever').toBe(0);
    expect(state.fever.spent, '记下花掉了多少（输了要返还）').toBe(520);
    expect(state.fever.armedTicks, '3 档 = 5 秒窗口').toBe(100);
    /*
      ★ 0.2 改（用户 2026-10-17）：宝藏**不在消耗时发**，而是记在 `pendingTier` 上，
      等下一场打赢才兑现 —— 所以 `treasures`（"已经领过"）此刻应该还是空的。
    */
    expect(state.fever.pendingTier, '记下这次消耗的档位（打赢才发）').toBe(500);
    expect(state.fever.treasures, '还没兑现，不该记"已领过"').toEqual([]);
    expect(state.fever.prompt).toBeNull();
  });

  it('★★ 消耗之后那一场：**不再获得 fever**；输了返还消耗量的 50%（3 档）', () => {
    const state = mujicaState();
    state.fever.total = 500;
    applyFeverAfterBattle(state, { won: null, gained: 0, round: 4 });
    spendFever(state);
    // 下一场（第 5 回合是野怪回合，避开它）
    applyFeverAfterBattle(state, { won: false, gained: 999, round: 6 });
    expect(state.fever.total, '这一场不获得 fever，只返还 500 的 50%').toBe(250);
    expect(state.fever.spent, '消耗结清了').toBe(0);
    expect(state.fever.armedTicks, '武装只作用于下一场').toBe(0);
  });

  it('★ 消耗之后那一场**赢了**：不返还，但宝藏照记', () => {
    const state = mujicaState();
    state.fever.total = 120;
    applyFeverAfterBattle(state, { won: null, gained: 0, round: 4 });
    spendFever(state);
    applyFeverAfterBattle(state, { won: true, gained: 999, round: 6 });
    expect(state.fever.total).toBe(0);
    expect(state.fever.treasures).toEqual([100]);
  });

  it('最高档输了：返还 100%（消耗多少退多少）', () => {
    const state = createGameState(2026);
    put(state, [
      relic(1, 1, 'op01'),
      relic(1, 3, 'op02'),
      relic(1, 5, 'op03'),
      relic(2, 1, 'op04'),
      relic(2, 3, 'op05'),
      relic(2, 5, 'op06'),
      relic(3, 1, 'op07'),
      relic(3, 3, 'op08'),
    ]);
    /*
      ★ 从 750 出发、本场获得 400：最高档「回合结束时**本场获得的** fever 翻倍」
        ⇒ 750 + 400×2 = 1550，正好跨到 1500 档（顺便把翻倍口径钉住：
        如果还按老的"总额翻倍"，这里会变成 1500 甚至 3000，返还断言就对不上）。
    */
    state.fever.total = 750;
    applyFeverAfterBattle(state, { won: null, gained: 400, round: 4 });
    expect(state.fever.total, '750 + 400×2（本场翻倍）').toBe(1550);
    expect(state.fever.prompt).toBe(1500);
    spendFever(state);
    expect(state.fever.armedTicks, '7 档 = 15 秒').toBe(300);
    applyFeverAfterBattle(state, { won: false, gained: 999, round: 6 });
    expect(state.fever.total, '最高档输了全额返还').toBe(1550);
  });

  it('没有弹窗时点按钮不会有任何副作用', () => {
    const state = mujicaState();
    expect(spendFever(state)).toBe(false);
    expect(holdFever(state)).toBe(false);
    expect(state.fever.total).toBe(0);
    expect(state.fever.armedTicks).toBe(0);
  });
});


// ============================================================
//  ★★ fever 全链路（用户报"失败没有增加，也可能是没有显示"）
// ============================================================
//
// 【为什么要一条"真打一场"的用例？】
// 前面那些用例都是**直接调结算函数**，它们全绿也不能说明"玩的时候能攒到"——
// 中间还隔着三段容易断的链路：
//   ① 转职藏品 → `extraTraits` → `unitMechanics`（机制到底挂上没挂上）；
//   ② 机制 → `performAttack`/`dealDamage` 真的往上加（`feverGained`）；
//   ③ 战斗结果 → `advanceRound(state, won, …, feverGained)`（传没传进来）。
// 任何一段断了，玩家的体感都是"fever 一动不动"，而前两组用例照样全绿。
describe('★★ fever 全链路：转职凑羁绊 → 真打一场 → 攒到 → 输了 ×1.5', () => {
  /** 一个打不死、出手很慢的靶子（让我们的棋子一直挨打） */
  const punchingBag: UnitPlacement = {
    defId: 'mn_duholy',
    star: 3,
    cell: { col: 5, row: 3 },
    statOverride: { hp: 100_000_000, armor: 0, magicResist: 0, attackSpeed: 0.1 },
  };

  it('① 转职给的标签真的变成了"机制"，② 挨打真的攒到 fever', () => {
    const state = createGameState(2026);
    put(state, [relic(1, 1, 'op01'), relic(1, 3, 'op02'), relic(1, 5, 'op03')]);

    const setup = toTeamSetup(state);
    for (const defId of ['op01', 'op02', 'op03']) {
      expect(
        setup.unitMechanics?.[defId]?.some((mechanic) => mechanic.kind === 'fever'),
        `${defId} 身上没有 fever 机制 —— 那 fever 永远不会涨`,
      ).toBe(true);
    }

    const teams: [TeamSetup, TeamSetup] = [
      setup,
      { team: 1, units: [punchingBag], playerContext: { gold: 0, hp: 100 } },
    ];
    const result = simulate(UNIT_DEFS, teams, 2026);
    expect(result.feverGained[0], '一直挨打就该攒到 fever').toBeGreaterThan(0);
    expect(result.feverGained[1], '对面没有这条羁绊').toBe(0);
  });

  it('★★ 打输之后：结算按 ×1.5，而且**回合那句话里能看到 fever**', () => {
    const state = createGameState(2026);
    state.round = 3; // ★ 别用第 1 回合：那是野怪回合，fever 整场跳过
    state.phase = 'prep';
    put(state, [relic(1, 1, 'op01'), relic(1, 3, 'op02'), relic(1, 5, 'op03')]);

    const setup = toTeamSetup(state);
    const teams: [TeamSetup, TeamSetup] = [
      setup,
      { team: 1, units: [punchingBag], playerContext: { gold: 0, hp: 100 } },
    ];
    const result = simulate(UNIT_DEFS, teams, 2026);
    const gained = result.feverGained[0];
    expect(gained).toBeGreaterThan(0);

    // 走**真正的入口**：advanceRound（第 7 个参数才是 fever）
    advanceRound(state, false, undefined, 0, [], 0, gained);
    expect(state.fever.total, '失败 ×1.5').toBe(Math.floor(gained * 1.5));
    expect(state.message, '★ 回合那句文案里必须能看到 fever（用户报"可能没有显示"）').toContain('fever');
  });

  it('打赢：不加倍数（按原值进账、再扣 30%）', () => {
    const state = createGameState(2026);
    state.round = 3;
    state.phase = 'prep';
    put(state, [relic(1, 1, 'op01'), relic(1, 3, 'op02'), relic(1, 5, 'op03')]);
    advanceRound(state, true, undefined, 0, [], 0, 100);
    // 100 - 30% = 70
    expect(state.fever.total).toBe(70);
  });
});

/**
 * ★★ 0.2（用户 2026-10-17）：「fever 达到最高档位后，后面每一回合（不含野怪回合）都弹窗」。
 *
 * 走真的结算入口（`applyFeverAfterBattle`）验一遍 —— 纯函数那半在
 * `packages/shared/test/fever-prompt.test.ts` 里单独钉了。
 */
describe('★★ 最高档之后：每回合布阵都问一次', () => {
  /** 8 件转职 = 最高档（8 人） */
  function maxTierState() {
    const state = createGameState(2026);
    put(state, [
      relic(1, 1, 'op01'), relic(1, 3, 'op02'), relic(1, 5, 'op03'),
      relic(2, 1, 'op04'), relic(2, 3, 'op05'), relic(2, 5, 'op06'),
      relic(3, 1, 'op07'), relic(3, 3, 'op08'),
    ]);
    state.fever.total = 3000;
    return state;
  }

  it('★ 站在 3000：这一回合弹、点了「保留」下一回合还弹', () => {
    const state = maxTierState();
    applyFeverAfterBattle(state, { won: true, gained: 0, round: 4 });
    expect(state.fever.prompt, '到最高档了，该问').toBe(3000);

    expect(holdFever(state), '点「保留」').toBe(true);
    expect(state.fever.prompt).toBeNull();

    applyFeverAfterBattle(state, { won: true, gained: 0, round: 5 });
    expect(state.fever.prompt, '下一回合照样问（不消耗也能反复看到）').toBe(3000);
  });

  it('★ 野怪回合：不新建弹窗（界面靠 isMonsterRound 藏起来）', () => {
    const state = maxTierState();
    applyFeverAfterBattle(state, { won: true, gained: 0, round: 4 });
    expect(state.fever.prompt).toBe(3000);
    holdFever(state);

    applyFeverAfterBattle(state, { won: null, gained: 0, round: 9 });
    expect(state.fever.prompt, '野怪回合不弹').toBeNull();
  });

  it('★ 消耗完归零：不再每回合弹（要重新攒到最高档）', () => {
    const state = maxTierState();
    applyFeverAfterBattle(state, { won: true, gained: 0, round: 4 });
    spendFever(state);
    expect(state.fever.total).toBe(0);
    applyFeverAfterBattle(state, { won: true, gained: 0, round: 5 });
    expect(state.fever.prompt, '清零了就没得问').toBeNull();
  });
});
