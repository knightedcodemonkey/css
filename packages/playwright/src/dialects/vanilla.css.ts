import { globalStyle, style, styleVariants } from '@vanilla-extract/css'
import { createSprinkles, defineProperties } from '@vanilla-extract/sprinkles'

const layoutProperties = defineProperties({
  properties: {
    display: ['inline-flex'],
    alignItems: ['center'],
    gap: ['0.35rem', '0.5rem', '0.75rem'],
    paddingX: ['0.5rem', '0.75rem', '1rem', '1.25rem'],
    paddingY: ['0.35rem', '0.5rem', '0.75rem'],
  },
  shorthands: {
    padding: ['paddingX', 'paddingY'],
  },
})

const textProperties = defineProperties({
  properties: {
    letterSpacing: ['0.04em', '0.08em', '0.12em'],
    textTransform: ['uppercase'],
  },
})

export const sprinkles = createSprinkles(layoutProperties, textProperties)

export const vanillaCardClass = style([
  sprinkles({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.75rem',
    paddingX: '1.25rem',
    paddingY: '0.75rem',
  }),
  {
    background: '#1e293b',
    color: '#f8fafc',
    borderRadius: '999px',
    fontWeight: 600,
  },
])

export const vanillaBadgeClass = style([
  sprinkles({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.35rem',
    paddingX: '0.75rem',
    paddingY: '0.35rem',
    textTransform: 'uppercase',
  }),
  {
    background: '#fbbf24',
    color: '#1e293b',
    borderRadius: '999px',
  },
])

const tokenVariants = styleVariants({
  tracking: [
    sprinkles({ letterSpacing: '0.12em', textTransform: 'uppercase' }),
    {
      color: '#cbd5f5',
    },
  ],
  accent: [
    sprinkles({ letterSpacing: '0.08em', textTransform: 'uppercase' }),
    {
      color: '#a78bfa',
    },
  ],
})

export const vanillaTokenClass = tokenVariants.tracking

globalStyle(`${vanillaCardClass} strong`, {
  color: '#38bdf8',
})
