# [`@knighted/css`](https://github.com/knightedcodemonkey/css)

![CI](https://github.com/knightedcodemonkey/css/actions/workflows/ci.yml/badge.svg)
[![codecov](https://codecov.io/gh/knightedcodemonkey/css/graph/badge.svg?token=q93Qqwvq6l)](https://codecov.io/gh/knightedcodemonkey/css)
[![NPM version](https://img.shields.io/npm/v/@knighted/css.svg)](https://www.npmjs.com/package/@knighted/css)

`@knighted/css` is a build-time helper that walks a JavaScript/TypeScript module graph, finds every CSS-like dependency (plain CSS, Sass/SCSS, Less, vanilla-extract), compiles them, and returns a single concatenated stylesheet string. It is designed for workflows where you want fully materialized styles ahead of time—feeding Lit components, server-rendered routes, static site builds, or any pipeline that needs all CSS for a specific entry point without running a full bundler.

## Features

- Traverses module graphs using [`dependency-tree`](https://github.com/dependents/node-dependency-tree) to find transitive style imports.
- Compiles `*.css`, `*.scss`, `*.sass`, `*.less`, and `*.css.ts` (vanilla-extract) files out of the box.
- Optional post-processing via [`lightningcss`](https://github.com/parcel-bundler/lightningcss) for minification, prefixing, and media query optimizations.
- Pluggable resolver/filter hooks for custom module resolution (e.g., Rspack/Vite/webpack aliases) or selective inclusion.
- Peer-resolution helper for optional toolchains (`sass`, `less`, `@vanilla-extract/integration`) so consumers control their dependency graph.

## Requirements

- Node.js `>= 22.15.0`
- npm `>= 10.9.0`
- Install peer toolchains you intend to use (`sass`, `less`, `@vanilla-extract/integration`, `@vanilla-extract/recipes`, etc.).

## Installation

```bash
npm install @knighted/css
```

Install the peers your project is using, for example `less`, or `sass`, etc.

## Quick Start

```ts
// scripts/extract-styles.ts
import { css } from '@knighted/css'

const styles = await css('./src/components/app.ts', {
  cwd: process.cwd(),
  lightningcss: { minify: true },
})

console.log(styles)
```

Run it with `tsx`/`node` and you will see a fully inlined stylesheet for `app.ts` and every style import it references, regardless of depth.

## API

```ts
type CssOptions = {
  extensions?: string[] // customize file extensions to scan
  cwd?: string // working directory (defaults to process.cwd())
  filter?: (filePath: string) => boolean
  lightningcss?: boolean | LightningTransformOptions
  dependencyTree?: DependencyTreeOptions
  resolver?: (
    specifier: string,
    ctx: { cwd: string },
  ) => string | Promise<string | undefined>
  peerResolver?: (name: string) => Promise<unknown> // for custom module loading
}

async function css(entry: string, options?: CssOptions): Promise<string>
```

Typical customizations:

- **filter** – Skip certain paths (e.g., storybook-only styles) before compilation.
- **resolver** – Resolve virtual specifiers the way your bundler does (the repo ships test fixtures for webpack, Vite, and Rspack).
- **lightningcss** – Pass `true` for defaults or a config object for minification/autoprefixing.

## Examples

### Generate standalone stylesheets

```ts
import { writeFile } from 'node:fs/promises'
import { css } from '@knighted/css'

// Build-time script that gathers all CSS imported by a React route
const sheet = await css('./src/routes/marketing-page.tsx', {
  lightningcss: { minify: true, targets: { chrome: 120, safari: 17 } },
})

await writeFile('./dist/marketing-page.css', sheet)
```

### Inline CSS during SSR

```ts
import { renderToString } from 'react-dom/server'
import { css } from '@knighted/css'

export async function render(url: string) {
  const styles = await css('./src/routes/root.tsx')
  const html = renderToString(<App url={url} />)
  return `<!doctype html><style>${styles}</style>${html}`
}
```

### Bundler loader (`?knighted-css` query)

When using Webpack/Rspack, add the provided loader so importing a module with a specific query also returns the compiled stylesheet. Recommended DX: import your component as usual, and import the CSS separately via the query import.

```js
// webpack.config.js
module.exports = {
  module: {
    rules: [
      {
        test: /\.[jt]sx?$/,
        resourceQuery: /knighted-css/,
        use: [
          {
            loader: '@knighted/css/loader',
            options: {
              lightningcss: { minify: true }, // all css() options supported
            },
          },
        ],
      },
    ],
  },
}
```

```ts
// lit wrapper
import { LitElement, html, unsafeCSS } from 'lit'
import { Button } from './button.tsx'
import { knightedCss as reactStyles } from './button.tsx?knighted-css'

export class ButtonWrapper extends LitElement {
  static styles = [unsafeCSS(reactStyles)]
  render() {
    return html`<${Button} />`
  }
}

// Prefer import aliasing when you need a different local name:
// import { knightedCss as cardCss } from './button.tsx?knighted-css'
```

The loader appends `export const knightedCss = "/* compiled css */"` to the module when imported with `?knighted-css`. Keep your main module import separate to preserve its typing; use the query import only for the CSS string.

### Custom resolver (enhanced-resolve example)

If your project uses aliases or nonstandard resolution, plug in a custom resolver. Here’s how to use [`enhanced-resolve`](https://github.com/webpack/enhanced-resolve):

```ts
import { ResolverFactory } from 'enhanced-resolve'
import { css } from '@knighted/css'

const resolver = ResolverFactory.createResolver({
  extensions: ['.ts', '.tsx', '.js'],
  mainFiles: ['index'],
})

async function resolveWithEnhanced(id: string, cwd: string): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    resolver.resolve({}, cwd, id, {}, (err, result) => {
      if (err) return reject(err)
      resolve(result ?? undefined)
    })
  })
}

const styles = await css('./src/routes/page.tsx', {
  resolver: (specifier, { cwd }) => resolveWithEnhanced(specifier, cwd),
})
```

This keeps `@knighted/css` resolution in sync with your bundler’s alias/extension rules.

## Scripts

- `npm run build` – Produce CJS/ESM outputs via `@knighted/duel`.
- `npm test` – Runs the Node test suite with `tsx` and reports coverage via `c8`.
- `npm run lint` – Static analysis through `oxlint`.

## Contributing

1. Clone the repo and install dependencies with `npm install`.
2. Run `npm test` to ensure fixtures compile across Sass/Less/vanilla-extract.
3. Add/adjust fixtures in `fixtures/` when adding new language features to keep coverage high.
4. Open a PR with a description of the change and tests.

## License

MIT © Knighted Code Monkey
