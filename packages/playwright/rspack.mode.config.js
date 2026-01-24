import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CssExtractRspackPlugin, ProvidePlugin } from '@rspack/core'
import { generateTypes } from '@knighted/css/generate-types'
import { knightedCssResolverPlugin } from '@knighted/css/plugin'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const debugResolver = process.env.KNIGHTED_CSS_DEBUG_MODE === '1'

const typesCacheDir = path.resolve(__dirname, '.knighted-css-mode')
const strictManifestPath = path.join(typesCacheDir, 'knighted-manifest.json')
const stableOutDir = path.join(typesCacheDir, 'stable')
const autoStableOutDir = path.join(typesCacheDir, 'auto-stable')
const hashedOutDir = path.join(typesCacheDir, 'hashed')
const stableIncludes = [
  path.resolve(__dirname, 'src/mode/declaration/declaration-card.tsx'),
  path.resolve(__dirname, 'src/mode/declaration-strict/strict-ok-card.tsx'),
]
const autoStableIncludes = [
  path.resolve(__dirname, 'src/mode/declaration-stable/declaration-stable-card.tsx'),
]
const hashedIncludes = [
  path.resolve(__dirname, 'src/mode/declaration-hashed/declaration-hashed-card.tsx'),
]
const stableManifestPath = path.join(stableOutDir, 'knighted-manifest.json')
const autoStableManifestPath = path.join(autoStableOutDir, 'knighted-manifest.json')
const hashedManifestPath = path.join(hashedOutDir, 'knighted-manifest.json')

