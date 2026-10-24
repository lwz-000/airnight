/**
 * ============================================================
 *  ★★ 0.3.2 盟约「阿米娅 · 不容拒绝」：棋子与藏品的数据自检
 * ============================================================
 *
 * 这一版**只做"棋子 + 藏品 + 升变链路"，技能留空**（用户口径）。
 * 所以这里钉的是"数据能不能撑起这条链"，不是技能效果：
 *   1. 三个形态都在单位表里，但**不能被买到**（`ascendOnly`）；
 *   2. 三张升变之证是**盟约专属**：不进商店、不进掉落、不进招募 / 拟态；
 *   3. 证和形态的对应关系两侧一致（藏品写 `to`，形态表里真有这个 id）。
 */
import { describe, expect, it } from 'vitest';
import {
  ADVANCED_ITEMS,
  AMIYA_BASE_ID,
  AMIYA_FORM_IDS,
  ASCEND_DEFS,
  ITEM_DEFS,
  MONSTER_DROP_TABLE,
  NORMAL_ITEMS,
  UNIT_DEFS,
  isPlayableDef,
  itemsOf,
  playableDefs,
  unitIdsByCost,
} from '../src/index.js';

const CERTS = ['itm_amiya_blue_cert', 'itm_amiya_mercy_cert', 'itm_amiya_core_cert'];

