import { TRAIT_DEFS } from './unit-data.js';
import { familyKeyOf } from './ascension.js';
import type {
  ActiveTraitLevel,
  ScopedMechanic,
  TraitBonus,
  TraitDef,
  TraitDefTable,
  TraitEffectType,
  TraitScope,
  TraitStatus,
  UnitDef,
  UnitPlacement,
  UnitDefTable,
} from './types.js';

/**
 * ============================================================
 *  羁绊系统（种族 / 职业）
 * ============================================================
 *
 * 【这个文件做三件事】
 *   1. 定义羁绊表（TRAIT_DEFS）—— 这是你以后要填的「策划表格之一」
 *   2. 统计场上每个标签有几个棋子
 *   3. 算出该给每个棋子加什么属性
 *
 * 【设计原则：羁绊不进入战斗循环】
 * 战斗中每一 tick 都要检查「这个棋子是不是该多 20% 攻速」会非常慢、
 * 而且会把战斗逻辑搞得很脏。
 * 正确做法是：**开战前一次性把加成算进棋子属性**，战斗循环完全不知道有羁绊。
 * 好处：
 *   · rules.ts 一行都不用改（已经验证过）
 *   · 联机时加成跟着阵容一起广播，客户端不用重算，天然不会算错
 *   · 想知道「到底吃到了什么加成」，直接看数据即可
 *
 * 代价：羁绊只能做成「属性加成」，做不了「战斗中触发的特殊机制」
 * （比如死亡时爆炸、开局召唤随从）。那些需要给战斗循环加钩子，
 * 属于下一步，等你的设计里出现这类羁绊时再做。
 */

const ms = (seconds: number): number => Math.round(seconds * 20);

/**
 * 羁绊表住在 unit-data.ts 里（和干员表放在一起，方便你一次改完）。
 * 这里重新导出，方便调用方只 import 一个地方。
 */
export { TRAIT_DEFS };

/** 效果类型的中文名，用于界面显示 */
export const TRAIT_EFFECT_LABEL: Record<TraitEffectType, string> = {
  attackDamageBp: '攻击力',
  attackSpeedBp: '攻速',
  hpBp: '血量上限',
  armorFlat: '护甲',
  magicResistFlat: '魔抗',
  manaGainBp: '法力回复',
  goldPerRound: '每回合金币',
  armorBp: '护甲',
  magicResistBp: '魔抗',
  rangeFlat: '攻击距离',
  healingBp: '治疗效果',
  allStatsBp: '全部属性',
};

/**
 * 把一个羁绊效果渲染成「攻击力 +25%」这样的人话。
 *
 * 【为什么必须在共享层，不能各写一份？】
 * 因为这个函数要处理三种**单位完全不同**的数值：
 *   万分比（attackDamageBp 2500 = +25%）
 *   绝对值（armorFlat 30 = +30 护甲）
 *   纯个数（goldPerRound 2 = 每回合 +2 金）
 * 每多一处自己实现的格式化，就多一次"忘了处理第三种单位"的机会 ——
 * 之前「奸商」就显示成过「每回合金币 +0%」（2 被当成万分比除了两次）。
 * 现在只有这一个实现，界面和调试输出都用它。
 */
export function formatTraitEffect(effect: { type: TraitEffectType; value: number }): string {
  const label = TRAIT_EFFECT_LABEL[effect.type] ?? effect.type;
  /*
    【三种单位，不能混】
      绝对值：护甲 / 魔抗 / **攻击距离**  -> 直接显示数字
      纯个数：每回合金币                -> 直接显示数字
      百分比：其余全部                   -> value/100 再加 %
    曾经把"攻击距离 +2 格"当成百分比渲染成"+0%"，
    所以现在把绝对值列成一个显式的清单，加新类型时会想起来这里也要改。
  */
  const isAbsolute =
    effect.type === 'armorFlat' ||
    effect.type === 'magicResistFlat' ||
    effect.type === 'rangeFlat' ||
    effect.type === 'goldPerRound';
  if (isAbsolute) return `${label} +${effect.value}`;
  return `${label} +${(effect.value / 100).toFixed(0)}%`;
}

/** 把一组效果渲染成「攻击力 +25%、攻速 +10%」 */
export function formatTraitEffects(effects: Array<{ type: TraitEffectType; value: number }>): string {
  return effects.map((effect) => formatTraitEffect(effect)).join('、');
}

