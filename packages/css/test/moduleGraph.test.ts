import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

import { collectStyleImports } from '../src/moduleGraph.ts'
import type { CssResolver } from '../src/types.js'

interface Project {
  root: string
  file: (rel: string) => string
  writeFile: (rel: string, contents: string) => Promise<string>
  cleanup: () => Promise<void>
}

async function createProject(prefix: string): Promise<Project> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  const writeFile = async (rel: string, contents: string): Promise<string> => {
    const target = path.join(root, rel)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, contents, 'utf8')
    return target
  }
  return {
    root,
    file: rel => path.join(root, rel),
    writeFile,
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  }
}

async function realpathAll(paths: string[]): Promise<string[]> {
  return Promise.all(paths.map(filePath => fs.realpath(filePath)))
}

test('collectStyleImports walks modules, resolves variants, and dedupes styles', async () => {
  const project = await createProject('knighted-module-graph-basic-')
  try {
    await project.writeFile('styles/shared.css', '.shared { color: red; }')
    await project.writeFile('styles/component.scss', '.component { color: blue; }')
    await project.writeFile('styles/legacy.css', '.legacy { color: green; }')
    await project.writeFile('styles/exported.css', '.exported { color: purple; }')
    await project.writeFile('styles/async.css', '.async { color: orange; }')
    await project.writeFile('styles/nested/deep.css', '.deep { color: teal; }')
    await project.writeFile('styles/virtual.css', '.virtual { color: pink; }')
    await project.writeFile('styles/url.css', '.url { color: black; }')

    const fileUrl = pathToFileURL(project.file('styles/url.css')).href
    const entrySource = `import '${fileUrl}'
  import './styles/shared.css?inline#hash'
  import './component.js'
  import './missing/script.js'
  import 'node:fs'
  const builtin = require('fs')
  await import('./async-chunk.js')
  await import('https://cdn.knighted.dev/widget.js')
  import '@virtual/style'
  void builtin
  `
    await project.writeFile('entry.ts', entrySource)

    const componentSource = `import './styles/component.scss'
const duplicate = require('./styles/shared.css')
import legacyStyles = require('./styles/legacy.css')
export * from './styles/exported.css?raw'
const viaProperty = require.resolve('./styles/component.scss')
void duplicate
void legacyStyles
void viaProperty
`
    await project.writeFile('component.ts', componentSource)

    const asyncChunkSource = `import './styles/async.css?url#data'
export async function load() {
  await import('./nested/deep.js')
  return import('node:path')
}
`
    await project.writeFile('async-chunk.tsx', asyncChunkSource)

    const nestedSource = `import '../styles/nested/deep.css'
`
    await project.writeFile('nested/deep.ts', nestedSource)

    const resolver: CssResolver = async specifier => {
      if (specifier === '@virtual/style') {
        return pathToFileURL(project.file('styles/virtual.css')).href
      }
      return undefined
    }

    const styles = await collectStyleImports(project.file('entry.ts'), {
      cwd: project.root,
      styleExtensions: ['.css', '.scss'],
      filter: () => true,
      resolver,
    })

    const expected = [
      project.file('styles/url.css'),
      project.file('styles/shared.css'),
      project.file('styles/component.scss'),
      project.file('styles/legacy.css'),
      project.file('styles/exported.css'),
      project.file('styles/async.css'),
      project.file('styles/nested/deep.css'),
      project.file('styles/virtual.css'),
    ]

    assert.deepEqual(await realpathAll(styles), await realpathAll(expected))
  } finally {
    await project.cleanup()
  }
})

test('collectStyleImports honors tsconfig paths loaded from a file', async () => {
  const project = await createProject('knighted-module-graph-tsconfig-file-')
  try {
    await project.writeFile(
      'configs/tsconfig.json',
      JSON.stringify(
        {
          compilerOptions: {
            baseUrl: '../src',
            paths: {
              '@theme/*': ['styles/*'],
              '@pkg/*': ['pkg/*/index'],
              '@core': ['styles/core/index.css'],
            },
          },
        },
        null,
        2,
      ),
    )

    await project.writeFile('src/styles/colors.css', '.colors { color: coral; }')
    await project.writeFile('src/styles/button.css', '.button { color: salmon; }')
    await project.writeFile('src/styles/core/index.css', '.core { color: navy; }')

    const pkgSource = `import '@theme/button.css'
`
    await project.writeFile('src/pkg/button/index.ts', pkgSource)

    const entrySource = `import '@theme/colors.css'
import '@core'
import '@pkg/button'
`
    await project.writeFile('src/entry.ts', entrySource)

    const styles = await collectStyleImports(project.file('src/entry.ts'), {
      cwd: project.root,
      styleExtensions: ['.css'],
      filter: filePath => filePath.startsWith(project.root),
      graphOptions: {
        tsConfig: project.file('configs'),
      },
    })

    assert.deepEqual(styles, [
      project.file('src/styles/colors.css'),
      project.file('src/styles/core/index.css'),
      project.file('src/styles/button.css'),
    ])
  } finally {
    await project.cleanup()
  }
})

test('collectStyleImports resolves inline tsconfig objects with directory indexes', async () => {
  const project = await createProject('knighted-module-graph-tsconfig-inline-')
  try {
    await project.writeFile('styles/direct.css', '.direct { color: cyan; }')
    await project.writeFile('blocks/panel/index.css', '.panel { color: magenta; }')

    const entrySource = `import '@direct'
import '@blocks/panel'
`
    await project.writeFile('entry.ts', entrySource)

    const styles = await collectStyleImports(project.file('entry.ts'), {
      cwd: project.root,
      styleExtensions: ['.css'],
      filter: filePath => filePath.startsWith(project.root),
      graphOptions: {
        tsConfig: {
          compilerOptions: {
            baseUrl: '.',
            paths: {
              '@direct': ['styles/direct.css'],
              '@blocks/*': ['blocks/*'],
            },
          },
        },
      },
    })

    assert.deepEqual(styles, [
      project.file('styles/direct.css'),
      project.file('blocks/panel/index.css'),
    ])
  } finally {
    await project.cleanup()
  }
})
