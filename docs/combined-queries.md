# Knighted CSS Combined Loader Reference

This document summarizes how `?knighted-css&combined` behaves for different module export shapes and how to structure your imports accordingly. Use it as guidance when filing documentation feedback for `@knighted/css`.

> [!NOTE]
> TypeScript reads literal selector tokens from the generated `.knighted-css.ts` modules (emitted by `knighted-css-generate-types`). Append `&types` to combined imports only when you also need `stableSelectors` at runtime—the loader still exports the map, while the double-extension modules keep your editors in sync.

> [!TIP]
> Prefer importing `asKnightedCssCombinedModule` from `@knighted/css/loader-helpers` when you want a runtime helper—the file has zero Node dependencies, so both browser and Node builds stay green.

## Decision Matrix

| Module exports                         | Recommended query                                                                  | Import pattern                                              | Notes                                                                                                                      |
| -------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Named only**                         | `?knighted-css&combined&named-only`                                                | [Snippet](#named-exports-only)                              | `&named-only` disables the synthetic default export so you only destructure the original named members plus `knightedCss`. |
| **Default only**                       | `?knighted-css&combined`                                                           | [Snippet](#default-export-only)                             | Loader mirrors the default export and adds `knightedCss`, so default-import code keeps working.                            |
| **Default + named**                    | `?knighted-css&combined` (append `&named-only` when you never consume the default) | [Snippet](#default-and-named-exports)                       | Without the flag you get both default + named exports; adding it drops the synthetic default for stricter codebases.       |
| **Named + stable selectors**           | `?knighted-css&combined&named-only&types`                                          | [Snippet](#named-exports-with-stable-selectors)             | Adds a `stableSelectors` named export; configure namespaces via the loader option or CLI flag.                             |
| **Default only + stable selectors**    | `?knighted-css&combined&types`                                                     | [Snippet](#default-export-with-stable-selectors)            | Keep your default-import flow and add `stableSelectors`; namespaces come from loader/CLI configuration.                    |
| **Default + named + stable selectors** | `?knighted-css&combined&types` (append `&named-only` if you skip the default)      | [Snippet](#default-and-named-exports-with-stable-selectors) | Best of both worlds—`stableSelectors` is exported alongside `knightedCss`; add `&named-only` if you don’t use the default. |

### Jump to a scenario

- [Named exports only](#named-exports-only) – drop the synthetic default and keep namespace imports tidy.
- [Default export only](#default-export-only) – keep your default-import flow with `knightedCss` alongside.
- [Default and named exports](#default-and-named-exports) – destructure everything without extra loader flags.
- [Named exports with stable selectors](#named-exports-with-stable-selectors) – add `stableSelectors` while staying default-free.
- [Default export with stable selectors](#default-export-with-stable-selectors) – default import plus runtime selector map.
- [Default and named exports with stable selectors](#default-and-named-exports-with-stable-selectors) – grab every export plus `stableSelectors`.

## Named exports only

_Use when your module only exposes named exports and you never rely on a synthetic default._

```ts
import { asKnightedCssCombinedModule } from '@knighted/css/loader-helpers'
import * as combinedModule from './module.js?knighted-css&combined&named-only'

const { Component, knightedCss } =
  asKnightedCssCombinedModule<typeof import('./module.js')>(combinedModule)
```

> [!NOTE]
> Namespace imports (`import * as combined …`) are the most reliable pattern for `&named-only` queries because you intentionally drop the default export. Keep using the helper type to narrow the namespace.

## Default export only

_Use when your component only exposes a default export and you want `knightedCss` beside it._

```ts
import { asKnightedCssCombinedModule } from '@knighted/css/loader-helpers'
import * as combinedModule from './module.js?knighted-css&combined'

const { default: Component, knightedCss } =
  asKnightedCssCombinedModule<typeof import('./module.js')>(combinedModule)
```

## Default and named exports

_Use when you consume both the default export and its named helpers from the same module._

```ts
import { asKnightedCssCombinedModule } from '@knighted/css/loader-helpers'
import * as combinedModule from './module.js?knighted-css&combined'

const {
  default: Component,
  helper,
  knightedCss,
} = asKnightedCssCombinedModule<typeof import('./module.js')>(combinedModule)
```

Prefer `?knighted-css&combined&named-only` plus the [named exports only](#named-exports-only) snippet when you intentionally avoid default exports but still need the named members and `knightedCss`.

## Adding stable selectors (`&types`)

Append `&types` whenever you need the runtime `stableSelectors` map in addition to `knightedCss`. Configure the loader’s `stableNamespace` option (or pass `--stable-namespace` to the CLI) so runtime exports and generated `.knighted-css.ts` modules stay aligned.

### Named exports with stable selectors

_Use when you only consume named exports (no default) but still want typed `stableSelectors`._

```ts
import { asKnightedCssCombinedModule } from '@knighted/css/loader-helpers'
import type { KnightedCssStableSelectors as ModuleStableSelectors } from './module.css.knighted-css.js'
import * as combinedModule from './module.js?knighted-css&combined&named-only&types'

const { Component, knightedCss, stableSelectors } = asKnightedCssCombinedModule<
  typeof import('./module.js'),
  { stableSelectors: Readonly<Record<keyof ModuleStableSelectors, string>> }
>(combinedModule)

stableSelectors.card // "knighted-card"
```

> [!TIP]
> Add `&named-only` before `&types` to drop the synthetic default export while still receiving `stableSelectors`.

### Default export with stable selectors

_Use when you stick with default imports but also need access to the selector map._

```ts
import { asKnightedCssCombinedModule } from '@knighted/css/loader-helpers'
import type { KnightedCssStableSelectors as ModuleStableSelectors } from './module.css.knighted-css.js'
import * as combinedModule from './module.js?knighted-css&combined&types'

const {
  default: Component,
  knightedCss,
  stableSelectors,
} = asKnightedCssCombinedModule<
  typeof import('./module.js'),
  { stableSelectors: Readonly<Record<keyof ModuleStableSelectors, string>> }
>(combinedModule)

stableSelectors.badge // "knighted-badge"
```

### Default and named exports with stable selectors

_Use when you consume every export from the module and still want the selector map._

```ts
import { asKnightedCssCombinedModule } from '@knighted/css/loader-helpers'
import type { KnightedCssStableSelectors as ModuleStableSelectors } from './module.css.knighted-css.js'
import * as combinedModule from './module.js?knighted-css&combined&types'

const {
  default: Component,
  helper,
  knightedCss,
  stableSelectors,
} = asKnightedCssCombinedModule<
  typeof import('./module.js'),
  { stableSelectors: Readonly<Record<keyof ModuleStableSelectors, string>> }
>(combinedModule)

stableSelectors.card // "knighted-card" (or your configured namespace)
```

## Key Takeaways

- The loader always injects `knightedCss` alongside the module’s exports.
- To avoid synthetic defaults (and TypeScript warnings) for modules that only expose named exports, add `&named-only` and use a namespace import.
- Namespace imports plus `KnightedCssCombinedModule<typeof import('./module')>` work universally; default imports are optional conveniences when the source module exposes a default you actually consume.
- Add `&types` when you also need the `stableSelectors` map. Configure the namespace globally (loader option or CLI flag) so runtime + generated types stay consistent.

## When to use `KnightedCssCombinedModule`

The helper type still earns its keep when you need to narrow combined results without `asKnightedCssCombinedModule` (for example, in test doubles or custom wrappers):

```ts
import type { KnightedCssCombinedModule } from '@knighted/css/loader'
import * as moduleWithCss from './component.js?knighted-css&combined&types'

type CombinedComponent = KnightedCssCombinedModule<
  typeof import('./component.js'),
  { stableSelectors: Readonly<Record<string, string>> }
>

const combined = moduleWithCss as CombinedComponent
combined.knightedCss // string
combined.stableSelectors.card // typed selector token
```

Reach for the type whenever you need to annotate combined modules manually—otherwise, the runtime helper keeps the snippets leaner.
