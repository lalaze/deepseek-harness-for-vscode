/** Immutable recipe metadata for the upstream dsh-routing-suite. */
export interface RoutingSuiteAsset {
  readonly file: string
  readonly sha256: string
}

export interface RoutingSuitePreset {
  readonly id: string
  readonly assets: readonly RoutingSuiteAsset[]
}

export interface RoutingSuiteManifest {
  readonly id: string
  readonly version: string
  readonly installSpec: string
  readonly installedName: string
  readonly repositoryUrl: string
  readonly injector: {
    readonly name: string
    readonly version: string
    readonly file: string
    readonly downloadUrl: string
    readonly sha256: string
  }
  readonly presetRepository: string
  readonly presetCommit: string
  readonly presets: readonly RoutingSuitePreset[]
}

export const ROUTING_SUITE_MANIFEST: RoutingSuiteManifest = {
  id: 'dsh-routing-suite',
  version: '0.3.3',
  installSpec: 'builtin:dsh-routing-suite@0.3.3',
  installedName: 'dsh-routing-suite',
  repositoryUrl: 'https://github.com/yjh051108/dsh-routing-suite',
  injector: {
    name: '@dsh-external/dsh-super-injector',
    version: '0.3.3',
    file: 'dsh-external-dsh-super-injector-0.3.3.tgz',
    downloadUrl: 'https://github.com/yjh051108/dsh-super-injector/releases/download/v0.3.3/dsh-external-dsh-super-injector-0.3.3.tgz',
    sha256: '355238fa8e51bc45c0801066af51e0e122f3b21411b193f601ee54e534391f48',
  },
  presetRepository: 'https://raw.githubusercontent.com/yjh051108/dsh-router-standard',
  presetCommit: 'eff787e95132d6c7104214542104a84d656b497e',
  presets: [
    {
      id: 'router-standard',
      assets: [
        { file: 'agent.cordis.yml', sha256: 'd505dfcf0c46bd93ecbd4ea1df4b0977bd9e4d1cb2affccda78b25c374bffe5f' },
        { file: 'preset.yml', sha256: 'c69289fff1e4b262002f6e196bd88ce51e14f6dd3b04b71c2e25cd79ae7f1c83' },
        { file: 'router-bootstrap-v1.mjs', sha256: 'a64ef30346cbd73cabe4c92598794ac70c3842184815f907c0033483022fd03e' },
        { file: 'router-bootstrap.mjs', sha256: 'a64ef30346cbd73cabe4c92598794ac70c3842184815f907c0033483022fd03e' },
        { file: 'router-core.mjs', sha256: '70c958b0f532ba10cfdabdfeb3763d4941ed25735ee1846dd6fcb4cae7d3b4df' },
      ],
    },
    {
      id: 'router-spec',
      assets: [
        { file: 'agent.cordis.yml', sha256: 'b1cf2c2b161762cf14ff66eb0c0183684cc1ea47b08ad16e28e3cdef1757c036' },
        { file: 'preset.yml', sha256: '7a608038f34514e9a5336328af844c0d5b5f69b551845618cef91ad487fe0320' },
        { file: 'router-bootstrap-v1.mjs', sha256: 'a64ef30346cbd73cabe4c92598794ac70c3842184815f907c0033483022fd03e' },
        { file: 'router-bootstrap.mjs', sha256: 'a64ef30346cbd73cabe4c92598794ac70c3842184815f907c0033483022fd03e' },
        { file: 'router-core.mjs', sha256: '70c958b0f532ba10cfdabdfeb3763d4941ed25735ee1846dd6fcb4cae7d3b4df' },
      ],
    },
  ],
}
