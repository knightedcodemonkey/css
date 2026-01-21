import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CssExtractRspackPlugin, ProvidePlugin } from '@rspack/core'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default {
  mode: 'development',
  context: __dirname,
  entry: './src/bridge/bridge-entry.ts',
  output: {
    path: path.resolve(__dirname, 'dist-bridge'),
    filename: 'bridge-bundle.js',
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js', '.css'],
    extensionAlias: {
      '.js': ['.js', '.ts', '.tsx'],
    },
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        exclude: /\.module\.css$/,
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
                  modules: false,
                },
              },
            ],
          },
          {
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
        ],
      },
      {
        test: /\.module\.css$/,
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
        exclude: /\.css\.ts$/,
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
        test: /\.tsx?$/,
        exclude: /node_modules/,
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
    ],
  },
  plugins: [
    new CssExtractRspackPlugin({
      filename: 'bridge-bundle.css',
    }),
    new ProvidePlugin({
      React: 'react',
    }),
  ],
}
