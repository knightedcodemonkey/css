import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import loaderBridge, {
  __loaderBridgeInternals,
  pitch,
  type KnightedCssBridgeLoaderOptions,
} from '../src/loaderBridge.js'
import type { LoaderContext } from 'webpack'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

type MockLoaderContext = Partial<LoaderContext<KnightedCssBridgeLoaderOptions>> & {
  warnings: string[]
  _module?: { rawRequest?: string }
}

function createMockContext(
  overrides: Partial<LoaderContext<KnightedCssBridgeLoaderOptions>> = {},
): MockLoaderContext {
  const warnings: string[] = []
  return {
    resourcePath:
      overrides.resourcePath ??
      path.resolve(__dirname, 'fixtures/dialects/basic/styles.css'),
    rootContext: overrides.rootContext ?? path.resolve(__dirname, '..'),
    getOptions: overrides.getOptions ?? (() => ({})),
    resourceQuery: overrides.resourceQuery,
    context: overrides.context,
    utils: overrides.utils,
    loadModule:
      overrides.loadModule as LoaderContext<KnightedCssBridgeLoaderOptions>['loadModule'],
    emitWarning: err => warnings.push(err.message),
    warnings,
    ...overrides,
  }
}

function callPitch(
  ctx: LoaderContext<KnightedCssBridgeLoaderOptions>,
  remainingRequest: string,
): unknown {
  return (
    pitch as unknown as (
      this: LoaderContext<KnightedCssBridgeLoaderOptions>,
      request: string,
    ) => unknown
  ).call(ctx, remainingRequest)
}

test('resolveCssText prefers string default export', () => {
  const module = { default: '.card{color:red}' }
  assert.equal(
    __loaderBridgeInternals.resolveCssText(module.default, module),
    '.card{color:red}',
  )
})

test('resolveCssText falls back to toString result', () => {
  const module = {
    default: {
      toString: () => '.badge{display:block}',
    },
  }
  assert.equal(
    __loaderBridgeInternals.resolveCssText(module.default, module),
    '.badge{display:block}',
  )
})

test('resolveCssText handles cjs module default', () => {
  const module = {
    toString: () => '.pill{padding:4px}',
  }
  const bridgeModule = module as unknown as {
    default?: unknown
    locals?: Record<string, string>
  }
  assert.equal(
    __loaderBridgeInternals.resolveCssText(bridgeModule, bridgeModule),
    '.pill{padding:4px}',
  )
})

test('resolveCssText ignores object string coercions', () => {
  const module = {
    default: {
      toString: () => '[object Module]',
    },
  }
  assert.equal(__loaderBridgeInternals.resolveCssText(module.default, module), '')
})

test('loader passthrough returns original source', () => {
  const result = (loaderBridge as unknown as (this: unknown, source: string) => string)(
    'body {}',
  )
  assert.equal(result, 'body {}')
})

test('resolveCssText falls back to module string when primary is not string', () => {
  const module = '.chip{display:inline-flex}'
  const bridgeModule = module as unknown as {
    default?: unknown
    locals?: Record<string, string>
  }
  assert.equal(__loaderBridgeInternals.resolveCssText(undefined, bridgeModule), module)
})

test('resolveCssModules finds locals on default export', () => {
  const module = {
    default: {
      locals: { panel: 'panel_hash' },
    },
  }
  assert.deepEqual(__loaderBridgeInternals.resolveCssModules(module.default, module), {
    panel: 'panel_hash',
  })
})

test('resolveCssModules finds locals on module export', () => {
  const module = {
    locals: { card: 'card_hash' },
  }
  assert.deepEqual(__loaderBridgeInternals.resolveCssModules(module, module), {
    card: 'card_hash',
  })
})

test('resolveCssModules ignores default string export', () => {
  const module = { default: '.card{color:red}' }
  assert.equal(__loaderBridgeInternals.resolveCssModules(module, module), undefined)
})

