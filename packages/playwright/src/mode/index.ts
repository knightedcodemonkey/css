import { reactJsx } from '@knighted/jsx/react'
import { createRoot } from 'react-dom/client'
import type { JSX } from 'react'

import { ModuleCard } from './module/module-card.js'
import { DeclarationCard } from './declaration/declaration-card.js'
import {
  MODE_DECL_HOST_TAG,
  MODE_DECL_HOST_TEST_ID,
  MODE_DECL_LIGHT_TEST_ID,
  MODE_MODULE_HOST_TAG,
  MODE_MODULE_HOST_TEST_ID,
  MODE_MODULE_LIGHT_TEST_ID,
} from './constants.js'
import { ensureModeModuleHostDefined } from './module/host.js'
import { ensureModeDeclarationHostDefined } from './declaration/host.js'

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

  ensureModeModuleHostDefined()
  const moduleHost = document.createElement(MODE_MODULE_HOST_TAG)
  moduleHost.setAttribute('data-testid', MODE_MODULE_HOST_TEST_ID)
  root.appendChild(moduleHost)

  ensureModeDeclarationHostDefined()
  const declarationHost = document.createElement(MODE_DECL_HOST_TAG)
  declarationHost.setAttribute('data-testid', MODE_DECL_HOST_TEST_ID)
  root.appendChild(declarationHost)

  return root
}

if (typeof document !== 'undefined') {
  renderModeDemo()
}
