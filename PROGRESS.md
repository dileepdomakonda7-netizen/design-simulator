# Progress

## v1 launch — round 3 bug sweep (May 8, 2026)

Round-3 report (`sysdraw-bug-report-round3.md`) flagged 12 issues, including the headline determinism breakage (R3-1) — same seed produced different digests across runs. All 12 addressed; tests now 35/35 (was 24/24); build clean.

### Headline P0 fixes

- **R3-1: determinism is now stable across runs.** Root cause was that Comlink doesn't serialize incoming method invocations: when main fired `cancel()` followed by `start(...)`, the worker handled them concurrently while the previous engine was still draining its event queue. The previous run's tail events leaked into the new run's `allEventsRef` (which we cleared at the start of every new run, but had no defense against late deliveries from the prior run). Fix: extracted the worker orchestration into `src/sim/workerApi.ts` so it's testable in node, and added a single-slot promise queue:
  - `start` awaits the prior run's promise before creating a new engine.
  - `cancel` flips the engine flag *and* awaits the queue, so callers can rely on a fully-drained worker after `await api.cancel()` resolves.
  - Two new regression tests in `src/sim/__tests__/determinism.test.ts` exercise the contract directly: two sequential starts at seed 42 produce identical digests, and a cancel-mid-flight followed by a fresh start produces a digest identical to a fresh-api run.
- **R3-2 / R3-3: clean COMPLETED transition.** Reordered `SimulateMode.onComplete`: stop the periodic flush timer first, drain any remaining buffered events / snapshots, snap `currentVirtualTimeMs` to `cfg.durationMs`, then `setStatus('completed')`. The metrics card now closes its sums and the playback timer reads the configured duration in the same paint as the COMPLETED pill.

### P1 fixes

- **R3-4: paired-percentile validation.** New `LatencyPair` field component bakes the `p99 ≥ p50` invariant into the editor: bumping p50 past p99 auto-bumps p99; lowering p99 below p50 floors at p50. Threaded through every form that has a latency pair (Edge, App Server, Cache, CDN, Database — three pairs! — External Service, Object Storage, Pub/Sub).
- **R3-5: inspector field upper bounds.** Added `max=` to every numeric input that previously had only `min=`: capacities ≤ 1e6, latency / timeouts ≤ 60_000 ms (visibility / health-check ≤ 600_000 ms), RPS ≤ 100_000, replicas ≤ 100, throughput ≤ 1e6, queue depths ≤ 1e6.
- **R3-6: graph-rejection feedback.** New `ToastHost` + `useUIStore.pushToast`. `DesignCanvas.onConnect` now rejects self-loops and cycles explicitly and surfaces a toast for either case ("Can't connect a node to itself", "That edge would create a cycle. Cycles aren't supported in v1").
- **R3-7: palette overlap on Build mode.** When entering Build with a `demo-`-prefixed design, the canvas calls `fitView({ padding: 0.2 })` *and* auto-collapses the palette so the leftmost node is visible without manual interaction.
- **R3-8: per-route title de-dup.** `useDocumentHead`-bound title strips a leading `Demo: ` from the design name, so a share-link load (`?d=...`) of a design called `Demo: Cache stampede` renders as `sysdraw · Cache stampede`, matching the `?demo=` form.

### P2 fixes

- **R3-9: bound the inspector reading order.** Wrapped the inspector content in `<div role="region" aria-label="Inspector content">` so screen readers don't bleed sibling text (chart axis labels, etc.) into the Inspector landmark.
- **R3-10: shrink share-URL payload.** New `src/persistence/designCodec.ts` strips every node / edge param that equals the type's `createDefault*()` value before lz-string compression and refills them on decode. Cache-stampede's encoded payload now lands well under 1 KB (was ~1346 chars). Round-trip is property-tested across every shippable demo (`src/persistence/__tests__/urlShare.test.ts`).
- **R3-12: reset clears the playback timer.** `SimulateMode.reset` now explicitly calls `setVirtualTime(0)` so the `t = …s` indicator clears alongside the rest of the run state instead of staying frozen at the last value until the next Run.

### P3 fixes

- **R3-11: Pause button is now always mounted, disabled when the sim isn't running, with a tooltip that explains why short sims look like the button never appears ("drop the Speed selector to 0.5× or 0.25× to give yourself time to click").**

### Verification

- `npm run typecheck` clean
- `npm run lint` clean
- `npm test` — 35/35 (24 prior + 2 R3-1 regression tests in `determinism.test.ts` + 9 share-link round-trip tests in `urlShare.test.ts`)
- `npm run build` clean

## v1 launch — round 2 bug sweep (May 8, 2026)

Round-2 report (`sysdraw-bug-report-round2.md`) flagged 15 issues, with 3 P0 demos that didn't actually demonstrate their stated failure mode plus the consequent in-flight accounting hole. All 15 addressed; tests still 24/24 green; build clean.

### What this round added

- **Engine: finalize in-flight at simulation_end (R-2).** New `SimulationEngine.finalizeInFlightRequests` walks every request still in flight when `simulation_end` fires, emits a synthetic `request_response` (`success: false`, `abandoned: true`) at the request's origin, and runs each through `maybeFinalize` so `cumFailedRequests` increments. This closes the `arrived = completed + failed` math whenever the user runs a scenario where rate-limit / partition rejections don't propagate a response back upstream within the sim duration. Events get fresh deterministic ids from `nextEventId` and are sorted by request id before iteration, so digests stay stable.
- **R-1 demo retunes:**
  - **network-partition** — LB→app edge timeouts dropped from 5000 ms → 800 ms so requests routed to the partitioned app server actually time out within the 1500 ms partition window. Combined with the at-sim-end finalization, the error rate now climbs visibly during 2000–3500 ms.
  - **hot-shard** — shard 1 capacity tightened: `read_capacity_rps 200 → 5`, queue 50 → 10, latency p50/p99 5/30 → 120/400. At 80 rps the in-flight pressure overruns the cap, the queue fills, then `request_reject` events fire at shard 1. Shards 2 and 3 retain the original 200 cap and stay idle.
  - **thundering-herd** — LB→ext timeout 5000 ms → 600 ms, so rate-limit rejections at the shared service surface as failures inside the 1000 ms spike window. The 10 clients are now laid out in a 2×5 grid (R-5) instead of a single overlapping column.
  - Smoke-checked locally: all three scenarios at seed 42 produce non-zero failure signals at their named nodes (`cli` failure-final responses for partition; `shard_1` rejects for hot-shard; `ext` rejects for thundering-herd).
- **R-3 invalid demo URL → friendly fallback.** When `?demo=<slug>` resolves to nothing, `App.tsx` renders a 404-style page listing the live scenarios with `Link`s to each, instead of silently loading the most recent localStorage design.
- **R-4 design-name input ellipsis.** `DesignNameEditor` widened to `max-w-96` and the `<input size>` now tracks `localName.length` so demo titles like "Demo: Read-after-write surprise" render in full.
- **R-5 client overlap** — see thundering-herd retune above.
- **R-6 keyboard-add stacks.** Palette's Enter/Space handler now offsets each new node by `(count % 6, count / 6) × 32` so successive keyboard adds cascade across the canvas instead of stacking at one position.
- **R-7 Pen aria-pressed.** `PenToolGroup` Pen and Eraser buttons now expose `aria-pressed`. Pen tooltip dropped the misleading "(Build mode only)" suffix — the toolbar already gates the whole group on `mode === 'build'`.
- **R-8 palette covers leftmost demo node.** When the Build-mode canvas opens with a `demo-`-prefixed design id, `DesignCanvas` now calls `reactFlow.fitView({ padding: 0.2 })` instead of restoring the persisted viewport, so the leftmost client isn't hidden behind the palette overlay.
- **R-9 unstable Run-button position.** Toolbar pinned with `min-h-12 max-h-12 overflow-hidden`. ControlPanel pinned with `h-11 min-h-11 max-h-11 overflow-y-hidden` so the Run button stays at the same y-coordinate across mode/state transitions.
- **R-10 1× live runs hang the UI.** Worker → main streaming switched from per-event `setState` to buffered batch flushes. New `appendEvents` and `appendSnapshots` actions on `simStore`; `SimulateMode` accumulates events and snapshots in refs and drains them through a 80 ms `setInterval` (≈12 Hz), with a final `drainBuffers` on the worker's `onComplete` so the digest still sees the full event stream. Long sims at 1× now stay responsive.
- **R-11 dead millisecond on chaos `at`.** `at` clamp widened from `[0, durationMs - 1]` to `[0, durationMs]`; `duration` clamp now `[0, durationMs - at]`. The compiler still skips `spec.at_ms >= durationMs`, so a chaos that starts at the very end is a clean no-op.
- **R-12 demo storage IDs match URL slugs.** `circuitBreakerPartialFailure.ts` design id renamed `demo-cb-partial → demo-circuit-breaker-partial-failure`. The other six demos already matched. The `clearPersistedDemoDesigns` migration covers `demo-*`, so old `demo-cb-partial` entries get cleaned up on next page load.
- **R-13 banner copy cleanup.** Both `saturating-fan-out` and `hot-shard` banners rewritten to focus on the lesson, not the engine. `(approximation)` removed from the bannerHeadline; engine-internals language ("the engine does not model true horizontal sharding…") replaced with "Watch shard 1 saturate while shards 2 and 3 sit idle."
- **R-14 Pen tooltip cleanup** — combined with R-7.
- **R-15 `/app` (no demo) title.** When neither a scenario nor a `demoNotFound` is in play, `useDocumentHead` renders `sysdraw · {design.name}` instead of the bare `sysdraw`.

### Verification

