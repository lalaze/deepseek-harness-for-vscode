import { randomBytes } from 'node:crypto'
import * as vscode from 'vscode'
import type { ConfigurationService } from '../config/configuration.js'
import { AGENT_PRESET_OPTIONS, MODEL_OPTIONS, REASONING_OPTIONS } from '../domain/options.js'
import { selectionMarkerPrefix, type HarnessGatewayService, type PromptSelection } from '../gateway/harness-gateway-service.js'
import { localizeWebviewMessages, type WebviewMessageKey } from '../webview/localization.js'

export interface WorkbenchViewActions {
  readonly setApiKey: () => Promise<void>
  readonly openSettings: () => Promise<void>
  readonly showLogs: () => void
}

/** Native Codex/Cline-style workbench. No Harness page or iframe is embedded. */
export class WorkbenchViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewType = 'deepseekHarness.chatView'

  private view: vscode.WebviewView | undefined
  private readonly subscriptions: vscode.Disposable[]
  private publishing: Promise<void> | undefined
  private publishPending = false

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly configuration: ConfigurationService,
    private readonly gateway: HarnessGatewayService,
    private readonly actions: WorkbenchViewActions,
  ) {
    this.subscriptions = [gateway.onDidChange(() => {
      void this.publishState().catch(() => undefined)
    })]
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'media'),
        vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview'),
      ],
    }
    view.webview.html = this.html(view.webview)
    this.subscriptions.push(view.webview.onDidReceiveMessage((message: unknown) => {
      void this.handleMessage(message).catch((cause: unknown) => {
        const detail = cause instanceof Error ? cause.message : String(cause)
        void vscode.window.showErrorMessage(vscode.l10n.t('DeepSeek Harness: {0}', detail))
      })
    }))
    void this.gateway.start()
  }

  async refresh(): Promise<void> {
    await this.gateway.restart()
  }

  dispose(): void {
    for (const subscription of this.subscriptions) subscription.dispose()
  }

  private publishState(): Promise<void> {
    // Gateway frames can arrive every few milliseconds. Serialize snapshots
    // so an older async credentials read can never overtake a newer state and
    // make streamed text visibly jump backwards/forwards.
    this.publishPending = true
    if (this.publishing !== undefined) return this.publishing
    const task = this.drainPublishQueue()
    this.publishing = task.finally(() => {
      this.publishing = undefined
      if (this.publishPending) void this.publishState().catch(() => undefined)
    })
    return this.publishing
  }

  private async drainPublishQueue(): Promise<void> {
    while (this.publishPending) {
      this.publishPending = false
      const state = await this.gateway.snapshot()
      await this.view?.webview.postMessage({
        type: 'state',
        state,
        configuration: this.configuration.get(),
        fallbackOptions: {
          models: MODEL_OPTIONS.map(localizedOption),
          reasoning: REASONING_OPTIONS.map(localizedOption),
          presets: AGENT_PRESET_OPTIONS.map(localizedOption),
        },
      })
    }
  }

  private async handleMessage(value: unknown): Promise<void> {
    if (!isRecord(value) || typeof value.type !== 'string') return
    switch (value.type) {
      case 'ready':
        await this.publishState()
        break
      case 'retry':
        await this.refresh()
        break
      case 'setApiKey':
        await this.actions.setApiKey()
        break
      case 'openSettings':
        await this.actions.openSettings()
        break
      case 'showLogs':
        this.actions.showLogs()
        break
      case 'newSession':
        await this.gateway.createSession()
        break
      case 'searchSessions': {
        const query = typeof value.query === 'string' ? value.query : ''
        const results = await this.gateway.searchSessions(query)
        await this.view?.webview.postMessage({ type: 'searchResults', query, results })
        break
      }
      case 'selectSession':
        await this.gateway.openSession(requiredString(value, 'sessionId'))
        break
      case 'selectSubagent': {
        const mode = value.mode === 'continuable' ? 'continuable' : 'one-shot'
        await this.gateway.selectSubagent(requiredString(value, 'sessionId'), mode)
        break
      }
      case 'selectParent':
        await this.gateway.selectParentSession()
        break
      case 'loadOlder':
        await this.gateway.loadOlder()
        break
      case 'sendPrompt': {
        const text = typeof value.text === 'string' ? value.text : ''
        await this.gateway.prompt(
          text,
          value.mode === 'steer' ? 'steer' : 'queue',
          promptImages(value.images),
          this.configuration.get().autoAttachSelection ? autoSelection(text) : undefined,
        )
        break
      }
      case 'cancel':
        await this.gateway.cancel()
        break
      case 'setModel':
        await this.gateway.selectModel(
          requiredString(value, 'provider'),
          requiredString(value, 'model'),
          optionalString(value.reasoningEffort),
        )
        break
      case 'setReasoning':
        await this.gateway.selectReasoning(requiredString(value, 'value'))
        break
      case 'setPreset':
        await this.gateway.selectPreset(requiredString(value, 'value'))
        break
      case 'setPermission':
        await this.gateway.selectPermission(requiredString(value, 'value'))
        break
      case 'openExternal': {
        // Only http(s) links from rendered markdown are opened, never local
        // paths or custom schemes.
        const raw = typeof value.url === 'string' ? value.url : ''
        const uri = safeExternalUri(raw)
        if (uri !== undefined) void vscode.env.openExternal(uri)
        break
      }
      case 'attachSelection': {
        // Reads the active editor selection so the webview can attach it to
        // the prompt as explicit context.
        await this.view?.webview.postMessage({ type: 'selectionAttached', ...activeEditorSelection() })
        break
      }
      case 'loadCommands':
        await this.gateway.refreshCommands()
        break
      case 'runCommand':
        await this.runCommand(requiredString(value, 'name'))
        break
      case 'setPlan':
        await this.gateway.setPlanMode(value.active === true)
        break
      case 'createGoal': {
        const objective = await vscode.window.showInputBox({
          title: vscode.l10n.t('Create Harness Goal'),
          prompt: vscode.l10n.t('Harness will pursue this goal until it is completed, paused, or reaches its round limit.'),
          validateInput: (input) => input.trim() === '' ? vscode.l10n.t('The goal cannot be empty.') : undefined,
        })
        if (objective !== undefined) await this.gateway.createGoal(objective.trim())
        break
      }
      case 'mutateGoal': {
        const action = goalAction(value.action)
        await this.gateway.mutateGoal(action)
        break
      }
      case 'rename': {
        const current = await this.gateway.snapshot()
        const title = await vscode.window.showInputBox({
          title: vscode.l10n.t('Rename Harness session'),
          value: current.active?.title ?? '',
          validateInput: (input) => input.trim() === '' ? vscode.l10n.t('The title cannot be empty.') : undefined,
        })
        if (title !== undefined) await this.gateway.rename(title)
        break
      }
      case 'fork':
        await this.gateway.fork(numberValue(value.atSeq))
        break
      case 'answerApproval': {
        const outcome = value.outcome === 'allowed-once' ? 'allowed-once' : 'rejected'
        await this.gateway.answerApproval(requiredString(value, 'key'), outcome)
        break
      }
      case 'answerQuestions':
        await this.gateway.answerQuestions(requiredString(value, 'key'), questionAnswers(value.answers))
        break
    }
  }

  private async runCommand(name: string): Promise<void> {
    if (name === 'model') await this.pickModel()
    else if (name === 'reasoning') await this.pickReasoning()
    else if (name === 'preset') await this.pickPreset()
  }

  private async pickModel(): Promise<void> {
    const current = await this.gateway.snapshot()
    const models = current.active?.models ?? []
    const items: ModelPickItem[] = models.map((model) => ({
      label: model.name,
      description: model.provider,
      ...(model.description === undefined ? {} : { detail: model.description }),
      picked: model.id === current.active?.model?.model && model.provider === current.active?.model?.provider,
      provider: model.provider,
      id: model.id,
    }))
    const selected = await vscode.window.showQuickPick(items, {
      title: vscode.l10n.t('Switch model'),
      placeHolder: vscode.l10n.t('Select the model for the current session'),
    })
    if (selected !== undefined) {
      const reasoning = current.active?.model?.reasoningEffort
      await this.gateway.selectModel(selected.provider, selected.id, reasoning)
    }
  }

  private async pickReasoning(): Promise<void> {
    const items: ValuePickItem[] = REASONING_OPTIONS.map((item) => ({
      label: vscode.l10n.t(item.label),
      ...(item.description === undefined ? {} : { detail: vscode.l10n.t(item.description) }),
      value: item.id,
    }))
    const selected = await vscode.window.showQuickPick(items, {
      title: vscode.l10n.t('Switch reasoning effort'),
      placeHolder: vscode.l10n.t('Select the reasoning effort for the current session'),
    })
    if (selected !== undefined) await this.gateway.selectReasoning(selected.value)
  }

  private async pickPreset(): Promise<void> {
    const current = await this.gateway.snapshot()
    const items: ValuePickItem[] = current.presets.length > 0
      ? current.presets.filter((item) => !item.broken).map((item) => ({
        label: item.name || item.id,
        ...(item.description === undefined ? {} : { detail: item.description }),
        value: item.id,
      }))
      : AGENT_PRESET_OPTIONS.map((item) => ({
        label: vscode.l10n.t(item.label),
        ...(item.description === undefined ? {} : { detail: vscode.l10n.t(item.description) }),
        value: item.id,
      }))
    const selected = await vscode.window.showQuickPick(items, {
      title: vscode.l10n.t('Switch Agent Preset'),
      placeHolder: vscode.l10n.t('Select the Agent Preset for the current session'),
    })
    if (selected !== undefined) await this.gateway.selectPreset(selected.value)
  }

  private html(webview: vscode.Webview): string {
    const nonce = randomBytes(18).toString('base64')
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'chat.js'))
    const style = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'chat.css'))
    const messages = localizeWebviewMessages((message) => vscode.l10n.t(message))
    const text = (key: WebviewMessageKey): string => escapeHtml(messages[key])
    const language = escapeHtml(vscode.env.language)
    const localization = jsonForInlineScript({ language: vscode.env.language, messages })
    return `<!doctype html>
<html lang="${language}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${style}">
  <title>DeepSeek Harness</title>
</head>
<body>
  <header class="shell-header">
    <div class="brand-row">
      <button id="history-toggle" class="icon-button" title="${text('history')}" aria-label="${text('history')}">☰</button>
      <div class="brand"><span class="brand-mark">DS</span><strong>Harness</strong><span id="connection" class="connection"></span></div>
      <div class="header-actions">
        <button id="new-session" class="icon-button" title="${text('newConversation')}" aria-label="${text('newConversation')}">＋</button>
        <button id="open-settings" class="icon-button" title="${text('extensionSettings')}" aria-label="${text('extensionSettings')}">⚙</button>
      </div>
    </div>
    <div class="session-heading">
      <button id="back-parent" class="icon-button compact hidden" title="${text('backToParentAgent')}" aria-label="${text('backToParentAgent')}">←</button>
      <button id="session-title" class="title-button" title="${text('renameConversation')}">${text('newConversation')}</button>
      <button id="fork" class="icon-button compact" title="${text('forkConversation')}" aria-label="${text('forkConversation')}">⑂</button>
    </div>
    <div class="selectors" aria-label="${text('sessionSettings')}">
      <label><span>${text('model')}</span><select id="model"></select></label>
      <label><span>${text('reasoning')}</span><select id="reasoning"></select></label>
      <label><span>${text('agent')}</span><select id="preset"></select></label>
    </div>
  </header>

  <section id="key-banner" class="key-banner hidden">
    <span>${text('apiKeyRequired')}</span>
    <button id="set-api-key">${text('configure')}</button>
  </section>

  <aside id="history-panel" class="history-panel hidden" aria-label="${text('history')}">
    <div class="panel-heading"><strong>${text('history')}</strong><button id="history-close" class="icon-button">×</button></div>
    <input id="history-search" class="search-input" type="search" placeholder="${text('searchConversations')}">
    <div id="session-list" class="session-list"></div>
  </aside>

  <main id="workbench" class="workbench">
    <section id="loading" class="center-state">
      <div class="spinner"></div><h2>${text('startingHarness')}</h2><p>${text('startingHarnessDescription')}</p>
    </section>
    <section id="error" class="center-state hidden">
      <div class="error-icon">!</div><h2>${text('connectionFailed')}</h2><p id="error-message"></p>
      <div class="state-actions"><button id="retry" class="primary-button">${text('retry')}</button><button id="show-logs" class="secondary-button">${text('logs')}</button></div>
    </section>
    <section id="chat" class="chat hidden">
      <div id="conversation" class="conversation">
        <button id="load-older" class="load-older hidden">${text('loadOlder')}</button>
        <section id="empty" class="empty-state">
          <div class="empty-mark">DS</div><h2>${text('emptyTitle')}</h2><p>${text('emptyDescription')}</p>
        </section>
        <div id="messages" class="messages" aria-live="polite"></div>
      </div>

      <section id="details" class="details hidden">
        <div class="detail-tabs">
          <button data-detail="todos" class="active">${text('plan')} <span id="todo-count">0</span></button>
          <button data-detail="goal">Goal</button>
          <button data-detail="skills">${text('skills')} <span id="skill-count">0</span></button>
          <button data-detail="agents">${text('agents')} <span id="agent-count">0</span></button>
          <button data-detail="jobs">${text('jobs')} <span id="job-count">0</span></button>
        </div>
        <div id="detail-content" class="detail-content"></div>
      </section>

      <div id="interactions" class="interactions"></div>
      <section class="composer-shell">
        <div id="command-menu" class="command-menu hidden" role="listbox" aria-label="${text('slashCommands')}"></div>
        <div id="attachment-rail" class="attachment-rail hidden"></div>
        <textarea id="prompt" rows="1" placeholder="${text('promptPlaceholder')}" aria-label="${text('message')}"></textarea>
        <div class="composer-bar">
          <button id="attach" class="text-button" title="${text('addImage')}">＋ ${text('image')}</button>
          <input id="image-input" class="hidden" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple>
          <button id="attach-selection" class="text-button" title="${text('attachSelection')}">⬒ ${text('selection')}</button>
          <button id="details-toggle" class="text-button" title="${text('contextDescription')}">${text('context')}</button>
          <select id="permission" class="permission-select hidden" title="${text('permissionDescription')}"></select>
          <span id="composer-status" class="composer-status"></span>
          <button id="send" class="send-button" title="${text('sendTitle')}" aria-label="${text('send')}">↑</button>
        </div>
      </section>
      <p class="composer-hint">${text('composerHint')}</p>
    </section>
  </main>
  <script nonce="${nonce}">globalThis.__DEEPSEEK_HARNESS_LOCALIZATION__=${localization};</script>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`
  }
}

