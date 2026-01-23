import { reactJsx } from '@knighted/jsx/react'
import { createRoot } from 'react-dom/client'

import { HashedCard } from './card.js'
import { ensureHashedHostDefined } from './lit-host.js'
import {
  HASHED_HOST_TAG,
  HASHED_HOST_TEST_ID,
  HASHED_LIGHT_TEST_ID,
} from './constants.js'

export function renderHashedDemo(): HTMLElement {
  const root = document.getElementById('hashed-app') ?? document.body

  const lightMount = document.createElement('section')
  lightMount.setAttribute('data-section', 'hashed-light')
  root.appendChild(lightMount)

  createRoot(lightMount).render(
    reactJsx`<${HashedCard} label="Light DOM" testId=${HASHED_LIGHT_TEST_ID} />`,
  )

  ensureHashedHostDefined()
  const host = document.createElement(HASHED_HOST_TAG)
  host.setAttribute('data-testid', HASHED_HOST_TEST_ID)
  root.appendChild(host)

  return root
}

if (typeof document !== 'undefined') {
  renderHashedDemo()
}
