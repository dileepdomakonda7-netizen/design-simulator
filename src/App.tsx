import { useEffect } from 'react'
import { Toolbar } from '@/components/Toolbar'
import { useModeStore } from '@/store/modeStore'
import { useDesignStore } from '@/store/designStore'
import { listDesigns, loadDesignById } from '@/persistence/designStorage'
import { createDefaultNode } from '@/schema/defaults'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'

// ─── Placeholder views ────────────────────────────────────────────────────────

function BuildModePlaceholder() {
  const design = useDesignStore((s) => s.design)
  const addNode = useDesignStore((s) => s.addNode)

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 p-8 text-center">
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 max-w-lg w-full">
        <h2 className="text-lg font-semibold text-gray-800 mb-1">Build Mode</h2>
        <p className="text-sm text-gray-500 mb-6">
          Canvas arrives in Prompt 3. Data layer is live — use the controls below to verify.
        </p>

        <div className="flex flex-wrap gap-2 justify-center mb-6">
          {(['app_server', 'database', 'cache', 'load_balancer'] as const).map((type) => (
            <button
              key={type}
              onClick={() => addNode(createDefaultNode(type, { x: Math.random() * 400, y: Math.random() * 300 }))}
              className="text-xs px-3 py-1.5 rounded-md bg-gray-900 text-white hover:bg-gray-700"
            >
              + {type.replace(/_/g, ' ')}
            </button>
          ))}
        </div>

        <div className="text-left">
          <p className="text-xs font-mono text-gray-400 mb-1">
            design.nodes ({design.nodes.length})
          </p>
          <pre className="text-xs bg-gray-50 rounded-md p-3 overflow-auto max-h-48 text-gray-700 border border-gray-100">
            {JSON.stringify(
              design.nodes.map((n) => ({ id: n.id.slice(0, 8), type: n.type, label: n.label })),
              null,
              2,
            )}
          </pre>
        </div>
      </div>
    </div>
  )
}

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
        {mode === 'build' && <BuildModePlaceholder />}
        {mode === 'sketch' && <SketchModePlaceholder />}
        {mode === 'simulate' && <SimulateModePlaceholder />}
      </main>
    </div>
  )
}
