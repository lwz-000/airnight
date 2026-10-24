/**
 * 数据表检查工具（棋子 + 藏品）
 *
 * 用法：
 *   node scripts/pnpm.mjs check
 *
 * 【什么时候用？】
 * 你改完 packages/shared/src/unit-data.ts（加角色、调数值、改技能）
 * 或 item-data.ts（加藏品、调藏品数值）之后，跑一下这个命令。它会：
 *   1. 列出所有棋子、费用分布、标签使用情况
 *   2. 用「强度分」横向比较，指出明显超模或偏废的棋子
 *   3. 检查藏品表（字段混用、未知羁绊、未知机制、写了不生效的开局效果…）
 *   4. 把数据错误翻译成人话告诉你哪里错了、为什么错、怎么改
 *
 * 检查分两级：
 *   错误(errors)   —— 必须修，否则游戏会出问题（`verify` 会失败拦住你）
 *   提醒(warnings) —— 建议看看，但可以是有意为之（只提示，不拦）
 */
import {
  ITEM_DEFS,
  UNIT_DEFS,
  renderItemValidationReport,
  renderValidationReport,
  validateItemTable,
  validateUnitTable,
} from '../packages/shared/src/index.js';

const unitReport = validateUnitTable(UNIT_DEFS);
console.log(renderValidationReport(unitReport, 'packages/shared/src/unit-data.ts'));

const itemReport = validateItemTable(ITEM_DEFS);
console.log(renderItemValidationReport(itemReport, 'packages/shared/src/item-data.ts'));

// 用退出码告诉调用方（比如 `verify` 脚本或 CI）有没有硬错误
process.exit(unitReport.errors.length > 0 || itemReport.errors.length > 0 ? 1 : 0);
