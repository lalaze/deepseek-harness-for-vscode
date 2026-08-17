import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { renderOverlay } from '../src/runtime/runtime-overlay.js'

const require = createRequire(import.meta.url)
const { load } = require('js-yaml') as { load: (input: string) => unknown }

describe('Harness Web profile overlay', () => {
  it('projects only extension-owned runtime defaults', () => {
    const overlay = renderOverlay({
      model: 'deepseek-v4-pro',
      reasoningEffort: 'max',
      agentPreset: 'code',
      provider: 'packycode',
      permissionMode: 'workspace-write',
      webSearch: true,
      autoAttachSelection: true,
    }, '/extension/dist/runtime/gateway-runtime.mjs')
    expect(overlay).toContain('id: web-runtime')
    expect(overlay).toContain('disabled: true')
    expect(overlay).toContain('id: vscode-gateway-runtime')
    expect(overlay).toContain(`name: ${JSON.stringify(pathToFileURL('/extension/dist/runtime/gateway-runtime.mjs').href)}`)
    expect(overlay).toContain('reasoningEffort: max')
    expect(overlay).toContain('provider: "packycode"')
    expect(overlay).toContain('model: deepseek-v4-pro')
    expect(overlay).toContain('default: code')
    expect(overlay).toContain('defaultPreset: workspace-write')
    expect(overlay).not.toContain('llm-pi-ai')
    expect(overlay).not.toContain('web-search-deepseek')
    expect(() => load(overlay)).not.toThrow()
  })

  it('disables the web-search provider when webSearch is off', () => {
    const overlay = renderOverlay({
      model: 'deepseek-v4-flash',
      reasoningEffort: 'high',
      agentPreset: 'standard',
      provider: 'deepseek-official',
      permissionMode: 'workspace-write',
      webSearch: false,
      autoAttachSelection: true,
    }, '/extension/dist/runtime/gateway-runtime.mjs')
    expect(overlay).toContain('- id: web-search-deepseek')
    expect(overlay).toContain('disabled: true')
    expect(() => load(overlay)).not.toThrow()
  })

  it('disables thinking and safely quotes provider ids', () => {
    const overlay = renderOverlay({
      model: 'deepseek-v4-flash',
      reasoningEffort: 'off',
      agentPreset: 'standard',
      provider: 'custom: route',
      permissionMode: 'read-only',
      webSearch: true,
      autoAttachSelection: false,
    }, 'C:\\Extensions\\DeepSeek Harness\\gateway-runtime.mjs')
    expect(overlay).toContain('thinking: disabled')
    expect(overlay).toContain('provider: "custom: route"')
    expect(overlay).toContain('defaultPreset: read-only')
    expect(() => load(overlay)).not.toThrow()
  })
})
