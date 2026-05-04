import type { NodeProps, Node as RFNode } from '@xyflow/react'
import type { Node } from '@/schema/types'
import { BaseNode } from './BaseNode'
import { AppServerIcon } from './icons/AppServerIcon'

type Data = { schemaNode: Node }

export function AppServerNode({ data, selected }: NodeProps<RFNode<Data, 'app_server'>>) {
  const node = data.schemaNode
  if (node.type !== 'app_server') {
    throw new Error(`AppServerNode received node of type "${node.type}"`)
  }
  return (
    <BaseNode schemaNode={node} icon={<AppServerIcon />} selected={selected ?? false}>
      <div className="font-caveat text-sm text-neutral-500">
        {node.params.instances} instances
      </div>
    </BaseNode>
  )
}
