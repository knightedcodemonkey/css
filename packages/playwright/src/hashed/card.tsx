import styles from './styles.module.css'

type HashedCardProps = {
  label: string
  testId: string
}

export function HashedCard({ label, testId }: HashedCardProps) {
  return (
    <article className={styles.card} data-testid={testId}>
      <div className={styles.stack}>
        <span className={styles.badge}>{label}</span>
        <h2 className={styles.title}>Hashed selectors</h2>
        <p className={styles.copy}>
          The same component renders in light and shadow DOM using hashed CSS module class
          names.
        </p>
      </div>
    </article>
  )
}
