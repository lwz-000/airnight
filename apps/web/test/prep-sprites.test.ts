/**
 * 布阵棋子"排布计划"的测试。
 *
 * 【为什么专门测这个？】
 * 这里踩过一次很严重的坑：同步函数只处理了「新增」和「删除」，
 * **忘了「移动」**。后果是拖动换位之后数据变了、贴图还留在原地，
 * 于是画面上的 A 站在 B 的格子上，而拾取按贴图位置算 ——
 * 接下来拖的会是另一个棋子，整个棋盘看起来就是"位置乱飞"。
 *
 * 所以这组测试的核心是：**位置变化必须变成一个显式的"移动"动作**，
 * 不能是"顺手看看位置对不对"这种可选项。
 */

import { describe, expect, it } from 'vitest';
import {
  ENEMY_UID_BASE,
  diffPrepSprites,
  isEnemyUid,
  planPrepSprites,
  prepSpritesVisible,
  type GamePhase,
  type SpritePlan,
} from '../src/game/prep-sprites.js';

/**
 * 测试里默认用「布阵阶段」。
 * 阶段是**必填参数**（故意的，见 prepSpritesVisible 的注释），
 * 所以这里包一层，省得每行都写一遍。
 */
function planOf(
  placements: ReadonlyArray<{
    uid: number;
    defId: string;
    star: number;
    cell: { col: number; row: number };
    /** ★ 0.0.3：身上装的 A 类藏品（只影响"画几个绿点"，见 SpritePlan.items） */
    items?: string[];
  }>,
  phase: GamePhase = 'prep',
): SpritePlan[] {
  return planPrepSprites(placements, { phase });
}

function unit(uid: number, col: number, row: number, star = 1, defId = 'op01'): SpritePlan {
  return { uid, defId, star, cell: { col, row } };
}

describe('排布计划', () => {
  it('把阵容映射成"每个精灵该在哪"', () => {
    const plan = planOf([
      { uid: 7, defId: 'op03', star: 2, cell: { col: 1, row: 4 } },
      { uid: 3, defId: 'op01', star: 1, cell: { col: 0, row: 0 } },
    ]);
    expect(plan).toHaveLength(2);
    // 按 uid 升序，保证顺序稳定
    expect(plan.map((item) => item.uid)).toEqual([3, 7]);
    // ★ items 也要进计划：装备是棋子外观的一部分（0 = 两个灰点）
    expect(plan[1]).toEqual({ uid: 7, defId: 'op03', star: 2, cell: { col: 1, row: 4 }, items: 0 });
  });

  it('★ 身上装的藏品要进计划（只记件数）', () => {
    const plan = planOf([
      { uid: 1, defId: 'op01', star: 1, cell: { col: 0, row: 0 }, items: ['itm_solvent'] },
      { uid: 2, defId: 'op02', star: 1, cell: { col: 1, row: 0 }, items: ['itm_solvent', 'itm_ration'] },
      { uid: 3, defId: 'op03', star: 1, cell: { col: 2, row: 0 } },
    ]);
    expect(plan.map((item) => item.items)).toEqual([1, 2, 0]);
  });

  it('复制格子对象，外部改动不影响计划', () => {
    const cell = { col: 2, row: 2 };
    const plan = planOf([{ uid: 1, defId: 'op01', star: 1, cell }]);
    cell.col = 9;
    expect(plan[0]!.cell.col).toBe(2);
  });

  it('空阵容得到空计划', () => {
    expect(planOf([])).toEqual([]);
  });
});

