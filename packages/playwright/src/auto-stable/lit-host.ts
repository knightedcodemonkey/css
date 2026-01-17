import { reactJsx } from '@knighted/jsx/react'
import { asKnightedCssCombinedModule } from '@knighted/css/loader-helpers'
import { createRoot, type Root } from 'react-dom/client'
import { LitElement, css, html, unsafeCSS, type PropertyValues } from 'lit'

import * as shadowTree from './shadow-tree.js?knighted-css&combined&named-only&stable'
import { AUTO_STABLE_HOST_TAG } from './constants.js'

const {
  ShadowTree,
  knightedCss: shadowTreeCss,
  stableSelectors,
} = asKnightedCssCombinedModule<
  typeof import('./shadow-tree.js'),
  { stableSelectors: typeof shadowTree.stableSelectors }
>(shadowTree)
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
    this.#reactRoot.render(reactJsx`<${ShadowTree} stableSelectors=${stableSelectors} />`)
  }

  protected updated(changed: PropertyValues<this>): void {
    super.updated(changed)
  }

  render() {
    return html`<div data-react-root></div>`
  }
}

export function ensureAutoStableHostDefined(): void {
  if (!customElements.get(AUTO_STABLE_HOST_TAG)) {
    customElements.define(AUTO_STABLE_HOST_TAG, AutoStableHost)
  }
}
