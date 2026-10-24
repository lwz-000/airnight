/**
 * ============================================================
 *  ★★ 0.3 盟约：数据表 + 折算
 * ============================================================
 *
 * 这一组守三件事：
 *   1. 数据表本身是干净的（id 唯一、有发起干员/名字/说明）；
 *   2. 头像文件真的存在（少一个 = 界面上一片空白，很难在代码里看出来）；
 *   3. `covenantTraitBonuses` / `covenantEconomy` / `covenantRoundGold`
 *      这些折算对得上 —— **服务端和客户端都调这几个函数**，
 *      它们一错就是"联机校验和不一致"或者"单机有、联机没有"。
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  COVENANTS,
  COVENANT_IDS,
  covenantAvatarPath,
  covenantDeathRage,
  covenantDeathShieldRatioBp,
  covenantEconomy,
  covenantInterestCap,
  covenantLevelItem,
  covenantManaGainBp,
  covenantOf,
  covenantRightmostChargeShield,
  covenantRoundGold,
  covenantShopPerks,
  covenantStartHpBonus,
  covenantTraitBonuses,
  covenantWinHeal,
} from '../src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
/** packages/shared/test -> ../../../apps/web/public */
const PUBLIC_DIR = resolve(HERE, '../../../apps/web/public');

describe('★ 0.3 盟约数据表', () => {
  it('id 唯一，且都有发起干员 / 名字 / 一句话 / 详细说明', () => {
    const ids = new Set<string>();
    for (const covenant of COVENANTS) {
      expect(ids.has(covenant.id), `id 重复：${covenant.id}`).toBe(false);
      ids.add(covenant.id);
      expect(covenant.patron.length, `${covenant.id} 没发起干员`).toBeGreaterThan(0);
      expect(covenant.name.length, `${covenant.id} 没名字`).toBeGreaterThan(0);
      expect(covenant.brief.length, `${covenant.id} 没一句话`).toBeGreaterThan(0);
      expect(covenant.detail.length, `${covenant.id} 没详细说明`).toBeGreaterThan(0);
      // id 必须是 `cv_` 开头 —— 服务端只认这个前缀的字段（避免把别的东西塞进来）
      expect(covenant.id.startsWith('cv_'), `id 不是 cv_ 开头：${covenant.id}`).toBe(true);
    }
    expect(COVENANT_IDS.length).toBe(COVENANTS.length);
  });

  it('《盟约效果A》里那 16 个都在（用户给的名单，一个都不能少）', () => {
    expect(COVENANT_IDS).toEqual([
      'cv_warfarin',
      'cv_amiya',
      'cv_golia',
      'cv_zilan',
      'cv_justin',
      'cv_emengarde',
      'cv_laoli',
      'cv_qiliang',
      'cv_peipei',
      'cv_shapeshifter',
      'cv_dadi',
      'cv_sangshen',
      'cv_humus',
      'cv_kathryn',
      'cv_kaltsa',
      'cv_cannot',
    ]);
  });

  it('每个盟约都有一张头像（apps/web/public/assets/covenants/<id>.png）', () => {
    for (const covenant of COVENANTS) {
      const file = resolve(PUBLIC_DIR, `.${covenantAvatarPath(covenant.id)}`);
      expect(existsSync(file), `缺头像：${file}`).toBe(true);
    }
  });

  it('covenantOf：认得出的返回定义，认不出的返回 null，不抛异常', () => {
    expect(covenantOf('cv_golia')?.name).toBe('坚不可摧');
    expect(covenantOf('cv_nope')).toBeNull();
    expect(covenantOf(undefined)).toBeNull();
    expect(covenantOf('')).toBeNull();
  });

  it('★ 没接进内核的盟约必须标 pending（界面上会写「开发中」）', () => {
    for (const covenant of COVENANTS) {
      /*
        ★ 0.3.1：新增的盟约效果种类（manaGainBp / deathShield / deathRage /
        rightmostChargeShield / levelItem / shopPerks）也全是"已经接好的效果" ——
        所以判据直接用 `effects.length > 0`，不用再一个个列 kind
        （列 kind 的写法每加一种效果就要回来改一次，是典型的漏改点）。
      */
      const hasWiredEffect = covenant.effects.length > 0;
      /*
        ★★ 0.3：盟约分成三类，pending 只留给"真的什么都没做"的那些：
          ① 数据表里有效果（开局金币 / 生命 / 利息 / 回合发钱 / 胜利回血 / 全队属性）；
          ② **机制型**：效果不在数据表里，而是写在内核或客户端（见下面那份清单）；
          ③ 剩下的必须标 pending，否则界面上看着正常、选了却什么都不发生。
      */
      /*
        ★ 0.3.2：`cv_amiya` 也归到②「机制型」——
        它的效果不在数据表里：开局送一只 1 星阿米娅 + 升变任务发证，
        都写在 `apps/web/src/game/state.ts`（`applyCovenantOpening` / 升变任务）。
      */
      const MECHANIC_IDS = [
        'cv_zilan',
        'cv_emengarde',
        'cv_qiliang',
        'cv_peipei',
        'cv_shapeshifter',
        'cv_amiya',
      ];
      const hasMechanic = MECHANIC_IDS.includes(covenant.id);
      if (!hasWiredEffect && !hasMechanic) {
        expect(covenant.pending, `${covenant.id} 没接内核也没写机制，却没标 pending`).toBe(true);
      }
    }
  });
});

