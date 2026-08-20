/** Discovery row returned by dsh-chat-import's `/api-import/sessions`. */
export interface ImportDiscoveryItem {
  readonly source?: string
  readonly format?: string
  readonly sessionId: string
  readonly title: string | null
  readonly project: string | null
  readonly sourcePath: string
  readonly createdAt: number | null
  readonly lastActiveAt: number | null
  readonly messageCount: number | null
  readonly importStatus?: string
}

export interface ImportDiscoverRequest {
  readonly source?: string
  readonly path?: string
  readonly query?: string
}

export interface ImportDiscoverResult {
  readonly ok: boolean
  readonly sessions: readonly ImportDiscoveryItem[]
  readonly total: number
  readonly error?: string
}

export interface ImportRequestItem {
  readonly source: string
  readonly sourcePath: string
  readonly sessionId?: string
}

export interface ImportRequest {
  readonly items: readonly ImportRequestItem[]
  readonly force?: boolean
}

export interface ImportResultItem {
  readonly sourcePath: string
  readonly format: string
  readonly mode?: string
  readonly status?: string
  readonly sessionId?: string
  readonly turns?: number
  readonly messages?: number
  readonly alreadyImported?: boolean
  readonly error?: string
  readonly skipReason?: string
}

export interface ImportResult {
  readonly ok: boolean
  readonly results: readonly ImportResultItem[]
  readonly error?: string
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

function readNullableString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  if (value === null || value === undefined) return null
  return typeof value === 'string' ? value : null
}

function readNullableNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function failedImportMessage(record: Record<string, unknown> | undefined): string {
  const error = record === undefined ? undefined : readString(record, 'error')
  return error ?? 'Import API failed.'
}

function readDiscoveryItem(value: unknown): ImportDiscoveryItem {
  const record = asObject(value)
  const sourcePath = record === undefined ? undefined : readString(record, 'sourcePath')
  if (record === undefined || sourcePath === undefined) {
    throw new Error('invalid sessions payload')
  }
  return {
    ...(readOptionalString(record, 'source')),
    ...(readOptionalString(record, 'format')),
    sessionId: readString(record, 'sessionId') ?? '',
    title: readNullableString(record, 'title'),
    project: readNullableString(record, 'project'),
    sourcePath,
    createdAt: readNullableNumber(record, 'createdAt'),
    lastActiveAt: readNullableNumber(record, 'lastActiveAt'),
    messageCount: readNullableNumber(record, 'messageCount'),
    ...(readOptionalString(record, 'importStatus')),
  }
}

function readResultItem(value: unknown): ImportResultItem {
  const record = asObject(value)
  const sourcePath = record === undefined ? undefined : readString(record, 'sourcePath')
  if (record === undefined || sourcePath === undefined) {
    throw new Error('invalid results payload')
  }
  const turns = readNullableNumber(record, 'turns')
  const messages = readNullableNumber(record, 'messages')
  const alreadyImported = record.alreadyImported
  return {
    sourcePath,
    format: readString(record, 'format') ?? '',
    ...(readOptionalString(record, 'mode')),
    ...(readOptionalString(record, 'status')),
    ...(readOptionalString(record, 'sessionId')),
    ...(turns === null ? {} : { turns }),
    ...(messages === null ? {} : { messages }),
    ...(typeof alreadyImported === 'boolean' ? { alreadyImported } : {}),
    ...(readOptionalString(record, 'error')),
    ...(readOptionalString(record, 'skipReason')),
  }
}

function readOptionalString(
  record: Record<string, unknown>,
  key: string,
): Record<string, string> {
  const value = readString(record, key)
  return value === undefined ? {} : { [key]: value }
}

/** Narrows `/api-import/sessions` JSON to a typed envelope. */
export function parseImportDiscoverResult(value: unknown): ImportDiscoverResult {
  const record = asObject(value)
  if (record === undefined) throw new Error('invalid JSON payload')
  if (record.ok === false) throw new Error(failedImportMessage(record))
  if (record.ok !== true || !Array.isArray(record.sessions)) {
    throw new Error('missing sessions')
  }
  const error = readString(record, 'error')
  return {
    ok: true,
    sessions: record.sessions.map(readDiscoveryItem),
    total: typeof record.total === 'number' && Number.isFinite(record.total)
      ? record.total
      : record.sessions.length,
    ...(error === undefined ? {} : { error }),
  }
}

/** Narrows `/api-import/import` JSON to a typed envelope. */
export function parseImportResult(value: unknown): ImportResult {
  const record = asObject(value)
  if (record === undefined) throw new Error('invalid JSON payload')
  if (record.ok === false) throw new Error(failedImportMessage(record))
  if (record.ok !== true || !Array.isArray(record.results)) {
    throw new Error('missing results')
  }
  const error = readString(record, 'error')
  return {
    ok: true,
    results: record.results.map(readResultItem),
    ...(error === undefined ? {} : { error }),
  }
}
