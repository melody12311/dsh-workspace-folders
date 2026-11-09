// Offline self-test for the browser half (client.js) of dsh-workspace-folders.
//
//   node plugins/dsh-workspace-folders/test/client-selftest.mjs
//
// The real client.js is loaded into a fake browser, so no DSH, no Chromium and no
// network are involved:
//   * linkedom         -> a real DOM (CSS selectors, events, style, isConnected)
//   * a tiny React     -> createElement + useState/useRef/useEffect/useSyncExternalStore
//   * a fake fetch     -> answers GET /state and POST /add|/remove in memory
//   * a fake Cordis ctx-> effect/inject/locale/slots, recording every disposer
// A tiny vDOM renderer walks the rendered tree, so handlers are invoked the way
// React would invoke them (props.onClick, props.onChange, props.onKeyDown).
//
// linkedom lives in the DSH profile; point WSF_LINKEDOM elsewhere if needed.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const clientPath = join(here, '..', 'client.js')
const clientSource = readFileSync(clientPath, 'utf8')

/* ----------------------------------------------------------- linkedom */

const linkedomCandidates = [
  process.env.WSF_LINKEDOM,
  'C:/Users/53148/.dsh/profiles/desktop/node_modules/linkedom/esm/index.js',
  'linkedom'
].filter(Boolean)

let parseHTML = null
for (const candidate of linkedomCandidates) {
  try {
    const specifier = /^[A-Za-z]:[\\/]/.test(candidate) || candidate.startsWith('/')
      ? pathToFileURL(candidate).href
      : candidate
    ;({ parseHTML } = await import(specifier))
    break
  } catch (error) {
    /* try the next candidate */
  }
}
if (typeof parseHTML !== 'function') {
  console.error('FAIL: linkedom not found. Set WSF_LINKEDOM to its esm/index.js path.')
  process.exit(1)
}

/* -------------------------------------------------------------- React */

/**
 * The five hooks client.js uses, plus a renderer that builds an inspectable tree
 * instead of DOM nodes. Effects run after each full render, like React commits.
 */
const React = (() => {
  let current = null // instance being rendered

  const flatten = (items, out = []) => {
    for (const item of items) {
      if (Array.isArray(item)) flatten(item, out)
      else if (item !== null && item !== undefined && item !== false && item !== true) out.push(item)
    }
    return out
  }

  const createElement = (type, config, ...children) => {
    const props = { ...(config || {}) }
    props.children = flatten(children)
    return { type, props }
  }

  const useState = (initial) => {
    const instance = current
    const index = instance.index++
    if (!(index in instance.hooks)) {
      instance.hooks[index] = { value: typeof initial === 'function' ? initial() : initial }
    }
    const slot = instance.hooks[index]
    const setValue = (next) => {
      const value = typeof next === 'function' ? next(slot.value) : next
      if (Object.is(value, slot.value)) return
      slot.value = value
      instance.host.dirty = true
    }
    return [slot.value, setValue]
  }

  const useRef = (initial) => {
    const instance = current
    const index = instance.index++
    if (!(index in instance.hooks)) instance.hooks[index] = { current: initial }
    return instance.hooks[index]
  }

  const useEffect = (fn, deps) => {
    const instance = current
    const index = instance.index++
    const previous = instance.hooks[index]
    const unchanged =
      previous &&
      Array.isArray(previous.deps) &&
      Array.isArray(deps) &&
      deps.length === previous.deps.length &&
      deps.every((dep, position) => Object.is(dep, previous.deps[position]))
    instance.hooks[index] = { deps, cleanup: previous ? previous.cleanup : undefined }
    if (!unchanged) {
      instance.host.effects.push({ instance, index, fn, cleanup: previous ? previous.cleanup : undefined })
    }
  }

  const useSyncExternalStore = (subscribe, getSnapshot) => {
    const value = getSnapshot()
    const instance = current
    const index = instance.index++
    instance.hooks[index] = { value }
    useEffect(() => subscribe(() => {
      instance.host.dirty = true
    }), [subscribe])
    return value
  }

  const renderNode = (element, path, host) => {
    if (element === null || element === undefined || element === false || element === true) return null
    if (typeof element === 'string' || typeof element === 'number') return { text: String(element) }

    const { type, props } = element
    if (typeof type === 'function') {
      let instance = host.instances.get(path)
      if (!instance || instance.type !== type) {
        instance = { type, host, hooks: [], index: 0, props: {} }
        host.instances.set(path, instance)
      }
      instance.props = props
      instance.index = 0
      const previous = current
      current = instance
      let output
      try {
        output = type(props)
      } finally {
        current = previous
      }
      return { component: type, props, node: renderNode(output, path + '/', host) }
    }

    const children = []
    const list = Array.isArray(props.children) ? props.children : []
    for (let index = 0; index < list.length; index += 1) {
      const child = list[index]
      const key = child && typeof child === 'object' && child.props && child.props.key != null
        ? 'k:' + String(child.props.key)
        : 'i:' + index
      children.push(renderNode(child, path + '/' + key, host))
    }
    return { type, props, children }
  }

  const createRoot = (type, props) => {
    const host = { instances: new Map(), effects: [], dirty: false }
    const root = {
      tree: null,
      render() {
        host.dirty = false
        host.effects = []
        root.tree = renderNode({ type, props: { ...(props || {}), children: [] } }, 'root', host)
        const jobs = host.effects
        host.effects = []
        for (const job of jobs) {
          if (typeof job.cleanup === 'function') {
            try {
              job.cleanup()
            } catch (error) {
              /* ignore */
            }
          }
          let cleanup
          try {
            cleanup = job.fn()
          } catch (error) {
            cleanup = undefined
          }
          const slot = job.instance.hooks[job.index]
          if (slot) slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined
        }
        return root.tree
      },
      flush() {
        root.render()
        let guard = 0
        while (host.dirty && guard < 40) {
          guard += 1
          root.render()
        }
        return root.tree
      },
      unmount() {
        for (const instance of host.instances.values()) {
          for (const hook of instance.hooks) {
            if (hook && typeof hook.cleanup === 'function') {
              try {
                hook.cleanup()
              } catch (error) {
                /* ignore */
              }
              hook.cleanup = undefined
            }
          }
        }
        host.instances.clear()
        root.tree = null
      }
    }
    return root
  }

  return { createElement, useState, useRef, useEffect, useSyncExternalStore, createRoot }
})()

