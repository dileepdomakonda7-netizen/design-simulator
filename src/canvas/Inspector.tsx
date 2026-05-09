import { useStore as useRFStore } from '@xyflow/react'
import { useUIStore } from '@/store/uiStore'
import { NodeInspector } from './inspector/NodeInspector'
import { EdgeInspector } from './inspector/EdgeInspector'

/**
 * Selection comes from React Flow's internal store. Selectors return primitives
 * (id-or-null) so default reference equality works — no useShallow needed.
 */
function useSingleSelectedNodeId(): string | null {
  return useRFStore((s) => {
    let id: string | null = null
    let count = 0
    for (const n of s.nodeLookup.values()) {
      if (n.selected) {
        count++
        id = n.id
        if (count > 1) return null
      }
    }
    return id
  })
}

function useSingleSelectedEdgeId(): string | null {
  return useRFStore((s) => {
    let id: string | null = null
    let count = 0
    for (const e of s.edges) {
      if (e.selected) {
        count++
        id = e.id
        if (count > 1) return null
      }
    }
    return id
  })
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full px-6 text-center text-xs text-neutral-400">
      <p>Click a node or edge to edit.</p>
      <p className="mt-1">Drag from the palette to add a node.</p>
    </div>
  )
}

export function Inspector() {
  const collapsed = useUIStore((s) => s.inspectorCollapsed)
  const toggle = useUIStore((s) => s.toggleInspectorCollapsed)
  const nodeId = useSingleSelectedNodeId()
  const edgeId = useSingleSelectedEdgeId()

  const target = nodeId ? 'node' : edgeId ? 'edge' : 'none'

  return (
    <aside
      role="complementary"
      aria-label="Inspector"
      className={[
        'absolute top-0 right-0 bottom-0 z-20 bg-white/95 backdrop-blur border-l border-neutral-200 shadow-sm flex flex-col transition-[width] duration-150',
        collapsed ? 'w-9' : 'w-[320px]',
      ].join(' ')}
    >
      <header className="flex items-center justify-between px-3 h-9 border-b border-neutral-200 shrink-0">
        {!collapsed && (
          <span className="text-[10px] uppercase tracking-wider text-neutral-500">
            Inspector
          </span>
        )}
        <button
          onClick={toggle}
          className="text-neutral-400 hover:text-neutral-700 text-sm"
          title={collapsed ? 'Expand inspector' : 'Collapse inspector'}
        >
          {collapsed ? '◂' : '▸'}
        </button>
      </header>
      {!collapsed && (
        // Round-3 R3-9: aria-region containment so a stray axis label or
        // canvas tick text from a positioned sibling doesn't bleed into
        // screen-reader reading order under "Inspector".
        <div className="flex-1 overflow-y-auto" role="region" aria-label="Inspector content">
          {target === 'node' && nodeId && <NodeInspector nodeId={nodeId} />}
          {target === 'edge' && edgeId && <EdgeInspector edgeId={edgeId} />}
          {target === 'none' && <EmptyState />}
        </div>
      )}
    </aside>
  )
}
