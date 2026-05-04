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

function pathFromAnnotation(ann: Annotation): string {
  const data = ann.data as Partial<StrokeData> | undefined
  if (data?.cachedPath) return data.cachedPath
  if (data?.points) return computeStrokePath(data.points)
  return ''
}

/**
 * Annotation layer — overlay above React Flow.
 *
 * Critical layout details (rediscovered the hard way):
 *
 * 1. The overlay MUST sit at z-index >= 7 to be above React Flow's internals.
 *    React Flow assigns z-index up to 6 (.react-flow__selection); the
 *    .react-flow__renderer is at z-index 4. With no explicit z-index, our
 *    overlay would sit at z-auto (= 0) in the wrapper's stacking context,
 *    BEHIND the React Flow pane regardless of DOM order — so even with
 *    pointer-events: auto the pane swallows the events.
 *
 * 2. The overlay is a <div> wrapper, not a bare <svg>. Divs handle CSS
 *    pointer-events / cursor predictably; SVG <svg> elements have peculiar
 *    pointer-events behavior on empty regions.
 *
 * 3. pointer-events on the wrapper toggles by penTool:
 *      - 'off'    → 'none'   (clicks pass through to React Flow normally)
 *      - 'pen'    → 'auto'   (wrapper captures draw events)
 *      - 'eraser' → 'auto'   (wrapper captures, but pointer handlers no-op;
 *                              path elements inside get pointer-events: auto
 *                              so click-to-remove still works)
 */
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
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Only the pen draws; eraser / off no-op (click-to-remove fires on path elements).
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
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!drawingRef.current || penTool !== 'pen') return
      const flow = reactFlow.screenToFlowPosition({ x: e.clientX, y: e.clientY })
      setLivePoints((prev) =>
        prev ? [...prev, [flow.x, flow.y, e.pressure || 0.5]] : null,
      )
    },
    [penTool, reactFlow],
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!drawingRef.current) return
      drawingRef.current = false
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        // pointer may already be released
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

  const wrapperPointerEvents = penTool === 'off' ? 'none' : 'auto'
  const cursor =
    penTool === 'pen' ? 'crosshair' : penTool === 'eraser' ? 'cell' : 'default'

  return (
    <div
      className="absolute inset-0"
      style={{
        zIndex: 10, // above React Flow's .react-flow__selection (z-index: 6)
        pointerEvents: wrapperPointerEvents,
        cursor,
        touchAction: penTool === 'pen' ? 'none' : 'auto', // prevent touch-pan eating drags
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <svg
        width="100%"
        height="100%"
        style={{ pointerEvents: 'none', overflow: 'visible' }}
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
                fill="#1a1a1a"
                style={{
                  // Click-to-remove only in eraser mode; otherwise let events pass through
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
          {livePath && <path d={livePath} fill="#1a1a1a" style={{ pointerEvents: 'none' }} />}
        </g>
      </svg>
    </div>
  )
}
