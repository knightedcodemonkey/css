import path from 'node:path'

import type {
  LoaderContext,
  LoaderDefinitionFunction,
  PitchLoaderDefinitionFunction,
} from 'webpack'

import {
  cssWithMeta,
  compileVanillaModule,
  type CssOptions,
  type CssResult,
} from './css.js'
import { detectModuleDefaultExport, type ModuleDefaultSignal } from './moduleInfo.js'
import { normalizeAutoStableOption } from './autoStableSelectors.js'
import {
  buildSanitizedQuery,
  hasCombinedQuery,
  hasNamedOnlyQueryFlag,
  hasQueryFlag,
  shouldEmitCombinedDefault,
  shouldForwardDefaultExport,
  STABLE_QUERY_FLAG,
  TYPES_QUERY_FLAG,
} from './loaderInternals.js'
import { buildStableSelectorsLiteral } from './stableSelectorsLiteral.js'
import { resolveStableNamespace } from './stableNamespace.js'
import { stableClass } from './stableSelectors.js'

type KnightedCssCombinedExtras = Readonly<Record<string, unknown>>

export type KnightedCssCombinedModule<
  TModule,
  TExtras extends KnightedCssCombinedExtras = Record<never, never>,
> = TModule &
  TExtras & {
    knightedCss: string
  }

type CssModuleExportValue =
  | string
  | string[]
  | {
      name?: string
      composes?: Array<{ name?: string } | string>
    }

export interface KnightedCssVanillaOptions {
  transformToEsm?: boolean
}

export interface KnightedCssLoaderOptions extends CssOptions {
  vanilla?: KnightedCssVanillaOptions
  stableNamespace?: string
}

const DEFAULT_EXPORT_NAME = 'knightedCss'

const loader: LoaderDefinitionFunction<KnightedCssLoaderOptions> = async function loader(
  source: string | Buffer,
) {
  const {
    cssOptions,
    vanillaOptions,
    stableNamespace: optionNamespace,
  } = resolveLoaderOptions(this)
  const resolvedNamespace = resolveStableNamespace(optionNamespace)
  const typesRequested =
    hasQueryFlag(this.resourceQuery, TYPES_QUERY_FLAG) ||
    hasQueryFlag(this.resourceQuery, STABLE_QUERY_FLAG)
  const isStyleModule = this.resourcePath.endsWith('.css.ts')
  const cssOptionsForExtract = isStyleModule
    ? { ...cssOptions, autoStable: undefined }
    : cssOptions
  const cssMeta = await extractCss(this, cssOptionsForExtract)
  const activeAutoStable = normalizeAutoStableOption(cssOptionsForExtract.autoStable)
  const cssModuleExports = activeAutoStable
    ? mergeCssModuleExports(cssMeta.exports, {
        namespace: activeAutoStable.namespace ?? resolvedNamespace,
        include: activeAutoStable.include,
        exclude: activeAutoStable.exclude,
      })
    : undefined
  const css = cssMeta.css
  const stableSelectorsLiteral = typesRequested
    ? buildStableSelectorsLiteral({
        css,
        namespace: resolvedNamespace,
        resourcePath: this.resourcePath,
        emitWarning: message => emitKnightedWarning(this, message),
        target: 'js',
      })
    : undefined
  const emitCssModuleDefault =
    isCssLikeResource(this.resourcePath) && Boolean(cssModuleExports)
  const injection = buildInjection(css, {
    stableSelectorsLiteral: stableSelectorsLiteral?.literal,
    cssModuleExports,
    emitCssModuleDefault,
  })
  if (isStyleModule) {
    const { source: compiledSource } = await compileVanillaModule(
      this.resourcePath,
      cssOptions.cwd ?? this.rootContext ?? process.cwd(),
      cssOptions.peerResolver,
    )
    const vanillaSource = maybeTransformVanillaModule(compiledSource, vanillaOptions)
    return `${vanillaSource}${injection}`
  }

  const input = toSourceString(source)
  return `${input}${injection}`
}

