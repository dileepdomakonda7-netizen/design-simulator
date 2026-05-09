import * as Comlink from 'comlink'
import { createWorkerApi } from './workerApi'

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

Comlink.expose(createWorkerApi())
