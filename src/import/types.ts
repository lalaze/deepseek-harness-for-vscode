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
