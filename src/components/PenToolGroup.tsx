import { useState } from 'react'
import { useUIStore } from '@/store/uiStore'
import { useDesignStore } from '@/store/designStore'

/**
 * Pen tool group — pen / eraser toggles + clear-annotations with inline confirm.
 * Visible only when the canvas is in build mode (gated by the Toolbar caller).
 */
export function PenToolGroup() {
  const penTool = useUIStore((s) => s.penTool)
  const setPenTool = useUIStore((s) => s.setPenTool)
  const clearAnnotations = useDesignStore((s) => s.clearAnnotations)
  const [confirmingClear, setConfirmingClear] = useState(false)

  const isOff = penTool === 'off'
  const isPen = penTool === 'pen'
  const isEraser = penTool === 'eraser'

  function btn(active: boolean): string {
    return [
      'text-sm px-2 py-1 rounded border transition-colors',
      active
        ? 'bg-gray-900 text-white border-gray-900'
        : 'border-gray-300 text-gray-600 hover:bg-gray-50',
    ].join(' ')
  }

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => setPenTool(isPen ? 'off' : 'pen')}
        className={btn(isPen)}
        title="Pen — annotate the canvas (Build mode only)"
      >
        ✎ Pen
      </button>
      {!isOff && (
        <>
          <button
            onClick={() => setPenTool(isEraser ? 'pen' : 'eraser')}
            className={btn(isEraser)}
            title="Eraser — click a stroke to delete"
          >
            ⌫ Eraser
          </button>
          {confirmingClear ? (
            <span className="flex items-center gap-1 text-xs text-gray-600 ml-1">
              <span>Clear all?</span>
              <button
                onClick={() => {
                  clearAnnotations()
                  setConfirmingClear(false)
                }}
                className="px-1.5 py-0.5 rounded bg-red-600 text-white hover:bg-red-700"
              >
                Yes
              </button>
              <button
                onClick={() => setConfirmingClear(false)}
                className="px-1.5 py-0.5 rounded border border-gray-300 hover:bg-gray-50"
              >
                No
              </button>
            </span>
          ) : (
            <button
              onClick={() => setConfirmingClear(true)}
              className="text-sm px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-red-50 hover:border-red-300 hover:text-red-700"
              title="Clear all annotations on this design"
            >
              Clear
            </button>
          )}
        </>
      )}
    </div>
  )
}
