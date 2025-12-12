import './stable-selectors-card.scss'

import * as styles from './stable-selectors-card.module.css'
import { stableClass, stableClassName } from '@knighted/css/stableSelectors'

export const STABLE_SELECTORS_TEST_ID = 'dialect-stable-selectors'

export function StableSelectorsCard() {
  const shellClass = [
    stableClassName(styles, 'cardShell', { token: 'stable-card' }),
    stableClass('layer-glow'),
  ].join(' ')

  return (
    <div className={shellClass} data-testid={STABLE_SELECTORS_TEST_ID}>
      <span className={stableClassName(styles, 'cardChip', { token: 'stable-chip' })}>
        Stable selectors
      </span>
      <p className={stableClassName(styles, 'cardCopy', { token: 'stable-body' })}>
        Hash-stable class names ride alongside hashed CSS modules so the `?knighted-css`
        build can keep Lit-hosted styles in sync.
      </p>
    </div>
  )
}
