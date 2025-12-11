import { reactJsx } from '@knighted/jsx/react'
import { createRoot, type Root } from 'react-dom/client'
import { LitElement, html, unsafeCSS, type PropertyValues } from 'lit'

import { WEBPACK_HOST_TAG } from './constants.js'
import { WebpackShowcase } from './showcase.js'
import { knightedCss as showcaseCss } from './showcase.js?knighted-css'

export class WebpackReactBridge extends LitElement {
  static styles = [unsafeCSS(showcaseCss)]
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
    this.#reactRoot.render(reactJsx`<${WebpackShowcase} />`)
  }

  protected updated(changed: PropertyValues<this>): void {
    super.updated(changed)
    if (changed.size > 0) {
      this.#renderReactTree()
    }
  }

  render() {
    return html`<div data-react-root></div>`
  }
}

export function ensureWebpackBridgeDefined(): void {
  if (!customElements.get(WEBPACK_HOST_TAG)) {
    customElements.define(WEBPACK_HOST_TAG, WebpackReactBridge)
  }
}
