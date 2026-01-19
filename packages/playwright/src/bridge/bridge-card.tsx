import styles from './styles.module.css'
import { BRIDGE_CARD_TEST_ID } from './constants.js'

type BridgeCardProps = {
  location: 'light' | 'shadow'
}

export function BridgeCard({ location }: BridgeCardProps) {
  const locationLabel = location === 'shadow' ? 'Shadow DOM' : 'Light DOM'
  return (
    <article className={styles.card} data-testid={BRIDGE_CARD_TEST_ID}>
      <h2 className={styles.title}>Loader bridge</h2>
      <p className={styles.copy}>
        {locationLabel} styling using existing CSS module class names.
      </p>
    </article>
  )
}
