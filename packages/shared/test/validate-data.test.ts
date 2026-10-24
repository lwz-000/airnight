/**
 * 数据校验器的测试。
 *
 * 【测试思路：故意改坏一个字段，看校验器能不能抓到】
 * 校验器本身是个「安全网」，如果它自己漏报，那比没有更糟 ——
 * 你会以为数据没问题。
 * 所以这里对每一类可能的错误都单独造一个「坏数据」，断言它必须被抓到，
 * 并且错误信息要指向正确的字段（否则你会去改错地方）。
 *
 * 【为什么不写死干员名字？】
 * 因为干员名单会换（占位 50 个 -> 你的正式设计）。
 * 写死 'knight' 这种名字，一换名单测试全崩。
 * 所以这里统一用「按费用取第一个干员」的方式拿测试样本。
 */
import { describe, expect, it } from 'vitest';
import {
  RARITY_STYLES,
  TRAIT_DEFS,
  UNIT_DEFS,
  estimatePower,
  playableDefs,
  rarityOf,
  rarityOfCost,
  renderValidationReport,
  validateUnitTable,
} from '../src/index.js';
import type { UnitDef, UnitDefTable } from '../src/types.js';

/** 复制一份棋子表，方便安全地改坏它 */
function cloneTable(): UnitDefTable {
  return JSON.parse(JSON.stringify(UNIT_DEFS)) as UnitDefTable;
}

/** 从表里取一个棋子并断言它存在 */
function get(table: UnitDefTable, id: string): UnitDef {
  const def = table[id];
  if (!def) throw new Error(`测试数据里没有 ${id}`);
  return def;
}

/** 取一个「指定费用」的干员 id，用来做测试样本（不依赖具体名字） */
function sampleId(cost = 1): string {
  const found = playableDefs()
    .filter((def) => def.cost === cost)
    .map((def) => def.id)
    .sort()[0];
  if (!found) throw new Error(`干员表里没有 ${cost} 费的干员`);
  return found;
}

/** 取两个不同的干员 id */
function twoIds(): [string, string] {
  const ids = playableDefs()
    .map((def) => def.id)
    .sort();
  if (ids.length < 2) throw new Error('干员表里至少要有 2 个干员');
  return [ids[0]!, ids[1]!];
}

describe('数据校验器：真实数据表应当通过硬检查', () => {
  it('当前的 unit-data.ts 没有任何「必须修」的错误', () => {
    const report = validateUnitTable(UNIT_DEFS);
    if (report.errors.length > 0) {
      // 失败时把完整报告打出来，这样一眼能看到是哪条
      console.error(renderValidationReport(report));
    }
    expect(report.errors).toEqual([]);
  });

  it('统计信息完整：棋子数和强度分对得上', () => {
    const report = validateUnitTable(UNIT_DEFS);
    /*
      注意：统计里**不含召唤物**（迷迭香的柱子、维娜的金狮子、望的棋子）。
      因为它们不进商店也不算"能买的棋子"，算进费用分布会让人以为 1 费有 18 个。
      所以这里的对照组也要把 summonOnly / monsterOnly 的排掉。
    */
    // 0.0.3：野怪（monsterOnly）也不算可购买的棋子，和召唤物一起排除
    const playable = playableDefs();
    expect(report.unitCount).toBe(Object.keys(UNIT_DEFS).length);
    expect(report.stats.power).toHaveLength(playable.length);
    const total = report.stats.byCost.reduce((sum, item) => sum + item.count, 0);
    expect(total).toBe(playable.length);
  });

  it('每个费用档位都有干员（商店抽卡才不会空）', () => {
    const report = validateUnitTable(UNIT_DEFS);
    const costs = report.stats.byCost.map((item) => item.cost);
    for (const cost of [1, 2, 3, 4, 5]) {
      expect(costs, `没有 ${cost} 费的干员，商店抽到这一档时会出问题`).toContain(cost);
    }
  });
});

