/**
 * Database behavior.
 *
 * Phase 6e: read/write differentiation + consistency models.
 *   - Reads (causalContext.kind === 'read', the default) flow through the
 *     read-routing logic and emit `request_complete` with stalenessMs +
 *     replicaIndex (when a replica is used).
 *   - Writes (causalContext.kind === 'write') always go to primary, always
 *     succeed (v1 simplification — no failure_rate / capacity check), and
 *     emit `request_complete` carrying `writeTimestamp` (the virtual time
 *     the write committed). The engine main loop reads this to populate
 *     clientWriteTimestamps for read_your_writes enforcement.
 *
 * Routing resolution (in priority order):
 *   1. params.consistency_model set → it dictates routing entirely:
 *        linearizable      → primary
 *        eventual          → any replica
 *        read_your_writes  → replica unless the originating client has
 *                            a recent write to this DB AND the chosen
 *                            replica's sampled lag is >= time-since-write.
 *                            On too-stale: escalate to primary + emit a
 *                            `consistency_violation` event for diagnostics.
 *        monotonic_reads   → replica unless the originating client's
 *                            read-freshness watermark exceeds the chosen
 *                            replica's freshness. Same fallback semantics.
 *   2. params.consistency_model unset, params.read_routing set → use it
 *        (Phase 6d behavior).
 *   3. Both unset → 'primary_only' (preserves every pre-6d design).
 *
 * v1 simplifications:
 *   - subtype / write_capacity_rps / write_queue_max_depth are stored but
 *     not used. Writes bypass capacity entirely.
 *   - RYW / MR sample ONE replica's lag and check it against the watermark.
 *     If the chosen replica is too stale → escalate to primary. We do not
 *     try the next replica — modeling per-replica continuous clocks is a
 *     separate semester of complexity.
 */
import { registerBehavior } from '../behaviorRegistry'
import { sampleLatency } from '../latency'
import { forwardResponseUpstream, rejectAndRespond } from './shared'
import type { Behavior, NewEvent } from './types'
import type { ConsistencyModel, Node } from '@/schema/types'

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

/**
 * Resolve which routing applies for a read on this database. consistency_model
 * (when set) wins; otherwise fall back to legacy `read_routing` (defaulting to
 * 'primary_only' when both are unset — preserves every pre-6d design).
 */
function resolveRouting(
  params: Extract<Node, { type: 'database' }>['params'],
): {
  mode: 'primary_only' | 'replica_only' | 'mixed'
  model?: ConsistencyModel
} {
  const m = params.consistency_model
  if (m) {
    if (m === 'linearizable') return { mode: 'primary_only', model: m }
    return { mode: 'replica_only', model: m }
  }
  return { mode: params.read_routing ?? 'primary_only' }
}

/**
 * Read path. Picks primary vs replica per the resolved routing, samples the
 * per-read replication lag if a replica is chosen, and applies the
 * consistency-model fallback (RYW / MR) — escalating to primary and emitting
 * a `consistency_violation` event when the chosen replica is too stale.
 */
