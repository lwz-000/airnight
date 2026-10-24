# AIRNIGHT 失序协议

一个自走棋游戏。**3D 场景 + 2D 角色与 UI，支持 2–8 人好友联机。**

> ### ⚠️ 非官方同人作品
>
> 本作与上海鹰角网络（Hypergryph）、悠星（Yostar）**无任何关联**，未获授权或认可。
> **非盈利，仅限学习与个人非商业使用** —— 不得出售、付费分发、收费开服、植入广告或接受打赏。
>
> 《明日方舟》相关的全部名称、角色、美术、音乐、文本与游戏数据，版权归原权利人所有，
> **不在本项目的 MIT 许可证范围内，也没有提交到这个仓库**。
> 权利人若认为内容不妥，提交 Issue 即删。
>
> 完整条款见 **[NOTICE.md](NOTICE.md)** ｜ 代码许可见 **[LICENSE](LICENSE)**

> 这份 README 写给「不是程序员」的人看。技术细节都在代码注释里，每个关键决策都写了「为什么」。

---

## 一分钟跑起来

> ⚠️ **不要直接敲 `pnpm install`**。你系统的 PowerShell 禁止运行脚本（执行策略限制），会报「无法加载文件 pnpm.ps1」。
> 所有命令都用 `node scripts/...` 的形式，它绕过了这个限制。

> ⚠️ **依赖布局必须是「扁平」模式**（`pnpm-workspace.yaml` 里的 `nodeLinker: hoisted`，已配好，别删）。
> pnpm 默认的隔离布局要在 `.pnpm/` 里给每个包建一批软链接，**本机上这一步会静默失败**：
> 目录建出来了、链接没建，而 pnpm 还认为装好了不再重试 ——
> 结果 `tsx` / `vite` / `vitest` 全部 `MODULE_NOT_FOUND`，`启动游戏.cmd` 也会挂。
> 注意这个键要写在 `pnpm-workspace.yaml` 里，pnpm 10+ 会忽略 `.npmrc` 里的同名键。

```bash
# 1) 装依赖（只做一次）
node scripts/pnpm.mjs install

# 2) 抓素材（只做一次）—— 见下方「素材不在仓库里」
node node_modules/tsx/dist/cli.mjs scripts/fetch-chibi.ts
node node_modules/tsx/dist/cli.mjs scripts/fetch-portraits.ts

# 3) 启动游戏客户端，然后在浏览器打开 http://localhost:5173
node scripts/pnpm.mjs web

# 4) 另开一个终端，启动联机服务器
node scripts/pnpm.mjs server
```

### 素材不在仓库里

**这个仓库只包含代码和脚本。** 干员小人、立绘、头像、藏品图标、地图背景和官方 OST
都没有提交——它们的版权不属于本项目，见 [NOTICE.md](NOTICE.md)。

第一次运行前，在本机把它们抓下来：

```bash
T="node node_modules/tsx/dist/cli.mjs"

$T scripts/fetch-chibi.ts          # 干员 Q 版序列帧（必需）
$T scripts/fetch-portraits.ts      # 半身像 + 头像（必需）
$T scripts/fetch-map-assets.ts     # 地图背景与地砖（必需）
$T scripts/fetch-item-icons.ts     # 藏品图标
$T scripts/fetch-token-art.ts      # 召唤物立绘
node scripts/import-music.mjs      # 官方 OST（可选，没有也能玩）
```

**不抓也能启动**：素材缺失时游戏会逐级降级——

```
小人序列帧 → 半身像 → 头像 → 程序化占位图
```

功能完全正常，只是棋盘上的角色变成占位卡。所以想先看看代码跑起来是什么样，可以直接跳到第 3 步。

**核心操作**：左边选棋子 → 点场上的格子放下（只能放左半边）→ 回车开战。
右键撤回棋子，空格暂停战斗，界面右上角能开关相机环绕。

### 和朋友联机（已可用）

1. 先启动服务器：`node scripts/pnpm.mjs server`
2. 所有人打开 `http://<你的局域网IP>:5173`（不要用 `localhost`，那样连的是朋友自己那台电脑）
3. 一个人点「建房间」，把 6 位房间码念给其他人；其他人填码点「加入」
4. 除房主外的人点「准备好了」→ 房主点「开始游戏」
5. 每回合 30 秒布阵，放好棋子点「提交阵容」；全员提交会立刻开打

