import { IconBase } from './iconBase'
import type { DatabaseSubtype } from '@/schema/types'

// Classic cylinder; horizontal divider lines vary by subtype.
export function DatabaseIcon({ subtype = 'relational' }: { subtype?: DatabaseSubtype }) {
  // relational: 3 dividers (rows). kv: 2. document: 1 (free-form).
  const dividers = subtype === 'relational' ? 3 : subtype === 'kv' ? 2 : 1
  const top = 6
  const bottom = 26
  const radiusY = 2.6

  const lines = []
  for (let i = 1; i <= dividers; i++) {
    const y = top + ((bottom - top) / (dividers + 1)) * i
    lines.push(<path key={i} d={`M7 ${y} Q16 ${y + 1.4} 25 ${y}`} />)
  }

  return (
    <IconBase>
      <ellipse cx="16" cy={top} rx="9" ry={radiusY} />
      <path d={`M7 ${top} V${bottom} Q7 ${bottom + radiusY} 16 ${bottom + radiusY} Q25 ${bottom + radiusY} 25 ${bottom} V${top}`} />
      {lines}
    </IconBase>
  )
}
