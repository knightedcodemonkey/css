import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { __knightedCssPluginInternals, knightedCssResolverPlugin } from '../src/plugin.ts'

const {
  splitResourceAndQuery,
  hasKnightedCssQuery,
  appendQueryFlag,
  buildSidecarPath,
  isScriptResource,
  isNodeModulesPath,
} = __knightedCssPluginInternals

type MockHook = {
  tapAsync: (
    name: string,
    callback: (
      request: {
        request?: string
        path?: string
        context?: { issuer?: string }
        __knightedCssResolve?: boolean
      },
      context: { log?: (message: string) => void },
      callback: (error?: Error | null, result?: unknown) => void,
    ) => void,
  ) => void
}

type ResolveHandler = (
  request: {
    request?: string
    path?: string
    context?: { issuer?: string }
    __knightedCssResolve?: boolean
  },
  context: { log?: (message: string) => void },
  callback: (error?: Error | null, result?: unknown) => void,
) => void

type MockResolver = {
  getHook: (name: string) => MockHook
  doResolve: (
    hook: MockHook,
    request: {
      request?: string
      path?: string
      context?: { issuer?: string }
      __knightedCssResolve?: boolean
    },
    message: string,
    context: { log?: (message: string) => void },
    callback: (error?: Error | null, result?: unknown) => void,
  ) => void
  invoke: (
    name: string,
    request: { request?: string; context?: { issuer?: string } },
  ) => Promise<void>
  lastRequest: { request?: string } | null
  reset: () => void
}

function createMockResolver(resolveMap: Map<string, string>): MockResolver {
  const hooks = new Map<string, ResolveHandler[]>()
  let lastRequest: { request?: string } | null = null

  const hookApi = (name: string): MockHook => ({
    tapAsync: (_hookName, callback) => {
      const list = hooks.get(name) ?? []
      list.push(callback)
      hooks.set(name, list)
    },
  })

  return {
    getHook: hookApi,
    doResolve: (_hook, request, _message, _context, callback) => {
      if (request.__knightedCssResolve) {
        const key = `${request.request ?? ''}|${request.path ?? ''}`
        const resolved = resolveMap.get(key) ?? resolveMap.get(request.request ?? '')
        callback(null, resolved ? { path: resolved } : undefined)
        return
      }
      lastRequest = request
      callback(null, request)
    },
    async invoke(name, request) {
      const callbacks = hooks.get(name) ?? []
      for (const callback of callbacks) {
        await new Promise<void>((resolve, reject) => {
          callback(request, {}, error => {
            if (error) {
              reject(error)
              return
            }
            resolve()
          })
        })
      }
    },
    get lastRequest() {
      return lastRequest
    },
    reset() {
      lastRequest = null
    },
  }
}

type MockCompiler = {
  getResolver: (type: string) => MockResolver | undefined
  hooks: {
    invalid: { tap: (name: string, callback: () => void) => void }
  }
  triggerInvalid: () => void
}

function createMockCompiler(resolver: MockResolver): MockCompiler {
  let invalidHandler: (() => void) | undefined
  return {
    getResolver: type => (type === 'normal' ? resolver : undefined),
    hooks: {
      invalid: {
        tap: (_name, callback) => {
          invalidHandler = callback
        },
      },
    },
    triggerInvalid() {
      invalidHandler?.()
    },
  }
}

function setResolveEntry(
  map: Map<string, string>,
  specifier: string,
  importer: string,
  resolvedPath: string,
) {
  map.set(`${specifier}|${importer}`, resolvedPath)
  map.set(specifier, resolvedPath)
}

test('resolver plugin internals parse and append queries', () => {
  assert.deepEqual(splitResourceAndQuery('./button.js'), {
    resource: './button.js',
    query: '',
  })
  assert.deepEqual(splitResourceAndQuery('./button.js?raw=1'), {
    resource: './button.js',
    query: '?raw=1',
  })

  assert.equal(hasKnightedCssQuery('?knighted-css'), true)
  assert.equal(hasKnightedCssQuery('?raw=1&knighted-css'), true)
  assert.equal(hasKnightedCssQuery('?raw=1'), false)

  assert.equal(
    `./button.js${appendQueryFlag('', 'knighted-css')}`,
    './button.js?knighted-css',
  )
  assert.equal(
    `./button.js${appendQueryFlag('?raw=1', 'knighted-css')}`,
    './button.js?raw=1&knighted-css',
  )
})

test('resolver plugin internals identify script paths and sidecars', () => {
  assert.equal(isScriptResource('/tmp/button.tsx'), true)
  assert.equal(isScriptResource('/tmp/button.js'), true)
  assert.equal(isScriptResource('/tmp/button.d.ts'), false)
  assert.equal(isScriptResource('/tmp/styles.css'), false)
  assert.equal(isNodeModulesPath('/tmp/node_modules/pkg/index.js'), true)
  assert.equal(isNodeModulesPath('/tmp/src/button.tsx'), false)

  assert.equal(buildSidecarPath('/tmp/button.tsx'), '/tmp/button.tsx.d.ts')
})