describe('★ 0.3 盟约 -> 加成折算', () => {
  it('纯经济 / 纯机制盟约**不进战斗**（塞进 traitBonuses 就是校验和多一条）', () => {
    expect(covenantTraitBonuses('cv_golia')).toEqual([]);
    expect(covenantTraitBonuses('cv_laoli')).toEqual([]);
    expect(covenantTraitBonuses(undefined)).toEqual([]);
  });

  it('歌利亚：开局生命 +30', () => {
    expect(covenantStartHpBonus('cv_golia')).toBe(30);
    expect(covenantStartHpBonus('cv_laoli')).toBe(0);
    expect(covenantStartHpBonus(undefined)).toBe(0);
  });

  it('老鲤：利息上限 7、每回合基础收入 -1', () => {
    expect(covenantInterestCap('cv_laoli')).toBe(7);
    expect(covenantInterestCap('cv_golia')).toBeNull();
    expect(covenantEconomy('cv_laoli')).toEqual({ startGold: 0, income: -1 });
  });

  it('小贾斯汀：第 6、13、20 回合各发一次 2~8 金，别的回合不发', () => {
    const paying: number[] = [];
    for (let round = 1; round <= 30; round += 1) {
      const gold = covenantRoundGold('cv_justin', round);
      expect(gold === 0 || (gold >= 2 && gold <= 8), `第 ${round} 回合发了 ${gold} 金`).toBe(true);
      if (gold > 0) paying.push(round);
    }
    expect(paying).toEqual([6, 13, 20, 27]);
  });

  it('★ 小贾斯汀的数额按回合号算 —— 同一个回合号永远得到同一个数（重连不会重领）', () => {
    const first = covenantRoundGold('cv_justin', 6);
    const again = covenantRoundGold('cv_justin', 6);
    expect(again).toBe(first);
    expect(covenantRoundGold(undefined, 6)).toBe(0);
  });

  it('华法琳：每赢 2 场回 3 血，上限 100', () => {
    expect(covenantWinHeal('cv_warfarin')).toEqual({ perWins: 2, heal: 3, cap: 100 });
    expect(covenantWinHeal('cv_golia')).toBeNull();
    expect(covenantWinHeal(undefined)).toBeNull();
  });

  /*
    ★★ 0.3：每个盟约都必须"有实现" —— 要么数据表里有效果，要么是机制型
    （效果写在内核 / 客户端），不能出现"看着正常、选了却什么都不发生"的盟约。
    ★ 0.3.2 起 `cv_amiya` 也归机制型（开局送阿米娅 + 升变任务），所以不再有例外。
  */
  it('★★ 每个盟约都必须"有实现"（有效果 或 在机制清单里）', () => {
    /** 机制型：效果不在数据表里，而是写在内核 / 客户端 */
    const MECHANIC_IDS = [
      'cv_zilan',
      'cv_emengarde',
      'cv_qiliang',
      'cv_peipei',
      'cv_shapeshifter',
      'cv_amiya',
    ];
    for (const covenant of COVENANTS) {
      const implemented = covenant.effects.length > 0 || MECHANIC_IDS.includes(covenant.id);
      expect(implemented, `${covenant.name} 既没有 effects 也不在机制清单里`).toBe(true);
      expect(covenant.pending, `${covenant.name} 已经实现了，不该再标 pending`).toBeFalsy();
    }
  });
});

/*
  ★★ 0.3.1 新增的 6 个盟约：折算函数必须对得上。
  这些函数是**服务端 / 客户端 / 战斗内核共用的唯一实现** ——
  任何一处算错都会表现为"联机校验和不一致"或"选了没效果"。
*/
describe('★ 0.3.1 新盟约 -> 折算', () => {
  it('大帝「加急启动」：技能条获取 +15%（万分比 1500）', () => {
    expect(covenantManaGainBp('cv_dadi')).toBe(1500);
    expect(covenantManaGainBp('cv_golia')).toBe(0);
    expect(covenantManaGainBp(undefined)).toBe(0);
  });

  it('休谟斯「回收利用」：阵亡给全队 20% 最大生命的护盾', () => {
    expect(covenantDeathShieldRatioBp('cv_humus')).toBe(2000);
    expect(covenantDeathShieldRatioBp('cv_dadi')).toBe(0);
  });

  it('卡莱莎「食腐之蝶」：每次阵亡 +15%，封顶 +150%', () => {
    expect(covenantDeathRage('cv_kaltsa')).toEqual({ attackBp: 1500, capBp: 15000 });
    expect(covenantDeathRage('cv_humus')).toBeNull();
  });

  it('桑葚「药枚实验」：每次攻击 20% 概率得 1 层次数护盾', () => {
    expect(covenantRightmostChargeShield('cv_sangshen')).toEqual({ chanceBp: 2000, charges: 1 });
    expect(covenantRightmostChargeShield('cv_kaltsa')).toBeNull();
  });

  it('凯瑟琳「定向投放」：4 级起每级送藏品，普通 70% / 进阶 30%', () => {
    expect(covenantLevelItem('cv_kathryn')).toEqual({ fromLevel: 4, commonBp: 7000, advancedBp: 3000 });
    expect(covenantLevelItem('cv_sangshen')).toBeNull();
  });

  it('坎诺特「特别优惠」：3 次免费刷新、首件藏品 -2 金', () => {
    expect(covenantShopPerks('cv_cannot')).toEqual({ freeRerolls: 3, firstBuyDiscount: 2 });
    expect(covenantShopPerks('cv_kathryn')).toBeNull();
  });

  it('★ 新盟约都不进战斗加成表（否则会多一条校验和）', () => {
    for (const id of ['cv_dadi', 'cv_sangshen', 'cv_humus', 'cv_kathryn', 'cv_kaltsa', 'cv_cannot']) {
      expect(covenantTraitBonuses(id), `${id} 不该有 traitBonuses`).toEqual([]);
    }
  });
});
