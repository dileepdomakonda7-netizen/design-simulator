/**
 * External service behavior.
 *
 * Handles event kinds:
 *   - request_receive   (rate-limit + schedule complete with timeout guard)
 *   - request_complete  (apply failure_rate; respond upstream)
 *   - request_response  (forward back if not a leaf)
 *   - request_timeout   (synthesize failure response if response hasn't come)
 *
 * Reads ctx.nodeState keys:
 *   - rateWindow         (number[])
 *   - awaiting           (Set<requestId>)
 *
 * Writes ctx.nodeState keys: rateWindow, awaiting
 *
 * Per-type semantics:
 *   Models an external (third-party) service. Schedules processing at
 *   latency_ms_p50/p99. Optional rate_limit_rps with the same 1s sliding
 *   window as api_gateway. Apply timeout_ms via the parallel-scheduled
 *   timeout-guard pattern.
 */
import { registerBehavior } from '../behaviorRegistry'
import { sampleLatency } from '../latency'
import {
  forwardResponseUpstream,
  rejectHere,
  scheduleTimeoutGuard,
  clearTimeoutGuard,
} from './shared'
import type { Behavior, NewEvent } from './types'
import type { Node } from '@/schema/types'

function getParams(node: Node): Extract<Node, { type: 'external_service' }>['params'] {
  if (node.type !== 'external_service') {
    throw new Error(
      `ExternalServiceBehavior received non-external_service node: ${node.type}`,
    )
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

  if (params.rate_limit_rps > 0) {
    const w = getRateWindow(ctx.nodeState)
    const cutoff = ctx.now - 1000
    while (w.length > 0 && w[0]! < cutoff) w.shift()
    if (w.length >= params.rate_limit_rps) {
      return rejectHere(ctx, 'failed')
    }
    w.push(ctx.now)
  }

  // Phase 6c: scale latency by an active 'slow' degradation on this node.
  const eff = ctx.applyDegradation(
    {
      p50: params.latency_ms_p50,
      p99: params.latency_ms_p99,
      failure_rate: params.failure_rate,
    },
    ctx.node.id,
  )
  const latency = sampleLatency(eff.p50, eff.p99, ctx.rng)
  const events: NewEvent[] = [
    {
      at: ctx.now + latency,
      kind: 'request_complete',
      nodeId: ctx.node.id,
      requestId: ctx.request.id,
      payload: { processingTimeMs: latency, success: true },
    },
  ]
  if (params.timeout_ms > 0) {
    events.push(
      scheduleTimeoutGuard(
        ctx.node.id,
        ctx.request.id,
        params.timeout_ms,
        ctx.now,
        ctx.nodeState,
      ),
    )
  }
  return events
}

const onRequestComplete: Behavior = (ctx) => {
  const params = getParams(ctx.node)
  if (!ctx.request) return []
  const wasAwaiting = clearTimeoutGuard(ctx.request.id, ctx.nodeState)
  if (!wasAwaiting && params.timeout_ms > 0) {
    // Timeout already fired; suppress this completion.
    return []
  }
  // Phase 6c: 'errors' degradation overrides failure_rate.
  const eff = ctx.applyDegradation(
    {
      p50: params.latency_ms_p50,
      p99: params.latency_ms_p99,
      failure_rate: params.failure_rate,
    },
    ctx.node.id,
  )
  const success = ctx.rng() >= eff.failure_rate
  return forwardResponseUpstream(ctx, success)
}

const onRequestResponse: Behavior = (ctx) => {
  const payload = ctx.triggeringEvent.payload as { success?: boolean } | undefined
  return forwardResponseUpstream(ctx, payload?.success ?? true)
}

const onRequestTimeout: Behavior = (ctx) => {
  if (!ctx.request) return []
  const wasAwaiting = clearTimeoutGuard(ctx.request.id, ctx.nodeState)
  if (!wasAwaiting) return []
  return forwardResponseUpstream(ctx, false)
}

registerBehavior('external_service', 'request_receive', onRequestReceive)
registerBehavior('external_service', 'request_complete', onRequestComplete)
registerBehavior('external_service', 'request_response', onRequestResponse)
registerBehavior('external_service', 'request_timeout', onRequestTimeout)
