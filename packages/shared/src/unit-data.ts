import { EGG_SKILL, SKILLS, SUMMON_DEFS } from './skill-data.js';
import { ASCEND_DEFS } from './ascension.js';
// 野怪表（源石虫…Boss）：和干员表并列的另一张"策划表"，见 monster-data.ts
import { MONSTER_DEFS } from './monster-data.js';
import { TRAIT_KINDS } from './trait-kinds.js';
import { TRAIT_DEFS } from './trait-data.js';
import { STAR_DAMAGE_BP, STAR_HP_BP, UNIT_STAR_BP, UNIT_STATS } from './unit-stats.js';
import type { TraitDefTable, UnitDef, UnitDefTable } from './types.js';

/**
 * ============================================================
 *  ⚠️ 干员表 - 名字/羁绊/费用/射程 来自你的表格，数值和技能还是占位
 * ============================================================
 *
 * 【已经是你给的数据（可以放心用）】
 *   · 50 个干员的名字
 *   · 每个干员的羁绊（来自表格「羁绊」列）
 *   · 每个干员的费用（1~5 费）
 *   · 每个干员的射程（来自表格「射程（格数）」列）
 *
 * 【还是占位的（等你给数据）】
 *   · 生命 / 攻击力 / 攻速 / 护甲 / 魔抗  —— 表格里没有这几列，
 *     现在按「定位模板 × 费用倍率」自动生成，用来把游戏跑起来
 *   · 技能  —— 表格「技能」列是空的，现在按定位给一个通用技能
 *   · 1-3 星技能倍率  —— 表格这一列也是空的，现在统一用 ×1.8/星
 *   · 羁绊的具体数值和档位 —— 表格只写了"谁属于哪个羁绊"，没写效果
 *
 * 这四样补上之后，把对应的常量替换掉就行，代码不用改。
 *
 * ============================================================
 *  数值单位说明（看懂了就能自己调平衡）
 * ============================================================
 *   hp / attackDamage    直接写正常数字。例：hp: 620 表示 620 点血
 *   armor / magicResist  直接写数字。减免率 = 护甲/(护甲+100)
 *                        例：护甲 30 => 减 23%；护甲 100 => 减 50%
 *   attackSpeed          1200 表示每秒攻击 1.2 次（1000 = 1.0 次/秒）
 *   range                攻击距离（格）。1 = 近战，3~5 = 远程
 *   manaPerAttack        每次普攻回多少法力。法力上限 1000
 *   starHpBp/starDamageBp  星级倍率。1800 = 每升一星 ×1.8（三星 = ×3.24）
 */

/** 把「秒」换算成 tick（20 tick = 1 秒） */
const s = (seconds: number): number => Math.round(seconds * 20);

// ============================================================
// 定位模板
// ============================================================

/**
 * 六种定位模板。
 *
 * 【为什么需要"定位"这个东西？】
 * 因为你给的表里有「羁绊」但没有「这个干员是干嘛的」。
 * 要把数值填出来，得先知道它是前排还是后排、打人还是治疗。
 * 所以规则是：**从羁绊推出定位**，再用定位决定基础数值。
 *
 * 比如「重装」=> 血厚护甲高、攻击低；「远射」=> 血少攻高、射程远。
 */
type Role = 'guard' | 'defender' | 'sniper' | 'caster' | 'medic' | 'vanguard';

const ARCHETYPES: Record<
  Role,
  {
    /** 中文定位名（只用于注释和检查报告） */
    clsName: string;
    /** 一句话定位 */
    note: string;
    base: UnitDef['base'];
    /** 卡片颜色（按定位区分，一眼看出版位） */
    color: string;
  }
> = {
  guard: {
    clsName: '近战输出',
    note: '前排近战，攻高血中',
    base: { hp: 620, attackDamage: 62, attackSpeed: 1200, armor: 26, magicResist: 18, range: 1, manaPerAttack: 100 },
    color: '#e0885c',
  },
  defender: {
    clsName: '重装',
    note: '抗伤坦克，血厚甲高',
    base: { hp: 900, attackDamage: 40, attackSpeed: 1000, armor: 46, magicResist: 26, range: 1, manaPerAttack: 120 },
    color: '#6fa8dc',
  },
  sniper: {
    clsName: '远程物理',
    note: '后排输出，射程远',
    base: { hp: 460, attackDamage: 60, attackSpeed: 1300, armor: 12, magicResist: 14, range: 4, manaPerAttack: 100 },
    color: '#7fc47f',
  },
  caster: {
    clsName: '法术输出',
    note: '后排法伤，技能爆发',
    base: { hp: 440, attackDamage: 68, attackSpeed: 1050, armor: 10, magicResist: 26, range: 3, manaPerAttack: 100 },
    color: '#b07fd6',
  },
  medic: {
    clsName: '治疗支援',
    note: '奶队友，不抗打',
    base: { hp: 470, attackDamage: 50, attackSpeed: 1100, armor: 12, magicResist: 26, range: 3, manaPerAttack: 110 },
    color: '#f0e28c',
  },
  vanguard: {
    clsName: '功能 / 指挥',
    note: '带增益或经济，铺场用',
    base: { hp: 560, attackDamage: 52, attackSpeed: 1250, armor: 20, magicResist: 16, range: 1, manaPerAttack: 130 },
    color: '#5cc9c9',
  },
};

/**
 * 「羁绊 -> 定位」的推导优先级（从上往下，第一个命中的生效）。
 *
 * 【为什么要定顺序？】
 * 因为一个干员可能有 2~4 个羁绊（例：号角 = 维多利亚 + 炮手 + 重装）。
 * 只看羁绊没法唯一确定定位，所以要定一个优先级。
 * 顺序的思路：**先看最"硬"的定位**（重装最硬、剑士次之），
 * 再到远程、法术、治疗，最后才是功能性定位。
 */
const ROLE_PRIORITY: Array<{ trait: string; role: Role }> = [
  { trait: 'defender', role: 'defender' },
  // ★ 0.3：新羁绊「近卫」也是 guard 定位，排在「剑豪」前面（先认近卫）
  { trait: 'guard', role: 'guard' },
  { trait: 'swordsman', role: 'guard' },
  { trait: 'cannon', role: 'sniper' },
  { trait: 'ranged', role: 'sniper' },
  { trait: 'arts', role: 'caster' },
  { trait: 'caster', role: 'caster' },
  { trait: 'support', role: 'medic' },
  // ★ 0.0.3「干员调整A版」：新增的「治疗」也是医疗定位。
  //   放在 support 后面（顺序只影响"自动推定位"的结果，
  //   而 50 个干员都有手填数值，定位实际只决定卡片配色）。
  { trait: 'healing', role: 'medic' },
  { trait: 'leader', role: 'vanguard' },
  { trait: 'merchant', role: 'vanguard' },
  { trait: 'dragon', role: 'caster' },
  { trait: 'flying', role: 'sniper' },
];

