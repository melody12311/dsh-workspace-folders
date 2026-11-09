/**
 * dsh-workspace-folders — Host half.
 *
 * DSH gives every Session exactly one workspace boundary: the file sandbox lets
 * it write under the Session's cwd and nothing else, so work that spans
 * folders (`D:\AI工作区\deepseek` + `D:\AI工作区\other`) hits an approval prompt
 * on the first write, edit, move or shell command that crosses the line.
 *
 * This plugin owns a small durable list of extra writable folders — some for
 * every workspace, some for one registered workspace — and folds them into the
 * policy `ctx.sandboxPolicy.resolve()` returns for each capability call. That is
 * the one place the shipped tool layers consult before they enforce, so no
 * reload and no restart is needed and the change is visible to file tools,
 * patch tools and sandboxed shells at the same time.
 *
 * Responsibilities:
 *   1. one atomic JSON store under `<profile>/plugin-data/dsh-workspace-folders`
 *   2. per-call widening of `sandboxPolicy.resolve()` (wrapped, never replaced
 *      as a service, so an uninstall restores the shipped behaviour exactly)
 *   3. an ordered runtime-context line so the model knows which extra folders
 *      it may use without asking
 *   4. three exact HTTP routes the Settings page reads and mutates
 *
 * The store keeps folders that no longer exist so an unplugged drive is not
 * silently forgotten; enforcement and prompts only ever use folders that are
 * present on disk right now.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve as toAbsolute, sep } from 'node:path'

export const name = 'workspace-folders'

const PACKAGE = 'dsh-workspace-folders'
const ROUTE_BASE = '/dsh-workspace-folders'
const CONTEXT_NAME = 'workspace-folders'
// Presentation only: after the shipped workspace/environment facts, far from
// the low orders the repository prompt sections use.
const CONTEXT_ORDER = 733
const MAX_BODY_BYTES = 64 * 1024
const STATE_VERSION = 1

/* ------------------------------------------------------------------ store -- */

/** `<profile>/plugin-data/<package>`, the directory other plugins use too. */
function dataDirectory() {
  const profileDir = process.env.DSH_PROFILE_DIR
  if (profileDir) return join(profileDir, 'plugin-data', PACKAGE)
  const profile = process.env.DSH_PROFILE ?? 'desktop'
  return join(homedir(), '.dsh', 'profiles', profile, 'plugin-data', PACKAGE)
}

/**
 * Normalize one user-supplied folder to an absolute path without a trailing
 * separator. Returns undefined instead of throwing so the caller can report the
 * problem next to the field the user typed into.
 * @returns {{ path?: string, error?: string }}
 */
function normalizeFolder(input, label = 'path') {
  if (typeof input !== 'string') return { error: `${label} must be a string` }
  let raw = input.trim()
  if (raw.length >= 2 && (raw.startsWith('"') && raw.endsWith('"'))) raw = raw.slice(1, -1).trim()
  if (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2) raw = raw.slice(1, -1).trim()
  if (raw === '') return { error: `${label} is empty` }
  if (raw === '~' || raw.startsWith('~/') || raw.startsWith('~\\')) raw = join(homedir(), raw.slice(1))
  if (!isAbsolute(raw)) return { error: `${label} must be an absolute path: ${input}` }
  let absolute = toAbsolute(raw)
  // Keep a drive root (`D:\`) intact; drop trailing separators everywhere else.
  if (/^[A-Za-z]:[\\/]$/.test(absolute) || absolute === sep) return { path: absolute }
  absolute = absolute.replace(/[\\/]+$/, '')
  if (absolute === '') return { error: `${label} is not a directory: ${input}` }
  return { path: absolute }
}

/** Lowercased identity of a path, for case-insensitive Windows comparisons. */
function identity(path) {
  return path.replace(/[\\/]+$/, '').toLowerCase()
}

/** True when `child` is `parent` itself or lives below it. */
function isInside(child, parent) {
  const a = identity(child)
  const b = identity(parent)
  return a === b || a.startsWith(b.endsWith(sep) ? b : b + sep) || a.startsWith(`${b}/`)
}

