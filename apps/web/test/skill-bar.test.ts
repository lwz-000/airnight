/**
 * ============================================================
 *  ★ 0.1.4：干员卡面的「技能条」
 * ============================================================
 *
 * 需求：血条下面加一条细的、和血条等长，实时显示技能进度 ——
 *   · 平时蓝色（技能攒到多少了）；
 *   · 技能开启时按类型换样子：按时间的 -> 红色（随时间退），
 *     按攻击次数的 -> 橙色（每攻击一次退一截）；
 *   · 底槽灰色；纯被动干员没有这条。
 *
 * 这里测三件事：
 *   ① 纯逻辑：`skillBarOf` 该显示哪种模式、进度是多少；
 *   ② 几何：它确实在血条**下方**、和血条等长、比血条细；
 *   ③ 接线：真的打一场，回放里"技能生效中"的棋子卡面上出现了红条，
 *      而纯被动棋子的卡面**从来没出现过**这条。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const indexHtml = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');

/**
 * 画布上"被填过哪些颜色"（每次 bootEnvironment 清空）。
 *
 * 【为什么要记它？】
 * 技能条是画在 canvas 上的，jsdom 里画不出真像素 —— 但"这一段用了哪个填充色"
 * 是能记下来的。需求里点名了"蓝色 / 红色 / 橙色 + 灰色底槽"，
 * 记下来就能直接断言"真的用这几个颜色画了"，而不是只看代码。
 */
const paintedFills: string[] = [];

/** 和 replay-drift.test.ts 同一套打桩：造 DOM、挂全局、给 Three.js 打桩 */
async function bootEnvironment(): Promise<void> {
  paintedFills.length = 0;
  const dom = new JSDOM(indexHtml, { url: 'http://localhost:5173/', pretendToBeVisual: true });
  const { window } = dom;

  const globals: Record<string, unknown> = {
    window,
    document: window.document,
    navigator: window.navigator,
    location: window.location,
    HTMLElement: window.HTMLElement,
    HTMLCanvasElement: window.HTMLCanvasElement,
    HTMLImageElement: window.HTMLImageElement,
    Image: window.Image,
    WebSocket: window.WebSocket,
    localStorage: window.localStorage,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    fetch: () => Promise.reject(new Error('测试环境不发网络请求')),
  };
  for (const [key, value] of Object.entries(globals)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    if (descriptor && !descriptor.writable && !descriptor.set) continue;
    try {
      Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
    } catch {
      // 挂不上就算了
    }
  }

  const contextStub = new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
          return () => ({ addColorStop: () => undefined });
        }
        if (prop === 'getImageData') return () => ({ data: new Uint8ClampedArray([0, 0, 0, 0]) });
        if (prop === 'measureText') return () => ({ width: 10 });
        return () => undefined;
      },
      set: (_target, prop, value) => {
        // 记下所有"填充色"，好断言技能条真的按模式换了颜色
        if (prop === 'fillStyle') paintedFills.push(String(value));
        return true;
      },
    },
  );
  window.HTMLCanvasElement.prototype.getContext = (() => contextStub) as never;

  vi.doMock('three', async () => {
    const actual = await vi.importActual<typeof import('three')>('three');
    class StubRenderer {
      domElement = window.document.createElement('canvas');
      shadowMap = { enabled: false };
      setPixelRatio(): void {}
      setClearColor(): void {}
      setSize(): void {}
      setViewport(): void {}
      setScissor(): void {}
      setScissorTest(): void {}
      render(): void {}
      dispose(): void {}
      capabilities = { getMaxAnisotropy: () => 1 };
    }
    return { ...actual, WebGLRenderer: StubRenderer };
  });
}

