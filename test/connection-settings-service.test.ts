import { describe, expect, it, vi } from 'vitest'
import type { ConfigurationService } from '../src/config/configuration.js'
import { ConnectionSettingsService } from '../src/services/connection-settings-service.js'
import type { CredentialStore } from '../src/security/credential-store.js'

interface HarnessDocument {
  deepseek: { value: Record<string, unknown>; user: Record<string, unknown>; revision: number }
  piAi: { value: { providers: Record<string, Record<string, unknown>> }; user: { providers: Record<string, Record<string, unknown>> }; revision: number }
  credentials: Record<string, string>
}

describe('ConnectionSettingsService', () => {
  it('creates a live pi-ai route and stores its key write-only', async () => {
    const harness = fakeHarness()
    const service = serviceFor()
    await service.connect(harness.client as never)

    const route = await service.apply({
      provider: '__new__',
      name: 'PackyCode',
      baseUrl: 'https://relay.example.com/v1',
      apiKey: 'sk-secret',
      models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    })

    expect(route).toBe('packycode')
    expect(harness.document.piAi.value.providers.packycode).toMatchObject({
      displayName: 'PackyCode',
      baseURL: 'https://relay.example.com/v1',
      api: 'openai-completions',
      apiKeyEnv: 'PROVIDER_PACKYCODE_API_KEY',
      compat: {
        thinkingFormat: 'deepseek',
        supportsReasoningEffort: true,
        supportsDeveloperRole: false,
      },
    })
    expect(harness.document.credentials.PROVIDER_PACKYCODE_API_KEY).toBe('sk-secret')
    expect(service.state.providers.find((provider) => provider.id === 'packycode')).toEqual({
      id: 'packycode',
      name: 'PackyCode',
      baseUrl: 'https://relay.example.com/v1',
      models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
      visionModels: [],
      maxReasoningEffort: 'max',
      apiKeyConfigured: true,
      credentialWritable: true,
      removable: true,
    })
    expect(JSON.stringify(service.state)).not.toContain('sk-secret')
  })

  it('writes the endpoint-specific model ids a third-party provider exposes', async () => {
    const harness = fakeHarness()
    const service = serviceFor()
    await service.connect(harness.client as never)

    const route = await service.apply({
      provider: '__new__',
      name: 'Volcengine Ark',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      apiKey: 'ark-secret',
      models: ['deepseek-v3.1-250828', 'ep-20250417-xxxxx'],
    })

    expect(route).toBe('volcengine-ark')
    expect(harness.document.piAi.value.providers['volcengine-ark']!.models).toEqual([
      { id: 'deepseek-v3.1-250828', reasoningEfforts: { off: null, low: 'low', high: 'high', max: 'max' } },
      { id: 'ep-20250417-xxxxx', reasoningEfforts: { off: null, low: 'low', high: 'high', max: 'max' } },
    ])
    expect(service.state.providers.find((provider) => provider.id === 'volcengine-ark')?.models)
      .toEqual(['deepseek-v3.1-250828', 'ep-20250417-xxxxx'])
  })

  it('limits custom models to the selected maximum reasoning effort', async () => {
    const harness = fakeHarness()
    const service = serviceFor()
    await service.connect(harness.client as never)

    await service.apply({
      provider: '__new__',
      name: 'High Reasoning Relay',
      baseUrl: 'https://relay.example.com/v1',
      apiKey: 'sk-secret',
      models: ['custom-model'],
      maxReasoningEffort: 'high',
    })

    expect(harness.document.piAi.value.providers['high-reasoning-relay']!.models).toEqual([{
      id: 'custom-model',
      reasoningEfforts: { off: null, low: 'low', high: 'high' },
    }])
    expect(service.state.providers.find((provider) => provider.id === 'high-reasoning-relay')?.maxReasoningEffort)
      .toBe('high')
  })

  it('falls back to the DeepSeek defaults when a custom provider omits models', async () => {
    const harness = fakeHarness()
    const service = serviceFor()
    await service.connect(harness.client as never)

    const route = await service.apply({
      provider: '__new__',
      name: 'Plain Relay',
      baseUrl: 'https://relay.example.com/v1',
      apiKey: 'sk-secret',
      models: [],
    })

    expect(route).toBe('plain-relay')
    expect(harness.document.piAi.value.providers['plain-relay']!.models).toEqual([
      { id: 'deepseek-v4-flash', reasoningEfforts: { off: null, low: 'low', high: 'high', max: 'max' } },
      { id: 'deepseek-v4-pro', reasoningEfforts: { off: null, low: 'low', high: 'high', max: 'max' } },
      {
        id: 'deepseek-v4-flash-vision-exp',
        reasoningEfforts: { off: null, low: 'low', high: 'high', max: 'max' },
        input: ['text', 'image'],
      },
    ])
  })

  it('declares image input for a recognizable custom vision model', async () => {
    const harness = fakeHarness()
    const service = serviceFor()
    await service.connect(harness.client as never)

    await service.apply({
      provider: '__new__',
      name: 'Qwen Vision',
      baseUrl: 'https://relay.example.com/v1',
      apiKey: 'sk-secret',
      models: ['qwen27b-fp8-fp16kv-112K-mtp3-text-image-cu128'],
    })

    expect(harness.document.piAi.value.providers['qwen-vision']!.models).toEqual([{
      id: 'qwen27b-fp8-fp16kv-112K-mtp3-text-image-cu128',
      reasoningEfforts: { off: null, low: 'low', high: 'high', max: 'max' },
      input: ['text', 'image'],
    }])
    expect(service.state.providers.find((provider) => provider.id === 'qwen-vision')?.visionModels)
      .toEqual(['qwen27b-fp8-fp16kv-112K-mtp3-text-image-cu128'])
  })

  it('accepts an explicit image-input declaration for a model with an opaque id', async () => {
    const harness = fakeHarness()
    const service = serviceFor()
    await service.connect(harness.client as never)

    await service.apply({
      provider: '__new__',
      name: 'Opaque Vision',
      baseUrl: 'https://relay.example.com/v1',
      apiKey: 'sk-secret',
      models: ['deployment-20260824'],
      visionModels: ['deployment-20260824', 'not-in-the-model-list'],
    })

    expect(harness.document.piAi.value.providers['opaque-vision']!.models).toEqual([{
      id: 'deployment-20260824',
      reasoningEfforts: { off: null, low: 'low', high: 'high', max: 'max' },
      input: ['text', 'image'],
    }])
  })

  it('upgrades a recognizable stored vision model exactly once', async () => {
    const harness = fakeHarness({
      relay: {
        displayName: 'Relay',
        apiKeyEnv: 'PROVIDER_RELAY_API_KEY',
        api: 'openai-completions',
        baseURL: 'https://relay.example.com/v1',
        models: [{
          id: 'qwen27b-fp8-fp16kv-112K-mtp3-text-image-cu128',
          reasoningEfforts: { off: null, low: 'low', high: 'high', max: 'max' },
        }, {
          id: 'qwen-vl-text-only-deployment',
          input: ['text'],
          reasoningEfforts: { off: null, low: 'low', high: 'high', max: 'max' },
        }],
      },
    })
    const service = serviceFor()

    await service.connect(harness.client as never)

    expect(harness.document.piAi.value.providers.relay!['models']).toEqual([{
      id: 'qwen27b-fp8-fp16kv-112K-mtp3-text-image-cu128',
      reasoningEfforts: { off: null, low: 'low', high: 'high', max: 'max' },
      input: ['text', 'image'],
    }, {
      id: 'qwen-vl-text-only-deployment',
      input: ['text'],
      reasoningEfforts: { off: null, low: 'low', high: 'high', max: 'max' },
    }])
    const revision = harness.document.piAi.revision
    await service.connect(harness.client as never)
    expect(harness.document.piAi.revision).toBe(revision)
  })

  it('tops up the low reasoning effort on relays written by older builds', async () => {
    const harness = fakeHarness({
      'volcengine-ark': {
        displayName: 'Volcengine Ark',
        apiKeyEnv: 'PROVIDER_VOLCENGINE_ARK_API_KEY',
        api: 'openai-completions',
        baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
        compat: { thinkingFormat: 'deepseek', supportsReasoningEffort: true, supportsDeveloperRole: false },
        models: [
          { id: 'deepseek-v4-flash', reasoningEfforts: { off: null, high: 'high', max: 'max' } },
          { id: 'custom-model', reasoningEfforts: { off: null, high: 'high', max: 'custom-max' } },
          'plain-string-model',
        ],
      },
    })
    const service = serviceFor()
    await service.connect(harness.client as never)

    const models = harness.document.piAi.user.providers['volcengine-ark']!['models'] as unknown[]
    expect(models).toEqual([
      { id: 'deepseek-v4-flash', reasoningEfforts: { off: null, low: 'low', high: 'high', max: 'max' } },
      { id: 'custom-model', reasoningEfforts: { off: null, low: 'low', high: 'high', max: 'custom-max' } },
      'plain-string-model',
    ])

    // The heal is idempotent: a second connect must not write again.
    const revision = harness.document.piAi.revision
    await service.connect(harness.client as never)
    expect(harness.document.piAi.revision).toBe(revision)
  })


  it('keeps a stored key and unknown profile fields when editing with a blank key', async () => {
    const harness = fakeHarness({
      packycode: {
        displayName: 'PackyCode',
        baseURL: 'https://old.example/v1',
        api: 'openai-completions',
        apiKeyEnv: 'PROVIDER_PACKYCODE_API_KEY',
        headers: { 'x-route': 'preserved' },
        models: deepSeekModels(),
      },
    }, { PROVIDER_PACKYCODE_API_KEY: 'stored-secret' })
    const service = serviceFor()
    await service.connect(harness.client as never)

    await service.apply({
      provider: 'packycode',
      name: 'Packy Relay',
      baseUrl: 'https://new.example/v1',
      apiKey: '',
      models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    })

    expect(harness.document.credentials.PROVIDER_PACKYCODE_API_KEY).toBe('stored-secret')
    expect(harness.document.piAi.value.providers.packycode).toMatchObject({
      displayName: 'Packy Relay',
      baseURL: 'https://new.example/v1',
      headers: { 'x-route': 'preserved' },
    })
  })

  it('keeps the official stored key when Apply submits a blank password field', async () => {
    const harness = fakeHarness({}, { DEEPSEEK_API_KEY: 'official-secret' })
    const service = serviceFor()
    await service.connect(harness.client as never)

    await service.apply({
      provider: 'deepseek-official',
      name: '',
      baseUrl: 'https://api.deepseek.com',
      apiKey: '',
      models: [],
    })

    expect(harness.document.credentials.DEEPSEEK_API_KEY).toBe('official-secret')
  })

  it('persists a DeepSeek-compatible endpoint override on the built-in route', async () => {
    const harness = fakeHarness()
    const service = serviceFor()
    await service.connect(harness.client as never)

    const route = await service.apply({
      provider: 'deepseek-official',
      name: '',
      baseUrl: 'https://relay.example/v1',
      apiKey: 'relay-secret',
      models: [],
    })

    expect(route).toBe('deepseek-official')
    expect(harness.document.deepseek.value.baseURL).toBe('https://relay.example/v1')
    expect(harness.document.credentials.DEEPSEEK_API_KEY).toBe('relay-secret')
    expect(service.state.providers[0]?.baseUrl).toBe('https://relay.example/v1')
  })

  it('removes the custom profile and its managed credential', async () => {
    const harness = fakeHarness({
      packycode: {
        displayName: 'PackyCode',
        baseURL: 'https://relay.example/v1',
        api: 'openai-completions',
        apiKeyEnv: 'PROVIDER_PACKYCODE_API_KEY',
        models: deepSeekModels(),
      },
    }, { PROVIDER_PACKYCODE_API_KEY: 'stored-secret' })
    const service = serviceFor()
    await service.connect(harness.client as never)

    await service.remove('packycode')

    expect(harness.document.credentials.PROVIDER_PACKYCODE_API_KEY).toBeUndefined()
    expect(harness.document.piAi.value.providers.packycode).toBeUndefined()
    expect(service.state.providers.map((provider) => provider.id)).toEqual(['deepseek-official'])
  })

  it('keeps the credential when the profile deletion is rejected', async () => {
    const harness = fakeHarness({
      packycode: {
        displayName: 'PackyCode',
        baseURL: 'https://relay.example/v1',
        api: 'openai-completions',
        apiKeyEnv: 'PROVIDER_PACKYCODE_API_KEY',
        models: deepSeekModels(),
      },
    }, { PROVIDER_PACKYCODE_API_KEY: 'stored-secret' })
    const service = serviceFor()
    await service.connect(harness.client as never)

    // Simulate a stale-revision write: the profile deletion is refused before
    // the credential is ever touched.
    const settings = harness.client.settings as { mutate: () => Promise<unknown> }
    settings.mutate = () => Promise.resolve({ rpcId: 'test', result: { ok: false, error: { message: 'settings-conflict' } } })

    await expect(service.remove('packycode')).rejects.toThrow('settings-conflict')
    expect(harness.document.credentials.PROVIDER_PACKYCODE_API_KEY).toBe('stored-secret')
    expect(harness.document.piAi.value.providers.packycode).toBeDefined()
  })

  it('finishes migrating a legacy key when its provider profile already exists', async () => {
    const harness = fakeHarness({
      packycode: {
        displayName: 'PackyCode',
        baseURL: 'https://relay.example/v1',
        api: 'openai-completions',
        apiKeyEnv: 'PROVIDER_PACKYCODE_API_KEY',
        models: deepSeekModels(),
      },
    })
    const service = serviceFor([{
      name: 'PackyCode',
      baseUrl: 'https://relay.example/v1',
      apiKey: 'legacy-secret',
    }])

    await service.connect(harness.client as never)

    expect(harness.document.credentials.PROVIDER_PACKYCODE_API_KEY).toBe('legacy-secret')
    expect(service.state.providers.find((provider) => provider.id === 'packycode')?.apiKeyConfigured).toBe(true)
  })

  it('migrates a legacy third-party official override into a pi-ai relay route', async () => {
    const harness = fakeHarness()
    const service = serviceFor([], 'https://relay.example/v1', 'legacy-secret')

    await service.connect(harness.client as never)

    expect(harness.document.piAi.value.providers['imported-relay-example']).toMatchObject({
      displayName: 'Imported relay.example',
      baseURL: 'https://relay.example/v1',
      api: 'openai-completions',
      compat: { thinkingFormat: 'deepseek', supportsDeveloperRole: false },
    })
    expect(harness.document.credentials.PROVIDER_IMPORTED_RELAY_EXAMPLE_API_KEY).toBe('legacy-secret')
  })
})

