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

例外：

- 通过 npm 安装的第三方库（three.js、ws、vite、vitest 等）各自保留原许可证。
- `apps/web/public/fonts/NotoSansSC.woff2` 是 **思源黑体 / Noto Sans SC** 的子集，
  以 **SIL Open Font License 1.1** 发布，声明见同目录 `FONT-LICENSE.txt`。

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
- **官方 OST**（`apps/web/public/music/**`，63 首）。
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

## 4. 权利人通知与删除

如果你是相关权利人，认为本项目的任何内容不妥，
请在仓库提交 Issue 或通过 GitHub 联系仓库所有者。
我们会**立即删除**相关内容，或下架完整包乃至整个仓库。

技术上这是设计过的：游戏对「素材消失」有降级链——

```
小人序列帧 → 半身像(stand/) → 头像(units/) → 程序化占位图
```

把 `apps/web/public/assets/` 删掉，游戏立刻退回占位图状态，**依然可以完整游玩**。
也就是说，需要清理素材时删目录就够了，不需要改任何代码。

---

## 5. 免责声明

- 本项目按「原样」提供，**不附带任何明示或暗示的担保**。
- 使用、架设或公开本项目的风险，包括网络安全、第三方联机工具与服务、当地法律法规，
  由使用者自行承担。
- 本项目不需要也不会索取任何游戏账号，不读取你本机上的《明日方舟》客户端。

---

**English summary.** AIRNIGHT is an unofficial, non-commercial fan-made auto-battler based on *Arknights*.
It is not affiliated with or endorsed by Hypergryph or Yostar. The project's own code is released under the MIT
License. All Arknights names, art, Spine models, audio and game data — including everything under
`apps/web/public/assets/` and `apps/web/public/music/` — are © Hypergryph / Yostar and their licensors, are **not**
covered by the MIT License, are **not** included in this repository, and may be used for study and personal
non-commercial purposes only: no selling, paid distribution, paid hosting, ads, donations or any other
monetisation. Rights holders can request removal through a GitHub issue and the content will be taken down.
No warranty of any kind.
