import { renderMarkdown } from '../src/webview/markdown.js'
import { createWebviewTranslator } from '../src/webview/localization.js'
import { composerConfigurationInput } from '../src/webview/composer-configuration/adapter.js'
import { createComposerConfigurationComponent } from '../src/webview/composer-configuration/component.js'
import { composerStatusText } from '../src/webview/composer-status.js'
import { createConnectionSettingsComponent } from '../src/webview/connection-settings/component.js'
import { createContextMeterComponent } from '../src/webview/context-meter/component.js'
import { createEditorContextComponent } from '../src/webview/editor-context/component.js'
import { createFileMentionComponent } from '../src/webview/file-mention/component.js'
import { permissionSelectOptions } from '../src/webview/permission/adapter.js'
import { createPluginCenterComponent } from '../src/webview/plugin-center/component.js'
import { StreamingMessageComponent } from '../src/webview/streaming-message/component.js'
import { createWorkDurationComponent } from '../src/webview/work-duration/component.js'
import { formatWorkDuration } from '../src/webview/work-duration/format.js'

const vscode = acquireVsCodeApi()
const t = createWebviewTranslator()

const byId = (id) => document.getElementById(id)
const elements = {
  connection: byId('connection'),
  historyToggle: byId('history-toggle'),
  historyPanel: byId('history-panel'),
  historyClose: byId('history-close'),
  historySearch: byId('history-search'),
  sessionList: byId('session-list'),
  newSession: byId('new-session'),
  sessionTitle: byId('session-title'),
  backParent: byId('back-parent'),
  fork: byId('fork'),
  permission: byId('permission'),
  keyBanner: byId('key-banner'),
  setApiKey: byId('set-api-key'),
  openSettings: byId('open-settings'),
  loading: byId('loading'),
  error: byId('error'),
  errorMessage: byId('error-message'),
  retry: byId('retry'),
  showLogs: byId('show-logs'),
  chat: byId('chat'),
  conversation: byId('conversation'),
  loadOlder: byId('load-older'),
  empty: byId('empty'),
  messages: byId('messages'),
  details: byId('details'),
  detailsToggle: byId('details-toggle'),
  detailContent: byId('detail-content'),
  todoCount: byId('todo-count'),
  skillCount: byId('skill-count'),
  jobCount: byId('job-count'),
  agentCount: byId('agent-count'),
  interactions: byId('interactions'),
  prompt: byId('prompt'),
  imagePreviewList: byId('image-preview-list'),
  timelineToggle: byId('timeline-toggle'),
  timelinePanel: byId('timeline-panel'),
  imageLightbox: byId('image-lightbox'),
  imageLightboxImage: byId('image-lightbox-image'),
  imageLightboxName: byId('image-lightbox-name'),
  imageLightboxClose: byId('image-lightbox-close'),
  commandMenu: byId('command-menu'),
  attachSelection: byId('attach-selection'),
  send: byId('send'),
  composerStatus: byId('composer-status'),
  activityStatus: byId('activity-status'),
  activityElapsed: byId('activity-elapsed'),
}

let payload
let currentDetail = 'todos'
let renderedSessionId = ''
let pastedImages = []
let startupComplete = false
const messageSignatures = new WeakMap()
let searchResults = []
let searchTimer
let menuState = null
let menuLoadedSession = null
let selectorSignature = ''
let interactionSignature = ''
let detailSignature = ''
let runStartedAt
let activityTimer
const markdownActions = {
  openExternal: (url) => post('openExternal', { url }),
  openFile: (reference) => post('openFile', reference),
  copyCode: (code) => copyText(code),
  defaultCodeLanguage: t('code'),
  copyLabel: t('copy'),
  copyCodeLabel: (language) => t('copyCode', { language }),
}
const composerConfiguration = createComposerConfigurationComponent({
  document,
  translate: t,
  onChange: () => renderComposer(payload?.state.active),
  onOpen: () => {
    closeCommandMenu()
    connectionSettings.close()
  },
})
const connectionSettings = createConnectionSettingsComponent({
  document,
  translate: t,
  post,
  onOpen: () => {
    composerConfiguration.close()
    closeCommandMenu()
  },
})
const contextMeter = createContextMeterComponent({ document, translate: t })
const editorContext = createEditorContextComponent({
  document,
  translate: t,
  onRequestSelection: () => post('attachSelection'),
  onOpenFile: (reference) => post('openFile', reference),
})
const fileMention = createFileMentionComponent({
  document,
  prompt: elements.prompt,
  translate: t,
  onSearch: (query, requestId) => post('searchWorkspaceFiles', { query, requestId }),
  onChoose: (file) => editorContext.addFile(file),
  onOpen: closeCommandMenu,
})
const workDuration = createWorkDurationComponent({ document, translate: t })
const streamingMessage = new StreamingMessageComponent({
  document,
  reasoningLabel: () => t('reasoningProcess'),
  thinkingLabel: () => t('thinking'),
  reasoningDoneLabel: (elapsed) => t('thoughtFor', { duration: formatWorkDuration(elapsed) }),
  renderMarkdown: (target, source) => renderMarkdown(target, source, markdownActions),
  onStreamFrame: () => {
    if (isNearBottom(elements.conversation)) elements.conversation.scrollTop = elements.conversation.scrollHeight
  },
})
const pluginCenter = createPluginCenterComponent({
  document,
  translate: t,
  onOpen: () => toggleHistory(false),
  onLoad: (force) => post('loadPlugins', { force }),
  onInstall: ({ spec, name, repositoryUrl }) => post('installPlugin', {
    spec,
    ...(name === undefined ? {} : { name }),
    ...(repositoryUrl === undefined ? {} : { repositoryUrl }),
  }),
  onRemove: (name) => post('removePlugin', { name }),
  onOpenExternal: (url) => post('openExternal', { url }),
})

