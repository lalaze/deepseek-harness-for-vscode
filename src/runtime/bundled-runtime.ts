import { constants as fsConstants } from 'node:fs'
import { access } from 'node:fs/promises'
import * as path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type * as vscode from 'vscode'

const execFileAsync = promisify(execFile)

/** Executable information for the Harness runtime shipped inside the VSIX. */
export interface BundledRuntimeLaunch {
  readonly command: string
  readonly args: readonly string[]
  readonly environment: NodeJS.ProcessEnv
}

/**
 * Resolves the official `dsh` package bundled with this extension.
 *
 * A standalone Node executable is packaged in the platform VSIX. We do not use
 * VS Code's Electron executable because Harness loads native sandbox and PTY
 * modules whose ABI/signing contract is that of ordinary Node, not Electron.
 */
export class BundledRuntimeResolver {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolve(): Promise<BundledRuntimeLaunch> {
    const entry = this.context.asAbsolutePath('node_modules/@deepseek-ai/dsh/lib/bin.js')
    const node = this.context.asAbsolutePath(path.join(
      'node_modules',
      'node',
      'bin',
      process.platform === 'win32' ? 'node.exe' : 'node',
    ))
    try {
      await Promise.all([
        access(entry, fsConstants.R_OK),
        access(node, process.platform === 'win32' ? fsConstants.R_OK : fsConstants.R_OK | fsConstants.X_OK),
      ])
    } catch {
      throw new Error('扩展内置的 DeepSeek Harness 运行时不完整，请重新安装 VSIX。')
    }

    let versionText = ''
    try {
      const result = await execFileAsync(node, ['--version'], { encoding: 'utf8' })
      versionText = result.stdout.trim()
    } catch {
      throw new Error('扩展内置 Node 无法在当前平台执行，请安装匹配系统与架构的 VSIX。')
    }
    const version = parseNodeVersion(versionText)
    if (version === undefined || !supportsHarnessNode(version)) {
      throw new Error(`扩展内置 Node 版本不受 Harness 支持：${versionText || '未知'}。`)
    }

    return {
      command: node,
      args: [entry],
      environment: { ...process.env },
    }
  }
}

export function parseNodeVersion(value: string): { major: number; minor: number; patch: number } | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/u.exec(value.trim())
  if (match === null) return undefined
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
}

export function supportsHarnessNode(version: { major: number; minor: number }): boolean {
  return version.major >= 24 || (version.major === 22 && version.minor >= 19)
}