function requiredString(value: Record<string, unknown>, key: string): string {
  const item = value[key]
  if (typeof item !== 'string' || item.trim() === '') throw new Error(vscode.l10n.t('Invalid {0}.', key))
  return item
}

interface ModelPickItem extends vscode.QuickPickItem {
  readonly provider: string
  readonly id: string
}

interface ValuePickItem extends vscode.QuickPickItem {
  readonly value: string
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined
}

function questionAnswers(value: unknown): { readonly id: string; readonly selected: readonly string[]; readonly custom?: string }[] {
  if (!Array.isArray(value)) throw new Error(vscode.l10n.t('Invalid question answer format.'))
  return value.map((item) => {
    if (!isRecord(item) || typeof item.id !== 'string' || !Array.isArray(item.selected)) {
      throw new Error(vscode.l10n.t('Invalid question answer format.'))
    }
    const selected = item.selected.filter((choice): choice is string => typeof choice === 'string')
    const custom = optionalString(item.custom)
    return { id: item.id, selected, ...(custom === undefined ? {} : { custom }) }
  })
}

function promptImages(value: unknown): { readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; readonly data: string; readonly name?: string }[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 8) throw new Error(vscode.l10n.t('Invalid image attachment format.'))
  return value.map((item) => {
    if (!isRecord(item) || !isImageType(item.mediaType) || typeof item.data !== 'string') {
      throw new Error(vscode.l10n.t('Invalid image attachment format.'))
    }
    if (item.data.length > 16_000_000) throw new Error(vscode.l10n.t('Each image must be approximately 12 MB or smaller.'))
    const name = optionalString(item.name)
    return { mediaType: item.mediaType, data: item.data, ...(name === undefined ? {} : { name }) }
  })
}