describe('★ 差异计算必须覆盖"移动"（这里曾经漏过）', () => {
  it('★ 同一个棋子换了个格子 -> 必须产生一个 moved', () => {
    const before = planOf([{ uid: 1, defId: 'op01', star: 1, cell: { col: 0, row: 0 } }]);
    const after = planOf([{ uid: 1, defId: 'op01', star: 1, cell: { col: 3, row: 5 } }]);

    const diff = diffPrepSprites(before, after);
    expect(diff.moved, '换位置必须被识别成"移动"').toHaveLength(1);
    expect(diff.moved[0]!.cell).toEqual({ col: 3, row: 5 });
    // 不能同时被当成"新建"或"删除"，否则会重复创建精灵
    expect(diff.created).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
  });

  it('★ 两个棋子交换位置 -> 两个都要移动', () => {
    const before = planOf([
      { uid: 1, defId: 'op01', star: 1, cell: { col: 0, row: 0 } },
      { uid: 2, defId: 'op02', star: 1, cell: { col: 4, row: 9 } },
    ]);
    const after = planOf([
      { uid: 1, defId: 'op01', star: 1, cell: { col: 4, row: 9 } },
      { uid: 2, defId: 'op02', star: 1, cell: { col: 0, row: 0 } },
    ]);

    const diff = diffPrepSprites(before, after);
    expect(diff.moved).toHaveLength(2);
    expect(diff.created).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
  });

  it('位置没变就不该产生任何动作（否则每帧都在白忙）', () => {
    const plan = planOf([{ uid: 1, defId: 'op01', star: 1, cell: { col: 2, row: 2 } }]);
    const diff = diffPrepSprites(plan, plan);
    expect(diff.created).toHaveLength(0);
    expect(diff.moved).toHaveLength(0);
    expect(diff.restyled).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
  });

  it('新增（放上场）', () => {
    const diff = diffPrepSprites([], [unit(5, 1, 1)]);
    expect(diff.created.map((item) => item.uid)).toEqual([5]);
  });

  it('删除（收回备战席）', () => {
    const diff = diffPrepSprites([unit(5, 1, 1)], []);
    expect(diff.removed).toEqual([5]);
  });

  it('★ 升星 -> restyled（不然画面上还是 1 星的卡）', () => {
    const before = planOf([{ uid: 1, defId: 'op01', star: 1, cell: { col: 0, row: 0 } }]);
    const after = planOf([{ uid: 1, defId: 'op01', star: 2, cell: { col: 0, row: 0 } }]);
    const diff = diffPrepSprites(before, after);
    expect(diff.restyled).toHaveLength(1);
    expect(diff.restyled[0]!.star).toBe(2);
    expect(diff.moved).toHaveLength(0);
  });

  it('换成另一个干员（合成后 uid 变了）-> 旧的删掉、新的建出来', () => {
    const before = planOf([{ uid: 1, defId: 'op01', star: 1, cell: { col: 0, row: 0 } }]);
    // 合成后是新的 uid，占的还是那一格
    const after = planOf([{ uid: 99, defId: 'op01', star: 2, cell: { col: 0, row: 0 } }]);
    const diff = diffPrepSprites(before, after);
    expect(diff.created.map((item) => item.uid)).toEqual([99]);
    expect(diff.removed).toEqual([1]);
  });

  it('移动 + 升星同时发生 -> 两个动作都要有', () => {
    const before = planOf([{ uid: 1, defId: 'op01', star: 1, cell: { col: 0, row: 0 } }]);
    const after = planOf([{ uid: 1, defId: 'op01', star: 3, cell: { col: 2, row: 7 } }]);
    const diff = diffPrepSprites(before, after);
    expect(diff.moved).toHaveLength(1);
    expect(diff.restyled).toHaveLength(1);
  });

  it('多棋子混合变化：增删移换一次算清', () => {
    const before = planOf([
      { uid: 1, defId: 'op01', star: 1, cell: { col: 0, row: 0 } }, // 会移动
      { uid: 2, defId: 'op02', star: 1, cell: { col: 1, row: 0 } }, // 会被收回
      { uid: 3, defId: 'op03', star: 1, cell: { col: 2, row: 0 } }, // 不动
    ]);
    const after = planOf([
      { uid: 1, defId: 'op01', star: 1, cell: { col: 0, row: 5 } },
      { uid: 3, defId: 'op03', star: 1, cell: { col: 2, row: 0 } },
      { uid: 4, defId: 'op04', star: 1, cell: { col: 3, row: 0 } }, // 新上场
    ]);

    const diff = diffPrepSprites(before, after);
    expect(diff.moved.map((item) => item.uid)).toEqual([1]);
    expect(diff.removed).toEqual([2]);
    expect(diff.created.map((item) => item.uid)).toEqual([4]);
    expect(diff.restyled).toHaveLength(0);
  });
});

