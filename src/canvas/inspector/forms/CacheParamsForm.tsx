import type { Node } from '@/schema/types'
import { useDesignStore } from '@/store/designStore'
import { NumberField } from '../fields/NumberField'
import { LatencyPair } from '../fields/LatencyPair'
import { SelectField } from '../fields/SelectField'
import { SliderField } from '../fields/SliderField'

interface Props {
  node: Extract<Node, { type: 'cache' }>
}

const POLICIES = [
  { value: 'lru', label: 'LRU' },
  { value: 'lfu', label: 'LFU' },
  { value: 'fifo', label: 'FIFO' },
] as const

export function CacheParamsForm({ node }: Props) {
  const update = useDesignStore((s) => s.updateNodeParams)
  return (
    <div className="space-y-1.5">
      <SliderField
        label="Hit rate"
        value={node.params.hit_rate}
        onChange={(v) => update(node.id, 'cache', { hit_rate: v })}
        asPercent
      />
      <NumberField
        label="Capacity"
        value={node.params.capacity_items}
        onChange={(v) => update(node.id, 'cache', { capacity_items: Math.round(v) })}
        min={1}
        max={1_000_000_000}
        step={1}
        suffix="items"
      />
      <SelectField
        label="Eviction"
        value={node.params.eviction_policy}
        options={POLICIES}
        onChange={(v) => update(node.id, 'cache', { eviction_policy: v })}
      />
      <LatencyPair
        p50Label="Read latency p50"
        p99Label="Read latency p99"
        p50={node.params.read_latency_ms_p50}
        p99={node.params.read_latency_ms_p99}
        onChange={({ p50, p99 }) =>
          update(node.id, 'cache', { read_latency_ms_p50: p50, read_latency_ms_p99: p99 })
        }
      />
      <SliderField
        label="Failure rate"
        value={node.params.failure_rate}
        onChange={(v) => update(node.id, 'cache', { failure_rate: v })}
        asPercent
      />
    </div>
  )
}
