# sysdraw — Round 2 bug report

**Site tested:** https://sysdraw.vercel.app/ (commit 82b83df, all round-1 fixes confirmed live)
**Tested on:** Chrome 147, viewport 1456×812.
**Date:** 2026-05-08

This is fresh ground — areas I didn't fully exercise the first time, plus stress-testing the round-1 fixes. Listed by severity.

---

## P0 — bugs that affect the demo's main story

### R-1. Three of the eight demos don't actually demonstrate their stated failure mode

This is the same class of bug as the round-1 cache-stampede fix, but in three other demos. Repro: load demo, click Run at default 5000ms / 10 RPS / 1×.

| Demo | Description claims | Sim outcome | Verdict |
|------|--------------------|-------------|---------|
| **network-partition** | "Watch the error rate climb during 2000–3500ms" | arrived 150 / completed 149 / failed 0 / inFlight 1 | Zero failures despite a partition. Description is wrong. |
| **hot-shard** | "Shard 1 saturating (queue fills, reads start rejecting) while shards 2 and 3 are barely used" | arrived 410 / completed 410 / failed 0 / inFlight 0 | Shard 1 doesn't saturate. Zero rejections. The "hot shard" demo doesn't show a hot shard. |
| **thundering-herd** | "Watch the latency spike and the rejection rate" | arrived 900 / completed 399 / failed 0 / inFlight **501** | Zero rejections; 56% of requests are "in flight" forever. The system collapses but the metrics say nothing went wrong. |

**Fix path** is the same as cache-stampede:
- `network-partition`: tighten LB routing so requests routed to the partitioned server actually time out (currently they look like they complete via retry path). Or apply Node-degraded chaos to that one server during the partition window.
- `hot-shard`: bump RPS-on-shard-1 well above its `maxConcurrent`, lower its queue depth to ~10. Right now it's processing all 250 inbound requests successfully, which means it isn't actually "hot" relative to its capacity.
- `thundering-herd`: this one is more serious — see R-2.

### R-2. Thundering-herd leaks 501 in-flight requests at simulation end

Tied to R-1 but worth its own callout. With the spike chaos firing at t=2000ms (10 clients × 5× = 500 RPS for one second on a service whose `maxConcurrent` is much lower), the engine should either:
- Reject the requests it can't handle (backpressure)
- Time them out (deadline)
- Or, at simulation_end, classify all in-flight as `failed`/`abandoned`

Instead, **501 requests just sit in the in-flight bucket**. The sums close (`399 + 0 + 501 = 900`), so the round-1 reconciliation fix is working — but the engine is not enforcing any backpressure on the Shared service during the spike.

**Fix:** Either set the demo's Shared service to have a finite queue (and `Reject newest`/`Reject oldest`) so rejections actually happen, or add a global request deadline so requests that haven't completed within e.g. 2000ms get classified as `failed`. The current behavior — 501 requests perpetually "in flight" — gives users no visual signal that the system is in trouble, defeating the demo's purpose.

### R-3. Invalid `?demo=...` URLs silently land on a blank "Untitled Design"

Repro: navigate to `https://sysdraw.vercel.app/app?demo=cb-partial` (the old internal short ID, or any typo). Result: page loads with title "sysdraw" (no per-route title), design name "Untitled Design", zero nodes. No error, no fallback message, no redirect.

This will hit anyone who:
- Bookmarked a URL using the old internal ID (`cb-partial`) before the slug names settled.
- Mistypes a URL.
- Has a stale link in a blog post.

**Fix:** When `demo` query param is present but doesn't resolve, either:
- Redirect to `/` with a flash message ("That demo isn't available; pick one below"), or
- Show an inline empty-state on `/app` that says "Demo `cb-partial` not found — try one of: …" and links to the canonical demos.

---

## P1 — visual / UX issues

### R-4. Demo titles in the top toolbar visually truncate without ellipsis

Examples I saw:
- "Demo: Network partition" → renders as "Demo: Network partitior"  
- "Demo: Saturating fan-out" → renders as "Demo: Saturating fan-ou"

