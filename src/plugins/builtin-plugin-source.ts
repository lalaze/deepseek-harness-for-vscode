import { DEFAULT_BUILTIN_PLUGINS } from './default-plugins.js'
import { ROUTING_SUITE_MANIFEST } from './routing-suite/manifest.js'
import type { DshPluginCatalogContribution, DshPluginCatalogItem } from './types.js'

/** Catalog entries whose installation requires a trusted, multi-step recipe. */
export class BuiltinDshPluginSource {
  async load(language: string): Promise<DshPluginCatalogContribution> {
    const chinese = language.toLowerCase().startsWith('zh')
    const categories = new Map<string, string>([
      ['routing', chinese ? '路由与工作流' : 'Routing & workflow'],
      ...DEFAULT_BUILTIN_PLUGINS.map((plugin) => [
        plugin.category,
        chinese ? plugin.categoryLabel.zh : plugin.categoryLabel.en,
      ] as const),
    ])
    const plugins: DshPluginCatalogItem[] = [
      {
        id: ROUTING_SUITE_MANIFEST.repositoryUrl.toLowerCase(),
        name: 'DSH Routing Suite',
        owner: 'yjh051108',
        description: chinese
          ? '一键安装 Super Injector v0.3.3，以及 Router Standard 与 Router Spec 预设。安装内容固定到已审查的 Release 和 Git 提交。'
          : 'Installs Super Injector v0.3.3 plus the Router Standard and Router Spec presets, pinned to reviewed release artifacts and Git commits.',
        category: 'routing',
        repositoryUrl: ROUTING_SUITE_MANIFEST.repositoryUrl,
        installSpec: ROUTING_SUITE_MANIFEST.installSpec,
        installedName: ROUTING_SUITE_MANIFEST.installedName,
        installKind: 'managed-suite',
        stars: 0,
        updatedAt: '2026-08-15T19:13:48Z',
        catalogSource: 'builtin',
        compatibility: 'agent',
      },
      ...DEFAULT_BUILTIN_PLUGINS.map((plugin) => ({
        id: plugin.id.toLowerCase(),
        name: plugin.name,
        owner: plugin.owner,
        description: chinese ? plugin.description.zh : plugin.description.en,
        category: plugin.category,
        repositoryUrl: plugin.repositoryUrl,
        installSpec: plugin.installSpec,
        installedName: plugin.installedName,
        installKind: 'package' as const,
        ...(plugin.npmPackage === undefined ? {} : { npmPackage: plugin.npmPackage }),
        stars: 0,
        updatedAt: plugin.updatedAt,
        catalogSource: 'builtin' as const,
        compatibility: plugin.compatibility,
      })),
    ]
    return {
      source: 'builtin',
      categories: [...categories].map(([id, label]) => ({ id, label })),
      plugins,
    }
  }
}
