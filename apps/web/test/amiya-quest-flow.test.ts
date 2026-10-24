/**
 * ============================================================
 *  ★★ 0.3.2 阿米娅升变任务：客户端流程
 * ============================================================
 *
 * 守的是"规则真的生效"这件事，而不是文案：
 *   1. 开局送的那只阿米娅（1 星、不占牌库、幂等）；
 *   2. **野怪回合不算**、**坐在备战席不算参战**、**没选盟约完全不统计**；
 *   3. 两段任务各自推进到 `awaiting`，不会重复推进；
 *   4. 三张证走**专用栏位**：不占穿戴藏品那 10 格，A 类满了照样发得下来；
 *   5. 装证时只清 cert 那一格 —— **绝不能误删 aSlots 里玩家自己的藏品**。
 */
import { describe, expect, it } from 'vitest';
import {
  AMIYA_BASE_ID,
  AMIYA_CERT_IDS,
  AMIYA_QUEST_BATTLES,
  AMIYA_QUEST_DAMAGE,
  AMIYA_QUEST_LEVEL,
  AMIYA_QUEST_WINS,
  ITEM_A_SLOTS,
  type Cell,
} from '../../../packages/shared/src/index.js';
import {
  advanceRound,
  amiyaStarOf,
  applyCovenantOpening,
  createGameState,
  equipItemToUnit,
  grantAscendCert,
  type GameState,
} from '../src/game/state.js';

let uidSeq = 7000;
const freshUid = (): number => uidSeq++;

/** 造一局：选了「不容拒绝」，没有别的棋子 */
function questState(round = 3): GameState {
  const state = createGameState(7);
  state.covenantId = 'cv_amiya';
  state.round = round;
  state.economy.bench = [];
  state.placements = [];
  return state;
}

/** 把一只阿米娅放到场上（参战） */
function deployAmiya(state: GameState, defId = AMIYA_BASE_ID, star = 1, cell: Cell = { col: 2, row: 7 }): number {
  const uid = freshUid();
  state.placements.push({ uid, defId, star, cell });
  return uid;
}

describe('★ 开局送 1 星阿米娅', () => {
  it('选了「不容拒绝」：备战席多一只 1 星阿米娅，而且**不占牌库**', () => {
    const state = questState();
    const text = applyCovenantOpening(state);
    expect(text).toContain('阿米娅');
    expect(state.economy.bench).toHaveLength(1);
    const unit = state.economy.bench[0]!;
    expect(unit.defId).toBe(AMIYA_BASE_ID);
    expect(unit.star).toBe(1);
    expect(unit.free, '★ 盟约白送的棋子不能占共享牌库（否则 8 个人都能刷牌）').toBe(true);
  });

  it('★ 幂等：调两次也只送一只', () => {
    const state = questState();
    applyCovenantOpening(state);
    applyCovenantOpening(state);
    expect(state.economy.bench).toHaveLength(1);
  });

  it('★ 手上已经有阿米娅（重连场景）就不再送第二只', () => {
    const state = questState();
    deployAmiya(state);
    expect(applyCovenantOpening(state)).toBeNull();
    expect(state.economy.bench).toHaveLength(0);
  });

  it('没选这条盟约就什么都不发', () => {
    const state = questState();
    state.covenantId = 'cv_golia';
    expect(applyCovenantOpening(state)).toBeNull();
    expect(state.economy.bench).toHaveLength(0);
  });
});

