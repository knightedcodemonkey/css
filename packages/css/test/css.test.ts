import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { css, cssWithMeta, DEFAULT_EXTENSIONS } from '../src/css.ts'
import { buildSpecificityVisitor, serializeSelector } from '../src/helpers.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const fixturesDir = path.resolve(__dirname, './fixtures/dialects')
const basicEntry = path.join(fixturesDir, 'basic/entry.js')
const basicCss = path.join(fixturesDir, 'basic/styles.css')
const sassEntry = path.join(fixturesDir, 'sass/styles.scss')
const sassIndentedEntry = path.join(fixturesDir, 'sass/indented.sass')
const lessEntry = path.join(fixturesDir, 'less/theme.less')
const vanillaEntry = path.join(fixturesDir, 'vanilla/styles.css.ts')
const miscFixturesDir = path.resolve(__dirname, './fixtures/misc')
const selectorsCss = path.join(miscFixturesDir, 'selectors.css')
const unsupportedStyle = path.join(miscFixturesDir, 'unsupported.noop')
const pkgAliasDir = path.resolve(__dirname, './fixtures/pkg-alias')
const pkgAliasEntry = path.join(pkgAliasDir, 'entry.scss')

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

test('resolves pkg:# imports natively using oxc-resolver', async () => {
  const result = await css(pkgAliasEntry)

  assert.match(result, /\.alias-demo/)
  assert.match(result, /font-family:\s*["']Space Grotesk["'], sans-serif/)
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

test('supports boolean lightningcss option', async () => {
  const result = await css(basicEntry, { lightningcss: true })
  assert.match(result, /\.demo/)
})

test('composes lightningcss visitors with specificity visitor', async () => {
  const calls: string[] = []
  const result = await css(selectorsCss, {
    lightningcss: {
      visitor: {
        Rule: {
          style(rule) {
            calls.push('user')
            return rule
          },
        },
      },
    },
    specificityBoost: {
      visitor: {
        Rule: {
          style(rule) {
            calls.push('boost')
            return rule
          },
        },
      },
    },
  })
  assert.ok(result.length > 0)
  assert.ok(calls.includes('user'), 'expected user visitor to execute')
  assert.ok(calls.includes('boost'), 'expected specificity visitor to execute')
})

test('applies specificityBoost strategy (repeat-class)', async () => {
  const result = await css(basicEntry, {
    lightningcss: { minify: true, sourceMap: false },
    specificityBoost: {
      strategy: { type: 'repeat-class', times: 1 },
    },
  })
  assert.match(
    result,
    /\.demo\.demo/,
    'expected repeat-class strategy to duplicate the class selector',
  )
})

test('applies specificityBoost strategy (append-where)', async () => {
  const result = await css(basicEntry, {
    lightningcss: { minify: true, sourceMap: false },
    specificityBoost: {
      strategy: { type: 'append-where', token: '.boost' },
    },
  })
  assert.match(
    result,
    /\.demo:where\(\.boost\)/,
    'expected append-where strategy to append :where(.boost)',
  )
})

test('string specificityBoost repeat-class targets matches only', async () => {
  const result = await css(selectorsCss, {
    specificityBoost: {
      strategy: { type: 'repeat-class', times: 1 },
      match: ['match-target'],
    },
  })
  assert.match(result, /\.match-target\.match-target/)
  assert.ok(
    !/\.skip-target\.skip-target/.test(result),
    'skip-target should remain single',
  )
})

test('string specificityBoost append-where targets matches only', async () => {
  const result = await css(selectorsCss, {
    specificityBoost: {
      strategy: { type: 'append-where', token: '.extra' },
      match: [/append-target/],
    },
  })
  assert.match(result, /\.append-target:where\(\.extra\)/)
  assert.ok(
    !/\.append-skip:where\(\.extra\)/.test(result),
    'append-skip should remain unchanged',
  )
})

test('buildSpecificityVisitor repeat-class mutates matching selectors', () => {
  const visitor = buildSpecificityVisitor({
    strategy: { type: 'repeat-class', times: 2 },
    match: ['.never-match', /match-target/],
  })
  assert.ok(visitor?.Rule, 'expected repeat-class visitor to be defined')

  const rule = {
    selectors: [
      [
        { type: 'class', value: 'match-target' },
        { type: 'combinator', value: ' ' },
        { type: 'id', value: 'hero' },
        { type: 'combinator', value: '>' },
        { type: 'type', name: 'button' },
        { type: 'class', value: 'primary' },
        { type: 'pseudo-class', kind: 'hover' },
      ],
      [{ type: 'class', value: 'skip-target' }],
    ],
  }

  type TestRule = typeof rule
  const ruleVisitor = visitor.Rule as unknown as {
    style: (rule: TestRule) => { selectors?: TestRule['selectors'] }
  }
  const updated = ruleVisitor.style(rule)
  const [matchSel, skipSel] = (updated.selectors ?? []) as typeof rule.selectors

  const appended = matchSel.slice(-2)
  assert.equal(appended.length, 2, 'expected two duplicate class nodes')
  for (const node of appended) {
    assert.equal(node.type, 'class')
    assert.equal(node.value, 'primary')
  }
  assert.equal(
    serializeSelector(skipSel),
    '.skip-target',
    'non-matching selectors should remain untouched',
  )
})

test('buildSpecificityVisitor append-where applies token selectively', () => {
  const visitor = buildSpecificityVisitor({
    strategy: { type: 'append-where', token: '.boost' },
    match: ['.unused', /append-target/],
  })
  assert.ok(visitor?.Rule, 'expected append-where visitor')

  const rule = {
    selectors: [
      [{ type: 'class', value: 'append-target' }],
      [{ type: 'class', value: 'append-skip' }],
    ],
  }

  type TestRule = typeof rule
  const ruleVisitor = visitor.Rule as unknown as {
    style: (rule: TestRule) => { selectors?: TestRule['selectors'] }
  }
  const updated = ruleVisitor.style(rule)
  const [matchSel, skipSel] = (updated.selectors ?? []) as typeof rule.selectors

  const pseudo = matchSel.at(-1) as
    | { type?: string; kind?: string; selectors?: unknown }
    | undefined
  assert.equal(pseudo?.type, 'pseudo-class', 'expected pseudo-class at end of selector')
  assert.equal(pseudo?.kind, 'where')
  assert.deepEqual(pseudo?.selectors, [[{ type: 'class', value: 'boost' }]])
  assert.equal(
    serializeSelector(skipSel),
    '.append-skip',
    'non-matching selectors should remain unchanged',
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

test('skips unsupported extensions while tracking files', async () => {
  const result = await cssWithMeta(unsupportedStyle, {
    extensions: ['.noop'],
  })
  assert.equal(result.css, '')
  assert.ok(
    result.files.some(file => file.endsWith('unsupported.noop')),
    'expected unsupported file to still be reported',
  )
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

test('rethrows unexpected optional peer errors', async () => {
  await assert.rejects(
    () =>
      css(lessEntry, {
        peerResolver: async name => {
          if (name === 'less') {
            const err = new Error('permission denied') as NodeJS.ErrnoException
            err.code = 'EACCES'
            throw err
          }
          throw new Error(`unexpected module: ${name}`)
        },
      }),
    (error: Error) => {
      assert.match(error.message, /permission denied/)
      return true
    },
  )
})

test('throws when vanilla-extract helpers are missing', async () => {
  await assert.rejects(
    () =>
      css(vanillaEntry, {
        peerResolver: async name => {
          if (name === '@vanilla-extract/integration') {
            return {}
          }
          throw new Error(`unexpected module: ${name}`)
        },
      }),
    /Unable to load/,
  )
})

test('cssWithMeta includes dependency file list', async () => {
  const result = await cssWithMeta(basicEntry)
  assert.ok(result.css.includes('.demo'))
  assert.ok(
    result.files.some(file => file.endsWith('styles.css')),
    'expected dependency list to include styles.css',
  )
})
