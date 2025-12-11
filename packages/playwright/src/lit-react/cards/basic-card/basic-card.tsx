import './basic-card.css'

export const BASIC_TEST_ID = 'dialect-basic'

export function BasicCard() {
  return (
    <span className="pw-basic" data-testid={BASIC_TEST_ID}>
      Native CSS module
    </span>
  )
}
