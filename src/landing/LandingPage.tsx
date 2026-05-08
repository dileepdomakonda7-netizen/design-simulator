import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { DEMO_SCENARIOS } from '@/demos'
import { useDocumentHead } from '@/hooks/useDocumentHead'

/**
 * Public landing page at /. Built voice, no marketing fluff.
 *
 * Hero: tagline + embedded looping demo iframe pointing at the canonical
 * circuit-breaker scenario via `/app?demo=circuit-breaker-partial-failure&autoplay=1&embed=1`.
 *
 * The iframe approach is deliberate: the canvas app already knows how to
 * mount itself, react to URL params, and run a worker. Iframing it for the
 * hero keeps both routes cleanly separable (build mode vs preview).
 *
 * Mobile fallback: on viewports ≤768px the desktop simulator is illegible
 * (panels squish, banner wraps to 7 lines). Swap the iframe for a static
 * tappable screenshot pointing to /app?demo=circuit-breaker-partial-failure. Senior engineers
 * visit on desktop; mobile is "tap to open the simulator on this device"
 * not "render the simulator inline at miniature size."
 */
const MOBILE_BREAKPOINT = '(max-width: 768px)'

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia(MOBILE_BREAKPOINT).matches
  })
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia(MOBILE_BREAKPOINT)
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return isMobile
}

export function LandingPage() {
  const isMobile = useIsMobile()
  useDocumentHead({
    title: 'sysdraw — distributed systems simulator',
    description:
      'A deterministic simulator for backpressure, circuit breakers, partial failures, replication lag, and consistency models.',
    pathAndQuery: '/',
  })
  return (
    <div className="min-h-screen bg-[#fdfaf3] text-neutral-900 flex flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-white focus:px-3 focus:py-1.5 focus:rounded focus:border focus:border-neutral-400 focus:text-sm"
      >
        Skip to content
      </a>
      <main id="main-content">
      {/* ─── Hero ────────────────────────────────────────────────────── */}
      <section className="px-6 md:px-12 pt-12 md:pt-16 pb-8 max-w-6xl w-full mx-auto">
        <h1 className="font-caveat text-5xl md:text-7xl leading-tight text-neutral-900">
          A deterministic distributed-systems simulator.
        </h1>
        <p className="mt-4 md:mt-6 text-base md:text-lg text-neutral-700 max-w-2xl">
          I built sysdraw to learn how backpressure, circuit breakers, and consistency
          models actually behave under chaos.{' '}
          <Link
            to="/app?demo=circuit-breaker-partial-failure"
            className="text-blue-700 underline underline-offset-2 hover:text-blue-900"
          >
            Try the demo →
          </Link>
        </p>

        {isMobile ? (
          <div className="mt-8">
            <Link
              to="/app?demo=circuit-breaker-partial-failure"
              className="block rounded-lg border border-neutral-300 overflow-hidden bg-white shadow-sm cursor-pointer hover:border-neutral-500 transition-colors"
              aria-label="Open the sysdraw demo on this device"
            >
              <img
                src="/og-image.png"
                alt="sysdraw demo screenshot"
                className="block w-full h-auto"
              />
            </Link>
            <p className="mt-3 text-xs text-neutral-500 text-center">
              Best experienced on desktop — tap to open the simulator on this device.
            </p>
          </div>
        ) : (
          <div className="mt-8 md:mt-12 rounded-lg border border-neutral-300 overflow-hidden bg-white shadow-sm aspect-video">
            <iframe
              src="/app?demo=circuit-breaker-partial-failure&autoplay=1&embed=1"
              className="w-full h-full block"
              title="sysdraw demo: circuit breaker + partial failure"
              // The simulator runs entirely client-side in a Web Worker —
              // no third-party requests escape this iframe.
              sandbox="allow-scripts allow-same-origin"
            />
          </div>
        )}
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
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {DEMO_SCENARIOS.map((s) => {
            const comingSoon = !!s.comingSoon
            return (
              <ConceptCard
                key={s.slug}
                title={s.cardLabel}
                blurb={s.cardBlurb}
                comingSoon={comingSoon}
                {...(comingSoon ? {} : { href: `/app?demo=${s.slug}` })}
              />
            )
          })}
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
          <a
            href="https://github.com/dileepdomakonda7-netizen"
            className="underline underline-offset-2 hover:text-neutral-900"
            target="_blank"
            rel="noopener noreferrer"
          >
            Dileep
          </a>
        </div>
      </section>

      </main>

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
