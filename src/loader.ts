import type { LoaderDefinitionFunction } from 'webpack'

import { cssWithMeta, type CssOptions } from './css.js'

export interface KnightedCssLoaderOptions extends CssOptions {
  /**
   * Named export that will contain the compiled CSS string.
   * Defaults to "knightedCss".
   */
  exportName?: string
}

const DEFAULT_EXPORT_NAME = 'knightedCss'

const loader: LoaderDefinitionFunction<KnightedCssLoaderOptions> = async function loader(
  source: string | Buffer,
) {
  const rawOptions = (
    typeof this.getOptions === 'function' ? this.getOptions() : {}
  ) as KnightedCssLoaderOptions
  const queryParams =
    typeof this.resourceQuery === 'string' && this.resourceQuery.startsWith('?')
      ? new URLSearchParams(this.resourceQuery.slice(1))
      : undefined
  const queryExportName = queryParams?.get('exportName')?.trim()
  const isValidIdentifier =
    typeof queryExportName === 'string' &&
    /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(queryExportName)
  const { exportName = DEFAULT_EXPORT_NAME, ...cssOptions } = rawOptions
  const resolvedExportName = isValidIdentifier ? queryExportName : exportName
  const normalizedOptions: CssOptions = {
    ...cssOptions,
    cwd: cssOptions.cwd ?? this.rootContext ?? process.cwd(),
  }
  const { css, files } = await cssWithMeta(this.resourcePath, normalizedOptions)
  const uniqueFiles = new Set([this.resourcePath, ...files])

  for (const file of uniqueFiles) {
    this.addDependency(file)
  }

  const input = typeof source === 'string' ? source : source.toString('utf8')
  const injection = `\n\nexport const ${resolvedExportName} = ${JSON.stringify(css)};\n`
  const output = `${input}${injection}`

  return output
}

export default loader
