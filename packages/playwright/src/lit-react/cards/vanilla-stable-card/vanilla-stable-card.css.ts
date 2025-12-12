import { type ComplexStyleRule, globalStyle, style } from '@vanilla-extract/css'
import { stableClass, stableSelector } from '@knighted/css/stableSelectors'

const shellRecipe: ComplexStyleRule = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.85rem',
  padding: '1.35rem 1.5rem',
  borderRadius: '26px',
  color: '#0f172a',
  background: 'linear-gradient(120deg, #ede9fe 0%, #cffafe 45%, #fef3c7 100%)',
  boxShadow:
    '0 18px 45px rgba(15, 23, 42, 0.18), inset 0 0 0 1px rgba(255, 255, 255, 0.4)',
  position: 'relative',
  overflow: 'hidden',
}

const chipRecipe: ComplexStyleRule = {
  alignSelf: 'flex-start',
  padding: '0.35rem 0.8rem',
  borderRadius: '999px',
  fontSize: '0.7rem',
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  fontWeight: 700,
  background: 'rgba(15, 23, 42, 0.08)',
  color: '#0f172a',
}

const copyRecipe: ComplexStyleRule = {
  margin: 0,
  fontSize: '0.95rem',
  lineHeight: 1.5,
  color: 'rgba(15, 23, 42, 0.82)',
}

export const vanillaStableShellClass = style(shellRecipe)
export const vanillaStableChipClass = style(chipRecipe)
export const vanillaStableCopyClass = style(copyRecipe)

const shellStableClass = stableClass('vanilla-stable-shell')
const chipStableClass = stableClass('vanilla-stable-chip')
const copyStableClass = stableClass('vanilla-stable-copy')

export const vanillaStableShellStableClass = shellStableClass
export const vanillaStableChipStableClass = chipStableClass
export const vanillaStableCopyStableClass = copyStableClass

globalStyle(stableSelector('vanilla-stable-shell'), shellRecipe)
globalStyle(stableSelector('vanilla-stable-chip'), chipRecipe)
globalStyle(stableSelector('vanilla-stable-copy'), copyRecipe)

globalStyle(`${stableSelector('vanilla-stable-shell')}::after`, {
  content: "''",
  position: 'absolute',
  inset: '8px',
  borderRadius: '22px',
  background:
    'linear-gradient(135deg, rgba(124, 58, 237, 0.18), rgba(14, 165, 233, 0.15))',
  pointerEvents: 'none',
})

globalStyle(`${stableSelector('vanilla-stable-chip')}::after`, {
  content: 'attr(data-token)',
  marginLeft: '0.4rem',
  fontSize: '0.65rem',
  letterSpacing: '0.1em',
  color: '#6366f1',
})

globalStyle(`${stableSelector('vanilla-stable-shell')} strong`, {
  color: '#7c3aed',
})
