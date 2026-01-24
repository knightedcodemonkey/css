import { reactJsx } from '@knighted/jsx/react'
import { createRoot } from 'react-dom/client'
import type { JSX } from 'react'

import { ModuleCard } from './module/module-card.js'
import { DeclarationCard } from './declaration/declaration-card.js'
import {
  DeclarationHashedCard,
  selectors as declarationHashedSelectors,
} from './declaration-hashed/declaration-hashed-card.js'
import {
  DeclarationStableCard,
  stableSelectors as declarationStableSelectors,
} from './declaration-stable/declaration-stable-card.js'
import { StrictOkCard } from './declaration-strict/strict-ok-card.js'
import { StrictSkipCard } from './declaration-strict/strict-skip-card.js'
import {
  MODE_DECL_HOST_TAG,
  MODE_DECL_HOST_TEST_ID,
  MODE_DECL_HASHED_HOST_TAG,
  MODE_DECL_HASHED_HOST_TEST_ID,
  MODE_DECL_LIGHT_TEST_ID,
  MODE_DECL_STABLE_HOST_TAG,
  MODE_DECL_STABLE_HOST_TEST_ID,
  MODE_MODULE_HOST_TAG,
  MODE_MODULE_HOST_TEST_ID,
  MODE_MODULE_LIGHT_TEST_ID,
  MODE_DECL_HASHED_LIGHT_TEST_ID,
  MODE_DECL_HASHED_SELECTOR_TEST_ID,
  MODE_DECL_STABLE_LIGHT_TEST_ID,
  MODE_DECL_STABLE_SELECTOR_TEST_ID,
  MODE_DECL_STRICT_OK_PROBE_TEST_ID,
  MODE_DECL_STRICT_OK_TEST_ID,
  MODE_DECL_STRICT_SKIP_PROBE_TEST_ID,
  MODE_DECL_STRICT_SKIP_TEST_ID,
} from './constants.js'
import { ensureModeModuleHostDefined } from './module/host.js'
import { ensureModeDeclarationHostDefined } from './declaration/host.js'
import { ensureModeDeclarationHashedHostDefined } from './declaration-hashed/host.js'
import { ensureModeDeclarationStableHostDefined } from './declaration-stable/host.js'

function renderSection(
  root: HTMLElement,
  label: string,
  Component: (props: { label: string; testId: string }) => JSX.Element,
  testId: string,
): HTMLElement {
  const section = document.createElement('section')
  section.setAttribute('data-mode', label)
  root.appendChild(section)
  createRoot(section).render(
    reactJsx`<${Component} label="Light DOM" testId=${testId} />`,
  )
  return section
}

export function renderModeDemo(): HTMLElement {
  const root = document.getElementById('mode-app') ?? document.body

  renderSection(root, 'module', ModuleCard, MODE_MODULE_LIGHT_TEST_ID)
  renderSection(root, 'declaration', DeclarationCard, MODE_DECL_LIGHT_TEST_ID)
  renderSection(
    root,
    'declaration-hashed',
    DeclarationHashedCard,
    MODE_DECL_HASHED_LIGHT_TEST_ID,
  )
  renderSection(
    root,
    'declaration-stable',
    DeclarationStableCard,
    MODE_DECL_STABLE_LIGHT_TEST_ID,
  )

  const strictSection = document.createElement('section')
  strictSection.setAttribute('data-mode', 'declaration-strict')
  root.appendChild(strictSection)
  createRoot(strictSection).render(
    reactJsx`<>
      <${StrictOkCard} label="Strict OK" testId=${MODE_DECL_STRICT_OK_TEST_ID} />
      <${StrictSkipCard} label="Strict skip" testId=${MODE_DECL_STRICT_SKIP_TEST_ID} />
    </>`,
  )

  const hashedProbe = document.createElement('span')
  hashedProbe.setAttribute('data-testid', MODE_DECL_HASHED_SELECTOR_TEST_ID)
  hashedProbe.setAttribute('data-selector', declarationHashedSelectors.card ?? '')
  root.appendChild(hashedProbe)

  const stableProbe = document.createElement('span')
  stableProbe.setAttribute('data-testid', MODE_DECL_STABLE_SELECTOR_TEST_ID)
  stableProbe.setAttribute('data-stable-selector', declarationStableSelectors.card ?? '')
  root.appendChild(stableProbe)

  const strictOkProbe = document.createElement('span')
  strictOkProbe.setAttribute('data-testid', MODE_DECL_STRICT_OK_PROBE_TEST_ID)
  strictOkProbe.setAttribute('data-has-knighted-css', 'false')
  root.appendChild(strictOkProbe)

  const strictSkipProbe = document.createElement('span')
  strictSkipProbe.setAttribute('data-testid', MODE_DECL_STRICT_SKIP_PROBE_TEST_ID)
  strictSkipProbe.setAttribute('data-has-knighted-css', 'false')
  root.appendChild(strictSkipProbe)

  void Promise.all([
    import('./declaration-strict/strict-ok-card.js'),
    import('./declaration-strict/strict-skip-card.js'),
  ]).then(([okModule, skipModule]) => {
    const hasKnightedCss = (value: unknown): value is { knightedCss: string } =>
      typeof value === 'object' &&
      value !== null &&
      'knightedCss' in value &&
      typeof value.knightedCss === 'string'
    strictOkProbe.setAttribute('data-has-knighted-css', String(hasKnightedCss(okModule)))
    strictSkipProbe.setAttribute(
      'data-has-knighted-css',
      String(hasKnightedCss(skipModule)),
    )
  })

  ensureModeModuleHostDefined()
  const moduleHost = document.createElement(MODE_MODULE_HOST_TAG)
  moduleHost.setAttribute('data-testid', MODE_MODULE_HOST_TEST_ID)
  root.appendChild(moduleHost)

  ensureModeDeclarationHostDefined()
  const declarationHost = document.createElement(MODE_DECL_HOST_TAG)
  declarationHost.setAttribute('data-testid', MODE_DECL_HOST_TEST_ID)
  root.appendChild(declarationHost)

  ensureModeDeclarationHashedHostDefined()
  const declarationHashedHost = document.createElement(MODE_DECL_HASHED_HOST_TAG)
  declarationHashedHost.setAttribute('data-testid', MODE_DECL_HASHED_HOST_TEST_ID)
  root.appendChild(declarationHashedHost)

  ensureModeDeclarationStableHostDefined()
  const declarationStableHost = document.createElement(MODE_DECL_STABLE_HOST_TAG)
  declarationStableHost.setAttribute('data-testid', MODE_DECL_STABLE_HOST_TEST_ID)
  root.appendChild(declarationStableHost)

  return root
}

if (typeof document !== 'undefined') {
  renderModeDemo()
}