window.addEventListener('message', (event) => {
  if (event.data?.type === 'pluginState') {
    pluginCenter.update(event.data.snapshot)
    return
  }
  if (event.data?.type === 'searchResults') {
    if (event.data.query === elements.historySearch.value.trim()) {
      searchResults = event.data.results
      renderSessions()
    }
    return
  }
  if (event.data?.type === 'editorSelection') {
    editorContext.updateSelection(event.data.selection)
    return
  }
  if (event.data?.type === 'workspaceFileSuggestions') {
    fileMention.acceptSuggestions(event.data.requestId, event.data.query, event.data.files || [])
    return
  }
  if (event.data?.type === 'connectionTestResult') {
    connectionSettings.renderTestResult(event.data)
    return
  }
  if (event.data?.type !== 'state') return
  payload = event.data
  render()
})

elements.historyToggle.addEventListener('click', () => toggleHistory(true))
elements.historyClose.addEventListener('click', () => toggleHistory(false))
elements.historySearch.addEventListener('input', () => {
  clearTimeout(searchTimer)
  const query = elements.historySearch.value.trim()
  if (query === '') {
    searchResults = []
    renderSessions()
  } else {
    searchResults = []
    renderSessions()
    searchTimer = setTimeout(() => post('searchSessions', { query }), 180)
  }
})
elements.newSession.addEventListener('click', () => {
  composerConfiguration.reset()
  fileMention.close()
  closeTimeline()
  editorContext.markSubmitted()
  clearPastedImages()
  post('newSession')
})
elements.sessionTitle.addEventListener('click', () => post('rename'))
elements.backParent.addEventListener('click', () => {
  composerConfiguration.reset()
  closeTimeline()
  clearPastedImages()
  post('selectParent')
})
elements.fork.addEventListener('click', () => {
  composerConfiguration.reset()
  closeTimeline()
  clearPastedImages()
  post('fork')
})
elements.setApiKey.addEventListener('click', () => post('setApiKey'))
elements.openSettings.addEventListener('click', () => connectionSettings.open())
elements.retry.addEventListener('click', () => post('retry'))
elements.showLogs.addEventListener('click', () => post('showLogs'))
elements.loadOlder.addEventListener('click', () => post('loadOlder'))
elements.detailsToggle.addEventListener('click', () => {
  elements.details.classList.toggle('hidden')
  if (!elements.details.classList.contains('hidden')) renderDetails()
})
elements.send.addEventListener('click', () => {
  if (payload?.state.active?.running) post('cancel')
  else sendPrompt()
})
elements.prompt.addEventListener('input', () => {
  resizePrompt()
  updateCommandMenu()
})
elements.prompt.addEventListener('keydown', (event) => {
  if (menuState && menuState.items.length > 0) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      menuState.index = (menuState.index + 1) % menuState.items.length
      renderCommandMenu()
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      menuState.index = (menuState.index - 1 + menuState.items.length) % menuState.items.length
      renderCommandMenu()
      return
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault()
      chooseCommand(menuState.items[menuState.index])
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      if (menuState.items[menuState.index]) {
        const name = menuState.items[menuState.index].name
        closeCommandMenu()
        insertCommand(name)
      }
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      closeCommandMenu()
      return
    }
  }
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    sendPrompt()
  }
})
elements.prompt.addEventListener('blur', () => {
  setTimeout(() => { if (!elements.commandMenu.matches(':hover')) closeCommandMenu() }, 120)
})
document.addEventListener('paste', (event) => {
  const target = event.target
  if (!elements.prompt.parentElement?.contains(target)) return
  const clipboardData = event.clipboardData
  if (!clipboardData) return
  const itemFiles = clipboardData.items === undefined
    ? []
    : [...clipboardData.items]
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file) => file !== undefined && file !== null)
  const directFiles = clipboardData.files === undefined
    ? []
    : [...clipboardData.files].filter((file) => file.type.startsWith('image/'))
  const files = [...new Map([...itemFiles, ...directFiles].map((file) => [`${file.name}:${file.size}:${file.lastModified}`, file])).values()]
  if (files.length === 0) return
  event.preventDefault()
  void addPastedImages(files)
})
elements.imageLightboxClose.addEventListener('click', () => closeImagePreview())
elements.imageLightbox.querySelector('.image-lightbox-backdrop')?.addEventListener('click', () => closeImagePreview())
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return
  if (!elements.imageLightbox.classList.contains('hidden')) {
    event.preventDefault()
    closeImagePreview()
    return
  }
  if (!elements.timelinePanel.classList.contains('hidden')) {
    event.preventDefault()
    closeTimeline()
    return
  }
  if (!byId('settings-panel').classList.contains('hidden') || !byId('plugin-panel').classList.contains('hidden')) return
  if (payload?.state.active?.running) {
    event.preventDefault()
    post('cancel')
  }
})
elements.permission.addEventListener('change', () => post('setPermission', { value: elements.permission.value }))
elements.timelineToggle.addEventListener('click', (event) => {
  event.stopPropagation()
  if (elements.timelinePanel.classList.contains('hidden')) openTimeline()
  else closeTimeline()
})
document.addEventListener('pointerdown', (event) => {
  const target = event.target
  if (
    !elements.timelinePanel.classList.contains('hidden')
    && !elements.timelinePanel.contains(target)
    && !elements.timelineToggle.contains(target)
  ) {
    closeTimeline()
  }
})
for (const tab of document.querySelectorAll('[data-detail]')) {
  tab.addEventListener('click', () => {
    currentDetail = tab.dataset.detail
    renderDetails()
  })
}

