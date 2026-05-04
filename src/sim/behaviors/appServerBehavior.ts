/**
 * App server behavior.
 *
 * Handles event kinds:
 *   - request_receive   (request arrived; either start processing or queue)
 *   - request_complete  (processing finished; emit response, drain queue)
 *   - request_response  (response coming back through us; forward upstream)
 *
 * Reads ctx.nodeState keys:
 *   - queue          (string[]) — request ids waiting for a slot
 *   - processing     (number)   — slots currently busy
 *
 * Writes ctx.nodeState keys: queue, processing
 *
 * Per-type semantics:
 *   Capacity = instances * max_concurrent_per_instance. If a slot is free,
 *   start processing immediately (sample log-normal latency from p50/p99,
 *   schedule request_complete). If full, queue. On complete, emit
 *   request_response (success/failure per failure_rate) toward the
 *   previous hop, then dequeue and start the next queued request.
 *
 * v1 simplifications:
 *   - Queue is unbounded (no rejection on overflow). Phase 6 backpressure
 *     adds bounded queues + rejection policies.
 */
import { registerBehavior } from '../behaviorRegistry'
import { sampleLatency } from '../latency'
import { forwardResponseUpstream } from './shared'
import type { Behavior, NewEvent } from './types'
import type { Node } from '@/schema/types'

function getParams(node: Node): Extract<Node, { type: 'app_server' }>['params'] {
  if (node.type !== 'app_server') {
    throw new Error(`AppServerBehavior received non-app_server node: ${node.type}`)
  }
  return node.params
}

function getQueue(state: Record<string, unknown>): string[] {
  let q = state['queue'] as string[] | undefined
  if (!q) {
    q = []
    state['queue'] = q
  }
  return q
}

function getProcessing(state: Record<string, unknown>): number {
  return (state['processing'] as number | undefined) ?? 0
}

function setProcessing(state: Record<string, unknown>, n: number): void {
  state['processing'] = n
}

function startProcessing(
  ctx: Parameters<Behavior>[0],
  requestId: string,
): NewEvent[] {
  const params = getParams(ctx.node)
  const latency = sampleLatency(
    params.latency_ms_p50,
    params.latency_ms_p99,
    ctx.rng,
  )
  setProcessing(ctx.nodeState, getProcessing(ctx.nodeState) + 1)
  return [
    {
      at: ctx.now,
      kind: 'request_dequeue',
      nodeId: ctx.node.id,
      requestId,
      payload: { waitTimeMs: 0 },
    },
    {
      at: ctx.now + latency,
      kind: 'request_complete',
      nodeId: ctx.node.id,
      requestId,
      payload: { processingTimeMs: latency, success: true },
    },
  ]
}

const onRequestReceive: Behavior = (ctx) => {
  const params = getParams(ctx.node)
  if (!ctx.request) return []
  const capacity = params.instances * params.max_concurrent_per_instance
  const processing = getProcessing(ctx.nodeState)

  if (processing < capacity) {
    return startProcessing(ctx, ctx.request.id)
  }
  // Queue.
  const q = getQueue(ctx.nodeState)
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

const onRequestComplete: Behavior = (ctx) => {
  const params = getParams(ctx.node)
  setProcessing(ctx.nodeState, Math.max(0, getProcessing(ctx.nodeState) - 1))
  const success = ctx.rng() >= params.failure_rate
  const out: NewEvent[] = forwardResponseUpstream(ctx, success)

  // Drain queue: if there's a waiting request and we have a slot, start it.
  const q = getQueue(ctx.nodeState)
  const next = q.shift()
  if (next !== undefined) {
    out.push(...startProcessing(ctx, next))
  }
  return out
}

const onRequestResponse: Behavior = (ctx) => {
  // App servers in the middle of a chain forward responses upstream.
  const payload = ctx.triggeringEvent.payload as { success?: boolean } | undefined
  return forwardResponseUpstream(ctx, payload?.success ?? true)
}

registerBehavior('app_server', 'request_receive', onRequestReceive)
registerBehavior('app_server', 'request_complete', onRequestComplete)
registerBehavior('app_server', 'request_response', onRequestResponse)
