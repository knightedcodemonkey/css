import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'

import { __sassInternals, type CssResolver } from '../src/sassInternals.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const sassFixturesDir = path.resolve(__dirname, './fixtures/sass-paths')

function resetEnv(key: string, value?: string) {
  if (typeof value === 'undefined') {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

test('sass importer reports debug logs and resolves alias plus relative specifiers', async () => {
  const previous = process.env.KNIGHTED_CSS_DEBUG_SASS
  process.env.KNIGHTED_CSS_DEBUG_SASS = '1'
  const originalError = console.error
  const captured: string[] = []
  ;(console as Console).error = (...args: unknown[]) => {
    captured.push(args.map(arg => String(arg)).join(' '))
  }

  const resolver: CssResolver = async specifier => {
    if (specifier === 'alias:entry') {
      return path.join(sassFixturesDir, 'entry.scss')
    }
    return undefined
  }

  try {
    const importer = __sassInternals.createSassImporter({
      cwd: sassFixturesDir,
      resolver,
    })
    assert.ok(importer, 'expected importer to be created')

    const missing = await importer.canonicalize('alias:missing', {
      containingUrl: pathToFileURL(path.join(sassFixturesDir, 'entry.scss')),
    })
    assert.equal(missing, null)

    const aliasUrl = await importer.canonicalize('alias:entry')
    assert.ok(aliasUrl, 'resolved alias should return a file url')

    const relativeUrl = await importer.canonicalize('./partial.scss', {
      containingUrl: pathToFileURL(path.join(sassFixturesDir, 'entry.scss')),
    })
    assert.ok(relativeUrl, 'relative specifier should resolve via ensureSassPath')
    assert.match(relativeUrl!.href, /_partial\.scss$/)

    const ignored = await importer.canonicalize('http://example.com/reset.css', {
      containingUrl: pathToFileURL(path.join(sassFixturesDir, 'entry.scss')),
    })
    assert.equal(ignored, null)

    const loaded = await importer.load(aliasUrl!)
    assert.ok(loaded.contents.includes('@use'), 'load() should read file contents')
    assert.equal(loaded.syntax, 'scss')
  } finally {
    ;(console as Console).error = originalError
    resetEnv('KNIGHTED_CSS_DEBUG_SASS', previous)
  }

  assert.ok(
    captured.some(line => line.includes('canonicalize request')),
    'expected debug log for canonicalize request',
  )
  assert.ok(
    captured.some(line => line.includes('resolver returned no result')),
    'expected debug log when resolver fails',
  )
  assert.ok(
    captured.some(line => line.includes('canonical url')),
    'expected debug log when canonical url resolved',
  )
})

test('ensureSassPath and relative resolver fallbacks', () => {
  const { ensureSassPath, resolveRelativeSpecifier } = __sassInternals
  const entryUrl = pathToFileURL(path.join(sassFixturesDir, 'entry.scss'))

  const direct = ensureSassPath(path.join(sassFixturesDir, 'entry.scss'))
  assert.equal(direct, path.join(sassFixturesDir, 'entry.scss'))

  const partial = ensureSassPath(path.join(sassFixturesDir, 'partial.scss'))
  assert.equal(partial, path.join(sassFixturesDir, '_partial.scss'))

  const index = ensureSassPath(path.join(sassFixturesDir, 'component.scss'))
  assert.equal(index, path.join(sassFixturesDir, 'component', 'index.scss'))

  const partialIndex = ensureSassPath(path.join(sassFixturesDir, 'block.scss'))
  assert.equal(partialIndex, path.join(sassFixturesDir, 'block', '_index.scss'))

  const relative = resolveRelativeSpecifier('./partial.scss', entryUrl)
  assert.ok(relative?.endsWith('_partial.scss'))

  const schemeIgnored = resolveRelativeSpecifier('http://example.com/foo.scss', entryUrl)
  assert.equal(schemeIgnored, undefined)
})

test('resolveAliasSpecifier normalizes returned file urls', async () => {
  const target = path.join(sassFixturesDir, 'entry.scss')
  const asFileUrl = pathToFileURL(target).href
  const result = await __sassInternals.resolveAliasSpecifier(
    'alias:file-url',
    async () => asFileUrl,
    sassFixturesDir,
  )
  assert.equal(result, target)
})

test('sass importer resolves pkg: specifiers via oxc-resolver', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knighted-sass-pkg-'))
  try {
    const srcDir = path.join(root, 'src')
    const stylesDir = path.join(srcDir, 'styles')
    await fs.mkdir(stylesDir, { recursive: true })
    await fs.writeFile(path.join(stylesDir, 'color.scss'), '.color { color: red; }')
    await fs.writeFile(
      path.join(root, 'package.json'),
      JSON.stringify(
        {
          name: 'knighted-sass-pkg-fixture',
          type: 'module',
          imports: {
            '#styles/*': './src/styles/*',
          },
        },
        null,
        2,
      ),
    )
    const importer = __sassInternals.createSassImporter({ cwd: root })
    assert.ok(importer, 'expected importer to be created')

    const containing = pathToFileURL(path.join(srcDir, 'entry.scss'))
    const resolved = await importer.canonicalize('pkg:#styles/color.scss', {
      containingUrl: containing,
    })
    assert.ok(resolved, 'expected pkg: specifier to resolve')
    assert.ok(resolved?.href.endsWith('/color.scss'))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