> 想在自己电脑上试：开两个浏览器标签页就行（两个标签页会被当成两个玩家）。

---

## 改完代码要验证

```bash
node scripts/verify.mjs
```

这个脚本会依次做三件事，任何一步失败都会明确告诉你哪里错了：

1. **类型检查** —— 找出「代码写错了」这类问题
2. **全部测试** —— 确认「同一颗种子必然打出同一场战斗」没被破坏
3. **战斗演示** —— 打印一场完整战报 + 30 场连打统计

> **为什么每次都要跑？**
> 因为你改数值表时很容易不小心引入「确定性 bug」（比如误用了 `Math.random()`、
> 或者依赖了对象属性的顺序）。这类 bug **不会报错**，但会让联机对战不同步，
> 而且极难排查。这个脚本就是专门防它的。

---

## 目录结构

```
AIRNIGHT/
├─ packages/shared/      确定性战斗内核 + 棋子数据表（前后端共用同一份代码）
│   ├─ src/unit-data.ts      ← 你的「策划表格」，加角色主要改这里
│   ├─ src/rules.ts          ← 战斗主循环
│   ├─ src/constants.ts      ← 所有数值常量（帧率、棋盘大小、各类公式系数）
│   └─ test/                 ← 19 个测试：证明同种子必得同结果
├─ packages/server/      联机房间服务（6 位房间码，2–8 人）
├─ packages/sim-cli/     终端战斗调试台
├─ apps/web/             游戏客户端（Three.js 3D 场景 + 原生 DOM 的 2D UI）
│   └─ src/
│       ├─ three/board.ts      3D 棋盘、相机、鼠标拾取
│       ├─ three/replay.ts     战斗播放器（把事件流变成动画）
│       ├─ three/sprite-graphics.ts  用代码画出棋子卡片（含血条）
│       ├─ game/state.ts       布阵规则（纯逻辑，可测试）
│       └─ main.ts             主编排：把上面全部接起来
├─ scripts/              一键验证、pnpm 包装器、平衡诊断
└─ docs/                 设计资料收集表 + 进度说明
```

---

## 常用命令

| 做什么 | 命令 |
|---|---|
| 装依赖 | `node scripts/pnpm.mjs install` |
| 跑游戏客户端 | `node scripts/pnpm.mjs web` |
| 跑联机服务器 | `node scripts/pnpm.mjs server` |
| 一键验证（4 步） | `node scripts/verify.mjs` |
| **检查棋子数据表** | `node scripts/pnpm.mjs check` |
| **联机全流程实测** | `node scripts/pnpm.mjs smoke` |
| 看一场战斗战报 | `node scripts/pnpm.mjs sim -- --seed 123 --stats --board` |
| 连打 200 场统计胜率 | `node scripts/pnpm.mjs sim -- --best-of 200 --quiet` |
| 平衡性诊断（对抗矩阵） | `node scripts/pnpm.mjs balance` |
| 打包出可发布的文件 | `node scripts/pnpm.mjs build` |

**`check` 是什么？** 改完棋子数据表之后跑它。它会把数据问题翻译成人话：
哪个棋子、哪个字段、为什么错、怎么改。分「必须修」和「建议看看」两级。

**`smoke` 是什么？** 它会真的起一个服务器、真的开两个 WebSocket 连接，
完整跑一遍「建房 → 加入 → 准备 → 开局 → 提交阵容 → 收到种子 → 两边各自重放 → 比对校验和」，
并把每一步打印出来。想确认联机没问题的时候跑它。

---

## 三个最关键的设计决策

### 1. 战斗是「离线推演」，不是实时对抗

玩家在准备阶段做的事只是**配置输入**（买谁、放哪）。然后：

```
simulate(阵容A, 阵容B, 种子) → 一串带时间戳的事件
```

这串事件就是完整答案。所以「播动画」「录像回放」「快进」「拖进度条」
全是同一件事 —— 把事件按时序演出来。**不需要为它们各写一套逻辑。**

### 2. 数值必须全是整数

血量 550.5 存成 `550500`（千分之一为单位），百分比 25% 存成 `2500`（万分之一）。

**为什么？** 因为小数在不同 CPU 上的最后几位可能不一样。一次看不出来，
但一场战斗要算上千次，误差会累积成「我这边赢了、朋友那边输了」——
这是最难查的一类 bug。所以内核里所有除法都用 `Math.floor` 向下取整。

