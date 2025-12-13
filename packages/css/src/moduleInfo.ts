import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { init, parse } from 'es-module-lexer'

export type ModuleDefaultSignal = 'has-default' | 'no-default' | 'unknown'

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

let lexerInit: Promise<void> | undefined
let lexerOverrides: LexerOverrides | undefined

function ensureLexerInitialized(): Promise<void> {
  if (!lexerInit) {
    lexerInit = init
  }
  return lexerInit
}

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
    await ensureLexerInitialized()
    const [, exports] = (lexerOverrides?.parse ?? parse)(source, filePath)
    if (exports.some(entry => entry.n === 'default')) {
      return 'has-default'
    }
    if (exports.length === 0) {
      return 'unknown'
    }
    return 'no-default'
  } catch {
    return 'unknown'
  }
}

export const __moduleInfoInternals = {
  setLexerOverrides(overrides?: LexerOverrides) {
    lexerOverrides = overrides
    if (!overrides) {
      lexerInit = undefined
    }
  },
}
