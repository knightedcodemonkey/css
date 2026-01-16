import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import type { LoaderContext } from 'webpack'

import loader, { type KnightedCssLoaderOptions } from '../src/loader.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

type MockCtx = Partial<LoaderContext<KnightedCssLoaderOptions>> & { added: Set<string> }

function createMockCtx(
  overrides: Partial<LoaderContext<KnightedCssLoaderOptions>> = {},
): MockCtx {
  const added = new Set<string>()
  return {
    resourcePath:
      overrides.resourcePath ??
      path.resolve(__dirname, 'fixtures/auto-stable/modules/button.module.css'),
    rootContext: overrides.rootContext ?? path.resolve(__dirname, 'fixtures'),
    addDependency: overrides.addDependency ?? ((file: string) => added.add(file)),
    getOptions:
      overrides.getOptions ??
      (() =>
        ({
          autoStable: true,
          lightningcss: { cssModules: true },
        }) as KnightedCssLoaderOptions),
    async: overrides.async,
    callback: overrides.callback,
    resourceQuery: overrides.resourceQuery,
    context: overrides.context,
    utils: overrides.utils,
    added,
    ...overrides,
  }
}

async function runLoader(ctx: MockCtx, source = 'export const noop = true') {
  return String(await loader.call(ctx as LoaderContext<KnightedCssLoaderOptions>, source))
}

test('appends stable classes to CSS Modules exports and injects default', async () => {
  const ctx = createMockCtx()
  const output = await runLoader(ctx)
  const map = extractModulesMap(output)
  const classes = map.button?.split(/\s+/) ?? []
  assert.ok(
    classes.some(cls => cls.startsWith('knighted-button')),
    'should include stable class',
  )
  assert.ok(
    classes.some(cls => cls !== 'knighted-button'),
    'should retain hashed class',
  )
  assert.match(output, /export default knightedCssModules;/)
  assert.match(output, /\.knighted-button/, 'should duplicate selectors in CSS output')
})

test('respects include/exclude filters for exports', async () => {
  const ctx = createMockCtx({
    getOptions: () => ({
      autoStable: { include: /primary/, exclude: /button/ },
      lightningcss: { cssModules: true },
    }),
  })
  const output = await runLoader(ctx)
  const map = extractModulesMap(output)
  assert.match(map.primary ?? '', /knighted-primary/)
  assert.ok(!String(map.button ?? '').includes('knighted-button'))
})

function extractModulesMap(output: string): Record<string, string> {
  const match = /knightedCssModules\s*=\s*(\{[\s\S]*?\})/.exec(output)
  if (!match) return {}
  try {
    return JSON.parse(match[1]) as Record<string, string>
  } catch {
    return {}
  }
}
