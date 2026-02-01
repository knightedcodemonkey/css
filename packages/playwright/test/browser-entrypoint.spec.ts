import { expect, test } from '@playwright/test'

test('loads browser entrypoint via importmap', async ({ page }) => {
  await page.goto('/browser-entrypoint.html')

  const cssResult = page.getByTestId('browser-entrypoint-css')
  await expect(cssResult).toHaveAttribute('data-ok', 'true')
  await expect(cssResult).toBeVisible()
  await expect(cssResult).toHaveText('.demo { color: rebeccapurple; }')

  const sassResult = page.getByTestId('browser-entrypoint-sass')
  await expect(sassResult).toHaveAttribute('data-ok', 'true')
  await expect(sassResult).toBeVisible()
  await expect(sassResult).toContainText('.demo')
  await expect(sassResult).not.toContainText('$color')

  const lessResult = page.getByTestId('browser-entrypoint-less')
  await expect(lessResult).toHaveAttribute('data-ok', 'true')
  await expect(lessResult).toBeVisible()
  await expect(lessResult).toContainText('.demo')
  await expect(lessResult).not.toContainText('@color')

  const moduleResult = page.getByTestId('browser-entrypoint-module')
  await expect(moduleResult).toHaveAttribute('data-ok', 'true')
  await expect(moduleResult).toBeVisible()
  await expect(moduleResult).toHaveAttribute('data-exports', /demo/)
})
