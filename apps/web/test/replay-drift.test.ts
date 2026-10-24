/**
 * 战斗演出（BattleReplay）的位置稳定性测试。
 *
 * 【为什么需要这个？—— 一个只有"连续播放"才暴露的 bug】
 *
 * 我加"攻击前倾"时写的是 `sprite.position.x += 偏移`。
 * 单看那一行很合理。但问题是：**每帧都加一次，而且加完不收回**。
 *   · 棋子站着不动时位置不会被重置（移动插值那段只在移动中才会 copy 位置）
 *   · 于是 0.18 秒的前倾里，偏移被累加了十几帧
 *   · 前倾结束后偏移还留着
 * 结果：一开打，棋子就朝各自目标的方向飞出去，再也回不来 ——
 * 你看到的"干员位置乱飞"就是这个。**单帧截图、看代码都发现不了。**
 *
 * 所以这组测试跑一整场战斗，**每一帧**都检查
 * "精灵位置 - 它当前应该在的视觉位置"这个偏移有没有超过合理范围：
 *   正常的偏移只有攻击前倾，最多 0.22 世界单位。
 *   一旦开始累积，几十帧内就会超过 1.0，测试立刻红。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TeamSetup } from '../../../packages/shared/src/index.js';

const indexHtml = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');

/** 和 dom-ui.test.ts 一样的启动流程：造 DOM、把全局挂上、给 Three.js 打桩 */
async function bootEnvironment(): Promise<void> {
  const dom = new JSDOM(indexHtml, { url: 'http://localhost:5173/', pretendToBeVisual: true });
  const { window } = dom;

  const globals: Record<string, unknown> = {
    window,
    document: window.document,
    navigator: window.navigator,
    location: window.location,
    HTMLElement: window.HTMLElement,
    HTMLCanvasElement: window.HTMLCanvasElement,
    HTMLVideoElement: window.HTMLVideoElement,
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
      // 挂不上就算了，环境里已经有等价的
    }
  }

  // 2D 上下文：jsdom 没有 canvas 实现，给个只记账不真画的桩
  const contextStub = new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
          return () => ({ addColorStop: () => undefined });
        }
        if (prop === 'getImageData') {
          // 返回"四角透明"，让小人透明通道检测当作通过
          return () => ({ data: new Uint8ClampedArray([0, 0, 0, 0]) });
        }
        if (prop === 'measureText') return () => ({ width: 10 });
        return () => undefined;
      },
      set: () => true,
    },
  );
  window.HTMLCanvasElement.prototype.getContext = (() => contextStub) as never;

  // WebGLRenderer 在 jsdom 里跑不起来，打桩
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

