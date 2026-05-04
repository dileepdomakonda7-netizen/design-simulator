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

const DEFAULT_SEED = 42
const DEFAULT_DURATION_MS = 5_000
const DEFAULT_RPS = 10
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
 * cyrb53 — fast 53-bit string hash, sufficient for run-to-run determinism digests.
 * Reference: https://stackoverflow.com/a/52171480
 */
function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

/**
 * Determinism digest of an entire run's event stream.
 *
 * The events arrive on the main thread via Comlink-proxied callbacks.
 * postMessage is FIFO within one channel, but defending against any future
 * scheduling drift (Comlink batching, React concurrent rendering interleaving
 * with message handlers, etc.) we re-sort here by the SAME tie-break the
 * priority queue uses: (at, id). The engine assigns `id` monotonically as it
 * schedules events, so the sort-key is fully determined by the engine's
 * scheduling order — independent of the order callbacks happened to fire on
 * the main thread.
 *
 * `id` is also included in the per-event key so two events with the same
 * (at, kind, nodeId, requestId) but different ids contribute different bytes
 * to the hash. Without this, any two same-`at` events would collide.
 */
function computeDigest(events: readonly SimEvent[]): string {
  const sorted = [...events].sort((a, b) => a.at - b.at || a.id - b.id)
  const serial = sorted
    .map(
      (e) => `${e.at}:${e.id}:${e.kind}:${e.nodeId ?? ''}:${e.requestId ?? ''}`,
    )
    .join('|')
  return cyrb53(serial).toString(16)
}

function buildConfig(
  design: ReturnType<typeof useDesignStore.getState>['design'],
  seed: number,
  durationMs: number,
  rps: number,
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
      load_shape: { kind: 'constant', rps },
    },
  ]

  return {
    design,
    traffic,
    chaos: [],
    durationMs,
    seed,
    snapshotIntervalMs: 250,
  }
}

export function SimDebugPage() {
  const design = useDesignStore((s) => s.design)
  const [seed, setSeed] = useState(DEFAULT_SEED)
  const [durationMs, setDurationMs] = useState(DEFAULT_DURATION_MS)
  const [rps, setRps] = useState(DEFAULT_RPS)

  const [running, setRunning] = useState(false)
  const [counters, setCounters] = useState<Counters>(defaultCounters)
  const [virtualTime, setVirtualTime] = useState(0)
  const [recentEvents, setRecentEvents] = useState<SimEvent[]>([])
  const [latestSnapshot, setLatestSnapshot] = useState<SimSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [digest, setDigest] = useState<string | null>(null)

  // All events from the active run — used to compute the determinism digest at end.
  // Kept in a ref (not state) to avoid React re-renders on every event append.
  const allEventsRef = useRef<SimEvent[]>([])

  const workerRef = useRef<Worker | null>(null)
  const apiRef = useRef<Comlink.Remote<SimulationWorkerApi> | null>(null)

  useEffect(() => {
    return () => {
      apiRef.current?.cancel()
      workerRef.current?.terminate()
      workerRef.current = null
      apiRef.current = null
    }
  }, [])

  const config = buildConfig(design, seed, durationMs, rps)

  async function handleRun() {
    if (!config) return
    setError(null)
    setCounters(defaultCounters())
    setRecentEvents([])
    setVirtualTime(0)
    setLatestSnapshot(null)
    setDigest(null)
    allEventsRef.current = []
    setRunning(true)

    apiRef.current?.cancel()
    workerRef.current?.terminate()

    const worker = new SimWorker()
    const api = Comlink.wrap<SimulationWorkerApi>(worker)
    workerRef.current = worker
    apiRef.current = api

    const onEvent = (ev: SimEvent) => {
      allEventsRef.current.push(ev)
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
      setRecentEvents((prev) => [ev, ...prev].slice(0, MAX_EVENTS_DISPLAYED))
    }

    const onSnapshot = (snap: SimSnapshot) => {
      setLatestSnapshot(snap)
    }

    const onComplete = () => {
      const d = computeDigest(allEventsRef.current)
      ;(window as Window & { __lastDigest?: string }).__lastDigest = d
      console.log('digest:', d, '(events:', allEventsRef.current.length + ')')
      setDigest(d)
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

        <NumberInput
          label="seed"
          value={seed}
          onChange={setSeed}
          disabled={running}
          width={70}
        />
        <NumberInput
          label="duration (ms)"
          value={durationMs}
          onChange={setDurationMs}
          disabled={running}
          width={90}
        />
        <NumberInput
          label="rps"
          value={rps}
          onChange={setRps}
          disabled={running}
          width={60}
        />

        {digest && (
          <div className="text-xs font-mono text-neutral-700 ml-2 truncate">
            <span className="text-neutral-400 mr-1">digest</span>
            <span className="select-all">{digest}</span>
          </div>
        )}
        {error && <div className="text-xs text-red-600 ml-auto">{error}</div>}
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

function NumberInput({
  label,
  value,
  onChange,
  disabled,
  width,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  disabled: boolean
  width: number
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-neutral-500">
      <span>{label}</span>
      <input
        type="number"
        min={1}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10)
          if (Number.isFinite(n) && n > 0) onChange(n)
        }}
        style={{ width }}
        className="border border-neutral-300 rounded px-1.5 py-0.5 text-xs font-mono tabular-nums text-neutral-800 disabled:bg-neutral-100 disabled:text-neutral-400"
      />
    </label>
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
