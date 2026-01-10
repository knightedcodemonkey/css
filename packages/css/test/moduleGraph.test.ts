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

test('collectStyleImports picks up CSS imports that include import attributes', async () => {
  const project = await createProject('knighted-module-graph-attr-')
  try {
    await project.writeFile('styles/button.css', '.button { color: coral; }')
    await project.writeFile(
      'entry.ts',
      `import styles from './styles/button.css' with { type: "css" }
void styles
`,
    )

    const styles = await collectStyleImports(project.file('entry.ts'), {
      cwd: project.root,
      styleExtensions: ['.css'],
      filter: () => true,
    })

    assert.deepEqual(
      await realpathAll(styles),
      await realpathAll([project.file('styles/button.css')]),
    )
  } finally {
    await project.cleanup()
  }
})

test('collectStyleImports treats extensionless imports with attributes as styles', async () => {
  const project = await createProject('knighted-module-graph-attr-extensionless-')
  try {
    await project.writeFile('styles/panel.css', '.panel { color: teal; }')
    await project.writeFile(
      'entry.ts',
      `import panel from './styles/panel' with { type: "css" }
void panel
`,
    )

    const styles = await collectStyleImports(project.file('entry.ts'), {
      cwd: project.root,
      styleExtensions: ['.css'],
      filter: () => true,
    })

    assert.deepEqual(
      await realpathAll(styles),
      await realpathAll([project.file('styles/panel.css')]),
    )
  } finally {
    await project.cleanup()
  }
})

test('collectStyleImports honors attributes with path-mapped specifiers', async () => {
  const project = await createProject('knighted-module-graph-attr-paths-')
  try {
    await project.writeFile('styles/theme.css', '.theme { color: sienna; }')
    await project.writeFile(
      'entry.ts',
      `import theme from '@theme/panel' with { type: "css" }
void theme
`,
    )

    const styles = await collectStyleImports(project.file('entry.ts'), {
      cwd: project.root,
      styleExtensions: ['.css'],
      filter: filePath => filePath.startsWith(project.root),
      graphOptions: {
        tsConfig: {
          compilerOptions: {
            baseUrl: '.',
            paths: {
              '@theme/panel': ['styles/theme.css'],
            },
          },
        },
      },
    })

    assert.deepEqual(
      await realpathAll(styles),
      await realpathAll([project.file('styles/theme.css')]),
    )
  } finally {
    await project.cleanup()
  }
})

test('collectStyleImports honors attributes on re-exports', async () => {
  const project = await createProject('knighted-module-graph-attr-reexport-')
  try {
    await project.writeFile('styles/reexport.css', '.reexport { color: khaki; }')
    await project.writeFile(
      'entry.ts',
      `export * from './styles/reexport.css' with { type: "css" }
`,
    )

    const styles = await collectStyleImports(project.file('entry.ts'), {
      cwd: project.root,
      styleExtensions: ['.css'],
      filter: () => true,
    })

    assert.deepEqual(
      await realpathAll(styles),
      await realpathAll([project.file('styles/reexport.css')]),
    )
  } finally {
    await project.cleanup()
  }
})

test('collectStyleImports supports legacy assert syntax for css type', async () => {
  const project = await createProject('knighted-module-graph-attr-assert-')
  try {
    await project.writeFile('styles/assert.css', '.assert { color: plum; }')
    await project.writeFile(
      'entry.ts',
      `import styles from './styles/assert.css' assert { type: "css" }
void styles
`,
    )

    const styles = await collectStyleImports(project.file('entry.ts'), {
      cwd: project.root,
      styleExtensions: ['.css'],
      filter: () => true,
    })

    assert.deepEqual(
      await realpathAll(styles),
      await realpathAll([project.file('styles/assert.css')]),
    )
  } finally {
    await project.cleanup()
  }
})

test('collectStyleImports supports dynamic import attributes with static specifiers', async () => {
  const project = await createProject('knighted-module-graph-attr-dynamic-')
  try {
    await project.writeFile('styles/dynamic.css', '.dynamic { color: orchid; }')
    await project.writeFile(
      'entry.ts',
      `export async function load() {
  return import('./styles/dynamic', { with: { type: "css" } })
}
`,
    )

    const styles = await collectStyleImports(project.file('entry.ts'), {
      cwd: project.root,
      styleExtensions: ['.css'],
      filter: () => true,
    })

    assert.deepEqual(
      await realpathAll(styles),
      await realpathAll([project.file('styles/dynamic.css')]),
    )
  } finally {
    await project.cleanup()
  }
})

