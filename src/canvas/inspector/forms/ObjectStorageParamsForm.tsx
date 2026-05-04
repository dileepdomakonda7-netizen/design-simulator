import type { Node } from '@/schema/types'
import { useDesignStore } from '@/store/designStore'
import { NumberField } from '../fields/NumberField'
import { SliderField } from '../fields/SliderField'

interface Props {
  node: Extract<Node, { type: 'object_storage' }>
}

export function ObjectStorageParamsForm({ node }: Props) {
  const update = useDesignStore((s) => s.updateNodeParams)
  return (
    <div className="space-y-1.5">
      <NumberField
        label="Read latency p50"
        value={node.params.read_latency_ms_p50}
        onChange={(v) => update(node.id, 'object_storage', { read_latency_ms_p50: v })}
        min={0}
        suffix="ms"
      />
      <NumberField
        label="Read latency p99"
        value={node.params.read_latency_ms_p99}
        onChange={(v) => update(node.id, 'object_storage', { read_latency_ms_p99: v })}
        min={0}
        suffix="ms"
      />
      <NumberField
        label="Write latency p50"
        value={node.params.write_latency_ms_p50}
        onChange={(v) => update(node.id, 'object_storage', { write_latency_ms_p50: v })}
        min={0}
        suffix="ms"
      />
      <NumberField
        label="Write latency p99"
        value={node.params.write_latency_ms_p99}
        onChange={(v) => update(node.id, 'object_storage', { write_latency_ms_p99: v })}
        min={0}
        suffix="ms"
      />
      <NumberField
        label="Throughput"
        value={node.params.throughput_mbps}
        onChange={(v) => update(node.id, 'object_storage', { throughput_mbps: v })}
        min={0}
        suffix="Mbps"
      />
      <SliderField
        label="Failure rate"
        value={node.params.failure_rate}
        onChange={(v) => update(node.id, 'object_storage', { failure_rate: v })}
        asPercent
      />
    </div>
  )
}
