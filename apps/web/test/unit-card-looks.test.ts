/**
 * ============================================================
 *  棋子卡面的两处"看一眼就懂"的视觉规则
 * ============================================================
 *
 * 这两条都是你提的，而且都是**"看不出来就等于没做"**的需求：
 *   · 星级包边（1 星铜、2 星银、3 星金）—— 打起来一堆棋子挤在一起，
 *     原来只在右上角画几个小星星，根本看不清谁是大哥。
 *   · 我方血条绿、敌方血条红，而且**不随血量变红** ——
 *     以前血少了会变黄再变红，结果和"敌人是红的"撞色，
 *     一场混战里分不清"这个红条是敌人"还是"我自己的残血"。
 *
 * 【为什么测的是"颜色函数"而不是"画出来的图"？】
 * 因为卡面是画在 canvas 上的，而 jsdom 没有真正的 canvas 实现 ——
 * 断言像素既麻烦又不稳。但"该选哪个颜色"是纯逻辑，抽成函数就能精确钉死；
 * 配色以后要改，改的是这几个常量，测试会立刻告诉你有没有改坏。
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UNIT_DEFS, EGG_UNIT_ID, isPlayableDef } from '../../../packages/shared/src/index.js';
import {
  MY_HP_COLOR,
  ENEMY_HP_COLOR,
  STAR_COLOR,
  cardBodyColorFor,
  cardColorsFor,
  eggBodyStops,
} from '../src/three/sprite-graphics.js';
import {
  CARD_BODY_ALPHA,
  CARD_H,
  CARD_OPACITY,
  CARD_OPACITY_DRAGGED,
  CARD_WORLD_SCALE,
  CHIBI_FOOT_SCREEN,
  CHIBI_WORLD_H,
  HP_BAR_AREA,
  RENDER_ORDER_CARD,
  RENDER_ORDER_CHIBI,
  RENDER_ORDER_HP,
  RENDER_ORDER_STARS,
  STAR_AREA,
} from '../src/three/card-layout.js';
import {
  HP_BAR_CANVAS_SIZE,
  STAR_CANVAS_SIZE,
  hpBarLocalTransform,
  starLocalTransform,
} from '../src/three/sprite-graphics.js';

/** 随便挑一个正常干员和一个召唤物（配色规则对召唤物不一样） */
const normalDef = UNIT_DEFS['op01']!;
const summonDef = Object.values(UNIT_DEFS).find((def) => def.summonOnly)!;

