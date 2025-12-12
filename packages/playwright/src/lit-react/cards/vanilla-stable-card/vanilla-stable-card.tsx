import {
  vanillaStableChipClass,
  vanillaStableChipStableClass,
  vanillaStableCopyClass,
  vanillaStableCopyStableClass,
  vanillaStableShellClass,
  vanillaStableShellStableClass,
} from './vanilla-stable-card.css.js'

export const VANILLA_STABLE_TEST_ID = 'dialect-vanilla-stable'

export function VanillaStableSelectorsCard() {
  const shellClass = [vanillaStableShellClass, vanillaStableShellStableClass].join(' ')
  const chipClass = [vanillaStableChipClass, vanillaStableChipStableClass].join(' ')
  const copyClass = [vanillaStableCopyClass, vanillaStableCopyStableClass].join(' ')

  return (
    <div className={shellClass} data-testid={VANILLA_STABLE_TEST_ID}>
      <span className={chipClass} data-token="stable">
        vanilla extract · stable selectors
      </span>
      <p className={copyClass}>
        We stitch <strong>deterministic</strong> selectors onto vanilla-extract classes so
        Lit hosts can target them without needing the hashed identifiers.
      </p>
    </div>
  )
}
