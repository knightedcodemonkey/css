import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { parse } from 'es-module-lexer'

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

test('detects default export in tsx via oxc fallback', async () => {
  const target = path.join(fixturesDir, 'jsx-default.tsx')
  const signal = await detectModuleDefaultExport(target)
  assert.equal(signal, 'has-default')
})

test('skips es-module-lexer for tsx and still detects default', async () => {
  __moduleInfoInternals.setLexerOverrides({
    parse() {
      throw new Error('should not be called for tsx')
    },
  })
  try {
    const target = path.join(fixturesDir, 'jsx-default.tsx')
    const signal = await detectModuleDefaultExport(target)
    assert.equal(signal, 'has-default')
  } finally {
    __moduleInfoInternals.setLexerOverrides()
  }
})

test('falls back to oxc when es-module-lexer chokes on raw jsx', async () => {
  const target = path.join(fixturesDir, 'raw-jsx.js')
  const signal = await detectModuleDefaultExport(target)
  assert.equal(signal, 'has-default')
})

test('non-jsx files still use es-module-lexer path', async () => {
  let called = false
  __moduleInfoInternals.setLexerOverrides({
    parse(source, id) {
      called = true
      return parse(source, id)
    },
  })
  try {
    const target = path.join(fixturesDir, 'default-export.ts')
    const signal = await detectModuleDefaultExport(target)
    assert.equal(signal, 'has-default')
    assert.equal(called, true)
  } finally {
    __moduleInfoInternals.setLexerOverrides()
  }
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
