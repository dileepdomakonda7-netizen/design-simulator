import type { NodeProps, Node as RFNode } from '@xyflow/react'
import type { Node } from '@/schema/types'
import { BaseNode } from './BaseNode'
import { PubSubIcon } from './icons/PubSubIcon'

type Data = { schemaNode: Node }

export function PubSubNode({ data, selected }: NodeProps<RFNode<Data, 'pub_sub'>>) {
  const node = data.schemaNode
  if (node.type !== 'pub_sub') {
    throw new Error(`PubSubNode received node of type "${node.type}"`)
  }
  return (
    <BaseNode schemaNode={node} icon={<PubSubIcon />} selected={selected ?? false}>
      <div className="font-caveat text-sm text-neutral-500">
        {node.params.subscriber_count} subs
      </div>
    </BaseNode>
  )
}
