/**
 * ★ 0.2：「治疗量」的两条口径 —— **双基准相加** 与 **万分比**。
 *
 * ============================================================
 *  【为什么要专门钉这一组？】
 * ============================================================
 * 0.2 改版里有两位干员的治疗量是「**两个基准加起来**」：
 *   · 芙蓉 —— 自身攻击力 110%/120%/125% **+** 治疗目标生命上限 3%/6%/10%
 *   · 夜莺 —— 目标生命上限 1%/3%/5% **+** 自身攻击力 50%/70%/100%（0.2.1 下调）
 * 单条 `{ basis, ratioBp }` 表达不了，所以 `attackHeals` / `pulse.heal` 都改成了
 * 「单条 或 数组」。这一组测试守的是：
 *   1. 数组真的**逐条相加**（不是取第一条）；
 *   2. `ratioBp` 仍然是**万分比**；
 *   3. 换算是**唯一一处实现**（`mods.ts` 的 `basisAmount` / `healAmountOf`）。
 *
 * 【第 2 条不是凑数的 —— 这里刚修掉一个 10 倍的真 bug】
 * `rules.ts` 里凯尔希那条「每次攻击治疗百分比血量最低的队友」原来是
 * `Math.floor((base * ratioBp) / FIX)`。`ratioBp` 是万分比（3500 = 35%），
 * 除 FIX(1000) 等于**除以 10** ⇒ 凯尔希每次普攻给队友回 **350%** 生命上限的血。
 * 旁边几条同样形状的代码（脉冲治疗、芙蓉）都用的 `/ BP`，只有它写错了；
 * 而且**没有任何测试覆盖它**，所以一直没被发现。
 * 现在它和另外两处一起走 `healAmountOf()`，这一组测试也就顺手把它钉住了。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  UNIT_DEFS,
  collectMods,
  createBattle,
  healAmountOf,
  pulseIntervalTicks,
  resolveHeals,
  type BattleState,
  type Cell,
  type TeamSetup,
  type UnitDef,
  type UnitPlacement,
  type UnitState,
} from '../src/index.js';

/** 按名字找干员（★ 不写死 id —— 名单以后会换） */
const byName = (name: string): UnitDef => {
  const def = Object.values(UNIT_DEFS).find((d) => d.name === name);
  if (!def) throw new Error(`找不到干员「${name}」——名字改过？`);
  return def;
};

const KAEL = byName('凯尔希·思衡托');
const FURONG = byName('芙蓉');
const NIGHTINGALE = byName('夜莺');

/** 只放队伍 0 的这几位（队伍 1 空着） */
function arena(placements: Array<[UnitDef, number, Cell]>, seed = 20261016): BattleState {
  const units: UnitPlacement[] = placements.map(([def, star, cell]) => ({ defId: def.id, star, cell }));
  const setups: [TeamSetup, TeamSetup] = [
    { team: 0, units },
    { team: 1, units: [] },
  ];
  return createBattle(UNIT_DEFS, setups, seed);
}

const unitOf = (state: BattleState, def: UnitDef): UnitState => {
  const unit = state.units.find((u) => u.defId === def.id);
  if (!unit) throw new Error(`${def.name} 没进战斗`);
  return unit;
};

describe('★ 0.2 治疗基准：双基准相加', () => {
  it('healAmountOf 逐条相加，不是只取第一条', () => {
    const state = arena([
      [FURONG, 3, { col: 4, row: 4 }],
      [KAEL, 3, { col: 3, row: 4 }],
    ]);
    const caster = unitOf(state, FURONG);
    const target = unitOf(state, KAEL);
    // 手工给一个"活着但残血"的目标，让"目标生命上限"这一条能算出来
    target.hp = Math.floor(target.maxHp / 2);

    const heals = resolveHeals(
      [
        { basis: 'attack', ratioBp: 12500 },
        { basis: 'targetMaxHp', ratioBp: 1000 },
      ],
      3,
    )!;
    expect(heals, '两条基准都要在').toHaveLength(2);

    const expected =
      Math.floor((caster.attackDamage * 12500) / 10000) + Math.floor((target.maxHp * 1000) / 10000);
    expect(healAmountOf(caster, target, heals)).toBe(expected);
    expect(
      healAmountOf(caster, target, heals),
      '两条相加必须**大于**任意一条',
    ).toBeGreaterThan(healAmountOf(caster, target, [heals[0]!]));
  });

  it('resolveHeals：单条写法照旧能用（老数据不用改）', () => {
    const one = resolveHeals({ basis: 'casterMaxHp', ratioBp: [3500, 4500, 4500] }, 3)!;
    expect(one).toEqual([{ basis: 'casterMaxHp', ratioBp: 4500 }]);
    expect(resolveHeals(undefined, 3)).toBeNull();
  });

  it('芙蓉：攻击力 110%/120%/125% + 目标生命上限 3%/6%/10%', () => {
    const buff = FURONG.skill.effects[0]!;
    const spec = buff.kind === 'buff' ? buff.stats?.attackHeals : undefined;
    expect(spec, '芙蓉的治疗量是两条基准相加').toBeInstanceOf(Array);
    expect(spec).toEqual([
      { basis: 'attack', ratioBp: [11000, 12000, 12500] },
      { basis: 'targetMaxHp', ratioBp: [300, 600, 1000] },
    ]);
    // 万分比口径：11000 = 110%（不是 1100%）
    expect(resolveHeals(spec, 1)![0]!.ratioBp).toBe(11000);
  });

  it('夜莺：目标生命上限 1%/3%/5% + 自身攻击力 50%/70%/100%（0.2.1 下调）', () => {
    const pulse = NIGHTINGALE.skill.passive?.pulse;
    expect(pulse, '夜莺的治疗光环挂在被动上').toBeDefined();
    /*
      ★ 0.2.1（用户 2026-10-17）：攻击力折算 110%/120%/135% -> **50%/70%/100%**。
      原来的量级让她的单次治疗比主奶（芙蓉 110%/120%/125%）还高，
      而她 3 费、范围 2、还是纯被动 —— 一个不需要蓝的奶把主动奶全压死了。
    */
    expect(pulse!.heal).toEqual([
      { basis: 'targetMaxHp', ratioBp: [100, 300, 500] },
      { basis: 'attack', ratioBp: [5000, 7000, 10000] },
    ]);
    // 万分比口径：5000 = 50%（别写成 500 = 5%）
    expect(resolveHeals(pulse!.heal, 1)![1]!.ratioBp).toBe(5000);
    expect(pulse!.intervalFromAttackSpeed, '表里写的是"按照攻击频率"，不是固定 1 秒').toBe(true);
  });
});

