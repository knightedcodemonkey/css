import './scss-card.scss'

export const SCSS_TEST_ID = 'dialect-scss'

export function ScssCard() {
  return (
    <span className="pw-scss" data-testid={SCSS_TEST_ID}>
      <span className="nested">SCSS nesting keeps typography bold.</span>
    </span>
  )
}
