import type { ChaosEventSpec, Design, TrafficSource } from '@/schema/types'
import type { EventId, RequestId, SimEvent } from './types'

/**
 * Compile the user's ChaosEventSpec list into engine SimEvents.
 *
 * - node_crash       → node_failure at at_ms; node_recover at at_ms+duration_ms
 * - network_partition → partition_start at at_ms; partition_end at at_ms+duration_ms
 * - cache_miss_storm → cache_miss_storm_start / cache_miss_storm_end (engine-only)
 * - traffic_spike    → pre-generated extra request_arrival events spaced over the
 *                      window, plus traffic_spike_start / _end markers for log
 *                      inspection. Multiplier of 1.0 = no extras; 2.0 = double.
 *
 * The engine processes start/end events to mutate its internal state (failed
 * nodes set, partition list, cache hit-rate override). Behaviors see the effects
 * through BehaviorContext getters, never by reading raw chaos events.
 */
export interface CompileResult {
  events: SimEvent[]
  nextEventId: EventId
  nextRequestNumber: number
}

/**
 * Clamp chaos end times to the simulation duration. Events scheduled past
 * the duration are silently truncated:
 *
 *   - Spec end past duration → end time clamped to duration. The chaos
 *     window effectively closes when the simulation ends, which is what
 *     the user means anyway.
 *   - Spec start past duration → entire spec is skipped (no events
 *     emitted).
 *
 * Without clamping, end events sit unfired on the priority queue at
 * sim_end. Behaviorally harmless, but it leaks engine state
 * (cacheHitRateOverrides etc.) past sim_end and is a footgun for
 * forensic comparisons of "what was scheduled vs. what fired."
 */
