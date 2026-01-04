import path from 'node:path'

import { init, parse, type ImportSpecifier } from 'es-module-lexer'
import { parseSync, Visitor } from 'oxc-parser'
import type {
  Argument,
  ExportAllDeclaration,
  ExportNamedDeclaration,
  Expression,
  ImportExpression,
  TSExportAssignment,
  TSImportEqualsDeclaration,
} from 'oxc-parser'

export type DefaultExportSignal = 'has-default' | 'no-default' | 'unknown'

interface AnalyzeOptions {
  esParse?: typeof parse
}

interface ModuleAnalysis {
  imports: string[]
  defaultSignal: DefaultExportSignal
}

const JSX_EXTENSIONS = new Set(['.jsx', '.tsx'])

export async function analyzeModule(
  sourceText: string,
  filePath: string,
  options?: AnalyzeOptions,
): Promise<ModuleAnalysis> {
  const ext = path.extname(filePath).toLowerCase()

  if (JSX_EXTENSIONS.has(ext)) {
    return parseWithOxc(sourceText, filePath)
  }

  const esParse = options?.esParse ?? parse

  try {
    await init
    const [imports, exports] = esParse(sourceText, filePath)
    return {
      imports: normalizeEsImports(imports, sourceText),
      defaultSignal: classifyDefault(exports),
    }
  } catch {
    // fall through to oxc fallback
  }

  return parseWithOxc(sourceText, filePath)
}

function normalizeEsImports(
  records: readonly ImportSpecifier[],
  sourceText: string,
): string[] {
  const imports: string[] = []

  for (const record of records) {
    const raw = record.n ?? sourceText.slice(record.s, record.e)
    const normalized = normalizeSpecifier(raw)
    if (normalized) {
      imports.push(normalized)
    }
  }

  return imports
}

function classifyDefault(
  exports: readonly { n: string | undefined }[],
): DefaultExportSignal {
  if (exports.some(entry => entry.n === 'default')) {
    return 'has-default'
  }
  if (exports.length === 0) {
    return 'unknown'
  }
  return 'no-default'
}

function parseWithOxc(sourceText: string, filePath: string): ModuleAnalysis {
  const ext = path.extname(filePath).toLowerCase()
  const attempts: Array<{ path: string; sourceType: 'module' | 'unambiguous' }> = [
    ...(ext === '.js'
      ? [{ path: `${filePath}.tsx`, sourceType: 'module' as const }]
      : []),
    { path: filePath, sourceType: 'module' },
    { path: filePath, sourceType: 'unambiguous' },
  ]
  let program

  for (const attempt of attempts) {
    try {
      ;({ program } = parseSync(attempt.path, sourceText, {
        sourceType: attempt.sourceType,
      }))
      break
    } catch {
      program = undefined
    }
  }

  if (!program) {
    return { imports: [], defaultSignal: 'unknown' }
  }

  const imports: string[] = []
  let defaultSignal: DefaultExportSignal = 'unknown'
  const addSpecifier = (raw?: string | null) => {
    if (!raw) {
      return
    }
    const normalized = normalizeSpecifier(raw)
    if (normalized) {
      imports.push(normalized)
    }
  }

  const visitor = new Visitor({
    ImportDeclaration(node) {
      addSpecifier(node.source?.value)
    },
    ExportNamedDeclaration(node: ExportNamedDeclaration) {
      if (node.source) {
        addSpecifier(node.source.value)
      }
      if (hasDefaultSpecifier(node)) {
        defaultSignal = 'has-default'
      } else if (defaultSignal === 'unknown' && hasAnySpecifier(node)) {
        defaultSignal = 'no-default'
      }
    },
    ExportAllDeclaration(node: ExportAllDeclaration) {
      addSpecifier(node.source?.value)
      if (node.exported && isExportedAsDefault(node.exported)) {
        defaultSignal = 'has-default'
      }
    },
    ExportDefaultDeclaration() {
      defaultSignal = 'has-default'
    },
    TSExportAssignment(node: TSExportAssignment) {
      if (node.expression) {
        defaultSignal = 'has-default'
      }
    },
    TSImportEqualsDeclaration(node: TSImportEqualsDeclaration) {
      const specifier = extractImportEqualsSpecifier(node)
      if (specifier) {
        addSpecifier(specifier)
      }
    },
    ImportExpression(node: ImportExpression) {
      const specifier = getStringFromExpression(node.source)
      if (specifier) {
        addSpecifier(specifier)
      }
    },
    CallExpression(node) {
      if (!isRequireLikeCallee(node.callee)) {
        return
      }
      const specifier = getStringFromArgument(node.arguments[0])
      if (specifier) {
        addSpecifier(specifier)
      }
    },
  })

  visitor.visit(program)

  return { imports, defaultSignal }
}

