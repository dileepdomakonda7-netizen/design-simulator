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
