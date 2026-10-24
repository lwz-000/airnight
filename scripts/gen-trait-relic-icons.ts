/**
 * ============================================================
 *  ★★ 0.3.3：羁绊图标 + 转职藏品图标（统一重画）
 * ============================================================
 *
 * 【用户口径】"将羁绊全部重画，风格就用图标（失）这种" + "还有羁绊转职藏品"。
 * 也就是：**游戏图标那套视觉语言**（`scripts/make-app-icon.py` 出的 `favicon.ico`）：
 *
 *      近黑底（#0a0c0f） + 四角"取景框"细线（每条边中间留缺口） + 一个大字
 *
 * 这里的"大字"是**字标**（和图标上的「失」同一件事）：一个汉字，一眼认得出，
 * 缩到 22px 也不糊。21 个羁绊各一个字，映射表在本文件下方 `GLYPHS`（唯一出处）。
 *
 * ============================================================
 *  【为什么羁绊图标要出**两态**（灰 / 荧光）？】
 * ============================================================
 * 0.3 的配色口径是"荧光黄绿只做系统高亮（选中 / 激活 / 进度 / 可交互）"。
 * 羁绊列表一次会列出十几二十行，如果每行的图标都是荧光绿，
 * 那"亮了"就不再是信息 —— 玩家看不出哪个羁绊**现在生效**。
 * 所以：
 *   · `off`（未生效）= 冷灰字 + 暗框；
 *   · `on`（已生效 / 满级）= 荧光字 + 亮一档的框。
 * 两态走同一套几何，所以"切换状态"只是颜色变、形状不变。
 *
 * ============================================================
 *  【转职藏品为什么**不**写羁绊名？】
 * ============================================================
 * 试过在牌面底部加一行小字，量了一下：藏品格里图标实际只有 ~48px 宽，
 * 那行字会被压到 3px —— 不是"信息"，是噪点。
 * 所以和游戏图标保持一致：**一图一字**。名字由界面负责（tooltip / 详情卡），
 * 图标只负责"这是哪个羁绊的转职"，而那个字和羁绊列表里那颗是同一個。
 *
 * ============================================================
 *  【为什么还是用 Edge 截图？】
 * ============================================================
 * 要渲染汉字。Node 里没有字体引擎，手写 PNG 编码器画不出"萨"字。
 * 浏览器本来就在这台机器上（真机只有 Edge），一页一图最省事 ——
 * 和 `render-chibi.mjs` 是同一个思路。
 *
 * 【产物】
 *   apps/web/public/assets/traits/<traitId>.png           128×128  未生效态
 *   apps/web/public/assets/traits/<traitId>-on.png        128×128  已生效态
 *   apps/web/public/assets/items/itm_relic_<traitId>.png  144×178  转职藏品
 *
 * ★ 尺寸不能乱改：藏品 144×178 是藏品格子的既有规格（`itm_*.png` 全是这个），
 *   羁绊 128 是"列表里显示 22px"按 ~5.8 倍下采样留的余量。
 *
 * 用法：
 *   node node_modules/tsx/dist/cli.mjs scripts/gen-trait-relic-icons.ts
 *   ... --only=healing,cannon      # 只重做这几个（调字/调色时用）
 *   ... --force                    # 已存在的也重做
 *   ... --traits / --relics        # 只做其中一类
 *
 * ★ 变形同构体（itm_morph_relic）**不归这里管**：
 *   它有官方美术，见 `scripts/fetch-item-icons.ts` 的 `SFS_ICONS`。
 *   以前这里也给它画过占位图，"谁最后跑谁赢"导致真图被盖掉过一次。
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TRAIT_RELICS } from '../packages/shared/src/item-data.js';
import { TRAIT_DEFS } from '../packages/shared/src/trait-data.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TRAIT_DIR = join(ROOT, 'apps', 'web', 'public', 'assets', 'traits');
const ITEM_DIR = join(ROOT, 'apps', 'web', 'public', 'assets', 'items');
const TMP_DIR = join(ROOT, '.icon-tmp');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

/** 羁绊图标边长（列表里显示 22px） */
const TRAIT_SIZE = 128;
/** 转职藏品：和其余藏品图标一致（藏品格是竖的） */
const RELIC_W = 144;
const RELIC_H = 178;

