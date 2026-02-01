/*
  This symlink exists only for Playwright. The test server serves the
  packages/playwright folder as its web root, but the browser entrypoint
  for @knighted/css is built into packages/css/dist. The importmap in
  browser-entrypoint.html needs a URL the server can see, so we expose
  packages/css/dist at /dist-css without copying or bundling.
*/
import { lstat, symlink, unlink } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const targetPath = path.resolve(__dirname, '../../css/dist')
const linkPath = path.resolve(__dirname, '../dist-css')

try {
  const stat = await lstat(linkPath)
  if (stat.isSymbolicLink() || stat.isDirectory()) {
    await unlink(linkPath)
  }
} catch (error) {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = error.code
    if (code !== 'ENOENT') {
      throw error
    }
  }
}

await symlink(targetPath, linkPath, 'junction')
