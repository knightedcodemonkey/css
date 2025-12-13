import path from 'node:path'
import { existsSync, promises as fs } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

export type CssResolver = (
  specifier: string,
  ctx: { cwd: string },
) => string | Promise<string | undefined>

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
      if (shouldNormalizeSpecifier(url)) {
        const resolvedPath = await resolveAliasSpecifier(url, resolver, cwd)
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
): Promise<string | undefined> {
  const resolved = await resolver(specifier, { cwd })
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

export const __sassInternals = {
  createSassImporter,
  resolveAliasSpecifier,
  shouldNormalizeSpecifier,
  ensureSassPath,
  resolveRelativeSpecifier,
}
