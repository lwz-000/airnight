/**
 * 导出「AIRNIGHT 数值总表」成 Excel（.xlsx）—— 干员 / 羁绊 / 野怪 / 全局规则一览。
 *
 * 用法：
 *   node node_modules/tsx/dist/cli.mjs scripts/export-value-sheet.ts
 *
 * 产出：各项数值/AIRNIGHT-数值总表.xlsx（12 个工作表）
 *   1. 说明       —— 怎么用这张表、每个数值住在哪个代码文件里
 *   2. 干员       —— 50 个干员的基础数值 + 技能
 *   3. 羁绊       —— 18 个羁绊一览（成员、档位）
 *   4. 羁绊档位   —— 49 行"凑够几人才生效 / 生效什么"（调羁绊看这张）
 *   5. 野怪       —— 19 只野怪的完整数值 + 技能 + 二阶段
 *   6. 野怪档位基准 —— 五档基准（改整体强度改这里）
 *   7. 召唤物     —— 五个召唤单位（战术柱 / 金狮子 / 棋子 / 假人 / 炎佑）
 *   8. 野怪回合   —— 哪几回合是野怪回合、每回合出什么波次
 *   9. 野怪掉落   —— 每个档位"先掷金币、再按组掷藏品"的全部概率
 *  10. 全局规则   —— 攻速/护甲/法力/星级/棋盘这些底层常数
 *  11. 商店概率   —— 各等级抽到 1~5 费的概率
 *  12. 藏品       —— 83 件藏品（一版 36 + 二版 30 + 三版转职体系 17；普通/进阶 × 穿戴/共享）的全部数值
 *
 * 【★ 最重要的一句话：这张表是"只读快照"，不是"输入表" ★】
 * 游戏运行时读的是 packages/shared/src/*.ts，**永远不读这个 xlsx**。
 * 所以改这张表不会改变游戏 —— 改完代码再重跑本脚本，它才会刷新。
 * （干员数值那条线另有 docs/干员数值表.xlsx，那份可以改完导入回代码，
 *   见 scripts/import-stat-sheet.ts。两张表分工不同，别搞混。）
 *
 * 【为什么要用脚本导出，而不是手打一张表？】
 * 因为这里有 1000 多个数字，而且野怪的数值是"档位基准 + 个体覆盖"合并出来的。
 * 手抄一遍必然出现"表和代码对不上"，而错的方向还不一定看得出来。
 * 脚本导出 = 每个数字都直接来自代码，改代码重跑即同步。
 *
 * 【写完之后会自查】
 * 用我们自己的 xlsx 读取器把全部工作表读回来，核对行数并抽查单元格，
 * 这样"Excel 能不能打开、内容对不对"不是靠猜。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, openSync, closeSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  UNIT_DEFS,
  TRAIT_DEFS,
  TRAIT_MEMBERS,
  MONSTER_ROSTER,
  MONSTER_TIERS,
  MONSTER_TIER_BASE,
  MONSTER_TIER_COST,
  MONSTER_TIER_LABEL,
  MONSTER_MODEL_SCALE,
  SUMMON_DEFS,
  SHOP_ODDS_BY_LEVEL,
  ROSTER_SUMMARY,
  TICKS_PER_SECOND,
  MAX_BATTLE_TICKS,
  RAGE_START_TICKS,
  FORCE_END_TICKS,
  MAX_LEVEL,
  monsterDefs,
  monsterModelScaleOf,
  monsterWaveForRound,
  isMonsterRound,
  MONSTER_DROP_TABLE,
  DROP_TIER_LABEL,
  dropChanceBp,
  playableDefs,
  populationCap,
  ITEM_DEFS,
  NORMAL_ITEMS,
  ADVANCED_ITEMS,
  ITEM_A_SLOTS,
  ITEM_B_SLOTS,
  ITEM_B_EQUIP_SLOTS,
  ITEM_PER_UNIT,
  /*
    ★ 藏品效果的文字化统一住在 shared 的 item-text.ts 里（界面 tooltip 也用同一份）——
    这样"表里写的"和"游戏里 hover 出来的"永远是同一段文字。
    下面这些名字是从那边 import 过来的，不是本文件里定义的。
  */
  ITEM_EFFECT_LABEL as EFFECT_LABEL,
  ITEM_MECH_LABEL as MECH_LABEL,
  ITEM_MECH_FIELD_LABEL as MECH_FIELD_LABEL,
  ITEM_START_EFFECT_LABEL as START_EFFECT_LABEL,
  ITEM_PREP_LABEL as PREP_LABEL,
  ITEM_RARITY_LABEL as RARITY_LABEL,
  ITEM_SLOT_LABEL as SLOT_LABEL,
  // 渲染函数：同样住在 item-text.ts，这里只是换成脚本里用惯的短名字
  renderItemStats as renderStats,
  renderItemMechanic as renderMechanic,
  renderItemMechanics as renderMechanics,
  renderItemOnEquip as renderOnEquip,
  renderItemTeamConditional as renderTeamConditional,
  renderItemPerRound as renderPerRound,
  renderItemBattleStart as renderBattleStart,
} from '../packages/shared/src/index.js';
import type { DropTier, ItemDef, ScopedMechanic, SkillStats } from '../packages/shared/src/index.js';
// @ts-expect-error 写出器是 .mjs（零依赖的小工具），没有类型声明
import { buildXlsx } from './xlsx-write.mjs';

