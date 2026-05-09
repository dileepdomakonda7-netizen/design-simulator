/**
 * Network partition.
 *
 * Shape:   client → load_balancer (round_robin) → 3× app_server → database
 * Chaos:   network_partition isolates app_server #3 from the load_balancer
 *          for 2000–3500ms.
 *
 * Lesson:  the LB still routes ~1/3 of traffic to the isolated server during
 *          the partition window. Those requests fail with reason 'partition'.
 *          When the partition heals, error rate drops back to baseline.
 */
import type { Design, TrafficSource } from '@/schema/types'
import type { DemoScenario } from './types'

const NOW = '2026-05-08T00:00:00.000Z'

function appServer(id: string, label: string, x: number, y: number): Design['nodes'][number] {
  return {
    id,
    position: { x, y },
    label,
    notes: '',
    type: 'app_server',
    params: {
      instances: 2,
      max_concurrent_per_instance: 20,
      latency_ms_p50: 10,
      latency_ms_p99: 50,
      failure_rate: 0,
    },
  }
}

function syncEdge(
  id: string,
  source: string,
  target: string,
  timeoutMs: number,
): Design['edges'][number] {
  return {
    id,
    source,
    target,
    kind: 'sync_rpc',
    params: {
      network_latency_ms_p50: 1,
      network_latency_ms_p99: 5,
      timeout_ms: timeoutMs,
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
    id: 'demo-network-partition',
    name: 'Demo: Network partition',
    createdAt: NOW,
    updatedAt: NOW,
    nodes: [
      {
        id: 'cli',
        position: { x: 60, y: 240 },
        label: 'Client',
        notes: '',
        type: 'client',
        params: {
          rps: 30,
          think_time_ms: 30,
          timeout_ms: 5000,
          retry_policy: { kind: 'none' },
        },
      },
      {
        id: 'lb',
        position: { x: 280, y: 240 },
        label: 'Load balancer',
        notes: '',
        type: 'load_balancer',
        params: {
          algorithm: 'round_robin',
          max_connections: 10000,
          health_check_interval_ms: 1000,
          failure_rate: 0,
        },
      },
      appServer('app1', 'App #1', 540, 100),
      appServer('app2', 'App #2', 540, 240),
      appServer('app3', 'App #3', 540, 380),
      {
        id: 'db',
        position: { x: 820, y: 240 },
        label: 'Database',
        notes: '',
        type: 'database',
        params: {
          subtype: 'relational',
          replicas: 1,
          read_capacity_rps: 5000,
          write_capacity_rps: 1000,
          replication_mode: 'async',
          replication_lag_ms_p50: 0,
          replication_lag_ms_p99: 0,
          read_latency_ms_p50: 5,
          read_latency_ms_p99: 30,
          write_latency_ms_p50: 10,
          write_latency_ms_p99: 80,
          failure_rate: 0,
        },
      },
    ],
    edges: [
      // 5s client-side timeout; the lesson runs on the LB→app edges.
      syncEdge('e_cli_lb', 'cli', 'lb', 5000),
      // Tight 800ms LB→app timeout so requests routed to the partitioned
      // app server fail visibly during the 1500ms partition window
      // (without this, the timeout extends past sim_end and the user sees
      // the "in flight" bucket grow but no error-rate climb).
      syncEdge('e_lb_app1', 'lb', 'app1', 800),
      syncEdge('e_lb_app2', 'lb', 'app2', 800),
      syncEdge('e_lb_app3', 'lb', 'app3', 800),
      syncEdge('e_app1_db', 'app1', 'db', 5000),
      syncEdge('e_app2_db', 'app2', 'db', 5000),
      syncEdge('e_app3_db', 'app3', 'db', 5000),
    ],
    annotations: [],
    sketches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    chaosPlan: [
      {
        id: 'np1',
        kind: 'network_partition',
        partition_a: ['lb'],
        partition_b: ['app3'],
        at_ms: 2000,
        duration_ms: 1500,
      },
    ],
  }
}

function buildTraffic(_design: Design): TrafficSource[] {
  return [
    {
      id: 'demo-src',
      label: 'Demo traffic',
      target_node_id: 'cli',
      load_shape: { kind: 'constant', rps: 30 },
    },
  ]
}

export const scenario: DemoScenario = {
  slug: 'network-partition',
  cardLabel: 'Network partition',
  cardBlurb:
    'One of three app servers gets isolated from the load balancer mid-run. The LB keeps routing 1/3 of traffic to it.',
  bannerHeadline: 'Network partition',
  bannerBody:
    'At t=2000ms, one of three app servers gets isolated from the load balancer. The LB does not know it is gone — requests routed to it fail. Watch the error rate climb during 2000–3500ms then recover. Notice how the LB keeps trying to route 1/3 of traffic to the isolated server. This is partition tolerance: who detects, how fast, and what happens to in-flight requests.',
  buildDesign,
  buildTraffic,
  defaultSimConfig: { seed: 42, durationMs: 5000, rps: 30 },
}
