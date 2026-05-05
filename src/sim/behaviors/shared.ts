import type { Edge } from '@/schema/types'
import type { SimRequest } from '../types'
import { sampleEdgeLatency } from '../latency'
import { recordOutcome, shouldReject } from '../circuitBreaker'
import type { BehaviorContext, NewEvent } from './types'

// ─── Forward and reverse helpers ─────────────────────────────────────────────

/**
 * Emit a request_send + request_receive pair to forward the current request
 * over `edge`. Network latency sampled once and used for both events.
 *
 * Use `newRequestId` to MINT a new request lifecycle (e.g., queue tick →
 * consumer; pub/sub → subscriber). The engine notices the new request id
 * on processEvent and creates the matching SimRequest record.
 */
export function forwardRequest(
  ctx: BehaviorContext,
  edge: Edge,
  options?: { atOffset?: number; newRequestId?: string },
): NewEvent[] {
  const requestId = options?.newRequestId ?? ctx.request?.id
  if (!requestId) return []
  const sendAt = ctx.now + (options?.atOffset ?? 0)
  const latency = sampleEdgeLatency(edge, ctx.rng)
  const receiveAt = sendAt + latency
  return [
    {
      at: sendAt,
      kind: 'request_send',
      nodeId: ctx.node.id,
      edgeId: edge.id,
      requestId,
      payload: { toNodeId: edge.target, networkLatencyMs: latency },
    },
    {
      at: receiveAt,
      kind: 'request_receive',
      nodeId: edge.target,
      edgeId: edge.id,
      requestId,
      payload: { fromNodeId: ctx.node.id, networkLatencyMs: latency },
    },
  ]
}

/**
 * Emit a request_response toward the previous hop on the given request's
 * path. Same logic as forwardResponseUpstream but takes the request explicitly
 * — used by Phase 6a reject_oldest to emit a failure response for the
 * DISPLACED request, which is different from `ctx.request`.
 */
export function forwardResponseFor(
  request: SimRequest,
  ctx: Pick<BehaviorContext, 'node' | 'incoming' | 'rng' | 'now'>,
  success: boolean,
  extras?: Record<string, unknown>,
): NewEvent[] {
  const myIndex = request.path.indexOf(ctx.node.id)
  if (myIndex <= 0) return [] // origin or off-path; finalize here
  const previousNodeId = request.path[myIndex - 1]
  if (!previousNodeId) return []
  const reverseEdge = ctx.incoming.find((e) => e.source === previousNodeId)
  const latency = reverseEdge ? sampleEdgeLatency(reverseEdge, ctx.rng) : 0
  return [
    {
      at: ctx.now + latency,
      kind: 'request_response',
      nodeId: previousNodeId,
      ...(reverseEdge ? { edgeId: reverseEdge.id } : {}),
      requestId: request.id,
      payload: {
        toNodeId: previousNodeId,
        fromNodeId: ctx.node.id,
        success,
        durationMs: ctx.now - request.arrivedAt,
        ...(extras ?? {}),
      },
    },
  ]
}

/**
 * Emit a request_response toward the previous hop on `ctx.request`'s path.
 * Returns [] at origin (engine drops the request from in-flight tracking).
 *
 * Phase 6d: auto-propagates `stalenessMs` and `replicaIndex` from
 * ctx.triggeringEvent.payload onto the new response. The database stamps
 * these onto the request_complete payload it emits; every hop on the
 * reverse path then carries them upstream without per-behavior changes.
 * Caller can override / extend via `extras`.
 */
export function forwardResponseUpstream(
  ctx: BehaviorContext,
  success: boolean,
  extras?: Record<string, unknown>,
): NewEvent[] {
  if (!ctx.request) return []
  const auto: Record<string, unknown> = {}
  const trigger = ctx.triggeringEvent.payload as Record<string, unknown> | undefined
  if (trigger) {
    if (typeof trigger['stalenessMs'] === 'number') auto['stalenessMs'] = trigger['stalenessMs']
    if (trigger['replicaIndex'] !== undefined) auto['replicaIndex'] = trigger['replicaIndex']
    // 6e: propagate writeTimestamp from the database's request_complete back
    // to the originating client via every response hop. Diagnostic only —
    // engine reads it directly from the database's request_complete.
    if (typeof trigger['writeTimestamp'] === 'number') auto['writeTimestamp'] = trigger['writeTimestamp']
  }
  return forwardResponseFor(ctx.request, ctx, success, { ...auto, ...(extras ?? {}) })
}

/**
 * Phase 6a backpressure helper: emit a request_reject AND a fast failure
 * response back to the previous hop. Use for capacity rejections where the
 * upstream needs to know quickly so it can retry / fail-fast / circuit-break.
 *
 * Distinct from `rejectHere` (which only logs the reject and lets the
 * upstream's timeout guard fire later) — that pattern is appropriate for
 * partition rejection where the upstream legitimately can't reach us.
 */