The container clips the last 1–2 characters of the design-name input rather than ellipsizing or expanding. Only the wider-than-input names are affected.

**Fix:** Either widen the design-name input to fit the longest demo title (~26ch), or apply `text-overflow: ellipsis` so it cuts cleanly with "…" when needed.

### R-5. Thundering-herd renders 10 stacked client nodes that overlap to unreadability

The default layout puts 10 `Client #1`…`Client #10` nodes in a vertical column at x≈790, each ~190×32, with so little vertical spacing that the labels overlap. The result looks like a smudged blob, not 10 distinct clients.

**Fix:** Either fan the clients out into a 2–5 column grid, or, since they're identical, render a single "Client × 10" node with a `count` parameter — that also matches how a real load test thinks about clients. Same applies to network-partition's three app servers, which are clearer simply because there are only three.

### R-6. Keyboard-added palette nodes all stack at the same canvas position

Repro: `/app` (empty), focus the palette's "Client" item, press Enter. Repeat for "App Server", "Cache", etc. Result (verified via DOM): every node ends up at exactly `(x=240, y=288)`, all 11 stacked one on top of another. The drag-drop path computes a drop point per drop; the keyboard path uses a fixed default for every Enter press.

**Fix:** When adding via keyboard, pick a position based on `(existingNodes.length × stride)` so each new node lands offset to the right (or below) of the last one. Or auto-call `fitView` after the add so they at least visually separate via auto-layout.

### R-7. The Pen button is missing `aria-pressed`

Build/Sketch/Simulate now correctly expose `aria-pressed="true|false"` (round-1 fix) — but the Pen toggle does not (`aria-pressed: null`). Same problem you fixed for the mode toggle; just hasn't been extended to the Pen button.

**Fix:** Add `aria-pressed={penActive}` on the Pen button. Same likely applies to Eraser if it's a toggle.

### R-8. In Build mode, the palette panel covers the leftmost node

