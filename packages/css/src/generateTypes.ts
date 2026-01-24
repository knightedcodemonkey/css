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
import { createResolverFactory, resolveWithFactory } from './moduleResolution.js'
import { buildStableSelectorsLiteral } from './stableSelectorsLiteral.js'
import { resolveStableNamespace } from './stableNamespace.js'
import type { CssResolver } from './types.js'

interface ImportMatch {
  specifier: string
  importer: string
}

interface ManifestEntry {
  file: string
  hash: string
}

type SelectorModuleManifest = Record<string, ManifestEntry>

type SidecarManifest = Record<string, { file: string }>

interface TsconfigResolutionContext {
  absoluteBaseUrl?: string
  matchPath?: MatchPath
}

interface SelectorModuleProxyInfo {
  moduleSpecifier: string
  includeDefault: boolean
  exportedNames?: Set<string>
}

export type GenerateTypesMode = 'module' | 'declaration'

type CssWithMetaFn = typeof cssWithMeta

let activeCssWithMeta: CssWithMetaFn = cssWithMeta

interface GenerateTypesInternalOptions {
  rootDir: string
  include: string[]
  cacheDir: string
  stableNamespace?: string
  autoStable?: boolean
  hashed?: boolean
  tsconfig?: TsconfigResolutionContext
  resolver?: CssResolver
  mode: GenerateTypesMode
  manifestPath?: string
}

export interface GenerateTypesResult {
  selectorModulesWritten: number
  selectorModulesRemoved: number
  warnings: string[]
  manifestPath: string
  sidecarManifestPath?: string
}

