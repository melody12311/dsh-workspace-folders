// Standalone smoke test for the dsh-workspace-folders Host half.
// Runs the real module against a fake Cordis context: no DSH needed.
//   node plugins/dsh-workspace-folders/test/selftest.mjs
import { EventEmitter } from 'node:events'
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'

const root = join(os.tmpdir(), 'wfw-selftest')
rmSync(root, { recursive: true, force: true })
const profileDir = join(root, 'profile')
const extra = join(root, 'shared')
const otherWorkspace = join(root, 'ws-b')
const wsA = join(root, 'ws-a')
const outside = join(root, 'outside')
for (const dir of [profileDir, extra, otherWorkspace, wsA, outside]) mkdirSync(dir, { recursive: true })
writeFileSync(join(wsA, 'README.md'), '# ws-a\n')
mkdirSync(join(wsA, 'src'), { recursive: true })
mkdirSync(join(wsA, '.git'), { recursive: true })
writeFileSync(join(wsA, '.git', 'HEAD'), 'ref: refs/heads/main\n')

process.env.DSH_PROFILE_DIR = profileDir

const failures = []
const check = (label, condition, detail) => {
  if (condition) return console.log('  ok   ' + label)
  failures.push(label + (detail ? ` (${detail})` : ''))
  console.log('  FAIL ' + label + (detail ? ` (${detail})` : ''))
}

// --- fake Cordis context -------------------------------------------------
const logger = { info: () => {}, warn: m => console.log('  [warn] ' + String(m)), error: () => {} }
const services = new Map()
const routes = new Map()
const listeners = new Map()
const scopedContexts = []
let promptContext = null
let toolDefinition = null

const fakeCtx = {
  logger,
  get: key => services.get(key),
  on(event, listener) {
    listeners.set(event, listener)
    return () => listeners.delete(event)
  },
  inject(deps, callback) {
    for (const dep of deps) if (!services.has(dep)) return () => {}
    const scope = Object.fromEntries(deps.map(dep => [dep, services.get(dep)]))
    return callback({ ...fakeCtx, ...scope })
  },
}

// A session-scoped prompt registry: records what the plugin registers for one agent.
const actingContext = {
  systemPrompt: {
    context: spec => {
      scopedContexts.push(spec)
      return () => {
        const index = scopedContexts.indexOf(spec)
        if (index >= 0) scopedContexts.splice(index, 1)
      }
    },
  },
}

const policyService = {
  defaultMode: 'workspace-write',
  workspaceRoot: wsA,
  additionalWritableRoots: undefined,
  resolve(request = {}) {
    const session = request.session
    const workspaceRoot = session?.header?.cwd ?? wsA
    if (request.readOnlyTest) return { mode: 'read-only', workspaceRoot }
    return { mode: 'workspace-write', workspaceRoot }
  },
  overrideOf: () => undefined,
}
services.set('sandboxPolicy', policyService)
services.set('systemPrompt', {
  context: spec => {
    promptContext = spec
    return () => { promptContext = null }
  },
})
services.set('webServer', {
  register: ({ path, handler }) => {
    routes.set(path, handler)
    return () => routes.delete(path)
  },
  getOrigin: () => 'http://127.0.0.1:7635',
})
services.set('workspaceRegistry', {
  list: () => [
    { id: 'a', path: wsA, title: 'ws-a' },
    { id: 'b', path: otherWorkspace, title: 'ws-b' },
  ],
})
services.set('workingDirectory', { defaultDirectory: wsA })
services.set('agents', { list: () => [] })
services.set('tools', {
  register: definition => {
    toolDefinition = definition
    return () => { toolDefinition = null }
  },
})

// The real Windows host refuses any policy that carries extra roots; the plugin
// must strip them before the shell is confined.
const confinePolicies = []
services.set('sandbox', {
  confine: async (argv, policy) => {
    confinePolicies.push(policy)
    if (Array.isArray(policy?.additionalWritableRoots) && policy.additionalWritableRoots.length > 0) {
      throw new Error('Windows ACL confinement does not support additional writable directories; remove the extra grants or use a supported host')
    }
    return { argv: [...argv], enforcement: 'full', denialSignatures: [], runnerFailureRules: [] }
  },
})

