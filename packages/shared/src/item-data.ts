import { TRAIT_DEFS } from './trait-data.js';
import type { ItemDef, ItemDefTable } from './types.js';

/**
 * ============================================================
 *  藏品表（装备）
 * ============================================================
 *
 * **这一版的数据全部来自你给的《藏品.txt》**（普通 20 件 + 进阶 16 件 = 36 件），
 * 不是我编的占位。文字描述保留了你原文的措辞，方便对照。
 *
 * ============================================================
 *  两种类型（`slot`）
 * ============================================================
 *  | slot | 内部代号 | 界面上叫什么 | 装在哪            | 上限    | 作用对象   |
 *  |------|----------|--------------|-------------------|---------|------------|
 *  | 'A'  | A 类     | **穿戴藏品** | 拖到**干员**身上  | 2 件/人 | 那一个干员 |
 *  | 'B'  | B 类     | **共享藏品** | 拖到**共享装备位**| 4 件    | 全队       |
 *
 *  ★★ A / B 只是**分类代号**（同时也是数据里的 `slot` 值），
 *    界面上一个字都不许出现 —— 对外一律叫「穿戴藏品 / 共享藏品」。
 *    "玩家看到的字"由一处集中产出：
 *      · 界面小徽章 / tooltip  -> packages/shared/src/item-text.ts 的
 *        `ITEM_SLOT_SHORT` / `ITEM_SLOT_LABEL`
 *      · 三条栏目的名字        -> apps/web/src/game/items.ts 的 `zoneLabel()`
 *    所以下面备注里写"A 类"是给开发者看的，别照着往界面文案里抄。
 *
 * ============================================================
 *  `onEquip`：装备那一刻的一次性结算
 * ============================================================
 *  | 字段 | 含义 |
 *  |---|---|
 *  | `consume`   | 立刻销毁（结算完就从格子消失，不占位置） |
 *  | `require`   | 只能装备给满足条件的干员（如"只能装备给 1 星"） |
 *  | `gold`/`hp` | 直接给玩家金币 / 血量 |
 *  | `popCap`    | 人口上限 +N（地形图）。**不销毁**时会一直生效，卸下就没了 |
 *  | `permanent` | 本局永久效果（失落之钥） |
 *  | `prep`      | 备战类操作：复制一星干员 / 升星 / 变高一费 |
 *
 * ============================================================
 *  `combat`：战斗中的加成
 * ============================================================
 *  | 字段 | 含义 |
 *  |---|---|
 *  | `stats`              | 无条件属性（复用技能那套 SkillStats） |
 *  | `selfTraitStats`     | 装备者带某羁绊时才加的属性（炎国短刃） |
 *  | `selfTraitMechanics` | 装备者带某羁绊时才加的机制（铳骑之威的斩杀） |
 *  | `mechanics`          | 战斗机制（每 N 击爆发、远程减伤、击杀掉金…） |
 *  | `battleStart`        | 开局类效果（奥数法阵的"回合开始 +10 魔抗"） |
 *  | `healingBp`          | 治疗效果提升 |
 *  | `manaGainBp`         | 技力回复提升（迅捷作战粮 +50%） |
 *  | `revive`             | 阵亡时站起来一次（M3茧甲） |
 *
 * ============================================================
 *  `teamConditional` / `teamMechanics` / `perRound`：B 类专属
 * ============================================================
 *  `teamConditional` 是**按每个干员自己的属性**或**玩家场外状态**算条件加成
 *  （费用 ≤3、射程 >3、每激活一个羁绊、每 5 金币、血量低于 30），
 *  全部在"组阵容那一刻"折成固定值，战斗内核只读结果。
 *  `teamMechanics` 是队伍级的战斗行为（减伤 / 周期回血 / 开局免疫 / 开局削抗）。
 *  `perRound` 是每回合的经济（至宝指环 / 幸运硬币）。
 *
 * ============================================================
 *  数值单位速查（和技能、羁绊完全一致）
 * ============================================================
 *   attackDamageBp / attackSpeedBp / hpBp / lifestealBp / healingBp  都是万分比
 *     -> 1000 = 10%、5000 = 50%
 *   armorFlat / magicResistFlat / hpFlat                             绝对值
 *     -> 15 = +15 护甲、500 = +500 生命上限
 *   durationTicks                                                    tick 数（20 tick = 1 秒）
 *     -> 300 = 15 秒、200 = 10 秒
 */
