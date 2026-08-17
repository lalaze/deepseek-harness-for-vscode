/** Redacted provider settings sent to the webview. API keys never travel back. */
export interface ConnectionProviderView {
  readonly id: string
  readonly name: string
  readonly baseUrl: string
  /** Model ids this provider's profile exposes; empty means the defaults. */
  readonly models: readonly string[]
  readonly apiKeyConfigured: boolean
  readonly credentialWritable: boolean
  readonly removable: boolean
}

export interface ConnectionSettingsState {
  readonly writable: boolean
  readonly providers: readonly ConnectionProviderView[]
}

export interface ConnectionSettingsInput {
  readonly provider: string
  readonly name: string
  readonly baseUrl: string
  /** Write-only. Blank means keep the currently stored credential. */
  readonly apiKey: string
  /**
   * Model ids the custom endpoint actually exposes. Only meaningful for
   * custom relay providers; the built-in official route ignores it. Empty
   * falls back to the extension's DeepSeek defaults.
   */
  readonly models: readonly string[]
}

export type ConnectionTestStatus = 'success' | 'unreachable' | 'unsupported'

export interface ConnectionTestResult {
  readonly status: ConnectionTestStatus
  readonly detail?: string
  readonly modelCount?: number
}

export const NEW_PROVIDER = '__new__'