describe('★ 技能条：状态推导（纯函数）', () => {
  it('★ 纯被动干员**不画**这条（它一辈子都是空的）', async () => {
    const shared = await import('../../../packages/shared/src/index.js');
    const { skillBarOf } = await import('../src/three/skill-bar.js');

    // 星熊 / 夜莺这些是纯被动 —— 数据里的 effects 是空的
    const passive = Object.values(shared.UNIT_DEFS).find(
      (def) => !shared.hasActiveSkill(def, 1) && !def.monsterOnly && !def.summonOnly,
    )!;
    expect(passive, '数据表里应该有纯被动干员').toBeTruthy();

    expect(
      skillBarOf({ def: passive, star: 1, manaRatio: 0.8, effects: [] }),
      '没有主动技能的棋子不该有技能条',
    ).toBeNull();
  });

  it('★ 平时是蓝条：进度 = 攒蓝进度', async () => {
    const shared = await import('../../../packages/shared/src/index.js');
    const { skillBarOf } = await import('../src/three/skill-bar.js');

    // 灰毫（攻击回蓝 + 10 秒攻速加成）—— 有主动技能，但此刻还没开
    const def = shared.UNIT_DEFS['op05']!;
    const bar = skillBarOf({ def, star: 1, manaRatio: 0.35, effects: [] });
    expect(bar).toEqual({ mode: 'idle', ratio: 0.35 });
  });

  it('★ 限时技能生效中 -> 红条，长度 = 剩余 / 总量', async () => {
    const shared = await import('../../../packages/shared/src/index.js');
    const { skillBarOf, skillWindowDurationOf } = await import('../src/three/skill-bar.js');

    const def = shared.UNIT_DEFS['op05']!;
    const total = skillWindowDurationOf(def, 1)!;
    expect(total.kind, '灰毫是"持续 10 秒"那类').toBe('time');
    if (total.kind !== 'time') throw new Error('灰毫的技能应该是限时的');

    const bar = skillBarOf({
      def,
      star: 1,
      manaRatio: 0,
      // 内核采到的实时效果：身上正挂着一个限时修正包，还剩一半
      effects: [{ kind: 'buff', duration: { kind: 'time', ticksLeft: Math.round(total.ticksLeft / 2) } }],
    });
    expect(bar?.mode).toBe('duration');
    expect(bar?.ratio).toBeCloseTo(0.5, 2);
  });

  it('★ "接下来 N 次攻击"生效中 -> 橙条，长度 = 剩余次数 / 总次数', async () => {
    const shared = await import('../../../packages/shared/src/index.js');
    const { skillBarOf, skillWindowDurationOf } = await import('../src/three/skill-bar.js');

    // 新约能天使：开技能后"获得 30 颗子弹"，每打一次消耗一发 —— 30/30 -> 打完 0/30
    // ★ 0.2：这里原来用的是赤刃明霄陈，但他的基础技能改成 8 秒增益、不再按次数消耗了
    const def = shared.UNIT_DEFS['op50']!;
    const total = skillWindowDurationOf(def, 1)!;
    expect(total.kind).toBe('count');

    const active = skillBarOf({
      def,
      star: 1,
      manaRatio: 0,
      effects: [{ kind: 'buff', duration: { kind: 'count', left: 30 } }],
    });
    expect(active).toEqual({ mode: 'charges', ratio: 1 });

    // 打掉一半 -> 橙条 15/30
    expect(
      skillBarOf({ def, star: 1, manaRatio: 0, effects: [{ kind: 'buff', duration: { kind: 'count', left: 15 } }] }),
    ).toEqual({ mode: 'charges', ratio: 0.5 });

    // 打完了（实时效果里没有那条包了）-> 掉回蓝条
    expect(skillBarOf({ def, star: 1, manaRatio: 0.2, effects: [] })).toEqual({
      mode: 'idle',
      ratio: 0.2,
    });
  });

  it('★ 3 星的"10 发弹药"按 10 次算（总次数来自技能数据）', async () => {
    const shared = await import('../../../packages/shared/src/index.js');
    const { skillBarOf, skillWindowDurationOf } = await import('../src/three/skill-bar.js');

    // 耀骑士临光：3 星才有"10 发弹药"（★ 0.2：从 5 发改成 10 发、+300% 改成 +800%）
    const def = shared.UNIT_DEFS['op41']!;
    expect(shared.hasActiveSkill(def, 1), '1 星（被动）不该有技能条').toBe(false);
    expect(skillWindowDurationOf(def, 3)).toEqual({ kind: 'count', left: 10 });

    const bar = skillBarOf({
      def,
      star: 3,
      manaRatio: 0,
      effects: [{ kind: 'buff', duration: { kind: 'count', left: 2 } }],
    });
    expect(bar?.mode).toBe('charges');
    expect(bar?.ratio).toBeCloseTo(2 / 10, 3);
  });

  it('★ 0.1.4：「弹药」生效中必须是橙条（bug：弹药改叫 ammo 之后技能条消失了）', async () => {
    const shared = await import('../../../packages/shared/src/index.js');
    const { skillBarOf } = await import('../src/three/skill-bar.js');

    /*
      新约能天使（op50）开完技能是"获得 30 颗子弹"，每打一次消耗一发。
      0.1.4 之后内核采到的这条效果 kind 是 **`ammo`**，
      而技能条当时只认 `buff`/`debuff` ⇒ 找不到就掉回蓝条；
      开完技能蓝条正好清零 ⇒ **玩家看到的是"技能条没了"**。
      ★ 0.2：这里原来用的是赤刃明霄陈，但他的基础技能改成 8 秒增益、不再按次数消耗了。
    */
    const def = shared.UNIT_DEFS['op50']!;
    const bar = skillBarOf({
      def,
      star: 1,
      manaRatio: 0, // 开完技能，蓝条清零 —— 以前就是这里"看起来条没了"
      effects: [{ kind: 'ammo', duration: { kind: 'count', left: 30 } }],
    });
    expect(bar, '★ 弹药生效中要点亮橙条，不能掉回蓝条').toEqual({ mode: 'charges', ratio: 1 });
  });

  it('★ 防回归：内核那份「修正包种类」名单里的每一种，都要能点亮技能条', async () => {
    const shared = await import('../../../packages/shared/src/index.js');
    const { skillBarOf } = await import('../src/three/skill-bar.js');

    /*
      ★ 这条是"下次再加一种修正包"的护栏：
      `LIVE_BUFF_EFFECT_KINDS` 是唯一名单，技能条必须认得里面**每一种**。
      漏一种就会重现 0.1.4 那个"开完技能条没了"。
    */
    expect(shared.LIVE_BUFF_EFFECT_KINDS.length, '名单不能是空的').toBeGreaterThan(0);
    expect(shared.LIVE_BUFF_EFFECT_KINDS, '「弹药」要在名单里').toContain('ammo');

    const def = shared.UNIT_DEFS['op50']!; // 按次数型（30 颗子弹）
    for (const kind of shared.LIVE_BUFF_EFFECT_KINDS) {
      const bar = skillBarOf({
        def,
        star: 1,
        manaRatio: 0,
        effects: [{ kind, duration: { kind: 'count', left: 30 } }],
      });
      expect(
        bar,
        `★ 修正包种类「${kind}」必须被技能条认出来（漏了就重现"开完技能条没了"）`,
      ).toEqual({ mode: 'charges', ratio: 1 });
    }

    // 10 发的耀骑士（★ 0.2：从 5 发改成 10 发）：剩 2 发 -> 橙条 2/10
    const multi = shared.UNIT_DEFS['op41']!;
    const bar = skillBarOf({
      def: multi,
      star: 3,
      manaRatio: 0,
      effects: [{ kind: 'ammo', duration: { kind: 'count', left: 2 } }],
    });
    expect(bar?.mode).toBe('charges');
    expect(bar?.ratio).toBeCloseTo(2 / 10, 3);
  });

  it('★ 别的效果（眩晕 / 护盾 / 破甲）不许把技能条染红', async () => {
    const shared = await import('../../../packages/shared/src/index.js');
    const { skillBarOf } = await import('../src/three/skill-bar.js');

    const def = shared.UNIT_DEFS['op05']!;
    const bar = skillBarOf({
      def,
      star: 1,
      manaRatio: 0.6,
      effects: [
        { kind: 'stun', duration: { kind: 'time', ticksLeft: 20 } },
        { kind: 'shield', duration: { kind: 'time', ticksLeft: 20 } },
        { kind: 'immune', duration: { kind: 'count', left: 2 } },
      ],
    });
    expect(bar, '这些效果和"技能生效中"是两码事').toEqual({ mode: 'idle', ratio: 0.6 });
  });
});

