import type { ModuleDefaultSignal } from './moduleInfo.js'

export const COMBINED_QUERY_FLAG = 'combined'
export const NAMED_ONLY_QUERY_FLAGS = ['named-only', 'no-default'] as const

export function splitQuery(query: string): string[] {
  const trimmed = query.startsWith('?') ? query.slice(1) : query
  if (!trimmed) return []
  return trimmed.split('&').filter(Boolean)
}

export function isQueryFlag(entry: string, flag: string): boolean {
  const [rawKey] = entry.split('=')
  try {
    return decodeURIComponent(rawKey) === flag
  } catch {
    return rawKey === flag
  }
}

export function buildSanitizedQuery(query?: string | null): string {
  if (!query) return ''
  const entries = splitQuery(query).filter(part => {
    if (isQueryFlag(part, COMBINED_QUERY_FLAG)) {
      return false
    }
    if (isQueryFlag(part, 'knighted-css')) {
      return false
    }
    if (NAMED_ONLY_QUERY_FLAGS.some(flag => isQueryFlag(part, flag))) {
      return false
    }
    return true
  })
  return entries.length > 0 ? `?${entries.join('&')}` : ''
}

export function shouldForwardDefaultExport(request: string): boolean {
  const [pathPart] = request.split('?')
  if (!pathPart) return true
  const lower = pathPart.toLowerCase()
  if (lower.endsWith('.css.ts') || lower.endsWith('.css.js')) {
    return false
  }
  return true
}

export function shouldEmitCombinedDefault(options: {
  detection: ModuleDefaultSignal
  request: string
  skipSyntheticDefault: boolean
}): boolean {
  if (options.skipSyntheticDefault) {
    return false
  }
  if (!shouldForwardDefaultExport(options.request)) {
    return false
  }
  if (options.detection === 'has-default') {
    return true
  }
  if (options.detection === 'no-default') {
    return false
  }
  return true
}

export const __loaderInternals = {
  buildSanitizedQuery,
  shouldEmitCombinedDefault,
}
