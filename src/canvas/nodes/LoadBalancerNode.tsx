import type { NodeProps, Node as RFNode } from '@xyflow/react'
import type { Node } from '@/schema/types'
import { BaseNode } from './BaseNode'
import { LoadBalancerIcon } from './icons/LoadBalancerIcon'

type Data = { schemaNode: Node }

export function LoadBalancerNode({ data, selected }: NodeProps<RFNode<Data, 'load_balancer'>>) {
  const node = data.schemaNode
  if (node.type !== 'load_balancer') {
    throw new Error(`LoadBalancerNode received node of type "${node.type}"`)
  }
  return (
    <BaseNode schemaNode={node} icon={<LoadBalancerIcon />} selected={selected ?? false}>
      <div className="font-caveat text-sm text-neutral-500">
        {node.params.algorithm.replace(/_/g, ' ')}
      </div>
    </BaseNode>
  )
}
