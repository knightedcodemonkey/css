import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  generateTypes,
  runGenerateTypesCli,
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
    assert.ok(manifest['../src/styles/demo.css?knighted-css&types'])
  } finally {
    await project.cleanup()
  }
})

test('generateTypes removes stale manifest entries when declarations are missing', async () => {
  const project = await setupFixtureProject()
  try {
    const outDir = path.join(project.root, '.knighted-css-test')
    const typesRoot = path.join(project.root, '.knighted-css-types')
    const options = { rootDir: project.root, include: ['src'], outDir, typesRoot }
    await generateTypes(options)

    const manifestPath = path.join(outDir, 'manifest.json')
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Record<
      string,
      { file: string; hash: string }
    >
    manifest['./ghost.css?knighted-css'] = { file: 'ghost.d.ts', hash: 'ghost-hash' }
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2))

    const result = await generateTypes(options)
    assert.equal(result.removed, 0)
    const updatedManifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Record<
      string,
      { file: string; hash: string }
    >
    assert.ok(!updatedManifest['./ghost.css?knighted-css'])
  } finally {
    await project.cleanup()
  }
})

test('generateTypes reports warnings when specifiers cannot be resolved', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knighted-missing-spec-'))
  try {
    const srcDir = path.join(root, 'src')
    await fs.mkdir(srcDir, { recursive: true })
    await fs.writeFile(
      path.join(srcDir, 'entry.ts'),
      "import 'missing-package/style.css?knighted-css&types'\n",
    )
    const outDir = path.join(root, '.knighted-css-out')
    const typesRoot = path.join(root, '.knighted-css-types')
    const result = await generateTypes({
      rootDir: root,
      include: ['src'],
      outDir,
      typesRoot,
    })
    assert.equal(result.written, 0)
    assert.ok(result.warnings.some(w => w.includes('Unable to resolve')))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('generateTypes surfaces css extraction failures', async () => {
  const project = await setupFixtureProject()
  const { setCssWithMetaImplementation } = __generateTypesInternals
  try {
    const outDir = path.join(project.root, '.knighted-css-test')
    const typesRoot = path.join(project.root, '.knighted-css-types')
    setCssWithMetaImplementation(async () => {
      throw new Error('css failure')
    })
    const result = await generateTypes({
      rootDir: project.root,
      include: ['src'],
      outDir,
      typesRoot,
    })
    assert.equal(result.written, 0)
    assert.ok(result.warnings.some(w => w.includes('Failed to extract CSS')))
  } finally {
    setCssWithMetaImplementation()
    await project.cleanup()
  }
})

test('generateTypes completes with no declarations when no matching imports exist', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knighted-empty-spec-'))
  try {
    const srcDir = path.join(root, 'src')
    await fs.mkdir(srcDir, { recursive: true })
    await fs.writeFile(path.join(srcDir, 'entry.ts'), 'console.log("noop")\n')
    const outDir = path.join(root, '.knighted-css-out')
    const typesRoot = path.join(root, '.knighted-css-types')
    const result = await generateTypes({
      rootDir: root,
      include: ['src'],
      outDir,
      typesRoot,
    })
    assert.equal(result.written, 0)
    assert.equal(result.declarations.length, 0)
    assert.equal(result.warnings.length, 0)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('generateTypes ignores specifiers lacking the types flag', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knighted-missing-flag-'))
  try {
    const srcDir = path.join(root, 'src')
    const stylesDir = path.join(srcDir, 'styles')
    await fs.mkdir(stylesDir, { recursive: true })
    await fs.writeFile(path.join(stylesDir, 'demo.css'), '.demo { color: green; }\n')
    await fs.writeFile(
      path.join(srcDir, 'entry.ts'),
      "import './styles/demo.css?knighted-css'\n",
    )
    const outDir = path.join(root, '.knighted-css-out')
    const typesRoot = path.join(root, '.knighted-css-types')
    const result = await generateTypes({
      rootDir: root,
      include: ['src'],
      outDir,
      typesRoot,
    })
    assert.equal(result.written, 0)
    assert.equal(result.declarations.length, 0)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('generateTypes dedupes repeated specifiers', async () => {
  const project = await setupFixtureProject()
  try {
    const srcDir = path.join(project.root, 'src')
    const fixtureSource = path.join(
      __dirname,
      'fixtures',
      'dialects',
      'basic',
      'entry.js',
    )
    const relativeImport = path.relative(srcDir, fixtureSource).split(path.sep).join('/')
    const specifier = `${relativeImport}?knighted-css&types`
    const entrySource = `import { stableSelectors as firstSelectors } from '${specifier}'
import { stableSelectors as secondSelectors } from '${specifier}'
console.log(firstSelectors.demo, secondSelectors.demo)
`
    await fs.writeFile(path.join(srcDir, 'entry.ts'), entrySource)

    const outDir = path.join(project.root, '.knighted-css-out')
    const typesRoot = path.join(project.root, '.knighted-css-types')
    const result = await generateTypes({
      rootDir: project.root,
      include: ['src'],
      outDir,
      typesRoot,
    })
    assert.equal(result.written, 1)
    assert.equal(result.warnings.length, 0)
  } finally {
    await project.cleanup()
  }
})

test('runGenerateTypesCli executes generation and reports summaries', async () => {
  const project = await setupFixtureProject()
  try {
    const outDir = path.join(project.root, '.knighted-css-cli')
    const typesRoot = path.join(project.root, '.knighted-css-types-cli')
    const args = [
      '--root',
      project.root,
      '--include',
      'src',
      '--out-dir',
      outDir,
      '--types-root',
      typesRoot,
    ]
    const logs: string[] = []
    const warns: string[] = []
    const originalLog = console.log
    const originalWarn = console.warn
    try {
      console.log = (message: string) => logs.push(String(message))
      console.warn = (message: string) => warns.push(String(message))
      await runGenerateTypesCli(args)
      await runGenerateTypesCli(args)
    } finally {
      console.log = originalLog
      console.warn = originalWarn
    }
    assert.ok(logs.some(log => log.includes('[knighted-css] Updated 1 declaration(s)')))
    assert.ok(
      logs.some(log =>
        log.includes(
          'No changes to ?knighted-css&types declarations (cache is up to date).',
        ),
      ),
    )
    assert.equal(warns.length, 0)
    const manifestPath = path.join(outDir, 'manifest.json')
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Record<
      string,
      unknown
    >
    assert.equal(Object.keys(manifest).length, 1)
  } finally {
    await project.cleanup()
  }
})

test('runGenerateTypesCli prints help output when requested', async () => {
  const printed: string[] = []
  const originalLog = console.log
  try {
    console.log = (message: string) => printed.push(String(message))
    await runGenerateTypesCli(['--help'])
  } finally {
    console.log = originalLog
  }
  assert.ok(printed.some(line => line.includes('Usage: knighted-css-generate-types')))
})

test('generateTypes internals format selector-aware declarations', async () => {
  const {
    stripInlineLoader,
    splitResourceAndQuery,
    findSpecifierImports,
    resolveImportPath,
    resolvePackageRoot,
    buildDeclarationFileName,
    formatSelectorType,
    formatModuleDeclaration,
    buildDeclarationModuleSpecifier,
    buildCanonicalQuery,
    writeTypesIndex,
    normalizeIncludeOptions,
    collectCandidateFiles,
    normalizeTsconfigPaths,
    setModuleTypeDetector,
    setImportMetaUrlProvider,
    relativeToRoot,
    isNonRelativeSpecifier,
    createProjectPeerResolver,
    getProjectRequire,
    loadTsconfigResolutionContext,
    resolveWithTsconfigPaths,
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
  assert.deepEqual(splitResourceAndQuery('./demo.css'), {
    resource: './demo.css',
    query: '',
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
  assert.equal(formatSelectorType(new Map()), 'Readonly<Record<string, string>>')

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

  const canonicalSpecifier = buildDeclarationModuleSpecifier(
    path.join('/tmp/project', 'src', 'styles', 'demo.css'),
    path.join('/tmp/project', '.knighted-css'),
    '?types&knighted-css&foo=1',
  )
  assert.equal(canonicalSpecifier, '../src/styles/demo.css?knighted-css&types&foo=1')

  assert.equal(
    buildCanonicalQuery('?knighted-css&combined&no-default&types&foo=1'),
    '?knighted-css&combined&no-default&types&foo=1',
  )

  const normalized = normalizeIncludeOptions(undefined, '/tmp/demo')
  assert.deepEqual(normalized, ['/tmp/demo'])
  assert.deepEqual(normalizeIncludeOptions(['./src'], '/tmp/demo'), [
    path.resolve('/tmp/demo', './src'),
  ])

  const nonFileEntry = path.join(os.tmpdir(), 'knighted-non-file-entry')
  const resolvedNonFileEntry = path.resolve(nonFileEntry)
  const originalStat = fs.stat
  const fsModule = fs as typeof fs & { stat: typeof fs.stat }
  try {
    fsModule.stat = (async (...args) => {
      const [target] = args
      const normalizedTarget = path.resolve(
        target instanceof URL ? fileURLToPath(target) : (target?.toString() ?? ''),
      )
      if (normalizedTarget === resolvedNonFileEntry) {
        return {
          isDirectory: () => false,
          isFile: () => false,
        } as unknown as import('node:fs').Stats
      }
      return originalStat(...(args as Parameters<typeof originalStat>))
    }) as typeof fs.stat
    const collected = await collectCandidateFiles([nonFileEntry])
    assert.deepEqual(collected, [])
  } finally {
    fsModule.stat = originalStat
  }

  const collectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'knighted-collect-files-'))
  try {
    const entryFile = path.join(collectRoot, 'entry.ts')
    await fs.writeFile(entryFile, 'export {}\n')
    const duplicateResult = await collectCandidateFiles([entryFile, entryFile])
    assert.equal(duplicateResult.length, 1)

    const missingResult = await collectCandidateFiles([
      path.join(collectRoot, 'missing.ts'),
    ])
    assert.deepEqual(missingResult, [])

    const skipDir = path.join(collectRoot, 'node_modules')
    await fs.mkdir(skipDir, { recursive: true })
    const skipResult = await collectCandidateFiles([skipDir])
    assert.deepEqual(skipResult, [])
  } finally {
    await fs.rm(collectRoot, { recursive: true, force: true })
  }

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
    '@skip/*': undefined as unknown as string[],
  })
  assert.deepEqual(normalizedPaths, {
    '@demo/*': ['src/demo/*', 'fallback/*'],
  })
  assert.equal(normalizeTsconfigPaths(undefined), undefined)
  assert.equal(normalizeTsconfigPaths({ foo: [] }), undefined)
  assert.equal(
    normalizeTsconfigPaths({ foo: undefined as unknown as string[] }),
    undefined,
  )

  assert.equal(isNonRelativeSpecifier('pkg/component'), true)
  assert.equal(isNonRelativeSpecifier('./local'), false)
  assert.equal(isNonRelativeSpecifier('/absolute/path'), false)
  assert.equal(isNonRelativeSpecifier('http://example.com/style.css'), false)
  assert.equal(isNonRelativeSpecifier(''), false)

  const positionalParsed = parseCliArgs(['src', 'stories'])
  assert.deepEqual(positionalParsed.include, ['src', 'stories'])

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

  const peerRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'knighted-peer-resolver-'))
  try {
    await fs.writeFile(path.join(peerRoot, 'package.json'), '{}')
    const modulePath = path.join(peerRoot, 'demo.mjs')
    await fs.writeFile(modulePath, 'export const value = 42\n')
    const resolver = createProjectPeerResolver(peerRoot)
    const moduleNs = await resolver('./demo.mjs')
    assert.equal(moduleNs.value, 42)
  } finally {
    await fs.rm(peerRoot, { recursive: true, force: true })
  }

  assert.doesNotThrow(() => {
    const loader = getProjectRequire('relative-root')
    loader.resolve('node:path')
  })

  const tsconfigRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'knighted-tsconfig-empty-'),
  )
  try {
    await fs.writeFile(
      path.join(tsconfigRoot, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: {} }, null, 2),
    )
    const context = loadTsconfigResolutionContext(tsconfigRoot)
    assert.equal(context, undefined)
  } finally {
    await fs.rm(tsconfigRoot, { recursive: true, force: true })
  }

  const brokenTsconfigRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'knighted-tsconfig-bad-'),
  )
  try {
    await fs.writeFile(path.join(brokenTsconfigRoot, 'tsconfig.json'), '{ invalid')
    const context = loadTsconfigResolutionContext(brokenTsconfigRoot)
    assert.equal(context, undefined)
  } finally {
    await fs.rm(brokenTsconfigRoot, { recursive: true, force: true })
  }

  const aliasRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'knighted-tsconfig-alias-'))
  try {
    const aliasFile = path.join(aliasRoot, 'alias.css')
    await fs.writeFile(aliasFile, '.alias {}\n')
    const matchResolved = await resolveWithTsconfigPaths('alias-entry', {
      matchPath: () => aliasFile,
    })
    assert.equal(matchResolved, aliasFile)

    const nestedDir = path.join(aliasRoot, 'nested')
    await fs.mkdir(nestedDir, { recursive: true })
    const nestedFile = path.join(nestedDir, 'file.css')
    await fs.writeFile(nestedFile, '.nested {}\n')
    const baseUrlResolved = await resolveWithTsconfigPaths('nested/file.css', {
      absoluteBaseUrl: aliasRoot,
    })
    assert.equal(baseUrlResolved, nestedFile)

    const unresolved = await resolveWithTsconfigPaths('alias-missing', {
      matchPath: () => path.join(aliasRoot, 'missing.css'),
    })
    assert.equal(unresolved, undefined)
  } finally {
    await fs.rm(aliasRoot, { recursive: true, force: true })
  }

  assert.equal(await resolveWithTsconfigPaths('standalone'), undefined)

  const tsconfigWithPathsRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'knighted-tsconfig-combo-'),
  )
  try {
    await fs.mkdir(path.join(tsconfigWithPathsRoot, 'src'), { recursive: true })
    await fs.writeFile(
      path.join(tsconfigWithPathsRoot, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: {
            baseUrl: './src',
            paths: {
              '@alias/*': ['@alias/*'],
            },
          },
        },
        null,
        2,
      ),
    )
    const context = loadTsconfigResolutionContext(tsconfigWithPathsRoot)
    assert.ok(context?.absoluteBaseUrl)
    assert.ok(context?.matchPath)
  } finally {
    await fs.rm(tsconfigWithPathsRoot, { recursive: true, force: true })
  }

  const specifierRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'knighted-specifier-imports-'),
  )
  try {
    const plainFile = path.join(specifierRoot, 'plain.ts')
    await fs.writeFile(plainFile, 'console.log("no selectors here")\n')
    const noMatches = await findSpecifierImports(plainFile)
    assert.deepEqual(noMatches, [])

    const requireFile = path.join(specifierRoot, 'require.js')
    await fs.writeFile(
      requireFile,
      "const styles = require('./demo.css?knighted-css&types')\n",
    )
    const requireMatches = await findSpecifierImports(requireFile)
    assert.equal(requireMatches.length, 1)
    assert.equal(requireMatches[0]?.specifier, './demo.css?knighted-css&types')
    assert.equal(requireMatches[0]?.importer, requireFile)
    const missingMatches = await findSpecifierImports(
      path.join(specifierRoot, 'missing.js'),
    )
    assert.deepEqual(missingMatches, [])
  } finally {
    await fs.rm(specifierRoot, { recursive: true, force: true })
  }

  const fakeMetaDir = path.join(os.tmpdir(), 'knighted-meta', 'esm')
  const fakeModuleUrl = pathToFileURL(path.join(fakeMetaDir, 'index.js')).href
  try {
    setModuleTypeDetector(() => 'module')
    setImportMetaUrlProvider(() => fakeModuleUrl)
    const resolvedRoot = resolvePackageRoot()
    assert.equal(resolvedRoot, path.resolve(fakeMetaDir, '..'))
  } finally {
    setModuleTypeDetector()
    setImportMetaUrlProvider()
  }

  const resolveRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'knighted-resolve-import-'))
  try {
    await fs.mkdir(path.join(resolveRoot, 'src'), { recursive: true })
    await fs.writeFile(
      path.join(resolveRoot, 'package.json'),
      JSON.stringify({ name: 'resolve-fixture', version: '1.0.0' }, null, 2),
    )
    const importer = path.join(resolveRoot, 'src', 'entry.ts')
    const absoluteResult = await resolveImportPath(
      '/styles/demo.css',
      importer,
      resolveRoot,
    )
    assert.equal(absoluteResult, path.join(resolveRoot, 'styles', 'demo.css'))
    const missingResult = await resolveImportPath(
      'non-existent-module',
      importer,
      resolveRoot,
    )
    assert.equal(missingResult, undefined)
  } finally {
    await fs.rm(resolveRoot, { recursive: true, force: true })
  }

  const loaderErrorContext = loadTsconfigResolutionContext('/tmp/project', () => {
    throw new Error('tsconfig failure')
  })
  assert.equal(loaderErrorContext, undefined)

  const rooted = relativeToRoot(
    path.join('/tmp/project', 'src', 'demo.css'),
    '/tmp/project',
  )
  assert.equal(rooted, path.join('src', 'demo.css'))
  const outside = path.join(os.tmpdir(), 'outside.css')
  const outsideRelative = path.relative('/tmp/project', outside)
  assert.equal(relativeToRoot(outside, '/tmp/project'), outsideRelative)

  const indexRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'knighted-types-index-'))
  try {
    const outDir = path.join(indexRoot, 'out')
    await fs.mkdir(outDir, { recursive: true })
    const indexPath = path.join(indexRoot, 'index.d.ts')
    await writeTypesIndex(indexPath, {}, outDir)
    const indexContent = await fs.readFile(indexPath, 'utf8')
    assert.ok(indexContent.includes('Generated by @knighted/css/generate-types'))
    assert.ok(!indexContent.includes('<reference'))
  } finally {
    await fs.rm(indexRoot, { recursive: true, force: true })
  }
})

