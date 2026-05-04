import type { ReactNode } from 'react'

export const ICON_SIZE = 26

interface IconBaseProps {
  children: ReactNode
}

/**
 * Plain hand-drawn SVG icons (not rough.js — avoids per-icon useEffect overhead
 * with 20+ nodes on screen). Wobble lives in the path data itself.
 */
export function IconBase({ children }: IconBaseProps) {
  return (
    <svg
      width={ICON_SIZE}
      height={ICON_SIZE}
      viewBox="0 0 32 32"
      fill="none"
      stroke="#1a1a1a"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  )
}
