import { globalStyle, style } from '@vanilla-extract/css'

export const vanillaCardClass = style({
  background: 'rgb(14, 116, 144)',
  color: 'rgb(236, 254, 255)',
  borderRadius: '24px',
})

globalStyle('[data-testid="mode-declaration-vanilla-light"]', {
  boxShadow: '0 18px 40px rgba(14, 116, 144, 0.35)',
})

globalStyle('[data-testid="mode-declaration-vanilla-shadow"]', {
  boxShadow: '0 18px 40px rgba(14, 116, 144, 0.35)',
})
