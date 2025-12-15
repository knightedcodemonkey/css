import { expect, test } from '@playwright/test'
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const workspaceRoot = path.resolve(__dirname, '..')
const queryTypesConfig = path.resolve(workspaceRoot, 'tsconfig.query-types.json')
const queryTypesStableNamespaceConfig = path.resolve(
  workspaceRoot,
  'tsconfig.query-types-stable-namespace.json',
)
const repositoryRoot = path.resolve(workspaceRoot, '..', '..')
const packageLoaderQueries = path.resolve(
  repositoryRoot,
  'packages/css/loader-queries.d.ts',
)
const installedLoaderQueries = path.resolve(
  workspaceRoot,
  'node_modules/@knighted/css/loader-queries.d.ts',
)

function runTypecheck(project: string): SpawnSyncReturns<string> {
  return spawnSync(
    'npm',
    ['exec', '--', 'tsc', '--project', project, '--pretty', 'false'],
    {
      cwd: workspaceRoot,
      encoding: 'utf-8',
      stdio: 'pipe',
    },
  )
}

test.describe('loader query typings', () => {
  test('ambient declarations stay in sync with consumer DX', () => {
    syncLoaderDeclarations()
    const result = runTypecheck(queryTypesConfig)
    expect(result.status, formatOutput(result)).toBe(0)
    expect(result.stderr).toBe('')
  })

  test('stableNamespace imports still require consumer-provided types', () => {
    syncLoaderDeclarations()
    const result = runTypecheck(queryTypesStableNamespaceConfig)
    expect(result.status).not.toBe(0)
    expect(result.stdout).toMatch(/TS2307/)
  })
})

function syncLoaderDeclarations() {
  fs.copyFileSync(packageLoaderQueries, installedLoaderQueries)
}

function formatOutput(result: SpawnSyncReturns<string>) {
  return [`stdout:`, result.stdout?.trim() ?? '', `stderr:`, result.stderr?.trim() ?? '']
    .filter(Boolean)
    .join('\n')
}
