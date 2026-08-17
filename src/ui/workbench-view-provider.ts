import { randomBytes } from 'node:crypto'
import * as vscode from 'vscode'
import type { ConfigurationService } from '../config/configuration.js'
import type { ConnectionSettingsInput, ConnectionTestResult } from '../domain/connection-settings.js'
import { AGENT_PRESET_OPTIONS, MODEL_OPTIONS, REASONING_OPTIONS } from '../domain/options.js'
import { promptConfiguration } from '../domain/prompt-configuration.js'
import type { EditorSelectionService } from '../editor/editor-selection-service.js'
import type { OpenWorkspaceFileRequest } from '../editor/types.js'
import type { WorkspaceFileService } from '../editor/workspace-file-service.js'
import type { HarnessGatewayService } from '../gateway/harness-gateway-service.js'
import type { DshPluginCenterController } from '../plugins/plugin-center-controller.js'
import type { ConnectionSettingsService } from '../services/connection-settings-service.js'
import type { PromptAttachment, PromptImageMediaType } from '../domain/prompt-context.js'
import { localizeWebviewMessages, type WebviewMessageKey } from '../webview/localization.js'

export interface WorkbenchViewActions {
  readonly setApiKey: () => Promise<void>
  readonly applySettings: (input: ConnectionSettingsInput) => Promise<void>
  readonly removeProvider: (provider: string) => Promise<void>
  readonly testConnection: (input: ConnectionSettingsInput) => Promise<ConnectionTestResult>
  readonly openSettings: () => Promise<void>
  readonly showLogs: () => void
}