/*
  ============================================================
  ★ 0.0.3 藏品圆点（血条左边那两个小圆圈）
  ============================================================
  【为什么要单独一类 diff？】
  因为"装上一件藏品"必须被识别成**一种要处理的变化** ——
  否则玩家拖完藏品，数值真的生效了，但棋子身上还是两个灰点。
  而且它不能被算成 restyled：restyled 会重建小人模型（异步、会闪），
  只为换一张 13px 的小圆点贴图去重建模型，看起来就是"拖一下抖一下"。
*/
describe('★ 0.0.3 藏品圆点：件数变了要单独算一类', () => {
  it('★ 装上一件 -> retooled（且不能同时被当成 restyled）', () => {
    const before = planOf([{ uid: 1, defId: 'op01', star: 1, cell: { col: 0, row: 0 } }]);
    const after = planOf([
      { uid: 1, defId: 'op01', star: 1, cell: { col: 0, row: 0 }, items: ['itm_solvent'] },
    ]);
    const diff = diffPrepSprites(before, after);
    expect(diff.retooled.map((item) => item.uid)).toEqual([1]);
    expect(diff.retooled[0]!.items).toBe(1);
    // 干员没换、星级没换、位置没换 -> 另外三类都必须是空的
    expect(diff.restyled, '换圆点不该重建小人').toHaveLength(0);
    expect(diff.moved).toHaveLength(0);
    expect(diff.created).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
  });

  it('装到第二件也要算', () => {
    const before = planOf([
      { uid: 1, defId: 'op01', star: 1, cell: { col: 0, row: 0 }, items: ['itm_solvent'] },
    ]);
    const after = planOf([
      { uid: 1, defId: 'op01', star: 1, cell: { col: 0, row: 0 }, items: ['itm_solvent', 'itm_ration'] },
    ]);
    expect(diffPrepSprites(before, after).retooled[0]!.items).toBe(2);
  });

  it('★ 卸下（1 -> 0 件）也要算 —— 不然绿点会赖着不走', () => {
    const before = planOf([
      { uid: 1, defId: 'op01', star: 1, cell: { col: 0, row: 0 }, items: ['itm_solvent'] },
    ]);
    const after = planOf([{ uid: 1, defId: 'op01', star: 1, cell: { col: 0, row: 0 } }]);
    expect(diffPrepSprites(before, after).retooled[0]!.items).toBe(0);
  });

  it('件数没变 -> 一个动作都不产生（装备是"哪两件"不影响外观）', () => {
    const before = planOf([
      { uid: 1, defId: 'op01', star: 1, cell: { col: 0, row: 0 }, items: ['itm_solvent'] },
    ]);
    const after = planOf([
      { uid: 1, defId: 'op01', star: 1, cell: { col: 0, row: 0 }, items: ['itm_ration'] },
    ]);
    const diff = diffPrepSprites(before, after);
    expect(diff.retooled).toHaveLength(0);
    expect(diff.restyled).toHaveLength(0);
    expect(diff.moved).toHaveLength(0);
  });

  it('移动和换装备同时发生 -> 两条都要有', () => {
    const before = planOf([{ uid: 1, defId: 'op01', star: 1, cell: { col: 0, row: 0 } }]);
    const after = planOf([
      { uid: 1, defId: 'op01', star: 1, cell: { col: 2, row: 6 }, items: ['itm_solvent'] },
    ]);
    const diff = diffPrepSprites(before, after);
    expect(diff.moved).toHaveLength(1);
    expect(diff.retooled).toHaveLength(1);
  });

  it('星数为 undefined 的老计划被当成 0 件（兼容旧数据）', () => {
    const before: SpritePlan[] = [{ uid: 1, defId: 'op01', star: 1, cell: { col: 0, row: 0 } }];
    const after = planOf([
      { uid: 1, defId: 'op01', star: 1, cell: { col: 0, row: 0 }, items: ['itm_solvent'] },
    ]);
    expect(diffPrepSprites(before, after).retooled).toHaveLength(1);
  });
});

