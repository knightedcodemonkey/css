import { renderLitReactDemo } from './lit-react/index.js'

function render() {
  const root = document.getElementById('app') ?? document.body
  renderLitReactDemo(root)
  return root
}

if (typeof document !== 'undefined') {
  render()
}

export { render }
