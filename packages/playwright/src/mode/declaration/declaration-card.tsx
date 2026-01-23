import '../mode.css'

type DeclarationCardProps = {
  label: string
  testId: string
}

export function DeclarationCard({ label, testId }: DeclarationCardProps) {
  return (
    <article className="knighted-mode-declaration-card" data-testid={testId}>
      <h2 className="knighted-mode-declaration-card__title">Declaration mode</h2>
      <p className="knighted-mode-declaration-card__copy">{label}</p>
    </article>
  )
}