/* ------------------------------------------------------ tree utilities */

const walk = (node, visit) => {
  if (!node) return
  visit(node)
  if (Array.isArray(node.children)) for (const child of node.children) walk(child, visit)
  if (node.node) walk(node.node, visit)
}

const findAll = (root, predicate) => {
  const out = []
  walk(root, (node) => {
    if (predicate(node)) out.push(node)
  })
  return out
}

const textOf = (node) => {
  if (!node) return ''
  if (typeof node.text === 'string') return node.text
  let out = ''
  if (Array.isArray(node.children)) for (const child of node.children) out += textOf(child)
  if (node.node) out += textOf(node.node)
  return out
}

const byClass = (root, className) =>
  findAll(root, (node) => node.props && node.props.className === className)
const buttonWithText = (root, text) =>
  findAll(root, (node) => node.type === 'button' && textOf(node).trim() === text)[0] || null
const buttonWithAria = (root, label) =>
  findAll(root, (node) => node.type === 'button' && node.props && node.props['aria-label'] === label)[0] || null
const inputOf = (root) => findAll(root, (node) => node.type === 'input')[0] || null
const headingOf = (root) => findAll(root, (node) => node.type === 'h2')[0] || null
const dialogOf = (root) => findAll(root, (node) => node.props && node.props['data-wsf-dialog'])[0] || null

/* --------------------------------------------------- browser-ish globals */

const observers = []
class FakeMutationObserver {
  constructor(callback) {
    this.callback = callback
    this.active = false
    this.target = null
    this.options = null
    observers.push(this)
  }
  observe(target, options) {
    this.target = target
    this.options = options
    this.active = true
  }
  disconnect() {
    this.active = false
  }
  takeRecords() {
    return []
  }
}

let frames = []
let frameId = 0
const requestAnimationFrame = (fn) => {
  frameId += 1
  frames.push({ id: frameId, fn })
  return frameId
}
const cancelAnimationFrame = (id) => {
  frames = frames.filter((frame) => frame.id !== id)
}
const flushFrames = () => {
  const pending = frames
  frames = []
  for (const frame of pending) frame.fn()
}

