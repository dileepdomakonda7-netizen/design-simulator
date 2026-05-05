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

/**
 * Phase 6c: a `node_degraded` chaos event in 'slow' mode at intensity 0.8
 * scales the app_server's latency by 1 + 0.8*9 = 8.2× during the window.
 * Two runs at seed=42 must produce byte-identical event streams — the
 * degradation pulls samples from the per-node RNG deterministically.
 */
describe('phase 6c partial failures', () => {
  async function runDegraded(seed: number): Promise<{ events: SimEvent[] }> {
    const events: SimEvent[] = []
    const config: SimRunConfig = {
      design: fixtureDesign(),
      traffic: [
        {
          id: 'src',
          label: 'T',
          target_node_id: 'client-1',
          load_shape: { kind: 'constant', rps: 10 },
        },
      ],
      chaos: [
        {
          id: 'd1',
          kind: 'node_degraded',
          node_id: 'app-1',
          at_ms: 500,
          duration_ms: 1200,
          mode: 'slow',
          intensity: 0.8,
        },
      ],
      durationMs: 2500,
      seed,
      snapshotIntervalMs: 250,
    }
    const engine = new SimulationEngine(config, () => {}, (e) => events.push(e))
    await engine.run()
    return { events }
  }

  it('slow degradation: two seed=42 runs produce identical event streams', async () => {
    const a = await runDegraded(42)
    const b = await runDegraded(42)
    expect(a.events.length).toBe(b.events.length)
    expect(a.events).toEqual(b.events)
    const starts = a.events.filter((e) => e.kind === 'node_degraded_start')
    const ends = a.events.filter((e) => e.kind === 'node_degraded_end')
    expect(starts.length).toBe(1)
    expect(ends.length).toBe(1)
    expect(computeDigest(a.events)).toBe(computeDigest(b.events))
  })

  /**
   * Acceptance #5: a tight edge timeout converts partial failure into clean
   * failure. With the downstream node degraded to ~10× latency (intensity=1.0
   * over a p50=100/p99=500 base → effective p50=1000/p99=5000), the edge from
   * app_server → external_service times out near `edge.params.timeout_ms`.
   *
   * Run A (timeout_ms=200) should produce many request_timeout events at the
   * app_server. Run B (timeout_ms=5000) should produce few (the requests fit
   * inside the budget and complete normally).
   *
   * This test was added to catch the bug where app_server forwarded to
   * downstream via emitWithBreaker but never scheduled a timeout guard for
   * the edge — making `edge.params.timeout_ms` a no-op.
   */
  async function runTimeoutVsSlow(
    edgeTimeoutMs: number,
    seed: number,
  ): Promise<{ events: SimEvent[] }> {
    const events: SimEvent[] = []
    const now = '2026-01-01T00:00:00.000Z'
    const design: Design = {
      schemaVersion: 1,
      id: 'd-timeout',
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
            timeout_ms: 8000,
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
            timeout_ms: edgeTimeoutMs,
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
    const config: SimRunConfig = {
      design,
      traffic: [
        {
          id: 'src',
          label: 'T',
          target_node_id: 'cli',
          load_shape: { kind: 'constant', rps: 10 },
        },
      ],
      chaos: [
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
      durationMs: 5000,
      seed,
      snapshotIntervalMs: 250,
    }
    const engine = new SimulationEngine(config, () => {}, (e) => events.push(e))
    await engine.run()
    return { events }
  }

  it('tight edge timeout converts slow downstream into clean failure', async () => {
    const tight = await runTimeoutVsSlow(200, 42)
    const loose = await runTimeoutVsSlow(5000, 42)

    const timeoutsAt = (events: SimEvent[], nodeId: string) =>
      events.filter((e) => e.kind === 'request_timeout' && e.nodeId === nodeId)

    const tightTimeouts = timeoutsAt(tight.events, 'app').length
    const looseTimeouts = timeoutsAt(loose.events, 'app').length

    // Tight timeout: most requests time out at the app_server (~30+ over the
    // 5s window at 10rps with effective p50≈1000ms).
    expect(tightTimeouts).toBeGreaterThan(10)
    // Loose timeout: the budget covers the degraded p99, so few/no timeouts.
    expect(looseTimeouts).toBeLessThan(tightTimeouts / 4)

    // Determinism: same seed → identical event stream with the tight timeout.
    const tight2 = await runTimeoutVsSlow(200, 42)
    expect(tight.events).toEqual(tight2.events)
  })
})

/**
 * Phase 6d: client → database with replicas=3, read_routing='mixed'.
 * Two seed=42 runs must produce byte-identical event streams INCLUDING the
 * stalenessMs and replicaIndex payloads. A different seed should diverge.
 *
 * The point: replica selection and per-read lag sampling both pull from the
 * deterministic per-node rng — never from a fresh stream — so re-runs of the
 * same scenario are reproducible to the byte.
 */
describe('phase 6d replication', () => {
  function replicaDesign(): Design {
    const now = '2026-01-01T00:00:00.000Z'
    return {
      schemaVersion: 1,
      id: 'd-rep',
      name: 't',
      createdAt: now,
      updatedAt: now,
      nodes: [
        {
          id: 'cli', position: { x: 0, y: 0 }, label: 'C', notes: '', type: 'client',
          params: { rps: 10, think_time_ms: 100, timeout_ms: 5000, retry_policy: { kind: 'none' } },
        },
        {
          id: 'db', position: { x: 200, y: 0 }, label: 'D', notes: '', type: 'database',
          params: {
            subtype: 'relational',
            replicas: 3,
            read_capacity_rps: 5000,
            write_capacity_rps: 1000,
            replication_mode: 'async',
            replication_lag_ms_p50: 20,
            replication_lag_ms_p99: 200,
            read_latency_ms_p50: 5,
            read_latency_ms_p99: 30,
            write_latency_ms_p50: 10,
            write_latency_ms_p99: 80,
            failure_rate: 0,
            read_routing: 'mixed',
          },
        },
      ],
      edges: [
        {
          id: 'e1', source: 'cli', target: 'db', kind: 'sync_rpc',
          params: {
            network_latency_ms_p50: 1, network_latency_ms_p99: 5, timeout_ms: 3000,
            retry_policy: { kind: 'none' },
            circuit_breaker: { enabled: false, failure_threshold: 0.5, success_threshold: 3, half_open_timeout_ms: 5000 },
            idempotent: false,
          },
        },
      ],
      annotations: [],
      sketches: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }
  }

  async function runReplica(seed: number): Promise<{ events: SimEvent[] }> {
    const events: SimEvent[] = []
    const config: SimRunConfig = {
      design: replicaDesign(),
      traffic: [
        { id: 'src', label: 'T', target_node_id: 'cli', load_shape: { kind: 'constant', rps: 10 } },
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

  it('replica routing produces deterministic stalenessMs and replicaIndex', async () => {
    const a = await runReplica(42)
    const b = await runReplica(42)
    expect(a.events).toEqual(b.events)

    // Seed=99 must diverge.
    const c = await runReplica(99)
    expect(computeDigest(a.events)).not.toBe(computeDigest(c.events))

    // Sanity: at least some response payloads carry stalenessMs and a valid
    // replicaIndex in the [0..N-2] range. With 'mixed', not every response
    // hits a replica — but enough do over a 3s window at 10 rps.
    const replicaResponses = a.events.filter((e) => {
      if (e.kind !== 'request_response') return false
      const p = e.payload as { replicaIndex?: number; stalenessMs?: number } | undefined
      return p?.replicaIndex !== undefined && (p.stalenessMs ?? 0) > 0
    })
    expect(replicaResponses.length).toBeGreaterThan(0)
    for (const e of replicaResponses) {
      const p = e.payload as { replicaIndex?: number }
      expect(p.replicaIndex).toBeGreaterThanOrEqual(0)
      expect(p.replicaIndex).toBeLessThanOrEqual(1) // replicas=3 → indices 0..1
    }

    // And the snapshot's maxStalenessMs surfaces a positive number.
    const snapshots: SimSnapshot[] = []
    const config: SimRunConfig = {
      design: replicaDesign(),
      traffic: [
        { id: 'src', label: 'T', target_node_id: 'cli', load_shape: { kind: 'constant', rps: 10 } },
      ],
      chaos: [],
      durationMs: 3000,
      seed: 42,
      snapshotIntervalMs: 250,
    }
    const engine = new SimulationEngine(config, (s) => snapshots.push(s), () => {})
    await engine.run()
    const maxes = snapshots.map((s) => s.windowMetrics.maxStalenessMs)
    expect(Math.max(...maxes)).toBeGreaterThan(0)
  })
})
