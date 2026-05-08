/**
 * Canonical demo: circuit breaker + partial failure.
 *
 * Shape:    client → app_server → external_service
 * Lesson:   external_service runs degraded for the entire window (slow), the
 *           edge timeout (200ms) converts that into clean failures, and the
 *           breaker on the app_server→external_service edge opens to stop
 *           sending — keeping the app_server responsive instead of letting
 *           it queue up indefinitely behind a sick downstream.
 *
 * Loaded via `/app?demo=circuit-breaker-partial-failure`. The looping
 * landing-page hero embeds the same scenario.
 */
import type { Design, TrafficSource } from '@/schema/types'
import type { DemoScenario } from './types'

const NOW = '2026-05-04T00:00:00.000Z'

function buildDesign(): Design {
  return {
    schemaVersion: 1,
    id: 'demo-cb-partial',
    name: 'Demo: Circuit breaker + partial failure',
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
          rps: 10,
          think_time_ms: 100,
          timeout_ms: 5000,
          retry_policy: { kind: 'none' },
        },
      },
      {
        id: 'app',
        position: { x: 380, y: 200 },
        label: 'App server',
        notes: '',
        type: 'app_server',
        params: {
          instances: 5,
          max_concurrent_per_instance: 100,
          latency_ms_p50: 5,
          latency_ms_p99: 10,
          failure_rate: 0,
        },
      },
      {
        id: 'ext',
        position: { x: 680, y: 200 },
        label: 'External service',
        notes: '',
        type: 'external_service',
        params: {
          latency_ms_p50: 100,
          latency_ms_p99: 500,
          failure_rate: 0,
          timeout_ms: 8000,
          rate_limit_rps: 0,
        },
      },
    ],
    edges: [
      {
        id: 'e1',
        source: 'cli',
        target: 'app',
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
      {
        id: 'e2',
        source: 'app',
        target: 'ext',
        kind: 'sync_rpc',
        params: {
          network_latency_ms_p50: 1,
          network_latency_ms_p99: 5,
          timeout_ms: 200,
          retry_policy: { kind: 'none' },
          circuit_breaker: {
            enabled: true,
            failure_threshold: 0.5,
            success_threshold: 3,
            half_open_timeout_ms: 1000,
          },
          idempotent: false,
        },
      },
    ],
    annotations: [],
    sketches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    chaosPlan: [
      {
        id: 'd1',
        kind: 'node_degraded',
        node_id: 'ext',
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
      load_shape: { kind: 'constant', rps: 10 },
    },
  ]
}

export const scenario: DemoScenario = {
  slug: 'circuit-breaker-partial-failure',
  cardLabel: 'Circuit breaker',
  cardBlurb:
    'A slow downstream becomes clean failures via tight timeout, and the breaker opens to stop sending.',
  bannerHeadline: 'Circuit breaker + partial failure',
  bannerBody:
    'The external service is slow; the timeout converts that into clean failures; the breaker opens to stop sending; the system stays responsive.',
  buildDesign,
  buildTraffic,
  defaultSimConfig: { seed: 42, durationMs: 5000, rps: 10 },
}
