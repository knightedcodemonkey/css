import { Button } from './button.js'
import { knightedCss as reactStyles } from './button.js?knighted-css'
import {
  Button as CombinedButton,
  knightedCss as combinedCss,
} from './button.js?knighted-css&combined'
import { Text } from './text.js'
import { knightedCss as textStyles } from './text.js?knighted-css'

export { Button, reactStyles, Text, textStyles, CombinedButton, combinedCss }

export function renderDemo() {
  if (typeof document === 'undefined') return
  const style = document.createElement('style')
  style.textContent = `${reactStyles}\n${textStyles}`
  document.head.append(style)

  const root = document.getElementById('app') ?? document.body
  const el = document.createElement('div')
  el.className = 'rspack-loader-style'
  el.textContent = Button()
  root.appendChild(el)

  const textEl = document.createElement('div')
  textEl.className = 'text body emphasis'
  textEl.textContent = Text()
  root.appendChild(textEl)

  const combinedEl = document.createElement('div')
  combinedEl.className = 'combined-entry'
  combinedEl.textContent = CombinedButton()
  root.appendChild(combinedEl)
}

if (typeof window !== 'undefined') {
  renderDemo()
}
