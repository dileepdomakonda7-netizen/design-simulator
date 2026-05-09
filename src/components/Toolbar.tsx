import { ModeToggle } from './ModeToggle'
import { DesignNameEditor } from './DesignNameEditor'
import { FileMenu } from './FileMenu'
import { PenToolGroup } from './PenToolGroup'
import { ShareButton } from './ShareButton'
import { useDesignTemporalStore } from '@/store/designStore'
import { useModeStore } from '@/store/modeStore'

export function Toolbar() {
  const { undo, redo, pastStates, futureStates } = useDesignTemporalStore()
  const canUndo = pastStates.length > 0
  const canRedo = futureStates.length > 0
  const mode = useModeStore((s) => s.mode)

  const btnClass = (enabled: boolean) =>
    [
      'text-sm px-2 py-1 rounded border text-gray-600',
      enabled
        ? 'border-gray-300 hover:bg-gray-50 cursor-pointer'
        : 'border-gray-200 text-gray-300 cursor-not-allowed',
    ].join(' ')

  return (
    <header
      // Round-2 R-9 pinned the toolbar height to stop the Run button
      // from drifting; round-3 review found the original
      // `max-h-12 overflow-hidden` combo was clipping the File-menu
      // dropdown (it's `absolute top-full` inside a `relative` wrapper
      // inside this header — `overflow: hidden` eats descendants that
      // extend below the 48px header line). `h-12` is a fixed height,
      // not a max, and `min-h-12` defensively prevents shrinkage; the
      // overflow clip isn't needed.
      className="flex items-center gap-3 px-4 h-12 min-h-12 border-b border-gray-200 bg-white shrink-0"
    >
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

      {mode === 'build' && (
        <>
          <div className="h-5 w-px bg-gray-200" />
          <PenToolGroup />
        </>
      )}

      <div className="ml-auto flex items-center gap-2">
        <ShareButton />
        <FileMenu />
      </div>
    </header>
  )
}
