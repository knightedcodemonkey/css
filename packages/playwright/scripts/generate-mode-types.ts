import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateTypes } from '@knighted/css/generate-types'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

const typesCacheDir = path.resolve(rootDir, '.knighted-css-mode')
const strictManifestPath = path.join(typesCacheDir, 'knighted-manifest.json')

type ModeConfig = {
  include: string | string[]
  outDir: string
  mode: 'module' | 'declaration'
  autoStable?: boolean
  hashed?: boolean
  manifestPath?: string
}

const modeConfigs: ModeConfig[] = [
  {
    include: 'src/mode/module',
    outDir: '.knighted-css-mode-module',
    mode: 'module',
  },
  {
    include: 'src/mode/declaration',
    outDir: '.knighted-css-mode-declaration',
    mode: 'declaration',
    manifestPath: '.knighted-css-mode-declaration/knighted-manifest.json',
  },
  {
    include: 'src/mode/declaration-hashed',
    outDir: '.knighted-css-mode-declaration-hashed',
    mode: 'declaration',
    hashed: true,
    manifestPath: '.knighted-css-mode-declaration-hashed/knighted-manifest.json',
  },
  {
    include: 'src/mode/declaration-stable',
    outDir: '.knighted-css-mode-declaration-stable',
    mode: 'declaration',
    autoStable: true,
    manifestPath: '.knighted-css-mode-declaration-stable/knighted-manifest.json',
  },
  {
    include: 'src/mode/declaration-strict/strict-ok-card.tsx',
    outDir: '.knighted-css-mode-declaration-strict',
    mode: 'declaration',
    manifestPath: '.knighted-css-mode-declaration-strict/knighted-manifest.json',
  },
]

const manifestPaths = modeConfigs
  .map(config => config.manifestPath)
  .filter((value): value is string => typeof value === 'string')
  .map(manifestPath => path.resolve(rootDir, manifestPath))

type ManifestEntry = { file: string }
type Manifest = Record<string, ManifestEntry>

function readManifest(filePath: string): Manifest {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing manifest at ${filePath}.`)
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Manifest
}

function withAliasEntries(manifest: Manifest): Manifest {
  const aliasEntries: Manifest = {}
  for (const [key, value] of Object.entries(manifest)) {
    if (key.endsWith('.ts') || key.endsWith('.tsx')) {
      const aliasKey = `${key.slice(0, -path.extname(key).length)}.js`
      if (!manifest[aliasKey]) {
        aliasEntries[aliasKey] = value
      }
      continue
    }
    if (key.endsWith('.mts')) {
      const aliasKey = `${key.slice(0, -4)}.mjs`
      if (!manifest[aliasKey]) {
        aliasEntries[aliasKey] = value
      }
      continue
    }
    if (key.endsWith('.cts')) {
      const aliasKey = `${key.slice(0, -4)}.cjs`
      if (!manifest[aliasKey]) {
        aliasEntries[aliasKey] = value
      }
    }
  }
  return { ...manifest, ...aliasEntries }
}

function writeManifest(manifest: Manifest) {
  fs.mkdirSync(typesCacheDir, { recursive: true })
  fs.writeFileSync(strictManifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}

for (const config of modeConfigs) {
  const include = Array.isArray(config.include)
    ? config.include.map(entry => path.resolve(rootDir, entry))
    : [path.resolve(rootDir, config.include)]

  await generateTypes({
    rootDir,
    include,
    outDir: path.resolve(rootDir, config.outDir),
    mode: config.mode,
    autoStable: config.autoStable,
    hashed: config.hashed,
    manifestPath: config.manifestPath
      ? path.resolve(rootDir, config.manifestPath)
      : undefined,
  })
}

const mergedManifest = withAliasEntries(
  manifestPaths.map(readManifest).reduce((acc, entry) => ({ ...acc, ...entry }), {}),
)
writeManifest(mergedManifest)
