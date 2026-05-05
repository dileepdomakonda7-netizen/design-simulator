/**
 * Object storage behavior.
 *
 * Handles event kinds:
 *   - request_receive   (throughput check; schedule complete at read latency)
 *   - request_complete  (apply failure rate; respond upstream)
 *   - request_response  (forward back if not a leaf)
 *
 * Reads ctx.nodeState keys:
 *   - bytesWindow        (Array<{ at: number; bytes: number }>) — 1s sliding window
 *
 * Writes ctx.nodeState keys: bytesWindow
 *
 * Per-type semantics:
 *   Each request is treated as 1 KB (no schema field for byte size yet).
 *   Maintain a 1-second sliding window of (timestamp, bytes); reject with
 *   reason 'capacity' if the window's total throughput exceeds
 *   throughput_mbps. Otherwise schedule completion at read latency.
 *
 * v1 simplifications:
 *   - All requests treated as reads (no read/write distinction).
 *   - Per-request size hardcoded to 1 KB.
 */
import { registerBehavior } from '../behaviorRegistry'
import { sampleLatency } from '../latency'
import { forwardResponseUpstream, rejectHere } from './shared'
import type { Behavior } from './types'
import type { Node } from '@/schema/types'

function getParams(node: Node): Extract<Node, { type: 'object_storage' }>['params'] {
  if (node.type !== 'object_storage') {
    throw new Error(`ObjectStorageBehavior received non-object_storage node: ${node.type}`)
  }
  return node.params
}

interface BytesEntry {
  at: number
  bytes: number
}

const ASSUMED_BYTES_PER_REQUEST = 1024

function getBytesWindow(state: Record<string, unknown>): BytesEntry[] {
  let w = state['bytesWindow'] as BytesEntry[] | undefined
  if (!w) {
    w = []
    state['bytesWindow'] = w
  }
  return w
}

const onRequestReceive: Behavior = (ctx) => {
  const params = getParams(ctx.node)
  if (!ctx.request) return []

  // 1s sliding-window throughput check.
  const w = getBytesWindow(ctx.nodeState)
  const cutoff = ctx.now - 1000
  while (w.length > 0 && w[0]!.at < cutoff) w.shift()
  const totalBytesInWindow = w.reduce((s, e) => s + e.bytes, 0)
  // throughput_mbps to bytes-per-second: mbps * 1e6 / 8.
  const capBytesPerSecond = (params.throughput_mbps * 1e6) / 8
  if (totalBytesInWindow + ASSUMED_BYTES_PER_REQUEST > capBytesPerSecond) {
    return rejectHere(ctx, 'capacity')
  }
  w.push({ at: ctx.now, bytes: ASSUMED_BYTES_PER_REQUEST })

  // Phase 6c: scale read latency by an active 'slow' degradation on this node.
  const eff = ctx.applyDegradation(
    {
      p50: params.read_latency_ms_p50,
      p99: params.read_latency_ms_p99,
      failure_rate: params.failure_rate,
    },
    ctx.node.id,
  )
  const latency = sampleLatency(eff.p50, eff.p99, ctx.rng)
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

const onRequestComplete: Behavior = (ctx) => {
  const params = getParams(ctx.node)
  // Phase 6c: 'errors' degradation overrides failure_rate.
  const eff = ctx.applyDegradation(
    {
      p50: params.read_latency_ms_p50,
      p99: params.read_latency_ms_p99,
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

registerBehavior('object_storage', 'request_receive', onRequestReceive)
registerBehavior('object_storage', 'request_complete', onRequestComplete)
registerBehavior('object_storage', 'request_response', onRequestResponse)
