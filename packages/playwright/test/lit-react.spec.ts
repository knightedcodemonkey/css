import { expect, test } from '@playwright/test'

import { LIT_REACT_TEST_ID } from '../src/lit-react/constants.js'

test.describe('Lit + React wrapper demo', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.error(`[browser:${msg.type()}] ${msg.text()}`)
      }
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
      return {
        text: el.textContent?.trim() ?? '',
        visible: style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0,
        background: style.getPropertyValue('background-color').trim(),
        radius: style.getPropertyValue('border-radius').trim(),
      }
    })

    await buttonHandle.dispose()

    expect(metrics.visible).toBe(true)
    expect(metrics.text).toBe('React Button')
    expect(metrics.background).toBe('rgb(17, 24, 39)')
    expect(metrics.radius).toBe('999px')
  })
})
