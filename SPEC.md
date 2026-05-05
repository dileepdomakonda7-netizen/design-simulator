# sysdraw — SPEC.md

> **Status**: v1 specification. This document is the contract for everything built next.  
> **Last updated**: 2026-05-03  
> **Schema version**: 1

---

## 1. Project Overview

sysdraw is a browser-based system design and distributed systems simulation tool built for one person to learn by doing. The core loop is: draw a distributed architecture (or import one from an image or sketch), configure how traffic arrives and where failures occur, run a discrete-event simulation, then inspect exactly why latency spikes, queues back up, or cascading failures happen — and iterate. It targets desktop Chrome, Firefox, and Safari (latest). There is no server, no account, no sharing, and no other user. Designs persist to `localStorage` and export as self-contained JSON files. The tool exists so that building the simulator itself is the learning exercise, and watching your own designs behave under load makes the theory concrete.

**Non-goals (permanent, not deferred):** user accounts, authentication, any server-side component, team features, sharing or collaboration, monetization, analytics, SEO, landing page, mobile or touch support, offline-first / PWA behavior, accessibility compliance beyond basic keyboard nav, internationalization.

---

## 2. User Workflows

### Workflow 1 — Build a design from scratch

1. Open the app. Default mode is **Build**.
2. Drag a component type from the left palette onto the canvas (e.g., `client`, `load_balancer`, `app_server`, `database`).
3. A node appears at drop position with default params for that type and a generated label.
4. Click the node to open the right inspector panel. Edit label, notes, and all type-specific params.
5. Draw an edge by hovering a node's output handle, clicking, and dragging to another node's input handle. Select edge kind (`sync_rpc`, `async_message`, `replication`) and configure timeout, retry policy, circuit breaker.
6. Repeat until the topology is complete.
7. Optionally activate the pen tool to add annotations (circles, arrows, notes) on the annotation layer.
8. The design auto-saves to `localStorage` on every change. Optionally export to JSON via the file menu.

### Workflow 2 — Sketch then parse

1. Switch to **Sketch mode** via the top mode toggle.
2. Draw the architecture freehand on the full-canvas surface using the pen tool. Use eraser or clear as needed.
3. When satisfied, click **Parse to graph**.
4. The sketch is rasterized to PNG and sent through the vision parsing pipeline.
5. The side-by-side review dialog appears: original sketch on the left, parsed structured graph on the right.
6. Review each detected node and edge. Edit labels and types, remove false positives, add missed components.
7. Click **Accept**. The structured graph layer is replaced by the parsed graph (a confirmation prompt appears if the canvas was non-empty).
8. Optionally retain the original sketch as a background reference annotation.
9. The mode switches back to Build automatically.

### Workflow 3 — Import from image

1. In **Build mode**, open the file menu → **Import image**.
2. Select a PNG, JPG, SVG, or `.excalidraw` file (whiteboard photo, blog screenshot, Excalidraw export, etc.).
3. The vision parsing pipeline runs on the image.
4. The same side-by-side review dialog as Workflow 2 appears.
5. Review, edit, accept or reject.
6. On accept, the structured graph replaces (or is merged into) the canvas with confirmation if non-empty.

### Workflow 4 — Run a simulation

1. From **Build mode**, click **Simulate** in the toolbar. The mode switches to **Simulate**.
2. In the traffic config panel, define one or more traffic sources: pick an entry-point node (typically `client` or `cdn`), choose a load shape (constant, ramp, spike, etc.), set RPS and duration.
3. Optionally open the chaos timeline and schedule chaos events at specific virtual timestamps: node crash, network partition, traffic spike, cache-miss storm.
4. Set simulation duration and speed (0.1×–10×). Optionally set a random seed for reproducibility.
5. Click **Play**. The simulation runs in a Web Worker. The canvas shows nodes in their current state (up/down). Metric panels update in real time: throughput, p50/p95/p99 latency, error rate, queue depth — per node and globally.
6. Observe. When something interesting happens (latency spike, error surge, queue growth), pause.
7. Click a spike or anomaly in a metric chart. The event inspector opens and shows the events in that time window.
8. In the inspector, click any event to walk its cause chain backwards — from symptom to root cause, event by event.
9. Exit Simulate mode (returns to Build). Adjust node params or topology. Re-run. Compare.
10. Optionally export the simulation run (event log + config + design snapshot) as JSON for later replay.

---

## 3. Canvas Architecture — Three Layers

The canvas in Build mode is composed of two simultaneous layers plus a separate full-screen mode. They are not interchangeable — each has a distinct role.

### Layer 1 — Structured graph layer (React Flow)

The only representation the simulator consumes. Contains `Node` and `Edge` objects conforming to the canonical schema (Section 5). Rendered by React Flow with custom node components that use `rough.js` for the sketchy aesthetic. This layer handles all interaction: drag to move nodes, click to select, draw edges. It is always present in Build mode.

### Layer 2 — Freehand annotation layer

A transparent `<svg>` element rendered absolutely positioned on top of the structured graph layer but below React Flow's node interaction surface (z-index ordered so SVG receives no pointer events when the pen tool is inactive). Activated by a pen-tool toggle button in the toolbar. While the pen tool is active, pointer events are captured by the SVG and React Flow node interaction is suspended. Strokes are drawn using `perfect-freehand` and stored as `Annotation` objects in the design. Annotations are saved with the design, displayed on load, but never read by the simulator. Use cases: circling hot paths, drawing cloud/region boundaries, scribbling latency numbers as reminders, annotating failure domains. Deactivating the pen tool restores full node interaction.

### Sketch mode (separate full-canvas view, not a layer)

A completely separate view, not a layer on top of Build mode. Entered via the top-level mode toggle. Replaces the entire canvas area with a full-screen freehand drawing surface — no React Flow, no structured graph visible (unless the user has retained a prior sketch as a reference). The pen/eraser/clear toolbar is the only UI. The "Parse to graph" button in this view triggers the vision pipeline. Sketch strokes are stored as `Sketch` objects. On accept, the resulting structured graph replaces the Build-mode canvas.

### Aesthetic: sketchy / hand-drawn everywhere

The hand-drawn aesthetic applies uniformly across all surfaces:

