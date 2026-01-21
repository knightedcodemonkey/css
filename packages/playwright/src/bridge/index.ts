import { reactJsx } from '@knighted/jsx/react'
import { createRoot } from 'react-dom/client'

import { BridgeCard } from './bridge-card.js'
import { BridgeTransitiveCard } from './bridge-transitive-card.js'
import { BRIDGE_HOST_TAG, BRIDGE_HOST_TEST_ID } from './constants.js'
import { BridgeHost, ensureBridgeHostDefined } from './lit-host.js'

export function renderBridgeDemo(root: HTMLElement): void {
  ensureBridgeHostDefined()
  const mountPoint = root

  const lightMount = document.createElement('section')
  lightMount.setAttribute('data-section', 'bridge-light')
  mountPoint.appendChild(lightMount)

  createRoot(lightMount).render(reactJsx`
    <section data-section="bridge-light-content">
      <${BridgeCard} location="light" />
      <${BridgeTransitiveCard} location="light" />
    </section>
  `)

  const host = document.createElement(BRIDGE_HOST_TAG) as BridgeHost
  host.dataset.testid = BRIDGE_HOST_TEST_ID
  mountPoint.appendChild(host)
}