test('runGenerateTypesCli reports argument errors and sets exit code', async () => {
  const errors: string[] = []
  const originalError = console.error
  const previousExitCode = process.exitCode
  let observedExitCode: number | undefined
  try {
    console.error = (message: string) => errors.push(String(message))
    process.exitCode = undefined
    await runGenerateTypesCli(['--root'])
    observedExitCode = process.exitCode as number | undefined
  } finally {
    console.error = originalError
    process.exitCode = previousExitCode
  }
  assert.equal(errors.length >= 1, true)
  assert.ok(errors[0]?.includes('Missing value for --root'))
  assert.equal(observedExitCode, 1)
})

test('runGenerateTypesCli surfaces generator failures', async () => {
  const project = await setupFixtureProject()
  const errors: string[] = []
  const originalError = console.error
  const previousExitCode = process.exitCode
  let observedExitCode: number | undefined
  try {
    const outDirFile = path.join(project.root, 'conflict.txt')
    await fs.writeFile(outDirFile, 'conflict')
    console.error = (message: string) => errors.push(String(message))
    process.exitCode = undefined
    await runGenerateTypesCli([
      '--root',
      project.root,
      '--include',
      'src',
      '--out-dir',
      outDirFile,
      '--types-root',
      path.join(project.root, '.cli-types-error'),
    ])
    observedExitCode = process.exitCode as number | undefined
  } finally {
    console.error = originalError
    process.exitCode = previousExitCode
    await project.cleanup()
  }
  assert.ok(errors.some(line => line.includes('generate-types failed')))
  assert.equal(observedExitCode, 1)
})
