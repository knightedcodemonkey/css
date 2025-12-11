import './sass-card.scss'

import { WEBPACK_SASS_TEST_ID } from '../constants.js'

export function SassCard() {
  return (
    <article className="webpack-card sass-card" data-testid={WEBPACK_SASS_TEST_ID}>
      <h3>Sass Reactor</h3>
      <p>Nested selectors and design tokens rendered through @knighted/css.</p>
      <span className="sass-chip" data-testid="sass-chip">
        Sass + lightningcss
      </span>
    </article>
  )
}
