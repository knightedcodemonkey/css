import '../mode.css'

type ModuleCardProps = {
  label: string
  testId: string
}

export function ModuleCard({ label, testId }: ModuleCardProps) {
  return (
    <article className="knighted-mode-module-card" data-testid={testId}>
      <h2 className="knighted-mode-module-card__title">Module mode</h2>
      <p className="knighted-mode-module-card__copy">{label}</p>
    </article>
  )
}