const realSetTimeout = globalThis.setTimeout
const realClearTimeout = globalThis.clearTimeout
const pendingTimers = new Set()
globalThis.setTimeout = (fn, delay, ...args) => {
  const id = realSetTimeout(() => {
    pendingTimers.delete(id)
    fn(...args)
  }, delay)
  pendingTimers.add(id)
  return id
}
globalThis.clearTimeout = (id) => {
  pendingTimers.delete(id)
  return realClearTimeout(id)
}
globalThis.MutationObserver = FakeMutationObserver
globalThis.requestAnimationFrame = requestAnimationFrame
globalThis.cancelAnimationFrame = cancelAnimationFrame
globalThis.getComputedStyle = () => ({ position: 'static' })

const tick = () => new Promise((resolve) => setImmediate(resolve))

/** Render, let every pending promise settle, render again — repeat. */
const settle = async (root, rounds = 6) => {
  for (let round = 0; round < rounds; round += 1) {
    root.flush()
    await tick()
  }
  root.flush()
  return root.tree
}

/* ------------------------------------------------------------- fixtures */

const SIDEBAR_HTML = `
<div id="root">
  <div role="tree" class="wnFoaW_tree">
    <div role="treeitem" class="wnFoaW_projectRow">deepseek</div>
    <div role="treeitem" class="wnFoaW_sessionRow">a conversation</div>
    <div role="treeitem" class="wnFoaW_folder"><div class="wnFoaW_projectRow">新建文件夹 (4)</div></div>
    <div role="treeitem" class="wnFoaW_projectRow">ghost workspace</div>
  </div>
</div>`

const makeDom = (html) => parseHTML('<!doctype html><html><head></head><body>' + html + '</body></html>')

const makeHost = () => ({
  global: ['D:\\shared'],
  home: 'D:\\ws\\deepseek',
  workspaces: [
    { path: 'D:\\ws\\deepseek', title: 'deepseek', folders: [] },
    { path: 'D:\\ws\\other', title: '新建文件夹 (4)', folders: ['D:\\libs'] }
  ]
})

const makeFetch = (host) => {
  const calls = []
  const snapshot = () => ({
    global: [...host.global],
    home: host.home,
    workspaces: host.workspaces.map((workspace) => ({
      path: workspace.path,
      title: workspace.title,
      folders: [...workspace.folders]
    }))
  })
  const respond = (payload, status = 200) => ({ ok: status < 400, status, json: async () => payload })
  const listFor = (body) => {
    if (body && body.scope === 'global') return host.global
    const workspace = host.workspaces.find((entry) => entry.path === body.workspace)
    return workspace ? workspace.folders : null
  }
  const fetchImpl = async (url, init) => {
    const method = (init && init.method) || 'GET'
    const body = init && typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ url, method, body })
    if (host.failState) throw new Error('network down')
    if (url === '/dsh-workspace-folders/state') return respond({ ok: true, ...snapshot() })
    if (url === '/dsh-workspace-folders/add' && method === 'POST') {
      const list = listFor(body)
      if (!list) return respond({ ok: false, error: 'unknown workspace' }, 400)
      if (!list.includes(body.path)) list.push(body.path)
      return respond({ ok: true, state: snapshot() })
    }
    if (url === '/dsh-workspace-folders/remove' && method === 'POST') {
      const list = listFor(body)
      if (!list) return respond({ ok: false, error: 'unknown workspace' }, 400)
      const index = list.indexOf(body.path)
      if (index >= 0) list.splice(index, 1)
      return respond({ ok: true, state: snapshot() })
    }
    return respond({ ok: false, error: 'unknown route ' + url }, 404)
  }
  fetchImpl.calls = calls
  return fetchImpl
}

/**
 * Evaluates the real client.js and applies it to a fake Cordis context. A fresh
 * evaluation per call means fresh module state too (the overlay store lives there).
 */
