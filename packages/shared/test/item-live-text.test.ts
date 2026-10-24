/**
 * ============================================================
 *  ★ 0.1.1：「藏品实时数值」（`itemLiveLines`）
 * ============================================================
 *
 * 【为什么值得单独一组测试？】
 * 效果栏 / 干员详情页以前贴的是 `itemEffectLines`（机制全文），
 * 里面全是 `间隔=200 tick（10.0 秒）`、`active=false`、`修正包 攻击力 +20%`
 * 这类**内部写法**，而且同一件事会说两遍（层数标签 + 每层属性 + 上限 + 重置）。
 * 用户的要求是"不要计算格式，要显示实时数值" —— 所以这一组钉三件事：
 *   ① 成长类按**当前层数**折成总量（藏品自带的静态部分也算进去）；
 *   ② 门槛类（血量 / 金币 / 羁绊）直接说"生效中 / 未生效"和当前值；
 *   ③ ★ 任何一件藏品的实时数值里都**不许出现内部字段**（tick / = / 修正包）。
 */
import { describe, expect, it } from 'vitest';
import { ITEM_DEFS, itemLiveLines, type ItemLiveContext } from '../src/index.js';

/** 一份"什么都有"的上下文：3 层圆石祭坛、7 层笔记、47 金、28 血、4 个羁绊 */
function ctxOf(over: Partial<ItemLiveContext> = {}): ItemLiveContext {
  return {
    growth: {
      itm_pebble_altar: 3,
      itm_blackflow_notes: 7,
      itm_survivor_contract: 3,
      itm_mercenary_trinket: 4,
      itm_grudge_list: 20,
      itm_home_stirfry: 2,
    },
    unequipped: 2,
    gold: 47,
    hp: 28,
    activeTraits: 4,
    round: 6,
    summonName: (id) => ({ summon_dummy: '假人', summon_yanyou: '炎佑' })[id] ?? id,
    traitName: (id) => (id === 'yan' ? '炎' : id),
    ...over,
  };
}

const text = (id: string, over: Partial<ItemLiveContext> = {}): string =>
  itemLiveLines(ITEM_DEFS[id]!, ctxOf(over)).join(' · ');

describe('★ 实时数值：跨回合成长按当前层数折算', () => {
  it('圆石祭坛：3 层 -> 攻击 / 护甲 / 魔抗各 +15%', () => {
    expect(text('itm_pebble_altar')).toBe('攻击力 +15%；护甲 +15%；魔抗 +15%');
  });

  it('★ 藏品自带的静态部分也要算进去（玩家要看的是总数）', () => {
    // 佣兵的饰物：底 +5% + 每层 +5%，4 层 -> 25%
    expect(text('itm_mercenary_trinket')).toBe(
      '攻击力 +25%；护甲 +25%；魔抗 +25%；生命上限 +25%',
    );
    // 仇名录：底 +2% + 每层 +1%，20 层 -> 22%
    expect(text('itm_grudge_list')).toBe('攻击力 +22%');
    // 家常小炒：底 +20% + 每层 +5%，2 层 -> 30%
    expect(text('itm_home_stirfry')).toBe('生命上限 +30%；攻击力 +30%');
  });

  it('悲伤的红：按"藏品栏里没装载的数量"实时算（不是累计层数）', () => {
    expect(text('itm_sad_red', { unequipped: 2 })).toBe('生命上限 +16%；攻击力 +16%');
    expect(text('itm_sad_red', { unequipped: 0 })).toBe('尚未叠层（当前没有加成）');
  });

  it('黑流树海笔记：层数换成"额外金币概率"（每 5 层 +1%）', () => {
    expect(text('itm_blackflow_notes')).toBe('胜利后额外金币概率 1%（当前 7 层）');
    expect(text('itm_blackflow_notes', { growth: { itm_blackflow_notes: 3 } })).toContain('0%');
  });

  it('生还者合约：层数放大的是开局那份随机强化（含开局白送的 1 层）', () => {
    // 数据里 base = 1（开局就有 +20%），再叠 3 次胜利 -> 4 层 = +80%
    // 还没开打时不知道抽到谁，只写"一名干员"
    expect(text('itm_survivor_contract')).toBe(
      '开局随机强化一名干员：攻击力 +80%；护甲 +80%；魔抗 +80%',
    );
    // 一场没赢也还有开局那一层
    expect(text('itm_survivor_contract', { growth: { itm_survivor_contract: 0 } })).toBe(
      '开局随机强化一名干员：攻击力 +20%；护甲 +20%；魔抗 +20%',
    );
  });

  it('★ 开打之后能写出"强化到谁身上了"（用户要求）', () => {
    const picked = itemLiveLines(
      ITEM_DEFS['itm_survivor_contract']!,
      ctxOf({ randomBuffPick: (id) => (id === 'itm_survivor_contract' ? '银灰' : null) }),
    ).join('');
    expect(picked).toContain('开局随机强化：银灰');
    expect(picked, '数值照样要显示').toContain('攻击力 +80%');

    // 抽签是别的藏品 -> 不串台
    const other = itemLiveLines(
      ITEM_DEFS['itm_survivor_contract']!,
      ctxOf({ randomBuffPick: () => null }),
    ).join('');
    expect(other).toContain('开局随机强化一名干员');
  });
});

