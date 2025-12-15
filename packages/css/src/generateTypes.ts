import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

import { init, parse } from 'es-module-lexer'

import { cssWithMeta } from './css.js'
import {
  determineSelectorVariant,
  hasQueryFlag,
  TYPES_QUERY_FLAG,
  type SelectorTypeVariant,
} from './loaderInternals.js'
import { buildStableSelectorsLiteral } from './stableSelectorsLiteral.js'
import { resolveStableNamespace } from './stableNamespace.js'

interface ManifestEntry {
  file: string
  hash: string
}

type Manifest = Record<string, ManifestEntry>

interface ImportMatch {
  specifier: string
  importer: string
}

interface DeclarationRecord {
  specifier: string
  filePath: string
}

interface GenerateTypesInternalOptions {
  rootDir: string
  include: string[]
  outDir: string
  typesRoot: string
  stableNamespace?: string
}

export interface GenerateTypesResult {
  written: number
  removed: number
  declarations: DeclarationRecord[]
  warnings: string[]
  outDir: string
  typesIndexPath: string
}

export interface GenerateTypesOptions {
  rootDir?: string
  include?: string[]
  outDir?: string
  typesRoot?: string
  stableNamespace?: string
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

export async function generateTypes(
  options: GenerateTypesOptions = {},
): Promise<GenerateTypesResult> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd())
  const include = normalizeIncludeOptions(options.include, rootDir)
  const outDir = path.resolve(
    options.outDir ?? path.join(rootDir, 'node_modules', '.knighted-css'),
  )
  const typesRoot = path.resolve(
    options.typesRoot ?? path.join(rootDir, 'node_modules', '@types', 'knighted__css'),
  )
  await init
  await fs.mkdir(outDir, { recursive: true })
  await fs.mkdir(typesRoot, { recursive: true })

  const internalOptions: GenerateTypesInternalOptions = {
    rootDir,
    include,
    outDir,
    typesRoot,
    stableNamespace: options.stableNamespace,
  }

  return generateDeclarations(internalOptions)
}

