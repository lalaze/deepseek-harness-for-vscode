import { describe, expect, it } from 'vitest'
import type { HistoryEntry } from '@deepseek-ai/dsh-host-apiproxy/api'
import { projectConversation } from '../src/domain/workbench-state.js'

describe('projectConversation', () => {
  it('projects durable messages, reasoning, tools and the latest todo snapshot', () => {
    const entries = [
      entry(0, 'user/message', {
        id: 'u1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '修复测试' }],
      }, 'append'),
      entry(1, 'assistant/message', {
        turn: 1, step: 1,
        message: {
          id: 'a1', role: 'assistant', source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-v4-flash' },
          content: [{ type: 'reasoning', text: '先定位' }, { type: 'text', text: '开始修改。' }],
        },
      }, 'append'),
      entry(2, 'tool/call', { turn: 1, step: 1, callId: 'c1', name: 'read_file', arguments: '{"path":"a.ts"}' }),
      entry(3, 'todo/write', { todos: [{ content: '运行测试', status: 'in_progress' }] }),
    ] as HistoryEntry[]

    const result = projectConversation(entries)
    expect(result.messages.map((message) => message.kind)).toEqual(['message', 'message', 'tool'])
    expect(result.messages[1]?.blocks).toEqual([
      { kind: 'reasoning', text: '先定位' },
      { kind: 'text', text: '开始修改。' },
    ])
    expect(result.todos).toEqual([{ content: '运行测试', status: 'in_progress' }])
  })

  it('shows streamed chunks only until their finalized assistant message exists', () => {
    const partial = [
      entry(0, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'block-start', index: 0, blockType: 'text' } }),
      entry(1, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: '流式' } }),
    ] as HistoryEntry[]
    expect(projectConversation(partial).messages[0]?.blocks).toEqual([{ kind: 'text', text: '流式' }])

    const finalized = [...partial, entry(2, 'assistant/message', {
      turn: 1, step: 1,
      message: {
        id: 'a1', role: 'assistant', source: { kind: 'model', provider: 'p', model: 'm' },
        content: [{ type: 'text', text: '最终' }],
      },
    }, 'append')] as HistoryEntry[]
    expect(projectConversation(finalized).messages).toHaveLength(1)
    expect(projectConversation(finalized).messages[0]?.blocks).toEqual([{ kind: 'text', text: '最终' }])
  })
})

function entry(seq: number, type: string, data: unknown, surfaceOp?: 'append'): unknown {
  return { event: { seq, time: seq + 1, type, data, ...(surfaceOp === undefined ? {} : { surfaceOp }) } }
}
