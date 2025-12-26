import './nested-combined-entry.css'

export const NESTED_COMBINED_TEST_ID = 'dialect-nested-combined'

export function NestedCombinedBadge() {
  return <span className="nested-entry__badge">Nested combined loader</span>
}

export function NestedCombinedDetails() {
  return (
    <p className="nested-details" data-testid="nested-combined-details">
      The Lit host lives one directory above this entry module, mirroring the css-jsx-app
      structure that once broke `?knighted-css&combined` relative imports.
    </p>
  )
}

export default function NestedCombinedEntry() {
  return (
    <header className="nested-entry" data-testid="nested-combined-entry">
      <p className="nested-entry__subtitle">Parent + Child dirs</p>
      <strong>Nested combined example</strong>
      <NestedCombinedBadge />
    </header>
  )
}
