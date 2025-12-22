import type { PropsWithChildren } from 'react'

import './named-only-card-entry.css'

export const NAMED_ONLY_TEST_ID = 'dialect-named-only'

type NamedOnlyCardViewProps = PropsWithChildren<{ hasDefault?: boolean }>

export function NamedOnlyCardView({
  children,
  hasDefault = false,
}: NamedOnlyCardViewProps) {
  return (
    <section
      className="named-only-card"
      data-testid={NAMED_ONLY_TEST_ID}
      data-has-default={String(hasDefault)}
    >
      {children}
    </section>
  )
}

export function NamedOnlyCardBadge() {
  return <span className="named-only-card__badge">Named exports</span>
}

export const namedOnlyCopy =
  'Append &named-only to drop the synthetic default export when combining module exports with the compiled CSS string.'

export function NamedOnlyCopy() {
  return <p className="named-only-card__copy">{namedOnlyCopy}</p>
}

export function NamedOnlyFlag({ hasDefault }: { hasDefault: boolean }) {
  return (
    <p className="named-only-card__flag" data-testid="named-only-default-flag">
      Synthetic default present: <strong>{hasDefault ? 'yes' : 'no'}</strong>
    </p>
  )
}