/**
 * 手动修正表：自动推导不合适的，在这里直接指定定位。
 *
 * 【为什么需要它？】
 * 自动推导只看羁绊。但有些干员的羁绊里没有"职业"，或者名字本身就是
 * 明牌的定位（例：星熊是重装、凯尔希是医疗），自动推导会给出奇怪的答案。
 * 与其把规则写得越来越绕，不如**把例外一个个列出来** ——
 * 这样你一眼就能看完所有"我替你做的判断"，不满意直接改。
 */
const ROLE_OVERRIDES: Record<string, Role> = {
  芙蓉: 'medic', // 羁绊只有萨卡兹+罗德岛（两个出身），没有职业 → 原角色是医疗
  星熊: 'defender', // 炎+支援，但射程 1 且原角色是重装
  耀骑士临光: 'guard', // 卡西米尔+支援，但射程 1 且原角色是近卫
  // 0.0.2：这张卡改成了**凯尔希·思衡托**（凯尔希的异格），
  // 所以头像/立绘/小人全都换成了异格那一套（见下面 CHAR_IDS 的 op46）。
  // 定位仍是医疗，这里保持不动。
  凯尔希·思衡托: 'medic', // 罗德岛+飞行，没有职业 → 原角色是医疗
  新约能天使: 'sniper', // 拉特兰+支援，但射程 4 且原角色是狙击
};

// ============================================================
// 50 个干员的正式名单（来自你的表格，行号就是 id 序号）
// ============================================================

interface RosterEntry {
  /** 干员名 */
  name: string;
  /** 费用 1~5 */
  cost: number;
  /** 射程（格），直接来自你的表 */
  range: number;
  /** 羁绊（英文 id，见 trait-kinds.ts） */
  traits: string[];
  /** 定位。不写就按 ROLE_PRIORITY 自动推 */
  role?: Role;
}

/**
 * 【怎么加一个新干员？】
 * 在下面按费用插一行就行，`id` 会自动按行号生成（op01、op02…）。
 * 注意：**插在中间会让后面所有干员的 id 变化**，
 * 而已有存档/日志里记的是 id，所以正式运营后请加在末尾。
 *
 * ============================================================
 *  ⚠️ 我改过 5 个名字（你表格里的是错别字，和 wiki 对不上号）
 * ============================================================
 * 为了能自动抓到对应的头像，我把这 5 个改成了官方写法：
 *    谷米     -> 古米          （差一个字，官方是「古米」）
 *    克洛斯   -> 克洛丝
 *    伊内斯   -> 伊内丝
 *    隐德莱希 -> 隐德来希
 *    维纳维多利亚 -> 维娜·维多利亚
 * 如果你就是要用原来那个写法（比如你自己给干员起的名字），
 * 改回来就行 —— 只是那 5 个头像要手动放（见 apps/web/public/assets/units/README.md）。
 */
