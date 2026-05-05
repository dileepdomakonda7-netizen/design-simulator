# sysdraw

A deterministic distributed-systems simulator. Drag components, configure their parameters, then inject chaos — node failures, network partitions, traffic spikes, cache-miss storms, replication lag — and watch how your design responds.

**Live**: [sysdraw.vercel.app](https://sysdraw.vercel.app)

> Same seed, same outcome, every time. That's what makes the tool useful for actually thinking about systems instead of just drawing them.

## What you can simulate

- **Backpressure** — bounded queues with rejection policies (`reject_newest` / `reject_oldest` / `block`).
- **Circuit breakers** — three-state machine (closed/open/half-open) per edge, with single-flight half-open probes.
- **Partial failures** — slow nodes, error spikes, or both. Compare tight vs loose timeouts on a degraded service.
- **Replication lag** — async replicas with per-read staleness; trigger 10× lag spikes during write storms.
- **Consistency models** — linearizable, read-your-writes, monotonic reads, eventual. See the read-scale-vs-correctness tradeoff.
- **Causal-chain inspector** — click any event in the simulation log and walk the cause-id chain back to the originating client request.

11 component types (client / load balancer / API gateway / app server / cache / database / queue / pub-sub / CDN / object storage / external service), 6 chaos types, deterministic Web-Worker engine.

## Quick start

```bash
git clone https://github.com/dileepdomakonda7-netizen/sysdraw.git
cd sysdraw
npm install
npm run dev
```

Then open <http://localhost:5173>.

## Architecture

- **Engine** — discrete-event simulation in a Web Worker. Comlink RPC to the main thread. Mulberry32 PRNG with per-node sub-streams for determinism.
- **UI** — React + React Flow + roughjs (sketchy aesthetic) + recharts. Zustand state with zundo undo/redo.
- **Persistence** — Zod-validated `Design` schema in `localStorage` with version migrations; URL-shareable via lz-string compression at `/app?d=<encoded>`.

Full design notes in [SPEC.md](./SPEC.md). Phase-by-phase log in [PROGRESS.md](./PROGRESS.md).

## License

MIT.
