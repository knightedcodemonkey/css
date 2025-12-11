import { createTheme, style } from '@vanilla-extract/css'

export const [vanillaThemeClass, vanillaVars] = createTheme({
  panel: {
    background: '#0ea5e9',
    text: '#082f49',
    accent: '#facc15',
  },
})

export const vanillaCardClass = style({
  background: vanillaVars.panel.background,
  color: vanillaVars.panel.text,
  borderRadius: '28px',
  padding: '1.75rem',
  boxShadow: '0 25px 50px rgba(8, 47, 73, 0.45)',
  border: `2px solid ${vanillaVars.panel.accent}`,
})

export const vanillaHeadingClass = style({
  margin: 0,
  letterSpacing: '0.03em',
})

export const vanillaAccentClass = style({
  marginTop: '0.75rem',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.35rem',
  padding: '0.25rem 0.9rem',
  borderRadius: '999px',
  background: vanillaVars.panel.accent,
  color: vanillaVars.panel.text,
  fontWeight: 600,
})
