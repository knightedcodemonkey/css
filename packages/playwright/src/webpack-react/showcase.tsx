import './showcase.css'

import { LessCard } from './components/less-card.js'
import { SassCard } from './components/sass-card.js'
import { VanillaCard } from './components/vanilla-card.js'

export function WebpackShowcase() {
  return (
    <div className="webpack-stage">
      <header className="webpack-hero">
        <p>webpack + Lit + React</p>
        <h1>Bridge every CSS dialect</h1>
        <p>
          Each card is a React component that owns its Sass, Less, or vanilla-extract
          stylesheet.
        </p>
      </header>
      <section className="webpack-cards" aria-label="webpack css dialects">
        <SassCard />
        <LessCard />
        <VanillaCard />
      </section>
    </div>
  )
}
