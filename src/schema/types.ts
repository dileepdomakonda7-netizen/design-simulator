// ─── Enumerations ────────────────────────────────────────────────────────────

// Single source of truth: COMPONENT_TYPES is the runtime-iterable list,
// ComponentType is its element-type. Adding a type means adding it once here.
export const COMPONENT_TYPES = [
  'client',
  'load_balancer',
  'api_gateway',
  'app_server',
  'cache',
  'database',
  'queue',
  'pub_sub',
  'cdn',
  'object_storage',
  'external_service',
] as const

export type ComponentType = (typeof COMPONENT_TYPES)[number]

export const EDGE_KINDS = ['sync_rpc', 'async_message', 'replication'] as const
export type EdgeKind = (typeof EDGE_KINDS)[number]

export type DatabaseSubtype = 'relational' | 'kv' | 'document'
export type EvictionPolicy = 'lru' | 'lfu' | 'fifo'
export type ReplicationMode = 'sync' | 'async'
export type DeliveryGuarantee = 'at_most_once' | 'at_least_once' | 'exactly_once'
export type LoadBalancerAlgorithm =
  | 'round_robin'
  | 'least_connections'
  | 'random'
  | 'consistent_hash'

// ─── Edge behavior primitives ─────────────────────────────────────────────────

export type RetryPolicy =
  | { kind: 'none' }
  | { kind: 'fixed'; max_retries: number; delay_ms: number }
  | {
      kind: 'exponential_backoff'
      max_retries: number
      base_delay_ms: number
      max_delay_ms: number
      jitter: boolean
    }

export interface CircuitBreakerConfig {
  enabled: boolean
  failure_threshold: number // 0–1 fraction of errors that opens the circuit
  success_threshold: number // consecutive successes in half-open state to close
  half_open_timeout_ms: number // wait before transitioning open → half-open
}

// ─── Per-component-type param objects ────────────────────────────────────────

export interface ClientParams {
  rps: number // steady-state requests per second
  think_time_ms: number // pause between requests per virtual client
  timeout_ms: number // client-side request timeout
  retry_policy: RetryPolicy
}

export interface LoadBalancerParams {
  algorithm: LoadBalancerAlgorithm
  max_connections: number // total concurrent connections across all upstreams
  health_check_interval_ms: number
  failure_rate: number // 0–1 probability this node itself fails per request
}

export interface ApiGatewayParams {
  rate_limit_rps: number // 0 = unlimited
  auth_overhead_ms: number // fixed latency added to every request
  timeout_ms: number
  failure_rate: number
}

export interface AppServerParams {
  instances: number // horizontal replicas; load balanced round-robin by default
  max_concurrent_per_instance: number
  latency_ms_p50: number // processing time distribution (log-normal)
  latency_ms_p99: number
  failure_rate: number
  // Phase 6a backpressure. Optional: undefined → unbounded (Phase 4 behavior).
  queue_max_depth?: number
  rejection_policy?: 'reject_newest' | 'reject_oldest' | 'block'
}

export interface CacheParams {
  hit_rate: number // 0–1; applied before upstream lookup
  capacity_items: number // used for display; v2 will model eviction dynamically
  eviction_policy: EvictionPolicy
  read_latency_ms_p50: number
  read_latency_ms_p99: number
  failure_rate: number
}

export interface DatabaseParams {
  subtype: DatabaseSubtype
  replicas: number // total nodes including primary
  read_capacity_rps: number // concurrent in-flight cap (Phase 4b simplification)
  write_capacity_rps: number
  replication_mode: ReplicationMode
  replication_lag_ms_p50: number // meaningful only when mode = 'async'
  replication_lag_ms_p99: number
  read_latency_ms_p50: number
  read_latency_ms_p99: number
  write_latency_ms_p50: number
  write_latency_ms_p99: number
  failure_rate: number
  // Phase 6a backpressure. Optional: undefined → unbounded (Phase 4 behavior).
  read_queue_max_depth?: number
  write_queue_max_depth?: number // reserved; write-path queue is its own Phase 6 work
  rejection_policy?: 'reject_newest'
  // Phase 6d replication lag. Default 'primary_only' when undefined preserves
  // pre-6d behavior (no staleness, replica params irrelevant).
  read_routing?: ReadRouting
  // Phase 6e: consistency model. When set, dictates read routing entirely
  // (overrides read_routing). When unset, falls back to read_routing — and
  // when read_routing is also unset, defaults to 'primary_only' (preserves
  // every pre-6e design's behavior unchanged).
  consistency_model?: ConsistencyModel
}

