import type { NodeProps, Node as RFNode } from '@xyflow/react'
import type { Node } from '@/schema/types'
import { BaseNode } from './BaseNode'
import { CacheIcon } from './icons/CacheIcon'

type Data = { schemaNode: Node }

export function CacheNode({ data, selected }: NodeProps<RFNode<Data, 'cache'>>) {
  const node = data.schemaNode
  if (node.type !== 'cache') {
    throw new Error(`CacheNode received node of type "${node.type}"`)
  }
  return (
    <BaseNode schemaNode={node} icon={<CacheIcon />} selected={selected ?? false}>
      <div className="font-caveat text-sm text-neutral-500">
        {Math.round(node.params.hit_rate * 100)}% hit
      </div>
    </BaseNode>
  )
}
