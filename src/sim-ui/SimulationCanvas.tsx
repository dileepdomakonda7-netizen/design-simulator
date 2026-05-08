import { useMemo } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  type Node as RFNode,
  type Edge as RFEdge,
} from '@xyflow/react'

import { useDesignStore } from '@/store/designStore'
import { useSimStore } from '@/store/simStore'
import { toRFEdge, toRFNode } from '@/canvas/adapters'
import type { Node, Edge, ComponentType } from '@/schema/types'

import { ClientNode } from '@/canvas/nodes/ClientNode'
import { LoadBalancerNode } from '@/canvas/nodes/LoadBalancerNode'
import { ApiGatewayNode } from '@/canvas/nodes/ApiGatewayNode'
import { AppServerNode } from '@/canvas/nodes/AppServerNode'
import { CacheNode } from '@/canvas/nodes/CacheNode'
import { DatabaseNode } from '@/canvas/nodes/DatabaseNode'
import { QueueNode } from '@/canvas/nodes/QueueNode'
import { PubSubNode } from '@/canvas/nodes/PubSubNode'
import { CdnNode } from '@/canvas/nodes/CdnNode'
import { ObjectStorageNode } from '@/canvas/nodes/ObjectStorageNode'
import { ExternalServiceNode } from '@/canvas/nodes/ExternalServiceNode'
import { SketchyEdge } from '@/canvas/edges/SketchyEdge'

import { LoadBars } from './LoadBars'
import { Panel, useStore as useRFStore } from '@xyflow/react'

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

/**
 * Read-only canvas for Simulate mode. Reuses the Build-mode sketchy node and
 * edge components. Interactions are disabled; selection is allowed for
 * future per-node detail panels but currently has no side effect.
 *
 * LoadBars are rendered as an SVG overlay in flow coordinates.
 */
export function SimulationCanvas() {
  return (
    <ReactFlowProvider>
      <Inner />
    </ReactFlowProvider>
  )
}

function Inner() {
  const schemaNodes = useDesignStore((s) => s.design.nodes)
  const schemaEdges = useDesignStore((s) => s.design.edges)
  const failedNodeIds = useFailedNodeIds()
  const degradedNodeIds = useDegradedNodeIds()

  const rfNodes = useMemo<RFNode<{ schemaNode: Node }>[]>(
    () =>
      schemaNodes.map((n) => {
        const base = toRFNode(n)
        if (failedNodeIds.has(n.id)) {
          return { ...base, className: 'sim-node-down' }
        }
        if (degradedNodeIds.has(n.id)) {
          return { ...base, className: 'sim-node-degraded' }
        }
        return base
      }),
    [schemaNodes, failedNodeIds, degradedNodeIds],
  )
  const rfEdges = useMemo<RFEdge<{ schemaEdge: Edge }>[]>(
    () => schemaEdges.map(toRFEdge),
    [schemaEdges],
  )

  return (
    <div className="w-full h-full relative bg-white rounded-lg border border-neutral-200 overflow-hidden">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        // Fit the whole graph into the viewport on mount and whenever the
        // node set changes. Build mode persists its own pan/zoom; the
        // simulator should always show the entire design — especially in
        // the embedded landing-page hero where the iframe's container size
        // is independent of whatever zoom the user left in build mode.
        fitView
        fitViewOptions={{ padding: 0.15 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        panOnDrag
        zoomOnScroll
        minZoom={0.2}
        maxZoom={2.5}
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
        <LoadBars />
        <DegradedBadges />
      </ReactFlow>
      <DownNodeStyle />
    </div>
  )
}

function useDegradedNodeIds(): Set<string> {
  const latest = useSimStore((s) => s.latestSnapshot)
  return useMemo(() => {
    const out = new Set<string>()
    if (!latest) return out
    for (const [id, ns] of Object.entries(latest.nodes)) {
      if (ns.state === 'degraded') out.add(id)
    }
    return out
  }, [latest])
}

/**
 * Phase 6c: emoji badge overlay for degraded nodes. Positioned in flow
 * coordinates above each degraded node, parallel to LoadBars. Uses
 * snapshot.nodes[n.id].degradationMode to pick the glyph.
 */
function DegradedBadges() {
  const nodes = useDesignStore((s) => s.design.nodes)
  const snapshot = useSimStore((s) => s.latestSnapshot)
  const transform = useRFStore((s) => s.transform)
  if (!snapshot) return null
  const [tx, ty, tz] = transform

  return (
    <Panel position="top-left" className="!m-0 !inset-0 pointer-events-none">
      <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible">
        <g transform={`translate(${tx} ${ty}) scale(${tz})`}>
          {nodes.map((node) => {
            const ns = snapshot.nodes[node.id]
            if (!ns || ns.state !== 'degraded') return null
            const mode = ns.degradationMode
            const glyph =
              mode === 'slow' ? '🐌' : mode === 'errors' ? '⚠️' : '🐌⚠️'
            // Position badge at top-right corner of the node card (~180×80).
            const x = node.position.x + 180 - 8
            const y = node.position.y - 4
            return (
              <text
                key={node.id}
                x={x}
                y={y}
                fontSize={18}
                textAnchor="end"
                style={{ filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.25))' }}
              >
                {glyph}
              </text>
            )
          })}
        </g>
      </svg>
    </Panel>
  )
}

function useFailedNodeIds(): Set<string> {
  const latest = useSimStore((s) => s.latestSnapshot)
  return useMemo(() => {
    const out = new Set<string>()
    if (!latest) return out
    for (const [id, ns] of Object.entries(latest.nodes)) {
      if (ns.state === 'down') out.add(id)
    }
    return out
  }, [latest])
}

function DownNodeStyle() {
  // Tiny inline stylesheet so the failed-node className lights up red without
  // needing to thread color through every node component.
  return (
    <style>
      {`.sim-node-down { filter: drop-shadow(0 0 6px rgba(220, 38, 38, 0.6)); }
        .sim-node-down::after {
          content: '';
          position: absolute;
          inset: -4px;
          border: 2px dashed #dc2626;
          border-radius: 8px;
          pointer-events: none;
        }
        .sim-node-degraded { filter: drop-shadow(0 0 5px rgba(234, 179, 8, 0.55)); }
        .sim-node-degraded::after {
          content: '';
          position: absolute;
          inset: -3px;
          background: rgba(250, 204, 21, 0.18);
          border: 1.5px dashed #ca8a04;
          border-radius: 8px;
          pointer-events: none;
        }`}
    </style>
  )
}
