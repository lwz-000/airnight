import type { UnitDef } from './types.js';

/**
 * ============================================================
 *  稀有度配色（按费用分档）
 * ============================================================
 *
 * 自走棋的通用配色，玩家一眼就能从边框颜色判断这个棋子值几费：
 *
 *   1 费 → 白色      2 费 → 绿色      3 费 → 蓝色
 *   4 费 → 紫色      5 费 → 金色
 *
 * 【为什么放在 shared 里，而不是直接写在样式表里？】
 * 因为「稀有度颜色」在好几处都要用：
 *   · 商店卡片的边框
 *   · 棋子卡面的边框
 *   · 未来的图鉴 / 战绩界面
 * 如果每处各写一份，改配色时就会漏掉几处。
 * 集中在这里，改一次全场生效。
 *
 * 这里同时给出「基础色」和「亮色」：
 *   base  用于边框、色块
 *   glow  用于发光、高亮（比 base 亮，适合做光晕和文字）
 */

export interface RarityStyle {
  /** 中文档位名，界面提示用 */
  label: string;
  /** 主色（边框、色块） */
  base: string;
  /** 亮色（发光、高亮文字） */
  glow: string;
  /** 半透明底色，用于卡片背景的色调 */
  wash: string;
}

/** 5 档稀有度配色。索引 = 费用 - 1 */
export const RARITY_STYLES: RarityStyle[] = [
  {
    label: '普通',
    base: '#d8dde8',
    glow: '#ffffff',
    wash: 'rgba(216, 221, 232, 0.14)',
  },
  {
    label: '精良',
    base: '#4ad06a',
    glow: '#7bf59a',
    wash: 'rgba(74, 208, 106, 0.16)',
  },
  {
    label: '稀有',
    base: '#3d9bff',
    glow: '#7cbcff',
    wash: 'rgba(61, 155, 255, 0.18)',
  },
  {
    label: '史诗',
    base: '#a866ff',
    glow: '#c99bff',
    wash: 'rgba(168, 102, 255, 0.20)',
  },
  {
    label: '传说',
    base: '#ffc23d',
    glow: '#ffdd8a',
    wash: 'rgba(255, 194, 61, 0.22)',
  },
];

/**
 * 取某个费用对应的稀有度样式。
 * 费用超出 1~5 时，向两端夹取（免得以后出了 6 费导致颜色变成 undefined）。
 */
export function rarityOfCost(cost: number): RarityStyle {
  const index = Math.max(0, Math.min(RARITY_STYLES.length - 1, Math.floor(cost) - 1));
  return RARITY_STYLES[index]!;
}

/** 取某个棋子的稀有度样式 */
export function rarityOf(def: UnitDef): RarityStyle {
  return rarityOfCost(def.cost);
}
