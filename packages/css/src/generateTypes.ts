import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { moduleType } from 'node-module-type'

import { getTsconfig, type TsConfigResult } from 'get-tsconfig'
import { createMatchPath, type MatchPath } from 'tsconfig-paths'

import { cssWithMeta, DEFAULT_EXTENSIONS } from './css.js'
import { analyzeModule, type DefaultExportSignal } from './lexer.js'
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

interface TsconfigResolutionContext {
  absoluteBaseUrl?: string
  matchPath?: MatchPath
}

interface SelectorModuleProxyInfo {
  moduleSpecifier: string
  includeDefault: boolean
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
const SELECTOR_MODULE_SUFFIX = '.knighted-css.ts'
const STYLE_EXTENSIONS = DEFAULT_EXTENSIONS.map(ext => ext.toLowerCase())
const EXTENSION_FALLBACKS: Record<string, string[]> = {
  '.js': ['.ts', '.tsx', '.jsx', '.mjs', '.cjs'],
  '.mjs': ['.mts', '.mjs', '.js', '.ts', '.tsx'],
  '.cjs': ['.cts', '.cjs', '.js', '.ts', '.tsx'],
  '.jsx': ['.tsx', '.jsx'],
}

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
  const previousSelectorManifest = await readManifest(selectorModulesManifestPath)
  const nextSelectorManifest: SelectorModuleManifest = {}
  const selectorCache = new Map<string, Map<string, string>>()
  const processedSelectors = new Set<string>()
  const proxyInfoCache = new Map<string, SelectorModuleProxyInfo | null>()
  const warnings: string[] = []
  let selectorModuleWrites = 0

  for (const filePath of files) {
    const matches = await findSpecifierImports(filePath)
    for (const match of matches) {
      const cleaned = match.specifier.trim()
      const inlineFree = stripInlineLoader(cleaned)
      const { resource } = splitResourceAndQuery(inlineFree)
      const selectorSource = extractSelectorSourceSpecifier(resource)
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
      if (processedSelectors.has(manifestKey)) {
        continue
      }
      const proxyInfo = await resolveProxyInfo(
        manifestKey,
        selectorSource,
        resolvedPath,
        proxyInfoCache,
      )
      const moduleWrite = await ensureSelectorModule(
        resolvedPath,
        selectorMap,
        previousSelectorManifest,
        nextSelectorManifest,
        proxyInfo ?? undefined,
      )
      if (moduleWrite) {
        selectorModuleWrites += 1
      }
      processedSelectors.add(manifestKey)
    }
  }

  const selectorModulesRemoved = await removeStaleSelectorModules(
    previousSelectorManifest,
    nextSelectorManifest,
  )
  await writeManifest(selectorModulesManifestPath, nextSelectorManifest)