const boot = ({ document, host = makeHost(), picker = null, withPicker = true, lang = 'zh' } = {}) => {
  const record = {
    module: null,
    id: '',
    namespace: '',
    dictionaries: null,
    injectedSlots: [],
    slots: [],
    disposers: [],
    effectDisposers: [],
    t: null,
    fetch: makeFetch(host),
    host,
    document
  }
  const require = (name) => {
    if (name === 'react') return React
    throw new Error('client.js required an unexpected module: ' + name)
  }
  const loader = {
    load(definition) {
      record.id = definition.id
      record.module = definition.factory(require)
    }
  }
  const evaluate = new Function('window', 'document', 'fetch', 'require', clientSource)
  evaluate({ __ModuleLoader__: loader }, document, record.fetch)
  if (!record.module) throw new Error('window.__ModuleLoader__.load was never called')

  const t = (key) => {
    const dictionary = record.dictionaries && record.dictionaries[lang]
    return (dictionary && dictionary[key]) || key
  }

  const ctx = {
    effect(fn) {
      const dispose = fn()
      if (typeof dispose === 'function') {
        record.disposers.push(dispose)
        record.effectDisposers.push(dispose)
      }
      return dispose
    },
    inject(deps, callback) {
      if (!withPicker) return () => {}
      if (!deps.includes('uiWorkspace') || !picker) return () => {}
      const dispose = callback({ uiWorkspace: picker })
      if (typeof dispose === 'function') record.disposers.push(dispose)
      return dispose
    },
    locale: {
      register(namespace, dictionaries) {
        record.namespace = namespace
        record.dictionaries = dictionaries
        return () => {
          record.dictionaries = null
        }
      },
      bind() {
        return t
      }
    },
    slots: {
      inject(name, callback) {
        record.injectedSlots.push(name)
        const dispose = callback()
        if (typeof dispose === 'function') record.disposers.push(dispose)
        return dispose
      },
      register(spec, component) {
        const entry = { spec, component }
        record.slots.push(entry)
        return () => {
          const index = record.slots.indexOf(entry)
          if (index >= 0) record.slots.splice(index, 1)
        }
      }
    }
  }

  record.module.apply(ctx)
  record.t = t
  return record
}

const slotEntry = (record, name) => record.slots.find((entry) => entry.spec.name === name) || null
const slotProps = (record, name) => {
  const entry = slotEntry(record, name)
  if (!entry) return {}
  const props = entry.spec.inject()
  // A slot registered with `locale` receives the bound translator as a prop; the
  // real slot host does that, so the harness has to as well.
  if (entry.spec.locale && typeof props.t !== 'function') props.t = record.t
  return props
}
const buttonsOn = (document) => [...document.querySelectorAll('[data-wsf-manage]')]
const click = (window, node) => {
  const event = new window.Event('click', { bubbles: true, cancelable: true })
  node.dispatchEvent(event)
  return event
}
const pressKey = (window, document, key) => {
  const event = new window.Event('keydown', { bubbles: true, cancelable: true })
  event.key = key
  document.dispatchEvent(event)
  return event
}
const notifyMutation = () => {
  for (const observer of observers) if (observer.active) observer.callback([])
  flushFrames()
}
const disposeAll = (record) => {
  for (const dispose of [...record.disposers]) {
    try {
      dispose()
    } catch (error) {
      /* ignore */
    }
  }
  record.disposers.length = 0
}

/* --------------------------------------------------------------- checks */

const failures = []
const check = (label, condition, detail) => {
  if (condition) {
    console.log('  ok   ' + label)
    return
  }
  failures.push(label + (detail === undefined ? '' : ' (' + detail + ')'))
  console.log('  FAIL ' + label + (detail === undefined ? '' : ' (' + detail + ')'))
}

let zh = null

