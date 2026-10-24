import { TICKS_PER_SECOND } from './constants.js';
import { growthLayers, summonStatBpActive, summonStatsAtRound } from './item-effects.js';
import { scaleStats } from './mods.js';
import type { HealSpec, ItemDef, ScopedMechanic, SkillStats } from './types.js';

/**
 * 治疗基准的中文名。
 * ★ 和 `scripts/export-operator-table.ts` 的 `BASIS_LABEL` 保持同一口径
 *   （那边是给策划表用的，这边是给游戏界面用的，措辞必须一致）。
 */
const HEAL_BASIS_LABEL: Record<HealSpec['basis'], string> = {
  attack: '攻击力',
  casterMaxHp: '最大生命',
  targetMaxHp: '目标生命上限',
  // ★ 0.2：赤刃明霄陈那条"缓慢恢复已损失生命值"用的口径
  missingHp: '已损失生命',
};

/**
 * ============================================================
 *  藏品（装备）效果 → 人话
 * ============================================================
 *
 * 【为什么单独一个文件，而不是写在界面代码里？】
 * 因为「这件藏品到底干什么」这段文字有**两个**消费方：
 *   1. 游戏界面 —— 藏品格子的 tooltip、干员详情页里那两件装备的说明；
 *   2. `scripts/export-value-sheet.ts` —— 导出「藏品」那张 Excel 工作表。
 * 两边各写一份的话，改一件藏品就要记得改两处，
 * 而且迟早会出现"表格里写的是 +20%、游戏里 hover 出来是 +10%"这种对不上的情况。
 *
 * 【和 battle-log-format.ts 的分工】
 * 那个负责「战斗日志」的文字化，这个负责「藏品数值」的文字化。
 * 两个都是"给人看的"，都不参与任何判定 —— 所以放在同一个包里、
 * 谁都能 import（内核不读它，界面和脚本读它）。
 *
 * 【这个文件里没有任何 Math.random / 排序依赖】
 * 它只做字符串拼接，所以放进这个包不会破坏确定性约束。
 *
 * 说明：这里的渲染是"尽量说全"，所以一屏能放下多少就不管了 ——
 * 窄小的界面由调用方决定截断到第几条。
 */

/** 万分比 -> 百分比字符串（内部数值一律是万分比，见 constants.ts 的 BP） */
export function percentText(bp: number): string {
  return `${bp / 100}%`;
}

/** 羁绊/装备属性加成 -> 可读文字（按字段名分派） */
export const ITEM_EFFECT_LABEL: Record<string, (v: number) => string> = {
  attackDamageBp: (v) => `攻击力 +${percentText(v)}`,
  attackSpeedBp: (v) => `攻速 +${percentText(v)}`,
  hpBp: (v) => `生命上限 +${percentText(v)}`,
  hpFlat: (v) => `生命上限 +${v}`,
  armorFlat: (v) => `护甲 +${v}`,
  magicResistFlat: (v) => `魔抗 +${v}`,
  armorBp: (v) => `护甲 +${percentText(v)}`,
  magicResistBp: (v) => `魔抗 +${percentText(v)}`,
  rangeFlat: (v) => `攻击距离 +${v} 格`,
  lifestealBp: (v) => `吸血 ${percentText(v)}`,
  healingBp: (v) => `治疗效果 +${percentText(v)}`,
  allStatsBp: (v) => `全属性 +${percentText(v)}`,
  manaGainBp: (v) => `法力回复 +${percentText(v)}`,
  goldPerRound: (v) => `每回合 +${v} 金`,
  // ---- 0.1.1 藏品二版 ----
  evasionBp: (v) => `闪避 ${percentText(v)}（物理与法术）`,
  evasionPhysicalBp: (v) => `物理闪避 ${percentText(v)}`,
  evasionMagicBp: (v) => `法术闪避 ${percentText(v)}`,
  initialManaBp: (v) => `开局能量为最大值的 ${percentText(v)}`,
};