export const ITEM_DEFS: ItemDefTable = {
  // ============================================================
  //  普通藏品
  // ============================================================

  // ---------------- 普通 · A 类（可穿戴）----------------

  itm_solvent: {
    id: 'itm_solvent',
    name: '源石溶剂',
    rarity: 'normal',
    slot: 'A',
    icon: 'itm_solvent',
    desc: '使干员攻击提升 10%，获得 10% 吸血',
    combat: { stats: { attackDamageBp: 1000, lifestealBp: 1000 } },
  },

  itm_yan_blade: {
    id: 'itm_yan_blade',
    name: '炎国短刃',
    rarity: 'normal',
    slot: 'A',
    icon: 'itm_yan_blade',
    desc: '使干员攻击力提升 12%，若装备者为炎羁绊额外提升 8%',
    combat: {
      stats: { attackDamageBp: 1200 },
      selfTraitStats: { trait: 'yan', stats: { attackDamageBp: 800 } },
    },
  },

  itm_bulwark: {
    id: 'itm_bulwark',
    name: '坚守盾牌',
    rarity: 'normal',
    slot: 'A',
    icon: 'itm_bulwark',
    desc: '使干员物抗 +15，魔抗 +15',
    combat: { stats: { armorFlat: 15, magicResistFlat: 15 } },
  },

  itm_goliath_helm: {
    id: 'itm_goliath_helm',
    name: '歌利亚头盔',
    rarity: 'normal',
    slot: 'A',
    icon: 'itm_goliath_helm',
    desc: '使干员提升 500 最大生命值，物抗 +5',
    combat: { stats: { hpFlat: 500, armorFlat: 5 } },
  },

  itm_arcane_array: {
    id: 'itm_arcane_array',
    name: '奥数法阵',
    rarity: 'normal',
    slot: 'A',
    icon: 'itm_arcane_array',
    desc: '使干员魔抗 +20，并且回合开始时额外获得 10 点魔抗，持续 15 秒',
    combat: {
      stats: { magicResistFlat: 20 },
      // 开局给自己挂一个 15 秒的 +10 魔抗（20 tick = 1 秒 -> 300 tick = 15 秒）
      battleStart: [{ kind: 'buff', target: 'self', stats: { magicResistFlat: 10 }, durationTicks: 300 }],
    },
  },

  itm_dormant_spawn: {
    id: 'itm_dormant_spawn',
    name: '休眠子裔',
    rarity: 'normal',
    slot: 'A',
    icon: 'itm_dormant_spawn',
    desc: '使干员获得 20% 吸血，且每 3 秒回复最大生命值 5% 的生命值',
    combat: {
      stats: {
        lifestealBp: 2000,
        // 每 3 秒（60 tick）给自己回 5% 最大生命。radius 0 = 只作用自己
        pulse: {
          intervalTicks: 60,
          radius: 0,
          affect: 'allies',
          heal: { basis: 'casterMaxHp', ratioBp: 500 },
        },
      },
    },
  },

  itm_accelerator: {
    id: 'itm_accelerator',
    name: '有限加速器',
    rarity: 'normal',
    slot: 'A',
    icon: 'itm_accelerator',
    desc: '干员攻击时提升 2% 攻击速度，上限 100%',
    combat: {
      // 每次攻击 +200bp（2%），最多 50 层 = 100%
      mechanics: [{ kind: 'rampSpeed', perAttackBp: 200, maxStacks: 50 }],
    },
  },

  itm_blast_shield: {
    id: 'itm_blast_shield',
    name: '防爆盾',
    rarity: 'normal',
    slot: 'A',
    icon: 'itm_blast_shield',
    desc: '干员被距离自己 2 格以上的敌人攻击时受到的伤害 -30%',
    combat: {
      mechanics: [{ kind: 'farAttackReduction', minDistance: 2, ratioBp: 3000 }],
    },
  },

  itm_m3_cocoon: {
    id: 'itm_m3_cocoon',
    name: 'M3 茧甲',
    rarity: 'normal',
    slot: 'A',
    icon: 'itm_m3_cocoon',
    desc: '干员生命值提升 200，干员死亡时重生一次（一回合只能触发一次）',
    combat: {
      stats: { hpFlat: 200 },
      // 满血站起来（hpBp 10000 = 100%）
      revive: { hpBp: 10000, desc: '茧甲破裂 · 重生' },
    },
  },

  itm_raid_grenade: {
    id: 'itm_raid_grenade',
    name: '突袭手雷',
    rarity: 'normal',
    slot: 'A',
    icon: 'itm_raid_grenade',
    desc: '干员每 3 下攻击使下一次攻击造成的伤害提升 70%',
    combat: {
      // 每 3 次普攻挂一个"仅 1 次"的 +70% 攻击力包，用完就掉
      mechanics: [{ kind: 'everyNthAttack', every: 3, stats: { attackDamageBp: 7000 }, attacks: 1 }],
    },
  },

  itm_ration: {
    id: 'itm_ration',
    name: '迅捷作战粮',
    rarity: 'normal',
    slot: 'A',
    icon: 'itm_ration',
    desc: '干员获得攻击 / 受击 / 技能回复量提升 50%',
    /*
      ★★ 0.3.2 修（用户报"描述和效果不一致"）：
      卡面写的是**技力回复量**（攻击 / 受击 / 自动回复三条路），
      数据里却写成了 `healingBp`（治疗量 +50%）—— 效果完全跑偏。
      现在改成 `manaGainBp`，由 `gainMana` 这个唯一入口乘上去。
    */
    combat: { manaGainBp: 5000 },
  },

  // ---------------- 普通 · B 类（共享）----------------

  itm_terrain_map: {
    id: 'itm_terrain_map',
    name: '地形图',
    rarity: 'normal',
    slot: 'B',
    icon: 'itm_terrain_map',
    desc: '可以获得一人口上限',
    // 不销毁：装备期间一直 +1 人口，卸下就还回去
    onEquip: { popCap: 1 },
  },

  itm_old_coin: {
    id: 'itm_old_coin',
    name: '古旧残币',
    rarity: 'normal',
    slot: 'B',
    icon: 'itm_old_coin',
    desc: '装备后立刻销毁，并使玩家获得 10 金币',
    onEquip: { consume: true, gold: 10 },
  },

  itm_lucky_coin: {
    id: 'itm_lucky_coin',
    name: '幸运硬币',
    rarity: 'normal',
    slot: 'B',
    icon: 'itm_lucky_coin',
    desc: '每回合结束后触发连败时获得 1 金币',
    perRound: { goldOnLossStreak: 1 },
  },

  itm_kettle: {
    id: 'itm_kettle',
    name: '热水壶',
    rarity: 'normal',
    slot: 'B',
    icon: 'itm_kettle',
    desc: '装备后立刻销毁，并使玩家获得 5 生命值和 5 金币',
    onEquip: { consume: true, hp: 5, gold: 5 },
  },

  itm_fate_mask: {
    id: 'itm_fate_mask',
    name: '奇缘面具',
    rarity: 'normal',
    slot: 'B',
    icon: 'itm_fate_mask',
    desc: '装备后我方干员受到的所有伤害降低 10%',
    teamMechanics: [{ kind: 'damageReduction', ratioBp: 1000 }],
  },

  itm_emperor_favor: {
    id: 'itm_emperor_favor',
    name: '皇帝的恩宠',
    rarity: 'normal',
    slot: 'B',
    icon: 'itm_emperor_favor',
    desc: '装备后我方 1、2、3 费干员攻击力提升 20%',
    teamConditional: [{ kind: 'costAtMost', cost: 3, stats: { attackDamageBp: 2000 } }],
  },

  itm_silver_fork: {
    id: 'itm_silver_fork',
    name: '银餐叉',
    rarity: 'normal',
    slot: 'B',
    icon: 'itm_silver_fork',
    desc: '装备后攻击距离大于 3 的干员攻击力提升 20%',
    teamConditional: [{ kind: 'rangeGreaterThan', range: 3, stats: { attackDamageBp: 2000 } }],
  },

  itm_medkit: {
    id: 'itm_medkit',
    name: '急救药箱',
    rarity: 'normal',
    slot: 'B',
    icon: 'itm_medkit',
    desc: '装备后全部我方干员每 3 秒回复 100 生命值',
    teamMechanics: [{ kind: 'teamRegen', intervalTicks: 60, amount: 100 }],
  },

  itm_pill: {
    id: 'itm_pill',
    name: '药枚',
    rarity: 'normal',
    slot: 'B',
    icon: 'itm_pill',
    desc: '装备后回合开始时我方全部干员获得一次免疫伤害的护盾',
    teamMechanics: [{ kind: 'startTeamImmunity', hits: 1 }],
  },

  // ============================================================
  //  进阶藏品
  // ============================================================

  // ---------------- 进阶 · A 类（可穿戴）----------------

  itm_dual_arm: {
    id: 'itm_dual_arm',
    name: '双模机械臂',
    rarity: 'advanced',
    slot: 'A',
    icon: 'itm_dual_arm',
    desc: '干员攻击力 +30%，攻击时附带攻击力 50% 的法术伤害',
    combat: {
      stats: { attackDamageBp: 3000 },
      // scale 'dealt' = 按"这一击打出的伤害"的 50% 追加法术伤害
      mechanics: [{ kind: 'onHitDamage', ratioBp: 5000, damageType: 'magic', scale: 'dealt' }],
    },
  },

  itm_mimic_mass: {
    id: 'itm_mimic_mass',
    name: '拟态物质',
    rarity: 'advanced',
    slot: 'A',
    icon: 'itm_mimic_mass',
    desc: '装备后立刻销毁，然后使玩家获得一只与装备干员相同的一星干员（不计入牌库，备战席有空位时才能使用）',
    onEquip: { consume: true, prep: { kind: 'cloneOneStar' } },
  },

  itm_doctor_projection: {
    id: 'itm_doctor_projection',
    name: '博士投影',
    rarity: 'advanced',
    slot: 'A',
    icon: 'itm_doctor_projection',
    desc: '只能装备给 1 星干员，装备后立刻消耗，干员提升至 2 星（多出来的干员不计入牌库）',
    onEquip: {
      consume: true,
      require: { minStar: 1, maxStar: 1 },
      prep: { kind: 'upgradeStar' },
    },
  },

  itm_mutant_cell: {
    id: 'itm_mutant_cell',
    name: '突变细胞',
    rarity: 'advanced',
    slot: 'A',
    icon: 'itm_mutant_cell',
    desc: '装备后立刻销毁，使干员变为同星级的高一费的随机干员，5 费干员变为随机 5 费干员',
    onEquip: { consume: true, prep: { kind: 'transformCostUp' } },
  },

  itm_pegasus_helm: {
    id: 'itm_pegasus_helm',
    name: '天马之盔',
    rarity: 'advanced',
    slot: 'A',
    icon: 'itm_pegasus_helm',
    desc: '使干员生命值提升 1000，并额外提升 30% 最大生命值',
    combat: { stats: { hpFlat: 1000, hpBp: 3000 } },
  },

  itm_rider_might: {
    id: 'itm_rider_might',
    name: '铳骑之威',
    rarity: 'advanced',
    slot: 'A',
    icon: 'itm_rider_might',
    desc: '使干员提升 50% 攻击速度，击杀敌人时有 20% 获得一金币，若装备者为拉特兰羁绊则攻击时额外斩杀生命值低于 5% 的敌人',
    combat: {
      stats: { attackSpeedBp: 5000 },
      mechanics: [{ kind: 'goldOnKill', chanceBp: 2000, gold: 1 }],
      selfTraitMechanics: { trait: 'laterano', mechanics: [{ kind: 'execute', thresholdBp: 500 }] },
    },
  },

  itm_sand_compass: {
    id: 'itm_sand_compass',
    name: '黄沙罗盘',
    rarity: 'advanced',
    slot: 'A',
    icon: 'itm_sand_compass',
    desc: '使干员双抗提升 25，在死亡时有 50% 概率获得一金币',
    combat: {
      stats: { armorFlat: 25, magicResistFlat: 25 },
      mechanics: [{ kind: 'goldOnDeath', chanceBp: 5000, gold: 1 }],
    },
  },

  itm_knight_oath: {
    id: 'itm_knight_oath',
    name: '骑士戒律',
    rarity: 'advanced',
    slot: 'A',
    icon: 'itm_knight_oath',
    desc: '使干员开启技能时攻击力提升 50%，攻击速度提升 50%，持续 10 秒（10 秒内只触发一次，不可叠加）',
    combat: {
      // "10 秒内只触发一次"：还在生效中就直接跳过 —— 不叠加、也不刷新时效，由 onCastBuff 的实现保证
      mechanics: [
        { kind: 'onCastBuff', stats: { attackDamageBp: 5000, attackSpeedBp: 5000 }, durationTicks: 200 },
      ],
    },
  },

  // ---------------- 进阶 · B 类（共享）----------------

  itm_flawless_jade: {
    id: 'itm_flawless_jade',
    name: '无瑕宝玉',
    rarity: 'advanced',
    slot: 'B',
    icon: 'itm_flawless_jade',
    desc: '装备后立刻销毁，并使玩家获得 30 金币',
    onEquip: { consume: true, gold: 30 },
  },

  itm_treasure_ring: {
    id: 'itm_treasure_ring',
    name: '至宝指环',
    rarity: 'advanced',
    slot: 'B',
    icon: 'itm_treasure_ring',
    desc: '装备后回合结束时额外获得 1 金币',
    perRound: { gold: 1 },
  },

  itm_blood_bed: {
    id: 'itm_blood_bed',
    name: '血魔的寝床',
    rarity: 'advanced',
    slot: 'B',
    icon: 'itm_blood_bed',
    desc: '装备后立刻销毁，并使玩家获得 15 血量',
    onEquip: { consume: true, hp: 15 },
  },

  itm_lost_key: {
    id: 'itm_lost_key',
    name: '失落之钥',
    rarity: 'advanced',
    slot: 'B',
    icon: 'itm_lost_key',
    desc: '装备后立刻销毁，且当前玩家无法再次获得。获得单局永久效果：金币升级时额外获得 1 点经验，且玩家到达十级后获得 50 金币',
    onEquip: { consume: true, permanent: 'lostKey' },
  },

  itm_rosemary_embrace: {
    id: 'itm_rosemary_embrace',
    name: '迷迭香之拥',
    rarity: 'advanced',
    slot: 'B',
    icon: 'itm_rosemary_embrace',
    desc: '装备后回合开始时敌方所有单位减少 25% 双抗',
    teamMechanics: [{ kind: 'startEnemyShred', armorBp: 2500, magicResistBp: 2500 }],
  },

  itm_old_fan: {
    id: 'itm_old_fan',
    name: '老蒲扇',
    rarity: 'advanced',
    slot: 'B',
    icon: 'itm_old_fan',
    desc: '装备后我方每激活一个不同的羁绊，所有我方干员攻击力 +10%',
    // 按"激活了几个不同羁绊"放大：每层 +1000bp（10%）
    teamConditional: [{ kind: 'perActiveTrait', stats: { attackDamageBp: 1000 } }],
  },

  itm_gin_cup: {
    id: 'itm_gin_cup',
    name: '金酒之杯',
    rarity: 'advanced',
    slot: 'B',
    icon: 'itm_gin_cup',
    desc: '装备后玩家每有 5 金币，全部干员提升 3% 攻速，上限 200%',
    // 每 5 金一层 +300bp（3%），总加成封顶 20000bp（200%）
    teamConditional: [{ kind: 'perGold', perGold: 5, stats: { attackSpeedBp: 300 }, capBp: 20000 }],
  },

  itm_emperor_gun: {
    id: 'itm_emperor_gun',
    name: '皇帝的新枪',
    rarity: 'advanced',
    slot: 'B',
    icon: 'itm_emperor_gun',
    desc: '装备后玩家血量低于 30 时，全部我方干员攻击力 +30%，攻击速度 +30%',
    teamConditional: [
      { kind: 'lowHp', hpBelow: 30, stats: { attackDamageBp: 3000, attackSpeedBp: 3000 } },
    ],
  },

  // ============================================================
  //  ★ 0.1.1「藏品二版」（来自《各项数值/藏品二版.txt》）
  // ============================================================
  //
  // 【这一批的两类新东西】
  //   1. **跨回合成长**（`growth`）—— 仇名录按击杀、佣兵的饰物/家常小炒按胜场、
  //      黑流树海笔记按回合、圆石祭坛按战斗、悲伤的红按"未装载的藏品数"。
  //      层数由客户端累计（只有它知道上一场赢没赢、杀了几个），组阵容时交上来。
  //   2. **按回合成长的召唤物**（`summonGrowth`）—— 支援防暴桩的假人、天师锦囊的炎佑。
  //      内核不知道第几回合，所以由解析层算好数值再塞进 `startSummon`。

  // ---------------- 二版 · 普通 · A 类（穿戴）----------------

  itm_bloody_dictionary: {
    id: 'itm_bloody_dictionary',
    name: '染血辞典',
    rarity: 'normal',
    slot: 'A',
    icon: 'itm_bloody_dictionary',
    desc: '干员生命值低于 10% 时，仅一次立刻获得最大生命 50% 的护盾（护盾持续 10 秒）',
    combat: {
      // 1000 = 10% 血线；5000 = 最大生命的 50%；200 tick = 10 秒
      mechanics: [{ kind: 'lowHpShield', hpBelowBp: 1000, shieldBp: 5000, durationTicks: 200 }],
    },
  },

  itm_dancer_bracelet: {
    id: 'itm_dancer_bracelet',
    name: '舞者手链',
    rarity: 'normal',
    slot: 'A',
    icon: 'itm_dancer_bracelet',
    desc: '装备者获得 10% 物理与法术闪避',
    // evasionBp = 通用闪避（物理法术都躲）—— 正好等于"物理与法术闪避各 10%"
    combat: { stats: { evasionBp: 1000 } },
  },

  itm_designer_ruler: {
    id: 'itm_designer_ruler',
    name: '设计师量尺',
    rarity: 'normal',
    slot: 'A',
    icon: 'itm_designer_ruler',
    desc: '装备者获得 15% 物理闪避',
    combat: { stats: { evasionPhysicalBp: 1500 } },
  },

  itm_mage_slayer: {
    id: 'itm_mage_slayer',
    name: '“法术杀手”',
    rarity: 'normal',
    slot: 'A',
    icon: 'itm_mage_slayer',
    desc: '装备者获得 15% 法术闪避',
    combat: { stats: { evasionMagicBp: 1500 } },
  },

  itm_gaul_check: {
    id: 'itm_gaul_check',
    name: '高卢银行支票',
    rarity: 'normal',
    slot: 'A',
    icon: 'itm_gaul_check',
    desc: '装备者干员的回合开始时初始能量条为最大值的一半（被动技能无效）',
    combat: { stats: { initialManaBp: 5000 } },
  },

  // ---------------- 二版 · 普通 · B 类（共享）----------------

  itm_hr_bronze_seal: {
    id: 'itm_hr_bronze_seal',
    name: '人事部铜印',
    rarity: 'normal',
    slot: 'B',
    icon: 'itm_hr_bronze_seal',
    desc: '装备后立刻销毁，从牌库随机招募 1 名 1~3 费干员；该费用区抽完了就改为发金币（一次性道具）',
    onEquip: { consume: true, prep: { kind: 'recruitRandom', minCost: 1, maxCost: 3 } },
  },

  itm_riot_bunker: {
    id: 'itm_riot_bunker',
    name: '支援防暴桩',
    rarity: 'normal',
    slot: 'B',
    icon: 'itm_riot_bunker',
    desc: '在场上召唤两名假人，假人生命随回合阶段性增加（初始 1000，第 5 回合后 +300，第 15 回合后再 +600，最高 1900），假人不移动不攻击，获得嘲讽效果',
    teamMechanics: [{ kind: 'startSummon', summonId: 'summon_dummy', count: 2 }],
    summonGrowth: {
      hp: 1000,
      attackDamage: 0,
      milestones: [
        { atRound: 5, hp: 300 },
        { atRound: 15, hp: 600 },
      ],
      maxHp: 1900,
    },
  },

  itm_live_rose: {
    id: 'itm_live_rose',
    name: '活玫瑰',
    rarity: 'normal',
    slot: 'B',
    icon: 'itm_live_rose',
    desc: '所有我方单位受到的治疗和生命回复效果 +8%',
    teamMechanics: [{ kind: 'teamHealingBp', ratioBp: 800 }],
  },

  // ---------------- 二版 · 进阶 · A 类（穿戴）----------------

  itm_grudge_list: {
    id: 'itm_grudge_list',
    name: '仇名录',
    rarity: 'advanced',
    slot: 'A',
    icon: 'itm_grudge_list',
    desc: '干员的攻击力 +2%，每击倒一名敌人（野怪不算）永久额外 +1%（最高 +150%），效果不会因为新回合而重置，装备被卸下时加成失效并重置',
    combat: { stats: { attackDamageBp: 200 } },
    // 每层 +1% 攻击力，最多 150 层（= +150%）
    growth: { source: 'kill', perLayer: { attackDamageBp: 100 }, maxStacks: 150, label: '每击倒一名敌人 +1% 攻击力', resetOnUnequip: true },
  },

  itm_sad_red: {
    id: 'itm_sad_red',
    name: '悲伤的红',
    rarity: 'advanced',
    slot: 'A',
    icon: 'itm_sad_red',
    desc: '每有 1 个未装载的藏品（藏品栏上的装备数量），使装备者的生命和攻击力 +8%',
    // 层数 = 藏品栏里还没装载的藏品数量（不走累计，实时取）
    growth: {
      source: 'emptySlot',
      perLayer: { hpBp: 800, attackDamageBp: 800 },
      maxStacks: 15,
      label: '每 1 个未装载的藏品 +8% 生命 / 攻击力',
    },
  },

  itm_mercenary_trinket: {
    id: 'itm_mercenary_trinket',
    name: '佣兵的饰物',
    rarity: 'advanced',
    slot: 'A',
    icon: 'itm_mercenary_trinket',
    desc: '使干员的攻击力、防御力、最大生命值 +5%，且每次胜利后额外 +5%（最多叠加 10 层），效果不会因为新回合而重置，装备卸下后层数重新叠加',
    combat: { stats: { attackDamageBp: 500, armorBp: 500, magicResistBp: 500, hpBp: 500 } },
    growth: {
      source: 'win',
      perLayer: { attackDamageBp: 500, armorBp: 500, magicResistBp: 500, hpBp: 500 },
      maxStacks: 10,
      label: '每胜利一场 +5% 攻击 / 防御 / 生命（上限 10 层）',
      resetOnUnequip: true,
    },
  },

  itm_fist_three_questions: {
    id: 'itm_fist_three_questions',
    name: '《拳经三问》',
    rarity: 'advanced',
    slot: 'A',
    icon: 'itm_fist_three_questions',
    /*
      ★★ 0.3.2（用户）：效果改成**跨回合成长**。
      以前是 `onCastRamp` —— 一场里每开一次技能 +5%（最高 20 层），
      但**战斗一结束就清零**，下一场从 0 开始，一件"进阶"藏品基本吃不满。
      现在走 `growth.source: 'round'`：每过一回合 +5% 攻击力，跨回合累积，上限 20 层；
      卸下装备清零（和仇名录 / 佣兵的饰物同一套口径）。
    */
    desc: '干员每经过一个回合，自身攻击力 +5%，最多叠加 20 层（跨回合累积，卸下即清零）',
    // ★ growth 住在 ItemDef 顶层（和仇名录 / 佣兵的饰物一样），不在 combat 里
    growth: {
      source: 'round',
      perLayer: { attackDamageBp: 500 },
      maxStacks: 20,
      label: '每回合 +5% 攻击力（上限 20 层）',
      resetOnUnequip: true,
    },
  },

  itm_spicy_cocoa: {
    id: 'itm_spicy_cocoa',
    name: '热辣可可',
    rarity: 'advanced',
    slot: 'A',
    icon: 'itm_spicy_cocoa',
    desc: '干员生命值越低，攻击力越高，30% 生命值时达到最大可提升攻击力（+100%）',
    combat: { mechanics: [{ kind: 'lowHpAttack', hpThresholdBp: 3000, maxBonusBp: 10000 }] },
  },

  itm_painkiller: {
    id: 'itm_painkiller',
    name: '止痛片',
    rarity: 'advanced',
    slot: 'A',
    icon: 'itm_painkiller',
    desc: '干员生命值越低，技力恢复速度越快，30% 生命值时达到最大恢复速度（+2/s）',
    combat: { mechanics: [{ kind: 'lowHpManaRegen', hpThresholdBp: 3000, maxPerSecond: 2 }] },
  },

  itm_horn_ang: {
    id: 'itm_horn_ang',
    name: '岩角号',
    rarity: 'advanced',
    slot: 'A',
    icon: 'itm_horn_ang',
    desc: '战斗开始时，干员周围 4 格每有一名干员，攻击力 +10%（战斗开始后增益不会变动）',
    combat: { mechanics: [{ kind: 'startSurroundAttack', perAllyBp: 1000 }] },
  },

  itm_blaze_saw: {
    id: 'itm_blaze_saw',
    name: 'Blaze 的电锯',
    rarity: 'advanced',
    slot: 'A',
    icon: 'itm_blaze_saw',
    desc: '所有敌方单位受到装备者伤害时，距离伤害来源越近受到的伤害越高（4 格 - 1 格依次增加 20%，最高 80%）',
    combat: { mechanics: [{ kind: 'distanceBonus', mode: 'near', perCellBp: 2000, maxBp: 8000 }] },
  },

  itm_scout_scope: {
    id: 'itm_scout_scope',
    name: 'Scout 的狙击镜',
    rarity: 'advanced',
    slot: 'A',
    icon: 'itm_scout_scope',
    desc: '所有敌方单位受到装备者伤害时，距离伤害来源越远受到的伤害越高（1 格 - 4 格依次增加 20%，最高 80%）',
    combat: { mechanics: [{ kind: 'distanceBonus', mode: 'far', perCellBp: 2000, maxBp: 8000 }] },
  },

  itm_stimulant: {
    id: 'itm_stimulant',
    name: '紧急活性剂',
    rarity: 'advanced',
    slot: 'A',
    icon: 'itm_stimulant',
    desc: '干员生命值越低，攻击速度越快，30% 生命值时达到最大可提升攻击速度（+80%）',
    combat: { mechanics: [{ kind: 'lowHpSpeed', hpThresholdBp: 3000, maxBonusBp: 8000 }] },
  },

  itm_econ_reform: {
    id: 'itm_econ_reform',
    name: '《第二经济改革法》',
    rarity: 'advanced',
    slot: 'A',
    icon: 'itm_econ_reform',
    desc: '装备者干员的回合开始时初始能量条为最大值（被动技能无效）',
    combat: { stats: { initialManaBp: 10000 } },
  },

  itm_home_stirfry: {
    id: 'itm_home_stirfry',
    name: '家常小炒',
    rarity: 'advanced',
    slot: 'A',
    icon: 'itm_home_stirfry',
    desc: '干员的生命值 +20%，攻击力 +20%；每胜利一把，效果额外提升 5%，最高叠加 5 层，效果不会因为新回合而重置，装备卸下层数重置',
    combat: { stats: { hpBp: 2000, attackDamageBp: 2000 } },
    growth: {
      source: 'win',
      perLayer: { hpBp: 500, attackDamageBp: 500 },
      maxStacks: 5,
      label: '每胜利一场 +5% 生命 / 攻击力（上限 5 层）',
      resetOnUnequip: true,
    },
  },

  // ---------------- 二版 · 进阶 · B 类（共享）----------------

  itm_doc_silver_seal: {
    id: 'itm_doc_silver_seal',
    name: '博士银印',
    rarity: 'advanced',
    slot: 'B',
    icon: 'itm_doc_silver_seal',
    desc: '装备后立刻销毁，从牌库随机招募 1 名 4~5 费干员；该费用区抽完了就改为发金币（一次性道具）',
    onEquip: { consume: true, prep: { kind: 'recruitRandom', minCost: 4, maxCost: 5 } },
  },

  itm_blackflow_notes: {
    id: 'itm_blackflow_notes',
    name: '黑流树海笔记',
    rarity: 'advanced',
    slot: 'B',
    icon: 'itm_blackflow_notes',
    desc: '每回合叠加 1 层，每 5 层使战斗胜利后有 1% 概率额外获得 1 金币，概率效果不会因为新回合而重置，装备卸下后层数重新叠加',
    // 纯经济效果：层数由客户端累计（每回合 +1），金币在回合结算时发。
    perRound: { growthGoldChance: { layersPerStep: 5, percentPerStep: 1, gold: 1 } },
    growth: {
      source: 'round',
      maxStacks: 999,
      label: '每回合 +1 层，每 5 层带来 1% 的额外金币概率',
      resetOnUnequip: true,
    },
  },

  itm_pebble_altar: {
    id: 'itm_pebble_altar',
    name: '圆石祭坛',
    rarity: 'advanced',
    slot: 'B',
    icon: 'itm_pebble_altar',
    desc: '战斗结束（野怪回合不算）后有 3.25% 概率使所有我方单位的攻击力和防御力永久 +5%（最多叠加 10 层），效果不会因为新回合而重置，装备卸下后层数重新叠加',
    growth: {
      source: 'battle',
      // 战斗结束（野怪回合不算）后 3.25% 概率 +1 层
      chanceBp: 325,
      perLayer: { attackDamageBp: 500, armorBp: 500, magicResistBp: 500 },
      maxStacks: 10,
      label: '每层 +5% 攻击 / 防御（上限 10 层）',
      resetOnUnequip: true,
    },
  },

  itm_celestial_pouch: {
    id: 'itm_celestial_pouch',
    name: '天师锦囊',
    rarity: 'advanced',
    slot: 'B',
    icon: 'itm_celestial_pouch',
    desc: '战斗开始召唤一只【炎佑】（不参与羁绊构建）：大炎羁绊激活时，它的属性 +30%（基础：生命 500、攻击 100、双抗 0、攻速 1.0；第 5 回合生命 +500 攻击 +30，第 15 回合再 +500 / +30）',
    teamMechanics: [{ kind: 'startSummon', summonId: 'summon_yanyou', count: 1 }],
    summonGrowth: {
      hp: 500,
      attackDamage: 100,
      milestones: [
        { atRound: 5, hp: 500, attackDamage: 30 },
        { atRound: 15, hp: 500, attackDamage: 30 },
      ],
      // 「大炎羁绊开着，炎佑才 +30%」—— 炎佑自己不参与羁绊的构建（用户口径）
      requireTrait: 'yan',
      statBp: 13000,
    },
  },

  itm_sword_hammer: {
    id: 'itm_sword_hammer',
    name: '“剑锤”',
    rarity: 'advanced',
    slot: 'B',
    icon: 'itm_sword_hammer',
    desc: '装载后往后购买干员所需费用 +2，但所购买的干员攻击力、防御力和生命 +50%（升星不可叠加：1/2/3 星都是在基础面板上 +50%），再次卸下时装备销毁、增幅消失；若获得 2 回合后仍未装载则自动销毁',
    teamConditional: [{ kind: 'always', stats: { attackDamageBp: 5000, armorBp: 5000, magicResistBp: 5000, hpBp: 5000 } }],
    shopCostDelta: 2,
    selfDestructAfterRounds: 2,
  },

  itm_surge_meal: {
    id: 'itm_surge_meal',
    name: '涌动之餐',
    rarity: 'advanced',
    slot: 'B',
    icon: 'itm_surge_meal',
    desc: '所有我方单位受到的治疗和生命回复效果 +30%',
    teamMechanics: [{ kind: 'teamHealingBp', ratioBp: 3000 }],
  },

  itm_survivor_contract: {
    id: 'itm_survivor_contract',
    name: '生还者合约',
    rarity: 'advanced',
    slot: 'B',
    icon: 'itm_survivor_contract',
    desc: '战斗开始时，使随机一名干员攻击力 +20%、防御 +20%，每次胜利后额外 +20%（最高叠加 100%），效果不会因为新回合而重置，失败后层数重新叠加；装备卸下后层数重新叠加',
    teamMechanics: [
      {
        kind: 'startRandomAllyBuff',
        // 这是**每一层**的数值；层数由 resolveSharedItems 折成 scaleBp
        stats: { attackDamageBp: 2000, armorBp: 2000, magicResistBp: 2000 },
      },
    ],
    // base:1 = 开局就有那 +20%；每赢一场 +1 层，最多 6 层（= +120%，其中"额外"部分封顶 +100%）
    growth: {
      source: 'win',
      base: 1,
      maxStacks: 6,
      label: '每胜利一场 +20%（上限 +100%）',
      resetOnUnequip: true,
      resetOnLoss: true,
    },
  },

  itm_demon_king_banner: {
    id: 'itm_demon_king_banner',
    name: '魔王的旗帜',
    rarity: 'advanced',
    slot: 'B',
    icon: 'itm_demon_king_banner',
    desc: '生命值大于 70 时，所有干员的攻击速度 +50%',
    teamConditional: [{ kind: 'hpAbove', hpAbove: 70, stats: { attackSpeedBp: 5000 } }],
  },

  itm_cangtong: {
    id: 'itm_cangtong',
    name: '“苍桐”',
    rarity: 'advanced',
    slot: 'B',
    icon: 'itm_cangtong',
    desc: '金币为 70 及以上时，每隔 10 秒对全场敌人造成一次 100 点法术伤害和 1.5 秒的晕眩',
    // active 由 resolveSharedItems 按玩家金币判定（金币在备战期不变）。
    // 200 tick = 10 秒；30 tick = 1.5 秒
    teamMechanics: [
      { kind: 'goldThresholdNuke', goldAtLeast: 70, active: false, intervalTicks: 200, damage: 100, damageType: 'magic', stunTicks: 30 },
    ],
  },

  itm_knight_lance_pro: {
    id: 'itm_knight_lance_pro',
    name: '骑士长枪专业版',
    rarity: 'advanced',
    slot: 'B',
    icon: 'itm_knight_lance_pro',
    desc: '野怪回合更高概率获得更多的金币（掉落金币 +50%）',
    perRound: { monsterGoldBp: 5000 },
  },
};

