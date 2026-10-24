// @vitest-environment jsdom
/**
 * ============================================================
 *  棋子精灵的「换内容」（restyle）与「小人兜底」
 * ============================================================
 *
 * 【为什么值得单独一个文件？】
 * 这里钉的是两个玩家肉眼可见的 bug：
 *
 *  1. **对手的模型"过期"** —— 对手阵容每个回合都在同一个座位上换人 / 升星，
 *     而布阵同步对这种情况调的是 `updateUnitSprite`。那个函数一看
 *     "血量档没变、特效没变"就直接 return，于是卡面、星级、小人
 *     **一样都没换** —— 座位上坐的是新干员，画面上还是上一个。
 *     修复是新增 `restyleUnitSprite`，四件事一次做齐（数据 / 卡面 / 星级 / 小人）。
 *
 *  2. **模型"丢失"（一格空白）** —— 卡面的立绘区只有在小人**真的播起来了**
 *     之后才允许留空；以前是"有素材就留空"，小人加载一失败就是空白一格。
 *     现在从 `chibiReady = false` 出发，靠 chibi 的回调翻转。
 *
 * 【为什么能测？—— 用"贴图缓存的身份"当观察点】
 * `getUnitTexture(...)` 对同一组参数返回**同一个** Texture 对象（有缓存），
 * 所以"`material.map` 是不是新干员的那张贴图"可以直接用对象相等断言，
 * 不需要真的看 canvas 画了什么（jsdom 没有真 canvas）。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { Sprite, type Texture } from 'three';
import { UNIT_DEFS, monsterDefs } from '../../../packages/shared/src/index.js';
import {
  NO_EFFECTS,
  createUnitSprite,
  getUnitTexture,
  restyleUnitSprite,
} from '../src/three/sprite-graphics.js';
import { detachChibi } from '../src/three/chibi.js';

/** jsdom 没有 canvas 实现，给个"什么都能调、什么都不画"的桩（同 netplay-ui.test.ts） */
const contextStub = new Proxy(
  {},
  {
    get: (_target, prop) => {
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
        return () => ({ addColorStop: () => undefined });
      }
      if (prop === 'measureText') return () => ({ width: 10 });
      return () => undefined;
    },
    set: () => true,
  },
) as unknown as CanvasRenderingContext2D;

beforeEach(() => {
  window.HTMLCanvasElement.prototype.getContext = (() => contextStub) as never;
});

const opA = UNIT_DEFS['op01']!;
const opB = UNIT_DEFS['op02']!;
const summonDef = Object.values(UNIT_DEFS).find((def) => def.summonOnly)!;

describe('★ 卡面贴图：留空与立绘是两张不同的图（"模型丢失"的防线）', () => {
  it('同一个干员的"带立绘"和"立绘区留空"是两份缓存，绝不会互相串', () => {
    const withPortrait = getUnitTexture(opA, 1, 0, NO_EFFECTS, false);
    const blank = getUnitTexture(opA, 1, 0, NO_EFFECTS, true);
    expect(withPortrait).not.toBe(blank);

    // 同参数取两次必须是同一个对象（缓存生效，重画一次就够了）
    expect(getUnitTexture(opA, 1, 0, NO_EFFECTS, false)).toBe(withPortrait);
    expect(getUnitTexture(opA, 1, 0, NO_EFFECTS, true)).toBe(blank);
  });
});

/** 取星级精灵当前贴图（星级是独立精灵，贴图按星级全局共享） */
const starMapOf = (sprite: Sprite): Texture =>
  ((sprite.userData as { starSprite: Sprite }).starSprite.material as { map: Texture }).map;

describe('★ createUnitSprite：从"带立绘"出发，绝不先留空', () => {
  it('刚建好的精灵 chibiReady 是 false（小人还没加载完，卡面必须有立绘兜底）', () => {
    const sprite = createUnitSprite(opA, 1, 0, true);
    const data = sprite.userData as { chibiReady: boolean; defId: string; star: number };
    expect(data.chibiReady, '加载完成之前不允许留空 —— 否则失败时就是一格空白').toBe(false);
    expect(data.defId).toBe(opA.id);
    expect(data.star).toBe(1);
    expect((sprite.material as { map: Texture }).map).toBe(getUnitTexture(opA, 1, 0, NO_EFFECTS, false));
  });

  it('星级是独立精灵：不同星级的贴图不同，同星级的共享同一张', () => {
    const one = createUnitSprite(opA, 1, 0, true);
    const two = createUnitSprite(opA, 2, 0, true);
    const anotherOne = createUnitSprite(opA, 1, 1, false);
    expect(starMapOf(one)).not.toBe(starMapOf(two));
    expect(starMapOf(one)).toBe(starMapOf(anotherOne));
  });
});