function normalizeSpecifier(raw: string): string {
  if (!raw) return ''
  const trimmed = raw.trim()
  if (!trimmed || trimmed.startsWith('\0')) {
    return ''
  }
  const querySearchOffset = trimmed.startsWith('#') ? 1 : 0
  const remainder = trimmed.slice(querySearchOffset)
  const queryMatchIndex = remainder.search(/[?#]/)
  const queryIndex = queryMatchIndex === -1 ? -1 : querySearchOffset + queryMatchIndex
  const withoutQuery = queryIndex === -1 ? trimmed : trimmed.slice(0, queryIndex)
  if (!withoutQuery) {
    return ''
  }
  if (/^[a-z][\w+.-]*:/i.test(withoutQuery) && !withoutQuery.startsWith('file:')) {
    return ''
  }
  return withoutQuery
}

function hasDefaultSpecifier(node: ExportNamedDeclaration): boolean {
  return node.specifiers?.some(spec => isExportedAsDefault(spec.exported)) ?? false
}

function hasAnySpecifier(node: ExportNamedDeclaration): boolean {
  return Array.isArray(node.specifiers) && node.specifiers.length > 0
}

function isExportedAsDefault(
  exported: { name?: string; value?: string } | null | undefined,
): boolean {
  if (!exported) return false
  if (typeof exported.name === 'string' && exported.name === 'default') {
    return true
  }
  if (typeof exported.value === 'string' && exported.value === 'default') {
    return true
  }
  return false
}

function extractImportEqualsSpecifier(
  node: TSImportEqualsDeclaration,
): string | undefined {
  if (node.moduleReference.type === 'TSExternalModuleReference') {
    return node.moduleReference.expression.value
  }
  return undefined
}

function getStringFromArgument(argument: Argument | undefined): string | undefined {
  if (!argument || argument.type === 'SpreadElement') {
    return undefined
  }
  return getStringFromExpression(argument)
}

function getStringFromExpression(
  expression: Expression | null | undefined,
): string | undefined {
  if (!expression) {
    return undefined
  }
  if (expression.type === 'Literal') {
    const literalValue = (expression as { value: unknown }).value
    return typeof literalValue === 'string' ? literalValue : undefined
  }
  if (expression.type === 'TemplateLiteral' && expression.expressions.length === 0) {
    const [first] = expression.quasis
    return first?.value.cooked ?? first?.value.raw ?? undefined
  }
  return undefined
}

function isRequireLikeCallee(expression: Expression): boolean {
  const target = unwrapExpression(expression)
  if (target.type === 'Identifier') {
    return target.name === 'require'
  }
  if (target.type === 'MemberExpression') {
    const object = target.object
    if (object.type === 'Identifier') {
      return object.name === 'require'
    }
  }
  return false
}

function unwrapExpression(expression: Expression): Expression {
  if (expression.type === 'ChainExpression') {
    const inner = expression.expression as Expression
    if (inner.type === 'CallExpression') {
      return unwrapExpression(inner.callee)
    }
    return unwrapExpression(inner)
  }
  if (expression.type === 'TSNonNullExpression') {
    return unwrapExpression(expression.expression)
  }
  return expression
}
