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

  it('extracts stored ZIP entries without deflate', () => {
    const zip = buildZip([{ name: 'session.jsonl', data: '{"type":"session"}\n', method: 0 }])
    const [entry] = extractSessionArchive(zip)
    expect(entry?.name).toBe('session.jsonl')
    expect(new TextDecoder().decode(entry?.data)).toBe('{"type":"session"}\n')
  })

  it('rejects unknown zip layouts and unsafe paths', () => {
    expect(classifyArchive(['readme.txt'])).toBe('unknown')
    const zip = buildZip([{ name: '../escape.jsonl', data: 'nope' }])
    expect(() => extractSessionArchive(zip)).toThrow(/Unsafe ZIP entry path/)
  })

  it('rejects forged stored-entry size metadata', () => {
    const zip = buildZip([{
      name: 'session.jsonl',
      data: '{"type":"session"}\n',
      method: 0,
      claimedUncompressedSize: 4,
    }])
    expect(() => extractSessionArchive(zip)).toThrow(/forged size metadata/)
  })

  it('bounds inflated output and cumulative extracted size', () => {
    const inflated = 'A'.repeat(64)
    const zip = buildZip([{ name: 'session.jsonl', data: inflated }])
    expect(() => extractSessionArchive(zip, undefined, { maxEntryBytes: 16 })).toThrow()

    const bulk = buildZip([
      { name: 'session.jsonl', data: 'abcdefghij', method: 0 },
      { name: 'subagents/child/session.jsonl', data: 'klmnopqrst', method: 0 },
    ])
    expect(() => extractSessionArchive(bulk, undefined, { maxTotalBytes: 12 })).toThrow(/extracted size is too large/)
  })
})

interface ZipSource {
  readonly name: string
  readonly data: string | Uint8Array
  readonly method?: 0 | 8
  readonly claimedUncompressedSize?: number
}

function buildZip(files: readonly ZipSource[]): Uint8Array {
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const file of files) {
    const method = file.method ?? 8
    const name = new TextEncoder().encode(file.name)
    const payload = typeof file.data === 'string' ? new TextEncoder().encode(file.data) : file.data
    const body = method === 0 ? payload : deflateRawSync(payload)
    const uncompressedSize = file.claimedUncompressedSize ?? payload.byteLength
    const local = new Uint8Array(30 + name.byteLength + body.byteLength)
    writeUint32(local, 0, 0x04034b50)
    writeUint16(local, 8, method)
    writeUint32(local, 18, body.byteLength)
    writeUint32(local, 22, uncompressedSize)
    writeUint16(local, 26, name.byteLength)
    local.set(name, 30)
    local.set(body, 30 + name.byteLength)
    chunks.push(local)

    const record = new Uint8Array(46 + name.byteLength)
    writeUint32(record, 0, 0x02014b50)
    writeUint16(record, 10, method)
    writeUint32(record, 20, body.byteLength)
    writeUint32(record, 24, uncompressedSize)
    writeUint16(record, 28, name.byteLength)
    writeUint32(record, 42, offset)
    record.set(name, 46)
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
