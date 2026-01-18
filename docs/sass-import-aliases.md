# Sass import aliases

Some Sass codebases rely on custom load-path prefixes such as `pkg:#ui/button` or `alias:@scope/app/components/button`. Those specifiers are resolved by the Sass compiler itself—they never travel through Node.js resolution, `package.json#imports`, or tsconfig `paths`.

`@knighted/css` ships a built-in Sass importer for `pkg:` so `pkg:#...` specifiers resolve without any custom resolver. For any other bespoke scheme or alias, provide a custom resolver that rewrites the specifier into an absolute path before the loader (or the standalone `css()` function) walks the dependency graph.

> [!NOTE]
> Sass support is provided via Dart Sass (`sass` npm package). Ruby Sass and node-sass are not supported.

## When you need a resolver

Add a resolver whenever you see either of the following:

- An `@use`/`@import` statement that starts with a nonstandard scheme such as `alias:` or `sass:` (other than `pkg:`).
- A project-level shorthand that never appears in `package.json#imports` or `tsconfig.json` (for example, `@scope/app` pointing at a workspace directory only Sass knows about).

Without a resolver, those imports throw “Cannot resolve specifier” errors as soon as `@knighted/css` tries to crawl the module graph.

## Example: strip custom aliases

```ts
import path from 'node:path'
import { css } from '@knighted/css'

const pkgAppSrcDir = path.resolve(process.cwd(), 'packages/app/src')

function resolvePkgAlias(specifier: string): string | undefined {
  if (!specifier.startsWith('alias:')) return undefined
  const remainder = specifier
    .slice('alias:'.length)
    .replace(/^@scope\/app\/?/, '')
    .replace(/^\/+/, '')
  return path.resolve(pkgAppSrcDir, remainder)
}

await css('./src/entry.ts', {
  resolver: (specifier, { cwd }) => resolvePkgAlias(specifier) ?? undefined,
})
```

The same helper works inside bundler rules:

```js
{
  test: /\.[jt]sx?$/,
  resourceQuery: /knighted-css/,
  use: [
    {
      loader: '@knighted/css/loader',
      options: {
        resolver: specifier => resolvePkgAlias(specifier),
      },
    },
  ],
}
```

Customize the rewrite logic to match your project’s prefixes or directory layout. Once the resolver returns an absolute file path, `@knighted/css` will process the Sass dependency chain normally and still honor every other built-in resolution feature (tsconfig `paths`, package `imports`, extension aliases, etc.).
