import path from 'node:path'
import { fileURLToPath } from 'node:url'

import webpack from 'webpack'
import MiniCssExtractPlugin from 'mini-css-extract-plugin'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default {
  mode: 'development',
  context: __dirname,
  entry: './src/bridge/bridge-entry.ts',
  output: {
    filename: 'bridge-webpack-bundle.js',
    path: path.resolve(__dirname, 'dist-bridge-webpack'),
    clean: true,
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
    extensionAlias: {
      '.js': ['.js', '.ts', '.tsx'],
    },
  },
  module: {
    rules: [
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
              MiniCssExtractPlugin.loader,
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
            loader: 'swc-loader',
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
            loader: 'swc-loader',
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
          {
            loader: '@knighted/jsx/loader',
            options: {
              mode: 'react',
            },
          },
        ],
      },
    ],
  },
  plugins: [
    new MiniCssExtractPlugin({
      filename: 'bridge-webpack-bundle.css',
    }),
    new webpack.ProvidePlugin({
      React: 'react',
    }),
  ],
  devtool: 'source-map',
}
