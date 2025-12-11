import './less-card.less'

import { WEBPACK_LESS_TEST_ID } from '../constants.js'

export function LessCard() {
  return (
    <article className="webpack-card less-card" data-testid={WEBPACK_LESS_TEST_ID}>
      <h3>Less Module</h3>
      <p>Variables, gradients, and badges authored right beside the component.</p>
      <span className="less-badge" data-testid="less-badge">
        Less powered styles
      </span>
    </article>
  )
}
