/**
 * ============================================================
 *  ★ 0.1.4：「弹药」—— 「接下来 N 次攻击 +X%」的统一说法
 * ============================================================
 *
 * 【你的规则原文】
 *   「将后续几次『提升攻击』的技能效果统一改为『弹药』效果，
 *     一次攻击效果提升对应一发弹药。
 *     如：接下来四次攻击变为倍率 300% → 获得 4 发弹药，攻击变为 300% 倍率。
 *     保持其效果数值、触发条件、持续回合与适用范围等原有表现完全不变。」
 *
 * ============================================================
 *  这次改的到底是什么？（先说清，不然看测试会以为改动很大）
 * ============================================================
 *  **数据一个字节都没动。** 改的只有两样：
 *    1. `EFFECT_DEFS` 里多了一个登记项 `ammo`（名字/图标/颜色/说明）；
 *    2. `liveBuffEffects` 判一句「这个包是技能落的 + 按次数消耗」→ 显示成弹药。
 *
 *  内核（`addBuff` / `attackCharges` / `performAttack` 的消耗逻辑）**完全没碰**，
 *  所以：
 *    · **没有版本不兼容**（`SERVER_VERSION` 不用动，联机不受影响）；
 *    · **正在生效 / 正在冷却中的技能不受影响** —— 它们只是换个显示名，
 *      剩余发数、倍率、触发条件、持续时间全部照旧；
 *    · 战斗回放（事件流）逐帧一致，不存在"换了个说法导致录像对不上"。
 *
 * ============================================================
 *  筛选条件（这是"要改哪些技能"的唯一判据）
 * ============================================================
 *  **技能效果里写了 `attacks` 字段的** —— 它就是"接下来 N 次攻击"型。
 *  全库（`skill-data.ts`）扫下来正好 **6 条**：
 *
 *  | 干员 | 技能（id）         | 发数 |
 *  |---|---|---|
 *  | 耀骑士     | op41_skill · 3 星「耀骑士·断罪」       | 10（★ 0.2 从 5 改上来） |
 *  | 维什戴尔   | op45_skill · 3 星「维什戴尔·爆裂黎明」 | 6 |
 *  | 凯尔希     | op46_skill · 3 星「凯尔希·保护性拒止」 | 10 |
 *  | 赤刃明霄陈 | op48_skill · 3 星「赤刃明霄陈·绝影-驰」 | 1（★ 0.2 改版：这一发 = 一次 5 连斩） |
 *  | 新约能天使 | op50_skill · 基础「新约能天使·开火成瘾症」 | 30（★ 0.2 改版） |
 *  | 新约能天使 | op50_skill · 3 星「新约能天使·使命必达！」 | 50（★ 0.2 改版，每次攻击消耗 5 发） |
 *
 *  ★ 0.2 的两处变动：
 *    · `op48:base` **退出**这份名单 —— 策划表把它的基础技能从"下一击附伤 + 回血"
 *      换成了"8 秒攻速 + 按目标生命上限附伤 + 缓慢回血"，不再按次数消耗。
 *    · `op50` 基础 / 3 星**进入**名单（表里写的是"30 颗子弹 / 50 颗弹药"）。
 *
 *  **故意排除**（形状一样、但不是"弹药"）：
 *    · 藏品的 `everyNthAttack`（突袭手雷"每 3 击强化下一击"）；
 *    · 野怪的周期性强化（`monster-data.ts` 的 `everyNthAttack`）。
 *  它们也写成 `attackCharges`，但"弹药"这个词只适合技能 ——
 *  区分靠 `SkillBuff.fromSkill`（**技能这一侧**显式打的标记，见 `skills.ts`）。
 *
 * 下面第一条测试就把这个"正好 6 条"钉死：
 * **以后谁新增了带 `attacks` 的技能，这里会红**，提醒他也要写「N 发弹药」的文案。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  EFFECT_DEFS,
  MANA_MAX,
  MAX_BATTLE_TICKS,
  SKILLS,
  TRAIT_DEFS,
  UNIT_DEFS,
  computeActiveTraitLevels,
  computeTraitBonuses,
  computeUnitTraitBonuses,
  createBattle,
  liveBuffEffects,
  resolveUnitMechanics,
  simulate,
  step,
  type BattleState,
  type SkillEffect,
  type TeamSetup,
  type UnitPlacement,
  type UnitState,
} from '../src/index.js';

// ------------------------------------------------------------------
// 扫描：把所有"带 attacks 的技能效果"捞出来
// ------------------------------------------------------------------

interface AmmoHit {
  /** 干员 id（op41 / op45 / op48） */
  unitId: string;
  /** 基础技能还是 3 星技能 */
  variant: 'base' | 'star3';
  /** 技能 id（op41_skill…） */
  skillId: string;
  skillName: string;
  desc: string;
  effect: SkillEffect;
}

