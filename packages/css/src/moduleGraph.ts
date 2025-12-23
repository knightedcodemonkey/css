import path from 'node:path'
import { builtinModules } from 'node:module'
import { existsSync, promises as fs, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { parseSync, Visitor } from 'oxc-parser'
import type {
  Argument,
  Expression,
  ImportExpression,
  TSImportEqualsDeclaration,
} from 'oxc-parser'
import {
  ResolverFactory,
  type NapiResolveOptions,
  type TsconfigOptions as ResolverTsconfigOptions,
} from 'oxc-resolver'
import { createMatchPath } from 'tsconfig-paths'
import { getTsconfig } from 'get-tsconfig'

import type { CssResolver } from './types.js'

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
    graphOptions,
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
    for (const specifier of specifiers) {
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

function extractModuleSpecifiers(sourceText: string, filePath: string): string[] {
  let program
  try {
    ;({ program } = parseSync(filePath, sourceText, { sourceType: 'unambiguous' }))
  } catch {
    return []
  }

  const specifiers: string[] = []
  const addSpecifier = (raw?: string | null) => {
    if (!raw) {
      return
    }
    const normalized = normalizeSpecifier(raw)
    if (normalized) {
      specifiers.push(normalized)
    }
  }

  const visitor = new Visitor({
    ImportDeclaration(node) {
      addSpecifier(node.source?.value)
    },
    ExportNamedDeclaration(node) {
      if (node.source) {
        addSpecifier(node.source.value)
      }
    },
    ExportAllDeclaration(node) {
      addSpecifier(node.source?.value)
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

function normalizeResolverResult(
  result: string | undefined,
  cwd: string,
): string | undefined {
  if (!result) {
    return undefined
  }
  if (result.startsWith('file://')) {
    try {
      return fileURLToPath(new URL(result))
    } catch {
      return undefined
    }
  }
  return path.isAbsolute(result) ? result : path.resolve(cwd, result)
}

function resolveWithFactory(
  factory: ResolverFactory,
  specifier: string,
  importer: string,
  extensions: string[],
): string | undefined {
  if (specifier.startsWith('file://')) {
    try {
      return findExistingFile(fileURLToPath(new URL(specifier)), extensions)
    } catch {
      return undefined
    }
  }
  if (/^[a-z][\w+.-]*:/i.test(specifier)) {
    return undefined
  }
  try {
    const result = factory.resolveFileSync(importer, specifier)
    return result?.path
  } catch {
    return undefined
  }
}

function createResolverFactory(
  cwd: string,
  extensions: string[],
  scriptExtensions: string[],
  graphOptions?: ModuleGraphOptions,
): ResolverFactory {
  const options: NapiResolveOptions = {
    extensions,
    conditionNames: graphOptions?.conditions,
  }
  const extensionAlias = buildExtensionAlias(scriptExtensions)
  if (extensionAlias) {
    options.extensionAlias = extensionAlias
  }
  const tsconfigOption = resolveResolverTsconfig(graphOptions?.tsConfig, cwd)
  options.tsconfig = tsconfigOption ?? 'auto'
  return new ResolverFactory(options)
}

function buildExtensionAlias(
  scriptExtensions: string[],
): Record<string, string[]> | undefined {
  const alias: Record<string, string[]> = {}
  const jsTargets = dedupeExtensions(
    scriptExtensions.filter(ext =>
      ['.js', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts'].includes(ext),
    ),
  )
  if (jsTargets.length > 0) {
    for (const key of ['.js', '.mjs', '.cjs']) {
      alias[key] = jsTargets
    }
  }
  const jsxTargets = dedupeExtensions(
    scriptExtensions.filter(ext => ext === '.jsx' || ext === '.tsx'),
  )
  if (jsxTargets.length > 0) {
    alias['.jsx'] = jsxTargets
  }
  return Object.keys(alias).length > 0 ? alias : undefined
}

function resolveResolverTsconfig(
  input: TsconfigLike | undefined,
  cwd: string,
): ResolverTsconfigOptions | undefined {
  if (!input || typeof input !== 'string') {
    return undefined
  }
  const resolved = resolveTsconfigPath(input, cwd)
  if (!resolved) {
    return undefined
  }
  return { configFile: resolved }
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
    const result = getTsconfig(target, undefined, tsconfigFsCache as Map<string, any>)
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

function resolveTsconfigPath(tsconfigPath: string, cwd: string): string | undefined {
  const absolute = path.isAbsolute(tsconfigPath)
    ? tsconfigPath
    : path.resolve(cwd, tsconfigPath)
  if (!existsSync(absolute)) {
    return undefined
  }
  const stats = statSync(absolute)
  if (stats.isDirectory()) {
    const candidate = path.join(absolute, 'tsconfig.json')
    return existsSync(candidate) ? candidate : undefined
  }
  return absolute
}

function findExistingFile(candidate: string, extensions: string[]): string | undefined {
  const candidateHasExt = hasExtension(candidate)
  if (candidateHasExt && existsSync(candidate)) {
    return candidate
  }
  if (!candidateHasExt) {
    for (const ext of extensions) {
      const withExt = `${candidate}${ext}`
      if (existsSync(withExt)) {
        return withExt
      }
    }
  }
  if (existsSync(candidate) && statSync(candidate).isDirectory()) {
    for (const ext of extensions) {
      const indexPath = path.join(candidate, `index${ext}`)
      if (existsSync(indexPath)) {
        return indexPath
      }
    }
  }
  return undefined
}

function hasExtension(filePath: string): boolean {
  return Boolean(path.extname(filePath))
}