describe('★ restyleUnitSprite：换人 / 升星一次换干净', () => {
  it('换干员：卡面、userData、小人都换成新的', () => {
    const sprite = createUnitSprite(opA, 1, 0, true);
    const before = sprite.userData as { chibi?: { defId: string } };

    restyleUnitSprite(sprite, opB, 1);

    const data = sprite.userData as { defId: string; def: unknown; star: number; chibi?: { defId: string } };
    expect(data.defId).toBe(opB.id);
    expect(data.def).toBe(opB);
    expect(data.star).toBe(1);
    expect((sprite.material as { map: Texture }).map).toBe(getUnitTexture(opB, 1, 0, NO_EFFECTS, false));
    // 旧小人必须被拆掉重挂 —— 不然座位上明明换了人，模型还是上一个的
    if (before.chibi) expect(data.chibi?.defId).toBe(opB.id);
  });

  it('升星：卡面和星级精灵的贴图都跟上（对手的座位靠这个升级）', () => {
    const sprite = createUnitSprite(opA, 1, 0, true);
    const starBefore = (sprite.userData as { starSprite: Sprite }).starSprite;
    const starMapBefore = starMapOf(sprite);

    restyleUnitSprite(sprite, opA, 2);

    const data = sprite.userData as { star: number; starSprite: Sprite };
    expect(data.star).toBe(2);
    // ★ 星级精灵是**同一个对象**（座位不动，只换贴图），但贴图必须是新的
    expect(data.starSprite).toBe(starBefore);
    expect(starMapOf(sprite), '升星之后星级贴图必须换').not.toBe(starMapBefore);
    expect((sprite.material as { map: Texture }).map).toBe(getUnitTexture(opA, 2, 0, NO_EFFECTS, false));
  });

  it('换队伍（看别人棋盘时）：卡面跟着换，userData 记住新队伍', () => {
    const sprite = createUnitSprite(opA, 1, 0, true);
    restyleUnitSprite(sprite, opA, 1, 1);
    const data = sprite.userData as { team: 0 | 1 };
    expect(data.team).toBe(1);
  });

  it('干员 ↔ 召唤物互换：星级精灵要挂上 / 摘掉（召唤物没有星级）', () => {
    const sprite = createUnitSprite(opA, 1, 0, true);
    const oneStarMap = starMapOf(sprite);
    expect((sprite.userData as { starSprite?: Sprite }).starSprite).toBeDefined();

    restyleUnitSprite(sprite, summonDef, 1);
    expect((sprite.userData as { starSprite?: Sprite }).starSprite, '换成召唤物后不该再有星级精灵').toBeUndefined();

    restyleUnitSprite(sprite, opA, 3);
    const data = sprite.userData as { starSprite?: Sprite };
    expect(data.starSprite, '换回干员后星级精灵要补回来').toBeDefined();
    expect(starMapOf(sprite), '补回来的必须是 3 星的贴图，不是原来那颗 1 星').not.toBe(oneStarMap);
  });

  it('★ 野怪的卡片没有装备圆点（换人时跟着挂 / 摘）', () => {
    const monsterDef = monsterDefs()[0]!;
    const sprite = createUnitSprite(opA, 1, 0, true);
    expect(
      (sprite.userData as { itemDotSprite?: Sprite }).itemDotSprite,
      '干员卡片该有装备圆点',
    ).toBeDefined();

    restyleUnitSprite(sprite, monsterDef, 1);
    expect(
      (sprite.userData as { itemDotSprite?: Sprite }).itemDotSprite,
      '野怪不能穿戴装备 —— 换成野怪后那两个灰圈必须摘掉',
    ).toBeUndefined();

    restyleUnitSprite(sprite, opA, 1);
    expect(
      (sprite.userData as { itemDotSprite?: Sprite }).itemDotSprite,
      '换回干员后圆点要补回来',
    ).toBeDefined();
  });

  it('召唤物和野怪的卡片上都没有装备圆点', () => {
    const summonSprite = createUnitSprite(summonDef, 1, 0, true);
    expect(
      (summonSprite.userData as { itemDotSprite?: Sprite }).itemDotSprite,
      '召唤物不可能被装备',
    ).toBeUndefined();
    const monsterSprite = createUnitSprite(monsterDefs()[0]!, 1, 0, true);
    expect(
      (monsterSprite.userData as { itemDotSprite?: Sprite }).itemDotSprite,
      '野怪不能穿戴装备',
    ).toBeUndefined();
  });

  it('换人时 chibiReady 归零：新小人的素材还没到，卡面必须先回到"带立绘"', () => {
    const sprite = createUnitSprite(opA, 1, 0, true);
    const data = sprite.userData as { chibiReady: boolean };
    data.chibiReady = true; // 模拟"旧小人已经播起来了"

    restyleUnitSprite(sprite, opB, 1);

    expect((sprite.userData as { chibiReady: boolean }).chibiReady).toBe(false);
    expect((sprite.material as { map: Texture }).map).toBe(getUnitTexture(opB, 1, 0, NO_EFFECTS, false));
  });
});