const argv = process.argv.slice(2);
const force = argv.includes('--force');
const onlyArg = argv.find((a) => a.startsWith('--only'));
const only = onlyArg
  ? (onlyArg.includes('=') ? onlyArg.split('=')[1] : argv[argv.indexOf(onlyArg) + 1]).split(',')
  : null;
const doTraits = !argv.includes('--relics');
const doRelics = !argv.includes('--traits');

if (!existsSync(EDGE)) {
  console.error(`找不到 Edge：${EDGE}\n（本机只有 Edge 能渲染汉字，换成你机器上的路径再跑）`);
  process.exit(1);
}

// ============================================================
//  一、字标：21 个羁绊各一个字（唯一出处）
// ============================================================
/**
 * 挑选原则（三条，按优先级）：
 *   ① **不重复、不撞形**：缩到 22px 时笔画多的字会糊成一团，
 *      所以刻意让同义的那几个分开用（法术→法 / 术士→术）；
 *   ② **一眼认得出是哪个羁绊**：优先用羁绊名里的字，不硬凑漂亮的字；
 *   ③ 名字里没有能代表的字时用核心意象（骑士之国 → 骑、乐队 → 音）。
 *
 * ★ 想改某个羁绊的图标：只改这里一个字，然后 `--only=<id> --force` 重出一张。
 */
const GLYPHS: Record<string, string> = {
  sarkaz: '萨', // 萨卡兹
  kazimierz: '骑', // 卡西米尔（骑士之国）
  laterano: '圣', // 拉特兰（圣城 / 教皇）
  rhodes: '岛', // 罗德岛
  victoria: '维', // 维多利亚
  yan: '炎', // 炎
  dragon: '龙', // 龙
  flying: '飞', // 飞行
  swordsman: '剑', // 剑豪
  guard: '卫', // 近卫
  arts: '法', // 法术
  merchant: '商', // 奸商
  support: '援', // 支援
  healing: '愈', // 治疗（"愈"比"治"更不容易和别的字混）
  defender: '盾', // 重装
  leader: '令', // 领导人（号令）
  cannon: '炮', // 炮手
  caster: '术', // 术士
  ranged: '远', // 远射
  mujica: '音', // MujicaAve（乐队）
  unyielding: '韧', // 不屈
};

// ============================================================
//  二、画一张图（黑底 + 四角取景框 + 字标）
// ============================================================
const BG = '#0a0c0f';
/** 未生效态：冷灰字 / 暗框 */
const OFF = { glyph: '#b9c0c8', frame: '#333a42' };
/** 已生效态：荧光黄绿（就是 theme-ark.css 的 --hl） */
const ON = { glyph: '#c9fa43', frame: '#4e5c22' };

/**
 * 一张图的 HTML（内联 SVG）。
 *
 * 【为什么用 SVG 而不是 div + border？】
 * 四角取景框是 8 条**精确对齐**的短线（每条边从两端各画一截、中间留缺口），
 * 用 div 拼要写 8 个绝对定位元素、还得各自算宽高；
 * SVG 里就是 8 个 `<line>`，坐标按 0~100 的比例写，换尺寸不用改一行。
 */
function iconHtml(input: {
  w: number;
  h: number;
  glyph: string;
  glyphColor: string;
  frameColor: string;
  /** 字标字号（占宽度的比例） */
  glyphScale: number;
}): string {
  const { w, h, glyph, glyphColor, frameColor, glyphScale } = input;
  // SVG 坐标系：宽固定 100，高按真实比例换算（这样线宽不会在竖图上被拉粗）
  const vbH = Math.round(((100 * h) / w) * 100) / 100;
  const pad = 9;
  /** 每条边从角落往中间画多长（剩下的就是中间的缺口） */
  const len = 20;
  const sw = 3;
  const line = (x1: number, y1: number, x2: number, y2: number): string =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />`;
  const frame = [
    // 上边：左段 + 右段
    line(pad, pad, pad + len, pad),
    line(100 - pad - len, pad, 100 - pad, pad),
    // 下边
    line(pad, vbH - pad, pad + len, vbH - pad),
    line(100 - pad - len, vbH - pad, 100 - pad, vbH - pad),
    // 左边
    line(pad, pad, pad, pad + len),
    line(pad, vbH - pad - len, pad, vbH - pad),
    // 右边
    line(100 - pad, pad, 100 - pad, pad + len),
    line(100 - pad, vbH - pad - len, 100 - pad, vbH - pad),
  ].join('');

  // 字标永远居中（不管方图还是竖图）—— 竖图的留白由字体本身的字面框决定
  const glyphY = vbH / 2;
  const glyphPx = Math.round(w * glyphScale);

  return `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; width: ${w}px; height: ${h}px; overflow: hidden; background: ${BG}; }
  svg { display: block; }