describe('★ 技能条：几何（在血条下方、等长、更细）', () => {
  it('位置在血条正下方、长度和血条一样、比血条细', async () => {
    const layout = await import('../src/three/card-layout.js');
    const { hpBarLocalTransform, skillBarLocalTransform, SKILL_BAR_CANVAS_SIZE } = await import(
      '../src/three/sprite-graphics.js'
    );

    const hp = layout.HP_BAR_AREA;
    const skill = layout.SKILL_BAR_AREA;

    expect(skill.x, '左对齐').toBe(hp.x);
    expect(skill.w, '① 最大长度和血条一样').toBe(hp.w);
    expect(skill.h, '② 比血条细').toBeLessThan(hp.h);
    expect(skill.y, '③ 在血条**下面**').toBeGreaterThan(hp.y + hp.h - 1);

    /*
      摆放换算：画布宽和血条一样（横向缩放 1、居中 0.5），
      竖直中心比血条更靠下（`cy` 越大越靠近卡片底边）。
    */
    const hpT = hpBarLocalTransform();
    const skillT = skillBarLocalTransform();
    expect(skillT.sx, '和血条同宽画布').toBeCloseTo(hpT.sx, 6);
    expect(skillT.cx).toBeCloseTo(0.5, 6);
    expect(skillT.cy, '竖直中心应该在血条下面').toBeGreaterThan(hpT.cy);
    expect(SKILL_BAR_CANVAS_SIZE.w).toBe(layout.CARD_W);
  });

  it('三种模式的填充色各不相同，底槽是灰的', async () => {
    const { SKILL_BAR_COLORS } = await import('../src/three/sprite-graphics.js');
    const { idle, duration, charges, slot } = SKILL_BAR_COLORS;
    expect(new Set([idle, duration, charges]).size, '蓝 / 红 / 橙要能分辨').toBe(3);
    expect(slot).toContain('rgba');
  });
});