function transformVanillaModuleToEsm(source: string): string {
  const exportBlock = /__export\([^,]+,\s*{([\s\S]*?)}\);/m.exec(source)
  if (!exportBlock) {
    return source
  }

  const names = exportBlock[1]
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .map(entry => entry.split(':')[0]?.trim())
    .filter(Boolean)

  let transformed = source.replace(/module\.exports\s*=\s*__toCommonJS\([^;]+;\n?/m, '')
  transformed = transformed.replace(/0 && \(module\.exports = {[^}]+}\);?\n?/m, '')

  if (names.length > 0) {
    transformed = `${transformed}\nexport { ${names.join(', ')} };\n`
  }

  return transformed
}

function maybeTransformVanillaModule(
  source: string,
  options?: KnightedCssVanillaOptions,
): string {
  if (!options?.transformToEsm) {
    return source
  }
  return transformVanillaModuleToEsm(source)
}

export const pitch: PitchLoaderDefinitionFunction<KnightedCssLoaderOptions> =
  function pitch() {
    if (!hasCombinedQuery(this.resourceQuery)) {
      return
    }

    const request = buildProxyRequest(this)
    const { cssOptions, stableNamespace: optionNamespace } = resolveLoaderOptions(this)
    const typesRequested =
      hasQueryFlag(this.resourceQuery, TYPES_QUERY_FLAG) ||
      hasQueryFlag(this.resourceQuery, STABLE_QUERY_FLAG)
    const resolvedNamespace = resolveStableNamespace(optionNamespace)
    const skipSyntheticDefault = hasNamedOnlyQueryFlag(this.resourceQuery)
    const defaultSignalPromise = skipSyntheticDefault
      ? Promise.resolve<ModuleDefaultSignal>('unknown')
      : detectModuleDefaultExport(this.resourcePath)

    return Promise.all([extractCss(this, cssOptions), defaultSignalPromise]).then(
      ([cssMeta, defaultSignal]) => {
        const emitDefault = shouldEmitCombinedDefault({
          request,
          skipSyntheticDefault,
          detection: defaultSignal,
        })
        const activeAutoStable = normalizeAutoStableOption(cssOptions.autoStable)
        const cssModuleExports = activeAutoStable
          ? mergeCssModuleExports(cssMeta.exports, {
              namespace: activeAutoStable.namespace ?? resolvedNamespace,
              include: activeAutoStable.include,
              exclude: activeAutoStable.exclude,
            })
          : undefined
        const stableSelectorsLiteral = typesRequested
          ? buildStableSelectorsLiteral({
              css: cssMeta.css,
              namespace: resolvedNamespace,
              resourcePath: this.resourcePath,
              emitWarning: message => emitKnightedWarning(this, message),
              target: 'js',
            })
          : undefined
        return createCombinedModule(request, cssMeta.css, {
          emitDefault,
          stableSelectorsLiteral: stableSelectorsLiteral?.literal,
          cssModuleExports,
          emitCssModuleDefault: false,
        })
      },
    )
  }
;(loader as LoaderDefinitionFunction & { pitch?: typeof pitch }).pitch = pitch

export default loader

function resolveLoaderOptions(ctx: LoaderContext<KnightedCssLoaderOptions>): {
  cssOptions: CssOptions
  vanillaOptions?: KnightedCssVanillaOptions
  stableNamespace?: string
} {
  const rawOptions = (
    typeof ctx.getOptions === 'function' ? ctx.getOptions() : {}
  ) as KnightedCssLoaderOptions
  const { vanilla, stableNamespace, ...rest } = rawOptions
  const cssOptions: CssOptions = {
    ...rest,
    cwd: rest.cwd ?? ctx.rootContext ?? process.cwd(),
  }
  return {
    cssOptions,
    vanillaOptions: vanilla,
    stableNamespace,
  }
}

async function extractCss(
  ctx: LoaderContext<KnightedCssLoaderOptions>,
  options: CssOptions,
): Promise<CssResult> {
  const result = await cssWithMeta(ctx.resourcePath, options)
  const uniqueFiles = new Set([ctx.resourcePath, ...result.files])
  for (const file of uniqueFiles) {
    ctx.addDependency(file)
  }
  return result
}

function toSourceString(source: string | Buffer): string {
  return typeof source === 'string' ? source : source.toString('utf8')
}

