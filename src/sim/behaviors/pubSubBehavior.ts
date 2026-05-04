/**
 * Pub/Sub behavior.
 *
 * Handles event kinds:
 *   - request_receive   (publisher fanout — respond immediately; deliver to N subscribers)
 *   - request_response  (no-op for subscriber-side responses; chain terminates here)
 *
 * Reads ctx.nodeState keys:
 *   - subscriberCounter  (number) — minted ids for subscriber-side requests
 *
 * Writes ctx.nodeState keys: subscriberCounter, queue (mirrored for snapshot)
 *
 * Per-type semantics:
 *   On publish:
 *     - Immediately respond to the publisher with success (fire-and-forget).
 *     - For each of the first `subscriber_count` outgoing edges (or all if
 *       fewer), schedule a delivery to that subscriber after a sampled
 *       delivery latency. Each delivery is a fresh request lifecycle with
 *       its own request id.
 *
 * v1 simplifications:
 *   - failure_rate is sampled at publish time only; affects the publisher's
 *     response. Per-subscriber delivery failures are not modeled.
 *   - subscriber_count caps fanout but if outgoing.length is smaller, we
 *     fan to all outgoing and don't fail.
 */
import { registerBehavior } from '../behaviorRegistry'
import { sampleLatency } from '../latency'
import { forwardRequest } from './shared'
import type { Behavior, NewEvent } from './types'
import type { Node } from '@/schema/types'

function getParams(node: Node): Extract<Node, { type: 'pub_sub' }>['params'] {
  if (node.type !== 'pub_sub') {
    throw new Error(`PubSubBehavior received non-pub_sub node: ${node.type}`)
  }
  return node.params
}

function nextSubscriberRequestId(
  state: Record<string, unknown>,
  baseId: string,
  k: number,
): string {
  const n = ((state['subscriberCounter'] as number | undefined) ?? 0) + 1
  state['subscriberCounter'] = n
  return `${baseId}-s${n}-${k}`
}

const onRequestReceive: Behavior = (ctx) => {
  const params = getParams(ctx.node)
  if (!ctx.request) return []

  const out: NewEvent[] = []

  // 1) Publisher fire-and-forget response.
  const publisherHop = ctx.request.path[ctx.request.path.length - 2]
  const publisherSuccess = !(params.failure_rate > 0 && ctx.rng() < params.failure_rate)
  if (publisherHop) {
    out.push({
      at: ctx.now,
      kind: 'request_response',
      nodeId: publisherHop,
      requestId: ctx.request.id,
      payload: {
        toNodeId: publisherHop,
        fromNodeId: ctx.node.id,
        success: publisherSuccess,
        durationMs: ctx.now - ctx.request.arrivedAt,
      },
    })
  }
  if (!publisherSuccess) return out

  // 2) Fan out to subscribers. Cap by min(subscriber_count, outgoing.length).
  const fanout = Math.min(params.subscriber_count, ctx.outgoing.length)
  for (let k = 0; k < fanout; k++) {
    const edge = ctx.outgoing[k]!
    const deliveryDelay = sampleLatency(
      params.delivery_latency_ms_p50,
      params.delivery_latency_ms_p99,
      ctx.rng,
    )
    const newRequestId = nextSubscriberRequestId(ctx.nodeState, ctx.request.id, k)
    out.push(
      ...forwardRequest(ctx, edge, {
        newRequestId,
        atOffset: deliveryDelay,
      }),
    )
  }
  return out
}

// Subscriber-side responses come back to pub_sub as their origin. Engine
// drops them on origin arrival; we just no-op.
const onRequestResponse: Behavior = () => []

registerBehavior('pub_sub', 'request_receive', onRequestReceive)
registerBehavior('pub_sub', 'request_response', onRequestResponse)
