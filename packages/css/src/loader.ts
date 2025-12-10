import type {
  LoaderContext,
  LoaderDefinitionFunction,
  PitchLoaderDefinitionFunction,
} from 'webpack'

import { cssWithMeta, type CssOptions } from './css.js'

export type KnightedCssCombinedModule<TModule> = TModule & {
  knightedCss: string
}

export interface KnightedCssLoaderOptions extends CssOptions {}

const DEFAULT_EXPORT_NAME = 'knightedCss'
const COMBINED_QUERY_FLAG = 'combined'

const loader: LoaderDefinitionFunction<KnightedCssLoaderOptions> = async function loader(
  source: string | Buffer,
) {
  const cssOptions = resolveCssOptions(this)
  const css = await extractCss(this, cssOptions)
  const injection = buildInjection(css)
  const input = toSourceString(source)
  const isStyleModule = this.resourcePath.endsWith('.css.ts')
  return isStyleModule ? `${injection}export default {};\n` : `${input}${injection}`
}

export const pitch: PitchLoaderDefinitionFunction<KnightedCssLoaderOptions> =
  function pitch() {
    if (!hasCombinedQuery(this.resourceQuery)) {
      return
    }

    const request = buildProxyRequest(this)
    const cssOptions = resolveCssOptions(this)

    return extractCss(this, cssOptions).then(css => createCombinedModule(request, css))
  }
;(loader as LoaderDefinitionFunction & { pitch?: typeof pitch }).pitch = pitch

export default loader

function resolveCssOptions(ctx: LoaderContext<KnightedCssLoaderOptions>): CssOptions {
  const rawOptions = (
    typeof ctx.getOptions === 'function' ? ctx.getOptions() : {}
  ) as KnightedCssLoaderOptions
  return {
    ...rawOptions,
    cwd: rawOptions.cwd ?? ctx.rootContext ?? process.cwd(),
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

function buildProxyRequest(ctx: LoaderContext<KnightedCssLoaderOptions>): string {
  const sanitizedQuery = buildSanitizedQuery(ctx.resourceQuery)
  const request = `${ctx.resourcePath}${sanitizedQuery}`
  const context = ctx.context ?? ctx.rootContext ?? process.cwd()
  if (ctx.utils && typeof ctx.utils.contextify === 'function') {
    return ctx.utils.contextify(context, request)
  }
  return request
}

function buildSanitizedQuery(query?: string | null): string {
  if (!query) return ''
  const entries = splitQuery(query).filter(part => {
    return !isQueryFlag(part, COMBINED_QUERY_FLAG) && !isQueryFlag(part, 'knighted-css')
  })
  return entries.length > 0 ? `?${entries.join('&')}` : ''
}

function splitQuery(query: string): string[] {
  const trimmed = query.startsWith('?') ? query.slice(1) : query
  if (!trimmed) return []
  return trimmed.split('&').filter(Boolean)
}

function isQueryFlag(entry: string, flag: string): boolean {
  const [rawKey] = entry.split('=')
  try {
    return decodeURIComponent(rawKey) === flag
  } catch {
    return rawKey === flag
  }
}

function createCombinedModule(request: string, css: string): string {
  const requestLiteral = JSON.stringify(request)
  const defaultExport = `const __knightedDefault =
typeof __knightedModule.default !== 'undefined'
  ? __knightedModule.default
  : __knightedModule;`
  return [
    `import * as __knightedModule from ${requestLiteral};`,
    `export * from ${requestLiteral};`,
    defaultExport,
    'export default __knightedDefault;',
    buildInjection(css),
  ].join('\n')
}
