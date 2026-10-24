# 第三方组件声明（Third-party notices）

本项目自己编写的代码以 **MIT 许可证**发布，见 [LICENSE](LICENSE) 与 [NOTICE.md](NOTICE.md)。
**下列组件不属于这次授权**，各自保留原许可证，全文附在文末或随包文件里。

本文件把两件事分开写，因为它们的义务完全不同：

- **随发行包分发的** —— MIT 要求「版权声明与许可声明必须包含在软件的所有副本中」。
  打包器（Vite / esbuild）会把源码里的注释剥掉，许可证文本**不会自动跟着产物走**。
  这不是推测，是本仓库的实测结果：在 `apps/web/dist/assets/index-*.js` 里搜
  `three.js authors` 和 `Permission is hereby granted`，**都是 0 命中**。
  所以必须靠这份文件随包携带，`scripts/pack-portable.mjs` 里有一道断言在把关（见第七节）。
- **只在开发时使用的** —— 不发给玩家，没有随包义务，但仍然列出来以便审查。

> **权利人有异议？** 不需要理由，也不需要法律论证 —— 见 [NOTICE.md](NOTICE.md) 第 5 节，
> 承诺收到通知后 **24 小时内**删除相关内容，删目录即可，不需要改代码。
> 本文件列出的第三方组件本身都是开源软件，那部分不存在权利争议；
> 有争议的只有随完整包分发的官方素材，而那部分不在本文件的授权范围内（见第五节）。

---

## 一、发行包里到底有什么

`scripts/pack-portable.mjs` 打四种包。**分档只决定有没有素材，程序与许可证文件完全相同**：

| 档 | 文件名 | 含什么 | 约 |
|---|---|---|---|
| 完整包 | `失序协议-网页版-<版本>.zip` | 程序 + 全部美术与音乐 | 615 MB |
| 精简包 | `失序协议-网页版-<版本>-lite.zip` | 程序，去掉美术与音乐 | 94 MB |
| 素材包 | `失序协议-素材包-<版本>.zip` | 只有 `web/assets` 的美术与 `web/music` | 514 MB |
| 更新包 | `失序协议-网页版-<版本>-update.zip` | 只有相对上一版改动过的文件 | 几 MB |

完整包 / 精简包 / 更新包的结构：

```
失序协议-网页版-<版本>/
  启动游戏.vbs / 关闭游戏.vbs / 启动游戏.cmd
  启动说明.txt · 玩法说明.txt · 更新日志.txt · 游戏图标.ico
  版权说明.txt                NOTICE.md（非商业条款 + 五级下架层级表）
  第三方组件声明.txt          本文件
  app/launch.mjs              启动器（本项目，MIT）
  app/airnight-server.mjs     服务端 bundle（本项目 + ws）
  runtime/node.exe            Node.js 运行时
  runtime/LICENSE-Node.js.txt Node.js 及其内置组件的完整许可证（约 148 KB）
  web/                        前端产物（本项目 + three.js + 字体）
```

差异只有两处：**精简包**额外带一张 `补素材说明.txt`，并把 `web/assets` 里的美术目录与 `web/music`
删掉（`index-*.js` 这类代码产物保留）；**素材包**只有 `web/assets/*`（美术）+ `web/music/`，
再加 `素材包说明.txt` 与上述两份版权文件。

**四种包都不带 `node_modules`。** `ws` 由 esbuild 打进 `app/airnight-server.mjs`，
`three` 由 Vite 打进 `web/assets/index-*.js`，所以每个包都是自足的目录。

---

## 二、随发行包分发的组件