describe('★ 技能条：精灵层（显示 / 隐藏 / 去重）', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('three');
    vi.restoreAllMocks();
  });

  it('新建的棋子默认**没有**技能条；设过之后按模式 + 5% 档显示', async () => {
    await bootEnvironment();
    const shared = await import('../../../packages/shared/src/index.js');
    const { createUnitSprite, getSkillBarDebug, setUnitSkillBar } = await import(
      '../src/three/sprite-graphics.js'
    );

    const sprite = createUnitSprite(shared.UNIT_DEFS['op05']!, 1, 0, true);
    expect(getSkillBarDebug(sprite), '卡上要挂着这条精灵').toEqual({ visible: false, key: null });

    setUnitSkillBar(sprite, { mode: 'duration', ratio: 0.5 });
    expect(getSkillBarDebug(sprite)).toEqual({ visible: true, key: 'duration|10' });

    // 同一档位再设一次：不该换贴图（key 不变）
    const before = (sprite.userData as { skillBarKey?: string | null }).skillBarKey;
    setUnitSkillBar(sprite, { mode: 'duration', ratio: 0.52 });
    expect((sprite.userData as { skillBarKey?: string | null }).skillBarKey).toBe(before);

    setUnitSkillBar(sprite, { mode: 'charges', ratio: 1 });
    expect(getSkillBarDebug(sprite)).toEqual({ visible: true, key: 'charges|20' });

    setUnitSkillBar(sprite, null);
    expect(getSkillBarDebug(sprite), '收起之后要藏起来').toEqual({ visible: false, key: null });
  });

  it('★ 真的按"蓝 / 红 / 橙 + 灰底槽"画出来了', async () => {
    await bootEnvironment();
    const shared = await import('../../../packages/shared/src/index.js');
    const { createUnitSprite, setUnitSkillBar, SKILL_BAR_COLORS } = await import(
      '../src/three/sprite-graphics.js'
    );

    const sprite = createUnitSprite(shared.UNIT_DEFS['op05']!, 1, 0, true);
    for (const mode of ['idle', 'duration', 'charges'] as const) {
      paintedFills.length = 0;
      // 每次都用不同档位，绕开"同档位不重画"的去重
      setUnitSkillBar(sprite, { mode, ratio: mode === 'idle' ? 0.3 : 0.7 });
      expect(paintedFills, `${mode}：必须真的画了一笔`).toContain(SKILL_BAR_COLORS[mode]);
      expect(paintedFills, `${mode}：底槽要是灰的`).toContain(SKILL_BAR_COLORS.slot);
    }
  });
});