export type ReadRouting = 'primary_only' | 'replica_only' | 'mixed'

export type ConsistencyModel =
  | 'linearizable' // every read goes to primary; staleness=0 always
  | 'read_your_writes' // a client that wrote sees ≥ its own write on subsequent reads
  | 'monotonic_reads' // a client never sees a read older than one it has already seen
  | 'eventual' // any read can hit any replica with no checks (= replica_only)

export interface QueueParams {
  max_depth: number // 0 = unbounded; > 0 = bounded, excess rejected per rejection_policy
  consumer_processing_rps: number
  visibility_timeout_ms: number
  delivery_guarantee: DeliveryGuarantee
  failure_rate: number
  // Phase 6a: how to drop messages when bounded queue is full.
  // reject_newest (default): incoming producer message rejected.
  // reject_oldest: oldest queued message displaced (silent loss; producer
  //   was already told success: true on enqueue, so we DON'T retract that —
  //   matches real-world fire-and-forget queues under sustained overload).
  rejection_policy?: 'reject_newest' | 'reject_oldest'
}

export interface PubSubParams {
  subscriber_count: number
  delivery_latency_ms_p50: number
  delivery_latency_ms_p99: number
  failure_rate: number
}

export interface CdnParams {
  hit_rate: number // 0–1
  edge_latency_ms_p50: number
  edge_latency_ms_p99: number
  origin_pull_timeout_ms: number
  failure_rate: number
}

export interface ObjectStorageParams {
  read_latency_ms_p50: number
  read_latency_ms_p99: number
  write_latency_ms_p50: number
  write_latency_ms_p99: number
  throughput_mbps: number
  failure_rate: number
}

export interface ExternalServiceParams {
  latency_ms_p50: number
  latency_ms_p99: number
  failure_rate: number
  timeout_ms: number
  rate_limit_rps: number // 0 = no limit enforced by this service
}

// Discriminated union mapping ComponentType → its params object.
// A Node carries { type, params } and TypeScript enforces the pairing.
export type TypedNodeParams =
  | { type: 'client'; params: ClientParams }
  | { type: 'load_balancer'; params: LoadBalancerParams }
  | { type: 'api_gateway'; params: ApiGatewayParams }
  | { type: 'app_server'; params: AppServerParams }
  | { type: 'cache'; params: CacheParams }
  | { type: 'database'; params: DatabaseParams }
  | { type: 'queue'; params: QueueParams }
  | { type: 'pub_sub'; params: PubSubParams }
  | { type: 'cdn'; params: CdnParams }
  | { type: 'object_storage'; params: ObjectStorageParams }
  | { type: 'external_service'; params: ExternalServiceParams }

// ─── Core schema objects ──────────────────────────────────────────────────────

// Node is a discriminated union via intersection with TypedNodeParams.
// When node.type === 'database', TypeScript narrows node.params to DatabaseParams.
// Every behavior file in src/sim/behaviors/ relies on this narrowing — do not
// collapse back to an interface with a union params field.
export type Node = {
  id: string
  position: { x: number; y: number }
  label: string
  notes: string // free-text; shown in inspector; ignored by simulator
} & TypedNodeParams

export interface Edge {
  id: string
  source: string // Node id
  target: string // Node id
  kind: EdgeKind
  label?: string
  params: {
    network_latency_ms_p50: number // one-way wire latency added on request_send
    network_latency_ms_p99: number // sampled log-normal, same as node latency
    timeout_ms: number
    retry_policy: RetryPolicy
    circuit_breaker: CircuitBreakerConfig
    idempotent: boolean // v2 exactly-once / deduplication; stored in v1 but unused by engine
  }
}

export interface Annotation {
  id: string
  kind: 'stroke' | 'text' | 'shape'
  data: unknown // perfect-freehand stroke points | string | shape descriptor
  layer: 'annotation' // always 'annotation'; discriminates from Sketch
  createdAt: string // ISO 8601
}

export interface Sketch {
  id: string
  strokes: unknown[] // raw perfect-freehand InputPoint[][] arrays
  createdAt: string // ISO 8601
  parsedAt?: string // set when submitted to vision pipeline; undefined if never parsed
}

export interface Viewport {
  x: number
  y: number
  zoom: number
}

