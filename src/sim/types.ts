import type { Design, TrafficSource, ChaosEventSpec } from '@/schema/types'

// ─── Identifiers ──────────────────────────────────────────────────────────────

/** Monotonically increasing event id. Starts at 0. */
export type EventId = number

/** Monotonically increasing request id. Format: 'req-{n}'. */
export type RequestId = string

// ─── Events ───────────────────────────────────────────────────────────────────

/** All event kinds the engine recognizes in v1. Behaviors can only emit these. */
export type SimEventKind =
  | 'request_arrival'
  | 'request_enqueue'
  | 'request_dequeue'
  | 'request_send'
  | 'request_receive'
  | 'request_complete'
  | 'request_response'
  | 'request_timeout'
  | 'request_retry'
  | 'request_reject'
  | 'node_failure'
  | 'node_recover'
  | 'partition_start'
  | 'partition_end'
  | 'simulation_start'
  | 'simulation_end'
  // 4b: scheduled by the queue behavior to drain its internal queue at
  // consumer_processing_rps. Self-targeted at the queue node; not triggered
  // by request flow.
  | 'queue_consumer_tick'
  // 4c chaos markers — compiled from ChaosEventSpec and processed by the
  // engine to mutate internal state (cache override map) or appear in the
  // log for inspection (traffic spike). Behaviors never see these directly.
  | 'cache_miss_storm_start'
  | 'cache_miss_storm_end'
  | 'traffic_spike_start'
  | 'traffic_spike_end'
  // 6b: per-edge circuit breaker state transitions, emitted by behaviors
  // when an outcome observation crosses a state boundary. Informational —
  // no other behavior reacts to these.
  | 'circuit_breaker_opened'
  | 'circuit_breaker_closed'
  | 'circuit_breaker_half_open'

/**
 * A scheduled event. Immutable once enqueued — behaviors create new events,
 * they never mutate existing ones.
 *
 * Expected `payload` shapes per kind (engine does NOT validate; behaviors are
 * responsible):
 *   request_arrival   { trafficSourceId: string }
 *   request_enqueue   { queueDepth: number }
 *   request_dequeue   { waitTimeMs: number }
 *   request_send      { toNodeId: string, networkLatencyMs: number }
 *   request_receive   { fromNodeId: string, networkLatencyMs: number }
 *   request_complete  { processingTimeMs: number, success: boolean }
 *   request_response  { toNodeId: string, success: boolean, durationMs: number }
 *   request_timeout   { atNodeId: string, timeoutMs: number }
 *   request_retry     { attempt: number }
 *   request_reject    { reason: 'capacity' | 'partition' | 'circuit_open' | 'failed' }
 *   node_failure      { reason?: string }
 *   node_recover      {}
 *   partition_start   { sideA: string[], sideB: string[] }
 *   partition_end     { sideA: string[], sideB: string[] }
 *   simulation_start  { seed: number, durationMs: number }
 *   simulation_end    { reason: 'completed' | 'stopped' }
 */
export interface SimEvent {
  /** Globally unique event id assigned by the engine when enqueued. */
  id: EventId
  /** Virtual time (ms) at which this event fires. */
  at: number
  kind: SimEventKind
  nodeId?: string
  edgeId?: string
  requestId?: RequestId
  /**
   * Id of the event that *caused* this event. Walk this chain backwards to
   * answer "why did this happen?" Always set unless this is a root event
   * (simulation_start, traffic-arrival, chaos-injected events).
   */
  causeEventId?: EventId
  payload?: unknown
}

// ─── Requests ─────────────────────────────────────────────────────────────────

/**
 * Tracks a request as it flows through the system. Mutable across its lifetime.
 * Lives in the engine's in-flight request map until completed/rejected/timed-out.
 *
 * `sessionId` and `causalContext` are unused in v1 but reserved for the v2
 * consistency-model features (SPEC §7) so those don't require schema changes.
 */
export interface SimRequest {
  id: RequestId
  /** Virtual time at which this request entered the system. */
  arrivedAt: number
  /** The node where the request originated (typically a client). */
  originNodeId: string
  /** Path of node ids visited, in order. */
  path: string[]
  /** Retry attempt number; 0 for first attempt. */
  attempt: number
  /** v1: opaque session id; v2: shared across related requests for consistency tracking. */
  sessionId: string
  /** v1: opaque; v2: causal-context object that behaviors propagate unchanged. */
  causalContext: Record<string, unknown>
}

// ─── Snapshots (engine → main thread) ─────────────────────────────────────────

export interface NodeSnapshot {
  nodeId: string
  queueDepth: number
  inFlight: number
  /** v1 uses 'up' / 'down'; 'degraded' reserved for v2 partial-failure features. */
  state: 'up' | 'degraded' | 'down'
  /** Phase 6a: per-snapshot backpressure visibility. */
  queueMaxDepth?: number // undefined = unbounded
  rejectionsInWindow: number // request_reject events at this node in last windowMs
  saturated: boolean // queueDepth >= maxDepth-1 OR inFlight >= capacity
}

export interface WindowMetrics {
  /** Window in virtual ms (default 1000). */
  windowMs: number
  /** Successfully completed requests per second over the window. */
  throughputRps: number
  latencyMsP50: number
  latencyMsP95: number
  latencyMsP99: number
  /** failed / (failed + completed) over the window; 0 if no events. */
  errorRate: number
}

export interface CumulativeMetrics {
  totalRequestsArrived: number
  totalRequestsCompleted: number
  totalRequestsFailed: number
  totalRequestsRejected: number
  totalRequestsTimedOut: number
}

/**
 * Phase 6b: per-edge breaker state for the canvas to render. `cbState` is
 * undefined when the edge has no circuit breaker enabled.
 */
export interface EdgeSnapshot {
  edgeId: string
  cbState?: 'closed' | 'open' | 'half_open'
  failureRate: number // over the breaker's current window (0 if window empty)
  rejectionsByBreakerInWindow: number
}

export interface SimSnapshot {
  /** Virtual time (ms) at which this snapshot was taken. */
  at: number
  /** Snapshot sequence number; starts at 0. */
  seq: number
  nodes: Record<string, NodeSnapshot>
  edges: Record<string, EdgeSnapshot>
  windowMetrics: WindowMetrics
  cumulativeMetrics: CumulativeMetrics
}

// ─── Engine inputs ────────────────────────────────────────────────────────────

/** Full configuration for a single simulation run. Deterministic given identical inputs. */
export interface SimRunConfig {
  design: Design
  traffic: TrafficSource[]
  chaos: ChaosEventSpec[]
  /** Total virtual duration to simulate, in ms. */
  durationMs: number
  /** Global seed for the PRNG. Same seed → identical run. */
  seed: number
  /** How often to emit a SimSnapshot, in virtual ms. Default 100. */
  snapshotIntervalMs?: number
}

export type { TrafficSource, ChaosEventSpec }
