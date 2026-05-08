/**
 * Retry storm.
 *
 * Shape:   client → app_server → external_service (failure_rate=0.6)
 * Edge app_server → external_service: exponential backoff retry up to 5 attempts,
 *   no circuit breaker, timeout_ms=2000.
 * Chaos:   none — the lesson is the retry policy itself.
 *
 * Lesson:  every retry is fresh load on a service that is already failing.
 *          The aggregate request count to the failing service climbs in
 *          lockstep with the rejection counter; this is exactly what circuit
 *          breakers exist to prevent.
 */
import type { Design, TrafficSource } from '@/schema/types'
import type { DemoScenario } from './types'

const NOW = '2026-05-08T00:00:00.000Z'

function buildDesign(): Design {
  return {
    schemaVersion: 1,
    id: 'demo-retry-storm',
    name: 'Demo: Retry storm',
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
          timeout_ms: 10000,
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
          instances: 3,
          max_concurrent_per_instance: 10,
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
          latency_ms_p50: 50,
          latency_ms_p99: 200,
          failure_rate: 0.6,
          timeout_ms: 3000,
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
          timeout_ms: 8000,
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
          timeout_ms: 2000,
          retry_policy: {
            kind: 'exponential_backoff',
            max_retries: 5,
            base_delay_ms: 50,
            max_delay_ms: 500,
            jitter: false,
          },
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
    },
  ]
}

export const scenario: DemoScenario = {
  slug: 'retry-storm',
  cardLabel: 'Retry storm',
  cardBlurb:
    'A failing service gets retried up to 5× per request, with no circuit breaker. Every retry is fresh load.',
  bannerHeadline: 'Retry storm',
  bannerBody:
    'The external service fails 60% of the time. The edge retries up to 5 times with exponential backoff, no circuit breaker. Watch the rejection counter and the request count to the external service climb together — every retry is fresh load on a service that is already failing. This is why circuit breakers exist.',
  buildDesign,
  buildTraffic,
  defaultSimConfig: { seed: 42, durationMs: 5000, rps: 20 },
}