### 3. 联机只传一个种子

```
服务器  simulate(阵容A, 阵容B, 种子) → 胜者 + 校验和
   ↓ 广播这几百字节：{ 种子, 阵容A, 阵容B, 期望校验和 }
客户端  simulate(阵容A, 阵容B, 种子) → 重放出一模一样的战斗，播动画
   ↓ 比对校验和，不一致就上报
```

**战斗期间零实时同步压力**，不需要 rollback netcode。
一台最便宜的服务器就能带 8 人房。

---

## 想加角色？改数据表就够了

> 📖 **详细的逐步指南在 `docs/怎么加角色.md`** —— 那份文档是专门写给不懂编程的人看的，
> 包含每个字段的含义、参考数值、常见错误对照表。这里只放最关键的摘要。

打开 `packages/shared/src/unit-data.ts`，找个定位最像的棋子抄一份改数值即可。
**90% 的情况不需要写代码。**

**改完一定跑这个**（它会把数据错误翻译成人话告诉你）：

```bash
node scripts/pnpm.mjs check
```

已经支持的技能机制：

| 机制 | 写法 |
|---|---|
| 单体伤害 | `{ kind: 'damage', target: 'currentTarget', fallback: 'nearestEnemy', power: 2200, damageType: 'physical' }` |
| 范围伤害 | `target: 'enemiesInRadius3'` |
| 全体伤害 | `target: 'allEnemies'` |
| 治疗 | `{ kind: 'heal', target: 'lowestHpAlly', power: 1800 }` |
| 护盾 | `{ kind: 'shield', target: 'self', power: 150, durationTicks: ms(4) }` |
| 眩晕 | `{ kind: 'stun', target: 'nearestEnemy', durationTicks: ms(2) }` |
| 攻速增益 | `{ kind: 'buffAttackSpeed', target: 'allAllies', bonusBp: 2000, durationTicks: ms(5) }` |
| 攻击力增益 | `{ kind: 'buffAttackDamage', target: 'self', bonusBp: 4000, durationTicks: ms(6) }` |

**`fallback` 是什么？** 首选目标死了就改打别人，避免「技能空放」这种糟糕手感。

**改数据最常见的坑**：种族/职业标签打错字（比如 `knigt`）**不会报运行时错误**，
只会让那个棋子永远不参与羁绊 —— 这种 bug 极难发现。所以校验器专门拦这一类，
还会猜你本来想写什么。

**如果你的技能不属于上面任何一类**（召唤、位移、击退、变身、标记、分摊伤害……），
那需要给内核加新机制 —— 早点说，我好规划。

---

## 还没做的部分

| 模块 | 状态 |
|---|---|
| 确定性战斗内核 | ✅ 19 个测试 |
| 联机房间服务（6 位房间码，2–8 人） | ✅ 14 个端到端测试 |
| 3D 棋盘 + 2D 角色/UI | ✅ 23 个测试 |
| 客户端接入联机（大厅、房间码、等待房间、视角翻转） | ✅ 已打通 |
| **棋子数据表校验器 + 加角色指南** | ✅ 25 个测试，能拦住打错字这类静默 bug |
| 羁绊系统 | ⬜ **需要你的设计资料** |
| 商店抽卡 / 经济 / 升级 | ⬜ **需要你的设计资料** |
| 装备系统 | ⬜ **需要你的设计资料** |
| 服务端权威校验阵容/经济（现在阵容校验在服务端，经济还在客户端） | ⬜ 等经济规则定下来一起做 |
| 音效 / 技能特效 / 飘字 / 攻击动作 | ⬜ |
| 真美术素材（现在是代码画的占位图） | ⬜ 换图只改一个文件 |
| 断线重连恢复座位 | ⬜ 协议留了口子，未实现 |
| 账号 / 天梯 / 匹配 | ⬜ 上线阶段再做 |

**下一步最需要的东西**：填 `docs/设计资料收集表.md`。
不用等全想完 —— 先给 3～6 个角色 + 2～3 个羁绊，我就把整条链路打通给你看。

> 在你整理设计资料的同时，**加角色的工具链已经就绪了**：
> 你可以自己先照着 `docs/怎么加角色.md` 往表里加几个角色试试，
> 跑 `node scripts/pnpm.mjs check` 会立刻告诉你有没有写错。
