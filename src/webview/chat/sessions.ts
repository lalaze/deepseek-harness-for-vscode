import type { ActiveSessionView } from '../../domain/workbench-state.js'
import { composerConfigurationInput } from '../composer-configuration/adapter.js'
import { permissionSelectOptions } from '../permission/adapter.js'
import { clearPastedImages } from './images.js'
import { closeTimeline } from './timeline.js'
import {
  components,
  elements,
  node,
  payload,
  post,
  searchResults,
  selectorSignature,
  setSelectorSignature,
  t,
} from './context.js'
import { formatRelativeTime } from './utils.js'

export function renderSessions(): void {
  if (!payload) return
  const query = elements.historySearch.value.trim()
  const snippets = new Map(searchResults.map((result) => [result.sessionId, result.snippet]))
  const resultIds = new Set(searchResults.map((result) => result.sessionId))
  const sessions = query === '' ? payload.state.sessions : payload.state.sessions.filter((session) => resultIds.has(session.id))
  const fragment = document.createDocumentFragment()
  for (const session of sessions) {
    const button = node('button', 'session-row') as HTMLButtonElement
    if (session.id === payload.state.active?.id) button.classList.add('active')
    const top = node('span', 'session-row-top')
    top.append(node('span', 'session-name', session.title), node('span', `running-dot${session.running ? ' active' : ''}`))
    const meta = node('span', 'session-meta', formatRelativeTime(session.updatedAt))
    if (session.agentPreset) meta.append(` · ${session.agentPreset}`)
    button.append(top, meta)
    const snippet = snippets.get(session.id)
    if (snippet) button.append(node('span', 'session-snippet', snippet))
    button.addEventListener('click', () => {
      components.composerConfiguration.reset()
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

export function renderSelectors(active: ActiveSessionView | undefined): void {
  if (!payload) return
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
  setSelectorSignature(nextSignature)
  components.composerConfiguration.update(composerConfigurationInput(payload))
  const permissions = active?.permissions
  if (permissions) {
    replaceOptions(elements.permission, permissionSelectOptions(permissions), permissions.currentValue)
    elements.permission.classList.remove('hidden')
    elements.permission.disabled = active.running || payload.state.phase !== 'connected'
  } else {
    elements.permission.classList.add('hidden')
  }
}

function replaceOptions(
  select: HTMLSelectElement,
  options: readonly { readonly id: string; readonly label?: string; readonly name?: string; readonly description?: string; readonly disabled?: boolean }[],
  selected: string,
): void {
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

export function toggleHistory(open: boolean): void {
  if (open) components.pluginCenter.close()
  elements.historyPanel.classList.toggle('hidden', !open)
  if (open) {
    renderSessions()
    elements.historySearch.focus()
  }
}
