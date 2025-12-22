import { asKnightedCssCombinedModule } from '@knighted/css/loader-helpers'

import * as namedOnlyModule from './named-only-card-entry.js?knighted-css&combined&named-only'
import {
  NamedOnlyCardBadge,
  NamedOnlyCardView,
  NamedOnlyCopy,
  NamedOnlyFlag,
} from './named-only-card-entry.js'

const moduleWithCss =
  asKnightedCssCombinedModule<typeof import('./named-only-card-entry.js')>(
    namedOnlyModule,
  )

const hasSyntheticDefault = Object.prototype.hasOwnProperty.call(moduleWithCss, 'default')

export const namedOnlyCardCss = moduleWithCss.knightedCss
export { NAMED_ONLY_TEST_ID } from './named-only-card-entry.js'

export function NamedOnlyCard() {
  return (
    <NamedOnlyCardView hasDefault={hasSyntheticDefault}>
      <NamedOnlyCardBadge />
      <NamedOnlyCopy />
      <NamedOnlyFlag hasDefault={hasSyntheticDefault} />
    </NamedOnlyCardView>
  )
}
