import path from 'node:path'

import type {
  LoaderContext,
  LoaderDefinitionFunction,
  PitchLoaderDefinitionFunction,
} from 'webpack'

import { cssWithMeta, compileVanillaModule, type CssOptions } from './css.js'
import { detectModuleDefaultExport, type ModuleDefaultSignal } from './moduleInfo.js'
import {
  buildSanitizedQuery,
  hasCombinedQuery,
  hasNamedOnlyQueryFlag,
  hasQueryFlag,
  shouldEmitCombinedDefault,
  shouldForwardDefaultExport,
  TYPES_QUERY_FLAG,
} from './loaderInternals.js'
import { buildStableSelectorsLiteral } from './stableSelectorsLiteral.js'
import { resolveStableNamespace } from './stableNamespace.js'

type KnightedCssCombinedExtras = Readonly<Record<string, unknown>>

export type KnightedCssCombinedModule<
  TModule,
  TExtras extends KnightedCssCombinedExtras = Record<never, never>,
> = TModule &
  TExtras & {
    knightedCss: string
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
  const typesRequested = hasQueryFlag(this.resourceQuery, TYPES_QUERY_FLAG)
  const css = await extractCss(this, cssOptions)
  const stableSelectorsLiteral = typesRequested
    ? buildStableSelectorsLiteral({
        css,
        namespace: resolvedNamespace,
        resourcePath: this.resourcePath,
        emitWarning: message => emitKnightedWarning(this, message),
        target: 'js',
      })
    : undefined
  const injection = buildInjection(css, {
    stableSelectorsLiteral: stableSelectorsLiteral?.literal,
  })
  const isStyleModule = this.resourcePath.endsWith('.css.ts')
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
    const typesRequested = hasQueryFlag(this.resourceQuery, TYPES_QUERY_FLAG)
    const resolvedNamespace = resolveStableNamespace(optionNamespace)
    const skipSyntheticDefault = hasNamedOnlyQueryFlag(this.resourceQuery)
    const defaultSignalPromise = skipSyntheticDefault
      ? Promise.resolve<ModuleDefaultSignal>('unknown')
      : detectModuleDefaultExport(this.resourcePath)

    return Promise.all([extractCss(this, cssOptions), defaultSignalPromise]).then(
      ([css, defaultSignal]) => {
        const emitDefault = shouldEmitCombinedDefault({
          request,
          skipSyntheticDefault,
          detection: defaultSignal,
        })
        const stableSelectorsLiteral = typesRequested
          ? buildStableSelectorsLiteral({
              css,
              namespace: resolvedNamespace,
              resourcePath: this.resourcePath,
              emitWarning: message => emitKnightedWarning(this, message),
              target: 'js',
            })
          : undefined
        return createCombinedModule(request, css, {
          emitDefault,
          stableSelectorsLiteral: stableSelectorsLiteral?.literal,
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
): Promise<string> {
  const { css, files } = await cssWithMeta(ctx.resourcePath, options)
  const uniqueFiles = new Set([ctx.resourcePath, ...files])
  for (const file of uniqueFiles) {
    ctx.addDependency(file)
  }
  return css
}

function toSourceString(source: string | Buffer): string {
  return typeof source === 'string' ? source : source.toString('utf8')
}

function buildInjection(
  css: string,
  extras?: { stableSelectorsLiteral?: string },
): string {
  const lines = [`\n\nexport const ${DEFAULT_EXPORT_NAME} = ${JSON.stringify(css)};\n`]
  if (extras?.stableSelectorsLiteral) {
    lines.push(extras.stableSelectorsLiteral)
  }
  return lines.join('')
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
    buildInjection(css, { stableSelectorsLiteral: options?.stableSelectorsLiteral }),
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