function emptyState() {
  return { version: STATE_VERSION, global: [], workspaces: {} }
}

/** Accept whatever is on disk without trusting it: only absolute strings survive. */
function sanitizeState(value) {
  const state = emptyState()
  if (!value || typeof value !== 'object') return state
  const push = (list, target) => {
    if (!Array.isArray(list)) return
    for (const item of list) {
      const result = normalizeFolder(item)
      if (!result.path) continue
      if (target.some(existing => identity(existing) === identity(result.path))) continue
      target.push(result.path)
    }
  }
  push(value.global, state.global)
  if (value.workspaces && typeof value.workspaces === 'object') {
    for (const [key, list] of Object.entries(value.workspaces)) {
      const workspace = normalizeFolder(key, 'workspace')
      if (!workspace.path) continue
      const folders = []
      push(list, folders)
      if (folders.length) state.workspaces[workspace.path] = folders
    }
  }
  return state
}

function loadState(logger) {
  const file = join(dataDirectory(), 'folders.json')
  try {
    return sanitizeState(JSON.parse(readFileSync(file, 'utf8')))
  } catch (error) {
    if (error?.code !== 'ENOENT') logger?.warn?.('dsh-workspace-folders: could not read %s: %s', file, error?.message ?? error)
    return emptyState()
  }
}

function saveState(state, logger) {
  const dir = dataDirectory()
  const file = join(dir, 'folders.json')
  const temporary = join(dir, `folders.${process.pid}.tmp`)
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    renameSync(temporary, file)
    return true
  } catch (error) {
    logger?.warn?.('dsh-workspace-folders: could not save %s: %s', file, error?.message ?? error)
    return false
  }
}

/* ------------------------------------------------------------- resolution -- */

/**
 * The workspace entry whose folder contains `cwd`, preferring the longest
 * match so a workspace nested inside another one still wins.
 */
function workspaceKeyFor(state, cwd) {
  if (!cwd || typeof cwd !== 'string') return undefined
  let best
  for (const key of Object.keys(state.workspaces)) {
    if (!isInside(cwd, key)) continue
    if (!best || key.length > best.length) best = key
  }
  return best
}

/** Extra writable folders that apply to one Session cwd, deduped, existing only. */
function extraRootsFor(state, cwd) {
  const roots = new Map()
  const add = path => {
    const key = identity(path)
    if (!roots.has(key)) roots.set(key, path)
  }
  for (const path of state.global) add(path)
  const key = workspaceKeyFor(state, cwd)
  if (key) for (const path of state.workspaces[key] ?? []) add(path)
  return [...roots.values()].filter(path => {
    try {
      return statSync(path).isDirectory()
    } catch {
      return false
    }
  })
}

function dedupe(list) {
  const seen = new Map()
  for (const item of list) {
    if (typeof item !== 'string' || !item) continue
    const key = identity(item)
    if (!seen.has(key)) seen.set(key, item)
  }
  return [...seen.values()]
}

/* ------------------------------------------------------- workspace meaning -- */

/* Directories a workspace root always carries but nobody plans from. */
const IGNORED_ENTRIES = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', 'target',
  '__pycache__', '.venv', 'venv', 'env', '.next', '.nuxt', '.cache', '.turbo',
  '.idea', '.vscode', 'coverage', '.pnpm-store', 'obj', '.dart_tool',
])

/* Files that tell a reader what a root is and how it wants to be treated. */
const MARKER_FILES = [
  'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.cursorrules', '.github/copilot-instructions.md',
  'README.md', 'README', 'package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml',
  'pom.xml', 'build.gradle', 'Makefile', 'CMakeLists.txt', 'requirements.txt',
  'composer.json', 'Gemfile', 'mix.exs', 'deno.json', 'tsconfig.json',
]

const MAX_ROOT_ENTRIES = 40
const MAX_ROOTS = 16

