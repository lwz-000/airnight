/**
 * @airnight/shared —— 确定性战斗内核 + 游戏数据表
 *
 * 这个包是「一份代码，三处使用」：
 *   1. 服务器   —— 算出权威战斗结果、校验客户端有没有算歪
 *   2. 客户端   —— 用同样的种子跑出同样的战斗，然后播动画
 *   3. 单元测试 —— 验证同种子必得同结果（联机的地基）
 *
 * 严格约束：这个包里禁止出现 Math.random()、Date.now()、performance.now()、
 * 任何浮点小数的数值判定、以及依赖对象 key 顺序的遍历。
 * 违反了就会出现「我这边赢了、朋友那边输了」这种最难查的 bug。
 */

export * from './constants.js';
export * from './rng.js';
export * from './types.js';
export * from './field.js';
export * from './combat-math.js';
export * from './movement.js';
export * from './skills.js';
export * from './mods.js';
export * from './rules.js';
export * from './unit-data.js';
export * from './monster-data.js';
export * from './skill-data.js';
export * from './trait-data.js';
export * from './item-data.js';
export * from './drop-data.js';
export * from './item-effects.js';
// 藏品效果 -> 人话（界面 tooltip 和导出脚本共用，避免两边各写一份而对不上）
export * from './item-text.js';
// ★ 0.1.3：效果"怎么消耗"（按时间 / 按次数 / 整场 / 一次性）—— 唯一实现
export * from './duration.js';
export * from './presets.js';
export * from './battle-log-format.js';
// ★ 0.1.1：战斗统计（伤害/治疗/承伤）搬到共享层 —— 联机结算页要靠服务端累计整局伤害
export * from './battle-stats.js';
// ★ 0.1.1：状态效果注册表（流血/隐匿/无敌/飞行…的统一登记 + "认出身上有哪些效果"）
export * from './status-effects.js';
export * from './protocol.js';
export * from './fever.js';
export * from './fever-drops.js';
export * from './trait-kinds.js';
export * from './rarity.js';
export * from './validate-data.js';
export * from './synergies.js';
export * from './economy.js';
// ★ 0.2 商店回合：出现时机 + 时长（**服务端和客户端共用同一份**，见那个文件的说明）
export * from './shop-round.js';
// ★ 0.3 玩家昵称：清洗 / 2~8 字 / 重名判定（服务端裁决 + 客户端即时提示共用同一份）
export * from './names.js';
// ★ 0.3 房间设置：默认值 = 现在的行为，夹取只此一处（服务端裁决、客户端照着画）
export * from './room-settings.js';
// ★★ 0.3 盟约：数据表 + 折算成羁绊加成/经济（两端共用，见文件头）
export * from './covenant-data.js';
// ★★ 0.3.2 盟约「阿米娅 · 不容拒绝」：三个升变形态（棋子本体）+ 升变链
export * from './ascension.js';
// ★ 0.3.2 阿米娅升变任务（阈值 / 判定 / 进度文案的唯一出处）
export * from './amiya-quest.js';
// ★★ 0.3.3 人机：难度 id / 文案 / 显示名 / "是不是人机"的判据（服务端 + 客户端共用）
export * from './bot.js';
