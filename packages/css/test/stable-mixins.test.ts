import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import * as sass from 'sass'

const testDir = fileURLToPath(new URL('.', import.meta.url))
const packageRoot = path.resolve(testDir, '..')

const sandboxRoot = mkdtempSync(path.join(os.tmpdir(), 'knighted-css-stable-'))
const scopedPackageDir = path.join(sandboxRoot, '@knighted', 'css')
mkdirSync(scopedPackageDir, { recursive: true })
cpSync(path.join(packageRoot, 'stable'), path.join(scopedPackageDir, 'stable'), {
  recursive: true,
})

const loadPaths = [sandboxRoot]

test.after(() => {
  rmSync(sandboxRoot, { recursive: true, force: true })
})

test('stable mixin duplicates the current selector', () => {
  const source = `@use '@knighted/css/stable' as knighted;
.button { @include knighted.stable('button') { color: teal; } }`
  const { css } = sass.compileString(source, { style: 'expanded', loadPaths })
  assert.match(css, /.button,\s*\.knighted-button\s*{[^}]*color: teal;/)
})

test('stable-only emits only the deterministic selector', () => {
  const source = `@use '@knighted/css/stable' as knighted;
@include knighted.stable-only('card') { border: 1px solid red; }`
  const { css } = sass.compileString(source, { style: 'expanded', loadPaths })
  assert.match(css, /^\.knighted-card\s*{[^}]*border: 1px solid red;/m)
})
