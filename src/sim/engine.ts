import type {
  EventId,
  RequestId,
  SimEvent,
  SimRequest,
  SimRunConfig,
  SimSnapshot,
} from './types'
import { EventQueue } from './priorityQueue'
import { VirtualClock } from './virtualClock'
import { EventLog } from './eventLog'
import { generateTraffic } from './trafficGenerator'
import { getBehavior } from './behaviorRegistry'
import { subStream } from './prng'
import type { BehaviorContext, NewEvent } from './behaviors/types'

/**
 * Discrete-event simulation engine.
 *
 * Invariants (preserved by the implementation below):
 *
 *   1. The queue is the only mutable scheduling state. Behaviors return desired
 *      events; the engine alone enqueues them.
 *   2. `processEvent` is the only consumer of dequeued events.
 *   3. `scheduleEvent` is the only place that assigns event ids; ids are
 *      monotonically increasing.
 *   4. `causeEventId` defaults to the triggering event's id when a behavior
 *      emits a new event without specifying one.
 *   5. The virtual clock cannot move backward (asserted in VirtualClock).
 *   6. Events with the same `at` fire in id-order (first-scheduled-first).
 *   7. The main loop yields to the event loop every 1000 events so the worker
 *      remains responsive to `cancel()`.
 *   8. Snapshots are NOT in the event log — they are a parallel cadence driven
 *      by `nextSnapshotAt`. Choice documented in PROGRESS.md.
 */
export class SimulationEngine {
  private queue = new EventQueue()
  private clock = new VirtualClock()
  private log = new EventLog()
  private requests = new Map<RequestId, SimRequest>()
  private nextEventId: EventId = 0
  private nextRequestNumber = 0
  private snapshotSeq = 0
  private snapshotIntervalMs = 100
  private nextSnapshotAt = 0
  private cancelled = false

  constructor(
    private readonly config: SimRunConfig,
    private readonly onSnapshot: (snapshot: SimSnapshot) => void,
    private readonly onEvent: (event: SimEvent) => void,
  ) {
    this.snapshotIntervalMs = config.snapshotIntervalMs ?? 100
    this.nextSnapshotAt = this.snapshotIntervalMs
  }

  cancel(): void {
    this.cancelled = true
  }

  /**
   * Runs the simulation to completion or until cancel(). Async because it
   * yields to the event loop periodically — without this, a long simulation
   * would block the worker from receiving cancel messages.
   */
  async run(): Promise<void> {
    // 1. Emit simulation_start at t=0 (id=0).
    this.scheduleEvent({
      at: 0,
      kind: 'simulation_start',
      payload: { seed: this.config.seed, durationMs: this.config.durationMs },
    })

    // 2. Generate all traffic upfront and enqueue. Traffic events come pre-ided
    //    from the generator; the engine adopts its returned counter.
    const traffic = generateTraffic(
      this.config.design,
      this.config.traffic,
      this.config.durationMs,
      this.config.seed,
      this.nextEventId,
      this.nextRequestNumber,
    )
    this.nextEventId = traffic.nextEventId
    this.nextRequestNumber = traffic.nextRequestId
    for (const ev of traffic.events) {
      this.queue.push(ev)
      // Create the SimRequest record now so behaviors can find it on arrival.
      if (ev.kind === 'request_arrival' && ev.requestId && ev.nodeId) {
        this.requests.set(ev.requestId, {
          id: ev.requestId,
          arrivedAt: ev.at,
          originNodeId: ev.nodeId,
          path: [ev.nodeId],
          attempt: 0,
          sessionId: ev.requestId, // v1: session = request; v2 may unify multiple
          causalContext: {},
        })
      }
    }

    // 3. Compile chaos events from ChaosEventSpecs.
    //    4a: stub. Phase 4c implements compilation; if config.chaos is empty
    //    nothing breaks here either way.
    if (this.config.chaos.length > 0) {
      // Reserved for Phase 4c.
    }

    // 4. Schedule simulation_end at the duration boundary.
    this.scheduleEvent({
      at: this.config.durationMs,
      kind: 'simulation_end',
      payload: { reason: 'completed' as const },
    })

    // 5. Main loop.
    let processedSinceYield = 0
    while (!this.cancelled) {
      const next = this.queue.peek()
      if (!next) break
      if (next.at > this.config.durationMs) break

      // Emit any snapshots due before the next event fires.
      while (
        this.nextSnapshotAt <= next.at &&
        this.nextSnapshotAt <= this.config.durationMs
      ) {
        this.clock.advanceTo(this.nextSnapshotAt)
        this.emitSnapshot(this.nextSnapshotAt)
        this.nextSnapshotAt += this.snapshotIntervalMs
      }

      const ev = this.queue.pop()!
      this.clock.advanceTo(ev.at)
      this.log.append(ev)
      this.onEvent(ev)
      this.processEvent(ev)

      if (ev.kind === 'simulation_end') break

      processedSinceYield++
      if (processedSinceYield >= 1000) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        processedSinceYield = 0
      }
    }

