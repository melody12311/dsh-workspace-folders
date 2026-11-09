// Browser module: extra writable workspace folders, in two places.
//
//   1. a Settings page (`settings.section`), the canonical list of global and
//      per-workspace folders, and
//   2. a hover button on every workspace row in the left sidebar that opens the
//      same manager as an overlay dialog (`shell.overlay`).
//
// The host half (index.js) owns the folder list and the sandbox policy; this file
// only renders the list and mutates it through same-origin routes:
//   GET  /dsh-workspace-folders/state   -> { ok, global, workspaces, home }
//   POST /dsh-workspace-folders/add     -> { ok, state } | { ok: false, error }
//   POST /dsh-workspace-folders/remove  -> { ok, state } | { ok: false, error }
window.__ModuleLoader__.load({
  id: 'dsh-workspace-folders',
  factory: (require) => {
    const React = require('react');
    const h = React.createElement;
    const NS = 'workspaceFolders';
    const BASE = '/dsh-workspace-folders';

    const dictionaries = {
      zh: {
        nav: '工作区文件夹',
        title: '额外可写文件夹',
        intro: '为工作区登记额外的根目录：它们和默认工作区文件夹同等对待——会话会知道它们存在，模型会先扫描相关目录再动手，文件读写也不需要审批。',
        warning: '加入的文件夹会对 Agent 敞开写入权限、不再弹出审批，请只添加你信任的位置。',
        shellNote: '说明：Windows 的系统沙箱无法为进程追加可写目录，因此 pwsh 命令仍限制在工作区内。需要用命令行跨文件夹写入时，请把该会话切到「完全权限」。文件读写、编辑、补丁、移动、删除不受此限制。',
        loading: '正在读取…',
        loadFailed: '无法读取文件夹配置',
        retry: '重试',
        globalTitle: '所有工作区',
        globalHint: '这里的文件夹对每个工作区都生效。',
        globalEmpty: '还没有添加全局文件夹。',
        workspaceHint: '这里的文件夹只对这个工作区生效。',
        workspaceEmpty: '还没有添加额外文件夹。',
        workspaceRoot: '工作区根目录',
        alwaysWritable: '始终可写',
        currentWorkspace: '当前会话',
        addFolder: '添加文件夹…',
        pathPlaceholder: '或输入绝对路径，例如 D:\\data',
        add: '添加',
        remove: '移除',
        added: '已添加。',
        removed: '已移除。',
        working: '处理中…',
        emptyPath: '请先输入文件夹路径。',
        notAbsolute: '请填写绝对路径，例如 D:\\data 或 \\\\服务器\\共享。',
        pickerUnavailable: '当前环境打不开系统的文件夹选择框，请手动输入绝对路径后点“添加”。',
        requestFailed: '操作失败',
        networkError: '连接不到本地服务，请确认 DSH 仍在运行后重试。',
        noWorkspaces: '还没有已登记的工作区。',
        manage: '管理工作区文件夹',
        close: '关闭',
        dialogTip: '按 Esc 或点击空白处关闭',
        pickWorkspace: '请选择一个工作区',
        pickWorkspaceHint: '侧边栏这一行没有匹配到已登记的工作区，请手动选择要管理的目标。',
        dialogNote: '这里的文件夹按工作区根目录对待：加入后 Agent 可以直接读写，不再弹出审批。全局文件夹请在设置页里管理。'
      },
      en: {
        nav: 'Workspace folders',
        title: 'Extra writable folders',
        intro: 'Register extra workspace roots: they are treated like the session workspace folder — the session knows they exist, the agent scans the relevant ones before planning, and file reads and writes need no approval.',
        warning: 'Added folders become writable for the agent without approval prompts, so only add locations you trust.',
        shellNote: 'Note: the Windows process sandbox cannot take extra writable directories, so pwsh commands stay inside the workspace. Switch the session to full access when a shell has to write across folders. File read, write, edit, patch, move and delete are unaffected.',
        loading: 'Loading…',
        loadFailed: 'Could not read the folder settings',
        retry: 'Retry',
        globalTitle: 'All workspaces',
        globalHint: 'These folders apply to every workspace.',
        globalEmpty: 'No global folder added yet.',
        workspaceHint: 'These folders apply to this workspace only.',
        workspaceEmpty: 'No extra folder added yet.',
        workspaceRoot: 'Workspace root',
        alwaysWritable: 'Always writable',
        currentWorkspace: 'This session',
        addFolder: 'Add folder…',
        pathPlaceholder: 'Or type an absolute path, e.g. D:\\data',
        add: 'Add',
        remove: 'Remove',
        added: 'Folder added.',
        removed: 'Folder removed.',
        working: 'Working…',
        emptyPath: 'Type a folder path first.',
        notAbsolute: 'Use an absolute path, e.g. D:\\data or \\\\server\\share.',
        pickerUnavailable: 'The system folder dialog is unavailable here; type the absolute path and press Add.',
        requestFailed: 'The request failed',
        networkError: 'Cannot reach the local service. Make sure DSH is still running, then retry.',
        noWorkspaces: 'No registered workspace yet.',
        manage: 'Manage workspace folders',
        close: 'Close',
        dialogTip: 'Press Esc or click outside to close',
        pickWorkspace: 'Pick a workspace',
        pickWorkspaceHint: 'That sidebar row did not match a registered workspace, so pick the target manually.',
        dialogNote: 'These folders are treated as workspace roots: the agent can read and write them without approval. Manage global folders in Settings.'
      }
    };

    /**
     * One look, two roots: the Settings page is scoped to `[data-wsf-page]` and
     * the sidebar dialog to `[data-wsf-dialog]`. The tokens and the element rules
     * are shared — only the scope attribute differs — so they are generated per
     * root instead of copied twice.
     */
    const scopeTokens = (root) => `${root}{--wsf-card:var(--dsw-alias-settings-card-fill,var(--dsw-alias-bg-layer-2,Canvas));--wsf-stroke:var(--dsw-alias-settings-card-stroke,var(--dsw-alias-border-l4,rgba(128,128,128,.34)));--wsf-fg:var(--dsw-alias-label-primary,CanvasText);--wsf-muted:var(--dsw-alias-label-secondary,#61666b);--wsf-subtle:var(--dsw-alias-label-tertiary,#81858c);--wsf-line:var(--dsw-alias-border-l2,rgba(128,128,128,.2));--wsf-line-strong:var(--dsw-alias-border-l3,rgba(128,128,128,.3));--wsf-sunken:var(--dsw-alias-bg-module-platform,color-mix(in srgb,CanvasText 5%,Canvas));--wsf-control:var(--dsw-alias-bg-layer-1,Canvas);--wsf-hover:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.1));--wsf-accent:var(--dsw-alias-state-business-primary,#4176e6);--wsf-error:var(--dsw-alias-state-error-primary,#d93f3f);--wsf-success:var(--dsw-alias-state-success-primary,#2f9e5b);--wsf-warn:var(--dsw-alias-state-warning-primary,#b8792b)}`;

    const scopeElements = (root) => `
${root} *{box-sizing:border-box}
${root} h2{font-size:18px;line-height:1.4;font-weight:600;margin:0}
${root} h3{font-size:15px;line-height:1.45;font-weight:600;margin:0;overflow-wrap:anywhere}
${root} p{margin:0}
${root} .wsf-head>p{margin:6px 0 0;font-size:13px;line-height:1.6;color:var(--wsf-muted)}
${root} .wsf-note{margin:8px 0 0;font-size:12.5px;line-height:1.6;color:var(--wsf-muted)}
${root} .wsf-warning{margin:10px 0 0;padding:8px 12px;border:.5px solid color-mix(in srgb,var(--wsf-warn) 36%,transparent);border-radius:var(--dsw-radius-md,12px);background:color-mix(in srgb,var(--wsf-warn) 9%,transparent);color:var(--wsf-fg);font-size:12.5px;line-height:1.55}
${root} .wsf-notice{margin:12px 0 0;padding:7px 11px;border:.5px solid var(--wsf-line);border-radius:var(--dsw-radius-sm,8px);background:var(--wsf-sunken);font-size:12.5px;line-height:1.55;overflow-wrap:anywhere}
${root} .wsf-notice[data-tone=success]{color:var(--wsf-success);border-color:color-mix(in srgb,var(--wsf-success) 34%,transparent);background:color-mix(in srgb,var(--wsf-success) 8%,transparent)}
${root} .wsf-notice[data-tone=error]{color:var(--wsf-error);border-color:color-mix(in srgb,var(--wsf-error) 34%,transparent);background:color-mix(in srgb,var(--wsf-error) 8%,transparent)}
${root} .wsf-status{margin:14px 0 0;font-size:13px;color:var(--wsf-muted)}
${root} .wsf-status[data-tone=error]{padding:10px 12px;border:.5px solid color-mix(in srgb,var(--wsf-error) 34%,transparent);border-radius:var(--dsw-radius-md,12px);background:color-mix(in srgb,var(--wsf-error) 7%,transparent)}
${root} .wsf-status[data-tone=error] .wsf-status-title{color:var(--wsf-fg);font-weight:600}
${root} .wsf-status[data-tone=error] .wsf-error-text{margin-top:3px;color:var(--wsf-error);overflow-wrap:anywhere}
${root} .wsf-status>button{margin-top:10px}
${root} .wsf-cards{margin-top:14px}
${root} .wsf-card{padding:10px 14px 12px;margin:0 0 10px;border:.5px solid var(--wsf-stroke);border-radius:var(--dsw-radius-xl,20px);background:var(--wsf-card)}
${root} .wsf-card:last-child{margin-bottom:0}
${root} .wsf-card-head{display:flex;align-items:center;gap:8px;min-height:26px}
${root} .wsf-badge{flex:none;font-size:11px;line-height:18px;padding:0 8px;border-radius:999px;border:.5px solid var(--wsf-line);background:var(--wsf-sunken);color:var(--wsf-subtle);white-space:nowrap}
${root} .wsf-count{flex:none;margin-left:auto;font-size:12px;color:var(--wsf-subtle);font-variant-numeric:tabular-nums}
${root} .wsf-hint{margin:3px 0 0;font-size:12.5px;line-height:1.55;color:var(--wsf-subtle)}
${root} .wsf-list{list-style:none;display:flex;flex-direction:column;gap:4px;margin:9px 0 0;padding:0}
${root} .wsf-row{display:flex;align-items:center;gap:8px;min-height:34px;padding:4px 5px 4px 10px;border:.5px solid transparent;border-radius:var(--dsw-radius-sm,8px);background:var(--wsf-sunken)}
${root} .wsf-row[data-static]{background:transparent;border-color:var(--wsf-line)}
${root} .wsf-path{flex:1;min-width:0;font:12.5px/1.5 ui-monospace,SFMono-Regular,Consolas,'Cascadia Mono',monospace;overflow-wrap:anywhere;color:var(--wsf-fg)}
${root} .wsf-row[data-static] .wsf-path{color:var(--wsf-muted)}
${root} .wsf-empty{margin:9px 0 0;font-size:12.5px;color:var(--wsf-subtle)}
${root} .wsf-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:10px}
${root} .wsf-manual{display:flex;flex:1 1 240px;gap:6px;min-width:0}
${root} .wsf-input{flex:1;min-width:0;min-height:32px;padding:5px 10px;font:inherit;font-size:13px;color:var(--wsf-fg);background:var(--wsf-control);border:.5px solid var(--wsf-line-strong);border-radius:var(--dsw-radius-sm,8px)}
${root} .wsf-input::placeholder{color:var(--wsf-subtle)}
${root} button{font:inherit;font-size:13px;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 12px;border:.5px solid var(--wsf-line-strong);border-radius:var(--dsw-radius-md,12px);background:transparent;color:var(--wsf-fg);cursor:pointer;white-space:nowrap;transition:background .15s,color .15s,border-color .15s}
${root} button:hover:enabled{background:var(--wsf-hover)}
${root} button:disabled{opacity:.4;cursor:not-allowed}
${root} button.wsf-primary{background:var(--dsw-alias-button-primary-fill,#0f1115);border-color:transparent;color:var(--dsw-alias-label-primary-foreground,#fff)}
${root} button.wsf-primary:hover:enabled{opacity:.86;background:var(--dsw-alias-button-primary-fill,#0f1115)}
${root} .wsf-remove{flex:none;height:26px;padding:0 9px;font-size:12px;border-radius:var(--dsw-radius-sm,8px);color:var(--wsf-muted)}
${root} .wsf-remove:hover:enabled{color:var(--wsf-error);border-color:color-mix(in srgb,var(--wsf-error) 40%,transparent);background:color-mix(in srgb,var(--wsf-error) 8%,transparent)}
${root} :focus-visible{outline:2px solid var(--wsf-accent);outline-offset:2px}`;

    // The page keeps its own layout on the root; the dialog brings its own below.
    const pageCss =
      `[data-wsf-page]{color:var(--wsf-fg);font:14px/1.55 var(--dsw-font-family,-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif);max-width:720px;box-sizing:border-box;padding:0 0 8px}` +
      scopeTokens('[data-wsf-page]') +
      scopeElements('[data-wsf-page]');

    /** Dialog-only rules: backdrop, panel, header, footer, workspace picker. */
    const dialogExtras = `
[data-wsf-dialog]{position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;padding:24px;background:color-mix(in srgb,#000 34%,transparent);color:var(--wsf-fg);font:14px/1.55 var(--dsw-font-family,-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif);pointer-events:auto}
[data-wsf-dialog] .wsf-dialog{display:flex;flex-direction:column;width:min(560px,100%);max-height:min(78vh,720px);border:.5px solid var(--wsf-stroke);border-radius:var(--dsw-radius-xl,20px);background:var(--wsf-card);box-shadow:0 18px 48px color-mix(in srgb,#000 28%,transparent);overflow:hidden}
[data-wsf-dialog] .wsf-dialog-head{display:flex;align-items:flex-start;gap:10px;padding:14px 12px 11px 16px;border-bottom:.5px solid var(--wsf-line)}
[data-wsf-dialog] .wsf-dialog-titles{flex:1;min-width:0}
[data-wsf-dialog] .wsf-dialog-title{font-size:15px;line-height:1.4;font-weight:600;margin:0;overflow-wrap:anywhere}
[data-wsf-dialog] .wsf-dialog-path{margin:3px 0 0;font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,'Cascadia Mono',monospace;color:var(--wsf-subtle);overflow-wrap:anywhere}
[data-wsf-dialog] .wsf-dialog-close{flex:none;width:26px;height:26px;padding:0;font-size:13px;border-color:transparent;color:var(--wsf-muted)}
[data-wsf-dialog] .wsf-dialog-body{flex:1;min-height:0;overflow:auto;padding:12px 16px 14px}
[data-wsf-dialog] .wsf-dialog-body .wsf-list{margin-top:0}
[data-wsf-dialog] .wsf-dialog-foot{padding:10px 16px 12px;border-top:.5px solid var(--wsf-line);background:var(--wsf-sunken)}
[data-wsf-dialog] .wsf-dialog-foot p{font-size:12px;line-height:1.55;color:var(--wsf-muted)}
[data-wsf-dialog] .wsf-dialog-tip{margin-top:6px;font-size:11.5px;color:var(--wsf-subtle)}
[data-wsf-dialog] .wsf-pick{margin-top:2px}
[data-wsf-dialog] .wsf-pick-list{list-style:none;display:flex;flex-direction:column;gap:6px;margin:10px 0 0;padding:0}
[data-wsf-dialog] .wsf-pick-item{display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:100%;height:auto;min-height:44px;padding:7px 10px;text-align:left;white-space:normal}
[data-wsf-dialog] .wsf-pick-title{font-size:13px;font-weight:600;color:var(--wsf-fg)}
[data-wsf-dialog] .wsf-pick-item .wsf-path{flex:none;width:100%;font-size:11.5px;color:var(--wsf-subtle)}`;

    /**
     * The trigger lives outside both scopes because it is injected into the
     * sidebar DOM, which React never rendered for us: the rules go into a <style>
     * element in <head> while the plugin is mounted and are removed on dispose.
     */
    const triggerCss = `
[data-wsf-manage]{position:absolute;top:50%;right:32px;transform:translateY(-50%);display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;margin:0;border:.5px solid transparent;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary,currentColor);cursor:pointer;opacity:0;pointer-events:none;transition:opacity .12s,background .12s,color .12s;z-index:2}
[data-wsf-manage] svg{display:block;width:14px;height:14px}
[data-wsf-manage]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.16));color:var(--dsw-alias-label-primary,currentColor)}
[data-wsf-manage]:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4176e6);outline-offset:1px;opacity:1;pointer-events:auto}
[class*="projectRow"]:hover [data-wsf-manage],[role="treeitem"]:hover [data-wsf-manage],[role="treeitem"]:focus-within [data-wsf-manage]{opacity:1;pointer-events:auto}
@media (prefers-reduced-motion:reduce){[data-wsf-manage]{transition:none}}`;

    // The dialog reuses the page's tokens and element rules plus its own extras.
    const dialogCss = scopeTokens('[data-wsf-dialog]') + scopeElements('[data-wsf-dialog]') + dialogExtras;

    /* ---------------------------------------------------------------- data */

    const folderList = (value) =>
      Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim() !== '') : [];

    const baseName = (path) => {
      const parts = String(path).split(/[\\/]+/).filter(Boolean);
      return parts.length ? parts[parts.length - 1] : String(path);
    };

    /** The page trusts the host shape but never trusts the array-ness of it. */
    const normalizeState = (payload) => ({
      global: folderList(payload && payload.global),
      home: payload && typeof payload.home === 'string' ? payload.home : '',
      workspaces: (Array.isArray(payload && payload.workspaces) ? payload.workspaces : [])
        .filter((entry) => entry && typeof entry.path === 'string' && entry.path !== '')
        .map((entry) => ({
          path: entry.path,
          title: typeof entry.title === 'string' && entry.title.trim() !== '' ? entry.title : baseName(entry.path),
          folders: folderList(entry.folders)
        }))
    });

    // A scope is either the global list or one registered workspace.
    const globalScope = { kind: 'global' };
    const workspaceScope = (path) => ({ kind: 'workspace', path });
    const scopeKey = (scope) => (scope.kind === 'global' ? 'global' : 'ws|' + scope.path);

    /** The exact body the host expects for both add and remove. */
    const requestBody = (scope, path) =>
      scope.kind === 'global' ? { scope: 'global', path } : { scope: 'workspace', workspace: scope.path, path };

    // The host also accepts a leading "~" and maps it to the home directory.
    const looksAbsolute = (value) =>
      /^[A-Za-z]:[\\/]/.test(value) || /^[\\/]{2}/.test(value) || value.startsWith('/') || value === '~' ||
      value.startsWith('~/') || value.startsWith('~\\');

    /**
     * One HTTP round trip. Resolves with the payload only when the host said `ok`,
     * otherwise throws an error carrying a `kind` so the page can word it.
     */
    const request = async (path, init) => {
      let response;
      try {
        response = await fetch(BASE + path, init);
      } catch (cause) {
        const error = new Error('network');
        error.kind = 'network';
        throw error;
      }
      let payload = null;
      try {
        payload = await response.json();
      } catch (cause) {
        payload = null;
      }
      if (payload && payload.ok === true) return payload;
      const message = payload && typeof payload.error === 'string' ? payload.error.trim() : '';
      const error = new Error(message || (response.status ? 'HTTP ' + response.status : 'request failed'));
      error.kind = message ? 'host' : 'http';
      throw error;
    };

    /** Wording for a failed round trip, shared by the page and the dialog. */
    const describeError = (t, error) => {
      if (error && error.kind === 'network') return t('networkError');
      const message = error && typeof error.message === 'string' ? error.message.trim() : '';
      if (error && error.kind === 'host' && message) return message;
      return t('requestFailed') + (message ? ' (' + message + ')' : '');
    };

    /**
     * Last known /state. The sidebar trigger has to answer "which workspace is
     * this row?" synchronously at click time, so it reads this cache; the dialog
     * itself always re-reads /state, and a successful read refreshes the cache for
     * the next click.
     */
    let stateCache = null;
    const loadState = async () => {
      stateCache = normalizeState(await request('/state'));
      return stateCache;
    };

    /* ---------------------------------------------------------------- parts */

    function FolderRow({ t, folder, busyKey, currentKey, onRemove }) {
      const busy = busyKey === currentKey;
      return h(
        'li',
        { className: 'wsf-row' },
        h('span', { className: 'wsf-path', title: folder }, folder),
        h(
          'button',
          {
            type: 'button',
            className: 'wsf-remove',
            disabled: busy,
            'aria-label': t('remove') + ': ' + folder,
            onClick: () => onRemove(folder)
          },
          busy ? t('working') : t('remove')
        )
      );
    }

    /**
     * One card: a scope title, its explanation, the folder rows (a workspace root
     * first, non-removable), and the two add affordances — the native picker and
     * a typed absolute path.
     */
    function FolderCard({
      t,
      title,
      hint,
      badge,
      keyPrefix,
      fieldId,
      folders,
      rootPath,
      emptyText,
      busy,
      draft,
      onDraftChange,
      onAddTyped,
      onPick,
      onRemove,
      inputRef
    }) {
      const pickKey = 'pick|' + keyPrefix;
      const addKey = 'add|' + keyPrefix;
      const picking = busy === pickKey;
      const rows = folders.map((folder) =>
        h(FolderRow, {
          key: folder,
          t,
          folder,
          busyKey: busy,
          currentKey: 'remove|' + keyPrefix + '|' + folder,
          onRemove
        })
      );
      const hasRows = Boolean(rootPath) || rows.length > 0;
      return h(
        'section',
        { className: 'wsf-card', 'aria-labelledby': keyPrefix + '-title' },
        h(
          'div',
          { className: 'wsf-card-head' },
          h('h3', { id: keyPrefix + '-title' }, title),
          badge ? h('span', { className: 'wsf-badge' }, badge) : null,
          folders.length > 0
            ? h('span', { className: 'wsf-count', 'aria-hidden': true }, String(folders.length))
            : null
        ),
        h('p', { className: 'wsf-hint' }, hint),
        hasRows
          ? h(
              'ul',
              { className: 'wsf-list' },
              rootPath
                ? h(
                    'li',
                    { className: 'wsf-row', 'data-static': true },
                    h(
                      'span',
                      { className: 'wsf-path', title: t('workspaceRoot') + ': ' + rootPath },
                      rootPath
                    ),
                    h('span', { className: 'wsf-badge' }, t('alwaysWritable'))
                  )
                : null,
              ...rows
            )
          : h('p', { className: 'wsf-empty' }, emptyText),
        h(
          'div',
          { className: 'wsf-actions' },
          h(
            'button',
            {
              type: 'button',
              className: 'wsf-primary',
              disabled: picking,
              onClick: onPick
            },
            picking ? t('working') : t('addFolder')
          ),
          h(
            'div',
            { className: 'wsf-manual' },
            h('input', {
              className: 'wsf-input',
              id: fieldId,
              type: 'text',
              value: draft,
              spellCheck: false,
              autoComplete: 'off',
              placeholder: t('pathPlaceholder'),
              'aria-label': t('pathPlaceholder'),
              ref: inputRef,
              onChange: (event) => onDraftChange(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  onAddTyped();
                }
              }
            }),
            h(
              'button',
              {
                type: 'button',
                className: 'wsf-add',
                disabled: busy === addKey,
                'aria-label': t('add') + (title ? ' — ' + title : ''),
                onClick: onAddTyped
              },
              busy === addKey ? t('working') : t('add')
            )
          )
        )
      );
    }

    /* ----------------------------------------------------------------- page */

    function FoldersPage({ t, as = 'section', idPrefix = 'wsf-page', pick }) {
      const tr = typeof t === 'function' ? t : (key) => key;
      const tRef = React.useRef(tr);
      const alive = React.useRef(true);
      const inputs = React.useRef({});

      const [phase, setPhase] = React.useState('loading');
      const [data, setData] = React.useState(null);
      const [loadError, setLoadError] = React.useState('');
      const [reloadToken, setReloadToken] = React.useState(0);
      const [notice, setNotice] = React.useState(null);
      const [busy, setBusy] = React.useState('');
      const [drafts, setDrafts] = React.useState({});

      React.useEffect(() => {
        tRef.current = tr;
      });

      React.useEffect(() => {
        alive.current = true;
        return () => {
          alive.current = false;
        };
      }, []);

      const describe = (error) => describeError(tRef.current, error);

      // Load once on mount; add/remove refresh the page from their own payload.
      React.useEffect(() => {
        let cancelled = false;
        setPhase('loading');
        setLoadError('');
        request('/state').then(
          (payload) => {
            if (cancelled) return;
            setData(normalizeState(payload));
            setPhase('ready');
          },
          (error) => {
            if (cancelled) return;
            setPhase('error');
            setLoadError(describe(error));
          }
        );
        return () => {
          cancelled = true;
        };
      }, [reloadToken]);

      // Retry from the error state: show the loading line immediately instead of
      // flashing the old error until the load effect above runs again.
      const retry = () => {
        setPhase('loading');
        setLoadError('');
        setReloadToken((token) => token + 1);
      };

      const focusInput = (scope) => {
        const node = inputs.current[scopeKey(scope)];
        if (node && typeof node.focus === 'function') node.focus();
      };

      const run = async (op, scope, folder) => {
        const key = scopeKey(scope);
        const busyKey = op === 'remove' ? 'remove|' + key + '|' + folder : 'add|' + key;
        setBusy(busyKey);
        setNotice(null);
        try {
          const payload = await request('/' + op, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(requestBody(scope, folder))
          });
          if (!alive.current) return;
          if (payload.state) {
            setData(normalizeState(payload.state));
            setPhase('ready');
          } else {
            // Defensive: a host that answers without the snapshot gets a reload.
            setReloadToken((token) => token + 1);
          }
          setLoadError('');
          setNotice({ tone: 'success', text: tr(op === 'add' ? 'added' : 'removed') });
          if (op === 'add') setDrafts((current) => ({ ...current, [key]: '' }));
        } catch (error) {
          if (alive.current) setNotice({ tone: 'error', text: describe(error) });
        } finally {
          if (alive.current) setBusy('');
        }
      };

      const pickAndAdd = async (scope) => {
        const key = scopeKey(scope);
        setBusy('pick|' + key);
        setNotice(null);
        let result;
        try {
          result = await pick();
        } catch (error) {
          if (!alive.current) return;
          setBusy('');
          setNotice({ tone: 'error', text: describe(error) });
          return;
        }
        if (!alive.current) return;
        setBusy('');
        if (!result || result.status === 'cancelled') return;
        if (result.status === 'failed') {
          setNotice({ tone: 'error', text: describe(result.error) });
          return;
        }
        if (result.status !== 'picked') {
          setNotice({ tone: 'error', text: tr('pickerUnavailable') });
          focusInput(scope);
          return;
        }
        await run('add', scope, result.path);
      };

      const addTyped = async (scope) => {
        const key = scopeKey(scope);
        const value = (drafts[key] || '').trim();
        if (!value) {
          setNotice({ tone: 'error', text: tr('emptyPath') });
          focusInput(scope);
          return;
        }
        if (!looksAbsolute(value)) {
          setNotice({ tone: 'error', text: tr('notAbsolute') });
          focusInput(scope);
          return;
        }
        await run('add', scope, value);
      };

      const card = (scope, options) => {
        const key = scopeKey(scope);
        return h(FolderCard, {
          key,
          t: tr,
          keyPrefix: key,
          fieldId: idPrefix + '-' + (scope.kind === 'global' ? 'global' : 'ws-' + options.index) + '-path',
          title: options.title,
          hint: options.hint,
          badge: options.badge,
          folders: options.folders,
          rootPath: options.rootPath,
          emptyText: options.emptyText,
          busy,
          draft: drafts[key] || '',
          onDraftChange: (value) => setDrafts((current) => ({ ...current, [key]: value })),
          onAddTyped: () => addTyped(scope),
          onPick: () => pickAndAdd(scope),
          onRemove: (folder) => run('remove', scope, folder),
          inputRef: (node) => {
            inputs.current[key] = node;
          }
        });
      };

      const ready = phase === 'ready' && data;

      return h(
        as,
        { className: 'wsf-page', 'data-wsf-page': true, 'aria-labelledby': idPrefix + '-title' },
        h('style', null, pageCss),
        h(
          'header',
          { className: 'wsf-head' },
          h('h2', { id: idPrefix + '-title' }, tr('title')),
          h('p', { className: 'wsf-intro' }, tr('intro')),
          h('p', { className: 'wsf-warning', role: 'note' }, tr('warning')),
          h('p', { className: 'wsf-note' }, tr('shellNote'))
        ),
        notice
          ? h(
              'p',
              {
                className: 'wsf-notice',
                'data-tone': notice.tone,
                role: notice.tone === 'error' ? 'alert' : 'status'
              },
              notice.text
            )
          : null,
        phase === 'loading' ? h('p', { className: 'wsf-status', role: 'status' }, tr('loading')) : null,
        phase === 'error'
          ? h(
              'div',
              { className: 'wsf-status', 'data-tone': 'error', role: 'alert' },
              h('p', { className: 'wsf-status-title' }, tr('loadFailed')),
              h('p', { className: 'wsf-error-text' }, loadError),
              h('button', { type: 'button', onClick: retry }, tr('retry'))
            )
          : null,
        ready
          ? h(
              'div',
              { className: 'wsf-cards' },
              card(globalScope, {
                index: 0,
                title: tr('globalTitle'),
                hint: tr('globalHint'),
                folders: data.global,
                rootPath: null,
                emptyText: tr('globalEmpty'),
                badge: null
              }),
              data.workspaces.length
                ? data.workspaces.map((workspace, index) =>
                    card(workspaceScope(workspace.path), {
                      index: index + 1,
                      title: workspace.title,
                      hint: tr('workspaceHint'),
                      folders: workspace.folders,
                      rootPath: workspace.path,
                      emptyText: tr('workspaceEmpty'),
                      badge: data.home && workspace.path === data.home ? tr('currentWorkspace') : null
                    })
                  )
                : h('p', { className: 'wsf-status' }, tr('noWorkspaces'))
            )
          : null
      );
    }

    /* -------------------------------------------------------- sidebar entry */

    /**
     * Why DOM injection: DSH has no slot for the left sidebar. The only sidebar
     * extension points are session-row and session-menu slots, and a workspace row
     * is neither, so the trigger has to be attached to the rows DSH already
     * rendered. This whole section is best-effort: when the sidebar is absent
     * (settings-only pages, another DSH build, changed markup) it finds no rows,
     * does nothing, and throws nothing.
     *
     * The observed markup (Chromium renderer, accessibility tree):
     *   <div role="tree">
     *     <div role="treeitem" class="<hash>_projectRow">deepseek</div>   <- decorate
     *     <div role="treeitem" class="<hash>_sessionRow">conversation</div> <- skip
     * The class hash changes between builds, so the CSS module class is matched
     * by substring, and the treeitem (not the inner div) is the row.
     */
    const ROW_QUERY = '[role="tree"] [class*="projectRow"]';

    const rowText = (value) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();

    /** "新建文件夹 (4)" — the full label first, then the label without a trailing count. */
    const titleVariants = (value) => {
      const text = rowText(value);
      if (!text) return [];
      const variants = [text];
      const stripped = text.replace(/\s*[（(]\s*\d+\s*[)）]\s*$/, '').trim();
      if (stripped && stripped !== text) variants.push(stripped);
      return variants;
    };

    /** Every label a row offers, most authoritative first. */
    const rowCandidates = (row) => {
      const values = [row && typeof row.textContent === 'string' ? row.textContent : ''];
      if (row && typeof row.getAttribute === 'function') {
        for (const name of ['aria-label', 'title', 'data-title']) {
          const value = row.getAttribute(name);
          if (value) values.push(value);
        }
      }
      const candidates = [];
      for (const value of values) {
        for (const candidate of titleVariants(value)) {
          if (candidates.indexOf(candidate) < 0) candidates.push(candidate);
        }
      }
      return candidates;
    };

    /**
     * Row label -> workspace in /state: the title is what the row renders, and the
     * folder name is the fallback for a renamed or truncated row.
     */
    const matchWorkspace = (state, candidates) => {
      const workspaces = state && Array.isArray(state.workspaces) ? state.workspaces : [];
      if (!workspaces.length || !candidates.length) return null;
      for (const candidate of candidates) {
        const hit = workspaces.find((workspace) => workspace.title === candidate);
        if (hit) return hit;
      }
      for (const candidate of candidates) {
        const lowered = candidate.toLowerCase();
        const hit = workspaces.find((workspace) => baseName(workspace.path).toLowerCase() === lowered);
        if (hit) return hit;
      }
      return null;
    };

    /**
     * Why a module-level store: the trigger is a plain DOM node inside the sidebar
     * (rendered by DSH's own React tree) while the dialog is a component in the
     * `shell.overlay` slot (a different React tree). They share no props, so the
     * smallest common bus is this external store, read with useSyncExternalStore.
     */
    const overlayStore = (() => {
      let snapshot = { open: false, path: '', label: '' };
      const listeners = new Set();
      const emit = () => {
        for (const listener of [...listeners]) {
          try {
            listener();
          } catch (error) {
            /* one broken subscriber must not silence the others */
          }
        }
      };
      return {
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        read() {
          return snapshot;
        },
        /** `path: ''` means "the row did not resolve" -> the dialog asks which workspace. */
        open(next) {
          const path = next && typeof next.path === 'string' ? next.path : '';
          const label = next && typeof next.label === 'string' ? next.label : '';
          if (snapshot.open && snapshot.path === path && snapshot.label === label) return;
          snapshot = { open: true, path, label };
          emit();
        },
        close() {
          if (!snapshot.open) return;
          snapshot = { open: false, path: '', label: '' };
          emit();
        }
      };
    })();

    /**
     * Decorates every workspace row with one hover button and keeps it there across
     * React re-renders (one MutationObserver on <body>, coalesced with rAF, plus a
     * late retry because the sidebar can mount after the plugin).
     * Returns a disposer that removes every button, the injected style, the
     * observer and both pending handles.
     */
    function startSidebarEntry({ t }) {
      const doc = typeof document === 'undefined' ? null : document;
      if (!doc || !doc.body || typeof doc.querySelectorAll !== 'function' || typeof doc.createElement !== 'function') {
        return () => {};
      }
      const ObserverCtor =
        typeof MutationObserver === 'function'
          ? MutationObserver
          : typeof window !== 'undefined' && typeof window.MutationObserver === 'function'
            ? window.MutationObserver
            : null;

      const buttons = new Map(); // row element -> { node, positioned }
      let observer = null;
      let styleNode = null;
      let frame = 0;
      let frameIsRaf = false;
      let retry = 0;
      let stopped = false;

      // The button has to look right before the overlay ever mounts, so its rules
      // are injected with the sidebar decoration rather than with the dialog.
      try {
        styleNode = doc.createElement('style');
        styleNode.setAttribute('data-wsf-manage-style', '');
        styleNode.textContent = triggerCss;
        (doc.head || doc.documentElement).appendChild(styleNode);
      } catch (error) {
        styleNode = null;
      }

      /** The row for a match: the treeitem when there is one, else the match itself. */
      const rowOf = (node) => {
        if (!node || node.nodeType !== 1) return null;
        if (typeof node.getAttribute === 'function' && node.getAttribute('role') === 'treeitem') return node;
        const item = typeof node.closest === 'function' ? node.closest('[role="treeitem"]') : null;
        return item || node;
      };

      // Session rows live in the same tree; they must stay untouched.
      const isSessionRow = (row) => /sessionRow/.test(String((row && row.className) || ''));

      /** Adds position:relative only when the row is statically positioned. */
      const anchor = (row) => {
        if (!row.style) return false;
        let position = '';
        try {
          const computed = typeof getComputedStyle === 'function' ? getComputedStyle(row) : null;
          position = computed && computed.position ? String(computed.position) : '';
        } catch (error) {
          position = '';
        }
        if (position && position !== 'static') return false;
        if (row.style.position) return false;
        row.style.position = 'relative';
        return true;
      };

      /** Tiny folder+ glyph, built node by node (no innerHTML anywhere). */
      const icon = () => {
        if (typeof doc.createElementNS !== 'function') return null;
        const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 16 16');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        const folder = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
        folder.setAttribute('d', 'M1.75 3.25h4.1l1.4 1.65h7v7.85H1.75z');
        folder.setAttribute('fill', 'none');
        folder.setAttribute('stroke', 'currentColor');
        folder.setAttribute('stroke-width', '1.3');
        folder.setAttribute('stroke-linejoin', 'round');
        const plus = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
        plus.setAttribute('d', 'M8 7.9v3.3M6.35 9.55h3.3');
        plus.setAttribute('fill', 'none');
        plus.setAttribute('stroke', 'currentColor');
        plus.setAttribute('stroke-width', '1.3');
        plus.setAttribute('stroke-linecap', 'round');
        svg.appendChild(folder);
        svg.appendChild(plus);
        return svg;
      };

      const openManager = (row) => {
        const candidates = rowCandidates(row);
        const open = (state) => {
          const match = matchWorkspace(state, candidates);
          overlayStore.open({
            path: match ? match.path : '',
            label: match ? match.title : candidates.length ? candidates[0] : ''
          });
        };
        if (stateCache) {
          open(stateCache);
          return;
        }
        // First click before /state ever landed: resolve, then open. A failed read
        // still opens the dialog, which words the error and offers the picker.
        loadState().then(open, () => open(null));
      };

      const createButton = (row) => {
        const label = rowCandidates(row)[0] || '';
        const text = t('manage') + (label ? ': ' + label : '');
        const node = doc.createElement('button');
        node.type = 'button';
        node.className = 'wsf-manage-trigger';
        node.setAttribute('data-wsf-manage', '');
        node.setAttribute('aria-label', text);
        node.title = text;
        const glyph = icon();
        if (glyph) node.appendChild(glyph);
        node.addEventListener('click', (event) => {
          // The row selects/navigates on click; the trigger must not.
          if (event && typeof event.preventDefault === 'function') event.preventDefault();
          if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
          openManager(row);
        });
        // Some rows react on press rather than click; keep the trigger opaque to
        // both so opening the manager never also switches the workspace.
        ['pointerdown', 'mousedown'].forEach((type) => {
          node.addEventListener(type, (event) => {
            if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
          });
        });
        row.appendChild(node);
        return node;
      };

      const sync = () => {
        if (stopped) return;
        let matches;
        try {
          matches = doc.querySelectorAll(ROW_QUERY);
          // The list container is not contractually role="tree"; the class
          // substring is the stable part, so fall back to it alone.
          if (!matches || matches.length === 0) matches = doc.querySelectorAll('[class*="projectRow"]');
        } catch (error) {
          return;
        }
        const seen = new Set();
        for (let index = 0; index < matches.length; index += 1) {
          const row = rowOf(matches[index]);
          if (!row || seen.has(row) || isSessionRow(row)) continue;
          seen.add(row);
          const entry = buttons.get(row);
          if (entry) {
            // React rebuilt the row and dropped our node: put it back, once.
            if (!entry.node || !entry.node.parentNode) row.appendChild(entry.node);
            continue;
          }
          // A row we just re-created may already carry a button from an old pass.
          if (typeof row.querySelector === 'function' && row.querySelector('[data-wsf-manage]')) continue;
          buttons.set(row, { node: createButton(row), positioned: anchor(row) });
        }
        // Drop rows that left the document; their buttons went with them.
        for (const row of [...buttons.keys()]) {
          if (typeof row.isConnected === 'boolean' && !row.isConnected) buttons.delete(row);
        }
      };

      const schedule = () => {
        if (stopped || frame) return;
        const run = () => {
          frame = 0;
          sync();
        };
        if (typeof requestAnimationFrame === 'function') {
          frameIsRaf = true;
          frame = requestAnimationFrame(run);
        } else {
          frameIsRaf = false;
          frame = setTimeout(run, 16);
        }
      };

      if (ObserverCtor) {
        try {
          observer = new ObserverCtor(schedule);
          observer.observe(doc.body, { childList: true, subtree: true });
        } catch (error) {
          observer = null;
        }
      }

      sync();
      // The sidebar can render after the plugin mounted; one late pass covers it.
      retry = setTimeout(() => {
        retry = 0;
        sync();
      }, 400);

      return () => {
        stopped = true;
        if (observer) {
          try {
            observer.disconnect();
          } catch (error) {
            /* already gone */
          }
          observer = null;
        }
        if (frame) {
          if (frameIsRaf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
          else clearTimeout(frame);
          frame = 0;
        }
        if (retry) {
          clearTimeout(retry);
          retry = 0;
        }
        for (const [row, entry] of buttons) {
          if (entry.node && entry.node.parentNode) entry.node.parentNode.removeChild(entry.node);
          if (entry.positioned && row.style) row.style.position = '';
        }
        buttons.clear();
        if (styleNode && styleNode.parentNode) styleNode.parentNode.removeChild(styleNode);
        styleNode = null;
      };
    }

    /* ------------------------------------------------------ dialog (overlay) */

    /**
     * The manager for one workspace, mounted in the `shell.overlay` slot. It reads
     * the shared store, so it never needs to know how it was opened.
     */
    function ManagerDialog(props) {
      const tr = typeof props.t === 'function' ? props.t : (key) => key;
      const pick = typeof props.pick === 'function' ? props.pick : null;
      const tRef = React.useRef(tr);
      const alive = React.useRef(true);
      const inputRef = React.useRef(null);

      const snap = React.useSyncExternalStore(overlayStore.subscribe, overlayStore.read, overlayStore.read);

      const [phase, setPhase] = React.useState('idle');
      const [data, setData] = React.useState(null);
      const [loadError, setLoadError] = React.useState('');
      const [reloadToken, setReloadToken] = React.useState(0);
      const [notice, setNotice] = React.useState(null);
      const [busy, setBusy] = React.useState('');
      const [draft, setDraft] = React.useState('');

      React.useEffect(() => {
        tRef.current = tr;
      });

      React.useEffect(() => {
        alive.current = true;
        return () => {
          alive.current = false;
        };
      }, []);

      const say = (key) => tRef.current(key);

      const focusInput = () => {
        const node = inputRef.current;
        if (node && typeof node.focus === 'function') node.focus();
      };

      const retry = () => {
        setPhase('loading');
        setLoadError('');
        setReloadToken((token) => token + 1);
      };

      // Never trust stale data: every open re-reads /state (and refreshes the cache
      // the sidebar trigger resolves against).
      React.useEffect(() => {
        if (!snap.open) {
          setPhase('idle');
          setData(null);
          setNotice(null);
          setDraft('');
          return undefined;
        }
        let cancelled = false;
        setPhase('loading');
        setLoadError('');
        setNotice(null);
        loadState().then(
          (state) => {
            if (cancelled) return;
            setData(state);
            setPhase('ready');
            // The trigger could not resolve its row (no cached /state yet): the row
            // label is still known, so try it against the state we just read.
            if (!snap.path && snap.label) {
              const match = matchWorkspace(state, titleVariants(snap.label));
              if (match) {
                overlayStore.open({ path: match.path, label: match.title });
                return;
              }
            }
            // The workspace disappeared from /state while the dialog was opening:
            // never leave an overlay pointing at nothing.
            if (snap.path && !state.workspaces.some((workspace) => workspace.path === snap.path)) {
              overlayStore.close();
            }
          },
          (error) => {
            if (cancelled) return;
            setPhase('error');
            setLoadError(describeError(tRef.current, error));
          }
        );
        return () => {
          cancelled = true;
        };
      }, [snap.open, snap.path, reloadToken]);

      // Esc closes; the listener only exists while the dialog is open.
      React.useEffect(() => {
        if (!snap.open || typeof document === 'undefined' || typeof document.addEventListener !== 'function') {
          return undefined;
        }
        const onKeyDown = (event) => {
          if (!event) return;
          const key = event.key || event.keyCode;
          if (key !== 'Escape' && key !== 'Esc' && key !== 27) return;
          if (typeof event.preventDefault === 'function') event.preventDefault();
          if (typeof event.stopPropagation === 'function') event.stopPropagation();
          overlayStore.close();
        };
        document.addEventListener('keydown', onKeyDown, true);
        return () => document.removeEventListener('keydown', onKeyDown, true);
      }, [snap.open]);

      const run = async (op, folder) => {
        const workspace = snap.path;
        if (!workspace) return;
        setBusy((op === 'remove' ? 'remove|' : 'add|') + folder);
        setNotice(null);
        try {
          const payload = await request('/' + op, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(requestBody(workspaceScope(workspace), folder))
          });
          if (!alive.current) return;
          if (payload.state) {
            stateCache = normalizeState(payload.state);
            setData(stateCache);
            setPhase('ready');
          } else {
            // Defensive: a host that answers without the snapshot gets a reload.
            setReloadToken((token) => token + 1);
          }
          setNotice({ tone: 'success', text: say(op === 'add' ? 'added' : 'removed') });
          if (op === 'add') setDraft('');
        } catch (error) {
          if (alive.current) setNotice({ tone: 'error', text: describeError(tRef.current, error) });
        } finally {
          if (alive.current) setBusy('');
        }
      };

      const pickAndAdd = async () => {
        if (!snap.path) return;
        if (!pick) {
          setNotice({ tone: 'error', text: say('pickerUnavailable') });
          focusInput();
          return;
        }
        setBusy('pick');
        setNotice(null);
        let result;
        try {
          result = await pick();
        } catch (error) {
          if (!alive.current) return;
          setBusy('');
          setNotice({ tone: 'error', text: describeError(tRef.current, error) });
          return;
        }
        if (!alive.current) return;
        setBusy('');
        if (!result || result.status === 'cancelled') return;
        if (result.status === 'failed') {
          setNotice({ tone: 'error', text: describeError(tRef.current, result.error) });
          return;
        }
        if (result.status !== 'picked') {
          setNotice({ tone: 'error', text: say('pickerUnavailable') });
          focusInput();
          return;
        }
        await run('add', result.path);
      };

      const addTyped = async () => {
        const value = String(draft || '').trim();
        if (!value) {
          setNotice({ tone: 'error', text: say('emptyPath') });
          focusInput();
          return;
        }
        if (!looksAbsolute(value)) {
          setNotice({ tone: 'error', text: say('notAbsolute') });
          focusInput();
          return;
        }
        await run('add', value);
      };

      if (!snap.open) return null;

      const ready = phase === 'ready' && data ? data : null;
      const target = ready && snap.path ? ready.workspaces.find((workspace) => workspace.path === snap.path) || null : null;
      const heading = target ? target.title : tr('pickWorkspace');

      const folderRows = target
        ? target.folders.map((folder) =>
            h(FolderRow, {
              key: folder,
              t: tr,
              folder,
              busyKey: busy,
              currentKey: 'remove|' + folder,
              onRemove: (value) => run('remove', value)
            })
          )
        : [];

      const picker = ready
        ? h(
            'div',
            { className: 'wsf-pick' },
            h('p', { className: 'wsf-hint' }, tr('pickWorkspaceHint')),
            ready.workspaces.length
              ? h(
                  'ul',
                  { className: 'wsf-pick-list' },
                  ready.workspaces.map((workspace) =>
                    h(
                      'li',
                      { key: workspace.path },
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'wsf-pick-item',
                          onClick: () => overlayStore.open({ path: workspace.path, label: workspace.title })
                        },
                        h('span', { className: 'wsf-pick-title' }, workspace.title),
                        h('span', { className: 'wsf-path' }, workspace.path)
                      )
                    )
                  )
                )
              : h('p', { className: 'wsf-empty' }, tr('noWorkspaces'))
          )
        : null;

      const current = target
        ? h(
            'div',
            null,
            notice
              ? h(
                  'p',
                  {
                    className: 'wsf-notice',
                    'data-tone': notice.tone,
                    role: notice.tone === 'error' ? 'alert' : 'status'
                  },
                  notice.text
                )
              : null,
            h(
              'ul',
              { className: 'wsf-list' },
              h(
                'li',
                { className: 'wsf-row', 'data-static': true },
                h(
                  'span',
                  { className: 'wsf-path', title: tr('workspaceRoot') + ': ' + target.path },
                  target.path
                ),
                h('span', { className: 'wsf-badge' }, tr('alwaysWritable'))
              ),
              ...folderRows
            ),
            target.folders.length ? null : h('p', { className: 'wsf-empty' }, tr('workspaceEmpty')),
            h(
              'div',
              { className: 'wsf-actions' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'wsf-primary',
                  disabled: busy === 'pick',
                  onClick: pickAndAdd
                },
                busy === 'pick' ? tr('working') : tr('addFolder')
              ),
              h(
                'div',
                { className: 'wsf-manual' },
                h('input', {
                  className: 'wsf-input',
                  type: 'text',
                  value: draft,
                  spellCheck: false,
                  autoComplete: 'off',
                  placeholder: tr('pathPlaceholder'),
                  'aria-label': tr('pathPlaceholder'),
                  ref: inputRef,
                  onChange: (event) => setDraft(event.target.value),
                  onKeyDown: (event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addTyped();
                    }
                  }
                }),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'wsf-add',
                    disabled: busy === 'add|' + draft.trim(),
                    'aria-label': tr('add') + (target ? ' — ' + target.title : ''),
                    onClick: addTyped
                  },
                  busy === 'add|' + draft.trim() ? tr('working') : tr('add')
                )
              )
            )
          )
        : null;

      const inner =
        phase === 'loading'
          ? h('p', { className: 'wsf-status', role: 'status' }, tr('loading'))
          : phase === 'error'
            ? h(
                'div',
                { className: 'wsf-status', 'data-tone': 'error', role: 'alert' },
                h('p', { className: 'wsf-status-title' }, tr('loadFailed')),
                h('p', { className: 'wsf-error-text' }, loadError),
                h('button', { type: 'button', onClick: retry }, tr('retry'))
              )
            : target
              ? current
              : picker;

      return h(
        'div',
        {
          className: 'wsf-backdrop',
          'data-wsf-dialog': true,
          onClick: (event) => {
            if (event && event.target === event.currentTarget) overlayStore.close();
          }
        },
        h('style', null, dialogCss),
        h(
          'div',
          {
            className: 'wsf-dialog',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-labelledby': 'wsf-dialog-title'
          },
          h(
            'div',
            { className: 'wsf-dialog-head' },
            h(
              'div',
              { className: 'wsf-dialog-titles' },
              h('h2', { id: 'wsf-dialog-title', className: 'wsf-dialog-title' }, heading),
              target
                ? h('p', { className: 'wsf-dialog-path' }, target.path)
                : snap.label
                  ? h('p', { className: 'wsf-dialog-path' }, snap.label)
                  : null
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'wsf-dialog-close',
                'aria-label': tr('close'),
                title: tr('close'),
                onClick: () => overlayStore.close()
              },
              '\u2715'
            )
          ),
          h('div', { className: 'wsf-dialog-body' }, inner),
          h(
            'div',
            { className: 'wsf-dialog-foot' },
            h('p', null, tr('dialogNote')),
            h('p', { className: 'wsf-dialog-tip' }, tr('dialogTip'))
          )
        )
      );
    }

    /* --------------------------------------------------------------- plugin */

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, dictionaries));
      const t = ctx.locale.bind ? ctx.locale.bind(NS) : (key) => key;

      // The native folder dialog lives in the workspace UI service; when this
      // build does not expose it the page silently keeps the typed-path input.
      let workspaceUI;
      ctx.inject(['uiWorkspace'], (owner) => {
        workspaceUI = owner.uiWorkspace;
        return () => {
          workspaceUI = undefined;
        };
      });

      /** Resolves how the folder dialog ended, never throws for "unavailable". */
      const pick = async () => {
        const service = workspaceUI;
        const pickDirectory = service && typeof service.pickDirectory === 'function' ? service.pickDirectory : null;
        if (!pickDirectory) return { status: 'unavailable' };
        let value;
        try {
          value = await pickDirectory.call(service);
        } catch (error) {
          return { status: 'failed', error };
        }
        return typeof value === 'string' && value.trim() !== ''
          ? { status: 'picked', path: value.trim() }
          : { status: 'cancelled' };
      };

      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'workspace-folders',
            order: 17,
            label: () => t('nav'),
            locale: NS,
            inject: () => ({ as: 'section', idPrefix: 'wsf-page', pick })
          },
          FoldersPage
        )
      );

      // The dialog is a first-class overlay; only its sidebar trigger has to be
      // injected. Both are mounted and disposed together: on a build without the
      // overlay slot there is nothing for a trigger to open, so it stays absent
      // and the settings page remains the only entry point.
      let stopSidebar = null;
      // Teardown is also owned by the plugin scope, so unloading the plugin cannot
      // leave a button behind even if the slot goes away without disposing first.
      // `startSidebarEntry`'s disposer is idempotent, so a second call is harmless.
      ctx.effect(() => () => {
        if (typeof stopSidebar === 'function') stopSidebar();
        stopSidebar = null;
      });

      ctx.slots.inject('shell.overlay', () => {
        let disposeOverlay = null;
        let disposeSidebar = null;
        try {
          disposeOverlay = ctx.slots.register(
            {
              name: 'shell.overlay',
              id: 'workspace-folders-dialog',
              order: 40,
              label: () => t('nav'),
              locale: NS,
              inject: () => ({ t, pick })
            },
            ManagerDialog
          );
        } catch (error) {
          return () => {};
        }
        try {
          disposeSidebar = startSidebarEntry({ t });
          stopSidebar = disposeSidebar;
        } catch (error) {
          disposeSidebar = null;
        }
        return () => {
          stopSidebar = null;
          if (typeof disposeSidebar === 'function') {
            try {
              disposeSidebar();
            } catch (error) {
              /* already gone */
            }
          }
          stateCache = null;
          if (typeof disposeOverlay === 'function') {
            try {
              disposeOverlay();
            } catch (error) {
              /* already gone */
            }
          }
        };
      });
    }

    return { apply, inject: ['slots', 'locale'] };
  }
});