- **Structured nodes**: rendered with `rough.js` (`roughness: 1.2`, `bowing: 1`, `stroke: #1a1a1a`, fill with a subtle hatching). Each component type has a distinctive icon rendered in sketchy line-art style inside the node body.
- **Annotation strokes**: `perfect-freehand` with pressure simulation for a natural pen feel.
- **Sketch mode**: same `perfect-freehand` configuration.
- **Fonts**: Caveat (self-hosted from Google Fonts) for all labels and UI text within the canvas. Tailwind handles app chrome fonts separately.
- **Icons per type**: hand-drawn line-art icons — cylinder for database, stack of boxes for queue, shield/funnel for load balancer, lightning bolt for api_gateway, cloud for cdn/object_storage, lightning-struck server for external_service, etc. Defined as SVG paths, rendered via rough.js or as plain SVG overlaid on the rough rectangle.

---

## 4. Modes

A single top-level mode toggle (three segments) governs what the canvas shows and what actions are available. Only one mode is active at a time.

| Mode | Canvas content | Primary actions |
|------|---------------|-----------------|
| **Build** | Structured graph + annotation layer | Drag nodes, draw edges, edit params, annotate |
| **Sketch** | Freehand drawing surface | Draw, erase, clear, Parse to graph |
| **Simulate** | Read-only structured graph | Play/pause/speed, traffic config, chaos timeline, metric panels, event inspector |

**Mode transitions:**
- Build ↔ Sketch: always safe; switching to Sketch retains the current structured graph; switching back to Build restores it.
- Build → Simulate: validates the design (at least one node, at least one traffic source configured); switches to read-only.
- Simulate → Build: always allowed; stops any running simulation first.
- Sketch → Simulate: not a direct transition; user must Parse to graph first (returning to Build), then enter Simulate.

---

## 5. Canonical Graph Schema

Every input path — drag-and-drop, sketch parse, image import, JSON import — must produce a `Design` conforming to this schema. The simulator is written against this schema only and has no knowledge of how a design was created.

```typescript
// src/schema/types.ts

// ─── Enumerations ───────────────────────────────────────────────────────────

export type ComponentType =
  | 'client'
  | 'load_balancer'
  | 'api_gateway'
  | 'app_server'
  | 'cache'
  | 'database'
  | 'queue'
  | 'pub_sub'
  | 'cdn'
  | 'object_storage'
  | 'external_service';

export type EdgeKind = 'sync_rpc' | 'async_message' | 'replication';

export type DatabaseSubtype = 'relational' | 'kv' | 'document';
export type EvictionPolicy = 'lru' | 'lfu' | 'fifo';
export type ReplicationMode = 'sync' | 'async';
export type DeliveryGuarantee = 'at_most_once' | 'at_least_once' | 'exactly_once';
export type LoadBalancerAlgorithm =
  | 'round_robin'
  | 'least_connections'
  | 'random'
  | 'consistent_hash';

// ─── Edge behavior primitives ────────────────────────────────────────────────

export type RetryPolicy =
  | { kind: 'none' }
  | { kind: 'fixed'; max_retries: number; delay_ms: number }
  | {
      kind: 'exponential_backoff';
      max_retries: number;
      base_delay_ms: number;
      max_delay_ms: number;
      jitter: boolean;
    };

export interface CircuitBreakerConfig {
  enabled: boolean;
  failure_threshold: number;     // 0–1 fraction of errors that opens the circuit
  success_threshold: number;     // consecutive successes in half-open state to close
  half_open_timeout_ms: number;  // wait before transitioning open → half-open
}

// ─── Per-component-type param objects ────────────────────────────────────────

export interface ClientParams {
  rps: number;                   // steady-state requests per second
  think_time_ms: number;         // pause between requests per virtual client
  timeout_ms: number;            // client-side request timeout
  retry_policy: RetryPolicy;
}

export interface LoadBalancerParams {
  algorithm: LoadBalancerAlgorithm;
  max_connections: number;       // total concurrent connections across all upstreams
  health_check_interval_ms: number;
  failure_rate: number;          // 0–1 probability this node itself fails per request
}

export interface ApiGatewayParams {
  rate_limit_rps: number;        // 0 = unlimited
  auth_overhead_ms: number;      // fixed latency added to every request
  timeout_ms: number;
  failure_rate: number;
}

export interface AppServerParams {
  instances: number;             // horizontal replicas; load balanced round-robin by default
  max_concurrent_per_instance: number;
  latency_ms_p50: number;        // processing time distribution (log-normal)
  latency_ms_p99: number;
  failure_rate: number;
}

export interface CacheParams {
  hit_rate: number;              // 0–1; applied before upstream lookup
  capacity_items: number;        // used for display; v2 will model eviction dynamically
  eviction_policy: EvictionPolicy;
  read_latency_ms_p50: number;
  read_latency_ms_p99: number;
  failure_rate: number;
}

export interface DatabaseParams {
  subtype: DatabaseSubtype;
  replicas: number;              // total nodes including primary
  read_capacity_rps: number;     // beyond this the node saturates and latency degrades
  write_capacity_rps: number;
  replication_mode: ReplicationMode;
  replication_lag_ms_p50: number;  // meaningful only when mode = 'async'
  replication_lag_ms_p99: number;
  read_latency_ms_p50: number;
  read_latency_ms_p99: number;
  write_latency_ms_p50: number;
  write_latency_ms_p99: number;
  failure_rate: number;
}

export interface QueueParams {
  max_depth: number;             // 0 = unbounded; > 0 = bounded, excess rejected
  consumer_processing_rps: number;
  visibility_timeout_ms: number;
  delivery_guarantee: DeliveryGuarantee;
  failure_rate: number;
}

export interface PubSubParams {
  subscriber_count: number;
  delivery_latency_ms_p50: number;
  delivery_latency_ms_p99: number;
  failure_rate: number;
}

export interface CdnParams {
  hit_rate: number;              // 0–1
  edge_latency_ms_p50: number;
  edge_latency_ms_p99: number;
  origin_pull_timeout_ms: number;
  failure_rate: number;
}

export interface ObjectStorageParams {
  read_latency_ms_p50: number;
  read_latency_ms_p99: number;
  write_latency_ms_p50: number;
  write_latency_ms_p99: number;
  throughput_mbps: number;
  failure_rate: number;
}

export interface ExternalServiceParams {
  latency_ms_p50: number;
  latency_ms_p99: number;
  failure_rate: number;
  timeout_ms: number;
  rate_limit_rps: number;        // 0 = no limit enforced by this service
}

// Discriminated union mapping ComponentType → its params object.
// A Node carries { type, params } and TypeScript enforces the pairing.
export type TypedNodeParams =
  | { type: 'client';           params: ClientParams }
  | { type: 'load_balancer';    params: LoadBalancerParams }
  | { type: 'api_gateway';      params: ApiGatewayParams }
  | { type: 'app_server';       params: AppServerParams }
  | { type: 'cache';            params: CacheParams }
  | { type: 'database';         params: DatabaseParams }
  | { type: 'queue';            params: QueueParams }
  | { type: 'pub_sub';          params: PubSubParams }
  | { type: 'cdn';              params: CdnParams }
  | { type: 'object_storage';   params: ObjectStorageParams }
  | { type: 'external_service'; params: ExternalServiceParams };

// ─── Core schema objects ─────────────────────────────────────────────────────

// Node is a discriminated union via intersection with TypedNodeParams.
// When node.type === 'database', TypeScript narrows node.params to DatabaseParams.
// Every behavior file in src/sim/behaviors/ relies on this narrowing — do not
// collapse back to an interface with a union params field.
export type Node = {
  id: string;
  position: { x: number; y: number };
  label: string;
  notes: string;                 // free-text; shown in inspector; ignored by simulator
} & TypedNodeParams;

export interface Edge {
  id: string;
  source: string;                // Node id
  target: string;                // Node id
  kind: EdgeKind;
  label?: string;
  params: {
    network_latency_ms_p50: number; // one-way wire latency added on request_send
    network_latency_ms_p99: number; // sampled log-normal, same as node latency
    timeout_ms: number;
    retry_policy: RetryPolicy;
    circuit_breaker: CircuitBreakerConfig;
    idempotent: boolean;         // v2 exactly-once / deduplication; stored in v1 but unused by engine
  };
}

export interface Annotation {
  id: string;
  kind: 'stroke' | 'text' | 'shape';
  data: unknown;                 // perfect-freehand stroke points | string | shape descriptor
  layer: 'annotation';          // always 'annotation'; discriminates from Sketch
  createdAt: string;             // ISO 8601
}

export interface Sketch {
  id: string;
  strokes: unknown[];            // raw perfect-freehand InputPoint[][] arrays
  createdAt: string;             // ISO 8601
  parsedAt?: string;             // set when submitted to vision pipeline; null if never parsed
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface Design {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: string;             // ISO 8601
  updatedAt: string;             // ISO 8601
  nodes: Node[];
  edges: Edge[];
  annotations: Annotation[];
  sketches: Sketch[];            // all sketches ever drawn; last one is the current sketch
  viewport: Viewport;
}
```