// ============================================================
//  ★ 0.1.3：转职藏品（16 件）+ 变形同构体
// ============================================================
//
// 【转职藏品是什么？】
// 一件"给单个干员挂上某个羁绊标签"的穿戴藏品：装上之后这名干员
// 既**算这个羁绊的人数**（可以凑档位），也**吃这个羁绊给成员的增益**。
//
// 【为什么这 16 件用生成、而不是手写 16 段？】
// 它们**结构完全一样**，唯一不同的就是绑哪个羁绊。手写除了更容易抄错，
// 还会在"以后往羁绊表里加一个羁绊"时被漏掉 —— 生成的话自动跟着表走，
// 而"哪些不该有转职"只需要在这里排除一次。
//
// 【排除谁？】用户口径：**不含「龙」和「领导人」**。
// 这两个是"全队光环 / 恰好 N 人才触发"的特殊羁绊，
// 给单个干员挂一个标签既凑不出人数、也拿不到那个光环，等于废牌。
const NO_RELIC_TRAITS = new Set(['dragon', 'leader']);

/** 能做转职的羁绊 id（顺序 = 羁绊表里的声明顺序，保证确定性） */
export const RELIC_TRAIT_IDS: readonly string[] = Object.keys(TRAIT_DEFS).filter(
  (traitId) => !NO_RELIC_TRAITS.has(traitId),
);

