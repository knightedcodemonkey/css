import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import loader, { type KnightedCssLoaderOptions, pitch } from '../src/loader.js'
import { determineSelectorVariant } from '../src/loaderInternals.js'
import type { LoaderContext, Module } from 'webpack'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

type MockLoaderContext = Partial<LoaderContext<KnightedCssLoaderOptions>> & {
  added: Set<string>
}

type LoaderCallback = (
  error: Error | null,
  result?: string | Buffer,
  sourceMap?: object | null,
  module?: Module,
) => void

function createMockContext(
  overrides: Partial<LoaderContext<KnightedCssLoaderOptions>> & {
    added?: Set<string>
  } = {},
): MockLoaderContext {
  const added = overrides.added ?? new Set<string>()
  return {
    resourcePath:
      overrides.resourcePath ??
      path.resolve(__dirname, 'fixtures/dialects/basic/entry.js'),
    rootContext: overrides.rootContext ?? path.resolve(__dirname, '..'),
    addDependency:
      overrides.addDependency ??
      ((file: string) => {
        added.add(file)
      }),
    getOptions: overrides.getOptions ?? (() => ({}) as KnightedCssLoaderOptions),
    loadModule: overrides.loadModule,
    resourceQuery: overrides.resourceQuery,
    context: overrides.context,
    utils: overrides.utils,
    added,
    ...overrides,
  }
}

test('loader appends CSS export and tracks dependencies', async () => {
  const ctx = createMockContext()
  const source = "export default function Button() { return 'ok' }"
  const output = String(
    await loader.call(ctx as LoaderContext<KnightedCssLoaderOptions>, source),
  )

  assert.match(output, /export const knightedCss = /, 'should inject default export name')
  assert.ok(ctx.added.size > 0, 'should register at least one dependency')
})

test('loader handles style modules and buffer sources', async () => {
  const resourcePath = path.resolve(__dirname, 'fixtures/dialects/vanilla/styles.css.ts')
  const ctx = createMockContext({
    resourcePath,
    rootContext: path.resolve(__dirname, 'fixtures'),
  })
  const source = Buffer.from('export const ignored = true')
  const output = String(
    await loader.call(
      ctx as LoaderContext<KnightedCssLoaderOptions>,
      source as unknown as string,
    ),
  )

  assert.match(output, /export const knightedCss = /, 'should inject css variable export')
  assert.match(output, /module\.exports/, 'should retain vanilla cjs output by default')
  assert.match(output, /styles_themeClass__/, 'should compile vanilla-extract styles')
  assert.ok(
    ctx.added.has(resourcePath),
    'should register the style module as a dependency',
  )
})

test('loader transforms vanilla modules to esm when opted in', async () => {
  const resourcePath = path.resolve(__dirname, 'fixtures/dialects/vanilla/styles.css.ts')
  const ctx = createMockContext({
    resourcePath,
    rootContext: path.resolve(__dirname, 'fixtures'),
    getOptions: () => ({ vanilla: { transformToEsm: true } }),
  })
  const output = String(
    await loader.call(
      ctx as LoaderContext<KnightedCssLoaderOptions>,
      'export const ignored = true',
    ),
  )

  assert.match(output, /export const knightedCss = /, 'should inject css variable export')
  assert.ok(!/module\.exports\s*=/.test(output), 'should remove cjs export boilerplate')
  assert.match(output, /export \{ badge, themeClass, token, vars \};/)
})

