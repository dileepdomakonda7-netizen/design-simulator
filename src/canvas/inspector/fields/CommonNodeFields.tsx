import type { Node } from '@/schema/types'
import { useDesignStore } from '@/store/designStore'
import { TextField } from './TextField'

const TYPE_LABELS: Record<Node['type'], string> = {
  client: 'Client',
  load_balancer: 'Load Balancer',
  api_gateway: 'API Gateway',
  app_server: 'App Server',
  cache: 'Cache',
  database: 'Database',
  queue: 'Queue',
  pub_sub: 'Pub/Sub',
  cdn: 'CDN',
  object_storage: 'Object Storage',
  external_service: 'External Service',
}

export function CommonNodeFields({ node }: { node: Node }) {
  const updateNodeMeta = useDesignStore((s) => s.updateNodeMeta)
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-xs text-neutral-500">
        <span className="w-32 shrink-0">Type</span>
        <span className="font-medium text-neutral-800">{TYPE_LABELS[node.type]}</span>
      </div>
      <TextField
        label="Label"
        value={node.label}
        onChange={(label) => updateNodeMeta(node.id, { label })}
      />
    </div>
  )
}