function isImageType(value: unknown): value is 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' {
  return value === 'image/png' || value === 'image/jpeg' || value === 'image/webp' || value === 'image/gif'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

const MAX_SELECTION_CHARS = 16_000

/** Only ever hands out http(s) URLs to the external browser. */
function safeExternalUri(raw: string): vscode.Uri | undefined {
  try {
    const uri = vscode.Uri.parse(raw)
    if (uri.scheme === 'http' || uri.scheme === 'https') return uri
  } catch {
    // Malformed URL: ignore.
  }
  return undefined
}

/** Snapshot of the active editor selection, truncated for prompt embedding. */
function activeEditorSelection(): {
  readonly file?: string
  readonly text?: string
  readonly startLine?: number
  readonly endLine?: number
  readonly tooLong?: boolean
} {
  const editor = vscode.window.activeTextEditor
  if (editor === undefined || editor.selection.isEmpty) return {}
  const { document, selection } = editor
  const text = document.getText(selection)
  const startLine = selection.start.line + 1
  const endLine = selection.end.line + 1
  if (text.length > MAX_SELECTION_CHARS) {
    return { file: document.uri.fsPath, text: text.slice(0, MAX_SELECTION_CHARS), startLine, endLine, tooLong: true }
  }
  return { file: document.uri.fsPath, text, startLine, endLine }
}

