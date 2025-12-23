import { renderLitReactDemo } from './lit-react/index.js'
import { renderHashImportsWorkspaceDemo } from './hash-imports-workspace/apps/hash-import-demo/src/render-hash-imports-demo.js'

function render() {
  const root = document.getElementById('app') ?? document.body
  renderLitReactDemo(root)
  renderHashImportsWorkspaceDemo(root)
  return root
}

if (typeof document !== 'undefined') {
  render()
}

export { render }
