import type {
  LoaderContext,
  LoaderDefinitionFunction,
  PitchLoaderDefinitionFunction,
} from 'webpack'

import { cssWithMeta, compileVanillaModule, type CssOptions } from './css.js'
import { detectModuleDefaultExport, type ModuleDefaultSignal } from './moduleInfo.js'
import {
  buildSanitizedQuery,
  COMBINED_QUERY_FLAG,
  isQueryFlag,
  NAMED_ONLY_QUERY_FLAGS,
  shouldEmitCombinedDefault,
  shouldForwardDefaultExport,
  splitQuery,
} from './loaderInternals.js'

export type KnightedCssCombinedModule<TModule> = TModule & {
  knightedCss: string
}

export interface KnightedCssVanillaOptions {
  transformToEsm?: boolean
}

export interface KnightedCssLoaderOptions extends CssOptions {
  vanilla?: KnightedCssVanillaOptions
}

const DEFAULT_EXPORT_NAME = 'knightedCss'

const loader: LoaderDefinitionFunction<KnightedCssLoaderOptions> = async function loader(
  source: string | Buffer,
) {
  const { cssOptions, vanillaOptions } = resolveLoaderOptions(this)
  const css = await extractCss(this, cssOptions)
  const injection = buildInjection(css)
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
    const { cssOptions } = resolveLoaderOptions(this)
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
        return createCombinedModule(request, css, { emitDefault })
      },
    )
  }
;(loader as LoaderDefinitionFunction & { pitch?: typeof pitch }).pitch = pitch

export default loader

function resolveLoaderOptions(ctx: LoaderContext<KnightedCssLoaderOptions>): {
  cssOptions: CssOptions
  vanillaOptions?: KnightedCssVanillaOptions
} {
  const rawOptions = (
    typeof ctx.getOptions === 'function' ? ctx.getOptions() : {}
  ) as KnightedCssLoaderOptions
  const { vanilla, ...rest } = rawOptions
  const cssOptions: CssOptions = {
    ...rest,
    cwd: rest.cwd ?? ctx.rootContext ?? process.cwd(),
  }
  return {
    cssOptions,
    vanillaOptions: vanilla,
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

function buildInjection(css: string): string {
  return `\n\nexport const ${DEFAULT_EXPORT_NAME} = ${JSON.stringify(css)};\n`
}

function hasCombinedQuery(query?: string | null): boolean {
  if (!query) return false
  const trimmed = query.startsWith('?') ? query.slice(1) : query
  if (!trimmed) return false
  return trimmed
    .split('&')
    .filter(Boolean)
    .some(part => isQueryFlag(part, COMBINED_QUERY_FLAG))
}

function hasNamedOnlyQueryFlag(query?: string | null): boolean {
  if (!query) return false
  const entries = splitQuery(query)
  return entries.some(part =>
    NAMED_ONLY_QUERY_FLAGS.some(flag => isQueryFlag(part, flag)),
  )
}

function buildProxyRequest(ctx: LoaderContext<KnightedCssLoaderOptions>): string {
  const sanitizedQuery = buildSanitizedQuery(ctx.resourceQuery)
  const rawRequest = getRawRequest(ctx)
  if (rawRequest) {
    const stripped = stripResourceQuery(rawRequest)
    return `${stripped}${sanitizedQuery}`
  }
  const request = `${ctx.resourcePath}${sanitizedQuery}`
  const context = ctx.context ?? ctx.rootContext ?? process.cwd()
  if (ctx.utils && typeof ctx.utils.contextify === 'function') {
    return ctx.utils.contextify(context, request)
  }
  return request
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

interface CombinedModuleOptions {
  emitDefault?: boolean
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

  lines.push(buildInjection(css))
  return lines.join('\n')
}