// ============================================================
//  ★ 0.2：望的「棋子」卡面上不画血条（用户口径）
// ============================================================
//
// 【为什么不画？】它只有 1 点血、还不可被选中（是"踩上去就炸的地雷"），
// 挂一条永远满格的血条只会让玩家以为它能扛几下。
// 判定写在数据里（`UnitDef.hideHpBar`），渲染层的唯一判据是 `canShowHpBar()` ——
// 新建和换人**两处都要问它**，否则"干员 → 棋子"换人之后血条会留在卡面上。
const hideBarDef = Object.values(UNIT_DEFS).find((def) => def.hideHpBar === true)!;

describe('★ 0.2 卡面血条：望的棋子不画血条', () => {
  const hpSpriteOf = (sprite: Sprite): Sprite | undefined =>
    (sprite.userData as { hpSprite?: Sprite }).hpSprite;

  it('数据里确实有一个"不画血条"的棋子（就是望的棋子）', () => {
    expect(hideBarDef, '找不到 hideHpBar 的棋子 —— 数据被改回去了？').toBeTruthy();
    expect(hideBarDef.id).toBe('summon_trap');
  });

  it('普通干员的卡面有血条，望的棋子没有', () => {
    expect(hpSpriteOf(createUnitSprite(opA, 1, 0, true)), '干员当然要有血条').toBeDefined();
    expect(
      hpSpriteOf(createUnitSprite(hideBarDef, 1, 0, true)),
      '★ 望的棋子不该有血条',
    ).toBeUndefined();
  });

  it('★ 换人（干员 → 棋子）要把血条摘掉，换回干员要补回来', () => {
    const sprite = createUnitSprite(opA, 1, 0, true);
    expect(hpSpriteOf(sprite)).toBeDefined();

    restyleUnitSprite(sprite, hideBarDef, 1);
    expect(hpSpriteOf(sprite), '换了人还留着血条 = 卡面上多一条永远满格的条').toBeUndefined();

    restyleUnitSprite(sprite, opA, 1);
    expect(hpSpriteOf(sprite), '换回干员后要补回来').toBeDefined();
  });

  it('血条精灵挂了之后仍然跟着卡面（没被别的步骤顺手清掉）', () => {
    const sprite = createUnitSprite(opA, 1, 0, true);
    const hp = hpSpriteOf(sprite)!;
    expect(sprite.children.includes(hp), '血条必须是卡面的子节点（跟着受击放大等变换）').toBe(true);
  });
});

/*
  小人的"世界尺寸"是从 userData.chibi?.sprite.scale 读的？
  —— 不行，测试环境里素材索引压根没加载（fetch 直接被拒），
  小人只排在 pendingAttach 里，`data.chibi` 是 undefined。
  所以"放大 50%"那条规则只在 chibi-mirror.test.ts 里用手搓状态测（纯逻辑那部分）。
*/
describe('★ 红方镜像：朝向由 mine 决定，而且换人时不会丢', () => {
  it('"我方"不镜像，"对方"镜像 —— 一条规则覆盖干员和野怪', () => {
    const mineSprite = createUnitSprite(opA, 1, 0, true);
    const enemySprite = createUnitSprite(opA, 1, 1, false);
    expect((mineSprite.userData as { mirror: boolean }).mirror, '自己的棋子保持原朝向').toBe(false);
    expect((enemySprite.userData as { mirror: boolean }).mirror, '对手（红方）的棋子要镜像').toBe(true);
  });

  it('野怪走同一条规则：它不是"我方"，所以也镜像', () => {
    const monster = monsterDefs()[0]!;
    const enemySprite = createUnitSprite(monster, 1, 1, false);
    expect((enemySprite.userData as { mirror: boolean }).mirror, '野怪在对手那一侧，必须镜像').toBe(true);
  });

  it('换干员之后朝向不丢（restyle 也要重算一遍）', () => {
    const sprite = createUnitSprite(opA, 1, 1, false);
    restyleUnitSprite(sprite, opB, 2);
    expect((sprite.userData as { mirror: boolean }).mirror, '换了人还是红方，仍然要镜像').toBe(true);
  });

  it('同一只棋子转到我方（看自己棋盘）之后不再镜像', () => {
    const sprite = createUnitSprite(opA, 1, 1, false);
    // 直接把 mine 翻成 true，模拟"这只棋子现在代表我方"
    (sprite.userData as { mine?: boolean }).mine = true;
    restyleUnitSprite(sprite, opB, 1);
    expect((sprite.userData as { mirror: boolean }).mirror).toBe(false);
  });
});

describe('★ detachChibi：拆干净，不留悬空引用', () => {
  it('拆掉之后 userData 里的小人状态清空、子节点被移除', () => {
    const sprite = createUnitSprite(opA, 1, 0, true);
    const childCountBefore = sprite.children.length;

    detachChibi(sprite);

    const data = sprite.userData as { chibi?: unknown };
    expect(data.chibi).toBeUndefined();
    // 素材索引在测试环境里没加载，小人本来就没建出来（排在 pending 里），
    // 所以这里只断言"拆了不会比拆之前多"
    expect(sprite.children.length).toBeLessThanOrEqual(childCountBefore);
  });

  it('没挂小人的精灵也可以安全地拆（幂等）', () => {
    const sprite = new Sprite();
    expect(() => detachChibi(sprite)).not.toThrow();
  });
});
