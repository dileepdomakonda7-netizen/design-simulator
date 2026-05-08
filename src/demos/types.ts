/**
 * Demo scenario shape. Each curated scenario exports one of these and registers
 * itself in src/demos/index.ts. The /app loader reads the registry; the landing
 * page concept grid renders one card per registered scenario.
 *
 * Design intent: a scenario is a pre-configured Design + TrafficSource[] +
 * sim-config defaults. The chaos plan lives on the Design (Design.chaosPlan).
 * Banner copy is structured so the SimulateMode banner can render an optional
 * "try this next" follow-up in italics without baking markup into strings.
 */
import type { Design, TrafficSource } from '@/schema/types'

export interface DemoScenario {
  /** URL slug; used as `?demo=<slug>` and as React key. */
  slug: string
  /** Short label shown on the landing-page card. Plain text, no emoji. */
  cardLabel: string
  /** One-line description for the landing card; first sentence of the banner. */
  cardBlurb: string
  /** Banner headline shown after the 📚 emoji. */
  bannerHeadline: string
  /** Banner body — the main lesson explanation. */
  bannerBody: string
  /** Optional italic follow-up suggestion ("try this next"). */
  bannerFollowup?: string
  /** When true: card shows "Coming soon" and is non-clickable; loader has no entry. */
  comingSoon?: boolean
  /** Build a fresh Design (with chaos plan baked in). Called every load. */
  buildDesign(): Design
  /** Build the traffic sources for this scenario. Called every run. */
  buildTraffic(design: Design): TrafficSource[]
  /** Default seed/duration/rps for autoplay + ControlPanel pre-fill. */
  defaultSimConfig: {
    seed: number
    durationMs: number
    rps: number
  }
}
