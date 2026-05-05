/**
 * Canonical landing-page demo: circuit breaker + partial failure.
 *
 * Shape:    client → app_server → external_service
 * Lesson:   external_service runs degraded for the entire window (slow),
 *           the edge timeout (200ms) converts that into clean failures, and
 *           the breaker on the app_server→external_service edge opens to
 *           stop sending — keeping the app_server responsive instead of
 *           letting it queue up indefinitely behind a sick downstream.
 *
 * Loaded via `/app?demo=cb-partial`. Bypasses localStorage, drops the user
 * straight into Simulate mode at seed=42 / 5000ms / 10rps. The looping
 * landing-page hero embeds this same scenario.
 *
 * Add new demos by exporting another design + extending DEMOS below.
 */
import type { Design, TrafficSource } from '@/schema/types'
import type { SimRunConfig } from '@/sim/types'

const NOW = '2026-05-04T00:00:00.000Z'

export const CIRCUIT_BREAKER_PARTIAL_FAILURE: Design = {
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
      // The lesson edge: tight timeout + breaker on the slow downstream.
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

export interface DemoBundle {
  /** Internal name keyed by `?demo=<name>`. */
  name: string
  /** Visible name shown in the demo banner / landing page. */
  label: string
  /** One-line lesson summary for the banner. */
  blurb: string
  design: Design
  traffic: TrafficSource[]
  runConfig: Pick<SimRunConfig, 'durationMs' | 'seed' | 'snapshotIntervalMs'>
}

export const DEMOS: Record<string, DemoBundle> = {
  'cb-partial': {
    name: 'cb-partial',
    label: 'Circuit breaker + partial failure',
    blurb:
      'The external service is slow; the timeout converts that into clean failures; the breaker opens to stop sending; the system stays responsive.',
    design: CIRCUIT_BREAKER_PARTIAL_FAILURE,
    traffic: [
      {
        id: 'demo-src',
        label: 'Demo traffic',
        target_node_id: 'cli',
        load_shape: { kind: 'constant', rps: 10 },
      },
    ],
    runConfig: { durationMs: 5000, seed: 42, snapshotIntervalMs: 100 },
  },
  // TODO: backpressure-propagation, replication-lag-spike, consistency-models-comparison
}

export function loadDemo(name: string): DemoBundle | undefined {
  return DEMOS[name]
}
