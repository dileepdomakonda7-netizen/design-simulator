import type { EventId, SimEvent } from './types'

/**
 * Append-only event log. Maintains a parallel id→event Map for O(1) lookups
 * (used by causalChain), rebuilt only on append. Range queries are linear
 * in the log size for v1 — fine for short runs (~10k events). Phase 4c can
 * add an indexed view if needed.
 */
export class EventLog {
  private events: SimEvent[] = []
  private byId = new Map<EventId, SimEvent>()

  append(event: SimEvent): void {
    this.events.push(event)
    this.byId.set(event.id, event)
  }

  /** Returns events with `at` in [fromMs, toMs). */
  range(fromMs: number, toMs: number): SimEvent[] {
    const out: SimEvent[] = []
    for (const e of this.events) {
      if (e.at >= fromMs && e.at < toMs) out.push(e)
    }
    return out
  }

  /**
   * Walks `causeEventId` backwards. Returns oldest cause first (root → leaf),
   * with `eventId` itself last. Stops at the first event with no cause set
   * (root events: simulation_start, traffic-arrival, chaos-injected).
   */
  causalChain(eventId: EventId): SimEvent[] {
    const chain: SimEvent[] = []
    let current = this.byId.get(eventId)
    const seen = new Set<EventId>()
    while (current) {
      if (seen.has(current.id)) break // defensive: prevent any pathological cycle
      seen.add(current.id)
      chain.push(current)
      if (current.causeEventId === undefined) break
      current = this.byId.get(current.causeEventId)
    }
    return chain.reverse()
  }

  size(): number {
    return this.events.length
  }

  toArray(): readonly SimEvent[] {
    return this.events
  }
}