/* 1 ------------------------------------------------------------------ */
console.log('\n1. registration, dictionary parity, stylesheet scopes')
{
  const dom = makeDom('<div id="app"></div>')
  const record = boot({ document: dom.document })
  zh = record.dictionaries && record.dictionaries.zh
  const en = record.dictionaries && record.dictionaries.en

  check('module id', record.id === 'dsh-workspace-folders', record.id)
  check(
    'module inject list',
    JSON.stringify(record.module.inject) === JSON.stringify(['slots', 'locale']),
    JSON.stringify(record.module.inject)
  )
  check('locale namespace', record.namespace === 'workspaceFolders', record.namespace)
  check('both dictionaries registered', Boolean(zh) && Boolean(en))

  const zhKeys = Object.keys(zh || {}).sort()
  const enKeys = Object.keys(en || {}).sort()
  check('dictionary key sets identical', JSON.stringify(zhKeys) === JSON.stringify(enKeys))
  const missingInEn = zhKeys.filter((key) => !enKeys.includes(key))
  const missingInZh = enKeys.filter((key) => !zhKeys.includes(key))
  check(
    'no key missing on either side',
    missingInEn.length === 0 && missingInZh.length === 0,
    JSON.stringify({ missingInEn, missingInZh })
  )
  const blank = [...zhKeys, ...enKeys].filter(
    (key) => !String((zh || {})[key] || '').trim() || !String((en || {})[key] || '').trim()
  )
  check('every key has text in both languages', blank.length === 0, JSON.stringify(blank))
  console.log('       dictionary keys per language: ' + zhKeys.length + ' (29 settings-page keys + 6 sidebar keys)')

  check('settings slot injected', record.injectedSlots.includes('settings.section'), JSON.stringify(record.injectedSlots))
  check('overlay slot injected', record.injectedSlots.includes('shell.overlay'), JSON.stringify(record.injectedSlots))
  const settingsSlot = slotEntry(record, 'settings.section')
  const overlaySlot = slotEntry(record, 'shell.overlay')
  check(
    'settings section id/order kept',
    settingsSlot.spec.id === 'workspace-folders' && settingsSlot.spec.order === 17,
    JSON.stringify(settingsSlot.spec)
  )
  check(
    'overlay dialog id/order',
    overlaySlot.spec.id === 'workspace-folders-dialog' && overlaySlot.spec.order === 40,
    JSON.stringify(overlaySlot.spec)
  )

  // The two roots share tokens but must not leak rules into each other.
  const settingsRoot = React.createRoot(settingsSlot.component, slotProps(record, 'settings.section'))
  const settingsPage = settingsRoot.flush()
  const pageStyle = findAll(settingsPage, (node) => node.type === 'style')[0]
  const pageCss = pageStyle ? textOf(pageStyle) : ''
  check('settings page renders its own <style>', pageCss.includes('[data-wsf-page] button.wsf-primary'))
  check('settings page CSS never mentions the dialog scope', !pageCss.includes('[data-wsf-dialog]'))
  settingsRoot.unmount()

  const dialogRoot = React.createRoot(overlaySlot.component, slotProps(record, 'shell.overlay'))
  check('dialog renders nothing while closed', !dialogOf(dialogRoot.flush()))
  dialogRoot.unmount()

  disposeAll(record)
}

/* 2 ------------------------------------------------------------------ */
console.log('\n2. sidebar injection')
{
  const dom = makeDom(SIDEBAR_HTML)
  const doc = dom.document
  const record = boot({ document: doc })
  const rows = doc.querySelectorAll('[role="tree"] [class*="projectRow"]')
  check('fixture has three workspace rows', rows.length === 3, String(rows.length))

  const injected = buttonsOn(doc)
  check('one button per workspace row', injected.length === 3, String(injected.length))
  const sessionRow = doc.querySelector('[class*="sessionRow"]')
  check('session row gets no button', sessionRow.querySelectorAll('[data-wsf-manage]').length === 0)
  check('session row is not repositioned', !sessionRow.style.position, sessionRow.style.position)

  const row1 = injected[0].parentNode
  const row2 = injected[1].parentNode
  const first = injected[0]
  const manageLabel = zh.manage
  check('button is a real <button>', first.tagName === 'BUTTON', first.tagName)
  check('button carries data-wsf-manage', first.getAttribute('data-wsf-manage') === '')
  check('button uses the dictionary label', first.getAttribute('aria-label') === manageLabel + ': deepseek', first.getAttribute('aria-label'))
  check('button title matches its label', first.title === first.getAttribute('aria-label'), first.title)
  check('button has an svg icon', first.querySelectorAll('svg').length === 1)
  check('row made relative for the absolute button', row1.style.position === 'relative', row1.style.position)
  check(
    'nested projectRow resolved to its treeitem',
    row2.getAttribute('role') === 'treeitem',
    row2.className
  )

  const styleNode = doc.head.querySelector('[data-wsf-manage-style]')
  check(
    'trigger stylesheet injected once',
    Boolean(styleNode) && doc.head.querySelectorAll('[data-wsf-manage-style]').length === 1
  )
  check('trigger stylesheet reveals on hover', Boolean(styleNode) && styleNode.textContent.includes(':hover [data-wsf-manage]'))

  // The hover button must not select the row.
  let rowClicks = 0
  row1.addEventListener('click', () => {
    rowClicks += 1
  })
  const event = click(dom.window, first)
  check('click propagation stopped', rowClicks === 0, String(rowClicks))
  check('click default prevented', event.defaultPrevented === true)

  // The same click opened the dialog (store -> overlay component).
  const root = React.createRoot(slotEntry(record, 'shell.overlay').component, slotProps(record, 'shell.overlay'))
  root.flush()
  click(dom.window, first)
  await settle(root)
  check('trigger click opens the dialog', Boolean(dialogOf(root.tree)))
  check('dialog titled with the row title', textOf(headingOf(root.tree)).trim() === 'deepseek', textOf(headingOf(root.tree)))
  check('dialog names the workspace root', textOf(root.tree).includes('D:\\ws\\deepseek'))

  // Re-scan must not duplicate.
  notifyMutation()
  check('re-scan does not duplicate buttons', buttonsOn(doc).length === 3, String(buttonsOn(doc).length))
  notifyMutation()
  check('second re-scan still three buttons', buttonsOn(doc).length === 3, String(buttonsOn(doc).length))
  notifyMutation()
  check('third re-scan still three buttons', buttonsOn(doc).length === 3, String(buttonsOn(doc).length))

  // React rebuilt the row and dropped our node: exactly one comes back.
  first.parentNode.removeChild(first)
  check('row lost its button', buttonsOn(doc).length === 2, String(buttonsOn(doc).length))
  notifyMutation()
  check('button restored once after the rebuild', buttonsOn(doc).length === 3, String(buttonsOn(doc).length))
  check('restored row has exactly one button', row1.querySelectorAll('[data-wsf-manage]').length === 1)

  // Plugin-scope teardown (`ctx.effect` disposer) must be enough on its own.
  for (const dispose of [...record.effectDisposers]) dispose()
  check('ctx.effect disposer removes every injected button', buttonsOn(doc).length === 0, String(buttonsOn(doc).length))
  check('ctx.effect disposer removes the stylesheet', doc.head.querySelectorAll('[data-wsf-manage-style]').length === 0)
  check(
    'ctx.effect disposer disconnects the observer',
    observers.filter((observer) => observer.active && observer.target === doc.body).length === 0
  )
  check('ctx.effect disposer clears pending timers', pendingTimers.size === 0, String(pendingTimers.size))
  notifyMutation()
  check('no buttons reappear after plugin teardown', buttonsOn(doc).length === 0)

  // The full dispose (slot registration too) stays harmless and complete.
  disposeAll(record)
  check('dispose removes every injected button', buttonsOn(doc).length === 0, String(buttonsOn(doc).length))
  check('row position restored', !row1.style.position, row1.style.position)
  root.unmount()
}

