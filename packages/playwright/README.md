# @knighted/css Playwright fixtures

This package builds the demo surface Playwright hits in CI. It now covers three scenarios:

- Lit + React wrapper (bundled via Rspack/Webpack): exercises vanilla CSS, Sass/Less, vanilla-extract, combined loader queries, and the attribute-import card that uses `with { type: "css" }` in a bundled flow.
- Hash-imports workspace demo: minimal npm workspace under `src/hash-imports-workspace/` proving `@knighted/css/loader` and `css()` respect hash-prefixed `package.json#imports` (`#workspace/*`).
- Native CSS import attributes (no bundler): plain ESM page at `/src/native-attr/index.html` that imports `./native-attr.css` with `{ type: 'css' }` and applies the stylesheet at runtime.

## How to run

- Full matrix (default): `npm test` (runs chromium plus webpack + SSR builds).
- Hash-imports only: `npm run test -- --project=chromium hash-imports.spec.ts`.
- Local preview server: `npm run preview -w @knighted/css-playwright-fixture` (serves at http://localhost:4174 after building Rspack/webpack/SSR outputs).

## Exercising CSS import attributes

- Bundled path (Lit/React attribute card): after `npm run preview -w @knighted/css-playwright-fixture`, open http://localhost:4174/ and locate the card with test id `dialect-attr-import` (rendered by `lit-react.spec.ts`).
- Native path (no bundler): open http://localhost:4174/src/native-attr/index.html. Chrome 123+ supports CSS module scripts; the page adopts the imported stylesheet so you should see the chip styling without the "Waiting for styles…" placeholder.