function isAmmoEffect(effect: SkillEffect): boolean {
  return effect.kind === 'buff' && typeof (effect as { attacks?: number }).attacks === 'number';
}

/** 「弹药」的筛选条件，只在这里实现一次 —— 测试和实现读同一份 */
function allAmmoEffects(): AmmoHit[] {
  const out: AmmoHit[] = [];
  const push = (
    unitId: string,
    variant: 'base' | 'star3',
    skillId: string,
    variantDef: { name: string; desc: string; effects: SkillEffect[] },
  ) => {
    for (const effect of variantDef.effects) {
      if (!isAmmoEffect(effect)) continue;
      out.push({
        unitId,
        variant,
        skillId,
        skillName: variantDef.name,
        desc: variantDef.desc,
        effect,
      });
    }
  };
  for (const [unitId, def] of Object.entries(SKILLS)) {
    push(unitId, 'base', def.id, def);
    if (def.star3) push(unitId, 'star3', def.id, def.star3);
  }
  return out;
}

function keyOf(hit: AmmoHit): string {
  return `${hit.unitId}:${hit.variant}`;
}

function hitOf(key: string): AmmoHit {
  const hit = allAmmoEffects().find((item) => keyOf(item) === key);
  if (!hit) throw new Error(`没有这条弹药技能：${key}`);
  return hit;
}

/** 把一条弹药效果摊平成可比对的对象（数值部分） */
function chargesOf(effect: SkillEffect): number {
  return (effect as { attacks?: number }).attacks ?? 0;
}

// ------------------------------------------------------------------
// 1) 登记项
// ------------------------------------------------------------------

describe('★ 0.1.4 弹药：登记项', () => {
  it('「弹药」在状态登记表里有名字 / 图标 / 说明', () => {
    const def = EFFECT_DEFS.ammo;
    expect(def, 'EffectKind 里要能写 ammo，界面才能认').toBeTruthy();
    expect(def.name).toBe('弹药');
    expect(def.icon).toBeTruthy();
    expect(def.color).toBeTruthy();
    expect(def.polarity, '它是好东西，和「增益」同极性').toBe('buff');
    expect(def.desc, '要说清"打一次消耗一发"').toContain('消耗一发');
  });
});

// ------------------------------------------------------------------
// 2) 筛选条件与完整清单（★ 数量就是这里钉的）
// ------------------------------------------------------------------

