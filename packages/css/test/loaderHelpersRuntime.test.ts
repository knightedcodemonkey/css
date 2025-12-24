import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'

import { asKnightedCssCombinedModule } from '@knighted/css/loader-helpers'

const testDir = fileURLToPath(new URL('.', import.meta.url))
const fixturesDir = path.join(testDir, 'fixtures/combined')

async function importRuntimeEntry() {
  const fixtureUrl = pathToFileURL(path.join(fixturesDir, 'runtime-entry.ts'))
  return import(fixtureUrl.href)
}

test('asKnightedCssCombinedModule narrows combined & types payloads', async () => {
  const baseModule = await importRuntimeEntry()
  const runtimeSelectors = Object.freeze({
    shell: 'knighted-shell',
    copy: 'knighted-copy',
  })

  const combinedModule = Object.freeze({
    __esModule: true,
    ...baseModule,
    knightedCss: '.combined-runtime { color: rebeccapurple; }',
    stableSelectors: runtimeSelectors,
  })

  const narrowed = asKnightedCssCombinedModule<
    typeof import('./fixtures/combined/runtime-entry.js'),
    { stableSelectors: Readonly<typeof runtimeSelectors> }
  >(combinedModule)

  assert.equal(narrowed.runtimeFeatureFlag, true)
  assert.equal(narrowed.runtimeMeta.tone, 'violet')
  assert.equal(narrowed.default({ label: 'SSR stream' }), 'Runtime card for SSR stream')
  assert.equal(typeof narrowed.CombinedRuntimeDetails(), 'string')
  assert.ok(narrowed.knightedCss.includes('.combined-runtime'))
  assert.strictEqual(narrowed.stableSelectors, runtimeSelectors)
  assert.equal(narrowed.stableSelectors.shell, 'knighted-shell')
})
