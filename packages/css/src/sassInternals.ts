import path from 'node:path'
import { existsSync, promises as fs } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

import type { CssResolver } from './types.js'

export type { CssResolver } from './types.js'

export function createSassImporter({
  cwd,
  resolver,
}: {
  cwd: string
  resolver?: CssResolver
}) {
  if (!resolver) return undefined
  const debug = process.env.KNIGHTED_CSS_DEBUG_SASS === '1'

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
        : undefined
      if (shouldNormalizeSpecifier(url)) {
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

/**
 * Creates a built-in Sass importer that handles all pkg: imports.
 * - pkg:#subpath imports are resolved using package.json imports field
 * - Other pkg: imports return null (not handled by this importer)
 */
export function createPkgImporter({
  cwd,
  extensions,
}: {
  cwd: string
  extensions: string[]
}) {
  const debug = process.env.KNIGHTED_CSS_DEBUG_SASS === '1'

  return {
    async canonicalize(url: string, context?: { containingUrl?: URL | null }) {
      if (!url.startsWith('pkg:')) {
        return null
      }

      if (debug) {
        console.error('[knighted-css:sass-pkg] canonicalize request:', url)
        if (context?.containingUrl) {
          console.error(
            '[knighted-css:sass-pkg] containing url:',
            context.containingUrl.href,
          )
        }
      }

      /* Only handle pkg:# imports; others are not supported by this importer */
      const afterPkg = url.slice('pkg:'.length)
      if (!afterPkg.startsWith('#')) {
        if (debug) {
          console.error('[knighted-css:sass-pkg] not a pkg:# import, returning null')
        }
        return null
      }

      const containingPath = context?.containingUrl
        ? fileURLToPath(context.containingUrl)
        : path.join(cwd, 'index.js')

      /* Strip pkg: prefix to get the Node.js subpath import */
      const subpathImport = afterPkg

      try {
        /*
         * First try require.resolve which works if the exact file exists.
         * If that fails, manually resolve using package.json imports field.
         */
        let resolvedPath: string | undefined

        try {
          const requireFrom = createRequire(containingPath)
          resolvedPath = requireFrom.resolve(subpathImport)
        } catch {
          /* require.resolve failed, try manual resolution */
          resolvedPath = await resolveSubpathImport(subpathImport, containingPath)
        }

        if (resolvedPath) {
          /* Apply Sass-specific path resolution (partials, index files) */
          const sassPath = ensureSassPath(resolvedPath)
          if (sassPath) {
            const fileUrl = pathToFileURL(sassPath)
            if (debug) {
              console.error('[knighted-css:sass-pkg] canonical url:', fileUrl.href)
            }
            return fileUrl
          }
        }
      } catch (err) {
        if (debug) {
          console.error('[knighted-css:sass-pkg] resolution failed:', err)
        }
      }

      return null
    },
    async load(canonicalUrl: URL) {
      if (debug) {
        console.error('[knighted-css:sass-pkg] load request:', canonicalUrl.href)
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

/**
 * Manually resolve a Node.js subpath import by reading package.json imports field.
 * This is needed because require.resolve is strict and fails for Sass partials.
 */
async function resolveSubpathImport(
  subpathImport: string,
  fromPath: string,
): Promise<string | undefined> {
  /* Find the nearest package.json with imports field */
  let dir = path.dirname(fromPath)
  const root = path.parse(dir).root

  while (dir !== root) {
    const pkgPath = path.join(dir, 'package.json')
    if (existsSync(pkgPath)) {
      try {
        const pkgContent = await fs.readFile(pkgPath, 'utf8')
        const pkg = JSON.parse(pkgContent)

        if (pkg.imports && typeof pkg.imports === 'object') {
          /* Try to match the subpath import against imports patterns */
          for (const [pattern, target] of Object.entries(pkg.imports)) {
            if (typeof target !== 'string') continue

            /* Handle exact match */
            if (pattern === subpathImport) {
              return path.resolve(dir, target)
            }

            /* Handle wildcard pattern (#styles/* -> ./styles/*) */
            if (pattern.endsWith('/*')) {
              const prefix = pattern.slice(0, -2) // Remove /*
              if (subpathImport.startsWith(prefix + '/')) {
                const remaining = subpathImport.slice(prefix.length + 1) // Skip prefix and /
                const resolved = target.replace('*', remaining)
                return path.resolve(dir, resolved)
              }
            }
          }
        }
      } catch {
        /* Ignore package.json read/parse errors */
      }
    }
    dir = path.dirname(dir)
  }

  return undefined
}

export const __sassInternals = {
  createSassImporter,
  createPkgImporter,
  resolveAliasSpecifier,
  shouldNormalizeSpecifier,
  ensureSassPath,
  resolveRelativeSpecifier,
}
