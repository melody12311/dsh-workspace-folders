# 发布状态 / Publishing status

## 已发布（2026-11-09）

| 项 | 值 |
|---|---|
| 仓库 | <https://github.com/melody12311/dsh-workspace-folders>（public，`main`） |
| 版本 | `v0.1.0`：tag + GitHub Release，附 `dsh-workspace-folders-0.1.0.tgz` |
| Release | <https://github.com/melody12311/dsh-workspace-folders/releases/tag/v0.1.0> |
| topics | `dsh-plugin` `dsh` `deepseek-harness` `workspace` `sandbox` |
| 市场收录 | PR **#13547** <https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/13547> |

安装（都不需要 npm 账号）：

```sh
dsh plugin --profile <profile> add github:melody12311/dsh-workspace-folders
```

```sh
dsh plugin --profile <profile> add "https://github.com/melody12311/dsh-workspace-folders/releases/download/v0.1.0/dsh-workspace-folders-0.1.0.tgz"
```

**匿名验证**：在不带任何凭据的干净目录 `git clone`，`package.json` 的 `dsh.bundle.patch`、`main`、
`./client` 三个入口均存在，`index.js` 可解析；Release 资产的 `state=uploaded`。

## 市场收录的提交细节

这个列表**不接受改 README**（README 由脚本生成），投稿就是加**一个文件**：
`data/plugins/<owner>__<repo>.yml`。已提交的内容（PR #13547）：

```yaml
url: https://github.com/melody12311/dsh-workspace-folders
name: melody12311/dsh-workspace-folders
category: dev
description:
  en: 'Extra folders registered for a workspace become real workspace roots: …'
  zh: '为某个工作区登记的额外文件夹会被当作真正的工作区根目录：…'
tarball: https://github.com/melody12311/dsh-workspace-folders/releases/download/v0.1.0/dsh-workspace-folders-0.1.0.tgz
```

规则要点（都已满足，除最后一条）：

- `package.json` 必须声明 `dsh.bundle`（只声明 `dsh.client` 会被拒）→ 有。
- 仓库含真实可用的代码 → 有。
- 加 `dsh-plugin` topic → 已加。
- 描述必须与源码相符（评审会逐条核对）→ 描述只写了实际实现的三件事。
- **仓库创建满 1 天** → 仓库是 2026-11-09 15:50 建的，所以 CI 的 gate 一开始会红；按官方说明，
  这个判定是快照、会自动重跑，满 24 小时后自己转绿，不需要新开 PR。
- 图标只收 GitHub 托管的**位图**（png/jpg/webp，约 96px 显示），SVG 会被拒 → 本条目没写 `icon`，
  市场回退到你的 GitHub 头像。想做自定义图标：加一张 180×180 的 PNG 到仓库，再在条目里补
  `icon: https://raw.githubusercontent.com/melody12311/dsh-workspace-folders/main/assets/icon-180.png`。

## 没做的：npm

本机没有 npm 账号（只有 GitHub）。包名 `dsh-workspace-folders` 在 `registry.npmjs.org` 上已确认可用。
将来要上 npm（可选，只影响市场展示下载量）：

```powershell
npm login
cd D:\AI工作区\deepseek\plugins\dsh-workspace-folders
npm test
npm publish          # publishConfig.access=public 已写好
```

发布后要注意：`package.json` 的 `repository` 必须指回本仓库（已指向
`git+https://github.com/melody12311/dsh-workspace-folders.git`），市场才会把 npm 包和仓库关联。
条目里**不要**手写 `npm:` 字段（会被校验拒绝），映射自动采集。

## 发新版本

```powershell
cd D:\AI工作区\deepseek\plugins\dsh-workspace-folders
# 1. 改 package.json 的 version
npm test
node test/client-selftest.mjs          # 需要 profile 里的 linkedom
npm pack --pack-destination dist       # dist/ 已被 .gitignore 排除
# 2. 提交、推送、打 tag
git add -A ; git commit -m "vX.Y.Z — ..." ; git push origin main
git tag -f vX.Y.Z -m "vX.Y.Z" ; git push -f origin vX.Y.Z
# 3. 在 GitHub Releases 页面新建 release 并拖入 dist/*.tgz
#    资产名建议与版本一致，然后同步更新市场条目里的 tarball:（钉住 tag 就不会腐烂）
```

版本策略：`0.1.x` 修 bug；`0.2.x` 新增行为；`folders.json` 存储格式或 HTTP 路由形状变更进 minor，
并在 README 写迁移。

## 本机 profile 现状

装的是 `link:D:/AI工作区/deepseek/plugins/dsh-workspace-folders`（改源码即时生效）。想验证"别人
装到的确实是 GitHub 上那一份"：

```powershell
dsh plugin --profile desktop remove dsh-workspace-folders
dsh plugin --profile desktop add github:melody12311/dsh-workspace-folders
```
