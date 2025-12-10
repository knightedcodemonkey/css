import assert from 'node:assert/strict'
import test from 'node:test'

import { css } from '../src/css'
import { createResolverFixture } from './helpers/resolver-fixture'

const projects = ['rspack', 'vite', 'webpack'] as const

for (const project of projects) {
  test(`supports resolver fixture for ${project}`, async () => {
    const fixture = createResolverFixture(project)
    const result = await css(fixture.entrySpecifier, {
      resolver: fixture.resolver,
    })
    assert.ok(
      result.includes(fixture.expectedSelector),
      `expected ${project} output to include ${fixture.expectedSelector}`,
    )
  })
}