**Zod validators** mirror every interface and are the authoritative parse/validate layer used by persistence and the vision pipeline. They live in `src/schema/validators.ts`. The simulator imports only the TypeScript types, not the validators.

**Default params** for each component type live in `src/schema/defaults.ts`. Every new node is initialized from these defaults. Concrete numeric values are chosen at implementation time; the shape defined above is fixed.

---

## 6. Simulation Engine — Architecture

### Discrete-event simulation (DES)

The engine is a classical discrete-event simulator. Time is virtual (measured in milliseconds from simulation start) and advances by processing events in order. There is no real-time loop, no `setInterval`, no `requestAnimationFrame` inside the worker. The engine runs as fast as the CPU allows; the speed multiplier controls how snapshots are throttled to the UI, not how fast the engine runs.

**Core data structure**: a min-heap priority queue keyed by `virtualTime`. Each iteration pops the minimum-time event, advances the clock to that event's time, and executes the event's handler. Handlers may enqueue zero or more future events.

### Event schema

```typescript
// src/sim/types.ts

export type SimEventType =
  | 'request_arrival'
  | 'request_enqueue'
  | 'request_dequeue'
  | 'request_send'
  | 'request_receive'
  | 'request_complete'
  | 'request_timeout'
  | 'request_retry'
  | 'request_reject'          // bounded queue overflow, rate limit, or saturated node
  | 'node_failure'
  | 'node_recover'
  | 'node_degraded'           // v2 partial failure; field reserved in schema
  | 'partition_start'
  | 'partition_end'
  | 'replication_apply'
  | 'circuit_breaker_open'
  | 'circuit_breaker_half_open'
  | 'circuit_breaker_close'
  | 'cache_miss_storm_start'
  | 'cache_miss_storm_end'
  | 'traffic_spike_start'
  | 'traffic_spike_end';

export interface SimEvent {
  id: string;                   // UUIDv4; unique across the entire run
  type: SimEventType;
  virtualTime: number;          // ms since simulation start
  nodeId?: string;              // node this event occurred at
  requestId?: string;           // which request this event belongs to
  edgeId?: string;              // edge traversed, for send/receive events
  causeEventId?: string;        // event id that directly triggered this one (null = root)
  causalContext?: string;       // v1: always undefined; v2: per-request causal token
  payload: Record<string, unknown>; // type-specific fields, e.g. { latency_ms, status_code }
}

export interface SimRequest {
  id: string;
  originNodeId: string;
  trafficSourceId: string;
  arrivedAt: number;            // virtualTime of request_arrival
  completedAt?: number;
  failedAt?: number;
  timedOutAt?: number;
  rejectedAt?: number;
  totalLatency_ms?: number;
  hopLog: string[];             // ordered list of node ids visited
  causalContext?: string;       // v2 placeholder
}
```

### Causality and the event inspector

Every event carries `causeEventId`. A `request_timeout` causes a `request_retry` which causes another `request_send`, and so on. Root events (traffic arrivals, chaos events) have `causeEventId: undefined`. Given any event, the inspector walks the chain by following `causeEventId` backwards to the root, displaying a linear cause chain. The event log is indexed by `id` on the main thread for O(1) chain traversal.

### Determinism

The same `(design, trafficConfig, chaosConfig, seed)` tuple must produce an identical event log every run. A seeded PRNG (`mulberry32`, 32-bit, 4-byte state — see Section 16) is instantiated at simulation start with the provided seed. Every random choice in the engine (inter-arrival time, latency sample, failure roll, backoff jitter) consumes from this single PRNG in deterministic order. There is no `Math.random()` anywhere in `src/sim/`.

### Latency sampling

Node latency is modeled as log-normal, parameterized by P50 and P99 from the node's params. Given `p50` and `p99`:

```
μ = ln(p50)
σ = (ln(p99) − ln(p50)) / 2.326   // 2.326 = z-score of 99th percentile
```

