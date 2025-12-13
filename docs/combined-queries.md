# Knighted CSS Combined Loader Reference

This document summarizes how `?knighted-css&combined` behaves for different module export shapes and how to structure your imports accordingly. Use it as guidance when filing documentation feedback for `@knighted/css`.

## Decision Matrix

| Source module exports       | Recommended query                                                                  | TypeScript import pattern             | Notes                                                                                                                      |
| --------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Named exports only**      | `?knighted-css&combined&named-only`                                                | [Snippet](#named-exports-only)        | `&named-only` disables the synthetic default export so you only destructure the original named members plus `knightedCss`. |
| **Default export only**     | `?knighted-css&combined`                                                           | [Snippet](#default-export-only)       | Loader mirrors the default export and adds `knightedCss`, so default-import code keeps working.                            |
| **Default + named exports** | `?knighted-css&combined` (append `&named-only` when you never consume the default) | [Snippet](#default-and-named-exports) | Without the flag you get both default + named exports; adding it drops the synthetic default for stricter codebases.       |

## Named exports only

```ts
import type { KnightedCssCombinedModule } from '@knighted/css/loader'
import combined from './module.js?knighted-css&combined&named-only'

const { Component, knightedCss } = combined as KnightedCssCombinedModule<
  typeof import('./module.js')
>
```

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

## Key Takeaways

- The loader always injects `knightedCss` alongside the module’s exports.
- To avoid synthetic defaults (and TypeScript warnings) for modules that only expose named exports, add `&named-only` and use a namespace import.
- Namespace imports plus `KnightedCssCombinedModule<typeof import('./module')>` work universally; default imports are optional conveniences when the source module exposes a default you actually consume.