/**
 * 羁绊计数要不要把"同一个干员的多个复制体"算成多个？
 *
 * 【★ 你的设计：不算（false）】
 * 你明确说过两次：「上场相同的角色不会重复触发羁绊（包括星级不一样的）」。
 * 也就是说羁绊看的是**阵容里有多少种不同的干员**，而不是上了几个棋子：
 *   · 场上 2 个拉普兰德  -> 剑士只算 **1**
 *   · 一个 1 星拉普兰德 + 一个 2 星拉普兰德 -> 剑士还是只算 **1**
 *
 * 【这条会明显影响玩法，所以做成了一个开关】
 * 它意味着"堆同一个干员"对凑羁绊完全没有帮助 —— 你要凑剑士 3 档，
 * 就必须上 3 个**不同**的剑士。好处是逼着玩家去凑多样化的阵容；
 * 代价是"复制同一个强力干员"这条路被堵死了。
 *
 * 想改回"每个棋子算一个"（多数自走棋的做法）时，
 * 把这里改成 true 就行 —— 只有这一处判断。
 */
export const COUNT_DUPLICATE_OPERATORS = false;

/**
 * ★ 0.1.3：这枚棋子**实际**具有的羁绊标签 = 自身标签 + 转职藏品给的额外标签。
 *
 * 【为什么收成一个函数？】
 * "谁算这个羁绊的成员"在四处被判过：数人头、发成员加成、发成员机制、算每回合经济。
 * 以前四处各写一遍 `new Set(def.traits).has(...)` —— 加转职时漏掉任何一处，
 * 结果就是"面板显示生效了、实际一点没给"（或者反过来），
 * 而这种 bug 玩家只能说"怎么感觉没生效"。所以统一走这里。
 */
export function traitsOfPlacement(placement: UnitPlacement, def: UnitDef | undefined): string[] {
  const own = def?.traits ?? [];
  const extra = placement.extraTraits;
  if (!extra || extra.length === 0) return own;
  return [...new Set([...own, ...extra])];
}

/**
 * 统计一支队伍里每个标签出现了几次。
 *
 * 【★ 默认按"不同干员种类"计，不按"棋子个数"计】
 * 见上面 COUNT_DUPLICATE_OPERATORS 的说明 —— 这是你定的规则。
 *
 * 【为什么"棋子自己身上重复的标签"要去重？】
 * 写数据时手滑把同一个标签写两遍（`traits: ['yan', 'yan']`）不该让它算两个。
 * 所以每个棋子的标签先用 Set 去重。
 *
 * 【★★ 0.3.2 用户口径：阿米娅家族只算**一个**成员】
 * 「阿米娅 + 她的升变形态同时上场，只能生效一个羁绊。」
 * 她们在数据上是 4 个不同的 defId（`op07` / 三个 `op_amiya_*`），
 * 按 defId 数就会变成"上 4 只阿米娅直接把羁绊顶到 4 档"。
 * 所以成员 key 走 `familyKeyOf()`（升变链的**唯一判据**，在 ascension.ts）——
 * 家族里所有形态塌成同一个 key，数出来永远是 1。
 * ★ 别在别处再写一遍 `id === 'op_amiya_*'`：牌库/合成/卖出/任务统计都读这一个函数。
 */
export function countTraits(placements: UnitPlacement[], defs: UnitDefTable): Map<string, number> {
  const counts = new Map<string, number>();
  /*
    先按"标签 -> 成员集合"收集，最后取集合大小。
    ★ 两个模式共用一个循环，**只有成员 key 的取法不同** ——
      免得出现"改了这个模式、另一个模式忘了改"（本项目最典型的漏改）。
    成员的取法：
      · 默认（false）：`familyKeyOf(defId)` —— 同一只棋子的不同形态算一个；
      · 重复模式（true）：`defId@格子` —— 每枚棋子算一个（同一只买两张算两个）。
    ★ 当前开关是 false。真要翻成 true 时，家族那一条也要跟着塌（改这一行即可）。
  */
  const members = new Map<string, Set<string>>();
  for (const placement of placements) {
    const def = defs[placement.defId];
    if (!def) continue;
    const key = COUNT_DUPLICATE_OPERATORS
      ? `${placement.defId}@${placement.cell.col},${placement.cell.row}`
      : familyKeyOf(placement.defId);
    for (const trait of traitsOfPlacement(placement, def)) {
      let set = members.get(trait);
      if (!set) {
        set = new Set();
        members.set(trait, set);
      }
      set.add(key);
    }
  }
  for (const [trait, set] of members) counts.set(trait, set.size);
  return counts;
}

