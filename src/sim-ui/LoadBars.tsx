import { Panel, useStore as useRFStore } from '@xyflow/react'
import { useDesignStore } from '@/store/designStore'
import { useSimStore } from '@/store/simStore'
import type { Node } from '@/schema/types'

const BAR_WIDTH = 60
const BAR_HEIGHT = 5

/**
 * Per-node utilization bars rendered in a single SVG overlay positioned in
 * the React Flow viewport. Reads the latest snapshot's `nodes` entries plus
 * each node's params for the cap calculation.
 *
 * v1 utilization formulas per type are kept simple — Phase 6 can refine.
 */
export function LoadBars() {
  const nodes = useDesignStore((s) => s.design.nodes)
  const snapshot = useSimStore((s) => s.latestSnapshot)
  const transform = useRFStore((s) => s.transform)

  if (!snapshot) return null
  const [tx, ty, tz] = transform

  return (
    <Panel position="top-left" className="!m-0 !inset-0 pointer-events-none">
      {/* Pulse keyframes for the saturated-and-rejecting state. Local to the
          overlay so it's scoped and doesn't leak into Build mode. */}
      <style>
        {`@keyframes lb-pulse { 0% { opacity: 1; } 100% { opacity: 0.55; } }
          .lb-pulse { animation: lb-pulse 0.5s ease-in-out infinite alternate; }`}
      </style>
      <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible">
        <g transform={`translate(${tx} ${ty}) scale(${tz})`}>
          {nodes.map((node) => {
            const ns = snapshot.nodes[node.id]
            if (!ns) return null
            const util = utilizationOf(node, ns.queueDepth, ns.inFlight)
            const x = node.position.x + 90 - BAR_WIDTH / 2
            const y = node.position.y + 80 + 4
            const fillWidth = Math.min(1, util) * BAR_WIDTH

            // Phase 6a: pulse when bounded and rejecting (queue at cap).
            const queueMax = ns.queueMaxDepth
            const rejecting =
              queueMax !== undefined && ns.queueDepth >= queueMax && ns.rejectionsInWindow > 0
            const fillColor = rejecting ? '#b91c1c' : colorFor(util)

            return (
              <g key={node.id}>
                <rect
                  x={x}
                  y={y}
                  width={BAR_WIDTH}
                  height={BAR_HEIGHT}
                  fill="#fafafa"
                  stroke="#a3a3a3"
                  strokeWidth={0.6}
                  rx={1}
                />
                <rect
                  x={x}
                  y={y}
                  width={fillWidth}
                  height={BAR_HEIGHT}
                  fill={fillColor}
                  rx={1}
                  className={rejecting ? 'lb-pulse' : ''}
                />
                {/* Depth indicator for bounded queues, e.g. "12/15" */}
                {queueMax !== undefined && (
                  <text
                    x={x + BAR_WIDTH / 2}
                    y={y + BAR_HEIGHT + 8}
                    fill={rejecting ? '#b91c1c' : '#737373'}
                    fontSize={7}
                    textAnchor="middle"
                    fontFamily="monospace"
                  >
                    {ns.queueDepth}/{queueMax}
                  </text>
                )}
              </g>
            )
          })}
        </g>
      </svg>
    </Panel>
  )
}

function utilizationOf(node: Node, queueDepth: number, inFlight: number): number {
  switch (node.type) {
    case 'app_server': {
      const cap = node.params.instances * node.params.max_concurrent_per_instance
      return cap > 0 ? (queueDepth + inFlight) / cap : 0
    }
    case 'database':
      // Phase 4b: read_capacity_rps is used as a concurrent-in-flight cap.
      return node.params.read_capacity_rps > 0
        ? inFlight / node.params.read_capacity_rps
        : 0
    case 'queue':
      return node.params.max_depth > 0
        ? queueDepth / node.params.max_depth
        : queueDepth / 1000
    case 'cache':
      // Display "miss pressure" — 1 - hit_rate.
      return 1 - node.params.hit_rate
    case 'cdn':
      return 1 - node.params.hit_rate
    default:
      // For pass-throughs, normalize against an arbitrary 100 in-flight.
      return inFlight / 100
  }
}

function colorFor(util: number): string {
  if (util > 1) return '#dc2626' // red — saturated
  if (util > 0.8) return '#f97316' // orange
  if (util > 0.5) return '#eab308' // yellow
  return '#22c55e' // green
}
