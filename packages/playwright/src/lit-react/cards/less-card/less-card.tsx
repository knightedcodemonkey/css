import './less-card.less'

export const LESS_TEST_ID = 'dialect-less'

export function LessCard() {
  return (
    <span className="pw-less" data-testid={LESS_TEST_ID}>
      Less modules wire gradients and badges inline.
    </span>
  )
}
