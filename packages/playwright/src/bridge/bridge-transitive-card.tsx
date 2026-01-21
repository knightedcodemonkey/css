import styles from './transitive/base.module.css'
import { BRIDGE_TRANSITIVE_TEST_ID } from './constants.js'

type BridgeTransitiveCardProps = {
  location: 'light' | 'shadow'
}

export function BridgeTransitiveCard({ location }: BridgeTransitiveCardProps) {
  const locationLabel = location === 'shadow' ? 'Shadow DOM' : 'Light DOM'
  return (
    <article
      className={`${styles.card} bridge-transitive`}
      data-testid={BRIDGE_TRANSITIVE_TEST_ID}
    >
      <h2 className={styles.title}>Transitive styles</h2>
      <p className={styles.copy}>
        {locationLabel} styles from nested @import dependencies.
      </p>
    </article>
  )
}