/**
 * 找出某个标签当前生效的档位。
 *
 * 规则：取**满足条件里最高的那一档**。
 * 例如暗夜有 3 档（2/4/6），场上有 5 个暗夜棋子 -> 生效的是 4 那一档。
 * 另外注意：只统计「羁绊表里登记过的标签」，
 * 棋子身上写了但表里没有的标签会被忽略（校验器会另外提醒你）。
 */
export function activeTierOf(traitId: string, count: number): { index: number; tier: NonNullable<TraitDef['tiers'][number]> } | null {
  const def = TRAIT_DEFS[traitId];
  if (!def) return null;

  let bestIndex = -1;
  for (let i = 0; i < def.tiers.length; i++) {
    if (count >= def.tiers[i]!.count) bestIndex = i;
  }
  if (bestIndex < 0) return null;
  return { index: bestIndex, tier: def.tiers[bestIndex]! };
}

/**
 * 算出一支队伍吃到的**全队型**羁绊加成（`scope: 'team'`）。
 *
 * 【为什么返回的是一个扁平列表，而不是「按标签分组」？】
 * 因为应用加成的时候只关心「这个棋子该加什么」，
 * 不关心这些加成来自哪个标签。扁平列表用起来最简单。
 * 而界面要按标签展示时，用 buildTraitStatus() 拿结构化信息。
 *
 * 【注意：这里只处理 scope: 'team' 的羁绊】
 * 「只给自己人」的羁绊（绝大多数）由 computeUnitTraitBonuses() 单独算，
 * 否则会把「剑士 +30% 攻击」加到法师身上。
 */
export function computeTraitBonuses(
  placements: UnitPlacement[],
  defs: UnitDefTable,
  traitDefs: TraitDefTable = TRAIT_DEFS,
): TraitBonus[] {
  const levels = computeActiveTraitLevels(placements, defs, traitDefs);
  const bonuses: TraitBonus[] = [];

  for (const level of levels) {
    if (level.tierIndex < 0) continue;
    const def = traitDefs[level.traitId];
    if (!def) continue;
    const tier = def.tiers[level.tierIndex]!;

    for (const effect of tier.effects) {
      if (scopeOfItem(effect, def) !== 'team') continue;
      bonuses.push({
        traitId: level.traitId,
        effect: effect.type,
        value: effect.value,
        // ★ 0.3.31：把范围一起带出去 —— 治疗量提升要分"打出去"还是"吃进来"（见 rules.ts）
        scope: 'team',
      });
    }
  }

  return bonuses;
}

/**
 * 算出一支队伍里**每个棋子各自**吃到的羁绊加成（`scope: 'members'`）。
 *
 * 返回 `defId -> 加成列表`。没吃到任何加成的棋子不会出现在结果里。
 *
 * 【为什么单独一个函数？】
 * 因为「谁受益」是羁绊最核心的语义之一。
 * 把它和全队加成混在一起，就会出现「法师吃到剑士羁绊」这种错。
 * 拆开之后，两种羁绊各走各的路径，一眼能看出区别。
 *
 * 【★ 同一个干员上场多个（含不同星级）只算一次】
 * 加成是"给**这种棋子**"的，不是"给这个棋子实例"的。
 * 曾经这里直接遍历 placements、每个都往同一个 defId 里 push 一遍，
 * 于是场上有 3 个同样的剑士时，那份 +18% 攻击会被加 **3 次** ——
 * 实测攻击力 620 → 1018（本该 731）。
 * 现在先用 Set 去重，再按 defId 排序输出（保证确定性）。
 */
