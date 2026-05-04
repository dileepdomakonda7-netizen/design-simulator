# Progress

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

(The prompt's per-component commit chunking was collapsed at the UI step because the components are tightly coupled — every panel imports from `useSimStore` and a single broken store breaks the whole layout. Each panel is still cleanly separable in its own file.)

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
