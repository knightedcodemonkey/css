import { HashedCard } from './card.js'
import { HASHED_SHADOW_TEST_ID } from './constants.js'

export function ShadowTree() {
  return <HashedCard label="Shadow DOM" testId={HASHED_SHADOW_TEST_ID} />
}
