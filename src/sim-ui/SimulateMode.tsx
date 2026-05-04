import { useCallback, useEffect, useRef } from 'react'
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
export function SimulateMode() {
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
      const client = design.nodes.find((n) => n.type === 'client')
      if (!client) return null
      const traffic: TrafficSource[] = [
        {
          id: 'sim-source',
          label: 'Run',
          target_node_id: client.id,
          load_shape: { kind: 'constant', rps },
        },
      ]
      return {
        design,
        traffic,
        chaos: design.chaosPlan ?? [],
        durationMs,
        seed,
        snapshotIntervalMs: 100,
      }
    },
    [design],
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