describe('战斗演出：棋子位置不能漂移', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('three');
    vi.restoreAllMocks();
  });

  it('★ 跑完整场战斗，每一帧的偏移都不超过攻击前倾的距离', async () => {
    await bootEnvironment();

    const shared = await import('../../../packages/shared/src/index.js');
    const { BattleReplay } = await import('../src/three/replay.js');

    // 摆一场必然会互相靠近、互相攻击的战斗
    const team0 = {
      team: 0 as const,
      units: [
        { defId: shared.pickUnitOfCost(1), star: 1, cell: { col: 4, row: 3 } },
        { defId: shared.pickUnitOfCost(2), star: 1, cell: { col: 4, row: 6 } },
      ],
    };
    const team1 = {
      team: 1 as const,
      units: [
        { defId: shared.pickUnitOfCost(1), star: 1, cell: { col: 5, row: 4 } },
        { defId: shared.pickUnitOfCost(2), star: 1, cell: { col: 5, row: 5 } },
      ],
    };

    const battleState = shared.createBattle(shared.UNIT_DEFS, [team0, team1], 4242);
    const result = shared.simulate(shared.UNIT_DEFS, [team0, team1], 4242);

    const replay = new BattleReplay(shared.UNIT_DEFS);
    replay.load(battleState, result);

    // 每帧 1/60 秒，跑满整场（75 秒上限，这里跑 40 秒足够覆盖大量互相攻击）
    const frame = 1 / 60;
    let maxDrift = 0;
    let frames = 0;

    for (let i = 0; i < 60 * 40; i++) {
      replay.advance(frame);
      frames++;
      for (const unit of result.log.length > 0 ? replay.snapshot() : []) {
        const drift = replay.spriteDrift(unit.unitId);
        if (!drift) continue;
        const distance = Math.hypot(drift.x, drift.z);
        maxDrift = Math.max(maxDrift, distance);
      }
      if (replay.isFinished) break;
    }

    expect(frames).toBeGreaterThan(60); // 至少播了一秒，说明真的在跑
    /*
      阈值说明：攻击前倾最多 0.22 世界单位，而斜向目标时 x、z 各偏 0.22，
      合起来是 0.22 × √2 ≈ 0.311。所以取 0.35 作为上限。
      如果是"偏移逐帧累加"那个 bug，几十帧就会超过 1.0，这条断言一定红。
    */
    const LUNGE_DIAGONAL_LIMIT = 0.35;
    expect(
      maxDrift,
      `精灵偏离基准位置最多 ${maxDrift.toFixed(2)} 世界单位 —— ` +
        `正常只应该有攻击前倾的 0.31（斜向）。超过就说明偏移在逐帧累加（"棋子乱飞"那个 bug）`,
    ).toBeLessThan(LUNGE_DIAGONAL_LIMIT);
  });

  it('播放结束后，每个棋子的位置都还在棋盘范围内', async () => {
    await bootEnvironment();

    const shared = await import('../../../packages/shared/src/index.js');
    const { BattleReplay } = await import('../src/three/replay.js');
    const { BOARD_WORLD_W, BOARD_WORLD_H } = await import('../src/game/grid.js');

    const team0 = {
      team: 0 as const,
      units: [{ defId: shared.pickUnitOfCost(1), star: 1, cell: { col: 4, row: 5 } }],
    };
    const team1 = {
      team: 1 as const,
      units: [{ defId: shared.pickUnitOfCost(1), star: 1, cell: { col: 5, row: 5 } }],
    };

    const battleState = shared.createBattle(shared.UNIT_DEFS, [team0, team1], 777);
    const result = shared.simulate(shared.UNIT_DEFS, [team0, team1], 777);
    const replay = new BattleReplay(shared.UNIT_DEFS);
    replay.load(battleState, result);

    for (let i = 0; i < 60 * 40 && !replay.isFinished; i++) replay.advance(1 / 60);

    // 棋盘世界尺寸 + 一点余量；飞出去的棋子会远超这个范围
    const limitX = BOARD_WORLD_W / 2 + 1;
    const limitZ = BOARD_WORLD_H / 2 + 1;
    for (const unit of replay.snapshot()) {
      const drift = replay.spriteDrift(unit.unitId);
      if (!drift) continue;
      expect(Math.abs(drift.x)).toBeLessThan(limitX);
      expect(Math.abs(drift.z)).toBeLessThan(limitZ);
    }
  });

  it('★ 战斗中召唤出来的棋子不在开局就出现（否则它会永远钉在那儿）', async () => {
    /*
      【这个 bug 是怎么来的】
      Replay 原来在 load() 里把**整条日志里的 spawn 事件**全铺一遍。
      以前那是对的 —— 因为只有开局才有 spawn。
      但加了召唤物（迷迭香的柱子、维娜的金狮子、望的棋子）和复活之后，
      战斗中途也会推 spawn 事件。于是那段代码会把柱子
      **在第 0 秒就摆到它 20 秒后才该出现的位置上，而且永远不动**。
      这类"贴图多出来一个"的问题，看代码看不出来，得跑起来数一数。
    */
    await bootEnvironment();

    const shared = await import('../../../packages/shared/src/index.js');
    const { BattleReplay } = await import('../src/three/replay.js');

    // 迷迭香（op18）放技能会召唤柱子。用 3 星是为了让它开局有一半法力，
    // 能在这场短战斗里真的把技能放出来（1 星要打 10 下才攒满，等不到）
    const team0 = { team: 0 as const, units: [{ defId: 'op18', star: 3, cell: { col: 4, row: 4 } }] };
    // 敌人用 3 星信仰搅拌机：血厚、攻击低，保证战斗拖得够久
    const team1 = { team: 1 as const, units: [{ defId: 'op09', star: 3, cell: { col: 5, row: 4 } }] };
    const result = shared.simulate(shared.UNIT_DEFS, [team0, team1], 7);

    type SpawnEvent = Extract<(typeof result.log)[number], { type: 'spawn' }>;
    const spawnAtZero = result.log.filter((event) => event.type === 'spawn' && event.t === 0).length;
    const spawnLater = result.log.filter(
      (event): event is SpawnEvent => event.type === 'spawn' && event.t > 0,
    );
    expect(spawnAtZero, '开局只有 2 个棋子').toBe(2);
    // 柱子确实在中途被召唤出来了（不然这条测试是空的）
    expect(spawnLater.length, '应该有中途召唤出来的棋子').toBeGreaterThan(0);

    const battleState = shared.createBattle(shared.UNIT_DEFS, [team0, team1], 7);
    const replay = new BattleReplay(shared.UNIT_DEFS);
    replay.load(battleState, result);

    // 开局：只有 2 个棋子，柱子还没出现
    expect(replay.snapshot().length, '开局不该有召唤物').toBe(2);
    const summonIds = new Set(spawnLater.map((event) => event.unitId));
    for (const visual of replay.snapshot()) {
      expect(summonIds.has(visual.unitId), '召唤物不该在开局就出现').toBe(false);
    }

    // 播到召唤那一刻之后：柱子应该出现了
    const summonTick = spawnLater[0]!.t;
    for (let i = 0; i < 60 * 40 && !replay.isFinished; i++) {
      replay.advance(1 / 60);
      if (replay.snapshot().some((visual) => summonIds.has(visual.unitId))) break;
    }
    expect(
      replay.snapshot().some((visual) => summonIds.has(visual.unitId)),
      `播到第 ${summonTick} tick 之后召唤物应该出现`,
    ).toBe(true);
  });

  it('★ 范围框会出现、颜色对、而且会消失（不会在地上留一堆线）', async () => {
    /*
      范围技能的方框是回放里唯一"每次触发都新建几何体"的东西。
      不妥善回收的话，一场 40 秒的战斗能堆出上千条线 ——
      表现为越打越卡，而且**从画面上看不出来**（线很细、又是贴地的）。
      所以这里同时钉住三件事：出现过、颜色对、最后清干净。
    */
    await bootEnvironment();

    const shared = await import('../../../packages/shared/src/index.js');
    const { BattleReplay } = await import('../src/three/replay.js');

    const makeDef = (
      id: string,
      base: Partial<(typeof shared.UNIT_DEFS)[string]['base']>,
      passive?: (typeof shared.UNIT_DEFS)[string]['skill']['passive'],
    ) => ({
      id,
      name: id,
      cost: 1,
      traits: [] as string[],
      base: {
        hp: 1000,
        attackDamage: 100,
        attackSpeed: 1000,
        armor: 0,
        magicResist: 0,
        range: 1,
        manaPerAttack: 0,
        ...base,
      },
      starHpBp: 1800,
      starDamageBp: 1800,
      color: '#888888',
      sprite: id,
      skill: { id: `${id}_skill`, name: id, desc: '', effects: [], manaSource: 'attack' as const, passive },
    });

    // 溅射（白框）+ 回血光环（绿框），两种框都造出来
    const table = {
      // 血量给厚一点，保证两种框都有机会出现；但敌人打得动，战斗一定会结束
      splasher: makeDef('splasher', { range: 3, hp: 20000 }, {
        splash: { radius: 1, shape: 'square' as const, ratioBp: 5000, damageType: 'physical' as const },
      }),
      healer: makeDef('healer', { range: 1, hp: 20000 }, {
        pulse: {
          // 间隔给短一点，免得战斗还没打到那一秒就结束了
          intervalTicks: 4,
          radius: 2,
          affect: 'allies' as const,
          heal: { basis: 'targetMaxHp' as const, ratioBp: 800 },
        },
      }),
      dummy: makeDef('dummy', { hp: 100000, attackDamage: 3000 }),
    };
    const teams: [TeamSetup, TeamSetup] = [
      {
        team: 0,
        units: [
          { defId: 'splasher', star: 1, cell: { col: 4, row: 4 } },
          { defId: 'healer', star: 1, cell: { col: 4, row: 5 } },
        ],
      },
      {
        team: 1,
        units: [
          { defId: 'dummy', star: 1, cell: { col: 5, row: 4 } },
          { defId: 'dummy', star: 1, cell: { col: 5, row: 5 } },
        ],
      },
    ];

    const battleState = shared.createBattle(table, teams, 5);
    const result = shared.simulate(table, teams, 5);
    // 造场景：至少要真的发生过范围效果
    expect(result.log.some((event) => event.type === 'zone')).toBe(true);

    const replay = new BattleReplay(table);
    replay.load(battleState, result);

    /*
      ★ 0.2.1：范围框属于**特效**，现在挂在 `replay.fxLayer` 下
      （那一层不吃鼠标点击 —— 见 `fx-pick.test.ts`），所以这里要往特效层里数。
      棋子精灵仍然直接挂在 `root` 下，不在这层。
    */
    const lines = (): Array<{ material: { color: { getHex(): number } } }> =>
      replay.fxLayer.children.filter(
        (child) => (child as { type?: string }).type === 'Line',
      ) as unknown as Array<{ material: { color: { getHex(): number } } }>;

    const seenColors = new Set<number>();
    let maxLines = 0;
    for (let i = 0; i < 60 * 80 && !replay.isFinished; i++) {
      replay.advance(1 / 60);
      for (const line of lines()) seenColors.add(line.material.color.getHex());
      maxLines = Math.max(maxLines, lines().length);
    }
    expect(replay.isFinished, '这场战斗应该能播完（不然下面的"清干净"测不到）').toBe(true);
    // 播完之后还要继续推进 —— 最后那一下的框也要淡完（这条是修过的）
    for (let i = 0; i < 120; i++) replay.advance(1 / 60);

    expect(maxLines, '战斗过程中应该看得到范围框').toBeGreaterThan(0);
    // 白色 = 范围伤害，绿色 = 回血光环
    expect(seenColors.has(0xffffff), '范围伤害应该画成白色方框').toBe(true);
    expect(seenColors.has(0x5ce08a), '回血光环应该画成绿色方框').toBe(true);

    // 全部到期后必须清干净（不然就是显存泄漏，而且是慢性卡顿）
    expect(lines().length, '战斗结束后不该还有残留的框').toBe(0);
  });
});

