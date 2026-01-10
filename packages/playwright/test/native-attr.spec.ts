import { expect, test } from '@playwright/test'

// Only Chromium supports CSS import attributes today; skip WebKit/Firefox.
// The bundled path is exercised separately via the Lit/React attribute card in lit-react.spec.ts.
test.skip(
  ({ browserName }) => browserName !== 'chromium',
  'CSS import attributes not supported',
)

test.describe('Native import attributes (no bundler)', () => {
  test('applies styles via with { type: "css" }', async ({ page }) => {
    await page.goto('/src/native-attr/index.html')

    const target = page.getByTestId('native-attr-shell').locator('#native-attr-target')
    await expect(target).toBeVisible()

    const styles = await target.evaluate(node => {
      const el = node as HTMLElement
      const style = getComputedStyle(el)
      return {
        color: style.getPropertyValue('color').trim(),
        background: style.getPropertyValue('background-image').trim(),
        border: style.getPropertyValue('border-top-color').trim(),
      }
    })

    expect(styles.color).toBe('rgb(15, 23, 42)')
    expect(styles.background).toContain('linear-gradient')
    expect(styles.border).toBe('rgb(99, 102, 241)')
  })
})
