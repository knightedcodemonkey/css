import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { generateTypes } from '../src/generateTypes.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function setupFixtureProject(): Promise<{
  root: string
  cleanup: () => Promise<void>
}> {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'knighted-generate-types-'))
  const srcDir = path.join(tmpRoot, 'src')
  await fs.mkdir(srcDir, { recursive: true })
  const fixtureSource = path.join(__dirname, 'fixtures', 'dialects', 'basic', 'entry.js')
  const relativeImport = path.relative(srcDir, fixtureSource).split(path.sep).join('/')
  const specifier = `${relativeImport}?knighted-css&types`
  const entrySource = `import { stableSelectors } from '${specifier}'
console.log(stableSelectors.demo)
`
  await fs.writeFile(path.join(srcDir, 'entry.ts'), entrySource)
  return {
    root: tmpRoot,
    cleanup: () => fs.rm(tmpRoot, { recursive: true, force: true }),
  }
}

test('generateTypes emits declarations and reuses cache', async () => {
  const project = await setupFixtureProject()
  try {
    const firstRun = await generateTypes({ rootDir: project.root, include: ['src'] })
    assert.ok(firstRun.written >= 1)
    assert.equal(firstRun.removed, 0)
    assert.equal(firstRun.warnings.length, 0)

    const manifestPath = path.join(
      project.root,
      'node_modules',
      '.knighted-css',
      'manifest.json',
    )
    const manifestRaw = await fs.readFile(manifestPath, 'utf8')
    const manifest = JSON.parse(manifestRaw) as Record<string, { file: string }>
    const entries = Object.values(manifest)
    assert.equal(entries.length, 1)
    const declarationPath = path.join(
      project.root,
      'node_modules',
      '.knighted-css',
      entries[0]?.file ?? '',
    )
    const declaration = await fs.readFile(declarationPath, 'utf8')
    assert.ok(declaration.includes('stableSelectors'))
    assert.ok(declaration.includes('knighted-demo'))

    const indexContent = await fs.readFile(firstRun.typesIndexPath, 'utf8')
    assert.ok(indexContent.includes(entries[0]?.file ?? ''))

    const secondRun = await generateTypes({ rootDir: project.root, include: ['src'] })
    assert.equal(secondRun.written, 0)
    assert.equal(secondRun.removed, 0)
    assert.equal(secondRun.warnings.length, 0)
  } finally {
    await project.cleanup()
  }
})
