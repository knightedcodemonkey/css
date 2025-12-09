import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { css, DEFAULT_EXTENSIONS } from '../src/css.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const fixturesDir = path.resolve(__dirname, '../fixtures')
const basicEntry = path.join(fixturesDir, 'basic/entry.js')
const basicCss = path.join(fixturesDir, 'basic/styles.css')
const sassEntry = path.join(fixturesDir, 'sass/styles.scss')
const sassIndentedEntry = path.join(fixturesDir, 'sass/indented.sass')
const lessEntry = path.join(fixturesDir, 'less/theme.less')
const vanillaEntry = path.join(fixturesDir, 'vanilla/styles.css.ts')

test('extracts CSS from JS dependency graph', async () => {
  const result = await css(basicEntry)
  assert.ok(result.includes('.demo'), 'expected output to include .demo selector')
})

test('supports sass compilation', async () => {
  const result = await css(sassEntry)
  assert.match(result, /\.cta\s+\.sass-styles/, 'expected nested selector in output')
  assert.match(result, /box-shadow:\s*0 2px 8px rgba\(0, 0, 0, 0\.1\)/)
})

test('supports indented sass compilation', async () => {
  const result = await css(sassIndentedEntry)
  assert.match(result, /\.sass-indented/)
  assert.match(
    result,
    /content:\s*"Pill"/,
    'expected mixin output to include pseudo content',
  )
  assert.match(result, /padding-inline:\s*1\.25rem/)
})

test('supports less compilation', async () => {
  const result = await css(lessEntry)
  assert.match(result, /\.less-styles/)
  assert.match(result, /transform:\s*translateY\(-1px\)/)
  assert.match(result, /calc\(12px \/ 1\.5\)/)
})

test('supports vanilla-extract css.ts entry', async () => {
  const result = await css(vanillaEntry)
  assert.match(result, /letter-spacing:\s*0\.08em/)
  assert.match(result, /border-radius:\s*999px/)
})

test('accepts direct style files as entry points', async () => {
  const result = await css(basicCss)
  assert.match(result, /\.demo\s*\{/)
})

test('optionally compiles with lightningcss', async () => {
  const result = await css(basicEntry, {
    lightningcss: { minify: true, sourceMap: false },
  })
  assert.ok(result.length > 0)
  assert.ok(
    !/\n{2,}/.test(result),
    'expected lightningcss output to be minified by default',
  )
})

test('filters dependency graph via option', async () => {
  const result = await css(basicEntry, {
    filter: filePath => !filePath.endsWith('styles.css'),
  })
  assert.equal(result.trim(), '', 'filter should exclude styles.css import')
})

test('falls back when resolver returns undefined', async () => {
  const result = await css(basicEntry, {
    resolver: async () => undefined,
  })
  assert.match(result, /\.demo/)
})

test('exposes default extensions', () => {
  assert.deepEqual(DEFAULT_EXTENSIONS, ['.css', '.scss', '.sass', '.less', '.css.ts'])
})

test('throws when optional peer is missing', async () => {
  let error: Error | undefined
  try {
    await css(lessEntry, {
      peerResolver: async name => {
        const err = new Error(`Cannot find module ${name}`) as NodeJS.ErrnoException
        err.code = 'MODULE_NOT_FOUND'
        throw err
      },
    })
  } catch (err) {
    error = err as Error
  }
  assert.ok(error instanceof Error)
  assert.ok(
    /less/i.test(error?.message ?? ''),
    'expected error message to mention missing peer',
  )
})
