import path from 'node:path'
import { existsSync, promises as fs } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

import type { CssResolver } from './types.js'
import { createResolverFactory, resolveWithFactory } from './moduleResolution.js'

export type { CssResolver } from './types.js'

export function createSassImporter({
  cwd,
  resolver,
  entryPath,
}: {
  cwd: string
  resolver?: CssResolver
  entryPath?: string
}) {
  const debug = process.env.KNIGHTED_CSS_DEBUG_SASS === '1'
  const pkgResolver = createPkgResolver(cwd)

  return {
    async canonicalize(url: string, context?: { containingUrl?: URL | null }) {
      if (debug) {
        console.error('[knighted-css:sass] canonicalize request:', url)
        if (context?.containingUrl) {
          console.error('[knighted-css:sass] containing url:', context.containingUrl.href)
        }
      }
      const containingPath = context?.containingUrl
        ? fileURLToPath(context.containingUrl)
        : entryPath
      if (resolver && shouldNormalizeSpecifier(url)) {
        const resolvedPath = await resolveAliasSpecifier(
          url,
          resolver,
          cwd,
          containingPath,
        )
        if (!resolvedPath) {
          if (debug) {
            console.error('[knighted-css:sass] resolver returned no result for', url)
          }
        } else {
          const fileUrl = pathToFileURL(resolvedPath)
          if (debug) {
            console.error('[knighted-css:sass] canonical url:', fileUrl.href)
          }
          return fileUrl
        }
      }
      if (url.startsWith('pkg:')) {
        const resolvedPath = await pkgResolver(url.slice(4), containingPath)
        if (!resolvedPath) {
          if (debug) {
            console.error('[knighted-css:sass] pkg resolver returned no result for', url)
          }
          return null
        }
        const fileUrl = pathToFileURL(resolvedPath)
        if (debug) {
          console.error('[knighted-css:sass] canonical url:', fileUrl.href)
        }
        return fileUrl
      }
      const relativePath = resolveRelativeSpecifier(url, context?.containingUrl)
      if (relativePath) {
        const fileUrl = pathToFileURL(relativePath)
        if (debug) {
          console.error('[knighted-css:sass] canonical url:', fileUrl.href)
        }
        return fileUrl
      }
      return null
    },
    async load(canonicalUrl: URL) {
      if (debug) {
        console.error('[knighted-css:sass] load request:', canonicalUrl.href)
      }
      const filePath = fileURLToPath(canonicalUrl)
      const contents = await fs.readFile(filePath, 'utf8')
      return {
        contents,
        syntax: inferSassSyntax(filePath),
      }
    },
  }
}

export function createLegacySassImporter({
  cwd,
  resolver,
  entryPath,
}: {
  cwd: string
  resolver?: CssResolver
  entryPath?: string
}) {
  const debug = process.env.KNIGHTED_CSS_DEBUG_SASS === '1'
  const pkgResolver = createPkgResolver(cwd)

  return async (
    url: string,
    prev: string,
    done?: (result: { file: string } | null) => void,
  ) => {
    const containingPath = prev && prev !== 'stdin' ? prev : entryPath
    let resolvedPath: string | undefined

    if (resolver && shouldNormalizeSpecifier(url)) {
      resolvedPath = await resolveAliasSpecifier(url, resolver, cwd, containingPath)
      if (!resolvedPath && debug) {
        console.error('[knighted-css:sass] resolver returned no result for', url)
      }
    }
    if (!resolvedPath && url.startsWith('pkg:')) {
      resolvedPath = await pkgResolver(url.slice(4), containingPath)
      if (!resolvedPath && debug) {
        console.error('[knighted-css:sass] pkg resolver returned no result for', url)
      }
    }

    const result = resolvedPath ? { file: resolvedPath } : null
    if (done) {
      done(result)
      return undefined
    }
    return result
  }
}

export async function resolveAliasSpecifier(
  specifier: string,
  resolver: CssResolver,
  cwd: string,
  from?: string,
): Promise<string | undefined> {
  const resolved = await resolver(specifier, { cwd, from })
  if (!resolved) {
    return undefined
  }
  if (resolved.startsWith('file://')) {
    return ensureSassPath(fileURLToPath(new URL(resolved)))
  }
  const normalized = path.isAbsolute(resolved) ? resolved : path.resolve(cwd, resolved)
  return ensureSassPath(normalized)
}

export function shouldNormalizeSpecifier(specifier: string): boolean {
  const schemeMatch = specifier.match(/^([a-z][\w+.-]*):/i)
  if (!schemeMatch) {
    return false
  }
  const scheme = schemeMatch[1].toLowerCase()
  if (
    scheme === 'file' ||
    scheme === 'http' ||
    scheme === 'https' ||
    scheme === 'data' ||
    scheme === 'sass'
  ) {
    return false
  }
  return true
}

function inferSassSyntax(filePath: string): 'scss' | 'indented' {
  return filePath.endsWith('.sass') ? 'indented' : 'scss'
}

export function ensureSassPath(filePath: string): string | undefined {
  if (existsSync(filePath)) {
    return filePath
  }
  const ext = path.extname(filePath)
  const dir = path.dirname(filePath)
  const base = path.basename(filePath, ext)
  const partialCandidate = path.join(dir, `_${base}${ext}`)
  if (ext && existsSync(partialCandidate)) {
    return partialCandidate
  }
  const indexCandidate = path.join(dir, base, `index${ext}`)
  if (ext && existsSync(indexCandidate)) {
    return indexCandidate
  }
  const partialIndexCandidate = path.join(dir, base, `_index${ext}`)
  if (ext && existsSync(partialIndexCandidate)) {
    return partialIndexCandidate
  }
  return undefined
}

export function resolveRelativeSpecifier(
  specifier: string,
  containingUrl?: URL | null,
): string | undefined {
  if (!containingUrl || containingUrl.protocol !== 'file:') {
    return undefined
  }
  if (/^[a-z][\w+.-]*:/i.test(specifier)) {
    return undefined
  }
  const containingPath = fileURLToPath(containingUrl)
  const baseDir = path.dirname(containingPath)
  const candidate = path.resolve(baseDir, specifier)
  return ensureSassPath(candidate)
}

const SASS_EXTENSIONS = ['.scss', '.sass', '.css']

export function createPkgResolver(cwd: string) {
  const factory = createResolverFactory(cwd, SASS_EXTENSIONS, SASS_EXTENSIONS, {
    conditions: ['sass', 'import', 'require', 'node', 'default'],
  })
  return async (specifier: string, containingPath?: string) => {
    const importer = containingPath ?? path.join(cwd, 'index.scss')
    const resolved = resolveWithFactory(factory, specifier, importer, SASS_EXTENSIONS)
    if (resolved) {
      return ensureSassPath(resolved) ?? resolved
    }
    const resolvedViaNode = resolveWithNode(specifier, importer)
    if (!resolvedViaNode) {
      return undefined
    }
    return ensureSassPath(resolvedViaNode) ?? resolvedViaNode
  }
}

function resolveWithNode(specifier: string, importerPath: string): string | undefined {
  try {
    return createRequire(importerPath).resolve(specifier)
  } catch {
    return undefined
  }
}

export const __sassInternals = {
  createSassImporter,
  createLegacySassImporter,
  resolveAliasSpecifier,
  shouldNormalizeSpecifier,
  ensureSassPath,
  resolveRelativeSpecifier,
  createPkgResolver,
}
