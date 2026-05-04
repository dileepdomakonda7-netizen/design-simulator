import type { NodeProps, Node as RFNode } from '@xyflow/react'
import type { Node } from '@/schema/types'
import { BaseNode } from './BaseNode'
import { CdnIcon } from './icons/CdnIcon'

type Data = { schemaNode: Node }

export function CdnNode({ data, selected }: NodeProps<RFNode<Data, 'cdn'>>) {
  const node = data.schemaNode
  if (node.type !== 'cdn') {
    throw new Error(`CdnNode received node of type "${node.type}"`)
  }
  return (
    <BaseNode schemaNode={node} icon={<CdnIcon />} selected={selected ?? false}>
      <div className="font-caveat text-sm text-neutral-500">
        {Math.round(node.params.hit_rate * 100)}% edge hit
      </div>
    </BaseNode>
  )
}