/**
 * ============================================================
 *  战斗中的实时面板：数据源必须是"打起来之后真的在变"的
 * ============================================================
 * 你要求"战斗时点干员能实时看血量和技能条"。
 * 面板画得对不对（DOM）在 netplay-ui 那边测不了，
 * 但**数据源对不对**可以在这里钉死：
 *   · 血量会随着受伤下降
 *   · 法力会涨（技能条）
 *   · 放技能的那一刻法力清零（表现为"CD 重新开始"）
 * 如果这几条不成立，面板上就是个摆设。
 */
describe('★ 战斗中的干员数据（血量 / 技能条）', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('three');
    vi.restoreAllMocks();
  });

  it('血量、法力、技能释放次数都会随战斗推进而变化', async () => {
    await bootEnvironment();

    const shared = await import('../../../packages/shared/src/index.js');
    const { BattleReplay } = await import('../src/three/replay.js');

    /*
      让双方都是"打得久一点"的组合，好观察到法力上涨和放技能。

      ★ 不能再用 `pickUnitOfCost(3)` —— 它取的是"3 费里 id 排最前的那一个"，
      而 0.0.3 A 版把**夜莺**调到了 3 费，她偏偏是「不会攻击、只会每秒奶范围内友军」
      的纯奶妈（skill.passive.noAttack）。两边都是她的话谁都打不动谁，
      血量永远不掉，这条断言就必然红。
      所以这里自己挑一个"真的会出手"的 3 费干员。
    */
    const fighter = shared
      .playableDefs()
      .filter((def) => def.cost === 3 && def.skill.passive?.noAttack !== true)
      .map((def) => def.id)
      .sort()[0]!;
    expect(fighter, '3 费里至少要有一个会攻击的干员').toBeTruthy();
    const teams: [TeamSetup, TeamSetup] = [
      { team: 0, units: [{ defId: fighter, star: 2, cell: { col: 3, row: 4 } }] },
      { team: 1, units: [{ defId: fighter, star: 2, cell: { col: 6, row: 4 } }] },
    ];
    const battleState = shared.createBattle(shared.UNIT_DEFS, teams, 777);
    const result = shared.simulate(shared.UNIT_DEFS, teams, 777);

    const replay = new BattleReplay(shared.UNIT_DEFS);
    replay.load(battleState, result);

    const unitIds = replay.snapshot().map((u) => u.unitId);
    expect(unitIds.length, '这一场应该有 2 个棋子').toBe(2);

    const first = replay.unitInfo(unitIds[0]!)!;
    expect(first.maxHp, '面板要能拿到最大生命（不然进度条没分母）').toBeGreaterThan(0);
    expect(first.hp, '开局应该是满血').toBe(first.maxHp);
    expect(first.mana, '开局法力应该是 0').toBe(0);

    let sawManaRise = false;
    let sawHpDrop = false;
    let sawCast = false;
    let lastMana = 0;

    for (let i = 0; i < 60 * 80 && !replay.isFinished; i++) {
      replay.advance(1 / 60);
      for (const id of unitIds) {
        const info = replay.unitInfo(id);
        if (!info) continue;
        if (info.hp < info.maxHp) sawHpDrop = true;
        if (info.mana > lastMana) sawManaRise = true;
        if (info.castCount > 0) sawCast = true;
        lastMana = info.mana;
        // 血量和法力都必须落在合法区间内 —— 面板显示 "700/1000"、进度条宽度都靠它
        expect(info.hp, '血量不该是负数').toBeGreaterThanOrEqual(0);
        expect(info.hp).toBeLessThanOrEqual(info.maxHp);
        expect(info.mana, '法力不该超过上限（技能条会画爆）').toBeGreaterThanOrEqual(0);
        expect(info.mana).toBeLessThanOrEqual(shared.MANA_MAX);
      }
    }

    expect(sawHpDrop, '打了这么久血量应该有变化').toBe(true);
    expect(sawManaRise, '法力应该会涨（技能条要动起来）').toBe(true);
    expect(sawCast, '法力攒满应该会放技能（放完清零，就是"CD 重新开始"）').toBe(true);
  });

  it('棋子彻底消失之后，unitInfo 会返回 null（面板该自动关掉）', async () => {
    await bootEnvironment();

    const shared = await import('../../../packages/shared/src/index.js');
    const { BattleReplay } = await import('../src/three/replay.js');

    // 一强一弱：弱的那边很快就会死
    const teams: [TeamSetup, TeamSetup] = [
      { team: 0, units: [{ defId: shared.pickUnitOfCost(5), star: 3, cell: { col: 4, row: 4 } }] },
      { team: 1, units: [{ defId: shared.pickUnitOfCost(1), star: 1, cell: { col: 5, row: 4 } }] },
    ];
    const battleState = shared.createBattle(shared.UNIT_DEFS, teams, 31337);
    const result = shared.simulate(shared.UNIT_DEFS, teams, 31337);

    const replay = new BattleReplay(shared.UNIT_DEFS);
    replay.load(battleState, result);
    const weakId = replay.snapshot().find((u) => u.team === 1)!.unitId;

    for (let i = 0; i < 60 * 80 && !replay.isFinished; i++) replay.advance(1 / 60);
    // 死亡动画放完还需要一点时间（DEATH_ANIM_SECONDS = 0.45）
    for (let i = 0; i < 60 * 2; i++) replay.advance(1 / 60);

    expect(
      replay.unitInfo(weakId),
      '死掉并消失的棋子应该查不到了 —— 面板据此自动关闭，不会挂着 0 血假数据',
    ).toBeNull();
  });
});

