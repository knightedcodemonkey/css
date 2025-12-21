import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { cssWithMeta } from '../src/css.js'

import type { LegacyException, LegacyFileOptions, LegacyResult } from 'sass'

type CompileAsyncArgs = Parameters<(typeof import('sass'))['compileAsync']>
type RenderArgs = Parameters<(typeof import('sass'))['render']>

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const sassEntry = path.join(__dirname, 'fixtures/dialects/sass/styles.scss')
const lessEntry = path.join(__dirname, 'fixtures/dialects/less/theme.less')

function createLegacyResult(css: string): LegacyResult {
  const timestamp = Date.now()
  return {
    css: Buffer.from(css),
    map: undefined,
    stats: {
      entry: sassEntry,
      start: timestamp,
      end: timestamp,
      duration: 0,
      includedFiles: [],
    },
  }
}

function createLegacyException(message: string): LegacyException {
  const error = new Error(message) as LegacyException
  error.formatted = message
  error.status = 1
  return error
}

test('compileSass prefers compileAsync from the namespace default export', async () => {
  const calls: CompileAsyncArgs[] = []
  const cssOutput = '.async { color: salmon; }'

  const peerResolver = async (name: string) => {
    assert.equal(name, 'sass')
    return {
      default: {
        compile() {},
        async compileAsync(...args: CompileAsyncArgs) {
          calls.push(args)
          return { css: cssOutput }
        },
      },
    }
  }

  const result = await cssWithMeta(sassEntry, { peerResolver })

  assert.equal(result.css, cssOutput)
  assert.ok(calls.length >= 1)
  const [filePath, options] = calls[0]
  assert.equal(filePath, sassEntry)
  if (!options) {
    assert.fail('compileAsync was invoked without options')
  }
  const loadPaths = Array.isArray(options.loadPaths) ? options.loadPaths : []
  assert.ok(loadPaths.length > 0)
})

test('compileSass falls back to render when compileAsync is missing', async () => {
  const calls: RenderArgs[] = []
  const cssOutput = '.legacy { color: teal; }'

  const peerResolver = async () => ({
    render(options: RenderArgs[0], callback: RenderArgs[1]) {
      calls.push([options, callback])
      setImmediate(() => callback(undefined, createLegacyResult(cssOutput)))
    },
  })

  const result = await cssWithMeta(sassEntry, { peerResolver })

  assert.equal(result.css, cssOutput)
  assert.equal(calls.length, 1)
  const [options] = calls[0] as [LegacyFileOptions<'async'>, RenderArgs[1]]
  assert.equal(options.file, sassEntry)
  assert.ok(Array.isArray(options.includePaths))
})

test('renderLegacySass resolves empty string when result payload is missing', async () => {
  const peerResolver = async () => ({
    render(options: RenderArgs[0], callback: RenderArgs[1]) {
      setImmediate(() => callback(undefined, undefined))
    },
  })

  const result = await cssWithMeta(sassEntry, { peerResolver })

  assert.equal(result.css, '')
})

test('renderLegacySass rejects when the renderer throws', async () => {
  const peerResolver = async () => ({
    render(options: RenderArgs[0], callback: RenderArgs[1]) {
      setImmediate(() => callback(createLegacyException('sass boom')))
    },
  })

  await assert.rejects(() => cssWithMeta(sassEntry, { peerResolver }), /sass boom/)
})

test('compileSass throws when Sass peer lacks supported APIs', async () => {
  const peerResolver = async () => ({})

  await assert.rejects(
    () => cssWithMeta(sassEntry, { peerResolver }),
    /does not expose compileAsync or render APIs/i,
  )
})

test('resolveSassNamespace ignores falsy default exports', async () => {
  const peerResolver = async () => ({
    default: null,
  })

  await assert.rejects(
    () => cssWithMeta(sassEntry, { peerResolver }),
    /does not expose compileAsync or render APIs/i,
  )
})

test('compileLess accepts modules without default exports', async () => {
  const peerResolver = async (name: string) => {
    if (name === 'less') {
      return {
        render() {
          return Promise.resolve({
            css: '.less { color: blue; }',
            map: '',
            imports: [],
          })
        },
      }
    }
    return import(name)
  }

  const result = await cssWithMeta(lessEntry, { peerResolver })

  assert.equal(result.css, '.less { color: blue; }')
})