const ROSTER: RosterEntry[] = [
  // ---------------- 1 费（14 个）----------------
  //   ★ 0.0.3 A 版把古米挪到了 2 费，所以这里从 15 个变成 14 个。
  //     注意：**块里的行序就是 op 编号**，改费用时只改 cost，不要搬行。
  { name: '空爆', cost: 1, range: 4, traits: ['cannon', 'support'] },
  { name: '夕', cost: 1, range: 3, traits: ['yan', 'caster', 'dragon'] },
  // ★ 0.0.3 A 版第 10 条：古米 1 费 -> 2 费，并新增「治疗」
  { name: '古米', cost: 2, range: 1, traits: ['defender', 'healing'] },
  { name: '梅', cost: 1, range: 3, traits: ['victoria', 'ranged'] },
  { name: '灰毫', cost: 1, range: 2, traits: ['kazimierz', 'cannon'] },
  { name: '芙蓉', cost: 1, range: 3, traits: ['sarkaz', 'rhodes'] },
  // ★ A 版第 9 条：阿米娅删除「支援」
  { name: '阿米娅', cost: 1, range: 3, traits: ['rhodes', 'leader', 'arts'] },
  { name: '拉普兰德', cost: 1, range: 1, traits: ['swordsman'] },
  { name: '信仰搅拌机', cost: 1, range: 1, traits: ['laterano', 'defender'] },
  // ★ A 版第 12 条：空弦删除「支援」，新增「远射」
  { name: '空弦', cost: 1, range: 3, traits: ['laterano', 'ranged'] },
  // 星熊在方舟里是重装（Defender），之前漏了「重装」标签，你要求补上
  // ★ A 版第 17 条：删除「支援」（重装保留）
  { name: '星熊', cost: 1, range: 1, traits: ['yan', 'defender'] },
  { name: '天火', cost: 1, range: 2, traits: ['victoria', 'caster'] },
  { name: '炎客', cost: 1, range: 1, traits: ['sarkaz', 'guard'] },
  { name: '芳汀', cost: 1, range: 2, traits: ['laterano', 'guard'] },
  { name: '克洛丝', cost: 1, range: 3, traits: ['rhodes', 'ranged'] },

  // ---------------- 2 费（11 个：10 个原生 2 费 + 从 1 费挪上来的古米）----------------
  // ★ A 版第 11 条：夜莺 2 费 -> 3 费，删除「支援」，新增「治疗」
  { name: '夜莺', cost: 3, range: 2, traits: ['sarkaz', 'healing'] },
  { name: '风笛', cost: 2, range: 1, traits: ['victoria'] },
  { name: '迷迭香', cost: 2, range: 3, traits: ['rhodes', 'cannon'] },
  // ★ 0.2 修订：砾的「职业」补上「支援」（用户 2026-10-16 确认，尽管支援成员列表当时没写她）
  { name: '砾', cost: 2, range: 1, traits: ['kazimierz', 'support', 'unyielding'] },
  { name: '聆音', cost: 2, range: 1, traits: ['laterano', 'swordsman'] },
  { name: '陈', cost: 2, range: 1, traits: ['yan', 'swordsman'] },
  { name: '惊蛰', cost: 2, range: 3, traits: ['yan', 'caster'] },
  { name: '洛洛', cost: 2, range: 3, traits: ['victoria', 'support', 'caster'] },
  { name: '熔泉', cost: 2, range: 4, traits: ['sarkaz', 'ranged'] },
  { name: '见行者', cost: 2, range: 2, traits: ['laterano'] },
  { name: '截云', cost: 2, range: 4, traits: ['yan', 'ranged'] },

  // ---------------- 3 费（10 个：9 个原生 3 费 + 从 2 费挪上来的夜莺）----------------
  // ★ A 版第 13 条：机械师删除「支援」
  { name: '机械师', cost: 3, range: 1, traits: ['rhodes', 'defender'] },
  { name: '菲亚梅塔', cost: 3, range: 5, traits: ['laterano', 'cannon'] },
  { name: '号角', cost: 3, range: 2, traits: ['victoria', 'cannon', 'defender'] },
  { name: '塑心', cost: 3, range: 3, traits: ['laterano', 'arts'] },
  // ★ A 版第 18 条原本写的是"焰尾删除支援"，**用户后来又撤回了** ——
  //   2026-10-11 明确要求"给焰尾加回支援羁绊"，所以这里保留 support。
  { name: '焰尾', cost: 3, range: 1, traits: ['kazimierz', 'support'] },
  { name: '老鲤', cost: 3, range: 1, traits: ['yan', 'merchant'] },
  { name: '远牙', cost: 3, range: 5, traits: ['kazimierz', 'ranged'] },
  { name: '妮芙', cost: 3, range: 3, traits: ['sarkaz', 'arts'] },
  { name: '左乐', cost: 3, range: 1, traits: ['yan', 'guard'] },

  // ---------------- 4 费（9 个）----------------
  { name: '伊内丝', cost: 4, range: 2, traits: ['support', 'unyielding'] },
  { name: '澄闪', cost: 4, range: 3, traits: ['victoria', 'arts'] },
  // ★ A 版第 14 条：蕾缪安删除「支援」，新增「远射」
  { name: '蕾缪安', cost: 4, range: 4, traits: ['laterano', 'ranged'] },
  // ★ A 版第 15 条：魔王新增「治疗」
  { name: '魔王', cost: 4, range: 2, traits: ['sarkaz', 'leader', 'healing'] },
  { name: '隐德来希', cost: 4, range: 1, traits: ['sarkaz', 'swordsman'] },
  { name: '耀骑士临光', cost: 4, range: 1, traits: ['kazimierz', 'support', 'unyielding'] },
  // 【望】按你的要求去掉了「炮手」标签（2025 版表格里已经是「炎，龙」）
  { name: '望', cost: 4, range: 3, traits: ['yan', 'dragon'] },
  { name: '予愿安洁莉娜', cost: 4, range: 4, traits: ['flying', 'ranged'] },
  { name: '可露希尔', cost: 4, range: 3, traits: ['rhodes', 'merchant'] },

  // ---------------- 5 费（6 个）----------------
  { name: '维什戴尔', cost: 5, range: 4, traits: ['sarkaz', 'cannon'] },
  // ★ A 版第 16 条：凯尔希（异格·思衡托）新增「治疗」
  { name: '凯尔希·思衡托', cost: 5, range: 3, traits: ['rhodes', 'flying', 'healing'] },
  { name: '玛恩纳', cost: 5, range: 3, traits: ['kazimierz', 'swordsman'] },
  { name: '赤刃明霄陈', cost: 5, range: 1, traits: ['yan', 'swordsman', 'dragon'] },
  { name: '维娜·维多利亚', cost: 5, range: 2, traits: ['victoria', 'leader'] },
  { name: '新约能天使', cost: 5, range: 4, traits: ['laterano', 'support'] },
  /*
    ★ 0.2 追加：**MujicaAve 联动五人**（用户指定）。id 会顺延成 op51~op55 ——
    所以追加在**末尾**，不要插到前面的费用块里（插进去会让后面所有人换 id、换小人）。
      · 若叶睦 1 费 · 特種（这里归「不屈」，因为她的被动是"一次性锁血"）
      · 祐天寺若麦 2 费 · 近卫（0.3：原剑士，剑士改名为剑豪并把这 5 人移出）
      · 三角初华 3 费 · 治疗
      · 八幡海铃 4 费
      · 丰川祥子 5 费 · 近卫（同上）
  */
  { name: '若叶睦', cost: 1, range: 1, traits: ['mujica', 'unyielding'] },
  { name: '祐天寺若麦', cost: 2, range: 1, traits: ['mujica', 'guard'] },
  { name: '三角初华', cost: 3, range: 3, traits: ['mujica', 'healing'] },
  { name: '八幡海铃', cost: 4, range: 2, traits: ['mujica'] },
  { name: '丰川祥子', cost: 5, range: 2, traits: ['mujica', 'guard'] },
];

/** 每个费用档位的数值倍率（越贵越强） */
const COST_SCALE: Record<number, number> = {
  1: 1.0,
  2: 1.25,
  3: 1.55,
  4: 1.9,
  5: 2.35,
};

/** 每个费用档位的技能倍率（千分比） */
const COST_SKILL_POWER: Record<number, number> = {
  1: 1600,
  2: 1900,
  3: 2200,
  4: 2600,
  5: 3200,
};

/** 从羁绊推出定位；推不出来就按射程猜（1~2 格当近战，3 格以上当远程） */
export function roleOf(entry: RosterEntry): Role {
  if (entry.role) return entry.role;
  const override = ROLE_OVERRIDES[entry.name];
  if (override) return override;
  for (const rule of ROLE_PRIORITY) {
    if (entry.traits.includes(rule.trait)) return rule.role;
  }
  return entry.range >= 3 ? 'sniper' : 'guard';
}

/**
 * 按定位给技能挑一个兜底（只在 SKILLS 里没写这个 id 时用）。
 *
 * ⚠️ 正常情况下**走不到这里** —— 50 个干员的技能都在 skill-data.ts 里，
 * 一条条从你的表格录进去了。留着它只是为了"以后加了新角色但还没写技能"
 * 时游戏不会崩，而是给一个能跑的占位技能。
 */
