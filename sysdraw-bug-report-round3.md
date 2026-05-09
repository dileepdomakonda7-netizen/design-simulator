# sysdraw — Round 3 bug report

**Site:** https://sysdraw.vercel.app/ (commit eb17442, all round-2 fixes verified live)
**Tested on:** Chrome 147, viewport 1456×812 / 1512×794
**Date:** 2026-05-08

This round digs into less-trodden paths: the deterministic engine claim, edge inspector, per-node parameter validation, sim controls, and share-link round-trip.

---

## P0 — engine correctness

### R3-1. The "deterministic" claim is broken across consecutive runs

This is the most serious finding. sysdraw's tagline is "deterministic" — the README and the home page banner say "Same seed, same outcome, every time." That's not what I observe.

Repro on `/app?demo=thundering-herd`, no edits between runs, seed=42 throughout:

| Run | digest | arrived | failed |
|----:|--------|--------:|-------:|
| 1 (after page load) | `1b0598e01f6088` | 900 | 500 |
| 2 (no reload) | `54ab718b2cb10` | 860 | 480 |
| 3 (no reload) | `1b0598e01f6088` | 880 | 486 |
| 4 (no reload) | `5851d2eb1e9f4` | 770 | 465 |
| 5 (after reload) | `157f54678beeac` | 830 | — |

Two runs agreed (1 + 3 produced the same digest), three other runs each produced a unique digest. The digest is supposed to be a fingerprint of the deterministic event stream — different digests mean the engine produced genuinely different event streams.

Cache-stampede has the same problem — across separate browser sessions I've recorded these digests for `/app?demo=cache-stampede` with seed=42 and no edits:
- `19116890d991e4` (round-2 verification)
- `167595fc558002` (round-3, twice on fresh reloads)
- `859f5d9ff7fe4` (round-3, fresh reload, after a fresh-reset reset)

**Likely cause:** the round-2 R-10 fix moved to "cancel-then-restart instead of terminate-then-respawn" for worker reuse. If `cancel` doesn't fully reset the engine's PRNG state (or any other in-worker mutable state), back-to-back runs will diverge. Even fresh-page runs may diverge if the worker is module-scope-cached in a way that retains state.

**Why this matters more than other bugs:** the entire pedagogical premise of the tool — "you can compare design A vs design B because the seed is the same" — depends on this. Two engineers running the same design at the same seed should always see the same metrics; right now they won't.

**Fix path:**
- Audit every place the engine reads from anything other than the explicit seed-derived PRNG.
- After `cancel`, recreate the engine instance (or explicitly reseed the PRNG) — don't reuse it.
- Add a deterministic-determinism test to CI: run the same demo×seed twice in the same worker, assert identical digests.

### R3-2. Cumulative metrics show "COMPLETED" before they're actually final

When a sim ends, the UI flips to `COMPLETED` while the streamed event buffer is still draining. If you look at the cumulative card immediately, `arrived` is short of the true final value.

