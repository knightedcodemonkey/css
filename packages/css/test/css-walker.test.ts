import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { cssWithMeta } from '../src/css.ts'
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

test('css walker dedupes style modules and preserves discovery order', async () => {
  const project = await createProject('knighted-css-walker-order-')
  try {
    await project.writeFile('styles/reset.css', '/* reset */\n.reset { color: #111; }')
    await project.writeFile('styles/shared.css', '/* shared */\n.shared { color: #222; }')
    await project.writeFile(
      'components/widget.css',
      '/* widget */\n.widget { color: #333; }',
    )
    await project.writeFile('styles/async.css', '/* async */\n.async { color: #444; }')
    await project.writeFile(
      'styles/nested/deep.css',
      '/* deep */\n.deep { color: #555; }',
    )

    const entrySource = `import './styles/reset.css'
  import './shared.ts'
  await import('./async-entry.ts')
`
    await project.writeFile('entry.ts', entrySource)

    const sharedSource = `import './styles/shared.css'
  import './components/widget.ts'
  import './styles/reset.css'
`
    await project.writeFile('shared.ts', sharedSource)

    const widgetSource = "import './widget.css'\n"
    await project.writeFile('components/widget.ts', widgetSource)

    const asyncEntrySource = `import './styles/async.css'
export async function load() {
  await import('./nested/deep.ts')
}
`
    await project.writeFile('async-entry.ts', asyncEntrySource)

    await project.writeFile('nested/deep.ts', "import '../styles/nested/deep.css'\n")

    const { css, files } = await cssWithMeta(project.file('entry.ts'))

    const expectedOrder = [
      project.file('styles/reset.css'),
      project.file('styles/shared.css'),
      project.file('components/widget.css'),
      project.file('styles/async.css'),
      project.file('styles/nested/deep.css'),
    ]

    assert.deepEqual(await realpathAll(files), await realpathAll(expectedOrder))

    const markers = [
      '/* reset */',
      '/* shared */',
      '/* widget */',
      '/* async */',
      '/* deep */',
    ]
    for (const marker of markers) {
      const occurrences = css.split(marker).length - 1
      assert.equal(occurrences, 1, `expected ${marker} to appear exactly once`)
    }
    for (let i = 1; i < markers.length; i += 1) {
      const prevIndex = css.indexOf(markers[i - 1])
      const nextIndex = css.indexOf(markers[i])
      assert.ok(
        prevIndex >= 0 && nextIndex > prevIndex,
        `${markers[i - 1]} should precede ${markers[i]}`,
      )
    }
  } finally {
    await project.cleanup()
  }
})

test('css walker honors custom resolver mappings for nonstandard specifiers', async () => {
  const project = await createProject('knighted-css-walker-resolver-')
  try {
    await project.writeFile('styles/global.css', '/* global */\n.global { color: #666; }')
    await project.writeFile('styles/button.css', '/* button */\n.button { color: #777; }')

    const entrySource = `import '@pkg/global.css'
import './view.ts'
`
    await project.writeFile('entry.ts', entrySource)

    const viewSource = "import '@shared/button.css'\n"
    await project.writeFile('view.ts', viewSource)

    const resolver: CssResolver = async specifier => {
      if (specifier.startsWith('@pkg/')) {
        const relative = specifier.replace(/^@pkg\//, 'styles/')
        return project.file(relative)
      }
      if (specifier === '@shared/button.css') {
        return project.file('styles/button.css')
      }
      return undefined
    }

    const { css, files } = await cssWithMeta(project.file('entry.ts'), {
      resolver,
    })

    const expected = [
      project.file('styles/global.css'),
      project.file('styles/button.css'),
    ]

    assert.deepEqual(await realpathAll(files), await realpathAll(expected))
    assert.ok(css.includes('/* global */'))
    assert.ok(css.includes('/* button */'))
  } finally {
    await project.cleanup()
  }
})