function fallbackSkill(role: Role, cost: number, name: string, id: string): UnitDef['skill'] {
  const power = COST_SKILL_POWER[cost] ?? 2000;

  switch (role) {
    case 'defender':
      return {
        id: `${id}_skill`,
        name: `${name}·坚守`,
        desc: `获得相当于 18% 最大生命的护盾，持续 4 秒`,
        effects: [{ kind: 'shield', target: 'self', power: 180, durationTicks: s(4) }],
        manaSource: 'damage',
      };
    case 'medic':
      return {
        id: `${id}_skill`,
        name: `${name}·急救`,
        desc: `治疗血量最低的队友，恢复 ${(power / 10).toFixed(0)}% 攻击力的生命`,
        effects: [{ kind: 'heal', target: 'lowestHpAlly', power }],
        manaSource: 'auto',
        manaPerSecond: 100,
      };
    case 'caster':
      return {
        id: `${id}_skill`,
        name: `${name}·爆发`,
        desc: `对全体敌人造成 ${(power / 10).toFixed(0)}% 攻击力的魔法伤害`,
        effects: [{ kind: 'damage', target: 'allEnemies', power, damageType: 'magic' }],
        manaSource: 'attack',
      };
    case 'sniper':
      return {
        id: `${id}_skill`,
        name: `${name}·精准射击`,
        desc: `对当前目标造成 ${(power / 10).toFixed(0)}% 攻击力的物理伤害`,
        effects: [
          { kind: 'damage', target: 'currentTarget', fallback: 'nearestEnemy', power, damageType: 'physical' },
        ],
        manaSource: 'attack',
      };
    case 'vanguard':
      return {
        id: `${id}_skill`,
        name: `${name}·号令`,
        desc: `给全体队友 +25% 攻速，持续 5 秒`,
        effects: [
          { kind: 'buff', target: 'allAllies', stats: { attackSpeedBp: 2500 }, durationTicks: s(5) },
        ],
        manaSource: 'damage',
      };
    default:
      // guard
      return {
        id: `${id}_skill`,
        name: `${name}·突刺`,
        desc: `对最近的敌人造成 ${(power / 10).toFixed(0)}% 攻击力的物理伤害`,
        effects: [{ kind: 'damage', target: 'nearestEnemy', power, damageType: 'physical' }],
        manaSource: 'damage',
      };
  }
}

/**
 * ============================================================
 *  干员 id → 官方角色 ID
 * ============================================================
 *
 * 【这张表是干什么的？】
 * `op07` 这种 id 是按名单行号自动生成的，只在本项目内部有意义。
 * 要用上**官方 Q 版小人**（Spine 骨骼动画），就必须知道这个干员
 * 在官方数据里叫什么 —— 也就是 `char_002_amiya` 这种 ID。
 *
 * 【这张表怎么来的？】
 * 拿名单里的中文名，去 `Kengxxiao/ArknightsGameData` 的
 * `character_table.json`（官方拆包数据表）里做**精确匹配**。
 * 不是模糊匹配、不是猜的 —— 匹配不上的一律留空。
 *
 * 【匹配不上的怎么办？】
 * 留空。留空的棋子不会有小人动画，自动回退到 `stand/` 半身像，
 * 游戏照常跑。**宁可不显示小人，也不能挂错人。**
 *
 * 【注意】
 * 名单里的名字改一个字，这里就要跟着改，
 * 因为两边是靠「中文名」对上的（见 scripts/fetch-chibi.ts）。
 */
export const CHAR_IDS: Record<string, string> = {
  op01: 'char_282_catap', // 空爆
  op02: 'char_2015_dusk', // 夕
  op03: 'char_196_sunbr', // 古米
  op04: 'char_133_mm', // 梅
  op05: 'char_431_ashlok', // 灰毫
  op06: 'char_120_hibisc', // 芙蓉
  op07: 'char_002_amiya', // 阿米娅
  op08: 'char_140_whitew', // 拉普兰德
  op09: 'char_4194_rmixer', // 信仰搅拌机
  op10: 'char_332_archet', // 空弦
  op11: 'char_136_hsguma', // 星熊
  op12: 'char_166_skfire', // 天火
  op13: 'char_131_flameb', // 炎客
  op14: 'char_271_spikes', // 芳汀
  op15: 'char_124_kroos', // 克洛丝
  op16: 'char_179_cgbird', // 夜莺
  op17: 'char_222_bpipe', // 风笛
  op18: 'char_391_rosmon', // 迷迭香
  op19: 'char_237_gravel', // 砾
  op20: 'char_4187_graceb', // 聆音
  op21: 'char_010_chen', // 陈
  op22: 'char_306_leizi', // 惊蛰
  op23: 'char_4040_rockr', // 洛洛
  op24: 'char_363_toddi', // 熔泉
  op25: 'char_4036_forcer', // 见行者
  op26: 'char_4078_bdhkgt', // 截云
  /*
    0.0.2 追加需求第 6 条：机械师终于对上了官方干员。
    之前这里写的是"官方数据表里没有同名干员，故意留空" —— 那是当时没查到的结论。
    实际上 prts.wiki 上就有「机械师」这个人（char_4230_mcnist），
    头像 / 半身像 / Q 版小人三样齐全，所以把 charId 补上。
  */
  op27: 'char_4230_mcnist', // 机械师
  /*
    ⚠️ 这一行曾经被吞进上一行的注释里：
      op27: 'char_4230_mcnist', // 机械师  op28: 'char_300_phenxi', // 菲亚梅塔
    上一行的行注释一直吃到行尾，于是 op28 这个键**根本不存在** ——
    CHAR_IDS['op28'] 是 undefined，客户端找不到 charId 就回退到半身像，
    表现就是"菲亚梅塔没有 Q 版小人"（素材其实早就渲染好了，在 chibi/op28/）。
    加/改 CHAR_IDS 时务必一个键一行，别把下一个键接在行注释后面。
  */
  op28: 'char_300_phenxi', // 菲亚梅塔
  op29: 'char_4039_horn', // 号角
  op30: 'char_245_cello', // 塑心
  op31: 'char_420_flamtl', // 焰尾
  op32: 'char_322_lmlee', // 老鲤
  op33: 'char_430_fartth', // 远牙
  op34: 'char_4146_nymph', // 妮芙
  op35: 'char_4121_zuole', // 左乐
  op36: 'char_4087_ines', // 伊内丝
  op37: 'char_377_gdglow', // 澄闪
  op38: 'char_4193_lemuen', // 蕾缪安
  op39: 'char_4134_cetsyr', // 魔王
  op40: 'char_4010_etlchi', // 隐德来希
  op41: 'char_1014_nearl2', // 耀骑士临光
  op42: 'char_2027_wang', // 望
  op43: 'char_1015_aglna2', // 予愿安洁莉娜
  op44: 'char_4228_closur', // 可露希尔
  op45: 'char_1035_wisdel', // 维什戴尔
  // 0.0.2：凯尔希 -> 凯尔希·思衡托（异格）。charId 也跟着换成异格那一套，
  // 否则头像/立绘/小人还是老凯尔希的（prts.wiki 上「头像_凯尔希·思衡托.png」）。
  op46: 'char_1052_kalts2', // 凯尔希·思衡托
  op47: 'char_4064_mlynar', // 玛恩纳
  op48: 'char_1050_chen3', // 赤刃明霄陈
  op49: 'char_1019_siege2', // 维娜·维多利亚
  op50: 'char_1041_angel2', // 新约能天使
  // ★ 0.2：明日方舟 × BanG Dream! Ave Mujica 联动（官方小人/立绘都齐）
  op51: 'char_4183_mortis', // 若叶睦
  op52: 'char_4185_amoris', // 祐天寺若麦
  op53: 'char_4184_dolris', // 三角初华
  op54: 'char_4186_tmoris', // 八幡海铃
  op55: 'char_4182_oblvns', // 丰川祥子
};

