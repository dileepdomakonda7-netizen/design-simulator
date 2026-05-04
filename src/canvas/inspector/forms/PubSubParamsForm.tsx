import type { Node } from '@/schema/types'
import { useDesignStore } from '@/store/designStore'
import { NumberField } from '../fields/NumberField'
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
        step={1}
      />
      <NumberField
        label="Delivery p50"
        value={node.params.delivery_latency_ms_p50}
        onChange={(v) => update(node.id, 'pub_sub', { delivery_latency_ms_p50: v })}
        min={0}
        suffix="ms"
      />
      <NumberField
        label="Delivery p99"
        value={node.params.delivery_latency_ms_p99}
        onChange={(v) => update(node.id, 'pub_sub', { delivery_latency_ms_p99: v })}
        min={0}
        suffix="ms"
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
