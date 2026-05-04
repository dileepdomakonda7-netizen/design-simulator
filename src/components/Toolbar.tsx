import { ModeToggle } from './ModeToggle'
import { DesignNameEditor } from './DesignNameEditor'
import { FileMenu } from './FileMenu'
import { useDesignTemporalStore } from '@/store/designStore'

export function Toolbar() {
  const { undo, redo, pastStates, futureStates } = useDesignTemporalStore()
  const canUndo = pastStates.length > 0
  const canRedo = futureStates.length > 0

  const btnClass = (enabled: boolean) =>
    [
      'text-sm px-2 py-1 rounded border text-gray-600',
      enabled
        ? 'border-gray-300 hover:bg-gray-50 cursor-pointer'
        : 'border-gray-200 text-gray-300 cursor-not-allowed',
    ].join(' ')

  return (
    <header className="flex items-center gap-3 px-4 h-12 border-b border-gray-200 bg-white shrink-0">
      <ModeToggle />

      <div className="h-5 w-px bg-gray-200" />

      <DesignNameEditor />

      <div className="h-5 w-px bg-gray-200" />

      <div className="flex gap-1">
        <button
          onClick={() => undo()}
          disabled={!canUndo}
          className={btnClass(canUndo)}
          title="Undo (⌘Z)"
        >
          ↩ Undo
        </button>
        <button
          onClick={() => redo()}
          disabled={!canRedo}
          className={btnClass(canRedo)}
          title="Redo (⌘⇧Z)"
        >
          ↪ Redo
        </button>
      </div>

      <div className="ml-auto">
        <FileMenu />
      </div>
    </header>
  )
}
