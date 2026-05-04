import { useCallback, useEffect, useRef } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  useReactFlow,
  useNodesState,
  useEdgesState,
  type NodeChange,
  type EdgeChange,
  type Connection,
  type Node as RFNode,
  type Edge as RFEdge,
  type Viewport as RFViewport,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { useDesignStore } from '@/store/designStore'
import { createDefaultEdge, createDefaultNode } from '@/schema/defaults'
import type { ComponentType, Node, Edge } from '@/schema/types'
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

type RFSchemaNode = RFNode<{ schemaNode: Node }>
type RFSchemaEdge = RFEdge<{ schemaEdge: Edge }>

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

  // React Flow manages its own state (selection, dragging, dimensions, interim
  // drag positions). The store remains the source of truth for design content;
  // we sync FROM store TO React Flow on schema changes (see useEffect below)
  // and FROM React Flow TO store on drag-end position / remove changes (see
  // wrapped onNodesChange / onEdgesChange).
  const [rfNodes, setRfNodes, onNodesChangeInternal] = useNodesState<RFSchemaNode>(
    schemaNodes.map(toRFNode),
  )
  const [rfEdges, setRfEdges, onEdgesChangeInternal] = useEdgesState<RFSchemaEdge>(
    schemaEdges.map(toRFEdge),
  )

  // Sync schema → React Flow when the store changes (undo/redo, load, debug add,
  // drag-end persist). Reference-equality merge: nodes whose schema reference is
  // unchanged keep their old RF entry verbatim, preserving `selected` and
  // `dragging` flags. Only changed/new nodes get a fresh toRFNode result, and
  // even those carry over `selected` from the prior RF entry.
  useEffect(() => {
    setRfNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]))
      return schemaNodes.map((s) => {
        const oldRF = prevById.get(s.id)
        if (oldRF && oldRF.data.schemaNode === s) {
          return oldRF
        }
        const next = toRFNode(s) as RFSchemaNode
        return oldRF?.selected ? { ...next, selected: true } : next
      })
    })
  }, [schemaNodes, setRfNodes])

  useEffect(() => {
    setRfEdges((prev) => {
      const prevById = new Map(prev.map((e) => [e.id, e]))
      return schemaEdges.map((s) => {
        const oldRF = prevById.get(s.id)
        if (oldRF && oldRF.data?.schemaEdge === s) {
          return oldRF
        }
        const next = toRFEdge(s) as RFSchemaEdge
        return oldRF?.selected ? { ...next, selected: true } : next
      })
    })
  }, [schemaEdges, setRfEdges])

  // When the active design changes (e.g. via load dialog), restore its viewport.
  // Deliberately not dependent on `viewport` itself — that would fight live
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

  // CRITICAL: forward all changes to React Flow's internal state FIRST so
  // selection / dimensions / interim positions update; THEN extract the changes
  // we want to persist (drag-end position, remove). Dropping any change type
  // (as the prior controlled-mode implementation did) breaks selection.
  const onNodesChange = useCallback(
    (changes: NodeChange<RFSchemaNode>[]) => {
      onNodesChangeInternal(changes)
      for (const c of changes) {
        if (c.type === 'position' && c.dragging === false && c.position) {
          updateNodePosition(c.id, c.position)
        } else if (c.type === 'remove') {
          removeNode(c.id)
        }
      }
    },
    [onNodesChangeInternal, updateNodePosition, removeNode],
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange<RFSchemaEdge>[]) => {
      onEdgesChangeInternal(changes)
      for (const c of changes) {
        if (c.type === 'remove') removeEdge(c.id)
      }
    },
    [onEdgesChangeInternal, removeEdge],
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
        nodes={rfNodes}
        edges={rfEdges}
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