// --- fake request/response ----------------------------------------------
function call(path, { method = 'GET', body, headers = {} } = {}) {
  const handler = routes.get('/dsh-workspace-folders' + path)
  if (!handler) throw new Error('no route ' + path)
  const req = new EventEmitter()
  req.method = method
  req.headers = { host: '127.0.0.1:7635', ...headers }
  req.destroy = () => {}
  let status = 0
  let payload = ''
  const res = {
    writeHead(code) { status = code; return this },
    end(text) { payload = String(text ?? '') },
  }
  const done = Promise.resolve(handler(req, res))
  if (body !== undefined) queueMicrotask(() => {
    req.emit('data', Buffer.from(JSON.stringify(body)))
    req.emit('end')
  })
  else queueMicrotask(() => req.emit('end'))
  return done.then(() => ({ status, json: payload ? JSON.parse(payload) : undefined }))
}

const sessionIn = cwd => ({ header: { cwd } })
const resolved = cwd => policyService.resolve({ session: sessionIn(cwd) })

const { apply, name } = await import(new URL('../index.js', import.meta.url).href)
console.log('plugin name:', name)
apply(fakeCtx)

console.log('\n1. baseline (nothing configured)')
check('resolve keeps the shipped policy', JSON.stringify(resolved(wsA)) === JSON.stringify({ mode: 'workspace-write', workspaceRoot: wsA }))
const policyText = promptContext.text()
check('policy text names the scanning tool', policyText.includes('workspace_roots'))
check('policy text leaks no folder path', !policyText.includes(extra) && !policyText.includes(wsA), policyText.slice(0, 80))
check('no session root list yet', scopedContexts.length === 0)
const initial = await call('/state')
check('GET /state ok', initial.status === 200 && initial.json.ok === true)
check('/state lists both registered workspaces', initial.json.workspaces.length === 2, JSON.stringify(initial.json.workspaces))

console.log('\n2. global folder')
const added = await call('/add', { method: 'POST', body: { scope: 'global', path: extra }, headers: { origin: 'http://127.0.0.1:7635' } })
check('POST /add 200', added.status === 200 && added.json.ok === true, JSON.stringify(added.json))
check('global list has the folder', added.json?.state?.global?.length === 1)
check('policy now carries the extra root for a session in ws-a', (resolved(wsA).additionalWritableRoots ?? []).includes(extra), JSON.stringify(resolved(wsA)))
check('policy carries it for an unrelated cwd too (global)', (resolved(outside).additionalWritableRoots ?? []).includes(extra))
listeners.get('agent/created').call(actingContext, { agent: { id: 'sess-a', session: { header: { cwd: wsA } } } })
const textA = scopedContexts.at(-1)?.text() ?? ''
check('session root list names the global folder', textA.includes(extra), textA)
check('session root list stays session-specific', !textA.includes(otherWorkspace))
check('policy line still leaks nothing after a change', !promptContext.text().includes(extra))
check('store persisted to disk', JSON.parse(readFileSync(join(profileDir, 'plugin-data', 'dsh-workspace-folders', 'folders.json'), 'utf8')).global.length === 1)

console.log('\n3. workspace-scoped folder')
const scoped = await call('/add', { method: 'POST', body: { scope: 'workspace', workspace: otherWorkspace, path: outside }, headers: { origin: 'http://127.0.0.1:7635' } })
check('POST /add workspace 200', scoped.status === 200 && scoped.json.ok === true, JSON.stringify(scoped.json))
check('session in ws-b sees it', (resolved(otherWorkspace).additionalWritableRoots ?? []).includes(outside))
check('session in ws-a does NOT see it', !(resolved(wsA).additionalWritableRoots ?? []).includes(outside))
check('session below ws-b (nested cwd) sees it', (resolved(join(otherWorkspace, 'nested', 'deep')).additionalWritableRoots ?? []).includes(outside))
listeners.get('agent/created').call(actingContext, { agent: { id: 'sess-b', session: { header: { cwd: otherWorkspace } } } })
const textB = scopedContexts.at(-1)?.text() ?? ''
check('ws-b session root list names its own folder', textB.includes(outside), textB)
const specA = scopedContexts[0]
check('ws-a session root list never names the ws-b folder', specA && !specA.text().includes(outside), specA?.text())

