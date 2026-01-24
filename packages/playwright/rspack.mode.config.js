import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CssExtractRspackPlugin, ProvidePlugin } from '@rspack/core'
import { knightedCssResolverPlugin } from '@knighted/css/plugin'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default {
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
      debug: false,
      combinedPaths: ['src/mode/declaration-hashed'],
    }),
    new CssExtractRspackPlugin({
      filename: 'mode.css',
    }),
    new ProvidePlugin({
      React: 'react',
    }),
  ],
}
