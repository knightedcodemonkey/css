import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import type { LoaderContext } from 'webpack'

import loader from '../src/loader.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function createMockContext(
  overrides: Partial<LoaderContext<unknown>> & { added?: Set<string> } = {},
): Partial<LoaderContext<unknown>> & { added: Set<string> } {
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
    async: undefined,
    added,
    ...overrides,
  }
}

test('loader appends CSS export and tracks dependencies', async () => {
  const ctx = createMockContext()
  const source = "export default function Button() { return 'ok' }"
  const output = await loader.call(ctx as LoaderContext<unknown>, source)

  assert.match(output, /export const knightedCss = /, 'should inject default export name')
  assert.ok(ctx.added.size > 0, 'should register at least one dependency')
})

test('loader handles style modules and buffer sources', async () => {
  const resourcePath = path.resolve(
    __dirname,
    'fixtures/playwright/src/dialects/vanilla.css.ts',
  )
  const ctx = createMockContext({
    resourcePath,
    rootContext: path.resolve(__dirname, 'fixtures/playwright/src'),
  })
  const source = Buffer.from('export const ignored = true')
  const output = await loader.call(ctx as LoaderContext<unknown>, source)

  assert.match(output, /export const knightedCss = /, 'should inject css variable export')
  assert.match(
    output,
    /export default \{\};/,
    'should emit empty default export for style',
  )
  assert.match(output, /\.pw-vanilla/, 'should compile vanilla-extract styles')
  assert.ok(
    ctx.added.has(resourcePath),
    'should register the style module as a dependency',
  )
})

test('loader reads options from getOptions and honors cwd override', async () => {
  const resourcePath = path.resolve(__dirname, 'fixtures/dialects/basic/entry.js')
  const cwd = path.resolve(__dirname, 'fixtures')
  const ctx = createMockContext({
    resourcePath,
    rootContext: undefined,
    getOptions: () => ({ cwd }),
  })
  const output = await loader.call(
    ctx as LoaderContext<unknown>,
    "export const noop = ''",
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
  const output = await loader.call(
    ctx as LoaderContext<unknown>,
    "export const noop = ''",
  )

  assert.match(output, /export const knightedCss = /, 'should inject css variable export')
  assert.ok(ctx.added.size > 0, 'should still register dependencies')
})
