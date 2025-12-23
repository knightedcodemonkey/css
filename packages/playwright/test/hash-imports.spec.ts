import { expect, test } from '@playwright/test'

import {
  HASH_IMPORTS_BADGE_TEST_ID,
  HASH_IMPORTS_CARD_TEST_ID,
  HASH_IMPORTS_SECTION_ID,
} from '../src/hash-imports-workspace/constants.js'

test.describe('hash imports workspace demo', () => {
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

  test('applies stylesheet resolved from # imports', async ({ page }) => {
    const section = page.getByTestId(HASH_IMPORTS_SECTION_ID)
    await expect(section).toBeVisible()

    const card = page.getByTestId(HASH_IMPORTS_CARD_TEST_ID)
    await expect(card).toBeVisible()

    const metrics = await card.evaluate(node => {
      const style = getComputedStyle(node as HTMLElement)
      return {
        backgroundImage: style.getPropertyValue('background-image').trim(),
        borderColor: style.getPropertyValue('border-color').trim(),
      }
    })

    expect(metrics.backgroundImage).toContain('linear-gradient')
    expect(metrics.borderColor).toBe('rgb(29, 78, 216)')
  })

  test('badge copy references workspace context', async ({ page }) => {
    const badge = page.getByTestId(HASH_IMPORTS_BADGE_TEST_ID)
    await expect(badge).toBeVisible()
    const text = await badge.textContent()
    expect(text?.toLowerCase()).toContain('workspace')
  })
})
