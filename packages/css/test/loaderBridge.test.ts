import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
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

test('pitch returns combined module wrapper when combined flag is present', async () => {
  const ctx = createMockContext({
    resourceQuery: '?knighted-css&combined',
    _module: {
      rawRequest: './styles.module.css?knighted-css&combined',
    } as unknown as LoaderContext<KnightedCssBridgeLoaderOptions>['_module'],
  })

  const result = await pitch.call(
    ctx as LoaderContext<KnightedCssBridgeLoaderOptions>,
    './styles.module.css?knighted-css&combined',
    '',
    {},
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

  const result = await pitch.call(
    ctx as LoaderContext<KnightedCssBridgeLoaderOptions>,
    './styles.module.css?knighted-css',
    '',
    {},
  )

  const output = String(result ?? '')
  assert.match(output, /export default __knightedCss/)
  assert.ok(!/knightedCssModules/.test(output))
})

test('pitch warns when types query is used', async () => {
  const ctx = createMockContext({
    resourceQuery: '?knighted-css&types',
  })

  await pitch.call(
    ctx as LoaderContext<KnightedCssBridgeLoaderOptions>,
    './styles.module.css?knighted-css&types',
    '',
    {},
  )

  assert.equal(ctx.warnings.length, 1)
  assert.match(ctx.warnings[0] ?? '', /does not generate stableSelectors/)
})