Sample: `X = exp(μ + σ × Z)` where `Z` is a standard normal variate drawn from the PRNG via Box-Muller. This matches real service latency distributions and is tunable per node via P50/P99 alone.

### Edge traversal latency (network latency)

Every edge carries `network_latency_ms_p50` and `network_latency_ms_p99` in its params. When the engine processes a `request_send` event, it samples a network latency from the log-normal distribution defined by those two values and schedules the corresponding `request_receive` event at `virtualTime + sampledNetworkLatency`. This models the one-way wire cost between two services. The default for intra-datacenter edges is p50=1ms / p99=5ms; cross-region defaults are p50=60ms / p99=120ms. Concrete defaults are set in `src/schema/defaults.ts`. Network latency is **not** zero by default — omitting it would make cross-region designs silently look identical to local ones.

### Web Worker and message protocol

The engine runs entirely inside a Web Worker. The main thread communicates via **Comlink** (typed RPC over `postMessage`).

```typescript
// Messages from main thread → worker
interface SimulationRequest {
  design: Design;
  trafficSources: TrafficSource[];
  chaosPlan: ChaosEventSpec[];
  duration_ms: number;
  seed: number;
  snapshotInterval_virtual_ms: number; // default: 100
}

// Messages from worker → main thread (streamed during run)
interface SimulationSnapshot {
  virtualTime: number;
  nodeStates: Record<string, NodeSnapshot>;
  windowMetrics: WindowMetrics;   // aggregated over last snapshotInterval window
}

interface NodeSnapshot {
  nodeId: string;
  state: 'up' | 'down' | 'degraded';  // 'degraded' reserved for v2
  queue_depth: number;
  in_flight: number;
  throughput_rps: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  error_rate: number;             // 0–1 fraction of requests in this window
}

interface WindowMetrics {
  total_arrivals: number;
  total_completed: number;
  total_failed: number;
  total_timed_out: number;
  total_rejected: number;
  global_p50_ms: number;
  global_p95_ms: number;
  global_p99_ms: number;
}

// Final message when simulation completes
interface SimulationResult {
  eventLog: SimEvent[];
  requestLog: SimRequest[];
  finalMetrics: WindowMetrics;
}
```

The worker exposes `{ start, pause, resume, stop }`. On `stop` or natural completion, it sends the full `SimulationResult` once — the event log is not streamed incrementally to keep message overhead low.

### Node behavior as a state machine

Each node type has a state machine with these states in v1: `up | down`. In v2, `degraded` (high-latency, elevated-error, slow-disk) states slot in. Node state is consulted before every event handler executes. A `down` node rejects all incoming requests immediately (produces `request_reject` events with payload `{ reason: 'node_down' }`). The state machine is the only place node state transitions happen, ensuring v2 partial failure states require only adding new states and transitions, not changing request routing logic.

### Queue objects

Each node that queues requests (app_server, queue, pub_sub) owns a `Queue` object with:
- `maxDepth: number` (0 = unbounded)
- `policy: 'drop' | 'block'` — in v1 always `'drop'` (excess rejected); v2 adds backpressure
- `enqueue(requestId): boolean` — returns false if full
- `dequeue(): string | undefined`
- `depth(): number`

Queues are objects (not raw arrays) so bounded-queue-with-rejection-policy drops in v2 without touching request routing.

### v1 engine scope

The v1 engine simulates: request routing, per-node queueing, capacity-based saturation (latency degrades beyond rated RPS), tail latency sampling, per-edge timeouts, retry policies (none/fixed/exponential-backoff-with-jitter), basic circuit breakers (closed/open/half-open), node failures (up/down), network partitions (requests crossing a partition boundary get `request_reject` with `{ reason: 'partition' }`), cache hit/miss routing, replication event scheduling.

---

## 7. Realism Roadmap

### v1 — Mid-level (built in Phase 3)

Queueing with bounded capacity and drop-on-overflow, tail latency via log-normal P50/P99, retries with backoff and jitter, timeouts, circuit breakers (closed/open/half-open), basic node failures (up/down), network partitions, cache hit/miss routing, replication event emission (no consistency model enforcement yet).

### v2 — Deep features (Phase 6, one concept per weekend)

Each v2 feature is a self-contained addition that slots into v1 scaffolding without rewrites:

| Feature | Slots into |
|---------|-----------|
| **Backpressure** | Queue objects gain a `'block'` policy; upstream nodes receive `request_enqueue` that suspends until space; rejection propagates upstream | Queue object pluggable policy |
| **Partial failures** | Node state machine gains `degraded` states; `degraded` nodes sample from elevated-latency or elevated-error distributions | Node state machine |
| **Replication lag** | Replication events carry lag sampled from P50/P99; reads from async replicas may return stale data events | `replication_apply` events already emitted |
| **Consistency models** | `causalContext` field on `SimRequest` tracks per-request session tokens; reads checked against replica lag | `causalContext` field reserved in v1 |
| **Circuit breakers (tunable)** | v1 circuit breakers are basic; v2 adds configurable window size, sliding vs. count-based thresholds | `CircuitBreakerConfig` already on every edge |

The contract: v2 features must not change `SimEvent`, `SimRequest`, `Design`, or the worker message protocol. They may add new `SimEventType` values.

---

## 8. Traffic Generation — v1

Traffic is entirely synthetic. No trace replay in v1 (deferred to v3).

### Load shapes

```typescript
export type LoadShape =
  | { kind: 'constant'; rps: number }
  | { kind: 'ramp'; start_rps: number; end_rps: number; duration_ms: number }
  | { kind: 'step'; steps: Array<{ at_ms: number; rps: number }> }
  | { kind: 'spike'; base_rps: number; spike_rps: number; at_ms: number; duration_ms: number }
  | { kind: 'sine'; base_rps: number; amplitude_rps: number; period_ms: number }
  | { kind: 'random_burst'; base_rps: number; burst_probability: number; burst_multiplier: number; burst_duration_ms: number };
```

### Traffic source

```typescript
export interface TrafficSource {
  id: string;
  label: string;
  target_node_id: string;      // must be a node in the design (typically 'client' or 'cdn')
  load_shape: LoadShape;
  // No per-source seed field. PRNG state for each source is derived deterministically
  // from the global seed and the source's index in the TrafficSource array:
  //   sourceSeed = mulberry32(globalSeed ^ fnv1a32(source.id))
  // One global seed → one button → reproducible run. Users never configure per-source seeds.
}
```

