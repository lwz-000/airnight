import { BOARD_H, BOARD_W, TEAM_0_MAX_COL, TEAM_1_MIN_COL } from './constants.js';
import { UNIT_DEFS, playableDefs } from './unit-data.js';
import type { Cell, TeamSetup, UnitPlacement } from './types.js';

/**
 * 预设阵容 —— 用来快速验证战斗内核是否正常。
 *
 * 【重要：这里不写死干员名字】
 * 因为干员名单会换（现在是 50 个占位，以后换成你的正式设计）。
 * 如果写死 'knight' 这种名字，一换名单所有测试和演示全崩。
 * 所以这里**从当前干员表里挑**，挑的逻辑是「按费用取，尽量分散职业」。
 */

/**
 * 造一个己方半场的格子坐标。
 *
 * @param offset 0 = 最前排（贴近中线），数字越大越靠自己的后排
 * @param lane   第几路（行），0 .. BOARD_H-1
 *
 * 【方向说明 —— 这里很容易搞反】
 * 队伍 0（左半边）：列 0 在自己最后方，列 TEAM_0_MAX_COL 贴中线 => 越靠前排，列号越大
 * 队伍 1（右半边）：列 TEAM_1_MIN_COL 贴中线，列 BOARD_W-1 在自己最后方 => 越靠前排，列号越小
 *
 * ⚠️ 两个方向是反的。写错了会让双方的前后排完全混起来，
 * 而且因为「棋子确实落在自己的半场内」，不会报任何错 —— 属于静默 bug。
 */
export function cellFor(team: 0 | 1, offset: number, lane: number): Cell {
  if (team === 0) return { col: TEAM_0_MAX_COL - offset, row: lane };
  return { col: TEAM_1_MIN_COL + offset, row: lane };
}

/** 挑一个指定费用的干员 id。找不到就退到相邻费用 */
export function pickUnitOfCost(cost: number): string {
  /*
    ★ 只从**能买到的棋子**里挑（playableDefs）。
    野怪和召唤物也在 UNIT_DEFS 里，但它们不是"这个费用的干员" ——
    直接遍历全表的话，1 费会挑到「源石虫」、5 费会挑到 Boss，
    这些预设阵容（演示战斗、平衡探针）就全变成野怪队了。
  */
  const ids = playableDefs()
    .filter((def) => def.cost === cost)
    .map((def) => def.id)
    .sort();
  if (ids.length > 0) return ids[0]!;

  // 退而求其次：找一个费用最接近的
  const all = playableDefs().sort((a, b) => Math.abs(a.cost - cost) - Math.abs(b.cost - cost));
  if (all.length === 0) throw new Error('干员表是空的，无法构造预设阵容');
  return all[0]!.id;
}

/** 按费用列表造一支阵容。[费用, 星级, 前后偏移, 第几路] */
function make(team: 0 | 1, list: Array<[number, number, number, number]>): TeamSetup {
  const units: UnitPlacement[] = list.map(([cost, star, offset, lane]) => ({
    defId: pickUnitOfCost(cost),
    star,
    cell: cellFor(team, offset, lane),
  }));
  return { team, units };
}

/**
 * 阵容 A：铁桶阵 —— 前排近战 + 后排远程。
 * 用来测试「近战挡在前面、远程在后面输出」这条最基本的战斗逻辑。
 */
export const TEAM_KNIGHTS: TeamSetup = make(0, [
  [1, 2, 0, 1],
  [1, 2, 0, 3],
  [2, 1, 1, 2],
  [1, 2, 3, 0],
  [2, 1, 3, 2],
  [2, 1, 3, 4],
]);

/**
 * 阵容 B：混合阵 —— 高费用核心 + 铺场。
 * 用来测试「不同费用混搭」和 AOE 技能。
 */