| 组件 | 版本 | 许可证 | 用途 | 在仓库里 | 在发行包里 |
|---|---|---|---|---|---|
| [three.js](https://github.com/mrdoob/three.js) | 0.171.0 | MIT | 3D 棋盘场景（WebGL 渲染） | 否（npm） | 是，打进 `web/assets/index-*.js` |
| [ws](https://github.com/websockets/ws) | 8.21.3 | MIT | 联机房间的 WebSocket 服务端 | 否（npm） | 是，打进 `app/airnight-server.mjs` |
| [Node.js](https://nodejs.org/) | v22.22.2 | MIT（含其内置第三方组件的各自许可） | 便携包内置运行时 | 否 | 是，`runtime/node.exe` |
| [Noto Sans SC](https://fonts.google.com/noto/specimen/Noto+Sans+SC)（思源黑体） | 可变字体子集 | SIL OFL 1.1 | 界面自托管字体 | **是**，`apps/web/public/fonts/NotoSansSC.woff2`（2.0 MB 子集） | 是，`web/fonts/` |

关于字体：`NotoSansSC.woff2` 由 `scripts/subset-font.py` 从本机安装的 Noto Sans SC 可变字体裁剪而来，
只保留 ASCII + GB2312 全集 + 源码里出现的字符。**它是本项目唯一入库的第三方二进制文件。**
OFL 1.1 要求「随字体一起分发许可全文」，因此 `apps/web/public/fonts/` 目录里同时放了两份：

- `FONT-LICENSE.txt` —— 版权声明（© 2014-2021 Adobe，保留字体名 'Source'）与来源说明
- `OFL.txt` —— OFL 1.1 许可证全文

`ws` 的 `bufferutil` / `utf-8-validate` 是**可选**的性能增强（peerDependencies，可不装），本项目未启用，
因此发行包不含这两个原生模块。

---

## 三、只在开发时使用（不随包分发）

| 组件 | 版本 | 许可证 | 用途 |
|---|---|---|---|
| [Vite](https://github.com/vitejs/vite) | 6.4.3 | MIT | 前端构建与开发服务器 |
| [Rollup](https://github.com/rollup/rollup) | 4.63.1 | MIT | Vite 的生产打包器 |
| [esbuild](https://github.com/evanw/esbuild) | 0.25 / 0.28 / 0.21 | MIT | 服务端 bundle 与启动器构建 |
| [TypeScript](https://github.com/microsoft/TypeScript) | 5.9.3 | Apache-2.0 | 类型检查（`tsc --noEmit`） |
| [tsx](https://github.com/privatenumber/tsx) | 4.23.13 | MIT | 直接运行 `.ts` 脚本 |
| [Vitest](https://github.com/vitest-dev/vitest) | 2.1.9 | MIT | 单元测试（内含另一份 Vite 5.4.21） |
| [jsdom](https://github.com/jsdom/jsdom) | 30.0.1 | MIT | 无头 DOM 环境的测试 |
| [PostCSS](https://github.com/postcss/postcss) | 8.5.28 | MIT | 上述工具链的传递依赖 |

完整的传递依赖清单以仓库根的 `pnpm-lock.yaml` 为准——它记录了每个包的版本与 integrity 校验值，
是这个表格的权威来源。

---

## 四、构建期用到的工具（既不在仓库里，也不在发行包里）

这两个只在**开发者本机**把官方 Spine 骨骼动画预渲染成 PNG 序列帧时使用
（`scripts/fetch-chibi.ts` 从 CDN 取到 `.chibi-cache/vendor/`，`scripts/render-chibi.mjs` 调用）：

| 组件 | 版本 | 许可证 | 说明 |
|---|---|---|---|
| [PixiJS](https://github.com/pixijs/pixijs) | 7.4.2 | MIT | 无头 WebGL 渲染 |
| [pixi-spine](https://github.com/pixijs/spine) | 4.0.6 | MIT banner，**内含 Spine Runtimes，受 Spine Runtimes License Agreement 约束** | Spine 骨骼动画播放 |

关于 Spine：pixi-spine 里带的 Spine Runtimes **不是 MIT**，它有自己的许可证，条款之一是
「除非由 Spine Editor 许可协议覆盖，否则产品的每个使用者都须自行购买 Spine Editor 授权」。
本项目因此**刻意不把 pixi-spine 打进发行包**——发行包里只有渲染结果的静态 PNG 序列帧，
运行时不需要 Spine 运行时，也不含任何 `.skel` / `.atlas` 文件。
`.chibi-cache/` 已在 `.gitignore` 中，克隆仓库不会得到任何 Spine 相关内容。

> 如果你要自己分发一个包含 pixi-spine 的衍生物，请先读 Spine Runtimes License Agreement，
> 并考虑像其他项目那样用 GPL-3.0 第 7 条的附加许可来处理组合授权问题。
> 本项目用 MIT，没有这个条款可用，所以更简单也更安全的选择是：不要在发行物里带它。

---

## 五、游戏素材与游戏数据

《明日方舟》的全部名称、角色、美术、Spine 模型、界面图、音乐音效、文本与游戏数据
版权归上海鹰角网络科技有限公司及其授权方所有，**既不在 MIT 授权范围内，也不在本文件任何一条的覆盖范围内**。

它们**不在本仓库里**，只在发行包的完整版里随包分发，用途与限制见 [NOTICE.md](NOTICE.md) 第 2、3 节。
本文件的存在**不会**、也**不应被理解为**为这些内容提供任何许可。

---

## 六、许可证全文

### three.js — MIT

```
The MIT License

Copyright © 2010-2024 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### ws — MIT

```
Copyright (c) 2011 Einar Otto Stangvik <einaros@gmail.com>
Copyright (c) 2013 Arnout Kazemier and contributors
Copyright (c) 2016 Luigi Pinca and contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### Node.js — MIT

Node.js 手册文件的开头部分：

```
Node.js is licensed for use as follows:

"""
Copyright Node.js contributors. All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to
deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
IN THE SOFTWARE.
"""
```

`node.exe` 还链接了 OpenSSL、V8、zlib、libuv 等组件，各自有自己的许可证。
**许可证全文（约 148 KB）已随包放在 `runtime/LICENSE-Node.js.txt`**，由 `scripts/pack-portable.mjs`
在打包时从 Node 安装目录原样复制。发布时请勿省略这个文件。

### Noto Sans SC / 思源黑体 — SIL OFL 1.1

全文见 `apps/web/public/fonts/OFL.txt`（版权声明另见同目录 `FONT-LICENSE.txt`）。
OFL 允许自由使用、修改与再分发，包括嵌入与子集化，条件是：
保留版权声明与许可全文、不得单独售卖字体本身、不得使用保留字体名 'Source' 命名衍生字体。

---

## 七、这份文件本身怎么维护

`scripts/pack-portable.mjs` 的第 6.5 步「版权文件自检」是硬断言：**五份文件缺任何一份，
或体积小于下限（说明退化成了占位文本），打包直接失败**，不会产出一个不合规的包。
它检查的是：

| 包内路径 | 来源 | 体积下限 |
|---|---|---|
| `第三方组件声明.txt` | 本文件 | 5 KB |
| `版权说明.txt` | `NOTICE.md` | 2 KB |
| `runtime/LICENSE-Node.js.txt` | Node 安装目录的 `LICENSE` 原样复制 | 10 KB（实际约 148 KB） |
| `web/fonts/OFL.txt` | `apps/web/public/fonts/OFL.txt` | 3 KB |
| `web/fonts/FONT-LICENSE.txt` | 同上目录 | 0.5 KB |

日常维护规则：

- `pnpm-lock.yaml` 变了（加依赖、升版本）→ 回来更新第二、三节的版本号。
- `scripts/pack-portable.mjs` 改了打包内容 → 回来更新第一节的目录结构。
- 新增随包分发的依赖 → 必须加进第二节，并把许可证全文放到第六节。
- 纯开发依赖变动 → 只更新第三节，不必加全文（它们不随包分发）。

**英文 summary.** This file lists every third-party component in AIRNIGHT.
The project's own code is MIT. Distributed in the portable bundle: three.js 0.171.0 (MIT),
ws 8.21.3 (MIT), Node.js v22.22.2 (MIT), and a subset of Noto Sans SC (SIL OFL 1.1) —
each keeps its own licence, reproduced above or shipped alongside.
Development-only tools (Vite, Rollup, esbuild, TypeScript, tsx, Vitest, jsdom) are not distributed.
PixiJS and pixi-spine are used only at build time to pre-render Spine animations into PNG
sprite strips; they are never shipped, and no Spine runtime or skeleton data is distributed.
All *Arknights* names, art, audio and game data remain © Hypergryph / Yostar and are covered
by neither the MIT License nor anything in this file — see [NOTICE.md](NOTICE.md).
