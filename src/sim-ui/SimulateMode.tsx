import { useCallback, useEffect, useRef, useState } from 'react'
import * as Comlink from 'comlink'
import SimWorker from '@/sim/worker?worker'

import { useDesignStore } from '@/store/designStore'
import { useSimStore } from '@/store/simStore'
import { computeDigest } from '@/sim/digest'
import type {
  SimEvent,
  SimRunConfig,
  SimSnapshot,
  TrafficSource,
} from '@/sim/types'
import type { SimulationWorkerApi } from '@/sim/workerProtocol'

import { ControlPanel } from './ControlPanel'
import { SimulationCanvas } from './SimulationCanvas'
import { MetricsPanel } from './MetricsPanel'
import { EventInspector } from './EventInspector'
import { ChaosTimeline } from './ChaosTimeline'

/**
 * Top-level Simulate-mode container. Owns the worker lifecycle and wires
 * Comlink callbacks into the simStore. Renders the five-panel layout.
 *
 * Layout:
 *
 *   ┌─ ControlPanel ────────────────────────────────┐
 *   ├─ ChaosTimeline ─┬─ SimulationCanvas ──────────┤
 *   │                 │                              │
 *   │                 │                              │
 *   │                 ├─ MetricsPanel ─┬─ Inspector ─┤
 *   └─────────────────┴────────────────┴─────────────┘
 */
export interface DemoModeOptions {
  /** Auto-start the simulation when the component mounts and a design is loaded.
   *  Pre-fills seed/duration from `runConfig` (or sensible defaults). */
  autoStart?: boolean
  /** When the run completes, reset and re-run after 2 seconds. Pairs with
   *  autoStart for the looping landing-page hero. */
  loop?: boolean
  /** Single-line lesson blurb shown in a dismissible banner above the controls. */
  blurb?: string
  /** Optional italic "try this next" follow-up rendered below the blurb. */
  blurbFollowup?: string
  /** Display label for the banner header. */
  label?: string
  /** Override seed/duration/rps for the auto-run. Used by demo scenarios. */
  runConfig?: { seed?: number; durationMs?: number; rps?: number; speed?: number }
  /** Hide the ControlPanel (autoStart + loop drive everything; user input is off). */
  embed?: boolean
  /** Replace the auto-generated single-source traffic with a scenario-defined
   *  list. Required for multi-client / write-ratio scenarios. */
  trafficOverride?: TrafficSource[]
}