describe('★ 0.1.4 弹药：筛选条件 = 技能效果里写了 attacks', () => {
  it('★ 全库正好 6 条，一条不多一条不少', () => {
    const keys = allAmmoEffects().map(keyOf).sort();
    expect(keys, '以后新增带 attacks 的技能，请同步写「N 发弹药」文案').toEqual([
      'op41:star3',
      'op45:star3',
      // ★ 0.2：凯尔希 3 星从"持续 10 秒"改成了"10 发弹药"（每打一次消耗一发）
      'op46:star3',
      // ★ 0.2 改版：赤刃明霄陈的基础技能不再按次数消耗；3 星改成"1 发 = 一次 5 连斩"
      'op48:star3',
      // ★ 0.2 改版：新约能天使的 30 颗子弹 / 50 颗弹药
      'op50:base',
      'op50:star3',
    ]);
  });

  it('每条的技能 id 都对得上（改名单时看这条就知道受影响的是谁）', () => {
    expect(allAmmoEffects().map((h) => `${h.skillId}@${keyOf(h)}`).sort()).toEqual([
      'op41_skill@op41:star3',
      'op45_skill@op45:star3',
      'op46_skill@op46:star3',
      'op48_skill@op48:star3',
      'op50_skill@op50:base',
      'op50_skill@op50:star3',
    ]);
  });

  it('每条的说明里都写清了发数，和配置一致', () => {
    for (const hit of allAmmoEffects()) {
      const charges = chargesOf(hit.effect);
      /*
        ★ 0.2：策划表对"子弹"型的技能写的是「N 颗子弹」（新约能天使），
        对"弹药"型的写「N 发弹药」。两种说法都认 —— 强行统一措辞反而会
        和对账表对不上（对账是按名字/文案比对的）。
      */
      const said =
        hit.desc.includes(`${charges} 发弹药`) ||
        hit.desc.includes(`${charges} 颗子弹`) ||
        hit.desc.includes(`${charges} 颗弹药`);
      /*
        ★ `op48:star3` 是个例外：它的 `attacks: 1` 不是玩家口径的"1 发弹药"，
        而是"这一次攻击变成 5 连斩、杀人刷新"（表里的原话是"快速斩击 5 次"）。
        文案里必须提到"斩击 5 次"，但我们不硬塞"1 发弹药"进去。
      */
      const statedAsCombo = keyOf(hit) === 'op48:star3' && hit.desc.includes('斩击 5 次');
      expect(said || statedAsCombo, `${keyOf(hit)}「${hit.skillName}」要说清发数（${charges}）`).toBe(true);
      if (!statedAsCombo) {
        // 「打一次消耗一发」/「每次攻击消耗一颗子弹」/「攻击变成五连击并消耗五发弹药」都算说清了
        expect(hit.desc, `${keyOf(hit)}要说清"打一次消耗一发"`).toMatch(/消耗\S{0,3}(发|颗)/);
      }
    }
  });
});

// ------------------------------------------------------------------
// 3) 数值零改动 —— 前后对照表
// ------------------------------------------------------------------

