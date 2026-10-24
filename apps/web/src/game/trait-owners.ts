/**
 * ============================================================
 *  羁绊详情：「哪些棋子带这个标签」—— 唯一实现
 * ============================================================
 *
 * 【为什么单独抽出来？】
 * 这张名单以前是在 `main.ts` 的 `openTraitDetail()` 里现算的：
 *   `Object.values(UNIT_DEFS).filter(u => u.traits.includes(traitId))`
 * —— 于是把两种"根本不算成员"的东西也列了进去：
 *
 *   ① **召唤物 / 野怪**：最典型的是「天师锦囊」召唤的【炎佑】，
 *      数据上挂着 `yan` 标签，但它**不参与羁绊构建**（用户口径 + 藏品描述里写着）。
 *      列在「大炎」的名单里，玩家会以为"再上一只炎佑就能凑档"。
 *   ② **阿米娅的升变形态**：本体 `op07` 与三个形态在数据上是 4 个 defId，
 *      名单里就出现 4 个"阿米娅"，而实际**只算一个羁绊成员**
 *      （用户口径：「升变形态同时上场只能生效一个羁绊」）。
 *
 * 【口径必须和数人头一致】
 * 名单里几条 = 羁绊数几个。数人头在 `synergies.ts` 的 `countTraits()`，
 * 它按 `familyKeyOf()` 归并家族；这里用的是**同一个函数**，
 * 所以不会出现"名单 4 条、实际算 1 个"这种对不上的情况。
 *
 * ★ 判据全部来自 `ascension.ts`（升变链的唯一出处），别在这里另写 id 比较。
 */

import {
  UNIT_DEFS,
  ascendRankOf,
  familyKeyOf,
  type UnitDef,
  type UnitDefTable,
} from '../../../../packages/shared/src/index.js';

export interface TraitOwner {
  def: UnitDef;
  /** 场上有没有这只棋子（按**家族**判：场上站的是慈悲愿景，阿米娅这一条也算在场上） */
  onField: boolean;
}

/**
 * 列出带某个标签的棋子（已按"先在场 / 再便宜 / 再名字"排好）。
 *
 * @param traitId     羁绊标签 id
 * @param onFieldDefIds 当前场上（或观战时对方场上）所有棋子的 defId
 */
export function traitOwnersOf(
  traitId: string,
  onFieldDefIds: readonly string[],
  defs: UnitDefTable = UNIT_DEFS,
): TraitOwner[] {
  const onFieldFamilies = new Set(
    onFieldDefIds.filter((id) => Boolean(id)).map((id) => familyKeyOf(id)),
  );

  /*
    一族只留"最基础"的那个（升变链起点 = `ascendRankOf() === 0`，也就是 op07「阿米娅」）：
    名单是在回答"**再上一个谁**就能到下一档"，而能买到的只有本体，
    升变是之后的事 —— 所以显示本体 + 本体费用才是对的。
  */
  const byFamily = new Map<string, UnitDef>();
  for (const def of Object.values(defs)) {
    if (!def.traits.includes(traitId)) continue;
    // ★ 召唤物 / 野怪不参与羁绊构建（`ascendOnly` 不能一起排掉：升变形态是真能上场的）
    if (def.summonOnly === true || def.monsterOnly === true) continue;
    const family = familyKeyOf(def.id);
    const prev = byFamily.get(family);
    if (!prev || ascendRankOf(def.id) < ascendRankOf(prev.id)) byFamily.set(family, def);
  }

  /*
    排序规则：先排"已经在场上的"。
    看羁绊详情时最关心「我还差几个才能升档」，而场上的干员才是真正计入数量的那些；
    其次是费用从低到高（便宜的容易凑）。
  */
  return [...byFamily.values()]
    .map((def) => ({ def, onField: onFieldFamilies.has(familyKeyOf(def.id)) }))
    .sort((a, b) => {
      const aOn = a.onField ? 0 : 1;
      const bOn = b.onField ? 0 : 1;
      return aOn - bOn || a.def.cost - b.def.cost || a.def.name.localeCompare(b.def.name);
    });
}
