import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createStableClassFactory,
  mergeStableClass,
  stableClass,
  stableClassFromModule,
  stableClassName,
  stableSelector,
  stableToken,
} from '../src/stableSelectors.ts'

test('stableToken applies default namespace and sanitizes tokens', () => {
  const result = stableToken(' hero button ')
  assert.equal(result, 'knighted-hero-button')
})

test('stableToken allows overriding namespace', () => {
  const result = stableToken('cta', { namespace: 'acme' })
  assert.equal(result, 'acme-cta')
})

test('stableToken omits namespace when trimmed value is empty', () => {
  const result = stableToken('cta', { namespace: '   ' })
  assert.equal(result, 'cta')
})

test('stableClass returns a class name without dot', () => {
  assert.equal(stableClass('badge'), 'knighted-badge')
})

test('createStableClassFactory memoizes namespace preference', () => {
  const scoped = createStableClassFactory({ namespace: 'storybook' })
  assert.equal(scoped('chip'), 'storybook-chip')
})

test('stableClassName combines hashed class with stable selector', () => {
  const styles = { badge: 'badge__hashed' }
  const combined = stableClassName(styles, 'badge')
  assert.equal(combined, 'badge__hashed knighted-badge')
})

test('stableClassName falls back when hashed class is missing', () => {
  const styles = { badge: 'badge__hashed' }
  const combined = stableClassName(styles, 'missing', { token: 'pill' })
  assert.equal(combined, 'knighted-pill')
})

test('stableClassFromModule is an alias', () => {
  const styles = { title: 'title__hash' }
  const combined = stableClassFromModule(styles, 'title', { namespace: 'docs' })
  assert.equal(combined, 'title__hash docs-title')
})

test('stableSelector returns a CSS selector string', () => {
  assert.equal(stableSelector('badge'), '.knighted-badge')
})

test('mergeStableClass combines hashed and selector strings', () => {
  const combined = mergeStableClass({
    hashed: 'badge__hash',
    selector: 'storybook-badge',
    token: 'badge',
  })
  assert.equal(combined, 'badge__hash storybook-badge')
})

test('mergeStableClass batch mode merges entire objects', () => {
  const hashed = {
    badge: 'badge__hash',
    cta: ['cta__hash', 'cta__variant'],
  }
  const selectors = {
    badge: 'storybook-badge',
  }
  const combined = mergeStableClass({ hashed, selectors, namespace: 'storybook' })
  assert.deepEqual(combined, {
    badge: 'badge__hash storybook-badge',
    cta: 'cta__hash cta__variant storybook-cta',
  })
})
