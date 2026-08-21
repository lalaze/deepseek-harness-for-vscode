import type { HistoryEntry } from '@deepseek-ai/dsh-host-apiproxy/api'

export interface SessionFileChangeView {
  readonly path: string
  readonly added: number
  readonly removed: number
}

export interface SessionChangesView {
  readonly files: readonly SessionFileChangeView[]
  readonly added: number
  readonly removed: number
}

interface PendingChange {
  readonly path: string
  readonly added: number
  readonly removed: number
}

/**
 * Accumulates per-file line statistics from the edit-tool events in the
 * session history. A call is staged when it is seen and only booked once its
 * result arrives without an error, so failed or unanswered edits never count.
 * `write`/`create` report added lines only: the previous content is unknown.
 * Raw events remain the source of truth; this function is intentionally pure.
 */
export function projectSessionChanges(entries: readonly HistoryEntry[]): SessionChangesView | undefined {
  const pending = new Map<string, PendingChange>()
  const byPath = new Map<string, { added: number; removed: number }>()

  for (const { event } of entries) {
    if (event.type === 'tool/call') {
      const change = toolFileChange(event.data.name, event.data.arguments)
      if (change !== undefined) pending.set(String(event.data.callId), change)
    } else if (event.type === 'tool/result') {
      const callId = String(event.data.message.source.callId)
      const change = pending.get(callId)
      pending.delete(callId)
      if (change === undefined || event.data.error !== undefined) continue
      const file = byPath.get(change.path) ?? { added: 0, removed: 0 }
      byPath.set(change.path, { added: file.added + change.added, removed: file.removed + change.removed })
    }
  }

  if (byPath.size === 0) return undefined
  const files = [...byPath.entries()].map(([path, change]) => ({ path, ...change }))
  return {
    files,
    added: files.reduce((total, file) => total + file.added, 0),
    removed: files.reduce((total, file) => total + file.removed, 0),
  }
}

function toolFileChange(name: string, rawArguments: string): PendingChange | undefined {
  let args: unknown
  try {
    args = JSON.parse(rawArguments)
  } catch {
    return undefined
  }
  if (!isRecord(args)) return undefined

  if (name === 'edit') {
    if (typeof args.file_path !== 'string' || typeof args.old_string !== 'string' || typeof args.new_string !== 'string') {
      return undefined
    }
    return { path: args.file_path, added: countLines(args.new_string), removed: countLines(args.old_string) }
  }
  if (name === 'write') {
    if (typeof args.file_path !== 'string' || typeof args.content !== 'string') return undefined
    return { path: args.file_path, added: countLines(args.content), removed: 0 }
  }
  if (name === 'str_replace_editor') {
    if (typeof args.path !== 'string') return undefined
    if (args.command === 'create' && typeof args.file_text === 'string') {
      return { path: args.path, added: countLines(args.file_text), removed: 0 }
    }
    if (args.command === 'str_replace' && typeof args.old_str === 'string' && typeof args.new_str === 'string') {
      return { path: args.path, added: countLines(args.new_str), removed: countLines(args.old_str) }
    }
    if (args.command === 'insert' && typeof args.insert_text === 'string') {
      return { path: args.path, added: countLines(args.insert_text), removed: 0 }
    }
  }
  return undefined
}

/** Splits on `\n`; an empty string counts as zero lines. */
function countLines(text: string): number {
  return text === '' ? 0 : text.split('\n').length
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