/**
 * ============================================================
 *  ★ "一个 unitId 只能有一份视觉对象"
 * ============================================================
 * 这是一条**结构不变量**，比盯着某一种 bug 打更耐用：
 *   root 里挂着的精灵数量，必须恒等于回放层认得的棋子数量。
 * 只要多出来，那个就一定是"被顶掉之后再也没人管"的残影。
 *
 * 目前已知会踩它的路径只有一个：**复活**（spawn 事件复用阵亡时的 unitId）。
 * 但召唤物、以后的"变身 / 分裂"之类的技能同样可能复用编号，
 * 所以用不变量兜住，比一条条补更省事。
 */
describe('★ 回放层：root 里不能有"无主"的精灵', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('three');
    vi.restoreAllMocks();
  });

  it('★ 同一个 unitId "死而复生"时，旧精灵必须被摘掉（卡面残留那个 bug）', async () => {
    /*
      【能天使复活的技能触发时，卡面会残留在竞技场上不消失】
      【根因】
      复活（新约能天使 3 星）推的 spawn 事件用的是**阵亡前那个 unitId**
      —— 见 skills.ts 的 doRevive：它只把 dead 翻回 false，编号一个字没变。
      而回放层是拿 unitId 当表键的：
        · 那一刻旧精灵很可能还在演那 0.45 秒的阵亡动画（还没从 root 里摘掉）；
        · createVisual 里 `visuals.set(unitId, 新精灵)` 把表项**直接覆盖**了。
      覆盖之后旧精灵再也没人引用：不会被更新，也走不到"死亡动画播完就移除"
      那一句 —— 它就那么定格在棋盘上，怎么都不消失。

      这类 bug 光看代码看不出来（每一行都挺合理），单帧截图也看不出来，
      所以这里直接**手工造一段日志**（比"等真实战斗里技能刚好在那 0.1 秒内触发"
      可靠得多），然后每一帧都问一句：
      **root 里的精灵数量，是不是正好等于回放层认得的棋子数量？**
      多出来的那个就是没人管的"残影"。
    */
    await bootEnvironment();

    const shared = await import('../../../packages/shared/src/index.js');
    const { BattleReplay } = await import('../src/three/replay.js');

    // 20 tick = 1 秒（TICKS_PER_SECOND），所以 10 -> 12 只隔 0.1 秒，
    // 远小于死亡动画的 0.45 秒 —— 旧精灵**一定**还在场上。
    const spawn = (t: number, star: number) => ({
      type: 'spawn' as const,
      t,
      unitId: 1,
      team: 0 as const,
      defId: 'op01',
      star,
      cell: { col: 4, row: 4 },
      maxHp: 2000,
    });
    const log = [spawn(0, 1), { type: 'death' as const, t: 10, unitId: 1 }, spawn(12, 2)];

    const result = {
      seed: 1,
      winner: 0,
      reason: 'eliminated',
      ticks: 60,
      log,
      hpBpTeam0: 10000,
      hpBpTeam1: 0,
      checksum: 0,
    } as unknown as import('../../../packages/shared/src/index.js').BattleResult;

    const replay = new BattleReplay(shared.UNIT_DEFS);
    replay.load({} as never, result);

    /** root 里真正挂着的精灵数（回放还往 root 里放弹道线和范围框，所以只数精灵） */
    const spritesInRoot = (): number =>
      replay.root.children.filter((child) => (child as { isSprite?: boolean }).isSprite === true).length;
    /*
      ★ 0.1.3：金色光华是**小人的兄弟节点**（挂在卡片下），
      所以它不在 `root.children` 里 —— 这里仍然按 1 层算。
      （如果哪天它改成独立进场景，这条会立刻红，正好提醒要一起改。）
    */
    const layersPerUnit = 1;
    const ghostsInRoot = (): number => spritesInRoot() - replay.snapshot().length * layersPerUnit;

    let maxGhosts = 0;
    for (let i = 0; i < 60 * 3; i++) {
      replay.advance(1 / 60);
      maxGhosts = Math.max(maxGhosts, ghostsInRoot());
      expect(
        ghostsInRoot(),
        `第 ${i} 帧：root 里有 ${spritesInRoot()} 个精灵、回放层认得 ${replay.snapshot().length} 个单位 —— ` +
          `按每单位 ${layersPerUnit} 层算，多出来的就是"复活时被顶掉、再也没人管"的残影（卡面残留那个 bug）`,
      ).toBe(0);
    }

    expect(maxGhosts, '整段回放都不该出现无主的精灵').toBe(0);
    // 复活之后的那个棋子要活着，而且是技能给的新星级
    const alive = replay.snapshot();
    expect(alive.length, '同一只棋子复活后只该有一份').toBe(1);
    expect(alive[0]!.star, '复活的星级应该按技能提升（2 星）').toBe(2);
  });
});

