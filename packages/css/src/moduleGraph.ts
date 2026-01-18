import path from 'node:path'
import { builtinModules } from 'node:module'
import { promises as fs } from 'node:fs'

import { parseSync, Visitor } from 'oxc-parser'
import type {
  Argument,
  Expression,
  ImportExpression,
  TSImportEqualsDeclaration,
} from 'oxc-parser'
import { createMatchPath } from 'tsconfig-paths'
import { getTsconfig } from 'get-tsconfig'

import type { CssResolver } from './types.js'
import {
  createResolverFactory,
  findExistingFile,
  normalizeResolverResult,
  resolveWithFactory,
} from './moduleResolution.js'

const SCRIPT_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']

const BUILTIN_SPECIFIERS = new Set<string>([
  ...builtinModules,
  ...builtinModules.map(mod => `node:${mod}`),
])

const tsconfigResultCache = new Map<string, TsconfigPathsResult | null>()
const tsconfigFsCache = new Map<string, unknown>()

export interface ModuleGraphOptions {
  tsConfig?: string | Record<string, unknown>
  extensions?: string[]
  conditions?: string[]
}

interface CollectOptions {
  cwd: string
  styleExtensions: string[]
  filter: (filePath: string) => boolean
  resolver?: CssResolver
  graphOptions?: ModuleGraphOptions
}

type ExtractedSpecifier = {
  specifier: string
  assertedType?: 'css'
}

type TsconfigLike = string | Record<string, unknown>

interface TsconfigPathsResult {
  absoluteBaseUrl: string
  paths: Record<string, string[]>
}

export async function collectStyleImports(
  entryPath: string,
  options: CollectOptions,
): Promise<string[]> {
  const { cwd, styleExtensions, filter, resolver, graphOptions } = options
  const normalizedStyles = normalizeExtensions(styleExtensions)
  const scriptExtensions = normalizeExtensions([
    ...SCRIPT_EXTENSIONS,
    ...(graphOptions?.extensions ?? []),
  ])
  const resolutionExtensions = dedupeExtensions([
    ...scriptExtensions,
    ...normalizedStyles,
  ])
  const tsconfigMatcher = createTsconfigMatcher(
    graphOptions?.tsConfig,
    cwd,
    resolutionExtensions,
  )

  const seenScripts = new Set<string>()
  const seenStyles = new Set<string>()
  const styleOrder: string[] = []
  const resolutionCache = new Map<string, string | undefined>()
  const resolverFactory = createResolverFactory(
    cwd,
    resolutionExtensions,
    scriptExtensions,
    {
      conditions: graphOptions?.conditions,
      tsconfig: graphOptions?.tsConfig,
    },
  )

  async function walk(filePath: string): Promise<void> {
    const absolutePath = path.resolve(filePath)
    if (seenScripts.has(absolutePath)) {
      return
    }
    seenScripts.add(absolutePath)
    const source = await readSourceFile(absolutePath)
    if (!source) {
      return
    }
    const specifiers = extractModuleSpecifiers(source, absolutePath)
    for (const { specifier, assertedType } of specifiers) {
      if (!specifier || isBuiltinSpecifier(specifier)) {
        continue
      }
      const resolved = await resolveImport(specifier, absolutePath)
      if (!resolved) {
        continue
      }
      const normalized = path.resolve(resolved)
      if (!filter(normalized)) {
        continue
      }
      if (assertedType === 'css') {
        if (!seenStyles.has(normalized)) {
          seenStyles.add(normalized)
          styleOrder.push(normalized)
        }
        continue
      }
      if (isStyleExtension(normalized, normalizedStyles)) {
        if (!seenStyles.has(normalized)) {
          seenStyles.add(normalized)
          styleOrder.push(normalized)
        }
        continue
      }
      if (isScriptExtension(normalized, scriptExtensions)) {
        await walk(normalized)
      }
    }
  }

  async function resolveImport(
    specifier: string,
    importer: string,
  ): Promise<string | undefined> {
    const cacheKey = `${importer}::${specifier}`
    if (resolutionCache.has(cacheKey)) {
      return resolutionCache.get(cacheKey)
    }
    let resolved: string | undefined

    if (resolver) {
      resolved = normalizeResolverResult(
        await resolver(specifier, { cwd, from: importer }),
        cwd,
      )
    }

    if (!resolved && tsconfigMatcher) {
      resolved = tsconfigMatcher(specifier)
    }

    if (!resolved) {
      resolved = resolveWithFactory(
        resolverFactory,
        specifier,
        importer,
        resolutionExtensions,
      )
    }

    resolutionCache.set(cacheKey, resolved)
    return resolved
  }

  await walk(entryPath)
  return styleOrder
}