function existingDirectory(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** The folder this session actually works in — its workspace root. */
function sessionCwdOf(agent, fallback) {
  try {
    const cwd = agent?.session?.header?.cwd ?? agent?.sessionCwd ?? agent?.cwd
    if (typeof cwd === 'string' && cwd) return cwd
  } catch {
    /* fall through */
  }
  return fallback
}

/** `main` on a branch, a short sha on a detached HEAD, undefined when not a repo. */
function gitBranchOf(root) {
  try {
    const head = readFileSync(join(root, '.git', 'HEAD'), 'utf8').trim()
    const match = /^ref:\s*refs\/heads\/(.+)$/.exec(head)
    return match ? match[1] : head.slice(0, 8)
  } catch {
    return undefined
  }
}

/** One root as a reader needs it: what lives here, how it is versioned, what governs it. */
function describeRoot(path, kind) {
  const root = { path, name: basename(path) || path, kind }
  try {
    const entries = readdirSync(path, { withFileTypes: true })
      .filter(entry => !IGNORED_ENTRIES.has(entry.name))
      .sort((left, right) => {
        if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1
        return left.name.localeCompare(right.name)
      })
    root.entries = entries.slice(0, MAX_ROOT_ENTRIES).map(entry => (entry.isDirectory() ? `${entry.name}/` : entry.name))
    root.entryCount = entries.length
  } catch (error) {
    root.entries = []
    root.entryCount = 0
    root.error = String(error?.message ?? error)
  }
  try {
    root.markers = MARKER_FILES.filter(name => existsSync(join(path, name)))
  } catch {
    root.markers = []
  }
  const branch = gitBranchOf(path)
  if (branch) root.git = branch
  return root
}

/** Every root this session owns, workspace folder first, then its extra roots. */
function rootsForSession(state, cwd) {
  const roots = []
  if (cwd && existingDirectory(cwd)) roots.push({ path: cwd, kind: 'workspace' })
  for (const path of extraRootsFor(state, cwd)) roots.push({ path, kind: 'extra' })
  return roots.slice(0, MAX_ROOTS)
}

/** Model-facing rendering of the root map. */
function renderRoots(roots, cwd) {
  if (!roots.length) {
    return `No workspace root could be resolved for this session (working directory: ${cwd ?? 'unknown'}).`
  }
  const lines = [`Workspace roots for this session (${roots.length}):`]
  roots.forEach((root, index) => {
    const facts = []
    if (root.git) facts.push(`git branch ${root.git}`)
    if (root.markers?.length) facts.push(root.markers.join(', '))
    lines.push(
      `${index + 1}. ${root.path} — ${root.kind === 'workspace' ? 'session workspace' : 'extra workspace root'}` +
        (facts.length ? ` [${facts.join(' | ')}]` : ''),
    )
    if (root.entries?.length) {
      const more = root.entryCount > root.entries.length ? ` …(+${root.entryCount - root.entries.length} more)` : ''
      lines.push(`   top level: ${root.entries.join(' ')}${more}`)
    }
    if (root.error) lines.push(`   unreadable: ${root.error}`)
  })
  lines.push('Read the roots that matter for the task before planning or editing.')
  return lines.join('\n')
}

/* ------------------------------------------------------------ prompt text -- */

/** Scope-neutral policy: true for every session and names no folder. */
const ROOTS_POLICY = [
  'A session can own more than one workspace root: its own workspace folder plus extra folders registered for that workspace.',
  'They are workspace roots of equal standing, not just extra write permissions. When a task may span them — several repositories, a shared library, generated assets — enumerate them with the `workspace_roots` tool first, then read the structure, README and AGENTS.md of every root that matters before planning, searching or editing.',
  'Use absolute paths for anything outside the session workspace, and keep changes consistent across roots that belong to the same project.',
].join('\n')

/** The precise root list for one session; registered in that agent's own scope. */
function sessionPromptText(state, cwd) {
  const extras = rootsForSession(state, cwd).filter(root => root.kind === 'extra')
  if (!extras.length) return ''
  const lines = ['This session has extra workspace roots besides its own workspace folder:']
  for (const root of extras) lines.push(`- ${root.path}`)
  lines.push(
    'Treat them as workspace roots of equal standing: when the task may involve them, list their contents and read the relevant README/AGENTS.md/manifests before planning. The `workspace_roots` tool returns every root with its top level, git branch and marker files.',
    'Read and write there with absolute paths; the file sandbox already allows it.',
  )
  return lines.join('\n')
}

/* ---------------------------------------------------------------- http ----- */

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload))
}

