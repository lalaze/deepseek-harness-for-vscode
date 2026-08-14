import { randomBytes } from 'node:crypto'
import * as vscode from 'vscode'
import type { ConfigurationService } from '../config/configuration.js'
import { AGENT_PRESET_OPTIONS, MODEL_OPTIONS, REASONING_OPTIONS } from '../domain/options.js'
import { promptConfiguration } from '../domain/prompt-configuration.js'
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
        const staged = promptConfiguration(value.configuration)
        if (value.configuration !== undefined && staged === undefined) {
          throw new Error(vscode.l10n.t('Invalid model or mode configuration.'))
        }
        if (staged !== undefined) await this.gateway.applyPromptConfiguration(staged)
        await this.gateway.prompt(
          text,
          value.mode === 'steer' ? 'steer' : 'queue',
          this.configuration.get().autoAttachSelection ? autoSelection(text) : undefined,
        )
        break
      }
      case 'cancel':
        await this.gateway.cancel()
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

  private html(webview: vscode.Webview): string {
    const nonce = randomBytes(18).toString('base64')
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'chat.js'))
    const style = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'chat.css'))
    const logo = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'deepseek-harness.png'))
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
      <div class="brand"><img class="brand-logo" src="${logo}" alt=""><strong>Harness</strong><span id="connection" class="connection"></span></div>
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
          <img class="empty-logo" src="${logo}" alt=""><h2>${text('emptyTitle')}</h2><p>${text('emptyDescription')}</p>
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
        <section id="configuration-panel" class="configuration-panel hidden" role="dialog" aria-label="${text('configurationTitle')}">
          <header class="configuration-panel-header">
            <strong>${text('configurationTitle')}</strong>
            <button id="configuration-close" class="icon-button compact" type="button" title="${text('configurationClose')}" aria-label="${text('configurationClose')}">×</button>
          </header>
          <div class="configuration-panel-scroll">
            <section class="configuration-group configuration-model-group" aria-labelledby="configuration-models-label">
              <h3 id="configuration-models-label">${text('configurationModels')}</h3>
              <div id="configuration-models" class="configuration-options" role="listbox"></div>
            </section>
            <section class="configuration-group" aria-labelledby="configuration-modes-label">
              <h3 id="configuration-modes-label">${text('configurationModes')}</h3>
              <div id="configuration-presets" class="configuration-options" role="listbox"></div>
            </section>
          </div>
          <footer id="effort-control" class="effort-control" data-effort="high">
            <div class="effort-main">
              <div class="effort-heading"><span>${text('configurationEffort')}</span><strong id="effort-value"></strong></div>
              <div class="effort-slider-row">
                <input id="effort-slider" type="range" min="0" max="2" step="1" value="1" aria-label="${text('configurationEffort')}">
                <div id="effort-ticks" class="effort-ticks"></div>
              </div>
            </div>
            <p id="configuration-hint">${text('configurationAppliesNextMessage')}</p>
          </footer>
        </section>
        <div id="command-menu" class="command-menu hidden" role="listbox" aria-label="${text('slashCommands')}"></div>
        <textarea id="prompt" rows="1" placeholder="${text('promptPlaceholder')}" aria-label="${text('message')}"></textarea>
        <div class="composer-bar">
          <div class="composer-tools">
            <button id="attach-selection" class="text-button" title="${text('attachSelection')}">⬒ ${text('selection')}</button>
            <button id="details-toggle" class="text-button" title="${text('contextDescription')}">${text('context')}</button>
            <select id="permission" class="permission-select hidden" title="${text('permissionDescription')}"></select>
          </div>
          <div class="composer-meta">
            <span id="composer-status" class="composer-status"></span>
            <span id="context-meter" class="context-meter hidden" role="img">
              <span class="context-meter-ring" aria-hidden="true"></span>
              <span id="context-meter-value" class="context-meter-value"></span>
            </span>
          </div>
          <div class="composer-actions">
            <button id="configuration-toggle" class="configuration-toggle" type="button" title="${text('configurationOpen')}" aria-label="${text('configurationOpen')}" aria-expanded="false" aria-controls="configuration-panel" disabled>
              <span class="configuration-toggle-icon">◈</span>
              <span class="configuration-toggle-copy">
                <strong id="configuration-toggle-model">${text('model')}</strong>
                <small id="configuration-toggle-mode">${text('agent')}</small>
              </span>
              <span class="configuration-toggle-chevron">⌃</span>
            </button>
            <button id="send" class="send-button" title="${text('sendTitle')}" aria-label="${text('send')}">↑</button>
          </div>
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
