import { defineConfig, devices } from '@playwright/test'

const isCI = process.env.CI === 'true'
const projects = [
  {
    name: 'chromium',
    use: { ...devices['Desktop Chrome'] },
  },
]

if (isCI) {
  projects.push({
    name: 'webkit',
    use: { ...devices['Desktop Safari'] },
  })
}

export default defineConfig({
  testDir: 'test',
  timeout: 10_000,
  retries: isCI ? 1 : 0,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run preview',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
  projects,
})
