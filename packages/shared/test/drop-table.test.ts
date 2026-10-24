/**
 * ============================================================
 *  野怪掉落表（★ 0.0.3，来自《各项数值/掉落表.txt》）
 * ============================================================
 * 钉住四件事：
 *   ① 每个档位"先掷金币、掉了金币就不掉藏品"；
 *   ② 藏品是按**组**掷的（组内等概率、稀有组按逐件权重）；
 *   ③ 必掉件数 / 额外掉一件的概率和表里一致；
 *   ④★ 从**真实战斗日志**里数击杀（killedDefIds）——
 *      这是"按击杀逐只掷"的前提，也是上一版"一件藏品都不掉"的修复点。
 */
import { describe, expect, it } from 'vitest';
import {
  ITEM_DEFS,
  MONSTER_DROP_TABLE,
  TRAIT_RELICS,
  UNIT_DEFS,
  createBattle,
  createRng,
  dropChanceBp,
  dropChancePerKillBp,
  killedDefIds,
  rollDrops,
  rollOneItem,
  step,
  type DropTier,
  type UnitPlacement,
} from '../src/index.js';

const TIERS: DropTier[] = ['minion', 'normal', 'elite', 'leader', 'boss'];

describe('★ 掉落表：结构', () => {
  it('五个档位都有规则，且各组的权重加起来正好 100%', () => {
    for (const tier of TIERS) {
      const rule = MONSTER_DROP_TABLE[tier];
      const total = rule.groups.reduce((sum, g) => sum + g.weightBp, 0);
      expect(total, `${tier} 的组权重`).toBe(10000);
    }
  });

  it('表里出现的藏品 id 都是真藏品（打错字会静默掉不出来）', () => {
    for (const tier of TIERS) {
      for (const group of MONSTER_DROP_TABLE[tier].groups) {
        expect(group.items.length).toBeGreaterThan(0);
        if (group.weightsBp) expect(group.weightsBp.length, `${tier} 的逐件权重个数`).toBe(group.items.length);
        for (const id of group.items) {
          expect(ITEM_DEFS[id], `${tier} 里引用了不存在的藏品 ${id}`).toBeDefined();
        }
      }
    }
  });

  it('金币档：小怪 45% 掉 2 金、普通 30% 掉 4 金；精英以上不掉金', () => {
    expect(MONSTER_DROP_TABLE.minion.gold).toEqual({ chanceBp: 4500, amount: 2 });
    expect(MONSTER_DROP_TABLE.normal.gold).toEqual({ chanceBp: 3000, amount: 4 });
    for (const tier of ['elite', 'leader', 'boss'] as DropTier[]) {
      expect(MONSTER_DROP_TABLE[tier].gold, `${tier} 不该掉金币`).toBeUndefined();
    }
  });

  it('必掉件数 / 额外概率和表里一致', () => {
    expect(MONSTER_DROP_TABLE.elite.guaranteed).toBe(1);
    expect(MONSTER_DROP_TABLE.elite.extraChanceBp).toBe(2000);
    expect(MONSTER_DROP_TABLE.leader.guaranteed).toBe(1);
    expect(MONSTER_DROP_TABLE.leader.extraChanceBp).toBe(5000);
    expect(MONSTER_DROP_TABLE.boss.guaranteed).toBe(2);
    expect(MONSTER_DROP_TABLE.boss.extraChanceBp).toBe(5000);
  });
});