/** 战斗机制 kind -> 中文标签 */
export const ITEM_MECH_LABEL: Record<string, string> = {
  onHitDamage: '攻击附带伤害',
  splash: '攻击溅射',
  execute: '残血斩杀',
  extraTargets: '额外攻击目标',
  attackCounterSpeed: '攻击计数叠攻速',
  rampSpeed: '连续攻击叠攻速',
  attackCountNuke: '累计攻击后全体打击',
  lowHpSurge: '残血爆发攻速',
  startShield: '开局护盾',
  highestHpCarrier: '最高血量者获得加成',
  auraFromSum: '护甲/魔抗总和共享全队',
  soloRequires: '仅单个时生效',
  allStatsByTriple: '按三星数量提升全属性',
  goldPerSurvivor: '按存活数给金币',
  airborne: '飞行（免疫近战）',
  // ---- 0.0.3 藏品新增 ----
  everyNthAttack: '每 N 击强化下一击',
  farAttackReduction: '被远程攻击时减伤',
  damageReduction: '受到伤害降低（全队）',
  teamRegen: '周期回复全队生命（全队）',
  goldOnKill: '击杀掉落金币',
  goldOnDeath: '阵亡掉落金币',
  onCastBuff: '开技能时获得增益',
  startEnemyShred: '开局削敌方双抗（全队）',
  startTeamImmunity: '开局全队免疫（全队）',
  // ---- 0.1.1 藏品二版 ----
  lowHpShield: '残血一次性护盾',
  lowHpAttack: '血量越低攻击力越高',
  lowHpSpeed: '血量越低攻速越快',
  lowHpManaRegen: '血量越低回蓝越快',
  distanceBonus: '按距离增伤',
  startSurroundAttack: '开局按周围干员数加攻击力',
  startRandomAllyBuff: '开局随机强化一名干员（全队）',
  onCastRamp: '每次开技能永久叠攻击力',
  goldThresholdNuke: '金币达标后周期性全场打击',
  teamHealingBp: '全队受到的治疗提升',
  startSummon: '开局召唤（全队）',
  taunt: '嘲讽',
};

/** 机制参数 key -> 中文标签（只列藏品会用的，其余原样显示） */
export const ITEM_MECH_FIELD_LABEL: Record<string, string> = {
  every: '每N击',
  ratioBp: '比例',
  minDistance: '最小距离',
  radius: '半径',
  thresholdBp: '斩杀阈值',
  cost: '费用≤',
  range: '射程>',
  perGold: '每N金币',
  capBp: '加成上限',
  hpBelow: '玩家血量低于',
  intervalTicks: '间隔',
  amount: '每次回复',
  attackDamageBp: '攻击力',
  attackSpeedBp: '攻速',
  armorBp: '护甲降低',
  magicResistBp: '魔抗降低',
  hits: '免疫次数',
  gold: '金币',
  chanceBp: '概率',
  durationTicks: '持续',
  attacks: '生效次数',
  hpBp: '重生血量',
  damageType: '伤害类型',
  scale: '基准',
  immuneToRangeAtMost: '射程≤',
  goldEach: '每人金币',
  exactly: '恰好N个',
  source: '来源',
  values: '数值表',
  bonusBp: '每次加成',
  perAttackBp: '每次加成',
  maxStacks: '层数上限',
  speedBp: '攻速加成',
  hpThresholdBp: '血量阈值',
  totalAttackBp: '攻击力总和比例',
  flatDamage: '固定伤害',
  perTripleBp: '每个三星加成',
  protectRadius: '保护半径',
  // ---- 0.1.1 藏品二版 ----
  hpBelowBp: '触发血线',
  shieldBp: '护盾',
  maxBonusBp: '最大加成',
  maxPerSecond: '最大每秒回蓝',
  mode: '方向',
  perCellBp: '每格加成',
  maxBp: '加成上限',
  perAllyBp: '每名干员加成',
  perCastBp: '每次开技能加成',
  goldAtLeast: '金币≥',
  stunTicks: '眩晕',
  summonId: '召唤物',
  count: '数量',
  damage: '伤害',
  maxHp: '血量上限',
  statBp: '属性倍率',
  base: '基础层数',
};

/** 技能 / 装备的「开局类效果」kind -> 中文 */
export const ITEM_START_EFFECT_LABEL: Record<string, string> = {
  shield: '护盾',
  buff: '增益',
  heal: '治疗',
  summon: '召唤',
  damage: '伤害',
  debuff: '减益',
};

/** 藏品「备战类效果」kind -> 中文 */
export const ITEM_PREP_LABEL: Record<string, string> = {
  cloneOneStar: '获得一只与装备者相同的一星干员（不占牌库）',
  upgradeStar: '装备者升 1 星（多出的干员不占牌库）',
  transformCostUp: '变成同星级、高一费的随机干员（5 费仍随机 5 费）',
  recruitRandom: '从牌库随机招募一名指定费用区间的干员（占牌库 1 张；该费用区抽完了则改发金币）',
  // ★ 0.1.3 变形同构体：产出的东西进的是存放栏 —— 这句必须写清楚，否则玩家以为直接装上了
  morphRelic: '按装备者的羁绊随机产出一件对应的转职藏品，放进穿戴藏品存放栏',
};

