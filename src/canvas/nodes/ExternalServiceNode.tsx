import type { NodeProps, Node as RFNode } from '@xyflow/react'
import type { Node } from '@/schema/types'
import { BaseNode } from './BaseNode'
import { ExternalServiceIcon } from './icons/ExternalServiceIcon'

type Data = { schemaNode: Node }

export function ExternalServiceNode({ data, selected }: NodeProps<RFNode<Data, 'external_service'>>) {
  const node = data.schemaNode
  if (node.type !== 'external_service') {
    throw new Error(`ExternalServiceNode received node of type "${node.type}"`)
  }
  return (
    <BaseNode schemaNode={node} icon={<ExternalServiceIcon />} selected={selected ?? false}>
      <div className="font-caveat text-sm text-neutral-500">ext</div>
    </BaseNode>
  )
}
