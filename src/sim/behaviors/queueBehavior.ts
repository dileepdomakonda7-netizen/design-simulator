/**
 * Queue behavior — fire-and-forget producer / decoupled consumer.
 *
 * Handles event kinds:
 *   - request_receive       (producer enqueues a message)
 *   - queue_consumer_tick   (consumer-side dequeue tick scheduled by us)
 *   - request_response      (no-op; consumer-originated requests' responses
 *                            terminate here at the queue origin)
 *
 * Reads ctx.nodeState keys:
 *   - depth              (number) — current queued message count
 *   - tickScheduled      (boolean) — true while a consumer tick is in flight
 *   - consumerCounter    (number) — used to mint deterministic per-consumer
 *                                    request ids
 *
 * Writes ctx.nodeState keys: depth, tickScheduled, consumerCounter
 *
 * Per-type semantics:
 *   When a producer's request_receive arrives:
 *     - If depth >= max_depth, reject with reason 'capacity'.
 *     - Else: increment depth and IMMEDIATELY emit request_response with
 *       success=true back to the producer. The producer's experienced
 *       latency does NOT include consumer processing time. This is the
 *       defining "fire-and-forget" behavior of a queue.
 *     - Schedule a consumer tick if not already pending.
 *
 *   On consumer tick:
 *     - If depth > 0: decrement; mint a NEW request lifecycle (consumer-
 *       side) by emitting a request_send across the first outgoing edge.
 *       The new request has its own requestId; the engine creates its
 *       SimRequest record on first sight of the send.
 *     - If depth > 0 still after decrement, schedule the next tick at
 *       now + 1000/consumer_processing_rps.
 *     - If depth == 0: clear tickScheduled; next producer arrival will
 *       schedule the next tick.
 *
 * v1 simplifications:
 *   - visibility_timeout_ms and delivery_guarantee are stored but not
 *     enforced.
 *   - The consumer side is a simple downstream forward; we don't track
 *     in-flight messages or retries on the consumer side.
 */
import { registerBehavior } from '../behaviorRegistry'
import { defaultNextHop } from '../routing'
import { forwardRequest } from './shared'
import type { Behavior, NewEvent } from './types'
import type { Node } from '@/schema/types'

function getParams(node: Node): Extract<Node, { type: 'queue' }>['params'] {
  if (node.type !== 'queue') {
    throw new Error(`QueueBehavior received non-queue node: ${node.type}`)
  }
  return node.params
}

function getDepth(state: Record<string, unknown>): number {
  return (state['depth'] as number | undefined) ?? 0
}

function setDepth(state: Record<string, unknown>, n: number): void {
  state['depth'] = n
  // Mirror to .queue so buildSnapshot picks up queueDepth.
  state['queue'] = { length: n }
}

function getTickScheduled(state: Record<string, unknown>): boolean {
  return state['tickScheduled'] === true
}

function setTickScheduled(state: Record<string, unknown>, v: boolean): void {
  state['tickScheduled'] = v
}

function nextConsumerRequestId(
  state: Record<string, unknown>,
  nodeId: string,
): string {
  const n = ((state['consumerCounter'] as number | undefined) ?? 0) + 1
  state['consumerCounter'] = n
  return `${nodeId}-c${n}`
}

function consumerTickInterval(rps: number): number {
  return rps > 0 ? 1000 / rps : 1000
}

