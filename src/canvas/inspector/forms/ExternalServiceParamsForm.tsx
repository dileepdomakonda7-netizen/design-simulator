import type { Node } from '@/schema/types'
import { useDesignStore } from '@/store/designStore'
import { NumberField } from '../fields/NumberField'
import { SliderField } from '../fields/SliderField'

interface Props {
  node: Extract<Node, { type: 'external_service' }>
}

export function ExternalServiceParamsForm({ node }: Props) {
  const update = useDesignStore((s) => s.updateNodeParams)
  return (
    <div className="space-y-1.5">
      <NumberField
        label="Latency p50"
        value={node.params.latency_ms_p50}
        onChange={(v) => update(node.id, 'external_service', { latency_ms_p50: v })}
        min={0}
        suffix="ms"
      />
      <NumberField
        label="Latency p99"
        value={node.params.latency_ms_p99}
        onChange={(v) => update(node.id, 'external_service', { latency_ms_p99: v })}
        min={0}
        suffix="ms"
      />
      <NumberField
        label="Timeout"
        value={node.params.timeout_ms}
        onChange={(v) => update(node.id, 'external_service', { timeout_ms: v })}
        min={0}
        suffix="ms"
      />
      <NumberField
        label="Rate limit"
        value={node.params.rate_limit_rps}
        onChange={(v) => update(node.id, 'external_service', { rate_limit_rps: v })}
        min={0}
        suffix="rps"
        hint="0 = no limit"
      />
      <SliderField
        label="Failure rate"
        value={node.params.failure_rate}
        onChange={(v) => update(node.id, 'external_service', { failure_rate: v })}
        asPercent
      />
    </div>
  )
}
