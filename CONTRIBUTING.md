# Contributing to @knighted/css

Thanks for spending time on the Knighted CSS suite! This document highlights the conventions that are hardest to infer from the codebase so you can ship fixes without guesswork.

## Local setup

1. Use Node 22+ and npm (the repo scripts assume npm).
2. Install dependencies from the repo root: `npm install`.
3. Run lint and tests before sending a PR:
   - `npm run lint` (oxlint across every package)
   - `npm test` (delegates to each package's test runner)

## File naming policy

We enforce naming gradually with `unicorn/filename-case` so existing camelCase modules keep working while new code stays consistent.

- **New files**: default to kebab-case (e.g., `module-info.ts`). PascalCase is reserved for files that export React-style components or top-level docs such as `README.md`.
- **Legacy folders**: some directories (especially `packages/css/src/**`) still contain camelCase files. They remain whitelisted in `.oxlintrc.json`. When you touch one of those files, feel free to rename it to kebab-case in a dedicated commit and then tighten the ignore glob.
- **Special cases**: directories such as `__snapshots__` and `.husky/_` intentionally keep underscores—leave those alone.

## Type stub directories

The CSS package ships two `types-stub` directories on purpose:

- `packages/css/src/types-stub/` is the source stub checked into git. The entire repo references this file during development so editors and TypeScript builds succeed before generated selectors exist.
- `packages/css/types-stub/` is a build artifact copied by `packages/css/scripts/copy-types-stub.js` during `npm run build`. It **must** stay in git because npm publishes from `packages/css/` directly; removing it would strip the placeholder declarations that consumers need on fresh installs.

When editing the stub, always update the version under `src/types-stub/` and let the copy script mirror it.

## Type entrypoint strategy

`packages/css/types.d.ts` currently uses triple-slash references to pull in `loader-queries.d.ts` and the stub above. This is intentional for the entire 1.x line so downstream TypeScript consumers enjoy stable behavior. We silence the `typescript-eslint/triple-slash-reference` warning via `.oxlintrc.json`. When we design 2.0.0 we will switch to ESM-style imports and remove that override—please keep that in mind if you are touching the type entrypoint.

## Pull request checklist

- Follow the naming rules above for any new files.
- Confirm `npm run lint` emits zero warnings.
- Describe any behavioral changes in the relevant package README or docs (e.g., `docs/combined-queries.md`).
- If you touch the type stub or generator, call it out explicitly in the PR so we can double-check publish artifacts.

Happy hacking!
