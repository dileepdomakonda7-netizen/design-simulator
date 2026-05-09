import type { Node } from '@/schema/types'
import { useDesignStore } from '@/store/designStore'
import { NumberField } from '../fields/NumberField'
import { LatencyPair } from '../fields/LatencyPair'
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

const CONSISTENCY_MODELS = [
  { value: 'linearizable', label: 'Linearizable (always primary)' },
  { value: 'read_your_writes', label: 'Read-your-writes' },
  { value: 'monotonic_reads', label: 'Monotonic reads' },
  { value: 'eventual', label: 'Eventual (any replica)' },
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
        max={100}
        step={1}
      />
      <NumberField
        label="Read capacity"
        value={node.params.read_capacity_rps}
        onChange={(v) => update(node.id, 'database', { read_capacity_rps: v })}
        min={0}
        max={1_000_000}
        suffix="rps"
      />
      <NumberField
        label="Write capacity"
        value={node.params.write_capacity_rps}
        onChange={(v) => update(node.id, 'database', { write_capacity_rps: v })}
        min={0}
        max={1_000_000}
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
        disabled={!hasReplicas || node.params.consistency_model !== undefined}
        hint={
          node.params.consistency_model
            ? 'Overridden by consistency_model'
            : 'Replicas > 1 required. Replica reads return stale data (stalenessMs).'
        }
      />
      {hasReplicas && (
        <SelectField
          label="Consistency"
          value={node.params.consistency_model ?? 'eventual'}
          options={CONSISTENCY_MODELS}
          onChange={(v) => update(node.id, 'database', { consistency_model: v })}
          disabled={!hasReplicas}
          hint="Overrides read routing. linearizable=primary; eventual=any replica; RYW/MR escalate to primary when a replica is too stale."
        />
      )}
      {/* Replication lag pair — disabled when not applicable, but keep the
          pair logically grouped so p99 ≥ p50 still holds when the user
          flips replication mode back on. */}
      {replicationActive ? (
        <LatencyPair
          p50Label="Repl. lag p50"
          p99Label="Repl. lag p99"
          p50={node.params.replication_lag_ms_p50}
          p99={node.params.replication_lag_ms_p99}
          onChange={({ p50, p99 }) =>
            update(node.id, 'database', {
              replication_lag_ms_p50: p50,
              replication_lag_ms_p99: p99,
            })
          }
        />
      ) : (
        <>
          <NumberField
            label="Repl. lag p50"
            value={node.params.replication_lag_ms_p50}
            onChange={() => undefined}
            min={0}
            suffix="ms"
            disabled
            hint="Only meaningful with async replication AND replicas > 1"
          />
          <NumberField
            label="Repl. lag p99"
            value={node.params.replication_lag_ms_p99}
            onChange={() => undefined}
            min={0}
            suffix="ms"
            disabled
          />
        </>
      )}
      <LatencyPair
        p50Label="Read latency p50"
        p99Label="Read latency p99"
        p50={node.params.read_latency_ms_p50}
        p99={node.params.read_latency_ms_p99}
        onChange={({ p50, p99 }) =>
          update(node.id, 'database', { read_latency_ms_p50: p50, read_latency_ms_p99: p99 })
        }
      />
      <LatencyPair
        p50Label="Write latency p50"
        p99Label="Write latency p99"
        p50={node.params.write_latency_ms_p50}
        p99={node.params.write_latency_ms_p99}
        onChange={({ p50, p99 }) =>
          update(node.id, 'database', { write_latency_ms_p50: p50, write_latency_ms_p99: p99 })
        }
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
        max={1_000_000}
        step={1}
        hint="0 = unbounded — over-cap arrivals reject immediately (Phase 4 default)"
      />
    </div>
  )
}
