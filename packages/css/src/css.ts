import path from 'node:path'
import { existsSync, promises as fs } from 'node:fs'

import {
  composeVisitors,
  transform as lightningTransform,
  type TransformOptions as LightningTransformOptions,
} from 'lightningcss'
import {
  applyStringSpecificityBoost,
  buildSpecificityVisitor,
  escapeRegex,
  type SpecificitySelector,
  type SpecificityStrategy,
} from './helpers.js'
import {
  buildAutoStableVisitor,
  normalizeAutoStableOption,
  type AutoStableOption,
  type AutoStableVisitor,
} from './autoStableSelectors.js'
import { stableClass } from './stableSelectors.js'

import { collectStyleImports } from './moduleGraph.js'
import type { ModuleGraphOptions } from './moduleGraph.js'
import { createSassImporter } from './sassInternals.js'
import type { CssResolver } from './types.js'
export type { AutoStableOption } from './autoStableSelectors.js'

export type { CssResolver } from './types.js'
export type { ModuleGraphOptions } from './moduleGraph.js'

export const DEFAULT_EXTENSIONS = ['.css', '.scss', '.sass', '.less', '.css.ts']

type LightningCssConfig =
  | boolean
  | Partial<Omit<LightningTransformOptions<never>, 'code'>>

type PeerLoader = (name: string) => Promise<unknown>

type StrictLightningVisitor = Exclude<
  LightningTransformOptions<never>['visitor'],
  undefined
>

const isVisitor = (
  value: LightningTransformOptions<never>['visitor'] | undefined,
): value is StrictLightningVisitor => Boolean(value)

function appendStableSelectorsFromExports(
  css: string,
  exportsMap: Record<string, string | string[] | { name: string }>,
  config: AutoStableOption,
): string {
  let output = css
  for (const [token, value] of Object.entries(exportsMap)) {
    const hashed = Array.isArray(value)
      ? value.join(' ')
      : typeof value === 'object' && value !== null && 'name' in value
        ? (value as { name: string }).name
        : String(value)

    const hashedClasses = hashed.split(/\s+/).filter(Boolean)
    if (hashedClasses.length === 0) continue

    const stable = stableClass(token, {
      namespace:
        typeof config === 'object' && config?.namespace ? config.namespace : undefined,
    })

    const stableAlreadyPresent = output.includes(`.${stable}`)
    const hashedAlreadyIncludesStable = hashedClasses.includes(stable)
    if (stableAlreadyPresent || hashedAlreadyIncludesStable) continue

    for (const hashedClass of hashedClasses) {
      const rx = new RegExp(`\\.${escapeRegex(hashedClass)}(?![\\w-])`, 'g')
      output = output.replace(rx, `.${hashedClass}, .${stable}`)
    }
  }
  return output
}

export interface CssOptions {
  extensions?: string[]
  cwd?: string
  filter?: (filePath: string) => boolean
  lightningcss?: LightningCssConfig
  autoStable?: AutoStableOption
  specificityBoost?: {
    visitor?: StrictLightningVisitor
    strategy?: SpecificityStrategy
    match?: SpecificitySelector[]
  }
  moduleGraph?: ModuleGraphOptions
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
  exports?: Record<string, string | string[]>
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