describe('数据校验器：能抓到打错标签（这类错误静默失效，最难发现）', () => {
  it('抓到不存在的标签，并给出拼写建议', () => {
    const table = cloneTable();
    const id = sampleId(1);
    // 把某个真实标签的后两个字母改掉，模拟手滑打错
    const def = get(table, id);
    const original = def.traits[1] ?? def.traits[0]!;
    def.traits = [def.traits[0]!, `${original.slice(0, 2)}zz`];

    const report = validateUnitTable(table);
    const issue = report.errors.find((item) => item.code === 'UNKNOWN_TRAIT_KIND');
    expect(issue).toBeDefined();
    expect(issue!.unitId).toBe(id);
    expect(issue!.field).toBe('traits');
  });

  it('抓到完全没填标签', () => {
    const table = cloneTable();
    get(table, sampleId(1)).traits = [];
    const report = validateUnitTable(table);
    expect(report.errors.some((item) => item.code === 'EMPTY_TRAITS')).toBe(true);
  });

  it('标签太多时给出提醒（但不阻止）', () => {
    const table = cloneTable();
    const id = sampleId(1);
    // 5 个标签：多到会让羁绊太容易凑齐
    get(table, id).traits = ['rhodes', 'yan', 'caster', 'swordsman', 'support'];
    const report = validateUnitTable(table);

    // 【为什么必须断言 unitId？】
    // 因为这条检查是"遍历全表"的，只看"有没有这条提醒"的话，
    // 别的棋子触发也能让测试通过 —— 测试就变成了假的。
    // （之前真实名单里有阿米娅这种多标签棋子，就正好把这条测试"蒙"过去了。）
    const issue = report.warnings.find((item) => item.code === 'TOO_MANY_TRAITS');
    expect(issue).toBeDefined();
    expect(issue!.unitId).toBe(id);
    expect(report.errors.some((item) => item.code === 'TOO_MANY_TRAITS')).toBe(false);
  });

  it('正常的多标签棋子（3~4 个标签）不报警 —— 避免"狼来了"', () => {
    const table = cloneTable();
    const id = sampleId(1);
    // 真实名单里阿米娅就是这样：1 个出身 + 3 个定位，是设计意图
    get(table, id).traits = ['rhodes', 'leader', 'arts', 'support'];
    const report = validateUnitTable(table);
    expect(report.warnings.some((item) => item.code === 'TOO_MANY_TRAITS' && item.unitId === id)).toBe(
      false,
    );
  });
});

describe('数据校验器：能抓到 id 类冲突', () => {
  it('抓到两个棋子用了同一个技能 id', () => {
    const table = cloneTable();
    const [a, b] = twoIds();
    get(table, a).skill.id = 'same_skill';
    get(table, b).skill.id = 'same_skill';

    const report = validateUnitTable(table);
    const issue = report.errors.find((item) => item.code === 'DUPLICATE_SKILL_ID');
    expect(issue).toBeDefined();
    expect(issue!.message).toContain(a);
    expect(issue!.message).toContain(b);
  });

  it('抓到表的 key 和棋子自己的 id 不一致', () => {
    const table = cloneTable();
    const id = sampleId(1);
    get(table, id).id = `${id}_typo`;
    const report = validateUnitTable(table);
    const issue = report.errors.find((item) => item.code === 'DUPLICATE_DEF_ID');
    expect(issue).toBeDefined();
    expect(issue!.message).toContain(id);
  });
});