console.log('\n4. rejections')
const crossOrigin = await call('/add', { method: 'POST', body: { scope: 'global', path: outside }, headers: { origin: 'http://evil.example' } })
check('cross-origin POST refused with 403', crossOrigin.status === 403, String(crossOrigin.status))
const missing = await call('/add', { method: 'POST', body: { scope: 'global', path: join(root, 'nope') }, headers: { origin: 'http://127.0.0.1:7635' } })
check('missing folder rejected 400', missing.status === 400 && missing.json.ok === false)
const relative = await call('/add', { method: 'POST', body: { scope: 'global', path: 'relative/dir' }, headers: { origin: 'http://127.0.0.1:7635' } })
check('relative path rejected 400', relative.status === 400)
const duplicate = await call('/add', { method: 'POST', body: { scope: 'global', path: extra }, headers: { origin: 'http://127.0.0.1:7635' } })
check('duplicate rejected 400', duplicate.status === 400, JSON.stringify(duplicate.json))
const nestedWorkspace = await call('/add', { method: 'POST', body: { scope: 'workspace', workspace: wsA, path: root }, headers: { origin: 'http://127.0.0.1:7635' } })
check('folder containing the workspace rejected', nestedWorkspace.status === 400)
const badScope = await call('/add', { method: 'POST', body: { scope: 'nope', path: extra }, headers: { origin: 'http://127.0.0.1:7635' } })
check('bad scope rejected 400', badScope.status === 400)
const getOnAdd = await call('/add', { method: 'GET' })
check('GET on /add is 405', getOnAdd.status === 405)

console.log('\n5. removal')
const removed = await call('/remove', { method: 'POST', body: { scope: 'global', path: extra }, headers: { origin: 'http://127.0.0.1:7635' } })
check('remove 200', removed.status === 200 && removed.json.ok === true)
check('global list empty again', removed.json.state.global.length === 0)
check('policy no longer wide for ws-a', !(resolved(wsA).additionalWritableRoots ?? []).includes(extra))
const removedScoped = await call('/remove', { method: 'POST', body: { scope: 'workspace', workspace: otherWorkspace, path: outside }, headers: { origin: 'http://127.0.0.1:7635' } })
check('workspace entry dropped when its last folder goes', removedScoped.json.ok === true && removedScoped.json.state.workspaces.find(w => w.path === otherWorkspace).folders.length === 0)
check('session root list recomputes to empty after removal', (scopedContexts.at(-1)?.text() ?? '') === '')
check('policy line survives (it is scope-neutral)', promptContext.text().includes('workspace_roots'))
const removeMissing = await call('/remove', { method: 'POST', body: { scope: 'global', path: extra }, headers: { origin: 'http://127.0.0.1:7635' } })
check('removing an absent folder is 400', removeMissing.status === 400)

console.log('\n6. read-only mode is untouched')
await call('/add', { method: 'POST', body: { scope: 'global', path: extra }, headers: { origin: 'http://127.0.0.1:7635' } })
const ro = policyService.resolve({ session: sessionIn(wsA), readOnlyTest: true })
check('read-only policy keeps its mode and gains no roots', ro.mode === 'read-only' && ro.additionalWritableRoots === undefined, JSON.stringify(ro))
await call('/remove', { method: 'POST', body: { scope: 'global', path: extra }, headers: { origin: 'http://127.0.0.1:7635' } })

