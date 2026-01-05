import { expect, test } from '@playwright/test'

import { LIT_REACT_TEST_ID } from '../src/lit-react/constants.js'

const dialectCases = [
  { id: 'dialect-basic', property: 'color' },
  { id: 'dialect-scss', property: 'color' },
  { id: 'dialect-sass-indented', property: 'color' },
  { id: 'dialect-less', property: 'color' },
  { id: 'dialect-stable-selectors', property: 'color' },
  { id: 'dialect-vanilla-stable', property: 'color' },
  { id: 'dialect-css-modules', property: 'color' },
  { id: 'dialect-vanilla', property: 'color' },
  { id: 'dialect-combined', property: 'background-image' },
  { id: 'dialect-nested-combined', property: 'background-image' },
  { id: 'dialect-combined-types', property: 'border-color' },
  { id: 'dialect-fallback-oxc', property: 'background-image' },
  { id: 'dialect-named-only', property: 'background-image' },
]

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

  for (const item of dialectCases) {
    test(`applies styles for ${item.id}`, async ({ page }) => {
      const el = page.getByTestId(item.id)
      await expect(el).toBeVisible()
      await expect
        .poll(
          async () =>
            await el.evaluate((node, prop) => {
              const style = getComputedStyle(node as HTMLElement)
              return style.getPropertyValue(prop as string).trim()
            }, item.property),
          { timeout: 5000 },
        )
        .not.toBe('')
    })
  }

  test('stable selector card exposes deterministic hooks', async ({ page }) => {
    const card = page.getByTestId('dialect-stable-selectors')
    await expect(card).toBeVisible()
    const metrics = await card.evaluate(node => {
      const el = node as HTMLElement
      const style = getComputedStyle(el)
      const chip = el.querySelector('.knighted-stable-chip') as HTMLElement | null
      const chipStyle = chip ? getComputedStyle(chip) : null
      return {
        background: style.getPropertyValue('background-image').trim(),
        chipCase: chipStyle?.getPropertyValue('text-transform').trim() ?? null,
      }
    })

    expect(metrics.background).toContain('linear-gradient')
    expect(metrics.chipCase).toBe('uppercase')
  })

  test('combined import surfaces default + named exports', async ({ page }) => {
    const card = page.getByTestId('dialect-combined')
    await expect(card).toBeVisible()
    const metrics = await card.evaluate(node => {
      const el = node as HTMLElement
      const entry = el.querySelector(
        '[data-testid="combined-card-entry"]',
      ) as HTMLElement | null
      const details = el.querySelector(
        '[data-testid="combined-card-details"]',
      ) as HTMLElement | null
      const style = getComputedStyle(el)
      return {
        entryText: entry?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        detailsText: details?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        background: style.getPropertyValue('background-image').trim(),
      }
    })

    expect(metrics.entryText).toContain('Shared demo entry')
    expect(metrics.detailsText).toContain('?knighted-css&combined')
    expect(metrics.background).toContain('linear-gradient')
  })

  test('nested combined import works when the host lives one directory up', async ({
    page,
  }) => {
    const card = page.getByTestId('dialect-nested-combined')
    await expect(card).toBeVisible()
    const metrics = await card.evaluate(node => {
      const el = node as HTMLElement
      const entry = el.querySelector(
        '[data-testid="nested-combined-entry"]',
      ) as HTMLElement | null
      const details = el.querySelector(
        '[data-testid="nested-combined-details"]',
      ) as HTMLElement | null
      const style = getComputedStyle(el)
      return {
        entryText: entry?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        detailsText: details?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        background: style.getPropertyValue('background-image').trim(),
      }
    })

    expect(metrics.entryText).toContain('Nested combined example')
    expect(metrics.detailsText).toContain('css-jsx-app')
    expect(metrics.background).toContain('radial-gradient')
  })

  test('combined & types import keeps runtime selectors synced', async ({ page }) => {
    const card = page.getByTestId('dialect-combined-types')
    await expect(card).toBeVisible()
    const metrics = await card.evaluate(node => {
      const el = node as HTMLElement
      const runtimeShell = el.getAttribute('data-runtime-shell') ?? ''
      const runtimeCopy = el.getAttribute('data-runtime-copy') ?? ''
      const copy = el.querySelector('.combined-types-card__copy') as HTMLElement | null
      const footer = el.querySelector('footer') as HTMLElement | null
      const shellClasses = el.className.split(' ').filter(Boolean)
      const copyClasses = copy?.className.split(' ').filter(Boolean) ?? []
      const footerText = footer?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
      return {
        runtimeShell,
        runtimeCopy,
        shellClasses,
        copyClasses,
        footerText,
      }
    })

    expect(metrics.runtimeShell).not.toBe('')
    expect(metrics.runtimeCopy).not.toBe('')
    expect(metrics.shellClasses).toContain(metrics.runtimeShell)
    expect(metrics.copyClasses).toContain(metrics.runtimeCopy)
    expect(metrics.footerText).toContain(metrics.runtimeShell)
  })

  test('fallback card surfaces stable selector from generated types', async ({
    page,
  }) => {
    const card = page.getByTestId('dialect-fallback-oxc')
    await expect(card).toBeVisible()

    const tokenText = await card
      .getByTestId('fallback-stable-shell')
      .textContent({ timeout: 5000 })

    expect(tokenText?.trim() ?? '').toContain('knighted-fallback-card')
  })

  test('named-only combined import disables the synthetic default', async ({ page }) => {
    const card = page.getByTestId('dialect-named-only')
    await expect(card).toBeVisible()

    const hasDefaultAttr = await card.getAttribute('data-has-default')
    expect(hasDefaultAttr).toBe('false')

    const flagText = await card.getByTestId('named-only-default-flag').textContent()
    expect(flagText?.replace(/\s+/g, ' ').trim()).toContain('no')
  })

  test('vanilla-extract stable selectors expose deterministic hooks', async ({
    page,
  }) => {
    const card = page.getByTestId('dialect-vanilla-stable')
    await expect(card).toBeVisible()
    const metrics = await card.evaluate(node => {
      const el = node as HTMLElement
      const stableShell = el.querySelector(
        '.knighted-vanilla-stable-shell',
      ) as HTMLElement | null
      const stableChip = el.querySelector(
        '.knighted-vanilla-stable-chip',
      ) as HTMLElement | null
      const stableCopy = el.querySelector(
        '.knighted-vanilla-stable-copy',
      ) as HTMLElement | null
      const shellStyle = stableShell
        ? getComputedStyle(stableShell)
        : getComputedStyle(el)
      return {
        gradient: shellStyle.getPropertyValue('background-image').trim(),
        chipCase: stableChip
          ? getComputedStyle(stableChip).getPropertyValue('text-transform').trim()
          : null,
        copyColor: stableCopy
          ? getComputedStyle(stableCopy).getPropertyValue('color').trim()
          : null,
      }
    })

    expect(metrics.gradient).toContain('linear-gradient')
    expect(metrics.chipCase).toBe('uppercase')
    expect(metrics.copyColor).toBe('rgba(15, 23, 42, 0.82)')
  })

  test('vanilla-extract sprinkles compose utility classes within Lit demo', async ({
    page,
  }) => {
    const el = page.getByTestId('dialect-vanilla')
    await expect(el).toBeVisible()
    const metrics = await el.evaluate(node => {
      const style = getComputedStyle(node as HTMLElement)
      return style.getPropertyValue('gap').trim()
    })

    expect(metrics).not.toBe('')
    expect(metrics).not.toBe('0px')
  })
})
