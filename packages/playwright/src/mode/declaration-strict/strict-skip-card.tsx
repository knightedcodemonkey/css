import '../mode.css'

type StrictCardProps = {
  label: string
  testId: string
}

export function StrictSkipCard({ label, testId }: StrictCardProps) {
  return (
    <article className="knighted-mode-declaration-card" data-testid={testId}>
      <h2 className="knighted-mode-declaration-card__title">Declaration strict (skip)</h2>
      <p className="knighted-mode-declaration-card__copy">{label}</p>
    </article>
  )
}
