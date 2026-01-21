import { expect, test } from '@playwright/test'

import {
  BRIDGE_CARD_TEST_ID,
  BRIDGE_HOST_TEST_ID,
  BRIDGE_TRANSITIVE_TEST_ID,
} from '../src/bridge/constants.js'

const pages = [
  { label: 'rspack', url: '/bridge.html' },
  { label: 'webpack', url: '/bridge-webpack.html' },
]

for (const target of pages) {
  test.describe(`Loader bridge demo (${target.label})`, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(target.url)
    })

    test('shadow DOM uses hashed class names from CSS modules', async ({ page }) => {
      const host = page.getByTestId(BRIDGE_HOST_TEST_ID)
      await expect(host).toBeVisible()

      const cardHandle = await page.waitForFunction(
        ({ hostId, cardId }) => {
          const hostEl = document.querySelector(`[data-testid="${hostId}"]`)
          return hostEl?.shadowRoot?.querySelector(`[data-testid="${cardId}"]`)
        },
        { hostId: BRIDGE_HOST_TEST_ID, cardId: BRIDGE_CARD_TEST_ID },
      )

      const card = cardHandle.asElement()
      if (!card) throw new Error('Bridge card was not rendered')

      const metrics = await card.evaluate(node => {
        const el = node as HTMLElement
        const style = getComputedStyle(el)
        return {
          className: el.className,
          background: style.getPropertyValue('background-color').trim(),
          color: style.getPropertyValue('color').trim(),
        }
      })

      await cardHandle.dispose()

      expect(metrics.className).not.toBe('')
      expect(metrics.background).toBe('rgb(20, 30, 55)')
      expect(metrics.color).toBe('rgb(226, 232, 240)')

      const markerHandle = await page.waitForFunction(
        ({ hostId, markerId }) => {
          const hostEl = document.querySelector(`[data-testid="${hostId}"]`)
          return hostEl?.shadowRoot?.querySelector(`[data-testid="${markerId}"]`)
        },
        { hostId: BRIDGE_HOST_TEST_ID, markerId: 'bridge-marker' },
      )

      const marker = markerHandle.asElement()
      if (!marker) throw new Error('Bridge marker was not rendered')

      const cssLength = await marker.evaluate(node =>
        Number((node as HTMLElement).dataset.cssLength ?? 0),
      )

      await markerHandle.dispose()

      expect(cssLength).toBeGreaterThan(0)
    })

    test('shadow DOM includes transitive style imports', async ({ page }) => {
      const host = page.getByTestId(BRIDGE_HOST_TEST_ID)
      await expect(host).toBeVisible()

      const cardHandle = await page.waitForFunction(
        ({ hostId, cardId }) => {
          const hostEl = document.querySelector(`[data-testid="${hostId}"]`)
          return hostEl?.shadowRoot?.querySelector(`[data-testid="${cardId}"]`)
        },
        { hostId: BRIDGE_HOST_TEST_ID, cardId: BRIDGE_TRANSITIVE_TEST_ID },
      )

      const card = cardHandle.asElement()
      if (!card) throw new Error('Transitive bridge card was not rendered')

      const metrics = await card.evaluate(node => {
        const el = node as HTMLElement
        const style = getComputedStyle(el)
        return {
          background: style.getPropertyValue('background-color').trim(),
          color: style.getPropertyValue('color').trim(),
          borderColor: style.getPropertyValue('border-top-color').trim(),
        }
      })

      await cardHandle.dispose()

      expect(metrics.background).toBe('rgb(15, 23, 42)')
      expect(metrics.color).toBe('rgb(226, 232, 240)')
      expect(metrics.borderColor).toBe('rgb(14, 165, 233)')
    })
  })
}
