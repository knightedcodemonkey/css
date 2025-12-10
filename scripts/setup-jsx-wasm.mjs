#!/usr/bin/env node
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..')
const BINDING_VERSION = process.env.KNIGHTED_JSX_WASM_VERSION ?? '0.99.0'
const NODE_MODULES = path.join(ROOT, 'node_modules')
const bindingDir = path.join(NODE_MODULES, '@oxc-parser', 'binding-wasm32-wasi')
const sentinel = path.join(bindingDir, 'parser.wasi.cjs')

if (existsSync(sentinel)) {
  console.log('[setup:jsx-wasm] Binding already present, skipping install.')
  process.exit(0)
}

const tarball = `oxc-parser-binding-wasm32-wasi-${BINDING_VERSION}.tgz`

function run(command) {
  execSync(command, { cwd: ROOT, stdio: 'inherit' })
}

try {
  console.log(
    `[setup:jsx-wasm] Packing @oxc-parser/binding-wasm32-wasi@${BINDING_VERSION}...`,
  )
  run(`npm pack @oxc-parser/binding-wasm32-wasi@${BINDING_VERSION}`)

  mkdirSync(bindingDir, { recursive: true })

  console.log('[setup:jsx-wasm] Extracting tarball into node_modules...')
  run(`tar -xzf ${tarball} -C ${bindingDir} --strip-components=1`)

  console.log('[setup:jsx-wasm] Cleaning up tarball...')
  rmSync(path.join(ROOT, tarball))

  console.log('[setup:jsx-wasm] Installed WASM parser binding successfully.')
} catch (error) {
  console.error('[setup:jsx-wasm] Failed to install WASM binding:', error)
  process.exitCode = 1
}