export function SimulateMode({
  autoStart,
  loop,
  blurb,
  blurbFollowup,
  label,
  runConfig: demoRun,
  embed,
  trafficOverride,
}: DemoModeOptions = {}) {
  const design = useDesignStore((s) => s.design)
  const status = useSimStore((s) => s.status)
  const config = useSimStore((s) => s.config)
  const setStatus = useSimStore((s) => s.setStatus)
  const setConfig = useSimStore((s) => s.setConfig)
  const setDigest = useSimStore((s) => s.setDigest)
  const setVirtualTime = useSimStore((s) => s.setVirtualTime)
  const appendEvents = useSimStore((s) => s.appendEvents)
  const appendSnapshots = useSimStore((s) => s.appendSnapshots)
  const clearStream = useSimStore((s) => s.clearStream)

  // All events of the current run, accumulated for the digest.
  const allEventsRef = useRef<SimEvent[]>([])

  const workerRef = useRef<Worker | null>(null)
  const apiRef = useRef<Comlink.Remote<SimulationWorkerApi> | null>(null)

  // Round-2 R-10: throttle worker→main updates. The worker emits events
  // one-at-a-time via Comlink.proxy; pushing each through a separate
  // setState made the chart + event-log re-render hundreds of times per
  // simulated second. We buffer in refs and flush on a setInterval at
  // FLUSH_HZ. The refs are also drained on the worker's onComplete so
  // the digest is computed against the full event stream.
  const eventBufferRef = useRef<SimEvent[]>([])
  const snapshotBufferRef = useRef<SimSnapshot[]>([])
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const drainBuffers = useCallback(() => {
    if (eventBufferRef.current.length > 0) {
      appendEvents(eventBufferRef.current)
      eventBufferRef.current = []
    }
    if (snapshotBufferRef.current.length > 0) {
      appendSnapshots(snapshotBufferRef.current)
      snapshotBufferRef.current = []
    }
  }, [appendEvents, appendSnapshots])

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (flushTimerRef.current !== null) {
        clearInterval(flushTimerRef.current)
        flushTimerRef.current = null
      }
      apiRef.current?.cancel()
      workerRef.current?.terminate()
      workerRef.current = null
      apiRef.current = null
    }
  }, [])

  const buildConfig = useCallback(
    (seed: number, durationMs: number, rps: number): SimRunConfig | null => {
      // Demo scenarios provide their own traffic (multi-client, write_ratio,
      // etc). When absent, fall back to the user-flow default: one source
      // hitting the first client at `rps`.
      let traffic: TrafficSource[]
      if (trafficOverride && trafficOverride.length > 0) {
        traffic = trafficOverride
      } else {
        const client = design.nodes.find((n) => n.type === 'client')
        if (!client) return null
        traffic = [
          {
            id: 'sim-source',
            label: 'Run',
            target_node_id: client.id,
            load_shape: { kind: 'constant', rps },
          },
        ]
      }
      return {
        design,
        traffic,
        chaos: design.chaosPlan ?? [],
        durationMs,
        seed,
        snapshotIntervalMs: 100,
      }
    },
    [design, trafficOverride],
  )

  const start = useCallback(
    async (seed: number, durationMs: number, rps: number, speed: number) => {
      const cfg = buildConfig(seed, durationMs, rps)
      if (!cfg) return

      // Reuse the existing worker across runs. Spawning a fresh Worker on
      // every Run (or every loop iteration in autoplay-embed mode) caused
      // the landing-page hero to leak ~1 worker / 5s — visible as repeated
      // `worker.js` requests in the Network panel. Cancel pending work on
      // the existing worker before re-driving it.
      let api = apiRef.current
      if (!api) {
        const worker = new SimWorker()
        api = Comlink.wrap<SimulationWorkerApi>(worker)
        workerRef.current = worker
        apiRef.current = api
      } else {
        await api.cancel()
      }

      clearStream()
      allEventsRef.current = []
      eventBufferRef.current = []
      snapshotBufferRef.current = []
      setConfig(cfg)
      setStatus('running')
      await api.setSpeed(speed)

      // Start the flush loop. ~12 Hz keeps the chart visibly live but
      // collapses many events into a single setState batch.
      if (flushTimerRef.current !== null) clearInterval(flushTimerRef.current)
      flushTimerRef.current = setInterval(drainBuffers, 80)

      const onEvent = (ev: SimEvent) => {
        allEventsRef.current.push(ev)
        eventBufferRef.current.push(ev)
      }
      const onSnapshot = (snap: SimSnapshot) => {
        snapshotBufferRef.current.push(snap)
      }
      const onComplete = () => {
        // Round-3 R3-2 / R3-3: ordering matters. Stop the periodic flush
        // FIRST so a coincident timer fire doesn't double-flush an empty
        // buffer between the final drain and the status transition. Then
        // drain. Then snap the virtual-time indicator to the configured
        // duration so the playback timer reads `durationMs` cleanly
        // instead of freezing at the last sub-tick before sim_end. Then
        // setDigest. Finally setStatus — by this point the store is
        // fully consistent so the metrics card and the COMPLETED pill
        // render in the same paint.
        if (flushTimerRef.current !== null) {
          clearInterval(flushTimerRef.current)
          flushTimerRef.current = null
        }
        drainBuffers()
        setVirtualTime(cfg.durationMs)
        const d = computeDigest(allEventsRef.current)
        setDigest(d)
        const wasCancelled = useSimStore.getState().status === 'cancelled'
        setStatus(wasCancelled ? 'cancelled' : 'completed')
      }

      try {
        await api.start(
          cfg,
          Comlink.proxy(onSnapshot),
          Comlink.proxy(onEvent),
          Comlink.proxy(onComplete),
        )
      } catch (err) {
        console.error('Simulation error', err)
        setStatus('idle')
      }
    },
    [buildConfig, clearStream, drainBuffers, setConfig, setDigest, setStatus, setVirtualTime],
  )

  const pause = useCallback(async () => {
    await apiRef.current?.pause()
    setStatus('paused')
  }, [setStatus])

  const resume = useCallback(async () => {
    await apiRef.current?.resume()
    setStatus('running')
  }, [setStatus])

  const cancel = useCallback(async () => {
    setStatus('cancelled')
    await apiRef.current?.cancel()
  }, [setStatus])

  const reset = useCallback(() => {
    // Cancel the running run but KEEP the worker alive — it's reused on the
    // next start. Termination only happens on component unmount.
    void apiRef.current?.cancel()
    clearStream()
    setConfig(null)
    setVirtualTime(0)
    setStatus('idle')
  }, [clearStream, setConfig, setStatus, setVirtualTime])

  const setSpeed = useCallback(async (multiplier: number) => {
    await apiRef.current?.setSpeed(multiplier)
  }, [])

  // ─── Banner + autoStart/loop wiring (v1 launch demo embeds) ─────────────────

  const [bannerDismissed, setBannerDismissed] = useState(false)

  // autoStart: kick off a run when the design first becomes non-empty AND we're idle.
  useEffect(() => {
    if (!autoStart) return
    if (design.nodes.length === 0) return
    if (status !== 'idle') return
    const seed = demoRun?.seed ?? 42
    const durationMs = demoRun?.durationMs ?? 5000
    const rps = demoRun?.rps ?? 10
    const speed = demoRun?.speed ?? 1
    void start(seed, durationMs, rps, speed)
    // Run-once per mount; re-trigger via the loop effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, design.nodes.length])

  // loop: when a run completes, wait 2s then reset+restart. Cleared on unmount.
  useEffect(() => {
    if (!loop) return
    if (status !== 'completed') return
    const seed = demoRun?.seed ?? 42
    const durationMs = demoRun?.durationMs ?? 5000
    const rps = demoRun?.rps ?? 10
    const speed = demoRun?.speed ?? 1
    const t = setTimeout(() => {
      reset()
      // The reset() above flips status to 'idle'; call start directly so we
      // don't depend on the autoStart effect re-firing (it's gated on a
      // status transition the React batcher may merge).
      void start(seed, durationMs, rps, speed)
    }, 2000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loop, status])

  if (design.nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center text-neutral-600">
        <p className="text-sm font-medium">Simulate</p>
        <p className="text-xs mt-2 max-w-md text-neutral-500">
          The current design is empty. Add a <code className="font-mono">client</code> and at
          least one downstream node in Build mode to run a simulation.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-neutral-50">
      {blurb && !bannerDismissed && (
        <div className="bg-amber-50 border-b border-amber-200 px-3 py-2 flex items-start gap-2 text-xs">
          <span className="font-medium text-amber-900 shrink-0">📚 {label ?? 'Demo'}:</span>
          <span className="flex-1 text-amber-800">
            {blurb}
            {blurbFollowup && (
              <em className="block mt-1 text-amber-700 not-italic">
                <span className="italic">{blurbFollowup}</span>
              </em>
            )}
          </span>
          <button
            onClick={() => setBannerDismissed(true)}
            className="text-amber-700 hover:text-amber-900 shrink-0"
            aria-label="Dismiss demo banner"
          >
            ✕
          </button>
        </div>
      )}
      {!embed && (
        <ControlPanel
          status={status}
          hasConfig={config !== null}
          onRun={start}
          onPause={pause}
          onResume={resume}
          onCancel={cancel}
          onReset={reset}
          onSpeedChange={setSpeed}
        />
      )}
      <div className="flex-1 grid grid-cols-[280px_1fr_360px] grid-rows-[1fr_280px] gap-2 p-2 min-h-0">
        <div className="row-span-2 min-h-0">
          <ChaosTimeline />
        </div>
        <div className="col-span-2 min-h-0">
          <SimulationCanvas />
        </div>
        <div className="min-h-0">
          <MetricsPanel />
        </div>
        <div className="min-h-0">
          <EventInspector />
        </div>
      </div>
    </div>
  )
}
