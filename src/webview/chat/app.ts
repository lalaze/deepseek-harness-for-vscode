import type { ChatBlock, HarnessWorkbenchState } from '../../domain/workbench-state.js'
import { closeCommandMenu, updateCommandMenu } from './command-menu.js'
import { renderComposer, renderActivityStatus, renderQueued, resizePrompt } from './composer-core.js'
import {
  components,
  elements,
  optimisticBubbles,
  optimisticSeq,
  pastedImages,
  payload,
  post,
  setOptimisticBubbles,
  setOptimisticSeq,
  setStartupComplete,
  startupComplete,
  t,
} from './context.js'
import { renderDetails } from './details.js'
import { clearPastedImages } from './images.js'
import { renderInteractions } from './interactions.js'
import { renderMessages } from './messages.js'
import { renderSelectors, renderSessions } from './sessions.js'
import { closeTimeline, renderTimelinePanel } from './timeline.js'
import { scrollConversationToBottom } from './utils.js'

export function render(): void {
  if (!payload) return
  const { state } = payload
  const active = state.active
  components.editorContext.setAutoAttach(payload.configuration?.autoAttachSelection === true)
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
  renderQueued(active)
  updateCommandMenu()
  components.connectionSettings.update(
    payload.connectionSettings ?? { writable: false, providers: [] },
    payload.configuration?.provider ?? 'deepseek-official',
    active?.model?.provider,
  )
  if (!elements.timelinePanel.classList.contains('hidden')) renderTimelinePanel()
  if (!startupComplete && state.phase === 'connected') {
    setStartupComplete(true)
    renderPhase(state)
    scrollConversationToBottom()
  }
}

export function renderPhase(state: HarnessWorkbenchState): void {
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

export function sendPrompt(): void {
  closeCommandMenu()
  closeTimeline()
  components.fileMention.close()
  components.composerConfiguration.close()
  const text = elements.prompt.value.trim()
  if (!text && pastedImages.length === 0) return
  const configuration = components.composerConfiguration.selection()
  components.composerConfiguration.markSubmitted()
  post('sendPrompt', {
    text,
    mode: 'queue',
    context: components.editorContext.input(),
    images: pastedImages.map(({ mediaType, data, name }) => ({
      mediaType,
      data,
      ...(name === undefined ? {} : { name }),
    })),
    ...(configuration === undefined ? {} : { configuration }),
  })
  components.editorContext.markSubmitted()
  // Optimistic echo: render the user bubble immediately so the conversation
  // does not sit empty while the harness admits the prompt and starts the
  // turn. Queued follow-ups (turn already running) stay in the QueueDock.
  if (!payload?.state?.active?.running) {
    const nextSeq = optimisticSeq + 1
    setOptimisticSeq(nextSeq)
    const blocks: ChatBlock[] = [
      ...(text === '' ? [] : [{ kind: 'text' as const, text }]),
      ...pastedImages.map(() => ({ kind: 'image' as const, text: t('imageAttachment') })),
    ]
    setOptimisticBubbles([...optimisticBubbles, {
      id: `optimistic-${nextSeq}`,
      seq: 0,
      kind: 'message',
      role: 'user',
      time: Date.now(),
      text,
      imageCount: pastedImages.length,
      blocks,
    }])
  }
  elements.prompt.value = ''
  clearPastedImages()
  resizePrompt()
  if (optimisticBubbles.length > 0) renderMessages(payload?.state.active)
}
