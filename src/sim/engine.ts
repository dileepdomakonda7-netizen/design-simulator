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
import { compileChaosPlan } from './chaos'
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

  private finalResponseIds = new Set<EventId>()
  private cumCompleted = 0
  private cumFailedRequests = 0

  // ─── Chaos state (4c) ─────────────────────────────────────────────────────
  // Mutated only by node_failure / node_recover / partition_start /
  // partition_end / cache_miss_storm_start / _end events. Read by the engine
  // when scheduling events from behaviors and exposed read-only to behaviors
  // via BehaviorContext getters.
  private failedNodes = new Set<string>()
  private partitions: Array<{ a: Set<string>; b: Set<string> }> = []
  private cacheHitRateOverrides = new Map<string, number>()

  // ─── Pause / speed (4c) ───────────────────────────────────────────────────
  private paused = false
  // Speed: > 1 means yield less often (faster engine→UI delivery), < 1 means
  // throttle delivery. Determinism is preserved because virtual time and
  // event scheduling are independent of speed — only the wall-clock pace
  // changes.
  private yieldEvery = 1000
  private yieldDelayMs = 0

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

  pause(): void {
    this.paused = true
  }

  resume(): void {
    this.paused = false
  }

  /**
   * Throttles event delivery to the main thread — does NOT slow virtual time.
   * Determinism: same seed always produces the same event log regardless of
   * speed. Only the wall-clock pace at which events stream out differs.
   */
  setSpeed(multiplier: number): void {
    if (multiplier >= 10) {
      this.yieldEvery = 10000
      this.yieldDelayMs = 0
    } else if (multiplier >= 5) {
      this.yieldEvery = 5000
      this.yieldDelayMs = 0
    } else if (multiplier >= 2) {
      this.yieldEvery = 2000
      this.yieldDelayMs = 0
    } else if (multiplier >= 1) {
      this.yieldEvery = 1000
      this.yieldDelayMs = 0
    } else if (multiplier >= 0.5) {
      this.yieldEvery = 50
      this.yieldDelayMs = 20
    } else if (multiplier >= 0.25) {
      this.yieldEvery = 25
      this.yieldDelayMs = 50
    } else {
      this.yieldEvery = 10
      this.yieldDelayMs = 100
    }
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
      const chaos = compileChaosPlan(
        this.config.chaos,
        this.config.design,
        this.config.traffic,
        this.config.durationMs,
        this.nextEventId,
        this.nextRequestNumber,
      )
      this.nextEventId = chaos.nextEventId
      this.nextRequestNumber = chaos.nextRequestNumber
      for (const ev of chaos.events) {
        this.queue.push(ev)
        // Spike-generated arrivals also need their SimRequest record.
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
    }

    this.scheduleEvent({
      at: this.config.durationMs,
      kind: 'simulation_end',
      payload: { reason: 'completed' as const },
    })

    let processedSinceYield = 0
    while (!this.cancelled) {
      // Pause: busy-wait at 20Hz. Pauses are user-initiated, not high-throughput.
      while (this.paused && !this.cancelled) {
        await new Promise<void>((resolve) => setTimeout(resolve, 50))
      }
      if (this.cancelled) break

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
      if (processedSinceYield >= this.yieldEvery) {
        await new Promise<void>((resolve) =>
          setTimeout(resolve, this.yieldDelayMs),
        )
        processedSinceYield = 0
      }
    }

    this.emitSnapshot(this.clock.now())
  }

  // ─── Event dispatch ───────────────────────────────────────────────────────

  private processEvent(ev: SimEvent): void {
    if (ev.kind === 'simulation_start' || ev.kind === 'simulation_end') return

    // ─── Chaos events: mutate engine state. No behavior dispatch. ────────
    if (ev.kind === 'node_failure' && ev.nodeId) {
      this.failedNodes.add(ev.nodeId)
      return
    }
    if (ev.kind === 'node_recover' && ev.nodeId) {
      this.failedNodes.delete(ev.nodeId)
      return
    }
    if (ev.kind === 'partition_start') {
      const p = ev.payload as { sideA?: string[]; sideB?: string[] } | undefined
      if (p?.sideA && p?.sideB) {
        this.partitions.push({ a: new Set(p.sideA), b: new Set(p.sideB) })
      }
      return
    }
    if (ev.kind === 'partition_end') {
      // Match by side membership; first match removed.
      const p = ev.payload as { sideA?: string[]; sideB?: string[] } | undefined
      if (p?.sideA && p?.sideB) {
        const a = new Set(p.sideA)
        const b = new Set(p.sideB)
        const idx = this.partitions.findIndex(
          (part) => setsEqual(part.a, a) && setsEqual(part.b, b),
        )
        if (idx >= 0) this.partitions.splice(idx, 1)
      }
      return
    }
    if (ev.kind === 'cache_miss_storm_start' && ev.nodeId) {
      this.cacheHitRateOverrides.set(ev.nodeId, 0)
      return
    }
    if (ev.kind === 'cache_miss_storm_end' && ev.nodeId) {
      this.cacheHitRateOverrides.delete(ev.nodeId)
      return
    }
    if (ev.kind === 'traffic_spike_start' || ev.kind === 'traffic_spike_end') {
      // Markers for the event log; the extra arrivals were pre-generated.
      return
    }

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

    // (d) If this is a request_receive at a currently-failed node (chaos),
    //     short-circuit: emit a request_reject and skip behavior dispatch.
    //     The downstream behavior never sees the request.
    if (
      ev.kind === 'request_receive' &&
      ev.nodeId &&
      this.failedNodes.has(ev.nodeId) &&
      ev.requestId
    ) {
      this.scheduleEvent({
        at: this.clock.now(),
        kind: 'request_reject',
        nodeId: ev.nodeId,
        requestId: ev.requestId,
        causeEventId: ev.id,
        payload: { reason: 'failed' },
      })
      this.maybeFinalize(ev, request)
      return
    }

    // (e) Look up the node and its behavior.
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
        isNodeDown: (id) => this.failedNodes.has(id),
        isPartitioned: (from, to) => this.isPartitioned(from, to),
        getCacheHitRateOverride: (id) => this.cacheHitRateOverrides.get(id),
        ...(request ? { request } : {}),
      }

      const newEvents = behavior(ctx)
      for (const ne of newEvents) {
        // Partition interception happens at scheduling time, not at receive
        // time — the rejection is visible immediately, not delayed by network
        // latency. (Per Prompt 4c §10 / SPEC §9.)
        if (
          ne.kind === 'request_send' &&
          ne.nodeId &&
          this.isPartitionedSend(ne)
        ) {
          this.scheduleEvent({
            at: ne.at,
            kind: 'request_reject',
            nodeId: ne.nodeId,
            ...(ne.requestId ? { requestId: ne.requestId } : {}),
            causeEventId: ne.causeEventId ?? ev.id,
            payload: { reason: 'partition' },
          })
          continue
        }
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
      // Mark this response as the FINAL one for its request and bump the
      // appropriate running counter. Window metrics filter against this set.
      this.finalResponseIds.add(ev.id)
      const payload = ev.payload as { success?: boolean } | undefined
      if (payload?.success === false) this.cumFailedRequests++
      else this.cumCompleted++
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

  /**
   * True if `from` and `to` are on opposite sides of any active partition.
   * Bidirectional: a partition between {a, b} blocks traffic in either direction.
   */
  private isPartitioned(from: string, to: string): boolean {
    for (const p of this.partitions) {
      if ((p.a.has(from) && p.b.has(to)) || (p.b.has(from) && p.a.has(to))) {
        return true
      }
    }
    return false
  }

  /** Specialized check for an outgoing request_send NewEvent. */
  private isPartitionedSend(ne: NewEvent): boolean {
    if (ne.kind !== 'request_send' || !ne.nodeId) return false
    const target = (ne.payload as { toNodeId?: string } | undefined)?.toNodeId
    if (!target) return false
    return this.isPartitioned(ne.nodeId, target)
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

    // Final-only filtering: a single request emits N request_response events
    // (one per reverse-path hop). The set built in maybeFinalize identifies
    // which event ids are the FINAL response — i.e. the one that arrived at
    // the request's originator. Throughput, latency, and error rate are
    // derived from finals only; otherwise an N-hop reverse path inflates
    // throughput by N.
    const finalSuccessInWindow: SimEvent[] = []
    const finalFailureInWindow: SimEvent[] = []
    for (const e of windowEvents) {
      if (e.kind !== 'request_response' || !this.finalResponseIds.has(e.id)) continue
      const success = (e.payload as { success?: boolean } | undefined)?.success !== false
      if (success) finalSuccessInWindow.push(e)
      else finalFailureInWindow.push(e)
    }

    const latencies = finalSuccessInWindow
      .map((e) => {
        const p = e.payload as { durationMs?: number } | undefined
        return p?.durationMs ?? 0
      })
      .sort((a, b) => a - b)

    const allEvents = this.log.toArray()
    const cumArrivals = countByKind(allEvents, 'request_arrival')
    // Note: totalRequestsRejected / TimedOut count EVENTS (not unique requests)
    // — informational. totalRequestsCompleted / Failed count finalized requests
    // (one per request) and are running engine counters, so they always
    // satisfy `arrived >= completed + failed`.
    const cumTimedOut = countByKind(allEvents, 'request_timeout')
    const cumRejected = countByKind(allEvents, 'request_reject')

    const totalDecided = finalSuccessInWindow.length + finalFailureInWindow.length

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
        throughputRps: finalSuccessInWindow.length / (windowMs / 1000),
        latencyMsP50: percentile(latencies, 0.5),
        latencyMsP95: percentile(latencies, 0.95),
        latencyMsP99: percentile(latencies, 0.99),
        errorRate: totalDecided === 0 ? 0 : finalFailureInWindow.length / totalDecided,
      },
      cumulativeMetrics: {
        totalRequestsArrived: cumArrivals,
        totalRequestsCompleted: this.cumCompleted,
        totalRequestsFailed: this.cumFailedRequests,
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

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false
  for (const v of a) if (!b.has(v)) return false
  return true
}
