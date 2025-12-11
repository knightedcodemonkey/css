import { ensureWebpackBridgeDefined } from './lit-host.js'
import { WEBPACK_HOST_TAG, WEBPACK_LIT_REACT_TEST_ID } from './constants.js'

function renderWebpackLitReactDemo(): HTMLElement {
  ensureWebpackBridgeDefined()
  const mountRoot = document.getElementById('webpack-app') ?? document.body
  const host = document.createElement(WEBPACK_HOST_TAG)
  host.setAttribute('data-testid', WEBPACK_LIT_REACT_TEST_ID)
  mountRoot.appendChild(host)
  return host
}

if (typeof document !== 'undefined') {
  renderWebpackLitReactDemo()
}
