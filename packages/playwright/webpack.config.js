import path from 'node:path'
import { fileURLToPath } from 'node:url'

import webpack from 'webpack'
import { VanillaExtractPlugin } from '@vanilla-extract/webpack-plugin'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default {
  mode: 'development',
  context: __dirname,
  entry: './src/webpack-react/index.ts',
  output: {
    filename: 'webpack-bundle.js',
    path: path.resolve(__dirname, 'dist-webpack'),
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
        test: /\.css\.ts$/,
        exclude: /node_modules/,
        use: [
          VanillaExtractPlugin.loader,
          {
            loader: 'swc-loader',
            options: {
              jsc: {
                target: 'es2022',
                parser: {
                  syntax: 'typescript',
                },
              },
            },
          },
        ],
      },
      {
        test: /\.[jt]sx?$/,
        resourceQuery: /knighted-css/,
        exclude: /\.css\.ts$/,
        use: [
          {
            loader: '@knighted/css/loader',
            options: {
              lightningcss: { minify: true },
              vanilla: { transformToEsm: true },
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
        exclude: [/node_modules/, /\.css\.ts$/],
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
      {
        test: /\.css$/,
        type: 'asset/source',
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
    new VanillaExtractPlugin(),
    new webpack.ProvidePlugin({
      React: 'react',
    }),
  ],
  devtool: 'source-map',
}