export function computeUnitTraitBonuses(
  placements: UnitPlacement[],
  defs: UnitDefTable,
  traitDefs: TraitDefTable = TRAIT_DEFS,
): Record<string, TraitBonus[]> {
  const levels = computeActiveTraitLevels(placements, defs, traitDefs);
  const out: Record<string, TraitBonus[]> = {};

  // 场上的所有 defId（去重）—— 单条效果写 scope:'team' 时要发给每个人
  const teamTargets = new Set<string>();
  for (const placement of placements) {
    if (defs[placement.defId]) teamTargets.add(placement.defId);
  }

  for (const level of levels) {
    if (level.tierIndex < 0) continue;
    const def = traitDefs[level.traitId];
    if (!def) continue;
    const tier = def.tiers[level.tierIndex]!;

    // 只有"带这个标签的棋子"才吃到加成（单条效果可以覆盖成全队）
    const members = new Set<string>();
    for (const placement of placements) {
      const unitDef = defs[placement.defId];
      if (!unitDef) continue;
      if (!traitsOfPlacement(placement, unitDef).includes(level.traitId)) continue;
      members.add(placement.defId);
    }

    for (const effect of tier.effects) {
      /*
        【★ 全队型的效果必须**只由 computeTraitBonuses 返回一次**】
        两个函数的结果最终会拼在一起套到棋子上：
            bonuses = [...traitBonuses, ...unitTraitBonuses[defId]]
        所以如果这里也把 scope:'team' 的效果算进去，它就会被加**两遍**。
        这里只负责"本人型"，全队型交给 computeTraitBonuses —— 严格分工，不会重复。
      */
      if (scopeOfItem(effect, def) === 'team') continue;
      for (const defId of [...members].sort()) {
        (out[defId] ??= []).push({
          traitId: level.traitId,
          effect: effect.type,
          value: effect.value,
          // ★ 0.3.31：同源，见上面 team 那条
          scope: 'members',
        });
      }
    }
  }

  return out;
}

/** 取羁绊的作用范围，没写就是 'members'（绝大多数羁绊都该是默认值） */
export function scopeOf(def: TraitDef): TraitScope {
  return def.scope ?? 'members';
}

/** 取一条效果/机制的作用范围：自己写了就用自己写的，否则跟随羁绊 */
export function scopeOfItem(item: { scope?: TraitScope }, traitDef: TraitDef): TraitScope {
  return item.scope ?? scopeOf(traitDef);
}

/**
 * 算出每个羁绊**生效到第几档**。
 *
 * 【为什么要单独一步？】
 * 属性加成可以摊平成一个列表，但羁绊的**战斗中机制**不行 ——
 * 「炮手 +2 射程并对周围 3×3 溅射 15%/20%/40%」这种东西
 * 必须知道"是炮手、生效在第二档"才能解析出来。
 * 所以先把"哪个羁绊生效到第几档"算清楚，再加成和机制都从它推。
 *
 * 【soloRequires 在这里就筛掉】
 * 领导人写的触发条件是「我方只有一个领导人干员时触发（2、3 个人时不触发）」。
 * 这不是"给多少数值"的问题，而是**这一档到底生不生效**的问题，
 * 所以必须在算档位这一步判掉 —— 放到后面就来不及了。
 */
/**
 * 这个羁绊在**当前数量**下生效到第几档（-1 = 一档都没生效）。
 *
 * ============================================================
 *  【为什么必须只留这一处实现？】
 * ============================================================
 * 它同时决定两件事，而这两件事**必须永远一致**：
 *   · 开战时到底给不给加成（`computeActiveTraitLevels`）；
 *   · 界面上那一行写"已生效"还是"未生效"（`buildTraitStatus`）。
 *
 * 以前这两处**各写了一遍**，而「恰好 N 名才生效」（领导人）这条条件
 * 只在开战那份里判了 —— 于是上 2 个领导人时：
 *   开战：tierIndex = -1，一点加成都没有；
 *   界面：activeAt = 1，边框高亮成"已生效"、还标成满级金色。
 * 玩家看到的是"显示生效、实际没用"，而且完全无从判断哪里出了问题。
 *
 * 所以判档这件事收敛到这一个函数：**加新羁绊条件时只改这里**，
 * 两个口径自然同步。
 */
export function activeTierIndexOf(def: TraitDef, count: number): number {
  let activeIndex = -1;
  for (let i = 0; i < def.tiers.length; i++) {
    const tier = def.tiers[i]!;
    if (count < tier.count) continue;
    // 「恰好 N 个才生效」（领导人）：数量对不上就整档跳过
    const solo = tier.mechanics?.find((mechanic) => mechanic.kind === 'soloRequires');
    if (solo && solo.kind === 'soloRequires' && count !== solo.exactly) continue;
    activeIndex = i;
  }
  return activeIndex;
}