const onRequestReceive: Behavior = (ctx) => {
  const params = getParams(ctx.node)
  if (!ctx.request) return []

  const depth = getDepth(ctx.nodeState)
  const policy = params.rejection_policy ?? 'reject_newest'
  if (params.max_depth > 0 && depth >= params.max_depth) {
    if (policy === 'reject_oldest') {
      // Phase 6a: silent message loss. Drop the OLDEST queued message,
      // emit a request_reject for it (visible only in the event log /
      // metrics), and accept the new one. The producer of the displaced
      // message was already told success: true on enqueue, so we don't
      // retract that acknowledgment — this is the realistic
      // fire-and-forget queue behavior under sustained overload.
      const out: NewEvent[] = [
        {
          at: ctx.now,
          kind: 'request_reject',
          nodeId: ctx.node.id,
          payload: { reason: 'capacity_displaced', atNodeId: ctx.node.id },
        },
      ]
      // depth stays the same: we drop one and accept one.
      // Producer fire-and-forget response for the new message:
      const producerHopId = ctx.request.path[ctx.request.path.length - 2]
      if (producerHopId) {
        out.push({
          at: ctx.now,
          kind: 'request_response',
          nodeId: producerHopId,
          requestId: ctx.request.id,
          payload: {
            toNodeId: producerHopId,
            fromNodeId: ctx.node.id,
            success: true,
            durationMs: ctx.now - ctx.request.arrivedAt,
          },
        })
      }
      // Schedule consumer tick if not already pending.
      if (!getTickScheduled(ctx.nodeState) && ctx.outgoing.length > 0) {
        setTickScheduled(ctx.nodeState, true)
        out.push({
          at: ctx.now + consumerTickInterval(params.consumer_processing_rps),
          kind: 'queue_consumer_tick',
          nodeId: ctx.node.id,
          payload: {},
        })
      }
      return out
    }
    // reject_newest (default): incoming producer message rejected.
    return [
      {
        at: ctx.now,
        kind: 'request_reject',
        nodeId: ctx.node.id,
        requestId: ctx.request.id,
        payload: { reason: 'capacity', atNodeId: ctx.node.id },
      },
      {
        at: ctx.now,
        kind: 'request_response',
        nodeId: ctx.request.path[ctx.request.path.length - 2] ?? ctx.request.originNodeId,
        requestId: ctx.request.id,
        payload: {
          toNodeId: ctx.request.originNodeId,
          fromNodeId: ctx.node.id,
          success: false,
          durationMs: ctx.now - ctx.request.arrivedAt,
        },
      },
    ]
  }

  setDepth(ctx.nodeState, depth + 1)

  // Producer fire-and-forget: respond immediately with success.
  const producerHopId = ctx.request.path[ctx.request.path.length - 2]
  const out: NewEvent[] = []
  if (producerHopId) {
    out.push({
      at: ctx.now,
      kind: 'request_response',
      nodeId: producerHopId,
      requestId: ctx.request.id,
      payload: {
        toNodeId: producerHopId,
        fromNodeId: ctx.node.id,
        success: true,
        durationMs: ctx.now - ctx.request.arrivedAt,
      },
    })
  }

  // Schedule a consumer tick if none is pending and there's a downstream.
  if (!getTickScheduled(ctx.nodeState) && ctx.outgoing.length > 0) {
    setTickScheduled(ctx.nodeState, true)
    out.push({
      at: ctx.now + consumerTickInterval(params.consumer_processing_rps),
      kind: 'queue_consumer_tick',
      nodeId: ctx.node.id,
      payload: {},
    })
  }

  return out
}

const onConsumerTick: Behavior = (ctx) => {
  const params = getParams(ctx.node)
  setTickScheduled(ctx.nodeState, false)

  const depth = getDepth(ctx.nodeState)
  if (depth <= 0) return []
  setDepth(ctx.nodeState, depth - 1)

  const out: NewEvent[] = []
  const edge = defaultNextHop(ctx.outgoing)
  if (edge) {
    // Mint a new consumer-side request id and forward via send+receive pair.
    const newRequestId = nextConsumerRequestId(ctx.nodeState, ctx.node.id)
    out.push(
      ...forwardRequest(ctx, edge, { newRequestId, atOffset: 0 }),
    )
  }

  // If more queued, schedule the next tick.
  if (depth - 1 > 0) {
    setTickScheduled(ctx.nodeState, true)
    out.push({
      at: ctx.now + consumerTickInterval(params.consumer_processing_rps),
      kind: 'queue_consumer_tick',
      nodeId: ctx.node.id,
      payload: {},
    })
  }
  return out
}

// Consumer-originated requests' responses come back to the queue as their
// originNodeId. The engine drops them on origin arrival; we just no-op so
// the chain doesn't continue.
const onRequestResponse: Behavior = () => []

registerBehavior('queue', 'request_receive', onRequestReceive)
registerBehavior('queue', 'queue_consumer_tick', onConsumerTick)
registerBehavior('queue', 'request_response', onRequestResponse)