  const files = await collectStyleDependencies(entryPath, {
    cwd,
    extensions,
    filter: options.filter,
    graphOptions: options.moduleGraph,
    resolver: options.resolver,
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

  const autoStableConfig = normalizeAutoStableOption(options.autoStable)
  const shouldForceLightning = Boolean(autoStableConfig)
  const shouldRunLightning = Boolean(options.lightningcss || shouldForceLightning)

  let lightningExports: Record<string, string | string[]> | undefined

  if (shouldRunLightning) {
    const lightningOptions = normalizeLightningOptions(options.lightningcss ?? {})
    const boostVisitor = buildSpecificityVisitor(options.specificityBoost)
    const shouldUseVisitor = Boolean(autoStableConfig) && !lightningOptions.cssModules
    const autoStableVisitor: AutoStableVisitor | undefined =
      shouldUseVisitor && autoStableConfig
        ? buildAutoStableVisitor(autoStableConfig)
        : undefined

    const composedVisitors = [
      boostVisitor,
      autoStableVisitor,
      lightningOptions.visitor,
    ].filter(isVisitor)

    if (composedVisitors.length === 1) {
      lightningOptions.visitor = composedVisitors[0]
    } else if (composedVisitors.length > 1) {
      lightningOptions.visitor = composeVisitors(composedVisitors)
    }

    const result = lightningTransform({
      ...lightningOptions,
      filename: lightningOptions.filename ?? 'extracted.css',
      code: Buffer.from(output),
    }) as ReturnType<typeof lightningTransform> & {
      exports?: Record<string, string | string[]>
    }

    output = result.code.toString()
    if (autoStableConfig && lightningOptions.cssModules && result.exports) {
      output = appendStableSelectorsFromExports(output, result.exports, autoStableConfig)
    }
    if (result.exports) {
      lightningExports = result.exports
    }
  }

  if (options.specificityBoost?.strategy && !options.specificityBoost.visitor) {
    output = applyStringSpecificityBoost(output, options.specificityBoost)
  }

  return {
    css: output,
    files: files.map(file => file.path),
    exports: lightningExports,
  }
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

async function collectStyleDependencies(
  entryPath: string,
  {
    cwd,
    extensions,
    filter,
    graphOptions,
    resolver,
  }: {
    cwd: string
    extensions: string[]
    filter?: (filePath: string) => boolean
    graphOptions?: ModuleGraphOptions
    resolver?: CssResolver
  },
): Promise<StyleModule[]> {
  const seen = new Set<string>()
  const order: StyleModule[] = []

  const shouldInclude =
    typeof filter === 'function'
      ? filter
      : (filePath: string) => !filePath.includes('node_modules')

  const entryIsStyle = Boolean(matchExtension(entryPath, extensions))
  let discoveredStyles: string[] = []

  if (!entryIsStyle) {
    discoveredStyles = await collectStyleImports(entryPath, {
      cwd,
      styleExtensions: extensions,
      filter: shouldInclude,
      resolver,
      graphOptions,
    })
  }

  const candidates = entryIsStyle ? [entryPath] : [entryPath, ...discoveredStyles]

  for (const candidate of candidates) {
    const match = matchExtension(candidate, extensions)
    if (!match) continue
    const resolvedCandidate = path.resolve(candidate)
    if (seen.has(resolvedCandidate)) continue
    seen.add(resolvedCandidate)
    order.push({ path: resolvedCandidate, ext: match })
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
  const sass = resolveSassNamespace(sassModule)
  const importer = createSassImporter({ cwd, resolver })
  const loadPaths = buildSassLoadPaths(filePath)

  if (typeof (sass as { compileAsync?: Function }).compileAsync === 'function') {
    const importers: unknown[] = []
    /*
     * Add custom importer first to handle project-specific imports (e.g., pkg:#).
     * Then add NodePackageImporter to handle standard pkg: URLs.
     */
    if (importer) {
      importers.push(importer)
    }
    if (
      typeof (sass as { NodePackageImporter?: unknown }).NodePackageImporter ===
      'function'
    ) {
      const NodePackageImporter = (sass as { NodePackageImporter: new () => unknown })
        .NodePackageImporter
      importers.push(new NodePackageImporter())
    }
    const result = await (
      sass as { compileAsync: typeof import('sass').compileAsync }
    ).compileAsync(filePath, {
      style: 'expanded',
      loadPaths,
      importers: importers.length > 0 ? (importers as never) : undefined,
    })
    return result.css
  }

  if (typeof (sass as { render?: Function }).render === 'function') {
    return renderLegacySass(
      sass as { render: typeof import('sass').render },
      filePath,
      indented,
      loadPaths,
    )
  }

  throw new Error(
    '@knighted/css: Installed "sass" package does not expose compileAsync or render APIs. Please update "sass" to a supported version.',
  )
}

function renderLegacySass(
  sass: { render: typeof import('sass').render },
  filePath: string,
  indented: boolean,
  loadPaths: string[],
): Promise<string> {
  return new Promise((resolve, reject) => {
    sass.render(
      {
        file: filePath,
        indentedSyntax: indented,
        outputStyle: 'expanded',
        includePaths: loadPaths,
      },
      (error, result) => {
        if (error) {
          reject(error)
          return
        }
        if (!result || typeof result.css === 'undefined') {
          resolve('')
          return
        }
        resolve(result.css.toString())
      },
    )
  })
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

function resolveSassNamespace(mod: unknown): typeof import('sass') {
  if (isSassNamespace(mod)) {
    return mod
  }
  if (
    typeof mod === 'object' &&
    mod !== null &&
    'default' in (mod as Record<string, unknown>)
  ) {
    const candidate = (mod as Record<string, unknown>).default
    if (isSassNamespace(candidate)) {
      return candidate
    }
  }
  return mod as typeof import('sass')
}

function isSassNamespace(candidate: unknown): candidate is typeof import('sass') {
  if (typeof candidate !== 'object' || !candidate) {
    return false
  }
  const namespace = candidate as Record<string, unknown>
  return typeof namespace.compile === 'function' || typeof namespace.render === 'function'
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
