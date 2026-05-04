import { memo, useEffect, useRef } from 'react'
import rough from 'roughjs'
import type { Options } from 'roughjs/bin/core'

interface Props {
  width: number
  height: number
  seed: number
  options?: Partial<Options>
  className?: string
}

/**
 * Renders a rough.js sketchy rectangle into an SVG element. The SVG is
 * pointer-events-none so it never intercepts clicks meant for the React Flow
 * node interaction surface (the parent <div>).
 *
 * Memoized on width / height / seed / options ref equality. Pass a stable
 * `options` object (define it outside render or memoize) to avoid redraws.
 */
function RoughBoxImpl({ width, height, seed, options, className }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    while (svg.firstChild) svg.removeChild(svg.firstChild)
    const rc = rough.svg(svg)
    const rect = rc.rectangle(2, 2, width - 4, height - 4, {
      roughness: 1.2,
      bowing: 1,
      stroke: '#1a1a1a',
      strokeWidth: 1.4,
      fill: '#fafafa',
      fillStyle: 'hachure',
      fillWeight: 0.5,
      hachureGap: 6,
      seed,
      ...options,
    })
    svg.appendChild(rect)
  }, [width, height, seed, options])

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      className={`absolute inset-0 pointer-events-none ${className ?? ''}`}
    />
  )
}

export const RoughBox = memo(RoughBoxImpl)
