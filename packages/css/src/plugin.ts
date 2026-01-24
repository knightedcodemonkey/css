import fs from 'node:fs/promises'
import path from 'node:path'

import { createResolverFactory, resolveWithFactory } from './moduleResolution.js'

const KNIGHTED_CSS_QUERY = 'knighted-css'

const SCRIPT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs']

export interface KnightedCssResolverPluginOptions {
  rootDir?: string
  tsconfig?: string | Record<string, unknown>
  conditions?: string[]
  extensions?: string[]
  debug?: boolean
  combinedPaths?: Array<string | RegExp>
}

interface ResolveRequest {
  request?: string
  path?: string
  context?: {
    issuer?: string
    path?: string
  }
  __knightedCssAugmented?: boolean
}

interface ResolveContext {
  log?: (message: string) => void
}

interface ResolverHook {
  tapAsync(
    name: string,
    callback: (
      request: ResolveRequest,
      resolveContext: ResolveContext,
      callback: (error?: Error | null, result?: unknown) => void,
    ) => void,
  ): void
}

interface ResolverLike {
  getHook(name: string): ResolverHook
  doResolve(
    hook: ResolverHook,
    request: ResolveRequest,
    message: string,
    resolveContext: ResolveContext,
    callback: (error?: Error | null, result?: unknown) => void,
  ): void
}

interface ResolverFactoryHook {
  tap(name: string, callback: (resolver: ResolverLike) => void): void
}

interface ResolverFactoryLike {
  hooks?: {
    resolver?: {
      for(name: string): ResolverFactoryHook
    }
  }
}

interface CompilerLike {
  resolverFactory?: ResolverFactoryLike
  getResolver?: (type: string) => unknown
  hooks?: {
    normalModuleFactory?: NormalModuleFactoryHook
  }
}

interface NormalModuleFactoryHook {
  tap(name: string, callback: (factory: NormalModuleFactoryLike) => void): void
}

interface NormalModuleFactoryLike {
  hooks?: {
    beforeResolve?: NormalModuleFactoryBeforeResolveHook
  }
}

interface NormalModuleFactoryBeforeResolveHook {
  tapAsync(
    name: string,
    callback: (
      data: NormalModuleResolveData,
      callback: (error?: Error | null, result?: unknown) => void,
    ) => void,
  ): void
}

interface NormalModuleResolveData {
  request?: string
  context?: string
  contextInfo?: {
    issuer?: string
  }
}

function splitResourceAndQuery(specifier: string): { resource: string; query: string } {
  const hashOffset = specifier.startsWith('#') ? 1 : 0
  const hashIndex = specifier.indexOf('#', hashOffset)
  const trimmed = hashIndex >= 0 ? specifier.slice(0, hashIndex) : specifier
  const queryIndex = trimmed.indexOf('?')
  if (queryIndex < 0) {
    return { resource: trimmed, query: '' }
  }
  return { resource: trimmed.slice(0, queryIndex), query: trimmed.slice(queryIndex) }
}

function hasKnightedCssQuery(query: string): boolean {
  return /(?:^|[&?])knighted-css(?:=|&|$)/.test(query)
}

function hasCombinedQuery(query: string): boolean {
  return /(?:^|[&?])combined(?:=|&|$)/.test(query)
}

function appendQueryFlag(query: string, flag: string): string {
  if (!query) {
    return `?${flag}`
  }
  return `${query}&${flag}`
}

function isScriptResource(filePath: string): boolean {
  const normalized = filePath.toLowerCase()
  if (normalized.endsWith('.d.ts')) {
    return false
  }
  return SCRIPT_EXTENSIONS.some(ext => normalized.endsWith(ext))
}

function getImporterPath(request: ResolveRequest, fallback: string): string {
  return request.context?.issuer || request.context?.path || request.path || fallback
}

function buildSidecarPath(resolvedPath: string): string {
  return `${resolvedPath}.d.ts`
}