function render() {
  if (!payload) return
  const { state } = payload
  const active = state.active
  editorContext.setAutoAttach(payload.configuration?.autoAttachSelection === true)
  renderPhase(state)
  if (!elements.historyPanel.classList.contains('hidden')) renderSessions()
  renderSelectors(active)
  elements.keyBanner.classList.toggle('hidden', state.hasApiKey)
  elements.sessionTitle.textContent = active?.title || t('newConversation')
  elements.sessionTitle.disabled = !active || !!active.parentSessionId
  elements.backParent.classList.toggle('hidden', !active?.parentSessionId)
  elements.fork.disabled = !active || active.blank
  elements.loadOlder.classList.toggle('hidden', !active?.hasMore)
  renderMessages(active)
  renderInteractions(active)
  if (!elements.details.classList.contains('hidden')) renderDetails()
  renderComposer(active)
  renderActivityStatus(active)
  updateCommandMenu()
  connectionSettings.update(
    payload.connectionSettings ?? { writable: false, providers: [] },
    payload.configuration?.provider ?? 'deepseek-official',
    active?.model?.provider,
  )
  if (!elements.timelinePanel.classList.contains('hidden')) renderTimelinePanel()
  if (!startupComplete && state.phase === 'connected') {
    startupComplete = true
    renderPhase(state)
    scrollConversationToBottom()
  }
}

function renderPhase(state) {
  const phase = state.phase
  elements.connection.className = `connection ${phase}`
  elements.connection.textContent = phase === 'connected' ? t('connected') : phase === 'reconnecting' ? t('reconnecting') : phase === 'error' ? t('connectionError') : t('starting')
  const failed = phase === 'error'
  const loading = !startupComplete && phase !== 'error'
  elements.loading.classList.toggle('hidden', !loading)
  elements.error.classList.toggle('hidden', !failed)
  elements.chat.classList.toggle('hidden', loading || failed)
  if (failed) elements.errorMessage.textContent = state.error || t('unknownError')
}

function renderSessions() {
  if (!payload) return
  const query = elements.historySearch.value.trim()
  const snippets = new Map(searchResults.map((result) => [result.sessionId, result.snippet]))
  const resultIds = new Set(searchResults.map((result) => result.sessionId))
  const sessions = query === '' ? payload.state.sessions : payload.state.sessions.filter((session) => resultIds.has(session.id))
  const fragment = document.createDocumentFragment()
  for (const session of sessions) {
    const button = node('button', 'session-row')
    if (session.id === payload.state.active?.id) button.classList.add('active')
    const top = node('span', 'session-row-top')
    top.append(node('span', 'session-name', session.title), node('span', `running-dot${session.running ? ' active' : ''}`))
    const meta = node('span', 'session-meta', formatRelativeTime(session.updatedAt))
    if (session.agentPreset) meta.append(` · ${session.agentPreset}`)
    button.append(top, meta)
    const snippet = snippets.get(session.id)
    if (snippet) button.append(node('span', 'session-snippet', snippet))
    button.addEventListener('click', () => {
      composerConfiguration.reset()
      closeTimeline()
      clearPastedImages()
      post('selectSession', { sessionId: session.id })
      toggleHistory(false)
    })
    fragment.append(button)
  }
  if (sessions.length === 0) fragment.append(node('p', 'muted-empty', t('noMatchingConversations')))
  elements.sessionList.replaceChildren(fragment)
}

function renderSelectors(active) {
  const nextSignature = JSON.stringify({
    sessionId: active?.id,
    phase: payload.state.phase,
    configuration: payload.configuration,
    fallbackOptions: payload.fallbackOptions,
    presets: payload.state.presets,
    models: active?.models,
    model: active?.model,
    agentPreset: active?.agentPreset,
    parentSessionId: active?.parentSessionId,
    permissions: active?.permissions,
    running: active?.running,
  })
  if (nextSignature === selectorSignature) return
  selectorSignature = nextSignature
  composerConfiguration.update(composerConfigurationInput(payload))
  const permissions = active?.permissions
  if (permissions) {
    replaceOptions(elements.permission, permissionSelectOptions(permissions), permissions.currentValue)
    elements.permission.classList.remove('hidden')
    elements.permission.disabled = active.running || payload.state.phase !== 'connected'
  } else {
    elements.permission.classList.add('hidden')
  }
}

function replaceOptions(select, options, selected) {
  const fragment = document.createDocumentFragment()
  for (const item of options) {
    const option = document.createElement('option')
    option.value = item.id
    option.textContent = item.label || item.name || item.id
    option.title = item.description || ''
    option.selected = item.id === selected
    option.disabled = item.disabled === true
    fragment.append(option)
  }
  select.replaceChildren(fragment)
}

function renderMessages(active) {
  const messages = active?.messages || []
  const sessionId = active?.id || ''
  const sessionChanged = sessionId !== renderedSessionId
  const shouldStick = sessionChanged || isNearBottom(elements.conversation)
  const previousTop = elements.conversation.scrollTop
  const previousHeight = elements.conversation.scrollHeight
  const previousFirstId = elements.messages.firstElementChild?.dataset.messageId
  const conclusionId = latestConclusionId(messages)
  const existing = new Map([...elements.messages.children].map((element) => [element.dataset.messageId, element]))
  const retained = new Set()
  let cursor = elements.messages.firstElementChild

  for (const item of messages) {
    const id = String(item.id)
    const signature = messageSignature(item)
    let element = existing.get(id)
    if (!element) {
      element = renderMessage(item, conclusionId)
      setMessageMetadata(element, id, signature)
    } else if (messageSignatures.get(element) !== signature) {
      if (patchStreamingMessage(element, item)) {
        messageSignatures.set(element, signature)
      } else {
        const wasCursor = element === cursor
        const disclosureState = captureDisclosures(element)
        const replacement = renderMessage(item, conclusionId)
        restoreDisclosures(replacement, disclosureState)
        setMessageMetadata(replacement, id, signature)
        element.replaceWith(replacement)
        element = replacement
        if (wasCursor) cursor = replacement
      }
    }
    retained.add(id)
    if (element !== cursor) elements.messages.insertBefore(element, cursor)
    cursor = element.nextElementSibling
  }

  for (const [id, element] of existing) {
    if (!retained.has(id)) element.remove()
  }
  for (const footer of elements.messages.querySelectorAll('.message-copy-footer')) {
    const article = footer.closest('article')
    if (article?.dataset.messageId !== conclusionId) footer.remove()
  }
  elements.empty.classList.toggle('hidden', messages.length > 0)
  const prepended = !sessionChanged && previousFirstId !== undefined
    && messages.findIndex((item) => String(item.id) === previousFirstId) > 0
  if (shouldStick) {
    scrollConversationToBottom()
  } else if (prepended) {
    elements.conversation.scrollTop = previousTop + elements.conversation.scrollHeight - previousHeight
  } else {
    // Streaming below the viewport must not steal the reader's position.
    elements.conversation.scrollTop = previousTop
  }
  renderedSessionId = sessionId
}

