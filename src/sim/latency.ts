import type { Edge } from '@/schema/types'
import { sampleLogNormal } from './prng'

/** Sample one-way network latency for a forward or reverse edge traversal. */
export function sampleEdgeLatency(edge: Edge, rng: () => number): number {
  return sampleLogNormal(
    rng,
    edge.params.network_latency_ms_p50,
    edge.params.network_latency_ms_p99,
  )
}

/** Generic helper: sample log-normal latency from any (p50, p99) pair. */
export function sampleLatency(p50: number, p99: number, rng: () => number): number {
  return sampleLogNormal(rng, p50, p99)
}