/** 藏品稀有度 -> 中文 */
export const ITEM_RARITY_LABEL: Record<string, string> = { normal: '普通', advanced: '进阶' };

/**
 * 藏品类别 -> 中文。
 *
 * ★★ 界面上**一律**叫「穿戴藏品 / 共享藏品」，不出现「A 类 / B 类」。
 *
 * 【为什么内部还叫 A / B？】
 * 因为 A / B 只是**分类用的代号**（也正好是数据里的 `slot` 字段值），
 * 玩家不需要知道。玩家只需要知道"这件东西是穿在干员身上的，
 * 还是全队共享的"，所以对外的话术就用这个。
 *
 * ⚠️ 这份文案同时喂给两个地方：游戏里的 tooltip 和导出的数值总表
 * （scripts/export-value-sheet.ts 的「藏品」表）。改这里两边一起变，是故意的 ——
 * 免得表格里写「A 类」、游戏里写「穿戴藏品」，对不上。
 */
export const ITEM_SLOT_LABEL: Record<string, string> = {
  A: '穿戴藏品 · 拖到干员身上',
  B: '共享藏品 · 拖到共享装备位',
};

/** 「穿戴藏品 / 共享藏品」的短标签，界面上的小徽章用 */
export const ITEM_SLOT_SHORT: Record<string, string> = { A: '穿戴藏品', B: '共享藏品' };

/**
 * 把一组 `SkillStats` 渲染成「攻击力 +20%；护甲 +15」这样的文字。
 *
 * 【为什么要特判 `pulse`？】
 * 因为休眠子裔的"每 3 秒回 5% 最大生命"是**嵌在 stats 里的一个对象**
 * （见 SkillStats.pulse），它不是一个数字，走通用的 `${key}=${value}` 分支
 * 会打印成 `pulse={"intervalTicks":60,...}` —— 这不是给人看的。
 */
export function renderItemStats(stats: SkillStats | undefined): string {
  if (!stats) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(stats)) {
    if (value === undefined) continue;
    if (key === 'pulse') {
      const pulse = value as {
        intervalTicks: number;
        radius: number;
        /** ★ 0.2：间隔跟着攻速走（夜莺） */
        intervalFromAttackSpeed?: boolean;
        /** ★ 0.2：可以是数组（多条基准相加） */
        heal?: HealSpec | readonly HealSpec[];
      };
      const who = pulse.radius === 0 ? '自身' : `半径 ${pulse.radius} 格内友军`;
      const specs: readonly HealSpec[] = !pulse.heal
        ? []
        : Array.isArray(pulse.heal)
          ? (pulse.heal as readonly HealSpec[])
          : [pulse.heal as HealSpec];
      const amount =
        specs.length > 0
          ? `回复${who} ` +
            specs
              .map((h) => {
                // 星级数组按 "+10%/15%/25%" 的口径显示（藏品不会是数组，干员才会）
                const ratio = Array.isArray(h.ratioBp)
                  ? (h.ratioBp as readonly number[]).map((n) => percentText(n)).join('/')
                  : percentText(h.ratioBp as number);
                return `${ratio}${HEAL_BASIS_LABEL[h.basis]}`;
              })
              .join(' + ')
          : '触发一次脉冲';
      const every = pulse.intervalFromAttackSpeed
        ? '自己的攻击间隔'
        : `${(pulse.intervalTicks / TICKS_PER_SECOND).toFixed(1)} 秒`;
      parts.push(`每 ${every}${amount}`);
      continue;
    }
    if (typeof value === 'object') {
      parts.push(`${key}=${JSON.stringify(value)}`);
      continue;
    }
    const n = Number(value);
    parts.push(ITEM_EFFECT_LABEL[key]?.(n) ?? `${key}=${value}`);
  }
  return parts.join('；');
}

/** 把一条战斗机制渲染成「每 N 击强化下一击（每N击=3，攻击力 +70%）」 */
export function renderItemMechanic(mechanic: ScopedMechanic): string {
  const label = ITEM_MECH_LABEL[mechanic.kind] ?? mechanic.kind;
  const parts: string[] = [];
  for (const [key, value] of Object.entries(mechanic)) {
    if (key === 'kind' || key === 'scope' || key === 'traitId' || value === undefined) continue;
    if (key === 'stats') {
      parts.push(`修正包 ${renderItemStats(value as SkillStats)}`);
      continue;
    }
    if (typeof value !== 'number') {
      parts.push(`${ITEM_MECH_FIELD_LABEL[key] ?? key}=${String(value)}`);
      continue;
    }
    const name = ITEM_MECH_FIELD_LABEL[key] ?? key;
    if (key.endsWith('Bp')) parts.push(`${name}=${percentText(value)}`);
    else if (key.endsWith('Ticks')) {
      parts.push(`${name}=${value} tick（${(value / TICKS_PER_SECOND).toFixed(1)} 秒）`);
    } else parts.push(`${name}=${value}`);
  }
  return parts.length > 0 ? `${label}（${parts.join('，')}）` : label;
}