function serviceFor(
  legacyProviders: { name: string; baseUrl: string; apiKey: string }[] = [],
  legacyBaseUrl?: string,
  legacyKey?: string,
): ConnectionSettingsService {
  const configuration = {
    get: vi.fn(() => ({ provider: 'deepseek-official' })),
    setProvider: vi.fn(async () => undefined),
    getLegacyProviders: vi.fn(() => legacyProviders),
    getLegacyBaseUrl: vi.fn(() => legacyBaseUrl),
    clearLegacyProviders: vi.fn(async () => undefined),
    clearLegacyBaseUrl: vi.fn(async () => undefined),
  } as unknown as ConfigurationService
  const credentials = {
    getApiKey: vi.fn(async () => legacyKey),
    clearApiKey: vi.fn(async () => undefined),
  } as unknown as CredentialStore
  return new ConnectionSettingsService(configuration, credentials)
}

function fakeHarness(
  providers: Record<string, Record<string, unknown>> = {},
  credentials: Record<string, string> = {},
): {
  document: HarnessDocument
  client: Record<string, unknown>
} {
  const document: HarnessDocument = {
    deepseek: { value: { apiKeyEnv: 'DEEPSEEK_API_KEY' }, user: {}, revision: 0 },
    piAi: {
      value: { providers: structuredClone(providers) },
      user: { providers: structuredClone(providers) },
      revision: 0,
    },
    credentials: { ...credentials },
  }
  const ok = <T>(value: T) => Promise.resolve({ rpcId: 'test', result: { ok: true as const, value } })
  const describeSettings = () => ({
    writable: true,
    hasDocument: true,
    namespaces: [
      { ns: 'llm-deepseek', schema: {}, value: document.deepseek.value, user: document.deepseek.user, applies: 'live', secrets: [], revision: document.deepseek.revision },
      { ns: 'llm-pi-ai', schema: {}, value: document.piAi.value, user: document.piAi.user, applies: 'live', secrets: [], revision: document.piAi.revision },
    ],
  })
  const client = {
    settings: {
      describe: () => ok(describeSettings()),
      mutate: (payload: { ns: string; ops: { op: 'set' | 'unset'; path: string[]; value?: unknown }[] }) => {
        const section = payload.ns === 'llm-pi-ai' ? document.piAi : document.deepseek
        for (const op of payload.ops) {
          mutate(section.value, op.path, op.op, op.value)
          mutate(section.user, op.path, op.op, op.value)
        }
        section.revision += 1
        return ok(describeSettings().namespaces.find((item) => item.ns === payload.ns))
      },
    },
    credentials: {
      describe: ({ refs }: { refs: string[] }) => ok({
        credentials: Object.fromEntries(refs.map((ref) => [ref, {
          configured: document.credentials[ref] !== undefined,
          writable: true,
          ...(document.credentials[ref] === undefined ? {} : { source: 'file' }),
        }])),
      }),
      set: ({ ref, value }: { ref: string; value: string }) => {
        document.credentials[ref] = value
        return ok({})
      },
      unset: ({ ref }: { ref: string }) => {
        delete document.credentials[ref]
        return ok({})
      },
    },
    llm: {
      providers: () => ok({ providers: [
        { provider: 'deepseek-official', displayName: 'DeepSeek Official', settingsNs: 'llm-deepseek', settingsPath: [], active: true },
        ...Object.entries(document.piAi.value.providers).map(([provider, profile]) => ({
          provider,
          displayName: String(profile.displayName ?? provider),
          settingsNs: 'llm-pi-ai',
          settingsPath: ['providers', provider],
          active: true,
          declared: true,
        })),
      ] }),
      models: () => ok({
        groups: [
          { id: 'deepseek-official', name: 'DeepSeek Official', models: deepSeekModels() },
          ...Object.entries(document.piAi.value.providers).map(([id, profile]) => ({
            id,
            name: id,
            models: Array.isArray(profile.models)
              ? profile.models.map((model) => ({ id: String((model as { id?: unknown })?.id ?? ''), name: id }))
              : deepSeekModels(),
          })),
        ],
        failures: [],
      }),
    },
  }
  return { document, client }
}

function deepSeekModels(): { id: string; name: string }[] {
  return [
    { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
    { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
  ]
}

function mutate(root: object, path: string[], op: 'set' | 'unset', value: unknown): void {
  let current = root as Record<string, unknown>
  for (const key of path.slice(0, -1)) {
    const next = current[key]
    if (typeof next === 'object' && next !== null && !Array.isArray(next)) current = next as Record<string, unknown>
    else current = current[key] = {} as Record<string, unknown>
  }
  const key = path.at(-1)
  if (key === undefined) return
  if (op === 'unset') delete current[key]
  else current[key] = structuredClone(value)
}
