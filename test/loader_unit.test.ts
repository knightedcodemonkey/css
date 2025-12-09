import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import type { LoaderContext } from 'webpack'

import loader from '../src/loader.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function createMockContext(): Partial<LoaderContext<unknown>> & {
  added: Set<string>
} {
  const added = new Set<string>()
  return {
    resourcePath: path.resolve(__dirname, 'fixtures/dialects/basic/entry.js'),
    rootContext: path.resolve(__dirname, '..'),
    addDependency: (file: string) => {
      added.add(file)
    },
    async: undefined,
    added,
  }
}

test('loader appends CSS export and tracks dependencies', async () => {
  const ctx = createMockContext()
  const source = "export default function Button() { return 'ok' }"
  const output = await loader.call(ctx as LoaderContext<unknown>, source)

  assert.match(output, /export const knightedCss = /, 'should inject default export name')
  assert.ok(ctx.added.size > 0, 'should register at least one dependency')
})
