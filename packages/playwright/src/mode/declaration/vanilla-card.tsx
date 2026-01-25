import '../mode.css'
import { vanillaCardClass } from './vanilla-card.css.js'

type DeclarationVanillaCardProps = {
  label: string
  testId: string
}

export function DeclarationVanillaCard({ label, testId }: DeclarationVanillaCardProps) {
  return (
    <article
      className={`knighted-mode-declaration-card ${vanillaCardClass}`}
      data-testid={testId}
    >
      <h2 className="knighted-mode-declaration-card__title">
        Declaration vanilla-extract
      </h2>
      <p className="knighted-mode-declaration-card__copy">{label}</p>
    </article>
  )
}
