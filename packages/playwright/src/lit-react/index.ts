import { LIT_HOST_TAG, LIT_REACT_TEST_ID } from './constants.js'
import { LitHost, ensureLitHostDefined } from './lit-host.js'

export function renderLitReactDemo(root: HTMLElement): void {
  ensureLitHostDefined()
  const mountPoint = root ?? document.body
  const host = document.createElement(LIT_HOST_TAG) as LitHost
  host.dataset.testid = LIT_REACT_TEST_ID
  host.setAttribute('cta-label', 'Launch CSS Build')
  mountPoint.appendChild(host)
}

export { LIT_REACT_TEST_ID }
