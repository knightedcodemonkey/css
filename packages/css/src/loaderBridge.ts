import path from 'node:path'

import type {
  LoaderContext,
  LoaderDefinitionFunction,
  PitchLoaderDefinitionFunction,
} from 'webpack'

import {
  buildSanitizedQuery,
  hasCombinedQuery,
  hasNamedOnlyQueryFlag,
  hasQueryFlag,
  shouldEmitCombinedDefault,
  TYPES_QUERY_FLAG,
} from './loaderInternals.js'
import { analyzeModule } from './lexer.js'
import { collectTransitiveStyleImports } from './styleGraph.js'

export interface KnightedCssBridgeLoaderOptions {
  emitCssModules?: boolean
}

type BridgeModuleLike = {
  default?: unknown
  locals?: Record<string, string>
}

const DEFAULT_EXPORT_NAME = 'knightedCss'
const BRIDGE_STYLE_EXTENSIONS = ['.css', '.scss', '.sass', '.less', '.css.ts']

const loader: LoaderDefinitionFunction<KnightedCssBridgeLoaderOptions> = function loader(
  source,
) {
  return source
}

export const pitch: PitchLoaderDefinitionFunction<KnightedCssBridgeLoaderOptions> =
  function pitch(remainingRequest) {
    const resolvedRemainingRequest = resolveRemainingRequest(this, remainingRequest)

    if (isJsLikeResource(this.resourcePath) && hasCombinedQuery(this.resourceQuery)) {
      const callback = getAsyncCallback(this)
      if (!callback) {
        return createCombinedJsBridgeModuleSync(resolvedRemainingRequest)
      }
      readResourceSource(this)
        .then(async source => {
          const cssRequests = await collectBridgeStyleRequests(this, source)
          const upstreamRequest = buildUpstreamRequest(resolvedRemainingRequest)
          callback(
            null,
            createCombinedJsBridgeModule({
              upstreamRequest: upstreamRequest || '',
              cssRequests,
              emitDefault: false,
            }),
          )
        })
        .catch(error => callback(error as Error))
      return
    }
    const callback = getAsyncCallback(this)
    if (!callback) {
      const localsRequest = buildProxyRequest(this)
      const upstreamRequest = buildUpstreamRequest(resolvedRemainingRequest)
      const { emitCssModules } = resolveLoaderOptions(this)
      const combined = hasCombinedQuery(this.resourceQuery)
      const skipSyntheticDefault = hasNamedOnlyQueryFlag(this.resourceQuery)

      if (hasQueryFlag(this.resourceQuery, TYPES_QUERY_FLAG)) {
        emitKnightedWarning(
          this,
          'The bridge loader does not generate stableSelectors. Remove the "types" query flag.',
        )
      }

      const emitDefault = combined
        ? shouldEmitCombinedDefault({
            detection: 'unknown',
            request: localsRequest,
            skipSyntheticDefault,
          })
        : false

      const resolvedUpstream = upstreamRequest || localsRequest
      const resolvedLocals = upstreamRequest || localsRequest

      return createBridgeModule({
        localsRequest: resolvedLocals,
        upstreamRequest: resolvedUpstream,
        combined,
        emitDefault,
        emitCssModules,
      })
    }

    const localsRequest = buildProxyRequest(this)
    const upstreamRequest = buildUpstreamRequest(resolvedRemainingRequest)
    const { emitCssModules } = resolveLoaderOptions(this)
    const combined = hasCombinedQuery(this.resourceQuery)
    const skipSyntheticDefault = hasNamedOnlyQueryFlag(this.resourceQuery)

    if (hasQueryFlag(this.resourceQuery, TYPES_QUERY_FLAG)) {
      emitKnightedWarning(
        this,
        'The bridge loader does not generate stableSelectors. Remove the "types" query flag.',
      )
    }

    const emitDefault = combined
      ? shouldEmitCombinedDefault({
          detection: 'unknown',
          request: localsRequest,
          skipSyntheticDefault,
        })
      : false

    const resolvedUpstream = upstreamRequest || localsRequest
    const resolvedLocals = upstreamRequest || localsRequest

    const collectSource = isJsLikeResource(this.resourcePath)
      ? readResourceSource(this)
      : Promise.resolve(undefined)

    collectSource
      .then(async source => {
        const cssRequests = await collectBridgeStyleRequests(this, source)
        const includeDefault = source
          ? await resolveDefaultExportSignal(source, this.resourcePath)
          : undefined
        callback(
          null,
          createBridgeModule({
            localsRequest: resolvedLocals,
            upstreamRequest: resolvedUpstream,
            combined,
            emitDefault,
            emitCssModules,
            cssRequests,
            includeDefault,
          }),
        )
      })
      .catch(error => callback(error as Error))
    return
  }