/**
 * ★★ 0.2.1 **表现层**：这个干员的普攻播哪套贴图特效（渲染层 `three/sequence-fx.ts` 的
 * `COMBAT_FX` 注册表键）。
 *
 * 【为什么键是 `opNN` 而不是官方 `charId`？】
 * 和 `CHAR_IDS` 那段注释同一个理由：素材归属跟着"名单这一行"走 —— 插一行只影响新那行。
 * 而且这里根本不涉及官方素材（图是美术另画的），用官方 id 反而多一层错配的可能。
 *
 * ★ 不写 = 走原来那套程序化攻击特效（弧 + 爆点），行为一个字节不变。
 */
const COMBAT_FX_IDS: Record<string, string> = {
  op50: 'angel_gun', // 新约能天使：枪口火光（每一枪）+ 命中火花 + 击杀加强版

  // ★ 0.2.1 炮手（普通攻击 = 抛物线炮弹 + 命中爆炸 1 格 + 烟）
  op01: 'cannon_gun_gray', // 空爆
  op05: 'cannon_gun_gray', // 灰毫
  op28: 'cannon_gun_red', // 菲亚梅塔（★ 只在普攻；技能是 5×5 轰击，见 combatFxBasicOnly）
  op29: 'cannon_gun_yellow', // 号角
  op45: 'cannon_gun_red', // 维什戴尔

  /*
    ★★ 0.2.1 追加：**通用近战单条斩击**（用户口径："给大部分近战角色使用"）。
    这一批是射程 1、且没有自己专属普攻表现的干员 —— 他们的普攻统一播 `slash_single`
    （中性银白，渲染层按"我方 → 目标"旋转）。

    ★ 为什么不干脆做成"所有近战的默认值"？因为那是第二处真相：
      · 有人写了专属表现（拉普兰德用白色流光、信仰搅拌机用子弹）就不该再叠一条斩击；
      · "谁用通用件"是**美术归属**，和 op 编号一样该写在数据里，改名单才看得见。
    ★ 陈 / 赤刃明霄陈 / 玛恩纳 开着技能时走各自的 `SKILL_FX.attack`，普攻仍用这条。
  */
  op03: 'melee_slash', // 古米
  op11: 'melee_slash', // 星熊
  op14: 'melee_slash', // 芳汀（射程 2，但按用户口径归白色系近战）
  op17: 'melee_slash', // 风笛
  op19: 'melee_slash', // 砾
  op21: 'melee_slash', // 陈
  op31: 'melee_slash', // 焰尾
  op35: 'melee_slash', // 左乐
  op48: 'melee_slash', // 赤刃明霄陈（技能期间换 chen_s3 那套连斩）
  op51: 'melee_slash', // 若叶睦

  /*
    ★★ 0.2.1（用户口径）：**按角色色系分色**，形状完全一样，只换配色。
      · 红 —— 炎客 / 聆音 / 老鲤 / 隐德来希 / 祐天寺若麦
      · 黄 —— 机械师 / 耀骑士临光 / 玛恩纳 / 维娜·维多利亚
    默认（没写色系的那几位）继续用中性银白 `melee_slash`。
  */
  op13: 'melee_slash_red', // 炎客
  op20: 'melee_slash_red', // 聆音
  op32: 'melee_slash_red', // 老鲤
  op40: 'melee_slash_red', // 隐德来希
  op52: 'melee_slash_red', // 祐天寺若麦

  op27: 'melee_slash_gold', // 机械师
  op41: 'melee_slash_gold', // 耀骑士临光
  op47: 'melee_slash_gold', // 玛恩纳
  op49: 'melee_slash_gold', // 维娜·维多利亚

  // ★ 0.2.1 追加：夕（op02）普攻 = 黑白墨爆（黑层普通混合 + 白层加色）
  op02: 'ink_gun',
  // ★ 0.2.1 追加：天火（op12）普攻 = 单格橙黄爆炸（技能期间让位给 3×3 大爆炸）
  op12: 'skyfire_gun',
};

/**
 * ★★ 0.2.1：这套普攻表现**只在普通攻击**里播（技能期间让位给技能自己的表现）。
 * 目前只有菲亚梅塔 —— 她的技能把普攻变成 5×5 范围轰击，那一发不该是"1 格炮弹爆炸"。
 * 号角 / 灰毫 / 空爆 的技能只是给自己加数值，出手还是同一种炮弹，所以**不**进这张表。
 */
const COMBAT_FX_BASIC_ONLY: Record<string, boolean> = {
  op28: true,
};

/**
 * ★★ 0.2.1 **表现层**：这个干员的**远程普攻弹道**播哪套（渲染层 `TRACER_FX` 注册表键）。
 * 不写 = 原来那根白线。近战（射程 1）写了也没用 —— 弹道只对远程攻击有意义。
 */
