import './badge.css'

type BadgeProps = {
  label: string
}

export function Badge({ label }: BadgeProps) {
  return (
    <span className="readme-badge" data-testid="readme-badge">
      <span className="readme-badge-dot" aria-hidden="true" />
      {label}
    </span>
  )
}
