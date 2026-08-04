import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

const npmCli = process.env.npm_execpath
assert(npmCli, 'npm_execpath is required to inspect the npm package')

const output = execFileSync(process.execPath, [npmCli, 'pack', '--dry-run', '--json'], {
  encoding: 'utf8',
})

const reports = JSON.parse(output)
const files = new Set(reports[0]?.files?.map((file) => file.path) ?? [])

const requiredFiles = [
  'bin/nekostream.js',
  'dist/index.js',
  'player-main.js',
  'player.html',
  'webview-preload.js',
  'isolate.js',
  'isolate.css',
]

for (const file of requiredFiles) {
  assert(files.has(file), `Missing runtime file in npm package: ${file}`)
}

const staleServerFiles = [...files].filter((file) => file.startsWith('dist/server/'))
assert.deepEqual(
  staleServerFiles,
  [],
  `Stale server artifacts found: ${staleServerFiles.join(', ')}`
)

console.log(`package-check: ok (${files.size} files)`)
