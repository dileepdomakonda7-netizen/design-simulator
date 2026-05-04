import * as Comlink from 'comlink'
import { SimulationEngine } from './engine'
import type { SimulationWorkerApi } from './workerProtocol'

// Behavior modules register themselves at import time via side effects.
// 4a: only echo. 4b will replace this with the 11 real per-type behaviors.
import './behaviors/echoBehavior'

let currentEngine: SimulationEngine | null = null

const api: SimulationWorkerApi = {
  async start(config, onSnapshot, onEvent, onComplete) {
    const engine = new SimulationEngine(config, onSnapshot, onEvent)
    currentEngine = engine
    try {
      await engine.run()
    } finally {
      currentEngine = null
      onComplete()
    }
  },

  async cancel() {
    currentEngine?.cancel()
  },
}

Comlink.expose(api)
