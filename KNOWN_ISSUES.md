# Known issues — sysdraw v1.0

sysdraw is a v1.0 release. This document tracks known limitations and bugs
that did not block launch but are tracked for follow-up work.

PRs welcome on any of these.

## Engine limitations

These are gaps in what the simulation engine can model. They affect what
scenarios are possible, not the correctness of the scenarios that exist.

### No horizontal sharding primitive

The engine has no first-class concept of hash-based routing across N shards.
The `hot-shard` demo approximates the dynamics with three independent
`client → database` pairs at skewed RPS (80/10/10). This conveys the lesson
(one shard saturates while others sit idle) but does not model true sharded
routing.

A future `shard_router` component would model hash-based routing across N
backing shards with configurable key skew.

### App servers cannot fan out in parallel

The `app_server` component processes one downstream call per request. The
`saturating-fan-out` demo uses a load-balancer + round-robin approximation to
illustrate the lesson (slow downstream drags aggregate latency) but does not
model true parallel fan-out where aggregate latency = max(all downstream
latencies).

A future fan-out behavior on `app_server` would let one request emit N
parallel downstream calls and aggregate the responses with a configurable
join policy.

### Sync replication does not block on replica acknowledgment

The `database` component accepts a `replication: 'sync'` parameter but the
engine does not enforce blocking writes on replica acknowledgment. The
`sync-replication-trap` scenario is registered in the demo loader but marked
"coming soon" pending this work.

A future v1.1 will extend the database write path to await all replica
acknowledgments before completing when `replication: 'sync'` is set, and to
honor `replication_lag_spike` chaos events on the replica acknowledgment
path.

## Display and UI bugs

These are bugs in the display layer. The engine is unaffected; the digest,
event log, and per-tick metrics are correct in all cases below.

### Cumulative `arrived` may under-report on first run after page load

On the first simulation run after a cold page load, the cumulative `arrived`
count on the metrics card may briefly under-report the true count (e.g.
display 740 when the engine processed 900 arrivals). The simulation itself
is unaffected — the determinism digest, the event log, and the per-tick
metrics all reflect the true count.

Subsequent runs in the same session display the correct cumulative count.

Root cause: the cumulative card is derived from a client-side accumulator
over streamed events, which can lag the worker's final snapshot on the
first run after a cold worker startup. Fix planned for v1.1: derive the
cumulative card directly from the worker's final snapshot at
`simulation_end`.

### Renderer can hang briefly at 1× playback speed for long simulations

At 1× playback speed (real-time), simulations longer than ~10 seconds can
produce visible main-thread hitches as event-log appends and chart updates
compete with the playback timer. The `Pause` button may be temporarily
unresponsive during these hitches.

Workaround: use the speed selector (default 10×) for simulations longer
than 5 seconds. The 1× setting is best treated as a "watch live" mode for
short scenarios.

A future v1.1 will further throttle event-log appends and chart re-renders
to maintain UI responsiveness at 1× for longer simulations.

### Minimap may show empty rectangles for some node types

The React Flow minimap relies on per-node-type color and size hints. Some
custom node types may render as empty or undersized rectangles in the
minimap depending on viewport zoom. The minimap viewport indicator
(showing the current visible region) is unaffected.

## Scenario tuning

Each demo scenario was tuned at seed=42 with default config to produce a
visible, lesson-aligned outcome. Changes to the seed, RPS, duration, or
parameter values may produce different (still deterministic) outcomes that
are less aligned with the banner text.

If you find a parameter combination where the lesson is no longer visible
at seed=42 with default config, please open an issue with the scenario name
and the parameters you tested.

## Out-of-scope for v1.0

These are deliberate non-goals for the initial release. They may or may not
be added in future versions.

- Sketch mode (freehand canvas + parse-to-graph) is stubbed in the UI but
  not implemented. The toolbar button is present for future work.
- The simulator does not support Byzantine failure modes (only crash, slow,
  partition).
- The simulator does not model network bandwidth limits, only latency and
  failure rates.
- The simulator does not model disk I/O explicitly; database read/write
  latency is configured as a single distribution.
- Designs are stored in browser localStorage. There is no server-side
  persistence, no multi-user collaboration, and no design history.
- Share URLs encode the full design via lz-string compression. Designs
  larger than ~6KB compressed will not fit in a URL and cannot be shared
  via the Share button. Use Export JSON for larger designs.

## Reporting new issues

If you find a bug not listed here, please open an issue at the GitHub repo
with:

- The scenario or design you were running (URL or `Export JSON` attached)
- The seed, duration, and RPS values used
- What you expected to see
- What you actually saw
- Browser and OS

For determinism-related bugs (different output at the same seed), please
include the digest values from each run — they are visible in the metrics
panel after each run completes.
