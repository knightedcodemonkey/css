# [`@knighted/css`](https://www.npmjs.com/package/@knighted/css)

![CI](https://github.com/knightedcodemonkey/css/actions/workflows/ci.yml/badge.svg)
[![codecov](https://codecov.io/gh/knightedcodemonkey/css/graph/badge.svg?token=q93Qqwvq6l)](https://codecov.io/gh/knightedcodemonkey/css)
[![NPM version](https://img.shields.io/npm/v/@knighted/css.svg)](https://www.npmjs.com/package/@knighted/css)

`@knighted/css` is a zero-bundler CSS pipeline for JavaScript and TypeScript projects. Point it at an entry module and it walks the graph, compiles every CSS-like dependency (CSS, Sass/SCSS, Less, vanilla-extract), and hands back both a concatenated stylesheet string and optional `.knighted-css.*` selector manifests for type-safe loaders.

## What it does (at a glance)

- **Graph walking**: Follows `import` trees the same way Node does (tsconfig `paths`, package `exports`/`imports`, hash specifiers, etc.) using [`oxc-resolver`](https://github.com/oxc-project/oxc-resolver).
- **Multi-dialect compilation**: Runs Sass, Less, Lightning CSS, or vanilla-extract integrations on demand so every dependency ends up as plain CSS.
- **Loader + CLI**: Ship CSS at runtime via `?knighted-css` loader queries or ahead of time via the `css()` API and the `knighted-css-generate-types` command.
- **Shadow DOM + SSR ready**: Inline styles in server renders, ship them alongside web components, or keep classic DOM apps in sync—all without wiring a full bundler.

See the [docs/](./docs) directory for deep dives on loaders, type generation, specificity boosts, Sass aliases, the combined import queries, and the current [2026 roadmap](./docs/roadmap.md).

## Workspaces in this repo

| Workspace             | NPM Name                                                              | What it contains                                                                                                                                                                          |
| --------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/css`        | [`@knighted/css`](./packages/css/README.md)                           | The production library: graph walker, compilation pipeline, loader helpers, CLI, and docs. Published to npm and meant for real builds.                                                    |
| `packages/playwright` | [`@knighted/css-playwright-fixture`](./packages/playwright/README.md) | The end-to-end demo + regression suite. Playwright drives Lit + React examples, hash-import workspace scenarios, and SSR checks to ensure the core package keeps working across bundlers. |

Each workspace is a standalone npm project. Run commands from the repo root with `npm run <script> -w <workspace>` or `npm run <script> --workspaces` to fan out when needed.

## Quick start

```ts
import { css } from '@knighted/css'

const sheet = await css('./src/entry.tsx', {
  cwd: process.cwd(),
  lightningcss: { minify: true },
})

console.log(sheet) // use during SSR, static builds, or to inline Shadow DOM styles
```

- Need runtime imports? See [docs/loader.md](./docs/loader.md).
- Want strong selector types? Run `npx knighted-css-generate-types` and follow [docs/type-generation.md](./docs/type-generation.md).
- Need the rundown on Node `exports`/`imports`, Sass prefixes, or custom resolver hooks? Start with [docs/resolution.md](./docs/resolution.md).

## Contributing & Support

1. Install deps with `npm install`.
2. Run `npm run build` to compile `@knighted/css`.
3. Use `npm run test` for unit coverage and `npm run test:e2e` for the Playwright matrix.

Issues and feature ideas are always welcome via [GitHub issues](https://github.com/knightedcodemonkey/css/issues).

## License

MIT © Knighted Code Monkey
