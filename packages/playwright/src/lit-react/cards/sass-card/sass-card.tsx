import './sass-card.sass'

export const SASS_TEST_ID = 'dialect-sass-indented'

export function SassCard() {
  return (
    <span className="pw-sass-indented" data-testid={SASS_TEST_ID}>
      Sass indented syntax keeps the badge compact.
    </span>
  )
}