function startReadProcessing(
  ctx: Parameters<Behavior>[0],
  requestId: string,
): NewEvent[] {
  const params = getParams(ctx.node)
  setInFlightReads(ctx.nodeState, getInFlightReads(ctx.nodeState) + 1)
  const eff = ctx.applyDegradation(
    {
      p50: params.read_latency_ms_p50,
      p99: params.read_latency_ms_p99,
      failure_rate: params.failure_rate,
    },
    ctx.node.id,
  )
  const latency = sampleLatency(eff.p50, eff.p99, ctx.rng)

  const { mode, model } = resolveRouting(params)
  const hasReplicas = params.replicas > 1
  const useReplicas = hasReplicas && mode !== 'primary_only'

  let stalenessMs = 0
  let replicaIndex: number | undefined
  const violations: NewEvent[] = []

  if (useReplicas) {
    const goReplica = mode === 'replica_only' || (mode === 'mixed' && ctx.rng() < 0.5)
    if (goReplica) {
      // replicas count includes the primary — replica indices are 0..N-2.
      const replicaCount = params.replicas - 1
      const idx = Math.floor(ctx.rng() * replicaCount)
      const lagMul = ctx.getReplicationLagMultiplier(ctx.node.id)
      const sampledLag = sampleLatency(
        params.replication_lag_ms_p50 * lagMul,
        params.replication_lag_ms_p99 * lagMul,
        ctx.rng,
      )

      // 6e: RYW / MR fallback. ctx.request.originNodeId is the client.
      const escalation = ctx.request
        ? checkConsistencyEscalation(
            model,
            ctx.request.originNodeId,
            ctx.node.id,
            ctx.now,
            sampledLag,
            ctx,
          )
        : null
      if (escalation) {
        violations.push({
          at: ctx.now,
          kind: 'consistency_violation',
          nodeId: ctx.node.id,
          requestId,
          payload: {
            model: escalation.model,
            expectedFreshnessMs: escalation.expectedFreshnessMs,
            actualFreshnessMs: escalation.actualFreshnessMs,
            reason: escalation.reason,
          },
        })
        // Read escalates to primary. Drop replica idx + staleness.
      } else {
        replicaIndex = idx
        stalenessMs = sampledLag
      }
    }
  }

  return [
    ...violations,
    {
      at: ctx.now + latency,
      kind: 'request_complete',
      nodeId: ctx.node.id,
      requestId,
      payload: {
        processingTimeMs: latency,
        success: true,
        // Stamp staleness fields ONLY when a replica was actually chosen —
        // primary-fallback escalations and primary_only routing both omit
        // them entirely (preserves backwards compat digests).
        ...(replicaIndex !== undefined
          ? { stalenessMs, replicaIndex }
          : {}),
      },
    },
  ]
}

/**
 * Returns null if the chosen replica is fresh enough for the active model
 * (or no enforcement applies); returns escalation details when the read must
 * fall back to primary.
 */
function checkConsistencyEscalation(
  model: ConsistencyModel | undefined,
  clientId: string,
  databaseId: string,
  now: number,
  sampledLag: number,
  ctx: Parameters<Behavior>[0],
): {
  model: ConsistencyModel
  expectedFreshnessMs: number
  actualFreshnessMs: number
  reason: string
} | null {
  if (model === 'read_your_writes') {
    const writeAt = ctx.getClientWriteTimestamp(clientId, databaseId)
    if (writeAt === undefined) return null
    // The replica is fresh through (now - sampledLag). To satisfy RYW we need
    // (now - sampledLag) >= writeAt, i.e. sampledLag <= now - writeAt.
    const budget = now - writeAt
    if (sampledLag <= budget) return null
    return {
      model,
      expectedFreshnessMs: budget,
      actualFreshnessMs: sampledLag,
      reason: 'replica_too_stale_for_ryw',
    }
  }
  if (model === 'monotonic_reads') {
    const watermark = ctx.getClientReadFreshness(clientId, databaseId)
    if (watermark === undefined) return null
    // Replica fresh through (now - sampledLag); need >= watermark.
    const budget = now - watermark
    if (sampledLag <= budget) return null
    return {
      model,
      expectedFreshnessMs: budget,
      actualFreshnessMs: sampledLag,
      reason: 'replica_too_stale_for_mr',
    }
  }
  return null
}

/**
 * Phase 6e write path. Writes always go to primary, always succeed in v1,
 * and bypass capacity (write_capacity_rps / queue) entirely. Emits
 * `request_complete` carrying `writeTimestamp` so the engine can populate
 * clientWriteTimestamps for the read_your_writes check.
 */
function startWriteProcessing(
  ctx: Parameters<Behavior>[0],
  requestId: string,
): NewEvent[] {
  const params = getParams(ctx.node)
  const latency = sampleLatency(
    params.write_latency_ms_p50,
    params.write_latency_ms_p99,
    ctx.rng,
  )
  const writeTimestamp = ctx.now + latency
  return [
    {
      at: writeTimestamp,
      kind: 'request_complete',
      nodeId: ctx.node.id,
      requestId,
      payload: {
        processingTimeMs: latency,
        success: true,
        writeTimestamp,
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
  const kind = (ctx.request.causalContext['kind'] as string | undefined) ?? 'read'

  // 6e: writes bypass capacity / queue and run on the dedicated write path.
  if (kind === 'write') {
    return startWriteProcessing(ctx, ctx.request.id)
  }

  if (getInFlightReads(ctx.nodeState) < params.read_capacity_rps) {
    return startReadProcessing(ctx, ctx.request.id)
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
  // Queue path is reads-only — writes never enqueue (they bypass capacity).
  if (next !== undefined) out.push(...startReadProcessing(ctx, next))
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
