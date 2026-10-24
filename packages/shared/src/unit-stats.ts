/**
 * ============================================================
 *  干员一星基础数值
 * ============================================================
 *
 * ⚠️ **这个文件是自动生成的，不要手改** —— 改完下次导入就被覆盖了。
 *
 * 数据来源：`docs/干员数值表.xlsx`（你填的那份）
 * 重新生成：
 *   node node_modules/tsx/dist/cli.mjs scripts/import-stat-sheet.ts --write
 *
 * 【关于单位】
 *   hp / attackDamage / armor / magicResist  直接是数字（1 点就是 1 点）
 *   attackSpeed                              1000 = 每秒攻击 1 次
 *   range                                    格数
 *   manaPerAttack                            每次普攻回多少法力（上限 1000）
 *   armor 的减伤公式                          减伤 = 护甲 ÷ (护甲 + 100)
 */

import type { UnitDef } from './types.js';

/** 一星基础数值（不含羁绊加成） */
export const UNIT_STATS: Record<string, UnitDef['base']> = {
  op01: { hp: 432, attackDamage: 68, attackSpeed: 1050, armor: 12, magicResist: 14, range: 4, manaPerAttack: 100 },
  op02: { hp: 467, attackDamage: 79, attackSpeed: 1050, armor: 10, magicResist: 19, range: 3, manaPerAttack: 100 },
  op03: { hp: 1300, attackDamage: 40, attackSpeed: 1000, armor: 45, magicResist: 26, range: 1, manaPerAttack: 120 },
  op04: { hp: 474, attackDamage: 55, attackSpeed: 1500, armor: 12, magicResist: 20, range: 3, manaPerAttack: 100 },
  op05: { hp: 488, attackDamage: 65, attackSpeed: 1100, armor: 33, magicResist: 22, range: 2, manaPerAttack: 100 },
  op06: { hp: 442, attackDamage: 45, attackSpeed: 1100, armor: 12, magicResist: 22, range: 3, manaPerAttack: 110 },
  op07: { hp: 427, attackDamage: 68, attackSpeed: 1200, armor: 10, magicResist: 24, range: 3, manaPerAttack: 100 },
  op08: { hp: 620, attackDamage: 62, attackSpeed: 1250, armor: 28, magicResist: 22, range: 1, manaPerAttack: 100 },
  op09: { hp: 1250, attackDamage: 41, attackSpeed: 1000, armor: 35, magicResist: 25, range: 1, manaPerAttack: 120 },
  op10: { hp: 498, attackDamage: 64, attackSpeed: 1100, armor: 12, magicResist: 19, range: 3, manaPerAttack: 110 },
  op11: { hp: 1200, attackDamage: 39, attackSpeed: 1000, armor: 62, magicResist: 46, range: 1, manaPerAttack: 120 },
  op12: { hp: 467, attackDamage: 76, attackSpeed: 1050, armor: 10, magicResist: 19, range: 2, manaPerAttack: 100 },
  op13: { hp: 635, attackDamage: 67, attackSpeed: 1200, armor: 26, magicResist: 18, range: 1, manaPerAttack: 100 },
  op14: { hp: 639, attackDamage: 64, attackSpeed: 1250, armor: 31, magicResist: 22, range: 2, manaPerAttack: 100 },
  op15: { hp: 488, attackDamage: 64, attackSpeed: 1300, armor: 12, magicResist: 14, range: 3, manaPerAttack: 100 },
  op16: { hp: 599, attackDamage: 81, attackSpeed: 1200, armor: 14, magicResist: 25, range: 2, manaPerAttack: 0 },
  op17: { hp: 752, attackDamage: 81, attackSpeed: 1200, armor: 30, magicResist: 21, range: 1, manaPerAttack: 100 },
  op18: { hp: 475, attackDamage: 79, attackSpeed: 1300, armor: 14, magicResist: 16, range: 3, manaPerAttack: 100 },
  op19: { hp: 798, attackDamage: 49, attackSpeed: 1200, armor: 25, magicResist: 25, range: 1, manaPerAttack: 100 },
  op20: { hp: 855, attackDamage: 84, attackSpeed: 1250, armor: 30, magicResist: 21, range: 1, manaPerAttack: 100 },
  op21: { hp: 799, attackDamage: 83, attackSpeed: 1200, armor: 30, magicResist: 21, range: 1, manaPerAttack: 100 },
  op22: { hp: 634, attackDamage: 79, attackSpeed: 1150, armor: 12, magicResist: 25, range: 3, manaPerAttack: 100 },
  op23: { hp: 562, attackDamage: 85, attackSpeed: 1050, armor: 12, magicResist: 20, range: 3, manaPerAttack: 100 },
  op24: { hp: 592, attackDamage: 77, attackSpeed: 1300, armor: 14, magicResist: 16, range: 4, manaPerAttack: 100 },
  op25: { hp: 852, attackDamage: 73, attackSpeed: 1150, armor: 35, magicResist: 26, range: 2, manaPerAttack: 100 },
  op26: { hp: 641, attackDamage: 71, attackSpeed: 1300, armor: 14, magicResist: 16, range: 4, manaPerAttack: 100 },
  op27: { hp: 1850, attackDamage: 55, attackSpeed: 1000, armor: 47, magicResist: 50, range: 1, manaPerAttack: 120 },
  op28: { hp: 755, attackDamage: 117, attackSpeed: 1050, armor: 16, magicResist: 19, range: 5, manaPerAttack: 100 },
  op29: { hp: 1737, attackDamage: 84, attackSpeed: 1000, armor: 61, magicResist: 40, range: 2, manaPerAttack: 120 },
  op30: { hp: 698, attackDamage: 122, attackSpeed: 1050, armor: 13, magicResist: 20, range: 3, manaPerAttack: 100 },
  op31: { hp: 712, attackDamage: 70, attackSpeed: 1100, armor: 16, magicResist: 24, range: 1, manaPerAttack: 110 },
  op32: { hp: 892, attackDamage: 72, attackSpeed: 1250, armor: 25, magicResist: 24, range: 1, manaPerAttack: 130 },
  op33: { hp: 513, attackDamage: 90, attackSpeed: 1250, armor: 16, magicResist: 19, range: 5, manaPerAttack: 100 },
  op34: { hp: 688, attackDamage: 113, attackSpeed: 1250, armor: 13, magicResist: 19, range: 3, manaPerAttack: 100 },
  op35: { hp: 1099, attackDamage: 100, attackSpeed: 1250, armor: 30, magicResist: 30, range: 1, manaPerAttack: 100 },
  op36: { hp: 895, attackDamage: 99, attackSpeed: 1150, armor: 18, magicResist: 24, range: 2, manaPerAttack: 110 },
  op37: { hp: 755, attackDamage: 130, attackSpeed: 1100, armor: 15, magicResist: 17, range: 3, manaPerAttack: 100 },
  op38: { hp: 799, attackDamage: 225, attackSpeed: 550, armor: 18, magicResist: 15, range: 4, manaPerAttack: 110 },
  op39: { hp: 1096, attackDamage: 110, attackSpeed: 1250, armor: 31, magicResist: 29, range: 2, manaPerAttack: 130 },
  op40: { hp: 1299, attackDamage: 122, attackSpeed: 1250, armor: 38, magicResist: 28, range: 1, manaPerAttack: 100 },
  op41: { hp: 1207, attackDamage: 111, attackSpeed: 1200, armor: 37, magicResist: 28, range: 1, manaPerAttack: 100 },
  op42: { hp: 711, attackDamage: 188, attackSpeed: 1100, armor: 15, magicResist: 20, range: 3, manaPerAttack: 100 },
  op43: { hp: 824, attackDamage: 114, attackSpeed: 1250, armor: 25, magicResist: 28, range: 4, manaPerAttack: 100 },
  op44: { hp: 777, attackDamage: 109, attackSpeed: 1250, armor: 31, magicResist: 25, range: 3, manaPerAttack: 130 },
  op45: { hp: 911, attackDamage: 199, attackSpeed: 1200, armor: 22, magicResist: 25, range: 4, manaPerAttack: 100 },
  op46: { hp: 938, attackDamage: 110, attackSpeed: 1250, armor: 22, magicResist: 33, range: 3, manaPerAttack: 110 },
  op47: { hp: 1613, attackDamage: 159, attackSpeed: 1250, armor: 45, magicResist: 39, range: 3, manaPerAttack: 100 },
  op48: { hp: 1457, attackDamage: 146, attackSpeed: 1250, armor: 40, magicResist: 73, range: 1, manaPerAttack: 100 },
  op49: { hp: 1555, attackDamage: 136, attackSpeed: 1250, armor: 36, magicResist: 29, range: 2, manaPerAttack: 130 },
  op50: { hp: 899, attackDamage: 173, attackSpeed: 1500, armor: 22, magicResist: 25, range: 4, manaPerAttack: 100 },

  // ============================================================
  //  ★ 0.2 追加：MujicaAve 联动五人（数值由用户给定，不是模板推的）
  // ============================================================
  op51: { hp: 541, attackDamage: 49, attackSpeed: 1100, armor: 30, magicResist: 21, range: 1, manaPerAttack: 100 }, // 若叶睦
  op52: { hp: 841, attackDamage: 77, attackSpeed: 1050, armor: 32, magicResist: 24, range: 1, manaPerAttack: 100 }, // 祐天寺若麦
  op53: { hp: 609, attackDamage: 71, attackSpeed: 1200, armor: 20, magicResist: 19, range: 3, manaPerAttack: 100 }, // 三角初华
  op54: { hp: 1377, attackDamage: 101, attackSpeed: 1050, armor: 35, magicResist: 41, range: 2, manaPerAttack: 100 }, // 八幡海铃
  op55: { hp: 1459, attackDamage: 141, attackSpeed: 1250, armor: 31, magicResist: 29, range: 2, manaPerAttack: 100 }, // 丰川祥子
};

