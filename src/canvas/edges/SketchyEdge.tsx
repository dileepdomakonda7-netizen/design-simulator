import { memo, useEffect, useRef } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
  type Edge as RFEdge,
} from '@xyflow/react'
import rough from 'roughjs'
import type { Edge, EdgeKind } from '@/schema/types'
import { hashCode } from '@/canvas/nodes/util'

type Data = { schemaEdge: Edge }

const KIND_STYLE: Record<EdgeKind, { stroke: string; strokeWidth: number; dash?: number[] }> = {
  sync_rpc: { stroke: '#1a1a1a', strokeWidth: 1.6 },
  async_message: { stroke: '#1a1a1a', strokeWidth: 1.4, dash: [6, 4] },
  replication: { stroke: '#737373', strokeWidth: 1.2 },
}

function arrowHeadPoints(tx: number, ty: number, sx: number, sy: number, size = 10): string {
  // Compute the unit vector from source-side bezier endpoint toward target;
  // for visually-stable arrowheads we use the straight-line approximation,
  // which is close enough for short edge segments and keeps the math cheap.
  const dx = tx - sx
  const dy = ty - sy
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  // Two flank points behind the target tip
  const baseX = tx - ux * size
  const baseY = ty - uy * size
  const px = -uy
  const py = ux
  const x1 = baseX + px * size * 0.45
  const y1 = baseY + py * size * 0.45
  const x2 = baseX - px * size * 0.45
  const y2 = baseY - py * size * 0.45
  return `${tx},${ty} ${x1},${y1} ${x2},${y2}`
}

function SketchyEdgeImpl({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
  markerEnd,
}: EdgeProps<RFEdge<Data>>) {
  const svgRef = useRef<SVGGElement>(null)
  const kind = data?.schemaEdge.kind ?? 'sync_rpc'
  const style = KIND_STYLE[kind]
  const seed = hashCode(id)
  const label = data?.schemaEdge.label

  // React Flow's bezier helper gives us a stable cubic path; we use it as the
  // "skeleton" but also render rough.js wobble on top. The bezier path is
  // invisible (stroke=none) — its only role is to compute label position.
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  })

  useEffect(() => {
    const g = svgRef.current
    if (!g) return
    while (g.firstChild) g.removeChild(g.firstChild)
    const rc = rough.svg(g.ownerSVGElement!)

    const lineOpts = {
      stroke: selected ? '#2563eb' : style.stroke,
      strokeWidth: selected ? style.strokeWidth + 1 : style.strokeWidth,
      roughness: 1.5,
      bowing: 2,
      seed,
      ...(style.dash ? { strokeLineDash: style.dash } : {}),
    }

    // Main line: source → target via the same bezier the label uses,
    // approximated as a single rough.js path.
    const line = rc.path(edgePath, lineOpts)
    g.appendChild(line)

    // Arrowhead at target — solid (no dash even on async_message edges).
    const arrowOpts = {
      stroke: lineOpts.stroke,
      strokeWidth: lineOpts.strokeWidth,
      roughness: 1.5,
      bowing: 2,
      seed,
      fill: lineOpts.stroke,
      fillStyle: 'solid',
    }
    const arrow = rc.polygon(
      arrowHeadPoints(targetX, targetY, sourceX, sourceY, 10)
        .split(' ')
        .map((p) => p.split(',').map(Number) as [number, number]),
      arrowOpts,
    )
    g.appendChild(arrow)
  }, [
    edgePath,
    sourceX,
    sourceY,
    targetX,
    targetY,
    seed,
    selected,
    style.stroke,
    style.strokeWidth,
    style.dash,
  ])

  return (
    <>
      {/* Invisible skeleton path React Flow needs for hit-testing & labels.
          markerEnd is conditionally spread because under exactOptionalPropertyTypes
          we can't pass `markerEnd={undefined}` to a `markerEnd?: string` prop. */}
      <BaseEdge
        id={id}
        path={edgePath}
        style={{ stroke: 'none', fill: 'none' }}
        {...(markerEnd ? { markerEnd } : {})}
      />
      {/* Sketchy overlay */}
      <g ref={svgRef} className="pointer-events-none" />
      {label && (
        <EdgeLabelRenderer>
          <div
            className="absolute font-caveat text-sm text-neutral-700 bg-white/80 px-1.5 rounded"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

export const SketchyEdge = memo(SketchyEdgeImpl)
