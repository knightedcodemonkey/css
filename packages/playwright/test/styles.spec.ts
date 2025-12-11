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
    const rowGap = parseFloat(style.getPropertyValue('row-gap'))
    const columnGap = parseFloat(style.getPropertyValue('column-gap'))
    return {
      gap: Math.max(rowGap, columnGap),
      letterSpacing: parseFloat(style.getPropertyValue('letter-spacing')),
    }
  })

  expect(metrics.gap).toBeGreaterThan(0)
  expect(metrics.letterSpacing).toBeGreaterThan(0)
})
