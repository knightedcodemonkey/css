import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  generateTypes,
  __generateTypesInternals,
  type ParsedCliArgs,
} from '../src/generateTypes.ts'

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

async function setupBaseUrlFixture(): Promise<{
  root: string
  cleanup: () => Promise<void>
}> {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'knighted-tsconfig-'))
  const srcDir = path.join(tmpRoot, 'src')
  const stylesDir = path.join(srcDir, 'styles')
  await fs.mkdir(stylesDir, { recursive: true })
  const cssPath = path.join(stylesDir, 'demo.css')
  await fs.writeFile(
    cssPath,
    `.demo { color: rebeccapurple; }
.knighted-demo { color: teal; }
`,
  )
  const specifier = 'styles/demo.css?knighted-css&types'
  const entrySource = `import { stableSelectors } from '${specifier}'
console.log(stableSelectors.demo)
`
  await fs.writeFile(path.join(srcDir, 'entry.ts'), entrySource)
  const tsconfig = {
    compilerOptions: {
      baseUrl: './src',
    },
  }
  await fs.writeFile(
    path.join(tmpRoot, 'tsconfig.json'),
    JSON.stringify(tsconfig, null, 2),
  )
  return {
    root: tmpRoot,
    cleanup: () => fs.rm(tmpRoot, { recursive: true, force: true }),
  }
}

test('generateTypes emits declarations and reuses cache', async () => {
  const project = await setupFixtureProject()
  try {
    const outDir = path.join(project.root, '.knighted-css-test')
    const typesRoot = path.join(project.root, '.knighted-css-types')
    const sharedOptions = { rootDir: project.root, include: ['src'], outDir, typesRoot }

    const firstRun = await generateTypes(sharedOptions)
    assert.ok(firstRun.written >= 1)
    assert.equal(firstRun.removed, 0)
    assert.equal(firstRun.warnings.length, 0)

    const manifestPath = path.join(firstRun.outDir, 'manifest.json')
    const manifestRaw = await fs.readFile(manifestPath, 'utf8')
    const manifest = JSON.parse(manifestRaw) as Record<string, { file: string }>
    const entries = Object.values(manifest)
    assert.equal(entries.length, 1)
    const declarationPath = path.join(firstRun.outDir, entries[0]?.file ?? '')
    const declaration = await fs.readFile(declarationPath, 'utf8')
    assert.ok(declaration.includes('stableSelectors'))
    assert.ok(declaration.includes('knighted-demo'))

    const indexContent = await fs.readFile(firstRun.typesIndexPath, 'utf8')
    assert.ok(indexContent.includes(entries[0]?.file ?? ''))

    const secondRun = await generateTypes(sharedOptions)
    assert.equal(secondRun.written, 0)
    assert.equal(secondRun.removed, 0)
    assert.equal(secondRun.warnings.length, 0)
  } finally {
    await project.cleanup()
  }
})

test('generateTypes resolves tsconfig baseUrl specifiers', async () => {
  const project = await setupBaseUrlFixture()
  try {
    const outDir = path.join(project.root, '.knighted-css-test')
    const typesRoot = path.join(project.root, '.knighted-css-types')
    const result = await generateTypes({
      rootDir: project.root,
      include: ['src'],
      outDir,
      typesRoot,
    })
    assert.ok(result.written >= 1)
    assert.equal(result.warnings.length, 0)
    const manifestPath = path.join(outDir, 'manifest.json')
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Record<
      string,
      unknown
    >
    assert.ok(manifest['styles/demo.css?knighted-css&types'])
  } finally {
    await project.cleanup()
  }
})

