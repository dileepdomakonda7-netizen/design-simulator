import type { NodeProps, Node as RFNode } from '@xyflow/react'
import type { Node } from '@/schema/types'
import { BaseNode } from './BaseNode'
import { DatabaseIcon } from './icons/DatabaseIcon'

type Data = { schemaNode: Node }

export function DatabaseNode({ data, selected }: NodeProps<RFNode<Data, 'database'>>) {
  const node = data.schemaNode
  if (node.type !== 'database') {
    throw new Error(`DatabaseNode received node of type "${node.type}"`)
  }
  return (
    <BaseNode
      schemaNode={node}
      icon={<DatabaseIcon subtype={node.params.subtype} />}
      selected={selected ?? false}
    >
      <div className="font-caveat text-sm text-neutral-500">
        {node.params.subtype} · {node.params.replicas}x
      </div>
    </BaseNode>
  )
}
