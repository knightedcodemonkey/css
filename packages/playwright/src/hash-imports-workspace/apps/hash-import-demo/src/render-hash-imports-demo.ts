import { HASH_IMPORTS_SECTION_ID } from '../../../constants.js'
import { createWorkspaceCard } from '#workspace/ui/workspace-card.js'
import { knightedCss as workspaceCardCss } from '#workspace/ui/workspace-card.js?knighted-css'
import stableSelectors from '#workspace/ui/hash-imports.css.knighted-css.js'

export function renderHashImportsWorkspaceDemo(root: HTMLElement): void {
  const mount = root ?? document.body
  const section = document.createElement('section')
  section.dataset.testid = HASH_IMPORTS_SECTION_ID
  section.className = 'hash-imports-workspace-section'
  section.setAttribute('aria-label', 'Hash imports workspace fixture')

  const intro = document.createElement('p')
  intro.className = 'hash-imports-card__copy'
  if (stableSelectors.demo) {
    intro.classList.add(stableSelectors.demo)
  }
  intro.textContent =
    '#workspace/ui/* specifiers resolve automatically because the loader passes tsconfig: auto to oxc-resolver. The npm workspace wiring mirrors how downstream apps map UI packages via package.json#imports without custom resolver code.'

  const style = document.createElement('style')
  style.textContent = workspaceCardCss
  section.append(style, intro, createWorkspaceCard())

  mount.appendChild(section)
}
