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

export interface KnightedCssBridgeLoaderOptions {
  emitCssModules?: boolean
}

type BridgeModuleLike = {
  default?: unknown
  locals?: Record<string, string>
}

const DEFAULT_EXPORT_NAME = 'knightedCss'

const loader: LoaderDefinitionFunction<KnightedCssBridgeLoaderOptions> = function loader(
  source,
) {
  return source
}

export const pitch: PitchLoaderDefinitionFunction<KnightedCssBridgeLoaderOptions> =
  function pitch(remainingRequest) {
    if (isJsLikeResource(this.resourcePath) && hasCombinedQuery(this.resourceQuery)) {
      const callback = this.async()
      if (!callback) {
        return createCombinedJsBridgeModuleSync(this, remainingRequest)
      }
      readResourceSource(this)
        .then(source => {
          const cssRequests = collectCssModuleRequests(source).map(request =>
            buildBridgeCssRequest(request),
          )
          const upstreamRequest = buildUpstreamRequest(remainingRequest)
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
    const localsRequest = buildProxyRequest(this)
    const upstreamRequest = buildUpstreamRequest(remainingRequest)
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

    return createBridgeModule({
      localsRequest,
      upstreamRequest: upstreamRequest || localsRequest,
      combined,
      emitDefault,
      emitCssModules,
    })
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

function collectCssModuleRequests(source: string): string[] {
  const matches = new Set<string>()
  const importPattern =
    /(?:import|export)\s+(?:[^'"\n]+\s+from\s+)?['"]([^'"\n]+?\.module\.(?:css|scss|sass|less)(?:\?[^'"\n]+)?)['"]/g
  let match: RegExpExecArray | null
  while ((match = importPattern.exec(source))) {
    if (match[1]) {
      matches.add(match[1])
    }
  }
  return Array.from(matches)
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

function createCombinedJsBridgeModuleSync(
  ctx: LoaderContext<KnightedCssBridgeLoaderOptions>,
  remainingRequest?: string,
): string {
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
    return `import { knightedCss as __knightedCss${index}, knightedCssModules as __knightedCssModules${index} } from ${literal};`
  })
  const cssValues = options.cssRequests.map((_, index) => `__knightedCss${index}`)
  const cssModulesValues = options.cssRequests.map(
    (_, index) => `__knightedCssModules${index}`,
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
  const isStringMapLocal = (value: object): value is Record<string, string> => {
    const entries = Object.entries(value)
    if (entries.length === 0) return false
    return entries.every(([, entry]) => typeof entry === 'string')
  }
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue
    if (isStringMapLocal(candidate)) return candidate
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
}

function createBridgeModule(options: BridgeModuleOptions): string {
  const localsLiteral = JSON.stringify(options.localsRequest)
  const upstreamLiteral = JSON.stringify(options.upstreamRequest)
  const lines = [
    `import * as __knightedLocals from ${localsLiteral};`,
    `import * as __knightedUpstream from ${upstreamLiteral};`,
    `const __knightedDefault =\ntypeof __knightedUpstream.default !== 'undefined'\n  ? __knightedUpstream.default\n  : __knightedUpstream;`,
    `const __knightedResolveCss = ${resolveCssText.toString()};`,
    `const __knightedResolveCssModules = ${resolveCssModules.toString()};`,
    `const __knightedLocalsExport =\n  __knightedResolveCssModules(__knightedLocals, __knightedLocals) ??\n  __knightedLocals;`,
    `const __knightedCss = __knightedResolveCss(__knightedDefault, __knightedUpstream);`,
    `export const ${DEFAULT_EXPORT_NAME} = __knightedCss;`,
  ]

  if (options.emitCssModules) {
    lines.push(
      `const __knightedCssModules = __knightedLocalsExport ?? __knightedResolveCssModules(\n  __knightedDefault,\n  __knightedUpstream,\n);`,
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

function buildProxyRequest(ctx: LoaderContext<KnightedCssBridgeLoaderOptions>): string {
  const sanitizedQuery = buildSanitizedQuery(ctx.resourceQuery)
  const rawRequest = getRawRequest(ctx)
  if (rawRequest) {
    return rebuildProxyRequestFromRaw(ctx, rawRequest, sanitizedQuery)
  }
  const request = `${ctx.resourcePath}${sanitizedQuery}`
  return contextifyRequest(ctx, request)
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
  collectCssModuleRequests,
  buildBridgeCssRequest,
  createCombinedJsBridgeModule,
  isJsLikeResource,
  resolveCssModules,
  resolveCssText,
  buildProxyRequest,
  createBridgeModule,
}
