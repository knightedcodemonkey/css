import './app.css'

import type { DialectSample } from '../dialects/registry.js'
import { Button } from './button.js'

type ShowcaseProps = {
  label: string
  dialects: DialectSample[]
}

export function Showcase({ label, dialects }: ShowcaseProps) {
  return (
    <div className="readme-stage">
      <section className="readme-hero">
        <Button label={label} />
      </section>
      <section className="dialect-gallery" aria-label="CSS dialects">
        {dialects.map(dialect => (
          <article className="dialect-card" key={dialect.testId}>
            <style data-dialect-style dangerouslySetInnerHTML={{ __html: dialect.css }} />
            <span className={dialect.className} data-testid={dialect.testId}>
              {dialect.label}
            </span>
          </article>
        ))}
      </section>
    </div>
  )
}
