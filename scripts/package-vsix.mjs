import { spawnSync } from 'node:child_process'
import * as path from 'node:path'

const targets = {
  'darwin-arm64': 'darwin-arm64',
  'darwin-x64': 'darwin-x64',
  'linux-arm64': 'linux-arm64',
  'linux-x64': 'linux-x64',
  'win32-arm64': 'win32-arm64',
  'win32-x64': 'win32-x64',
}

const key = `${process.platform}-${process.arch}`
const target = targets[key]
if (target === undefined) throw new Error(`暂不支持为 ${key} 打包平台 VSIX。`)

const executable = path.join(
  process.cwd(),
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'vsce.cmd' : 'vsce',
)
const result = spawnSync(executable, ['package', '--target', target, '--allow-missing-repository'], {
  stdio: 'inherit',
})
if (result.error !== undefined) throw result.error
process.exitCode = result.status ?? 1
