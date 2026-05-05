/**
 * Cache behavior.
 *
 * Handles event kinds:
 *   - request_receive   (sample hit rate; respond on hit, forward on miss)
 *   - request_response  (response from origin returning to caller — forward upstream)
 *
 * Reads ctx.nodeState keys: (none)
 * Writes ctx.nodeState keys: (none)
 *
 * Per-type semantics:
 *   On receive: sample params.hit_rate. Hit → respond with read latency.
 *   Miss → forward to next hop (an outgoing edge). On response back, forward
 *   upstream after a small read-latency sample (the cache "served" it).
 *
 * v1 simplifications:
 *   - capacity_items and eviction_policy are stored but not enforced.
 *   - hit_rate is a fixed probability, not modeled from real fill behavior.
 *     The cache does NOT populate itself on the response path. Phase 6
 *     could model fill dynamics.
 */
import { registerBehavior } from '../behaviorRegistry'
import { defaultNextHop } from '../routing'
import { sampleLatency } from '../latency'
import {
  emitWithBreaker,
  forwardResponseUpstream,
  observeCurrentRequestOutcome,
  rejectHere,
  scheduleTimeoutGuard,
  clearTimeoutGuard,
} from './shared'
import type { Behavior, NewEvent } from './types'
import type { Node } from '@/schema/types'

function getParams(node: Node): Extract<Node, { type: 'cache' }>['params'] {
  if (node.type !== 'cache') {
    throw new Error(`CacheBehavior received non-cache node: ${node.type}`)
  }
  return node.params
}

const onRequestReceive: Behavior = (ctx) => {
  const params = getParams(ctx.node)
  if (!ctx.request) return []

  // Phase 6c: degradation scales read latency and/or replaces failure_rate.
  // hit_rate is NOT degraded — only latency/error parameters.
  const eff = ctx.applyDegradation(
    {
      p50: params.read_latency_ms_p50,
      p99: params.read_latency_ms_p99,
      failure_rate: params.failure_rate,
    },
    ctx.node.id,
  )

  // Failure injection.
  if (eff.failure_rate > 0 && ctx.rng() < eff.failure_rate) {
    return rejectHere(ctx, 'failed')
  }

  // Cache-miss-storm chaos can override hit_rate to 0 for a window.
  const hitRate = ctx.getCacheHitRateOverride(ctx.node.id) ?? params.hit_rate
  if (ctx.rng() < hitRate) {
    // Hit — respond after read latency.
    const latency = sampleLatency(eff.p50, eff.p99, ctx.rng)
    // Schedule a request_complete so the cache's response uses the same
    // forward-upstream path other behaviors use. We dispatch on
    // request_complete via a registered handler below.
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

  // Miss — forward to next hop (typically a database).
  const edge = defaultNextHop(ctx.outgoing)
  if (!edge) {
    // Cache miss with nothing downstream — treat as failure.
    return rejectHere(ctx, 'failed')
  }
  const events: NewEvent[] = emitWithBreaker(ctx, edge)
  // Phase 6c bugfix: enforce edge timeout_ms on miss-path origin call.
  if (edge.params.timeout_ms > 0) {
    events.push(
      scheduleTimeoutGuard(
        ctx.node.id,
        ctx.request.id,
        edge.params.timeout_ms,
        ctx.now,
        ctx.nodeState,
      ),
    )
  }
  return events
}

const onRequestComplete: Behavior = (ctx) => {
  // Hit completed locally; forward response upstream.
  return forwardResponseUpstream(ctx, true)
}

const onRequestResponse: Behavior = (ctx) => {
  if (!ctx.request) return []
  // Phase 6c bugfix: drop ghost responses that arrive after the edge timeout fired.
  const wasAwaiting = clearTimeoutGuard(ctx.request.id, ctx.nodeState)
  const hadGuard = ctx.outgoing.some((e) => e.params.timeout_ms > 0)
  if (hadGuard && !wasAwaiting) return []

  // Origin response on miss path. Observe outcome for the cache→origin
  // edge breaker, then forward upstream.
  const payload = ctx.triggeringEvent.payload as { success?: boolean } | undefined
  const success = payload?.success ?? true
  return [
    ...observeCurrentRequestOutcome(ctx, success ? 'success' : 'failure'),
    ...forwardResponseUpstream(ctx, success),
  ]
}

/** Phase 6c bugfix: edge timeout fired before origin responded. */
const onRequestTimeout: Behavior = (ctx) => {
  if (!ctx.request) return []
  const wasAwaiting = clearTimeoutGuard(ctx.request.id, ctx.nodeState)
  if (!wasAwaiting) return []
  return [
    ...observeCurrentRequestOutcome(ctx, 'failure'),
    ...forwardResponseUpstream(ctx, false),
  ]
}

registerBehavior('cache', 'request_receive', onRequestReceive)
registerBehavior('cache', 'request_complete', onRequestComplete)
registerBehavior('cache', 'request_response', onRequestResponse)
registerBehavior('cache', 'request_timeout', onRequestTimeout)