describe('★ 掉落表：掷骰结果', () => {
  it('小怪：要么 2 金币、要么 1 件藏品（不会同时给）', () => {
    for (let seed = 1; seed < 400; seed++) {
      const drop = rollDrops('minion', createRng(seed));
      const kinds = (drop.gold > 0 ? 1 : 0) + drop.items.length;
      expect(kinds, `种子 ${seed} 的掉落 ${JSON.stringify(drop)}`).toBe(1);
      if (drop.gold > 0) expect(drop.gold).toBe(2);
    }
  });

  it('精英：至少 1 件、最多 2 件；一件都不掉是不可能的', () => {
    for (let seed = 1; seed < 400; seed++) {
      const drop = rollDrops('elite', createRng(seed));
      expect(drop.gold).toBe(0);
      expect(drop.items.length).toBeGreaterThanOrEqual(1);
      expect(drop.items.length).toBeLessThanOrEqual(2);
    }
  });

  it('Boss：必掉 2 件，最多 3 件', () => {
    for (let seed = 1; seed < 400; seed++) {
      const drop = rollDrops('boss', createRng(seed));
      expect(drop.items.length).toBeGreaterThanOrEqual(2);
      expect(drop.items.length).toBeLessThanOrEqual(3);
    }
  });

  it('★ 确定性：同一个种子两次掷出完全一样的结果', () => {
    for (const tier of TIERS) {
      expect(rollDrops(tier, createRng(12345))).toEqual(rollDrops(tier, createRng(12345)));
    }
  });

  it('大样本下各组的命中率接近表里的百分比（小怪：A 60% / B 25% / C 10% / D 5%）', () => {
    const N = 20000;
    const counts = new Map<string, number>();
    for (let i = 0; i < N; i++) {
      const id = rollOneItem('minion', createRng(i * 7919 + 13));
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const groups = MONSTER_DROP_TABLE.minion.groups;
    const hit = groups.map(
      (group) => group.items.reduce((sum, id) => sum + (counts.get(id) ?? 0), 0) / N,
    );
    // 组权重是 60 / 25 / 10 / 5（0.1.1 加了一批新件，组权重没变）
    expect(hit[0], `A 组 ${(hit[0]! * 100).toFixed(1)}%`).toBeGreaterThan(0.55);
    expect(hit[0]).toBeLessThan(0.65);
    expect(hit[1]! * 100, 'B 组').toBeGreaterThan(20);
    expect(hit[1]! * 100).toBeLessThan(30);
    expect(hit[2]! * 100, 'C 组').toBeGreaterThan(7);
    expect(hit[2]! * 100).toBeLessThan(13);
    expect(hit[3]! * 100, 'D 组').toBeGreaterThan(3);
    expect(hit[3]! * 100).toBeLessThan(7);
  });

  it('★ 同一档位里一件藏品不能出现在两个组（否则概率会重复算）', () => {
    for (const tier of TIERS) {
      const seen = new Set<string>();
      for (const group of MONSTER_DROP_TABLE[tier].groups) {
        for (const id of group.items) {
          expect(seen.has(id), `${tier} 里 ${ITEM_DEFS[id]?.name ?? id} 出现在两个组`).toBe(false);
          seen.add(id);
        }
      }
    }
  });

  it('★ 二版 30 件入表后的真实概率（老件按比例稀释、新件拿基础档）', () => {
    // 小怪 / 普通：血魔的寝床 2% → 1%，其余老件 0.5% → 0.25%，新件各 0.25%
    expect(dropChanceBp('minion', 'itm_blood_bed') / 100).toBeCloseTo(1, 5);
    expect(dropChanceBp('minion', 'itm_flawless_jade') / 100).toBeCloseTo(0.25, 5);
    expect(dropChanceBp('minion', 'itm_pebble_altar') / 100).toBeCloseTo(0.25, 5);
    expect(dropChanceBp('normal', 'itm_blood_bed') / 100).toBeCloseTo(1, 5);
    // 精英：4% → 2%，新件 0.5%
    expect(dropChanceBp('elite', 'itm_blood_bed') / 100).toBeCloseTo(2, 5);
    expect(dropChanceBp('elite', 'itm_pebble_altar') / 100).toBeCloseTo(0.5, 5);
    // 小领袖：12% → 6%，新件 1.5%
    expect(dropChanceBp('leader', 'itm_blood_bed') / 100).toBeCloseTo(6, 5);
    expect(dropChanceBp('leader', 'itm_pebble_altar') / 100).toBeCloseTo(1.5, 5);
    /*
      BOSS 的稀有组表里只写了「以上 55% 掉落其中之一」，没写逐件百分比
      -> **等概率**（以前错用了小领袖那套权重，血魔的寝床会变成 12%）
    */
    const rare = MONSTER_DROP_TABLE.boss.groups.at(-1)!.items.length;
    expect(dropChanceBp('boss', 'itm_blood_bed') / 100).toBeCloseTo(55 / rare, 4);
    expect(dropChanceBp('boss', 'itm_pebble_altar') / 100).toBeCloseTo(55 / rare, 4);
    // "每次击杀"还要乘"没中金币"的那一部分（小怪 ×55%）
    expect(dropChancePerKillBp('minion', 'itm_blood_bed') / 100).toBeCloseTo(0.55, 5);
  });

  it('★ 每件藏品都必须能掉出来（新藏品忘了入表 = 玩家永远拿不到）', () => {
    /*
      ★ 0.1.3 转职藏品的**唯一例外**：16 件转职不进任何掉落组 ——
      它们只能由「变形同构体」产出（用户口径：只靠变形同构体 + 修改器），
      而变形同构体本身**在**掉落表里（C 组），所以整条链路依然可达。
      ★ 豁免名单从 TRAIT_RELICS 现推、不手写 16 个 id ——
      以后往羁绊表里加羁绊、自动多出一件转职时，不会因为忘了改这里而误报。

      ★★ 0.3.2 第二个例外（用户明确要求）：`covenantOnly` 的藏品
      （阿米娅的三张「升变之证」）**不许出现在野怪掉落物里** ——
      它们只能由盟约「不容拒绝」的任务发放。判据同样现推、不手写 id，
      而且**反过来再钉一次**：这些 id 必须真的不在掉落表里
      （只加字段不过滤是没用的，所以这条要双向查）。
    */
    const fromMorphOnly = new Set(TRAIT_RELICS.map((relic) => relic.id));
    const covenantOnly = new Set(
      Object.values(ITEM_DEFS)
        .filter((item) => item.covenantOnly === true)
        .map((item) => item.id),
    );
    expect(covenantOnly.size, '★ 0.3.2：盟约专属藏品应当是三张升变之证').toBe(3);

    const reachable = new Set<string>();
    for (const tier of TIERS) {
      for (const group of MONSTER_DROP_TABLE[tier].groups) {
        for (const id of group.items) reachable.add(id);
      }
    }
    for (const id of covenantOnly) {
      expect(reachable.has(id), `${ITEM_DEFS[id]!.name} 漏进掉落表了（用户要求：不许掉）`).toBe(false);
    }
    const missing = Object.keys(ITEM_DEFS).filter(
      (id) => !reachable.has(id) && !fromMorphOnly.has(id) && !covenantOnly.has(id),
    );
    expect(
      missing.map((id) => `${ITEM_DEFS[id]!.name}(${id})`),
      '这些藏品不在任何掉落组里',
    ).toEqual([]);
  });
});

// ============================================================
// ★ 从战斗日志里数击杀
// ============================================================

function place(team: 0 | 1, defId: string, col: number, row: number): UnitPlacement {
  return { defId, star: 1, cell: { col, row } };
}

/** 打一场假战斗，跑到结束（对手只有一只源石虫，几秒就死） */
function battleLog(units0: UnitPlacement[], units1: UnitPlacement[], seed = 3) {
  const state = createBattle(UNIT_DEFS, [
    { team: 0, units: units0 },
    { team: 1, units: units1 },
  ], seed);
  for (let i = 0; i < 1200 && !state.over; i++) step(state, UNIT_DEFS);
  return state.log;
}

describe('★ killedDefIds：被打倒的野怪（掉落按它逐只掷）', () => {
  it('打死的那一队逐个报出来（活的、没死的都不算）', () => {
    const log = battleLog([place(0, 'mn_skzdd', 4, 4)], [place(1, 'mn_slime', 5, 4)]);
    const kills = killedDefIds(log, 1);
    expect(kills.map((kill) => kill.defId)).toEqual(['mn_slime']);
    expect(kills[0]!.tick).toBeGreaterThan(0);
    // 反过来数"打死我方"的那一边：博卓活到了最后，一只都不该算
    expect(killedDefIds(log, 0)).toEqual([]);
  });

  it('★ 召唤物不算击杀（否则奎隆就成了刷装备机器）', () => {
    /* 奎隆每 15 秒召唤两只“盛怒”（精英档），这里把时间放长到召唤两轮以上 */
    const log = battleLog([place(0, 'mn_skzdd', 0, 0)], [place(1, 'mn_skzjkl', 5, 4)], 5);
    const spawnedLater = log.some((e) => e.type === 'spawn' && e.team === 1 && e.t > 0);
    expect(spawnedLater, '这一场该出现过召唤（不然这条测试没意义）').toBe(true);
    for (const kill of killedDefIds(log, 1)) {
      expect(kill.defId, '只该算开战时就在场上的那批').not.toBe('mn_spklr');
    }
  });

  it('复活过的单位只算一次（按 unitId 去重）', () => {
    const log = battleLog([place(0, 'mn_skzdd', 4, 4)], [place(1, 'mn_reid', 5, 4)], 11);
    const kills = killedDefIds(log, 1);
    expect(kills.filter((kill) => kill.defId === 'mn_reid').length).toBeLessThanOrEqual(1);
  });
});
