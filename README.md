# dsh-workspace-folders

多文件夹工作区插件 / Multi-folder workspaces for DeepSeekRuntime.

DSH 的一个会话只有一个工作区目录，文件沙箱只允许写入这个目录。跨文件夹干活（例如
`D:\AI工作区\deepseek` 和 `D:\AI工作区\另一个项目` 之间搬文件、跑脚本、对着一份共享库改接口）
时，第一次越界的 `write` / `edit` / `apply_patch` 都会弹出审批，模型也不知道那些文件夹存在。

这个插件把额外目录提升为**工作区根目录**——不只是"可写"：

| 层次 | 行为 |
|---|---|
| 工作区语义 | 每个会话的运行时上下文会列出属于它的根目录（自己的 + 登记的），并说明它们与工作区根目录同等对待 |
| 扫描入口 | 新增 `workspace_roots` 工具：一次返回所有根目录的绝对路径、顶层条目、git 分支、以及 `AGENTS.md`/`README`/清单文件标记 |
| 写入权限 | 文件工具（读、写、编辑、补丁、移动、删除）在这些目录里直接用绝对路径，不再审批 |
| 作用域 | 可以只给某个工作区加（按会话 cwd 归属判定，支持嵌套），也可以设为所有工作区通用 |

> **Windows 限制（实测）**：文件工具支持追加目录，`pwsh` 等沙箱进程**不支持**。系统侧的
> 进程沙箱基于 Windows ACL 受限令牌，宿主会直接拒绝携带追加目录的策略
> （`Windows ACL confinement does not support additional writable directories`）。
> 因此本插件只把追加目录交给文件工具，并在进程沙箱前把它们摘掉——否则一条目录都加不了，
> 连 `pwsh` 本身都会失败。需要命令行跨文件夹写入时，请把该会话切到「完全权限」。

## 安装

```sh
dsh plugin --profile <profile> add dsh-workspace-folders
```

也可以在 dshmarket 里搜索安装；本地目录安装等价于 `plugin_manager` 的 `install_bundle`。

## 使用

两个入口，改的是同一份清单：

**A. 左侧栏就地管理（推荐）** — 鼠标移到侧栏的某个工作区名称上，行尾会出现一个文件夹图标
（在自带「⋯」的左边）。点它直接弹出该工作区的管理框：

- 第一行是该工作区自己的根目录，标着「始终可写」，不可移除；
- 下面列出已登记的额外文件夹，每行可移除；
- 「添加文件夹」调用系统选择框，「或输入绝对路径」作为兜底；
- Esc / 点遮罩 / 关闭按钮都能退出。

> 说明：DSH 没有给工作区行的「⋯」菜单开放插槽（只有会话行的菜单有），所以这个入口是
> **DOM 层注入**的悬停按钮（`[class*="projectRow"]` + MutationObserver 跟随 React 重渲染）。
> DSH 大版本升级后如果它对不上，最坏情况是按钮不出现——设置页仍然可用，功能不受影响。

**B. 设置页总览** — 设置（左下角齿轮）→ **工作区文件夹**：全局清单 + 每个工作区一张卡片。

改完立即生效，不需要重启 DSH；下一次工具调用就是新的沙箱边界，下一轮模型请求就会带上新的
根目录清单。

## 模型看到什么

每轮请求的运行时上下文里，属于该会话的根目录会被列出来：

```
This session has extra workspace roots besides its own workspace folder:
- D:\AI工作区\shared-lib
Treat them as workspace roots of equal standing: when the task may involve them, list their
contents and read the relevant README/AGENTS.md/manifests before planning. The `workspace_roots`
tool returns every root with its top level, git branch and marker files.
```

`workspace_roots` 的输出形如：

```
Workspace roots for this session (2):
1. D:\AI工作区\deepseek — session workspace [git branch main | AGENTS.md, README.md, package.json]
   top level: src/ test/ package.json README.md tsconfig.json
2. D:\AI工作区\shared-lib — extra workspace root [git branch release/2.x | README.md, Cargo.toml]
   top level: crates/ Cargo.toml README.md
Read the roots that matter for the task before planning or editing.
```

