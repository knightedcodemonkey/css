import { reactJsx } from '@knighted/jsx/react'
import { createRoot, type Root } from 'react-dom/client'
import { LitElement, css, html, unsafeCSS } from 'lit'
import { asKnightedCssCombinedModule } from '@knighted/css/loader-helpers'

import * as bridgeModule from './bridge-card.js?knighted-css&combined'
import * as transitiveModule from './bridge-transitive-card.js?knighted-css&combined'
import { BRIDGE_HOST_TAG, BRIDGE_MARKER_TEST_ID } from './constants.js'

const { BridgeCard, knightedCss } =
  asKnightedCssCombinedModule<typeof import('./bridge-card.js')>(bridgeModule)
const { BridgeTransitiveCard, knightedCss: transitiveCss } =
  asKnightedCssCombinedModule<typeof import('./bridge-transitive-card.js')>(
    transitiveModule,
  )
const hostShell = css`
  :host {
    display: block;
    padding: 1.5rem;
    border-radius: 1.25rem;
    background: #0b1120;
    box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.2);
  }
`

export class BridgeHost extends LitElement {
  static styles = [hostShell, unsafeCSS(knightedCss), unsafeCSS(transitiveCss)]
  #reactRoot?: Root

  firstUpdated(): void {
    this.#mountReact()
  }

  disconnectedCallback(): void {
    this.#reactRoot?.unmount()
    super.disconnectedCallback()
  }

  #mountReact(): void {
    if (!this.#reactRoot) {
      const outlet = this.renderRoot.querySelector(
        '[data-react-root]',
      ) as HTMLDivElement | null
      if (!outlet) return
      this.#reactRoot = createRoot(outlet)
    }
    this.#renderReactTree()
  }

  #renderReactTree(): void {
    if (!this.#reactRoot) return
    this.#reactRoot.render(reactJsx`
      <section data-section="bridge-shadow-content">
        <${BridgeCard} location="shadow" />
        <${BridgeTransitiveCard} location="shadow" />
      </section>
    `)
  }

  render() {
    return html`<div data-react-root></div>
      <span
        data-testid=${BRIDGE_MARKER_TEST_ID}
        data-css-length=${knightedCss.length}
      ></span>`
  }
}

export function ensureBridgeHostDefined(): void {
  if (!customElements.get(BRIDGE_HOST_TAG)) {
    customElements.define(BRIDGE_HOST_TAG, BridgeHost)
  }
}
