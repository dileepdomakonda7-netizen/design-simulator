import type { NodeProps, Node as RFNode } from '@xyflow/react'
import type { Node } from '@/schema/types'
import { BaseNode } from './BaseNode'
import { ApiGatewayIcon } from './icons/ApiGatewayIcon'

type Data = { schemaNode: Node }

export function ApiGatewayNode({ data, selected }: NodeProps<RFNode<Data, 'api_gateway'>>) {
  const node = data.schemaNode
  if (node.type !== 'api_gateway') {
    throw new Error(`ApiGatewayNode received node of type "${node.type}"`)
  }
  const limit = node.params.rate_limit_rps
  return (
    <BaseNode schemaNode={node} icon={<ApiGatewayIcon />} selected={selected ?? false}>
      <div className="font-caveat text-sm text-neutral-500">
        rate: {limit > 0 ? `${limit}/s` : '∞'}
      </div>
    </BaseNode>
  )
}
