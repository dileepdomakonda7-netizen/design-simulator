import type { SimEvent } from './types'

/**
 * cyrb53 — fast 53-bit string hash, sufficient for run-to-run determinism digests.
 * Reference: https://stackoverflow.com/a/52171480
 */
export function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

/**
 * Determinism digest of an entire run's event stream.
 *
 * Sorts by (at, id) — the same tie-break the priority queue uses — so the
 * digest is independent of how events arrive at the consumer (Comlink
 * scheduling, async callback ordering, etc.). The sort key is fully
 * determined by the engine's deterministic id assignment.
 *
 * `id` is included in the per-event key so two events with identical
 * (at, kind, nodeId, requestId) but different ids contribute different bytes.
 */
export function computeDigest(events: readonly SimEvent[]): string {
  const sorted = [...events].sort((a, b) => a.at - b.at || a.id - b.id)
  const serial = sorted
    .map(
      (e) => `${e.at}:${e.id}:${e.kind}:${e.nodeId ?? ''}:${e.requestId ?? ''}`,
    )
    .join('|')
  return cyrb53(serial).toString(16)
}
