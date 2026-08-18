import type { ActiveSessionView, PermissionView } from '../../domain/workbench-state.js'
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
    renderPermissionOptions(permissions)
    elements.permission.classList.remove('hidden')
    elements.permissionToggle.disabled = active?.running === true || payload.state.phase !== 'connected'
  } else {
    elements.permission.classList.add('hidden')
    closePermissionPopup()
  }
}

function renderPermissionOptions(permissions: PermissionView): void {
  const options = permissionSelectOptions(permissions)
  const selected = options.find((option) => option.id === permissions.currentValue)
  elements.permissionToggleLabel.textContent = selected?.label ?? permissions.currentValue
  const fragment = document.createDocumentFragment()
  for (const item of options) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `permission-option${item.id === permissions.currentValue ? ' active' : ''}`
    button.setAttribute('role', 'option')
    button.setAttribute('aria-selected', String(item.id === permissions.currentValue))
    button.title = item.description || ''
    const label = document.createElement('span')
    label.className = 'permission-option-label'
    label.textContent = item.label || item.id
    button.append(label)
    const check = document.createElement('span')
    check.className = 'permission-option-check'
    check.textContent = item.id === permissions.currentValue ? '✓' : ''
    button.append(check)
    if (item.disabled) {
      button.disabled = true
    } else {
      button.addEventListener('click', () => {
        post('setPermission', { value: item.id })
        closePermissionPopup()
      })
    }
    fragment.append(button)
  }
  elements.permissionOptions.replaceChildren(fragment)
}

export function togglePermissionPopup(): void {
  if (elements.permissionPopup.classList.contains('hidden')) openPermissionPopup()
  else closePermissionPopup()
}

function openPermissionPopup(): void {
  if (elements.permissionToggle.disabled) return
  elements.permissionPopup.classList.remove('hidden')
  elements.permissionToggle.classList.add('active')
  elements.permissionToggle.setAttribute('aria-expanded', 'true')
}

export function closePermissionPopup(): void {
  elements.permissionPopup.classList.add('hidden')
  elements.permissionToggle.classList.remove('active')
  elements.permissionToggle.setAttribute('aria-expanded', 'false')
}

export function toggleHistory(open: boolean): void {
  if (open) components.pluginCenter.close()
  elements.historyPanel.classList.toggle('hidden', !open)
  if (open) {
    renderSessions()
    elements.historySearch.focus()
  }
}
