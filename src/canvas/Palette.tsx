import { COMPONENT_TYPES, type ComponentType } from '@/schema/types'
import { createDefaultNode } from '@/schema/defaults'
import { useDesignStore } from '@/store/designStore'
import { useUIStore } from '@/store/uiStore'

import { ClientIcon } from './nodes/icons/ClientIcon'
import { LoadBalancerIcon } from './nodes/icons/LoadBalancerIcon'
import { ApiGatewayIcon } from './nodes/icons/ApiGatewayIcon'
import { AppServerIcon } from './nodes/icons/AppServerIcon'
import { CacheIcon } from './nodes/icons/CacheIcon'
import { DatabaseIcon } from './nodes/icons/DatabaseIcon'
import { QueueIcon } from './nodes/icons/QueueIcon'
import { PubSubIcon } from './nodes/icons/PubSubIcon'
import { CdnIcon } from './nodes/icons/CdnIcon'
import { ObjectStorageIcon } from './nodes/icons/ObjectStorageIcon'
import { ExternalServiceIcon } from './nodes/icons/ExternalServiceIcon'

const ICON_MAP: Record<ComponentType, () => JSX.Element> = {
  client: () => <ClientIcon />,
  load_balancer: () => <LoadBalancerIcon />,
  api_gateway: () => <ApiGatewayIcon />,
  app_server: () => <AppServerIcon />,
  cache: () => <CacheIcon />,
  database: () => <DatabaseIcon />,
  queue: () => <QueueIcon />,
  pub_sub: () => <PubSubIcon />,
  cdn: () => <CdnIcon />,
  object_storage: () => <ObjectStorageIcon />,
  external_service: () => <ExternalServiceIcon />,
}

const LABEL_MAP: Record<ComponentType, string> = {
  client: 'Client',
  load_balancer: 'Load Balancer',
  api_gateway: 'API Gateway',
  app_server: 'App Server',
  cache: 'Cache',
  database: 'Database',
  queue: 'Queue',
  pub_sub: 'Pub/Sub',
  cdn: 'CDN',
  object_storage: 'Object Storage',
  external_service: 'External',
}

/**
 * Drag-data MIME type read by DesignCanvas's onDrop handler. Match exactly.
 */
export const PALETTE_DRAG_MIME = 'application/reactflow'

export function Palette() {
  const collapsed = useUIStore((s) => s.paletteCollapsed)
  const toggle = useUIStore((s) => s.togglePaletteCollapsed)

  function onDragStart(event: React.DragEvent, type: ComponentType) {
    event.dataTransfer.setData(PALETTE_DRAG_MIME, type)
    event.dataTransfer.effectAllowed = 'move'
  }

  return (
    <aside className="absolute top-2 left-2 z-20 bg-white/95 backdrop-blur rounded-lg border border-neutral-200 shadow-sm overflow-hidden">
      <header className="flex items-center justify-between px-2 py-1.5 border-b border-neutral-100">
        {!collapsed && (
          <span className="font-caveat text-sm text-neutral-600">Add node</span>
        )}
        <button
          onClick={toggle}
          className="text-neutral-400 hover:text-neutral-700 text-xs ml-auto"
          title={collapsed ? 'Expand palette' : 'Collapse palette'}
        >
          {collapsed ? '▸' : '◂'}
        </button>
      </header>
      <div
        className={collapsed ? 'p-1' : 'p-1.5 max-h-[70vh] overflow-y-auto'}
        role="list"
        aria-label="Add node palette"
      >
        {COMPONENT_TYPES.map((t) => {
          const Icon = ICON_MAP[t]
          const label = LABEL_MAP[t]
          return (
            <div
              key={t}
              role="listitem"
              tabIndex={0}
              draggable
              onDragStart={(e) => onDragStart(e, t)}
              onKeyDown={(e) => {
                // Keyboard fallback for the drag-and-drop palette: Enter or
                // Space adds the node. Round-2 R-6: cascade the position by
                // existing-node count so successive Enter presses don't
                // stack every node at the same coordinates.
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  const count = useDesignStore.getState().design.nodes.length
                  const STRIDE = 32
                  const PER_ROW = 6
                  const col = count % PER_ROW
                  const row = Math.floor(count / PER_ROW)
                  useDesignStore
                    .getState()
                    .addNode(
                      createDefaultNode(t, {
                        x: 240 + col * STRIDE,
                        y: 240 + row * STRIDE,
                      }),
                    )
                }
              }}
              aria-label={`Add ${label} node`}
              className={[
                'flex items-center rounded cursor-grab active:cursor-grabbing select-none hover:bg-neutral-100 focus-visible:bg-neutral-100',
                collapsed ? 'justify-center p-1.5' : 'gap-2 px-2 py-1.5',
              ].join(' ')}
              title={collapsed ? label : undefined}
            >
              <span className="shrink-0">
                <Icon />
              </span>
              {!collapsed && (
                <span className="font-caveat text-base text-neutral-800 whitespace-nowrap pr-2">
                  {label}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </aside>
  )
}