async function generateDeclarations(
  options: GenerateTypesInternalOptions,
): Promise<GenerateTypesResult> {
  const peerResolver = createProjectPeerResolver(options.rootDir)
  const files = await collectCandidateFiles(options.include)
  const manifestPath = path.join(options.outDir, 'manifest.json')
  const previousManifest = await readManifest(manifestPath)
  const nextManifest: Manifest = {}
  const selectorCache = new Map<string, Map<string, string>>()
  const processedSpecifiers = new Set<string>()
  const declarations: DeclarationRecord[] = []
  const warnings: string[] = []
  let writes = 0

  for (const filePath of files) {
    const matches = await findSpecifierImports(filePath)
    for (const match of matches) {
      const cleaned = match.specifier.trim()
      const inlineFree = stripInlineLoader(cleaned)
      if (!inlineFree.includes('?knighted-css')) continue
      const { resource, query } = splitResourceAndQuery(inlineFree)
      if (!query || !hasQueryFlag(query, TYPES_QUERY_FLAG)) {
        continue
      }
      if (processedSpecifiers.has(cleaned)) {
        continue
      }
      const resolvedNamespace = resolveStableNamespace(options.stableNamespace)
      const resolvedPath = await resolveImportPath(
        resource,
        match.importer,
        options.rootDir,
      )
      if (!resolvedPath) {
        warnings.push(
          `Unable to resolve ${resource} referenced by ${relativeToRoot(match.importer, options.rootDir)}.`,
        )
        continue
      }

      const cacheKey = `${resolvedPath}::${resolvedNamespace}`
      let selectorMap = selectorCache.get(cacheKey)
      if (!selectorMap) {
        try {
          const { css } = await cssWithMeta(resolvedPath, {
            cwd: options.rootDir,
            peerResolver,
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

      const variant = determineSelectorVariant(query)
      const declaration = formatModuleDeclaration(cleaned, variant, selectorMap)
      const declarationHash = hashContent(declaration)
      const fileName = buildDeclarationFileName(cleaned)
      const targetPath = path.join(options.outDir, fileName)
      const previousEntry = previousManifest[cleaned]
      const needsWrite =
        previousEntry?.hash !== declarationHash || !(await fileExists(targetPath))
      if (needsWrite) {
        await fs.writeFile(targetPath, declaration, 'utf8')
        writes += 1
      }
      nextManifest[cleaned] = { file: fileName, hash: declarationHash }
      if (needsWrite) {
        declarations.push({ specifier: cleaned, filePath: targetPath })
      }
      processedSpecifiers.add(cleaned)
    }
  }

  const removed = await removeStaleDeclarations(
    previousManifest,
    nextManifest,
    options.outDir,
  )
  await writeManifest(manifestPath, nextManifest)
  const typesIndexPath = path.join(options.typesRoot, 'index.d.ts')
  await writeTypesIndex(typesIndexPath, nextManifest, options.outDir)

  if (Object.keys(nextManifest).length === 0) {
    declarations.length = 0
  }

  return {
    written: writes,
    removed,
    declarations,
    warnings,
    outDir: options.outDir,
    typesIndexPath,
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
  if (!source.includes('?knighted-css')) {
    return []
  }
  const matches: ImportMatch[] = []
  const [imports] = parse(source, filePath)
  for (const record of imports) {
    const specifier = record.n ?? source.slice(record.s, record.e)
    if (specifier && specifier.includes('?knighted-css')) {
      matches.push({ specifier, importer: filePath })
    }
  }
  const requireRegex = /require\((['"])([^'"`]+?\?knighted-css[^'"`]*)\1\)/g
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

const projectRequireCache = new Map<string, ReturnType<typeof createRequire>>()

async function resolveImportPath(
  resourceSpecifier: string,
  importerPath: string,
  rootDir: string,
): Promise<string | undefined> {
  if (!resourceSpecifier) return undefined
  if (resourceSpecifier.startsWith('.')) {
    return path.resolve(path.dirname(importerPath), resourceSpecifier)
  }
  if (resourceSpecifier.startsWith('/')) {
    return path.resolve(rootDir, resourceSpecifier.slice(1))
  }
  const requireFromRoot = getProjectRequire(rootDir)
  try {
    return requireFromRoot.resolve(resourceSpecifier)
  } catch {
    return undefined
  }
}

function buildDeclarationFileName(specifier: string): string {
  const digest = crypto.createHash('sha1').update(specifier).digest('hex').slice(0, 12)
  return `knt-${digest}.d.ts`
}

function formatModuleDeclaration(
  specifier: string,
  variant: SelectorTypeVariant,
  selectors: Map<string, string>,
): string {
  const literalSpecifier = JSON.stringify(specifier)
  const selectorType = formatSelectorType(selectors)
  const header = `declare module ${literalSpecifier} {`
  const footer = '}'
  if (variant === 'types') {
    return `${header}
  export const knightedCss: string
  export const stableSelectors: ${selectorType}
${footer}
`
  }
  const stableLine = `  export const stableSelectors: ${selectorType}`
  const shared = `  const combined: KnightedCssCombinedModule<Record<string, unknown>>
  export const knightedCss: string
${stableLine}`
  if (variant === 'combined') {
    return `${header}
${shared}
  export default combined
${footer}
`
  }
  return `${header}
${shared}
${footer}
`
}

function formatSelectorType(selectors: Map<string, string>): string {
  if (selectors.size === 0) {
    return 'Readonly<Record<string, string>>'
  }
  const entries = Array.from(selectors.entries()).sort(([a], [b]) => a.localeCompare(b))
  const lines = entries.map(
    ([token, selector]) =>
      `    readonly ${JSON.stringify(token)}: ${JSON.stringify(selector)}`,
  )
  return `Readonly<{
${lines.join('\n')}
  }>`
}

function hashContent(content: string): string {
  return crypto.createHash('sha1').update(content).digest('hex')
}

async function readManifest(manifestPath: string): Promise<Manifest> {
  try {
    const raw = await fs.readFile(manifestPath, 'utf8')
    return JSON.parse(raw) as Manifest
  } catch {
    return {}
  }
}

async function writeManifest(manifestPath: string, manifest: Manifest): Promise<void> {
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
}

async function removeStaleDeclarations(
  previous: Manifest,
  next: Manifest,
  outDir: string,
): Promise<number> {
  const stale = Object.entries(previous).filter(([specifier]) => !next[specifier])
  let removed = 0
  for (const [, entry] of stale) {
    const targetPath = path.join(outDir, entry.file)
    try {
      await fs.unlink(targetPath)
      removed += 1
    } catch {
      // ignore
    }
  }
  return removed
}

async function writeTypesIndex(
  indexPath: string,
  manifest: Manifest,
  outDir: string,
): Promise<void> {
  const header = '// Generated by @knighted/css/generate-types\n// Do not edit.\n'
  const references = Object.values(manifest)
    .sort((a, b) => a.file.localeCompare(b.file))
    .map(entry => {
      const rel = path
        .relative(path.dirname(indexPath), path.join(outDir, entry.file))
        .split(path.sep)
        .join('/')
      return `/// <reference path="${rel}" />`
    })
  const content =
    references.length > 0
      ? `${header}
${references.join('\n')}
`
      : `${header}
`
  await fs.writeFile(indexPath, content, 'utf8')
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

async function fileExists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
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
      typesRoot: parsed.typesRoot,
      stableNamespace: parsed.stableNamespace,
    })
    reportCliResult(result)
  } catch (error) {
    console.error('[knighted-css] generate-types failed.')
    console.error(error)
    process.exitCode = 1
  }
}

interface ParsedCliArgs {
  rootDir: string
  include?: string[]
  outDir?: string
  typesRoot?: string
  stableNamespace?: string
  help?: boolean
}

function parseCliArgs(argv: string[]): ParsedCliArgs {
  let rootDir = process.cwd()
  const include: string[] = []
  let outDir: string | undefined
  let typesRoot: string | undefined
  let stableNamespace: string | undefined

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      return { rootDir, include, outDir, typesRoot, stableNamespace, help: true }
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
    if (arg === '--types-root') {
      const value = argv[++i]
      if (!value) {
        throw new Error('Missing value for --types-root')
      }
      typesRoot = value
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

  return { rootDir, include, outDir, typesRoot, stableNamespace }
}

function printHelp(): void {
  console.log(`Usage: knighted-css-generate-types [options]

Options:
  -r, --root <path>              Project root directory (default: cwd)
  -i, --include <path>           Additional directories/files to scan (repeatable)
      --out-dir <path>           Output directory for generated declarations
      --types-root <path>        Directory for generated @types entrypoint
      --stable-namespace <name>  Stable namespace prefix for generated selector maps
  -h, --help                     Show this help message
`)
}

function reportCliResult(result: GenerateTypesResult): void {
  if (result.written === 0 && result.removed === 0) {
    console.log('[knighted-css] No ?knighted-css&types imports found.')
  } else {
    console.log(
      `[knighted-css] Updated ${result.written} declaration(s), removed ${result.removed}, output in ${result.outDir}.`,
    )
  }
  console.log(`[knighted-css] Type references: ${result.typesIndexPath}`)
  for (const warning of result.warnings) {
    console.warn(`[knighted-css] ${warning}`)
  }
}
