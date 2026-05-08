/**
 * Saturating fan-out (approximation).
 *
 * Engine note: app_server's `defaultNextHop` selects a single outgoing edge
 * per request — the engine does not model parallel fan-out (aggregate
 * latency = max of N parallel calls). To preserve the lesson without
 * extending the engine, this scenario uses a load_balancer with round_robin
 * routing across three external services. Each request hits exactly one
 * downstream, so the lesson reads as "one slow shard drags system p99"
 * rather than the strict "max of N" tail-at-scale formulation. This is
 * documented in PROGRESS.md.
 *
 * Shape:   client → load_balancer (round_robin) → service_a, service_b, service_c
 * Chaos:   node_degraded on service_c, mode='slow', intensity=1.0 → 10× slower.
 */
import type { Design, TrafficSource } from '@/schema/types'
import type { DemoScenario } from './types'

const NOW = '2026-05-08T00:00:00.000Z'

function externalService(
  id: string,
  label: string,
  x: number,
  y: number,
): Design['nodes'][number] {
  return {
    id,
    position: { x, y },
    label,
    notes: '',
    type: 'external_service',
    params: {
      latency_ms_p50: 20,
      latency_ms_p99: 80,
      failure_rate: 0,
      timeout_ms: 5000,
      rate_limit_rps: 0,
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
    id: 'demo-saturating-fan-out',
    name: 'Demo: Saturating fan-out',
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
          rps: 20,
          think_time_ms: 50,
          timeout_ms: 5000,
          retry_policy: { kind: 'none' },
        },
      },
      {
        id: 'lb',
        position: { x: 280, y: 240 },
        label: 'Fan-out router',
        notes: '',
        type: 'load_balancer',
        params: {
          algorithm: 'round_robin',
          max_connections: 10000,
          health_check_interval_ms: 1000,
          failure_rate: 0,
        },
      },
      externalService('svc_a', 'Service A', 560, 100),
      externalService('svc_b', 'Service B', 560, 240),
      externalService('svc_c', 'Service C (slow)', 560, 380),
    ],
    edges: [
      syncEdge('e_cli_lb', 'cli', 'lb', 5000),
      syncEdge('e_lb_a', 'lb', 'svc_a', 500),
      syncEdge('e_lb_b', 'lb', 'svc_b', 500),
      syncEdge('e_lb_c', 'lb', 'svc_c', 500),
    ],
    annotations: [],
    sketches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    chaosPlan: [
      {
        id: 'fo1',
        kind: 'node_degraded',
        node_id: 'svc_c',
        at_ms: 0,
        duration_ms: 5000,
        mode: 'slow',
        intensity: 1.0,
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
      load_shape: { kind: 'constant', rps: 20 },
    },
  ]
}

export const scenario: DemoScenario = {
  slug: 'saturating-fan-out',
  cardLabel: 'Saturating fan-out',
  cardBlurb:
    'Three downstream services share traffic round-robin; one is degraded 10×. System-wide p99 tracks the slow one.',
  bannerHeadline: 'Saturating fan-out (approximation)',
  bannerBody:
    'The router round-robins requests across three downstream services; one (Service C) is degraded 10× slower. Even though only ~1/3 of requests hit the slow service, the system-wide p99 tracks it. This is the tail-at-scale lesson: in fan-out (or load-balanced) architectures, your latency is bounded by your slowest dependency.',
  buildDesign,
  buildTraffic,
  defaultSimConfig: { seed: 42, durationMs: 5000, rps: 20 },
}
