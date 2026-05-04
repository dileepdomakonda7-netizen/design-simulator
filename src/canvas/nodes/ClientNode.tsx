import type { NodeProps } from '@xyflow/react'
import type { Node as RFNode } from '@xyflow/react'
import type { Node } from '@/schema/types'
import { BaseNode } from './BaseNode'
import { ClientIcon } from './icons/ClientIcon'

type Data = { schemaNode: Node }

export function ClientNode({ data, selected }: NodeProps<RFNode<Data, 'client'>>) {
  const node = data.schemaNode
  if (node.type !== 'client') {
    throw new Error(`ClientNode received node of type "${node.type}"`)
  }
  return (
    <BaseNode schemaNode={node} icon={<ClientIcon />} selected={selected ?? false}>
      <div className="font-caveat text-sm text-neutral-500">{node.params.rps} RPS</div>
    </BaseNode>
  )
}
