import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { css as extractCss } from '@knighted/css'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(__dirname, '..')
const distDir = path.join(pkgRoot, 'dist')
const ssrEntry = path.join(pkgRoot, 'src/ssr/inline-entry.ts')
const targetFile = path.join(distDir, 'ssr-inline.html')

async function renderSsrPreview() {
  const ssrCss = await extractCss(ssrEntry, {
    cwd: pkgRoot,
    lightningcss: { minify: true, sourceMap: false },
  })

  const markup = `
<section data-testid="ssr-inline-root" class="ssr-inline-root">
  <article class="ssr-inline-card">
    <p class="ssr-inline-card__eyebrow">Server rendered</p>
    <h2 class="ssr-inline-card__title">Styles arrive with HTML, not hydration</h2>
    <p class="ssr-inline-card__body">
      This fragment was pre-rendered alongside its compiled CSS using @knighted/css.
      JavaScript is optional—perfect for SSR streaming and static sites.
    </p>
    <ul class="ssr-inline-card__list">
      <li class="ssr-inline-card__list-item">Deterministic selectors</li>
      <li class="ssr-inline-card__list-item">Inline critical CSS</li>
      <li class="ssr-inline-card__list-item">Hydrate only what you need</li>
    </ul>
  </article>
</section>
`.trim()

  const document = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>SSR Inline Preview</title>
    <style data-ssr-inline>${ssrCss}</style>
  </head>
  <body>
    ${markup}
  </body>
</html>
`

  await mkdir(distDir, { recursive: true })
  await writeFile(targetFile, document)
}

renderSsrPreview().catch(error => {
  console.error('[knighted-css/playwright] Failed to render SSR preview.')
  console.error(error)
  process.exitCode = 1
})
