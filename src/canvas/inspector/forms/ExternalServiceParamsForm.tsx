import type { Node } from '@/schema/types'
import { useDesignStore } from '@/store/designStore'
import { NumberField } from '../fields/NumberField'
import { LatencyPair, MAX_LATENCY_MS } from '../fields/LatencyPair'
import { SliderField } from '../fields/SliderField'

interface Props {
  node: Extract<Node, { type: 'external_service' }>
}

export function ExternalServiceParamsForm({ node }: Props) {
  const update = useDesignStore((s) => s.updateNodeParams)
  return (
    <div className="space-y-1.5">
      <LatencyPair
        p50={node.params.latency_ms_p50}
        p99={node.params.latency_ms_p99}
        onChange={({ p50, p99 }) =>
          update(node.id, 'external_service', { latency_ms_p50: p50, latency_ms_p99: p99 })
        }
      />
      <NumberField
        label="Timeout"
        value={node.params.timeout_ms}
        onChange={(v) => update(node.id, 'external_service', { timeout_ms: v })}
        min={0}
        max={MAX_LATENCY_MS}
        suffix="ms"
      />
      <NumberField
        label="Rate limit"
        value={node.params.rate_limit_rps}
        onChange={(v) => update(node.id, 'external_service', { rate_limit_rps: v })}
        min={0}
        max={1_000_000}
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
