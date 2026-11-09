# 发布清单 / Publishing checklist

包名 `dsh-workspace-folders` 在 `registry.npmjs.org` 上**可用**（已查，404）。
`npm pack` / `npm publish --dry-run` 已通过，并做过「装进空目录 → `dsh.bundle.patch`、`main`、`./client` 三个入口都能解析」的验证。

```
dsh-workspace-folders-0.1.0.tgz   34.3 kB   8 files
LICENSE  README.md  client.js  cordis.patch.yml  icon.svg  index.js  package.json  test/selftest.mjs
```

## 1. npm —— 唯一硬门槛是需要登录一次

```powershell
npm login                     # 用你自己的 npm 账号，我没法代做
cd D:\AI工作区\deepseek\plugins\dsh-workspace-folders
npm publish                   # 公开、unscoped、access=public
```

发布后别人就能装：

```sh
dsh plugin --profile <profile> add dsh-workspace-folders
```

本机 profile 现在指向 `link:D:/AI工作区/deepseek/plugins/dsh-workspace-folders`。想改成从 npm 装：

```powershell
dsh plugin --profile desktop remove dsh-workspace-folders
dsh plugin --profile desktop add dsh-workspace-folders
```

## 2. 市场收录 —— awesome-dsh-plugin 的一次 PR

市场目录不在 dshmarket 这个仓库里，而是
[awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)：
fork → 在 `README.md` 的 `## Plugins` → `### Development & Runtime` 里按 owner 字母序加一行 →
中文同步到 `README.zh.md` → 提 PR。站点和 dshmarket 的 `plugins.json` 每天从那里重建。

英文行（把 `OWNER` 换成你的 GitHub 用户名）：

```markdown
- [OWNER/dsh-workspace-folders](https://github.com/OWNER/dsh-workspace-folders) - Multi-folder workspaces: extra folders registered for a workspace become real workspace roots — the session's runtime context lists them, a workspace_roots tool reports each root's top level, git branch and AGENTS.md/README/manifests, and file tools read, write, patch, move and delete inside them without approval prompts. Folders are edited per workspace from a hover action on the sidebar row or from Settings. On Windows a confined shell stays inside the workspace, because ACL confinement cannot take extra roots.
```

中文行：

```markdown
- [OWNER/dsh-workspace-folders](https://github.com/OWNER/dsh-workspace-folders) - 多文件夹工作区：为某个工作区登记的额外文件夹会被当作真正的工作区根目录——会话运行时上下文会列出它们，`workspace_roots` 工具给出每个根目录的顶层结构、git 分支与 AGENTS.md/README/清单文件，文件工具在这些目录里读写、打补丁、移动、删除都不再弹审批。入口是侧栏工作区行的悬停按钮或设置页。Windows 上系统沙箱无法给进程追加可写目录，所以 `pwsh` 仍限制在工作区内。
```

评审会逐条核对描述与源码是否相符（"说 46 个工具就数一遍"），所以上面只写确实做到的三件事：多根工作区语义、文件工具放开、Windows 壳命令不放宽。

## 3. 发布后建议补的元数据

- `package.json` 的 `repository` / `homepage` / `bugs`：需要你的仓库地址；市场靠它把 npm 包跟仓库对上，取 star、更新检测和图标。
- 列表图标：`https://raw.githubusercontent.com/OWNER/dsh-workspace-folders/main/icon.svg`（仓库里已有 `icon.svg`）。

## 4. 版本策略

- `0.1.x` 修 bug；`0.2.x` 新增行为；存储格式（`folders.json`）或路由形状变更时进 minor 并在 README 写迁移。
- 发布前跑：`npm test`（Host 自测）+ `node test/client-selftest.mjs`（客户端 DOM 自测，需要 `linkedom`）。