export interface GenerateTypesOptions {
  rootDir?: string
  include?: string[]
  outDir?: string
  stableNamespace?: string
  autoStable?: boolean
  hashed?: boolean
  resolver?: CssResolver
  mode?: GenerateTypesMode
  manifestPath?: string
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
const DECLARATION_SUFFIX = '.d.ts'
const STYLE_EXTENSIONS = DEFAULT_EXTENSIONS.map(ext => ext.toLowerCase())
const SCRIPT_EXTENSIONS = Array.from(SUPPORTED_EXTENSIONS)
const RESOLUTION_EXTENSIONS = Array.from(
  new Set<string>([...SCRIPT_EXTENSIONS, ...STYLE_EXTENSIONS]),
)
const EXTENSION_FALLBACKS: Record<string, string[]> = {
  '.js': ['.ts', '.tsx', '.jsx', '.mjs', '.cjs'],
  '.mjs': ['.mts', '.mjs', '.js', '.ts', '.tsx'],
  '.cjs': ['.cts', '.cjs', '.js', '.ts', '.tsx'],
  '.jsx': ['.tsx', '.jsx'],
}

const DECLARATION_MODE_WARNING =
  'Declaration mode requires a resolver plugin to append ?knighted-css (and &combined when applicable) so runtime exports match the generated types.'

export async function generateTypes(
  options: GenerateTypesOptions = {},
): Promise<GenerateTypesResult> {
  const rootDir = await resolveRootDir(path.resolve(options.rootDir ?? process.cwd()))
  const include = normalizeIncludeOptions(options.include, rootDir)
  const cacheDir = path.resolve(options.outDir ?? path.join(rootDir, '.knighted-css'))
  const tsconfig = loadTsconfigResolutionContext(rootDir)
  const mode = options.mode ?? 'module'
  const manifestPath = options.manifestPath
    ? path.resolve(rootDir, options.manifestPath)
    : undefined

  await fs.mkdir(cacheDir, { recursive: true })

  const internalOptions: GenerateTypesInternalOptions = {
    rootDir,
    include,
    cacheDir,
    stableNamespace: options.stableNamespace,
    autoStable: options.autoStable,
    hashed: options.hashed,
    tsconfig,
    resolver: options.resolver,
    mode,
    manifestPath,
  }

  return generateDeclarations(internalOptions)
}

async function resolveRootDir(rootDir: string): Promise<string> {
  try {
    return await fs.realpath(rootDir)
  } catch {
    return rootDir
  }
}

async function generateDeclarations(
  options: GenerateTypesInternalOptions,
): Promise<GenerateTypesResult> {
  const peerResolver = createProjectPeerResolver(options.rootDir)
  const resolverFactory = createResolverFactory(
    options.rootDir,
    RESOLUTION_EXTENSIONS,
    SCRIPT_EXTENSIONS,
  )
  const files = await collectCandidateFiles(options.include)
  const selectorModulesManifestPath = path.join(options.cacheDir, 'selector-modules.json')
  const previousSelectorManifest = await readManifest(selectorModulesManifestPath)
  const nextSelectorManifest: SelectorModuleManifest = {}
  const sidecarManifest: SidecarManifest = {}
  const selectorCache = new Map<string, Map<string, string>>()
  const processedSelectors = new Set<string>()
  const proxyInfoCache = new Map<string, SelectorModuleProxyInfo | null>()
  const warnings: string[] = []
  let selectorModuleWrites = 0

  if (options.mode === 'declaration') {
    warnings.push(DECLARATION_MODE_WARNING)
  }

  if (options.mode === 'declaration') {
    for (const filePath of files) {
      if (!isScriptResource(filePath)) {
        continue
      }
      if (!isWithinRoot(filePath, options.rootDir)) {
        warnings.push(
          `Skipping declaration output for ${relativeToRoot(filePath, options.rootDir)} because it is outside the project root.`,
        )
        continue
      }
      const manifestKey = buildSelectorModuleManifestKey(filePath)
      if (processedSelectors.has(manifestKey)) {
        continue
      }

      const hasStyles = await hasStyleImports(filePath, {
        rootDir: options.rootDir,
        tsconfig: options.tsconfig,
        resolver: options.resolver,
        resolverFactory,
      })
      if (!hasStyles) {
        processedSelectors.add(manifestKey)
        continue
      }

      const resolvedNamespace = resolveStableNamespace(options.stableNamespace)
      const cacheKey = `${filePath}::${resolvedNamespace}::declaration`
      let selectorMap = selectorCache.get(cacheKey)
      if (!selectorMap) {
        try {
          let cssResult = await activeCssWithMeta(filePath, {
            cwd: options.rootDir,
            peerResolver,
            autoStable: options.autoStable ? { namespace: resolvedNamespace } : undefined,
            resolver: options.resolver,
          })

          if (cssResult.files.length === 0 || cssResult.css.trim().length === 0) {
            processedSelectors.add(manifestKey)
            continue
          }

          if (
            options.autoStable &&
            cssResult.files.some(file => isCssModuleResource(file))
          ) {
            cssResult = await activeCssWithMeta(filePath, {
              cwd: options.rootDir,
              peerResolver,
              autoStable: options.autoStable
                ? { namespace: resolvedNamespace }
                : undefined,
              lightningcss: { cssModules: true },
              resolver: options.resolver,
            })
          }

          selectorMap = options.hashed
            ? collectSelectorTokensFromCss(cssResult.css)
            : buildStableSelectorsLiteral({
                css: cssResult.css,
                namespace: resolvedNamespace,
                resourcePath: filePath,
                emitWarning: message => warnings.push(message),
              }).selectorMap
        } catch (error) {
          warnings.push(
            `Failed to extract CSS for ${relativeToRoot(filePath, options.rootDir)}: ${formatErrorMessage(error)}`,
          )
          processedSelectors.add(manifestKey)
          continue
        }
        selectorCache.set(cacheKey, selectorMap)
      }

      if (!selectorMap || selectorMap.size === 0) {
        processedSelectors.add(manifestKey)
        continue
      }

      const proxyInfo = await resolveDeclarationProxyInfo(
        manifestKey,
        filePath,
        proxyInfoCache,
      )
      if (!proxyInfo) {
        processedSelectors.add(manifestKey)
        continue
      }
      const moduleWrite = await ensureDeclarationModule(
        filePath,
        selectorMap,
        previousSelectorManifest,
        nextSelectorManifest,
        proxyInfo,
        options.hashed ?? false,
      )
      if (options.manifestPath) {
        sidecarManifest[manifestKey] = { file: buildDeclarationPath(filePath) }
      }
      if (moduleWrite) {
        selectorModuleWrites += 1
      }
      processedSelectors.add(manifestKey)
    }
  } else {
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
          options.resolver,
          resolverFactory,
          RESOLUTION_EXTENSIONS,
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
              autoStable: options.autoStable
                ? { namespace: resolvedNamespace }
                : undefined,
              lightningcss:
                options.autoStable && shouldUseCssModules
                  ? { cssModules: true }
                  : undefined,
              resolver: options.resolver,
            })
            selectorMap = options.hashed
              ? collectSelectorTokensFromCss(css)
              : buildStableSelectorsLiteral({
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
          selectorSource,
          proxyInfo ?? undefined,
          options.hashed ?? false,
        )
        if (moduleWrite) {
          selectorModuleWrites += 1
        }
        processedSelectors.add(manifestKey)
      }
    }
  }

  const selectorModulesRemoved = await removeStaleSelectorModules(
    previousSelectorManifest,
    nextSelectorManifest,
  )
  await writeManifest(selectorModulesManifestPath, nextSelectorManifest)
  if (options.manifestPath && options.mode === 'declaration') {
    await writeSidecarManifest(options.manifestPath, sidecarManifest)
  }

  return {
    selectorModulesWritten: selectorModuleWrites,
    selectorModulesRemoved,
    warnings,
    manifestPath: selectorModulesManifestPath,
    sidecarManifestPath:
      options.mode === 'declaration' ? options.manifestPath : undefined,
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
  const hashOffset = specifier.startsWith('#') ? 1 : 0
  const hashIndex = specifier.indexOf('#', hashOffset)
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
  resolver?: CssResolver,
  resolverFactory?: ReturnType<typeof createResolverFactory>,
  resolutionExtensions: string[] = RESOLUTION_EXTENSIONS,
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
  if (resolver) {
    const resolved = await resolveWithResolver(
      resourceSpecifier,
      resolver,
      rootDir,
      importerPath,
    )
    if (resolved) {
      return resolveWithExtensionFallback(resolved)
    }
  }
  const tsconfigResolved = await resolveWithTsconfigPaths(resourceSpecifier, tsconfig)
  if (tsconfigResolved) {
    return resolveWithExtensionFallback(tsconfigResolved)
  }
  if (resolverFactory) {
    const resolved = resolveWithFactory(
      resolverFactory,
      resourceSpecifier,
      importerPath,
      resolutionExtensions,
    )
    if (resolved) {
      return resolved
    }
  }
  const requireFromRoot = getProjectRequire(rootDir)
  try {
    return requireFromRoot.resolve(resourceSpecifier)
  } catch {
    return undefined
  }
}

