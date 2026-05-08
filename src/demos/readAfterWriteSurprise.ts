/**
 * Read-after-write surprise.
 *
 * Shape:   client → database (replicas=3, async, replica_only, eventual)
 * Traffic: write_ratio=0.4, single client (so the same client both writes and reads).
 * Chaos:   none — the lesson is the consistency model.
 *
 * Lesson:  the client writes, then reads from a replica before replication
 *          has caught up. The response payloads carry stalenessMs > 0.
 *          read_your_writes flips this — reads escalate to primary on
 *          stale-replica detection.
 */
import type { Design, TrafficSource } from '@/schema/types'
import type { DemoScenario } from './types'

const NOW = '2026-05-08T00:00:00.000Z'

function buildDesign(): Design {
  return {
    schemaVersion: 1,
    id: 'demo-read-after-write-surprise',
    name: 'Demo: Read-after-write surprise',
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
          rps: 20,
          think_time_ms: 50,
          timeout_ms: 5000,
          retry_policy: { kind: 'none' },
        },
      },
      {
        id: 'db',
        position: { x: 380, y: 200 },
        label: 'Database',
        notes: '',
        type: 'database',
        params: {
          subtype: 'relational',
          replicas: 3,
          read_capacity_rps: 1000,
          write_capacity_rps: 1000,
          replication_mode: 'async',
          replication_lag_ms_p50: 100,
          replication_lag_ms_p99: 500,
          read_latency_ms_p50: 5,
          read_latency_ms_p99: 30,
          write_latency_ms_p50: 10,
          write_latency_ms_p99: 80,
          failure_rate: 0,
          read_routing: 'replica_only',
          consistency_model: 'eventual',
        },
      },
    ],
    edges: [
      {
        id: 'e1',
        source: 'cli',
        target: 'db',
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
      },
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
      id: 'demo-src',
      label: 'Demo traffic',
      target_node_id: 'cli',
      load_shape: { kind: 'constant', rps: 20 },
      write_ratio: 0.4,
    },
  ]
}

export const scenario: DemoScenario = {
  slug: 'read-after-write-surprise',
  cardLabel: 'Read-after-write surprise',
  cardBlurb:
    'The same client writes data and immediately reads — but reads go to async replicas, returning stale data.',
  bannerHeadline: 'Read-after-write surprise',
  bannerBody:
    'The same client writes data, then immediately reads — but reads go to async replicas. Inspect the request_response payloads: stalenessMs > 0 means the client is reading data older than what it just wrote. This is the bug that read_your_writes consistency prevents.',
  bannerFollowup:
    "Try changing consistency_model to 'read_your_writes' in the database inspector and re-running. The stalenessMs values disappear; reads escalate to primary.",
  buildDesign,
  buildTraffic,
  defaultSimConfig: { seed: 42, durationMs: 5000, rps: 20 },
}