describe('★ 升变形态：三个棋子', () => {
  it('都在单位表里，费用 3 / 3 / 5', () => {
    expect(UNIT_DEFS[AMIYA_FORM_IDS.blue]?.cost).toBe(3);
    expect(UNIT_DEFS[AMIYA_FORM_IDS.mercy]?.cost).toBe(3);
    expect(UNIT_DEFS[AMIYA_FORM_IDS.core]?.cost).toBe(5);
  });

  it('★★ 都标了 `ascendOnly`，而且**买不到**（商店 / 牌库 / 招募都会排除）', () => {
    for (const id of Object.values(AMIYA_FORM_IDS)) {
      const def = UNIT_DEFS[id]!;
      expect(def.ascendOnly, `${def.name} 必须标 ascendOnly`).toBe(true);
      expect(isPlayableDef(def), `${def.name} 不该被认为是"能买的"`).toBe(false);
      expect(playableDefs().some((entry) => entry.id === id), `playableDefs 里不该有 ${def.name}`).toBe(false);
      // 按费用取"能买的棋子"时也不能出现
      expect(unitIdsByCost(def.cost)).not.toContain(id);
    }
  });

  it('羁绊与阿米娅一致（罗德岛 / 领导人 / 法术）——升变不能把羁绊洗掉', () => {
    const base = UNIT_DEFS[AMIYA_BASE_ID]!;
    for (const id of Object.values(AMIYA_FORM_IDS)) {
      expect([...UNIT_DEFS[id]!.traits].sort()).toEqual([...base.traits].sort());
    }
  });

  it('★ 技能字段留好了接口（有 id / 名字 / 描述，effects 是数组）', () => {
    for (const id of Object.values(AMIYA_FORM_IDS)) {
      const skill = UNIT_DEFS[id]!.skill;
      expect(skill.id.length).toBeGreaterThan(0);
      expect(skill.name.length).toBeGreaterThan(0);
      expect(skill.desc.length).toBeGreaterThan(0);
      expect(Array.isArray(skill.effects)).toBe(true);
    }
  });

  /*
    ★★ 0.3.2：正式技能（用户给的《阿米娅升变.txt》）。

    这里钉的是"文本里的关键数字和机制真的进了数据"——
    改数值时这些断言会红，提醒回去核对表。
  */
  it('★ 青色怒火：射程 1 / 攻击回复 / 初始技能条 100·300·600（万分数 1000·3000·6000）', () => {
    const def = UNIT_DEFS[AMIYA_FORM_IDS.blue]!;
    expect(def.base.range).toBe(1);
    expect(def.skill.manaSource).toBe('attack');
    expect(def.skill.startManaBp).toEqual([1000, 3000, 6000]);
  });

  it('★ 青色怒火：弹药 10/15/20、真实伤害、攻击力 +20/30/50%、两连击、全队 +20/25/30%', () => {
    const skills = UNIT_DEFS[AMIYA_FORM_IDS.blue]!.skill;
    const self = skills.effects.find((e) => e.kind === 'buff' && e.target === 'self');
    expect(self).toBeDefined();
    if (self?.kind !== 'buff') throw new Error('数据形状不对');
    expect(self.attacks).toEqual([10, 15, 20]);
    // ★ 2026-10-22 用户下调：原来 50/70/120 太强 -> 20/30/50
    expect(self.stats.attackDamageBp).toEqual([2000, 3000, 5000]);
    expect(self.stats.damageTypeOverride).toBe('true');
    expect(self.stats.multiHit).toBe(2);

    const allies = skills.effects.find((e) => e.kind === 'buff' && e.target === 'allAllies');
    if (allies?.kind !== 'buff') throw new Error('缺全队那条');
    expect(allies.stats.attackDamageBp).toEqual([2000, 2500, 3000]);
    expect(allies.stats.multiHit).toBe(2);
  });

  it('★ 慈悲愿景：射程 4 / 攻击回复 / 初始技能条 200·400·600 / 前方矩形真实伤害 + 迟缓', () => {
    const def = UNIT_DEFS[AMIYA_FORM_IDS.mercy]!;
    expect(def.base.range).toBe(4);
    expect(def.skill.manaSource).toBe('attack');
    expect(def.skill.startManaBp).toEqual([2000, 4000, 6000]);

    const hit = def.skill.effects.find((e) => e.kind === 'damage');
    if (hit?.kind !== 'damage') throw new Error('缺主动伤害');
    expect(hit.power).toEqual([2000, 3000, 5000]);
    expect(hit.damageType).toBe('true');
    // 前方 3 格 + 两侧各一格 ⇒ 矩形、深 3（含自己那格共 4 格）
    expect(hit.shape).toBe('rect');
    expect(hit.radius).toBe(3);
    // 迟缓：攻速 -50%，3/5/10 秒
    expect(hit.debuff?.stats.attackSpeedBp).toBe(-5000);
    expect(hit.debuff?.durationTicks).toEqual([60, 100, 200]);
  });

  it('★ 慈悲愿景被动：按攻击频率、3 格内治疗一个友军（20/30/45%）', () => {
    const pulse = UNIT_DEFS[AMIYA_FORM_IDS.mercy]!.skill.passive?.pulse;
    expect(pulse).toBeDefined();
    expect(pulse!.intervalFromAttackSpeed, '要跟着攻速走 = 每次攻击一跳').toBe(true);
    expect(pulse!.radius).toBe(3);
    expect(pulse!.affect).toBe('allies');
    expect(pulse!.single).toBe(true);
    expect(pulse!.heal).toEqual({ basis: 'attack', ratioBp: [2000, 3000, 4500] });
  });

  it('★ 炉芯终曲：射程 5 / 自然回复 / 初始技能条 900（90%）', () => {
    const def = UNIT_DEFS[AMIYA_FORM_IDS.core]!;
    expect(def.base.range).toBe(5);
    expect(def.skill.manaSource).toBe('auto');
    expect(def.skill.startManaBp).toBe(9000);
  });

  it('★ 炉芯终曲：终曲 debuff 五项 -99% + 无法移动，10 秒', () => {
    const debuff = UNIT_DEFS[AMIYA_FORM_IDS.core]!.skill.effects.find((e) => e.kind === 'debuff');
    if (debuff?.kind !== 'debuff') throw new Error('缺终曲 debuff');
    expect(debuff.target).toBe('allEnemies');
    expect(debuff.stats.attackSpeedBp).toBe(-9900);
    expect(debuff.stats.attackDamageBp).toBe(-9900);
    expect(debuff.stats.armorBp).toBe(-9900);
    expect(debuff.stats.magicResistBp).toBe(-9900);
    expect(debuff.stats.manaGainBp).toBe(-9900);
    expect(debuff.stats.noMove).toBe(true);
    expect(debuff.durationTicks).toBe(200);
  });

  it('★ 炉芯终曲：每秒 5% 最大生命真实伤害（基数是被打的人自己的生命上限）', () => {
    const dot = UNIT_DEFS[AMIYA_FORM_IDS.core]!.skill.effects.find((e) => e.kind === 'dot');
    if (dot?.kind !== 'dot') throw new Error('缺终曲 dot');
    expect(dot.power, '★ 千分比：5% = 50，写成 500 就变成 50% 了').toBe(50);
    expect(dot.powerBasis).toBe('targetMaxHp');
    expect(dot.damageType).toBe('true');
    expect(dot.intervalTicks).toBe(20);
    expect(dot.durationTicks).toBe(200);
  });

  it('★★ 炉芯终曲被动：重生 1 次（倒地 10 秒 + 期间全场脉冲 + 复活后无敌 10 秒）', () => {
    const reborn = UNIT_DEFS[AMIYA_FORM_IDS.core]!.reborn;
    expect(reborn, '没有重生配置').toBeDefined();
    expect(reborn!.delayTicks).toBe(200);
    expect(reborn!.hpBp).toBe(10000);
    expect(reborn!.downedPulse?.intervalTicks).toBe(20);
    expect(reborn!.downedPulse?.power).toBe(1000);
    const invuln = reborn!.phase2?.buffs?.find((buff) => buff.stats.invulnerable === true);
    expect(invuln, '复活后要有无敌').toBeDefined();
    expect(invuln!.durationTicks).toBe(200);
  });

  it('都有模型 id（青怒=近卫阿米娅 / 慈悲=医疗阿米娅 / 终态=集成战略的敌方 Boss）', () => {
    /*
      ★ 终态用的是敌方 Boss「"阿米娅",炉芯终曲」的骨架（`enemy_2092_skzamy`），
      走 `fetch-chibi.ts` 里 `enemy_` 前缀那条分支（和野怪同一条路子）。
    */
    expect(UNIT_DEFS[AMIYA_FORM_IDS.blue]!.charId).toBe('char_1001_amiya2');
    expect(UNIT_DEFS[AMIYA_FORM_IDS.mercy]!.charId).toBe('char_1037_amiya3');
    expect(UNIT_DEFS[AMIYA_FORM_IDS.core]!.charId).toBe('enemy_2092_skzamy');
  });

  it('★ charId 两两不同（复制粘贴改漏会让两个形态共用一套小人）', () => {
    const ids = Object.values(AMIYA_FORM_IDS).map((id) => UNIT_DEFS[id]!.charId!);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('★ 升变之证：三件盟约专属藏品', () => {
  it('都存在、都是 A 类、装上即消耗', () => {
    for (const id of CERTS) {
      const item = ITEM_DEFS[id];
      expect(item, `${id} 不存在`).toBeTruthy();
      expect(item!.slot).toBe('A');
      expect(item!.onEquip?.consume, '装上升变后就该消耗掉').toBe(true);
      expect(item!.onEquip?.ascend, '缺了 ascend 就不是升变之证').toBeTruthy();
    }
  });

  it('★★ 都标了 `covenantOnly`，而且不在商店 / 招募 / 定向投放的池子里', () => {
    for (const id of CERTS) {
      expect(ITEM_DEFS[id]!.covenantOnly).toBe(true);
      expect(NORMAL_ITEMS.some((item) => item.id === id)).toBe(false);
      expect(ADVANCED_ITEMS.some((item) => item.id === id)).toBe(false);
      expect(itemsOf(ITEM_DEFS[id]!.rarity, 'A').some((item) => item.id === id)).toBe(false);
    }
  });

  it('★★ 也**不能**出现在野怪掉落表里（掉落表是逐件手写的，这里钉住）', () => {
    const droppable = new Set<string>();
    for (const rule of Object.values(MONSTER_DROP_TABLE)) {
      for (const group of rule.groups) for (const id of group.items) droppable.add(id);
    }
    for (const id of CERTS) {
      expect(droppable.has(id), `${ITEM_DEFS[id]!.name} 不该能从野怪身上掉出来`).toBe(false);
    }
  });

  it('★★ 证 ↔ 形态的对应关系：`to` 都是真的形态，`from` 也都在单位表里', () => {
    for (const id of CERTS) {
      const ascend = ITEM_DEFS[id]!.onEquip!.ascend!;
      expect(ASCEND_DEFS[ascend.to], `${id} 想变成的 ${ascend.to} 不在升变表里`).toBeTruthy();
      for (const from of ascend.from) {
        expect(UNIT_DEFS[from], `${id} 的 from 里 ${from} 不存在`).toBeTruthy();
      }
    }
  });

  it('升级路线：普通阿米娅 → 两个 3 费形态；3 费形态 → 终态（且要求 3 星）', () => {
    expect(ITEM_DEFS['itm_amiya_blue_cert']!.onEquip!.ascend).toEqual({
      from: [AMIYA_BASE_ID],
      to: AMIYA_FORM_IDS.blue,
    });
    expect(ITEM_DEFS['itm_amiya_mercy_cert']!.onEquip!.ascend).toEqual({
      from: [AMIYA_BASE_ID],
      to: AMIYA_FORM_IDS.mercy,
    });
    const final = ITEM_DEFS['itm_amiya_core_cert']!.onEquip!.ascend!;
    expect([...final.from].sort()).toEqual([AMIYA_FORM_IDS.blue, AMIYA_FORM_IDS.mercy].sort());
    expect(final.to).toBe(AMIYA_FORM_IDS.core);
    expect(final.minStar, '炉芯终曲必须 3 星').toBe(3);
  });
});