function messageText(item) {
  return (item.blocks || [])
    .filter((block) => block.kind === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim()
}

function latestConclusionId(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const item = messages[index]
    if (item?.kind === 'message' && item.role === 'assistant' && messageText(item) !== '') return item.id
  }
  return undefined
}

function createCopyFooter(item) {
  const button = node('button', 'message-copy-footer')
  button.type = 'button'
  button.title = t('copyConclusion')
  button.setAttribute('aria-label', t('copyConclusion'))
  const icon = node('span', 'copy-icon', '⧉')
  const label = node('span', 'copy-label', t('copy'))
  button.append(icon, label)
  button.addEventListener('click', () => {
    copyText(messageText(item))
    button.classList.add('copied')
    icon.textContent = '✓'
    label.textContent = t('copied')
    setTimeout(() => {
      button.classList.remove('copied')
      icon.textContent = '⧉'
      label.textContent = t('copy')
    }, 2_000)
  })
  return button
}

function renderMessage(item, conclusionId) {
  if (item.kind === 'tool') return renderTool(item)
  if (item.kind === 'context') return renderContext(item)
  if (item.kind === 'notice') {
    const notice = node('div', `notice ${item.status || ''}`)
    notice.append(node('strong', '', item.title || t('status')))
    if (item.detail) notice.append(node('span', '', item.detail))
    workDuration.update(notice, item.status === 'running' ? undefined : item.workDuration, item.status === 'running')
    return notice
  }
  const article = node('article', `message ${item.role || ''}`)
  const label = node('div', 'message-label', item.role === 'user' ? t('you') : 'DeepSeek')
  article.append(label)
  const body = node('div', 'message-body')
  streamingMessage.render(body, item)
  article.append(body)
  workDuration.update(article, item.status === 'running' ? undefined : item.workDuration)
  if (item.role === 'assistant' && item.id === conclusionId) article.append(createCopyFooter(item))
  return article
}

function renderTool(item) {
  const container = node('div', 'tool-item')
  const details = node('details', `tool-card ${item.status || ''}`)
  details.dataset.disclosureKey = 'tool'
  const summary = node('summary')
  summary.append(node('span', 'tool-status'), node('span', 'tool-title', toolDisplayName(item.title || t('tool'))))
  if (item.detail && item.detail.trim() !== '') {
    summary.append(node('span', 'tool-preview', toolPreviewText(item.detail)))
  }
  details.append(summary)
  if (item.detail && item.detail.trim() !== '') {
    const detail = node('div', 'tool-detail')
    renderToolDetail(detail, item.detail)
    details.append(detail)
  }
  container.append(details)
  workDuration.update(container, item.status === 'running' ? undefined : item.workDuration)
  return container
}

function toolDisplayName(name) {
  if (name === '') return name
  return name.charAt(0).toUpperCase() + name.slice(1)
}

function toolPreviewText(detail) {
  const trimmed = detail.trim()
  if (isJsonText(trimmed)) {
    try {
      const parsed = JSON.parse(trimmed)
      if (typeof parsed.description === 'string' && parsed.description.trim() !== '') {
        return summarizeLine(parsed.description)
      }
      const file = parsed.file_path ?? parsed.path ?? parsed.file
      if (typeof file === 'string' && file.trim() !== '') {
        return summarizeLine(file)
      }
      if (typeof parsed.command === 'string' && parsed.command.trim() !== '') {
        return summarizeLine(parsed.command)
      }
    } catch {
      // Fall through to raw text preview.
    }
  }
  return summarizeLine(detail)
}

function summarizeLine(text) {
  const single = text.replace(/\s+/g, ' ').trim()
  return single.length > 90 ? `${single.slice(0, 90)}…` : single
}

function renderToolDetail(target, detail) {
  const trimmed = detail.trim()
  let source
  if (isJsonText(trimmed)) {
    try {
      source = `\`\`\`json\n${JSON.stringify(JSON.parse(trimmed), null, 2)}\n\`\`\``
    } catch {
      source = undefined
    }
  } else if (looksLikeDiff(trimmed)) {
    source = `\`\`\`diff\n${detail}\n\`\`\``
  } else if (looksLikeCode(trimmed)) {
    source = `\`\`\`\n${detail}\n\`\`\``
  }
  if (source === undefined) {
    target.textContent = detail
    return
  }
  target.classList.add('markdown-body')
  renderMarkdown(target, source, markdownActions)
}

function isJsonText(text) {
  return (text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))
}

function looksLikeDiff(text) {
  return /^(?:diff --git |--- |\+\+\+ |@@ )/m.test(text)
}

function looksLikeCode(text) {
  return /(?:^|\n)\s*(?:function|const|let|var|def|class|import|from|export|return|if|for|while|public|private|async|await)\b/m.test(text)
}

