import { WEBPACK_VANILLA_TEST_ID } from '../constants.js'
import {
  vanillaAccentClass,
  vanillaCardClass,
  vanillaHeadingClass,
  vanillaThemeClass,
} from './vanilla-card.css.js'

export function VanillaCard() {
  return (
    <article
      className={`webpack-card ${vanillaThemeClass} ${vanillaCardClass}`}
      data-testid={WEBPACK_VANILLA_TEST_ID}
    >
      <h3 className={vanillaHeadingClass}>Vanilla Extract</h3>
      <p>Compiled through the official webpack plugin + @knighted/css loader.</p>
      <span className={vanillaAccentClass} data-testid="vanilla-accent">
        Typed theme tokens
      </span>
    </article>
  )
}
