import * as Comlink from 'comlink'
import { SimulationEngine } from './engine'
import type { SimulationWorkerApi } from './workerProtocol'

// Behavior modules register themselves at import time via side effects.
// Order doesn't matter — registration is per (componentType, eventKind) pair.
import './behaviors/clientBehavior'
import './behaviors/loadBalancerBehavior'
import './behaviors/apiGatewayBehavior'
import './behaviors/appServerBehavior'
import './behaviors/cacheBehavior'
import './behaviors/databaseBehavior'
import './behaviors/queueBehavior'
import './behaviors/pubSubBehavior'
import './behaviors/cdnBehavior'
import './behaviors/objectStorageBehavior'
import './behaviors/externalServiceBehavior'

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