test('resolver plugin requires marker when strictSidecar is enabled', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knighted-plugin-'))
  try {
    const srcDir = path.join(root, 'src')
    await fs.mkdir(srcDir, { recursive: true })
    const importer = path.join(srcDir, 'entry.ts')
    const target = path.join(srcDir, 'button.tsx')
    await fs.writeFile(importer, "import './button'\n")
    await fs.writeFile(target, 'export function Button() {}\n')
    await fs.writeFile(`${target}.d.ts`, 'declare module "./button.js" {}\n')

    const resolveMap = new Map<string, string>()
    setResolveEntry(resolveMap, './button', importer, target)
    const resolver = createMockResolver(resolveMap)
    const plugin = knightedCssResolverPlugin({ rootDir: root, strictSidecar: true })
    plugin.apply(resolver)

    await resolver.invoke('resolve', {
      request: './button',
      context: { issuer: importer },
    })

    assert.equal(resolver.lastRequest, null)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('resolver plugin rewrites when strictSidecar marker exists', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knighted-plugin-'))
  try {
    const srcDir = path.join(root, 'src')
    await fs.mkdir(srcDir, { recursive: true })
    const importer = path.join(srcDir, 'entry.ts')
    const target = path.join(srcDir, 'card.tsx')
    await fs.writeFile(importer, "import './card'\n")
    await fs.writeFile(target, 'export function Card() {}\n')
    await fs.writeFile(
      `${target}.d.ts`,
      '// @knighted-css\n\ndeclare module "./card.js" {}\n',
    )

    const resolveMap = new Map<string, string>()
    setResolveEntry(resolveMap, './card', importer, target)
    const resolver = createMockResolver(resolveMap)
    const plugin = knightedCssResolverPlugin({ rootDir: root, strictSidecar: true })
    plugin.apply(resolver)

    await resolver.invoke('resolve', {
      request: './card',
      context: { issuer: importer },
    })

    assert.ok(resolver.lastRequest?.request?.includes('knighted-css'))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('resolver plugin uses manifest entries for sidecar lookup', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knighted-plugin-'))
  try {
    const srcDir = path.join(root, 'src')
    const typesDir = path.join(root, 'types')
    await fs.mkdir(srcDir, { recursive: true })
    await fs.mkdir(typesDir, { recursive: true })
    const importer = path.join(srcDir, 'entry.ts')
    const target = path.join(srcDir, 'theme.tsx')
    const sidecar = path.join(typesDir, 'theme.d.ts')
    await fs.writeFile(importer, "import './theme'\n")
    await fs.writeFile(target, 'export function Theme() {}\n')
    await fs.writeFile(sidecar, '// @knighted-css\n\ndeclare module "./theme.js" {}\n')

    const manifestPath = path.join(root, 'knighted-manifest.json')
    const manifestKey = target.split(path.sep).join('/')
    const manifest = { [manifestKey]: { file: sidecar } }
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2))

    const resolveMap = new Map<string, string>()
    setResolveEntry(resolveMap, './theme', importer, target)
    const resolver = createMockResolver(resolveMap)
    const plugin = knightedCssResolverPlugin({
      rootDir: root,
      strictSidecar: true,
      manifestPath,
    })
    plugin.apply(resolver)

    await resolver.invoke('resolve', {
      request: './theme',
      context: { issuer: importer },
    })

    assert.ok(resolver.lastRequest?.request?.includes('knighted-css'))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('resolver plugin invalid hook clears manifest cache', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knighted-plugin-'))
  try {
    const srcDir = path.join(root, 'src')
    const typesDir = path.join(root, 'types')
    await fs.mkdir(srcDir, { recursive: true })
    await fs.mkdir(typesDir, { recursive: true })
    const importer = path.join(srcDir, 'entry.ts')
    const target = path.join(srcDir, 'panel.tsx')
    const sidecar = path.join(typesDir, 'panel.d.ts')
    await fs.writeFile(importer, "import './panel'\n")
    await fs.writeFile(target, 'export function Panel() {}\n')
    await fs.writeFile(sidecar, '// @knighted-css\n\ndeclare module "./panel.js" {}\n')

    const manifestPath = path.join(root, 'knighted-manifest.json')
    const manifestKey = target.split(path.sep).join('/')
    await fs.writeFile(
      manifestPath,
      JSON.stringify({ [manifestKey]: { file: sidecar } }, null, 2),
    )

    const resolveMap = new Map<string, string>()
    setResolveEntry(resolveMap, './panel', importer, target)
    const resolver = createMockResolver(resolveMap)
    const compiler = createMockCompiler(resolver)
    const plugin = knightedCssResolverPlugin({
      rootDir: root,
      manifestPath,
    })
    plugin.apply(compiler)

    await resolver.invoke('resolve', {
      request: './panel',
      context: { issuer: importer },
    })
    assert.ok(resolver.lastRequest?.request?.includes('knighted-css'))

    await fs.writeFile(manifestPath, JSON.stringify({}, null, 2))
    compiler.triggerInvalid()
    resolver.reset()

    await resolver.invoke('resolve', {
      request: './panel',
      context: { issuer: importer },
    })

    assert.equal(resolver.lastRequest, null)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('resolver plugin prefers compiler resolver output when available', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knighted-plugin-'))
  try {
    const srcDir = path.join(root, 'src')
    await fs.mkdir(srcDir, { recursive: true })
    const importer = path.join(srcDir, 'entry.ts')
    const target = path.join(srcDir, 'alias.ts')
    await fs.writeFile(importer, "import '#alias/button'\n")
    await fs.writeFile(target, 'export function Alias() {}\n')
    await fs.writeFile(
      `${target}.d.ts`,
      '// @knighted-css\n\ndeclare module "#alias/button" {}\n',
    )

    const resolveMap = new Map<string, string>()
    setResolveEntry(resolveMap, '#alias/button', importer, target)
    const resolver = createMockResolver(resolveMap)
    const plugin = knightedCssResolverPlugin({ rootDir: root, strictSidecar: true })
    plugin.apply(resolver)

    await resolver.invoke('resolve', {
      request: '#alias/button',
      context: { issuer: importer },
    })

    assert.ok(resolver.lastRequest?.request?.includes('knighted-css'))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
