import { SimulationEngine } from './engine'
import type { SimulationWorkerApi } from './workerProtocol'

/**
 * The orchestration surface that worker.ts exposes via Comlink. Pulled into
 * its own module so node-side tests can exercise the run-serialization
 * contract from R3-1 without spinning up a real Web Worker (Vitest's
 * worker support exists but is awkward to thread through Comlink).
 *
 * Each call returns a fresh closure; tests get isolated state per case.
 */
export function createWorkerApi(): SimulationWorkerApi {
  let currentEngine: SimulationEngine | null = null
  // Single-slot promise pipe. Every method that observes the engine awaits
  // it; `start` reassigns it to the promise representing the new run's
  // lifetime. Guarantees:
  //   - cancel returns only after the engine has fully stopped emitting
  //     events (so the caller can safely clear its event ref).
  //   - start observes a fully drained worker (no leftover engine).
  let runQueue: Promise<void> = Promise.resolve()

  return {
    async start(config, onSnapshot, onEvent, onComplete) {
      await runQueue

      const engine = new SimulationEngine(config, onSnapshot, onEvent)
      currentEngine = engine

      let resolveRun: () => void = () => {}
      const run = new Promise<void>((r) => {
        resolveRun = r
      })
      runQueue = run

      try {
        await engine.run()
      } finally {
        currentEngine = null
        onComplete()
        resolveRun()
      }
    },

    async cancel() {
      currentEngine?.cancel()
      // Wait for the running engine (if any) to fully exit before
      // resolving — otherwise the caller will start a new run while the
      // old engine is still emitting events and the new run's event ref
      // is polluted by the old run's tail.
      await runQueue
    },

    async pause() {
      currentEngine?.pause()
    },

    async resume() {
      currentEngine?.resume()
    },

    async setSpeed(multiplier: number) {
      currentEngine?.setSpeed(multiplier)
    },

    async injectChaos() {
      // 4c stub: signature exists for forward compat; live injection deferred.
    },
  }
}
