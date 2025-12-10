import path from 'node:path'

import type { CssResolver } from '../../src/css'

const fixturesRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../fixtures/resolvers',
)

type FixtureName = 'rspack' | 'vite' | 'webpack'

interface ResolverFixture {
  name: FixtureName
  projectDir: string
  entrySpecifier: string
  entryFile: string
  resolver: CssResolver
  expectedSelector: string
}

const FIXTURE_CONFIG: Record<
  FixtureName,
  { entry: string; specifier: string; selector: string }
> = {
  rspack: {
    entry: 'src/index.js',
    specifier: '@rspack/app',
    selector: '.rspack-themed',
  },
  vite: {
    entry: 'src/index.ts',
    specifier: '@vite/app',
    selector: '.vite-themed',
  },
  webpack: {
    entry: 'src/index.js',
    specifier: '@webpack/app',
    selector: '.webpack-themed',
  },
}

export function createResolverFixture(name: FixtureName): ResolverFixture {
  const config = FIXTURE_CONFIG[name]
  const projectDir = path.join(fixturesRoot, name)
  const entryFile = path.join(projectDir, config.entry)

  const resolver: CssResolver = async specifier => {
    if (specifier === config.specifier) {
      return entryFile
    }
    return undefined
  }

  return {
    name,
    projectDir,
    entrySpecifier: config.specifier,
    entryFile,
    resolver,
    expectedSelector: config.selector,
  }
}
