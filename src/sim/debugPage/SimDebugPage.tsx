import { useEffect, useRef, useState } from 'react'
import * as Comlink from 'comlink'
import SimWorker from '@/sim/worker?worker'

import { useDesignStore } from '@/store/designStore'
import type {
  SimEvent,
  SimRunConfig,
  SimSnapshot,
  TrafficSource,
} from '@/sim/types'
import type { SimulationWorkerApi } from '@/sim/workerProtocol'
import { EventLogTable } from './eventLogTable'

const HARDCODED_SEED = 42
const HARDCODED_DURATION_MS = 5_000
const HARDCODED_RPS = 10
const MAX_EVENTS_DISPLAYED = 200

interface Counters {
  events: number
  requestsArrived: number
  requestsCompleted: number
  requestsFailed: number
}

function defaultCounters(): Counters {
  return { events: 0, requestsArrived: 0, requestsCompleted: 0, requestsFailed: 0 }
}

/**
 * Build a SimRunConfig from the currently-loaded design.
 * Returns null if the design has no client node connected to a downstream node.
 */
function buildConfig(
  design: ReturnType<typeof useDesignStore.getState>['design'],
): SimRunConfig | null {
  const client = design.nodes.find((n) => n.type === 'client')
  if (!client) return null
  const outgoing = design.edges.find((e) => e.source === client.id)
  if (!outgoing) return null

  const traffic: TrafficSource[] = [
    {
      id: 'debug-source',
      label: 'Debug',
      target_node_id: client.id,
      load_shape: { kind: 'constant', rps: HARDCODED_RPS },
    },
  ]

  return {
    design,
    traffic,
    chaos: [],
    durationMs: HARDCODED_DURATION_MS,
    seed: HARDCODED_SEED,
    snapshotIntervalMs: 250,
  }
}

export function SimDebugPage() {
  const design = useDesignStore((s) => s.design)
  const [running, setRunning] = useState(false)
  const [counters, setCounters] = useState<Counters>(defaultCounters)
  const [virtualTime, setVirtualTime] = useState(0)
  const [recentEvents, setRecentEvents] = useState<SimEvent[]>([])
  const [latestSnapshot, setLatestSnapshot] = useState<SimSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

  const workerRef = useRef<Worker | null>(null)
  const apiRef = useRef<Comlink.Remote<SimulationWorkerApi> | null>(null)

  // Cleanup any worker on unmount.
  useEffect(() => {
    return () => {
      apiRef.current?.cancel()
      workerRef.current?.terminate()
      workerRef.current = null
      apiRef.current = null
    }
  }, [])

  const config = buildConfig(design)

  async function handleRun() {
    if (!config) return
    setError(null)
    setCounters(defaultCounters())
    setRecentEvents([])
    setVirtualTime(0)
    setLatestSnapshot(null)
    setRunning(true)

    // Tear down any prior worker.
    apiRef.current?.cancel()
    workerRef.current?.terminate()

    const worker = new SimWorker()
    const api = Comlink.wrap<SimulationWorkerApi>(worker)
    workerRef.current = worker
    apiRef.current = api

    const onEvent = (ev: SimEvent) => {
      setVirtualTime(ev.at)
      setCounters((c) => ({
        events: c.events + 1,
        requestsArrived: c.requestsArrived + (ev.kind === 'request_arrival' ? 1 : 0),
        requestsCompleted:
          c.requestsCompleted + (ev.kind === 'request_response' ? 1 : 0),
        requestsFailed:
          c.requestsFailed +
          (ev.kind === 'request_timeout' || ev.kind === 'request_reject' ? 1 : 0),
      }))
      // Newest at the top; cap the displayed list.
      setRecentEvents((prev) => [ev, ...prev].slice(0, MAX_EVENTS_DISPLAYED))
    }

    const onSnapshot = (snap: SimSnapshot) => {
      setLatestSnapshot(snap)
    }

    const onComplete = () => {
      setRunning(false)
    }

    try {
      await api.start(
        config,
        Comlink.proxy(onSnapshot),
        Comlink.proxy(onEvent),
        Comlink.proxy(onComplete),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setRunning(false)
    }
  }

  async function handleCancel() {
    await apiRef.current?.cancel()
  }

  if (!config) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center text-neutral-600">
        <p className="text-sm font-medium">Engine debug page</p>
        <p className="text-xs mt-2 max-w-md text-neutral-500">
          Load a design with a <code className="font-mono">client</code> node connected
          to at least one downstream node to run the engine.
        </p>
      </div>
    )
  }

  const w = latestSnapshot?.windowMetrics
  const c = latestSnapshot?.cumulativeMetrics

  return (
    <div className="flex flex-col h-full bg-neutral-50">
      {/* Controls */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-200 bg-white shrink-0">
        <button
          onClick={handleRun}
          disabled={running}
          className="text-sm px-3 py-1.5 rounded bg-neutral-900 text-white disabled:bg-neutral-300"
        >
          {running ? 'Running…' : 'Run'}
        </button>
        <button
          onClick={handleCancel}
          disabled={!running}
          className="text-sm px-3 py-1.5 rounded border border-neutral-300 disabled:text-neutral-300"
        >
          Cancel
        </button>
        <div className="text-xs text-neutral-500 ml-2 font-mono">
          seed={HARDCODED_SEED} duration={HARDCODED_DURATION_MS}ms rps={HARDCODED_RPS}
        </div>
        {error && <div className="text-xs text-red-600 ml-2">{error}</div>}
      </div>

      {/* Counters */}
      <div className="grid grid-cols-4 gap-px bg-neutral-200 border-b border-neutral-200">
        <Counter label="events" value={counters.events} />
        <Counter label="virtual time" value={`${virtualTime.toFixed(0)} ms`} />
        <Counter label="arrived" value={counters.requestsArrived} />
        <Counter
          label="completed / failed"
          value={`${counters.requestsCompleted} / ${counters.requestsFailed}`}
        />
      </div>

      {/* Snapshot panel */}
      <div className="grid grid-cols-5 gap-px bg-neutral-200 border-b border-neutral-200">
        <Counter
          label="throughput"
          value={w ? `${w.throughputRps.toFixed(1)} rps` : '—'}
        />
        <Counter label="p50" value={w ? `${w.latencyMsP50.toFixed(1)} ms` : '—'} />
        <Counter label="p95" value={w ? `${w.latencyMsP95.toFixed(1)} ms` : '—'} />
        <Counter label="p99" value={w ? `${w.latencyMsP99.toFixed(1)} ms` : '—'} />
        <Counter
          label="error rate"
          value={w ? `${(w.errorRate * 100).toFixed(1)}%` : '—'}
        />
      </div>

      {/* Cumulative */}
      {c && (
        <div className="px-4 py-1.5 text-[10px] uppercase tracking-wider text-neutral-500 bg-white border-b border-neutral-200">
          cumulative — arrived: {c.totalRequestsArrived} · completed:{' '}
          {c.totalRequestsCompleted} · failed: {c.totalRequestsFailed} · rejected:{' '}
          {c.totalRequestsRejected} · timed out: {c.totalRequestsTimedOut}
        </div>
      )}

      {/* Event log */}
      <div className="flex-1 overflow-auto bg-white">
        {recentEvents.length === 0 ? (
          <div className="p-8 text-center text-xs text-neutral-400">
            Click <span className="font-medium">Run</span> to start the engine.
          </div>
        ) : (
          <EventLogTable events={recentEvents} />
        )}
      </div>
    </div>
  )
}

function Counter({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</div>
      <div className="text-sm font-mono tabular-nums">{value}</div>
    </div>
  )
}