/** 一批机制 -> 用「；」连起来 */
export function renderItemMechanics(mechanics: ScopedMechanic[] | undefined): string {
  return (mechanics ?? []).map(renderItemMechanic).join('；');
}

/** 「装备那一刻立刻结算」部分 */
export function renderItemOnEquip(item: ItemDef): string {
  const onEquip = item.onEquip;
  if (!onEquip) return '';
  const parts: string[] = [];
  if (onEquip.consume) parts.push('★ 立刻销毁（不占格子）');
  if (onEquip.require) {
    const min = onEquip.require.minStar ?? 1;
    const max = onEquip.require.maxStar ?? '不限';
    parts.push(`只能装备给 ${min}~${max} 星干员`);
  }
  if (onEquip.gold) parts.push(`玩家金币 +${onEquip.gold}`);
  if (onEquip.hp) parts.push(`玩家血量 +${onEquip.hp}`);
  if (onEquip.popCap) parts.push(`人口上限 +${onEquip.popCap}（卸下即失效）`);
  if (onEquip.permanent === 'lostKey') {
    parts.push('本局永久：升级多 +1 经验，十级后 +50 金（不可再次获得）');
  } else if (onEquip.permanent) {
    parts.push(`本局永久：${onEquip.permanent}`);
  }
  if (onEquip.prep) parts.push(ITEM_PREP_LABEL[onEquip.prep.kind] ?? onEquip.prep.kind);
  return parts.join('；');
}

/** B 类的「按条件放大」加成 */
export function renderItemTeamConditional(item: ItemDef): string {
  return (item.teamConditional ?? [])
    .map((cond) => {
      switch (cond.kind) {
        case 'costAtMost':
          return `费用 ≤${cond.cost} 的干员：${renderItemStats(cond.stats)}`;
        case 'rangeGreaterThan':
          return `射程 >${cond.range} 的干员：${renderItemStats(cond.stats)}`;
        case 'perActiveTrait':
          return `每激活 1 个不同羁绊，全队：${renderItemStats(cond.stats)}`;
        case 'perGold':
          return `每 ${cond.perGold} 金币，全队：${renderItemStats(cond.stats)}${
            cond.capBp ? `（总加成上限 ${percentText(cond.capBp)}）` : ''
          }`;
        case 'lowHp':
          return `玩家血量低于 ${cond.hpBelow} 时，全队：${renderItemStats(cond.stats)}`;
        case 'hpAbove':
          return `玩家血量大于 ${cond.hpAbove} 时，全队：${renderItemStats(cond.stats)}`;
        case 'always':
          return `全队：${renderItemStats(cond.stats)}`;
        default:
          return JSON.stringify(cond);
      }
    })
    .join('；');
}

/** B 类的「每回合经济」 */
export function renderItemPerRound(item: ItemDef): string {
  const per = item.perRound;
  if (!per) return '';
  const parts: string[] = [];
  if (per.gold) parts.push(`每回合 +${per.gold} 金`);
  if (per.goldOnLossStreak) parts.push(`处于连败时每回合额外 +${per.goldOnLossStreak} 金`);
  if (per.monsterGoldBp) parts.push(`野怪回合掉落金币 +${percentText(per.monsterGoldBp)}`);
  if (per.growthGoldChance) {
    const g = per.growthGoldChance;
    parts.push(`每 ${g.layersPerStep} 层：战斗胜利后有 ${g.percentPerStep}% 概率额外获得 ${g.gold ?? 1} 金币`);
  }
  return parts.join('；');
}

