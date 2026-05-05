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
import { forwardResponseUpstream, rejectAndRespond } from './shared'
import type { Behavior, NewEvent } from './types'
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

function getQueue(state: Record<string, unknown>): string[] {
  let q = state['queue'] as string[] | undefined
  if (!q) {
    q = []
    state['queue'] = q
  }
  return q
}

function startProcessing(
  ctx: Parameters<Behavior>[0],
  requestId: string,
): NewEvent[] {
  const params = getParams(ctx.node)
  setInFlightReads(ctx.nodeState, getInFlightReads(ctx.nodeState) + 1)
  // Phase 6c: scale read latency by an active 'slow' degradation on this node.
  const eff = ctx.applyDegradation(
    {
      p50: params.read_latency_ms_p50,
      p99: params.read_latency_ms_p99,
      failure_rate: params.failure_rate,
    },
    ctx.node.id,
  )
  const latency = sampleLatency(eff.p50, eff.p99, ctx.rng)
  return [
    {
      at: ctx.now + latency,
      kind: 'request_complete',
      nodeId: ctx.node.id,
      requestId,
      payload: { processingTimeMs: latency, success: true },
    },
  ]
}

/**
 * Phase 6a: separate the in-flight cap from the queue.
 *
 *   1. inFlightReads < read_capacity_rps → process immediately (no queue).
 *   2. read_queue_max_depth defined and queue.length < that → enqueue.
 *   3. Otherwise → reject with reason 'capacity' + fast failure response.
 *
 * If read_queue_max_depth is undefined, the historical Phase 4 behavior is
 * preserved: behave like a concurrent cap with no queue past it (over-cap
 * arrivals reject immediately with 'capacity').
 */
const onRequestReceive: Behavior = (ctx) => {
  const params = getParams(ctx.node)
  if (!ctx.request) return []
  // v1: always treat as a read unless causalContext.kind === 'write'.
  const kind = (ctx.request.causalContext['kind'] as string | undefined) ?? 'read'
  if (kind !== 'read') {
    // v1: write path is reserved; treat write as a read for now.
  }

  if (getInFlightReads(ctx.nodeState) < params.read_capacity_rps) {
    return startProcessing(ctx, ctx.request.id)
  }

  const q = getQueue(ctx.nodeState)
  // 0 sentinel for unbounded (UI cannot write undefined through Partial<>
  // under exactOptionalPropertyTypes; behavior treats 0 as Phase 4 default).
  const maxDepth = params.read_queue_max_depth
  if (maxDepth !== undefined && maxDepth > 0 && q.length < maxDepth) {
    q.push(ctx.request.id)
    return [
      {
        at: ctx.now,
        kind: 'request_enqueue',
        nodeId: ctx.node.id,
        requestId: ctx.request.id,
        payload: { queueDepth: q.length },
      },
    ]
  }

  return rejectAndRespond(ctx, 'capacity', { queueDepth: q.length })
}

const onRequestComplete: Behavior = (ctx) => {
  const params = getParams(ctx.node)
  // Order matters: decrement, drain, increment. The drain step starts the
  // next queued request which will increment again. Net inFlightReads stays
  // at capacity while the queue has work — exactly what we want.
  setInFlightReads(ctx.nodeState, Math.max(0, getInFlightReads(ctx.nodeState) - 1))
  // Phase 6c: failure_rate is overridden by an 'errors' degradation on this node.
  const eff = ctx.applyDegradation(
    {
      p50: params.read_latency_ms_p50,
      p99: params.read_latency_ms_p99,
      failure_rate: params.failure_rate,
    },
    ctx.node.id,
  )
  const success = ctx.rng() >= eff.failure_rate
  const out: NewEvent[] = forwardResponseUpstream(ctx, success)

  const q = getQueue(ctx.nodeState)
  const next = q.shift()
  if (next !== undefined) out.push(...startProcessing(ctx, next))
  return out
}

const onRequestResponse: Behavior = (ctx) => {
  // Databases are usually leaves; if we get a response, forward upstream.
  const payload = ctx.triggeringEvent.payload as { success?: boolean } | undefined
  return forwardResponseUpstream(ctx, payload?.success ?? true)
}

registerBehavior('database', 'request_receive', onRequestReceive)
registerBehavior('database', 'request_complete', onRequestComplete)
registerBehavior('database', 'request_response', onRequestResponse)
