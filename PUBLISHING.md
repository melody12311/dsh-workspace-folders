# 发布状态 / Publishing status

## 已发布（2026-11-09）

| 项 | 值 |
|---|---|
| 仓库 | <https://github.com/melody12311/dsh-workspace-folders>（public，`main`） |
| 版本 | `v0.1.0`：tag + GitHub Release，附 `dsh-workspace-folders-0.1.0.tgz` |
| Release | <https://github.com/melody12311/dsh-workspace-folders/releases/tag/v0.1.0> |

两种安装方式（都不需要 npm 账号）：

```sh
dsh plugin --profile <profile> add github:melody12311/dsh-workspace-folders
```

```sh
dsh plugin --profile <profile> add "https://github.com/melody12311/dsh-workspace-folders/releases/download/v0.1.0/dsh-workspace-folders-0.1.0.tgz"
```

**匿名验证**：在不带任何凭据的干净目录 `git clone` 该仓库，`package.json` 的 `dsh.bundle.patch`、
`main`、`./client` 三个入口均存在，`index.js` 可解析——别人拿到的是完整可加载的 bundle。

## 没做的两件事

1. **npm 未发布**：本机没有 npm 账号（只有 GitHub）。包名 `dsh-workspace-folders` 在
   `registry.npmjs.org` 上已确认可用。将来要上 npm：

   ```powershell
   npm login          # 需要注册一个 npm 账号
   cd D:\AI工作区\deepseek\plugins\dsh-workspace-folders
   npm test
   npm publish        # publishConfig.access=public 已写好
   ```

2. **市场收录未提**：见下节。条目已按
   [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) README 的格式写好，
   提 PR 即可（列表的评审会逐条核对描述与源码是否相符）。

## 市场条目（把这两行分别放进 README.md / README.zh.md 的 Development & Runtime 小节，按 owner 字母序）

```markdown
- [melody12311/dsh-workspace-folders](https://github.com/melody12311/dsh-workspace-folders) - Multi-folder workspaces: extra folders registered for a workspace become real workspace roots — the session's runtime context lists them, a workspace_roots tool reports each root's top level, git branch and AGENTS.md/README/manifests, and file tools read, write, patch, move and delete inside them without approval prompts. Folders are edited per workspace from a hover action on the sidebar row or from Settings. On Windows a confined shell stays inside the workspace, because ACL confinement cannot take extra roots.
```

```markdown
- [melody12311/dsh-workspace-folders](https://github.com/melody12311/dsh-workspace-folders) - 多文件夹工作区：为某个工作区登记的额外文件夹会被当作真正的工作区根目录——会话运行时上下文会列出它们，`workspace_roots` 工具给出每个根目录的顶层结构、git 分支与 AGENTS.md/README/清单文件，文件工具在这些目录里读写、打补丁、移动、删除都不再弹审批。入口是侧栏工作区行的悬停按钮或设置页。Windows 上系统沙箱无法给进程追加可写目录，所以 `pwsh` 仍限制在工作区内。
```

## 发新版本

```powershell
cd D:\AI工作区\deepseek\plugins\dsh-workspace-folders
# 1. 改 package.json 的 version
npm test
node test/client-selftest.mjs          # 需要 profile 里的 linkedom
npm pack --pack-destination dist       # 产物在 dist/，已被 .gitignore 排除
# 2. 提交并推送
git add -A
git commit -m "vX.Y.Z — ..." 
git push origin main
# 3. 打 tag 并推
git tag -f vX.Y.Z -m "vX.Y.Z"
git push -f origin vX.Y.Z
# 4. 在 GitHub 的 Releases 页面新建 release 并拖入 dist/*.tgz
```

版本策略：`0.1.x` 修 bug；`0.2.x` 新增行为；`folders.json` 存储格式或 HTTP 路由形状变更时进
minor，并在 README 写迁移。

## 本机 profile 现状

本机装卸的是 `link:D:/AI工作区/deepseek/plugins/dsh-workspace-folders`（改源码即时生效）。
想验证"别人装到的确实是 GitHub 上那一份"，可以：

```powershell
dsh plugin --profile desktop remove dsh-workspace-folders
dsh plugin --profile desktop add github:melody12311/dsh-workspace-folders
```
