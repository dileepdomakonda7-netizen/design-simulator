import type { SimEvent, SimRunConfig, SimSnapshot } from './types'

/**
 * Comlink-exposed API on the worker side. On the main thread, callbacks must
 * be wrapped with `Comlink.proxy(fn)` because Comlink can't structurally clone
 * functions across the worker boundary.
 */
export interface SimulationWorkerApi {
  /**
   * Starts a simulation. Returns once `run()` has fully completed (or was
   * cancelled). Snapshots and events stream back via the proxied callbacks
   * as the engine produces them; `onComplete` fires once the run terminates.
   */
  start(
    config: SimRunConfig,
    onSnapshot: (snapshot: SimSnapshot) => void,
    onEvent: (event: SimEvent) => void,
    onComplete: () => void,
  ): Promise<void>

  /** Asks the running engine to stop. The engine drains the current event,
   *  emits a final snapshot, then `onComplete` fires. */
  cancel(): Promise<void>
}
