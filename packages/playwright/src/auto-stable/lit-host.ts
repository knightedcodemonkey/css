import { reactJsx } from '@knighted/jsx/react'
import { createRoot, type Root } from 'react-dom/client'
import { LitElement, css, html, unsafeCSS, type PropertyValues } from 'lit'

import {
  ShadowTree,
  knightedCss as shadowTreeCss,
  stableSelectors,
} from './shadow-tree.knighted-css.js'
import { AUTO_STABLE_HOST_TAG, AUTO_STABLE_PROXY_TEST_ID } from './constants.js'

const hostShell = css`
  :host {
    display: block;
    padding: 1.5rem;
    border-radius: 1.5rem;
    background: #0b1120;
    box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.2);
  }
`

export class AutoStableHost extends LitElement {
  static styles = [hostShell, unsafeCSS(shadowTreeCss)]
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
    this.#reactRoot.render(reactJsx`<${ShadowTree} />`)
  }

  protected updated(changed: PropertyValues<this>): void {
    super.updated(changed)
  }

  render() {
    return html`<div data-react-root></div>
      <span
        data-testid=${AUTO_STABLE_PROXY_TEST_ID}
        data-stable-class=${stableSelectors.card}
        data-css-length=${shadowTreeCss.length}
      ></span>`
  }
}

export function ensureAutoStableHostDefined(): void {
  if (!customElements.get(AUTO_STABLE_HOST_TAG)) {
    customElements.define(AUTO_STABLE_HOST_TAG, AutoStableHost)
  }
}