const OUT_DIR = '各项数值';
const OUT_PATH = `${OUT_DIR}/AIRNIGHT-数值总表.xlsx`;

type Cell = string | number;
type Row = Cell[];

// ============================================================
//  小工具：把内部 bp 数值翻译成人话
// ============================================================

/** 羁绊 id -> 中文名 */
const traitName = (id: string): string => TRAIT_DEFS[id]?.name ?? id;

/** 万分比 -> 百分比字符串 */
const pct = (bp: number): string => `${bp / 100}%`;

/*
  下面这一大段「属性字段 -> 中文」「机制 kind -> 中文」「开局效果 -> 中文」
  的对照表，以及 renderStats / renderMechanic(s) / renderOnEquip /
  renderTeamConditional / renderPerRound / renderBattleStart 这些渲染函数，
  ★ 都已经搬到 `packages/shared/src/item-text.ts` 了（在文件顶部 import 进来）。

  【为什么要搬？】
  因为游戏的藏品界面（hover 出来的说明）需要**一模一样**的文字。
  留在这里的话，改一件藏品就得改两处，迟早出现
  "表格里写 +20%、游戏里显示 +10%" 这种对不上的情况。
  放在 shared 里之后：一份实现、两个消费方（本脚本 + apps/web）。
*/

const MANA_LABEL: Record<string, string> = {
  attack: '攻击回复',
  damage: '受击回复',
  auto: '自动回复',
};

/** 攻击力 × 每秒攻击次数 —— 只作横向比较用，不含技能与羁绊 */
const dps = (atk: number, speed: number): number => Math.round((atk * speed) / 1000);

/** 一星血量在"只挨物理伤害"时的等效血量（护甲减伤之后） */
const effHp = (hp: number, armor: number): number =>
  Math.round(hp / (1 - armor / (armor + 100)));