console.log('\n7. disappearing folder is dropped from enforcement, kept in the list')
const gone = join(root, 'unplugged')
mkdirSync(gone, { recursive: true })
await call('/add', { method: 'POST', body: { scope: 'global', path: gone }, headers: { origin: 'http://127.0.0.1:7635' } })
rmSync(gone, { recursive: true, force: true })
check('missing folder no longer reaches the policy', !(resolved(wsA).additionalWritableRoots ?? []).includes(gone))
const after = await call('/state')
check('but it stays in the saved list', after.json.global.includes(gone))
await call('/remove', { method: 'POST', body: { scope: 'global', path: gone }, headers: { origin: 'http://127.0.0.1:7635' } })

console.log('\n8. confined shell keeps working (Windows ACL confinement cannot take extra roots)')
await call('/add', { method: 'POST', body: { scope: 'global', path: extra }, headers: { origin: 'http://127.0.0.1:7635' } })
const widened = resolved(wsA)
check('file-tool policy still carries the extra root', (widened.additionalWritableRoots ?? []).includes(extra))
let confined
try {
  confined = await services.get('sandbox').confine(['pwsh.exe', '-Command', 'echo hi'], widened)
} catch (error) {
  confined = { error: String(error?.message) }
}
const lastShellPolicy = confinePolicies[confinePolicies.length - 1]
check('shell confinement did not throw', confined.error === undefined, confined.error)
check('shell got no extra roots', lastShellPolicy.additionalWritableRoots === undefined, JSON.stringify(lastShellPolicy))
check('shell kept its workspace boundary', lastShellPolicy.workspaceRoot === wsA, JSON.stringify(lastShellPolicy))
check('shell enforcement still reported', confined.enforcement === 'full', JSON.stringify(confined))
await call('/remove', { method: 'POST', body: { scope: 'global', path: extra }, headers: { origin: 'http://127.0.0.1:7635' } })

console.log('\n9. workspace_roots tool')
check('tool registered under its model-facing name', toolDefinition?.name === 'workspace_roots', String(toolDefinition?.name))
await call('/add', { method: 'POST', body: { scope: 'workspace', workspace: wsA, path: outside }, headers: { origin: 'http://127.0.0.1:7635' } })
const map = await toolDefinition.execute({}, { agent: { session: { header: { cwd: wsA } } } })
check('tool names the session workspace root', map.text.includes(wsA), map.text)
check('tool names the extra root', map.text.includes(outside))
check('tool describes every root', map.roots.length === 2, JSON.stringify(map.roots.map(root => root.path)))
check('tool marks which root is the workspace', map.roots[0].kind === 'workspace' && map.roots[1].kind === 'extra')
check('tool reports the top level of the workspace', map.roots[0].entries.includes('README.md') && map.roots[0].entries.includes('src/'), JSON.stringify(map.roots[0].entries))
check('tool drops build noise (node_modules/.git)', !map.roots[0].entries.includes('.git/') && !map.roots[0].entries.includes('node_modules/'))
check('tool reads the git branch', map.roots[0].git === 'main', String(map.roots[0].git))
check('tool lists marker files', map.roots[0].markers.includes('README.md'), JSON.stringify(map.roots[0].markers))
check('tool output renders as text content', toolDefinition.output.render({}, map)[0].text === map.text)
const noExtras = await toolDefinition.execute({}, { agent: { session: { header: { cwd: otherWorkspace } } } })
check('another workspace sees only its own root', noExtras.roots.length === 1 && noExtras.roots[0].path === otherWorkspace, JSON.stringify(noExtras.roots.map(root => root.path)))
await call('/remove', { method: 'POST', body: { scope: 'workspace', workspace: wsA, path: outside }, headers: { origin: 'http://127.0.0.1:7635' } })

console.log('')
if (failures.length) {
  console.log(`FAILED ${failures.length} check(s):`)
  for (const failure of failures) console.log(' - ' + failure)
  process.exitCode = 1
} else {
  console.log('ALL CHECKS PASSED')
}