function renderContext(item) {
  const details = node('details', 'context-card')
  details.dataset.disclosureKey = 'context'
  details.append(node('summary', '', item.title || t('context')))
  const text = (item.blocks || []).map((block) => block.text).join('\n')
  details.append(node('pre', '', text))
  return details
}

function renderInteractions(active) {
  const nextSignature = JSON.stringify({
    sessionId: active?.id,
    approvals: active?.approvals || [],
    questions: active?.questions || [],
  })
  if (nextSignature === interactionSignature) return
  interactionSignature = nextSignature
  const fragment = document.createDocumentFragment()
  for (const approval of active?.approvals || []) {
    const card = node('section', 'interaction-card warning')
    card.append(node('strong', '', t('approvalRequired', { tool: approval.toolName })))
    if (approval.reason) card.append(node('p', '', approval.reason))
    const actions = node('div', 'interaction-actions')
    const reject = node('button', 'secondary-button', t('reject'))
    reject.addEventListener('click', () => post('answerApproval', { key: approval.key, outcome: 'rejected' }))
    const allow = node('button', 'primary-button', t('allowOnce'))
    allow.addEventListener('click', () => post('answerApproval', { key: approval.key, outcome: 'allowed-once' }))
    actions.append(reject, allow)
    card.append(actions)
    fragment.append(card)
  }
  for (const pending of active?.questions || []) fragment.append(renderQuestions(pending))
  elements.interactions.replaceChildren(fragment)
}

function renderQuestions(pending) {
  const form = node('form', 'interaction-card question-card')
  form.append(node('strong', '', t('questionRequired')))
  for (const question of pending.questions) {
    const fieldset = document.createElement('fieldset')
    const legend = node('legend', '', question.header || question.question)
    fieldset.append(legend)
    if (question.header) fieldset.append(node('p', 'question-text', question.question))
    if (question.detail) fieldset.append(node('pre', 'question-detail', question.detail))
    for (const option of question.options) {
      const label = node('label', 'question-option')
      const input = document.createElement('input')
      input.type = question.multiSelect ? 'checkbox' : 'radio'
      input.name = `question-${question.id}`
      input.value = option.label
      label.append(input, node('span', '', option.label))
      if (option.description) label.append(node('small', '', option.description))
      fieldset.append(label)
    }
    const custom = document.createElement('input')
    custom.className = 'custom-answer'
    custom.name = `custom-${question.id}`
    custom.placeholder = t('otherAnswer')
    fieldset.append(custom)
    form.append(fieldset)
  }
  const submit = node('button', 'primary-button', t('submitAnswer'))
  submit.type = 'submit'
  form.append(submit)
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const answers = pending.questions.map((question) => ({
      id: question.id,
      selected: [...form.querySelectorAll(`[name="question-${cssEscape(question.id)}"]:checked`)].map((input) => input.value),
      custom: form.querySelector(`[name="custom-${cssEscape(question.id)}"]`)?.value || undefined,
    }))
    post('answerQuestions', { key: pending.key, answers })
  })
  return form
}

function assistantConclusions(active) {
  if (!active) return []
  return (active.messages || [])
    .filter((item) => item.kind === 'message' && item.role === 'assistant')
    .map((item) => {
      const text = (item.blocks || [])
        .filter((block) => block.kind === 'text')
        .map((block) => block.text)
        .join('\n')
        .trim()
      return { id: item.id, text, time: item.time }
    })
    .filter((item) => item.text !== '')
    .reverse()
}

function timelineSignature(active) {
  return assistantConclusions(active)
    .map((item) => `${item.id}:${item.text.slice(0, 200)}:${item.time}`)
    .join('|')
}

