import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { moduleType } from 'node-module-type'

import { getTsconfig, type TsConfigResult } from 'get-tsconfig'
import { createMatchPath, type MatchPath } from 'tsconfig-paths'

import { cssWithMeta } from './css.js'
import { analyzeModule } from './lexer.js'
import { buildStableSelectorsLiteral } from './stableSelectorsLiteral.js'
import { resolveStableNamespace } from './stableNamespace.js'

interface ImportMatch {
  specifier: string
  importer: string
}

interface ManifestEntry {
  file: string
  hash: string
}

type SelectorModuleManifest = Record<string, ManifestEntry>
type StableDeclarationManifest = Record<string, ManifestEntry>

interface TsconfigResolutionContext {
  absoluteBaseUrl?: string
  matchPath?: MatchPath
}

type CssWithMetaFn = typeof cssWithMeta

let activeCssWithMeta: CssWithMetaFn = cssWithMeta

interface GenerateTypesInternalOptions {
  rootDir: string
  include: string[]
  cacheDir: string
  stableNamespace?: string
  autoStable?: boolean
  tsconfig?: TsconfigResolutionContext
}

export interface GenerateTypesResult {
  selectorModulesWritten: number
  selectorModulesRemoved: number
  warnings: string[]
  manifestPath: string
}

export interface GenerateTypesOptions {
  rootDir?: string
  include?: string[]
  outDir?: string
  stableNamespace?: string
  autoStable?: boolean
}

const DEFAULT_SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.knighted-css',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.output',
  'tmp',
])

const SUPPORTED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mts',
  '.cts',
  '.mjs',
  '.cjs',
])

type ModuleTypeDetector = () => ReturnType<typeof moduleType>

let moduleTypeDetector: ModuleTypeDetector = moduleType
let importMetaUrlProvider: () => string | undefined = getImportMetaUrl

function resolvePackageRoot(): string {
  const detectedType = moduleTypeDetector()
  if (detectedType === 'commonjs' && typeof __dirname === 'string') {
    return path.resolve(__dirname, '..')
  }
  const moduleUrl = importMetaUrlProvider()
  if (moduleUrl) {
    return path.resolve(path.dirname(fileURLToPath(moduleUrl)), '..')
  }
  return path.resolve(process.cwd(), 'node_modules', '@knighted', 'css')
}

function getImportMetaUrl(): string | undefined {
  try {
    return (0, eval)('import.meta.url') as string
  } catch {
    return undefined
  }
}

const SELECTOR_REFERENCE = '.knighted-css'
const KNIGHTED_CSS_QUERY_FLAG = 'knighted-css'
const STABLE_QUERY_FLAG = 'stable'
const SELECTOR_MODULE_SUFFIX = '.knighted-css.ts'
const STABLE_DECLARATION_SUFFIX = '.knighted-css-stable.d.ts'

export async function generateTypes(
  options: GenerateTypesOptions = {},
): Promise<GenerateTypesResult> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd())
  const include = normalizeIncludeOptions(options.include, rootDir)
  const cacheDir = path.resolve(options.outDir ?? path.join(rootDir, '.knighted-css'))
  const tsconfig = loadTsconfigResolutionContext(rootDir)

  await fs.mkdir(cacheDir, { recursive: true })

  const internalOptions: GenerateTypesInternalOptions = {
    rootDir,
    include,
    cacheDir,
    stableNamespace: options.stableNamespace,
    autoStable: options.autoStable,
    tsconfig,
  }

  return generateDeclarations(internalOptions)
}