describe('数据校验器：能抓到数值抄错', () => {
  it('抓到血量为 0 或负数', () => {
    const table = cloneTable();
    const id = sampleId(1);
    get(table, id).base.hp = 0;
    const report = validateUnitTable(table);
    expect(report.errors.some((item) => item.unitId === id && item.field === 'base.hp')).toBe(true);
  });

  it('抓到射程为 0（永远打不到人）', () => {
    const table = cloneTable();
    get(table, sampleId(1)).base.range = 0;
    const report = validateUnitTable(table);
    expect(report.errors.some((item) => item.field === 'base.range')).toBe(true);
  });

  it('抓到升星倍率小于等于 1000（升星没收益）', () => {
    const table = cloneTable();
    get(table, sampleId(1)).starHpBp = 1000;
    const report = validateUnitTable(table);
    const issue = report.errors.find((item) => item.field === 'starHpBp');
    expect(issue).toBeDefined();
    expect(issue!.message).toContain('1000');
  });

  it('抓到技能倍率为 0', () => {
    const table = cloneTable();
    /*
      注意：不能写死"第 1 个棋子的第 1 个效果"。
      技能数据里很多效果是 buff / summon / trap，它们根本没有 power 字段 ——
      写死的话 `'power' in skill` 会是 false，测试**静默**通过（什么都没改），
      看起来是绿的其实什么都没验证。所以要先找一个真的带 power 的效果。
    */
    const withPower = Object.values(table).find((def) =>
      def.skill.effects.some((effect) => 'power' in effect),
    );
    expect(withPower, '表里应该至少有一个带 power 的技能效果').toBeDefined();
    const effect = withPower!.skill.effects.find((item) => 'power' in item)! as { power: unknown };
    effect.power = 0;
    const report = validateUnitTable(table);
    expect(report.errors.some((item) => item.code === 'SUSPICIOUS_ZERO')).toBe(true);
  });

  it('抓到非法伤害类型', () => {
    const table = cloneTable();
    // 找一个带伤害效果的干员
    const withDamage = Object.values(table).find((def) =>
      def.skill.effects.some((effect) => effect.kind === 'damage'),
    );
    expect(withDamage).toBeDefined();
    const damage = withDamage!.skill.effects.find((effect) => effect.kind === 'damage')!;
    (damage as { damageType: string }).damageType = 'fire';

    const report = validateUnitTable(table);
    const issue = report.errors.find((item) => item.code === 'BAD_DAMAGE_TYPE');
    expect(issue).toBeDefined();
    expect(issue!.message).toContain('physical');
  });

  it('抓到血量多写一位数这种量级错误', () => {
    const table = cloneTable();
    get(table, sampleId(1)).base.hp = 55000;
    const report = validateUnitTable(table);
    expect(report.warnings.some((item) => item.code === 'POWER_OUTLIER')).toBe(true);
  });

  it('抓到法力回复过快（技能几乎无冷却）', () => {
    const table = cloneTable();
    get(table, sampleId(1)).base.manaPerAttack = 600;
    const report = validateUnitTable(table);
    expect(report.warnings.some((item) => item.field === 'base.manaPerAttack')).toBe(true);
  });
});

describe('数据校验器：能抓到技能配置问题', () => {
  it('抓到技能没有任何效果', () => {
    const table = cloneTable();
    const skill = get(table, sampleId(1)).skill;
    /*
      ★ 0.2：光把 `effects` 清空已经不够了 —— 空爆改版后把"溅射"放进了 `passive`，
      而被动**本身就是一种效果**（校验器不该报错）。
      要构造"真的什么都没有"，`effects` / `passive` / `battleStart` 三块都得清。
    */
    skill.effects = [];
    skill.passive = undefined;
    skill.battleStart = undefined;
    const report = validateUnitTable(table);
    expect(report.errors.some((item) => item.code === 'NO_ANY_EFFECT')).toBe(true);
  });

  it('提醒「打当前目标但没写兜底」', () => {
    const table = cloneTable();
    const id = sampleId(1);
    get(table, id).skill.effects = [
      { kind: 'damage', target: 'currentTarget', power: 2200, damageType: 'physical' },
    ];
    const report = validateUnitTable(table);
    const issue = report.warnings.find((item) => item.code === 'TARGET_RULE_WITHOUT_FALLBACK');
    expect(issue).toBeDefined();
    expect(issue!.message).toContain('nearestEnemy');
  });

  it('技能 id 没有棋子前缀时给提醒（方便看日志）', () => {
    const table = cloneTable();
    get(table, sampleId(1)).skill.id = 'something_else';
    const report = validateUnitTable(table);
    expect(report.warnings.some((item) => item.code === 'SKILL_ID_NOT_PREFIXED')).toBe(true);
  });
});

