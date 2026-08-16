import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { ROUTING_SUITE_MANIFEST, type RoutingSuiteManifest, type RoutingSuitePreset } from './manifest.js'

const STATE_SCHEMA_VERSION = 1
const DOWNLOAD_TIMEOUT_MS = 15_000

type PresetOwnership = 'managed' | 'external'

interface RoutingSuiteState {
  readonly schemaVersion: typeof STATE_SCHEMA_VERSION
  readonly id: string
  readonly version: string
  readonly injectorName: string
  readonly presets: readonly {
    readonly id: string
    readonly ownership: PresetOwnership
  }[]
}

export interface RoutingSuitePackageOperations {
  installPackage(spec: string): Promise<void>
  removePackage(name: string): Promise<void>
}

export interface RoutingSuiteStatus {
  readonly version: string
  readonly injectorName: string
}

/**
 * Installs the upstream multi-repository suite without pretending its root is
 * an npm package. Preset files are pinned and hash-checked before they enter
 * the private Harness home; the actual Injector still uses DSH's official
 * profile package command.
 */
export class RoutingSuiteInstaller {
  constructor(
    private readonly harnessHome: string,
    private readonly packages: RoutingSuitePackageOperations,
    private readonly fetcher: typeof globalThis.fetch = globalThis.fetch,
    private readonly manifest: RoutingSuiteManifest = ROUTING_SUITE_MANIFEST,
  ) {}

  matches(spec: string): boolean {
    return spec.trim() === this.manifest.installSpec
  }

  async install(packageAlreadyInstalled: boolean): Promise<void> {
    const [downloaded, injector] = await Promise.all([
      this.downloadPresets(),
      this.downloadInjector(),
    ])
    const previous = await this.readState()
    const ownership = new Map(previous?.presets.map((preset) => [preset.id, preset.ownership]))
    const created: string[] = []

    // Resolve all conflicts before changing the profile package graph.
    for (const preset of this.manifest.presets) {
      const directory = this.presetDirectory(preset.id)
      if (!await exists(directory)) continue
      if (!await presetMatches(directory, preset, downloaded)) {
        throw new Error(`Cannot install ${this.manifest.id}: preset directory already exists with different contents: ${directory}`)
      }
      if (!ownership.has(preset.id)) ownership.set(preset.id, 'external')
    }

    let packageAdded = false
    try {
      for (const preset of this.manifest.presets) {
        const directory = this.presetDirectory(preset.id)
        if (await exists(directory)) continue
        await this.writePreset(directory, preset, downloaded)
        ownership.set(preset.id, 'managed')
        created.push(directory)
      }

      const injectorArtifact = await this.writeInjectorArtifact(injector)
      await this.packages.installPackage(injectorArtifact)
      packageAdded = !packageAlreadyInstalled
      await this.writeState({
        schemaVersion: STATE_SCHEMA_VERSION,
        id: this.manifest.id,
        version: this.manifest.version,
        injectorName: this.manifest.injector.name,
        presets: this.manifest.presets.map((preset) => ({
          id: preset.id,
          ownership: ownership.get(preset.id) ?? 'managed',
        })),
      })
    } catch (cause) {
      await Promise.allSettled(created.map(async (directory) => { await rm(directory, { recursive: true, force: true }) }))
      if (packageAdded) await this.packages.removePackage(this.manifest.injector.name).catch(() => undefined)
      throw cause
    }
  }

  async remove(): Promise<void> {
    const state = await this.readState()
    if (state === undefined) throw new Error(`${this.manifest.id} is not installed as a managed suite.`)
    await this.packages.removePackage(state.injectorName)
    await Promise.all(state.presets
      .filter((preset) => preset.ownership === 'managed')
      .map(async (preset) => { await rm(this.presetDirectory(preset.id), { recursive: true, force: true }) }))
    await rm(this.stateDirectory(), { recursive: true, force: true })
  }

  async status(profileDependencies: Readonly<Record<string, string>>): Promise<RoutingSuiteStatus | undefined> {
    const state = await this.readState()
    if (state === undefined || profileDependencies[state.injectorName] === undefined) return undefined
    for (const preset of this.manifest.presets) {
      const ownership = state.presets.find((item) => item.id === preset.id)?.ownership
      if (!await presetMatches(this.presetDirectory(preset.id), preset, undefined, ownership === 'external')) return undefined
    }
    return { version: state.version, injectorName: state.injectorName }
  }

