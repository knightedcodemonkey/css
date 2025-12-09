import { createTheme, style } from '@vanilla-extract/css'
import { recipe } from '@vanilla-extract/recipes'

export const [themeClass, vars] = createTheme({
  color: {
    bg: '#1e293b',
    accent: '#fbbf24',
    text: '#f8fafc',
  },
  space: {
    sm: '0.5rem',
    md: '1rem',
  },
})

export const badge = recipe({
  base: {
    vars: {
      [vars.color.bg]: '#1e293b',
    },
    background: vars.color.bg,
    color: vars.color.text,
    borderRadius: '999px',
    padding: `${vars.space.sm} ${vars.space.md}`,
  },
  variants: {
    accent: {
      true: {
        background: vars.color.accent,
        color: vars.color.bg,
      },
    },
  },
})

export const token = style({
  fontWeight: 600,
  selectors: {
    [`${themeClass} &`]: {
      letterSpacing: '0.08em',
    },
  },
})