describe('★ 战斗中不能显示布阵棋子（会在原地留下一张残影）', () => {
  /*
    用户报的 bug：「干员开始移动时，原地会留有一个贴图」。

    根因：布阵棋子代表"玩家摆的阵容"（静止的）。战斗开始时演出层会另外
    生成一套会动的棋子，如果这套静止的没被收起来，同一格就叠着两个。
    因为两套一开始**位置完全重合**，根本看不出来 ——
    直到棋子开始移动，静止的那个留在原地，才像"移动时留下残影"。

    触发路径：把精灵同步放进 renderAll()（为了修"升星后旧贴图不消失"），
    但 renderAll() 在战斗中也会被调用，于是每次都把布阵棋子重新建出来。
    所以阶段现在是**必填参数**：不传就编译不过。
  */
  const placements = [
    { uid: 1, defId: 'op01', star: 1, cell: { col: 0, row: 0 } },
    { uid: 2, defId: 'op02', star: 1, cell: { col: 0, row: 1 } },
  ];

  it('只有布阵阶段才显示', () => {
    expect(prepSpritesVisible('prep')).toBe(true);
    expect(prepSpritesVisible('battle')).toBe(false);
    expect(prepSpritesVisible('result')).toBe(false);
  });

  /**
   * ★★ 0.2 商店回合：它是"回合之间插入的 90 秒"，玩家在里面买卖东西，
   * 棋盘上摆着什么是他决策的依据；而且弹窗**可以关掉**，
   * 关掉之后棋子消失了会被当成"阵容丢了"。
   * 所以 `shop` 必须和 `prep` 一样算"布阵可见" ——
   * 少了这一条的表现是：一进商店整个棋盘空掉。
   */
  it('★★ 0.2 商店回合也算"布阵可见"（棋盘不能空）', () => {
    expect(prepSpritesVisible('shop')).toBe(true);
    expect(planOf(placements, 'shop')).toHaveLength(2);
  });

  it('★ 战斗阶段的计划是空的（空计划 = 所有精灵都该移除）', () => {
    expect(planOf(placements, 'battle')).toEqual([]);
    expect(planOf(placements, 'result')).toEqual([]);
    // 布阵阶段正常
    expect(planOf(placements, 'prep')).toHaveLength(2);
  });

  it('★ 从布阵切到战斗 -> 差异里全是 removed，一个都不留', () => {
    const before = planOf(placements, 'prep');
    const after = planOf(placements, 'battle');
    const diff = diffPrepSprites(before, after);

    expect(diff.removed.sort((a, b) => a - b)).toEqual([1, 2]);
    // 关键：不能有任何 created，否则就"重新建出来了"（正是那个 bug）
    expect(diff.created).toHaveLength(0);
    expect(diff.moved).toHaveLength(0);
  });

  it('★ 战斗中反复同步（renderAll 会被反复调用）依然什么都不建', () => {
    // 先切到战斗，清空
    let current = planOf(placements, 'battle');
    expect(current).toEqual([]);
    // 再模拟"战斗中又调了几次 renderAll"
    for (let i = 0; i < 5; i++) {
      const next = planOf(placements, 'battle');
      const diff = diffPrepSprites(current, next);
      expect(diff.created, '战斗中不该新建任何布阵精灵').toHaveLength(0);
      current = next;
    }
  });

  it('战斗结束回到布阵 -> 棋子重新出现（阵容还在）', () => {
    const during = planOf(placements, 'battle');
    const after = planOf(placements, 'prep');
    const diff = diffPrepSprites(during, after);
    expect(diff.created.map((item) => item.uid).sort((a, b) => a - b)).toEqual([1, 2]);
    expect(diff.removed).toHaveLength(0);
  });
});

/**
 * ============================================================
 *  布阵阶段显示对手（0.0.2 追加需求）
 * ============================================================
 *
 * 需求："在布阵阶段就可以看到对方的干员"。
 * 对手的棋子不在 state.placements 里（那是玩家的阵容），
 * 所以它们靠**负数 uid** 挤进同一张计划表，才能享受同一套"增删改移"的同步逻辑。
 * 这里把三个关键点钉住：编号不撞车、战斗阶段不画、跨回合同一位置的棋子保住编号。
 */
