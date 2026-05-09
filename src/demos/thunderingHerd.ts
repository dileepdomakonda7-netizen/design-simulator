/**
 * Thundering herd.
 *
 * Shape:   10× client → load_balancer → external_service (rate_limit_rps=80)
 * Chaos:   traffic_spike multiplier=5 at_ms=2000 duration_ms=1000.
 *
 * Lesson:  baseline 100 RPS sits below the rate limit. The 5× spike pushes
 *          aggregate to 500 RPS for one second; latency spikes and the
 *          rate limit clips. This is what happens at midnight when every
 *          cron job in your fleet wakes up at the same instant.
 */
import type { Design, TrafficSource } from '@/schema/types'
import type { DemoScenario } from './types'

const NOW = '2026-05-08T00:00:00.000Z'

const CLIENT_COUNT = 10
const PER_CLIENT_RPS = 10

function clientNode(
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
    type: 'client',
    params: {
      rps: PER_CLIENT_RPS,
      think_time_ms: 100,
      timeout_ms: 5000,
      retry_policy: { kind: 'none' },
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
  // Lay the 10 clients out in a 2-column × 5-row grid so they don't overlap
  // (round-1 they were stacked in a single column at x=60 with 70px stride —
  // each node is 80px tall, so adjacent labels collided). LB sits to the
  // right of the grid; external service to the right of the LB.
  const clients: Design['nodes'] = []
  const edges: Design['edges'] = []
  const COL_X = [40, 240] as const
  const ROW_Y = [40, 140, 240, 340, 440] as const
  for (let i = 0; i < CLIENT_COUNT; i++) {
    const id = `cli${i + 1}`
    const col = i % COL_X.length
    const row = Math.floor(i / COL_X.length)
    clients.push(clientNode(id, `Client #${i + 1}`, COL_X[col]!, ROW_Y[row]!))
    edges.push(syncEdge(`e_${id}_lb`, id, 'lb', 5000))
  }
  const lbY = (ROW_Y[0]! + ROW_Y[ROW_Y.length - 1]!) / 2

  return {
    schemaVersion: 1,
    id: 'demo-thundering-herd',
    name: 'Demo: Thundering herd',
    createdAt: NOW,
    updatedAt: NOW,
    nodes: [
      ...clients,
      {
        id: 'lb',
        position: { x: 480, y: lbY },
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
      {
        id: 'ext',
        position: { x: 780, y: lbY },
        label: 'Shared service',
        notes: '',
        type: 'external_service',
        params: {
          latency_ms_p50: 20,
          latency_ms_p99: 80,
          failure_rate: 0,
          timeout_ms: 5000,
          rate_limit_rps: 80,
        },
      },
    ],
    // 600ms LB→ext timeout: rate-limited rejections at the service emit
    // request_reject without forwarding a response, so the LB only sees a
    // failure when its own timeout fires. Tight enough for failures to
    // surface during the 1000ms spike window instead of past sim_end.
    edges: [...edges, syncEdge('e_lb_ext', 'lb', 'ext', 600)],
    annotations: [],
    sketches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    chaosPlan: [
      {
        id: 'th1',
        kind: 'traffic_spike',
        multiplier: 5,
        at_ms: 2000,
        duration_ms: 1000,
      },
    ],
  }
}

function buildTraffic(_design: Design): TrafficSource[] {
  const sources: TrafficSource[] = []
  for (let i = 0; i < CLIENT_COUNT; i++) {
    const id = `cli${i + 1}`
    sources.push({
      id: `demo-src-${id}`,
      label: `Client #${i + 1}`,
      target_node_id: id,
      load_shape: { kind: 'constant', rps: PER_CLIENT_RPS },
    })
  }
  return sources
}

export const scenario: DemoScenario = {
  slug: 'thundering-herd',
  cardLabel: 'Thundering herd',
  cardBlurb:
    'Ten clients converge on one shared service. At t=2000ms they all spike 5× simultaneously.',
  bannerHeadline: 'Thundering herd',
  bannerBody:
    'Ten clients converge on one resource. Normal load is 100 RPS, well within capacity. At t=2000ms, all clients spike 5× simultaneously — 500 RPS for one second. Watch the latency spike and the rejection rate. This is what happens at midnight when every cron job in your fleet wakes up at the same instant.',
  buildDesign,
  buildTraffic,
  defaultSimConfig: { seed: 42, durationMs: 5000, rps: PER_CLIENT_RPS },
}
