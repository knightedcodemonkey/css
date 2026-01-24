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

  const hashedProbe = document.createElement('span')
  hashedProbe.setAttribute('data-testid', MODE_DECL_HASHED_SELECTOR_TEST_ID)
  hashedProbe.setAttribute('data-selector', declarationHashedSelectors.card ?? '')
  root.appendChild(hashedProbe)

  const stableProbe = document.createElement('span')
  stableProbe.setAttribute('data-testid', MODE_DECL_STABLE_SELECTOR_TEST_ID)
  stableProbe.setAttribute('data-stable-selector', declarationStableSelectors.card ?? '')
  root.appendChild(stableProbe)

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