export interface Design {
  schemaVersion: 1
  id: string
  name: string
  createdAt: string // ISO 8601
  updatedAt: string // ISO 8601
  nodes: Node[]
  edges: Edge[]
  annotations: Annotation[]
  sketches: Sketch[]
  viewport: Viewport
  /** Persisted chaos schedule. Default []. Optional for back-compat with v1 designs
   *  that pre-date 4c; persistence/migrations.ts backfills on load. */
  chaosPlan?: ChaosEventSpec[]
}

// ─── Simulation config types ──────────────────────────────────────────────────
// These are NOT stored on Design — they are configured per simulation run.
// They live here because they are part of the canonical schema vocabulary
// and are referenced by src/sim/ and src/sim-ui/.

export type LoadShape =
  | { kind: 'constant'; rps: number }
  | { kind: 'ramp'; start_rps: number; end_rps: number; duration_ms: number }
  | { kind: 'step'; steps: Array<{ at_ms: number; rps: number }> }
  | { kind: 'spike'; base_rps: number; spike_rps: number; at_ms: number; duration_ms: number }
  | { kind: 'sine'; base_rps: number; amplitude_rps: number; period_ms: number }
  | {
      kind: 'random_burst'
      base_rps: number
      burst_probability: number
      burst_multiplier: number
      burst_duration_ms: number
    }

export interface TrafficSource {
  id: string
  label: string
  target_node_id: string // must be a node in the design (typically 'client' or 'cdn')
  load_shape: LoadShape
  // No per-source seed field. PRNG state for each source is derived deterministically
  // from the global seed and source id:  mulberry32(globalSeed ^ fnv1a32(source.id))
  // One global seed → one button → reproducible run. Users never configure per-source seeds.
  /** Phase 6e: probability in [0, 1] that any given arrival is a write rather
   *  than a read. Defaults to 0 (read-only). The traffic generator stamps
   *  `causalContext.kind = 'write' | 'read'` on each arrival's SimRequest. */
  write_ratio?: number
}

// ChaosEventSpec is user-facing config stored on Design.chaosPlan.
// The engine compiles each spec into 1–2 SimEvents at simulation init (start + optional end).
// Do not confuse with SimEvent, which is the engine-internal priority-queue entry.
//
// The `id` field exists so the timeline editor can identify each scheduled event
// for drag/edit/delete without relying on array index (positions are mutable).
export type ChaosEventSpec =
  | {
      id: string
      kind: 'node_crash'
      node_id: string
      at_ms: number
      duration_ms: number // recovery scheduled at at_ms + duration_ms
    }
  | {
      id: string
      kind: 'network_partition'
      partition_a: string[]
      partition_b: string[]
      at_ms: number
      duration_ms: number
    }
  | {
      id: string
      kind: 'traffic_spike'
      multiplier: number // applied to all active traffic sources
      at_ms: number
      duration_ms: number
    }
  | {
      id: string
      kind: 'cache_miss_storm'
      node_id: string // must resolve to a 'cache' node
      at_ms: number
      duration_ms: number // forces hit_rate = 0 for this window
    }
  | {
      // Phase 6a: drive a target node to saturation. The chaos compiler emits
      // a burst of synthetic request_receive events at the node directly,
      // bypassing the normal upstream chain. Burst size scales with the
      // node's capacity. v1 simplification: emits capacity*5 extras over
      // the window.
      id: string
      kind: 'saturate_node'
      node_id: string
      at_ms: number
      duration_ms: number
    }
  | {
      // Phase 6c: partial failure. The target node stays "up" but operates
      // in a degraded mode for the window. Modes:
      //   slow            — latency p50/p99 multiplied by 1 + intensity*9
      //                     (intensity=1 → 10× slower).
      //   errors          — failure_rate REPLACED by min(intensity, 1.0).
      //   slow_and_errors — both apply.
      // intensity is a single dial in [0..1]. The mode and intensity are
      // fixed for the duration of the window.
      id: string
      kind: 'node_degraded'
      node_id: string
      at_ms: number
      duration_ms: number
      mode: DegradationMode
      intensity: number
    }
  | {
      // Phase 6d: spike replication lag for an async-replicated database.
      // Multiplier = 1 + intensity*9 (matches partial-failure 'slow' formula).
      // While active, every replica read on the target database samples lag
      // from a distribution scaled by the multiplier — the underlying
      // replication_lag_ms_p50/p99 are unchanged. Models a write storm /
      // network jitter / replica catching up from snapshot.
      id: string
      kind: 'replication_lag_spike'
      node_id: string // must resolve to a 'database' node
      at_ms: number
      duration_ms: number
      intensity: number // [0..1]
    }

export type DegradationMode = 'slow' | 'errors' | 'slow_and_errors'
