import { useEffect } from 'react'
import { Toolbar } from '@/components/Toolbar'
import { useModeStore } from '@/store/modeStore'
import { useDesignStore } from '@/store/designStore'
import { listDesigns, loadDesignById } from '@/persistence/designStorage'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { DesignCanvas } from '@/canvas/DesignCanvas'

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

function SimulateModePlaceholder() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 max-w-sm">
        <h2 className="text-lg font-semibold text-gray-800 mb-1">Simulate Mode</h2>
        <p className="text-sm text-gray-500">
          DES engine, metrics panels, and event inspector arrive in Prompt 4.
        </p>
      </div>
    </div>
  )
}

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

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      <Toolbar />
      <main className="flex-1 overflow-hidden">
        {mode === 'build' && <DesignCanvas />}
        {mode === 'sketch' && <SketchModePlaceholder />}
        {mode === 'simulate' && <SimulateModePlaceholder />}
      </main>
    </div>
  )
}
