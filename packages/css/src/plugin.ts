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
  strictSidecar?: boolean
  manifestPath?: string
}

interface ResolveRequest {
  request?: string
  path?: string
  context?: {
    issuer?: string
    path?: string
  }
  __knightedCssAugmented?: boolean
  __knightedCssResolve?: boolean
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
  inputFileSystem?: FileSystemLike
  hooks?: {
    normalModuleFactory?: NormalModuleFactoryHook
    invalid?: { tap(name: string, callback: (fileName?: string) => void): void }
    watchRun?: { tap(name: string, callback: () => void): void }
    done?: { tap(name: string, callback: () => void): void }
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

type FileSystemLike = {
  readFile?: (
    path: string,
    callback: (error: NodeJS.ErrnoException | null, data?: Buffer) => void,
  ) => void
  stat?: (path: string, callback: (error?: NodeJS.ErrnoException | null) => void) => void
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

function stripExtension(filePath: string): string {
  const ext = path.extname(filePath)
  return ext ? filePath.slice(0, -ext.length) : filePath
}

function isWithinRoot(filePath: string, rootDir: string): boolean {
  const relative = path.relative(rootDir, filePath)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
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

export class KnightedCssResolverPlugin {
  private readonly rootDir: string
  private readonly resolverFactory
  private readonly extensions: string[]
  private readonly debug: boolean
  private readonly combinedPaths: Array<string | RegExp>
  private readonly strictSidecar: boolean
  private readonly manifestPath?: string
  private readonly sidecarCache = new Map<
    string,
    { path: string; hasMarker: boolean } | null
  >()
  private readonly diagnostics = {
    rewrites: 0,
    cacheHits: 0,
    markerMisses: 0,
    manifestMisses: 0,
  }
  private fileSystem?: FileSystemLike
  private inputFileSystem?: FileSystemLike
  private manifestCache?: Map<string, string>
  private compilerResolver?: ResolverLike

  constructor(options: KnightedCssResolverPluginOptions = {}) {
    this.rootDir = path.resolve(options.rootDir ?? process.cwd())
    this.extensions = options.extensions ?? SCRIPT_EXTENSIONS
    this.debug = Boolean(options.debug)
    this.combinedPaths = options.combinedPaths ?? []
    this.strictSidecar =
      options.strictSidecar === undefined
        ? Boolean(options.manifestPath)
        : options.strictSidecar
    this.manifestPath = options.manifestPath
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
    if ('fileSystem' in resolver) {
      this.fileSystem = (
        resolver as ResolverLike & { fileSystem?: FileSystemLike }
      ).fileSystem
    }
    this.compilerResolver = resolver
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
    this.inputFileSystem = compiler.inputFileSystem
    compiler.hooks?.invalid?.tap('KnightedCssResolverPlugin', () => {
      this.sidecarCache.clear()
      this.manifestCache = undefined
      this.resetDiagnostics()
    })
    compiler.hooks?.watchRun?.tap('KnightedCssResolverPlugin', () => {
      this.sidecarCache.clear()
      this.manifestCache = undefined
      this.resetDiagnostics()
    })
    compiler.hooks?.done?.tap('KnightedCssResolverPlugin', () => {
      this.flushDiagnostics()
    })
    const resolver = compiler.getResolver?.('normal')
    if (resolver && this.isResolver(resolver as ResolverLike)) {
      this.compilerResolver = resolver as ResolverLike
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

  private resetDiagnostics(): void {
    this.diagnostics.rewrites = 0
    this.diagnostics.cacheHits = 0
    this.diagnostics.markerMisses = 0
    this.diagnostics.manifestMisses = 0
  }

  private flushDiagnostics(): void {
    if (!this.debug) {
      return
    }
    const { rewrites, cacheHits, markerMisses, manifestMisses } = this.diagnostics
    if (rewrites + cacheHits + markerMisses + manifestMisses === 0) {
      return
    }
    // eslint-disable-next-line no-console
    console.log(
      `knighted-css: summary rewrites=${rewrites} cacheHits=${cacheHits} manifestMisses=${manifestMisses} markerMisses=${markerMisses}`,
    )
    this.resetDiagnostics()
  }

  private async readFileFromFs(filePath: string): Promise<Buffer | null> {
    const fsHandle = this.fileSystem ?? this.inputFileSystem
    if (fsHandle?.readFile) {
      return new Promise(resolve => {
        fsHandle.readFile?.(filePath, (error, data) => {
          if (error || !data) {
            resolve(null)
            return
          }
          resolve(data)
        })
      })
    }

    try {
      const data = await fs.readFile(filePath)
      return data
    } catch {
      return null
    }
  }

  private async fileExistsFromFs(filePath: string): Promise<boolean> {
    const fsHandle = this.fileSystem ?? this.inputFileSystem
    if (fsHandle?.stat) {
      return new Promise(resolve => {
        fsHandle.stat?.(filePath, error => resolve(!error))
      })
    }

    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  }

  private buildSidecarCandidates(resolvedPath: string): string[] {
    if (resolvedPath.endsWith('.d.ts')) {
      return [resolvedPath]
    }
    const candidates = new Set<string>()
    candidates.add(`${resolvedPath}.d.ts`)
    candidates.add(`${stripExtension(resolvedPath)}.d.ts`)
    return Array.from(candidates)
  }

  private async loadManifest(): Promise<Map<string, string> | null> {
    if (!this.manifestPath) {
      return null
    }
    if (this.manifestCache) {
      return this.manifestCache
    }
    const data = await this.readFileFromFs(this.manifestPath)
    if (!data) {
      return null
    }
    try {
      const parsed = JSON.parse(data.toString('utf8')) as Record<
        string,
        { file?: string }
      >
      const map = new Map<string, string>()
      for (const [key, entry] of Object.entries(parsed)) {
        if (entry?.file) {
          map.set(key, entry.file)
        }
      }
      this.manifestCache = map
      return map
    } catch {
      return null
    }
  }

  private async resolveSidecarInfo(
    resolvedPath: string,
    logger?: (message: string) => void,
  ): Promise<{ path: string; hasMarker: boolean } | null> {
    const cached = this.sidecarCache.get(resolvedPath)
    if (cached !== undefined) {
      this.diagnostics.cacheHits += 1
      return cached
    }

    const manifest = await this.loadManifest()
    const manifestKey = resolvedPath.split(path.sep).join('/')
    const manifestPath = manifest?.get(manifestKey)
    if (this.strictSidecar && this.manifestPath && !manifestPath) {
      this.diagnostics.manifestMisses += 1
      logger?.(`knighted-css: skip ${resolvedPath} (manifest miss)`)
      this.sidecarCache.set(resolvedPath, null)
      return null
    }
    const candidates = manifestPath
      ? [manifestPath]
      : this.buildSidecarCandidates(resolvedPath)

    for (const candidate of candidates) {
      if (!(await this.fileExistsFromFs(candidate))) {
        continue
      }
      if (!this.strictSidecar) {
        const info = { path: candidate, hasMarker: true }
        this.sidecarCache.set(resolvedPath, info)
        return info
      }
      const head = await this.readFileFromFs(candidate)
      const snippet = head ? head.toString('utf8', 0, 128) : ''
      const hasMarker = snippet.includes('@knighted-css')
      if (hasMarker) {
        const info = { path: candidate, hasMarker: true }
        this.sidecarCache.set(resolvedPath, info)
        return info
      }
      this.diagnostics.markerMisses += 1
      logger?.(
        `knighted-css: skip ${resolvedPath} (sidecar missing marker at ${candidate})`,
      )
    }

    this.sidecarCache.set(resolvedPath, null)
    return null
  }

  private async resolveWithCompiler(
    resolver: ResolverLike,
    specifier: string,
    importer: string,
  ): Promise<string | undefined> {
    return new Promise(resolve => {
      const request: ResolveRequest = {
        request: specifier,
        path: importer,
        context: { issuer: importer },
        __knightedCssResolve: true,
      }
      resolver.doResolve(
        resolver.getHook('resolve'),
        request,
        'knighted-css: resolve candidate',
        {},
        (error, result) => {
          if (error || !result || typeof result !== 'object') {
            resolve(undefined)
            return
          }
          const resolved = (result as { path?: string }).path
          if (typeof resolved === 'string') {
            resolve(resolved)
            return
          }
          const resource = (result as { resource?: string }).resource
          resolve(typeof resource === 'string' ? resource : undefined)
        },
      )
    })
  }

  private async resolveResource(
    resolver: ResolverLike | undefined,
    resource: string,
    importer: string,
  ): Promise<string | undefined> {
    if (resolver) {
      return this.resolveWithCompiler(resolver, resource, importer)
    }
    return resolveWithFactory(this.resolverFactory, resource, importer, this.extensions)
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
    if (
      !resource ||
      hasKnightedCssQuery(query) ||
      hasCombinedQuery(query) ||
      (data.contextInfo?.issuer &&
        hasKnightedCssQuery(splitResourceAndQuery(data.contextInfo.issuer).query)) ||
      (data.contextInfo?.issuer &&
        hasCombinedQuery(splitResourceAndQuery(data.contextInfo.issuer).query))
    ) {
      this.logWithoutContext(`knighted-css: skip ${data.request} (already tagged)`)
      callback(null, true)
      return
    }

    const importer = data.contextInfo?.issuer || data.context || this.rootDir
    if (!isWithinRoot(importer, this.rootDir)) {
      this.logWithoutContext(`knighted-css: skip ${importer} (outside root)`)
      callback(null, true)
      return
    }
    const resolved = await this.resolveResource(this.compilerResolver, resource, importer)

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

    const sidecarInfo = await this.resolveSidecarInfo(resolved, message =>
      this.logWithoutContext(message),
    )
    if (!sidecarInfo) {
      this.logWithoutContext(`knighted-css: skip ${resolved} (no sidecar)`)
      callback(null, true)
      return
    }

    this.logWithoutContext(`knighted-css: sidecar ${sidecarInfo.path}`)

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
    this.diagnostics.rewrites += 1
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

    if (request.__knightedCssAugmented || request.__knightedCssResolve) {
      callback()
      return
    }

    const { resource, query } = splitResourceAndQuery(request.request)
    if (
      !resource ||
      hasKnightedCssQuery(query) ||
      hasCombinedQuery(query) ||
      (request.context?.issuer &&
        hasKnightedCssQuery(splitResourceAndQuery(request.context.issuer).query)) ||
      (request.context?.issuer &&
        hasCombinedQuery(splitResourceAndQuery(request.context.issuer).query))
    ) {
      this.log(resolveContext, `knighted-css: skip ${request.request} (already tagged)`)
      callback()
      return
    }

    const importer = getImporterPath(request, this.rootDir)
    if (!isWithinRoot(importer, this.rootDir)) {
      this.log(resolveContext, `knighted-css: skip ${importer} (outside root)`)
      callback()
      return
    }
    const resolved = await this.resolveResource(resolver, resource, importer)

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

    const sidecarInfo = await this.resolveSidecarInfo(resolved, message =>
      this.log(resolveContext, message),
    )
    if (!sidecarInfo) {
      this.log(resolveContext, `knighted-css: skip ${resolved} (no sidecar)`)
      callback()
      return
    }

    this.log(resolveContext, `knighted-css: sidecar ${sidecarInfo.path}`)

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
    this.diagnostics.rewrites += 1

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
  isWithinRoot,
}
