import { useEffect } from 'react'
import { Toolbar } from '@/components/Toolbar'
import { useModeStore } from '@/store/modeStore'
import { useDesignStore } from '@/store/designStore'
import { listDesigns, loadDesignById } from '@/persistence/designStorage'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { DesignCanvas } from '@/canvas/DesignCanvas'
import { SimDebugPage } from '@/sim/debugPage/SimDebugPage'
import { SimulateMode } from '@/sim-ui/SimulateMode'

// ─── Placeholder views (build replaced by DesignCanvas) ───────────────────────

function SketchModePlaceholder() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 max-w-sm">
        <h2 className="text-lg font-semibold text-gray-800 mb-1">Sketch Mode</h2>
        <p className="text-sm text-gray-500">
          Freehand canvas and &ldquo;Parse to graph&rdquo; arrive in Prompt 5.
        </p>
      </div>
    </div>
  )
}

// SimulateModePlaceholder replaced by SimDebugPage (4a).
// Real Simulate mode UI arrives in Prompt 4c.

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const mode = useModeStore((s) => s.mode)
  useKeyboardShortcuts()

  // On mount: load the most recently updated design from localStorage.
  // Falls back to the default design already in the store if nothing is saved.
  useEffect(() => {
    const index = listDesigns()
    const latest = index[0]
    if (latest === undefined) return
    const design = loadDesignById(latest.id)
    if (design) {
      useDesignStore.getState().loadDesign(design)
    }
  }, [])

  // Hidden escape hatch for the 4a debug page (still useful for engine-level
  // diagnostics). URL: /?debug=sim
  const debug =
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('debug') : null
  const useDebugSim = debug === 'sim'

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      <Toolbar />
      <main className="flex-1 overflow-hidden">
        {mode === 'build' && <DesignCanvas />}
        {mode === 'sketch' && <SketchModePlaceholder />}
        {mode === 'simulate' && (useDebugSim ? <SimDebugPage /> : <SimulateMode />)}
      </main>
    </div>
  )
}
