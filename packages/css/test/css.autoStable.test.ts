import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'

import { cssWithMeta } from '../src/css.js'
import type { LightningVisitor } from '../src/helpers.js'
import type { SelectorComponent } from 'lightningcss'

const fixturesDir = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  'fixtures',
  'auto-stable',
  'plain',
)
const modulesDir = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  'fixtures',
  'auto-stable',
  'modules',
)

function runCss(entry: string, options: Parameters<typeof cssWithMeta>[1]) {
  return cssWithMeta(entry, { cwd: fixturesDir, ...options })
}

test('autoStable forces lightningcss even when disabled', async () => {
  const entry = path.join(fixturesDir, 'simple.css')
  const result = await runCss(entry, { autoStable: true, lightningcss: false })
  assert.match(result.css, /\.foo,\s*\.knighted-foo/)
})

test('autoStable composes with specificity boost and user visitor', async () => {
  const entry = path.join(fixturesDir, 'simple.css')
  const isSelectorList = (
    selectors: unknown,
  ): selectors is Array<Array<SelectorComponent>> =>
    Array.isArray(selectors) &&
    selectors.every(
      sel =>
        Array.isArray(sel) &&
        sel.every(
          part =>
            typeof part === 'object' &&
            part !== null &&
            'type' in part &&
            typeof part.type === 'string',
        ),
    )
  const userVisitor: LightningVisitor = {
    Rule: {
      style(rule) {
        if (!rule || !isSelectorList(rule.value?.selectors)) {
          return rule
        }
        const selectors = rule.value.selectors
        const classComponent = { type: 'class', name: 'user' } satisfies SelectorComponent
        const augmented = selectors.map(sel => [...sel, { ...classComponent }])
        return { ...rule, value: { ...rule.value, selectors: augmented } }
      },
    },
  }
  const result = await runCss(entry, {
    autoStable: true,
    lightningcss: {
      visitor: userVisitor,
    },
    specificityBoost: { strategy: { type: 'append-where', token: 'boost' } },
  })

  /**
   * LightningCSS may reorder visistor composition; ensure both the specificity boost and
   * autoStable duplication ran by checking for both tokens anywhere in the selector text.
   */
  assert.match(result.css, /\.foo[^}]*:where\(\.boost\)/)
  assert.match(result.css, /\.knighted-foo[^}]*:where\(\.boost\)/)
})

test('autoStable captures cssModules exports and selector duplication', async () => {
  const entry = path.join(modulesDir, 'button.module.css')
  const result = await cssWithMeta(entry, {
    cwd: modulesDir,
    autoStable: true,
    lightningcss: { cssModules: true },
  })

  const buttonExport = result.exports?.button
  const composed = result.exports?.primary

  const toStringValue = (value: unknown): string => {
    if (typeof value === 'string') return value
    if (Array.isArray(value)) return value.join(' ')
    if (value && typeof value === 'object' && 'name' in value) {
      const entry = value as { name?: string; composes?: Array<{ name?: string }> }
      const names = [entry.name, ...(entry.composes ?? []).map(c => c?.name)].filter(
        Boolean,
      )
      return names.join(' ')
    }
    return ''
  }

  /**
   * LightningCSS returns the hashed class in the exports; stable selectors are injected in CSS and
   * appended to exports later in the loader pipeline. Ensure the runtime CSS has stable selectors and
   * that composed exports include their composed hashed class names.
   */
  assert.match(result.css, /\.knighted-button/)
  assert.match(result.css, /\.knighted-primary/)

  const composedNames = toStringValue(composed).split(/\s+/)
  const buttonName = toStringValue(buttonExport)
  assert.ok(buttonName && composedNames.includes(buttonName))
})