test('resolveCssModules omits default from named exports', () => {
  const module = {
    default: '.card{color:red}',
    card: 'card_hash',
    title: 'title_hash',
  }
  assert.deepEqual(__loaderBridgeInternals.resolveCssModules(module, module), {
    card: 'card_hash',
    title: 'title_hash',
  })
})

test('resolveCssModules returns string map locals', () => {
  const module = {
    button: 'button_hash',
    pill: 'pill_hash',
  }
  const bridgeModule = module as unknown as {
    default?: unknown
    locals?: Record<string, string>
  }
  assert.deepEqual(
    __loaderBridgeInternals.resolveCssModules(bridgeModule, bridgeModule),
    {
      button: 'button_hash',
      pill: 'pill_hash',
    },
  )
})

test('resolveCssModules collects named exports locals', () => {
  const module = {
    default: '.ignored{}',
    __esModule: true,
    card: 'card_hash',
  }
  assert.deepEqual(__loaderBridgeInternals.resolveCssModules(undefined, module), {
    card: 'card_hash',
  })
})

test('resolveCssModules returns undefined when locals are invalid', () => {
  const module = {
    default: '.ignored{}',
    __esModule: true,
    card: 123,
  }
  assert.equal(__loaderBridgeInternals.resolveCssModules(undefined, module), undefined)
})

test('pitch returns combined module wrapper when combined flag is present', async () => {
  const ctx = createMockContext({
    resourceQuery: '?knighted-css&combined',
    _module: {
      rawRequest: './styles.module.css?knighted-css&combined',
    } as unknown as LoaderContext<KnightedCssBridgeLoaderOptions>['_module'],
  })

  const result = await callPitch(
    ctx as LoaderContext<KnightedCssBridgeLoaderOptions>,
    './styles.module.css?knighted-css&combined',
  )

  const output = String(result ?? '')
  assert.match(output, /export \* from/)
  assert.match(output, /export default __knightedLocalsExport/)
  assert.match(output, /export const knightedCss = /)
})

test('pitch omits knightedCssModules when emitCssModules is false', async () => {
  const ctx = createMockContext({
    resourceQuery: '?knighted-css',
    getOptions: () => ({ emitCssModules: false }),
  })

  const result = await callPitch(
    ctx as LoaderContext<KnightedCssBridgeLoaderOptions>,
    './styles.module.css?knighted-css',
  )

  const output = String(result ?? '')
  assert.match(output, /export default __knightedCss/)
  assert.ok(!/knightedCssModules/.test(output))
})

test('pitch warns when types query is used', async () => {
  const ctx = createMockContext({
    resourceQuery: '?knighted-css&types',
  })

  await callPitch(
    ctx as LoaderContext<KnightedCssBridgeLoaderOptions>,
    './styles.module.css?knighted-css&types',
  )

  assert.equal(ctx.warnings.length, 1)
  assert.match(ctx.warnings[0] ?? '', /does not generate stableSelectors/)
})

test('collectStyleImportSpecifiers finds style imports', () => {
  const source = `
    import styles from './card.module.css'
    import './other.module.scss?inline'
    export { tokens } from "./tokens.module.less"
    import './global.css'
  `
  assert.deepEqual(__loaderBridgeInternals.collectStyleImportSpecifiers(source).sort(), [
    './card.module.css',
    './global.css',
    './other.module.scss?inline',
    './tokens.module.less',
  ])
})

test('buildBridgeCssRequest appends knighted-css query', () => {
  assert.equal(
    __loaderBridgeInternals.buildBridgeCssRequest('./card.module.css'),
    './card.module.css?knighted-css',
  )
  assert.equal(
    __loaderBridgeInternals.buildBridgeCssRequest('./card.module.css?inline'),
    './card.module.css?inline&knighted-css',
  )
  assert.equal(
    __loaderBridgeInternals.buildBridgeCssRequest('./card.module.css?knighted-css'),
    './card.module.css?knighted-css',
  )
})