const TRACER_FX_IDS: Record<string, string> = {
  // 闪电（整条线一次铺满）
  op37: 'bolt_pink', // 澄闪：粉色闪电（浅蓝电流芯 + 白火花）
  op22: 'bolt_yellow', // 惊蛰：同款闪电，黄为主 + 橙点缀

  /*
    ★ 0.2.1：迷迭香 —— **不是弹道**，是"背后那套战术装置甩出去砸目标"。
    它不走 `TRACER_FX`（那套是"沿弹道拉伸的贴片"），而是渲染层
    `rosmon-slam-fx.ts` 的专属通道（抛物线 + 末段加速砸下 + 落地淡出）。
    ★ 用户口径：**一次只砸一个** —— 四块板不会分头飞。
  */
  op18: 'rosmon_slam',

  // 子弹（弹头飞过去 + 拖尾）
  op50: 'bullet_angel', // 新约能天使
  op38: 'bullet_angel', // 蕾缪安
  op09: 'bullet_angel', // 信仰搅拌机
  op25: 'bullet_angel', // 见行者
  op10: 'bullet_angel', // 空弦
  op33: 'bullet_angel', // 远牙
  op15: 'bullet_angel', // 克洛丝
  op04: 'bullet_angel', // 梅

  /*
    ★★ 0.2.1（用户口径）：**梅那套子弹的十一种配色**。
    形状/速度/拖尾完全照抄 `bullet_angel`，只换颜色；暗芯三种（紫黑 / 赤黑 / 纯黑）
    中间不画、只描边 + 空心弹头（加色下纯黑看不见）。
      · 熔泉红 / 芙蓉紫 / 洛洛黄 / 截云棕 / 塑心紫黑 / 妮芙粉 /
        伊内丝赤黑 / 望纯黑 / 予愿安洁莉娜橙 / 凯尔希绿 / 可露希尔金
  */
  op24: 'bullet_red', // 熔泉
  op06: 'bullet_purple', // 芙蓉
  op23: 'bullet_yellow', // 洛洛
  op26: 'bullet_brown', // 截云
  op30: 'bullet_void', // 塑心
  op34: 'bullet_pink', // 妮芙
  op36: 'bullet_blood', // 伊内丝
  op42: 'bullet_shadow', // 望
  op43: 'bullet_orange', // 予愿安洁莉娜
  op46: 'bullet_green', // 凯尔希·思衡托
  op44: 'bullet_gold', // 可露希尔

  // ★ 0.2.1 炮弹（抛物线飞过去 + 拖尾），和上面那套普攻爆炸是一对
  op01: 'shell_gray', // 空爆
  op05: 'shell_gray', // 灰毫
  op28: 'shell_red', // 菲亚梅塔
  op29: 'shell_yellow', // 号角
  op45: 'shell_red', // 维什戴尔

  /*
    ★★ 0.2.1 追加：**法术流光**（用户口径）。
      · 阿米娅：黑色为主 + 红色点缀；
      · 拉普兰德：同一套的**白色为主 + 灰色点缀**（"变色版"）。
    ★ 拉普兰德射程只有 1，这条流光就是"贴脸打出去的一束术式"（长度很短），
      比原来那根白线更能说明"她的伤害已经是法术了"。
  */
  op07: 'flow_arts_dark', // 阿米娅
  op08: 'flow_arts_light', // 拉普兰德

  /*
    ★★ 0.2.1：**音符**（`note-fx.ts` 的专属通道，不进 `TRACER_FX`）。
      · 丰川祥子（op55）：金色 —— 但她的音符不走这张表，是
        `skill-data.ts` 里 `attackProfile.fx = 'note'`（那套还带穿透 3 格的真实机制）；
      · 八幡海铃（op54）：**紫色音符**。用户口径原话是
        「八幡海铃使用紫色音符特效（祥子特效改一下颜色）」——
        所以只换配色，形状/飞法/时长一个字不改。
    ★ 她这里**只写表现**（`tracerFx` 是纯表现层，不进校验和），
      不像祥子那样写 `attackProfile` —— 那会给她的普攻加上穿透/多段的**玩法**含义。
  */
  op54: 'note_purple',
};

/**
 * ★★ 0.2.1 **表现层**：这个干员给别人回血时射哪条流光（渲染层 `TRACER_FX` 注册表键）。
 *
 * 【为什么单独一张表】
 * "打人的弹道"（`TRACER_FX_IDS`）和"奶人的光"是两件事：一个人可以既远程打人又奶人
 * （比如以后的医疗射手），共用一张表就得二选一。而且治疗事件里没有 `fx` 字段 ——
 * 渲染层是直接查 `UnitDef.healFx`，所以这里就是它的唯一来源。
 *
 * ★ 纯表现层，不进校验和。不写 = 治疗只有绿框 + 数字（老行为）。
 */
const HEAL_FX_IDS: Record<string, string> = {
  op03: 'stream_heal', // 古米：应急口粮（回复周围八格生命最低的队友）
  op06: 'stream_heal', // 芙蓉：技能期间攻击改为治疗血量最低的队友
  /*
    ★★ 0.2.1（用户口径）：三角初华「使用绿色攻击特效」。
    她的**普攻本来就是治疗**（`passive.attackHeals`：攻击改为治疗友方，
    优先血最低的、有祥子时优先祥子），所以"绿色攻击特效"的落点就是这条治疗流光 ——
    数据里写一句 `healFx` 就够，渲染层不用为她加任何分支。
    ★ 顺带把"奶妈自己脸上的命中火花"关掉了（见 replay 的 `isHealAttack`），
      否则看起来像她打自己。
  */
  op53: 'stream_heal', // 三角初华
};

/**
 * ★★ 0.2.1 **表现层**：这个干员的**回血光环**（渲染层 `three/heal-halo-fx.ts` 配色表键）。
 *
 * 【和 `healFx` 的分工】
 *   · `healFx`   = 从施法者**射到**被治疗者身上的一条流光（古米 / 芙蓉 / 三角初华）；
 *   · 这张表    = 在施法者**脚下**一直亮着的一圈光环 + 往上飘的符号。
 * 两者不冲突：一个人可以既有流光又有光环，也可以只有其中之一。
 *
 * 用户口径（2026-10-18）：
 *   · 夜莺「回血光环的特效，绿色光环，同时有绿色 +++ 的飘动效果」；
 *   · 魔王「粉色回血光环和夜莺类似，还可以加上 🗡+ 的特效来表示加攻击力」。
 *
 * ★ 纯表现层，不进校验和。不写 = 治疗只有绿框 + 数字（老行为）。
 */
const HEAL_HALO_IDS: Record<string, string> = {
  op16: 'heal_halo_green', // 夜莺：圣域（绿色光环 + 绿色 +++）
  op39: 'heal_halo_pink', // 魔王：威慑领域（粉色光环 + 🗡+ 表示加攻击力）
};

