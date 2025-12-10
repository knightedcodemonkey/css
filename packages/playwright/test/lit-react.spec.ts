import { expect, test } from '@playwright/test'

import { LIT_REACT_TEST_ID } from '../src/lit-react/constants.js'

test.describe('Lit + React wrapper demo', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.error(`[browser:${msg.type()}] ${msg.text()}`)
      }
    })
    page.on('pageerror', error => {
      console.error(`[pageerror] ${error.message}`)
    })
    await page.goto('/')
  })

  test('renders Lit wrapper hosting the React button', async ({ page }) => {
    const buttonHandle = await page.waitForFunction(testId => {
      const host = document.querySelector(`[data-testid="${testId}"]`)
      return host?.shadowRoot?.querySelector('button.readme-button') ?? null
    }, LIT_REACT_TEST_ID)

    const button = buttonHandle.asElement()
    if (!button) throw new Error('React button was not rendered inside the Lit wrapper')

    const metrics = await button.evaluate(node => {
      const el = node as HTMLButtonElement
      const style = getComputedStyle(el)
      const rect = el.getBoundingClientRect()
      const badge = el.querySelector('[data-testid="readme-badge"]') as HTMLElement | null
      const label = el.querySelector(
        '[data-testid="react-button-label"]',
      ) as HTMLElement | null
      const badgeStyle = badge ? getComputedStyle(badge) : null
      const labelStyle = label ? getComputedStyle(label) : null

      return {
        button: {
          text: el.textContent?.replace(/\s+/g, ' ').trim() ?? '',
          label: label?.textContent?.trim() ?? null,
          visible: style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0,
          background: style.getPropertyValue('background-color').trim(),
          radius: style.getPropertyValue('border-radius').trim(),
          labelColor: labelStyle?.getPropertyValue('color').trim() ?? null,
        },
        badge:
          badge && badgeStyle
            ? {
                text: badge.textContent?.trim() ?? '',
                background: badgeStyle.getPropertyValue('background-color').trim(),
                color: badgeStyle.getPropertyValue('color').trim(),
              }
            : null,
      }
    })

    await buttonHandle.dispose()

    if (!metrics.badge) {
      throw new Error('Nested badge component styles were not applied')
    }

    expect(metrics.button.visible).toBe(true)
    expect(metrics.button.label).toBe('Launch CSS Build')
    expect(metrics.button.text).toContain('Launch CSS Build')
    expect(metrics.button.background).toBe('rgb(17, 24, 39)')
    expect(metrics.button.radius).toBe('999px')
    expect(metrics.button.labelColor).toBe('rgb(248, 250, 252)')

    expect(metrics.badge.text).toBe('Synced Styles')
    expect(metrics.badge.background).toBe('rgb(252, 211, 77)')
    expect(metrics.badge.color).toBe('rgb(15, 23, 42)')
  })
})
