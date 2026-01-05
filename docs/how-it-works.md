# How `@knighted/css` preserves the cascade

## Overview

- The loader walks the module graph and gathers style-producing files (`.css`, `.scss`, `.sass`, `.less`, `.css.ts`, etc.).
- It walks the module graph with a built-in depth-first resolver so imports are visited in source order.
- Resolution is powered by [`oxc-resolver`](https://github.com/oxc-project/oxc-resolver), so tsconfig `paths`, package `exports` conditions, and extension aliasing (like `.css.js` → `.css.ts`) all map to the same targets you’d get in a bundler.
- JSX/TSX is supported: if `es-module-lexer` can’t parse a file or the extension is `.jsx`/`.tsx`, we fall back to `oxc-parser` to read imports and defaults without any user configuration.
- CSS from those files is concatenated in that discovery order and returned as `knightedCss` for injection (e.g., Lit ` css`` `, SSR, SSG).
- We do **not** sort or reorder; first-seen order is kept, so the CSS cascade mirrors the original import sequence.

## Ordering details

- Entry module CSS (if any) is first, then each import in the order written, recursing depth-first.
- Files are deduped but keep their first-seen position; later encounters are skipped to avoid reshuffling the cascade.
- We do not apply alphabetical or timestamp sorts.
- `lightningcss` minifies/prefixes but preserves the rule order we provide, so cascade semantics are intact.

### Example ordering

The walker performs a depth-first, preorder traversal (parent before children) so imports are resolved exactly as they are written in source. Files are deduped: the first time a file is seen, it’s included; later encounters are skipped to avoid reshuffling the cascade. We never sort the list, and `lightningcss` preserves the rule order we provide.

Given:

- `entry.ts` imports `./a` then `./b`
- `a` imports `./a1` then `./a2`
- `b` imports `./b1`
- CSS files:
  - `entry.css`
  - `a.css` (imported by `a`)
  - `a1.css`
  - `a2.css`
  - `b.css`
  - `b1.css`

Concatenation order:

1. `entry.css`
2. `a.css`
3. `a1.css`
4. `a2.css`
5. `b.css`
6. `b1.css`

If a file is imported multiple times, only its first-seen position is kept; later repeats are ignored to keep cascade order stable.

### The role of specificity and order

The concatenation order we produce aligns with the "**Order of Appearance**" part of the CSS cascade. **Specificity** (e.g. whether a selector is an ID, class or element name) still wins when selectors differ, but when specificity is the _same_, later rules win. Because we preserve import order in a depth-first, preorder traversal, foundational styles (earlier imports) land before overrides (later imports). We never alter selector specificity; we only guarantee that file order mirrors the import structure so equal-specificity overrides behave as authored.

## At-rules and modern syntax

- Unknown/modern at-rules (e.g., `@scope`) are passed through as written; we do not strip or reorder them.
- If you need polyfills for non-supporting browsers, add a follow-on CSS transform step; we leave them intact.

## Optional specificity boosts

If you need to raise specificity for targeted selectors, you can supply a Lightning CSS visitor via the `specificityBoost` option (available in both the helper and loader). We compose your visitor with any existing `lightningcss.visitor` you provide; order of rules stays the same.

## What to expect

- Cascade behavior should match running the same module graph in a bundler that respects import order.
- If you observe ordering differences, look for downstream steps that resort, merge, or extract CSS; the loader itself keeps the discovered order.
