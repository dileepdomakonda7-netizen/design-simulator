import type { Node } from '@/schema/types'
import { useDesignStore } from '@/store/designStore'
import { NumberField } from '../fields/NumberField'
import { SelectField } from '../fields/SelectField'
import { SliderField } from '../fields/SliderField'

interface Props {
  node: Extract<Node, { type: 'queue' }>
}

const GUARANTEES = [
  { value: 'at_most_once', label: 'At most once' },
  { value: 'at_least_once', label: 'At least once' },
  { value: 'exactly_once', label: 'Exactly once' },
] as const

const QUEUE_REJECTION_POLICIES = [
  { value: 'reject_newest', label: 'Reject newest (default)' },
  { value: 'reject_oldest', label: 'Reject oldest (silent loss)' },
] as const

export function QueueParamsForm({ node }: Props) {
  const update = useDesignStore((s) => s.updateNodeParams)
  return (
    <div className="space-y-1.5">
      <NumberField
        label="Max depth"
        value={node.params.max_depth}
        onChange={(v) => update(node.id, 'queue', { max_depth: Math.round(v) })}
        min={0}
        max={1_000_000}
        step={1}
        hint="0 = unbounded"
      />
      <NumberField
        label="Consumer rate"
        value={node.params.consumer_processing_rps}
        onChange={(v) => update(node.id, 'queue', { consumer_processing_rps: v })}
        min={0}
        max={1_000_000}
        suffix="rps"
      />
      <NumberField
        label="Visibility timeout"
        value={node.params.visibility_timeout_ms}
        onChange={(v) => update(node.id, 'queue', { visibility_timeout_ms: v })}
        min={0}
        max={600_000}
        suffix="ms"
      />
      <SelectField
        label="Delivery"
        value={node.params.delivery_guarantee}
        options={GUARANTEES}
        onChange={(v) => update(node.id, 'queue', { delivery_guarantee: v })}
      />
      <SliderField
        label="Failure rate"
        value={node.params.failure_rate}
        onChange={(v) => update(node.id, 'queue', { failure_rate: v })}
        asPercent
      />
      <SelectField
        label="Rejection policy"
        value={node.params.rejection_policy ?? 'reject_newest'}
        options={QUEUE_REJECTION_POLICIES}
        onChange={(v) => update(node.id, 'queue', { rejection_policy: v })}
        disabled={node.params.max_depth <= 0}
      />
    </div>
  )
}
