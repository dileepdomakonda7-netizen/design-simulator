import type { Node } from '@/schema/types'
import { useDesignStore } from '@/store/designStore'
import { NumberField } from '../fields/NumberField'
import { SliderField } from '../fields/SliderField'

interface Props {
  node: Extract<Node, { type: 'api_gateway' }>
}

export function ApiGatewayParamsForm({ node }: Props) {
  const update = useDesignStore((s) => s.updateNodeParams)
  return (
    <div className="space-y-1.5">
      <NumberField
        label="Rate limit"
        value={node.params.rate_limit_rps}
        onChange={(v) => update(node.id, 'api_gateway', { rate_limit_rps: v })}
        min={0}
        suffix="req/s"
        hint="0 = unlimited"
      />
      <NumberField
        label="Auth overhead"
        value={node.params.auth_overhead_ms}
        onChange={(v) => update(node.id, 'api_gateway', { auth_overhead_ms: v })}
        min={0}
        suffix="ms"
      />
      <NumberField
        label="Timeout"
        value={node.params.timeout_ms}
        onChange={(v) => update(node.id, 'api_gateway', { timeout_ms: v })}
        min={0}
        suffix="ms"
      />
      <SliderField
        label="Failure rate"
        value={node.params.failure_rate}
        onChange={(v) => update(node.id, 'api_gateway', { failure_rate: v })}
        asPercent
      />
    </div>
  )
}
