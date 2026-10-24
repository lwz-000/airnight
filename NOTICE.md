# 版权与使用声明（NOTICE）

**失序协议 · AIRNIGHT** 是一个**非盈利的《明日方舟》同人自走棋**，与上海鹰角网络科技有限公司（Hypergryph）、悠星（Yostar）及其关联方**没有任何关联**，也未获得其授权或认可。

本文件说明：哪些东西是我们的、哪些不是、用在什么范围、以及权利人提出要求时我们会怎么做。
**它不是法律意见**，只是把姿态写清楚。

---

## 1. 代码许可证：MIT

Copyright (c) 2026 AIRNIGHT contributors

本项目自己编写的源代码与文档文字（`apps/`、`packages/`、`scripts/`、`config/`、`docs/` 等，
但不包括第 2 节列出的内容）以 **MIT 许可证**发布，全文见 [LICENSE](LICENSE)。
你可以在该许可证的条件下使用、修改和再分发这些代码。

例外——这些各自保留原许可证，**完整清单、版本号与许可证全文见
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)**：

- **随发行包分发**的：three.js 0.171.0（MIT）、ws 8.21.3（MIT）、Node.js v22.22.2（MIT）。
- `apps/web/public/fonts/NotoSansSC.woff2` 是 **思源黑体 / Noto Sans SC** 的子集，
  以 **SIL Open Font License 1.1** 发布；版权声明见同目录 `FONT-LICENSE.txt`，
  许可证全文见同目录 `OFL.txt`。
- **只在开发时使用**、不随包分发的：vite、rollup、esbuild、typescript、tsx、vitest、jsdom。
- **PixiJS / pixi-spine 仅在构建期使用**：把官方 Spine 动画预渲染成 PNG 序列帧。
  它们不进仓库（`.chibi-cache/` 已忽略），也不进发行包。

---

## 2. 不属于本项目、不受 MIT 约束的内容

《明日方舟》及本作涉及的全部**名称、角色、美术、Spine 模型、界面图、音乐音效、文本与游戏数据**，
版权归上海鹰角网络科技有限公司及其授权方（Yostar 等）所有。具体包括：

- **干员 Q 版小人序列帧**（`apps/web/public/assets/chibi/**`）——
  原始形态是官方的 Spine 骨骼动画，本项目在**构建期**用无头浏览器 + pixi-spine 逐帧渲染成静态 PNG。
  仓库里**不含** Spine 运行时，也**不含**骨骼数据（`.skel` / `.atlas`）。
- **干员半身像、头像、召唤物立绘、藏品图标、地图背景与地砖**
  （`apps/web/public/assets/stand|units|items|traits|covenants|fx|npc|player-avatars/**`、
  `tiles_atlas.png`、`backdrop.png`）。
- **官方 OST**（`apps/web/public/music/**`，62 首，索引见同目录 `tracks.json`）。
- **派生自官方游戏数据的数据表**：`packages/shared/src/unit-data.ts`、`unit-stats.ts`、
  `skill-data.ts`、`trait-data.ts`、`item-data.ts`、`covenant-data.ts` 等，
  以及由它们导出的 `.xlsx` 表格。这些是官方数值与文案的整理与引用，
  **同样不在 MIT 授权范围内**。
- **`docs/` 与 `.ui-e2e/` 中的游戏截图**。
- `docs/` 中引用的 PRTS、BWIKI 等社区页面的文字（仍按其来源的许可，维基文本通常为 CC BY-NC-SA）。

**上面这些素材一个字节都没有进仓库。** 仓库里提交的只有抓取与生成脚本
（`scripts/fetch-chibi.ts`、`fetch-portraits.ts`、`fetch-token-art.ts`、`fetch-map-assets.ts`、
`fetch-item-icons.ts`、`fetch-player-avatars.mjs`、`import-music.mjs`），
任何人 clone 之后跑一遍脚本才能在本机得到素材。

### 一个必须说清楚的事实

**没有任何官方发布的「同人游戏素材许可」。** 上面这套做法是社区长期形成的惯例，
它降低了被注意到的风险，**但并不等于法律上的授权或豁免**。
同人作品在各地法律下的地位并不一致，权利人有权要求下架。

---

## 3. 仅限非商业用途

- 本项目仅供**学习、研究和个人非商业娱乐**。
- 游戏素材与数据的权利人**没有授权**本项目或其使用者进行任何商业使用。因此包含或依赖这些素材的
  一切内容——整合包、架设的服务器、游戏截图、录像与直播等——都**不得用于任何形式的盈利**，包括但不限于：
  - 出售或付费分发；
  - 收费开服、付费房间或会员；
  - 植入广告；
  - 与本项目挂钩的打赏、赞助或众筹；
  - 打包进任何收费产品或服务。
- 再分发含素材的完整包时，请保留本声明与 [LICENSE](LICENSE)，并同样注明**非官方、非商业**。
- MIT 许可证本身允许商业使用**代码**；上述限制针对的是不属于本项目的游戏素材与数据。

---

## 4. 我们主动做了哪些限制

这一节不是法律要求，是我们自己加的约束。目的是让「这是同人爱好、不是侵权生意」这句话
**在每一处都能被验证**，而不只是口号。如果下面任何一条在你看来没有被遵守，那就是 bug。

### 关于素材

