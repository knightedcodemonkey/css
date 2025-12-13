import path from 'node:path'
import { existsSync, promises as fs } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

import dependencyTree from 'dependency-tree'
import type { Options as DependencyTreeOpts } from 'dependency-tree'
import {
  composeVisitors,
  transform as lightningTransform,
  type TransformOptions as LightningTransformOptions,
} from 'lightningcss'
import {
  applyStringSpecificityBoost,
  buildSpecificityVisitor,
  type SpecificitySelector,
  type SpecificityStrategy,
} from './helpers.js'

export const DEFAULT_EXTENSIONS = ['.css', '.scss', '.sass', '.less', '.css.ts']

type LightningCssConfig =
  | boolean
  | Partial<Omit<LightningTransformOptions<never>, 'code'>>

export type CssResolver = (
  specifier: string,
  ctx: { cwd: string },
) => string | Promise<string | undefined>

type PeerLoader = (name: string) => Promise<unknown>

export interface CssOptions {
  extensions?: string[]
  cwd?: string
  filter?: (filePath: string) => boolean
  lightningcss?: LightningCssConfig
  specificityBoost?: {
    visitor?: LightningTransformOptions<never>['visitor']
    strategy?: SpecificityStrategy
    match?: SpecificitySelector[]
  }
  dependencyTree?: Partial<Omit<DependencyTreeOpts, 'filename' | 'directory'>>
  resolver?: CssResolver
  peerResolver?: PeerLoader
}

interface StyleModule {
  path: string
  ext: string
}

export interface VanillaCompileResult {
  source: string
  css: string
}

/**
 * Extract and compile all CSS-like dependencies for a given module.
 */
export interface CssResult {
  css: string
  files: string[]
}

export async function css(entry: string, options: CssOptions = {}): Promise<string> {
  const { css: output } = await cssWithMeta(entry, options)
  return output
}

export async function cssWithMeta(
  entry: string,
  options: CssOptions = {},
): Promise<CssResult> {
  const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd()
  const entryPath = await resolveEntry(entry, cwd, options.resolver)
  const extensions = (options.extensions ?? DEFAULT_EXTENSIONS).map(ext =>
    ext.toLowerCase(),
  )

  const files = collectStyleDependencies(entryPath, {
    cwd,
    extensions,
    filter: options.filter,
    dependencyTreeOptions: options.dependencyTree,
  })

  if (files.length === 0) {
    return { css: '', files: [] }
  }

  const chunks: string[] = []
  for (const file of files) {
    const chunk = await compileStyleModule(file, {
      cwd,
      peerResolver: options.peerResolver,
      resolver: options.resolver,
    })
    if (chunk) {
      chunks.push(chunk)
    }
  }

  let output = chunks.join('\n')

  if (options.lightningcss) {
    const lightningOptions = normalizeLightningOptions(options.lightningcss)
    const boostVisitor = buildSpecificityVisitor(options.specificityBoost)
    const combinedVisitor =
      boostVisitor && lightningOptions.visitor
        ? composeVisitors([boostVisitor, lightningOptions.visitor])
        : (boostVisitor ?? lightningOptions.visitor)
    if (combinedVisitor) {
      lightningOptions.visitor = combinedVisitor
    }
    const { code } = lightningTransform({
      ...lightningOptions,
      filename: lightningOptions.filename ?? 'extracted.css',
      code: Buffer.from(output),
    })
    output = code.toString()
  }

  if (options.specificityBoost?.strategy && !options.specificityBoost.visitor) {
    output = applyStringSpecificityBoost(output, options.specificityBoost)
  }

  return { css: output, files: files.map(file => file.path) }
}

async function resolveEntry(
  entry: string,
  cwd: string,
  resolver?: CssResolver,
): Promise<string> {
  if (typeof resolver === 'function') {
    const resolved = await resolver(entry, { cwd })
    if (resolved) {
      return resolved
    }
  }

  if (path.isAbsolute(entry)) {
    return entry
  }

  return path.resolve(cwd, entry)
}

function collectStyleDependencies(
  entryPath: string,
  {
    cwd,
    extensions,
    filter,
    dependencyTreeOptions,
  }: {
    cwd: string
    extensions: string[]
    filter?: (filePath: string) => boolean
    dependencyTreeOptions?: Partial<Omit<DependencyTreeOpts, 'filename' | 'directory'>>
  },
): StyleModule[] {
  const seen = new Set<string>()
  const order: StyleModule[] = []

  const shouldInclude =
    typeof filter === 'function'
      ? filter
      : (filePath: string) => !filePath.includes('node_modules')

  const entryIsStyle = Boolean(matchExtension(entryPath, extensions))
  let treeList: string[] = []

  if (!entryIsStyle) {
    const dependencyConfig: DependencyTreeOpts = {
      ...dependencyTreeOptions,
      filename: entryPath,
      directory: cwd,
      filter: shouldInclude,
    }
    treeList = dependencyTree.toList(dependencyConfig)
  }

  const candidates = entryIsStyle ? [entryPath] : [entryPath, ...treeList]

  for (const candidate of candidates) {
    const match = matchExtension(candidate, extensions)
    if (!match || seen.has(candidate)) continue
    seen.add(candidate)
    order.push({ path: path.resolve(candidate), ext: match })
  }

  return order
}