/* 3 ------------------------------------------------------------------ */
console.log('\n3. dialog: add, pick, remove, close')
{
  const dom = makeDom(SIDEBAR_HTML)
  const picker = { pickDirectory: async () => 'D:\\picked' }
  const record = boot({ document: dom.document, picker })
  const t = record.t
  const root = React.createRoot(slotEntry(record, 'shell.overlay').component, slotProps(record, 'shell.overlay'))
  root.flush()

  click(dom.window, buttonsOn(dom.document)[0])
  await settle(root)
  check('dialog opened for the first row', textOf(headingOf(root.tree)).trim() === 'deepseek', textOf(headingOf(root.tree)))
  check('typed-path input offered', Boolean(inputOf(root.tree)))
  check('add-folder button offered', Boolean(buttonWithText(root.tree, t('addFolder'))))
  check('empty state shown for a workspace without extras', textOf(root.tree).includes(t('workspaceEmpty')))
  check('root row is not removable', !buttonWithAria(root.tree, t('remove') + ': D:\\ws\\deepseek'))

  // Typed absolute path.
  inputOf(root.tree).props.onChange({ target: { value: 'D:\\typed' } })
  root.flush()
  buttonWithText(root.tree, t('add')).props.onClick()
  await settle(root)
  const addCall = record.fetch.calls.filter((call) => call.url.endsWith('/add')).pop()
  check(
    'add posts {scope:workspace, workspace, path}',
    addCall && JSON.stringify(addCall.body) === JSON.stringify({ scope: 'workspace', workspace: 'D:\\ws\\deepseek', path: 'D:\\typed' }),
    addCall && JSON.stringify(addCall.body)
  )
  check('add shows the new folder', textOf(root.tree).includes('D:\\typed'))
  check('add shows a success notice', textOf(root.tree).includes(t('added')))

  // Remove it again.
  const removeButton = buttonWithAria(root.tree, t('remove') + ': D:\\typed')
  check('remove button offered for the new folder', Boolean(removeButton))
  removeButton.props.onClick()
  await settle(root)
  const removeCall = record.fetch.calls.filter((call) => call.url.endsWith('/remove')).pop()
  check(
    'remove posts {scope:workspace, workspace, path}',
    removeCall && JSON.stringify(removeCall.body) === JSON.stringify({ scope: 'workspace', workspace: 'D:\\ws\\deepseek', path: 'D:\\typed' }),
    removeCall && JSON.stringify(removeCall.body)
  )
  check('remove drops the folder from the list', !textOf(root.tree).includes('D:\\typed'))

  // Native picker path.
  buttonWithText(root.tree, t('addFolder')).props.onClick()
  await settle(root)
  const pickCall = record.fetch.calls.filter((call) => call.url.endsWith('/add')).pop()
  check(
    'picker add posts the picked path',
    pickCall && JSON.stringify(pickCall.body) === JSON.stringify({ scope: 'workspace', workspace: 'D:\\ws\\deepseek', path: 'D:\\picked' }),
    pickCall && JSON.stringify(pickCall.body)
  )

  // Backdrop click closes; a click on the panel does not.
  let backdrop = dialogOf(root.tree)
  const panel = byClass(root.tree, 'wsf-dialog')[0]
  backdrop.props.onClick({ target: panel, currentTarget: backdrop })
  root.flush()
  check('click on the panel keeps the dialog open', Boolean(dialogOf(root.tree)))
  backdrop = dialogOf(root.tree)
  backdrop.props.onClick({ target: backdrop, currentTarget: backdrop })
  root.flush()
  check('backdrop click closes', !dialogOf(root.tree))

  // Esc closes.
  click(dom.window, buttonsOn(dom.document)[0])
  await settle(root)
  check('reopened before Esc', Boolean(dialogOf(root.tree)))
  pressKey(dom.window, dom.document, 'Escape')
  root.flush()
  check('Esc closes the dialog', !dialogOf(root.tree))

  // Close button.
  click(dom.window, buttonsOn(dom.document)[0])
  await settle(root)
  buttonWithAria(root.tree, t('close')).props.onClick()
  root.flush()
  check('close button closes the dialog', !dialogOf(root.tree))

  // Every open re-reads /state.
  const readsBefore = record.fetch.calls.filter((call) => call.url.endsWith('/state')).length
  click(dom.window, buttonsOn(dom.document)[1])
  await settle(root)
  const readsAfter = record.fetch.calls.filter((call) => call.url.endsWith('/state')).length
  check('every open re-reads /state', readsAfter > readsBefore, readsBefore + ' -> ' + readsAfter)
  check(
    'second row resolves to its own workspace',
    textOf(headingOf(root.tree)).trim() === '新建文件夹 (4)',
    textOf(headingOf(root.tree))
  )
  check('its existing extra folder is listed', Boolean(buttonWithAria(root.tree, t('remove') + ': D:\\libs')))

  // An unresolved row opens the picker instead of failing.
  pressKey(dom.window, dom.document, 'Escape')
  root.flush()
  click(dom.window, buttonsOn(dom.document)[2])
  await settle(root)
  check('unresolved row shows the picker', textOf(root.tree).includes(t('pickWorkspaceHint')))
  check('picker lists both workspaces', byClass(root.tree, 'wsf-pick-item').length === 2)
  check('picker shows the unmatched row label', textOf(root.tree).includes('ghost workspace'))
  byClass(root.tree, 'wsf-pick-item')[0].props.onClick()
  await settle(root)
  check('picking a workspace opens its manager', textOf(headingOf(root.tree)).trim() === 'deepseek', textOf(headingOf(root.tree)))

  // The workspace disappears from /state -> the overlay must not stay stuck.
  record.host.workspaces = record.host.workspaces.filter((workspace) => workspace.path !== 'D:\\ws\\deepseek')
  pressKey(dom.window, dom.document, 'Escape')
  root.flush()
  click(dom.window, buttonsOn(dom.document)[0])
  await settle(root)
  check('dialog closes when its workspace vanishes from /state', !dialogOf(root.tree))

  root.unmount()
  disposeAll(record)
}