Multiple traffic sources may target different entry points simultaneously. Inter-arrival times are sampled from a Poisson process (exponential inter-arrival with rate = current RPS from the load shape). The load shape function is evaluated at each inter-arrival scheduling step to handle dynamic RPS.

---

## 9. Chaos Injection — v1

**Two distinct types — do not confuse them:**

- `ChaosEventSpec` is the **user-facing config** stored in the design and edited in the chaos timeline UI. It describes what should happen and when.
- `SimEvent` is the **engine-internal event** placed on the priority queue. Chaos specs are compiled into SimEvents once at simulation init, before the event loop starts.

Each `ChaosEventSpec` compiles into one or two `SimEvent`s: a start event (e.g. `node_failure` at `at_ms`) and, where applicable, a paired end event (e.g. `node_recover` at `at_ms + duration_ms`). Once on the queue, these events are indistinguishable from organic events — the engine processes them in virtual time order with no special casing.

`ChaosEventSpec` objects are stored on `SimulationRequest.chaosPlan`. The compiled `SimEvent`s exist only inside the worker during a run.

```typescript
export type ChaosEventSpec =
  | {
      kind: 'node_crash';
      node_id: string;
      at_ms: number;
      duration_ms: number;       // recovery is scheduled at at_ms + duration_ms
    }
  | {
      kind: 'network_partition';
      partition_a: string[];     // node ids in partition A
      partition_b: string[];     // node ids in partition B
      at_ms: number;
      duration_ms: number;
    }
  | {
      kind: 'traffic_spike';
      multiplier: number;        // applied to all active traffic sources
      at_ms: number;
      duration_ms: number;
    }
  | {
      kind: 'cache_miss_storm';
      node_id: string;           // must resolve to a 'cache' node
      at_ms: number;
      duration_ms: number;       // forces hit_rate = 0 for this window
    };
// 'node_degraded' is v2
```

The chaos timeline UI is a scrubber showing virtual time on the x-axis. The user drags chaos event blocks onto the timeline and configures them via a popover. Multiple chaos events of different kinds may overlap.

---

## 10. UI Surfaces (v1)

### Top toolbar (always visible)

- **Mode toggle**: [Build] [Sketch] [Simulate] — segmented control
- **File menu**: New design, Save (manual trigger, though auto-save runs continuously), Load (opens design list from localStorage), Import image, Export JSON
- **Undo / Redo**: keyboard shortcuts `⌘Z` / `⌘⇧Z`; visible buttons for discoverability
- **Design name**: inline editable text field

### Build mode layout

```
┌──────────────────────────────────────────────────────────────────────┐
│  [toolbar]                                                           │
├──────────┬───────────────────────────────────────────┬──────────────┤
│ Palette  │                                           │  Inspector   │
│          │          React Flow Canvas                │              │
│ client   │    (structured graph + annotation layer)  │  (selected   │
│ lb       │                                           │  node/edge   │
│ gateway  │                                           │  params)     │
│ server   │                                           │              │
│ cache    │                                           │  [pen tool   │
│ db       │                                           │   toggle]    │
│ queue    │                                           │              │
│ pubsub   │                                           │              │
│ cdn      │                                           │              │
│ storage  │                                           │              │
│ external │                                           │              │
└──────────┴───────────────────────────────────────────┴──────────────┘
```

- **Palette**: draggable component type tiles with sketchy icons. Drag to canvas creates a node.
- **Inspector**: shows params for the selected node (all type-specific fields) or edge (kind, timeout, retry policy, circuit breaker). Empty state when nothing selected.
- **Pen tool toggle**: button in inspector footer (or toolbar). Activates annotation layer; suspends node interaction.

### Sketch mode layout

Full-canvas drawing surface. Toolbar:
- Pen / Eraser / Clear
- Stroke width selector (thin / medium / thick)
- **Parse to graph** button (primary action, always visible)
- Back to Build (mode toggle)

### Simulate mode layout

```
┌──────────────────────────────────────────────────────────────────────┐
│  [toolbar: mode toggle, file menu]   [▶ Play] [⏸] [Speed: 1×—]      │
├──────────────┬────────────────────────────────┬─────────────────────┤
│ Traffic      │                                │  Metrics            │
│ Config       │    Read-only graph canvas      │  (global + per node)│
│              │    (nodes show live state:     │                     │
│ [sources     │     up/down color)             │  [charts: Recharts] │
│  editor]     │                                │                     │
├──────────────┤                                ├─────────────────────┤
│ Chaos        │                                │  Event Inspector    │
│ Timeline     │                                │  (click chart spike │
│              │                                │   to populate)      │
└──────────────┴────────────────────────────────┴─────────────────────┘
```

- **Simulation controls**: Play / Pause / Stop, speed slider (0.1× to 10×), duration input, seed input.
- **Traffic config panel**: list of traffic sources. Add/remove/edit per source. Can be edited before starting; read-only while running.
- **Chaos timeline**: horizontal scrubber across simulation virtual time. Drag chaos event blocks onto it; click to configure; events execute at their scheduled virtual time.
- **Metric panels** (Recharts time-series charts): Global throughput, global p50/p95/p99 latency, global error rate. Per-node panel (one per node): queue depth, in-flight, p99 latency, state indicator. All x-axes share virtual time.
- **Event inspector**: opened by clicking any point/spike in any metric chart. Shows all `SimEvent`s in the clicked time window, grouped by event type. Click any event to expand its cause chain (walk `causeEventId` to root). Each event shows: type, virtualTime, nodeId, requestId, payload fields.

---

## 11. Persistence

### Auto-save

Every change to the `Design` in the Zustand store triggers a debounced (500ms) write to `localStorage` under the key `design:{id}`. A separate `localStorage` key `designs_index` holds `Array<{ id, name, updatedAt }>` for the load dialog.

**Undo interaction with auto-save**: undo and redo are mutations to the `Design` in the Zustand store, so they trigger the same debounced auto-save as any other change. This is intentional — after an undo the persisted state in `localStorage` reflects the post-undo design. There is no separate "undo buffer" that diverges from persisted state.

**Undo scope**: the undo/redo stack is **unified across all modes** (Build and Sketch share one history). Mode switches do not clear the stack. Switching from Sketch to Build and pressing undo may undo a stroke or a node edit depending on what happened last. The alternative (per-mode stacks) was rejected because it would create invisible state — you could undo out of the current mode's stack and have no recourse. A single stack is simpler to reason about and to implement with `zundo`.