// ------------------------------------------------------------------
// ★★ 0.2.1 统一命中时刻（用户口径 · 方案 A）
// ------------------------------------------------------------------

describe('★ 战斗演出：掉血的时刻 = 弹道飞到的时刻', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('three');
    vi.restoreAllMocks();
  });

  /**
   * 跑一场"攻击者打木桩"，量出**卡面血条真正开始掉**是在出手之后多久。
   *
   * ★ 为什么用 1/120 秒的步长采样？
   *   子弹的飞行时间只有 0.14 秒左右。60fps 一帧 16.7ms 的量化误差
   *   会和"本来就没有延迟"这个 bug 混在一起分不清（都是 ±0.02 量级）。
   *
   * @returns `attackAt`（第一次出手的回放时间）与 `dropAt`（血条第一次变少的时刻，没掉血则 null）
   */
  async function measureDropDelay(
    attackerId: string,
    star: number,
  ): Promise<{ attackAt: number; dropAt: number | null }> {
    await bootEnvironment();
    const shared = await import('../../../packages/shared/src/index.js');
    const { BattleReplay } = await import('../src/three/replay.js');

    const team0 = { team: 0 as const, units: [{ defId: attackerId, star, cell: { col: 3, row: 5 } }] };
    // ★ 木桩：`mn_duholy` 是惰性靶子（攻速极低），不会反过来打死攻击者打乱节奏
    const team1 = { team: 1 as const, units: [{ defId: 'mn_duholy', star: 1, cell: { col: 6, row: 5 } }] };
    const battleState = shared.createBattle(shared.UNIT_DEFS, [team0, team1], 20261061);
    const result = shared.simulate(shared.UNIT_DEFS, [team0, team1], 20261061);

    const replay = new BattleReplay(shared.UNIT_DEFS);
    replay.load(battleState, result);

    const me = battleState.units.find((unit) => unit.team === 0)!;
    const foe = battleState.units.find((unit) => unit.team === 1)!;
    const firstAttack = result.log.find((event) => event.type === 'attack' && event.unitId === me.id);
    expect(firstAttack, '前提：这个人真的出手了').toBeTruthy();
    const attackAt = firstAttack!.t / 20;

    const startHp = replay.unitInfo(foe.id)!.hp;
    let dropAt: number | null = null;
    const frame = 1 / 120;
    for (let i = 0; i < 120 * 6; i++) {
      replay.advance(frame);
      const now = (i + 1) * frame;
      const hp = replay.unitInfo(foe.id)?.hp ?? 0;
      // ★ 只在第一次出手之后才开始盯（开局那些事件不算）
      if (now >= attackAt && hp < startHp) {
        dropAt = now;
        break;
      }
      if (replay.isFinished) break;
    }
    return { attackAt, dropAt };
  }

  it('★★ 远程（子弹）：掉血晚于出手一整段飞行时间，而不是当帧就掉', async () => {
    const { attackAt, dropAt } = await measureDropDelay('op50', 2);
    expect(dropAt, '血条一直没动 ⇒ 命中表现整段丢了').not.toBeNull();
    const delay = dropAt! - attackAt;
    /*
      ★ 子弹 22 格/秒、下限 0.06 秒 ⇒ 3 格约 0.14 秒。
      断言留了采样余量，但**必须明显大于 0** —— 那正是这次修的东西。
    */
    expect(delay, `出手后几乎立刻掉血（delay=${delay.toFixed(3)}s）—— 又是"没挨打先掉血"`).toBeGreaterThan(0.04);
    expect(delay, `等了 ${delay.toFixed(3)} 秒才掉血，太久（子弹上限 0.3 秒）`).toBeLessThan(0.4);
  });

  it('★★ 近战：还是当场掉血（没有弹道就没有延迟，行为和以前一模一样）', async () => {
    const { attackAt, dropAt } = await measureDropDelay('op11', 2);
    expect(dropAt, '近战一次都没打到？').not.toBeNull();
    expect(Math.abs(dropAt! - attackAt), '近战不该有任何延迟').toBeLessThan(0.05);
  });
});