function isNodeModulesPath(filePath: string): boolean {
  return filePath.split(path.sep).includes('node_modules')
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

export class KnightedCssResolverPlugin {
  private readonly rootDir: string
  private readonly resolverFactory
  private readonly extensions: string[]
  private readonly debug: boolean
  private readonly combinedPaths: Array<string | RegExp>
  private readonly sidecarCache = new Map<string, boolean>()

  constructor(options: KnightedCssResolverPluginOptions = {}) {
    this.rootDir = path.resolve(options.rootDir ?? process.cwd())
    this.extensions = options.extensions ?? SCRIPT_EXTENSIONS
    this.debug = Boolean(options.debug)
    this.combinedPaths = options.combinedPaths ?? []
    this.resolverFactory = createResolverFactory(
      this.rootDir,
      this.extensions,
      SCRIPT_EXTENSIONS,
      {
        conditions: options.conditions,
        tsconfig: options.tsconfig,
      },
    )
  }

  apply(target: ResolverLike | CompilerLike) {
    if (this.isResolver(target)) {
      this.applyToResolver(target)
      return
    }

    this.applyToCompiler(target)
  }

  private isResolver(target: ResolverLike | CompilerLike): target is ResolverLike {
    return typeof (target as ResolverLike).getHook === 'function'
  }

  private applyToResolver(resolver: ResolverLike) {
    if (this.debug) {
      // eslint-disable-next-line no-console
      console.log('knighted-css: resolver plugin enabled')
    }
    const handler = (
      request: ResolveRequest,
      ctx: ResolveContext,
      callback: (error?: Error | null, result?: unknown) => void,
    ) => {
      void this.handleResolve(resolver, request, ctx, callback)
    }
    resolver.getHook('before-resolve').tapAsync('KnightedCssResolverPlugin', handler)
    resolver.getHook('resolve').tapAsync('KnightedCssResolverPlugin', handler)
  }

  private applyToCompiler(compiler: CompilerLike) {
    const resolver = compiler.getResolver?.('normal')
    if (resolver && this.isResolver(resolver as ResolverLike)) {
      this.applyToResolver(resolver as ResolverLike)
      return
    }

    const resolverHook = compiler.resolverFactory?.hooks?.resolver?.for('normal')
    if (!resolverHook) {
      const normalModuleFactory = compiler.hooks?.normalModuleFactory
      if (!normalModuleFactory) {
        return
      }

      normalModuleFactory.tap('KnightedCssResolverPlugin', factory => {
        const beforeResolve = factory.hooks?.beforeResolve
        if (!beforeResolve) {
          return
        }

        beforeResolve.tapAsync(
          'KnightedCssResolverPlugin',
          (data: NormalModuleResolveData, callback) => {
            void this.handleModuleFactoryResolve(data, callback)
          },
        )
      })

      return
    }

    resolverHook.tap('KnightedCssResolverPlugin', resolver =>
      this.applyToResolver(resolver),
    )
  }

  private log(resolveContext: ResolveContext, message: string) {
    if (!this.debug) {
      return
    }

    if (resolveContext.log) {
      resolveContext.log(message)
      return
    }

    // eslint-disable-next-line no-console
    console.log(message)
  }

  private logWithoutContext(message: string) {
    if (!this.debug) {
      return
    }

    // eslint-disable-next-line no-console
    console.log(message)
  }

  private async handleModuleFactoryResolve(
    data: NormalModuleResolveData,
    callback: (error?: Error | null, result?: unknown) => void,
  ): Promise<void> {
    if (!data?.request || typeof data.request !== 'string') {
      callback(null, true)
      return
    }

    this.logWithoutContext(`knighted-css: inspect ${data.request}`)

    const { resource, query } = splitResourceAndQuery(data.request)
    if (!resource || hasKnightedCssQuery(query)) {
      callback(null, true)
      return
    }

    const importer = data.contextInfo?.issuer || data.context || this.rootDir
    const resolved = resolveWithFactory(
      this.resolverFactory,
      resource,
      importer,
      this.extensions,
    )

    if (!resolved || !isScriptResource(resolved)) {
      this.logWithoutContext(`knighted-css: skip ${resource} (unresolved or non-script)`)
      callback(null, true)
      return
    }

    this.logWithoutContext(`knighted-css: resolved ${resource} -> ${resolved}`)

    if (isNodeModulesPath(resolved)) {
      this.logWithoutContext(`knighted-css: skip ${resolved} (node_modules)`)
      callback(null, true)
      return
    }

    const cached = this.sidecarCache.get(resolved)
    const hasSidecar =
      cached !== undefined ? cached : await fileExists(buildSidecarPath(resolved))
    if (cached === undefined) {
      this.sidecarCache.set(resolved, hasSidecar)
    }

    if (!hasSidecar) {
      this.logWithoutContext(`knighted-css: skip ${resolved} (no sidecar)`)
      callback(null, true)
      return
    }

    const shouldAppendCombined =
      this.combinedPaths.length > 0 &&
      this.combinedPaths.some(entry =>
        typeof entry === 'string' ? resolved.includes(entry) : entry.test(resolved),
      )

    const nextQuery =
      shouldAppendCombined && !hasCombinedQuery(query)
        ? appendQueryFlag(query, 'combined')
        : query
    const finalQuery = hasKnightedCssQuery(nextQuery)
      ? nextQuery
      : appendQueryFlag(nextQuery, KNIGHTED_CSS_QUERY)
    data.request = `${resource}${finalQuery}`
    this.logWithoutContext(`knighted-css: append ?${KNIGHTED_CSS_QUERY} to ${resource}`)
    callback(null, true)
  }

  private async handleResolve(
    resolver: ResolverLike,
    request: ResolveRequest,
    resolveContext: ResolveContext,
    callback: (error?: Error | null, result?: unknown) => void,
  ): Promise<void> {
    if (!request?.request || typeof request.request !== 'string') {
      callback()
      return
    }

    this.log(resolveContext, `knighted-css: inspect ${request.request}`)

    if (request.__knightedCssAugmented) {
      callback()
      return
    }

    const { resource, query } = splitResourceAndQuery(request.request)
    if (!resource || hasKnightedCssQuery(query)) {
      callback()
      return
    }

    const importer = getImporterPath(request, this.rootDir)
    const resolved = resolveWithFactory(
      this.resolverFactory,
      resource,
      importer,
      this.extensions,
    )

    if (!resolved || !isScriptResource(resolved)) {
      this.log(
        resolveContext,
        `knighted-css: skip ${resource} (unresolved or non-script)`,
      )
      callback()
      return
    }

    this.log(resolveContext, `knighted-css: resolved ${resource} -> ${resolved}`)

    if (isNodeModulesPath(resolved)) {
      this.log(resolveContext, `knighted-css: skip ${resolved} (node_modules)`)
      callback()
      return
    }

    const cached = this.sidecarCache.get(resolved)
    const hasSidecar =
      cached !== undefined ? cached : await fileExists(buildSidecarPath(resolved))
    if (cached === undefined) {
      this.sidecarCache.set(resolved, hasSidecar)
    }

    if (!hasSidecar) {
      this.log(resolveContext, `knighted-css: skip ${resolved} (no sidecar)`)
      callback()
      return
    }

    const shouldAppendCombined =
      this.combinedPaths.length > 0 &&
      this.combinedPaths.some(entry =>
        typeof entry === 'string' ? resolved.includes(entry) : entry.test(resolved),
      )

    const nextQuery =
      shouldAppendCombined && !hasCombinedQuery(query)
        ? appendQueryFlag(query, 'combined')
        : query
    const finalQuery = hasKnightedCssQuery(nextQuery)
      ? nextQuery
      : appendQueryFlag(nextQuery, KNIGHTED_CSS_QUERY)
    const nextRequest = `${resource}${finalQuery}`
    const augmented: ResolveRequest = {
      ...request,
      request: nextRequest,
      __knightedCssAugmented: true,
    }

    this.log(resolveContext, `knighted-css: append ?${KNIGHTED_CSS_QUERY} to ${resource}`)

    resolver.doResolve(
      resolver.getHook('resolve'),
      augmented,
      `knighted-css: append ?${KNIGHTED_CSS_QUERY}`,
      resolveContext,
      callback,
    )
  }
}

export function knightedCssResolverPlugin(
  options?: KnightedCssResolverPluginOptions,
): KnightedCssResolverPlugin {
  return new KnightedCssResolverPlugin(options)
}

export const __knightedCssPluginInternals = {
  splitResourceAndQuery,
  hasKnightedCssQuery,
  hasCombinedQuery,
  appendQueryFlag,
  buildSidecarPath,
  isScriptResource,
  isNodeModulesPath,
}