Repro on `/app?demo=cache-stampede`, seed=42, 1× speed:
- 8s after Run click: `arrived 920, failed 129` (sums don't close: 920 ≠ 866 + 129 + 5)
- 10s after Run click: `arrived 1000, failed 129` (sums close)

Same run, same digest (`167595fc558002`), but the visible numbers slid up over the next 2s after `COMPLETED` appeared.

**Fix:** `simStore.appendEvents`/`drainBuffers` runs at `onComplete`, but the state transition to `COMPLETED` is firing before the drain has fully populated reactive state in React. Either:
- Hold the state transition until after `drainBuffers` has finished and the next render has applied, or
- Compute the cumulative card from the worker's final snapshot (which has the correct totals) instead of accumulating streamed events client-side.

### R3-3. The playback timer freezes mid-duration when COMPLETED state is shown

Related to R3-2 but visible separately. After a 5000ms sim completes, the `t = X.XXs` indicator at the top right often shows e.g. `t = 4.50s` rather than `t = 5.00s`, even though the state pill says `COMPLETED`. Same for `t = 3.20s` at 10× speed.

**Fix:** When the engine fires `simulation_end`, snap the playback time to `simulationDuration`, not to the last drained event's timestamp.

---

## P1 — input validation

### R3-4. Edge inspector accepts Latency p50 > Latency p99

Repro: click any edge in cache-stampede; in the inspector, type `100` into Latency p50 and `10` into Latency p99 — both accepted, no warning. Saved into the design. The simulation will use `p99=10` even though `p50=100`, which is mathematically impossible (99th percentile must be ≥ 50th percentile).

Same issue applies (untested but likely) to:
- Cache: Read latency p50 / p99
- Database: Read latency p50/p99, Write latency p50/p99, Repl. lag p50/p99
- Likely a few more across other node types.

**Fix:** On blur of either field, clamp `p99 = max(p99, p50)`. Or render an inline error: "p99 must be ≥ p50."

### R3-5. Most node/edge numeric inputs have no upper bound

The runner inputs (seed, duration, rps) and chaos inputs got clamps in round 1. The inspector inputs did not. Examples observed:
- Edge: Latency p50, Latency p99, Timeout — `min=0`, `max=""` (unbounded).
- Cache: Capacity (`min=1`, no max), Read latency p50/p99 (no max).
- Database: Replicas (min=1), Read/Write capacity (no max), all latency p50/p99 (no max), Repl. lag (no max).
- Client: RPS, Think time, Timeout (no max).

A user who types `1e15` into Capacity will save that into the design. It probably doesn't crash the worker, but it pollutes shared designs and confuses other users who load them.

**Fix:** Apply sane upper bounds to each field (e.g., capacity ≤ 10⁹, latency ≤ 60_000ms, timeout ≤ 60_000ms). The runner-input clamp pattern from round 1 already exists — extend it to `NumberField`/`SliderField` defaults.

### R3-6. Edges allow logically-invalid graphs but provide no UI feedback

I tried connecting `Database.right` → `Client.left` (a cycle) and `Client.right` → `Client.left` (a self-loop). Neither connection was created — no edge appeared after the drop. **Good.** But there was no UI feedback either: no toast, no flash, no error in the console. The user just sees nothing happen and may keep trying.

**Fix:** When a connection is rejected, flash the source/target handle red briefly, or surface a toast: "Cycles aren't supported in v1" / "Can't connect a node to itself".

---

## P1 — UX

### R3-7. Build-mode palette still overlaps the leftmost canvas node on demo loads

Round-2 R-8 was supposed to auto-fitView when entering Build mode on a demo design. Today, navigating to `/app?demo=cache-stampede` and switching to Build still leaves the Client node largely hidden behind the palette panel (only "200 RPS" peeks out on the right edge of the palette).

Looking at the React Flow viewport coords, the palette overlay is `left: 0, width: ~155px, position: absolute`, while the Client node sits around `x=240`. The first ~145px of the canvas content are still covered.

**Fix possibilities:**
- Have the Build mode start with the palette in collapsed state for designs whose leftmost node is too close to the canvas origin.
- Or: shift the React Flow `defaultViewport.x` by `+palette_width` when in Build mode.
- Or: make the palette a sidebar that pushes the canvas instead of overlaying it.

### R3-8. Restored share-link title duplicates "Demo:" prefix

Repro:
- `/app?demo=cache-stampede` → title: `sysdraw · Cache stampede`
- Click Share → copy URL → paste into a fresh tab → title: `sysdraw · Demo: Cache stampede`

The "Demo:" prefix lives in the design name (`Demo: Cache stampede`); when navigating via `?demo=cache-stampede` the title hook appears to strip it, when navigating via `?d=...` it doesn't.

**Fix:** In `useDocumentHead`, format the title with the same prefix-stripping logic regardless of which URL form was used to load the design.

### R3-9. Stray "25" appears below the Notes section in the inspector

Repro: click any node or edge → look at the inspector. After the `NOTES` heading the body of the inspector ends, but the document text immediately afterward contains `25` (a numeric label that bleeds in from somewhere — possibly the latency-chart axis or the chaos-timeline tick).

This was visible in three different inspector queries during this round (Client, Cache, Database). It's not user-facing damage exactly, but it shows up in `innerText` and probably under a screen reader.

**Fix:** Bound the inspector's reading order with proper `aria-` containment so unrelated chart text doesn't bleed in. Or use a positioned-absolute layer for the chart that's taken out of the document flow.

---

## P2 — share-link payload size

### R3-10. Share URLs are very long even for small designs

The cache-stampede design (3 nodes, 2 edges, 1 chaos event) produces a share URL of **1346 characters** under `?d=`. That's encoded gzipped JSON, so the design data itself is somewhere around 3–4 KB raw.

Real-world impact:
- Slack truncates link previews above ~2000 chars and may render unfurls weirdly.
- Email clients have varying URL-length tolerances.
- Some CDNs/proxies cap URLs at 2048–4096 chars; those will reject the link entirely.

For larger designs (say network-partition with 6 nodes, plus a couple of chaos events), the URL will likely exceed 2 KB. Thundering-herd with its 10 clients almost certainly does.

**Fix options:**
- Server-side store: generate a short slug, persist the JSON server-side, share `/s/abc123`. (Adds infra, but solves it cleanly.)
- Compression: confirm you're using `lz-string` URL-safe (it looks like that's already in use given the `N4Ig…` prefix). Try a more aggressive base+dictionary on the JSON shape (since it's structured: nodes/edges/chaos).
- Field stripping: strip default values from the design before encoding (`maxConcurrent: 100` is the default; don't serialize it).

---

## P3 — minor

### R3-11. Pause button doesn't appear during 1× run on the default 5s duration

After R-10's batched streaming, a 5s sim at 1× completes so quickly that the `Pause` button never has time to render. I couldn't catch it during 1×, 2×, 5×, or 10× speeds without bumping duration to 30s+. Either:
- Acknowledge that "Pause" is only useful for 30s+ sims and document/disable accordingly, or
- Slow the streaming playback so the button is reachable for any duration. (Probably not what users want; they want fast results.)

Not a bug per se, but the Pause button is design surface that's effectively dead at the default settings.

### R3-12. Reset button preserves chaos schedule (good) but doesn't reset the playback timer until a new run starts

After Reset, state correctly transitions to `IDLE` and `arrived = 0`. But `t = 4.50s` (or wherever the prior run ended) stays in the top right until you click Run again. Cosmetic; not blocking anything.

---

## What I tested and found working

- Different seeds produce different digests (e.g. seed 7 → `7c9b694553be3` vs seed 42 → `167595fc558002` for cache-stampede). So the seed *is* affecting the engine; it just doesn't fully *control* it.
- Edge inspector populates correctly (Kind dropdown, Network/Retry/CB/Idempotent sections).
- Edge dropdown options: Sync RPC / Async Message / Replication.
- Retry policy options: None / Fixed delay / Exponential backoff (consistent across edge and Client node).
- Database subtype: Relational / Key-Value / Document.
- Database replication: Synchronous / Asynchronous.
- Database read routing: Primary only / Replica only / Mixed (50/50).
- Cache eviction policy: LRU / LFU / FIFO.
- Cycle/self-loop attempts are silently rejected (no graph corruption).
- Share-link round-trip restores the full design, all 3 nodes, all chaos events. Survives a hard navigation.
- Reset cleanly returns the runner to `IDLE` with chaos events intact.
- All clamps from rounds 1–2 still hold (chaos `at`/`duration`/`multiplier`, runner `seed`/`duration`/`rps`).

---

If you want, I can stack-rank these for fix order (R3-1 first, by a wide margin) or pull a small repro for R3-1 that you can drop into a test.
