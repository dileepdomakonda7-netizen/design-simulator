import type { Node, Edge } from '@/schema/types'
import type { EventId, RequestId, SimEvent, SimEventKind, SimRequest } from '../types'

/**
 * Context handed to a behavior when an event is dispatched to it.
 *
 * Behaviors are pure functions of context with one CONTROLLED EXCEPTION:
 * `nodeState` is a per-node mutable object the behavior may read and write.
 * Returning new events is otherwise the only way a behavior affects the
 * world. The exception exists because some semantics (a queue's depth, a
 * cache's miss-storm flag, a load balancer's round-robin index, a circuit
 * breaker's open/closed state in v2) require state that survives across
 * events. Putting that state into events makes them carry data only their
 * own emitter cares about — the alternative is much worse.
 *
 * Each behavior file documents the keys it reads and writes at the top.
 */
export interface BehaviorContext {
  /** The schema node this behavior is acting for. */
  node: Node
  /** Outgoing edges from this node. */
  outgoing: Edge[]
  /** Incoming edges to this node. */
  incoming: Edge[]
  /** Sub-stream PRNG specific to this node (deterministic given seed + node id).
   *  Persistent across invocations of this node — state advances over the run. */
  rng: () => number
  /** Current virtual time (ms). */
  now: number
  /** The request being processed, if applicable. */
  request?: SimRequest
  /** The event that triggered this behavior call. */
  triggeringEvent: SimEvent
  /** Per-node mutable scratch space. See exception note above. */
  nodeState: Record<string, unknown>
  /** Read-only view of the engine's in-flight count per target node id.
   *  Used by load balancers for `least_connections` routing. */
  inFlightByNodeId: ReadonlyMap<string, number>
  /** True if the engine considers `nodeId` currently failed (chaos). */
  isNodeDown: (nodeId: string) => boolean
  /** True if there is an active partition between two node ids. */
  isPartitioned: (fromNodeId: string, toNodeId: string) => boolean
  /** Returns the override hit-rate for a cache node during a cache_miss_storm,
   *  or undefined if no override is active. Caches use this in preference to
   *  their static params.hit_rate. */
  getCacheHitRateOverride: (nodeId: string) => number | undefined
  /** Look up an in-flight request by id. Phase 6a reject_oldest needs the
   *  displaced request's `path` to emit a failure response to ITS upstream. */
  getRequest: (id: RequestId) => SimRequest | undefined
  /** Phase 6b: mutable per-edge state, lazily created on first access. Used
   *  for circuit breaker windows / open-time / probe-in-flight bits. Per-
   *  (simulation, edge), reset on each new run. */
  getEdgeState: (edgeId: string) => Record<string, unknown>
  /** Phase 6c: returns the active degradation for `nodeId` if any. Pure read. */
  getDegradation: (nodeId: string) => DegradationState | undefined
  /** Phase 6c: scale latency p50/p99 and override failure_rate per the
   *  active degradation on `nodeId`. Returns a new struct; never mutates
   *  the input. Behaviors call this once per request when computing
   *  effective params. Pure given engine state. */
  applyDegradation: <P extends { p50: number; p99: number; failure_rate: number }>(
    base: P,
    nodeId: string,
  ) => P
}

/**
 * Phase 6c: per-node partial-failure state. Inserted into the engine's
 * degradedNodes map on `node_degraded_start`, removed on `_end`.
 *   - mode = 'slow'             → latency × (1 + intensity*9)
 *   - mode = 'errors'           → failure_rate replaced by min(intensity, 1)
 *   - mode = 'slow_and_errors'  → both apply
 */
export interface DegradationState {
  mode: 'slow' | 'errors' | 'slow_and_errors'
  intensity: number
  startedAt: number
  endsAt: number
}

/**
 * A new event a behavior wants the engine to schedule. The engine assigns the
 * `id` and, if `causeEventId` is omitted, sets it to the triggering event's id.
 */
export interface NewEvent {
  at: number
  kind: SimEventKind
  nodeId?: string
  edgeId?: string
  requestId?: RequestId
  causeEventId?: EventId
  payload?: unknown
}

/**
 * A behavior is a pure function: given context, return events to schedule.
 * The engine is the only thing that mutates the queue, log, or in-flight tables.
 */
export type Behavior = (ctx: BehaviorContext) => NewEvent[]
