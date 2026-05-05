/**
 * App server behavior.
 *
 * Handles event kinds:
 *   - request_receive   (request arrived; process / queue / reject / block)
 *   - request_complete  (processing finished; emit response, drain queue)
 *   - request_response  (response coming back through us; forward upstream)
 *
 * Reads ctx.nodeState keys:
 *   - queue            (string[]) — request ids waiting for a slot
 *   - processing       (number)   — slots currently busy
 *   - blockRetries     (Map<requestId, number>) — Phase 6a block-policy retries
 *
 * Writes ctx.nodeState keys: queue, processing, blockRetries
 *
 * Per-type semantics (Phase 6a backpressure):
 *   Capacity = instances * max_concurrent_per_instance.
 *   1. inFlight < capacity → process immediately.
 *   2. queue.length < queue_max_depth (or unbounded) → enqueue.
 *   3. queue full → apply rejection_policy:
 *      reject_newest (default): emit request_reject + fast failure response upstream
 *      reject_oldest: displace the oldest queued (request_reject + failure response
 *        for THAT request to its upstream); then enqueue the new one.
 *      block: re-schedule the receive at now + 50*2^attempt ms, capped at 5 retries;
 *        on retry exhaustion, fall back to reject_newest semantics.
 *
 *   On complete: decrement processing, forward response upstream, then drain the
 *   queue (shift one if non-empty, increment processing). Order matters:
 *   "decrement → drain → increment" ensures the queue is read with one slot free.
 */
import { registerBehavior } from '../behaviorRegistry'
import { sampleLatency } from '../latency'
import { defaultNextHop } from '../routing'
import {
  emitWithBreaker,
  forwardResponseUpstream,
  observeCurrentRequestOutcome,
  rejectAndRespond,
  displaceAndRespond,
} from './shared'
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

const MAX_BLOCK_RETRIES = 5
const BLOCK_BASE_DELAY_MS = 50

function getBlockRetries(state: Record<string, unknown>): Map<string, number> {
  let m = state['blockRetries'] as Map<string, number> | undefined
  if (!m) {
    m = new Map()
    state['blockRetries'] = m
  }
  return m
}

function startProcessing(
  ctx: Parameters<Behavior>[0],
  requestId: string,
): NewEvent[] {
  const params = getParams(ctx.node)
  // Phase 6c: latency is scaled by any active 'slow' degradation on this node.
  const eff = ctx.applyDegradation(
    {
      p50: params.latency_ms_p50,
      p99: params.latency_ms_p99,
      failure_rate: params.failure_rate,
    },
    ctx.node.id,
  )
  const latency = sampleLatency(eff.p50, eff.p99, ctx.rng)
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

  // 1. Slot free → process immediately.
  if (processing < capacity) {
    // Block retries should be cleared if we finally got through.
    getBlockRetries(ctx.nodeState).delete(ctx.request.id)
    return startProcessing(ctx, ctx.request.id)
  }

  const q = getQueue(ctx.nodeState)
  // Treat undefined OR 0 as unbounded. UI uses 0 as the sentinel because
  // exactOptionalPropertyTypes blocks writing `undefined` through Partial<>.
  const maxDepth = params.queue_max_depth
  const isBounded = maxDepth !== undefined && maxDepth > 0
  const policy = params.rejection_policy ?? 'reject_newest'

  // 2. Queue has space → enqueue.
  if (!isBounded || q.length < (maxDepth as number)) {
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

  // 3. Queue full → apply rejection policy.
  if (policy === 'reject_oldest') {
    // Displace the oldest queued request and respond to ITS upstream.
    const displacedId = q.shift()!
    const displaced = ctx.getRequest(displacedId)
    const out: NewEvent[] = []
    if (displaced) out.push(...displaceAndRespond(displaced, ctx))
    // Enqueue the new request.
    q.push(ctx.request.id)
    out.push({
      at: ctx.now,
      kind: 'request_enqueue',
      nodeId: ctx.node.id,
      requestId: ctx.request.id,
      payload: { queueDepth: q.length },
    })
    return out
  }

  if (policy === 'block') {
    // v1 approximation of flow control: re-schedule the receive after a
    // backoff, give up after MAX_BLOCK_RETRIES. Real production systems
    // do this at the transport layer (HTTP/2 windows, gRPC flow control).
    const retries = getBlockRetries(ctx.nodeState)
    const attempt = (retries.get(ctx.request.id) ?? 0) + 1
    if (attempt > MAX_BLOCK_RETRIES) {
      retries.delete(ctx.request.id)
      return rejectAndRespond(ctx, 'capacity', { queueDepth: q.length })
    }
    retries.set(ctx.request.id, attempt)
    const delay = BLOCK_BASE_DELAY_MS * Math.pow(2, attempt - 1)
    return [
      {
        at: ctx.now + delay,
        kind: 'request_receive',
        nodeId: ctx.node.id,
        requestId: ctx.request.id,
        payload: { fromNodeId: ctx.node.id, networkLatencyMs: 0, blockRetry: attempt },
      },
    ]
  }

  // reject_newest (default).
  return rejectAndRespond(ctx, 'capacity', { queueDepth: q.length })
}

/**
 * On local processing completion: if the app server has a downstream edge,
 * forward the request there (subject to circuit breaker) and wait for the
 * response to come back via onRequestResponse. Otherwise, respond upstream
 * directly. This makes the chain `client → app → db` meaningfully exercise
 * the edge `app → db` (Phase 4 model treated app_server as a leaf).
 *
 * Local processing slot is freed at this point — the downstream call is
 * modeled as async (the slot can take another queued request).
 */
const onRequestComplete: Behavior = (ctx) => {
  const params = getParams(ctx.node)
  setProcessing(ctx.nodeState, Math.max(0, getProcessing(ctx.nodeState) - 1))
  // Phase 6c: failure_rate is overridden by an 'errors' degradation on this node.
  const eff = ctx.applyDegradation(
    {
      p50: params.latency_ms_p50,
      p99: params.latency_ms_p99,
      failure_rate: params.failure_rate,
    },
    ctx.node.id,
  )
  const success = ctx.rng() >= eff.failure_rate

  const out: NewEvent[] = []
  const downstream = success ? defaultNextHop(ctx.outgoing) : undefined
  if (downstream) {
    out.push(...emitWithBreaker(ctx, downstream))
  } else {
    out.push(...forwardResponseUpstream(ctx, success))
  }

  // Drain queue: if there's a waiting request and we have a slot, start it.
  const q = getQueue(ctx.nodeState)
  const next = q.shift()
  if (next !== undefined) {
    out.push(...startProcessing(ctx, next))
  }
  return out
}

/**
 * Response from downstream came back. Observe the outcome for the breaker on
 * the downstream edge, then forward the response upstream toward the client.
 */
const onRequestResponse: Behavior = (ctx) => {
  const payload = ctx.triggeringEvent.payload as { success?: boolean } | undefined
  const success = payload?.success ?? true
  return [
    ...observeCurrentRequestOutcome(ctx, success ? 'success' : 'failure'),
    ...forwardResponseUpstream(ctx, success),
  ]
}

registerBehavior('app_server', 'request_receive', onRequestReceive)
registerBehavior('app_server', 'request_complete', onRequestComplete)
registerBehavior('app_server', 'request_response', onRequestResponse)
