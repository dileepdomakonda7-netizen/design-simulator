import { z } from 'zod'
import type { Design } from './types'

// ─── Primitive schemas ────────────────────────────────────────────────────────

export const RetryPolicySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({
    kind: z.literal('fixed'),
    max_retries: z.number().int().positive(),
    delay_ms: z.number().positive(),
  }),
  z.object({
    kind: z.literal('exponential_backoff'),
    max_retries: z.number().int().positive(),
    base_delay_ms: z.number().positive(),
    max_delay_ms: z.number().positive(),
    jitter: z.boolean(),
  }),
])

export const CircuitBreakerConfigSchema = z.object({
  enabled: z.boolean(),
  failure_threshold: z.number().min(0).max(1),
  success_threshold: z.number().int().positive(),
  half_open_timeout_ms: z.number().positive(),
})

// ─── Per-type param schemas ───────────────────────────────────────────────────

export const ClientParamsSchema = z.object({
  rps: z.number().positive(),
  think_time_ms: z.number().nonnegative(),
  timeout_ms: z.number().positive(),
  retry_policy: RetryPolicySchema,
})

export const LoadBalancerParamsSchema = z.object({
  algorithm: z.enum(['round_robin', 'least_connections', 'random', 'consistent_hash']),
  max_connections: z.number().int().positive(),
  health_check_interval_ms: z.number().positive(),
  failure_rate: z.number().min(0).max(1),
})

export const ApiGatewayParamsSchema = z.object({
  rate_limit_rps: z.number().nonnegative(),
  auth_overhead_ms: z.number().nonnegative(),
  timeout_ms: z.number().positive(),
  failure_rate: z.number().min(0).max(1),
})

export const AppServerParamsSchema = z.object({
  instances: z.number().int().positive(),
  max_concurrent_per_instance: z.number().int().positive(),
  latency_ms_p50: z.number().positive(),
  latency_ms_p99: z.number().positive(),
  failure_rate: z.number().min(0).max(1),
})

export const CacheParamsSchema = z.object({
  hit_rate: z.number().min(0).max(1),
  capacity_items: z.number().int().positive(),
  eviction_policy: z.enum(['lru', 'lfu', 'fifo']),
  read_latency_ms_p50: z.number().positive(),
  read_latency_ms_p99: z.number().positive(),
  failure_rate: z.number().min(0).max(1),
})

export const DatabaseParamsSchema = z.object({
  subtype: z.enum(['relational', 'kv', 'document']),
  replicas: z.number().int().positive(),
  read_capacity_rps: z.number().positive(),
  write_capacity_rps: z.number().positive(),
  replication_mode: z.enum(['sync', 'async']),
  replication_lag_ms_p50: z.number().nonnegative(),
  replication_lag_ms_p99: z.number().nonnegative(),
  read_latency_ms_p50: z.number().positive(),
  read_latency_ms_p99: z.number().positive(),
  write_latency_ms_p50: z.number().positive(),
  write_latency_ms_p99: z.number().positive(),
  failure_rate: z.number().min(0).max(1),
})

export const QueueParamsSchema = z.object({
  max_depth: z.number().int().nonnegative(),
  consumer_processing_rps: z.number().positive(),
  visibility_timeout_ms: z.number().positive(),
  delivery_guarantee: z.enum(['at_most_once', 'at_least_once', 'exactly_once']),
  failure_rate: z.number().min(0).max(1),
})

export const PubSubParamsSchema = z.object({
  subscriber_count: z.number().int().positive(),
  delivery_latency_ms_p50: z.number().positive(),
  delivery_latency_ms_p99: z.number().positive(),
  failure_rate: z.number().min(0).max(1),
})

export const CdnParamsSchema = z.object({
  hit_rate: z.number().min(0).max(1),
  edge_latency_ms_p50: z.number().positive(),
  edge_latency_ms_p99: z.number().positive(),
  origin_pull_timeout_ms: z.number().positive(),
  failure_rate: z.number().min(0).max(1),
})

export const ObjectStorageParamsSchema = z.object({
  read_latency_ms_p50: z.number().positive(),
  read_latency_ms_p99: z.number().positive(),
  write_latency_ms_p50: z.number().positive(),
  write_latency_ms_p99: z.number().positive(),
  throughput_mbps: z.number().positive(),
  failure_rate: z.number().min(0).max(1),
})

export const ExternalServiceParamsSchema = z.object({
  latency_ms_p50: z.number().positive(),
  latency_ms_p99: z.number().positive(),
  failure_rate: z.number().min(0).max(1),
  timeout_ms: z.number().positive(),
  rate_limit_rps: z.number().nonnegative(),
})

// ─── Node schema (discriminated union — validates type↔params pairing) ────────

const nodeBase = {
  id: z.string().min(1),
  position: z.object({ x: z.number(), y: z.number() }),
  label: z.string(),
  notes: z.string(),
}

