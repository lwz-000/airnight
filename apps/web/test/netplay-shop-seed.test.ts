/**
 * ============================================================
 *  联机：商店种子 / 牌库视图 / 单机预览开关（纯逻辑回归）
 * ============================================================
 *
 * 对应三个用户手测报出的 bug：
 *   ① 联机里冒出单机的人机预览        -> shouldShowSoloEnemy
 *   ② 几个人的商店刷出一模一样的牌    -> playerShopSeed
 *   ③ 别人买走牌，我这边数量不减少    -> poolRemainingOf vs poolRemaining
 */
import { describe, expect, it, afterEach } from 'vitest';
import { poolSizeOf, playableDefs } from '../../../packages/shared/src/index.js';
import { playerShopSeed } from '../src/net/netplay-client.js';
import {
  createGameState,
  poolRemaining,
  poolRemainingOf,
  setNetPoolView,
  type GameState,
} from '../src/game/state.js';
import { shouldShowSoloEnemy } from '../src/game/prep-sprites.js';

/**
 * 联机分支里除了"牌库视图"之外什么都用不到，所以给个空壳。
 *
 * ★ 0.3.3 起不能再用 `null`：`setNetPoolView` 多了个"挂到某个具体 state 上"的重载
 * （人机在服务端是多个玩家共用一个进程，视图必须各存各的），
 * 而 `poolRemaining` / `poolRemainingOf` 会读 `state.netPool`。
 * 这里把它显式写成 `null`（= 走客户端那份模块级视图），和浏览器里的行为一致。
 */
const fakeState = { netPool: null } as unknown as GameState;

afterEach(() => {
  setNetPoolView(null); // 清掉模块级的联机视图，别污染别的用例
});

// ============================================================
// ① 单机人机预览：只属于单机
// ============================================================

describe('★ 布阵阶段的"人机对手预览"只该出现在单机里', () => {
  it('单机 + 对局界面 + 没在看别人 -> 显示', () => {
    expect(shouldShowSoloEnemy({ netplay: false, onGameView: true, viewingOther: false })).toBe(true);
  });

  it('★ 联机对局里绝不显示（这就是用户报的"联机也冒出人机预览"）', () => {
    expect(shouldShowSoloEnemy({ netplay: true, onGameView: true, viewingOther: false })).toBe(false);
  });

  it('大厅里不显示（那时候 phase 也是 prep，但游戏还没开始）', () => {
    expect(shouldShowSoloEnemy({ netplay: false, onGameView: false, viewingOther: false })).toBe(false);
  });

  it('正在看别人的棋盘时不显示（画面已经被人家的棋子占满了）', () => {
    expect(shouldShowSoloEnemy({ netplay: false, onGameView: true, viewingOther: true })).toBe(false);
  });
});

// ============================================================
// ② 商店随机种子：必须因人而异，且不看时间
// ============================================================

describe('★ 联机商店的随机种子', () => {
  it('同一个玩家 + 同一个房间 -> 稳定（可复现）', () => {
    expect(playerShopSeed('ABC123', 'p1-mv16svlm')).toBe(playerShopSeed('ABC123', 'p1-mv16svlm'));
  });

  it('★ 不同玩家 -> 不同种子（否则所有人商店一模一样）', () => {
    const seeds = new Set(
      ['p1-aaa', 'p2-bbb', 'p3-ccc', 'p4-ddd', 'p5-eee', 'p6-fff', 'p7-ggg', 'p8-hhh'].map((id) =>
        playerShopSeed('ABC123', id),
      ),
    );
    expect(seeds.size).toBe(8);
  });

  it('不同房间 -> 不同种子（同名玩家换个房间也不会刷出同一批牌）', () => {
    expect(playerShopSeed('ABC123', 'p1-aaa')).not.toBe(playerShopSeed('XYZ789', 'p1-aaa'));
  });

  it('★ 8 个人各自的"第一刷"不会撞车（起手 5 格完全相同的概率为 0）', () => {
    const seeds = Array.from({ length: 8 }, (_, i) => playerShopSeed('ROOM01', `p${i + 1}-x`));
    expect(new Set(seeds).size).toBe(8);
  });
});

// ============================================================
// ③ 牌库视图：显示用"真实库存"，刷商店用"我还能刷到的"
// ============================================================

describe('★ 联机牌库的两个视图', () => {
  // 取一个**能买到**的棋子（野怪/召唤物不进牌库，拿它们测牌库没意义）
  const defId = playableDefs()
    .map((def) => def.id)
    .sort()[0]!;
  const me = 'p3';
  const other = 'p2';

  it('别人商店里"预定"的牌：库存不变，但我刷不到那一张', () => {
    // 牌库 27 张；p2 的商店里摆着 1 张 defId（还没买走）
    setNetPoolView({ [defId]: 27 }, { [defId]: [other] }, me);
    // 显示：真实库存，还是 27（他只是"占着"）
    expect(poolRemainingOf(fakeState, defId)).toBe(27);
    // 刷商店：扣掉别人摆着的那张，我抽不到 -> 26
    expect(poolRemaining(fakeState).get(defId)).toBe(26);
  });

  it('★ 别人买走之后：我看到的数量必须跟着减 1（原来会被"预定"抵消掉）', () => {
    setNetPoolView({ [defId]: 27 }, { [defId]: [other] }, me);
    const shownBeforeBuy = poolRemainingOf(fakeState, defId);

    // p2 真的买走了：真实库存 26，他的"预定"同时撤销
    setNetPoolView({ [defId]: 26 }, {}, me);
    const shownAfterBuy = poolRemainingOf(fakeState, defId);

    expect(shownAfterBuy).toBe(26);
    expect(shownBeforeBuy - shownAfterBuy, '别人买走一张，我这边就该少 1').toBe(1);
  });

  it('我自己商店里摆着的牌不算"被别人占"', () => {
    setNetPoolView({ [defId]: 5 }, { [defId]: [me] }, me);
    expect(poolRemaining(fakeState).get(defId), '自己占的不该扣').toBe(5);
    expect(poolRemainingOf(fakeState, defId)).toBe(5);
  });

  it('传 null 回到单机：玩家空手时每个干员都是满货', () => {
    setNetPoolView(null);
    const state = createGameState(12345);
    expect(poolRemainingOf(state, defId)).toBe(poolSizeOf(defId));
    expect(poolRemaining(state).get(defId)).toBe(poolSizeOf(defId));
  });
});
