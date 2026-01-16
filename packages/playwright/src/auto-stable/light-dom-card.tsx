import * as styles from './styles.module.css'
import { AUTO_STABLE_LIGHT_TEST_ID } from './constants.js'

export function LightDomCard() {
  return (
    <article className={styles.card} data-testid={AUTO_STABLE_LIGHT_TEST_ID}>
      <div className={styles.stack}>
        <span className={styles.badge}>Light DOM</span>
        <h2 className={styles.title}>CSS Modules hashing</h2>
        <p className={styles.copy}>
          The Light DOM component consumes shared class names that get hashed by the CSS
          Modules pipeline.
        </p>
      </div>
    </article>
  )
}
