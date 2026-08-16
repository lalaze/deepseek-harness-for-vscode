import { describe, expect, it, vi } from 'vitest'
import { apply, gatewayUrl } from '../src/runtime/gateway-runtime-plugin.js'

describe('headless Gateway runtime plugin', () => {
  it('provides loopback trust without registering a frontend fallback', () => {
    const provide = vi.fn()
    const context = {
      webServer: { port: 43123 },
      provide,
      get: vi.fn(() => undefined),
    }

    apply(context, { printUrl: false })

    expect(gatewayUrl(43123)).toBe('http://127.0.0.1:43123')
    expect(provide).toHaveBeenCalledWith('webRuntime', {
      lanAddresses: [],
      trustedHosts: [],
    })
    expect(context).not.toHaveProperty('plugin')
  })
})
