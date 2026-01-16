import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ProvidePlugin } from '@rspack/core'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default {
  mode: 'development',
  context: __dirname,
  entry: './src/auto-stable/index.ts',
  output: {
    path: path.resolve(__dirname, 'dist-auto-stable'),
    filename: 'auto-stable-bundle.js',
    cssFilename: 'auto-stable.css',
    library: {
      type: 'umd',
      name: 'AutoStableApp',
    },
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js', '.css'],
    extensionAlias: {
      '.js': ['.js', '.ts', '.tsx'],
    },
  },
  experiments: {
    css: true,
  },
  module: {
    rules: [
      {
        test: /\.module\.css$/,
        type: 'css/module',
      },
      {
        test: /\.[jt]sx?$/,
        resourceQuery: /knighted-css/,
        use: [
          {
            loader: '@knighted/css/loader',
            options: {
              lightningcss: { minify: true },
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
                },
              },
            },
          },
        ],
      },
    ],
  },
  plugins: [
    new ProvidePlugin({
      React: 'react',
    }),
  ],
}