// ============================================================
//  1. 说明
// ============================================================
const guide: Row[] = [
  ['AIRNIGHT 数值总表', '', ''],
  [
    '这张表是什么',
    `代码里 ${ROSTER_SUMMARY.total} 个棋子的完整数值快照：干员 ${playableDefs().length} 名 + 野怪 ${MONSTER_ROSTER.length} 只 + 召唤物 ${Object.keys(SUMMON_DEFS).length} 个，外加 ${Object.keys(TRAIT_DEFS).length} 个羁绊的全部档位`,
    '由 scripts/export-value-sheet.ts 从代码直接导出',
  ],
  ['', '', ''],

  ['★ 改这张表会改变游戏吗', '不会', '游戏读的是代码，永远不读这个 xlsx'],
  ['★ 想改数值怎么办', '改代码文件 → 重跑导出脚本刷新本表', '比手改表格再抄回代码可靠得多'],
  [
    '重跑命令',
    'node node_modules/tsx/dist/cli.mjs scripts/export-value-sheet.ts',
    '改完任意数值后执行，本表立刻同步',
  ],
  ['', '', ''],

  ['数值住在哪个文件（要改就改这里）', '', ''],
  ['干员基础数值', 'packages/shared/src/unit-stats.ts', '⚠️ 这个文件是自动生成的，别手改'],
  [
    '干员数值的"输入表"',
    'docs/干员数值表.xlsx → scripts/import-stat-sheet.ts --write',
    '这一份是**可以**改表导入的：改 Excel 再跑导入脚本',
  ],
  ['干员名单/费用/羁绊标签', 'packages/shared/src/unit-data.ts', '名字、定位、官方 charId'],
  ['技能（干员 + 野怪）', 'packages/shared/src/skill-data.ts', '技能倍率、目标、范围、持续时间'],
  ['羁绊档位与效果', 'packages/shared/src/trait-data.ts', '18 个羁绊的全部档位'],
  ['野怪名单/数值/技能/二阶段', 'packages/shared/src/monster-data.ts', '档位基准 TIER_BASE 也在里面'],
  [
    '藏品（装备）全部数值',
    'packages/shared/src/item-data.ts',
    `加一件/改一件藏品只改这个文件，逻辑代码不用动（${Object.keys(ITEM_DEFS).length} 件）`,
  ],
  [
    '藏品效果怎么落到战斗里',
    'packages/shared/src/item-effects.ts',
    '把藏品翻译成属性/机制，战斗内核不认识"藏品"这个概念',
  ],
  ['全局常数（攻速/护甲/法力/棋盘）', 'packages/shared/src/constants.ts', '改这些会影响所有单位'],
  ['商店概率 / 等级规则', 'packages/shared/src/unit-data.ts、economy.ts', 'SHOP_ODDS_BY_LEVEL、populationCap'],
  ['', '', ''],

  ['单位换算（★ 最容易看错的地方）', '', ''],
  ['攻速', '1000 = 每秒攻击 1 次', '1300 = 每秒 1.3 次；500 = 两秒 1 次'],
  ['护甲 / 魔抗', '减伤 = 抗性 ÷（抗性 + 100）', '100 = 减 50%；50 = 减 33%；200 = 减 67%'],
  ['最大减伤', '90%', '再堆抗性也不会更肉'],
  ['每次普攻回法力', '法力上限 1000', '100 = 打 10 下放一次技能；120 = 约 8.3 下'],
  ['每星生命/攻击倍率', '1800 = 每升一星 ×1.8', '三星 = ×1.8×1.8 = ×3.24'],
  ['羁绊的 bp（万分比）', '1000 bp = 10%', '表里已经换算成 % 了'],
  ['DPS参考 / 有效血量', '脚本按当前数值算的，供横向比较', '不含技能与羁绊加成，改数值后需重新导出'],
  ['', '', ''],

  ['表结构', '', ''],
  ['干员', `${playableDefs().length} 名`, '基础数值 + 技能 + 参考 DPS'],
  ['羁绊', `${Object.keys(TRAIT_DEFS).length} 个`, '一览（类别 / 作用范围 / 成员 / 档位）'],
  ['羁绊档位', '每个羁绊每个档位一行', '★ 调羁绊强度主要看这张'],
  ['野怪', `${MONSTER_ROSTER.length} 只`, '数值 = 档位基准 + 个体覆盖（已合并好）；最后一列「模型倍率」是小人显示大小'],
  ['野怪档位基准', '5 档', '★ 改野怪整体强度改这张对应的代码'],
  ['召唤物', `${Object.keys(SUMMON_DEFS).length} 个`, '不进商店，只能被技能召唤'],
  ['野怪回合', '哪几回合打野怪 + 每回合出什么波次', '波次按《野怪分布.txt》；第 2 回合起每 7 回合一次'],
  ['野怪掉落', '打倒一只野怪掉什么', '按《掉落表 三版.txt》；金币档先掷，没中才按组掷藏品'],
  ['全局规则', '攻速/抗性/法力/星级/棋盘/经济', '改这里影响全部单位'],
  ['商店概率', `1~${MAX_LEVEL} 级`, '每级抽到各费用干员的概率'],
  [
    '藏品',
    `${Object.keys(ITEM_DEFS).length} 件（普通 ${NORMAL_ITEMS.length} / 进阶 ${ADVANCED_ITEMS.length}）`,
    `穿戴藏品 ${ITEM_A_SLOTS} 格存放、每人最多装 ${ITEM_PER_UNIT} 件；共享藏品 ${ITEM_B_SLOTS} 格存放 + ${ITEM_B_EQUIP_SLOTS} 格装备位`,
  ],
];

// ============================================================
//  2. 干员
// ============================================================
const operatorRows: Row[] = [
  [
    '干员id',
    '名字',
    '费用',
    '羁绊',
    '生命值',
    '攻击力',
    '攻速',
    '护甲',
    '魔抗',
    '攻击距离',
    '每次普攻回法力',
    '每星生命倍率',
    '每星攻击倍率',
    'DPS参考',
    '1星有效血量',
    '技能名',
    '技能描述',
    '技能类型',
    '法力回复',
    '三星技能名',
    '三星技能描述',
    '官方charId',
  ],
];
for (const def of playableDefs().sort((a, b) => a.id.localeCompare(b.id))) {
  const skill = def.skill;
  operatorRows.push([
    def.id,
    def.name,
    def.cost,
    def.traits.map(traitName).join('、'),
    def.base.hp,
    def.base.attackDamage,
    def.base.attackSpeed,
    def.base.armor,
    def.base.magicResist,
    def.base.range,
    def.base.manaPerAttack,
    def.starHpBp,
    def.starDamageBp,
    dps(def.base.attackDamage, def.base.attackSpeed),
    effHp(def.base.hp, def.base.armor),
    skill.name,
    skill.desc,
    skill.effects.length === 0 ? (skill.passive ? '被动' : skill.battleStart ? '开局类' : '无主动') : '主动',
    MANA_LABEL[skill.manaSource] ?? skill.manaSource,
    skill.star3?.name ?? '无',
    skill.star3?.desc ?? '无',
    def.charId ?? '',
  ]);
}

