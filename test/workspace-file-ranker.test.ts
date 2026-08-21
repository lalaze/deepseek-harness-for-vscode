import { describe, expect, it } from 'vitest'

import type { WorkspaceFileView } from '../src/editor/types.js'
import { matchBareFileName, rankWorkspaceFiles } from '../src/editor/workspace-file-ranker.js'

const files: readonly WorkspaceFileView[] = [
  { id: '1', path: 'src/ui/workbench-view-provider.ts', label: 'workbench-view-provider.ts' },
  { id: '2', path: 'src/webview/editor-context/component.ts', label: 'component.ts' },
  { id: '3', path: 'test/workbench-view-provider.test.ts', label: 'workbench-view-provider.test.ts' },
  { id: '4', path: 'package.json', label: 'package.json' },
]

describe('rankWorkspaceFiles', () => {
  it('prefers basename prefixes and still supports fuzzy subsequences', () => {
    expect(rankWorkspaceFiles(files, 'workbench').map((file) => file.id)).toEqual(['1', '3'])
    expect(rankWorkspaceFiles(files, 'edctx').map((file) => file.id)).toContain('2')
  })

  it('returns a bounded deterministic list for an empty @ query', () => {
    expect(rankWorkspaceFiles(files, '', 2).map((file) => file.id)).toEqual(['4', '1'])
  })
})

describe('matchBareFileName', () => {
  it('matches indexed basenames exactly, shortest path first', () => {
    const duplicates: readonly WorkspaceFileView[] = [
      { id: '5', path: 'src/deep/package.json', label: 'package.json' },
      { id: '6', path: 'package.json', label: 'package.json' },
      { id: '7', path: 'docs/package.json', label: 'package.json' },
    ]

    expect(matchBareFileName(duplicates, 'package.json').map((file) => file.id)).toEqual(['6', '7', '5'])
  })

  it('ignores directory-qualified or non-matching names', () => {
    expect(matchBareFileName(files, 'ui/workbench-view-provider.ts')).toEqual([])
    expect(matchBareFileName(files, 'C:\\repo\\package.json')).toEqual([])
    expect(matchBareFileName(files, 'PACKAGE.JSON')).toEqual([])
    expect(matchBareFileName(files, '')).toEqual([])
  })
})
