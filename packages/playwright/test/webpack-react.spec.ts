import { expect, test } from '@playwright/test'

import {
  WEBPACK_LESS_TEST_ID,
  WEBPACK_LIT_REACT_TEST_ID,
  WEBPACK_SASS_TEST_ID,
  WEBPACK_VANILLA_TEST_ID,
} from '../src/webpack-react/constants.js'

const cardExpectations = [
  {
    testId: WEBPACK_SASS_TEST_ID,
    background: 'rgb(15, 23, 42)',
    radius: '32px',
    borderColor: 'rgb(192, 132, 252)',
    badgeTestId: 'sass-chip',
    badgeColor: 'rgb(5, 46, 77)',
  },
  {
    testId: WEBPACK_LESS_TEST_ID,
    background: 'rgb(30, 41, 59)',
    radius: '28px',
    borderColor: 'rgba(251, 113, 133, 0.75)',
    badgeTestId: 'less-badge',
    badgeColor: 'rgb(154, 52, 18)',
  },
  {
    testId: WEBPACK_VANILLA_TEST_ID,
    background: 'rgb(14, 165, 233)',
    radius: '28px',
    borderColor: 'rgb(250, 204, 21)',
    badgeTestId: 'vanilla-accent',
    badgeColor: 'rgb(8, 47, 73)',
  },
]

test.describe('Webpack Lit + React demo', () => {
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.error(`[browser:${msg.type()}] ${msg.text()}`)
      }
    })
    page.on('pageerror', error => {
      console.error(`[pageerror] ${error.message}\n${error.stack ?? ''}`)
    })

    await page.goto('/webpack.html')
  })

  test('renders Lit host that mounts React cards with their dialect styles', async ({
    page,
  }) => {
    const host = page.getByTestId(WEBPACK_LIT_REACT_TEST_ID)
    await expect(host).toBeVisible()

    for (const expectation of cardExpectations) {
      const card = page.getByTestId(expectation.testId)
      await expect(card).toBeVisible()

      const metrics = await card.evaluate(node => {
        const el = node as HTMLElement
        const style = getComputedStyle(el)
        return {
          background: style.getPropertyValue('background-color').trim(),
          radius: style.getPropertyValue('border-radius').trim(),
          borderColor: style.getPropertyValue('border-top-color').trim(),
        }
      })

      expect(metrics.background).toBe(expectation.background)
      expect(metrics.radius).toBe(expectation.radius)
      expect(metrics.borderColor).toBe(expectation.borderColor)

      const badge = page.getByTestId(expectation.badgeTestId)
      await expect(badge).toBeVisible()
      const badgeColors = await badge.evaluate(node => {
        const style = getComputedStyle(node as HTMLElement)
        return {
          background: style.getPropertyValue('background-color').trim(),
          color: style.getPropertyValue('color').trim(),
        }
      })

      expect(badgeColors.color).toBe(expectation.badgeColor)
      expect(badgeColors.background).not.toBe('')
    }
  })
})
