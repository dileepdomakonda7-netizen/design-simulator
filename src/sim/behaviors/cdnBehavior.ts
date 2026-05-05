/**
 * CDN behavior.
 *
 * Handles event kinds:
 *   - request_receive   (hit/miss; on miss, fan out to origin with timeout)
 *   - request_complete  (edge hit completed; respond upstream)
 *   - request_response  (origin response on miss path; forward upstream)
 *   - request_timeout   (origin pull timeout; emit failure upstream)
 *
 * Reads ctx.nodeState keys:
 *   - awaiting           (Set<requestId>)
 *
 * Writes ctx.nodeState keys: awaiting
 *
 * Per-type semantics:
 *   Same hit/miss split as cache but uses edge_latency_* for hits and
 *   origin_pull_timeout_ms for misses. On miss, schedule a timeout guard;
 *   if the response doesn't return by then, emit a synthesized failure
 *   response and ignore any later real response.
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

function getParams(node: Node): Extract<Node, { type: 'cdn' }>['params'] {
  if (node.type !== 'cdn') {
    throw new Error(`CdnBehavior received non-cdn node: ${node.type}`)
  }
  return node.params
}

const onRequestReceive: Behavior = (ctx) => {
  const params = getParams(ctx.node)
  if (!ctx.request) return []

  if (params.failure_rate > 0 && ctx.rng() < params.failure_rate) {
    return rejectHere(ctx, 'failed')
  }

  if (ctx.rng() < params.hit_rate) {
    // Edge hit.
    const latency = sampleLatency(
      params.edge_latency_ms_p50,
      params.edge_latency_ms_p99,
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

  // Miss — forward to origin.
  const edge = defaultNextHop(ctx.outgoing)
  if (!edge) return rejectHere(ctx, 'failed')

  const events: NewEvent[] = emitWithBreaker(ctx, edge)
  events.push(
    scheduleTimeoutGuard(
      ctx.node.id,
      ctx.request.id,
      params.origin_pull_timeout_ms,
      ctx.now,
      ctx.nodeState,
    ),
  )
  return events
}

const onRequestComplete: Behavior = (ctx) => {
  return forwardResponseUpstream(ctx, true)
}

const onRequestResponse: Behavior = (ctx) => {
  if (!ctx.request) return []
  clearTimeoutGuard(ctx.request.id, ctx.nodeState)
  const payload = ctx.triggeringEvent.payload as { success?: boolean } | undefined
  const success = payload?.success ?? true
  return [
    ...observeCurrentRequestOutcome(ctx, success ? 'success' : 'failure'),
    ...forwardResponseUpstream(ctx, success),
  ]
}

const onRequestTimeout: Behavior = (ctx) => {
  if (!ctx.request) return []
  const wasAwaiting = clearTimeoutGuard(ctx.request.id, ctx.nodeState)
  if (!wasAwaiting) return []
  return [
    ...observeCurrentRequestOutcome(ctx, 'failure'),
    ...forwardResponseUpstream(ctx, false),
  ]
}

registerBehavior('cdn', 'request_receive', onRequestReceive)
registerBehavior('cdn', 'request_complete', onRequestComplete)
registerBehavior('cdn', 'request_response', onRequestResponse)
registerBehavior('cdn', 'request_timeout', onRequestTimeout)