describe('★ 0.2 脉冲间隔：跟着攻速走', () => {
  it('intervalFromAttackSpeed 时，间隔 = 20 tick × 1000 / 攻速', () => {
    const state = arena([[NIGHTINGALE, 3, { col: 4, row: 4 }]]);
    const night = unitOf(state, NIGHTINGALE);
    const pulse = collectMods(state, night).pulse!;
    expect(pulse.intervalFromAttackSpeed).toBe(true);

    // 攻速 1200（每秒 1.2 次）→ 20 × 1000 / 1200 = 16.67 → 17 tick
    expect(pulseIntervalTicks({ attackSpeed: 1200 } as UnitState, pulse)).toBe(17);
    // 攻速 1000 → 整齐的 20 tick（1 秒）
    expect(pulseIntervalTicks({ attackSpeed: 1000 } as UnitState, pulse)).toBe(20);
    // 攻速 500（蕾缪安那种慢枪）→ 40 tick
    expect(pulseIntervalTicks({ attackSpeed: 500 } as UnitState, pulse)).toBe(40);
    // 攻速 0 / 负数不能除出 Infinity（兜底当成 1，间隔 = 20 × 1000 / 1）
    expect(pulseIntervalTicks({ attackSpeed: 0 } as UnitState, pulse), '攻速写 0 时兜底').toBe(
      20 * 1000,
    );
  });

  it('不开这个开关的脉冲（魔王）仍然用固定秒数', () => {
    /*
      ★ 用 1 星：魔王的 3 星是**整条替换**的「不灭王权」，
      `skillVariantOf` 到 3 星就不再返回基础被动 —— 那样这里会读到 null。
    */
    const state = arena([[byName('魔王'), 1, { col: 4, row: 4 }]]);
    const mo = unitOf(state, byName('魔王'));
    const pulse = collectMods(state, mo).pulse;
    expect(pulse, '魔王的治疗光环挂在基础被动上（1/2 星）').toBeTruthy();
    expect(pulse!.intervalFromAttackSpeed).toBeFalsy();
    expect(pulseIntervalTicks({ attackSpeed: 3000 } as UnitState, pulse!)).toBe(pulse!.intervalTicks);
  });
});

describe('★★ 凯尔希回归：每次攻击治疗队友是 35%/45% 生命上限，不是 350%', () => {
  it('解析出来的数值就是 45%（万分比 4500）', () => {
    /*
      ★ 用 2 星：凯尔希的 3 星会**整条替换**成「保护性拒止」，
      而这条被动是挂在 1/2 星那套上的。（2 星 = 45%）
    */
    const state = arena([
      [KAEL, 2, { col: 4, row: 4 }],
      [FURONG, 1, { col: 3, row: 4 }],
    ]);
    const kael = unitOf(state, KAEL);
    const ally = unitOf(state, FURONG);
    const mods = collectMods(state, kael);
    expect(mods.onAttackAllyBuff?.heal, '凯尔希靠这条被动奶人').toBeTruthy();

    const amount = healAmountOf(kael, ally, mods.onAttackAllyBuff!.heal!);
    expect(amount).toBe(Math.floor((kael.maxHp * 4500) / 10000));
    expect(amount, '曾经这里除以 1000 而不是 10000，会奶出 350% 生命上限').toBeLessThan(kael.maxHp);
  });
});

describe('★ 防回归：治疗的数值换算只有一处实现', () => {
  /*
    「同一动作只允许一处实现」在治疗这块的具体体现：
    消费方只能拿到**已经按星级定死好的数值**（`ResolvedHeal[]`），
    不许再去碰 `heal.ratioBp` / `attackHeals.basis` 这类原始字段自己换算 ——
    否则"双基准相加"和"万分比还是千分比"这两件事就会各写一份、各错一次
    （凯尔希那个 10 倍 bug 就是这么来的）。
  */
  const srcDir = new URL('../src/', import.meta.url);
  const read = (file: string): string => readFileSync(fileURLToPath(new URL(file, srcDir)), 'utf8');

  it('rules.ts / skills.ts / combat-math.ts 里不再自己读 heal 的原始基准字段', () => {
    for (const file of ['rules.ts', 'skills.ts', 'combat-math.ts']) {
      const src = read(file);
      for (const pattern of ['attackHeals.basis', 'pulse.heal.basis', 'heal.ratioBp']) {
        expect(src.includes(pattern), `${file} 里出现了 ${pattern} —— 请改走 healAmountOf()`).toBe(false);
      }
    }
  });

  it('唯一实现就是 mods.ts 的 basisAmount / healAmountOf', () => {
    const src = read('mods.ts');
    expect(src).toContain('export function basisAmount(');
    expect(src).toContain('export function healAmountOf(');
    expect(src).toContain('export function resolveHeals(');
    expect(src).toContain('export function pulseIntervalTicks(');
  });
});