export const NodeSchema = z.discriminatedUnion('type', [
  z.object({ ...nodeBase, type: z.literal('client'), params: ClientParamsSchema }),
  z.object({ ...nodeBase, type: z.literal('load_balancer'), params: LoadBalancerParamsSchema }),
  z.object({ ...nodeBase, type: z.literal('api_gateway'), params: ApiGatewayParamsSchema }),
  z.object({ ...nodeBase, type: z.literal('app_server'), params: AppServerParamsSchema }),
  z.object({ ...nodeBase, type: z.literal('cache'), params: CacheParamsSchema }),
  z.object({ ...nodeBase, type: z.literal('database'), params: DatabaseParamsSchema }),
  z.object({ ...nodeBase, type: z.literal('queue'), params: QueueParamsSchema }),
  z.object({ ...nodeBase, type: z.literal('pub_sub'), params: PubSubParamsSchema }),
  z.object({ ...nodeBase, type: z.literal('cdn'), params: CdnParamsSchema }),
  z.object({ ...nodeBase, type: z.literal('object_storage'), params: ObjectStorageParamsSchema }),
  z.object({ ...nodeBase, type: z.literal('external_service'), params: ExternalServiceParamsSchema }),
])

// ─── Edge schema ─────────────────────────────────────────────────────────────

export const EdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  kind: z.enum(['sync_rpc', 'async_message', 'replication']),
  label: z.string().optional(),
  params: z.object({
    network_latency_ms_p50: z.number().nonnegative(),
    network_latency_ms_p99: z.number().nonnegative(),
    timeout_ms: z.number().positive(),
    retry_policy: RetryPolicySchema,
    circuit_breaker: CircuitBreakerConfigSchema,
    idempotent: z.boolean(),
  }),
})

// ─── Annotation + Sketch schemas ─────────────────────────────────────────────

export const AnnotationSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['stroke', 'text', 'shape']),
  data: z.unknown(),
  layer: z.literal('annotation'),
  createdAt: z.string(),
})

export const SketchSchema = z.object({
  id: z.string().min(1),
  strokes: z.array(z.unknown()),
  createdAt: z.string(),
  parsedAt: z.string().optional(),
})

// ─── Viewport + Design schemas ────────────────────────────────────────────────

export const ViewportSchema = z.object({
  x: z.number(),
  y: z.number(),
  zoom: z.number().positive(),
})

export const DesignSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  nodes: z.array(NodeSchema),
  edges: z.array(EdgeSchema),
  annotations: z.array(AnnotationSchema),
  sketches: z.array(SketchSchema),
  viewport: ViewportSchema,
})

// ─── Simulation config schemas ────────────────────────────────────────────────

export const LoadShapeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('constant'), rps: z.number().nonnegative() }),
  z.object({
    kind: z.literal('ramp'),
    start_rps: z.number().nonnegative(),
    end_rps: z.number().nonnegative(),
    duration_ms: z.number().positive(),
  }),
  z.object({
    kind: z.literal('step'),
    steps: z.array(z.object({ at_ms: z.number().nonnegative(), rps: z.number().nonnegative() })),
  }),
  z.object({
    kind: z.literal('spike'),
    base_rps: z.number().nonnegative(),
    spike_rps: z.number().nonnegative(),
    at_ms: z.number().nonnegative(),
    duration_ms: z.number().positive(),
  }),
  z.object({
    kind: z.literal('sine'),
    base_rps: z.number().nonnegative(),
    amplitude_rps: z.number().nonnegative(),
    period_ms: z.number().positive(),
  }),
  z.object({
    kind: z.literal('random_burst'),
    base_rps: z.number().nonnegative(),
    burst_probability: z.number().min(0).max(1),
    burst_multiplier: z.number().positive(),
    burst_duration_ms: z.number().positive(),
  }),
])

export const TrafficSourceSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  target_node_id: z.string().min(1),
  load_shape: LoadShapeSchema,
})

export const ChaosEventSpecSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('node_crash'),
    node_id: z.string().min(1),
    at_ms: z.number().nonnegative(),
    duration_ms: z.number().positive(),
  }),
  z.object({
    kind: z.literal('network_partition'),
    partition_a: z.array(z.string()),
    partition_b: z.array(z.string()),
    at_ms: z.number().nonnegative(),
    duration_ms: z.number().positive(),
  }),
  z.object({
    kind: z.literal('traffic_spike'),
    multiplier: z.number().positive(),
    at_ms: z.number().nonnegative(),
    duration_ms: z.number().positive(),
  }),
  z.object({
    kind: z.literal('cache_miss_storm'),
    node_id: z.string().min(1),
    at_ms: z.number().nonnegative(),
    duration_ms: z.number().positive(),
  }),
])

// ─── Validation helpers ───────────────────────────────────────────────────────

// Zod's `.optional()` infers `T | undefined`, which conflicts with
// exactOptionalPropertyTypes on Edge.label?: string (absent ≠ undefined).
// The cast to Design is safe: zod validates structure correctly; the only
// divergence is zod's inferred type widening optional to include undefined.
export function validateDesign(
  value: unknown,
): { ok: true; design: Design } | { ok: false; error: z.ZodError } {
  const result = DesignSchema.safeParse(value)
  if (result.success) {
    return { ok: true, design: result.data as Design }
  }
  return { ok: false, error: result.error }
}

export function validateDesignStrict(value: unknown): Design {
  return DesignSchema.parse(value) as Design
}
