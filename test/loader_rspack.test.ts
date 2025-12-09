import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import test from 'node:test'

import { rspack } from '@rspack/core'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const require = createRequire(import.meta.url)
const fixtureDir = path.resolve(__dirname, './fixtures/loader-rspack')
const distDir = path.join(fixtureDir, 'dist')

test('loader supports exportName override via query (rspack)', async () => {
  await fs.rm(distDir, { recursive: true, force: true })

  const configModule = await import(
    pathToFileURL(path.join(fixtureDir, 'rspack.config.js')).href
  )
  const config = configModule.default ?? configModule
  const compiler = rspack(config)

  await new Promise((resolve, reject) => {
    compiler.run((err, result) => {
      compiler.close(closeErr => {
        if (err) return reject(err)
        if (closeErr) return reject(closeErr)
        resolve(result)
      })
    })
  })

  const bundlePath = path.join(distDir, 'bundle.js')
  const mod = require(bundlePath)

  assert.ok(typeof mod.reactStyles === 'string', 'export should be a string')
  assert.match(
    mod.reactStyles,
    /\.rspack-loader-style/,
    'should contain compiled css from styles.css',
  )

  await fs.rm(distDir, { recursive: true, force: true })
})