export const TEAM_ASSASSINS: TeamSetup = make(1, [
  [3, 1, 0, 2],
  [1, 2, 0, 0],
  [1, 2, 0, 4],
  [2, 1, 1, 1],
  [3, 1, 3, 2],
  [3, 1, 3, 4],
]);

/**
 * 把一支队伍的阵容镜像到对面。
 *
 * 【左右对峙，所以镜像就是「左右翻转」（换 col）】
 * 队伍 0 占列 0..ARENA_W-1，队伍 1 占列 ARENA_W..BOARD_W-1。
 * 公式：新列 = (BOARD_W - 1) - 旧列
 */
export function mirrorSetup(source: TeamSetup): TeamSetup {
  const targetTeam: 0 | 1 = source.team === 0 ? 1 : 0;
  return {
    team: targetTeam,
    units: source.units.map((unit) => ({ ...unit, cell: mirrorCell(unit.cell) })),
  };
}

/**
 * 镜像单个坐标（左右翻转）。
 *
 * 【为什么联机时必须用它？】
 * 玩家的准备界面永远是「自己视角」：自己在左半边，对手在右半边。
 * 所以客户端提交阵容时，棋子总是摆在它自己视角的左半边。
 *
 * 但服务端配对时，两个玩家一个演队伍 0（左）、一个演队伍 1（右）。
 * 如果直接把提交的坐标给队伍 1，就会出现「棋子摆到了对方半场」的报错。
 * 正确做法：给队伍 1 的那个人，把它的站位左右翻转一下。
 *
 * ⚠️ 分界线是「列」。棋盘朝向改过好几次，每次都要确认这里换的是列还是行。
 */
export function mirrorCell(cell: Cell): Cell {
  return { col: BOARD_W - 1 - cell.col, row: cell.row };
}

/** 批量镜像站位 */
export function mirrorPlacements(units: UnitPlacement[]): UnitPlacement[] {
  return units.map((unit) => ({ ...unit, cell: mirrorCell(unit.cell) }));
}

/** 所有合法格子，摆棋 / 随机阵容时用。顺序固定 => 确定性 */
export function allCells(team: 0 | 1): Cell[] {
  const cells: Cell[] = [];
  const startCol = team === 0 ? 0 : TEAM_1_MIN_COL;
  const endCol = team === 0 ? TEAM_0_MAX_COL : BOARD_W - 1;
  for (let row = 0; row < BOARD_H; row++) {
    for (let col = startCol; col <= endCol; col++) {
      cells.push({ col, row });
    }
  }
  return cells;
}

/**
 * 造一个「只有一枚棋子」的阵容，放在自己半场最前排的正中。
 *
 * 【为什么要有这个辅助函数？】
 * 因为测试里如果写死坐标，一改棋盘尺寸或朝向就会全部失效 ——
 * 而且报错信息是「放错半场了」，看不出真正原因是「测试用了旧坐标」。
 */
export function soloTeam(team: 0 | 1, defId: string, star = 1): TeamSetup {
  return {
    team,
    units: [
      {
        defId,
        star,
        cell: {
          col: team === 0 ? TEAM_0_MAX_COL : TEAM_1_MIN_COL,
          row: Math.floor(BOARD_H / 2),
        },
      },
    ],
  };
}

/** 用指定费用的单个干员造阵容（测试里最常用，因为它不依赖具体名字） */
export function soloTeamOfCost(team: 0 | 1, cost: number, star = 1): TeamSetup {
  return soloTeam(team, pickUnitOfCost(cost), star);
}

/**
 * 造一个由若干棋子组成的阵容，自动按顺序摆进自己半场。
 * 棋子数量超过半场格子数时会自动截断。
 */
export function lineup(team: 0 | 1, units: Array<{ defId: string; star?: number }>): TeamSetup {
  const cells = allCells(team);
  return {
    team,
    units: units.slice(0, cells.length).map((unit, index) => ({
      defId: unit.defId,
      star: unit.star ?? 1,
      cell: cells[index]!,
    })),
  };
}
