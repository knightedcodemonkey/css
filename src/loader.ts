import type { LoaderDefinitionFunction } from 'webpack'

import { cssWithMeta, type CssOptions } from './css.js'

export interface KnightedCssLoaderOptions extends CssOptions {}

const DEFAULT_EXPORT_NAME = 'knightedCss'

const loader: LoaderDefinitionFunction<KnightedCssLoaderOptions> = async function loader(
  source: string | Buffer,
) {
  const rawOptions = (
    typeof this.getOptions === 'function' ? this.getOptions() : {}
  ) as KnightedCssLoaderOptions
  const cssOptions = rawOptions
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
  const injection = `\n\nexport const ${DEFAULT_EXPORT_NAME} = ${JSON.stringify(css)};\n`
  const isStyleModule = this.resourcePath.endsWith('.css.ts')
  const output = isStyleModule
    ? `${injection}export default {};\n`
    : `${input}${injection}`

  return output
}

export default loader
