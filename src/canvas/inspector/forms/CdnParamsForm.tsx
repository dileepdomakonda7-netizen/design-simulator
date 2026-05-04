import type { Node } from '@/schema/types'
import { useDesignStore } from '@/store/designStore'
import { NumberField } from '../fields/NumberField'
import { SliderField } from '../fields/SliderField'

interface Props {
  node: Extract<Node, { type: 'cdn' }>
}

export function CdnParamsForm({ node }: Props) {
  const update = useDesignStore((s) => s.updateNodeParams)
  return (
    <div className="space-y-1.5">
      <SliderField
        label="Hit rate"
        value={node.params.hit_rate}
        onChange={(v) => update(node.id, 'cdn', { hit_rate: v })}
        asPercent
      />
      <NumberField
        label="Edge latency p50"
        value={node.params.edge_latency_ms_p50}
        onChange={(v) => update(node.id, 'cdn', { edge_latency_ms_p50: v })}
        min={0}
        suffix="ms"
      />
      <NumberField
        label="Edge latency p99"
        value={node.params.edge_latency_ms_p99}
        onChange={(v) => update(node.id, 'cdn', { edge_latency_ms_p99: v })}
        min={0}
        suffix="ms"
      />
      <NumberField
        label="Origin pull timeout"
        value={node.params.origin_pull_timeout_ms}
        onChange={(v) => update(node.id, 'cdn', { origin_pull_timeout_ms: v })}
        min={0}
        suffix="ms"
      />
      <SliderField
        label="Failure rate"
        value={node.params.failure_rate}
        onChange={(v) => update(node.id, 'cdn', { failure_rate: v })}
        asPercent
      />
    </div>
  )
}
