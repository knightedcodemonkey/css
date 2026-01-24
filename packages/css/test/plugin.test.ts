import assert from 'node:assert/strict'
import test from 'node:test'

import { __knightedCssPluginInternals } from '../src/plugin.ts'

const {
  splitResourceAndQuery,
  hasKnightedCssQuery,
  appendQueryFlag,
  buildSidecarPath,
  isScriptResource,
  isNodeModulesPath,
} = __knightedCssPluginInternals

test('resolver plugin internals parse and append queries', () => {
  assert.deepEqual(splitResourceAndQuery('./button.js'), {
    resource: './button.js',
    query: '',
  })
  assert.deepEqual(splitResourceAndQuery('./button.js?raw=1'), {
    resource: './button.js',
    query: '?raw=1',
  })

  assert.equal(hasKnightedCssQuery('?knighted-css'), true)
  assert.equal(hasKnightedCssQuery('?raw=1&knighted-css'), true)
  assert.equal(hasKnightedCssQuery('?raw=1'), false)

  assert.equal(
    `./button.js${appendQueryFlag('', 'knighted-css')}`,
    './button.js?knighted-css',
  )
  assert.equal(
    `./button.js${appendQueryFlag('?raw=1', 'knighted-css')}`,
    './button.js?raw=1&knighted-css',
  )
})

test('resolver plugin internals identify script paths and sidecars', () => {
  assert.equal(isScriptResource('/tmp/button.tsx'), true)
  assert.equal(isScriptResource('/tmp/button.js'), true)
  assert.equal(isScriptResource('/tmp/button.d.ts'), false)
  assert.equal(isScriptResource('/tmp/styles.css'), false)
  assert.equal(isNodeModulesPath('/tmp/node_modules/pkg/index.js'), true)
  assert.equal(isNodeModulesPath('/tmp/src/button.tsx'), false)

  assert.equal(buildSidecarPath('/tmp/button.tsx'), '/tmp/button.tsx.d.ts')
})
