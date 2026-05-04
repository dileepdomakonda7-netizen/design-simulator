/**
 * Database behavior.
 *
 * Handles event kinds:
 *   - request_receive   (read or write; check capacity; schedule complete)
 *   - request_complete  (sample success per failure_rate; respond upstream)
 *   - request_response  (forward back if not a leaf)
 *
 * Reads ctx.nodeState keys:
 *   - inFlightReads      (number)
 *   - inFlightWrites     (number, always 0 in v1)
 *
 * Writes ctx.nodeState keys: inFlightReads, inFlightWrites
 *
 * Per-type semantics:
 *   Determines read vs write from `request.causalContext.kind`. v1 default
 *   is read (no behavior sets the kind yet). Capacity is enforced as a
 *   concurrent-in-flight cap against read_capacity_rps — a v1 simplification
 *   that conflates rate with concurrency. Phase 6 splits properly.
 *
 * v1 simplifications:
 *   - replicas / write_capacity_rps / write_latency_*  / replication_mode /
 *     replication_lag_*  / subtype are stored but not used.
 *   - All reads always come from the primary.
 */
import { registerBehavior } from '../behaviorRegistry'
import { sampleLatency } from '../latency'
import { forwardResponseUpstream, rejectHere } from './shared'
import type { Behavior } from './types'
import type { Node } from '@/schema/types'

function getParams(node: Node): Extract<Node, { type: 'database' }>['params'] {
  if (node.type !== 'database') {
    throw new Error(`DatabaseBehavior received non-database node: ${node.type}`)
  }
  return node.params
}

function getInFlightReads(state: Record<string, unknown>): number {
  return (state['inFlightReads'] as number | undefined) ?? 0
}

function setInFlightReads(state: Record<string, unknown>, n: number): void {
  state['inFlightReads'] = n
}

const onRequestReceive: Behavior = (ctx) => {
  const params = getParams(ctx.node)
  if (!ctx.request) return []

  // v1: always treat as a read unless causalContext.kind === 'write'.
  const kind = (ctx.request.causalContext['kind'] as string | undefined) ?? 'read'

  // v1 simplification: read_capacity_rps used as a concurrent-in-flight cap.
  if (kind === 'read' && getInFlightReads(ctx.nodeState) >= params.read_capacity_rps) {
    return rejectHere(ctx, 'capacity')
  }

  setInFlightReads(ctx.nodeState, getInFlightReads(ctx.nodeState) + 1)
  const latency = sampleLatency(
    params.read_latency_ms_p50,
    params.read_latency_ms_p99,
    ctx.rng,
  )
  return [
    {
      at: ctx.now + latency,
      kind: 'request_complete',
      nodeId: ctx.node.id,
      requestId: ctx.request.id,
      payload: { processingTimeMs: latency, success: true },
    },
  ]
}

const onRequestComplete: Behavior = (ctx) => {
  const params = getParams(ctx.node)
  setInFlightReads(ctx.nodeState, Math.max(0, getInFlightReads(ctx.nodeState) - 1))
  const success = ctx.rng() >= params.failure_rate
  return forwardResponseUpstream(ctx, success)
}

const onRequestResponse: Behavior = (ctx) => {
  // Databases are usually leaves; if we get a response, forward upstream.
  const payload = ctx.triggeringEvent.payload as { success?: boolean } | undefined
  return forwardResponseUpstream(ctx, payload?.success ?? true)
}

registerBehavior('database', 'request_receive', onRequestReceive)
registerBehavior('database', 'request_complete', onRequestComplete)
registerBehavior('database', 'request_response', onRequestResponse)
