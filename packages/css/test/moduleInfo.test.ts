import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { __moduleInfoInternals, detectModuleDefaultExport } from '../src/moduleInfo.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const fixturesDir = path.resolve(__dirname, './fixtures/combined')

test('detects default exports in source modules', async () => {
  const target = path.join(fixturesDir, 'default-export.ts')
  const signal = await detectModuleDefaultExport(target)
  assert.equal(signal, 'has-default')
})

test('detects absence of default exports when named bindings exist', async () => {
  const target = path.join(fixturesDir, 'named-only.ts')
  const signal = await detectModuleDefaultExport(target)
  assert.equal(signal, 'no-default')
})

test('returns unknown when module format is not detectable', async () => {
  const target = path.join(fixturesDir, 'commonjs.js')
  const signal = await detectModuleDefaultExport(target)
  assert.equal(signal, 'unknown')
})

test('returns unknown for unsupported extensions', async () => {
  const target = path.join(__dirname, './fixtures/sass-paths/entry.scss')
  const signal = await detectModuleDefaultExport(target)
  assert.equal(signal, 'unknown')
})

test('returns unknown when source file cannot be read', async () => {
  const missing = path.join(fixturesDir, 'does-not-exist.ts')
  const signal = await detectModuleDefaultExport(missing)
  assert.equal(signal, 'unknown')
})

test('falls back to unknown when lexer parse throws', async () => {
  __moduleInfoInternals.setLexerOverrides({
    parse() {
      throw new Error('boom')
    },
  })
  try {
    const target = path.join(fixturesDir, 'named-only.ts')
    const signal = await detectModuleDefaultExport(target)
    assert.equal(signal, 'unknown')
  } finally {
    __moduleInfoInternals.setLexerOverrides()
  }
})