/**
 * 星级成长倍率：1800 = 每升一星 ×1.8（三星 = ×3.24）
 *
 * 【为什么要给"每个干员一份"，而不只留两个全局常量？】
 * 因为你可能想让某个干员"升星收益更高"或者"更低"。
 * 现在 50 个都是 1800，所以 UNIT_STAR_BP 里其实全是同一个值 ——
 * 但结构留着，以后要单独调某个干员时不用改代码。
 */
export const STAR_HP_BP = 1800;
export const STAR_DAMAGE_BP = 1800;

/** 每个干员的星级倍率（没写就用上面的默认值） */
export const UNIT_STAR_BP: Record<string, { hpBp: number; damageBp: number }> = {
  op01: { hpBp: 1800, damageBp: 1800 },
  op02: { hpBp: 1800, damageBp: 1800 },
  op03: { hpBp: 1800, damageBp: 1800 },
  op04: { hpBp: 1800, damageBp: 1800 },
  op05: { hpBp: 1800, damageBp: 1800 },
  op06: { hpBp: 1800, damageBp: 1800 },
  op07: { hpBp: 1800, damageBp: 1800 },
  op08: { hpBp: 1800, damageBp: 1800 },
  op09: { hpBp: 1800, damageBp: 1800 },
  op10: { hpBp: 1800, damageBp: 1800 },
  op11: { hpBp: 1800, damageBp: 1800 },
  op12: { hpBp: 1800, damageBp: 1800 },
  op13: { hpBp: 1800, damageBp: 1800 },
  op14: { hpBp: 1800, damageBp: 1800 },
  op15: { hpBp: 1800, damageBp: 1800 },
  op16: { hpBp: 1800, damageBp: 1800 },
  op17: { hpBp: 1800, damageBp: 1800 },
  op18: { hpBp: 1800, damageBp: 1800 },
  op19: { hpBp: 1800, damageBp: 1800 },
  op20: { hpBp: 1800, damageBp: 1800 },
  op21: { hpBp: 1800, damageBp: 1800 },
  op22: { hpBp: 1800, damageBp: 1800 },
  op23: { hpBp: 1800, damageBp: 1800 },
  op24: { hpBp: 1800, damageBp: 1800 },
  op25: { hpBp: 1800, damageBp: 1800 },
  op26: { hpBp: 1800, damageBp: 1800 },
  op27: { hpBp: 1800, damageBp: 1800 },
  op28: { hpBp: 1800, damageBp: 1800 },
  op29: { hpBp: 1800, damageBp: 1800 },
  op30: { hpBp: 1800, damageBp: 1800 },
  op31: { hpBp: 1800, damageBp: 1800 },
  op32: { hpBp: 1800, damageBp: 1800 },
  op33: { hpBp: 1800, damageBp: 1800 },
  op34: { hpBp: 1800, damageBp: 1800 },
  op35: { hpBp: 1800, damageBp: 1800 },
  op36: { hpBp: 1800, damageBp: 1800 },
  op37: { hpBp: 1800, damageBp: 1800 },
  op38: { hpBp: 1800, damageBp: 1800 },
  op39: { hpBp: 1800, damageBp: 1800 },
  op40: { hpBp: 1800, damageBp: 1800 },
  op41: { hpBp: 1800, damageBp: 1800 },
  op42: { hpBp: 1800, damageBp: 1800 },
  op43: { hpBp: 1800, damageBp: 1800 },
  op44: { hpBp: 1800, damageBp: 1800 },
  op45: { hpBp: 1800, damageBp: 1800 },
  op46: { hpBp: 1800, damageBp: 1800 },
  op47: { hpBp: 1800, damageBp: 1800 },
  op48: { hpBp: 1800, damageBp: 1800 },
  op49: { hpBp: 1800, damageBp: 1800 },
  op50: { hpBp: 1800, damageBp: 1800 },
};
