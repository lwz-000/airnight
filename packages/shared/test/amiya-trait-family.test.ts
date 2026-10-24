/**
 * ============================================================
 *  0.3.2：阿米娅家族**只算一个羁绊成员**
 * ============================================================
 *
 * 用户口径：「阿米娅，阿米娅的升变形态同时上场只能生效一个羁绊。」
 *
 * 【为什么必须钉死？】
 * 她们在数据上是 4 个不同的 defId（`op07` + 三个 `op_amiya_*`），
 * 而 `countTraits()` 原来是按 defId 数种类 ——
 * 四只阿米娅同时上场会让 `rhodes / leader / arts` 直接顶到 4 档。
 * 现在成员 key 走 `familyKeyOf()`，家族里所有形态塌成同一个 key。
 *
 * ★ 这里守的是**数人头**这一层；界面名单另有一份同样的口径（`traitOwnersOf`），
 *   两边都读 `familyKeyOf()`，所以「名单里几条 = 数出来几个」不会打架。
 */
import { describe, expect, it } from 'vitest';
import {
  AMIYA_BASE_ID,
  AMIYA_FORM_IDS,
  TRAIT_DEFS,
  UNIT_DEFS,
  activeTierIndexOf,
  buildTraitStatus,
  computeActiveTraitLevels,
  countTraits,
  familyKeyOf,
  type UnitPlacement,
} from '../src/index.js';

/** 摆一个棋子（羁绊只认"场上"，不看星级和序号） */
const at = (defId: string, col: number, row = 5): UnitPlacement => ({
  defId,
  star: 1,
  cell: { col, row },
});

const AMIYA_FAMILY = [
  AMIYA_BASE_ID,
  AMIYA_FORM_IDS.blue,
  AMIYA_FORM_IDS.mercy,
  AMIYA_FORM_IDS.core,
];

describe('★ 阿米娅家族：家族 key', () => {
  it('三个升变形态都归到本体名下', () => {
    expect(familyKeyOf(AMIYA_BASE_ID)).toBe(AMIYA_BASE_ID);
    expect(familyKeyOf(AMIYA_FORM_IDS.blue)).toBe(AMIYA_BASE_ID);
    expect(familyKeyOf(AMIYA_FORM_IDS.mercy)).toBe(AMIYA_BASE_ID);
    expect(familyKeyOf(AMIYA_FORM_IDS.core)).toBe(AMIYA_BASE_ID);
  });

  it('别人不受影响（家族 key 就是自己的 id）', () => {
    const others = Object.values(UNIT_DEFS).filter(
      (def) => !AMIYA_FAMILY.includes(def.id) && def.summonOnly !== true && def.monsterOnly !== true,
    );
    for (const def of others) expect(familyKeyOf(def.id)).toBe(def.id);
  });
});

describe('★ 阿米娅家族：数人头只算 1', () => {
  it('本体 + 三个形态同时上场，三个羁绊全都只算 1 个', () => {
    const counts = countTraits(AMIYA_FAMILY.map((id, i) => at(id, 2 + i)), UNIT_DEFS);
    for (const trait of ['rhodes', 'leader', 'arts']) {
      expect(counts.get(trait), `${trait} 应该只算 1 个`).toBe(1);
    }
  });

  it('只上两只（本体 + 一个形态）也只算 1', () => {
    const counts = countTraits([at(AMIYA_BASE_ID, 3), at(AMIYA_FORM_IDS.mercy, 4)], UNIT_DEFS);
    expect(counts.get('arts')).toBe(1);
  });

  it('两只同一个形态（理论上不该出现）同样只算 1', () => {
    const counts = countTraits([at(AMIYA_FORM_IDS.core, 3), at(AMIYA_FORM_IDS.core, 4)], UNIT_DEFS);
    expect(counts.get('arts')).toBe(1);
  });

  it('对照组：两个**不同**干员还是各算一个（规则没被改坏）', () => {
    // 挑两个"不是阿米娅家族、但同样带 arts"的棋子（塑心 / 妮芙 / 澄闪那一批）
    const others = Object.values(UNIT_DEFS)
      .filter(
        (def) =>
          !AMIYA_FAMILY.includes(def.id) &&
          def.traits.includes('arts') &&
          def.summonOnly !== true &&
          def.monsterOnly !== true,
      )
      .slice(0, 2);
    expect(others.length, '数据里应该有不止一个非阿米娅的 arts 干员').toBe(2);
    const counts = countTraits([at(AMIYA_BASE_ID, 3), at(others[0]!.id, 4)], UNIT_DEFS);
    expect(counts.get('arts')).toBe(2);
  });
});

describe('★ 阿米娅家族：面板档位不会因为多上形态而虚高', () => {
  it('四只阿米娅一起上场，arts 仍然只算 1 → 一档都不生效', () => {
    const placements = AMIYA_FAMILY.map((id, i) => at(id, 2 + i));
    const levels = computeActiveTraitLevels(placements, UNIT_DEFS);
    const arts = levels.find((level) => level.traitId === 'arts');
    expect(arts?.count).toBe(1);
    expect(arts?.tierIndex).toBe(activeTierIndexOf(TRAIT_DEFS['arts']!, 1));

    const status = buildTraitStatus(placements, UNIT_DEFS).find((row) => row.traitId === 'arts');
    // arts 的最低档是 2 种 —— 家族只算 1，所以不该生效
    expect(status?.count).toBe(1);
    expect(status?.activeAt).toBe(null);
  });
});