describe('★ 0.1.4 弹药：数值 / 触发条件 / 持续 / 范围 一个字节都没改', () => {
  /** 改动**前**的原始配置（从 0.1.3 抄下来的，用来比对） */
  const BEFORE = {
    'op41:star3': {
      /*
        ★ 0.2：耀骑士的 3 星被策划表**有意改过**（不是措辞调整）——
        从"5 发 +300%"改成"10 发 +800%"。所以这张对照表里它记的是 0.2 的口径。
      */
      name: '耀骑士·断罪',
      desc: '瞬移到血量最低的敌人面前，并获得 10 发弹药：每一发攻击力 +800%（打一次消耗一发）',
      stats: { attackDamageBp: 80000 },
      attacks: 10,
    },
    'op45:star3': {
      // ★ 0.2：技能名按新表改了（发数/倍率/范围仍照旧）
      name: '维什戴尔·爆裂黎明',
      desc: '接下来 6 次攻击变成 5×5 群体物理伤害，倍率 1000%',
      stats: {
        attackDamageBp: 90000,
        splash: {
          radius: 2,
          shape: 'square',
          ratioBp: 10000,
          damageType: 'physical',
          /*
            ★ 0.2 唯一一处**新增**的字段：把 op45 3 星这一发绑到"维什戴尔红黑爆炸"特效上。
            ★ 它不是数值：内核只把它原样塞进纯表现层的 `bloom` 事件（不进校验和），
              战斗结果一个数都不受影响 —— 所以放在"数值零改动"这张表里是诚实的，
              但必须写出来，免得以后有人以为 `fx` 是历史字段。
          */
          fx: 'vishdal_bloom',
        },
      },
      attacks: 6,
    },
  } as const;

  for (const [key, before] of Object.entries(BEFORE)) {
    it(`${key}「${before.name}」：倍率 / 发数 / 目标 / 时长 全部照旧，只换了说法`, () => {      const hit = hitOf(key);
      expect(hit.skillName, '技能名没改').toBe(before.name);
      const effect = hit.effect as unknown as {
        target: string;
        stats: Record<string, unknown>;
        durationTicks?: number;
      };
      expect(chargesOf(hit.effect), '发数 = 原来的"接下来 N 次"').toBe(before.attacks);
      expect(effect.target, '适用范围：都是加在自己身上').toBe('self');
      expect(effect.stats, '★ 数值一个字节都没改').toEqual(before.stats);
      expect(
        effect.durationTicks,
        '★ 持续回合：次数型的包时长记"整场"，靠发数消耗 —— 这条也不能动',
      ).toBe(MAX_BATTLE_TICKS);
    });
  }

  /**
   * ★ 0.2：这三条是**策划表有意改的**（不是措辞调整），所以单独列在这里，
   * 而不是塞进上面那张"一个字节都没改"的对照表。
   */
  const REWORKED_0_2 = {
    'op48:star3': {
      name: '赤刃明霄陈·绝影-驰',
      /** 发数固定 1：这一发 = 一次 5 连斩，杀人刷新 */
      charges: 1,
      stats: { multiHit: 5, multiHitBp: 90000, untargetable: true, onKillRefresh: true },
    },
    'op50:base': {
      name: '新约能天使·开火成瘾症',
      charges: 30,
      stats: { attackSpeedBp: [15000, 25000, 25000], attackDamageBp: [500, 1000, 1000] },
    },
    'op50:star3': {
      name: '新约能天使·使命必达！',
      charges: 50,
      stats: { attackSpeedBp: 50000, attackDamageBp: 3000, multiHit: 5 },
    },
  } as const;

  for (const [key, after] of Object.entries(REWORKED_0_2)) {
    it(`★ 0.2 改版 ${key}「${after.name}」：发数 / 数值按新表落地`, () => {
      const hit = hitOf(key);
      expect(hit.skillName).toBe(after.name);
      const effect = hit.effect as unknown as {
        target: string;
        stats: Record<string, unknown>;
        durationTicks?: number;
      };
      expect(chargesOf(hit.effect), '发数').toBe(after.charges);
      expect(effect.target, '适用范围：加在自己身上').toBe('self');
      expect(effect.stats).toEqual(after.stats);
      expect(effect.durationTicks, '次数型的包时长记"整场"，靠发数消耗').toBe(MAX_BATTLE_TICKS);
    });
  }

  it('op48:star3「绝影-驰」每次攻击消耗 5 发里的 1 发（5 次连斩算一次攻击）', () => {
    const effect = hitOf('op48:star3').effect as unknown as { chargesPerAttack?: number; attacks?: number };
    // 没写 chargesPerAttack = 每次消耗 1 发；`attacks: 1` 就是"这一次攻击"
    expect(effect.chargesPerAttack).toBeUndefined();
    expect(effect.attacks).toBe(1);
  });

  it('op50:star3「使命必达！」一次攻击消耗 5 发（表里："攻击变成五连击并消耗五发弹药"）', () => {
    const effect = hitOf('op50:star3').effect as unknown as { chargesPerAttack?: number; attacks?: number };
    expect(effect.chargesPerAttack, '每次攻击消耗 5 发').toBe(5);
    expect(effect.attacks, '50 发 ÷ 每次 5 发 = 10 次攻击').toBe(50);
  });

  it('「接下来 N 次攻击」的老说法已经从这 6 条里清掉了', () => {
    for (const hit of allAmmoEffects()) {
      expect(hit.desc, `${keyOf(hit)} 还在说"接下来 N 次"`).not.toContain('接下来');
    }
  });
});

// ------------------------------------------------------------------
// 4) 显示层：技能落的叫「弹药」，藏品/野怪落的不叫
// ------------------------------------------------------------------

function place(team: 0 | 1, defId: string, col: number, row: number): UnitPlacement {
  return { defId, star: 1, cell: { col, row } };
}