test('loader leaves vanilla modules without exports untouched during esm transform', async () => {
  const resourcePath = path.resolve(
    __dirname,
    'fixtures/dialects/vanilla/global-only.css.ts',
  )
  const ctx = createMockContext({
    resourcePath,
    rootContext: path.resolve(__dirname, 'fixtures'),
    getOptions: () => ({ vanilla: { transformToEsm: true } }),
  })
  const output = String(
    await loader.call(
      ctx as LoaderContext<KnightedCssLoaderOptions>,
      'export const ignored = true',
    ),
  )

  assert.match(
    output,
    /require\("@vanilla-extract\/css"\)/,
    'should retain cjs require calls',
  )
  assert.ok(!/export \{/.test(output), 'should not emit esm re-export block')
})

test('loader reads options from getOptions and honors cwd override', async () => {
  const resourcePath = path.resolve(__dirname, 'fixtures/dialects/basic/entry.js')
  const cwd = path.resolve(__dirname, 'fixtures')
  const ctx = createMockContext({
    resourcePath,
    rootContext: undefined,
    getOptions: () => ({ cwd }),
  })
  const output = String(
    await loader.call(
      ctx as LoaderContext<KnightedCssLoaderOptions>,
      "export const noop = ''",
    ),
  )

  assert.match(output, /export const knightedCss = /, 'should inject css variable export')
  assert.ok(
    [...ctx.added].every(file => file.startsWith(cwd)),
    'should register dependencies relative to provided cwd',
  )
})

test('loader falls back to process.cwd when no cwd hints are provided', async () => {
  const resourcePath = path.resolve(__dirname, 'fixtures/dialects/basic/entry.js')
  const ctx = createMockContext({
    resourcePath,
    rootContext: undefined,
    getOptions: () => ({}),
  })
  const output = String(
    await loader.call(
      ctx as LoaderContext<KnightedCssLoaderOptions>,
      "export const noop = ''",
    ),
  )

  assert.match(output, /export const knightedCss = /, 'should inject css variable export')
  assert.ok(ctx.added.size > 0, 'should still register dependencies')
})

test('loader emits stableSelectors export when ?types flag is present', async () => {
  const resourcePath = path.resolve(__dirname, 'fixtures/dialects/basic/entry.js')
  const ctx = createMockContext({
    resourcePath,
    resourceQuery: '?knighted-css&types',
  })
  const output = String(
    await loader.call(
      ctx as LoaderContext<KnightedCssLoaderOptions>,
      "export const noop = ''",
    ),
  )

  assert.match(output, /export const stableSelectors = /)
  assert.match(
    output,
    /export const stableSelectors = Object\.freeze\(\{\s*"demo": "knighted-demo",\s*"icon": "knighted-icon"\s*\}\);/,
    'should emit map of detected selectors using default namespace',
  )
})

test('loader respects stableNamespace loader option', async () => {
  const resourcePath = path.resolve(__dirname, 'fixtures/dialects/basic/entry.js')
  const ctx = createMockContext({
    resourcePath,
    resourceQuery: '?knighted-css&types',
    getOptions: () => ({ stableNamespace: 'acme' }),
  })
  const output = String(
    await loader.call(
      ctx as LoaderContext<KnightedCssLoaderOptions>,
      "export const noop = ''",
    ),
  )

  assert.match(
    output,
    /export const stableSelectors = Object\.freeze\(\{\s*"card": "acme-card"\s*\}\);/,
    'should scope selector discovery to provided namespace',
  )
})

test('loader warns when stableNamespace option resolves to empty value', async () => {
  const resourcePath = path.resolve(__dirname, 'fixtures/dialects/basic/entry.js')
  const warnings: string[] = []
  const ctx = createMockContext({
    resourcePath,
    resourceQuery: '?knighted-css&types',
    getOptions: () => ({ stableNamespace: '   ' }),
    emitWarning: (err: Error) => {
      warnings.push(err.message)
    },
  })
  const output = String(
    await loader.call(
      ctx as LoaderContext<KnightedCssLoaderOptions>,
      "export const noop = ''",
    ),
  )

  assert.match(output, /export const stableSelectors = Object\.freeze\(\{\}\);/)
  assert.equal(warnings.length, 1)
  assert.match(
    warnings[0] ?? '',
    /empty value/,
    'warning should describe empty namespace configuration',
  )
})

test('pitch returns combined module when query includes combined flag', async () => {
  const resourcePath = path.resolve(__dirname, 'fixtures/dialects/basic/entry.js')
  const ctx = createMockContext({
    resourcePath,
    resourceQuery: '?knighted-css&combined',
    loadModule: (_request: string, callback: LoaderCallback) => {
      callback(null, "export const Button = () => 'ok';")
    },
  })

  const result = await pitch.call(
    ctx as LoaderContext<KnightedCssLoaderOptions>,
    `${resourcePath}?knighted-css&combined`,
    '',
    {},
  )

  const combinedOutput = String(result ?? '')

  assert.match(combinedOutput, /import \* as __knightedModule from/)
  assert.match(combinedOutput, /export \* from/)
  assert.match(combinedOutput, /export default __knightedDefault/)
  assert.match(combinedOutput, /export const knightedCss = /)
  assert.ok(ctx.added.size > 0, 'pitch should still register dependencies')
})

test('pitch injects stableSelectors export when combined types query is used', async () => {
  const resourcePath = path.resolve(__dirname, 'fixtures/dialects/basic/entry.js')
  const ctx = createMockContext({
    resourcePath,
    resourceQuery: '?knighted-css&combined&types',
    loadModule: (_request: string, callback: LoaderCallback) => {
      callback(null, 'export const Button = () => "ok";')
    },
  })

  const result = await pitch.call(
    ctx as LoaderContext<KnightedCssLoaderOptions>,
    `${resourcePath}?knighted-css&combined&types`,
    '',
    {},
  )

  const combinedOutput = String(result ?? '')
  assert.match(
    combinedOutput,
    /export const stableSelectors = Object\.freeze\(\{\s*"demo": "knighted-demo",\s*"icon": "knighted-icon"\s*\}\);/,
    'combined proxy should forward stable selector map',
  )
})

test('pitch returns undefined when combined flag is missing', async () => {
  const resourcePath = path.resolve(__dirname, 'fixtures/dialects/basic/entry.js')
  const ctx = createMockContext({
    resourcePath,
    resourceQuery: '?knighted-css',
  })

  const result = await pitch.call(
    ctx as LoaderContext<KnightedCssLoaderOptions>,
    `${resourcePath}?knighted-css`,
    '',
    {},
  )

  assert.equal(result, undefined)
  assert.equal(ctx.added.size, 0, 'pitch should exit before tracking dependencies')
})

test('pitch contextifies proxy request when loader utils are available', async () => {
  const resourcePath = path.resolve(__dirname, 'fixtures/dialects/basic/entry.js')
  const contextPath = path.resolve(__dirname, 'fixtures')
  const calls: Array<{ context: string; request: string }> = []
  const ctx = createMockContext({
    resourcePath,
    context: contextPath,
    resourceQuery: '?knighted-css&combined&chunk=demo',
    utils: {
      contextify: (ctxPath: string, request: string) => {
        calls.push({ context: ctxPath, request })
        return './__contextified__'
      },
    } as LoaderContext<unknown>['utils'],
  })

  const result = await pitch.call(
    ctx as LoaderContext<KnightedCssLoaderOptions>,
    `${resourcePath}?knighted-css&combined&chunk=demo`,
    '',
    {},
  )

  const combinedOutput = String(result ?? '')

  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.context, contextPath)
  assert.equal(calls[0]?.request, `${resourcePath}?chunk=demo`)
  assert.match(
    combinedOutput,
    /import \* as __knightedModule from "\.\/__contextified__";/,
  )
  assert.match(combinedOutput, /export \* from "\.\/__contextified__";/)
})

