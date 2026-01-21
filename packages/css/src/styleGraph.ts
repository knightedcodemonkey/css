import path from 'node:path'
import { promises as fs } from 'node:fs'

import type { CssResolver } from './types.js'
import {
  collectStyleImports,
  normalizeSpecifier,
  type ModuleGraphOptions,
} from './moduleGraph.js'
import {
  createResolverFactory,
  findExistingFile,
  normalizeResolverResult,
  resolveWithFactory,
} from './moduleResolution.js'
import {
  createPkgResolver,
  ensureSassPath,
  resolveAliasSpecifier,
  shouldNormalizeSpecifier,
} from './sassInternals.js'

const DEFAULT_STYLE_EXTENSIONS = ['.css', '.scss', '.sass', '.less', '.css.ts']

export interface StyleGraphOptions {
  cwd: string
  styleExtensions?: string[]
  filter?: (filePath: string) => boolean
  resolver?: CssResolver
  moduleGraph?: ModuleGraphOptions
}

export async function collectTransitiveStyleImports(
  entryPath: string,
  options: StyleGraphOptions,
): Promise<string[]> {
  const cwd = path.resolve(options.cwd)
  const extensions = normalizeExtensions(
    options.styleExtensions ?? DEFAULT_STYLE_EXTENSIONS,
  )
  const filter =
    typeof options.filter === 'function'
      ? options.filter
      : (filePath: string) => !filePath.includes('node_modules')

  const entryIsStyle = isStyleExtension(entryPath, extensions)
  let initialStyles: string[]

  if (entryIsStyle) {
    initialStyles = [path.resolve(entryPath)]
  } else {
    initialStyles = await collectStyleImports(entryPath, {
      cwd,
      styleExtensions: extensions,
      filter,
      resolver: options.resolver,
      graphOptions: options.moduleGraph,
    })
  }

  const queue = [...initialStyles]
  const ordered: string[] = []
  const seen = new Set<string>()

  for (const file of initialStyles) {
    const resolved = path.resolve(file)
    if (seen.has(resolved)) continue
    seen.add(resolved)
    ordered.push(resolved)
  }

  const resolverFactory = createResolverFactory(cwd, extensions, extensions, {
    conditions: options.moduleGraph?.conditions,
    tsconfig: options.moduleGraph?.tsConfig,
  })
  const sassResolver = createPkgResolver(cwd)

  while (queue.length > 0) {
    const filePath = queue.shift()
    if (!filePath) continue
    const absolutePath = path.resolve(filePath)
    let source: string
    try {
      source = await fs.readFile(absolutePath, 'utf8')
    } catch {
      continue
    }
    const dialect = getStyleDialect(absolutePath)
    if (!dialect) continue
    const specifiers = collectStyleSpecifiers(source, dialect)

    for (const raw of specifiers) {
      const normalized = normalizeSpecifier(raw)
      if (!normalized) continue
      if (isExternalSpecifier(normalized)) continue

      const resolved = await resolveStyleSpecifier({
        specifier: normalized,
        importer: absolutePath,
        dialect,
        extensions,
        cwd,
        resolver: options.resolver,
        resolverFactory,
        sassResolver,
      })

      if (!resolved) continue
      const normalizedResolved = path.resolve(resolved)
      if (!filter(normalizedResolved)) continue
      if (seen.has(normalizedResolved)) continue
      seen.add(normalizedResolved)
      ordered.push(normalizedResolved)
      queue.push(normalizedResolved)
    }
  }

  return ordered
}