### localStorage keys

| Key | Value |
|-----|-------|
| `design:{id}` | Full serialized `Design` (JSON) |
| `designs_index` | `Array<{ id: string; name: string; updatedAt: string }>` |
| `settings` | `{ anthropicApiKey: string }` |

### Export formats

| Format | Scope | Notes |
|--------|-------|-------|
| Design JSON | Full `Design` object, schema-versioned | Primary export/import format |
| Simulation run JSON | `{ design, trafficSources, chaosPlan, seed, duration_ms, eventLog, requestLog, finalMetrics }` | Exportable on demand from Simulate mode; not auto-saved |

### Import formats (v1)

| Format | Path |
|--------|------|
| Design JSON (`*.json`) | Direct parse via zod validator; replace current design |
| Image (`*.png`, `*.jpg`, `*.svg`) | Vision parsing pipeline → review dialog |

### Import formats (v3, deferred)

- `.excalidraw` JSON (v3): parse Excalidraw graph structure, map element types to ComponentTypes, no vision pipeline needed
- Mermaid diagram (v3): parse Mermaid graph syntax

### Schema versioning

The `schemaVersion` field on `Design` must be checked on every import. v1 imports only accept `schemaVersion: 1`. Future versions provide migration functions in `src/persistence/migrations.ts`.

---

## 12. Vision Parsing Pipeline

Used by both image import (Workflow 3) and "Parse to graph" from Sketch mode (Workflow 2).

### Input

An image in one of: PNG, JPG, SVG (rasterized to PNG before sending), or a sketch rasterized from the canvas via `HTMLCanvasElement.toBlob('image/png')`.

### Process

1. **Rasterize** (sketch only): render the current sketch strokes onto an offscreen `<canvas>`, export as PNG blob.
2. **Construct prompt**: system prompt establishes the task, the complete list of valid `ComponentType` values, the condensed `Node` (id, type, label only — no params) and `Edge` (source, target, kind, label only — no params) shapes, and strict output rules (JSON only, no prose). The prompt explicitly instructs the model **not** to emit params — topology and types are all that is requested. User message contains the image as base64 data.
3. **Call Anthropic API** using the browser-compatible Anthropic SDK with the API key from `localStorage['settings']`. Model is configured at implementation time (see Section 16).
4. **Extract JSON**: response is a raw JSON object with `{ nodes: ParsedNode[], edges: ParsedEdge[], parsedConfidence }` where `ParsedNode` has only `{ id, type, label }` and `ParsedEdge` has only `{ id, source, target, kind, label? }`. Extract and parse.
5. **Apply defaults**: for each parsed node, look up `defaults[node.type]` from `src/schema/defaults.ts` and merge to produce a full `Node`. For each parsed edge, merge edge defaults. The model never produces params — defaults are always the source of truth for numeric values.
6. **Validate**: run the zod `Design` validator against the assembled design.
7. **Confidence check**: if the model returns `parsedConfidence: 'low'` (a top-level field the prompt requests), or if zod validation catches structural errors (unrecognized type, malformed edge source/target), flag the result as low-confidence.

### Output and review dialog

The side-by-side review dialog is non-skippable:
- Left pane: the original image or rendered sketch.
- Right pane: the parsed graph rendered in React Flow (interactive — user can drag nodes, delete wrong ones, edit labels).
- Status banner: if low-confidence, shows a warning message.
- Actions: **Accept** (replaces canvas, with confirmation if non-empty), **Reject** (discard parse result, retain current design).

Accepted parsed designs are treated identically to hand-built ones — no parse provenance metadata is retained in the `Design` after accept.

### Failure modes

| Failure | Handling |
|---------|---------|
| No API key configured | Settings dialog opens automatically before the API call |
| Network error | Toast error, no dialog; user retries manually |
| Model returns non-JSON | Caught in extraction step; treated as low-confidence with empty graph |
| zod validation fails partially | Best-effort partial graph shown; missing fields filled with defaults from `src/schema/defaults.ts`; low-confidence banner |
| Model refuses (content policy) | Error toast; no dialog |

### Prompt constraints

The prompt must include:
- The exact list of `ComponentType` values (to constrain hallucination of unknown types)
- The condensed `ParsedNode` shape: `{ id: string, type: ComponentType, label: string }`
- The condensed `ParsedEdge` shape: `{ id: string, source: string, target: string, kind: EdgeKind, label?: string }`
- An explicit instruction: **do not emit params** — numeric values (latency, capacity, etc.) are filled client-side from defaults
- An instruction to return only JSON, no explanatory prose
- An instruction to include a top-level `parsedConfidence: 'high' | 'low'` field
- An instruction that if a component type is ambiguous, pick the closest match from the valid type list and set `parsedConfidence: 'low'`

---

## 13. Tech Stack

| Concern | Choice | Rationale |
|---------|--------|-----------|
| Build tool | Vite 6 | Fast HMR, first-class TypeScript, no config overhead |
| UI framework | React 18, strict TypeScript | Ecosystem fit for React Flow |
| Structured graph | React Flow (xyflow) v12 | Best-in-class node/edge canvas; handles viewport, handles, edge routing |
| Sketchy rendering | rough.js v4 | Mature library for hand-drawn SVG strokes; integrates with React Flow custom nodes |
| Freehand strokes | **perfect-freehand** | Produces pressure-sensitive, tapered strokes from pointer events; minimal footprint; produces clean `SVGPathElement` output that composites cleanly with rough.js nodes |
| State management | Zustand v5 | Simple, no boilerplate, easy undo/redo via `zustand/middleware` `temporal` |
| Metric charts | Recharts v2 | Composable React charts; good time-series support; acceptable bundle size |
| Worker bridge | Comlink v4 | Typed RPC over `postMessage`; eliminates manual message routing |
| LLM API | Anthropic SDK (browser build) | Direct browser calls; no backend; API key in localStorage |
| CSS | Tailwind CSS v4 | Utility-first; no runtime; scoped to app chrome (not canvas) |
| Schema validation | Zod v3 | TypeScript-first validators; used for import/export and vision parse output |
| Fonts | Caveat (self-hosted) | Handwriting style; available from Google Fonts; self-host to avoid external requests |
| **No** backend | — | Explicit non-goal |
| **No** database | — | localStorage only |
| **No** auth | — | Explicit non-goal |

