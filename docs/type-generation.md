# Type generation (`*.knighted-css*`)

Use the `knighted-css-generate-types` CLI to generate modules for `.knighted-css` double-extension imports. For stylesheets, it emits a sibling module with literal selector tokens. For JavaScript/TypeScript module specifiers, the generated file acts as a unified proxy that re-exports the module’s exports plus `knightedCss`.

## Running the CLI

```sh
npx knighted-css-generate-types --root . --include src
```

Typical script entry:

```json
{
  "scripts": {
    "types:css": "knighted-css-generate-types --root . --include src"
  }
}
```

Wire it into `postinstall` or your build so new selectors land automatically.

### Options

- `--root` / `-r` – project root (defaults to `process.cwd()`).
- `--include` / `-i` – additional directories or files to scan (repeatable).
- `--out-dir` – directory for the selector module manifest cache (defaults to `<root>/.knighted-css`).
- `--stable-namespace` – namespace prefix shared by the generated selector maps and loader runtime.
- `--auto-stable` – enable auto-stable selector generation during extraction (mirrors the loader’s auto-stable behavior).
- `--hashed` – emit proxy modules that export `selectors` backed by loader-bridge hashed class names (mutually exclusive with `--auto-stable`).
- `--resolver` – path or package name exporting a `CssResolver` (default export or named `resolver`).
- `--mode` – `module` (default) emits `.knighted-css.ts` proxy modules. `declaration` emits `.d.ts` module augmentations next to the referenced JS/TS modules, so you can keep standard imports like `import { knightedCss } from './button.js'` while the generator still discovers them via `.knighted-css` specifiers.
- `--manifest` – optional path to write a sidecar manifest for declaration mode (recommended when you want strict resolver behavior).

### Relationship to the loader

- `.knighted-css*` imports include the generated selector map and, for module specifiers, re-exports plus `knightedCss`.
- `?knighted-css` imports are purely runtime (see [docs/loader.md](./loader.md)). Append `&types` only when you also need the selector map at runtime; the compiler still reads the literal tokens from the generated modules.

For CSS Modules or Sass files that need stable selectors, import the generated `.knighted-css` module for types. For JS/TS component modules, the generated proxy already provides `knightedCss` alongside the exports, so you can rely on the proxy in place of separate `?knighted-css` runtime imports when appropriate.

## Minimal usage

```ts
import selectors from './button.module.scss.knighted-css.js'

selectors.card // "knighted-card"
```

## Unified proxy usage (module exports + CSS + selectors)

```ts
import Button, { knightedCss, stableSelectors } from './button.knighted-css.js'

stableSelectors.card // "knighted-card"
knightedCss // compiled CSS string
```

## Declaration mode (augment existing modules)

Declaration mode emits `.d.ts` files instead of `.knighted-css.ts` proxies, so you can import directly from the module:

```sh
knighted-css-generate-types --root . --include src --mode declaration
```

```ts
import Button, { knightedCss, stableSelectors } from './button.js'
```

> [!IMPORTANT]
> Declaration mode requires a resolver plugin to append `?knighted-css` (and `&combined` when applicable)
> at build time so runtime exports match the generated types.

### Sidecar manifests + strict resolver mode

Declaration mode emits `.d.ts` files with a `// @knighted-css` marker. If you want the resolver plugin
to only opt into those explicit sidecars (and avoid accidentally matching unrelated `.d.ts` files),
enable strict mode and pass a manifest created by the CLI:

```sh
knighted-css-generate-types --root . --include src --mode declaration \
  --manifest .knighted-css/knighted-manifest.json
```

```js
import path from 'node:path'
import { knightedCssResolverPlugin } from '@knighted/css/plugin'

export default {
  resolve: {
    plugins: [
      knightedCssResolverPlugin({
        strictSidecar: true,
        manifestPath: path.resolve('.knighted-css/knighted-manifest.json'),
      }),
    ],
  },
}
```

The manifest maps each source module to its generated `.d.ts` path. When `strictSidecar` is enabled,
the plugin only rewrites imports if the sidecar exists **and** includes the marker. That keeps
resolution deterministic even when other tooling generates `.d.ts` files alongside your modules.

## Hashed selector proxies

Use `--hashed` when you want `.knighted-css` proxy modules to export `selectors` backed by
CSS Modules hashing instead of stable selector strings. This keeps the module and selector
types while preserving hashed class names at runtime.

> [!IMPORTANT]
> `--hashed` requires the bundler to route `?knighted-css` imports through
> `@knighted/css/loader-bridge`, so the proxy can read `knightedCss` and
> `knightedCssModules` from the bridge output.

Example CLI:

```sh
knighted-css-generate-types --root . --include src --hashed
```

Example usage:

```ts
import Button, { knightedCss, selectors } from './button.knighted-css.js'

selectors.card // hashed class name from CSS Modules
knightedCss // compiled CSS string
```

Because the generated module lives next to the source stylesheet, TypeScript’s normal resolution logic applies—no custom `paths` entries required. Use the manifest in conjunction with runtime helpers such as `mergeStableClass` or `stableClassName` to keep hashed class names in sync.

## Rspack watch hook

If you want the CLI to rerun during dev, hook it into Rspack’s watch pipeline. This keeps the generated `.knighted-css` proxy modules in sync whenever source files change. You can also scope the `--include` list using `compiler.modifiedFiles` to avoid rescanning the entire project on every rebuild.

```js
// rspack.config.js
import { exec } from 'node:child_process'

export default {
  // ... your existing config
  plugins: [
    {
      apply(compiler) {
        compiler.hooks.watchRun.tapPromise('knighted-css-generate-types', () => {
          const modified = Array.from(compiler.modifiedFiles ?? [])
          const includes = modified.length > 0 ? modified : ['src']
          const includeArgs = includes.flatMap(entry => ['--include', entry])
          const command = ['knighted-css-generate-types', '--root', '.', ...includeArgs]

          return new Promise((resolve, reject) => {
            exec(command.join(' '), error => {
              if (error) {
                reject(error)
                return
              }
              resolve()
            })
          })
        })
      },
    },
  ],
}
```

Scope the `--include` paths to the folders that actually import `.knighted-css` to keep the watch step fast. When `modifiedFiles` is empty (for example on the first run), fall back to a stable include root like `src`.
