import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  classifyArchive,
  dshSessionJsonlPaths,
  extractSessionArchive,
  inspectSessionArchive,
} from '../src/import/session-archive.js'

describe('session archive ZIP', () => {
  it('classifies an official DSH export and extracts session.jsonl plus subagents', () => {
    const zip = buildZip([
      { name: 'session.jsonl', data: '{"type":"session","id":"root"}\n' },
      { name: 'subagents/child/session.jsonl', data: '{"type":"session","id":"child"}\n' },
      { name: 'media/pic.png', data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) },
    ])

    const inspected = inspectSessionArchive(zip)
    expect(inspected.kind).toBe('dsh-export')
    expect(dshSessionJsonlPaths(inspected.entries)).toEqual([
      'session.jsonl',
      'subagents/child/session.jsonl',
    ])

    const files = Object.fromEntries(extractSessionArchive(zip).map((entry) => [entry.name, new TextDecoder().decode(entry.data)]))
    expect(files['session.jsonl']).toContain('"id":"root"')
    expect(files['subagents/child/session.jsonl']).toContain('"id":"child"')

    const jsonlOnly = extractSessionArchive(zip, (name) => name.endsWith('session.jsonl'))
    expect(jsonlOnly.map((entry) => entry.name)).toEqual([
      'session.jsonl',
      'subagents/child/session.jsonl',
    ])
  })

  it('classifies a ChatGPT conversations.zip and extracts conversations.json', () => {
    const zip = buildZip([
      { name: 'conversations.json', data: '[{"title":"hello"}]' },
    ])

    expect(inspectSessionArchive(zip).kind).toBe('chatgpt-export')
    const [entry] = extractSessionArchive(zip)
    expect(entry?.name).toBe('conversations.json')
    expect(new TextDecoder().decode(entry?.data)).toBe('[{"title":"hello"}]')
  })

  it('rejects unknown zip layouts and unsafe paths', () => {
    expect(classifyArchive(['readme.txt'])).toBe('unknown')
    const zip = buildZip([{ name: '../escape.jsonl', data: 'nope' }])
    expect(() => extractSessionArchive(zip)).toThrow(/Unsafe ZIP entry path/)
  })
})

interface ZipSource {
  readonly name: string
  readonly data: string | Uint8Array
}

function buildZip(files: readonly ZipSource[]): Uint8Array {
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const file of files) {
    const name = new TextEncoder().encode(file.name)
    const payload = typeof file.data === 'string' ? new TextEncoder().encode(file.data) : file.data
    const compressed = deflateRawSync(payload)
    const local = new Uint8Array(30 + name.byteLength + compressed.byteLength)
    writeUint32(local, 0, 0x04034b50)
    writeUint16(local, 8, 8)
    writeUint32(local, 18, compressed.byteLength)
    writeUint32(local, 22, payload.byteLength)
    writeUint16(local, 26, name.byteLength)
    local.set(name, 30)
    local.set(compressed, 30 + name.byteLength)
    chunks.push(local)

    const record = new Uint8Array(46 + name.byteLength)
    writeUint32(record, 0, 0x02014b50)
    writeUint16(record, 10, 8)
    writeUint32(record, 20, compressed.byteLength)
    writeUint32(record, 24, payload.byteLength)
    writeUint16(record, 28, name.byteLength)
    writeUint32(record, 42, offset)
    record.set(name, 46)
    if (file.name.includes('..')) {
      // Keep the writer honest: the reader must reject this name.
    }
    central.push(record)
    offset += local.byteLength
  }
  const directory = concat(central)
  const eocd = new Uint8Array(22)
  writeUint32(eocd, 0, 0x06054b50)
  writeUint16(eocd, 8, files.length)
  writeUint16(eocd, 10, files.length)
  writeUint32(eocd, 12, directory.byteLength)
  writeUint32(eocd, 16, offset)
  return concat([...chunks, directory, eocd])
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.byteLength
  }
  return out
}

function writeUint16(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >> 8) & 0xff
}

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >> 8) & 0xff
  bytes[offset + 2] = (value >> 16) & 0xff
  bytes[offset + 3] = (value >> 24) & 0xff
}
