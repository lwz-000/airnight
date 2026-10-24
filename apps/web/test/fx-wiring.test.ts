/**
 * ============================================================
 *  ★★ 0.2.1 贴图特效的**接线**（渲染层这一半）
 * ============================================================
 *
 * 这一组守两件事：
 *   1. **纯函数**对不对：`seqFrameAt` 挑帧、`seqOpacityAt` 收尾 —— 这些不看浏览器也能测；
 *   2. **接线没断**：`replay.ts` 里"attack 播普攻贴图 / cast 播施法演出 / 每帧推进 /
 *      重开一局清空"这几处必须在，而且**不许出现写死的干员 id 或特效 id**
 *      （数据说了算 —— 渲染层认 `defId === 'op50'` 就是第二处真相）。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  TRACER_FX,
  tracerFlightSeconds,
} from '../src/three/bolt-tracer-fx.js';

import {
  COMBAT_FX,
  SEQ_FX,
  SKILL_FX,
  combatFxIdsOf,
  seqBetweenPoint,
  seqBetweenSize,
  seqDurationOf,
  seqFrameAt,
  seqFxPathOf,
  seqOpacityAt,
  seqRangeCells,
} from '../src/three/sequence-fx.js';

const replaySource = readFileSync(fileURLToPath(new URL('../src/three/replay.ts', import.meta.url)), 'utf8');

describe('★ 0.2.1 序列帧播放器（纯函数）', () => {
  it('挑帧：非循环停在最后一帧，循环的回绕', () => {
    const once = { frames: 6, fps: 30 };
    expect(seqFrameAt(0, once)).toBe(0);
    expect(seqFrameAt(0.04, once), '第 2 帧').toBe(1);
    expect(seqFrameAt(999, once), '播完停在最后一帧，不许越界').toBe(5);

    const loop = { frames: 16, fps: 12, loop: true };
    expect(seqFrameAt(0, loop)).toBe(0);
    expect(seqFrameAt(16 / 12, loop), '刚好一圈回到第 0 帧').toBe(0);
    expect(seqFrameAt(17 / 12, loop)).toBe(1);
  });

  it('时长 = 帧数 / fps（和美术包 manifest 同一个算法）', () => {
    expect(seqDurationOf({ frames: 10, fps: 25 })).toBeCloseTo(0.4, 6);
    expect(seqDurationOf({ frames: 6, fps: 36 })).toBeCloseTo(1 / 6, 6);
  });

  it('收尾淡出：最后 0.06 秒线性归零，其余全程 1（不会啪一下消失）', () => {
    expect(seqOpacityAt(0, 0.4)).toBe(1);
    expect(seqOpacityAt(0.3, 0.4)).toBe(1);
    const mid = seqOpacityAt(0.37, 0.4);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(seqOpacityAt(0.4, 0.4)).toBe(0);
  });

  it('注册表能被查出贴图路径（查不到返回 null，不抛错）', () => {
    expect(seqFxPathOf('angel_muzzle')).toBe('fx/angel_muzzle.png');
    expect(seqFxPathOf('nope')).toBeNull();
  });
});

describe('★ 0.2.1 replay 接线（源码级防回归）', () => {
  it('四条接线都在：attack / cast / 每帧推进 / 重开清空', () => {
    /*
      ★ 0.2.2：这行调用换成了多行（多了一个返回值收 hitIds），
      所以用正则容忍换行 —— 断言的是"这一处接线还在"，不是"必须写在一行里"。
    */
    expect(replaySource).toMatch(/this\.playCombatSeqFx\(\s*event,/);
    expect(replaySource).toContain('this.spawnSkillSeqFx(caster, event.fx)');
    // 正常路径 + "战斗已播完但特效还没淡完"那条路径都要推进
    expect(replaySource.match(/this\.updateSeqFxList\(deltaSeconds\)/g)?.length, '两条更新路径').toBe(2);
    expect(replaySource).toContain('this.clearSeqFx()');
    // 隐德来希的血镰
    expect(replaySource).toContain('updateLetoScytheFx(deltaSeconds)');
    expect(replaySource).toContain('clearLetoScytheFx()');
    expect(replaySource).toContain('letoScytheModeOf(event.fx)');
  });

  /*
    ★★ 0.2.2：近战受击痕的接线。用户的硬要求是"覆盖所有近战攻击来源，避免遗漏" ——
    这条只能靠源码级断言守住：少一处调用，就有某类攻击**没有受击特效**，
    而这在单测和门禁里都不会红（只有玩的时候才看得出来"这个人挨刀没痕迹"）。
  */
  it('★ 0.2.2 近战受击痕：三条来源都接了，而且只有一个实现', () => {
    // 普攻 + 额外目标（attackLink）两处调用，都走同一个 spawnMeleeHit
    expect(replaySource.match(/this\.spawnMeleeHit\(/g)?.length, '普攻 + 额外目标').toBe(2);
    // 位置/朝向只在 drawMeleeHit 里取一次
    expect(replaySource.match(/this\.drawMeleeHit\(/g)?.length, '立即 + 到点 两处调用').toBe(2);
    // 两条更新路径都要推进，重开一局要清
    expect(replaySource.match(/updateMeleeHitFx\(deltaSeconds\)/g)?.length, '两条更新路径').toBe(2);
    expect(replaySource).toContain('clearMeleeHitFx()');
    // 到点的队列也要清，否则上一局的受击痕会拖到下一局第一刀
    expect(replaySource).toContain('this.pendingMeleeHit.length = 0');
  });

  /*
    ★★ 0.2.2：陈「赤霄」的前方三格剑光 —— 程序化那一招必须接在 `case 'cast'` 上，
    而且两条更新路径都要推进、重开要清。少一处就是"技能放了、屏幕上什么都没有"。
  */
  it('★ 0.2.2 陈的前方三格剑光：施法分流 + 两条更新 + 清空', () => {
    expect(replaySource).toContain('isChenThrustFx(event.fx)');
    expect(replaySource.match(/spawnChenThrust\(/g)?.length, '只在 cast 那一处分流').toBe(1);
    expect(replaySource.match(/updateChenThrustFx\(deltaSeconds\)/g)?.length, '两条更新路径').toBe(2);
    expect(replaySource).toContain('clearChenThrustFx()');
  });

  it('★ 渲染层不许写死干员/特效 id（唯一真相在数据表）', () => {
    for (const literal of ['angel_gun', 'angel_overdrive', 'chen_s3', 'mlynar_s3', 'leto_scythe', 'kalts_nova']) {
      expect(replaySource, `replay.ts 里出现了写死的 "${literal}"`).not.toContain(`'${literal}'`);
    }
    // 也不许按 defId 认人
    expect(replaySource).not.toMatch(/defId === ['"]op\d+/);
  });

  it('绑定表里的 id 和注册表对得上（普攻/技能两张表）', () => {
    for (const binding of Object.values(COMBAT_FX)) {
      const ids = [
        ...(binding.muzzle ? [binding.muzzle] : []),
        ...combatFxIdsOf(binding.hit),
        ...combatFxIdsOf(binding.heavy),
      ];
      for (const id of ids) expect(SEQ_FX[id], `${id} 没登记`).toBeTruthy();
    }
    for (const binding of Object.values(SKILL_FX)) {
      const ids = [
        ...(binding.self ?? []),
        ...(binding.target ?? []),
        ...(binding.attack ?? []),
        ...(binding.attackFirst ?? []),
        ...(binding.castOnce ?? []),
        ...(binding.loop ?? []).map((layer) => layer.id),
      ];
      expect(ids.length, '空绑定没意义').toBeGreaterThan(0);
      for (const id of ids) expect(SEQ_FX[id], `${id} 没登记`).toBeTruthy();
    }
  });
});

/**
 * ============================================================
 *  ★★ 0.2.1（第二轮用户口径）三条调整
 * ============================================================
 *  ① 陈的 5 连斩**不能在施法那一刻**对着空气放，要跟着"真的砍出去"的每一刀；
 *  ② 玛恩纳砍出去的那一下要摆在**他和目标的中间**、大到同时盖住两边；
 *  ③ 金色小雨滴要铺满**他能砍到的所有格子**（射程 3 ⇒ 7×7）。
 */
describe('★ 0.2.1 第二轮口径：连斩时机 / 斩击摆位 / 小雨滴覆盖', () => {
  it('玛恩纳那一刀：摆在两人正中，大小 = 距离 + 一格边距', () => {
    const him = { x: 0, z: 0 };
    const enemy = { x: 0, z: 3 };
    expect(seqBetweenPoint(him, enemy)).toEqual({ x: 0, z: 1.5 });
    expect(seqBetweenSize(him, enemy, 1), '3 格距离 + 1 格边距 = 4').toBeCloseTo(4, 6);
    expect(SEQ_FX['mlynar_s3_hit']!.anchor, '这一层必须走 between').toBe('between');
  });

  it('小雨滴铺满射程：射程 3 ⇒ 7 格宽（不是固定 2 格）', () => {
    expect(seqRangeCells(3)).toBe(7);
    expect(seqRangeCells(1)).toBe(3);
    expect(SKILL_FX['mlynar_s3']!.loop?.[0]?.cells, '循环层按射程算').toBe('range');
  });

  it('玛恩纳的小雨滴跟着他走（follow = 施法者，每帧挪到人脚下）', () => {
    expect(replaySource).toContain('follow: caster.unitId');
    expect(replaySource).toContain('instance.followUnitId');
  });

  it('陈：施法时只放瞬移，连斩残痕挂在"技能生效的第一刀"上', () => {
    const chen = SKILL_FX['chen_s3']!;
    expect(chen.target, '施法那一刻不该有落点特效').toBeUndefined();
    expect(chen.attackFirst).toEqual(['chen_s3_combo']);
    expect(chen.attack).toEqual(['chen_s3_slash', 'chen_s3_hit']);
    // 接线：第一刀只放一次
    expect(replaySource).toContain('active.firstDone');
  });
});


/**
 * ============================================================
 *  ★★ 0.2.1 澄闪的「粉色闪电弹道」（替代原来那根白线）
 * ============================================================
 */
describe('★ 0.2.1 闪电弹道：接线 + 不许写死', () => {
  it('replay 里四条接线都在（生成 / 每帧推进 / 清空 / 相机）', () => {
    expect(replaySource).toContain('createBoltTracer(');
    expect(replaySource.match(/this\.updateBoltFxList\(deltaSeconds\)/g)?.length, '两条更新路径').toBe(2);
    expect(replaySource).toContain('this.clearBoltFx()');
    expect(replaySource).toContain('setCamera(camera: Camera)');
    expect(replaySource).toContain('isTracerFx(event.fx)');
  });

  it('★ 不许把 bolt_pink 写死进渲染层（唯一真相在数据表）', () => {
    expect(replaySource).not.toContain("'bolt_pink'");
  });

  it('★ 有专属弹道时不画原来那根白线（否则会叠两层）', () => {
    expect(replaySource).toContain('!isBoltShot');
  });
});


/**
 * ============================================================
 *  ★★ 0.2.1：两种弹道形态（闪电"整条" / 子弹"飞过去"）
 * ============================================================
 */
describe('★ 0.2.1 弹道形态：bolt 与 bullet', () => {
  it('子弹的飞行时长按距离算，并且有上下限（远了久、近了"一闪就到"）', () => {
    // 22 格/秒：3 格 ≈ 0.136 秒
    expect(tracerFlightSeconds('bullet_angel', 3)).toBeCloseTo(3 / 22, 3);
    // 贴脸时给 0.06 秒下限（否则一帧就没了，看不到）
    expect(tracerFlightSeconds('bullet_angel', 0.2)).toBeCloseTo(0.06, 6);
    // 极远也不会超过上限
    expect(tracerFlightSeconds('bullet_angel', 30)).toBeLessThanOrEqual(TRACER_FX['bullet_angel']!.seconds);
  });

  it('闪电是"瞬到"的 ⇒ 飞行时长 0（命中火花不延迟）', () => {
    expect(tracerFlightSeconds('bolt_pink', 5)).toBe(0);
    expect(tracerFlightSeconds(undefined, 5)).toBe(0);
  });

  it('两种形态都是"整条线 / 飞行弹头"里的一个（注册表不许写错 kind）', () => {
    expect(TRACER_FX['bolt_pink']!.kind).toBe('bolt');
    expect(TRACER_FX['bullet_angel']!.kind).toBe('bullet');
  });

  it('真机接线：命中火花按子弹飞行时长延后（不然"火花先炸、子弹还在路上"）', () => {
    /*
      ★★ 0.2.1（统一命中时刻）：这个"飞行时长"现在由 `hit-timing.ts` 统一算
      （`projectileFlightSeconds`），replay 只负责"问一次、用一次"。
      断言从"replay 里有 tracerFlightSeconds"改成"replay 走的是那个唯一实现"。
    */
    expect(replaySource).toContain('projectileFlightSeconds(');
    expect(replaySource).toContain('impactDelay');
    expect(replaySource).toContain('pendingSeqFx');
  });
});

/**
 * ============================================================
 *  ★★ 0.2.1：炮手的「抛物线炮弹」（第三种弹道形态）
 * ============================================================
 */
describe('★ 0.2.1 炮弹弹道：抛物线 shell', () => {
  it('三套配色都登记了，形态是 shell、顶点 2.6 格、图是 8 帧', () => {
    for (const key of ['yellow', 'red', 'gray']) {
      const style = TRACER_FX[`shell_${key}`];
      expect(style, `shell_${key} 没登记`).toBeTruthy();
      expect(style!.kind).toBe('shell');
      expect(style!.arcCells, '顶点高度（效果图标注的同一个数）').toBe(2.6);
      expect(style!.image).toBe(`fx/cannon_shell_${key}.png`);
      expect(style!.frames).toBe(8);
      expect(style!.cells, '1 格 = 256 px').toBe(1);
    }
  });

  it('飞行时长按距离算：3.6 格 ≈ 0.4 秒（比子弹慢，炮弹要有"飞过去"的过程）', () => {
    expect(tracerFlightSeconds('shell_red', 3.6)).toBeCloseTo(0.4, 3);
    // 贴脸也有下限（否则一帧就到，看不到抛物线）
    expect(tracerFlightSeconds('shell_red', 0.2)).toBeCloseTo(0.12, 6);
    // 上限是注册表里的 seconds
    expect(tracerFlightSeconds('shell_red', 99)).toBeLessThanOrEqual(TRACER_FX['shell_red']!.seconds);
    // 和子弹比：同样距离更慢
    expect(tracerFlightSeconds('shell_red', 3)).toBeGreaterThan(tracerFlightSeconds('bullet_angel', 3));
  });

  it('命中爆炸"等炮弹落地"；连击第 2/3 段延后 90ms（不然三张图叠一帧）', () => {
    expect(replaySource).toContain('projectileFlightSeconds(');
    expect(replaySource).toContain('COMBO_HIT_STAGGER_SECONDS');
    expect(replaySource).toContain('event.hitIndex');
    // 命中层可以是好几层（炮手 = 烟 + 爆炸），归一化只允许一处
    expect(replaySource).toContain('combatFxIdsOf');
  });
});

/**
 * ============================================================
 *  ★★ 0.2.1 追加：法术「流光」/ 通用斩击的「朝向」/ 治疗流光
 * ============================================================
 */
describe('★ 0.2.1 流光（flow）：阿米娅黑红 / 拉普兰德白灰 / 治疗绿', () => {
  it('三种配色都登记成 flow，而且黑色那种必须"中间留黑"', () => {
    const dark = TRACER_FX['flow_arts_dark'];
    const light = TRACER_FX['flow_arts_light'];
    const heal = TRACER_FX['stream_heal'];
    for (const [id, style] of [
      ['flow_arts_dark', dark],
      ['flow_arts_light', light],
      ['stream_heal', heal],
    ] as const) {
      expect(style, `${id} 没登记`).toBeTruthy();
      expect(style!.kind, `${id} 必须是 flow`).toBe('flow');
      expect(style!.dots, `${id} 要有跑动的亮点`).toBeGreaterThan(0);
    }
    // ★ 加色混合下纯黑看不见 ⇒ 阿米娅那套必须靠 coreSplit 留出"暗河"
    expect(dark!.coreSplit, '黑红版：中间不画，两侧描边').toBeGreaterThan(0);
    expect(light!.coreSplit, '白灰版：实心').toBe(0);
    expect(heal!.coreSplit, '绿色治疗：实心').toBe(0);
  });

  it('流光是"瞬到"的 ⇒ 飞行时长 0（命中/治疗立刻跟上，不会延迟）', () => {
    for (const id of ['flow_arts_dark', 'flow_arts_light', 'stream_heal']) {
      expect(tracerFlightSeconds(id, 5)).toBe(0);
    }
  });

  it('治疗流光的接线：heal 事件查 UnitDef.healFx，并有 0.25 秒节流', () => {
    expect(replaySource).toContain('this.playHealFx(');
    expect(replaySource).toContain('.healFx');
    expect(replaySource).toContain('HEAL_FX_MIN_INTERVAL_SECONDS');
  });
});

describe('★ 0.2.1 通用斩击：按"我方 → 目标"旋转', () => {
  it('注册表里写了 yawToTarget，锚点是 between（摆在两人中间）', () => {
    const spec = SEQ_FX['slash_single'];
    expect(spec, '通用斩击没登记').toBeTruthy();
    expect(spec!.yawToTarget).toBe(true);
    expect(spec!.anchor).toBe('between');
    // 8 帧 @30fps = 0.27 秒，比一次普攻间隔短（不会糊在下一刀上）
    expect(seqDurationOf(spec!)).toBeCloseTo(8 / 30, 5);
  });

  it('三套斩击（白/红/黄）形状参数完全一致，只有贴图不同', () => {
    const ids = ['slash_single', 'slash_red', 'slash_gold'];
    const shapeOf = (id: string): unknown => {
      const spec = SEQ_FX[id]!;
      return [spec.frames, spec.fps, spec.cells, spec.padCells, spec.anchor, spec.blend, spec.lift, spec.yawToTarget];
    };
    for (const id of ids) {
      expect(SEQ_FX[id], `${id} 没登记`).toBeTruthy();
      expect(shapeOf(id), `${id} 的形状参数必须和白色那套一致`).toEqual(shapeOf('slash_single'));
    }
    // 三张图必须各是各的（防止复制粘贴时忘了改 path）
    expect(new Set(ids.map((id) => SEQ_FX[id]!.path)).size).toBe(3);
  });

  it('只有"通用形状的斩击"用 yawToTarget（别人都是把方向烘在图里的）', () => {
    /*
      ★ 0.3.2 加了阿米娅·青色怒火的两层：黑墨刃 / 青色刃口 ——
      它们就是 `slash_single` 那套通用形状改的色，所以同样要按"我方 → 目标"旋转；
      锚点/尺寸也必须和白色那套一致（同一把刀）。
    */
    const directed = Object.entries(SEQ_FX).filter(([, spec]) => spec.yawToTarget).map(([id]) => id);
    expect(directed.sort()).toEqual(['amiya_cyan_edge', 'amiya_cyan_ink', 'slash_gold', 'slash_red', 'slash_single']);
    for (const id of ['amiya_cyan_ink', 'amiya_cyan_edge']) {
      const spec = SEQ_FX[id]!;
      expect(spec.anchor, `${id} 锚点`).toBe('between');
      expect(spec.padCells, `${id} 边距`).toBe(SEQ_FX['slash_single']!.padCells);
      expect(spec.cells, `${id} 尺寸`).toBe(SEQ_FX['slash_single']!.cells);
    }
  });
});

/**
 * ============================================================
 *  ★★ 0.2.1：羁绊级「全场扫射」（拉特兰齐射）
 * ============================================================
 * 这一发最容易踩的坑不是"图不对"，而是**被当成"棋子放技能"**：
 * `cast` 分支里有三件事对它是错的（清技能条 / 弹施法环 / 播技能专属贴图）。
 * 所以这里钉住"分流必须发生在最前面"，以及"渲染层不许写死这个 id"。
 */
describe('★★ 0.2.1 全场扫射：replay 接线', () => {
  it('`cast` 分支必须先分流 traitCast，再接"放技能"那套（否则技能条会被清空）', () => {
    const branch = replaySource.slice(replaySource.indexOf("case 'cast':"));
    const traitAt = branch.indexOf('event.traitCast');
    // ★ 带分号，避免匹配到注释里提到的 `caster.mana = 0`
    const manaAt = branch.indexOf('caster.mana = 0;');
    expect(traitAt, 'cast 分支里必须判 traitCast').toBeGreaterThan(-1);
    expect(manaAt, '前提：这里本来就有"法力清零"').toBeGreaterThan(-1);
    expect(traitAt, 'traitCast 的分流必须排在法力清零之前').toBeLessThan(manaAt);
    expect(branch.slice(traitAt, manaAt), '分流里要直接播全场层并 break').toContain('spawnBoardVolley');
  });

  it('全场层的生成/推进/清空三处接线都在（推进有两条路径）', () => {
    expect(replaySource).toContain('this.spawnBoardVolley(event.boardFx, event.unitId)');
    expect(replaySource.match(/this\.updateBoardVolley\(deltaSeconds\)/g)?.length, '两条更新路径').toBe(2);
    expect(replaySource).toContain('this.clearBoardVolley()');
    expect(replaySource).toContain('planVolleyShots(');
  });

  it('扫射用的上限是**另一套**（不许和普攻弹道的 16 发共用）', () => {
    // 一次齐射峰值 100+ 颗；共用 16 的上限会把别人的普攻弹道全顶掉
    expect(replaySource).toContain('MAX_LIVE_VOLLEY_TRACERS');
  });

  it('渲染层不许写死这个特效 id（唯一真相在羁绊数据表）', () => {
    expect(replaySource, 'replay.ts 里出现了写死的 "laterano_volley"').not.toContain("'laterano_volley'");
    expect(replaySource).not.toContain("'bullet_laterano'");
  });
});


// ------------------------------------------------------------------
// ★★ 0.2.1 统一命中时刻：接线只许有一处
// ------------------------------------------------------------------

describe('★★ 0.2.1 统一命中时刻（用户口径 · 方案 A）', () => {
  it('★★ replay.ts 不再自己算飞行时间 —— 唯一实现在 hit-timing.ts', () => {
    expect(replaySource, '又有人在渲染层手算飞行时间了').not.toContain('tracerFlightSeconds');
    expect(replaySource).toContain("from './hit-timing.js'");
    expect(replaySource).toContain('projectileFlightSeconds(');
  });

  it('★★ 程序化爆点分成「枪口 / 命中」两个时刻，命中那半走延迟队列', () => {
    expect(replaySource).toContain("'muzzle'");
    expect(replaySource).toContain("'impact'");
    expect(replaySource).toContain('this.pendingImpactFx.push');
  });

  it('★★ damage / death / dodge 只经过同一个收敛点（不许各自写一套推后逻辑）', () => {
    /*
      ★ 只许有一处**调用**（`playEvent` 顶部）。三处分头推后 = "同一动作有三处实现"，
      那种情况下只要有一处忘了，就会出现"血推后了、死亡没推后"这种最难查的错位。
    */
    const calls = replaySource.match(/this\.deferToImpactMoment\(/g) ?? [];
    expect(calls.length, '多了一处就是在别的地方又推后了一遍').toBe(1);
    // 三个事件类型都要在收敛点里真正被处理（不是只留了个空壳）
    expect(replaySource).toContain("case 'damage':");
    expect(replaySource).toContain("case 'dodge':");
    expect(replaySource).toContain("case 'death':");
  });

  it('★★ 清场要把所有命中队列都清掉（否则上一局的记录会偷下一局的结算）', () => {
    expect(replaySource).toContain('this.impacts.clear()');
    expect(replaySource).toContain('this.pendingImpactEvents.length = 0');
    expect(replaySource).toContain('this.pendingImpactFx.length = 0');
    expect(replaySource).toContain('this.pendingDeathAt.clear()');
  });

  it('★★ 战斗播完要**强行**放完（那时时间不再推进，不强行放就永远不落地）', () => {
    expect(replaySource).toContain('this.flushImpactMoment(true)');
    expect(replaySource.match(/this\.flushImpactMoment\(/g)?.length, '两条路径各一次').toBe(2);
  });

  it('★ 命中贴图的"击杀判定窗口"按命中时刻记，不按出手时刻（否则炮弹飞 0.33 秒后击杀加强版会静默丢失）', () => {
    expect(replaySource).toContain('this.timeSeconds + impactDelay');
  });
});
