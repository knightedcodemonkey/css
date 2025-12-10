import './button.css'
import { Badge } from './badge.js'

type ButtonProps = {
  label: string
}

export function Button({ label }: ButtonProps) {
  return (
    <button className="readme-button">
      <span className="readme-button-label" data-testid="react-button-label">
        {label}
      </span>
      <Badge label="Synced Styles" />
    </button>
  )
}