**Note on perfect-freehand**: chosen over alternatives (Pressure.js, custom Bézier) because it produces the exact tapered, pressure-sensitive stroke aesthetic without requiring a drawing tablet — mouse pressure is simulated from pointer velocity. Output is a set of points suitable for rendering as a single `<path>` element. This integrates cleanly with the SVG annotation layer.

---

## 14. Repository Structure

```
design-simulator/
├── SPEC.md
├── index.html
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
├── tailwind.config.ts
├── public/
│   └── fonts/
│       ├── Caveat-Regular.woff2
│       └── Caveat-Bold.woff2
└── src/
    ├── main.tsx                    # React root, Zustand provider setup
    ├── App.tsx                     # Top-level mode router (Build / Sketch / Simulate)
    │
    ├── schema/                     # Canonical types — shared by canvas, sim, parsing
    │   ├── types.ts                # All TypeScript interfaces and type unions
    │   ├── defaults.ts             # Default params per ComponentType
    │   └── validators.ts           # Zod schemas; parse() and safeParse() helpers
    │
    ├── store/                      # Zustand stores
    │   ├── designStore.ts          # Current Design; undo/redo via temporal middleware
    │   ├── modeStore.ts            # Active mode ('build' | 'sketch' | 'simulate')
    │   └── simStore.ts             # Simulation state, snapshots, event log
    │
    ├── canvas/                     # Build mode canvas (React Flow)
    │   ├── DesignCanvas.tsx        # React Flow wrapper; wires nodes, edges, viewport
    │   ├── AnnotationLayer.tsx     # SVG overlay for freehand annotations
    │   ├── nodes/                  # One custom node component per ComponentType
    │   │   ├── BaseNode.tsx        # Shared rough.js frame + label + icon slot
    │   │   ├── ClientNode.tsx
    │   │   ├── LoadBalancerNode.tsx
    │   │   ├── AppServerNode.tsx
    │   │   ├── DatabaseNode.tsx
    │   │   ├── CacheNode.tsx
    │   │   ├── QueueNode.tsx
    │   │   ├── PubSubNode.tsx
    │   │   ├── CdnNode.tsx
    │   │   ├── ObjectStorageNode.tsx
    │   │   ├── ApiGatewayNode.tsx
    │   │   └── ExternalServiceNode.tsx
    │   ├── edges/
    │   │   └── SketchyEdge.tsx     # Custom edge with rough.js path stroke
    │   ├── palette/
    │   │   ├── Palette.tsx         # Left panel; draggable component tiles
    │   │   └── PaletteTile.tsx
    │   └── inspector/
    │       ├── Inspector.tsx       # Right panel; dispatches to per-type form
    │       ├── NodeInspector.tsx
    │       ├── EdgeInspector.tsx
    │       └── forms/              # One param form per ComponentType
    │
    ├── sketch/                     # Sketch mode
    │   ├── SketchCanvas.tsx        # Full-canvas perfect-freehand surface
    │   ├── SketchToolbar.tsx       # Pen / eraser / clear / Parse to graph
    │   ├── strokeUtils.ts          # perfect-freehand helpers; stroke → SVG path
    │   └── rasterize.ts            # Render strokes to offscreen canvas → PNG blob
    │
    ├── sim/                        # Simulation engine — runs inside Web Worker
    │   ├── worker.ts               # Comlink.expose({ start, pause, resume, stop })
    │   ├── engine.ts               # DES core: event loop, min-heap
    │   ├── minHeap.ts              # Min-heap priority queue
    │   ├── prng.ts                 # mulberry32 seeded PRNG
    │   ├── latency.ts              # Log-normal P50/P99 → sample; Box-Muller
    │   ├── traffic.ts              # LoadShape → inter-arrival time schedule
    │   ├── chaos.ts                # ChaosEventSpec → scheduled SimEvents
    │   ├── types.ts                # SimEvent, SimRequest, NodeSnapshot, etc.
    │   └── behaviors/              # Per-node-type request handling logic
    │       ├── client.ts
    │       ├── loadBalancer.ts
    │       ├── apiGateway.ts
    │       ├── appServer.ts
    │       ├── cache.ts
    │       ├── database.ts
    │       ├── queue.ts
    │       ├── pubSub.ts
    │       ├── cdn.ts
    │       ├── objectStorage.ts
    │       └── externalService.ts
    │
    ├── sim-ui/                     # Simulate mode UI — main thread only
    │   ├── SimulatePanel.tsx       # Top-level layout for Simulate mode
    │   ├── SimControls.tsx         # Play / pause / stop / speed slider
    │   ├── TrafficConfig.tsx       # Traffic source list and editor
    │   ├── ChaosTimeline.tsx       # Virtual-time scrubber + chaos event blocks
    │   ├── MetricsPanels.tsx       # Global + per-node Recharts charts
    │   └── EventInspector.tsx      # Cause chain viewer; populated on chart click
    │
    ├── parsing/                    # Vision parsing pipeline
    │   ├── visionPipeline.ts       # Orchestrates: rasterize → prompt → API → validate
    │   ├── prompt.ts               # Builds system + user prompt with schema injection
    │   └── responseParser.ts       # JSON extraction from LLM response + zod validation
    │
    ├── persistence/                # localStorage + import/export
    │   ├── designStorage.ts        # read/write/delete/list designs in localStorage
    │   ├── exportDesign.ts         # Design → JSON blob download
    │   ├── importDesign.ts         # JSON file → validated Design
    │   └── migrations.ts           # schemaVersion migration functions (v1: identity)
    │
    └── components/                 # Shared UI components (app chrome)
        ├── Toolbar.tsx
        ├── ModeToggle.tsx
        ├── FileMenu.tsx
        ├── SettingsDialog.tsx      # API key input; writes to localStorage
        ├── ReviewDialog.tsx        # Side-by-side vision parse review
        └── Toast.tsx               # Error/success notifications
```

---

## 15. Build Phases

**Phase 1 — Specification** *(complete: this document)*

---

**Phase 2 — Foundation** *(~2 weekends)*

Goals: a working canvas where you can build and save a design.

- Vite + React + TypeScript + Tailwind scaffold
- Zustand stores: `designStore` (with temporal undo/redo), `modeStore`
- Schema: all TypeScript types + zod validators + default params
- Persistence: localStorage read/write/export/import
- Build mode canvas: React Flow with all custom node components (rough.js aesthetic), sketchy edges, palette drag-and-drop, inspector with all per-type param forms
- Annotation layer: SVG overlay, perfect-freehand pen strokes, pen tool toggle
- Top toolbar: mode toggle (non-functional for Sketch/Simulate), file menu, undo/redo
- No simulation, no sketch parsing yet.

