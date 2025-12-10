import { reactJsx } from '@knighted/jsx/react'
import { createRoot, type Root } from 'react-dom/client'
import { LitElement, html, unsafeCSS } from 'lit'

import { Button } from './button.js'
import { knightedCss as reactStyles } from './button.js?knighted-css'
import { BUTTON_WRAPPER_TAG } from './constants.js'

export class ButtonWrapper extends LitElement {
  static styles = [unsafeCSS(reactStyles)]
  #reactRoot?: Root

  firstUpdated(): void {
    this.#mountReact()
  }

  disconnectedCallback(): void {
    this.#reactRoot?.unmount()
    super.disconnectedCallback()
  }

  #mountReact(): void {
    if (this.#reactRoot) return
    const outlet = this.renderRoot.querySelector(
      '[data-react-root]',
    ) as HTMLDivElement | null
    if (!outlet) return
    this.#reactRoot = createRoot(outlet)
    this.#reactRoot.render(reactJsx`<${Button} />`)
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