/* 4 ------------------------------------------------------------------ */
console.log('\n4. graceful degradation')
{
  // No sidebar at all.
  const dom = makeDom('<div id="app"></div>')
  let threw = null
  let record = null
  try {
    record = boot({ document: dom.document })
  } catch (error) {
    threw = error
  }
  check('boot without a sidebar does not throw', threw === null, threw && threw.message)
  check('nothing injected without rows', Boolean(record) && buttonsOn(dom.document).length === 0)
  check('overlay still registered without a sidebar', Boolean(record && slotEntry(record, 'shell.overlay')))
  disposeAll(record)

  // No document at all (module evaluated outside a page).
  threw = null
  try {
    boot({ document: undefined })
  } catch (error) {
    threw = error
  }
  check('boot without a document does not throw', threw === null, threw && threw.message)

  // No native folder picker: the dialog explains and the typed path still works.
  const dom2 = makeDom(SIDEBAR_HTML)
  const bare = boot({ document: dom2.document, withPicker: false })
  const root = React.createRoot(slotEntry(bare, 'shell.overlay').component, slotProps(bare, 'shell.overlay'))
  root.flush()
  click(dom2.window, buttonsOn(dom2.document)[0])
  await settle(root)
  const postsBefore = bare.fetch.calls.filter((call) => call.method === 'POST').length
  buttonWithText(root.tree, bare.t('addFolder')).props.onClick()
  await settle(root)
  check('missing picker posts nothing', bare.fetch.calls.filter((call) => call.method === 'POST').length === postsBefore)
  check('missing picker explains the fallback', textOf(root.tree).includes(bare.t('pickerUnavailable')))
  inputOf(root.tree).props.onChange({ target: { value: 'relative/dir' } })
  root.flush()
  buttonWithText(root.tree, bare.t('add')).props.onClick()
  await settle(root)
  check('relative path rejected locally', textOf(root.tree).includes(bare.t('notAbsolute')))
  check('relative path never posted', bare.fetch.calls.filter((call) => call.method === 'POST').length === postsBefore)
  root.unmount()
  disposeAll(bare)

  // A failing /state keeps the dialog usable: error text plus a working retry.
  const dom3 = makeDom(SIDEBAR_HTML)
  const broken = boot({ document: dom3.document })
  broken.host.failState = true
  const root2 = React.createRoot(slotEntry(broken, 'shell.overlay').component, slotProps(broken, 'shell.overlay'))
  root2.flush()
  click(dom3.window, buttonsOn(dom3.document)[0])
  await settle(root2)
  check('load failure is worded', textOf(root2.tree).includes(broken.t('loadFailed')), textOf(root2.tree).slice(0, 100))
  broken.host.failState = false
  buttonWithText(root2.tree, broken.t('retry')).props.onClick()
  await settle(root2)
  check('retry recovers', textOf(headingOf(root2.tree)).trim() === 'deepseek', textOf(headingOf(root2.tree)))
  root2.unmount()
  disposeAll(broken)
}

