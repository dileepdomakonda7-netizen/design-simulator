import type { Node } from '@/schema/types'
import { useDesignStore } from '@/store/designStore'
import { NumberField } from '../fields/NumberField'
import { RetryPolicyEditor } from '../fields/RetryPolicyEditor'

interface Props {
  node: Extract<Node, { type: 'client' }>
}

export function ClientParamsForm({ node }: Props) {
  const update = useDesignStore((s) => s.updateNodeParams)
  return (
    <div className="space-y-1.5">
      <NumberField
        label="RPS"
        value={node.params.rps}
        onChange={(v) => update(node.id, 'client', { rps: v })}
        min={0}
        step={1}
        suffix="req/s"
      />
      <NumberField
        label="Think time"
        value={node.params.think_time_ms}
        onChange={(v) => update(node.id, 'client', { think_time_ms: v })}
        min={0}
        suffix="ms"
      />
      <NumberField
        label="Timeout"
        value={node.params.timeout_ms}
        onChange={(v) => update(node.id, 'client', { timeout_ms: v })}
        min={0}
        suffix="ms"
      />
      <RetryPolicyEditor
        value={node.params.retry_policy}
        onChange={(v) => update(node.id, 'client', { retry_policy: v })}
      />
    </div>
  )
}