async function generateDeclarations(
  options: GenerateTypesInternalOptions,
): Promise<GenerateTypesResult> {
  const peerResolver = createProjectPeerResolver(options.rootDir)
  const files = await collectCandidateFiles(options.include)
  const selectorModulesManifestPath = path.join(options.cacheDir, 'selector-modules.json')
  const stableDeclarationsManifestPath = path.join(
    options.cacheDir,
    'stable-declarations.json',
  )
  const previousSelectorManifest = await readManifest(selectorModulesManifestPath)
  const previousStableManifest = await readManifest(stableDeclarationsManifestPath)
  const nextSelectorManifest: SelectorModuleManifest = {}
  const nextStableManifest: StableDeclarationManifest = {}
  const selectorCache = new Map<string, Map<string, string>>()
  const moduleExportCache = new Map<string, string[]>()
  const processedSelectors = new Set<string>()
  const stableDeclarations = new Map<
    string,
    Array<{
      specifier: string
      resourcePath: string
      selectorMap: Map<string, string>
      exportNames: string[]
      namedOnly: boolean
    }>
  >()
  const warnings: string[] = []
  let selectorModuleWrites = 0

  for (const filePath of files) {
    const matches = await findSpecifierImports(filePath)
    for (const match of matches) {
      const cleaned = match.specifier.trim()
      const inlineFree = stripInlineLoader(cleaned)
      const { resource, query } = splitResourceAndQuery(inlineFree)
      const isStableImport = hasStableQuery(query)
      const selectorSource =
        extractSelectorSourceSpecifier(resource) ||
        (isStableImport ? resource : undefined)
      if (!selectorSource) {
        continue
      }
      const resolvedNamespace = resolveStableNamespace(options.stableNamespace)
      const resolvedPath = await resolveImportPath(
        selectorSource,
        match.importer,
        options.rootDir,
        options.tsconfig,
      )
      if (!resolvedPath) {
        warnings.push(
          `Unable to resolve ${selectorSource} referenced by ${relativeToRoot(match.importer, options.rootDir)}.`,
        )
        continue
      }

      const cacheKey = `${resolvedPath}::${resolvedNamespace}`
      let selectorMap = selectorCache.get(cacheKey)
      if (!selectorMap) {
        try {
          const shouldUseCssModules = resolvedPath.endsWith('.module.css')
          const { css } = await activeCssWithMeta(resolvedPath, {
            cwd: options.rootDir,
            peerResolver,
            autoStable: options.autoStable ? { namespace: resolvedNamespace } : undefined,
            lightningcss:
              options.autoStable && shouldUseCssModules
                ? { cssModules: true }
                : undefined,
          })
          selectorMap = buildStableSelectorsLiteral({
            css,
            namespace: resolvedNamespace,
            resourcePath: resolvedPath,
            emitWarning: message => warnings.push(message),
          }).selectorMap
        } catch (error) {
          warnings.push(
            `Failed to extract CSS for ${relativeToRoot(resolvedPath, options.rootDir)}: ${formatErrorMessage(error)}`,
          )
          continue
        }
        selectorCache.set(cacheKey, selectorMap)
      }

      if (!isWithinRoot(resolvedPath, options.rootDir)) {
        warnings.push(
          `Skipping selector module for ${relativeToRoot(resolvedPath, options.rootDir)} because it is outside the project root.`,
        )
        continue
      }

      const manifestKey = buildSelectorModuleManifestKey(resolvedPath)
      if (!isStableImport) {
        if (processedSelectors.has(manifestKey)) {
          continue
        }
        const moduleWrite = await ensureSelectorModule(
          resolvedPath,
          selectorMap,
          previousSelectorManifest,
          nextSelectorManifest,
        )
        if (moduleWrite) {
          selectorModuleWrites += 1
        }
        processedSelectors.add(manifestKey)
      }

      if (isStableImport) {
        const namedOnly = hasNamedOnlyQueryFlag(query)
        const exportNames = isScriptResource(resolvedPath)
          ? await getModuleExportNames(resolvedPath, moduleExportCache)
          : []
        const stableEntries = stableDeclarations.get(match.importer) ?? []
        stableEntries.push({
          specifier: match.specifier,
          resourcePath: resolvedPath,
          selectorMap,
          exportNames,
          namedOnly,
        })
        stableDeclarations.set(match.importer, stableEntries)
      }
    }
  }

  const selectorModulesRemoved = await removeStaleSelectorModules(
    previousSelectorManifest,
    nextSelectorManifest,
  )
  const stableDeclarationsRemoved = await removeStaleSelectorModules(
    previousStableManifest,
    nextStableManifest,
  )
  await writeManifest(selectorModulesManifestPath, nextSelectorManifest)
  await writeManifest(stableDeclarationsManifestPath, nextStableManifest)

  for (const [importerPath, entries] of stableDeclarations) {
    const declarationSource = formatStableDeclarationSource(entries)
    const declarationPath = buildStableDeclarationPath(importerPath)
    const hash = hashContent(declarationSource)
    const manifestKey = buildSelectorModuleManifestKey(importerPath)
    const previousEntry = previousStableManifest[manifestKey]
    const needsWrite =
      previousEntry?.hash !== hash || !(await fileExists(declarationPath))
    if (needsWrite) {
      await fs.writeFile(declarationPath, declarationSource, 'utf8')
    }
    nextStableManifest[manifestKey] = { file: declarationPath, hash }
  }

  return {
    selectorModulesWritten: selectorModuleWrites,
    selectorModulesRemoved: selectorModulesRemoved + stableDeclarationsRemoved,
    warnings,
    manifestPath: selectorModulesManifestPath,
  }
}

