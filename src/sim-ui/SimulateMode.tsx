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
  const appendEvent = useSimStore((s) => s.appendEvent)
  const appendSnapshot = useSimStore((s) => s.appendSnapshot)
  const clearStream = useSimStore((s) => s.clearStream)

  // All events of the current run, accumulated for the digest.
  const allEventsRef = useRef<SimEvent[]>([])

  const workerRef = useRef<Worker | null>(null)
  const apiRef = useRef<Comlink.Remote<SimulationWorkerApi> | null>(null)

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
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

      // Tear down any prior worker.
      apiRef.current?.cancel()
      workerRef.current?.terminate()

      clearStream()
      allEventsRef.current = []
      setConfig(cfg)
      setStatus('running')

      const worker = new SimWorker()
      const api = Comlink.wrap<SimulationWorkerApi>(worker)
      workerRef.current = worker
      apiRef.current = api
      await api.setSpeed(speed)

      const onEvent = (ev: SimEvent) => {
        allEventsRef.current.push(ev)
        appendEvent(ev)
      }
      const onSnapshot = (snap: SimSnapshot) => {
        appendSnapshot(snap)
      }
      const onComplete = () => {
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
    [appendEvent, appendSnapshot, buildConfig, clearStream, setConfig, setDigest, setStatus],
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
    apiRef.current?.cancel()
    workerRef.current?.terminate()
    workerRef.current = null
    apiRef.current = null
    clearStream()
    setConfig(null)
    setStatus('idle')
  }, [clearStream, setConfig, setStatus])

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