test('pitch preserves undecodable query fragments when sanitizing requests', async () => {
  const resourcePath = path.resolve(__dirname, 'fixtures/dialects/basic/entry.js')
  const ctx = createMockContext({
    resourcePath,
    resourceQuery: '?knighted-css&combined&%',
  })

  const result = await pitch.call(
    ctx as LoaderContext<KnightedCssLoaderOptions>,
    `${resourcePath}?knighted-css&combined&%`,
    '',
    {},
  )

  assert.ok(
    result?.includes('?%'),
    'should keep undecodable fragment in the proxy request',
  )
})

test('pitch rewrites rawRequest relative to the resource when building proxy module', async () => {
  const resourcePath = path.resolve(__dirname, 'fixtures/dialects/basic/entry.js')
  const ctx = createMockContext({
    resourcePath,
    resourceQuery: '?knighted-css&combined&chunk=demo',
    _module: {
      rawRequest: './aliased/entry.js?loaderFlag=1',
    } as LoaderContext<KnightedCssLoaderOptions>['_module'],
    loadModule: (_request: string, callback: LoaderCallback) => {
      callback(null, 'export const stub = 1;')
    },
  })

  const result = await pitch.call(
    ctx as LoaderContext<KnightedCssLoaderOptions>,
    `${resourcePath}?knighted-css&combined&chunk=demo`,
    '',
    {},
  )

  const combinedOutput = String(result ?? '')
  assert.match(
    combinedOutput,
    /import \* as __knightedModule from "\.\/entry\.js\?chunk=demo";/,
  )
  assert.match(combinedOutput, /export \* from "\.\/entry\.js\?chunk=demo";/)
})

test('pitch rewrites relative rawRequest specifiers to resource-local paths', async () => {
  const resourcePath = path.resolve(__dirname, 'fixtures/dialects/basic/entry.js')
  const ctx = createMockContext({
    resourcePath,
    context: path.dirname(resourcePath),
    resourceQuery: '?knighted-css&combined',
    _module: {
      rawRequest: './components/entry.js?knighted-css&combined',
    } as LoaderContext<KnightedCssLoaderOptions>['_module'],
    loadModule: (_request: string, callback: LoaderCallback) => {
      callback(null, 'export const stub = 1;')
    },
  })

  const result = await pitch.call(
    ctx as LoaderContext<KnightedCssLoaderOptions>,
    `${resourcePath}?knighted-css&combined`,
    '',
    {},
  )

  const combinedOutput = String(result ?? '')
  assert.match(
    combinedOutput,
    /import \* as __knightedModule from "\.\/entry\.js";/,
    'should rebase proxy specifier next to the resource',
  )
  assert.match(combinedOutput, /export \* from "\.\/entry\.js";/)
})

