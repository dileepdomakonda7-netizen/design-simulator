import { useCallback, useMemo, useRef, useState } from 'react'
import { useReactFlow, useViewport } from '@xyflow/react'
import { getStroke } from 'perfect-freehand'
import { nanoid } from 'nanoid'

import { useDesignStore } from '@/store/designStore'
import { useUIStore } from '@/store/uiStore'
import type { Annotation } from '@/schema/types'

const STROKE_OPTIONS = {
  size: 4,
  thinning: 0.55,
  smoothing: 0.5,
  streamline: 0.5,
} as const

interface StrokeData {
  points: number[][] // [x, y, pressure?]
  options: typeof STROKE_OPTIONS
  cachedPath: string
}

/**
 * Convert perfect-freehand stroke polygon to an SVG path d-string.
 * Quadratic curves between midpoints make the polygon read as smooth.
 */
function strokeToSvgPath(stroke: number[][]): string {
  if (stroke.length === 0) return ''
  const first = stroke[0]
  if (!first) return ''
  const parts: (string | number)[] = ['M', first[0] ?? 0, first[1] ?? 0, 'Q']
  for (let i = 0; i < stroke.length; i++) {
    const a = stroke[i]
    const b = stroke[(i + 1) % stroke.length]
    if (!a || !b) continue
    const ax = a[0] ?? 0
    const ay = a[1] ?? 0
    const bx = b[0] ?? 0
    const by = b[1] ?? 0
    parts.push(ax, ay, (ax + bx) / 2, (ay + by) / 2)
  }
  parts.push('Z')
  return parts.join(' ')
}

function computeStrokePath(points: number[][]): string {
  return strokeToSvgPath(getStroke(points, STROKE_OPTIONS))
}

/**
 * Read cached SVG path from an annotation. Falls back to recomputation if
 * the annotation predates the cache (or was hand-edited in the JSON export).
 */
function pathFromAnnotation(ann: Annotation): string {
  const data = ann.data as Partial<StrokeData> | undefined
  if (data?.cachedPath) return data.cachedPath
  if (data?.points) return computeStrokePath(data.points)
  return ''
}

export function AnnotationLayer() {
  const annotations = useDesignStore((s) => s.design.annotations)
  const addAnnotation = useDesignStore((s) => s.addAnnotation)
  const removeAnnotation = useDesignStore((s) => s.removeAnnotation)
  const penTool = useUIStore((s) => s.penTool)

  const { x: vx, y: vy, zoom } = useViewport()
  const reactFlow = useReactFlow()

  const [livePoints, setLivePoints] = useState<number[][] | null>(null)
  const drawingRef = useRef(false)

  const livePath = useMemo(
    () => (livePoints ? computeStrokePath(livePoints) : null),
    [livePoints],
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (penTool !== 'pen') return
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      drawingRef.current = true
      const flow = reactFlow.screenToFlowPosition({ x: e.clientX, y: e.clientY })
      setLivePoints([[flow.x, flow.y, e.pressure || 0.5]])
    },
    [penTool, reactFlow],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!drawingRef.current || penTool !== 'pen') return
      const flow = reactFlow.screenToFlowPosition({ x: e.clientX, y: e.clientY })
      setLivePoints((prev) =>
        prev ? [...prev, [flow.x, flow.y, e.pressure || 0.5]] : null,
      )
    },
    [penTool, reactFlow],
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!drawingRef.current) return
      drawingRef.current = false
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        // ignore — pointer may already be released
      }
      const points = livePoints
      setLivePoints(null)
      if (!points || points.length < 2) return
      const cachedPath = computeStrokePath(points)
      const data: StrokeData = { points, options: STROKE_OPTIONS, cachedPath }
      addAnnotation({
        id: nanoid(),
        kind: 'stroke',
        data,
        layer: 'annotation',
        createdAt: new Date().toISOString(),
      })
    },
    [livePoints, addAnnotation],
  )

  const layerPointerEvents = penTool === 'off' ? 'none' : 'auto'
  // Pen scales with the inverse of zoom so the visual stroke width feels consistent.
  // Without this, drawing at zoom 0.5 would produce visually 2× thicker strokes than at zoom 1.
  const strokeFill = '#1a1a1a'

  return (
    <svg
      className="absolute inset-0"
      style={{
        pointerEvents: layerPointerEvents,
        cursor: penTool === 'pen' ? 'crosshair' : penTool === 'eraser' ? 'cell' : 'default',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* Apply React Flow's transform so flow-coord points render at the right place */}
      <g transform={`translate(${vx} ${vy}) scale(${zoom})`}>
        {annotations.map((ann) => {
          const d = pathFromAnnotation(ann)
          if (!d) return null
          return (
            <path
              key={ann.id}
              d={d}
              fill={strokeFill}
              style={{
                pointerEvents: penTool === 'eraser' ? 'auto' : 'none',
                cursor: penTool === 'eraser' ? 'cell' : 'inherit',
              }}
              onClick={(e) => {
                if (penTool !== 'eraser') return
                e.stopPropagation()
                removeAnnotation(ann.id)
              }}
            />
          )
        })}
        {livePath && <path d={livePath} fill={strokeFill} pointerEvents="none" />}
      </g>
    </svg>
  )
}
