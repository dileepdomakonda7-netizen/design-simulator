import type { ChaosEventSpec } from '@/schema/types'
import type { SimEvent, SimRunConfig, SimSnapshot } from './types'

/**
 * Comlink-exposed API on the worker side. On the main thread, callbacks must
 * be wrapped with `Comlink.proxy(fn)` because Comlink can't structurally clone
 * functions across the worker boundary.
 */
export interface SimulationWorkerApi {
  start(
    config: SimRunConfig,
    onSnapshot: (snapshot: SimSnapshot) => void,
    onEvent: (event: SimEvent) => void,
    onComplete: () => void,
  ): Promise<void>
  cancel(): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  setSpeed(multiplier: number): Promise<void>
  /** Stub: live chaos injection. Implemented signature in 4c; UI exposure is
   *  deferred to a later phase. */
  injectChaos(spec: ChaosEventSpec, atVirtualTimeMs?: number): Promise<void>
}
