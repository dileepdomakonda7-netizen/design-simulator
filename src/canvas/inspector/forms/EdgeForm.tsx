import type { Edge } from '@/schema/types'
import { useDesignStore } from '@/store/designStore'
import { NumberField } from '../fields/NumberField'
import { SelectField } from '../fields/SelectField'
import { TextField } from '../fields/TextField'
import { CheckboxField } from '../fields/CheckboxField'
import { RetryPolicyEditor } from '../fields/RetryPolicyEditor'
import { CircuitBreakerEditor } from '../fields/CircuitBreakerEditor'
import { Section } from '../fields/Section'

interface Props {
  edge: Edge
}

const KINDS = [
  { value: 'sync_rpc', label: 'Sync RPC' },
  { value: 'async_message', label: 'Async Message' },
  { value: 'replication', label: 'Replication' },
] as const

export function EdgeForm({ edge }: Props) {
  const updateEdgeMeta = useDesignStore((s) => s.updateEdgeMeta)
  const updateEdgeParams = useDesignStore((s) => s.updateEdgeParams)

  return (
    <>
      <Section title="Common">
        <SelectField
          label="Kind"
          value={edge.kind}
          options={KINDS}
          onChange={(kind) => updateEdgeMeta(edge.id, { kind })}
        />
        <TextField
          label="Label"
          value={edge.label ?? ''}
          onChange={(label) => updateEdgeMeta(edge.id, { label })}
          placeholder="optional"
        />
      </Section>

      <Section title="Network">
        <NumberField
          label="Latency p50"
          value={edge.params.network_latency_ms_p50}
          onChange={(v) => updateEdgeParams(edge.id, { network_latency_ms_p50: v })}
          min={0}
          suffix="ms"
        />
        <NumberField
          label="Latency p99"
          value={edge.params.network_latency_ms_p99}
          onChange={(v) => updateEdgeParams(edge.id, { network_latency_ms_p99: v })}
          min={0}
          suffix="ms"
        />
        <NumberField
          label="Timeout"
          value={edge.params.timeout_ms}
          onChange={(v) => updateEdgeParams(edge.id, { timeout_ms: v })}
          min={0}
          suffix="ms"
        />
      </Section>

      <Section title="Retry">
        <RetryPolicyEditor
          value={edge.params.retry_policy}
          onChange={(retry_policy) => updateEdgeParams(edge.id, { retry_policy })}
        />
      </Section>

      <Section title="Circuit breaker">
        <CircuitBreakerEditor
          value={edge.params.circuit_breaker}
          onChange={(circuit_breaker) => updateEdgeParams(edge.id, { circuit_breaker })}
        />
      </Section>

      <Section title="Other">
        <CheckboxField
          label="Idempotent"
          value={edge.params.idempotent}
          onChange={(idempotent) => updateEdgeParams(edge.id, { idempotent })}
          disabled
          hint="Stored in v1; used by simulation engine starting in Prompt 4"
        />
      </Section>
    </>
  )
}
