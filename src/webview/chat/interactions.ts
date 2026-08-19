import type { ActiveSessionView, PendingQuestionView } from '../../domain/workbench-state.js'
import { elements, node, post, setInteractionSignature, interactionSignature, t } from './context.js'
import { cssEscape } from './utils.js'

export function renderInteractions(active: ActiveSessionView | undefined): void {
  const nextSignature = JSON.stringify({
    sessionId: active?.id,
    approvals: active?.approvals || [],
    questions: active?.questions || [],
  })
  if (nextSignature === interactionSignature) return
  setInteractionSignature(nextSignature)
  const fragment = document.createDocumentFragment()
  for (const approval of active?.approvals || []) {
    const card = node('section', 'interaction-card warning')
    card.append(node('strong', '', t('approvalRequired', { tool: approval.toolName })))
    if (approval.reason) card.append(node('p', '', approval.reason))
    const actions = node('div', 'interaction-actions')
    const reject = node('button', 'secondary-button', t('reject')) as HTMLButtonElement
    reject.addEventListener('click', () => post('answerApproval', { key: approval.key, outcome: 'rejected' }))
    const allow = node('button', 'primary-button', t('allowOnce')) as HTMLButtonElement
    allow.addEventListener('click', () => post('answerApproval', { key: approval.key, outcome: 'allowed-once' }))
    actions.append(reject, allow)
    card.append(actions)
    fragment.append(card)
  }
  for (const pending of active?.questions || []) fragment.append(renderQuestions(pending))
  elements.interactions.replaceChildren(fragment)
}

function renderQuestions(pending: PendingQuestionView): HTMLElement {
  const form = node('form', 'interaction-card question-card') as HTMLFormElement
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
  const submit = node('button', 'primary-button', t('submitAnswer')) as HTMLButtonElement
  submit.type = 'submit'
  form.append(submit)
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const answers = pending.questions.map((question) => ({
      id: question.id,
      selected: Array.from(form.querySelectorAll<HTMLInputElement>(`[name="question-${cssEscape(question.id)}"]:checked`)).map((input) => input.value),
      custom: (form.querySelector(`[name="custom-${cssEscape(question.id)}"]`) as HTMLInputElement | null)?.value || undefined,
    }))
    post('answerQuestions', { key: pending.key, answers })
  })
  return form
}
