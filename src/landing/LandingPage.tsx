import { Link } from 'react-router-dom'

/**
 * Public landing page at /. Built voice, no marketing fluff.
 *
 * Hero: tagline + embedded looping demo iframe pointing at the canonical
 * circuit-breaker scenario via `/app?demo=cb-partial&autoplay=1&embed=1`.
 *
 * The iframe approach is deliberate: the canvas app already knows how to
 * mount itself, react to URL params, and run a worker. Iframing it for the
 * hero keeps both routes cleanly separable (build mode vs preview).
 */
export function LandingPage() {
  return (
    <div className="min-h-screen bg-[#fdfaf3] text-neutral-900 flex flex-col">
      {/* ─── Hero ────────────────────────────────────────────────────── */}
      <section className="px-6 md:px-12 pt-12 md:pt-16 pb-8 max-w-6xl w-full mx-auto">
        <h1 className="font-caveat text-5xl md:text-7xl leading-tight text-neutral-900">
          A deterministic distributed-systems simulator.
        </h1>
        <p className="mt-4 md:mt-6 text-base md:text-lg text-neutral-700 max-w-2xl">
          I built sysdraw to learn how backpressure, circuit breakers, and consistency
          models actually behave under chaos.{' '}
          <Link
            to="/app?demo=cb-partial"
            className="text-blue-700 underline underline-offset-2 hover:text-blue-900"
          >
            Try the demo →
          </Link>
        </p>

        <div className="mt-8 md:mt-12 rounded-lg border border-neutral-300 overflow-hidden bg-white shadow-sm aspect-video">
          <iframe
            src="/app?demo=cb-partial&autoplay=1&embed=1"
            className="w-full h-full block"
            title="sysdraw demo: circuit breaker + partial failure"
            // The simulator runs entirely client-side in a Web Worker —
            // no third-party requests escape this iframe.
            sandbox="allow-scripts allow-same-origin"
          />
        </div>
      </section>

      {/* ─── What is this ───────────────────────────────────────────── */}
      <section className="px-6 md:px-12 py-10 max-w-3xl w-full mx-auto space-y-4 text-base text-neutral-800 leading-relaxed">
        <p>
          Most system design tools let you draw architectures. None of them let you
          simulate what happens when those architectures meet real load and real
          failures. sysdraw does. Drag components, configure their parameters, then
          inject chaos — node failures, network partitions, traffic spikes,
          cache-miss storms, replication lag — and watch how your design responds.
        </p>
        <p>
          Every simulation is deterministic. Same seed, same outcome, every time.
          That&apos;s what makes the tool useful for actually thinking about systems
          instead of just drawing them.
        </p>
      </section>

      {/* ─── What you can simulate ─────────────────────────────────── */}
      <section className="px-6 md:px-12 py-8 max-w-6xl w-full mx-auto">
        <h2 className="font-caveat text-3xl md:text-4xl text-neutral-900 mb-6">
          What you can simulate
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <ConceptCard
            title="Backpressure"
            blurb="Bounded queues with rejection policies. Watch fast failures free upstream services to make decisions."
            href="/app?demo=cb-partial"
            comingSoon={false}
          />
          <ConceptCard
            title="Circuit breakers"
            blurb="Three-state machine (closed/open/half-open) on every edge. See latency drop while errors climb."
            href="/app?demo=cb-partial"
            comingSoon={false}
          />
          <ConceptCard
            title="Partial failures"
            blurb="Slow nodes, error spikes, and combinations. Compare tight timeouts vs loose timeouts on a degraded service."
            href="/app?demo=cb-partial"
            comingSoon={false}
          />
          <ConceptCard
            title="Replication lag"
            blurb="Async replicas with per-read staleness. Trigger lag spikes and watch reads return stale data."
            comingSoon
          />
          <ConceptCard
            title="Consistency models"
            blurb="Linearizable, read-your-writes, monotonic reads, eventual. See the tradeoff between read scale and correctness."
            comingSoon
          />
          <ConceptCard
            title="Causal-chain inspector"
            blurb="Click any event in the simulation log and trace its complete causal history back to the originating client request."
            comingSoon
          />
        </div>
      </section>

      {/* ─── Why I built this ──────────────────────────────────────── */}
      <section className="px-6 md:px-12 py-10 max-w-3xl w-full mx-auto">
        <h2 className="font-caveat text-3xl md:text-4xl text-neutral-900 mb-4">
          Why I built this
        </h2>
        <p className="text-base text-neutral-800 leading-relaxed">
          sysdraw started as a way to actually understand the distributed systems
          concepts I was reading about. It turned out that simulating these systems
          — watching backpressure propagate upstream, watching a circuit breaker open
          during a chaos event, watching reads escalate to primary under
          read-your-writes — taught me more than any blog post ever did. I&apos;m
          sharing it in case it&apos;s useful to other engineers thinking about
          reliability, scale, or just preparing for system design interviews.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-neutral-700">
          <a
            href="https://github.com/dileepdomakonda7-netizen/sysdraw"
            className="underline underline-offset-2 hover:text-neutral-900"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub repo
          </a>
          {/* TODO: replace with actual social link once shared. */}
          <a
            href="{YOUR_LINK_HERE}"
            className="underline underline-offset-2 hover:text-neutral-900"
            target="_blank"
            rel="noopener noreferrer"
          >
            Dileep
          </a>
        </div>
      </section>

      {/* ─── Footer ────────────────────────────────────────────────── */}
      <footer className="mt-auto px-6 md:px-12 py-6 border-t border-neutral-200 text-xs text-neutral-500 text-center">
        built by Dileep · open source on{' '}
        <a
          href="https://github.com/dileepdomakonda7-netizen/sysdraw"
          className="underline hover:text-neutral-700"
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub
        </a>{' '}
        · MIT license
      </footer>
    </div>
  )
}

interface ConceptCardProps {
  title: string
  blurb: string
  href?: string
  comingSoon?: boolean
}

function ConceptCard({ title, blurb, href, comingSoon }: ConceptCardProps) {
  const body = (
    <div className="h-full bg-white rounded-lg border border-neutral-200 p-4 hover:border-neutral-400 transition-colors">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="font-caveat text-xl text-neutral-900">{title}</h3>
        {comingSoon && (
          <span
            className="text-[10px] uppercase tracking-wider text-neutral-400"
            title="Coming soon — the engine supports it; demo scenario is on the followup list."
          >
            Coming soon
          </span>
        )}
      </div>
      <p className="text-sm text-neutral-700 leading-relaxed">{blurb}</p>
    </div>
  )
  if (comingSoon || !href) {
    return <div className="opacity-70 cursor-not-allowed">{body}</div>
  }
  return (
    <Link to={href} className="block focus:outline-none focus:ring-2 focus:ring-neutral-400 rounded-lg">
      {body}
    </Link>
  )
}