describe('★ 布阵阶段把对手的棋子也排出来', () => {
  const mine = [{ uid: 1, defId: 'op01', star: 1, cell: { col: 1, row: 1 } }];
  const enemy = [
    { defId: 'op02', star: 1, cell: { col: 5, row: 0 } },
    { defId: 'op03', star: 2, cell: { col: 5, row: 2 } },
  ];

  it('布阵阶段：我方 + 对手都在计划里，对手带 enemy 标记和负数 uid', () => {
    const plan = planPrepSprites(mine, { phase: 'prep', enemy });
    expect(plan).toHaveLength(3);

    const enemyPlans = plan.filter((item) => item.enemy);
    expect(enemyPlans).toHaveLength(2);
    expect(enemyPlans.every((item) => isEnemyUid(item.uid))).toBe(true);
    // 计划按 uid 升序排在前面，所以这里比对集合而不是顺序
    expect(new Set(enemyPlans.map((item) => item.uid))).toEqual(
      new Set([ENEMY_UID_BASE, ENEMY_UID_BASE - 1]),
    );
    // 对手的格子在棋盘右半边（col >= 5）
    expect(enemyPlans.every((item) => item.cell.col >= 5)).toBe(true);
  });

  it('不传对手时行为和以前完全一样（老调用点不受影响）', () => {
    const plan = planPrepSprites(mine, { phase: 'prep' });
    expect(plan).toHaveLength(1);
    expect(plan[0]!.enemy).toBeUndefined();
  });

  it('战斗阶段一个都不画 —— 包括对手（否则会和演出层的棋子叠在一起）', () => {
    expect(planPrepSprites(mine, { phase: 'battle', enemy })).toEqual([]);
    expect(planPrepSprites(mine, { phase: 'result', enemy })).toEqual([]);
  });

  it('★ 同一位置的对手棋子跨回合保住 uid（升级是"换贴图"，不是删了重建）', () => {
    const before = planPrepSprites([], { phase: 'prep', enemy });
    // 第二回合那个 2 星升成 3 星：位置没变
    const after = planPrepSprites([], {
      phase: 'prep',
      enemy: [enemy[0]!, { ...enemy[1]!, star: 3 }],
    });
    const diff = diffPrepSprites(before, after);
    expect(diff.created, '不该整队重建（重建会闪一下）').toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.restyled.map((item) => item.uid)).toEqual([ENEMY_UID_BASE - 1]);
  });

  it('对手换人了 -> 是"换贴图"而不是"删了再加"', () => {
    const before = planPrepSprites([], { phase: 'prep', enemy });
    const after = planPrepSprites([], {
      phase: 'prep',
      enemy: [enemy[0]!, { defId: 'op09', star: 1, cell: enemy[1]!.cell }],
    });
    const diff = diffPrepSprites(before, after);
    expect(diff.restyled.map((item) => item.uid)).toEqual([ENEMY_UID_BASE - 1]);
  });

  it('对手棋子变多时，老编号不会被顶掉', () => {
    const before = planPrepSprites([], { phase: 'prep', enemy: enemy.slice(0, 1) });
    const after = planPrepSprites([], { phase: 'prep', enemy });
    const diff = diffPrepSprites(before, after);
    expect(diff.created.map((item) => item.uid)).toEqual([ENEMY_UID_BASE - 1]);
    expect(diff.moved).toHaveLength(0);
  });
});

/**
 * ============================================================
 *  ★ 0.0.3 测试沙盒：红方棋子带**自己的真实 uid**
 * ============================================================
 *
 * 测试模式里左右两边都是玩家自己摆的，红方那套状态里的棋子本来就有
 * 正数 uid（和蓝方的 uid 各自独立编号，不会撞车）。
 * 所以 planPrepSprites 的 enemy 通道现在允许棋子自带 uid ——
 * 这样"红方撤掉/挪动一只棋子"只会影响那一只，
 * 不会因为**下标错位**把后面的棋子全判成"换人了"（贴图会闪、会重建）。
 */
