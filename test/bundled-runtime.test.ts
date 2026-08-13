import { describe, expect, it } from 'vitest'
import { parseNodeVersion, supportsHarnessNode } from '../src/runtime/bundled-runtime.js'

describe('bundled runtime Node policy', () => {
  it('accepts the upstream Node range', () => {
    expect(parseNodeVersion('v22.19.0')).toEqual({ major: 22, minor: 19, patch: 0 })
    expect(supportsHarnessNode({ major: 22, minor: 18 })).toBe(false)
    expect(supportsHarnessNode({ major: 22, minor: 19 })).toBe(true)
    expect(supportsHarnessNode({ major: 23, minor: 9 })).toBe(false)
    expect(supportsHarnessNode({ major: 24, minor: 0 })).toBe(true)
  })
})
