import * as vscode from 'vscode'
import {
  AGENT_PRESET_OPTIONS,
  MODEL_OPTIONS,
  REASONING_OPTIONS,
  agentPresetId,
  modelId,
  reasoningEffort,
  type AgentPresetId,
  type ModelId,
  type ReasoningEffort,
} from '../domain/options.js'
import {
  isPermissionPresetId,
  permissionPresetId,
  type PermissionPresetId,
} from '../domain/permissions.js'
import {
  DEEPSEEK_OFFICIAL_PROVIDER,
  providerRoute,
  type CustomProvider,
} from '../domain/provider.js'

export type PermissionMode = PermissionPresetId

/** Immutable settings used by the bundled official Harness Web runtime. */
export interface HarnessConfiguration {
  readonly model: string
  /** Whether model and provider were persisted together by this extension. */
  readonly modelSelectionConfigured: boolean
  readonly reasoningEffort: ReasoningEffort
  readonly agentPreset: AgentPresetId
  readonly provider: string
  readonly permissionMode: PermissionMode
  /** Whether the built-in DeepSeek web-search provider stays enabled. */
  readonly webSearch: boolean
  /** Auto-attach the active editor selection as context when sending. */
  readonly autoAttachSelection: boolean
}

/** Reads extension settings and reports changes that require a runtime restart. */
export class ConfigurationService implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<HarnessConfiguration>()
  private readonly subscription: vscode.Disposable

  readonly onDidChange = this.changeEmitter.event

  constructor(private readonly globalState: vscode.Memento) {
    this.subscription = vscode.workspace.onDidChangeConfiguration((event) => {
      if (RUNTIME_SETTING_KEYS.some((key) => event.affectsConfiguration(key))) {
        this.changeEmitter.fire(this.get())
      }
    })
  }

  get(): HarnessConfiguration {
    const config = vscode.workspace.getConfiguration('deepseekHarness')
    const provider = nonEmpty(config.get<string>('provider'), DEEPSEEK_OFFICIAL_PROVIDER)
    const remembered = rememberedModelSelection(this.globalState.get(LAST_MODEL_SELECTION_KEY))
    const rememberedForProvider = remembered?.provider === provider ? remembered : undefined

    return {
      model: rememberedForProvider?.model ?? modelId(config.get<string>('model')),
      modelSelectionConfigured: provider === DEEPSEEK_OFFICIAL_PROVIDER || rememberedForProvider !== undefined,
      reasoningEffort: reasoningEffort(config.get<string>('reasoningEffort')),
      agentPreset: agentPresetId(config.get<string>('agentPreset')),
      provider,
      permissionMode: permissionMode(config.get<string>('permissionMode')),
      webSearch: config.get<boolean>('webSearch', true),
      autoAttachSelection: config.get<boolean>('autoAttachSelection', true),
    }
  }

  /** Persists sidebar selections in the local VS Code user settings file. */
  setModel(value: ModelId): Thenable<void> {
    return this.update('model', value)
  }

  setReasoningEffort(value: ReasoningEffort): Thenable<void> {
    return this.update('reasoningEffort', value)
  }

  setAgentPreset(value: AgentPresetId): Thenable<void> {
    return this.update('agentPreset', value)
  }

  setPermissionMode(value: PermissionMode): Thenable<void> {
    return this.update('permissionMode', value)
  }

  setProvider(value: string): Thenable<void> {
    return this.update('provider', value)
  }

  async setProviderIfConfigured(value: string): Promise<void> {
    // The Gateway has already resolved this provider/model pair before this
    // persistence hook runs. DSH's live provider directory is the authority;
    // the legacy VS Code providers array is intentionally not consulted.
    if (value.trim() !== '' && this.get().provider !== value) await this.setProvider(value)
  }

  /** Persists one resolved provider/model pair without restricting custom model IDs. */
  async setModelSelection(provider: string, model: string): Promise<void> {
    const normalizedProvider = provider.trim()
    const normalizedModel = model.trim()
    if (normalizedProvider === '' || normalizedModel === '') return
    await this.globalState.update(LAST_MODEL_SELECTION_KEY, {
      provider: normalizedProvider,
      model: normalizedModel,
    } satisfies RememberedModelSelection)
    await this.setProviderIfConfigured(normalizedProvider)
    await this.setModelIfKnown(normalizedModel)
  }

  /** Repairs selections saved by builds that persisted a custom provider without its model. */
  async recoverModelSelection(provider: string, model: string): Promise<void> {
    const current = this.get()
    if (current.modelSelectionConfigured || current.provider !== provider.trim()) return
    const normalizedModel = model.trim()
    if (normalizedModel === '') return
    await this.globalState.update(LAST_MODEL_SELECTION_KEY, {
      provider: current.provider,
      model: normalizedModel,
    } satisfies RememberedModelSelection)
  }

  /** Reads the pre-control-plane provider array for one-time migration only. */
  getLegacyProviders(): CustomProvider[] {
    const raw = vscode.workspace.getConfiguration('deepseekHarness').get<unknown>('providers')
    if (!Array.isArray(raw)) return []
    const providers: CustomProvider[] = []
    const routes = new Set<string>([DEEPSEEK_OFFICIAL_PROVIDER])
    for (const item of raw) {
      if (typeof item !== 'object' || item === null) continue
      const record = item as Record<string, unknown>
      const name = typeof record.name === 'string' ? record.name.trim() : ''
      const baseUrl = typeof record.baseUrl === 'string' ? record.baseUrl.trim() : ''
      const apiKey = typeof record.apiKey === 'string' ? record.apiKey.trim() : ''
      if (name === '' || baseUrl === '' || apiKey === '') continue
      const route = providerRoute(name)
      if (routes.has(route)) continue
      routes.add(route)
      providers.push({ name, baseUrl, apiKey })
    }
    return providers
  }

  /** Reads the pre-control-plane DeepSeek endpoint override for migration. */
  getLegacyBaseUrl(): string | undefined {
    const value = vscode.workspace.getConfiguration('deepseekHarness').get<string>('baseUrl', '').trim()
    return value === '' ? undefined : value
  }

  clearLegacyProviders(): Thenable<void> {
    return vscode.workspace.getConfiguration('deepseekHarness')
      .update('providers', undefined, vscode.ConfigurationTarget.Global)
  }

  clearLegacyBaseUrl(): Thenable<void> {
    return vscode.workspace.getConfiguration('deepseekHarness')
      .update('baseUrl', undefined, vscode.ConfigurationTarget.Global)
  }

  /** Persist a Gateway-owned model only when it is part of this extension's supported defaults. */
  async setModelIfKnown(value: string): Promise<void> {
    if (MODEL_OPTIONS.some((option) => option.id === value)) await this.setModel(value as ModelId)
  }

  async setReasoningEffortIfKnown(value: string): Promise<void> {
    if (REASONING_OPTIONS.some((option) => option.id === value)) {
      await this.setReasoningEffort(value as ReasoningEffort)
    }
  }

  async setAgentPresetIfKnown(value: string): Promise<void> {
    if (AGENT_PRESET_OPTIONS.some((option) => option.id === value)) {
      await this.setAgentPreset(value as AgentPresetId)
    }
  }

  async setPermissionModeIfKnown(value: string): Promise<void> {
    if (isPermissionPresetId(value)) await this.setPermissionMode(value)
  }

  dispose(): void {
    this.subscription.dispose()
    this.changeEmitter.dispose()
  }


  private update(key: string, value: string): Thenable<void> {
    return vscode.workspace.getConfiguration('deepseekHarness')
      .update(key, value, vscode.ConfigurationTarget.Global)
  }
}

const RUNTIME_SETTING_KEYS = [
  'deepseekHarness.model',
  'deepseekHarness.reasoningEffort',
  'deepseekHarness.agentPreset',
  'deepseekHarness.provider',
  'deepseekHarness.permissionMode',
  'deepseekHarness.webSearch',
] as const

const LAST_MODEL_SELECTION_KEY = 'deepseekHarness.lastModelSelection.v1'

interface RememberedModelSelection {
  readonly provider: string
  readonly model: string
}

function rememberedModelSelection(value: unknown): RememberedModelSelection | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const provider = typeof record['provider'] === 'string' ? record['provider'].trim() : ''
  const model = typeof record['model'] === 'string' ? record['model'].trim() : ''
  return provider === '' || model === '' ? undefined : { provider, model }
}

function nonEmpty(value: string | undefined, fallback: string): string {
  const normalized = value?.trim()
  return normalized === undefined || normalized === '' ? fallback : normalized
}

function permissionMode(value: string | undefined): PermissionMode {
  return permissionPresetId(value)
}
