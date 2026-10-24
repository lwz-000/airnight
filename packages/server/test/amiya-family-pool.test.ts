/**
 * ============================================================
 *  ★★ 0.3.2 服务端牌库：阿米娅升变之后，那几张牌**还回阿米娅名下**
 * ============================================================
 *
 * 【这一条为什么必须单独测？】
 * 升变发生在客户端（`equipItemToUnit` 换 defId），服务端直到下一次 `submitTeam`
 * 才知道"他手上现在写的是 `op_amiya_blue`"。而"还牌"是按**上报的 defId** 还的：
 *   · 改之前：`returnToPool('op_amiya_blue', 9)` 会给一个池子里**根本不存在**的 id
 *     加回份额，阿米娅那份永远不还 —— 剩下的人怎么刷都刷不到阿米娅，
 *     而且**不报任何错**（`poolTaken` 是个 Map，写什么 key 都"成功"）。
 *   · 改之后：`returnToPool` 先过 `familyKeyOf`，回到 `op07` 名下。
 *
 * 顺带钉住卖出那条路：客户端卖棋子时发过来的也是形态 id。
 */
import { describe, expect, it } from 'vitest';
import { Room } from '../src/room.js';
import { AMIYA_BASE_ID, AMIYA_FORM_IDS, copiesOf, poolSizeOf, type SubmittedTeam } from '../../shared/src/index.js';

const BASE = AMIYA_BASE_ID;
const BLUE = AMIYA_FORM_IDS.blue;

function makeRoom(): Room {
  const room = new Room('TESTAB', 'p1', '甲');
  room.addPlayer('p1', '甲');
  room.addPlayer('p2', '乙');
  return room;
}

/** 客户端上报的一份阵容（只写测试关心的字段） */
function submit(units: Array<{ defId: string; star: number; col?: number; row?: number }>): SubmittedTeam {
  return {
    units: units.map((unit, index) => ({
      defId: unit.defId,
      star: unit.star,
      cell: { col: unit.col ?? 0, row: unit.row ?? index },
    })),
    bench: [],
  };
}

describe('★★ 0.3.2 升变形态的牌库归属', () => {
  it('淘汰时 3 星形态的 9 张牌要还回**阿米娅**，不能凭空蒸发', () => {
    const room = makeRoom();
    const total = poolSizeOf(BASE);

    // 正常游戏里这 9 张是买的时候扣掉的；这里直接扣，等价
    expect(room.takeFromPool(BASE, copiesOf(3)).ok, '9 张应该拿得出来').toBe(true);
    expect(room.remainingOf(BASE)).toBe(total - copiesOf(3));

    // 客户端把它升变成了青色怒火，下一回合上报的就是形态 id
    room.submitTeam('p1', submit([{ defId: BLUE, star: 3 }]));
    const player = room.getPlayer('p1')!;
    player.hp = 0;
    room.returnCardsToPool(player);

    expect(room.remainingOf(BASE), '9 张必须全部回到阿米娅名下').toBe(total);
    expect(room.remainingOf(BLUE), '形态自己不在池子里，不能给它刷出一份额度').toBe(poolSizeOf(BLUE));
  });

  it('卖出形态：按上报的形态 id 还牌，同样回到阿米娅名下', () => {
    const room = makeRoom();
    const total = poolSizeOf(BASE);

    expect(room.takeFromPool(BASE, 1).ok).toBe(true);
    const before = room.remainingOf(BASE);
    // 卖一只 1 星（还 1 张）—— 客户端发的是形态 id
    room.returnToPool(BLUE, copiesOf(1));
    expect(room.remainingOf(BASE)).toBe(before + copiesOf(1));
    expect(room.remainingOf(BASE)).toBe(total);
  });

  it('★ 不会还过头：形态还牌不会把阿米娅的剩余数顶到超过总数', () => {
    const room = makeRoom();
    const total = poolSizeOf(BASE);
    room.returnToPool(BLUE, 99);
    expect(room.remainingOf(BASE)).toBe(total);
  });
});
