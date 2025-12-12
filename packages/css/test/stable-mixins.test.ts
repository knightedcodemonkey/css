import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as sass from 'sass'

const testDir = fileURLToPath(new URL('.', import.meta.url))
const packageRoot = path.resolve(testDir, '..')
const loadPaths = [packageRoot]

test('stable mixin duplicates the current selector', () => {
  const source = `@use 'stable' as knighted;
.button { @include knighted.stable('button') { color: teal; } }`
  const { css } = sass.compileString(source, { style: 'expanded', loadPaths })
  assert.match(css, /.button,\s*\.knighted-button\s*{[^}]*color: teal;/)
})

test('stable-only emits only the deterministic selector', () => {
  const source = `@use 'stable' as knighted;
@include knighted.stable-only('card') { border: 1px solid red; }`
  const { css } = sass.compileString(source, { style: 'expanded', loadPaths })
  assert.match(css, /^\.knighted-card\s*{[^}]*border: 1px solid red;/m)
})
