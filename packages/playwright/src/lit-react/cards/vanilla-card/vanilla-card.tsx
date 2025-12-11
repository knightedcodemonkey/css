import {
  vanillaBadgeClass,
  vanillaCardClass,
  vanillaTokenClass,
} from './vanilla-card.css.js'

export const VANILLA_TEST_ID = 'dialect-vanilla'

export function VanillaCard() {
  return (
    <span
      className={`${vanillaCardClass} ${vanillaBadgeClass} ${vanillaTokenClass}`}
      data-testid={VANILLA_TEST_ID}
    >
      Vanilla Extract sprinkles inline spacing + tokens.
    </span>
  )
}
