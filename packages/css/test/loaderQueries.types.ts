import '@knighted/css/loader-queries'

/**
 * This file never executes at runtime. It exists solely so `tsc --project tsconfig.tests.json`
 * validates the emitted ambient modules from `@knighted/css/loader-queries`.
 */
type CombinedModule =
  typeof import('./fixtures/combined/runtime-entry.ts?knighted-css&combined&types')

type StableModule =
  typeof import('./fixtures/combined/runtime-entry.ts?knighted-css&stable')

type ExpectTrue<T extends true> = T

type KnightedCssIsString = ExpectTrue<
  CombinedModule['knightedCss'] extends string ? true : false
>
type StableSelectorsAreReadonly = ExpectTrue<
  CombinedModule['stableSelectors'] extends Readonly<Record<string, string>>
    ? true
    : false
>
export type LoaderQueriesSmokeTest = [KnightedCssIsString, StableSelectorsAreReadonly]

type StableKnightedCssIsString = ExpectTrue<
  StableModule['knightedCss'] extends string ? true : false
>
type StableSelectorsAreReadonlyForStable = ExpectTrue<
  StableModule['stableSelectors'] extends Readonly<Record<string, string>> ? true : false
>
export type LoaderQueriesStableSmokeTest = [
  StableKnightedCssIsString,
  StableSelectorsAreReadonlyForStable,
]
