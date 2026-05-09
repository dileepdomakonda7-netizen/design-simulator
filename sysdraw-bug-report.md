# sysdraw — End-to-end bug & issue report

**Site tested:** https://sysdraw.vercel.app/
**Tested on:** Chrome 147 (macOS), viewport 1456×812 desktop, also probed at 1200×612.
**Date:** 2026-05-08

Bugs grouped by severity. Each item lists what I saw, where, and a suggested fix.

---

## P0 — Visible bugs that hurt the demo

### 1. File menu opens off-screen / behind the inspector
- **Where:** `/app` → top-right "File ▾" button.
- **Repro:** Click "File ▾". Menu items (`New Design`, `Load Design…`, `Export JSON`, `Import JSON…`, `Import Image…`) exist in the DOM but are not visible.
- **Cause:** The dropdown is positioned `left: 1366px, width: 160px` in a 1440px-wide viewport — it extends ~84px past the right edge. It also shares `z-index: 20` with the Inspector panel, so the inspector paints over it.
- **Fix:**
  - Anchor the menu with `right: 0` relative to the File button, not `left:`.
  - Bump the menu's `z-index` above the Inspector (e.g. `z-50`).
  - Add a portal or position-flipping logic (Floating UI / Radix Menu) so it always stays in viewport.

### 2. "Link copied" toast wraps to a 1-character-wide column
- **Where:** Top-right "Share" button.
- **Repro:** Click Share.
- **Cause:** The toast container is given a very small width (looks like ~28px), so the message "Link copied — anyone with this URL can load your design." wraps one short word per line.
- **Fix:** Set a sensible `min-width` (240–320px), `max-width: 90vw`, and `white-space: normal` on the toast wrapper.

### 3. React Flow minimap renders as blank rectangles
- **Where:** Bottom-right of canvas, `/app` and the landing-page embed.
- **Repro:** Load any demo. Look at the minimap.
- **Diagnostic:** Inspecting `.react-flow__minimap svg` shows the SVG is generated with a valid viewBox, but it contains zero `<rect>` elements for nodes (only the overlay `<path>`). So the minimap doesn't visualize the graph — just shows the viewport mask on a grey backdrop.
- **Likely cause:** Custom node types aren't being passed/registered with `<MiniMap>` (typical React-Flow gotcha when using custom node renderers).
- **Fix:** Pass `nodeColor`, `nodeStrokeColor`, and ensure node `width`/`height` are set on each node so MiniMap can draw them. Or supply a `nodeComponent`/render override to MiniMap.

### 4. Demo embed on landing page clips its right edge
- **Where:** `/` landing page, the embedded demo iframe.
- **Repro:** Scroll to the demo. The right-most node (External service) is rendered as `Ext...`, and the React Flow attribution overlaps the node label.
- **Cause:** Iframe content isn't auto-fit to its container; `fitView` isn't called on resize/load, so the canvas keeps the editor's pan/zoom and chops off the right node.
- **Fix:** Have the embed call `fitView({ padding: 0.1 })` after mount and on container resize. Or wrap nodes in a `ReactFlowProvider` and use the `useReactFlow().fitView()` hook in the embed entry.

### 5. Cache-stampede demo narrative doesn't match simulation results
- **Where:** `/app?demo=cache-stampede`.
- **Repro:** Click Run. Result: `arrived 250 / completed 250 / failed 0 / rejected 0`.
- **Cause:** The banner says "every request hits the database, the database queue saturates, and rejections cascade upstream" — but with the seeded chaos and parameters, **zero rejections occur**, contradicting the educational point.
- **Fix:** Either tighten the database `queue max depth` / latency parameters so the cache-miss storm actually saturates the DB and produces non-zero rejections, or rewrite the banner to match what users will actually see.

### 6. Cumulative counts don't sum (off-by-one) on Retry storm
- **Where:** `/app?demo=retry-storm`, after Run.
- **Repro:** `arrived 100, completed 43, failed 56, rejected 0` — that totals **99**, not 100.
- **Cause:** Likely a request still in flight at `simulation_end` isn't accounted for, or `failed/completed/rejected` are not mutually exclusive of a fourth bucket.
- **Fix:** At simulation end, classify all in-flight requests into one of the four buckets (e.g., add an "abandoned/in-flight" bucket, or treat them as `failed`). The dashboard should always satisfy `arrived = completed + failed + rejected + inFlight`.

---

## P1 — Validation, copy, and UX issues

