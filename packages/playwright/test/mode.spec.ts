import { expect, test } from '@playwright/test'

import {
  MODE_DECL_HOST_TEST_ID,
  MODE_DECL_LIGHT_TEST_ID,
  MODE_DECL_SHADOW_TEST_ID,
  MODE_MODULE_HOST_TEST_ID,
  MODE_MODULE_LIGHT_TEST_ID,
  MODE_MODULE_SHADOW_TEST_ID,
} from '../src/mode/constants.js'

type CardMetrics = {
  background: string
  color: string
  borderRadius: string
}

async function readMetrics(
  handle: import('@playwright/test').Locator,
): Promise<CardMetrics> {
  return handle.evaluate(node => {
    const el = node as HTMLElement
    const style = getComputedStyle(el)
    return {
      background: style.getPropertyValue('background-color').trim(),
      color: style.getPropertyValue('color').trim(),
      borderRadius: style.getPropertyValue('border-top-left-radius').trim(),
    }
  })
}

async function readShadowMetrics(
  page: import('@playwright/test').Page,
  hostId: string,
  cardId: string,
): Promise<CardMetrics> {
  await page.waitForFunction(
    ({ hostId, cardId }) => {
      const hostEl = document.querySelector(`[data-testid="${hostId}"]`)
      return hostEl?.shadowRoot?.querySelector(`[data-testid="${cardId}"]`)
    },
    { hostId, cardId },
  )

  return page.evaluate(
    ({ hostId, cardId }) => {
      const hostEl = document.querySelector(`[data-testid="${hostId}"]`)
      const card = hostEl?.shadowRoot?.querySelector(`[data-testid="${cardId}"]`)
      if (!card) {
        throw new Error('Shadow DOM card was not rendered')
      }
      const style = getComputedStyle(card as HTMLElement)
      return {
        background: style.getPropertyValue('background-color').trim(),
        color: style.getPropertyValue('color').trim(),
        borderRadius: style.getPropertyValue('border-top-left-radius').trim(),
      }
    },
    { hostId, cardId },
  )
}

test.describe('mode resolver fixture', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/mode.html')
  })

  test('module mode light and shadow styles match', async ({ page }) => {
    const lightCard = page.getByTestId(MODE_MODULE_LIGHT_TEST_ID)
    await expect(lightCard).toBeVisible()
    const lightMetrics = await readMetrics(lightCard)

    const host = page.getByTestId(MODE_MODULE_HOST_TEST_ID)
    await expect(host).toBeVisible()

    const shadowMetrics = await readShadowMetrics(
      page,
      MODE_MODULE_HOST_TEST_ID,
      MODE_MODULE_SHADOW_TEST_ID,
    )

    expect(shadowMetrics.background).toBe(lightMetrics.background)
    expect(shadowMetrics.color).toBe(lightMetrics.color)
    expect(shadowMetrics.borderRadius).toBe(lightMetrics.borderRadius)
  })

  test('declaration mode light and shadow styles match', async ({ page }) => {
    const lightCard = page.getByTestId(MODE_DECL_LIGHT_TEST_ID)
    await expect(lightCard).toBeVisible()
    const lightMetrics = await readMetrics(lightCard)

    const host = page.getByTestId(MODE_DECL_HOST_TEST_ID)
    await expect(host).toBeVisible()

    const shadowMetrics = await readShadowMetrics(
      page,
      MODE_DECL_HOST_TEST_ID,
      MODE_DECL_SHADOW_TEST_ID,
    )

    expect(shadowMetrics.background).toBe(lightMetrics.background)
    expect(shadowMetrics.color).toBe(lightMetrics.color)
    expect(shadowMetrics.borderRadius).toBe(lightMetrics.borderRadius)
  })
})
