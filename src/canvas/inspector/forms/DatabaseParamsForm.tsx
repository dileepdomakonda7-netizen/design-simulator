import type { Node } from '@/schema/types'
import { useDesignStore } from '@/store/designStore'
import { NumberField } from '../fields/NumberField'
import { SelectField } from '../fields/SelectField'
import { SliderField } from '../fields/SliderField'

interface Props {
  node: Extract<Node, { type: 'database' }>
}

const SUBTYPES = [
  { value: 'relational', label: 'Relational' },
  { value: 'kv', label: 'Key-Value' },
  { value: 'document', label: 'Document' },
] as const

const REPLICATION_MODES = [
  { value: 'sync', label: 'Synchronous' },
  { value: 'async', label: 'Asynchronous' },
] as const

const READ_ROUTING = [
  { value: 'primary_only', label: 'Primary only' },
  { value: 'replica_only', label: 'Replica only' },
  { value: 'mixed', label: 'Mixed (50/50)' },
] as const

export function DatabaseParamsForm({ node }: Props) {
  const update = useDesignStore((s) => s.updateNodeParams)
  const isAsync = node.params.replication_mode === 'async'
  const hasReplicas = node.params.replicas > 1
  const replicationActive = hasReplicas && isAsync
  return (
    <div className="space-y-1.5">
      <SelectField
        label="Subtype"
        value={node.params.subtype}
        options={SUBTYPES}
        onChange={(v) => update(node.id, 'database', { subtype: v })}
      />
      <NumberField
        label="Replicas"
        value={node.params.replicas}
        onChange={(v) => update(node.id, 'database', { replicas: Math.round(v) })}
        min={1}
        step={1}
      />
      <NumberField
        label="Read capacity"
        value={node.params.read_capacity_rps}
        onChange={(v) => update(node.id, 'database', { read_capacity_rps: v })}
        min={0}
        suffix="rps"
      />
      <NumberField
        label="Write capacity"
        value={node.params.write_capacity_rps}
        onChange={(v) => update(node.id, 'database', { write_capacity_rps: v })}
        min={0}
        suffix="rps"
      />
      <SelectField
        label="Replication"
        value={node.params.replication_mode}
        options={REPLICATION_MODES}
        onChange={(v) => update(node.id, 'database', { replication_mode: v })}
      />
      <SelectField
        label="Read routing"
        value={node.params.read_routing ?? 'primary_only'}
        options={READ_ROUTING}
        onChange={(v) => update(node.id, 'database', { read_routing: v })}
        disabled={!hasReplicas}
        hint="Replicas > 1 required. Replica reads return stale data (stalenessMs)."
      />
      <NumberField
        label="Repl. lag p50"
        value={node.params.replication_lag_ms_p50}
        onChange={(v) => update(node.id, 'database', { replication_lag_ms_p50: v })}
        min={0}
        suffix="ms"
        disabled={!replicationActive}
        hint="Only meaningful with async replication AND replicas > 1"
      />
      <NumberField
        label="Repl. lag p99"
        value={node.params.replication_lag_ms_p99}
        onChange={(v) => update(node.id, 'database', { replication_lag_ms_p99: v })}
        min={0}
        suffix="ms"
        disabled={!replicationActive}
      />
      <NumberField
        label="Read latency p50"
        value={node.params.read_latency_ms_p50}
        onChange={(v) => update(node.id, 'database', { read_latency_ms_p50: v })}
        min={0}
        suffix="ms"
      />
      <NumberField
        label="Read latency p99"
        value={node.params.read_latency_ms_p99}
        onChange={(v) => update(node.id, 'database', { read_latency_ms_p99: v })}
        min={0}
        suffix="ms"
      />
      <NumberField
        label="Write latency p50"
        value={node.params.write_latency_ms_p50}
        onChange={(v) => update(node.id, 'database', { write_latency_ms_p50: v })}
        min={0}
        suffix="ms"
      />
      <NumberField
        label="Write latency p99"
        value={node.params.write_latency_ms_p99}
        onChange={(v) => update(node.id, 'database', { write_latency_ms_p99: v })}
        min={0}
        suffix="ms"
      />
      <SliderField
        label="Failure rate"
        value={node.params.failure_rate}
        onChange={(v) => update(node.id, 'database', { failure_rate: v })}
        asPercent
      />
      <NumberField
        label="Read queue max depth"
        value={node.params.read_queue_max_depth ?? 0}
        onChange={(v) =>
          update(node.id, 'database', { read_queue_max_depth: Math.max(0, Math.round(v)) })
        }
        min={0}
        step={1}
        hint="0 = unbounded — over-cap arrivals reject immediately (Phase 4 default)"
      />
    </div>
  )
}