/* 5 ------------------------------------------------------------------ */
console.log('\n5. settings page still intact')
{
  const dom = makeDom('<div id="app"></div>')
  const record = boot({ document: dom.document })
  const t = record.t
  const root = React.createRoot(slotEntry(record, 'settings.section').component, slotProps(record, 'settings.section'))
  await settle(root)
  const tree = root.tree
  check('page heading present', textOf(headingOf(tree)).trim() === t('title'), textOf(headingOf(tree)))
  const cards = byClass(tree, 'wsf-card')
  check('one card per scope (global + two workspaces)', cards.length === 3, String(cards.length))
  check('global card is first', textOf(cards[0]).includes(t('globalTitle')))
  const globalInput = findAll(cards[0], (node) => node.type === 'input')[0]
  check('global card still has its typed-path input', Boolean(globalInput))
  globalInput.props.onChange({ target: { value: 'D:\\manual' } })
  root.flush()
  // Handlers are re-created per render, so read the button from the fresh tree.
  const globalAdd = buttonWithText(byClass(root.tree, 'wsf-card')[0], t('add'))
  check('global card still has its add button', Boolean(globalAdd))
  globalAdd.props.onClick()
  await settle(root)
  const call = record.fetch.calls.filter((entry) => entry.url.endsWith('/add')).pop()
  check(
    'global add still posts {scope:global, path}',
    call && JSON.stringify(call.body) === JSON.stringify({ scope: 'global', path: 'D:\\manual' }),
    call && JSON.stringify(call.body)
  )
  root.unmount()
  disposeAll(record)
}

/* -------------------------------------------------------------- summary */

console.log('')
if (failures.length) {
  console.log('FAILED ' + failures.length + ' check(s):')
  for (const failure of failures) console.log(' - ' + failure)
  process.exitCode = 1
} else {
  console.log('ALL CHECKS PASSED')
}