清单本身是"话术 + 入口"：模型知道它们存在、知道它们是同级工作区、也知道第一步该把哪些目录读一遍。

## 存储

`<profile>/plugin-data/dsh-workspace-folders/folders.json`

```json
{
  "version": 1,
  "global": ["D:\\shared"],
  "workspaces": { "D:\\AI工作区\\deepseek": ["D:\\AI工作区\\另一个项目"] }
}
```

- 不存在的目录会**保留在列表里**（外接盘暂时没插上时不会被悄悄忘掉），但不会进入沙箱策略、
  根目录清单和 `workspace_roots` 输出。
- 删除某工作区最后一个目录，该工作区条目自动消失。

## 它是怎么做到的

- 包装 `ctx.sandboxPolicy.resolve()`：每次工具执行时把当前会话 cwd 对应的额外目录合并进
  `additionalWritableRoots`。文件工具（读、写、编辑、补丁、移动、删除）都从这一个入口取策略。
- 包装 `ctx.sandbox.confine()`：进程沙箱拿到的策略会去掉追加目录（只做"更窄"的收紧），
  保证 `pwsh` 不会因为追加目录而直接拒绝运行。
- 一条全局运行时上下文说明"多根目录"策略（不含任何路径，不会让 A 工作区看到 B 的目录）；
  再按 `agent/created` 为每个会话注册**同名**的会话级上下文，列出它自己的根目录并覆盖前者。
- 注册 `workspace_roots` 工具（Host 侧直接读盘，不受沙箱限制，只读）。
- 只**加目录**，不改模式：`read-only` 会话仍然只读，`danger-full-access` 保持原样。
- 服务本身没有被替换（只是实例上包了一层），插件卸载后行为立刻恢复原状。
- 三个 HTTP 路由（`/dsh-workspace-folders/state|add|remove`）供设置页读写；写操作要求同源
  （`Origin` 的 host 必须等于 `Host`），跨站请求直接 403。

## 与"真·多根工作区"还差的（尚未实现）

- 侧边栏文件树、`@` 文件补全、工作区变更/diff 记录仍然只认会话的工作区根目录；
  插件只覆盖了模型侧的工作逻辑和写入边界。
- 模板/技能发现（如工作区里的 `AGENTS.md` 自动注入）取决于 DSH 装配：本 profile 里
  `agent-instructions` 是未启用状态，所以"和默认工作区一模一样"在这一点上没有对照组。

## 权限边界

- 沙箱只限制**写入**；读取本来就不受工作区限制。
- 加进来的目录等于把该目录的写权限交给 agent，请只添加你信任的目录。
- 跨文件夹写文件请优先用文件工具（`write` / `edit` / `apply_patch` / 移动 / 删除）；`pwsh`
  里的写操作仍受工作区限制，除非会话处于「完全权限」。
- 工作区作用域的目录不会泄漏到其它工作区：判定依据是会话 cwd 是否位于该工作区目录之下
  （支持嵌套，最长前缀优先）。
- 一个目录如果包含了工作区本身（例如把 `D:\` 加给 `D:\work`），会被拒绝。

## 卸载

从 profile 的 `dsh.profile.bundles` 里移除 `dsh-workspace-folders` 即可；`resolve`/`confine`
的包装、会话级上下文和 `workspace_roots` 工具都会随插件一起撤销，沙箱回到原样。已保存的
`folders.json` 不会自动删除。

## 自测

```sh
npm test        # Host 自测：假 Cordis 上下文跑真实模块
```

覆盖：作用域隔离、策略合并、`read-only` 不受影响、外接盘掉线、跨站拒绝、进程沙箱只拿工作区
边界、会话级根目录清单、`workspace_roots` 的扫描与渲染。客户端另有一份 DOM 自测
（`test/client-selftest.mjs`，需要 `linkedom`），不随包发布。