/** 藏品「开局类效果」（复用技能效果结构） */
export function renderItemBattleStart(item: ItemDef): string {
  return (item.combat?.battleStart ?? [])
    .map((effect) => {
      const label = ITEM_START_EFFECT_LABEL[effect.kind] ?? effect.kind;
      const parts: string[] = [];
      for (const [key, value] of Object.entries(effect)) {
        if (key === 'kind' || value === undefined) continue;
        if (key === 'stats') {
          parts.push(renderItemStats(value as SkillStats));
          continue;
        }
        const name = ITEM_MECH_FIELD_LABEL[key] ?? key;
        if (key.endsWith('Ticks') && typeof value === 'number') {
          parts.push(`${name} ${value} tick（${(value / TICKS_PER_SECOND).toFixed(1)} 秒）`);
        } else {
          parts.push(`${name}=${String(value)}`);
        }
      }
      return `${label}（${parts.join('，')}）`;
    })
    .join('；');
}

/**
 * 一件藏品的**全部效果**，一行一条（界面 tooltip / 详情页直接用这个数组）。
 *
 * 【为什么要给"行"而不是给一大段文字？】
 * 因为界面要分行排版（每行前面加个小圆点），而 Excel 要的是"一格里塞下全部"。
 * 返回数组之后两边各取所需：界面 `lines.map(...)`，表格 `lines.join('；')`。
 * 只返回一大段字符串的话，界面那边就只能按分号硬切 —— 而效果文案里本来就有分号。
 *
 * 顺序刻意固定成「属性 → 机制 → 开局 → 装备时 → 每回合 → 条件」，
 * 这样同一件藏品在界面上和表格里读到的顺序永远一致。
 *
 * @param traitName 羁绊 id -> 显示名。不传就直接写 id
 *   （本模块刻意**不去 import trait-data**：那样这个"纯文字"模块就把整张羁绊表
 *   拖进了依赖里，而它本来只需要几个字符串。谁来提供名字由调用方决定。）
 */
export function itemEffectLines(item: ItemDef, traitName?: (id: string) => string): string[] {
  const nameOf = traitName ?? ((id: string) => id);
  const lines: string[] = [];
  /*
    ★ 0.1.3 转职藏品：它没有 combat、没有 onEquip —— 不显式写一句的话，
    这件藏品在 tooltip 里就是**一片空白**（玩家只能靠名字猜）。
    顺便把"已经是该羁绊的装不上"这条限制也写上，免得他试半天。
  */
  if (item.grantsTrait) {
    lines.push(
      `装备者额外获得【${nameOf(item.grantsTrait)}】羁绊（可以凑人数，也能吃到该羁绊给成员的增益）；` +
        '本来就属于该羁绊的干员装不上',
    );
  }
  const combat = item.combat;
  if (combat?.stats) lines.push(renderItemStats(combat.stats));
  if (combat?.selfTraitStats) {
    lines.push(`【需 ${nameOf(combat.selfTraitStats.trait)} 羁绊】${renderItemStats(combat.selfTraitStats.stats)}`);
  }
  if (combat?.mechanics) lines.push(renderItemMechanics(combat.mechanics));
  if (combat?.selfTraitMechanics) {
    lines.push(
      `【需 ${nameOf(combat.selfTraitMechanics.trait)} 羁绊】${renderItemMechanics(
        combat.selfTraitMechanics.mechanics,
      )}`,
    );
  }
  if (combat?.battleStart) lines.push(renderItemBattleStart(item));
  if (combat?.healingBp) lines.push(`受到的治疗 +${percentText(combat.healingBp)}`);
  // ★ 0.3.2：迅捷作战粮 —— 技力回复量（不是治疗量）
  if (combat?.manaGainBp) lines.push(`获得技力 +${percentText(combat.manaGainBp)}`);
  if (combat?.revive) lines.push(`阵亡后复活（${percentText(combat.revive.hpBp)} 生命）`);
  const onEquip = renderItemOnEquip(item);
  if (onEquip) lines.push(onEquip);
  const perRound = renderItemPerRound(item);
  if (perRound) lines.push(perRound);
  const conditional = renderItemTeamConditional(item);
  if (conditional) lines.push(conditional);
  /*
    ★ B 类（共享藏品）的队伍级机制。
    这里**不能**写成 `lines.push(...renderItemMechanics(...))` ——
    `renderItemMechanics` 返回的是**一个字符串**，`...` 会把字符串摊成一个个字符，
    于是 tooltip 变成"一个字一行"的竖条（用户报的"有的藏品提示框竖着显示"）。
  */
  const teamMechanicText = renderItemMechanics(item.teamMechanics);
  if (teamMechanicText.length > 0) lines.push(teamMechanicText);
  /*
    ★ 0.1.1 藏品二版：三样"不在战斗里、也不在装备那一刻"的东西 ——
    跨回合成长层数、商店花费变化、自动销毁条件。
    它们必须显式写出来，否则玩家看到一件藏品"什么都没写"却真的有效果。
  */
  if (item.growth) {
    const parts = [item.growth.label];
    if (item.growth.perLayer) parts.push(`每层 ${renderItemStats(item.growth.perLayer)}`);
    else parts.push('（层数影响上面那条机制）');
    parts.push(`上限 ${item.growth.maxStacks} 层`);
    if (item.growth.resetOnUnequip) parts.push('卸下后层数重置');
    if (item.growth.resetOnLoss) parts.push('战斗失败后层数重置');
    lines.push(`【跨回合成长】${parts.join('；')}`);
  }
  if (item.shopCostDelta) {
    lines.push(`装载期间购买干员的花费 ${item.shopCostDelta > 0 ? '+' : ''}${item.shopCostDelta}`);
  }
  if (item.selfDestructAfterRounds) {
    lines.push(`获得后 ${item.selfDestructAfterRounds} 回合内未装载则自动销毁`);
  }
  return lines.filter((line) => line.length > 0);
}

