import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
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

const SNAPSHOT_DIR = path.join(__dirname, '__snapshots__')
const CLI_SNAPSHOT_FILE = path.join(SNAPSHOT_DIR, 'generateTypes.snap.json')
const UPDATE_SNAPSHOTS =
  process.env.UPDATE_SNAPSHOTS === '1' || process.env.UPDATE_SNAPSHOTS === 'true'

const {
  parseCliArgs,
  loadResolverModule,
  resolveWithExtensionFallback,
  resolveIndexFallback,
  readManifest,
  writeSidecarManifest,
  hasStyleImports,
} = __generateTypesInternals

let cachedCliSnapshots: Record<string, string> | null = null

async function setupFixtureProject(): Promise<{
  root: string
  cleanup: () => Promise<void>
}> {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'knighted-generate-types-'))
  const root = await fs.realpath(tmpRoot)
  const srcDir = path.join(root, 'src')
  await fs.mkdir(srcDir, { recursive: true })
  const fixtureDir = path.join(__dirname, 'fixtures', 'dialects', 'basic')
  const projectFixtureDir = path.join(srcDir, 'fixture')
  await fs.cp(fixtureDir, projectFixtureDir, { recursive: true })
  const fixtureSource = path.join(projectFixtureDir, 'entry.js')
  const relativeImport = path.relative(srcDir, fixtureSource).split(path.sep).join('/')
  const specifier = `./${relativeImport}.knighted-css`
  const entrySource = `import stableSelectors from '${specifier}'
console.log(stableSelectors.demo)
`
  await fs.writeFile(path.join(srcDir, 'entry.ts'), entrySource)
  return {
    root,
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  }
}

async function setupDeclarationFixture(): Promise<{
  root: string
  cleanup: () => Promise<void>
}> {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'knighted-declaration-'))
  const root = await fs.realpath(tmpRoot)
  const srcDir = path.join(root, 'src')
  await fs.mkdir(srcDir, { recursive: true })
  await fs.writeFile(
    path.join(srcDir, 'button.css'),
    '.knighted-button { color: rebeccapurple; }\n',
  )
  await fs.writeFile(
    path.join(srcDir, 'button.tsx'),
    "import './button.css'\nexport function Button() { return null }\n",
  )
  return {
    root,
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  }
}

async function setupBaseUrlFixture(): Promise<{
  root: string
  cleanup: () => Promise<void>
}> {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'knighted-tsconfig-'))
  const root = await fs.realpath(tmpRoot)
  const srcDir = path.join(root, 'src')
  const stylesDir = path.join(srcDir, 'styles')
  await fs.mkdir(stylesDir, { recursive: true })
  const cssPath = path.join(stylesDir, 'demo.css')
  await fs.writeFile(
    cssPath,
    `.demo { color: rebeccapurple; }
.knighted-demo { color: teal; }
`,
  )
  const specifier = 'styles/demo.css.knighted-css'
  const entrySource = `import stableSelectors from '${specifier}'
console.log(stableSelectors.demo)
`
  await fs.writeFile(path.join(srcDir, 'entry.ts'), entrySource)
  const tsconfig = {
    compilerOptions: {
      baseUrl: './src',
    },
  }
  await fs.writeFile(path.join(root, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2))
  return {
    root,
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  }
}

async function setupPackageImportsFixture(): Promise<{
  root: string
  cleanup: () => Promise<void>
}> {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'knighted-imports-'))
  const root = await fs.realpath(tmpRoot)
  const srcDir = path.join(root, 'src')
  await fs.mkdir(srcDir, { recursive: true })
  const cssPath = path.join(srcDir, 'imports.css')
  await fs.writeFile(
    cssPath,
    `.demo { color: hotpink; }
.knighted-demo { color: rebeccapurple; }
`,
  )
  const entrySource = `import stableSelectors from '#styles.knighted-css'
console.log(stableSelectors.demo)
`
  await fs.writeFile(path.join(srcDir, 'entry.ts'), entrySource)
  await fs.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify(
      {
        name: 'knighted-imports-fixture',
        type: 'module',
        imports: {
          '#styles': './src/imports.css',
        },
      },
      null,
      2,
    ),
  )
  return {
    root,
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  }
}