function renderDetails() {
  if (!payload) return
  const active = payload.state.active
  const nextSignature = JSON.stringify({
    sessionId: active?.id,
    currentDetail,
    todos: active?.todos,
    plan: active?.plan,
    goal: active?.goal,
    skills: active?.skills,
    subagents: active?.subagents,
    jobs: active?.jobs,
    timeline: timelineSignature(active),
    running: active?.running,
  })
  if (nextSignature === detailSignature) return
  detailSignature = nextSignature
  elements.todoCount.textContent = String(active?.todos.length || 0)
  elements.skillCount.textContent = String(active?.skills.length || 0)
  elements.jobCount.textContent = String(active?.jobs.length || 0)
  elements.agentCount.textContent = String(active?.subagents.length || 0)
  for (const tab of document.querySelectorAll('[data-detail]')) tab.classList.toggle('active', tab.dataset.detail === currentDetail)
  const fragment = document.createDocumentFragment()
  if (currentDetail === 'todos') {
    if (active?.plan) {
      const mode = node('div', 'plan-mode-row')
      const text = active.plan.pending ? t('planChanging') : active.plan.active ? t('planEnabled') : t('planDisabled')
      mode.append(node('span', '', text))
      const toggle = node('button', 'secondary-button', active.plan.active ? t('disable') : t('enable'))
      toggle.disabled = active.plan.pending || active.running
      toggle.addEventListener('click', () => post('setPlan', { active: !active.plan.active }))
      mode.append(toggle)
      fragment.append(mode)
    }
    for (const todo of active?.todos || []) {
      const row = node('div', `todo-row ${todo.status}`)
      row.append(node('span', 'todo-check', todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '●' : '○'), node('span', '', todo.content))
      fragment.append(row)
    }
  } else if (currentDetail === 'goal') {
    const goal = active?.goal
    if (!goal) {
      const create = node('button', 'primary-button', t('createGoal'))
      create.addEventListener('click', () => post('createGoal'))
      fragment.append(create)
    } else {
      const card = node('section', 'goal-card')
      card.append(node('strong', '', goal.objective))
      card.append(node('span', 'goal-meta', t('goalRounds', {
        phase: goalPhaseLabel(goal.phase),
        current: goal.roundsStarted,
        max: goal.maxGoalRounds,
      })))
      if (goal.blockedReason) card.append(node('p', '', goal.blockedReason))
      const actions = node('div', 'goal-actions')
      if (goal.phase === 'active') actions.append(goalButton(t('pause'), 'pause'))
      if (goal.phase === 'paused' || goal.phase === 'blocked') actions.append(goalButton(t('resume'), 'resume'))
      if (goal.phase !== 'complete') actions.append(goalButton(t('markComplete'), 'complete'))
      actions.append(goalButton(t('clear'), 'clear', true))
      card.append(actions)
      fragment.append(card)
    }
  } else if (currentDetail === 'skills') {
    for (const skill of active?.skills || []) {
      const button = node('button', 'skill-row')
      button.append(node('strong', '', `/${skill.name}`), node('span', '', skill.description))
      button.addEventListener('click', () => {
        elements.prompt.value = `/${skill.name} `
        resizePrompt()
        elements.prompt.focus()
      })
      fragment.append(button)
    }
  } else if (currentDetail === 'agents') {
    for (const agent of active?.subagents || []) {
      if (agent.kind === 'diagnostic') {
        fragment.append(node('div', 'subagent-row diagnostic', `${agent.id.slice(0, 8)} · ${agent.reason}`))
        continue
      }
      const button = node('button', 'subagent-row')
      button.append(node('span', `job-status ${agent.activity}`), node('strong', '', agent.label || `Agent ${agent.id.slice(0, 8)}`))
      button.append(node('small', '', `${agent.mode === 'continuable' ? t('continuableConversation') : t('oneShot')}${agent.hasChildren ? t('hasChildAgents') : ''}`))
      button.addEventListener('click', () => {
        composerConfiguration.reset()
        closeTimeline()
        clearPastedImages()
        post('selectSubagent', { sessionId: agent.id, mode: agent.mode })
      })
      fragment.append(button)
    }
  } else if (currentDetail === 'jobs') {
    for (const job of active?.jobs || []) {
      const row = node('div', 'job-row')
      row.append(node('span', `job-status ${job.status}`), node('div', '', job.label))
      if (job.detail) row.append(node('small', '', job.detail))
      fragment.append(row)
    }
  } else if (currentDetail === 'timeline') {
    const conclusions = assistantConclusions(active)
    conclusions.forEach((item, index) => {
      const button = node('button', 'timeline-row')
      button.type = 'button'
      button.title = t('timeline')
      const badge = node('span', 'timeline-index', `#${index + 1}`)
      const copy = node('span', 'timeline-copy')
      copy.append(node('strong', '', formatRelativeTime(item.time)))
      copy.append(node('span', 'timeline-snippet', item.text))
      button.append(badge, copy)
      button.addEventListener('click', () => {
        const target = elements.messages.querySelector(`[data-message-id="${cssEscape(item.id)}"]`)
        if (target !== null) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' })
          target.classList.add('timeline-highlight')
          setTimeout(() => target.classList.remove('timeline-highlight'), 1_600)
        }
      })
      fragment.append(button)
    })
  }
  if (!fragment.childNodes.length) fragment.append(node('p', 'muted-empty', t('noContent')))
  elements.detailContent.replaceChildren(fragment)
}

function goalButton(label, action, secondary = false) {
  const button = node('button', secondary ? 'secondary-button' : 'primary-button', label)
  button.addEventListener('click', () => post('mutateGoal', { action }))
  return button
}

function goalPhaseLabel(phase) {
  if (phase === 'active') return t('goalPhaseActive')
  if (phase === 'paused') return t('goalPhasePaused')
  if (phase === 'blocked') return t('goalPhaseBlocked')
  return t('goalPhaseComplete')
}

function renderComposer(active) {
  const ready = payload.state.phase === 'connected' || payload.state.phase === 'reconnecting'
  elements.prompt.disabled = !ready
  if (active?.subagentMode === 'one-shot') elements.prompt.disabled = true
  elements.send.disabled = !ready || (!active?.running && elements.prompt.value.trim() === '' && pastedImages.length === 0)
  elements.send.textContent = active?.running ? '■' : '↑'
  elements.send.title = active?.running ? t('stopGenerating') : t('sendTitle')
  contextMeter.update(active?.contextPressure)
  elements.composerStatus.textContent = composerStatusText(active, {
    oneShotReadOnly: t('oneShotReadOnly'),
    runningQueue: t('runningQueue'),
    continuableSubagent: t('continuableSubagent'),
  })
}

/** Claude-style running status line: elapsed time plus an interrupt hint. */
function renderActivityStatus(active) {
  const running = active?.running === true
  elements.activityStatus.classList.toggle('hidden', !running)
  if (!running) {
    runStartedAt = undefined
    if (activityTimer !== undefined) {
      clearInterval(activityTimer)
      activityTimer = undefined
    }
    return
  }
  // Prefer the real turn start reported by Harness; fall back to the moment
  // this Webview first observed the run (e.g. after a mid-run reload).
  runStartedAt = latestRunningStartedAt(active) ?? runStartedAt ?? Date.now()
  updateActivityElapsed()
  if (activityTimer === undefined) activityTimer = setInterval(updateActivityElapsed, 500)
}

function latestRunningStartedAt(active) {
  const messages = active?.messages ?? []
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const item = messages[index]
    if (item?.status === 'running' && item.workDuration?.startedAt !== undefined) return item.workDuration.startedAt
  }
  return undefined
}

function updateActivityElapsed() {
  if (runStartedAt === undefined) return
  elements.activityElapsed.textContent = formatWorkDuration(Date.now() - runStartedAt)
}