/**
 * Reject cross-site mutations. `Host` is the one header a hostile page cannot
 * forge, so a browser request must present an `Origin` whose host equals it;
 * non-browser callers without `Origin` may still declare a foreign
 * `Sec-Fetch-Site`, which is refused.
 */
function sameOrigin(request) {
  const host = String(request.headers.host ?? '').toLowerCase()
  const origin = request.headers.origin
  if (typeof origin === 'string' && origin !== '') {
    try {
      return new URL(origin).host.toLowerCase() === host
    } catch {
      return false
    }
  }
  const site = request.headers['sec-fetch-site']
  if (typeof site === 'string' && site !== '') return site === 'same-origin' || site === 'none'
  return true
}

function readJsonBody(request) {
  return new Promise(resolve => {
    let size = 0
    const chunks = []
    let settled = false
    const finish = value => {
      if (settled) return
      settled = true
      resolve(value)
    }
    request.on('data', chunk => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        finish({ error: 'request body too large' })
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (settled) return
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (text === '') return finish({ value: {} })
      try {
        const value = JSON.parse(text)
        if (!value || typeof value !== 'object' || Array.isArray(value)) return finish({ error: 'body must be a JSON object' })
        finish({ value })
      } catch {
        finish({ error: 'body is not valid JSON' })
      }
    })
    request.on('error', () => finish({ error: 'request stream failed' }))
  })
}

/* ------------------------------------------------------------------ plugin -- */

/** Read an optional service without letting a missing accessor break the caller. */
function serviceOf(ctx, key) {
  try {
    return typeof ctx.get === 'function' ? ctx.get(key) : undefined
  } catch {
    return undefined
  }
}

