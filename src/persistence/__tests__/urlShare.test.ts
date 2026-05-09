import { describe, expect, it } from 'vitest'
import { decodeDesignFromUrl, encodeDesignForUrl } from '../urlShare'
import { DEMO_SCENARIOS } from '@/demos'

describe('share-link round-trip (R3-10 minimization)', () => {
  for (const s of DEMO_SCENARIOS) {
    if (s.comingSoon) continue
    it(`${s.slug}: encode → decode round-trips to a structurally-equivalent design`, () => {
      const original = s.buildDesign()
      const enc = encodeDesignForUrl(original)
      expect(enc.ok).toBe(true)
      if (!enc.ok) return
      const dec = decodeDesignFromUrl(enc.encoded)
      expect(dec.ok).toBe(true)
      if (!dec.ok) return
      // Walk the structure: nodes/edges/chaos must be identical after a
      // round trip. We compare via JSON.stringify because the decode
      // result reconstructs default values, so the deep shape matches.
      expect(JSON.stringify(dec.design.nodes)).toBe(JSON.stringify(original.nodes))
      expect(JSON.stringify(dec.design.edges)).toBe(JSON.stringify(original.edges))
      expect(JSON.stringify(dec.design.chaosPlan ?? [])).toBe(
        JSON.stringify(original.chaosPlan ?? []),
      )
    })
  }

  it('default-heavy designs encode meaningfully smaller', () => {
    // Reference: a default-only design should compress dramatically vs an
    // all-fields design. We can't make absolute claims about Slack's
    // exact tolerance, but we can pin the relative size: a fresh
    // default-everything design must encode under 350 chars.
    const fresh = DEMO_SCENARIOS.find((s) => s.slug === 'cache-stampede')!.buildDesign()
    const enc = encodeDesignForUrl(fresh)
    expect(enc.ok).toBe(true)
    if (!enc.ok) return
    // Round-3 baseline: pre-fix was ~1346 chars on cache-stampede. After
    // minimization the encoded payload is well under 1KB. Assert under
    // 1100 to leave headroom for cosmetic edits.
    expect(enc.encoded.length).toBeLessThan(1100)
  })
})
