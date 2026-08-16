/** Minimal Cordis context used by the extension-owned Gateway runtime plugin. */
interface GatewayPluginContext {
  readonly webServer: {
    readonly port: number
  }
  provide(name: 'webRuntime', value: GatewayRuntimeValues): void
  get(name: 'loader'): { await(): Promise<unknown> } | undefined
}

interface GatewayRuntimeConfig {
  readonly printUrl?: boolean
}

export interface GatewayRuntimeValues {
  readonly lanAddresses: readonly string[]
  readonly trustedHosts: readonly string[]
}

/** Stable Cordis plugin metadata consumed by the DSH profile loader. */
export const name = 'vscode-gateway-runtime'
export const inject = ['webServer']

/** Canonical loopback endpoint used only by the native extension client. */
export function gatewayUrl(port: number): string {
  return `http://127.0.0.1:${String(port)}`
}

/**
 * Provides the bind-dependent value required by dsh-client-connection without
 * mounting dsh-host-frontend-static. Unmatched HTTP routes therefore remain
 * owned by dsh-host-webserver and return 404 instead of serving the DSH SPA.
 */
export function apply(ctx: GatewayPluginContext, config: GatewayRuntimeConfig = {}): void {
  ctx.provide('webRuntime', { lanAddresses: [], trustedHosts: [] })
  if (config.printUrl === false) return

  const announce = (): void => {
    process.stdout.write(`dsh gateway: ${gatewayUrl(ctx.webServer.port)}\n`)
  }
  const settled = ctx.get('loader')?.await()
  if (settled === undefined) announce()
  else void settled.then(announce, () => undefined)
}