describe('数据校验器：同费用离群检测', () => {
  it('抓到同费用里明显超模的棋子', () => {
    const table = cloneTable();
    // 补两个陪衬，让这个费用档有 4 个棋子（样本量 ≥ 3 才会做离群判断）
    const [a, b] = twoIds();
    const base = get(table, a);
    table['filler_a'] = { ...JSON.parse(JSON.stringify(base)), id: 'filler_a', name: '陪衬甲', cost: 1 };
    table['filler_b'] = { ...JSON.parse(JSON.stringify(base)), id: 'filler_b', name: '陪衬乙', cost: 1 };

    // 造一个「1 费却像 5 费」的东西
    const victim = get(table, sampleId(1));
    victim.base = {
      ...victim.base,
      hp: 6000,
      attackDamage: 900,
      attackSpeed: 3500,
      armor: 120,
    };

    const report = validateUnitTable(table);
    const issue = report.warnings.find((item) => item.code === 'POWER_OUTLIER' && item.unitId === victim.id);
    expect(issue).toBeDefined();
    expect(issue!.message).toContain('中位数');
    void b;
  });

  it('同费用只有 1～2 个棋子时不做离群判断，改由绝对量级上限兜底', () => {
    const table = cloneTable();
    const id = sampleId(1);
    get(table, id).base.hp = 55000; // 明显多按了一个 0

    const report = validateUnitTable(table);
    const issue = report.warnings.find((item) => item.code === 'POWER_OUTLIER' && item.unitId === id);
    expect(issue).toBeDefined();
    expect(issue!.message).toContain('量级');
    expect(issue!.message).not.toContain('中位数');
  });

  it('抓到同费用里明显偏废的棋子', () => {
    const table = cloneTable();
    const [a] = twoIds();
    const sample = JSON.parse(JSON.stringify(get(table, a)));
    table['filler_c'] = { ...sample, id: 'filler_c', name: '陪衬丙', cost: 4 };
    table['filler_d'] = { ...sample, id: 'filler_d', name: '陪衬丁', cost: 4 };

    // 把一个 4 费干员削成废物
    const costs = Object.values(table).filter((def) => def.cost === 4);
    expect(costs.length).toBeGreaterThan(0);
    const victim = costs.sort((x, y) => x.id.localeCompare(y.id))[0]!;
    victim.base.hp = 100;
    victim.base.attackDamage = 5;
    victim.skill.effects = [];

    const report = validateUnitTable(table);
    const issue = report.warnings.find((item) => item.code === 'POWER_OUTLIER' && item.unitId === victim.id);
    expect(issue).toBeDefined();
  });
});

describe('强度分（estimatePower）本身要讲道理', () => {
  /*
    评估对象是「能被买到的棋子」。
    召唤物（柱子血量 300、陷阱血量 1、且攻击力为 0）是故意不按干员标准来的，
    把它们算进来会立刻把"最弱"拉到 0 分，这组测试就恒等于废话了。
  */
  // 0.0.3：野怪也要排掉（它们的护甲/血量按级别模板给，量级和干员不可比）
  // ★ 彩蛋棋子（维维美·绝对主角）同样排掉 —— 它 20 费、生命 12000，
  //   是"抽到就是赚到"的特殊存在，本来就不该符合常规的强度平衡约定。
  const playable = playableDefs().filter((def) => def.noStar !== true);

  it('坦克的生存分应该和输出在同一量级（不会差一个数量级）', () => {
    const powers = playable.map((def) => estimatePower(def));
    const max = Math.max(...powers);
    const min = Math.min(...powers);
    // 同一张表里，最强和最弱不应该差 20 倍以上（那说明公式有量纲错误）
    expect(max / min).toBeLessThan(20);
  });

  it('强度分整体随费用上升（高费应该更强）', () => {
    const powers = playable.map((def) => ({ cost: def.cost, power: estimatePower(def) }));
    const lowCost = powers.filter((item) => item.cost <= 2);
    const highCost = powers.filter((item) => item.cost >= 4);
    const avg = (list: typeof powers): number =>
      list.reduce((sum, item) => sum + item.power, 0) / Math.max(1, list.length);
    expect(avg(highCost)).toBeGreaterThan(avg(lowCost));
  });

  it('分数永远是正整数，不会出现 NaN 或小数', () => {
    for (const def of playable) {
      const power = estimatePower(def);
      expect(Number.isInteger(power), `${def.name} 的强度分不是整数：${power}`).toBe(true);
      expect(power, `${def.name} 的强度分是 ${power}`).toBeGreaterThan(0);
    }
  });
});