;(loader as LoaderDefinitionFunction & { pitch?: typeof pitch }).pitch = pitch

export default loader

function resolveLoaderOptions(
  ctx: LoaderContext<KnightedCssBridgeLoaderOptions>,
): Required<KnightedCssBridgeLoaderOptions> {
  const rawOptions = (
    typeof ctx.getOptions === 'function' ? ctx.getOptions() : {}
  ) as KnightedCssBridgeLoaderOptions
  return {
    emitCssModules: rawOptions.emitCssModules !== false,
  }
}

function getAsyncCallback(
  ctx: LoaderContext<KnightedCssBridgeLoaderOptions>,
): ((error: Error | null, result?: string) => void) | undefined {
  return typeof ctx.async === 'function' ? ctx.async() : undefined
}

function readResourceSource(
  ctx: LoaderContext<KnightedCssBridgeLoaderOptions>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    ctx.fs.readFile(ctx.resourcePath, (error, data) => {
      if (error) {
        reject(error)
        return
      }
      if (!data) {
        reject(new Error(`Unable to read ${ctx.resourcePath}`))
        return
      }
      resolve(data.toString('utf8'))
    })
  })
}

async function collectBridgeStyleRequests(
  ctx: LoaderContext<KnightedCssBridgeLoaderOptions>,
  source?: string,
): Promise<string[]> {
  const graphImports = await collectStyleGraphImports(ctx)
  const graphPaths = new Set(graphImports.map(filePath => path.resolve(filePath)))
  const graphRequests = graphImports
    .filter(filePath => path.resolve(filePath) !== path.resolve(ctx.resourcePath))
    .map(filePath => buildBridgeCssRequest(filePath))

  if (!source) {
    return dedupeRequests(graphRequests)
  }

  const directSpecifiers = collectStyleImportSpecifiers(source)
  const directRequests = directSpecifiers
    .map(specifier => {
      const [resource, query] = specifier.split('?')
      if (query) {
        return buildBridgeCssRequest(specifier)
      }
      const resolved = resolveStyleSpecifier(resource, ctx.resourcePath)
      if (resolved && graphPaths.has(resolved)) {
        return undefined
      }
      return buildBridgeCssRequest(specifier)
    })
    .filter((request): request is string => Boolean(request))

  return dedupeRequests([...graphRequests, ...directRequests])
}

async function collectStyleGraphImports(
  ctx: LoaderContext<KnightedCssBridgeLoaderOptions>,
): Promise<string[]> {
  const cwd = ctx.rootContext ?? path.dirname(ctx.resourcePath)
  const filter = (filePath: string) => !filePath.includes('node_modules')
  try {
    return await collectTransitiveStyleImports(ctx.resourcePath, {
      cwd,
      styleExtensions: BRIDGE_STYLE_EXTENSIONS,
      filter,
    })
  } catch {
    return []
  }
}

function resolveStyleSpecifier(specifier: string, importer: string): string | undefined {
  if (!specifier) return undefined
  if (specifier.startsWith('.')) {
    return path.resolve(path.dirname(importer), specifier)
  }
  if (path.isAbsolute(specifier)) {
    return path.resolve(specifier)
  }
  return undefined
}

function dedupeRequests(requests: string[]): string[] {
  const seen = new Set<string>()
  const output: string[] = []
  for (const request of requests) {
    if (seen.has(request)) continue
    seen.add(request)
    output.push(request)
  }
  return output
}