describe('★ 技能条：真打一场，回放里要跟着技能状态变', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('three');
    vi.restoreAllMocks();
  });

  it('技能生效中的棋子卡面亮红条；纯被动棋子的卡面从来没亮过', async () => {
    await bootEnvironment();
    const shared = await import('../../../packages/shared/src/index.js');
    const { BattleReplay } = await import('../src/three/replay.js');
    const { getSkillBarDebug } = await import('../src/three/sprite-graphics.js');

    /*
      玛恩纳（op47）：魔**自动**回复 100/秒、10 秒开一次"持续 10 秒"的增益，
      而且被动是"没有技能时不主动移动和攻击" —— 两边都放他，谁也打不死谁，
      于是这一场必定会跑到他开技能那一刻（时序完全确定，不会看运气）。
      再塞一个纯被动的星熊（op11）进去，用来验"它永远不该有技能条"。
    */
    const mana = shared.UNIT_DEFS['op47']!;
    const passive = shared.UNIT_DEFS['op11']!;
    expect(shared.hasActiveSkill(mana, 1), '玛恩纳必须有主动技能').toBe(true);
    expect(shared.hasActiveSkill(passive, 1), '星熊必须是纯被动').toBe(false);

    const team0 = {
      team: 0 as const,
      units: [
        { defId: 'op47', star: 1, cell: { col: 2, row: 3 } },
        { defId: 'op11', star: 1, cell: { col: 2, row: 5 } },
      ],
    };
    const team1 = {
      team: 1 as const,
      units: [{ defId: 'op47', star: 1, cell: { col: 6, row: 4 } }],
    };

    const state = shared.createBattle(shared.UNIT_DEFS, [team0, team1], 20261014);
    const result = shared.simulate(shared.UNIT_DEFS, [team0, team1], 20261014, { statsTimeline: true });
    const replay = new BattleReplay(shared.UNIT_DEFS);
    replay.load(state, result);

    /** 卡面上的精灵：按棋子编号找 */
    const spriteOf = (unitId: number): unknown => {
      const found = replay.root.children.find(
        (child) => (child.userData as { unitId?: number }).unitId === unitId,
      );
      if (!found) throw new Error(`第 ${unitId} 号棋子的精灵不见了`);
      return found;
    };

    // 从内核的采样里找出"玛恩纳的技能窗口打开了"的那一刻
    const windowStart = (result.statsTimeline ?? []).find((sample) =>
      sample.effects?.some(
        (effect) => (effect.kind === 'buff' || effect.kind === 'debuff') && effect.ticksLeft !== undefined,
      ),
    );
    expect(
      windowStart,
      '玛恩纳这一场里应该开过技能（没开的话这条用例就没意义了，得换阵容）',
    ).toBeTruthy();

    // 推进回放到那一刻之后一点点
    const targetTick = windowStart!.t + 20;
    while (Math.floor(replay.currentSeconds * shared.TICKS_PER_SECOND) <= targetTick) {
      replay.advance(1 / 60);
      if (replay.isFinished) break;
    }

    // ① 开技能的那个人：红条，而且已经退掉一小截
    const manaBar = getSkillBarDebug(spriteOf(windowStart!.unitId) as never);
    expect(manaBar?.visible, '技能生效中就该亮出技能条').toBe(true);
    expect(manaBar?.key, '限时技能 -> 红条（duration）').toMatch(/^duration\|/);

    // ② 纯被动的星熊：这张卡上从来没亮过技能条
    const passiveId = [...replay.snapshot()].find((unit) => unit.defId === 'op11')!.unitId;
    const passiveBar = getSkillBarDebug(spriteOf(passiveId) as never);
    expect(passiveBar, '纯被动棋子也该挂着这张精灵').not.toBeNull();
    expect(passiveBar!.visible, '纯被动棋子的卡面不该出现技能条').toBe(false);
  }, 30000);

  it('★ 0.1.4 真打一场：开完「弹药」技能的棋子卡面要亮出橙条', async () => {
    await bootEnvironment();
    const shared = await import('../../../packages/shared/src/index.js');
    const { BattleReplay } = await import('../src/three/replay.js');
    const { getSkillBarDebug } = await import('../src/three/sprite-graphics.js');

    /*
      两边都放赤刃明霄陈（op48）的 **3 星**：它是**受击**回蓝的，只有挨打才攒得满，
      两个人对砍才会开技能（打史莱姆 41 tick 就结束了，开不出来）。
      3 星开完是"1 发弹药（一次 5 连斩）" ⇒ 卡面上必须是**橙条**（charges）。
      ★ 0.1.4 之前这里就是"什么都没有"（掉回蓝条、而蓝条已清零）。
      ★ 0.2：他的**基础**技能改成 8 秒增益、不再按次数消耗，所以用例改用 3 星那一套。
    */
    const units = (col: number) => [{ defId: 'op48', star: 3, cell: { col, row: 4 } }];
    const team0 = { team: 0 as const, units: units(2) };
    const team1 = { team: 1 as const, units: units(7) };
    const state = shared.createBattle(shared.UNIT_DEFS, [team0, team1], 20261015);
    const result = shared.simulate(shared.UNIT_DEFS, [team0, team1], 20261015, {
      statsTimeline: true,
    });

    const ammoStart = (result.statsTimeline ?? []).find((sample) =>
      sample.effects?.some((effect) => effect.kind === 'ammo' && effect.countLeft !== undefined),
    );
    expect(ammoStart, '这一场里应该开过弹药技能（没开的话这条用例就没意义了）').toBeTruthy();

    const replay = new BattleReplay(shared.UNIT_DEFS);
    replay.load(state, result);
    const spriteOf = (unitId: number): unknown => {
      const found = replay.root.children.find(
        (child) => (child.userData as { unitId?: number }).unitId === unitId,
      );
      if (!found) throw new Error(`第 ${unitId} 号棋子的精灵不见了`);
      return found;
    };

    const targetTick = ammoStart!.t + 2;
    while (Math.floor(replay.currentSeconds * shared.TICKS_PER_SECOND) <= targetTick) {
      replay.advance(1 / 60);
      if (replay.isFinished) break;
    }

    const bar = getSkillBarDebug(spriteOf(ammoStart!.unitId) as never);
    expect(bar?.visible, '★ 弹药生效中，卡面必须亮出技能条').toBe(true);
    expect(bar?.key, '★ 按次数的弹药 -> 橙条（charges），不是蓝条').toMatch(/^charges\|/);
  }, 30000);
});