describe('稀有度配色', () => {
  it('费用 1~5 分别对应白绿蓝紫金', () => {
    // 这五个颜色是自走棋的通用约定，玩家一眼就能从边框判断棋子值几费。
    // 如果哪天有人改错了顺序，这条测试会立刻发现。
    const expected = ['#d8dde8', '#4ad06a', '#3d9bff', '#a866ff', '#ffc23d'];
    for (let cost = 1; cost <= 5; cost++) {
      expect(rarityOfCost(cost).base, `${cost} 费的颜色不对`).toBe(expected[cost - 1]);
    }
  });

  it('档位名依次是 普通/精良/稀有/史诗/传说', () => {
    expect(rarityOfCost(1).label).toBe('普通');
    expect(rarityOfCost(2).label).toBe('精良');
    expect(rarityOfCost(3).label).toBe('稀有');
    expect(rarityOfCost(4).label).toBe('史诗');
    expect(rarityOfCost(5).label).toBe('传说');
  });

  it('每档都有 base / glow / wash 三个颜色，且 glow 比 base 亮', () => {
    for (const style of RARITY_STYLES) {
      expect(style.base).toMatch(/^#[0-9a-f]{6}$/i);
      expect(style.glow).toMatch(/^#[0-9a-f]{6}$/i);
      expect(style.wash).toMatch(/^rgba\(/);

      // 粗略判断「更亮」：把三个通道加起来比大小
      const sum = (hex: string): number => {
        const v = hex.replace('#', '');
        return (
          parseInt(v.slice(0, 2), 16) + parseInt(v.slice(2, 4), 16) + parseInt(v.slice(4, 6), 16)
        );
      };
      expect(sum(style.glow), `${style.label} 的 glow 应该比 base 亮`).toBeGreaterThan(sum(style.base));
    }
  });

  it('费用超出范围时向两端夹取，不会返回 undefined', () => {
    // 以后真出了 6 费棋子，不至于让界面颜色变成空白
    expect(rarityOfCost(0).base).toBe(rarityOfCost(1).base);
    expect(rarityOfCost(-3).base).toBe(rarityOfCost(1).base);
    expect(rarityOfCost(6).base).toBe(rarityOfCost(5).base);
    expect(rarityOfCost(99).base).toBe(rarityOfCost(5).base);
  });

  it('每个干员都能取到稀有度（数据完整性）', () => {
    for (const def of Object.values(UNIT_DEFS)) {
      const style = rarityOf(def);
      expect(style.base).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('报告渲染', () => {
  it('渲染出的报告包含关键信息（棋子数、费用分布、标签、结论）', () => {
    const text = renderValidationReport(validateUnitTable(UNIT_DEFS), '测试数据表');
    expect(text).toContain('测试数据表');
    expect(text).toContain(`共 ${Object.keys(UNIT_DEFS).length} 个棋子`);
    expect(text).toContain('各费用数量');
    expect(text).toContain('标签使用情况');
    expect(text).toContain('强度分');
    expect(text).toContain('结论');
  });

  it('有硬错误时结论明确说要修', () => {
    const table = cloneTable();
    get(table, sampleId(1)).traits = ['not_a_trait'];
    const text = renderValidationReport(validateUnitTable(table));
    expect(text).toContain('必须修');
    expect(text).toContain('❌');
  });
});

describe('羁绊数据一致性', () => {
  /**
   * ★★ 0.2：**暂时**允许"还没有成员"的羁绊（成员后面再加）。
   *
   * 【为什么要有这么一个白名单，而不是干脆不查？】
   * "每个羁绊都得有人带"这条规则本身是对的 —— 没人带的羁绊永远凑不出来，
   * 就是一张死数据。但 MujicaAve 是按用户口径**先写效果、后加人**的批次，
   * 这期间它能被凑出来的唯一途径是「MujicaAve转职」（转职藏品会挂标签，
   * 见 trait-relic.test.ts 里那条断言）。
   *
   * ★ 所以这是一个**待办清单**：加完人之后必须把这里的 id 删掉，
   *   删掉之后如果哪天又有人忘了加成员，这条测试会立刻红。
   */
  /*
    ★ 0.2 已清空：MujicaAve 的五位成员（若叶睦 / 祐天寺若麦 / 三角初华 / 八幡海铃 / 丰川祥子）
    已经录入 ⇒ 这条清单现在是空的。以后谁再加「只有效果、没有成员」的羁绊，就把它放进来。
  */
  const NO_MEMBERS_YET = new Set<string>();

  it('每个羁绊至少有一个干员带这个标签（否则永远凑不出）', () => {
    for (const traitId of Object.keys(TRAIT_DEFS)) {
      if (NO_MEMBERS_YET.has(traitId)) continue;
      const owners = Object.values(UNIT_DEFS).filter((def) => def.traits.includes(traitId));
      expect(owners.length, `羁绊 ${traitId} 没有任何干员带有这个标签`).toBeGreaterThan(0);
    }
  });

  it('每个羁绊的档位人数从小到大排列', () => {
    for (const [traitId, def] of Object.entries(TRAIT_DEFS)) {
      for (let i = 1; i < def.tiers.length; i++) {
        expect(
          def.tiers[i]!.count,
          `羁绊 ${traitId} 的档位人数没有从小到大排列`,
        ).toBeGreaterThan(def.tiers[i - 1]!.count);
      }
    }
  });
});