function collectStyleImportSpecifiers(source: string): string[] {
  const matches = new Set<string>()
  const importPattern =
    /(?:import|export)\s+(?:[^'"\n]+\s+from\s+)?['"]([^'"\n]+?\.(?:css|scss|sass|less|css\.ts)(?:\?[^'"\n]+)?)['"]/g
  let match: RegExpExecArray | null
  while ((match = importPattern.exec(source))) {
    if (match[1]) {
      matches.add(match[1])
    }
  }
  return Array.from(matches)
}

async function resolveDefaultExportSignal(
  source: string,
  resourcePath: string,
): Promise<boolean | undefined> {
  try {
    const analysis = await analyzeModule(source, resourcePath)
    if (analysis.defaultSignal === 'has-default') {
      return true
    }
    if (analysis.defaultSignal === 'no-default') {
      return false
    }
  } catch {
    // fall through to regex checks
  }
  const hasDefaultExport =
    /\bexport\s+default\b/.test(source) ||
    /\bexport\s*\{[^}]*\bdefault\b[^}]*\}/.test(source)
  return hasDefaultExport ? true : false
}

function buildBridgeCssRequest(specifier: string): string {
  if (specifier.includes('knighted-css')) {
    return specifier
  }
  const [resource, query] = specifier.split('?')
  if (query) {
    return `${resource}?${query}&knighted-css`
  }
  return `${specifier}?knighted-css`
}

interface CombinedJsBridgeOptions {
  upstreamRequest: string
  cssRequests: string[]
  emitDefault: boolean
}

function createCombinedJsBridgeModuleSync(remainingRequest?: string): string {
  const upstreamRequest = buildUpstreamRequest(remainingRequest)
  return createCombinedJsBridgeModule({
    upstreamRequest: upstreamRequest || '',
    cssRequests: [],
    emitDefault: false,
  })
}

function createCombinedJsBridgeModule(options: CombinedJsBridgeOptions): string {
  const upstreamLiteral = JSON.stringify(options.upstreamRequest)
  const cssImports = options.cssRequests.map((request, index) => {
    const literal = JSON.stringify(request)
    return `import * as __knightedStyle${index} from ${literal};`
  })
  const cssValues = options.cssRequests.map(
    (_, index) => `__knightedStyle${index}.knightedCss`,
  )
  const cssModulesValues = options.cssRequests.map((request, index) =>
    isCssModuleRequest(request)
      ? `__knightedStyle${index}.knightedCssModules`
      : 'undefined',
  )
  const lines = [
    `import * as __knightedUpstream from ${upstreamLiteral};`,
    ...cssImports,
    options.emitDefault
      ? "const __knightedDefault = Object.prototype.hasOwnProperty.call(__knightedUpstream, 'default') ? __knightedUpstream['default'] : undefined;"
      : '',
    `const __knightedCss = [${cssValues.join(', ')}].filter(Boolean).join('\\n');`,
    `const __knightedCssModules = Object.assign({}, ...[${cssModulesValues.join(
      ', ',
    )}].filter(Boolean));`,
    `export const ${DEFAULT_EXPORT_NAME} = __knightedCss;`,
    'export const knightedCssModules = __knightedCssModules;',
    `export * from ${upstreamLiteral};`,
  ]
  if (options.emitDefault) {
    lines.push('export default __knightedDefault;')
  }
  return lines.filter(Boolean).join('\n')
}

function isJsLikeResource(resourcePath: string): boolean {
  return /\.[cm]?[jt]sx?$/.test(resourcePath)
}

function resolveCssText(primary: unknown, module?: BridgeModuleLike): string {
  const candidates: unknown[] = [primary, module, module?.default]
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      return candidate
    }
    if (
      candidate &&
      typeof (candidate as { toString?: unknown }).toString === 'function'
    ) {
      const text = String((candidate as { toString: () => string }).toString())
      if (text && text !== '[object Object]' && text !== '[object Module]') {
        return text
      }
    }
  }
  return ''
}

function resolveCssModules(
  primary: unknown,
  module?: BridgeModuleLike,
): Record<string, string> | undefined {
  const candidates: unknown[] = [primary, module, module?.default]
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue
    if (!('locals' in candidate)) continue
    const locals = (candidate as { locals?: unknown }).locals
    if (!locals || typeof locals !== 'object') continue
    return locals as Record<string, string>
  }
  const normalizeStringMapLocal = (value: object): Record<string, string> | undefined => {
    const entries = Object.entries(value).filter(
      ([key]) => key !== 'default' && key !== '__esModule',
    )
    if (entries.length === 0) return undefined
    if (!entries.every(([, entry]) => typeof entry === 'string')) return undefined
    return Object.fromEntries(entries) as Record<string, string>
  }
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue
    const normalized = normalizeStringMapLocal(candidate)
    if (normalized) return normalized
  }
  const collectNamedExportsLocal = (
    value: unknown,
  ): Record<string, string> | undefined => {
    if (!value || typeof value !== 'object') return undefined
    const output: Record<string, string> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'default' || key === '__esModule') continue
      if (typeof entry === 'string') {
        output[key] = entry
      }
    }
    return Object.keys(output).length > 0 ? output : undefined
  }
  return collectNamedExportsLocal(module)
}

