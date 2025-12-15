import { knightedCss, stableSelectors } from './demo.css.ts?knighted-css&types'

type Assert<T extends true> = T

type CssIsString = Assert<typeof knightedCss extends string ? true : false>
type StableSelectorsIsRecord = Assert<
  typeof stableSelectors extends Readonly<Record<string, string>> ? true : false
>

const sampleCss: string = knightedCss
const stableHook: string | undefined = stableSelectors.demo

void sampleCss
void stableHook
void ([] as CssIsString[])
void ([] as StableSelectorsIsRecord[])