async function ensureStrictSidecars() {
  await generateTypes({
    rootDir: __dirname,
    include: stableIncludes,
    outDir: stableOutDir,
    mode: 'declaration',
    manifestPath: stableManifestPath,
  })
  await generateTypes({
    rootDir: __dirname,
    include: autoStableIncludes,
    outDir: autoStableOutDir,
    mode: 'declaration',
    autoStable: true,
    manifestPath: autoStableManifestPath,
  })
  await generateTypes({
    rootDir: __dirname,
    include: hashedIncludes,
    outDir: hashedOutDir,
    mode: 'declaration',
    hashed: true,
    manifestPath: hashedManifestPath,
  })

  const stableManifest = JSON.parse(fs.readFileSync(stableManifestPath, 'utf8'))
  const autoStableManifest = JSON.parse(fs.readFileSync(autoStableManifestPath, 'utf8'))
  const hashedManifest = JSON.parse(fs.readFileSync(hashedManifestPath, 'utf8'))
  const manifest = { ...stableManifest, ...autoStableManifest, ...hashedManifest }
  const aliasEntries = {}
  for (const [key, value] of Object.entries(manifest)) {
    if (key.endsWith('.ts') || key.endsWith('.tsx')) {
      const aliasKey = `${key.slice(0, -path.extname(key).length)}.js`
      if (!manifest[aliasKey]) {
        aliasEntries[aliasKey] = value
      }
      continue
    }
    if (key.endsWith('.mts')) {
      const aliasKey = `${key.slice(0, -4)}.mjs`
      if (!manifest[aliasKey]) {
        aliasEntries[aliasKey] = value
      }
      continue
    }
    if (key.endsWith('.cts')) {
      const aliasKey = `${key.slice(0, -4)}.cjs`
      if (!manifest[aliasKey]) {
        aliasEntries[aliasKey] = value
      }
    }
  }
  Object.assign(manifest, aliasEntries)
  fs.writeFileSync(strictManifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}

export default async () => {
  await ensureStrictSidecars()
  return {
    mode: 'development',
    context: __dirname,
    entry: './src/mode/index.ts',
    output: {
      path: path.resolve(__dirname, 'dist-mode'),
      filename: 'mode-bundle.js',
      cssFilename: 'mode.css',
    },
    resolve: {
      extensions: ['.tsx', '.ts', '.js', '.css'],
      extensionAlias: {
        '.js': ['.js', '.ts', '.tsx'],
      },
    },
    experiments: {
      css: false,
    },
    module: {
      rules: [
        {
          test: /\.module\.css$/,
          include: /src\/mode\/declaration-hashed/,
          oneOf: [
            {
              resourceQuery: /knighted-css/,
              type: 'javascript/auto',
              use: [
                {
                  loader: '@knighted/css/loader-bridge',
                },
                {
                  loader: 'css-loader',
                  options: {
                    exportType: 'string',
                    modules: {
                      namedExport: true,
                    },
                  },
                },
              ],
            },
            {
              type: 'javascript/auto',
              use: [
                {
                  loader: CssExtractRspackPlugin.loader,
                },
                {
                  loader: 'css-loader',
                  options: {
                    modules: {
                      namedExport: false,
                    },
                  },
                },
              ],
            },
          ],
        },
        {
          test: /\.[jt]sx?$/,
          resourceQuery: /knighted-css/,
          include: /src\/mode\/declaration-hashed/,
          use: [
            {
              loader: '@knighted/css/loader-bridge',
            },
            {
              loader: '@knighted/jsx/loader',
              options: {
                mode: 'react',
              },
            },
            {
              loader: 'builtin:swc-loader',
              options: {
                jsc: {
                  target: 'es2022',
                  parser: {
                    syntax: 'typescript',
                    tsx: true,
                  },
                },
              },
            },
          ],
        },
        {
          test: /\.[jt]sx?$/,
          resourceQuery: /knighted-css/,
          include: /src\/mode\/declaration-stable/,
          use: [
            {
              loader: '@knighted/css/loader',
              options: {
                lightningcss: { minify: true, cssModules: true },
                autoStable: true,
              },
            },
            {
              loader: 'builtin:swc-loader',
              options: {
                jsc: {
                  target: 'es2022',
                  parser: {
                    syntax: 'typescript',
                    tsx: true,
                  },
                },
              },
            },
          ],
        },
        {
          test: /\.[jt]sx?$/,
          resourceQuery: /knighted-css/,
          exclude: /src\/mode\/(declaration-stable|declaration-hashed)/,
          use: [
            {
              loader: '@knighted/css/loader',
              options: {
                lightningcss: { minify: true },
              },
            },
            {
              loader: 'builtin:swc-loader',
              options: {
                jsc: {
                  target: 'es2022',
                  parser: {
                    syntax: 'typescript',
                    tsx: true,
                  },
                },
              },
            },
          ],
        },
        {
          test: /\.tsx?$/,
          use: [
            {
              loader: '@knighted/jsx/loader',
              options: {
                mode: 'react',
              },
            },
            {
              loader: 'builtin:swc-loader',
              options: {
                jsc: {
                  target: 'es2022',
                  parser: {
                    syntax: 'typescript',
                    tsx: true,
                  },
                },
              },
            },
          ],
        },
        {
          test: /\.module\.css$/,
          exclude: /src\/mode\/declaration-hashed/,
          use: [
            {
              loader: CssExtractRspackPlugin.loader,
            },
            {
              loader: 'css-loader',
              options: {
                modules: {
                  namedExport: false,
                },
              },
            },
          ],
        },
        {
          test: /\.css$/,
          exclude: /\.module\.css$/,
          use: [
            {
              loader: CssExtractRspackPlugin.loader,
            },
            {
              loader: 'css-loader',
              options: {
                modules: false,
              },
            },
          ],
        },
        {
          test: /\.s[ac]ss$/,
          type: 'asset/source',
        },
        {
          test: /\.less$/,
          type: 'asset/source',
        },
      ],
    },
    plugins: [
      knightedCssResolverPlugin({
        debug: debugResolver,
        combinedPaths: ['src/mode/declaration-hashed'],
        strictSidecar: true,
        manifestPath: strictManifestPath,
      }),
      new CssExtractRspackPlugin({
        filename: 'mode.css',
      }),
      new ProvidePlugin({
        React: 'react',
      }),
    ],
  }
}
