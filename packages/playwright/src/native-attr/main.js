import sheet from './native-attr.css' with { type: 'css' }

// CSS module imports do not auto-apply; wire them into the page.
if (sheet && 'adoptedStyleSheets' in document) {
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
} else if (sheet?.cssRules) {
  const style = document.createElement('style')
  style.textContent = Array.from(sheet.cssRules)
    .map(rule => rule.cssText)
    .join('\n')
  document.head.appendChild(style)
}

const target = document.getElementById('native-attr-target')
if (target) {
  target.textContent = ''
  target.classList.add('native-attr-chip')
}