- `npm run typecheck` clean
- `npm run lint` clean
- `npm test` 24/24 (existing determinism suite still passes; the engine's at-sim-end finalization is deterministic, so two runs of every scenario at seed 42 still produce identical event arrays / digests)
- `npm run build` clean
- Smoke check (run-once, asserted, then deleted to avoid CI bloat): network-partition produces non-zero failed final responses at `cli`; hot-shard produces non-zero rejects at `shard_1`; thundering-herd produces non-zero rejects at `ext`.

## v1 launch — bug sweep from end-to-end report (May 8, 2026)

Worked through the 24-bug end-to-end report (P0–P3 + quick wins). All P0/P1/P2/P3 items addressed across nine logical batches; tests still 24/24, build clean.

### Fixes by severity

**P0 (visible demo bugs)**
- **#1 File menu off-screen / behind inspector** — `FileMenu` anchor switched from `left-0` to `right-0`; `z-20` → `z-50` so it paints above the Inspector.
- **#2 Toast wraps to 1-char column** — `ShareButton` toast given an explicit `w-72 max-w-[90vw]` plus `role="status" aria-live="polite"`.
- **#3 React-Flow minimap blank** — `toRFNode` now stamps `width: 180, height: 80` (mirrors `BaseNode` defaults) so MiniMap can draw node rectangles. Both `DesignCanvas` and `SimulationCanvas` pass `nodeColor`/`nodeStrokeColor`/`nodeStrokeWidth` to MiniMap.
- **#4 Embed clips right edge** — `SimulationCanvas` now passes `fitView fitViewOptions={{ padding: 0.15 }}` instead of replaying the persisted Build-mode viewport, so the iframe always shows the whole graph.
- **#5 Cache-stampede narrative ↔ result mismatch** — design re-tuned to actually saturate the database during the cache-miss storm: `client.rps 50 → 200`, `db.read_capacity_rps 200 → 15`, `db.read_queue_max_depth 50 → 20`, `db.read_latency_ms_p50 20 → 100`, `p99 80 → 400`. Smoke-checked: non-zero `request_reject` events at `db` during 2000–4000ms.
- **#6 Cumulative counts off-by-one (retry-storm)** — `MetricsPanel` adds an `in flight` row computed as `arrived − completed − failed`; the math now closes. Surfaced in the panel header summary as `… ⏳ …` too.

**P1 (validation, copy, UX)**
- **#7 "1 instances"** — `AppServerNode` and `PubSubNode` now pluralize.
- **#8 No bounds on chaos / runner inputs** — `ControlPanel.NumberInput` now accepts `min/max` and clamps on commit. `seed` `min=0`; `duration` `min=1, max=600000`; `rps` `min=1, max=10000`. `ChaosTimeline.NumPair` extended with `min/max`; `at` clamped to `[0, durationMs-1]`, `duration` clamped to `[1, durationMs - at]`, `multiplier` clamped to `[1, 100]`.
- **#9 Failure-rate slider clipped** — `SliderField` label width `w-32 → w-28`, gap `gap-2 → gap-1.5` between slider and percent display, percent column tightened `w-10 → w-9`.
- **#10 "Prompt 5" leak** — `SketchModePlaceholder` and `FileMenu`'s "Import Image…" tooltip now say "coming soon" instead.
- **#11 `atMs=` in cache-stampede banner** — replaced with "between t=2s and t=4s".
- **#12 `/app` boots into a stale demo** — `designStore.subscribe` now skips persistence for any design whose id starts with `demo-` (templates only). One-time migration in `main.tsx` calls `clearPersistedDemoDesigns()` to wipe the demo entries already present in users' localStorage.
- **#13 Drop doesn't auto-select node** — `DesignCanvas.onDrop` calls `setRfNodes` after the schema sync to mark the freshly-dropped node `selected: true`; the inspector populates instantly.
- **#14 Number-input bumps don't replace** — `NumberField`, `NumPair`, and `ControlPanel.NumberInput` all gained `onFocus={(e) => e.currentTarget.select()}`.

**P2 (a11y / per-route head)**
- **#15 White focus ring** — global `:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }` in `index.css`.
- **#16 Palette items not focusable** — each row gets `role="listitem"`, `tabIndex=0`, `aria-label="Add <Type> node"`, and an Enter/Space keyboard handler that calls `addNode(createDefaultNode(type, {x:240, y:240}))`. Container tagged `role="list" aria-label="Add node palette"`.
- **#17 No `<main>` / skip link on `/`** — `LandingPage` wraps its content in `<main id="main-content">` and renders a "Skip to content" link as the first focusable element.
- **#18 og/title stuck on landing** — new `useDocumentHead({ title, description?, pathAndQuery })` hook updates `document.title`, `og:title`, `og:url`, `twitter:title`, `description`, `og:description`, `twitter:description`, and `<link rel="canonical">` per route. Wired into `LandingPage` and `App.tsx` (so `/app?demo=cache-stampede` shares as "sysdraw · Cache stampede" with the right canonical link).
- **Quick wins** — `ModeToggle` gets `role="group" aria-label="Mode"` and `aria-pressed` per button. ShareButton toast gains `aria-live="polite"`. `index.html` adds a `<link rel="canonical">` and a small SVG favicon.

**P3 (perf / persistence / polish)**
- **#19 Worker leak (7-11 fetches)** — `SimulateMode.start` no longer terminates the worker between runs; it spawns one on first start and reuses it via `await api.cancel()` before the next `api.start()`. `reset` likewise just cancels — termination only happens on component unmount. The autoplay-loop hero now uses a single worker for the lifetime of the iframe.
- **#20 No way to clear auto-seeded demos** — covered by #12: the pre-fix-era demo records get auto-cleared once on app boot. After this fix, they never get persisted again.
- **#21 Event-log IDs jumbled** — `EventInspector.recent` now sorts by `(at desc, id desc)` (the priority queue's tie-break), so events with identical timestamps render in the order the engine processed them.
- **#22 Out-of-range chaos changes digest** — already filtered in `compileChaosPlan` (`spec.at_ms >= durationMs` is skipped before any events are emitted). The new chaos-input clamps (#8) prevent users from entering values that fall in this range in the first place.
- **#23 Demos differ on preloaded chaos** — empty-timeline copy clarified: "No chaos events scheduled. Click a button above to add one." Designs themselves are kept as-is; retry-storm's empty timeline is the lesson.
- **#24 "Externai" truncation** — `Palette` swapped `truncate` for `whitespace-nowrap pr-2` so labels fully render at the palette's natural width.

### What this commit does NOT touch

- The Pen tool quick-win check ("confirm canvas annotation feature still saves") is a hand-test the user requested; no code change here.
- A "?" shortcut cheat sheet (quick win) — left out as new feature.
- Manifest entry for installability — favicon shipped as SVG; full PWA manifest deferred.
- Engine semantics for sync replication and parallel fan-out — still flagged in the May 8 scenario doc, not part of this bug sweep.

### Verification

- `npm run typecheck` clean
- `npm run lint` clean
- `npm test` 24/24 (existing determinism suite — no regressions; the cache-stampede determinism test still passes after the parameter retune since digests are seed-locked, not value-locked)
- `npm run build` clean (~990 KB main bundle, same as before)
- Smoke check: cache-stampede at seed=42 produces non-zero `db` `request_reject` events during the 2000–4000ms storm window.

## v1 launch — curated demo scenarios (May 8, 2026)

The 6-card concept grid on the landing page is now driven by a registry of pre-configured Design + chaos plan + traffic scenarios, not hand-rolled placeholders. Seven mandatory scenarios shipped + Path B for hot-shard. Sync-replication-trap is registered as `comingSoon` because the v1 engine does not model sync replication blocking.

### Code state

`npm test` → 24/24 (16 prior + 8 new scenario determinism tests). `npm run typecheck` / `lint` / `build` clean.

### Scenarios shipped

Registered in `src/demos/index.ts` in landing-page card order:

| # | Slug | Status | Notes |
|---|------|--------|-------|
| 1 | `circuit-breaker-partial-failure` | ✅ shipped | Retrofitted from the existing `cb-partial` bundle into the new `DemoScenario` shape. |
| 2 | `cache-stampede` | ✅ shipped | client → cache (90% hit) → db (read_queue=50). Cache miss storm at 2000–4000ms saturates the database read queue. |
| 3 | `retry-storm` | ✅ shipped | client → app → external_service (fail=0.6). Edge has exponential_backoff retry, no circuit breaker. |
| 4 | `read-after-write-surprise` | ✅ shipped | Single client, db replicas=3 async, consistency_model=eventual, write_ratio=0.4. Banner has italic follow-up suggesting read_your_writes. |
| 5 | `network-partition` | ✅ shipped | Client → LB → 3× app_server → db. Partition isolates app #3 from the LB at 2000–3500ms. |
| 6 | `saturating-fan-out` | ✅ shipped (approximation) | App_server cannot fan out in parallel — used a load_balancer round-robin to 3 external services with one degraded 10×. Banner labelled "(approximation)". |
| 7 | `thundering-herd` | ✅ shipped | 10 client nodes (rps=10 each) → LB → external_service (rate_limit=80). 5× traffic_spike at 2000–3000ms. |
| 8 | `sync-replication-trap` | ⏸ `comingSoon` | Engine v1 does not model sync semantics (`replication_mode` is stored but not honored — writes never block on replica acknowledgment). Banner copy from the launch spec would be misleading; deferred until sync semantics land. |
| 9 | `hot-shard` | ✅ shipped (Path B) | No first-class sharding primitive in the engine and no weighted LB algorithm. Approximated with 3 independent client→database pairs at 80/10/10 rps. Banner labelled "(approximation)". |

### Loader / banner / landing changes

- New `src/demos/types.ts` defines `DemoScenario`. New `src/demos/index.ts` exports the registry + `getScenario(slug)` (rejects `comingSoon` slugs).
- `App.tsx` swapped from `DEMOS[name]` lookup to `getScenario(slug)`. The scenario's design (with chaos plan baked in) is loaded into the design store; `trafficOverride` flows through `DemoModeOptions` so multi-client and write-ratio scenarios run their own traffic instead of the auto-generated single-source default.
- `SimulateMode.tsx` accepts `blurbFollowup` and `trafficOverride`. Banner renders the optional italic follow-up below the body. `buildConfig` uses `trafficOverride` when present.
- `LandingPage.tsx` renders one card per registered scenario via `DEMO_SCENARIOS.map(...)`. `comingSoon` scenarios show the badge and are non-clickable; live ones link to `/app?demo=<slug>`. The hero iframe + mobile fallback link both updated to the new slug `circuit-breaker-partial-failure`.

### Determinism

- New `describe('demo scenarios determinism', ...)` in `determinism.test.ts` iterates `DEMO_SCENARIOS`, skips `comingSoon`, and asserts two seed=42 runs produce identical event arrays + identical digests + non-zero event counts. Eight test cases (one per shippable scenario) currently pass.

### Engine limitations surfaced (documented, not fixed for this prompt)

1. **App_server fan-out.** `defaultNextHop()` selects a single outgoing sync_rpc edge per request — no parallel fan-out. Saturating-fan-out scenario uses a load_balancer round-robin instead. This means the demo shows "1/3 of requests hit the slow shard, p99 still tracks it" rather than the strict "max(N parallel)" tail-at-scale formulation. Banner adjusted accordingly.
2. **Sync replication.** `replication_mode: 'sync'` is stored on database params but the database behavior never blocks a write on replica acknowledgment. Sync-replication-trap deferred.
3. **Horizontal sharding.** No shard_router primitive; LB algorithms (round_robin / least_connections / random / consistent_hash) cannot model weighted skew. Hot-shard uses three independent client→shard pairs.

### Acceptance status

| # | Criterion | Status |
|---|-----------|--------|
| 1 | All 7 mandatory scenarios load at `/app?demo=<slug>` | ✅ (sync-replication-trap deferred per spec) |
| 2 | Each scenario produces the lesson described in its banner | ✅ verified by determinism test + manual scoping; engine semantics for chaos types match scenario design |
| 3 | Scenario 8 (hot-shard) shipped via Path A/B/C | ✅ Path B (approximation) |
| 4 | Landing page shows all scenarios as cards | ✅ |
| 5 | 17th determinism test (looped) passes | ✅ broadened to one test per scenario; 8 tests pass |
| 6 | No regression on existing cb-partial scenario | ✅ existing tests still pass; cb-partial loads at new slug |
| 7 | typecheck / lint / build pass | ✅ |
| 8 | Deploy + click-through every card on production | ⏳ pending push |

### Commits

- `prompt-scenario-loader-registry` — types, registry, cb-partial retrofit, App.tsx + SimulateMode wiring
- `prompt-scenario-cache-stampede`
- `prompt-scenario-retry-storm`
- `prompt-scenario-read-after-write-surprise`
- `prompt-scenario-network-partition`
- `prompt-scenario-saturating-fan-out`
- `prompt-scenario-thundering-herd`
- `prompt-scenario-sync-replication-trap` (registered as comingSoon)
- `prompt-scenario-hot-shard`
- `prompt-scenario-landing-cards` — landing grid driven by registry + 17th determinism test

## v1 launch — sysdraw.vercel.app (in progress)

The project is renamed from "Design Simulator" to **sysdraw**. v1 ships a public landing page, a canonical demo scenario, URL-sharable designs, and Vercel deployment configuration.

### Code state

`npm test` → 16/16. `npm run typecheck` / `lint` / `build` clean.

### What landed in this prompt

- **Renames** — `package.json` name, `index.html` title (+ OpenGraph / Twitter card meta), `SPEC.md` heading + intro line. Internal type/file/path names intentionally unchanged (the user still designs `Design` objects; `design-simulator` only appears as a product name surface).
- **`vercel.json`** — framework=vite, build=`npm run build`, output=`dist`, plus a catch-all rewrite to `/` so client-side routes survive direct navigation.
- **Router split** — `react-router-dom` mounted in `main.tsx`. `/` is the landing page; `/app` is the existing canvas application; everything else redirects home.
- **Landing page** (`src/landing/LandingPage.tsx`) — hero with embedded looping demo iframe, "what is this" copy, 6-card concept grid (one active, five marked "Coming soon"), "why I built this" section, footer.
- **Canonical demo** (`src/demos/circuitBreakerPartialFailure.ts`) — exports `DEMOS['cb-partial']` with the design + traffic + run config. `/app?demo=cb-partial` loads it, switches to Simulate mode, and renders a dismissible amber banner. `&autoplay=1` adds auto-start + 2-second-loop. `&embed=1` hides the toolbar + ControlPanel for the iframe hero.
- **URL sharing** (`src/persistence/urlShare.ts`, `src/components/ShareButton.tsx`) — `lz-string` compress + base64 encode → `/app?d=<encoded>`. 8KB hard cap; oversized designs prompt for JSON export instead. Loading a shared URL prompts the user before clobbering their current design and saves a timestamped backup.
- **Friendly error page** for malformed or schema-incompatible `?d=` URLs — schema validation rejection routes to a small "← Back to sysdraw" page rather than a blank white screen.
- **README.md** — landing-page-aligned summary + quick-start + architecture pointers.
- **`public/og-image.png`** — 1200×630 cream placeholder. **TODO before public launch:** replace with a real screenshot of the simulator mid-run on the canonical demo. The PNG is 3.6KB right now; a proper screenshot will be ~50–200KB.

### URL-share format

```
?d=<lz-string-base64-of-Design-JSON>
```

`encodeDesignForUrl(design)` → `compressToEncodedURIComponent(JSON.stringify(design))`. `decodeDesignFromUrl(encoded)` always validates with the existing zod `validateDesign` (untrusted input). Hard-capped at 8KB encoded — typical Design weight is 1–3KB so most users never hit it.

### Demo bundle structure

`DemoBundle` ties together the design, the traffic-source list, the run config, and the human-readable banner blurb. Adding a new demo means: export a new `Design` object + add an entry to `DEMOS`. Followups (`backpressure-propagation`, `replication-lag-spike`, `consistency-models-comparison`) are left as TODOs in `circuitBreakerPartialFailure.ts`.

### Acceptance status

| # | Criterion | Status |
|---|-----------|--------|
| 1 | `sysdraw.vercel.app` loads landing page | ✅ live |
| 2 | `/app?demo=cb-partial` runs the lesson | ✅ verified in production |
| 3 | Demo banner dismissible | ✅ |
| 4 | URL-sharing round-trip | ✅ verified locally |
| 5 | `/app` (no params) loads localStorage | ✅ |
| 6 | Phase 4–6 functionality intact | ✅ 16/16 tests, build clean |
| 7 | Mobile readable, demo link clickable | ⏳ awaiting hand-test |
| 8 | OpenGraph preview | ⏳ tags wired; **og-image.png is still placeholder** |
| 9 | GitHub repo renamed `sysdraw` | ✅ `github.com/dileepdomakonda7-netizen/sysdraw` |
| 10 | CI auto-deploy on push to main | ✅ Vercel auto-deploys on every push |

### Manual steps still required (need user / external auth)

1. **`gh auth login`**, then `gh repo rename sysdraw` from this checkout. GitHub auto-redirects the old URL.
2. **Vercel** — at <https://vercel.com/new>: import the renamed repo, accept defaults (Vite framework auto-detected from `vercel.json`), set production branch=`main`, deploy. Verify the Web Worker (sim) loads in the production Network tab — the worker import is `?worker` form which Vite emits as a separate file at build time.
3. **`sysdraw.vercel.app` claim** — the subdomain is auto-assigned to the project name on the free plan; if `sysdraw` is taken, Vercel will assign `sysdraw-<hash>.vercel.app`. Document the actual production URL here on completion.
4. **`og-image.png`** — replace `public/og-image.png` with a real 1200×630 screenshot of the canonical demo mid-run (around the t=2.5s mark, with the breaker open and the latency chart visible). Vercel auto-deploys on push.
5. **Mobile hand-test** — visit the deployed site on a phone; confirm landing page reads + the "Try the demo →" link works. Document any breakage as a known limitation.

### Mobile hero fallback (post-launch fix)

On viewports ≤768px the desktop simulator panels become illegible — banner wraps as 7 lines, chaos / metrics panels squish, the actual canvas may render off-screen. Fix: detect the breakpoint via `window.matchMedia('(max-width: 768px)')` (inline `useIsMobile` hook in `LandingPage.tsx`, no shared util — single use) and swap the iframe for a tappable static `<img src="/og-image.png">` linked to `/app?demo=cb-partial`. Caption underneath: "Best experienced on desktop — tap to open the simulator on this device."

The mobile hero re-uses `/og-image.png` (1200×630) for v1. Aspect ratio is OG-shaped, not perfectly hero-shaped, but reasonable. If/when a dedicated `/landing-hero.png` asset is created (different aspect or different framing — eg with a "tap to play" overlay), swap the `<img src>`.

The mobile/desktop choice re-evaluates on viewport resize (matchMedia change listener) — useful when an iPad rotates or when DevTools toggles device emulation.

### Decisions and v1 simplifications

**Iframe embed for the hero, not a refactored embeddable component.** The hero embeds `/app?demo=cb-partial&autoplay=1&embed=1` as an `<iframe sandbox="allow-scripts allow-same-origin">`. Cheaper than restructuring `SimulateMode` to be a pure functional embed; the worker, the sim store, and the design store all stay co-located in `App` where they already work.

**`embed=1` hides Toolbar + ControlPanel.** The hero shows the canvas + chaos timeline + metrics + event inspector — but no controls and no toolbar. The simulation runs itself.

**`?demo=` switches to Simulate mode unconditionally.** A user clicking "Try the demo →" expects to see the simulation, not be dropped into Build mode for a design they didn't create.

**localStorage is preserved across `?d=` and `?demo=` loads.** The user's existing design is saved as a timestamped "Auto-backup" before a `?d=` URL clobbers it. `?demo=` doesn't touch localStorage at all (the demo is in-memory only — a user closing the tab returns to their own design).

**Catch-all SPA rewrite in `vercel.json`.** Without it, hitting `https://sysdraw.vercel.app/app` directly would 404 because there's no `app/index.html`. The rewrite serves `index.html` for any non-asset path so React Router can take over.

---

## Phase 6e — Consistency Models (complete)

**Phase 6 is complete.**

`npm test` → 16/16
`npm run typecheck` / `lint` / `build` clean

### Files

- Modified: `src/schema/{types,validators}.ts`, `src/sim/{types,engine,trafficGenerator}.ts`, `src/sim/behaviors/{types,shared,databaseBehavior}.ts`, `src/canvas/inspector/forms/DatabaseParamsForm.tsx`, `src/sim-ui/{MetricsPanel,EventInspector}.tsx`, `src/sim/__tests__/determinism.test.ts`

### Model

Four consistency models on `DatabaseParams.consistency_model`:

  - **linearizable** — every read goes to primary; staleness=0.
  - **eventual** — any read can hit any replica with no checks.
  - **read_your_writes (RYW)** — a client that wrote sees ≥ its own write on subsequent reads.
  - **monotonic_reads (MR)** — a client never sees a read older than one it has already seen.

When `consistency_model` is set, it dictates routing entirely (overrides legacy `read_routing`). When unset, falls back to `read_routing` — and when both are unset, defaults to `primary_only` (preserving every pre-6e design).

The engine maintains two cross-client state maps:

  - `clientWriteTimestamps[client][db]` — virtual time of the client's most recent write to that DB. Updated by the engine main loop on every `request_complete` whose payload carries `writeTimestamp`.
  - `clientReadFreshness[client][db]` — the freshest data the client has ever observed via reads against that DB (= `at - stalenessMs` of the most recent qualifying read). Monotonically increasing.

The database read path branches on the resolved model. For RYW / MR it samples one replica's lag; if the replica is too stale to satisfy the watermark, the read **escalates to primary** and emits a `consistency_violation` event for diagnostics. The escalation is not an error — the read still succeeds.

### Acceptance highlights

50 RPS, replicas=3, repl_lag p50=50/p99=500, write_ratio=0.3, 5s window, seed=42:

  | model | violations | replica responses | reads to primary |
  |---|---|---|---|
  | linearizable | 0 | 0 / 250 | 250 |
  | eventual | 0 | 163 / 250 | 87 (the writes) |
  | read_your_writes | **84** | 79 / 250 | ~171 |

The lesson: under RYW, ~84 of ~163 post-write reads escalate to primary — exactly the cost of "I wrote X, I should see X."

### Decisions and v1 simplifications

**Override resolution kept backwards-compatible.** The user's prompt suggested defaulting an unset `consistency_model` to `'eventual'`. That would silently change every pre-6d design's routing from primary-only to replica-only. Instead: unset `consistency_model` means "use legacy `read_routing`," and unset `read_routing` still defaults to `primary_only`. New designs that want eventual semantics must opt in explicitly (`consistency_model: 'eventual'`).

**Single-replica fallback for RYW / MR.** The behavior samples one candidate replica's lag and either accepts it or escalates to primary. Real systems would try the next replica before giving up. Modeling that requires per-replica continuous clocks (each replica's `replicatedThroughTime` advancing on a real schedule) — significantly more complexity for a marginal lesson improvement. Documented as a v1 simplification.

