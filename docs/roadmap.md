# 2026 Roadmap

## DX-Focused Hot Module Replacement _(minor-safe)_

- Detect CSS-only updates via existing `moduleInfo` default-export signals.
- Swap the updated `knightedCss` string into live `CSSStyleSheet` instances without rerendering component trees.
- Expose helper hooks (e.g., via `asKnightedCssCombinedModule`) so framework adapters can opt in incrementally.

## Type Pipeline Cleanup

- Remove the triple-slash references from `types.d.ts` for v2.0, replacing them with standard ESM import/export wiring.
- Ensure the new pipeline preserves the current downstream behavior for 1.x users via a documented migration path.

## Lightning CSS Dependency Strategy

- Evaluate promoting `lightningcss` to a peer dependency so consumers can align with their own upgrade cadence.
- Document fallbacks for specificity workflows if teams opt to satisfy the peer via compatible forks or alternative transformers.

## Sass Resolver Options

- Allow configuring conditionNames for `pkg:` resolution (e.g., opt into `sass` or custom priority ordering).
- Allow opting into explicit `tsconfig` selection instead of `tsconfig: auto` when resolving `pkg:` specifiers.
