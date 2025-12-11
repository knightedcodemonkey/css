import type { DialectSample } from '../dialects/registry.js'
import { BUTTON_WRAPPER_TAG, LIT_REACT_TEST_ID } from './constants.js'
import { ButtonWrapper, ensureButtonWrapperDefined } from './button-wrapper.js'

export function renderLitReactDemo(root: HTMLElement, dialects: DialectSample[]): void {
  ensureButtonWrapperDefined()
  const mountPoint = root ?? document.body
  const host = document.createElement(BUTTON_WRAPPER_TAG) as ButtonWrapper
  host.dataset.testid = LIT_REACT_TEST_ID
  host.setAttribute('cta-label', 'Launch CSS Build')
  host.setDialects(dialects)
  mountPoint.appendChild(host)
}

export { LIT_REACT_TEST_ID }
