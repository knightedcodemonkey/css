import '../mode.css'

type StrictCardProps = {
  label: string
  testId: string
}

export function StrictOkCard({ label, testId }: StrictCardProps) {
  return (
    <article className="knighted-mode-declaration-card" data-testid={testId}>
      <h2 className="knighted-mode-declaration-card__title">
        Declaration strict (manifest)
      </h2>
      <p className="knighted-mode-declaration-card__copy">{label}</p>
    </article>
  )
}
