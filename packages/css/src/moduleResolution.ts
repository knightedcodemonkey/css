import path from 'node:path'
import { existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  ResolverFactory,
  type NapiResolveOptions,
  type TsconfigOptions as ResolverTsconfigOptions,
} from 'oxc-resolver'

type TsconfigLike = string | Record<string, unknown>

const DEFAULT_CONDITIONS = ['import', 'require', 'node', 'default']

export function normalizeResolverResult(
  result: string | undefined,
  cwd: string,
): string | undefined {
  if (!result) {
    return undefined
  }
  if (result.startsWith('file://')) {
    try {
      return fileURLToPath(new URL(result))
    } catch {
      return undefined
    }
  }
  return path.isAbsolute(result) ? result : path.resolve(cwd, result)
}

export function resolveWithFactory(
  factory: ResolverFactory,
  specifier: string,
  importer: string,
  extensions: string[],
): string | undefined {
  if (specifier.startsWith('file://')) {
    try {
      return findExistingFile(fileURLToPath(new URL(specifier)), extensions)
    } catch {
      return undefined
    }
  }
  if (/^[a-z][\w+.-]*:/i.test(specifier)) {
    return undefined
  }
  try {
    const result = factory.resolveFileSync(importer, specifier)
    return result?.path
  } catch {
    return undefined
  }
}

export function createResolverFactory(
  cwd: string,
  extensions: string[],
  scriptExtensions: string[],
  options?: { conditions?: string[]; tsconfig?: TsconfigLike },
): ResolverFactory {
  const resolveOptions: NapiResolveOptions = {
    extensions,
    conditionNames: options?.conditions ?? DEFAULT_CONDITIONS,
  }
  const extensionAlias = buildExtensionAlias(scriptExtensions)
  if (extensionAlias) {
    resolveOptions.extensionAlias = extensionAlias
  }
  const tsconfigOption = resolveResolverTsconfig(options?.tsconfig, cwd)
  resolveOptions.tsconfig = tsconfigOption ?? 'auto'
  return new ResolverFactory(resolveOptions)
}

function buildExtensionAlias(
  scriptExtensions: string[],
): Record<string, string[]> | undefined {
  const alias: Record<string, string[]> = {}
  const jsTargets = dedupeExtensions(
    scriptExtensions.filter(ext =>
      ['.js', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts'].includes(ext),
    ),
  )
  if (jsTargets.length > 0) {
    for (const key of ['.js', '.mjs', '.cjs']) {
      alias[key] = jsTargets
    }
  }
  const jsxTargets = dedupeExtensions(
    scriptExtensions.filter(ext => ext === '.jsx' || ext === '.tsx'),
  )
  if (jsxTargets.length > 0) {
    alias['.jsx'] = jsxTargets
  }
  return Object.keys(alias).length > 0 ? alias : undefined
}

function dedupeExtensions(extensions: string[]): string[] {
  const result = new Set<string>()
  for (const ext of extensions) {
    result.add(ext)
  }
  return Array.from(result)
}

export function resolveResolverTsconfig(
  input: TsconfigLike | undefined,
  cwd: string,
): ResolverTsconfigOptions | undefined {
  if (!input || typeof input !== 'string') {
    return undefined
  }
  const resolved = resolveTsconfigPath(input, cwd)
  if (!resolved) {
    return undefined
  }
  return { configFile: resolved }
}

export function resolveTsconfigPath(
  tsconfigPath: string,
  cwd: string,
): string | undefined {
  const absolute = path.isAbsolute(tsconfigPath)
    ? tsconfigPath
    : path.resolve(cwd, tsconfigPath)
  if (!existsSync(absolute)) {
    return undefined
  }
  const stats = statSync(absolute)
  if (stats.isDirectory()) {
    const candidate = path.join(absolute, 'tsconfig.json')
    return existsSync(candidate) ? candidate : undefined
  }
  return absolute
}

export function findExistingFile(
  candidate: string,
  extensions: string[],
): string | undefined {
  const candidateHasExt = hasExtension(candidate)
  if (candidateHasExt && existsSync(candidate)) {
    return candidate
  }
  if (!candidateHasExt) {
    for (const ext of extensions) {
      const withExt = `${candidate}${ext}`
      if (existsSync(withExt)) {
        return withExt
      }
    }
  }
  if (existsSync(candidate) && statSync(candidate).isDirectory()) {
    for (const ext of extensions) {
      const indexPath = path.join(candidate, `index${ext}`)
      if (existsSync(indexPath)) {
        return indexPath
      }
    }
  }
  return undefined
}

export function hasExtension(filePath: string): boolean {
  return Boolean(path.extname(filePath))
}
