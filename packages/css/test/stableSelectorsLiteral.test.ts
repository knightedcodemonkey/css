import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildStableSelectorsLiteral,
  __stableSelectorsLiteralInternals,
} from '../src/stableSelectorsLiteral.ts'

test('buildStableSelectorsLiteral warns when namespace is empty', () => {
  const warnings: string[] = []
  const result = buildStableSelectorsLiteral({
    css: '.knighted-card {}',
    namespace: '   ',
    resourcePath: 'demo.css',
    emitWarning: message => warnings.push(message),
  })
  assert.equal(
    result.literal.trim(),
    'export const stableSelectors = Object.freeze({}) as const;',
  )
  assert.equal(result.selectorMap.size, 0)
  assert.equal(warnings.length, 1)
})

test('buildStableSelectorsLiteral emits JS-friendly literal when requested', () => {
  const result = buildStableSelectorsLiteral({
    css: '.knighted-card {}',
    namespace: 'knighted',
    resourcePath: 'demo.css',
    emitWarning: () => {},
    target: 'js',
  })
  assert.match(result.literal, /export const stableSelectors = Object\.freeze/)
  assert.ok(!result.literal.includes('as const'))
})

test('collectStableSelectors captures selectors and formats map output', () => {
  const { collectStableSelectors, formatStableSelectorMap } =
    __stableSelectorsLiteralInternals
  const css = '.knighted-card {} .knighted-badge {}'
  const map = collectStableSelectors(css, 'knighted')
  assert.equal(map.size, 2)
  assert.equal(map.get('card'), 'knighted-card')
  const formatted = formatStableSelectorMap(map)
  assert.match(formatted, /"badge": "knighted-badge"/)
  assert.match(formatted, /"card": "knighted-card"/)
})

test('collectStableSelectorsByRegex handles parser fallbacks', () => {
  const { collectStableSelectorsByRegex } = __stableSelectorsLiteralInternals
  const css = '.custom-card {} .custom-chip {}'
  const map = collectStableSelectorsByRegex(css, 'custom')
  assert.equal(map.size, 2)
  assert.equal(map.get('chip'), 'custom-chip')
})