test('pitch preserves inline loader prefixes while rebasing relative specifiers', async () => {
  const resourcePath = path.resolve(__dirname, 'fixtures/dialects/basic/entry.js')
  const ctx = createMockContext({
    resourcePath,
    context: path.dirname(resourcePath),
    resourceQuery: '?knighted-css&combined&chunk=demo',
    _module: {
      rawRequest: 'style-loader!./components/entry.js?knighted-css&combined&chunk=demo',
    } as LoaderContext<KnightedCssLoaderOptions>['_module'],
    loadModule: (_request: string, callback: LoaderCallback) => {
      callback(null, 'export const stub = 1;')
    },
  })

  const result = await pitch.call(
    ctx as LoaderContext<KnightedCssLoaderOptions>,
    `${resourcePath}?knighted-css&combined&chunk=demo`,
    '',
    {},
  )

  const combinedOutput = String(result ?? '')
  assert.match(
    combinedOutput,
    /import \* as __knightedModule from "style-loader!\.\/entry\.js\?chunk=demo";/,
    'should retain loader prefixes but drop the duplicated folder segment',
  )
  assert.match(combinedOutput, /export \* from "style-loader!\.\/entry\.js\?chunk=demo";/)
})

test('combined modules skip default export for vanilla style entries', async () => {
  const resourcePath = path.resolve(__dirname, 'fixtures/dialects/vanilla/styles.css.ts')
  const ctx = createMockContext({
    resourcePath,
    resourceQuery: '?knighted-css&combined',
    loadModule: (_request: string, callback: LoaderCallback) => {
      callback(null, 'export const badge = 1;')
    },
  })

  const result = await pitch.call(
    ctx as LoaderContext<KnightedCssLoaderOptions>,
    `${resourcePath}?knighted-css&combined`,
    '',
    {},
  )

  const combinedOutput = String(result ?? '')
  assert.ok(!/export default __knightedDefault/.test(combinedOutput))
  assert.match(combinedOutput, /export \* from/)
})

test('combined proxy forwards default export when source module has one', async () => {
  const resourcePath = path.resolve(__dirname, 'fixtures/combined/default-export.ts')
  const ctx = createMockContext({
    resourcePath,
    resourceQuery: '?knighted-css&combined',
    loadModule: (_request: string, callback: LoaderCallback) => {
      callback(
        null,
        "export default function Demo() { return 'ok' }; export const helper = () => 'helper';",
      )
    },
  })

  const result = await pitch.call(
    ctx as LoaderContext<KnightedCssLoaderOptions>,
    `${resourcePath}?knighted-css&combined`,
    '',
    {},
  )

  const combinedOutput = String(result ?? '')
  assert.match(
    combinedOutput,
    /export default __knightedDefault/,
    'should emit synthetic default',
  )
  assert.match(combinedOutput, /export const knightedCss = /)
})

test('combined proxy omits synthetic default when named-only flag is provided', async () => {
  const resourcePath = path.resolve(__dirname, 'fixtures/combined/named-only.ts')
  const ctx = createMockContext({
    resourcePath,
    resourceQuery: '?knighted-css&combined&named-only',
    loadModule: (_request: string, callback: LoaderCallback) => {
      callback(null, 'export const alpha = 1; export const beta = 2;')
    },
  })

  const result = await pitch.call(
    ctx as LoaderContext<KnightedCssLoaderOptions>,
    `${resourcePath}?knighted-css&combined&named-only`,
    '',
    {},
  )

  const combinedOutput = String(result ?? '')
  assert.ok(
    !/export default __knightedDefault/.test(combinedOutput),
    'named-only variant should not synthesize a default export',
  )
  assert.match(combinedOutput, /export const knightedCss = /)
})

test('combined&types proxy surfaces runtime stableSelectors export', async () => {
  const resourcePath = path.resolve(__dirname, 'fixtures/dialects/basic/entry.js')
  const ctx = createMockContext({
    resourcePath,
    resourceQuery: '?knighted-css&combined&types',
    loadModule: (_request: string, callback: LoaderCallback) => {
      callback(null, 'export const Button = () => null;')
    },
  })

  const result = await pitch.call(
    ctx as LoaderContext<KnightedCssLoaderOptions>,
    `${resourcePath}?knighted-css&combined&types`,
    '',
    {},
  )

  const combinedOutput = String(result ?? '')
  assert.match(
    combinedOutput,
    /export const stableSelectors = Object\.freeze\(\{[^}]+\}\);/,
  )
  assert.match(combinedOutput, /export const knightedCss = /)
})

test('determineSelectorVariant maps query combinations to expected variants', () => {
  assert.equal(determineSelectorVariant('?knighted-css&types'), 'types')
  assert.equal(determineSelectorVariant('?knighted-css&combined'), 'combined')
  assert.equal(
    determineSelectorVariant('?knighted-css&combined&named-only'),
    'combinedWithoutDefault',
  )
  assert.equal(
    determineSelectorVariant('?knighted-css&combined&no-default'),
    'combinedWithoutDefault',
  )
})
