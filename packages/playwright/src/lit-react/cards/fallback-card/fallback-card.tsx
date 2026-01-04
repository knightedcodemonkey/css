import type { KnightedCssStableSelectors } from './fallback-card.css.knighted-css.js'
import stableSelectors from './fallback-card.css.knighted-css.js'
import fallbackCardCss from './fallback-card.css?knighted-css'

export const FALLBACK_CARD_TEST_ID = 'dialect-fallback-oxc'

export { fallbackCardCss }

export function FallbackCard() {
  const runtimeSelectors = stableSelectors as Readonly<KnightedCssStableSelectors>
  return (
    <section
      className={runtimeSelectors['fallback-card']}
      data-testid={FALLBACK_CARD_TEST_ID}
    >
      <span className={runtimeSelectors['fallback-card__badge']}>OXC fallback</span>
      <p className={runtimeSelectors['fallback-card__copy']}>
        This card exists to hit the oxc-parser fallback during selector type generation on
        a TSX module.
      </p>
      <code
        className={runtimeSelectors['fallback-card__token']}
        data-testid="fallback-stable-shell"
      >
        <span>stable selector:</span>
        <span>{runtimeSelectors['fallback-card']}</span>
      </code>
    </section>
  )
}