function normalizeIncludeOptions(
  include: string[] | undefined,
  rootDir: string,
): string[] {
  if (!include || include.length === 0) {
    return [rootDir]
  }
  return include.map(entry =>
    path.isAbsolute(entry) ? entry : path.resolve(rootDir, entry),
  )
}

async function collectCandidateFiles(entries: string[]): Promise<string[]> {
  const files: string[] = []
  const visited = new Set<string>()

  async function walk(entryPath: string): Promise<void> {
    const resolved = path.resolve(entryPath)
    if (visited.has(resolved)) {
      return
    }
    visited.add(resolved)
    let stat
    try {
      stat = await fs.stat(resolved)
    } catch {
      return
    }
    if (stat.isDirectory()) {
      const base = path.basename(resolved)
      if (DEFAULT_SKIP_DIRS.has(base)) {
        return
      }
      const children = await fs.readdir(resolved, { withFileTypes: true })
      for (const child of children) {
        await walk(path.join(resolved, child.name))
      }
      return
    }
    if (!stat.isFile()) {
      return
    }
    const ext = path.extname(resolved).toLowerCase()
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      return
    }
    files.push(resolved)
  }

  for (const entry of entries) {
    await walk(entry)
  }

  return files
}

async function findSpecifierImports(filePath: string): Promise<ImportMatch[]> {
  let source: string
  try {
    source = await fs.readFile(filePath, 'utf8')
  } catch {
    return []
  }
  if (!source.includes(SELECTOR_REFERENCE) && !source.includes(KNIGHTED_CSS_QUERY_FLAG)) {
    return []
  }
  const matches: ImportMatch[] = []
  try {
    const { imports } = await analyzeModule(source, filePath)
    for (const specifier of imports) {
      if (specifier.includes(SELECTOR_REFERENCE) || isStableQuerySpecifier(specifier)) {
        matches.push({ specifier, importer: filePath })
      }
    }
  } catch {
    // ignore and fall back to regex below
  }
  const requireRegex = /require\((['"])([^'"`]+?\.knighted-css[^'"`]*)\1\)/g
  let reqMatch: RegExpExecArray | null
  while ((reqMatch = requireRegex.exec(source)) !== null) {
    const spec = reqMatch[2]
    if (spec) {
      matches.push({ specifier: spec, importer: filePath })
    }
  }
  const stableSpecifierRegex =
    /(?:import\s+(?:[^'"`]+?\s+from\s+)?|export\s+[^'"`]+?\s+from\s+|import\s*\(\s*|require\()(['"])([^'"`]+?\?[^'"`]*knighted-css[^'"`]*stable[^'"`]*)\1/g
  let stableMatch: RegExpExecArray | null
  while ((stableMatch = stableSpecifierRegex.exec(source)) !== null) {
    const spec = stableMatch[2]
    if (spec) {
      matches.push({ specifier: spec, importer: filePath })
    }
  }
  return matches
}

function stripInlineLoader(specifier: string): string {
  const idx = specifier.lastIndexOf('!')
  return idx >= 0 ? specifier.slice(idx + 1) : specifier
}

function splitResourceAndQuery(specifier: string): { resource: string; query: string } {
  const hashIndex = specifier.indexOf('#')
  const trimmed = hashIndex >= 0 ? specifier.slice(0, hashIndex) : specifier
  const queryIndex = trimmed.indexOf('?')
  if (queryIndex < 0) {
    return { resource: trimmed, query: '' }
  }
  return { resource: trimmed.slice(0, queryIndex), query: trimmed.slice(queryIndex) }
}

function splitQuery(query: string): string[] {
  const trimmed = query.startsWith('?') ? query.slice(1) : query
  if (!trimmed) return []
  return trimmed.split('&').filter(Boolean)
}

function isQueryFlag(entry: string, flag: string): boolean {
  const [rawKey] = entry.split('=')
  try {
    return decodeURIComponent(rawKey) === flag
  } catch {
    return rawKey === flag
  }
}

function hasQueryFlag(query: string, flag: string): boolean {
  if (!query) return false
  const entries = splitQuery(query)
  if (entries.length === 0) return false
  return entries.some(part => isQueryFlag(part, flag))
}

function hasStableQuery(query: string): boolean {
  return (
    hasQueryFlag(query, KNIGHTED_CSS_QUERY_FLAG) && hasQueryFlag(query, STABLE_QUERY_FLAG)
  )
}

function hasNamedOnlyQueryFlag(query: string): boolean {
  return hasQueryFlag(query, 'named-only') || hasQueryFlag(query, 'no-default')
}

function isStableQuerySpecifier(specifier: string): boolean {
  const cleaned = stripInlineLoader(specifier)
  const { query } = splitResourceAndQuery(cleaned)
  return hasStableQuery(query)
}

function extractSelectorSourceSpecifier(specifier: string): string | undefined {
  const markerIndex = specifier.indexOf(SELECTOR_REFERENCE)
  if (markerIndex < 0) {
    return undefined
  }
  const suffix = specifier.slice(markerIndex + SELECTOR_REFERENCE.length)
  if (suffix.length > 0 && !/\.(?:[cm]?[tj]s|[tj]sx)$/.test(suffix)) {
    return undefined
  }
  const base = specifier.slice(0, markerIndex)
  if (!base) {
    return undefined
  }
  return base
}

const projectRequireCache = new Map<string, ReturnType<typeof createRequire>>()

async function resolveImportPath(
  resourceSpecifier: string,
  importerPath: string,
  rootDir: string,
  tsconfig?: TsconfigResolutionContext,
): Promise<string | undefined> {
  if (!resourceSpecifier) return undefined
  if (resourceSpecifier.startsWith('.')) {
    const resolved = path.resolve(path.dirname(importerPath), resourceSpecifier)
    return resolveScriptExtensionAlias(resolved)
  }
  if (resourceSpecifier.startsWith('/')) {
    const resolved = path.resolve(rootDir, resourceSpecifier.slice(1))
    return resolveScriptExtensionAlias(resolved)
  }
  const tsconfigResolved = await resolveWithTsconfigPaths(resourceSpecifier, tsconfig)
  if (tsconfigResolved) {
    return resolveScriptExtensionAlias(tsconfigResolved)
  }
  const requireFromRoot = getProjectRequire(rootDir)
  try {
    const resolved = requireFromRoot.resolve(resourceSpecifier)
    return resolveScriptExtensionAlias(resolved)
  } catch {
    return undefined
  }
}

function buildSelectorModuleManifestKey(resolvedPath: string): string {
  return resolvedPath.split(path.sep).join('/')
}

function buildSelectorModulePath(resolvedPath: string): string {
  return `${resolvedPath}${SELECTOR_MODULE_SUFFIX}`
}

function buildStableDeclarationPath(importerPath: string): string {
  return `${importerPath}${STABLE_DECLARATION_SUFFIX}`
}

function isScriptResource(resourcePath: string): boolean {
  return SUPPORTED_EXTENSIONS.has(path.extname(resourcePath).toLowerCase())
}

async function getModuleExportNames(
  resourcePath: string,
  cache: Map<string, string[]>,
): Promise<string[]> {
  const cached = cache.get(resourcePath)
  if (cached) {
    return cached
  }
  try {
    const source = await fs.readFile(resourcePath, 'utf8')
    const { exports } = await analyzeModule(source, resourcePath)
    cache.set(resourcePath, exports)
    return exports
  } catch {
    cache.set(resourcePath, [])
    return []
  }
}

function formatSelectorModuleSource(selectors: Map<string, string>): string {
  const header = '// Generated by @knighted/css/generate-types\n// Do not edit.\n'
  const entries = Array.from(selectors.entries()).sort(([a], [b]) => a.localeCompare(b))
  const lines = entries.map(
    ([token, selector]) => `  ${JSON.stringify(token)}: ${JSON.stringify(selector)},`,
  )
  const literal =
    lines.length > 0
      ? `{
${lines.join('\n')}
} as const`
      : '{} as const'
  return `${header}
export const stableSelectors = ${literal}

export type KnightedCssStableSelectors = typeof stableSelectors
export type KnightedCssStableSelectorToken = keyof typeof stableSelectors

export default stableSelectors
`
}

function formatStableSelectorTypeLiteral(selectors: Map<string, string>): string {
  const entries = Array.from(selectors.entries()).sort(([a], [b]) => a.localeCompare(b))
  const lines = entries.map(
    ([token, selector]) => `  ${JSON.stringify(token)}: ${JSON.stringify(selector)},`,
  )
  return lines.length > 0
    ? `{
${lines.join('\n')}
}`
    : '{}'
}

function formatStableDeclarationSource(
  entries: Array<{
    specifier: string
    resourcePath: string
    selectorMap: Map<string, string>
    exportNames: string[]
    namedOnly: boolean
  }>,
): string {
  const header = '// Generated by @knighted/css/generate-types\n// Do not edit.\n'
  const blocks = entries.map(entry => {
    const { resource } = splitResourceAndQuery(stripInlineLoader(entry.specifier))
    const moduleSpecifier = resource || entry.resourcePath
    const selectorType = formatStableSelectorTypeLiteral(entry.selectorMap)
    const namedExports = entry.exportNames.filter(name => name !== 'default')
    const namedExportBlock =
      namedExports.length > 0
        ? namedExports
            .sort()
            .map(
              name =>
                `export const ${name}: typeof import(${JSON.stringify(
                  moduleSpecifier,
                )}).${name};`,
            )
            .join('\n')
        : ''
    const defaultBlock = entry.namedOnly
      ? ''
      : `declare const combined: (typeof import(${JSON.stringify(
          moduleSpecifier,
        )})) & { knightedCss: string; stableSelectors: Readonly<${selectorType}> };
`
    const exportsBlock = entry.namedOnly
      ? namedExportBlock
      : `${namedExportBlock}${namedExportBlock ? '\n' : ''}export default combined;`
    return `${header}
declare module ${JSON.stringify(entry.specifier)} {
  export const knightedCss: string
  export const stableSelectors: Readonly<${selectorType}>
  ${defaultBlock}  ${exportsBlock}
}
`
  })
  return blocks.join('\n')
}

function hashContent(content: string): string {
  return crypto.createHash('sha1').update(content).digest('hex')
}

async function readManifest(
  manifestPath: string,
): Promise<Record<string, ManifestEntry>> {
  try {
    const raw = await fs.readFile(manifestPath, 'utf8')
    return JSON.parse(raw) as Record<string, ManifestEntry>
  } catch {
    return {}
  }
}

async function writeManifest(
  manifestPath: string,
  manifest: Record<string, ManifestEntry>,
): Promise<void> {
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
}

async function removeStaleSelectorModules(
  previous: Record<string, ManifestEntry>,
  next: Record<string, ManifestEntry>,
): Promise<number> {
  const stale = Object.entries(previous).filter(([key]) => !next[key])
  let removed = 0
  for (const [, entry] of stale) {
    try {
      await fs.unlink(entry.file)
      removed += 1
    } catch {
      // ignore
    }
  }
  return removed
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === 'string') {
    return error.message
  }
  return String(error)
}

function relativeToRoot(filePath: string, rootDir: string): string {
  return path.relative(rootDir, filePath) || filePath
}

function isWithinRoot(filePath: string, rootDir: string): boolean {
  const relative = path.relative(rootDir, filePath)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

async function ensureSelectorModule(
  resolvedPath: string,
  selectors: Map<string, string>,
  previousManifest: SelectorModuleManifest,
  nextManifest: SelectorModuleManifest,
): Promise<boolean> {
  const manifestKey = buildSelectorModuleManifestKey(resolvedPath)
  const targetPath = buildSelectorModulePath(resolvedPath)
  const source = formatSelectorModuleSource(selectors)
  const hash = hashContent(source)
  const previousEntry = previousManifest[manifestKey]
  const needsWrite = previousEntry?.hash !== hash || !(await fileExists(targetPath))
  if (needsWrite) {
    await fs.writeFile(targetPath, source, 'utf8')
  }
  nextManifest[manifestKey] = { file: targetPath, hash }
  return needsWrite
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

async function resolveScriptExtensionAlias(resolvedPath: string): Promise<string> {
  if (await fileExists(resolvedPath)) {
    return resolvedPath
  }
  const ext = path.extname(resolvedPath).toLowerCase()
  const base = resolvedPath.slice(0, resolvedPath.length - ext.length)
  const candidates: string[] = []
  if (ext === '.js') {
    candidates.push(
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.mts`,
      `${base}.cts`,
      `${base}.jsx`,
    )
  } else if (ext === '.mjs') {
    candidates.push(`${base}.mts`)
  } else if (ext === '.cjs') {
    candidates.push(`${base}.cts`)
  }
  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate
    }
  }
  return resolvedPath
}

async function resolveWithTsconfigPaths(
  specifier: string,
  tsconfig?: TsconfigResolutionContext,
): Promise<string | undefined> {
  if (!tsconfig) {
    return undefined
  }
  if (tsconfig.matchPath) {
    const matched = tsconfig.matchPath(specifier)
    if (matched && (await fileExists(matched))) {
      return matched
    }
  }
  if (tsconfig.absoluteBaseUrl && isNonRelativeSpecifier(specifier)) {
    const candidate = path.join(
      tsconfig.absoluteBaseUrl,
      specifier.split('/').join(path.sep),
    )
    if (await fileExists(candidate)) {
      return candidate
    }
  }
  return undefined
}

function loadTsconfigResolutionContext(
  rootDir: string,
  loader: typeof getTsconfig = getTsconfig,
): TsconfigResolutionContext | undefined {
  let result: TsConfigResult | null
  try {
    result = loader(rootDir) as TsConfigResult | null
  } catch {
    return undefined
  }
  if (!result) {
    return undefined
  }
  const compilerOptions = result.config.compilerOptions ?? {}
  const configDir = path.dirname(result.path)
  const absoluteBaseUrl = compilerOptions.baseUrl
    ? path.resolve(configDir, compilerOptions.baseUrl)
    : undefined
  const normalizedPaths = normalizeTsconfigPaths(compilerOptions.paths)
  const matchPath =
    absoluteBaseUrl && normalizedPaths
      ? createMatchPath(absoluteBaseUrl, normalizedPaths)
      : undefined
  if (!absoluteBaseUrl && !matchPath) {
    return undefined
  }
  return { absoluteBaseUrl, matchPath }
}

function normalizeTsconfigPaths(
  paths: Record<string, string[] | string> | undefined,
): Record<string, string[]> | undefined {
  if (!paths) {
    return undefined
  }
  const normalized: Record<string, string[]> = {}
  for (const [pattern, replacements] of Object.entries(paths)) {
    if (!replacements) {
      continue
    }
    const values = Array.isArray(replacements) ? replacements : [replacements]
    if (values.length === 0) {
      continue
    }
    normalized[pattern] = values
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined
}

function isNonRelativeSpecifier(specifier: string): boolean {
  if (!specifier) {
    return false
  }
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    return false
  }
  if (/^[a-z][\w+.-]*:/i.test(specifier)) {
    return false
  }
  return true
}

function createProjectPeerResolver(rootDir: string) {
  const resolver = getProjectRequire(rootDir)
  return async (name: string) => {
    const resolved = resolver.resolve(name)
    return import(pathToFileURL(resolved).href)
  }
}

function getProjectRequire(rootDir: string): ReturnType<typeof createRequire> {
  const cached = projectRequireCache.get(rootDir)
  if (cached) {
    return cached
  }
  const anchor = path.join(rootDir, 'package.json')
  let loader: ReturnType<typeof createRequire>
  try {
    loader = createRequire(anchor)
  } catch {
    loader = createRequire(path.join(process.cwd(), 'package.json'))
  }
  projectRequireCache.set(rootDir, loader)
  return loader
}

export async function runGenerateTypesCli(argv = process.argv.slice(2)): Promise<void> {
  let parsed: ParsedCliArgs
  try {
    parsed = parseCliArgs(argv)
  } catch (error) {
    console.error(`[knighted-css] ${formatErrorMessage(error)}`)
    process.exitCode = 1
    return
  }
  if (parsed.help) {
    printHelp()
    return
  }
  try {
    const result = await generateTypes({
      rootDir: parsed.rootDir,
      include: parsed.include,
      outDir: parsed.outDir,
      stableNamespace: parsed.stableNamespace,
      autoStable: parsed.autoStable,
    })
    reportCliResult(result)
  } catch (error) {
    console.error('[knighted-css] generate-types failed.')
    console.error(error)
    process.exitCode = 1
  }
}

export interface ParsedCliArgs {
  rootDir: string
  include?: string[]
  outDir?: string
  stableNamespace?: string
  autoStable?: boolean
  help?: boolean
}

function parseCliArgs(argv: string[]): ParsedCliArgs {
  let rootDir = process.cwd()
  const include: string[] = []
  let outDir: string | undefined
  let stableNamespace: string | undefined
  let autoStable = false

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      return { rootDir, include, outDir, stableNamespace, autoStable, help: true }
    }
    if (arg === '--auto-stable') {
      autoStable = true
      continue
    }
    if (arg === '--root' || arg === '-r') {
      const value = argv[++i]
      if (!value) {
        throw new Error('Missing value for --root')
      }
      rootDir = path.resolve(value)
      continue
    }
    if (arg === '--include' || arg === '-i') {
      const value = argv[++i]
      if (!value) {
        throw new Error('Missing value for --include')
      }
      include.push(value)
      continue
    }
    if (arg === '--out-dir') {
      const value = argv[++i]
      if (!value) {
        throw new Error('Missing value for --out-dir')
      }
      outDir = value
      continue
    }
    if (arg === '--stable-namespace') {
      const value = argv[++i]
      if (!value) {
        throw new Error('Missing value for --stable-namespace')
      }
      stableNamespace = value
      continue
    }
    if (arg.startsWith('-')) {
      throw new Error(`Unknown flag: ${arg}`)
    }
    include.push(arg)
  }

  return { rootDir, include, outDir, stableNamespace, autoStable }
}

function printHelp(): void {
  console.log(`Usage: knighted-css-generate-types [options]

Options:
  -r, --root <path>              Project root directory (default: cwd)
  -i, --include <path>           Additional directories/files to scan (repeatable)
      --out-dir <path>           Directory to store selector module manifest cache
      --stable-namespace <name>  Stable namespace prefix for generated selector maps
      --auto-stable              Enable autoStable when extracting CSS for selectors
  -h, --help                     Show this help message
`)
}

function reportCliResult(result: GenerateTypesResult): void {
  if (result.selectorModulesWritten === 0 && result.selectorModulesRemoved === 0) {
    console.log('[knighted-css] Selector modules are up to date.')
  } else {
    console.log(
      `[knighted-css] Selector modules updated: wrote ${result.selectorModulesWritten}, removed ${result.selectorModulesRemoved}.`,
    )
  }
  console.log(`[knighted-css] Manifest: ${result.manifestPath}`)
  for (const warning of result.warnings) {
    console.warn(`[knighted-css] ${warning}`)
  }
}

function setCssWithMetaImplementation(impl?: CssWithMetaFn): void {
  activeCssWithMeta = impl ?? cssWithMeta
}

function setModuleTypeDetector(detector?: ModuleTypeDetector): void {
  moduleTypeDetector = detector ?? moduleType
}

function setImportMetaUrlProvider(provider?: () => string | undefined): void {
  importMetaUrlProvider = provider ?? getImportMetaUrl
}

export const __generateTypesInternals = {
  stripInlineLoader,
  splitResourceAndQuery,
  extractSelectorSourceSpecifier,
  findSpecifierImports,
  resolveImportPath,
  resolvePackageRoot,
  relativeToRoot,
  collectCandidateFiles,
  normalizeIncludeOptions,
  normalizeTsconfigPaths,
  setCssWithMetaImplementation,
  setModuleTypeDetector,
  setImportMetaUrlProvider,
  isNonRelativeSpecifier,
  createProjectPeerResolver,
  getProjectRequire,
  loadTsconfigResolutionContext,
  resolveWithTsconfigPaths,
  parseCliArgs,
  printHelp,
  reportCliResult,
  buildSelectorModuleManifestKey,
  buildSelectorModulePath,
  formatSelectorModuleSource,
  ensureSelectorModule,
  removeStaleSelectorModules,
  readManifest,
  writeManifest,
}
