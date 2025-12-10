import { globalStyle } from '@vanilla-extract/css'

globalStyle('.pw-vanilla', {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.5rem',
  padding: '0.75rem 1rem',
  background: '#1e293b',
  color: '#f8fafc',
  borderRadius: '999px',
})

globalStyle('.pw-vanilla-badge', {
  background: '#fbbf24',
  color: '#1e293b',
  padding: '0.25rem 0.75rem',
  borderRadius: '999px',
  fontWeight: 600,
})

globalStyle('.pw-vanilla-token', {
  letterSpacing: '0.08em',
})