async function setupHashImportsWorkspaceFixture(): Promise<{
  root: string
  cleanup: () => Promise<void>
}> {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'knighted-hash-imports-'))
  const root = await fs.realpath(tmpRoot)
  const sourceRoot = path.resolve(
    __dirname,
    '..',
    '..',
    'playwright',
    'src',
    'hash-imports-workspace',
  )
  await fs.cp(sourceRoot, root, { recursive: true })
  return {
    root,
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

async function loadCliSnapshots(): Promise<Record<string, string>> {
  if (cachedCliSnapshots) {
    return cachedCliSnapshots
  }
  try {
    const raw = await fs.readFile(CLI_SNAPSHOT_FILE, 'utf8')
    cachedCliSnapshots = JSON.parse(raw) as Record<string, string>
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException
    if (nodeError.code === 'ENOENT') {
      cachedCliSnapshots = {}
    } else {
      throw error
    }
  }
  return cachedCliSnapshots
}

async function writeCliSnapshots(map: Record<string, string>): Promise<void> {
  cachedCliSnapshots = map
  await fs.mkdir(SNAPSHOT_DIR, { recursive: true })
  await fs.writeFile(CLI_SNAPSHOT_FILE, `${JSON.stringify(map, null, 2)}\n`)
}

function normalizeSnapshotText(value: string): string {
  let next = value.replace(/\r\n/g, '\n')
  if (path.sep === '\\') {
    next = next.replace(/\\/g, '/')
  }
  return next.trimEnd()
}

function replaceAllVariants(value: string, raw: string, token: string): string {
  const posix = raw.split(path.sep).join('/')
  const win = raw.split(path.sep).join('\\')
  const variants = new Set([raw, path.normalize(raw), posix, win])
  let result = value
  for (const variant of variants) {
    if (!variant || variant === token) {
      continue
    }
    result = result.split(variant).join(token)
  }
  return result
}

function applyPathPlaceholders(
  value: string,
  placeholders: Record<string, string>,
): string {
  let result = value
  const entries = Object.entries(placeholders).sort(([a], [b]) => b.length - a.length)
  for (const [raw, token] of entries) {
    if (!raw) {
      continue
    }
    result = replaceAllVariants(result, raw, token)
  }
  return result
}

function buildCliTranscript(
  logs: string[],
  warns: string[],
  placeholders: Record<string, string> = {},
): string {
  const sections = ['[log]', ...logs, '[warn]', ...warns]
  const combined = sections.join('\n')
  return normalizeSnapshotText(applyPathPlaceholders(combined, placeholders))
}

async function expectCliSnapshot(name: string, value: string): Promise<void> {
  const normalized = normalizeSnapshotText(value)
  const snapshots = await loadCliSnapshots()
  const existing = snapshots[name]
  if (UPDATE_SNAPSHOTS) {
    if (existing !== normalized) {
      snapshots[name] = normalized
      await writeCliSnapshots(snapshots)
    }
    return
  }
  assert.ok(
    existing,
    `Snapshot "${name}" is missing. Re-run with UPDATE_SNAPSHOTS=1 to record it.`,
  )
  assert.equal(
    normalized,
    existing,
    `Snapshot mismatch for "${name}". Re-run with UPDATE_SNAPSHOTS=1 to update.`,
  )
}

test('generateTypes emits declarations and reuses cache', async () => {
  const project = await setupFixtureProject()
  try {
    const outDir = path.join(project.root, '.knighted-css-test')
    const sharedOptions = { rootDir: project.root, include: ['src'], outDir }

    const firstRun = await generateTypes(sharedOptions)
    assert.ok(firstRun.selectorModulesWritten >= 1)
    assert.equal(firstRun.selectorModulesRemoved, 0)
    assert.equal(firstRun.warnings.length, 0)

    const selectorModulePath = path.join(
      project.root,
      'src',
      'fixture',
      'entry.knighted-css.ts',
    )
    const selectorModule = await fs.readFile(selectorModulePath, 'utf8')
    assert.ok(selectorModule.includes("export * from './entry.js'"))
    assert.ok(
      selectorModule.includes("export { knightedCss } from './entry.js?knighted-css'"),
    )
    assert.ok(selectorModule.includes('export const stableSelectors'))
    assert.ok(selectorModule.includes('"demo": "knighted-demo"'))

    const selectorManifestPath = path.join(outDir, 'selector-modules.json')
    const selectorManifest = JSON.parse(
      await fs.readFile(selectorManifestPath, 'utf8'),
    ) as Record<string, { file: string; hash: string }>
    const selectorEntries = Object.values(selectorManifest)
    assert.equal(selectorEntries.length, 1)
    assert.equal(selectorEntries[0]?.file, selectorModulePath)

    const secondRun = await generateTypes(sharedOptions)
    assert.equal(secondRun.selectorModulesWritten, 0)
    assert.equal(secondRun.selectorModulesRemoved, 0)
    assert.equal(secondRun.warnings.length, 0)
  } finally {
    await project.cleanup()
  }
})

test('generateTypes declaration mode emits module augmentations', async () => {
  const project = await setupDeclarationFixture()
  try {
    const outDir = path.join(project.root, '.knighted-css-declaration')
    const result = await generateTypes({
      rootDir: project.root,
      include: ['src'],
      outDir,
      mode: 'declaration',
    })
    assert.ok(result.selectorModulesWritten >= 1)
    assert.ok(result.warnings.length >= 1)

    const declarationPath = path.join(project.root, 'src', 'button.tsx.d.ts')
    const declaration = await fs.readFile(declarationPath, 'utf8')
    assert.ok(declaration.includes("declare module './button.js'"))
    assert.ok(declaration.includes('export const knightedCss: string'))
    assert.ok(declaration.includes('export const stableSelectors'))
    assert.ok(declaration.includes('"button": string'))
    assert.ok(!declaration.includes("export { default } from './button.js'"))
    assert.ok(!declaration.includes("export * from './button.js'"))
    assert.ok(declaration.includes('// @knighted-css'))
  } finally {
    await project.cleanup()
  }
})

test('generateTypes declaration mode writes sidecar manifest when requested', async () => {
  const project = await setupDeclarationFixture()
  try {
    const outDir = path.join(project.root, '.knighted-css-declaration')
    const manifestPath = path.join(outDir, 'knighted-manifest.json')
    const result = await generateTypes({
      rootDir: project.root,
      include: ['src'],
      outDir,
      mode: 'declaration',
      manifestPath,
    })

    assert.equal(result.sidecarManifestPath, manifestPath)
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Record<
      string,
      { file?: string }
    >
    const key = path.join(project.root, 'src', 'button.tsx').split(path.sep).join('/')
    assert.equal(manifest[key]?.file, path.join(project.root, 'src', 'button.tsx.d.ts'))
  } finally {
    await project.cleanup()
  }
})

test('generateTypes declaration mode skips files without style imports', async () => {
  const project = await setupDeclarationFixture()
  try {
    await fs.writeFile(
      path.join(project.root, 'src', 'no-styles.tsx'),
      'export const noop = true\n',
    )
    const outDir = path.join(project.root, '.knighted-css-declaration')
    const result = await generateTypes({
      rootDir: project.root,
      include: ['src'],
      outDir,
      mode: 'declaration',
    })

    const declPath = path.join(project.root, 'src', 'no-styles.tsx.d.ts')
    const exists = await pathExists(declPath)
    assert.equal(exists, false)
    assert.ok(result.selectorModulesWritten >= 1)
  } finally {
    await project.cleanup()
  }
})

test('hasStyleImports treats vanilla extract modules as style imports', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knighted-vanilla-'))
  try {
    const srcDir = path.join(root, 'src')
    await fs.mkdir(srcDir, { recursive: true })
    await fs.writeFile(
      path.join(srcDir, 'styles.css.ts'),
      "export const theme = { color: 'rebeccapurple' }\n",
    )
    const entryPath = path.join(srcDir, 'entry.ts')
    await fs.writeFile(entryPath, "import './styles.css.ts'\n")

    const hasStyles = await hasStyleImports(entryPath, { rootDir: root })
    assert.equal(hasStyles, true)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('generateTypes hashed emits selector proxies for modules', async () => {
  const project = await setupFixtureProject()
  try {
    const outDir = path.join(project.root, '.knighted-css-test')
    const result = await generateTypes({
      rootDir: project.root,
      include: ['src'],
      outDir,
      hashed: true,
    })
    assert.ok(result.selectorModulesWritten >= 1)
    assert.equal(result.warnings.length, 0)

    const selectorModulePath = path.join(
      project.root,
      'src',
      'fixture',
      'entry.knighted-css.ts',
    )
    const selectorModule = await fs.readFile(selectorModulePath, 'utf8')
    assert.ok(
      selectorModule.includes(
        "import { knightedCss as __knightedCss, knightedCssModules as __knightedCssModules } from './entry.js?knighted-css'",
      ),
    )
    assert.ok(selectorModule.includes('export const selectors'))
    assert.ok(selectorModule.includes('export const knightedCssModules'))
    assert.ok(!selectorModule.includes('stableSelectors'))
  } finally {
    await project.cleanup()
  }
})

test('generateTypes declaration hashed emits selector exports', async () => {
  const project = await setupDeclarationFixture()
  try {
    const outDir = path.join(project.root, '.knighted-css-declaration')
    const result = await generateTypes({
      rootDir: project.root,
      include: ['src'],
      outDir,
      mode: 'declaration',
      hashed: true,
    })
    assert.ok(result.selectorModulesWritten >= 1)
    const declarationPath = path.join(project.root, 'src', 'button.tsx.d.ts')
    const declaration = await fs.readFile(declarationPath, 'utf8')
    assert.ok(declaration.includes('export const selectors'))
    assert.ok(!declaration.includes('stableSelectors'))
  } finally {
    await project.cleanup()
  }
})

test('parseCliArgs validates flags and combinations', () => {
  assert.throws(() => parseCliArgs(['--root']), /Missing value for --root/)
  assert.throws(() => parseCliArgs(['--include']), /Missing value for --include/)
  assert.throws(() => parseCliArgs(['--out-dir']), /Missing value for --out-dir/)
  assert.throws(() => parseCliArgs(['--manifest']), /Missing value for --manifest/)
  assert.throws(() => parseCliArgs(['--mode', 'unknown']), /Unknown mode: unknown/)
  assert.throws(() => parseCliArgs(['--unknown']), /Unknown flag: --unknown/)
  assert.throws(
    () => parseCliArgs(['--auto-stable', '--hashed']),
    /Cannot combine --auto-stable with --hashed/,
  )
})

test('loadResolverModule resolves default, named, and file URL exports', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knighted-resolver-'))
  try {
    const defaultPath = path.join(root, 'default-resolver.mjs')
    const namedPath = path.join(root, 'named-resolver.mjs')
    const badPath = path.join(root, 'bad-resolver.mjs')

    await fs.writeFile(defaultPath, 'export default function resolver() { return [] }\n')
    await fs.writeFile(namedPath, 'export const resolver = () => []\n')
    await fs.writeFile(badPath, 'export const nope = 1\n')

    const defaultResolver = await loadResolverModule('./default-resolver.mjs', root)
    assert.equal(typeof defaultResolver, 'function')

    const namedResolver = await loadResolverModule('./named-resolver.mjs', root)
    assert.equal(typeof namedResolver, 'function')

    const fileResolver = await loadResolverModule(pathToFileURL(defaultPath).href, root)
    assert.equal(typeof fileResolver, 'function')

    await assert.rejects(
      () => loadResolverModule('./bad-resolver.mjs', root),
      /Resolver module must export a function/,
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('resolveWithExtensionFallback and resolveIndexFallback handle fallbacks', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knighted-resolve-'))
  try {
    const dir = path.join(root, 'lib')
    await fs.mkdir(dir, { recursive: true })
    const indexPath = path.join(dir, 'index.ts')
    await fs.writeFile(indexPath, 'export const value = 1\n')

    const resolvedIndex = await resolveIndexFallback(dir)
    assert.equal(resolvedIndex, indexPath)

    const resolvedViaFallback = await resolveWithExtensionFallback(dir)
    assert.equal(resolvedViaFallback, indexPath)

    const missing = path.join(root, 'missing')
    const missingResolved = await resolveWithExtensionFallback(missing)
    assert.equal(missingResolved, missing)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('readManifest handles invalid JSON and writeSidecarManifest writes output', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knighted-manifest-'))
  try {
    const manifestPath = path.join(root, 'selector-modules.json')
    await fs.writeFile(manifestPath, 'not-json')
    const manifest = await readManifest(manifestPath)
    assert.deepEqual(manifest, {})

    const sidecarPath = path.join(root, 'sidecar', 'manifest.json')
    await writeSidecarManifest(sidecarPath, {
      '/abs/path/file.ts': { file: '/abs/path/file.ts.d.ts' },
    })
    const sidecar = JSON.parse(await fs.readFile(sidecarPath, 'utf8')) as Record<
      string,
      { file: string }
    >
    assert.equal(sidecar['/abs/path/file.ts']?.file, '/abs/path/file.ts.d.ts')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('generateTypes autoStable emits selectors for CSS Modules', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knighted-auto-stable-'))
  try {
    const srcDir = path.join(root, 'src')
    await fs.mkdir(srcDir, { recursive: true })
    const cssPath = path.join(srcDir, 'styles.module.css')
    await fs.writeFile(cssPath, '.card { color: red; }\n')
    await fs.writeFile(
      path.join(srcDir, 'entry.ts'),
      "import selectors from './styles.module.css.knighted-css'\n" +
        'console.log(selectors.card)\n',
    )

    const outDir = path.join(root, '.knighted-css-test')
    const result = await generateTypes({
      rootDir: root,
      include: ['src'],
      outDir,
      autoStable: true,
    })
    assert.ok(result.selectorModulesWritten >= 1)
    assert.equal(result.warnings.length, 0)

    const selectorModulePath = path.join(srcDir, 'styles.module.css.knighted-css.ts')
    const selectorModule = await fs.readFile(selectorModulePath, 'utf8')
    assert.match(selectorModule, /"card": "knighted-card"/)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('generateTypes resolves tsconfig baseUrl specifiers', async () => {
  const project = await setupBaseUrlFixture()
  try {
    const outDir = path.join(project.root, '.knighted-css-test')
    const result = await generateTypes({
      rootDir: project.root,
      include: ['src'],
      outDir,
    })
    assert.ok(result.selectorModulesWritten >= 1)
    assert.equal(result.warnings.length, 0)
    const manifestPath = path.join(outDir, 'selector-modules.json')
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Record<
      string,
      { file: string }
    >
    assert.equal(Object.keys(manifest).length, 1)
  } finally {
    await project.cleanup()
  }
})

test('generateTypes resolves package.json imports specifiers', async () => {
  const project = await setupPackageImportsFixture()
  try {
    const outDir = path.join(project.root, '.knighted-css-test')
    const result = await generateTypes({
      rootDir: project.root,
      include: ['src'],
      outDir,
    })
    assert.ok(result.selectorModulesWritten >= 1)
    assert.equal(result.warnings.length, 0)
    const selectorModulePath = path.join(
      project.root,
      'src',
      'imports.css.knighted-css.ts',
    )
    assert.equal(await pathExists(selectorModulePath), true)
  } finally {
    await project.cleanup()
  }
})

test('generateTypes resolves hash-imports workspace package.json imports', async () => {
  const workspace = await setupHashImportsWorkspaceFixture()
  try {
    const appRoot = path.join(workspace.root, 'apps', 'hash-import-demo')
    const bridgeDir = path.join(appRoot, 'src', 'workspace-bridge')
    const requireFromRepo = createRequire(import.meta.url)
    const sassEntry = requireFromRepo.resolve('sass')
    const sassPackageDir = await findPackageRoot(sassEntry)
    const sassModuleDir = path.join(appRoot, 'node_modules', 'sass')
    await fs.mkdir(path.dirname(sassModuleDir), { recursive: true })
    try {
      await fs.symlink(
        sassPackageDir,
        sassModuleDir,
        process.platform === 'win32' ? 'junction' : 'dir',
      )
    } catch {
      await fs.cp(sassPackageDir, sassModuleDir, { recursive: true })
    }
    await fs.writeFile(
      path.join(bridgeDir, 'tokens.scss'),
      '$accent-color: dodgerblue;\n',
    )
    await fs.writeFile(
      path.join(bridgeDir, 'workspace-card.scss'),
      "@use 'pkg:#workspace/ui/tokens.scss' as tokens;\n\n" +
        '.knighted-demo { color: tokens.$accent-color; }\n',
    )
    await fs.writeFile(
      path.join(appRoot, 'src', 'types-entry.ts'),
      "import selectors from '#workspace/ui/workspace-card.scss.knighted-css'\n" +
        'console.log(selectors.demo)\n',
    )

    const outDir = path.join(appRoot, '.knighted-css-test')
    const result = await generateTypes({
      rootDir: appRoot,
      include: ['src'],
      outDir,
    })
    const unexpectedWarnings = result.warnings.filter(
      warning =>
        warning.includes('Unable to resolve') ||
        warning.includes('Failed to extract CSS'),
    )
    assert.equal(
      unexpectedWarnings.length,
      0,
      `Unexpected warnings:\n${unexpectedWarnings.join('\n')}`,
    )

    const selectorModulePath = path.join(bridgeDir, 'workspace-card.scss.knighted-css.ts')
    assert.equal(await pathExists(selectorModulePath), true)
  } finally {
    await workspace.cleanup()
  }
})

async function findPackageRoot(entryPath: string): Promise<string> {
  let current = path.dirname(entryPath)
  const { root } = path.parse(current)
  while (true) {
    const candidate = path.join(current, 'package.json')
    try {
      await fs.access(candidate)
      return current
    } catch {
      // continue
    }
    if (current === root) {
      throw new Error(`Unable to locate package.json for ${entryPath}`)
    }
    current = path.dirname(current)
  }
}

test('generateTypes removes stale selector manifest entries when modules vanish', async () => {
  const project = await setupFixtureProject()
  try {
    const outDir = path.join(project.root, '.knighted-css-test')
    const options = { rootDir: project.root, include: ['src'], outDir }
    await generateTypes(options)

    const selectorManifestPath = path.join(outDir, 'selector-modules.json')
    const selectorManifest = JSON.parse(
      await fs.readFile(selectorManifestPath, 'utf8'),
    ) as Record<string, { file: string; hash: string }>
    const ghostModulePath = path.join(project.root, 'src', 'ghost.knighted-css.ts')
    selectorManifest['ghost-module'] = { file: ghostModulePath, hash: 'ghost' }
    await fs.writeFile(selectorManifestPath, JSON.stringify(selectorManifest, null, 2))
    await fs.writeFile(ghostModulePath, '// ghost module')

    const result = await generateTypes(options)
    assert.ok(result.selectorModulesRemoved >= 1)
    const updatedSelectorManifest = JSON.parse(
      await fs.readFile(selectorManifestPath, 'utf8'),
    ) as Record<string, { file: string; hash: string }>
    assert.ok(!updatedSelectorManifest['ghost-module'])
    assert.equal(await pathExists(ghostModulePath), false)
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
      "import 'missing-package/style.css.knighted-css'\n",
    )
    const outDir = path.join(root, '.knighted-css-out')
    const result = await generateTypes({
      rootDir: root,
      include: ['src'],
      outDir,
    })
    assert.equal(result.selectorModulesWritten, 0)
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
    setCssWithMetaImplementation(async () => {
      throw new Error('css failure')
    })
    const result = await generateTypes({
      rootDir: project.root,
      include: ['src'],
      outDir,
    })
    assert.equal(result.selectorModulesWritten, 0)
    assert.ok(result.warnings.some(w => w.includes('Failed to extract CSS')))
  } finally {
    setCssWithMetaImplementation()
    await project.cleanup()
  }
})

test('generateTypes completes with no selector modules when no matching imports exist', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knighted-empty-spec-'))
  try {
    const srcDir = path.join(root, 'src')
    await fs.mkdir(srcDir, { recursive: true })
    await fs.writeFile(path.join(srcDir, 'entry.ts'), 'console.log("noop")\n')
    const outDir = path.join(root, '.knighted-css-out')
    const result = await generateTypes({
      rootDir: root,
      include: ['src'],
      outDir,
    })
    assert.equal(result.selectorModulesWritten, 0)
    assert.equal(result.selectorModulesRemoved, 0)
    assert.equal(result.warnings.length, 0)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('generateTypes ignores specifiers lacking the selector suffix', async () => {
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
    const result = await generateTypes({
      rootDir: root,
      include: ['src'],
      outDir,
    })
    assert.equal(result.selectorModulesWritten, 0)
    assert.equal(result.selectorModulesRemoved, 0)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('generateTypes dedupes repeated specifiers', async () => {
  const project = await setupFixtureProject()
  try {
    const srcDir = path.join(project.root, 'src')
    const specifier = './fixture/entry.js.knighted-css'
    const entrySource = `import firstSelectors from '${specifier}'
import secondSelectors from '${specifier}'
console.log(firstSelectors.demo, secondSelectors.demo)
`
    await fs.writeFile(path.join(srcDir, 'entry.ts'), entrySource)

    const outDir = path.join(project.root, '.knighted-css-out')
    const result = await generateTypes({
      rootDir: project.root,
      include: ['src'],
      outDir,
    })
    assert.equal(
      result.selectorModulesWritten,
      1,
      `Unexpected selector module writes: ${JSON.stringify(result)}`,
    )
    assert.equal(result.warnings.length, 0)
  } finally {
    await project.cleanup()
  }
})

test('generateTypes handles inline loader prefixes on specifiers', async () => {
  const project = await setupFixtureProject()
  try {
    const srcDir = path.join(project.root, 'src')
    const specifier = 'style-loader!./fixture/entry.js.knighted-css'
    const entrySource = `import selectors from '${specifier}'
console.log(selectors.demo)
`
    await fs.writeFile(path.join(srcDir, 'entry.ts'), entrySource)

    const outDir = path.join(project.root, '.knighted-css-inline')
    const result = await generateTypes({
      rootDir: project.root,
      include: ['src'],
      outDir,
    })
    assert.equal(result.selectorModulesWritten, 1)
    assert.equal(result.warnings.length, 0)
  } finally {
    await project.cleanup()
  }
})

test('generateTypes warns when selector sources fall outside the project root', async () => {
  const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'knighted-outside-root-'))
  const projectRoot = path.join(sandboxRoot, 'project')
  const sharedRoot = path.join(sandboxRoot, 'shared')
  try {
    await fs.mkdir(sharedRoot, { recursive: true })
    await fs.mkdir(path.join(projectRoot, 'src'), { recursive: true })
    await fs.writeFile(
      path.join(projectRoot, 'package.json'),
      JSON.stringify({ name: 'outside-root', version: '1.0.0' }),
    )
    const cssPath = path.join(sharedRoot, 'global.css')
    await fs.writeFile(cssPath, '.global { color: teal; }\n')
    const entrySource =
      "import selectors from '../../shared/global.css.knighted-css'\nconsole.log(selectors.global)\n"
    await fs.writeFile(path.join(projectRoot, 'src', 'entry.ts'), entrySource)

    const outDir = path.join(projectRoot, '.knighted-css-cache')
    const result = await generateTypes({
      rootDir: projectRoot,
      include: ['src'],
      outDir,
    })
    assert.equal(result.selectorModulesWritten, 0)
    assert.ok(result.warnings.some(w => w.includes('Skipping selector module')))
    assert.equal(await pathExists(`${cssPath}.knighted-css.ts`), false)
  } finally {
    await fs.rm(sandboxRoot, { recursive: true, force: true })
  }
})

test('generateTypes discovers selector imports in tsx via oxc fallback', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knighted-generate-types-tsx-'))
  try {
    const srcDir = path.join(root, 'src')
    await fs.mkdir(srcDir, { recursive: true })

    const cssPath = path.join(srcDir, 'button.css')
    await fs.writeFile(cssPath, '.knighted-btn { color: rebeccapurple; }\n')

    const entryPath = path.join(srcDir, 'entry.tsx')
    await fs.writeFile(
      entryPath,
      "import selectors from './button.css.knighted-css'\n" +
        'export default function Button() {\n' +
        '  return <button className={selectors.btn}>Hi</button>\n' +
        '}\n',
    )

    const result = await generateTypes({ rootDir: root, include: ['src'] })
    assert.ok(result.selectorModulesWritten >= 1)
    assert.equal(result.warnings.length, 0)

    const selectorModulePath = path.join(srcDir, 'button.css.knighted-css.ts')
    assert.equal(await pathExists(selectorModulePath), true)
    const selectorModule = await fs.readFile(selectorModulePath, 'utf8')
    assert.match(selectorModule, /"btn": "knighted-btn"/)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('generateTypes emits unified proxy modules for JS/TS specifiers', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knighted-proxy-'))
  try {
    const srcDir = path.join(root, 'src')
    await fs.mkdir(srcDir, { recursive: true })

    await fs.writeFile(
      path.join(srcDir, 'styles.css'),
      '.card { color: teal; }\n.knighted-card { color: rebeccapurple; }\n',
    )

    await fs.writeFile(
      path.join(srcDir, 'button.ts'),
      "import './styles.css'\nexport default function Button() { return null }\n",
    )

    await fs.writeFile(
      path.join(srcDir, 'helper.ts'),
      "import './styles.css'\nexport const helper = () => 'ok'\n",
    )

    await fs.writeFile(
      path.join(srcDir, 'entry.ts'),
      "import { knightedCss, stableSelectors } from './button.knighted-css'\n" +
        "import { helper } from './helper.knighted-css'\n" +
        'console.log(knightedCss.length, stableSelectors.card, helper)\n',
    )

    await fs.writeFile(
      path.join(srcDir, 'fancy.ts'),
      "import './styles.css'\nexport default function Fancy() { return null }\n",
    )

    await fs.writeFile(
      path.join(srcDir, 'entry-2.ts'),
      "import { knightedCss } from './fancy.knighted-css.js'\n" +
        'console.log(knightedCss.length)\n',
    )

    const result = await generateTypes({ rootDir: root, include: ['src'] })
    assert.equal(result.warnings.length, 0)

    const buttonProxyPath = path.join(srcDir, 'button.knighted-css.ts')
    const buttonProxy = await fs.readFile(buttonProxyPath, 'utf8')
    assert.ok(buttonProxy.includes("export * from './button.js'"))
    assert.ok(buttonProxy.includes("export { default } from './button.js'"))
    assert.ok(
      buttonProxy.includes("export { knightedCss } from './button.js?knighted-css'"),
    )
    assert.ok(buttonProxy.includes('"card": "knighted-card"'))

    const helperProxyPath = path.join(srcDir, 'helper.knighted-css.ts')
    const helperProxy = await fs.readFile(helperProxyPath, 'utf8')
    assert.ok(helperProxy.includes("export * from './helper.js'"))
    assert.ok(!helperProxy.includes("export { default } from './helper.js'"))

    const fancyProxyPath = path.join(srcDir, 'fancy.knighted-css.ts')
    const fancyProxy = await fs.readFile(fancyProxyPath, 'utf8')
    assert.ok(fancyProxy.includes("export * from './fancy.js'"))
    assert.ok(fancyProxy.includes("export { default } from './fancy.js'"))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('runGenerateTypesCli executes generation and reports summaries', async () => {
  const project = await setupFixtureProject()
  try {
    const outDir = path.join(project.root, '.knighted-css-cli')
    const args = ['--root', project.root, '--include', 'src', '--out-dir', outDir]
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
    const transcript = buildCliTranscript(logs, warns, {
      [project.root]: '<projectRoot>',
      [outDir]: '<outDir>',
    })
    await expectCliSnapshot('cli-generation-summary', transcript)
    const manifestPath = path.join(outDir, 'selector-modules.json')
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Record<
      string,
      unknown
    >
    assert.equal(Object.keys(manifest).length, 1)
  } finally {
    await project.cleanup()
  }
})

test('runGenerateTypesCli loads a custom resolver module', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knighted-cli-resolver-'))
  try {
    const srcDir = path.join(root, 'src')
    await fs.mkdir(srcDir, { recursive: true })
    await fs.writeFile(
      path.join(srcDir, 'styles.css'),
      '.knighted-card { color: teal; }\n',
    )
    await fs.writeFile(
      path.join(srcDir, 'entry.ts'),
      "import selectors from '@alias/styles.css.knighted-css'\n" +
        'console.log(selectors.card)\n',
    )
    const resolverPath = path.join(root, 'resolver.mjs')
    await fs.writeFile(
      resolverPath,
      "import path from 'node:path'\n" +
        'export default function resolver(specifier, { cwd }) {\n' +
        "  if (specifier === '@alias/styles.css') {\n" +
        "    return path.join(cwd, 'src', 'styles.css')\n" +
        '  }\n' +
        '  return undefined\n' +
        '}\n',
    )

    const outDir = path.join(root, '.knighted-css-cli')
    await runGenerateTypesCli([
      '--root',
      root,
      '--include',
      'src',
      '--out-dir',
      outDir,
      '--resolver',
      './resolver.mjs',
    ])

    const selectorModulePath = path.join(srcDir, 'styles.css.knighted-css.ts')
    assert.equal(await pathExists(selectorModulePath), true)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
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
  await expectCliSnapshot('cli-help-output', printed.join('\n'))
})

test('generateTypes internals cover edge cases', async () => {
  const {
    resolvePackageRoot,
    setModuleTypeDetector,
    collectCandidateFiles,
    findSpecifierImports,
    resolveImportPath,
    formatSelectorModuleSource,
    removeStaleSelectorModules,
    resolveIndexFallback,
    loadTsconfigResolutionContext,
    isNonRelativeSpecifier,
    resolveProxyInfo,
    loadResolverModule,
    parseCliArgs,
  } = __generateTypesInternals

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'knighted-internals-'))
  try {
    await fs.writeFile(
      path.join(tempRoot, 'package.json'),
      JSON.stringify({ name: 'knighted-temp-root', type: 'module' }),
    )
    const originalDirname = (globalThis as { __dirname?: string }).__dirname
    try {
      ;(globalThis as { __dirname?: string }).__dirname = path.join(tempRoot, 'src')
      setModuleTypeDetector(() => 'commonjs')
      assert.equal(resolvePackageRoot(), path.resolve(tempRoot, 'src', '..'))
    } finally {
      setModuleTypeDetector(undefined)
      if (typeof originalDirname === 'undefined') {
        delete (globalThis as { __dirname?: string }).__dirname
      } else {
        ;(globalThis as { __dirname?: string }).__dirname = originalDirname
      }
    }

    assert.deepEqual(await collectCandidateFiles([path.join(tempRoot, 'missing')]), [])
    assert.deepEqual(await findSpecifierImports(path.join(tempRoot, 'missing.ts')), [])

    const brokenFile = path.join(tempRoot, 'broken.ts')
    await fs.writeFile(
      brokenFile,
      "import { broken } from ;\nrequire('./styles.css.knighted-css')\n",
    )
    const brokenMatches = await findSpecifierImports(brokenFile)
    assert.ok(brokenMatches.length >= 1)

    const resolverUndefined = await resolveImportPath(
      '@missing',
      brokenFile,
      tempRoot,
      undefined,
      async () => undefined,
      undefined,
    )
    assert.equal(resolverUndefined, undefined)

    const resolverBadUrl = await resolveImportPath(
      '@bad',
      brokenFile,
      tempRoot,
      undefined,
      async () => 'file://%invalid',
      undefined,
    )
    assert.equal(resolverBadUrl, undefined)

    const source = formatSelectorModuleSource(new Map(), undefined)
    assert.ok(source.includes('{} as const'))
    const populated = formatSelectorModuleSource(new Map([['demo', '.knighted-demo']]), {
      moduleSpecifier: './entry.js',
      includeDefault: true,
    })
    assert.ok(populated.includes('"demo": ".knighted-demo"'))

    const hashedSource = formatSelectorModuleSource(
      new Map([['demo', '.knighted-demo']]),
      {
        moduleSpecifier: './entry.js',
        includeDefault: true,
      },
      {
        hashed: true,
        selectorSource: './entry.js',
        resolvedPath: path.join(tempRoot, 'entry.js'),
      },
    )
    assert.ok(hashedSource.includes('export const selectors'))
    assert.ok(hashedSource.includes('export const knightedCssModules'))

    const removed = await removeStaleSelectorModules(
      { demo: { file: path.join(tempRoot, 'missing.ts'), hash: 'missing' } },
      {},
    )
    assert.equal(removed, 0)

    const candidate = path.join(tempRoot, 'not-a-dir')
    await fs.writeFile(candidate, 'noop')
    assert.equal(await resolveIndexFallback(candidate), undefined)

    const tsconfig = loadTsconfigResolutionContext(tempRoot, () => ({
      path: path.join(tempRoot, 'tsconfig.json'),
      config: {
        compilerOptions: {
          baseUrl: './src',
          paths: { '@app/*': ['./app/*'] },
        },
      },
    }))
    assert.ok(tsconfig?.absoluteBaseUrl)
    assert.ok(tsconfig?.matchPath)

    assert.equal(isNonRelativeSpecifier('http://example.com/style.css'), false)

    const proxyCache = new Map<string, Awaited<ReturnType<typeof resolveProxyInfo>>>()
    const proxyInfo = await resolveProxyInfo(
      'demo',
      './entry.ts',
      path.join(tempRoot, 'missing-entry.ts'),
      proxyCache,
    )
    assert.ok(proxyInfo?.moduleSpecifier)
    const proxyCached = await resolveProxyInfo(
      'demo',
      './entry.ts',
      path.join(tempRoot, 'missing-entry.ts'),
      proxyCache,
    )
    assert.equal(proxyCached, proxyInfo)

    const resolverFile = path.join(tempRoot, 'resolver-file.mjs')
    await fs.writeFile(resolverFile, 'export default function resolver() { return null }')
    const fileResolver = await loadResolverModule(
      pathToFileURL(resolverFile).href,
      tempRoot,
    )
    assert.equal(typeof fileResolver, 'function')

    const nodeModulesDir = path.join(tempRoot, 'node_modules', 'fixture-resolver')
    await fs.mkdir(nodeModulesDir, { recursive: true })
    await fs.writeFile(
      path.join(nodeModulesDir, 'package.json'),
      JSON.stringify({ name: 'fixture-resolver', type: 'module', exports: './index.js' }),
    )
    await fs.writeFile(
      path.join(nodeModulesDir, 'index.js'),
      'export default function resolver() { return null }',
    )
    const packageResolver = await loadResolverModule('fixture-resolver', tempRoot)
    assert.equal(typeof packageResolver, 'function')

    const badResolver = path.join(tempRoot, 'resolver-bad.mjs')
    await fs.writeFile(badResolver, 'export const resolver = 123')
    await assert.rejects(
      () => loadResolverModule(pathToFileURL(badResolver).href, tempRoot),
      /Resolver module must export a function/,
    )

    const namedResolverFile = path.join(tempRoot, 'resolver-named.mjs')
    await fs.writeFile(namedResolverFile, 'export function resolver() { return null }')
    const namedResolver = await loadResolverModule(
      pathToFileURL(namedResolverFile).href,
      tempRoot,
    )
    assert.equal(typeof namedResolver, 'function')

    const parsed = parseCliArgs(['--root', tempRoot, 'src'])
    assert.deepEqual(parsed.include, ['src'])
    assert.equal(parsed.mode, 'module')
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true })
  }
})

test('generateTypes falls back when root realpath fails', async () => {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'knighted-root-fallback-'))
  const missingRoot = path.join(sandbox, 'missing-root')
  const outDir = path.join(sandbox, 'out')
  await fs.mkdir(outDir, { recursive: true })

  try {
    const result = await generateTypes({
      rootDir: missingRoot,
      include: ['src'],
      outDir,
    })
    assert.equal(result.selectorModulesWritten, 0)
    assert.equal(result.warnings.length, 0)
  } finally {
    await fs.rm(sandbox, { recursive: true, force: true })
  }
})

test('generateTypes skips invalid selector sources', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knighted-invalid-selector-'))
  try {
    const srcDir = path.join(root, 'src')
    await fs.mkdir(srcDir, { recursive: true })
    await fs.writeFile(
      path.join(srcDir, 'entry.ts'),
      "import selectors from '.knighted-css'\nconsole.log(selectors)\n",
    )
    const result = await generateTypes({ rootDir: root, include: ['src'] })
    assert.equal(result.selectorModulesWritten, 0)
    assert.equal(result.warnings.length, 0)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
test('generateTypes internals support selector module helpers', async () => {
  const {
    stripInlineLoader,
    splitResourceAndQuery,
    extractSelectorSourceSpecifier,
    findSpecifierImports,
    resolveImportPath,
    resolvePackageRoot,
    normalizeIncludeOptions,
    collectCandidateFiles,
    normalizeTsconfigPaths,
    setModuleTypeDetector,
    setImportMetaUrlProvider,
    relativeToRoot,
    isNonRelativeSpecifier,
    isStyleResource,
    resolveWithExtensionFallback,
    createProjectPeerResolver,
    getProjectRequire,
    loadTsconfigResolutionContext,
    resolveWithTsconfigPaths,
    parseCliArgs,
    printHelp,
    reportCliResult,
    buildSelectorModuleManifestKey,
    buildSelectorModulePath,
    formatSelectorModuleSource,
  } = __generateTypesInternals

  assert.equal(
    stripInlineLoader('style-loader!css-loader!./demo.ts.knighted-css'),
    './demo.ts.knighted-css',
  )

  assert.deepEqual(splitResourceAndQuery('./demo.ts.knighted-css?foo=1#hash'), {
    resource: './demo.ts.knighted-css',
    query: '?foo=1',
  })

  assert.equal(extractSelectorSourceSpecifier('./demo.ts.knighted-css'), './demo.ts')
  assert.equal(extractSelectorSourceSpecifier('./demo.ts.knighted-css.ts'), './demo.ts')
  assert.equal(extractSelectorSourceSpecifier('./demo.ts'), undefined)
  assert.equal(extractSelectorSourceSpecifier('.knighted-css'), undefined)
  assert.equal(extractSelectorSourceSpecifier('./demo.knighted-css.css'), undefined)

  const selectorMap = new Map([
    ['beta', 'knighted-beta'],
    ['alpha', 'knighted-alpha'],
  ])
  const selectorModuleSource = formatSelectorModuleSource(selectorMap)
  assert.match(selectorModuleSource, /export const stableSelectors/)
  assert.match(selectorModuleSource, /"alpha": "knighted-alpha"/)

  const proxySource = formatSelectorModuleSource(selectorMap, {
    moduleSpecifier: './demo.js',
    includeDefault: false,
  })
  assert.match(proxySource, /export \* from '\.\/demo\.js'/)
  assert.match(proxySource, /export \{ knightedCss \} from '\.\/demo\.js\?knighted-css'/)
  assert.ok(!proxySource.includes('export default stableSelectors'))

  const hashedProxySource = formatSelectorModuleSource(
    selectorMap,
    {
      moduleSpecifier: './demo.js',
      includeDefault: false,
    },
    {
      hashed: true,
      selectorSource: './demo.js',
      resolvedPath: '/tmp/project/src/demo.js',
    },
  )
  assert.match(hashedProxySource, /export \* from '\.\/demo\.js'/)
  assert.match(
    hashedProxySource,
    /import \{ knightedCss as __knightedCss, knightedCssModules as __knightedCssModules \} from '\.\/demo\.js\?knighted-css'/,
  )
  assert.match(hashedProxySource, /export const selectors/)

  const manifestKey = buildSelectorModuleManifestKey(path.join('src', 'entry.js'))
  assert.ok(manifestKey.includes('entry.js'))
  const modulePath = buildSelectorModulePath('/tmp/project/src/entry.js')
  assert.ok(modulePath.endsWith('.knighted-css.ts'))
  assert.ok(!modulePath.includes('.js.knighted-css.ts'))
  const cssModulePath = buildSelectorModulePath('/tmp/project/src/styles.css')
  assert.ok(cssModulePath.endsWith('styles.css.knighted-css.ts'))

  const normalized = normalizeIncludeOptions(undefined, '/tmp/project')
  assert.deepEqual(normalized, ['/tmp/project'])
  assert.deepEqual(normalizeIncludeOptions(['./src'], '/tmp/project'), [
    path.resolve('/tmp/project', './src'),
  ])

  assert.equal(isStyleResource('/tmp/styles.css'), true)
  assert.equal(isStyleResource('/tmp/styles.css.ts'), true)
  assert.equal(isStyleResource('/tmp/app.ts'), false)

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'knighted-extension-'))
  try {
    const filePath = path.join(tempRoot, 'widget.ts')
    await fs.writeFile(filePath, 'export const widget = true')
    const resolved = await resolveWithExtensionFallback(path.join(tempRoot, 'widget.js'))
    assert.equal(resolved, filePath)

    const missingResolved = await resolveWithExtensionFallback(
      path.join(tempRoot, 'missing.ts'),
    )
    assert.equal(missingResolved, path.join(tempRoot, 'missing.ts'))

    const indexDir = path.join(tempRoot, 'pkg')
    await fs.mkdir(indexDir, { recursive: true })
    const indexPath = path.join(indexDir, 'index.ts')
    await fs.writeFile(indexPath, 'export const ok = true')
    const indexResolved = await resolveWithExtensionFallback(indexDir)
    assert.equal(indexResolved, indexPath)
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true })
  }

  const fallbackRoot = resolvePackageRoot()
  assert.ok(fallbackRoot.endsWith(path.join('node_modules', '@knighted', 'css')))

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
    '--manifest',
    '.knighted-css/knighted-manifest.json',
    '--mode',
    'declaration',
    '--auto-stable',
    '--resolver',
    './resolver.mjs',
  ]) as ParsedCliArgs
  assert.equal(parsed.rootDir, path.resolve('/tmp/project'))
  assert.deepEqual(parsed.include, ['src'])
  assert.equal(parsed.stableNamespace, 'storybook')
  assert.equal(parsed.autoStable, true)
  assert.equal(parsed.hashed, false)
  assert.equal(parsed.resolver, './resolver.mjs')
  assert.equal(parsed.mode, 'declaration')
  assert.equal(parsed.manifestPath, '.knighted-css/knighted-manifest.json')

  const hashedParsed = parseCliArgs([
    '--root',
    '/tmp/project',
    '--hashed',
    'src',
  ]) as ParsedCliArgs
  assert.equal(hashedParsed.rootDir, path.resolve('/tmp/project'))
  assert.deepEqual(hashedParsed.include, ['src'])
  assert.equal(hashedParsed.autoStable, false)
  assert.equal(hashedParsed.hashed, true)
  assert.equal(hashedParsed.mode, 'module')

  assert.throws(() => parseCliArgs(['--root']), /Missing value/)
  assert.throws(() => parseCliArgs(['--include']), /Missing value/)
  assert.throws(() => parseCliArgs(['--out-dir']), /Missing value/)
  assert.throws(() => parseCliArgs(['--stable-namespace']), /Missing value/)
  assert.throws(() => parseCliArgs(['--resolver']), /Missing value/)
  assert.throws(() => parseCliArgs(['--mode']), /Missing value/)
  assert.throws(() => parseCliArgs(['--manifest']), /Missing value/)
  assert.throws(() => parseCliArgs(['--mode', 'wat']), /Unknown mode/)
  assert.throws(() => parseCliArgs(['--wat']), /Unknown flag/)
  assert.throws(() => parseCliArgs(['--auto-stable', '--hashed']), /Cannot combine/)
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

  assert.equal(isNonRelativeSpecifier('pkg/component'), true)
  assert.equal(isNonRelativeSpecifier('./local'), false)
  assert.equal(isNonRelativeSpecifier(''), false)

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
      selectorModulesWritten: 0,
      selectorModulesRemoved: 0,
      warnings: ['warn'],
      manifestPath: '/tmp/types/selector-modules.json',
    })
    reportCliResult({
      selectorModulesWritten: 2,
      selectorModulesRemoved: 1,
      warnings: [],
      manifestPath: '/tmp/types/selector-modules.json',
    })
  } finally {
    console.log = originalLog
    console.warn = originalWarn
  }
  assert.ok(summaryLogs.some(log => log.includes('Selector modules are up to date.')))
  assert.ok(summaryLogs.some(log => log.includes('Selector modules updated')))
  assert.equal(summaryWarns.length, 1)

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

  const specifierRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'knighted-specifier-imports-'),
  )
  try {
    const specFile = path.join(specifierRoot, 'entry.ts')
    await fs.writeFile(
      specFile,
      "import selectors from './demo.js.knighted-css'\nconst lazy = require('./other.knighted-css')\n",
    )
    const matches = await findSpecifierImports(specFile)
    assert.equal(matches.length, 2)
    assert.ok(matches.every(match => match.importer === specFile))
  } finally {
    await fs.rm(specifierRoot, { recursive: true, force: true })
  }

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

  const aliasRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'knighted-tsconfig-alias-'))
  try {
    const aliasFile = path.join(aliasRoot, 'alias.css')
    await fs.writeFile(aliasFile, '.alias {}\n')
    const matchResolved = await resolveWithTsconfigPaths('alias-entry', {
      matchPath: () => aliasFile,
    })
    assert.equal(matchResolved, aliasFile)
  } finally {
    await fs.rm(aliasRoot, { recursive: true, force: true })
  }

  assert.equal(await resolveWithTsconfigPaths('standalone'), undefined)

  const loaderErrorContext = loadTsconfigResolutionContext('/tmp/project', () => {
    throw new Error('tsconfig failure')
  })
  assert.equal(loaderErrorContext, undefined)

  const resolveRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'knighted-resolve-import-'))
  try {
    await fs.mkdir(path.join(resolveRoot, 'src'), { recursive: true })
    await fs.writeFile(
      path.join(resolveRoot, 'package.json'),
      JSON.stringify({ name: 'resolve-fixture', version: '1.0.0' }, null, 2),
    )
    const importer = path.join(resolveRoot, 'src', 'entry.ts')
    const relativeResolved = await resolveImportPath(
      './styles/demo.css',
      importer,
      resolveRoot,
    )
    assert.equal(relativeResolved, path.join(resolveRoot, 'src', 'styles', 'demo.css'))

    const absoluteTarget = path.join(resolveRoot, 'src', 'absolute.ts')
    await fs.writeFile(absoluteTarget, 'export const abs = true')
    const absoluteResolved = await resolveImportPath(
      '/src/absolute.ts',
      importer,
      resolveRoot,
    )
    assert.equal(absoluteResolved, absoluteTarget)
  } finally {
    await fs.rm(resolveRoot, { recursive: true, force: true })
  }

  const baseUrlRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'knighted-tsconfig-baseurl-'),
  )
  try {
    const baseUrl = path.join(baseUrlRoot, 'src')
    await fs.mkdir(baseUrl, { recursive: true })
    const baseUrlFile = path.join(baseUrl, 'base.ts')
    await fs.writeFile(baseUrlFile, 'export const base = true')
    const resolvedBaseUrl = await resolveWithTsconfigPaths('base.ts', {
      absoluteBaseUrl: baseUrl,
    })
    assert.equal(resolvedBaseUrl, baseUrlFile)
  } finally {
    await fs.rm(baseUrlRoot, { recursive: true, force: true })
  }

  const rooted = relativeToRoot(
    path.join('/tmp/project', 'src', 'demo.css'),
    '/tmp/project',
  )
  assert.equal(rooted, path.join('src', 'demo.css'))
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
