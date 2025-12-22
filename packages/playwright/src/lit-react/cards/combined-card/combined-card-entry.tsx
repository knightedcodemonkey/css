import './combined-card-entry.css'

export const COMBINED_CARD_TEST_ID = 'dialect-combined'

export function CombinedCardBadge() {
  return <span className="combined-entry__badge">Combined loader</span>
}

export function CombinedCardDetails() {
  return (
    <p className="combined-details" data-testid="combined-card-details">
      The <code>?knighted-css&combined</code> query packages this component tree and its
      CSS into a single payload so the Lit host can mount it like any other card.
    </p>
  )
}

export default function CombinedCardEntry() {
  return (
    <header className="combined-entry" data-testid="combined-card-entry">
      <p className="combined-entry__subtitle">React + Lit</p>
      <strong>Shared demo entry</strong>
      <CombinedCardBadge />
    </header>
  )
}