/** Native Codex/Cline-style workbench. No Harness page or iframe is embedded. */
export class WorkbenchViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewType = 'deepseekHarness.chatView'
  static readonly panelViewType = 'deepseekHarness.chatPanel'

  private view: vscode.WebviewView | undefined
  private panel: vscode.WebviewPanel | undefined
  private readonly subscriptions: vscode.Disposable[]
  private publishing: Promise<void> | undefined
  private publishPending = false

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly configuration: ConfigurationService,
    private readonly gateway: HarnessGatewayService,
    private readonly connectionSettings: ConnectionSettingsService,
    private readonly pluginCenter: DshPluginCenterController,
    private readonly editorSelection: EditorSelectionService,
    private readonly workspaceFiles: WorkspaceFileService,
    private readonly actions: WorkbenchViewActions,
  ) {
    this.subscriptions = [gateway.onDidChange(() => {
      void this.publishState().catch(() => undefined)
    }), connectionSettings.onDidChange(() => {
      void this.publishState().catch(() => undefined)
    }), pluginCenter.onDidChange((snapshot) => {
      void this.postToHosts({ type: 'pluginState', snapshot })
    }), editorSelection.onDidChange((selection) => {
      void this.postToHosts({ type: 'editorSelection', selection })
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
    this.panel?.dispose()
  }

  /** Opens the workbench in a detachable editor-area panel, like Claude Code. */
  openPanel(): void {
    if (this.panel !== undefined) {
      this.panel.reveal()
      return
    }
    const panel = vscode.window.createWebviewPanel(
      WorkbenchViewProvider.panelViewType,
      vscode.l10n.t('DeepSeek Harness'),
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, 'media'),
          vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview'),
        ],
      },
    )
    panel.webview.html = this.html(panel.webview)
    panel.webview.onDidReceiveMessage((message: unknown) => {
      void this.handleMessage(message).catch((cause: unknown) => {
        const detail = cause instanceof Error ? cause.message : String(cause)
        void vscode.window.showErrorMessage(vscode.l10n.t('DeepSeek Harness: {0}', detail))
      })
    })
    panel.onDidDispose(() => {
      if (this.panel === panel) this.panel = undefined
    })
    this.panel = panel
    void this.gateway.start()
    void this.publishState().catch(() => undefined)
    void this.publishEditorSelection()
  }

  private postToHosts(message: unknown): void {
    void this.view?.webview.postMessage(message)
    void this.panel?.webview.postMessage(message)
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
      const connectionSettings = this.connectionSettings.state
      await this.postToHosts({
        type: 'state',
        state,
        configuration: this.configuration.get(),
        connectionSettings,
        fallbackOptions: {
          sources: connectionSettings.providers.map((provider) => ({ id: provider.id, label: provider.name })),
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
        await this.publishEditorSelection()
        break
      case 'retry':
        await this.refresh()
        break
      case 'setApiKey':
        await this.actions.setApiKey()
        break
      case 'applySettings': {
        await this.actions.applySettings(settingsInput(value))
        break
      }
      case 'removeProvider': {
        await this.actions.removeProvider(requiredString(value, 'provider'))
        break
      }
      case 'testConnection': {
        const result = await this.actions.testConnection(settingsInput(value))
        await this.postToHosts({ type: 'connectionTestResult', ...result })
        break
      }
      case 'openSettings':
        await this.actions.openSettings()
        break
      case 'loadPlugins':
        await this.pluginCenter.load(value.force === true)
        break
      case 'installPlugin':
        await this.pluginCenter.install(
          requiredString(value, 'spec'),
          optionalString(value.name),
          optionalHttpUrl(value.repositoryUrl),
        )
        break
      case 'removePlugin':
        await this.pluginCenter.remove(requiredString(value, 'name'))
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
        await this.postToHosts({ type: 'searchResults', query, results })
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
        const context = promptContextInput(value.context)
        const selectionId = context === undefined && this.configuration.get().autoAttachSelection
          ? this.editorSelection.current()?.id
          : context?.selectionId
        const selection = this.editorSelection.attachment(selectionId)
        const files = await this.workspaceFiles.attachments(context?.fileIds ?? [])
        const images = promptImageAttachments(value.images)
        await this.gateway.prompt(
          text,
          value.mode === 'steer' ? 'steer' : 'queue',
          [...(selection === undefined ? [] : [selection]), ...files, ...images],
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
      case 'searchWorkspaceFiles': {
        const query = typeof value.query === 'string' ? value.query.slice(0, 200) : ''
        const requestId = numberValue(value.requestId)
        const files = await this.workspaceFiles.search(query)
        await this.postToHosts({ type: 'workspaceFileSuggestions', query, requestId, files })
        break
      }
      case 'openFile': {
        const request = openFileRequest(value)
        if (!await this.workspaceFiles.open(request)) {
          void vscode.window.showWarningMessage(vscode.l10n.t('File is not available in the current workspace.'))
        }
        break
      }
      case 'attachSelection': {
        const selection = this.editorSelection.current()
        await this.postToHosts({ type: 'editorSelection', selection })
        if (selection === undefined) {
          void vscode.window.showInformationMessage(vscode.l10n.t('Select code in an editor first.'))
        }
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
      case 'exportSession': {
        const sessionId = optionalString(value.sessionId)
        const exportId = sessionId === undefined ? (await this.gateway.snapshot()).active?.id : sessionId
        if (exportId === undefined) throw new Error(vscode.l10n.t('Create or select a session first.'))
        const filename = exportFilename(exportId)
        // Ask for the destination before downloading so a cancelled dialog
        // does not waste a potentially large ZIP transfer. Uri.file needs an
        // absolute path, so anchor the default name in the workspace folder.
        const defaultFolder = vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file(process.cwd())
        const target = await vscode.window.showSaveDialog({
          title: vscode.l10n.t('Export Harness session'),
          defaultUri: vscode.Uri.joinPath(defaultFolder, filename),
          filters: { 'ZIP archive': ['zip'] },
        })
        if (target === undefined) break
        const bytes = await this.gateway.exportSession(exportId, value.includeDescendants !== false)
        await vscode.workspace.fs.writeFile(target, bytes)
        void vscode.window.showInformationMessage(vscode.l10n.t('Session exported: {0}', target.fsPath))
        break
      }
      case 'compact': {
        // The command catalog can lag a freshly opened session; refresh it so
        // the availability check is against the live registration.
        await this.gateway.refreshCommands()
        if (!this.gateway.hasHostCommand('compact')) {
          throw new Error(vscode.l10n.t('Compact is not available for this session.'))
        }
        await this.gateway.prompt('/compact')
        break
      }
    }
  }

  private async publishEditorSelection(): Promise<void> {
    await this.postToHosts({
      type: 'editorSelection',
      selection: this.editorSelection.current(),
    })
  }

  private html(webview: vscode.Webview): string {
    const nonce = randomBytes(18).toString('base64')
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'chat.js'))
    const style = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'chat.css'))
    const responsiveStyle = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'chat-responsive.css'))
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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <style nonce="${nonce}">
    .hidden { display: none !important; }
    #loading {
      position: fixed;
      inset: 0;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 3px;
      padding: 30px 20px;
      text-align: center;
      color: var(--vscode-descriptionForeground, #9d9d9d);
      background: var(--vscode-editor-background, #1e1e1e);
    }
    #loading.hidden { display: none !important; }
    .startup-logo { width: 56px; height: 56px; object-fit: contain; opacity: .92; animation: startup-float 2.2s ease-in-out infinite; }
    .startup-dots { height: 18px; margin-top: 10px; display: flex; align-items: center; gap: 5px; }
    .startup-dots span { width: 7px; height: 7px; border-radius: 50%; background: var(--vscode-progressBar-background, #0e639c); animation: startup-dot 1.1s ease-in-out infinite; }
    .startup-dots span:nth-child(2) { animation-delay: 140ms; }
    .startup-dots span:nth-child(3) { animation-delay: 280ms; }
    @keyframes startup-float { 50% { transform: translateY(-4px); } }
    @keyframes startup-dot {
      0%, 60%, 100% { transform: translateY(0); opacity: .5; }
      30% { transform: translateY(-6px); opacity: 1; }
    }
  </style>
  <link rel="stylesheet" href="${style}">
  <link rel="stylesheet" href="${responsiveStyle}">
  <title>DeepSeek Harness</title>
</head>
<body>
  <header class="shell-header">
    <div class="brand-row">
      <button id="history-toggle" class="icon-button" title="${text('history')}" aria-label="${text('history')}">☰</button>
      <div class="brand"><img class="brand-logo" src="${logo}" alt=""><strong>Harness</strong><span id="connection" class="connection"></span></div>
      <div class="header-actions">
        <button id="new-session" class="icon-button" title="${text('newConversation')}" aria-label="${text('newConversation')}">＋</button>
        <button id="plugins-toggle" class="icon-button" title="${text('plugins')}" aria-label="${text('plugins')}" aria-expanded="false" aria-controls="plugin-panel">⊞</button>
        <button id="open-settings" class="icon-button" title="${text('extensionSettings')}" aria-label="${text('extensionSettings')}">⚙</button>
      </div>
    </div>
    <div class="session-heading">
      <button id="back-parent" class="icon-button compact hidden" title="${text('backToParentAgent')}" aria-label="${text('backToParentAgent')}">←</button>
      <button id="session-title" class="title-button" title="${text('renameConversation')}">${text('newConversation')}</button>
      <button id="fork" class="icon-button compact" title="${text('forkConversation')}" aria-label="${text('forkConversation')}">⑂</button>
      <button id="export-session" class="icon-button compact" title="${text('exportSession')}" aria-label="${text('exportSession')}">⤓</button>
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

  <aside id="plugin-panel" class="plugin-panel hidden" aria-label="${text('pluginCenter')}">
    <header class="plugin-panel-heading">
      <div><strong>${text('pluginCenter')}</strong><small>web profile</small></div>
      <div class="plugin-panel-actions">
        <button id="plugin-refresh" class="icon-button compact" title="${text('refreshPlugins')}" aria-label="${text('refreshPlugins')}">↻</button>
        <button id="plugin-close" class="icon-button compact" title="${text('closePluginCenter')}" aria-label="${text('closePluginCenter')}">×</button>
      </div>
    </header>
    <nav class="plugin-tabs" aria-label="${text('pluginCenter')}">
      <button class="active" data-plugin-tab="marketplace">${text('pluginMarketplace')}</button>
      <button data-plugin-tab="installed">${text('installedPlugins')}</button>
    </nav>
    <section id="plugin-marketplace-view" class="plugin-panel-view">
      <div class="plugin-filter-row">
        <input id="plugin-search" class="search-input" type="search" placeholder="${text('searchPlugins')}" aria-label="${text('searchPlugins')}">
        <select id="plugin-category" class="plugin-category" aria-label="${text('allCategories')}"></select>
      </div>
      <p class="plugin-security-notice">⚠ ${text('pluginSecurityNotice')}</p>
      <div id="plugin-marketplace-list" class="plugin-list"></div>
      <button id="plugin-load-more" class="secondary-button hidden" type="button">${text('loadMorePlugins')}</button>
      <footer class="plugin-source-footer">
        <span id="plugin-summary"></span>
        <span><button id="plugin-source" class="link-button" type="button">${text('curatedPlugins')}</button> · <button id="plugin-topic" class="link-button" type="button">${text('browsePluginTopic')}</button></span>
      </footer>
    </section>
    <section id="plugin-installed-view" class="plugin-panel-view hidden">
      <form id="plugin-custom-form" class="plugin-custom-form">
        <strong>${text('installCustomPlugin')}</strong>
        <div><input id="plugin-custom-spec" class="search-input" type="text" placeholder="${text('customPluginPlaceholder')}" aria-label="${text('customPluginPlaceholder')}"><button class="primary-button" type="submit">${text('install')}</button></div>
      </form>
      <p class="plugin-compatibility-notice">${text('nativeUiCompatibilityNotice')}</p>
      <div id="plugin-installed-list" class="plugin-list"></div>
    </section>
    <div id="plugin-status" class="plugin-status hidden" role="status"></div>
  </aside>

  <main id="workbench" class="workbench">
    <section id="loading" class="center-state startup-screen">
      <img class="startup-logo" src="${logo}" alt="">
      <div class="startup-dots" aria-hidden="true"><span></span><span></span><span></span></div>
      <h2>${text('startingHarness')}</h2>
      <p>${text('startingHarnessDescription')}</p>
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
          <button data-detail="timeline">${text('timeline')}</button>
        </div>
        <div id="detail-content" class="detail-content"></div>
      </section>

      <div id="interactions" class="interactions"></div>
      <div id="activity-status" class="activity-status hidden" role="status">
        <span class="activity-star" aria-hidden="true">✻</span>
        <span class="activity-verb">${text('activityWorking')}</span>
        <span id="activity-elapsed" class="activity-elapsed"></span>
        <span id="activity-tokens" class="activity-tokens"></span>
        <span class="activity-hint">${text('activityEscHint')}</span>
      </div>
      <section class="composer-shell">
        <section id="configuration-panel" class="configuration-panel hidden" role="dialog" aria-label="${text('configurationTitle')}">
          <header class="configuration-panel-header">
            <strong>${text('configurationTitle')}</strong>
            <label class="configuration-source-switch">
              <span>${text('configurationSource')}</span>
              <select id="configuration-source" aria-label="${text('configurationSwitchSource')}" title="${text('configurationSwitchSource')}"></select>
            </label>
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
        <div id="editor-context-list" class="editor-context-list hidden" aria-label="${text('attachedContext')}"></div>
        <div id="image-preview-list" class="image-preview-list hidden" aria-label="${text('imageAttachments')}"></div>
        <div id="timeline-panel" class="timeline-panel hidden" role="listbox" aria-label="${text('timeline')}"></div>
        <div id="file-mention-menu" class="file-mention-menu hidden" role="listbox" aria-label="${text('workspaceFiles')}"></div>
        <div id="command-menu" class="command-menu hidden" role="listbox" aria-label="${text('slashCommands')}"></div>
        <textarea id="prompt" rows="1" placeholder="${text('promptPlaceholder')}" aria-label="${text('message')}"></textarea>
        <div class="composer-bar">
          <div class="composer-tools">
            <button id="attach-selection" class="text-button" title="${text('attachSelection')}">⬒ ${text('selection')}</button>
            <button id="timeline-toggle" class="text-button" title="${text('timeline')}">◷ ${text('timeline')}</button>
            <button id="details-toggle" class="text-button" title="${text('contextDescription')}">${text('context')}</button>
            <select id="permission" class="permission-select hidden" title="${text('permissionDescription')}"></select>
          </div>
          <div class="composer-meta">
            <span id="composer-status" class="composer-status"></span>
            <span id="context-meter" class="context-meter hidden" role="img">
              <span class="context-meter-ring" aria-hidden="true"></span>
              <span id="context-meter-value" class="context-meter-value"></span>
            </span>
            <button id="compact" class="compact-button" type="button" title="${text('compact')}">⇅ <span>${text('compact')}</span></button>
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
  <section id="settings-panel" class="settings-panel hidden" role="dialog" aria-label="${text('connectionSettings')}">
    <div class="settings-card">
      <header class="settings-header">
        <strong>${text('connectionSettings')}</strong>
        <button id="settings-close" class="icon-button compact" type="button" title="${text('closeSettings')}" aria-label="${text('closeSettings')}">×</button>
      </header>
      <div class="settings-body">
        <div class="settings-field">
          <span class="settings-label">${text('provider')}</span>
          <select id="settings-provider" class="settings-select"></select>
        </div>
        <div class="settings-field hidden" id="settings-name-field">
          <span class="settings-label">${text('providerName')}</span>
          <input id="settings-name" type="text" spellcheck="false" autocomplete="off" placeholder="${text('providerNamePlaceholder')}">
        </div>
        <div class="settings-field" id="settings-base-url-field">
          <span class="settings-label">${text('baseUrl')}</span>
          <input id="settings-base-url" type="text" spellcheck="false" autocomplete="off" aria-label="${text('baseUrl')}" placeholder="https://api.deepseek.com">
          <span id="settings-base-url-error" class="settings-error hidden"></span>
        </div>
        <label class="settings-field">
          <span class="settings-label">${text('apiKey')}</span>
          <input id="settings-api-key" type="password" spellcheck="false" autocomplete="off" placeholder="${text('apiKeyPlaceholder')}">
        </label>
        <label class="settings-field hidden" id="settings-models-field">
          <span class="settings-label">${text('providerModels')}</span>
          <input id="settings-models" type="text" spellcheck="false" autocomplete="off" placeholder="${text('providerModelsPlaceholder')}">
          <small class="settings-hint">${text('providerModelsHint')}</small>
        </label>
        <div class="settings-test-row">
          <button id="settings-test" class="secondary-button" type="button">${text('testConnection')}</button>
          <span id="settings-test-result" class="settings-status hidden"></span>
        </div>
        <p class="settings-hint">${text('settingsHint')}</p>
      </div>
      <footer class="settings-footer">
        <button id="settings-delete" class="secondary-button hidden" type="button">${text('remove')}</button>
        <button id="settings-open-native" class="secondary-button" type="button">${text('openNativeSettings')}</button>
        <button id="settings-apply" class="primary-button" type="button">${text('apply')}</button>
      </footer>
    </div>
  </section>

  <div id="image-lightbox" class="image-lightbox hidden" role="dialog" aria-modal="true" aria-label="${text('imagePreview')}">
    <div class="image-lightbox-backdrop"></div>
    <figure class="image-lightbox-content">
      <img id="image-lightbox-image" alt="">
      <figcaption id="image-lightbox-name"></figcaption>
      <button id="image-lightbox-close" class="image-lightbox-close" type="button" title="${text('closeImagePreview')}" aria-label="${text('closeImagePreview')}">×</button>
    </figure>
  </div>
  <script nonce="${nonce}">globalThis.__DEEPSEEK_HARNESS_LOCALIZATION__=${localization};</script>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`
  }
}

function settingsInput(value: Record<string, unknown>): ConnectionSettingsInput {
  const provider = typeof value.provider === 'string' && value.provider !== '' ? value.provider : 'deepseek-official'
  const name = typeof value.name === 'string' ? value.name : ''
  const baseUrl = typeof value.baseUrl === 'string' ? value.baseUrl : ''
  const apiKey = typeof value.apiKey === 'string' ? value.apiKey : ''
  const models = modelsInput(value.models)
  return { provider, name, baseUrl, apiKey, models }
}

/** Accepts an array of ids or a single comma/space-separated string. */
function modelsInput(value: unknown): readonly string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  if (typeof value === 'string' && value.trim() !== '') {
    return value.split(/[,，\s]+/u).map((item) => item.trim()).filter((item) => item !== '')
  }
  return []
}

function requiredString(value: Record<string, unknown>, key: string): string {
  const item = value[key]
  if (typeof item !== 'string' || item.trim() === '') throw new Error(vscode.l10n.t('Invalid {0}.', key))
  return item
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** Stable, cross-platform ZIP name for a session log export. */
function exportFilename(sessionId: string): string {
  return `dsh-session-${String(sessionId).replace(/[^A-Za-z0-9_-]/g, '_')}.zip`
}

function optionalHttpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  return safeExternalUri(value)?.toString()
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

function promptContextInput(value: unknown): { readonly selectionId?: string; readonly fileIds: readonly string[] } | undefined {
  if (!isRecord(value)) return undefined
  const selectionId = optionalString(value.selectionId)
  const fileIds = Array.isArray(value.fileIds)
    ? [...new Set(value.fileIds.filter((id): id is string => typeof id === 'string' && id !== ''))].slice(0, 8)
    : []
  return { ...(selectionId === undefined ? {} : { selectionId }), fileIds }
}

const PROMPT_IMAGE_MEDIA_TYPES: readonly PromptImageMediaType[] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

function promptImageAttachments(value: unknown): PromptAttachment[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(vscode.l10n.t('Invalid image attachment format.'))
  const images: PromptAttachment[] = []
  for (const item of value) {
    if (!isRecord(item)) throw new Error(vscode.l10n.t('Invalid image attachment format.'))
    const mediaType = item.mediaType
    const data = item.data
    const name = optionalString(item.name)
    if (
      typeof mediaType !== 'string'
      || !PROMPT_IMAGE_MEDIA_TYPES.includes(mediaType as PromptImageMediaType)
      || typeof data !== 'string'
      || data === ''
    ) {
      throw new Error(vscode.l10n.t('Invalid image attachment format.'))
    }
    images.push({
      kind: 'image',
      mediaType: mediaType as PromptImageMediaType,
      data,
      ...(name === undefined ? {} : { name }),
    })
  }
  return images
}

function openFileRequest(value: Record<string, unknown>): OpenWorkspaceFileRequest {
  const id = optionalString(value.id)
  const filePath = optionalString(value.path)
  const line = numberValue(value.line)
  const column = numberValue(value.column)
  if (id === undefined && filePath === undefined) throw new Error(vscode.l10n.t('Invalid file reference.'))
  return {
    ...(id === undefined ? {} : { id }),
    ...(filePath === undefined ? {} : { path: filePath }),
    ...(line === undefined ? {} : { line }),
    ...(column === undefined ? {} : { column }),
  }
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
