import path from 'node:path'
import { promises as fs } from 'node:fs'

import dependencyTree from 'dependency-tree'
import type { Options as DependencyTreeOpts } from 'dependency-tree'
import {
  composeVisitors,
  transform as lightningTransform,
  type TransformOptions as LightningTransformOptions,
} from 'lightningcss'

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

type SpecificitySelector = string | RegExp

type LightningVisitor = LightningTransformOptions<Record<string, never>>['visitor']

type SpecificityStrategy =
  | { type: 'append-where'; token: string }
  | { type: 'repeat-class'; times?: number }

interface StyleModule {
  path: string
  ext: string
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
  { cwd, peerResolver }: { cwd: string; peerResolver?: PeerLoader },
): Promise<string> {
  switch (file.ext) {
    case '.css':
      return fs.readFile(file.path, 'utf8')
    case '.scss':
    case '.sass':
      return compileSass(file.path, file.ext === '.sass', peerResolver)
    case '.less':
      return compileLess(file.path, peerResolver)
    case '.css.ts':
      return compileVanillaExtract(file.path, cwd, peerResolver)
    default:
      return ''
  }
}

async function compileSass(
  filePath: string,
  indented: boolean,
  peerResolver?: PeerLoader,
): Promise<string> {
  const sassModule = await optionalPeer<typeof import('sass')>(
    'sass',
    'Sass',
    peerResolver,
  )
  const sass = sassModule
  const result = sass.compile(filePath, {
    style: 'expanded',
  })
  return result.css
}

async function compileLess(filePath: string, peerResolver?: PeerLoader): Promise<string> {
  const mod = await optionalPeer<typeof import('less')>('less', 'Less', peerResolver)
  const less = unwrapModuleNamespace(mod)
  const source = await fs.readFile(filePath, 'utf8')
  const result = await less.render(source, { filename: filePath })
  return result.css
}

async function compileVanillaExtract(
  filePath: string,
  cwd: string,
  peerResolver?: PeerLoader,
): Promise<string> {
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

  return imports.join('\n')
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

function buildSpecificityVisitor(boost?: {
  visitor?: LightningVisitor
  strategy?: SpecificityStrategy
  match?: SpecificitySelector[]
}): LightningVisitor | undefined {
  if (!boost) return undefined
  if (boost.visitor) return boost.visitor
  if (!boost.strategy) return undefined

  const matchers = (boost.match ?? []).map(m =>
    typeof m === 'string' ? new RegExp(`^${escapeRegex(m)}$`) : m,
  )
  const shouldApply = (selectorStr: string): boolean =>
    matchers.length === 0 ? true : matchers.some(rx => rx.test(selectorStr))

  if (boost.strategy.type === 'repeat-class') {
    const times = Math.max(1, boost.strategy.times ?? 1)
    const visitor: LightningVisitor = {
      Rule: {
        style(rule: any) {
          if (!rule || !Array.isArray(rule.selectors)) return rule
          const newSelectors = rule.selectors.map((sel: any) => {
            const selectorStr = serializeSelector(sel)
            if (!shouldApply(selectorStr)) return sel
            const lastClassName = findLastClassName(selectorStr)
            if (!lastClassName) return sel
            const repeats = Array.from({ length: times }, () => ({
              type: 'class',
              value: lastClassName,
            }))
            return [...sel, ...repeats]
          })
          return { ...rule, selectors: newSelectors }
        },
      },
    }
    return visitor
  }

  if (boost.strategy.type === 'append-where') {
    const token = boost.strategy.token
    const visitor: LightningTransformOptions<never>['visitor'] = {
      Rule: {
        style(rule: any) {
          if (!rule || !Array.isArray(rule.selectors)) return rule
          const newSelectors = rule.selectors.map((sel: any) => {
            const selectorStr = serializeSelector(sel)
            if (!shouldApply(selectorStr)) return sel
            return [
              ...sel,
              {
                type: 'pseudo-class',
                kind: 'where',
                selectors: [[{ type: 'class', value: token.replace(/^\./, '') }]],
              },
            ]
          })
          return { ...rule, selectors: newSelectors }
        },
      },
    }
    return visitor
  }

  return undefined
}

function serializeSelector(
  sel: Array<{ type: string; value?: string; name?: string; kind?: string }>,
): string {
  return sel
    .map(node => {
      if (node.type === 'class') return `.${node.value ?? node.name ?? ''}`
      if (node.type === 'id') return `#${node.value ?? node.name ?? ''}`
      if (node.type === 'type') return node.name ?? ''
      if (node.type === 'pseudo-class') return `:${node.kind ?? ''}`
      if (node.type === 'combinator') return ` ${node.value ?? ''} `
      return ''
    })
    .join('')
    .trim()
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function findLastClassName(selector: string): string | undefined {
  let match: RegExpExecArray | null
  let last: string | undefined
  const rx = /\.([A-Za-z0-9_-]+)/g
  while ((match = rx.exec(selector)) !== null) {
    last = match[1]
  }
  return last
}

function applyStringSpecificityBoost(
  css: string,
  boost: {
    strategy?: SpecificityStrategy
    match?: SpecificitySelector[]
  },
): string {
  if (!boost.strategy) return css
  const matchers = (boost.match ?? []).map(m =>
    typeof m === 'string' ? new RegExp(`\\.${escapeRegex(m)}(?![\\w-])`, 'g') : m,
  )
  const applyAll = matchers.length === 0

  if (boost.strategy.type === 'repeat-class') {
    const times = Math.max(1, boost.strategy.times ?? 1)
    const duplicate = (cls: string) => cls + cls.repeat(times)
    if (applyAll) {
      return css.replace(/\.[A-Za-z0-9_-]+/g, m => duplicate(m))
    }
    let result = css
    for (const rx of matchers) {
      result = result.replace(rx, m => duplicate(m))
    }
    return result
  }

  if (boost.strategy.type === 'append-where') {
    const token = boost.strategy.token.replace(/^\./, '')
    const suffix = `:where(.${token})`
    if (applyAll) {
      return css.replace(/\.[A-Za-z0-9_-]+/g, m => `${m}${suffix}`)
    }
    let result = css
    for (const rx of matchers) {
      result = result.replace(rx, m => `${m}${suffix}`)
    }
    return result
  }

  return css
}