### 7. Pluralization: "1 instances"
- **Where:** Inspector → set App Server's `Instances` to 1. Node label reads "1 instances".
- **Fix:** `instance${n === 1 ? '' : 's'}` everywhere a count is interpolated. Same likely applies to `1 RPS` (correct) vs other counts.

### 8. No min/max bounds on chaos & runner inputs
- **Where:** Simulate mode → seed/duration/rps inputs, and chaos parameter inputs (`at`, `duration`, `multiplier`, etc.).
- **Repro:** Set chaos `at = 25_005_001_500` ms (way past sim duration of 5 s). The app accepts it without warning; the chaos band is rendered far off the timeline; the digest still changes (suggesting the worker hashes the chaos config even when it's a no-op).
- **Fix:**
  - `at`: `min=0`, `max=duration`.
  - `duration` (chaos): `min=1`, `max=runDuration - at`.
  - `multiplier`: `min=1`, `max=100` (or whatever is sane).
  - `rps`: `max=10000` to keep the worker bounded.
  - On invalid edits, clamp on blur and surface a small inline validation message.

### 9. Inspector "Failure rate" % indicator is right-clipped
- **Where:** Inspector → click any node with a Failure-rate slider. The "1%" / "100%" label on the right of the slider is cut off by the panel's right edge.
- **Fix:** Reduce slider `width` by ~24px, or move the percentage label below the slider.

### 10. "Sketch Mode" placeholder leaks internal language
- **Where:** Top toolbar → click "Sketch". Placeholder reads: *"Freehand canvas and 'Parse to graph' arrive in Prompt 5."*
- **Fix:** End users don't know what "Prompt 5" is. Use "Coming soon" or a roadmap link instead.

### 11. Banner copy uses internal config syntax
- **Where:** `/app?demo=cache-stampede` banner: "When it fails (atMs=2000–4000), every request…"
- **Fix:** "When the cache is unavailable between t=2s and t=4s…" Don't expose `atMs=` to non-developers.

### 12. /app loads a previous demo design instead of an empty canvas
- **Where:** Navigate to `/app` (no `?demo=` param).
- **Repro:** Page boots into "Demo: Read-after-write surprise" because localStorage already has 6 demo designs auto-seeded; the app picks the last one.
- **Fix:** When no `?demo=` is supplied and no user-saved design exists, route to "New Design" with an empty canvas. Or show a picker.

### 13. Adding a node from the palette doesn't auto-select / populate inspector
- **Where:** Build mode → drag App Server onto canvas. Inspector still says "Click a node or edge to edit."
- **Fix:** On drop, set the new node as `selected: true`. Saves a click and improves discoverability of node properties.

### 14. Number-input bumps don't replace existing values when re-edited fast
- **Where:** Any number input. After typing a value and tabbing, attempting to retype with a triple-click + type can append rather than replace, producing nonsense like `2500500`.
- **Fix:** This is partly a browser quirk, but you can mitigate by adding `onFocus={e => e.target.select()}` to all number/text inputs. It also makes the editing feel a lot snappier.

---

## P2 — Accessibility & semantics

### 15. Focus outline is white on cream background
- **Where:** Tab through `/app` controls. Computed style on focused buttons: `outline: rgb(255, 255, 255) auto 1px;`
- **Impact:** Keyboard users can't see what's focused. WCAG 2.4.7.
- **Fix:** Pick a high-contrast focus ring (`outline: 2px solid #2563eb; outline-offset: 2px`) and apply it via `:focus-visible`. Match it consistently across light and dark surfaces.

### 16. Palette items are `<div draggable>` with no role/aria/keyboard support
- **Where:** Build mode → left palette. Each "Client", "Database", etc. is `<div draggable=true>` with no `role`, `aria-label`, no `tabindex`, and no keyboard handler.
- **Impact:** Keyboard-only and screen-reader users can't add nodes.
- **Fix:** Wrap each palette item in a `<button>` (or add `role="button"`, `tabindex="0"`, and an Enter/Space handler) plus an `aria-label` like "Add App Server node".

### 17. No `<main>` landmark, no skip-link
- **Where:** Both `/` and `/app`. `document.querySelector('main')` returns null.
- **Fix:** Wrap the primary content in a `<main>` element. Add a "Skip to content" link as the first focusable element on the page.

### 18. `og:url` and `og:title` are stuck on the landing-page values for `/app` routes
- **Where:** Any `/app?demo=...` URL.
- **Repro:** `meta[property="og:url"]` returns `https://sysdraw.vercel.app` even on `/app?demo=cache-stampede`. `document.title` also doesn't change per demo.
- **Impact:** When users share demo links to Slack / Twitter, all previews look identical.
- **Fix:** Per route, set `og:url` to the canonical link and update `document.title` to e.g. "sysdraw · Cache stampede". Add `<link rel="canonical">`.

---

## P3 — Performance, persistence, polish

### 19. The simulation worker script is fetched 7–11 times on a single page load
- **Where:** Page load on `/`. Network panel shows `assets/worker-Bh8uzFJ9.js` requested ≥7 times, all in `pending` state (held open by a Worker). For an embed that runs one simulation, that means the page is spawning many workers — possibly one per metric stream or per chart.
- **Fix:** Spawn one shared worker for the embed; reuse it instead of creating one per chart/component. Confirm via `performance.getEntriesByType('resource')` that you don't leak workers on re-renders.

### 20. Six demo designs auto-seeded into localStorage with no way to clear from UI
- **Where:** Fresh visit creates `design:demo-*` and `designs_index` keys (~13KB).
- **Issue:** Users who edited a demo can't easily get back to "factory" state. No "Reset all designs" UI.
- **Fix:** Add a "Reset to factory demos" item under the File menu, and either (a) detect when stored versions differ from shipped versions and offer to reload, or (b) version-stamp the seeded designs and re-seed when version bumps.

### 21. Event-log IDs aren't sequential / sort key is mixed
- **Where:** Event log after a run. IDs jump like `#51, #301, #300, #298, #297, #50, #296, #295…`.
- **Issue:** Looks confusing — events at the same timestamp are intermixed across two different ID counters. Reads like a bug to a careful user.
- **Fix:** Use a single monotonic counter for all event types, or label the two counters explicitly (e.g. "lifecycle #50" vs "request #297").

### 22. Adding chaos config that is fully out of range still mutates the run digest
- **Where:** Add a Traffic spike at `at=25,000,000ms` to a 5,000ms run. Re-run: digest changes (`fbb14...` vs `54424...`).
- **Issue:** A no-op event shouldn't change the deterministic digest, since the simulation is identical. Slight reproducibility-claim concern.
- **Fix:** Filter chaos events whose effective window is outside `[0, duration]` before they reach the worker / digest hash.

### 23. Demos differ in whether chaos is preloaded
- **Where:** `cache-stampede` ships with a Miss-storm Cache chaos preloaded; `retry-storm` ships with no chaos and an empty timeline.
- **Issue:** Inconsistent demo experience — the timeline panel looks broken on retry-storm even though it's just empty.
- **Fix:** Either always preload at least one illustrative chaos event, or render an explicit "No chaos events scheduled — try clicking a button above" hint inside the timeline panel.

### 24. Several palette item labels truncate at the right edge ("Externai")
- **Where:** Left palette. The label "External" sometimes renders as "Externai" depending on font hinting. Same risk for "Object Storage".
- **Fix:** Either widen the palette by ~10px or apply `white-space: nowrap` and verify all labels fit.

---

## Quick wins (small but worth doing in one pass)

- Add `<title>` updates per route.
- Add `lang="en"` to `<html>` (already there — keep).
- Add a favicon ICO + a 192/512 PNG manifest entry for installability.
- Add `aria-pressed` to the Build/Sketch/Simulate segmented control.
- Add `aria-live="polite"` on the toast container so screen readers announce "Link copied".
- The Pen tool button shows `✎ Pen` but I never tested it in this run — worth confirming the canvas annotation feature still saves into the design.
- Add a global "?" key to open a keyboard-shortcut cheat sheet (Undo/Redo are the only ones surfaced today).

---

## What's working well (so you know what NOT to touch)

- Drag-and-drop from palette to canvas — solid.
- Undo / Redo on node add/remove — works as expected.
- Inspector accurately reflects clicked-event payload (showed `stalenessMs: 155.07` on the read-after-write run, which is exactly the educational point).
- Determinism with the same seed reproduces the same digest across reruns (when chaos is unchanged).
- Share button copies a URL that successfully restores the design on load.
- Charts (throughput, latency p50/p95/p99, error rate, rejections/s) all render and rescale correctly.
- "Cache-miss storm" / "Replication lag spike" chaos buttons correctly disable when the design lacks the relevant node type — nice touch.

---

If you want, I can re-run any of these to capture exact reproduction steps, screenshots, or the failing JSON payloads.