/**
 * ============================================================
 *  ★ 彩蛋棋子：「维维美·绝对主角」
 * ============================================================
 *
 * 【它和普通干员的五点不同】
 *   1. **不在 ROSTER 名单里** —— 所以没有 opNN 编号，id 单独取 `egg_mvm`。
 *      这是有意的：名单是按行号发编号的，插一行会让后面全部位移；
 *      彩蛋本来就不该占用一个正式编号。
 *   2. **20 费** —— 远超正常的 1~5 费。它不是"贵一点的棋子"，
 *      而是"抽到就是赚到"的那种存在（商店概率 1/1500，见 economy 的 rollShop）。
 *   3. **没有任何羁绊**（`traits: []`）—— 它不参与任何羁绊的凑人数。
 *   4. **没有星级机制**（`noStar: true`）—— 三张不合一、卡面不画星级、
 *      星级倍率恒 1000（升星不会变强，因为它根本升不了星）。
 *   5. **可以正常佩戴装备** —— 不是野怪，不受"野怪不能穿装备"那条限制。
 *
 * 【模型】用的是官方「维什戴尔」的皮肤「绝对主角」的小人素材
 * （charId = `char_1035_wisdel_game_9`，见 fetch-chibi.ts 的 REMOTE_OVERRIDES
 *  —— 皮肤的小人在素材库里多一层目录，形状和普通干员不一样）。
 *
 * 【数值】生命 12000 / 攻击 700 / 双抗 50 / 射程 5 / 攻速 1.2
 * （全部按用户给的原话，没有做任何"平衡性调整" —— 它本来就是个彩蛋）。
 */
export const EGG_UNIT_ID = 'egg_mvm';

export const EGG_UNIT: UnitDef = {
  id: EGG_UNIT_ID,
  name: '维维美·绝对主角',
  cost: 20,
  // 没有任何羁绊
  traits: [],
  base: {
    hp: 12000,
    attackDamage: 700,
    attackSpeed: 1200, // 1.2 次/秒
    armor: 50,
    magicResist: 50,
    range: 5,
    manaPerAttack: 125, // 攻击回复：打一下 125，上限 1000 => 8 下开一次技能
  },
  // 没有星级机制：星级倍率恒 1.0（升星无增益）
  starHpBp: 10000,
  starDamageBp: 10000,
  skill: EGG_SKILL,
  color: '#8fd4ff', // 立绘/占位色块的基色（浅蓝，和卡面炫彩一致）
  sprite: EGG_UNIT_ID,
  // 皮肤「绝对主角」的骨架 id（素材库里是 spine/char_1035_wisdel/char_1035_wisdel_game_9/…）
  charId: 'char_1035_wisdel_game_9',
  noStar: true,
};

/** 由名单生成棋子定义表 */
function buildOperators(): UnitDefTable {
  const defs: UnitDefTable = {};

  ROSTER.forEach((entry, index) => {
    // 用稳定的英文 id（中文 id 在日志和网址里都不方便）。
    // 行号就是序号：第 1 行 op01，第 50 行 op50。
    const id = `op${String(index + 1).padStart(2, '0')}`;
    const role = roleOf(entry);
    const archetype = ARCHETYPES[role];
    const scale = COST_SCALE[entry.cost] ?? 1;

    // 同一费用内加点个体差异，避免同费干员数值完全一样。
    // 用行号算，所以是固定的（不是随机的）—— 保证数据可复现。
    const variance = 1 + ((index % 5) - 2) * 0.03;

    /*
      数值从哪来？
        1. **你填的数值表**（UNIT_STATS，由 docs/干员数值表.xlsx 生成）
        2. 没有的话按「定位模板 × 费用倍率」自动生成（兜底，保证不会崩）
      现在 50 个干员全部走第 1 条 —— 每个人都是手填的值，不再是模板算出来的。
      `archetype` 仍然有用：它决定卡片颜色（按定位区分）和占位技能的形态。
    */
    const handWritten = UNIT_STATS[id];
    const base = handWritten
      ? { ...handWritten }
      : {
          hp: Math.round(archetype.base.hp * scale * variance),
          attackDamage: Math.round(archetype.base.attackDamage * scale * variance),
          attackSpeed: archetype.base.attackSpeed,
          armor: Math.round(archetype.base.armor * (1 + (scale - 1) * 0.6)),
          magicResist: Math.round(archetype.base.magicResist * (1 + (scale - 1) * 0.6)),
          // 射程以你的表格为准（这是你明确给了的数据，优先级高于模板）
          range: entry.range,
          manaPerAttack: archetype.base.manaPerAttack,
        };

    defs[id] = {
      id,
      name: entry.name,
      cost: entry.cost,
      traits: [...entry.traits],
      base,
      starHpBp: UNIT_STAR_BP[id]?.hpBp ?? STAR_HP_BP,
      starDamageBp: UNIT_STAR_BP[id]?.damageBp ?? STAR_DAMAGE_BP,
      color: archetype.color,
      sprite: id,
      // 官方角色 ID：有它才能挂上官方 Q 版小人（见上面 CHAR_IDS 的说明）。
      // 匹配不上就是 undefined，客户端会自动回退到半身像。
      charId: CHAR_IDS[id],
      // ★ 0.2.1 表现层：普攻贴图特效（枪口火光/命中火花），不写就走程序化特效
      combatFx: COMBAT_FX_IDS[id],
      // ★ 0.2.1 表现层：远程普攻的弹道特效（澄闪的粉色闪电），不写就画原来那根白线
      tracerFx: TRACER_FX_IDS[id],
      // ★ 0.2.1 表现层：治疗时朝被治疗队友射的流光（古米/芙蓉的绿光）
      healFx: HEAL_FX_IDS[id],
      // ★ 0.2.1 表现层：治疗时**自己脚下**那圈回血光环（夜莺绿 / 魔王粉）
      healHaloFx: HEAL_HALO_IDS[id],
      // ★ 0.2.1 表现层：这套普攻表现是否只在"普通攻击"里播（技能期间让位）
      combatFxBasicOnly: COMBAT_FX_BASIC_ONLY[id],
      // 技能来自 skill-data.ts（你表格里那 50 条，一条条录进来的）
      skill: SKILLS[id] ?? fallbackSkill(role, entry.cost, entry.name, id),
    };
  });

  /*
    召唤物（迷迭香的柱子 / 维娜的金狮子 / 望的棋子）也进同一张表。
    靠 `summonOnly` 标记把它们从商店和牌库里排除掉 ——
    战斗内核只认一张表，这样它就不用多带一个参数。
  */
  for (const def of Object.values(SUMMON_DEFS)) {
    defs[def.id] = def;
  }

  /*
    野怪（源石虫、猎狗、W、Boss…）也进同一张表，理由和召唤物完全一样：
    战斗内核只认一张表。它们靠 `monsterOnly` 标记被排除在所有抽卡之外
    （商店、牌库、单机敌方干员阵营都不认它们），见 isPlayableDef。
    名单和数值在 monster-data.ts（一行一个，好改）。
  */
  for (const def of Object.values(MONSTER_DEFS)) {
    defs[def.id] = def;
  }

  /*
    ★★ 0.3.2 盟约「阿米娅 · 不容拒绝」的三个升变形态也进同一张表
    （内核只认一张表），靠 `ascendOnly` 被排除在所有抽卡之外。
  */
  for (const def of Object.values(ASCEND_DEFS)) {
    defs[def.id] = def;
  }

  // ★ 彩蛋棋子：和上面两类都不一样，它**要**出现在商店里（靠 1/1500 那条特殊概率），
  //   所以不设 summonOnly / monsterOnly；只设 `noStar` 把自己从合成与星级显示里摘出去。
  defs[EGG_UNIT.id] = EGG_UNIT;

  return defs;
}

