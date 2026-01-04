import './combined-types-card-entry.css'

import type { KnightedCssStableSelectors as CombinedTypesStableSelectors } from './combined-types-card-entry.css.knighted-css.js'
import stableSelectors from './combined-types-card-entry.css.knighted-css.js'

export const COMBINED_TYPES_TEST_ID = 'dialect-combined-types'

type CombinedTypesCardEntryProps = {
  runtimeSelectors: Readonly<Record<keyof CombinedTypesStableSelectors, string>>
}

export default function CombinedTypesCardEntry({
  runtimeSelectors,
}: CombinedTypesCardEntryProps) {
  const shellClass = [
    'combined-types-card',
    stableSelectors['combined-types-shell'],
  ].join(' ')

  return (
    <section
      className={shellClass}
      data-testid={COMBINED_TYPES_TEST_ID}
      data-runtime-shell={runtimeSelectors['combined-types-shell']}
      data-runtime-copy={runtimeSelectors['combined-types-copy']}
    >
      <span
        className={[
          stableSelectors['combined-types-badge'],
          'combined-types-card__badge',
        ].join(' ')}
      >
        Combined &amp; types
      </span>
      <p
        className={[
          stableSelectors['combined-types-copy'],
          'combined-types-card__copy',
        ].join(' ')}
      >
        This card imports <code>?knighted-css&combined&types</code>, so the Lit host
        receives the module exports, the compiled CSS, and the runtime{' '}
        <code>stableSelectors</code> map from a single request.
      </p>
      <footer
        className={[
          stableSelectors['combined-types-footer'],
          'combined-types-card__footer',
        ].join(' ')}
      >
        Runtime selector shell:{' '}
        <output data-testid="combined-types-runtime-shell">
          {runtimeSelectors['combined-types-shell']}
        </output>
      </footer>
    </section>
  )
}