export function rejectAndRespond(
  ctx: BehaviorContext,
  reason: 'capacity' | 'capacity_displaced' | 'circuit_open' | 'failed',
  extra: Record<string, unknown> = {},
): NewEvent[] {
  if (!ctx.request) return []
  return [
    {
      at: ctx.now,
      kind: 'request_reject',
      nodeId: ctx.node.id,
      requestId: ctx.request.id,
      payload: { reason, atNodeId: ctx.node.id, ...extra },
    },
    ...forwardResponseUpstream(ctx, false),
  ]
}

/**
 * Phase 6a reject_oldest helper: displace the queued `request`, emit its
 * rejection event AND a failure response for it back to ITS upstream
 * (which is generally the same upstream as ctx.request's, but we use the
 * displaced request's own path to be safe).
 */
export function displaceAndRespond(
  request: SimRequest,
  ctx: BehaviorContext,
  extra: Record<string, unknown> = {},
): NewEvent[] {
  return [
    {
      at: ctx.now,
      kind: 'request_reject',
      nodeId: ctx.node.id,
      requestId: request.id,
      payload: { reason: 'capacity_displaced', atNodeId: ctx.node.id, ...extra },
    },
    ...forwardResponseFor(request, ctx, false),
  ]
}

// ─── Phase 6b — circuit-breaker integration helpers ──────────────────────────
//
// The breaker for edge E lives at E's source node. Two integration points:
//
//   1. Before emitting a request_send over E → call emitWithBreaker (instead
//      of forwardRequest directly). It checks shouldReject; if rejected,
//      emits a request_reject('circuit_open') and a fast failure response
//      upstream — and DOES NOT touch the wire. If allowed, calls
//      forwardRequest and emits the corresponding state-transition event
//      if shouldReject moved the state machine.
//
//   2. When a request_response arrives back at the source for a request
//      that went out over E → call observeOutcomeForCurrentRequest with
//      success/failure derived from the response payload. Also call it on
//      request_timeout. The helper looks up the edge from the request's
//      forward path (path[my_index + 1] is the next-forward-hop) and
//      reports the outcome to the breaker.

/**
 * Forward a request over `edge` with circuit-breaker pre-flight. If the
 * edge has no breaker enabled, equivalent to forwardRequest.
 */
export function emitWithBreaker(
  ctx: BehaviorContext,
  edge: Edge,
  options?: { atOffset?: number; newRequestId?: string },
): NewEvent[] {
  const cb = edge.params.circuit_breaker
  if (!cb || !cb.enabled) {
    return forwardRequest(ctx, edge, options)
  }
  const edgeState = ctx.getEdgeState(edge.id)
  const decision = shouldReject(edgeState, cb, ctx.now)
  if (decision.reject) {
    // Don't touch the wire. The breaker is open (or half-open with a probe
    // already out). Produce a fast failure response upstream.
    return rejectAndRespond(ctx, 'circuit_open', { edgeId: edge.id })
  }
  const events = forwardRequest(ctx, edge, options)
  if (decision.transitionedTo) {
    events.push({
      at: ctx.now,
      kind:
        decision.transitionedTo === 'half_open'
          ? 'circuit_breaker_half_open'
          : decision.transitionedTo === 'open'
            ? 'circuit_breaker_opened'
            : 'circuit_breaker_closed',
      payload: { edgeId: edge.id },
    })
  }
  return events
}

/**
 * Observe an outcome for the breaker on the edge this node sent the
 * `request` over (looked up from the request's forward path). Outcome is
 * success or failure. Returns 0..1 events depending on whether the breaker
 * state changed.
 */
export function observeOutcomeForRequest(
  ctx: BehaviorContext,
  request: SimRequest,
  outcome: 'success' | 'failure',
): NewEvent[] {
  const myIndex = request.path.indexOf(ctx.node.id)
  if (myIndex < 0 || myIndex + 1 >= request.path.length) return []
  const nextHop = request.path[myIndex + 1]
  if (!nextHop) return []
  const edge = ctx.outgoing.find((e) => e.target === nextHop)
  if (!edge) return []
  const cb = edge.params.circuit_breaker
  if (!cb || !cb.enabled) return []
  const edgeState = ctx.getEdgeState(edge.id)
  const result = recordOutcome(edgeState, outcome, cb, ctx.now)
  if (!result.stateChanged) return []
  const kind =
    result.newState === 'open'
      ? 'circuit_breaker_opened'
      : result.newState === 'closed'
        ? 'circuit_breaker_closed'
        : 'circuit_breaker_half_open'
  return [
    {
      at: ctx.now,
      kind,
      payload: {
        edgeId: edge.id,
        ...(result.failureRate !== undefined ? { failureRate: result.failureRate } : {}),
      },
    },
  ]
}

