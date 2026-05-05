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
 *   - write_capacity_rps / write_latency_* / subtype are stored but not used.
 *   - All requests treated as reads. Write path is reserved for the
 *     consistency-models prompt (Phase 6e).
 *
 * Phase 6d additions:
 *   - read_routing decides per-read whether to hit primary or a replica.
 *     primary_only (default for backwards compat) → stalenessMs absent.
 *     replica_only / mixed → samples per-read replication lag from the
 *     log-normal lag distribution; stamps stalenessMs + replicaIndex on
 *     request_complete payload. forwardResponseUpstream auto-propagates
 *     these onto every hop of the reverse path.
 *   - Replication-lag spike chaos (replication_lag_spike) scales the lag
 *     distribution's p50/p99 while active, via getReplicationLagMultiplier.
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

  // Phase 6d: read routing + staleness sampling. Skip if no replicas (≤1) or
  // routing forces primary — both yield zero staleness with no payload bloat,
  // preserving pre-6d digests for backwards compat. v1 simplification: lag is
  // sampled fresh per read from a log-normal — we don't track per-replica
  // clocks. Captures the variability and tail without modeling clock dynamics.
  const routing = params.read_routing ?? 'primary_only'
  const useReplicas = params.replicas > 1 && routing !== 'primary_only'
  let stalenessMs = 0
  let replicaIndex: number | undefined
  if (useReplicas) {
    const goReplica =
      routing === 'replica_only' || (routing === 'mixed' && ctx.rng() < 0.5)
    if (goReplica) {
      // replicas count includes the primary — replica indices are 0..N-2.
      const replicaCount = params.replicas - 1
      replicaIndex = Math.floor(ctx.rng() * replicaCount)
      const lagMul = ctx.getReplicationLagMultiplier(ctx.node.id)
      stalenessMs = sampleLatency(
        params.replication_lag_ms_p50 * lagMul,
        params.replication_lag_ms_p99 * lagMul,
        ctx.rng,
      )
    }
  }

  return [
    {
      at: ctx.now + latency,
      kind: 'request_complete',
      nodeId: ctx.node.id,
      requestId,
      payload: {
        processingTimeMs: latency,
        success: true,
        ...(useReplicas
          ? {
              stalenessMs,
              ...(replicaIndex !== undefined ? { replicaIndex } : {}),
            }
          : {}),
      },
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
