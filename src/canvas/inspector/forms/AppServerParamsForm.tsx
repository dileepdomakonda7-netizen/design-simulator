import type { Node } from '@/schema/types'
import { useDesignStore } from '@/store/designStore'
import { NumberField } from '../fields/NumberField'
import { SliderField } from '../fields/SliderField'
import { SelectField } from '../fields/SelectField'

const REJECTION_POLICIES = [
  { value: 'reject_newest', label: 'Reject newest (default)' },
  { value: 'reject_oldest', label: 'Reject oldest (displace)' },
  { value: 'block', label: 'Block (50ms backoff × 5)' },
] as const

interface Props {
  node: Extract<Node, { type: 'app_server' }>
}

export function AppServerParamsForm({ node }: Props) {
  const update = useDesignStore((s) => s.updateNodeParams)
  return (
    <div className="space-y-1.5">
      <NumberField
        label="Instances"
        value={node.params.instances}
        onChange={(v) => update(node.id, 'app_server', { instances: Math.round(v) })}
        min={1}
        step={1}
      />
      <NumberField
        label="Max concurrent"
        value={node.params.max_concurrent_per_instance}
        onChange={(v) =>
          update(node.id, 'app_server', { max_concurrent_per_instance: Math.round(v) })
        }
        min={1}
        step={1}
        hint="Per instance"
      />
      <NumberField
        label="Latency p50"
        value={node.params.latency_ms_p50}
        onChange={(v) => update(node.id, 'app_server', { latency_ms_p50: v })}
        min={0}
        suffix="ms"
      />
      <NumberField
        label="Latency p99"
        value={node.params.latency_ms_p99}
        onChange={(v) => update(node.id, 'app_server', { latency_ms_p99: v })}
        min={0}
        suffix="ms"
      />
      <SliderField
        label="Failure rate"
        value={node.params.failure_rate}
        onChange={(v) => update(node.id, 'app_server', { failure_rate: v })}
        asPercent
      />
      {/* Phase 6a backpressure. Both fields are optional — leaving queue depth
          blank keeps Phase 4 unbounded behavior. */}
      <NumberField
        label="Queue max depth"
        value={node.params.queue_max_depth ?? 0}
        onChange={(v) =>
          update(node.id, 'app_server', { queue_max_depth: Math.max(0, Math.round(v)) })
        }
        min={0}
        step={1}
        hint="0 = unbounded (Phase 4 default)"
      />
      <SelectField
        label="Rejection policy"
        value={node.params.rejection_policy ?? 'reject_newest'}
        options={REJECTION_POLICIES}
        onChange={(v) => update(node.id, 'app_server', { rejection_policy: v })}
        disabled={!node.params.queue_max_depth || node.params.queue_max_depth <= 0}
      />
    </div>
  )
}