test('generateTypes internals format selector-aware declarations', () => {
  const {
    stripInlineLoader,
    splitResourceAndQuery,
    buildDeclarationFileName,
    formatSelectorType,
    formatModuleDeclaration,
    normalizeIncludeOptions,
    normalizeTsconfigPaths,
    isNonRelativeSpecifier,
    parseCliArgs,
    printHelp,
    reportCliResult,
  } = __generateTypesInternals

  assert.equal(
    stripInlineLoader('style-loader!css-loader!./demo.css?knighted-css&types'),
    './demo.css?knighted-css&types',
  )

  assert.deepEqual(splitResourceAndQuery('./demo.css?knighted-css#hash'), {
    resource: './demo.css',
    query: '?knighted-css',
  })

  const selectorMap = new Map([
    ['beta', 'knighted-beta'],
    ['alpha', 'knighted-alpha'],
  ])
  const hashedName = buildDeclarationFileName('./demo.css?knighted-css')
  assert.match(hashedName, /^knt-[a-f0-9]{12}\.d\.ts$/)
  const selectorType = formatSelectorType(selectorMap)
  assert.match(selectorType, /readonly "alpha": "knighted-alpha"/)
  assert.match(selectorType, /readonly "beta": "knighted-beta"/)

  const declaration = formatModuleDeclaration(
    './demo.css?knighted-css&combined',
    'combined',
    selectorMap,
  )
  assert.match(declaration, /declare module/)
  assert.match(declaration, /export const stableSelectors/)

  const withoutDefault = formatModuleDeclaration(
    './demo.css?knighted-css&combined&named-only',
    'combinedWithoutDefault',
    selectorMap,
  )
  assert.doesNotMatch(withoutDefault, /export default/)

  const normalized = normalizeIncludeOptions(undefined, '/tmp/demo')
  assert.deepEqual(normalized, ['/tmp/demo'])
  assert.deepEqual(normalizeIncludeOptions(['./src'], '/tmp/demo'), [
    path.resolve('/tmp/demo', './src'),
  ])

  const parsed = parseCliArgs([
    '--root',
    '/tmp/project',
    '--include',
    'src',
    '--stable-namespace',
    'storybook',
    '--out-dir',
    '.knighted-css',
    '--types-root',
    './types',
  ]) as ParsedCliArgs
  assert.equal(parsed.rootDir, path.resolve('/tmp/project'))
  assert.deepEqual(parsed.include, ['src'])
  assert.equal(parsed.stableNamespace, 'storybook')

  assert.throws(() => parseCliArgs(['--root']), /Missing value/)
  assert.throws(() => parseCliArgs(['--include']), /Missing value/)
  assert.throws(() => parseCliArgs(['--out-dir']), /Missing value/)
  assert.throws(() => parseCliArgs(['--types-root']), /Missing value/)
  assert.throws(() => parseCliArgs(['--stable-namespace']), /Missing value/)
  assert.throws(() => parseCliArgs(['--wat']), /Unknown flag/)
  const helpParsed = parseCliArgs(['--help'])
  assert.equal(helpParsed.help, true)

  const normalizedPaths = normalizeTsconfigPaths({
    '@demo/*': ['src/demo/*', 'fallback/*'],
    '@empty/*': [],
  })
  assert.deepEqual(normalizedPaths, {
    '@demo/*': ['src/demo/*', 'fallback/*'],
  })
  assert.equal(normalizeTsconfigPaths(undefined), undefined)
  assert.equal(normalizeTsconfigPaths({ foo: [] }), undefined)

  assert.equal(isNonRelativeSpecifier('pkg/component'), true)
  assert.equal(isNonRelativeSpecifier('./local'), false)
  assert.equal(isNonRelativeSpecifier('/absolute/path'), false)
  assert.equal(isNonRelativeSpecifier('http://example.com/style.css'), false)

  const printed: string[] = []
  const logged = console.log
  try {
    console.log = (message: string) => printed.push(message)
    printHelp()
  } finally {
    console.log = logged
  }
  assert.ok(printed.join('\n').includes('Usage: knighted-css-generate-types'))

  const summaryLogs: string[] = []
  const summaryWarns: string[] = []
  const originalLog = console.log
  const originalWarn = console.warn
  try {
    console.log = (msg: string) => summaryLogs.push(msg)
    console.warn = (msg: string) => summaryWarns.push(msg)
    reportCliResult({
      written: 0,
      removed: 0,
      declarations: [],
      warnings: ['warn'],
      outDir: '/tmp/types',
      typesIndexPath: '/tmp/types/index.d.ts',
    })
    reportCliResult({
      written: 2,
      removed: 1,
      declarations: [],
      warnings: [],
      outDir: '/tmp/types',
      typesIndexPath: '/tmp/types/index.d.ts',
    })
  } finally {
    console.log = originalLog
    console.warn = originalWarn
  }
  assert.ok(
    summaryLogs.some(log =>
      log.includes(
        'No changes to ?knighted-css&types declarations (cache is up to date).',
      ),
    ),
  )
  assert.ok(summaryLogs.some(log => log.includes('Updated 2 declaration(s)')))
  assert.equal(summaryWarns.length, 1)
})