/**
 * 一件藏品的效果摘要（**一行**）。
 *
 * 界面上格子的空间很小，只放得下这一行；
 * hover 出来的 tooltip 才用 `itemEffectLines` 的完整版。
 */
export function itemEffectSummary(item: ItemDef, traitName?: (id: string) => string): string {
  const lines = itemEffectLines(item, traitName);
  if (lines.length === 0) return item.desc || '无额外效果';
  return lines.length === 1 ? lines[0]! : `${lines[0]}…`;
}


// ============================================================
//  ★ 0.1.1：实时数值（"我现在到底吃到多少"）
// ============================================================

/**
 * 「实时数值」需要的上下文。
 *
 * 全是**状态层现算好塞进来**的场外信息（金币 / 血量 / 层数 / 羁绊数 / 回合）——
 * 这个模块只做字符串拼接，不碰任何状态，所以内核和导表脚本读它都不会破坏确定性。
 */
export interface ItemLiveContext {
  /** 每件藏品的成长层数（客户端那份；不传 = 全部按 0 层算） */
  growth?: Record<string, number>;
  /** 藏品栏里还没装载的藏品数量（悲伤的红按它算） */
  unequipped?: number;
  gold: number;
  hp: number;
  /** 已经激活的羁绊数量（老蒲扇） */
  activeTraits: number;
  /** 已经激活的羁绊 id（天师锦囊要看"大炎开没开"） */
  activeTraitIds?: readonly string[];
  /** 当前回合（按回合成长的召唤物要用） */
  round: number;
  /** 召唤物 id -> 中文名（天师锦囊 / 支援防暴桩）；不传就写「召唤物」 */
  summonName?: (id: string) => string;
  /** 羁绊 id -> 中文名（写"大炎羁绊未激活"时要用）；不传就写 id */
  traitName?: (id: string) => string;
  /**
   * 这件藏品"开局随机挑人"的效果**这一场抽到了谁**（生还者合约）。
   *
   * 【为什么由外面传进来？】
   * 抽签是**战斗内核开局**用战斗随机源做的（要和联机对端一致），界面算不出来 ——
   * 只能从战斗日志里读（`randomAllyBuffPick`）。所以这里要一个回调，
   * 由拿得到日志的那一层（main.ts）提供。
   * 不传 / 返回 null = 还没开打，于是只显示"随机一名干员"。
   */
  randomBuffPick?: (itemId: string) => string | null;
  /**
   * ★ 0.2：**这一件副本**的层数（有它就以它为准）。
   *
   * 【为什么需要？】层数改成逐副本之后，"同一个 id 的层数"不再是唯一答案：
   * 两个「圆石祭坛」各有各的层数，界面要分别显示。
   * 不传 = 走 `growth` 那张按 id 的表（老数据兜底）。
   */
  layerOverride?: number;
}

/** 两个属性包相加（只处理数值字段 —— 展示用，不追求 Kernel 那种完备） */
function addStats(a: SkillStats | undefined, b: SkillStats | undefined): SkillStats {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(a ?? {})) {
    if (typeof value === 'number') out[key] = value;
  }
  for (const [key, value] of Object.entries(b ?? {})) {
    if (typeof value === 'number') out[key] = (out[key] ?? 0) + value;
  }
  return out as SkillStats;
}

