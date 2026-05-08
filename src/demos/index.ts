/**
 * Demo scenario registry.
 *
 * The order in DEMO_SCENARIOS is the order shown on the landing page concept
 * grid. The /app loader looks up scenarios by slug; comingSoon scenarios are
 * registered (so the landing card renders with a "Coming soon" badge) but
 * the loader rejects them.
 */
import type { DemoScenario } from './types'
import { scenario as circuitBreakerPartialFailure } from './circuitBreakerPartialFailure'
import { scenario as cacheStampede } from './cacheStampede'
import { scenario as retryStorm } from './retryStorm'
import { scenario as readAfterWriteSurprise } from './readAfterWriteSurprise'
import { scenario as networkPartition } from './networkPartition'
import { scenario as saturatingFanOut } from './saturatingFanOut'
import { scenario as thunderingHerd } from './thunderingHerd'
import { scenario as syncReplicationTrap } from './syncReplicationTrap'

export const DEMO_SCENARIOS: readonly DemoScenario[] = [
  circuitBreakerPartialFailure,
  cacheStampede,
  retryStorm,
  readAfterWriteSurprise,
  networkPartition,
  saturatingFanOut,
  thunderingHerd,
  syncReplicationTrap,
]

const SCENARIOS_BY_SLUG = new Map(DEMO_SCENARIOS.map((s) => [s.slug, s]))

/** Return the scenario for `?demo=<slug>`, or undefined when not registered or comingSoon. */
export function getScenario(slug: string): DemoScenario | undefined {
  const s = SCENARIOS_BY_SLUG.get(slug)
  if (!s || s.comingSoon) return undefined
  return s
}

export type { DemoScenario } from './types'
