import { inflateRawSync } from 'node:zlib'

const LOCAL_HEADER = 0x04034b50
const CENTRAL_HEADER = 0x02014b50
const EOCD_HEADER = 0x06054b50
export const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024
export const MAX_ENTRY_BYTES = 128 * 1024 * 1024

export interface ExtractArchiveLimits {
  readonly maxArchiveBytes?: number
  readonly maxEntryBytes?: number
  readonly maxTotalBytes?: number
}

export type SessionArchiveKind = 'dsh-export' | 'chatgpt-export' | 'unknown'

export interface SessionArchiveEntry {
  readonly name: string
  readonly data: Uint8Array
}

export interface InspectedSessionArchive {
  readonly kind: SessionArchiveKind
  readonly entries: readonly string[]
}

/** Classifies a ZIP by its entry names without extracting payloads. */
export function inspectSessionArchive(bytes: Uint8Array): InspectedSessionArchive {
  const names = listZipNames(bytes)
  return { kind: classifyArchive(names), entries: names }
}

/** Extracts regular files from a ZIP into memory. */
export function extractSessionArchive(
  bytes: Uint8Array,
  keep?: (name: string) => boolean,
  limits: ExtractArchiveLimits = {},
): readonly SessionArchiveEntry[] {
  const maxArchiveBytes = limits.maxArchiveBytes ?? MAX_ARCHIVE_BYTES
  if (bytes.byteLength > maxArchiveBytes) {
    throw new Error(`Archive is too large (${bytes.byteLength} bytes).`)
  }
  return readZipEntries(bytes, keep, {
    maxEntryBytes: limits.maxEntryBytes ?? MAX_ENTRY_BYTES,
    maxTotalBytes: limits.maxTotalBytes ?? maxArchiveBytes,
  })
}

export function classifyArchive(names: readonly string[]): SessionArchiveKind {
  const normalized = names.map(normalizeZipPath)
  if (normalized.some((name) => name === 'session.jsonl' || name.endsWith('/session.jsonl'))) {
    return 'dsh-export'
  }
  if (normalized.some((name) => name === 'conversations.json' || name.endsWith('/conversations.json'))) {
    return 'chatgpt-export'
  }
  return 'unknown'
}

export function dshSessionJsonlPaths(names: readonly string[]): readonly string[] {
  return names.map(normalizeZipPath).filter((name) => name === 'session.jsonl' || name.endsWith('/session.jsonl'))
}

export function chatgptConversationsPath(names: readonly string[]): string | undefined {
  const normalized = names.map(normalizeZipPath)
  return normalized.find((name) => name === 'conversations.json')
    ?? normalized.find((name) => name.endsWith('/conversations.json'))
}

function listZipNames(bytes: Uint8Array): readonly string[] {
  return readCentralDirectory(bytes).map((entry) => entry.name)
}

function readZipEntries(
  bytes: Uint8Array,
  keep: ((name: string) => boolean) | undefined,
  limits: { readonly maxEntryBytes: number; readonly maxTotalBytes: number },
): readonly SessionArchiveEntry[] {
  const catalog = readCentralDirectory(bytes)
  const extracted: SessionArchiveEntry[] = []
  let total = 0
  for (const entry of catalog) {
    if (entry.name.endsWith('/')) continue
    const name = normalizeZipPath(entry.name)
    if (keep !== undefined && !keep(name)) continue
    const data = readLocalFile(bytes, entry, limits.maxEntryBytes)
    total += data.byteLength
    if (total > limits.maxTotalBytes) {
      throw new Error('Archive extracted size is too large.')
    }
    extracted.push({ name, data })
  }
  return extracted
}

interface CentralEntry {
  readonly name: string
  readonly method: number
  readonly compressedSize: number
  readonly uncompressedSize: number
  readonly localHeaderOffset: number
}

function readCentralDirectory(bytes: Uint8Array): readonly CentralEntry[] {
  const eocd = findEocd(bytes)
  const count = eocd.entryCount
  const entries: CentralEntry[] = []
  let offset = eocd.centralDirectoryOffset
  for (let index = 0; index < count; index += 1) {
    if (readUint32(bytes, offset) !== CENTRAL_HEADER) {
      throw new Error('Invalid ZIP central directory.')
    }
    const method = readUint16(bytes, offset + 10)
    const compressedSize = readUint32(bytes, offset + 20)
    const uncompressedSize = readUint32(bytes, offset + 24)
    const nameLength = readUint16(bytes, offset + 28)
    const extraLength = readUint16(bytes, offset + 30)
    const commentLength = readUint16(bytes, offset + 32)
    const localHeaderOffset = readUint32(bytes, offset + 42)
    const name = decodeZipName(bytes.subarray(offset + 46, offset + 46 + nameLength))
    if (name.includes('..') || name.startsWith('/') || name.includes('\\')) {
      throw new Error(`Unsafe ZIP entry path: ${name}`)
    }
    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

function readLocalFile(bytes: Uint8Array, entry: CentralEntry, maxEntryBytes: number): Uint8Array {
  if (readUint32(bytes, entry.localHeaderOffset) !== LOCAL_HEADER) {
    throw new Error(`Invalid ZIP local header for ${entry.name}.`)
  }
  const nameLength = readUint16(bytes, entry.localHeaderOffset + 26)
  const extraLength = readUint16(bytes, entry.localHeaderOffset + 28)
  const dataOffset = entry.localHeaderOffset + 30 + nameLength + extraLength
  if (dataOffset + entry.compressedSize > bytes.byteLength) {
    throw new Error(`ZIP entry is truncated: ${entry.name}`)
  }
  const compressed = bytes.subarray(dataOffset, dataOffset + entry.compressedSize)
  if (compressed.byteLength !== entry.compressedSize) {
    throw new Error(`ZIP entry is truncated: ${entry.name}`)
  }
  if (entry.method === 0) {
    if (compressed.byteLength > maxEntryBytes) {
      throw new Error(`ZIP entry is too large: ${entry.name}`)
    }
    if (entry.uncompressedSize !== compressed.byteLength) {
      throw new Error(`ZIP entry has forged size metadata: ${entry.name}`)
    }
    return compressed
  }
  if (entry.method === 8) {
    const data = inflateRawSync(compressed, { maxOutputLength: maxEntryBytes })
    if (data.byteLength > maxEntryBytes) {
      throw new Error(`ZIP entry is too large: ${entry.name}`)
    }
    return new Uint8Array(data)
  }
  throw new Error(`Unsupported ZIP compression method ${entry.method} in ${entry.name}.`)
}

function findEocd(bytes: Uint8Array): { readonly entryCount: number; readonly centralDirectoryOffset: number } {
  const min = Math.max(0, bytes.byteLength - 22 - 0xffff)
  for (let offset = bytes.byteLength - 22; offset >= min; offset -= 1) {
    if (readUint32(bytes, offset) !== EOCD_HEADER) continue
    const commentLength = readUint16(bytes, offset + 20)
    if (offset + 22 + commentLength !== bytes.byteLength) continue
    return {
      entryCount: readUint16(bytes, offset + 10),
      centralDirectoryOffset: readUint32(bytes, offset + 16),
    }
  }
  throw new Error('ZIP end-of-central-directory record was not found.')
}

function decodeZipName(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes)
}

function normalizeZipPath(name: string): string {
  return name.replace(/\\/gu, '/').replace(/^\.\//u, '')
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8)
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]!
    | (bytes[offset + 1]! << 8)
    | (bytes[offset + 2]! << 16)
    | (bytes[offset + 3]! << 24)
  ) >>> 0
}