/**
 * 这个羁绊有没有「恰好 N 名才生效」的条件，以及当前**满没满足**。
 *
 * 【为什么单独给界面用？】因为"数量够了却因为条件不满足而失效"这件事
 * 光看 `count / tier.count` 是看不出来的 —— 面板上会变成 "2/1" 这种没法理解的数。
 * 界面拿到它才能写人话：「已失效：必须恰好 1 名（当前 2 名）」。
 */
export function soloConditionOf(def: TraitDef, count: number): { exactly: number; ok: boolean } | null {
  for (const tier of def.tiers) {
    const solo = tier.mechanics?.find((mechanic) => mechanic.kind === 'soloRequires');
    if (solo && solo.kind === 'soloRequires') return { exactly: solo.exactly, ok: count === solo.exactly };
  }
  return null;
}

export function computeActiveTraitLevels(
  placements: UnitPlacement[],
  defs: UnitDefTable,
  traitDefs: TraitDefTable = TRAIT_DEFS,
): ActiveTraitLevel[] {
  const counts = countTraits(placements, defs);
  const out: ActiveTraitLevel[] = [];

  // 固定遍历顺序（按标签 id 排序）=> 确定性
  for (const traitId of [...counts.keys()].sort()) {
    const def = traitDefs[traitId];
    if (!def) continue;
    const count = counts.get(traitId)!;
    // 判档只有一处实现（见 activeTierIndexOf 的说明）
    out.push({ traitId, count, tierIndex: activeTierIndexOf(def, count) });
  }

  return out;
}

/** 某档的机制列表（没有就返回空数组） */
function mechanicsOfTier(tier: TraitDef['tiers'][number] | null): ScopedMechanic[] {
  if (!tier) return [];
  return (tier.mechanics ?? []) as ScopedMechanic[];
}

/**
 * 把一支队伍的羁绊机制解析成"每个棋子身上有什么"。
 *
 * 返回值 `defId -> 机制列表`。数值都已经按档位填好了，
 * 战斗循环直接用，不需要回查羁绊表。
 *
 * 【规则】
 *   · 成员型（默认）：只有带这个标签的棋子拿到
 *   · 全队型（scope: 'team'）：所有人都拿
 *   · 单条机制可以自己写 scope 覆盖（重装的"护甲总和分给全队"就是这样）
 */
export function resolveUnitMechanics(
  placements: UnitPlacement[],
  defs: UnitDefTable,
  traitDefs: TraitDefTable = TRAIT_DEFS,
): Record<string, ScopedMechanic[]> {
  const levels = computeActiveTraitLevels(placements, defs, traitDefs);
  const counts = countTraits(placements, defs);
  const out: Record<string, ScopedMechanic[]> = {};

  // 场上出现过的 defId（去重）—— 全队型机制要发给每个人
  const allDefIds = [...new Set(placements.map((placement) => placement.defId))].sort();

  /*
    ★ 0.2：`TraitDef.innate` —— 只要带这个标签就生效，**不要求凑够档位**。
    （术士的"即使不激活术士羁绊，普攻也造成 100% 法术伤害"。）
    先铺 innate，再铺各档位的机制 —— 这样同一个 kind 同时存在时，
    后者（档位给的、数值更高的那份）在后面，`resolve` 端取最大值即可。
  */
  for (const def of Object.values(traitDefs)) {
    if (!def.innate || def.innate.length === 0) continue;
    const members = new Set<string>();
    for (const placement of placements) {
      const unitDef = defs[placement.defId];
      if (!unitDef) continue;
      if (!traitsOfPlacement(placement, unitDef).includes(def.id)) continue;
      members.add(placement.defId);
    }
    for (const defId of [...members].sort()) {
      for (const mechanic of def.innate) {
        (out[defId] ??= []).push({ ...mechanic, traitId: def.id });
      }
    }
  }

  for (const level of levels) {
    if (level.tierIndex < 0) continue;
    const def = traitDefs[level.traitId];
    if (!def) continue;
    const tier = def.tiers[level.tierIndex]!;
    const mechanics = mechanicsOfTier(tier);

    for (const mechanic of mechanics) {
      // soloRequires 是"条件"，已经在算档位时用掉了，不用挂到棋子上
      if (mechanic.kind === 'soloRequires') continue;
      /*
        填上"这条机制是哪个羁绊给的"。
        战斗循环里的机制是拍平的，但界面上的羁绊日志要按羁绊分组
        （"拉特兰：12/30 次"），所以这里顺手标一下 —— 数据表里不用写。
      */
      const tagged: ScopedMechanic = { ...mechanic, traitId: level.traitId };

      const scope = scopeOfItem(mechanic, def);
      if (scope === 'team') {
        for (const defId of allDefIds) {
          (out[defId] ??= []).push(tagged);
        }
        continue;
      }

      // 成员型：只给带这个标签的棋子
      const members = new Set<string>();
      for (const placement of placements) {
        const unitDef = defs[placement.defId];
        if (!unitDef) continue;
        if (!traitsOfPlacement(placement, unitDef).includes(level.traitId)) continue;
        members.add(placement.defId);
      }
      for (const defId of [...members].sort()) {
        (out[defId] ??= []).push(tagged);
      }
    }
  }

  void counts;
  return out;
}

