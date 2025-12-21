import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageRoot = path.resolve(__dirname, '..')
const sourceDir = path.join(packageRoot, 'src', 'types-stub')
const targetDir = path.join(packageRoot, 'types-stub')

async function copyTypesStub() {
  try {
    await fs.rm(targetDir, { recursive: true, force: true })
    await fs.cp(sourceDir, targetDir, { recursive: true })
  } catch (error) {
    console.error('[knighted-css] Failed to copy types stub from src/types-stub.')
    throw error
  }
}

copyTypesStub().catch(error => {
  console.error(error)
  process.exitCode = 1
})