test('isJsLikeResource detects js/ts resources', () => {
  assert.equal(__loaderBridgeInternals.isJsLikeResource('file.tsx'), true)
  assert.equal(__loaderBridgeInternals.isJsLikeResource('file.css'), false)
})

test('createCombinedJsBridgeModule joins css strings with newline', () => {
  const output = __loaderBridgeInternals.createCombinedJsBridgeModule({
    upstreamRequest: '!!./card.js?knighted-css&combined',
    cssRequests: ['./card.module.css?knighted-css'],
    emitDefault: true,
  })
  assert.match(output, /join\(['"]\\n['"]\)/)
  assert.match(output, /export const knightedCss = /)
  assert.match(output, /export default __knightedDefault/)
})

test('createCombinedJsBridgeModule omits default when disabled', () => {
  const output = __loaderBridgeInternals.createCombinedJsBridgeModule({
    upstreamRequest: '!!./card.js?knighted-css&combined',
    cssRequests: ['./card.module.css?knighted-css'],
    emitDefault: false,
  })
  assert.ok(!/export default __knightedDefault/.test(output))
})

test('buildProxyRequest uses raw request and strips query flags', () => {
  const ctx = createMockContext({
    resourcePath: path.resolve(__dirname, 'fixtures/dialects/basic/styles.css'),
    resourceQuery: '?knighted-css&combined&types&foo=1',
    _module: {
      rawRequest: 'babel-loader!./styles.css?knighted-css&combined&types&foo=1',
    } as unknown as LoaderContext<KnightedCssBridgeLoaderOptions>['_module'],
  })

  const request = __loaderBridgeInternals.buildProxyRequest(
    ctx as LoaderContext<KnightedCssBridgeLoaderOptions>,
  )
  assert.match(request, /babel-loader!/)
  assert.match(request, /\?foo=1$/)
})

test('buildProxyRequest falls back to utils.contextify', () => {
  const ctx = createMockContext({
    resourcePath: path.resolve(__dirname, 'fixtures/dialects/basic/styles.css'),
    resourceQuery: '?knighted-css&foo=1',
    utils: {
      contextify: (_context: string, req: string) =>
        req.replace(/.*styles/, './ctx/styles'),
    } as LoaderContext<KnightedCssBridgeLoaderOptions>['utils'],
  })

  const request = __loaderBridgeInternals.buildProxyRequest(
    ctx as LoaderContext<KnightedCssBridgeLoaderOptions>,
  )
  assert.equal(request, './ctx/styles.css?foo=1')
})

test('buildProxyRequest falls back to relative request when contextify is missing', () => {
  const context = path.resolve(__dirname, 'fixtures/dialects/basic')
  const resourcePath = path.resolve(context, 'styles.css')
  const ctx = createMockContext({
    resourcePath,
    context,
    resourceQuery: '?knighted-css',
  })

  const request = __loaderBridgeInternals.buildProxyRequest(
    ctx as LoaderContext<KnightedCssBridgeLoaderOptions>,
  )
  assert.equal(request, './styles.css')
})

test('buildProxyRequest rebuilds raw request with contextified resource', () => {
  const ctx = createMockContext({
    resourcePath: path.resolve(__dirname, 'fixtures/dialects/basic/styles.css'),
    resourceQuery: '?knighted-css&foo=1',
    _module: {
      rawRequest: '!!sass-loader!./styles.css?knighted-css&foo=1',
    } as unknown as LoaderContext<KnightedCssBridgeLoaderOptions>['_module'],
    utils: {
      contextify: (_context: string, req: string) =>
        req.replace(/.*styles/, './ctx/styles'),
    } as LoaderContext<KnightedCssBridgeLoaderOptions>['utils'],
  })

  const request = __loaderBridgeInternals.buildProxyRequest(
    ctx as LoaderContext<KnightedCssBridgeLoaderOptions>,
  )
  assert.match(request, /sass-loader!\.\/ctx\/styles\.css\?foo=1$/)
})

test('createBridgeModule omits default export when includeDefault is false', () => {
  const output = __loaderBridgeInternals.createBridgeModule({
    localsRequest: './card.module.css?knighted-css',
    upstreamRequest: './card.module.css?knighted-css',
    combined: true,
    emitDefault: true,
    emitCssModules: true,
    includeDefault: false,
  })

  assert.match(output, /const __knightedDefault = __knightedUpstream;/)
})

test('pitch handles combined js modules and collects css modules', async () => {
  const source = `import styles from './card.module.css'\nimport './other.module.scss?inline'`
  const ctx = createMockContext({
    resourcePath: path.resolve(__dirname, 'fixtures/bridge/bridge-card.tsx'),
    resourceQuery: '?knighted-css&combined',
  }) as LoaderContext<KnightedCssBridgeLoaderOptions> & {
    fs: LoaderContext<KnightedCssBridgeLoaderOptions>['fs']
    async: () => (error: Error | null, result?: string) => void
  }

  const result = await new Promise<string>((resolve, reject) => {
    const readFile = (_path: string, cb: (err: Error | null, data?: Buffer) => void) =>
      cb(null, Buffer.from(source))
    ctx.fs = {
      readFile,
    } as unknown as LoaderContext<KnightedCssBridgeLoaderOptions>['fs']
    ctx.async = () => (error, output) => {
      if (error) {
        reject(error)
        return
      }
      resolve(String(output ?? ''))
    }
    callPitch(ctx, './bridge-card.tsx?knighted-css&combined')
  })

  assert.match(result, /export \* from/)
  assert.match(result, /card\.module\.css\?knighted-css/)
  assert.match(result, /other\.module\.scss\?inline&knighted-css/)
})

test('pitch combined js collects css modules from dependency graph', async () => {
  const entryPath = path.resolve(__dirname, 'fixtures/bridge-graph/entry.tsx')
  const ctx = createMockContext({
    resourcePath: entryPath,
    resourceQuery: '?knighted-css&combined',
  }) as LoaderContext<KnightedCssBridgeLoaderOptions> & {
    fs: LoaderContext<KnightedCssBridgeLoaderOptions>['fs']
    async: () => (error: Error | null, result?: string) => void
  }

  const result = await new Promise<string>((resolve, reject) => {
    ctx.fs = {
      readFile: (filePath: string, cb: (err: Error | null, data?: Buffer) => void) =>
        fs.readFile(filePath, cb),
    } as unknown as LoaderContext<KnightedCssBridgeLoaderOptions>['fs']
    ctx.async = () => (error, output) => {
      if (error) {
        reject(error)
        return
      }
      resolve(String(output ?? ''))
    }
    callPitch(ctx, './entry.tsx?knighted-css&combined')
  })

  assert.match(result, /button\.module\.scss\?knighted-css/)
})

test('pitch combined js dedupes direct requests already in graph', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knighted-bridge-'))
  try {
    const entryPath = path.join(root, 'entry.tsx')
    const sharedPath = path.join(root, 'shared.css')
    fs.writeFileSync(sharedPath, '.shared {}')
    fs.writeFileSync(entryPath, `import './shared.css'\n`)

    const ctx = createMockContext({
      resourcePath: entryPath,
      resourceQuery: '?knighted-css&combined',
    }) as LoaderContext<KnightedCssBridgeLoaderOptions> & {
      fs: LoaderContext<KnightedCssBridgeLoaderOptions>['fs']
      async: () => (error: Error | null, result?: string) => void
    }

    const result = await new Promise<string>((resolve, reject) => {
      ctx.fs = {
        readFile: (filePath: string, cb: (err: Error | null, data?: Buffer) => void) =>
          fs.readFile(filePath, cb),
      } as unknown as LoaderContext<KnightedCssBridgeLoaderOptions>['fs']
      ctx.async = () => (error, output) => {
        if (error) {
          reject(error)
          return
        }
        resolve(String(output ?? ''))
      }
      callPitch(ctx, './entry.tsx?knighted-css&combined')
    })

    const matches = result.match(/shared\.css\?knighted-css/g) ?? []
    assert.ok(matches.length >= 1)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('pitch combined js resolves upstream from loader list', async () => {
  const ctx = createMockContext({
    resourcePath: path.resolve(__dirname, 'fixtures/bridge/bridge-card.tsx'),
    resourceQuery: '?knighted-css&combined',
  }) as LoaderContext<KnightedCssBridgeLoaderOptions> & {
    fs: LoaderContext<KnightedCssBridgeLoaderOptions>['fs']
    async: () => (error: Error | null, result?: string) => void
    loaders: Array<{ request?: string; path?: string; query?: string }>
    loaderIndex: number
  }

  const result = await new Promise<string>((resolve, reject) => {
    ctx.fs = {
      readFile: (_filePath: string, cb: (err: Error | null, data?: Buffer) => void) =>
        cb(null, Buffer.from('import "./card.css"')),
    } as unknown as LoaderContext<KnightedCssBridgeLoaderOptions>['fs']
    ctx.loaders = [
      { request: 'first-loader' },
      { request: 'second-loader' },
    ] as LoaderContext<KnightedCssBridgeLoaderOptions>['loaders']
    ctx.loaderIndex = 0
    ctx.async = () => (error, output) => {
      if (error) {
        reject(error)
        return
      }
      resolve(String(output ?? ''))
    }
    callPitch(ctx, '')
  })

  assert.match(result, /import \* as __knightedUpstream from "!!second-loader!/)
})

test('pitch combined js returns sync module when async callback is missing', async () => {
  const ctx = createMockContext({
    resourcePath: path.resolve(__dirname, 'fixtures/bridge/bridge-card.tsx'),
    resourceQuery: '?knighted-css&combined',
  }) as unknown as LoaderContext<KnightedCssBridgeLoaderOptions>
  ;(ctx as unknown as { async?: () => undefined }).async = () => undefined
  const result = await callPitch(
    ctx as LoaderContext<KnightedCssBridgeLoaderOptions>,
    './bridge-card.tsx?knighted-css&combined',
  )
  const output = String(result ?? '')
  assert.match(output, /export const knightedCss = /)
  assert.match(output, /export \* from/)
})

test('pitch combined js surfaces read errors', async () => {
  const ctx = createMockContext({
    resourcePath: path.resolve(__dirname, 'fixtures/bridge/bridge-card.tsx'),
    resourceQuery: '?knighted-css&combined',
  }) as LoaderContext<KnightedCssBridgeLoaderOptions> & {
    fs: LoaderContext<KnightedCssBridgeLoaderOptions>['fs']
    async: () => (error: Error | null, result?: string) => void
  }

  const error = await new Promise<Error>((resolve, reject) => {
    const readFile = (_path: string, cb: (err: Error | null, data?: Buffer) => void) =>
      cb(new Error('read failed'))
    ctx.fs = {
      readFile,
    } as unknown as LoaderContext<KnightedCssBridgeLoaderOptions>['fs']
    ctx.async = () => (err, _output) => {
      if (!err) {
        reject(new Error('Expected error'))
        return
      }
      resolve(err)
    }
    callPitch(ctx, './bridge-card.tsx?knighted-css&combined')
  })

  assert.match(error.message, /read failed/)
})

test('pitch combined js errors when no data is returned', async () => {
  const ctx = createMockContext({
    resourcePath: path.resolve(__dirname, 'fixtures/bridge/bridge-card.tsx'),
    resourceQuery: '?knighted-css&combined',
  }) as LoaderContext<KnightedCssBridgeLoaderOptions> & {
    fs: LoaderContext<KnightedCssBridgeLoaderOptions>['fs']
    async: () => (error: Error | null, result?: string) => void
  }

  const error = await new Promise<Error>((resolve, reject) => {
    const readFile = (_path: string, cb: (err: Error | null, data?: Buffer) => void) =>
      cb(null)
    ctx.fs = {
      readFile,
    } as unknown as LoaderContext<KnightedCssBridgeLoaderOptions>['fs']
    ctx.async = () => (err, _output) => {
      if (!err) {
        reject(new Error('Expected error'))
        return
      }
      resolve(err)
    }
    callPitch(ctx, './bridge-card.tsx?knighted-css&combined')
  })

  assert.match(error.message, /Unable to read/)
})

test('pitch non-combined sync warns without emitWarning handler', () => {
  const ctx = createMockContext({
    resourcePath: path.resolve(__dirname, 'fixtures/bridge/bridge-card.tsx'),
    resourceQuery: '?knighted-css&types',
    emitWarning: undefined,
  }) as unknown as LoaderContext<KnightedCssBridgeLoaderOptions>
  ;(ctx as unknown as { async?: () => undefined }).async = () => undefined

  const result = callPitch(ctx, './bridge-card.tsx?knighted-css&types')
  assert.match(String(result ?? ''), /export default __knightedCss/)
})

test('pitch combined sync respects named-only query', () => {
  const ctx = createMockContext({
    resourcePath: path.resolve(__dirname, 'fixtures/bridge/bridge-card.tsx'),
    resourceQuery: '?knighted-css&combined&no-default',
  }) as unknown as LoaderContext<KnightedCssBridgeLoaderOptions>
  ;(ctx as unknown as { async?: () => undefined }).async = () => undefined

  const result = callPitch(ctx, './bridge-card.tsx?knighted-css&combined&no-default')
  const output = String(result ?? '')
  assert.ok(!/export default __knightedLocalsExport/.test(output))
})

test('pitch combined sync resolves request from ctx.request', () => {
  const ctx = createMockContext({
    resourcePath: path.resolve(__dirname, 'fixtures/bridge/bridge-card.tsx'),
    resourceQuery: '?knighted-css&combined',
  }) as unknown as LoaderContext<KnightedCssBridgeLoaderOptions>
  ;(ctx as unknown as { async?: () => undefined }).async = () => undefined
  ;(ctx as { request?: string }).request =
    'first-loader!second-loader!./bridge-card.tsx?knighted-css&combined'
  ;(ctx as { loaderIndex?: number }).loaderIndex = 0

  const result = callPitch(ctx, '')
  assert.match(String(result ?? ''), /"!!second-loader!/)
})

test('pitch non-js resource falls back when graph collection fails', async () => {
  const missingPath = path.join(os.tmpdir(), 'missing-style.css')
  const ctx = createMockContext({
    resourcePath: missingPath,
    resourceQuery: '?knighted-css',
  }) as LoaderContext<KnightedCssBridgeLoaderOptions> & {
    async: () => (error: Error | null, result?: string) => void
  }

  const result = await new Promise<string>((resolve, reject) => {
    ctx.async = () => (error, output) => {
      if (error) {
        reject(error)
        return
      }
      resolve(String(output ?? ''))
    }
    callPitch(ctx, './missing-style.css?knighted-css')
  })

  assert.match(result, /export default __knightedCss/)
})

test('pitch non-combined js uses no-default detection for upstream', async () => {
  const source = `export const value = 1\nimport './card.module.css'`
  const ctx = createMockContext({
    resourcePath: path.resolve(__dirname, 'fixtures/bridge/bridge-card.tsx'),
    resourceQuery: '?knighted-css',
  }) as LoaderContext<KnightedCssBridgeLoaderOptions> & {
    fs: LoaderContext<KnightedCssBridgeLoaderOptions>['fs']
    async: () => (error: Error | null, result?: string) => void
  }

  const result = await new Promise<string>((resolve, reject) => {
    ctx.fs = {
      readFile: (_filePath: string, cb: (err: Error | null, data?: Buffer) => void) =>
        cb(null, Buffer.from(source)),
    } as unknown as LoaderContext<KnightedCssBridgeLoaderOptions>['fs']
    ctx.async = () => (error, output) => {
      if (error) {
        reject(error)
        return
      }
      resolve(String(output ?? ''))
    }
    callPitch(ctx, './bridge-card.tsx?knighted-css')
  })

  assert.match(result, /const __knightedDefault = __knightedUpstream;/)
})

test('pitch non-combined js detects default export', async () => {
  const source = `export default function Card() {}\nimport './card.css'`
  const ctx = createMockContext({
    resourcePath: path.resolve(__dirname, 'fixtures/bridge/bridge-card.tsx'),
    resourceQuery: '?knighted-css',
  }) as LoaderContext<KnightedCssBridgeLoaderOptions> & {
    fs: LoaderContext<KnightedCssBridgeLoaderOptions>['fs']
    async: () => (error: Error | null, result?: string) => void
  }

  const result = await new Promise<string>((resolve, reject) => {
    ctx.fs = {
      readFile: (_filePath: string, cb: (err: Error | null, data?: Buffer) => void) =>
        cb(null, Buffer.from(source)),
    } as unknown as LoaderContext<KnightedCssBridgeLoaderOptions>['fs']
    ctx.async = () => (error, output) => {
      if (error) {
        reject(error)
        return
      }
      resolve(String(output ?? ''))
    }
    callPitch(ctx, './bridge-card.tsx?knighted-css')
  })

  assert.match(
    result,
    /Object\.prototype\.hasOwnProperty\.call\(__knightedUpstream, 'default'\)/,
  )
})

test('resolveCssModules returns string maps', () => {
  const module = { card: 'card_hash', title: 'title_hash' }
  const bridgeModule = module as unknown as {
    default?: unknown
    locals?: Record<string, string>
  }
  assert.deepEqual(
    __loaderBridgeInternals.resolveCssModules(module, bridgeModule),
    module,
  )
})

test('resolveCssModules falls back to named exports', () => {
  const module = { card: 'card_hash', __esModule: true }
  const bridgeModule = module as unknown as {
    default?: unknown
    locals?: Record<string, string>
  }
  assert.deepEqual(__loaderBridgeInternals.resolveCssModules(module, bridgeModule), {
    card: 'card_hash',
  })
})

test('createBridgeModule prefers upstream locals when present', () => {
  const output = __loaderBridgeInternals.createBridgeModule({
    localsRequest: './styles.module.css?knighted-css',
    upstreamRequest: '!!css-loader!./styles.module.css?knighted-css',
    combined: false,
    emitDefault: false,
    emitCssModules: true,
  })
  assert.match(output, /__knightedResolveCssModules\(__knightedUpstream/)
  assert.match(output, /__knightedUpstreamLocals \?\?/)
})

test('buildProxyRequest prefers raw requests', () => {
  const ctx = createMockContext({
    resourcePath: path.resolve(__dirname, 'fixtures/dialects/basic/styles.css'),
    resourceQuery: '?knighted-css',
    _module: {
      rawRequest: '!!sass-loader!./styles.css?knighted-css',
    } as unknown as LoaderContext<KnightedCssBridgeLoaderOptions>['_module'],
  }) as LoaderContext<KnightedCssBridgeLoaderOptions>

  const request = __loaderBridgeInternals.buildProxyRequest(ctx)
  assert.match(request, /sass-loader!\.\/styles\.css/)
})

test('buildProxyRequest uses contextify when available', () => {
  const ctx = createMockContext({
    resourcePath: path.resolve(__dirname, 'fixtures/dialects/basic/styles.css'),
    resourceQuery: '?knighted-css',
    context: path.resolve(__dirname, 'fixtures/dialects/basic'),
    utils: {
      contextify: (_context: string, request: string) => `./${path.basename(request)}`,
    } as unknown as LoaderContext<KnightedCssBridgeLoaderOptions>['utils'],
  }) as LoaderContext<KnightedCssBridgeLoaderOptions>

  const request = __loaderBridgeInternals.buildProxyRequest(ctx)
  assert.equal(request, './styles.css')
})
