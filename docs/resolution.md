# Resolution modes

`@knighted/css` resolves specifiers the same way modern JavaScript tooling does, so the CSS pipeline can follow whatever graph your app already uses. This page summarizes the built-in behavior, plus the hooks you can reach for when you need to mirror bundler-specific rules.

## Node-compatible graph walking

The module graph walker is powered by [`oxc-resolver`](https://github.com/oxc-project/oxc-resolver), so it understands:

- **Node.js exports/imports maps**: `package.json` `exports` / `imports`, including hash-prefixed entries like `#ui/button`.
- **`tsconfig` aliases**: `baseUrl` + `paths` whether you pass a path to a config file or inline the object via `moduleGraph.tsConfig`.
- **Extension + condition matching**: The same extension priorities and `conditionNames` your runtime/bundler would apply, configurable through `moduleGraph.extensions` and `moduleGraph.conditions`.

The CLI (`css()` API) and the loader both go through this resolver, so once a specifier works in one environment it will work everywhere.

## Sass-specific specifiers

Sass still honors its own loader prefixes (`pkg:`, `sass:`, workspace shorthands, etc.) that never pass through Node’s resolver. When those show up, provide a custom resolver that rewrites them into absolute paths before Sass runs. See [docs/sass-import-aliases.md](./sass-import-aliases.md) for a full walkthrough and importer examples.

## Custom resolver hooks

### `resolver`

Pass a `resolver(specifier, { cwd, from })` function to either the `css()` API or the loader to intercept specifiers before the built-in logic. Use it to:

- Normalize virtual schemes (e.g. `pkg:#ui/button.scss`).
- Delegate to your bundler’s resolver so the CSS pass sees the exact same file graph.
- Inject synthetic files (return a `file://` URL or absolute path).

The value you return wins; if you return `undefined`, `@knighted/css` falls back to tsconfig paths and Node-style resolution automatically:

```ts
import { css } from '@knighted/css'
import createBundlerResolver from './bundler-resolver'

const bundlerResolve = createBundlerResolver()

await css('./src/entry.tsx', {
  resolver: (specifier, ctx) => bundlerResolve(specifier, ctx.from ?? ctx.cwd),
})
```

### `peerResolver`

Sass, Less, vanilla-extract, and other dialects are optional peers. If your bundler already provides them (or you need to load a namespaced version), expose them through `peerResolver(name)` so `@knighted/css` never reaches into `node_modules` on its own:

```ts
await css('./src/entry.ts', {
  peerResolver: async name => {
    if (name === 'sass') {
      return import('@myns/sass-runtime')
    }
    return import(name)
  },
})
```

Combine `resolver` + `peerResolver` to ensure the CSS walk stays in lockstep with your bundler’s module graph—whether you’re resolving Node `#imports`, custom Sass prefixes, or files exposed through virtual modules.