Deliverable: can draw a realistic distributed system, configure every node and edge, save/load, export/import JSON.

---

**Phase 3 — Mid-level simulation engine** *(~3 weekends)*

Goals: a running simulator with metrics.

- `src/sim/`: mulberry32 PRNG, log-normal latency sampler, min-heap, DES engine core
- All node behaviors (v1 scope): routing, queueing, capacity saturation, cache hit/miss, replication event emission
- Retry logic, timeouts, circuit breakers
- Traffic generation: all six load shapes, Poisson inter-arrival
- Web Worker + Comlink wiring; snapshot streaming to main thread
- `simStore`: receives snapshots, accumulates event log
- Simulate mode UI: play/pause/stop, speed slider, traffic config panel, Recharts metric panels (global + per-node)
- Nodes show live state (up/down) on canvas in Simulate mode

Deliverable: can simulate a multi-tier architecture under constant or ramped load and watch queue depths, latency, and error rates respond.

---

**Phase 4 — Make it useful** *(~2 weekends)*

Goals: chaos injection and event inspector — the tools that turn "watching metrics" into "understanding why."

- Chaos timeline UI and all v1 chaos event types wired into the engine
- `EventInspector`: click a chart spike → see events in that window → click an event → walk the cause chain to root
- Simulation run export (event log JSON)
- Design name editing, load dialog with design list
- Settings dialog (API key storage for future vision pipeline)
- Polish: toast notifications, mode transition guards, simulation result summary panel

Deliverable: can schedule a node crash, watch the cascade, click the error spike, and read the exact event chain that caused it.

---

**Phase 5 — Sketch mode + image import + vision parsing** *(~2 weekends)*

Goals: draw on the canvas or drop in an image and get a runnable simulation.

- Sketch mode: full-canvas perfect-freehand surface, stroke storage in `Design.sketches`
- `rasterize.ts`: strokes → offscreen canvas → PNG blob
- Anthropic SDK wiring in browser; `visionPipeline.ts`, `prompt.ts`, `responseParser.ts`
- Review dialog: side-by-side original + parsed graph; interactive editing of parsed graph before accept
- Image import: file picker → vision pipeline → review dialog
- "Parse to graph" in Sketch mode → same pipeline
- Retain sketch as background annotation option

Deliverable: can photograph a whiteboard design, import it, review the parsed graph, fix any misidentified components, and run the simulation.

---

**Phase 6 — Deep features** *(open-ended; one concept per weekend)*

Pick in any order based on what you want to learn next:

- Backpressure propagation
- Partial/degraded node failures
- Replication lag and stale reads
- Consistency model tracking (read-your-writes, monotonic reads, causal)
- Trace replay (v3)
- Mermaid / Excalidraw JSON import (v3)

---

## 16. Open Questions / Decisions Deferred

**1. PRNG implementation**  
Chosen: `mulberry32` (32-bit state, 4 bytes). Simple, fast, good statistical quality for DES workloads, easy to audit. Alternative considered: xoshiro256** — better quality but unnecessary for this use case. Implement in `src/sim/prng.ts`.

**2. LLM model for vision parsing**  
Not hardcoded in the spec. Vision parsing requires a multimodal model. At implementation time, default to `claude-opus-4-7` (highest capability) with a configurable override in Settings. Budget-conscious option is `claude-sonnet-4-6`. Document the model choice in `src/parsing/visionPipeline.ts`.

**3. Exact rough.js style parameters**  
`roughness`, `bowing`, `fillStyle`, `fillWeight`, `hachureAngle` must be tuned visually. Chosen at implementation time. Target: readable at 12px–14px label size; distinct enough to look "sketchy" without obscuring the icon. Starting point: `{ roughness: 1.2, bowing: 1, fillStyle: 'hachure', fillWeight: 0.5 }`.

**4. Undo/redo implementation**  
Chosen: Zustand `temporal` middleware (from `zundo` package). Stores Design snapshots on a history stack. Max history depth: 100. Rationale: Y.js is correct for collaborative undo but is total overkill for a single-user tool; `temporal` is 2KB and zero-config. Revisit if undo across mode transitions becomes complex.

**5. Snapshot interval**  
Default `snapshotInterval_virtual_ms: 100` (i.e., the worker emits a snapshot every 100ms of virtual time). At 1× speed this means 10 UI updates per virtual second. Tune at implementation: too low and the main thread is flooded; too high and charts feel choppy. Expose as a hidden config option.

**6. Max event log size**  
Not enforced in v1. For a 60-second simulation at 1000 RPS with 5 hops per request, the event log could reach ~300k events. Decide at implementation time whether to cap at 1M events with a warning, or leave unbounded. Export will always include the full log.

**7. Caveat vs. Virgil font**  
Chosen: **Caveat** (self-hosted from Google Fonts). Virgil is Excalidraw's proprietary font and distributing it in a separate project is legally ambiguous. Caveat has a near-identical aesthetic and is OFL-licensed. Self-host the `.woff2` files in `public/fonts/` to avoid external requests.

**8. Canvas in Simulate mode: fully read-only?**  
Yes, fully read-only. Node params cannot be edited during or after a simulation run in Simulate mode. The user must exit to Build mode to modify the design. This keeps the simulate/build loop explicit and prevents accidental edits invalidating a run.

**9. How saturation degrades latency**  
At implementation time, decide the specific model for latency degradation under load (when a node receives requests above its rated `read_capacity_rps` / `write_capacity_rps`). Proposal: linearly interpolate P99 latency from rated value to 10× rated value as load goes from 100% to 200% of capacity. Above 200%, reject (queue overflow). Exact curve to be tuned empirically.

**10. Edge handle layout in React Flow**  
Exact positioning of input/output handles per node type (top, bottom, left, right, center) is deferred to the canvas implementation phase. Constraint: each node should allow multiple incoming and outgoing edges without visual overlap.

**11. Session/causal context token format**  
`causalContext` on `SimRequest` is reserved for v2 consistency model tracking. Its format (string, UUID, Lamport clock) is deferred to the v2 consistency model implementation weekend.
```

---

*End of SPEC.md — Phase 1 complete.*
