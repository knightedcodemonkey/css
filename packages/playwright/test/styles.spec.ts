import { expect, test } from '@playwright/test'

const cases = [
  { id: 'dialect-basic', property: 'color' },
  { id: 'dialect-scss', property: 'color' },
  { id: 'dialect-sass-indented', property: 'color' },
  { id: 'dialect-less', property: 'color' },
  { id: 'dialect-vanilla', property: 'color' },
]

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

for (const item of cases) {
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

test('vanilla-extract sprinkles compose utility classes', async ({ page }) => {
  const el = page.getByTestId('dialect-vanilla')
  await expect(el).toBeVisible()
  const metrics = await el.evaluate(node => {
    const style = getComputedStyle(node as HTMLElement)
    return {
      textTransform: style.getPropertyValue('text-transform').trim(),
      gap: style.getPropertyValue('gap').trim(),
      letterSpacing: style.getPropertyValue('letter-spacing').trim(),
    }
  })

  expect(metrics.gap).not.toBe('')
  expect(metrics.gap).not.toBe('0px')
  expect(metrics.letterSpacing).not.toBe('')
  expect(metrics.letterSpacing).not.toBe('0px')
  expect(metrics.textTransform).toBe('uppercase')
})