/**
 * Auto-attached selection context for the message being sent. Skips when the
 * setting is off, when the editor has no selection, or when the user already
 * embedded that selection manually (via the selection button), which would
 * otherwise duplicate the code in the prompt.
 */
function autoSelection(text: string): PromptSelection | undefined {
  const selection = activeEditorSelection()
  if (selection.text === undefined) return undefined
  if (hasEmbeddedSelection(text, selection.file)) return undefined
  return {
    text: selection.text,
    ...(selection.file === undefined ? {} : { file: selection.file }),
    ...(selection.startLine === undefined ? {} : { startLine: selection.startLine }),
    ...(selection.endLine === undefined ? {} : { endLine: selection.endLine }),
    ...(selection.tooLong === true ? { tooLong: true } : {}),
  }
}

function hasEmbeddedSelection(text: string, file: string | undefined): boolean {
  if (file === undefined) return false
  const name = file.split(/[\\/]/u).pop() ?? ''
  if (name === '') return false
  return text.includes(`${selectionMarkerPrefix()}${name}`)
}

function goalAction(value: unknown): 'pause' | 'resume' | 'complete' | 'clear' {
  if (value === 'pause' || value === 'resume' || value === 'complete' || value === 'clear') return value
  throw new Error(vscode.l10n.t('Invalid Goal action.'))
}

function localizedOption(option: { readonly id: string; readonly label: string; readonly description?: string }): {
  readonly id: string
  readonly label: string
  readonly description?: string
} {
  return {
    id: option.id,
    label: vscode.l10n.t(option.label),
    ...(option.description === undefined ? {} : { description: vscode.l10n.t(option.description) }),
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function jsonForInlineScript(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')
}
