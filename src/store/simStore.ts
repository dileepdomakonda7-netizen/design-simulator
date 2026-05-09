import { create } from 'zustand'
import type {
  EventId,
  RequestId,
  SimEvent,
  SimRunConfig,
  SimSnapshot,
} from '@/sim/types'

export type SimStatus = 'idle' | 'running' | 'paused' | 'cancelled' | 'completed'

const MAX_EVENTS = 10000
const MAX_SNAPSHOTS = 600

export interface InFlightRequest {
  requestId: RequestId
  edgeId: string
  startedAt: number
  arrivesAt: number
}

interface SimState {
  status: SimStatus
  currentVirtualTimeMs: number
  digest: string

  config: SimRunConfig | null
  events: SimEvent[]
  snapshots: SimSnapshot[]
  latestSnapshot: SimSnapshot | null
  inFlightRequests: Map<RequestId, InFlightRequest>

  selectedEventId: EventId | null

  // Run lifecycle
  setStatus: (status: SimStatus) => void
  setConfig: (config: SimRunConfig | null) => void
  setDigest: (digest: string) => void
  setVirtualTime: (t: number) => void

  // Streaming data
  appendEvent: (event: SimEvent) => void
  appendEvents: (events: readonly SimEvent[]) => void
  appendSnapshot: (snapshot: SimSnapshot) => void
  appendSnapshots: (snapshots: readonly SimSnapshot[]) => void
  clearStream: () => void

  // Selection
  selectEvent: (id: EventId | null) => void
}

export const useSimStore = create<SimState>()((set) => ({
  status: 'idle',
  currentVirtualTimeMs: 0,
  digest: '',

  config: null,
  events: [],
  snapshots: [],
  latestSnapshot: null,
  inFlightRequests: new Map(),

  selectedEventId: null,

  setStatus: (status) => set({ status }),
  setConfig: (config) => set({ config }),
  setDigest: (digest) => set({ digest }),
  setVirtualTime: (currentVirtualTimeMs) => set({ currentVirtualTimeMs }),

  appendEvent: (event) =>
    set((s) => {
      const events =
        s.events.length >= MAX_EVENTS ? s.events.slice(-MAX_EVENTS + 1) : s.events.slice()
      events.push(event)

      // Maintain in-flight map for edge animations.
      const inFlight = new Map(s.inFlightRequests)
      if (event.kind === 'request_send' && event.requestId && event.edgeId) {
        const payload = event.payload as { networkLatencyMs?: number } | undefined
        const latency = payload?.networkLatencyMs ?? 0
        inFlight.set(event.requestId, {
          requestId: event.requestId,
          edgeId: event.edgeId,
          startedAt: event.at,
          arrivesAt: event.at + latency,
        })
      } else if (event.kind === 'request_receive' && event.requestId) {
        inFlight.delete(event.requestId)
      } else if (
        (event.kind === 'request_reject' || event.kind === 'request_timeout') &&
        event.requestId
      ) {
        inFlight.delete(event.requestId)
      }

      return {
        events,
        inFlightRequests: inFlight,
        currentVirtualTimeMs: event.at,
      }
    }),

  appendSnapshot: (snapshot) =>
    set((s) => {
      const snapshots =
        s.snapshots.length >= MAX_SNAPSHOTS
          ? s.snapshots.slice(-MAX_SNAPSHOTS + 1)
          : s.snapshots.slice()
      snapshots.push(snapshot)
      return {
        snapshots,
        latestSnapshot: snapshot,
        currentVirtualTimeMs: Math.max(s.currentVirtualTimeMs, snapshot.at),
      }
    }),

  // Round-2 R-10: batched variants of appendEvent / appendSnapshot. The
  // worker emits hundreds of events per simulated second; appending each
  // through its own setState pinned the main thread when running 1× live.
  // SimulateMode buffers incoming events/snapshots in a ref and flushes
  // them through the *Batch methods at ~10 Hz, which collapses N renders
  // into one per flush.
  appendEvents: (incoming) =>
    set((s) => {
      if (incoming.length === 0) return s
      const total = s.events.length + incoming.length
      const eventsBase =
        total > MAX_EVENTS
          ? s.events.slice(Math.max(0, s.events.length - (MAX_EVENTS - incoming.length)))
          : s.events.slice()
      const events = eventsBase.concat(incoming)
      const inFlight = new Map(s.inFlightRequests)
      let lastAt = s.currentVirtualTimeMs
      for (const event of incoming) {
        if (event.kind === 'request_send' && event.requestId && event.edgeId) {
          const payload = event.payload as { networkLatencyMs?: number } | undefined
          const latency = payload?.networkLatencyMs ?? 0
          inFlight.set(event.requestId, {
            requestId: event.requestId,
            edgeId: event.edgeId,
            startedAt: event.at,
            arrivesAt: event.at + latency,
          })
        } else if (event.kind === 'request_receive' && event.requestId) {
          inFlight.delete(event.requestId)
        } else if (
          (event.kind === 'request_reject' || event.kind === 'request_timeout') &&
          event.requestId
        ) {
          inFlight.delete(event.requestId)
        }
        if (event.at > lastAt) lastAt = event.at
      }
      return {
        events: events.slice(-MAX_EVENTS),
        inFlightRequests: inFlight,
        currentVirtualTimeMs: lastAt,
      }
    }),

  appendSnapshots: (incoming) =>
    set((s) => {
      if (incoming.length === 0) return s
      const total = s.snapshots.length + incoming.length
      const base =
        total > MAX_SNAPSHOTS
          ? s.snapshots.slice(
              Math.max(0, s.snapshots.length - (MAX_SNAPSHOTS - incoming.length)),
            )
          : s.snapshots.slice()
      const snapshots = base.concat(incoming).slice(-MAX_SNAPSHOTS)
      const latest = snapshots[snapshots.length - 1] ?? s.latestSnapshot
      return {
        snapshots,
        latestSnapshot: latest,
        currentVirtualTimeMs: Math.max(
          s.currentVirtualTimeMs,
          latest?.at ?? s.currentVirtualTimeMs,
        ),
      }
    }),

  clearStream: () =>
    set({
      events: [],
      snapshots: [],
      latestSnapshot: null,
      inFlightRequests: new Map(),
      currentVirtualTimeMs: 0,
      digest: '',
      selectedEventId: null,
    }),

  selectEvent: (id) => set({ selectedEventId: id }),
}))
