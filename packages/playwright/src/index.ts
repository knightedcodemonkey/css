import { dialects } from './dialects/registry.js'
import { renderLitReactDemo } from './lit-react/index.js'

function render() {
  const root = document.getElementById('app') ?? document.body
  renderLitReactDemo(root, dialects)
  return root
}

if (typeof document !== 'undefined') {
  render()
}

export { dialects, render }