function normalizeExtensions(extensions: string[]): string[] {
  const result = new Set<string>()
  for (const ext of extensions) {
    if (!ext) continue
    const normalized = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`
    result.add(normalized)
  }
  return Array.from(result)
}

function dedupeExtensions(extensions: string[]): string[] {
  const result = new Set<string>()
  for (const ext of extensions) {
    result.add(ext)
  }
  return Array.from(result)
}

function isBuiltinSpecifier(specifier: string): boolean {
  if (BUILTIN_SPECIFIERS.has(specifier)) {
    return true
  }
  if (specifier.startsWith('node:')) {
    return true
  }
  return false
}

function isStyleExtension(filePath: string, extensions: string[]): boolean {
  const lower = filePath.toLowerCase()
  return extensions.some(ext => lower.endsWith(ext))
}

function isScriptExtension(filePath: string, extensions: string[]): boolean {
  const ext = path.extname(filePath).toLowerCase()
  return extensions.includes(ext)
}

async function readSourceFile(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, 'utf8')
  } catch {
    return undefined
  }
}

function extractModuleSpecifiers(
  sourceText: string,
  filePath: string,
): ExtractedSpecifier[] {
  let program
  try {
    ;({ program } = parseSync(filePath, sourceText, { sourceType: 'unambiguous' }))
  } catch {
    return []
  }

  const specifiers: ExtractedSpecifier[] = []
  const addSpecifier = (raw?: string | null, assertedType?: 'css') => {
    if (!raw) {
      return
    }
    const normalized = normalizeSpecifier(raw)
    if (normalized) {
      specifiers.push({ specifier: normalized, assertedType })
    }
  }

  const visitor = new Visitor({
    ImportDeclaration(node) {
      addSpecifier(node.source?.value, getImportAssertedType(node))
    },
    ExportNamedDeclaration(node) {
      if (node.source) {
        addSpecifier(node.source.value, getImportAssertedType(node))
      }
    },
    ExportAllDeclaration(node) {
      addSpecifier(node.source?.value, getImportAssertedType(node))
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
        addSpecifier(specifier, getImportExpressionAssertedType(node))
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
  return specifiers
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

function getImportAssertedType(node: unknown): 'css' | undefined {
  const attributes = getImportAttributes(node)
  for (const attribute of attributes) {
    const key = getAttributeKey(attribute)
    const value = getAttributeValue(attribute)
    if (key === 'type' && value === 'css') {
      return 'css'
    }
  }
  return undefined
}

function getImportAttributes(node: unknown): unknown[] {
  const attributes: unknown[] = []
  const candidate = node as { [key: string]: unknown }

  const withClause = candidate?.withClause as { attributes?: unknown }
  if (withClause && Array.isArray(withClause.attributes)) {
    attributes.push(...withClause.attributes)
  }

  const directAttributes = candidate?.attributes
  if (Array.isArray(directAttributes)) {
    attributes.push(...directAttributes)
  }

  const assertions = candidate?.assertions
  if (Array.isArray(assertions)) {
    attributes.push(...assertions)
  }

  return attributes
}

function getAttributeKey(attribute: unknown): string | undefined {
  const attr = attribute as { [key: string]: unknown }
  const key = attr?.key as { [key: string]: unknown } | undefined
  if (!key) {
    return undefined
  }
  if (typeof (key as { name?: unknown }).name === 'string') {
    return (key as { name: string }).name
  }
  const value = (key as { value?: unknown }).value
  if (typeof value === 'string') {
    return value
  }
  return undefined
}

function getAttributeValue(attribute: unknown): string | undefined {
  const attr = attribute as { [key: string]: unknown }
  const value = attr?.value as { [key: string]: unknown } | unknown
  if (typeof value === 'string') {
    return value
  }
  if (value && typeof (value as { value?: unknown }).value === 'string') {
    return (value as { value: string }).value
  }
  return undefined
}

function getImportExpressionAssertedType(node: ImportExpression): 'css' | undefined {
  // Stage-3 import attributes proposal shape: import(spec, { with: { type: "css" } })
  const options = (node as { options?: Expression | null | undefined }).options
  if (!options) {
    return undefined
  }

  const withObject = getStaticObjectProperty(options, 'with')
  if (withObject && isObjectExpression(withObject)) {
    const typeValue = getStaticObjectString(withObject, 'type')
    if (typeValue === 'css') {
      return 'css'
    }
  }

  const assertObject = getStaticObjectProperty(options, 'assert')
  if (assertObject && isObjectExpression(assertObject)) {
    const typeValue = getStaticObjectString(assertObject, 'type')
    if (typeValue === 'css') {
      return 'css'
    }
  }

  return undefined
}

function isObjectExpression(
  expression: Expression,
): (Expression & { type: 'ObjectExpression'; properties: unknown[] }) | undefined {
  return expression && expression.type === 'ObjectExpression'
    ? (expression as Expression & { type: 'ObjectExpression'; properties: unknown[] })
    : undefined
}

function getStaticObjectProperty(
  expression: Expression,
  name: string,
): Expression | undefined {
  const objectExpression = isObjectExpression(expression)
  if (!objectExpression) {
    return undefined
  }
  for (const prop of objectExpression.properties as unknown[]) {
    const maybeProp = prop as { key?: unknown; value?: unknown; type?: string }
    if (maybeProp.type && maybeProp.type !== 'Property') {
      continue
    }
    const keyName = getPropertyKeyName(maybeProp.key)
    if (keyName === name) {
      const value = maybeProp.value as Expression | undefined
      if (value) {
        return value
      }
    }
  }
  return undefined
}

function getPropertyKeyName(key: unknown): string | undefined {
  if (!key) return undefined
  const asAny = key as { name?: unknown; value?: unknown; type?: string }
  if (typeof asAny.name === 'string') {
    return asAny.name
  }
  if (typeof asAny.value === 'string') {
    return asAny.value
  }
  return undefined
}

function getStaticObjectString(expression: Expression, name: string): string | undefined {
  const valueExpression = getStaticObjectProperty(expression, name)
  if (!valueExpression) {
    return undefined
  }
  return getStringFromExpression(valueExpression)
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

function createTsconfigMatcher(
  input: TsconfigLike | undefined,
  cwd: string,
  extensions: string[],
): ((specifier: string) => string | undefined) | undefined {
  const config = loadTsconfigPaths(input, cwd)
  if (!config) {
    return undefined
  }
  const matchPath = createMatchPath(config.absoluteBaseUrl, config.paths)
  return (specifier: string) => {
    const matched = matchPath(specifier, undefined, undefined, extensions)
    if (!matched) {
      return undefined
    }
    return findExistingFile(matched, extensions) ?? matched
  }
}

function loadTsconfigPaths(
  input: TsconfigLike | undefined,
  cwd: string,
): TsconfigPathsResult | undefined {
  if (!input) {
    return undefined
  }
  if (typeof input === 'string') {
    const target = path.isAbsolute(input) ? input : path.resolve(cwd, input)
    const cached = tsconfigResultCache.get(target)
    if (cached !== undefined) {
      return cached ?? undefined
    }
    const result = getTsconfig(target, undefined, tsconfigFsCache as Map<string, unknown>)
    if (!result) {
      tsconfigResultCache.set(target, null)
      return undefined
    }
    const normalized = normalizeTsconfigCompilerOptions(
      result.config.compilerOptions,
      path.dirname(result.path),
    )
    tsconfigResultCache.set(target, normalized ?? null)
    return normalized
  }
  const compilerOptions = (
    input as {
      compilerOptions?: { baseUrl?: string; paths?: Record<string, string[] | string> }
    }
  ).compilerOptions
  return normalizeTsconfigCompilerOptions(compilerOptions, cwd)
}

function normalizeTsconfigCompilerOptions(
  compilerOptions:
    | {
        baseUrl?: string
        paths?: Record<string, string[] | string>
      }
    | undefined,
  configDir: string,
): TsconfigPathsResult | undefined {
  if (!compilerOptions?.baseUrl || !compilerOptions.paths) {
    return undefined
  }
  const normalizedPaths: Record<string, string[]> = {}
  for (const [pattern, replacements] of Object.entries(compilerOptions.paths)) {
    if (!replacements || replacements.length === 0) {
      continue
    }
    normalizedPaths[pattern] = Array.isArray(replacements)
      ? [...replacements]
      : [replacements]
  }
  if (Object.keys(normalizedPaths).length === 0) {
    return undefined
  }
  const absoluteBaseUrl = path.isAbsolute(compilerOptions.baseUrl)
    ? compilerOptions.baseUrl
    : path.resolve(configDir, compilerOptions.baseUrl)
  return { absoluteBaseUrl, paths: normalizedPaths }
}
