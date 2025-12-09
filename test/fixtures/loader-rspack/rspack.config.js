import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default {
  mode: 'development',
  context: __dirname,
  entry: './src/index.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.js',
    library: {
      type: 'umd',
      name: 'App',
    },
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        resourceQuery: /knighted-css/,
        use: [
          {
            loader: '@knighted/css/loader',
            options: {
              exportName: 'reactStyles',
              lightningcss: { minify: true },
            },
          },
        ],
      },
      {
        test: /\.css$/,
        type: 'asset/source',
      },
    ],
  },
  resolve: {
    extensions: ['.js'],
  },
}
