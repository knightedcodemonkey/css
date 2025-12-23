import './workspace-card.scss'

import {
  HASH_IMPORTS_BADGE_TEST_ID,
  HASH_IMPORTS_CARD_TEST_ID,
} from '../../../constants.js'

export type WorkspaceCardCopy = {
  title: string
  description: string
  badge: string
}

export const workspaceCardCopy: WorkspaceCardCopy = {
  title: 'Hash-prefixed imports stay zero-config',
  description:
    'This card renders with styles resolved via package.json#imports. The demo lives inside an npm workspace so the loader discovers tsconfig files and # specifiers without extra configuration.',
  badge: 'workspace ready',
}

export function createWorkspaceCard(): HTMLElement {
  const card = document.createElement('article')
  card.className = 'hash-imports-card'
  card.dataset.testid = HASH_IMPORTS_CARD_TEST_ID

  const badge = document.createElement('span')
  badge.className = 'hash-imports-card__badge'
  badge.dataset.testid = HASH_IMPORTS_BADGE_TEST_ID
  badge.textContent = workspaceCardCopy.badge

  const title = document.createElement('h2')
  title.className = 'hash-imports-card__title hash-imports-card__copy'
  title.textContent = workspaceCardCopy.title

  const description = document.createElement('p')
  description.className = 'hash-imports-card__description hash-imports-card__copy'
  description.textContent = workspaceCardCopy.description

  card.append(badge, title, description)
  return card
}
