import { describe, expect, it } from 'vitest'
import type { HistoryEntry } from '@deepseek-ai/dsh-host-apiproxy/api'
import { projectSessionChanges } from '../src/domain/session-changes.js'

describe('projectSessionChanges', () => {
  it('counts edit replacements once the result succeeds', () => {
    const entries = [
      call(0, 'c1', 'edit', { file_path: 'src/app.ts', old_string: 'a\nb', new_string: 'a\nb\nc\nd' }),
      result(1, 'c1'),
    ]

    expect(projectSessionChanges(entries)).toEqual({
      files: [{ path: 'src/app.ts', added: 4, removed: 2 }],
      added: 4,
      removed: 2,
    })
  })

  it('reports write content as added lines only', () => {
    const entries = [
      call(0, 'c1', 'write', { file_path: 'notes.md', content: 'one\ntwo\nthree' }),
      result(1, 'c1'),
    ]

    expect(projectSessionChanges(entries)).toEqual({
      files: [{ path: 'notes.md', added: 3, removed: 0 }],
      added: 3,
      removed: 0,
    })
  })

  it('maps str_replace_editor commands to their text payloads', () => {
    const entries = [
      call(0, 'c1', 'str_replace_editor', { command: 'create', path: 'a.txt', file_text: 'x\ny' }),
      result(1, 'c1'),
      call(2, 'c2', 'str_replace_editor', { command: 'str_replace', path: 'a.txt', old_str: 'x', new_str: 'x\nz' }),
      result(3, 'c2'),
      call(4, 'c3', 'str_replace_editor', { command: 'insert', path: 'b.txt', insert_text: 'tail' }),
      result(5, 'c3'),
      call(6, 'c4', 'str_replace_editor', { command: 'view', path: 'b.txt' }),
      result(7, 'c4'),
    ]

    expect(projectSessionChanges(entries)).toEqual({
      files: [
        { path: 'a.txt', added: 4, removed: 1 },
        { path: 'b.txt', added: 1, removed: 0 },
      ],
      added: 5,
      removed: 1,
    })
  })

  it('rolls back staged calls whose result failed or never arrived', () => {
    const entries = [
      call(0, 'c1', 'edit', { file_path: 'a.ts', old_string: 'x', new_string: 'y\nz' }),
      result(1, 'c1', 'permission denied'),
      call(2, 'c2', 'write', { file_path: 'b.ts', content: 'new' }),
      call(3, 'c3', 'edit', { file_path: 'c.ts', old_string: '', new_string: 'ok' }),
      result(4, 'c3'),
    ]

    expect(projectSessionChanges(entries)).toEqual({
      files: [{ path: 'c.ts', added: 1, removed: 0 }],
      added: 1,
      removed: 0,
    })
  })

  it('ignores other tools, malformed arguments, and empty payloads', () => {
    const entries = [
      call(0, 'c1', 'bash', { command: 'echo hi > a.ts' }),
      result(1, 'c1'),
      call(2, 'c2', 'edit', { file_path: 'a.ts' }),
      result(3, 'c2'),
      entry(4, 'tool/call', { turn: 1, step: 1, callId: 'c3', name: 'write', arguments: '{broken' }),
      result(5, 'c3'),
      call(6, 'c4', 'edit', { file_path: 'a.ts', old_string: '', new_string: '' }),
      result(7, 'c4'),
    ]

    expect(projectSessionChanges(entries)).toEqual({
      files: [{ path: 'a.ts', added: 0, removed: 0 }],
      added: 0,
      removed: 0,
    })
  })

  it('returns nothing when the session has no successful edits', () => {
    expect(projectSessionChanges([])).toBeUndefined()
    expect(projectSessionChanges([
      call(0, 'c1', 'read_file', { path: 'a.ts' }),
      result(1, 'c1'),
    ])).toBeUndefined()
  })
})

function call(seq: number, callId: string, name: string, args: unknown): HistoryEntry {
  return entry(seq, 'tool/call', { turn: 1, step: 1, callId, name, arguments: JSON.stringify(args) })
}

function result(seq: number, callId: string, error?: string): HistoryEntry {
  return entry(seq, 'tool/result', {
    turn: 1,
    step: 1,
    ...(error === undefined ? {} : { error: { message: error } }),
    message: { id: `r-${callId}`, role: 'tool', source: { kind: 'tool', callId }, content: [{ type: 'text', text: 'done' }] },
  })
}

function entry(seq: number, type: string, data: unknown): HistoryEntry {
  return { event: { seq, time: seq + 1, type, data } } as HistoryEntry
}
