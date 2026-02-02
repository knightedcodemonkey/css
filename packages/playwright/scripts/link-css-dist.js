/*
  This symlink exists only for Playwright. The test server serves the
  packages/playwright folder as its web root, but the browser entrypoint
  for @knighted/css is built into packages/css/dist. The importmap in
  browser-entrypoint.html needs a URL the server can see, so we expose
  packages/css/dist at /dist-css without copying or bundling.
*/
import { rm, symlink } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const targetPath = path.resolve(__dirname, '../../css/dist')
const linkPath = path.resolve(__dirname, '../dist-css')

await rm(linkPath, { recursive: true, force: true })

await symlink(targetPath, linkPath, 'junction')