/**
 * 羁绊 id -> 转职藏品 id。
 *
 * 【为什么要有这张表？】变形同构体要"按羁绊反查藏品"，
 * 客户端校验"这件藏品转的是哪个羁绊"也要反查。
 * 命名规则写在一处，就不会出现"拼字符串拼错一个下划线"这种问题。
 */
export const RELIC_ITEM_OF_TRAIT: Record<string, string> = Object.fromEntries(
  RELIC_TRAIT_IDS.map((traitId) => [traitId, `itm_relic_${traitId}`]),
);

/**
 * ★ 0.1.3：变形同构体对**这只干员**能变出哪几件转职藏品。
 *
 * 【为什么不直接拿 def.traits？】
 * 因为干员的标签里有些**没有转职**（龙 / 领导人被排除了）——
 * 直接拿 traits 去随机，会有 1/3 的概率抽到一个"不存在的藏品"。
 * 所以先过滤成"有的"，随机也只在**有的**里面随机（各等概率）。
 *
 * 【顺序】按 `def.traits` 的声明顺序去重 —— 保证同一个干员每次得到同一组候选，
 * 联机两边算出来的东西才一致。
 */
export function morphCandidatesOf(def: { traits?: readonly string[] } | undefined): string[] {
  const out: string[] = [];
  for (const trait of def?.traits ?? []) {
    const id = RELIC_ITEM_OF_TRAIT[trait];
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/** 转职藏品本体（件数 = `RELIC_TRAIT_IDS` 的长度，0.2 是 18 件） */
export const TRAIT_RELICS: readonly ItemDef[] = RELIC_TRAIT_IDS.map((traitId) => {
  const trait = TRAIT_DEFS[traitId]!;
  return {
    id: RELIC_ITEM_OF_TRAIT[traitId]!,
    name: `${trait.name}转职`,
    rarity: 'advanced' as const,
    slot: 'A' as const,
    // 图标是程序生成的占位图（纯色底 + 羁绊首字），见 scripts/gen-trait-relic-icons.mjs
    icon: `itm_relic_${traitId}`,
    desc:
      `装备后，这名干员额外获得【${trait.name}】羁绊：` +
      '可以凑羁绊人数，也能吃到该羁绊给成员的增益。' +
      `本来就属于【${trait.name}】的干员装不上。`,
    grantsTrait: traitId,
  };
});

for (const relic of TRAIT_RELICS) ITEM_DEFS[relic.id] = relic;

/**
 * ★ 0.1.3：变形同构体（进阶 A）。
 *
 * 「装备到干员身上后立刻销毁，并根据干员身上的羁绊随机获得相应的一个转职藏品」
 * —— 这里只声明"是哪种备战效果"，具体怎么随机、产出放哪儿，见客户端状态层
 * （`applyItemPrep` 的 `morphRelic` 分支）。
 */
ITEM_DEFS['itm_morph_relic'] = {
  id: 'itm_morph_relic',
  name: '变形同构体',
  rarity: 'advanced',
  slot: 'A',
  icon: 'itm_morph_relic',
  desc:
    '装备到干员身上后立刻销毁，并根据这名干员的羁绊随机产出一件对应的转职藏品（各羁绊等概率）。' +
    '产出的转职进「穿戴藏品存放栏」；身上已经有转职藏品的干员用不了。',
  onEquip: { consume: true, prep: { kind: 'morphRelic' } },
};

/* ============================================================
   ★★ 0.3.2 盟约「阿米娅 · 不容拒绝」：三张升变之证
   ------------------------------------------------------------
   这三件是**盟约专属**（`covenantOnly`）：
     · 不进商店货架、不进野怪掉落、不进招募 / 拟态 / 定向投放；
     · 只能由这条盟约的机制发到玩家手里；
     · 装到**指定形态的阿米娅**身上 → 立刻换成另一个棋子，本证消耗掉。
   图标用的就是用户给的三张图（uniequip / rogue relic），
   和棋子模型是两回事（模型走 `ASCEND_DEFS` 的 `charId`）。

   ★ 为什么 `from` 用白名单而不是"是不是阿米娅"？
     因为终态之证**只能**从两个 3 费形态升上去，
     写成"是阿米娅就行"的话，1 费阿米娅能一步跳到终态，整条链就废了。
   ============================================================ */

ITEM_DEFS['itm_amiya_blue_cert'] = {
  id: 'itm_amiya_blue_cert',
  name: '升变之证·青色怒火',
  rarity: 'advanced',
  slot: 'A',
  icon: 'itm_amiya_blue',
  desc:
    '装备到「阿米娅」身上后立刻销毁，使她升变为**近卫形态**「阿米娅·青色怒火」：' +
    '射程变短、换来更高的生命与攻击。星级与身上的藏品都会保留。',
  covenantOnly: true,
  onEquip: { consume: true, ascend: { from: ['op07'], to: 'op_amiya_blue' } },
};

ITEM_DEFS['itm_amiya_mercy_cert'] = {
  id: 'itm_amiya_mercy_cert',
  name: '升变之证·慈悲愿景',
  rarity: 'advanced',
  slot: 'A',
  icon: 'itm_amiya_mercy',
  desc:
    '装备到「阿米娅」身上后立刻销毁，使她升变为**医疗形态**「阿米娅·慈悲愿景」：' +
    '面板偏低，但能站在后排带动全队。星级与身上的藏品都会保留。',
  covenantOnly: true,
  onEquip: { consume: true, ascend: { from: ['op07'], to: 'op_amiya_mercy' } },
};

ITEM_DEFS['itm_amiya_core_cert'] = {
  id: 'itm_amiya_core_cert',
  name: '升变之证·炉芯终曲',
  rarity: 'advanced',
  slot: 'A',
  icon: 'itm_amiya_core',
  desc:
    '装备到**三星**的「阿米娅·青色怒火」或「阿米娅·慈悲愿景」身上后立刻销毁，' +
    '使她升变为最终形态「阿米娅·炉芯终曲」。这是这条盟约的终局。',
  covenantOnly: true,
  onEquip: {
    consume: true,
    // ★ 只能从两个 3 费形态升上去，且必须 3 星
    ascend: { from: ['op_amiya_blue', 'op_amiya_mercy'], to: 'op_amiya_core', minStar: 3 },
  },
};

/** 普通藏品（稀有度 normal） */
export const NORMAL_ITEMS: ItemDef[] = Object.values(ITEM_DEFS).filter(
  (item) => item.rarity === 'normal' && item.covenantOnly !== true,
);
/**
 * 进阶藏品（稀有度 advanced）。
 *
 * ★ 0.3.2：**盟约专属的藏品一律排除**（升变之证）。
 *   商店货架、凯瑟琳「定向投放」、拟态 / 招募用的都是这份清单，
 *   所以这里挡一次，所有"随机获取"的口子就都挡住了。
 *   野怪掉落表是**逐件手写**的清单，本来就不会包含它们（另有测试钉住）。
 */
export const ADVANCED_ITEMS: ItemDef[] = Object.values(ITEM_DEFS).filter(
  (item) => item.rarity === 'advanced' && item.covenantOnly !== true,
);

/** 按稀有度 + 类型筛出可选藏品（修改器的"获得藏品"下拉、掉落表都用它） */
export function itemsOf(rarity: ItemDef['rarity'], slot: ItemDef['slot']): ItemDef[] {
  return Object.values(ITEM_DEFS).filter(
    (item) => item.rarity === rarity && item.slot === slot && item.covenantOnly !== true,
  );
}

/**
 * ★ 0.1.1：这件藏品是不是「**直接改造棋子本体**」的那一类（升星 / 复制一只 / 变身高一费）？
 *
 * ============================================================
 *  【为什么要单独一个判据，而不是在界面里写死两个藏品 id？】
 * ============================================================
 * 用户的要求是：「维维美·绝对主角」不能吃【拟态物质】【博士投影】，
 * **而且之后新增任何具备升星、棋子复制效果的藏品都不能对它生效** ——
 * "永久屏蔽这类藏品"。
 * 那就不能写 `itemId === 'itm_mimic_mass' || itemId === 'itm_doctor_projection'`：
 * 以后再加一件同类藏品，就一定会漏（而漏的表现是"彩蛋被复制出一只"，
 * 这种 bug 大概率没人会去测）。
 *
 * 所以判据认的是**效果的类型**（`onEquip.prep.kind`），加新藏品时只要它写的是
 * 这三种 kind 之一，就自动被挡住 —— 不需要再想起这条规则。
 *
 * 【为什么 `transformCostUp`（突变细胞）也算？】
 * 它把棋子**换成另一个干员**，同样是在改造本体；而且彩蛋是全场最高费（20 费），
 * 根本找不到"更高一费"的目标 —— 不挡的话玩家会看到一件藏品被消耗掉、
 * 只换来一句「没有可变的干员（数据缺失）」，那比直接说"对他无效"难懂得多。
 */
export function isUnitTransformingItem(item: ItemDef): boolean {
  const kind = item.onEquip?.prep?.kind;
  return kind === 'upgradeStar' || kind === 'cloneOneStar' || kind === 'transformCostUp';
}

// ============================================================
//  容器容量（装备界面的格子数）
// ============================================================

/** A 类藏品栏格数（存放未装备的 A 类藏品） */
export const ITEM_A_SLOTS = 10;
/** B 类藏品栏格数（存放未装备的 B 类藏品） */
export const ITEM_B_SLOTS = 5;
/** B 类共享装备槽数（真正生效的共享藏品） */
export const ITEM_B_EQUIP_SLOTS = 4;
/** 每个干员最多能装备几件 A 类藏品 */
export const ITEM_PER_UNIT = 2;