Repro: load any demo, switch to Build mode. The "Add node" palette is fixed at `left: 0` with width ~155px and overlays the canvas. On demos with a leftmost node near `x=240` (like cache-stampede's Client), the Client is partially or fully hidden behind the palette.

**Fix:** Either reserve space for the palette by shifting the React Flow viewport's content origin, or use the existing "Collapse palette" button by default in Build mode the first time it would obscure a node. A `fitView` call on entering Build mode would also do it.

### R-9. Run button position is unstable across mode/state changes, breaking my muscle memory

Subjective but real: The Run button moves between (50, 75), (50, 110), (50, 127) depending on whether the demo banner is dismissed, whether speed selector wraps, etc. The button is large enough that it's still findable, but the toolbar reflows in ways that look unintentional. Worth pinning the toolbar height with a CSS `height` instead of relying on flex `auto`.

---

## P2 — performance / correctness

### R-10. Renderer hangs while a 1× simulation is running

Repro: cache-stampede, set duration=10000ms, speed=1×, click Run. The page is genuinely unresponsive for ~10s — clicks, screenshots, even programmatic queries time out. The sim is technically running in the worker but the main thread is being saturated by *something* during playback (probably real-time event-log updates, plus throughput/latency chart re-renders at every tick).

This was masked at 5s default because users didn't notice 5 seconds of unresponsiveness. At 10s and especially 30s it becomes painful. It also defeats the Pause button — you literally cannot click it during the run.

**Fix paths:**
- Throttle event-log appends (batch into requestAnimationFrame, or only render the last N visible).
- Throttle metric-chart updates to ~10 Hz instead of every event.
- Or default the speed selector to 10× and let users opt in to 1× for "live" feel.

### R-11. The `at(ms)` chaos clamp uses `dur-1`, leaving a dead millisecond

Tiny: chaos `at` max is `duration - 1`, but the chaos `duration` min is `1`, so the latest valid chaos is `[duration-1, duration]` — exactly straddling the simulation end. Either widen the `at` max to `duration` (and treat a chaos that starts at the very end as a no-op) or shrink chaos `duration` max to `duration - at` (which the UI does seem to do — `duration (ms) max="2500"` updates dynamically based on at). Worth a quick code read.

### R-12. Demo URL slugs and internal storage IDs don't match — easy footgun for future migrations

The landing page emits `?demo=circuit-breaker-partial-failure` but the storage keys use `design:demo-cb-partial`, `design:demo-cache-stampede`, etc. (with shorter IDs). Because the URL→demo resolution lives in code (not via that storage), this *works*, but:

- Any new demo author has to remember to register both names.
- Any tool that reads localStorage to debug ("what designs do I have?") sees the short IDs, not the URL slugs.
- If you ever do route-based pre-rendering you'll hit it.

**Fix:** Pick one canonical ID per demo. Use the URL slug everywhere, including in localStorage keys, since that's already what users see and share.

---

## P3 — copy and polish

### R-13. Two demos label themselves "(approximation)" but only one explains why

- `?demo=hot-shard` banner: "Hot shard (approximation): The engine does not model true horizontal sharding; this approximates the dynamics with three independent client→shard pairs at skewed RPS."
- `?demo=saturating-fan-out` banner: "Saturating fan-out (approximation): …"

Two issues:
1. Putting "(approximation)" in the demo title makes it sound less authoritative than the others. If it's an approximation, just describe the behavior; don't open with the disclaimer.
2. The hot-shard caveat ("the engine does not model true horizontal sharding") leaks engine internals to the user. It's the kind of thing that belongs in a README, not in the demo banner.

**Fix:** Rewrite both banners to focus on the lesson, not the engine. E.g. for hot-shard: "Three database shards, but 80% of traffic is keyed to shard 1. Watch its queue saturate while shards 2 and 3 sit idle." Same energy as cache-stampede's banner now.

### R-14. The Pen toolbar doesn't appear in Simulate mode (good) but the Pen button does (confusing)

In Simulate mode, the Pen button is visible in the top toolbar but its tooltip says "Build mode only" — and clicking it does nothing. Either grey it out / disable it in Simulate mode, or hide it. Showing a button that says "I only work in another mode" is one of those small UX papercuts.

### R-15. Title is "sysdraw" with no subtitle on `/app` (no demo)

When `/app` boots into the new "Untitled Design" empty state, the document title is just `"sysdraw"`. That's fine, but the round-1 fix established "sysdraw · {demo name}" as the convention — extending it to "sysdraw · Untitled Design" or "sysdraw · New Design" would be consistent.

---

## What I tested but found no issues with

- File menu now anchors right and stays in the viewport across all viewport widths I tried.
- Export JSON triggers a download cleanly; menu closes correctly afterward.
- Pen tool draws strokes and they persist when toggling Simulate ↔ Build.
- Toast for "Link copied" is correctly sized, has `aria-live`, and now wraps normally.
- Speed selector (0.1×, 0.25×, 0.5×, 1×, 2×, 5×, 10×) all work; 10× makes long sims usable.
- All seven runner/chaos input clamps from round 1 hold under stress.
- Stacking 5 simultaneous chaos events and running with 10× speed completes correctly with sums-close metrics (arrived 2800 = completed 1784 + failed 1011 + inFlight 5).
- Per-route `<title>`, `og:url`, `canonical`, and `favicon.svg` all update correctly for `?demo=...` URLs.
- Keyboard activation (Enter/Space) on palette items adds nodes — modulo the stacking bug in R-6.
- Focus ring is high-contrast slate gray; visible on both light and dark surfaces.
- Single worker fetched across multiple Run cycles (verified 1 fetch for 2 sequential runs).
- No console errors or exceptions across the full session.
- All inputs have accessible labels; all buttons have text or aria-label.

---

If you want, I can re-run a specific scenario, capture screenshots into the report, or queue up parameter-tuning suggestions for the three broken demos (R-1) when you're ready to fix them.
