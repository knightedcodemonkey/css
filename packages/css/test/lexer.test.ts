import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'

import type { ExportSpecifier, ImportSpecifier } from 'es-module-lexer'
import { ImportType } from 'es-module-lexer'

import { analyzeModule } from '../src/lexer.ts'

test('analyzeModule falls back to oxc for mixed syntax and collects normalized imports', async () => {
  const source = `const literal = require('./styles/literal.css?inline#hash')
const optional = require?.('./styles/optional.css')
const nonNull = require!('./styles/non-null.css')
import styles = require('./styles/import-equals.css')
await import(\`./styles/template.css\`)
import '#hash/map.css?inline'
import 'https://cdn.knighted.dev/remote.css'
import '\0ignored'
export = literal
void optional
void nonNull
void styles
`

  const filePath = path.join(process.cwd(), 'entry.js')
  const result = await analyzeModule(source, filePath, {
    esParse: () => {
      throw new Error('force-oxc')
    },
  })

  assert.equal(result.defaultSignal, 'has-default')
  assert.deepEqual(result.imports.sort(), [
    '#hash/map.css',
    './styles/import-equals.css',
    './styles/literal.css',
    './styles/non-null.css',
    './styles/optional.css',
    './styles/template.css',
  ])
})

test('analyzeModule tracks named-only exports and member requires', async () => {
  const source = `export { named } from './styles/named.css?inline'
export { value as 'default' } from './styles/quoted-default.css'
export { another } from './styles/another.css'
const resolved = require.resolve('./styles/resolved.css')
const spread = require(...['./styles/spread.css'])
import 'http://example.com/remote.css'
void resolved
void spread
`

  const result = await analyzeModule(source, 'entry.ts', {
    esParse: () => {
      throw new Error('force-oxc')
    },
  })

  assert.equal(result.defaultSignal, 'has-default')
  assert.deepEqual(result.imports.sort(), [
    './styles/another.css',
    './styles/named.css',
    './styles/quoted-default.css',
    './styles/resolved.css',
  ])
})

test('analyzeModule uses es-lexer output to normalize imports and exports', async () => {
  const source = `import './styles/base.css?inline#hash'
export const named = 1
`
  const importSpecifiers: ImportSpecifier[] = [
    {
      n: './styles/base.css?inline#hash',
      t: ImportType.Static,
      s: 0,
      e: 0,
      ss: 0,
      se: 0,
      d: -1,
      a: -1,
      at: null,
    },
    {
      n: 'file:///tmp/app.css?raw',
      t: ImportType.Static,
      s: 0,
      e: 0,
      ss: 0,
      se: 0,
      d: -1,
      a: -1,
      at: null,
    },
    {
      n: 'https://example.com/remote.css',
      t: ImportType.Static,
      s: 0,
      e: 0,
      ss: 0,
      se: 0,
      d: -1,
      a: -1,
      at: null,
    },
    {
      n: '\0ignored',
      t: ImportType.Static,
      s: 0,
      e: 0,
      ss: 0,
      se: 0,
      d: -1,
      a: -1,
      at: null,
    },
  ]
  const exportSpecifiers: ExportSpecifier[] = [
    {
      n: 'named',
      ln: undefined,
      s: 0,
      e: 0,
      ls: -1,
      le: -1,
    },
  ]
  const result = await analyzeModule(source, 'entry.js', {
    esParse: () => [importSpecifiers, exportSpecifiers, false, true],
  })

  assert.equal(result.defaultSignal, 'no-default')
  assert.deepEqual(result.imports, ['./styles/base.css', 'file:///tmp/app.css'])
  assert.deepEqual(result.exports, ['named'])
})

test('analyzeModule returns unknown default when exports are empty', async () => {
  const result = await analyzeModule('const value = 1', 'entry.js', {
    esParse: () => [[], [], false, false],
  })

  assert.equal(result.defaultSignal, 'unknown')
  assert.deepEqual(result.imports, [])
  assert.deepEqual(result.exports, [])
})

test('analyzeModule returns empty analysis when oxc parsing fails', async () => {
  const result = await analyzeModule('export {', 'broken.js', {
    esParse: () => {
      throw new Error('force-oxc')
    },
  })

  assert.equal(result.defaultSignal, 'unknown')
  assert.deepEqual(result.imports, [])
  assert.deepEqual(result.exports, [])
})
