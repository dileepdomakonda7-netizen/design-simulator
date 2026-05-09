import type { Node } from '@/schema/types'
import { useDesignStore } from '@/store/designStore'
import { NumberField } from '../fields/NumberField'
import { LatencyPair } from '../fields/LatencyPair'
import { SliderField } from '../fields/SliderField'

interface Props {
  node: Extract<Node, { type: 'object_storage' }>
}

export function ObjectStorageParamsForm({ node }: Props) {
  const update = useDesignStore((s) => s.updateNodeParams)
  return (
    <div className="space-y-1.5">
      <LatencyPair
        p50Label="Read latency p50"
        p99Label="Read latency p99"
        p50={node.params.read_latency_ms_p50}
        p99={node.params.read_latency_ms_p99}
        onChange={({ p50, p99 }) =>
          update(node.id, 'object_storage', {
            read_latency_ms_p50: p50,
            read_latency_ms_p99: p99,
          })
        }
      />
      <LatencyPair
        p50Label="Write latency p50"
        p99Label="Write latency p99"
        p50={node.params.write_latency_ms_p50}
        p99={node.params.write_latency_ms_p99}
        onChange={({ p50, p99 }) =>
          update(node.id, 'object_storage', {
            write_latency_ms_p50: p50,
            write_latency_ms_p99: p99,
          })
        }
      />
      <NumberField
        label="Throughput"
        value={node.params.throughput_mbps}
        onChange={(v) => update(node.id, 'object_storage', { throughput_mbps: v })}
        min={0}
        max={1_000_000}
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
