import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

import { collectTransitiveStyleImports } from '../src/styleGraph.ts'
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

test('collectTransitiveStyleImports walks css @import chain', async () => {
  const project = await createProject('knighted-css-style-graph-css-')
  try {
    await project.writeFile(
      'styles/main.css',
      `@import './partials/reset.css';
@import url("./partials/theme.css");
@import 'https://example.com/skip.css';
@import 'data:text/css;base64,AAAA';
body { color: red; }
`,
    )
    await project.writeFile(
      'styles/partials/reset.css',
      `@import './deep/inner.css';
.reset { color: #111; }
`,
    )
    await project.writeFile('styles/partials/theme.css', '.theme { color: #222; }\n')
    await project.writeFile('styles/partials/deep/inner.css', '.inner { color: #333; }\n')

    const result = await collectTransitiveStyleImports(project.file('styles/main.css'), {
      cwd: project.root,
    })

    const expected = [
      project.file('styles/main.css'),
      project.file('styles/partials/reset.css'),
      project.file('styles/partials/theme.css'),
      project.file('styles/partials/deep/inner.css'),
    ]

    assert.deepEqual(await realpathAll(result), await realpathAll(expected))
  } finally {
    await project.cleanup()
  }
})

test('collectTransitiveStyleImports uses resolver and filter', async () => {
  const project = await createProject('knighted-css-style-graph-resolver-')
  try {
    await project.writeFile(
      'styles/entry.css',
      `@import '@alias/theme.css';
@import '@skip/skip.css';
`,
    )
    await project.writeFile('styles/theme.css', '.theme { color: #444; }\n')
    await project.writeFile('node_modules/skip/skip.css', '.skip { color: #555; }\n')

    const resolver: CssResolver = async specifier => {
      if (specifier === '@alias/theme.css') {
        return pathToFileUrl(project.file('styles/theme.css'))
      }
      if (specifier === '@skip/skip.css') {
        return project.file('node_modules/skip/skip.css')
      }
      return undefined
    }

    const result = await collectTransitiveStyleImports(project.file('styles/entry.css'), {
      cwd: project.root,
      resolver,
      filter: filePath => !filePath.includes('node_modules'),
    })

    const expected = [project.file('styles/entry.css'), project.file('styles/theme.css')]
    assert.deepEqual(await realpathAll(result), await realpathAll(expected))
  } finally {
    await project.cleanup()
  }
})

test('collectTransitiveStyleImports supports sass and pkg specifiers', async () => {
  const project = await createProject('knighted-css-style-graph-sass-')
  try {
    await project.writeFile(
      'styles/entry.scss',
      `@use 'fake';
@forward './partials/colors.scss';
@import './tokens.scss', './partials/mixins.scss';
@import 'http://example.com/skip.css';
`,
    )
    await project.writeFile('styles/partials/_colors.scss', '$brand: #111;\n')
    await project.writeFile('styles/partials/_mixins.scss', '@mixin button {}\n')
    await project.writeFile('styles/_tokens.scss', '$token: #222;\n')

    await project.writeFile(
      'node_modules/fake/package.json',
      JSON.stringify(
        {
          name: 'fake',
          version: '1.0.0',
          sass: 'index.scss',
          style: 'index.scss',
          main: 'index.scss',
        },
        null,
        2,
      ),
    )
    await project.writeFile('node_modules/fake/index.scss', '$fake: #333;\n')

    const result = await collectTransitiveStyleImports(
      project.file('styles/entry.scss'),
      {
        cwd: project.root,
        filter: () => true,
      },
    )

    const expected = [
      project.file('styles/entry.scss'),
      project.file('node_modules/fake/index.scss'),
      project.file('styles/partials/_colors.scss'),
      project.file('styles/_tokens.scss'),
      project.file('styles/partials/_mixins.scss'),
    ]

    assert.deepEqual(await realpathAll(result), await realpathAll(expected))
  } finally {
    await project.cleanup()
  }
})

test('collectTransitiveStyleImports supports less imports', async () => {
  const project = await createProject('knighted-css-style-graph-less-')
  try {
    await project.writeFile(
      'styles/entry.less',
      `@import (reference) './theme.less';
`,
    )
    await project.writeFile(
      'styles/theme.less',
      `@import './nested.less';
.theme { color: #666; }
`,
    )
    await project.writeFile('styles/nested.less', '.nested { color: #777; }\n')

    const result = await collectTransitiveStyleImports(
      project.file('styles/entry.less'),
      {
        cwd: project.root,
      },
    )

    const expected = [
      project.file('styles/entry.less'),
      project.file('styles/theme.less'),
      project.file('styles/nested.less'),
    ]

    assert.deepEqual(await realpathAll(result), await realpathAll(expected))
  } finally {
    await project.cleanup()
  }
})

function pathToFileUrl(filePath: string): string {
  return pathToFileURL(filePath).toString()
}