function updateCommandMenu() {
  const active = payload?.state?.active
  const token = currentCommandToken(elements.prompt)
  if (token === undefined || !active) {
    closeCommandMenu()
    return
  }
  if (!menuState || menuState.query !== token) menuState = { query: token, index: 0, items: [] }
  const commands = active.commands || []
  if (menuLoadedSession !== active.id && commands.every((command) => command.kind === 'extension')) {
    menuLoadedSession = active.id
    post('loadCommands')
  }
  const query = token.toLowerCase()
  const items = commands.filter((command) => {
    const name = command.name.toLowerCase()
    return query === '' || name.includes(query) || command.description.toLowerCase().includes(query)
  })
  items.sort((left, right) => rank(left.name, query) - rank(right.name, query))
  menuState.items = items
  if (menuState.index >= items.length) menuState.index = Math.max(0, items.length - 1)
  renderCommandMenu()
}

function currentCommandToken(textarea) {
  const before = textarea.value.slice(0, textarea.selectionStart)
  const match = /(?:^|\s)\/([a-zA-Z0-9_-]*)$/.exec(before)
  return match ? match[1] : undefined
}

function rank(name, query) {
  if (query === '') return 0
  return name.toLowerCase().startsWith(query) ? 0 : 1
}

function renderCommandMenu() {
  const menu = elements.commandMenu
  if (!menuState || menuState.items.length === 0) {
    menu.classList.add('hidden')
    menu.replaceChildren()
    return
  }
  const fragment = document.createDocumentFragment()
  menuState.items.forEach((command, index) => {
    const button = node('button', `command-menu-item${index === menuState.index ? ' active' : ''}`)
    button.type = 'button'
    button.setAttribute('role', 'option')
    button.setAttribute('aria-selected', String(index === menuState.index))
    const name = node('span', 'command-name', `/${command.name}`)
    const desc = node('span', 'command-desc', command.description)
    button.append(name, desc)
    if (command.input?.hint) button.append(node('span', 'command-hint', command.input.hint))
    button.addEventListener('mousedown', (event) => event.preventDefault())
    button.addEventListener('click', () => chooseCommand(command))
    fragment.append(button)
  })
  menu.replaceChildren(fragment)
  menu.classList.remove('hidden')
}

function chooseCommand(command) {
  closeCommandMenu()
  if (command.kind === 'extension') {
    if (command.name === 'model') composerConfiguration.open('model')
    else if (command.name === 'reasoning') composerConfiguration.open('reasoning')
    else if (command.name === 'preset') composerConfiguration.open('preset')
    return
  }
  insertCommand(command.name)
}

function insertCommand(name) {
  elements.prompt.value = `/${name} `
  resizePrompt()
  elements.prompt.focus()
  elements.prompt.setSelectionRange(elements.prompt.value.length, elements.prompt.value.length)
}

function closeCommandMenu() {
  menuState = null
  elements.commandMenu.classList.add('hidden')
  elements.commandMenu.replaceChildren()
}

function openTimeline() {
  closeCommandMenu()
  fileMention.close()
  composerConfiguration.close()
  renderTimelinePanel()
  elements.timelinePanel.classList.remove('hidden')
  elements.timelineToggle.classList.add('active')
}

function closeTimeline() {
  elements.timelinePanel.classList.add('hidden')
  elements.timelineToggle.classList.remove('active')
  elements.timelinePanel.replaceChildren()
}

function renderTimelinePanel() {
  const conclusions = assistantConclusions(payload?.state?.active)
  const fragment = document.createDocumentFragment()
  const header = node('div', 'timeline-panel-header')
  header.append(node('strong', '', t('timeline')), node('span', 'timeline-panel-count', String(conclusions.length)))
  fragment.append(header)
  if (conclusions.length === 0) {
    fragment.append(node('p', 'timeline-empty', t('noContent')))
  } else {
    for (const item of conclusions) {
      const button = node('button', 'timeline-entry')
      button.type = 'button'
      const index = node('span', 'timeline-entry-index', `#${conclusions.indexOf(item) + 1}`)
      const copy = node('span', 'timeline-entry-copy')
      copy.append(node('strong', '', formatRelativeTime(item.time)))
      copy.append(node('span', 'timeline-entry-snippet', item.text))
      button.append(index, copy)
      button.addEventListener('click', () => {
        closeTimeline()
        selectTimelineItem(item)
      })
      fragment.append(button)
    }
  }
  elements.timelinePanel.replaceChildren(fragment)
}

function selectTimelineItem(item) {
  const target = elements.messages.querySelector(`[data-message-id="${cssEscape(item.id)}"]`)
  if (target === null) return
  smoothScrollConversationTo(target)
  target.classList.add('timeline-highlight')
  setTimeout(() => target.classList.remove('timeline-highlight'), 1_600)
}

function smoothScrollConversationTo(target) {
  const container = elements.conversation
  const start = container.scrollTop
  const targetScroll = start + target.getBoundingClientRect().top - container.getBoundingClientRect().top - 12
  const duration = 420
  const startedAt = Date.now()
  const step = () => {
    const progress = Math.min(1, (Date.now() - startedAt) / duration)
    const eased = 1 - Math.pow(1 - progress, 3)
    container.scrollTop = start + (targetScroll - start) * eased
    if (progress < 1) window.requestAnimationFrame(step)
  }
  window.requestAnimationFrame(step)
}

const IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

async function addPastedImages(files) {
  const accepted = []
  for (const file of files) {
    try {
      accepted.push(await fileToImageAttachment(file))
    } catch {
      // Unsupported or unreadable clipboard image; keep the rest.
    }
  }
  if (accepted.length === 0) return
  pastedImages.push(...accepted)
  renderImagePreviews()
  resizePrompt()
}

function fileToImageAttachment(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const match = /^data:([^;,]+);base64,(.*)$/s.exec(result)
      if (!match || !IMAGE_MEDIA_TYPES.has(match[1]) || match[2] === '') {
        reject(new Error('Unsupported image attachment'))
        return
      }
      const mediaType = match[1]
      const data = match[2]
      resolve({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        mediaType,
        data,
        ...(file.name === undefined || file.name === '' ? {} : { name: file.name }),
        previewUrl: result,
      })
    }
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image'))
    reader.readAsDataURL(file)
  })
}

