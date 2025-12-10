import Basic, { className as basicClass } from './dialects/basic.js'

import { knightedCss as basicCss } from './dialects/basic.js?knighted-css'

import Scss, { className as scssClass } from './dialects/scss.js'
import { knightedCss as scssCss } from './dialects/scss.js?knighted-css'

import SassIndented, { className as sassIndentedClass } from './dialects/sass-indented.js'
import { knightedCss as sassIndentedCss } from './dialects/sass-indented.js?knighted-css'

import LessComp, { className as lessClass } from './dialects/less.js'
import { knightedCss as lessCss } from './dialects/less.js?knighted-css'

import VanillaComp, {
  className as vanillaClass,
  badgeClass,
  tokenClass,
} from './dialects/vanilla.js'
import { knightedCss as vanillaCss } from './dialects/vanilla.css.js?knighted-css'

const dialects = [
  { label: Basic(), className: basicClass, css: basicCss, testId: 'dialect-basic' },
  { label: Scss(), className: scssClass, css: scssCss, testId: 'dialect-scss' },
  {
    label: SassIndented(),
    className: sassIndentedClass,
    css: sassIndentedCss,
    testId: 'dialect-sass-indented',
  },
  { label: LessComp(), className: lessClass, css: lessCss, testId: 'dialect-less' },
  {
    label: VanillaComp(),
    className: `${vanillaClass} ${badgeClass} ${tokenClass}`,
    css: vanillaCss,
    testId: 'dialect-vanilla',
  },
]

function injectStyles() {
  const combined = dialects.map(d => d.css).join('\n')
  const style = document.createElement('style')
  style.textContent = combined
  document.head.append(style)
}

function render() {
  const root = document.getElementById('app') ?? document.body
  injectStyles()
  for (const dialect of dialects) {
    const el = document.createElement('div')
    el.dataset.testid = dialect.testId
    el.className = dialect.className
    el.textContent = dialect.label
    root.appendChild(el)
  }
}

if (typeof document !== 'undefined') {
  render()
}

export { render }
