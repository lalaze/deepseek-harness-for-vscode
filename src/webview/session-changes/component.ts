import type { SessionChangesView, SessionFileChangeView } from '../../domain/session-changes.js'
import type { MessageArguments, WebviewMessageKey } from '../localization.js'

type Translate = (key: WebviewMessageKey, args?: MessageArguments) => string

export interface SessionChangesComponent {
  readonly update: (changes: SessionChangesView | undefined) => void
}

interface ComponentOptions {
  readonly document: Document
  readonly translate: Translate
  readonly onOpenFile: (path: string) => void
}

/**
 * Cursor-style collapsible summary of the lines the agent changed, docked
 * above the composer. "Keep All" dismisses the bar until further edits land;
 * the signature cache keeps streamed state updates from rebuilding the DOM.
 */
export function createSessionChangesComponent(options: ComponentOptions): SessionChangesComponent {
  const root = requiredElement(options.document, 'changes-bar')
  let current: SessionChangesView | undefined
  let signature = ''
  let dismissedSignature = ''
  let expanded = false

  const stats = (added: number, removed: number): HTMLElement[] => [
    node(options.document, 'span', 'changes-added', `+${added}`),
    node(options.document, 'span', 'changes-removed', `−${removed}`),
  ]

  const render = (): void => {
    root.textContent = ''
    if (current === undefined) return
    const summary = node(options.document, 'button', 'changes-summary') as HTMLButtonElement
    summary.type = 'button'
    summary.setAttribute('aria-expanded', String(expanded))
    summary.append(
      node(options.document, 'span', 'changes-glyph', '📄'),
      node(options.document, 'span', 'changes-count', `${current.files.length} ${options.translate('changesChanged')}`),
      ...stats(current.added, current.removed),
      node(options.document, 'span', 'changes-chevron', '⌃'),
    )
    summary.addEventListener('click', () => {
      expanded = !expanded
      render()
    })
    root.append(summary)
    root.classList.toggle('expanded', expanded)
    if (!expanded) return

    const detail = node(options.document, 'div', 'changes-detail')
    const header = node(options.document, 'div', 'changes-detail-header')
    header.append(node(options.document, 'span', 'changes-detail-title', `${current.files.length} ${options.translate('changesFiles')}`))
    const keepAll = node(options.document, 'button', 'changes-keep-all', options.translate('changesKeepAll')) as HTMLButtonElement
    keepAll.type = 'button'
    keepAll.addEventListener('click', () => {
      dismissedSignature = signature
      expanded = false
      root.classList.add('hidden')
    })
    header.append(keepAll)
    detail.append(header)
    for (const file of current.files) detail.append(fileRow(options, file))
    root.append(detail)
  }

  return {
    update: (changes) => {
      const nextSignature = JSON.stringify(changes ?? null)
      if (nextSignature === signature) return
      signature = nextSignature
      current = changes ?? undefined
      if (current === undefined || signature === dismissedSignature) {
        expanded = false
        root.classList.add('hidden')
        return
      }
      root.classList.remove('hidden')
      render()
    },
  }
}

function fileRow(options: ComponentOptions, file: SessionFileChangeView): HTMLElement {
  const row = node(options.document, 'div', 'changes-file')
  row.setAttribute('role', 'link')
  row.tabIndex = 0
  row.title = file.path
  const basename = file.path.split(/[\\/]/u).pop() ?? file.path
  row.append(
    node(options.document, 'span', 'changes-file-icon', fileExtension(basename)),
    node(options.document, 'span', 'changes-file-path', file.path),
    node(options.document, 'span', 'changes-added', `+${file.added}`),
    node(options.document, 'span', 'changes-removed', `−${file.removed}`),
  )
  const open = (): void => options.onOpenFile(file.path)
  row.addEventListener('click', open)
  row.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      open()
    }
  })
  return row
}

function fileExtension(basename: string): string {
  const dot = basename.lastIndexOf('.')
  return dot <= 0 ? '·' : basename.slice(dot + 1).slice(0, 4)
}

function node(document: Document, tag: string, className = '', text = ''): HTMLElement {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text) element.textContent = text
  return element
}

function requiredElement(document: Document, id: string): HTMLElement {
  const element = document.getElementById(id)
  if (element === null) throw new Error(`Missing session changes element: ${id}`)
  return element
}