/**
 * 把加成套用到一枚棋子的属性上。
 *
 * 【执行顺序很重要，这里说明清楚】
 *   1. 先算基础值 × 星级倍率
 *   2. 再加羁绊加成
 * 也就是说羁绊加成是「加法」而不是「乘法」。
 *
 * 为什么不乘算？因为加法更好预测、更好平衡：
 * 三档 +50% 攻击力就是 +50%，不会因为叠了别的加成而爆炸。
 * 而且加法在整数运算下永远精确，乘算的多次取整会累积误差。
 *
 * 血量加成同时提升「当前血量」和「上限」——
 * 这是自走棋的通用做法（不然羁绊只是上限好看，实际还是要慢慢回）。
 */
export function applyTraitBonuses(
  base: {
    hp: number;
    maxHp: number;
    attackDamage: number;
    attackSpeed: number;
    armor: number;
    magicResist: number;
    manaPerAttack: number;
    range: number;
  },
  bonuses: TraitBonus[],
): void {
  for (const bonus of bonuses) {
    switch (bonus.effect) {
      case 'hpBp': {
        const extra = Math.floor((base.maxHp * bonus.value) / 10000);
        base.maxHp += extra;
        base.hp += extra;
        break;
      }
      case 'attackDamageBp':
        base.attackDamage += Math.floor((base.attackDamage * bonus.value) / 10000);
        break;
      case 'attackSpeedBp':
        base.attackSpeed += Math.floor((base.attackSpeed * bonus.value) / 10000);
        break;
      case 'armorFlat':
        base.armor += bonus.value * 1000; // 护甲内部单位是 FIX（千分之一）
        break;
      case 'magicResistFlat':
        base.magicResist += bonus.value * 1000;
        break;
      case 'manaGainBp':
        base.manaPerAttack += Math.floor((base.manaPerAttack * bonus.value) / 10000);
        break;
      /*
        下面这几个是"你给的 16 个羁绊"里新用到的：

        【为什么护甲要有"百分比"版本？】
        因为你的设计里同时出现了两种写法：
          · 「+20 魔抗」（卡西米尔）-> 绝对值，armorFlat/magicResistFlat
          · 「提升 50% 防御力」（重装）-> 百分比，armorBp/magicResistBp
        两种语义完全不同：百分比是"越肉越肉"（对高护甲单位收益巨大），
        绝对值是"大家加一样多"。硬用其中一种去凑另一种会算错平衡。

        【为什么距离用绝对值？】
        「+2 格攻击范围」就是加 2 格，没有"百分比距离"这种说法。
      */
      case 'armorBp':
        base.armor += Math.floor((base.armor * bonus.value) / 10000);
        break;
      case 'magicResistBp':
        base.magicResist += Math.floor((base.magicResist * bonus.value) / 10000);
        break;
      case 'rangeFlat':
        base.range += bonus.value;
        break;
      case 'allStatsBp': {
        // 全部属性一起提升（龙）。注意顺序：先算当前值再加，避免"边加边算"。
        base.attackDamage += Math.floor((base.attackDamage * bonus.value) / 10000);
        base.attackSpeed += Math.floor((base.attackSpeed * bonus.value) / 10000);
        base.armor += Math.floor((base.armor * bonus.value) / 10000);
        base.magicResist += Math.floor((base.magicResist * bonus.value) / 10000);
        const extra = Math.floor((base.maxHp * bonus.value) / 10000);
        base.maxHp += extra;
        base.hp += extra;
        break;
      }
      case 'healingBp':
      case 'goldPerRound':
        // 这两种**不影响棋子属性**：
        //   goldPerRound  走经济那条路（economy.ts）
        //   healingBp     在治疗结算时用（combat-math.ts 的 healUnit）
        // 这里显式写空分支（而不是靠 default 忽略）是故意的：
        // 以后再加新效果类型时，TypeScript 会因为"这个 case 没覆盖"而报错，
        // 逼着我想清楚"这个新效果该不该影响战斗属性"。
        break;
    }
  }
}

