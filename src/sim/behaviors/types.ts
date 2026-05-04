import type { Node, Edge } from '@/schema/types'
import type { EventId, RequestId, SimEvent, SimEventKind, SimRequest } from '../types'

/**
 * Context handed to a behavior when an event is dispatched to it.
 * Behaviors are pure functions of context — they describe what should happen
 * next, the engine actually schedules it. No direct queue/log access.
 */
export interface BehaviorContext {
  /** The schema node this behavior is acting for. */
  node: Node
  /** Outgoing edges from this node. */
  outgoing: Edge[]
  /** Incoming edges to this node. */
  incoming: Edge[]
  /** Sub-stream PRNG specific to this node (deterministic given seed + node id). */
  rng: () => number
  /** Current virtual time (ms). */
  now: number
  /** The request being processed, if applicable. */
  request?: SimRequest
  /** The event that triggered this behavior call. */
  triggeringEvent: SimEvent
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
