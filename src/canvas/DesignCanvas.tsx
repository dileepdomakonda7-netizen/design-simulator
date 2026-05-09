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

  // Restore viewport on design change. For demo designs the build-mode
  // palette overlay (~155px on the left) can hide the leftmost node at the
  // pan position the design was authored with — round-2 R-8 / round-3
  // R3-7. Two-step fix: fitView so the whole graph is visible at the
  // current viewport size, then auto-collapse the palette so the
  // leftmost node isn't covered. Users who want the palette can expand
  // it via the collapse toggle.
  useEffect(() => {
    if (designId.startsWith('demo-')) {
      reactFlow.fitView({ padding: 0.2 })
      // Round-3 R3-7: collapse the palette only on the FIRST view of a
      // given demo. We don't want to fight the user if they explicitly
      // expanded it — but fresh demo loads should default to "see the
      // whole graph." Track the "we've collapsed for this design" state
      // by reading once: if the user already toggled, leave it.
      if (!useUIStore.getState().paletteCollapsed) {
        useUIStore.setState({ paletteCollapsed: true })
      }
    } else {
      reactFlow.setViewport(viewport)
    }
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

  // Round-3 R3-6: validate before adding the edge AND give the user
  // visible feedback when we reject. Self-loops are nonsensical; cycles
  // would break the request-routing engine which assumes a DAG of forward
  // hops. We surface a toast either way so the user knows their drag
  // didn't silently no-op.
  const onConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target) return
      if (conn.source === conn.target) {
        useUIStore
          .getState()
          .pushToast('warn', "Can't connect a node to itself.")
        return
      }
      // Cycle check: BFS forward from conn.target through existing edges; if
      // we reach conn.source, adding source→target would close a cycle.
      const adj = new Map<string, string[]>()
      for (const e of schemaEdges) {
        const list = adj.get(e.source) ?? []
        list.push(e.target)
        adj.set(e.source, list)
      }
      const queue: string[] = [conn.target]
      const seen = new Set<string>([conn.target])
      while (queue.length > 0) {
        const cur = queue.shift()!
        if (cur === conn.source) {
          useUIStore
            .getState()
            .pushToast('warn', "That edge would create a cycle. Cycles aren't supported in v1.")
          return
        }
        for (const next of adj.get(cur) ?? []) {
          if (seen.has(next)) continue
          seen.add(next)
          queue.push(next)
        }
      }
      addEdge(createDefaultEdge(conn.source, conn.target))
    },
    [addEdge, schemaEdges],
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
      const newNode = createDefaultNode(raw, position)
      addNode(newNode)
      // Select the freshly dropped node so the inspector populates with its
      // params immediately. Defer one tick so the schema → RF sync effect
      // runs before we patch selection.
      queueMicrotask(() => {
        setRfNodes((prev) =>
          prev.map((n) => ({ ...n, selected: n.id === newNode.id })),
        )
      })
    },
    [reactFlow, addNode, setRfNodes],
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
        <MiniMap
          pannable
          zoomable
          nodeColor={() => '#525252'}
          nodeStrokeColor={() => '#171717'}
          nodeStrokeWidth={2}
          maskColor="rgba(0,0,0,0.06)"
        />
      </ReactFlow>

      {/* Annotation layer renders ABOVE the graph but its pointer-events flip
          based on penTool — when off, clicks pass through to React Flow. */}
      <AnnotationLayer />

      <Palette />
      <Inspector />
    </div>
  )
}
