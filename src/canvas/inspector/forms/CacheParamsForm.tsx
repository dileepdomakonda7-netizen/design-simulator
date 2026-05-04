import type { Node } from '@/schema/types'
import { useDesignStore } from '@/store/designStore'
import { NumberField } from '../fields/NumberField'
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
        step={1}
        suffix="items"
      />
      <SelectField
        label="Eviction"
        value={node.params.eviction_policy}
        options={POLICIES}
        onChange={(v) => update(node.id, 'cache', { eviction_policy: v })}
      />
      <NumberField
        label="Read latency p50"
        value={node.params.read_latency_ms_p50}
        onChange={(v) => update(node.id, 'cache', { read_latency_ms_p50: v })}
        min={0}
        suffix="ms"
      />
      <NumberField
        label="Read latency p99"
        value={node.params.read_latency_ms_p99}
        onChange={(v) => update(node.id, 'cache', { read_latency_ms_p99: v })}
        min={0}
        suffix="ms"
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
