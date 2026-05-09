/**
 * Hot shard (Path B approximation).
 *
 * Engine note: there is no first-class horizontal sharding primitive. The
 * load_balancer algorithms are round_robin / least_connections / random /
 * consistent_hash — none model a weighted hash with skew. Path A (extending
 * the engine with a shard_router) would not fit the launch window; Path C
 * (defer) leaves a Coming Soon card.
 *
 * Path B keeps the lesson with three independent clients, each at its own
 * RPS, talking to its own database "shard". Aggregate capacity is 3× a
 * single shard — but because traffic is heavily weighted toward shard 1,
 * shard 1 saturates while shards 2 and 3 sit idle. Banner is explicit
 * about the approximation.
 *
 * Shape:   client_hot   (rps=80) → shard_1 (read_capacity_rps=200)
 *          client_warm1 (rps=10) → shard_2 (read_capacity_rps=200)
 *          client_warm2 (rps=10) → shard_3 (read_capacity_rps=200)
 * Chaos:   none — the skew alone produces the lesson.
 */
import type { Design, TrafficSource } from '@/schema/types'
import type { DemoScenario } from './types'

const NOW = '2026-05-08T00:00:00.000Z'

function client(id: string, label: string, x: number, y: number, rps: number): Design['nodes'][number] {
  return {
    id,
    position: { x, y },
    label,
    notes: '',
    type: 'client',
    params: {
      rps,
      think_time_ms: 50,
      timeout_ms: 5000,
      retry_policy: { kind: 'none' },
    },
  }
}

function shard(
  id: string,
  label: string,
  x: number,
  y: number,
  readCapacityRps: number,
  readLatencyP50: number,
  readLatencyP99: number,
  readQueueMaxDepth: number,
): Design['nodes'][number] {
  return {
    id,
    position: { x, y },
    label,
    notes: '',
    type: 'database',
    params: {
      subtype: 'kv',
      replicas: 1,
      read_capacity_rps: readCapacityRps,
      write_capacity_rps: 1000,
      replication_mode: 'async',
      replication_lag_ms_p50: 0,
      replication_lag_ms_p99: 0,
      read_latency_ms_p50: readLatencyP50,
      read_latency_ms_p99: readLatencyP99,
      write_latency_ms_p50: 10,
      write_latency_ms_p99: 80,
      failure_rate: 0,
      read_queue_max_depth: readQueueMaxDepth,
      rejection_policy: 'reject_newest',
    },
  }
}

function syncEdge(id: string, source: string, target: string): Design['edges'][number] {
  return {
    id,
    source,
    target,
    kind: 'sync_rpc',
    params: {
      network_latency_ms_p50: 1,
      network_latency_ms_p99: 5,
      timeout_ms: 5000,
      retry_policy: { kind: 'none' },
      circuit_breaker: {
        enabled: false,
        failure_threshold: 0.5,
        success_threshold: 3,
        half_open_timeout_ms: 5000,
      },
      idempotent: false,
    },
  }
}

function buildDesign(): Design {
  return {
    schemaVersion: 1,
    id: 'demo-hot-shard',
    name: 'Demo: Hot shard',
    createdAt: NOW,
    updatedAt: NOW,
    nodes: [
      client('cli_hot', 'Client (hot key)', 60, 100, 80),
      client('cli_warm1', 'Client (warm)', 60, 240, 10),
      client('cli_warm2', 'Client (warm)', 60, 380, 10),
      // Shard 1 is the "hot" shard. Capacity / queue / latency are tuned so
      // 80 rps overruns it: at p50=120ms latency the steady-state in-flight
      // is ~10, well above the cap of 5 — the queue (depth 10) fills, then
      // requests start rejecting. Shards 2 and 3 keep their baseline cap of
      // 200 so 10 rps barely registers.
      shard('shard_1', 'Shard 1 (hot key)', 360, 100, 5, 120, 400, 10),
      shard('shard_2', 'Shard 2', 360, 240, 200, 5, 30, 50),
      shard('shard_3', 'Shard 3', 360, 380, 200, 5, 30, 50),
    ],
    edges: [
      syncEdge('e_hot_s1', 'cli_hot', 'shard_1'),
      syncEdge('e_warm1_s2', 'cli_warm1', 'shard_2'),
      syncEdge('e_warm2_s3', 'cli_warm2', 'shard_3'),
    ],
    annotations: [],
    sketches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    chaosPlan: [],
  }
}

function buildTraffic(_design: Design): TrafficSource[] {
  return [
    {
      id: 'demo-src-hot',
      label: 'Hot key traffic',
      target_node_id: 'cli_hot',
      load_shape: { kind: 'constant', rps: 80 },
    },
    {
      id: 'demo-src-warm1',
      label: 'Warm shard 2',
      target_node_id: 'cli_warm1',
      load_shape: { kind: 'constant', rps: 10 },
    },
    {
      id: 'demo-src-warm2',
      label: 'Warm shard 3',
      target_node_id: 'cli_warm2',
      load_shape: { kind: 'constant', rps: 10 },
    },
  ]
}

export const scenario: DemoScenario = {
  slug: 'hot-shard',
  cardLabel: 'Hot shard',
  cardBlurb:
    'Three database shards, but 80% of traffic is keyed to one of them. Watch its queue saturate while the others idle.',
  bannerHeadline: 'Hot shard',
  bannerBody:
    'Three database shards. Eighty percent of traffic is keyed to shard 1; shards 2 and 3 split the rest. Watch shard 1 saturate (queue fills, reads start rejecting) while shards 2 and 3 sit idle — even though aggregate capacity across the three is many times shard 1 alone. This is what hot keys do to a sharded system.',
  buildDesign,
  buildTraffic,
  defaultSimConfig: { seed: 42, durationMs: 5000, rps: 80 },
}