export function apply(ctx) {
  const logger = ctx.logger
  let state = loadState(logger)

  /** Snapshot for the Settings page: registered workspaces plus any key we keep. */
  const stateView = () => {
    const registry = serviceOf(ctx, 'workspaceRegistry')
    const rows = new Map()
    try {
      for (const workspace of registry?.list?.() ?? []) {
        if (typeof workspace?.path !== 'string' || workspace.path === '') continue
        rows.set(workspace.path, workspace.title ?? workspace.name ?? basename(workspace.path))
      }
    } catch (error) {
      logger?.warn?.('dsh-workspace-folders: workspace registry unavailable: %s', error?.message ?? error)
    }
    for (const key of Object.keys(state.workspaces)) {
      if (!rows.has(key)) rows.set(key, basename(key) || key)
    }
    const workspaces = [...rows.entries()]
      .map(([path, title]) => ({ path, title: String(title), folders: [...(state.workspaces[findKey(path)] ?? [])] }))
      .sort((left, right) => left.path.localeCompare(right.path))
    const workingDirectory = serviceOf(ctx, 'workingDirectory')
    let home = process.cwd()
    try {
      if (typeof workingDirectory?.defaultDirectory === 'string') home = workingDirectory.defaultDirectory
    } catch {
      /* keep the process cwd */
    }
    return { ok: true, global: [...state.global], workspaces, home }
  }

  /** Case-insensitive lookup of a stored workspace key. */
  const findKey = path => {
    if (typeof path !== 'string') return undefined
    const wanted = identity(path)
    return Object.keys(state.workspaces).find(key => identity(key) === wanted)
  }

  const commit = (next, note) => {
    state = next
    const saved = saveState(state, logger)
    if (!saved) return { ok: false, error: 'could not write the folder list' }
    logger?.info?.('dsh-workspace-folders: %s', note)
    return { ok: true, state: stateView() }
  }

  /**
   * Resolve the scope of one mutation request into a concrete target, or an
   * error string. Global scope ignores `workspace`; workspace scope requires an
   * absolute existing directory that we then always store canonically.
   */
  const targetOf = request => {
    const scope = request?.scope
    if (scope === 'global') return { scope: 'global' }
    if (scope === 'workspace') {
      const workspace = normalizeFolder(request.workspace, 'workspace')
      if (!workspace.path) return { error: workspace.error }
      try {
        if (!statSync(workspace.path).isDirectory()) return { error: `workspace is not a directory: ${workspace.path}` }
      } catch {
        return { error: `workspace does not exist: ${workspace.path}` }
      }
      return { scope: 'workspace', workspace: findKey(workspace.path) ?? workspace.path }
    }
    return { error: "scope must be 'global' or 'workspace'" }
  }

  const add = request => {
    const target = targetOf(request)
    if (target.error) return { ok: false, error: target.error }
    const folder = normalizeFolder(request.path)
    if (!folder.path) return { ok: false, error: folder.error }
    try {
      if (!statSync(folder.path).isDirectory()) return { ok: false, error: `not a directory: ${folder.path}` }
    } catch {
      return { ok: false, error: `folder does not exist: ${folder.path}` }
    }
    if (target.scope === 'global') {
      if (state.global.some(existing => identity(existing) === identity(folder.path))) {
        return { ok: false, error: `already added: ${folder.path}` }
      }
      return commit({ ...state, global: [...state.global, folder.path] }, `added global folder ${folder.path}`)
    }
    const current = state.workspaces[target.workspace] ?? []
    if (current.some(existing => identity(existing) === identity(folder.path))) {
      return { ok: false, error: `already added to this workspace: ${folder.path}` }
    }
    if (isInside(target.workspace, folder.path)) {
      return { ok: false, error: 'that folder already contains the workspace, so it is writable already' }
    }
    return commit(
      { ...state, workspaces: { ...state.workspaces, [target.workspace]: [...current, folder.path] } },
      `added ${folder.path} to workspace ${target.workspace}`,
    )
  }

  const remove = request => {
    const target = targetOf(request)
    if (target.error) return { ok: false, error: target.error }
    const folder = normalizeFolder(request.path)
    if (!folder.path) return { ok: false, error: folder.error }
    if (target.scope === 'global') {
      const next = state.global.filter(existing => identity(existing) !== identity(folder.path))
      if (next.length === state.global.length) return { ok: false, error: `not in the global list: ${folder.path}` }
      return commit({ ...state, global: next }, `removed global folder ${folder.path}`)
    }
    const current = state.workspaces[target.workspace] ?? []
    const next = current.filter(existing => identity(existing) !== identity(folder.path))
    if (next.length === current.length) return { ok: false, error: `not in this workspace: ${folder.path}` }
    const workspaces = { ...state.workspaces }
    if (next.length) workspaces[target.workspace] = next
    else delete workspaces[target.workspace]
    return commit({ ...state, workspaces }, `removed ${folder.path} from workspace ${target.workspace}`)
  }

  /* 1. Widen the per-call sandbox policy. The shipped tool layers call
   *    `resolve()` for every execution, so this single wrapper reaches file
   *    reads/writes, patches, deletes, moves and confined shells. */
  ctx.inject(['sandboxPolicy'], sandboxContext => {
    const service = sandboxContext.sandboxPolicy
    if (!service || typeof service.resolve !== 'function') return
    if (service.resolve.__workspaceFolders === true) return
    const original = service.resolve
    const patched = function resolveWithExtraRoots(request = {}) {
      const policy = original.call(service, request)
      try {
        if (!policy || policy.mode !== 'workspace-write') return policy
        const cwd = request?.session?.header?.cwd ?? policy.workspaceRoot
        const extra = extraRootsFor(state, cwd)
        if (!extra.length) return policy
        return { ...policy, additionalWritableRoots: dedupe([...(policy.additionalWritableRoots ?? []), ...extra]) }
      } catch (error) {
        logger?.warn?.('dsh-workspace-folders: could not widen the sandbox policy: %s', error?.message ?? error)
        return policy
      }
    }
    Object.defineProperty(patched, '__workspaceFolders', { value: true })
    service.resolve = patched
    return () => {
      if (service.resolve === patched) service.resolve = original
    }
  })

  /* 2. Keep confined shells working.
   *
   *    The Windows host confines a child process with ACLs and refuses a policy
   *    that carries extra writable roots at all ("Windows ACL confinement does
   *    not support additional writable directories"), which on its own would
   *    break every `pwsh` call as soon as one folder is configured. File tools
   *    are enforced in-process and do support the extra roots, so the shell is
   *    handed the plain workspace policy instead: strictly narrower, never
   *    wider, and the shell keeps running. */
  ctx.inject(['sandbox'], sandboxServiceContext => {
    const service = sandboxServiceContext.sandbox
    if (!service || typeof service.confine !== 'function') return
    if (service.confine.__workspaceFolders === true) return
    const original = service.confine
    const announced = new Set()
    const patched = function confineWithinWorkspace(argv, policy, signal) {
      try {
        const extra = policy?.additionalWritableRoots
        if (Array.isArray(extra) && extra.length > 0) {
          if (!announced.has(policy.workspaceRoot)) {
            announced.add(policy.workspaceRoot)
            logger?.info?.(
              'dsh-workspace-folders: this host cannot confine a shell with extra writable roots, so shell commands stay inside %s; file tools still use the configured folders',
              policy.workspaceRoot,
            )
          }
          return original.call(service, argv, { ...policy, additionalWritableRoots: undefined }, signal)
        }
      } catch (error) {
        logger?.warn?.('dsh-workspace-folders: could not adjust the shell policy: %s', error?.message ?? error)
      }
      return original.call(service, argv, policy, signal)
    }
    Object.defineProperty(patched, '__workspaceFolders', { value: true })
    service.confine = patched
    return () => {
      if (service.confine === patched) service.confine = original
    }
  })

  /* 3. The workspace policy, in every session: state the multi-root contract
   *    without naming folders, so no session learns another workspace's paths. */
  ctx.inject(['systemPrompt'], promptContext => {
    const service = promptContext.systemPrompt
    if (!service || typeof service.context !== 'function') return
    const dispose = service.context({
      name: CONTEXT_NAME,
      order: CONTEXT_ORDER,
      text: () => ROOTS_POLICY,
    })
    return () => dispose?.()
  })

  /* 4. Each session's own root list, registered into that agent's scope with
   *    the same name so it shadows the policy line above. A listener failure
   *    must never reject agent creation, so every step is contained. */
  const scopedRoots = new Map()
  const bindAgent = (agent, ownerContext) => {
    try {
      const id = agent?.id
      if (!id || scopedRoots.has(id)) return
      const service = ownerContext?.systemPrompt ?? agent?.ctx?.systemPrompt
      if (!service || typeof service.context !== 'function') return
      const cwd = sessionCwdOf(agent, undefined)
      if (!cwd) return
      const dispose = service.context({
        name: CONTEXT_NAME,
        order: CONTEXT_ORDER,
        text: () => sessionPromptText(state, cwd),
      })
      scopedRoots.set(id, dispose)
    } catch (error) {
      logger?.warn?.('dsh-workspace-folders: could not scope the root list for a session: %s', error?.message ?? error)
    }
  }
  const releaseAgent = id => {
    const dispose = scopedRoots.get(id)
    if (!dispose) return
    scopedRoots.delete(id)
    try {
      dispose()
    } catch {
      /* the owning scope may be gone already */
    }
  }
  ctx.on('agent/created', function (payload) {
    try {
      bindAgent(payload?.agent, this)
    } catch {
      /* never let prompt scoping reject agent creation */
    }
  })
  ctx.on('agent/disposed', payload => {
    try {
      releaseAgent(payload?.agent?.id)
    } catch {
      /* ignore */
    }
  })
  ctx.inject(['agents'], agentsContext => {
    // Sessions that were already live when this plugin loaded get the same
    // treatment; new ones arrive through `agent/created`.
    try {
      for (const agent of agentsContext.agents.list()) bindAgent(agent, agent?.ctx)
    } catch (error) {
      logger?.warn?.('dsh-workspace-folders: could not bind live sessions: %s', error?.message ?? error)
    }
    return () => {
      for (const id of [...scopedRoots.keys()]) releaseAgent(id)
    }
  })

  /* 5. The tool that makes "look at every root" a first-class, cheap step. */
  ctx.inject(['tools'], toolsContext => {
    const service = toolsContext.tools
    if (!service || typeof service.register !== 'function') return
    let disconnect
    try {
      disconnect = service.register({
        name: 'workspace_roots',
        description:
          'List every workspace root this session owns: the session workspace folder plus the extra folders registered for it, each with its top-level entries, git branch and marker files (AGENTS.md, README, manifests). Call it before planning work that may span several projects or repositories, then read the roots that matter.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        output: {
          schema: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'Rendered root map: paths, top level, version control and governing files.' },
              roots: { type: 'array', items: { type: 'object', additionalProperties: true } },
            },
            required: ['text'],
            additionalProperties: false,
          },
          render: (_args, value) => [
            { type: 'text', text: typeof value?.text === 'string' ? value.text : JSON.stringify(value ?? {}) },
          ],
        },
        timeoutMs: 15000,
        isConcurrencySafe: () => true,
        async execute(_args, exec) {
          const workingDirectory = serviceOf(ctx, 'workingDirectory')
          const fallback = typeof workingDirectory?.defaultDirectory === 'string' ? workingDirectory.defaultDirectory : undefined
          const cwd = sessionCwdOf(exec?.agent, fallback)
          const roots = rootsForSession(state, cwd).map(root => describeRoot(root.path, root.kind))
          return { text: renderRoots(roots, cwd), roots }
        },
      })
    } catch (error) {
      logger?.warn?.('dsh-workspace-folders: could not register the workspace_roots tool: %s', error?.message ?? error)
      return
    }
    return () => disconnect?.()
  })

  /* 6. Routes for the Settings page. */
  ctx.inject(['webServer'], webContext => {
    const server = webContext.webServer
    if (!server || typeof server.register !== 'function') return
    const disposers = []
    const route = (path, handler) => {
      const dispose = server.register({ kind: 'exact', path: `${ROUTE_BASE}${path}`, handler })
      disposers.push(dispose)
    }
    route('/state', (request, response) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return sendJson(response, 405, { ok: false, error: 'GET only' })
      }
      try {
        sendJson(response, 200, stateView())
      } catch (error) {
        sendJson(response, 500, { ok: false, error: String(error?.message ?? error) })
      }
    })
    const mutate = operation => async (request, response) => {
      if (request.method !== 'POST') return sendJson(response, 405, { ok: false, error: 'POST only' })
      if (!sameOrigin(request)) return sendJson(response, 403, { ok: false, error: 'cross-origin request refused' })
      const body = await readJsonBody(request)
      if (body.error) return sendJson(response, 400, { ok: false, error: body.error })
      let result
      try {
        result = operation(body.value)
      } catch (error) {
        result = { ok: false, error: String(error?.message ?? error) }
      }
      sendJson(response, result.ok ? 200 : 400, result)
    }
    route('/add', mutate(add))
    route('/remove', mutate(remove))
    return () => {
      for (const dispose of disposers.splice(0)) dispose()
    }
  })

  logger?.info?.(
    'dsh-workspace-folders: %d global folder(s), %d workspace(s) with extra folders',
    state.global.length,
    Object.keys(state.workspaces).length,
  )
}
