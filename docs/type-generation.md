# Type generation (`*.knighted-css*`)

Use the `knighted-css-generate-types` CLI to create selector manifests that TypeScript can import. The CLI scans for specifiers ending in `.knighted-css` (for example `./button.module.scss.knighted-css.ts`), compiles the stylesheet once, and writes a sibling module that exports the literal selector tokens.

## Running the CLI

```sh
npx knighted-css-generate-types --root . --include src
```

Typical script entry:

```json
{
  "scripts": {
    "types:css": "knighted-css-generate-types --root . --include src"
  }
}
```

Wire it into `postinstall` or your build so new selectors land automatically.

## Minimal usage

```ts
import selectors from './button.module.scss.knighted-css.js'

selectors.card // "knighted-card"
```

Because the generated module lives next to the source stylesheet, TypeScript’s normal resolution logic applies—no custom `paths` entries required. Use the manifest in conjunction with runtime helpers such as `mergeStableClass` or `stableClassName` to keep hashed class names in sync.

### Options

- `--root` / `-r` – project root (defaults to `process.cwd()`).
- `--include` / `-i` – additional directories or files to scan (repeatable).
- `--out-dir` – directory for the selector module manifest cache (defaults to `<root>/.knighted-css`).
- `--stable-namespace` – namespace prefix shared by the generated selector maps and loader runtime.

### Relationship to the loader

- `.knighted-css*` imports are purely for types; they never include the compiled CSS string.
- `?knighted-css` imports are purely runtime (see [docs/loader.md](./loader.md)). Append `&types` only when you also need the selector map at runtime; the compiler still reads the literal tokens from the generated modules.

Keep both hooks in mind when authoring CSS Modules or Sass files that need stable selectors: import the generated module for types, and import the loader query when you need the runtime stylesheet.