describe('★ 测试沙盒：红方棋子带着自己的 uid（0.0.3）', () => {
  const blue = [
    { uid: 1, defId: 'op01', star: 1, cell: { col: 1, row: 1 } },
    { uid: 2, defId: 'op02', star: 1, cell: { col: 2, row: 1 } },
  ];
  const red = [
    { uid: 101, defId: 'mn_slime', star: 1, cell: { col: 5, row: 1 } },
    { uid: 102, defId: 'mn_gopro', star: 1, cell: { col: 6, row: 1 } },
    { uid: 103, defId: 'mn_nsabr', star: 1, cell: { col: 7, row: 1 } },
  ];
  /** 老路径（不给 uid）的形状：只有 defId/star/cell */
  const strip = (list: Array<{ defId: string; star: number; cell: { col: number; row: number } }>) =>
    list.map((u) => ({ defId: u.defId, star: u.star, cell: u.cell }));

  it('两侧棋子一起排布：红方保留自己的正数 uid，并带 enemy 标记', () => {
    const plan = planPrepSprites(blue, { phase: 'prep', enemy: red });
    expect(plan).toHaveLength(5);

    const redPlans = plan.filter((item) => item.enemy);
    expect(redPlans.map((item) => item.uid).sort((a, b) => a - b)).toEqual([101, 102, 103]);
    // 红方不该再被编成负数（那会和 ENEMY_UID_BASE 编号空间撞车）
    expect(redPlans.some((item) => isEnemyUid(item.uid))).toBe(false);

    // 蓝方在左半场、红方在右半场 —— 需求就是"两侧同时可见"
    expect(plan.filter((item) => !item.enemy).every((item) => item.cell.col <= 4)).toBe(true);
    expect(redPlans.every((item) => item.cell.col >= 5)).toBe(true);

    // uid 升序（渲染与差异比较都依赖顺序稳定）
    expect(plan.map((item) => item.uid)).toEqual(
      [...plan.map((item) => item.uid)].sort((a, b) => a - b),
    );
  });

  it('红方挪一只棋子 -> 只产生一个 moved', () => {
    const before = planPrepSprites(blue, { phase: 'prep', enemy: red });
    const after = planPrepSprites(blue, {
      phase: 'prep',
      enemy: [{ ...red[0]!, cell: { col: 9, row: 4 } }, red[1]!, red[2]!],
    });
    const diff = diffPrepSprites(before, after);
    expect(diff.moved.map((item) => item.uid)).toEqual([101]);
    expect(diff.created).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.restyled).toHaveLength(0);
  });

  it('★ 红方撤掉最前面那只 -> 只剩一个 removed，后面两只不受牵连', () => {
    const before = planPrepSprites(blue, { phase: 'prep', enemy: red });
    const after = planPrepSprites(blue, { phase: 'prep', enemy: [red[1]!, red[2]!] });
    const diff = diffPrepSprites(before, after);
    expect(diff.removed).toEqual([101]);
    expect(diff.moved, '自带 uid 才能做到：后面两只原封不动').toHaveLength(0);
    expect(diff.created).toHaveLength(0);
  });

  it('对照组：不给 uid 的老路径（按下标编号）撤掉最前面那只会整队错位', () => {
    /*
      这就是"给对手棋子自带 uid"要解决的问题：
      按下标编号时，撤掉第 1 只 -> 第 2、3 只的下标各往前挪一格，
      于是它们全被当成"移动了"（真实渲染里表现为贴图重建、闪一下）。
      老调用点（单机人机预览 / 联机预览）阵容整队重算，本来就不在意这个，
      所以它们继续用下标编号，行为不变。
    */
    const before = planPrepSprites(blue, { phase: 'prep', enemy: strip(red) });
    const after = planPrepSprites(blue, { phase: 'prep', enemy: strip([red[1]!, red[2]!]) });
    const diff = diffPrepSprites(before, after);
    // 按下标编号，撤掉的其实是"最后一号"（-100000-2），而前两号被迫接了下标 0/1
    expect(diff.removed).toEqual([ENEMY_UID_BASE - 2]);
    expect(diff.moved.length, '老路径会多出两次"移动"（错位）').toBe(2);
  });
});