/**
 * 生成界面用的羁绊面板数据。
 *
 * 这是「备战阶段最该看见的信息」：
 * 我现在凑出了哪几个羁绊、还差几个能升到下一档。
 * 自走棋的乐趣一半来自这个面板。
 */
export function buildTraitStatus(
  placements: UnitPlacement[],
  defs: UnitDefTable,
  traitDefs: TraitDefTable = TRAIT_DEFS,
): TraitStatus[] {
  const counts = countTraits(placements, defs);
  const out: TraitStatus[] = [];

  for (const traitId of [...counts.keys()].sort()) {
    const def = traitDefs[traitId];
    if (!def) continue;
    const count = counts.get(traitId)!;

    /*
      ★ 0.1.4：判档走**和开战同一个函数**。
      这里原来自己写了一遍"数量够就生效"，漏掉了「恰好 N 名才生效」（领导人）——
      于是上 2 个领导人时面板显示"已生效/满级"，实际一点加成都没有。
    */
    const activeIndex = activeTierIndexOf(def, count);
    /*
      ★ 0.1.4：「恰好 N 名才生效」的条件（领导人）。
      界面必须拿得到它 —— 否则"数量明明够了却没生效"在面板上只会显示成
      "2/1" 这种看不懂的数，玩家根本猜不到是"上多了"导致的。
    */
    const solo = soloConditionOf(def, count);

    // 下一档：第一个「还没满足」的档位
    let nextIndex = -1;
    for (let i = 0; i < def.tiers.length; i++) {
      if (count < def.tiers[i]!.count) {
        nextIndex = i;
        break;
      }
    }

    out.push({
      traitId,
      name: def.name,
      kind: def.kind,
      count,
      activeAt: activeIndex >= 0 ? def.tiers[activeIndex]!.count : null,
      nextAt: nextIndex >= 0 ? def.tiers[nextIndex]!.count : null,
      activeDesc: activeIndex >= 0 ? def.tiers[activeIndex]!.desc : null,
      ...(solo ? { solo } : {}),
    });
  }

  // 排序：已生效的排前面（按档位从高到低），然后是快凑齐的
  // 这样玩家一眼看到「我现在有什么」和「我再上一个棋子能多什么」
  out.sort((a, b) => {
    const aActive = a.activeAt !== null ? 1 : 0;
    const bActive = b.activeAt !== null ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    if (aActive === 1 && bActive === 1) {
      const aProgress = a.activeAt! / Math.max(1, a.nextAt ?? a.activeAt!);
      const bProgress = b.activeAt! / Math.max(1, b.nextAt ?? b.activeAt!);
      if (aProgress !== bProgress) return bProgress - aProgress;
    }
    return b.count - a.count || a.traitId.localeCompare(b.traitId);
  });

  return out;
}

/**
 * 把羁绊加成渲染成一行行可读文字。调试和测试用。
 *
 * 注意这里有个细节：不同的效果单位不一样（万分比 vs 绝对值），
 * 所以显示时要分开处理，不能统一除以 100。
 */
export function describeBonuses(bonuses: TraitBonus[]): string[] {
  const perEffect = new Map<TraitEffectType, number>();
  for (const bonus of bonuses) {
    perEffect.set(bonus.effect, (perEffect.get(bonus.effect) ?? 0) + bonus.value);
  }

  const lines: string[] = [];
  // 排序保证输出稳定，方便测试比对
  const effects = [...perEffect.keys()].sort() as TraitEffectType[];
  for (const effect of effects) {
    lines.push(formatTraitEffect({ type: effect, value: perEffect.get(effect)! }));
  }
  return lines;
}

export { ms };
