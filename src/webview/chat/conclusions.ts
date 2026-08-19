import type { ActiveSessionView } from '../../domain/workbench-state.js'

export interface ConclusionItem {
  readonly id: string
  readonly text: string
  readonly time: number
}

export function assistantConclusions(active: ActiveSessionView | undefined): ConclusionItem[] {
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

export function timelineSignature(active: ActiveSessionView | undefined): string {
  return assistantConclusions(active)
    .map((item) => `${item.id}:${item.text.slice(0, 200)}:${item.time}`)
    .join('|')
}
