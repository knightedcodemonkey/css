import { reactJsx } from '@knighted/jsx/react'
import { createRoot, type Root } from 'react-dom/client'
import { LitElement, html, unsafeCSS, type PropertyValues } from 'lit'

import { Button } from './button.js'
import { knightedCss as reactStyles } from './button.js?knighted-css'
import { BUTTON_WRAPPER_TAG } from './constants.js'

export class ButtonWrapper extends LitElement {
  static styles = [unsafeCSS(reactStyles)]
  static properties = {
    ctaLabel: { type: String, attribute: 'cta-label' },
  }

  /**
   * Lit installs reactive accessors for declared properties, and TypeScript only knows about
   * them if we declare the property manually. Avoid class field initializers here or they will
   * shadow Lit's accessors and prevent attr -> prop updates (see Lit warning).
   */
  declare ctaLabel: string
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
    const label = this.ctaLabel ?? 'React Button'
    this.#reactRoot.render(reactJsx`<${Button} label=${label} />`)
  }

  protected updated(changed: PropertyValues<this>): void {
    super.updated(changed)
    if (changed.has('ctaLabel')) {
      this.#renderReactTree()
    }
  }

  render() {
    return html`<div data-react-root></div>`
  }
}

export function ensureButtonWrapperDefined(): void {
  if (!customElements.get(BUTTON_WRAPPER_TAG)) {
    customElements.define(BUTTON_WRAPPER_TAG, ButtonWrapper)
  }
}
