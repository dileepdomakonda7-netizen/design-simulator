import { memo, type ReactNode } from 'react'
import { Handle, Position } from '@xyflow/react'
import type { Node } from '@/schema/types'
import { RoughBox } from './RoughBox'
import { hashCode } from './util'

interface Props {
  schemaNode: Node
  icon: ReactNode
  selected: boolean
  width?: number
  height?: number
  children?: ReactNode
}

const SELECTED_OPTS = {
  stroke: '#2563eb',
  strokeWidth: 2.2,
  fill: 'transparent',
  roughness: 2,
  bowing: 2,
} as const

const HANDLE_STYLE = {
  width: 10,
  height: 10,
  background: '#fff',
  border: '1.5px solid #1a1a1a',
}

function BaseNodeImpl({ schemaNode, icon, selected, width = 180, height = 80, children }: Props) {
  const seed = hashCode(schemaNode.id)

  return (
    <div className="relative" style={{ width, height }}>
      {/* Body */}
      <RoughBox width={width} height={height} seed={seed} />

      {/* Selection outline — slightly larger than body */}
      {selected && (
        <div className="absolute -inset-1 pointer-events-none">
          <RoughBox
            width={width + 8}
            height={height + 8}
            seed={seed + 1}
            options={SELECTED_OPTS}
          />
        </div>
      )}

      {/* Content layer */}
      <div className="relative flex items-start gap-2 px-3 py-2 h-full">
        <div className="shrink-0 mt-0.5 text-neutral-900">{icon}</div>
        <div className="flex flex-col min-w-0 leading-tight">
          <div className="font-caveat text-lg text-neutral-900 truncate">
            {schemaNode.label}
          </div>
          {children}
        </div>
      </div>

      {/* Handles — left target / right source for sync_rpc-style flow */}
      <Handle type="target" position={Position.Left} style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Right} style={HANDLE_STYLE} />
    </div>
  )
}

export const BaseNode = memo(BaseNodeImpl)
