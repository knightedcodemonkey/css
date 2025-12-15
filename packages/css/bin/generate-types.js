#!/usr/bin/env node

import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distPath = path.resolve(__dirname, '../dist/generateTypes.js')

async function main() {
  try {
    const mod = await import(pathToFileURL(distPath).href)
    const runner =
      typeof mod.runGenerateTypesCli === 'function'
        ? mod.runGenerateTypesCli
        : typeof mod.default === 'function'
          ? mod.default
          : undefined
    if (typeof runner !== 'function') {
      console.error('[knighted-css] Unable to load generateTypes CLI entry point.')
      process.exitCode = 1
      return
    }
    await runner(process.argv.slice(2))
  } catch (error) {
    console.error('[knighted-css] Failed to run generateTypes CLI.')
    console.error(error)
    process.exitCode = 1
  }
}

void main()
