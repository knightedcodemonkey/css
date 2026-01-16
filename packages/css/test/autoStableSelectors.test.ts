import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { transform as lightningTransform } from 'lightningcss'

import { buildAutoStableVisitor } from '../src/autoStableSelectors.js'

type StyleRuleParam = { selectors?: unknown; value?: { selectors?: unknown } } | null
type StyleRuleFn = (rule: StyleRuleParam) => unknown
type SelectorNode = { value?: string; name?: string }

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixturesDir = path.resolve(__dirname, 'fixtures', 'auto-stable', 'plain')

function runLightning(
  cssSource: string,
  visitor: ReturnType<typeof buildAutoStableVisitor>,
) {
  const { code } = lightningTransform({
    filename: 'fixture.css',
    code: Buffer.from(cssSource),
    visitor: visitor ?? undefined,
  })
  return code.toString()
}

function getStyle(
  visitor: ReturnType<typeof buildAutoStableVisitor>,
): StyleRuleFn | undefined {
  const rule = visitor?.Rule
  if (rule && typeof rule === 'object' && 'style' in rule) {
    const maybe = (rule as { style?: unknown }).style
    if (typeof maybe === 'function') return maybe as StyleRuleFn
  }
  return undefined
}

function selectorNames(selectors: unknown): string[][] {
  if (!Array.isArray(selectors)) return []
  return selectors.map(sel =>
    Array.isArray(sel)
      ? sel.map(node => {
          const cast = node as SelectorNode
          return cast.value ?? cast.name ?? ''
        })
      : [],
  )
}

test('duplicates class selectors with default namespace', async () => {
  const cssSource = await readFile(path.join(fixturesDir, 'simple.css'), 'utf8')
  const visitor = buildAutoStableVisitor(true)
  const output = runLightning(cssSource, visitor)

  assert.match(output, /\.foo,\s*\.knighted-foo\s*\{[^}]*\}/)
})

test('respects :global scope and nested pseudos', () => {
  const source = `:global(.skip) .foo:hover .bar { color: red; }`
  const visitor = buildAutoStableVisitor({ include: /foo|bar/ })
  const output = runLightning(source, visitor)

  assert.match(
    output,
    /:global\(\.skip\)\s+\.foo:hover\s+\.bar,\s*:global\(\.skip\)\s+\.knighted-foo:hover\s+\.knighted-bar/,
  )
})

test('skips @keyframes and applies include/exclude filters', () => {
  const source = `@keyframes spin { from { opacity: 0; } to { opacity: 1; } }\n.foo { color: red; }\n.bar { color: blue; }`
  const visitor = buildAutoStableVisitor({ include: /foo/, exclude: /bar/ })
  const output = runLightning(source, visitor)

  assert.match(output, /@keyframes spin/)
  assert.doesNotMatch(output, /knighted-spin/)
  assert.match(output, /\.knighted-foo/)
  assert.doesNotMatch(output, /knighted-bar/)
})

test('duplicates nested :is/:where/:has selectors with multiple classes', () => {
  const source = `.foo.bar:hover:is(.baz, .qux .zap:has(.zip)) { color: red; }`
  const visitor = buildAutoStableVisitor(true)
  const output = runLightning(source, visitor)

  assert.match(output, /\.foo\.bar:hover:is\(\.baz, \.qux \.zap:has\(\.zip\)\)/)
  assert.match(
    output,
    /\.knighted-foo\.knighted-bar:hover:is\(\.knighted-baz, \.knighted-qux \.knighted-zap:has\(\.knighted-zip\)\)/,
  )
})

test('honors custom namespace and avoids duplicates when namespace empty', () => {
  const source = `.foo { color: red; }`
  const custom = buildAutoStableVisitor({ namespace: 'custom' })
  const none = buildAutoStableVisitor({ namespace: '' })

  const customOut = runLightning(source, custom)
  assert.match(customOut, /\.custom-foo/)

  const noneOut = runLightning(source, none)
  const selectors = noneOut.match(/\.foo/g) ?? []
  assert.equal(selectors.length, 1, 'no duplicate when stable equals original')
})

test('does not add duplicate when stable selector already present', () => {
  const source = `.foo, .knighted-foo { color: red; }`
  const visitor = buildAutoStableVisitor(true)
  const output = runLightning(source, visitor)
  const matches = output.match(/\.knighted-foo/g) ?? []
  assert.equal(matches.length, 1, 'stable class should not be appended twice')
})

test('handles lightningcss rule objects with value.selectors', () => {
  const visitor = buildAutoStableVisitor(true)
  const rule: StyleRuleParam = {
    value: {
      selectors: [[{ type: 'class', value: 'foo' }]],
    },
  }
  const style = getStyle(visitor)
  const mutated = style ? style(rule) : undefined
  const selectors =
    mutated && typeof mutated === 'object' && 'value' in mutated
      ? (mutated as { value?: { selectors?: unknown } }).value?.selectors
      : undefined
  const serialized = selectorNames(selectors)
  assert.equal(Array.isArray(selectors) ? selectors.length : 0, 2)
  assert.ok(serialized.some(parts => parts?.includes('knighted-foo')))
})

test('returns early when rule is not an object', () => {
  const visitor = buildAutoStableVisitor(true)
  const style = getStyle(visitor)
  const result = style ? style(null as unknown as StyleRuleParam) : undefined
  assert.equal(result, null)
})
