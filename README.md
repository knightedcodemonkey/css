# [`@knighted/css`](https://github.com/knightedcodemonkey/css)

![CI](https://github.com/knightedcodemonkey/css/actions/workflows/ci.yml/badge.svg)
[![codecov](https://codecov.io/gh/knightedcodemonkey/css/graph/badge.svg?token=q93Qqwvq6l)](https://codecov.io/gh/knightedcodemonkey/css)
[![NPM version](https://img.shields.io/npm/v/@knighted/css.svg)](https://www.npmjs.com/package/@knighted/css)

`@knighted/css` is a build-time helper that walks a JavaScript/TypeScript module graph, finds every CSS-like dependency (plain CSS, Sass/SCSS, Less, vanilla-extract), compiles them, and returns a single concatenated stylesheet string. It is designed to power zero-runtime styling workflows like Lit custom elements, server-side rendering, or pre-rendering pipelines where you need all CSS for a specific entry point without running a full bundler.

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
npm install @knighted/css \
  sass less \
  @vanilla-extract/css @vanilla-extract/integration @vanilla-extract/recipes
```

Only install the peers you need—if your project never touches Less, you can skip `less`, etc.

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

### Extract styles for Lit components

```ts
import { writeFile } from 'node:fs/promises'
import { css } from '@knighted/css'

const sheet = await css('./src/lit/my-widget.ts', {
  lightningcss: { minify: true, targets: { chrome: 120 } },
})

await writeFile('./dist/my-widget.css', sheet)
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
