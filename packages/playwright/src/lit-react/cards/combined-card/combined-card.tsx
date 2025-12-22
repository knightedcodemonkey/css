import { asKnightedCssCombinedModule } from '@knighted/css/loader-helpers'

import * as combinedModule from './combined-card-entry.js?knighted-css&combined'
import { COMBINED_CARD_TEST_ID } from './combined-card-entry.js'

const {
  default: CombinedCardEntry,
  CombinedCardBadge,
  CombinedCardDetails,
  knightedCss,
} = asKnightedCssCombinedModule<typeof import('./combined-card-entry.js')>(combinedModule)

export const combinedCardCss = knightedCss
export { COMBINED_CARD_TEST_ID } from './combined-card-entry.js'

export function CombinedCard() {
  return (
    <section className="combined-card" data-testid={COMBINED_CARD_TEST_ID}>
      <CombinedCardEntry />
      <CombinedCardDetails />
      <CombinedCardBadge />
    </section>
  )
}