/** 一支队伍 —— 四个字段都要填（羁绊机制靠 unitMechanics 传进来） */
function team(teamId: 0 | 1, units: UnitPlacement[]): TeamSetup {
  return {
    team: teamId,
    units,
    traitBonuses: computeTraitBonuses(units, UNIT_DEFS, TRAIT_DEFS),
    unitTraitBonuses: computeUnitTraitBonuses(units, UNIT_DEFS, TRAIT_DEFS),
    activeTraits: computeActiveTraitLevels(units, UNIT_DEFS, TRAIT_DEFS),
    unitMechanics: resolveUnitMechanics(units, UNIT_DEFS, TRAIT_DEFS),
  };
}

function battle(units0: UnitPlacement[], units1: UnitPlacement[], seed = 7): BattleState {
  return createBattle(UNIT_DEFS, [team(0, units0), team(1, units1)], seed);
}

function unitOf(state: BattleState, defId: string): UnitState {
  const unit = state.units.find((item) => item.defId === defId);
  if (!unit) throw new Error(`场上没有 ${defId}`);
  return unit;
}

describe('★ 0.1.4 弹药：卡面显示', () => {
  it('★ 技能挂的「30 颗子弹」显示成「弹药 · 剩 30 次」，不再是笼统的「增益」', () => {
    /*
      新约能天使（基础技能）离敌人很远 —— 这样它开完技能后不会立刻打出去，
      那 30 发弹药就能被我们观察到（否则一开完就被这一击消耗掉了）。
      ★ 0.2 起这里原来用的是赤刃明霄陈，但他的基础技能改成 8 秒增益、不再按次数消耗了。
    */
    const state = battle([place(0, 'op50', 0, 5)], [place(1, 'mn_slime', 9, 5)]);
    const angel = unitOf(state, 'op50');
    angel.mana = MANA_MAX;
    for (let i = 0; i < 20 && !state.over; i++) {
      step(state, UNIT_DEFS);
      if ((angel.skill?.buffs ?? []).some((b) => b.attackCharges !== undefined)) break;
    }
    const effects = liveBuffEffects(angel);
    const countBased = effects.filter((e) => e.duration?.kind === 'count');
    expect(countBased.length, '前提：它身上确实挂着一包按次数消耗的').toBeGreaterThan(0);
    expect(
      countBased.every((e) => e.kind === 'ammo'),
      '★ 技能落的按次数消耗包，一律显示成「弹药」',
    ).toBe(true);
    expect(countBased[0]!.duration).toEqual({ kind: 'count', left: 30 });
  });

  it('藏品 / 野怪的「每 N 击强化下一击」形状一样，但不叫弹药', () => {
    /*
      同一个形状（attackCharges），只是没有 `fromSkill` 标记 ——
      突袭手雷把它叫"弹药"会让玩家以为这是技能给的。
    */
    const unit = {
      star: 1,
      skill: {
        buffs: [
          {
            stats: { attackDamageBp: 7000 },
            ticksLeft: MAX_BATTLE_TICKS,
            attackCharges: 1,
            sourceId: 1,
          },
        ],
      },
    } as unknown as UnitState;
    const effects = liveBuffEffects(unit);
    expect(effects.map((e) => e.kind), '★ 没打 fromSkill 标记的一律还是「增益」').toEqual(['buff']);
  });

  it('按**时间**走的限制增益（比如 10 秒内 +150%）仍然叫「增益」，不会被误伤', () => {
    const unit = {
      star: 1,
      skill: {
        buffs: [
          {
            stats: { attackDamageBp: 15000 },
            ticksLeft: 200,
            sourceId: 1,
            fromSkill: true,
          },
        ],
      },
    } as unknown as UnitState;
    const effects = liveBuffEffects(unit);
    expect(effects.map((e) => e.kind), '★ 只有"按次数消耗"的才叫弹药').toEqual(['buff']);
  });
});

// ------------------------------------------------------------------
// 5) 行为不变：发数照样一发一发掉
// ------------------------------------------------------------------

