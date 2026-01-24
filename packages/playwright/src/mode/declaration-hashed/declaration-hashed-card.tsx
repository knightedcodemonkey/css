import styles from './styles.module.css'

type DeclarationHashedCardProps = {
  label: string
  testId: string
}

export const selectors = styles

export function DeclarationHashedCard({ label, testId }: DeclarationHashedCardProps) {
  return (
    <article className={styles.card} data-testid={testId}>
      <div className={styles.stack}>
        <span className={styles.badge}>{label}</span>
        <h2 className={styles.title}>Declaration hashed selectors</h2>
        <p className={styles.copy}>
          The declaration-hashed module exports CSS module selectors for hashed class
          names.
        </p>
      </div>
    </article>
  )
}