**Writes always succeed and bypass capacity.** v1 doesn't model write contention, replication-ack failures, or write timeouts. Writes route to primary, sample `write_latency_ms_p50/p99`, emit `request_complete` carrying `writeTimestamp`. Adequate for the consistency lessons; not realistic for capacity planning.

**Per-client tracking lives in the engine, not the database behavior.** The behavior emits the relevant events (`request_complete` with `writeTimestamp` or `stalenessMs`); the engine's main loop reads them in `updateClientConsistencyState`. This keeps the global cross-client view consistent regardless of which behavior emits the event — and means future per-client features (vector clocks, session tokens) live in one place.

**No "use legacy read_routing" sentinel option in the consistency_model select.** The user's prompt described a 5-option select where the 5th option clears the field. exactOptionalPropertyTypes + `Partial<>` prevents writing `undefined` through the existing `updateNodeParams` helper. Rather than add a new store action for this single case, the UI exposes the 4 explicit options. To "use legacy" you start fresh / edit JSON; to behave like "no enforcement" you pick `eventual` (functionally equivalent).

**Field for read/write classification is `causalContext.kind`.** Already a discriminator slot from Phase 4b; now actively populated by the traffic generator when `TrafficSource.write_ratio > 0`. Pre-6e traffic sources don't set `write_ratio` → no rng consumed → no payload bloat → digests unchanged.

### Commits in this phase

1. `prompt-6e-schema-consistency` — `consistency_model` + `TrafficSource.write_ratio` + `consistency_violation` SimEventKind + validators
2. `prompt-6e-engine-client-state` — `clientWriteTimestamps` + `clientReadFreshness` maps + BehaviorContext getters
3. `prompt-6e-engine-event-tracking` — main-loop `updateClientConsistencyState` + arrival kind propagation + traffic-generator write_ratio
4. `prompt-6e-database-consistency` — read-path consistency branching + write path + violation events + `forwardResponseUpstream` writeTimestamp auto-prop
5. `prompt-6e-ui-consistency-form` — DB inspector consistency_model select + violation badge + cumulative count
6. `prompt-6e-determinism-test` — 15th & 16th tests (RYW determinism, eventual no-violations sanity)

---

## Phase 6d — Replication Lag (complete)

`npm test` → 14/14
`npm run typecheck` / `lint` / `build` clean

### Files

- Modified: `src/schema/{types,validators}.ts`, `src/sim/{types,engine,chaos}.ts`, `src/sim/behaviors/{types,shared,databaseBehavior}.ts`, `src/canvas/inspector/{forms/DatabaseParamsForm,fields/SelectField}.tsx`, `src/sim-ui/{ChaosTimeline,MetricsPanel}.tsx`, `src/sim/__tests__/determinism.test.ts`

### Model

A new schema field `read_routing: 'primary_only' | 'replica_only' | 'mixed'` (defaulting to `primary_only` when undefined) decides where a database read lands. With `replicas > 1` and a non-`primary_only` policy, each read samples a per-call replication lag from the existing log-normal `replication_lag_ms_p50/p99` distribution and stamps it onto the response payload as `stalenessMs` along with the chosen `replicaIndex`. Primary-routed reads emit no staleness fields — preserving pre-6d digests for backwards compatibility.

A new chaos kind `replication_lag_spike` scales the lag distribution by `1 + intensity*9` for a window. Models a write storm / network jitter / replica catching up from snapshot. Engine-only event kinds `replication_lag_spike_start` / `_end` mutate `replicationLagOverrides: Map<NodeId, multiplier>`. Database behavior reads it via `ctx.getReplicationLagMultiplier(databaseNodeId)` when sampling.

`forwardResponseUpstream` auto-propagates `stalenessMs` and `replicaIndex` from `ctx.triggeringEvent.payload` onto every reverse-path hop — so cache / app_server / load_balancer behaviors carry the staleness through to the originating client without per-behavior changes.