function matchExtension(filePath: string, extensions: string[]): string | undefined {
  const lower = filePath.toLowerCase()
  return extensions.find(ext => lower.endsWith(ext))
}

async function compileStyleModule(
  file: StyleModule,
  {
    cwd,
    peerResolver,
    resolver,
  }: { cwd: string; peerResolver?: PeerLoader; resolver?: CssResolver },
): Promise<string> {
  switch (file.ext) {
    case '.css':
      return fs.readFile(file.path, 'utf8')
    case '.scss':
    case '.sass':
      return compileSass(file.path, file.ext === '.sass', {
        cwd,
        peerResolver,
        resolver,
      })
    case '.less':
      return compileLess(file.path, peerResolver)
    case '.css.ts':
      return (await compileVanillaModule(file.path, cwd, peerResolver)).css
    default:
      return ''
  }
}

async function compileSass(
  filePath: string,
  indented: boolean,
  {
    cwd,
    peerResolver,
    resolver,
  }: { cwd: string; peerResolver?: PeerLoader; resolver?: CssResolver },
): Promise<string> {
  const sassModule = await optionalPeer<typeof import('sass')>(
    'sass',
    'Sass',
    peerResolver,
  )
  const sass = sassModule
  const importer = createSassImporter({ cwd, resolver })
  const result = await sass.compileAsync(filePath, {
    style: 'expanded',
    loadPaths: buildSassLoadPaths(filePath),
    importers: importer ? [importer] : undefined,
  })
  return result.css
}

// Ensure Sass can resolve bare module specifiers by walking node_modules folders.
function buildSassLoadPaths(filePath: string): string[] {
  const loadPaths = new Set<string>()
  let cursor = path.dirname(filePath)
  const root = path.parse(cursor).root

  while (true) {
    loadPaths.add(cursor)
    loadPaths.add(path.join(cursor, 'node_modules'))
    if (cursor === root) break
    cursor = path.dirname(cursor)
  }

  const cwd = process.cwd()
  loadPaths.add(cwd)
  loadPaths.add(path.join(cwd, 'node_modules'))

  return Array.from(loadPaths).filter(dir => dir && existsSync(dir))
}

function createSassImporter({ cwd, resolver }: { cwd: string; resolver?: CssResolver }) {
  if (!resolver) return undefined
  const debug = process.env.KNIGHTED_CSS_DEBUG_SASS === '1'

  return {
    async canonicalize(url: string, context?: { containingUrl?: URL | null }) {
      if (debug) {
        console.error('[knighted-css:sass] canonicalize request:', url)
        if (context?.containingUrl) {
          console.error('[knighted-css:sass] containing url:', context.containingUrl.href)
        }
      }
      if (shouldNormalizeSpecifier(url)) {
        const resolvedPath = await resolveAliasSpecifier(url, resolver, cwd)
        if (!resolvedPath) {
          if (debug) {
            console.error('[knighted-css:sass] resolver returned no result for', url)
          }
          return null
        }
        const fileUrl = pathToFileURL(resolvedPath)
        if (debug) {
          console.error('[knighted-css:sass] canonical url:', fileUrl.href)
        }
        return fileUrl
      }
      const relativePath = resolveRelativeSpecifier(url, context?.containingUrl)
      if (relativePath) {
        const fileUrl = pathToFileURL(relativePath)
        if (debug) {
          console.error('[knighted-css:sass] canonical url:', fileUrl.href)
        }
        return fileUrl
      }
      return null
    },
    async load(canonicalUrl: URL) {
      if (debug) {
        console.error('[knighted-css:sass] load request:', canonicalUrl.href)
      }
      const filePath = fileURLToPath(canonicalUrl)
      const contents = await fs.readFile(filePath, 'utf8')
      return {
        contents,
        syntax: inferSassSyntax(filePath),
      }
    },
  }
}

async function resolveAliasSpecifier(
  specifier: string,
  resolver: CssResolver,
  cwd: string,
): Promise<string | undefined> {
  const resolved = await resolver(specifier, { cwd })
  if (!resolved) {
    return undefined
  }
  if (resolved.startsWith('file://')) {
    return ensureSassPath(fileURLToPath(new URL(resolved)))
  }
  const normalized = path.isAbsolute(resolved) ? resolved : path.resolve(cwd, resolved)
  return ensureSassPath(normalized)
}