async function resolveWithResolver(
  specifier: string,
  resolver: CssResolver,
  rootDir: string,
  importerPath?: string,
): Promise<string | undefined> {
  const resolved = await resolver(specifier, { cwd: rootDir, from: importerPath })
  if (!resolved) {
    return undefined
  }
  if (resolved.startsWith('file://')) {
    try {
      return fileURLToPath(new URL(resolved))
    } catch {
      return undefined
    }
  }
  return path.isAbsolute(resolved) ? resolved : path.resolve(rootDir, resolved)
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

function buildDeclarationModuleSpecifier(resolvedPath: string): string {
  const ext = path.extname(resolvedPath).toLowerCase()
  const baseName = path.basename(resolvedPath, ext)
  const mappedExt =
    ext === '.mjs' || ext === '.mts'
      ? '.mjs'
      : ext === '.cjs' || ext === '.cts'
        ? '.cjs'
        : '.js'
  return `./${baseName}${mappedExt}`
}

function buildDeclarationPath(resolvedPath: string): string {
  if (resolvedPath.endsWith(DECLARATION_SUFFIX)) {
    return resolvedPath
  }
  return `${resolvedPath}${DECLARATION_SUFFIX}`
}

function formatSelectorTypeLiteral(selectors: Map<string, string>): string {
  const entries = Array.from(selectors.keys()).sort((a, b) => a.localeCompare(b))
  const typeLines = entries.map(token => `    readonly ${JSON.stringify(token)}: string`)
  return typeLines.length > 0
    ? `{
${typeLines.join('\n')}
  }`
    : 'Record<string, string>'
}

function formatDeclarationSource(
  selectors: Map<string, string>,
  proxyInfo: SelectorModuleProxyInfo,
  options: {
    hashed?: boolean
  } = {},
): string {
  const header = '// Generated by @knighted/css/generate-types\n// Do not edit.'
  const isHashed = options.hashed === true
  const marker = isHashed ? '// @knighted-css:hashed' : '// @knighted-css'
  const exportName = isHashed ? 'selectors' : 'stableSelectors'
  const typeLiteral = formatSelectorTypeLiteral(selectors)
  const shouldEmit = (name: string) => !proxyInfo.exportedNames?.has(name)
  const lines = [
    header,
    marker,
    '',
    `declare module '${proxyInfo.moduleSpecifier}' {`,
    shouldEmit('knightedCss') ? '  export const knightedCss: string' : '',
    shouldEmit(exportName) ? `  export const ${exportName}: ${typeLiteral}` : '',
    '}',
    'export {}',
  ].filter(Boolean)
  return `${lines.join('\n')}\n`
}

function formatSelectorModuleSource(
  selectors: Map<string, string>,
  proxyInfo?: SelectorModuleProxyInfo,
  options: {
    hashed?: boolean
    selectorSource?: string
    resolvedPath?: string
  } = {},
): string {
  const header = '// Generated by @knighted/css/generate-types\n// Do not edit.'
  const entries = Array.from(selectors.entries()).sort(([a], [b]) => a.localeCompare(b))
  const isHashed = options.hashed === true
  const lines = entries.map(
    ([token, selector]) => `  ${JSON.stringify(token)}: ${JSON.stringify(selector)},`,
  )
  const literal =
    lines.length > 0
      ? `{
${lines.join('\n')}
} as const`
      : '{} as const'
  const typeLines = entries.map(
    ([token]) => `  readonly ${JSON.stringify(token)}: string`,
  )
  const typeLiteral =
    typeLines.length > 0
      ? `{
${typeLines.join('\n')}
}`
      : 'Record<string, string>'
  const proxyLines: string[] = []
  const reexportLines: string[] = []
  const hashedSpecifier =
    options.selectorSource && options.resolvedPath
      ? buildProxyModuleSpecifier(options.resolvedPath, options.selectorSource)
      : undefined

  if (proxyInfo) {
    reexportLines.push(`export * from '${proxyInfo.moduleSpecifier}'`)
    if (proxyInfo.includeDefault) {
      reexportLines.push(`export { default } from '${proxyInfo.moduleSpecifier}'`)
    }
  }

  if (isHashed) {
    const sourceSpecifier = proxyInfo?.moduleSpecifier ?? hashedSpecifier
    if (sourceSpecifier) {
      proxyLines.push(
        `import { knightedCss as __knightedCss, knightedCssModules as __knightedCssModules } from '${sourceSpecifier}?knighted-css'`,
      )
      proxyLines.push('export const knightedCss = __knightedCss')
      proxyLines.push('export const knightedCssModules = __knightedCssModules')
    }
  } else if (proxyInfo) {
    proxyLines.push(
      `export { knightedCss } from '${proxyInfo.moduleSpecifier}?knighted-css'`,
    )
  }

  const exportName = isHashed ? 'selectors' : 'stableSelectors'
  const typeName = isHashed ? 'KnightedCssSelectors' : 'KnightedCssStableSelectors'
  const tokenTypeName = isHashed
    ? 'KnightedCssSelectorToken'
    : 'KnightedCssStableSelectorToken'
  const defaultExport = proxyInfo ? '' : `\nexport default ${exportName}`

  const selectorBlock = isHashed
    ? `export const ${exportName} = __knightedCssModules as ${typeLiteral}

export type ${typeName} = typeof ${exportName}
export type ${tokenTypeName} = keyof typeof ${exportName}${defaultExport}`
    : `export const ${exportName} = ${literal}

export type ${typeName} = typeof ${exportName}
export type ${tokenTypeName} = keyof typeof ${exportName}${defaultExport}`

  const sections = [
    header,
    proxyLines.join('\n'),
    reexportLines.join('\n'),
    selectorBlock,
  ].filter(Boolean)
  return `${sections.join('\n\n')}
`
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

async function writeSidecarManifest(
  manifestPath: string,
  manifest: SidecarManifest,
): Promise<void> {
  await fs.mkdir(path.dirname(manifestPath), { recursive: true })
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
  selectorSource: string,
  proxyInfo?: SelectorModuleProxyInfo,
  hashed?: boolean,
): Promise<boolean> {
  const manifestKey = buildSelectorModuleManifestKey(resolvedPath)
  const targetPath = buildSelectorModulePath(resolvedPath)
  const source = formatSelectorModuleSource(selectors, proxyInfo, {
    hashed,
    selectorSource,
    resolvedPath,
  })
  const hash = hashContent(source)
  const previousEntry = previousManifest[manifestKey]
  const needsWrite = previousEntry?.hash !== hash || !(await fileExists(targetPath))
  if (needsWrite) {
    await fs.writeFile(targetPath, source, 'utf8')
  }
  nextManifest[manifestKey] = { file: targetPath, hash }
  return needsWrite
}

async function ensureDeclarationModule(
  resolvedPath: string,
  selectors: Map<string, string>,
  previousManifest: SelectorModuleManifest,
  nextManifest: SelectorModuleManifest,
  proxyInfo: SelectorModuleProxyInfo,
  hashed?: boolean,
): Promise<boolean> {
  const manifestKey = buildSelectorModuleManifestKey(resolvedPath)
  const targetPath = buildDeclarationPath(resolvedPath)
  const source = formatDeclarationSource(selectors, proxyInfo, { hashed })
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

function isCssModuleResource(filePath: string): boolean {
  return /\.module\.(css|scss|sass|less)$/i.test(filePath)
}

function isScriptResource(filePath: string): boolean {
  const normalized = filePath.toLowerCase()
  if (normalized.endsWith('.d.ts')) {
    return false
  }
  return SCRIPT_EXTENSIONS.some(ext => normalized.endsWith(ext))
}

async function hasStyleImports(
  filePath: string,
  options: {
    rootDir: string
    tsconfig?: TsconfigResolutionContext
    resolver?: CssResolver
    resolverFactory?: ReturnType<typeof createResolverFactory>
  },
): Promise<boolean> {
  let source: string
  try {
    source = await fs.readFile(filePath, 'utf8')
  } catch {
    return false
  }

  const candidates = new Set<string>()
  try {
    const analysis = await analyzeModule(source, filePath)
    for (const specifier of analysis.imports) {
      if (specifier) {
        candidates.add(specifier)
      }
    }
  } catch {
    // fall back to regex scanning below
  }

  const importRegex = /(import|require)\s*(?:\(|[^'"`]*)(['"])([^'"`]+)\2/g
  let match: RegExpExecArray | null
  while ((match = importRegex.exec(source)) !== null) {
    const specifier = match[3]
    if (specifier) {
      candidates.add(specifier)
    }
  }

  for (const specifier of candidates) {
    const cleaned = stripInlineLoader(specifier.trim())
    const { resource } = splitResourceAndQuery(cleaned)
    if (!resource) {
      continue
    }
    if (isStyleResource(resource)) {
      return true
    }
    const resolved = await resolveImportPath(
      resource,
      filePath,
      options.rootDir,
      options.tsconfig,
      options.resolver,
      options.resolverFactory,
      RESOLUTION_EXTENSIONS,
    )
    if (resolved && isStyleResource(resolved)) {
      return true
    }
  }

  return false
}

function collectSelectorTokensFromCss(css: string): Map<string, string> {
  const tokens = new Set<string>()
  const pattern = /\.([A-Za-z_-][A-Za-z0-9_-]*)\b/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(css)) !== null) {
    const token = match[1]
    if (token) {
      tokens.add(token)
    }
  }
  const map = new Map<string, string>()
  for (const token of tokens) {
    map.set(token, token)
  }
  return map
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

async function resolveDeclarationProxyInfo(
  manifestKey: string,
  resolvedPath: string,
  cache: Map<string, SelectorModuleProxyInfo | null>,
): Promise<SelectorModuleProxyInfo | null> {
  const cached = cache.get(manifestKey)
  if (cached !== undefined) {
    return cached
  }
  const defaultSignal = await getDefaultExportSignal(resolvedPath)
  const exportedNames = await getNamedExports(resolvedPath)
  const proxyInfo = {
    moduleSpecifier: buildDeclarationModuleSpecifier(resolvedPath),
    includeDefault: defaultSignal === 'has-default',
    exportedNames,
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

async function getNamedExports(filePath: string): Promise<Set<string>> {
  try {
    const source = await fs.readFile(filePath, 'utf8')
    const analysis = await analyzeModule(source, filePath)
    return new Set(analysis.exports ?? [])
  } catch {
    return new Set()
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

function resolveResolverModulePath(specifier: string, rootDir: string): string {
  if (specifier.startsWith('file://')) {
    return fileURLToPath(new URL(specifier))
  }
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    return path.resolve(rootDir, specifier)
  }
  const requireFromRoot = getProjectRequire(rootDir)
  return requireFromRoot.resolve(specifier)
}

async function loadResolverModule(
  specifier: string,
  rootDir: string,
): Promise<CssResolver> {
  const resolvedPath = resolveResolverModulePath(specifier, rootDir)
  const mod = await import(pathToFileURL(resolvedPath).href)
  const candidate =
    typeof mod.default === 'function'
      ? (mod.default as CssResolver)
      : typeof (mod as { resolver?: unknown }).resolver === 'function'
        ? ((mod as { resolver: CssResolver }).resolver as CssResolver)
        : undefined
  if (!candidate) {
    throw new Error(
      'Resolver module must export a function as the default export or a named export named "resolver".',
    )
  }
  return candidate
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
    const resolver = parsed.resolver
      ? await loadResolverModule(parsed.resolver, parsed.rootDir)
      : undefined
    const result = await generateTypes({
      rootDir: parsed.rootDir,
      include: parsed.include,
      outDir: parsed.outDir,
      stableNamespace: parsed.stableNamespace,
      autoStable: parsed.autoStable,
      hashed: parsed.hashed,
      resolver,
      mode: parsed.mode,
      manifestPath: parsed.manifestPath,
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
  hashed?: boolean
  resolver?: string
  mode: GenerateTypesMode
  manifestPath?: string
  help?: boolean
}

function parseCliArgs(argv: string[]): ParsedCliArgs {
  let rootDir = process.cwd()
  const include: string[] = []
  let outDir: string | undefined
  let stableNamespace: string | undefined
  let autoStable = false
  let hashed = false
  let resolver: string | undefined
  let mode: GenerateTypesMode = 'module'
  let manifestPath: string | undefined

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      return {
        rootDir,
        include,
        outDir,
        stableNamespace,
        autoStable,
        mode,
        help: true,
      }
    }
    if (arg === '--auto-stable') {
      autoStable = true
      continue
    }
    if (arg === '--hashed') {
      hashed = true
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
    if (arg === '--manifest') {
      const value = argv[++i]
      if (!value) {
        throw new Error('Missing value for --manifest')
      }
      manifestPath = value
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
    if (arg === '--resolver') {
      const value = argv[++i]
      if (!value) {
        throw new Error('Missing value for --resolver')
      }
      resolver = value
      continue
    }
    if (arg === '--mode') {
      const value = argv[++i]
      if (!value) {
        throw new Error('Missing value for --mode')
      }
      if (value !== 'module' && value !== 'declaration') {
        throw new Error(`Unknown mode: ${value}`)
      }
      mode = value
      continue
    }
    if (arg.startsWith('-')) {
      throw new Error(`Unknown flag: ${arg}`)
    }
    include.push(arg)
  }

  if (autoStable && hashed) {
    throw new Error('Cannot combine --auto-stable with --hashed')
  }
  if (manifestPath && mode !== 'declaration') {
    throw new Error('Cannot use --manifest unless --mode is declaration')
  }

  return {
    rootDir,
    include,
    outDir,
    stableNamespace,
    autoStable,
    hashed,
    resolver,
    mode,
    manifestPath,
  }
}

function printHelp(): void {
  console.log(`Usage: knighted-css-generate-types [options]

Options:
  -r, --root <path>                Project root directory (default: cwd)
  -i, --include <path>             Additional directories/files to scan (repeatable)
      --out-dir <path>             Directory to store selector module manifest cache
      --stable-namespace <name>    Stable namespace prefix for generated selector maps
      --auto-stable                Enable autoStable when extracting CSS for selectors
      --hashed                     Emit selectors backed by loader-bridge hashed modules
      --resolver <path>            Path or package name exporting a CssResolver
      --mode <module|declaration>  Emit selector modules (module) or declaration files (declaration)
      --manifest <path>            Write a sidecar manifest (declaration mode only)
  -h, --help                       Show this help message
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
  if (result.sidecarManifestPath) {
    console.log(`[knighted-css] Sidecar manifest: ${result.sidecarManifestPath}`)
  }
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
  isCssModuleResource,
  resolveProxyInfo,
  resolveDeclarationProxyInfo,
  resolveWithExtensionFallback,
  resolveIndexFallback,
  createProjectPeerResolver,
  getProjectRequire,
  loadTsconfigResolutionContext,
  resolveWithTsconfigPaths,
  hasStyleImports,
  loadResolverModule,
  parseCliArgs,
  printHelp,
  reportCliResult,
  buildSelectorModuleManifestKey,
  buildSelectorModulePath,
  buildDeclarationModuleSpecifier,
  formatSelectorModuleSource,
  buildDeclarationPath,
  formatDeclarationSource,
  ensureDeclarationModule,
  ensureSelectorModule,
  removeStaleSelectorModules,
  readManifest,
  writeManifest,
  writeSidecarManifest,
}