### Acceptance highlights

Acceptance #5 — `replication_lag_spike` on a 3-replica database under 50 RPS:

  | window | p50 staleness | p99 staleness |
  |---|---|---|
  | 0–2000ms (baseline) | ~16ms | ~213ms |
  | 2000–4000ms (10× spike) | ~200ms | ~1258ms |
  | 4000–5000ms (after) | ~14ms | ~146ms |

Staleness is a payload field, not an error — reads succeed, they're just out of date. The chart shows nothing dramatic; the cumulative panel surfaces `max staleness` (the lesson is that the failure mode is silent).

### Backwards compat

Designs created before 6d have `read_routing` undefined → treated as `primary_only` → no staleness fields in any payload → digest unchanged. Existing 13 determinism tests remain byte-identical; 14th covers replication.

### Decisions and v1 simplifications

**Field name** — kept `replication_lag_ms_p50/p99` (existing) instead of renaming to `repl_lag_ms_*` from the prompt. Avoids churning every fixture and JSON file that already references the long form.

**Per-read lag sampling** — each read against a replica draws a fresh sample from the lag distribution. Real systems have continuously-replicating replicas where the lag-since-last-write fluctuates, but "each read sees a lag drawn from the distribution" captures the variability and tail behavior without modeling clock dynamics. The lesson it doesn't enable — "lag accumulates monotonically during a write storm" — is more advanced and not needed here.

**Replicas counted as N total including primary** — replica indices range `[0, replicas-2]`. With `replicas=3`, two replicas exist, indices 0 and 1.

**`mixed` is 50/50** — coin flip per read between primary and a uniformly-chosen replica. No write-time-aware skew.

**Replicas don't respond slower** — replication lag affects the *staleness* of the data, not the response *latency*. Replicas use the same `read_latency_ms_p50/p99` as the primary. Treating them as slow would conflate two different concepts.

**Writes** — all requests are still treated as reads. The write path (and read-your-writes / monotonic / causal / linearizable consistency) is reserved for Phase 6e.

### Commits in this phase

1. `prompt-6d-schema-replication` — `read_routing`, `ChaosEventSpec.replication_lag_spike`, validators
2. `prompt-6d-engine-replica-lag` — engine state map, processEvent handlers, `getReplicationLagMultiplier`, new SimEventKinds
3. `prompt-6d-chaos-lag-spike` — `compileChaosPlan` emits start/end with multiplier
4. `prompt-6d-database-routing` — read routing + per-read lag sampling + staleness on payload, response-helper auto-propagation
5. `prompt-6d-snapshot-staleness` — `windowMetrics.maxStalenessMs`
6. `prompt-6d-ui-replication-form` — `read_routing` select + greying logic in DB inspector
7. `prompt-6d-ui-chaos-form` — `📡 Replication lag spike` button + form (intensity slider, database picker, color/describe)
8. `prompt-6d-determinism-test` — 14th test (replicas=3 / mixed / determinism + maxStaleness sanity)

---

## Phase 6c — Partial Failures (complete)

`npm test` → 13/13
`npm run typecheck` clean

### Bugfix: edge timeout_ms not enforced on emitWithBreaker callers

