import { asKnightedCssCombinedModule } from '@knighted/css/loader-helpers'

import * as combinedModule from './combined-types-card-entry.js?knighted-css&combined&types'
import type { CombinedTypesStableSelectors } from './combined-types-card-entry.css.knighted-css.js'

const {
  default: CombinedTypesCardEntry,
  knightedCss,
  stableSelectors: runtimeStableSelectors,
} = asKnightedCssCombinedModule<
  typeof import('./combined-types-card-entry.js'),
  { stableSelectors: Readonly<Record<keyof CombinedTypesStableSelectors, string>> }
>(combinedModule)

export const combinedTypesCardCss = knightedCss
export { COMBINED_TYPES_TEST_ID } from './combined-types-card-entry.js'

export function CombinedTypesCard() {
  return <CombinedTypesCardEntry runtimeSelectors={runtimeStableSelectors} />
}