/**
 * Convenience: observe outcome for ctx.request. Returns [] if no current
 * request or path doesn't reach a downstream. Equivalent to calling
 * observeOutcomeForRequest with ctx.request.
 */
export function observeCurrentRequestOutcome(
  ctx: BehaviorContext,
  outcome: 'success' | 'failure',
): NewEvent[] {
  if (!ctx.request) return []
  return observeOutcomeForRequest(ctx, ctx.request, outcome)
}

/** Emit a local request_reject at the current node with the given reason. */
export function rejectHere(
  ctx: BehaviorContext,
  reason: 'capacity' | 'partition' | 'circuit_open' | 'failed',
): NewEvent[] {
  if (!ctx.request) return []
  return [
    {
      at: ctx.now,
      kind: 'request_reject',
      nodeId: ctx.node.id,
      requestId: ctx.request.id,
      payload: { reason },
    },
  ]
}

// ─── Timeout-guard pattern ───────────────────────────────────────────────────
//
// Pattern (used by client / api_gateway / cdn / external_service):
//
//   1. When sending forward, schedule a request_timeout at now + timeout_ms
//      AT the source node. Add request id to nodeState['awaiting'].
//   2. When the response arrives, remove from `awaiting`.
//   3. When the timeout event fires later, check if request id is still
//      in `awaiting`. If yes — real timeout, forward failure upstream. If
//      no — response already came; ignore.

function getAwaiting(state: Record<string, unknown>): Set<string> {
  let s = state['awaiting'] as Set<string> | undefined
  if (!s) {
    s = new Set<string>()
    state['awaiting'] = s
  }
  return s
}

export function scheduleTimeoutGuard(
  sourceNodeId: string,
  requestId: string,
  timeoutMs: number,
  now: number,
  state: Record<string, unknown>,
): NewEvent {
  getAwaiting(state).add(requestId)
  return {
    at: now + timeoutMs,
    kind: 'request_timeout',
    nodeId: sourceNodeId,
    requestId,
    payload: { atNodeId: sourceNodeId, timeoutMs },
  }
}

/**
 * Returns true iff the request was still being awaited (not yet timed out
 * by the response arrival). Behaviors call this on response arrival to
 * suppress a later spurious timeout, AND on timeout fire to gate "real
 * timeout" vs "response already came" handling.
 */
export function clearTimeoutGuard(
  requestId: string,
  state: Record<string, unknown>,
): boolean {
  const s = state['awaiting'] as Set<string> | undefined
  if (!s) return false
  return s.delete(requestId)
}

// ─── Retry pattern (4b: client + load_balancer only) ─────────────────────────
//
// Called when the SOURCE of an outgoing request_send observes a failure
// response from downstream. Either reschedules a retry along `edge`, or
// returns null to indicate "give up; forward failure upstream."
//
// `attempt` is the 0-indexed retry counter. We mirror it on the SimRequest
// for visibility in the event log.

export interface RetryDecision {
  /** Events to schedule (a fresh request_send + request_receive) for the retry. */
  events: NewEvent[]
}

export function planRetry(
  ctx: BehaviorContext,
  edge: Edge,
  attempt: number,
): RetryDecision | null {
  const policy = edge.params.retry_policy
  if (policy.kind === 'none') return null

  // Treat policy.max_retries as max ADDITIONAL attempts beyond the initial.
  // attempt=0 → first retry uses delay; attempt=max_retries-1 → last retry.
  if (attempt >= policy.max_retries) return null

  let delay = 0
  if (policy.kind === 'fixed') {
    delay = policy.delay_ms
  } else {
    // exponential_backoff
    delay = policy.base_delay_ms * Math.pow(2, attempt)
    if (delay > policy.max_delay_ms) delay = policy.max_delay_ms
    if (policy.jitter) delay = delay * (0.5 + ctx.rng() * 0.5)
  }
  // Bump request.attempt so subsequent failures see incremented count.
  if (ctx.request) ctx.request.attempt = attempt + 1
  const retryEvent: NewEvent = {
    at: ctx.now,
    kind: 'request_retry',
    nodeId: ctx.node.id,
    payload: { attempt: attempt + 1 },
    ...(ctx.request ? { requestId: ctx.request.id } : {}),
  }
  // 6b: route the retry through emitWithBreaker so an open breaker
  // short-circuits the retry instead of re-attempting on a known-failing
  // downstream — this is what actually breaks the failure-amplification
  // cycle that is the entire point of the breaker.
  return {
    events: [retryEvent, ...emitWithBreaker(ctx, edge, { atOffset: delay })],
  }
}
