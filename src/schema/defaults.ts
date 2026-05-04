import { nanoid } from 'nanoid'
import type {
  ComponentType,
  EdgeKind,
  Node,
  Edge,
  Design,
  ClientParams,
  LoadBalancerParams,
  ApiGatewayParams,
  AppServerParams,
  CacheParams,
  DatabaseParams,
  QueueParams,
  PubSubParams,
  CdnParams,
  ObjectStorageParams,
  ExternalServiceParams,
} from './types'

// ─── Per-type default params ──────────────────────────────────────────────────

const clientDefaults: ClientParams = {
  rps: 10,
  think_time_ms: 100,
  timeout_ms: 5000,
  retry_policy: { kind: 'none' },
}

const loadBalancerDefaults: LoadBalancerParams = {
  algorithm: 'round_robin',
  max_connections: 10000,
  health_check_interval_ms: 5000,
  failure_rate: 0.001,
}

const apiGatewayDefaults: ApiGatewayParams = {
  rate_limit_rps: 0,
  auth_overhead_ms: 5,
  timeout_ms: 3000,
  failure_rate: 0.001,
}

const appServerDefaults: AppServerParams = {
  instances: 3,
  max_concurrent_per_instance: 100,
  latency_ms_p50: 20,
  latency_ms_p99: 100,
  failure_rate: 0.005,
}

const cacheDefaults: CacheParams = {
  hit_rate: 0.85,
  capacity_items: 100000,
  eviction_policy: 'lru',
  read_latency_ms_p50: 1,
  read_latency_ms_p99: 5,
  failure_rate: 0.001,
}

const databaseDefaults: DatabaseParams = {
  subtype: 'relational',
  replicas: 3,
  read_capacity_rps: 5000,
  write_capacity_rps: 1000,
  replication_mode: 'async',
  replication_lag_ms_p50: 50,
  replication_lag_ms_p99: 500,
  read_latency_ms_p50: 5,
  read_latency_ms_p99: 30,
  write_latency_ms_p50: 10,
  write_latency_ms_p99: 80,
  failure_rate: 0.005,
}

const queueDefaults: QueueParams = {
  max_depth: 10000,
  consumer_processing_rps: 500,
  visibility_timeout_ms: 30000,
  delivery_guarantee: 'at_least_once',
  failure_rate: 0.001,
}

const pubSubDefaults: PubSubParams = {
  subscriber_count: 3,
  delivery_latency_ms_p50: 10,
  delivery_latency_ms_p99: 50,
  failure_rate: 0.001,
}

const cdnDefaults: CdnParams = {
  hit_rate: 0.95,
  edge_latency_ms_p50: 10,
  edge_latency_ms_p99: 40,
  origin_pull_timeout_ms: 5000,
  failure_rate: 0.001,
}

const objectStorageDefaults: ObjectStorageParams = {
  read_latency_ms_p50: 30,
  read_latency_ms_p99: 200,
  write_latency_ms_p50: 50,
  write_latency_ms_p99: 300,
  throughput_mbps: 1000,
  failure_rate: 0.001,
}

const externalServiceDefaults: ExternalServiceParams = {
  latency_ms_p50: 100,
  latency_ms_p99: 500,
  failure_rate: 0.01,
  timeout_ms: 3000,
  rate_limit_rps: 0,
}

// ─── Default edge params ──────────────────────────────────────────────────────
// Intra-DC defaults (p50=1ms / p99=5ms). Cross-region values from SPEC Section 6
// are not used in v1 since there is no concept of region.

export const defaultEdgeParams: Edge['params'] = {
  network_latency_ms_p50: 1,
  network_latency_ms_p99: 5,
  timeout_ms: 3000,
  retry_policy: { kind: 'none' },
  circuit_breaker: {
    enabled: false,
    failure_threshold: 0.5,
    success_threshold: 3,
    half_open_timeout_ms: 5000,
  },
  idempotent: false,
}

// ─── Label map ───────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<ComponentType, string> = {
  client: 'Client',
  load_balancer: 'Load Balancer',
  api_gateway: 'API Gateway',
  app_server: 'App Server',
  cache: 'Cache',
  database: 'Database',
  queue: 'Queue',
  pub_sub: 'Pub/Sub',
  cdn: 'CDN',
  object_storage: 'Object Storage',
  external_service: 'External Service',
}

// ─── Factory: createDefaultNode ───────────────────────────────────────────────
// Return type narrows via Extract so callers get the specific Node variant.
// The switch is exhaustive — TypeScript will error if a ComponentType is missing.

export function createDefaultNode<T extends ComponentType>(
  type: T,
  position: { x: number; y: number },
): Extract<Node, { type: T }> {
  const id = nanoid()
  const label = TYPE_LABELS[type]
  const notes = ''
  const base = { id, position, label, notes }

  // Each branch returns a fully-typed discriminated union member.
  // The `as` cast is required because TypeScript cannot narrow through a
  // generic type parameter in a switch, but the runtime values are correct.
  switch (type) {
    case 'client':
      return { ...base, type: 'client', params: { ...clientDefaults } } as Extract<Node, { type: T }>
    case 'load_balancer':
      return { ...base, type: 'load_balancer', params: { ...loadBalancerDefaults } } as Extract<Node, { type: T }>
    case 'api_gateway':
      return { ...base, type: 'api_gateway', params: { ...apiGatewayDefaults } } as Extract<Node, { type: T }>
    case 'app_server':
      return { ...base, type: 'app_server', params: { ...appServerDefaults } } as Extract<Node, { type: T }>
    case 'cache':
      return { ...base, type: 'cache', params: { ...cacheDefaults } } as Extract<Node, { type: T }>
    case 'database':
      return { ...base, type: 'database', params: { ...databaseDefaults } } as Extract<Node, { type: T }>
    case 'queue':
      return { ...base, type: 'queue', params: { ...queueDefaults } } as Extract<Node, { type: T }>
    case 'pub_sub':
      return { ...base, type: 'pub_sub', params: { ...pubSubDefaults } } as Extract<Node, { type: T }>
    case 'cdn':
      return { ...base, type: 'cdn', params: { ...cdnDefaults } } as Extract<Node, { type: T }>
    case 'object_storage':
      return { ...base, type: 'object_storage', params: { ...objectStorageDefaults } } as Extract<Node, { type: T }>
    case 'external_service':
      return { ...base, type: 'external_service', params: { ...externalServiceDefaults } } as Extract<Node, { type: T }>
  }
}

// ─── Factory: createDefaultEdge ──────────────────────────────────────────────

export function createDefaultEdge(
  source: string,
  target: string,
  kind: EdgeKind = 'sync_rpc',
): Edge {
  return {
    id: nanoid(),
    source,
    target,
    kind,
    params: { ...defaultEdgeParams },
  }
}

// ─── Factory: createDefaultDesign ────────────────────────────────────────────

export function createDefaultDesign(name?: string): Design {
  const now = new Date().toISOString()
  return {
    schemaVersion: 1,
    id: nanoid(),
    name: name ?? 'Untitled Design',
    createdAt: now,
    updatedAt: now,
    nodes: [],
    edges: [],
    annotations: [],
    sketches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    chaosPlan: [],
  }
}
