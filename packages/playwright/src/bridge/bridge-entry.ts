import { renderBridgeDemo } from './index.js'

if (typeof document !== 'undefined') {
  const root = document.getElementById('bridge-app') ?? document.body
  renderBridgeDemo(root)
}
