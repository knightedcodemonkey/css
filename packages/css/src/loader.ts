import type {
  LoaderContext,
  LoaderDefinitionFunction,
  PitchLoaderDefinitionFunction,
} from 'webpack'

import { transform as lightningTransform } from 'lightningcss'

import { cssWithMeta, compileVanillaModule, type CssOptions } from './css.js'
import { detectModuleDefaultExport, type ModuleDefaultSignal } from './moduleInfo.js'
import {
  buildSanitizedQuery,
  COMBINED_QUERY_FLAG,
  getQueryParam,
  hasQueryFlag,
  NAMED_ONLY_QUERY_FLAGS,
  shouldEmitCombinedDefault,
  shouldForwardDefaultExport,
  STABLE_NAMESPACE_QUERY_PARAM,
  TYPES_QUERY_FLAG,
} from './loaderInternals.js'
import { escapeRegex, serializeSelector } from './helpers.js'

export type KnightedCssCombinedModule<TModule> = TModule & {
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
const DEFAULT_STABLE_NAMESPACE = 'knighted'

const loader: LoaderDefinitionFunction<KnightedCssLoaderOptions> = async function loader(
  source: string | Buffer,
) {
  const {
    cssOptions,
    vanillaOptions,
    stableNamespace: optionNamespace,
  } = resolveLoaderOptions(this)
  const queryNamespace = getQueryParam(this.resourceQuery, STABLE_NAMESPACE_QUERY_PARAM)
  const resolvedNamespace = resolveStableNamespace(optionNamespace, queryNamespace)
  const typesRequested = hasQueryFlag(this.resourceQuery, TYPES_QUERY_FLAG)
  const css = await extractCss(this, cssOptions)
  const stableSelectorsLiteral = typesRequested
    ? buildStableSelectorsLiteral({
        css,
        namespace: resolvedNamespace,
        resourcePath: this.resourcePath,
        emitWarning: message => emitKnightedWarning(this, message),
      })
    : undefined
  const injection = buildInjection(css, { stableSelectorsLiteral })
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
    const queryNamespace = getQueryParam(this.resourceQuery, STABLE_NAMESPACE_QUERY_PARAM)
    const resolvedNamespace = resolveStableNamespace(optionNamespace, queryNamespace)
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
            })
          : undefined
        return createCombinedModule(request, css, {
          emitDefault,
          stableSelectorsLiteral,
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

function hasCombinedQuery(query?: string | null): boolean {
  return hasQueryFlag(query, COMBINED_QUERY_FLAG)
}

function hasNamedOnlyQueryFlag(query?: string | null): boolean {
  return NAMED_ONLY_QUERY_FLAGS.some(flag => hasQueryFlag(query, flag))
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

function resolveStableNamespace(
  optionNamespace?: string,
  queryNamespace?: string,
): string {
  if (typeof queryNamespace === 'string') {
    return queryNamespace
  }
  if (typeof optionNamespace === 'string') {
    return optionNamespace
  }
  return DEFAULT_STABLE_NAMESPACE
}

function buildStableSelectorsLiteral(options: {
  css: string
  namespace: string
  resourcePath: string
  emitWarning: (message: string) => void
}): string {
  const trimmedNamespace = options.namespace.trim()
  if (!trimmedNamespace) {
    options.emitWarning(
      `stableSelectors requested for ${options.resourcePath} but "stableNamespace" resolved to an empty value.`,
    )
    return 'export const stableSelectors = {} as const;\n'
  }

  const selectorMap = collectStableSelectors(
    options.css,
    trimmedNamespace,
    options.resourcePath,
  )
  if (selectorMap.size === 0) {
    options.emitWarning(
      `stableSelectors requested for ${options.resourcePath} but no selectors matched namespace "${trimmedNamespace}".`,
    )
  }

  const literal = formatStableSelectorMap(selectorMap)
  return `export const stableSelectors = ${literal} as const;\n`
}

function collectStableSelectors(
  css: string,
  namespace: string,
  filename?: string,
): Map<string, string> {
  if (!namespace) return new Map<string, string>()
  const astResult = collectStableSelectorsFromAst(css, namespace, filename)
  if (astResult) {
    return astResult
  }
  return collectStableSelectorsByRegex(css, namespace)
}

function collectStableSelectorsFromAst(
  css: string,
  namespace: string,
  filename?: string,
): Map<string, string> | undefined {
  try {
    const tokens = new Map<string, string>()
    const escaped = escapeRegex(namespace)
    const pattern = new RegExp(`\\.${escaped}-([A-Za-z0-9_-]+)`, 'g')
    lightningTransform({
      filename: filename ?? 'knighted-types-probe.css',
      code: Buffer.from(css),
      minify: false,
      visitor: {
        Rule: {
          style(rule: any) {
            const target = Array.isArray(rule?.selectors)
              ? rule
              : rule?.value && Array.isArray(rule.value.selectors)
                ? rule.value
                : undefined
            if (!target) return rule
            for (const selector of target.selectors) {
              const selectorStr = serializeSelector(selector as any)
              pattern.lastIndex = 0
              let match: RegExpExecArray | null
              while ((match = pattern.exec(selectorStr)) !== null) {
                const token = match[1]
                if (!token) continue
                tokens.set(token, `${namespace}-${token}`)
              }
            }
            return rule
          },
        },
      },
    })
    return tokens
  } catch {
    return undefined
  }
}

function collectStableSelectorsByRegex(
  css: string,
  namespace: string,
): Map<string, string> {
  const matches = new Map<string, string>()
  const escaped = escapeRegex(namespace)
  const pattern = new RegExp(`\\.${escaped}-([A-Za-z0-9_-]+)`, 'g')
  let match: RegExpExecArray | null
  while ((match = pattern.exec(css)) !== null) {
    const token = match[1]
    if (!token) continue
    const className = `${namespace}-${token}`
    matches.set(token, className)
  }
  return matches
}

function formatStableSelectorMap(map: Map<string, string>): string {
  if (map.size === 0) {
    return '{}'
  }
  const entries = Array.from(map.entries()).sort((a, b) =>
    a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }),
  )
  const lines = entries.map(
    ([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`,
  )
  return `{\n${lines.join(',\n')}\n}`
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