/**
 * ★ 0.1.1：一件藏品**现在实际给了多少** —— 只给数值，不复述机制。
 *
 * 【为什么要单独一套，而不是继续用 `itemEffectLines`？】
 * 效果栏和干员详情页原来直接贴 `itemEffectLines`，那里面全是内部写法：
 * `间隔=200 tick（10.0 秒）`、`active=false`、`修正包 攻击力 +20%`、
 * 以及"同一件事说两遍"（层数标签 + 每层属性 + 上限 + 重置）。
 * 玩家真正要回答的问题是"**我现在到底吃到多少**"，所以这里按当前状态换算：
 *   · 跨回合成长 —— 把"每层"乘上当前层数（藏品自带的静态部分也算进去）
 *   · 血量 / 金币 / 羁绊门槛 —— 直接说"生效中 / 未生效"和当前值
 *   · 按回合成长的召唤物 —— 按当前回合算它的生命与攻击
 *   · 治疗 / 削抗这类固定数值 —— 直接给数字
 *
 * @returns 空数组 = 这件藏品没有"实时"这一维（纯静态属性那种），
 *          界面应当回退到 `item.desc` 那句人话说明。
 */
export function itemLiveLines(item: ItemDef, ctx: ItemLiveContext): string[] {
  const out: string[] = [];

  // ---- ① 跨回合成长：层数 x 每层 ----
  if (item.growth?.perLayer) {
    // ★ 0.2：有"这一件副本"的层数就以它为准（同名藏品有多件时各算各的）
    const layers = growthLayers(item, ctx, ctx.layerOverride);
    const total = addStats(item.combat?.stats, scaleStats(item.growth.perLayer, layers * 10000));
    const text = renderItemStats(total);
    /*
      0 层时不能显示「生命上限 +0%；攻击力 +0%」这种噪声（悲伤的红在藏品装得满
      的时候就是这个状态）—— 直接说"还没叠起来"。有静态部分的那种（佣兵的饰物）
      本来就不会全 0，所以还是照常显示总数。
    */
    const allZero = Object.values(total).every((value) => value === 0 || value === undefined);
    out.push(allZero ? '尚未叠层（当前没有加成）' : text);
  }

  // ---- ② 层数只放大"机制"的那些 ----
  if (item.growth && !item.growth.perLayer) {
    // ★ 0.2：有"这一件副本"的层数就以它为准（同名藏品有多件时各算各的）
    const layers = growthLayers(item, ctx, ctx.layerOverride);
    const goldChance = item.perRound?.growthGoldChance;
    if (goldChance) {
      const steps = Math.floor(layers / Math.max(1, goldChance.layersPerStep));
      out.push(`胜利后额外金币概率 ${steps * goldChance.percentPerStep}%（当前 ${layers} 层）`);
    }
    const buff = (item.teamMechanics ?? []).find((m) => m.kind === 'startRandomAllyBuff');
    if (buff && buff.kind === 'startRandomAllyBuff' && layers > 0) {
      const stats = renderItemStats(scaleStats(buff.stats, layers * 10000));
      // 开打之后能把抽到的名字写出来（用户要求：那一栏要看得到随机到谁身上了）
      const who = ctx.randomBuffPick?.(item.id) ?? null;
      out.push(who ? `开局随机强化：${who}（${stats}）` : `开局随机强化一名干员：${stats}`);
    }
  }

  // ---- ③ 场外门槛（血量 / 金币 / 羁绊）----
  for (const cond of item.teamConditional ?? []) {
    switch (cond.kind) {
      case 'hpAbove': {
        const on = ctx.hp > cond.hpAbove;
        out.push(
          on
            ? `当前血量 ${ctx.hp}：${renderItemStats(cond.stats)}（生效中）`
            : `当前血量 ${ctx.hp}：未生效（需要大于 ${cond.hpAbove}）`,
        );
        break;
      }
      case 'lowHp': {
        const on = ctx.hp < cond.hpBelow;
        out.push(
          on
            ? `当前血量 ${ctx.hp}：${renderItemStats(cond.stats)}（生效中）`
            : `当前血量 ${ctx.hp}：未生效（需要低于 ${cond.hpBelow}）`,
        );
        break;
      }
      case 'perGold': {
        const steps = Math.floor(ctx.gold / Math.max(1, cond.perGold));
        let stats = scaleStats(cond.stats, steps * 10000);
        if (cond.capBp !== undefined) {
          // 封顶：逐字段夹一下（展示用，字段名一致，直接取比例最小的那个更简单粗暴）
          const capped = Object.fromEntries(
            Object.entries(stats).map(([key, value]) => [
              key,
              typeof value === 'number' ? Math.min(value, cond.capBp!) : value,
            ]),
          ) as SkillStats;
          stats = capped;
        }
        out.push(`当前 ${ctx.gold} 金：${renderItemStats(stats)}`);
        break;
      }
      case 'perActiveTrait': {
        out.push(`当前 ${ctx.activeTraits} 个羁绊：${renderItemStats(scaleStats(cond.stats, ctx.activeTraits * 10000))}`);
        break;
      }
      // 下面三种是"固定给谁加多少"—— 没有实时维度，但玩家要看的是数字本身
      case 'costAtMost':
        out.push(`${renderItemStats(cond.stats)}（${cond.cost} 费及以下）`);
        break;
      case 'rangeGreaterThan':
        out.push(`${renderItemStats(cond.stats)}（射程大于 ${cond.range} 的干员）`);
        break;
      case 'always':
        out.push(renderItemStats(cond.stats));
        break;
      default:
        break;
    }
  }

  // ---- ③-b 经济类：固定数值也直接给出来（"每回合 +1 金"比一句效果说明好读）----
  if (item.perRound?.gold) out.push(`每回合 +${item.perRound.gold} 金`);
  if (item.perRound?.goldOnLossStreak) out.push(`连败时每回合 +${item.perRound.goldOnLossStreak} 金`);
  if (item.perRound?.monsterGoldBp) out.push(`野怪回合金币 +${percentText(item.perRound.monsterGoldBp)}`);
  if (item.shopCostDelta) out.push(`购买干员的花费 ${item.shopCostDelta > 0 ? '+' : ''}${item.shopCostDelta}`);
  if (item.onEquip?.popCap) out.push(`人口上限 +${item.onEquip.popCap}`);

  // ---- ④ 全队机制里"能算成数"的那几种 ----
  for (const mech of item.teamMechanics ?? []) {
    if (mech.kind === 'teamHealingBp') {
      out.push(`全队受到的治疗与回复 +${percentText(mech.ratioBp)}`);
      continue;
    }
    if (mech.kind === 'goldThresholdNuke') {
      const on = ctx.gold >= mech.goldAtLeast;
      const seconds = (mech.intervalTicks / TICKS_PER_SECOND).toFixed(0);
      const kindText = mech.damageType === 'magic' ? '法术' : '物理';
      const stun = mech.stunTicks
        ? ` + ${(mech.stunTicks / TICKS_PER_SECOND).toFixed(1)} 秒晕眩`
        : '';
      out.push(
        on
          ? `当前 ${ctx.gold} 金：每 ${seconds} 秒对全场敌人 ${mech.damage} 点${kindText}伤害${stun}（生效中）`
          : `当前 ${ctx.gold} 金：未生效（需要 ${mech.goldAtLeast} 金以上）`,
      );
      continue;
    }
    if (mech.kind === 'damageReduction') {
      out.push(`全队受到的伤害 -${percentText(mech.ratioBp)}`);
      continue;
    }
    if (mech.kind === 'teamRegen') {
      out.push(
        `每 ${(mech.intervalTicks / TICKS_PER_SECOND).toFixed(0)} 秒回复全队 ${mech.amount} 点生命`,
      );
      continue;
    }
    if (mech.kind === 'startEnemyShred') {
      out.push(`回合开始：敌方护甲 -${percentText(mech.armorBp)}、魔抗 -${percentText(mech.magicResistBp)}`);
      continue;
    }
    if (mech.kind === 'startTeamImmunity') {
      out.push(`回合开始：全队获得 ${mech.hits} 次免疫`);
      continue;
    }
    if (mech.kind === 'startSummon') {
      const growth = item.summonGrowth;
      if (!growth) continue;
      /*
        ★ 炎佑的 +30% 有前提（`requireTrait`：大炎羁绊开着）。
        这里和解析层用**同一个判据**（`summonStatBpActive`）——
        否则会出现"界面上写 +30%、打起来没有"。
      */
      const active = summonStatBpActive(item, new Set(ctx.activeTraitIds ?? []));
      const stats = summonStatsAtRound(growth, ctx.round, active);
      const name = ctx.summonName?.(mech.summonId) ?? '召唤物';
      const cond = !active && growth.requireTrait
        ? `；${ctx.traitName?.(growth.requireTrait) ?? growth.requireTrait}羁绊未激活，没有 +${percentText((growth.statBp ?? 10000) - 10000)}`
        : '';
      out.push(
        `开局召唤 ${name}×${mech.count}：生命 ${stats.hp} / 攻击 ${stats.attackDamage}（第 ${ctx.round} 回合${cond}）`,
      );
      continue;
    }
  }

  return out.filter((line) => line.length > 0);
}
