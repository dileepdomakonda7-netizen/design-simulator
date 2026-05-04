import { useCallback, useEffect, useRef } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
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
import { useUIStore } from '@/store/uiStore'
import { createDefaultEdge, createDefaultNode } from '@/schema/defaults'
import { COMPONENT_TYPES, type ComponentType, type Node, type Edge } from '@/schema/types'
import { toRFNode, toRFEdge } from './adapters'
import { Palette, PALETTE_DRAG_MIME } from './Palette'
import { Inspector } from './Inspector'
import { AnnotationLayer } from './AnnotationLayer'

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

for (const t of COMPONENT_TYPES) {
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
  const addNode = useDesignStore((s) => s.addNode)
  const addEdge = useDesignStore((s) => s.addEdge)
  const removeEdge = useDesignStore((s) => s.removeEdge)
  const updateViewport = useDesignStore((s) => s.updateViewport)

  const penTool = useUIStore((s) => s.penTool)
  const penOff = penTool === 'off'

  const reactFlow = useReactFlow()

  const [rfNodes, setRfNodes, onNodesChangeInternal] = useNodesState<RFSchemaNode>(
    schemaNodes.map(toRFNode),
  )
  const [rfEdges, setRfEdges, onEdgesChangeInternal] = useEdgesState<RFSchemaEdge>(
    schemaEdges.map(toRFEdge),
  )

  // Sync schema → React Flow when the store changes (undo/redo, load, drop, etc.)
  // Reference-equality merge preserves selected/dragging on unchanged nodes.
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

  // Restore viewport on design change.
  useEffect(() => {
    reactFlow.setViewport(viewport)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designId])

  // Debounced viewport persist (250ms idle window).
  const vpTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onMove = useCallback(
    (_e: unknown, vp: RFViewport) => {
      if (vpTimer.current) clearTimeout(vpTimer.current)
      vpTimer.current = setTimeout(() => updateViewport(vp), 250)
    },
    [updateViewport],
  )

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
  const onConnect = useCallback(
    (conn: Connection) => {
      if (conn.source && conn.target) {
        addEdge(createDefaultEdge(conn.source, conn.target))
      }
    },
    [addEdge],
  )

  // ─── Palette drop handlers (HTML5 drag-and-drop) ────────────────────────────

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      const raw = event.dataTransfer.getData(PALETTE_DRAG_MIME)
      if (!raw) return
      // Runtime safety net — only accept well-known component types.
      const isComponentType = (s: string): s is ComponentType =>
        (COMPONENT_TYPES as readonly string[]).includes(s)
      if (!isComponentType(raw)) return
      const position = reactFlow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      })
      addNode(createDefaultNode(raw, position))
    },
    [reactFlow, addNode],
  )

  return (
    <div className="w-full h-full relative" onDragOver={onDragOver} onDrop={onDrop}>
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
        // Pen mode disables canvas/node/edge interaction; zoom-on-scroll stays
        // on so the user can still adjust where their strokes land.
        panOnDrag={penOff}
        nodesDraggable={penOff}
        nodesConnectable={penOff}
        elementsSelectable={penOff}
        zoomOnScroll
        selectNodesOnDrag={false}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="#d4d4d8" />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeColor={() => '#a3a3a3'} maskColor="rgba(0,0,0,0.06)" />
      </ReactFlow>

      {/* Annotation layer renders ABOVE the graph but its pointer-events flip
          based on penTool — when off, clicks pass through to React Flow. */}
      <AnnotationLayer />

      <Palette />
      <Inspector />
    </div>
  )
}
