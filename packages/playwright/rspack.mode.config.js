import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CssExtractRspackPlugin, ProvidePlugin } from '@rspack/core'
import { knightedCssResolverPlugin } from '@knighted/css/plugin'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const debugResolver = process.env.KNIGHTED_CSS_DEBUG_MODE === '1'

const typesCacheDir = path.resolve(__dirname, '.knighted-css-mode')
const strictManifestPath = path.join(typesCacheDir, 'knighted-manifest.json')
const combinedHashedPath = path.join('src', 'mode', 'declaration-hashed')
const declarationHashedDir = /src[\\/]mode[\\/]declaration-hashed/
const declarationStableDir = /src[\\/]mode[\\/]declaration-stable/

export default async () => ({
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
        test: /\.css\.ts$/,
        type: 'javascript/auto',
        use: [
          {
            loader: '@knighted/css/loader',
            options: {
              vanilla: { transformToEsm: true },
            },
          },
        ],
      },
      {
        test: /\.module\.css$/,
        include: declarationHashedDir,
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
        include: declarationHashedDir,
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
        include: declarationStableDir,
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
        exclude: /src[\\/]mode[\\/](declaration-stable|declaration-hashed)/,
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
        exclude: declarationHashedDir,
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
      combinedPaths: [combinedHashedPath],
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
})