1. **仓库里一个素材字节都没有。** `.gitignore` 明确排除 `apps/web/public/assets/**` 与
   `apps/web/public/music/`，还写了兜底的单文件规则（`/apps/web/public/assets`）——
   因为 `mklink` 之后 git 看到的是文件而不是目录，只写目录规则会漏。
   提交历史里也从未出现过素材。
2. **素材只能由使用者自己抓。** 仓库里只有 7 个抓取脚本，clone 之后必须自己跑一遍
   才能在本机得到素材。抓取源是社区维护的公开镜像，不是任何官方接口。
3. **不内置任何骨骼动画。** 官方 Spine 模型（`.skel` / `.atlas`）从不入库、也从不随包分发。
   仓库里只有「构建期把动画逐帧渲染成 PNG」的工具，产物是静态图片。
4. **没有素材也能完整玩。** 素材缺失时逐级降级（见第 5 节），不崩、不缺功能、
   不会变成一个只会报错的空壳。

### 关于用途

5. **不收任何钱。** 没有广告、没有赞助链接、没有打赏按钮、没有付费房间、没有会员、
   没有周边、没有众筹。仓库和发布页都不放收款入口。
6. **不做商业推广。** 不买流量、不投广告位、不做商业化发布。
7. **不需要你的游戏账号。** 不读取本机《明日方舟》客户端、不索取任何登录凭据、
   不与官方服务器通信。
8. **不冒充官方。** 界面与发布页都标注「非官方同人作品」；不拿官方 logo 当项目标识，
   也不把鹰角的商标用作项目名。

### 关于可撤回性

9. **降级链是代码级设计，不是口头承诺。** 删目录就退回占位图，见第 5 节。
10. **下架不需要改代码、不需要数据迁移、不需要通知用户。** 见第 5 节的层级表。

---

## 5. 权利人通知与删除

### 承诺

如果你是相关权利人（鹰角网络、悠星，或其授权代表），认为本项目的任何内容不妥：

- **不需要说明理由，也不需要法律论证。** 你说撤，我们就撤。
- **我们不申辩、不拖延、不要求你提供权利证明。**
- **响应时限：收到通知后 24 小时内**删除相关内容；只涉及单个文件时通常几小时内处理完。
- **通知渠道**：在本仓库提交 Issue，或通过 GitHub 直接联系仓库所有者。
  如果不便公开，Issue 里只写「请私下联系仓库所有者」即可，我们会立刻转到私下沟通。

### 下架的层级

从轻到重，任何一级都可以单独执行，也可以直接跳到最后一级：

| 级别 | 动作 | 后果 |
|---|---|---|
| 1 | 删除某个文件 / 某组素材 | 对应角色退回占位图 |
| 2 | 删除 `apps/web/public/assets/` 整个目录 | 全部美术退回占位图，**游戏仍可完整游玩** |
| 3 | 删除 `apps/web/public/music/` | 无 BGM，**游戏仍可完整游玩** |
| 4 | 下架 Release 完整包，保留源码仓库 | 仓库变纯代码，使用者需自行抓取素材 |
| 5 | 归档或删除整个仓库 | 项目终止 |

### 为什么下架是「删目录」级别的操作

技术上这是设计过的：游戏对「素材消失」有一条降级链——

```
小人序列帧 → 半身像(stand/) → 头像(units/) → 程序化占位图
```

把 `apps/web/public/assets/` 删掉，游戏立刻退回占位图状态，**依然可以完整游玩**。
也就是说，需要清理素材时删目录就够了，**不需要改任何一行代码**。

这也是为什么第 2 节把「哪些东西不属于本项目」列得那么细：
清单越具体，删除时越不容易漏，也越不容易误删。

---

## 6. 免责声明

- 本项目按「原样」提供，**不附带任何明示或暗示的担保**。
- 使用、架设或公开本项目的风险，包括网络安全、第三方联机工具与服务、当地法律法规，
  由使用者自行承担。
- 本项目不需要也不会索取任何游戏账号，不读取你本机上的《明日方舟》客户端。

---

**English summary.** AIRNIGHT is an unofficial, non-commercial fan-made auto-battler based on *Arknights*.
It is not affiliated with, endorsed by, or licensed by Hypergryph or Yostar.

The project's own code is released under the MIT License. All Arknights names, art, Spine models, audio and game
data — including everything under `apps/web/public/assets/` and `apps/web/public/music/` — are © Hypergryph /
Yostar and their licensors. They are **not** covered by the MIT License, are **not** included in this repository
(they are fetched locally by the user via the scripts in `scripts/`), and may be used for study and personal
non-commercial purposes only: no selling, paid distribution, paid hosting, advertising, donations or any other
monetisation. No official logo or trademark is used as the project's identity, and the game requires no account.

**Takedown.** Rights holders and their representatives do not need to justify a request or provide proof.
Report through a GitHub issue (or ask for private contact there) and the content will be removed **within 24
hours**, without argument. Removal is designed to be cheap: the game has a code-level asset fallback chain
(chibi → half-body → portrait → procedural placeholder), so deleting `apps/web/public/assets/` returns it to
placeholder art while remaining **fully playable**. No code change, no data migration, no user notice required.
The repository itself never contained any asset, so the source history stays clean.

No warranty of any kind.

---

*本文件最后更新：2026-10-24。第三方组件的许可清单另见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。*