interface BridgeModuleOptions {
  localsRequest: string
  upstreamRequest: string
  combined: boolean
  emitDefault: boolean
  emitCssModules: boolean
  cssRequests?: string[]
  includeDefault?: boolean
}

function createBridgeModule(options: BridgeModuleOptions): string {
  const localsLiteral = JSON.stringify(options.localsRequest)
  const upstreamLiteral = JSON.stringify(options.upstreamRequest)
  const cssRequests = options.cssRequests ?? []
  const cssImports = cssRequests.map((request, index) => {
    const literal = JSON.stringify(request)
    return `import * as __knightedStyle${index} from ${literal};`
  })
  const cssValues = cssRequests.map((_, index) => `__knightedStyle${index}.knightedCss`)
  const cssModulesValues = cssRequests.map((request, index) =>
    isCssModuleRequest(request)
      ? `__knightedStyle${index}.knightedCssModules`
      : 'undefined',
  )
  const shouldIncludeDefault = options.includeDefault !== false
  const lines = [
    `import * as __knightedLocals from ${localsLiteral};`,
    `import * as __knightedUpstream from ${upstreamLiteral};`,
    ...cssImports,
    shouldIncludeDefault
      ? `const __knightedDefault =\n  Object.prototype.hasOwnProperty.call(__knightedUpstream, 'default')\n    ? __knightedUpstream['default']\n    : __knightedUpstream;`
      : 'const __knightedDefault = __knightedUpstream;',
    `const __knightedResolveCss = ${resolveCssText.toString()};`,
    `const __knightedResolveCssModules = ${resolveCssModules.toString()};`,
    `const __knightedUpstreamLocals =\n  __knightedResolveCssModules(__knightedUpstream, __knightedUpstream);`,
    `const __knightedLocalsExport =\n  __knightedUpstreamLocals ??\n  __knightedResolveCssModules(__knightedLocals, __knightedLocals);`,
    `const __knightedBaseCss = __knightedResolveCss(__knightedDefault, __knightedUpstream);`,
    `const __knightedCss = [__knightedBaseCss, ${cssValues.join(', ')}].filter(Boolean).join('\\n');`,
    `export const ${DEFAULT_EXPORT_NAME} = __knightedCss;`,
  ]

  if (options.emitCssModules) {
    lines.push(
      `const __knightedCssModules = Object.assign({}, ...[__knightedLocalsExport ?? __knightedResolveCssModules(\n  __knightedDefault,\n  __knightedUpstream,\n), ${cssModulesValues.join(
        ', ',
      )}].filter(Boolean));`,
      'export const knightedCssModules = __knightedCssModules;',
    )
  }

  if (options.combined) {
    lines.push(`export * from ${localsLiteral};`)
    if (options.emitDefault) {
      lines.push('export default __knightedLocalsExport;')
    }
  } else {
    lines.push('export default __knightedCss;')
  }

  return lines.join('\n')
}

function buildUpstreamRequest(remainingRequest?: string): string {
  if (!remainingRequest) {
    return ''
  }
  const request = remainingRequest.startsWith('!')
    ? remainingRequest
    : `!!${remainingRequest}`
  return request
}

function isCssModuleRequest(request: string): boolean {
  const [resource] = request.split('?')
  const lower = resource.toLowerCase()
  return /\.module\.(css|scss|sass|less|css\.ts)$/.test(lower)
}

function buildProxyRequest(ctx: LoaderContext<KnightedCssBridgeLoaderOptions>): string {
  const sanitizedQuery = buildSanitizedQuery(ctx.resourceQuery)
  const rawRequest = getRawRequest(ctx)
  if (rawRequest) {
    return rebuildProxyRequestFromRaw(ctx, rawRequest, sanitizedQuery)
  }
  const request = `${ctx.resourcePath}${sanitizedQuery}`
  return contextifyRequest(ctx, request)
}

