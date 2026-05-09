import type { Node } from '@/schema/types'
import { useDesignStore } from '@/store/designStore'
import { NumberField } from '../fields/NumberField'
import { LatencyPair } from '../fields/LatencyPair'
import { SliderField } from '../fields/SliderField'

interface Props {
  node: Extract<Node, { type: 'pub_sub' }>
}

export function PubSubParamsForm({ node }: Props) {
  const update = useDesignStore((s) => s.updateNodeParams)
  return (
    <div className="space-y-1.5">
      <NumberField
        label="Subscribers"
        value={node.params.subscriber_count}
        onChange={(v) => update(node.id, 'pub_sub', { subscriber_count: Math.round(v) })}
        min={1}
        max={100000}
        step={1}
      />
      <LatencyPair
        p50Label="Delivery p50"
        p99Label="Delivery p99"
        p50={node.params.delivery_latency_ms_p50}
        p99={node.params.delivery_latency_ms_p99}
        onChange={({ p50, p99 }) =>
          update(node.id, 'pub_sub', {
            delivery_latency_ms_p50: p50,
            delivery_latency_ms_p99: p99,
          })
        }
      />
      <SliderField
        label="Failure rate"
        value={node.params.failure_rate}
        onChange={(v) => update(node.id, 'pub_sub', { failure_rate: v })}
        asPercent
      />
    </div>
  )
}
