import { mergeStableClass, stableClass } from '@knighted/css/stableSelectors'

import styles from './styles.module.css'

type DeclarationStableCardProps = {
  label: string
  testId: string
}

export const stableSelectors = {
  badge: stableClass('badge'),
  card: stableClass('card'),
  copy: stableClass('copy'),
  stack: stableClass('stack'),
  title: stableClass('title'),
} as const

const mergedSelectors = mergeStableClass({ hashed: styles, selectors: stableSelectors })

export function DeclarationStableCard({ label, testId }: DeclarationStableCardProps) {
  return (
    <article className={mergedSelectors.card} data-testid={testId}>
      <div className={mergedSelectors.stack}>
        <span className={mergedSelectors.badge}>{label}</span>
        <h2 className={mergedSelectors.title}>Declaration stable selectors</h2>
        <p className={mergedSelectors.copy}>
          Auto-stable selectors keep hashed class names paired with deterministic tokens.
        </p>
      </div>
    </article>
  )
}
