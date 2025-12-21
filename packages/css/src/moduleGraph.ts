import path from 'node:path'
import { builtinModules } from 'node:module'
import { existsSync, promises as fs, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  ResolverFactory,
  type NapiResolveOptions,
  type TsconfigOptions as ResolverTsconfigOptions,
} from 'oxc-resolver'
import ts from 'typescript'

import type { CssResolver } from './types.js'

const SCRIPT_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']

const BUILTIN_SPECIFIERS = new Set<string>([
  ...builtinModules,
  ...builtinModules.map(mod => `node:${mod}`),
])

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
  baseUrl: string
  paths: Record<string, readonly string[]>
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
  const specifiers: string[] = []
  const source = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    getScriptKind(filePath),
  )

  const addSpecifier = (raw: string) => {
    const normalized = normalizeSpecifier(raw)
    if (normalized) {
      specifiers.push(normalized)
    }
  }

  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      addSpecifier(node.moduleSpecifier.text)
    } else if (ts.isImportEqualsDeclaration(node)) {
      if (
        ts.isExternalModuleReference(node.moduleReference) &&
        node.moduleReference.expression &&
        ts.isStringLiteralLike(node.moduleReference.expression)
      ) {
        addSpecifier(node.moduleReference.expression.text)
      }
    } else if (ts.isCallExpression(node)) {
      if (isRequireCall(node) || isDynamicImport(node)) {
        const [argument] = node.arguments
        if (argument && ts.isStringLiteralLike(argument)) {
          addSpecifier(argument.text)
        }
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(source)
  return specifiers
}

function getScriptKind(filePath: string): ts.ScriptKind {
  const ext = path.extname(filePath).toLowerCase()
  switch (ext) {
    case '.ts':
      return ts.ScriptKind.TS
    case '.tsx':
      return ts.ScriptKind.TSX
    case '.mts':
      return ts.ScriptKind.TS
    case '.cts':
      return ts.ScriptKind.TS
    case '.jsx':
      return ts.ScriptKind.JSX
    default:
      return ts.ScriptKind.JS
  }
}

function normalizeSpecifier(raw: string): string {
  if (!raw) return ''
  const trimmed = raw.trim()
  if (!trimmed || trimmed.startsWith('\0')) {
    return ''
  }
  const queryIndex = trimmed.search(/[?#]/)
  const withoutQuery = queryIndex === -1 ? trimmed : trimmed.slice(0, queryIndex)
  if (!withoutQuery) {
    return ''
  }
  if (/^[a-z][\w+.-]*:/i.test(withoutQuery) && !withoutQuery.startsWith('file:')) {
    return ''
  }
  return withoutQuery
}

function isRequireCall(node: ts.CallExpression): boolean {
  if (!ts.isIdentifier(node.expression)) {
    if (
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression)
    ) {
      return node.expression.expression.text === 'require'
    }
    return false
  }
  return node.expression.text === 'require'
}

function isDynamicImport(node: ts.CallExpression): boolean {
  return node.expression.kind === ts.SyntaxKind.ImportKeyword
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
  if (tsconfigOption) {
    options.tsconfig = tsconfigOption
  }
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
  const patterns = Object.entries(config.paths).map(([pattern, replacements]) => ({
    pattern,
    replacements: Array.isArray(replacements) ? replacements : [replacements],
  }))

  return (specifier: string) => {
    for (const { pattern, replacements } of patterns) {
      if (!pattern.includes('*')) {
        if (pattern === specifier) {
          const resolved = resolveReplacements(
            replacements,
            '',
            config.baseUrl,
            extensions,
          )
          if (resolved) {
            return resolved
          }
        }
        continue
      }
      const [prefix, suffix] = pattern.split('*')
      if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) {
        continue
      }
      const wildcard = specifier.slice(prefix.length, specifier.length - suffix.length)
      const resolved = resolveReplacements(
        replacements,
        wildcard,
        config.baseUrl,
        extensions,
      )
      if (resolved) {
        return resolved
      }
    }
    return undefined
  }
}

function resolveReplacements(
  replacements: readonly string[],
  wildcard: string,
  baseUrl: string,
  extensions: string[],
): string | undefined {
  for (const replacement of replacements) {
    const substituted = replacement.includes('*')
      ? replacement.split('*').join(wildcard)
      : replacement
    const candidate = path.resolve(baseUrl, substituted)
    const resolved = findExistingFile(candidate, extensions)
    if (resolved) {
      return resolved
    }
  }
  return undefined
}

function loadTsconfigPaths(
  input: TsconfigLike | undefined,
  cwd: string,
): TsconfigPathsResult | undefined {
  if (!input) {
    return undefined
  }
  if (typeof input === 'string') {
    const configPath = resolveTsconfigPath(input, cwd)
    if (!configPath) {
      return undefined
    }
    const readResult = ts.readConfigFile(configPath, ts.sys.readFile)
    if (readResult.error) {
      return undefined
    }
    const parsed = ts.parseJsonConfigFileContent(
      readResult.config,
      ts.sys,
      path.dirname(configPath),
      undefined,
      configPath,
    )
    const baseUrl = parsed.options.baseUrl
    const paths = parsed.options.paths
    if (!baseUrl || !paths) {
      return undefined
    }
    return {
      baseUrl: path.isAbsolute(baseUrl)
        ? baseUrl
        : path.resolve(path.dirname(configPath), baseUrl),
      paths,
    }
  }
  const compilerOptions = (
    input as { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } }
  ).compilerOptions
  if (!compilerOptions?.baseUrl || !compilerOptions.paths) {
    return undefined
  }
  return {
    baseUrl: path.resolve(cwd, compilerOptions.baseUrl),
    paths: compilerOptions.paths,
  }
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