  private async downloadPresets(): Promise<ReadonlyMap<string, Buffer>> {
    const entries = await Promise.all(this.manifest.presets.flatMap((preset) => preset.assets.map(async (asset) => {
      const key = assetKey(preset.id, asset.file)
      const url = `${this.manifest.presetRepository}/${this.manifest.presetCommit}/preset/${preset.id}/${asset.file}`
      const response = await this.fetcher(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
      if (!response.ok) throw new Error(`Routing suite preset download failed: HTTP ${response.status} (${url})`)
      const content = Buffer.from(await response.arrayBuffer())
      if (sha256(content) !== asset.sha256) throw new Error(`Routing suite preset integrity check failed: ${preset.id}/${asset.file}`)
      return [key, content] as const
    })))
    return new Map(entries)
  }

  private async downloadInjector(): Promise<Buffer> {
    const response = await this.fetcher(this.manifest.injector.downloadUrl, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    })
    if (!response.ok) {
      throw new Error(`Routing suite Injector download failed: HTTP ${response.status} (${this.manifest.injector.downloadUrl})`)
    }
    const content = Buffer.from(await response.arrayBuffer())
    if (sha256(content) !== this.manifest.injector.sha256) {
      throw new Error(`Routing suite Injector integrity check failed: ${this.manifest.injector.file}`)
    }
    return content
  }

  private async writeInjectorArtifact(content: Buffer): Promise<string> {
    const directory = path.join(this.stateDirectory(), 'artifacts')
    const target = path.join(directory, this.manifest.injector.file)
    const temporary = path.join(directory, `.${this.manifest.injector.file}-${randomUUID()}`)
    await mkdir(directory, { recursive: true })
    await writeFile(temporary, content, { flag: 'wx' })
    await rm(target, { force: true })
    await rename(temporary, target)
    return target
  }

  private async writePreset(directory: string, preset: RoutingSuitePreset, downloaded: ReadonlyMap<string, Buffer>): Promise<void> {
    const parent = path.dirname(directory)
    const staging = path.join(parent, `.${preset.id}.installing-${randomUUID()}`)
    await mkdir(staging, { recursive: true })
    try {
      for (const asset of preset.assets) {
        const content = downloaded.get(assetKey(preset.id, asset.file))
        if (content === undefined) throw new Error(`Missing downloaded preset asset: ${preset.id}/${asset.file}`)
        await writeFile(path.join(staging, asset.file), content, { flag: 'wx' })
      }
      await rename(staging, directory)
    } catch (cause) {
      await rm(staging, { recursive: true, force: true })
      throw cause
    }
  }

  private async readState(): Promise<RoutingSuiteState | undefined> {
    try {
      const value: unknown = JSON.parse(await readFile(this.stateFile(), 'utf8'))
      if (!isRecord(value)
        || value.schemaVersion !== STATE_SCHEMA_VERSION
        || value.id !== this.manifest.id
        || typeof value.version !== 'string'
        || typeof value.injectorName !== 'string'
        || !Array.isArray(value.presets)) return undefined
      const presets: Array<{ readonly id: string; readonly ownership: PresetOwnership }> = []
      for (const preset of value.presets) {
        if (!isRecord(preset)
          || typeof preset.id !== 'string'
          || (preset.ownership !== 'managed' && preset.ownership !== 'external')) return undefined
        presets.push({ id: preset.id, ownership: preset.ownership })
      }
      return {
        schemaVersion: STATE_SCHEMA_VERSION,
        id: value.id,
        version: value.version,
        injectorName: value.injectorName,
        presets,
      }
    } catch {
      return undefined
    }
  }

  private async writeState(state: RoutingSuiteState): Promise<void> {
    const directory = this.stateDirectory()
    const temporary = path.join(directory, `.state-${randomUUID()}.json`)
    await mkdir(directory, { recursive: true })
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { flag: 'wx' })
    await rm(this.stateFile(), { force: true })
    await rename(temporary, this.stateFile())
  }

  private presetDirectory(id: string): string {
    return path.join(this.harnessHome, '.agent-presets', id)
  }

  private stateDirectory(): string {
    return path.join(this.harnessHome, 'managed-plugins', this.manifest.id)
  }

  private stateFile(): string {
    return path.join(this.stateDirectory(), 'state.json')
  }
}

async function presetMatches(
  directory: string,
  preset: RoutingSuitePreset,
  downloaded?: ReadonlyMap<string, Buffer>,
  requireExact = true,
): Promise<boolean> {
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    const expected = [...preset.assets.map((asset) => asset.file)].sort()
    const actual = entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort()
    if (requireExact && (entries.some((entry) => !entry.isFile()) || expected.join('\0') !== actual.join('\0'))) return false
    if (!requireExact && expected.some((file) => !actual.includes(file))) return false
    return (await Promise.all(preset.assets.map(async (asset) => {
      if (downloaded !== undefined && !downloaded.has(assetKey(preset.id, asset.file))) return false
      const disk = await readFile(path.join(directory, asset.file))
      return sha256(disk) === asset.sha256
    }))).every(Boolean)
  } catch {
    return false
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}

function assetKey(preset: string, file: string): string {
  return `${preset}/${file}`
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