    // 6. Final snapshot at the end time.
    this.emitSnapshot(this.clock.now())
  }

  // ─── Event dispatch ───────────────────────────────────────────────────────

  private processEvent(ev: SimEvent): void {
    // Engine-internal events: nothing to dispatch.
    if (ev.kind === 'simulation_start' || ev.kind === 'simulation_end') return
    if (!ev.nodeId) return

    const node = this.config.design.nodes.find((n) => n.id === ev.nodeId)
    if (!node) return

    // 4a simplification: every non-client node dispatches as 'echo'.
    // 4b will use node.type directly and remove 'echo' from the registry.
    const dispatchType = node.type === 'client' ? 'client' : 'echo'
    const behavior = getBehavior(dispatchType, ev.kind)

    const request = ev.requestId ? this.requests.get(ev.requestId) : undefined

    if (behavior) {
      const ctx: BehaviorContext = {
        node,
        outgoing: this.config.design.edges.filter((e) => e.source === node.id),
        incoming: this.config.design.edges.filter((e) => e.target === node.id),
        rng: subStream(this.config.seed, `node:${node.id}`),
        now: this.clock.now(),
        triggeringEvent: ev,
        ...(request ? { request } : {}),
      }
      const newEvents = behavior(ctx)
      for (const ne of newEvents) {
        this.scheduleEvent(this.toSpec(ne, ev.id))
      }
    }

    // 4a fallback: client has no registered behavior, so the engine itself
    // forwards each request_arrival to the next-hop node as a request_receive.
    // 4b moves this into a real client behavior.
    if (ev.kind === 'request_arrival' && request) {
      const outgoing = this.config.design.edges.find((e) => e.source === node.id)
      if (outgoing) {
        const networkLatency = outgoing.params.network_latency_ms_p50 || 1
        this.scheduleEvent({
          at: this.clock.now() + networkLatency,
          kind: 'request_receive',
          nodeId: outgoing.target,
          edgeId: outgoing.id,
          requestId: request.id,
          causeEventId: ev.id,
          payload: { fromNodeId: node.id, networkLatencyMs: networkLatency },
        })
        request.path.push(outgoing.target)
      }
    }
  }

  // ─── Scheduling helpers ───────────────────────────────────────────────────

  /**
   * Convert a behavior's NewEvent into an Omit<SimEvent, 'id'>, defaulting
   * `causeEventId` to the triggering event's id when not supplied.
   *
   * Conditional spreads keep `exactOptionalPropertyTypes` happy: omitted
   * fields stay omitted, never `undefined`.
   */
  private toSpec(ne: NewEvent, defaultCauseId: EventId): Omit<SimEvent, 'id'> {
    return {
      at: ne.at,
      kind: ne.kind,
      causeEventId: ne.causeEventId ?? defaultCauseId,
      ...(ne.nodeId !== undefined ? { nodeId: ne.nodeId } : {}),
      ...(ne.edgeId !== undefined ? { edgeId: ne.edgeId } : {}),
      ...(ne.requestId !== undefined ? { requestId: ne.requestId } : {}),
      ...(ne.payload !== undefined ? { payload: ne.payload } : {}),
    }
  }

  private scheduleEvent(spec: Omit<SimEvent, 'id'>): SimEvent {
    const ev: SimEvent = { ...spec, id: this.nextEventId++ }
    this.queue.push(ev)
    return ev
  }

  // ─── Snapshots ────────────────────────────────────────────────────────────

  private emitSnapshot(at: number): void {
    this.onSnapshot(this.buildSnapshot(at))
  }

  private buildSnapshot(at: number): SimSnapshot {
    const windowMs = 1000
    const windowEvents = this.log.range(Math.max(0, at - windowMs), at)
    const completedInWindow = windowEvents.filter((e) => e.kind === 'request_response')
    const failedInWindow = windowEvents.filter(
      (e) => e.kind === 'request_timeout' || e.kind === 'request_reject',
    )

    const latencies = completedInWindow
      .map((e) => {
        const p = e.payload as { durationMs?: number } | undefined
        return p?.durationMs ?? 0
      })
      .sort((a, b) => a - b)

    const allEvents = this.log.toArray()
    const cumArrivals = countByKind(allEvents, 'request_arrival')
    const cumCompleted = countByKind(allEvents, 'request_response')
    const cumTimedOut = countByKind(allEvents, 'request_timeout')
    const cumRejected = countByKind(allEvents, 'request_reject')

    return {
      at,
      seq: this.snapshotSeq++,
      nodes: Object.fromEntries(
        this.config.design.nodes.map((n) => [
          n.id,
          // 4a: echo behavior doesn't track queues; 4b's real behaviors will.
          { nodeId: n.id, queueDepth: 0, inFlight: 0, state: 'up' as const },
        ]),
      ),
      windowMetrics: {
        windowMs,
        throughputRps: completedInWindow.length / (windowMs / 1000),
        latencyMsP50: percentile(latencies, 0.5),
        latencyMsP95: percentile(latencies, 0.95),
        latencyMsP99: percentile(latencies, 0.99),
        errorRate:
          completedInWindow.length + failedInWindow.length === 0
            ? 0
            : failedInWindow.length /
              (completedInWindow.length + failedInWindow.length),
      },
      cumulativeMetrics: {
        totalRequestsArrived: cumArrivals,
        totalRequestsCompleted: cumCompleted,
        totalRequestsFailed: cumTimedOut + cumRejected,
        totalRequestsRejected: cumRejected,
        totalRequestsTimedOut: cumTimedOut,
      },
    }
  }
}

function countByKind(events: readonly SimEvent[], kind: SimEvent['kind']): number {
  let n = 0
  for (const e of events) if (e.kind === kind) n++
  return n
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.floor((sorted.length - 1) * p)
  return sorted[idx] ?? 0
}
