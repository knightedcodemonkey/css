# [`@knighted/css`](../../README.md)

![CI](https://github.com/knightedcodemonkey/css/actions/workflows/ci.yml/badge.svg)
[![codecov](https://codecov.io/gh/knightedcodemonkey/css/graph/badge.svg?token=q93Qqwvq6l)](https://codecov.io/gh/knightedcodemonkey/css)
[![NPM version](https://img.shields.io/npm/v/@knighted/css.svg)](https://www.npmjs.com/package/@knighted/css)

`@knighted/css` walks your module graph, compiles every CSS-like dependency (plain CSS, Sass/SCSS, Less, vanilla-extract), and ships both the concatenated stylesheet string and optional `.knighted-css.*` imports that keep selectors typed. Use it with or without a bundler: run the `css()` API in scripts/SSR pipelines, or lean on the `?knighted-css` loader query so bundlers import compiled CSS alongside modules. Either path yields fully materialized styles for Shadow DOM surfaces, server-rendered routes, static site builds, or any entry point that should inline CSS.

## Why

I needed a single source of truth for UI components that could drop into both light DOM pages and Shadow DOM hosts, without losing encapsulated styling in the latter.

## Quick Links

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [API](#api)
- [Entry points (`import`)](#entry-points-at-a-glance)
- [Examples](#examples)
- [Demo](#demo)

## Features

- Traverses module graphs with a built-in walker to find transitive style imports (bundler optional—works standalone or through bundler loaders), including static import attributes (`with { type: "css" }`) for extensionless or aliased specifiers.
- Resolution parity via [`oxc-resolver`](https://github.com/oxc-project/oxc-resolver): tsconfig `paths`, package `exports` + `imports`, and extension aliasing (e.g., `.css.js` → `.css.ts`) are honored without wiring up a bundler.
- Compiles `*.css`, `*.scss`, `*.sass`, `*.less`, and `*.css.ts` (vanilla-extract) files out of the box.
- Optional post-processing via [`lightningcss`](https://github.com/parcel-bundler/lightningcss) for minification, prefixing, media query optimizations, or specificity boosts.
- Deterministic selector duplication via `autoStable`: duplicate matching class selectors with a stable namespace (default `knighted-`) in both plain CSS and CSS Modules exports.
- Pluggable resolver/filter hooks for custom module resolution (e.g., Rspack/Vite/webpack aliases) or selective inclusion.
- First-class loader (`@knighted/css/loader`) so bundlers can import compiled CSS alongside their modules via `?knighted-css`.
- Built-in type generation CLI (`knighted-css-generate-types`) that emits `.knighted-css.*` selector manifests so TypeScript gets literal tokens in lockstep with the loader exports.

## Requirements

- Node.js `>= 22.17.0`
- npm `>= 10.9.0`
- Install peer toolchains you intend to use (`sass`, `less`, `@vanilla-extract/integration`, etc.).

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
  autoStable?:
    | boolean
    | {
        namespace?: string
        include?: RegExp
        exclude?: RegExp
      }
  lightningcss?: boolean | LightningTransformOptions
  specificityBoost?: {
    visitor?: LightningTransformOptions<never>['visitor']
    strategy?: SpecificityStrategy
    match?: SpecificitySelector[]
  }
  moduleGraph?: ModuleGraphOptions
  resolver?: (
    specifier: string,
    ctx: { cwd: string; from?: string },
  ) => string | Promise<string | undefined>
  peerResolver?: (name: string) => Promise<unknown> // for custom module loading
}

async function css(entry: string, options?: CssOptions): Promise<string>
```

## Entry points at a glance

### Runtime loader hook (`?knighted-css`)

Import any module with the `?knighted-css` query to receive the compiled stylesheet string:

```ts
import { knightedCss } from './button.js?knighted-css'
```

See [docs/loader.md](../../docs/loader.md) for the full configuration, combined imports, and `&types` runtime selector map guidance.

### Type generation hook (`*.knighted-css*`)

Run `knighted-css-generate-types` so every specifier that ends with `.knighted-css` produces a sibling manifest containing literal selector tokens:

```ts
import stableSelectors from './button.module.scss.knighted-css.js'
```

Need bespoke resolution? Pass `--resolver` to load a module exporting a `CssResolver` and apply it during type generation.

When the `.knighted-css` import targets a JavaScript/TypeScript module, the generated proxy also re-exports the module’s exports and `knightedCss`, so a single import can provide component exports, typed selectors, and the compiled stylesheet string:

```ts
import Button, { knightedCss, stableSelectors } from './button.knighted-css.js'
```

Need hashed class names instead of stable selectors? Run the CLI with `--hashed` to emit proxy modules that export `selectors` backed by `knightedCssModules` from the loader-bridge:

```sh
knighted-css-generate-types --root . --include src --hashed
```

```ts
import Button, { knightedCss, selectors } from './button.knighted-css.js'

selectors.card // hashed CSS Modules class name
```

> [!IMPORTANT]
> `--hashed` requires wiring `@knighted/css/loader-bridge` to handle `?knighted-css` queries so
> the generated proxies can read `knightedCss` and `knightedCssModules` at build time.

Refer to [docs/type-generation.md](../../docs/type-generation.md) for CLI options and workflow tips.

### Combined + runtime selectors

Need the module exports, `knightedCss`, and a runtime `stableSelectors` map from one import? Use `?knighted-css&combined&types` (plus optional `&named-only`). Example:

```ts
import { asKnightedCssCombinedModule } from '@knighted/css/loader-helpers'
import type { KnightedCssStableSelectors as ButtonStableSelectors } from './button.css.knighted-css.js'
import * as buttonModule from './button.js?knighted-css&combined&types'

const {
  default: Button,
  knightedCss,
  stableSelectors,
} = asKnightedCssCombinedModule<
  typeof import('./button.js'),
  { stableSelectors: Readonly<Record<keyof ButtonStableSelectors, string>> }
>(buttonModule)

stableSelectors.shell
```

> [!TIP]
> If you run `knighted-css-generate-types`, prefer the double-extension proxy import shown above instead of `?knighted-css&combined` and `asKnightedCssCombinedModule`.

> [!NOTE]
> `stableSelectors` here is for runtime use; TypeScript still reads literal tokens from the generated `.knighted-css.*` modules. For a full decision matrix, see [docs/combined-queries.md](../../docs/combined-queries.md).
> Prefer importing `asKnightedCssCombinedModule` from `@knighted/css/loader-helpers` instead of grabbing it from `@knighted/css/loader`—the helper lives in a Node-free chunk so both browser and server bundles stay happy.

## Examples

- [Generate standalone stylesheets](#generate-standalone-stylesheets)
- [Inline CSS during SSR](#inline-css-during-ssr)
- [Custom resolver](#custom-resolver-enhanced-resolve-example)
- [Specificity boost](#specificity-boost)
- [Bundler loader](../../docs/loader.md#loader-example)

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

### Custom resolver (enhanced-resolve example)

The built-in walker already leans on [`oxc-resolver`](https://github.com/oxc-project/oxc-resolver), so tsconfig `paths`, package `exports` conditions, and common extension aliases work out of the box. If you still need to mirror bespoke behavior (virtual modules, framework-specific loaders, etc.), plug in a custom resolver. Here’s how to use [`enhanced-resolve`](https://github.com/webpack/enhanced-resolve):

> [!TIP]
> Hash-prefixed specifiers defined in `package.json#imports` resolve automatically—no extra loader or `css()` options required. Reach for a custom resolver only when you need behavior beyond what `oxc-resolver` already mirrors.

> [!NOTE]
> Sass-specific prefixes such as `pkg:#button` live outside Node’s resolver and still need a shim. See [docs/sass-import-aliases.md](../../docs/sass-import-aliases.md) for a drop-in helper that strips those markers before `@knighted/css` walks the graph.

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

### Specificity boost

Use `specificityBoost` to tweak selector behavior:

- **Strategies (built-in)**:
  - `repeat-class` duplicates the last class in matching selectors to raise specificity (useful when you need a real specificity bump).
  - `append-where` appends `:where(.token)` (zero specificity) for a harmless, order-based tie-breaker without changing matching.
- **Custom visitor**: Supply your own Lightning CSS visitor via `specificityBoost.visitor` for full control.
- **match filtering**: Provide `match: (string | RegExp)[]` to target selectors. Matches are OR’d; if any entry matches, the strategy applies. If omitted/empty, all selectors are eligible.

Example:

```ts
import { css } from '@knighted/css'

const styles = await css('./src/entry.ts', {
  lightningcss: { minify: true },
  specificityBoost: {
    match: ['.card', /^\.btn/], // OR match
    strategy: { type: 'repeat-class', times: 1 },
  },
})
```

If you omit `match`, the strategy applies to all selectors. Use `append-where` when you don’t want to change specificity; use `repeat-class` when you do.

> [!NOTE]
> For the built-in strategies, the last class in a matching selector is the one that gets duplicated/appended. If you have multiple similar classes, tighten your `match` (string or RegExp) to target exactly the selector you want boosted.

> [!TIP]
> See [docs/specificity-boost-visitor.md](../../docs/specificity-boost-visitor.md) for a concrete visitor example.

## Demo

Want to see everything wired together? Check the full demo app at [css-jsx-app](https://github.com/morganney/css-jsx-app).

> [!TIP]
> This repo also includes a [playwright workspace](../playwright/src/lit-react/lit-host.ts) which serves as an end-to-end demo.

## License

MIT © Knighted Code Monkey
