import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  useReactFlow,
  type NodeChange,
  type EdgeChange,
  type Connection,
  type Viewport as RFViewport,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { useDesignStore } from '@/store/designStore'
import { createDefaultEdge, createDefaultNode } from '@/schema/defaults'
import type { ComponentType } from '@/schema/types'
import { toRFNode, toRFEdge } from './adapters'

import { ClientNode } from './nodes/ClientNode'
import { LoadBalancerNode } from './nodes/LoadBalancerNode'
import { ApiGatewayNode } from './nodes/ApiGatewayNode'
import { AppServerNode } from './nodes/AppServerNode'
import { CacheNode } from './nodes/CacheNode'
import { DatabaseNode } from './nodes/DatabaseNode'
import { QueueNode } from './nodes/QueueNode'
import { PubSubNode } from './nodes/PubSubNode'
import { CdnNode } from './nodes/CdnNode'
import { ObjectStorageNode } from './nodes/ObjectStorageNode'
import { ExternalServiceNode } from './nodes/ExternalServiceNode'
import { SketchyEdge } from './edges/SketchyEdge'

// Sanity check: every ComponentType must have a matching nodeTypes entry,
// or React Flow falls back to its default renderer for the missing type.
const nodeTypes = {
  client: ClientNode,
  load_balancer: LoadBalancerNode,
  api_gateway: ApiGatewayNode,
  app_server: AppServerNode,
  cache: CacheNode,
  database: DatabaseNode,
  queue: QueueNode,
  pub_sub: PubSubNode,
  cdn: CdnNode,
  object_storage: ObjectStorageNode,
  external_service: ExternalServiceNode,
} as const satisfies Record<ComponentType, unknown>

const edgeTypes = { sketchy: SketchyEdge }

const ALL_COMPONENT_TYPES: ComponentType[] = [
  'client',
  'load_balancer',
  'api_gateway',
  'app_server',
  'cache',
  'database',
  'queue',
  'pub_sub',
  'cdn',
  'object_storage',
  'external_service',
]
for (const t of ALL_COMPONENT_TYPES) {
  if (!(t in nodeTypes)) throw new Error(`DesignCanvas: missing nodeTypes entry for "${t}"`)
}

// ─── Outer wrapper provides the React Flow context for child components ───────

export function DesignCanvas() {
  return (
    <ReactFlowProvider>
      <DesignCanvasInner />
    </ReactFlowProvider>
  )
}

// ─── Inner component — has access to useReactFlow() ───────────────────────────

function DesignCanvasInner() {
  const designId = useDesignStore((s) => s.design.id)
  const schemaNodes = useDesignStore((s) => s.design.nodes)
  const schemaEdges = useDesignStore((s) => s.design.edges)
  const viewport = useDesignStore((s) => s.design.viewport)

  const updateNodePosition = useDesignStore((s) => s.updateNodePosition)
  const removeNode = useDesignStore((s) => s.removeNode)
  const addEdge = useDesignStore((s) => s.addEdge)
  const removeEdge = useDesignStore((s) => s.removeEdge)
  const updateViewport = useDesignStore((s) => s.updateViewport)

  const reactFlow = useReactFlow()

  const nodes = useMemo(() => schemaNodes.map(toRFNode), [schemaNodes])
  const edges = useMemo(() => schemaEdges.map(toRFEdge), [schemaEdges])

  // When the active design changes (e.g. via load dialog), restore its viewport.
  // We deliberately don't depend on `viewport` itself — that would fight live
  // pan/zoom by snapping back to the persisted value mid-gesture.
  useEffect(() => {
    reactFlow.setViewport(viewport)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designId])

  // Debounced viewport persist (250ms idle window after last pan/zoom).
  const vpTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onMove = useCallback(
    (_e: unknown, vp: RFViewport) => {
      if (vpTimer.current) clearTimeout(vpTimer.current)
      vpTimer.current = setTimeout(() => updateViewport(vp), 250)
    },
    [updateViewport],
  )

  // Position changes: only persist on drag-end (dragging === false). React Flow
  // owns interim drag positions; the store is final-position-only, so each drag
  // is a single undo entry instead of hundreds.
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const change of changes) {
        if (change.type === 'position' && change.dragging === false && change.position) {
          updateNodePosition(change.id, change.position)
        } else if (change.type === 'remove') {
          removeNode(change.id)
        }
        // 'select', 'dimensions', 'add' (programmatic), and interim 'position'
        // updates are handled by React Flow internally — no store action needed.
      }
    },
    [updateNodePosition, removeNode],
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const change of changes) {
        if (change.type === 'remove') removeEdge(change.id)
      }
    },
    [removeEdge],
  )

  // TODO(prompt-7-or-later): topology validation lives at simulation start.
  // The canvas accepts any source→target connection; the simulator rejects
  // impossible topologies (client→client, dangling DB, etc.) at run time.
  const onConnect = useCallback(
    (conn: Connection) => {
      if (conn.source && conn.target) {
        addEdge(createDefaultEdge(conn.source, conn.target))
      }
    },
    [addEdge],
  )

  return (
    <div className="w-full h-full relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultViewport={viewport}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onMove={onMove}
        deleteKeyCode={['Backspace', 'Delete']}
        minZoom={0.2}
        maxZoom={2.5}
        nodesDraggable
        nodesConnectable
        elementsSelectable
        selectNodesOnDrag={false}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="#d4d4d8" />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeColor={() => '#a3a3a3'} maskColor="rgba(0,0,0,0.06)" />
        <DebugAddNodes />
      </ReactFlow>
    </div>
  )
}

// ─── Floating debug panel — replaced by real palette in Prompt 3b ─────────────

function DebugAddNodes() {
  const addNode = useDesignStore((s) => s.addNode)
  const nodeCount = useDesignStore((s) => s.design.nodes.length)

  const handleAdd = (type: ComponentType) => {
    // Offset 40px per existing node so they don't stack
    const offset = nodeCount * 40
    addNode(createDefaultNode(type, { x: 80 + offset, y: 80 + offset }))
  }

  return (
    <Panel
      position="top-left"
      className="!m-2 bg-white/95 backdrop-blur rounded-lg border border-neutral-200 shadow-sm p-2 max-w-[14rem]"
    >
      <div className="text-[10px] uppercase tracking-wide text-neutral-400 mb-1.5 px-1">
        Debug · add node
      </div>
      <div className="grid grid-cols-2 gap-1">
        {ALL_COMPONENT_TYPES.map((t) => (
          <button
            key={t}
            onClick={() => handleAdd(t)}
            className="text-[11px] px-1.5 py-1 rounded bg-neutral-900 text-white hover:bg-neutral-700 truncate"
          >
            {t.replace(/_/g, ' ')}
          </button>
        ))}
      </div>
    </Panel>
  )
}