export function compileChaosPlan(
  plan: readonly ChaosEventSpec[],
  design: Design,
  traffic: readonly TrafficSource[],
  durationMs: number,
  startingEventId: EventId,
  startingRequestNumber: number,
): CompileResult {
  const events: SimEvent[] = []
  let nextEventId = startingEventId
  let nextRequestNumber = startingRequestNumber

  const clampEnd = (atMs: number, dur: number): number =>
    Math.min(atMs + dur, durationMs)

  for (const spec of plan) {
    if (spec.at_ms >= durationMs) continue // start past duration → skip entirely

    switch (spec.kind) {
      case 'node_crash': {
        events.push({
          id: nextEventId++,
          at: spec.at_ms,
          kind: 'node_failure',
          nodeId: spec.node_id,
          payload: { reason: 'chaos' },
        })
        events.push({
          id: nextEventId++,
          at: clampEnd(spec.at_ms, spec.duration_ms),
          kind: 'node_recover',
          nodeId: spec.node_id,
          payload: {},
        })
        break
      }
      case 'network_partition': {
        events.push({
          id: nextEventId++,
          at: spec.at_ms,
          kind: 'partition_start',
          payload: { sideA: spec.partition_a, sideB: spec.partition_b },
        })
        events.push({
          id: nextEventId++,
          at: clampEnd(spec.at_ms, spec.duration_ms),
          kind: 'partition_end',
          payload: { sideA: spec.partition_a, sideB: spec.partition_b },
        })
        break
      }
      case 'cache_miss_storm': {
        events.push({
          id: nextEventId++,
          at: spec.at_ms,
          kind: 'cache_miss_storm_start',
          nodeId: spec.node_id,
          payload: {},
        })
        events.push({
          id: nextEventId++,
          at: clampEnd(spec.at_ms, spec.duration_ms),
          kind: 'cache_miss_storm_end',
          nodeId: spec.node_id,
          payload: {},
        })
        break
      }
      case 'traffic_spike': {
        const endMs = clampEnd(spec.at_ms, spec.duration_ms)
        const effectiveDurationMs = endMs - spec.at_ms
        events.push({
          id: nextEventId++,
          at: spec.at_ms,
          kind: 'traffic_spike_start',
          payload: { multiplier: spec.multiplier },
        })
        events.push({
          id: nextEventId++,
          at: endMs,
          kind: 'traffic_spike_end',
          payload: {},
        })
        // Use the CLAMPED duration so we don't generate arrivals past sim end.
        const extraPerSecond = traffic.reduce(
          (acc, src) => acc + baselineRpsOf(src),
          0,
        )
        const totalExtras = Math.max(
          0,
          Math.round((spec.multiplier - 1) * extraPerSecond * (effectiveDurationMs / 1000)),
        )
        if (totalExtras > 0 && traffic.length > 0) {
          const interval = effectiveDurationMs / totalExtras
          // Round-robin spike arrivals across traffic sources so each entry node
          // gets a fair share.
          for (let i = 0; i < totalExtras; i++) {
            const t = spec.at_ms + interval * (i + 0.5)
            const source = traffic[i % traffic.length]!
            const requestId: RequestId = `req-${nextRequestNumber++}`
            events.push({
              id: nextEventId++,
              at: t,
              kind: 'request_arrival',
              nodeId: source.target_node_id,
              requestId,
              payload: { trafficSourceId: source.id, spike: true },
            })
          }
        }
        break
      }
      case 'node_degraded': {
        // Phase 6c: a window during which the target node returns degraded
        // responses (slower, more errors, or both). Engine processes start
        // to insert into degradedNodes map, end to remove. Behaviors read
        // it via ctx.applyDegradation when computing effective params.
        const endsAt = clampEnd(spec.at_ms, spec.duration_ms)
        events.push({
          id: nextEventId++,
          at: spec.at_ms,
          kind: 'node_degraded_start',
          nodeId: spec.node_id,
          payload: { mode: spec.mode, intensity: spec.intensity, endsAt },
        })
        events.push({
          id: nextEventId++,
          at: endsAt,
          kind: 'node_degraded_end',
          nodeId: spec.node_id,
          payload: {},
        })
        break
      }
      case 'saturate_node': {
        // Phase 6a: drive a target node to saturation. Emit synthetic
        // request_receive events directly at the target — no upstream chain.
        // The engine auto-creates a SimRequest from each receive (originNodeId
        // is the target itself; path = [target]). Behavior processes them
        // normally; on completion, forwardResponseUpstream returns [] (origin),
        // so no further events. Burst size scales with capacity.
        const target = design.nodes.find((n) => n.id === spec.node_id)
        if (!target) break
        const cap = saturateCapacityOf(target)
        const totalExtras = Math.max(0, cap * 5)
        const effectiveDurationMs = clampEnd(spec.at_ms, spec.duration_ms) - spec.at_ms
        if (totalExtras > 0 && effectiveDurationMs > 0) {
          const interval = effectiveDurationMs / totalExtras
          for (let i = 0; i < totalExtras; i++) {
            const t = spec.at_ms + interval * (i + 0.5)
            const requestId: RequestId = `req-${nextRequestNumber++}-sat`
            events.push({
              id: nextEventId++,
              at: t,
              kind: 'request_receive',
              nodeId: spec.node_id,
              requestId,
              payload: { fromNodeId: spec.node_id, networkLatencyMs: 0, saturate: true },
            })
          }
        }
        break
      }
    }
  }

  return { events, nextEventId, nextRequestNumber }
}

/** Per-type capacity for saturate_node burst sizing. */
function saturateCapacityOf(node: import('@/schema/types').Node): number {
  switch (node.type) {
    case 'app_server':
      return node.params.instances * node.params.max_concurrent_per_instance
    case 'database':
      return node.params.read_capacity_rps
    case 'queue':
      return node.params.max_depth > 0 ? node.params.max_depth : 100
    case 'cache':
    case 'cdn':
    case 'load_balancer':
    case 'api_gateway':
    case 'pub_sub':
    case 'object_storage':
    case 'external_service':
    case 'client':
      return 50
  }
}

/** Best-effort baseline RPS from a load shape — used only for traffic-spike sizing. */
function baselineRpsOf(source: TrafficSource): number {
  const s = source.load_shape
  switch (s.kind) {
    case 'constant':
      return s.rps
    case 'ramp':
      return (s.start_rps + s.end_rps) / 2
    case 'step':
      return s.steps.reduce((a, st) => a + st.rps, 0) / Math.max(1, s.steps.length)
    case 'spike':
      return s.base_rps
    case 'sine':
      return s.base_rps
    case 'random_burst':
      return s.base_rps
  }
}
