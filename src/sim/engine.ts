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
 *   1. The queue is the only mutable scheduling state. Behaviors return
 *      desired events; the engine alone enqueues them.
 *   2. `processEvent` is the only consumer of dequeued events.
 *   3. `scheduleEvent` is the only place that assigns event ids; ids are
 *      monotonically increasing.
 *   4. `causeEventId` defaults to the triggering event's id when a behavior
 *      emits a new event without specifying one.
 *   5. The virtual clock cannot move backward (asserted in VirtualClock).
 *   6. Events with the same `at` fire in id order (first-scheduled-first).
 *   7. The main loop yields to the event loop every 1000 events so the
 *      worker remains responsive to `cancel()`.
 *   8. Snapshots are NOT in the event log — parallel cadence via
 *      `nextSnapshotAt`. Choice documented in PROGRESS.md.
 *
 * Per-node state (4b additions):
 *
 *   - `nodeState`: a `Map<string, Record<string, unknown>>` exposed to
 *     behaviors via BehaviorContext.nodeState. Behaviors may freely read
 *     and write their own entry. This is the controlled exception to
 *     behavior purity — necessary for queue depths, RR indices, timeout
 *     guards, etc. State is per-(simulation, node), reset on each run.
 *   - `inFlightByNodeId`: maintained by the engine, exposed read-only to
 *     behaviors. Increment on `request_receive`, decrement on
 *     `request_send` / `request_complete` / `request_reject` /
 *     `request_timeout`. Approximate but good enough for least-connections
 *     routing and for snapshot rendering.
 *   - The engine OWNS path tracking — appends to `request.path` on every
 *     `request_receive` at a new node. Behaviors don't manipulate path.
 *   - The engine auto-creates `SimRequest` records when it sees a
 *     `request_send` for an unknown request id (e.g. queue tick → consumer,
 *     pub/sub fanout). Originator is the node that emitted the send.
 */
export class SimulationEngine {
  private queue = new EventQueue()
  private clock = new VirtualClock()
  private log = new EventLog()
  private requests = new Map<RequestId, SimRequest>()
  private nodeState = new Map<string, Record<string, unknown>>()
  private inFlightByNodeId = new Map<string, number>()
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

  async run(): Promise<void> {
    this.scheduleEvent({
      at: 0,
      kind: 'simulation_start',
      payload: { seed: this.config.seed, durationMs: this.config.durationMs },
    })

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
      if (ev.kind === 'request_arrival' && ev.requestId && ev.nodeId) {
        this.requests.set(ev.requestId, {
          id: ev.requestId,
          arrivedAt: ev.at,
          originNodeId: ev.nodeId,
          path: [ev.nodeId],
          attempt: 0,
          sessionId: ev.requestId,
          causalContext: {},
        })
      }
    }

    if (this.config.chaos.length > 0) {
      // Reserved for Phase 4c.
    }

    this.scheduleEvent({
      at: this.config.durationMs,
      kind: 'simulation_end',
      payload: { reason: 'completed' as const },
    })

    let processedSinceYield = 0
    while (!this.cancelled) {
      const next = this.queue.peek()
      if (!next) break
      if (next.at > this.config.durationMs) break

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

    this.emitSnapshot(this.clock.now())
  }

  // ─── Event dispatch ───────────────────────────────────────────────────────

