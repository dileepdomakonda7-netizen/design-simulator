/**
 * Sync replication trap (DEFERRED).
 *
 * The v1 engine stores `replication_mode: 'sync' | 'async'` on database
 * params but does NOT model sync semantics — writes never block on replica
 * acknowledgment, so a replication_lag_spike on a sync-mode database does
 * not cause throughput collapse. Shipping the demo with the banner copy
 * from the launch spec would be misleading.
 *
 * This file is registered with `comingSoon: true` so the landing page card
 * appears as "Coming soon" and the loader does not accept the slug. When
 * sync semantics land, drop `comingSoon` and the scenario goes live.
 */
import type { Design, TrafficSource } from '@/schema/types'
import type { DemoScenario } from './types'

function unimplemented(): never {
  throw new Error('sync-replication-trap is comingSoon — not loadable in v1')
}

function buildDesign(): Design {
  unimplemented()
}

function buildTraffic(_design: Design): TrafficSource[] {
  unimplemented()
}

export const scenario: DemoScenario = {
  slug: 'sync-replication-trap',
  cardLabel: 'Sync replication trap',
  cardBlurb:
    'Sync replication blocks every write on all replicas; lag spikes collapse throughput.',
  bannerHeadline: 'Sync replication trap',
  bannerBody:
    'With sync replication, every write blocks until all replicas acknowledge. When replica lag spikes, writes get stuck waiting and throughput collapses. This is why most production systems use async replication despite the staleness.',
  comingSoon: true,
  buildDesign,
  buildTraffic,
  defaultSimConfig: { seed: 42, durationMs: 5000, rps: 20 },
}
