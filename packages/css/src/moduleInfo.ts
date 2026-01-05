import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type { parse } from 'es-module-lexer'

import { analyzeModule, type DefaultExportSignal } from './lexer.js'

export type ModuleDefaultSignal = DefaultExportSignal

type LexerOverrides = {
  parse?: typeof parse
}

const DETECTABLE_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.mts',
  '.cjs',
  '.cts',
])

let lexerOverrides: LexerOverrides | undefined

export async function detectModuleDefaultExport(
  filePath: string,
): Promise<ModuleDefaultSignal> {
  if (!DETECTABLE_EXTENSIONS.has(path.extname(filePath))) {
    return 'unknown'
  }

  let source: string
  try {
    source = await readFile(filePath, 'utf8')
  } catch {
    return 'unknown'
  }

  try {
    const { defaultSignal } = await analyzeModule(source, filePath, {
      esParse: lexerOverrides?.parse,
    })
    return defaultSignal
  } catch {
    return 'unknown'
  }
}

export const __moduleInfoInternals = {
  setLexerOverrides(overrides?: LexerOverrides) {
    lexerOverrides = overrides
  },
}