test('collectStyleImports ignores dynamic import attributes with non-static specifiers', async () => {
  const project = await createProject('knighted-module-graph-attr-dynamic-negative-')
  try {
    await project.writeFile('styles/skip.css', '.skip { color: gray; }')
    await project.writeFile(
      'entry.ts',
      [
        "const name = 'skip'",
        'async function load() {',
        '  return import(`./styles/${name}.css`, { with: { type: "css" } })',
        '}',
        'void load',
        '',
      ].join('\n'),
    )

    const styles = await collectStyleImports(project.file('entry.ts'), {
      cwd: project.root,
      styleExtensions: ['.css'],
      filter: () => true,
    })

    assert.deepEqual(styles, [])
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

test('collectStyleImports keeps hash-prefixed specifiers intact', async () => {
  const project = await createProject('knighted-module-graph-imports-hash-')
  try {
    await project.writeFile(
      'package.json',
      JSON.stringify(
        {
          name: 'hash-imports',
          type: 'module',
          imports: {
            '#ui/*': './src/ui/*',
          },
        },
        null,
        2,
      ),
    )
    await project.writeFile('src/ui/button.scss', '.button { color: hotpink; }')
    await project.writeFile(
      'src/ui/button.js',
      `import './button.scss'
export const Button = () => null
`,
    )
    await project.writeFile(
      'src/entry.ts',
      `import { Button } from '#ui/button.js'
void Button
`,
    )

    const styles = await collectStyleImports(project.file('src/entry.ts'), {
      cwd: project.root,
      styleExtensions: ['.scss'],
      filter: () => true,
    })

    assert.deepEqual(
      await realpathAll(styles),
      await realpathAll([project.file('src/ui/button.scss')]),
    )
  } finally {
    await project.cleanup()
  }
})

test('collectStyleImports tolerates missing tsconfig files and absolute baseUrls', async () => {
  const project = await createProject('knighted-module-graph-tsconfig-gaps-')
  try {
    await project.writeFile('styles/abs.css', '.abs { color: silver; }')
    await project.writeFile(
      'entry.ts',
      `import '@abs/abs.css'
`,
    )

    const missingBaseUrl = await collectStyleImports(project.file('entry.ts'), {
      cwd: project.root,
      styleExtensions: ['.css'],
      filter: () => true,
      graphOptions: {
        tsConfig: {
          compilerOptions: {
            paths: {
              '@noop/*': ['styles/*'],
            },
          },
        },
      },
    })

    assert.deepEqual(missingBaseUrl, [])

    const missing = await collectStyleImports(project.file('entry.ts'), {
      cwd: project.root,
      styleExtensions: ['.css'],
      filter: () => true,
      graphOptions: {
        tsConfig: project.file('tsconfig.missing'),
      },
    })

    assert.deepEqual(missing, [])

    const missingCached = await collectStyleImports(project.file('entry.ts'), {
      cwd: project.root,
      styleExtensions: ['.css'],
      filter: () => true,
      graphOptions: {
        tsConfig: project.file('tsconfig.missing'),
      },
    })

    assert.deepEqual(missingCached, [])

    const styles = await collectStyleImports(project.file('entry.ts'), {
      cwd: project.root,
      styleExtensions: ['.css'],
      filter: () => true,
      graphOptions: {
        tsConfig: {
          compilerOptions: {
            baseUrl: project.root,
            paths: {
              '@empty/*': [],
              '@abs/*': ['styles/*'],
              '@string/*': 'styles/*',
            },
          },
        },
      },
    })

    assert.deepEqual(styles, [project.file('styles/abs.css')])
  } finally {
    await project.cleanup()
  }
})

test('collectStyleImports normalizes resolver results, file URLs, and template literals', async () => {
  const project = await createProject('knighted-module-graph-resolver-normalize-')
  try {
    const resolverStyle = await project.writeFile(
      'styles/from-resolver.css',
      '.resolver { color: lime; }',
    )
    const mappedStyle = await project.writeFile(
      'styles/from-tsconfig.css',
      '.mapped { color: olive; }',
    )
    const templateStyle = await project.writeFile(
      'styles/from-template.css',
      '.template { color: navy; }',
    )
    const optionalStyle = await project.writeFile(
      'styles/from-optional.css',
      '.optional { color: teal; }',
    )
    const fileUrlStyle = await project.writeFile(
      'styles/from-file-url.css',
      '.file { color: maroon; }',
    )
    const directoryIndexStyle = await project.writeFile(
      'styles/from-file-url-dir/index.css',
      '.dir { color: brown; }',
    )

    const resolver: CssResolver = async specifier => {
      if (specifier === '@resolver/style') {
        return './styles/from-resolver.css'
      }
      if (specifier === '@resolver/invalid') {
        return 'file://:bad'
      }
      return undefined
    }

    const entrySource = `import '@resolver/style'
  import '@resolver/invalid'
  import '@tsconfig/mapped'
  import('file://${pathToFileURL(fileUrlStyle).pathname}')
  import(\`./styles/from-template.css\`)
  import('file://:bad')
  import('file://${pathToFileURL(path.dirname(directoryIndexStyle)).pathname}')
  const optional = require?.('./styles/from-optional.css')
  import 'node:fs'
  void optional
  `
    await project.writeFile('entry.ts', entrySource)

    const styles = await collectStyleImports(project.file('entry.ts'), {
      cwd: project.root,
      styleExtensions: ['.css'],
      filter: () => true,
      resolver,
      graphOptions: {
        tsConfig: {
          compilerOptions: {
            baseUrl: '.',
            paths: {
              '@tsconfig/mapped': ['styles/from-tsconfig.css'],
              '@resolver/invalid': ['styles/from-tsconfig.css'],
            },
          },
        },
      },
    })

    assert.deepEqual(
      await realpathAll(styles),
      await realpathAll([
        resolverStyle,
        mappedStyle,
        fileUrlStyle,
        templateStyle,
        directoryIndexStyle,
        optionalStyle,
      ]),
    )
  } finally {
    await project.cleanup()
  }
})
