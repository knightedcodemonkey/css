import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateTypes, type GenerateTypesOptions } from '../../css/src/generateTypes.js'

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

const manifestPaths: string[] = []

type ManifestEntry = { file: string; hash?: string }
type Manifest = Record<string, ManifestEntry>

type ModeAwareGenerateTypesOptions = GenerateTypesOptions & {
  mode?: ModeConfig['mode']
  manifestPath?: string
}

function readManifest(filePath: string): Manifest {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing manifest at ${filePath}.`)
  }
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Manifest
  const normalized: Manifest = {}
  for (const [key, value] of Object.entries(raw)) {
    if (value && typeof value.file === 'string') {
      normalized[key] = { file: value.file }
    }
  }
  return normalized
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
  const outDir = path.resolve(rootDir, config.outDir)
  const explicitManifestPath = config.manifestPath
    ? path.resolve(rootDir, config.manifestPath)
    : undefined

  const options: ModeAwareGenerateTypesOptions = {
    rootDir,
    include,
    outDir,
    mode: config.mode,
    autoStable: config.autoStable,
    hashed: config.hashed,
    manifestPath: explicitManifestPath,
  }

  const result = await generateTypes(options)

  if (config.mode === 'declaration') {
    const fallbackManifestPath =
      result.manifestPath ?? path.join(outDir, 'selector-modules.json')
    const candidates = [
      'sidecarManifestPath' in result ? result.sidecarManifestPath : undefined,
      explicitManifestPath,
      fallbackManifestPath,
    ].filter((value): value is string => typeof value === 'string')

    const resolved = candidates.find(candidate => fs.existsSync(candidate))
    if (resolved) {
      manifestPaths.push(resolved)
    }
  }
}

const mergedManifest = withAliasEntries(
  manifestPaths.map(readManifest).reduce((acc, entry) => ({ ...acc, ...entry }), {}),
)
writeManifest(mergedManifest)
