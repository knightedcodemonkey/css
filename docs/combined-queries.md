# Knighted CSS Combined Loader Reference

This document summarizes how `?knighted-css&combined` behaves for different module export shapes and how to structure your imports accordingly. Use it as guidance when filing documentation feedback for `@knighted/css`.

## Decision Matrix

| Source module exports                          | Recommended query                                                                               | TypeScript import pattern                                   | Notes                                                                                                                      |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Named exports only**                         | `?knighted-css&combined&named-only`                                                             | [Snippet](#named-exports-only)                              | `&named-only` disables the synthetic default export so you only destructure the original named members plus `knightedCss`. |
| **Default export only**                        | `?knighted-css&combined`                                                                        | [Snippet](#default-export-only)                             | Loader mirrors the default export and adds `knightedCss`, so default-import code keeps working.                            |
| **Default + named exports**                    | `?knighted-css&combined` (append `&named-only` when you never consume the default)              | [Snippet](#default-and-named-exports)                       | Without the flag you get both default + named exports; adding it drops the synthetic default for stricter codebases.       |
| **Named exports + stable selector map**        | `?knighted-css&combined&named-only&types` (+ `&stableNamespace=acme` if you override namespace) | [Snippet](#named-exports-with-stable-selectors)             | Adds a `stableSelectors` named export; order matters (`&types` before `&stableNamespace`).                                 |
| **Default export only + stable selector map**  | `?knighted-css&combined&types` (+ `&stableNamespace=acme`)                                      | [Snippet](#default-export-with-stable-selectors)            | Keep your default-import flow and add `stableSelectors` + namespace override support.                                      |
| **Default + named exports + stable selectors** | `?knighted-css&combined&types` (append `&named-only` + `&stableNamespace=...` as needed)        | [Snippet](#default-and-named-exports-with-stable-selectors) | Best of both worlds—`stableSelectors` is exported alongside `knightedCss`; add `&named-only` if you don’t use the default. |

## Named exports only

```ts
import type { KnightedCssCombinedModule } from '@knighted/css/loader'
import combined from './module.js?knighted-css&combined&named-only'

const { Component, knightedCss } = combined as KnightedCssCombinedModule<
  typeof import('./module.js')
>
```

> [!NOTE]
> Namespace imports (`import * as combined …`) are the most reliable pattern for `&named-only` queries because you intentionally drop the default export. Keep using the helper type to narrow the namespace.

## Default export only

```ts
import type { KnightedCssCombinedModule } from '@knighted/css/loader'
import combined from './module.js?knighted-css&combined'

const { default: Component, knightedCss } = combined as KnightedCssCombinedModule<
  typeof import('./module.js')
>
```

## Default and named exports

```ts
import type { KnightedCssCombinedModule } from '@knighted/css/loader'
import combined from './module.js?knighted-css&combined'

const {
  default: Component,
  helper,
  knightedCss,
} = combined as KnightedCssCombinedModule<typeof import('./module.js')>
```

Prefer `?knighted-css&combined&named-only` plus the [named exports only](#named-exports-only) snippet when you intentionally avoid default exports but still need the named members and `knightedCss`.

## Named exports with stable selectors

```ts
import type { KnightedCssCombinedModule } from '@knighted/css/loader'
import combined, {
  stableSelectors,
} from './module.js?knighted-css&combined&named-only&types'

const { Component, knightedCss } = combined as KnightedCssCombinedModule<
  typeof import('./module.js')
>

stableSelectors.card // "knighted-card"
```

Add `&stableNamespace=acme` at the end of the query when you need a one-off namespace override.

## Default export with stable selectors

```ts
import type { KnightedCssCombinedModule } from '@knighted/css/loader'
import combined, { stableSelectors } from './module.js?knighted-css&combined&types'

const { default: Component, knightedCss } = combined as KnightedCssCombinedModule<
  typeof import('./module.js')
>

stableSelectors.badge // "knighted-badge"
```

## Default and named exports with stable selectors

```ts
import type { KnightedCssCombinedModule } from '@knighted/css/loader'
import combined, {
  stableSelectors,
} from './module.js?knighted-css&combined&types&stableNamespace=acme'

const {
  default: Component,
  helper,
  knightedCss,
} = combined as KnightedCssCombinedModule<typeof import('./module.js')>

stableSelectors.card // "acme-card"
```

Append `&named-only` before `&types` when you want to drop the synthetic default export while still receiving `stableSelectors`.

## Key Takeaways

- The loader always injects `knightedCss` alongside the module’s exports.
- To avoid synthetic defaults (and TypeScript warnings) for modules that only expose named exports, add `&named-only` and use a namespace import.
- Namespace imports plus `KnightedCssCombinedModule<typeof import('./module')>` work universally; default imports are optional conveniences when the source module exposes a default you actually consume.
- Add `&types` when you also need the `stableSelectors` map, and append `&stableNamespace=my-prefix` if you want a per-import namespace override. Query order matters: keep `&types` before `&stableNamespace` for tooling support.
