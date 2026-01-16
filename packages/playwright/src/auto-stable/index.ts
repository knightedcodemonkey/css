import { reactJsx } from '@knighted/jsx/react'
import { createRoot } from 'react-dom/client'

import { LightDomCard } from './light-dom-card.js'
import { ensureAutoStableHostDefined } from './lit-host.js'
import { AUTO_STABLE_HOST_TAG, AUTO_STABLE_HOST_TEST_ID } from './constants.js'

export function renderAutoStableDemo(): HTMLElement {
  const root = document.getElementById('auto-stable-app') ?? document.body

  const lightMount = document.createElement('section')
  lightMount.setAttribute('data-section', 'auto-stable-light')
  root.appendChild(lightMount)

  createRoot(lightMount).render(reactJsx`<${LightDomCard} />`)

  ensureAutoStableHostDefined()
  const host = document.createElement(AUTO_STABLE_HOST_TAG)
  host.setAttribute('data-testid', AUTO_STABLE_HOST_TEST_ID)
  root.appendChild(host)

  return root
}

if (typeof document !== 'undefined') {
  renderAutoStableDemo()
}
