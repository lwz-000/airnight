# 贡献指南

感谢你来看这个项目。几句话说完。

## 一条硬规则

**不要提交任何游戏素材。**

`apps/web/public/assets/` 和 `apps/web/public/music/` 下的所有内容版权归鹰角网络 / 悠星，
它们被 `.gitignore` 排除是有原因的（见 [NOTICE.md](NOTICE.md)）。
如果你的改动依赖新素材，请改 `scripts/fetch-*.ts` 里的抓取逻辑，而不是把文件提交上来。

PR 里出现 `.png` / `.mp3` / `.woff2` 这类二进制素材，会被直接关闭。

## 提交之前

```bash
node node_modules/tsx/dist/cli.mjs tsc --noEmit -p tsconfig.json
node node_modules/vitest/vitest.mjs run --config config/vitest.config.ts
node scripts/verify.mjs
```

三道门全绿再提交。改数值或机制的话，光测试过还不够，要另外对账。

## 代码约定

- **注释写「为什么」，不写「是什么」**。代码本身说明是什么，注释要留下决策理由和踩过的坑。
- 文档用简体中文，变量名和 API 用英文。
- **同一件事只允许一处实现**。发现有两份逻辑在做同一件事，先合并再说。
- 新字段必须过处理器层。`submitTeam` 手挑字段这种写法丢过三次字段，别再犯。

## 项目性质

非盈利同人作品，不接受任何形式的商业化（广告、打赏、赞助、付费服务）。
提交代码即表示同意以 [MIT](LICENSE) 发布你的贡献。
