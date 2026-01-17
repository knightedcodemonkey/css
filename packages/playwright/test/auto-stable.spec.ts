import { expect, test } from '@playwright/test'

import {
  AUTO_STABLE_HOST_TEST_ID,
  AUTO_STABLE_LIGHT_TEST_ID,
  AUTO_STABLE_PROXY_TEST_ID,
  AUTO_STABLE_SHADOW_TEST_ID,
  AUTO_STABLE_TOKEN_TEST_ID,
} from '../src/auto-stable/constants.js'

test.describe('Auto-stable demo', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.error(`[browser:${msg.type()}] ${msg.text()}`)
      }
    })
    page.on('pageerror', error => {
      console.error(`[pageerror] ${error.message}`)
    })
    await page.goto('/auto-stable.html')
  })

  test('light DOM card uses CSS module styles', async ({ page }) => {
    const card = page.getByTestId(AUTO_STABLE_LIGHT_TEST_ID)
    await expect(card).toBeVisible()

    const metrics = await card.evaluate(node => {
      const el = node as HTMLElement
      const style = getComputedStyle(el)
      return {
        className: el.className,
        background: style.getPropertyValue('background-color').trim(),
        color: style.getPropertyValue('color').trim(),
      }
    })

    expect(metrics.className).not.toBe('')
    expect(metrics.background).toBe('rgb(15, 23, 42)')
    expect(metrics.color).toBe('rgb(226, 232, 240)')
  })

  test('shadow DOM card uses auto-stable selectors', async ({ page }) => {
    const host = page.getByTestId(AUTO_STABLE_HOST_TEST_ID)
    await expect(host).toBeVisible()

    const cardHandle = await page.waitForFunction(
      ({ hostId, shadowId }) => {
        const hostEl = document.querySelector(`[data-testid="${hostId}"]`)
        return hostEl?.shadowRoot?.querySelector(`[data-testid="${shadowId}"]`)
      },
      { hostId: AUTO_STABLE_HOST_TEST_ID, shadowId: AUTO_STABLE_SHADOW_TEST_ID },
    )

    const card = cardHandle.asElement()
    if (!card) throw new Error('Shadow DOM card was not rendered')

    const metrics = await card.evaluate(node => {
      const el = node as HTMLElement
      const style = getComputedStyle(el)
      return {
        className: el.className,
        background: style.getPropertyValue('background-color').trim(),
      }
    })

    await cardHandle.dispose()

    expect(metrics.className.split(' ')).toContain('knighted-card')
    expect(metrics.background).toBe('rgb(15, 23, 42)')

    const tokenHandle = await page.waitForFunction(
      ({ hostId, tokenId }) => {
        const hostEl = document.querySelector(`[data-testid="${hostId}"]`)
        return hostEl?.shadowRoot?.querySelector(`[data-testid="${tokenId}"]`)
      },
      { hostId: AUTO_STABLE_HOST_TEST_ID, tokenId: AUTO_STABLE_TOKEN_TEST_ID },
    )

    const token = tokenHandle.asElement()
    if (!token) throw new Error('Stable selector token was not rendered')

    const tokenText = await token.textContent()
    await tokenHandle.dispose()

    expect(tokenText?.trim()).toBe('knighted-card')
  })

  test('unified proxy provides exports, css, and selectors', async ({ page }) => {
    const proxyHandle = await page.waitForFunction(
      ({ hostId, proxyId }) => {
        const hostEl = document.querySelector(`[data-testid="${hostId}"]`)
        return hostEl?.shadowRoot?.querySelector(`[data-testid="${proxyId}"]`)
      },
      { hostId: AUTO_STABLE_HOST_TEST_ID, proxyId: AUTO_STABLE_PROXY_TEST_ID },
    )

    const proxyMarker = proxyHandle.asElement()
    if (!proxyMarker) throw new Error('Unified proxy marker was not rendered')

    const proxyData = await proxyMarker.evaluate(node => {
      const el = node as HTMLElement
      return {
        stableClass: el.dataset.stableClass,
        cssLength: Number(el.dataset.cssLength ?? 0),
      }
    })

    await proxyHandle.dispose()

    expect(proxyData.stableClass).toBe('knighted-card')
    expect(proxyData.cssLength).toBeGreaterThan(0)

    const cardHandle = await page.waitForFunction(
      ({ hostId, selector }) => {
        const hostEl = document.querySelector(`[data-testid="${hostId}"]`)
        return hostEl?.shadowRoot?.querySelector(selector)
      },
      { hostId: AUTO_STABLE_HOST_TEST_ID, selector: `.${proxyData.stableClass}` },
    )

    const card = cardHandle.asElement()
    if (!card) throw new Error('Shadow DOM card was not rendered')

    const background = await card.evaluate(node => {
      const el = node as HTMLElement
      return getComputedStyle(el).getPropertyValue('background-color').trim()
    })

    await cardHandle.dispose()

    expect(background).toBe('rgb(15, 23, 42)')
  })
})
