import * as vscode from 'vscode'
import { ConfigurationService } from './config/configuration.js'
import { HarnessGatewayService } from './gateway/harness-gateway-service.js'
import { BundledRuntimeResolver } from './runtime/bundled-runtime.js'
import { HarnessHostRuntime } from './runtime/web-runtime.js'
import { CredentialStore } from './security/credential-store.js'
import { WorkbenchViewProvider } from './ui/workbench-view-provider.js'

let activeRuntime: HarnessHostRuntime | undefined

/** Activates one self-contained Harness workbench; no external deployment is required. */
export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('DeepSeek Harness', { log: true })
  const configuration = new ConfigurationService()
  const credentials = new CredentialStore(context.secrets)
  const resolver = new BundledRuntimeResolver(context)
  const runtime = new HarnessHostRuntime(context, configuration, credentials, resolver, output)
  const gateway = new HarnessGatewayService(runtime, configuration, credentials, output)
  activeRuntime = runtime

  const setApiKey = async (): Promise<void> => {
    const value = await vscode.window.showInputBox({
      title: '配置 DeepSeek API Key',
      prompt: '密钥将写入本机 VS Code 用户 settings.json 的 deepseekHarness.apiKey。',
      password: true,
      ignoreFocusOut: true,
      validateInput: (input) => input.trim() === '' ? 'API Key 不能为空。' : undefined,
    })
    if (value === undefined) return
    await credentials.setApiKey(value.trim())
    await provider.refresh()
    void vscode.window.showInformationMessage('DeepSeek API Key 已写入本机 VS Code settings.json。')
  }

  const provider = new WorkbenchViewProvider(
    context.extensionUri,
    configuration,
    gateway,
    {
      setApiKey,
      openSettings: async () => {
        await vscode.commands.executeCommand('workbench.action.openSettings', 'deepseekHarness')
      },
      showLogs: () => output.show(true),
    },
  )

  context.subscriptions.push(
    output,
    configuration,
    runtime,
    gateway,
    provider,
    vscode.window.registerWebviewViewProvider(WorkbenchViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('deepseekHarness.openChat', focusWorkbench),
    vscode.commands.registerCommand('deepseekHarness.reloadRuntime', () => provider.refresh()),
    vscode.commands.registerCommand('deepseekHarness.setApiKey', setApiKey),
    vscode.commands.registerCommand('deepseekHarness.clearApiKey', async () => {
      const answer = await vscode.window.showWarningMessage(
        '确定要从本机 VS Code settings.json 清除 DeepSeek API Key 吗？',
        { modal: true },
        '清除',
      )
      if (answer !== '清除') return
      await credentials.clearApiKey()
      await provider.refresh()
    }),
    vscode.commands.registerCommand('deepseekHarness.showLogs', () => output.show(true)),
  )
}

export async function deactivate(): Promise<void> {
  await activeRuntime?.stop()
  activeRuntime = undefined
}

async function focusWorkbench(): Promise<void> {
  await vscode.commands.executeCommand(`${WorkbenchViewProvider.viewType}.focus`)
}
