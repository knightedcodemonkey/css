import { reactJsx } from '@knighted/jsx/react'
import { createRoot, type Root } from 'react-dom/client'
import { LitElement, css, html, unsafeCSS } from 'lit'

import {
  DeclarationHashedCard,
  knightedCss as declarationHashedCss,
} from './declaration-hashed-card.js'
import {
  MODE_DECL_HASHED_HOST_TAG,
  MODE_DECL_HASHED_SHADOW_TEST_ID,
} from '../constants.js'

const hostShell = css`
  :host {
    display: block;
    padding: 1.5rem;
    border-radius: 1.5rem;
    background: rgb(15, 23, 42);
    box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.2);
  }
`

export class ModeDeclarationHashedHost extends LitElement {
  static styles = [hostShell, unsafeCSS(declarationHashedCss)]
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
    this.#reactRoot.render(
      reactJsx`<${DeclarationHashedCard} label="Shadow DOM" testId=${MODE_DECL_HASHED_SHADOW_TEST_ID} />`,
    )
  }

  render() {
    return html`<div data-react-root></div>`
  }
}

export function ensureModeDeclarationHashedHostDefined(): void {
  if (!customElements.get(MODE_DECL_HASHED_HOST_TAG)) {
    customElements.define(MODE_DECL_HASHED_HOST_TAG, ModeDeclarationHashedHost)
  }
}
