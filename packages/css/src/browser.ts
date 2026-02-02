export type BrowserDialect = 'css' | 'sass' | 'less' | 'module'

export type CssFromSourceResult = {
  ok: true
  css: string
  exports?: Record<string, string | string[]>
}

export type CssFromSourceError = {
  ok: false
  error: {
    message: string
    code?: string
  }
}

export type CssFromSourceResponse = CssFromSourceResult | CssFromSourceError

export type SassLike = {
  compile?: (
    source: string,
    options?: Record<string, unknown>,
  ) => { css: string } | { css: { toString: () => string } }
  compileString?: (
    source: string,
    options?: Record<string, unknown>,
  ) => { css: string } | { css: { toString: () => string } }
  compileStringAsync?: (
    source: string,
    options?: Record<string, unknown>,
  ) => Promise<{ css: string } | { css: { toString: () => string } }>
}

export type LessLike = {
  render: (source: string, options?: Record<string, unknown>) => Promise<{ css: string }>
}

export type LightningCssWasm = {
  transform: (options: { filename?: string; code: Uint8Array; cssModules?: boolean }) => {
    code: Uint8Array
    exports?: Record<string, string | string[]>
  }
}

export type CssFromSourceOptions = {
  dialect: BrowserDialect
  filename?: string
  sass?: SassLike
  less?: LessLike
  lightningcss?: LightningCssWasm
  sassOptions?: Record<string, unknown>
  lessOptions?: Record<string, unknown>
}

const defaultFilename = 'input.css'

function resolveCssText(value: { css: unknown }): string {
  const raw = value.css
  if (typeof raw === 'string') {
    return raw
  }
  if (raw && typeof (raw as { toString?: unknown }).toString === 'function') {
    return String((raw as { toString: () => string }).toString())
  }
  return ''
}

function toErrorResult(error: unknown): CssFromSourceError {
  if (error && typeof error === 'object') {
    const message =
      'message' in error && typeof (error as { message?: unknown }).message === 'string'
        ? (error as { message: string }).message
        : 'Unknown error'
    const code =
      'code' in error && typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : undefined
    return { ok: false, error: { message, code } }
  }
  return { ok: false, error: { message: String(error) } }
}

async function cssFromSourceInternal(
  source: string,
  options: CssFromSourceOptions,
): Promise<CssFromSourceResult> {
  const filename = options.filename ?? defaultFilename

  if (options.dialect === 'css') {
    return { ok: true, css: source }
  }

  if (options.dialect === 'sass') {
    if (!options.sass) {
      throw new Error('@knighted/css: Missing Sass compiler for browser usage.')
    }
    if (typeof options.sass.compileStringAsync === 'function') {
      const result = await options.sass.compileStringAsync(source, options.sassOptions)
      return { ok: true, css: resolveCssText(result) }
    }
    if (typeof options.sass.compileString === 'function') {
      const result = options.sass.compileString(source, options.sassOptions)
      return { ok: true, css: resolveCssText(result) }
    }
    if (typeof options.sass.compile === 'function') {
      const result = options.sass.compile(source, options.sassOptions)
      return { ok: true, css: resolveCssText(result) }
    }
    throw new Error(
      '@knighted/css: Sass compiler does not expose compileStringAsync, compileString, or compile APIs.',
    )
  }

  if (options.dialect === 'less') {
    if (!options.less) {
      throw new Error('@knighted/css: Missing Less compiler for browser usage.')
    }
    const result = await options.less.render(source, options.lessOptions)
    return { ok: true, css: result.css }
  }

  if (options.dialect === 'module') {
    if (!options.lightningcss) {
      throw new Error('@knighted/css: Missing Lightning CSS WASM compiler.')
    }
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()
    const result = options.lightningcss.transform({
      filename,
      code: encoder.encode(source),
      cssModules: true,
    })
    return {
      ok: true,
      css: decoder.decode(result.code),
      exports: result.exports,
    }
  }

  return { ok: true, css: source }
}

export async function cssFromSource(
  source: string,
  options: CssFromSourceOptions,
): Promise<CssFromSourceResponse> {
  try {
    return await cssFromSourceInternal(source, options)
  } catch (error) {
    return toErrorResult(error)
  }
}