describe('★ 任务统计口径', () => {
  it('参战且有伤害就记一笔；赢了算胜场', () => {
    const state = questState();
    deployAmiya(state);
    advanceRound(state, true, undefined, 0, [], 0, 0, 1234);
    const quest = state.covenant.amiyaQuest;
    expect(quest.battles).toBe(1);
    expect(quest.wins).toBe(1);
    expect(quest.damage).toBe(1234);
  });

  it('★★ 野怪回合不算（`isMonsterRound`：第 1、2 回合，之后每 7 回合一次 = 9、16、23…）', () => {
    for (const round of [1, 2, 9, 16]) {
      const state = questState(round);
      deployAmiya(state);
      advanceRound(state, true, undefined, 0, [], 0, 0, 5000);
      expect(state.covenant.amiyaQuest.battles, `第 ${round} 回合是野怪，不该计`).toBe(0);
      expect(state.covenant.amiyaQuest.damage).toBe(0);
    }
  });

  it('★ 只坐在备战席不算参战（否则"买了就躺"也能刷）', () => {
    const state = questState();
    state.economy.bench.push({ uid: freshUid(), defId: AMIYA_BASE_ID, star: 1 });
    advanceRound(state, true, undefined, 0, [], 0, 0, 999);
    expect(state.covenant.amiyaQuest.battles).toBe(0);
  });

  it('★★ 测试模式也统计（用户报"测试模式里阿米娅伤害不累计"）', () => {
    const state = questState();
    // 测试模式进对局时根本没有盟约
    state.covenantId = undefined;
    state.testMode = true;
    deployAmiya(state);
    advanceRound(state, true, undefined, 0, [], 0, 0, 800);
    const quest = state.covenant.amiyaQuest;
    expect(quest.battles, '否则沙盒里根本没法验证这套玩法').toBe(1);
    expect(quest.damage).toBe(800);
  });

  it('没选这条盟约就一条都不记', () => {
    const state = questState();
    state.covenantId = 'cv_laoli';
    deployAmiya(state);
    advanceRound(state, true, undefined, 0, [], 0, 0, 9999);
    // 进度对象还在（每个人都有），但数字必须没动
    expect(state.covenant.amiyaQuest.battles).toBe(0);
    expect(state.covenant.amiyaQuest.damage).toBe(0);
  });

  it('★★ 重连后的"空结算"不能白送一场（没有战报 = won 为 null 且没伤害）', () => {
    const state = questState();
    deployAmiya(state);
    // 重连场景：走了 advanceRound，但这一场根本没有战报
    advanceRound(state, null, undefined, 0, [], 0, 0, 0);
    expect(state.covenant.amiyaQuest.battles, '★ 否则刷新两次页面就凑够了任务').toBe(0);
  });

  it('★★ 第一阶段凑够就推到 awaiting（不重复推）', () => {
    const state = questState();
    deployAmiya(state);
    for (let i = 0; i < AMIYA_QUEST_BATTLES; i++) {
      state.round = 3 + i; // 都在真人回合段
      advanceRound(state, i < AMIYA_QUEST_WINS, undefined, 0, [], 0, 0, 100);
    }
    expect(state.covenant.amiyaQuest.battles).toBe(AMIYA_QUEST_BATTLES);
    expect(state.covenant.amiyaQuest.wins).toBe(AMIYA_QUEST_WINS);
    expect(state.covenant.amiyaQuest.stage1).toBe('awaiting');
    // 再多打几场也不会把状态推回去
    state.round = 20;
    advanceRound(state, true, undefined, 0, [], 0, 0, 100);
    expect(state.covenant.amiyaQuest.stage1).toBe('awaiting');
  });

  it('★★ 第二阶段：三星形态 + 10 级 + 伤害全到才推', () => {
    const state = questState();
    const quest = state.covenant.amiyaQuest;
    quest.damage = AMIYA_QUEST_DAMAGE;
    // 先给一个 2 星形态 -> 不该推
    deployAmiya(state, 'op_amiya_blue', 2);
    state.economy.level = AMIYA_QUEST_LEVEL;
    advanceRound(state, true, undefined, 0, [], 0, 0, 0);
    expect(quest.stage2).toBe('none');
    // 升到 3 星 -> 推
    state.placements[0]!.star = 3;
    state.round = 12;
    advanceRound(state, true, undefined, 0, [], 0, 0, 0);
    expect(amiyaStarOf(state)).toBe(3);
    expect(quest.stage2).toBe('awaiting');
  });
});

describe('★★ 升变之证专用栏位', () => {
  it('发证不占穿戴藏品那 10 格（A 类满格也发得下来）', () => {
    const state = questState();
    // 把 A 类塞满
    for (let i = 0; i < ITEM_A_SLOTS; i++) state.items.aSlots[i] = 'itm_power_fist';
    const before = [...state.items.aSlots];

    const result = grantAscendCert(state, AMIYA_CERT_IDS.blue);
    expect(result.ok, '★ 用户口径：绝不能被"栏满了"挤掉').toBe(true);
    expect(state.items.certSlots[0]).toBe(AMIYA_CERT_IDS.blue);
    expect(state.items.aSlots, 'A 类那 10 格一格都不许动').toEqual(before);
  });

  it('三张证按固定顺序落格（青色 0 / 慈悲 1 / 终曲 2）', () => {
    const state = questState();
    grantAscendCert(state, AMIYA_CERT_IDS.mercy);
    grantAscendCert(state, AMIYA_CERT_IDS.core);
    expect(state.items.certSlots[1]).toBe(AMIYA_CERT_IDS.mercy);
    expect(state.items.certSlots[2]).toBe(AMIYA_CERT_IDS.core);
    expect(state.items.certSlots[0]).toBeNull();
  });

  it('不是升变之证的东西不能从这条路进来', () => {
    const state = questState();
    expect(grantAscendCert(state, 'itm_power_fist').ok).toBe(false);
    expect(state.items.certSlots.every((slot) => slot === null)).toBe(true);
  });

  it('★★ 装证只清 cert 那一格，绝不误删 aSlots 同名下标的藏品', () => {
    const state = questState();
    const uid = deployAmiya(state);
    // 穿戴藏品栏第 1 格放一件普通藏品（和证的 slotIndex 撞号）
    state.items.aSlots[0] = 'itm_power_fist';
    grantAscendCert(state, AMIYA_CERT_IDS.blue);

    const result = equipItemToUnit(state, 0, uid, 'cert');
    expect(result.ok).toBe(true);
    expect(state.items.certSlots[0], '证用掉之后那一格清空').toBeNull();
    expect(state.items.aSlots[0], '★ 第 1 格的普通藏品必须还在').toBe('itm_power_fist');
    // 而且真的升变了
    expect(state.placements[0]!.defId).toBe('op_amiya_blue');
  });
});
