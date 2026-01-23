import { expect, test } from '@playwright/test'

import {
  HASHED_HOST_TEST_ID,
  HASHED_LIGHT_TEST_ID,
  HASHED_SHADOW_TEST_ID,
} from '../src/hashed/constants.js'

test.describe('Hashed selectors demo', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.error(`[browser:${msg.type()}] ${msg.text()}`)
      }
    })
    page.on('pageerror', error => {
      console.error(`[pageerror] ${error.message}`)
    })
    await page.goto('/hashed.html')
  })

  test('light and shadow DOM styles match', async ({ page }) => {
    const lightCard = page.getByTestId(HASHED_LIGHT_TEST_ID)
    await expect(lightCard).toBeVisible()

    const lightMetrics = await lightCard.evaluate(node => {
      const el = node as HTMLElement
      const style = getComputedStyle(el)
      return {
        className: el.className,
        background: style.getPropertyValue('background-color').trim(),
        color: style.getPropertyValue('color').trim(),
        borderRadius: style.getPropertyValue('border-top-left-radius').trim(),
      }
    })

    const host = page.getByTestId(HASHED_HOST_TEST_ID)
    await expect(host).toBeVisible()

    const shadowHandle = await page.waitForFunction(
      ({ hostId, shadowId }) => {
        const hostEl = document.querySelector(`[data-testid="${hostId}"]`)
        return hostEl?.shadowRoot?.querySelector(`[data-testid="${shadowId}"]`)
      },
      { hostId: HASHED_HOST_TEST_ID, shadowId: HASHED_SHADOW_TEST_ID },
    )

    const shadowCard = shadowHandle.asElement()
    if (!shadowCard) throw new Error('Shadow DOM card was not rendered')

    const shadowMetrics = await shadowCard.evaluate(node => {
      const el = node as HTMLElement
      const style = getComputedStyle(el)
      return {
        className: el.className,
        background: style.getPropertyValue('background-color').trim(),
        color: style.getPropertyValue('color').trim(),
        borderRadius: style.getPropertyValue('border-top-left-radius').trim(),
      }
    })

    await shadowHandle.dispose()

    expect(shadowMetrics.className).not.toBe('')
    expect(shadowMetrics.background).toBe(lightMetrics.background)
    expect(shadowMetrics.color).toBe(lightMetrics.color)
    expect(shadowMetrics.borderRadius).toBe(lightMetrics.borderRadius)
  })
})
