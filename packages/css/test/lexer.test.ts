import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'

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
