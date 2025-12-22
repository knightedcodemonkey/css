# Loader hook (`?knighted-css`)

`@knighted/css/loader` lets bundlers attach compiled CSS strings to any module by appending the `?knighted-css` query when importing. The loader mirrors the module graph, compiles every CSS dialect it discovers (CSS, Sass, Less, vanilla-extract, etc.), and exposes the concatenated result as `knightedCss`.

## Loader example

```ts
import { knightedCss } from './button.js?knighted-css'

export const styles = knightedCss
```

Add a bundler rule that pipes `?knighted-css` imports through `@knighted/css/loader` plus your transpiler of choice. See the main README for a complete rule configuration.

```js
// rspack.config.js
export default {
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

### Combined imports

Need the component exports **and** the compiled CSS from a single import? Use `?knighted-css&combined` and narrow the result with `KnightedCssCombinedModule` to keep TypeScript happy:

```ts
import type { KnightedCssCombinedModule } from '@knighted/css/loader'
import buttonModule from './button.js?knighted-css&combined'

const { default: Button, knightedCss } = buttonModule as KnightedCssCombinedModule<
  typeof import('./button.js')
>
```

Append `&named-only` (alias: `&no-default`) if you never consume the default export. Refer to [docs/combined-queries.md](./combined-queries.md) for the full matrix of query flags and destructuring patterns.

### Runtime selectors (`&types`)

When you need the runtime `stableSelectors` map alongside `knightedCss`, append `&types` to either the plain or combined import:

```ts
import { knightedCss, stableSelectors } from './card.js?knighted-css&types'
```

> [!NOTE]
> TypeScript does not infer the stable selector literal types from this import; use the generated `.knighted-css.*` modules described in [docs/type-generation.md](./type-generation.md) for compile-time safety. The runtime map is helpful for tests, telemetry, or non-TypeScript environments.

### vanilla-extract loader guidance

vanilla-extract files (`*.css.ts`) compile down to CommonJS by default. That works out of the box for the loader—both `?knighted-css` and `?knighted-css&combined` queries emit `module.exports` artifacts plus the injected `knightedCss` string. Most bundlers happily consume that shape. When you _also_ need the compiled module to behave like a native ESM module (e.g., your bundler expects `export` statements so it can treeshake or when you import via extension aliases), enable the loader’s opt-in transform:

```js
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