// ============================================================
//  3. 羁绊 / 4. 羁绊档位
// ============================================================
const traitRows: Row[] = [
  ['羁绊id', '名称', '类别', '作用范围', '档位数', '开启人数档位', '成员数', '成员'],
];
const traitTierRows: Row[] = [
  ['羁绊', '需求人数', '效果说明', '属性加成', '战斗机制', '作用范围', '成员数', '成员'],
];

for (const trait of Object.values(TRAIT_DEFS)) {
  const memberIds = TRAIT_MEMBERS[trait.id] ?? [];
  const members = memberIds.map((id) => UNIT_DEFS[id]?.name ?? id).join('、');
  const scope = trait.scope === 'team' ? '全队受益' : '仅带此标签者';

  traitRows.push([
    trait.id,
    trait.name,
    trait.kind === 'race' ? '种族' : '职业',
    scope,
    trait.tiers.length,
    trait.tiers.map((t) => t.count).join(' / '),
    memberIds.length,
    members,
  ]);

  for (const tier of trait.tiers) {
    traitTierRows.push([
      trait.name,
      tier.count,
      tier.desc,
      (tier.effects ?? [])
        .map((e) => EFFECT_LABEL[e.type]?.(e.value) ?? `${e.type}=${e.value}`)
        .join('；'),
      (tier.mechanics ?? []).map((m) => MECH_LABEL[m.kind] ?? m.kind).join('；'),
      scope,
      memberIds.length,
      members,
    ]);
  }
}

