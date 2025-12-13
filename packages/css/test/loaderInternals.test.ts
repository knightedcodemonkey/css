import assert from 'node:assert/strict'
import test from 'node:test'

import { __loaderInternals } from '../src/loaderInternals.ts'

test('buildSanitizedQuery strips loader-specific flags', () => {
  const { buildSanitizedQuery } = __loaderInternals
  const query = '?knighted-css&combined&named-only&foo=bar&no-default&baz=qux'
  assert.equal(buildSanitizedQuery(query), '?foo=bar&baz=qux')
})

test('shouldEmitCombinedDefault honors skip flag, detection signals, and css modules', () => {
  const { shouldEmitCombinedDefault } = __loaderInternals

  assert.equal(
    shouldEmitCombinedDefault({
      detection: 'has-default',
      request: 'button.tsx',
      skipSyntheticDefault: true,
    }),
    false,
  )

  assert.equal(
    shouldEmitCombinedDefault({
      detection: 'has-default',
      request: 'button.tsx',
      skipSyntheticDefault: false,
    }),
    true,
  )

  assert.equal(
    shouldEmitCombinedDefault({
      detection: 'no-default',
      request: 'button.tsx',
      skipSyntheticDefault: false,
    }),
    false,
  )

  assert.equal(
    shouldEmitCombinedDefault({
      detection: 'unknown',
      request: 'button.tsx',
      skipSyntheticDefault: false,
    }),
    true,
  )

  assert.equal(
    shouldEmitCombinedDefault({
      detection: 'unknown',
      request: 'styles.css.ts',
      skipSyntheticDefault: false,
    }),
    false,
  )
})
