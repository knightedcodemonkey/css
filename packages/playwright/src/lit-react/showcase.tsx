import './app.css'

import type { JSX } from 'react'

import { BasicCard, BASIC_TEST_ID } from './cards/basic-card/basic-card.js'
import { knightedCss as basicCss } from './cards/basic-card/basic-card.js?knighted-css'
import { LessCard, LESS_TEST_ID } from './cards/less-card/less-card.js'
import { knightedCss as lessCss } from './cards/less-card/less-card.js?knighted-css'
import { SassCard, SASS_TEST_ID } from './cards/sass-card/sass-card.js'
import { knightedCss as sassCss } from './cards/sass-card/sass-card.js?knighted-css'
import { ScssCard, SCSS_TEST_ID } from './cards/scss-card/scss-card.js'
import { knightedCss as scssCss } from './cards/scss-card/scss-card.js?knighted-css'
import { VanillaCard, VANILLA_TEST_ID } from './cards/vanilla-card/vanilla-card.js'
import { knightedCss as vanillaCss } from './cards/vanilla-card/vanilla-card.js?knighted-css'
import { Button } from './button.js'

type DialectCard = {
  id: string
  css: string
  Component: () => JSX.Element
}

const cards: DialectCard[] = [
  { id: BASIC_TEST_ID, css: basicCss, Component: BasicCard },
  { id: SCSS_TEST_ID, css: scssCss, Component: ScssCard },
  { id: SASS_TEST_ID, css: sassCss, Component: SassCard },
  { id: LESS_TEST_ID, css: lessCss, Component: LessCard },
  { id: VANILLA_TEST_ID, css: vanillaCss, Component: VanillaCard },
]

type ShowcaseProps = {
  label: string
}

export function Showcase({ label }: ShowcaseProps) {
  return (
    <div className="readme-stage">
      <section className="readme-hero">
        <Button label={label} />
      </section>
      <section className="dialect-gallery" aria-label="CSS dialects">
        {cards.map(card => (
          <article className="dialect-card" key={card.id}>
            <style data-dialect-style dangerouslySetInnerHTML={{ __html: card.css }} />
            <card.Component />
          </article>
        ))}
      </section>
    </div>
  )
}