  private processEvent(ev: SimEvent): void {
    if (ev.kind === 'simulation_start' || ev.kind === 'simulation_end') return
    if (!ev.nodeId) return

    // (a) Auto-create SimRequest on a request_send with a previously-unseen
    //     request id. Used by queue tick → consumer and pub/sub fanout.
    if (
      ev.kind === 'request_send' &&
      ev.requestId &&
      ev.nodeId &&
      !this.requests.has(ev.requestId)
    ) {
      this.requests.set(ev.requestId, {
        id: ev.requestId,
        arrivedAt: ev.at,
        originNodeId: ev.nodeId,
        path: [ev.nodeId],
        attempt: 0,
        sessionId: ev.requestId,
        causalContext: {},
      })
    }

    // (b) Path tracking: append target on receive (forward path only).
    const request = ev.requestId ? this.requests.get(ev.requestId) : undefined
    if (
      ev.kind === 'request_receive' &&
      request &&
      request.path[request.path.length - 1] !== ev.nodeId
    ) {
      request.path.push(ev.nodeId)
    }

    // (c) In-flight bookkeeping (BEFORE behavior so it sees current values).
    this.updateInFlight(ev)

    // (d) Look up the node and its behavior.
    const node = this.config.design.nodes.find((n) => n.id === ev.nodeId)
    if (!node) {
      this.maybeFinalize(ev, request)
      return
    }
    const behavior = getBehavior(node.type, ev.kind)

    if (behavior) {
      const state = this.getOrInitNodeState(node.id)
      // Persistent per-node rng — closure state advances across invocations.
      let rng = state['__rng'] as (() => number) | undefined
      if (!rng) {
        rng = subStream(this.config.seed, `node:${node.id}`)
        state['__rng'] = rng
      }

      const ctx: BehaviorContext = {
        node,
        outgoing: this.config.design.edges.filter((e) => e.source === node.id),
        incoming: this.config.design.edges.filter((e) => e.target === node.id),
        rng,
        now: this.clock.now(),
        triggeringEvent: ev,
        nodeState: state,
        inFlightByNodeId: this.inFlightByNodeId,
        ...(request ? { request } : {}),
      }

      const newEvents = behavior(ctx)
      for (const ne of newEvents) {
        this.scheduleEvent(this.toSpec(ne, ev.id))
      }
    }

    // (e) Finalize at origin (drop from in-flight map). Done AFTER behavior
    //     so the client behavior can read the response one last time.
    this.maybeFinalize(ev, request)
  }

  private maybeFinalize(ev: SimEvent, request: SimRequest | undefined): void {
    if (
      ev.kind === 'request_response' &&
      request &&
      request.originNodeId === ev.nodeId
    ) {
      this.requests.delete(request.id)
    }
  }

  private updateInFlight(ev: SimEvent): void {
    if (!ev.nodeId) return
    const m = this.inFlightByNodeId
    switch (ev.kind) {
      case 'request_receive':
        m.set(ev.nodeId, (m.get(ev.nodeId) ?? 0) + 1)
        break
      case 'request_send':
      case 'request_complete':
      case 'request_reject':
      case 'request_timeout':
        m.set(ev.nodeId, Math.max(0, (m.get(ev.nodeId) ?? 0) - 1))
        break
    }
  }

  private getOrInitNodeState(nodeId: string): Record<string, unknown> {
    let s = this.nodeState.get(nodeId)
    if (!s) {
      s = {}
      this.nodeState.set(nodeId, s)
    }
    return s
  }

  // ─── Scheduling helpers ───────────────────────────────────────────────────

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
    // Only count responses that reached their origin AND were successful.
    const successfulResponses = completedInWindow.filter((e) => {
      const p = e.payload as { success?: boolean; toNodeId?: string } | undefined
      const req = this.requests.get(e.requestId ?? '')
      // After finalization the request is deleted, so we use the heuristic
      // p.toNodeId === origin for completed-and-finalized requests.
      // For window stats, a "completed" request is one whose response payload
      // says success === true at the originator (toNodeId === origin if known).
      return p?.success === true && (!req || req.originNodeId === p.toNodeId)
    })

    const latencies = successfulResponses
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
        this.config.design.nodes.map((n) => {
          const state = this.nodeState.get(n.id)
          const queue = state?.['queue'] as { length?: number } | undefined
          return [
            n.id,
            {
              nodeId: n.id,
              queueDepth: queue?.length ?? 0,
              inFlight: this.inFlightByNodeId.get(n.id) ?? 0,
              state: 'up' as const,
            },
          ]
        }),
      ),
      windowMetrics: {
        windowMs,
        throughputRps: successfulResponses.length / (windowMs / 1000),
        latencyMsP50: percentile(latencies, 0.5),
        latencyMsP95: percentile(latencies, 0.95),
        latencyMsP99: percentile(latencies, 0.99),
        errorRate:
          successfulResponses.length + failedInWindow.length === 0
            ? 0
            : failedInWindow.length /
              (successfulResponses.length + failedInWindow.length),
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
