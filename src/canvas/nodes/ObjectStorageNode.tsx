import type { NodeProps, Node as RFNode } from '@xyflow/react'
import type { Node } from '@/schema/types'
import { BaseNode } from './BaseNode'
import { ObjectStorageIcon } from './icons/ObjectStorageIcon'

type Data = { schemaNode: Node }

export function ObjectStorageNode({ data, selected }: NodeProps<RFNode<Data, 'object_storage'>>) {
  const node = data.schemaNode
  if (node.type !== 'object_storage') {
    throw new Error(`ObjectStorageNode received node of type "${node.type}"`)
  }
  return (
    <BaseNode schemaNode={node} icon={<ObjectStorageIcon />} selected={selected ?? false}>
      <div className="font-caveat text-sm text-neutral-500">
        {node.params.throughput_mbps} Mbps
      </div>
    </BaseNode>
  )
}