function renderImagePreviews() {
  elements.imagePreviewList.classList.toggle('hidden', pastedImages.length === 0)
  const fragment = document.createDocumentFragment()
  for (const image of pastedImages) {
    const item = node('div', 'image-preview-item')
    item.dataset.imageId = image.id
    const button = node('button', 'image-preview-button')
    button.type = 'button'
    button.title = t('imagePreview')
    button.setAttribute('aria-label', t('imagePreview'))
    const thumb = node('img', 'image-preview-thumb')
    thumb.src = image.previewUrl
    thumb.alt = image.name || t('imageAttachment')
    button.append(thumb)
    button.addEventListener('click', () => openImagePreview(image))
    const remove = node('button', 'image-preview-remove', '×')
    remove.type = 'button'
    remove.title = t('removeImageAttachment')
    remove.setAttribute('aria-label', t('removeImageAttachment'))
    remove.addEventListener('click', (event) => {
      event.stopPropagation()
      removePastedImage(image.id)
    })
    item.append(button, remove)
    fragment.append(item)
  }
  elements.imagePreviewList.replaceChildren(fragment)
}

function removePastedImage(id) {
  pastedImages = pastedImages.filter((image) => image.id !== id)
  renderImagePreviews()
  resizePrompt()
}

function openImagePreview(image) {
  elements.imageLightboxImage.src = image.previewUrl
  elements.imageLightboxImage.alt = image.name || t('imageAttachment')
  elements.imageLightboxName.textContent = image.name || ''
  elements.imageLightbox.classList.remove('hidden')
  elements.imageLightboxClose.focus()
}

function closeImagePreview() {
  elements.imageLightbox.classList.add('hidden')
  elements.imageLightboxImage.src = ''
  elements.imageLightboxImage.alt = ''
  elements.imageLightboxName.textContent = ''
}

function clearPastedImages() {
  pastedImages = []
  renderImagePreviews()
  closeImagePreview()
}

function sendPrompt() {
  closeCommandMenu()
  closeTimeline()
  fileMention.close()
  composerConfiguration.close()
  const text = elements.prompt.value.trim()
  if (!text && pastedImages.length === 0) return
  const configuration = composerConfiguration.selection()
  composerConfiguration.markSubmitted()
  post('sendPrompt', {
    text,
    mode: 'queue',
    context: editorContext.input(),
    images: pastedImages.map(({ mediaType, data, name }) => ({
      mediaType,
      data,
      ...(name === undefined ? {} : { name }),
    })),
    ...(configuration === undefined ? {} : { configuration }),
  })
  editorContext.markSubmitted()
  elements.prompt.value = ''
  clearPastedImages()
  resizePrompt()
}

function resizePrompt() {
  elements.prompt.style.height = 'auto'
  elements.prompt.style.height = `${Math.min(elements.prompt.scrollHeight, 180)}px`
  if (payload) renderComposer(payload.state.active)
}

function toggleHistory(open) {
  if (open) pluginCenter.close()
  elements.historyPanel.classList.toggle('hidden', !open)
  if (open) {
    renderSessions()
    elements.historySearch.focus()
  }
}

function post(type, data = {}) {
  vscode.postMessage({ type, ...data })
}

function node(tag, className = '', text = '') {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text) element.textContent = text
  return element
}

function messageSignature(item) {
  return JSON.stringify(item)
}

function setMessageMetadata(element, id, signature) {
  element.dataset.messageId = id
  messageSignatures.set(element, signature)
}

/** Mutates only text inside the active assistant card for smooth token flow. */
function patchStreamingMessage(element, item) {
  if (item.kind !== 'message' || element.tagName !== 'ARTICLE') return false
  const body = element.querySelector('.message-body')
  if (!body) return false
  if (!streamingMessage.patch(body, item)) return false
  workDuration.update(element, item.status === 'running' ? undefined : item.workDuration)
  return true
}

function captureDisclosures(root) {
  const state = new Map()
  for (const details of disclosureElements(root)) state.set(details.dataset.disclosureKey || '', details.open)
  return state
}

function restoreDisclosures(root, state) {
  for (const details of disclosureElements(root)) {
    if (details.dataset.autoOpen === 'true') details.open = true
    else if (details.dataset.autoOpen === 'false') details.open = false
    else details.open = state.get(details.dataset.disclosureKey || '') === true
  }
}

function disclosureElements(root) {
  const descendants = [...root.querySelectorAll('details')]
  return root.tagName === 'DETAILS' ? [root, ...descendants] : descendants
}

function isNearBottom(element) {
  return element.scrollHeight - element.scrollTop - element.clientHeight < 100
}

function scrollConversationToBottom() {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      elements.conversation.scrollTop = elements.conversation.scrollHeight
    })
  })
}

function formatRelativeTime(time) {
  const delta = Date.now() - time
  if (delta < 60_000) return t('justNow')
  if (delta < 3_600_000) return t('minutesAgo', { count: Math.floor(delta / 60_000) })
  if (delta < 86_400_000) return t('hoursAgo', { count: Math.floor(delta / 3_600_000) })
  return new Date(time).toLocaleDateString()
}

function cssEscape(value) {
  return window.CSS?.escape ? window.CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, '\\$&')
}

function copyText(text) {
  if (navigator.clipboard?.writeText !== undefined) {
    navigator.clipboard.writeText(text).catch(() => legacyCopy(text))
  } else {
    legacyCopy(text)
  }
}

function legacyCopy(text) {
  const area = document.createElement('textarea')
  area.value = text
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.append(area)
  area.select()
  try {
    document.execCommand('copy')
  } catch {
    // Clipboard unavailable; the user can still select the text manually.
  }
  area.remove()
}

vscode.postMessage({ type: 'ready' })
