import { Button } from './button.js'
import { knightedCss as reactStyles } from './button.js?knighted-css'

export { Button, reactStyles }

export function renderDemo() {
  if (typeof document === 'undefined') return
  const style = document.createElement('style')
  style.textContent = reactStyles
  document.head.append(style)

  const root = document.getElementById('app') ?? document.body
  const el = document.createElement('div')
  el.className = 'rspack-loader-style'
  el.textContent = Button()
  root.appendChild(el)
}

if (typeof window !== 'undefined') {
  renderDemo()
}
