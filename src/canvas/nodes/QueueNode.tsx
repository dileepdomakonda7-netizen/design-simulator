import type { NodeProps, Node as RFNode } from '@xyflow/react'
import type { Node } from '@/schema/types'
import { BaseNode } from './BaseNode'
import { QueueIcon } from './icons/QueueIcon'

type Data = { schemaNode: Node }

export function QueueNode({ data, selected }: NodeProps<RFNode<Data, 'queue'>>) {
  const node = data.schemaNode
  if (node.type !== 'queue') {
    throw new Error(`QueueNode received node of type "${node.type}"`)
  }
  const depth = node.params.max_depth
  return (
    <BaseNode schemaNode={node} icon={<QueueIcon />} selected={selected ?? false}>
      <div className="font-caveat text-sm text-neutral-500">
        depth: {depth > 0 ? depth : '∞'}
      </div>
    </BaseNode>
  )
}
