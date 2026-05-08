/**
 * Cache stampede.
 *
 * Shape:   client → cache (hit_rate=0.9) → database (read_queue=50)
 * Chaos:   cache_miss_storm at 2000–4000ms forces hit_rate→0.
 *
 * Lesson:  with 90% hit rate the database sees ~10% of traffic. When the
 *          cache fails, the database absorbs 100% of reads, the bounded
 *          read queue saturates, and rejections cascade upstream.
 */
import type { Design, TrafficSource } from '@/schema/types'
import type { DemoScenario } from './types'

const NOW = '2026-05-08T00:00:00.000Z'

function buildDesign(): Design {
  return {
    schemaVersion: 1,
    id: 'demo-cache-stampede',
    name: 'Demo: Cache stampede',
    createdAt: NOW,
    updatedAt: NOW,
    nodes: [
      {
        id: 'cli',
        position: { x: 80, y: 200 },
        label: 'Client',
        notes: '',
        type: 'client',
        params: {
          rps: 200,
          think_time_ms: 5,
          timeout_ms: 5000,
          retry_policy: { kind: 'none' },
        },
      },
      {
        id: 'cache',
        position: { x: 380, y: 200 },
        label: 'Cache',
        notes: '',
        type: 'cache',
        params: {
          hit_rate: 0.9,
          capacity_items: 100000,
          eviction_policy: 'lru',
          read_latency_ms_p50: 2,
          read_latency_ms_p99: 8,
          failure_rate: 0,
        },
      },
      {
        id: 'db',
        position: { x: 680, y: 200 },
        label: 'Database',
        notes: '',
        type: 'database',
        params: {
          subtype: 'kv',
          replicas: 1,
          // Tight in-flight cap + slow reads + a small queue together
          // guarantee saturation during the cache-miss storm:
          //   200 rps × ~150ms avg latency = ~30 in-flight steady state,
          //   way above cap=15. Queue (20) fills, then rejects.
          // At baseline (90% cache hit), DB sees 20 rps × 0.15s = ~3 in-flight,
          // well under cap, so no rejections in non-storm windows.
          read_capacity_rps: 15,
          write_capacity_rps: 1000,
          replication_mode: 'async',
          replication_lag_ms_p50: 0,
          replication_lag_ms_p99: 0,
          read_latency_ms_p50: 100,
          read_latency_ms_p99: 400,
          write_latency_ms_p50: 20,
          write_latency_ms_p99: 80,
          failure_rate: 0,
          read_queue_max_depth: 20,
          rejection_policy: 'reject_newest',
        },
      },
    ],
    edges: [
      edge('e1', 'cli', 'cache'),
      edge('e2', 'cache', 'db'),
    ],
    annotations: [],
    sketches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    chaosPlan: [
      {
        id: 'cs1',
        kind: 'cache_miss_storm',
        node_id: 'cache',
        at_ms: 2000,
        duration_ms: 2000,
      },
    ],
  }
}

function edge(id: string, source: string, target: string): Design['edges'][number] {
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

function buildTraffic(_design: Design): TrafficSource[] {
  return [
    {
      id: 'demo-src',
      label: 'Demo traffic',
      target_node_id: 'cli',
      load_shape: { kind: 'constant', rps: 200 },
    },
  ]
}

export const scenario: DemoScenario = {
  slug: 'cache-stampede',
  cardLabel: 'Cache stampede',
  cardBlurb:
    'The cache normally absorbs 90% of reads. When it fails, the database queue saturates and rejections cascade.',
  bannerHeadline: 'Cache stampede',
  bannerBody:
    'The cache normally absorbs 90% of reads. When it goes cold between t=2s and t=4s, every request hits the database, the database queue saturates, and rejections cascade upstream. This is why cache layers are the most fragile thing in your system.',
  buildDesign,
  buildTraffic,
  defaultSimConfig: { seed: 42, durationMs: 5000, rps: 200 },
}