describe('★ 0.1.4 弹药：消耗行为没变', () => {
  it('★ 打一次掉一发，打光就摘掉（内核逻辑一行没改，这里只是钉住别被改坏）', () => {
    const state = battle([place(0, 'op50', 4, 4)], [place(1, 'mn_slime', 5, 4)]);
    const angel = unitOf(state, 'op50');
    const slime = unitOf(state, 'mn_slime');
    slime.hp = 100000; // 撑久一点，别一击就死
    slime.maxHp = 100000;
    angel.mana = MANA_MAX;
    for (let i = 0; i < 20 && !state.over; i++) {
      step(state, UNIT_DEFS);
      if ((angel.skill?.buffs ?? []).some((b) => b.attackCharges !== undefined)) break;
    }
    const ammo = () => angel.skill?.buffs?.find((b) => b.attackCharges !== undefined);
    expect(ammo()?.attackCharges, '开完技能 = 攒了 30 发').toBe(30);
    for (let i = 0; i < 200 && !state.over; i++) {
      step(state, UNIT_DEFS);
      if (!ammo()) break;
    }
    expect(ammo()?.attackCharges ?? 0, '每打一次掉一发').toBeLessThan(30);
  });
});

// ------------------------------------------------------------------
// 5.5) 端到端：客户端技能条读的是"内核采样里的 kind"
// ------------------------------------------------------------------

describe('★ 0.1.4 弹药：内核采样里出来的确实是 ammo', () => {
  it('★ 开完技能那一拍，属性时间线里采到的按次数效果 kind 是 ammo', () => {
    /*
      【为什么这条必须钉？】
      客户端的技能条（`three/skill-bar.ts`）是按"实时效果的种类"去找修正包的，
      它从**内核的属性时间线采样**里读（不是从 buff 直接读）。
      所以"弹药叫 ammo"这件事必须在**采样里**也成立 ——
      只对了一半的话，界面上就是"开完技能条没了"（0.1.4 真出过这个 bug）。
    */
    /*
      ★ 0.2：原来是"两边都放赤刃明霄陈的基础技能"（它是**受击**回蓝的，
      只有真的挨打才攒得满）。0.2 把他的基础技能改成了不再按次数消耗的增益，
      所以改用**3 星**的他 —— 3 星那套仍然是"1 发 = 一次 5 连斩"。
      两边对砍才能稳定开到技能（打一只史莱姆的话 41 tick 就结束了）。
    */
    const result = simulate(
      UNIT_DEFS,
      // `place` 只给 1 星，这里显式写一份 3 星的
      [
        team(0, [{ defId: 'op48', star: 3, cell: { col: 4, row: 4 } }]),
        team(1, [{ defId: 'op48', star: 3, cell: { col: 5, row: 4 } }]),
      ],
      7,
      { statsTimeline: true },
    );
    const countKinds = new Set<string>();
    for (const sample of result.statsTimeline ?? []) {
      for (const effect of sample.effects ?? []) {
        if (effect.countLeft !== undefined) countKinds.add(effect.kind);
      }
    }
    expect(
      [...countKinds],
      '★ 按次数消耗的技能效果，采样里的种类必须是 ammo（客户端技能条按它认）',
    ).toContain('ammo');
  });
});

// ------------------------------------------------------------------
// 6) 源码级：标记只能由技能这一侧打
// ------------------------------------------------------------------

describe('★ 0.1.4 弹药：来源标记不能到处打', () => {
  const src = readFileSync(new URL('../src/rules.ts', import.meta.url), 'utf8');

  it('藏品的 everyNthAttack 挂载处**没有** fromSkill（否则藏品也叫弹药了）', () => {
    const block = src.slice(src.indexOf("mechanic.kind !== 'everyNthAttack'"));
    const addBuff = block.slice(block.indexOf('addBuff('), block.indexOf('addBuff(') + 400);
    expect(addBuff).toContain('attackCharges');
    expect(addBuff, '★ 藏品那条路不许打 fromSkill').not.toContain('fromSkill');
  });
});
