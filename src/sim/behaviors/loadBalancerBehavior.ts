/**
 * Load balancer behavior.
 *
 * Handles event kinds:
 *   - request_receive   (route to a downstream target via algorithm)
 *   - request_response  (forward back to previous hop)
 *
 * Reads ctx.nodeState keys:
 *   - rrIndex            (number) — round-robin cursor
 *   - awaiting           (Set<requestId>) — managed by scheduleTimeoutGuard
 *
 * Writes ctx.nodeState keys: rrIndex, awaiting
 *
 * Per-type semantics:
 *   Adds a 1ms LB processing delay, then forwards via params.algorithm.
 *   On response failure, attempts a retry per the outgoing edge's policy
 *   (LB is one of the two retry-capable behaviors per Prompt 4b §5).
 *
 * v1 simplifications:
 *   - max_connections and health_check_interval_ms are stored but not
 *     enforced.
 *   - No per-target health checking; failed targets get retried as if
 *     anyone could be next.
 */
import { registerBehavior } from '../behaviorRegistry'
import {
  defaultNextHop,
  roundRobinNext,
  randomNext,
  leastConnectionsNext,
  consistentHashNext,
} from '../routing'
import {
  forwardRequest,
  forwardResponseUpstream,
  rejectHere,
  scheduleTimeoutGuard,
  clearTimeoutGuard,
  planRetry,
} from './shared'
import type { Behavior, NewEvent } from './types'
import type { Edge, Node } from '@/schema/types'

const LB_PROCESSING_DELAY_MS = 1

function getParams(node: Node): Extract<Node, { type: 'load_balancer' }>['params'] {
  if (node.type !== 'load_balancer') {
    throw new Error(`LoadBalancerBehavior received non-load_balancer node: ${node.type}`)
  }
  return node.params
}

function pickEdge(
  ctx: Parameters<Behavior>[0],
  algo: ReturnType<typeof getParams>['algorithm'],
): Edge | undefined {
  switch (algo) {
    case 'round_robin':
      return roundRobinNext(ctx.outgoing, ctx.nodeState as { rrIndex?: number })
    case 'random':
      return randomNext(ctx.outgoing, ctx.rng)
    case 'least_connections':
      return leastConnectionsNext(ctx.outgoing, ctx.inFlightByNodeId)
    case 'consistent_hash':
      return ctx.request
        ? consistentHashNext(ctx.outgoing, ctx.request.id)
        : defaultNextHop(ctx.outgoing)
  }
}

const onRequestReceive: Behavior = (ctx) => {
  const params = getParams(ctx.node)
  if (!ctx.request) return []

  // Failure injection: the LB itself fails before routing.
  if (params.failure_rate > 0 && ctx.rng() < params.failure_rate) {
    return forwardResponseUpstream(ctx, false)
  }

  const edge = pickEdge(ctx, params.algorithm)
  if (!edge) {
    return rejectHere(ctx, 'failed')
  }

  const events: NewEvent[] = forwardRequest(ctx, edge, {
    atOffset: LB_PROCESSING_DELAY_MS,
  })
  if (edge.params.timeout_ms > 0) {
    events.push(
      scheduleTimeoutGuard(
        ctx.node.id,
        ctx.request.id,
        edge.params.timeout_ms,
        ctx.now + LB_PROCESSING_DELAY_MS,
        ctx.nodeState,
      ),
    )
  }
  return events
}

const onRequestResponse: Behavior = (ctx) => {
  if (!ctx.request) return []
  clearTimeoutGuard(ctx.request.id, ctx.nodeState)
  const payload = ctx.triggeringEvent.payload as { success?: boolean } | undefined
  const success = payload?.success ?? true

  if (!success) {
    // Try to retry along the same outgoing path. We use defaultNextHop here
    // rather than re-running the algorithm to keep retry destination stable.
    const edge = defaultNextHop(ctx.outgoing)
    if (edge) {
      const retry = planRetry(ctx, edge, ctx.request.attempt)
      if (retry) {
        if (edge.params.timeout_ms > 0) {
          retry.events.push(
            scheduleTimeoutGuard(
              ctx.node.id,
              ctx.request.id,
              edge.params.timeout_ms,
              ctx.now,
              ctx.nodeState,
            ),
          )
        }
        return retry.events
      }
    }
  }
  return forwardResponseUpstream(ctx, success)
}

const onRequestTimeout: Behavior = (ctx) => {
  if (!ctx.request) return []
  const wasAwaiting = clearTimeoutGuard(ctx.request.id, ctx.nodeState)
  if (!wasAwaiting) return []
  return forwardResponseUpstream(ctx, false)
}

registerBehavior('load_balancer', 'request_receive', onRequestReceive)
registerBehavior('load_balancer', 'request_response', onRequestResponse)
registerBehavior('load_balancer', 'request_timeout', onRequestTimeout)
