# [`@knighted/css`](https://github.com/knightedcodemonkey/css)

![CI](https://github.com/knightedcodemonkey/css/actions/workflows/ci.yml/badge.svg)
[![codecov](https://codecov.io/gh/knightedcodemonkey/css/graph/badge.svg?token=q93Qqwvq6l)](https://codecov.io/gh/knightedcodemonkey/css)
[![NPM version](https://img.shields.io/npm/v/@knighted/css.svg)](https://www.npmjs.com/package/@knighted/css)

`@knighted/css` is a build-time helper that walks a JavaScript/TypeScript module graph, finds every CSS-like dependency (plain CSS, Sass/SCSS, Less, vanilla-extract), compiles them, and returns a single concatenated stylesheet string. It is designed for workflows where you want fully materialized styles ahead of time—feeding Lit components, server-rendered routes, static site builds, or any pipeline that needs all CSS for a specific entry point without running a full bundler.

## Quick Links

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [API](#api)
- [Examples](#examples)

## Features

- Traverses module graphs using [`dependency-tree`](https://github.com/dependents/node-dependency-tree) to find transitive style imports.
- Compiles `*.css`, `*.scss`, `*.sass`, `*.less`, and `*.css.ts` (vanilla-extract) files out of the box.
- Optional post-processing via [`lightningcss`](https://github.com/parcel-bundler/lightningcss) for minification, prefixing, media query optimizations, or specificity boosts.
- Pluggable resolver/filter hooks for custom module resolution (e.g., Rspack/Vite/webpack aliases) or selective inclusion.
- First-class loader (`@knighted/css/loader`) so bundlers can import compiled CSS alongside their modules via `?knighted-css`.

## Requirements

- Node.js `>= 22.15.0`
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
  lightningcss?: boolean | LightningTransformOptions
  specificityBoost?: {
    visitor?: LightningTransformOptions<never>['visitor']
    strategy?: SpecificityStrategy
    match?: SpecificitySelector[]
  }
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
- **specificityBoost** – Provide a Lightning CSS visitor to bump specificity on selected selectors (e.g., duplicate a class for matching selectors).

## Examples

- [Generate standalone stylesheets](#generate-standalone-stylesheets)
- [Inline CSS during SSR](#inline-css-during-ssr)
- [Bundler loader](#bundler-loader-knighted-css-query)
- [Custom resolver](#custom-resolver-enhanced-resolve-example)
- [Specificity boost](#specificity-boost)

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
import { reactJsx } from '@knighted/jsx/react'
import { createRoot, type Root } from 'react-dom/client'
import { LitElement, html, unsafeCSS } from 'lit'
import { customElement } from 'lit/decorators.js'
import { Showcase } from './showcase.tsx'
import { knightedCss as showcaseCss } from './showcase.tsx?knighted-css'

@customElement('lit-host')
export class LitHost extends LitElement {
  static styles = [unsafeCSS(showcaseCss)]
  #reactRoot?: Root

  firstUpdated(): void {
    this.#mountReact()
  }

  disconnectedCallback(): void {
    this.#reactRoot?.unmount()
    super.disconnectedCallback()
  }

  #mountReact(): void {
    if (!this.#reactRoot) {
      const outlet = this.renderRoot.querySelector(
        '[data-react-root]',
      ) as HTMLDivElement | null
      if (!outlet) return
      this.#reactRoot = createRoot(outlet)
    }
    this.#reactRoot.render(reactJsx`<${Showcase} label="Launch CSS Build" />`)
  }

  render() {
    return html`<div data-react-root></div>`
  }
}
```

The loader appends `export const knightedCss = "/* compiled css */"` to the module when imported with `?knighted-css`. Keep your main module import separate to preserve its typing; use the query import only for the CSS string.

> [!TIP]
> The Playwright Rspack demo shows how a Lit host can import specific dialects with `?knighted-css` and pipe them straight into `LitElement.styles`. See [packages/playwright/src/lit-react/lit-host.ts](packages/playwright/src/lit-react/lit-host.ts) for the shadow-root wiring.

#### CSS Modules and stable selectors

CSS Modules hash class names after the loader extracts selectors, so the stylesheet captured by `?knighted-css` never sees those hashed tokens. Provide a second, stable selector (class or data attribute) alongside the module-generated one so both the DOM and the loader share a common hook. A minimal example:

```tsx
<div className={`${styles['css-modules-badge']} css-modules-badge`}>
```

Sass/Less projects can import the shared mixins directly:

```scss
@use '@knighted/css/stable' as knighted;

.button {
  @include knighted.stable('button') {
    // declarations duplicated for .button and .knighted-button
  }
}
```

Set `$knighted-stable-namespace: 'acme'` before the `@use` statement to change the default prefix, or override per call with `$namespace: 'storybook'`. Additional helpers let you emit only the fallback selector (`@include knighted.stable-only('token')`) or supply explicit `@at-root` selectors when nesting is inconvenient (`@include knighted.stable-at-root('.card', 'card')`).

For runtime usage (vanilla-extract, CSS Modules, JSX utilities), pull in the TypeScript helpers:

```ts
import { stableClassName } from '@knighted/css/stableSelectors'

function Badge() {
  return <span className={stableClassName(styles, 'badge')} />
}
```

`stableClass('token')` returns a class name you can drop straight into `className`, and `createStableClassFactory({ namespace: 'docs' })` gives you a scoped generator to reuse across components. Need the literal CSS selector? Call `stableSelector('token')`. All helpers sanitize tokens automatically so the emitted hooks stay deterministic.

Need a zero-JS approach? Import the optional layer helper and co-locate your fallback selectors:

```css
@import '@knighted/css/stable/stable.css';

@layer knighted.stable {
  .knighted-alert {
    /* declarations */
  }
}
```

Override the namespace via `:root { --knighted-stable-namespace: 'acme'; }` if you want a different prefix in pure CSS.

#### TypeScript support for loader queries

Loader query types ship directly with `@knighted/css`. Reference them once in your project—either by adding `"types": ["@knighted/css/loader-queries"]` to `tsconfig.json` or dropping `/// <reference types="@knighted/css/loader-queries" />` into a global `.d.ts`—and the following ambient modules become available everywhere:

- `*?knighted-css` imports expose a `knightedCss: string` export.
- `*?knighted-css&combined` (and any query that includes both flags) expose `knightedCss` and return the original module exports, which you can narrow with `KnightedCssCombinedModule` before destructuring named members.

No vendor copies are necessary—the declarations live inside `@knighted/css`, you just need to point your TypeScript config at the shipped `loader-queries` subpath once.

#### Combined module + CSS import

If you prefer a single import that returns both your module exports and the compiled stylesheet, append `&combined` to the query:

```ts
import { Button, knightedCss } from './button.tsx?knighted-css&combined'
```

This keeps your bundler’s other CSS loaders intact while guaranteeing that `knightedCss` is only computed once. The trade-off is that TypeScript can’t infer the original module shape automatically. To restore those typings, use the helper type exported by the loader:

```ts
import type { KnightedCssCombinedModule } from '@knighted/css/loader'
import combined from './button.tsx?knighted-css&combined'

const { Button, knightedCss } = combined as KnightedCssCombinedModule<
  typeof import('./button')
>
```

You can mix and match: regular `?knighted-css` imports keep strong module typings and just add the CSS string, while `?knighted-css&combined` dedupes your CSS loader pipeline when you need everything at once.

#### vanilla-extract loader guidance

vanilla-extract files (`*.css.ts`) compile down to CommonJS by default. That works out of the box for the loader—both `?knighted-css` and `?knighted-css&combined` queries emit `module.exports` artifacts plus the injected `knightedCss` string. Most bundlers happily consume that shape. When you _also_ need the compiled module to behave like a native ESM module (e.g., your bundler expects `export` statements so it can treeshake or when you import via extension aliases), enable the loader’s opt-in transform:

```js
// rspack.config.js (excerpt)
{
  test: /\.css\.ts$/,
  use: [
    {
      loader: '@knighted/css/loader',
      options: {
        lightningcss: { minify: true },
        vanilla: { transformToEsm: true },
      },
    },
    // swc/esbuild/etc.
  ],
}
```

The `vanilla.transformToEsm` flag runs a small post-pass that strips the CJS boilerplate emitted by `@vanilla-extract/integration` and re-exports the discovered bindings via native `export { name }` statements. That makes combined imports behave exactly like the source module, which is useful for frameworks that rely on strict ESM semantics (our Lit + React Playwright app is the canonical example in this repo).

> [!IMPORTANT]
> Only enable `vanilla.transformToEsm` when your bundler really requires ESM output. Leaving the transform off keeps the vanilla-extract module identical to what the upstream compiler produced, which is often preferable if the rest of your toolchain expects CommonJS. The loader no longer toggles this transform automatically—combined imports stay fast, but you remain in full control of when the conversion occurs.

If your build pipeline can gracefully consume both module syntaxes (for example, webpack or Rspack projects that treat the vanilla-extract integration bundle as CommonJS), you may get the desired behavior simply by forcing those files through the “auto” parser instead of rewriting them:

```js
{
  test: /@vanilla-extract\/integration/,
  type: 'javascript/auto',
}
```

That hint keeps the upstream CommonJS helpers intact while still letting the rest of your app compile as native ESM. It’s worth trying first if you’d rather avoid the transform and your bundler already mixes module systems without issue. Flip `vanilla.transformToEsm` back on whenever you hit a toolchain that insists on pure ESM output.

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
> See [docs/specificity-boost-visitor.md](./docs/specificity-boost-visitor.md) for a concrete visitor example.

## License

MIT © Knighted Code Monkey
