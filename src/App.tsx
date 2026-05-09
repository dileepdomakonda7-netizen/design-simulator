import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Toolbar } from '@/components/Toolbar'
import { useModeStore } from '@/store/modeStore'
import { useDesignStore } from '@/store/designStore'
import { listDesigns, loadDesignById, saveDesign } from '@/persistence/designStorage'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { DesignCanvas } from '@/canvas/DesignCanvas'
import { SimDebugPage } from '@/sim/debugPage/SimDebugPage'
import { SimulateMode, type DemoModeOptions } from '@/sim-ui/SimulateMode'
import { getScenario, DEMO_SCENARIOS, type DemoScenario } from '@/demos'
import { Link } from 'react-router-dom'
import { decodeDesignFromUrl } from '@/persistence/urlShare'
import { useDocumentHead } from '@/hooks/useDocumentHead'

// ─── Placeholder views (build replaced by DesignCanvas) ───────────────────────

function SketchModePlaceholder() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 max-w-sm">
        <h2 className="text-lg font-semibold text-gray-800 mb-1">Sketch Mode</h2>
        <p className="text-sm text-gray-500">
          Freehand canvas and &ldquo;Parse to graph&rdquo; — coming soon.
        </p>
      </div>
    </div>
  )
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const mode = useModeStore((s) => s.mode)
  const setMode = useModeStore((s) => s.setMode)
  useKeyboardShortcuts()
  const [params] = useSearchParams()

  // URL params drive entry behavior at /app:
  //   ?demo=<name>     load a hardcoded demo bundle, switch to simulate
  //   ?d=<base64>      load an LZ-encoded shared design (with confirmation)
  //   ?autoplay=1      pass autoStart+loop to SimulateMode (for hero embed)
  //   ?embed=1         hide Toolbar + ControlPanel (chrome-less embed)
  //   ?debug=sim       legacy 4a debug page
  const demoName = params.get('demo')
  const sharedEncoded = params.get('d')
  const autoplay = params.get('autoplay') === '1'
  const embed = params.get('embed') === '1'
  const debug = params.get('debug')
  const useDebugSim = debug === 'sim'

  const scenario: DemoScenario | undefined = demoName ? getScenario(demoName) : undefined
  // Round-2 R-3: distinguish "no demo asked for" (scenario === undefined,
  // demoName === null) from "demo asked for, but slug doesn't exist or is
  // marked comingSoon" (scenario === undefined, demoName !== null). The
  // latter renders an inline 404-style fallback instead of silently
  // falling through to localStorage's last-loaded design.
  const demoNotFound = demoName !== null && scenario === undefined
  const [shareError, setShareError] = useState<string | null>(null)
  const designName = useDesignStore((s) => s.design.name)

  useDocumentHead({
    title: scenario
      ? `sysdraw · ${scenario.cardLabel}`
      : demoNotFound
        ? 'sysdraw · Demo not found'
        : `sysdraw · ${designName}`,
    pathAndQuery: scenario ? `/app?demo=${scenario.slug}` : '/app',
    ...(scenario ? { description: scenario.cardBlurb } : {}),
  })

  useEffect(() => {
    if (scenario) {
      // Demo: load the scenario's pre-configured design (chaos plan baked
      // in) + switch to simulate. localStorage is untouched. The demo
      // banner is rendered inside SimulateMode.
      useDesignStore.getState().loadDesign(scenario.buildDesign())
      setMode('simulate')
      return
    }

    if (demoNotFound) {
      // The user asked for a specific demo that we don't recognize. Don't
      // fall through to "load the most recent localStorage design" — that
      // produced the silent "boots into Untitled Design" failure mode in
      // round 2. The render branch below shows an inline error instead.
      return
    }

    if (sharedEncoded) {
      // Shared link: validate, prompt before clobbering current design,
      // back up the existing one as a timestamped record so it isn't lost.
      const result = decodeDesignFromUrl(sharedEncoded)
      if (!result.ok) {
        setShareError(
          result.reason === 'malformed'
            ? 'This link is malformed.'
            : `This design is invalid (${result.detail ?? 'schema mismatch'}).`,
        )
        return
      }
      const current = useDesignStore.getState().design
      if (current.nodes.length > 0) {
        const accept = window.confirm(
          'Load shared design? Your current design will be saved as "Auto-backup".',
        )
        if (!accept) return
        saveDesign({
          ...current,
          name: `Auto-backup ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`,
          updatedAt: new Date().toISOString(),
        })
      }
      useDesignStore.getState().loadDesign(result.design)
      return
    }

    // Default: load most recently updated design from localStorage.
    const index = listDesigns()
    const latest = index[0]
    if (latest === undefined) return
    const design = loadDesignById(latest.id)
    if (design) useDesignStore.getState().loadDesign(design)
  }, [scenario, sharedEncoded, setMode, demoNotFound])

  const demoOptions = useMemo<DemoModeOptions>(() => {
    if (!scenario) return {}
    const design = scenario.buildDesign()
    return {
      autoStart: autoplay,
      loop: autoplay,
      embed,
      label: scenario.bannerHeadline,
      blurb: scenario.bannerBody,
      ...(scenario.bannerFollowup ? { blurbFollowup: scenario.bannerFollowup } : {}),
      runConfig: {
        seed: scenario.defaultSimConfig.seed,
        durationMs: scenario.defaultSimConfig.durationMs,
        rps: scenario.defaultSimConfig.rps,
        speed: 1,
      },
      trafficOverride: scenario.buildTraffic(design),
    }
  }, [scenario, autoplay, embed])

  if (demoNotFound) {
    const liveScenarios = DEMO_SCENARIOS.filter((s) => !s.comingSoon)
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-8 text-center bg-gray-50">
        <h1 className="text-lg font-semibold text-neutral-800 mb-2">
          Demo not found
        </h1>
        <p className="text-sm text-neutral-600 max-w-md mb-4">
          There&apos;s no demo registered with the slug{' '}
          <code className="font-mono bg-neutral-200 px-1 rounded">{demoName}</code>.
          The slug may have changed, or the link may have a typo.
        </p>
        <p className="text-xs text-neutral-500 mb-3">Try one of:</p>
        <ul className="text-sm space-y-1 mb-6">
          {liveScenarios.map((s) => (
            <li key={s.slug}>
              <Link
                to={`/app?demo=${s.slug}`}
                className="text-blue-600 underline hover:text-blue-800"
              >
                {s.cardLabel}
              </Link>
            </li>
          ))}
        </ul>
        <Link to="/" className="text-sm text-neutral-600 underline hover:text-neutral-900">
          ← Back to sysdraw
        </Link>
      </div>
    )
  }

  if (shareError) {
    return (
      <div className="flex flex-col items-center justify-center h-screen p-8 text-center bg-gray-50">
        <h1 className="text-lg font-semibold text-neutral-800 mb-2">
          This design link can&apos;t be loaded
        </h1>
        <p className="text-sm text-neutral-600 max-w-md mb-4">{shareError}</p>
        <p className="text-xs text-neutral-500 max-w-md mb-4">
          The link may be malformed, truncated, or from an incompatible version of sysdraw.
        </p>
        <a href="/" className="text-sm text-blue-600 underline hover:text-blue-800">
          ← Back to sysdraw
        </a>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      {!embed && <Toolbar />}
      <main className="flex-1 overflow-hidden">
        {mode === 'build' && <DesignCanvas />}
        {mode === 'sketch' && <SketchModePlaceholder />}
        {mode === 'simulate' &&
          (useDebugSim ? <SimDebugPage /> : <SimulateMode {...demoOptions} />)}
      </main>
    </div>
  )
}
