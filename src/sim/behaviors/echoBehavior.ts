import { registerBehavior } from '../behaviorRegistry'

/**
 * Trivial "echo" behavior used ONLY by the 4a debug page.
 *
 * - When a request_receive lands, schedule a request_complete after a fixed delay.
 * - When a request_completes, immediately emit a request_response back to the
 *   originator with the total round-trip duration.
 *
 * This isn't a realistic service model — it has no queueing, no failure,
 * no retries, no capacity. It exists to exercise the engine end-to-end:
 *   client.arrival → (engine forwards) → echo.receive → echo.complete → response
 *
 * 4b replaces this with real per-ComponentType behaviors.
 */
const ECHO_DELAY_MS = 10

registerBehavior('echo', 'request_receive', (ctx) => {
  if (!ctx.request) return []
  return [
    {
      at: ctx.now + ECHO_DELAY_MS,
      kind: 'request_complete',
      nodeId: ctx.node.id,
      requestId: ctx.request.id,
      payload: { processingTimeMs: ECHO_DELAY_MS, success: true },
    },
  ]
})

registerBehavior('echo', 'request_complete', (ctx) => {
  if (!ctx.request) return []
  const durationMs = ctx.now - ctx.request.arrivedAt
  return [
    {
      at: ctx.now,
      kind: 'request_response',
      nodeId: ctx.request.originNodeId,
      requestId: ctx.request.id,
      payload: {
        toNodeId: ctx.request.originNodeId,
        success: true,
        durationMs,
      },
    },
  ]
})
