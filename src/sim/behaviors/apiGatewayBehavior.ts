/**
 * API gateway behavior.
 *
 * Handles event kinds:
 *   - request_receive   (auth + optional rate-limit + forward)
 *   - request_response  (forward back upstream)
 *   - request_timeout   (forward failure upstream after clearing guard)
 *
 * Reads ctx.nodeState keys:
 *   - rateWindow         (number[]) — recent arrival timestamps for rate limit
 *   - awaiting           (Set<requestId>) — managed by scheduleTimeoutGuard
 *
 * Writes ctx.nodeState keys: rateWindow, awaiting
 *
 * Per-type semantics:
 *   Adds params.auth_overhead_ms (fixed) to every request. If
 *   rate_limit_rps > 0, applies a 1-second sliding window: drop entries
 *   older than 1s, count remaining; reject (failed) if over the cap.
 */
import { registerBehavior } from '../behaviorRegistry'
import { defaultNextHop } from '../routing'
import {
  forwardRequest,
  forwardResponseUpstream,
  rejectHere,
  scheduleTimeoutGuard,
  clearTimeoutGuard,
} from './shared'
import type { Behavior, NewEvent } from './types'
import type { Node } from '@/schema/types'

function getParams(node: Node): Extract<Node, { type: 'api_gateway' }>['params'] {
  if (node.type !== 'api_gateway') {
    throw new Error(`ApiGatewayBehavior received non-api_gateway node: ${node.type}`)
  }
  return node.params
}

function getRateWindow(state: Record<string, unknown>): number[] {
  let w = state['rateWindow'] as number[] | undefined
  if (!w) {
    w = []
    state['rateWindow'] = w
  }
  return w
}

const onRequestReceive: Behavior = (ctx) => {
  const params = getParams(ctx.node)
  if (!ctx.request) return []

  // Built-in failure rate.
  if (params.failure_rate > 0 && ctx.rng() < params.failure_rate) {
    return forwardResponseUpstream(ctx, false)
  }

  // Sliding-window rate limit (1s window).
  if (params.rate_limit_rps > 0) {
    const w = getRateWindow(ctx.nodeState)
    const cutoff = ctx.now - 1000
    while (w.length > 0 && w[0]! < cutoff) w.shift()
    if (w.length >= params.rate_limit_rps) {
      return rejectHere(ctx, 'failed')
    }
    w.push(ctx.now)
  }

  const edge = defaultNextHop(ctx.outgoing)
  if (!edge) return rejectHere(ctx, 'failed')

  const offset = params.auth_overhead_ms
  const events: NewEvent[] = forwardRequest(ctx, edge, { atOffset: offset })
  events.push(
    scheduleTimeoutGuard(
      ctx.node.id,
      ctx.request.id,
      params.timeout_ms,
      ctx.now + offset,
      ctx.nodeState,
    ),
  )
  return events
}

const onRequestResponse: Behavior = (ctx) => {
  if (!ctx.request) return []
  clearTimeoutGuard(ctx.request.id, ctx.nodeState)
  const payload = ctx.triggeringEvent.payload as { success?: boolean } | undefined
  return forwardResponseUpstream(ctx, payload?.success ?? true)
}

const onRequestTimeout: Behavior = (ctx) => {
  if (!ctx.request) return []
  const wasAwaiting = clearTimeoutGuard(ctx.request.id, ctx.nodeState)
  if (!wasAwaiting) return []
  return forwardResponseUpstream(ctx, false)
}

registerBehavior('api_gateway', 'request_receive', onRequestReceive)
registerBehavior('api_gateway', 'request_response', onRequestResponse)
registerBehavior('api_gateway', 'request_timeout', onRequestTimeout)