// ============================================================
//  5. 野怪 / 6. 野怪档位基准 / 7. 召唤物
// ============================================================
const monsterRows: Row[] = [
  [
    '野怪id',
    '名字',
    '档位',
    '生命值',
    '攻击力',
    '攻速',
    '护甲',
    '魔抗',
    '攻击距离',
    '每次普攻回法力',
    'DPS参考',
    '技能名',
    '技能描述',
    '技能被动',
    '法力回复',
    '二阶段（重生）',
    '官方敌id',
    '模型倍率',
  ],
];
for (const def of monsterDefs()) {
  const skill = def.skill;
  monsterRows.push([
    def.id,
    def.name,
    MONSTER_TIER_LABEL[def.monsterTier!] ?? def.monsterTier!,
    def.base.hp,
    def.base.attackDamage,
    def.base.attackSpeed,
    def.base.armor,
    def.base.magicResist,
    def.base.range,
    def.base.manaPerAttack,
    dps(def.base.attackDamage, def.base.attackSpeed),
    skill.name,
    skill.desc,
    skill.passive
      ? Object.entries(skill.passive)
          .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join('/') : v}`)
          .join('；')
      : '无',
    MANA_LABEL[skill.manaSource] ?? skill.manaSource,
    def.reborn ? `血量归零后按 ${def.reborn.hpBp / 100}% 血站起来；${def.reborn.desc}` : '无',
    def.charId ?? '',
    monsterModelScaleOf(def),
  ]);
}

const TIER_NOTE: Record<string, string> = {
  minion: '约等于最脆的干员',
  normal: '约等于一队 2 费',
  elite: '约等于一个 3 星干员',
  leader: '一个能一挑三的强干员',
  boss: '需要整套阵容 + 羁绊才打得过',
};
const tierBaseRows: Row[] = [
  [
    '档位',
    '对应cost',
    '生命值',
    '攻击力',
    '攻速',
    '护甲',
    '魔抗',
    '攻击距离',
    '每次普攻回法力',
    '默认模型倍率',
    '强度定位',
  ],
];
for (const tier of MONSTER_TIERS) {
  const base = MONSTER_TIER_BASE[tier];
  tierBaseRows.push([
    MONSTER_TIER_LABEL[tier],
    MONSTER_TIER_COST[tier],
    base.hp,
    base.attackDamage,
    base.attackSpeed,
    base.armor,
    base.magicResist,
    base.range,
    base.manaPerAttack,
    MONSTER_MODEL_SCALE[tier] ?? 1,
    TIER_NOTE[tier] ?? '',
  ]);
}

const summonRows: Row[] = [
  [
    'id',
    '名字',
    '召唤者',
    '生命值',
    '攻击力',
    '攻速',
    '护甲',
    '魔抗',
    '攻击距离',
    '技能名',
    '技能描述',
    '模型倍率',
  ],
];
for (const def of Object.values(SUMMON_DEFS)) {
  summonRows.push([
    def.id,
    def.name,
    def.summonOf ? (UNIT_DEFS[def.summonOf]?.name ?? def.summonOf) : '',
    def.base.hp,
    def.base.attackDamage,
    def.base.attackSpeed,
    def.base.armor,
    def.base.magicResist,
    def.base.range,
    def.skill?.name ?? '',
    def.skill?.desc ?? '',
    // ★ 0.2：棋子自己写的模型缩放（不写 = 1 = 统一高度）。只影响观感，不影响占格
    def.modelScale ?? 1,
  ]);
}

// ============================================================
//  8. 野怪回合
// ============================================================
const monsterRounds: number[] = [];
for (let round = 1; round <= 45; round++) if (isMonsterRound(round)) monsterRounds.push(round);

/** 波次表：每个野怪回合出什么（档位 × 数量，再看一眼那一波实际抽到的名字） */
const waveRows: Row[] = [
  ['★ 波次内容按《各项数值/野怪分布.txt》', '', ''],
  ['数据来源', 'packages/shared/src/monster-data.ts 的 MONSTER_WAVE_TABLE', '改波次只改那张表'],
  ['骰子', '只由回合号决定（同一个回合算多少次都是同一波）', '所以布阵预览 / 开打 / 联机两边完全一致'],
  ['深池两只', '深池伙友影刃精英 + 深池伙友卫队精英 必定同时出现', '当成"占两格的组合项"来抽'],
  ['', '', ''],
  ['回合', '波次（档位 × 数量）', '这一波实际抽到的野怪'],
  ...[1, 2, 9, 16, 23, 30, 37, 44, 51, 58, 65, 72].map((round) => {
    const wave = monsterWaveForRound(round);
    const counts = new Map<string, number>();
    for (const unit of wave) {
      const label = MONSTER_TIER_LABEL[UNIT_DEFS[unit.defId]!.monsterTier!];
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    const compos = [...counts.entries()].map(([label, n]) => `${label}×${n}`).join(' + ');
    const names = [...new Set(wave.map((u) => UNIT_DEFS[u.defId]!.name))].join('、');
    return [round, compos, names];
  }),
  ['', '', ''],
  [
    '判定写法',
    'isMonsterRound(round)',
    'round === 1 || (round - 2) % 7 === 0（即第 2 回合起每 7 回合一次）',
  ],
  ['★ 旧表里的 43 / 63', '是笔误，已按 +7 顺延成 44 / 65', '用户确认'],
  ['联机测试怎么躲开', '设 AIRNIGHT_START_ROUND=3', '避开第 1、2 回合，好验真人配对'],
];

// ============================================================
//  9. 野怪掉落
// ============================================================
/**
 * ★ 掉落按《各项数值/掉落表.txt》落在 `shared/drop-data.ts`。
 * 这里把它摊成一张能一眼核对的表 —— 玩家反馈过"掉率不对"，
 * 所以把"每一档到底怎么掷"写清楚，比藏在代码里强。
 * ★ 0.1.1：稀有组的"逐件概率"按**组内归一化**算（老件被稀释、新件拿基础档），
 *   算法只在 shared 的 `dropChanceBp` 一处 —— 别在这里重写一遍。
 */
const dropTiers: DropTier[] = ['minion', 'normal', 'elite', 'leader', 'boss'];
const itemName = (id: string): string => ITEM_DEFS[id]?.name ?? id;
/** 稀有组那张矩阵要用到的 8 件（各档位的稀有组是同 8 件、权重不同） */
const rareItems = MONSTER_DROP_TABLE.minion.groups.at(-1)!.items;

const dropRows: Row[] = [
  ['★ 按每一只被打倒的野怪各掷一次', '', ''],
  ['数据来源', 'packages/shared/src/drop-data.ts', '《各项数值/掉落表 三版.txt》（由 scripts/export-drop-table-txt.ts 生成）'],
  ['什么时候掷', '这一场真的打死了几只野怪就掷几次', '全打死就是整波；输了只算真打死的'],
  ['金币与藏品的关系', '先掷金币：中了就只给金币、不给藏品', '没中才按下面的分组掉一件'],
  ['（这个"先掷金币"是表里写的）', '小怪 45% 掉 2 金 / 普通 30% 掉 4 金', '精英以上没有金币档，必掉藏品'],
  ['', '', ''],
  ['档位', '金币', '藏品件数'],
  ...dropTiers.map((tier) => {
    const rule = MONSTER_DROP_TABLE[tier];
    const gold = rule.gold ? `${rule.gold.chanceBp / 100}% 掉 ${rule.gold.amount} 金` : '不掉金';
    const items =
      rule.guaranteed === undefined
        ? '不中金币时掉 1 件'
        : `必掉 ${rule.guaranteed} 件${rule.extraChanceBp ? ` + ${rule.extraChanceBp / 100}% 再掉 1 件` : ''}`;
    return [DROP_TIER_LABEL[tier], gold, items];
  }),
  ['', '', ''],
  ['组（权重之和 = 100%）', '', ''],
  ['档位', '各组权重', '组内成员'],
  ...dropTiers.map((tier) => {
    const groups = MONSTER_DROP_TABLE[tier].groups;
    const weights = groups.map((g) => `${g.weightBp / 100}%`).join(' / ');
    const members = groups
      .map((g) => `${g.weightsBp ? '稀有' : '均分'}：${g.items.map(itemName).join('、')}`)
      .join('  ｜  ');
    return [DROP_TIER_LABEL[tier], weights, members];
  }),
  ['', '', ''],
  ['稀有组逐件概率（%）', '与你的 txt 同口径：进入"掉物判定"后的比例', ''],
  ['（换成"每次击杀"）', '小怪再 ×55%、普通 ×70%', '精英以上没有金币档，就是这里的数'],
  ['藏品', ...dropTiers.map((tier) => DROP_TIER_LABEL[tier]), ''],
  ...rareItems.map((id) => {
    // ★ 真实概率 = 组权重 × 组内权重 ÷ 组内权重和（老件被稀释、新件按基础档）
    //   —— 算法只在 dropChanceBp 一处，导表和测试共用
    const perTier = dropTiers.map((tier) => {
      const bp = dropChanceBp(tier, id);
      return bp > 0 ? Number((bp / 100).toFixed(3)) : 0;
    });
    return [itemName(id), ...perTier, ''];
  }),
];

// ============================================================
//  10. 全局规则
// ============================================================
const ruleRows: Row[] = [
  ['项目', '数值', '说明'],
  ['每秒逻辑帧数', TICKS_PER_SECOND, '战斗按帧推进；20 帧 = 1 秒'],
  [
    '单场最长时长',
    `${MAX_BATTLE_TICKS} 帧 = ${MAX_BATTLE_TICKS / TICKS_PER_SECOND} 秒`,
    '超时按剩余血量判定胜负',
  ],
  [
    '狂暴开始',
    `${RAGE_START_TICKS} 帧 = ${RAGE_START_TICKS / TICKS_PER_SECOND} 秒`,
    '之后双方攻击力 / 攻速提升（逼平局收场）',
  ],
  [
    '强制结束',
    `${FORCE_END_TICKS} 帧 = ${FORCE_END_TICKS / TICKS_PER_SECOND} 秒`,
    '到点直接结束',
  ],
  ['法力上限（MANA_MAX）', 1000, '攒满就放技能'],
  ['每次普攻回法力', 100, '1000 ÷ 100 = 约 10 次普攻放一次技能'],
  ['受击回法力', 100, 'MANA_FROM_DAMAGE_TAKEN = 100（固定值，与伤害量无关）'],
  ['护甲减伤', '减伤 = 护甲 ÷（护甲 + 100）', '护甲 100 = 减 50%'],
  ['魔抗减伤', '同护甲公式', '魔抗 100 = 减 50%'],
  ['最大减伤', '90%', 'MAX_REDUCTION_BP = 9000'],
  ['星级成长倍率（默认）', '×1.8 / 星', '1800 bp；三星 = ×3.24'],
  ['最高等级', MAX_LEVEL, `人口上限 = 等级（${populationCap(1)}→${populationCap(MAX_LEVEL)}）`],
  ['棋盘尺寸', '10 列 × 10 行 = 100 格', '左 5 列蓝方半场，右 5 列红方半场'],
  ['蓝方可放置列', '第 0 ~ 3 列', 'TEAM_0_MAX_COL = 4'],
  ['红方可放置列', '第 5 ~ 9 列', 'TEAM_1_MIN_COL = 5'],
  ['野怪回合', `第 ${monsterRounds.slice(0, 5).join('、')} … 回合`, '第 2 回合起每 7 回合一次'],
  ['野怪星级', '永远按 1 星算（×1）', '野怪不升星，星级倍率固定 1000'],
  ['野怪羁绊', '不吃羁绊', 'traits 为空，天然被羁绊计算排除'],
  ['野怪数量', `${MONSTER_ROSTER.length} 只（5 档）`, '小怪 4 / 普通 5 / 精英 5 / 小领袖 3 / Boss 2'],
];

// ============================================================
//  10. 商店概率
// ============================================================
const shopRows: Row[] = [['等级', '1费', '2费', '3费', '4费', '5费']];
for (const [level, odds] of Object.entries(SHOP_ODDS_BY_LEVEL)) {
  const total = odds.reduce((a, b) => a + b, 0) || 1;
  shopRows.push([
    Number(level),
    `${((odds[0] / total) * 100).toFixed(0)}%`,
    `${((odds[1] / total) * 100).toFixed(0)}%`,
    `${((odds[2] / total) * 100).toFixed(0)}%`,
    `${((odds[3] / total) * 100).toFixed(0)}%`,
    `${((odds[4] / total) * 100).toFixed(0)}%`,
  ]);
}

// ============================================================
//  11. 藏品
// ============================================================

/*
  下面这些渲染函数（renderStats / renderMechanic / renderMechanics /
  renderOnEquip / renderTeamConditional / renderPerRound / renderBattleStart）
  和 RARITY_LABEL / SLOT_LABEL 都是从 `packages/shared/src/item-text.ts`
  import 进来的（见文件顶部）。★ 不要在这里再写一份 ——
  游戏界面的藏品 tooltip 用的是同一份实现，
  两边各写一份迟早会出现"表格和游戏里显示得不一样"。
*/

const itemRows: Row[] = [
  [
    '藏品id',
    '名字',
    '稀有度',
    '类型',
    '描述',
    '图标文件',
    '基础属性加成',
    '战斗机制',
    '开局效果',
    '治疗 / 复活',
    '装备时立刻结算',
    '每回合经济',
    '全队条件加成（共享藏品）',
    '全队机制（共享藏品）',
  ],
];
for (const item of Object.values(ITEM_DEFS).sort((a, b) => a.id.localeCompare(b.id))) {
  const combat = item.combat;
  const extra: string[] = [];
  if (combat?.healingBp) extra.push(`治疗效果 +${pct(combat.healingBp)}`);
  if (combat?.revive) extra.push(`阵亡时按 ${pct(combat.revive.hpBp)} 生命重生一次（${combat.revive.desc}）`);

  // 条件属性 / 条件机制：装备者带某个羁绊时才生效
  const baseStats: string[] = [];
  if (combat?.stats) baseStats.push(renderStats(combat.stats));
  if (combat?.selfTraitStats) {
    baseStats.push(`【需 ${traitName(combat.selfTraitStats.trait)} 羁绊】${renderStats(combat.selfTraitStats.stats)}`);
  }

  const mechanics: string[] = [];
  if (combat?.mechanics) mechanics.push(renderMechanics(combat.mechanics));
  if (combat?.selfTraitMechanics) {
    mechanics.push(
      `【需 ${traitName(combat.selfTraitMechanics.trait)} 羁绊】${renderMechanics(combat.selfTraitMechanics.mechanics)}`,
    );
  }

  itemRows.push([
    item.id,
    item.name,
    RARITY_LABEL[item.rarity] ?? item.rarity,
    SLOT_LABEL[item.slot] ?? item.slot,
    item.desc,
    `assets/items/${item.icon}.png`,
    baseStats.join('；'),
    mechanics.filter(Boolean).join('；'),
    renderBattleStart(item),
    extra.join('；'),
    renderOnEquip(item),
    renderPerRound(item),
    renderTeamConditional(item),
    renderMechanics(item.teamMechanics),
  ]);
}

// ============================================================
//  组装 + 写出
// ============================================================
const sheets = [
  { name: '说明', rows: guide, widths: [26, 62, 46], freezeHeader: false },
  {
    name: '干员',
    rows: operatorRows,
    widths: [9, 14, 6, 20, 9, 8, 7, 7, 7, 10, 15, 13, 13, 9, 13, 18, 56, 10, 10, 16, 44, 20],
    freezeHeader: true,
  },
  { name: '羁绊', rows: traitRows, widths: [12, 12, 7, 12, 8, 14, 8, 44], freezeHeader: true },
  {
    name: '羁绊档位',
    rows: traitTierRows,
    widths: [12, 9, 58, 26, 20, 12, 8, 44],
    freezeHeader: true,
  },
  {
    name: '野怪',
    rows: monsterRows,
    widths: [12, 20, 8, 9, 8, 7, 7, 7, 10, 15, 9, 16, 44, 20, 10, 46, 24],
    freezeHeader: true,
  },
  {
    name: '野怪档位基准',
    rows: tierBaseRows,
    widths: [10, 9, 9, 8, 7, 7, 7, 10, 15, 28],
    freezeHeader: true,
  },
  {
    name: '召唤物',
    rows: summonRows,
    widths: [16, 12, 12, 9, 8, 7, 7, 7, 10, 16, 44, 10],
    freezeHeader: true,
  },
  { name: '野怪回合', rows: waveRows, widths: [26, 40, 44], freezeHeader: false },
  { name: '野怪掉落', rows: dropRows, widths: [30, 40, 52], freezeHeader: true },
  { name: '全局规则', rows: ruleRows, widths: [24, 34, 46], freezeHeader: true },
  { name: '商店概率', rows: shopRows, widths: [8, 8, 8, 8, 8, 8], freezeHeader: true },
  {
    name: '藏品',
    rows: itemRows,
    widths: [17, 14, 8, 26, 58, 24, 34, 46, 34, 34, 46, 24, 40, 34],
    freezeHeader: true,
  },
];

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const buffer = buildXlsx(sheets);
writeFileSync(OUT_PATH, buffer);
console.log(`已导出 -> ${OUT_PATH}（${(buffer.length / 1024).toFixed(1)} KB，${sheets.length} 个工作表）`);

// ============================================================
//  自查：把刚写出来的文件全部读回来对一遍
// ============================================================
const raw = readFileSync(OUT_PATH);
if (raw.readUInt32LE(0) !== 0x04034b50) throw new Error('自查失败：文件开头不是 zip 头');
for (let i = 1; i <= sheets.length; i++) {
  if (!raw.toString('latin1').includes(`xl/worksheets/sheet${i}.xml`)) {
    throw new Error(`自查失败：找不到 sheet${i}`);
  }
}

/**
 * 读回一张表（0 = 第一张）。
 *
 * 【★ 为什么把 stdout 重定向到文件，而不用 `encoding: 'utf8'` 拿管道输出？】
 * 因为 spawnSync 走管道时，某些环境（沙箱）会直接 EBUSY、stdout 恒空。
 * 重定向到文件再读回来是稳的 —— 这个坑在别处已经踩过一次了。
 */
const readSheet = (index: number): string => {
  const tmp = `scripts/tmp-read-${index}.txt`;
  const fd = openSync(tmp, 'w');
  try {
    execFileSync(process.execPath, ['scripts/read-xlsx.mjs', OUT_PATH, String(index)], {
      stdio: ['ignore', fd, 'ignore'],
    });
  } finally {
    closeSync(fd);
  }
  const text = readFileSync(tmp, 'utf8');
  rmSync(tmp, { force: true });
  return text;
};

let problems = 0;
for (let i = 0; i < sheets.length; i++) {
  const dump = readSheet(i + 1);
  const lines = dump.split('\n').filter((line) => line.startsWith('['));
  const sheet = sheets[i]!;
  // 读取器会跳过全空行，所以按"非空行数"核对
  const expected = sheet.rows.filter((row) => row.some((cell) => cell !== '')).length;
  const ok = lines.length === expected;
  if (!ok) problems++;
  console.log(
    `  ${ok ? '✓' : '✗'} ${sheet.name.padEnd(12)} ${String(lines.length).padStart(3)} 行` +
      (ok ? '' : `（应为 ${expected} 行）`),
  );
}

if (problems > 0) throw new Error(`自查失败：${problems} 张表的行数对不上`);

// 抽查：干员表第一行数据的名字/血量必须和代码里一致
const firstOp = playableDefs().sort((a, b) => a.id.localeCompare(b.id))[0]!;
const opDump = readSheet(2);
if (!opDump.includes(firstOp.name) || !opDump.includes(String(firstOp.base.hp))) {
  throw new Error(`自查失败：干员表里找不到 ${firstOp.name} / ${firstOp.base.hp}`);
}
// 抽查：野怪表必须包含最肉的 Boss（验证"档位基准 + 个体覆盖"合并正确）
const bossHp = monsterDefs()
  .map((d) => d.base.hp)
  .reduce((a, b) => Math.max(a, b), 0);
if (!readSheet(5).includes(String(bossHp))) {
  throw new Error(`自查失败：野怪表里找不到最大血量 ${bossHp}`);
}
// 抽查：藏品表最后一张，必须同时出现普通和进阶各一件的名字（验证稀有度分组没错位）
const itemDump = readSheet(sheets.length);
for (const sample of [NORMAL_ITEMS[0]!, ADVANCED_ITEMS[0]!]) {
  if (!itemDump.includes(sample.name)) {
    throw new Error(`自查失败：藏品表里找不到 ${sample.name}`);
  }
}

console.log('');
console.log(`自查通过：${sheets.length} 张表全部能被解析，行数与抽查单元格都对得上`);
console.log(
  `  干员 ${playableDefs().length} 名 / 羁绊 ${Object.keys(TRAIT_DEFS).length} 个（${traitTierRows.length - 1} 个档位）/ 野怪 ${monsterRows.length - 1} 只 / 召唤物 ${summonRows.length - 1} 个 / 藏品 ${itemRows.length - 1} 件`,
);
