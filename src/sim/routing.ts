import type { Edge, EdgeKind } from '@/schema/types'
import { fnv1a32 } from './prng'

/**
 * Routing helpers used by behaviors that pick an outgoing edge.
 *
 * Determinism: every helper here is either pure (input → output) or threads
 * its mutable state through caller-provided arguments (state object, rng).
 * Map iteration is never used; outgoing[] order is the design's edge order.
 */

export function findOutgoingByKind(outgoing: Edge[], kind: EdgeKind): Edge | undefined {
  return outgoing.find((e) => e.kind === kind)
}

/** First outgoing sync_rpc edge (the default forward routing for "next hop"). */
export function defaultNextHop(outgoing: Edge[]): Edge | undefined {
  return findOutgoingByKind(outgoing, 'sync_rpc') ?? outgoing[0]
}

/** Round-robin: stores `rrIndex` in the caller-provided state object. */
export function roundRobinNext(
  outgoing: Edge[],
  state: { rrIndex?: number },
): Edge | undefined {
  if (outgoing.length === 0) return undefined
  const i = (state.rrIndex ?? 0) % outgoing.length
  state.rrIndex = i + 1
  return outgoing[i]
}

/** Random: draws a uniform from rng. */
export function randomNext(outgoing: Edge[], rng: () => number): Edge | undefined {
  if (outgoing.length === 0) return undefined
  return outgoing[Math.floor(rng() * outgoing.length)]
}

/**
 * Least-connections: pick the outgoing edge whose target has the lowest
 * in-flight count. Ties broken by edge index in `outgoing` for determinism.
 */
export function leastConnectionsNext(
  outgoing: Edge[],
  inFlightByTargetId: ReadonlyMap<string, number>,
): Edge | undefined {
  if (outgoing.length === 0) return undefined
  let best: Edge | undefined
  let bestCount = Infinity
  for (const e of outgoing) {
    const c = inFlightByTargetId.get(e.target) ?? 0
    if (c < bestCount) {
      bestCount = c
      best = e
    }
  }
  return best
}

/**
 * Consistent-hash / IP-hash style routing. v1 simplification: hash on
 * requestId rather than client IP (no IP in our model). Treat session
 * affinity as request affinity.
 */
export function consistentHashNext(
  outgoing: Edge[],
  requestId: string,
): Edge | undefined {
  if (outgoing.length === 0) return undefined
  return outgoing[fnv1a32(requestId) % outgoing.length]
}