function normalizeExtensions(extensions: string[]): string[] {
  const result = new Set<string>()
  for (const ext of extensions) {
    if (!ext) continue
    const normalized = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`
    result.add(normalized)
  }
  return Array.from(result)
}

function isStyleExtension(filePath: string, extensions: string[]): boolean {
  const lower = filePath.toLowerCase()
  return extensions.some(ext => lower.endsWith(ext))
}

type StyleDialect = 'css' | 'sass' | 'less' | 'css-ts'

function getStyleDialect(filePath: string): StyleDialect | undefined {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.scss') || lower.endsWith('.sass')) return 'sass'
  if (lower.endsWith('.less')) return 'less'
  if (lower.endsWith('.css.ts')) return 'css-ts'
  if (lower.endsWith('.css')) return 'css'
  return undefined
}

function collectStyleSpecifiers(source: string, dialect: StyleDialect): string[] {
  if (dialect === 'sass') {
    return collectSassSpecifiers(source)
  }
  if (dialect === 'less') {
    return collectLessSpecifiers(source)
  }
  if (dialect === 'css-ts') {
    return []
  }
  return collectCssSpecifiers(source)
}

function collectCssSpecifiers(source: string): string[] {
  const results: string[] = []
  const rx = /@import\s+(?:url\(\s*)?(?:['"])([^'"\n\r]+)(?:['"])\s*\)?/gi
  let match: RegExpExecArray | null
  while ((match = rx.exec(source)) !== null) {
    if (match[1]) results.push(match[1])
  }
  return results
}

function collectLessSpecifiers(source: string): string[] {
  const results: string[] = []
  const rx =
    /@import\s*(?:\([^)]*\)\s*)?(?:url\(\s*)?(?:['"])([^'"\n\r]+)(?:['"])\s*\)?/gi
  let match: RegExpExecArray | null
  while ((match = rx.exec(source)) !== null) {
    if (match[1]) results.push(match[1])
  }
  return results
}

function collectSassSpecifiers(source: string): string[] {
  const results: string[] = []
  const rx = /@(?:use|forward)\s+(?:['"])([^'"\n\r]+)(?:['"])/gi
  let match: RegExpExecArray | null
  while ((match = rx.exec(source)) !== null) {
    if (match[1]) results.push(match[1])
  }
  const importRx = /@import\s+([^;]+);/gi
  while ((match = importRx.exec(source)) !== null) {
    const chunk = match[1]
    if (!chunk) continue
    const quoted = chunk.match(/['"]([^'"]+)['"]/g) ?? []
    for (const entry of quoted) {
      const cleaned = entry.slice(1, -1)
      if (cleaned) results.push(cleaned)
    }
  }
  return results
}

function isExternalSpecifier(specifier: string): boolean {
  return /^(?:https?:|data:|blob:)/i.test(specifier)
}

async function resolveStyleSpecifier({
  specifier,
  importer,
  dialect,
  extensions,
  cwd,
  resolver,
  resolverFactory,
  sassResolver,
}: {
  specifier: string
  importer: string
  dialect: StyleDialect
  extensions: string[]
  cwd: string
  resolver?: CssResolver
  resolverFactory: ReturnType<typeof createResolverFactory>
  sassResolver: ReturnType<typeof createPkgResolver>
}): Promise<string | undefined> {
  if (dialect === 'sass') {
    return resolveSassSpecifier({
      specifier,
      importer,
      cwd,
      resolver,
      sassResolver,
    })
  }

  const resolvedByResolver = await resolveWithCustomResolver(
    specifier,
    importer,
    cwd,
    resolver,
    extensions,
  )
  if (resolvedByResolver) return resolvedByResolver

  if (specifier.startsWith('.')) {
    return findExistingFile(path.resolve(path.dirname(importer), specifier), extensions)
  }
  if (path.isAbsolute(specifier)) {
    return findExistingFile(specifier, extensions)
  }
  return resolveWithFactory(resolverFactory, specifier, importer, extensions)
}

async function resolveWithCustomResolver(
  specifier: string,
  importer: string,
  cwd: string,
  resolver: CssResolver | undefined,
  extensions: string[],
): Promise<string | undefined> {
  if (!resolver) return undefined
  const resolved = normalizeResolverResult(
    await resolver(specifier, { cwd, from: importer }),
    cwd,
  )
  if (!resolved) return undefined
  return findExistingFile(resolved, extensions) ?? resolved
}

async function resolveSassSpecifier({
  specifier,
  importer,
  cwd,
  resolver,
  sassResolver,
}: {
  specifier: string
  importer: string
  cwd: string
  resolver?: CssResolver
  sassResolver: ReturnType<typeof createPkgResolver>
}): Promise<string | undefined> {
  if (resolver && shouldNormalizeSpecifier(specifier)) {
    const resolved = await resolveAliasSpecifier(specifier, resolver, cwd, importer)
    if (resolved) return resolved
  }
  if (specifier.startsWith('pkg:')) {
    const resolved = await sassResolver(specifier.slice(4), importer)
    return resolved ? (ensureSassPath(resolved) ?? resolved) : undefined
  }
  if (specifier.startsWith('.')) {
    return ensureSassPath(path.resolve(path.dirname(importer), specifier))
  }
  if (path.isAbsolute(specifier)) {
    return ensureSassPath(specifier)
  }
  const resolved = await sassResolver(specifier, importer)
  return resolved ? (ensureSassPath(resolved) ?? resolved) : undefined
}
