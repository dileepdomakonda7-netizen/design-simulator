/**
 * Client behavior.
 *
 * Handles event kinds:
 *   - request_arrival   (traffic generator drops a fresh request at this client)
 *   - request_response  (a response has come home)
 *   - request_timeout   (a previously-sent request didn't return in time)
 *
 * Reads ctx.nodeState keys:
 *   - awaiting           (Set<requestId>) — managed by scheduleTimeoutGuard
 *
 * Writes ctx.nodeState keys:
 *   - awaiting
 *
 * Per-type semantics:
 *   On arrival, route the request out the default outgoing edge with a
 *   scheduled timeout guard. On response (whether success or failure),
 *   clear the guard; the request is finalized at the engine. On timeout,
 *   if the response hasn't already cleared us, count it as a real timeout.
 *
 * v1 simplifications:
 *   - The CLIENT does not enforce its own params.timeout_ms — per-edge and
 *     per-target timeouts cover the common case. The client's timeout is
 *     used as the default forward timeout if the outgoing edge doesn't
 *     specify a tighter one. Documented at the helper below.
 *   - retry_policy on params.retry_policy is unused; retries are an EDGE
 *     concept in v1 (and gated to client + load_balancer per Prompt 4b §5).
 */
import { registerBehavior } from '../behaviorRegistry'
import { defaultNextHop } from '../routing'
import {
  emitWithBreaker,
  observeCurrentRequestOutcome,
  rejectHere,
  scheduleTimeoutGuard,
  clearTimeoutGuard,
  planRetry,
} from './shared'
import type { Behavior } from './types'
import type { Node } from '@/schema/types'

function getParams(node: Node): Extract<Node, { type: 'client' }>['params'] {
  if (node.type !== 'client') {
    throw new Error(`ClientBehavior received non-client node: ${node.type}`)
  }
  return node.params
}

const onRequestArrival: Behavior = (ctx) => {
  const params = getParams(ctx.node)
  const edge = defaultNextHop(ctx.outgoing)
  if (!edge) {
    // Misconfigured: client has no outgoing edge.
    return rejectHere(ctx, 'failed')
  }
  if (!ctx.request) return []

  const events = emitWithBreaker(ctx, edge)
  const timeoutMs = edge.params.timeout_ms || params.timeout_ms
  events.push(
    scheduleTimeoutGuard(
      ctx.node.id,
      ctx.request.id,
      timeoutMs,
      ctx.now,
      ctx.nodeState,
    ),
  )
  return events
}

const onRequestResponse: Behavior = (ctx) => {
  if (!ctx.request) return []
  // Response arrived — clear any pending timeout guard.
  const wasAwaiting = clearTimeoutGuard(ctx.request.id, ctx.nodeState)
  if (!wasAwaiting) {
    // We already timed out; ignore the late response.
    return []
  }
  const payload = ctx.triggeringEvent.payload as { success?: boolean } | undefined
  const success = payload?.success ?? true

  // Phase 6b: observe the outcome on the breaker for our outgoing edge.
  const breakerEvents = observeCurrentRequestOutcome(
    ctx,
    success ? 'success' : 'failure',
  )

  if (success) {
    return breakerEvents
  }
  // Failure response. Try a retry if the outgoing edge's policy allows.
  const edge = defaultNextHop(ctx.outgoing)
  if (edge) {
    const retry = planRetry(ctx, edge, ctx.request.attempt)
    if (retry) {
      const params = getParams(ctx.node)
      const timeoutMs = edge.params.timeout_ms || params.timeout_ms
      retry.events.push(
        scheduleTimeoutGuard(
          ctx.node.id,
          ctx.request.id,
          timeoutMs,
          ctx.now,
          ctx.nodeState,
        ),
      )
      return [...breakerEvents, ...retry.events]
    }
  }
  return breakerEvents
}

const onRequestTimeout: Behavior = (ctx) => {
  if (!ctx.request) return []
  const wasAwaiting = clearTimeoutGuard(ctx.request.id, ctx.nodeState)
  if (!wasAwaiting) {
    return []
  }
  // Phase 6b: a timeout is a failure observation for the breaker.
  const breakerEvents = observeCurrentRequestOutcome(ctx, 'failure')
  return [
    ...breakerEvents,
    {
      at: ctx.now,
      kind: 'request_response',
      nodeId: ctx.node.id,
      requestId: ctx.request.id,
      payload: {
        toNodeId: ctx.node.id,
        fromNodeId: ctx.node.id,
        success: false,
        durationMs: ctx.now - ctx.request.arrivedAt,
      },
    },
  ]
}

registerBehavior('client', 'request_arrival', onRequestArrival)
registerBehavior('client', 'request_response', onRequestResponse)
registerBehavior('client', 'request_timeout', onRequestTimeout)