function buildInjection(
  css: string,
  extras?: {
    stableSelectorsLiteral?: string
    cssModuleExports?: Record<string, string>
    emitCssModuleDefault?: boolean
  },
): string {
  const lines = [`\n\nexport const ${DEFAULT_EXPORT_NAME} = ${JSON.stringify(css)};\n`]
  if (extras?.stableSelectorsLiteral) {
    lines.push(extras.stableSelectorsLiteral)
  }
  if (extras?.cssModuleExports) {
    lines.push(
      `export const knightedCssModules = ${JSON.stringify(extras.cssModuleExports)};`,
    )
    if (extras.emitCssModuleDefault) {
      lines.push('export default knightedCssModules;')
    }
  }
  return lines.join('')
}

function isCssLikeResource(resourcePath: string): boolean {
  return (
    /\.(css|scss|sass|less)(\?.*)?$/i.test(resourcePath) &&
    !resourcePath.endsWith('.css.ts')
  )
}

function mergeCssModuleExports(
  exportsMap: CssResult['exports'],
  options: { namespace?: string; include?: RegExp; exclude?: RegExp },
): Record<string, string> | undefined {
  if (!exportsMap) return undefined

  const output: Record<string, string> = {}
  for (const [token, value] of Object.entries(exportsMap)) {
    const hashedParts = toClassParts(value)

    if (options.exclude && options.exclude.test(token)) {
      output[token] = hashedParts.join(' ')
      continue
    }
    if (options.include && !options.include.test(token)) {
      output[token] = hashedParts.join(' ')
      continue
    }

    const stable = stableClass(token, { namespace: options.namespace })
    if (stable && !hashedParts.includes(stable)) {
      hashedParts.push(stable)
    }
    output[token] = hashedParts.join(' ')
  }

  return output
}

function toClassParts(value: CssModuleExportValue | undefined): string[] {
  if (!value) return []
  if (Array.isArray(value)) {
    return value.flatMap(part => part.split(/\s+/).filter(Boolean))
  }
  if (typeof value === 'object') {
    const parts = [
      value.name,
      ...(value.composes ?? []).map(entry =>
        typeof entry === 'string' ? entry : entry?.name,
      ),
    ]
      .filter(Boolean)
      .map(String)
    return parts.flatMap(part => part.split(/\s+/).filter(Boolean))
  }
  return value.split(/\s+/).filter(Boolean)
}

function buildProxyRequest(ctx: LoaderContext<KnightedCssLoaderOptions>): string {
  const sanitizedQuery = buildSanitizedQuery(ctx.resourceQuery)
  const rawRequest = getRawRequest(ctx)
  if (rawRequest) {
    return rebuildProxyRequestFromRaw(ctx, rawRequest, sanitizedQuery)
  }
  const request = `${ctx.resourcePath}${sanitizedQuery}`
  return contextifyRequest(ctx, request)
}

function rebuildProxyRequestFromRaw(
  ctx: LoaderContext<KnightedCssLoaderOptions>,
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

function getRawRequest(ctx: LoaderContext<KnightedCssLoaderOptions>): string | undefined {
  const mod = (
    ctx as LoaderContext<KnightedCssLoaderOptions> & {
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
  ctx: LoaderContext<KnightedCssLoaderOptions>,
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
  ctx: LoaderContext<KnightedCssLoaderOptions>,
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

interface CombinedModuleOptions {
  emitDefault?: boolean
  stableSelectorsLiteral?: string
  cssModuleExports?: Record<string, string>
  emitCssModuleDefault?: boolean
}

function createCombinedModule(
  request: string,
  css: string,
  options?: CombinedModuleOptions,
): string {
  const shouldEmitDefault = options?.emitDefault ?? shouldForwardDefaultExport(request)
  const requestLiteral = JSON.stringify(request)
  const lines = [
    `import * as __knightedModule from ${requestLiteral};`,
    `export * from ${requestLiteral};`,
  ]

  if (shouldEmitDefault) {
    lines.push(
      `const __knightedDefault =
typeof __knightedModule.default !== 'undefined'
  ? __knightedModule.default
  : __knightedModule;`,
      'export default __knightedDefault;',
    )
  }

  lines.push(
    buildInjection(css, {
      stableSelectorsLiteral: options?.stableSelectorsLiteral,
      cssModuleExports: options?.cssModuleExports,
      emitCssModuleDefault: options?.emitCssModuleDefault,
    }),
  )
  return lines.join('\n')
}

function emitKnightedWarning(
  ctx: LoaderContext<KnightedCssLoaderOptions>,
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