describe('★ 星级包边：1 铜 / 2 银 / 3 金', () => {
  it('三个星级的外框颜色互不相同', () => {
    const colors = [1, 2, 3].map((star) => cardColorsFor(normalDef, star, true).frameInner);
    expect(new Set(colors).size, `三个星级应该是三种颜色，实际是 ${colors.join(' / ')}`).toBe(3);
  });

  it('颜色符合"铜 / 银 / 金"的直觉（暖色 → 冷白 → 金黄）', () => {
    const hexToRgb = (hex: string): [number, number, number] => [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];

    const bronze = hexToRgb(cardColorsFor(normalDef, 1, true).frameInner);
    const silver = hexToRgb(cardColorsFor(normalDef, 2, true).frameInner);
    const gold = hexToRgb(cardColorsFor(normalDef, 3, true).frameInner);

    // 银：三个通道差不多亮（中性灰白）
    expect(Math.max(...silver) - Math.min(...silver), '银色应该接近中性灰').toBeLessThan(40);
    // 铜：偏红，红 > 蓝
    expect(bronze[0], '铜色应该偏红').toBeGreaterThan(bronze[2] + 40);
    // 金：红绿高、蓝低
    expect(gold[0] > gold[2] + 60 && gold[1] > gold[2] + 40, '金色应该是红绿高、蓝低').toBe(true);
  });

  it('外框有"深色描边 + 亮色内芯"两层，不然在深色棋盘上看不清', () => {
    for (const star of [1, 2, 3]) {
      const { frameEdge, frameInner } = cardColorsFor(normalDef, star, true);
      expect(frameEdge, `第 ${star} 星缺描边色`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(frameInner).toMatch(/^#[0-9a-f]{6}$/i);
      expect(frameEdge, `第 ${star} 星的描边和内芯不该是同一个颜色`).not.toBe(frameInner);
    }
  });

  it('星级越界（0 / 4 / 小数）不会崩，会夹到 1~3', () => {
    for (const star of [0, -1, 4, 2.4]) {
      const { frameInner } = cardColorsFor(normalDef, star, true);
      expect(frameInner).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('召唤物不升星，用中性配色（不冒充铜银金）', () => {
    const summon = cardColorsFor(summonDef, 1, true).frameInner;
    const bronze = cardColorsFor(normalDef, 1, true).frameInner;
    expect(summon).not.toBe(bronze);
  });

  it('包边颜色只看星级，不看是我方还是敌方（队伍靠血条区分）', () => {
    for (const star of [1, 2, 3]) {
      expect(cardColorsFor(normalDef, star, true).frameInner).toBe(
        cardColorsFor(normalDef, star, false).frameInner,
      );
    }
  });
});

describe('★ 血条颜色：我方绿、敌方红，不随血量变化', () => {
  it('我方是绿的、敌方是红的', () => {
    expect(cardColorsFor(normalDef, 1, true).hpBar).toBe(MY_HP_COLOR);
    expect(cardColorsFor(normalDef, 1, false).hpBar).toBe(ENEMY_HP_COLOR);
    expect(MY_HP_COLOR).not.toBe(ENEMY_HP_COLOR);
  });

  it('★ 血条颜色和星级、和血量都无关（这是你要的"不会因为扣血变红"）', () => {
    // 同一方、不同星级 -> 血条颜色一样
    for (const star of [1, 2, 3]) {
      expect(cardColorsFor(normalDef, star, true).hpBar).toBe(MY_HP_COLOR);
    }
    // 注意：血量不参与这个函数 —— 这正是"血少了也不变色"的实现方式。
    // 以前是 ratio > 0.5 ? 绿 : ratio > 0.25 ? 黄 : 红，
    // 于是"敌人红"和"我残血红"撞在一起，分不清是谁。
    expect(cardColorsFor(normalDef, 3, true).hpBar).toBe(cardColorsFor(normalDef, 1, true).hpBar);
  });
});

/**
 * ============================================================
 *  卡面「背景淡、信息实」+ 血条浮在小人之上
 *  （0.0.2 追加需求第 1、2 条）
 * ============================================================
 *
 * 【这一组钉的是"图层关系"，为什么最容易改坏？】
 * 因为第一版是"整张卡乘一个 opacity"，参数只有一个；
 * 现在拆成了三张互相叠的精灵（卡片 → 小人 → 血条），
 * 任何一个数写错，表现都是"某个东西看不见了"，
 * 而且 jsdom 没有真 canvas —— 画不出来，只能把**数字**钉死。
 */
describe('★ 卡面透明度：只淡背景，不淡信息', () => {
  it('卡片精灵整体不再压淡（信息的"淡"不能发生在这一层）', () => {
    expect(CARD_OPACITY, '总体 opacity 必须是 1，否则星级描边/血条/名字会一起变淡').toBe(1);
  });

  it('"背景变淡"是画进贴图里的，而不是整张贴图的 alpha', () => {
    expect(CARD_BODY_ALPHA, '背景得真的变淡，不然小人还是被大色块压住').toBeLessThan(1);
    expect(CARD_BODY_ALPHA, '也不能淡到看不见').toBeGreaterThan(0.15);
  });

  it('拖动时仍然是"整体压淡"（这时候要能看清底下的落点）', () => {
    expect(CARD_OPACITY_DRAGGED).toBeGreaterThan(0);
    expect(CARD_OPACITY_DRAGGED).toBeLessThan(CARD_OPACITY);
  });
});

describe('★ 血条：独立精灵、浮在小人之上', () => {
  it('血条的渲染层级必须比小人高（卡片 0 < 小人 1 < 血条 2）', () => {
    expect(RENDER_ORDER_HP, '血条要压在小人上面').toBeGreaterThan(1);
  });

  it('血条画布比血条本身高（上下留白给描边和发光，否则会被裁成直边）', () => {
    expect(HP_BAR_CANVAS_SIZE.h).toBeGreaterThan(HP_BAR_AREA.h);
    expect(HP_BAR_CANVAS_SIZE.w).toBe(192); // 和卡片同宽
  });

  it('★ 血条精灵摆的位置能反算回 HP_BAR_AREA（像素→center 最容易写错）', () => {
    const t = hpBarLocalTransform();
    // 精灵的宽度比例：血条画布 / 卡片宽
    expect(t.sx).toBeCloseTo(HP_BAR_CANVAS_SIZE.w / 192, 6);
    expect(t.sy).toBeCloseTo(HP_BAR_CANVAS_SIZE.h / CARD_H, 6);
    expect(t.cx, '血条横向居中于卡片').toBe(0.5);

    /*
      反过来验一遍：`center` 的偏移是"视图空间"里的比例，
      换算回卡片像素（y 向下、左上为原点）后，
      应该正好是血条画布的竖直中点 —— 也就是 HP_BAR_AREA 的中心。

      推导（见 hpBarLocalTransform 的注释）：
        视图空间偏移（以卡片高度为单位） = (0.5 - cy) * sy
        换算成卡片像素 = (0.5 - (0.5 - cy) * sy) * CARD_H
      这条能抓住"符号翻反了 / 拿错了基准"这类错。
    */
    const centerYpx = (0.5 - (0.5 - t.cy) * t.sy) * CARD_H;
    expect(centerYpx).toBeCloseTo(HP_BAR_AREA.y + HP_BAR_AREA.h / 2, 6);
    // 而且留白上下对称，说明画布确实是"以血条为中心"
    expect(centerYpx - HP_BAR_AREA.h / 2 - HP_BAR_AREA.pad).toBeCloseTo(HP_BAR_AREA.y - HP_BAR_AREA.pad, 6);
  });

  it('血条在卡片内、而且贴着卡面下沿（下边 = 卡面下沿 - 留白）', () => {
    expect(HP_BAR_AREA.y, '血条要明显靠下（在卡片下半部分）').toBeGreaterThan(CARD_H * 0.6);
    expect(HP_BAR_AREA.y + HP_BAR_AREA.h).toBeLessThanOrEqual(CARD_H);
    expect(HP_BAR_AREA.x).toBeGreaterThan(0);
    expect(HP_BAR_AREA.x + HP_BAR_AREA.w).toBeLessThanOrEqual(192);
    /*
      ★ 血条画布的底边正好落在卡面下沿：
      画布底 = (y + h) + pad = CARD_H —— 这样血条就是"卡面最下方"那条，
      小人被抬到它上方（CHIBI_FOOT_SCREEN < 血条上沿），两者不重叠。
    */
    expect(HP_BAR_AREA.y + HP_BAR_AREA.h + HP_BAR_AREA.pad).toBe(CARD_H);
  });
});

/**
 * ============================================================
 *  ★ 版式不冲突：小人站在血条上方（拿**真实素材清单**逐个干员算一遍）
 * ============================================================
 *
 * 【为什么要逐个算，而不是"看着差不多"？】
 * 小人的"脚底"并不在设计框底边上 —— 渲染器为了让挥武器/倒地不裁切，
 * 把设计框撑大到 170 之类的整数，于是**待机内容底边比设计框底边高 5~7 个画布像素**
 * （这个数字每个干员都不一样，写在清单的 debug.boxes.idle 里）。
 *
 * 血条（HP_BAR_AREA）和站位（CHIBI_FOOT_SCREEN）是两个独立的常量，
 * 以后谁改一个都可能让"小人的脚踩到血条上"。
 * 所以这里用**真实的 49 套清单**把两边的换算跑一遍，把"不重叠"变成一条可执行的规则。
 *
 * 素材没下载过的仓库（干净的 clone）会跳过 —— 和游戏里的三级降级是一个态度：
 * 没有小人素材也必须能跑测试。
 */
describe('★ 版式：血条在卡面最下方，小人在它上方', () => {
  const chibiDir = fileURLToPath(new URL('../public/assets/chibi/', import.meta.url));
  const manifests: { charId: string; cell: { w: number; h: number }; box?: { x: number; y: number; w: number; h: number }; debug?: { boxes?: { idle?: { x: number; y: number; w: number; h: number } } } }[] =
    existsSync(chibiDir)
      ? readdirSync(chibiDir)
          .map((name) => join(chibiDir, name, 'manifest.json'))
          .filter((p) => existsSync(p))
          .map((p) => JSON.parse(readFileSync(p, 'utf8')))
      : [];

  /** 血条最上面那根亮描边的位置（描边比条子本身外扩 2px），单位是"卡面高度的比例" */
  const barTop = (HP_BAR_AREA.y - 2) / CARD_H;

  it.skipIf(manifests.length === 0)('每个干员的待机动作底边都在血条上沿之上', () => {
    const bad: string[] = [];
    for (const m of manifests) {
      const box = m.box && m.box.h > 0 ? m.box : { x: 0, y: 0, w: m.cell.w, h: m.cell.h };
      const idle = m.debug?.boxes?.idle;
      const idleBottom = idle ? idle.y + idle.h : box.y + box.h;

      // 画布像素 → 世界单位 → 卡面高度的比例（和 chibi.ts 的 layoutChibi 同一套换算）
      const worldH = CHIBI_WORLD_H * (m.cell.h / box.h);
      const gap = (((box.y + box.h - idleBottom) * worldH) / m.cell.h) / CARD_WORLD_SCALE.y;
      const feet = CHIBI_FOOT_SCREEN - gap;

      if (feet > barTop) bad.push(`${m.charId}(脚底 ${feet.toFixed(3)} > 血条上沿 ${barTop.toFixed(3)})`);
    }
    expect(bad, `这些干员的脚会踩到血条上：${bad.join('、')}`).toEqual([]);
  });

  it('设计框底边本身也要在血条矩形上方（不然小人一定是压着血条的）', () => {
    expect(CHIBI_FOOT_SCREEN).toBeLessThan((HP_BAR_AREA.y + 2) / CARD_H);
  });
});

/**
 * ============================================================
 *  ★ 每个干员都必须能挂上 Q 版小人
 * ============================================================
 *
 * 【为什么需要这条？】菲亚梅塔曾经"没有小人"，但素材其实一直都在 ——
 * 原因是 unit-data.ts 里她的 charId 行被**上一行的行注释吞掉**了：
 *
 *     op27: 'char_4230_mcnist', // 机械师  op28: 'char_300_phenxi', // 菲亚梅塔
 *
 * `//` 一直吃到行尾，`op28` 这个键在对象里根本不存在，
 * `CHAR_IDS['op28']` 得到 undefined，客户端就静默回退到半身像。
 * 既不报错、也不影响编译和 565 个测试 —— 纯靠肉眼看棋子才能发现。
 *
 * 所以这里把"每个干员都要有 charId"钉成一条规则，顺便校验
 * 素材目录里的清单和索引跟 charId 对得上（三者不一致也是同一类事故）。
 */
describe('★ 每个干员都有 charId，且能对上 Q 版小人素材', () => {
  const chibiDir = fileURLToPath(new URL('../public/assets/chibi/', import.meta.url));
  const indexPath = join(chibiDir, 'index.json');
  const index: Record<string, string> = existsSync(indexPath)
    ? JSON.parse(readFileSync(indexPath, 'utf8'))
    : {};

  /**
   * 正式干员（排除召唤物和野怪）。
   *
   * ★ 0.0.3：野怪也用 charId 挂小人素材（enemy_1007_slime 这种），
   * 但它们 **不是** opNN 干员：编号规则、素材来源（Ark-Models 的 models_enemies）
   * 都不一样。所以这组「干员一致性」断言必须把它们排除，
   * 野怪素材由 monster-data.test.ts 单独盯着。
   *
   * ★ 0.3.2：升变形态（ascendOnly）同理排除 —— 它们不是商店名单里的棋子，
   *   素材**另走一条路**（炉芯终曲用的是敌方 Boss `enemy_2092_skzamy`），
   *   由 `ascension.test.ts` 单独盯着。判据统一用 `isPlayableDef()`。
   */
  const operators = Object.values(UNIT_DEFS).filter((def) => isPlayableDef(def));

  it('正式干员正好 55 个（编号 op01..op55，0.2 追加 MujicaAve 五人），另外还有 1 个彩蛋', () => {
    /*
      ★ 彩蛋棋子「维维美·绝对主角」也在这一组里（它同样挂官方小人素材），
      但它不是 opNN 干员：20 费、没有星级机制、没有羁绊。
      所以数量断言要拆成"50 个正式 + 1 个彩蛋"。
      下面那些"charId 唯一 / 与素材索引一致"的断言**照旧覆盖它** ——
      这正是把它留在这个数组里的原因（它的小人素材也得对得上）。
    */
    const normal = operators.filter((def) => def.noStar !== true);
    const eggs = operators.filter((def) => def.noStar === true);
    expect(normal.length).toBe(55);
    expect(eggs.map((def) => def.id)).toEqual(['egg_mvm']);
  });

  it('每个正式干员的 charId 都有值（被注释吞掉就会在这里失败）', () => {
    const missing = operators.filter((def) => !def.charId).map((def) => `${def.id}(${def.name})`);
    expect(
      missing,
      `这些干员没有 charId，游戏里会回退成半身像：${missing.join('、')}\n` +
        `常见原因：CHAR_IDS 里那一行被上一行的 // 注释吃掉了，一个键必须独占一行。`,
    ).toEqual([]);
  });

  it('charId 全局唯一（复制粘贴改漏名字会让两个干员共用一套小人）', () => {
    const seen = new Map<string, string[]>();
    for (const def of operators) {
      if (!def.charId) continue;
      seen.set(def.charId, [...(seen.get(def.charId) ?? []), def.id]);
    }
    const dup = [...seen.entries()].filter(([, ids]) => ids.length > 1);
    expect(dup.map(([charId, ids]) => `${charId} → ${ids.join('/')}`)).toEqual([]);
  });

  it.skipIf(Object.keys(index).length === 0)('charId 与素材索引 / 清单三者一致', () => {
    const bad: string[] = [];
    /*
      ★ 0.2 曾经的待办清单（现已清空）：
      MujicaAve 五人的 spine 素材**早就躺在仓库里**，之前抓不到是因为
      `raw.githubusercontent.com` / `cdn.jsdelivr.net` 双双被网络挡住（返回 000，不是 404）。
      给 `fetch-chibi.ts` 加了 GitHub 加速镜像兜底之后，五个都抓到了、也渲染完了。
      ★ 这里保持"不留豁免名单"：以后再有人漏抓，这条测试照样红。
    */
    const CHIBI_MISSING = new Set<string>();
    for (const def of operators) {
      if (!def.charId) continue;
      if (CHIBI_MISSING.has(def.id)) continue;
      const indexed = index[def.id];
      if (indexed === undefined) {
        bad.push(`${def.id} 不在 index.json 里`);
        continue;
      }
      if (indexed !== def.charId) bad.push(`${def.id} index.json 是 ${indexed}，代码里是 ${def.charId}`);

      const manifestPath = join(chibiDir, def.id, 'manifest.json');
      if (!existsSync(manifestPath)) {
        bad.push(`${def.id} 缺 manifest.json`);
        continue;
      }
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { charId?: string };
      if (manifest.charId !== def.charId) {
        bad.push(`${def.id} manifest 是 ${manifest.charId}，代码里是 ${def.charId}`);
      }
    }
    expect(bad, `这些干员的小人素材对不上：${bad.join('；')}`).toEqual([]);
  });
});

/**
 * ============================================================
 *  0.0.2 追加：卡面透明度 / 星级置顶 / 卡面颜色跟星级走
 * ============================================================
 *
 * 三条都是"看一眼就懂、但很难用单元测试描述"的视觉需求。
 * 能测的部分是**配色和层级的选择逻辑**（画到 canvas 上的像素在 jsdom 里验不了）：
 *   · 底面卡面要淡到什么程度
 *   · 星星是什么颜色
 *   · 卡面底色和星级怎么对应
 *   · 四张精灵谁压谁
 * 把这些规则钉住，以后谁调配色，测试会立刻告诉你有没有越界。
 */
describe('★ 卡面：透明度、星级图层与卡面配色', () => {
  const hexToRgb = (hex: string): [number, number, number] => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
  /** 感知亮度（0~255），用来比较"哪一档更亮" */
  const luma = (hex: string): number => {
    const [r, g, b] = hexToRgb(hex);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  it('底面卡面透明度降到原来的一半左右（0.42 → 0.21）', () => {
    // 需求原话："将底面卡面透明度降低 50% 左右"
    expect(CARD_BODY_ALPHA).toBeLessThan(0.3);
    expect(CARD_BODY_ALPHA).toBeGreaterThan(0.1);
    // 卡片精灵自身仍然恒为 1（淡的是画进贴图里的背景，不是整张卡）
    expect(CARD_OPACITY).toBe(1);
  });

  it('★ 星级精灵的层级在所有东西之上：星级 > 血条 > 小人 > 卡片', () => {
    expect(RENDER_ORDER_STARS).toBeGreaterThan(RENDER_ORDER_HP);
    expect(RENDER_ORDER_HP).toBeGreaterThan(RENDER_ORDER_CHIBI);
    expect(RENDER_ORDER_CHIBI).toBeGreaterThan(RENDER_ORDER_CARD);
  });

  it('★ 星星是暗红色（不是原来的金色）', () => {
    const [r, g, b] = hexToRgb(STAR_COLOR.fill);
    expect(r, `R 通道应该是最大的一档（红为主），实际 ${STAR_COLOR.fill}`).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
    // "暗"：不能是亮红/粉红，整体亮度要压下来
    expect(luma(STAR_COLOR.fill)).toBeLessThan(110);
    // 而且不能再是金色（金的话 G 会接近 R）
    expect(r - g).toBeGreaterThan(60);
  });

  it('★ 卡面底色跟星级对应：1 暗铜 / 2 银 / 3 金，且三档互不相同', () => {
    const bodies = [1, 2, 3].map((star) => cardBodyColorFor(normalDef, star));
    expect(new Set(bodies).size, `三档应该是三种颜色，实际 ${bodies.join(' / ')}`).toBe(3);

    const [one, two, three] = bodies.map(luma);
    // 明度递增：暗铜最暗、金最亮（"暗铜"这个"暗"字必须体现出来）
    expect(one!).toBeLessThan(two!);
    expect(two!).toBeLessThan(three!);

    // 1 星（暗铜）的色相：红 > 绿 > 蓝，偏暖
    const [r1, g1, b1] = hexToRgb(bodies[0]!);
    expect(r1).toBeGreaterThan(g1);
    expect(g1).toBeGreaterThan(b1);

    // 2 星（银）是低饱和色：三通道接近
    const [r2, g2, b2] = hexToRgb(bodies[1]!);
    expect(Math.max(r2, g2, b2) - Math.min(r2, g2, b2), '银色应该是低饱和的').toBeLessThan(40);

    // 3 星（金）是暖色：红绿都明显高于蓝
    const [r3, g3, b3] = hexToRgb(bodies[2]!);
    expect(r3).toBeGreaterThan(b3);
    expect(g3).toBeGreaterThan(b3 + 30);
  });

  it('卡面底色不再跟着"定位色"走（否则和星级配色打架）', () => {
    // 同一个定位、不同星级 → 底色必须不同
    const sameRoleDifferentStar = [1, 2, 3].map((star) => cardBodyColorFor(normalDef, star));
    expect(new Set(sameRoleDifferentStar).size).toBe(3);
    // 定位色本身还在（商店/备战席那些 2D 界面仍然用它），只是不再画到卡面上
    expect(normalDef.color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('召唤物没有星级，卡面用中性色、不跟着星级变', () => {
    const summon = Object.values(UNIT_DEFS).find((def) => def.summonOnly)!;
    expect(cardBodyColorFor(summon, 1)).toBe(cardBodyColorFor(summon, 3));
  });

  it('星级贴图的竖直中点落在 STAR_AREA 的中心（换算别写错）', () => {
    const t = starLocalTransform();
    const f = (STAR_AREA.y + STAR_AREA.h / 2) / CARD_H;
    // 反推：视图空间里的位移 = (0.5 - cy) * sy，应该等于 (0.5 - f)
    expect((0.5 - t.cy) * t.sy).toBeCloseTo(0.5 - f, 10);
    expect(t.sx).toBeCloseTo(STAR_CANVAS_SIZE.w / 192, 10);
    expect(t.sy).toBeCloseTo(STAR_CANVAS_SIZE.h / 256, 10);
    // 画布做满卡片宽 → 横向居中，和血条同一套
    expect(t.cx).toBe(0.5);
  });

  it('星级和血条的摆放用的是同一套换算（都是 center 偏移，不是 position）', () => {
    for (const t of [starLocalTransform(), hpBarLocalTransform()]) {
      expect(Number.isFinite(t.cx)).toBe(true);
      expect(Number.isFinite(t.cy)).toBe(true);
      expect(t.sx).toBeGreaterThan(0);
      expect(t.sy).toBeGreaterThan(0);
    }
    // 两张贴图的 y 区间不重叠：星级在上边、血条在下边
    expect(STAR_AREA.y + STAR_AREA.h).toBeLessThan(HP_BAR_AREA.y);
  });
});

// ============================================================
//  ★ 彩蛋棋子「维维美·绝对主角」：卡面炫彩
// ============================================================
/*
  【用户的原话】"在商店边框为炫彩的感觉，以浅蓝和淡紫色、分数渐变为主，
  干员背景卡面同样"。

  这里的断言只盯**颜色逻辑**（改配色时会立刻发现）：
    · 它的底色不能和"1 铜 / 2 银 / 3 金"任何一档撞
    · 炫彩必须是"多色标来回过渡"，两色渐变不叫炫彩
    · 它没有星级机制，所以 1/2/3 星应该拿到**同一个**底色
*/
describe('★ 彩蛋棋子：卡面炫彩（浅蓝 ↔ 淡紫）', () => {
  const eggDef = UNIT_DEFS[EGG_UNIT_ID]!;

  const rgb = (hex: string): [number, number, number] => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];

  it('底色不等于任何一档金属色（铜 / 银 / 金）', () => {
    const body = cardBodyColorFor(eggDef, 1);
    for (const star of [1, 2, 3]) {
      expect(body, `和 ${star} 星的金属色撞了`).not.toBe(cardBodyColorFor(normalDef, star));
    }
  });

  it('炫彩 = 至少 4 档色标来回过渡（不是两色渐变）', () => {
    const stops = eggBodyStops();
    expect(stops.length).toBeGreaterThanOrEqual(4);
  });

  it('每一档都落在"浅蓝 ~ 淡紫"里（蓝通道最高、红绿也不低）', () => {
    for (const [, color] of eggBodyStops()) {
      const [r, g, b] = rgb(color);
      expect(b, `${color} 的蓝通道该很高（浅蓝/淡紫都是"亮"的）`).toBeGreaterThan(220);
      expect(r, `${color} 的红通道不能太低（淡紫要靠它）`).toBeGreaterThan(130);
      expect(g, `${color} 的绿通道也不能太低（太深就不"浅"了）`).toBeGreaterThan(170);
      expect(b, `${color} 应该偏蓝紫（蓝 > 红）`).toBeGreaterThan(r);
    }
  });

  it('相邻两档颜色真的不同（否则"多色"是假的）', () => {
    const stops = eggBodyStops();
    for (let i = 1; i < stops.length; i++) {
      expect(stops[i]![1], `第 ${i} 档和第 ${i - 1} 档颜色一样`).not.toBe(stops[i - 1]![1]);
    }
  });

  it('它没有星级机制：1/2/3 星拿到的是同一档炫彩', () => {
    expect(cardBodyColorFor(eggDef, 1)).toBe(cardBodyColorFor(eggDef, 3));
    // 对照：正常干员仍然是三档不同的金属色
    expect(cardBodyColorFor(normalDef, 1)).not.toBe(cardBodyColorFor(normalDef, 3));
  });
});
