import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RoutingSuiteInstaller } from '../src/plugins/routing-suite/installer.js'
import type { RoutingSuiteManifest } from '../src/plugins/routing-suite/manifest.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (root) => { await rm(root, { recursive: true, force: true }) }))
})

describe('routing suite installer', () => {
  it('installs verified presets, records ownership, and removes managed files', async () => {
    const fixture = await createFixture('router payload')

    await fixture.installer.install(false)

    expect(fixture.operations.installPackage).toHaveBeenCalledWith(expect.stringContaining(fixture.manifest.injector.file))
    expect(await readFile(path.join(fixture.root, '.agent-presets', 'router-standard', 'preset.yml'), 'utf8')).toBe('router payload')
    await expect(fixture.installer.status({ [fixture.manifest.injector.name]: 'installed' })).resolves.toEqual({
      version: fixture.manifest.version,
      injectorName: fixture.manifest.injector.name,
    })

    await fixture.installer.remove()
    expect(fixture.operations.removePackage).toHaveBeenCalledWith(fixture.manifest.injector.name)
    await expect(stat(path.join(fixture.root, '.agent-presets', 'router-standard'))).rejects.toThrow()
  })

  it('adopts an exact existing preset without deleting it on removal', async () => {
    const fixture = await createFixture('existing payload')
    const preset = path.join(fixture.root, '.agent-presets', 'router-standard')
    await mkdir(preset, { recursive: true })
    await writeFile(path.join(preset, 'preset.yml'), 'existing payload')

    await fixture.installer.install(true)
    await fixture.installer.remove()

    await expect(readFile(path.join(preset, 'preset.yml'), 'utf8')).resolves.toBe('existing payload')
  })

  it('rejects a hash mismatch before changing the profile', async () => {
    const fixture = await createFixture('expected payload', 'tampered payload')

    await expect(fixture.installer.install(false)).rejects.toThrow('integrity check failed')
    expect(fixture.operations.installPackage).not.toHaveBeenCalled()
  })

  it('does not overwrite a user preset with different contents', async () => {
    const fixture = await createFixture('expected payload')
    const preset = path.join(fixture.root, '.agent-presets', 'router-standard')
    await mkdir(preset, { recursive: true })
    await writeFile(path.join(preset, 'preset.yml'), 'user customization')

    await expect(fixture.installer.install(false)).rejects.toThrow('already exists with different contents')
    expect(fixture.operations.installPackage).not.toHaveBeenCalled()
  })
})

async function createFixture(expected: string, downloaded = expected): Promise<{
  readonly root: string
  readonly manifest: RoutingSuiteManifest
  readonly operations: {
    readonly installPackage: ReturnType<typeof vi.fn>
    readonly removePackage: ReturnType<typeof vi.fn>
  }
  readonly installer: RoutingSuiteInstaller
}> {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-routing-suite-test-'))
  roots.push(root)
  const manifest: RoutingSuiteManifest = {
    id: 'test-routing-suite',
    version: '1.2.3',
    installSpec: 'builtin:test-routing-suite@1.2.3',
    installedName: 'test-routing-suite',
    repositoryUrl: 'https://github.com/example/test-routing-suite',
    injector: {
      name: '@example/injector',
      version: '1.2.3',
      file: 'injector.tgz',
      downloadUrl: 'https://github.com/example/injector/releases/download/v1.2.3/injector.tgz',
      sha256: digest(downloaded),
    },
    presetRepository: 'https://raw.githubusercontent.com/example/router',
    presetCommit: '0123456789abcdef',
    presets: [{
      id: 'router-standard',
      assets: [{ file: 'preset.yml', sha256: digest(expected) }],
    }],
  }
  const operations = {
    installPackage: vi.fn(async () => undefined),
    removePackage: vi.fn(async () => undefined),
  }
  const fetcher = vi.fn(async () => new Response(downloaded, { status: 200 })) as unknown as typeof fetch
  return {
    root,
    manifest,
    operations,
    installer: new RoutingSuiteInstaller(root, operations, fetcher, manifest),
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
