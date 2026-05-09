import type { Node } from '@/schema/types'
import { useDesignStore } from '@/store/designStore'
import { NumberField } from '../fields/NumberField'
import { LatencyPair, MAX_LATENCY_MS } from '../fields/LatencyPair'
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
      <LatencyPair
        p50Label="Edge latency p50"
        p99Label="Edge latency p99"
        p50={node.params.edge_latency_ms_p50}
        p99={node.params.edge_latency_ms_p99}
        onChange={({ p50, p99 }) =>
          update(node.id, 'cdn', { edge_latency_ms_p50: p50, edge_latency_ms_p99: p99 })
        }
      />
      <NumberField
        label="Origin pull timeout"
        value={node.params.origin_pull_timeout_ms}
        onChange={(v) => update(node.id, 'cdn', { origin_pull_timeout_ms: v })}
        min={0}
        max={MAX_LATENCY_MS}
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