function shouldNormalizeSpecifier(specifier: string): boolean {
  const schemeMatch = specifier.match(/^([a-z][\w+.-]*):/i)
  if (!schemeMatch) {
    return false
  }
  const scheme = schemeMatch[1].toLowerCase()
  if (
    scheme === 'file' ||
    scheme === 'http' ||
    scheme === 'https' ||
    scheme === 'data' ||
    scheme === 'sass'
  ) {
    return false
  }
  return true
}

function inferSassSyntax(filePath: string): 'scss' | 'indented' {
  return filePath.endsWith('.sass') ? 'indented' : 'scss'
}

function ensureSassPath(filePath: string): string | undefined {
  if (existsSync(filePath)) {
    return filePath
  }
  const ext = path.extname(filePath)
  const dir = path.dirname(filePath)
  const base = path.basename(filePath, ext)
  const partialCandidate = path.join(dir, `_${base}${ext}`)
  if (ext && existsSync(partialCandidate)) {
    return partialCandidate
  }
  const indexCandidate = path.join(dir, base, `index${ext}`)
  if (ext && existsSync(indexCandidate)) {
    return indexCandidate
  }
  const partialIndexCandidate = path.join(dir, base, `_index${ext}`)
  if (ext && existsSync(partialIndexCandidate)) {
    return partialIndexCandidate
  }
  return undefined
}

function resolveRelativeSpecifier(
  specifier: string,
  containingUrl?: URL | null,
): string | undefined {
  if (!containingUrl || containingUrl.protocol !== 'file:') {
    return undefined
  }
  if (/^[a-z][\w+.-]*:/i.test(specifier)) {
    return undefined
  }
  const containingPath = fileURLToPath(containingUrl)
  const baseDir = path.dirname(containingPath)
  const candidate = path.resolve(baseDir, specifier)
  return ensureSassPath(candidate)
}

async function compileLess(filePath: string, peerResolver?: PeerLoader): Promise<string> {
  const mod = await optionalPeer<typeof import('less')>('less', 'Less', peerResolver)
  const less = unwrapModuleNamespace(mod)
  const source = await fs.readFile(filePath, 'utf8')
  const result = await less.render(source, { filename: filePath })
  return result.css
}

export async function compileVanillaModule(
  filePath: string,
  cwd: string,
  peerResolver?: PeerLoader,
): Promise<VanillaCompileResult> {
  const mod = await optionalPeer<typeof import('@vanilla-extract/integration')>(
    '@vanilla-extract/integration',
    'Vanilla Extract',
    peerResolver,
  )
  const namespace = unwrapModuleNamespace(mod)
  const compileFn = namespace.compile
  const transformPlugin = namespace.vanillaExtractTransformPlugin
  const processVanillaFile = namespace.processVanillaFile
  const getSourceFromVirtualCssFile = namespace.getSourceFromVirtualCssFile

  if (
    !compileFn ||
    !getSourceFromVirtualCssFile ||
    !transformPlugin ||
    !processVanillaFile
  ) {
    throw new Error(
      '@knighted/css: Unable to load "@vanilla-extract/integration". Please ensure the package exports compile helpers.',
    )
  }

  const identOption = process.env.NODE_ENV === 'production' ? 'short' : 'debug'
  const { source } = await compileFn({
    filePath,
    cwd,
    identOption,
    esbuildOptions: {
      plugins: [transformPlugin({ identOption })],
    },
  })
  const processedSource = await processVanillaFile({
    source,
    filePath,
    identOption,
    outputCss: true,
  })
  const imports: string[] = []
  const importRegex = /['"](?<id>[^'"]+\.vanilla\.css\?source=[^'"]+)['"]/gimu
  let match: RegExpExecArray | null

  while ((match = importRegex.exec(processedSource)) !== null) {
    const id = match.groups?.id ?? match[1]
    if (!id) continue
    const virtualFile = await getSourceFromVirtualCssFile(id)
    if (virtualFile?.source) {
      imports.push(virtualFile.source)
    }
  }

  return {
    source,
    css: imports.join('\n'),
  }
}

const defaultPeerLoader: PeerLoader = name => import(name)

async function optionalPeer<T>(
  name: string,
  label: string,
  loader?: PeerLoader,
): Promise<T> {
  const importer = loader ?? defaultPeerLoader
  try {
    return (await importer(name)) as T
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      typeof (error as { code?: string }).code === 'string' &&
      /MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND/.test((error as { code: string }).code)
    ) {
      throw new Error(
        `@knighted/css: Attempted to process ${label}, but "${name}" is not installed. Please add it to your project.`,
      )
    }
    throw error
  }
}

function unwrapModuleNamespace<T>(mod: T): T {
  if (
    typeof mod === 'object' &&
    mod !== null &&
    'default' in (mod as Record<string, unknown>) &&
    (mod as Record<string, unknown>).default
  ) {
    return (mod as Record<string, unknown>).default as T
  }
  return mod
}

function normalizeLightningOptions(
  config: LightningCssConfig,
): Partial<Omit<LightningTransformOptions<never>, 'code'>> {
  if (!config || config === true) {
    return {}
  }
  return config
}
