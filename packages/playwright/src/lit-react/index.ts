import { BUTTON_WRAPPER_TAG, LIT_REACT_TEST_ID } from './constants.js'
import { ensureButtonWrapperDefined } from './button-wrapper.js'

export function renderLitReactDemo(root: HTMLElement): void {
  ensureButtonWrapperDefined()
  const host = document.createElement(BUTTON_WRAPPER_TAG)
  host.dataset.testid = LIT_REACT_TEST_ID
  root.appendChild(host)
}

export { LIT_REACT_TEST_ID }
