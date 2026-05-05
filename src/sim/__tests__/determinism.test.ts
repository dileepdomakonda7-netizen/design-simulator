import { describe, expect, it } from 'vitest'
import { SimulationEngine } from '../engine'
import { computeDigest } from '../digest'
import type {
  SimEvent,
  SimRunConfig,
  SimSnapshot,
  TrafficSource,
} from '../types'
import type { Design } from '@/schema/types'

// Importing behavior modules registers their (componentType, eventKind)
// handlers in the registry via side effect. The test imports them explicitly
// because we don't go through worker.ts in Node.
import '../behaviors/clientBehavior'
import '../behaviors/loadBalancerBehavior'
import '../behaviors/apiGatewayBehavior'
import '../behaviors/appServerBehavior'
import '../behaviors/cacheBehavior'
import '../behaviors/databaseBehavior'
import '../behaviors/queueBehavior'
import '../behaviors/pubSubBehavior'
import '../behaviors/cdnBehavior'
import '../behaviors/objectStorageBehavior'
import '../behaviors/externalServiceBehavior'

/**
 * Build a fixture design with EXPLICIT ids (no nanoid). Two test invocations
 * receive the same Design value, so any divergence between runs has to come
 * from the engine itself.
 */
function fixtureDesign(): Design {
  const now = '2026-01-01T00:00:00.000Z'
  return {
    schemaVersion: 1,
    id: 'design-test',
    name: 'Determinism Fixture',
    createdAt: now,
    updatedAt: now,
    nodes: [
      {
        id: 'client-1',
        position: { x: 0, y: 0 },
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
        id: 'app-1',
        position: { x: 200, y: 0 },
        label: 'App',
        notes: '',
        type: 'app_server',
        params: {
          instances: 3,
          max_concurrent_per_instance: 100,
          latency_ms_p50: 20,
          latency_ms_p99: 100,
          failure_rate: 0,
        },
      },
      {
        id: 'db-1',
        position: { x: 400, y: 0 },
        label: 'DB',
        notes: '',
        type: 'database',
        params: {
          subtype: 'relational',
          replicas: 3,
          read_capacity_rps: 5000,
          write_capacity_rps: 1000,
          replication_mode: 'async',
          replication_lag_ms_p50: 50,
          replication_lag_ms_p99: 500,
          read_latency_ms_p50: 5,
          read_latency_ms_p99: 30,
          write_latency_ms_p50: 10,
          write_latency_ms_p99: 80,
          failure_rate: 0,
        },
      },
    ],
    edges: [
      {
        id: 'e1',
        source: 'client-1',
        target: 'app-1',
        kind: 'sync_rpc',
        params: {
          network_latency_ms_p50: 1,
          network_latency_ms_p99: 5,
          timeout_ms: 3000,
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
        source: 'app-1',
        target: 'db-1',
        kind: 'sync_rpc',
        params: {
          network_latency_ms_p50: 1,
          network_latency_ms_p99: 5,
          timeout_ms: 3000,
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
  }
}

async function runOnce(seed: number): Promise<{
  events: SimEvent[]
  snapshots: SimSnapshot[]
}> {
  const events: SimEvent[] = []
  const snapshots: SimSnapshot[] = []
  const traffic: TrafficSource[] = [
    {
      id: 'src-1',
      label: 'Test',
      target_node_id: 'client-1',
      load_shape: { kind: 'constant', rps: 10 },
    },
  ]
  const config: SimRunConfig = {
    design: fixtureDesign(),
    traffic,
    chaos: [],
    durationMs: 2000,
    seed,
    snapshotIntervalMs: 500,
  }
  const engine = new SimulationEngine(
    config,
    (s) => snapshots.push(s),
    (e) => events.push(e),
  )
  await engine.run()
  return { events, snapshots }
}

function summarize(events: readonly SimEvent[]): string {
  const head = events.slice(0, 5)
  const tail = events.slice(-5)
  const fmt = (e: SimEvent) =>
    `#${e.id} at=${e.at.toFixed(3)} ${e.kind} node=${e.nodeId ?? '-'} req=${e.requestId ?? '-'} cause=${e.causeEventId ?? '-'} payload=${JSON.stringify(e.payload ?? null)}`
  return [
    `count=${events.length}`,
    'head:',
    ...head.map(fmt),
    '...',
    'tail:',
    ...tail.map(fmt),
  ].join('\n')
}

describe('engine determinism', () => {
  it('three sequential seed=42 runs in one process produce identical event streams', async () => {
    const a = await runOnce(42)
    const b = await runOnce(42)
    const c = await runOnce(42)
    expect(a.events.length).toBe(b.events.length)
    expect(a.events.length).toBe(c.events.length)
    expect(a.events).toEqual(b.events)
    expect(a.events).toEqual(c.events)
  })

  it('produces identical event streams for identical (design, seed, config)', async () => {
    const a = await runOnce(42)
    const b = await runOnce(42)

    if (a.events.length !== b.events.length) {
      throw new Error(
        `event count diverged: ${a.events.length} vs ${b.events.length}\n` +
          `A:\n${summarize(a.events)}\n\nB:\n${summarize(b.events)}`,
      )
    }

    // Find the FIRST diverging event so the failure message points at the bug.
    let firstDiff = -1
    for (let i = 0; i < a.events.length; i++) {
      const ae = a.events[i]!
      const be = b.events[i]!
      if (
        ae.id !== be.id ||
        ae.at !== be.at ||
        ae.kind !== be.kind ||
        ae.nodeId !== be.nodeId ||
        ae.requestId !== be.requestId ||
        JSON.stringify(ae.payload) !== JSON.stringify(be.payload)
      ) {
        firstDiff = i
        break
      }
    }
    if (firstDiff >= 0) {
      const ae = a.events[firstDiff]!
      const be = b.events[firstDiff]!
      throw new Error(
        `events diverge at index ${firstDiff}\n` +
          `A: #${ae.id} at=${ae.at} ${ae.kind} node=${ae.nodeId} req=${ae.requestId} cause=${ae.causeEventId} payload=${JSON.stringify(ae.payload)}\n` +
          `B: #${be.id} at=${be.at} ${be.kind} node=${be.nodeId} req=${be.requestId} cause=${be.causeEventId} payload=${JSON.stringify(be.payload)}`,
      )
    }

    expect(a.events).toEqual(b.events)
  })

  it('produces a different event stream at a different seed', async () => {
    const a = await runOnce(42)
    const b = await runOnce(99)
    expect(a.events).not.toEqual(b.events)
  })

  it('events survive structuredClone roundtrip without mutating', async () => {
    // Simulates the Comlink boundary between worker and main thread.
    // If structuredClone alters an event in any way, this catches it.
    const a = await runOnce(42)
    const cloned = a.events.map((e) => structuredClone(e))
    expect(cloned).toEqual(a.events)
  })

  it("user scenario: client → cache(hit_rate=0) → DB, 3 runs at seed=42 are identical", async () => {
    const a = await runUserScenario(42)
    const b = await runUserScenario(42)
    const c = await runUserScenario(42)
    expect(a.events.length).toBe(b.events.length)
    expect(a.events.length).toBe(c.events.length)
    expect(a.events).toEqual(b.events)
    expect(a.events).toEqual(c.events)
  })

  it('user scenario: digest matches across 3 runs at seed=42', async () => {
    const a = computeDigest((await runUserScenario(42)).events)
    const b = computeDigest((await runUserScenario(42)).events)
    const c = computeDigest((await runUserScenario(42)).events)
    expect(a).toBe(b)
    expect(a).toBe(c)
  })

  it('digest is order-independent: shuffled events produce same digest', async () => {
    const { events } = await runUserScenario(42)
    const shuffled = [...events].reverse()
    expect(computeDigest(shuffled)).toBe(computeDigest(events))
  })

  it('chaos plan with end-time past duration: 3 runs at seed=42 are identical', async () => {
    // User's exact reproducer: cache_miss_storm at 2000 with duration 3500
    // (ends at 5500, past sim end 5000). The end-event is scheduled but never
    // fires; we want digests to still match across runs.
    const a = await runUserScenarioWithChaos(42, [
      {
        id: 'c1',
        kind: 'cache_miss_storm',
        node_id: 'ca',
        at_ms: 2000,
        duration_ms: 3500,
      },
    ])
    const b = await runUserScenarioWithChaos(42, [
      {
        id: 'c1',
        kind: 'cache_miss_storm',
        node_id: 'ca',
        at_ms: 2000,
        duration_ms: 3500,
      },
    ])
    const c = await runUserScenarioWithChaos(42, [
      {
        id: 'c1',
        kind: 'cache_miss_storm',
        node_id: 'ca',
        at_ms: 2000,
        duration_ms: 3500,
      },
    ])
    expect(a.events.length).toBe(b.events.length)
    expect(a.events).toEqual(b.events)
    expect(a.events).toEqual(c.events)
    expect(computeDigest(a.events)).toBe(computeDigest(b.events))
    expect(computeDigest(a.events)).toBe(computeDigest(c.events))
  })
})

async function runUserScenarioWithChaos(
  seed: number,
  chaos: SimRunConfig['chaos'],
): Promise<{ events: SimEvent[] }> {
  const events: SimEvent[] = []
  const config: SimRunConfig = {
    design: userScenarioDesign(),
    traffic: [
      {
        id: 'src',
        label: 'Test',
        target_node_id: 'cli',
        load_shape: { kind: 'constant', rps: 10 },
      },
    ],
    chaos,
    durationMs: 5000,
    seed,
    snapshotIntervalMs: 250,
  }
  const engine = new SimulationEngine(
    config,
    () => {},
    (e) => events.push(e),
  )
  await engine.run()
  return { events }
}

/**
 * Phase 6a backpressure regression: bounded app_server queue under sustained
 * overload must produce a deterministic event stream AND non-zero rejections.
 */
describe('phase 6a backpressure', () => {
  function backpressureDesign(): Design {
    const base = fixtureDesign()
    // Override app_server with bounded queue.
    const app = base.nodes.find((n) => n.id === 'app-1')!
    if (app.type !== 'app_server') throw new Error('expected app_server')
    app.params = {
      ...app.params,
      instances: 1,
      max_concurrent_per_instance: 5,
      queue_max_depth: 10,
      rejection_policy: 'reject_newest',
    }
    return base
  }

  async function runOverload(seed: number): Promise<{ events: SimEvent[] }> {
    const events: SimEvent[] = []
    const config: SimRunConfig = {
      design: backpressureDesign(),
      traffic: [
        {
          id: 'src',
          label: 'Overload',
          target_node_id: 'client-1',
          load_shape: { kind: 'constant', rps: 200 },
        },
      ],
      chaos: [],
      durationMs: 3000,
      seed,
      snapshotIntervalMs: 250,
    }
    const engine = new SimulationEngine(config, () => {}, (e) => events.push(e))
    await engine.run()
    return { events }
  }

  it('bounded app_server under overload: deterministic events + non-zero rejections', async () => {
    const a = await runOverload(42)
    const b = await runOverload(42)
    expect(a.events).toEqual(b.events)
    const rejects = a.events.filter((e) => e.kind === 'request_reject')
    expect(rejects.length).toBeGreaterThan(0)
    // Rejections at the app_server, not just at edges.
    const appRejects = rejects.filter((e) => e.nodeId === 'app-1')
    expect(appRejects.length).toBeGreaterThan(0)
  })

  it('breaker reduces send attempts vs retries-without-breaker', async () => {
    // client → app_server → external_service that always fails (failure_rate=1).
    // Edge app_server → external_service has retry_policy with 5 attempts.
    // Without breaker: ~6× send attempts per request (1 + 5 retries) ≈ 50 × 6 = 300.
    // With breaker: after the breaker opens, retries short-circuit at the source.
    function design(withBreaker: boolean): Design {
      const now = '2026-01-01T00:00:00.000Z'
      return {
        schemaVersion: 1,
        id: 'd-cb',
        name: 't',
        createdAt: now,
        updatedAt: now,
        nodes: [
          {
            id: 'cli',
            position: { x: 0, y: 0 },
            label: 'C',
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
            position: { x: 100, y: 0 },
            label: 'A',
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
            position: { x: 200, y: 0 },
            label: 'X',
            notes: '',
            type: 'external_service',
            params: {
              latency_ms_p50: 5,
              latency_ms_p99: 10,
              failure_rate: 1,
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
              timeout_ms: 3000,
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
              timeout_ms: 3000,
              retry_policy: {
                kind: 'exponential_backoff',
                max_retries: 5,
                base_delay_ms: 100,
                max_delay_ms: 2000,
                jitter: false,
              },
              circuit_breaker: {
                enabled: withBreaker,
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
        chaosPlan: [],
      }
    }

    async function run(withBreaker: boolean): Promise<{ events: SimEvent[] }> {
      const events: SimEvent[] = []
      const config: SimRunConfig = {
        design: design(withBreaker),
        traffic: [
          {
            id: 'src',
            label: 'T',
            target_node_id: 'cli',
            load_shape: { kind: 'constant', rps: 10 },
          },
        ],
        chaos: [],
        durationMs: 5000,
        seed: 42,
        snapshotIntervalMs: 250,
      }
      const engine = new SimulationEngine(config, () => {}, (e) => events.push(e))
      await engine.run()
      return { events }
    }

    const noBreaker = await run(false)
    const withBreaker = await run(true)

    const sendsOver = (events: SimEvent[]) =>
      events.filter((e) => e.kind === 'request_send' && e.edgeId === 'e2').length
    const sendsNoBreaker = sendsOver(noBreaker.events)
    const sendsWithBreaker = sendsOver(withBreaker.events)

    // The breaker should meaningfully reduce send attempts. Concrete bound:
    // with-breaker has fewer than half of without-breaker.
    expect(sendsWithBreaker).toBeLessThan(sendsNoBreaker / 2)

    // Determinism: same seed → same event stream with breaker on.
    const withBreaker2 = await run(true)
    expect(withBreaker.events).toEqual(withBreaker2.events)

    // Breaker actually opened.
    const opens = withBreaker.events.filter(
      (e) => e.kind === 'circuit_breaker_opened',
    )
    expect(opens.length).toBeGreaterThan(0)
  })

  it('different bounded queue depth → different digest', async () => {
    const a = await runOverload(42)
    // Now run with depth 5 instead of 10.
    const events: SimEvent[] = []
    const tighter = backpressureDesign()
    const app = tighter.nodes.find((n) => n.id === 'app-1')!
    if (app.type !== 'app_server') throw new Error('expected app_server')
    app.params = { ...app.params, queue_max_depth: 5 }
    const config: SimRunConfig = {
      design: tighter,
      traffic: [
        {
          id: 'src',
          label: 'Overload',
          target_node_id: 'client-1',
          load_shape: { kind: 'constant', rps: 200 },
        },
      ],
      chaos: [],
      durationMs: 3000,
      seed: 42,
      snapshotIntervalMs: 250,
    }
    const engine = new SimulationEngine(config, () => {}, (e) => events.push(e))
    await engine.run()
    expect(computeDigest(a.events)).not.toBe(computeDigest(events))
  })
})

function userScenarioDesign(): Design {
  const now = '2026-01-01T00:00:00.000Z'
  return {
    schemaVersion: 1,
    id: 'design-user',
    name: 'User Scenario',
    createdAt: now,
    updatedAt: now,
    nodes: [
      {
        id: 'cli',
        position: { x: 0, y: 0 },
        label: 'C',
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
        id: 'ca',
        position: { x: 100, y: 0 },
        label: 'Ca',
        notes: '',
        type: 'cache',
        params: {
          hit_rate: 0,
          capacity_items: 100000,
          eviction_policy: 'lru',
          read_latency_ms_p50: 1,
          read_latency_ms_p99: 5,
          failure_rate: 0,
        },
      },
      {
        id: 'db',
        position: { x: 200, y: 0 },
        label: 'D',
        notes: '',
        type: 'database',
        params: {
          subtype: 'relational',
          replicas: 3,
          read_capacity_rps: 5000,
          write_capacity_rps: 1000,
          replication_mode: 'async',
          replication_lag_ms_p50: 50,
          replication_lag_ms_p99: 500,
          read_latency_ms_p50: 5,
          read_latency_ms_p99: 30,
          write_latency_ms_p50: 10,
          write_latency_ms_p99: 80,
          failure_rate: 0,
        },
      },
    ],
    edges: (['cli->ca', 'ca->db'] as const).map((label, i) => ({
      id: `e${i}`,
      source: i === 0 ? 'cli' : 'ca',
      target: i === 0 ? 'ca' : 'db',
      kind: 'sync_rpc' as const,
      label,
      params: {
        network_latency_ms_p50: 1,
        network_latency_ms_p99: 5,
        timeout_ms: 3000,
        retry_policy: { kind: 'none' as const },
        circuit_breaker: {
          enabled: false,
          failure_threshold: 0.5,
          success_threshold: 3,
          half_open_timeout_ms: 5000,
        },
        idempotent: false,
      },
    })),
    annotations: [],
    sketches: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  }
}

async function runUserScenario(
  seed: number,
): Promise<{ events: SimEvent[] }> {
  const events: SimEvent[] = []
  const config: SimRunConfig = {
    design: userScenarioDesign(),
    traffic: [
      {
        id: 'src',
        label: 'Test',
        target_node_id: 'cli',
        load_shape: { kind: 'constant', rps: 10 },
      },
    ],
    chaos: [],
    durationMs: 5000,
    seed,
    snapshotIntervalMs: 250,
  }
  const engine = new SimulationEngine(
    config,
    () => {},
    (e) => events.push(e),
  )
  await engine.run()
  return { events }
}