describe('★ 实时数值：场外门槛（血量 / 金币 / 羁绊）', () => {
  it('皇帝的新枪：残血才生效，两边都写清当前血量', () => {
    expect(text('itm_emperor_gun', { hp: 22 })).toContain('生效中');
    expect(text('itm_emperor_gun', { hp: 22 })).toContain('攻击力 +30%');
    expect(text('itm_emperor_gun', { hp: 82 })).toContain('未生效');
    expect(text('itm_emperor_gun', { hp: 82 })).toContain('82');
  });

  it('魔王的旗帜：健康时才生效（严格大于 70）', () => {
    expect(text('itm_demon_king_banner', { hp: 82 })).toContain('攻速 +50%');
    expect(text('itm_demon_king_banner', { hp: 70 }), '等于 70 不算').toContain('未生效');
  });

  it('金酒之杯：每 5 金 +3% 攻速（按当前金币算）', () => {
    expect(text('itm_gin_cup', { gold: 47 })).toBe('当前 47 金：攻速 +27%');
    expect(text('itm_gin_cup', { gold: 100 })).toBe('当前 100 金：攻速 +60%');
  });

  it('老蒲扇：按"当前激活了几个羁绊"算', () => {
    expect(text('itm_old_fan', { activeTraits: 4 })).toBe('当前 4 个羁绊：攻击力 +40%');
  });

  it('苍桐：金币门槛一到就说"生效中"，并写清周期与伤害', () => {
    expect(text('itm_cangtong', { gold: 85 })).toBe(
      '当前 85 金：每 10 秒对全场敌人 100 点法术伤害 + 1.5 秒晕眩（生效中）',
    );
    expect(text('itm_cangtong', { gold: 40 })).toBe('当前 40 金：未生效（需要 70 金以上）');
  });
});

describe('★ 实时数值：召唤物按当前回合算属性', () => {
  it('支援防暴桩：第 5 回合后 +300（封顶 1900）', () => {
    expect(text('itm_riot_bunker', { round: 1 })).toBe('开局召唤 假人×2：生命 1000 / 攻击 0（第 1 回合）');
    expect(text('itm_riot_bunker', { round: 6 })).toContain('生命 1300');
    expect(text('itm_riot_bunker', { round: 20 })).toContain('生命 1900');
  });

  it('天师锦囊：大炎羁绊开着才有 +30%（炎佑自己不参与羁绊构建）', () => {
    const yan = { activeTraitIds: ['yan'] };
    expect(text('itm_celestial_pouch', { round: 6, ...yan })).toContain('生命 1300');
    expect(text('itm_celestial_pouch', { round: 20, ...yan })).toContain('生命 1950');

    // 没开大炎 -> 只有基础 + 里程碑，并且要说清为什么没有那 30%
    const plain = text('itm_celestial_pouch', { round: 6 });
    expect(plain).toContain('生命 1000');
    expect(plain).toContain('炎羁绊未激活');
  });

  it('支援防暴桩的假人**没有**条件（永远按回合成长）', () => {
    expect(text('itm_riot_bunker', { round: 6 })).toContain('生命 1300');
    expect(text('itm_riot_bunker', { round: 6 })).not.toContain('未激活');
  });
});

describe('★ 实时数值：固定数值也直接给出来', () => {
  it('治疗类 / 经济类 / 商店花费 / 人口上限', () => {
    expect(text('itm_surge_meal')).toBe('全队受到的治疗与回复 +30%');
    expect(text('itm_live_rose')).toBe('全队受到的治疗与回复 +8%');
    expect(text('itm_treasure_ring')).toBe('每回合 +1 金');
    expect(text('itm_knight_lance_pro')).toBe('野怪回合金币 +50%');
    expect(text('itm_terrain_map')).toBe('人口上限 +1');
    expect(text('itm_sword_hammer')).toContain('购买干员的花费 +2');
  });

  it('没有实时维度就返回空数组（界面回退到那句人话说明）', () => {
    // 无瑕宝玉是"装上一把给 30 金"的一次性道具，没有持续数值
    expect(itemLiveLines(ITEM_DEFS['itm_flawless_jade']!, ctxOf())).toEqual([]);
    // 博士银印同理（招募是一次性动作）
    expect(itemLiveLines(ITEM_DEFS['itm_doc_silver_seal']!, ctxOf())).toEqual([]);
  });
});

describe('★ 实时数值：一个字都不许出现内部写法（防回归）', () => {
  it('全 66 件的实时数值里不含 tick / = / 修正包 / 内部 id', () => {
    const bad = /tick|active=|修正包|=|summon_|itm_/;
    const offenders: string[] = [];
    for (const item of Object.values(ITEM_DEFS)) {
      for (const line of itemLiveLines(item, ctxOf())) {
        if (bad.test(line)) offenders.push(`${item.name}：${line}`);
      }
    }
    expect(offenders, '这些实时数值里出现了内部写法').toEqual([]);
  });
});