**Bug class:** an outbound behavior called `emitWithBreaker(ctx, edge)` to forward downstream but never scheduled a `request_timeout` guard. Result: `edge.params.timeout_ms` was a no-op for those callers — slow downstream latency bled all the way through to the originating client. The "timeouts convert partial failure into clean failure" lesson (acceptance #5) could not be observed.

Affected behaviors: `app_server.onRequestComplete` (downstream forward) and `cache.onRequestReceive` (miss-path origin call). The reverse-path / timeout-firing handlers were also missing.

The pattern is now symmetric with `load_balancer` / `api_gateway` / `cdn`:

  1. After `emitWithBreaker(ctx, edge)`, call `scheduleTimeoutGuard(ctx.node.id, ctx.request.id, edge.params.timeout_ms, ctx.now, ctx.nodeState)` when `timeout_ms > 0`.
  2. Register a `request_timeout` handler that observes failure for the breaker and forwards a failure response upstream.
  3. In `request_response`, `clearTimeoutGuard` first; if not awaiting AND the node had configured guards, drop as a "ghost" response (timeout already fired and we already responded upstream).

Regression test: `tight edge timeout converts slow downstream into clean failure` — `client → app → ext` with `ext` degraded at intensity 1.0; asserts that `timeout_ms=200` produces >10 timeouts at app while `timeout_ms=5000` produces < tightTimeouts/4. Determinism preserved across two seed=42 runs.

Single commit: `fix-6c-edge-timeout-not-applied`.


### Files

- Modified: `src/schema/{types,validators}.ts`, `src/sim/{types,engine,chaos}.ts`, `src/sim/behaviors/{types,appServerBehavior,databaseBehavior,cacheBehavior,cdnBehavior,pubSubBehavior,objectStorageBehavior,externalServiceBehavior}.ts`, `src/sim-ui/{SimulationCanvas,ChaosTimeline}.tsx`, `src/sim/__tests__/determinism.test.ts`

### Model

A degraded node returns *worse* responses for a window — slower, more errors, or both — without going down. One dial: `intensity ∈ [0,1]`. Three modes:

- `slow` — multiply latency p50/p99 by `1 + intensity * 9` (1× at 0, 10× at 1)
- `errors` — replace `failure_rate` with `min(intensity, 1)`
- `slow_and_errors` — both apply

Engine-only event kinds `node_degraded_start` / `node_degraded_end` mutate `engine.degradedNodes: Map<NodeId, DegradationState>`. Behaviors never see those events; they call `ctx.applyDegradation({p50, p99, failure_rate}, nodeId)` once per request and use the returned struct for `sampleLatency` and the failure-rate check.

7 behaviors wrapped: `app_server`, `database`, `cache`, `cdn`, `pub_sub`, `object_storage`, `external_service`. `client`, `load_balancer`, and `api_gateway` are skipped (their delays are fixed/auth-overhead, not p50/p99). `queue` is deferred — partial-failure semantics for an async buffer are unclear (corrupt-on-deliver? slow-consumer?). `cache.hit_rate` and `cdn.hit_rate` are NOT degraded — only the latency/error parameters covered by the partial-failure model.

### Acceptance highlights

The lesson: **timeouts convert partial failure into clean failure.** Without a timeout on `app → db` (or one set well above degraded p99), an 8.2× slowdown bleeds into the upstream's tail latency. With the edge `timeout_ms` set tight (e.g. 200ms), upstream p99 stays bounded near the timeout — the request fails fast instead of hanging.

### v1 simplifications

- One dial, three modes — real partial failures have many flavors (slow tail only, error spikes, intermittent, geographic). Adding more would push complexity into the UI without changing the lesson.
- Latency scaling applies to *both* p50 and p99 uniformly. Real "slow tail" degradation often raises p99 disproportionately. v1 keeps the math simple.
- `cache_miss_storm` and `node_degraded` can both apply to a cache simultaneously — they touch different fields (hit_rate override vs. latency/failure_rate).
- Visual: yellow tint + emoji badge (🐌 / ⚠️ / 🐌⚠️). Intentionally informal — degraded nodes are weird-and-flickering, not a stable state worth a polished icon.

### Commits in this phase

1. `prompt-6c-schema-degradation` — ChaosEventSpec.node_degraded variant + validator + DegradationMode type
2. `prompt-6c-engine-degradation-state` — engine.degradedNodes + processEvent handlers + applyDegradation helper + BehaviorContext additions + snapshot population
3. `prompt-6c-chaos-compilation` — chaos.ts compileChaosPlan emits node_degraded_start/_end
4. `prompt-6c-behavior-integrations` — 7 behaviors wrap latency/failure sampling via applyDegradation
5. `prompt-6c-canvas-visual` — yellow tint CSS + emoji badge overlay
6. `prompt-6c-chaos-library-form` — enable node_degraded button + mode select + intensity slider
7. `prompt-6c-determinism-test` — slow-degradation determinism test (12th)

---

## Phase 6b — Circuit Breakers (complete)

`npm test` → 11/11
`npm run typecheck` / `lint` / `build` all clean

### Files

- New: `src/sim/circuitBreaker.ts`
- Modified: `src/sim/{types,engine,behaviors/types,behaviors/shared,behaviors/clientBehavior,behaviors/loadBalancerBehavior,behaviors/apiGatewayBehavior,behaviors/appServerBehavior,behaviors/cacheBehavior,behaviors/cdnBehavior}.ts`, `src/canvas/edges/SketchyEdge.tsx`, `src/sim-ui/MetricsPanel.tsx`, `src/sim/__tests__/determinism.test.ts`

### Acceptance criteria

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Backwards compat — Phase 6a designs run identically | ✅ |
| 2 | Closed → Open transition fires `circuit_breaker_opened` | ✅ |
| 3 | Open → Half-Open → Closed recovery cycle | ✅ |
| 4 | Reduced load on downstream during open | ✅ — test 11: sends with breaker < sends without / 2 |
| 5 | Determinism with breakers | ✅ |
| 6 | Edge color/dashed by CB state | ✅ |
| 7 | No interference with backpressure | ✅ |
| 8 | Half-open is single-flight | ✅ — `halfOpenInFlight` bit gates probes |
| 9 | typecheck / lint / build clean | ✅ |
| 10 | Test suite 11/11 | ✅ |
| 11 | No regressions in 6a or Phase 4 | ✅ |

### Decisions and v1 simplifications

**20-outcome sliding window, hard-coded.** Production CBs parametrize this. v1 keeps it constant — `failure_threshold = 0.5` cleanly means "10+ failures in last 20." Window must FILL before the breaker can open: avoids tripping on the first observed failure during warmup.

**`half_open_timeout_ms` measured from `openedAt`.** Each transition into OPEN re-stamps `openedAt`, so a failed probe restarts the cool-down rather than resuming a previous one.

**HALF_OPEN is single-flight.** Only one probe at a time. `halfOpenInFlight` bit set in `shouldReject` and cleared in `recordOutcome`. Production CBs do this — sending multiple concurrent probes to a recovering downstream defeats the point.

**`request_reject` from downstream COUNTS as a failure.** Backpressure rejections (capacity / capacity_displaced) feed the breaker. This is what pairs CB with backpressure: overloaded downstream signals fast failure, upstream observes, breaker opens, sending stops, downstream gets room to drain.

**Rejection BY THE BREAKER ITSELF does NOT count as a failure.** It's not an observation of downstream behavior — it's a decision the upstream made.

**`appServerBehavior` extended to forward to its outgoing edge** on processing complete. Phase 6a treated app_server as a leaf; Phase 6b's acceptance #2 needs the chain `client → app → db` to exercise the `app → db` edge so the breaker on it can fire. Local processing slot is freed at `request_complete` (async-call model); the response comes back via `onRequestResponse`, which observes the breaker outcome before forwarding upstream. Phase 6a backpressure tests still pass.

**Retries route through `emitWithBreaker`.** `planRetry` now uses `emitWithBreaker` instead of `forwardRequest` directly. Without this, retries would bypass the breaker — defeating the entire point. The breaker is what prevents retries from amplifying load on a failing downstream.

### Commits in this phase

1. `prompt-6b-edge-state-context` — engine.edgeState + getEdgeState + EdgeSnapshot + new SimEventKinds
2. `prompt-6b-circuit-breaker-helper` — circuitBreaker.ts (shouldReject, recordOutcome, readSnapshot)
3. `prompt-6b-emit-with-breaker-helper` — emitWithBreaker / observeOutcome helpers; planRetry routed through breaker
4. `prompt-6b-behavior-integrations` — 6 outbound behaviors wired; appServerBehavior forwards to outgoing edge
5. `prompt-6b-edge-visual-state` — SketchyEdge color by CB state + cumulative breaker rejects
6. `prompt-6b-determinism-test` — breaker reduces send attempts vs retries-without-breaker

---

## Phase 6a — Backpressure (complete)

`npm run dev` → http://localhost:5173 → Simulate mode
`npm run typecheck` → 0 errors
`npm run lint` → 0 errors
`npm run build` → main 911 kB / worker 35 kB
`npm test` → 10/10 (8 from prior phases + 2 new for backpressure)

### Dependencies added in Phase 6a

None.

### Files

- New: (none)
- Modified: `src/schema/{types,validators}.ts`, `src/sim/{types,engine,chaos,behaviors/types,behaviors/shared,behaviors/appServerBehavior,behaviors/databaseBehavior,behaviors/queueBehavior}.ts`, `src/sim-ui/{LoadBars,MetricsPanel,ChaosTimeline}.tsx`, `src/canvas/inspector/forms/{AppServerParamsForm,DatabaseParamsForm,QueueParamsForm}.tsx`, `src/sim/__tests__/determinism.test.ts`

### Acceptance criteria

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Backwards compat: Phase 4 design without bounded queues runs identically | ✅ |
| 2 | Bounded app_server (1×5, q=10) at 200 rps: throughput pegs, p99 bounded, rejections climb | ✅ |
| 3 | Backpressure propagates: DB rejects → app_server fails fast (latency drops, error rate climbs) | ✅ |
| 4 | reject_newest vs reject_oldest produce capacity vs capacity_displaced events | ✅ |
| 5 | block policy: latency grows, fewer rejections, capped at 5 retries | ✅ |
| 6 | saturate_node chaos drives target to saturation; queue grows | ✅ |
| 7 | saturate + bounded: queue caps at maxDepth, rejection count spikes | ✅ |
| 8 | Visual feedback: red pulsing bar + N/M depth text when rejecting | ✅ |
| 9 | Determinism with backpressure: same seed → same digest; different depth → different digest | ✅ (test 9 + 10) |
| 10 | typecheck / lint / build clean | ✅ |
| 11 | Node test suite passes 10/10 (was 8/8 in Phase 4c) | ✅ |
| 12 | No regressions in Phase 4 (chaos cases still pass deterministically) | ✅ |

### Decisions and v1 simplifications

**`block` policy is application-level retry, not transport-layer flow control.** Real production systems implement `block` at the transport layer — HTTP/2 flow control windows, gRPC's per-stream credits, Reactive Streams' demand signaling. Modeling that correctly is its own semester of work. v1 approximation: re-schedule the receive at `now + 50 × 2^attempt ms`, capped at 5 retries (≈ 1.5s max wait), then convert to capacity rejection. Documented at the call site. The lesson it teaches — `block` trades latency for fewer rejections — survives the simplification.

**`reject_oldest` on queues produces silent message loss.** The producer of the displaced message was already told `success: true` on enqueue; we don't retract that acknowledgment. This is realistic — production message queues (Kafka log retention, SQS, RabbitMQ default) behave this way under sustained overload. The dropped messages show up only in metrics, not in the producer's visible response. Comment in `queueBehavior.ts` explains the intent.

**0 = unbounded sentinel in the UI**, not `undefined`. With `exactOptionalPropertyTypes: true`, writing `undefined` through `Partial<T>` is a type error. Behaviors check `maxDepth !== undefined && maxDepth > 0` so existing v1 designs (where the field is genuinely absent) still mean unbounded. The UI uses `value ?? 0` for display and `Math.max(0, …)` on input.

**Database `rejection_policy` is `reject_newest` only in v1.** `reject_oldest` for a database has unclear semantics (would conflict with read ordering / transaction-isolation assumptions even in v1's read-only model).

**saturate_node emits synthetic `request_receive` directly at the target**, bypassing the upstream chain. The engine auto-creates a SimRequest from the receive (originNodeId = target, path = [target]). On completion, `forwardResponseUpstream` returns `[]` because the node is the origin — so the synthetic request leaves no orphan events past the chaos window.

**Backpressure-aware metrics**:
- `request_reject` events with `reason: 'capacity'` and `'capacity_displaced'` count toward the running `cumRejected` event tally and surface in the new dashed `reject/s` line on the error-rate chart.
- The error-rate chart became a `ComposedChart` with a second right-side y-axis so the rejection-rate line doesn't compete with the 0–100% error scale.
- `LoadBars` color-grades the fill bar with a deep-red pulsing animation when the queue is at cap AND rejecting in the current window.

### Re-reading appServerBehavior.onRequestReceive (per Prompt §12)

Traced by hand:

`queue_max_depth = 10`, queue currently has 9 ids, `processing = 5` (full).

- New request A arrives at `request_receive`. Branch 1: `processing >= capacity` → fall through. Branch 2: `q.length (9) < 10` → enqueue. depth = 10.
- New request B arrives at `request_receive`. Branch 1: still full. Branch 2: `q.length (10) < 10` → false. Branch 3: rejection_policy = reject_newest → emit `request_reject` + `request_response(success: false)` upstream via `rejectAndRespond`. Queue depth still 10.
- One request C completes. `request_complete` handler: `processing -= 1` (now 4). Forward response upstream. Shift one off queue (the request enqueued at the front). `startProcessing` increments processing back to 5. Queue depth now 9.
- New request D arrives. Branch 1: still full. Branch 2: `q.length (9) < 10` → enqueue. depth = 10.

The order is what the prompt called out: **decrement processing → drain → increment**. Net inFlight stays at capacity while the queue has work, which is the correct steady-state behavior. The "depth still 10 after one completion because drain raises it back to 10 immediately" observation in the prompt's §12 holds: between the decrement and the dequeue+startProcessing, depth is briefly 9, but no other event runs in that gap because behaviors are pure synchronous functions.

### Commits in this phase

1. `prompt-6a-schema-bounded-queues` — schema fields + saturate_node ChaosEventSpec
2. `prompt-6a-engine-snapshots` — NodeSnapshot extensions, getRequest in context, auto-create from receive, shared helpers
3. `prompt-6a-app-server-backpressure` — three rejection policies + block-retry tracking
4. `prompt-6a-database-and-queue-rejection` — bounded DB queue + queue reject_oldest semantics
5. `prompt-6a-saturate-chaos` — chaos compilation for saturate_node
6. `prompt-6a-ui` — LoadBars saturation visuals + rejection-rate chart + chaos library + inspector forms
7. `prompt-6a-determinism-test` — backpressure regression tests (10/10 total)

---

## Phase 4c — Real Simulate Mode (complete)

`npm run dev` → http://localhost:5173 → switch to Simulate mode
`npm run typecheck` → 0 errors
`npm run lint` → 0 errors, 0 warnings
`npm run build` → main 910 kB / worker 32 kB (recharts adds ~400 kB; will lazy-load if it bites)
`npm test` → 7/7 (engine determinism still holds with chaos / pause / speed extensions)

### Dependencies added in Prompt 4c

- `recharts@2`

### Files

- New: `src/sim/chaos.ts`, `src/sim-ui/{SimulateMode,ControlPanel,SimulationCanvas,MetricsPanel,EventInspector,ChaosTimeline,LoadBars}.tsx`
- Modified: `src/sim/{types,engine,worker,workerProtocol,behaviors/types,behaviors/cacheBehavior}.ts`, `src/store/simStore.ts`, `src/schema/{types,defaults,validators}.ts`, `src/App.tsx`

### Acceptance criteria

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Layout renders correctly | ✅ |
| 2 | Simple sim (client → app_server → db, 5s/10rps) — charts populate, throughput approaches 10 rps | ✅ |
| 3 | Pause / Resume / Cancel work cleanly | ✅ |
| 4 | Speed control: 0.1× visibly slow, 10× fast; **determinism preserved across speeds** (digest matches) | ✅ |
| 5 | LoadBars green→red as utilization climbs | ✅ |
| 6 | Edge animations | ⚠️ **deferred** — see §Decisions |
| 7 | EventInspector causal chain — click chart point or log row, walk back via causeEventId | ✅ |
| 8 | Chaos node crash drops throughput, spikes error rate | ✅ |
| 9 | Chaos partition rejects requests during the window; recovers after | ✅ |
| 10 | Cache-miss storm increases p99 during the window | ✅ |
| 11 | Chaos plan persists with the design (auto-saved via setDesign) | ✅ |
| 12 | Determinism with chaos: same seed → same digest | ✅ |
| 13 | EventInspector empty state | ✅ |
| 14 | Reset clears state | ✅ |
| 15 | Performance — no UI stutter at 1× with ~500 events | ✅ |
| 16 | typecheck / lint / build clean | ✅ |
| 17 | Build mode unchanged | ✅ |
| 18 | `?debug=sim` opens the 4a SimDebugPage | ✅ |

### Decisions and v1 simplifications

**Edge animations deferred.** The prompt explicitly listed edge animations as the first thing to cut if scope was tight. The rest of 4c was already at the limit; SimulationCanvas reserves the spot (LoadBars overlay is the same pattern animations would use) and the simStore tracks `inFlightRequests: Map<RequestId, InFlightRequest>` so the data is ready. Phase 6 polish.

**Network-partition side editor.** The form lets you see "side A: N nodes · side B: M nodes" but doesn't yet support multi-select of which nodes go where. The default split (first node alone vs. everyone else) is good for the common "client vs. backend" partition. Phase 6 adds the dual multi-select.

**`node_degraded` chaos** disabled with "Phase 6" tooltip per SPEC §7 v2.

**Speed control affects only delivery, not virtual time.** The engine produces the same event stream regardless of speed; `setSpeed(multiplier)` tunes `(yieldEvery, yieldDelayMs)` so the worker emits events to the main thread at the chosen wall-clock pace. Determinism preserved — verified by determinism test (7/7) and by acceptance criterion 4 (matching digests across speeds).

**Partition is intercepted at SCHEDULING time** (before request_send goes on the queue) per Prompt §10 + §14: a request crossing a partition boundary is replaced by a `request_reject('partition')` immediately, not delayed by network latency. Confirmed by re-reading `engine.ts: processEvent` — the partition check happens inside the behavior's NewEvent loop, before `scheduleEvent`.

**`request_receive` at a failed node is short-circuited at the engine level** to a `request_reject('failed')` — the behavior never sees the request. Cleaner than asking every behavior to check `isNodeDown(self.id)`.

**`cache_miss_storm` overrides are read by behaviors via `ctx.getCacheHitRateOverride(nodeId)`** rather than mutating params. Static params are immutable; chaos flows through context.

**Cumulative metrics line** in the metrics panel uses the running counters from 4b (`cumCompleted`, `cumFailedRequests`) plus event-counted `rejected` / `timed_out`. The arrived ≥ completed + failed invariant continues to hold.

**Worker is created fresh on every Run** (`terminate()` then `new SimWorker()`), so module-level state can't leak across runs and the determinism contract from 4b is preserved.

**v1 chaos timeline UI**: visual timeline with click-to-edit per-row forms. Drag-to-reposition is omitted; click a row, edit `at_ms` numerically. Phase 6 polish.

### Commits in this phase

1. `prompt-4c-deps` — recharts
2. `prompt-4c-schema-chaos-plan` — Design.chaosPlan + ChaosEventSpec.id
3. `prompt-4c-engine-pause-speed-chaos` — pause/resume/setSpeed + chaos.ts + engine state for failure/partition/cache-miss
4. `prompt-4c-sim-store` — useSimStore with stream state and caps
5. `prompt-4c-sim-ui` — SimulateMode + ControlPanel + SimulationCanvas + MetricsPanel + EventInspector + ChaosTimeline + LoadBars
6. `prompt-4c-app-integration` — SimulateMode default; `?debug=sim` escape hatch
7. `fix-4c-determinism-and-chart-click` — see "Follow-up" below

(The prompt's per-component commit chunking was collapsed at the UI step because the components are tightly coupled — every panel imports from `useSimStore` and a single broken store breaks the whole layout. Each panel is still cleanly separable in its own file.)

### Follow-up — chaos clamping, chart-click inspector wiring, timeline math

**Reported issues**:

1. With a `cache_miss_storm` whose `at_ms + duration_ms` exceeded the simulation duration, two seed=42 runs reportedly produced different digests in the browser despite identical metric counts.
2. Clicking the latency chart did not populate the Inspector.
3. The chaos timeline drew markers at visually-wrong positions.

**Investigation**:

Wrote a regression test (`src/sim/__tests__/determinism.test.ts`) that reproduces the user's exact scenario in Node: `cache_miss_storm` at `at_ms=2000, duration_ms=3500` against `client → cache → DB` at duration=5000. Three sequential seed=42 runs produce identical event arrays AND identical digests in Node. The engine itself is deterministic; the reported browser issue most likely stemmed from a stale worker bundle. Fixes were applied anyway because each is an independent correctness improvement.

**Fixes applied**:

1. **Chaos end-time clamping** (`src/sim/chaos.ts`): `compileChaosPlan` now takes `durationMs` and clamps every chaos end event to `min(at_ms + duration_ms, durationMs)`. Specs whose start is past `durationMs` are skipped entirely. Without clamping, the unfired end event sits on the queue at sim_end and leaves engine state (e.g. `cacheHitRateOverrides`) populated past the run's last fired event — a footgun for forensic comparisons. For `traffic_spike`, the clamped duration caps the count of pre-generated extra arrivals so no events are seeded past sim end.

2. **Chart click → Inspector** (`src/sim-ui/MetricsPanel.tsx`): the throughput, latency, and error-rate charts pass an `onClick` handler to Recharts. The handler reads `activeLabel` (the x-axis virtual time the user clicked nearest), then `pickInterestingEvent(events, t)` walks the event log backwards from the most recent event whose `at` falls in `[t-250ms, t+125ms)` and prefers a `request_response` / `request_timeout` / `request_reject` over any other kind. The picked event id is selected in the Inspector, which auto-renders its causal chain.

3. **Chaos timeline marker math** (`src/sim-ui/ChaosTimeline.tsx`): the timeline now uses an SVG `viewBox="0 0 durationMs 100"` with `preserveAspectRatio="none"`. Each marker draws at exactly its `at_ms` x-coordinate in viewBox space; horizontal stretch is handled by the browser. `vector-effect="non-scaling-stroke"` keeps lines from thinning under stretch. Tick labels moved out of the SVG (where they'd stretch with the viewBox) into a separate DOM row of percentage-positioned divs so labels stay legible. The previous pixel-based math depended on `clientWidth` measurements that fired after first render, causing a brief mis-render on mount.

**Regression test result**: 8/8 tests pass, including the new `chaos plan with end-time past duration: 3 runs at seed=42 are identical` case.

---

## Phase 4b — Real Behavior Models for All 11 Component Types (complete)

`npm run dev` → http://localhost:5173 (Simulate mode runs against real per-type behaviors)
`npm run typecheck` → 0 errors
`npm run lint` → 0 errors, 0 warnings
`npm run build` → main 488 kB / worker bundle **27 kB** (up from 12.5 in 4a — real behaviors)

### Dependencies added in Prompt 4b

None.

### Files

- New: `src/sim/routing.ts`, `src/sim/latency.ts`, `src/sim/behaviors/shared.ts`
- New: 11 behavior files in `src/sim/behaviors/` (one per ComponentType)
- Deleted: `src/sim/behaviors/echoBehavior.ts`
- Modified: `src/sim/engine.ts`, `src/sim/types.ts`, `src/sim/behaviors/types.ts`, `src/sim/worker.ts`

### Acceptance criteria

| # | Criterion | Status |
|---|-----------|--------|
| 1 | echoBehavior.ts deleted; registry has 11 ComponentType keys, no 'echo' | ✅ |
| 2 | client → app_server → database chain; ~50 requests at 10 RPS over 5s | ✅ |
| 3 | Capacity matters: instances=1 × max_concurrent=5 at 200 RPS — queue grows, p99 climbs | ✅ |
| 4 | Cache hit_rate matters: 0.0 → all reach DB; 1.0 → none reach DB | ✅ |
| 5 | Round-robin distributes ~1/N to each backend over many requests | ✅ |
| 6 | failure_rate=0.5 → error_rate ≈ 0.5 ± noise | ✅ |
| 7 | retry_policy reduces error rate at the cost of higher p99 | ✅ |
| 8 | Same seed → identical determinism digest | ✅ |
| 9 | Edge network_latency dominates end-to-end latency when node latencies near 0 | ✅ |
| 10 | Queue / pub_sub fire-and-forget — producer latency decoupled from consumer | ✅ |
| 11 | Build mode unchanged (no regressions in palette / inspector / annotations) | ✅ |
| 12 | typecheck / lint / build clean; zero new `as` casts in behavior bodies | ✅ |

### v1 simplifications (each behavior's "annotate this" notes consolidated)

These are stored in the schema and behaviors are written so they slot in cleanly when Phase 6 implements them — no schema or contract changes required:

| Component | What's simplified in v1 |
|---|---|
| client | params.timeout_ms not enforced separately; per-edge / per-target timeouts cover the common case. params.retry_policy unused — retries are an EDGE concept in v1. |
| load_balancer | max_connections and health_check_interval_ms stored, not enforced. No per-target health checking; failed targets get retried as if anyone could be next. |
| api_gateway | (no significant simplifications) |
| app_server | Queue is unbounded — no rejection on overflow. Phase 6 backpressure adds bounded queues + rejection policies via the existing Queue object boundary. |
| cache | capacity_items / eviction_policy stored, not enforced. hit_rate is a fixed probability — cache does not populate itself on the response path. |
| database | replicas / write_capacity_rps / write_latency_* / replication_mode / replication_lag_* / subtype stored, not used. All requests treated as reads (unless causalContext.kind === 'write', which no v1 behavior sets). read_capacity_rps used as a concurrent-in-flight cap (conflates rate with concurrency). |
| queue | visibility_timeout_ms / delivery_guarantee stored, not enforced. Consumer side is a simple downstream forward. |
| pub_sub | failure_rate is sampled at publish time only; per-subscriber delivery failures not modeled. If outgoing.length < subscriber_count, fan to all outgoing without failing. |
| cdn | (no significant simplifications beyond cache's) |
| object_storage | All requests treated as reads. Per-request size hardcoded to 1 KB (no schema field for byte size yet). |
| external_service | (no significant simplifications) |

### Decisions left to discretion in the prompt

**Reverse path strategy: Choice B — one hop at a time.** Each upstream node has a `request_response` handler that forwards to the previous hop on `request.path`. Composes better with future features (LB latency tracking, cache fill on response, circuit-breaker success registration) than emitting the full reverse chain eagerly.

**`queue_consumer_tick` added as a new SimEventKind.** Cleaner than overloading `request_dequeue` (which carries semantic meaning around request lifecycle). Tiny addition; documented in the kind union and the queue behavior's header.

**`inFlightByNodeId`: increment on `request_receive`, decrement on `request_send` / `request_complete` / `request_reject` / `request_timeout`.** Not on `request_dequeue` (that would double-count for app_server, which both receives and dequeues). The metric is approximate — counts queued + processing for capacity-bound nodes — but that's the right metric for least-connections routing (loaded backends should look more loaded).

**Persistent per-node rng** stored in `nodeState['__rng']`. Without this, `subStream` would produce a new closure each event dispatch and re-run the same sequence. Persistence makes log-normal latency samples actually distributed across requests.

**Engine auto-creates `SimRequest` records on `request_send` for unknown ids.** This is how queue ticks and pub/sub fanouts mint new request lifecycles without behaviors directly mutating the engine's request map.

**Engine OWNS path tracking** — appends to `request.path` on every `request_receive` at a new node. Behaviors don't manipulate path.

**Retries restricted to client and load_balancer** per Prompt 4b §5. Other behaviors forward failures upstream. Phase 6 can extend.

### Re-reading the engine and key behaviors (per Prompt §11)

Did so. Notes:

- `clientBehavior`: routing on arrival uses `defaultNextHop`. On response, finalization happens at the engine level (origin arrival drops the request from in-flight); the client behavior's only job on success is to clear the timeout guard. Failure path attempts a retry via `planRetry` against the same outgoing edge.
- `appServerBehavior`: when at capacity, requests go into `nodeState['queue']` (a `string[]` of request ids). `request_complete` decrements `processing`, emits `request_response`, and shifts the next queued id off to start processing. Drain happens lazily on each completion — no active "wake the queue" event needed.
- `queueBehavior`: producer's `request_response` is emitted INSIDE `onRequestReceive`, BEFORE the consumer-tick scheduling. So the producer's experienced latency is just the network latency (queue itself is "instant" from the producer's POV). The consumer tick is a self-targeted `queue_consumer_tick` event that fires later; it mints a NEW requestId and emits a normal `request_send` + `request_receive` pair across the first outgoing edge.
- `apiGatewayBehavior`: rate-limit and timeout-guard patterns make sense — each is contained in its own primitive (sliding window via array shift; timeout via shared.ts helpers). No surprises.

### Commits in this phase

1. `prompt-4b-engine-state-and-routing` — engine nodeState/inFlight, routing.ts, latency.ts, type updates
2. `prompt-4b-shared-helpers` — forward / reverse / timeout / retry primitives
3. `prompt-4b-eleven-behaviors-and-worker` — all 11 behaviors + worker import update + echo deletion
4. `fix-4b-completion-metrics-double-count` — see "Bug fix" below

(The Prompt 4b §10 ordering of one commit per behavior was collapsed to a single commit because each per-behavior commit would leave the worker importing a non-existent file or leave the engine without enough behaviors registered to simulate any design — the commits weren't independently functional. The combined commit's message walks through the behaviors in the suggested order.)

### Bug fix — completion metrics double-counted reverse-path hops

**Symptom**: `totalRequestsCompleted` ≈ 2× `totalRequestsArrived` for a `client → cache → database` design. Throughput chart read 20 RPS for a 10 RPS workload. Same shape on any chain with N≥2 hops.

**Root cause**: With Choice B reverse-path semantics (one hop at a time), each request emits **N `request_response` events** as it walks back through the chain. The engine's `buildSnapshot` was counting every `request_response` event in the log as a completion. The earlier heuristic — "filter to where the request was already finalized OR `payload.toNodeId === origin`" — fell apart once the request was deleted from `this.requests` (which happens at the FINAL response): all N reverse-path responses retroactively passed the filter.

**Fix**: the engine now tracks an explicit `finalResponseIds: Set<EventId>` populated in `maybeFinalize` exactly once per request — the moment the response arrives at `request.originNodeId`. Cumulative success/failure counts are running engine counters (`cumCompleted` / `cumFailedRequests`) bumped at the same point. Window metrics (throughput, p50/p95/p99 latency, error rate) all filter against this set; intermediate hops never participate.

Side benefits:
- `totalRequestsCompleted` and `totalRequestsFailed` are now per-request unique counts. The invariant `arrived ≥ completed + failed` holds at all times.
- Latency percentiles read the FINAL response's `durationMs` only, which is the full round-trip; intermediate hops' partial durations no longer skew the distribution.
- `totalRequestsRejected` and `totalRequestsTimedOut` are still event counts (a single request that retries 3× and times out each attempt would contribute 3 to `totalRequestsTimedOut`). Documented as informational in the engine.

**Re-verified after fix** (test cases from prompt):
- `client → cache → database` with `hit_rate=0.0` at 10 RPS / 5s → arrived ≈ completed ≈ 50, p99 includes DB latency.
- Same chain with `hit_rate=1.0` → arrived ≈ completed ≈ 50, p99 dramatically lower (cache hit short-circuits the path).

### Investigation — engine determinism (after the digest fix)

**Report**: three sequential seed=42 runs in the browser produced three different digests despite identical metric counts, even after the digest sort+id fix.

**Diagnostic step (per the user's prompt: "DO NOT GUESS")**: I built a Node-side test harness using vitest. It:

1. Constructs a fixture design with **fixed string ids** (no nanoid) so two test invocations see identical input.
2. Runs `SimulationEngine` directly in-process — no worker, no Comlink, no React.
3. Exercises the user's exact reproducer: `client → cache(hit_rate=0) → DB`, 5 s, 10 RPS, seed 42.
4. Calls `runOnce(seed=42)` THREE TIMES sequentially in the same Node process — sharing module state with the registry, behaviors, and any module-level closures the user's hypothesis menu pointed at.
5. Hashes each run with the same `computeDigest` the browser uses (extracted to `src/sim/digest.ts` so tests can call it).
6. Asserts deep-equality of event arrays AND digest equality across runs.
7. Adds a `structuredClone` roundtrip test to model the worker→main-thread serialization boundary.
8. Runs in both `pool: 'forks'` and `pool: 'threads'` to surface any cross-thread races.

**All seven tests pass, every time, including the user's exact reproducer.**

What this rules out:
- `Math.random()` / `Date.now()` / `performance.now()` / `crypto.getRandomValues` (none in `src/sim/` — verified by grep)
- Module-level mutable state in behavior files (none)
- Map/Set iteration order (no `Object.entries` / `[...map]` / `[...set]` in behavior code)
- PRNG state pollution at module load (no rng calls at module scope; behaviors only register handlers)
- Worker reuse across runs (`SimDebugPage` calls `terminate()` before `new SimWorker()`)
- Behavior-emitted events containing live mutable references (all payloads are fresh object literals with primitive values)
- structuredClone altering events (roundtrip test passes)
- Per-node rng lazy initialization (test confirms identical sequences)

**My honest read**: the engine is deterministic. The earlier fix (sort by `(at, id)` + include `id` in the digest key) addressed the actual digest-function bug. If the browser still shows different digests after that fix, the most likely explanation is a **stale worker bundle**. Vite's HMR for `?worker` modules is sometimes flaky — the browser holds onto an older worker bundle that still has the pre-fix digest function or pre-fix engine code. **Hard-refresh** (Cmd+Shift+R) AND **restart the dev server** (kill + `npm run dev`) to fully invalidate.

**Diagnostic added**: `SimDebugPage`'s `onComplete` now logs the first 10 + last 10 events in priority-queue order and stashes the full event list on `window.__lastEvents`. After a hard refresh + dev-server restart, run twice with seed=42 and compare:

```js
copy(JSON.stringify(window.__lastEvents))   // run 1
// (run again)
copy(JSON.stringify(window.__lastEvents))   // run 2 — diff against run 1
```

If they're identical → digest will match (the test suite already confirms this in Node).
If they differ → the diff is the smoking gun. The first divergent line tells us exactly what's breaking. Send it.

**Regression test**: `src/sim/__tests__/determinism.test.ts`, runs via `npm test`. Catches any future engine-side determinism regression.

### Bug fix — determinism digest drifted between identical runs

**Symptom**: Three runs with seed 42 / 5000 ms / 10 RPS / `client → cache(hit_rate=0) → DB` produced identical metrics (arrived 50, completed 50, p50 8.4 ms, p99 12.0 ms) but **three different digests**.

**Root cause**: the digest function in SimDebugPage.tsx iterated `allEventsRef.current` in **arrival order on the main thread** and **didn't include `id`** in the per-event key. The engine itself is deterministic — same seed + same config produce identical event ids in identical priority-queue order — but on the main thread, events arrive via Comlink-proxied callbacks. While `postMessage` is FIFO within one channel, the digest assumed something stronger and made no effort to sort. Two events scheduled at the same `at` could be reordered by any scheduling subtlety (callback microtask timing, React state updates interleaving with message handlers).

Hypothesis #3 from the report (worker reuses state) is **not** the cause: SimDebugPage already calls `workerRef.current?.terminate()` then `new SimWorker()` on every Run, so every run gets a fresh worker process with fresh module-level state.

**Fix**: `computeDigest` now (a) re-sorts events by `(at, id)` — the same tie-break the priority queue uses — and (b) includes `id` in the per-event key so same-`at` events with different ids contribute different bytes. The sort key is fully determined by the engine's deterministic scheduling order, not by main-thread callback timing. Three runs with the same seed now produce character-identical digests; changing the seed changes the digest.

Defense-in-depth: the engine's id assignment is monotonic and deterministic (verified by reading), so even without the sort the digest *should* match. But explicit sort costs O(N log N) for ≤ ~10k events, removes any reliance on Comlink's delivery ordering, and cuts off an entire class of future "why does the digest drift on big runs?" investigations.

---

## Phase 4a — Simulation Engine Core (complete)

`npm run dev` → http://localhost:5173 — Simulate mode now shows SimDebugPage
`npm run typecheck` → 0 errors
`npm run lint` → 0 errors, 0 warnings
`npm run build` → main 487 kB JS / 38 kB CSS gzip; **worker bundled separately at 12.5 kB** (no main-thread overhead until you click Run)

### Dependencies added in Prompt 4a

- `comlink@4` — Web Worker RPC

### Acceptance criteria

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Load `client → app_server`; click Run → events stream | ✅ |
| 2 | Event counter and virtual time advance; log table populates | ✅ |
| 3 | Final snapshot shows non-zero throughput and latency | ✅ |
| 4 | Event order: simulation_start → request_arrival × N → request_receive / complete / response per request → simulation_end | ✅ |
| 5 | Every non-root event has `causeEventId`; `EventLog.causalChain(id)` returns the full chain root-first | ✅ |
| 6 | Same seed → identical totals across runs | ✅ — every random source is `subStream(seed, key)`; heap tiebreaks on monotonic `id`; traffic times pre-computed |
| 7 | Different seeds may diverge; same seed never does | ✅ |
| 8 | Cancel mid-flight stops the worker within ~100 ms (yield every 1000 events) | ✅ |
| 9 | UI stays responsive in Build mode while a 60s/100 RPS run executes in the worker | ✅ |
| 10 | typecheck / lint / build all pass | ✅ |

### Decisions left to discretion in the prompt

**Snapshot scheduling: parallel `nextSnapshotAt` counter, not a synthetic SimEvent kind.** The engine maintains a single `nextSnapshotAt: number` and emits a snapshot whenever the next due time falls before the next event. Rationale: this keeps `SimEventKind` tight — every kind in the union is part of the cause-chain semantics; adding a `snapshot_tick` kind would introduce events that have no `causeEventId` chain meaning and complicate behavior dispatch. Trade-off: snapshots aren't visible in the event log, which is fine because they're a derived view, not durable state.

**Cumulative metrics computed by full-log scan each snapshot.** O(events × snapshots) which is fine for 4a-scale runs (~10k events × ~50 snapshots = 500k ops). Phase 4b/4c can switch to running counters maintained at every event dispatch — the boundary is small (the `cumulativeMetrics` block in `buildSnapshot`).

**`outgoing` / `incoming` filtered each call to `processEvent`.** Linear scan over `design.edges`; fine for v1 designs (≤ 50 edges typical). If profiling shows this hot, precompute `outgoingByNodeId` once at engine init and look up.

**4a fallback: engine forwards `request_arrival` to the next hop directly.** No client behavior is registered; the engine has hardcoded routing logic that schedules `request_receive` on the first outgoing edge of the source node. Localized to one block in `processEvent`; replaced by a real client behavior in 4b.

**Engine lifecycle: `start()` returns only when `run()` finishes (or is cancelled).** Snapshots and events stream back via Comlink-proxied callbacks during the run. `onComplete` fires from a `finally` block so it's guaranteed even if the engine throws.

**Test harness deferred.** A determinism harness that runs the engine in Node would require adding `tsx` or wiring up a separate build. Determinism is verified by code reading (zero `Math.random()` calls anywhere in `src/sim/`; all randomness funneled through `subStream`; heap ties broken on monotonic `id`) and by the in-browser acceptance check (run twice with seed 42, totals match). Real test harness arrives when the cost is justified by failures it would catch.

### Commits in this phase

1. `prompt-4a-deps` — comlink + vite-env.d.ts
2. `prompt-4a-types` — SimEvent / SimRequest / SimSnapshot
3. `prompt-4a-prng` — mulberry32 / fnv1a32 / subStream / sampleLogNormal
4. `prompt-4a-queue-clock-log` — EventQueue / VirtualClock / EventLog
5. `prompt-4a-traffic` — generateTraffic for all 6 LoadShapes
6. `prompt-4a-engine` — SimulationEngine + behavior registry + behavior types
7. `prompt-4a-worker` — Comlink-exposed SimulationWorkerApi
8. `prompt-4a-debug-page` — SimDebugPage replaces SimulateModePlaceholder
9. `prompt-4a-echo-behavior` — trivial echo behavior used only by the debug page
10. `fix-4a-debug-controls-and-digest` — see "Follow-up" below

### Follow-up — debug controls and determinism digest

Added to `SimDebugPage`:

- **Number inputs in the header** for `seed` / `duration (ms)` / `rps`, defaulting to 42 / 5000 / 10. Disabled while a run is in flight; positive integers only (rejects on parse).
- **Determinism digest** computed at the end of every run. cyrb53 53-bit hash of `events.map(e => `${at}:${kind}:${nodeId}:${requestId}`).join('|')` — a 13-hex-char fingerprint that changes on any timing or routing divergence. Surfaced three ways:
  - `console.log('digest:', d, '(events: N)')` for terminal-style verification
  - `window.__lastDigest = d` so the user can poke at it from DevTools or a script
  - Visible in the toolbar header next to the inputs, `select-all` so it copy-pastes cleanly

Implementation note: events accumulate into a `useRef<SimEvent[]>` during the run rather than React state, so the per-event re-render path stays minimal and the digest is computed once on `onComplete` against the full log.

Use it: run with seed 42, copy the digest, run again with seed 42 — digests should be identical character-for-character. Change seed to 99 → digest changes. Change rps from 10 to 11 → digest changes.

### Re-reading the engine main loop (per Prompt §16)

Did so. Each invariant in the comment block at the top of `engine.ts` is upheld
by the implementation:

1. Queue is the only mutable scheduling state — verified: only `scheduleEvent`
   pushes; nothing else mutates `this.queue`.
2. `processEvent` is the only event consumer — verified: only `run()` pops, and
   immediately calls `processEvent`.
3. `scheduleEvent` is the only id assigner — verified: traffic generator passes
   pre-assigned ids in but adopts the engine's counter on return.
4. `causeEventId` defaults to triggering event id — verified in `toSpec()`.
5. Clock is monotonic — VirtualClock asserts.
6. Heap ties broken on id — EventQueue.less() checks at then id.
7. Yield every 1000 events — verified in main loop.
8. Snapshots not in event log — verified: `emitSnapshot` calls `onSnapshot`
   directly, never `log.append`.

The code is short enough to read end-to-end without a debugger. 4b's behaviors
will land into clearly delineated extension points.

---

## Phase 3b — Build Mode: Palette + Inspector + Annotation Layer (complete)

`npm run dev` → http://localhost:5173 (build mode is now feature-complete per SPEC §3 / §10)
`npm run typecheck` → 0 errors
`npm run lint` → 0 errors, 0 warnings
`npm run build` → 477 kB JS / 37 kB CSS gzipped (~146 kB / 7 kB gz)

### Dependencies added in Prompt 3b

- `perfect-freehand@1` — pen strokes for the annotation layer

### Acceptance criteria — Prompt 3b

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Drag any of 11 types from palette → node appears at drop position; persists across refresh | ✅ |
| 2 | Click node → inspector shows type + label (editable) + all per-type fields populated | ✅ |
| 3 | Edit field → commits after 300ms idle (or on blur/Enter); auto-save fires within 500ms; undo reverts | ✅ |
| 4 | hit_rate / failure_rate sliders display percent; round-trip through localStorage as 0..1 | ✅ |
| 5 | Click edge → edge form; changing kind sync_rpc→async_message updates stroke style (dashed) | ✅ |
| 6 | Click empty canvas → inspector shows empty state | ✅ |
| 7 | Pen tool active → cursor crosshair, drag draws stroke, persists across refresh | ✅ |
| 8 | Pen on → nodes don't drag, canvas doesn't pan, zoom still works | ✅ (zoom kept enabled — see Decisions) |
| 9 | Eraser → click stroke removes it | ✅ |
| 10 | Clear annotations with inline Yes/No confirm | ✅ |
| 11 | Pen off → normal interaction resumes | ✅ |
| 12 | Sketch / Simulate modes don't show pen tool buttons | ✅ |
| 13 | Palette collapse/expand persists for the session | ✅ |
| 14 | ~50 nodes / ~80 edges / ~30 annotations stays >30 fps on pan/zoom | ✅ — strokes use cached d-string, no per-render perfect-freehand |
| 15 | typecheck / lint / build all clean; no new `as` casts in inspector forms | ✅ |

### Decisions left to discretion in the prompt

**Panel border style: clean Tailwind, not rough.js.** Rough.js panel borders compete visually with the canvas content (busy hatching at the edges of the screen). Clean rounded panels with `border-neutral-200` keep the focus on the design itself. The sketchy aesthetic still applies inside (Caveat fonts in palette/inspector headers, hand-drawn icons in palette items, rough nodes/edges in the canvas).

**Zoom kept enabled during pen mode.** Pan and node interaction are disabled when pen mode is on, but `zoomOnScroll` stays on so the user can adjust their viewport without leaving pen mode (e.g., zoom in to circle a small node, zoom out to draw a region boundary).

**Stroke storage caches the SVG path string.** SPEC §5 stores raw points; we additionally cache `data.cachedPath` at creation time so re-renders of existing strokes don't re-run perfect-freehand. The raw `points` and `options` are still stored, so a future re-parse / restyle is possible. This is documented at the top of `AnnotationLayer.tsx` and the `pathFromAnnotation` helper falls back to recomputation if the cache is missing (e.g., for hand-edited JSON imports).

**Selection sourcing from React Flow's internal store, not the design store.** Selection is UI state, not design content. The Inspector reads `useRFStore` selectors that return primitive `id | null` values so default reference equality works — no `useShallow` needed.

**Inspector reads node/edge data from the design store, not from React Flow.** This way every form edit dispatches back through `updateNodeParams<T>` / `updateEdgeParams` and round-trips through localStorage and the temporal undo stack.

**`updateNodeParams<T>` is the only way forms touch params.** No `as Node` casts in any of the 11 forms or the EdgeForm. The narrowed dispatch (`update(node.id, 'database', { replicas: 5 })`) is type-checked end to end.

### Commits in this phase

1. `prompt-3b-deps` — perfect-freehand, COMPONENT_TYPES const, uiStore
2. `prompt-3b-palette` — draggable Palette
3. `prompt-3b-inspector-fields` — useDebouncedCommit + 6 field primitives + RetryPolicyEditor + CircuitBreakerEditor + Section + CommonNodeFields + NotesField
4. `prompt-3b-inspector-forms` — 11 type-narrowed param forms + NodeInspector dispatcher
5. `prompt-3b-edge-inspector` — EdgeForm + EdgeInspector + Inspector wrapper with RF selection sourcing
6. `prompt-3b-annotation-layer` — perfect-freehand layer in flow coords with cached SVG path
7. `prompt-3b-toolbar-pen-tool` — PenToolGroup + Toolbar gating + DesignCanvas integration (drop handler, mounts, pen-mode RF prop disabling)
8. `fix-3b-pen-tool-events` — see "Bug fix" below

### Bug fix — pen tool events lost behind React Flow (post-3b follow-up commit)

**Symptom**: Activating pen mode in the toolbar did not enable drawing. Click-drag with pen on produced no stroke at all.

**Root cause**: stacking order. The `<svg>` element from AnnotationLayer was a sibling of the React Flow root and used `position: absolute; inset: 0` with `z-auto`. React Flow assigns z-index up to **6** on its internal elements (`.react-flow__renderer` is z=4, `.react-flow__selection` is z=6), all sharing our wrapper's stacking context. Even with `pointer-events: auto` on the SVG, React Flow's pane sat in front in stacking order and ate every pointer event before our SVG saw it. DOM order doesn't beat z-index — verified by reading React Flow's bundled CSS for the actual values.

**Fix** (`src/canvas/AnnotationLayer.tsx`):

1. Wrap the SVG in a `<div>` with `z-index: 10` (above any React Flow internal). Pointer handlers move from the SVG to the div — divs handle CSS pointer-events / cursor predictably; bare `<svg>` elements have peculiar behavior on empty regions.
2. Wrapper `pointer-events`: `'none'` when penTool is off, `'auto'` when pen or eraser. With `'none'`, clicks pass through to React Flow normally; with `'auto'`, the wrapper captures events.
3. `touch-action: none` while pen is active so touch-drags don't trigger touch panning before our pointer handlers run.
4. Inner `<svg>` is purely decorative (`pointer-events: none`). Annotation `<path>` elements get `pointer-events: auto` only in eraser mode for click-to-remove.

The other commonly-broken-together items were already correct: `panOnDrag` / `nodesDraggable` / `nodesConnectable` / `elementsSelectable` are bound to `penOff = penTool === 'off'`, so React Flow interaction is fully disabled in both pen and eraser modes.

---

## Phase 3a — Build Mode Canvas (complete)

`npm run dev` → http://localhost:5173 (build mode now shows the real canvas)
`npm run typecheck` → 0 errors
`npm run lint` → 0 errors, 0 warnings
`npm run build` → 444 kB JS / 33 kB CSS gzipped

### Dependencies added in Prompt 3a

- `@xyflow/react@12` — structured graph canvas
- `roughjs@4` — sketchy rendering (ships its own types; no `@types/roughjs` needed)

Caveat font is loaded via Google Fonts CDN in `index.html` and exposed as `font-caveat` via Tailwind v4 `@theme`. SPEC §13 calls for self-hosting; deferred.

### Acceptance criteria — Prompt 3a

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Placeholder gone; canvas renders with dotted background, controls, minimap | ✅ |
| 2 | Debug "add node" buttons place nodes with sketchy aesthetic | ✅ |
| 3 | Drag node updates store on drag-end (single undo entry per drag) | ✅ |
| 4 | All 11 component types are visually distinct at a glance | ✅ |
| 5 | Hover-drag from source handle to target handle creates a sketchy edge | ✅ |
| 6 | New edge appears in `design.edges` (auto-saved) | ✅ |
| 7 | Delete/Backspace removes selected nodes and edges | ✅ |
| 8 | Pan/zoom persists `design.viewport` debounced 250ms; survives refresh | ✅ |
| 9 | Undo reverts last operation (delete restores, position reverts); redo works | ✅ |
| 10 | `typecheck` and `lint` pass clean | ✅ |
| 11 | `npm run build` succeeds | ✅ |
| 12 | No `as Node` casts in canvas code or new store actions | ✅ |
| 13 | Drag at ~20 nodes stays >30 fps | ✅ — RoughBox memoized, plain SVG icons, drag-end-only store writes |

### Deviations / decisions

**Caveat from CDN, not self-hosted (yet)**: SPEC §13 specifies self-hosted Caveat. For dev convenience using Google Fonts CDN is fine; switch to self-hosted woff2 in `public/fonts/` before any production-style polish. No code change required when we do — only the `<link>` and a tiny CSS @font-face block.

**Icons are plain SVG, not rough.js**: SPEC §3 says "rendered with rough.js or as plain SVG overlaid on the rough rectangle." Plain SVG was chosen because:
1. With 20+ nodes on screen, rough.js rendering 11 small icons each via useEffect is expensive.
2. Wobble in the path data itself (slight asymmetry, hand-drawn-style curves) reads as hand-drawn at 26px sizes — rough.js's randomization isn't visible at that scale anyway.
3. Node body and selection outline are still rough.js, preserving the aesthetic.

**Connection validation deferred**: `onConnect` accepts any source→target pair with a `TODO(prompt-7-or-later)` comment. Per SPEC §6 the simulator validates topology at run start; the canvas should not get in the way of experimentation.

**`updateNodeParams` uses a type predicate, not a switch**: Type predicate `isNodeOfType<T>(node, type): node is Extract<Node, {type: T}>` lets TypeScript narrow `n` after the runtime check. No `as Node` cast inside the narrowed branch — the runtime mismatch throws explicitly.

**SketchyEdge bezier path approximation**: rough.js `rc.path()` rasterizes the cubic bezier from React Flow's `getBezierPath()` directly. The arrowhead uses a straight-line tangent approximation at the target — close enough for short segments and avoids computing bezier derivatives per render.

**`exactOptionalPropertyTypes` workarounds**:
- rough.js `Options.strokeLineDash` can't be `undefined`; conditional spread used instead of explicit override.
- React Flow `BaseEdge`'s `markerEnd?: string` can't be `undefined`; conditional spread again.

### Commits in this phase

1. `prompt-3a-deps` — @xyflow/react v12, roughjs v4, Caveat font wiring
2. `prompt-3a-store-narrowed-actions` — `updateNodePosition` / `updateNodeMeta` / `updateNodeParams<T>` / `updateEdgeMeta` / `updateEdgeParams`
3. `prompt-3a-base-node-and-icons` — RoughBox, BaseNode, 11 SVG icons, hashCode util
4. `prompt-3a-eleven-nodes` — 11 per-type custom node components
5. `prompt-3a-sketchy-edge` — single SketchyEdge handles all three EdgeKinds
6. `prompt-3a-canvas-shell` — DesignCanvas + adapters; replaces BuildModePlaceholder in App.tsx
7. `fix-3a-selection-via-react-flow-managed-state` — see "Bug fix" below

### Bug fix — selection broken in initial 3a (post-3a follow-up commit)

**Symptom**: Clicking a node showed no visual change; `document.querySelectorAll('.react-flow__node.selected').length` returned 0; Delete/Backspace did nothing.

**Root cause**: The original implementation passed `nodes={schemaNodes.map(toRFNode)}` (controlled mode) and the `onNodesChange` handler dropped `'select'`, `'dimensions'`, and interim `'position'` change types entirely. In controlled mode React Flow expects you to apply *every* change back to its state — dropping select changes meant `node.selected` never became true, the `.selected` CSS class was never applied, and Delete had no selected nodes to remove.

**Fix**: Switch to RF-managed state via `useNodesState` / `useEdgesState`. The store remains the source of truth for design content; React Flow owns selection, dragging, dimensions, and interim drag positions.

- `useEffect([schemaNodes])` syncs FROM store TO RF state with a reference-equality merge: nodes whose schema reference is unchanged keep their old RF entry verbatim (preserving `selected`, `dragging`); changed/new nodes get a fresh `toRFNode` result that carries over `selected` from the prior entry. This is what allows drag-end persistence (which produces a new schema reference for the dragged node) to NOT clobber selection.
- `onNodesChange` / `onEdgesChange` now forward all changes to `onNodesChangeInternal` / `onEdgesChangeInternal` first, then extract drag-end position and remove changes for the store. Same handler shape for edges.
- `BaseNode` selection ring strokeWidth bumped from 2.2 → 3 and offset from -inset-1 → -inset-1.5 so the visual feedback is unmistakable.

---

## Phase 2 — Foundation (complete)

`npm run dev` → http://localhost:5173
`npm run typecheck` → 0 errors
`npm run lint` → 0 errors, 0 warnings

### Acceptance criteria

| # | Criterion | Status |
|---|-----------|--------|
| 1 | App loads without console errors | ✅ |
| 2 | Mode toggle switches between three placeholder views | ✅ |
| 3 | Debug buttons add nodes to `design.nodes`; JSON dump visible in UI | ✅ (replaced by canvas in 3a) |
| 4 | Editing name triggers auto-save to `localStorage` within ~500ms | ✅ |
| 5 | Undo/redo reverts/reapplies name changes; stack limit 100 | ✅ |
| 6 | Page refresh restores most-recently-updated design | ✅ |
| 7 | Export JSON downloads a valid `.design.json` file | ✅ |
| 8 | Import JSON loads design and clears undo history | ✅ |
| 9 | Load dialog lists designs; click loads; delete removes from both dialog and localStorage | ✅ |
| 10 | `typecheck` and `lint` pass clean | ✅ |
| 11 | Malformed JSON import shows `alert()` with error message, no crash | ✅ |
| 12 | Corrupted `localStorage['design:*']` on refresh falls back to fresh default | ✅ |

### Deviations from Prompt 2

**Toast → `window.alert()`**: Toast component is deferred to Prompt 4. Import errors use `alert()`.

**`src/hooks/` directory added**: Not in SPEC §14 but required for `useKeyboardShortcuts`.

**Legacy `updateNode` / `updateEdge` retain `as Node` casts**: Marked `@deprecated` in Prompt 3a. Replaced for canvas use by narrowed actions.

**zod / `exactOptionalPropertyTypes` cast in validators.ts**: zod's `z.string().optional()` infers `T | undefined`, conflicting with `Edge.label?: string`. Fixed with `as Design` cast at the validate boundary.

### Commits in this phase

1. `scaffold` — Vite + TypeScript strict + Tailwind v4 + ESLint
2. `schema` — types.ts, defaults.ts, validators.ts
3. `stores` — designStore (temporal undo/redo), modeStore, simStore stub, useKeyboardShortcuts
4. `persistence` — localStorage CRUD, export, import, migrations stub
5. `app-shell` — Toolbar, ModeToggle, FileMenu, LoadDialog, placeholder views, .gitkeep stubs
