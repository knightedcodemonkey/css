# @knighted/css Playwright fixtures

This package builds the demo surface that Playwright pokes during CI. It now renders two scenarios side by side:

- **Lit + React wrapper**: the existing showcase that exercises vanilla CSS, Sass/Less, vanilla-extract, and the combined loader queries.
- **Hash-imports workspace demo**: a minimal npm workspace under `src/hash-imports-workspace/` where `apps/hash-import-demo` uses `package.json#imports` (hash-prefixed specifiers) to resolve UI modules provided by a sibling workspace package. The fixture proves that `@knighted/css/loader` and the standalone `css()` API honor `#workspace/*` specifiers with zero extra configuration.

Run `npm run test -- --project=chromium hash-imports.spec.ts` from this directory to rebuild the preview bundle and execute only the hash-imports checks. The default `npm test` target still runs the full matrix (chromium on CI plus the webpack + SSR builds).
