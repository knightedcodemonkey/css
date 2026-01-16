import './styles.module.css'
import stableSelectors from './styles.module.css.knighted-css.js'
import { AUTO_STABLE_SHADOW_TEST_ID, AUTO_STABLE_TOKEN_TEST_ID } from './constants.js'

export function ShadowTree() {
  return (
    <article className={stableSelectors.card} data-testid={AUTO_STABLE_SHADOW_TEST_ID}>
      <div className={stableSelectors.stack}>
        <span className={stableSelectors.badge}>Shadow DOM</span>
        <h2 className={stableSelectors.title}>Auto-stable selectors</h2>
        <p className={stableSelectors.copy}>
          The Lit host renders a React tree that uses stable selectors generated
          automatically from the shared CSS Modules file.
        </p>
        <code className={stableSelectors.token} data-testid={AUTO_STABLE_TOKEN_TEST_ID}>
          {stableSelectors.card}
        </code>
      </div>
    </article>
  )
}
