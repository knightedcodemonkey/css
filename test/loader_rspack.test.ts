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

async function buildFixture() {
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
  const previousSelf = (globalThis as Record<string, unknown>).self
  ;(globalThis as Record<string, unknown>).self = globalThis
  const mod = require(bundlePath)
  ;(globalThis as Record<string, unknown>).self = previousSelf

  // write an index.html into dist for manual browser verification
  const htmlTemplate = await fs.readFile(path.join(fixtureDir, 'index.html'), 'utf8')
  await fs.mkdir(distDir, { recursive: true })
  await fs.writeFile(path.join(distDir, 'index.html'), htmlTemplate, 'utf8')

  return { mod }
}

test('loader supports exportName override via query (rspack)', async () => {
  const { mod } = await buildFixture()

  assert.ok(typeof mod.reactStyles === 'string', 'export should be a string')
  assert.match(
    mod.reactStyles,
    /\.rspack-loader-style/,
    'should contain compiled css from styles.css',
  )

  await fs.rm(distDir, { recursive: true, force: true })
})

test('loader fixture renders style and element (rspack)', async () => {
  const { mod } = await buildFixture()

  const styles: string[] = []
  const appended: Array<{ className?: string; textContent?: string }> = []
  const fakeDocument = {
    head: { append: (el: { textContent?: string }) => styles.push(el.textContent ?? '') },
    body: {
      appendChild: (el: { className?: string; textContent?: string }) =>
        appended.push(el),
    },
    getElementById: (_id: string) => null,
    createElement: (_tag: string) => ({ className: '', textContent: '' }),
  }

  const previousDocument = (globalThis as Record<string, unknown>).document
  ;(globalThis as Record<string, unknown>).document = fakeDocument
  if (typeof mod.renderDemo === 'function') {
    mod.renderDemo()
  }
  ;(globalThis as Record<string, unknown>).document = previousDocument

  assert.ok(
    styles.some(text => text.includes('.rspack-loader-style')),
    'style should be injected',
  )
  assert.ok(
    appended.some(el => el.className === 'rspack-loader-style'),
    'element with expected class should be appended',
  )

  const html = await fs.readFile(path.join(distDir, 'index.html'), 'utf8')
  assert.match(html, /bundle\.js/, 'index.html should reference bundle.js')

  await fs.rm(distDir, { recursive: true, force: true })
})