/** 棋子定义表：key 是棋子 id */
export const UNIT_DEFS: UnitDefTable = buildOperators();

// 羁绊表在 trait-data.ts 里（加了"战斗中机制"之后它变长了很多，
// 而且干员表和羁绊表是两份独立的设计文档，放一起会互相干扰）
export { TRAIT_DEFS } from './trait-data.js';

/**
 * 这只棋子能不能被"抽到 / 买到 / 当敌人刷出来"。
 *
 * 两类要排除：
 *   · **召唤物**（迷迭香的柱子、维娜的金狮子、望的棋子）—— 只能由技能生成；
 *   · **野怪**（源石虫…Boss）—— 只在野怪回合由系统波次生成。
 *
 * 每次都要记得过滤很烦，所以统一收在这里 —— 抽牌的地方只调这一个函数。
 */
export function isPlayableDef(def: UnitDef): boolean {
  /*
    ★ 0.3.2：`ascendOnly`（阿米娅的三个升变形态）也算"不能买" ——
    它们只能由升变产生，进了商店就是"能直接买终态"。
  */
  return def.summonOnly !== true && def.monsterOnly !== true && def.ascendOnly !== true;
}

/** 所有"能买到"的棋子 */
export function playableDefs(defs: UnitDefTable = UNIT_DEFS): UnitDef[] {
  return Object.values(defs).filter(isPlayableDef);
}

/** 按费用列出所有棋子 id，供商店抽卡用。排序保证顺序稳定 => 确定性 */
export function unitIdsByCost(cost: number, defs: UnitDefTable = UNIT_DEFS): string[] {
  return playableDefs(defs)
    .filter((def) => def.cost === cost)
    .map((def) => def.id)
    .sort();
}

/**
 * 各等级下、各费用棋子的出现概率（万分比，每行加起来 10000）。
 *
 * 【这是自走棋最核心的数值表之一】
 * 等级越高，高费棋子越容易出现。玩家「攒钱升级」的动力就来自这里。
 * 每行是 [1费, 2费, 3费, 4费, 5费] 的概率。
 */
export const SHOP_ODDS_BY_LEVEL: Record<number, [number, number, number, number, number]> = {
  1: [10000, 0, 0, 0, 0],
  2: [10000, 0, 0, 0, 0],
  3: [7500, 2500, 0, 0, 0],
  4: [5500, 3000, 1500, 0, 0],
  5: [4500, 3300, 2000, 200, 0],
  6: [3000, 4000, 2500, 500, 0],
  7: [1900, 3000, 3500, 1500, 100],
  8: [1800, 2500, 3200, 2200, 300],
  9: [1500, 2000, 2500, 3000, 1000],
  10: [1300, 1700, 2200, 3200, 1600],
};

/**
 * 自检：每个干员的标签都必须在 TRAIT_KINDS 里登记过、且有对应的羁绊定义。
 * 漏了的话羁绊会**静默失效** —— 所以这里直接抛错，让问题立刻暴露。
 */
for (const def of Object.values(UNIT_DEFS)) {
  for (const trait of def.traits) {
    if (!(trait in TRAIT_KINDS)) {
      throw new Error(`数据有误：干员 ${def.name} 的标签 "${trait}" 没有在 trait-kinds.ts 里登记`);
    }
    if (!(trait in TRAIT_DEFS)) {
      throw new Error(`数据有误：干员 ${def.name} 的标签 "${trait}" 没有对应的羁绊定义`);
    }
  }
}

/** 数据表摘要，启动时打印一下方便确认加载了多少 */
export const ROSTER_SUMMARY = {
  total: Object.keys(UNIT_DEFS).length,
  traits: Object.keys(TRAIT_DEFS).length,
};

/** 每个羁绊有几个干员（用来检查"这个羁绊根本凑不出来"） */
export const TRAIT_MEMBERS: Record<string, string[]> = (() => {
  const out: Record<string, string[]> = {};
  for (const trait of Object.keys(TRAIT_DEFS)) out[trait] = [];
  for (const def of Object.values(UNIT_DEFS)) {
    for (const trait of def.traits) out[trait]?.push(def.name);
  }
  return out;
})();

/**
 * ★★ 0.2：单位在对局里**给人看的名字** —— 唯一实现。
 *
 * 【为什么野怪统一叫"野怪"？】
 * 用户口径（2026-10-17）：「多人单人打野怪时不显示野怪具体名字，只显示野怪就好，
 * 在观战中也是」。理由很实际：野怪回合是"一波怪冲上来"，
 * 逐只写"源石虫 / 猎狗 / 士兵 / 隐形弩手"只会把战斗日志刷满，
 * 玩家真正关心的只有"我这边的谁在挨打"。
 *
 * ★ 判据是 `monsterOnly`（**不看回合号**）：
 *   · 野怪回合的波次、羁绊召唤出来的那几只（血骑士 / 锹 / 「左手」）都算；
 *   · 干员永远显示本名 —— 包括联机对面的玩家阵容。
 * ★ 服务端组 `names` 映射、单机/沙盒组本地映射**都调这一个函数**，
 *   三处各写一遍一定会有一天对不上（观战看到名字、自己打看不到）。
 */
export function displayNameOf(defId: string, defs: UnitDefTable = UNIT_DEFS): string {
  const def = defs[defId];
  if (!def) return defId;
  return def.monsterOnly ? '野怪' : def.name;
}