  return {
    selectorModulesWritten: selectorModuleWrites,
    selectorModulesRemoved,
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
  if (!source.includes(SELECTOR_REFERENCE)) {
    return []
  }
  const matches: ImportMatch[] = []
  try {
    const { imports } = await analyzeModule(source, filePath)
    for (const specifier of imports) {
      if (specifier.includes(SELECTOR_REFERENCE)) {
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
  /**
   * Handles specifiers like "./entry.knighted-css.ts" where the base has no
   * extension but the selector suffix includes one.
   */
  if (suffix && !path.extname(base)) {
    return `${base}${suffix}`
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
    return resolveWithExtensionFallback(
      path.resolve(path.dirname(importerPath), resourceSpecifier),
    )
  }
  if (resourceSpecifier.startsWith('/')) {
    return resolveWithExtensionFallback(path.resolve(rootDir, resourceSpecifier.slice(1)))
  }
  const tsconfigResolved = await resolveWithTsconfigPaths(resourceSpecifier, tsconfig)
  if (tsconfigResolved) {
    return resolveWithExtensionFallback(tsconfigResolved)
  }
  const requireFromRoot = getProjectRequire(rootDir)
  try {
    return requireFromRoot.resolve(resourceSpecifier)
  } catch {
    return undefined
  }
}

function buildSelectorModuleManifestKey(resolvedPath: string): string {
  return resolvedPath.split(path.sep).join('/')
}

function buildSelectorModulePath(resolvedPath: string): string {
  if (isStyleResource(resolvedPath)) {
    return `${resolvedPath}${SELECTOR_MODULE_SUFFIX}`
  }
  const ext = path.extname(resolvedPath)
  const base = ext ? resolvedPath.slice(0, -ext.length) : resolvedPath
  return `${base}${SELECTOR_MODULE_SUFFIX}`
}

function formatSelectorModuleSource(
  selectors: Map<string, string>,
  proxyInfo?: SelectorModuleProxyInfo,
): string {
  const header = '// Generated by @knighted/css/generate-types\n// Do not edit.\n\n'
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
  const proxyLines: string[] = []
  if (proxyInfo) {
    proxyLines.push(`export * from '${proxyInfo.moduleSpecifier}'`)
    if (proxyInfo.includeDefault) {
      proxyLines.push(`export { default } from '${proxyInfo.moduleSpecifier}'`)
    }
    proxyLines.push(
      `export { knightedCss } from '${proxyInfo.moduleSpecifier}?knighted-css'`,
    )
    proxyLines.push('')
  }
  const defaultExport = proxyInfo ? '' : '\nexport default stableSelectors\n'
  return `${header}${proxyLines.join('\n')}
export const stableSelectors = ${literal}

export type KnightedCssStableSelectors = typeof stableSelectors
export type KnightedCssStableSelectorToken = keyof typeof stableSelectors${defaultExport}`
}

function hashContent(content: string): string {
  return crypto.createHash('sha1').update(content).digest('hex')
}

async function readManifest(manifestPath: string): Promise<SelectorModuleManifest> {
  try {
    const raw = await fs.readFile(manifestPath, 'utf8')
    return JSON.parse(raw) as SelectorModuleManifest
  } catch {
    return {}
  }
}

async function writeManifest(
  manifestPath: string,
  manifest: SelectorModuleManifest,
): Promise<void> {
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
}

async function removeStaleSelectorModules(
  previous: SelectorModuleManifest,
  next: SelectorModuleManifest,
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
  proxyInfo?: SelectorModuleProxyInfo,
): Promise<boolean> {
  const manifestKey = buildSelectorModuleManifestKey(resolvedPath)
  const targetPath = buildSelectorModulePath(resolvedPath)
  const source = formatSelectorModuleSource(selectors, proxyInfo)
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

async function resolveWithExtensionFallback(
  candidatePath: string,
): Promise<string | undefined> {
  try {
    const stat = await fs.stat(candidatePath)
    if (stat.isFile()) {
      return candidatePath
    }
  } catch {
    // continue to resolution fallbacks
  }
  const ext = path.extname(candidatePath)
  const base = ext ? candidatePath.slice(0, -ext.length) : candidatePath
  if (!ext) {
    const resolved = await resolveWithExtensionList(
      base,
      Array.from(SUPPORTED_EXTENSIONS),
    )
    if (resolved) {
      return resolved
    }
  }
  if (ext && EXTENSION_FALLBACKS[ext]) {
    const resolved = await resolveWithExtensionList(base, EXTENSION_FALLBACKS[ext])
    if (resolved) {
      return resolved
    }
  }
  const indexResolved = await resolveIndexFallback(candidatePath)
  if (indexResolved) {
    return indexResolved
  }
  /*
   * Return the original candidate to preserve existing behavior when nothing
   * resolves (callers may still want a best-effort path for warnings).
   */
  return candidatePath
}

async function resolveWithExtensionList(
  base: string,
  extensions: string[],
): Promise<string | undefined> {
  for (const extension of extensions) {
    const candidate = `${base}${extension}`
    if (await fileExists(candidate)) {
      return candidate
    }
  }
  return undefined
}

async function resolveIndexFallback(candidatePath: string): Promise<string | undefined> {
  try {
    const stat = await fs.stat(candidatePath)
    if (!stat.isDirectory()) {
      return undefined
    }
  } catch {
    return undefined
  }
  const base = path.join(candidatePath, 'index')
  return resolveWithExtensionList(base, Array.from(SUPPORTED_EXTENSIONS))
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

function isStyleResource(filePath: string): boolean {
  const normalized = filePath.toLowerCase()
  return STYLE_EXTENSIONS.some(ext => normalized.endsWith(ext))
}

async function resolveProxyInfo(
  manifestKey: string,
  selectorSource: string,
  resolvedPath: string,
  cache: Map<string, SelectorModuleProxyInfo | null>,
): Promise<SelectorModuleProxyInfo | null> {
  if (isStyleResource(resolvedPath)) {
    return null
  }
  const cached = cache.get(manifestKey)
  if (cached !== undefined) {
    return cached
  }
  const defaultSignal = await getDefaultExportSignal(resolvedPath)
  const proxyInfo = {
    moduleSpecifier: buildProxyModuleSpecifier(resolvedPath, selectorSource),
    includeDefault: defaultSignal === 'has-default',
  }
  cache.set(manifestKey, proxyInfo)
  return proxyInfo
}

function buildProxyModuleSpecifier(resolvedPath: string, selectorSource: string): string {
  const resolvedExt = path.extname(resolvedPath)
  const baseName = path.basename(resolvedPath, resolvedExt)
  const selectorExt = path.extname(selectorSource)
  const fileName = selectorExt ? `${baseName}${selectorExt}` : `${baseName}.js`
  return `./${fileName}`
}

async function getDefaultExportSignal(filePath: string): Promise<DefaultExportSignal> {
  try {
    const source = await fs.readFile(filePath, 'utf8')
    const analysis = await analyzeModule(source, filePath)
    return analysis.defaultSignal
  } catch {
    return 'unknown'
  }
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
  isStyleResource,
  resolveWithExtensionFallback,
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