function resolveRemainingRequest(
  ctx: LoaderContext<KnightedCssBridgeLoaderOptions>,
  remainingRequest?: string,
): string {
  const resolved = remainingRequest || ctx.remainingRequest
  if (resolved) return resolved
  const loaders = Array.isArray(ctx.loaders) ? ctx.loaders.slice(ctx.loaderIndex + 1) : []
  if (loaders.length > 0) {
    const loaderRequests = loaders
      .map(loader => {
        if (loader && typeof loader.request === 'string' && loader.request) {
          return loader.request
        }
        const path = loader && typeof loader.path === 'string' ? loader.path : ''
        const query = loader && typeof loader.query === 'string' ? loader.query : ''
        return path ? `${path}${query}` : ''
      })
      .filter(Boolean)
    if (loaderRequests.length > 0) {
      const resource = `${ctx.resourcePath}${ctx.resourceQuery ?? ''}`
      return [...loaderRequests, resource].join('!')
    }
  }
  if (typeof ctx.request === 'string' && typeof ctx.loaderIndex === 'number') {
    const parts = ctx.request.split('!').filter(Boolean)
    if (parts.length > 0) {
      const start = Math.min(ctx.loaderIndex + 1, parts.length)
      const next = parts.slice(start).join('!')
      if (next) return next
    }
  }
  return ''
}

function rebuildProxyRequestFromRaw(
  ctx: LoaderContext<KnightedCssBridgeLoaderOptions>,
  rawRequest: string,
  sanitizedQuery: string,
): string {
  const stripped = stripResourceQuery(rawRequest)
  const loaderDelimiter = stripped.lastIndexOf('!')
  const loaderPrefix = loaderDelimiter >= 0 ? stripped.slice(0, loaderDelimiter + 1) : ''
  let resource = loaderDelimiter >= 0 ? stripped.slice(loaderDelimiter + 1) : stripped
  if (isRelativeSpecifier(resource)) {
    resource = makeResourceRelativeToContext(ctx, ctx.resourcePath)
  }
  return `${loaderPrefix}${resource}${sanitizedQuery}`
}

function getRawRequest(
  ctx: LoaderContext<KnightedCssBridgeLoaderOptions>,
): string | undefined {
  const mod = (
    ctx as LoaderContext<KnightedCssBridgeLoaderOptions> & {
      _module?: { rawRequest?: string }
    }
  )._module
  const request = mod?.rawRequest
  if (typeof request === 'string' && request.length > 0) {
    return request
  }
  return undefined
}

function stripResourceQuery(request: string): string {
  const idx = request.indexOf('?')
  return idx >= 0 ? request.slice(0, idx) : request
}

function contextifyRequest(
  ctx: LoaderContext<KnightedCssBridgeLoaderOptions>,
  request: string,
): string {
  const context = ctx.context ?? ctx.rootContext ?? process.cwd()
  if (ctx.utils && typeof ctx.utils.contextify === 'function') {
    return ctx.utils.contextify(context, request)
  }
  return rebuildRelativeRequest(context, request)
}

function rebuildRelativeRequest(context: string, request: string): string {
  const queryIndex = request.indexOf('?')
  const resourcePath = queryIndex >= 0 ? request.slice(0, queryIndex) : request
  const query = queryIndex >= 0 ? request.slice(queryIndex) : ''
  const relative = ensureDotPrefixedRelative(
    path.relative(context, resourcePath),
    resourcePath,
  )
  return `${relative}${query}`
}

function makeResourceRelativeToContext(
  ctx: LoaderContext<KnightedCssBridgeLoaderOptions>,
  resourcePath: string,
): string {
  const context = ctx.context ?? path.dirname(resourcePath)
  if (ctx.utils && typeof ctx.utils.contextify === 'function') {
    const result = ctx.utils.contextify(context, resourcePath)
    return stripResourceQuery(result)
  }
  return ensureDotPrefixedRelative(path.relative(context, resourcePath), resourcePath)
}

function ensureDotPrefixedRelative(relativePath: string, resourcePath: string): string {
  const fallback = relativePath.length > 0 ? relativePath : path.basename(resourcePath)
  const normalized = normalizeToPosix(fallback)
  if (normalized.startsWith('./') || normalized.startsWith('../')) {
    return normalized
  }
  return `./${normalized}`
}

function normalizeToPosix(filePath: string): string {
  return filePath.split(path.sep).join('/')
}

function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../')
}

function emitKnightedWarning(
  ctx: LoaderContext<KnightedCssBridgeLoaderOptions>,
  message: string,
): void {
  const formatted = `\x1b[33m@knighted/css warning\x1b[0m ${message}`
  if (typeof ctx.emitWarning === 'function') {
    ctx.emitWarning(new Error(formatted))
    return
  }
  // eslint-disable-next-line no-console
  console.warn(formatted)
}

export const __loaderBridgeInternals = {
  collectStyleImportSpecifiers,
  buildBridgeCssRequest,
  createCombinedJsBridgeModule,
  isJsLikeResource,
  resolveCssModules,
  resolveCssText,
  buildProxyRequest,
  createBridgeModule,
}