</style></head>
<body>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 100 ${vbH}">
  <rect x="0" y="0" width="100" height="${vbH}" fill="${BG}" />
  <g stroke="${frameColor}" stroke-width="${sw}" stroke-linecap="square">${frame}</g>
  <text x="50" y="${glyphY}" text-anchor="middle" dominant-baseline="central"
        font-size="${glyphPx}" fill="${glyphColor}"
        font-family="'Microsoft YaHei','SimHei',sans-serif" font-weight="700">${glyph}</text>
</svg>
</body></html>`;
}

/** 截一张图（一次 Edge 冷启动约 0.6~1 秒；61 张一分钟左右，只有 --force 才全量重画） */
function shoot(dest: string, html: string, w: number, h: number, name: string): void {
  if (!force && existsSync(dest)) {
    console.log(`  · ${name} 已存在，跳过（--force 可覆盖）`);
    return;
  }
  mkdirSync(TMP_DIR, { recursive: true });
  const htmlPath = join(TMP_DIR, `${name}.html`);
  writeFileSync(htmlPath, html, 'utf8');
  execFileSync(
    EDGE,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      `--window-size=${w},${h}`,
      // 每次用一个独立 profile，免得和正在开着的 Edge 抢锁
      `--user-data-dir=${join(TMP_DIR, 'profile')}`,
      `--screenshot=${dest}`,
      pathToFileURL(htmlPath).href,
    ],
    { stdio: 'ignore' },
  );
  console.log(`  ✓ ${name}`);
}

// ============================================================
//  三、出图
// ============================================================
mkdirSync(TRAIT_DIR, { recursive: true });
mkdirSync(ITEM_DIR, { recursive: true });

const missing = Object.keys(TRAIT_DEFS).filter((id) => !GLYPHS[id]);
if (missing.length > 0) {
  console.error(`有羁绊没配字标（会出一张空图）：${missing.join(', ')}\n去 GLYPHS 里补上。`);
  process.exit(1);
}

if (doTraits) {
  console.log(`羁绊图标 -> ${TRAIT_DIR}`);
  for (const id of Object.keys(TRAIT_DEFS)) {
    if (only && !only.includes(id)) continue;
    const glyph = GLYPHS[id]!;
    for (const state of ['off', 'on'] as const) {
      const palette = state === 'on' ? ON : OFF;
      const name = state === 'on' ? `${id}-on` : id;
      shoot(
        join(TRAIT_DIR, `${name}.png`),
        iconHtml({
          w: TRAIT_SIZE,
          h: TRAIT_SIZE,
          glyph,
          glyphColor: palette.glyph,
          frameColor: palette.frame,
          glyphScale: 0.54,
        }),
        TRAIT_SIZE,
        TRAIT_SIZE,
        `trait-${name}`,
      );
    }
  }
}

if (doRelics) {
  console.log(`转职藏品 -> ${ITEM_DIR}`);
  for (const relic of TRAIT_RELICS) {
    const trait = TRAIT_DEFS[relic.grantsTrait!]!;
    if (only && !only.includes(trait.id)) continue;
    shoot(
      join(ITEM_DIR, `${relic.icon}.png`),
      iconHtml({
        w: RELIC_W,
        h: RELIC_H,
        glyph: GLYPHS[trait.id]!,
        // 藏品是"拿到手"的东西，直接用荧光态（列表里的灰字是另一种场合）
        glyphColor: ON.glyph,
        frameColor: ON.frame,
        // 竖图用 0.40：字面框本身有留白，比方图的比例再大一点才和方图看起来一样大
        glyphScale: 0.4,
      }),
      RELIC_W,
      RELIC_H,
      `relic-${relic.icon}`,
    );
  }
}

/*
  ★ 变形同构体（itm_morph_relic）不在这里 —— 它有官方美术，见文件头。
*/
rmSync(TMP_DIR, { recursive: true, force: true });
console.log('完成。');
