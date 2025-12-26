import { asKnightedCssCombinedModule } from '@knighted/css/loader-helpers'

import * as nestedModule from './components/nested-combined-entry.js?knighted-css&combined'
import { NESTED_COMBINED_TEST_ID } from './components/nested-combined-entry.js'

const {
  default: NestedCombinedEntry,
  NestedCombinedBadge,
  NestedCombinedDetails,
  knightedCss,
} = asKnightedCssCombinedModule<typeof import('./components/nested-combined-entry.js')>(
  nestedModule,
)

export const nestedCombinedCardCss = knightedCss
export { NESTED_COMBINED_TEST_ID } from './components/nested-combined-entry.js'

export function NestedCombinedCard() {
  return (
    <section className="nested-combined-card" data-testid={NESTED_COMBINED_TEST_ID}>
      <NestedCombinedEntry />
      <NestedCombinedDetails />
      <NestedCombinedBadge />
    </section>
  )
}
