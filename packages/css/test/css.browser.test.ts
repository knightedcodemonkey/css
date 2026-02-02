import assert from 'node:assert/strict'
import test from 'node:test'

import { cssFromSource } from '../src/browser.ts'

test('cssFromSource returns css for plain dialect', async () => {
  const result = await cssFromSource('.demo { color: rebeccapurple; }', {
    dialect: 'css',
  })
  assert.equal(result.ok, true)
  if (!result.ok) {
    assert.fail('expected ok result')
  }
  assert.equal(result.css, '.demo { color: rebeccapurple; }')
})

test('cssFromSource uses sass compiler', async () => {
  const result = await cssFromSource('$color: red; .demo { color: $color; }', {
    dialect: 'sass',
    sass: {
      compileStringAsync: async source => ({
        css: source.replace(/\$color/g, 'red'),
      }),
    },
  })
  assert.equal(result.ok, true)
  if (!result.ok) {
    assert.fail('expected ok result')
  }
  assert.equal(result.css, 'red: red; .demo { color: red; }')
})

test('cssFromSource uses sass compileString fallback', async () => {
  const result = await cssFromSource('$color: blue; .demo { color: $color; }', {
    dialect: 'sass',
    sass: {
      compileString: source => ({
        css: { toString: () => source.replace(/\$color/g, 'blue') },
      }),
    },
  })
  assert.equal(result.ok, true)
  if (!result.ok) {
    assert.fail('expected ok result')
  }
  assert.equal(result.css, 'blue: blue; .demo { color: blue; }')
})

test('cssFromSource stringifies non-string sass results', async () => {
  const result = await cssFromSource('$color: teal;', {
    dialect: 'sass',
    sass: {
      compile: () => ({ css: {} as unknown as string }),
    },
  })
  assert.equal(result.ok, true)
  if (!result.ok) {
    assert.fail('expected ok result')
  }
  assert.equal(result.css, '[object Object]')
})

test('cssFromSource reports missing sass compiler', async () => {
  const result = await cssFromSource('$color: red;', {
    dialect: 'sass',
  })
  assert.equal(result.ok, false)
  if (result.ok) {
    assert.fail('expected error result')
  }
  assert.match(result.error.message, /Missing Sass compiler/i)
})

test('cssFromSource reports non-object errors', async () => {
  const result = await cssFromSource('$color: red;', {
    dialect: 'sass',
    sass: {
      compile: () => {
        throw 'sass boom'
      },
    },
  })
  assert.equal(result.ok, false)
  if (result.ok) {
    assert.fail('expected error result')
  }
  assert.equal(result.error.message, 'sass boom')
})

test('cssFromSource uses less compiler', async () => {
  const result = await cssFromSource('@color: #fff; .demo { color: @color; }', {
    dialect: 'less',
    less: {
      render: async source => ({
        css: source.replace(/@color/g, '#fff'),
      }),
    },
  })
  assert.equal(result.ok, true)
  if (!result.ok) {
    assert.fail('expected ok result')
  }
  assert.equal(result.css, '#fff: #fff; .demo { color: #fff; }')
})

test('cssFromSource reports missing less compiler', async () => {
  const result = await cssFromSource('@color: #fff;', {
    dialect: 'less',
  })
  assert.equal(result.ok, false)
  if (result.ok) {
    assert.fail('expected error result')
  }
  assert.match(result.error.message, /Missing Less compiler/i)
})

test('cssFromSource preserves error codes from less compiler', async () => {
  const result = await cssFromSource('@color: #fff;', {
    dialect: 'less',
    less: {
      render: async () => {
        const error = new Error('less failed') as Error & { code?: string }
        error.code = 'LESS_FAIL'
        throw error
      },
    },
  })
  assert.equal(result.ok, false)
  if (result.ok) {
    assert.fail('expected error result')
  }
  assert.equal(result.error.code, 'LESS_FAIL')
})

test('cssFromSource uses lightningcss for css modules', async () => {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const result = await cssFromSource('.demo { color: green; }', {
    dialect: 'module',
    filename: 'custom.css',
    lightningcss: {
      transform: ({ code, cssModules, filename }) => {
        assert.equal(cssModules, true)
        assert.equal(filename, 'custom.css')
        const decoded = decoder.decode(code)
        return {
          code: encoder.encode(decoded.replace('green', 'teal')),
          exports: { demo: 'demo_hash' },
        }
      },
    },
  })
  assert.equal(result.ok, true)
  if (!result.ok) {
    assert.fail('expected ok result')
  }
  assert.equal(result.css, '.demo { color: teal; }')
  assert.deepEqual(result.exports, { demo: 'demo_hash' })
})

test('cssFromSource reports missing lightningcss compiler', async () => {
  const result = await cssFromSource('.demo { color: green; }', {
    dialect: 'module',
  })
  assert.equal(result.ok, false)
  if (result.ok) {
    assert.fail('expected error result')
  }
  assert.match(result.error.message, /Missing Lightning CSS WASM/i)
})
